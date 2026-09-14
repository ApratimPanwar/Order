/**
 * Ingestion, conflict handling and withdrawal bookkeeping.
 *
 * Every function here takes a `svc` object instead of touching Google services
 * directly, so the same code is exercised by the Node test suite with fakes and
 * runs unchanged in Apps Script with the real adapters from Services.gs.
 *
 * INVARIANTS
 *
 *   1. "received" is returned only after the original file is stored in Drive,
 *      every response row is written, the rows have been READ BACK and match
 *      the file field for field, and the ledger row says `complete`.
 *   2. The upload identifier is derived from the SHA-256 of the file, so a retry
 *      of the same file is the same upload: it resumes or reports the earlier
 *      receipt, never writes twice.
 *   3. The first upload for a (package digest, study code) holds that session.
 *      A DIFFERENT file for the same session is stored privately as a conflict
 *      and never overwrites or merges into the rows already received.
 *   4. All writes happen under the script lock.
 *   5. Nothing reads responses back to a caller. The only data returned is the
 *      caller's own receipt.
 */

var STATE_RANK_ = { 'pending': 0, 'raw-stored': 1, 'rows-written': 2, 'complete': 3 };

function receipt_(status, fields) {
  var out = { status: status, collectorVersion: COLLECTOR_VERSION };
  for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) out[k] = fields[k];
  return out;
}

function ensureTabs_(svc) {
  svc.sheets.ensureTab(TAB.UPLOADS, UPLOAD_COLUMNS);
  svc.sheets.ensureTab(TAB.STUDY, RESPONSE_COLUMNS);
  svc.sheets.ensureTab(TAB.REHEARSAL, RESPONSE_COLUMNS);
  svc.sheets.ensureTab(TAB.CONFLICTS, CONFLICT_COLUMNS);
  svc.sheets.ensureTab(TAB.REJECTIONS, REJECTION_COLUMNS);
  svc.sheets.ensureTab(TAB.WITHDRAWALS, WITHDRAWAL_COLUMNS);
}

function packagePropertyKey_(digest) { return PROP.PACKAGE_PREFIX + String(digest).slice(0, 16); }

function lookupPackage_(props, digest) {
  var raw = props.getProperty(packagePropertyKey_(digest));
  if (!raw) return null;
  var pkg = JSON.parse(raw);
  return pkg.packageDigest === digest ? pkg : null;
}

/** Row objects for every row whose `keyColumn` equals `value`. */
function rowsWhere_(svc, tab, columns, keyColumn, value) {
  var keyIdx = columns.indexOf(keyColumn);
  var col = svc.sheets.readColumn(tab, keyIdx);
  var out = [];
  for (var i = 0; i < col.length; i++) {
    if (col[i] === value) {
      var rowNumber = i + 2;
      var values = svc.sheets.readRow(tab, rowNumber, columns.length);
      var obj = { __row: rowNumber };
      columns.forEach(function (c, j) { obj[c] = values[j] === undefined ? '' : values[j]; });
      out.push(obj);
    }
  }
  return out;
}

function objectToRow_(columns, obj) {
  return columns.map(function (c) {
    var v = obj[c];
    return (v === null || v === undefined) ? '' : v;
  });
}

function updateObject_(svc, tab, columns, obj) {
  svc.sheets.updateRow(tab, obj.__row, objectToRow_(columns, obj));
}

/** Stores text under `name`, reusing an existing identical file. Returns the file id. */
function storeRawIdempotent_(svc, area, name, text, sha) {
  var existing = svc.drive.findByName(area, name);
  if (existing) {
    if (svc.sha256Hex(svc.drive.readText(existing.id)) === sha) return existing.id;
    // A same-named file with different bytes cannot be ours: refuse rather than guess.
    throw new Error('raw-name-collision');
  }
  var id = svc.drive.create(area, name, text);
  if (svc.sha256Hex(svc.drive.readText(id)) !== sha) throw new Error('raw-verification-failed');
  return id;
}

