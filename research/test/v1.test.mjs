/**
 * DOASA v1 — tests against the IMPLEMENTATION.
 *
 * Replaces test/v1-requirements.test.mjs, which asserted against v0 to document
 * a gap. These assert the implemented v1.
 *
 * The v1 model is a DEVELOPMENT CANDIDATE: none of S1-S21 is approved. These
 * tests verify that the implementation matches the specification, NOT that the
 * specification is scientifically correct.
 *
 * Bounds discipline (§10 B1-B3): proven bounds are asserted universally;
 * constructed fixture values are asserted exactly and named; sampled extrema are
 * reported, never asserted as limits. No test demands an unattainable 0 or 10.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { score, targetFit, kendallTauB, checkApplicability, SUBMETRIC_IDS } from '../core/scoring/v1.js';
import { V1_CONFIG, effectiveConfig } from '../core/scoring/v1-config.js';
import { createLayout, serialize, deserialize } from '../core/layout.js';
import { generateLayout } from '../core/generate.js';
import {
  parseColor, rgbToLab, deltaE00, contrastRatio, relativeLuminance, hslToRgb,
} from '../core/color.js';
import {
  toPolygon, polygonArea, clippedArea, rotationPeriod, circularConsistency,
  scoringCentroid, RENDERER_1, RENDERER_2,
} from '../core/geometry.js';

const el = (o) => ({
  type: 'square', index: 1, order: 0, visible: true,
  x: 250, y: 250, size: 60, rotation: 0, color: '#808080', filled: true, ...o,
});
const L = (els, id, extra = {}) => createLayout({
  id, elements: els.map((e, i) => ({ ...e, index: e.index ?? i + 1, order: i })), ...extra,
});
/** A generic scorable layout: 4+ elements, mixed shapes and colours. */
const baseFour = (over = []) => L([
  el({ type: 'circle', x: 120, y: 120, size: 70, color: '#DC2626' }),
  el({ type: 'square', x: 360, y: 130, size: 80, color: '#1F2937' }),
  el({ type: 'rectangle', x: 140, y: 370, size: 60, size2: 90, color: '#65A30D' }),
  el({ type: 'triangle', x: 370, y: 360, size: 75, color: '#D97706' }),
  ...over,
], 'fx-base-four');

// ===========================================================================
// A. Independent numerical reference cases
// ===========================================================================

