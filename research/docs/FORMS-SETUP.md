# Google Forms rating survey — setup

**Status: PREPARED, NOT DEPLOYED.** Nothing in this document has been run against
Google. No approvals are recorded. Do not build study forms, open any form or
invite anyone until the investigator authorises it.

This replaces the participant download/upload workflow. Participants no longer
handle research files: they open a form, consent, enter a study code and rate each
composition. Responses go straight to a private Google Sheet. The rating web app
and the upload collector remain in the repository as superseded tooling.

---

## 1. What exists where

| Place | Holds | Visibility |
|---|---|---|
| `Order/research/core/rasterize.js` | renders a layout to PNG exactly as the instrument draws it | public source |
| `Order/research/scripts/forms/prepare-forms-build.mjs` | builds images, variants, mapping, codes, Apps Script data | public source |
| `Order/research/scripts/forms/check-images.mjs` | image checks | public source |
| `Order/research/scripts/forms/canvas-crosscheck.mjs` | compares images with the instrument's canvas renderer in a browser | public source |
| `Order/research/scripts/forms/export-analysis.mjs` | joins ratings to frozen scores | public source |
| `Order/forms-builder/FormsBuilder.gs`, `appsscript.json` | one-time FormApp builder | public source |
| `<private>/<corpus>/` | layouts, stimulus key (frozen scores), corpus plan, `approvals.json` | **private, outside git** |
| `<private>/<corpus>/<build>/` | PNGs, `build-plan.json`, `mapping.json`, `issued-codes.csv`, `apps-script/*.gs` | **private, outside git** |
| Apps Script project "ORDER rating forms builder" | builder + generated plan and images (no stimulus IDs, no scores) | owner only |
| Google Forms (one per variant), one response Sheet, one Drive folder with the build record | the survey and its responses | owner only; forms closed until authorised |

The scorer, the stimulus key and every source layout are read, never modified.

---

## 2. What the survey looks like

Each form, identical except for presentation order:

1. **Participant information and consent.** The approved information text is the
   form description. A required choice: *agree* continues; *decline* submits
   immediately with no ratings. Google records that declining submission
   (timestamp and choice only); the exporter excludes it (`E1-declined`).
2. **Study code.** Required, validated against `XXXX-XXXX` (Crockford base32:
   no I, L, O, U).
3. **One composition per page.** The image, then two required 1–7 scales:
   *How ordered does this composition appear?* (Not at all ordered … Highly ordered)
   and *How visually appealing do you find it?* (Not at all appealing … Very appealing).

Question titles carry a neutral form-and-position tag, e.g. `[B-07]`, so every
column in the response sheet is unique and each downloaded tab identifies its own
form. Titles never contain stimulus IDs, conditions, pairs or scores.

### Settings (all off unless the approval record explicitly overrides them)

| Setting | Value | Why |
|---|---|---|
| Quiz / grading | off | no grading, no score feedback |
| Collect email addresses | off | not needed; not requested |
| Require sign-in | off | Workspace-only; recorded as unsupported on personal accounts |
| Limit to one response | off | would require sign-in |
| Edit after submit | off | a submitted rating is final |
| See summary charts / response summary | off | respondents never see other answers |
| Link to submit another response | off | |
| Progress bar | on | |
| Shuffle question order | off | order is controlled by recorded variants instead |
| Accepting responses | **off at build** | opened only by `openRatingForms()` after authorisation |

The builder reads every setting back after setting it and fails loudly if any
differs, except that an *unsupported* `requireLogin` is tolerated when the plan
asks for it to be off.

### Presentation-order variants

`prepare-forms-build.mjs` draws one seeded base order from the corpus's private
namespace in which **no two members of a matched pair are adjacent**, cyclically.
Form *k* is that order rotated by *k·n/K*, so each composition appears once per
form, at *K* evenly spaced positions, and the no-adjacency property holds in every
form. The default is 4 forms; the number is an approval item.

Assignment: `issued-codes.csv` pre-assigns codes to forms round-robin. Give each
participant the link for their code's form, optionally as a **prefilled link**
(the build record holds a template with `0000-0000` in place of the code). A code
used in the wrong form is flagged `E7-wrong-form`.

---

## 3. Access Google will ask for

The builder declares exactly two scopes, and nothing else is requested:

| Scope | Google's description | Used for |
|---|---|---|
| `https://www.googleapis.com/auth/forms` | See, edit, create and delete **all** your Google Forms forms | FormApp: creating and verifying the rating forms. There is no narrower scope for a standalone script. |
| `https://www.googleapis.com/auth/drive.file` | See, edit, create and delete **only the specific Google Drive files you use with this app** | creating the response spreadsheet and the private build-record folder and file |

No Sheets scope, no full Drive scope, no email scope, no external requests, no web
app. The project exposes no endpoint.

**Not yet verified on Google:** whether `form.setDestination(SPREADSHEET, id)`
accepts a spreadsheet created through the Drive API under `drive.file` without
the broader `spreadsheets` scope. If the first authorised build fails at that
call, the only change is adding `https://www.googleapis.com/auth/spreadsheets`
("all your spreadsheets"). That wider access needs explicit approval first; do not
add it silently.

Hosting metadata: Google operates Forms and ordinarily records technical
information about each visit, including IP addresses. The survey collects none of
it, but it cannot switch Google's logging off. Say so in the approved
participant information.

