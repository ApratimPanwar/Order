/**
 * DEPLOYMENT PREPARATION TESTS
 *
 * These cover the requirements that only matter once the instrument is served
 * from a real host rather than a local directory:
 *
 *   - the participant-facing wording is inside the frozen identity;
 *   - a participant release cannot be produced by renaming a development one;
 *   - the startup environment gate refuses to record in a browser that cannot
 *     persist data or grant a lock;
 *   - the deployable artifact is servable under a repository subpath and
 *     carries no researcher-side material;
 *   - the completion page states the three required facts and invents no
 *     return destination.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { RatingSession } from '../study/session.js';
import { probeStorage, probeLocks, probeEnvironment } from '../study/persistence.js';

const ROOT = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const manifest = JSON.parse(read('study/stimuli/manifest.json'));
const publicPkg = JSON.parse(read('study/release-package.json'));
const privatePkg = JSON.parse(read('study-private/release-package.json'));

/* ---------------------------------------------------------------------------
 * 1. THE PARTICIPANT WORDING IS INSIDE THE FROZEN IDENTITY
 * ------------------------------------------------------------------------ */

test('DEPLOY: study/index.html is a release-package digest input', () => {
  const entry = privatePkg.sources.find((s) => s.path === 'study/index.html');
  assert.ok(entry, 'study/index.html must be a digest input: it carries the interface '
    + 'and every word a participant reads');
  assert.equal(entry.sha256, sha256(readFileSync(join(ROOT, 'study/index.html'))),
    'the recorded digest must match the file on disk');
  assert.ok(privatePkg.components.includes(`study/index.html:${entry.sha256}`),
    'the index.html digest must take part in the package digest');
});

test('DEPLOY: changing the participant wording changes the package digest', () => {
  // Recompute the package digest with one byte of index.html altered. If the
  // wording were outside the digest this would be unchanged.
  const altered = privatePkg.components.map((c) => (c.startsWith('study/index.html:')
    ? 'study/index.html:0000000000000000000000000000000000000000000000000000000000000000'
    : c)).sort();
  assert.notEqual(sha256(altered.join('\n')), privatePkg.packageDigest);
});

test('DEPLOY: release mode and return channel take part in the identity', () => {
  assert.ok(privatePkg.components.some((c) => c.startsWith('release-mode:')),
    'a rehearsal and a real release of identical bytes must not share an identity');
  assert.ok(privatePkg.components.some((c) => c.startsWith('return-channel:')),
    'changing where participants are told to send the file must change the identity');
});

test('DEPLOY: optional consent/protocol assets are digest inputs the moment they exist', () => {
  const src = read('scripts/build-release-package.mjs');
  for (const asset of ['study/consent.html', 'study/participant-information.html',
    'study/protocol.json', 'study/debrief.html']) {
    assert.ok(src.includes(asset), `${asset} must be picked up automatically if introduced`);
  }
  // Anything already present must already be recorded.
  for (const asset of ['study/consent.html', 'study/participant-information.html',
    'study/protocol.json', 'study/debrief.html']) {
    if (existsSync(join(ROOT, asset))) {
      assert.ok(privatePkg.sources.some((s) => s.path === asset), `${asset} exists but is not in the package`);
    }
  }
});

/* ---------------------------------------------------------------------------
 * 2. A PARTICIPANT RELEASE CANNOT BE A RENAMED DEVELOPMENT RELEASE
 * ------------------------------------------------------------------------ */

const runBuilder = (args) => {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts/build-release-package.mjs'), ...args],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
};

test('DEPLOY: a participant package is refused without a recorded approval', () => {
  const approvalPath = join(ROOT, 'study-private', 'approvals.json');
  assert.ok(!existsSync(approvalPath),
    'no approval record should exist: none has been given');
  const res = runBuilder(['--label', 'should-not-build', '--mode', 'participant']);
  assert.equal(res.code, 2);
  assert.match(res.err, /REFUSING to build a participant release/);
  assert.match(res.err, /approvals\.json does not exist/);
  assert.ok(!existsSync(approvalPath), 'the builder must not create its own approval');
});

