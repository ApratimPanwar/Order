/**
 * SCORER REVISION 2
 *
 * Two findings against revision 1 ('v1-development-candidate'):
 *
 *   R2-1  element-array-order dependence in flow (m_f,1..3)
 *   R2-2  Kendall tau-b counted jointly tied pairs back into both
 *         denominator factors
 *
 * Each is demonstrated against the ARCHIVED revision-1 scorer, so the tests
 * prove the defect was real and not merely that the new code passes, and
 * against independent references. Archived records stay reproducible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  score, kendallTauB, canonicalElementOrder, CANONICAL_ORDER_KEYS,
} from '../core/scoring/v1.js';
import { score as scoreR1, kendallTauB as kendallR1 } from '../core/scoring/v1-r1-archived.js';
import { MODEL_VERSION, ARCHIVED_MODEL_VERSIONS } from '../core/scoring/v1-config.js';
import { generateLayout } from '../core/generate.js';
import { getPreset } from '../core/presets/registry.js';
import { createRng } from '../core/rng.js';
import { createLayout } from '../core/layout.js';

const ROOT = join(import.meta.dirname, '..');

/* ---------------------------------------------------------------------------
 * R2-2  Kendall tau-b
 * ------------------------------------------------------------------------ */

/**
 * Independent reference written from the textbook definition, with the tie
 * counts computed separately from the concordance counts.
 */
function tauBReference(x, y) {
  const n = x.length;
  const n0 = (n * (n - 1)) / 2;
  let n1 = 0; let n2 = 0; let nc = 0; let nd = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (x[i] === x[j]) n1++;
      if (y[i] === y[j]) n2++;
      const s = (x[i] - x[j]) * (y[i] - y[j]);
      if (s > 0) nc++;
      if (s < 0) nd++;
    }
  }
  const den = Math.sqrt((n0 - n1) * (n0 - n2));
  return den === 0 ? 0 : (nc - nd) / den;
}

test('R2-2 reproduced: revision 1 under-counts agreement when pairs are tied in both sequences', () => {
  assert.ok(Math.abs(kendallR1([1, 1, 2], [1, 1, 2]) - 2 / 3) < 1e-12, 'revision 1 returned 0.667 for identical sequences');
  assert.equal(kendallR1([1, 1, 2, 3], [1, 1, 3, 2]), 0.5);
});

