# order-study-site

Public hosting for the ORDER blind-rating instrument.

This repository contains **only** the audited participant bundle in `site/` and
`site-manifest.json`, which lists the SHA-256 of every file in it together with
the release package digest and the source commit it was exported from. It is
generated; do not edit `site/` by hand.

- Source, tests and documentation: `ApratimPanwar/Order` (`research/`).
- Private build inputs, researcher keys and responses are never stored here.
- Publishing is manual: **Actions → Deploy study site → Run workflow**, giving the
  exact package digest and release mode. `tools/verify-site.mjs` refuses to
  publish anything that does not match the manifest.

The release mode is shown on every page. A `development` build is a software
rehearsal: nothing collected through it is study data.
