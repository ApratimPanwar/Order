# Decision packet P3 — Normalisation and score ranges

> **NOT AUTHORITATIVE.** `V1-SPECIFICATION.md` is the single authoritative
> specification for DOASA v1 and governs wherever this document conflicts with
> it. This file is retained as the **historical record of how the decision was
> reached**, and is no longer a sign-off surface.

> **SUPERSEDED IN PART by `V1-SPECIFICATION.md` (draft-2, 2026-09-13).**
> This packet remains the record of how the decision was reached. Where it
> conflicts with the specification, the specification governs. Superseded here:
> COVERAGE_MIN = 0.5, the missing-submetric renormalisation policy, and the "every dimension attains exactly 10" endpoint requirement.

**Status:** open · **Revision 2 (2026-09-13)** · **Blocks:** every dimension,
and the overall weight set · **Tranche:** 1

> **Revision 2 adds the two policies R1 left as one-liners:** what happens when
> a submetric is missing, and what happens at the endpoints of a sweep. R1 said
> "drop it and renormalise over the remaining weights" in a table row. That is
> not sufficient — renormalising silently changes what a dimension means, and
> nothing said when it must stop.

## The question

How do raw submetric sums become dimension scores on a common scale, and what
does the top of that scale mean?

This packet exists because the first audit got it wrong. It claimed
`analyzeStructure()`'s 9.33 ceiling violated the `[0,10]` bounds and proposed
removing the `/1.5` divisor. **Both were incorrect.** 9.33 is *inside* `[0,10]`,
and removing the divisor would permit a maximum of **14**. That correction is
why normalisation is now treated as a decision rather than a fix.

## Worked example

Run: `node scripts/worked-examples.mjs`

`analyzeStructure` sums `(xGrid + yGrid)*4 + sizeConsistency*4 + rotationAlignment*2`,
whose components are each in `[0,1]`, so the raw maximum is `4+4+4+2 = 14`.

| Treatment | Maximum | `perfectGrid` fixture scores |
|---|---|---|
| `v0` — raw `/1.5` | **9.3333** | 9.3333 (it *is* the maximum) |
| raw `/1.4` | 10.0000 | 10.0000 |
| rescale `× 10/14` | 10.0000 | 10.0000 |
| remove divisor (earlier bad proposal) | **14** | 14 |

Note that `perfectGrid` attains the ceiling exactly, so this is a reachable
maximum, not a theoretical one — a perfectly grid-aligned, uniform composition
currently tops out at 9.33/10 while every other dimension can reach 10.0.

## Candidates

**N1 — Keep `v0` behaviour, document the ceiling.**
No score changes. But structure is systematically under-credited relative to the
other five dimensions, which silently reweights the model: structure's nominal
0.16 weight delivers at most `0.16 × 9.33` where others deliver `0.16 × 10`.

**N2 — Rescale each dimension by its own algebraic maximum. (recommended)**
`Q_d = 10 × (raw_d / max_raw_d)`. For structure that is `× 10/14`, equivalent to
`/1.4`. Every dimension then spans a full, comparable `[0,10]`.

**N3 — Weighted mean of submetrics in `[0,1]`, then `×10`.**
The manuscript's stated form: `Q_d = 10 · Σwₖmₖ / Σwₖ`. Equivalent to N2 when
the implied submetric weights are `4/14, 4/14, 4/14, 2/14`. **This is the
important observation**: `v0`'s structure already encodes unequal submetric
weights (grid-x, grid-y, size each 4; rotation 2) — it just normalises by 1.5
instead of by the weight sum of 14.

**N4 — Empirical percentile normalisation against a reference corpus.**
Rejected for now: it makes scores corpus-dependent and non-portable, and there is
no approved corpus.

## Recommendation

**N3**, stated explicitly as a weighted mean — which makes `v0`'s implicit
submetric weights visible and puts every dimension on a true `[0,10]`.

Rationale: N3 and N2 give identical numbers here, but N3 expresses *why*. It also
matches the manuscript's own stated form, so the implementation and §3 converge
rather than needing a third description.

**Consequence you must accept:** every structure score changes by a factor of
`1.5/1.4 ≈ 1.0714`, and therefore every total changes. No `v0` number is
comparable to a `v1` number. This is the expected behaviour of a versioned model
and is why `v0` is frozen.

## A correction to carry into the manuscript checklist

§3 says submetrics are equally weighted "unless stated otherwise", and hierarchy
states otherwise (`0.5/0.3/0.2`). **There is no contradiction there** — an
earlier revision of the decision list wrongly flagged one, and that claim is
withdrawn. The real gap is different: *structure* uses unequal submetric weights
(4/4/4/2) that §3 never states at all.

## Assumptions this commits you to

1. Every submetric is in `[0,1]` before weighting. Any submetric that can exceed
   that range must be clipped **at definition**, not at the dimension level.
