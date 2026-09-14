> **Superseded 2026-09-14 for participant collection.** Participants no longer
> download and upload response files; collection moves to a Google Forms survey
> (`FORMS-SETUP.md`, `FORMS-REHEARSAL-CHECKLIST.md`). This document describes the
> earlier web-app + upload-collector workflow and is kept as a record.

# Participant-collection release checklist

**Current assessment: NOT READY FOR PARTICIPANT COLLECTION.**

A box is ticked only with evidence named beside it. "Local" means the
`collector-local-harness` rehearsal, which runs the real collector code against
in-memory fakes; it is not evidence about Google's or GitHub's services.

## 1. Scorer

- [x] Element-order dependence reproduced (1,101 / 3,879 layouts under revision 1) and fixed — `SCORER-REVISIONS.md` R2-1; 0 / 23,274 permuted scorings differ
- [x] Kendall τ-b joint ties reproduced and fixed — R2-2; reference and SciPy-example tests
- [x] Archived revision-1 records preserved and reproducible — `ARCHIVE:` test
- [x] 2,000-pair comparison rerun under the study scorer — 1,998 eligible, 2 unsupported, 1,976 wins, 0 ties, 22 reversals
- [ ] S1–S21 approved — **all unapproved**
- [ ] R2-1, R2-2, R2-3 approved — **unapproved**
- [ ] Specification freeze identifier recorded — **none**

## 2. Corpus

- [x] Builder keeps key, pairing, strata and seeds outside every git work tree; refuses otherwise — `PIPELINE:` tests
- [x] Exposed development stimuli and the unsupported test item excluded — `CORPUS-SAMPLING-PLAN.md`
- [x] Rehearsal corpus built with its own secret namespace (12 stimuli, 6 pairs) — private directory only
- [ ] Sampling plan approved — **proposed only**
- [ ] Participant corpus generated from the approved plan — **not generated**
- [ ] Private directory backed up — **not arranged**

## 3. Instrument

- [x] Wording inside the package digest; release mode and return channel in the digest
- [x] Startup gate: persistent storage and Web Locks probed by use
- [x] **Reload within the lease period no longer locks the participant out**, and a read-only tab accepts no input — found in this pass's rehearsal, fixed, verified in Chromium (local)
- [x] A refused save always reverts to stored state and never advances — same fix
- [ ] Participant information, consent and debrief text approved — **development acknowledgement only**
- [ ] Browsers permitted by the protocol decided and each tested — **Chromium only**

## 4. Collector (Google Apps Script)

- [x] Validates schema, registered package digest, package id, data class and every layout identity — tests + local
- [x] Original file preserved; rows normalised with the export's own field names plus `uploadId`, `serverReceivedAt`, `uploadSha256`
- [x] "Received" only after raw file stored, rows read back field for field, ledger confirmed — tests + local
- [x] Idempotent repeats; conflicting uploads held, never merged — tests + local
- [x] Interrupted submissions resume without duplicates (partial write, lost response, busy lock) — tests + local
- [x] Formula-like text stored literally; adapter uses RAW — tests + local
- [x] No read endpoint; operator functions refuse anonymous callers — tests
- [x] Withdrawal after upload: request, idempotent, processed under policy; offline join applies it — tests + local
- [ ] Deployed to Apps Script under an approved Google account — **not deployed**
- [ ] Live receipt, Sheet rows and private Drive file verified — **not done**
- [ ] Withdrawal contact (`CONTACT_TEXT`), policy, retention approved — **unapproved**

## 5. Site

- [x] Order repository cannot deploy Pages; Composer site untouched — `WORKFLOW:` test
- [x] Site repository receives only `site/`, a manifest, the verifier, workflow and README — `PIPELINE:` test
- [x] Verifier refuses changed bytes, extra files, unexpected paths, private markers, wrong digest or mode — `PIPELINE:` test
- [ ] `ApratimPanwar/order-study-site` created — **not created**
- [ ] Pages source GitHub Actions; `github-pages` environment protected — **not configured**
- [ ] Live HTTPS site verified: package digest and asset bytes — **not done**
- [ ] Researcher paths unavailable on the live site — **not done**

## 6. Live end-to-end on HTTPS, per permitted browser

- [ ] rating → reload → completion
- [ ] second-tab protection
- [ ] blocked capabilities
- [ ] download → upload → confirmed receipt → Sheet rows → private raw file
- [ ] duplicate, invalid, interrupted uploads
- [ ] withdrawal before and after upload
- [ ] offline scoring join from the downloaded raw file
- [ ] rehearsal responses confirmed in `RehearsalResponses`, not `Responses`

## 7. Governance

- [ ] Ethics review status recorded
- [ ] Remediation of the exposed development key decided
- [ ] `approvals.json` written by the investigator and accepted by the builder
- [ ] Participant package built, published, registered with the collector, uploads opened by the authorised person
