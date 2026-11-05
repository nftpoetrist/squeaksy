export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Kare hızından bağımsız üstel yaklaşma (tau saniye zaman sabiti). */
export function approach(cur: number, target: number, dt: number, tau: number): number {
  return tau <= 0 ? target : target + (cur - target) * Math.exp(-dt / tau);
}
