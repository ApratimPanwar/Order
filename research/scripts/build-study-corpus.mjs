/**
 * Builds a FRESH stimulus corpus from a corpus plan, with every private output
 * kept outside any git work tree.
 *
 *   node scripts/build-study-corpus.mjs --private-dir <dir> [--label <label>]
 *
 * <dir>/corpus-plan.json must exist (see docs/CORPUS-SAMPLING-PLAN.md). If the
 * plan has no `secretNamespace`, one is generated from the operating system's
 * CSPRNG and written back into the private plan.
 *
 * OUTPUTS
 *
 *   <dir>/public-staging/stimuli/      participant-facing layouts + manifest
 *                                      (geometry and integrity only)
 *   <dir>/stimulus-key.json            RESEARCHER ONLY: pair, role, stratum,
 *                                      generator seed, study-scorer result
 *   <dir>/corpus-report.json           RESEARCHER ONLY: sampling frame counts
 *
 * WHY THE SEEDS ARE SECRET
 *
 * Generation is deterministic and the code is public. Anyone holding the seed
 * list could regenerate the corpus and read off which stimuli are paired and
 * how they were stratified. Seeds are therefore derived from a private random
 * namespace and never leave the private directory. No seed in the public
 * evidence range (1..20000) is used, so no participant stimulus coincides with a
 * published layout.
 *
 * WHAT SECRECY CANNOT PROTECT
 *
 * The scorer is public and the stimuli are served to participants, so any model
 * score can be recomputed by someone who runs the scorer on a served stimulus.
 * Keeping the key private protects the pairing, the stratum assignment and the
 * researcher's records; it does not make scores unknowable. Stated in the plan.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

import { generateLayout, randomizePositionsMatched, BASELINE_VERSION, GENERATOR_VERSION } from '../core/generate.js';
import { getPreset, IMPLEMENTATION_VERSION } from '../core/presets/registry.js';
import { createLayout, serialize, layoutHash } from '../core/layout.js';
import { score } from '../core/scoring/v1.js';
import { MODEL_VERSION, CONFIG_VERSION } from '../core/scoring/v1-config.js';
import { RENDERER_2 } from '../core/geometry.js';
import { createRng } from '../core/rng.js';

const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
if (!flag('private-dir')) { console.error('--private-dir is required'); process.exit(2); }
const PRIVATE_DIR = resolve(flag('private-dir'));

for (let d = PRIVATE_DIR; ; d = dirname(d)) {
  if (existsSync(join(d, '.git'))) {
    console.error(`REFUSING: ${PRIVATE_DIR} is inside the git work tree ${d}.`);
    process.exit(2);
  }
  if (dirname(d) === d) break;
}

const PLAN_PATH = join(PRIVATE_DIR, 'corpus-plan.json');
if (!existsSync(PLAN_PATH)) { console.error(`missing ${PLAN_PATH}`); process.exit(2); }
const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));

function planProblems(p) {
  const out = [];
  if (p.planFormat !== 'corpus-plan-1') out.push('planFormat must be corpus-plan-1');
  if (!['rehearsal', 'study'].includes(p.purpose)) out.push('purpose must be rehearsal or study');
  if (p.design !== 'matched-pairs/strict-grid-vs-position-twin') out.push('unsupported design');
  if (!Number.isInteger(p.candidateDraws) || p.candidateDraws < 1) out.push('candidateDraws');
  if (!p.elementCount || !(p.elementCount.min >= 4) || !(p.elementCount.max >= p.elementCount.min)) out.push('elementCount');
  if (!Array.isArray(p.strata) || !p.strata.length) out.push('strata');
  for (const s of p.strata ?? []) {
    if (!s.id || !Number.isInteger(s.pairs) || s.pairs < 0) out.push(`stratum ${s.id}: id and integer pairs`);
    if (s.kind !== 'non-positive-delta' && !(Array.isArray(s.positiveDeltaQuantile) && s.positiveDeltaQuantile.length === 2)) {
      out.push(`stratum ${s.id}: kind non-positive-delta or positiveDeltaQuantile [lo, hi]`);
    }
  }
  if (p.includeDeliberatelyUnsupportedItem === true && !p.unsupportedItemStudyReason) {
    out.push('an unsupported item needs an explicit unsupportedItemStudyReason');
  }
  if (p.purpose === 'study' && p.status !== 'approved') out.push('a study corpus requires status "approved" in the plan');
  return out;
}
const problems = planProblems(plan);
if (problems.length) {
  console.error('corpus plan rejected:');
  for (const x of problems) console.error(`  - ${x}`);
  process.exit(2);
}

if (!plan.secretNamespace) {
  plan.secretNamespace = randomBytes(32).toString('hex');
  writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));
}
const NS = plan.secretNamespace;
const LABEL = flag('label') ?? `${plan.purpose}-corpus`;
const planDigest = createHash('sha256').update(JSON.stringify({ ...plan, secretNamespace: '<redacted>' })).digest('hex');

// --- 1. the sampling frame ----------------------------------------------------
/** Visible elements only: invisible generator draws are not part of a stimulus. */
function asStimulus(built) {
  return createLayout({
    id: null,
    canvas: built.canvas,
    renderer: { gridOverlay: false, gridSize: 8, showArrows: false },
    elements: built.elements.filter((e) => e.visible),
    meta: { rendererVersion: RENDERER_2, schemaNote: 'blind-rating stimulus' },
  });
}

