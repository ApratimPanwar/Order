/**
 * Reproducible replacement for the ad-hoc 20,000-layout simulation reported in
 * the first audit. That run used an unarchived Python port and unrecorded
 * seeds; this script uses the extracted v0 scorer (which is tested for exact
 * equality against the original JavaScript), explicit seeds, and writes its
 * inputs and outputs to disk.
 *
 *   node scripts/baseline-distribution.mjs [--n 20000] [--seed-offset 0] [--out results/]
 *
 * WHAT THIS IS AND IS NOT
 *
 * It characterises the distribution of v0 scores over the tool's OWN unseeded
 * generator parameter ranges. It is a property of the scorer and that
 * generator, nothing else.
 *
 * It is NOT comparable to the manuscript's Study 1/2/3 means. Those used
 * different element inventories, an unknown scorer build, and (for Study 2) an
 * undocumented pipeline for turning raster AI output into scorable elements.
 * Placing these numbers beside 58.9% or 67.3% as though they came from one
 * controlled experiment would be invalid, and this script does not do it.
 *
 * The `matched` condition IS a controlled comparison: it randomises position
 * only, holding the element inventory and every non-position attribute fixed
 * against a named source layout.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateLayout, randomizePositions, randomizePositionsMatched, BASELINE_VERSION, GENERATOR_VERSION, DEFAULT_PARAMS } from '../core/generate.js';
import { score, MODEL_VERSION, V0_CONFIG } from '../core/scoring/v0-as-shipped.js';
import { validateScore } from '../core/scoring/validate.js';
import { getPreset } from '../core/presets/registry.js';
import { layoutHash, serialize } from '../core/layout.js';
import { RNG_ALGORITHM, RNG_VERSION } from '../core/rng.js';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};

const N = Number(arg('n', 20000));
const SEED_OFFSET = Number(arg('seed-offset', 0));
const OUT = arg('out', join(import.meta.dirname, '..', 'results'));

mkdirSync(OUT, { recursive: true });

const DIMS = ['hierarchy', 'grouping', 'structure', 'flow', 'spatial', 'harmony'];

function stats(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return {
    n: v.length,
    mean: +mean.toFixed(4),
    sd: +sd.toFixed(4),
    min: +v[0].toFixed(4),
    p05: +q(0.05).toFixed(4),
    p50: +q(0.5).toFixed(4),
    p95: +q(0.95).toFixed(4),
    max: +v[v.length - 1].toFixed(4),
  };
}

// --- Condition A: the generator's own parameter ranges ----------------------
const generated = [];
let invalidCount = 0;
let emptyCount = 0;

for (let i = 0; i < N; i++) {
  const seed = SEED_OFFSET + i + 1;
  const layout = generateLayout({ seed });
  const r = score(layout, V0_CONFIG);
  if (r.elementCount === 0) {
    emptyCount++;
    continue; // recorded as excluded, NOT as a zero
  }
  const v = validateScore(r);
  if (!v.valid) invalidCount++;
  generated.push({
    seed,
    stateId: layoutHash(layout),
    elementCount: r.elementCount,
    total: r.total,
    ...Object.fromEntries(DIMS.map((d) => [d, r.dimensions[d]])),
    valid: v.valid,
    findings: v.findings.map((f) => f.code).join('|'),
  });
}

// --- Condition B: matched random-position baseline --------------------------
// For each source layout, apply a structuring preset, then produce a
// position-randomised twin of that SAME layout. Inventory and all non-position
// attributes are identical between the pair, so the only thing that varies is
// spatial arrangement.
const MATCHED_N = Math.min(2000, N);
const matched = [];
const matchedV1 = [];   // baseline-1, retained for comparison with the old run
for (let i = 0; i < MATCHED_N; i++) {
  const seed = SEED_OFFSET + i + 1;
  const source = getPreset('strict-grid').apply(generateLayout({ seed }));
  // baseline-2: per-element bounds matching the preset clamp (corrected support)
  const twin = randomizePositionsMatched(source, { seed: `baseline-${seed}` });
  // baseline-1: full-canvas draw, kept so the confound's size is visible
  const twinV1 = randomizePositions(source, { seed: `baseline-${seed}` });
  {
    const a1 = score(source, V0_CONFIG); const b1 = score(twinV1, V0_CONFIG);
    if (a1.elementCount > 0) matchedV1.push({ delta: a1.total - b1.total });
  }
  const a = score(source, V0_CONFIG);
  const b = score(twin, V0_CONFIG);
  if (a.elementCount === 0) continue;
  matched.push({
    reversedV1: matchedV1.length ? matchedV1[matchedV1.length - 1].delta <= 0 : null,
    seed,
    sourceStateId: layoutHash(source),
    twinStateId: layoutHash(twin),
    elementCount: a.elementCount,
    structuredTotal: a.total,
    randomPositionTotal: b.total,
    delta: a.total - b.total,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  provenance: {
    modelVersion: MODEL_VERSION,
    configVersion: V0_CONFIG.configVersion,
    generatorVersion: GENERATOR_VERSION,
    rngAlgorithm: RNG_ALGORITHM,
    rngVersion: RNG_VERSION,
    seedRange: [SEED_OFFSET + 1, SEED_OFFSET + N],
    generatorParams: DEFAULT_PARAMS,
    equivalenceTested: 'test/equivalence.test.mjs — exact match vs original JS at bf617e4',
  },
  caveats: [
    'Describes v0 over this generator only. Not comparable to manuscript Study 1/2/3 means.',
    'Empty layouts are EXCLUDED and counted, never recorded as zero.',
    'Invalid (NaN) results are counted and flagged, never replaced.',
  ],
  conditionA_generatorRanges: {
    requested: N,
    scored: generated.length,
    excludedEmpty: emptyCount,
    invalid: invalidCount,
    total: stats(generated.map((g) => g.total)),
    dimensions: Object.fromEntries(DIMS.map((d) => [d, stats(generated.map((g) => g[d]))])),
  },
  conditionB_matchedRandomPosition: {
    baselineVersion: BASELINE_VERSION,
    correction: 'baseline-2 samples each element from the SAME per-element region the preset '
      + 'clamps to (size/2 + gridSize). baseline-1 drew from the full canvas, so the two '
      + 'conditions differed in the SUPPORT of their position distributions, not only in '
      + 'arrangement. baseline-1 figures are retained below for comparison and are NOT '
      + 'interchangeable with baseline-2 figures.',
    baseline1_retained: {
      note: 'Previous diagnostic output, preserved. Superseded by baseline-2.',
      delta: stats(matchedV1.map((m) => m.delta)),
      reversals: matchedV1.filter((m) => m.delta <= 0).length,
    },
    n: matched.length,
    randomizedAttributes: ['x', 'y'],
    preservedAttributes: ['inventory', 'type', 'visible', 'size', 'size2', 'rotation', 'color', 'filled', 'order'],
    structuredTotal: stats(matched.map((m) => m.structuredTotal)),
    randomPositionTotal: stats(matched.map((m) => m.randomPositionTotal)),
    delta: stats(matched.map((m) => m.delta)),
    // F7: report the NET RATE CHANGE and the paired TRANSITIONS. The earlier
    // write-up said the confound "explained ~20%" of the reversals. That was a
    // causal claim derived from two aggregate counts, and it is withdrawn: a
    // net drop of 34 can hide any number of flips in both directions, and the
    // support difference is only one of several things that changed.
    reversalAnalysis: (() => {
      const b1 = matchedV1.map((m) => m.delta <= 0);
      const b2 = matched.map((m) => m.delta <= 0);
      const n = Math.min(b1.length, b2.length);
      let stayed = 0; let becameReversal = 0; let ceasedReversal = 0; let neither = 0;
      for (let i = 0; i < n; i++) {
        if (b1[i] && b2[i]) stayed++;
        else if (!b1[i] && b2[i]) becameReversal++;
        else if (b1[i] && !b2[i]) ceasedReversal++;
        else neither++;
      }
      const r1 = b1.filter(Boolean).length;
      const r2 = b2.filter(Boolean).length;
      return {
        pairs: n,
        baseline1Reversals: r1,
        baseline2Reversals: r2,
        baseline1Rate: +(r1 / n).toFixed(4),
        baseline2Rate: +(r2 / n).toFixed(4),
        netRateChangePercentagePoints: +(((r2 - r1) / n) * 100).toFixed(2),
        transitions: { stayedReversal: stayed, ceasedToBeReversal: ceasedReversal, becameReversal, neverReversal: neither },
        interpretation:
          'Net rate change and paired transitions only. This does NOT attribute a '
          + 'share of reversals to the support difference: baseline-2 changes the '
          + 'sampling region for every element, so flips occur in both directions '
          + 'and no causal decomposition is available from these counts.',
      };
    })(),
  },
};

writeFileSync(join(OUT, 'baseline-report.json'), JSON.stringify(report, null, 2));

const csv = (rows, cols) =>
  [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n');

writeFileSync(
  join(OUT, 'baseline-generated.csv'),
  csv(generated, ['seed', 'stateId', 'elementCount', 'total', ...DIMS, 'valid', 'findings']),
);
writeFileSync(
  join(OUT, 'baseline-matched.csv'),
  csv(matched, ['seed', 'sourceStateId', 'twinStateId', 'elementCount', 'structuredTotal', 'randomPositionTotal', 'delta']),
);

// A few full layouts archived so the run is auditable without rerunning it.
const samples = [1, 2, 3].map((i) => {
  const l = generateLayout({ seed: SEED_OFFSET + i });
  return { seed: SEED_OFFSET + i, stateId: layoutHash(l), layout: JSON.parse(serialize(l)) };
});
writeFileSync(join(OUT, 'baseline-sample-layouts.json'), JSON.stringify(samples, null, 2));

console.log(`model=${MODEL_VERSION} config=${V0_CONFIG.configVersion} generator=${GENERATOR_VERSION}`);
console.log(`seeds ${SEED_OFFSET + 1}..${SEED_OFFSET + N}  scored=${generated.length}  excludedEmpty=${emptyCount}  invalid=${invalidCount}`);
console.log('\nCondition A — generator ranges, total score:');
console.log(' ', JSON.stringify(report.conditionA_generatorRanges.total));
console.log('\nCondition B — matched random-position baseline:');
console.log('  structured      ', JSON.stringify(report.conditionB_matchedRandomPosition.structuredTotal));
console.log('  random position ', JSON.stringify(report.conditionB_matchedRandomPosition.randomPositionTotal));
console.log('  delta           ', JSON.stringify(report.conditionB_matchedRandomPosition.delta));
console.log(`\nwrote ${OUT}`);
