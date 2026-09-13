# Decision packet P4 — Exceptional cases

> **NOT AUTHORITATIVE.** `V1-SPECIFICATION.md` is the single authoritative
> specification for DOASA v1 and governs wherever this document conflicts with
> it. This file is retained as the **historical record of how the decision was
> reached**, and is no longer a sign-off surface.

> **SUPERSEDED IN PART by `V1-SPECIFICATION.md` (draft-2, 2026-09-13).**
> This packet remains the record of how the decision was reached. Where it
> conflicts with the specification, the specification governs. Superseded here:
> exclusion rule X8, which referenced the withdrawn COVERAGE_MIN.

**Status:** open · **Revision 2 (2026-09-13)** · **Blocks:** every dimension ·
**Tranche:** 1

> **Revision 2 adds trial-exclusion rules.** R1 handled what the *scorer*
> returns for a degenerate layout, but ended with a single line — "a trial whose
> layout is rejected is recorded as an excluded trial with a reason". That is a
> study-design decision, not a footnote: exclusion rules decided after seeing
> data are a well-known route to bias, and they must be fixed in advance.

## The question

What does the model return when a layout is degenerate, and what is the
difference between "zero", "undefined", and "unsupported"?

These three are currently conflated. `v0` returns `0` for an empty layout, `NaN`
for coincident elements, and fixed constants (`5.0`, `10.0`) for singletons —
with no way for a downstream analysis to tell a real zero from a missing value.

## Worked example

Run: `node scripts/worked-examples.mjs`

| Fixture | n | total | grouping | whitespace ratio |
|---|---|---|---|---|
| `empty` | 0 | `0` | `0` | 0.0000 |
| `allHidden` | 0 | `0` | `0` | 0.0000 |
| `singleton` | 1 | 65.6018 | `10` (constant) | 0.9887 |
| `coincident` | 3 | **`NaN`** | **`NaN`** | 0.9681 |
| `hugeOverlapping` | 3 | 48.6806 | 5.3033 | **−1.6516** |
| `offCanvas` | 2 | 55.4731 | `0` | 0.9563 |

Three distinct pathologies, three incompatible responses:

- `empty` returns **0**, which reads downstream as "maximally disordered". It is
  not — there is nothing to order.
- `coincident` returns **NaN** from `stdDev/avgDist` = `0/0`, which poisons the
  total.
- `singleton` returns **hard-coded constants** (hierarchy 5.0, grouping 10.0,
  flow 10.0) that are neither measured nor documented as defaults.

## Candidates

**E1 — Keep `v0` semantics.** Rejected: it makes "no data" indistinguishable
from "scored zero", which is the single most damaging thing a measurement
instrument can do to a downstream analysis.

**E2 — Three-valued result. (recommended)**

| Value | Meaning |
|---|---|
| a number | the model measured this |
| `null` | **undefined for this layout** — the quantity does not exist here |
| rejected at the gate | **unsupported input** — not scored at all |

`null` propagates: a dimension with any `null` submetric renormalises over the
rest (per **P3**); a dimension that is entirely `null` makes the total `null`.
**A `null` is never rendered as 0 in an export.**

**E3 — Minimum element counts per dimension.**
Each dimension declares the smallest `n` at which it is defined (grouping needs
≥2 distinct positions; flow needs ≥2; hierarchy needs ≥2). Below that, `null`.
Complements E2 rather than competing with it.

## Recommendation

**E2 + E3.**

Rationale: the brief's own rule — *"Do not compute missing results as zero"* —
cannot be honoured without a distinct representation for "missing". This is also
what makes the `v1` requirement "every supported layout produces finite scores"
achievable honestly: coincident elements stop producing `NaN` not because a
value was invented, but because the quantity is correctly reported as undefined.

## Proposed disposition per case

| Case | Disposition | Rationale |
|---|---|---|
| No elements at all | **Rejected at gate** — unsupported | There is no composition to score |
| All elements hidden | **Rejected at gate** — unsupported | Same |
| n = 1 | grouping `null`, flow `null`, hierarchy `null`; spatial and variety–harmony defined | Relational dimensions need a relation |
| All positions coincident | grouping `null` (dispersion undefined), others defined | Replaces the `0/0` → `NaN` |
| Two elements coincident, others not | grouping **defined** — the pair contributes distance 0 | Not degenerate overall |
| All elements achromatic | hue entropy `null`; lightness measures defined | Hue is undefined, not zero (links to **P1**) |
| Overlap drives union area > canvas | Impossible under union area (**P4** + **P2 C2**) | Current negative whitespace is an artifact of summing |
| All elements off-canvas | **Rejected at gate** — unsupported | Nothing visible |
| Zero-size element | **Rejected at gate** | Not renderable |

## Assumptions this commits you to

1. Whitespace uses **union** area clipped to the canvas, so the ratio is always
   in `[0,1]` — this supersedes `v0`'s summed-area behaviour and pairs with
   **P2 C2**.
