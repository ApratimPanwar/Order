/**
 * Regression tests for the second hardening pass (F1-F8).
 *
 * One or more tests per finding, each asserting the CORRECTED behaviour and,
 * where possible, demonstrating that the old behaviour would fail.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  RatingSession, SessionError, WITHDRAWAL_POLICY, RATING_BOUNDS, SESSION_FORMAT,
} from '../study/session.js';
import { score, checkApplicability } from '../core/scoring/v1.js';
import { V1_CONFIG, effectiveConfig } from '../core/scoring/v1-config.js';
import { createLayout } from '../core/layout.js';
import { generateLayout } from '../core/generate.js';
import {
  unionFootprintArea, unionFootprintByCell, unionApproximationError, RENDERER_2,
} from '../core/geometry.js';

const ROOT = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'study', 'stimuli', 'manifest.json'), 'utf8'));
// Sessions must bind to the frozen release package, or the join refuses them.
const releasePackage = JSON.parse(readFileSync(join(ROOT, 'study', 'release-package.json'), 'utf8'));
const manifestById = new Map(manifest.items.map((i) => [i.stimulusId, i]));
const keyFile = JSON.parse(readFileSync(join(ROOT, 'study-private', 'stimulus-key.json'), 'utf8'));

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};
const el = (o) => ({
  type: 'square', index: 1, order: 0, visible: true,
  x: 250, y: 250, size: 60, rotation: 0, color: '#808080', filled: true, ...o,
});
const L = (els, id) => createLayout({ id, elements: els.map((e, i) => ({ ...e, index: e.index ?? i + 1, order: i })) });
const started = () => {
  const s = RatingSession.create({ manifest, releasePackage });
  s.acknowledge();
  return s;
};
/** Records with the real integrity hash so joins can bind the layout. */
const rate = (s, o, a, extra = {}) => {
  const id = s.currentStimulusId;
  return s.record(id, {
    order: o, appeal: a, integrityOk: true,
    stimulusIntegrity: manifestById.get(id)?.integrity, ...extra,
  });
};

// ===========================================================================
// F1 — withdrawal propagates through export and joining
// ===========================================================================

test('F1: withdrawal marks every already-recorded response ineligible', () => {
  const s = started();
  s.record(s.currentStimulusId, { order: 5, appeal: 3, integrityOk: true });
  s.record(s.currentStimulusId, { order: 2, appeal: 6, integrityOk: true });
  for (const r of Object.values(s.state.responses)) {
    assert.equal(r.analysisEligible.ratingOnly, true, 'eligible before withdrawal');
  }

  s.withdraw();
  for (const r of Object.values(s.state.responses)) {
    assert.deepEqual(r.analysisEligible, { modelAgreement: false, ratingOnly: false });
    assert.equal(r.exclusionRule, 'X2-withdrawn');
    assert.ok(r.withdrawnAt);
  }
});

test('F1: the export enforces withdrawal, it does not merely flag it', () => {
  const s = started();
  s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  s.withdraw();
  const rec = s.exportRecord();

  assert.equal(rec.withdrawn, true);
  assert.equal(rec.withdrawalPolicy.id, WITHDRAWAL_POLICY.id);
  assert.ok(rec.responses.length > 0, 'responses are retained for audit');
  for (const r of rec.responses) {
    assert.deepEqual(r.analysisEligible, { modelAgreement: false, ratingOnly: false });
    assert.equal(r.exclusionRule, 'X2-withdrawn');
  }
});

test('F1: a withdrawn export cannot be reinstated by joining', () => {
  const dir = mkdtempSync(join(tmpdir(), 'order-join-'));
  const s = started();
  while (!s.complete) rate(s, 4, 4);
  s.withdraw();
  const f = join(dir, 'withdrawn.json');
  writeFileSync(f, JSON.stringify(s.exportRecord()));

  const out = join(dir, 'joined.json');
  execFileSync('node', [join(ROOT, 'scripts', 'join-responses.mjs'), f, '--out', out], { encoding: 'utf8' });
  const joined = JSON.parse(readFileSync(out, 'utf8'));

  assert.equal(joined.withdrawal.withdrawn, true);
  assert.equal(joined.counts.modelAgreementEligible, 0, 'a withdrawn participant contributes nothing');
  assert.equal(joined.counts.ratingOnlyEligible, 0);
  assert.ok(joined.rows.every((r) => r.exclusionRule === 'X2-withdrawn'));
});

// ===========================================================================
// F2 — unmatched preservation and identity binding
// ===========================================================================

