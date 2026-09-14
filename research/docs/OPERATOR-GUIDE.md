# Operator guide — study site, response collector, offline join

Three separate places, each holding only what it must:

| Place | Visibility | Holds |
|---|---|---|
| `ApratimPanwar/Order` (`research/`, `collector/`) | public | source, tests, documentation, the legacy development corpus |
| `ApratimPanwar/order-study-site` | public | **only** `site/` (the audited participant bundle) and `site-manifest.json` |
| Private directory, e.g. `…\ORDER\order-study-private\<corpus>\` | investigator only, **outside every git work tree** | corpus plan with secret namespace, stimulus key, private release record, `approvals.json` |
| Google Apps Script project + private Sheet + private Drive folder | owner only | uploaded raw files, normalised rows, upload ledger, conflicts, rejections, withdrawal requests |

Nothing in this guide records an approval. A participant release additionally
requires `approvals.json` (see `APPROVAL-SHEET.md`).

---

## A. Build a corpus and a bundle (research machine)

```bash
cd Order/research
# 1. corpus — refuses a private directory inside a git work tree
node scripts/build-study-corpus.mjs --private-dir ../../order-study-private/<corpus> --label <corpus>

# 2. release package — development unless --mode participant AND approvals.json passes
node scripts/build-release-package.mjs --label <corpus> \
  --stimuli-root ../../order-study-private/<corpus>/public-staging \
  --private-dir ../../order-study-private/<corpus> \
  --public-package-out ../../order-study-private/<corpus>/release-package.public.json \
  [--dev-return-channel ../../order-study-private/<corpus>/dev-channel.json]

# 3. participant bundle + audit
node scripts/build-participant-dist.mjs \
  --stimuli-root ../../order-study-private/<corpus>/public-staging \
  --private-dir ../../order-study-private/<corpus> \
  --package ../../order-study-private/<corpus>/release-package.public.json \
  --out ../../order-study-private/<corpus>/dist \
  --audit-out ../../order-study-private/<corpus>/dist-audit.json \
  --expect-digest <packageDigest>
```

Run `npm test` and `node scripts/verify-specification.mjs` on the same commit
first. Back up the private directory; without its key, responses cannot be
joined to the model.

## B. Publish the site (order-study-site)

```bash
git clone https://github.com/ApratimPanwar/order-study-site ../../order-study-site
node scripts/export-study-site.mjs --dist <private>/dist --audit <private>/dist-audit.json \
  --site-repo ../../order-study-site
cd ../../order-study-site && git add -A && git commit -m "Publish <packageId>" && git push
```

One-time repository settings (investigator):

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Environments → `github-pages`**: add yourself as a required
   reviewer; restrict deployment branches to `main`.

Then **Actions → Deploy study site → Run workflow** with the full package
digest, the release mode and `DEPLOY`. The workflow re-verifies every byte
against `site-manifest.json` and refuses on any mismatch. Live URL:
`https://apratimpanwar.github.io/order-study-site/`.

Never run a deployment while collection is open unless the change has been
approved; the workflow is manual precisely so ordinary commits cannot do it.

## C. Set up the collector (Google Apps Script)

Use the Google account the approval sheet names; a personal account may not be
acceptable to the review body.

1. **script.google.com → New project.** Name it `ORDER rating collector`.
2. **Project Settings → Show "appsscript.json" manifest file in editor.**
3. Create files with exactly these names and paste the contents from
   `Order/collector/`: `Config.gs`, `Validate.gs`, `Store.gs`, `Services.gs`,
   `Code.gs`, `Upload.html`, and replace `appsscript.json`.
   (Alternatively `clasp push` from `Order/collector/`.)
4. **Services → + → Google Sheets API (v4)**, identifier `Sheets` (the manifest
   already declares it; confirm it appears).
5. In the editor, select **`operatorSetup`** → **Run**. Google shows an
   authorisation screen listing Sheets, Drive (files this script creates),
   external requests and your email address. Review it and allow. This creates a
   private spreadsheet and a private Drive folder, owned by you and shared with
   no one, and sets `ACCEPTING_UPLOADS=false`.
6. **Project Settings → Script Properties**, add:
   - `REGISTER_PACKAGE_URL` = `https://apratimpanwar.github.io/order-study-site/release-package.json`
   - `REGISTER_PACKAGE_DIGEST` = the full package digest
   - `CONTACT_TEXT` = the approved withdrawal contact wording (leave unset until approved)
   - `WITHDRAWAL_POLICY` = `mark-ineligible` or `delete`, as approved
7. Run **`operatorRegisterPackage`**. It fetches the live package and stores it
   only if its digest matches.
8. **Deploy → New deployment → Web app**: *Execute as* **Me**; *Who has access*
   **Anyone**. Copy the `/exec` URL. That URL is the return channel.
9. Run **`operatorOpenUploads`** when collection (or a rehearsal) should start;
   **`operatorCloseUploads`** to stop. `operatorStatus` writes counts to the
   execution log; nothing is ever shown on the public page.

A new deployment ID gives a new URL. Changing the URL participants are given
changes the return channel and therefore the release package — rebuild and
republish rather than editing the page.

## D. While collecting

- **Uploads** tab: one ledger row per distinct file. `complete` is the only
  state reported to participants as received.
- **Conflicts**: a different file with a study code already received. The file
  is kept privately and not merged. Decide case by case, and record the decision.
- **Rejections**: SHA-256, size and reason codes only; rejected files are not
  stored.
- **WithdrawalRequests**: run **`operatorProcessWithdrawals`** at the agreed
  interval. `mark-ineligible` keeps rows with `X4-withdrawn-after-upload`;
  `delete` removes rows and moves originals to Drive trash (empty the trash per
  the retention policy).
- Rehearsal uploads (development packages) land in **RehearsalResponses**, never
  in **Responses**.

## E. Offline scoring join

Download the raw files from the private Drive folder (`raw/`), unmodified, into
a private working directory, then for each:

```bash
# withdrawn-codes.txt: the study codes in the WithdrawalRequests tab, one per line
node scripts/join-responses.mjs <private>/uploads/u-<id>.json \
  --private-dir <private>/<corpus> --withdrawn-codes <private>/withdrawn-codes.txt \
  --out <private>/joined/u-<id>.json
```

Without `--withdrawn-codes` the joined output states that withdrawals made after
upload were **not checked**; with it, affected rows carry
`X4-withdrawn-after-upload` and are ineligible for every analysis.

The join verifies the package digest, the key digest recorded in the package and
every layout identity; it refuses to overwrite inputs or earlier outputs, and
partitions rehearsal data out of the study dataset.
