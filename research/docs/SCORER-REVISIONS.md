# Scorer revisions

| Revision | Label | Status |
|---|---|---|
| 1 | `v1-development-candidate` | **archived, superseded.** Preserved byte for byte in `core/scoring/v1-r1-archived.js` (only the header and its version label differ) so records made under it stay reproducible |
| 2 | `v1-development-candidate-2` | **study scorer**, development candidate. None of S1–S21 or R2-1..R2-3 is approved |

Records made under revision 1 — the development key in
`study-private/stimulus-key.json`, the `dev-pilot-1..3` packages and every file
in `results/` other than the two directories named below — keep the revision-1
label and are not rewritten. `test/scoring-revision-2.test.mjs` re-scores every
archived key entry with the archived scorer and requires the recorded totals to
reproduce exactly.

---

## R2-1 — element-array-order dependence

**Finding.** The position of an element in `layout.elements` changed flow
scores. Three flow computations select among ties — equal prominence when
choosing path starts, equal cost when choosing the next element, equal reading
position within a row band — and a stable sort resolved them by array position.

**Reproduced** before any change, then measured reproducibly for both revisions
on identical layouts and permutations (`scripts/permutation-invariance-report.mjs`,
300 seeds × (as generated + 12 presets), reversed array + 5 seeded shuffles per
layout; `results/permutation-invariance/summary.json`):

| | Revision 1 | Revision 2 |
|---|---|---|
| scorable layouts | 3,879 | 3,879 |
| permuted scorings | 23,274 | 23,274 |
| layouts whose submetrics changed (> 1e-9) | **1,101 (28.4%)** | **0** |
| permuted scorings differing at all (bitwise) | 16,469 | **0** |
| submetrics affected | `m_f,1` (1,007), `m_f,2` (4,805), `m_f,3` (1,428) | none |
| largest change in total | **5.19 points** | 0 |

The first, exploratory reproduction (six shuffles, no reversed array) found
1,093 affected layouts and the same 5.19-point maximum; the figure quoted in the
source comment comes from that run.

**Rule adopted (proposed for approval as R2-1).** Before any quantity is
computed, visible elements are placed in ascending lexicographic order of

> (y, x, type, size, size2, rotation, red, green, blue, filled)

using the element's own attributes. Colour is compared as parsed sRGB, so
notation does not create an order. `id`, `index` and `order` are deliberately
not keys. Every later iteration, summation and tie-break follows this order, so
ties resolve top-to-bottom, then left-to-right, then by shape attributes. Two
elements that compare equal on every key are identical in every input the
scorer reads, so their relative order cannot change a result.

**Verified** by the table above and by tests `R2-1 reproduced`, `R2-1 fixed`
(×2) and `R2-1 rule`.

## R2-2 — Kendall τ-b with jointly tied pairs

**Finding.** A pair tied in both sequences was added back into both
denominator factors. τ-b = (n_c − n_d) / √((n₀ − n₁)(n₀ − n₂)), where n₁ and n₂
count every pair tied in the respective sequence, joint ties included.

**Reproduced:** revision 1 returns **0.667** for `[1,1,2]` against itself
(correct: 1) and **0.5** for `[1,1,2,3]` vs `[1,1,3,2]` (correct: 0.6).

**Verified** against hand derivations, the worked example in the SciPy
documentation for `scipy.stats.kendalltau`
(`[12,2,1,12,2]` vs `[1,4,7,1,0]` → −0.47140452079103173), and an independent
textbook implementation on 2,000 seeded heavily tied sequences, including
symmetry and bounds.

**Scope, stated so the fix is not over-claimed.** Flow `m_f,2` passes a path rank
`0..n−1` and a permutation of `0..n−1`; neither can contain ties. The τ-b defect
therefore did **not** change any revision-1 flow score. The order dependence
(R2-1) did.

---

## Evidence under the study scorer — seeded 2,000-pair comparison

`node scripts/matched-comparison.mjs` →
`results/matched-comparison-v1r2/{summary.json,pairs.csv}`.

Design unchanged from the archived Condition B: `strict-grid` source versus its
position-randomised twin (`baseline-2`), seeds 1–2000. Only the scorer differs.

| Count | Definition | Value |
|---|---|---|
| Pairs | | **2,000** |
| Eligible | both members scorable | **1,998** |
| Unsupported | at least one member not scorable | **2** — both members, `below-min-elements` (seeds 855, 1605: 3 and 2 elements) |
| Wins | eligible, source total > twin total | **1,976** — 98.90% of eligible (Wilson 95%: 98.34–99.27%) |
| Ties | eligible, totals exactly equal | **0** |
| Reversals | eligible, source total < twin total | **22** — 1.10% of eligible |
| Within ±0.5 points | descriptive | 28 |

Δ = source − twin over eligible pairs: mean 4.82, min −2.39, p05 1.40,
median 4.70, p95 8.59, max 17.20. In reversals, the mean dimension
differences are dominated by flow (−1.39) and spatial (−0.51) against structure
(+1.43).

Effect of R2-1 on this comparison: under revision 1, reversing the element
arrays changed the outcome sign of **2** of 1,998 pairs, and revision 1's sign
differs from revision 2's in **2** pairs.

**The archived 93% is not this result.** It is 1,860 / 2,000 under `v0-as-shipped`
— a different model with different dimensions and no applicability gate — and it
is neither reused, restated nor compared here as the same measurement. A win is
agreement between the scorer and how the pair was constructed, not evidence about
human perception.
