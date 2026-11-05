import type { BackgroundConfig } from '../config';
import type { EventBus } from '../events';
import type { Frame, Scene } from '../scene';
import type { BackgroundEvents, LightningKind, StrikeTarget } from '../types';
import { hex } from '../util/color';
import { clamp } from '../util/math';
import { drawCentered, glowSprite, plotLine, RectBatch } from '../util/pixel';
import { frand } from '../util/rng';

/** Yıldırımın vurabileceği hedefler (blok bulutları). */
export interface StrikeTargets {
  pick(preferCluster?: number): (StrikeTarget & { x: number; y: number }) | null;
  /** İsabet anı: hedef parlar, isteğe bağlı coin dökülür */
  hit(target: StrikeTarget & { x: number; y: number }, power: number, coins: number): void;
}

export interface StrikeOptions {
  cluster?: number;
  /** Görsel token dökülmesi (0 = yok) */
  coins?: number;
}

interface BoltPath {
  pts: number[];
  depth: number;
}

interface Bolt {
  kind: LightningKind;
  paths: BoltPath[];
  keys: number[];
  age: number;
  life: number;
  ox: number;
  oy: number;
  ix: number;
  iy: number;
  purple: boolean;
  I: number;
}

interface Sheet {
  x: number;
  y: number;
  keys: number[];
  age: number;
  life: number;
  I: number;
  a: number;
}

/** Titreşen parlama anahtar kareleri: [zaman, yoğunluk, zaman, yoğunluk, ...] */
function flickerKeys(big: boolean): number[] {
  const k = [0, 1];
  let t = 0.04 + Math.random() * 0.03;
  const extra = 1 + Math.floor(Math.random() * (big ? 3 : 2.4));
  for (let i = 0; i < extra; i++) {
    k.push(t, 0.12 + Math.random() * 0.2);
    t += 0.025 + Math.random() * 0.03;
    k.push(t, 0.65 + Math.random() * 0.35);
    t += 0.03 + Math.random() * 0.04;
  }
  k.push(t + (big ? 0.35 : 0.22) + Math.random() * 0.15, 0);
  return k;
}

function sampleKeys(k: number[], t: number): number {
  if (t <= 0) return k[1]!;
  for (let i = 2; i < k.length; i += 2) {
    if (t <= k[i]!) {
      const t0 = k[i - 2]!;
      const v0 = k[i - 1]!;
      return v0 + (k[i + 1]! - v0) * ((t - t0) / (k[i]! - t0 || 1));
    }
  }
  return 0;
}

/** Hedefe doğru çekilen rastgele yürüyüş; son nokta tam hedefe oturur. */
function walk(x0: number, y0: number, x1: number, y1: number, step: number): number[] {
  const pts = [Math.round(x0), Math.round(y0)];
  let x = x0;
  let y = y0;
  while (y1 - y > step * 0.8) {
    const st = step * (0.6 + Math.random() * 1.0);
    const ny = Math.min(y1, y + st);
    x += (x1 - x) * Math.min(1, st / Math.max(y1 - y, st)) + (Math.random() - 0.5) * st * 1.7;
    y = ny;
    pts.push(Math.round(x), Math.round(y));
  }
  pts.push(Math.round(x1), Math.round(y1));
  return pts;
}

/** Ana ışından ayrılan, yana ve aşağı kıvrılan dal. */
function branch(x: number, y: number, dir: number, steps: number, step: number, limitY: number): number[] {
  const pts = [x, y];
  for (let i = 0; i < steps && y < limitY; i++) {
    x += dir * step * (0.4 + Math.random() * 0.9) + (Math.random() - 0.5) * step * 0.6;
    y += step * (0.3 + Math.random() * 0.8);
    pts.push(Math.round(x), Math.round(Math.min(y, limitY)));
  }
  return pts;
}

const MAX_SPARKS = 600;

export class LightningSystem {
  flash = 0;
  flashPurple = false;
  shakeX = 0;
  shakeY = 0;

  private bolts: Bolt[] = [];
  private sheets: Sheet[] = [];
  private nearCooldown = 1.8;
  private farCooldown = 0.6;
  private nextId = 1;
  private shakeT = 0;
  private shakeAmp = 0;
  private scene: Scene | null = null;
  private targets: StrikeTargets | null = null;

