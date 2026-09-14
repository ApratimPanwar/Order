/**
 * LOCAL REHEARSAL HARNESS — not a deployment, not Google.
 *
 *   node scripts/collector-local-harness.mjs --site <order-study-site clone> [--port 8793]
 *
 * Serves the exported study site at /order-study-site/ and the collector's own
 * Upload.html at /collector/, with google.script.run shimmed onto a local RPC
 * endpoint that runs the collector's REAL .gs code (the same files deployed to
 * Apps Script) against in-memory fakes of Sheets, Drive, LockService and Script
 * Properties.
 *
 * It exists so the browser flow — rating, completion, download, upload, receipt,
 * duplicate, invalid file, interrupted submission, withdrawal — can be rehearsed
 * before anything touches a Google account. It proves the page logic and the
 * ingestion logic together; it proves nothing about Google's own services, which
 * only the live acceptance run can.
 *
 * /_harness/* endpoints inject faults and dump the fake storage. They do not
 * exist in the collector.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import {
  COLLECTOR_DIR, fakeProps, fakeSheets, fakeDrive, fakeLock, loadCollector,
} from '../test/helpers/collector-fakes.mjs';

const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
if (!flag('site')) { console.error('--site <order-study-site clone> is required'); process.exit(2); }
const SITE = join(resolve(flag('site')), 'site');
const PORT = Number(flag('port') ?? 8793);

const props = fakeProps({ ACCEPTING_UPLOADS: 'true', WITHDRAWAL_POLICY: flag('policy') ?? 'mark-ineligible' });
const ctx = loadCollector({ PropertiesService: { getScriptProperties: () => props } });
const svc = {
  props,
  now: () => new Date().toISOString(),
  uuid: () => randomUUID(),
  sha256Hex: (s) => createHash('sha256').update(s, 'utf8').digest('hex'),
  lock: fakeLock(),
  sheets: fakeSheets(),
  drive: fakeDrive(),
};
const pkgText = readFileSync(join(SITE, 'release-package.json'), 'utf8');
const registered = ctx.registerPackage_(svc, pkgText, JSON.parse(pkgText).packageDigest);
let dropNextResponse = false;

const SHIM = `<script>
// LOCAL HARNESS SHIM: stands in for google.script.run. Not part of the collector.
window.google = { script: { run: (function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (h) { return runner(h, fail); };
      if (name === 'withFailureHandler') return function (h) { return runner(ok, h); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/collector/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn: name, args: args }) })
          .then(function (r) { if (!r.ok) throw new Error('rpc ' + r.status); return r.json(); })
          .then(function (v) { if (ok) ok(v); }, function (e) { if (fail) fail(e); });
      };
    } });
  }
  return runner(null, null);
})() } };
</script>`;

const PUBLIC_FNS = {
  submitExport: (text, sha) => ctx.ingestExport_(svc, text, sha),
  requestWithdrawal: (code) => ctx.recordWithdrawalRequest_(svc, String(code || '').trim()),
  getPageConfig: () => ctx.getPageConfig(),
};

const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c).toString('utf8'))); });
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);

  if (path === '/collector/' && req.method === 'GET') {
    const html = readFileSync(join(COLLECTOR_DIR, 'Upload.html'), 'utf8').replace('<script>', `${SHIM}\n<script>`);
    return send(res, 200, 'text/html', html);
  }
  if (path === '/collector/rpc' && req.method === 'POST') {
    const { fn, args } = JSON.parse(await readBody(req));
    if (!Object.prototype.hasOwnProperty.call(PUBLIC_FNS, fn)) return send(res, 404, 'text/plain', 'no such public function');
    const result = PUBLIC_FNS[fn](...(args || []));
    if (dropNextResponse && fn === 'submitExport') {
      dropNextResponse = false;
      return send(res, 502, 'text/plain', 'harness: response dropped after the server finished');
    }
    return send(res, 200, 'application/json', JSON.stringify(result));
  }

  if (path === '/_harness/fault' && req.method === 'POST') {
    const { kind, n } = JSON.parse(await readBody(req));
    if (kind === 'drop-response') dropNextResponse = true;
    else if (kind === 'append-interrupt') svc.sheets.faults.appendFailAfter = n ?? 1;
    else if (kind === 'drive-fail') svc.drive.faults.createFailOnce = true;
    else if (kind === 'lock-busy') svc.lock.held = true;
    else if (kind === 'lock-free') svc.lock.held = false;
    else return send(res, 400, 'text/plain', 'unknown fault');
    return send(res, 200, 'application/json', JSON.stringify({ armed: kind }));
  }
  if (path === '/_harness/state' && req.method === 'GET') {
    const tabs = Object.fromEntries([...svc.sheets.tabs.entries()].map(([k, v]) => [k, v]));
    const files = [...svc.drive.files.entries()].map(([id, f]) => ({ id, area: f.area, name: f.name, trashed: f.trashed, bytes: f.text.length, sha256: svc.sha256Hex(f.text) }));
    return send(res, 200, 'application/json', JSON.stringify({ registered, tabs, files }));
  }
  if (path === '/_harness/raw' && req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const f = svc.drive.files.get(id);
    return f ? send(res, 200, 'application/json', f.text) : send(res, 404, 'text/plain', 'no file');
  }
  if (path === '/_harness/process-withdrawals' && req.method === 'POST') {
    return send(res, 200, 'application/json', JSON.stringify(ctx.processWithdrawals_(svc)));
  }

  if (path.startsWith('/order-study-site/')) {
    let rel = path.slice('/order-study-site/'.length) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = join(SITE, normalize(rel));
    if (!file.startsWith(SITE) || !existsSync(file) || statSync(file).isDirectory()) return send(res, 404, 'text/plain', '404');
    return send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file));
  }
  return send(res, 404, 'text/plain', '404');
}).listen(PORT, () => {
  console.log(`LOCAL HARNESS (not Google): site http://localhost:${PORT}/order-study-site/  collector http://localhost:${PORT}/collector/`);
  console.log(`registered ${registered.packageId} [${registered.dataClass}]`);
});