test('F2: unmatched responses are PRESERVED, not dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'order-join-'));
  const s = started();
  rate(s, 5, 3);
  const rec = s.exportRecord();
  // A stimulus the key does not know about (e.g. a retired archive entry).
  rec.responses.push({
    ...rec.responses[0], stimulusId: 'stim-deadbeef', presentationIndex: 99,
  });

  const f = join(dir, 'e.json'); writeFileSync(f, JSON.stringify(rec));
  const out = join(dir, 'j.json');
  execFileSync('node', [join(ROOT, 'scripts', 'join-responses.mjs'), f, '--out', out], { encoding: 'utf8' });
  const joined = JSON.parse(readFileSync(out, 'utf8'));

  assert.equal(joined.counts.responses, 2);
  assert.equal(joined.counts.unmatchedPreserved, 1);
  assert.equal(joined.rows.length, 2, 'the unmatched row survives into the output');
  const un = joined.rows.find((r) => r.stimulusId === 'stim-deadbeef');
  assert.equal(un.joinStatus, 'unmatched-stimulus');
  assert.equal(un.condition, '', 'no condition is guessed');
  assert.equal(un.v1Total, '', 'empty, never 0');
  assert.equal(un.perceivedOrder, 5, 'the human rating is intact');
});

test('F2: a manifest identity mismatch ABORTS the join', () => {
  const dir = mkdtempSync(join(tmpdir(), 'order-join-'));
  const s = started();
  s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  const rec = s.exportRecord();
  rec.manifestVersion = 'stimuli-FROM-A-DIFFERENT-ARCHIVE';
  const f = join(dir, 'e.json'); writeFileSync(f, JSON.stringify(rec));

  assert.throws(
    () => execFileSync('node', [join(ROOT, 'scripts', 'join-responses.mjs'), f], { encoding: 'utf8', stdio: 'pipe' }),
    (e) => e.status === 3 && /IDENTITY BINDING FAILED/.test(String(e.stderr)),
  );
});

test('F2: the join binds to key, manifest, model and config identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'order-join-'));
  const s = started();
  while (!s.complete) rate(s, 3, 5);
  const f = join(dir, 'e.json'); writeFileSync(f, JSON.stringify(s.exportRecord()));
  const out = join(dir, 'j.json');
  execFileSync('node', [join(ROOT, 'scripts', 'join-responses.mjs'), f, '--out', out], { encoding: 'utf8' });
  const joined = JSON.parse(readFileSync(out, 'utf8'));

  assert.equal(joined.identity.accepted, true);
  assert.equal(joined.identity.keyManifestVersion, manifest.manifestVersion);
  assert.equal(joined.provenance.keyVersion, keyFile.keyVersion);
  assert.ok(joined.provenance.modelVersion, 'model version recorded from the key');
  assert.ok(joined.provenance.configVersion, 'config version recorded from the key');
  assert.ok(joined.rows.filter((r) => r.joinStatus === 'matched').every((r) => r.layoutIntegrity));
});

test('F2: a layout-integrity disagreement blocks model agreement but keeps the rating', () => {
  const dir = mkdtempSync(join(tmpdir(), 'order-join-'));
  const s = started();
  rate(s, 6, 2, { stimulusIntegrity: 'ffffffff' });
  const f = join(dir, 'e.json'); writeFileSync(f, JSON.stringify(s.exportRecord()));
  const out = join(dir, 'j.json');
  execFileSync('node', [join(ROOT, 'scripts', 'join-responses.mjs'), f, '--out', out], { encoding: 'utf8' });
  const joined = JSON.parse(readFileSync(out, 'utf8'));

  assert.equal(joined.counts.integrityMismatch, 1);
  const row = joined.rows[0];
  assert.equal(row.modelAgreementEligible, false);
  assert.equal(row.ratingOnlyEligible, true, 'the rating still counts for rating-only analysis');
  assert.equal(row.perceivedOrder, 6);
});

// ===========================================================================
// F3 — session transition and rating validation
// ===========================================================================

test('F3: a rating before acknowledgement is refused', () => {
  const s = RatingSession.create({ manifest, releasePackage });
  assert.throws(() => s.record(s.currentStimulusId, { order: 4, appeal: 4 }),
    (e) => e instanceof SessionError && e.code === 'not-acknowledged');
});

test('F3: a rating after withdrawal is refused', () => {
  const s = started();
  s.withdraw();
  assert.throws(() => s.record(s.currentStimulusId, { order: 4, appeal: 4 }),
    (e) => e.code === 'withdrawn');
});

