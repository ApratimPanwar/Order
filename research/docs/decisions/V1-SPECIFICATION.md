# DOASA v1 — consolidated measurement specification

**Version:** draft-2 (correction revision) · **Date:** 2026-09-13 · **Status:** awaiting investigator sign-off
**Supersedes:** packets P1–P4 (R2) as the implementation reference. Those remain
the record of how each decision was reached; this document is what gets built.

**Approved design directions (2026-09-13):** `renderer-2` for new stimuli · a
fully specified six-dimensional successor model · a fixed complete-score primary
analysis.

### AUTHORITATIVE

**This is the single authoritative specification for DOASA v1.** Where any other
document in this repository conflicts with it, this document governs. Decision
packets `P1`-`P4`, `DECISIONS-v1.md` and `decisions/README.md` are retained as the
**historical record of how each decision was reached** and are no longer sign-off
surfaces; they carry supersession banners pointing here.

**This document approves nothing by itself.** Every formula below is a proposal.
The sign-off table in §11 lists the items that need your decision before
implementation starts.

Machine-checked by `node scripts/verify-specification.mjs`, which gates on the
formula forms, the quoted arithmetic, and this document's internal consistency.

---

## 0. Correction to the preflight conclusions

An earlier preflight reported per-dimension "attainable maxima" of
`structure 9.2288 · spatial 9.3438 · harmony 9.9770` and concluded that three of
six dimensions could not reach 10 because their submetrics were mutually
unsatisfiable.

**That conclusion is withdrawn.** The method was invalid: it sampled ~39,000
layouts drawn from `generateLayout()` plus the 12 presets and reported the
reachable set **of that generator** as a property **of the scorer**. The
generator draws sizes in `[40,120]` across at most 16 elements, so it essentially
never reaches the ~60% ink coverage where spatial's whitespace term peaks.
Sampled maxima are not proofs of unattainability.

Constructed witnesses (`node scripts/attainability-witnesses.mjs`) show every
dimension reaching its maximum:

| Dimension | Max | Witness |
|---|---|---|
| hierarchy | **10.0000** | five elements spanning size, fill, colour and position |
| grouping | **10.0000** | four coincident-ish elements plus one far outlier (CV ≥ 2/3) |
| flow | **10.0000** | descending-prominence chain on a down-right diagonal |
| spatial | **10.0000** | two squares of side `√(150000/2) = 273.8613` mirrored about the centre — footprint ratio exactly 0.600 (so whitespace 0.400), luminance centroid exactly at `(250,250)` |
| harmony | **10.0000** | sizes 130/70 (`CV = 0.3` exactly), equal rotations, exactly half filled |
| structure | **9.3333** | the existing `perfectGrid` fixture, reaching the algebraic `14/1.5` ceiling exactly |

So the only dimension below 10 under v0 is **structure**, and that is a pure
normalisation artifact (`/1.5` against a raw maximum of 14) — not a submetric
conflict. §9's normalisation removes it.

**Method rule adopted from this:** an attainability claim requires a
**constructed witness**, never a sampled maximum. A sample can show a value *is*
reachable; it can never show one is not. Every dimension and every submetric in
v1 ships with a witness fixture for both endpoints (§10).

Two further corrections carried in from the R2 packets:

- **Lightness monotonicity** (P1) — withdrawn. Balance is **unimodal**, not
  monotone, in an element's lightness: raising one element's weight pulls the
  luminance centroid toward it, improving balance until it crosses the canvas
  centre, then worsening (measured: 9 increases, 8 decreases; peak at lightness
  ≈135). The acceptance test is single-sign-change, not monotone.
- **"Perceptual tolerance"** (P2) — withdrawn. The vertex error from the
  renderer's rounded `0.433` literal is `2.5e-4 px` at size 20 and `2.5e-3 px`
  at size 200. The proposed `1e-3 × size` tolerance was ~100× larger than
  needed, and "perceptual" asserted a measurement never made. v1 uses exact
  `√3` expressions (§1.2), making the symmetry exact; tolerances are named
  **numerical**, not perceptual.

---

## 1. Geometry model

Three concepts that earlier drafts conflated. They are kept **separately named
and separately versioned** throughout.

### 1.1 The three concepts

| Concept | Definition | Used by |
|---|---|---|
| **anchor** `(x, y)` | The stored position. What presets set and what manual controls edit. | presets, editor, serialization |
| **rotationCentre** | The point rotation is applied about. | renderer only |
| **scoringCentroid** | The element's area centroid in canvas coordinates. | **all scoring position terms** |

These coincide for circles, squares and rectangles under every renderer. They
diverge for triangles under `renderer-1`, which is why they must stay distinct.

### 1.2 Renderer versions

`renderer-1` (shipped, `bf617e4`) — local vertices, rotation about the anchor:

| Shape | Local geometry | Centroid offset in local frame |
|---|---|---|
| circle | disc radius `s/2` at origin | `(0, 0)` |
| square | corners `(±s/2, ±s/2)` | `(0, 0)` |
| rectangle | corners `(±s/2, ±s2/2)` | `(0, 0)` |
| triangle | `(0, −0.433s)`, `(±0.5s, +0.433s)` | `(0, +0.433s/3)` = `(0, +0.1443333s)` |

`renderer-2` (**approved for new stimuli**) — triangle drawn about its centroid,
with exact expressions replacing the rounded literal:

```js
moveTo(0,      -s/Math.sqrt(3));        // -0.5773503s
lineTo(-s/2,    s/(2*Math.sqrt(3)));    // +0.2886751s
lineTo( s/2,    s/(2*Math.sqrt(3)));
```

Under `renderer-2`, `anchor = rotationCentre = scoringCentroid` for all four
shapes, and the triangle's rotation period is an exact **120°**.

### 1.3 scoringCentroid — applies to BOTH renderers

```
scoringCentroid(e) = anchor(e)                              for circle, square, rectangle
scoringCentroid(e) = anchor(e) + R(θ) · (0, 0.433·s/3)      for triangle under renderer-1
scoringCentroid(e) = anchor(e)                              for triangle under renderer-2
```

This matters independently of the renderer decision: **v0 uses the anchor as the
element position, which is the wrong centre for every triangle.** v1 corrects
this for legacy `renderer-1` layouts too, so archived stimuli can be scored
correctly without being re-rendered.

### 1.4 Rotation periods

| Shape | renderer-1 | renderer-2 |
|---|---|---|
| circle | continuous — excluded from rotation terms | continuous — excluded |
| square | 90° | 90° |
| rectangle | 180° | 180° |
| triangle | **360° (none)** | **120°** |

Rotation is retained in state for every shape; exclusion is a scoring decision.

**Guard:** every rotation-invariance claim holds only when
`renderer.showArrows === false`. The direction arrow is drawn in local
coordinates, so with arrows on, rotation is visible for *every* shape including
circles. v1 **rejects** any layout submitted for scoring with `showArrows: true`.

### 1.5 Clipped area

### 1.5 Area: occupied footprint (chosen), not rendered ink

