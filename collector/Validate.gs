/**
 * Export validation. Pure functions: no Google services are touched here, so
 * the same code runs under Node for the automated tests.
 *
 * The schema is the instrument's `rating-export-1` as produced by
 * RatingSession.exportRecord(). Validation is strict about everything the
 * analysis depends on and about identity; unknown extra fields are tolerated
 * (they stay in the preserved original) but never written to the sheet.
 */

var ISO_RE_ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
var HEX64_RE_ = /^[0-9a-f]{64}$/;
var FNV_RE_ = /^[0-9a-f]{8}$/;
var PARTICIPANT_RE_ = /^p-[0-9a-f]{16}$/;
var STIMULUS_RE_ = /^stim-[0-9a-f]{8}$/;
var STATUSES_ = ['created', 'in-progress', 'completed', 'withdrawn'];
var DATA_CLASSES_ = ['development-rehearsal', 'study-data'];

function isIso_(v) { return typeof v === 'string' && ISO_RE_.test(v) && !isNaN(Date.parse(v)); }
function isIsoOrNull_(v) { return v === null || isIso_(v); }
function isRating_(v) { return typeof v === 'number' && Math.floor(v) === v && v >= 1 && v <= 7; }
function isBool_(v) { return v === true || v === false; }

/**
 * Participant-safe package record as registered with the collector:
 *   { packageId, packageDigest, releaseMode, dataClass, stimuli: { <id>: <fnv> } }
 */
function compactPackage_(releasePackage) {
  var stimuli = {};
  (releasePackage.stimuli || []).forEach(function (s) { stimuli[s.stimulusId] = s.fnv; });
  return {
    packageId: releasePackage.packageId,
    packageDigest: releasePackage.packageDigest,
    releaseMode: releasePackage.releaseMode,
    dataClass: releasePackage.dataClass,
    stimuli: stimuli,
  };
}

/** Validates the registration input itself, so a malformed package cannot be registered. */
function validatePackageRecord_(pkg) {
  var errors = [];
  if (!pkg || typeof pkg !== 'object') return ['package-not-object'];
  if (pkg.packageFormat !== 'release-package-1') errors.push('package-format');
  if (!HEX64_RE_.test(String(pkg.packageDigest))) errors.push('package-digest');
  if (typeof pkg.packageId !== 'string' || pkg.packageId.slice(-16) !== String(pkg.packageDigest).slice(0, 16)) {
    errors.push('package-id');
  }
  if (DATA_CLASSES_.indexOf(pkg.dataClass) === -1) errors.push('package-data-class');
  if (['development', 'participant'].indexOf(pkg.releaseMode) === -1) errors.push('package-release-mode');
  if ((pkg.releaseMode === 'participant') !== (pkg.dataClass === 'study-data')) errors.push('package-mode-class-mismatch');
  if (!Array.isArray(pkg.stimuli) || pkg.stimuli.length === 0) errors.push('package-stimuli');
  else {
    var seen = {};
    pkg.stimuli.forEach(function (s) {
      if (!s || !STIMULUS_RE_.test(String(s.stimulusId)) || !FNV_RE_.test(String(s.fnv))) errors.push('package-stimulus-entry');
      else if (seen[s.stimulusId]) errors.push('package-duplicate-stimulus');
      else seen[s.stimulusId] = true;
    });
  }
  // A scoring key must never be registered with the collector.
  var text = JSON.stringify(pkg);
  ['condition', 'scoringKey', 'v1Total', 'submetrics', '"total"'].forEach(function (t) {
    if (text.indexOf(t) !== -1) errors.push('package-contains-researcher-field:' + t);
  });
  return errors;
}

/**
 * Parses and validates an export.
 * @param {string} text  the file exactly as uploaded
 * @param {function(string): (object|null)} lookupPackage  digest -> compact package, or null
 * @return {{ok: boolean, errors: string[], record?: object, pkg?: object}}
 */
