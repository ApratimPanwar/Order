/**
 * Diagnostic preservation of the 174/2000 reversal cases.
 *
 *   node scripts/reversal-diagnostics.mjs
 *
 * WHAT A "REVERSAL" IS HERE
 * In the matched random-position baseline, each pair holds the element
 * inventory and every non-position attribute fixed, applies `strict-grid` to
 * produce the structured member, and randomises only x and y to produce its
 * twin. A reversal is a pair where v0 scores the RANDOM-POSITION twin at least
 * as high as the grid-structured original.
 *
 * WHAT A REVERSAL IS NOT
 * It is NOT evidence that v0 disagrees with human perception, because no human
 * has judged these layouts. It is a statement about v0 and this preset only:
 * under its own objective, imposing a grid did not raise the score. Three
 * readings remain open and this data cannot separate them:
 *
 *   (a) v0 is mis-measuring order in these cases;
 *   (b) `strict-grid` genuinely produced a worse layout here (e.g. by snapping
 *       elements into collisions or pushing them into the padding clamp);
 *   (c) the layouts really are close in order and the sign is noise.
 *
 * Distinguishing them needs human ratings on these same archived layouts,
 * which is exactly what makes them useful as a pre-selected stimulus set.
 *
 * Output: results/reversals/ — full layouts for both members of each pair,
 * per-dimension breakdowns, and a summary. Layouts are archived so the same
 * stimuli can be rated later without rerunning anything.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateLayout, randomizePositions } from '../core/generate.js';
import { getPreset } from '../core/presets/registry.js';
import { score, V0_CONFIG, MODEL_VERSION } from '../core/scoring/v0-as-shipped.js';
import { serialize, layoutHash } from '../core/layout.js';

const OUT = join(import.meta.dirname, '..', 'results', 'reversals');
mkdirSync(OUT, { recursive: true });

const DIMS = ['hierarchy', 'grouping', 'structure', 'flow', 'spatial', 'harmony'];
const WEIGHTS = V0_CONFIG.weights;
const N = 2000;

const pairs = [];
for (let i = 0; i < N; i++) {
  const seed = i + 1;
  const structured = getPreset('strict-grid').apply(generateLayout({ seed }));
  const twin = randomizePositions(structured, { seed: `baseline-${seed}` });
  const a = score(structured, V0_CONFIG);
  const b = score(twin, V0_CONFIG);
  if (a.elementCount === 0) continue;
  pairs.push({ seed, structured, twin, a, b, delta: a.total - b.total });
}

const reversals = pairs.filter((p) => p.delta <= 0);

/** Per-dimension contribution to the total, so the source of a reversal is visible. */
function breakdown(a, b) {
  const rows = DIMS.map((d) => {
    const structured = a.dimensions[d];
    const random = b.dimensions[d];
    const w = WEIGHTS[d];
    return {
      dimension: d,
      weight: w,
      structured: +structured.toFixed(4),
      randomPosition: +random.toFixed(4),
      rawDelta: +(structured - random).toFixed(4),
      weightedDelta: +((structured - random) * w * 10).toFixed(4),
    };
  });
  rows.sort((x, y) => x.weightedDelta - y.weightedDelta);
  return rows;
}

const records = reversals.map((p) => ({
  seed: p.seed,
  structuredStateId: layoutHash(p.structured),
  randomPositionStateId: layoutHash(p.twin),
  elementCount: p.a.elementCount,
  structuredTotal: +p.a.total.toFixed(4),
  randomPositionTotal: +p.b.total.toFixed(4),
  delta: +p.delta.toFixed(4),
  breakdown: breakdown(p.a, p.b),
}));

// Which dimension most often drives a reversal?
const driverCounts = {};
for (const r of records) {
  const worst = r.breakdown[0].dimension;
  driverCounts[worst] = (driverCounts[worst] ?? 0) + 1;
}

// Mean weighted delta per dimension, reversals vs all pairs.
const meanBy = (set, key) =>
  Object.fromEntries(
    DIMS.map((d) => {
      const vals = set.map((p) => (p.a.dimensions[d] - p.b.dimensions[d]) * WEIGHTS[d] * 10);
      return [d, +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(4)];
    }),
  );