test('DEPLOY: an incomplete approval record is refused item by item', () => {
  const approvalPath = join(ROOT, 'study-private', 'approvals.json');
  assert.ok(!existsSync(approvalPath), 'precondition: no real approval record');
  const incomplete = {
    approvalFormat: 'investigator-approval-1',
    approvedBy: 'test-fixture',
    specFreezeId: 'test-freeze',
    ethicsReviewStatus: 'fixture',
    // S1..S10 decided, S11..S21 left pending
    s1_s21: Object.fromEntries(Array.from({ length: 21 }, (_, i) =>
      [`S${i + 1}`, i < 10 ? 'accept' : 'pending'])),
    protocolApproved: true,
    participantWordingApproved: false,
    collectionProcedureApproved: true,
    returnChannel: null,
  };
  try {
    writeFileSync(approvalPath, JSON.stringify(incomplete, null, 2));
    const res = runBuilder(['--label', 'should-not-build', '--mode', 'participant']);
    assert.equal(res.code, 2);
    assert.match(res.err, /unresolved decisions: S11, S12/);
    assert.match(res.err, /participantWordingApproved is not true/);
    assert.match(res.err, /returnChannel must name a kind/);
  } finally {
    rmSync(approvalPath, { force: true });
  }
  assert.ok(!existsSync(approvalPath), 'fixture approval must be removed');
});

test('DEPLOY: the shipped package is a development package and says so', () => {
  assert.equal(publicPkg.releaseMode, 'development');
  assert.equal(publicPkg.dataClass, 'development-rehearsal');
  assert.equal(publicPkg.returnChannel, null);
  assert.match(publicPkg.approval, /NOT APPROVED/);
  assert.match(publicPkg.approval, /development-rehearsal/);
});

/* ---------------------------------------------------------------------------
 * 3. REHEARSAL OUTPUT IS LABELLED AS SUCH
 * ------------------------------------------------------------------------ */

test('DEPLOY: an export made against a development package is marked rehearsal data', () => {
  const s = RatingSession.create({ manifest, releasePackage: publicPkg });
  s.acknowledge();
  s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  const rec = s.exportRecord();
  assert.equal(rec.releaseMode, 'development');
  assert.equal(rec.dataClass, 'development-rehearsal');
  assert.equal(rec.collection.returnChannel, null);
});

test('DEPLOY: an unrecognised release mode falls back to development, never to study data', () => {
  for (const mode of ['participant-ish', 'PARTICIPANT', '', null, undefined, 0, {}]) {
    const s = RatingSession.create({ manifest, releasePackage: { ...publicPkg, releaseMode: mode } });
    assert.equal(s.state.dataClass, 'development-rehearsal', `mode ${JSON.stringify(mode)}`);
  }
});

test('DEPLOY: only an explicit participant package yields study data', () => {
  const s = RatingSession.create({
    manifest,
    releasePackage: { ...publicPkg, releaseMode: 'participant', returnChannel: { kind: 'x', instructions: 'y' } },
  });
  assert.equal(s.state.dataClass, 'study-data');
  assert.deepEqual(s.exportRecord().collection.returnChannel, { kind: 'x', instructions: 'y' });
});

/* ---------------------------------------------------------------------------
 * 4. THE STARTUP ENVIRONMENT GATE
 * ------------------------------------------------------------------------ */

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

test('GATE: a working storage passes the round-trip probe', () => {
  assert.equal(probeStorage(memStorage()).ok, true);
});

test('GATE: storage that throws, ignores writes, or ignores removal fails', () => {
  assert.deepEqual(probeStorage(null), { ok: false, reason: 'no-storage-object' });

  const throwing = { getItem: () => null, setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }, removeItem: () => {} };
  const t = probeStorage(throwing);
  assert.equal(t.ok, false);
  assert.equal(t.reason, 'threw');
  assert.match(t.detail, /QuotaExceededError/);

  const amnesiac = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  assert.equal(probeStorage(amnesiac).reason, 'value-did-not-round-trip');

  const sticky = { getItem: () => 'stale', setItem: () => {}, removeItem: () => {} };
  assert.equal(probeStorage(sticky).reason, 'value-did-not-round-trip');

  const m = new Map();
  const unremovable = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: () => {},
  };
  assert.equal(probeStorage(unremovable).reason, 'removal-ignored');
});

