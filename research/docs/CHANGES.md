# Change ledger — what changed, and in which category

Changes are separated by category because they carry different risks. A scorer
change alters measured values; a preset or RNG change alters the *inputs* to
measurement. Conflating them would make a later difference impossible to
attribute.

## Category 1 — Scorer changes

**None.** `v0` is bit-identical to the original JavaScript.

Verified by `test/equivalence.test.mjs`, which evaluates the archived
`<script>` in a VM and compares the original functions against the extracted
module at exact equality (NaN treated as agreeing with NaN):

| Case | Coverage |
|---|---|
| Seeded random layouts | 500 |
| Every preset output | 12 presets × 15 seeds = 180 |
| `hsl()` colours (colorHarmony output) | 25 |
| Rotations near wraparound | 16 values incl. −360, 0, 359, 360, 720 |
| Visibility-flipped layouts | 40 |
| Named edge-case fixtures | 17 |

All pass. Any future scorer change must be made in a **new model version**, not
by editing `v0-as-shipped.js`.

## Category 2 — Randomness (NOT behaviour-neutral)

| Before | After |
|---|---|
| Unseeded `Math.random()` | Seeded `mulberry32`, `rng-1` |

**Consequence:** generated layouts are a *different draw*, not a reproduction of
any historical composition. No layout produced by `core/generate.js` corresponds
to a layout that existed before this milestone.

The parameter ranges are transcribed from the source, not the README. The README
states "inner 400×400 area (50px margin)"; the source uses `100 + rand*300`
(a 100px margin over a 300px span). The source is authoritative.

Every generated layout records `seed`, `seedInput`, `rngAlgorithm`, `rngVersion`,
`generator.version` and the full parameter object in `meta`. **The full state is
saved regardless** — a seed alone is provenance metadata, not a substitute for
the artifact, because generator and preset versions change.

## Category 3 — Preset execution (NOT behaviour-neutral)

The twelve preset implementations are transcribed from `bf617e4` L1790–2037.
The **arithmetic is unchanged**; the **calling convention is not**.

| Before | After |
|---|---|
| Mutates live `Element` instances in place | Pure `(layout, params) => new layout` |
| Operates on the global `allElements` | Operates on a clone of the passed layout |
| Identified by a `switch` string key | Identified by a stable registry ID, versioned |

**Equivalence is now verified DIRECTLY, on state.**

*Superseded claim (2026-09-13).* Milestone 1 said preset equivalence was
"verified indirectly and strongly" because preset outputs were scored on both
sides and the scores matched. That overstated it. A score is a lossy projection:
`v0` reads only x, y, size, size2, rotation, colour and filled, then collapses
them through means, counts and clipped terms. Several real transcription errors
would survive a score comparison untouched —

- swapping two elements of identical size and colour (means unchanged),
- a sign error mirroring the composition about the canvas centre,
- **any** change to an invisible element (never scored at all),
- a `size2` error on a non-rectangle (`size2` enters area only for rectangles).

`test/preset-equivalence.test.mjs` now compares **per-element geometry** between
the original functions and the port:

| Case | Coverage |
|---|---|
| Every preset over seeded layouts | 200 seeds × 12 presets = **2,400 element-wise comparisons** |
| Invisible elements untouched, identically on both sides | >500 hidden-element checks |
| Degenerate fixtures | 17 fixtures × 12 presets |
| Chained presets (output of one feeding the next) | 6 chains × 3 steps × 12 seeds |
| Negative control — a deliberately corrupted port IS detected | 4 corruption modes, each one a score comparison could miss |

All pass. The negative control is what makes the claim meaningful: it
demonstrates the comparison can fail.

`colorHarmony` deliberately still emits `hsl()` strings. Repairing it is a
**scoring change** (it moves every score recorded after the preset runs) and
belongs to `v1` under decision G5.

Versions: `presets-1` (registry), `preset-impl-1` (implementations).

## Category 3b — Hardening of the interaction model (2026-09-13)

Four defects in milestone 1's own new code, none of them in `v0`.

