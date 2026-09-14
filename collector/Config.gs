/**
 * ORDER blind-rating response collector — configuration.
 *
 * Nothing in this file is secret. Identifiers of the private spreadsheet and
 * Drive folder, the owner's address and the registered release packages live
 * in Script Properties, which are visible only to the script's editors.
 *
 * The collector RECEIVES the participant's existing raw JSON export. It never
 * reads responses back out to a caller, never serves a scoring key, and holds
 * no key: it validates layout identities against the participant-safe
 * release-package.json (stimulus ids and integrity hashes only).
 */

var COLLECTOR_VERSION = 'collector-1';

var PROP = {
  SHEET_ID: 'SHEET_ID',                   // private Google Sheet for normalised rows
  RAW_FOLDER_ID: 'RAW_FOLDER_ID',         // private Drive folder for original files
  OWNER_EMAIL: 'OWNER_EMAIL',             // the only account allowed to run operator functions
  ACCEPTING: 'ACCEPTING_UPLOADS',         // 'true' to accept; anything else refuses
  WITHDRAWAL_POLICY: 'WITHDRAWAL_POLICY', // 'mark-ineligible' (default) | 'delete'
  PACKAGE_PREFIX: 'PACKAGE_',             // PACKAGE_<first 16 hex of digest> = registered package
};

var TAB = {
  UPLOADS: 'Uploads',
  STUDY: 'Responses',
  REHEARSAL: 'RehearsalResponses',
  CONFLICTS: 'Conflicts',
  REJECTIONS: 'Rejections',
  WITHDRAWALS: 'WithdrawalRequests',
};

/** Largest export accepted, in characters. A complete 60-stimulus export is ~40 KB. */
var MAX_EXPORT_CHARS = 1000000;

var LOCK_WAIT_MS = 30000;

/**
 * One row per response. Column names are the EXPORT'S OWN field names, with
 * dotted paths for nested fields, plus the collector's additions, which are
 * prefixed `server` or `upload` so they cannot be mistaken for participant data.
 */
var RESPONSE_COLUMNS = [
  'uploadId', 'serverReceivedAt', 'uploadSha256',
  'dataClass', 'releaseMode', 'releasePackageId', 'releasePackageDigest',
  'exportFormat', 'sessionFormat', 'instrumentVersion', 'instructionsVersion',
  'acknowledgementVersion', 'manifestVersion',
  'participantId', 'orderSeed', 'status', 'withdrawn', 'withdrawnAt',
  'startedAt', 'acknowledgedAt', 'exportedAt',
  'stimulusId', 'presentationIndex', 'perceivedOrder', 'appeal', 'confidence',
  'comment', 'shownAt', 'respondedAt', 'stimulusIntegrity', 'trialValid',
  'analysisEligible.modelAgreement', 'analysisEligible.ratingOnly',
  'exclusionRule', 'invalidReason',
  'serverWithdrawalRequestId', 'serverWithdrawalProcessedAt',
];

var UPLOAD_COLUMNS = [
  'uploadId', 'sessionKey', 'participantId', 'releasePackageDigest', 'dataClass',
  'uploadSha256', 'state', 'serverReceivedAt', 'rawFileId', 'targetTab',
  'responseCount', 'rowsVerified', 'completedAt', 'lastAttemptAt', 'attempts', 'note',
];

var CONFLICT_COLUMNS = [
  'uploadId', 'sessionKey', 'participantId', 'releasePackageDigest', 'uploadSha256',
  'existingUploadId', 'existingSha256', 'serverReceivedAt', 'rawFileId', 'state',
];

var REJECTION_COLUMNS = ['serverReceivedAt', 'uploadSha256', 'chars', 'errorCodes'];

var WITHDRAWAL_COLUMNS = [
  'requestId', 'participantId', 'serverReceivedAt', 'state', 'processedAt', 'policy',
  'rowsAffected', 'note',
];

/** Upload ledger states, in order. Only `complete` may be reported as received. */
var UPLOAD_STATE = {
  PENDING: 'pending',
  RAW_STORED: 'raw-stored',
  ROWS_WRITTEN: 'rows-written',
  COMPLETE: 'complete',
};
