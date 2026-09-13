/**
 * Quantifies AUDIT finding 4 using the EXTRACTED v0 scorer (equivalence-tested
 * against the original JavaScript) with explicit seeds.
 *
 *   node scripts/color-defect-impact.mjs [--n 20000]
 *
 * Three conditions per seed:
 *   baseline  - the generated layout, untouched
 *   shipped   - after colorHarmony, colours left as hsl() (v0 cannot parse them)
 *   parsed    - the same visual recolouring expressed in hex, so v0 CAN parse it
 *
 * "parsed" is a counterfactual for measuring the defect's size. It is not a
 * proposed fix; fixing the parse is decision G5.
 */
import { generateLayout } from '../core/generate.js';
import { getPreset } from '../core/presets/registry.js';
import { score, V0_CONFIG, MODEL_VERSION } from '../core/scoring/v0-as-shipped.js';

const i = process.argv.indexOf('--n');
const N = i === -1 ? 20000 : Number(process.argv[i + 1]);

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const hx = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
const toHex = (layout) => ({
  ...layout,
  elements: layout.elements.map((e) => {
    const m = /^hsl\(([-\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)$/.exec(e.color);
    return m ? { ...e, color: hslToHex(+m[1], +m[2], +m[3]) } : e;
  }),
});

const st = (v) => {
  const a = v.filter(Number.isFinite).sort((x, y) => x - y);
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
  return { mean: +mean.toFixed(3), sd: +sd.toFixed(3), min: +a[0].toFixed(3), max: +a[a.length - 1].toFixed(3) };
};

const bal = { baseline: [], shipped: [], parsed: [] };
const deg = { baseline: 0, shipped: 0, parsed: 0 };
const tot = { baseline: [], shipped: [], parsed: [] };
let n = 0;

for (let seed = 1; seed <= N; seed++) {
  const base = generateLayout({ seed });
  if (score(base).elementCount === 0) continue;
  const shipped = getPreset('color-harmony').apply(base);
  const parsed = toHex(shipped);
  const conds = { baseline: base, shipped, parsed };
  for (const [k, l] of Object.entries(conds)) {
    const r = score(l, V0_CONFIG);
    const vis = l.elements.filter((e) => e.visible);
    // balance term recovered from spatial = (max(0,ws) + balance)/2
    const ws = 10 - Math.abs(r.submetrics.whiteSpaceRatio - 0.4) * 15;
    bal[k].push(r.dimensions.spatial * 2 - Math.max(0, ws));
    if (r.submetrics.balanceDegenerate) deg[k]++;
    tot[k].push(r.total);
  }
  n++;
}

console.log(`model=${MODEL_VERSION} seeds=1..${N} scored=${n}\n`);
for (const k of ['baseline', 'shipped', 'parsed']) {
  console.log(`${k.padEnd(9)} balance ${JSON.stringify(st(bal[k]))}  degenerate ${(100 * deg[k] / n).toFixed(1)}%`);
}
const d = tot.shipped.map((v, i2) => v - tot.parsed[i2]);
console.log(`\noverall delta (shipped - parsed): ${JSON.stringify(st(d))}`);