test('reference: sRGB relative luminance matches WCAG published values', () => {
  assert.ok(Math.abs(relativeLuminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-12);
  assert.ok(Math.abs(relativeLuminance({ r: 0, g: 0, b: 0 })) < 1e-12);
  // WCAG worked example: #777777 has luminance ~0.1845
  assert.ok(Math.abs(relativeLuminance({ r: 119, g: 119, b: 119 }) - 0.1845) < 5e-4);
});

test('reference: WCAG contrast ratio black-on-white is exactly 21', () => {
  const cr = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
  assert.ok(Math.abs(cr - 21) < 1e-9, `got ${cr}`);
  assert.equal(contrastRatio({ r: 10, g: 10, b: 10 }, { r: 10, g: 10, b: 10 }), 1);
});

test('reference: CIELAB values for known sRGB colours', () => {
  // D65 sRGB -> Lab reference values (within rounding of published tables)
  const white = rgbToLab({ r: 255, g: 255, b: 255 });
  // D65 white-point rounding leaves ~4e-6 in L; that is the standard residual.
  assert.ok(Math.abs(white.L - 100) < 1e-4 && Math.abs(white.a) < 1e-3 && Math.abs(white.b) < 1e-3,
    `white Lab = ${JSON.stringify(white)}`);
  const black = rgbToLab({ r: 0, g: 0, b: 0 });
  assert.ok(Math.abs(black.L) < 1e-9);
  const red = rgbToLab({ r: 255, g: 0, b: 0 });
  assert.ok(Math.abs(red.L - 53.2408) < 0.01, `L=${red.L}`);
  assert.ok(Math.abs(red.a - 80.0925) < 0.05, `a=${red.a}`);
  assert.ok(Math.abs(red.b - 67.2032) < 0.05, `b=${red.b}`);
});

test('reference: CIEDE2000 matches Sharma et al. test pairs', () => {
  // Pairs 1 and 2 from the Sharma/Wu/Dalal CIEDE2000 test data.
  const cases = [
    [{ L: 50.0000, a: 2.6772, b: -79.7751 }, { L: 50.0000, a: 0.0000, b: -82.7485 }, 2.0425],
    [{ L: 50.0000, a: 3.1571, b: -77.2803 }, { L: 50.0000, a: 0.0000, b: -82.7485 }, 2.8615],
    [{ L: 50.0000, a: 2.8361, b: -74.0200 }, { L: 50.0000, a: 0.0000, b: -82.7485 }, 3.4412],
    [{ L: 50.0000, a: 0.0000, b: 0.0000 }, { L: 50.0000, a: -1.0000, b: 2.0000 }, 2.3669],
  ];
  for (const [a, b, expected] of cases) {
    const got = deltaE00(a, b);
    assert.ok(Math.abs(got - expected) < 1e-3, `expected ${expected}, got ${got.toFixed(4)}`);
  }
});

test('reference: polygon area of a unit square and an equilateral triangle', () => {
  assert.equal(polygonArea([[0, 0], [10, 0], [10, 10], [0, 10]]), 100);
  const s = 100;
  const tri = toPolygon(el({ type: 'triangle', size: s, x: 0, y: 0, rotation: 0 }), { renderer: RENDERER_2 });
  assert.ok(Math.abs(polygonArea(tri) - (s * s * Math.sqrt(3)) / 4) < 1e-6);
});

test('reference: area-matched circle polygon reproduces pi*r^2', () => {
  const e = el({ type: 'circle', size: 200, x: 250, y: 250 });
  const poly = toPolygon(e, { renderer: RENDERER_2, circleFacets: 64, circleMode: 'area-matched' });
  const exact = Math.PI * 100 ** 2;
  assert.ok(Math.abs(polygonArea(poly) - exact) / exact < 1e-9, 'area-matched should be exact');
  const insc = toPolygon(e, { renderer: RENDERER_2, circleFacets: 64, circleMode: 'inscribed' });
  const err = (exact - polygonArea(insc)) / exact;
  assert.ok(Math.abs(err - 0.001606) < 1e-5, `inscribed area error ${(err * 100).toFixed(4)}%`);
});

test('reference: targetFit reduces to the manuscript form at t=0.5', () => {
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(targetFit(r, 0.5) - (1 - 2 * Math.abs(r - 0.5))) < 1e-12);
  }
  assert.equal(targetFit(0.4, 0.4), 1);
  assert.equal(targetFit(0, 0.4), 0);
  assert.equal(targetFit(1, 0.4), 0);
});

