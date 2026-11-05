import type { RGB } from './color';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** 4x4 Bayer eşik değeri (0..1): piksel sanat dither'ı için. */
export function bayer(x: number, y: number): number {
  return BAYER4[((y & 3) << 2) | (x & 3)]!;
}

export interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export function createCanvas(w: number, h: number): Canvas2D {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/**
 * Aynı renkteki çok sayıda pikseli tek bir path + tek fill() ile çizer.
 * Binlerce fillRect çağrısına göre çok daha ucuzdur; üst üste binen
 * dikdörtgenler birleşir (alfa birikmez) → keskin piksel görünümü.
 */
export class RectBatch {
  private d: number[] = [];
  private n = 0;

  add(x: number, y: number, w = 1, h = 1): void {
    const d = this.d;
    const i = this.n;
    d[i] = x;
    d[i + 1] = y;
    d[i + 2] = w;
    d[i + 3] = h;
    this.n = i + 4;
  }

  get empty(): boolean {
    return this.n === 0;
  }

  flush(ctx: CanvasRenderingContext2D, style: string, alpha = 1): void {
    if (this.n === 0) return;
    if (alpha > 0.004) {
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * Math.min(1, alpha);
      ctx.fillStyle = style;
      ctx.beginPath();
      const d = this.d;
      for (let i = 0; i < this.n; i += 4) ctx.rect(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!);
      ctx.fill();
      ctx.globalAlpha = prev;
    }
    this.n = 0;
  }

  clear(): void {
    this.n = 0;
  }
}

/** Bresenham çizgisi: her piksel için plot(x, y, sıra) çağırır. */
export function plotLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number, i: number) => void,
): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let i = 0;
  for (;;) {
    plot(x0, y0, i++);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Kademeli + dither'lı yuvarlak ışık (piksel sanatı "glow"). 'lighter' ile çizilir. */
export function glowSprite(radius: number, color: RGB, maxAlpha = 1, levels = 4, falloff = 1.6): HTMLCanvasElement {
  const r = Math.max(1, Math.round(radius));
  const size = r * 2 + 1;
  const { canvas, ctx } = createCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r;
      const dy = y - r;
      const dist = Math.sqrt(dx * dx + dy * dy) / (r + 0.5);
      if (dist >= 1) continue;
      const a = Math.pow(1 - dist, falloff) * maxAlpha;
      const q = a * levels;
      let lv = Math.floor(q);
      if (q - lv > bayer(x, y)) lv++;
      if (lv <= 0) continue;
      const i = (y * size + x) * 4;
      d[i] = color[0];
      d[i + 1] = color[1];
      d[i + 2] = color[2];
      d[i + 3] = Math.round(Math.min(1, lv / levels) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Canvas'ı merkezinden, tam sayı piksele hizalı çizer. */
export function drawCentered(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number): void {
  ctx.drawImage(img, Math.round(x - (img.width >> 1)), Math.round(y - (img.height >> 1)));
}
