# DOASA v1 + blind-rating instrument — implementation handoff

**Branch:** `feature/doasa-v1-research-instrument`
**Status:** development implementation. **Not approved, not recruiting, not deployed.**

> **The v1 model is a DEVELOPMENT CANDIDATE.** None of the 21 sign-off items
> (S1–S21) has explicit approval. Every score it produces is stamped
> `DEVELOPMENT CANDIDATE - NOT APPROVED` in the result object itself.

---

## 1. What is actually approved

| Item | Status | Evidence |
|---|---|---|
| `renderer-2` for new stimuli | **Approved** (2026-09-13, as a design direction) | stated in the request |
| Six-dimensional successor model | **Approved** (design direction) | stated in the request |
| Fixed complete-score primary analysis | **Approved** (design direction) | stated in the request |
| Development implementation | **Approved** (this request) | stated in the request |
| **S1–S21 parameter/definition items** | **NOT approved** | no explicit sign-off has been given |
| Participant recruitment | **NOT approved** | explicitly excluded |
| Confirmatory study launch | **NOT approved** | explicitly excluded |
| Manuscript changes | **NOT approved** | explicitly excluded |

Approval is **not** inferred from silence, from a document heading, from the
existence of code, from tests passing, or from the earlier Group B/C triage —
that automatic-approval language was removed at your instruction.

### The other assistant's artifacts

`DEVELOPMENT.md`, the candidate implementation and the source ZIP **could not be
found on this machine.** Searched: the project tree, `Desktop`, `Documents`,
`Downloads`, and a filesystem-wide scan for `DEVELOPMENT.md` and Order-related
archives. Nothing matched.

**Nothing from them was reused, because nothing was available to review.** This
implementation was written against `V1-SPECIFICATION.md` directly. If those files
exist elsewhere, they remain unreviewed and their test results and authorization
statements carry no weight here.

---

## 2. Scientific decisions still awaiting approval

All 21 remain open. Implemented values are **development defaults**, labelled in
`core/scoring/v1-config.js` and echoed in every score result.

| # | Decision | Implemented default | Consequence if changed |
|---|---|---|---|
| **S5** | Dimension weights `W_d` | manuscript ÷0.90 (variety 0.10) | Largest single lever; every total moves |
| **S12** | Hierarchy submetrics `m_h,1..3` | normalised rank gaps + tail CV | Heaviest dimension; manuscript defines none |
| **S3** | `ρ*` whitespace target | 0.40 (whitespace, not ink) | Shifts what counts as optimal coverage |
| **S4** | `d*` diversity target | 0.50 | Shifts the variety optimum |
| **S1** | `κ` outline contrast factor | 0.50 | Changes prominence of outlined elements |
| **S2** | grid pitch / tolerance | 8px / 2px | Manuscript's 15px on 8px is vacuous |
| **S9** | DBSCAN `minPts` | 2 | Changes cluster formation |
| **S10** | `minElements` | 4 | Sets which layouts are scorable at all |
| **S11** | `readingOrder` | `ltr-ttb`, recorded | Cultural assumption |
| **S13–S17** | grouping / structure / flow / spatial / variety definitions | see §3–§8 of the spec | Novel definitions |
| **S18** | circle approximation + area basis | `circleFacets 64`, **area-matched**, **occupied footprint** | See below |
| **S19** | `τ_m` | 0.10 **relative** to the module | |
| **S20** | `τ_a` | 5px | |
| **S21** | shared target-seeking form | range-normalised piecewise | Reduces to the manuscript form at 0.5 |
| **S6–S8** | removals/relocation | containment removed; spacing-regularity removed from harmony; balance relocated to spatial | |

### S18 resolved explicitly, as requested

- **Circle approximation:** regular 64-gon, **area-matched** (radius scaled by
  `1.000804`). Area error is **zero by construction**; radial error
  `+0.080% / −0.040%`. The inscribed alternative at 64 has radial `0.1205%` and
  area `0.1606%` — the spec's earlier `< 0.03%` was the *128*-gon figure.
- **Area basis:** **occupied footprint**, not rendered ink. An outlined element
  counts exactly as much as a filled one of the same size — roughly **6.7×** its
  actual rendered ink for a size-80 square. Named `unionFootprintArea` /
  `occupiedFootprint` throughout. `renderedInk` remains a future alternative.

Both are still development defaults pending your sign-off.

---

## 3. Specification → implementation checklist

