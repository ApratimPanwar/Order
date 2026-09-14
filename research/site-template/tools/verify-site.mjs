/**
 * Verifies the contents of the public study-site repository before publication.
 *
 *   node tools/verify-site.mjs --expect-digest <sha256> --expect-mode <development|participant>
 *
 * This repository holds ONLY the audited participant bundle (site/) and the
 * manifest describing it. The research source, tests, scoring key and private
 * build inputs live elsewhere and never enter this repository. This verifier
 * therefore does not run the research test suite — that happened before export,
 * and the manifest records the source commit it came from. What it CAN check,
 * independently, is that what is about to be published is exactly what was
 * audited and carries nothing it must not:
 *
 *   - every file under site/ is listed in site-manifest.json with a matching
 *     SHA-256, and nothing is missing or extra;
 *   - the release package digest equals the manifest's and the one requested;
 *   - the release mode is the one requested, and a participant release carries
 *     an approved return channel;
 *   - index.html is at the artifact root, .nojekyll is present, and no URL or
 *     import is root-absolute (which would break under /order-study-site/);
 *   - no file anywhere in the repository contains researcher-only markers.
 *
 * No dependencies. Exit 0 = publishable, 1 = refused.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(import.meta.dirname, '..');
const SITE = join(ROOT, 'site');
const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
const EXPECT_DIGEST = flag('expect-digest');
const EXPECT_MODE = flag('expect-mode');

const problems = [];
const posix = (p) => p.split(sep).join('/');
const walk = (d, skip = () => false) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (skip(p)) return [];
  return statSync(p).isDirectory() ? walk(p, skip) : [p];
});
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

if (!EXPECT_DIGEST || !/^[0-9a-f]{64}$/.test(EXPECT_DIGEST)) problems.push('--expect-digest must be a 64-hex package digest');
if (!['development', 'participant'].includes(EXPECT_MODE)) problems.push('--expect-mode must be development or participant');

const manifest = JSON.parse(readFileSync(join(ROOT, 'site-manifest.json'), 'utf8'));
if (manifest.siteFormat !== 'order-study-site-1') problems.push('unknown siteFormat');

// --- exact file set and bytes ------------------------------------------------------
const files = existsSync(SITE) ? walk(SITE).map((p) => posix(relative(SITE, p))) : [];
const listed = Object.keys(manifest.files ?? {});
for (const f of files) {
  if (!listed.includes(f)) problems.push(`unlisted file in site/: ${f}`);
  else if (sha256(readFileSync(join(SITE, f))) !== manifest.files[f]) problems.push(`bytes differ from manifest: ${f}`);
}
for (const f of listed) if (!files.includes(f)) problems.push(`listed file missing from site/: ${f}`);

// --- identity ------------------------------------------------------------------------
let pkg = null;
try { pkg = JSON.parse(readFileSync(join(SITE, 'release-package.json'), 'utf8')); } catch { problems.push('site/release-package.json unreadable'); }
if (pkg) {
  if (pkg.packageDigest !== manifest.packageDigest) problems.push('package digest differs from manifest');
  if (EXPECT_DIGEST && pkg.packageDigest !== EXPECT_DIGEST) problems.push(`package digest ${pkg.packageDigest} != requested ${EXPECT_DIGEST}`);
  if (EXPECT_MODE && pkg.releaseMode !== EXPECT_MODE) problems.push(`release mode ${pkg.releaseMode} != requested ${EXPECT_MODE}`);
  if (pkg.releaseMode === 'participant' && !(pkg.returnChannel && pkg.returnChannel.approved === true)) {
    problems.push('a participant release must carry an approved return channel');
  }
}

// --- servable under a repository subpath -----------------------------------------------
if (!files.includes('index.html')) problems.push('index.html is not at the artifact root');
if (!files.includes('.nojekyll')) problems.push('.nojekyll missing: Pages would run Jekyll over the artifact');
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const text = readFileSync(join(SITE, f), 'utf8');
  for (const m of text.matchAll(/(?:src|href)="(\/[^"]*)"/g)) problems.push(`root-absolute URL ${m[1]} in ${f}`);
  for (const m of text.matchAll(/^\s*import [\s\S]*?from '([^']+)';/gm)) {
    if (!m[1].startsWith('./')) problems.push(`non-relative import ${m[1]} in ${f}`);
  }
}

// --- nothing researcher-side, anywhere in the repository ------------------------------
// This file is excluded from the scan below, so the list can be literal.
const MARKERS = [
  'stimulus-key', 'study-private', 'scoringKey', 'v1Total', 'submetrics', 'generatorSeed',
  'secretNamespace', 'pairId', 'stratum', 'grid-source', 'position-twin', 'strict-grid',
  'radial-distribution', 'random-position', 'as-generated', 'deliberately-unscorable',
  'approvals.json', 'corpus-plan', '"condition"',
];
const SELF = posix(relative(ROOT, join(import.meta.dirname, 'verify-site.mjs')));
const repoFiles = walk(ROOT, (p) => posix(relative(ROOT, p)).split('/')[0] === '.git').map((p) => posix(relative(ROOT, p)));
for (const f of repoFiles) {
  if (f === SELF) continue;
  const text = readFileSync(join(ROOT, f), 'utf8');
  for (const m of MARKERS) if (text.includes(m)) problems.push(`researcher-only marker "${m}" in ${f}`);
}
const ALLOWED_TOP = new Set(['site', 'site-manifest.json', 'tools', '.github', 'README.md', '.gitattributes']);
for (const f of repoFiles) {
  const top = f.split('/')[0];
  if (!ALLOWED_TOP.has(top)) problems.push(`unexpected path in the site repository: ${f}`);
}

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log(`verified ${files.length} files for ${pkg.packageId} [${pkg.releaseMode}] from ${manifest.sourceRepository}@${manifest.sourceCommit}`);
