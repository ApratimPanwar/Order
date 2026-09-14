/**
 * DOASA v1 scorer — DEVELOPMENT CANDIDATE, NOT AN APPROVED MEASUREMENT.
 *
 * Implements V1-SPECIFICATION draft-2. Pure and DOM-free: depends only on its
 * arguments, uses no globals and no Math.random.
 *
 * Returns total, six dimensions, all 19 submetrics, the effective config, the
 * version identifiers, and diagnostic reasons.
 *
 * DISCIPLINE THIS FILE KEEPS
 *  - Invariant R: every submetric and prominence component is clipped to [0,1]
 *    AT ITS DEFINITION, so a clipped value stays visible in `submetrics`.
 *  - Invariant T: every submetric is total on the applicable domain. A layout
 *    that passes the gate always yields a complete score under the FIXED weight
 *    vector. There is no per-layout reweighting anywhere in this file.
 *  - A layout failing any applicability condition is NOT scored on a reduced
 *    basis; it returns `scorable: false` with reasons.
 *  - Every measure is a GEOMETRIC PROXY. Nothing here measures gaze, attention
 *    or perception.
 */

import {
  parseColor, rgbToLab, chroma, hueAngle, deltaE00, labCentroid, contrastRatio,
} from '../color.js';
import {
  toPolygon, clippedArea, clippedBBox, unionFootprintArea, unionFootprintByCell,
  equivalentDiameter, scoringCentroid, rotationPeriod, circularConsistency,
  polygonArea, clipToRect,
} from '../geometry.js';
import { V1_CONFIG, effectiveConfig, approvalRecord, CONFIG_VERSION, SPEC_VERSION } from './v1-config.js';

// ARCHIVED REVISION 1 - byte-for-byte the scorer at commit 9b8f43f except for
// this header and the version label below. Kept ONLY to reproduce records made
// under revision 1 and to demonstrate the two defects it contains (element-order
// dependence in flow; Kendall tau-b joint ties). Never use it for new scoring.
const MODEL_VERSION = 'v1-development-candidate';

const SUPPORTED_TYPES = new Set(['circle', 'square', 'rectangle', 'triangle']);

const clip01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const cv = (a) => {
  if (a.length === 0) return 0;
  const m = mean(a);
  if (m === 0) return 0; // documented: all-zero is perfectly uniform, not undefined
  const sd = Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
  return sd / m;
};

/** Range-normalised target seeker. Reduces to 1-2|r-0.5| at t=0.5. (§7.1, §8) */
export function targetFit(r, t) {
  if (t <= 0 || t >= 1) throw new Error(`target must be in (0,1), got ${t}`);
  return clip01(1 - (r < t ? (t - r) / t : (r - t) / (1 - t)));
}

/** Shannon entropy of a count vector, normalised by log(bins). */
function normalisedEntropy(counts) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  const k = counts.length;
  if (k <= 1) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const pk = c / total;
    h -= pk * Math.log(pk);
  }
  return clip01(h / Math.log(k));
}

/** Kendall tau-b, tie-corrected. (§2.3) */
export function kendallTauB(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  let c = 0; let d = 0; let ta = 0; let tb = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = Math.sign(a[i] - a[j]);
      const db = Math.sign(b[i] - b[j]);
      if (da === 0 && db === 0) { ta++; tb++; }
      else if (da === 0) ta++;
      else if (db === 0) tb++;
      else if (da === db) c++;
      else d++;
    }
  }
  const denom = Math.sqrt((c + d + ta) * (c + d + tb));
  return denom === 0 ? 0 : (c - d) / denom;
}

// ---------------------------------------------------------------------------
// Applicability gate (§2)
// ---------------------------------------------------------------------------

