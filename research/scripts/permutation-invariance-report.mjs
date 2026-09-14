/**
 * Measures element-array-order dependence for scorer revision 1 (archived) and
 * revision 2 (study scorer) on IDENTICAL layouts and IDENTICAL permutations.
 *
 *   node scripts/permutation-invariance-report.mjs [--seeds 300]
 *
 * Layouts: generateLayout({ seed }) for seeds 1..S, as generated and after each
 * of the 12 registered presets. Permutations per layout: the reversed array plus
 * five seeded shuffles. A layout is "affected" if any permutation changes any
 * submetric by more than 1e-9; bitwise differences are counted separately.
 *
 * Output: results/permutation-invariance/summary.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateLayout } from '../core/generate.js';
import { getPreset, listPresets } from '../core/presets/registry.js';
import { score as scoreR2 } from '../core/scoring/v1.js';
import { score as scoreR1 } from '../core/scoring/v1-r1-archived.js';
import { createRng } from '../core/rng.js';

const i = process.argv.indexOf('--seeds');
const SEEDS = i === -1 ? 300 : Number(process.argv[i + 1]);
const OUT = join(import.meta.dirname, '..', 'results', 'permutation-invariance');
mkdirSync(OUT, { recursive: true });

const variants = [null, ...listPresets().map((p) => p.id)];
const shuffle = (arr, seed) => {
  const rng = createRng(seed);
  const a = [...arr];
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rng.next() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
};

function measure(score) {
  const acc = { layouts: 0, permutedScorings: 0, affectedLayouts: 0, bitwiseDifferences: 0, differencesOver1e9: 0, maxAbsTotalDelta: 0, affectedSubmetrics: {} };
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (const pid of variants) {
      let L = generateLayout({ seed });
      if (pid) L = getPreset(pid).apply(L);
      const base = score(L);
      if (!base.scorable) continue;
      acc.layouts++;
      let affected = false;
      const perms = [[...L.elements].reverse(), ...[0, 1, 2, 3, 4].map((k) => shuffle(L.elements, `perm-${seed}-${pid}-${k}`))];
      for (const els of perms) {
        const s = score({ ...L, elements: els });
        acc.permutedScorings++;
        if (s.total !== base.total || JSON.stringify(s.submetrics) !== JSON.stringify(base.submetrics)) acc.bitwiseDifferences++;
        let over = false;
        for (const [id, v] of Object.entries(base.submetrics)) {
          if (Math.abs(v - s.submetrics[id]) > 1e-9) { acc.affectedSubmetrics[id] = (acc.affectedSubmetrics[id] || 0) + 1; over = true; }
        }
        if (over) { acc.differencesOver1e9++; affected = true; }
        acc.maxAbsTotalDelta = Math.max(acc.maxAbsTotalDelta, Math.abs(s.total - base.total));
      }
      if (affected) acc.affectedLayouts++;
    }
  }
  return acc;
}

const revision1 = measure(scoreR1);
const revision2 = measure(scoreR2);
const summary = {
  generatedAt: new Date().toISOString(),
  design: {
    seeds: [1, SEEDS],
    variants: variants.map((v) => v ?? 'as-generated'),
    permutationsPerLayout: 'reversed array + 5 seeded shuffles',
    affectedDefinition: 'any submetric changes by more than 1e-9 under any permutation',
  },
  revision1: { scorer: 'v1-development-candidate (archived)', ...revision1 },
  revision2: { scorer: 'v1-development-candidate-2 (study scorer)', ...revision2 },
};
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ revision1, revision2 }, null, 2));