test('F3: a stale (out-of-order) submission is refused', () => {
  const s = started();
  const first = s.currentStimulusId;
  s.record(first, { order: 4, appeal: 4, integrityOk: true });

  // Re-submitting the trial that just advanced is STALE: the id no longer
  // matches the trial on screen. This is the case a double-click produces.
  assert.throws(() => s.record(first, { order: 5, appeal: 5, integrityOk: true }),
    (e) => e.code === 'stale-trial');

  // Any other non-current id is equally refused.
  const wrong = s.state.order[s.state.order.length - 1];
  assert.throws(() => s.record(wrong, { order: 5, appeal: 5, integrityOk: true }),
    (e) => e.code === 'stale-trial');
});

test('F3: a duplicate response is refused even if the index is rewound', () => {
  // Defence in depth: the stale-trial check normally fires first, so this
  // exercises the duplicate guard directly by restoring the index.
  const s = started();
  const first = s.currentStimulusId;
  s.record(first, { order: 4, appeal: 4, integrityOk: true });
  s.state.index = 0;                       // simulate a corrupted/rewound cursor
  assert.equal(s.currentStimulusId, first);
  assert.throws(() => s.record(first, { order: 7, appeal: 7, integrityOk: true }),
    (e) => e.code === 'duplicate-response');
  assert.equal(s.state.responses[first].perceivedOrder, 4, 'the original answer is not overwritten');
});

test('F3: out-of-range and non-integer ratings are refused', () => {
  const bad = [0, 8, -1, 3.5, '5', null, undefined, NaN];
  for (const v of bad) {
    const s = started();
    assert.throws(() => s.record(s.currentStimulusId, { order: v, appeal: 4, integrityOk: true }),
      (e) => e.code === 'invalid-rating', `order=${String(v)} should be refused`);
    assert.throws(() => s.record(s.currentStimulusId, { order: 4, appeal: v, integrityOk: true }),
      (e) => e.code === 'invalid-rating', `appeal=${String(v)} should be refused`);
  }
  const ok = started();
  assert.doesNotThrow(() => ok.record(ok.currentStimulusId, { order: RATING_BOUNDS.min, appeal: RATING_BOUNDS.max, integrityOk: true }));
});

test('F3: an oversized or non-string comment is refused', () => {
  const s = started();
  assert.throws(() => s.record(s.currentStimulusId, { order: 4, appeal: 4, comment: 'x'.repeat(RATING_BOUNDS.commentMaxLength + 1), integrityOk: true }),
    (e) => e.code === 'invalid-comment');
  assert.throws(() => s.record(s.currentStimulusId, { order: 4, appeal: 4, comment: 42, integrityOk: true }),
    (e) => e.code === 'invalid-comment');
});

test('F3: recording into a completed session is refused', () => {
  const s = started();
  while (!s.complete) s.record(s.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  assert.throws(() => s.record('anything', { order: 4, appeal: 4 }), (e) => e.code === 'complete');
});

test('F3: an unavailable stimulus is skipped through an AUDITED path', () => {
  const s = started();
  const id = s.currentStimulusId;
  s.skipUnavailable(id, 'HTTP 404');
  assert.equal(s.state.skipped[id].reason, 'HTTP 404');
  assert.equal(s.state.index, 1);
  assert.equal(Object.keys(s.state.responses).length, 0, 'no rating is fabricated');
  assert.ok(s.exportRecord().skipped[id], 'the skip is visible in the export');
});

// ===========================================================================
// F4 — concurrency
// ===========================================================================

test('F4: a stale concurrent write is REFUSED (last-write-wins is gone)', () => {
  const st = memStorage();
  const tab1 = RatingSession.create({ manifest, participantId: 'p-conc' });
  tab1.acknowledge();
  assert.equal(tab1.save(st).ok, true);

  const tab2 = RatingSession.load(st).session;
  tab2.record(tab2.currentStimulusId, { order: 5, appeal: 3, integrityOk: true });
  assert.equal(tab2.save(st).ok, true, 'tab 2 writes first');

  tab1.record(tab1.currentStimulusId, { order: 1, appeal: 1, integrityOk: true });
  const res = tab1.save(st);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'stale-session');

  // Tab 2's work survives.
  const stored = JSON.parse(st.getItem('order-blind-rating/session'));
  assert.equal(Object.values(stored.responses)[0].perceivedOrder, 5);
});

test('F4: after reloading the newer state, the write succeeds', () => {
  const st = memStorage();
  const a = RatingSession.create({ manifest, participantId: 'p-conc2' });
  a.acknowledge(); a.save(st);
  const b = RatingSession.load(st).session;
  b.record(b.currentStimulusId, { order: 5, appeal: 3, integrityOk: true });
  b.save(st);

  const reloaded = RatingSession.load(st).session;
  reloaded.record(reloaded.currentStimulusId, { order: 2, appeal: 2, integrityOk: true });
  assert.equal(reloaded.save(st).ok, true);
  assert.equal(Object.keys(RatingSession.load(st).session.state.responses).length, 2);
});

