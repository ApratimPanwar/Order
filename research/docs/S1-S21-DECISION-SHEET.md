# S1–S21 decision sheet

**For explicit investigator review. Nothing here is approved.**

Every row is implemented as a **development default** in
`core/scoring/v1-config.js`, carries `approvalStatus: 'development-candidate'`,
and is echoed into every score result. Approving an item means changing its
status in that file and recording the decision — approval is never inferred from
the value being present, from tests passing, or from silence.

Mark each row: **A** approve as proposed · **M** approve with modification
(state it) · **R** reject / needs discussion.

---

## Highest leverage — these move scores most

| # | Decision | Proposed | If you change it | A/M/R |
|---|---|---|---|---|
| **S5** | Dimension weights `W_d` | manuscript ÷0.90 → hierarchy .2222, grouping .2000, structure .1778, flow .1667, spatial .1333, variety **.1000** | Every total moves. v0 used **.19** for variety — nearly 2× — so this is the single largest lever in the model. | |
| **S12** | Hierarchy submetrics `m_h,1..3` | `m1 = (u₁−u₂)/(u₁+u₂)`, `m2 = (u₂−u₃)/(u₂+u₃)`, `m3 = 1−min(1,CV(u₃..ₙ))`, weights .5/.3/.2 | Heaviest dimension (.2222) and the manuscript defines **none** of these. Wholly my construction. | |
| **S3** | `ρ*` whitespace target | **0.40** whitespace (= 60% occupied) | Declares what coverage is optimal. Manuscript implies 0.5, v0 uses 0.4, neither cited. | |
| **S4** | `d*` diversity target | **0.50** | Midpoint of a normalised composite whose midpoint has no established meaning. | |
| **S1** | `κ` outline contrast factor | **0.50** | Sets how much an outlined element counts toward prominence. Invented. | |

## Parameters with an evidential basis

| # | Decision | Proposed | Basis | A/M/R |
|---|---|---|---|---|
| **S2** | Grid pitch / tolerance | **8px / 2px** (0.25·pitch) | The manuscript's 15px tolerance on an 8px pitch passes ~100% of positions — the submetric would be vacuous. Arithmetic, not taste. | |
| **S9** | DBSCAN `minPts` | **2** | DBSCAN requires the parameter; the manuscript omits it entirely. | |
| **S10** | `minElements`, `minDistinctPositions` | **4**, **2** | `minElements` follows from `m_h,3` needing a 2-element tail. `minDistinctPositions` follows from grouping dispersion being undefined at a single point. | |
| **S6** | Remove grouping containment | **remove** → 3 submetrics, equal weights | The element model has no container type; the construct has no referent. | |
| **S7** | Remove spacing regularity from harmony | **remove**, keep in spatial | Byte-identical to `m_p,2`; keeping both double-counts. | |
| **S8** | Relocate weighted balance to spatial | **relocate** | Manuscript places it in structure, v0 computes it in spatial. It cannot live in both. | |
| **S11** | `readingOrder` | **`ltr-ttb`**, recorded per study | Costs nothing and addresses a limitation the manuscript states about itself. | |

## Novel definitions with proposed defaults

| # | Decision | Proposed | Note | A/M/R |
|---|---|---|---|---|
| **S13** | Grouping `m_g,2`, `m_g,3` | similarity = ½·size-CV + ½·ΔE₀₀ to cluster Lab centroid; separation = `min(1, minInterGap/(3β))` | **0 clusters → all three = 0; exactly 1 cluster → `m_g,3` = 1.** Resolved consistently this pass. | |
| **S14** | Structure `m_s,1`, `m_s,3` | alignment = mean modal-bin share over 6 bbox anchor families, rescaled; proportional = `1−min(1,CV(√ratios))` | | |
| **S15** | Flow `m_f,2`, cost split | Kendall **τ-b** vs reading order, mapped to [0,1]; cost `0.5·dist/d_diag + 0.5·turn/π` | First step has turn cost **0**; zero-length segments excluded from `θ̄`. | |
| **S16** | Density grid `K` | **5** (5×5) | Now computed from **union** coverage, consistent with whitespace. | |
| **S17** | Variety components, `ΔE_ref` | hue entropy /log(12), scale CV, shape entropy /log(4); harmony = modular fit + palette coherence; `ΔE_ref = 50` | Greyscale scores hue diversity **0** — a measured value, and such layouts remain scorable. | |
| **S19** | `τ_m` modular tolerance | **0.10 relative** to the module `m₀` | ±8px at `m₀ = 80`. Relative, not absolute pixels. | |
| **S20** | `τ_a` alignment tolerance | **5px** (0.01·min(W,H)) | | |
| **S21** | Shared target-seeking form | `1 − (r<t ? (t−r)/t : (r−t)/(1−t))` | Used by `m_p,1` and `m_v,1`. Reduces **exactly** to the manuscript's `1−2\|r−0.5\|` at t=0.5, so accepting it preserves continuity with the published form. | |

## S18 — resolved this pass, still needs sign-off

| Sub-decision | Proposed | Evidence | A/M/R |
|---|---|---|---|
| Circle approximation | 64-gon, **area-matched** (radius ×1.000804) | Area error **0 by construction**; radial +0.080%/−0.040%. Inscribed-64 is 0.1205% radial / 0.1606% area. The spec's old `<0.03%` was the **128**-gon figure. | |
| Area basis | **occupied footprint**, not rendered ink | An outlined element counts the same as a filled one — ≈**6.7×** its rendered ink for a size-80 square. Named `unionFootprintArea` throughout. | |
| Union method | sampled at `unionGridN = 512` | Measured error **<1%** against an exactly-known 40000px² square; refining the grid does not worsen it. Tested, not assumed. | |

---

## Two things worth deciding together

**S3 and S5 interact.** `ρ*` sets where spatial peaks; `W_d` sets how much
spatial matters. Changing one without the other can move the total in a
direction neither choice intended.

**S12 is the weakest link.** It is the heaviest dimension and the least
grounded — the manuscript gives no definitions at all, so all three submetrics
are mine. If you want to narrow v1 rather than approve invented definitions,
hierarchy is the dimension to narrow first.

---

## Sign-off

| | |
|---|---|
| Reviewed by | |
| Date | |
| Items approved as proposed | |
| Items approved with modification | |
| Items rejected / deferred | |
| Narrowing decision (if any) | |

Once signed, update `approvalStatus` in `core/scoring/v1-config.js` for the
approved items and re-run `npm test` — the test
*"an approved-looking config cannot appear by accident"* will need updating at
that point, deliberately, as the record of the decision.
