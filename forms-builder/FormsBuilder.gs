/**
 * ORDER composition rating — one-time Google Forms builder.
 *
 * Builds one Google Form per presentation-order variant from BUILD_PLAN
 * (BuildPlan.gs) and STIMULUS_IMAGES (StimulusImages_NN.gs), both generated
 * privately by research/scripts/forms/prepare-forms-build.mjs. The project holds
 * opaque image keys, question titles, approved texts and settings — never
 * stimulus IDs, pairing, strata or model scores.
 *
 * Each form:
 *   page 1   participant information (form description) + required consent choice;
 *            declining submits immediately with no ratings
 *   page 2   required study code, validated against the plan's pattern (issued
 *            XXXX-XXXX codes, or participant-chosen 6-12 letters or digits)
 *   page 3+  one composition per page: the image, then required 1-7 scales for
 *            perceived order and visual appeal
 *
 * All forms send responses to ONE private spreadsheet (a tab per form), and are
 * built CLOSED. Nothing here opens a form: openRatingForms() refuses unless the
 * investigator has recorded authorisation for this exact plan digest.
 *
 * Run from the Apps Script editor by the owner:
 *   buildRatingForms()    once
 *   verifyRatingForms()   re-reads every form and checks it against the plan
 *   openRatingForms()     only after AUTHORIZED_TO_OPEN == plan digest
 *   closeRatingForms()    any time
 */

var BUILDER_VERSION = 'forms-builder-2';

/** Publication state (newer Forms accounts); null where this Apps Script runtime lacks the call. */
function publishedState_(form) {
  try { return typeof form.isPublished === 'function' ? form.isPublished() : null; } catch (e) { return null; }
}

function hexBytes_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function sha256Bytes_(bytes) {
  return hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}

/** Verifies every embedded image against the plan before anything is created. */
function verifyImages_(plan, images) {
  var problems = [];
  plan.images.forEach(function (img) {
    var b64 = images[img.imageKey];
    if (!b64) { problems.push('missing image ' + img.imageKey); return; }
    var bytes = Utilities.base64Decode(b64);
    if (bytes.length !== img.pngBytes) problems.push(img.imageKey + ': ' + bytes.length + ' bytes, planned ' + img.pngBytes);
    else if (sha256Bytes_(bytes) !== img.pngSha256) problems.push(img.imageKey + ': SHA-256 differs from the plan');
  });
  Object.keys(images).forEach(function (k) {
    if (!plan.images.some(function (i) { return i.imageKey === k; })) problems.push('unplanned image ' + k);
  });
  return problems;
}

function verifyPlanShape_(plan) {
  var problems = [];
  if (!plan || plan.planFormat !== 'forms-build-plan-1') return ['BUILD_PLAN is missing or has the wrong format'];
  if (!/^[0-9a-f]{64}$/.test(String(plan.planDigest))) problems.push('plan digest missing');
  if (plan.settings.acceptingResponses !== false) problems.push('the plan must build forms closed');
  if (!plan.variants || !plan.variants.length) problems.push('no variants');
  plan.variants.forEach(function (v) {
    var seen = {};
    v.sections.forEach(function (s) {
      if (seen[s.imageKey]) problems.push('form ' + v.variant + ' repeats ' + s.imageKey);
      seen[s.imageKey] = true;
    });
    if (v.sections.length !== plan.images.length) problems.push('form ' + v.variant + ' does not show every image');
  });
  return problems;
}

/**
 * Applies each setting and reads it back. A setting Google does not support for
 * this account type is recorded as unsupported, never silently assumed.
 */
