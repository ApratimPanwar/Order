import { score, analyzeSpatial, analyzeStructure, analyzeHarmony, analyzeGrouping, analyzeHierarchy, analyzeFlow, V0_CONFIG } from '../core/scoring/v0-as-shipped.js';
import { generateLayout } from '../core/generate.js';
import { getPreset, listPresets } from '../core/presets/registry.js';

console.log('=== (a) ATTAINABLE MAXIMA per dimension, empirical over v0 ===');
const DIMS=['hierarchy','grouping','structure','flow','spatial','harmony'];
const max=Object.fromEntries(DIMS.map(d=>[d,-Infinity]));
const ids=listPresets().map(p=>p.id);
for(let seed=1;seed<=3000;seed++){
  const base=generateLayout({seed});
  const cands=[base,...ids.map(id=>getPreset(id).apply(base))];
  for(const l of cands){const r=score(l);if(r.elementCount===0)continue;
    for(const d of DIMS) if(Number.isFinite(r.dimensions[d])) max[d]=Math.max(max[d],r.dimensions[d]);}
}
for(const d of DIMS) console.log(`  ${d.padEnd(10)} observed max ${max[d].toFixed(4)}`);

console.log('\n=== (b) LIGHTNESS MONOTONICITY of the balance term ===');
// Two elements. Sweep the lightness of ONE and watch the weighted centroid.
function bal(colorA){
  const L=(c)=>{const r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);
    return Math.pow(0.2126*r+0.7152*g+0.0722*b,1/2.2)/255;};
  const els=[{x:100,y:250,area:10000,c:colorA},{x:400,y:250,area:10000,c:'#808080'}];
  let wx=0,tw=0;
  for(const e of els){const w=e.area*L(e.c);wx+=e.x*w;tw+=w;}
  const cx=tw>0?wx/tw:250;
  const dev=Math.abs(cx-250);
  return {cx,dev,balance:10-(dev/250)*5};
}
const grey=(v)=>'#'+v.toString(16).padStart(2,'0').repeat(3);
let prev=null,dirs=[];
for(let v=0;v<=255;v+=15){
  const b=bal(grey(v));
  if(prev!==null) dirs.push(Math.sign(+(b.balance-prev).toFixed(9)));
  prev=b.balance;
  if(v%45===0) console.log(`  lightness ${String(v).padStart(3)}  centroidX ${b.cx.toFixed(2)}  balance ${b.balance.toFixed(4)}`);
}
const ups=dirs.filter(d=>d>0).length, downs=dirs.filter(d=>d<0).length;
console.log(`  direction changes: up=${ups} down=${downs}  => ${ups&&downs?'NOT MONOTONE':'monotone'}`);

console.log('\n=== (c) TOLERANCE MAGNITUDES for triangle symmetry ===');
const S3=Math.sqrt(3)/4, lit=0.433;
console.log(`  sqrt(3)/4 = ${S3.toFixed(9)} ; literal 0.433 ; delta = ${(S3-lit).toExponential(2)} of side`);
for(const size of [20,40,120,200])
  console.log(`  size ${String(size).padStart(3)}px -> vertex error ${( (S3-lit)*size ).toExponential(2)}px ; 1e-3*size = ${(1e-3*size).toFixed(4)}px`);

console.log('\n=== (d) RENDERER VARIANTS: does rotating about the centroid preserve rotation-0 pixels? ===');
const rot=(p,d)=>{const r=d*Math.PI/180,c=Math.cos(r),n=Math.sin(r);return [p[0]*c-p[1]*n,p[0]*n+p[1]*c];};
const Vb=[[0,-0.433],[-0.5,0.433],[0.5,0.433]];          // bbox-centred (renderer-1 local)
const off=[0,0.433/3];                                    // centroid offset from bbox centre
const Vc=Vb.map(p=>[p[0]-off[0],p[1]-off[1]]);            // centroid-centred local
const near=(a,b,eps=1e-9)=>a.every(p=>b.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<eps));
for(const th of [0,37,120]){
  const r1 = Vb.map(p=>rot(p,th));                                  // renderer-1
  const r2 = Vc.map(p=>rot(p,th));                                  // renderer-2  (anchor = centroid)
  const r2b= Vc.map(p=>rot(p,th)).map(p=>[p[0]+off[0],p[1]+off[1]]); // renderer-2b (anchor = bbox centre, rotate about centroid)
  console.log(`  theta=${String(th).padStart(3)}  r2 == r1? ${String(near(r2,r1)).padEnd(5)}  r2b == r1? ${near(r2b,r1)}`);
}
console.log('  r2b at 120 == r2b at 0 ?',
  near(Vc.map(p=>rot(p,120)).map(p=>[p[0]+off[0],p[1]+off[1]]),
       Vc.map(p=>rot(p,0)).map(p=>[p[0]+off[0],p[1]+off[1]]), 1e-3));
