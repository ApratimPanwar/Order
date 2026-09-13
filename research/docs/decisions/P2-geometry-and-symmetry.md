# Decision packet P2 — Geometry, symmetry, and the rotation origin

> **NOT AUTHORITATIVE.** `V1-SPECIFICATION.md` is the single authoritative
> specification for DOASA v1 and governs wherever this document conflicts with
> it. This file is retained as the **historical record of how the decision was
> reached**, and is no longer a sign-off surface.

> **SUPERSEDED IN PART by `V1-SPECIFICATION.md` (draft-2, 2026-09-13).**
> This packet remains the record of how the decision was reached. Where it
> conflicts with the specification, the specification governs. Superseded here:
> the "perceptual tolerance" of 1e-3*size (corrected to an exact numerical tolerance).

**Status:** open · **Revision 2 (2026-09-13)** · **Blocks:** structure,
variety–harmony, hierarchy, spatial · **Tranche:** 1

> **Revision 2 corrects revision 1.** R1 asserted a 120° symmetry period for
> triangles on the reasoning that `area = s²√3/4` implies equilateral. The
> triangle *is* equilateral — but R1 never checked the **rotation origin**, and
> under the shipped renderer a triangle is **not** invariant at 120°. R1 also
> proposed "fold by period, then circular statistics" without specifying the
> fold, which is the part that determines whether the statistic is correct.

## 1. What the renderer actually does

`Element.draw()` (index.bf617e4.html L1449–1490):

```js
ctx.translate(this.x, this.y);
ctx.rotate(this.rotation * Math.PI / 180);
```

**Rotation is about the stored `(x, y)`** — whatever point the shape's local
geometry happens to be drawn around. So the symmetry period of each shape is a
property of its *drawing offsets*, not of the shape in the abstract.

| Shape | Local geometry | Drawn about |
|---|---|---|
| circle | `arc(0, 0, size/2, 0, 2π)` | its centre |
| square | `fillRect(-size/2, -size/2, size, size)` | its centre |
| rectangle | `fillRect(-size/2, -size2/2, size, size2)` | its centre |
| triangle | `moveTo(0, -0.433s)`, `lineTo(-0.5s, 0.433s)`, `lineTo(0.5s, 0.433s)` | **its bounding-box centre** |

### The triangle

Vertices `(0, −0.433s)`, `(−0.5s, +0.433s)`, `(+0.5s, +0.433s)`.

- Base `s`, height `0.866s = s√3/2` → **equilateral**, and
  `area = ½ · s · 0.866s = 0.433s² = s²√3/4`, matching `getArea()`.
- Vertex distances **from the draw origin**: `0.4330`, `0.6614`, `0.6614` —
  **unequal**, so the origin is not the centroid.
- Centroid is at `(0, +0.1443s)`. Distances from *there*: `0.5774` × 3 — equal,
  confirming equilateral about the centroid.
- The draw origin is the **bounding-box centre** (y spans `−0.433s … +0.433s`).

Verified by `node scripts/worked-examples.mjs`:

```
                     about draw-origin        about centroid
            exact(1e-9)  perceptual(1e-3)   exact(1e-9)  perceptual(1e-3)
rot  90deg     false           false          false           false
rot 120deg     false           false          false            true
rot 180deg     false           false          false           false
rot 240deg     false           false          false            true

square  90deg about draw-origin: true  (exact)
rect   180deg about draw-origin: true  (exact)
rect    90deg about draw-origin: false (exact)
```

**A third finding, at two tolerances.** The renderer writes the literal `0.433`,
but `√3/4 = 0.4330127`. The drawn triangle is therefore equilateral only to
**~1.3e-5 of its side length**. Squares and rectangles are exactly symmetric
(their offsets are exact halves); triangles are only approximately so, even
about the centroid.

Consequences:

- Any triangle invariance test must use a **perceptual** tolerance (1e-3 × size
  is comfortably sub-pixel at every size the application allows, 20–200px), not
  machine epsilon. A test written at `1e-9` would fail for a reason that has
  nothing to do with the model.
- If `renderer-2` is adopted (§4), it should also replace `0.433` with `√3/4`,
  so the symmetry becomes exact rather than merely sub-pixel.

