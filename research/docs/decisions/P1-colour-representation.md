# Decision packet P1 — Colour representation

> **NOT AUTHORITATIVE.** `V1-SPECIFICATION.md` is the single authoritative
> specification for DOASA v1 and governs wherever this document conflicts with
> it. This file is retained as the **historical record of how the decision was
> reached**, and is no longer a sign-off surface.

> **SUPERSEDED IN PART by `V1-SPECIFICATION.md` (draft-2, 2026-09-13).**
> This packet remains the record of how the decision was reached. Where it
> conflicts with the specification, the specification governs. Superseded here:
> the lightness-monotonicity sensitivity test (corrected to single-sign-change).

**Status:** open · **Revision 2 (2026-09-13)** · **Blocks:** hierarchy, flow,
spatial, variety–harmony · **Tranche:** 1 (foundational)

> **Revision 2 corrects R1's test design.** R1 proposed asserting that the same
> colour in every supported notation yields *byte-identical* scores, and its
> worked example used `hsl(215, 28%, 17%)` as "the same colour" as `#1F2937`.
> That equality holds only by coincidence, and the test as written conflated two
> separate questions. See §"Test design, corrected".

## The question

What colour values does the model accept, and in what space are colour
comparisons made?

`v0` accepts hex only. `hexToRgb()` returns `{0,0,0}` for anything else, which
silently zeroes the saturation term in `getVisualWeight()` (feeding hierarchy
and flow) and the luminance term in `analyzeSpatial()` (feeding balance). The
`colorHarmony` preset emits `hsl(...)` strings, so the application routinely
produces colours its own scorer cannot read.

## Worked example

Run: `node scripts/worked-examples.mjs`

Two elements, one colour, three notations. `#1F2937` and `rgb(31, 41, 55)` are
**exactly** the same sRGB triple. `hsl(215, 28%, 17%)` is the *rounded* CSS form
of the exact `hsl(215, 27.907%, 16.863%)`; it happens to convert back to the
same triple, but see "Test design, corrected" — most rounded HSL notations do
not.

| Notation | total | spatial | hierarchy | balance degenerate |
|---|---|---|---|---|
| `#1F2937` | 35.8081 | 5.4797 | 2.2972 | no |
| `rgb(31, 41, 55)` | 36.1646 | 5.7768 | 2.2972 | **yes** |
| `hsl(215, 28%, 17%)` | 36.1646 | 5.7768 | 2.2972 | **yes** |

Note the direction: the *unparseable* notations score **higher**, because the
degenerate balance fallback (+10/10) more than offsets the lost luminance
weighting. The defect is not a penalty; it is an uncontrolled distortion.

## Candidates

**C1 — Parse a fixed notation set into sRGB.**
Accept `#rgb`, `#rrggbb`, `rgb()`, `hsl()`. Reject anything else at the input
gate. Comparisons stay in HSL as `v0` does.
*Cost:* small. *Risk:* keeps HSL's perceptual non-uniformity — equal HSL
distances are not equal perceived differences.

**C2 — Parse into sRGB, compare in CIELAB. (recommended)**
Same acceptance set, but colour *distance* (for grouping similarity and palette
coherence) uses ΔE in CIELAB, and lightness uses L\*.
*Cost:* ~40 lines, no dependency. *Benefit:* colour similarity becomes a
perceptual claim rather than an artifact of HSL's geometry — which matters
because the dimensions it feeds are claimed to model perception.

**C3 — Require a canonical colour object in the layout schema.**
Store `{space: 'srgb', r, g, b}` instead of a string; parsing happens at
authoring time.
*Cost:* schema migration, and it breaks the rule that archived states preserve
the original string. *Rejected* on that ground.

## Recommendation

**C2**, with the notation set of C1.

Rationale: the model's stated warrant for the colour terms is perceptual
(salience, harmony, palette coherence). HSL distance does not support that
warrant; CIELAB does, at negligible cost. Keeping the acceptance set explicit
also means an unsupported notation becomes a *rejected input* rather than a
silent black.

