/**
 * COLLECTOR TESTS
 *
 * The Apps Script collector (../collector/*.gs) is loaded into a Node `vm`
 * context with in-memory fakes for the spreadsheet, Drive, the script lock and
 * Script Properties. The ingestion code under test is byte-for-byte the code
 * deployed to Apps Script; only the service adapters are replaced.
 *
 * What the fakes cannot prove — real Google quotas, real LockService contention,
 * real Sheets RAW semantics — is covered by the live acceptance run, not here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { RatingSession } from '../study/session.js';
import {
  COLLECTOR_DIR as COLLECTOR, fakeProps, fakeSheets, fakeDrive, fakeLock, loadCollector,
} from './helpers/collector-fakes.mjs';

const ROOT = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'study/stimuli/manifest.json'), 'utf8'));
const devPackage = JSON.parse(readFileSync(join(ROOT, 'study/release-package.json'), 'utf8'));

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let clock = Date.parse('2026-09-14T10:00:00.000Z');
function makeSvc(ctx, { accepting = 'true', policy = 'mark-ineligible' } = {}) {
  const props = fakeProps({ ACCEPTING_UPLOADS: accepting, WITHDRAWAL_POLICY: policy });
  const svc = {
    props,
    now: () => new Date(clock += 1000).toISOString(),
    uuid: () => randomUUID(),
    sha256Hex: sha256,
    lock: fakeLock(),
    sheets: fakeSheets(),
    drive: fakeDrive(),
  };
  ctx.registerPackage_(svc, JSON.stringify(devPackage), devPackage.packageDigest);
  return svc;
}

/** A real export produced by the instrument's own session code. */
function makeExport({ ratings = 3, comment = 'fine', withdraw = false, seed } = {}) {
  const s = RatingSession.create({ manifest, releasePackage: devPackage, ...(seed ? { participantId: seed } : {}) });
  s.acknowledge();
  for (let i = 0; i < ratings; i++) {
    const id = s.currentStimulusId;
    const item = manifest.items.find((x) => x.stimulusId === id);
    s.record(id, {
      order: 1 + (i % 7), appeal: 7 - (i % 7), comment: i === 0 ? comment : '',
      integrityOk: true, stimulusIntegrity: item.integrity, shownAt: new Date().toISOString(),
    });
  }
  if (withdraw) s.withdraw();
  return JSON.stringify(s.exportRecord(), null, 2);
}

const col = (ctx, name) => ctx.RESPONSE_COLUMNS.indexOf(name);
const GS_SOURCE_ALL = () => ['Code.gs', 'Config.gs', 'Services.gs', 'Store.gs', 'Validate.gs']
  .map((f) => readFileSync(join(COLLECTOR, f), 'utf8')).join('\n');

/* ---------------------------------------------------------------------------
 * validation
 * ------------------------------------------------------------------------ */

