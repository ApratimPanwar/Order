# `v1` decision packets — index

> **NOT AUTHORITATIVE.** `V1-SPECIFICATION.md` is the single authoritative
> specification for DOASA v1 and governs wherever this document conflicts with
> it. This file is retained as the **historical record of how the decision was
> reached**, and is no longer a sign-off surface.

Gate 1 resolved to **Option C**: `v0` is frozen as "the scorer extracted from
commit `bf617e4`"; `v1` is a separate, revised model. This directory holds the
decisions `v1` needs.

**This replaces the blanket sign-off table in `../DECISIONS-v1.md`.** That
document listed ~30 questions and asked for answers in one pass. Each decision
now gets a packet carrying candidates, a recommendation with rationale, the
assumptions it commits you to, exceptional-case behaviour, worked layouts with
real computed numbers, and the invariance and sensitivity tests that would check
it. `DECISIONS-v1.md` remains as the full inventory and is cross-referenced.

## Ordering

Tranche 1 is foundational: colour representation, geometry, normalisation and
exceptional cases. **The dimension formulas cannot be specified until these are
settled** — grouping similarity needs a colour space (P1); structure's grid and
rotation terms need symmetry rules (P2); every dimension needs a normalisation
convention (P3); and every dimension needs to know what to return when a
quantity is undefined (P4).

Writing the dimension packets first would mean writing them twice.

| Packet | Decision | Status | Blocks |
|---|---|---|---|
| [P1](P1-colour-representation.md) | Colour representation and comparison space | open · **R2** | hierarchy, flow, spatial, variety–harmony |
| [P2](P2-geometry-and-symmetry.md) | Rotation symmetry, angular statistics, element extent, **renderer version** | open · **R2** | structure, variety–harmony, hierarchy, spatial |
| [P3](P3-normalisation.md) | Submetric normalisation, **missing-submetric and endpoint policies** | open · **R2** | all six, plus the overall weight set (G4) |
| [P4](P4-exceptional-cases.md) | Degenerate layouts; zero vs undefined vs unsupported; **trial-exclusion rules** | open · **R2** | all six |

### What changed in revision 2 (2026-09-13)

| Packet | Correction |
|---|---|
| P1 | The colour-equivalence test was built on a coincidence. `hsl(215,28%,17%)` equals `#1F2937` only because the rounding happens to land in the same 1/255 bucket; **89.7% of rounded-HSL notations do not round-trip**. Split into three tests: exact equivalence (hex ↔ `rgb()`), parser correctness (assert bytes, not scores), and a derived rounding tolerance. |
| P2 | R1's 120° triangle period was **wrong**. The triangle is equilateral, but it is drawn about its *bounding-box centre*, not its centroid, and rotation is about the stored `(x,y)` — so under the shipped renderer its period is **360°, not 120°**. Adds a `renderer-2` proposal (separately versioned), the period-aware circular statistic R1 left unspecified, the two-tolerance finding from the rounded `0.433` literal, and the `showArrows` qualification. |
| P3 | Adds the missing-submetric policy (renormalise, record `weightCoverage`, floor at `COVERAGE_MIN`) and an explicit endpoint policy distinguishing "0 because measured" from "0 because absent". |
| P4 | Adds pre-registered, outcome-blind **trial-exclusion rules X1–X8**, and an explicit list of things that are *not* exclusion rules — chiefly "the participant disagreed with the tool", since disagreement is the finding. |

### Tranche 2 — not yet written, blocked on tranche 1

| Packet | Decision | Depends on |
|---|---|---|
| P5 | Hierarchy submetrics — the three are named in §3 but never defined | P1, P3, P4 |
| P6 | Grouping — DBSCAN `minPts`, distance metric, the four submetrics, containment with no container type | P1, P2, P4 |
| P7 | Structure — grid pitch, alignment concentration, proportional regularity | P2, P3 |
| P8 | Flow — reading-order agreement, and whether reading order is a configurable parameter | P3, P4 |
| P9 | Spatial — whitespace target (manuscript 0.5 vs code 0.4), gap and margin series, density evenness | P2, P3, P4 |
| P10 | Variety–harmony — hue entropy binning, shape diversity, modular fit, palette coherence, the 0.5 diversity target | P1, P3, P4 |
| P11 | Overall weight set (**G4**) and the spacing-regularity overlap (**F7**) | P3, P9, P10 |

## Rules

1. **Nothing is implemented without a signed packet.** Where the correct value
   is a scientific choice, the corresponding `v1` test is *skipped* with a
   pointer to the packet — not asserted. See `test/v1-requirements.test.mjs`.
2. **Candidates are not tuned against human-rating data.** Selecting a
   definition by which one best correlates with the main rating set, then
   reporting that correlation as validation, is circular. Definitions are fixed
   first; any tuning must use pilot data that is excluded from confirmatory
   analysis and labelled as such.
3. **A narrowed `v1` is a valid outcome.** Specifying three dimensions well and
   stating the rest as future work is more defensible than guessing at six.
4. **No `v0` number is comparable to a `v1` number.** P3 alone changes every
   total. That is expected, and it is why `v0` is frozen.

## Corrections carried into this directory

Two items from the first revision of `DECISIONS-v1.md` were wrong and are
withdrawn:

- **C5, "remove the `/1.5` divisor".** Removing it would allow a maximum of 14.
  9.33 is inside `[0,10]` and is a reachability limit, not a bounds violation.
  Restated properly as [P3](P3-normalisation.md).
- **G6, "hierarchy's unequal weights contradict §3's equal-weights default".**
  §3 says equal weights *unless stated otherwise*, and hierarchy states
  otherwise. No contradiction. The real omission is that *structure*'s unequal
  submetric weights (4/4/4/2) are never stated in §3 at all — now part of P3.
