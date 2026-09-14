/**
 * Builds the PARTICIPANT-ONLY deployable bundle.
 *
 *   node scripts/build-participant-dist.mjs
 *
 * Validating `study/` in place is not the same as validating what would be
 * deployed: the source tree sits next to study-private/, core/ and the tests, so
 * a path mistake at deploy time is invisible locally. This copies only the files
 * a participant needs into dist/participant/, then audits the result.
 *
 * The bundle is a DEVELOPMENT build. It is not a participant release.
 */
import { mkdirSync, rmSync, existsSync, copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const expectIdx = process.argv.indexOf('--expect-digest');
const EXPECT_DIGEST = expectIdx === -1 ? null : process.argv[expectIdx + 1];

const toPosix = (p) => p.split(String.fromCharCode(92)).join('/');

const ROOT = join(import.meta.dirname, '..');
const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
const SRC = join(ROOT, 'study');                        // the application itself
const STIMULI_ROOT = flag('stimuli-root') ? resolve(flag('stimuli-root')) : SRC;
const PRIVATE_DIR = flag('private-dir') ? resolve(flag('private-dir')) : join(ROOT, 'study-private');
const PACKAGE = flag('package') ? resolve(flag('package')) : join(SRC, 'release-package.json');
const OUT = flag('out') ? resolve(flag('out')) : join(ROOT, 'dist', 'participant');
const AUDIT_OUT = flag('audit-out') ? resolve(flag('audit-out')) : join(ROOT, 'results', 'participant-dist-audit.json');

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'stimuli'), { recursive: true });

const FILES = ['index.html', 'session.js', 'persistence.js', 'render-layout.js'];
for (const f of FILES) copyFileSync(join(SRC, f), join(OUT, f));
copyFileSync(PACKAGE, join(OUT, 'release-package.json'));

// Consent / information / debrief assets ship the moment they exist.
const OPTIONAL = ['consent.html', 'participant-information.html', 'protocol.json', 'debrief.html'];
const shippedOptional = OPTIONAL.filter((f) => existsSync(join(SRC, f)));
for (const f of shippedOptional) copyFileSync(join(SRC, f), join(OUT, f));

// GitHub Pages runs Jekyll over an artifact unless told not to; that silently
// drops files and directories beginning with an underscore.
writeFileSync(join(OUT, '.nojekyll'), '');

const manifest = JSON.parse(readFileSync(join(STIMULI_ROOT, 'stimuli', 'manifest.json'), 'utf8'));
copyFileSync(join(STIMULI_ROOT, 'stimuli', 'manifest.json'), join(OUT, 'stimuli', 'manifest.json'));
for (const item of manifest.items) copyFileSync(join(STIMULI_ROOT, item.file), join(OUT, item.file));

// --- audit the BUILT bundle, not the source tree ---------------------------
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const built = walk(OUT).map((p) => toPosix(relative(OUT, p)));

const findings = [];
for (const f of built) {
  if (/stimulus-key/i.test(f) || /study-private/i.test(f)) findings.push(`forbidden file in bundle: ${f}`);
}
const FORBIDDEN_CONTENT = ['stimulus-key', 'study-private', 'strict-grid', 'radial-distribution',
  'random-position', 'as-generated', 'deliberately-unscorable', 'v1Total', 'scoringKey'];
for (const f of built) {
  const text = readFileSync(join(OUT, f), 'utf8');
  for (const term of FORBIDDEN_CONTENT) {
    if (text.includes(term)) findings.push(`"${term}" appears in ${f}`);
  }
}
// The artifact root must be servable as-is: index.html at the top level, and
// no root-absolute URLs, which break under a repository subpath such as
// https://<owner>.github.io/<repo>/ (deployment item 15).
if (!existsSync(join(OUT, 'index.html'))) findings.push('index.html is not at the artifact root');
for (const f of built.filter((x) => x.endsWith('.html'))) {
  const text = readFileSync(join(OUT, f), 'utf8');
  for (const m of text.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)) {
    findings.push(`root-absolute URL "${m[1]}" in ${f} will not resolve under a repository subpath`);
  }
  for (const m of text.matchAll(/from '(\/[^']+)'/g)) {
    findings.push(`root-absolute import "${m[1]}" in ${f} will not resolve under a repository subpath`);
  }
}

// The deployed package must be the frozen one, byte for byte.
const shippedPkg = JSON.parse(readFileSync(join(OUT, 'release-package.json'), 'utf8'));
const privatePath = join(PRIVATE_DIR, 'release-package.json');
if (existsSync(privatePath)) {
  const priv = JSON.parse(readFileSync(privatePath, 'utf8'));
  if (priv.packageDigest !== shippedPkg.packageDigest) {
    findings.push(`bundle package digest ${shippedPkg.packageDigest.slice(0, 16)} does not match the `
      + `researcher-side record ${String(priv.packageDigest).slice(0, 16)}`);
  }
} else {
  findings.push('no researcher-side release-package.json to verify the bundle against');
}
if (EXPECT_DIGEST && shippedPkg.packageDigest !== EXPECT_DIGEST) {
  findings.push(`bundle package digest ${shippedPkg.packageDigest} does not match the expected `
    + `frozen digest ${EXPECT_DIGEST}`);
}

// Every import the app makes must resolve INSIDE the bundle.
const html = readFileSync(join(OUT, 'index.html'), 'utf8');
for (const m of html.matchAll(/from '\.\/([^']+)'/g)) {
  if (!built.includes(m[1])) findings.push(`import "./${m[1]}" does not resolve inside the bundle`);
}
for (const m of html.matchAll(/fetch\('([^']+)'/g)) {
  const target = m[1];
  if (target.startsWith('..')) findings.push(`fetch escapes the bundle root: ${target}`);
  else if (!built.includes(target)) findings.push(`fetch target missing from bundle: ${target}`);
}

const report = {
  builtAt: new Date().toISOString(),
  status: 'DEVELOPMENT BUILD - not a participant release',
  out: toPosix(relative(ROOT, OUT)),
  fileCount: built.length,
  files: built,
  releasePackageId: shippedPkg.packageId,
  releasePackageDigest: shippedPkg.packageDigest,
  releaseMode: shippedPkg.releaseMode ?? 'development',
  returnChannel: shippedPkg.returnChannel ?? null,
  expectedDigest: EXPECT_DIGEST,
  optionalAssets: shippedOptional,
  // A per-file digest of exactly what would be served, so the live site can be
  // checked byte for byte against what was audited (deployment item 24).
  assetDigests: Object.fromEntries(built.map((f) =>
    [f, createHash('sha256').update(readFileSync(join(OUT, f))).digest('hex')])),
  findings,
  clean: findings.length === 0,
};
writeFileSync(AUDIT_OUT, JSON.stringify(report, null, 2));

console.log(`participant bundle -> ${report.out}  (${built.length} files)`);
console.log(`release package    : ${report.releasePackageId}  [mode: ${report.releaseMode}]`);
console.log(`package digest     : ${report.releasePackageDigest}`);
console.log(`return channel     : ${report.returnChannel ? report.returnChannel.kind : 'NONE SPECIFIED'}`);
if (findings.length) {
  console.log('\nFINDINGS:');
  for (const f of findings) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('audit: clean (no key, no conditions, no escaping imports or fetches)');
}
