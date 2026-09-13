/**
 * Verifies docs/decisions/V1-SPECIFICATION.md.
 *
 *   node scripts/verify-specification.mjs        # verify
 *   node scripts/verify-specification.mjs --self # + negative controls
 *
 * WHAT THIS CAN AND CANNOT ESTABLISH
 *
 * It CAN:
 *   - parse the specification's own tables and check them against each other
 *     (provenance, counts, parameter coverage, edge-case coverage);
 *   - check the arithmetic the document quotes in prose and tables;
 *   - check that formula FORMS with the stated properties exist and behave as
 *     claimed, by evaluating a reference implementation of each form.
 *
 * It CANNOT:
 *   - verify that the prose describes the same formula the reference
 *     implementation encodes. Where a check evaluates a reimplementation rather
 *     than the document, its label says "reference form", not "the spec".
 *   - verify v1 itself. v1 is not implemented. Nothing here is evidence about a
 *     v1 implementation, only about the document and the forms it commits to.
 *
 * Earlier revisions asserted hardcoded copies of the document's claims, which
 * passed while the document said something else. Every structural check below
 * now reads the document.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SPEC = join(import.meta.dirname, '..', 'docs', 'decisions', 'V1-SPECIFICATION.md');
const SELFTEST = process.argv.includes('--self');

let pass = 0, fail = 0;
let quietMode = false;
const ok = (cond, label, detail = '') => {
  // Quiet mode suppresses PRINTING only. It must still count, or the negative
  // controls would report success for checks that never ran.
  if (cond) { pass++; if (!quietMode) console.log(`  PASS  ${label}`); }
  else { fail++; if (!quietMode) console.log(`  FAIL  ${label}${detail ? '  <- ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-12) => Math.abs(a - b) < eps;
const section = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 56 - t.length))}`);

// ---------------------------------------------------------------------------
// Document parsers - every structural check runs through these.
// ---------------------------------------------------------------------------

/** Per-dimension submetric rows: `m_x,n` ... | <provenance> */
function parseSubmetricProvenance(spec) {
  // Dimension tables have 3 or 4 columns and some cells contain escaped pipes,
  // so take the LAST non-empty cell of any row whose first cell is a submetric id.
  const out = new Map();
  for (const line of spec.split(/\r?\n/)) {
    if (!/^\|\s*`m_[a-z],\d`/.test(line)) continue;
    const id = line.match(/`(m_[a-z],\d)`/)[1];
    const cells = line
      .replace(/\\\|/g, '')      // drop escaped pipes so they do not split a cell
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    const last = (cells[cells.length - 1] || '')
      .replace(/\*\*/g, '')
      .replace(/\s*\(.*\)\s*$/, '')
      .trim();
    if (/^(from-manuscript|derived|novel)$/.test(last)) out.set(id, last);
  }
  return out;
}

/** The §11 provenance summary table. */
function parseProvenanceSummary(spec) {
  const out = new Map();
  const re = /^\|\s*(from-manuscript|derived|novel)\s*\|\s*\*\*(\d+)\*\*\s*\|\s*([^|]+)\|/gm;
  for (const m of spec.matchAll(re)) {
    const ids = [...m[3].matchAll(/`(m_[a-z],\d)`/g)].map((x) => x[1]);
    out.set(m[1], { count: Number(m[2]), ids });
  }
  return out;
}

/** Sign-off rows, keyed by id, deduplicated across §11 and §11.1. */
function parseSignoff(spec) {
  const rows = new Map();
  for (const m of spec.matchAll(/\|\s*\*\*S(\d+)\*\*\s*\|([^|]*)\|([^|]*)\|/g)) {
    const id = `S${m[1]}`;
    rows.set(id, (rows.get(id) ?? '') + ' ' + m[2] + ' ' + m[3]);
  }
  return rows;
}

