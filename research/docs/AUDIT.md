# Phase 1 Audit — Order Composer as a research instrument

| | |
|---|---|
| Audited commit | `bf617e4` (`main`, 2025-10-23), re-fetched and confirmed current HEAD |
| Source of truth | `index.html` — 2213 lines, single file |
| Repository contents | `README.md`, `index.html`. No tests, no build, no `package.json`, no CI |
| Manuscript compared | `ICoRD_2027_Full_paper_1919-1.pdf` (10 pp., 0 figures) |
| Prior drafts consulted | `Previous study/Order_Complete_Chapter.docx`, `Previous study/SSS.docx` |
| Audit date | 2026-09-13 |
| Gate 1 decision | **Option C** — separately versioned revised model |

Confidence is marked on every finding. Nothing here is carried over from an
earlier audit unverified; each item was re-checked against source at `bf617e4`.

> **Corrections applied 2026-09-13.** Five claims from the first revision have
> been withdrawn or restated: the provenance of `v0`, the inference that layouts
> were never archived, the structure-ceiling "bounds violation" and its proposed
> fix, the hierarchy equal-weights claim, and the 20,000-layout simulation and
> its comparison to manuscript means. Each is marked **CORRECTED** in place and
> listed in `docs/CHANGES.md`.

> **`v0` is "the scorer extracted from commit `bf617e4`" — not "the scorer that
> produced the published results."** Commit `bf617e4` contains no Golden Ratio
> and no Free-Form Grid preset, yet the manuscript's Study 3 reports scores for
> both. Historical provenance is UNRESOLVED. See `research/legacy/PROVENANCE.md`.

---

## 1. Architecture map

### 1.1 Element state

`class Element` (L1405) holds `type, index, id, visible, x, y, size, size2,
rotation, color, filled`. IDs are `${type}-${index}` and are **stable** — one
Phase 2 requirement already met.

Inventory is fixed at 16 elements, 4 per type (`circle, square, rectangle,
triangle`). Module-level mutable globals: `allElements`, `originalState`,
`showArrows`, `arrowTimer`. No text element type exists.

### 1.2 Rendering

`drawCanvas()` (L1720) draws to a single `<canvas id="canvas" width="500"
height="500">` (L1304). No CSS width/height override, so logical coordinates
equal device pixels and are viewport-independent. `CANVAS_SIZE = 500`,
`GRID_SIZE = 8`, `PHI = 1.618033988749`.

Circles are drawn with `ctx.arc(0, 0, size/2, 0, 2*PI)` — rotation-invariant.

### 1.3 Presets

`applyOrderMode(mode)` (L1760) dispatches a `switch` over 12 string keys:
`shape, size, grid, hierarchy, rhythm, proximity, balance, rotation, avgface,
symmetry, color, radial`. There is no numbering, no registry, no parameter
object, and no metadata. Each handler mutates the live `allElements` array in
place, then the dispatcher calls `buildElementControls()`, `drawCanvas()` and
`analyzeOrder()`.

### 1.4 Scoring

`analyzeOrder()` (L2039) reads the global element list via
`getVisibleElements()`, calls six `analyze*` functions, combines them, and
writes results straight into the DOM through `updateScoreDisplay()`. Scoring is
**fused to the DOM and to global state**; it cannot currently be invoked as a
pure function of a layout.

### 1.5 Persistence

**None in this application.** Grepped for `localStorage`, `sessionStorage`,
`indexedDB`, `fetch`, `XMLHttpRequest`, `toDataURL`, export and download paths —
zero matches. The only state recovery is `saveOriginalState()` /
`resetComposition()` (L1621, L1614), which keeps one in-memory snapshot for the
session. All work is lost on refresh.

**CORRECTED 2026-09-13.** An earlier revision inferred from this that study
layouts "were never archived". That inference was wrong and is withdrawn. The
absence of persistence *in this application* says nothing about archives kept
elsewhere. `Previous study/SSS.docx` in fact embeds 31 images, including four
compositions and a screenshot preserving a displayed score of 54% with partial
per-element values. See `research/legacy/PROVENANCE.md`.

---

## 2. Reproducibility and scoring problems

