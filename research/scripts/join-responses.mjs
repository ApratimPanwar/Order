/**
 * Offline score join — the researcher-side step.
 *
 *   node scripts/join-responses.mjs <export.json> [--out joined.json]
 *
 * The participant bundle carries no scores, so a downloaded response file has
 * `scoreAvailable: null` and `analysisEligible.modelAgreement: null`. This joins
 * it against study-private/stimulus-key.json on stimulusId and fills them in.
 *
 * THE RULE THIS ENFORCES
 * A rating stays valid when the model cannot score the layout. Joining sets
 * `modelAgreement: false` for such a trial and leaves `ratingOnly: true`. The
 * rating is never discarded, and `trialValid` is untouched.
 *
 * Scores come from the v1 DEVELOPMENT CANDIDATE. None of S1-S21 is approved, so
 * the joined file is stamped accordingly and is not an approved measurement.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const exportPath = process.argv[2];
if (!exportPath) {
  console.error('usage: node scripts/join-responses.mjs <export.json> [--out joined.json]');
  process.exit(2);
}
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx === -1 ? null : process.argv[outIdx + 1];

const KEY = join(import.meta.dirname, '..', 'study-private', 'stimulus-key.json');
if (!existsSync(KEY)) {
  console.error(`stimulus key not found at ${KEY}. Run: node scripts/build-stimuli.mjs`);
  process.exit(2);
}

const rec = JSON.parse(readFileSync(exportPath, 'utf8'));
const key = JSON.parse(readFileSync(KEY, 'utf8'));
const byId = new Map(key.items.map((i) => [i.stimulusId, i]));

if (rec.transmitted !== false) {
  console.warn('WARNING: this export does not carry transmitted:false. Check its provenance.');
}

const rows = [];
let unmatched = 0;
for (const r of rec.responses) {
  const k = byId.get(r.stimulusId);
  if (!k) { unmatched++; continue; }
  r.scoreAvailable = k.scoreAvailable;
  // modelAgreement requires BOTH a model score and a valid trial.
  r.analysisEligible.modelAgreement = Boolean(k.scoreAvailable && r.trialValid);
  // ratingOnly is untouched by scoring: a rating is evidence in its own right.
  rows.push({
    participantId: rec.participantId,
    stimulusId: r.stimulusId,
    presentationIndex: r.presentationIndex,
    perceivedOrder: r.perceivedOrder,
    appeal: r.appeal,
    confidence: r.confidence ?? '',
    trialValid: r.trialValid,
    scoreAvailable: r.scoreAvailable,
    modelAgreementEligible: r.analysisEligible.modelAgreement,
    ratingOnlyEligible: r.analysisEligible.ratingOnly,
    invalidReason: r.invalidReason ?? '',
    condition: k.condition,
    v1Total: k.v1 ? k.v1.total : '',        // empty, NOT 0, when unscorable
    modelVersion: k.modelVersion,
  });
}

const joined = {
  joinFormat: 'rating-join-1',
  joinedAt: new Date().toISOString(),
  approval: 'DEVELOPMENT CANDIDATE - NOT APPROVED. v1 scores here are not approved measurements.',
  provenance: {
    exportFile: exportPath,
    keyVersion: key.keyVersion,
    modelVersion: key.items[0]?.modelVersion ?? null,
    participantId: rec.participantId,
    instrumentVersion: rec.instrumentVersion,
    transmitted: rec.transmitted,
  },
  counts: {
    responses: rec.responses.length,
    unmatched,
    ratingOnlyEligible: rows.filter((r) => r.ratingOnlyEligible).length,
    modelAgreementEligible: rows.filter((r) => r.modelAgreementEligible).length,
    retainedDespiteNoScore: rows.filter((r) => !r.scoreAvailable && r.ratingOnlyEligible).length,
  },
  rows,
};

if (outPath) {
  writeFileSync(outPath, JSON.stringify(joined, null, 2));
  const cols = Object.keys(rows[0] ?? {});
  writeFileSync(outPath.replace(/\.json$/, '.csv'),
    [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n'));
}

console.log(`joined ${joined.counts.responses} responses (${unmatched} unmatched)`);
console.log(`  rating-only eligible      : ${joined.counts.ratingOnlyEligible}`);
console.log(`  model-agreement eligible  : ${joined.counts.modelAgreementEligible}`);
console.log(`  RETAINED despite no score : ${joined.counts.retainedDespiteNoScore}`);
console.log(`  approval                  : ${joined.approval}`);
if (outPath) console.log(`\nwrote ${outPath} and ${outPath.replace(/\.json$/, '.csv')}`);
