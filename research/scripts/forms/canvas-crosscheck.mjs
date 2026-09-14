/**
 * Serves a local page that compares each prepared survey image with the
 * instrument's own canvas renderer (study/render-layout.js) in a real browser.
 *
 *   node scripts/forms/canvas-crosscheck.mjs --private-dir <corpus dir> --build <build dir> [--port 8796]
 *   then open http://localhost:8796/ and read the table (also on window.__crosscheck)
 *
 * The rasterizer and the browser anti-alias differently, so exact equality is
 * not expected. The page reports, per image:
 *   maskIoU    intersection-over-union of non-background pixels (shape agreement)
 *   meanAbs    mean absolute RGB difference over all pixels, 0..255
 *   p99Abs     99th-percentile per-pixel difference (localised disagreement)
 * Local only; serves nothing outside the two directories named.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, normalize } from 'node:path';

const flag = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const RESEARCH = join(import.meta.dirname, '..', '..');
const PRIVATE_DIR = resolve(flag('private-dir'));
const BUILD = resolve(flag('build'));
const PORT = Number(flag('port', 8796));

const mapping = JSON.parse(readFileSync(join(BUILD, 'mapping.json'), 'utf8'));
const plan = JSON.parse(readFileSync(join(BUILD, 'build-plan.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(PRIVATE_DIR, 'public-staging', 'stimuli', 'manifest.json'), 'utf8'));
const fileOf = new Map(manifest.items.map((m) => [m.stimulusId, m.file]));
const items = mapping.images.map((m) => ({ imageKey: m.imageKey, layout: `/layout/${m.stimulusId}` }));

const PAGE = `<!doctype html><meta charset="utf-8"><title>canvas cross-check</title>
<style>body{font:13px system-ui;margin:16px}td,th{padding:2px 8px;text-align:right}</style>
<h1>Rasterizer vs instrument canvas renderer</h1><table id="t"><tr><th>image</th><th>maskIoU</th><th>meanAbs</th><th>p99Abs</th></tr></table>
<script type="module">
import { drawLayout } from '/research/study/render-layout.js';
const items = ${JSON.stringify(items)};
const S = ${plan.rasterizer.imageSize};
const results = [];
for (const it of items) {
  const layout = await (await fetch(it.layout)).json();
  const c1 = new OffscreenCanvas(S, S); const x1 = c1.getContext('2d');
  drawLayout(x1, layout, { width: S, height: S });
  const a = x1.getImageData(0, 0, S, S).data;
  const bmp = await createImageBitmap(await (await fetch('/image/' + it.imageKey)).blob());
  const c2 = new OffscreenCanvas(S, S); const x2 = c2.getContext('2d'); x2.drawImage(bmp, 0, 0);
  const b = x2.getImageData(0, 0, S, S).data;
  let inter = 0, uni = 0, sum = 0; const diffs = new Uint16Array(S * S);
  for (let p = 0, q = 0; p < a.length; p += 4, q++) {
    const fa = a[p] !== 255 || a[p+1] !== 255 || a[p+2] !== 255;
    const fb = b[p] !== 255 || b[p+1] !== 255 || b[p+2] !== 255;
    if (fa && fb) inter++; if (fa || fb) uni++;
    const d = (Math.abs(a[p]-b[p]) + Math.abs(a[p+1]-b[p+1]) + Math.abs(a[p+2]-b[p+2])) / 3;
    sum += d; diffs[q] = Math.round(d);
  }
  diffs.sort();
  const r = { imageKey: it.imageKey, maskIoU: +(inter / uni).toFixed(4), meanAbs: +(sum / (S*S)).toFixed(3), p99Abs: diffs[Math.floor(diffs.length * 0.99)] };
  results.push(r);
  document.getElementById('t').insertAdjacentHTML('beforeend', '<tr><td>' + r.imageKey + '</td><td>' + r.maskIoU + '</td><td>' + r.meanAbs + '</td><td>' + r.p99Abs + '</td></tr>');
}
window.__crosscheck = { imageSize: S, results, minIoU: Math.min(...results.map(r => r.maskIoU)), maxMeanAbs: Math.max(...results.map(r => r.meanAbs)) };
document.body.dataset.done = '1';
</script>`;

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  if (url === '/') return send(200, 'text/html', PAGE);
  if (url.startsWith('/research/study/')) {
    const f = join(RESEARCH, 'study', normalize(url.slice('/research/study/'.length)));
    return f.startsWith(join(RESEARCH, 'study')) && existsSync(f) ? send(200, 'text/javascript', readFileSync(f)) : send(404, 'text/plain', '404');
  }
  if (url.startsWith('/layout/')) {
    const id = url.slice(8); const file = fileOf.get(id);
    return file ? send(200, 'application/json', readFileSync(join(PRIVATE_DIR, 'public-staging', file))) : send(404, 'text/plain', '404');
  }
  if (url.startsWith('/image/')) {
    const key = url.slice(7);
    return /^img-[0-9a-f]{10}$/.test(key) ? send(200, 'image/png', readFileSync(join(BUILD, 'images', `${key}.png`))) : send(404, 'text/plain', '404');
  }
  return send(404, 'text/plain', '404');
}).listen(PORT, '127.0.0.1', () => console.log(`cross-check page: http://localhost:${PORT}/`));