test('R2-2 fixed: tau-b matches hand-derived and published reference values', () => {
  // Identical sequences are perfectly concordant, ties or not.
  assert.equal(kendallTauB([1, 1, 2], [1, 1, 2]), 1);
  assert.equal(kendallTauB([1, 1, 2], [2, 2, 1]), -1);
  // n0 = 6, one joint tie so n1 = n2 = 1, nc = 4, nd = 1: 3 / sqrt(5 * 5) = 0.6
  assert.ok(Math.abs(kendallTauB([1, 1, 2, 3], [1, 1, 3, 2]) - 0.6) < 1e-15);
  // The worked example in the SciPy documentation for scipy.stats.kendalltau
  // (tau-b variant): x = [12, 2, 1, 12, 2], y = [1, 4, 7, 1, 0].
  assert.ok(Math.abs(kendallTauB([12, 2, 1, 12, 2], [1, 4, 7, 1, 0]) - -0.47140452079103173) < 1e-15);
  // Undefined when a sequence is constant.
  assert.equal(kendallTauB([1, 1, 1, 1], [1, 2, 3, 4]), 0);
  assert.equal(kendallTauB([3], [3]), 0);
  // Unchanged where revision 1 was already right: no ties.
  assert.equal(kendallTauB([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.equal(kendallTauB([1, 2, 3, 4], [4, 3, 2, 1]), -1);
});

test('R2-2 fixed: tau-b agrees with the independent reference on 2,000 seeded tied sequences', () => {
  const rng = createRng('tau-b-reference');
  for (let t = 0; t < 2000; t++) {
    const n = 2 + rng.int(0, 10);
    const levels = 1 + rng.int(0, 4);        // few levels => many ties, many joint ties
    const x = Array.from({ length: n }, () => rng.int(1, levels));
    const y = Array.from({ length: n }, () => rng.int(1, levels));
    const got = kendallTauB(x, y);
    const ref = tauBReference(x, y);
    assert.ok(Math.abs(got - ref) < 1e-12, `x=${x} y=${y}: ${got} vs ${ref}`);
    assert.ok(Math.abs(got - kendallTauB(y, x)) < 1e-12, 'symmetric');
    assert.ok(got >= -1 - 1e-12 && got <= 1 + 1e-12, 'bounded');
  }
});

test('R2-2 scope: flow m_f,2 passes two tie-free rank sequences, so revision-1 flow scores were not affected by this defect', () => {
  // Documented so the correction is not over-claimed: pathRank is 0..n-1 and
  // readSeq is a permutation of 0..n-1. Neither contains ties.
  const src = readFileSync(join(ROOT, 'core/scoring/v1.js'), 'utf8');
  assert.ok(src.includes('const pathRank = path.map((_, r) => r);'));
  assert.ok(src.includes('const readSeq = path.map((idx) => readRank.get(idx));'));
});

/* ---------------------------------------------------------------------------
 * R2-1  element-array-order dependence
 * ------------------------------------------------------------------------ */

/** Four identical squares on a 2 x 2 grid plus a stacked column: exact ties everywhere. */
function tiedLayout() {
  const el = (i, x, y, extra = {}) => ({
    id: `e${i}`, type: 'square', index: i, order: i, visible: true,
    x, y, size: 60, size2: 60, rotation: 0, color: '#374151', filled: true, ...extra,
  });
  return createLayout({
    id: 'tied',
    canvas: { width: 500, height: 500, background: '#FFFFFF' },
    renderer: { gridOverlay: false, gridSize: 8, showArrows: false },
    elements: [
      el(1, 150, 150), el(2, 350, 150), el(3, 150, 350), el(4, 350, 350),
      el(5, 250, 230), el(6, 250, 270),
    ],
    meta: { rendererVersion: 'renderer-2' },
  });
}

const permutations = (L, seed) => {
  const rng = createRng(seed);
  const out = [[...L.elements].reverse()];
  for (let k = 0; k < 8; k++) {
    const a = [...L.elements];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    out.push(a);
  }
  return out;
};

test('R2-1 reproduced: revision 1 scores the same composition differently when only array order changes', () => {
  const L = tiedLayout();
  const totals = new Set(permutations(L, 'r1').map((els) => scoreR1({ ...L, elements: els }).total));
  totals.add(scoreR1(L).total);
  assert.ok(totals.size > 1, `revision 1 produced ${totals.size} distinct totals for one composition`);
});

test('R2-1 fixed: revision 2 is bitwise invariant to element array order on a fully tied layout', () => {
  const L = tiedLayout();
  const base = score(L);
  assert.equal(base.scorable, true);
  for (const els of permutations(L, 'r2')) {
    const s = score({ ...L, elements: els });
    assert.equal(s.total, base.total);
    assert.deepEqual(s.submetrics, base.submetrics);
    assert.deepEqual(s.dimensions, base.dimensions);
  }
});

test('R2-1 fixed: bitwise permutation invariance on seeded generated and preset layouts', () => {
  const variants = [null, 'strict-grid', 'size-uniformity', 'color-harmony', 'bilateral-symmetry'];
  let checked = 0;
  for (let seed = 1; seed <= 12; seed++) {
    for (const pid of variants) {
      let L = generateLayout({ seed });
      if (pid) L = getPreset(pid).apply(L);
      const base = score(L);
      if (!base.scorable) continue;
      for (const els of permutations(L, `seed-${seed}-${pid}`).slice(0, 4)) {
        const s = score({ ...L, elements: els });
        assert.equal(s.total, base.total, `seed ${seed} ${pid}`);
        assert.deepEqual(s.submetrics, base.submetrics, `seed ${seed} ${pid}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 200, `checked ${checked} permutations`);
});

test('R2-1 rule: ties are broken by geometry and attributes, never by id, index or order', () => {
  assert.deepEqual([...CANONICAL_ORDER_KEYS], ['y', 'x', 'type', 'size', 'size2', 'rotation', 'red', 'green', 'blue', 'filled']);
  const L = tiedLayout();
  const renamed = {
    ...L,
    elements: L.elements.map((e, i) => ({ ...e, id: `zz-${99 - i}`, index: 50 - i, order: 7 * i })),
  };
  assert.equal(score(renamed).total, score(L).total);
  assert.deepEqual(score(renamed).submetrics, score(L).submetrics);

  // Top-to-bottom, then left-to-right.
  const ordered = canonicalElementOrder([...L.elements].reverse()).map((e) => e.id);
  assert.deepEqual(ordered, ['e1', 'e2', 'e5', 'e6', 'e3', 'e4']);

  // Colour is compared as parsed sRGB: notation does not create an ordering.
  const a = { ...L.elements[0], color: '#FFFFFF', id: 'hex' };
  const b = { ...L.elements[0], color: 'rgb(255,255,255)', id: 'rgb' };
  const withA = score({ ...L, elements: [a, ...L.elements.slice(1)] });
  const withB = score({ ...L, elements: [b, ...L.elements.slice(1)] });
  assert.equal(withA.total, withB.total);
});

/* ---------------------------------------------------------------------------
 * archived records
 * ------------------------------------------------------------------------ */

test('ARCHIVE: new scores carry revision 2; archived records keep revision 1 and remain reproducible', () => {
  assert.equal(MODEL_VERSION, 'v1-development-candidate-2');
  assert.deepEqual([...ARCHIVED_MODEL_VERSIONS], ['v1-development-candidate']);

  const key = JSON.parse(readFileSync(join(ROOT, 'study-private/stimulus-key.json'), 'utf8'));
  let reproduced = 0;
  for (const item of key.items) {
    assert.equal(item.modelVersion, 'v1-development-candidate', 'archived key is not relabelled');
    if (!item.v1) continue;
    const layout = JSON.parse(readFileSync(join(ROOT, 'study', 'stimuli', `${item.stimulusId}.json`), 'utf8'));
    const r1 = scoreR1(layout);
    assert.equal(r1.modelVersion, 'v1-development-candidate');
    assert.equal(r1.total, item.v1.total, `${item.stimulusId}: archived revision-1 total must reproduce exactly`);
    reproduced++;
  }
  assert.ok(reproduced >= 12);
});
