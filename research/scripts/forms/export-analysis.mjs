/**
 * Joins Google Forms rating responses to frozen study-scorer results by stimulus ID.
 *
 *   node scripts/forms/export-analysis.mjs --private-dir <corpus dir> --build <build dir>
 *        --responses <tab.csv> [--responses <tab.csv> ...]
 *        [--issued-codes <build>/issued-codes.csv] [--withdrawn-codes <file>]
 *        [--build-record <forms-build-record.json>] --out <dir outside git>
 *
 * Each --responses file is one response tab of the private spreadsheet, downloaded
 * as CSV unmodified. The form variant is identified by its exact header row, which
 * must match one variant of the build plan title for title; anything else is
 * refused rather than guessed.
 *
 * Frozen identities are checked before any join:
 *   - the build plan's digest recomputes, and mapping.json belongs to it;
 *   - the stimulus key's SHA-256 equals the one frozen in the plan and mapping;
 *   - (optional) the Google build record carries the same plan digest and titles.
 *
 * OUTPUT (never inside a git work tree, never overwriting):
 *   ratings-long.csv   one row per response x composition, with frozen scores
 *   summary.json       counts, exclusion tallies, identities
 *
 * Exclusion rules (a row may carry several):
 *   E1-declined          consent answer is not the agree choice (no ratings)
 *   E2-invalid-code      study code does not match the issued-code pattern
 *   E3-unissued-code     code not in the issued list (when supplied)
 *   E4-duplicate-code    a later row in the same tab reusing a code, or any use of a code across tabs
 *   E5-withdrawn         code is in the withdrawal list (when supplied)
 *   E6-invalid-rating    a rating is not an integer 1..7
 *   E7-wrong-form        code was issued for a different form variant
 *   X3-development-rehearsal  the build is a rehearsal: excluded from the study dataset
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const one = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
const many = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const fail = (msg, code = 2) => { console.error(`REFUSING: ${msg}`); process.exit(code); };

for (const req of ['private-dir', 'build', 'out']) if (!one(req)) fail(`--${req} is required`);
const PRIVATE_DIR = resolve(one('private-dir'));
const BUILD = resolve(one('build'));
const OUT = resolve(one('out'));
const RESPONSES = many('responses').map((p) => resolve(p));
if (!RESPONSES.length) fail('at least one --responses CSV is required');

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));

for (let d = OUT; ; d = dirname(d)) {
  if (existsSync(join(d, '.git'))) fail(`--out ${OUT} is inside the git work tree ${d}; participant data must never be committed`);
  if (dirname(d) === d) break;
}
for (const f of ['ratings-long.csv', 'summary.json']) if (existsSync(join(OUT, f))) fail(`${join(OUT, f)} exists; an export is never overwritten`, 4);

// --- frozen identities --------------------------------------------------------------------------
const plan = JSON.parse(readFileSync(join(BUILD, 'build-plan.json'), 'utf8'));
const mapping = JSON.parse(readFileSync(join(BUILD, 'mapping.json'), 'utf8'));
const keyBytes = readFileSync(join(PRIVATE_DIR, 'stimulus-key.json'));
const key = JSON.parse(keyBytes);
{
  const { planDigest, ...rest } = plan;
  if (sha256(canonical(rest)) !== planDigest) fail('build-plan.json has been altered: its digest does not recompute', 3);
}
if (mapping.planDigest !== plan.planDigest) fail('mapping.json belongs to a different build plan', 3);
if (sha256(keyBytes) !== plan.corpus.keySha256 || mapping.keySha256 !== plan.corpus.keySha256) {
  fail('the stimulus key on disk is not the frozen key this survey was built from', 3);
}
const buildRecordPath = one('build-record');
if (buildRecordPath) {
  const rec = JSON.parse(readFileSync(resolve(buildRecordPath), 'utf8'));
  if (rec.planDigest !== plan.planDigest) fail('the Google build record is for a different plan', 3);
  for (const f of rec.forms) {
    const v = plan.variants.find((x) => x.variant === f.variant);
    if (!v) fail(`build record has unknown form ${f.variant}`, 3);
    f.sections.forEach((s, i) => {
      if (s.orderTitle !== v.sections[i].orderTitle || s.appealTitle !== v.sections[i].appealTitle) fail(`build record titles differ from the plan in form ${f.variant}`, 3);
    });
  }
}
const keyById = new Map(key.items.map((it) => [it.stimulusId, it]));
for (const v of mapping.variants) for (const s of v.sections) if (!keyById.has(s.stimulusId)) fail(`mapping names ${s.stimulusId}, which is not in the frozen key`, 3);

const issued = new Map();
if (one('issued-codes')) {
  readFileSync(resolve(one('issued-codes')), 'utf8').trim().split(/\r?\n/).slice(1).forEach((line) => {
    const [code, variant] = line.split(',');
    if (code) issued.set(code.trim(), (variant || '').trim());
  });
}
const withdrawn = new Set(one('withdrawn-codes')
  ? readFileSync(resolve(one('withdrawn-codes')), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : []);

// --- CSV ------------------------------------------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}
const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const codeRe = new RegExp(plan.codePattern);
const DIMS = ['hierarchy', 'grouping', 'structure', 'flow', 'spatial', 'variety'];
const responses = [];
const fileReports = [];

for (const file of RESPONSES) {
  const bytes = readFileSync(file);
  const rows = parseCsv(bytes.toString('utf8'));
  if (!rows.length) fail(`${file} is empty`);
  const header = rows[0];
  const expectedFor = (v) => ['Timestamp', plan.texts.consentQuestion, plan.texts.codeQuestion, ...v.sections.flatMap((s) => [s.orderTitle, s.appealTitle])];
  const matches = plan.variants.filter((v) => JSON.stringify(expectedFor(v)) === JSON.stringify(header));
  if (matches.length !== 1) {
    const near = plan.variants.map((v) => ({ variant: v.variant, missing: expectedFor(v).filter((h) => !header.includes(h)).length, extra: header.filter((h) => !expectedFor(v).includes(h)).length }));
    fail(`${file}: header row matches no form variant exactly (${JSON.stringify(near)}). Download the tab as CSV without editing it.`, 3);
  }
  const variant = matches[0].variant;
  const mapVariant = mapping.variants.find((v) => v.variant === variant);
  fileReports.push({ file: file.split(/[\\/]/).pop(), sha256: sha256(bytes), variant, responses: rows.length - 1 });
  rows.slice(1).forEach((r, idx) => {
    responses.push({ variant, rowIndex: idx + 1, fileSha: sha256(bytes).slice(0, 12), timestamp: r[0], consent: r[1], code: (r[2] || '').trim(), ratings: r.slice(3), mapVariant });
  });
}

// Duplicate codes. Sheets appends responses in arrival order, so row order within
// one tab is chronological. Timestamps in exported CSVs are locale-formatted
// (d/m vs m/d) and are NOT used for ordering. A code reused within one tab keeps
// its first row; a code appearing in more than one tab cannot be ordered
// reliably, so every occurrence is flagged.
const occurrences = new Map();
responses.forEach((r) => {
  if (r.consent !== plan.texts.agreeChoice) return;
  if (!occurrences.has(r.code)) occurrences.set(r.code, []);
  occurrences.get(r.code).push(r);
});
const duplicate = new Set();
for (const list of occurrences.values()) {
  if (list.length < 2) continue;
  if (new Set(list.map((x) => x.fileSha)).size > 1) list.forEach((x) => duplicate.add(x));
  else list.slice(1).forEach((x) => duplicate.add(x));
}
const ordered = responses.map((r) => ({ r }));

const out = [];
const tallies = {};
const tally = (k) => { tallies[k] = (tallies[k] || 0) + 1; };
for (const { r } of ordered) {
  const rules = [];
  if (r.consent !== plan.texts.agreeChoice) rules.push('E1-declined');
  if (!rules.includes('E1-declined')) {
    if (!codeRe.test(r.code)) rules.push('E2-invalid-code');
    if (issued.size && !issued.has(r.code)) rules.push('E3-unissued-code');
    if (issued.size && issued.has(r.code) && issued.get(r.code) !== r.variant) rules.push('E7-wrong-form');
    if (duplicate.has(r)) rules.push('E4-duplicate-code');
    if (withdrawn.has(r.code)) rules.push('E5-withdrawn');
  }
  if (plan.dataClass !== 'study-data') rules.push('X3-development-rehearsal');
  rules.forEach(tally);

  r.mapVariant.sections.forEach((s, k) => {
    const k1 = keyById.get(s.stimulusId);
    const orderRaw = r.ratings[2 * k] ?? '';
    const appealRaw = r.ratings[2 * k + 1] ?? '';
    const valid = (x) => /^[1-7]$/.test(String(x).trim());
    const rowRules = [...rules];
    if (!rules.includes('E1-declined') && (!valid(orderRaw) || !valid(appealRaw))) { rowRules.push('E6-invalid-rating'); tally('E6-invalid-rating'); }
    const ratingEligible = rowRules.length === 0;
    out.push({
      dataClass: plan.dataClass,
      planDigest: plan.planDigest,
      formVariant: r.variant,
      responseId: `${r.variant}-${r.fileSha}-${r.rowIndex}`,
      timestamp: r.timestamp,
      studyCode: r.code,
      consented: r.consent === plan.texts.agreeChoice,
      position: s.position,
      stimulusId: s.stimulusId,
      pairId: k1.pairId ?? '',
      role: k1.role ?? k1.condition ?? '',
      stratum: k1.stratum ?? '',
      perceivedOrder: valid(orderRaw) ? Number(orderRaw) : '',
      appeal: valid(appealRaw) ? Number(appealRaw) : '',
      scoreAvailable: k1.scoreAvailable,
      v1Total: k1.v1 ? k1.v1.total : '',
      ...Object.fromEntries(DIMS.map((d) => [`v1_${d}`, k1.v1 ? k1.v1.dimensions[d] : ''])),
      modelVersion: k1.modelVersion,
      configVersion: k1.configVersion,
      ratingEligible,
      modelAgreementEligible: ratingEligible && k1.scoreAvailable === true,
      exclusionRules: rowRules.join('|'),
    });
  });
}

mkdirSync(OUT, { recursive: true });
const cols = Object.keys(out[0] ?? { dataClass: '' });
writeFileSync(join(OUT, 'ratings-long.csv'), `${[cols.join(','), ...out.map((row) => cols.map((c) => csvCell(row[c])).join(','))].join('\n')}\n`);
const summary = {
  exportFormat: 'forms-analysis-export-1',
  exportedAt: new Date().toISOString(),
  planDigest: plan.planDigest,
  mode: plan.mode,
  dataClass: plan.dataClass,
  keySha256: plan.corpus.keySha256,
  modelVersion: plan.corpus.modelVersion,
  files: fileReports,
  responses: responses.length,
  ratingRows: out.length,
  ratingEligibleRows: out.filter((r) => r.ratingEligible).length,
  modelAgreementEligibleRows: out.filter((r) => r.modelAgreementEligible).length,
  exclusionTallies: tallies,
  duplicateRule: 'first row within a tab kept; codes spanning tabs flagged in every occurrence',
  issuedCodesChecked: issued.size > 0,
  withdrawalListChecked: one('withdrawn-codes') !== null,
  note: plan.dataClass === 'study-data' ? 'study data' : 'REHEARSAL: every row is excluded from the study dataset',
};
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`exported ${out.length} rating rows from ${responses.length} responses (${fileReports.length} form tab(s))`);
console.log(`  rating-eligible ${summary.ratingEligibleRows}, model-agreement-eligible ${summary.modelAgreementEligibleRows}`);
console.log(`  exclusions ${JSON.stringify(tallies)}`);
if (!summary.withdrawalListChecked) console.log('  NOTE: no --withdrawn-codes list supplied; withdrawals were not checked');
