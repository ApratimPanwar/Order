/**
 * Regression tests for the participant-release preparation pass.
 *   A. persistence and withdrawal      B. frozen identity binding
 *   plus the operational loose ends
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { RatingSession } from '../study/session.js';
import { SessionStore, STORAGE_KEY, TOMBSTONE_KEY, LEASE_TTL_MS } from '../study/persistence.js';

const ROOT = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'study/stimuli/manifest.json'), 'utf8'));
const releasePackage = JSON.parse(readFileSync(join(ROOT, 'study/release-package.json'), 'utf8'));
const byId = new Map(manifest.items.map((i) => [i.stimulusId, i]));

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    _map: m,
  };
}
const stored = (st) => JSON.parse(st.getItem(STORAGE_KEY));
const tmp = () => mkdtempSync(join(tmpdir(), 'order-rel-'));

async function seeded(st, participantId = 'p-t') {
  const store = new SessionStore({ storage: st, locks: null });
  store.claimLease();
  const s = RatingSession.create({ manifest, releasePackage, participantId });
  s.acknowledge();
  await s.commitTo(store);
  return store;
}

// ===========================================================================
// A. Persistence and withdrawal
// ===========================================================================

test('A: equal-revision interleaving does not lose a rating', async () => {
  const st = memStorage();
  const store = await seeded(st);
  // Two tabs load the SAME revision, then both commit.
  const a = RatingSession.load(st).session;
  const b = RatingSession.load(st).session;
  // Different stimuli, as the single-active-tab policy would normally ensure.
  a.record(a.currentStimulusId, { order: 7, appeal: 1, integrityOk: true });
  b.state.index = 1;
  b.record(b.currentStimulusId, { order: 2, appeal: 6, integrityOk: true });

  assert.equal((await a.commitTo(store)).ok, true);
  assert.equal((await b.commitTo(store)).ok, true);

  const rows = Object.values(stored(st).responses);
  assert.equal(rows.length, 2, 'both ratings survive the interleaving');
  assert.deepEqual(rows.map((r) => r.perceivedOrder).sort(), [2, 7]);
});

test('A: a commit merges onto the LATEST state, never replacing rows it never saw', async () => {
  const st = memStorage();
  const store = await seeded(st);
  const stale = RatingSession.load(st).session;   // captured before any rating

  const live = RatingSession.load(st).session;
  live.record(live.currentStimulusId, { order: 5, appeal: 5, integrityOk: true });
  live.record(live.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  await live.commitTo(store);
  assert.equal(Object.keys(stored(st).responses).length, 2);

  // The stale tab commits its own (empty) view. It must not delete the two rows.
  await stale.commitTo(store);
  assert.equal(Object.keys(stored(st).responses).length, 2, 'a stale commit dropped rows');
});

test('A: a stale tab withdrawal preserves the newer rows under audit retention', async () => {
  const st = memStorage();
  const store = await seeded(st, 'p-w');
  const stale = RatingSession.load(st).session;

  const live = RatingSession.load(st).session;
  live.record(live.currentStimulusId, { order: 5, appeal: 5, integrityOk: true });
  live.record(live.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  await live.commitTo(store);
  const before = Object.keys(stored(st).responses).length;

  const res = await stale.withdrawLatest(store);
  assert.equal(res.ok, true);
  const after = stored(st);
  assert.equal(Object.keys(after.responses).length, before, 'withdrawal destroyed rows');
  assert.equal(after.withdrawn, true);
  for (const r of Object.values(after.responses)) {
    assert.equal(r.exclusionRule, 'X2-withdrawn');
    assert.deepEqual(r.analysisEligible, { modelAgreement: false, ratingOnly: false });
    assert.ok(r.perceivedOrder, 'the rating value is retained for audit');
  }
});

test('A: single-active-tab policy refuses a non-owner write with a safe reason', async () => {
  const st = memStorage();
  let t = 1000; const now = () => t;
  const tabA = new SessionStore({ storage: st, locks: null, now });
  const tabB = new SessionStore({ storage: st, locks: null, now });
  assert.equal(tabA.claimLease().ok, true);
  assert.equal(tabB.claimLease().ok, false);
  assert.equal(tabA.isOwner(), true);
  assert.equal(tabB.isOwner(), false);

  const s = RatingSession.create({ manifest, releasePackage, participantId: 'p-own' });
  s.acknowledge();
  const refused = await s.commitTo(tabB);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'not-active-tab', 'failure must be explicit, not silent');
  assert.equal((await s.commitTo(tabA)).ok, true);
});

test('A: suspension then resumption - an expired lease can be taken over safely', async () => {
  const st = memStorage();
  let t = 1000; const now = () => t;
  const tabA = new SessionStore({ storage: st, locks: null, now });
  const tabB = new SessionStore({ storage: st, locks: null, now });
  tabA.claimLease();
  const s = RatingSession.create({ manifest, releasePackage, participantId: 'p-susp' });
  s.acknowledge();
  s.record(s.currentStimulusId, { order: 3, appeal: 3, integrityOk: true });
  await s.commitTo(tabA);

  t += LEASE_TTL_MS + 1000;                       // tab A suspended past its lease
  assert.equal(tabA.isOwner(), false);
  assert.equal(tabB.canClaim(), true);
  assert.equal(tabB.claimLease().ok, true);

  const resumed = RatingSession.load(st).session;
  resumed.record(resumed.currentStimulusId, { order: 6, appeal: 2, integrityOk: true });
  assert.equal((await resumed.commitTo(tabB)).ok, true);
  assert.equal(Object.keys(stored(st).responses).length, 2, 'the pre-suspension rating survives');
});

test('A: erasure leaves a tombstone and cannot be resurrected by a stale tab', async () => {
  const st = memStorage();
  const store = await seeded(st, 'p-erase');
  const live = RatingSession.load(st).session;
  live.record(live.currentStimulusId, { order: 3, appeal: 3, integrityOk: true });
  await live.commitTo(store);
  const ghost = RatingSession.load(st).session;

  await live.eraseVia(store);
  assert.equal(st.getItem(STORAGE_KEY), null);
  assert.ok(st.getItem(TOMBSTONE_KEY), 'a tombstone must remain');

  const res = await ghost.commitTo(store);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'session-erased');
  assert.equal(st.getItem(STORAGE_KEY), null, 'erased data must not reappear');
});

test('A: corrupt saved data is QUARANTINED, never destroyed', () => {
  const st = memStorage();
  const store = new SessionStore({ storage: st, locks: null });
  st.setItem(STORAGE_KEY, '{{{ not json — a real participant session');
  const q = store.quarantineCorrupt();
  assert.equal(q.ok, true);
  assert.ok(q.quarantineKey.startsWith(`${STORAGE_KEY}/corrupt-`));
  assert.ok(st.getItem(q.quarantineKey).includes('a real participant session'),
    'the original bytes must be preserved for recovery');
  assert.equal(st.getItem(STORAGE_KEY), null);
  assert.equal(store.listQuarantined().length, 1, 'the recovery path must be discoverable');
});

test('A: commit refuses to act on corrupt data rather than clobbering it', async () => {
  const st = memStorage();
  const store = new SessionStore({ storage: st, locks: null });
  store.claimLease();
  st.setItem(STORAGE_KEY, '{{{ corrupt');
  const s = RatingSession.create({ manifest, releasePackage, participantId: 'p-c' });
  const res = await s.commitTo(store);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'corrupt-saved-session');
  assert.ok(st.getItem(STORAGE_KEY).includes('corrupt'), 'corrupt bytes must still be there');
});

// ===========================================================================
// B. Frozen identity binding
// ===========================================================================

test('B: the release package is a content digest over every determining input', () => {
  const priv = JSON.parse(readFileSync(join(ROOT, 'study-private/release-package.json'), 'utf8'));
  assert.equal(priv.packageFormat, 'release-package-1');
  assert.match(priv.packageDigest, /^[0-9a-f]{64}$/);
  assert.ok(priv.sources.length >= 8, 'spec, scorer, config, geometry, colour, app sources');
  assert.ok(priv.sources.every((s) => /^[0-9a-f]{64}$/.test(s.sha256)));
  assert.ok(priv.scoringKey.sha256, 'the scoring key is part of the identity');
  assert.equal(priv.stimuli.length, manifest.items.length);
  assert.ok(priv.identities.effectiveConfigDigest);
});

test('B: the participant-side package carries identity but no scores or conditions', () => {
  const raw = readFileSync(join(ROOT, 'study/release-package.json'), 'utf8');
  for (const t of ['condition', 'scoringKey', 'v1Total', 'strict-grid', 'radial-distribution', 'sources']) {
    assert.ok(!raw.includes(t), `participant package leaks "${t}"`);
  }
  const pub = JSON.parse(raw);
  assert.equal(pub.packageDigest, releasePackage.packageDigest);
  assert.ok(pub.stimuli.every((s) => s.sha256 && s.fnv));
});

test('B: exports bind to the package DIGEST, not just a reusable label', async () => {
  const s = RatingSession.create({ manifest, releasePackage, participantId: 'p-bind' });
  s.acknowledge();
  const rec = s.exportRecord();
  assert.equal(rec.releasePackageDigest, releasePackage.packageDigest);
  assert.equal(rec.releasePackageId, releasePackage.packageId);
  assert.match(rec.releasePackageDigest, /^[0-9a-f]{64}$/);
});

test('B: a join with a mismatched package digest is refused', () => {
  const dir = tmp();
  const s = RatingSession.create({ manifest, releasePackage, participantId: 'p-mm' });
  s.acknowledge();
  s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  const rec = s.exportRecord();
  rec.releasePackageDigest = 'f'.repeat(64);
  const f = join(dir, 'e.json'); writeFileSync(f, JSON.stringify(rec));

  assert.throws(
    () => execFileSync('node', [join(ROOT, 'scripts/join-responses.mjs'), f], { encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 3 && /release package mismatch/.test(String(e.stderr)),
  );
});

test('B: an export with NO package digest cannot be used for model agreement', () => {
  const dir = tmp();
  const s = RatingSession.create({ manifest, participantId: 'p-nopkg' }); // no releasePackage
  s.acknowledge();
  const ids = new Map(manifest.items.map((i) => [i.stimulusId, i]));
  while (!s.complete) {
    const id = s.currentStimulusId;
    s.record(id, { order: 4, appeal: 4, integrityOk: true, stimulusIntegrity: ids.get(id).integrity });
  }
  const f = join(dir, 'e.json'); writeFileSync(f, JSON.stringify(s.exportRecord()));
  const out = join(dir, 'j.json');
  execFileSync('node', [join(ROOT, 'scripts/join-responses.mjs'), f, '--out', out,
    '--allow-identity-mismatch'], { encoding: 'utf8' });
  const joined = JSON.parse(readFileSync(out, 'utf8'));

  assert.equal(joined.identity.accepted, false);
  assert.equal(joined.counts.modelAgreementEligible, 0, 'unbound identity must block primary use');
  assert.equal(joined.counts.ratingOnlyEligible, joined.counts.responses, 'ratings are still retained');
  assert.match(joined.identity.effectOnAnalysis, /excluded from model-agreement/);
});

test('B: a bound export joins normally and records the package identity', () => {
  const dir = tmp();
  const s = RatingSession.create({ manifest, releasePackage, participantId: 'p-ok' });
  s.acknowledge();
  while (!s.complete) {
    const id = s.currentStimulusId;
    s.record(id, { order: 4, appeal: 4, integrityOk: true, stimulusIntegrity: byId.get(id).integrity });
  }
  const f = join(dir, 'e.json'); writeFileSync(f, JSON.stringify(s.exportRecord()));
  const out = join(dir, 'j.json');
  execFileSync('node', [join(ROOT, 'scripts/join-responses.mjs'), f, '--out', out], { encoding: 'utf8' });
  const joined = JSON.parse(readFileSync(out, 'utf8'));

  assert.equal(joined.identity.accepted, true);
  assert.equal(joined.identity.packageDigestMatches, true);
  assert.equal(joined.identity.keyDigestMatches, true);
  assert.ok(joined.counts.modelAgreementEligible > 0);
  assert.equal(joined.diagnosticRescoring.performed, false);
  assert.match(joined.diagnosticRescoring.note, /model-comparison diagnostic/);
});

test('B: the join NEVER overwrites the raw export or an existing output', () => {
  const dir = tmp();
  const s = RatingSession.create({ manifest, releasePackage, participantId: 'p-ovw' });
  s.acknowledge();
  s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true, stimulusIntegrity: byId.get(s.state.order[0]).integrity });
  const f = join(dir, 'raw.json');
  writeFileSync(f, JSON.stringify(s.exportRecord()));
  const rawBefore = readFileSync(f, 'utf8');

  // Writing over the raw export is refused.
  assert.throws(
    () => execFileSync('node', [join(ROOT, 'scripts/join-responses.mjs'), f, '--out', f], { encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 4 && /refusing to write over the raw export/.test(String(e.stderr)),
  );
  assert.equal(readFileSync(f, 'utf8'), rawBefore, 'the raw export is untouched');

  // Writing over an existing output is refused too.
  const out = join(dir, 'j.json');
  execFileSync('node', [join(ROOT, 'scripts/join-responses.mjs'), f, '--out', out], { encoding: 'utf8' });
  assert.throws(
    () => execFileSync('node', [join(ROOT, 'scripts/join-responses.mjs'), f, '--out', out], { encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 4 && /refusing to overwrite/.test(String(e.stderr)),
  );
});

// ===========================================================================
// Operational loose ends
// ===========================================================================

test('OPS: package.json scripts all reference files that exist', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    for (const m of cmd.matchAll(/(test\/[\w.-]+\.mjs|scripts\/[\w.-]+\.mjs)/g)) {
      assert.ok(existsSync(join(ROOT, m[1])), `script "${name}" references missing ${m[1]}`);
    }
  }
  assert.equal(pkg.scripts['test:v1'], 'node --test test/v1.test.mjs');
});

test('OPS: the built participant bundle is clean and self-contained', () => {
  const audit = JSON.parse(readFileSync(join(ROOT, 'results/participant-dist-audit.json'), 'utf8'));
  assert.equal(audit.clean, true, `bundle findings: ${JSON.stringify(audit.findings)}`);
  assert.ok(audit.files.includes('index.html'));
  assert.ok(audit.files.includes('release-package.json'));
  assert.ok(!audit.files.some((f) => /stimulus-key|study-private/.test(f)));
  // Every stimulus in the manifest ships.
  for (const item of manifest.items) assert.ok(audit.files.includes(item.file), `missing ${item.file}`);
});

test('OPS: union error is reported as corpus-specific, with measured values', () => {
  const rep = JSON.parse(readFileSync(join(ROOT, 'results/union-error-report.json'), 'utf8'));
  assert.match(rep.scope, /fixture-specific/);
  assert.match(rep.scope, /NOT a universal guarantee/);
  assert.equal(rep.corpusSize, manifest.items.length);
  assert.ok(rep.summary['512'].maxPercent > 0, 'a real measured maximum, not an assumption');
  assert.ok(rep.summary['2048'].maxPercent <= rep.summary['256'].maxPercent,
    'refining the grid should not worsen the measured error');
});