function applySettings_(form, settings) {
  var out = {};
  var attempt = function (name, set, get) {
    try {
      set();
      var got = get();
      out[name] = { requested: settings[name], readBack: got, ok: got === settings[name] };
    } catch (e) {
      out[name] = { requested: settings[name], readBack: null, ok: false, unsupported: String(e && e.message || e) };
    }
  };
  attempt('isQuiz', function () { form.setIsQuiz(settings.isQuiz); }, function () { return form.isQuiz(); });
  attempt('collectEmail', function () { form.setCollectEmail(settings.collectEmail); }, function () { return form.collectsEmail(); });
  attempt('requireLogin', function () { form.setRequireLogin(settings.requireLogin); }, function () { return form.requiresLogin(); });
  attempt('limitOneResponsePerUser', function () { form.setLimitOneResponsePerUser(settings.limitOneResponsePerUser); }, function () { return form.hasLimitOneResponsePerUser(); });
  attempt('allowResponseEdits', function () { form.setAllowResponseEdits(settings.allowResponseEdits); }, function () { return form.canEditResponse(); });
  attempt('publishingSummary', function () { form.setPublishingSummary(settings.publishingSummary); }, function () { return form.isPublishingSummary(); });
  attempt('showLinkToRespondAgain', function () { form.setShowLinkToRespondAgain(settings.showLinkToRespondAgain); }, function () { return form.hasRespondAgainLink(); });
  attempt('progressBar', function () { form.setProgressBar(settings.progressBar); }, function () { return form.hasProgressBar(); });
  attempt('shuffleQuestions', function () { form.setShuffleQuestions(settings.shuffleQuestions); }, function () { return form.getShuffleQuestions(); });
  attempt('acceptingResponses', function () { form.setAcceptingResponses(false); }, function () { return form.isAcceptingResponses(); });
  return out;
}

/** The only settings whose failure is tolerable: requireLogin is Workspace-only and defaults to off. */
var TOLERATED_UNSUPPORTED_ = { requireLogin: true };

function buildOneForm_(plan, images, variant, spreadsheetId) {
  var form = FormApp.create(variant.formTitle);
  form.setDescription(plan.texts.participantInformation);
  form.setConfirmationMessage(plan.texts.confirmationMessage);
  var settings = applySettings_(form, plan.settings);

  var consent = form.addMultipleChoiceItem().setTitle(plan.texts.consentQuestion).setRequired(true);
  var codePage = form.addPageBreakItem().setTitle('Study code');
  consent.setChoices([
    consent.createChoice(plan.texts.agreeChoice, FormApp.PageNavigationType.CONTINUE),
    consent.createChoice(plan.texts.declineChoice, FormApp.PageNavigationType.SUBMIT),
  ]);
  var code = form.addTextItem()
    .setTitle(plan.texts.codeQuestion)
    .setHelpText(plan.texts.codeHelp)
    .setRequired(true)
    .setValidation(FormApp.createTextValidation().setHelpText(plan.texts.codeValidationHelp || 'Format: XXXX-XXXX').requireTextMatchesPattern(plan.codePattern).build());

  var sections = variant.sections.map(function (s) {
    var page = form.addPageBreakItem().setTitle(s.sectionTitle).setHelpText(plan.questions.sectionHelp);
    var blob = Utilities.newBlob(Utilities.base64Decode(images[s.imageKey]), 'image/png', 'composition.png');
    var image = form.addImageItem().setImage(blob).setAlignment(FormApp.Alignment.CENTER)
      .setWidth(Math.min(740, plan.rasterizer.imageSize)).setTitle('');
    var order = form.addScaleItem().setTitle(s.orderTitle).setBounds(1, 7)
      .setLabels(plan.questions.orderLow, plan.questions.orderHigh).setRequired(true);
    var appeal = form.addScaleItem().setTitle(s.appealTitle).setBounds(1, 7)
      .setLabels(plan.questions.appealLow, plan.questions.appealHigh).setRequired(true);
    return {
      position: s.position, imageKey: s.imageKey,
      pageItemId: page.getId(), imageItemId: image.getId(),
      orderItemId: order.getId(), appealItemId: appeal.getId(),
      orderTitle: s.orderTitle, appealTitle: s.appealTitle,
    };
  });

  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheetId);
  // An unpublished form cannot take responses at all; closing it may then be refused.
  try { form.setAcceptingResponses(false); } catch (e) { if (publishedState_(form) !== false) throw e; }

  // A prefilled-link template for the study code: replace 0000-0000 per participant.
  var prefill = null;
  if (plan.codeMode !== 'participant-chosen') try {
    prefill = form.createResponse().withItemResponse(code.createResponse('0000-0000')).toPrefilledUrl();
  } catch (e) { prefill = 'unavailable: ' + (e && e.message || e); }

  return {
    variant: variant.variant,
    formId: form.getId(),
    title: variant.formTitle,
    publishedUrl: form.getPublishedUrl(),
    editUrl: form.getEditUrl(),
    prefilledCodeTemplate: prefill,
    consentItemId: consent.getId(),
    codeItemId: code.getId(),
    sections: sections,
    settings: settings,
    acceptingResponses: (function () { try { return form.isAcceptingResponses(); } catch (e) { return publishedState_(form) === false ? false : null; } })(),
    published: publishedState_(form),
  };
}