function validateExport_(text, lookupPackage) {
  var errors = [];
  if (typeof text !== 'string' || text.length === 0) return { ok: false, errors: ['empty'] };
  if (text.length > MAX_EXPORT_CHARS) return { ok: false, errors: ['too-large'] };

  var rec;
  try { rec = JSON.parse(text); } catch (e) { return { ok: false, errors: ['not-json'] }; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, errors: ['not-object'] };

  // --- envelope ------------------------------------------------------------
  if (rec.exportFormat !== 'rating-export-1') errors.push('export-format');
  if (rec.sessionFormat !== 'rating-session-3') errors.push('session-format');
  if (rec.transmitted !== false) errors.push('transmitted-flag');
  if (!rec.collection || rec.collection.mechanism !== 'local-download-only') errors.push('collection-mechanism');
  ['instrumentVersion', 'instructionsVersion', 'acknowledgementVersion', 'manifestVersion', 'releaseStatus']
    .forEach(function (k) { if (typeof rec[k] !== 'string' || rec[k].length === 0 || rec[k].length > 200) errors.push('field:' + k); });
  if (!PARTICIPANT_RE_.test(String(rec.participantId))) errors.push('participant-id');
  if (typeof rec.orderSeed !== 'string' || rec.orderSeed.length > 200) errors.push('order-seed');
  if (STATUSES_.indexOf(rec.status) === -1) errors.push('status');
  if (!isIso_(rec.startedAt)) errors.push('started-at');
  if (!isIsoOrNull_(rec.acknowledgedAt)) errors.push('acknowledged-at');
  if (!isIso_(rec.exportedAt)) errors.push('exported-at');
  if (!isBool_(rec.withdrawn)) errors.push('withdrawn');
  if (!isIsoOrNull_(rec.withdrawnAt)) errors.push('withdrawn-at');
  if (rec.withdrawn === true && (rec.status !== 'withdrawn' || rec.withdrawnAt === null)) errors.push('withdrawal-inconsistent');
  if (rec.withdrawn === false && rec.status === 'withdrawn') errors.push('withdrawal-inconsistent');
  if (typeof rec.revision !== 'number' || Math.floor(rec.revision) !== rec.revision || rec.revision < 0) errors.push('revision');

  // --- identity ------------------------------------------------------------
  var pkg = null;
  if (!HEX64_RE_.test(String(rec.releasePackageDigest))) {
    errors.push('package-digest-missing');
  } else {
    pkg = lookupPackage(rec.releasePackageDigest);
    if (!pkg) errors.push('package-not-registered');
    else {
      if (rec.releasePackageId !== pkg.packageId) errors.push('package-id-mismatch');
      if (rec.dataClass !== pkg.dataClass) errors.push('data-class-mismatch');
      if (rec.releaseMode !== pkg.releaseMode) errors.push('release-mode-mismatch');
    }
  }

  // --- presentation order ----------------------------------------------------
  var order = rec.order;
  var position = {};
  if (!Array.isArray(order) || order.length === 0) errors.push('order');
  else {
    order.forEach(function (id, i) {
      if (!STIMULUS_RE_.test(String(id))) errors.push('order-entry');
      else if (Object.prototype.hasOwnProperty.call(position, id)) errors.push('order-duplicate');
      else position[id] = i;
    });
    if (pkg) {
      var pkgIds = Object.keys(pkg.stimuli);
      if (pkgIds.length !== order.length || pkgIds.some(function (id) { return !Object.prototype.hasOwnProperty.call(position, id); })) {
        errors.push('order-not-package-layouts');
      }
    }
  }

  // --- responses -------------------------------------------------------------
  var responses = rec.responses;
  if (!Array.isArray(responses)) errors.push('responses');
  else {
    if (rec.responseCount !== responses.length) errors.push('response-count');
    var seenStim = {};
    responses.forEach(function (r, i) {
      var tag = 'response[' + i + ']:';
      if (!r || typeof r !== 'object') { errors.push(tag + 'not-object'); return; }
      if (!Object.prototype.hasOwnProperty.call(position, r.stimulusId)) { errors.push(tag + 'stimulus-not-in-order'); return; }
      if (seenStim[r.stimulusId]) errors.push(tag + 'duplicate-stimulus');
      seenStim[r.stimulusId] = true;
      if (r.presentationIndex !== position[r.stimulusId]) errors.push(tag + 'presentation-index');
      if (!isRating_(r.perceivedOrder)) errors.push(tag + 'perceived-order');
      if (!isRating_(r.appeal)) errors.push(tag + 'appeal');
      if (!(r.confidence === null || isRating_(r.confidence))) errors.push(tag + 'confidence');
      if (typeof r.comment !== 'string' || r.comment.length > 2000) errors.push(tag + 'comment');
      if (!isIsoOrNull_(r.shownAt)) errors.push(tag + 'shown-at');
      if (!isIso_(r.respondedAt)) errors.push(tag + 'responded-at');
      if (!isBool_(r.trialValid)) errors.push(tag + 'trial-valid');
      var ae = r.analysisEligible;
      if (!ae || !(ae.modelAgreement === null || isBool_(ae.modelAgreement)) || !isBool_(ae.ratingOnly)) errors.push(tag + 'analysis-eligible');
      if (!(r.exclusionRule === null || typeof r.exclusionRule === 'string')) errors.push(tag + 'exclusion-rule');
      if (!(r.invalidReason === null || typeof r.invalidReason === 'string')) errors.push(tag + 'invalid-reason');
      // Layout identity: the integrity hash the browser computed from the bytes
      // it was served must be the registered one, unless the trial was already
      // flagged invalid for exactly that reason.
      if (!FNV_RE_.test(String(r.stimulusIntegrity))) errors.push(tag + 'stimulus-integrity');
      else if (pkg && pkg.stimuli[r.stimulusId] !== r.stimulusIntegrity) {
        if (r.trialValid !== false || r.exclusionRule !== 'X1-integrity-mismatch') errors.push(tag + 'layout-identity-mismatch');
      }
      if (rec.withdrawn === true && ae && (ae.ratingOnly !== false || ae.modelAgreement === true)) {
        errors.push(tag + 'withdrawn-but-eligible');
      }
    });
    var skipped = rec.skipped || {};
    Object.keys(skipped).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(position, id)) errors.push('skipped-not-in-order');
      if (seenStim[id]) errors.push('skipped-and-answered');
    });
  }

  // Deduplicate identical codes so the rejection record stays short.
  var unique = errors.filter(function (e, i) { return errors.indexOf(e) === i; });
  return unique.length ? { ok: false, errors: unique } : { ok: true, errors: [], record: rec, pkg: pkg };
}