test('GATE: the Web Locks probe requires a lock to actually be granted', async () => {
  const real = { request: async (_n, _o, fn) => fn() };
  assert.equal((await probeLocks(real)).ok, true);

  assert.equal((await probeLocks(undefined)).reason, 'api-absent');
  assert.equal((await probeLocks({})).reason, 'api-absent');
  assert.equal((await probeLocks({ request: 'not-a-function' })).reason, 'api-absent');

  const neverRuns = { request: async () => undefined };
  assert.equal((await probeLocks(neverRuns)).reason, 'callback-never-ran');

  const throws = { request: async () => { const e = new Error('no'); e.name = 'SecurityError'; throw e; } };
  const th = await probeLocks(throws);
  assert.equal(th.reason, 'threw');
  assert.match(th.detail, /SecurityError/);

  const hangs = { request: () => new Promise(() => {}) };
  assert.equal((await probeLocks(hangs, { timeoutMs: 30 })).reason, 'timed-out');
});

test('GATE: both mechanisms are required together', async () => {
  const ok = { storage: memStorage(), locks: { request: async (_n, _o, fn) => fn() } };
  assert.equal((await probeEnvironment(ok)).ok, true);

  const noLocks = await probeEnvironment({ storage: memStorage(), locks: null });
  assert.equal(noLocks.ok, false);
  assert.deepEqual(noLocks.missing, ['webLocks']);

  const noStorage = await probeEnvironment({ storage: null, locks: ok.locks });
  assert.equal(noStorage.ok, false);
  assert.deepEqual(noStorage.missing, ['persistentStorage']);

  const neither = await probeEnvironment({ storage: null, locks: null });
  assert.deepEqual(neither.missing, ['persistentStorage', 'webLocks']);
});

test('GATE: the page refuses to start a session when the probe fails', () => {
  const html = read('study/index.html');
  const boot = html.slice(html.indexOf('const probe = await probeEnvironment'));
  const guard = boot.slice(0, boot.indexOf('try {'));
  assert.ok(guard.includes('reportUnsupported(probe)'), 'must show the unsupported panel');
  assert.ok(guard.includes('return;'), 'must return before any session or store is created');
  // The refusal happens before the session exists.
  assert.ok(html.indexOf('await probeEnvironment') < html.indexOf('RatingSession.create({ manifest'),
    'the probe must run before a session can be created');
  assert.ok(html.indexOf('await probeEnvironment') < html.indexOf('new SessionStore'),
    'the probe must run before the store is constructed');
});

/* ---------------------------------------------------------------------------
 * 5. THE COMPLETION PAGE STATES THE THREE REQUIRED FACTS
 * ------------------------------------------------------------------------ */

test('TRANSFER: the completion page states download, return, and that download is not submission', () => {
  const html = read('study/index.html');
  assert.ok(html.includes('Download the response file'), '(a) download');
  assert.ok(html.includes('Return the file through the channel below'), '(b) return via the approved channel');
  assert.ok(html.includes('Downloading alone does not submit anything'), '(c) download is not submission');
  assert.ok(html.includes('no one has received it'), 'must not imply receipt');
  assert.ok(html.includes('We cannot confirm receipt of a file we have not been sent'),
    'must not claim receipt');
});