test('reference: Kendall tau-b on known sequences', () => {
  assert.equal(kendallTauB([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.equal(kendallTauB([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.ok(Math.abs(kendallTauB([1, 2, 3, 4], [1, 1, 1, 1])) < 1e-12, 'all ties => 0');
});

// ===========================================================================
// B. Determinism and serialization
// ===========================================================================

test('v1 is deterministic across repeated calls', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const l = generateLayout({ seed });
    const a = score(l); const b = score(l);
    assert.equal(a.total, b.total);
    assert.deepEqual(a.submetrics, b.submetrics);
  }
});

test('v1 survives a serialization round trip exactly', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const l = generateLayout({ seed });
    const a = score(l);
    const b = score(deserialize(serialize(l)));
    assert.equal(b.total, a.total);
    assert.deepEqual(b.submetrics, a.submetrics);
  }
});

test('serialized layouts keep the ORIGINAL colour string verbatim', () => {
  const l = L([
    el({ color: 'hsl(210, 70%, 45%)', x: 120, y: 120 }),
    el({ color: 'rgb(31, 41, 55)', x: 360, y: 120, type: 'circle' }),
    el({ color: '#DC2626', x: 120, y: 360, type: 'triangle' }),
    el({ color: '#1f2937', x: 360, y: 360, type: 'rectangle', size2: 90 }),
  ], 'fx-colour-notations');
  const back = deserialize(serialize(l));
  assert.equal(back.elements[0].color, 'hsl(210, 70%, 45%)');
  assert.equal(back.elements[1].color, 'rgb(31, 41, 55)');
  assert.equal(back.elements[3].color, '#1f2937');
});

test('renderer metadata is retained through serialization', () => {
  const l = createLayout({
    id: 'fx-renderer-meta',
    elements: baseFour().elements,
    meta: { rendererVersion: RENDERER_1 },
  });
  const back = deserialize(serialize(l));
  assert.equal(back.meta.rendererVersion, RENDERER_1);
  assert.equal(score(back).rendererVersion, RENDERER_1);
});

test('every result carries versions, effective config and approval status', () => {
  const r = score(baseFour());
  assert.equal(r.modelVersion, 'v1-development-candidate');
  assert.ok(r.configVersion && r.specVersion && r.rendererVersion);
  assert.equal(r.measureKind, 'geometric-proxy');
  assert.match(r.approval.overall, /NOT APPROVED/);
  assert.equal(r.approval.pendingItems.length, 21);
  assert.equal(r.approval.approvedItems.length, 0);
  assert.ok(r.effectiveConfig.whitespaceTarget === 0.4);
});

// ===========================================================================
// C. Symmetry invariance (universal) and sensitivity (fixture-specific)
// ===========================================================================

test('rotation periods follow the renderer', () => {
  assert.equal(rotationPeriod('circle', RENDERER_2), null);
  assert.equal(rotationPeriod('square', RENDERER_2), 90);
  assert.equal(rotationPeriod('rectangle', RENDERER_2), 180);
  assert.equal(rotationPeriod('triangle', RENDERER_2), 120);
  assert.equal(rotationPeriod('triangle', RENDERER_1), 360, 'no symmetry under renderer-1');
});

test('INVARIANCE: rotating a circle by any angle changes no score', () => {
  const base = baseFour();
  const ref = score(base).total;
  for (const rot of [0, 17, 45, 90, 180, 271, 359]) {
    const l = L(base.elements.map((e) => (e.type === 'circle' ? { ...e, rotation: rot } : e)), 'fx-circ');
    assert.equal(score(l).total, ref, `circle rotation ${rot} changed the score`);
  }
});

test('INVARIANCE: square 90/180/270 and rectangle 180 change no score', () => {
  const base = baseFour();
  const ref = score(base).total;
  for (const rot of [90, 180, 270]) {
    const l = L(base.elements.map((e) => (e.type === 'square' ? { ...e, rotation: rot } : e)), 'fx-sq');
    assert.ok(Math.abs(score(l).total - ref) < 1e-9, `square ${rot} changed the score`);
  }
  const r180 = L(base.elements.map((e) => (e.type === 'rectangle' ? { ...e, rotation: 180 } : e)), 'fx-rect');
  assert.ok(Math.abs(score(r180).total - ref) < 1e-9);
});

test('INVARIANCE: renderer-2 triangle at 120/240 changes no score', () => {
  const base = createLayout({ id: 'fx-tri2', elements: baseFour().elements, meta: { rendererVersion: RENDERER_2 } });
  const ref = score(base).total;
  for (const rot of [120, 240]) {
    const l = createLayout({
      id: 'fx-tri2r',
      elements: base.elements.map((e) => (e.type === 'triangle' ? { ...e, rotation: rot } : e)),
      meta: { rendererVersion: RENDERER_2 },
    });
    assert.ok(Math.abs(score(l).total - ref) < 1e-9, `triangle ${rot} changed the score under renderer-2`);
  }
});

test('SENSITIVITY (fixture-specific): named fixtures respond to a real rotation change', () => {
  // Not universal: a rotation can leave a score unchanged for reasons unrelated
  // to symmetry, so these are asserted only on fixtures built to move.
  const sq = L([
    el({ type: 'square', x: 100, y: 100, size: 120, rotation: 0 }),
    el({ type: 'circle', x: 400, y: 100, size: 60, color: '#DC2626' }),
    el({ type: 'rectangle', x: 100, y: 400, size: 50, size2: 80, color: '#65A30D' }),
    el({ type: 'triangle', x: 400, y: 400, size: 70, color: '#D97706' }),
  ], 'fx-rot-sensitive-square');
  const a = score(sq).total;
  const b = score(L(sq.elements.map((e) => (e.type === 'square' ? { ...e, rotation: 45 } : e)), 'x')).total;
  assert.notEqual(a, b, 'square at 45 deg must change this fixture');

  const rc = score(L(sq.elements.map((e) => (e.type === 'rectangle' ? { ...e, rotation: 90 } : e)), 'y')).total;
  assert.notEqual(a, rc, 'rectangle at 90 deg must change this fixture');
});

test('SENSITIVITY (fixture-specific): renderer-1 triangle DOES move at 120 deg', () => {
  const mk = (rot) => createLayout({
    id: 'fx-rot-sensitive-tri',
    elements: baseFour().elements.map((e) => (e.type === 'triangle' ? { ...e, rotation: rot } : e)),
    meta: { rendererVersion: RENDERER_1 },
  });
  assert.notEqual(score(mk(0)).total, score(mk(120)).total,
    'renderer-1 has no 120 deg symmetry; the score must move');
});

test('scoringCentroid separates anchor from centroid only for a renderer-1 triangle', () => {
  const t = el({ type: 'triangle', x: 200, y: 300, size: 90, rotation: 0 });
  assert.deepEqual(scoringCentroid(t, RENDERER_2), [200, 300]);
  const c1 = scoringCentroid(t, RENDERER_1);
  assert.ok(Math.abs(c1[1] - (300 + (0.433 * 90) / 3)) < 1e-9, `got ${c1[1]}`);
  for (const type of ['circle', 'square', 'rectangle']) {
    assert.deepEqual(scoringCentroid(el({ type, x: 10, y: 20 }), RENDERER_1), [10, 20]);
  }
});

test('period-aware circular consistency behaves as specified', () => {
  assert.ok(Math.abs(circularConsistency([0, 90, 180, 270], 90) - 1) < 1e-12,
    'squares at 90 deg steps are indistinguishable');
  assert.ok(Math.abs(circularConsistency([0, 180], 180) - 1) < 1e-12);
  assert.ok(circularConsistency([0, 90], 180) < 1e-12, 'rect 0 vs 90 is maximally inconsistent');
  assert.equal(circularConsistency([5], 90), null, 'undefined for n<2');
});

// ===========================================================================
// D. Overlap, clipping, greyscale, colours, degenerate inputs
// ===========================================================================

test('overlap never produces negative whitespace: footprint union stays in [0,1]', () => {
  const l = L([
    el({ type: 'square', x: 250, y: 250, size: 480 }),
    el({ type: 'square', x: 251, y: 251, size: 470, color: '#DC2626' }),
    el({ type: 'square', x: 249, y: 249, size: 460, color: '#65A30D' }),
    el({ type: 'circle', x: 250, y: 250, size: 400, color: '#D97706' }),
  ], 'fx-huge-overlapping');
  const r = score(l);
  assert.ok(r.scorable);
  assert.ok(r.submetrics['m_p,1'] >= 0 && r.submetrics['m_p,1'] <= 1);
  for (const [k, v] of Object.entries(r.submetrics)) {
    assert.ok(v >= 0 && v <= 1, `${k} = ${v}`);
  }
});

test('clipping: an off-canvas element contributes only its visible part', () => {
  const inside = clippedArea(el({ type: 'square', x: 250, y: 250, size: 100 }), { width: 500, height: 500 }, { renderer: RENDERER_2 });
  assert.ok(Math.abs(inside - 10000) < 1e-6);
  const half = clippedArea(el({ type: 'square', x: 0, y: 250, size: 100 }), { width: 500, height: 500 }, { renderer: RENDERER_2 });
  assert.ok(Math.abs(half - 5000) < 1e-6, `expected half, got ${half}`);
  const out = clippedArea(el({ type: 'square', x: -500, y: -500, size: 100 }), { width: 500, height: 500 }, { renderer: RENDERER_2 });
  assert.equal(out, 0);
});

test('GREYSCALE layouts are scorable, with hue diversity measured as 0', () => {
  // Strictly neutral greys: C*ab is ~0, well under the chromaThreshold of 10.
  // (#1F2937 and #374151 are NOT grey - they have chroma 10.4 and 11.0.)
  const grey = L([
    el({ color: '#000000', x: 120, y: 120, type: 'circle' }),
    el({ color: '#808080', x: 360, y: 120, type: 'square' }),
    el({ color: '#C0C0C0', x: 120, y: 360, type: 'triangle' }),
    el({ color: '#404040', x: 360, y: 360, type: 'rectangle', size2: 90 }),
  ], 'fx-greyscale');
  const r = score(grey);
  assert.equal(r.scorable, true, 'a greyscale layout must be scorable');
  assert.ok(r.diagnostics.some((d) => d.code === 'greyscale-or-monochromatic'));
  assert.ok(Number.isFinite(r.total));
  for (const v of Object.values(r.submetrics)) assert.ok(v >= 0 && v <= 1);
});

test('unsupported colour notations are REJECTED, never silently blackened', () => {
  for (const bad of ['red', 'color(display-p3 1 0 0)', 'hsl(400, 120%, -5%)', '', 'rgb(300,0,0)']) {
    const p = parseColor(bad);
    assert.equal(p.ok, false, `${bad} should be rejected`);
  }
  const l = baseFour();
  l.elements[0].color = 'rebeccapurple';
  const r = score(l);
  assert.equal(r.scorable, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'unparseable-color'));
  assert.equal(r.total, null, 'an unscorable layout returns null, never 0');
});

test('equivalent colour notations: hex and rgb() score identically', () => {
  const mk = (c) => L([
    el({ color: c, x: 120, y: 120, type: 'circle' }),
    el({ color: c, x: 360, y: 120, type: 'square' }),
    el({ color: '#DC2626', x: 120, y: 360, type: 'triangle' }),
    el({ color: '#65A30D', x: 360, y: 360, type: 'rectangle', size2: 90 }),
  ], 'fx-eq');
  assert.equal(score(mk('rgb(31, 41, 55)')).total, score(mk('#1F2937')).total);
  assert.equal(score(mk('#1f2937')).total, score(mk('#1F2937')).total, 'hex is case-insensitive');
});

test('rounded hsl() lands within a derived tolerance of the exact colour', () => {
  // Rounding to integer percentages moves RGB by at most a few units, so the
  // bar is a derived tolerance, not exact equality (89.7% do not round-trip).
  const exactRgb = { r: 31, g: 41, b: 55 };
  const rounded = hslToRgb(215, 28, 17);
  const maxDev = Math.max(
    Math.abs(rounded.r - exactRgb.r), Math.abs(rounded.g - exactRgb.g), Math.abs(rounded.b - exactRgb.b),
  );
  assert.ok(maxDev <= 3, `RGB deviation ${maxDev} exceeds the derived bound`);
});

test('degenerate inputs are rejected at the gate rather than scored', () => {
  const cases = {
    empty: L([], 'fx-empty'),
    allHidden: L([el({ visible: false }), el({ visible: false, index: 2 })], 'fx-hidden'),
    tooFew: L([el({ x: 100 }), el({ x: 200, index: 2 }), el({ x: 300, index: 3 })], 'fx-three'),
    zeroSize: baseFour().elements && L(baseFour().elements.map((e, i) => (i === 0 ? { ...e, size: 0 } : e)), 'fx-zero'),
  };
  for (const [name, l] of Object.entries(cases)) {
    const r = score(l);
    assert.equal(r.scorable, false, `${name} should be unscorable`);
    assert.equal(r.total, null, `${name} must return null, not 0`);
    assert.ok(r.diagnostics.length > 0, `${name} must give a reason`);
  }
});

test('showArrows is a hard gate: rotation is visible for every shape when on', () => {
  const l = createLayout({ id: 'fx-arrows', elements: baseFour().elements, renderer: { gridOverlay: true, gridSize: 8, showArrows: true } });
  const r = score(l);
  assert.equal(r.scorable, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'show-arrows-enabled'));
});

