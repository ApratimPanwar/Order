/**
 * Blind-rating session tests (Node). Browser behaviour is verified separately.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  RatingSession, reproducibleOrder, newParticipantId, SESSION_FORMAT, RELEASE_STATUS,
} from '../study/session.js';
import { contentHash } from '../study/render-layout.js';
import { layoutHash, deserialize } from '../core/layout.js';
import { score as scoreV1 } from '../core/scoring/v1.js';

const STUDY = join(import.meta.dirname, '..', 'study');
const PRIVATE = join(import.meta.dirname, '..', 'study-private');
const manifest = JSON.parse(readFileSync(join(STUDY, 'stimuli', 'manifest.json'), 'utf8'));

/** In-memory localStorage stand-in. */
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

// ---------------------------------------------------------------------------
// Stimulus bundle
// ---------------------------------------------------------------------------

test('participant bundle carries NO scores, conditions, methods or seeds', () => {
  // Scan the ITEMS, not the whole file: the manifest's own explanatory note
  // legitimately contains the words "scores" and "conditions" while promising
  // their absence.
  const items = JSON.stringify(manifest.items);
  for (const term of ['condition', 'score', 'total', 'strict-grid', 'radial-distribution',
    'random-position', 'as-generated', 'seed', 'dimensions', 'submetrics']) {
    assert.ok(!items.includes(term), `manifest items leak "${term}"`);
  }
  // And the note must not carry actual condition VALUES.
  for (const v of ['strict-grid', 'radial-distribution', 'random-position', 'as-generated']) {
    assert.ok(!manifest.note.includes(v), `manifest note leaks the condition value "${v}"`);
  }
  for (const item of manifest.items) {
    assert.deepEqual(Object.keys(item).sort(), ['file', 'integrity', 'rendererVersion', 'stimulusId']);
    const layoutRaw = readFileSync(join(STUDY, item.file), 'utf8');
    for (const term of ['condition', 'score', 'total', 'submetrics']) {
      assert.ok(!layoutRaw.includes(term), `${item.stimulusId} leaks "${term}"`);
    }
  }
});

test('researcher key exists, is OUTSIDE the participant bundle, and holds the conditions', () => {
  assert.ok(existsSync(join(PRIVATE, 'stimulus-key.json')), 'key must exist');
  assert.ok(!existsSync(join(STUDY, 'stimulus-key.json')), 'key must not be inside study/');
  assert.ok(!existsSync(join(STUDY, 'stimuli', 'stimulus-key.json')));
  const key = JSON.parse(readFileSync(join(PRIVATE, 'stimulus-key.json'), 'utf8'));
  assert.equal(key.count, manifest.count);
  assert.ok(key.items.every((i) => typeof i.condition === 'string'));
  assert.match(key.approval, /NOT APPROVED/);
});

test('every stimulus integrity hash verifies against its served bytes', () => {
  for (const item of manifest.items) {
    const text = readFileSync(join(STUDY, item.file), 'utf8');
    assert.equal(contentHash(text), item.integrity, `${item.stimulusId} integrity mismatch`);
    const layout = deserialize(text);
    assert.equal(layoutHash(layout), item.integrity, 'layoutHash must agree with contentHash');
  }
});

test('every stimulus carries renderer metadata and no arrows', () => {
  for (const item of manifest.items) {
    const layout = deserialize(readFileSync(join(STUDY, item.file), 'utf8'));
    assert.equal(layout.meta.rendererVersion, 'renderer-2');
    assert.equal(layout.renderer.showArrows, false);
    assert.equal(item.rendererVersion, 'renderer-2');
  }
});

test('the bundle includes at least one stimulus the model cannot score', () => {
  const key = JSON.parse(readFileSync(join(PRIVATE, 'stimulus-key.json'), 'utf8'));
  const unscorable = key.items.filter((i) => !i.scoreAvailable);
  assert.ok(unscorable.length >= 1, 'need an unscorable stimulus to exercise the rule');
  const layout = deserialize(readFileSync(join(STUDY, `stimuli/${unscorable[0].stimulusId}.json`), 'utf8'));
  const s = scoreV1(layout);
  assert.equal(s.scorable, false);
  assert.equal(s.total, null);
});

// ---------------------------------------------------------------------------
// Session mechanics
// ---------------------------------------------------------------------------

