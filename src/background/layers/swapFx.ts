import { ANCHOR_X, ANCHOR_Y, type HamsterFrame, type HamsterVariant } from '../../character/hamsterBase';
import type { Frame } from '../scene';
import { RectBatch } from '../util/pixel';
import { hamsterRunFrames, RUN_STRIDE } from './hamster';
import { HamsterAura } from './hamsterFx';
import type { PixsyKind } from '../../character/companion';

/** Konum sağlayıcı: hedef hareket edebilir (koşan hamster, sallanan kulübe), her karede sorulur */
type Point = () => [number, number] | null;

/** Koşu hızı (iç piksel/sn): çarktaki normal (48) ile hızlı (72) koşu arasında, doğal tırıs */
const RUN_SPEED = 70;
/** Hedefe bu kadar kala zıplayarak yerleşir / başlangıçta bu mesafede zemine iner */
const HOP_ZONE = 16;

interface Runner {
  frames: HamsterFrame[];
  aura: HamsterAura;
  x: number;
  y: number;
  startY: number;
  traveled: number;
  facing: 1 | -1;
  target: Point;
  ground: number;
  onArrive: () => void;
  /** Hedefi beklerken geçen süre (hedef hiç gelmezse animasyon bitirilir) */
  wait: number;
}

interface Flyer {
  img: HTMLCanvasElement;
  fromX: number;
  fromY: number;
  t: number;
  dur: number;
  target: Point;
  onArrive: () => void;
  trail: Array<{ x: number; y: number; age: number }>;
  wait: number;
}

/**
 * Görünüm değişimleri için kısa animasyonlar:
 *  - hamster değiş-tokuşu: yeni hamster kulübeden çarka, eskisi çarktan kulübeye hızla koşar
 *  - eşya tak/çıkar: Pixsy hamsterin sırtı ile sağ alt köşe arasında uçar
 */
export class LookTransitions {
  private runners: Runner[] = [];
  private flyers: Flyer[] = [];
  private puffs: Array<{ x: number; y: number; age: number }> = [];
  private trail = new RectBatch();
  private trailHi = new RectBatch();
  private puff = new RectBatch();

  get busy(): boolean {
    return this.runners.length > 0 || this.flyers.length > 0;
  }

  /** Süren tüm animasyonları anında bitirir (art arda hızlı değişimlerde) */
  finishAll(): void {
    const done = [...this.runners.map((r) => r.onArrive), ...this.flyers.map((f) => f.onArrive)];
    this.runners = [];
    this.flyers = [];
    for (const fn of done) fn();
  }

  /** from → target arası hızlı koşu; varınca onArrive */
  run(variant: HamsterVariant, buddy: PixsyKind | null, from: [number, number], ground: number, target: Point, onArrive: () => void): void {
    this.runners.push({
      frames: hamsterRunFrames(variant, buddy),
      aura: new HamsterAura(variant),
      x: from[0],
      y: from[1],
      startY: from[1],
      traveled: 0,
      facing: 1,
      target,
      ground,
      onArrive,
      wait: 0,
    });
  }

  /** from → target arası kavisli uçuş (Pixsy) */
  fly(img: HTMLCanvasElement, from: [number, number], target: Point, onArrive: () => void): void {
    this.flyers.push({ img, fromX: from[0], fromY: from[1], t: 0, dur: 0.75, target, onArrive, trail: [], wait: 0 });
  }