test('F4: withdrawal force-saves and wins over a concurrent tab', () => {
  const st = memStorage();
  const a = RatingSession.create({ manifest, participantId: 'p-conc3' });
  a.acknowledge(); a.save(st);
  const b = RatingSession.load(st).session;
  b.record(b.currentStimulusId, { order: 4, appeal: 4, integrityOk: true });
  b.save(st);

  a.withdraw();
  assert.equal(a.save(st, { force: true }).ok, true, 'withdrawal is terminal and must land');
  assert.equal(RatingSession.load(st).session.state.withdrawn, true);
});

test('F4: the session format was bumped so old saves are not silently reused', () => {
  assert.equal(SESSION_FORMAT, 'rating-session-3');
  const st = memStorage();
  st.setItem('order-blind-rating/session', JSON.stringify({ sessionFormat: 'rating-session-2', order: ['a'], index: 0, responses: {}, participantId: 'p' }));
  assert.equal(RatingSession.load(st).ok, false);
});

// ===========================================================================
// F5 — applicability and malformed input
// ===========================================================================

test('F5: malformed input is rejected without throwing and without a score', () => {
  const cases = [
    ['null', null], ['undefined', undefined], ['number', 42], ['string', 'x'],
    ['no elements', {}], ['elements not array', { elements: 'x' }],
    ['element not object', { elements: [null] }],
    ['bad canvas', { elements: [], canvas: { width: 0, height: 10 } }],
    ['canvas NaN', { elements: [], canvas: { width: NaN, height: 10 } }],
  ];
  for (const [label, input] of cases) {
    let r;
    assert.doesNotThrow(() => { r = score(input); }, `${label} threw`);
    assert.equal(r.scorable, false, label);
    assert.equal(r.total, null, `${label} must not fabricate a score`);
    assert.ok(r.diagnostics.length > 0, `${label} must give a reason`);
  }
});

test('F5: an unsupported element type is reported, not thrown', () => {
  const l = { elements: [{ type: 'hexagon', visible: true, x: 1, y: 1, size: 5, rotation: 0, color: '#000000' }] };
  let r;
  assert.doesNotThrow(() => { r = score(l); });
  assert.ok(r.diagnostics.some((d) => d.code === 'unsupported-element-type'));
});

test('F5: EVERY stated applicability condition is enforced by the gate', () => {
  const cfg = effectiveConfig(V1_CONFIG);
  const base = () => [
    el({ type: 'circle', x: 120, y: 120, size: 70, color: '#DC2626' }),
    el({ type: 'square', x: 360, y: 130, size: 80, color: '#1F2937' }),
    el({ type: 'rectangle', x: 140, y: 370, size: 60, size2: 90, color: '#65A30D' }),
    el({ type: 'triangle', x: 370, y: 360, size: 75, color: '#D97706' }),
  ];
  const expect = (mutate, code) => {
    const l = L(mutate(base()), 'fx');
    const g = checkApplicability(l, cfg);
    assert.equal(g.scorable, false, `expected rejection for ${code}`);
    assert.ok(g.reasons.some((r) => r.code === code), `expected ${code}, got ${g.reasons.map((r) => r.code)}`);
  };

  expect((e) => e.slice(0, 3), 'below-min-elements');
  expect((e) => e.map((x) => ({ ...x, x: 250, y: 250 })), 'below-min-distinct-positions');
  expect((e) => e.map((x, i) => (i === 0 ? { ...x, size: 0 } : x)), 'zero-size-element');
  expect((e) => e.map((x, i) => (i === 0 ? { ...x, x: NaN } : x)), 'non-finite-property');
  expect((e) => e.map((x, i) => (i === 0 ? { ...x, color: 'rebeccapurple' } : x)), 'unparseable-color');
  // fully off-canvas -> zero clipped area
  expect((e) => e.map((x, i) => (i === 0 ? { ...x, x: -9000, y: -9000 } : x)), 'zero-clipped-area');

  const arrows = createLayout({ id: 'fx-arrows', elements: base(), renderer: { gridOverlay: false, gridSize: 8, showArrows: true } });
  const g = checkApplicability(arrows, cfg);
  assert.ok(g.reasons.some((r) => r.code === 'show-arrows-enabled'));
});

// ===========================================================================
// F6 — footprint-union vs density semantics
// ===========================================================================

