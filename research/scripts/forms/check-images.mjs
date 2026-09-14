/**
 * Independent checks on a prepared Google Forms build's stimulus images.
 *
 *   node scripts/forms/check-images.mjs --private-dir <corpus dir> --build <build dir>
 *
 * Exit 0 only if every check passes. Writes <build>/image-check-report.json.
 *
 * Checks, per image unless stated:
 *   files       the image set is exactly the plan's; names are opaque (no stimulus ID)
 *   digest      PNG SHA-256 equals build-plan.json and mapping.json
 *   format      8-bit RGB PNG of the planned size; chunks exactly IHDR, IDAT, IEND
 *               (no text, EXIF or other metadata that could carry identifiers)
 *   source      the source layout is byte-identical to the one the image was made from
 *   reproduce   re-rendering the source layout yields byte-identical PNG bytes
 *   content     neither blank nor flooded: 1% <= non-background pixels <= 90%
 *   geometry    the non-background bounding box agrees within 3 px with the bounding
 *               box computed independently from core/geometry.js polygons
 *   colours     every visible element colour occurs in the image (anti-aliasing
 *               aside, as exact pixels), unless the element is fully covered
 *   distinct    no two images are identical; matched pair members differ visibly
 *   variants    every variant presents every image exactly once, with no
 *               matched pair members adjacent (cyclically)
 *   plan        the plan digest recomputes
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { rasterizeLayout, encodePng, decodePng, STROKE_WIDTH } from '../../core/rasterize.js';
import { toPolygon } from '../../core/geometry.js';
import { parseColor } from '../../core/color.js';

const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
const PRIVATE_DIR = resolve(flag('private-dir') ?? '');
const BUILD = resolve(flag('build') ?? '');
if (!flag('private-dir') || !flag('build')) { console.error('--private-dir and --build are required'); process.exit(2); }

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));

const plan = JSON.parse(readFileSync(join(BUILD, 'build-plan.json'), 'utf8'));
const mapping = JSON.parse(readFileSync(join(BUILD, 'mapping.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(PRIVATE_DIR, 'public-staging', 'stimuli', 'manifest.json'), 'utf8'));
const size = plan.rasterizer.imageSize;

const failures = [];
const perImage = [];
const fail = (check, detail) => failures.push({ check, detail });

// --- plan and files -------------------------------------------------------------------------
{
  const { planDigest, ...rest } = plan;
  if (sha256(canonical(rest)) !== planDigest) fail('plan', 'plan digest does not recompute');
  if (mapping.planDigest !== planDigest) fail('plan', 'mapping belongs to a different plan');
}
const files = readdirSync(join(BUILD, 'images')).sort();
const planned = plan.images.map((i) => `${i.imageKey}.png`).sort();
if (JSON.stringify(files) !== JSON.stringify(planned)) fail('files', `image files ${files.length} != planned ${planned.length}`);
const allIds = manifest.items.map((m) => m.stimulusId);
for (const f of files) {
  if (/stim-/i.test(f) || allIds.some((id) => f.includes(id.slice(5)))) fail('files', `image name is not opaque: ${f}`);
}

const layoutOf = new Map(manifest.items.map((m) => [m.stimulusId, m.file]));
const decoded = new Map();

for (const m of mapping.images) {
  const report = { imageKey: m.imageKey, checks: {} };
  const pass = (c) => { report.checks[c] = 'pass'; };
  const bad = (c, d) => { report.checks[c] = `FAIL: ${d}`; fail(c, `${m.imageKey}: ${d}`); };
  const path = join(BUILD, 'images', `${m.imageKey}.png`);
  if (!existsSync(path)) { bad('files', 'missing'); perImage.push(report); continue; }
  const png = readFileSync(path);
  const planEntry = plan.images.find((i) => i.imageKey === m.imageKey);

  // digest
  if (sha256(png) === m.pngSha256 && planEntry && planEntry.pngSha256 === m.pngSha256) pass('digest');
  else bad('digest', 'PNG bytes differ from the plan or mapping');

  // format
  let img = null;
  try {
    img = decodePng(png);
    if (img.width !== size || img.height !== size) bad('format', `size ${img.width}x${img.height}, planned ${size}`);
    else if (img.chunks.join(',') !== 'IHDR,IDAT,IEND') bad('format', `unexpected chunks ${img.chunks.join(',')}`);
    else pass('format');
  } catch (e) { bad('format', e.message); }

  // source + reproduce
  const layoutBytes = readFileSync(join(PRIVATE_DIR, 'public-staging', layoutOf.get(m.stimulusId)));
  if (sha256(layoutBytes) === m.layoutSha256) pass('source'); else bad('source', 'source layout changed since the image was made');
  const layout = JSON.parse(layoutBytes);
  const again = encodePng(rasterizeLayout(layout, { width: size, height: size }));
  if (again.equals(png)) pass('reproduce'); else bad('reproduce', 're-render differs from the stored image');

  if (img) {
    decoded.set(m.imageKey, img);
    const bg = parseColor(layout.canvas?.background ?? '#FFFFFF').rgb;
    let minX = size; let minY = size; let maxX = -1; let maxY = -1; let fg = 0;
    const exact = new Map();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = (y * size + x) * 3;
        const r = img.rgb[k]; const g = img.rgb[k + 1]; const b = img.rgb[k + 2];
        if (r !== bg.r || g !== bg.g || b !== bg.b) {
          fg++;
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          const key = (r << 16) | (g << 8) | b;
          exact.set(key, (exact.get(key) ?? 0) + 1);
        }
      }
    }
    const frac = fg / (size * size);
    if (frac >= 0.01 && frac <= 0.9) pass('content'); else bad('content', `non-background fraction ${frac.toFixed(4)}`);

    // geometry, from the scorer's polygons (independent of the rasterizer)
    const s = size / (layout.canvas?.width ?? 500);
    let gx0 = Infinity; let gy0 = Infinity; let gx1 = -Infinity; let gy1 = -Infinity;
    for (const e of layout.elements.filter((el) => el.visible)) {
      const pad = e.filled ? 0 : STROKE_WIDTH / 2;
      for (const [px, py] of toPolygon(e, { renderer: layout.meta?.rendererVersion ?? 'renderer-2' })) {
        gx0 = Math.min(gx0, px - pad); gx1 = Math.max(gx1, px + pad);
        gy0 = Math.min(gy0, py - pad); gy1 = Math.max(gy1, py + pad);
      }
    }
    const clamp = (v) => Math.max(0, Math.min(size - 1, v));
    const expected = [clamp(gx0 * s), clamp(gy0 * s), clamp(gx1 * s), clamp(gy1 * s)];
    const got = [minX, minY, maxX, maxY];
    const worst = Math.max(...expected.map((v, i) => Math.abs(v - got[i])));
    if (worst <= 3) pass('geometry'); else bad('geometry', `bounding box off by ${worst.toFixed(1)} px`);

    // colours: a missing colour passes only if the element is genuinely covered.
    // Re-render with that element in a sentinel colour: any sentinel pixel left
    // visible means the element should have shown its own colour there.
    const SENTINEL = '#FF00FE';
    const colourProblems = [];
    const covered = [];
    layout.elements.forEach((e, idx) => {
      if (!e.visible) return;
      const c = parseColor(e.color).rgb;
      if ((exact.get((c.r << 16) | (c.g << 8) | c.b) ?? 0) >= 10) return;
      const probe = { ...layout, elements: layout.elements.map((el, j) => (j === idx ? { ...el, color: SENTINEL } : el)) };
      const r2 = rasterizeLayout(probe, { width: size, height: size });
      let visible = 0;
      for (let k = 0; k < r2.rgb.length; k += 3) if (r2.rgb[k] === 255 && r2.rgb[k + 1] === 0 && r2.rgb[k + 2] === 254) visible++;
      if (visible >= 10) colourProblems.push(`${e.color} (${visible} px should be visible)`);
      else covered.push(e.color);
    });
    if (colourProblems.length) bad('colours', colourProblems.join(', '));
    else { pass('colours'); if (covered.length) report.coveredElementColours = covered; }
    report.nonBackgroundFraction = Number(frac.toFixed(4));
  }
  perImage.push(report);
}

// --- distinct ---------------------------------------------------------------------------------
if (new Set(plan.images.map((i) => i.pngSha256)).size !== plan.images.length) fail('distinct', 'duplicate image digests');
const pairs = new Map();
for (const v of mapping.variants) for (const sct of v.sections) if (sct.pairId) {
  if (!pairs.has(sct.pairId)) pairs.set(sct.pairId, new Set());
  pairs.get(sct.pairId).add(sct.imageKey);
}
for (const [pairId, keys] of pairs) {
  const [a, b] = [...keys].map((k) => decoded.get(k));
  if (!a || !b) continue;
  let diff = 0;
  for (let i = 0; i < a.rgb.length; i += 3) if (a.rgb[i] !== b.rgb[i] || a.rgb[i + 1] !== b.rgb[i + 1] || a.rgb[i + 2] !== b.rgb[i + 2]) diff++;
  if (diff / (size * size) < 0.01) fail('distinct', `pair ${pairId} members are nearly identical images`);
}

// --- variants ---------------------------------------------------------------------------------
for (const v of mapping.variants) {
  const keys = v.sections.map((sct) => sct.imageKey);
  if (keys.length !== plan.images.length || new Set(keys).size !== keys.length) fail('variants', `form ${v.variant} does not show every image exactly once`);
  v.sections.forEach((sct, i) => {
    const nxt = v.sections[(i + 1) % v.sections.length];
    if (sct.pairId && sct.pairId === nxt.pairId) fail('variants', `form ${v.variant}: pair members adjacent at ${sct.position}`);
  });
  const titles = v.sections.flatMap((sct) => [sct.orderTitle, sct.appealTitle]);
  if (new Set(titles).size !== titles.length) fail('variants', `form ${v.variant}: duplicate question titles`);
  if (titles.some((t) => /stim-|pair-|grid|twin|stratum/i.test(t))) fail('variants', `form ${v.variant}: a question title reveals research metadata`);
}

const report = {
  checkedAt: new Date().toISOString(),
  planDigest: plan.planDigest,
  mode: plan.mode,
  images: perImage.length,
  failures,
  warnings: perImage.filter((r) => Object.values(r.checks).some((c) => String(c).startsWith('WARN'))).length,
  perImage,
  passed: failures.length === 0,
};
writeFileSync(join(BUILD, 'image-check-report.json'), JSON.stringify(report, null, 2));
console.log(`image checks: ${report.passed ? 'PASS' : 'FAIL'}  (${perImage.length} images, ${failures.length} failures, ${report.warnings} warnings)`);
for (const f of failures) console.log(`  - ${f.check}: ${f.detail}`);
process.exitCode = report.passed ? 0 : 1;