  update(dt: number): void {
    for (const r of [...this.runners]) {
      const tgt = r.target();
      if (!tgt) {
        // Hedef henüz belli değil (liste güncellenmedi): bekle; hiç gelmezse bitir
        if ((r.wait += dt) > 1) {
          this.runners.splice(this.runners.indexOf(r), 1);
          r.onArrive();
        }
        continue;
      }
      const [tx, ty] = tgt;
      const dx = tx - r.x;
      const step = RUN_SPEED * dt;
      r.facing = dx < 0 ? -1 : 1;
      if (Math.abs(dx) <= step) {
        this.runners.splice(this.runners.indexOf(r), 1);
        this.puffAt(tx, ty);
        r.onArrive();
        continue;
      }
      r.x += Math.sign(dx) * step;
      r.traveled += step;
      // Başta zemine iner, sonda hedefin yüksekliğine zıplar (ör. çarkın içi)
      const left = Math.abs(tx - r.x);
      if (left < HOP_ZONE) {
        const k = 1 - left / HOP_ZONE;
        r.y = r.ground + (ty - r.ground) * k - Math.sin(k * Math.PI) * 7;
      } else if (r.traveled < HOP_ZONE) {
        const k = r.traveled / HOP_ZONE;
        r.y = r.startY + (r.ground - r.startY) * k - Math.sin(k * Math.PI) * 5;
      } else {
        r.y = r.ground;
      }
      r.aura.update(dt, r.x, r.y - 10, 1);
    }

    for (const f of [...this.flyers]) {
      const tgt = f.target();
      if (!tgt) {
        if ((f.wait += dt) > 1) {
          this.flyers.splice(this.flyers.indexOf(f), 1);
          f.onArrive();
        }
        continue;
      }
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const [x, y] = this.flyPos(f, tgt, k);
      f.trail.push({ x, y, age: 0 });
      if (k >= 1) {
        this.flyers.splice(this.flyers.indexOf(f), 1);
        f.onArrive();
      }
    }
    for (const f of this.flyers) {
      for (const p of f.trail) p.age += dt;
      f.trail = f.trail.filter((p) => p.age < 0.35);
    }
    for (const p of this.puffs) p.age += dt;
    this.puffs = this.puffs.filter((p) => p.age < 0.4);
  }

  private flyPos(f: Flyer, [tx, ty]: [number, number], k: number): [number, number] {
    // Yukarı doğru kavis: yolun tepesi iki uçtan da yüksekte
    const e = k * k * (3 - 2 * k);
    const cx = (f.fromX + tx) / 2;
    const cy = Math.min(f.fromY, ty) - 28;
    const a = 1 - e;
    return [a * a * f.fromX + 2 * a * e * cx + e * e * tx, a * a * f.fromY + 2 * a * e * cy + e * e * ty];
  }

  private puffAt(x: number, y: number): void {
    for (let i = 0; i < 5; i++) this.puffs.push({ x: x + (Math.random() - 0.5) * 20, y: y - Math.random() * 10, age: Math.random() * 0.1 });
  }

  draw(ctx: CanvasRenderingContext2D, fr: Frame): void {
    for (const r of this.runners) {
      const f = r.frames[Math.floor(r.traveled / RUN_STRIDE) % r.frames.length]!;
      const ox = Math.round(r.x - ANCHOR_X);
      const oy = Math.round(r.y - ANCHOR_Y);
      const flip = r.facing < 0;
      r.aura.drawBehind(ctx, f.img, ox, oy, flip, fr.t, 1);
      if (flip) {
        ctx.save();
        ctx.translate(ox + 2 * ANCHOR_X + 1, oy);
        ctx.scale(-1, 1);
        ctx.drawImage(f.img, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(f.img, ox, oy);
      }
      r.aura.drawFront(ctx);
    }

    for (const f of this.flyers) {
      for (const p of f.trail) {
        const big = p.age < 0.12;
        (big ? this.trailHi : this.trail).add(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      const tgt = f.target();
      if (!tgt) continue;
      const k = Math.min(1, f.t / f.dur);
      const [x, y] = this.flyPos(f, tgt, k);
      // Uçarken hafif kanat çırpar gibi sallanır
      const wob = Math.round(Math.sin(f.t * 30));
      ctx.drawImage(f.img, Math.round(x - f.img.width / 2), Math.round(y - f.img.height / 2) + wob);
    }
    this.trail.flush(ctx, '#ffc93c', 0.8);
    this.trailHi.flush(ctx, '#fff6c8');

    for (const p of this.puffs) {
      const r = 1 + Math.round(p.age * 6);
      this.puff.add(Math.round(p.x) - r, Math.round(p.y) - 1, r * 2, 2);
    }
    this.puff.flush(ctx, '#ffffff', 0.55);
  }
}
