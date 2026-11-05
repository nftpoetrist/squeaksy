import type { Frame, Scene } from '../scene';
import { hex } from '../util/color';
import { drawCentered, glowSprite, RectBatch } from '../util/pixel';

/** Atmosferde süzülen altın parçacıklar (güneşte çoğalır). */
export class MotesLayer {
  private n = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private vy = new Float32Array(0);
  private ph = new Float32Array(0);
  private age = new Float32Array(0);
  private life = new Float32Array(0);
  private glow: HTMLCanvasElement | null = null;
  private glowBig: HTMLCanvasElement | null = null;
  private cores = new RectBatch();
  private scene: Scene | null = null;

  build(scene: Scene, max: number): void {
    this.scene = scene;
    this.n = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.ph = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.respawn(i);
      this.age[i] = Math.random() * this.life[i]!;
    }
    this.glow = glowSprite(2.5 * scene.u, hex('#ffd46a'), 0.9, 3, 1.2);
    this.glowBig = glowSprite(4 * scene.u, hex('#ffc04a'), 0.8, 4, 1.4);
  }

  private respawn(i: number): void {
    const s = this.scene!;
    this.x[i] = Math.random() * s.W;
    this.y[i] = s.H * (0.25 + Math.random() * 0.75);
    this.vy[i] = -(3 + Math.random() * 7) * s.u;
    this.ph[i] = Math.random() * 10;
    this.age[i] = 0;
    this.life[i] = 4 + Math.random() * 6;
  }

  update(dt: number, f: Frame): void {
    const s = this.scene;
    if (!s) return;
    for (let i = 0; i < this.n; i++) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]! || this.y[i]! < -4) {
        this.respawn(i);
        continue;
      }
      this.y[i]! += this.vy[i]! * dt;
      this.x[i]! += (f.p.wind * 6 + Math.sin(f.t * 0.8 + this.ph[i]!) * 3) * s.u * dt;
      if (this.x[i]! < -4) this.x[i]! += s.W + 8;
      else if (this.x[i]! > s.W + 4) this.x[i]! -= s.W + 8;
    }
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame): void {
    if (!this.glow || !this.glowBig) return;
    const active = Math.round(this.n * Math.max(0.08, f.p.motes) * f.q);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < active; i++) {
      const t = this.age[i]! / this.life[i]!;
      const fade = Math.min(1, t * 4, (1 - t) * 3);
      const tw = 0.6 + 0.4 * Math.sin(f.t * 3 + this.ph[i]! * 5);
      const a = fade * tw;
      if (a < 0.03) continue;
      ctx.globalAlpha = a;
      const big = (i & 7) === 0;
      drawCentered(ctx, big ? this.glowBig : this.glow, this.x[i]!, this.y[i]!);
      if (a > 0.5) this.cores.add(Math.round(this.x[i]!), Math.round(this.y[i]!));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.cores.flush(ctx, '#fff6d0');
  }
}
