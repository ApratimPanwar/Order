/**
 * Builds an IMMUTABLE release package identity.
 *
 *   node scripts/build-release-package.mjs [--label dev-pilot-1]
 *
 * WHY
 *
 * Binding an export to a reusable label such as `stimuli-1` is not an identity:
 * the label survives a rebuild that changes every stimulus. A join that trusts
 * it can silently pair responses with a different archive, or with a key
 * regenerated under a different model configuration.
 *
 * This records a SHA-256 content digest of every artifact that determines what
 * a participant saw and how it will be scored:
 *
 *   specification · effective configuration · scorer source · geometry/renderer
 *   source · stimulus manifest · each stimulus layout · scoring key
 *
 * The package digest is the hash of that ordered digest list, so any change to
 * any input yields a different package id.
 *
 * The package is written to BOTH sides:
 *   study/release-package.json   participant-safe (identity only, no scores)
 *   study-private/release-package.json  full record including the key digest
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { V1_CONFIG, effectiveConfig, MODEL_VERSION, CONFIG_VERSION, SPEC_VERSION } from '../core/scoring/v1-config.js';

const ROOT = join(import.meta.dirname, '..');
const labelIdx = process.argv.indexOf('--label');
const LABEL = labelIdx === -1 ? 'dev-pilot' : process.argv[labelIdx + 1];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileDigest = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`release input missing: ${rel}`);
  return { path: rel, sha256: sha256(readFileSync(p)), bytes: readFileSync(p).length };
};

// --- 1. the artifacts that determine what was shown and how it is scored ----
const sources = [
  'docs/decisions/V1-SPECIFICATION.md',
  'core/scoring/v1.js',
  'core/scoring/v1-config.js',
  'core/geometry.js',
  'core/color.js',
  'study/render-layout.js',
  'study/session.js',
  'study/persistence.js',
  'study/stimuli/manifest.json',
].map(fileDigest);

// --- 2. the effective configuration, canonically serialised -----------------
const effective = effectiveConfig(V1_CONFIG);
const effectiveCanonical = JSON.stringify(effective, Object.keys(effective).sort());
const configDigest = sha256(effectiveCanonical);

// --- 3. every stimulus layout ----------------------------------------------
const manifest = JSON.parse(readFileSync(join(ROOT, 'study/stimuli/manifest.json'), 'utf8'));
const stimuli = manifest.items.map((item) => {
  const bytes = readFileSync(join(ROOT, 'study', item.file));
  return {
    stimulusId: item.stimulusId,
    sha256: sha256(bytes),
    fnv: item.integrity,          // the browser-side check, kept for cross-verification
    rendererVersion: item.rendererVersion,
  };
});

// --- 4. the scoring key (private side only) ---------------------------------
const keyPath = 'study-private/stimulus-key.json';
const keyDigest = existsSync(join(ROOT, keyPath)) ? fileDigest(keyPath) : null;
if (!keyDigest) {
  console.error(`scoring key missing at ${keyPath}. Run: node scripts/build-stimuli.mjs`);
  process.exit(2);
}

// --- 5. the package digest --------------------------------------------------
const components = [
  ...sources.map((s) => `${s.path}:${s.sha256}`),
  `effective-config:${configDigest}`,
  ...stimuli.map((s) => `${s.stimulusId}:${s.sha256}`),
  `scoring-key:${keyDigest.sha256}`,
].sort();
const packageDigest = sha256(components.join('\n'));
const packageId = `${LABEL}-${packageDigest.slice(0, 16)}`;

const common = {
  packageFormat: 'release-package-1',
  packageId,
  packageDigest,
  label: LABEL,
  builtAt: new Date().toISOString(),
  immutable: true,
  note: 'Any change to any listed input produces a different packageDigest. '
    + 'Exports bind to packageDigest, not to reusable labels.',
  approval: 'DEVELOPMENT CANDIDATE - NOT APPROVED. Not a participant release.',
  identities: {
    modelVersion: MODEL_VERSION,
    configVersion: CONFIG_VERSION,
    specVersion: SPEC_VERSION,
    rendererVersion: effective.renderer,
    manifestVersion: manifest.manifestVersion,
    effectiveConfigDigest: configDigest,
  },
};

// Participant-facing: identity only. No scores, no key digest, no conditions.
writeFileSync(join(ROOT, 'study', 'release-package.json'), JSON.stringify({
  ...common,
  stimuli: stimuli.map((s) => ({ stimulusId: s.stimulusId, sha256: s.sha256, fnv: s.fnv })),
}, null, 2));

// Researcher-facing: the full record.
writeFileSync(join(ROOT, 'study-private', 'release-package.json'), JSON.stringify({
  ...common,
  sources,
  effectiveConfig: effective,
  stimuli,
  scoringKey: keyDigest,
  components,
}, null, 2));

console.log(`release package ${packageId}`);
console.log(`  digest        : ${packageDigest}`);
console.log(`  sources       : ${sources.length}`);
console.log(`  stimuli       : ${stimuli.length}`);
console.log(`  config digest : ${configDigest.slice(0, 16)}...`);
console.log(`  key digest    : ${keyDigest.sha256.slice(0, 16)}...`);
console.log('\n  participant side : study/release-package.json  (identity only)');
console.log('  researcher side  : study-private/release-package.json');
const pub = readFileSync(join(ROOT, 'study', 'release-package.json'), 'utf8');
console.log('\n  participant-side leak check:');
for (const t of ['condition', 'scoringKey', 'v1Total', 'strict-grid', 'radial']) {
  console.log(`    contains "${t}": ${pub.includes(t)}`);
}