test('COLLECTOR: a real instrument export validates against its registered package', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const v = ctx.validateExport_(makeExport(), (d) => ctx.lookupPackage_(svc.props, d));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('COLLECTOR: invalid files are rejected with specific reasons and nothing is stored', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const good = JSON.parse(makeExport());
  const cases = [
    ['not json', '{nope', 'not-json'],
    ['empty', '', 'empty'],
    ['array', '[]', 'not-object'],
    ['unregistered package', { ...good, releasePackageDigest: 'f'.repeat(64) }, 'package-not-registered'],
    ['missing digest', { ...good, releasePackageDigest: null }, 'package-digest-missing'],
    ['package id swapped', { ...good, releasePackageId: 'dev-pilot-9-0000000000000000' }, 'package-id-mismatch'],
    ['claims study data', { ...good, dataClass: 'study-data' }, 'data-class-mismatch'],
    ['claims transmitted', { ...good, transmitted: true }, 'transmitted-flag'],
    ['bad study code', { ...good, participantId: 'alice@example.com' }, 'participant-id'],
    ['rating out of range', { ...good, responses: [{ ...good.responses[0], perceivedOrder: 9 }, ...good.responses.slice(1)] }, 'response[0]:perceived-order'],
    ['layout swapped', { ...good, responses: [{ ...good.responses[0], stimulusIntegrity: '00000000' }, ...good.responses.slice(1)] }, 'response[0]:layout-identity-mismatch'],
    ['foreign stimulus', { ...good, responses: [{ ...good.responses[0], stimulusId: 'stim-00000000' }, ...good.responses.slice(1)] }, 'response[0]:stimulus-not-in-order'],
    ['index tampered', { ...good, responses: [{ ...good.responses[0], presentationIndex: 5 }, ...good.responses.slice(1)] }, 'response[0]:presentation-index'],
    ['order truncated', { ...good, order: good.order.slice(1) }, 'order-not-package-layouts'],
    ['count wrong', { ...good, responseCount: 99 }, 'response-count'],
    ['withdrawn but eligible', { ...good, withdrawn: true, status: 'withdrawn', withdrawnAt: good.startedAt }, 'response[0]:withdrawn-but-eligible'],
    ['duplicate response', { ...good, responses: [good.responses[0], good.responses[0]], responseCount: 2 }, 'response[1]:duplicate-stimulus'],
  ];
  for (const [label, input, code] of cases) {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const r = ctx.ingestExport_(svc, text);
    assert.equal(r.status, 'rejected', label);
    assert.ok(r.errors.includes(code), `${label}: expected ${code}, got ${r.errors}`);
  }
  assert.equal(svc.drive.files.size, 0, 'a rejected file is never stored');
  assert.equal(svc.sheets.rows('RehearsalResponses').length, 0);
  assert.equal(svc.sheets.rows('Responses').length, 0);
  assert.equal(svc.sheets.rows('Rejections').length, cases.length, 'every rejection is logged, by hash only');
  for (const row of svc.sheets.rows('Rejections')) assert.equal(row.length, 4, 'rejection log holds no file content');
});

test('COLLECTOR: a package carrying researcher fields cannot be registered', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const tainted = { ...devPackage, stimuli: devPackage.stimuli.map((s) => ({ ...s, condition: 'strict-grid' })) };
  assert.throws(() => ctx.registerPackage_(svc, JSON.stringify(tainted), devPackage.packageDigest), /researcher-field:condition/);
  assert.throws(() => ctx.registerPackage_(svc, JSON.stringify(devPackage), 'a'.repeat(64)), /does not match the expected/);
});

/* ---------------------------------------------------------------------------
 * storage, receipt and idempotency
 * ------------------------------------------------------------------------ */

test('COLLECTOR: a valid upload is stored privately, normalised, verified, then reported received', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const text = makeExport({ ratings: 4 });
  const rec = JSON.parse(text);
  const r = ctx.ingestExport_(svc, text, sha256(text));

  assert.equal(r.status, 'received');
  assert.equal(r.uploadSha256, sha256(text));
  assert.equal(r.uploadId, `u-${sha256(text).slice(0, 32)}`);
  assert.equal(r.responseCount, 4);
  assert.equal(r.dataClass, 'development-rehearsal');

  const raw = svc.drive.live('raw');
  assert.equal(raw.length, 1);
  assert.equal(raw[0].text, text, 'the original is preserved byte for byte');

  const rows = svc.sheets.rows('RehearsalResponses');
  assert.equal(rows.length, 4, 'rehearsal data goes to its own tab');
  assert.equal(svc.sheets.rows('Responses').length, 0, 'and never into the study tab');
  const byStim = Object.fromEntries(rows.map((row) => [row[col(ctx, 'stimulusId')], row]));
  for (const resp of rec.responses) {
    const row = byStim[resp.stimulusId];
    assert.equal(row[col(ctx, 'participantId')], rec.participantId);
    assert.equal(row[col(ctx, 'releasePackageDigest')], rec.releasePackageDigest);
    assert.equal(row[col(ctx, 'instructionsVersion')], rec.instructionsVersion);
    assert.equal(row[col(ctx, 'perceivedOrder')], resp.perceivedOrder);
    assert.equal(row[col(ctx, 'appeal')], resp.appeal);
    assert.equal(row[col(ctx, 'presentationIndex')], resp.presentationIndex);
    assert.equal(row[col(ctx, 'shownAt')], resp.shownAt);
    assert.equal(row[col(ctx, 'respondedAt')], resp.respondedAt);
    assert.equal(row[col(ctx, 'stimulusIntegrity')], resp.stimulusIntegrity);
    assert.equal(row[col(ctx, 'withdrawn')], false);
    assert.equal(row[col(ctx, 'analysisEligible.ratingOnly')], resp.analysisEligible.ratingOnly);
    assert.equal(row[col(ctx, 'uploadId')], r.uploadId);
    assert.equal(row[col(ctx, 'serverReceivedAt')], r.serverReceivedAt);
  }
  const ledger = svc.sheets.rows('Uploads');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0][ctx.UPLOAD_COLUMNS.indexOf('state')], 'complete');
  assert.equal(svc.lock.waits, svc.lock.releases, 'the lock is always released');
});

