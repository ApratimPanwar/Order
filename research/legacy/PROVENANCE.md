# Provenance of the archived scorer — UNRESOLVED

## What `v0` is

`v0` is **the scorer extracted from commit `bf617e4`**. That is the whole of the
claim. It is deliberately not called "the scorer that produced the published
results."

| | |
|---|---|
| File | `research/legacy/index.bf617e4.html` (verbatim archive) |
| Commit | `bf617e4712079e26043ea62b2e797844680e9bf3` (`main`, 2025-10-23) |
| git blob | `a6043f187bc5b0654309962d836b61b8dbdab360` |
| sha256 | `2fa6cbc12ee6bb01732523a7b2c91d97c5ac8909d901302a70acb1e389999e5e` |
| Pinned by | `test/equivalence.test.mjs` — the suite fails if the archive is edited |

## Why provenance cannot be asserted

**1. The manuscript reports scores from presets that do not exist at `bf617e4`.**
Study 3 reports "Mode 6 (Golden Ratio)" 88.7% and "Mode 10 (Free-Form Grid)"
82.4%. Commit `bf617e4` implements neither. Its twelve presets are
`shape, size, grid, hierarchy, rhythm, proximity, balance, rotation, avgface,
symmetry, color, radial`. Whatever produced those two numbers was not this
build.

**2. Three mode taxonomies exist and none reconcile.**

| Source | Scheme |
|---|---|
| `bf617e4` | 12 string-keyed presets, unnumbered |
| `Previous study/SSS.docx` §4.3 | 11 numbered modes, different names; Mode 8 specified as k-means |
| Manuscript §3 | grouping specified as DBSCAN; Study 3 cites Modes 6/8/9/10 |

**3. At least four distinct applications appear in the project record.**
Images embedded in `Previous study/SSS.docx` show:

| Evidence | Application |
|---|---|
| `word/media/image4.png` | **Order Composer** — 12 presets matching `bf617e4` exactly, "16 total" elements, displayed score 54% |
| `word/media/image5–16.png` | **"Row-Based Grid Composer"** — 59 elements (16/14/14/15), a "Shannon's Entropy" readout of 1.835, phases Grid Snapping / Row Organization / Color Unification |
| `word/media/image17–26.png` | an unnamed dark-theme tool with an ITERATION counter, GRID SIZE and ORDER percentage controls |
| `word/media/image2.png` | an interactive HTML concept map ("ORDER AS DESIGN PRINCIPLE") |

Order Composer is one tool among several that were built. Which one produced
which reported number is not recorded.

**4. Archived layouts DO exist — as screenshots, not as state.**
The earlier audit concluded from the absence of persistence code that layouts
were never archived. That inference was wrong and has been withdrawn.
`SSS.docx` contains 31 embedded images, including four portrait compositions
(`image28–31.png`, ~330×465) that correspond to the "Composition 2 / Composition
3" captions in the document text.

Note their aspect ratio: these are **portrait and monochrome blue**, whereas
Order Composer renders a **square 500×500 canvas** from an 8-colour palette.
They are therefore unlikely to be Order Composer output either.

`image4.png` additionally preserves a real displayed score (54%) together with
some per-element slider values (Circle 1: x 142, y 255, size 64, rotation 45°;
Circle 3: x 362, y 133, size 75, rotation 219°; Circle 4: x 102, y 191, size 50,
rotation 165°). This is a **partially** recoverable state — the control panel is
scrolled, so most of the sixteen elements are not visible — but it is real
recorded evidence and is worth attempting to reconstruct.

## What would resolve this

Ordered by how much each would settle:

1. Any build of the tool that implements Golden Ratio and Free-Form Grid
   presets — a later commit, a local copy, a deployment, a zip, an editor's
   local history.
2. The source of "Row-Based Grid Composer" and the dark-theme iteration tool.
3. The original composition files behind `image28–31.png`, or any export,
   screenshot set, or spreadsheet from the study sessions.
4. Confirmation of which application each manuscript study actually used.

## Rule until then

No number produced by `v0` may be presented as a reproduction of a published
value, and no published value may be relabelled as `v0` output. Where a
historical figure is cited it keeps its original label and a note that its
generating build is unidentified.
