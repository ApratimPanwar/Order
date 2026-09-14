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
import { join, resolve, dirname } from 'node:path';

import { V1_CONFIG, effectiveConfig, MODEL_VERSION, CONFIG_VERSION, SPEC_VERSION } from '../core/scoring/v1-config.js';

const ROOT = join(import.meta.dirname, '..');
const labelIdx = process.argv.indexOf('--label');
const LABEL = labelIdx === -1 ? 'dev-pilot' : process.argv[labelIdx + 1];
const modeIdx = process.argv.indexOf('--mode');
const MODE = modeIdx === -1 ? 'development' : process.argv[modeIdx + 1];
if (MODE !== 'development' && MODE !== 'participant') {
  console.error(`--mode must be development or participant (got ${MODE})`);
  process.exit(2);
}

// --- where the inputs live ---------------------------------------------------
//
// Defaults reproduce the legacy development layout inside this repository. A
// real corpus is built with --stimuli-root and --private-dir pointing OUTSIDE
// any git work tree, so its scoring key and condition mapping can never be
// committed, pushed, released or logged by a CI run.
const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
const STIMULI_ROOT = flag('stimuli-root') ? resolve(flag('stimuli-root')) : join(ROOT, 'study');
const PRIVATE_DIR = flag('private-dir') ? resolve(flag('private-dir')) : join(ROOT, 'study-private');
const PUBLIC_PACKAGE_OUT = flag('public-package-out') ? resolve(flag('public-package-out')) : join(ROOT, 'study', 'release-package.json');
const DEV_RETURN_CHANNEL = flag('dev-return-channel');

function insideGitWorkTree(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, '.git'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}
if (flag('private-dir')) {
  const repo = insideGitWorkTree(PRIVATE_DIR);
  if (repo) {
    console.error(`REFUSING: --private-dir ${PRIVATE_DIR} is inside the git work tree ${repo}.`);
    console.error('A scoring key inside a repository can be committed and published.');
    process.exit(2);
  }
}