test('TRANSFER: no return destination is invented anywhere in the participant bundle', () => {
  const bundle = ['index.html', 'session.js', 'persistence.js', 'render-layout.js']
    .map((f) => read(`study/${f}`)).join('\n');
  // No address, endpoint or upload target may be hard-coded.
  assert.ok(!/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i.test(bundle.replace(/@[a-z]/gi, '@ ')),
    'no email address may be hard-coded as a return destination');
  for (const term of ['mailto:', 'formspree', 'googleforms', 'docs.google.com',
    'dropbox.com', 'onedrive', 'wetransfer', 'XMLHttpRequest', 'navigator.sendBeacon']) {
    assert.ok(!bundle.includes(term), `${term} must not appear: nothing may be transmitted or invented`);
  }
  // The only fetches are for local bundle assets.
  const targets = [...read('study/index.html').matchAll(/fetch\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(targets.sort(), ['release-package.json', 'stimuli/manifest.json']);
});

test('TRANSFER: a null return channel is reported as a null return channel', () => {
  const html = read('study/index.html');
  assert.ok(html.includes('No return channel has been specified'));
  assert.ok(html.includes('Please do not send it anywhere'));
});

test('PRIVACY: hosting and transfer metadata are distinguished from what the app records', () => {
  const html = read('study/index.html');
  assert.ok(html.includes('What this application records'));
  assert.ok(html.includes('What this application cannot control'));
  assert.ok(html.includes('IP address'), 'the host log question must be stated, not avoided');
  assert.ok(html.includes('we cannot switch them off'));
  assert.ok(html.includes('cannot tell you that your visit is anonymous'));
  assert.ok(html.includes('that channel may attach identifying information'));
  // The forbidden reassurances.
  for (const claim of ['no IP addresses are logged', 'completely anonymous', 'fully anonymous',
    'no logs are kept', 'untraceable']) {
    assert.ok(!html.toLowerCase().includes(claim.toLowerCase()), `must not claim: ${claim}`);
  }
});

test('WITHDRAWAL: the page explains withdrawal before and after the file is returned', () => {
  const html = read('study/index.html');
  assert.ok(html.includes('Before you send the file back'));
  assert.ok(html.includes('After you have sent the file back'));
  assert.ok(html.includes('your study code is inside it'));
  assert.ok(html.includes('Your study code'), 'the code must be shown at the end');
  assert.ok(html.includes("$('studyCode').textContent = session.state.participantId"),
    'the code shown must be the real participant id');
  assert.ok(html.includes('nothing left to withdraw later'),
    'erasure must be stated as final');
  // How to ask must come from the approved channel, never from a guess.
  assert.ok(html.includes('withdrawalContact'), 'a contact route must be stated');
  assert.ok(html.includes('No contact route has been set up for this build'),
    'a build with no channel must say so rather than invent a contact');
  assert.ok(html.includes('ch && ch.contact'),
    'the contact must be read from the frozen release package');
});

/* ---------------------------------------------------------------------------
 * 6. THE DEPLOYABLE ARTIFACT
 * ------------------------------------------------------------------------ */

const audit = JSON.parse(read('results/participant-dist-audit.json'));

test('ARTIFACT: the audited bundle is clean and index.html is at its root', () => {
  assert.equal(audit.clean, true, `findings: ${JSON.stringify(audit.findings)}`);
  assert.ok(audit.files.includes('index.html'), 'index.html must be at the artifact root');
  assert.ok(audit.files.includes('.nojekyll'), 'Pages must not run Jekyll over the artifact');
  assert.ok(!audit.files.some((f) => f.includes('/') && f.split('/')[0] !== 'stimuli'),
    'the only subdirectory is stimuli/');
});

test('ARTIFACT: the bundle carries no researcher-side material', () => {
  for (const f of audit.files) {
    assert.ok(!/stimulus-key|study-private|approvals/i.test(f), `forbidden file: ${f}`);
  }
  const shipped = JSON.parse(read('dist/participant/release-package.json'));
  assert.equal(shipped.scoringKey, undefined, 'the key digest is researcher-side only');
  assert.equal(shipped.components, undefined);
  assert.equal(shipped.effectiveConfig, undefined);
});

test('ARTIFACT: the deployed package digest matches the frozen researcher-side record', () => {
  const shipped = JSON.parse(read('dist/participant/release-package.json'));
  assert.equal(shipped.packageDigest, privatePkg.packageDigest);
  assert.equal(audit.releasePackageDigest, privatePkg.packageDigest);
});

test('ARTIFACT: every served byte has a recorded digest for live-site verification', () => {
  assert.equal(Object.keys(audit.assetDigests).length, audit.files.length);
  for (const [f, d] of Object.entries(audit.assetDigests)) {
    assert.equal(d, sha256(readFileSync(join(ROOT, 'dist/participant', f))), `digest drifted: ${f}`);
  }
});

test('ARTIFACT: nothing resolves outside the artifact root', () => {
  const html = read('dist/participant/index.html');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(!m[1].startsWith('/'), `root-absolute URL breaks under a repo subpath: ${m[1]}`);
  }
  for (const m of html.matchAll(/^\s*import [\s\S]*?from '([^']+)';/gm)) {
    assert.ok(m[1].startsWith('./'), `import must be bundle-relative: ${m[1]}`);
  }
  assert.equal([...html.matchAll(/^\s*import [\s\S]*?from '([^']+)';/gm)].length, 3,
    'the bundle imports exactly session.js, persistence.js and render-layout.js');
});

