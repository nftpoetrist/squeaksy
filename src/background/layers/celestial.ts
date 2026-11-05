import type { Frame, Scene } from '../scene';
import { hex, type RGB } from '../util/color';
import { TAU } from '../util/math';
import { bayer, createCanvas, drawCentered, glowSprite } from '../util/pixel';

function discSprite(r: number, shade: (dx: number, dy: number, d: number, x: number, y: number) => RGB | null): HTMLCanvasElement {
  const size = r * 2 + 1;
  const { canvas, ctx } = createCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r;
      const dy = y - r;
      const d = Math.sqrt(dx * dx + dy * dy) / (r + 0.35);
      if (d > 1) continue;
      const c = shade(dx, dy, d, x, y);
      if (!c) continue;
      const o = (y * size + x) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Merkezi (W, H) olan 2W×2H tuvale dither'lı ışık huzmeleri çizer (bir kez). */
function beamCanvas(W: number, H: number, set: number): HTMLCanvasElement {
  const w = W * 2;
  const h = H * 2;
  const { canvas, ctx } = createCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const col = hex('#ffc488');
  const beams = 12;
  const seg = TAU / beams;
  const L = Math.hypot(W, H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - W;
      const dy = y - H;
      let a = Math.atan2(dy, dx) + Math.PI + set * seg * 0.5;
      const k = Math.floor(a / seg);
      if (k % 2 !== 0) continue;
      a = (a % seg) / seg; // huzme içindeki konum 0..1
      const across = 1 - Math.abs(a - 0.5) * 2; // ortada 1
      const dist = Math.hypot(dx, dy) / L;
      const v = across * Math.pow(Math.max(0, 1 - dist), 1.4) * (dist < 0.04 ? dist / 0.04 : 1);
      if (v <= bayer(x, y) * 0.9 + 0.05) continue;
      const o = (y * w + x) * 4;
      d[o] = col[0];
      d[o + 1] = col[1];
      d[o + 2] = col[2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Ay (fırtına/bulutlu) ve devasa çarkın ortasında doğan güneş (güneşli). */
export class CelestialLayer {
  private moon: HTMLCanvasElement | null = null;
  private moonGlow: HTMLCanvasElement | null = null;
  private sun: HTMLCanvasElement | null = null;
  private sunGlow: HTMLCanvasElement | null = null;
  /** Dither'lı piksel güneş huzmeleri (iki takım, sırayla parlar) */
  private beams: HTMLCanvasElement[] = [];

  build(scene: Scene): void {
    const u = scene.u;
    const mr = Math.max(4, Math.round(8 * u));
    const moonBase = hex('#ece8ff');
    const moonShade = hex('#c4bcf0');
    const moonDeep = hex('#9d94d8');
    const craters = [
      [-0.35, -0.2, 0.22],
      [0.25, 0.3, 0.18],
      [0.1, -0.45, 0.12],
    ] as const;
    this.moon = discSprite(mr, (dx, dy, _d, x, y) => {
      const nx = dx / mr;
      const ny = dy / mr;
      for (const [cx, cy, cr] of craters) {
        if ((nx - cx) ** 2 + (ny - cy) ** 2 < cr * cr) return moonShade;
      }
      const s = nx * 0.8 + ny * 0.5;
      if (s > 0.62) return moonDeep;
      if (s > 0.3) return s - 0.3 > bayer(x, y) * 0.32 ? moonShade : moonBase;
      return moonBase;
    });
    this.moonGlow = glowSprite(mr * 3.2, hex('#8f86ff'), 0.4, 4, 1.4);

    const sr = Math.max(6, Math.round(20 * u));
    const core = hex('#fff6d6');
    const midC = hex('#ffe08a');
    const edge = hex('#ffb45e');
    this.sun = discSprite(sr, (_dx, _dy, d, x, y) => {
      if (d < 0.5) return core;
      if (d < 0.62) return (d - 0.5) / 0.12 > bayer(x, y) ? midC : core;
      if (d < 0.8) return midC;
      if (d < 0.88) return (d - 0.8) / 0.08 > bayer(x, y) ? edge : midC;
      return edge;
    });
    this.sunGlow = glowSprite(sr * 2.8, hex('#ff9a50'), 0.6, 5, 1.25);
    this.beams = [0, 1].map((set) => beamCanvas(scene.W, scene.H, set));
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame, scene: Scene): void {
    const { W, H } = scene;
    const moonA = 1 - f.p.sun;
    if (this.moon && this.moonGlow && moonA > 0.01) {
      const mx = W * 0.15;
      const my = H * 0.14;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = moonA * 0.8;
      drawCentered(ctx, this.moonGlow, mx, my);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = moonA;
      drawCentered(ctx, this.moon, mx, my);
    }

    const s = f.p.sun;
    if (this.sun && this.sunGlow && s > 0.01) {
      // Güneş sağ tarafta dağların ardından yükselir, ufkun altına batar.
      const cx = Math.round(W * (W < H ? 0.68 : 0.66));
      const cy = Math.round(H * 0.34 + (1 - s) * H * 0.3);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = s;
      drawCentered(ctx, this.sunGlow, cx, cy);
      // Piksel ışık huzmeleri: iki takım yavaşça yer değiştirerek parlar
      for (let k = 0; k < this.beams.length; k++) {
        ctx.globalAlpha = s * (0.16 + 0.1 * Math.sin(f.t * 0.5 + k * Math.PI));
        ctx.drawImage(this.beams[k]!, cx - W, cy - H);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, s * 1.4);
      drawCentered(ctx, this.sun, cx, cy);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  }
}
