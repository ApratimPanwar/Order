# GitHub Pages deployment — preparation report

**Status: PREPARED, NOT DEPLOYED. NOT READY FOR PARTICIPANT COLLECTION.**

Everything that can be built, tested and audited without touching GitHub has been
done. Two actions remain that this session cannot perform, and one newly found
exposure needs a decision before any participant sees the instrument.

| | |
|---|---|
| Branch | `feature/doasa-v1-research-instrument` |
| Release package | `dev-pilot-3-69b46adc1e925dd1` |
| Package digest | `69b46adc1e925dd136c80d47a0f51a9279649b692a833284e744ca744c4aad3c` |
| Release mode | `development` (return channel: **none**) |
| Automated tests | **214 passing, 0 failing, 0 skipped, 0 todo** |
| Specification verifier | **41 passed, 0 failed** |
| Live URL | **none yet** — see §2 |

---

## 1. Deployment target

**Owner: `ApratimPanwar`** (confirmed from `origin`:
`https://github.com/ApratimPanwar/Order.git`).

**Destination: a dedicated study-site repository is required, and does not yet
exist.** `ApratimPanwar/Order` already serves a Pages site at
<https://apratimpanwar.github.io/Order/> (HTTP 200 — the Order Composer). Setting
that repository's Pages source to *GitHub Actions* replaces that site, which
instruction 2 forbids. The two cannot coexist on one repository without the
workflow also taking responsibility for republishing the composer, which would
couple the study site to the application.

The GitHub CLI is not installed on this machine and no API credential is
available, so this session cannot create a repository or change Pages settings.
Both are account-level actions that need the investigator anyway.

---

## 2. What is blocking the live link

| # | Action | Who |
|---|---|---|
| 1 | Create `ApratimPanwar/order-study-site` (public; Pages requires it unless on a paid plan) | investigator |
| 2 | Settings → Pages → Source: **GitHub Actions**; Settings → Environments → `github-pages`: add the investigator as a required reviewer and restrict deployment to the default branch | investigator |
| 3 | Push the reviewed contents and run **Deploy study site** with the package digest above, `release_mode: development`, `confirm: DEPLOY` | either |
| 4 | Re-run the §5 acceptance checks against the real HTTPS URL | this session |

Once 1 and 2 exist, 3 and 4 follow immediately and produce a clearly labelled
development/review link.

---

## 3. Newly found exposure — decide before recruiting

**The scoring key is already publicly readable.**
`research/study-private/stimulus-key.json` is tracked in git, and
`ApratimPanwar/Order` is a public repository, so the file resolves over
`raw.githubusercontent.com` on the pushed branch (verified: HTTP 200). It
contains, for all 13 stimuli, the `condition` label and the full v1 score
breakdown.

`research/.gitignore` excludes response exports and `dist/`, but not
`study-private/`.

This does not affect the deployed bundle — the Pages artifact carries no key, and
the audit fails the build if one appears. It affects **blinding**: a participant
who finds the repository can read which condition each composition belongs to.
The likelihood is low; the consequence for a blinded rating study is not.

Deleting the file from the branch tip would stop `raw.githubusercontent.com`
serving it, but **would not remove it from history**. Real remediation is one of:

- **A.** Make `ApratimPanwar/Order` private, and host the study site from the new
  public study-site repository (which never contains a key). Simplest, reversible,
  loses public visibility of the composer.
- **B.** Generate the participant corpus fresh, with a key that is never
  committed (`study-private/` added to `.gitignore` first). The exposed key then
  describes stimuli no participant will ever see. Cleanest scientifically; the
  development corpus stays exposed but becomes irrelevant.
- **C.** Rewrite history and force-push. Destructive, and caches and forks may
  retain the blob anyway. Not recommended on its own.

**Recommendation: B, optionally with A.** No action has been taken: rewriting or
un-publishing what is already public is the investigator's decision.

---

## 3b. A second defect found while preparing the workflow

**The package identity was platform-dependent.** `core.autocrlf=true` on this
machine meant the working copy carried CRLF while git stored LF. The release
package digests the bytes on disk, so the identity computed here
(`aa8c36d2…`) could never have matched the identity computed from the same
commit on the Linux runner the workflow uses: `--expect-digest` would have failed
for a reason unrelated to the content.

The same defect already affected the archived v0 reference. Its pin,
`2fa6cbc12ee6bb01732523a7b2c91d97c5ac8909d901302a70acb1e389999e5e`, was taken
over the CRLF working copy, so `equivalence: reference source identity is pinned`
would have failed on any Linux checkout. It was passing here only because it has
only ever run on Windows.

Fixed by `/.gitattributes` (`* text=auto eol=lf`), normalising the working copy,
and re-pinning the reference to the repository-canonical digest
`18e74ac357b31b8d3e46e812e0fda2ac171dda832d0121c0c04bdf888f4f2d0a`. The archived
reference was **not edited**: the working copy is now byte-identical to the blob
already stored in git, and stripping CRLF from the old pinned form yields exactly
that file. Both facts were checked before the pin was changed.