function writePrivateJson_(folderName, fileName, obj) {
  var folders = Drive.Files.list({ q: "name = '" + folderName + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields: 'files(id)' }).files || [];
  var folderId = folders.length ? folders[0].id
    : Drive.Files.create({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }, null, { fields: 'id' }).id;
  var blob = Utilities.newBlob(JSON.stringify(obj, null, 2), 'application/json', fileName);
  return Drive.Files.create({ name: fileName, parents: [folderId], mimeType: 'application/json' }, blob, { fields: 'id' }).id;
}

/** One-time build. Refuses to run twice for any plan. */
function buildRatingForms() {
  var props = PropertiesService.getScriptProperties();
  var plan = BUILD_PLAN;
  var already = props.getProperty('BUILT_PLAN_DIGEST');
  if (already) throw new Error('forms were already built for plan ' + already + '; this builder runs once');

  var problems = verifyPlanShape_(plan).concat(verifyImages_(plan, STIMULUS_IMAGES));
  if (problems.length) throw new Error('refusing to build:\n - ' + problems.join('\n - '));

  var prefix = plan.mode === 'study' ? '' : '[REHEARSAL] ';
  var spreadsheetId = Drive.Files.create({
    name: prefix + 'ORDER composition ratings (PRIVATE) ' + plan.planDigest.slice(0, 12),
    mimeType: 'application/vnd.google-apps.spreadsheet',
  }, null, { fields: 'id' }).id;

  var record = {
    recordFormat: 'forms-build-record-1',
    builderVersion: BUILDER_VERSION,
    builtAt: new Date().toISOString(),
    planDigest: plan.planDigest,
    mode: plan.mode,
    dataClass: plan.dataClass,
    spreadsheetId: spreadsheetId,
    forms: [],
  };
  plan.variants.forEach(function (v) { record.forms.push(buildOneForm_(plan, STIMULUS_IMAGES, v, spreadsheetId)); });

  var settingProblems = [];
  record.forms.forEach(function (f) {
    Object.keys(f.settings).forEach(function (k) {
      var s = f.settings[k];
      var closedByUnpublished = k === 'acceptingResponses' && s.unsupported && f.published === false;
      if (!s.ok && !closedByUnpublished && !(s.unsupported && TOLERATED_UNSUPPORTED_[k] && s.requested === false)) {
        settingProblems.push('form ' + f.variant + ': ' + k + ' requested ' + s.requested + ', read back ' + s.readBack + (s.unsupported ? ' (' + s.unsupported + ')' : ''));
      }
    });
    if (f.acceptingResponses !== false) settingProblems.push('form ' + f.variant + ' is accepting responses');
  });
  record.settingProblems = settingProblems;

  record.recordFileId = writePrivateJson_('ORDER rating forms build (PRIVATE)', 'forms-build-record-' + plan.planDigest.slice(0, 16) + '.json', record);
  props.setProperty('BUILT_PLAN_DIGEST', plan.planDigest);
  props.setProperty('BUILD_RECORD', JSON.stringify({ spreadsheetId: spreadsheetId, forms: record.forms.map(function (f) { return { variant: f.variant, formId: f.formId }; }) }));
  Logger.log(JSON.stringify({ planDigest: plan.planDigest, spreadsheetId: spreadsheetId, forms: record.forms.length, settingProblems: settingProblems, recordFileId: record.recordFileId }, null, 2));
  if (settingProblems.length) throw new Error('built, but settings did not read back as planned:\n - ' + settingProblems.join('\n - '));
  return record;
}

