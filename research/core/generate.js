/**
 * Reproducible composition generation.
 *
 * Mirrors the parameter ranges of generateNewComposition() (index.bf617e4.html
 * L1592-1612) but draws from a seeded RNG instead of Math.random(). Same seed +
 * same generator version => byte-identical layout.
 *
 * This does NOT reproduce any historical composition. The original draws were
 * unseeded and were never persisted.
 *
 * Note: the README describes "inner 400x400 area (50px margin)"; the source
 * actually uses 100 + rand*300. The source is authoritative here.
 */

import { createLayout, SHAPE_TYPES } from './layout.js';
import { createRng } from './rng.js';

export const GENERATOR_VERSION = 'generate-1';

export const DEFAULT_PARAMS = Object.freeze({
  perType: 4, // 16 elements total
  visibleProbability: 0.6, // source: Math.random() > 0.4
  x: [100, 400],
  y: [100, 400],
  size: [40, 120],
  rectangleAspect: 1.5,
  rotation: [0, 359],
  filledProbability: 0.8, // source: Math.random() > 0.2
  palette: Object.freeze([
    '#1F2937', '#374151', '#4B5563', '#6B7280',
    '#DC2626', '#EA580C', '#D97706', '#65A30D',
  ]),
});

/**
 * @param {object} opts
 * @param {number|string} opts.seed
 * @param {object} [opts.params]
 * @param {object} [opts.canvas]
 * @returns {object} canonical layout, with generation provenance in meta
 */
export function generateLayout({ seed, params = DEFAULT_PARAMS, canvas, id } = {}) {
  if (seed === undefined) throw new Error('generateLayout requires an explicit seed');
  const p = { ...DEFAULT_PARAMS, ...params };
  const rng = createRng(seed);

  const elements = [];
  let order = 0;
  for (const type of SHAPE_TYPES) {
    for (let i = 1; i <= p.perType; i++) {
      // Draw every property unconditionally so the RNG stream does not depend
      // on visibility. This keeps inventories comparable across seeds.
      const visible = rng.next() < p.visibleProbability;
      const x = rng.float(p.x[0], p.x[1]);
      const y = rng.float(p.y[0], p.y[1]);
      const size = rng.float(p.size[0], p.size[1]);
      const rotation = rng.int(p.rotation[0], p.rotation[1]);
      const color = rng.pick(p.palette);
      const filled = rng.next() < p.filledProbability;
      elements.push({
        id: `${type}-${i}`,
        type,
        index: i,
        order: order++,
        visible,
        x,
        y,
        size,
        size2: type === 'rectangle' ? size * p.rectangleAspect : size,
        rotation,
        color,
        filled,
      });
    }
  }

  return createLayout({
    id: id ?? `gen-${rng.seed}`,
    canvas,
    elements,
    meta: {
      generator: {
        version: GENERATOR_VERSION,
        seed: rng.seed,
        seedInput: seed,
        rngAlgorithm: rng.algorithm,
        rngVersion: rng.version,
        params: p,
      },
    },
  });
}

/**
 * Randomises POSITION ONLY, preserving the element inventory and every
 * non-position attribute of the source layout.
 *
 * This is the baseline condition proposed in AUDIT.md finding 15. It is matched
 * to a real layout rather than being an independent draw, so it isolates spatial
 * arrangement from inventory differences. The randomised attribute list is
 * recorded in meta so analyses can state exactly what varied.
 */
export function randomizePositions(layout, { seed, id } = {}) {
  if (seed === undefined) throw new Error('randomizePositions requires an explicit seed');
  const rng = createRng(seed);
  const bounds = {
    x: [0, layout.canvas.width],
    y: [0, layout.canvas.height],
  };
  const elements = layout.elements.map((e) => ({
    ...e,
    x: e.visible ? rng.float(bounds.x[0], bounds.x[1]) : e.x,
    y: e.visible ? rng.float(bounds.y[0], bounds.y[1]) : e.y,
  }));
  return createLayout({
    id: id ?? `randpos-${rng.seed}`,
    canvas: layout.canvas,
    renderer: layout.renderer,
    elements,
    meta: {
      ...layout.meta,
      baseline: {
        kind: 'matched-random-position',
        sourceLayoutId: layout.id,
        randomizedAttributes: ['x', 'y'],
        preservedAttributes: [
          'inventory', 'type', 'index', 'visible',
          'size', 'size2', 'rotation', 'color', 'filled', 'order',
        ],
        bounds,
        seed: rng.seed,
        rngAlgorithm: rng.algorithm,
        rngVersion: rng.version,
      },
    },
  });
}

/**
 * Matched random-position baseline, version 2.
 *
 * CORRECTS A CONFOUND IN v1 (`randomizePositions`). That function drew x,y
 * uniformly over the FULL canvas, while a preset such as `strict-grid` clamps
 * every element to `size/2 + gridSize` from each edge. The two conditions
 * therefore differed in the SUPPORT of their position distributions, not only in
 * arrangement — and because v0/v1 prominence includes a centre-distance term and
 * hierarchy rewards the spread of prominence, part of the measured gap was
 * attributable to that difference rather than to layout quality.
 *
 * This version samples each element from the SAME per-element reachable region
 * the preset clamps to, so the supports coincide.
 *
 * Version: `baseline-2`. Outputs from `baseline-1` are preserved and are NOT
 * comparable to these; the version travels in `meta.baseline.version`.
 */
export const BASELINE_VERSION = 'baseline-2';

export function randomizePositionsMatched(layout, { seed, padding, id } = {}) {
  if (seed === undefined) throw new Error('randomizePositionsMatched requires an explicit seed');
  const rng = createRng(seed);
  const W = layout.canvas.width;
  const H = layout.canvas.height;

  // Documented per-element bounds. `padding` defaults to the strict-grid clamp:
  // size/2 + gridSize, matching presets/registry.js applyStrictGrid.
  const padFor = padding ?? ((e) => e.size / 2 + 8);

  const perElementBounds = {};
  const elements = layout.elements.map((e) => {
    if (!e.visible) return { ...e };
    const p = padFor(e);
    const xLo = Math.min(p, W / 2); const xHi = Math.max(W - p, W / 2);
    const yLo = Math.min(p, H / 2); const yHi = Math.max(H - p, H / 2);
    perElementBounds[e.id] = { x: [xLo, xHi], y: [yLo, yHi], padding: p };
    return { ...e, x: rng.float(xLo, xHi), y: rng.float(yLo, yHi) };
  });

  return createLayout({
    id: id ?? `randpos2-${rng.seed}`,
    canvas: layout.canvas,
    renderer: layout.renderer,
    elements,
    meta: {
      ...layout.meta,
      baseline: {
        version: BASELINE_VERSION,
        kind: 'matched-random-position',
        sourceLayoutId: layout.id,
        randomizedAttributes: ['x', 'y'],
        preservedAttributes: [
          'inventory', 'type', 'index', 'visible',
          'size', 'size2', 'rotation', 'color', 'filled', 'order',
        ],
        boundsRule: 'per-element: [size/2 + gridSize, canvas - (size/2 + gridSize)] — the strict-grid clamp',
        perElementBounds,
        seed: rng.seed,
        rngAlgorithm: rng.algorithm,
        rngVersion: rng.version,
      },
    },
  });
}