function dotted_(obj, path) {
  var parts = path.split('.');
  var v = obj;
  for (var i = 0; i < parts.length; i++) {
    if (v === null || v === undefined) return '';
    v = v[parts[i]];
  }
  return v;
}

/**
 * Normalises one response into a row. Every value is a literal: strings stay
 * strings (they are written with RAW input, so `=`, `+`, `-` and `@` prefixes
 * are never evaluated), null becomes an empty cell, numbers and booleans keep
 * their type.
 */
function responseRow_(rec, response, meta) {
  var session = {
    uploadId: meta.uploadId,
    serverReceivedAt: meta.serverReceivedAt,
    uploadSha256: meta.uploadSha256,
    serverWithdrawalRequestId: '',
    serverWithdrawalProcessedAt: '',
  };
  return RESPONSE_COLUMNS.map(function (col) {
    var v;
    if (Object.prototype.hasOwnProperty.call(session, col)) v = session[col];
    else if (['stimulusId', 'presentationIndex', 'perceivedOrder', 'appeal', 'confidence', 'comment',
      'shownAt', 'respondedAt', 'stimulusIntegrity', 'trialValid', 'exclusionRule', 'invalidReason'].indexOf(col) !== -1
      || col.indexOf('analysisEligible.') === 0) v = dotted_(response, col);
    else v = dotted_(rec, col);
    return (v === null || v === undefined) ? '' : v;
  });
}
