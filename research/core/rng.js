/**
 * Seeded, versioned PRNG.
 *
 * IMPORTANT: replacing Math.random() with this is NOT behaviour-neutral. The
 * original application draws from the host's unseeded Math.random(); any layout
 * generated here is a different draw, not a reproduction of a historical one.
 * This change is documented separately from scorer changes — see
 * research/docs/CHANGES.md.
 *
 * The algorithm and version are recorded in every generated layout's meta so a
 * future build can tell whether it is able to reproduce a given sequence.
 */

export const RNG_ALGORITHM = 'mulberry32';
export const RNG_VERSION = 'rng-1';

/** 32-bit string hash, so human-readable seeds ("pilot-A") work as well as numbers. */
export function seedFrom(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  const s = String(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * @param {number|string} seed
 * @returns {{next:()=>number, int:(min:number,max:number)=>number,
 *            pick:<T>(arr:T[])=>T, bool:(p:number)=>boolean,
 *            state:()=>number, algorithm:string, version:string, seed:number}}
 */
export function createRng(seed) {
  const initial = seedFrom(seed);
  let a = initial;

  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p,
    /** Current internal state, so a sequence can be resumed or audited. */
    state: () => a >>> 0,
    algorithm: RNG_ALGORITHM,
    version: RNG_VERSION,
    seed: initial,
  };
}