**Corrected period table — shipped renderer:**

| Shape | Period | Consequence for scoring |
|---|---|---|
| circle | none (continuous) | rotation must be **excluded** |
| square | **90°** | fold rotation mod 90 |
| rectangle | **180°** | fold rotation mod 180 |
| triangle | **360° — no symmetry** | rotation is fully visible; do **not** fold |

## 2. Why v0's rotation statistic is wrong in *both* directions

`analyzeHarmony` takes an arithmetic mean and SD over raw degrees. R1 reported
only the wraparound failure. The full picture is worse.

`node scripts/angular-stats-demo.mjs`:

```
case                                            shape      v0 linear   period-aware
squares at 0/90/180/270 (identical on screen)   square        0.4410        1.0000
squares at 350/10/0   (20deg spread)            square        0.0962        0.8440
squares at 0/45/90    (real 45deg spread)       square        0.7959        0.3333
rects   at 0/180      (identical on screen)     rectangle     0.5000        1.0000
rects   at 0/90       (visibly different)       rectangle     0.7500        0.0000
circles at 37/211/298 (identical on screen)     circle        0.3972        1.0000
```

Two distinct failure modes:

- **Under-rates identical orientations.** Four squares at 0/90/180/270 are
  pixel-identical; v0 calls them 0.44 consistent.
- **Over-rates genuinely different ones.** A rectangle at 0° and one at 90° are
  portrait vs landscape — maximally inconsistent — and v0 calls them 0.75.

So this is not a wraparound edge case. The statistic is not measuring
orientation agreement at all.

## 3. Period-aware circular statistics — the specification R1 omitted

For a shape with period `p` degrees, scale angles by `k = 360/p` so one period
maps onto a full turn, then take the **mean resultant length**:

```
R = | (1/n) · Σ exp(i · k · θ_j) |          consistency = R,  dispersion = 1 − R
```

`R = 1` means "orientations indistinguishable"; `R = 0` means maximally spread
within the period. This is the standard treatment of axial data (`p = 180`
reduces to the familiar angle-doubling). Reference implementation:
`scripts/angular-stats-demo.mjs`.

Per-shape handling:

| Shape | `p` | `k` | Treatment |
|---|---|---|---|
| circle | — | — | excluded from the statistic entirely |
| square | 90 | 4 | `R` over `4θ` |
| rectangle | 180 | 2 | `R` over `2θ` |
| triangle | 360 | 1 | `R` over `θ` (no folding) |

**Mixed-shape layouts need a decision (P2-D below).** Folding by different `k`
per shape means the resulting angles are not commensurable, so a single `R`
across a mixed layout is not well defined.

## 4. The renderer question

The triangle's bounding-box-centred drawing is almost certainly unintended — it
is the only shape not drawn about its own centroid, and it makes triangles
behave differently from every other shape under rotation.

**Proposal: `renderer-2`, centroid-centred, separately versioned.**

Shift the triangle's local geometry up by its centroid offset:

```js
// renderer-1 (shipped)        // renderer-2 (proposed)
moveTo(0,     -0.433s)         moveTo(0,     -s/Math.sqrt(3))        // -0.57735s
lineTo(-0.5s,  0.433s)         lineTo(-0.5s,  s/(2*Math.sqrt(3)))    // +0.288675s
lineTo( 0.5s,  0.433s)         lineTo( 0.5s,  s/(2*Math.sqrt(3)))    // +0.288675s
```

Under `renderer-2` the triangle's period becomes a genuine **120°**, and using
exact expressions rather than the rounded `0.433` makes that symmetry exact
instead of sub-pixel.

**This is not behaviour-neutral and must not be folded into a scorer change:**

- It **moves pixels**. Every triangle shifts by `0.1443 · size` (≈9px at
  size 60). Archived layouts render differently than when they were made.
- It changes what a stored `rotation` means for triangles.
- Bounding boxes change, so any clipping rule (§5) changes with it.

Therefore: `renderer_version` joins `model_version` and `config_version` in
every study record; archived layouts keep the renderer version they were
authored under; and a layout must never be re-rendered under a different
renderer version without relabelling. Ordering matters too — **choose the
renderer before collecting stimuli**, because changing it afterwards invalidates
every rating already gathered.

