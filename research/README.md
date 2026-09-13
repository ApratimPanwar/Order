# `research/` — Order Composer research instrument

Scaffolding for a reproducible study instrument. **Separate from the public
application.** `../index.html` is byte-identical to commit `bf617e4` and is not
wired to anything here.

**Status: engineering foundation completed.** Not pilot-ready — there is no
participant workflow, no consent flow, no conditions, and no collection
endpoint. See "What this is not" below.

## Run it

Requires Node 20+ (developed on 24.15). No dependencies.

```bash
cd research
node --test "test/*.test.mjs"              # full suite
node scripts/demo-actions-and-replay.mjs   # Explain/Preview/Apply + replay demos
node scripts/baseline-distribution.mjs     # score distribution + matched baseline
node scripts/color-defect-impact.mjs       # quantifies AUDIT finding 4
node scripts/worked-examples.mjs           # numbers cited in docs/decisions/
node scripts/angular-stats-demo.mjs        # period-aware vs linear angular stats
node scripts/reversal-diagnostics.mjs      # the 174/2000 reversal cases
```

Real browser reload recovery (see `results/browser-reload-check.json`):

```bash
python -m http.server 8752 --directory Order/research
```

then open `http://localhost:8752/harness/index.html`, act, and reload.

## Layout

```
legacy/
  index.bf617e4.html      verbatim archive of the reference source
  reference-harness.mjs   evaluates the original <script> in a VM
  PROVENANCE.md           why v0 is NOT "the scorer that produced the results"
harness/
  index.html              dev harness for REAL browser reload testing
core/
  freeze.js               deep freeze; Object.freeze is shallow
  layout.js               canonical state, serialize/deserialize, hashing
  rng.js                  seeded PRNG (mulberry32, rng-1)
  generate.js             reproducible generation + matched random baseline
  actions.js              Explain / Preview / Apply / Cancel / Undo / Redo
                          + stale-preview handling, resumable sessions
  events.js               append-only log, DISABLED by default
  storage.js              persistence interface; export-only pilot mode
  presets/registry.js     12 presets, stable IDs, versioned
  scoring/
    v0-as-shipped.js      frozen, bug-for-bug
    validate.js           reports invalid output; never repairs it
test/
  equivalence.test.mjs        extracted v0 vs ORIGINAL JavaScript
  characterization.v0.test.mjs what v0 does, defects included
  serialization.test.mjs      round-trip, determinism, replay
  actions.test.mjs            action separation, history, storage
  preset-equivalence.test.mjs direct element-wise preset state comparison
  hardening.test.mjs          stale previews, params, immutability, resume
  v1-requirements.test.mjs    NOT satisfied by v0 — todo/skipped
  fixtures/layouts.mjs        synthetic test data, clearly marked
docs/
  AUDIT.md                Phase 1 audit (corrections marked in place)
  CHANGES.md              change ledger by category
  DECISIONS-v1.md         full inventory of what is underspecified
  decisions/              per-decision packets — sign-off happens here
```

## The two rules that matter most

**1. Do not edit `scoring/v0-as-shipped.js`.** It is frozen bug-for-bug and
pinned by equivalence tests against the archived original. Corrected behaviour
goes in a new model version. Fixing the colour parse counts as a scoring change,
not a defect fix.

**2. Do not normalise colour strings anywhere in the state path.** Converting
`hsl()` to hex before scoring would repair `v0`'s colour defect and silently
break equivalence. The canonical layout stores the original string verbatim.

## Test categories

| Suite | Meaning of a failure |
|---|---|
| `equivalence` | The extraction drifted from the original. Serious. |
| `characterization` | `v0` behaviour changed. A regression, **not** a bug found. |
| `serialization`, `actions` | Ordinary defects. |
| `v1-requirements` | Expected to fail — these are targets, reported as `todo`. Items whose correct value is an unapproved scientific choice are `skip`ped, not asserted. |

Current: **79 pass, 0 fail, 3 skipped, 6 todo** (88 total).

| Suite | Pass |
|---|---|
| `equivalence` (scorer vs original JS) | 7 |
| `preset-equivalence` (preset STATE vs original JS) | 5 |
| `characterization.v0` | 18 |
| `serialization` | 15 |
| `actions` | 18 |
| `hardening` (stale previews, params, immutability, resume) | 16 |
| `v1-requirements` | 0 pass / 3 skip / 6 todo — by design |

## What this is not

- Not a participant workflow. No consent, no pseudonymous IDs, no conditions,
  no task briefs, no blind rating module.
- Not collecting anything. `events.js` is disabled by default; `PilotExport`
  returns `transmitted: false` on every receipt.
- Not validated. Every measure is a **geometric proxy** computed from layout
  coordinates and colour values. Nothing here measures gaze, attention, or
  perception, and nothing here establishes that `v0` or `v1` tracks human
  judgments of order.
