/**
 * Union-approximation error: FIXTURE-SPECIFIC evidence, not a universal bound.
 *
 *   node scripts/union-error-report.mjs
 *
 * The earlier "<1%" figure came from ONE axis-aligned square. That is not a
 * guarantee for arbitrary corpora: error depends on the perimeter-to-area ratio
 * and on how edges fall relative to the sampling lattice. Rotated and small
 * shapes are worse. This measures the ACTUAL corpus at several resolutions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unionFootprintArea, clippedArea, RENDERER_2 } from '../core/geometry.js';
import { deserialize } from '../core/layout.js';

const ROOT = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'study/stimuli/manifest.json'), 'utf8'));
const canvas = { width: 500, height: 500 };
const base = { renderer: RENDERER_2, circleFacets: 64, circleMode: 'area-matched' };

// Reference: the highest resolution we can afford, used as ground truth.
const REF_N = 4096;
const GRIDS = [256, 512, 1024, 2048];

const rows = [];
for (const item of manifest.items) {
  const layout = deserialize(readFileSync(join(ROOT, 'study', item.file), 'utf8'));
  const vis = layout.elements.filter((e) => e.visible);
  const ref = unionFootprintArea(vis, canvas, { ...base, unionGridN: REF_N });
  const row = { stimulusId: item.stimulusId, elements: vis.length, referenceArea: +ref.toFixed(2) };
  for (const N of GRIDS) {
    const a = unionFootprintArea(vis, canvas, { ...base, unionGridN: N });
    row[`err_${N}`] = ref === 0 ? 0 : Math.abs(a - ref) / ref;
  }
  rows.push(row);
}

const summarise = (N) => {
  const e = rows.map((r) => r[`err_${N}`]);
  return { max: Math.max(...e), mean: e.reduce((a, b) => a + b, 0) / e.length };
};

console.log(`Union-approximation error on the ACTUAL corpus (${rows.length} stimuli)`);
console.log(`reference resolution: ${REF_N}x${REF_N}\n`);
console.log('grid     max error    mean error');
const summary = {};
for (const N of GRIDS) {
  const s = summarise(N);
  summary[N] = { maxPercent: +(s.max * 100).toFixed(4), meanPercent: +(s.mean * 100).toFixed(4) };
  console.log(`${String(N).padStart(4)}   ${(s.max * 100).toFixed(4)}%      ${(s.mean * 100).toFixed(4)}%`);
}
const worst = rows.reduce((w, r) => (r.err_512 > w.err_512 ? r : w), rows[0]);
console.log(`\nworst stimulus at N=512: ${worst.stimulusId} (${(worst.err_512 * 100).toFixed(4)}%, ${worst.elements} elements)`);
console.log('\nThis is corpus-specific evidence. It is NOT a universal bound: error');
console.log('grows with perimeter-to-area ratio, so a corpus of many small or');
console.log('thin rotated shapes would do worse. Re-run on any new corpus.');

writeFileSync(join(ROOT, 'results', 'union-error-report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  scope: 'fixture-specific: the current stimulus corpus only, NOT a universal guarantee',
  referenceResolution: REF_N,
  corpusSize: rows.length,
  summary,
  worstAt512: { stimulusId: worst.stimulusId, errorPercent: +(worst.err_512 * 100).toFixed(4) },
  perStimulus: rows,
}, null, 2));
console.log('\nwrote results/union-error-report.json');
