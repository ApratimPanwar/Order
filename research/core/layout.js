/**
 * Canonical layout state.
 *
 * Design rules that must not be relaxed:
 *
 *  - `color` stores the ORIGINAL string exactly as the application produced it
 *    (`#1F2937`, `hsl(210, 70%, 45%)`, anything). Normalising colours here
 *    would repair v0's colour-parsing defect and silently break equivalence
 *    with the original JavaScript. If v1 wants normalised colour, it must do so
 *    through an explicit, versioned conversion that leaves the archived state
 *    intact.
 *  - Coordinates are LOGICAL canvas units, independent of viewport or device
 *    pixel ratio.
 *  - `order` is explicit drawing order; it is not implied by array position.
 *  - Full states are saved, never a seed alone. A seed plus an RNG version
 *    reproduces a generation, but presets and application builds change, so the
 *    resulting state is recorded too.
 */

export const SCHEMA_VERSION = 'layout-1';

export const SHAPE_TYPES = Object.freeze(['circle', 'square', 'rectangle', 'triangle']);

/** @returns {object} a canonical, frozen-shape layout object. */
export function createLayout({
  id,
  canvas = { width: 500, height: 500, background: '#FFFFFF' },
  elements = [],
  renderer = { gridOverlay: true, gridSize: 8, showArrows: false },
  meta = {},
} = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id ?? null,
    canvas: { ...canvas },
    renderer: { ...renderer },
    elements: elements.map(normalizeElement),
    meta: { ...meta },
  };
}

/** Fills defaults without touching colour or any other rendering-relevant value. */
export function normalizeElement(e) {
  if (!SHAPE_TYPES.includes(e.type)) {
    throw new Error(`unknown element type: ${JSON.stringify(e.type)}`);
  }
  return {
    id: e.id ?? `${e.type}-${e.index}`,
    type: e.type,
    index: e.index,
    order: e.order,
    visible: Boolean(e.visible),
    x: e.x,
    y: e.y,
    size: e.size,
    size2: e.size2 ?? e.size,
    rotation: e.rotation,
    color: e.color, // verbatim
    filled: Boolean(e.filled),
  };
}

const ELEMENT_KEYS = [
  'id', 'type', 'index', 'order', 'visible',
  'x', 'y', 'size', 'size2', 'rotation', 'color', 'filled',
];

/**
 * Deterministic serialization: stable key order, no floating-point rewriting.
 * The same layout always produces byte-identical output.
 */
export function serialize(layout) {
  const ordered = {
    schemaVersion: layout.schemaVersion,
    id: layout.id,
    canvas: {
      width: layout.canvas.width,
      height: layout.canvas.height,
      background: layout.canvas.background,
    },
    renderer: {
      gridOverlay: layout.renderer.gridOverlay,
      gridSize: layout.renderer.gridSize,
      showArrows: layout.renderer.showArrows,
    },
    elements: [...layout.elements]
      .sort((a, b) => a.order - b.order)
      .map((e) => Object.fromEntries(ELEMENT_KEYS.map((k) => [k, e[k]]))),
    meta: layout.meta,
  };
  return JSON.stringify(ordered);
}

export function deserialize(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `unsupported layout schemaVersion ${raw.schemaVersion}; this build reads ${SCHEMA_VERSION}`,
    );
  }
  return createLayout(raw);
}

/** Structural clone. Used by preview so the committed layout is never aliased. */
export function cloneLayout(layout) {
  return deserialize(serialize(layout));
}

/** Content hash for linking screenshots and event records to an exact state. */
export function layoutHash(layout) {
  const s = serialize(layout);
  // FNV-1a 32-bit, rendered as 8 hex chars. Sufficient for record linkage.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function layoutsEqual(a, b) {
  return serialize(a) === serialize(b);
}