/**
 * Receives one export.
 * @param {object} svc
 * @param {string} text         the file exactly as the participant selected it
 * @param {string=} clientSha256 the browser's SHA-256 of the same text, to detect transfer damage
 */
function ingestExport_(svc, text, clientSha256) {
  if (svc.props.getProperty(PROP.ACCEPTING) !== 'true') {
    return receipt_('closed', { message: 'Uploads are not currently being accepted.' });
  }
  if (typeof text !== 'string') return receipt_('rejected', { errors: ['empty'] });
  var sha = svc.sha256Hex(text);
  if (clientSha256 && String(clientSha256).toLowerCase() !== sha) {
    // Nothing is stored: the bytes that arrived are not the bytes that were sent.
    return receipt_('not-received', { retryable: true, reason: 'transfer-damaged' });
  }

  try {
    svc.lock.waitLock(LOCK_WAIT_MS);
  } catch (e) {
    return receipt_('not-received', { retryable: true, reason: 'busy' });
  }
  try {
    ensureTabs_(svc);
    var v = validateExport_(text, function (d) { return lookupPackage_(svc.props, d); });
    if (!v.ok) {
      // The rejected file is NOT stored: it may not be an export at all.
      svc.sheets.append(TAB.REJECTIONS, [[svc.now(), sha, text.length, v.errors.join('|')]]);
      svc.sheets.flush();
      return receipt_('rejected', { errors: v.errors });
    }
    var rec = v.record;
    var uploadId = 'u-' + sha.slice(0, 32);
    var sessionKey = rec.releasePackageDigest + ':' + rec.participantId;
    var session = rowsWhere_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, 'sessionKey', sessionKey);
    var mine = session.filter(function (r) { return r.uploadSha256 === sha; })[0] || null;
    var holder = session.filter(function (r) { return r.uploadSha256 !== sha; })[0] || null;

    if (!mine && holder) return ingestConflict_(svc, text, sha, uploadId, sessionKey, rec, holder);

    var now = svc.now();
    if (!mine) {
      svc.sheets.append(TAB.UPLOADS, [objectToRow_(UPLOAD_COLUMNS, {
        uploadId: uploadId, sessionKey: sessionKey, participantId: rec.participantId,
        releasePackageDigest: rec.releasePackageDigest, dataClass: rec.dataClass,
        uploadSha256: sha, state: UPLOAD_STATE.PENDING, serverReceivedAt: now,
        lastAttemptAt: now, attempts: 1, responseCount: rec.responses.length,
      })]);
      svc.sheets.flush();
      mine = rowsWhere_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, 'uploadId', uploadId)[0];
      if (!mine) throw new Error('ledger-write-not-visible');
    } else if (mine.state === UPLOAD_STATE.COMPLETE && String(mine.note).indexOf('withdrawn-and-deleted') === 0) {
      // Deleted at the participant's request: do not store it again, and do not
      // report it as received.
      return receipt_('withdrawn', {
        uploadId: uploadId,
        message: 'Responses with this study code were withdrawn and deleted at your request. '
          + 'This file was not stored again.',
      });
    } else if (mine.state === UPLOAD_STATE.COMPLETE) {
      return receipt_('received', {
        duplicate: true, uploadId: uploadId, uploadSha256: sha,
        serverReceivedAt: mine.serverReceivedAt, responseCount: Number(mine.responseCount),
        dataClass: mine.dataClass,
      });
    } else {
      mine.attempts = Number(mine.attempts || 0) + 1;
      mine.lastAttemptAt = now;
      updateObject_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, mine);
    }

    // --- 1. the original file, privately --------------------------------------
    var rawId = storeRawIdempotent_(svc, 'raw', uploadId + '.json', text, sha);
    if (mine.rawFileId !== rawId || STATE_RANK_[mine.state] < STATE_RANK_[UPLOAD_STATE.RAW_STORED]) {
      mine.rawFileId = rawId;
      if (STATE_RANK_[mine.state] < STATE_RANK_[UPLOAD_STATE.RAW_STORED]) mine.state = UPLOAD_STATE.RAW_STORED;
      updateObject_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, mine);
      svc.sheets.flush();
    }

    // --- 2. normalised rows, resuming a partial write ------------------------------
    var tab = rec.dataClass === 'study-data' ? TAB.STUDY : TAB.REHEARSAL;
    var withdrawal = rowsWhere_(svc, TAB.WITHDRAWALS, WITHDRAWAL_COLUMNS, 'participantId', rec.participantId)[0] || null;
    var meta = { uploadId: uploadId, serverReceivedAt: mine.serverReceivedAt, uploadSha256: sha };
    var present = {};
    rowsWhere_(svc, tab, RESPONSE_COLUMNS, 'uploadId', uploadId).forEach(function (r) {
      present[r.stimulusId] = (present[r.stimulusId] || 0) + 1;
    });
    var toWrite = rec.responses
      .filter(function (r) { return !present[r.stimulusId]; })
      .map(function (r) {
        var row = responseRow_(rec, r, meta);
        if (withdrawal) applyWithdrawalToRow_(row, withdrawal.requestId, '');
        return row;
      });
    if (toWrite.length) svc.sheets.append(tab, toWrite);
    svc.sheets.flush();

    // --- 3. read back and verify field for field -------------------------------
    var written = rowsWhere_(svc, tab, RESPONSE_COLUMNS, 'uploadId', uploadId);
    var problem = verifyRows_(rec, written, meta, withdrawal);
    if (problem) {
      mine.note = problem;
      updateObject_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, mine);
      svc.sheets.flush();
      return receipt_('not-received', { retryable: false, reason: 'verification-failed', uploadId: uploadId });
    }
    mine.state = UPLOAD_STATE.COMPLETE;
    mine.targetTab = tab;
    mine.rowsVerified = written.length;
    mine.completedAt = svc.now();
    mine.note = withdrawal ? 'withdrawal-requested-before-upload' : '';
    updateObject_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, mine);
    svc.sheets.flush();

    // --- 4. confirm the ledger itself persisted before claiming receipt ---------
    var confirmed = rowsWhere_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, 'uploadId', uploadId)[0];
    if (!confirmed || confirmed.state !== UPLOAD_STATE.COMPLETE) {
      return receipt_('not-received', { retryable: true, reason: 'ledger-not-confirmed', uploadId: uploadId });
    }
    return receipt_('received', {
      duplicate: false, uploadId: uploadId, uploadSha256: sha,
      serverReceivedAt: mine.serverReceivedAt, responseCount: rec.responses.length,
      dataClass: rec.dataClass,
    });
  } catch (e) {
    // Any failure leaves the ledger in a resumable state; a retry of the same
    // file continues from the last confirmed step.
    return receipt_('not-received', { retryable: true, reason: 'server-error', detail: String(e && e.message || e) });
  } finally {
    svc.lock.releaseLock();
  }
}