  private spX = new Float32Array(MAX_SPARKS);
  private spY = new Float32Array(MAX_SPARKS);
  private spVX = new Float32Array(MAX_SPARKS);
  private spVY = new Float32Array(MAX_SPARKS);
  private spLife = new Float32Array(MAX_SPARKS);
  private spMax = new Float32Array(MAX_SPARKS);
  private spNext = 0;

  private glowA = new RectBatch();
  private glowB = new RectBatch();
  private inner = new RectBatch();
  private core = new RectBatch();
  private coreB = new RectBatch();
  private coreC = new RectBatch();
  private sparkW = new RectBatch();
  private sparkC = new RectBatch();
  private sparkP = new RectBatch();

  private cloudGlowBlue: HTMLCanvasElement | null = null;
  private cloudGlowPurple: HTMLCanvasElement | null = null;
  private impactGlow: HTMLCanvasElement | null = null;
  private sheetGlow: HTMLCanvasElement | null = null;

  constructor(private readonly bus: EventBus<BackgroundEvents>) {}

  setTargets(t: StrikeTargets): void {
    this.targets = t;
  }

  build(scene: Scene): void {
    this.scene = scene;
    const u = scene.u;
    this.cloudGlowBlue = glowSprite(42 * u, hex('#6a8cff'), 0.7, 5, 1.3);
    this.cloudGlowPurple = glowSprite(42 * u, hex('#a070ff'), 0.7, 5, 1.3);
    this.impactGlow = glowSprite(14 * u, hex('#8fc8ff'), 0.9, 5, 1.4);
    this.sheetGlow = glowSprite(38 * u, hex('#7a8cff'), 0.55, 5, 1.2);
    this.bolts = [];
    this.sheets = [];
    this.spLife.fill(0);
  }

  /** Bir yıldırım düşürür ve olayı yayınlar. near/super/far her zaman bir bloğa çarpar. */
  strike(kind: LightningKind, cfg: BackgroundConfig['lightning'], q: number, reduced: boolean, manual = false, opts: StrikeOptions = {}): void {
    const s = this.scene;
    if (!s) return;
    const { W, H, u } = s;
    let ix: number;
    let iy: number;
    let target: (StrikeTarget & { x: number; y: number }) | null = null;

    if (kind === 'sheet') {
      const sh: Sheet = { x: frand(W * 0.08, W * 0.92), y: frand(H * 0.12, H * 0.38), keys: flickerKeys(false), age: 0, life: 0, I: 0, a: frand(0.5, 1) };
      sh.life = sh.keys[sh.keys.length - 2]!;
      this.sheets.push(sh);
      ix = sh.x;
      iy = sh.y;
    } else {
      target = this.targets?.pick(opts.cluster) ?? null;
      if (!target) {
        // Hedef yoksa (ör. küme yerleşemediyse) bulut içi şimşeğe dönüşür.
        this.strike('sheet', cfg, q, reduced, manual);
        return;
      }
      const big = kind === 'super';
      const far = kind === 'far';
      ix = target.x;
      iy = target.y;
      const x0 = ix + frand(-0.1, 0.1) * W;
      const y0 = frand(-4, H * 0.04);
      const step = (big ? 6 : far ? 3.5 : 5) * u;
      const trunk = walk(x0, y0, ix, iy, step);
      const paths: BoltPath[] = [{ pts: trunk, depth: 0 }];
      const chance = far ? 0.07 : cfg.branchChance * (big ? 1.7 : 1);
      const limit = iy - 3 * u;
      for (let i = 2; i < trunk.length - 4; i += 2) {
        if (Math.random() >= chance) continue;
        const dir = Math.random() < 0.5 ? -1 : 1;
        const b = branch(trunk[i]!, trunk[i + 1]!, dir, (far ? 3 : 4) + Math.floor(Math.random() * 8), (far ? 2.5 : 4) * u, limit);
        paths.push({ pts: b, depth: far ? 2 : 1 });
        if (!far && b.length > 8 && Math.random() < 0.4) {
          const j = 2 * Math.floor(b.length / 4);
          paths.push({ pts: branch(b[j]!, b[j + 1]!, -dir, 3 + Math.floor(Math.random() * 4), 3 * u, limit), depth: 2 });
        }
      }
      if (big) paths.push({ pts: walk(x0 + frand(-10, 10) * u, y0, ix + frand(-2, 2), iy, step), depth: 1 });
      this.pushBolt(kind, paths, x0, y0, ix, iy);

      const power = big ? 3 : far ? 0.25 : 1;
      this.targets!.hit(target, power, opts.coins ?? 0);
      if (!far) this.spawnSparks(ix, iy, Math.round(cfg.sparkCount * (big ? 2.2 : 1) * q), u);
      if (!far && cfg.shake && !reduced && (big || Math.random() < 0.3)) {
        this.shakeT = big ? 0.45 : 0.26;
        this.shakeAmp = cfg.shakePixels * (big ? 1.5 : 1);
      }
    }

    const power = kind === 'super' ? 3 : kind === 'near' ? 1 : kind === 'far' ? 0.25 : 0.1;
    this.bus.emit('lightning:strike', {
      id: this.nextId++,
      kind,
      x: Math.round(ix),
      y: Math.round(iy),
      nx: clamp(ix / W, 0, 1),
      ny: clamp(iy / H, 0, 1),
      power,
      target: target ? { cluster: target.cluster, tile: target.tile } : null,
      coins: opts.coins ?? 0,
      time: performance.now(),
      manual,
    });
  }