test('COLLECTOR: the sheet holds no name or email column', () => {
  const ctx = loadCollector();
  for (const c of [...ctx.RESPONSE_COLUMNS, ...ctx.UPLOAD_COLUMNS, ...ctx.WITHDRAWAL_COLUMNS, ...ctx.CONFLICT_COLUMNS]) {
    assert.ok(!/name|email|mail|phone|ip(address)?$|userAgent/i.test(c), `identifying column: ${c}`);
  }
});

test('COLLECTOR: repeated uploads of the same file are idempotent', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const text = makeExport({ ratings: 3 });
  const first = ctx.ingestExport_(svc, text);
  const second = ctx.ingestExport_(svc, text);
  const third = ctx.ingestExport_(svc, text);
  assert.equal(first.status, 'received');
  for (const again of [second, third]) {
    assert.equal(again.status, 'received');
    assert.equal(again.duplicate, true);
    assert.equal(again.uploadId, first.uploadId);
    assert.equal(again.serverReceivedAt, first.serverReceivedAt, 'receipt time is the first receipt');
  }
  assert.equal(svc.sheets.rows('RehearsalResponses').length, 3);
  assert.equal(svc.drive.live('raw').length, 1);
  assert.equal(svc.sheets.rows('Uploads').length, 1);
});

test('COLLECTOR: a conflicting upload never overwrites or merges into earlier responses', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const s = RatingSession.create({ manifest, releasePackage: devPackage });
  s.acknowledge();
  const rate = (o) => {
    const id = s.currentStimulusId;
    s.record(id, { order: o, appeal: o, integrityOk: true, stimulusIntegrity: manifest.items.find((x) => x.stimulusId === id).integrity });
  };
  rate(2); rate(3);
  const early = JSON.stringify(s.exportRecord());
  rate(4);
  const later = JSON.stringify(s.exportRecord());   // same study code, different file

  assert.equal(ctx.ingestExport_(svc, early).status, 'received');
  const before = JSON.stringify(svc.sheets.rows('RehearsalResponses'));

  const c1 = ctx.ingestExport_(svc, later);
  assert.equal(c1.status, 'held-for-review');
  assert.equal(JSON.stringify(svc.sheets.rows('RehearsalResponses')), before, 'earlier rows untouched');
  assert.equal(svc.drive.live('conflicts').length, 1, 'the conflicting original is preserved privately');
  assert.equal(svc.drive.live('conflicts')[0].text, later);

  const c2 = ctx.ingestExport_(svc, later);
  assert.equal(c2.status, 'held-for-review');
  assert.equal(c2.duplicate, true);
  assert.equal(svc.drive.live('conflicts').length, 1);
  assert.equal(svc.sheets.rows('Conflicts').length, 1);
  assert.equal(JSON.stringify(svc.sheets.rows('RehearsalResponses')), before);
});

/* ---------------------------------------------------------------------------
 * interrupted submissions
 * ------------------------------------------------------------------------ */