2. Dimension scores are in `[0,10]`; the overall total is in `[0,100]`.
3. A dimension's maximum is attainable by some real layout, not merely algebraic.
4. Normalisation is independent of the other layouts being compared — no
   within-batch scaling.

## Missing-submetric policy (new in R2)

Dropping a submetric and renormalising is **not** a neutral repair. A dimension
computed from 2 of 4 submetrics is a different quantity from one computed from
4, even though both land in `[0,10]`. Renormalising makes them numerically
comparable while hiding that they are not epistemically comparable.

The policy therefore has three parts.

**(a) Renormalise over present submetrics, and record coverage.**

```
Q_d = 10 · Σ_{k ∈ present} w_k m_k / Σ_{k ∈ present} w_k
```

Every dimension result additionally carries:

| Field | Meaning |
|---|---|
| `submetricsPresent` | which submetrics contributed |
| `submetricsMissing` | which were undefined, and why |
| `weightCoverage` | `Σ present w_k / Σ all w_k`, in `[0,1]` |

**(b) A minimum-coverage floor, below which the dimension is `null`.**
If `weightCoverage < COVERAGE_MIN`, the dimension does not get a number.
**Recommended `COVERAGE_MIN = 0.5`** — a dimension resting on less than half its
defined weight is not that dimension any more. This is a judgement call and is
exactly the kind of threshold that needs your sign-off rather than my default.

**(c) Coverage never silently propagates into the total.**
The overall score records the minimum `weightCoverage` across its six
dimensions. An analysis can then filter on it. A score computed from partial
dimensions is **not** interchangeable with a full one and must not be pooled
with full ones without a stated justification.

| Case | Proposed |
|---|---|
| One submetric undefined | Renormalise per (a); record coverage |
| Coverage below `COVERAGE_MIN` | Dimension is `null`; total is `null` (see **P4**) |
| All submetrics of a dimension undefined | Dimension is `null`, not 0 |
| Raw sum exceeds its algebraic maximum | Assert and fail loudly — a submetric broke its `[0,1]` contract |

## Endpoint policy (new in R2)

R1's sensitivity tests said "sweep a submetric 0→1". It never said what the
endpoints *mean*, and the endpoints are where most normalisation bugs live.

| Endpoint | Policy |
|---|---|
| `m_k = 0` | A real, measured minimum. **Distinct from missing.** A submetric that legitimately evaluates to 0 contributes 0 with full weight; it is not dropped. |
| `m_k = 1` | A real, measured maximum, and it must be **attainable by a constructible layout**, not merely algebraically. Each submetric ships with a witness fixture that attains it. |
| `Q_d = 0` | Attainable; asserted by a witness fixture per dimension. |
| `Q_d = 10` | Attainable; asserted by a witness fixture per dimension. This is what fails today for structure (max 9.33). |
| Open vs closed intervals | All submetric ranges are **closed** `[0,1]`. A submetric that can only approach an endpoint asymptotically must be reparameterised or have its attainable bound documented as such. |
| Clipping | Applied **at submetric definition**, never at the dimension level, so a clipped value is visible in `submetrics` rather than hidden inside `Q_d`. |
| Degenerate sweeps | If a sweep cannot reach an endpoint without making the layout unsupported (per **P4**), the test records the reachable range and the reason — it does not silently stop early. |

The practical consequence: "0 because measured" and "0 because absent" must be
distinguishable in every export. That is the same rule as **P4**'s, applied one
level down.

## Still blocked by this packet

The **overall weight set** (manuscript `0.09` variety with a `/0.90` divisor vs
code `0.19` with none) cannot be decided until normalisation is settled, because
the two questions interact: under `v0`, structure's effective contribution is
already `0.16 × 0.933` rather than `0.16`. Recorded as decision **G4**; its v1
test is skipped, not asserted.

## Proposed tests

*Invariance*
- Every dimension's attainable maximum equals exactly 10 for a **witness**
  layout, and its minimum exactly 0 for another. Both witnesses are fixtures,
  not assertions about algebra.
- Dropping an undefined submetric and renormalising gives the same score as a
  layout where that submetric is definitionally absent.
- A submetric measured at exactly 0 produces a different result from the same
  submetric being missing — asserted directly, since conflating them is the
  failure mode this policy exists to prevent.
- `weightCoverage` is 1.0 whenever all submetrics are present, and equals the
  expected fraction when some are dropped.
- A dimension below `COVERAGE_MIN` returns `null`, and the total returns `null`.

*Sensitivity*
- For each dimension, sweep one submetric 0→1 with others fixed; the dimension
  score must move linearly by exactly `10 × wₖ/Σw`.
- Re-run the matched random-position baseline
  (`scripts/baseline-distribution.mjs`) under v1 and report how the
  structured-vs-random delta changes. Currently: mean +5.17, p05 −0.92,
  min −9.92.

## Sign-off

| Field | |
|---|---|
| Chosen candidate | |
| Accept that all totals change | |
| Date | |
