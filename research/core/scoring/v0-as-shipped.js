/**
 * v0 — "the scorer extracted from commit bf617e4".
 *
 * PROVENANCE WARNING
 * This is NOT established to be "the scorer that produced the published
 * results." Commit bf617e4 contains no Golden Ratio or Free-Form Grid preset,
 * yet the manuscript's Study 3 reports scores for both, and archived
 * screenshots in Previous study/SSS.docx show at least three other
 * applications. Historical provenance is UNRESOLVED. See research/legacy/PROVENANCE.md.
 *
 * BUG-FOR-BUG FIDELITY IS THE CONTRACT
 * Every known defect is preserved deliberately and is covered by
 * characterization tests. Do not "fix" anything here. Corrected behaviour
 * belongs to v1. In particular this module preserves:
 *
 *   - the 0.19 harmony weight and the absence of any /0.90 divisor
 *   - hexToRgb returning {0,0,0} for any non-hex string (e.g. the hsl(...)
 *     strings written by the colorHarmony preset), which zeroes the saturation
 *     term and forces analyzeSpatial's balance to a constant 10/10
 *   - rotation contributing to structure and harmony for rotation-invariant
 *     shapes (circles)
 *   - linear mean/SD over rotation angles (no circular statistics)
 *   - the /1.5 structure normaliser, whose attainable maximum is 14/1.5 = 9.33
 *   - element areas summed without union, so whitespace can go negative
 *
 * Colour strings are consumed EXACTLY as stored. Callers must not normalise
 * colours before calling this module; doing so would repair the colour defect
 * and silently break equivalence with the original.
 *
 * Purity: depends only on its arguments. No DOM, no globals, no Math.random.
 */

export const MODEL_VERSION = 'v0-as-shipped';
export const MODEL_SOURCE_COMMIT = 'bf617e4712079e26043ea62b2e797844680e9bf3';

/** Frozen configuration transcribed from the archived source. */
export const V0_CONFIG = Object.freeze({
  configVersion: 'v0-config-1',
  canvasSize: 500, // CANVAS_SIZE, index.bf617e4.html L1395
  gridSize: 8, // GRID_SIZE, L1396
  weights: Object.freeze({
    hierarchy: 0.2,
    grouping: 0.18,
    structure: 0.16,
    flow: 0.15,
    spatial: 0.12,
    harmony: 0.19, // NOT 0.09; no /0.90 divisor. See AUDIT.md finding 1.
  }),
  overallMultiplier: 10,
});

// ---------------------------------------------------------------------------
// Element-level primitives — transcribed from the Element class (L1405-1547)
// ---------------------------------------------------------------------------

/** L1515. Returns {0,0,0} for ANY non-hex input. Defect preserved. */
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 0, g: 0, b: 0 };
}

/** L1524. */
export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h;
  let s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** L1489. Analytic shape area; no clipping, no union. */
export function getArea(e) {
  switch (e.type) {
    case 'circle':
      return Math.PI * (e.size / 2) ** 2;
    case 'square':
      return e.size ** 2;
    case 'rectangle':
      return e.size * e.size2;
    case 'triangle':
      return (e.size ** 2) * Math.sqrt(3) / 4;
    default:
      return 0;
  }
}

/** L1499. `contrastFactor` is a fill flag, not luminance contrast. Area is unnormalised. */
export function getVisualWeight(e, cfg = V0_CONFIG) {
  if (!e.visible) return 0;
  const C = cfg.canvasSize;
  const sizeFactor = getArea(e) / (C * C);
  const contrastFactor = e.filled ? 0.8 : 0.4;
  const distFromCenter = Math.sqrt((e.x - C / 2) ** 2 + (e.y - C / 2) ** 2);
  const maxDist = Math.sqrt((C / 2) ** 2 + (C / 2) ** 2);
  const positionFactor = 1 - distFromCenter / maxDist;
  const rgb = hexToRgb(e.color);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const saturationFactor = hsl.s / 100;
  return sizeFactor * 0.4 + contrastFactor * 0.3 + positionFactor * 0.2 + saturationFactor * 0.1;
}

// ---------------------------------------------------------------------------
// Dimension scorers — transcribed from L2065-2177
// ---------------------------------------------------------------------------