test('INTERRUPT: a failure before the original is stored is not received, and a retry completes once', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const text = makeExport({ ratings: 3 });
  svc.drive.faults.createFailOnce = true;
  const r1 = ctx.ingestExport_(svc, text);
  assert.equal(r1.status, 'not-received');
  assert.equal(r1.retryable, true);
  assert.equal(svc.sheets.rows('RehearsalResponses').length, 0);
  const r2 = ctx.ingestExport_(svc, text);
  assert.equal(r2.status, 'received');
  assert.equal(svc.drive.live('raw').length, 1);
  assert.equal(svc.sheets.rows('RehearsalResponses').length, 3);
  assert.equal(svc.sheets.rows('Uploads')[0][ctx.UPLOAD_COLUMNS.indexOf('attempts')], 2);
});

test('INTERRUPT: a partial row write is resumed without duplicating rows', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const text = makeExport({ ratings: 6 });
  svc.sheets.faults.appendFailAfter = 2;   // 2 of 6 rows land, then the write dies
  const r1 = ctx.ingestExport_(svc, text);
  assert.equal(r1.status, 'not-received');
  assert.equal(svc.sheets.rows('RehearsalResponses').length, 2, 'precondition: a genuinely partial write');
  const r2 = ctx.ingestExport_(svc, text);
  assert.equal(r2.status, 'received');
  const ids = svc.sheets.rows('RehearsalResponses').map((row) => row[col(ctx, 'stimulusId')]);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, 'no stimulus written twice');
  assert.equal(svc.drive.live('raw').length, 1);
});

test('INTERRUPT: a failure recording completion is not received, and the retry confirms', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const text = makeExport({ ratings: 2 });
  const stateIdx = ctx.UPLOAD_COLUMNS.indexOf('state');
  svc.sheets.faults.updateFailOnce = (tab, row) => tab === 'Uploads' && row[stateIdx] === 'complete';
  const r1 = ctx.ingestExport_(svc, text);
  assert.equal(r1.status, 'not-received', 'rows written but completion unrecorded is NOT a receipt');
  const r2 = ctx.ingestExport_(svc, text);
  assert.equal(r2.status, 'received');
  assert.equal(svc.sheets.rows('RehearsalResponses').length, 2);
});

test('INTERRUPT: rows that do not read back exactly are never reported received', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  svc.sheets.faults.corruptAppend = { tab: 'RehearsalResponses', col: col(ctx, 'comment') };
  const r = ctx.ingestExport_(svc, makeExport({ ratings: 2, comment: 'looks balanced' }));
  assert.equal(r.status, 'not-received');
  assert.equal(r.reason, 'verification-failed');
  assert.notEqual(svc.sheets.rows('Uploads')[0][ctx.UPLOAD_COLUMNS.indexOf('state')], 'complete');
});

test('INTERRUPT: transfer damage is detected before anything is stored', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const text = makeExport();
  const r = ctx.ingestExport_(svc, text, sha256(`${text} `));
  assert.equal(r.status, 'not-received');
  assert.equal(r.reason, 'transfer-damaged');
  assert.equal(svc.drive.files.size, 0);
});

test('LOCK: a busy lock stores nothing and reports a retryable non-receipt', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  svc.lock.held = true;
  const r = ctx.ingestExport_(svc, makeExport());
  assert.equal(r.status, 'not-received');
  assert.equal(r.reason, 'busy');
  assert.equal(svc.drive.files.size, 0);
  assert.equal(svc.sheets.tabs.size, 0, 'nothing touched without the lock');
});

test('CLOSED: uploads are refused unless explicitly opened', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx, { accepting: 'false' });
  assert.equal(ctx.ingestExport_(svc, makeExport()).status, 'closed');
  assert.equal(svc.drive.files.size, 0);
});

/* ---------------------------------------------------------------------------
 * participant text is literal
 * ------------------------------------------------------------------------ */