const frame = [];
const frameCounts = { drawn: 0, outsideElementRange: 0, unsupported: 0, eligible: 0 };
for (let i = 0; i < plan.candidateDraws; i++) {
  frameCounts.drawn++;
  const genSeed = `${NS}:gen:${i}`;
  const source = asStimulus(getPreset('strict-grid').apply(generateLayout({ seed: genSeed })));
  const n = source.elements.length;
  if (n < plan.elementCount.min || n > plan.elementCount.max) { frameCounts.outsideElementRange++; continue; }
  const twin = asStimulus(randomizePositionsMatched(source, { seed: `${NS}:twin:${i}` }));
  const a = score(source); const b = score(twin);
  if (!a.scorable || !b.scorable) { frameCounts.unsupported++; continue; }
  frameCounts.eligible++;
  frame.push({ i, genSeed, source, twin, a, b, delta: a.total - b.total });
}

// --- 2. stratified selection -------------------------------------------------------
const positive = frame.filter((c) => c.delta > 0).map((c) => c.delta).sort((x, y) => x - y);
const quantile = (f) => positive[Math.min(positive.length - 1, Math.max(0, Math.floor(f * positive.length)))];
const pick = createRng(`${NS}:select`);
const used = new Set();
const selected = [];
const strataReport = [];
for (const s of plan.strata) {
  let members;
  let bounds;
  if (s.kind === 'non-positive-delta') {
    members = frame.filter((c) => c.delta <= 0);
    bounds = { deltaMax: 0 };
  } else {
    const [lo, hi] = s.positiveDeltaQuantile;
    const dLo = lo <= 0 ? 0 : quantile(lo);
    const dHi = hi >= 1 ? Infinity : quantile(hi);
    members = frame.filter((c) => c.delta > 0 && c.delta >= dLo && (hi >= 1 ? true : c.delta < dHi));
    bounds = { deltaMinInclusive: dLo, deltaMaxExclusive: hi >= 1 ? null : dHi };
  }
  const pool = members.filter((c) => !used.has(c.i));
  const chosen = [];
  while (chosen.length < s.pairs && pool.length) {
    const k = Math.floor(pick.next() * pool.length);
    const [c] = pool.splice(k, 1);
    used.add(c.i);
    chosen.push(c);
  }
  strataReport.push({ id: s.id, requestedPairs: s.pairs, frameMembers: members.length, selectedPairs: chosen.length, bounds });
  if (chosen.length < s.pairs) {
    console.error(`sampling group ${strataReport.length}: only ${chosen.length} of ${s.pairs} pairs available in the frame`);
    process.exit(3);
  }
  for (const c of chosen) selected.push({ ...c, stratum: s.id });
}

// --- 3. write -------------------------------------------------------------------------
const STAGING = join(PRIVATE_DIR, 'public-staging');
if (existsSync(STAGING)) rmSync(STAGING, { recursive: true, force: true });
mkdirSync(join(STAGING, 'stimuli'), { recursive: true });