export function analyzeHierarchy(els, cfg = V0_CONFIG) {
  const weights = els.map((e) => getVisualWeight(e, cfg));
  if (weights.length < 2) return 5.0;
  const uniqueWeights = new Set(weights.map((w) => Math.round(w * 10) / 10)).size;
  const range = Math.max(...weights) - Math.min(...weights);
  const avgWeight = weights.reduce((a, b) => a + b) / weights.length;
  const variance = weights.reduce((sum, w) => sum + (w - avgWeight) ** 2, 0) / weights.length;
  return Math.min(10, uniqueWeights * 2 + range * 5 + Math.sqrt(variance) * 3);
}

export function analyzeGrouping(els) {
  if (els.length < 2) return 10.0;
  const distances = [];
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      distances.push(Math.sqrt((els[i].x - els[j].x) ** 2 + (els[i].y - els[j].y) ** 2));
    }
  }
  const avgDist = distances.reduce((a, b) => a + b) / distances.length;
  const stdDev = Math.sqrt(
    distances.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / distances.length,
  );
  // avgDist === 0 for coincident elements => 0/0 => NaN. Preserved.
  return Math.min(10, (stdDev / avgDist) * 15);
}

export function analyzeStructure(els, cfg = V0_CONFIG) {
  const G = cfg.gridSize;
  const xPositions = els.map((e) => e.x);
  const yPositions = els.map((e) => e.y);
  const xGridScore = xPositions.filter((x) => Math.abs(x % G) < 2).length / xPositions.length;
  const yGridScore = yPositions.filter((y) => Math.abs(y % G) < 2).length / yPositions.length;
  const sizes = els.map((e) => e.size);
  const avgSize = sizes.reduce((a, b) => a + b) / sizes.length;
  const sizeVariance = sizes.reduce((sum, s) => sum + (s - avgSize) ** 2, 0) / sizes.length;
  const sizeConsistency = 1 - Math.min(1, Math.sqrt(sizeVariance) / avgSize);
  // Includes circles, which render identically at any rotation. Defect preserved.
  // Note `r % 15 < 2` is true for ALL negative r, since JS % keeps the sign.
  const rotations = els.map((e) => e.rotation);
  const rotationAlignment = rotations.filter((r) => r % 15 < 2).length / rotations.length;
  // Attainable maximum is ((1+1)*4 + 4 + 2)/1.5 = 9.33, within [0,10] but
  // never reaching it. Do NOT remove the divisor here; see DECISIONS-v1.md C5.
  return ((xGridScore + yGridScore) * 4 + sizeConsistency * 4 + rotationAlignment * 2) / 1.5;
}

export function analyzeFlow(els, cfg = V0_CONFIG) {
  if (els.length < 2) return 10.0;
  const sorted = [...els].sort((a, b) => getVisualWeight(b, cfg) - getVisualWeight(a, cfg));
  let score = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const xDiff = sorted[i + 1].x - sorted[i].x;
    const yDiff = sorted[i + 1].y - sorted[i].y;
    if (xDiff >= 0 && yDiff >= 0) score += 1;
    else if (Math.abs(yDiff) < Math.abs(xDiff) && xDiff > 0) score += 0.7;
    else if (Math.abs(xDiff) < Math.abs(yDiff) && yDiff > 0) score += 0.6;
    else score += 0.3;
  }
  return (score / (sorted.length - 1)) * 10;
}

export function analyzeSpatial(els, cfg = V0_CONFIG) {
  const C = cfg.canvasSize;
  const totalArea = C * C;
  // Summed, not unioned: overlapping elements can drive this above totalArea.
  const occupiedArea = els.reduce((sum, e) => sum + getArea(e), 0);
  const whiteSpaceRatio = (totalArea - occupiedArea) / totalArea;
  const whiteSpaceScore = 10 - Math.abs(whiteSpaceRatio - 0.4) * 15; // target 0.4, not 0.5

  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  for (const e of els) {
    const rgb = hexToRgb(e.color);
    const L = Math.pow(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b, 1 / 2.2) / 255;
    const weight = getArea(e) * L;
    weightedX += e.x * weight;
    weightedY += e.y * weight;
    totalWeight += weight;
  }
  // When every colour fails to parse (all hsl strings), totalWeight === 0 and
  // this fallback pins the centroid to the canvas centre => balanceScore = 10.
  const centerX = totalWeight > 0 ? weightedX / totalWeight : C / 2;
  const centerY = totalWeight > 0 ? weightedY / totalWeight : C / 2;
  const deviation = Math.sqrt((centerX - C / 2) ** 2 + (centerY - C / 2) ** 2);
  const balanceScore = 10 - (deviation / (C / 2)) * 5;
  return (Math.max(0, whiteSpaceScore) + Math.max(0, balanceScore)) / 2;
}

