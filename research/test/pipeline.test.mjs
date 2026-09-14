/**
 * PRIVATE-INPUT PIPELINE
 *
 * corpus plan (private) -> build-study-corpus -> build-release-package
 *   -> build-participant-dist -> export-study-site -> tools/verify-site.mjs
 *
 * Runs end to end in temporary directories outside any git work tree, on a tiny
 * plan, and checks the boundary at every step: private material stays in the
 * private directory, only sanitized output reaches the site repository, and the
 * site verifier refuses tampering.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const node = (script, args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
};
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const posix = (p) => p.split(sep).join('/');

const MARKERS = ['secretNamespace', 'generatorSeed', 'pairId', 'stratum', 'grid-source', 'position-twin',
  'stimulus-key', 'submetrics', 'v1Total', 'scoringKey', 'corpus-plan'];

let work;
let priv;
before(() => {
  work = mkdtempSync(join(tmpdir(), 'order-pipeline-'));
  priv = join(work, 'private');
  mkdirSync(priv, { recursive: true });
  writeFileSync(join(priv, 'corpus-plan.json'), JSON.stringify({
    planFormat: 'corpus-plan-1', purpose: 'rehearsal', status: 'rehearsal-only',
    design: 'matched-pairs/strict-grid-vs-position-twin', candidateDraws: 40,
    elementCount: { min: 4, max: 16 },
    strata: [{ id: 'any-positive', positiveDeltaQuantile: [0, 1], pairs: 2 }],
    includeDeliberatelyUnsupportedItem: false,
  }));
});
after(() => { if (work) rmSync(work, { recursive: true, force: true }); });

test('PIPELINE: private directories inside a git work tree are refused', () => {
  const inside = join(ROOT, 'study-private');
  const corpus = node('scripts/build-study-corpus.mjs', ['--private-dir', inside]);
  assert.equal(corpus.code, 2);
  assert.match(corpus.err, /inside the git work tree/);
  const pkg = node('scripts/build-release-package.mjs', ['--private-dir', inside, '--public-package-out', join(work, 'x.json')]);
  assert.equal(pkg.code, 2);
  assert.match(pkg.err, /inside the git work tree/);
});

test('PIPELINE: a study corpus needs an approved plan, and an unsupported item needs a study reason', () => {
  const dir = join(work, 'plans');
  for (const [name, patch, message] of [
    ['unapproved', { purpose: 'study', status: 'proposed' }, /requires status "approved"/],
    ['unsupported', { includeDeliberatelyUnsupportedItem: true }, /unsupportedItemStudyReason/],
  ]) {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    const plan = JSON.parse(readFileSync(join(priv, 'corpus-plan.json'), 'utf8'));
    writeFileSync(join(d, 'corpus-plan.json'), JSON.stringify({ ...plan, ...patch }));
    const r = node('scripts/build-study-corpus.mjs', ['--private-dir', d]);
    assert.equal(r.code, 2, name);
    assert.match(r.err, message);
  }
});

test('PIPELINE: corpus -> package -> bundle -> site repository, with the boundary held at every step', () => {
  // 1. corpus
  const c = node('scripts/build-study-corpus.mjs', ['--private-dir', priv, '--label', 'pipeline-test']);
  assert.equal(c.code, 0, c.err);
  assert.ok(!MARKERS.some((m) => c.out.includes(m)), 'build log carries no private markers');
  assert.ok(!/[0-9a-f]{64}/.test(c.out), 'build log carries no secret namespace');
  const plan = JSON.parse(readFileSync(join(priv, 'corpus-plan.json'), 'utf8'));
  assert.match(plan.secretNamespace, /^[0-9a-f]{64}$/, 'namespace generated privately');
  const key = JSON.parse(readFileSync(join(priv, 'stimulus-key.json'), 'utf8'));
  assert.equal(key.items.length, 4);
  assert.deepEqual(new Set(key.items.map((i) => i.role)), new Set(['grid-source', 'position-twin']));
  for (const item of key.items) {
    assert.equal(item.modelVersion, 'v1-development-candidate-2');
    assert.ok(item.generatorSeed.startsWith(plan.secretNamespace), 'seeds come from the private namespace');
  }
  const staging = join(priv, 'public-staging');
  for (const f of walk(staging)) {
    const text = readFileSync(f, 'utf8');
    for (const m of [...MARKERS, plan.secretNamespace]) assert.ok(!text.includes(m), `${posix(relative(staging, f))} leaks ${m}`);
    if (f.endsWith('.json') && !f.endsWith('manifest.json')) {
      const layout = JSON.parse(text);
      assert.ok(layout.elements.every((e) => e.visible), 'invisible generator draws are not published');
      assert.equal(layout.meta.generator, undefined, 'no generator provenance in a public stimulus');
    }
  }

  // 2. package (development, with a rehearsal return channel)
  const channel = join(priv, 'dev-channel.json');
  writeFileSync(channel, JSON.stringify({ kind: 'upload-page', instructions: 'Rehearsal only.', url: 'https://script.google.com/macros/s/AKfycbTEST_id-1/exec' }));
  const publicPkg = join(work, 'release-package.json');
  const p = node('scripts/build-release-package.mjs', ['--label', 'pipeline-test', '--stimuli-root', staging,
    '--private-dir', priv, '--public-package-out', publicPkg, '--dev-return-channel', channel]);
  assert.equal(p.code, 0, p.err);
  const pub = JSON.parse(readFileSync(publicPkg, 'utf8'));
  assert.equal(pub.releaseMode, 'development');
  assert.deepEqual(pub.returnChannel, { kind: 'upload-page', instructions: 'Rehearsal only.', url: 'https://script.google.com/macros/s/AKfycbTEST_id-1/exec', approved: false });
  assert.ok(existsSync(join(priv, 'release-package.json')), 'the full record stays private');
  assert.ok(!existsSync(join(ROOT, 'study-private', 'stimulus-key.json.tmp')));

  // 3. bundle
  const dist = join(work, 'dist');
  const audit = join(work, 'audit.json');
  const d = node('scripts/build-participant-dist.mjs', ['--stimuli-root', staging, '--private-dir', priv,
    '--package', publicPkg, '--out', dist, '--audit-out', audit, '--expect-digest', pub.packageDigest]);
  assert.equal(d.code, 0, d.out + d.err);
  assert.equal(JSON.parse(readFileSync(audit, 'utf8')).clean, true);

  // 4. site repository
  const site = join(work, 'order-study-site');
  const e = node('scripts/export-study-site.mjs', ['--dist', dist, '--audit', audit, '--site-repo', site]);
  assert.equal(e.code, 0, e.out + e.err);
  const top = readdirSync(site).sort();
  assert.deepEqual(top, ['.gitattributes', '.github', 'README.md', 'site', 'site-manifest.json', 'tools']);
  for (const f of walk(site)) {
    if (f.endsWith(`tools${sep}verify-site.mjs`)) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of [...MARKERS, plan.secretNamespace]) assert.ok(!text.includes(m), `site repo file ${posix(relative(site, f))} leaks ${m}`);
  }
  const run = () => {
    try {
      execFileSync(process.execPath, [join(site, 'tools', 'verify-site.mjs'), '--expect-digest', pub.packageDigest, '--expect-mode', 'development'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return 0;
    } catch (err) { return err.status; }
  };
  assert.equal(run(), 0, 'the exported site verifies');

  // 5. the verifier refuses tampering
  const idx = join(site, 'site', 'index.html');
  const original = readFileSync(idx);
  appendFileSync(idx, '<!-- edited -->');
  assert.equal(run(), 1, 'a changed byte is refused');
  writeFileSync(idx, original);
  assert.equal(run(), 0);

  writeFileSync(join(site, 'site', 'extra.json'), '{}');
  assert.equal(run(), 1, 'an unlisted file is refused');
  rmSync(join(site, 'site', 'extra.json'));

  writeFileSync(join(site, 'notes.md'), 'scratch');
  assert.equal(run(), 1, 'an unexpected top-level path is refused');
  rmSync(join(site, 'notes.md'));

  writeFileSync(join(site, 'README.md'), `${readFileSync(join(site, 'README.md'), 'utf8')}\npairId leaked\n`);
  assert.equal(run(), 1, 'a researcher-only marker anywhere in the repository is refused');
  writeFileSync(join(site, 'README.md'), readFileSync(join(ROOT, 'site-template', 'README.md')));
  assert.equal(run(), 0);

  try {
    execFileSync(process.execPath, [join(site, 'tools', 'verify-site.mjs'), '--expect-digest', 'a'.repeat(64), '--expect-mode', 'development'], { stdio: 'ignore' });
    assert.fail('a wrong digest must be refused');
  } catch (err) { assert.equal(err.status, 1); }
  try {
    execFileSync(process.execPath, [join(site, 'tools', 'verify-site.mjs'), '--expect-digest', pub.packageDigest, '--expect-mode', 'participant'], { stdio: 'ignore' });
    assert.fail('a development bundle must not publish as a participant release');
  } catch (err) { assert.equal(err.status, 1); }
});

test('PIPELINE: a rehearsal return channel must be an Apps Script web-app URL and never enters a participant build', () => {
  const bad = join(priv, 'bad-channel.json');
  writeFileSync(bad, JSON.stringify({ kind: 'upload-page', instructions: 'x', url: 'https://example.com/upload' }));
  const r = node('scripts/build-release-package.mjs', ['--private-dir', priv, '--stimuli-root', join(priv, 'public-staging'),
    '--public-package-out', join(work, 'bad.json'), '--dev-return-channel', bad]);
  assert.equal(r.code, 2);
  assert.match(r.err, /Apps Script web-app/);
  const q = node('scripts/build-release-package.mjs', ['--mode', 'participant', '--private-dir', priv,
    '--stimuli-root', join(priv, 'public-staging'), '--public-package-out', join(work, 'bad.json'), '--dev-return-channel', bad]);
  assert.equal(q.code, 2);
});

test('PIPELINE: the completion page links only an Apps Script URL and labels a rehearsal channel', () => {
  const html = readFileSync(join(ROOT, 'study', 'index.html'), 'utf8');
  assert.ok(html.includes('Rehearsal return channel (not approved for participants): '));
  assert.ok(html.includes("script\\.google\\.com\\/macros\\/s\\/[A-Za-z0-9_-]+\\/exec"));
  assert.ok(html.includes('Only that page can confirm receipt'));
  assert.ok(html.includes("rel = 'noopener noreferrer'"));
});
