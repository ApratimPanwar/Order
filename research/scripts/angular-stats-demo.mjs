/**
 * Period-aware circular statistics, and how they differ from v0's linear
 * mean/SD over rotation angles. Numbers cited in docs/decisions/P2.
 *   node scripts/angular-stats-demo.mjs
 */
const rad = (d) => (d * Math.PI) / 180;

/** v0: arithmetic mean and SD over raw degrees, consistency = 1 - min(1, SD/180). */
export function linearConsistency(anglesDeg) {
  const n = anglesDeg.length;
  const m = anglesDeg.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(anglesDeg.reduce((s, a) => s + (a - m) ** 2, 0) / n);
  return { mean: m, sd, consistency: 1 - Math.min(1, sd / 180) };
}

/**
 * Period-aware circular consistency.
 * For a shape whose appearance repeats every `periodDeg`, scale angles by
 * k = 360/periodDeg so one period maps onto a full turn, then take the mean
 * resultant length R. R = 1 means "indistinguishable orientations".
 * This is the standard treatment of axial data (periodDeg 180 => doubling).
 */
export function circularConsistency(anglesDeg, periodDeg) {
  if (periodDeg === null) return { R: 1, consistency: 1, note: 'rotation-invariant; excluded' };
  const k = 360 / periodDeg;
  const n = anglesDeg.length;
  if (n === 0) return { R: null, consistency: null, note: 'undefined for n=0' };
  if (n === 1) return { R: null, consistency: null, note: 'dispersion undefined for n=1' };
  let c = 0, s = 0;
  for (const a of anglesDeg) { c += Math.cos(rad(a * k)); s += Math.sin(rad(a * k)); }
  const R = Math.hypot(c, s) / n;
  return { R, consistency: R };
}

const PERIOD = { circle: null, square: 90, rectangle: 180, triangle: 360 };

const cases = [
  ['squares at 0/90/180/270 (identical on screen)', [0, 90, 180, 270], 'square'],
  ['squares at 350/10/0   (20deg spread)',          [350, 10, 0],      'square'],
  ['squares at 0/45/90    (real 45deg spread)',     [0, 45, 90],       'square'],
  ['rects   at 0/180      (identical on screen)',   [0, 180],          'rectangle'],
  ['rects   at 0/90       (visibly different)',     [0, 90],           'rectangle'],
  ['tris    at 0/120/240  (bbox-centred render)',   [0, 120, 240],     'triangle'],
  ['circles at 37/211/298 (identical on screen)',   [37, 211, 298],    'circle'],
];

console.log('case                                            shape      v0 linear   period-aware');
console.log('                                                           consistency  consistency');
for (const [label, angles, shape] of cases) {
  const lin = linearConsistency(angles);
  const cir = circularConsistency(angles, PERIOD[shape]);
  const c = cir.consistency === null ? 'null' : cir.consistency.toFixed(4);
  console.log(`${label.padEnd(48)}${shape.padEnd(11)}${lin.consistency.toFixed(4).padStart(9)}${c.padStart(14)}`);
}

console.log('\nperiods under the SHIPPED renderer (rotation about the stored x,y):');
console.log('  circle    none      rotation-invariant -> excluded from scoring');
console.log('  square     90deg    fillRect is centred on the origin');
console.log('  rectangle 180deg    fillRect is centred on the origin');
console.log('  triangle  360deg    vertices (0,-0.433s),(+/-0.5s,+0.433s) are drawn about the');
console.log('                      BOUNDING-BOX centre; the centroid is 0.1443s away, so a');
console.log('                      120deg turn does NOT reproduce the shape.');
console.log('\nperiods under a CENTROID-CENTRED renderer (proposed, separately versioned):');
console.log('  triangle  120deg    only then is the equilateral symmetry real on screen.');
