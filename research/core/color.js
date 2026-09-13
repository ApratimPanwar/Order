/**
 * Colour: parsing, sRGB, CIELAB, WCAG contrast.  (V1-SPECIFICATION §1.6)
 *
 * Model-neutral engineering: these are standard published conversions, not
 * DOASA modelling choices. The only DOASA-specific decision here is the
 * ACCEPTANCE SET — which notations are supported — and unsupported notations are
 * rejected rather than silently blackened (the v0 defect).
 *
 * Archived layouts keep the original colour string verbatim; conversion happens
 * only at scoring time.
 */

const HEX6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;
const HEX3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
const RGB = /^rgb\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/i;
const HSL = /^hsl\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)%\s*,\s*(-?[\d.]+)%\s*\)$/i;

/**
 * @returns {{ok:true, rgb:{r,g,b}, notation:string} | {ok:false, reason:string}}
 * Never returns a fallback colour. A caller that wants to score must handle
 * `ok:false` by rejecting the layout at the gate.
 */
export function parseColor(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'non-string-color' };
  const s = input.trim();

  let m = HEX6.exec(s);
  if (m) return { ok: true, notation: 'hex6', rgb: { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } };

  m = HEX3.exec(s);
  if (m) {
    const dup = (c) => parseInt(c + c, 16);
    return { ok: true, notation: 'hex3', rgb: { r: dup(m[1]), g: dup(m[2]), b: dup(m[3]) } };
  }

  m = RGB.exec(s);
  if (m) {
    const v = [1, 2, 3].map((i) => Number(m[i]));
    if (v.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) {
      return { ok: false, reason: 'rgb-component-out-of-range' };
    }
    return { ok: true, notation: 'rgb', rgb: { r: Math.round(v[0]), g: Math.round(v[1]), b: Math.round(v[2]) } };
  }

  m = HSL.exec(s);
  if (m) {
    const h = Number(m[1]); const sat = Number(m[2]); const l = Number(m[3]);
    if (![h, sat, l].every(Number.isFinite)) return { ok: false, reason: 'hsl-non-finite' };
    if (sat < 0 || sat > 100 || l < 0 || l > 100) return { ok: false, reason: 'hsl-component-out-of-range' };
    return { ok: true, notation: 'hsl', rgb: hslToRgb(h, sat, l) };
  }

  return { ok: false, reason: 'unsupported-color-notation' };
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const q = (v) => Math.round((v + m) * 255);
  return { r: q(r), g: q(g), b: q(b) };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio in [1, 21]. */
export function contrastRatio(rgbA, rgbB) {
  const a = relativeLuminance(rgbA);
  const b = relativeLuminance(rgbB);
  const hi = Math.max(a, b); const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB -> CIE XYZ (D65). */
export function rgbToXyz({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r); const G = lin(g); const B = lin(b);
  return {
    x: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    y: R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
    z: R * 0.0193339 + G * 0.1191920 + B * 0.9503041,
  };
}

const WHITE_D65 = { x: 0.95047, y: 1.0, z: 1.08883 };

/** CIE XYZ -> CIELAB (D65). */
export function xyzToLab({ x, y, z }) {
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x / WHITE_D65.x);
  const fy = f(y / WHITE_D65.y);
  const fz = f(z / WHITE_D65.z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb));
}

/** CIELAB chroma C*ab = sqrt(a^2 + b^2). */
export function chroma({ a, b }) {
  return Math.hypot(a, b);
}

/** CIELAB hue angle in degrees, [0,360). Undefined-ish for achromatic colours. */
export function hueAngle({ a, b }) {
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * CIEDE2000 colour difference.
 * Standard formulation (Sharma, Wu & Dalal 2005). Not a DOASA choice.
 */
export function deltaE00(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const kL = 1, kC = 1, kH = 1;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const C7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (bb, aa) => {
    if (bb === 0 && aa === 0) return 0;
    const d = (Math.atan2(bb, aa) * 180) / Math.PI;
    return d >= 0 ? d : d + 360;
  };
  const h1p = h(b1, a1p);
  const h2p = h(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
  else hbp = (h1p + h2p - 360) / 2;

  const T = 1
    - 0.17 * Math.cos(((hbp - 30) * Math.PI) / 180)
    + 0.24 * Math.cos((2 * hbp * Math.PI) / 180)
    + 0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180)
    - 0.20 * Math.cos(((4 * hbp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 25 ** 7));
  const Lbp50 = (Lbp - 50) ** 2;
  const Sl = 1 + (0.015 * Lbp50) / Math.sqrt(20 + Lbp50);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc;

  return Math.sqrt(
    (dLp / (kL * Sl)) ** 2
    + (dCp / (kC * Sc)) ** 2
    + (dHp / (kH * Sh)) ** 2
    + Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  );
}

/**
 * Component-wise arithmetic mean of L*, a*, b*.  (§4, §8)
 * Cartesian, deliberately: averaging hue would need a circular mean and would
 * be ill-defined for achromatic members.
 */
export function labCentroid(labs) {
  if (labs.length === 0) return null;
  const n = labs.length;
  return {
    L: labs.reduce((s, c) => s + c.L, 0) / n,
    a: labs.reduce((s, c) => s + c.a, 0) / n,
    b: labs.reduce((s, c) => s + c.b, 0) / n,
  };
}