/** Re-reads every built form and checks it against the plan. Changes nothing. */
function verifyRatingForms() {
  var plan = BUILD_PLAN;
  var built = JSON.parse(PropertiesService.getScriptProperties().getProperty('BUILD_RECORD') || 'null');
  if (!built) throw new Error('nothing built yet');
  var problems = [];
  built.forms.forEach(function (bf) {
    var v = plan.variants.filter(function (x) { return x.variant === bf.variant; })[0];
    var form = FormApp.openById(bf.formId);
    var items = form.getItems();
    var scales = items.filter(function (i) { return i.getType() === FormApp.ItemType.SCALE; });
    var images = items.filter(function (i) { return i.getType() === FormApp.ItemType.IMAGE; });
    var pages = items.filter(function (i) { return i.getType() === FormApp.ItemType.PAGE_BREAK; });
    if (images.length !== v.sections.length) problems.push(bf.variant + ': ' + images.length + ' images, planned ' + v.sections.length);
    if (scales.length !== 2 * v.sections.length) problems.push(bf.variant + ': ' + scales.length + ' scales, planned ' + 2 * v.sections.length);
    if (pages.length !== v.sections.length + 1) problems.push(bf.variant + ': ' + pages.length + ' pages breaks, planned ' + (v.sections.length + 1));
    var titles = scales.map(function (i) { return i.getTitle(); });
    v.sections.forEach(function (s, idx) {
      if (titles[2 * idx] !== s.orderTitle || titles[2 * idx + 1] !== s.appealTitle) problems.push(bf.variant + ': question order differs at position ' + s.position);
    });
    scales.forEach(function (i) {
      var sc = i.asScaleItem();
      if (sc.getLowerBound() !== 1 || sc.getUpperBound() !== 7 || !sc.isRequired()) problems.push(bf.variant + ': ' + sc.getTitle() + ' is not a required 1-7 scale');
    });
    if (form.getTitle() !== v.formTitle) problems.push(bf.variant + ': title differs from the plan');
    if (form.getDescription() !== plan.texts.participantInformation) problems.push(bf.variant + ': participant information differs from the plan');
    if (form.getConfirmationMessage() !== plan.texts.confirmationMessage) problems.push(bf.variant + ': confirmation message differs from the plan');
    var consent = items.filter(function (i) { return i.getType() === FormApp.ItemType.MULTIPLE_CHOICE; });
    if (consent.length !== 1 || items[0] !== consent[0]) problems.push(bf.variant + ': the consent question is not the first and only choice question');
    else {
      var mc = consent[0].asMultipleChoiceItem();
      var ch = mc.getChoices().map(function (c) { return c.getValue() + '->' + c.getPageNavigationType(); });
      var want = [plan.texts.agreeChoice + '->' + FormApp.PageNavigationType.CONTINUE, plan.texts.declineChoice + '->' + FormApp.PageNavigationType.SUBMIT];
      if (mc.getTitle() !== plan.texts.consentQuestion || !mc.isRequired() || ch.join('|') !== want.join('|')) problems.push(bf.variant + ': consent question, requirement or routing differs from the plan');
    }
    var texts = items.filter(function (i) { return i.getType() === FormApp.ItemType.TEXT; });
    if (texts.length !== 1 || texts[0].getTitle() !== plan.texts.codeQuestion || !texts[0].asTextItem().isRequired()) problems.push(bf.variant + ': study-code question differs from the plan');
    // Image bytes as Google stores them, in page order. A byte mismatch is reported
    // separately: Google may re-encode, so the respondent view is then compared by eye.
    var stored = images.map(function (i) { try { return sha256Bytes_(i.asImageItem().getImage().getBytes()); } catch (e) { return 'unreadable'; } });
    var imageBytes = { identical: 0, differs: [] };
    v.sections.forEach(function (s, idx) {
      var planned = plan.images.filter(function (im) { return im.imageKey === s.imageKey; })[0];
      if (stored[idx] === planned.pngSha256) imageBytes.identical++; else imageBytes.differs.push(s.position);
    });
    Logger.log(bf.variant + ' stored image bytes: ' + JSON.stringify({ identical: imageBytes.identical, differsAtPositions: imageBytes.differs }));
    Logger.log(bf.variant + ' state: ' + JSON.stringify({ published: publishedState_(form), acceptingResponses: form.isAcceptingResponses(), publishedUrl: form.getPublishedUrl() }));
    if (form.isQuiz()) problems.push(bf.variant + ': is a quiz (grading on)');
    if (form.collectsEmail()) problems.push(bf.variant + ': collects email');
    if (form.isPublishingSummary()) problems.push(bf.variant + ': publishes a response summary');
    if (form.hasLimitOneResponsePerUser()) problems.push(bf.variant + ': limits to one response per user (requires sign-in)');
    if (form.canEditResponse()) problems.push(bf.variant + ': allows response edits');
    if (form.getDestinationId() !== built.spreadsheetId) problems.push(bf.variant + ': response destination is not the private spreadsheet');
    try { if (form.requiresLogin()) problems.push(bf.variant + ': requires sign-in'); } catch (e) { /* Workspace-only setting */ }
  });
  Logger.log(problems.length ? 'VERIFY FAIL\n - ' + problems.join('\n - ') : 'VERIFY PASS: ' + built.forms.length + ' forms match plan ' + plan.planDigest);
  return problems;
}

