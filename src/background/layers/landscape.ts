import type { Frame, Scene } from '../scene';
import { hex, type RGB } from '../util/color';
import { bayer, createCanvas, RectBatch } from '../util/pixel';
import { rand, randInt, type Rng } from '../util/rng';

interface TerrainPalette {
  fill: string;
  fill2: string;
  rim: string;
  rim2: string;
}

const FAR: Record<'night' | 'sun', TerrainPalette> = {
  night: { fill: '#21184a', fill2: '#1a1240', rim: '#3d2f78', rim2: '#2e2364' },
  sun: { fill: '#4a2b69', fill2: '#40245e', rim: '#f09a8a', rim2: '#b8607a' },
};
const MID: Record<'night' | 'sun', TerrainPalette> = {
  night: { fill: '#150e31', fill2: '#110b29', rim: '#2c205e', rim2: '#211849' },
  sun: { fill: '#2a1846', fill2: '#24143d', rim: '#a8587a', rim2: '#6e3a64' },
};
const GROUND: Record<'night' | 'sun', TerrainPalette & { grass: string; tip: string }> = {
  night: { fill: '#0a0717', fill2: '#07050f', rim: '#1e1740', rim2: '#151030', grass: '#221a48', tip: '#33296a' },
  sun: { fill: '#150c26', fill2: '#100820', rim: '#3c2450', rim2: '#2a1a3e', grass: '#4a2c58', tip: '#ffb070' },
};
const HAZE = { night: '#43397f', sun: '#ffb08a' };

/** Orta nokta kaydırmalı fraktal sırt, -1..1 aralığına normalize. */
function fractalRidge(len: number, rng: Rng, roughness: number): Float32Array {
  let size = 1;
  while (size < len) size <<= 1;
  const a = new Float32Array(size + 1);
  a[0] = rng() * 2 - 1;
  a[size] = rng() * 2 - 1;
  let step = size;
  let amp = 1;
  while (step > 1) {
    const half = step >> 1;
    for (let i = half; i < size; i += step) a[i] = (a[i - half]! + a[i + half]!) / 2 + (rng() * 2 - 1) * amp;
    amp *= roughness;
    step = half;
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < len; i++) {
    mn = Math.min(mn, a[i]!);
    mx = Math.max(mx, a[i]!);
  }
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = ((a[i]! - mn) / (mx - mn || 1)) * 2 - 1;
  return out;
}

function smooth(src: Float32Array, k: number): Float32Array {
  if (k <= 0) return src;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = -k; j <= k; j++) {
      const v = src[i + j];
      if (v !== undefined) {
        s += v;
        n++;
      }
    }
    out[i] = s / n;
  }
  return out;
}