const publicItems = [];
const keyItems = [];
const finalise = (layout) => {
  const id = `stim-${layoutHash(layout)}`;
  layout.id = id;
  return { id, text: serialize(layout), integrity: layoutHash(layout) };
};
selected.forEach((c, n) => {
  const pairId = `pair-${createHash('sha256').update(`${NS}:pair:${c.i}`).digest('hex').slice(0, 10)}`;
  for (const [role, layout, result] of [['grid-source', c.source, c.a], ['position-twin', c.twin, c.b]]) {
    const { id, text, integrity } = finalise(layout);
    if (publicItems.some((p) => p.stimulusId === id)) { console.error(`stimulus id collision ${id}`); process.exit(3); }
    writeFileSync(join(STAGING, 'stimuli', `${id}.json`), text);
    publicItems.push({ stimulusId: id, file: `stimuli/${id}.json`, integrity, rendererVersion: RENDERER_2 });
    keyItems.push({
      stimulusId: id, integrity, pairId, role, stratum: c.stratum, candidateIndex: c.i,
      generatorSeed: c.genSeed, scoreAvailable: result.scorable,
      v1: { total: result.total, dimensions: result.dimensions, submetrics: result.submetrics },
      pairDelta: c.delta, diagnostics: result.diagnostics,
      modelVersion: result.modelVersion, configVersion: result.configVersion, approval: result.approval.overall,
    });
  }
});
// Public manifest order carries no pairing: sorted by opaque id.
publicItems.sort((x, y) => (x.stimulusId < y.stimulusId ? -1 : 1));

const manifestVersion = `${LABEL}-manifest`;
writeFileSync(join(STAGING, 'stimuli', 'manifest.json'), JSON.stringify({
  manifestVersion,
  builtAt: new Date().toISOString(),
  note: 'Participant bundle. Geometry and integrity hashes only - no scores, conditions, pairing or methods.',
  count: publicItems.length,
  items: publicItems,
}, null, 2));

writeFileSync(join(PRIVATE_DIR, 'stimulus-key.json'), JSON.stringify({
  keyVersion: 'stimulus-key-3',
  manifestVersion,
  builtAt: new Date().toISOString(),
  warning: 'RESEARCHER ONLY. Never commit, upload, attach or log this file.',
  purpose: plan.purpose,
  planStatus: plan.status ?? 'proposed',
  planDigestRedacted: planDigest,
  approval: 'DEVELOPMENT CANDIDATE scorer - none of S1-S21 approved',
  count: keyItems.length,
  items: keyItems,
}, null, 2));

writeFileSync(join(PRIVATE_DIR, 'corpus-report.json'), JSON.stringify({
  label: LABEL, purpose: plan.purpose, planStatus: plan.status ?? 'proposed', planDigestRedacted: planDigest,
  provenance: {
    scorer: MODEL_VERSION, configVersion: CONFIG_VERSION, generatorVersion: GENERATOR_VERSION,
    preset: 'strict-grid', presetImplementationVersion: IMPLEMENTATION_VERSION, baselineVersion: BASELINE_VERSION,
  },
  frameCounts, strata: strataReport,
  stimuli: publicItems.length, pairs: selected.length,
  deliberatelyUnsupportedItemIncluded: false,
}, null, 2));

console.log(`corpus ${LABEL}  [${plan.purpose}, plan ${plan.status ?? 'proposed'}]`);
console.log(`  frame: drawn ${frameCounts.drawn}, outside element range ${frameCounts.outsideElementRange}, unsupported ${frameCounts.unsupported}, eligible ${frameCounts.eligible}`);
// Counts only. Stratum names and membership stay in the private report.
strataReport.forEach((s, k) => console.log(`  sampling group ${k + 1}: ${s.selectedPairs}/${s.requestedPairs} pairs from ${s.frameMembers}`));
console.log(`  stimuli ${publicItems.length} (${selected.length} pairs)  -> ${STAGING}`);
console.log('  key and report written to the private directory only (paths not echoed to logs)');
