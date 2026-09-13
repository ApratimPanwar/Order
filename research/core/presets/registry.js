/**
 * Versioned preset registry.
 *
 * Stable IDs are the identity. Display names and any human-readable ordering
 * are presentation only and must never be used as an identifier in a study
 * record — the manuscript's "Mode 6 / Mode 8 / Mode 9 / Mode 10" numbering does
 * not correspond to anything in this codebase, which is precisely the failure
 * this registry exists to prevent.
 *
 * Implementations are pure: (layout, params) => new layout. They never mutate
 * the input and never touch the DOM or Math.random.
 *
 * FIDELITY NOTE: these are transcribed from index.bf617e4.html L1790-2037. The
 * transcription changes the calling convention (canonical layout in/out rather
 * than in-place mutation of Element instances) but not the arithmetic. Changes
 * to preset execution are tracked in research/docs/CHANGES.md, separately from
 * scorer changes.
 *
 * The registry does NOT contain a Golden Ratio preset or a Free-Form Grid
 * preset, because commit bf617e4 does not implement them. See PROVENANCE.md.
 */

import { createLayout, cloneLayout } from '../layout.js';
import { getArea, getVisualWeight, hexToRgb } from '../scoring/v0-as-shipped.js';

export const REGISTRY_VERSION = 'presets-1';
export const IMPLEMENTATION_VERSION = 'preset-impl-1';
const CANVAS = 500;
const GRID = 8;
const PHI = 1.618033988749;
const SHAPE_TYPES = ['circle', 'square', 'rectangle', 'triangle'];

/** Applies `fn` to the visible elements of a cloned layout. */
function overVisible(layout, fn) {
  const next = cloneLayout(layout);
  const visible = next.elements.filter((e) => e.visible);
  if (visible.length === 0) return next;
  fn(visible, next);
  return next;
}