test('F6: density evenness now uses UNION coverage, consistent with whitespace', () => {
  // Four identical stacked squares. Union == one square. A summed-area density
  // would count the same cell four times.
  const stacked = L([
    el({ size: 200, index: 1 }), el({ size: 200, index: 2 }),
    el({ size: 200, index: 3 }), el({ size: 200, index: 4 }),
  ], 'fx-stacked');
  const opts = { renderer: RENDERER_2, circleFacets: 64, circleMode: 'area-matched', unionGridN: 512 };
  const canvas = { width: 500, height: 500 };

  const union = unionFootprintArea(stacked.elements, canvas, opts);
  const cells = unionFootprintByCell(stacked.elements, canvas, opts, 5);
  const cellSum = cells.reduce((a, b) => a + b, 0);

  assert.ok(Math.abs(cellSum - union) / union < 0.02,
    `per-cell union total ${cellSum.toFixed(0)} should match the whole-canvas union ${union.toFixed(0)}`);
  // A summed (overlap-counted) total would be ~4x.
  assert.ok(cellSum < union * 1.5, 'density must not count overlap four times');
});

test('F6: the union approximation error is bounded and documented', () => {
  const opts = { renderer: RENDERER_2, circleFacets: 64, circleMode: 'area-matched', unionGridN: 512 };
  const canvas = { width: 500, height: 500 };
  // One 200px square: exact area 40000.
  const one = L([el({ size: 200 })], 'fx-one').elements;
  const sampled = unionFootprintArea(one, canvas, opts);
  const err = unionApproximationError(40000, sampled);
  assert.ok(err < 0.01, `union sampling error ${(err * 100).toFixed(3)}% exceeds the 1% documented bound`);

  // Error shrinks as the sampling grid is refined.
  const coarse = unionApproximationError(40000, unionFootprintArea(one, canvas, { ...opts, unionGridN: 64 }));
  const fine = unionApproximationError(40000, unionFootprintArea(one, canvas, { ...opts, unionGridN: 1024 }));
  assert.ok(fine <= coarse, `refining should not worsen the error (coarse ${coarse}, fine ${fine})`);
});

// ===========================================================================
// F7 — baseline interpretation
// ===========================================================================

test('F7: the baseline report gives transitions and a net rate change, not a causal share', () => {
  const report = JSON.parse(readFileSync(join(ROOT, 'results', 'baseline-report.json'), 'utf8'));
  const ra = report.conditionB_matchedRandomPosition.reversalAnalysis;
  assert.ok(ra, 'reversalAnalysis must be present');
  for (const k of ['baseline1Reversals', 'baseline2Reversals', 'netRateChangePercentagePoints', 'transitions']) {
    assert.ok(k in ra, `missing ${k}`);
  }
  const t = ra.transitions;
  assert.ok(t.becameReversal > 0 && t.ceasedToBeReversal > 0,
    'flips occur in BOTH directions, which is why a single "explained" share is invalid');
  assert.equal(
    t.stayedReversal + t.ceasedToBeReversal, ra.baseline1Reversals,
    'transition counts must reconcile with the baseline-1 total',
  );
  assert.equal(
    t.stayedReversal + t.becameReversal, ra.baseline2Reversals,
    'transition counts must reconcile with the baseline-2 total',
  );
  assert.match(ra.interpretation, /does NOT attribute/);
  const raw = readFileSync(join(ROOT, 'results', 'baseline-report.json'), 'utf8');
  assert.ok(!/explained/i.test(raw), 'the causal "explained" framing must not reappear');
});

// ===========================================================================
// F8 — documented commands are current
// ===========================================================================

test('F8: every command in the handoff exists and is runnable', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'IMPLEMENTATION-HANDOFF.md'), 'utf8');
  const scripts = [...doc.matchAll(/node (scripts\/[a-z0-9-]+\.mjs)/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 3);
  for (const rel of new Set(scripts)) {
    assert.doesNotThrow(() => readFileSync(join(ROOT, rel)), `documented script missing: ${rel}`);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.test, 'npm test must exist');
  // The documented serve command must root at the participant bundle, and the
  // path must resolve from the documented working directory.
  const serve = doc.match(/python -m http\.server \d+ --directory (\S+)/);
  assert.ok(serve, 'a serve command must be documented');
  const servedRoot = serve[1];
  assert.match(servedRoot, /(^|\/)study$/, `serve root must end at study/, got "${servedRoot}"`);
  assert.doesNotThrow(
    () => readFileSync(join(ROOT, servedRoot, 'index.html')),
    `the documented serve root "${servedRoot}" must resolve from Order/research`,
  );
  assert.ok(!servedRoot.includes('study-private'), 'the serve root must never expose the key');
});
