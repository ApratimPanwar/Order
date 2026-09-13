/**
 * Equivalence: extracted v0 scorer vs THE ORIGINAL JAVASCRIPT.
 *
 * The reference side evaluates the archived <script> from index.bf617e4.html in
 * a VM and calls the original functions on original Element instances. It is
 * not a port.
 *
 * Tolerance: exact bit equality is required. Both sides execute the same
 * arithmetic in the same engine and the same order, so any difference at all
 * indicates a transcription error, not floating-point drift. NaN is compared as
 * NaN — a NaN on both sides is agreement, not a failure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadOriginal, toOriginalElements, originalOverall } from '../legacy/reference-harness.mjs';
import { score, V0_CONFIG } from '../core/scoring/v0-as-shipped.js';
import { generateLayout, DEFAULT_PARAMS } from '../core/generate.js';
import { createLayout } from '../core/layout.js';
import { getPreset } from '../core/presets/registry.js';
import { FIXTURES } from './fixtures/layouts.mjs';

const original = loadOriginal();

const DIMS = ['hierarchy', 'grouping', 'structure', 'flow', 'spatial', 'harmony'];

/** Exact comparison that treats NaN === NaN as agreement. */
function sameNumber(a, b, label) {
  if (Number.isNaN(a) && Number.isNaN(b)) return;
  assert.equal(
    a, b,
    `${label}: extracted ${a} !== original ${b}`,
  );
}

function compare(layout, label) {
  const visible = layout.elements.filter((e) => e.visible);
  const originalEls = toOriginalElements(original.Element, layout.elements);
  const ref = originalOverall(original, originalEls);
  const got = score(layout, V0_CONFIG);

  for (const d of DIMS) sameNumber(got.dimensions[d], ref[d], `${label}/${d}`);
  sameNumber(got.total, ref.overall, `${label}/total`);
}

test('equivalence: reference source identity is pinned', async () => {
  const { REFERENCE_COMMIT, REFERENCE_SHA256 } = await import('../legacy/reference-harness.mjs');
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { REFERENCE_FILE } = await import('../legacy/reference-harness.mjs');
  const actual = createHash('sha256').update(readFileSync(REFERENCE_FILE)).digest('hex');
  assert.equal(actual, REFERENCE_SHA256, 'archived reference source has been modified');
  assert.equal(REFERENCE_COMMIT, 'bf617e4712079e26043ea62b2e797844680e9bf3');
});

test('equivalence: 500 seeded random layouts match exactly', () => {
  for (let seed = 1; seed <= 500; seed++) {
    compare(generateLayout({ seed }), `seed-${seed}`);
  }
});

test('equivalence: named edge-case fixtures match exactly', () => {
  for (const [name, layout] of Object.entries(FIXTURES)) {
    compare(layout, `fixture:${name}`);
  }
});

test('equivalence: layouts after every preset match exactly', () => {
  const presetIds = [
    'shape-grouping', 'size-uniformity', 'strict-grid', 'visual-hierarchy',
    'rhythmic-spacing', 'proximity-clustering', 'visual-balance',
    'rotation-alignment', 'average-face-direction', 'bilateral-symmetry',
    'color-harmony', 'radial-distribution',
  ];
  for (let seed = 1; seed <= 15; seed++) {
    const base = generateLayout({ seed });
    for (const id of presetIds) {
      const after = getPreset(id).apply(base, getPreset(id).params);
      compare(after, `seed-${seed}/after:${id}`);
    }
  }
});

test('equivalence: HSL colours (the colorHarmony output) match exactly', () => {
  // The specific case where hexToRgb fails on both sides in the same way.
  for (let seed = 1; seed <= 25; seed++) {
    const base = generateLayout({ seed });
    const harmonised = getPreset('color-harmony').apply(base);
    assert.ok(
      harmonised.elements.filter((e) => e.visible).every((e) => e.color.startsWith('hsl(')),
      'preset should have produced hsl() strings',
    );
    compare(harmonised, `seed-${seed}/hsl`);
  }
});

test('equivalence: rotations near wraparound match exactly', () => {
  const angles = [-360, -350, -15, -1, 0, 1, 14, 15, 16, 344, 345, 359, 360, 361, 719, 720];
  for (const rot of angles) {
    const layout = createLayout({
      id: `rot-${rot}`,
      elements: [
        { type: 'circle', index: 1, order: 0, visible: true, x: 120, y: 140, size: 60, rotation: rot, color: '#1F2937', filled: true },
        { type: 'square', index: 1, order: 1, visible: true, x: 300, y: 220, size: 80, rotation: 360 - Math.abs(rot % 360), color: '#DC2626', filled: false },
        { type: 'triangle', index: 1, order: 2, visible: true, x: 200, y: 330, size: 50, rotation: rot / 2, color: '#65A30D', filled: true },
      ],
    });
    compare(layout, `rotation-${rot}`);
  }
});

test('equivalence: invisible elements are excluded identically', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const base = generateLayout({ seed });
    // Flip every visibility; both sides must agree on the resulting subset.
    const flipped = createLayout({
      ...base,
      elements: base.elements.map((e) => ({ ...e, visible: !e.visible })),
    });
    compare(flipped, `seed-${seed}/visibility-flipped`);
  }
});
