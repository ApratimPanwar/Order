/**
 * Deterministic, dependency-free rasterizer for archived layouts, and a minimal
 * PNG encoder/decoder.
 *
 * WHY NOT A BROWSER SCREENSHOT
 *
 * Survey stimuli are images. An image produced by a browser depends on that
 * browser's anti-aliasing and version, so the same layout could yield different
 * pixels on another machine and the frozen stimulus would not be reproducible
 * from its source layout. This rasterizer implements exactly the drawing rules of
 * study/render-layout.js (renderer-1 and renderer-2) in plain arithmetic:
 *
 *   - background fill, then elements in ascending `order`, invisible skipped;
 *   - filled shapes are filled; unfilled shapes are stroked with a 3-unit line
 *     centred on the outline (canvas default miter joins, which never reach the
 *     miter limit for these shapes);
 *   - circles are never rotated; other shapes rotate about (x, y);
 *   - triangles use the renderer's vertex rule.
 *
 * Anti-aliasing is SS x SS supersampling per output pixel with coverage-weighted
 * compositing, so the same layout always produces byte-identical pixels.
 */
import { deflateSync, inflateSync } from 'node:zlib';

import { parseColor } from './color.js';

export const RASTERIZER_VERSION = 'rasterize-1';
export const STROKE_WIDTH = 3;

/** Half-planes {nx, ny, c}: a local point p is inside when nx*px + ny*py <= c for all. */
function polygonHalfPlanes(vertices) {
  // Orient counter-clockwise so outward normals are consistent.
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % vertices.length];
    area += x1 * y2 - x2 * y1;
  }
  const v = area < 0 ? [...vertices].reverse() : vertices;
  return v.map(([x1, y1], i) => {
    const [x2, y2] = v[(i + 1) % v.length];
    const ex = x2 - x1; const ey = y2 - y1;
    const len = Math.hypot(ex, ey);
    const nx = ey / len; const ny = -ex / len;       // outward for a CCW polygon
    return { nx, ny, c: nx * x1 + ny * y1 };
  });
}

function localShape(e, renderer) {
  const s = e.size;
  const s2 = e.size2 ?? e.size;
  switch (e.type) {
    case 'circle': return { kind: 'circle', r: s / 2 };
    case 'square': return { kind: 'poly', planes: polygonHalfPlanes([[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]]), extent: Math.hypot(s, s) / 2 };
    case 'rectangle': return { kind: 'poly', planes: polygonHalfPlanes([[-s / 2, -s2 / 2], [s / 2, -s2 / 2], [s / 2, s2 / 2], [-s / 2, s2 / 2]]), extent: Math.hypot(s, s2) / 2 };
    case 'triangle': {
      const v = renderer === 'renderer-2'
        ? [[0, -s / Math.sqrt(3)], [-s / 2, s / (2 * Math.sqrt(3))], [s / 2, s / (2 * Math.sqrt(3))]]
        : [[0, -s * 0.433], [-s / 2, s * 0.433], [s / 2, s * 0.433]];
      return { kind: 'poly', planes: polygonHalfPlanes(v), extent: Math.max(...v.map(([x, y]) => Math.hypot(x, y))) };
    }
    default: throw new Error(`unsupported element type ${e.type}`);
  }
}

/** Inside test for one local point. `offset` > 0 grows the shape, < 0 shrinks it. */
function insideAt(shape, px, py, offset) {
  if (shape.kind === 'circle') return Math.hypot(px, py) <= shape.r + offset;
  for (const h of shape.planes) if (h.nx * px + h.ny * py > h.c + offset) return false;
  return true;
}

/**
 * @param {object} layout canonical layout
 * @param {{width?: number, height?: number, ss?: number}} opts output size in pixels
 * @returns {{width:number, height:number, rgb:Uint8Array, rasterizer:string}}
 */
export function rasterizeLayout(layout, { width, height, ss = 4 } = {}) {
  const canvas = layout.canvas ?? { width: 500, height: 500, background: '#FFFFFF' };
  const W = width ?? canvas.width;
  const H = height ?? canvas.height;
  const renderer = layout.meta?.rendererVersion ?? 'renderer-2';
  const sx = W / canvas.width;
  const sy = H / canvas.height;

  const bg = parseColor(canvas.background ?? '#FFFFFF');
  if (!bg.ok) throw new Error(`unparseable background ${canvas.background}`);
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { rgb[i * 3] = bg.rgb.r; rgb[i * 3 + 1] = bg.rgb.g; rgb[i * 3 + 2] = bg.rgb.b; }

  const samples = [];
  for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) samples.push([(i + 0.5) / ss, (j + 0.5) / ss]);

  const ordered = [...layout.elements].sort((a, b) => a.order - b.order);
  for (const e of ordered) {
    if (!e.visible) continue;
    const col = parseColor(e.color);
    if (!col.ok) throw new Error(`unparseable colour ${e.color}`);
    const shape = localShape(e, renderer);
    const half = STROKE_WIDTH / 2;
    const reach = (shape.kind === 'circle' ? shape.r : shape.extent) + half + 1;
    const theta = e.type === 'circle' ? 0 : (-e.rotation * Math.PI) / 180;
    const cos = Math.cos(theta); const sin = Math.sin(theta);

    const x0 = Math.max(0, Math.floor((e.x - reach) * sx));
    const x1 = Math.min(W - 1, Math.ceil((e.x + reach) * sx));
    const y0 = Math.max(0, Math.floor((e.y - reach) * sy));
    const y1 = Math.min(H - 1, Math.ceil((e.y + reach) * sy));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let hits = 0;
        for (const [ox, oy] of samples) {
          const lx = (px + ox) / sx - e.x;
          const ly = (py + oy) / sy - e.y;
          const rx = lx * cos - ly * sin;
          const ry = lx * sin + ly * cos;
          const inside = e.filled
            ? insideAt(shape, rx, ry, 0)
            : insideAt(shape, rx, ry, half) && !insideAt(shape, rx, ry, -half);
          if (inside) hits++;
        }
        if (!hits) continue;
        const a = hits / samples.length;
        const k = (py * W + px) * 3;
        rgb[k] = Math.round(col.rgb.r * a + rgb[k] * (1 - a));
        rgb[k + 1] = Math.round(col.rgb.g * a + rgb[k + 1] * (1 - a));
        rgb[k + 2] = Math.round(col.rgb.b * a + rgb[k + 2] * (1 - a));
      }
    }
  }
  return { width: W, height: H, rgb, rasterizer: RASTERIZER_VERSION };
}

// ---------------------------------------------------------------------------
// PNG: 8-bit truecolour, filter 0 on every row, no ancillary chunks.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function encodePng({ width, height, rgb }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Decodes ONLY the subset encodePng writes, and reports every chunk it saw. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let off = 8; const chunks = []; let ihdr = null; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== crc) throw new Error(`bad CRC in ${type}`);
    chunks.push(type);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
    if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('missing IHDR');
  const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 2 || ihdr[12] !== 0) throw new Error('unsupported PNG format (expected 8-bit RGB, no interlace)');
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (width * 3 + 1) * height) throw new Error('pixel data length mismatch');
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    if (raw[rowStart] !== 0) throw new Error(`unsupported filter ${raw[rowStart]} on row ${y}`);
    rgb.set(raw.subarray(rowStart + 1, rowStart + 1 + width * 3), y * width * 3);
  }
  return { width, height, rgb, chunks };
}