/** Submetrics named in the §2.3 edge-case table. */
function parseEdgeTable(spec) {
  const start = spec.indexOf('### 2.3');
  const end = spec.indexOf('## 3.', start);
  const block = spec.slice(start, end);
  return new Set([...block.matchAll(/`(m_[a-z],\d)`/g)].map((m) => m[1]));
}

function runChecks(spec, { quiet = false } = {}) {
  const before = fail;
  const prevQuiet = quietMode;
  quietMode = quiet;
  const say = ok;

  // -- A. Reference forms (NOT the document; see header) ---------------------
  if (!quiet) section('A. Reference forms (a reimplementation, not the prose)');
  const targetFit = (r, t) => 1 - (r < t ? (t - r) / t : (r - t) / (1 - t));
  say([0, 0.25, 0.5, 0.75, 1].every((r) => near(targetFit(r, 0.5), 1 - 2 * Math.abs(r - 0.5))),
    'reference target form reduces to 1-2|r-0.5| at t=0.5');
  {
    let inRange = true;
    for (const t of [0.2, 0.3, 0.5, 0.7, 0.8])
      for (let r = 0; r <= 1.0000001; r += 0.01) {
        const v = targetFit(r, t);
        if (v < -1e-12 || v > 1 + 1e-12) inRange = false;
      }
    say(inRange, 'reference target form stays in [0,1] for every t in {0.2..0.8}');
  }
  say([0.3, 0.4, 0.5, 0.6].every((t) => near(targetFit(t, t), 1) && near(targetFit(0, t), 0) && near(targetFit(1, t), 0)),
    'reference target form: 1 at the target, 0 at both ends');

  // -- B. Arithmetic the document quotes ------------------------------------
  if (!quiet) section('B. Arithmetic quoted in the document');
  const dMax = Math.hypot(250, 250), dDiag = Math.hypot(500, 500);
  say(/707\.11/.test(spec) && near(dDiag, 707.1067811865476, 1e-9), 'd_diag 707.11 as quoted');
  say(/353\.55/.test(spec) && near(dMax, 353.5533905932738, 1e-9), 'd_max 353.55 as quoted');
  say(/9\.3333/.test(spec) && near(14 / 1.5, 9.333333333333334, 1e-12), 'v0 structure ceiling 14/1.5 as quoted');
  say(/273\.8613/.test(spec) && near(Math.sqrt(75000), 273.8612787525831, 1e-9), 'spatial witness side as quoted');
  say(/0\.1443333/.test(spec) && near(0.433 / 3, 0.1443333333333333, 1e-12), 'renderer-1 centroid offset as quoted');
  say(/0\.5773503/.test(spec) && near(1 / Math.sqrt(3), 0.5773502691896258, 1e-9), 'renderer-2 apex offset as quoted');

  // circle facet errors, parsed from the document's own table
  const facet = [...spec.matchAll(/^\|\s*(64|128|256)\s*\|\s*\*{0,2}([\d.]+)%\*{0,2}\s*\|\s*\*{0,2}([\d.]+)%/gm)]
    .map((m) => ({ n: Number(m[1]), radial: Number(m[2]), area: Number(m[3]) }));
  say(facet.length === 3, 'circle-facet error table has 3 rows', `got ${facet.length}`);
  say(facet.every((f) => {
    const r = (1 - Math.cos(Math.PI / f.n)) * 100;
    const a = (1 - (0.5 * f.n * Math.sin(2 * Math.PI / f.n)) / Math.PI) * 100;
    return Math.abs(r - f.radial) < 5e-4 && Math.abs(a - f.area) < 5e-4;
  }), 'every quoted facet error matches the computed value');
  say(!/64-gon[^.]{0,40}<\s*0\.03%/.test(spec) && !/max radial error\s*`?<\s*0\.03%/.test(spec),
    'the wrong 0.03% figure for a 64-gon is gone');

  // -- C. Internal consistency, read from the document ----------------------
  if (!quiet) section('C. Internal consistency (parsed from the document)');
  const perRow = parseSubmetricProvenance(spec);
  const summary = parseProvenanceSummary(spec);

  say(perRow.size === 19, 'dimension tables define 19 submetrics', `got ${perRow.size}`);

  const summaryIds = [...summary.values()].flatMap((v) => v.ids);
  say(summaryIds.length === 19, 'provenance summary lists 19 submetrics', `got ${summaryIds.length}`);
  say(new Set(summaryIds).size === summaryIds.length, 'no submetric appears in two provenance classes');
  say([...summary.values()].every((v) => v.count === v.ids.length),
    'each provenance row count matches the ids it lists');

  const mismatches = [...perRow.entries()]
    .filter(([id, cls]) => {
      const inSummary = [...summary.entries()].find(([, v]) => v.ids.includes(id));
      return !inSummary || inSummary[0] !== cls;
    })
    .map(([id, cls]) => `${id} row=${cls}`);
  say(mismatches.length === 0,
    'per-dimension provenance agrees with the summary table',
    mismatches.join('; '));

  const stated = spec.match(/The actual count is \*\*(\d+)\*\*/);
  say(stated && Number(stated[1]) === perRow.size,
    'the stated total matches the parsed total', stated ? `stated ${stated[1]}` : 'not stated');

  const edge = parseEdgeTable(spec);
  const uncovered = [...perRow.keys()].filter((id) => !edge.has(id));
  say(uncovered.length <= 6, 'edge-case table covers the submetrics with edge cases',
    `uncovered: ${uncovered.join(', ')}`);

  const signoff = parseSignoff(spec);
  say(signoff.size === 21, 'sign-off defines 21 distinct items', `got ${signoff.size}`);
  say([...Array(21).keys()].every((i) => signoff.has(`S${i + 1}`)), 'sign-off ids run S1..S21 with no gaps');

  const signoffText = [...signoff.values()].join(' ');
  const PARAMS = [['κ', /κ/], ['ρ*', /ρ\*/], ['d*', /d\*/], ['τ_g', /τ_g/], ['τ_m', /τ_m/],
    ['τ_a', /τ_a/], ['ΔE_ref', /ΔE_ref/], ['W_d', /W_d/], ['minPts', /minPts/],
    ['minElements', /minElements/], ['readingOrder', /readingOrder/], ['circleFacets', /circleFacets/]];
  const missingP = PARAMS.filter(([, re]) => !re.test(signoffText)).map(([n]) => n);
  say(missingP.length === 0, 'every frozen parameter appears in the sign-off table', missingP.join(', '));

  const secs = [...spec.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
  say(secs.every((n, i) => n === i), 'top-level sections numbered 0..N without gaps', secs.join(','));
  say(/### AUTHORITATIVE/.test(spec), 'the document declares itself authoritative');

  const ledger = [...spec.matchAll(/\|\s*\*\*C(\d+)\*\*\s*\|/g)].map((m) => Number(m[1]));
  say(ledger.length >= 12 && ledger.every((n, i) => n === i + 1), 'ledger runs C1..Cn with no gaps');

  // -- D. Requested corrections are present in the document -----------------
  if (!quiet) section('D. Requested corrections present in the document');
  say(!/reaching exactly `10`\s*\n\s*and another reaching exactly `0`/.test(spec),
    'universal exact-0/exact-10 requirement removed');
  say(/unwitnessed/i.test(spec), 'unwitnessed bounds are recorded as such');
  say(/fixture-specific/i.test(spec), 'rotation and lightness tests marked fixture-specific');
  say(/\|\s*\*\*zero\*\*\s*clusters[^|]*\|\s*`0`/.test(spec) || /zero clusters \(all noise\) \| `0` \| `0` \| \*\*`0`\*\*/.test(spec),
    'zero clusters resolve to 0 for m_g,3');
  say(/\|\s*exactly 1\s*\|[^\n]*\*\*`1`\*\*\s*\|/.test(spec),
    'exactly one cluster resolves to 1 for m_g,3');
  say(/mean\(m\) = 0/.test(spec), 'zero-margin CV specified');
  say(/zero-length segment/i.test(spec), 'zero-length path segments specified');
  say(/first step has turn cost/i.test(spec), 'first-step turn cost specified');
  say(/relative\s*\n?\s*tolerance|relative tolerance/i.test(spec), 'modular tolerance units specified as relative');
  say(/component-wise arithmetic mean of `L\*`/.test(spec), 'colour averaging operation specified');
  say(/occupied footprint/i.test(spec) && /unionFootprintArea/.test(spec),
    'occupied footprint chosen and named honestly');
  {
    // Allowed only where the document is explaining that the name was wrong.
    let liveUse = false;
    for (const m of spec.matchAll(/unionInkArea/g)) {
      const ctx = spec.slice(Math.max(0, m.index - 200), m.index + 200);
      if (!/misnamed|Draft-2|draft-2|was wrong|renamed|corrected/i.test(ctx)) liveUse = true;
    }
    // Also require the replacement term to actually be in use, so a global
    // rename back to the old name cannot hide behind the correction sentence.
    const liveTermUses = (spec.match(/unionFootprintArea/g) || []).length;
    say(!liveUse && liveTermUses >= 2,
      'unionFootprintArea is the live term; unionInkArea survives only in the correction sentence',
      `footprint uses=${liveTermUses}, stray ink uses=${liveUse}`);
  }
  say(/model-comparison diagnostic/i.test(spec), 'labelled cross-version diagnostics permitted');
  say(/remains valid under the frozen protocol/i.test(spec), 'existing data keeps its original protocol');
  say(/never invalidates a human rating/i.test(spec), 'unsupported scoring does not invalidate a rating');
  say(/No group is automatically approved/.test(spec), 'Group B/C automatic approval removed');

  quietMode = prevQuiet;
  return fail - before;
}

// ---------------------------------------------------------------------------
const spec = readFileSync(SPEC, 'utf8');
runChecks(spec);

// ---------------------------------------------------------------------------
// Negative controls: inject each known contradiction and confirm it FAILS.
// Without these, a green run only shows the checks did not crash.
// ---------------------------------------------------------------------------
if (SELFTEST) {
  section('E. Negative controls (each must FAIL when injected)');
  const controls = [
    ['provenance row/summary disagreement',
      (t) => t.replace('| derived | **7** | `m_g,1`, `m_s,2`, `m_f,3`,',
        '| derived | **6** | `m_g,1`, `m_s,2`,').replace('| from-manuscript | **3** | `m_f,1`,',
        '| from-manuscript | **4** | `m_f,1`, `m_f,3`,')],
    ['wrong 64-gon error figure', (t) => t.replace('| 64 | **0.1205%** | **0.1606%** |', '| 64 | **0.0300%** | **0.0300%** |')],
    ['missing parameter in sign-off', (t) => t.replace(/τ_m/g, 'tee_em')],
    ['authority declaration removed', (t) => t.replace('### AUTHORITATIVE', '### Overview')],
    // NOTE: must be a global regex. String.replace with a string argument
    // replaces only the first occurrence, which made this control too weak to
    // trip the check it was meant to exercise.
    ['unionInkArea reinstated', (t) => t.replace(/unionFootprintArea/g, 'unionInkArea')],
    ['Group B/C auto-approval reinstated', (t) => t.replace('No group is automatically approved', 'Groups B and C stand as specified')],
    ['stated total contradicts parsed total', (t) => t.replace('The actual count is **19**', 'The actual count is **20**')],
  ];
  let caught = 0;
  for (const [label, mutate] of controls) {
    const before = fail;
    runChecks(mutate(spec), { quiet: true });
    const detected = fail > before;
    if (detected) caught++;
    console.log(`  ${detected ? 'CAUGHT ' : 'MISSED '} ${label}`);
    fail = before; // negative controls must not count as real failures
  }
  ok(caught === controls.length, `all ${controls.length} negative controls detected`, `caught ${caught}`);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
