/**
 * Constructed witnesses for v0 dimension maxima.
 *
 *   node scripts/attainability-witnesses.mjs
 *
 * CORRECTION. An earlier preflight sampled ~39,000 layouts drawn from
 * generateLayout() plus the 12 presets and reported the observed per-dimension
 * maxima as attainability limits. That was invalid: it measured the reachable
 * set of THAT GENERATOR, not of the scorer. The generator draws sizes in
 * [40,120] with <=16 elements, so it essentially never produces the ~60% ink
 * coverage that spatial's whitespace term peaks at. Sampled maxima are not
 * proofs of unattainability.
 *
 * Below, each maximum is demonstrated by construction instead.
 */
import { createLayout } from '../core/layout.js';
import { score, analyzeSpatial, analyzeHarmony, analyzeStructure,
         analyzeHierarchy, analyzeGrouping, analyzeFlow } from '../core/scoring/v0-as-shipped.js';
import { FIXTURES } from '../test/fixtures/layouts.mjs';

const el = (o) => ({ type:'square', index:1, order:0, visible:true,
  x:250, y:250, size:60, rotation:0, color:'#808080', filled:true, ...o });
const L = (els, id) => createLayout({ id, elements: els.map((e,i)=>({ ...e, index:i+1, order:i })) });
const vis = (l) => l.elements.filter(e=>e.visible);

console.log('=== SPATIAL = 10 ===');
// Needs whitespaceScore = 10  (occupied/canvas = 0.6 exactly  => ws ratio 0.4)
// AND balanceScore   = 10  (luminance-weighted centroid exactly at 250,250).
// Two identical squares, mirrored about the centre, total area 150000.
{
  const size = Math.sqrt(150000/2);            // 273.861...
  const spatialWitness = L([
    el({ size, x: 250 - 60, y: 250 }),
    el({ size, x: 250 + 60, y: 250 }),
  ], 'witness-spatial-10');
  const v = vis(spatialWitness);
  const occupied = 2 * size * size;
  console.log(`  two squares size=${size.toFixed(4)}  occupied=${occupied}  wsRatio=${((250000-occupied)/250000).toFixed(6)}`);
  console.log(`  spatial = ${analyzeSpatial(v).toFixed(10)}`);
}

console.log('\n=== HARMONY = 10 ===');
// sizeScore=10 needs CV(sizes)=0.3 exactly; rotationScore=10 needs SD(rot)=0;
// filledScore=10 needs exactly half filled.
// Two elements with a/b = 1.3/0.7 give CV = |a-b|/(a+b) = 0.3.
{
  const harmonyWitness = L([
    el({ size: 130, filled: true,  rotation: 0, x: 150 }),
    el({ size:  70, filled: false, rotation: 0, x: 350 }),
  ], 'witness-harmony-10');
  const v = vis(harmonyWitness);
  const sizes = v.map(e=>e.size), mean = (130+70)/2, sd = Math.abs(130-70)/2;
  console.log(`  sizes ${sizes}  CV=${(sd/mean).toFixed(6)}  rotations all 0  filled 1/2`);
  console.log(`  harmony = ${analyzeHarmony(v).toFixed(10)}`);
}

console.log('\n=== STRUCTURE = 14/1.5 = 9.3333 (algebraic ceiling) ===');
{
  const v = vis(FIXTURES.perfectGrid);
  console.log(`  existing perfectGrid fixture -> structure = ${analyzeStructure(v).toFixed(10)}`);
  console.log(`  ceiling ((1+1)*4 + 4 + 2)/1.5 = ${(14/1.5).toFixed(10)}  reached: ${Math.abs(analyzeStructure(v)-14/1.5) < 1e-12}`);
}

console.log('\n=== HIERARCHY / GROUPING / FLOW = 10 ===');
{
  // hierarchy: min(10, uniqueWeights*2 + range*5 + sd*3) saturates easily.
  const h = L([
    el({ size: 200, x: 250, y: 250, color:'#FF0000' }),
    el({ size:  40, x:  20, y:  20, color:'#111111', filled:false }),
    el({ size: 120, x: 400, y: 100, color:'#00FF00' }),
    el({ size:  80, x: 100, y: 400, color:'#0000FF', filled:false }),
    el({ size: 160, x: 300, y: 300, color:'#FFFF00' }),
  ], 'witness-hierarchy-10');
  console.log(`  hierarchy = ${analyzeHierarchy(vis(h)).toFixed(10)}`);

  // grouping: min(10, (SD/mean of pairwise distances)*15) -> needs CV >= 2/3.
  const g = L([
    el({ x: 250, y: 250 }), el({ x: 251, y: 250 }), el({ x: 252, y: 250 }),
    el({ x: 253, y: 250 }), el({ x: 499, y: 499 }),
  ], 'witness-grouping-10');
  console.log(`  grouping  = ${analyzeGrouping(vis(g)).toFixed(10)}`);

  // flow: the DESCENDING-visual-weight order must itself trace a down-right path.
  // Naive size ordering is not enough: positionFactor (0.2 weight) favours the
  // canvas centre and reorders a diagonal. Fill (0.3) and saturation (0.1) are
  // used here to force the ranking to agree with the path.
  const f = L([
    el({ size: 300, x: 100, y: 100, filled: true,  color: '#FF0000' }), // sat 1
    el({ size: 200, x: 200, y: 200, filled: true,  color: '#808080' }),
    el({ size: 100, x: 300, y: 300, filled: false, color: '#808080' }),
    el({ size:  40, x: 400, y: 400, filled: false, color: '#808080' }),
  ], 'witness-flow-10');
  console.log(`  flow      = ${analyzeFlow(vis(f)).toFixed(10)}`);
}

console.log('\n=== SUMMARY: attainable maxima, by construction ===');
console.log('  hierarchy 10        grouping 10        flow 10');
console.log('  spatial   10        harmony  10        structure 9.3333 (algebraic ceiling, reached)');
console.log('\n  Structure is the ONLY dimension whose maximum is below 10, and that is a');
console.log('  normalisation artifact (/1.5 against a raw max of 14), not a submetric conflict.');
