// Two-stage comparison for the manuscript: first algorithm (v0-as-shipped) vs revised DOASA (v1 r2)
// on identical seeded pairs, with the matched and full-canvas random copies.
//   node scripts/two-stage-comparison.mjs > results/two-stage-comparison/summary.json
import { generateLayout, randomizePositions, randomizePositionsMatched } from '../core/generate.js';
import { getPreset } from '../core/presets/registry.js';
import { score as v0 } from '../core/scoring/v0-as-shipped.js';
import { score as v1 } from '../core/scoring/v1.js';
import { layoutHash } from '../core/layout.js';

const wilson = (k, n, z = 1.959963984540054) => { const p = k / n; const d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d; const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [c - h, c + h].map((x) => +(100 * x).toFixed(2)); };
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(2); };
const mean = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const out = (x) => (x > 0 ? 'win' : x < 0 ? 'rev' : 'tie');

const V0D = ['hierarchy', 'grouping', 'structure', 'flow', 'spatial', 'harmony'];
const V1D = ['hierarchy', 'grouping', 'structure', 'flow', 'spatial', 'variety'];
const res = { matched: { v0: { win: 0, rev: 0, tie: 0, d: [], dims: Object.fromEntries(V0D.map((k) => [k, []])) }, v1: { win: 0, rev: 0, tie: 0, unsupported: 0, d: [], dims: Object.fromEntries(V1D.map((k) => [k, []])) }, cross: {} },
  full: { v0: { win: 0, rev: 0, tie: 0 }, v1: { win: 0, rev: 0, tie: 0, unsupported: 0 } } };
let firstHash;
for (let s = 1; s <= 2000; s++) {
  const src = getPreset('strict-grid').apply(generateLayout({ seed: s }));
  const tm = randomizePositionsMatched(src, { seed: `baseline-${s}` });
  const tf = randomizePositions(src, { seed: `baseline-${s}` });
  if (s === 1) firstHash = [layoutHash(src), layoutHash(tm)];
  const a0 = v0(src), m0 = v0(tm), f0 = v0(tf);
  const a1 = v1(src), m1 = v1(tm), f1 = v1(tf);
  const d0 = a0.total - m0.total; res.matched.v0[out(d0)]++; res.matched.v0.d.push(d0);
  V0D.forEach((k) => res.matched.v0.dims[k].push(a0.dimensions[k] - m0.dimensions[k]));
  res.full.v0[out(a0.total - f0.total)]++;
  let o1 = 'unsupported';
  if (a1.scorable && m1.scorable) { const d1 = a1.total - m1.total; o1 = out(d1); res.matched.v1[o1]++; res.matched.v1.d.push(d1); V1D.forEach((k) => res.matched.v1.dims[k].push(a1.dimensions[k] - m1.dimensions[k])); } else res.matched.v1.unsupported++;
  if (a1.scorable && f1.scorable) res.full.v1[out(a1.total - f1.total)]++; else res.full.v1.unsupported++;
  const key = `v0:${out(d0)}|v1:${o1}`; res.matched.cross[key] = (res.matched.cross[key] || 0) + 1;
}
const summ = (r) => ({ win: r.win, rev: r.rev, tie: r.tie, unsupported: r.unsupported, n: r.win + r.rev + r.tie, winPct: +(100 * r.win / (r.win + r.rev + r.tie)).toFixed(2), wilson: wilson(r.win, r.win + r.rev + r.tie) });
console.log(JSON.stringify({
  firstHash,
  matched: {
    v0: { ...summ(res.matched.v0), delta: { mean: mean(res.matched.v0.d), p05: q(res.matched.v0.d, 0.05), p50: q(res.matched.v0.d, 0.5), p95: q(res.matched.v0.d, 0.95) }, dims: Object.fromEntries(V0D.map((k) => [k, mean(res.matched.v0.dims[k])])) },
    v1: { ...summ(res.matched.v1), delta: { mean: mean(res.matched.v1.d), p05: q(res.matched.v1.d, 0.05), p50: q(res.matched.v1.d, 0.5), p95: q(res.matched.v1.d, 0.95) }, dims: Object.fromEntries(V1D.map((k) => [k, mean(res.matched.v1.dims[k])])) },
    cross: res.matched.cross,
  },
  full: { v0: summ(res.full.v0), v1: summ(res.full.v1) },
}, null, 1));