function ingestConflict_(svc, text, sha, uploadId, sessionKey, rec, holder) {
  var existing = rowsWhere_(svc, TAB.CONFLICTS, CONFLICT_COLUMNS, 'uploadId', uploadId)[0] || null;
  if (existing && existing.state === 'stored') {
    return receipt_('held-for-review', { uploadId: uploadId, uploadSha256: sha, duplicate: true, serverReceivedAt: existing.serverReceivedAt });
  }
  var rawId = storeRawIdempotent_(svc, 'conflicts', uploadId + '.json', text, sha);
  var now = svc.now();
  var row = {
    uploadId: uploadId, sessionKey: sessionKey, participantId: rec.participantId,
    releasePackageDigest: rec.releasePackageDigest, uploadSha256: sha,
    existingUploadId: holder.uploadId, existingSha256: holder.uploadSha256,
    serverReceivedAt: existing ? existing.serverReceivedAt : now, rawFileId: rawId, state: 'stored',
  };
  if (existing) { row.__row = existing.__row; updateObject_(svc, TAB.CONFLICTS, CONFLICT_COLUMNS, row); }
  else svc.sheets.append(TAB.CONFLICTS, [objectToRow_(CONFLICT_COLUMNS, row)]);
  svc.sheets.flush();
  var confirmed = rowsWhere_(svc, TAB.CONFLICTS, CONFLICT_COLUMNS, 'uploadId', uploadId)[0];
  if (!confirmed || confirmed.state !== 'stored') {
    return receipt_('not-received', { retryable: true, reason: 'conflict-not-confirmed' });
  }
  return receipt_('held-for-review', {
    uploadId: uploadId, uploadSha256: sha, duplicate: false, serverReceivedAt: row.serverReceivedAt,
    message: 'A different file with this study code was received earlier. This file has been '
      + 'stored privately but NOT added to the responses; the researcher will review it.',
  });
}