/** Opens responses ONLY for the authorised plan. The investigator sets AUTHORIZED_TO_OPEN by hand. */
function openRatingForms() {
  var props = PropertiesService.getScriptProperties();
  var plan = BUILD_PLAN;
  if (props.getProperty('AUTHORIZED_TO_OPEN') !== plan.planDigest) {
    throw new Error('not authorised: set Script Property AUTHORIZED_TO_OPEN to ' + plan.planDigest + ' only once collection is approved');
  }
  var problems = verifyRatingForms();
  if (problems.length) throw new Error('refusing to open: forms do not match the plan');
  JSON.parse(props.getProperty('BUILD_RECORD')).forms.forEach(function (bf) {
    var form = FormApp.openById(bf.formId);
    if (typeof form.setPublished === 'function' && publishedState_(form) === false) form.setPublished(true);
    form.setAcceptingResponses(true);
    if (publishedState_(form) === false || !form.isAcceptingResponses()) throw new Error('form ' + bf.variant + ' did not open (published ' + publishedState_(form) + ', accepting ' + form.isAcceptingResponses() + ')');
  });
  Logger.log('opened ' + plan.variants.length + ' forms for plan ' + plan.planDigest);
}

function closeRatingForms() {
  var built = JSON.parse(PropertiesService.getScriptProperties().getProperty('BUILD_RECORD') || 'null');
  if (!built) throw new Error('nothing built yet');
  built.forms.forEach(function (bf) { FormApp.openById(bf.formId).setAcceptingResponses(false); });
  Logger.log('closed ' + built.forms.length + ' forms');
}
