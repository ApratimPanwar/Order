# Local end-to-end rehearsal — 2026-09-14

**Not a live-site acceptance run.** Chromium (the Claude desktop in-app
browser) against `scripts/collector-local-harness.mjs`, which serves the exported
site under `/order-study-site/` and the collector's real `Upload.html` with
`google.script.run` shimmed onto the collector's real `.gs` code running against
in-memory fakes of Sheets, Drive, LockService and Script Properties. Nothing here
is evidence about Google Apps Script, Google Sheets, Google Drive or GitHub Pages.

| | |
|---|---|
| Corpus | rehearsal-1 — 6 matched pairs, 12 stimuli, own secret namespace; key in the private directory |
| Package | `rehearsal-1-961b819e9ffca307` (development, `development-rehearsal`, no return channel) |
| Site export | `site-manifest.json` verified by `tools/verify-site.mjs` (19 files) |

## Defect found by this rehearsal, and fixed

**Reload locked the participant out, and a read-only tab still took answers.**
The first run rated 5 compositions and reloaded immediately. The reloaded page
found the lease still held by its own previous page (the 15 s lease was never
released on unload) and went read-only. The rating controls stayed enabled:
each Next click ran `record()`, which changed the in-memory session, and the save
was refused. Memory reached 12 responses and `completed`; storage held **5**. An
export taken then would have contained answers that were never saved.

Fix (`study/index.html`): the lease is released on `pagehide`; a read-only tab
disables its rating controls and refuses before `record()`; every refused save
reloads the stored state and never advances; a read-only tab takes over by itself
once the other lease lapses. Guarded by three `READ-ONLY:` tests.

## Results after the fix

| Check | Observed |
|---|---|
| Rate 5 → immediate reload | same study code, index 5, 5 responses; active, not read-only |
| Second tab | read-only; rating controls and Next disabled; a click recorded nothing; storage byte-identical; memory 5 = storage 5 |
| First tab closed | second tab became active by itself after ≈11 s with 5 responses |
| Completion | 12 / 12 in memory and in storage; study code and file name shown; "No return channel has been specified. Please do not send it anywhere." |
| Upload | "Received. Upload reference u-2505cd6e…, 12 response(s) stored. This was rehearsal data…" |
| Stored | raw file 8,362 bytes, SHA-256 equal to the upload hash; 12 rows in `RehearsalResponses`, 0 in `Responses`; ledger `complete`, `rowsVerified` 12, attempts 1 |
| Formula-like comments | `=HYPERLINK("http://evil.example","click")` and `+SUM(A1:A9) and @mention` stored literally |
| Same file again | "Received … this file had already been received; nothing was stored twice" |
| Not JSON | "Not received … Nothing was stored. Reasons: not-json" |
| Rating tampered to 9 | rejected `response[0]:perceived-order` |
| Layout integrity swapped | rejected `response[1]:layout-identity-mismatch` |
| Re-export with the same code (different bytes) | "Stored, but not added to the responses" — held as a conflict; repeating it did not store it again |
| Partial row write + lost response, second session | "Not received yet — retrying" → "Received"; 12 rows, 12 distinct stimuli, attempts 2 |
| Lost response after the server had stored the file | "Not received yet — retrying" → "Received (already received; nothing stored twice)" |
| Lock permanently busy | three retries, then "Not received. Please try again." Nothing stored |
| Withdrawal: invalid code / valid / repeat / unknown code | refused / recorded / same request id / recorded with identical wording |
| Processing (`mark-ineligible`) | 12 rows `X4-withdrawn-after-upload`, ineligible; other participant untouched |
| Offline join of a stored raw file | identity bound to the rehearsal package, 12 matched, partition `development-rehearsal` |
| Offline join with `--withdrawn-codes` | all 12 rows `X4-withdrawn-after-upload`, 0 eligible |
| Blocked capabilities | verified on the previous bundle build (Web Locks absent, hanging; storage throwing, amnesiac); the gate code is unchanged in this build |

Not exercised: any Google or GitHub service, any browser other than Chromium.
