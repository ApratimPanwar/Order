/**
 * SYNTHETIC TEST DATA — clearly marked, never study data.
 *
 * Degenerate and perturbation fixtures. These exist to document what v0 does at
 * the edges, not to assert what it should do.
 */

import { createLayout } from '../../core/layout.js';

const el = (over = {}) => ({
  type: 'circle', index: 1, order: 0, visible: true,
  x: 250, y: 250, size: 60, rotation: 0, color: '#1F2937', filled: true,
  ...over,
});

export const FIXTURES = {
  empty: createLayout({ id: 'fx-empty', elements: [] }),

  allHidden: createLayout({
    id: 'fx-all-hidden',
    elements: [el({ visible: false }), el({ type: 'square', index: 2, order: 1, visible: false })],
  }),

  singleton: createLayout({ id: 'fx-singleton', elements: [el()] }),

  // avgDist === 0 => stdDev/avgDist === 0/0 === NaN in analyzeGrouping.
  coincident: createLayout({
    id: 'fx-coincident',
    elements: [
      el({ index: 1, order: 0 }),
      el({ type: 'square', index: 1, order: 1 }),
      el({ type: 'triangle', index: 1, order: 2 }),
    ],
  }),

  // Summed areas exceed the canvas => negative whitespace.
  hugeOverlapping: createLayout({
    id: 'fx-huge-overlapping',
    elements: [
      el({ type: 'square', index: 1, order: 0, size: 480, x: 250, y: 250 }),
      el({ type: 'square', index: 2, order: 1, size: 470, x: 251, y: 251 }),
      el({ type: 'square', index: 3, order: 2, size: 460, x: 249, y: 249 }),
    ],
  }),

  // Entirely outside the canvas; v0 still counts full analytic area.
  offCanvas: createLayout({
    id: 'fx-off-canvas',
    elements: [
      el({ x: -400, y: -400 }),
      el({ type: 'square', index: 2, order: 1, x: 1200, y: 1400, size: 90 }),
    ],
  }),

  // Every colour unparseable => saturation 0 and balance pinned to 10.
  allHsl: createLayout({
    id: 'fx-all-hsl',
    elements: [
      el({ color: 'hsl(210, 70%, 45%)' }),
      el({ type: 'square', index: 2, order: 1, x: 100, y: 100, color: 'hsl(30, 70%, 50%)' }),
      el({ type: 'rectangle', index: 3, order: 2, x: 400, y: 420, size: 70, size2: 105, color: 'hsl(120, 70%, 55%)' }),
    ],
  }),

  // Mixed: one parseable colour keeps totalWeight > 0.
  mixedColorFormats: createLayout({
    id: 'fx-mixed-colors',
    elements: [
      el({ color: '#1F2937' }),
      el({ type: 'square', index: 2, order: 1, x: 120, y: 380, color: 'hsl(30, 70%, 50%)' }),
      el({ type: 'triangle', index: 3, order: 2, x: 400, y: 120, color: 'rgb(31, 41, 55)' }),
    ],
  }),

  // Hex case sensitivity: the regex is /i, so these must score identically.
  hexUpper: createLayout({
    id: 'fx-hex-upper',
    elements: [el({ color: '#1F2937' }), el({ type: 'square', index: 2, order: 1, x: 300, y: 300, color: '#DC2626' })],
  }),
  hexLower: createLayout({
    id: 'fx-hex-lower',
    elements: [el({ color: '#1f2937' }), el({ type: 'square', index: 2, order: 1, x: 300, y: 300, color: '#dc2626' })],
  }),

  // Circles differing ONLY in rotation — visually identical, and a v1 target.
  circlesRotationA: createLayout({
    id: 'fx-circles-rot-a',
    elements: [
      el({ index: 1, order: 0, x: 150, y: 150, rotation: 0 }),
      el({ index: 2, order: 1, x: 350, y: 150, rotation: 0 }),
      el({ index: 3, order: 2, x: 250, y: 350, rotation: 0 }),
    ],
  }),
  circlesRotationB: createLayout({
    id: 'fx-circles-rot-b',
    elements: [
      el({ index: 1, order: 0, x: 150, y: 150, rotation: 37 }),
      el({ index: 2, order: 1, x: 350, y: 150, rotation: 211 }),
      el({ index: 3, order: 2, x: 250, y: 350, rotation: 298 }),
    ],
  }),

  // Rotations straddling 0/360 — linear SD sees ~340 degrees of spread.
  rotationWraparound: createLayout({
    id: 'fx-rotation-wraparound',
    elements: [
      el({ type: 'square', index: 1, order: 0, x: 150, y: 150, rotation: 350 }),
      el({ type: 'square', index: 2, order: 1, x: 350, y: 150, rotation: 10 }),
      el({ type: 'square', index: 3, order: 2, x: 250, y: 350, rotation: 0 }),
    ],
  }),

  // Perfectly grid-aligned, uniform: the "maximum structure" probe.
  perfectGrid: createLayout({
    id: 'fx-perfect-grid',
    elements: [0, 1, 2, 3].map((i) =>
      el({
        type: 'square',
        index: i + 1,
        order: i,
        x: 120 + (i % 2) * 160,
        y: 120 + Math.floor(i / 2) * 160,
        size: 80,
        rotation: 0,
      }),
    ),
  }),
};

/**
 * Controlled perturbations of a base layout.
 * Expectations are recorded per test; a perturbation is NOT assumed to move the
 * total score in any particular direction.
 */
export function perturb(layout, kind, magnitude) {
  const next = JSON.parse(JSON.stringify(layout));
  switch (kind) {
    case 'alignment-displacement':
      next.elements.forEach((e, i) => {
        if (e.visible) e.x += (i % 2 === 0 ? 1 : -1) * magnitude;
      });
      break;
    case 'spacing-irregularity':
      next.elements.forEach((e, i) => {
        if (e.visible) e.x += i * magnitude;
      });
      break;
    case 'size-jitter':
      next.elements.forEach((e, i) => {
        if (e.visible) e.size = Math.max(1, e.size + (i % 3 - 1) * magnitude);
      });
      break;
    case 'rotation-jitter':
      next.elements.forEach((e, i) => {
        if (e.visible) e.rotation += (i % 2 === 0 ? 1 : -1) * magnitude;
      });
      break;
    default:
      throw new Error(`unknown perturbation: ${kind}`);
  }
  next.id = `${layout.id}/${kind}@${magnitude}`;
  return next;
}
