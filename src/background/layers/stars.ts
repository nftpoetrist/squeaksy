import type { Frame, Scene } from '../scene';
import { RectBatch } from '../util/pixel';
import { rand, type Rng } from '../util/rng';

interface Star {
  x: number;
  y: number;
  b: number;
  ph: number;
  sp: number;
  big: boolean;
}

/** Göz kırpan yıldızlar. */
export class StarsLayer {
  private stars: Star[] = [];
  private dim = new RectBatch();
  private mid = new RectBatch();
  private bright = new RectBatch();

  build(scene: Scene, rng: Rng, density: number): void {
    this.stars = [];
    const n = Math.round(((scene.W * scene.H) / 1000) * density);
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: Math.floor(rng() * scene.W),
        y: Math.floor(Math.pow(rng(), 1.35) * scene.horizon * 0.82),
        b: rng(),
        ph: rng() * 10,
        sp: rand(rng, 0.6, 2.6),
        big: rng() < 0.05,
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame): void {
    const vis = (1 - f.p.cloudCover * 0.85) * (1 - f.p.sun * 0.8);
    if (vis < 0.02) return;
    for (const s of this.stars) {
      const v = s.b * (0.55 + 0.45 * Math.sin(f.t * s.sp + s.ph));
      if (s.big) {
        this.mid.add(s.x - 1, s.y);
        this.mid.add(s.x + 1, s.y);
        this.mid.add(s.x, s.y - 1);
        this.mid.add(s.x, s.y + 1);
        this.bright.add(s.x, s.y);
      } else {
        (v > 0.62 ? this.bright : v > 0.3 ? this.mid : this.dim).add(s.x, s.y);
      }
    }
    this.dim.flush(ctx, '#6f68b8', vis);
    this.mid.flush(ctx, '#b9b2ff', vis);
    this.bright.flush(ctx, '#ffffff', vis);
  }
}
