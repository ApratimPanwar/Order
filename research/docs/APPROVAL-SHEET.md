# Investigator approval sheet — ORDER blind-rating study

**Every field below is UNAPPROVED.** Nothing in this repository, no test result
and no deployment records an approval. A participant release cannot be built
until the decisions are recorded in `approvals.json` in the private directory
(format at the end) — the release builder refuses otherwise.

For each row give: **A** approve as proposed · **M** approve with modification
(state it) · **R** reject / discuss. Leave blank anything not yet decided; blank
stays unapproved.

---

## 1. Scoring model

### 1.1 S1–S21

Full rationale per item: `docs/S1-S21-DECISION-SHEET.md`.

| # | Decision | Proposed | A / M / R | Modification |
|---|---|---|---|---|
| S1 | Outline contrast factor κ | 0.50 | | |
| S2 | Grid pitch / tolerance | 8 px / 2 px | | |
| S3 | Whitespace target ρ* | 0.40 | | |
| S4 | Diversity target d* | 0.50 | | |
| S5 | Dimension weights | .2222 / .2000 / .1778 / .1667 / .1333 / .1000 | | |
| S6 | Remove grouping containment | remove | | |
| S7 | Remove spacing regularity from harmony | remove | | |
| S8 | Weighted balance in spatial | relocate | | |
| S9 | DBSCAN minPts | 2 | | |
| S10 | minElements, minDistinctPositions | 4, 2 | | |
| S11 | Reading order | ltr-ttb | | |
| S12 | Hierarchy submetrics | as specified | | |
| S13 | Grouping similarity / separation | as specified | | |
| S14 | Structure alignment / proportion | as specified | | |
| S15 | Flow τ-b vs reading order; cost split | τ-b; 0.5 / 0.5 | | |
| S16 | Density grid K | 5 | | |
| S17 | Variety components, ΔE_ref | as specified; 50 | | |
| S18 | Circle approximation, area basis, union method | area-matched 64-gon; footprint; N = 512 | | |
| S19 | Modular tolerance τ_m | 0.10 relative | | |
| S20 | Alignment tolerance τ_a | 5 px | | |
| S21 | Shared target-seeking form | as specified | | |

### 1.2 Scorer revision 2 — new since the S1–S21 sheet

Evidence: `docs/SCORER-REVISIONS.md`.

| # | Decision | Proposed | A / M / R | Modification |
|---|---|---|---|---|
| R2-1 | Canonical element order: ties broken by (y, x, type, size, size2, rotation, R, G, B, filled), never by array position | adopt | | |
| R2-2 | Kendall τ-b joint-tie correction | adopt (textbook definition) | | |
| R2-3 | Revision-1 records stay labelled `v1-development-candidate` and are never rewritten | adopt | | |

---

## 2. Study design

| Field | Proposed / current state | Decision |
|---|---|---|
| Study purpose (one sentence) | *not proposed — investigator to state* | |
| Research question and hypotheses | *not proposed* | |
| Corpus design | 24 matched pairs (grid source vs position twin) — `docs/CORPUS-SAMPLING-PLAN.md` | |
| Strata | 6 Δ ≤ 0 · 6 / 6 / 6 across positive-Δ tertiles | |
| Element count range | 6–14 visible elements | |
| Presentation | both pair members to every participant, seeded random order | |
| Attention check | none proposed (adding one needs a new package) | |
| Deliberately unsupported item | excluded (no study reason) | |
| Final stimuli | *not generated — built only from an approved plan* | |
| Participant inclusion criteria | *not proposed* | |
| Participant exclusion criteria | *not proposed* | |
| Recruitment route | *not proposed* | |
| Target sample size | *not proposed* | |
| Sample-size rationale / power analysis | *not proposed — depends on the primary analysis* | |
| Primary outcome | *not proposed* | |
| Primary analysis (pre-registered model, handling of strata weights, exclusions) | *not proposed* | |
| Secondary analyses | *not proposed* | |
| Exclusion rules applied at analysis (X1 integrity, X2 withdrawn, X3 rehearsal, X4 withdrawn after upload, others?) | X1–X4 implemented | |
| Browsers permitted by the protocol | *not proposed*; tested so far: Chromium only | |
| Pre-registration (where, when) | *not proposed* | |