const impl = {
  shapeGrouping: (layout) =>
    overVisible(layout, (els) => {
      const positions = [
        { x: 125, y: 125 }, { x: 375, y: 125 },
        { x: 125, y: 375 }, { x: 375, y: 375 },
      ];
      let posIndex = 0;
      for (const type of SHAPE_TYPES) {
        const group = els.filter((e) => e.type === type);
        if (group.length > 0 && posIndex < positions.length) {
          const base = positions[posIndex];
          const radius = 40;
          group.forEach((elem, i) => {
            const angle = (i / group.length) * Math.PI * 2;
            elem.x = base.x + Math.cos(angle) * radius;
            elem.y = base.y + Math.sin(angle) * radius;
          });
          posIndex++;
        }
      }
    }),

  sizeUniformity: (layout) =>
    overVisible(layout, (els) => {
      const avgSize = els.reduce((s, e) => s + e.size, 0) / els.length;
      const gridSize = Math.round(avgSize / GRID) * GRID;
      for (const elem of els) {
        elem.size = gridSize;
        if (elem.type === 'rectangle') elem.size2 = gridSize * 1.5;
      }
    }),

  strictGrid: (layout) =>
    overVisible(layout, (els) => {
      for (const elem of els) {
        elem.x = Math.round(elem.x / GRID) * GRID;
        elem.y = Math.round(elem.y / GRID) * GRID;
        elem.size = Math.round(elem.size / GRID) * GRID;
        elem.rotation = Math.round(elem.rotation / 15) * 15;
        if (elem.type === 'rectangle') elem.size2 = Math.round(elem.size2 / GRID) * GRID;
        const padding = elem.size / 2 + GRID;
        elem.x = Math.max(padding, Math.min(CANVAS - padding, elem.x));
        elem.y = Math.max(padding, Math.min(CANVAS - padding, elem.y));
      }
    }),

  visualHierarchy: (layout) =>
    overVisible(layout, (els) => {
      const sorted = [...els].sort((a, b) => getVisualWeight(b) - getVisualWeight(a));
      sorted.forEach((elem, i) => {
        elem.size = 120 / Math.pow(PHI, i * 0.6);
        if (elem.type === 'rectangle') elem.size2 = elem.size * PHI;
      });
      if (sorted.length > 0) {
        sorted[0].x = CANVAS / 2;
        sorted[0].y = CANVAS / 2;
      }
      for (let i = 1; i < sorted.length; i++) {
        const angle = (i / (sorted.length - 1)) * Math.PI * 2;
        sorted[i].x = CANVAS / 2 + Math.cos(angle) * 160;
        sorted[i].y = CANVAS / 2 + Math.sin(angle) * 160;
      }
    }),

  rhythmicSpacing: (layout) =>
    overVisible(layout, (els) => {
      const sorted = [...els].sort((a, b) => a.x - b.x);
      const spacing = CANVAS / (sorted.length + 1);
      sorted.forEach((elem, i) => {
        elem.x = spacing * (i + 1);
        elem.y = CANVAS / 2;
        elem.size = i % 2 === 0 ? 70 : 50;
        elem.rotation = 0;
        if (elem.type === 'rectangle') elem.size2 = elem.size * 1.5;
      });
    }),

  proximityClustering: (layout) =>
    overVisible(layout, (els) => {
      for (let pass = 0; pass < 10; pass++) {
        for (const elem of els) {
          let nearestDist = Infinity;
          let nearest = null;
          for (const other of els) {
            if (elem === other) continue;
            const d = Math.sqrt((elem.x - other.x) ** 2 + (elem.y - other.y) ** 2);
            if (d < nearestDist) {
              nearestDist = d;
              nearest = other;
            }
          }
          if (nearest) {
            const minDist = (elem.size + nearest.size) / 2 + 10;
            if (nearestDist > minDist) {
              elem.x += (nearest.x - elem.x) * 0.3;
              elem.y += (nearest.y - elem.y) * 0.3;
            }
          }
        }
      }
    }),

  visualBalance: (layout) =>
    overVisible(layout, (els) => {
      let wx = 0;
      let wy = 0;
      let tw = 0;
      for (const e of els) {
        const rgb = hexToRgb(e.color);
        const L = Math.pow(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b, 1 / 2.2) / 255;
        const w = getArea(e) * L;
        wx += e.x * w;
        wy += e.y * w;
        tw += w;
      }
      if (tw > 0) {
        const offsetX = CANVAS / 2 - wx / tw;
        const offsetY = CANVAS / 2 - wy / tw;
        for (const elem of els) {
          elem.x += offsetX;
          elem.y += offsetY;
          const padding = elem.size / 2 + 20;
          elem.x = Math.max(padding, Math.min(CANVAS - padding, elem.x));
          elem.y = Math.max(padding, Math.min(CANVAS - padding, elem.y));
        }
      }
    }),

  rotationAlignment: (layout) =>
    overVisible(layout, (els) => {
      const sinSum = els.reduce((s, e) => s + Math.sin((e.rotation * Math.PI) / 180), 0);
      const cosSum = els.reduce((s, e) => s + Math.cos((e.rotation * Math.PI) / 180), 0);
      const avg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
      for (const elem of els) elem.rotation = avg;
    }),

  averageFaceDirection: (layout) =>
    overVisible(layout, (els) => {
      const counts = {};
      for (const e of els) {
        const dir = Math.round(e.rotation / 45) * 45;
        const norm = ((dir % 360) + 360) % 360;
        counts[norm] = (counts[norm] || 0) + 1;
      }
      let mostCommon = 0;
      let maxCount = 0;
      for (const [dir, count] of Object.entries(counts)) {
        if (count > maxCount) {
          maxCount = count;
          mostCommon = parseInt(dir, 10);
        }
      }
      for (const elem of els) elem.rotation = mostCommon;
    }),

  bilateralSymmetry: (layout) =>
    overVisible(layout, (els) => {
      const cx = CANVAS / 2;
      const sorted = [...els].sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx));
      for (let i = 0; i < sorted.length; i += 2) {
        const e1 = sorted[i];
        const offsetX = Math.abs(e1.x - cx);
        e1.x = cx - offsetX;
        e1.rotation = -e1.rotation;
        if (i + 1 < sorted.length) {
          const e2 = sorted[i + 1];
          e2.x = cx + offsetX;
          e2.y = e1.y;
          e2.size = e1.size;
          e2.size2 = e1.size2;
          e2.rotation = e1.rotation;
        }
      }
    }),

  colorHarmony: (layout) =>
    overVisible(layout, (els) => {
      const avgHue =
        els.reduce((sum, e) => {
          const rgb = hexToRgb(e.color);
          const max = Math.max(rgb.r, rgb.g, rgb.b) / 255;
          const min = Math.min(rgb.r, rgb.g, rgb.b) / 255;
          if (max === min) return sum;
          const d = max - min;
          const r = rgb.r / 255;
          const g = rgb.g / 255;
          const b = rgb.b / 255;
          let h;
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          else if (max === g) h = ((b - r) / d + 2) / 6;
          else h = ((r - g) / d + 4) / 6;
          return sum + h * 360;
        }, 0) / els.length;
      els.forEach((elem, i) => {
        let hue;
        if (els.length <= 4) hue = i % 2 === 0 ? avgHue : (avgHue + 180) % 360;
        else hue = avgHue + (i - els.length / 2) * (60 / els.length);
        const lightness = 45 + i * 5;
        // Writes a non-hex colour string. v0's hexToRgb cannot parse it.
        // Preserved deliberately — see AUDIT.md finding 4.
        elem.color = `hsl(${hue % 360}, 70%, ${lightness}%)`;
        elem.filled = true;
      });
    }),

  radialDistribution: (layout) =>
    overVisible(layout, (els) => {
      els.forEach((elem, i) => {
        const angle = (i / els.length) * Math.PI * 2;
        elem.x = CANVAS / 2 + Math.cos(angle) * 150;
        elem.y = CANVAS / 2 + Math.sin(angle) * 150;
        elem.rotation = (angle * 180) / Math.PI + 90;
      });
    }),
};