## 5. Element extent — unchanged from R1

| Candidate | |
|---|---|
| C1 | Analytic area, unclipped (v0 behaviour) |
| **C2 (recommended)** | **Clip to canvas**; area is the visible part |
| C3 | Rasterised coverage — most faithful, but makes scoring depend on the renderer, breaking the "scoring never depends on rendering" invariant. Not recommended. |

Note C2 interacts with §4: clipping uses the bounding box, which moves for
triangles under `renderer-2`.

## 6. `showArrows` — a qualification R1 missed

`draw()` renders a direction arrow in local coordinates when `showArrows` is
true (L1479–1490). **With arrows on, rotation is visible for every shape,
including circles.** Every rotation-invariance claim in this packet holds only
for `showArrows === false`.

`renderer.showArrows` is already part of the canonical layout schema. It must be
forced off for any scored or rated layout, and that must be asserted, not
assumed.

## 7. Decisions requested

| # | Decision | Recommendation |
|---|---|---|
| P2-A | Adopt the corrected period table (§1)? | Yes |
| P2-B | Exclude circle rotation from scoring while retaining it in state? | Yes |
| P2-C | Adopt period-aware `R` (§3) in place of linear mean/SD? | Yes |
| P2-D | Mixed-shape layouts: (i) compute `R` per shape class and aggregate weighted by count; (ii) one global `R` with `k=1`; (iii) restrict the statistic to the modal shape class | **(i)** — it is the only option that respects each shape's own period |
| P2-E | Adopt `renderer-2` (centroid-centred triangle)? If yes, before any stimulus collection | **Yes, and decide now** |
| P2-E2 | If `renderer-2`: also replace the literal `0.433` with exact `√3` expressions? | Yes — makes the symmetry exact rather than sub-pixel |
| P2-F | Element extent: C1 / **C2** / C3 | C2 |
| P2-G | Assert `showArrows === false` for every scored layout? | Yes |

## 8. Assumptions this commits you to

1. Rotation is meaningful for squares, rectangles and triangles, and meaningless
   for circles, **given `showArrows === false`**.
2. The triangle is equilateral — **confirmed from the vertices**, no longer an
   assumption — but only to ~1.3e-5 of side length under the shipped literal.
3. A "visible" element is `visible === true` **and** has non-zero clipped area.
4. Rotation stays in the layout state for every shape; exclusion is a scoring
   decision, not a data-retention one.
5. Under P2-D(i), a layout with one shape class per element has `R` undefined
   per class — this routes into **P4**'s undefined-value policy, not to 0.

## 9. Proposed tests

*Invariance*
- Rotating a circle by any angle changes no score.
- Rotating a square by exactly 90/180/270° changes no score.
- Rotating a rectangle by exactly 180° changes no score.
- Rotating a rectangle by 90° **does** change the score (negative control).
- Under `renderer-1`, rotating a triangle by 120° **does** change the score;
  under `renderer-2`, it does not. Both directions asserted.
- Triangle invariance is asserted at a **perceptual** tolerance (1e-3 × size),
  with a comment stating why machine epsilon is the wrong bar. If `renderer-2`
  adopts exact `√3` expressions, tighten this to exact and assert that too.
- With `showArrows === true`, every invariance above is expected to fail — the
  test asserts that the guard rejects such a layout rather than scoring it.

*Sensitivity*
- Sweep a square 0→90° in 5° steps: `R` declines then returns to 1.0 at 90°,
  continuously and without discontinuity.
- Sweep the wraparound fixture's circular spread 0→p: the rotation term must
  decline monotonically in **circular** spread, not in linear SD.
- Re-run `scripts/angular-stats-demo.mjs` and assert every row of the §2 table.

## Sign-off

| Field | |
|---|---|
| P2-A period table | |
| P2-B exclude circle rotation | |
| P2-C period-aware R | |
| P2-D mixed-shape aggregation | |
| P2-E renderer-2 (decide before stimulus collection) | |
| P2-F element extent | |
| P2-G showArrows guard | |
| Date | |