export function analyzeHarmony(els) {
  const sizes = els.map((e) => e.size);
  const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const sizeVariance = sizes.reduce((sum, s) => sum + (s - avgSize) ** 2, 0) / sizes.length;
  const sizeDiversity = Math.sqrt(sizeVariance) / avgSize;
  // Linear mean/SD over a circular quantity: 350 and 10 read as 340 apart.
  const rotations = els.map((e) => e.rotation);
  const avgRotation = rotations.reduce((a, b) => a + b) / rotations.length;
  const rotationVariance =
    rotations.reduce((sum, r) => sum + (r - avgRotation) ** 2, 0) / rotations.length;
  const rotationConsistency = 1 - Math.min(1, Math.sqrt(rotationVariance) / 180);
  const filledCount = els.filter((e) => e.filled).length;
  const filledRatio = filledCount / els.length;
  // Maximised at a 50/50 split, despite the name. Defect preserved.
  const filledConsistency = Math.min(filledRatio, 1 - filledRatio) * 2;
  const sizeScore = Math.max(0, 10 - Math.abs(sizeDiversity - 0.3) * 20);
  const rotationScore = rotationConsistency * 10;
  const filledScore = filledConsistency * 10;
  return sizeScore * 0.5 + rotationScore * 0.3 + filledScore * 0.2;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Deterministic pure scorer.
 *
 * @param {object} layout   canonical layout (see core/layout.js)
 * @param {object} cfg      versioned scoring configuration
 * @returns {{total:number, dimensions:object, submetrics:object, modelVersion:string,
 *            configVersion:string, elementCount:number}}
 *
 * Every returned measure is a GEOMETRIC PROXY computed from layout coordinates
 * and colour values. Nothing here measures gaze, attention, or perception.
 *
 * Invalid outputs (NaN, out-of-range) are returned AS PRODUCED. Use
 * core/scoring/validate.js to detect them; this module never substitutes a
 * plausible value.
 */
export function score(layout, cfg = V0_CONFIG) {
  const visible = layout.elements.filter((e) => e.visible);
  const w = cfg.weights;

  if (visible.length === 0) {
    // Mirrors analyzeOrder()'s early return (L2041-2044).
    const zeros = { hierarchy: 0, grouping: 0, structure: 0, flow: 0, spatial: 0, harmony: 0 };
    return {
      total: 0,
      dimensions: zeros,
      submetrics: {},
      modelVersion: MODEL_VERSION,
      configVersion: cfg.configVersion,
      elementCount: 0,
      measureKind: 'geometric-proxy',
    };
  }

  const dimensions = {
    hierarchy: analyzeHierarchy(visible, cfg),
    grouping: analyzeGrouping(visible),
    structure: analyzeStructure(visible, cfg),
    flow: analyzeFlow(visible, cfg),
    spatial: analyzeSpatial(visible, cfg),
    harmony: analyzeHarmony(visible),
  };

  const total =
    (dimensions.hierarchy * w.hierarchy +
      dimensions.grouping * w.grouping +
      dimensions.structure * w.structure +
      dimensions.flow * w.flow +
      dimensions.spatial * w.spatial +
      dimensions.harmony * w.harmony) *
    cfg.overallMultiplier;

  return {
    total,
    dimensions,
    submetrics: submetrics(visible, cfg),
    modelVersion: MODEL_VERSION,
    configVersion: cfg.configVersion,
    elementCount: visible.length,
    measureKind: 'geometric-proxy',
  };
}

/**
 * Intermediate quantities exposed for inspection. These are NOT part of the
 * v0 score path — they are recomputed here for transparency, and changing them
 * cannot change `score()`.
 */
export function submetrics(visible, cfg = V0_CONFIG) {
  const C = cfg.canvasSize;
  const weights = visible.map((e) => getVisualWeight(e, cfg));
  const occupied = visible.reduce((s, e) => s + getArea(e), 0);
  const unparseableColors = visible.filter((e) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.test(e.color);
    return !m;
  }).length;
  return {
    visualWeights: weights,
    occupiedArea: occupied,
    whiteSpaceRatio: (C * C - occupied) / (C * C),
    unparseableColorCount: unparseableColors,
    // True when analyzeSpatial's balance term has degenerated to a constant 10.
    balanceDegenerate: unparseableColors === visible.length,
  };
}