test('presentation order is reproducible from the seed and is a permutation', () => {
  const ids = manifest.items.map((i) => i.stimulusId);
  const a = reproducibleOrder(ids, 'p-abc123');
  const b = reproducibleOrder(ids, 'p-abc123');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, reproducibleOrder(ids, 'p-different'));
  assert.deepEqual([...a].sort(), [...ids].sort(), 'must be a permutation, not a subset');
});

test('participant ids are pseudonymous and carry no identifying information', () => {
  const id = newParticipantId();
  assert.match(id, /^p-[0-9a-f]{16}$/);
  const s = RatingSession.create({ manifest });
  // Whole-key matching: substring matching gives false positives
  // ("participantId" contains "ip", "name" appears inside "userName" etc).
  const keys = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) { keys.add(k.toLowerCase()); walk(v); }
  };
  walk(s.toJSON());
  for (const term of ['email', 'name', 'ip', 'ipaddress', 'useragent', 'fingerprint', 'phone', 'dob']) {
    assert.ok(!keys.has(term), `session collects an identifying field: ${term}`);
  }
  assert.ok(keys.has('participantid'), 'a pseudonymous id is expected');
});

test('a completed session records three INDEPENDENT eligibility flags', () => {
  const s = RatingSession.create({ manifest });
  s.acknowledge();
  const id = s.currentStimulusId;
  const r = s.record(id, { order: 5, appeal: 3, comment: 'grid-like', integrityOk: true });
  assert.equal(r.scoreAvailable, null, 'filled offline, not by the participant app');
  assert.equal(r.trialValid, true);
  assert.deepEqual(r.analysisEligible, { modelAgreement: null, ratingOnly: true });
});

test('RULE: a rating stays valid when the model cannot score the layout', () => {
  const key = JSON.parse(readFileSync(join(PRIVATE, 'stimulus-key.json'), 'utf8'));
  const unscorable = key.items.find((i) => !i.scoreAvailable);
  const s = RatingSession.create({ manifest });
  s.acknowledge();
  // Rate the unscorable stimulus wherever it falls in the order.
  while (s.currentStimulusId && s.currentStimulusId !== unscorable.stimulusId) {
    s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  }
  assert.equal(s.currentStimulusId, unscorable.stimulusId);
  const r = s.record(unscorable.stimulusId, { order: 6, appeal: 2, comment: 'clear', integrityOk: true });

  // Offline join, exactly as the researcher would do it.
  r.scoreAvailable = unscorable.scoreAvailable;          // false
  r.analysisEligible.modelAgreement = unscorable.scoreAvailable;

  assert.equal(r.scoreAvailable, false);
  assert.equal(r.analysisEligible.modelAgreement, false, 'excluded from model-agreement analysis');
  assert.equal(r.analysisEligible.ratingOnly, true, 'RETAINED for rating-only analysis');
  assert.equal(r.trialValid, true, 'an unscorable layout does not invalidate the trial');
  assert.equal(r.perceivedOrder, 6, 'the human rating survives intact');
});

test('an integrity mismatch flags the trial but KEEPS the response', () => {
  const s = RatingSession.create({ manifest });
  s.acknowledge();
  const r = s.record(s.currentStimulusId, { order: 3, appeal: 5, integrityOk: false });
  assert.equal(r.trialValid, false);
  assert.equal(r.invalidReason, 'stimulus-integrity-mismatch');
  assert.equal(r.perceivedOrder, 3, 'the response is retained, not discarded');
  assert.equal(r.analysisEligible.ratingOnly, false);
});

test('save/load round-trips and resumes at the right index', () => {
  const st = memStorage();
  const s = RatingSession.create({ manifest });
  s.acknowledge();
  s.record(s.currentStimulusId, { order: 5, appeal: 4, integrityOk: true });
  s.record(s.currentStimulusId, { order: 2, appeal: 6, integrityOk: true });
  assert.equal(s.save(st).ok, true);

  const loaded = RatingSession.load(st);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.session.state.index, 2);
  assert.equal(Object.keys(loaded.session.state.responses).length, 2);
  assert.deepEqual(loaded.session.state.order, s.state.order);
  assert.equal(loaded.session.currentStimulusId, s.currentStimulusId);
});

test('corrupt and unsupported saved state is rejected, not guessed at', () => {
  const st = memStorage();
  st.setItem('order-blind-rating/session', '{not json');
  assert.equal(RatingSession.load(st).reason, 'corrupt-saved-session');

  st.setItem('order-blind-rating/session', JSON.stringify({ sessionFormat: 'rating-session-99' }));
  assert.equal(RatingSession.load(st).reason, 'corrupt-saved-session');

  const s = RatingSession.create({ manifest });
  const bad = s.toJSON(); bad.index = 999;
  st.setItem('order-blind-rating/session', JSON.stringify(bad));
  assert.equal(RatingSession.load(st).reason, 'corrupt-saved-session');
});

