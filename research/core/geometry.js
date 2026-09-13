/**
 * Geometry: renderers, anchors, rotation centres, scoring centroids, clipping,
 * and occupied-footprint unions.  (V1-SPECIFICATION §1.1-§1.5)
 *
 * THE THREE CONCEPTS ARE KEPT SEPARATE (§1.1) and never collapsed:
 *   anchor           - the stored (x, y); what presets set and controls edit
 *   rotationCentre   - the point rotation is applied about; renderer only
 *   scoringCentroid  - the element's area centroid; ALL scoring position terms
 *
 * They coincide for circle/square/rectangle under every renderer, and for the
 * triangle only under renderer-2. v0 used the anchor as the position for every
 * shape, which is the wrong centre for every triangle.
 *
 * AREA IS OCCUPIED FOOTPRINT, NOT RENDERED INK (§1.5). An outlined element
 * contributes exactly as much as a filled one of the same size. This is named
 * honestly throughout; `renderedInk` is a future alternative under S18.
 */

export const RENDERER_1 = 'renderer-1';
export const RENDERER_2 = 'renderer-2';

/** renderer-1 draws the triangle about its BOUNDING-BOX centre, using 0.433. */
const R1_TRI_HALF_HEIGHT = 0.433;
/** Centroid offset in the renderer-1 local frame, from the shipped literal. */
const R1_TRI_CENTROID_OFFSET = R1_TRI_HALF_HEIGHT / 3; // 0.1443333...

/**
 * Local polygon vertices, before rotation, in units of the element.
 * Circles are returned as null and handled by the caller via `circleFacets`.
 */
export function localVertices(e, renderer) {
  const s = e.size;
  const s2 = e.size2 ?? e.size;
  switch (e.type) {
    case 'square':
      return [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]];
    case 'rectangle':
      return [[-s / 2, -s2 / 2], [s / 2, -s2 / 2], [s / 2, s2 / 2], [-s / 2, s2 / 2]];
    case 'triangle':
      if (renderer === RENDERER_2) {
        // Exact sqrt(3) expressions; symmetry is exact, not sub-pixel.
        const apex = -s / Math.sqrt(3);
        const base = s / (2 * Math.sqrt(3));
        return [[0, apex], [-s / 2, base], [s / 2, base]];
      }
      // renderer-1: bounding-box centred, rounded literal preserved verbatim.
      return [[0, -R1_TRI_HALF_HEIGHT * s], [-s / 2, R1_TRI_HALF_HEIGHT * s], [s / 2, R1_TRI_HALF_HEIGHT * s]];
    case 'circle':
      return null;
    default:
      throw new Error(`unknown element type: ${e.type}`);
  }
}

/** Centroid offset in the LOCAL frame (before rotation). */
export function localCentroidOffset(e, renderer) {
  if (e.type === 'triangle' && renderer === RENDERER_1) {
    return [0, R1_TRI_CENTROID_OFFSET * e.size];
  }
  return [0, 0];
}

function rot([x, y], deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r); const s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}

/**
 * The element's area centroid in canvas coordinates.  (§1.3)
 * Equals the anchor for every shape except a renderer-1 triangle.
 */
export function scoringCentroid(e, renderer) {
  const off = localCentroidOffset(e, renderer);
  if (off[0] === 0 && off[1] === 0) return [e.x, e.y];
  const r = rot(off, e.rotation);
  return [e.x + r[0], e.y + r[1]];
}

/** The point rotation is applied about, in canvas coordinates. Renderer only. */
export function rotationCentre(e) {
  return [e.x, e.y];
}

/**
 * Canvas-space polygon for an element, rotated about its rotationCentre.
 * Circles become a regular polygon with `circleFacets` sides.
 *
 * `circleMode` (S18):
 *   'inscribed'    - vertices on the circle. radial 0.1205%, area -0.1606% at 64
 *   'area-matched' - radius scaled so polygon area == circle area exactly
 */
export function toPolygon(e, { renderer, circleFacets = 64, circleMode = 'area-matched' } = {}) {
  const [cx, cy] = rotationCentre(e);
  let local = localVertices(e, renderer);
  // A circle is rotation-invariant. Its facet polygon is NOT (a 64-gon has only
  // 64-fold symmetry), so rotating the facets would make an invisible property
  // perturb clipped area and bounding box. Circles therefore ignore rotation
  // when their polygon is built. (SPEC 1.4)
  const effectiveRotation = e.type === 'circle' ? 0 : e.rotation;

  if (local === null) {
    const n = circleFacets;
    let r = e.size / 2;
    if (circleMode === 'area-matched') {
      // Scale so (1/2) n r'^2 sin(2pi/n) == pi r^2.
      r *= Math.sqrt(Math.PI / (0.5 * n * Math.sin((2 * Math.PI) / n)));
    }
    local = Array.from({ length: n }, (_, i) => {
      const t = (2 * Math.PI * i) / n;
      return [r * Math.cos(t), r * Math.sin(t)];
    });
  }

  return local.map((p) => {
    const q = rot(p, effectiveRotation);
    return [cx + q[0], cy + q[1]];
  });
}

