import type { Frame, Scene } from '../scene';
import type { WeatherMode } from '../types';
import { sampleStops, type RGB } from '../util/color';
import { clamp } from '../util/math';
import { bayer, createCanvas } from '../util/pixel';

type Stops = ReadonlyArray<readonly [number, string]>;

const SKY: Record<WeatherMode, Stops> = {
  storm: [
    [0, '#05040f'],
    [0.3, '#0d0a26'],
    [0.6, '#1b1240'],
    [0.85, '#2c1a58'],
    [1, '#3a2266'],
  ],
  cloudy: [
    [0, '#0a0d29'],
    [0.35, '#161a48'],
    [0.65, '#2b2a66'],
    [0.88, '#463c84'],
    [1, '#5a4890'],
  ],
  // "Güneşli" mod: büyülü, altın saat alacakaranlığı
  sunny: [
    [0, '#1c2468'],
    [0.3, '#3b358c'],
    [0.55, '#77489c'],
    [0.76, '#c86a98'],
    [0.9, '#ff9f6a'],
    [1, '#ffd48a'],
  ],
};

/** Bantlı gradyan: her bandın sadece son kısmı dither'lanır (klasik piksel sanatı). */
function bandedGradient(w: number, h: number, stops: Stops, span: number, bands: number): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const colors: RGB[] = [];
  for (let b = 0; b < bands; b++) colors.push(sampleStops(stops, b / (bands - 1)));
  for (let y = 0; y < h; y++) {
    const g = clamp(y / span, 0, 1) * (bands - 1);
    const i = Math.floor(g);
    const s = clamp((g - i - 0.72) / 0.28, 0, 1);
    for (let x = 0; x < w; x++) {
      const c = colors[i < bands - 1 && s > bayer(x, y) ? i + 1 : i]!;
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

export class SkyLayer {
  private storm: HTMLCanvasElement | null = null;
  private cloudy: HTMLCanvasElement | null = null;
  private sunny: HTMLCanvasElement | null = null;

  build(scene: Scene): void {
    const bands = 18;
    this.storm = bandedGradient(scene.W, scene.H, SKY.storm, scene.horizon, bands);
    this.cloudy = bandedGradient(scene.W, scene.H, SKY.cloudy, scene.horizon, bands);
    this.sunny = bandedGradient(scene.W, scene.H, SKY.sunny, scene.horizon, bands);
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame): void {
    if (!this.storm || !this.cloudy || !this.sunny) return;
    // Ağırlıklar: güneş, fırtına (koyuluk) ve bulutlu; ardışık çapraz geçişle karışır.
    const wSun = f.p.sun;
    const wStorm = (1 - wSun) * f.p.cloudDarkness;
    const wCloud = Math.max(0, 1 - wSun - wStorm);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.storm, 0, 0);
    const a1 = wStorm + wCloud > 0 ? wCloud / (wStorm + wCloud) : 0;
    if (a1 > 0.004) {
      ctx.globalAlpha = a1;
      ctx.drawImage(this.cloudy, 0, 0);
    }
    if (wSun > 0.004) {
      ctx.globalAlpha = wSun;
      ctx.drawImage(this.sunny, 0, 0);
    }
    ctx.globalAlpha = 1;
  }
}