---

## 4. Build steps (only when authorised)

### 4.1 Locally

```bash
cd Order/research
# a) the approved corpus must already exist, built from an approved plan
node scripts/build-study-corpus.mjs --private-dir <private>/study-1 --label study-1

# b) the investigator writes <private>/study-1/approvals.json (format in APPROVAL-SHEET.md)

# c) prepare the build into a NEW private directory
node scripts/forms/prepare-forms-build.mjs --private-dir <private>/study-1 \
     --out <private>/study-1/forms-build-1 --mode study --variants 4 --codes <N>

# d) image checks, then the browser cross-check
node scripts/forms/check-images.mjs --private-dir <private>/study-1 --build <private>/study-1/forms-build-1
node scripts/forms/canvas-crosscheck.mjs --private-dir <private>/study-1 --build <private>/study-1/forms-build-1
#    open http://localhost:8796/ ; expect maskIoU >= 0.99 and meanAbs < 1 for every image
```

`prepare-forms-build.mjs` refuses: a private or output directory inside a git work
tree; a non-empty output directory; any development stimulus; study mode without a
corpus built from an approved plan or without a complete `approvals.json`; a
rehearsal on a study corpus; opening forms at build time; unknown or non-boolean
setting overrides.

### 4.2 In Google (owner's account named in the approval sheet)

1. **script.google.com → New project**, name it `ORDER rating forms builder`.
2. **Project Settings → Show "appsscript.json"**. Replace it with
   `Order/forms-builder/appsscript.json`.
3. **Services → + → Drive API (v3)**, identifier `Drive` (the manifest declares it).
4. Add the files, keeping these names:
   - `FormsBuilder.gs` from `Order/forms-builder/`;
   - `BuildPlan.gs` and every `StimulusImages_NN.gs` from `<build>/apps-script/`.
   Use `clasp push` from a private copy of those files, or paste each file. Never
   commit or share the generated files.
5. Select **`buildRatingForms`** → **Run**. Google shows an authorisation screen
   listing the two scopes above. If it lists anything else, stop.
   The builder verifies every image's SHA-256 against the plan before creating
   anything, creates the forms closed, links them to one new private spreadsheet,
   and writes the build record to the Drive folder
   `ORDER rating forms build (PRIVATE)`. It refuses to run a second time.
6. Run **`verifyRatingForms`**. The log must read `VERIFY PASS`.
7. Download the build record JSON from that folder into `<build>/`.
8. Open each form **as a respondent in a private window** and look at every page.
   Compare each image with `<build>/images/` in the mapping's order for that form.
9. **Only after authorisation to collect:** set Script Property
   `AUTHORIZED_TO_OPEN` to the plan digest, run `openRatingForms`. Run
   `closeRatingForms` to stop at any time.

Keep the forms, spreadsheet and Drive folder unshared. Do not turn on "Get email
notifications", do not add collaborators, and do not publish the spreadsheet.

---

## 5. Withdrawal

Participants withdraw by contacting the researcher (the approved contact) with
their study code.

1. Add the code to a private `withdrawn-codes.txt`. The exporter then marks
   every row for that code `E5-withdrawn`.
2. If the approved policy is deletion: delete that response **both** in the form
   (Responses → Individual → delete) **and** in the response spreadsheet. The
   form keeps its own copy of responses, separate from the Sheet.
3. Record the date the withdrawal was processed.

---

## 6. Analysis export

1. In the private spreadsheet, download **each response tab** as CSV
   (File → Download → Comma-separated values) into a private directory. Do not
   open and re-save them in a spreadsheet program: the exporter matches the header
   row exactly.
2. Run:

```bash
node scripts/forms/export-analysis.mjs --private-dir <private>/study-1 \
  --build <private>/study-1/forms-build-1 \
  --responses <private>/exports/form-A.csv --responses <private>/exports/form-B.csv \
  --responses <private>/exports/form-C.csv --responses <private>/exports/form-D.csv \
  --issued-codes <private>/study-1/forms-build-1/issued-codes.csv \
  --withdrawn-codes <private>/withdrawn-codes.txt \
  --build-record <private>/study-1/forms-build-1/forms-build-record-<digest>.json \
  --out <private>/analysis-1
```

It verifies the plan digest, that the mapping belongs to that plan, that the
stimulus key is byte-identical to the frozen key, and (with `--build-record`) that
Google's forms carry the planned titles. It identifies each tab's form by its
exact header row, joins every rating to its stimulus through the private mapping,
and writes `ratings-long.csv` (one row per response × composition, with frozen
v1 total, dimensions, pair, role, stratum, model version and exclusion rules) plus
`summary.json`. It refuses an output directory inside a git work tree and never
overwrites an export.

| Rule | Meaning |
|---|---|
| E1-declined | consent declined; no ratings |
| E2-invalid-code | code does not match the pattern |
| E3-unissued-code | code not in the issued list |
| E4-duplicate-code | later row in the same tab reusing a code, or any code appearing in more than one tab |
| E5-withdrawn | code withdrawn |
| E6-invalid-rating | a rating is not 1–7 |
| E7-wrong-form | code issued for a different form |
| X3-development-rehearsal | rehearsal build; never study data |

Timestamps in downloaded CSVs are locale-formatted and are not used for ordering.
