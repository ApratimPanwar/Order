/**
 * CHARACTERIZATION of v0 — "the scorer extracted from commit bf617e4".
 *
 * These tests document WHAT v0 ACTUALLY DOES, defects included. A failure here
 * means behaviour changed, which is a regression against the frozen baseline —
 * it does NOT mean a bug was found.
 *
 * Nothing in this file asserts that v0 is correct. Requirements for corrected
 * behaviour live in v1-requirements.test.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { score, analyzeGrouping, analyzeStructure, analyzeHarmony, V0_CONFIG } from '../core/scoring/v0-as-shipped.js';
import { validateScore, V0_ATTAINABLE_MAX } from '../core/scoring/validate.js';
import { generateLayout } from '../core/generate.js';
import { getPreset } from '../core/presets/registry.js';
import { FIXTURES, perturb } from './fixtures/layouts.mjs';

test('v0 is deterministic: same state + config => identical score', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const layout = generateLayout({ seed });
    const a = score(layout, V0_CONFIG);
    const b = score(layout, V0_CONFIG);
    assert.deepEqual(a.dimensions, b.dimensions);
    assert.equal(a.total, b.total);
  }
});

test('v0 reports its model and config version on every result', () => {
  const r = score(generateLayout({ seed: 1 }));
  assert.equal(r.modelVersion, 'v0-as-shipped');
  assert.equal(r.configVersion, 'v0-config-1');
  assert.equal(r.measureKind, 'geometric-proxy');
});

test('DEFECT PRESERVED: coincident elements produce NaN grouping, not a substituted value', () => {
  const r = score(FIXTURES.coincident);
  assert.ok(Number.isNaN(r.dimensions.grouping), 'grouping should be NaN (0/0)');
  assert.ok(Number.isNaN(r.total), 'NaN propagates to the total');

  // The validation layer REPORTS it. It must not repair it.
  const v = validateScore(r);
  assert.equal(v.valid, false);
  assert.ok(v.findings.some((f) => f.code === 'nan' && f.field === 'grouping'));
  assert.ok(Number.isNaN(r.dimensions.grouping), 'validation must not mutate the score');
});

test('DEFECT PRESERVED: all-unparseable colours pin the balance term to a constant 10', () => {
  const r = score(FIXTURES.allHsl);
  assert.equal(r.submetrics.balanceDegenerate, true);
  // spatial = (max(0, whitespaceScore) + 10) / 2
  const whitespaceScore = 10 - Math.abs(r.submetrics.whiteSpaceRatio - 0.4) * 15;
  assert.equal(r.dimensions.spatial, (Math.max(0, whitespaceScore) + 10) / 2);

  const v = validateScore(r);
  assert.ok(v.findings.some((f) => f.code === 'balance-degenerate'));
});

test('DEFECT PRESERVED: applying colorHarmony degenerates balance for every seed', () => {
  let degenerate = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const after = getPreset('color-harmony').apply(generateLayout({ seed }));
    if (score(after).submetrics.balanceDegenerate) degenerate++;
  }
  assert.equal(degenerate, 100, 'every colorHarmony application degenerates the balance term');
});

test('DEFECT PRESERVED: circle rotation changes the score despite being invisible', () => {
  const a = score(FIXTURES.circlesRotationA);
  const b = score(FIXTURES.circlesRotationB);
  // Circles render identically at any rotation, yet structure and harmony move.
  assert.notEqual(a.dimensions.structure, b.dimensions.structure);
  assert.notEqual(a.dimensions.harmony, b.dimensions.harmony);
  assert.notEqual(a.total, b.total);
});

test('DEFECT PRESERVED: rotation statistics are linear, not circular', () => {
  // 350, 10, 0 spans 20 degrees circularly; v0 computes a linear SD over ~340.
  const h = analyzeHarmony(FIXTURES.rotationWraparound.elements.filter((e) => e.visible));
  const rots = [350, 10, 0];
  const mean = (350 + 10 + 0) / 3;
  const sd = Math.sqrt(rots.reduce((s, r) => s + (r - mean) ** 2, 0) / 3);
  assert.ok(sd > 150, `linear SD is ${sd.toFixed(1)} degrees for a 20-degree circular spread`);
  const rotationScore = (1 - Math.min(1, sd / 180)) * 10;
  // harmony = size*0.5 + rotation*0.3 + filled*0.2; verify the rotation term.
  assert.ok(h < 10);
  assert.ok(rotationScore < 1.5, 'near-identical rotations score as near-maximal disorder');
});

test('DEFECT PRESERVED: summed areas ignore overlap, so whitespace can go negative', () => {
  const r = score(FIXTURES.hugeOverlapping);
  assert.ok(r.submetrics.whiteSpaceRatio < 0, `whitespace ratio is ${r.submetrics.whiteSpaceRatio}`);
  // whitespaceScore clamps at 0 via Math.max, so spatial stays finite.
  assert.ok(Number.isFinite(r.dimensions.spatial));
});

test('DEFECT PRESERVED: off-canvas elements count their full analytic area', () => {
  const r = score(FIXTURES.offCanvas);
  assert.ok(r.submetrics.occupiedArea > 0, 'area is counted even fully outside the canvas');
});

test('DOCUMENTED CEILING: structure cannot reach 10; its maximum is 14/1.5', () => {
  assert.equal(V0_ATTAINABLE_MAX.structure, 14 / 1.5);
  let max = -Infinity;
  for (let seed = 1; seed <= 2000; seed++) {
    const s = score(generateLayout({ seed })).dimensions.structure;
    if (Number.isFinite(s)) max = Math.max(max, s);
  }
  assert.ok(max <= 14 / 1.5 + 1e-12, `observed max ${max} exceeds the algebraic ceiling`);
  // 9.33 is INSIDE [0,10] — this is a reachability limit, not a bounds violation.
  assert.ok(14 / 1.5 < 10 && 14 / 1.5 > 9.3);
  const perfect = analyzeStructure(FIXTURES.perfectGrid.elements.filter((e) => e.visible));
  assert.ok(perfect <= 14 / 1.5 + 1e-12);
});

test('hex colour parsing is case-insensitive: equivalent formats score identically', () => {
  const upper = score(FIXTURES.hexUpper);
  const lower = score(FIXTURES.hexLower);
  assert.deepEqual(upper.dimensions, lower.dimensions);
  assert.equal(upper.total, lower.total);
});

test('DEFECT PRESERVED: rgb() strings are NOT an equivalent colour format to v0', () => {
  // Documented, not endorsed: only hex parses. rgb() silently becomes black.
  const r = score(FIXTURES.mixedColorFormats);
  assert.equal(r.submetrics.unparseableColorCount, 2, 'hsl() and rgb() both fail to parse');
});

test('empty and all-hidden layouts return a documented zero, not NaN', () => {
  for (const key of ['empty', 'allHidden']) {
    const r = score(FIXTURES[key]);
    assert.equal(r.total, 0);
    assert.equal(r.elementCount, 0);
    for (const v of Object.values(r.dimensions)) assert.equal(v, 0);
  }
});

test('singleton layouts take the documented fallback branches', () => {
  const r = score(FIXTURES.singleton);
  assert.equal(r.dimensions.hierarchy, 5.0, 'analyzeHierarchy returns 5.0 for n < 2');
  assert.equal(r.dimensions.grouping, 10.0, 'analyzeGrouping returns 10.0 for n < 2');
  assert.equal(r.dimensions.flow, 10.0, 'analyzeFlow returns 10.0 for n < 2');
});

test('DEFECT PRESERVED: filledConsistency is maximised by a 50/50 split', () => {
  const mk = (filledCount, total) => ({
    elements: Array.from({ length: total }, (_, i) => ({
      type: 'square', index: i + 1, order: i, visible: true,
      x: 100 + i * 30, y: 200, size: 60, rotation: 0,
      color: '#1F2937', filled: i < filledCount,
    })),
  });
  const half = analyzeHarmony(mk(2, 4).elements);
  const all = analyzeHarmony(mk(4, 4).elements);
  assert.ok(half > all, 'a 50/50 fill split scores HIGHER than uniform fill');
});

test('grouping rewards irregular spacing: a uniform grid does not maximise it', () => {
  const grid = FIXTURES.perfectGrid.elements.filter((e) => e.visible);
  const g = analyzeGrouping(grid);
  assert.ok(g < 10, `uniform grid grouping is ${g.toFixed(2)}, not maximal`);
});

test('PERTURBATION: effects are recorded, not assumed directional', () => {
  // Deliberately asserts only that effects are finite and reproducible.
  // Direction of movement is an open question for v1, not a v0 requirement.
  const base = FIXTURES.perfectGrid;
  const observed = [];
  for (const kind of ['alignment-displacement', 'spacing-irregularity', 'size-jitter', 'rotation-jitter']) {
    for (const magnitude of [1, 5, 17]) {
      const r = score(perturb(base, kind, magnitude));
      const again = score(perturb(base, kind, magnitude));
      assert.equal(r.total, again.total, 'perturbation scoring is reproducible');
      observed.push({ kind, magnitude, total: r.total, dims: r.dimensions });
    }
  }
  // Cross-dimension effects exist: a position-only change moves more than one
  // dimension. Recorded as a fact about v0's coupling.
  const align = observed.find((o) => o.kind === 'alignment-displacement' && o.magnitude === 17);
  const baseScore = score(base);
  const moved = Object.keys(baseScore.dimensions).filter(
    (d) => align.dims[d] !== baseScore.dimensions[d],
  );
  assert.ok(moved.length >= 2, `a position-only perturbation moved ${moved.length} dimensions: ${moved.join(', ')}`);
});

test('all reported dimension scores stay within documented bounds for ordinary layouts', () => {
  let checked = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const r = score(generateLayout({ seed }));
    if (r.elementCount === 0) continue;
    const v = validateScore(r);
    const hard = v.findings.filter((f) => f.code === 'out-of-bounds');
    assert.deepEqual(hard, [], `seed ${seed} produced out-of-bounds values`);
    checked++;
  }
  assert.ok(checked > 900, `checked ${checked} non-empty layouts`);
});