/* ---------------------------------------------------------------------------
 * 7. THE DEPLOYMENT WORKFLOW
 * ------------------------------------------------------------------------ */

const WORKFLOW = '../.github/workflows/deploy-study-site.yml';

test('WORKFLOW: the Pages workflow exists and is manual only', () => {
  const yml = read(WORKFLOW);
  assert.ok(yml.includes('workflow_dispatch:'), 'must be manually dispatched');
  assert.ok(!/^on:[\s\S]*?^\s{2}push:/m.test(yml), 'must not deploy on ordinary pushes');
  assert.ok(!yml.includes('schedule:'), 'must not deploy on a schedule');
});

test('WORKFLOW: it uses a protected environment and least-privilege permissions', () => {
  const yml = read(WORKFLOW);
  assert.ok(yml.includes('environment:'));
  assert.ok(yml.includes('name: github-pages'));
  assert.ok(yml.includes('contents: read'));
  assert.ok(yml.includes('pages: write'));
  assert.ok(yml.includes('id-token: write'));
  assert.ok(!yml.includes('contents: write'), 'deployment must not need write access to the repository');
});

test('WORKFLOW: the runtime is pinned and the suite runs before publication', () => {
  const yml = read(WORKFLOW);
  assert.match(yml, /node-version: '\d+\.\d+\.\d+'/, 'Node must be pinned to an exact version');
  const testStep = yml.indexOf('npm test');
  const verifyStep = yml.indexOf('verify-specification.mjs');
  const deployStep = yml.indexOf('actions/deploy-pages');
  assert.ok(testStep > 0 && verifyStep > 0 && deployStep > 0);
  assert.ok(testStep < deployStep, 'tests must run before deployment');
  assert.ok(verifyStep < deployStep, 'the specification verifier must run before deployment');
});

test('WORKFLOW: it publishes the audited bundle and verifies the frozen package', () => {
  const yml = read(WORKFLOW);
  assert.ok(yml.includes('build-participant-dist.mjs'), 'the artifact must be the audited build');
  assert.ok(yml.includes('--expect-digest'), 'the frozen package digest must be asserted');
  assert.ok(yml.includes('research/dist/participant'), 'only the participant bundle is uploaded');
  assert.ok(!yml.includes('build-stimuli.mjs'), 'deployment must never regenerate stimuli');
  assert.ok(!yml.includes('build-release-package.mjs'), 'deployment must never mint a new package');
});

test('WORKFLOW: dispatch inputs never reach a shell through interpolation', () => {
  const yml = read(WORKFLOW);
  // An input interpolated into a run: body is a script-injection hole. Inputs
  // must arrive through env: instead.
  for (const line of yml.split(/\r?\n/)) {
    if (line.includes('${{ inputs.') && line.trim().startsWith('run:')) {
      assert.fail(`input interpolated into a run body: ${line.trim()}`);
    }
  }
  assert.ok(yml.includes('CONFIRM: ${{ inputs.confirm }}'));
  assert.ok(yml.includes('"$CONFIRM"'));
});

test('WORKFLOW: no researcher-side material is uploaded and no token reaches the browser', () => {
  const yml = read(WORKFLOW);
  for (const bad of ['study-private', 'results/', 'stimulus-key', 'approvals.json']) {
    assert.ok(!yml.includes(`path: research/${bad}`), `${bad} must not be uploaded`);
  }
  const bundle = read('dist/participant/index.html') + read('dist/participant/session.js');
  for (const secret of ['GITHUB_TOKEN', 'secrets.', 'Authorization:', 'api_key', 'apiKey']) {
    assert.ok(!bundle.includes(secret), `${secret} must never appear in browser JavaScript`);
  }
});

/* ---------------------------------------------------------------------------
 * 8. REHEARSAL DATA IS PARTITIONED OUT OF THE STUDY DATASET
 * ------------------------------------------------------------------------ */

