# `v1` model — decisions required from the researcher

> **NOT AUTHORITATIVE.** `decisions/V1-SPECIFICATION.md` is the single authoritative
> specification for DOASA v1 and governs wherever this document conflicts with
> it. This file is retained as the **historical record of how the decision was
> reached**, and is no longer a sign-off surface.

> **SUPERSEDED AS A SIGN-OFF DOCUMENT — 2026-09-13.**
> The blanket sign-off table at the foot of this file has been replaced by
> per-decision packets in [`decisions/`](decisions/README.md). Each packet
> carries candidates, a recommendation with rationale, assumptions,
> exceptional-case behaviour, worked layouts with computed numbers, and proposed
> invariance/sensitivity tests.
>
> Tranche 1 is written and open for sign-off: **P1** colour representation,
> **P2** geometry and symmetry, **P3** normalisation, **P4** exceptional cases.
> The dimension packets (P5-P11) are deliberately not written yet — their
> formulas depend on tranche 1.
>
> **This file remains the full inventory** of what is underspecified, and the
> packets cross-reference its item numbers. Two items below are withdrawn:
>
> - **C5** ("remove the `/1.5` divisor") was wrong — removing it permits a
>   maximum of 14, and 9.33 is inside `[0,10]`. Restated as packet P3.
> - **G6** ("hierarchy's unequal weights contradict the equal-weights rule") was
>   wrong — §3 says equal weights *unless stated otherwise*, and hierarchy states
>   otherwise. Withdrawn. The genuine omission is that *structure*'s 4/4/4/2
>   submetric weights are never stated in §3; that is now in P3.

Gate 1 resolved to **Option C**: freeze the shipped scorer as `v0`, build a
revised `v1` alongside it. This document lists every point where manuscript §3
is underspecified or contradicts the code. Per the brief, **none of these are
resolved here and none will be invented in code.** Each needs your sign-off.

## Read this first — these decisions do not block your next step

`v1` is stage 3 of 7. **RQ1 does not depend on it.** Blind human ratings can be
collected against archived layouts and correlated afterwards against `v0`,
`v1`, or both — the human judgments are the data, and the scorer is applied to
them later. So stages 1, 2 and 4 can proceed while this document sits unsigned.

What this document *does* block: any claim that the software implements the
model described in the manuscript.

Decisions are grouped by dimension. **Stakes** flags how much the choice moves
scores. Where I have a recommendation I give it and say why, but the call is
yours.

---

## A. Hierarchy — the dimension has no definition at all

Manuscript gives prominence `u_i = 0.4A + 0.3C + 0.2D + 0.1T`, then jumps
straight to `Q = 10(0.5*m1 + 0.3*m2 + 0.2*m3)`. The three submetrics are named
in prose ("a dominant gap, a subdominant gap, and subordinate clustering") and
never defined. This is the highest-weighted dimension.

| # | Decision | Stakes |
|---|---|---|
| A1 | Formula for `m1` (dominant gap). Ratio `u(1)/u(2)`? Normalised difference? Gap relative to the full spread? | **High** |
| A2 | Formula for `m2` (subdominant gap) — same question at rank 2/3 | **High** |
| A3 | Formula for `m3` (subordinate clustering) — dispersion of ranks 3..n? Inverse CV? | **High** |
| A4 | "Fallback defaults for small element counts" — which counts, which values | Medium |
| A5 | Is area min-max normalised within the layout? Manuscript implies yes; code does not (audit finding 12). Not normalising makes the fill flag outweigh size ~10:1, contradicting §3's own stated rationale | **High** |
| A6 | Definition of luminance contrast `C`. Against canvas background, local neighbours, or layout mean? Code substitutes a boolean fill flag (finding 13) | **High** |

*Recommendation:* normalise area (A5) and define `C` as Michelson or WCAG
contrast against the canvas background (A6) — both are standard and defensible.
A1–A3 I will not guess at; the ranking semantics are a modelling claim.

## B. Grouping — DBSCAN is specified but not parameterised

| # | Decision | Stakes |
|---|---|---|
| B1 | DBSCAN `minPts`. Manuscript gives only `eps = 1.5 * base unit`; DBSCAN needs both | **High** |
| B2 | Distance metric: centre-to-centre or edge-to-edge (gap)? Materially different for mixed-size elements | **High** |
| B3 | "Cluster coverage" — fraction of elements in any cluster, or area-weighted? How are DBSCAN noise points treated? | **High** |
| B4 | "Within-cluster similarity (size and color)" — how the two combine, and which colour space the distance is taken in (CIELAB recommended over HSL) | **High** |
| B5 | "Cluster separation" — nearest-centroid distance, silhouette, or min inter-cluster gap? | **High** |
| B6 | "Containment consistency" — **the element inventory has no container type.** Either define containment geometrically (bounding-box nesting) or drop the submetric and reweight | **High** |

*Recommendation:* `minPts = 2` (small-n layouts), edge-to-edge distance, CIELAB
for colour. B6 needs a real answer — the submetric is currently unimplementable.

## C. Structural consistency