Guarded by `IDENTITY: no digested source carries CRLF line endings` and
`IDENTITY: .gitattributes pins line endings for every file`.

The final identity is therefore `dev-pilot-3-69b46adc1e925dd1`.

---

## 4. What changed in this pass

### 4.1 The participant wording is now inside the frozen identity (item 6)

`study/index.html` was **not** a digest input. Every word a participant read
therefore sat outside the package identity and could change without changing the
package digest. It is now the tenth source file, and
`study/{consent,participant-information,debrief}.html` and `study/protocol.json`
are picked up automatically the moment any of them is created. `releaseMode` and
the return channel are digest components too, so a rehearsal and a real release
of otherwise identical bytes cannot share an identity.

Tests: `DEPLOY: study/index.html is a release-package digest input`,
`DEPLOY: changing the participant wording changes the package digest`,
`DEPLOY: release mode and return channel take part in the identity`,
`DEPLOY: optional consent/protocol assets are digest inputs the moment they exist`.

### 4.2 A participant release cannot be a renamed development release (items 7, 9)

`build-release-package.mjs --mode participant` now requires
`study-private/approvals.json`: `investigator-approval-1` format, an
`approvedBy`, a `specFreezeId`, an `ethicsReviewStatus`, a decision other than
`pending` for **every** S1–S21 item, three explicit sign-offs
(`protocolApproved`, `participantWordingApproved`, `collectionProcedureApproved`)
and a `returnChannel` naming both a kind and the exact participant instructions.
Anything missing is listed and the build exits 2. **No such file exists and this
session did not create one.**

Tests: `DEPLOY: a participant package is refused without a recorded approval`,
`DEPLOY: an incomplete approval record is refused item by item`.

### 4.3 Startup environment gate (item 8)

Both mechanisms are probed **by use**, not by feature detection, before anything
is recorded: storage must round-trip a value and accept its removal; Web Locks
must actually grant an exclusive lock within 4 s. On failure the page shows an
unsupported-environment message and creates **no session and no store**. The
unverified lease-only path is therefore never used for collection.

Browser evidence (Chrome 152.0.7977.76, built bundle, emulated repository
subpath `/study-site/`):

| Broken capability | Probe result | Outcome |
|---|---|---|
| `navigator.locks` absent | `webLocks: api-absent` | `data-ready="unsupported"`, no session, storage untouched |
| `navigator.locks` never resolves | `webLocks: timed-out` | same |
| `localStorage` throws `SecurityError` | `persistentStorage: no-storage-object` | same |
| `localStorage` accepts writes but forgets them | `persistentStorage: value-did-not-round-trip` | same |
| nothing broken | both `ok` | task starts normally |

Tests: `GATE: …` (five tests, including a hanging lock manager and three
distinct storage failures).

### 4.4 Completion page and transfer wording (items 20, 21, 22)