/**
 * @typedef {{id:string, legacyKey:string, name:string, description:string,
 *            params:object, deterministic:boolean, apply:Function}} Preset
 */
export const PRESETS = Object.freeze([
  {
    id: 'shape-grouping',
    legacyKey: 'shape',
    name: 'Shape Grouping',
    description: 'Collects elements of each shape type into one of four quadrant clusters.',
    params: { quadrants: 4, clusterRadius: 40 },
  },
  {
    id: 'size-uniformity',
    legacyKey: 'size',
    name: 'Size Uniformity',
    description: 'Sets every element to the grid-rounded mean size.',
    params: { gridSize: GRID },
  },
  {
    id: 'strict-grid',
    legacyKey: 'grid',
    name: 'Strict Grid',
    description: 'Snaps position, size and rotation to the grid and a 15-degree rotation step.',
    params: { gridSize: GRID, rotationStep: 15 },
  },
  {
    id: 'visual-hierarchy',
    legacyKey: 'hierarchy',
    name: 'Visual Hierarchy',
    description:
      'Scales elements by descending visual weight along a phi progression and rings them around the most prominent element.',
    params: { base: 120, phi: PHI, exponentStep: 0.6, radius: 160 },
  },
  {
    id: 'rhythmic-spacing',
    legacyKey: 'rhythm',
    name: 'Rhythmic Spacing',
    description: 'Distributes elements evenly along the horizontal midline with alternating sizes.',
    params: { sizes: [70, 50] },
  },
  {
    id: 'proximity-clustering',
    legacyKey: 'proximity',
    name: 'Proximity Clustering',
    description:
      'Iteratively draws each element toward its nearest neighbour. Not k-means and not DBSCAN.',
    params: { passes: 10, step: 0.3, minGap: 10 },
  },
  {
    id: 'visual-balance',
    legacyKey: 'balance',
    name: 'Visual Balance',
    description: 'Translates the composition so its luminance-weighted centroid sits at the canvas centre.',
    params: { padding: 20 },
  },
  {
    id: 'rotation-alignment',
    legacyKey: 'rotation',
    name: 'Rotation Alignment',
    description: 'Sets every rotation to the circular mean of the current rotations.',
    params: {},
  },
  {
    id: 'average-face-direction',
    legacyKey: 'avgface',
    name: 'Average Face Direction',
    description: 'Quantises rotations to 45-degree steps and aligns all elements to the modal direction.',
    params: { step: 45 },
  },
  {
    id: 'bilateral-symmetry',
    legacyKey: 'symmetry',
    name: 'Bilateral Symmetry',
    description: 'Pairs elements across the vertical centre axis, mirroring position and matching size.',
    params: {},
  },
  {
    id: 'color-harmony',
    legacyKey: 'color',
    name: 'Color Harmony',
    description:
      'Recolours elements around the mean hue. Writes hsl() strings, which v0 cannot parse; see AUDIT.md finding 4.',
    params: { saturation: 70, lightnessBase: 45, lightnessStep: 5 },
    knownDefects: ['emits-unparseable-color-for-v0'],
  },
  {
    id: 'radial-distribution',
    legacyKey: 'radial',
    name: 'Radial Distribution',
    description: 'Places elements evenly on a circle and faces each outward.',
    params: { radius: 150 },
  },
].map((p) => Object.freeze({
  ...p,
  registryVersion: REGISTRY_VERSION,
  implementationVersion: IMPLEMENTATION_VERSION,
  deterministic: true,
  knownDefects: p.knownDefects ?? [],
  apply: impl[toCamel(p.id)],
})));

function toCamel(id) {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
const BY_LEGACY = new Map(PRESETS.map((p) => [p.legacyKey, p]));

export function getPreset(id) {
  const p = BY_ID.get(id) ?? BY_LEGACY.get(id);
  if (!p) throw new Error(`unknown preset: ${id}`);
  return p;
}

export function listPresets() {
  return PRESETS.map(({ apply, ...rest }) => rest);
}
