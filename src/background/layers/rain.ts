import { ridgeAt, type Frame, type Scene } from '../scene';
import { RectBatch } from '../util/pixel';

// Hafif çiseleme: kısa, şeffaf damlalar
const LAYERS = [
  { speed: 130, len: 2, color: '#5b5aa6', alpha: 0.32, share: 0.45 },
  { speed: 190, len: 3, color: '#7d84c4', alpha: 0.42, share: 0.35 },
  { speed: 260, len: 4, color: '#a8b6f0', alpha: 0.55, share: 0.2 },
] as const;

const MAX_SPLASH = 200;

/** Havuzlanmış yağmur damlaları (Float32Array, kare başına ayırma yok). */
export class RainLayer {
  private n = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private land = new Float32Array(0);
  private layer = new Uint8Array(0);
  private dormant = new Uint8Array(0);
  private batches = LAYERS.map(() => new RectBatch());
  private sx = new Float32Array(MAX_SPLASH);
  private sy = new Float32Array(MAX_SPLASH);
  private svx = new Float32Array(MAX_SPLASH);
  private svy = new Float32Array(MAX_SPLASH);
  private slife = new Float32Array(MAX_SPLASH);
  private sNext = 0;
  private splashBatch = new RectBatch();
  private scene: Scene | null = null;

  build(scene: Scene, maxDrops: number): void {
    this.scene = scene;
    this.n = maxDrops;
    this.x = new Float32Array(maxDrops);
    this.y = new Float32Array(maxDrops);
    this.land = new Float32Array(maxDrops);
    this.layer = new Uint8Array(maxDrops);
    this.dormant = new Uint8Array(maxDrops);
    const a = LAYERS[0].share;
    const b = a + LAYERS[1].share;
    for (let i = 0; i < maxDrops; i++) {
      const r = (i + 0.5) / maxDrops;
      this.layer[i] = r < a ? 0 : r < b ? 1 : 2;
      this.land[i] = Math.random();
      this.spawn(i, 0, true);
    }
    this.slife.fill(0);
  }

  private spawn(i: number, slant: number, initial: boolean): void {
    const s = this.scene!;
    const margin = Math.abs(slant) * s.H;
    this.x[i] = -margin * Math.sign(slant) + Math.random() * (s.W + margin);
    this.y[i] = initial ? Math.random() * s.H : -10 - Math.random() * s.H * 0.25;
  }

  private stopY(i: number, x: number): number {
    const s = this.scene!;
    const l = this.layer[i]!;
    if (l === 0) return ridgeAt(s.midRidge, s, x, s.offsets.mid) + this.land[i]! * 4;
    const g = ridgeAt(s.groundTop, s, x, s.offsets.ground);
    if (l === 1) return g + this.land[i]! * 6;
    return g + this.land[i]! * (s.H - g);
  }

  private splash(x: number, y: number, u: number): void {
    for (let k = 0; k < 2; k++) {
      const j = this.sNext;
      this.sNext = (j + 1) % MAX_SPLASH;
      this.sx[j] = x;
      this.sy[j] = y;
      this.svx[j] = (k === 0 ? -1 : 1) * (10 + Math.random() * 18) * u;
      this.svy[j] = -(22 + Math.random() * 26) * u;
      this.slife[j] = 0.22 + Math.random() * 0.1;
    }
  }

  update(dt: number, f: Frame, speedMul: number, splashes: boolean): void {
    const s = this.scene;
    if (!s) return;
    const slant = f.p.wind * 0.45;
    const active = Math.round(this.n * f.p.rain * f.q);
    for (let i = 0; i < this.n; i++) {
      if (i >= active) {
        this.dormant[i] = 1;
        continue;
      }
      if (this.dormant[i]) {
        this.dormant[i] = 0;
        this.spawn(i, slant, false);
      }
      const L = LAYERS[this.layer[i]!]!;
      const v = L.speed * s.u * speedMul * dt;
      this.y[i]! += v;
      this.x[i]! += slant * v;
      const stop = this.stopY(i, this.x[i]!);
      if (this.y[i]! >= stop) {
        if (splashes && this.layer[i] === 2 && this.land[i]! < 0.2 && f.q > 0.5) this.splash(this.x[i]!, stop, s.u);
        this.land[i] = Math.random();
        this.spawn(i, slant, false);
      }
    }
    const g = 320 * s.u;
    for (let j = 0; j < MAX_SPLASH; j++) {
      if (this.slife[j]! <= 0) continue;
      this.slife[j]! -= dt;
      this.svy[j]! += g * dt;
      this.sx[j]! += this.svx[j]! * dt;
      this.sy[j]! += this.svy[j]! * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame): void {
    const s = this.scene;
    if (!s) return;
    const slant = f.p.wind * 0.45;
    const as = Math.abs(slant);
    const run = as > 0.01 ? Math.max(1, Math.round(1 / as)) : 9999;
    const dir = slant >= 0 ? 1 : -1;
    for (let i = 0; i < this.n; i++) {
      if (this.dormant[i]) continue;
      const l = this.layer[i]!;
      const len = Math.max(1, Math.round(LAYERS[l]!.len * s.u));
      const x = Math.round(this.x[i]!);
      const y = Math.round(this.y[i]!);
      const batch = this.batches[l]!;
      if (run >= len) {
        batch.add(x, y, 1, len);
      } else {
        // Eğik damla: kısa dikey parçalar halinde (piksel sanatı çizgisi)
        for (let k = 0; k < len; k += run) batch.add(x + dir * Math.floor(k / run), y + k, 1, Math.min(run, len - k));
      }
    }
    const boost = f.flash * 0.25;
    for (let l = 0; l < LAYERS.length; l++) {
      const L = LAYERS[l]!;
      this.batches[l]!.flush(ctx, L.color, Math.min(1, L.alpha * (0.6 + 0.4 * f.p.rain) + boost));
    }
    for (let j = 0; j < MAX_SPLASH; j++) {
      if (this.slife[j]! > 0) this.splashBatch.add(Math.round(this.sx[j]!), Math.round(this.sy[j]!));
    }
    this.splashBatch.flush(ctx, '#c8d4ff', 0.55);
  }
}