**The choice, stated once.** Two different quantities were conflated in draft-2
under the name "ink":

| Quantity | What it counts |
|---|---|
| **occupied footprint** | the whole area a shape covers, whether filled or outlined |
| **rendered ink** | the pixels actually painted — the full shape when filled, only the 3px stroke ring when outlined |

**This specification uses occupied footprint**, and names it
`unionFootprintArea` / `occupiedFootprint` throughout. Draft-2's
`unionInkArea` and `r_ink` were misnamed: they computed footprint while the name
promised ink.

The consequence is explicit and must not be forgotten: **an outlined element
contributes exactly as much as a filled one of the same size.** For a size-80
square the stroke ring is roughly `4 × 80 × 3 = 960px²` against a footprint of
`6400px²`, so footprint overstates an outlined element's rendered ink by about
6.7×. Whitespace therefore measures *how much of the canvas is occupied by
shapes*, not *how much is painted*.

Footprint is chosen for the first implementation because it is renderer-
independent (it needs no stroke width, join or cap model), it keeps scoring
decoupled from rendering per §1.1, and `filled` already enters the model through
`C̃_i`. `renderedInk` is recorded as a future alternative under **S18**, not as a
silent variant.

**Clipping.** All area terms use the geometric intersection of the rotated shape
with the canvas rectangle. Polygons clip exactly (Sutherland–Hodgman); circles are
approximated by a regular polygon with `circleFacets` sides.

**Corrected approximation error.** Draft-2 claimed `< 0.03%` for a 64-gon. That
figure is wrong — it is the value for a *128*-gon. Computed
(`node scripts/spec-correction-checks.mjs`):

| `circleFacets` | max radial error | area error (inscribed) |
|---|---|---|
| 64 | **0.1205%** | **0.1606%** |
| 128 | 0.0301% | 0.0402% |
| 256 | 0.0075% | 0.0100% |

An **area-matched** 64-gon (radius scaled by `1.000804`) has zero area error by
construction and radial error `+0.080% / −0.040%`. Since every use here is an
*area* term, that variant is the better default at the same cost. The choice
between inscribed-64, inscribed-128 and area-matched-64 sits under **S18**.

`unionFootprintArea` is the union of all clipped shapes via the same polygon
pipeline — this replaces v0's summed area and makes the occupancy ratio always lie
in `[0, 1]`.

### 1.6 Colour

Parse `#rgb`, `#rrggbb`, `rgb()`, `hsl()` → sRGB (D65). Anything else is
**rejected at the gate**, never silently blackened.

| Quantity | Definition |
|---|---|
| colour distance | ΔE₀₀ in CIELAB |
| lightness | CIELAB `L*` |
| chroma | CIELAB `C*ab` |
| contrast | WCAG contrast ratio against the canvas background, `CR ∈ [1, 21]` |

Archived layouts keep the **original colour string verbatim**; conversion happens
at scoring time only.

---

## 2. Applicability — how "no layout-dependent reweighting" is enforced

The primary score uses a **fixed weight vector for the entire study**. A layout
either produces a complete score under that fixed vector, or it produces none.

Two mechanisms, and only these two:

**(a) Global removal.** A submetric that cannot be defined for the corpus is
removed **once, for every layout**, and the dimension's remaining weights are
renormalised **once**. Recorded in §8.

**(b) Global applicability conditions.** Fixed preconditions a layout must meet
to be primary-scorable. A layout failing any of them is `scorable: false` — it is
not scored on a reduced basis.

| Condition | Value | Driven by |
|---|---|---|
| `minElements` | **4** | hierarchy `m_h,3` needs ≥2 elements in the subordinate tail |
| ~~`minChromatic`~~ | **REMOVED** | See §8.1. Greyscale layouts are valid stimuli and are now scorable. |
| `minDistinctPositions` | **2** | grouping dispersion |
| `showArrows` | must be `false` | §1.4 guard |
| colour notations | all parseable | §1.6 |
| clipped area | every element `> 0` | §1.5 |

Study stimuli will carry 6–10 elements, so these bind only on degenerate inputs.

**What this replaces:** the `COVERAGE_MIN = 0.5` floor proposed in P3 R2 is
**withdrawn**. It permitted a dimension built from half its weight to stand in
for a complete one — exactly the substitution being ruled out. There is no
partial-score path into the primary analysis.

Partial scores are still *computed and recorded* for diagnostics, tagged
`primaryEligible: false`, and may appear only in separately labelled secondary
analyses. They are never pooled with complete scores.

---

### 2.3 Range invariant and undefined-value table

**Invariant R.** Every submetric **and every prominence component** returns a
value in `[0, 1]`. Clipping is applied **at the definition**, so a clipped value
stays visible in `submetrics` rather than hidden inside `Q_d`. Draft-1 violated
this in five places: `m_p,1` (§14 C1), `m_f,3` (C2), `m_v,1` (C3), and - both
because an element centroid can lie outside the canvas while the shape still
overlaps it - `m_p,5` and the prominence component `D_i` (C4).

**Invariant T.** Every submetric is **total** on the applicable domain (§2). No
submetric returns `null` for a layout that passed the gate - otherwise the
fixed-weight rule of §2 could not hold. Every edge case below resolves to a
*measured* value, with the rationale stated so it is not mistaken for a
convenient default.

| Submetric | Edge case | Value | Rationale |
|---|---|---|---|
| `m_h,1` / `m_h,2` | `u_(k) + u_(k+1) = 0` | `0` | No prominence to separate |
| `m_h,3` | tail all zero (`mean = 0`) | `1` | Identical values are perfectly cohesive |
| `m_g,1` | - | always defined | count over `n >= 4` |
| `m_g,2` | zero clusters | `0` | Nothing grouped |
| `m_g,2` | singleton cluster | `1` | One element is trivially self-similar |
| `m_g,3` | **zero** clusters (all noise) | `0` | Nothing was grouped, so no separation was achieved |
| `m_g,3` | **exactly one** cluster | `1` | A single group has no inter-group ambiguity to penalise |
| `m_s,1` | - | always defined | `n >= 4` makes the `(v - 1/n)/(1 - 1/n)` rescale safe |
| `m_s,3` | all areas equal | `1` | `CV(R) = 0`; uniform ratios are perfectly regular |
| `m_f,1` | - | always defined | `n >= 4` gives at least 2 turns |
| `m_f,2` | ties in reading order | Kendall **tau-b** | tau-b is tie-corrected; tau-a is not |
| `m_p,2` | all gaps zero | `1` | Uniformly zero spacing is regular spacing |
| `m_p,4` | total ink `0` | unreachable | gate requires clipped area `> 0` |
| `m_p,5` | `sum(u_i) = 0` | unweighted centroid of `scoringCentroid`s | A measured fallback, not a constant |
| hue diversity | 0 or 1 chromatic element | `0` | **A greyscale layout genuinely has no hue variety** - see §8.1 |
| palette coherence | single element | `1` | Zero dE to its own centroid |
| modular fit | - | always defined | gate requires size `> 0` |

---

## 3. Hierarchy

