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
import { join, relative } from 'node:path';

const toPosix = (p) => p.split(String.fromCharCode(92)).join('/');

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'study');
const OUT = join(ROOT, 'dist', 'participant');

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'stimuli'), { recursive: true });

const FILES = ['index.html', 'session.js', 'persistence.js', 'render-layout.js', 'release-package.json'];
for (const f of FILES) copyFileSync(join(SRC, f), join(OUT, f));

const manifest = JSON.parse(readFileSync(join(SRC, 'stimuli', 'manifest.json'), 'utf8'));
copyFileSync(join(SRC, 'stimuli', 'manifest.json'), join(OUT, 'stimuli', 'manifest.json'));
for (const item of manifest.items) copyFileSync(join(SRC, item.file), join(OUT, item.file));

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
  releasePackageId: JSON.parse(readFileSync(join(OUT, 'release-package.json'), 'utf8')).packageId,
  findings,
  clean: findings.length === 0,
};
writeFileSync(join(ROOT, 'results', 'participant-dist-audit.json'), JSON.stringify(report, null, 2));

console.log(`participant bundle -> ${report.out}  (${built.length} files)`);
console.log(`release package    : ${report.releasePackageId}`);
if (findings.length) {
  console.log('\nFINDINGS:');
  for (const f of findings) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('audit: clean (no key, no conditions, no escaping imports or fetches)');
}