test('LITERAL: formula-like participant text is stored as typed', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  for (const comment of ['=IMPORTXML("http://x","//a")', '+1', '-2+3', '@SUM(A1)', "'quoted", '=HYPERLINK("x")']) {
    const text = makeExport({ ratings: 1, comment });
    assert.equal(ctx.ingestExport_(svc, text).status, 'received', comment);
    const row = svc.sheets.rows('RehearsalResponses').find((r) => r[col(ctx, 'uploadId')] === `u-${sha256(text).slice(0, 32)}`);
    assert.equal(row[col(ctx, 'comment')], comment);
  }
});

test('LITERAL: the real Sheets adapter writes with valueInputOption RAW, never USER_ENTERED', () => {
  const calls = [];
  const store = new Map();
  const evaluate = (v, opt) => (opt !== 'RAW' && typeof v === 'string' && /^[=+\-@]/.test(v) ? '#EVALUATED' : v);
  const Sheets = {
    Spreadsheets: {
      Values: {
        get: (id, range) => ({ values: store.get(range) }),
        append: (body, id, range, opts) => { calls.push({ op: 'append', opts }); store.set('appended', body.values.map((r) => r.map((v) => evaluate(v, opts.valueInputOption)))); },
        update: (body, id, range, opts) => { calls.push({ op: 'update', opts }); store.set(range, body.values.map((r) => r.map((v) => evaluate(v, opts.valueInputOption)))); },
      },
    },
  };
  const SpreadsheetApp = {
    openById: () => ({ getSheetByName: () => ({ setFrozenRows() {} }), insertSheet: () => ({ setFrozenRows() {} }) }),
    flush() {},
  };
  const ctx = loadCollector({ Sheets, SpreadsheetApp });
  const adapter = ctx.sheetsAdapter_('sheet-id');
  adapter.ensureTab('RehearsalResponses', ['a', 'b']);
  adapter.append('RehearsalResponses', [['=1+1', '+SUM(A1)']]);
  adapter.updateRow('RehearsalResponses', 2, ['=HYPERLINK("x")', 'ok']);
  assert.ok(calls.length >= 3);
  for (const c of calls) assert.equal(c.opts.valueInputOption, 'RAW', `${c.op} must be RAW`);
  assert.deepEqual(store.get('appended'), [['=1+1', '+SUM(A1)']], 'stored literally');
  // The same fake with USER_ENTERED evaluates, so the assertion above is not vacuous.
  assert.equal(evaluate('=1+1', 'USER_ENTERED'), '#EVALUATED');
});

/* ---------------------------------------------------------------------------
 * withdrawal after upload
 * ------------------------------------------------------------------------ */

test('WITHDRAW: a request is recorded idempotently and reveals nothing about uploads', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  assert.equal(ctx.recordWithdrawalRequest_(svc, 'not-a-code').status, 'invalid-code');
  const unknown = ctx.recordWithdrawalRequest_(svc, 'p-0000000000000000');
  const text = makeExport();
  ctx.ingestExport_(svc, text);
  const known = ctx.recordWithdrawalRequest_(svc, JSON.parse(text).participantId);
  assert.equal(unknown.status, 'withdrawal-recorded');
  assert.equal(known.status, 'withdrawal-recorded');
  assert.deepEqual(Object.keys(unknown).sort(), Object.keys(known).sort(),
    'the receipt has the same shape whether or not the code exists');
  const again = ctx.recordWithdrawalRequest_(svc, JSON.parse(text).participantId);
  assert.equal(again.requestId, known.requestId);
  assert.equal(again.duplicate, true);
  assert.equal(svc.sheets.rows('WithdrawalRequests').length, 2);
});