| # | Decision | Stakes |
|---|---|---|
| C1 | **Grid pitch.** Manuscript gives a tolerance (`0.03 * min(W,H)` = 15px) but never the grid it applies to. Code uses an 8px pitch with a 2px tolerance. A 15px tolerance on an 8px pitch passes ~100% of positions; the code's passes ~25% by chance | **High** |
| C2 | "Alignment concentration" — entropy of edge/centre coordinates? Count of shared axes? Over which anchors (left/centre/right, top/middle/bottom)? | **High** |
| C3 | The ratio set in proportional regularity. Which ratios — pairwise size ratios, ratios to a base unit, or adjacent-rank ratios? | **High** |
| C4 | **Where weighted balance belongs.** Manuscript puts it in structure; code computes it in spatial. It cannot be in both without double counting | Medium |
| C5 | ~~Remove the `/1.5` normaliser~~ **WITHDRAWN — see packet [P3](decisions/P3-normalisation.md).** Removing the divisor would permit a maximum of 14. Derive the intended normalisation instead | Medium |

## D. Flow

| # | Decision | Stakes |
|---|---|---|
| D1 | "Reading-order agreement" — undefined. Rank correlation against an assumed reading order? | **High** |
| D2 | **Which reading order.** Defaulting to left-to-right, top-to-bottom encodes a cultural assumption the manuscript's own Limitations section flags. Should this be a configurable parameter recorded per study? | **High** |
| D3 | Relative weighting of Euclidean distance vs turning angle in the scanpath cost | Medium |
| D4 | Tie-breaking when candidate paths score equally (determinism requirement) | Low |

*Recommendation:* make reading order an explicit config parameter recorded in
every study record rather than a hardcoded default. It costs nothing and
directly addresses a stated limitation.

## E. Spatial organization

| # | Decision | Stakes |
|---|---|---|
| E1 | **Whitespace target.** Manuscript 0.5, code 0.4. Neither is cited. A 0.5 target declares a layout optimal at 50% ink coverage — a strong empirical claim | **High** |
| E2 | The gap series in spacing regularity — which gaps? All pairwise, nearest-neighbour, or projected onto axes? | **High** |
| E3 | The margin series in margin consistency — bounding box of all elements to canvas edge, or per-element? | Medium |
| E4 | Occupancy grid resolution for density evenness | Medium |
| E5 | **Overlap handling** (finding 14). Currently areas are summed without union, so occupied area can exceed canvas area and whitespace can go negative. Use union area? Rendered coverage? | **High** |
| E6 | Off-canvas elements — clip to canvas, exclude, or count in full? | Medium |

*Recommendation:* E1 needs a citation or an explicit "arbitrary, tested in
sensitivity analysis" note in the manuscript. E5 should use union area.

## F. Variety–harmony balance

| # | Decision | Stakes |
|---|---|---|
| F1 | Hue entropy binning — bin count and whether achromatic elements are excluded (a greyscale layout has undefined hue) | **High** |
| F2 | "Shape diversity" — entropy over shape types? Something continuous? | **High** |
| F3 | "Modular fit" and "palette coherence" — both undefined | **High** |
| F4 | **How three components combine into diversity and into harmony.** The manuscript says each "combines" three things but never says how — mean, weighted mean, geometric mean? | **High** |
| F5 | **Diversity target 0.5.** `1 - 2*abs(d - 0.5)` declares ideal diversity to be exactly the midpoint of a normalised composite whose 0.5 has no defined meaning | **High** |
| F6 | `filledConsistency` semantics (finding 10). `min(r, 1-r)*2` peaks at a 50/50 fill split — it rewards maximum inconsistency under a consistency name. Intended, or a sign error? | Medium |
| F7 | Spacing regularity appears in **both** spatial (E2) and harmony. Double counting — remove from one, or accept and document | **High** |

## G. Cross-cutting

| # | Decision | Stakes |
|---|---|---|
| G1 | The normalisation constant in the min-max denominator — value never given | Low |
| G2 | **Rotation symmetry classes** (finding 5). Circles are rotation-invariant; squares have 90° symmetry; rectangles 180°. Should rotation contribute only modulo each shape's symmetry period? | **High** |
| G3 | **Circular statistics** (finding 8). Rotation mean/SD are currently linear, so 350° and 10° read as 340° apart. Adopt circular mean and circular variance? | **High** |
| G4 | **Weight set for `v1`.** Manuscript (`.09` variety, ÷0.90) or code (`.19`)? These give harmony 10.0% vs 19.0% of the total | **High** |
| G5 | Should `v1` fix the HSL colour parse (finding 4)? Classified as a scoring change, not a defect fix, because it moves every score recorded after a Color Harmony application | **High** |
| G6 | ~~Hierarchy contradicts the equal-weights default~~ **WITHDRAWN — no contradiction;** §3 says "unless stated otherwise" and hierarchy states otherwise. Genuine issue: *structure*'s 4/4/4/2 submetric weights are unstated in §3. Moved to [P3](decisions/P3-normalisation.md) | Medium |

*Recommendation:* G2, G3 and G5 are the three I would fix regardless of what
else you decide — each is a case where the score responds to something that
does not exist on screen. G4 is a genuine modelling choice and I have no basis
to pick for you.

---

## Sign-off

Sign-off happens **per packet**, not here. See
[`decisions/README.md`](decisions/README.md).

Open for sign-off now:

| Packet | Decision |
|---|---|
| [P1](decisions/P1-colour-representation.md) | Colour representation and comparison space |
| [P2](decisions/P2-geometry-and-symmetry.md) | Rotation symmetry, angular statistics, element extent |
| [P3](decisions/P3-normalisation.md) | Submetric normalisation and score ranges |
| [P4](decisions/P4-exceptional-cases.md) | Degenerate layouts; zero vs undefined vs unsupported |
