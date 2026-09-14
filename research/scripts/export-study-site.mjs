/**
 * Exports an audited participant bundle into a local clone of the PUBLIC
 * study-site repository (ApratimPanwar/order-study-site).
 *
 *   node scripts/export-study-site.mjs --dist <bundle dir> --audit <audit.json> --site-repo <clone dir>
 *
 * Only sanitized outputs cross this boundary:
 *
 *   site/                        the bundle, byte for byte as audited
 *   site-manifest.json           SHA-256 per file, package identity, source commit
 *   tools/verify-site.mjs        standalone verifier run by the deployment workflow
 *   .github/workflows/deploy-pages.yml
 *   README.md, .gitattributes
 *
 * The research source, tests, private inputs and keys never enter the site
 * repository. The export refuses a target that holds anything else, refuses a
 * bundle whose bytes differ from its audit, and runs the site verifier on the
 * result before reporting success. Nothing is committed or pushed here.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
for (const f of ['dist', 'audit', 'site-repo']) if (!flag(f)) { console.error(`--${f} is required`); process.exit(2); }

const RESEARCH = join(import.meta.dirname, '..');
const DIST = resolve(flag('dist'));
const AUDIT = JSON.parse(readFileSync(resolve(flag('audit')), 'utf8'));
const SITE_REPO = resolve(flag('site-repo'));
const TEMPLATE = join(RESEARCH, 'site-template');

const posix = (p) => p.split(sep).join('/');
const walk = (d, skip = () => false) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (skip(p)) return [];
  return statSync(p).isDirectory() ? walk(p, skip) : [p];
});
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fail = (msg) => { console.error(`REFUSING: ${msg}`); process.exit(2); };

// --- 1. the bundle must be exactly what was audited ----------------------------------------
if (!AUDIT.clean) fail(`the audit is not clean: ${JSON.stringify(AUDIT.findings)}`);
const distFiles = walk(DIST).map((p) => posix(relative(DIST, p))).sort();
const audited = Object.keys(AUDIT.assetDigests).sort();
if (JSON.stringify(distFiles) !== JSON.stringify(audited)) fail('bundle file set differs from the audit');
for (const f of distFiles) {
  if (sha256(readFileSync(join(DIST, f))) !== AUDIT.assetDigests[f]) fail(`bundle bytes differ from the audit: ${f}`);
}

// --- 2. the target must be the site repository and nothing else ----------------------------------
const insideResearch = relative(resolve(RESEARCH, '..'), SITE_REPO);
if (!insideResearch.startsWith('..') && !insideResearch.includes(':')) fail('the site repository must not be inside the research repository');
mkdirSync(SITE_REPO, { recursive: true });
const MANAGED = new Set(['.git', 'site', 'site-manifest.json', 'tools', '.github', 'README.md', '.gitattributes']);
for (const entry of readdirSync(SITE_REPO)) {
  if (!MANAGED.has(entry)) fail(`unexpected path in the site repository: ${entry}`);
}

// --- 3. write --------------------------------------------------------------------------------------
const siteDir = join(SITE_REPO, 'site');
if (existsSync(siteDir)) rmSync(siteDir, { recursive: true, force: true });
for (const f of distFiles) {
  mkdirSync(dirname(join(siteDir, f)), { recursive: true });
  copyFileSync(join(DIST, f), join(siteDir, f));
}
for (const f of walk(TEMPLATE).map((p) => posix(relative(TEMPLATE, p)))) {
  mkdirSync(dirname(join(SITE_REPO, f)), { recursive: true });
  copyFileSync(join(TEMPLATE, f), join(SITE_REPO, f));
}

let sourceCommit = 'unknown';
let sourceDirty = null;
try {
  sourceCommit = execFileSync('git', ['-C', RESEARCH, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  sourceDirty = execFileSync('git', ['-C', RESEARCH, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim().length > 0;
} catch { /* not a checkout */ }

const pkg = JSON.parse(readFileSync(join(DIST, 'release-package.json'), 'utf8'));
writeFileSync(join(SITE_REPO, 'site-manifest.json'), `${JSON.stringify({
  siteFormat: 'order-study-site-1',
  packageId: pkg.packageId,
  packageDigest: pkg.packageDigest,
  releaseMode: pkg.releaseMode,
  dataClass: pkg.dataClass,
  returnChannel: pkg.returnChannel ?? null,
  sourceRepository: 'ApratimPanwar/Order',
  sourceCommit,
  sourceWorkingTreeDirty: sourceDirty,
  exportedAt: new Date().toISOString(),
  files: Object.fromEntries(distFiles.map((f) => [f, AUDIT.assetDigests[f]])),
}, null, 2)}\n`);

// --- 4. verify the result exactly as the workflow will ------------------------------------------------
try {
  const out = execFileSync(process.execPath, [join(SITE_REPO, 'tools', 'verify-site.mjs'),
    '--expect-digest', pkg.packageDigest, '--expect-mode', pkg.releaseMode], { encoding: 'utf8' });
  process.stdout.write(out);
} catch (e) {
  process.stderr.write(String(e.stderr ?? e.message));
  fail('the exported site does not verify');
}
console.log(`exported ${distFiles.length} files to ${posix(SITE_REPO)}/site  (${pkg.packageId}, ${pkg.releaseMode})`);
if (sourceDirty) console.log('WARNING: exported from a working tree with uncommitted research changes');