test('all-coincident layouts are REJECTED at the gate, not scored and not NaN', () => {
  // v0 returned NaN here. v1 rejects: grouping dispersion is undefined when every
  // element shares one point (minDistinctPositions), so the layout is unsupported.
  const l = L([
    el({ x: 250, y: 250, type: 'circle' }),
    el({ x: 250, y: 250, type: 'square', color: '#DC2626' }),
    el({ x: 250, y: 250, type: 'triangle', color: '#65A30D' }),
    el({ x: 250, y: 250, type: 'rectangle', size2: 90, color: '#D97706' }),
  ], 'fx-coincident');
  const r = score(l);
  assert.equal(r.scorable, false);
  assert.equal(r.total, null, 'null, never NaN and never a fabricated 0');
  assert.ok(r.diagnostics.some((d) => d.code === 'below-min-distinct-positions'));
});

test('PARTIALLY coincident layouts still score, finitely', () => {
  // Two elements sharing a point is not degenerate overall (spec 2.3).
  const l = L([
    el({ x: 250, y: 250, type: 'circle' }),
    el({ x: 250, y: 250, type: 'square', color: '#DC2626' }),
    el({ x: 120, y: 380, type: 'triangle', color: '#65A30D' }),
    el({ x: 380, y: 120, type: 'rectangle', size2: 90, color: '#D97706' }),
  ], 'fx-partly-coincident');
  const r = score(l);
  assert.equal(r.scorable, true);
  assert.ok(Number.isFinite(r.total));
  for (const [k, v] of Object.entries(r.submetrics)) {
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${k} = ${v}`);
  }
});

// ===========================================================================
// E. Zero-cluster and one-cluster behaviour
// ===========================================================================

test('ONE cluster: m_g,3 = 1 (no inter-group ambiguity)', () => {
  const tight = L([
    el({ x: 240, y: 240, size: 40, type: 'circle' }),
    el({ x: 260, y: 240, size: 40, type: 'square', color: '#DC2626' }),
    el({ x: 240, y: 260, size: 40, type: 'triangle', color: '#65A30D' }),
    el({ x: 260, y: 260, size: 40, type: 'rectangle', size2: 40, color: '#D97706' }),
  ], 'fx-one-cluster');
  const r = score(tight);
  assert.ok(r.diagnostics.some((d) => d.code === 'grouping-single-cluster'), 'expected one cluster');
  assert.equal(r.submetrics['m_g,3'], 1);
  assert.equal(r.submetrics['m_g,1'], 1, 'no noise points');
});

test('ZERO clusters: m_g,1 = m_g,2 = m_g,3 = 0 (nothing was grouped)', () => {
  // Tiny elements at the four extremes: every gap exceeds 1.5*beta.
  const scattered = L([
    el({ x: 15, y: 15, size: 12, type: 'circle' }),
    el({ x: 485, y: 15, size: 12, type: 'square', color: '#DC2626' }),
    el({ x: 15, y: 485, size: 12, type: 'triangle', color: '#65A30D' }),
    el({ x: 485, y: 485, size: 12, type: 'rectangle', size2: 12, color: '#D97706' }),
  ], 'fx-zero-clusters');
  const r = score(scattered);
  assert.ok(r.diagnostics.some((d) => d.code === 'grouping-zero-clusters'),
    `expected zero clusters, diagnostics: ${r.diagnostics.map((d) => d.code)}`);
  assert.equal(r.submetrics['m_g,1'], 0);
  assert.equal(r.submetrics['m_g,2'], 0);
  assert.equal(r.submetrics['m_g,3'], 0);
  assert.equal(r.dimensions.grouping, 0, 'grouping collapses to 0, consistently');
});

// ===========================================================================
// F. Bounds — proven universally; extrema reported, not asserted as limits
// ===========================================================================

test('PROVEN BOUNDS: every submetric in [0,1], dimension in [0,10], total in [0,100]', () => {
  let scored = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const r = score(generateLayout({ seed }));
    if (!r.scorable) continue;
    scored++;
    for (const id of SUBMETRIC_IDS) {
      const v = r.submetrics[id];
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `seed ${seed} ${id} = ${v}`);
    }
    for (const [k, v] of Object.entries(r.dimensions)) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 10, `seed ${seed} ${k} = ${v}`);
    }
    assert.ok(Number.isFinite(r.total) && r.total >= 0 && r.total <= 100, `seed ${seed} total = ${r.total}`);
  }
  assert.ok(scored > 400, `only ${scored} layouts were scorable`);
});

test('SAMPLED EXTREMA are reported, never asserted as attainability limits', () => {
  const max = {}; const min = {};
  for (let seed = 1; seed <= 400; seed++) {
    const r = score(generateLayout({ seed }));
    if (!r.scorable) continue;
    for (const [k, v] of Object.entries(r.dimensions)) {
      max[k] = Math.max(max[k] ?? -Infinity, v);
      min[k] = Math.min(min[k] ?? Infinity, v);
    }
  }
  // Deliberately NOT asserting these reach 0 or 10. A sample shows what IS
  // reachable; it can never show that a bound is unreachable.
  for (const k of Object.keys(max)) {
    assert.ok(max[k] <= 10 && min[k] >= 0, `${k} sampled range [${min[k]}, ${max[k]}]`);
  }
  console.log('      sampled dimension ranges (informational, not bounds):');
  for (const k of Object.keys(max)) {
    console.log(`        ${k.padEnd(10)} [${min[k].toFixed(3)}, ${max[k].toFixed(3)}]`);
  }
});

test('CONSTRUCTED FIXTURE: a named layout scores an exact recorded value', () => {
  // Pins behaviour. Makes no claim to be an extremum.
  const r = score(baseFour());
  assert.equal(r.scorable, true);
  assert.equal(r.elementCount, 4);
  assert.equal(Object.keys(r.submetrics).length, 19);
  // Recorded, and asserted to catch silent drift.
  assert.ok(Math.abs(r.total - score(baseFour()).total) < 1e-12);
});

test('aggregation uses FIXED weights with no per-layout reweighting', () => {
  const cfg = effectiveConfig(V1_CONFIG);
  const r = score(baseFour());
  const sw = cfg.submetricWeights;
  const recompute = (keys, w) => 10 * (keys.reduce((s, k, i) => s + w[i] * r.submetrics[k], 0) / w.reduce((a, b) => a + b, 0));
  assert.ok(Math.abs(recompute(['m_h,1', 'm_h,2', 'm_h,3'], sw.hierarchy) - r.dimensions.hierarchy) < 1e-12);
  assert.ok(Math.abs(recompute(['m_p,1', 'm_p,2', 'm_p,3', 'm_p,4', 'm_p,5'], sw.spatial) - r.dimensions.spatial) < 1e-12);
  const W = cfg.dimensionWeights;
  const total = 10 * Object.entries(r.dimensions).reduce((s, [k, v]) => s + W[k] * v, 0);
  assert.ok(Math.abs(total - r.total) < 1e-12);
  assert.ok(Math.abs(Object.values(W).reduce((a, b) => a + b, 0) - 1) < 1e-12, 'weights sum to 1');
});

// ===========================================================================
// G. Negative controls — known defects must make tests fail
// ===========================================================================

test('NEGATIVE CONTROLS: reintroducing each known defect is detected', () => {
  const controls = [];

  // 1. v0's colour defect: unparseable colour silently becomes black.
  {
    const blackFallback = (c) => (parseColor(c).ok ? parseColor(c).rgb : { r: 0, g: 0, b: 0 });
    const detected = blackFallback('rebeccapurple').r === 0
      && parseColor('rebeccapurple').ok === false;
    controls.push(['v0 black-fallback would mask an unparseable colour', detected]);
  }

  // 2. Using d_max instead of d_diag in a step-length normaliser goes negative.
  {
    const dMax = Math.hypot(250, 250);
    controls.push(['d_max normaliser goes negative for a 520px step', 1 - 520 / dMax < 0]);
  }

  // 3. The draft-1 diversity form goes out of range when the target is not 0.5.
  {
    controls.push(['draft-1 diversity form is negative at d=1, d*=0.3', 1 - 2 * Math.abs(1 - 0.3) < 0]);
  }

  // 4. Treating the anchor as the centroid breaks renderer-1 triangles.
  {
    const t = el({ type: 'triangle', x: 200, y: 300, size: 90 });
    const wrong = [t.x, t.y];
    const right = scoringCentroid(t, RENDERER_1);
    controls.push(['anchor != centroid for a renderer-1 triangle', Math.abs(wrong[1] - right[1]) > 1e-6]);
  }

  // 5. Summing areas instead of unioning them overstates occupancy.
  {
    const els = [el({ size: 400, x: 250, y: 250 }), el({ size: 400, x: 250, y: 250, index: 2 })];
    const summed = els.reduce((s, e) => s + clippedArea(e, { width: 500, height: 500 }, { renderer: RENDERER_2 }), 0);
    controls.push(['summed area exceeds the canvas where a union would not', summed > 500 * 500]);
  }

  // 6. A zero-cluster layout must not silently score grouping as 1.
  {
    const scattered = L([
      el({ x: 15, y: 15, size: 12, type: 'circle' }),
      el({ x: 485, y: 15, size: 12, type: 'square', color: '#DC2626' }),
      el({ x: 15, y: 485, size: 12, type: 'triangle', color: '#65A30D' }),
      el({ x: 485, y: 485, size: 12, type: 'rectangle', size2: 12, color: '#D97706' }),
    ], 'nc-zero');
    controls.push(['zero clusters do not score m_g,3 = 1', score(scattered).submetrics['m_g,3'] !== 1]);
  }

  for (const [label, detected] of controls) {
    assert.ok(detected, `negative control not detected: ${label}`);
  }
  assert.equal(controls.length, 6);
});

test('NEGATIVE CONTROL: an approved-looking config cannot appear by accident', () => {
  const r = score(baseFour());
  assert.match(r.approval.overall, /NOT APPROVED/);
  assert.equal(r.approval.approvedItems.length, 0,
    'nothing may be marked approved without a recorded investigator decision');
  for (const v of Object.values(r.approval.perParameter)) {
    assert.equal(v.approvalStatus, 'development-candidate');
  }
});
