/**
 * Prepares a PRIVATE Google Forms build from a frozen stimulus corpus.
 *
 *   node scripts/forms/prepare-forms-build.mjs --private-dir <corpus dir> --out <build dir>
 *        --mode rehearsal|study [--variants 4] [--codes 60] [--image-size 750]
 *
 * INPUTS (all private, all outside any git work tree)
 *   <corpus dir>/stimulus-key.json               frozen study-scorer results, pairing, strata
 *   <corpus dir>/public-staging/stimuli/*.json   the source layouts
 *   <corpus dir>/corpus-plan.json                purpose, status, secret namespace
 *   <corpus dir>/approvals.json                  REQUIRED in study mode (never created here)
 *
 * OUTPUTS (all private)
 *   <build>/images/img-XXXXXXXX.png    one PNG per stimulus, opaque name, no metadata
 *   <build>/build-plan.json            everything the builder needs + digests (no scores)
 *   <build>/mapping.json               variant/position/question title -> stimulus ID
 *   <build>/issued-codes.csv           study codes and their variant assignment (issued-code mode only)
 *   <build>/apps-script/BuildPlan.gs   the plan for the Apps Script builder (no stimulus IDs)
 *   <build>/apps-script/StimulusImages_NN.gs  base64 PNGs keyed by opaque image key
 *
 * STUDY CODES
 *   issued               the researcher issues XXXX-XXXX codes, assigned to forms round-robin
 *   participant-chosen   (formsApproval.codeMode) participants make up 6-12 letters or digits;
 *                        nothing is issued and no issued-codes.csv is written
 *
 * PRESENTATION
 *   --variants 1         one form, one recorded shuffled order, identical for every participant
 *   --variants K > 1     K forms, the recorded order rotated by k * n / K
 *   Either way, no two members of a matched pair are adjacent.
 *
 * The Apps Script project receives image keys, titles, texts and settings, but
 * never stimulus IDs, pairing, strata or scores. The join back to stimuli and
 * frozen scores happens only in scripts/forms/export-analysis.mjs, locally.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { rasterizeLayout, encodePng, RASTERIZER_VERSION } from '../../core/rasterize.js';
import { createRng } from '../../core/rng.js';

const flag = (name, dflt = null) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? dflt : process.argv[i + 1]; };
const fail = (msg) => { console.error(`REFUSING: ${msg}`); process.exit(2); };

const RESEARCH = join(import.meta.dirname, '..', '..');
const PRIVATE_DIR = flag('private-dir') ? resolve(flag('private-dir')) : fail('--private-dir is required');
const OUT = flag('out') ? resolve(flag('out')) : fail('--out is required');
const MODE = flag('mode');
if (!['rehearsal', 'study'].includes(MODE)) fail('--mode must be rehearsal or study');
const VARIANTS = Number(flag('variants', 4));
const CODES = Number(flag('codes', 60));
const IMAGE_SIZE = Number(flag('image-size', 750));
if (!Number.isInteger(VARIANTS) || VARIANTS < 1 || VARIANTS > 26) fail('--variants must be 1..26');
if (!Number.isInteger(CODES) || CODES < 0) fail('--codes must be a non-negative integer');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));

// --- 0. private locations only ------------------------------------------------------
function gitRoot(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return null;
  }
}
for (const [label, dir] of [['--private-dir', PRIVATE_DIR], ['--out', OUT]]) {
  const root = gitRoot(dir);
  if (root) fail(`${label} ${dir} is inside the git work tree ${root}`);
}
if (existsSync(OUT) && readdirSync(OUT).length) fail(`${OUT} is not empty; a build is prepared once into a fresh directory`);

// --- 1. the frozen corpus --------------------------------------------------------------
const keyBytes = readFileSync(join(PRIVATE_DIR, 'stimulus-key.json'));
const key = JSON.parse(keyBytes);
const plan = JSON.parse(readFileSync(join(PRIVATE_DIR, 'corpus-plan.json'), 'utf8'));
const manifestBytes = readFileSync(join(PRIVATE_DIR, 'public-staging', 'stimuli', 'manifest.json'));
const manifest = JSON.parse(manifestBytes);

if (key.manifestVersion !== manifest.manifestVersion) fail('key and manifest describe different corpora');
if (!plan.secretNamespace) fail('corpus plan has no secret namespace; was it built with build-study-corpus.mjs?');
const byId = new Map(key.items.map((it) => [it.stimulusId, it]));
if (byId.size !== manifest.items.length || manifest.items.some((m) => !byId.has(m.stimulusId))) {
  fail('manifest and key do not list the same stimuli');
}

// Development stimuli are exposed and must never be rated in a real study.
const devManifest = JSON.parse(readFileSync(join(RESEARCH, 'study', 'stimuli', 'manifest.json'), 'utf8'));
const devIds = new Set(devManifest.items.map((i) => i.stimulusId));
const reused = manifest.items.filter((i) => devIds.has(i.stimulusId)).map((i) => i.stimulusId);
if (reused.length) fail(`corpus reuses development stimuli: ${reused.join(', ')}`);

// --- 2. approvals ------------------------------------------------------------------------
const S_ITEMS = Array.from({ length: 21 }, (_, i) => `S${i + 1}`);
const DEFAULT_SETTINGS = Object.freeze({
  isQuiz: false,                   // no grading, no score feedback
  collectEmail: false,             // no email collection
  requireLogin: false,             // no sign-in requirement
  limitOneResponsePerUser: false,  // would require sign-in
  allowResponseEdits: false,
  publishingSummary: false,        // respondents cannot see response summaries
  showLinkToRespondAgain: false,
  progressBar: true,
  shuffleQuestions: false,         // presentation order is recorded per variant instead
  acceptingResponses: false,       // built closed; opened only on authorisation
});

let texts;
let settings = { ...DEFAULT_SETTINGS };
let approvalRecord = null;
let codeMode = 'issued';
let questionTexts = {
  orderQuestion: 'How ordered does this composition appear?',
  appealQuestion: 'How visually appealing do you find it?',
  orderLow: 'Not at all ordered', orderHigh: 'Highly ordered',
  appealLow: 'Not at all appealing', appealHigh: 'Very appealing',
};

if (MODE === 'study') {
  if (key.purpose !== 'study' || key.planStatus !== 'approved') fail('study mode requires a corpus built from an approved study plan');
  const apPath = join(PRIVATE_DIR, 'approvals.json');
  if (!existsSync(apPath)) fail(`${apPath} does not exist; approvals are recorded by the investigator, never inferred`);
  const ap = JSON.parse(readFileSync(apPath, 'utf8'));
  const problems = [];
  if (ap.approvalFormat !== 'investigator-approval-2') problems.push('approvalFormat must be investigator-approval-2 (Google Forms collection)');
  for (const k of ['approvedBy', 'specFreezeId', 'ethicsReviewStatus']) if (!ap[k]) problems.push(`${k} is missing`);
  const unresolved = S_ITEMS.filter((k) => !ap.s1_s21?.[k] || ap.s1_s21[k] === 'pending');
  if (unresolved.length) problems.push(`unresolved decisions: ${unresolved.join(', ')}`);
  const r2 = ['R2-1', 'R2-2', 'R2-3'].filter((k) => !ap.scorerRevision2?.[k] || ap.scorerRevision2[k] === 'pending');
  if (r2.length) problems.push(`unresolved scorer revision decisions: ${r2.join(', ')}`);
  for (const k of ['protocolApproved', 'participantWordingApproved', 'collectionProcedureApproved', 'corpusApproved']) {
    if (ap[k] !== true) problems.push(`${k} is not true`);
  }
  const fa = ap.formsApproval ?? {};
  for (const k of ['formTitle', 'participantInformation', 'consentQuestion', 'agreeChoice', 'declineChoice', 'codeQuestion', 'confirmationMessage']) {
    if (typeof fa[k] !== 'string' || !fa[k].trim()) problems.push(`formsApproval.${k} is missing`);
  }
  if (fa.codeMode !== undefined && !['issued', 'participant-chosen'].includes(fa.codeMode)) problems.push('formsApproval.codeMode must be issued or participant-chosen');
  if (fa.codeMode === 'participant-chosen' && CODES !== 0 && flag('codes') !== null) problems.push('participant-chosen codes: do not pass --codes');
  for (const k of ['orderQuestion', 'appealQuestion', 'orderLow', 'orderHigh', 'appealLow', 'appealHigh', 'codeHelp', 'codeValidationHelp']) {
    if (fa[k] !== undefined && (typeof fa[k] !== 'string' || !fa[k].trim())) problems.push(`formsApproval.${k} must be non-empty text when given`);
  }
  // Unfilled drafting placeholders such as "[approved duration]" must never reach participants.
  for (const [k, v] of Object.entries(fa)) {
    if (typeof v === 'string' && /\[[^\]]*\]/.test(v)) problems.push(`formsApproval.${k} still contains a placeholder: ${v.match(/\[[^\]]*\]/)[0]}`);
  }
  if (fa.variants !== VARIANTS) problems.push(`formsApproval.variants (${fa.variants}) must equal --variants (${VARIANTS})`);
  const overrides = fa.settingsOverrides ?? {};
  for (const [k, v] of Object.entries(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) problems.push(`unknown setting override ${k}`);
    else if (typeof v !== 'boolean') problems.push(`setting override ${k} must be boolean`);
    else if (k === 'acceptingResponses' && v) problems.push('forms are always built closed; open them separately once authorised');
  }
  if (problems.length) {
    console.error('REFUSING to prepare a study build:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  settings = { ...DEFAULT_SETTINGS, ...overrides };
  codeMode = fa.codeMode ?? 'issued';
  for (const k of Object.keys(questionTexts)) if (fa[k]) questionTexts[k] = fa[k];
  texts = {
    formTitle: fa.formTitle,
    participantInformation: fa.participantInformation,
    consentQuestion: fa.consentQuestion,
    agreeChoice: fa.agreeChoice,
    declineChoice: fa.declineChoice,
    codeQuestion: fa.codeQuestion,
    codeHelp: fa.codeHelp ?? (codeMode === 'issued' ? 'Enter the code exactly as you received it.' : 'Make up a code using 6-12 letters or digits.'),
    codeValidationHelp: fa.codeValidationHelp ?? (codeMode === 'issued' ? 'Format: XXXX-XXXX' : 'Use 6-12 letters or digits, with no spaces.'),
    confirmationMessage: fa.confirmationMessage,
  };
  approvalRecord = { approvedBy: ap.approvedBy, specFreezeId: ap.specFreezeId, ethicsReviewStatus: ap.ethicsReviewStatus, approvalsDigest: sha256(readFileSync(apPath)) };
} else {
  if (key.purpose !== 'rehearsal') fail('rehearsal mode requires a rehearsal corpus (never rehearse on the study corpus)');
  texts = {
    formTitle: '[REHEARSAL] Composition rating — software test, not a study',
    participantInformation: 'REHEARSAL ONLY. This form tests the survey software. It is not a research study, '
      + 'nothing here is research consent, and answers are development data that will be deleted. '
      + 'Do not invite participants to this form.',
    consentQuestion: 'REHEARSAL: this is not research consent. Continue with the software test?',
    agreeChoice: 'Continue the rehearsal',
    declineChoice: 'Stop',
    codeQuestion: 'Study code',
    codeHelp: 'Enter a rehearsal code from issued-codes.csv (format XXXX-XXXX).',
    codeValidationHelp: 'Format: XXXX-XXXX',
    confirmationMessage: 'Rehearsal response recorded. This was a software test, not a study.',
  };
}

// --- 3. images -------------------------------------------------------------------------------
mkdirSync(join(OUT, 'images'), { recursive: true });
mkdirSync(join(OUT, 'apps-script'), { recursive: true });
const NS = plan.secretNamespace;
const images = manifest.items.map((m) => {
  const layoutBytes = readFileSync(join(PRIVATE_DIR, 'public-staging', m.file));
  const layout = JSON.parse(layoutBytes);
  const png = encodePng(rasterizeLayout(layout, { width: IMAGE_SIZE, height: IMAGE_SIZE }));
  // Opaque, unlinkable key: not the stimulus ID and not derivable from it without the namespace.
  const imageKey = `img-${sha256(`${NS}:image:${m.stimulusId}`).slice(0, 10)}`;
  writeFileSync(join(OUT, 'images', `${imageKey}.png`), png);
  return { stimulusId: m.stimulusId, imageKey, pngSha256: sha256(png), pngBytes: png.length, layoutSha256: sha256(layoutBytes), png };
});
if (new Set(images.map((i) => i.pngSha256)).size !== images.length) fail('two stimuli rendered to identical images');

// --- 4. presentation-order variants -------------------------------------------------------------
// One seeded base order in which no two members of a matched pair are adjacent,
// cyclically. Variant k is that order rotated by k * n / K, so every variant keeps
// the no-adjacency property and each stimulus occupies K evenly spaced positions.
const n = images.length;
const pairOf = (id) => byId.get(id).pairId ?? null;
const rng = createRng(`${NS}:forms-order`);
let base = null;
for (let attempt = 0; attempt < 10000 && !base; attempt++) {
  const a = images.map((i) => i.stimulusId);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const ok = a.every((id, i) => { const nxt = a[(i + 1) % a.length]; return !pairOf(id) || pairOf(id) !== pairOf(nxt); });
  if (ok) base = a;
}
if (!base) fail('could not find an order without adjacent pair members');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const imageKeyOf = new Map(images.map((i) => [i.stimulusId, i.imageKey]));
const variants = Array.from({ length: VARIANTS }, (_, k) => {
  const shift = Math.round((k * n) / VARIANTS) % n;
  const order = [...base.slice(shift), ...base.slice(0, shift)];
  const letter = LETTERS[k];
  return {
    variant: letter,
    rotation: shift,
    formTitle: VARIANTS === 1 ? texts.formTitle : `${texts.formTitle} (form ${letter})`,
    sections: order.map((stimulusId, idx) => {
      // A neutral position tag keeps every response column unique and lets the
      // exporter identify the form by its header row.
      const pos = String(idx + 1).padStart(2, '0');
      const tag = VARIANTS === 1 ? `[${pos}]` : `[${letter}-${pos}]`;
      return {
        position: idx + 1,
        stimulusId,
        imageKey: imageKeyOf.get(stimulusId),
        sectionTitle: `Composition ${idx + 1} of ${n}`,
        orderTitle: `${tag} ${questionTexts.orderQuestion}`,
        appealTitle: `${tag} ${questionTexts.appealQuestion}`,
      };
    }),
  };
});

// --- 5. study codes -------------------------------------------------------------------------------
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford base32: no I, L, O, U
const CODE_PATTERN = codeMode === 'issued' ? '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' : '^[A-Za-z0-9]{6,12}$';
const codes = new Set();
while (codeMode === 'issued' && codes.size < CODES) {
  const b = randomBytes(8);
  const s = [...b].map((x) => CODE_ALPHABET[x % 32]).join('');
  codes.add(`${s.slice(0, 4)}-${s.slice(4)}`);
}
const issued = [...codes].map((code, i) => ({ code, variant: LETTERS[i % VARIANTS] }));

// --- 6. the plan (no scores, no pairing, no strata) ---------------------------------------------------
const QUESTIONS = {
  orderLow: questionTexts.orderLow, orderHigh: questionTexts.orderHigh,
  appealLow: questionTexts.appealLow, appealHigh: questionTexts.appealHigh,
  sectionHelp: 'Look at the composition, then answer both questions.',
  instructionsVersion: 'forms-instructions-1',
};
const buildPlan = {
  planFormat: 'forms-build-plan-1',
  mode: MODE,
  dataClass: MODE === 'study' ? 'study-data' : 'development-rehearsal',
  corpus: { manifestVersion: manifest.manifestVersion, manifestSha256: sha256(manifestBytes), keySha256: sha256(keyBytes), modelVersion: key.items[0].modelVersion, stimuli: n },
  rasterizer: { version: RASTERIZER_VERSION, imageSize: IMAGE_SIZE, nodeVersion: process.versions.node, zlibVersion: process.versions.zlib },
  approval: approvalRecord ?? 'REHEARSAL - no approvals recorded; not a study',
  settings,
  texts,
  questions: QUESTIONS,
  codeMode,
  codePattern: CODE_PATTERN,
  presentation: {
    design: VARIANTS === 1 ? 'single-fixed-order' : 'rotated-order-variants',
    forms: VARIANTS,
    orderIsPerParticipant: false,
    pairMembersAdjacent: false,
  },
  images: images.map(({ imageKey, pngSha256, pngBytes }) => ({ imageKey, pngSha256, pngBytes })).sort((a, b) => (a.imageKey < b.imageKey ? -1 : 1)),
  variants: variants.map((v) => ({
    variant: v.variant, formTitle: v.formTitle, rotation: v.rotation,
    sections: v.sections.map(({ position, imageKey, sectionTitle, orderTitle, appealTitle }) => ({ position, imageKey, sectionTitle, orderTitle, appealTitle })),
  })),
};
buildPlan.planDigest = sha256(canonical(buildPlan));

const mapping = {
  mappingFormat: 'forms-mapping-1',
  warning: 'RESEARCHER ONLY. Maps survey questions to stimuli. Never upload, share or attach.',
  planDigest: buildPlan.planDigest,
  mode: MODE,
  dataClass: buildPlan.dataClass,
  keySha256: buildPlan.corpus.keySha256,
  manifestVersion: manifest.manifestVersion,
  images: images.map(({ stimulusId, imageKey, pngSha256, layoutSha256 }) => ({ stimulusId, imageKey, pngSha256, layoutSha256 })),
  variants: variants.map((v) => ({
    variant: v.variant,
    formTitle: v.formTitle,
    sections: v.sections.map((s) => ({ ...s, pairId: byId.get(s.stimulusId).pairId ?? null, role: byId.get(s.stimulusId).role ?? null })),
  })),
};

writeFileSync(join(OUT, 'build-plan.json'), JSON.stringify(buildPlan, null, 2));
writeFileSync(join(OUT, 'mapping.json'), JSON.stringify(mapping, null, 2));
if (codeMode === 'issued') writeFileSync(join(OUT, 'issued-codes.csv'), `code,variant\n${issued.map((r) => `${r.code},${r.variant}`).join('\n')}\n`);

writeFileSync(join(OUT, 'apps-script', 'BuildPlan.gs'),
  `/** GENERATED by prepare-forms-build.mjs. Private. Contains no stimulus IDs or scores. */\nvar BUILD_PLAN = ${JSON.stringify(buildPlan, null, 2)};\n`);

// Base64 images in chunks small enough for the Apps Script editor.
const CHUNK = 180000;
let chunkIndex = 1; let current = []; let size = 0;
const flush = () => {
  if (!current.length) return;
  const name = `StimulusImages_${String(chunkIndex).padStart(2, '0')}.gs`;
  const body = current.map(([k, b64]) => `STIMULUS_IMAGES[${JSON.stringify(k)}] = ${JSON.stringify(b64)};`).join('\n');
  writeFileSync(join(OUT, 'apps-script', name),
    `/** GENERATED. Private. Base64 PNG stimuli keyed by opaque image key. */\nvar STIMULUS_IMAGES = typeof STIMULUS_IMAGES === 'undefined' ? {} : STIMULUS_IMAGES;\n${body}\n`);
  chunkIndex++; current = []; size = 0;
};
for (const img of [...images].sort((a, b) => (a.imageKey < b.imageKey ? -1 : 1))) {
  const b64 = img.png.toString('base64');
  if (size + b64.length > CHUNK) flush();
  current.push([img.imageKey, b64]); size += b64.length;
}
flush();

console.log(`prepared ${MODE} forms build`);
console.log(`  plan digest   ${buildPlan.planDigest}`);
console.log(`  stimuli       ${n} images at ${IMAGE_SIZE}px (${RASTERIZER_VERSION})`);
console.log(`  variants      ${VARIANTS} (${variants.map((v) => `${v.variant}+${v.rotation}`).join(', ')})`);
console.log(codeMode === 'issued' ? `  study codes   ${issued.length} issued` : '  study codes   chosen by participants (none issued)');
console.log(`  data files    ${chunkIndex - 1} StimulusImages_NN.gs`);
console.log('  every output is private; nothing here may be committed, uploaded publicly or attached');
