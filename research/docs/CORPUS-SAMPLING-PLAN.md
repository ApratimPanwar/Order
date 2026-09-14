# Participant corpus — proposed sampling plan

**Status: PROPOSED. Not approved. No participant corpus has been generated.**

This document describes the structure of the corpus for investigator approval.
It deliberately contains no seeds, no secret namespace and no stimulus
identifiers: those exist only in the private directory, outside every git work
tree, once an approved plan is built.

A separate, small **rehearsal corpus** is built with the same code for the live
acceptance run. It uses its own secret namespace, so the rehearsal stimuli
published during testing are never the stimuli participants will see.

---

## 1. What must not be reused

| Excluded | Why |
|---|---|
| The 13 development stimuli in `research/study/stimuli/` | Their key, with conditions and scores, is publicly readable in `ApratimPanwar/Order` history |
| The deliberately unscorable 3-element item | It exists to demonstrate a software rule. There is no study reason to include it; the builder refuses it unless the plan records one |
| Any layout from generator seeds 1–20000 | Those seeds and their layouts are published as evidence in `results/` |
| Scores from revision 1 of the scorer | Superseded; see `docs/SCORER-REVISIONS.md` |

---

## 2. Proposed design

**Unit: a matched pair.** Each pair holds the element inventory and every
non-position attribute fixed:

- **grid source** — `strict-grid` applied to a freshly generated layout;
- **position twin** — the same elements with positions redrawn inside the
  region the preset clamps to (`baseline-2`).

This is exactly the construction behind the 2,000-pair evidence in
`results/matched-comparison-v1r2/`, so the human ratings bear directly on the
question that evidence raises: does the study scorer order these pairs the way
people do?

| Parameter | Proposed value | Rationale |
|---|---|---|
| Pairs | **24** (48 stimuli) | About 15–20 minutes at roughly 20 s per stimulus including the optional note. Fewer pairs give little resolution per stratum; more lengthen sessions and fatigue |
| Element count | **6–14 visible elements** | Excludes near-empty layouts where the grid is barely visible, and very dense ones where the preset collides elements |
| Unsupported layouts | **Excluded from the frame** and counted | A pair is only informative for model agreement if both members are scored |
| Candidate frame | **5,000** fresh draws | Enough that every stratum below is filled without exhausting it |
| Strata by study-scorer Δ = total(source) − total(twin) | 6 pairs Δ ≤ 0 · 6 in the lowest positive tertile · 6 in the middle · 6 in the highest | Reversals are rare in the population (§3). Simple random sampling of 24 pairs would usually contain one or two, too few to observe disagreement. Stratifying oversamples them deliberately |
| Selection inside a stratum | Seeded uniform draw without replacement, from the private namespace | Reproducible by the researcher, not by anyone else |
| Presentation | All 48 stimuli, one seeded random order per participant (the instrument's existing behaviour) | No change to the audited instrument |
| Unsupported test item | **Not included** | No study reason |

### Consequences that must be accepted with the design

1. **Stratification changes the estimand.** Because reversals are oversampled,
   the raw proportion of human–model agreement in this corpus is **not** an
   estimate of the population proportion. Population-level statements need
   per-stratum weights, recorded in `corpus-report.json`. Pre-register the
   weighted analysis or the per-stratum analysis before collection.
2. **Pair members share an inventory.** Participants see both members of a pair,
   so they may recognise the pairing, which could anchor the second rating on the
   first. The alternative — counterbalanced lists, each participant seeing one
   member — halves the within-person comparison and needs an instrument change
   and a new package. **Decision required.**
3. **Scores are recomputable.** The scorer is public and every stimulus is
   served to participants, so a participant who runs the scorer on a stimulus
   can recompute its score. Keeping the key private protects the pairing, the
   stratum assignment and the records; it does not make scores secret.
4. **Conditions are visible by design.** A grid-structured layout looks
   structured. That is the manipulation, not a leak.

---

## 3. Evidence the design responds to

From `results/matched-comparison-v1r2/summary.json` (study scorer, revision 2,
seeds 1–2000, same construction). The figures are reproduced in
`docs/SCORER-REVISIONS.md` together with their definitions. The archived v0 figure
(1,860 / 2,000) is a different scorer and is not used here.

---

## 4. Open decisions (also in the approval sheet)

- Accept 24 pairs, or give another count, with a sample-size rationale (§5).
- Accept the four strata, or use simple random sampling of pairs.
- Within-subject presentation of both members, or counterbalanced lists.
- Element-count range.
- Whether an attention-check item is required. It would be a protocol addition,
  so it needs its own approval and its own package.

## 5. Sample size

Not proposed here, because it depends on the primary analysis, which is not yet
approved. For orientation only: if the primary outcome were the per-pair sign of
the mean human rating difference, and the analysis compared stratum-wise
agreement rates, the unit of analysis is the pair (24), and additional
participants tighten each pair's mean rather than adding pairs. If the primary
analysis is instead a mixed model over ratings with participant and stimulus
random effects, participant count matters directly. The approval sheet asks for
the chosen analysis and its power rationale; nothing here should be read as one.

---

## 6. How an approved plan is built

```bash
# the private directory must be OUTSIDE any git work tree; the builder refuses otherwise
node scripts/build-study-corpus.mjs --private-dir <private>/study-1 --label study-1
```

`<private>/study-1/corpus-plan.json` must carry `"purpose": "study"` and
`"status": "approved"`, or the builder refuses. Outputs: public stimuli in
`<private>/study-1/public-staging/`, and the key and frame report beside them,
never inside a repository.