test('WITHDRAW: mark-ineligible keeps rows for audit and excludes them from every analysis', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx, { policy: 'mark-ineligible' });
  const text = makeExport({ ratings: 3 });
  const pid = JSON.parse(text).participantId;
  ctx.ingestExport_(svc, text);
  const other = makeExport({ ratings: 2 });
  ctx.ingestExport_(svc, other);
  ctx.recordWithdrawalRequest_(svc, pid);
  const report = ctx.processWithdrawals_(svc);
  assert.equal(report[0].rowsAffected, 3);
  for (const row of svc.sheets.rows('RehearsalResponses')) {
    const mine = row[col(ctx, 'participantId')] === pid;
    assert.equal(row[col(ctx, 'analysisEligible.ratingOnly')], mine ? false : true);
    assert.equal(row[col(ctx, 'exclusionRule')], mine ? 'X4-withdrawn-after-upload' : '');
  }
  assert.equal(svc.drive.live('raw').length, 2, 'originals retained under this policy');
  assert.equal(ctx.processWithdrawals_(svc).length, 0, 'processing is idempotent');
});

test('WITHDRAW: delete removes rows and originals, and a re-upload is not stored again', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx, { policy: 'delete' });
  const text = makeExport({ ratings: 3 });
  const pid = JSON.parse(text).participantId;
  ctx.ingestExport_(svc, text);
  ctx.recordWithdrawalRequest_(svc, pid);
  ctx.processWithdrawals_(svc);
  assert.equal(svc.sheets.rows('RehearsalResponses').length, 0);
  assert.equal(svc.drive.live('raw').length, 0);
  const again = ctx.ingestExport_(svc, text);
  assert.equal(again.status, 'withdrawn');
  assert.equal(svc.sheets.rows('RehearsalResponses').length, 0);
  assert.equal(svc.drive.live('raw').length, 0);
});

test('WITHDRAW: a request made before the file arrives applies to the later upload', () => {
  const ctx = loadCollector();
  const svc = makeSvc(ctx);
  const text = makeExport({ ratings: 2 });
  ctx.recordWithdrawalRequest_(svc, JSON.parse(text).participantId);
  assert.equal(ctx.ingestExport_(svc, text).status, 'received');
  for (const row of svc.sheets.rows('RehearsalResponses')) {
    assert.equal(row[col(ctx, 'exclusionRule')], 'X4-withdrawn-after-upload');
    assert.equal(row[col(ctx, 'analysisEligible.ratingOnly')], false);
  }
});

/* ---------------------------------------------------------------------------
 * public surface
 * ------------------------------------------------------------------------ */

test('SURFACE: the only public functions are the upload page, upload, withdrawal request and page config', () => {
  const ctx = loadCollector();
  const fns = Object.keys(ctx).filter((k) => typeof ctx[k] === 'function' && /^[a-z]/.test(k) && !k.endsWith('_'));
  const publicFns = fns.filter((k) => !k.startsWith('operator')).sort();
  assert.deepEqual(publicFns, ['doGet', 'getPageConfig', 'requestWithdrawal', 'submitExport']);
  assert.equal(typeof ctx.doPost, 'undefined', 'no POST endpoint');
  const code = readFileSync(join(COLLECTOR, 'Code.gs'), 'utf8');
  for (const op of fns.filter((k) => k.startsWith('operator') && k !== 'operatorSetup')) {
    const body = code.slice(code.indexOf(`function ${op}(`));
    const fnBody = body.slice(0, body.indexOf('\n}\n'));
    assert.ok(fnBody.includes('requireOwner_()'), `${op} must require the owner`);
  }
});

test('SURFACE: operator functions refuse an anonymous web-app visitor', () => {
  const props = fakeProps({ OWNER_EMAIL: 'researcher@example.org' });
  const ctx = loadCollector({
    PropertiesService: { getScriptProperties: () => props },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
  });
  for (const op of ['operatorRegisterPackage', 'operatorOpenUploads', 'operatorCloseUploads', 'operatorProcessWithdrawals', 'operatorStatus', 'operatorSetup']) {
    assert.throws(() => ctx[op](), /restricted to the configured owner|run operatorSetup from the editor/, op);
  }
  assert.equal(props.getProperty('ACCEPTING_UPLOADS'), null, 'an anonymous caller cannot open uploads');
});