/** Returns a problem code, or '' if the stored rows match the file exactly. */
function verifyRows_(rec, written, meta, withdrawal) {
  var byStim = {};
  for (var i = 0; i < written.length; i++) {
    var id = written[i].stimulusId;
    if (byStim[id]) return 'duplicate-row:' + id;
    byStim[id] = written[i];
  }
  if (written.length !== rec.responses.length) return 'row-count:' + written.length + '/' + rec.responses.length;
  for (var j = 0; j < rec.responses.length; j++) {
    var r = rec.responses[j];
    var stored = byStim[r.stimulusId];
    if (!stored) return 'missing-row:' + r.stimulusId;
    var expected = responseRow_(rec, r, meta);
    if (withdrawal) applyWithdrawalToRow_(expected, withdrawal.requestId, '');
    for (var c = 0; c < RESPONSE_COLUMNS.length; c++) {
      var col = RESPONSE_COLUMNS[c];
      if (col === 'serverWithdrawalProcessedAt') continue;
      if (stored[col] !== expected[c]) return 'field-mismatch:' + r.stimulusId + ':' + col;
    }
  }
  return '';
}

function applyWithdrawalToRow_(row, requestId, processedAt) {
  row[RESPONSE_COLUMNS.indexOf('analysisEligible.modelAgreement')] = false;
  row[RESPONSE_COLUMNS.indexOf('analysisEligible.ratingOnly')] = false;
  row[RESPONSE_COLUMNS.indexOf('exclusionRule')] = 'X4-withdrawn-after-upload';
  row[RESPONSE_COLUMNS.indexOf('serverWithdrawalRequestId')] = requestId;
  row[RESPONSE_COLUMNS.indexOf('serverWithdrawalProcessedAt')] = processedAt;
  return row;
}

/**
 * A participant's request to withdraw responses ALREADY RETURNED. It records the
 * request; it does not reveal whether any upload carries that code, and it does
 * not delete anything by itself.
 */
function recordWithdrawalRequest_(svc, participantId) {
  if (!PARTICIPANT_RE_.test(String(participantId))) return receipt_('invalid-code', {});
  try { svc.lock.waitLock(LOCK_WAIT_MS); } catch (e) { return receipt_('not-received', { retryable: true, reason: 'busy' }); }
  try {
    ensureTabs_(svc);
    var existing = rowsWhere_(svc, TAB.WITHDRAWALS, WITHDRAWAL_COLUMNS, 'participantId', participantId)[0] || null;
    if (existing) {
      return receipt_('withdrawal-recorded', { requestId: existing.requestId, serverReceivedAt: existing.serverReceivedAt, duplicate: true });
    }
    var requestId = 'w-' + svc.sha256Hex(participantId + '|' + svc.uuid()).slice(0, 24);
    var now = svc.now();
    svc.sheets.append(TAB.WITHDRAWALS, [objectToRow_(WITHDRAWAL_COLUMNS, {
      requestId: requestId, participantId: participantId, serverReceivedAt: now, state: 'requested',
      policy: svc.props.getProperty(PROP.WITHDRAWAL_POLICY) || 'mark-ineligible',
    })]);
    svc.sheets.flush();
    var confirmed = rowsWhere_(svc, TAB.WITHDRAWALS, WITHDRAWAL_COLUMNS, 'requestId', requestId)[0];
    if (!confirmed) return receipt_('not-received', { retryable: true, reason: 'withdrawal-not-confirmed' });
    return receipt_('withdrawal-recorded', { requestId: requestId, serverReceivedAt: now, duplicate: false });
  } catch (e) {
    return receipt_('not-received', { retryable: true, reason: 'server-error', detail: String(e && e.message || e) });
  } finally {
    svc.lock.releaseLock();
  }
}