---

## 3. Ethics, consent and participant wording

| Field | Current state | Decision |
|---|---|---|
| Review body | *unknown* | |
| Review status (approved / exempt / pending / not submitted) and reference number | *not submitted as far as this repository knows* | |
| Participant information text | development acknowledgement only (`study/index.html`, acknowledgement-2) | |
| Consent text and consent mechanism | *none — current text is not research consent* | |
| Debrief text | *none* | |
| Form wording: title, participant information, consent question and choices, study-code question, confirmation message | rehearsal placeholders only | |
| Age / capacity requirement | *not proposed* | |
| Compensation | *not proposed* | |

---

## 4. Data collection, storage, retention and withdrawal

Collection is now a **Google Forms survey** writing to a private Google Sheet
(`docs/FORMS-SETUP.md`). The download/upload workflow is superseded.

| Field | Current state | Decision |
|---|---|---|
| Google account that owns the forms, response Sheet and Drive folder | *not decided* — must be acceptable to the review body (institutional vs personal) | |
| Access granted to the builder | `forms` (all Forms in the account) and `drive.file` (only files it creates) | |
| If Google requires it at build: `spreadsheets` (all Sheets in the account) | *not approved* | |
| Number of order variants (forms) | 4 proposed | |
| Study-code issuing and form assignment | codes `XXXX-XXXX`, round-robin across forms, optional prefilled links | |
| Form settings | quiz/grading, score feedback, response summary, email collection, sign-in requirement, one-response limit, response edits: **all off** | |
| Any setting to turn on (list explicitly) | *none* | |
| Hosting metadata statement | Google ordinarily logs technical data incl. IP address; stated to participants, not claimed absent | |
| Names or email addresses collected | not collected (protocol may require otherwise) | |
| Retention period for form responses, Sheet and exports | *not proposed* | |
| Deletion procedure at end of retention | *not proposed* | |
| Withdrawal policy | exclude (`E5-withdrawn`) or delete from form **and** Sheet | |
| Withdrawal deadline | *not proposed* | |
| Withdrawal contact shown to participants | *not set* | |
| Who processes withdrawals, and how often | *not proposed* | |
| Backup of the private corpus and build directories | *not arranged* | |
| Data-protection basis / institutional registration | *not proposed* | |

---

## 5. Release

| Field | Current state | Decision |
|---|---|---|
| Specification freeze identifier (`specFreezeId`) | none | |
| Remediation of the publicly readable development key in `ApratimPanwar/Order` history | A private repo / B fresh corpus (implemented) / C rewrite history | |
| Participant release package digest | not built | |
| Collection opening date / closing date | not set | |
| Person authorised to open and close uploads | not set | |

---

## Sign-off

| | |
|---|---|
| Approved by (name, role) | |
| Date | |
| Signature / recorded confirmation | |

---

## `approvals.json` (private corpus directory) — what the Forms build requires

```json
{
  "approvalFormat": "investigator-approval-2",
  "approvedBy": "<name, role>",
  "specFreezeId": "<identifier>",
  "ethicsReviewStatus": "<body, status, reference>",
  "s1_s21": { "S1": "accept | modify: ... | reject", "...": "...", "S21": "..." },
  "scorerRevision2": { "R2-1": "accept | modify: ... | reject", "R2-2": "...", "R2-3": "..." },
  "protocolApproved": true,
  "participantWordingApproved": true,
  "collectionProcedureApproved": true,
  "corpusApproved": true,
  "formsApproval": {
    "formTitle": "<exact text>",
    "participantInformation": "<exact text>",
    "consentQuestion": "<exact text>",
    "agreeChoice": "<exact text>",
    "declineChoice": "<exact text>",
    "codeQuestion": "<exact text>",
    "codeHelp": "<exact text>",
    "confirmationMessage": "<exact text>",
    "variants": 4,
    "settingsOverrides": {}
  }
}
```

`prepare-forms-build.mjs --mode study` refuses unless the corpus was built from a
plan with `"purpose": "study"` and `"status": "approved"`, every S and R2 item is
decided, all four sign-offs are `true`, every Forms text is present, `variants`
matches, and every override is a known boolean setting. It never builds forms
open, and it never creates this file.