2. "Unsupported" is decided *before* scoring, by the input gate, and is recorded
   as a rejection with findings — never as a score.
3. Export formats represent `null` explicitly (empty cell in CSV, `null` in
   JSON), and the data dictionary states that empty ≠ 0.
4. A trial whose layout is rejected is recorded as an **excluded trial with a
   reason**, not as a missing row.

## Open question for you

Rejecting empty and all-hidden layouts at the gate means the *editor* must not
call the scorer in those states, and the UI needs something to display. Options:
show "not scorable yet", or hide the score panel. This is a UI decision with a
study consequence — in the feedback-visible condition, whatever is shown is part
of the intervention and must be identical in wording across conditions.

## Trial-exclusion rules (new in R2)

A *scorer* rejecting a layout and a *study* excluding a trial are different
decisions. The first is deterministic and mechanical. The second affects what
gets analysed, and so must be **pre-specified, automatic, and auditable**.

### Principles

1. **Pre-registered.** Every exclusion rule below is fixed before any data is
   collected. No rule may be added, removed, or retuned after seeing outcomes.
2. **Mechanical.** Each rule is evaluated by code from recorded fields. No rule
   depends on a judgement made while looking at results.
3. **Outcome-blind.** No rule may reference a DOASA score, a rating value, or
   the direction of any effect. A rule that reads an outcome is not an exclusion
   rule; it is a filter on the result.
4. **Recorded, never deleted.** An excluded trial stays in the dataset with
   `excluded: true`, `exclusionRule`, and `exclusionDetail`. Exports include
   excluded rows. Deleting a trial is not exclusion; it is data loss.
5. **Reported.** Any analysis states counts per rule and reports the primary
   outcome with and without exclusions.

### Rules

| ID | Rule | Rationale | Decided by |
|---|---|---|---|
| `X1` | Layout unsupported at the input gate (empty, all hidden, all off-canvas, zero-size, unparseable colour) | Nothing to score or to judge | code, at collection |
| `X2` | Consent not completed, or withdrawn | Ethical requirement | code |
| `X3` | Practice trial | Not part of analysis by design | configuration |
| `X4` | Trial interrupted and not resumed within the configured window | Incomplete exposure | code, from event timestamps |
| `X5` | Required element inventory violated in a controlled task | The task constraint was not met | code, from recorded constraints |
| `X6` | Duplicate submission of the same `trial_id` | Idempotency artifact, not a second trial | code |
| `X7` | Session marked `pilot` | Pilot data is excluded from confirmatory analysis | configuration |
| `X8` | `weightCoverage` below `COVERAGE_MIN` (see **P3**) | The dimension is not that dimension any more | code |

### Explicitly NOT exclusion rules

| Not a rule | Why |
|---|---|
| "The rating looks careless" | Post-hoc judgement on an outcome |
| "The DOASA score is an outlier" | Reads the measure under test |
| "The participant disagreed with the tool" | **Disagreement is the finding**, not noise |
| "Response time was unusually short" | Defensible only as a **pre-registered** threshold with a stated value; otherwise post-hoc |

That third row matters most here. The whole point of RQ1 and RQ3 is to find
where the model and people diverge. Any rule that removes divergent cases
manufactures agreement, which the brief forbids.

### Attention checks

If attention or seriousness checks are wanted, they must be **designed in
advance** as explicit items with a pre-stated pass criterion, and their failure
becomes rule `X9`. Inferring inattention from response patterns after the fact
is not permitted.

## Proposed tests

*Exclusion rules*
- Every rule `X1`–`X8` is evaluated by a pure function of recorded fields, and a
  test asserts each fires on a constructed case and does not fire otherwise.
- No exclusion rule reads a score, a rating, or a dimension value — asserted by
  inspecting the rule functions' inputs, not by convention.
- An excluded trial is still present in every export, with its rule and detail.
- Counts per rule are reproducible from the exported data alone.

*Invariance*
- Every fixture in `test/fixtures/layouts.mjs` returns a number, an explicit
  `null`, or a gate rejection — never `NaN`, never `Infinity`.
- No export path ever writes `0` where the model returned `null`.
- Whitespace ratio is in `[0,1]` for every fixture, including `hugeOverlapping`.
- Adding a second element coincident with the first does not make grouping
  `null` for the whole layout.

*Sensitivity*
- Move two coincident elements apart in 1px steps; grouping must transition from
  `null` to a finite value without a discontinuity at the first non-zero
  distance.
- Hide elements one at a time from a 6-element layout down to 0; record at which
  `n` each dimension becomes `null`, and confirm it matches the declared minimum.

## Sign-off

| Field | |
|---|---|
| Chosen candidate | |
| Per-case dispositions approved | |
| Empty-layout UI behaviour | |
| Exclusion rules X1-X8 approved | |
| Attention checks wanted (X9)? | |
| Date | |
