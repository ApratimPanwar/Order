# Release-readiness report

**Assessment: NOT READY for participant release.** Ready for investigator review
and for a supervised internal pilot. Reasons in §5.

| | |
|---|---|
| Branch | `feature/doasa-v1-research-instrument` |
| Commit tested | see §2 |
| Release package | `dev-pilot-1-ac87adf6cd9c9904` |
| Automated tests | **179 passing, 0 failing, 0 skipped, 0 todo** |
| Browser | Chrome 152.0.7977.76 (Chromium, Windows), Web Locks available |
| Status | **DEVELOPMENT BUILD — not a participant release** |

---

## 1. Issue → fix → regression test → browser evidence

### A. Persistence and withdrawal

| Issue | Fix | Regression test | Browser evidence |
|---|---|---|---|
| **Two interleaved saves could both pass the revision check.** `getItem` then `setItem` is not a transaction: both tabs read the same revision, both write, one rating is lost. Reproduced: 2 ratings in, **1 row stored**. | `SessionStore.commit()` is a real critical section — Web Locks where available, and the mutator always receives the **latest stored state**, so a write cannot drop rows it never saw. `commitTo()` merges by `stimulusId` instead of replacing. | `A: equal-revision interleaving does not lose a rating` · `A: a commit merges onto the LATEST state` | Two tabs on the built bundle: read-only tab's write attempt left the record byte-identical (3 rows before and after) |
| **A stale tab's forced withdrawal replaced a newer session with fewer rows.** Reproduced: **2 rows → 0**. | `withdrawLatest()` applies withdrawal to the latest stored session inside the lock, unions in any rows the withdrawing tab holds, and marks them all `X2-withdrawn` under the documented audit-retention policy. `force: true` is gone. | `A: a stale tab withdrawal preserves the newer rows under audit retention` | Stale tab withdrew while the owner held 5 rows → **5 rows preserved**, all flagged, ratings `[6,2,5,7,3]` retained |
| No single-active-tab policy | Lease with TTL 15s + 5s heartbeat. A second tab is **read-only** and says so. | `A: single-active-tab policy refuses a non-owner write with a safe reason` | Second tab: `readOnly: true`, `isOwner: false`, message shown, record unchanged |
| Tab suspension | Lease expiry permits safe takeover; prior rows survive. | `A: suspension then resumption` | covered by the Node test (clock injection); browser lease observed active |
| Erasure could be resurrected | Tombstone key; `commit()` refuses with `session-erased`. | `A: erasure leaves a tombstone and cannot be resurrected` | Erase in tab 1 → tab 2 commit refused `session-erased`, key stays absent |
| Corrupt data was **destroyed** | `quarantineCorrupt()` moves the bytes aside under a timestamped key; `commit()` refuses to act on corrupt data. | `A: corrupt saved data is QUARANTINED, never destroyed` · `A: commit refuses to act on corrupt data` | Corrupt value → quarantined to `…/corrupt-2026-09-13T17-21-54-313Z`, **original bytes preserved**, message names the key |

### B. Frozen identity binding

| Issue | Fix | Regression test | Browser evidence |
|---|---|---|---|
| Identity was a reusable label (`stimuli-1`) that survives a rebuild | `scripts/build-release-package.mjs` produces an immutable package: SHA-256 over spec, scorer, config, geometry, colour, app sources, effective config, **every stimulus layout**, and the scoring key. Package digest = hash of that sorted list. | `B: the release package is a content digest over every determining input` | `releasePackageId: dev-pilot-1-ac87adf6cd9c9904` loaded from the deployed bundle |
| Exports bound to labels only | Sessions carry `releasePackageId` + `releasePackageDigest`; both travel into the export. | `B: exports bind to the package DIGEST` | `digestBound: true` (64 hex chars) in the deployed bundle |
| Join did not verify identity | Join compares package digest **and** the on-disk key digest against the package record, plus per-layout digests. Mismatch aborts (exit 3). | `B: a join with a mismatched package digest is refused` | — (researcher-side) |
| Missing identity could still be used | `identityOk` gates `modelAgreement` for **every** row, even under `--allow-identity-mismatch`. | `B: an export with NO package digest cannot be used for model agreement` — 0 model-agreement eligible, all ratings retained | — |
| Silent key substitution | The key's digest must match the one frozen in the package, or the join refuses. | same test | — |
| Cross-version rescoring unlabelled | Every join carries `diagnosticRescoring: { performed: false, note }` requiring any rescoring to be labelled a model-comparison diagnostic and never to replace rows. | `B: a bound export joins normally` | — |

### Operational loose ends

