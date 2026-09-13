/**
 * Worked examples cited in docs/decisions/*. Run to regenerate.
 *   node scripts/worked-examples.mjs
 */
import { score, analyzeStructure, analyzeHarmony } from '../core/scoring/v0-as-shipped.js';
import { FIXTURES } from '../test/fixtures/layouts.mjs';
import { createLayout } from '../core/layout.js';

const mk = (color) => createLayout({ id:'c', elements: [
 {type:'circle',index:1,order:0,visible:true,x:150,y:150,size:60,rotation:0,color,filled:true},
 {type:'square',index:1,order:1,visible:true,x:320,y:260,size:80,rotation:0,color,filled:true}]});
console.log('--- P1 colour representation: same visual colour, three notations ---');
for (const c of ['#1F2937','rgb(31, 41, 55)','hsl(215, 28%, 17%)']) {
  const r = score(mk(c));
  console.log(`${c.padEnd(20)} total ${r.total.toFixed(4)}  spatial ${r.dimensions.spatial.toFixed(4)}  hier ${r.dimensions.hierarchy.toFixed(4)}  degenerate ${r.submetrics.balanceDegenerate}`);
}
console.log('\n--- P2 circle rotation (visually identical) ---');
for (const k of ['circlesRotationA','circlesRotationB']) {
  const r = score(FIXTURES[k]);
  console.log(`${k.padEnd(18)} total ${r.total.toFixed(4)}  struct ${r.dimensions.structure.toFixed(4)}  harm ${r.dimensions.harmony.toFixed(4)}`);
}
console.log('\n--- P3 structure normalisation candidates ---');
const vis = FIXTURES.perfectGrid.elements.filter(e=>e.visible);
const raw = (xg,yg,sc,ra)=>((xg+yg)*4+sc*4+ra*2);
console.log(`v0 perfectGrid structure = ${analyzeStructure(vis).toFixed(4)}  (raw/1.5)`);
console.log(`raw max = ${raw(1,1,1,1)}  -> /1.5 = ${(14/1.5).toFixed(4)}   /1.4 = ${(14/1.4).toFixed(4)}  rescale*10/14 = ${(14*10/14).toFixed(4)}`);
console.log('\n--- P4 exceptional cases ---');
for (const k of ['empty','allHidden','singleton','coincident','hugeOverlapping','offCanvas']) {
  const r = score(FIXTURES[k]);
  console.log(`${k.padEnd(16)} n=${r.elementCount} total=${String(r.total).padEnd(20)} grouping=${r.dimensions.grouping} ws=${(r.submetrics.whiteSpaceRatio??0).toFixed?.(4)}`);
}

console.log('\n--- P1 colour round-trip: is rounded hsl() equivalent? ---');
function _rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h,s,l=(mx+mn)/2;if(mx===mn){h=s=0}else{const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);switch(mx){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break}}return{h:h*360,s:s*100,l:l*100}}
function _hslToRgb(h,s,l){h=((h%360)+360)%360;s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r,g,b;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return{r:Math.round((r+m)*255),g:Math.round((g+m)*255),b:Math.round((b+m)*255)}}
{
  const ex=_rgbToHsl(31,41,55);
  console.log('#1F2937 exact hsl = hsl(%s, %s%%, %s%%)  <- the CSS form rounds this',
    ex.h.toFixed(3), ex.s.toFixed(3), ex.l.toFixed(3));
  let tested=0,fail=0;const first=[];
  for(let r=0;r<256;r+=7)for(let g=0;g<256;g+=11)for(let b=0;b<256;b+=13){
    const h=_rgbToHsl(r,g,b);
    const q=_hslToRgb(Math.round(h.h),Math.round(h.s),Math.round(h.l));
    tested++;
    if(q.r!==r||q.g!==g||q.b!==b){fail++;if(first.length<3)first.push([r,g,b,q]);}
  }
  console.log('rounded-hsl round-trip failures: %d / %d  (%s%%)',fail,tested,(100*fail/tested).toFixed(1));
  for(const [r,g,b,q] of first)
    console.log('   rgb(%d,%d,%d) -> rounded hsl -> rgb(%d,%d,%d)',r,g,b,q.r,q.g,q.b);
  const pal=['#1F2937','#374151','#4B5563','#6B7280','#DC2626','#EA580C','#D97706','#65A30D'];
  let ok=0;
  for(const hx of pal){const r=parseInt(hx.slice(1,3),16),g=parseInt(hx.slice(3,5),16),b=parseInt(hx.slice(5,7),16);
    const h=_rgbToHsl(r,g,b);const q=_hslToRgb(h.h,h.s,h.l);
    if(q.r===r&&q.g===g&&q.b===b)ok++;}
  console.log('application palette exact round-trips: %d/8', ok);
}

console.log('\n--- P2 triangle geometry and rotation origin ---');
{
  const V=[[0,-0.433],[-0.5,0.433],[0.5,0.433]];
  const rot=(p,d)=>{const r=d*Math.PI/180,c=Math.cos(r),n=Math.sin(r);return [p[0]*c-p[1]*n,p[0]*n+p[1]*c];};
  // Tolerance matching: every rotated vertex must coincide with SOME original
  // vertex. Exact comparison fails on float noise (sin(360deg) = -2.4e-16), and
  // the renderer's literal 0.433 is a ROUNDED sqrt(3)/4 = 0.4330127, so the drawn
  // triangle is equilateral only to ~1e-5 of its side length. Machine epsilon is
  // therefore the wrong bar; 1e-3 * size is sub-pixel at any realistic size.
  const same=(a,b,eps)=>a.every(p=>b.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<eps));
  const G=[0,(V[0][1]+V[1][1]+V[2][1])/3];
  const Vc=V.map(p=>[p[0]-G[0],p[1]-G[1]]);
  console.log('vertex |r| from draw origin: %s  <- unequal',V.map(p=>Math.hypot(...p).toFixed(4)).join(' '));
  console.log('vertex |r| from centroid   : %s  <- equal (equilateral)',Vc.map(p=>Math.hypot(...p).toFixed(4)).join(' '));
  console.log('centroid offset            : %s * size',G[1].toFixed(4));
  const exact=(v,d)=>same(v.map(p=>rot(p,d)),v,1e-9);
  const perc =(v,d)=>same(v.map(p=>rot(p,d)),v,1e-3);
  console.log('                     about draw-origin        about centroid');
  console.log('            exact(1e-9)  perceptual(1e-3)   exact(1e-9)  perceptual(1e-3)');
  for (const d of [90,120,180,240])
    console.log(`rot ${String(d).padStart(3)}deg ${String(exact(V,d)).padStart(9)} ${String(perc(V,d)).padStart(15)} ${String(exact(Vc,d)).padStart(14)} ${String(perc(Vc,d)).padStart(15)}`);
  console.log('sqrt(3)/4 = %s ; renderer literal = 0.433 -> equilateral to ~%s of side',
    (Math.sqrt(3)/4).toFixed(7), (Math.abs(Math.sqrt(3)/4-0.433)).toExponential(1));
  const SQ=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
  const RE=[[-.5,-.75],[.5,-.75],[.5,.75],[-.5,.75]];
  console.log('square  90deg about draw-origin: %s (exact)', same(SQ.map(p=>rot(p,90)),SQ,1e-9));
  console.log('rect   180deg about draw-origin: %s (exact)', same(RE.map(p=>rot(p,180)),RE,1e-9));
  console.log('rect    90deg about draw-origin: %s (exact)', same(RE.map(p=>rot(p,90)),RE,1e-9));
}