### 2.1 The seven previously reported issues

| # | Issue | Status | Location |
|---|---|---|---|
| 1 | Weight mismatch | **Confirmed** | L2054–2061 |
| 2 | Grouping is not DBSCAN | **Confirmed** | L2077 |
| 3 | Preset names / mode numbers differ | **Confirmed** | L1760 |
| 4 | `applyColorHarmony` emits HSL, `hexToRgb` accepts hex only | **Confirmed — corrupts scoring** | L2005, L1515 |
| 5 | Rotation scored on circles | **Confirmed** | L2094, L2157 |
| 6 | `toggleModeDetails` applies a transform | **Confirmed — worse than reported** | L1576 |
| 7 | Inventory drift between comparisons | **Confirmed** | L1592 |

**(1) Weights.** Code: `hier .20 + group .18 + struct .16 + flow .15 + spatial
.12 + harmony .19`, summing to `1.00`, multiplied by 10. Manuscript §3: variety
weight `0.09`, sum `0.90`, divided by `0.90`. Effective weights differ on all
six dimensions — hierarchy 20.0% (code) vs 22.2% (manuscript); harmony 19.0% vs
10.0%.

**(2) Grouping.** `analyzeGrouping()` is `min(10, (stdDev/avgDist) * 15)` over
all pairwise centre distances. No DBSCAN, no epsilon, no minPts, no cluster
coverage, within-cluster similarity, separation or containment. Related: the
`proximity` preset is a 10-pass nearest-neighbour attraction loop, not the
k-means the earlier chapter describes.

**(3) Presets.** Three mutually incompatible taxonomies exist: 12 string-keyed
modes in code; 11 numbered modes in `SSS.docx` §4.3; and the manuscript's Study
3, which reports scores for "Mode 6 (Golden Ratio)" and "Mode 10 (Free-Form
Grid)". **Neither a Golden Ratio nor a Free-Form Grid mode exists in the code.**

**(4) HSL/hex — silent scoring corruption.** `applyColorHarmony()` (L2005)
assigns `elem.color` a template string of the form `hsl(H, 70%, L%)`.
`hexToRgb()` (L1515) matches `/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i` and
returns `{r:0, g:0, b:0}` on failure. Three scoring paths degrade at once:

- `getVisualWeight()` → `saturationFactor = 0` for every element → corrupts
  **hierarchy** and **flow** (both rank by visual weight)
- `analyzeSpatial()` → `L = 0` → `totalWeight === 0` → takes the
  `? CANVAS_SIZE/2` fallback → deviation 0 → **balance = 10/10**

Measured with the extracted `v0` scorer over seeds 1..20000, reproducible via
`node scripts/color-defect-impact.mjs --n 20000`. The `parsed` condition is a
counterfactual — the same visual recolouring expressed in hex so `v0` *can*
parse it — used only to size the defect. It is not a proposed fix; fixing the
parse is decision G5.

```
model=v0-as-shipped  seeds=1..20000  scored=20000

baseline   balance mean  9.124  sd 0.450   degenerate   0.0%
shipped    balance mean 10.000  sd 0.000   degenerate 100.0%
parsed     balance mean  9.129  sd 0.447   degenerate   0.0%

overall delta (shipped - parsed): mean -1.527  sd 2.218  min -6.525  max +5.806
```

*(An earlier revision quoted mean −1.33 from an unarchived Python port whose
counterfactual substituted one fixed hex for every element. The figures above
supersede it.)*

The balance submetric degenerates to a constant maximum in 100% of cases. The
overall effect is not a constant bias but a layout-dependent swing, which for a
measurement instrument is worse. The fault is invisible: canvas `fillStyle`
accepts `hsl()`, so the composition renders correctly while the score is wrong,
and the corruption persists for the rest of the session.

Secondary effect: `buildElementControls()` (L1655) renders
`<input type="color" value="${elem.color}">`. That control cannot hold an
`hsl()` string, so after Color Harmony every swatch displays `#000000`, and
editing one commits actual black.

