/**
 * Original-JavaScript reference harness.
 *
 * Loads the ARCHIVED original source verbatim and evaluates its single <script>
 * block in a VM context with a minimal window/document stub. Nothing in that
 * script runs at evaluation time (`window.onload = init` is the last statement),
 * so no DOM is required to obtain the original functions.
 *
 * This exists so equivalence tests compare the extracted v0 scorer against THE
 * ORIGINAL JAVASCRIPT, not against a translated port.
 *
 * Reference source: research/legacy/index.bf617e4.html
 *   commit     bf617e4712079e26043ea62b2e797844680e9bf3  (main, 2025-10-23)
 *   git blob   a6043f187bc5b0654309962d836b61b8dbdab360
 *   sha256     2fa6cbc12ee6bb01732523a7b2c91d97c5ac8909d901302a70acb1e389999e5e
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REFERENCE_FILE = join(HERE, 'index.bf617e4.html');
export const REFERENCE_COMMIT = 'bf617e4712079e26043ea62b2e797844680e9bf3';
export const REFERENCE_SHA256 =
  '2fa6cbc12ee6bb01732523a7b2c91d97c5ac8909d901302a70acb1e389999e5e';

function extractScript(html) {
  const open = html.indexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open === -1 || close === -1) throw new Error('no <script> block found');
  return html.slice(open + '<script>'.length, close);
}

/**
 * Returns the original functions/classes, evaluated from the archived source.
 * Each call builds a fresh context so tests cannot leak state into each other.
 */
export function loadOriginal() {
  const html = readFileSync(REFERENCE_FILE, 'utf8');
  const source = extractScript(html);

  // Minimal stubs. Only `window` is touched at evaluation time (the final
  // `window.onload = init`). Everything else is present so that accidentally
  // calling a DOM-bound function throws a clear error rather than a ReferenceError.
  const notLoaded = (name) => () => {
    throw new Error(`original ${name}() requires a DOM; not available in the reference harness`);
  };
  const sandbox = {
    window: {},
    document: {
      getElementById: notLoaded('document.getElementById'),
      querySelectorAll: notLoaded('document.querySelectorAll'),
      addEventListener() {},
    },
    console,
    Math,
    JSON,
    Set,
    Object,
    Array,
    Number,
    String,
  };

  const context = vm.createContext(sandbox);

  // Top-level `class` and `const` bindings live in the script's lexical scope,
  // not on the VM global, so they must be captured from inside that scope. This
  // appended statement only reads the original bindings; it does not alter them.
  const capture = `
;globalThis.__captured = {
  Element, CANVAS_SIZE, GRID_SIZE, PHI, SHAPE_TYPES,
  analyzeHierarchy, analyzeGrouping, analyzeStructure,
  analyzeFlow, analyzeSpatial, analyzeHarmony,
  applyShapeGrouping, applySizeUniformity, applyStrictGrid,
  applyVisualWeightHierarchy, applyRhythmicSpacing, applyProximityClustering,
  applyAdvancedBalance, applyRotationalAlignment, applyAverageFaceDirection,
  applyBilateralSymmetry, applyColorHarmony, applyRadialDistribution
};`;

  vm.runInContext(source + capture, context, { filename: 'index.bf617e4.html <script>' });

  const c = context.__captured;
  if (!c || typeof c.Element !== 'function') {
    throw new Error('failed to capture original bindings from the archived source');
  }

  return {
    Element: c.Element,
    CANVAS_SIZE: c.CANVAS_SIZE,
    GRID_SIZE: c.GRID_SIZE,
    PHI: c.PHI,
    SHAPE_TYPES: c.SHAPE_TYPES,
    analyzeHierarchy: c.analyzeHierarchy,
    analyzeGrouping: c.analyzeGrouping,
    analyzeStructure: c.analyzeStructure,
    analyzeFlow: c.analyzeFlow,
    analyzeSpatial: c.analyzeSpatial,
    analyzeHarmony: c.analyzeHarmony,
    presets: {
      'shape-grouping': c.applyShapeGrouping,
      'size-uniformity': c.applySizeUniformity,
      'strict-grid': c.applyStrictGrid,
      'visual-hierarchy': c.applyVisualWeightHierarchy,
      'rhythmic-spacing': c.applyRhythmicSpacing,
      'proximity-clustering': c.applyProximityClustering,
      'visual-balance': c.applyAdvancedBalance,
      'rotation-alignment': c.applyRotationalAlignment,
      'average-face-direction': c.applyAverageFaceDirection,
      'bilateral-symmetry': c.applyBilateralSymmetry,
      'color-harmony': c.applyColorHarmony,
      'radial-distribution': c.applyRadialDistribution,
    },
    context,
  };
}

/**
 * Builds original Element instances from a canonical layout's element list.
 * Properties are assigned directly so the original prototype methods
 * (getArea, getVisualWeight, hexToRgb, rgbToHsl) operate on original data.
 */
export function toOriginalElements(Element, elements) {
  return elements.map((e) => {
    const inst = new Element(e.type, e.index);
    inst.id = e.id;
    inst.visible = e.visible;
    inst.x = e.x;
    inst.y = e.y;
    inst.size = e.size;
    inst.size2 = e.size2;
    inst.rotation = e.rotation;
    inst.color = e.color; // original string, preserved verbatim
    inst.filled = e.filled;
    return inst;
  });
}

/**
 * Reproduces the original analyzeOrder() combination step, minus the DOM writes.
 * Mirrors index.bf617e4.html L2039-2063 exactly, including the 0.19 harmony
 * weight and the absence of any /0.90 divisor.
 */
export function originalOverall(original, elements) {
  const visible = elements.filter((e) => e.visible);
  if (visible.length === 0) {
    return { overall: 0, hierarchy: 0, grouping: 0, structure: 0, flow: 0, spatial: 0, harmony: 0 };
  }
  const hierarchy = original.analyzeHierarchy(visible);
  const grouping = original.analyzeGrouping(visible);
  const structure = original.analyzeStructure(visible);
  const flow = original.analyzeFlow(visible);
  const spatial = original.analyzeSpatial(visible);
  const harmony = original.analyzeHarmony(visible);
  const overall =
    (hierarchy * 0.2 +
      grouping * 0.18 +
      structure * 0.16 +
      flow * 0.15 +
      spatial * 0.12 +
      harmony * 0.19) *
    10;
  return { overall, hierarchy, grouping, structure, flow, spatial, harmony };
}

/**
 * Runs an ORIGINAL preset function over original Element instances and returns
 * the resulting element STATE, so a comparison can check geometry directly
 * rather than inferring agreement from a score.
 *
 * The original functions mutate in place and operate only on the visible
 * subset, exactly as applyOrderMode() did (it passed getVisibleElements()).
 */
export function applyOriginalPreset(original, layout, presetId) {
  const fn = original.presets[presetId];
  if (!fn) throw new Error(`original has no preset: ${presetId}`);
  const all = toOriginalElements(original.Element, layout.elements);
  const visible = all.filter((e) => e.visible);
  fn(visible);
  return all.map((e) => ({
    id: e.id,
    type: e.type,
    index: e.index,
    visible: e.visible,
    x: e.x,
    y: e.y,
    size: e.size,
    size2: e.size2,
    rotation: e.rotation,
    color: e.color,
    filled: e.filled,
  }));
}