The completion page is now three numbered steps: **download the file**, **return
it through the channel below**, **downloading alone does not submit anything**
("Nothing has been transmitted, and no one has received it… We cannot confirm
receipt of a file we have not been sent"). The channel is rendered from the
frozen package. With no approved channel it reads *"No return channel has been
specified. Please do not send it anywhere."* — no destination is invented, and
the bundle contains no address, `mailto:`, form endpoint, `XMLHttpRequest` or
`sendBeacon`.

The acknowledgement now separates **what this application records** (ratings,
notes, timings, a random study code) from **what it cannot control**: that the
web host ordinarily logs technical information *including the IP address*, that
we can neither receive nor switch those logs off, and therefore
**"we cannot tell you that your visit is anonymous"**; and that a returned file
travels through a channel that may attach an address, an account name or a
filename. No claim is made that Pages logs nothing or that returned files are
anonymous.

Withdrawal is explained in three stages — during the task, before the file is
returned (erasure is final; nothing remains to withdraw) and after it is returned
(possible, using the study code shown on the final screen, which is also inside
the file). How to ask comes from the approved channel; with none configured the
page says so rather than inventing a contact.

Tests: `TRANSFER: …` (three), `PRIVACY: hosting and transfer metadata are
distinguished from what the app records`, `WITHDRAWAL: …`.

### 4.5 Rehearsal data is partitioned out of the study dataset (item 26)

Sessions carry `releaseMode` and `dataClass` from the package; an unrecognised,
missing or malformed mode falls back to `development`, never to study data. Every
export states its class. `join-responses.mjs` adds `dataset.partition`, a
per-row `datasetPartition`, `mainStudyEligible`, and
`exclusionRule: 'X3-development-rehearsal'`. An export with no declared class is
treated as rehearsal — a file written before the field existed cannot drift into
the dataset by omission.

Tests: `DEPLOY: an unrecognised release mode falls back to development…`,
`REHEARSAL: …` (two, running the real join end to end).

### 4.6 Artifact and workflow (items 10–17)

`build-participant-dist.mjs` now also: ships consent/protocol assets if present;
writes `.nojekyll`; fails if `index.html` is not at the artifact root; fails on
any root-absolute `src`/`href`/import that would break under
`https://<owner>.github.io/<repo>/`; verifies the bundle's package digest against
the researcher-side record and against an `--expect-digest` argument; and records
a **SHA-256 for every served file** so the live site can be checked byte for byte.

`.github/workflows/deploy-study-site.yml`: `workflow_dispatch` only — no `push`,
no `pull_request`, no `schedule`; `contents: read`, `pages: write`,
`id-token: write` (no write access to repository contents); `environment:
github-pages`; `concurrency: pages` without cancellation; Node pinned to
**24.15.0**, the exact runtime the suite is tested on;
`actions/checkout@v4`, `setup-node@v4`, `configure-pages@v5`,
`upload-pages-artifact@v3`, `deploy-pages@v4`. It runs `npm test` and
`verify-specification.mjs` before publishing, requires `confirm: DEPLOY`, asserts
the deployed digest and release mode against the dispatch inputs, refuses a
participant release with no return channel, and uploads only
`research/dist/participant`. It never runs `build-stimuli.mjs` or
`build-release-package.mjs`, so a deployment cannot regenerate stimuli or mint a
new key. Dispatch inputs reach the shell only through `env:`.

Tests: `ARTIFACT: …` (five), `WORKFLOW: …` (six).

---

## 5. Acceptance results — localhost under an emulated repository subpath

**These are not live-site results.** There is no HTTPS Pages URL yet. The built
bundle was served from `dist/participant/` at `/study-site/` so that every
relative import and fetch is exercised exactly as Pages serves them.

| Check | Result |
|---|---|
| Acknowledgement and first stimulus | Package `dev-pilot-3-69b46adc1e925dd1` loaded; banner names the development mode; composition 1 of 13 |
| Record → reload → continue | 3 ratings, reload, same participant `p-e406c898…`, resumed at composition 4, 3 responses intact |
| Second-tab protection | Second tab read-only with a plain-language message; its write attempt left the record **byte-identical** (3 rows before and after) |
| Completion and export | 13/13 rated; three steps rendered; study code shown; export carries `dataClass: development-rehearsal`, `returnChannel: null`, `transmitted: false` |
| Withdrawal | 4 rows preserved, all `X2-withdrawn`, all analysis-ineligible |
| Erasure | Session key removed, tombstone written, download disabled, return instructions withdrawn |
| Environment gate | All four broken-capability variants refused to start (§4.3) |
| Researcher paths on the served site | `study-private/stimulus-key.json`, `results/…`, and the server root all **404** |
| Offline join against the archived release | 13 matched, 0 unmatched, identity **bound**, 12 model-agreement eligible, 1 retained despite no score, partition `development-rehearsal` → **excluded from the main study dataset** |
| Transfer through the chosen return channel | **not testable — no channel exists** |
| Served asset bytes vs audited digests | **20 of 20 match** (checked over HTTP against `assetDigests`); on a live site this same check is the item-24 verification |
| Live package digest and asset bytes on HTTPS | **not testable — no live site** |

The in-app browser sandboxes file downloads, so the acceptance run captured the
exact bytes `exportRecord()` produces — the same object the download button
serialises — through a local test-harness endpoint. The participant bundle
contains no reference to it.

Only Chromium 152 has been exercised.

---

## 6. Exact participant instructions as they now stand

> **What to do next**
> 1. **Download the response file.** It saves `order-rating-<your code>.json` to
>    this device.
> 2. **Return the file through the channel below.**
>    *No return channel has been specified. Please do not send it anywhere.*
> 3. **Downloading alone does not submit anything.** Saving the file to your
>    device sends it nowhere. Nothing has been transmitted, and no one has
>    received it. Until you complete step 2 yourself, your responses exist only
>    on this device. We cannot confirm receipt of a file we have not been sent.
>
> **Your study code** is `p-…`. It is also inside the file. Keep it if you may
> want your responses removed later — quote it in your request.

Step 2 stays in that form until a channel is approved and recorded in
`study-private/approvals.json`.

---

## 7. Assessment

**NOT READY FOR PARTICIPANT COLLECTION.**

1. **No live URL.** The study-site repository does not exist and Pages is not
   configured for Actions (§2).
2. **All of S1–S21 remain unapproved**, along with the protocol, the participant
   wording and the collection procedure. The builder now enforces this
   mechanically: a participant package cannot be produced.
3. **No approved return channel**, so the completion page correctly tells
   participants to send the file nowhere.
4. **The scoring key is publicly readable** in the existing repository (§3).
5. **No ethics/consent review.** The current text is a development
   acknowledgement, however carefully worded.
6. **One browser engine.** Web Locks is now mandatory, which makes the gate
   testable but also makes engine coverage matter more.

**Ready for:** a clearly labelled development/review deployment as soon as §2
items 1 and 2 are done, and a supervised internal rehearsal with
non-participants, whose output is already partitioned out of the study dataset.