/** Analytic (unclipped) area of the exact shape. */
export function analyticArea(e) {
  switch (e.type) {
    case 'circle': return Math.PI * (e.size / 2) ** 2;
    case 'square': return e.size ** 2;
    case 'rectangle': return e.size * (e.size2 ?? e.size);
    case 'triangle': return (e.size ** 2 * Math.sqrt(3)) / 4;
    default: return 0;
  }
}

/** Shoelace area of a simple polygon (absolute value). */
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Sutherland-Hodgman clip of a convex-or-simple polygon to an axis-aligned rect. */
export function clipToRect(poly, { x0 = 0, y0 = 0, x1, y1 }) {
  const edges = [
    { inside: (p) => p[0] >= x0, isect: (a, b) => lerpX(a, b, x0) },
    { inside: (p) => p[0] <= x1, isect: (a, b) => lerpX(a, b, x1) },
    { inside: (p) => p[1] >= y0, isect: (a, b) => lerpY(a, b, y0) },
    { inside: (p) => p[1] <= y1, isect: (a, b) => lerpY(a, b, y1) },
  ];
  let out = poly;
  for (const e of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = e.inside(cur);
      const prevIn = e.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(e.isect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(e.isect(prev, cur));
      }
    }
    if (out.length === 0) return [];
  }
  return out;
}

function lerpX(a, b, x) {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}
function lerpY(a, b, y) {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

/** Clipped occupied-footprint area of one element. */
export function clippedArea(e, canvas, opts) {
  const poly = toPolygon(e, opts);
  const clipped = clipToRect(poly, { x1: canvas.width, y1: canvas.height });
  return clipped.length === 0 ? 0 : polygonArea(clipped);
}

/** Equivalent-disc diameter from a clipped area. */
export function equivalentDiameter(area) {
  return 2 * Math.sqrt(area / Math.PI);
}

/**
 * Union of occupied footprints, clipped to the canvas, by scanline rasterisation
 * at `unionGridN` samples per axis.
 *
 * A deterministic numerical union. Exact polygon union (Weiler-Atherton or a
 * sweep) would be exact but is materially more code for a quantity that only
 * needs enough precision to place r_ws on a [0,1] scale; the sampling resolution
 * is an explicit, recorded parameter rather than a hidden approximation.
 */
export function unionFootprintArea(elements, canvas, opts = {}) {
  const N = opts.unionGridN ?? 512;
  const polys = elements
    .map((e) => clipToRect(toPolygon(e, opts), { x1: canvas.width, y1: canvas.height }))
    .filter((p) => p.length >= 3);
  if (polys.length === 0) return 0;

  const cellW = canvas.width / N;
  const cellH = canvas.height / N;
  const cellArea = cellW * cellH;
  let covered = 0;

  // Per-polygon bounding boxes keep this near-linear in covered cells.
  const boxes = polys.map((p) => {
    const xs = p.map((q) => q[0]); const ys = p.map((q) => q[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });

  for (let j = 0; j < N; j++) {
    const cy = (j + 0.5) * cellH;
    for (let i = 0; i < N; i++) {
      const cx = (i + 0.5) * cellW;
      for (let k = 0; k < polys.length; k++) {
        const b = boxes[k];
        if (cx < b.minX || cx > b.maxX || cy < b.minY || cy > b.maxY) continue;
        if (pointInPolygon(cx, cy, polys[k])) { covered++; break; }
      }
    }
  }
  return covered * cellArea;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Axis-aligned bounding box of the clipped polygon. */
export function clippedBBox(e, canvas, opts) {
  const p = clipToRect(toPolygon(e, opts), { x1: canvas.width, y1: canvas.height });
  if (p.length === 0) return null;
  const xs = p.map((q) => q[0]); const ys = p.map((q) => q[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * Rotation symmetry period in degrees, or null for continuous (circle).  (§1.4)
 * The triangle has NO symmetry under renderer-1 because it is drawn about its
 * bounding-box centre, not its centroid.
 */
export function rotationPeriod(type, renderer) {
  switch (type) {
    case 'circle': return null;
    case 'square': return 90;
    case 'rectangle': return 180;
    case 'triangle': return renderer === RENDERER_2 ? 120 : 360;
    default: throw new Error(`unknown element type: ${type}`);
  }
}

/**
 * Period-aware circular consistency R = |mean(exp(i*k*theta))|, k = 360/period.
 * Returns null when undefined (fewer than 2 angles).
 */
export function circularConsistency(anglesDeg, periodDeg) {
  const n = anglesDeg.length;
  if (n < 2) return null;
  const k = 360 / periodDeg;
  let c = 0; let s = 0;
  for (const a of anglesDeg) {
    const r = (a * k * Math.PI) / 180;
    c += Math.cos(r); s += Math.sin(r);
  }
  return Math.hypot(c, s) / n;
}