| Issue | Fix | Evidence |
|---|---|---|
| `package.json` `test:v1` named the deleted `v1-requirements.test.mjs` | Points at `test/v1.test.mjs`; added `test:hardening`, `build:release` | `OPS: package.json scripts all reference files that exist` |
| Only the local source root was validated | `scripts/build-participant-dist.mjs` builds `dist/participant/` (19 files) and audits the **built** output | Audit clean. It caught a real leak first time: `session.js` named `study-private/stimulus-key.json` in a note that shipped to participants — removed |
| Union error claimed a universal `<1%` | `scripts/union-error-report.mjs` measures the **actual corpus** against a 4096² reference | **Corpus-specific**: max **0.2459%** at N=512, 0.0885% at N=2048. Stated as fixture-specific, not a guarantee — error grows with perimeter-to-area ratio |
| Join could overwrite the raw export | Refuses to write over the raw export **or** any existing output (exit 4) | `B: the join NEVER overwrites the raw export or an existing output` |

---

## 2. Exact tested identities

```
branch        feature/doasa-v1-research-instrument
package       dev-pilot-1-ac87adf6cd9c9904
packageDigest ac87adf6cd9c990447e2237eea4cf21d58f431f4a657fcc369e0b1c127fd1955
model         v1-development-candidate
config        v1-config-draft-1            digest 51eaa586fc82e358…
spec          V1-SPECIFICATION draft-2 (reconciled 2026-09-13)
renderer      renderer-2
manifest      stimuli-1   (13 stimuli)
key           stimulus-key-2               digest 569a48ec6565b106…
session       rating-session-3
```

The commit hash is recorded in the delivery message; the package digest is the
binding identity and is independent of it.

---

## 3. Remaining investigator approvals

**All of S1–S21 remain unapproved** — see `docs/S1-S21-DECISION-SHEET.md`.
Additionally required before any participant release:

1. **S1–S21** sign-off, or a recorded decision to narrow v1.
2. **Protocol**: stimulus count, conditions, whether the deliberately-unscorable
   item belongs in the real set, and the primary outcome.
3. **Participant wording**: the acknowledgement text is a *development* notice,
   not research consent. Ethics review has not happened.
4. **Collection procedure**: see §4 — currently download-only.
5. **Release freeze**: a `spec_freeze_id` and the package digest recorded together.

---

## 4. Participant instructions and response transfer

### What a participant does

1. Opens the link. Sees a development-status banner and an acknowledgement page
   stating: nothing identifying is collected; answers stay in their browser until
   they choose to download; they may stop and erase at any time.
2. Rates each composition on two 1–7 scales (perceived order, visual appeal) with
   an optional free-text note. No score, condition, or method is ever shown.
3. May stop at any point (**Stop and withdraw**) or remove everything
   (**Erase everything**).
4. At the end, clicks **Download my responses**, producing
   `order-rating-<participant-id>.json` on their own device.

### How responses actually reach the researcher

**There is no server. A download is not a submission**, and the app says so.
The export carries `transmitted: false` and `mechanism: 'local-download-only'`.

The transfer procedure is therefore **out-of-band and manual**, and is currently
the weakest part of the pipeline:

1. The participant downloads the file.
2. They return it by an agreed channel — **this channel is not yet chosen, and
   choosing it is an approval item.** Any channel that carries the file also
   carries whatever identifying metadata that channel attaches (an email address,
   a filename, an upload account). The pseudonymous design inside the file does
   not protect against that.
3. The researcher stores the raw file unmodified and runs:
   `node scripts/join-responses.mjs <export.json> --out joined.json`
   The join refuses to overwrite the raw file or an existing output.

---

## 5. Ready / not ready

**NOT READY for participant release.** The blockers are not code defects:

| Blocker | Why |
|---|---|
| **S1–S21 unapproved** | The model is a development candidate. Every score is stamped `NOT APPROVED`. Collecting ratings against an unapproved model risks a dataset that cannot support the analysis it was gathered for. |
| **No ethics/consent review** | The current text is a development acknowledgement. It is not consent for research participation. |
| **No agreed collection channel** | §4. The manual return path is undefined, and the channel itself can reintroduce identifying information the instrument deliberately avoids. |
| **Specification not frozen** | No `spec_freeze_id`. Anything collected now is development data by definition. |
| **Single browser engine** | Only Chromium 152. Web Locks is present there; on an engine without it the lease is the only exclusion mechanism, and that path has Node tests but no browser evidence. |

**Ready for:** investigator review of the decision sheet, and a supervised
internal pilot with non-participants to check wording and flow — provided its
output is treated as development data.

### Additional blocker identified this pass

**The collection channel is a data-integrity and privacy risk that the
instrument cannot mitigate.** Everything inside the file is pseudonymous, but
the return path is not: an emailed attachment carries an address, an upload
carries an account. This needs a decision before recruitment, not after, and it
is the one item here that could compromise the protocol rather than merely delay
it.

No other blocker demonstrably threatens data integrity at this commit.
