/**
 * v1 configuration.  (V1-SPECIFICATION §11)
 *
 * APPROVAL STATUS IS PART OF THE DATA.
 * None of the 21 sign-off items (S1-S21) has explicit investigator approval.
 * Every parameter below therefore carries `approvalStatus: 'development-candidate'`
 * and the whole config is stamped `DEVELOPMENT CANDIDATE - NOT APPROVED`.
 *
 * The scorer copies this status into every result. A score produced under an
 * unapproved config is labelled as such in the record itself, so no downstream
 * artifact can silently present it as an approved measurement.
 *
 * Approving an item means changing its `approvalStatus` to 'approved' HERE and
 * recording the decision. Nothing infers approval from the existence of this
 * file, from tests passing, or from a default value being present.
 */

export const MODEL_VERSION = 'v1-development-candidate';
export const CONFIG_VERSION = 'v1-config-draft-1';
export const SPEC_VERSION = 'V1-SPECIFICATION draft-2 (reconciled 2026-09-13)';

/** No item is approved. Do not edit except as a recorded investigator decision. */
export const APPROVAL_STATE = Object.freeze({
  overall: 'DEVELOPMENT CANDIDATE - NOT APPROVED',
  approvedItems: Object.freeze([]),
  pendingItems: Object.freeze(
    Array.from({ length: 21 }, (_, i) => `S${i + 1}`),
  ),
  note: 'Design directions (renderer-2, six-dimensional successor, fixed complete-score '
    + 'primary analysis) were approved 2026-09-13. The 21 parameter/definition items were not.',
});

const p = (value, signoff, note) => Object.freeze({
  value, signoff, approvalStatus: 'development-candidate', note,
});

export const V1_CONFIG = Object.freeze({
  modelVersion: MODEL_VERSION,
  configVersion: CONFIG_VERSION,
  specVersion: SPEC_VERSION,
  approval: APPROVAL_STATE,

  canvas: Object.freeze({ width: 500, height: 500, background: '#FFFFFF' }),

  // --- geometry / rendering ------------------------------------------------
  renderer: p('renderer-2', 'design-direction', 'Approved as a design direction 2026-09-13.'),
  circleFacets: p(64, 'S18', 'Inscribed at 64: radial 0.1205%, area 0.1606%.'),
  circleMode: p('area-matched', 'S18', 'Zero area error by construction; radial +0.080%/-0.040%.'),
  areaBasis: p('occupied-footprint', 'S18',
    'An outlined element counts the same as a filled one. renderedInk is the alternative.'),
  unionGridN: p(512, 'S18', 'Sampling resolution for the footprint union. Recorded, not hidden.'),

  // --- prominence ----------------------------------------------------------
  prominenceWeights: p(Object.freeze({ area: 0.4, contrast: 0.3, position: 0.2, chroma: 0.1 }),
    'S12', 'From the manuscript.'),
  kappa: p(0.5, 'S1', 'Outline-element contrast factor. Wholly novel.'),

  // --- dimension submetric weights ----------------------------------------
  submetricWeights: p(Object.freeze({
    hierarchy: Object.freeze([0.5, 0.3, 0.2]),
    grouping: Object.freeze([1 / 3, 1 / 3, 1 / 3]),
    structure: Object.freeze([1 / 3, 1 / 3, 1 / 3]),
    flow: Object.freeze([1 / 3, 1 / 3, 1 / 3]),
    spatial: Object.freeze([0.2, 0.2, 0.2, 0.2, 0.2]),
    variety: Object.freeze([0.5, 0.5]),
  }), 'S12/S13/S14/S15/S16/S17', 'Hierarchy from the manuscript; the rest equal after removals.'),

  // --- grouping ------------------------------------------------------------
  dbscanEpsFactor: p(1.5, 'S13', 'eps = 1.5 * beta (from the manuscript).'),
  dbscanMinPts: p(2, 'S9', 'The manuscript omits minPts entirely.'),
  separationGapFactor: p(3, 'S13', 'Normaliser 3*beta for inter-cluster separation.'),
  deltaERef: p(50, 'S17', 'Reference dE00 for colour similarity and palette coherence.'),

  // --- structure -----------------------------------------------------------
  gridPitch: p(8, 'S2', 'The app baseline grid.'),
  gridTolerance: p(2, 'S2', '0.25 * pitch. The manuscript 15px on an 8px pitch is vacuous.'),
  alignTolerance: p(5, 'S20', '0.01 * min(W,H).'),

  // --- flow ----------------------------------------------------------------
  flowCostWeights: p(Object.freeze({ distance: 0.5, turn: 0.5 }), 'S15', 'Novel split.'),
  readingOrder: p('ltr-ttb', 'S11', 'Recorded per study; addresses a stated manuscript limitation.'),
  readingRowBands: p(3, 'S15', 'Row banding for the reading-order comparison.'),

  // --- spatial -------------------------------------------------------------
  whitespaceTarget: p(0.40, 'S3', 'WHITESPACE, not ink. Manuscript implies 0.5; v0 uses 0.4.'),
  densityGridK: p(5, 'S16', 'K x K occupancy grid for density evenness.'),

  // --- variety-harmony -----------------------------------------------------
  diversityTarget: p(0.5, 'S4', 'Midpoint of a composite whose midpoint has no established meaning.'),
  hueBins: p(12, 'S17', 'Hue entropy binning.'),
  chromaThreshold: p(10, 'S17', 'C*ab >= 10 counts as chromatic.'),
  modularTolerance: p(0.10, 'S19', 'RELATIVE to the module m0, not an absolute pixel value.'),

  // --- aggregation ---------------------------------------------------------
  dimensionWeights: p(Object.freeze({
    hierarchy: 0.20 / 0.90,
    grouping: 0.18 / 0.90,
    structure: 0.16 / 0.90,
    flow: 0.15 / 0.90,
    spatial: 0.12 / 0.90,
    variety: 0.09 / 0.90,
  }), 'S5', 'Manuscript weights normalised. v0 code used 0.19 for variety, not 0.09.'),

  // --- applicability -------------------------------------------------------
  minElements: p(4, 'S10', 'Follows from m_h,3 needing a 2-element tail.'),
  minDistinctPositions: p(2, 'S10',
    'Grouping dispersion is undefined when every element shares one point.'),
});

/** Flattens the config to plain values for the scorer. */
export function effectiveConfig(cfg = V1_CONFIG) {
  const out = { canvas: cfg.canvas };
  for (const [k, v] of Object.entries(cfg)) {
    if (v && typeof v === 'object' && 'approvalStatus' in v) out[k] = v.value;
  }
  return out;
}

/** The approval record copied into every score result. */
export function approvalRecord(cfg = V1_CONFIG) {
  const items = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v && typeof v === 'object' && 'approvalStatus' in v) {
      items[k] = { signoff: v.signoff, approvalStatus: v.approvalStatus };
    }
  }
  return {
    overall: cfg.approval.overall,
    pendingItems: cfg.approval.pendingItems,
    approvedItems: cfg.approval.approvedItems,
    perParameter: items,
  };
}