**Prominence** (per element, `renderer`-aware via `scoringCentroid`):

```
u_i = 0.40·Ã_i + 0.30·C̃_i + 0.20·D_i + 0.10·T_i
```

| Term | Definition | Provenance |
|---|---|---|
| `Ã_i` | min–max normalised **clipped** area within the layout; if `a_max − a_min < 1e-9`, `Ã_i = 0.5` for all | derived (manuscript says "normalised area"; v0 did not normalise) |
| `C̃_i` | `((CR_i − 1)/20) · (filled ? 1 : κ)`, `κ = 0.5` | **novel** — manuscript says "luminance contrast" without a definition; v0 used a fill flag |
| `D_i` | `clip(1 - ||p_i - c|| / d_max, 0, 1)`, `p_i` = scoringCentroid. Clipped for the same reason as `m_p,5`: a centroid can lie outside the canvas while the shape still overlaps it, making the raw ratio exceed 1 (Invariant R, §2.3). | derived |
| `T_i` | `min(1, C*ab,i / 128)` | derived (manuscript "saturation"; CIELAB chroma per §1.6) |

**Submetrics**, on `u` sorted descending (`u_(1) ≥ … ≥ u_(n)`):

| # | Formula | Meaning | Provenance |
|---|---|---|---|
| `m_h,1` | `(u_(1) − u_(2)) / (u_(1) + u_(2))` | dominant gap | **novel** |
| `m_h,2` | `(u_(2) − u_(3)) / (u_(2) + u_(3))` | subdominant gap | **novel** |
| `m_h,3` | `1 − min(1, CV(u_(3..n)))` | subordinate cohesion | **novel** |

Weights `0.5 / 0.3 / 0.2` (from-manuscript). Edge: if a denominator is 0 (both
prominences zero) the submetric is `0`.

**Worked example** - four identical elements give `m_h,1 = m_h,2 = 0` and
`m_h,3 = 1`, so `Q_hier = 10 * (0.2 * 1) = 2.0`.

**The attainable minimum is NOT 0** (see 14, C5). `Q_hier = 0` requires
`m_h,1 = m_h,2 = 0` (so `u_(1) = u_(2) = u_(3)`) *and* `m_h,3 = 0` (so
`CV(u_(3..n)) >= 1`). With `n = 4` the tail is `{u_(3), u_(4)}` and
`CV = |u_(3) - u_(4)| / (u_(3) + u_(4)) >= 1` forces `u_(4) = 0`. But `u = 0`
requires an element that is simultaneously the smallest, positioned exactly at a
canvas corner, exactly background-coloured (contrast ratio 1, i.e. invisible) and
achromatic. Draft-1 acceptance criterion "a witness reaching exactly 0" was
therefore unsatisfiable for this dimension by any non-degenerate layout.

The criterion is replaced: each dimension ships a witness at its **attainable
maximum** and its **attainable minimum**, both constructed, with the attained
value recorded. Where a theoretical bound is not constructible it is documented as
**unwitnessed** rather than asserted. This is the section 0 rule applied
consistently: a construction can show a value is reachable; nothing short of a
proof shows one is not.

---

## 4. Grouping

`d_eq,i = 2*sqrt(a_i/pi)` on **clipped** area; `beta = mean(d_eq)`.

Distance is the **equivalent-disc gap** - an explicit approximation, not a true
boundary distance (§14, C6):

```
gap(i,j) = max(0, ||p_i - p_j|| - (d_eq,i + d_eq,j)/2)        p = scoringCentroid
```

Draft-1 called this "edge-to-edge", which it is not. For a square of side 100 the
equivalent-disc radius is `56.42px`, against a true half-extent of `50.00px` along
an axis and `70.71px` to a corner - it overstates by `6.42px` in one direction and
understates by `14.29px` in the other. It is used anyway because `beta` and `eps`
are themselves defined in equivalent-diameter units, so threshold and distance
stay commensurable, whereas true polygon-to-polygon distance is orientation-
dependent and materially more expensive across all pairs. The approximation and
its error characteristics are declared rather than hidden, and
`useTrueBoundaryDistance` is reserved as a future config flag.

**DBSCAN**: `eps = 1.5β` (from-manuscript), `minPts = 2` (**novel** — the
manuscript omits it).

| # | Formula | Provenance |
|---|---|---|
| `m_g,1` **clusterMembership** | `(n - noise) / n`, element-count based, not area-weighted | derived |
| `m_g,2` | mean over clusters of `0.5·(1 − min(1, CV(areas))) + 0.5·(1 − min(1, meanΔE₀₀/ΔE_ref))`, `ΔE_ref = 50` | **novel** |
| `m_g,3` | `min(1, minInterClusterGap / (3β))` | **novel** |
| ~~`m_g,4`~~ | **REMOVED GLOBALLY** — see §8 | — |

Weights: **equal, 1/3 each** after removal.

**Edge cases (corrected — draft-2 contradicted itself here).** Draft-2's §2.3
table said `m_g,3 = 1` for "0 or 1 cluster" while this section said `0` for zero
clusters. Resolved consistently:

| Clusters found | `m_g,1` | `m_g,2` | `m_g,3` |
|---|---|---|---|
| 0 (all noise) | `0` | `0` | **`0`** |
| exactly 1 | `(n − noise)/n` | computed | **`1`** |
| 2 or more | `(n − noise)/n` | computed | computed |

Zero clusters scores `0` because nothing was grouped, so no separation was
achieved. One cluster scores `1` because a single group has no inter-group
ambiguity to penalise. Both are *measured* values, not missing ones.

**Colour averaging in `m_g,2`.** Within-cluster colour similarity uses the mean
ΔE₀₀ from each member to the **cluster colour centroid**, where the centroid is
the component-wise arithmetic mean of `L*`, `a*`, `b*`. Averaging in Cartesian
Lab avoids the circular-mean problem that averaging hue would introduce. Pairwise
mean ΔE₀₀ is *not* used; it would scale differently with cluster size.

---

## 5. Structure

| # | Formula | Provenance |
|---|---|---|
| `m_s,1` | alignment concentration: for each of 6 anchor families (bbox left/centreX/right, top/centreY/bottom of the rotated clipped shape), bin at `τ_a = 0.01·min(W,H) = 5px` and take `maxBinCount/n`; average the 6, then rescale `(v − 1/n)/(1 − 1/n)` | **novel** |
| `m_s,2` | grid adherence: fraction of anchor x- and y-coordinates within `τ_g` of a multiple of pitch `g`. **`g = 8px`, `τ_g = 0.25g = 2px`** | derived |
| `m_s,3` | proportional regularity: `1 − min(1, CV(R))`, `R = {√(a_(k)/a_(k+1))}` over sorted areas | **novel** |
| ~~weighted balance~~ | **MOVED to spatial** — see §8 | — |

Weights: **equal, 1/3 each**.

The manuscript's `τ_g = 0.03·min(W,H) = 15px` on an 8px pitch would pass ~100% of
positions, making the submetric vacuous. `0.25g` is proposed instead and needs
sign-off (§11, item **S2**).

