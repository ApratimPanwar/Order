# Google Forms — end-to-end rehearsal checklist

Run on a **rehearsal corpus** in `--mode rehearsal`, never on study stimuli. Every
response is development data, deleted afterwards. Requires authorisation to
create forms in Google, even for a rehearsal.

Prepared locally already: `order-study-private/rehearsal-1/forms-build-1`
(plan `166d6563a661227f…`, 12 images, 4 forms, 12 codes). Image checks pass;
the canvas cross-check gives mask IoU ≥ 0.9967 and mean difference ≤ 0.094 / 255.

## Before Google

- [ ] `npm test` passes on the commit used
- [ ] `check-images.mjs` → PASS, 0 warnings
- [ ] `canvas-crosscheck.mjs` → every maskIoU ≥ 0.99, meanAbs < 1
- [ ] `apps-script/*.gs` contain no `stim-`, `pair-`, `v1`, `stratum` (spot-check with a text search)

## Build (Google, owner account)

- [ ] authorisation screen lists only **Forms** and **Drive files used with this app**
- [ ] `buildRatingForms` completes; log shows 0 setting problems
- [ ] a second `buildRatingForms` run is refused
- [ ] `verifyRatingForms` → `VERIFY PASS`
- [ ] one private spreadsheet exists, with one response tab per form
- [ ] each form: not a quiz, email collection off, summary off, edits off, **not accepting responses**
- [ ] forms, spreadsheet and build-record folder shared with nobody
- [ ] `openRatingForms` refused without `AUTHORIZED_TO_OPEN`

## Respond (private browser window, not signed in)

- [ ] closed form shows "not accepting responses"
- [ ] set `AUTHORIZED_TO_OPEN` to the **rehearsal** plan digest, run `openRatingForms`
- [ ] form A: page 1 information + consent; "Stop" submits with no ratings
- [ ] form A: invalid code (`abcd-1234`) refused by validation
- [ ] form A: valid issued code, every page shows one image and two required 1–7 scales; skipping a scale is refused
- [ ] each page's image matches `images/` in form A's mapping order
- [ ] submit; no score, summary or "respond again" link is shown
- [ ] one response in form B with an **A** code (for `E7-wrong-form`)
- [ ] a second form-A response reusing the same code (for `E4-duplicate-code`)
- [ ] `closeRatingForms`; the form refuses new responses

## Sheet and export

- [ ] response tabs contain only Timestamp, consent, code and the tagged scale columns; no email column
- [ ] download each tab as CSV, unedited, into a private directory
- [ ] run `export-analysis.mjs` with `--issued-codes`, a `withdrawn-codes.txt` holding one used code, and the downloaded build record
- [ ] summary shows E1, E4, E5, E7 as staged; every row carries `X3-development-rehearsal`
- [ ] spot-check 3 rows: rating at form position *p* joins to the stimulus the mapping lists at *p*, with that stimulus's frozen `v1Total`
- [ ] editing one header in a CSV makes the exporter refuse

## Clean up

- [ ] delete rehearsal responses in each form and the spreadsheet
- [ ] trash the rehearsal forms, spreadsheet and build-record folder, or keep them unshared and closed
- [ ] record the rehearsal date, plan digest and outcome privately