test('SURFACE: getPageConfig exposes no identifiers, rows or packages', () => {
  const props = fakeProps({ OWNER_EMAIL: 'researcher@example.org', SHEET_ID: 'secret-sheet', RAW_FOLDER_ID: 'secret-folder', ACCEPTING_UPLOADS: 'true', PACKAGE_abc: '{}' });
  const ctx = loadCollector({ PropertiesService: { getScriptProperties: () => props } });
  const cfg = JSON.stringify(ctx.getPageConfig());
  for (const secret of ['secret-sheet', 'secret-folder', 'researcher@example.org', 'PACKAGE_']) {
    assert.ok(!cfg.includes(secret), `page config leaks ${secret}`);
  }
});

test('PAGE: the upload page reports "Received" only for a matching server receipt', () => {
  const html = readFileSync(join(COLLECTOR, 'Upload.html'), 'utf8');
  assert.ok(html.includes("r.status === 'received' && r.uploadSha256 === selected.sha"));
  assert.ok(html.includes('Until this page confirms receipt, nothing has been received'));
  assert.ok(html.includes('does not remove a file you have already sent'),
    'erasing browser storage must not be described as withdrawing a returned file');
  assert.ok(html.includes('we cannot promise that sending the file is'));
  assert.ok(!/innerHTML\s*=/.test(html), 'participant-controlled text is never injected as HTML');
  assert.ok(!/type="email"|name="email"|placeholder="[^"]*name/i.test(html), 'no name or email field');
});

test('SCOPES: the collector never uses DriveApp, which would need access to the whole Drive', () => {
  // Code only: comments are allowed to explain why DriveApp is not used.
  const src = GS_SOURCE_ALL().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bDriveApp\./.test(src), 'DriveApp requires the full drive scope');
  const manifest = JSON.parse(readFileSync(join(COLLECTOR, 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes.sort(), [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
  ]);
  assert.ok(manifest.dependencies.enabledAdvancedServices.some((s) => s.serviceId === 'drive' && s.version === 'v3'));
});

test('SCOPES: the Drive adapter creates, finds, reads and trashes through the Drive API', () => {
  const files = new Map();
  let n = 0;
  const Drive = {
    Files: {
      list: ({ q }) => {
        const name = /name = '([^']*)'/.exec(q)[1];
        const parent = /'([^']*)' in parents/.exec(q)[1];
        return { files: [...files.entries()].filter(([, f]) => f.name === name && f.parent === parent && !f.trashed).map(([id]) => ({ id })) };
      },
      create: (meta, blob) => { const id = `d${++n}`; files.set(id, { name: meta.name, parent: meta.parents?.[0] ?? 'root', text: blob ? blob.text : null, trashed: false }); return { id }; },
      update: (patch, id) => { Object.assign(files.get(id), patch); return { id }; },
    },
  };
  const Utilities = { newBlob: (text) => ({ text }) };
  const ScriptApp = { getOAuthToken: () => 'token' };
  const UrlFetchApp = {
    fetch: (url, opts) => {
      assert.equal(opts.headers.Authorization, 'Bearer token');
      const id = decodeURIComponent(/files\/([^?]+)/.exec(url)[1]);
      return { getResponseCode: () => 200, getBlob: () => ({ getDataAsString: () => files.get(id).text }) };
    },
  };
  const ctx = loadCollector({ Drive, Utilities, ScriptApp, UrlFetchApp });
  const root = ctx.driveCreateFolder_('ORDER rating uploads (PRIVATE)', null);
  const drive = ctx.driveAdapter_(root);
  assert.equal(drive.findByName('raw', "u-1.json"), null);
  const id = drive.create('raw', 'u-1.json', '{"a":"=1"}');
  assert.equal(JSON.stringify(drive.findByName('raw', 'u-1.json')), JSON.stringify({ id }));
  assert.equal(drive.readText(id), '{"a":"=1"}');
  drive.trash(id);
  assert.equal(drive.findByName('raw', 'u-1.json'), null);
  assert.equal([...files.values()].filter((f) => f.name === 'raw').length, 1, 'area folder created once and reused');
  assert.equal(ctx.driveQuote_("it's"), String.raw`'it\'s'`, 'a quote in a name cannot break out of the Drive query');
});