  private pushBolt(kind: LightningKind, paths: BoltPath[], ox: number, oy: number, ix: number, iy: number): void {
    const keys = flickerKeys(kind === 'super');
    this.bolts.push({
      kind,
      paths,
      keys,
      age: 0,
      life: keys[keys.length - 2]!,
      ox,
      oy,
      ix,
      iy,
      purple: kind === 'super' || Math.random() < 0.22,
      I: 1,
    });
  }

  private spawnSparks(x: number, y: number, n: number, u: number): void {
    for (let k = 0; k < n; k++) {
      const j = this.spNext;
      this.spNext = (j + 1) % MAX_SPARKS;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 3.4;
      const sp = (25 + Math.random() * 110) * u;
      this.spX[j] = x;
      this.spY[j] = y;
      this.spVX[j] = Math.cos(a) * sp;
      this.spVY[j] = Math.sin(a) * sp;
      const life = 0.3 + Math.random() * 0.65;
      this.spLife[j] = life;
      this.spMax[j] = life;
    }
  }

  update(dt: number, f: Frame, cfg: BackgroundConfig['lightning'], nearRate: number, farRate: number, reduced: boolean): void {
    const s = this.scene;
    if (!s) return;

    // Otomatik zamanlama (Poisson süreci)
    if (cfg.enabled) {
      this.nearCooldown -= dt;
      this.farCooldown -= dt;
      const near = (nearRate * cfg.rateMultiplier) / 60;
      if (this.nearCooldown <= 0 && near > 0 && Math.random() < near * dt) {
        this.strike(Math.random() < cfg.superChance ? 'super' : 'near', cfg, f.q, reduced);
        this.nearCooldown = cfg.minGapSeconds * (0.8 + Math.random() * 0.6);
      }
      const far = (farRate * cfg.rateMultiplier) / 60;
      if (this.farCooldown <= 0 && far > 0 && Math.random() < far * dt) {
        this.strike(Math.random() < 0.35 ? 'far' : 'sheet', cfg, f.q, reduced);
        this.farCooldown = 0.7 + Math.random() * 1.2;
      }
    }

    let flash = 0;
    let purple = false;
    const strength = cfg.flashStrength * (reduced ? 0.4 : 1);
    for (const b of this.bolts) {
      b.age += dt;
      b.I = sampleKeys(b.keys, b.age);
      const w = b.kind === 'super' ? 1.35 : b.kind === 'near' ? 1 : 0.2;
      const fl = b.I * w * strength;
      if (fl > flash) {
        flash = fl;
        purple = b.purple;
      }
    }
    this.bolts = this.bolts.filter((b) => b.age < b.life);
    for (const sh of this.sheets) {
      sh.age += dt;
      sh.I = sampleKeys(sh.keys, sh.age) * sh.a;
      flash = Math.max(flash, sh.I * 0.16 * strength);
    }
    this.sheets = this.sheets.filter((sh) => sh.age < sh.life);
    this.flash = Math.min(1, flash);
    this.flashPurple = purple;

    // Kıvılcım fiziği
    const g = 240 * s.u;
    for (let j = 0; j < MAX_SPARKS; j++) {
      if (this.spLife[j]! <= 0) continue;
      this.spLife[j]! -= dt;
      this.spVX[j]! += (Math.random() - 0.5) * 220 * s.u * dt; // elektrik çıtırtısı
      this.spVY[j]! += g * dt;
      this.spX[j]! += this.spVX[j]! * dt;
      this.spY[j]! += this.spVY[j]! * dt;
    }

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / 0.45);
      this.shakeX = Math.round((Math.random() * 2 - 1) * this.shakeAmp * k);
      this.shakeY = Math.round((Math.random() * 2 - 1) * this.shakeAmp * k);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  private rasterBolt(b: Bolt): void {
    const big = b.kind === 'super';
    const far = b.kind === 'far';
    for (const p of b.paths) {
      const pts = p.pts;
      for (let k = 0; k + 3 < pts.length; k += 2) {
        plotLine(pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!, (x, y) => {
          if (p.depth === 0) {
            if (big) {
              this.glowA.add(x - 2, y - 2, 5, 5);
              this.inner.add(x - 1, y, 3, 1);
            } else {
              this.glowA.add(x - 1, y - 1, 3, 3);
              if (!far) this.inner.add(x, y, 2, 1);
            }
            this.core.add(x, y);
          } else if (p.depth === 1) {
            this.glowB.add(x - 1, y - 1, 3, 3);
            this.coreB.add(x, y);
          } else {
            this.coreC.add(x, y);
          }
        });
      }
    }
  }