## Assumptions this commits you to

1. Colours are sRGB with a D65 white point.
2. The canvas background participates in contrast calculations (see **P2**, which
   defines the contrast reference).
3. Alpha is not supported; the element model has no opacity channel.
4. `hsl()` values are converted, not stored — **the archived layout keeps the
   original string verbatim**, per the serialization rule.

## Exceptional-case behaviour to approve

| Case | Proposed |
|---|---|
| Unsupported notation (e.g. `red`, `color(display-p3 ...)`) | Reject at the input gate. Do **not** score. Record a `non-parseable-color` finding. |
| Achromatic element (saturation 0) | Hue is undefined. Exclude from hue entropy; include in lightness measures. See **P4**. |
| All elements achromatic | Hue entropy is undefined, not 0. See **P4**. |
| Malformed but parseable-ish (`hsl(400, 120%, -5%)`) | Clamp and record a finding, or reject — **needs your call**. |

## Test design, corrected

R1's invariance test was **"the same colour in every supported notation produces
byte-identical scores"**, exemplified with `#1F2937` ≡ `hsl(215, 28%, 17%)`.

Two problems.

**1. The exemplar is equivalent only by luck.** The exact conversion is
`hsl(215, 27.907%, 16.863%)`. The CSS notation rounds to integer percentages,
and rounding usually lands in a *different* 1/255 bucket. Measured over 17,760
sampled sRGB triples (`node scripts/worked-examples.mjs`):

```
rounded-hsl round-trip failures: 15936 / 17760  (89.7%)

  rgb(0,0,13)  -> hsl(240,100%,3%)  -> rgb(0,0,15)    OFF BY (0,0,+2)
  rgb(0,0,26)  -> hsl(240,100%,5%)  -> rgb(0,0,25)    OFF BY (0,0,-1)
  rgb(0,0,39)  -> hsl(240,100%,8%)  -> rgb(0,0,41)    OFF BY (0,0,+2)
```

`#1F2937` is in the lucky 10.3%. A test built on it would pass today and break
the moment the exemplar changed — and would appear to indicate a parser bug when
it is really a rounding artifact.

**2. It conflates two questions.** "Do equivalent notations score equally?" and
"Does the parser convert correctly?" are different claims and need different
tests and different tolerances.

**Corrected design — three separate tests:**

| Test | Notations | Assertion |
|---|---|---|
| **T1 exact equivalence** | hex ↔ `rgb()` with integer components | **Byte-identical** scores. Both are exact sRGB byte triples; there is no rounding, so exactness is the right bar. |
| **T2 parser correctness** | `hsl()` → sRGB | Compare the parser against an independent reference conversion, asserting the returned **bytes**, not a score. |
| **T3 rounding tolerance** | `hsl()` with rounded components | Score difference is within a bound **derived** from the max RGB deviation, not a bound picked to make the test pass. The derivation must appear in the test. |

The palette in use happens to round-trip 8/8, so T1 and T2 cover the real
application; T3 exists because participants may enter arbitrary colours and
because `colorHarmony` emits `hsl()` with fractional hue and integer lightness.

## Other proposed tests

*Invariance*
- An unsupported notation is rejected at the gate, never silently blackened.
- Converting a layout between two **exactly** equivalent notations changes no
  score (T1 generalised).

*Sensitivity*
- Sweep one element's lightness 0→100 in steps of 5; record spatial and
  hierarchy. Expect monotone movement in balance, with no discontinuity.
- Sweep saturation 0→100; confirm the hierarchy term moves smoothly and that
  the achromatic endpoint is handled by the P4 rule, not by a 0 fallback.
- Confirm `colorHarmony` no longer degenerates balance for any seed
  (currently 100%, `scripts/color-defect-impact.mjs`).

## Sign-off

| Field | |
|---|---|
| Chosen candidate | |
| Exceptional cases approved | |
| Date | |
| Notes | |