export function checkApplicability(layout, cfg = effectiveConfig()) {
  const reasons = [];
  // Malformed input must produce a REJECTION, never a thrown exception and
  // never a fabricated score (F5).
  if (layout === null || layout === undefined || typeof layout !== 'object') {
    return { scorable: false, reasons: [{ code: 'malformed-layout', detail: `layout is ${layout === null ? 'null' : typeof layout}` }] };
  }
  if (!Array.isArray(layout.elements)) {
    return { scorable: false, reasons: [{ code: 'malformed-layout', detail: 'elements is not an array' }] };
  }
  if (layout.canvas !== undefined && layout.canvas !== null) {
    const c = layout.canvas;
    if (typeof c !== 'object'
      || !Number.isFinite(c.width) || !Number.isFinite(c.height)
      || c.width <= 0 || c.height <= 0) {
      return { scorable: false, reasons: [{ code: 'malformed-canvas', detail: 'width/height must be positive finite numbers' }] };
    }
  }
  for (const e of layout.elements) {
    if (!e || typeof e !== 'object') {
      return { scorable: false, reasons: [{ code: 'malformed-element', detail: 'element is not an object' }] };
    }
    if (!SUPPORTED_TYPES.has(e.type)) {
      reasons.push({ code: 'unsupported-element-type', detail: `${e.id ?? '?'}: ${JSON.stringify(e.type)}` });
    }
  }
  if (layout.renderer?.showArrows === true) {
    reasons.push({ code: 'show-arrows-enabled', detail: 'rotation is visible for every shape when arrows are drawn' });
  }
  const visible = layout.elements.filter((e) => e.visible);
  if (visible.length < cfg.minElements) {
    reasons.push({ code: 'below-min-elements', detail: `${visible.length} < ${cfg.minElements}` });
  }
  for (const e of visible) {
    for (const k of ['x', 'y', 'size', 'rotation']) {
      if (typeof e[k] !== 'number' || !Number.isFinite(e[k])) {
        reasons.push({ code: 'non-finite-property', detail: `${e.id}.${k}` });
      }
    }
    if (e.size <= 0) reasons.push({ code: 'zero-size-element', detail: e.id });
    const c = parseColor(e.color);
    if (!c.ok) reasons.push({ code: 'unparseable-color', detail: `${e.id}: ${c.reason}` });
  }

  // Remaining spec 2 conditions, previously only diagnosed after scoring (F5).
  if (reasons.length === 0 && visible.length > 0) {
    const canvas = layout.canvas ?? cfg.canvas;
    const geomOpts = {
      renderer: layout.meta?.rendererVersion ?? cfg.renderer,
      circleFacets: cfg.circleFacets,
      circleMode: cfg.circleMode,
    };
    const distinct = new Set(visible.map((e) => `${e.x},${e.y}`));
    if (distinct.size < cfg.minDistinctPositions) {
      reasons.push({
        code: 'below-min-distinct-positions',
        detail: `${distinct.size} < ${cfg.minDistinctPositions}`,
      });
    }
    for (const e of visible) {
      let a;
      try { a = clippedArea(e, canvas, geomOpts); } catch (err) {
        reasons.push({ code: 'geometry-error', detail: `${e.id}: ${err.message}` });
        continue;
      }
      if (!(a > 0)) {
        reasons.push({ code: 'zero-clipped-area', detail: `${e.id} has no visible area on the canvas` });
      }
    }
  }
  return { scorable: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Prominence (§3)
// ---------------------------------------------------------------------------

function prominence(items, cfg, canvas) {
  const w = cfg.prominenceWeights;
  const areas = items.map((it) => it.area);
  const aMin = Math.min(...areas); const aMax = Math.max(...areas);
  const degenerate = aMax - aMin < 1e-9;
  const bgRgb = parseColor(canvas.background ?? '#FFFFFF');
  const bg = bgRgb.ok ? bgRgb.rgb : { r: 255, g: 255, b: 255 };
  const dMax = Math.hypot(canvas.width / 2, canvas.height / 2);
  const c = [canvas.width / 2, canvas.height / 2];

  return items.map((it) => {
    const A = degenerate ? 0.5 : clip01((it.area - aMin) / (aMax - aMin));
    const cr = contrastRatio(it.rgb, bg);
    const C = clip01(((cr - 1) / 20) * (it.e.filled ? 1 : cfg.kappa));
    const D = clip01(1 - Math.hypot(it.p[0] - c[0], it.p[1] - c[1]) / dMax);
    const T = clip01(chroma(it.lab) / 128);
    return clip01(w.area * A + w.contrast * C + w.position * D + w.chroma * T);
  });
}

// ---------------------------------------------------------------------------
// DBSCAN on equivalent-disc gaps (§4)
// ---------------------------------------------------------------------------

function dbscan(items, eps, minPts) {
  const n = items.length;
  const gap = (i, j) => Math.max(0, Math.hypot(
    items[i].p[0] - items[j].p[0], items[i].p[1] - items[j].p[1],
  ) - (items[i].dEq + items[j].dEq) / 2);

  const neighbours = (i) => {
    const out = [];
    for (let j = 0; j < n; j++) if (j !== i && gap(i, j) <= eps) out.push(j);
    return out;
  };

  const label = new Array(n).fill(undefined); // undefined | 'noise' | clusterIndex
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (label[i] !== undefined) continue;
    const nb = neighbours(i);
    if (nb.length + 1 < minPts) { label[i] = 'noise'; continue; }
    label[i] = cid;
    const queue = [...nb];
    while (queue.length) {
      const q = queue.shift();
      if (label[q] === 'noise') label[q] = cid;
      if (label[q] !== undefined) continue;
      label[q] = cid;
      const qn = neighbours(q);
      if (qn.length + 1 >= minPts) queue.push(...qn);
    }
    cid++;
  }

  const clusters = Array.from({ length: cid }, () => []);
  let noise = 0;
  label.forEach((l, i) => {
    if (l === 'noise' || l === undefined) noise++;
    else clusters[l].push(i);
  });
  return { clusters: clusters.filter((c) => c.length > 0), noise, gap };
}

// ---------------------------------------------------------------------------
// The scorer
// ---------------------------------------------------------------------------

export function score(layout, config = V1_CONFIG) {
  const cfg = effectiveConfig(config);
  // The gate runs FIRST and tolerates any input, so a malformed layout can
  // never reach property access below (F5).
  const gate = checkApplicability(layout, cfg);
  const canvas = (layout && layout.canvas) ? layout.canvas : cfg.canvas;
  const renderer = layout?.meta?.rendererVersion ?? cfg.renderer;
  const geomOpts = { renderer, circleFacets: cfg.circleFacets, circleMode: cfg.circleMode };
  const diagnostics = [];

  const base = {
    modelVersion: MODEL_VERSION,
    configVersion: CONFIG_VERSION,
    specVersion: SPEC_VERSION,
    rendererVersion: renderer,
    schemaVersion: layout?.schemaVersion ?? null,
    measureKind: 'geometric-proxy',
    approval: approvalRecord(config),
    effectiveConfig: cfg,
  };

  if (!gate.scorable) {
    return {
      ...base,
      scorable: false,
      total: null,
      dimensions: null,
      submetrics: null,
      diagnostics: gate.reasons,
      elementCount: Array.isArray(layout?.elements)
        ? layout.elements.filter((e) => e && e.visible).length
        : 0,
    };
  }

  const visible = layout.elements.filter((e) => e.visible);
  const n = visible.length;

  // -- per-element derived quantities ---------------------------------------
  const items = visible.map((e) => {
    const rgb = parseColor(e.color).rgb;
    const lab = rgbToLab(rgb);
    const area = clippedArea(e, canvas, geomOpts);
    return {
      e,
      rgb,
      lab,
      area,
      dEq: equivalentDiameter(area),
      p: scoringCentroid(e, renderer),
      bbox: clippedBBox(e, canvas, geomOpts),
    };
  });

  const clippedOut = items.filter((it) => it.area <= 0);
  if (clippedOut.length) {
    diagnostics.push({ code: 'elements-fully-clipped', detail: clippedOut.map((i) => i.e.id).join(',') });
  }

  const u = prominence(items, cfg, canvas);
  const dMax = Math.hypot(canvas.width / 2, canvas.height / 2);
  const dDiag = Math.hypot(canvas.width, canvas.height);
  const centre = [canvas.width / 2, canvas.height / 2];
  const sub = {};

  // =========================================================================
  // HIERARCHY (§3)
  // =========================================================================
  {
    const sorted = [...u].sort((a, b) => b - a);
    const gapNorm = (a, b) => (a + b === 0 ? 0 : clip01((a - b) / (a + b)));
    sub['m_h,1'] = gapNorm(sorted[0], sorted[1]);
    sub['m_h,2'] = gapNorm(sorted[1], sorted[2]);
    const tail = sorted.slice(2);
    sub['m_h,3'] = clip01(1 - Math.min(1, cv(tail)));
  }

  // =========================================================================
  // GROUPING (§4)
  // =========================================================================
  {
    const beta = mean(items.map((it) => it.dEq));
    const eps = cfg.dbscanEpsFactor * beta;
    const { clusters, noise, gap } = dbscan(items, eps, cfg.dbscanMinPts);

    sub['m_g,1'] = clip01((n - noise) / n);

    if (clusters.length === 0) {
      sub['m_g,2'] = 0;
      sub['m_g,3'] = 0; // nothing grouped, so no separation achieved
      diagnostics.push({ code: 'grouping-zero-clusters' });
    } else {
      const per = clusters.map((c) => {
        const areas = c.map((i) => items[i].area);
        const sizeSim = clip01(1 - Math.min(1, cv(areas)));
        const labs = c.map((i) => items[i].lab);
        const cen = labCentroid(labs);
        const dEs = labs.map((l) => deltaE00(l, cen));
        const colourSim = clip01(1 - Math.min(1, mean(dEs) / cfg.deltaERef));
        return 0.5 * sizeSim + 0.5 * colourSim;
      });
      sub['m_g,2'] = clip01(mean(per));

      if (clusters.length === 1) {
        sub['m_g,3'] = 1; // a single group has no inter-group ambiguity
        diagnostics.push({ code: 'grouping-single-cluster' });
      } else {
        let minGap = Infinity;
        for (let a = 0; a < clusters.length; a++) {
          for (let b = a + 1; b < clusters.length; b++) {
            for (const i of clusters[a]) {
              for (const j of clusters[b]) minGap = Math.min(minGap, gap(i, j));
            }
          }
        }
        sub['m_g,3'] = clip01(minGap / (cfg.separationGapFactor * beta));
      }
    }
  }

  // =========================================================================
  // STRUCTURE (§5)
  // =========================================================================
  {
    // m_s,1 alignment concentration over 6 anchor families of the clipped bbox
    const families = [
      items.map((it) => it.bbox?.minX), items.map((it) => (it.bbox ? (it.bbox.minX + it.bbox.maxX) / 2 : undefined)), items.map((it) => it.bbox?.maxX),
      items.map((it) => it.bbox?.minY), items.map((it) => (it.bbox ? (it.bbox.minY + it.bbox.maxY) / 2 : undefined)), items.map((it) => it.bbox?.maxY),
    ];
    const concentrations = families.map((vals) => {
      const present = vals.filter((v) => Number.isFinite(v));
      if (present.length === 0) return 0;
      const bins = new Map();
      for (const v of present) {
        const b = Math.round(v / cfg.alignTolerance);
        bins.set(b, (bins.get(b) ?? 0) + 1);
      }
      const maxBin = Math.max(...bins.values());
      return maxBin / present.length;
    });
    const raw = mean(concentrations);
    sub['m_s,1'] = clip01((raw - 1 / n) / (1 - 1 / n));

    // m_s,2 grid adherence on anchors
    const coords = items.flatMap((it) => [it.e.x, it.e.y]);
    const onGrid = coords.filter((c) => {
      const r = Math.abs(c - Math.round(c / cfg.gridPitch) * cfg.gridPitch);
      return r <= cfg.gridTolerance;
    }).length;
    sub['m_s,2'] = clip01(onGrid / coords.length);

    // m_s,3 proportional regularity over adjacent-rank area ratios
    const areasDesc = items.map((it) => it.area).sort((a, b) => b - a);
    const ratios = [];
    for (let i = 0; i < areasDesc.length - 1; i++) {
      ratios.push(areasDesc[i + 1] > 0 ? Math.sqrt(areasDesc[i] / areasDesc[i + 1]) : 1);
    }
    sub['m_s,3'] = clip01(1 - Math.min(1, cv(ratios)));
  }

  // =========================================================================
  // FLOW (§6)
  // =========================================================================
  {
    const order = [...items.keys()].sort((a, b) => u[b] - u[a]);
    const starts = order.slice(0, Math.min(3, n));
    const w = cfg.flowCostWeights;

    const buildPath = (startIdx) => {
      const unvisited = new Set(items.keys());
      const path = [startIdx];
      unvisited.delete(startIdx);
      let prevDir = null;
      let cost = 0;
      while (unvisited.size) {
        const cur = path[path.length - 1];
        let best = null; let bestCost = Infinity;
        for (const cand of [...unvisited].sort((a, b) => a - b)) { // deterministic ties
          const dx = items[cand].p[0] - items[cur].p[0];
          const dy = items[cand].p[1] - items[cur].p[1];
          const len = Math.hypot(dx, dy);
          // First step has turn cost 0 and is excluded from theta-bar. (§6)
          let turn = 0;
          if (prevDir && len > 0) {
            const dot = (prevDir[0] * dx + prevDir[1] * dy) / len;
            turn = Math.acos(Math.min(1, Math.max(-1, dot)));
          }
          const c = w.distance * (len / dDiag) + w.turn * (turn / Math.PI);
          if (c < bestCost - 1e-12) { bestCost = c; best = cand; }
        }
        const dx = items[best].p[0] - items[path[path.length - 1]].p[0];
        const dy = items[best].p[1] - items[path[path.length - 1]].p[1];
        const len = Math.hypot(dx, dy);
        if (len > 0) prevDir = [dx / len, dy / len];
        cost += bestCost;
        path.push(best);
        unvisited.delete(best);
      }
      return { path, cost };
    };

    let best = null;
    for (const s of starts) {
      const r = buildPath(s);
      if (!best || r.cost < best.cost - 1e-12) best = r;
    }
    const path = best.path;

    // turns: skip zero-length segments and the first step
    const turns = [];
    const lengths = [];
    let prevDir = null;
    for (let i = 0; i < path.length - 1; i++) {
      const a = items[path[i]].p; const b = items[path[i + 1]].p;
      const dx = b[0] - a[0]; const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      lengths.push(len);
      if (len === 0) continue; // no direction, excluded from theta-bar
      const dir = [dx / len, dy / len];
      if (prevDir) {
        const dot = prevDir[0] * dir[0] + prevDir[1] * dir[1];
        turns.push(Math.acos(Math.min(1, Math.max(-1, dot))));
      }
      prevDir = dir;
    }
    sub['m_f,1'] = turns.length === 0 ? 1 : clip01(1 - mean(turns) / Math.PI);
    if (turns.length === 0) diagnostics.push({ code: 'flow-no-defined-turns' });

    // reading order
    const band = (p_) => Math.floor((p_[1] / canvas.height) * cfg.readingRowBands);
    const rtl = cfg.readingOrder === 'rtl-ttb';
    const readingIdx = [...items.keys()].sort((a, b) => {
      const ba = band(items[a].p); const bb = band(items[b].p);
      if (ba !== bb) return ba - bb;
      return rtl ? items[b].p[0] - items[a].p[0] : items[a].p[0] - items[b].p[0];
    });
    const readRank = new Map(readingIdx.map((idx, r) => [idx, r]));
    const pathRank = path.map((_, r) => r);
    const readSeq = path.map((idx) => readRank.get(idx));
    sub['m_f,2'] = clip01((kendallTauB(pathRank, readSeq) + 1) / 2);

    sub['m_f,3'] = lengths.length === 0 ? 1 : clip01(1 - mean(lengths) / dDiag);
  }

  // =========================================================================
  // SPATIAL (§7)
  // =========================================================================
  {
    const canvasArea = canvas.width * canvas.height;
    const unionArea = unionFootprintArea(visible, canvas, { ...geomOpts, unionGridN: cfg.unionGridN });
    const rWs = clip01(1 - unionArea / canvasArea);
    sub['m_p,1'] = targetFit(rWs, cfg.whitespaceTarget);

    // nearest-neighbour edge gaps
    const gaps = items.map((it, i) => {
      let best = Infinity;
      items.forEach((other, j) => {
        if (i === j) return;
        const d = Math.max(0, Math.hypot(it.p[0] - other.p[0], it.p[1] - other.p[1]) - (it.dEq + other.dEq) / 2);
        best = Math.min(best, d);
      });
      return Number.isFinite(best) ? best : 0;
    });
    sub['m_p,2'] = clip01(1 - Math.min(1, cv(gaps)));

    // margins from the union bbox to each canvas edge
    const bs = items.map((it) => it.bbox).filter(Boolean);
    if (bs.length === 0) {
      sub['m_p,3'] = 1;
    } else {
      const minX = Math.min(...bs.map((b) => b.minX));
      const maxX = Math.max(...bs.map((b) => b.maxX));
      const minY = Math.min(...bs.map((b) => b.minY));
      const maxY = Math.max(...bs.map((b) => b.maxY));
      const margins = [minX, canvas.width - maxX, minY, canvas.height - maxY].map((m) => Math.max(0, m));
      sub['m_p,3'] = clip01(1 - Math.min(1, cv(margins)));
    }

    // Density evenness over a K x K grid, using UNION coverage per cell so it
    // agrees with the whitespace term about what "occupied" means (F6).
    const K = cfg.densityGridK;
    const cellCounts = unionFootprintByCell(
      visible, canvas, { ...geomOpts, unionGridN: cfg.unionGridN }, K,
    );
    sub['m_p,4'] = normalisedEntropy(cellCounts);

    // weighted balance
    const uSum = u.reduce((s, x) => s + x, 0);
    let bx = 0; let by = 0;
    if (uSum === 0) {
      bx = mean(items.map((it) => it.p[0])) - centre[0];
      by = mean(items.map((it) => it.p[1])) - centre[1];
      diagnostics.push({ code: 'balance-unweighted-fallback', detail: 'sum of prominence was zero' });
      sub['m_p,5'] = clip01(1 - Math.hypot(bx, by) / dMax);
    } else {
      items.forEach((it, i) => { bx += u[i] * (it.p[0] - centre[0]); by += u[i] * (it.p[1] - centre[1]); });
      sub['m_p,5'] = clip01(1 - Math.hypot(bx, by) / (uSum * dMax));
    }
  }

  // =========================================================================
  // VARIETY-HARMONY (§8)
  // =========================================================================
  {
    const chromatic = items.filter((it) => chroma(it.lab) >= cfg.chromaThreshold);
    let hueDiv;
    if (chromatic.length < 2) {
      hueDiv = 0; // a greyscale layout genuinely has no hue variety (§8.1)
      diagnostics.push({ code: 'greyscale-or-monochromatic', detail: `${chromatic.length} chromatic element(s)` });
    } else {
      const bins = new Array(cfg.hueBins).fill(0);
      for (const it of chromatic) {
        bins[Math.min(cfg.hueBins - 1, Math.floor((hueAngle(it.lab) / 360) * cfg.hueBins))]++;
      }
      hueDiv = normalisedEntropy(bins);
    }
    const scaleVar = clip01(Math.min(1, cv(items.map((it) => it.area))));
    const typeCounts = ['circle', 'square', 'rectangle', 'triangle']
      .map((t) => items.filter((it) => it.e.type === t).length);
    const shapeDiv = normalisedEntropy(typeCounts);
    const d = clip01(mean([hueDiv, scaleVar, shapeDiv]));

    const sizes = items.map((it) => it.e.size).sort((a, b) => a - b);
    const m0 = sizes[Math.floor(sizes.length / 2)];
    const modular = m0 <= 0 ? 1 : mean(sizes.map((s) => {
      const k = Math.max(1, Math.round(s / m0));
      return Math.abs(s - k * m0) <= cfg.modularTolerance * m0 ? 1 : 0;
    }));
    const cen = labCentroid(items.map((it) => it.lab));
    const palette = clip01(1 - Math.min(1, mean(items.map((it) => deltaE00(it.lab, cen))) / cfg.deltaERef));
    const h = clip01(mean([modular, palette]));

    sub['m_v,1'] = targetFit(d, cfg.diversityTarget);
    sub['m_v,2'] = h;
  }

  // =========================================================================
  // Aggregation (§9) — fixed weights, no per-layout reweighting
  // =========================================================================
  const sw = cfg.submetricWeights;
  const dim = (keys, weights) => {
    const num = keys.reduce((s, k, i) => s + weights[i] * sub[k], 0);
    const den = weights.reduce((s, x) => s + x, 0);
    return 10 * (num / den);
  };

  const dimensions = {
    hierarchy: dim(['m_h,1', 'm_h,2', 'm_h,3'], sw.hierarchy),
    grouping: dim(['m_g,1', 'm_g,2', 'm_g,3'], sw.grouping),
    structure: dim(['m_s,1', 'm_s,2', 'm_s,3'], sw.structure),
    flow: dim(['m_f,1', 'm_f,2', 'm_f,3'], sw.flow),
    spatial: dim(['m_p,1', 'm_p,2', 'm_p,3', 'm_p,4', 'm_p,5'], sw.spatial),
    variety: dim(['m_v,1', 'm_v,2'], sw.variety),
  };

  const W = cfg.dimensionWeights;
  const total = 10 * Object.entries(dimensions)
    .reduce((s, [k, v]) => s + W[k] * v, 0);

  return {
    ...base,
    scorable: true,
    total,
    dimensions,
    submetrics: sub,
    diagnostics,
    elementCount: n,
  };
}

export const SUBMETRIC_IDS = Object.freeze([
  'm_h,1', 'm_h,2', 'm_h,3',
  'm_g,1', 'm_g,2', 'm_g,3',
  'm_s,1', 'm_s,2', 'm_s,3',
  'm_f,1', 'm_f,2', 'm_f,3',
  'm_p,1', 'm_p,2', 'm_p,3', 'm_p,4', 'm_p,5',
  'm_v,1', 'm_v,2',
]);