  private flushBolt(ctx: CanvasRenderingContext2D, b: Bolt): void {
    const I = b.kind === 'far' ? b.I * 0.65 : b.I;
    const glow = b.purple ? '#b47cff' : '#5ab0ff';
    ctx.globalCompositeOperation = 'lighter';
    this.glowA.flush(ctx, glow, (b.kind === 'far' ? 0.25 : 0.42) * I);
    this.glowB.flush(ctx, glow, 0.25 * I);
    ctx.globalCompositeOperation = 'source-over';
    this.inner.flush(ctx, '#bfe6ff', I);
    this.coreC.flush(ctx, '#9fcaff', 0.6 * I);
    this.coreB.flush(ctx, '#cfeaff', 0.85 * I);
    this.core.flush(ctx, '#ffffff', I);
  }

  /** Dağların arkasında, bulut içinde parlayan şimşekler. */
  drawSheets(ctx: CanvasRenderingContext2D): void {
    if (!this.sheetGlow) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const sh of this.sheets) {
      if (sh.I < 0.02) continue;
      ctx.globalAlpha = sh.I;
      drawCentered(ctx, this.sheetGlow, sh.x, sh.y);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** Bloklara inen yıldırımlar + isabet parlaması. */
  drawBolts(ctx: CanvasRenderingContext2D): void {
    for (const b of this.bolts) {
      if (b.I < 0.02) continue;
      this.rasterBolt(b);
      this.flushBolt(ctx, b);
      if (this.impactGlow && b.kind !== 'far') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, b.I);
        drawCentered(ctx, this.impactGlow, b.ix, b.iy);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** Bloklardan saçılan kıvılcımlar. */
  drawSparks(ctx: CanvasRenderingContext2D): void {
    for (let j = 0; j < MAX_SPARKS; j++) {
      const life = this.spLife[j]!;
      if (life <= 0) continue;
      const r = life / this.spMax[j]!;
      (r > 0.6 ? this.sparkW : r > 0.3 ? this.sparkC : this.sparkP).add(Math.round(this.spX[j]!), Math.round(this.spY[j]!));
    }
    this.sparkW.flush(ctx, '#ffffff');
    this.sparkC.flush(ctx, '#9fe0ff');
    this.sparkP.flush(ctx, '#b47cff', 0.9);
  }

  /** Ön bulutların üstüne: yıldırımın çıktığı bulutun içten aydınlanması. */
  drawCloudGlow(ctx: CanvasRenderingContext2D): void {
    if (!this.cloudGlowBlue || !this.cloudGlowPurple) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bolts) {
      if (b.kind === 'far' || b.I < 0.02) continue;
      ctx.globalAlpha = Math.min(1, b.I * 0.7);
      drawCentered(ctx, b.purple ? this.cloudGlowPurple : this.cloudGlowBlue, b.ox, Math.max(b.oy, 6));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