/** Maps a LOGICAL input path (as recorded in the package) to where it actually is. */
const locate = (rel) => {
  if (rel.startsWith('study/stimuli/')) return join(STIMULI_ROOT, rel.slice('study/'.length));
  if (rel.startsWith('study-private/')) return join(PRIVATE_DIR, rel.slice('study-private/'.length));
  return join(ROOT, rel);
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileDigest = (rel) => {
  const p = locate(rel);
  if (!existsSync(p)) throw new Error(`release input missing: ${rel}`);
  return { path: rel, sha256: sha256(readFileSync(p)), bytes: readFileSync(p).length };
};

// --- 1. the artifacts that determine what was shown and how it is scored ----
const SOURCE_FILES = [
  'docs/decisions/V1-SPECIFICATION.md',
  'core/scoring/v1.js',
  'core/scoring/v1-config.js',
  'core/geometry.js',
  'core/color.js',
  'study/render-layout.js',
  'study/session.js',
  'study/persistence.js',
  'study/stimuli/manifest.json',
  // The interface and ALL participant-facing wording live here. Omitting it
  // meant the text a participant read was outside the frozen identity, so the
  // instructions could change without changing the package digest.
  'study/index.html',
];

// Consent / protocol assets are included the moment they exist, so introducing
// one cannot silently fall outside the digest.
const OPTIONAL_PARTICIPANT_ASSETS = [
  'study/consent.html',
  'study/participant-information.html',
  'study/protocol.json',
  'study/debrief.html',
];
const presentOptional = OPTIONAL_PARTICIPANT_ASSETS.filter((rel) => existsSync(locate(rel)));
const sources = [...SOURCE_FILES, ...presentOptional].sort().map(fileDigest);

// --- 2. the effective configuration, canonically serialised -----------------
const effective = effectiveConfig(V1_CONFIG);
const effectiveCanonical = JSON.stringify(effective, Object.keys(effective).sort());
const configDigest = sha256(effectiveCanonical);

// --- 3. every stimulus layout ----------------------------------------------
const manifest = JSON.parse(readFileSync(locate('study/stimuli/manifest.json'), 'utf8'));
const stimuli = manifest.items.map((item) => {
  const bytes = readFileSync(join(STIMULI_ROOT, item.file));
  return {
    stimulusId: item.stimulusId,
    sha256: sha256(bytes),
    fnv: item.integrity,          // the browser-side check, kept for cross-verification
    rendererVersion: item.rendererVersion,
  };
});

// --- 4. the scoring key (private side only) ---------------------------------
const keyPath = 'study-private/stimulus-key.json';
const keyDigest = existsSync(locate(keyPath)) ? fileDigest(keyPath) : null;
if (!keyDigest) {
  console.error(`scoring key missing at ${keyPath}. Run: node scripts/build-stimuli.mjs`);
  process.exit(2);
}

// --- 4b. the approvals gate -------------------------------------------------
//
// A participant release is not a rename of a development package. It requires
// a recorded investigator approval covering every open decision, and it
// requires an approved return channel, because the interface must be able to
// tell a participant where the file actually goes.
const APPROVAL_PATH = 'study-private/approvals.json';
const REQUIRED_SIGNOFFS = [
  'protocolApproved', 'participantWordingApproved', 'collectionProcedureApproved',
];
const S_ITEMS = Array.from({ length: 21 }, (_, i) => `S${i + 1}`);

function loadApprovals() {
  const abs = locate(APPROVAL_PATH);
  if (!existsSync(abs)) return { ok: false, problems: [`${APPROVAL_PATH} does not exist`] };
  let rec;
  try { rec = JSON.parse(readFileSync(abs, 'utf8')); }
  catch (e) { return { ok: false, problems: [`${APPROVAL_PATH} is not valid JSON: ${e.message}`] }; }
  const problems = [];
  if (rec.approvalFormat !== 'investigator-approval-1') problems.push('approvalFormat must be investigator-approval-1');
  if (!rec.approvedBy) problems.push('approvedBy is missing');
  if (!rec.specFreezeId) problems.push('specFreezeId is missing');
  if (!rec.ethicsReviewStatus) problems.push('ethicsReviewStatus is missing');
  const decisions = rec.s1_s21 ?? {};
  const unresolved = S_ITEMS.filter((k) => !decisions[k] || decisions[k] === 'pending');
  if (unresolved.length) problems.push(`unresolved decisions: ${unresolved.join(', ')}`);
  // Scorer revision 2 introduced rules after the S1-S21 sheet; they need their own sign-off.
  const r2 = rec.scorerRevision2 ?? {};
  const unresolvedR2 = ['R2-1', 'R2-2', 'R2-3'].filter((k) => !r2[k] || r2[k] === 'pending');
  if (unresolvedR2.length) problems.push(`unresolved scorer revision decisions: ${unresolvedR2.join(', ')}`);
  for (const k of REQUIRED_SIGNOFFS) if (rec[k] !== true) problems.push(`${k} is not true`);
  const ch = rec.returnChannel;
  if (!ch || !ch.kind || !ch.instructions) {
    problems.push('returnChannel must name a kind and the exact participant instructions');
  }
  return { ok: problems.length === 0, problems, record: rec };
}

let approvals = null;
if (MODE === 'participant') {
  const res = loadApprovals();
  if (!res.ok) {
    console.error('REFUSING to build a participant release.');
    console.error('A participant package requires a recorded investigator approval:');
    for (const p of res.problems) console.error(`  - ${p}`);
    console.error('');
    console.error('A development package cannot be renamed into an approved one.');
    process.exit(2);
  }
  approvals = res.record;
}

const releaseMode = MODE;
const dataClass = MODE === 'participant' ? 'study-data' : 'development-rehearsal';
// A development build may carry a REHEARSAL return channel so the collection
// pipeline can be exercised end to end. It is stamped approved:false and the
// interface says so. A participant build takes its channel only from the
// recorded approval.
let devChannel = null;
if (DEV_RETURN_CHANNEL) {
  if (MODE !== 'development') {
    console.error('--dev-return-channel is only allowed for a development build.');
    process.exit(2);
  }
  const ch = JSON.parse(readFileSync(resolve(DEV_RETURN_CHANNEL), 'utf8'));
  if (!ch.kind || !ch.instructions) { console.error('dev return channel needs kind and instructions'); process.exit(2); }
  if (ch.url !== undefined && ch.url !== null && !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(ch.url)) {
    console.error(`dev return channel url must be an Apps Script web-app /exec URL (got ${ch.url})`);
    process.exit(2);
  }
  devChannel = { kind: ch.kind, instructions: ch.instructions, url: ch.url ?? null, approved: false };
}
const returnChannel = approvals ? { ...approvals.returnChannel, approved: true } : devChannel;

// --- 5. the package digest --------------------------------------------------
const components = [
  ...sources.map((s) => `${s.path}:${s.sha256}`),
  `effective-config:${configDigest}`,
  ...stimuli.map((s) => `${s.stimulusId}:${s.sha256}`),
  `scoring-key:${keyDigest.sha256}`,
  `release-mode:${releaseMode}`,
  `return-channel:${returnChannel ? sha256(JSON.stringify(returnChannel)) : 'none'}`,
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
  releaseMode,
  dataClass,
  returnChannel,
  approval: MODE === 'participant'
    ? `APPROVED PARTICIPANT RELEASE. specFreezeId ${approvals.specFreezeId}, approved by ${approvals.approvedBy}.`
    : 'DEVELOPMENT CANDIDATE - NOT APPROVED. Not a participant release. '
      + 'Anything recorded against this package is development-rehearsal data.',
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
writeFileSync(PUBLIC_PACKAGE_OUT, JSON.stringify({
  ...common,
  stimuli: stimuli.map((s) => ({ stimulusId: s.stimulusId, sha256: s.sha256, fnv: s.fnv })),
}, null, 2));

// Researcher-facing: the full record.
writeFileSync(join(PRIVATE_DIR, 'release-package.json'), JSON.stringify({
  ...common,
  sources,
  effectiveConfig: effective,
  stimuli,
  scoringKey: keyDigest,
  components,
}, null, 2));

console.log(`release package ${packageId}  [mode: ${releaseMode}]`);
console.log(`  digest        : ${packageDigest}`);
console.log(`  sources       : ${sources.length}`);
console.log(`  stimuli       : ${stimuli.length}`);
console.log(`  config digest : ${configDigest.slice(0, 16)}...`);
console.log(`  key digest    : ${keyDigest.sha256.slice(0, 16)}...`);
console.log('\n  participant side : study/release-package.json  (identity only)');
console.log(`  researcher side  : ${join(PRIVATE_DIR, 'release-package.json')}`);
const pub = readFileSync(PUBLIC_PACKAGE_OUT, 'utf8');
console.log('\n  participant-side leak check:');
for (const t of ['condition', 'scoringKey', 'v1Total', 'strict-grid', 'radial']) {
  console.log(`    contains "${t}": ${pub.includes(t)}`);
}
