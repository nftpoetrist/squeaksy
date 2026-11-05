export type Rng = () => number;

/** Tohumlu, hızlı rastgele sayı üretici (aynı tohum → aynı manzara). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (r: Rng, min: number, max: number): number => min + (max - min) * r();

export const randInt = (r: Rng, min: number, max: number): number => Math.floor(min + (max - min + 1) * r());

/** Tohumsuz (her seferinde farklı) dinamik olaylar için */
export const frand = (min: number, max: number): number => min + (max - min) * Math.random();