---

## 6. Flow

Candidate paths start from the three highest-`u` elements. Greedy next-step
minimises

```
cost = 0.5 * (||delta|| / d_diag) + 0.5 * (turn / pi)
```

**Zero-length segments and the first step.** Two consecutive elements can share a
`scoringCentroid`, giving a zero-length segment whose direction — and therefore
whose turn angle — is undefined. And the first step has no preceding direction at
all. Specified:

- A zero-length segment contributes `0` to the mean step length `ℓ̄` and is
  **excluded from the turn-angle mean** `θ̄`, since it has no direction.
- The **first step has turn cost `0`** (no penalty, as there is nothing to turn
  from) and is likewise excluded from `θ̄`.
- If every segment is zero-length, `θ̄` has no terms: define `m_f,1 = 1` and
  `m_f,3 = 1`. A path that never moves has neither turning nor travel.
- `θ̄` is therefore the mean over *defined* turns only; if there are none,
  `m_f,1 = 1`.

`d_diag = sqrt(W^2 + H^2) = 707.11px` is the canvas **diagonal**, not the
centre-to-corner distance `d_max = 353.55px`. Draft-1 normalised by `d_max`, which
the mean step length can exceed - a mean step of 520px gives
`1 - 520/d_max = -0.4708` (§14, C2). Two elements can be a full diagonal apart, so
`d_diag` is the correct bound.

Ties broken by ascending element `id` (determinism). The lowest total-cost path
is scored.

| # | Formula | Provenance |
|---|---|---|
| `m_f,1` | `1 − θ̄/π`, mean absolute turn | from-manuscript |
| `m_f,2` | `(Kendall τ(path order, reading order) + 1) / 2` | **novel** |
| `m_f,3` | `clip(1 - Lbar / d_diag, 0, 1)`, mean step length; `d_diag = sqrt(W^2+H^2)` | derived |

Weights equal, 1/3.

**Reading order is a configuration parameter**, not a hardcoded default:
`readingOrder ∈ {ltr-ttb, rtl-ttb}`, default `ltr-ttb`, recorded in every study
record. This addresses the manuscript's own stated Western-tradition limitation.
Reading order sorts by row band `floor(y / (H/3))`, then by x in the configured
direction.

---

## 7. Spatial organisation

| # | Formula | Provenance |
|---|---|---|
| `m_p,1` | whitespace fit, on **whitespace** `r_ws = 1 - unionFootprintArea/canvasArea`, range-normalised about `rho*` - see §7.1 | derived |
| `m_p,2` | spacing regularity: `1 − min(1, CV(g_nn))`, nearest-neighbour edge gaps | derived |
| `m_p,3` | margin consistency: `1 − min(1, CV(m))`, `m` = four union-bbox-to-edge distances. **If `mean(m) = 0`** (the union bbox spans the canvas) `CV` is undefined; define `CV = 0`, so `m_p,3 = 1` — four identically-zero margins are perfectly consistent margins. | derived |
| `m_p,4` | density evenness: `H(p) / log(K²)` over a `K×K` ink-share grid, `K = 5` | **novel** |
| `m_p,5` | weighted balance: `clip(1 - \|\|sum u_i (p_i - c)\|\| / (sum u_i * d_max), 0, 1)` | from-manuscript |

Weights equal, 1/5.

### 7.1 Whitespace target and normaliser (corrected)

Draft-1 had two defects here (§14, C1).

**Semantics.** `rho*` is a **whitespace** target — the fraction of the canvas
*not* covered by any shape footprint (§1.5). It is not an ink target. v0's `0.4` is
`whiteSpaceRatio = (canvas - occupied)/canvas`, i.e. 40% empty and 60% ink.
Draft-1 wrote the measure over `r_ink` while keeping `rho* = 0.40`, silently
moving the target from 60% ink to 40% ink and contradicting §0's own witness,
which has ink `0.600`.

**Form.** Draft-1's `1 - |r - rho*|/rho*` normalises by `rho*` on both sides, so
at `rho* = 0.40` it reaches 0 at `r_ws = 0.8` and goes negative beyond - every
layout from 80% to 100% whitespace ties at 0. Corrected to a **range-normalised
piecewise form** that spans each side of the target properly:

```
m_p,1 = 1 - ( r_ws < rho*  ?  (rho* - r_ws)/rho*  :  (r_ws - rho*)/(1 - rho*) )
```

Verified (`node scripts/spec-correction-checks.mjs`): this equals the manuscript's
`1 - 2|r_ws - 0.5|` exactly at `rho* = 0.5`, and at `rho* = 0.40` gives
`r_ws=0 -> 0.0000`, `r_ws=0.40 -> 1.0000`, `r_ws=1 -> 0.0000`. The §0 spatial
witness (ink `0.600`, so `r_ws = 0.400`) scores `1.0000`.

