/**
 * Worked checks for the v1 specification correction revision.
 *   node scripts/spec-correction-checks.mjs
 */
const W=500,H=500;
const dMax=Math.hypot(W/2,H/2);      // centre -> corner   353.5534
const dDiag=Math.hypot(W,H);          // corner -> corner   707.1068

console.log('=== 1. WHITESPACE: target semantics + range-normalised form ===');
// v0: whiteSpaceRatio = (canvas - occupied)/canvas, target 0.4  => WHITESPACE target, ink 0.6
// manuscript: 1 - 2|r_ws - 0.5|                                  => WHITESPACE target 0.5
const wsFit=(r,rho)=> 1 - (r<rho ? (rho-r)/rho : (r-rho)/(1-rho));
console.log(' piecewise range-normalised: m = 1 - (r<rho ? (rho-r)/rho : (r-rho)/(1-rho))');
console.log('  rho=0.5 reduces to the manuscript 1-2|r-0.5| ?',
  [0,0.25,0.5,0.75,1].every(r=>Math.abs(wsFit(r,0.5)-(1-2*Math.abs(r-0.5)))<1e-12));
console.log('  rho=0.40  r_ws=0.00 ->',wsFit(0,0.4).toFixed(4),
            ' r_ws=0.40 ->',wsFit(0.4,0.4).toFixed(4),
            ' r_ws=1.00 ->',wsFit(1,0.4).toFixed(4));
const bad=(r,rho)=>1-Math.abs(r-rho)/rho;   // the form written in draft-1
console.log('  draft-1 form |r-rho|/rho at rho=0.40: r_ws=0.8 ->',bad(0.8,0.4).toFixed(4),
            ' r_ws=1.0 ->',bad(1,0.4).toFixed(4),' <- collapses, everything >=0.8 ties at 0');
console.log('  witness (ink 0.600 => r_ws 0.400) scores', wsFit(0.4,0.4).toFixed(4));

console.log('\n=== 2. FLOW m_f,3 CAN GO NEGATIVE with d_max ===');
const meanStep=520;   // easily exceeded: two opposite corners are 707 apart
console.log(`  mean step ${meanStep}px : 1 - L/dMax  = ${(1-meanStep/dMax).toFixed(4)}  <- NEGATIVE`);
console.log(`                          1 - L/dDiag = ${(1-meanStep/dDiag).toFixed(4)}  <- in range`);
console.log(`  max possible step = canvas diagonal = ${dDiag.toFixed(4)}; dMax = ${dMax.toFixed(4)}`);

console.log('\n=== 3. DIVERSITY m_v,1 CAN GO NEGATIVE when d* != 0.5 ===');
const oldV=(d,ds)=>1-2*Math.abs(d-ds);
const newV=(d,ds)=> 1 - (d<ds ? (ds-d)/ds : (d-ds)/(1-ds));
for(const ds of [0.5,0.3]){
  console.log(`  d*=${ds}  d=1.0 : draft-1 ${oldV(1,ds).toFixed(4)}   corrected ${newV(1,ds).toFixed(4)}`);
  console.log(`  d*=${ds}  d=0.0 : draft-1 ${oldV(0,ds).toFixed(4)}   corrected ${newV(0,ds).toFixed(4)}`);
}
console.log('  corrected form reduces to 1-2|d-0.5| at d*=0.5 ?',
  [0,0.3,0.5,0.8,1].every(d=>Math.abs(newV(d,0.5)-oldV(d,0.5))<1e-12));

console.log('\n=== 4. EQUIVALENT-DISC vs TRUE BOUNDARY DISTANCE ===');
const s=100, area=s*s, dEq=2*Math.sqrt(area/Math.PI);
console.log(`  square side ${s}: area ${area}, equivalent-disc diameter ${dEq.toFixed(4)}, radius ${(dEq/2).toFixed(4)}`);
console.log(`  true half-extent along an axis   = ${(s/2).toFixed(4)}`);
console.log(`  true half-extent to a corner     = ${(s/Math.SQRT2).toFixed(4)}`);
console.log(`  => equivalent disc OVERSTATES the axis extent by ${((dEq/2)-(s/2)).toFixed(4)}px`);
console.log(`     and UNDERSTATES the corner extent by ${((s/Math.SQRT2)-(dEq/2)).toFixed(4)}px`);
console.log('  => it is an APPROXIMATION, not an edge-to-edge distance. Name it accordingly.');

console.log('\n=== 5. SUBMETRIC COUNT ===');
const dims={hierarchy:3,grouping:3,structure:3,flow:3,spatial:5,'variety-harmony':2};
const total=Object.values(dims).reduce((a,b)=>a+b,0);
console.log(' ',Object.entries(dims).map(([k,v])=>`${k} ${v}`).join('  '));
console.log('  total =',total,' (draft-1 claimed 20)');
const prov={'from-manuscript':['m_f,1','m_f,3','m_p,5','m_v,1'],
            'derived':['m_g,1','m_s,2','m_p,1','m_p,2','m_p,3','m_v,2'],
            'novel':['m_h,1','m_h,2','m_h,3','m_g,2','m_g,3','m_s,1','m_s,3','m_f,2','m_p,4']};
for(const [k,v] of Object.entries(prov)) console.log(`  ${k.padEnd(16)} ${v.length}  ${v.join(', ')}`);
console.log('  sum =',Object.values(prov).reduce((a,v)=>a+v.length,0),' (draft-1 claimed 4/6/10)');

console.log('\n=== 6. m_p,5 BALANCE can exceed 1 if a centroid lies outside the canvas ===');
const p=[600,600], c=[250,250];
console.log(`  centroid at (${p}) : ||p-c|| = ${Math.hypot(p[0]-c[0],p[1]-c[1]).toFixed(4)} > dMax ${dMax.toFixed(4)}`);
console.log('  => 1 - ratio would be NEGATIVE. Requires an explicit min(1, .) clip.');