/**
 * Operator step: applies every outstanding withdrawal request under the
 * configured policy.
 *   mark-ineligible  rows kept for audit, both eligibility flags false, X4
 *   delete           rows removed; original and conflict files moved to Drive trash
 */
function processWithdrawals_(svc) {
  var policy = svc.props.getProperty(PROP.WITHDRAWAL_POLICY) || 'mark-ineligible';
  if (policy !== 'mark-ineligible' && policy !== 'delete') throw new Error('unknown withdrawal policy ' + policy);
  svc.lock.waitLock(LOCK_WAIT_MS);
  try {
    ensureTabs_(svc);
    var requests = rowsWhere_(svc, TAB.WITHDRAWALS, WITHDRAWAL_COLUMNS, 'state', 'requested');
    var report = [];
    requests.forEach(function (req) {
      var now = svc.now();
      var affected = 0;
      [TAB.STUDY, TAB.REHEARSAL].forEach(function (tab) {
        var rows = rowsWhere_(svc, tab, RESPONSE_COLUMNS, 'participantId', req.participantId);
        if (policy === 'delete') {
          rows.map(function (r) { return r.__row; }).sort(function (a, b) { return b - a; })
            .forEach(function (n) { svc.sheets.deleteRow(tab, n); affected++; });
        } else {
          rows.forEach(function (r) {
            var row = applyWithdrawalToRow_(objectToRow_(RESPONSE_COLUMNS, r), req.requestId, now);
            svc.sheets.updateRow(tab, r.__row, row);
            affected++;
          });
        }
      });
      if (policy === 'delete') {
        rowsWhere_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, 'participantId', req.participantId).forEach(function (u) {
          if (u.rawFileId) svc.drive.trash(u.rawFileId);
          u.note = 'withdrawn-and-deleted ' + req.requestId;
          u.rawFileId = '';
          updateObject_(svc, TAB.UPLOADS, UPLOAD_COLUMNS, u);
        });
        rowsWhere_(svc, TAB.CONFLICTS, CONFLICT_COLUMNS, 'participantId', req.participantId).forEach(function (c) {
          if (c.rawFileId) svc.drive.trash(c.rawFileId);
          c.state = 'withdrawn-and-deleted';
          c.rawFileId = '';
          updateObject_(svc, TAB.CONFLICTS, CONFLICT_COLUMNS, c);
        });
      }
      req.state = 'processed';
      req.processedAt = now;
      req.policy = policy;
      req.rowsAffected = affected;
      updateObject_(svc, TAB.WITHDRAWALS, WITHDRAWAL_COLUMNS, req);
      report.push({ requestId: req.requestId, rowsAffected: affected, policy: policy });
    });
    svc.sheets.flush();
    return report;
  } finally {
    svc.lock.releaseLock();
  }
}

/** Registers a participant-safe release package after checking its digest. */
function registerPackage_(svc, text, expectedDigest) {
  var pkg = JSON.parse(text);
  var errors = validatePackageRecord_(pkg);
  if (errors.length) throw new Error('package rejected: ' + errors.join(', '));
  if (pkg.packageDigest !== expectedDigest) {
    throw new Error('package digest ' + pkg.packageDigest + ' does not match the expected ' + expectedDigest);
  }
  var compact = JSON.stringify(compactPackage_(pkg));
  if (compact.length > 9000) throw new Error('package too large for a script property (' + compact.length + ' chars)');
  svc.props.setProperty(packagePropertyKey_(pkg.packageDigest), compact);
  return { packageId: pkg.packageId, packageDigest: pkg.packageDigest, dataClass: pkg.dataClass, stimuli: pkg.stimuli.length };
}
