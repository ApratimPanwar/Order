/**
 * Entry points.
 *
 * PUBLIC SURFACE (callable by anyone with the web-app link):
 *   doGet()                 serves the upload page; takes no parameters that read data
 *   submitExport(text, sha) receives one export and returns that upload's receipt
 *   requestWithdrawal(code) records a withdrawal request for already-returned responses
 *   getPageConfig()         collector version, whether uploads are open, contact text
 *
 * There is deliberately no doPost and no function that returns responses,
 * uploads, rows, files or packages. Every other top-level function is either
 * private (trailing underscore, not callable from the page) or an operator
 * function that refuses unless the signed-in user is the configured owner.
 * Anonymous web-app visitors have no signed-in identity, so they are refused.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Upload')
    .setTitle('Return your responses')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function submitExport(text, clientSha256) {
  return ingestExport_(services_(), text, clientSha256);
}

function requestWithdrawal(participantId) {
  return recordWithdrawalRequest_(services_(), String(participantId || '').trim());
}

function getPageConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    collectorVersion: COLLECTOR_VERSION,
    accepting: props.getProperty(PROP.ACCEPTING) === 'true',
    // Shown verbatim. Null until the investigator sets an approved contact route.
    contactText: props.getProperty('CONTACT_TEXT') || null,
    withdrawalPolicy: props.getProperty(PROP.WITHDRAWAL_POLICY) || 'mark-ineligible',
  };
}

// ---------------------------------------------------------------------------
// Operator functions — run from the Apps Script editor by the owner only.
// ---------------------------------------------------------------------------

function requireOwner_() {
  var owner = PropertiesService.getScriptProperties().getProperty(PROP.OWNER_EMAIL);
  var active = '';
  try { active = Session.getActiveUser().getEmail(); } catch (e) { active = ''; }
  if (!owner || !active || active.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('operator functions are restricted to the configured owner');
  }
}

/**
 * First-time setup. Creates the PRIVATE spreadsheet and Drive folder (owned by
 * the account running this, shared with nobody), records their ids, and sets
 * the owner. Uploads stay closed until operatorOpenUploads() is run.
 */
function operatorSetup() {
  var props = PropertiesService.getScriptProperties();
  var me = Session.getActiveUser().getEmail();
  if (!me) throw new Error('run operatorSetup from the editor while signed in');
  var owner = props.getProperty(PROP.OWNER_EMAIL);
  if (owner && owner.toLowerCase() !== me.toLowerCase()) throw new Error('already configured for another owner');
  props.setProperty(PROP.OWNER_EMAIL, me);
  if (!props.getProperty(PROP.SHEET_ID)) {
    props.setProperty(PROP.SHEET_ID, SpreadsheetApp.create('ORDER rating responses (PRIVATE)').getId());
  }
  if (!props.getProperty(PROP.RAW_FOLDER_ID)) {
    // Drive API, not DriveApp: works within the drive.file scope (see Services.gs).
    props.setProperty(PROP.RAW_FOLDER_ID, driveCreateFolder_('ORDER rating uploads (PRIVATE)', null));
  }
  if (!props.getProperty(PROP.WITHDRAWAL_POLICY)) props.setProperty(PROP.WITHDRAWAL_POLICY, 'mark-ineligible');
  if (!props.getProperty(PROP.ACCEPTING)) props.setProperty(PROP.ACCEPTING, 'false');
  ensureTabs_(services_());
  operatorStatus();
}

/**
 * Registers the participant-safe release-package.json served by the study site.
 * Set Script Properties REGISTER_PACKAGE_URL and REGISTER_PACKAGE_DIGEST first:
 * the package is fetched from the live site and refused unless its digest is
 * exactly the frozen one.
 */
function operatorRegisterPackage() {
  requireOwner_();
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('REGISTER_PACKAGE_URL');
  var digest = props.getProperty('REGISTER_PACKAGE_DIGEST');
  if (!url || !digest) throw new Error('set REGISTER_PACKAGE_URL and REGISTER_PACKAGE_DIGEST');
  if (url.indexOf('https://') !== 0) throw new Error('package URL must be https');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ' fetching ' + url);
  var out = registerPackage_(services_(), res.getContentText('UTF-8'), digest);
  Logger.log(JSON.stringify(out));
  return out;
}

function operatorOpenUploads() {
  requireOwner_();
  PropertiesService.getScriptProperties().setProperty(PROP.ACCEPTING, 'true');
  operatorStatus();
}

function operatorCloseUploads() {
  requireOwner_();
  PropertiesService.getScriptProperties().setProperty(PROP.ACCEPTING, 'false');
  operatorStatus();
}

function operatorProcessWithdrawals() {
  requireOwner_();
  var report = processWithdrawals_(services_());
  Logger.log(JSON.stringify(report));
  return report;
}

/** Counts only, written to the editor log. Never returned to the web page. */
function operatorStatus() {
  requireOwner_();
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var svc = services_();
  var count = function (tab) { return svc.sheets.readColumn(tab, 0).filter(function (v) { return v !== ''; }).length; };
  Logger.log(JSON.stringify({
    collectorVersion: COLLECTOR_VERSION,
    accepting: all[PROP.ACCEPTING],
    withdrawalPolicy: all[PROP.WITHDRAWAL_POLICY],
    registeredPackages: Object.keys(all).filter(function (k) { return k.indexOf(PROP.PACKAGE_PREFIX) === 0; })
      .map(function (k) { var p = JSON.parse(all[k]); return p.packageId + ' [' + p.dataClass + ']'; }),
    uploads: count(TAB.UPLOADS),
    studyRows: count(TAB.STUDY),
    rehearsalRows: count(TAB.REHEARSAL),
    conflicts: count(TAB.CONFLICTS),
    rejections: count(TAB.REJECTIONS),
    withdrawalRequests: count(TAB.WITHDRAWALS),
  }, null, 2));
}