test('unavailable storage degrades without throwing', () => {
  const hostile = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const s = RatingSession.create({ manifest });
  const res = s.save(hostile);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'storage-write-failed');
  assert.equal(RatingSession.load(hostile).ok, false);
  assert.doesNotThrow(() => s.erase(hostile));
});

test('withdrawal and erasure behave as advertised', () => {
  const st = memStorage();
  const s = RatingSession.create({ manifest });
  s.acknowledge();
  s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  s.save(st);

  s.withdraw();
  assert.equal(s.state.status, 'withdrawn');
  assert.ok(s.state.withdrawnAt);
  assert.equal(Object.keys(s.state.responses).length, 1, 'withdrawal keeps what was answered');

  s.erase(st);
  assert.equal(Object.keys(s.state.responses).length, 0);
  assert.equal(s.state.status, 'erased');
  assert.equal(st.getItem('order-blind-rating/session'), null, 'local save removed');
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

test('export is a LOCAL record and never claims submission', () => {
  const s = RatingSession.create({ manifest });
  s.acknowledge();
  s.record(s.currentStimulusId, { order: 5, appeal: 3, integrityOk: true });
  const rec = s.exportRecord();

  assert.equal(rec.transmitted, false);
  assert.equal(rec.collection.mechanism, 'local-download-only');
  assert.equal(rec.collection.approvedEndpoint, null);
  assert.match(rec.collection.note, /NOT a submission/);
  assert.match(rec.collection.note, /may itself attach identifying information/);
  assert.equal(rec.collection.returnChannel, null, 'no return channel may be invented');
  assert.match(rec.releaseStatus, /NOT A DATA COLLECTION RELEASE/);
  // An unmarked package is development: rehearsal output must never default to
  // study data (deployment item 26).
  assert.equal(rec.releaseMode, 'development');
  assert.equal(rec.dataClass, 'development-rehearsal');
  const raw = JSON.stringify(rec).toLowerCase();
  assert.ok(!raw.includes('"submitted"'), 'must not claim submission');
  assert.ok(!raw.includes('uploaded'), 'must not claim upload');
});

test('export carries versions and the reproducible order for offline joining', () => {
  const s = RatingSession.create({ manifest });
  s.acknowledge();
  s.record(s.currentStimulusId, { order: 1, appeal: 7, integrityOk: true });
  const rec = s.exportRecord();
  assert.equal(rec.sessionFormat, SESSION_FORMAT);
  assert.ok(rec.instrumentVersion && rec.instructionsVersion && rec.acknowledgementVersion);
  assert.equal(rec.manifestVersion, manifest.manifestVersion);
  assert.ok(Array.isArray(rec.order) && rec.order.length === manifest.count);
  assert.ok(rec.orderSeed);
  assert.equal(rec.responses.length, 1);
  // The note must NOT name the researcher-side file (it ships to participants).
  assert.ok(!rec.modelJoin.note.includes('study-private'));
  assert.match(rec.modelJoin.note, /completed offline by the researcher/);
});

test('offline score join reproduces model-agreement eligibility for every response', () => {
  const key = JSON.parse(readFileSync(join(PRIVATE, 'stimulus-key.json'), 'utf8'));
  const byId = new Map(key.items.map((i) => [i.stimulusId, i]));

  const s = RatingSession.create({ manifest });
  s.acknowledge();
  while (!s.complete) s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  const rec = s.exportRecord();

  let joined = 0; let ratingOnly = 0;
  for (const r of rec.responses) {
    const k = byId.get(r.stimulusId);
    assert.ok(k, `no key entry for ${r.stimulusId}`);
    r.scoreAvailable = k.scoreAvailable;
    r.analysisEligible.modelAgreement = k.scoreAvailable && r.trialValid;
    if (r.analysisEligible.modelAgreement) joined++;
    if (r.analysisEligible.ratingOnly) ratingOnly++;
  }
  assert.equal(ratingOnly, rec.responses.length, 'every valid rating stays rating-eligible');
  assert.equal(joined, rec.responses.length - 1, 'exactly the unscorable one drops out of model agreement');
});