**(5) Rotation on rotation-invariant shapes.** `analyzeStructure()` uses
`rotations.filter(r => r % 15 < 2)` and `analyzeHarmony()` uses
`1 - min(1, SD(rotations)/180)`. Both include circles, whose rendering ignores
rotation. Squares (90° symmetry) and rectangles (180°) have the same problem at
coarser granularity.

**(6) Explain and Apply are the same action.** `toggleModeDetails(button,
mode)` (L1576) toggles the `.expanded` class **and then calls
`applyOrderMode(mode)` unconditionally** — including on the collapse branch, so
clicking twice to close applies the transform twice. There is no separate
info control despite the README describing one. Consequence for RQ3: an event
log built on this UI cannot distinguish reading documentation from accepting a
suggestion, making "the designer accepted the tool's suggestion" unfalsifiable.

**(7) Inventory drift.** `generateNewComposition()` (L1592) re-rolls
`visible = Math.random() > 0.4` for all 16 elements plus every position, size,
rotation, colour and fill, from unseeded `Math.random()`. Two compositions
being "compared" need not share an element inventory.

### 2.2 Additional findings (new — not previously reported)

**(8) Linear statistics on a circular quantity. Confidence: high.**
`analyzeHarmony()` computes an arithmetic mean and SD of rotations in degrees.
350° and 10° are 20° apart; the code treats them as 340° apart. Any layout
spanning 0° gets spurious rotation disorder, feeding the 0.19-weighted harmony
dimension. Requires circular mean / circular variance.

**(9) `analyzeStructure()` cannot reach 10. Confidence: high.**
`((xGrid + yGrid) * 4 + sizeConsistency * 4 + rotationAlignment * 2) / 1.5`
maxes at `14/1.5 = 9.33`, capping the attainable overall score near 98.9%.

**CORRECTED 2026-09-13.** An earlier revision of this audit called this a bounds
violation and proposed removing the `/1.5` divisor. Both were wrong. 9.33 is
*inside* `[0, 10]`; this is a reachability limit, not a bounds violation. And
removing the divisor would permit a maximum of **14**, which is strictly worse.
The intended normalisation must be derived and tested before any change is
proposed. Tracked as decision C5; the corresponding v1 test is skipped, not
asserted.

**(10) `filledConsistency` is inverted relative to its name. Confidence: high.**
`min(filledRatio, 1 - filledRatio) * 2` is **maximised at a 50/50 split** —
it rewards maximum fill inconsistency under a variable named for consistency.
Flagging as a naming/semantics question for `v1`, not silently "fixing" it.

**(11) Grid tolerance is near-degenerate and undocumented. Confidence: high.**
`Math.abs(x % 8) < 2` passes 25% of arbitrary positions by chance. The
manuscript instead specifies a tolerance of `0.03 * min(W,H)` = 15px, which on
an 8px grid would pass ~100%. Neither the code's pitch nor the manuscript's is
stated in §3.

**(12) Unnormalised area in prominence. Confidence: high.**
`getVisualWeight()` uses `sizeFactor = area / 250000` (≈0.058 for a 120px
element) against `contrastFactor = filled ? 0.8 : 0.4`. With weights 0.4 and
0.3, the fill flag outweighs size roughly tenfold — contradicting the
manuscript's stated rationale that size dominates because scale is the clearest
sign of dominance. The manuscript says area is normalised; the code does not
normalise it.

**(13) `contrastFactor` is not contrast. Confidence: high.**
The manuscript calls this term luminance contrast. The code uses a boolean fill
flag with no reference to colour or background.

**(14) Overlap ignored in whitespace. Confidence: high.**
`analyzeSpatial()` sums element areas without union — overlapping elements can
drive occupied area above canvas area and yield negative whitespace. Also uses
analytic shape area, not rendered/clipped area, so elements outside the canvas
still count.

**(15) No random baseline exists anywhere. Confidence: high.**
The manuscript reports no random or chance-level control, so there is no
reference point for what any DOASA score means. A baseline is cheap to add and
should be a condition in Phase 4.

**CORRECTED 2026-09-13.** An earlier revision reported an ad-hoc 20,000-layout
Python simulation and set its mean beside the manuscript's Study 2 and Study 1
means. Both the method and the comparison are withdrawn.

