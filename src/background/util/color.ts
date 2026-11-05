export type RGB = readonly [number, number, number];

export function hex(h: string): RGB {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function css(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** [konum 0..1, renk] duraklarından renk örnekler. */
export function sampleStops(stops: ReadonlyArray<readonly [number, string]>, t: number): RGB {
  const first = stops[0]!;
  if (t <= first[0]) return hex(first[1]);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (t <= b[0]) return mix(hex(a[1]), hex(b[1]), (t - a[0]) / (b[0] - a[0] || 1));
  }
  return hex(stops[stops.length - 1]![1]);
}