test('REHEARSAL: a development export is excluded from the main study dataset', () => {
  const tmp = join(ROOT, 'results', `tmp-rehearsal-${process.pid}`);
  const exportPath = `${tmp}-export.json`;
  const outPath = `${tmp}-joined.json`;
  try {
    const s = RatingSession.create({ manifest, releasePackage: publicPkg });
    s.acknowledge();
    for (let i = 0; i < 3; i++) {
      const id = s.currentStimulusId;
      const item = manifest.items.find((x) => x.stimulusId === id);
      s.record(id, { order: 5, appeal: 4, integrityOk: true, stimulusIntegrity: item.integrity });
    }
    const rec = s.exportRecord();
    assert.equal(rec.dataClass, 'development-rehearsal');
    writeFileSync(exportPath, JSON.stringify(rec, null, 2));

    execFileSync(process.execPath,
      [join(ROOT, 'scripts/join-responses.mjs'), exportPath, '--out', outPath],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const joined = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(joined.dataset.partition, 'development-rehearsal');
    assert.equal(joined.dataset.includedInMainStudy, false);
    assert.match(joined.dataset.effect, /excluded from the main study dataset/i);
    assert.equal(joined.rows.length, 3);
    for (const r of joined.rows) {
      assert.equal(r.datasetPartition, 'development-rehearsal');
      assert.equal(r.mainStudyEligible, false, 'no rehearsal row may enter the study dataset');
      assert.equal(r.exclusionRule, 'X3-development-rehearsal');
    }
  } finally {
    for (const f of [exportPath, outPath, outPath.replace(/\.json$/, '.csv')]) rmSync(f, { force: true });
  }
});

test('REHEARSAL: an export with no declared data class is treated as rehearsal, not study data', () => {
  const tmp = join(ROOT, 'results', `tmp-undeclared-${process.pid}`);
  const exportPath = `${tmp}-export.json`;
  const outPath = `${tmp}-joined.json`;
  try {
    const s = RatingSession.create({ manifest, releasePackage: publicPkg });
    s.acknowledge();
    const id = s.currentStimulusId;
    const item = manifest.items.find((x) => x.stimulusId === id);
    s.record(id, { order: 6, appeal: 6, integrityOk: true, stimulusIntegrity: item.integrity });
    const rec = s.exportRecord();
    delete rec.dataClass;            // a file written before the field existed
    delete rec.releaseMode;
    writeFileSync(exportPath, JSON.stringify(rec, null, 2));

    execFileSync(process.execPath,
      [join(ROOT, 'scripts/join-responses.mjs'), exportPath, '--out', outPath],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const joined = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(joined.dataset.declaredDataClass, null);
    assert.equal(joined.dataset.partition, 'development-rehearsal');
    assert.equal(joined.dataset.includedInMainStudy, false);
  } finally {
    for (const f of [exportPath, outPath, outPath.replace(/\.json$/, '.csv')]) rmSync(f, { force: true });
  }
});

/* ---------------------------------------------------------------------------
 * 9. THE PACKAGE IDENTITY MUST NOT DEPEND ON THE PLATFORM
 * ------------------------------------------------------------------------ */

const CRLF = Buffer.from([13, 10]);

test('IDENTITY: no digested source carries CRLF line endings', () => {
  // The package digest is taken over the bytes on disk. With platform-dependent
  // line endings the same commit yields one identity on Windows and another on
  // a Linux runner, and the deployment workflow's --expect-digest assertion
  // fails for a reason unrelated to the content.
  for (const entry of privatePkg.sources) {
    const bytes = readFileSync(join(ROOT, entry.path));
    assert.ok(!bytes.includes(CRLF),
      `${entry.path} contains CRLF: the package identity would differ by platform`);
  }
  for (const f of Object.keys(audit.assetDigests).filter((x) => !x.endsWith('.json'))) {
    const bytes = readFileSync(join(ROOT, 'dist/participant', f));
    assert.ok(!bytes.includes(CRLF), `deployed ${f} contains CRLF`);
  }
});

test('IDENTITY: .gitattributes pins line endings for every file', () => {
  const attrs = readFileSync(join(ROOT, '..', '.gitattributes'), 'utf8');
  assert.match(attrs, /^\* text=auto eol=lf$/m,
    'every checkout must produce the same bytes the digest was computed over');
});