*Method.* That run used an unarchived translated port with unrecorded seeds. It
is superseded by `scripts/baseline-distribution.mjs`, which uses the extracted
`v0` scorer (tested for exact equality against the original JavaScript),
explicit seeds, and writes `results/baseline-report.json`,
`baseline-generated.csv`, `baseline-matched.csv` and sample layouts to disk.

*Comparison.* Setting a generator-range mean beside the manuscript's AI and
manual means treated them as arms of one controlled experiment. They are not:
different element inventories, an unidentified scorer build, and for Study 2 an
undocumented pipeline from raster output to scorable elements. That comparison
is withdrawn and is not reinstated in any form.

What the reproducible run does support, seeds 1..20000, `v0`/`v0-config-1`:

```
Condition A — generator's own parameter ranges
  total   n=20000  mean 60.82  sd 3.99  p05 53.63  p50 61.31  p95 66.82  max 74.21
  excluded (empty) 0    invalid (NaN) 0
```

Condition B is a genuinely controlled comparison — a matched
random-position baseline that holds inventory and every non-position attribute
fixed against a named source layout, randomising only x and y:

```
Condition B — strict-grid source vs its position-randomised twin (n=2000)
  structured        mean 69.06  sd 3.94
  random position   mean 63.89  sd 4.39
  delta             mean +5.17  sd 4.05   p05 -0.92   min -9.92   max +21.03
```

The mean favours the structured layout, but the lower tail is negative: in more
than 5% of matched pairs, randomising positions **scores higher** than the
grid-structured original. That is a reproducible statement about `v0`'s
discriminative power, and unlike the withdrawn comparison it is internally
controlled.

A failure to separate two conditions is also not evidence that they are
equivalent. Any future human-rating result must be reported with that
asymmetry respected.

### 2.3 Structural blockers for the proposed phases

| Blocker | Blocks |
|---|---|
| No persistence of any kind | Phase 4 ("archived layouts"), Phase 5 ("matched starting layouts"), Phases 7–8 entirely |
| Scoring fused to DOM and globals | Phase 2 (deterministic pure scoring) |
| No test infrastructure | Phase 9 |
| No serialization format | Phases 2, 4, 5, 7 |
| Unseeded `Math.random()` | Phase 2 (seeded study operations), Phase 4 (reproducible order) |
| No preset registry / parameters | Phase 2 (versioned registry), Phase 5 (preset selection) |
| No Preview or Undo/Redo | Phase 2 (four-way action split), Phase 6 (session review), Phase 7 (undo/redo events) |
| No text element type | Study 1 replication — prior drafts specify "3 text blocks" |

---

## 3. Implemented model vs. manuscript §3