| Defect | Fix |
|---|---|
| **Stale previews were committable.** `apply()` checked only that the pending preview was for the same preset, not that the committed layout had not moved on. A preview computed before a manual edit could be committed after it, so what landed differed from what the participant saw. | `apply()` now requires `preview.beforeStateId === current stateId` **and** matching resolved params. Any commit or history move drops a stale preview, logged with `reason: "stale"`. |
| **Parameters were logged only on apply.** `preview` and `preview.cancelled` recorded a preset id but not the parameters used, so a preview could not be reproduced from the log. | All three events record resolved `params`, `paramsExplicit`, and the preset implementation/registry versions. |
| **Returned state was externally mutable.** `layout`, `history` and `pendingPreview` handed out live internal objects; a caller could rewrite committed history. | Committed layouts, previews and history are **deep-frozen** (`core/freeze.js`). |
| **Event records were shallow-frozen.** `Object.freeze` left nested `params`, `changedProperties` and `from`/`to` writable, and a caller mutating the object it passed in could reach into the stored record. | Records are deep-frozen and the payload is `structuredClone`d on write. |

Also added: `EditorSession.fromJSON` / `EventLog.fromJSON` for resumable
sessions (`session-1`), with event sequence numbering **continued** rather than
restarted, so post-reload events cannot collide with pre-reload ones. A pending
preview is deliberately not restored.

## Category 4 — Interaction model (new behaviour, no v0 equivalent)

The shipped build had one action. There are now five.

| Before (`bf617e4` L1576) | After |
|---|---|
| `toggleModeDetails()` toggled the panel **and** called `applyOrderMode()` unconditionally — including on the collapse branch, so a double-click applied twice | `explain` / `preview` / `apply` / `cancel` / `undo` / `redo`, separately logged |

This has no equivalent in `v0`, so there is nothing to preserve. It is the
prerequisite for RQ3 being answerable at all: under the old model an event log
could not distinguish reading documentation from making a design decision.

Guarantees, each covered by `test/actions.test.mjs` and demonstrated by
`scripts/demo-actions-and-replay.mjs`:

- `explain()` leaves the layout byte-identical and creates no history entry
- `preview()` computes without committing
- `apply()` commits the **exact** previewed layout (never a recomputation)
- `cancelPreview()` leaves the committed layout untouched
- a superseded preview is logged as cancelled, never silently dropped

## Category 5 — Serialization, storage, logging (new, additive)

- `layout-1` canonical schema. Colour strings stored **verbatim**; normalising
  them would repair the `v0` colour defect and break equivalence.
- Logical canvas coordinates, viewport-independent.
- Explicit `order` field for drawing order — not array position.
- `storage-1` interface; `MemoryStorage`, `LocalStorageAdapter`, `PilotExport`.
  **No collection endpoint exists or is approved.** `PilotExport` returns
  `transmitted: false` on every receipt.
- `events-1` append-only log, **disabled by default**, development only.
  Event types name observed operations only: `preset.applied` never implies
  acceptance.

## Category 6 — Public application

**Untouched.** `index.html` is byte-identical to `bf617e4`. The research
scaffolding lives entirely under `research/` and is not wired into the published
page. Nothing has been pushed or deployed.

## Withdrawn claims from the first audit

| Claim | Status |
|---|---|
| "`v0` is the scorer that produced the published results" | **Withdrawn.** See `legacy/PROVENANCE.md`. |
| "No persistence ⇒ layouts were never archived" | **Withdrawn.** 31 images in `SSS.docx`, incl. 4 compositions and one screenshot preserving a 54% score with partial element values. |
| "structure's 9.33 ceiling violates the `[0,10]` bounds requirement" | **Withdrawn.** 9.33 is *inside* `[0,10]`. It is a reachability limit. |
| "Remove the `/1.5` divisor" | **Withdrawn.** Removing it would permit a maximum of 14. The intended normalisation is undecided — decision C5. |
| "Hierarchy's unequal submetric weights contradict §3's equal-weights default" | **Withdrawn.** §3 says equal weights *unless stated otherwise*, and hierarchy states otherwise (0.5/0.3/0.2). No contradiction. |
| The 20,000-layout Python simulation | **Superseded** by `scripts/baseline-distribution.mjs` — extracted scorer, explicit seeds, exported CSV/JSON. Comparison against manuscript Study means withdrawn as invalid. |