**`rho*` still needs sign-off** (§11, item **S3**): parameter, default **0.40**
(v0's value, on the corrected whitespace semantics), with a mandatory sensitivity
analysis across `[0.30, 0.60]`. The default is a continuity argument, not an
endorsement.

---

## 8. Variety–harmony

### 8.1 Greyscale applicability (corrected)

Draft-1 set an applicability condition `minChromatic = 2`, which would have made
**every greyscale composition unscorable**. That is wrong on two counts: monochrome
and near-monochrome palettes are a standard design idiom, and the manuscript
itself observes that "many well-ordered layouts work with muted or nearly
monochrome palettes". Excluding them would have biased the stimulus corpus against
a legitimate and common case (§14, C8).

`minChromatic` is **removed**. Instead, hue diversity for a layout with 0 or 1
chromatic element is **0** - a *measured* value, not a missing one. "This layout
has no hue variety" is a true and meaningful statement about a greyscale
composition, not an absence of data. Palette coherence remains well defined for
greyscale because CIELAB dE00 captures lightness differences.

Chromatic means `C*ab >= 10`. Greyscale layouts therefore score low on hue
diversity and can still score high on scale variation, shape diversity, modular
fit and palette coherence - which is the behaviour a designer would expect.

### 8.2 Components

**Diversity `d`** = mean of:
- hue entropy over 12 bins of chromatic elements (`C*ab >= 10`), `/ log(12)`;
  **0 when fewer than 2 chromatic elements** (§8.1)
- scale variation: `min(1, CV(areas))`
- shape diversity: entropy over the 4 shape types `/ log(4)`

**Harmony `h`** = mean of:
- modular fit: fraction of sizes satisfying `|size − k·m₀| ≤ τ_m · m₀` for some
  integer `k ≥ 1`, where the module `m₀ = median(size)`. **`τ_m` is a relative
  tolerance, expressed as a fraction of `m₀`, not an absolute pixel value** —
  at `τ_m = 0.10` and `m₀ = 80px` the window is ±8px.
- palette coherence: `1 − min(1, meanΔE₀₀(colour, palette centroid) / ΔE_ref)`,
  where the **palette centroid is the component-wise arithmetic mean of `L*`,
  `a*`, `b*`** across elements, and the mean is the arithmetic mean of the
  per-element ΔE₀₀ to that centroid. Averaging in Cartesian Lab rather than in
  hue avoids a circular-mean ambiguity.
- ~~spacing regularity~~ **REMOVED GLOBALLY** — see below

```
m_v,1 = 1 - ( d < d*  ?  (d* - d)/d*  :  (d - d*)/(1 - d*) )
m_v,2 = h
weights 0.5 / 0.5
```

| # | Formula | Provenance |
|---|---|---|
| `m_v,1` | diversity balance about `d*`, range-normalised | from-manuscript |
| `m_v,2` | harmony composite `h` (modular fit, palette coherence) | derived |

Draft-1 wrote `m_v,1 = 1 - 2|d - d*|`, which is only in range when `d* = 0.5`. At
`d* = 0.3` it returns `-0.4000` for `d = 1.0` (§14, C3). The range-normalised
piecewise form above is identical to `1 - 2|d - 0.5|` at `d* = 0.5` (verified) and
stays in `[0, 1]` for every `d*`. It is the same normaliser as §7.1, so the two
target-seeking submetrics now share one form.

**`d*` needs sign-off** (§11, item **S4**): parameter, default `0.5`
(from-manuscript), with a mandatory sensitivity analysis. `0.5` is the midpoint
of a normalised composite whose midpoint has no established meaning.

### Globally removed and relocated submetrics

| Submetric | Action | Reason | Effect on weights |
|---|---|---|---|
| grouping — **containment consistency** | **REMOVED** | The element model has no container type. Defining containment as bounding-box nesting would be an invented proxy for a construct with no referent here. | grouping 4 → 3 submetrics, equal 1/3 |
| variety–harmony — **spacing regularity** | **REMOVED** | Double-counted: identical to spatial `m_p,2`. Retained in spatial, where it is a spatial property. | harmony component 3 → 2, equal 1/2 |
| structure — **weighted balance** | **RELOCATED to spatial `m_p,5`** | The manuscript puts it in structure, v0 computes it in spatial. It is a property of how visual weight is distributed *in space*. Assigned once; it cannot live in both without double counting. | structure 4 → 3 (equal 1/3); spatial 4 → 5 (equal 1/5) |

All three are **global, corpus-wide** decisions applied identically to every
layout — not layout-dependent reweighting.

---

## 9. Aggregation and normalisation

Dimension score, fixed submetric weights:

```
Q_d = 10 · ( Σ_k w_k · m_k ) / ( Σ_k w_k )              Q_d ∈ [0, 10]
```

This is P3's candidate **N3**, which removes structure's 9.3333 ceiling by
normalising against the submetric weight sum rather than the ad-hoc `/1.5`.

Overall:

```
DOASA_v1 = 10 · Σ_d W_d · Q_d                            ∈ [0, 100]
```

**`W_d` needs sign-off** (§11, item **S5**). Proposed — the manuscript's weights,
normalised (its stated `÷0.90`):

| Dimension | Manuscript | `W_d` (proposed) | v0 code, for contrast |
|---|---|---|---|
| hierarchy | 0.20 | **0.2222** | 0.20 |
| grouping | 0.18 | **0.2000** | 0.18 |
| structure | 0.16 | **0.1778** | 0.16 |
| flow | 0.15 | **0.1667** | 0.15 |
| spatial | 0.12 | **0.1333** | 0.12 |
| variety–harmony | 0.09 | **0.1000** | **0.19** |

Rationale: the manuscript is the published claim, and the `0.19` looks like an
implementation divergence. Matching the manuscript keeps the model describable in
the paper. It is still a modelling choice and still needs your signature.

### 9.1 What "not comparable" means (corrected, §14 C12)

Draft-1 asserted flatly that "no v0 score is comparable to a v1 score" while also
retaining v0 witnesses as fixtures and presenting v0 maxima in §0. Stated
precisely, there are three separate claims and only the first is a prohibition:

1. **v0 and v1 scores are not interchangeable as measurements.** Different
   geometry, different normalisation, different submetric sets. They may not be
   **pooled** — placed in one distribution, averaged together, or treated as
   repeated measures of the same quantity.

   **Cross-version diagnostics are permitted when explicitly labelled.**
   Draft-2 banned computing any difference between versions, which would have
   forbidden legitimate and useful work: "which layouts move most between v0 and
   v1, and on which dimension?" is a diagnostic about *the models*, and is one of
   the more informative things available before human data exists. Such an
   analysis is permitted provided it:
   - names both `model_version`s in the figure, table and caption;
   - is labelled a **model-comparison diagnostic**, never a measurement of order;
   - is never used as evidence about a layout's order, only about model behaviour;
   - reports paired per-layout deltas, not pooled distributions.
2. **v0 remains valid within itself, and existing data keeps its original
   protocol.** The frozen v0 scorer, its characterization tests and its witnesses
   stay live as regression fixtures *for v0*. Any data already collected or
   archived under v0 — including the matched-baseline runs and the reversal
   diagnostics — **remains valid under the frozen protocol it was collected
   under** and is neither rescored nor relabelled by the arrival of v1. Rescoring
   an archive under v1 produces a *new, separately labelled* record carrying the
   new `model_version`; it never overwrites the original.
3. **v0 witnesses do NOT transfer to v1.** The §0 spatial witness attains 10 under
   v0's 2-submetric spatial dimension; v1's spatial has 5 submetrics, so the same
   layout will not attain 10 under v1. Every v1 witness must be constructed and
   verified afresh against v1 (§10).

Every stored score therefore carries `model_version`, and any figure quoting a
score states which version produced it.

---

## 10. Acceptance tests

Every test below is a build gate.

**Bounds, fixtures and extrema**

Draft-2 required "a constructed witness reaching exactly 10 and another reaching
exactly 0" for every dimension and every submetric. That requirement was
universal and wrong: §3 already shows `Q_hier = 0` is not constructible by any
non-degenerate layout. It is replaced by three separate, narrower claims.

*B1. Valid bounds — universal, and the only universal claim here.*
- Every submetric and every prominence component lies in `[0, 1]`; every
  dimension in `[0, 10]`; every total in `[0, 100]`. Asserted per value over all
  fixtures and 2,000 seeded layouts.
- No value is `NaN` or non-finite for a layout that passed the gate.

*B2. Verified fixtures — per dimension, no extremum implied.*
- Each dimension has at least one fixture whose expected score is recorded and
  asserted exactly. These pin behaviour; they do not claim to be extrema.

*B3. Extrema — only where a witness exists.*
- An extremum is asserted **only** for a dimension or submetric where a witness
  has actually been constructed, and the test names that witness.
- Where a bound is not constructible it is recorded as **unwitnessed** in the
  attainability register, with the reason. `Q_hier = 0` is the first such entry.
- Sampling is never used to claim a bound in either direction.

The v0 witnesses in `scripts/attainability-witnesses.mjs` remain regression
fixtures for the frozen v0 and make no claim about v1 (§9.1).

**Geometry**

Rotation tests are **fixture-specific**. Invariance (a rotation that must change
nothing) is a property of the shape and holds generally; *sensitivity* (a rotation
that must change something) depends on the rest of the layout and is asserted only
on named fixtures where the change is guaranteed.

*Invariance — asserted over all fixtures and 2,000 seeded layouts:*
- Rotating a circle by any angle changes no score.
- Rotating a square by 90/180/270° changes no score.
- Rotating a rectangle by 180° changes no score.
- Under `renderer-2`, rotating a triangle by 120/240° changes no score.

*Sensitivity — asserted on named fixtures only:*
- On `fx-rot-sensitive-square`, rotating the square by 45° changes the score.
- On `fx-rot-sensitive-rect`, rotating the rectangle by 90° changes the score.
- On `fx-rot-sensitive-tri`, rotating the triangle by 120° changes the score
  under `renderer-1` and does not under `renderer-2`.

These are fixture-specific because a rotation can leave a score unchanged for
reasons unrelated to symmetry — for example when the rotated bounding box happens
to fall in the same alignment bin, or when the element is the sole member of its
shape class so the period-aware `R` is unaffected. A universal sensitivity claim
would be false.

Tolerance is **numerical** (`1e-9`, exact under §1.2's `√3` expressions) — the
word "perceptual" appears nowhere.
- `scoringCentroid` for a `renderer-1` triangle differs from its anchor by
  exactly `0.433·s/3` rotated by θ — the offset implied by the SHIPPED literal,
  not by exact `√3/12` (they differ by `4.2e-6·s`, and legacy geometry is
  defined by what was actually drawn). For all other shapes it equals the anchor.
  Under `renderer-2` the exact `√3` form applies and the offset is zero.
- A layout with `showArrows: true` is rejected, not scored.

**Colour**

- **T1** hex ↔ `rgb()` with integer components → byte-identical scores.
- **T2** `hsl()` → sRGB matches an independent reference conversion, asserted on
  **bytes**, not scores.
- **T3** rounded `hsl()` differs from exact by at most a bound **derived** from
  the maximum RGB deviation, with the derivation in the test. (89.7% of rounded
  HSL notations do not round-trip; exactness is the wrong bar here.)
- An unsupported notation is rejected, never blackened.

**Range and form (new in draft-2)**

- **Invariant R**: over every fixture and 2,000 seeded layouts, every submetric
  and every prominence component lies in `[0, 1]`. Asserted per value, not on the
  aggregate.
- `m_p,1` equals the manuscript's `1 - 2|r_ws - 0.5|` at `rho* = 0.5`, to machine
  precision, across `r_ws` in `{0, 0.25, 0.5, 0.75, 1}`.
- `m_p,1` reaches exactly `1.0` at `r_ws = rho*` and exactly `0.0` at both
  `r_ws = 0` and `r_ws = 1`, for `rho*` in `{0.3, 0.4, 0.5, 0.6}`.
- `m_v,1` equals `1 - 2|d - 0.5|` at `d* = 0.5`, and stays in `[0,1]` for `d*` in
  `{0.2, 0.3, 0.5, 0.7, 0.8}` across `d` in `[0,1]` - the case draft-1 failed.
- `m_f,3` stays in `[0,1]` for a layout with two elements at opposite canvas
  corners (mean step = `d_diag`), which drove draft-1 negative.
- `m_p,5` and `D_i` stay in `[0,1]` for an element whose centroid lies outside the
  canvas while its clipped area is still positive.
- A greyscale layout (every element `C*ab < 10`) is **scorable**, with hue
  diversity exactly `0` and every other submetric defined.
- Every entry in the §2.3 edge-case table is exercised by a fixture that reaches
  that branch, asserted by branch coverage rather than by inspection.

**Sensitivity**

- Lightness sweep **on the named fixture `fx-lightness-sweep`** (two elements,
  one swept): balance shows a single sign change, peaking as the luminance
  centroid crosses the canvas centre. This is **fixture-specific**, not a general
  property: with three or more elements the centroid can cross the centre more
  than once, so neither monotonicity nor unimodality is claimed in general. The
  test asserts the behaviour of that fixture and records the sweep.
- Each submetric moves the dimension score by exactly `10·w_k/Σw` when swept
  0→1 with others held.
- `ρ*` swept `[0.30, 0.60]` and `d*` swept `[0.3, 0.7]`; the effect on the
  primary outcome is reported, not assumed.

**Applicability and eligibility**

- A layout failing any §2 condition is `scorable: false` and receives **no**
  reduced-basis score.
- No export writes `0` where the model returned `null`.
- Score availability, trial eligibility and analysis eligibility are three
  **independent** flags. Asserted directly: setting `scoreAvailable: false` on a
  trial changes neither `trialEligible` nor the retention of its human rating.
- **An unsupported or failed scoring never invalidates a human rating.** A rating
  is evidence in its own right: it remains eligible for rating-only analyses
  (inter-rater reliability, rating distributions, pairwise preference) and is
  excluded only from analyses that require a model score on that layout. A test
  constructs an unscorable layout, records a rating against it, and asserts the
  rating survives into the export with `scoreAvailable: false` and
  `analysisEligible.ratingOnly: true`.
- Exclusion rules `X1`-`X7` are pure functions of recorded fields and read no
  score, rating, or effect direction. (`X8` is withdrawn - see §14, C11.)

**Determinism**

- Same layout + same config → identical score, including path tie-breaks.
- Serialization round-trip preserves the score exactly and the colour string
  verbatim.

---

## 11. Decisions needing your sign-off

| # | Decision | Proposed | Why it needs you |
|---|---|---|---|
| **S1** | `κ` — outline-element contrast factor in `C̃_i` | `0.5` | Novel; no basis in the manuscript |
| **S2** | Grid pitch `g` and tolerance `τ_g` | `8px`, `0.25g = 2px` | The manuscript's 15px tolerance on an 8px pitch is vacuous |
| **S3** | `ρ*` — whitespace target | `0.40` + sensitivity `[0.30, 0.60]` | Manuscript 0.5 vs code 0.4, neither cited |
| **S4** | `d*` — diversity target | `0.5` + sensitivity `[0.3, 0.7]` | Midpoint of a composite with no established meaning |
| **S5** | `W_d` — dimension weights | manuscript, normalised (variety `0.10`, not `0.19`) | The single largest modelling choice |
| **S6** | Remove grouping containment | remove; grouping → 3 submetrics | Construct has no referent in the element model |
| **S7** | Remove spacing regularity from harmony | remove; keep in spatial | Resolves the double count |
| **S8** | Relocate weighted balance to spatial | relocate | Manuscript and code disagree; must be assigned once |
| **S9** | `minPts` for DBSCAN | `2` | Manuscript omits it |
| **S10** | `minElements` for primary scoring | `4` | Follows from `m_h,3`; sets the corpus constraint |
| **S11** | `readingOrder` default | `ltr-ttb`, recorded per study | Cultural assumption the manuscript itself flags |
| **S12** | Hierarchy submetrics `m_h,1..3` | as §3 | Wholly novel — the manuscript defines none of them |
| **S13** | Grouping `m_g,2`, `m_g,3` | as §4 | Novel |
| **S14** | Structure `m_s,1`, `m_s,3` | as §5 | Novel |
| **S15** | Flow `m_f,2` and the cost split | Kendall τ; `0.5/0.5` | Novel |
| **S16** | Spatial `m_p,4` grid `K` | `5` | Novel |
| **S17** | Variety components and `ΔE_ref` | as §8; `ΔE_ref = 50`, shared with S13 | Novel |
| **S18** | Circle approximation, and footprint vs rendered ink | `circleFacets = 64`, **area-matched** (zero area error; radial +0.080%/−0.040%); **occupied footprint** for area terms | Draft-2's `< 0.03%` was the 128-gon figure, not the 64-gon's (true: radial 0.1205%, area 0.1606%). Footprint counts an outlined element the same as a filled one — roughly 6.7× its rendered ink for a size-80 square. |
| **S19** | `τ_m` — modular-fit tolerance | `0.10` of the module | Novel |
| **S20** | `τ_a` — alignment binning tolerance | `0.01·min(W,H) = 5px` | Novel |
| **S21** | Range-normalised target form, shared by `m_p,1` and `m_v,1` | `1 − (r<t ? (t−r)/t : (r−t)/(1−t))` | Novel form; reduces to the manuscript's `1−2\|r−0.5\|` at `t = 0.5` |

### 11.1 Short list — what actually needs your judgement

The 21 rows are not 21 open questions. Most are settled by evidence already in
this document and need confirmation rather than a decision. Sorted by how much
judgement they actually require:

**A. Genuine modelling choices — these need you (5)**

| # | Choice | Why no default is defensible |
|---|---|---|
| **S5** | Dimension weights `W_d` | The largest single lever on the total. Manuscript (variety 0.10) vs code (0.19) differ by nearly 2x on one dimension, and neither is empirically grounded. |
| **S12** | Hierarchy submetrics `m_h,1..3` | The manuscript defines *none* of them, and they carry the heaviest dimension weight. My forms are one reasonable reading of "dominant gap / subdominant gap / subordinate clustering", not the only one. |
| **S3** | `ρ*` whitespace target | Manuscript 0.5 vs code 0.4, neither cited. Declares what ink coverage counts as optimal. |
| **S4** | `d*` diversity target | Midpoint of a normalised composite whose midpoint has no established meaning. |
| **S1** | `κ` outline contrast factor | Wholly invented; sets how much an outlined element counts toward prominence. |

**B. Settled by evidence — confirm or overrule (7)**

| # | Choice | The evidence |
|---|---|---|
| **S2** | grid pitch and tolerance | The manuscript's 15px tolerance on an 8px pitch passes ~100% of positions; the submetric would be vacuous. Arithmetic, not taste. |
| **S6** | remove grouping containment | The element model has no container type. The construct has no referent. |
| **S7** | remove spacing regularity from harmony | Byte-identical to spatial `m_p,2`; keeping both double-counts. |
| **S8** | relocate weighted balance to spatial | Manuscript and code disagree; it cannot live in both. |
| **S9** | `minPts = 2` | DBSCAN requires the parameter; the manuscript omits it. |
| **S10** | `minElements = 4` | Follows mechanically from `m_h,3` needing a 2-element tail. |
| **S11** | `readingOrder` as a recorded parameter | Costs nothing and addresses a limitation the manuscript states about itself. |

**C. Novel definitions with clear defaults — review if you want, otherwise accept (9)**

`S13` grouping similarity/separation · `S14` structure alignment/proportion ·
`S15` flow reading agreement and cost split · `S16` density grid `K = 5` ·
`S17` variety components and `ΔE_ref = 50` · `S18` `circleFacets = 64` ·
`S19` `τ_m = 0.10` · `S20` `τ_a = 5px` · `S21` the shared target-seeking form.

`S21` is worth one look despite sitting in C: it is the form that fixes two
draft-1 range defects at once, and it reduces exactly to the manuscript's
`1 − 2|r − 0.5|` at a target of 0.5 — so accepting it keeps continuity with the
published form rather than departing from it.

**No group is automatically approved.** Groups B and C are triage for your
reading order, not a default acceptance: B collects items where the evidence is
arithmetic rather than judgement, C collects novel definitions that have a clear
proposed default. Every one of the 21 items still requires your explicit
decision before implementation begins.

There are now **21** items. S1-S17 are unchanged from draft-1; S18-S21 close gaps the verification script found — parameters the specification uses but never put to you.

**Provenance summary (corrected, §14 C10).** Draft-1 claimed "20 submetrics -
4 from-manuscript, 6 derived, 10 novel", which sums to 20 but does not match the
dimensions as specified. The actual count is **19**:

| Dimension | Submetrics |
|---|---|
| hierarchy | 3 |
| grouping | 3 (after the global removal of containment) |
| structure | 3 (after weighted balance moved to spatial) |
| flow | 3 |
| spatial | 5 (4 + relocated weighted balance) |
| variety-harmony | 2 |
| **total** | **19** |

| Provenance | Count | Submetrics |
|---|---|---|
| from-manuscript | **3** | `m_f,1`, `m_p,5`, `m_v,1` |
| derived | **7** | `m_g,1`, `m_s,2`, `m_f,3`, `m_p,1`, `m_p,2`, `m_p,3`, `m_v,2` |
| novel | **9** | `m_h,1`, `m_h,2`, `m_h,3`, `m_g,2`, `m_g,3`, `m_s,1`, `m_s,3`, `m_f,2`, `m_p,4` |

`m_f,3` is classified **derived**, not from-manuscript: the manuscript's form is
`1 - Lbar/d_max`, and §6 changes the normaliser to `d_diag` to keep it in range
(§14, C2). Draft-2 stated this in prose while the table above still listed it as
from-manuscript — a contradiction the rewritten verifier now catches by parsing
the per-dimension rows rather than a hardcoded copy. The conclusion is unchanged and if anything sharper: with 9 of 19
submetrics novel, v1 is a *specified successor* to §3, not an implementation of
it, and the manuscript cannot describe v1 as implementing the published model.

---

## 12. Freeze protocol

The **complete measurement and analysis specification** is frozen before the main
evaluation — not the renderer alone.

**Frozen at freeze time:** renderer version; all formulas and parameters
(`kappa, g, tau_g, rho*, d*, W_d, minPts, K, dE_ref, tau_m, tau_a, readingOrder,
circleFacets`); applicability conditions; exclusion rules `X1`-`X7`; the primary
outcome and its analysis; the stimulus set and its provenance.

**Recorded in every study record:** `model_version`, `config_version`,
`schema_version`, `renderer_version`, `app_version`, `spec_freeze_id`.

**Development data is separate.** Anything collected before the freeze — pilot
sessions, workflow tests, parameter-sensitivity runs — is tagged
`dataset: development` and is **excluded from confirmatory analysis**. It may
inform parameter choices; the main evaluation then runs against the frozen spec
on fresh data. Tuning parameters on rating data and then reporting agreement
with those same ratings would be circular, and the freeze is what prevents it.

**Changing anything frozen invalidates collected data** for the primary analysis
and requires a new `spec_freeze_id`.

---

## 13. What happens on approval

1. Implement `v1` per this specification, with `v0` untouched and still pinned.
2. Activate the v1 acceptance tests (§10); the currently-`todo` v1 requirements
   become live assertions.
3. Correct and version the matched baseline — sampling positions from the same
   reachable region the preset clamps to, fixing the support confound recorded
   in `results/reversals/summary.json`.
4. Build the consent-to-export blind-rating workflow.
5. Demonstrate pilot readiness end to end.

No recruitment, no public deployment, no manuscript-result changes at any of
these steps.

---

## 14. Change ledger - draft-1 to draft-2

Correction revision only. **No provisionally approved decision was reopened**:
renderer-2, the six-dimensional successor model and the fixed complete-score
primary analysis all stand unchanged. Worked checks for C1-C6 and C10:
`node scripts/spec-correction-checks.mjs`.

| # | Defect in draft-1 | Correction | Section |
|---|---|---|---|
| **C1** | **Whitespace target mismatch.** The measure was written over `r_ink` while `rho* = 0.40` was carried over from v0, where 0.40 is a *whitespace* target (60% ink). This silently moved the target and contradicted §0's own witness, which has ink 0.600. The normaliser `1 - \|r - rho*\|/rho*` also divided by `rho*` on both sides, so at `rho* = 0.40` everything from 80% to 100% whitespace tied at 0 and went negative beyond. | Measure defined on **whitespace** `r_ws`; range-normalised piecewise form `1 - (r<rho* ? (rho*-r)/rho* : (r-rho*)/(1-rho*))`. Reduces exactly to the manuscript's `1 - 2\|r-0.5\|` at `rho* = 0.5`. Witness now scores 1.0000. | §7.1 |
| **C2** | **Flow `m_f,3` could go negative.** `1 - Lbar/d_max` used the centre-to-corner distance (353.55px), but two elements can be a full diagonal apart (707.11px). A mean step of 520px gives `-0.4708`. | Normalise by the canvas diagonal `d_diag`, and clip. The path cost uses `d_diag` too. `m_f,3` reclassified *derived*, since this departs from the manuscript's form. | §6 |
| **C3** | **Diversity `m_v,1` could go negative.** `1 - 2\|d - d*\|` is only in range at `d* = 0.5`; at `d* = 0.3` it returns `-0.4000` for `d = 1.0`. `d*` is a signed-off parameter, so the form had to be general. | Same range-normalised piecewise form as §7.1. Identical to `1 - 2\|d-0.5\|` at `d* = 0.5`. | §8 |
| **C4** | **No global range invariant.** Submetrics were assumed to be in `[0,1]` without being clipped there. `m_p,5` can exceed 1 when an element centroid lies outside the canvas while the shape still overlaps it. | **Invariant R** added: every submetric clips to `[0,1]` at its own definition. `m_p,5` clipped explicitly. | §2.3, §7 |
| **C5** | **Impossible hierarchy endpoint requirement.** The acceptance criterion demanded a witness at exactly 0 for every dimension. `Q_hier = 0` forces some `u_i = 0`, requiring an element that is smallest, exactly at a corner, exactly background-coloured (invisible) and achromatic - not constructible non-degenerately. | Criterion replaced with witnesses at the **attainable** maximum and minimum, values recorded; non-constructible bounds documented as **unwitnessed** rather than asserted. | §3, §10 |
| **C6** | **Equivalent-disc called "edge-to-edge".** `d_eq` is derived from area, not boundary geometry. For a side-100 square the equivalent-disc radius is 56.42px against a true half-extent of 50.00px (axis) and 70.71px (corner). | Renamed **equivalent-disc gap** and declared an approximation, with error characteristics and the rationale (`beta` and `eps` share its units). `useTrueBoundaryDistance` reserved as a future flag. | §4 |
| **C7** | **Geometry and coverage terms ambiguous.** "Coverage" named both `m_g,1` and P3's `weightCoverage`; clipped vs union area was not consistently stated. | `m_g,1` renamed **clusterMembership** and declared element-count based. `d_eq` and `Ã` use per-element **clipped** area; `m_p,1` uses **union** ink area. | §1.5, §4 |
| **C8** | **Greyscale layouts made unscorable.** `minChromatic = 2` would have excluded every monochrome composition - a standard design idiom, and one the manuscript explicitly notes. | `minChromatic` **removed**. Hue diversity is **0** with fewer than 2 chromatic elements - a measured value, since a greyscale layout genuinely has no hue variety. | §2, §8.1 |
| **C9** | **Undefined-value cases not enumerated.** With no partial reweighting permitted, every submetric must be total, but draft-1 specified edge cases only piecemeal. | **Invariant T** plus a complete edge-case table covering all 19 submetrics, each resolving to a measured value with a stated rationale. | §2.3 |
| **C10** | **Submetric count wrong.** Draft-1 claimed 20 submetrics and a 4/6/10 provenance split. The dimensions as specified total **19**. | Corrected to **19**, provenance **4 from-manuscript / 6 derived / 9 novel**, itemised. Conclusion unchanged and slightly sharper. | §11 |
| **C11** | **Inherited exclusion rule contradicted the spec.** P4 R2's rule `X8` triggers on `weightCoverage < COVERAGE_MIN`, but §2 withdrew `COVERAGE_MIN` and forbids partial scores entirely, so `X8` referenced a quantity the spec no longer has. | `X8` **withdrawn**. `X1` already covers it: a layout failing any §2 applicability condition is excluded. Rules are now `X1`-`X7`. | §10, §12 |
| **C12** | **Version-comparison statements contradictory.** "No v0 score is comparable to a v1 score" sat beside retained v0 witnesses and a §0 table of v0 maxima. | Split into three precise claims: v0/v1 not comparable *as measurements*; v0 stays valid *within itself* as regression fixtures; v0 witnesses **do not transfer** to v1 and must be reconstructed. | §9.1 |

### Superseded statements in earlier packets

These remain in the P-packets as the record of how decisions were reached. Where
they conflict with this specification, **this specification governs**:

| Packet | Superseded statement |
|---|---|
| P3 R2 | `COVERAGE_MIN = 0.5` and the missing-submetric renormalisation policy - withdrawn by §2 (no partial score reaches the primary analysis) |
| P3 R2 | "Every dimension's attainable maximum equals exactly 10 for a witness layout" - corrected by §0 and C5 |
| P4 R2 | Exclusion rule `X8` - withdrawn by C11 |
| P1 R2 | Lightness-monotonicity sensitivity test - corrected to single-sign-change by §0 |
| P2 R2 | "Perceptual tolerance" of `1e-3 * size` - corrected to an exact numerical tolerance by §0 |
| P2 R2 | Triangle period `120 deg` under the shipped renderer - corrected to `360 deg`; `120 deg` holds only under renderer-2 |
