/**
 * Seeded 2,000-pair matched comparison under the STUDY scorer.
 *
 *   node scripts/matched-comparison.mjs [--n 2000]
 *
 * DESIGN — identical to the archived Condition B (docs/AUDIT.md), so only the
 * scorer differs:
 *
 *   source  = strict-grid applied to generateLayout({ seed })
 *   twin    = randomizePositionsMatched(source, { seed: `baseline-${seed}` })
 *             (baseline-2: same inventory and non-position attributes, positions
 *             redrawn inside the region the preset clamps to)
 *   seeds   = 1..n
 *
 * WHAT IS REPORTED, AND HOW EACH IS DEFINED
 *
 *   eligible     both members scorable under the study scorer
 *   unsupported  at least one member not scorable (gate reason codes recorded)
 *   win          eligible and total(source) >  total(twin)
 *   tie          eligible and total(source) === total(twin) (exact IEEE equality)
 *   reversal     eligible and total(source) <  total(twin)
 *
 * Proportions are over ELIGIBLE pairs, and every count is printed so the
 * denominator is never implicit.
 *
 * NOT COMPARABLE WITH THE ARCHIVED 93%. The archived figure (1,860 / 2,000) was
 * produced by `v0-as-shipped`, a different model with different dimensions and
 * no applicability gate. This script does not reuse, restate or adjust it.
 *
 * A win is agreement between the scorer and the construction (grid-structured
 * vs randomised positions). It is not evidence about human perception.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateLayout, randomizePositionsMatched, BASELINE_VERSION, GENERATOR_VERSION } from '../core/generate.js';
import { getPreset, IMPLEMENTATION_VERSION } from '../core/presets/registry.js';
import { score } from '../core/scoring/v1.js';
import { score as scoreR1 } from '../core/scoring/v1-r1-archived.js';
import { MODEL_VERSION, CONFIG_VERSION, SPEC_VERSION } from '../core/scoring/v1-config.js';
import { layoutHash } from '../core/layout.js';
import { RNG_ALGORITHM, RNG_VERSION } from '../core/rng.js';

const i = process.argv.indexOf('--n');
const N = i === -1 ? 2000 : Number(process.argv[i + 1]);
const OUT = join(import.meta.dirname, '..', 'results', 'matched-comparison-v1r2');
mkdirSync(OUT, { recursive: true });

const DIMS = ['hierarchy', 'grouping', 'structure', 'flow', 'spatial', 'variety'];

function wilson(k, n, z = 1.959963984540054) {
  if (n === 0) return [null, null];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

const pairs = [];
for (let s = 1; s <= N; s++) {
  const source = getPreset('strict-grid').apply(generateLayout({ seed: s }));
  const twin = randomizePositionsMatched(source, { seed: `baseline-${s}` });
  const a = score(source);
  const b = score(twin);

  // Diagnostic only: would revision 1 have reached the same outcome, and was
  // revision 1's outcome stable under reversal of the element array?
  const a1 = scoreR1(source); const b1 = scoreR1(twin);
  const a1r = scoreR1({ ...source, elements: [...source.elements].reverse() });
  const b1r = scoreR1({ ...twin, elements: [...twin.elements].reverse() });

  const eligible = a.scorable && b.scorable;
  const delta = eligible ? a.total - b.total : null;
  const outcome = !eligible ? 'unsupported' : delta > 0 ? 'win' : delta < 0 ? 'reversal' : 'tie';
  const sign = (x, y) => (x.scorable && y.scorable ? Math.sign(x.total - y.total) : null);
  pairs.push({
    seed: s,
    sourceStateId: layoutHash(source),
    twinStateId: layoutHash(twin),
    elementCount: a.elementCount,
    sourceScorable: a.scorable,
    twinScorable: b.scorable,
    sourceGate: a.scorable ? '' : a.diagnostics.map((d) => d.code).join('|'),
    twinGate: b.scorable ? '' : b.diagnostics.map((d) => d.code).join('|'),
    sourceTotal: a.total,
    twinTotal: b.total,
    delta,
    outcome,
    dimensionDelta: eligible ? Object.fromEntries(DIMS.map((d) => [d, a.dimensions[d] - b.dimensions[d]])) : null,
    r1Sign: sign(a1, b1),
    r1SignReversedArrays: sign(a1r, b1r),
  });
}

const count = (o) => pairs.filter((p) => p.outcome === o).length;
const eligible = pairs.filter((p) => p.outcome !== 'unsupported');
const wins = count('win'); const ties = count('tie'); const reversals = count('reversal');
const unsupported = pairs.filter((p) => p.outcome === 'unsupported');
const deltas = eligible.map((p) => p.delta).sort((x, y) => x - y);
const q = (f) => (deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(f * deltas.length))] : null);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

const gateCodes = {};
for (const p of unsupported) {
  for (const code of `${p.sourceGate}|${p.twinGate}`.split('|').filter(Boolean)) gateCodes[code] = (gateCodes[code] || 0) + 1;
}

const r1Comparable = pairs.filter((p) => p.r1Sign !== null && p.r1SignReversedArrays !== null);
const summary = {
  generatedAt: new Date().toISOString(),
  provenance: {
    scorer: MODEL_VERSION,
    configVersion: CONFIG_VERSION,
    specVersion: SPEC_VERSION,
    preset: 'strict-grid',
    presetImplementationVersion: IMPLEMENTATION_VERSION,
    baselineVersion: BASELINE_VERSION,
    generatorVersion: GENERATOR_VERSION,
    rng: `${RNG_ALGORITHM}/${RNG_VERSION}`,
    seeds: [1, N],
    twinSeedPattern: 'baseline-<seed>',
    approval: 'DEVELOPMENT CANDIDATE - none of S1-S21 approved',
  },
  definitions: {
    eligible: 'both members scorable under the study scorer',
    unsupported: 'at least one member not scorable',
    win: 'eligible and source total > twin total',
    tie: 'eligible and source total === twin total (exact)',
    reversal: 'eligible and source total < twin total',
    denominator: 'proportions are over eligible pairs',
  },
  counts: {
    pairs: pairs.length,
    eligible: eligible.length,
    unsupported: unsupported.length,
    unsupportedBreakdown: {
      sourceOnly: unsupported.filter((p) => !p.sourceScorable && p.twinScorable).length,
      twinOnly: unsupported.filter((p) => p.sourceScorable && !p.twinScorable).length,
      both: unsupported.filter((p) => !p.sourceScorable && !p.twinScorable).length,
      gateReasonOccurrences: gateCodes,
    },
    wins,
    ties,
    reversals,
    closeWithinHalfPoint: eligible.filter((p) => Math.abs(p.delta) <= 0.5).length,
  },
  proportionsOfEligible: {
    win: eligible.length ? wins / eligible.length : null,
    winWilson95: wilson(wins, eligible.length),
    tie: eligible.length ? ties / eligible.length : null,
    reversal: eligible.length ? reversals / eligible.length : null,
    reversalWilson95: wilson(reversals, eligible.length),
  },
  deltaDistribution: {
    mean: deltas.length ? mean(deltas) : null,
    min: deltas[0] ?? null, p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95),
    max: deltas[deltas.length - 1] ?? null,
  },
  meanDimensionDelta: {
    allEligible: Object.fromEntries(DIMS.map((d) => [d, mean(eligible.map((p) => p.dimensionDelta[d]))])),
    reversalsOnly: reversals
      ? Object.fromEntries(DIMS.map((d) => [d, mean(eligible.filter((p) => p.outcome === 'reversal').map((p) => p.dimensionDelta[d]))]))
      : null,
  },
  revision1Diagnostic: {
    note: 'Revision 1 is the archived, superseded scorer. Reported only to size the effect of the '
      + 'element-order defect on THIS comparison. It is not a result of the study scorer.',
    pairsScorableBothWaysUnderR1: r1Comparable.length,
    outcomeSignChangedByReversingElementArrays: r1Comparable.filter((p) => p.r1Sign !== p.r1SignReversedArrays).length,
    outcomeSignDiffersFromRevision2: pairs.filter((p) => p.outcome !== 'unsupported' && p.r1Sign !== null
      && p.r1Sign !== Math.sign(p.delta)).length,
  },
  archivedFigureNotReused: {
    archived: '1,860 / 2,000 (93%) wins under v0-as-shipped, results/baseline-matched.csv',
    status: 'different scorer; not reused, restated or compared as the same measurement',
  },
};

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
const header = ['seed', 'sourceStateId', 'twinStateId', 'elementCount', 'sourceScorable', 'twinScorable',
  'sourceGate', 'twinGate', 'sourceTotal', 'twinTotal', 'delta', 'outcome', ...DIMS.map((d) => `delta_${d}`),
  'r1Sign', 'r1SignReversedArrays'];
const csv = [header.join(',')].concat(pairs.map((p) => [
  p.seed, p.sourceStateId, p.twinStateId, p.elementCount, p.sourceScorable, p.twinScorable,
  p.sourceGate, p.twinGate, p.sourceTotal ?? '', p.twinTotal ?? '', p.delta ?? '', p.outcome,
  ...DIMS.map((d) => (p.dimensionDelta ? p.dimensionDelta[d] : '')), p.r1Sign ?? '', p.r1SignReversedArrays ?? '',
].join(','))).join('\n');
writeFileSync(join(OUT, 'pairs.csv'), `${csv}\n`);

const pct = (x) => (x === null ? 'n/a' : `${(100 * x).toFixed(2)}%`);
console.log(`matched comparison under ${MODEL_VERSION}  (seeds 1..${N})`);
console.log(`  pairs        ${pairs.length}`);
console.log(`  eligible     ${eligible.length}`);
console.log(`  unsupported  ${unsupported.length}  (source only ${summary.counts.unsupportedBreakdown.sourceOnly}, twin only ${summary.counts.unsupportedBreakdown.twinOnly}, both ${summary.counts.unsupportedBreakdown.both})`);
console.log(`  wins         ${wins}   ${pct(summary.proportionsOfEligible.win)} of eligible  [95% ${summary.proportionsOfEligible.winWilson95.map(pct).join(', ')}]`);
console.log(`  ties         ${ties}`);
console.log(`  reversals    ${reversals}   ${pct(summary.proportionsOfEligible.reversal)} of eligible`);
console.log(`  delta        mean ${summary.deltaDistribution.mean?.toFixed(3)}  p05 ${summary.deltaDistribution.p05?.toFixed(3)}  min ${summary.deltaDistribution.min?.toFixed(3)}  max ${summary.deltaDistribution.max?.toFixed(3)}`);
console.log(`  r1 diagnostic: sign flipped by array reversal in ${summary.revision1Diagnostic.outcomeSignChangedByReversingElementArrays} / ${r1Comparable.length}; differs from r2 in ${summary.revision1Diagnostic.outcomeSignDiffersFromRevision2}`);
console.log(`  written      results/matched-comparison-v1r2/{summary.json,pairs.csv}`);