const summary = {
  generatedAt: new Date().toISOString(),
  provenance: {
    modelVersion: MODEL_VERSION,
    configVersion: V0_CONFIG.configVersion,
    preset: 'strict-grid',
    presetImplementationVersion: getPreset('strict-grid').implementationVersion,
    pairSeeds: [1, N],
    baselineSeedPattern: 'baseline-<seed>',
  },
  definition:
    'A reversal is a matched pair in which the random-position twin scores >= the grid-structured original under v0.',
  notEvidenceOf:
    'Human perceptual disagreement. No human has judged these layouts. See the header of this script for the three open readings.',
  counts: {
    pairs: pairs.length,
    reversals: reversals.length,
    proportion: +(reversals.length / pairs.length).toFixed(4),
  },
  meanWeightedDelta: {
    allPairs: meanBy(pairs),
    reversalsOnly: meanBy(reversals),
  },
  reversalDriverCounts: driverCounts,
  limitations: [
    'CONFOUND IN THIS BASELINE: randomizePositions draws x,y uniformly over the FULL canvas [0,500], while strict-grid clamps each element to size/2 + gridSize from the edges. The two conditions therefore differ in the SUPPORT of their position distributions, not only in arrangement. Since v0 hierarchy includes positionFactor = 1 - dist(centre)/maxDist and analyzeHierarchy rewards the RANGE and VARIANCE of visual weights, the random twin can reach more extreme centre-distances and so obtain a wider weight spread. Part of the hierarchy gap is attributable to this, not to arrangement quality. A corrected baseline should sample positions from the same reachable region the preset clamps to.',
    'Single preset (strict-grid). Other presets may reverse for different reasons.',
    'Harmony is identically 0 across every pair because strict-grid and position randomisation both leave size, rotation and fill untouched, and v0 harmony reads only those. Harmony is structurally blind to position.',
    'No human has rated these layouts. Nothing here speaks to perceptual validity.',
  ],
  deltaRange: {
    min: +Math.min(...records.map((r) => r.delta)).toFixed(4),
    max: +Math.max(...records.map((r) => r.delta)).toFixed(4),
  },
};

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(OUT, 'reversals.json'), JSON.stringify(records, null, 2));
writeFileSync(
  join(OUT, 'reversals.csv'),
  [
    ['seed', 'structuredStateId', 'randomPositionStateId', 'elementCount', 'structuredTotal', 'randomPositionTotal', 'delta',
      ...DIMS.map((d) => `${d}_weightedDelta`)].join(','),
    ...records.map((r) =>
      [r.seed, r.structuredStateId, r.randomPositionStateId, r.elementCount, r.structuredTotal, r.randomPositionTotal, r.delta,
        ...DIMS.map((d) => r.breakdown.find((b) => b.dimension === d).weightedDelta)].join(','),
    ),
  ].join('\n'),
);

// Archive the ten most extreme pairs in full, ready to serve as blind-rating stimuli.
const extreme = [...reversals].sort((x, y) => x.delta - y.delta).slice(0, 10);
writeFileSync(
  join(OUT, 'stimuli-candidates.json'),
  JSON.stringify(
    extreme.map((p) => ({
      seed: p.seed,
      delta: +p.delta.toFixed(4),
      // Deliberately neutral member labels: no "optimized"/"good"/"bad".
      memberA: { stateId: layoutHash(p.structured), layout: JSON.parse(serialize(p.structured)) },
      memberB: { stateId: layoutHash(p.twin), layout: JSON.parse(serialize(p.twin)) },
      condition: { memberA: 'strict-grid', memberB: 'matched-random-position' },
      v0Scores: { memberA: +p.a.total.toFixed(4), memberB: +p.b.total.toFixed(4) },
    })),
    null,
    2,
  ),
);

console.log(`model=${MODEL_VERSION}  pairs=${pairs.length}  reversals=${reversals.length} (${(100 * reversals.length / pairs.length).toFixed(2)}%)`);
console.log(`delta range among reversals: ${summary.deltaRange.min} .. ${summary.deltaRange.max}\n`);
console.log('mean weighted delta (structured - random), points of the 0-100 total:');
console.log('dimension     all pairs   reversals only');
for (const d of DIMS) {
  console.log(
    `${d.padEnd(12)}${String(summary.meanWeightedDelta.allPairs[d]).padStart(10)}${String(summary.meanWeightedDelta.reversalsOnly[d]).padStart(16)}`,
  );
}
console.log('\nmost negative dimension per reversal (the apparent driver):');
for (const [d, n] of Object.entries(driverCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${d.padEnd(12)} ${String(n).padStart(4)}  (${(100 * n / records.length).toFixed(1)}%)`);
}
console.log(`\nwrote ${OUT}`);