/** Sırt çizgisinin altını doldurur: üst kenar ışığı, sola bakan yamaç ışığı, dither doku. */
function paintTerrain(w: number, h: number, ridge: Float32Array, pal: TerrainPalette, texture: number) {
  const c2d = createCanvas(w, h);
  const img = c2d.ctx.createImageData(w, h);
  const d = img.data;
  const fill = hex(pal.fill);
  const fill2 = hex(pal.fill2);
  const rim = hex(pal.rim);
  const rim2 = hex(pal.rim2);
  for (let x = 0; x < w; x++) {
    const top = Math.max(0, Math.round(ridge[x]!));
    const leftTop = Math.round(ridge[Math.max(0, x - 1)]!);
    for (let y = top; y < h; y++) {
      const depth = y - top;
      let c: RGB = fill;
      if (depth === 0) c = rim;
      else if (y < leftTop || depth === 1) c = rim2;
      else if (texture > 0 && depth > 3 && bayer(x, y) < texture) c = fill2;
      const o = (y * w + x) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  c2d.ctx.putImageData(img, 0, 0);
  return c2d;
}

/** Dither'lı sis bandı (tam opak pikseller, globalAlpha ile çizilir). */
function hazeCanvas(w: number, h: number, color: string, centerY: number, sigma: number, maxA: number) {
  const { canvas, ctx } = createCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const c = hex(color);
  for (let y = 0; y < h; y++) {
    const a = maxA * Math.exp(-(((y - centerY) / sigma) ** 2));
    if (a < 0.02) continue;
    for (let x = 0; x < w; x++) {
      if (bayer(x, y) >= a) continue;
      const o = (y * w + x) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

interface Puddle {
  x: number;
  y: number;
  w: number;
}

export class LandscapeLayer {
  private far: Record<'night' | 'sun', HTMLCanvasElement> | null = null;
  private haze: Record<'night' | 'sun', HTMLCanvasElement> | null = null;
  private mid: Record<'night' | 'sun', HTMLCanvasElement> | null = null;
  private ground: Record<'night' | 'sun', HTMLCanvasElement> | null = null;
  private puddles: Puddle[] = [];
  private puddleNight = new RectBatch();
  private puddleSun = new RectBatch();
  private puddleHi = new RectBatch();
  private ripple = new RectBatch();
  private PAD = 0;

  build(scene: Scene, rng: Rng): void {
    const { H, u } = scene;
    const LW = scene.W + scene.PAD * 2;
    this.PAD = scene.PAD;

    // --- Sırtlar
    const farN = fractalRidge(LW, rng, 0.56);
    const farR = new Float32Array(LW);
    for (let i = 0; i < LW; i++) farR[i] = H * 0.6 - H * 0.17 * Math.pow(farN[i]! * 0.5 + 0.5, 1.35);

    const midN = smooth(fractalRidge(LW, rng, 0.42), Math.max(1, Math.round(3 * u)));
    const midR = new Float32Array(LW);
    for (let i = 0; i < LW; i++) midR[i] = H * 0.735 - H * 0.075 * (midN[i]! * 0.5 + 0.5);
    // Kulübe bölgesinin arkasında tepe yükselmesin: orta sırt alçak, neredeyse düz bir ovaya iner
    if (scene.plateau) {
      const pl = scene.plateau;
      const low = H * 0.735 - H * 0.012;
      const mb = 46 * u;
      for (let i = 0; i < LW; i++) {
        const x = i - scene.PAD;
        const k = x >= pl.x0 ? 1 : x <= pl.x0 - mb ? 0 : 0.5 - 0.5 * Math.cos(((x - (pl.x0 - mb)) / mb) * Math.PI);
        midR[i] = midR[i]! + (Math.max(midR[i]!, low) - midR[i]!) * k;
      }
    }

    // Ön zemin: daha yüksek ve düz (oyun alanı); çarkın altı tamamen düz
    const gN = smooth(fractalRidge(LW, rng, 0.45), Math.max(1, Math.round(2 * u)));
    const gR = new Float32Array(LW);
    const wh = scene.wheel;
    const flatHalf = wh.R * 1.15;
    const blend = wh.R * 0.9;
    for (let i = 0; i < LW; i++) {
      const natural = H * 0.815 - H * 0.035 * (gN[i]! * 0.5 + 0.5);
      const dist = Math.abs(i - scene.PAD - wh.cx);
      const k = dist <= flatHalf ? 1 : dist >= flatHalf + blend ? 0 : 0.5 + 0.5 * Math.cos(((dist - flatHalf) / blend) * Math.PI);
      gR[i] = natural + (wh.groundY - natural) * k;
      // Kulübe bölgesi: tepe/dağ eteği değil, düz zemin (sol kenarı yumuşakça bağlanır)
      const pl = scene.plateau;
      if (pl) {
        const x = i - scene.PAD;
        const pb = 22 * u;
        const kp = x >= pl.x0 ? 1 : x <= pl.x0 - pb ? 0 : 0.5 - 0.5 * Math.cos(((x - (pl.x0 - pb)) / pb) * Math.PI);
        gR[i] = gR[i]! + (pl.y - gR[i]!) * kp;
      }
    }
    const inWheelZone = (x: number) => Math.abs(x - scene.PAD - wh.cx) < flatHalf + blend * 0.5;

    scene.farRidge = farR;
    scene.midRidge = midR;
    scene.groundTop = gR;

    // --- Uzak dağlar ve sis
    this.far = {
      night: paintTerrain(LW, H, farR, FAR.night, 0.07).canvas,
      sun: paintTerrain(LW, H, farR, FAR.sun, 0.07).canvas,
    };
    this.haze = {
      night: hazeCanvas(LW, H, HAZE.night, H * 0.63, H * 0.045, 0.3),
      sun: hazeCanvas(LW, H, HAZE.sun, H * 0.63, H * 0.045, 0.3),
    };

    // --- Orta tepeler (sade)
    this.mid = {
      night: paintTerrain(LW, H, midR, MID.night, 0.05).canvas,
      sun: paintTerrain(LW, H, midR, MID.sun, 0.05).canvas,
    };

    // --- Ön zemin: çimen tutamları
    const tufts: Array<[number, number]> = [];
    for (let x = 0; x < LW; x += randInt(rng, 1, 4)) tufts.push([x, randInt(rng, 1, Math.max(2, Math.round(3 * u)))]);
    const paintGround = (pal: (typeof GROUND)['night']) => {
      const c2d = paintTerrain(LW, H, gR, pal, 0.09);
      const grass = new RectBatch();
      const tips = new RectBatch();
      for (const [x, h] of tufts) {
        const top = Math.round(gR[x]!);
        grass.add(x, top - h, 1, h);
        tips.add(x, top - h, 1, 1);
      }
      grass.flush(c2d.ctx, pal.grass);
      tips.flush(c2d.ctx, pal.tip, 0.8);
      return c2d.canvas;
    };
    this.ground = { night: paintGround(GROUND.night), sun: paintGround(GROUND.sun) };

    // Su birikintileri: gökyüzünü ve şimşeği yansıtır
    this.puddles = [];
    const puddleCount = Math.max(4, Math.round(LW / (55 * u)));
    for (let i = 0; i < puddleCount; i++) {
      const x = Math.round(rand(rng, 0.02, 0.92) * LW);
      if (inWheelZone(x) || inWheelZone(x + 30 * u)) continue;
      const top = Math.round(gR[x]!);
      const y = Math.round(top + rand(rng, 0.25, 0.85) * (H - top));
      this.puddles.push({ x, y, w: Math.round(rand(rng, 10, 30) * u * (0.6 + (y - top) / (H - top))) });
    }

  }

  // Not: zemin katmanları bilerek sabittir (paralaks yok); sadece bulutlar hareket eder.
  private pair(ctx: CanvasRenderingContext2D, pair: Record<'night' | 'sun', HTMLCanvasElement>, sun: number, x: number, y: number, a = 1): void {
    ctx.globalAlpha = a;
    ctx.drawImage(pair.night, x, y);
    if (sun > 0.004) {
      ctx.globalAlpha = sun * a;
      ctx.drawImage(pair.sun, x, y);
    }
    ctx.globalAlpha = 1;
  }

  drawFar(ctx: CanvasRenderingContext2D, f: Frame, scene: Scene): void {
    if (!this.far) return;
    const ox = 0;
    scene.offsets.far = ox;
    this.pair(ctx, this.far, f.p.sun, ox - this.PAD, 0);
  }

  drawHaze(ctx: CanvasRenderingContext2D, f: Frame): void {
    if (!this.haze) return;
    const a = 0.16 + f.p.rain * 0.22 + f.p.cloudCover * 0.06;
    this.pair(ctx, this.haze, f.p.sun, 0 - this.PAD, 0, a);
  }

  drawMid(ctx: CanvasRenderingContext2D, f: Frame, scene: Scene): void {
    if (!this.mid) return;
    const ox = 0;
    scene.offsets.mid = ox;
    this.pair(ctx, this.mid, f.p.sun, ox - this.PAD, 0);
  }

  drawGround(ctx: CanvasRenderingContext2D, f: Frame, scene: Scene): void {
    if (!this.ground) return;
    const ox = 0;
    const oy = 0;
    scene.offsets.ground = ox;
    this.pair(ctx, this.ground, f.p.sun, ox - this.PAD, oy);
    for (const p of this.puddles) {
      const x = p.x - this.PAD + ox;
      const y = p.y + oy;
      const inset = Math.max(2, Math.round(p.w * 0.12));
      for (const b of [this.puddleNight, this.puddleSun]) {
        b.add(x + inset, y, p.w - inset * 2, 1);
        b.add(x, y + 1, p.w, 1);
        b.add(x + inset, y + 2, p.w - inset * 2, 1);
      }
      this.puddleHi.add(x + inset + 1, y + 1, Math.max(1, Math.round(p.w * 0.25)), 1);
      // Yağmur damlası halkaları
      // Kare hızından bağımsız: 60 FPS'te kare başına rain*0.5 olasılık
      if (f.p.rain > 0.05 && Math.random() < f.p.rain * 30 * f.dt) {
        this.ripple.add(x + Math.floor(Math.random() * p.w), y + 1, 2, 1);
      }
    }
    this.puddleNight.flush(ctx, '#251e52', 1);
    this.puddleSun.flush(ctx, '#c86a98', f.p.sun);
    this.puddleHi.flush(ctx, f.p.sun > 0.5 ? '#ffd48a' : '#5a4a9a', 0.9);
    this.ripple.flush(ctx, '#9aa6e8', 0.8);
    ctx.globalCompositeOperation = 'lighter';
    if (f.flash > 0.02) {
      for (const p of this.puddles) this.puddleHi.add(p.x - this.PAD + ox, p.y + oy + 1, p.w, 1);
      this.puddleHi.flush(ctx, '#bfe0ff', f.flash * 1.4);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
