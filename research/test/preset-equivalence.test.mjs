/**
 * DIRECT preset-state equivalence: original JavaScript vs extracted port.
 *
 * WHY THIS EXISTS
 * The first milestone verified presets only INDIRECTLY — it applied each preset
 * on both sides and compared the resulting SCORES. That is weaker than it was
 * described as being. A score is a lossy projection of a layout: v0 reads only
 * x, y, size, size2, rotation, colour and filled, and it collapses them through
 * means, counts and clipped terms. Several real transcription errors would
 * survive a score comparison unchanged, for example:
 *
 *   - swapping two elements of identical size and colour (means are unchanged)
 *   - a sign error that mirrors the whole composition about the canvas centre
 *   - any change to an INVISIBLE element (never scored at all)
 *   - a size2 error on a non-rectangle (size2 only enters area for rectangles)
 *
 * These tests compare per-element geometry directly, so the equivalence claim
 * rests on state rather than on a projection of it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadOriginal, applyOriginalPreset } from '../legacy/reference-harness.mjs';
import { getPreset, listPresets } from '../core/presets/registry.js';
import { generateLayout } from '../core/generate.js';
import { FIXTURES } from './fixtures/layouts.mjs';

const original = loadOriginal();
const PRESET_IDS = listPresets().map((p) => p.id);
const PROPS = ['x', 'y', 'size', 'size2', 'rotation', 'color', 'filled', 'visible'];

/**
 * Exact comparison of every element property on both sides.
 * Exact, not approximate: both sides run the same arithmetic in the same engine
 * and the same order, so any difference indicates a transcription error rather
 * than floating-point drift.
 */
function comparePresetState(layout, presetId, label) {
  const ref = applyOriginalPreset(original, layout, presetId);
  const got = getPreset(presetId).apply(layout).elements;

  assert.equal(got.length, ref.length, `${label}: element count differs`);

  const refById = new Map(ref.map((e) => [e.id, e]));
  for (const g of got) {
    const r = refById.get(g.id);
    assert.ok(r, `${label}: element ${g.id} missing from the original result`);
    for (const prop of PROPS) {
      const a = g[prop];
      const b = r[prop];
      if (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b)) continue;
      assert.equal(
        a, b,
        `${label}: ${g.id}.${prop} extracted ${a} !== original ${b}`,
      );
    }
  }
  return { ref, got };
}

test('preset state: every preset over 200 seeded layouts matches element-for-element', () => {
  let comparisons = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const layout = generateLayout({ seed });
    for (const id of PRESET_IDS) {
      comparePresetState(layout, id, `seed-${seed}/${id}`);
      comparisons++;
    }
  }
  assert.equal(comparisons, 200 * 12);
});

test('preset state: INVISIBLE elements are left untouched, identically on both sides', () => {
  // Invisible elements never reach the scorer, so a score comparison could not
  // have caught a divergence here.
  let checkedHidden = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const layout = generateLayout({ seed });
    const hiddenBefore = layout.elements.filter((e) => !e.visible);
    if (hiddenBefore.length === 0) continue;

    for (const id of PRESET_IDS) {
      const { ref, got } = comparePresetState(layout, id, `seed-${seed}/${id}/hidden`);
      const refById = new Map(ref.map((e) => [e.id, e]));
      const gotById = new Map(got.map((e) => [e.id, e]));
      for (const h of hiddenBefore) {
        for (const prop of PROPS) {
          assert.equal(gotById.get(h.id)[prop], h[prop], `${id}: hidden ${h.id}.${prop} was modified`);
          assert.equal(refById.get(h.id)[prop], h[prop], `${id}: original modified hidden ${h.id}.${prop}`);
        }
        checkedHidden++;
      }
    }
  }
  assert.ok(checkedHidden > 500, `checked ${checkedHidden} hidden-element comparisons`);
});

test('preset state: degenerate fixtures match element-for-element', () => {
  for (const [name, layout] of Object.entries(FIXTURES)) {
    for (const id of PRESET_IDS) {
      comparePresetState(layout, id, `fixture:${name}/${id}`);
    }
  }
});

test('preset state: chained presets stay in step across 6 steps', () => {
  // Divergence could appear only after a preset consumes another preset's output
  // (e.g. colour-harmony output feeding visual-hierarchy through getVisualWeight).
  const chains = [
    ['color-harmony', 'visual-hierarchy', 'strict-grid'],
    ['radial-distribution', 'visual-balance', 'bilateral-symmetry'],
    ['size-uniformity', 'rhythmic-spacing', 'proximity-clustering'],
    ['rotation-alignment', 'average-face-direction', 'strict-grid'],
    ['visual-hierarchy', 'color-harmony', 'visual-balance'],
    ['strict-grid', 'shape-grouping', 'radial-distribution'],
  ];
  for (let seed = 1; seed <= 12; seed++) {
    for (const chain of chains) {
      let layout = generateLayout({ seed });
      for (let step = 0; step < chain.length; step++) {
        const id = chain[step];
        comparePresetState(layout, id, `seed-${seed}/chain[${chain.join('>')}]step${step}`);
        layout = getPreset(id).apply(layout);
      }
    }
  }
});

test('preset state: a deliberately corrupted port IS caught (negative control)', () => {
  // Confirms the comparison has teeth. Each perturbation below is one a SCORE
  // comparison could plausibly miss.
  const layout = generateLayout({ seed: 3 });
  const good = getPreset('strict-grid').apply(layout);

  const corruptions = {
    'swap two same-size elements': (els) => {
      const a = els.findIndex((e) => e.visible);
      const b = els.findLastIndex((e) => e.visible);
      if (a === b) return null;
      const copy = els.map((e) => ({ ...e }));
      [copy[a].x, copy[b].x] = [copy[b].x, copy[a].x];
      [copy[a].y, copy[b].y] = [copy[b].y, copy[a].y];
      return copy;
    },
    'mirror about the canvas centre': (els) =>
      els.map((e) => (e.visible ? { ...e, x: 500 - e.x } : { ...e })),
    'modify an invisible element': (els) =>
      els.map((e) => (e.visible ? { ...e } : { ...e, x: e.x + 40 })),
    'size2 error on a non-rectangle': (els) =>
      els.map((e) => (e.visible && e.type !== 'rectangle' ? { ...e, size2: e.size2 + 13 } : { ...e })),
  };

  const ref = applyOriginalPreset(original, layout, 'strict-grid');
  const refById = new Map(ref.map((e) => [e.id, e]));

  for (const [name, corrupt] of Object.entries(corruptions)) {
    const corrupted = corrupt(good.elements);
    if (!corrupted) continue;
    const differs = corrupted.some((g) =>
      PROPS.some((p) => g[p] !== refById.get(g.id)[p]),
    );
    assert.ok(differs, `state comparison failed to detect: ${name}`);
  }
});