| Dimension | Manuscript §3 | Code at `bf617e4` |
|---|---|---|
| Weights | .20/.18/.16/.15/.12/**.09**, ÷0.90 | .20/.18/.16/.15/.12/**.19**, ÷1.00 |
| Hierarchy | prominence `.4A + .3C + .2D + .1T`; dominant/subdominant gaps; `10(.5m1 + .3m2 + .2m3)` | `min(10, uniqueWeights*2 + range*5 + sqrt(var)*3)`. No gap analysis. Area unnormalised, contrast = fill flag |
| Grouping | DBSCAN at eps = 1.5 * base unit; coverage, similarity, separation, containment | `min(10, (SD/mean of pairwise distances) * 15)` |
| Structure | alignment concentration, grid adherence at `0.03*min(W,H)`, proportional regularity, weighted balance | grid `x % 8 < 2`, size CV, `rotation % 15 < 2`. **Weighted balance lives in `analyzeSpatial` instead** |
| Flow | scanpaths from 3 most prominent; turning-angle + distance cost | sort by weight; `+1` if next element is down-and-right |
| Spatial | whitespace target **0.5**, spacing regularity, margin consistency, density evenness (4 submetrics) | whitespace target **0.4**, plus balance (**2 submetrics**) |
| Variety/Harmony | hue entropy, scale variation, shape diversity, modular fit, spacing regularity, palette coherence | size-CV target 0.3, linear rotation SD, `min(r, 1-r)*2` on fill ratio |

**Underspecified in the manuscript** — cannot be implemented without decisions
from the researcher. See `DECISIONS-v1.md`. In summary: the three hierarchy
submetrics (the entire dimension), all four grouping submetrics, alignment
concentration, grid pitch, the ratio set in proportional regularity,
reading-order agreement, the gap and margin series in spatial, density
evenness, the normalisation constant, DBSCAN `minPts`, and the
component-combination rules for diversity and harmony.

**Manuscript-only issues (no manuscript edits made; logged for Deliverable 7):**
Table 1 reports `n = "not archived"` for 5 of 9 rows, though `SSS.docx` records
n = 15 per Study 2 condition; Study 3 rows are n = 1 with no dispersion yet are
compared; no inferential statistics, though `SSS.docx` records p < 0.01 for
Study 1; no figures; no ethics/consent statement; no code or data availability
statement, and the repository is never cited.

---

## 4. Proposed architecture

```
index.html                     public exploration workflow — preserved, untouched
research/
  core/
    layout-schema.js           canonical state, schema_version
    serialize.js               round-trip serialize/deserialize
    rng.js                     seeded PRNG
    presets/registry.js        versioned, stable IDs + parameters
    scoring/
      v0-as-shipped.js         bug-for-bug frozen; reproduces historical values
      v1-revised.js            gated on DECISIONS-v1.md sign-off
      config/*.json            weights, thresholds, normalisation, defaults
  study/                       Phases 3-6 (gated on Approval Gate 2)
  logging/                     Phase 7 append-only events, export
  storage/                     Phase 8 interface; export-only until endpoint approved
  test/                        Phase 9
  docs/                        AUDIT.md, DECISIONS-v1.md, data dictionary, guides
```

Invariants: scoring is a pure function
`score(layout, config) -> {total, dimensions, submetrics, model_version,
config_version}`; rendering never feeds scoring; every study record carries
`app_version`, `model_version`, `config_version`, `schema_version`; historical
values stay labelled `v0` and are never relabelled as `v1` output.

## 5. Phased plan

| Stage | Work | Gate |
|---|---|---|
| 0 | This audit + `DECISIONS-v1.md` | — |
| 1 | Extract `v0-as-shipped.js`, bug-for-bug. Characterization tests pin current behaviour **including** findings 4, 5, 8–14 | none — behaviour-preserving |
| 2 | Canonical state, serialization, seeded RNG, preset registry, Explain/Preview/Apply/Undo split | none — model-neutral |
| 3 | `v1-revised.js` | **blocked on `DECISIONS-v1.md`** |
| 4 | Blind judgment module (Phase 4) + archived layout corpus + random baseline condition | Gate 2 for wording |
| 5 | Study workflow, task module, feedback, logging, export (Phases 3, 5-7) | Gate 2 |
| 6 | Storage (Phase 8) | endpoint choice |
| 7 | Full Phase 9 suite, guides, Deliverable 7 checklist | — |

**RQ1 needs only stages 1, 2 and 4.** RQ2 and RQ3 require the full build.

## 6. Status against the deliverable ladder

| Claim | Status |
|---|---|
| Software implemented and tested | **No** — no tests exist; scoring is not extractable |
| Pilot workflow ready | **No** — no persistence, no consent, no conditions |
| Participant study completed | **No** |
| Scientific model externally validated | **No** — and unreachable by software work alone |

## 7. Decision log

| # | Date | Decision | Rationale |
|---|---|---|---|
| 1 | 2026-09-13 | Gate 1 → **Option C**, separately versioned model | Preserves historical benchmark meaning under `v0` while allowing a trustworthy `v1`; avoids validating human perception against a scorer with findings 4, 5 and 8 live |
| 2 | 2026-09-13 | `v0` frozen bug-for-bug, incl. all confirmed defects | A frozen baseline is what makes any later change reviewable rather than silent |
| 3 | 2026-09-13 | No manuscript edits | Out of scope per brief; collected for Deliverable 7 |
| 4 | 2026-09-13 | Fixing finding 4 is classified a **scoring change**, not a defect fix | It moves every score recorded after a Color Harmony application; belongs to `v1` |