| Spec | Requirement | Implementation | Verified by |
|---|---|---|---|
| §1.1 | anchor / rotationCentre / scoringCentroid kept distinct | `core/geometry.js` — three named functions | `v1.test.mjs` "scoringCentroid separates anchor…" |
| §1.2 | renderer-2, exact `√3` triangle | `localVertices()` | "INVARIANCE: renderer-2 triangle at 120/240" |
| §1.3 | scoringCentroid corrects renderer-1 triangles | `scoringCentroid()` | same test, both renderers |
| §1.4 | rotation periods; circle excluded | `rotationPeriod()`, circles ignore rotation in `toPolygon` | "rotation periods follow the renderer" |
| §1.4 | `showArrows` hard gate | `checkApplicability()` | "showArrows is a hard gate" |
| §1.5 | clipping, footprint union | `clipToRect`, `unionFootprintArea` | "overlap never produces negative whitespace" |
| §1.6 | colour parse / CIELAB / ΔE00 / WCAG | `core/color.js` | 4 reference tests incl. Sharma CIEDE2000 pairs |
| §2 | applicability gate, no partial reweighting | `checkApplicability`, fixed weights | "aggregation uses FIXED weights…" |
| §2.3 | Invariant R (all submetrics in [0,1]) | `clip01` at every definition | "PROVEN BOUNDS" over 600 layouts |
| §2.3 | Invariant T (total on domain) | documented edge cases | "coincident elements do not produce NaN" |
| §3 | hierarchy prominence + 3 submetrics | `prominence()`, `m_h,1..3` | bounds + fixed-weight tests |
| §4 | DBSCAN, equivalent-disc gap, 3 submetrics | `dbscan()`, `m_g,1..3` | "ONE cluster" / "ZERO clusters" |
| §4 | **0 clusters → 0; 1 cluster → 1** | explicit branches | both tests assert exactly this |
| §5 | alignment / grid / proportional | `m_s,1..3` | bounds tests |
| §6 | scanpath, zero-length segments, first-step turn cost 0 | `m_f,1..3` | bounds + determinism |
| §7 | whitespace on `r_ws`, range-normalised | `targetFit(rWs, ρ*)` | "targetFit reduces to the manuscript form" |
| §8 | **greyscale scorable, hue diversity 0** | `chromaThreshold` branch | "GREYSCALE layouts are scorable" |
| §9 | fixed aggregation, `[0,100]` | `dim()` + `W` | "aggregation uses FIXED weights" |
| §10 | bounds / fixtures / extrema separated | three distinct tests | "PROVEN BOUNDS", "CONSTRUCTED FIXTURE", "SAMPLED EXTREMA" |
| §11 | approval status in every result | `approvalRecord()` | "an approved-looking config cannot appear by accident" |

**Not implemented** (out of scope for this milestone): the controlled
three-condition design-task platform; a server collection endpoint.

---

## 4. Running it

```bash
cd research
npm test                              # 134 tests
node scripts/verify-specification.mjs --self
node scripts/build-stimuli.mjs --n 12 # rebuild the stimulus set
node scripts/baseline-distribution.mjs --n 2000
```

The rating app is a static page. Serve **`research/study/` as the root** so
`study-private/` is unreachable:

```bash
python -m http.server 8761 --directory Order/research/study
```

Then open `http://localhost:8761/index.html`.

Offline join, after a participant downloads their file:

```bash
node scripts/join-responses.mjs <export.json> --out joined.json
```

---

## 5. Data-handling rules enforced in code

- **No collection endpoint exists.** `session.js` has no network transport.
  The export record carries `transmitted: false` and
  `mechanism: 'local-download-only'`. A download is never called a submission.
- **Researcher key is outside the participant bundle.** `study-private/` is a
  sibling of `study/`. Verified in a real browser: all four probe paths returned
  **404**.
- **No identifying information.** Pseudonymous `p-<16 hex>` only; a test asserts
  no `email` / `name` / `ip` / `userAgent` / `fingerprint` key exists.
- **Response exports are gitignored** (`research/.gitignore`).
- **A rating survives an unscorable layout**: `trialValid` and
  `analysisEligible.ratingOnly` stay true; only `modelAgreement` goes false.

---

## 6. Remaining work before participant collection

1. **Sign off S1–S21**, or narrow v1 and record what is excluded.
2. **Fix concurrent-tab writes.** Verified last-write-wins with no coordination:
   a rating made in one tab can be silently replaced by another. **Blocker.**
3. **Ethics/consent review.** The current text is a development
   *acknowledgement*, not participant consent for a research study.
4. **Decide collection infrastructure**, or accept download-only and document
   how files reach the researcher.
5. **Freeze the specification** (§12) and stamp a `spec_freeze_id`.
6. **Pilot with non-participants** to check instructions and wording.
7. **Wider browser coverage** — only Chromium 152 was tested.
8. **Confirm the stimulus set**: size, conditions, and whether the
   deliberately-unscorable item belongs in the real set.

Completing 1–8 gets to *pilot-ready*. It does not establish that DOASA measures
perceived order; that requires the rating study itself.
