/**
 * Offline score join — the researcher-side step.
 *
 *   node scripts/join-responses.mjs <export.json> [--out joined.json] [--allow-identity-mismatch]
 *
 * The participant bundle carries no scores, so a downloaded response file has
 * `scoreAvailable: null` and `analysisEligible.modelAgreement: null`. This joins
 * it against study-private/stimulus-key.json on stimulusId and fills them in.
 *
 * RULES ENFORCED HERE
 *
 * 1. WITHDRAWAL (F1). If the export is withdrawn, every response is marked
 *    ineligible for ALL analysis and `exclusionRule: 'X2-withdrawn'`. The join
 *    cannot reinstate a withdrawn participant, and refuses to compute
 *    model-agreement eligibility for one.
 *
 * 2. UNMATCHED RESPONSES ARE PRESERVED (F2). A response whose stimulusId is not
 *    in the key is retained with `joinStatus: 'unmatched-stimulus'` and null
 *    score fields. Dropping it would silently lose a real human rating.
 *
 * 3. IDENTITY BINDING (F2). The export and the key must refer to the same
 *    archived manifest, and every matched response must agree on the layout
 *    integrity hash. Model and config versions are recorded from the key, not
 *    assumed. A mismatch aborts unless --allow-identity-mismatch is passed, and
 *    is recorded in the output either way.
 *
 * 4. A rating stays valid when the model cannot score the layout: joining sets
 *    `modelAgreement: false` and leaves `ratingOnly` as the session recorded it.
 *
 * Scores come from the v1 DEVELOPMENT CANDIDATE. None of S1-S21 is approved.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const exportPath = process.argv[2];
if (!exportPath) {
  console.error('usage: node scripts/join-responses.mjs <export.json> [--out joined.json] [--allow-identity-mismatch]');
  process.exit(2);
}
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx === -1 ? null : process.argv[outIdx + 1];
const allowMismatch = process.argv.includes('--allow-identity-mismatch');

const ROOT = join(import.meta.dirname, '..');
const KEY = join(ROOT, 'study-private', 'stimulus-key.json');
const PKG = join(ROOT, 'study-private', 'release-package.json');
if (!existsSync(KEY)) {
  console.error(`stimulus key not found at ${KEY}. Run: node scripts/build-stimuli.mjs`);
  process.exit(2);
}
if (!existsSync(PKG)) {
  console.error(`release package not found at ${PKG}. Run: node scripts/build-release-package.mjs`);
  process.exit(2);
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));

const rec = JSON.parse(readFileSync(exportPath, 'utf8'));
const key = JSON.parse(readFileSync(KEY, 'utf8'));
const byId = new Map(key.items.map((i) => [i.stimulusId, i]));

// --- 3. identity binding ---------------------------------------------------
const currentKeyDigest = sha256(readFileSync(KEY));
const identity = {
  // Content digests, not reusable labels. A rebuild that changes any stimulus
  // changes packageDigest, so a mismatch is detectable even when the labels
  // ('stimuli-1') are identical.
  exportPackageId: rec.releasePackageId ?? null,
  exportPackageDigest: rec.releasePackageDigest ?? null,
  currentPackageId: pkg.packageId,
  currentPackageDigest: pkg.packageDigest,
  packageDigestMatches: null,
  keyDigestInPackage: pkg.scoringKey?.sha256 ?? null,
  currentKeyDigest,
  keyDigestMatches: pkg.scoringKey?.sha256 === currentKeyDigest,
  exportManifestVersion: rec.manifestVersion ?? null,
  keyManifestVersion: key.manifestVersion ?? null,
  exportSessionFormat: rec.sessionFormat ?? null,
  keyVersion: key.keyVersion ?? null,
  modelVersion: key.items[0]?.modelVersion ?? null,
  configVersion: key.items[0]?.configVersion ?? null,
  problems: [],
};

if (identity.exportPackageDigest === null) {
  identity.problems.push(
    'export carries no releasePackageDigest; it predates frozen identity binding '
    + 'and cannot be bound to a specific archive',
  );
} else if (identity.exportPackageDigest !== pkg.packageDigest) {
  identity.packageDigestMatches = false;
  identity.problems.push(
    `release package mismatch: export "${identity.exportPackageDigest.slice(0, 16)}..." `
    + `vs current "${pkg.packageDigest.slice(0, 16)}..."`,
  );
} else {
  identity.packageDigestMatches = true;
}
if (!identity.keyDigestMatches) {
  identity.problems.push(
    'the scoring key on disk is not the one recorded in the release package; '
    + 'a current key must never be silently substituted',
  );
}
if (identity.keyManifestVersion === null) {
  identity.problems.push('key does not record a manifestVersion; rebuild with build-stimuli.mjs');
} else if (identity.exportManifestVersion !== identity.keyManifestVersion) {
  identity.problems.push(
    `manifest mismatch: export "${identity.exportManifestVersion}" vs key "${identity.keyManifestVersion}"`,
  );
}
const modelVersions = new Set(key.items.map((i) => i.modelVersion));
if (modelVersions.size > 1) {
  identity.problems.push(`key mixes model versions: ${[...modelVersions].join(', ')}`);
}
if (rec.transmitted !== false) {
  identity.problems.push('export does not carry transmitted:false; check its provenance');
}

if (identity.problems.length && !allowMismatch) {
  console.error('IDENTITY BINDING FAILED — refusing to join:');
  for (const p of identity.problems) console.error(`  - ${p}`);
  console.error('\nPass --allow-identity-mismatch to join anyway (recorded in the output).');
  process.exit(3);
}

// --- 1. withdrawal ---------------------------------------------------------
const withdrawn = rec.withdrawn === true;

const pkgStimuli = new Map((pkg.stimuli ?? []).map((s) => [s.stimulusId, s]));
const rows = [];
const counts = { matched: 0, unmatched: 0, integrityMismatch: 0 };

// A missing or mismatched identity must PREVENT primary model-agreement use,
// even when the operator overrides the abort to inspect the data.
const identityOk = identity.problems.length === 0;

for (const r of rec.responses) {
  const k = byId.get(r.stimulusId);
  const isMatched = Boolean(k);
  if (isMatched) counts.matched++; else counts.unmatched++;

  // Integrity: a matched response must refer to the same archived layout, and
  // that layout must be the one in the release package.
  let integrityAgrees = null;
  if (isMatched && r.stimulusIntegrity !== undefined && r.stimulusIntegrity !== null) {
    const pkgEntry = pkgStimuli.get(r.stimulusId);
    integrityAgrees = r.stimulusIntegrity === k.integrity
      && (!pkgEntry || pkgEntry.fnv === r.stimulusIntegrity);
    if (!integrityAgrees) counts.integrityMismatch++;
  }

  const scoreAvailable = isMatched ? k.scoreAvailable : null;
  // modelAgreement requires: a match, a model score, a valid trial, and no withdrawal.
  const modelAgreement = (withdrawn || !identityOk)
    ? false
    : Boolean(isMatched && scoreAvailable && r.trialValid && integrityAgrees !== false);
  const ratingOnly = withdrawn ? false : (r.analysisEligible?.ratingOnly ?? r.trialValid ?? false);

  r.scoreAvailable = scoreAvailable;
  r.analysisEligible = { modelAgreement, ratingOnly };
  r.joinStatus = isMatched ? 'matched' : 'unmatched-stimulus';
  if (withdrawn) r.exclusionRule = 'X2-withdrawn';
  else if (isMatched && integrityAgrees === false) r.exclusionRule = 'X1-integrity-mismatch';

  rows.push({
    participantId: rec.participantId,
    stimulusId: r.stimulusId,
    joinStatus: r.joinStatus,
    presentationIndex: r.presentationIndex,
    perceivedOrder: r.perceivedOrder,
    appeal: r.appeal,
    confidence: r.confidence ?? '',
    trialValid: r.trialValid,
    withdrawn,
    scoreAvailable: scoreAvailable === null ? '' : scoreAvailable,
    modelAgreementEligible: modelAgreement,
    ratingOnlyEligible: ratingOnly,
    exclusionRule: r.exclusionRule ?? '',
    invalidReason: r.invalidReason ?? '',
    // Unmatched rows carry no condition or score - empty, never 0, never guessed.
    condition: isMatched ? k.condition : '',
    v1Total: isMatched && k.v1 ? k.v1.total : '',
    modelVersion: isMatched ? k.modelVersion : '',
    layoutIntegrity: isMatched ? k.integrity : '',
  });
}

const joined = {
  joinFormat: 'rating-join-2',
  joinedAt: new Date().toISOString(),
  approval: 'DEVELOPMENT CANDIDATE - NOT APPROVED. v1 scores here are not approved measurements.',
  withdrawal: {
    withdrawn,
    policy: rec.withdrawalPolicy ?? null,
    effect: withdrawn
      ? 'ALL responses are ineligible for every analysis (model-agreement and rating-only).'
      : 'not applicable',
  },
  identity: {
    ...identity,
    accepted: identityOk,
    overridden: allowMismatch && !identityOk,
    effectOnAnalysis: identityOk
      ? 'identity bound; model-agreement eligibility computed normally'
      : 'IDENTITY NOT BOUND - every response is excluded from model-agreement use. '
        + 'Rating-only eligibility is unaffected and raw responses are preserved.',
  },
  diagnosticRescoring: {
    performed: false,
    note: 'No cross-version rescoring was performed. If a future run rescores these '
      + 'layouts under a different model version, it must be labelled a '
      + 'model-comparison diagnostic and must not replace these rows.',
  },
  provenance: {
    exportFile: exportPath,
    keyVersion: key.keyVersion,
    manifestVersion: identity.keyManifestVersion,
    modelVersion: identity.modelVersion,
    configVersion: identity.configVersion,
    participantId: rec.participantId,
    instrumentVersion: rec.instrumentVersion,
    sessionFormat: rec.sessionFormat,
    transmitted: rec.transmitted,
  },
  counts: {
    responses: rec.responses.length,
    matched: counts.matched,
    unmatchedPreserved: counts.unmatched,
    integrityMismatch: counts.integrityMismatch,
    ratingOnlyEligible: rows.filter((r) => r.ratingOnlyEligible).length,
    modelAgreementEligible: rows.filter((r) => r.modelAgreementEligible).length,
    retainedDespiteNoScore: rows.filter((r) => r.scoreAvailable === false && r.ratingOnlyEligible).length,
  },
  rows,
};

if (outPath) {
  // Never overwrite the raw export, and never overwrite an existing join.
  const rawResolved = resolve(exportPath);
  for (const candidate of [outPath, outPath.replace(/\.json$/, '.csv')]) {
    if (resolve(candidate) === rawResolved) {
      console.error(`refusing to write over the raw export: ${exportPath}`);
      process.exit(4);
    }
    if (existsSync(candidate)) {
      console.error(`refusing to overwrite an existing file: ${candidate}`);
      process.exit(4);
    }
  }
  writeFileSync(outPath, JSON.stringify(joined, null, 2));
  const cols = Object.keys(rows[0] ?? {});
  writeFileSync(outPath.replace(/\.json$/, '.csv'),
    [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n'));
}

console.log(`joined ${joined.counts.responses} responses`);
console.log(`  matched                   : ${joined.counts.matched}`);
console.log(`  unmatched (PRESERVED)     : ${joined.counts.unmatchedPreserved}`);
console.log(`  integrity mismatch        : ${joined.counts.integrityMismatch}`);
console.log(`  rating-only eligible      : ${joined.counts.ratingOnlyEligible}`);
console.log(`  model-agreement eligible  : ${joined.counts.modelAgreementEligible}`);
console.log(`  RETAINED despite no score : ${joined.counts.retainedDespiteNoScore}`);
console.log(`  withdrawn                 : ${withdrawn}${withdrawn ? '  -> all responses ineligible' : ''}`);
console.log(`  identity                  : ${joined.identity.accepted ? 'bound to ' + pkg.packageId : 'NOT BOUND'}`);
if (!identityOk) for (const p_ of identity.problems) console.log(`     - ${p_}`);
console.log(`  model-agreement use       : ${identityOk ? 'permitted' : 'BLOCKED by identity failure'}`);
console.log(`  approval                  : ${joined.approval}`);
if (outPath) console.log(`\nwrote ${outPath} and ${outPath.replace(/\.json$/, '.csv')}`);
