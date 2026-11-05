import type { Frame, Scene } from '../scene';
import { hex } from '../util/color';
import { clamp, TAU } from '../util/math';
import { createCanvas, drawCentered, glowSprite, plotLine, RectBatch, type Canvas2D } from '../util/pixel';

/** Çark renkleri: varsayılan altın çark (oyun). About'taki Squeekchain çarkı kendi paletini verir. */
export const GOLD_WHEEL = {
  outline: '#5a3010',
  hi: '#ffe07a',
  lo: '#e0a040',
  mid: '#f0b040',
  shade: '#c8862a',
  lip: '#8a5020',
  back: '#7a4a1c',
  backDeep: '#4a2a10',
  rung: '#d89a3a',
  rungHi: '#ffd060',
  spoke: '#6a52b0',
  spokeHi: '#8f7ad8',
  steel: '#2c2560',
  steelHi: '#4b3a86',
  steelDeep: '#1a1640',
  plate: '#3a2f70',
  plateHi: '#5a4a9a',
  trim: '#f0b040',
  /** Jant ışığı + kıvılcım */
  glow: '#ffc85a',
  spark: '#ffae42',
};
export type WheelPalette = typeof GOLD_WHEEL;

/** Çarkın ekrandaki (CSS piksel) geometrisi: oyun katmanı hamsteri buna göre yerleştirir. */
export interface WheelGeometry {
  /** Göbek merkezi */
  x: number;
  y: number;
  /** Dış jant yarıçapı */
  radius: number;
  /** Koşu yüzeyinin (iç jant) yarıçapı */
  innerRadius: number;
  /** Çarkın durduğu zeminin üst çizgisi */
  groundY: number;
}

/**
 * Sol altta, zeminde duran piksel hamster çarkı.
 * Önden bakış + derinlik: arka jant, aradaki koşu basamakları, ön jant, stand ve platform.
 * Statik parçalar önbelleğe alınır; her karede sadece dönen parçalar çizilir.
 */
export class WheelLayer {
  constructor(private readonly C: WheelPalette = GOLD_WHEEL) {}

  private back: Canvas2D | null = null;
  private hub: Canvas2D | null = null;
  private front: Canvas2D | null = null;
  private aura: HTMLCanvasElement | null = null;
  private light: HTMLCanvasElement | null = null;
  private plateLight: HTMLCanvasElement | null = null;
  private origin = { x: 0, y: 0 };
  private rot = 0;
  /** rad/sn, yumuşatılmış */
  speed = 0;
  private R = 40;
  private t = 4;
  private depth = { x: 4, y: -3 };
  private rungs = new RectBatch();
  private rungsHi = new RectBatch();
  private spokes = new RectBatch();
  private spokesHi = new RectBatch();
  private notches = new RectBatch();
  private plateNodes: number[] = [];
  private ox = 0;
  private oy = 0;
  private readonly segments = 20;
  private readonly rungCount = 36;

  build(scene: Scene): void {
    const { wheel, u } = scene;
    const R = wheel.R;
    this.R = R;
    this.t = Math.max(4, Math.round(R * 0.11));
    this.depth = { x: Math.max(4, Math.round(R * 0.2)), y: -Math.max(3, Math.round(R * 0.13)) };
    const plateW = Math.round(R * 1.9);
    const pad = Math.round(14 * u) + 4;
    const w = Math.max(R * 2 + this.depth.x, plateW) + pad * 2;
    const h = R * 2 + (wheel.groundY - (wheel.cy + R)) + pad * 2 + 6;
    // Tuvaldeki göbek konumu
    this.origin = { x: Math.round(w / 2 - this.depth.x / 2), y: pad + R - this.depth.y };
    this.back = createCanvas(w, h);
    this.front = createCanvas(w, h);
    this.paintBack(wheel.groundY - wheel.cy, plateW);
    this.paintFront();
    this.paintHub();
    this.aura = this.auraSprite(R, u);
    this.light = glowSprite(3 * u + 1, hex(this.C.glow), 0.9, 4, 1.2);
    this.plateLight = glowSprite(2.5 * u + 1, hex('#7ef9ff'), 0.8, 3, 1.2);
    this.plateNodes = [];
    const n = 5;
    for (let i = 0; i < n; i++) this.plateNodes.push(Math.round(-plateW / 2 + 4 + (i * (plateW - 8)) / (n - 1)));
  }

  private ring(b: RectBatch, cx: number, cy: number, r: number, filter?: (sin: number) => boolean): void {
    const steps = Math.ceil(TAU * r * 1.7);
    for (let s = 0; s < steps; s++) {
      const th = (s / steps) * TAU;
      const sin = Math.sin(th);
      if (filter && !filter(sin)) continue;
      b.add(Math.round(cx + Math.cos(th) * r), Math.round(cy + sin * r));
    }
  }

  private paintBack(groundDy: number, plateW: number): void {
    const g = this.back!;
    const ctx = g.ctx;
    const { x: cx, y: cy } = this.origin;
    const R = this.R;
    const t = this.t;
    const gy = cy + groundDy;

    // İç bölge: hafif koyu, hamster net seçilsin
    ctx.fillStyle = 'rgba(14,10,36,0.42)';
    const inner = new RectBatch();
    for (let y = -R + t; y <= R - t; y++) {
      const half = Math.floor(Math.sqrt(Math.max(0, (R - t) ** 2 - y * y)));
      inner.add(cx - half, cy + y, half * 2 + 1, 1);
    }
    inner.flush(ctx, 'rgba(14,10,36,0.42)');

    // Stand: göbekten zemine iki bacak (A çerçeve) + platform
    const legSpread = Math.round(R * 0.62);
    const legs = new RectBatch();
    const legsHi = new RectBatch();
    const hx = cx + this.depth.x;
    const hy = cy + this.depth.y;
    for (const dir of [-1, 1]) {
      plotLine(hx, hy, cx + dir * legSpread, gy - 2, (x, y) => {
        legs.add(x - 1, y, 3, 1);
        legsHi.add(dir < 0 ? x - 1 : x + 1, y, 1, 1);
      });
    }
    legs.flush(ctx, this.C.steel);
    legsHi.flush(ctx, this.C.steelHi);
    const px = cx - (plateW >> 1);
    ctx.fillStyle = this.C.steelDeep;
    ctx.fillRect(px - 1, gy - 3, plateW + 2, 6);
    ctx.fillStyle = this.C.plate;
    ctx.fillRect(px, gy - 3, plateW, 4);
    ctx.fillStyle = this.C.plateHi;
    ctx.fillRect(px, gy - 3, plateW, 1);
    ctx.fillStyle = this.C.trim;
    ctx.fillRect(px + 2, gy, plateW - 4, 1);

    // Arka jant (derinlik)
    const back = new RectBatch();
    const backDeep = new RectBatch();
    const bx = cx + this.depth.x;
    const by = cy + this.depth.y;
    this.ring(backDeep, bx, by, R);
    this.ring(back, bx, by, R - 1);
    this.ring(back, bx, by, R - 2);
    this.ring(backDeep, bx, by, R - 3);
    backDeep.flush(ctx, this.C.backDeep);
    back.flush(ctx, this.C.back);
  }

  private paintFront(): void {
    const g = this.front!;
    const ctx = g.ctx;
    const { x: cx, y: cy } = this.origin;
    const R = this.R;
    const t = this.t;
    const outline = new RectBatch();
    const hi = new RectBatch();
    const lo = new RectBatch();
    const mid = new RectBatch();
    const shade = new RectBatch();
    const lip = new RectBatch();
    this.ring(outline, cx, cy, R + 1);
    this.ring(hi, cx, cy, R, (s) => s < -0.1);
    this.ring(lo, cx, cy, R, (s) => s >= -0.1);
    for (let k = 1; k < t - 2; k++) this.ring(k === 1 ? hi : mid, cx, cy, R - k, k === 1 ? (s) => s < -0.3 : undefined);
    for (let k = 1; k < 2; k++) this.ring(mid, cx, cy, R - k, (s) => s >= -0.3);
    this.ring(shade, cx, cy, R - t + 2);
    this.ring(lip, cx, cy, R - t + 1);
    this.ring(outline, cx, cy, R - t);
    outline.flush(ctx, this.C.outline);
    lo.flush(ctx, this.C.lo);
    mid.flush(ctx, this.C.mid);
    hi.flush(ctx, this.C.hi);
    shade.flush(ctx, this.C.shade);
    lip.flush(ctx, this.C.lip);

  }

  /** Arka yüzdeki göbek (aks), parmaklıkların üstüne çizilir. */
  private paintHub(): void {
    const R = this.R;
    const hubR = Math.max(3, Math.round(R * 0.1));
    const size = hubR * 2 + 5;
    this.hub = createCanvas(size, size);
    const ctx = this.hub.ctx;
    const c = hubR + 2;
    const hub = new RectBatch();
    const hubHi = new RectBatch();
    const outline = new RectBatch();
    for (let y = -hubR; y <= hubR; y++) {
      const half = Math.floor(Math.sqrt(hubR * hubR - y * y));
      hub.add(c - half, c + y, half * 2 + 1, 1);
    }
    this.ring(hubHi, c, c, hubR, (s) => s < 0);
    this.ring(outline, c, c, hubR + 1);
    outline.flush(ctx, this.C.outline);
    hub.flush(ctx, this.C.shade);
    hubHi.flush(ctx, this.C.mid);
    ctx.fillStyle = this.C.lip;
    ctx.fillRect(c - 1, c - 1, 3, 3);
    ctx.fillStyle = this.C.hi;
    ctx.fillRect(c, c, 1, 1);
  }

  private auraSprite(R: number, u: number): HTMLCanvasElement {
    const pad = Math.round(9 * u) + 2;
    const size = (R + pad) * 2 + 1;
    const c = R + pad;
    const g = createCanvas(size, size);
    const img = g.ctx.createImageData(size, size);
    const d = img.data;
    const col = hex(this.C.spark);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dist = Math.abs(Math.hypot(x - c, y - c) - R) / pad;
        if (dist >= 1) continue;
        const a = (1 - dist) ** 2 * 0.5;
        const lv = Math.floor(a * 4 + ((x * 7 + y * 13) % 4) / 4);
        if (lv <= 0) continue;
        const o = (y * size + x) * 4;
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = Math.min(255, lv * 48);
      }
    }
    g.ctx.putImageData(img, 0, 0);
    return g.canvas;
  }

  /** target: hedef dönüş hızı (rad/sn). Hız yumuşakça değişir. */
  update(dt: number, target: number): void {
    this.speed += (target - this.speed) * (1 - Math.exp(-dt / 0.6));
    this.rot = (this.rot + this.speed * dt) % TAU;
  }

  /** 0..1 arası normalize hız (paketler, ışıklar için): bant hızı / tam koşu bant hızı */
  get intensity(): number {
    return clamp((Math.abs(this.speed) * this.innerRadius) / 48, 0, 1);
  }

  /** Bulut bağlantısının çıktığı nokta (çarkın tepesi), ekran iç pikseli */
  topAnchor(scene: Scene): [number, number] {
    return [scene.wheel.cx + this.ox, scene.wheel.cy - scene.wheel.R - 2 + this.oy];
  }

  geometry(scene: Scene, scale: number, margin: number): WheelGeometry {
    const k = (v: number) => (v - margin) * scale;
    return {
      x: k(scene.wheel.cx + this.ox),
      y: k(scene.wheel.cy + this.oy),
      radius: scene.wheel.R * scale,
      innerRadius: (scene.wheel.R - this.t) * scale,
      groundY: k(scene.wheel.groundY + this.oy),
    };
  }

  /** Koşu bandının yarıçapı (iç yüzey) */
  get innerRadius(): number {
    return this.R - this.t;
  }

  /** Platformun yarı genişliği */
  get plateHalf(): number {
    return Math.round(this.R * 1.9) >> 1;
  }

  /**
   * inside: çarkın içine (koşu basamaklarının önüne, ön jantın arkasına) çizilecek
   * içerik — hamster buraya çizilir ki ön jant onu doğal biçimde çerçevelesin.
   */
  draw(ctx: CanvasRenderingContext2D, f: Frame, scene: Scene, inside?: () => void): void {
    if (!this.back || !this.front || !this.aura || !this.light || !this.plateLight) return;
    // Çark zemine sabit: hiç kaymaz
    this.ox = 0;
    this.oy = 0;
    const cx = scene.wheel.cx + this.ox;
    const cy = scene.wheel.cy + this.oy;
    const dx = cx - this.origin.x;
    const dy = cy - this.origin.y;
    const R = this.R;
    const t = this.t;
    const energy = this.intensity;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 0.3 + energy * 0.45 + f.p.sun * 0.2 + f.flash * 0.5);
    drawCentered(ctx, this.aura, cx, cy);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.drawImage(this.back.canvas, dx, dy);

    // Koşu basamakları (ön ve arka jant arası) + parmaklıklar
    const bx = cx + this.depth.x;
    const by = cy + this.depth.y;
    // Arka yüz parmaklıkları (ön taraf açık: hamster buradan girer)
    for (let k = 0; k < 8; k++) {
      const a = this.rot + (k * TAU) / 8;
      const target = k % 2 === 0 ? this.spokesHi : this.spokes;
      plotLine(bx, by, bx + Math.cos(a) * (R - 3), by + Math.sin(a) * (R - 3), (x, y) => target.add(x, y));
    }
    this.spokes.flush(ctx, this.C.spoke);
    this.spokesHi.flush(ctx, this.C.spokeHi);
    if (this.hub) drawCentered(ctx, this.hub.canvas, bx, by);
    for (let k = 0; k < this.rungCount; k++) {
      const a = this.rot + (k * TAU) / this.rungCount;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const target = sin > 0.2 || cos < -0.6 ? this.rungsHi : this.rungs;
      plotLine(cx + cos * (R - t + 1), cy + sin * (R - t + 1), bx + cos * (R - 1), by + sin * (R - 1), (x, y) => target.add(x, y, 1, 1));
    }
    this.rungs.flush(ctx, this.C.rung);
    this.rungsHi.flush(ctx, this.C.rungHi);

    inside?.();
    ctx.drawImage(this.front.canvas, dx, dy);

    // Dönen blok segmentleri: jant üzerinde çentikler
    const segA = TAU / this.segments;
    for (let k = 0; k < this.segments; k++) {
      const a = this.rot + k * segA;
      plotLine(cx + Math.cos(a) * R, cy + Math.sin(a) * R, cx + Math.cos(a) * (R - t + 2), cy + Math.sin(a) * (R - t + 2), (x, y) => this.notches.add(x, y));
    }
    this.notches.flush(ctx, this.C.outline);

    // Segment ışıkları: çark hızlandıkça parlar
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < this.segments; k++) {
      const a = this.rot + (k + 0.5) * segA;
      const phase = ((((k / this.segments) * 2 - f.t * 0.2) % 1) + 1) % 1;
      const chase = phase < 0.3 ? 1 - phase / 0.3 : 0;
      const alpha = 0.1 + chase * (0.35 + energy * 0.65) + energy * 0.25 + f.flash * 0.3;
      if (alpha < 0.05) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      const r = R - (t >> 1);
      drawCentered(ctx, this.light, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    // Platform düğüm ışıkları
    const gy = scene.wheel.groundY + this.oy;
    for (let i = 0; i < this.plateNodes.length; i++) {
      ctx.globalAlpha = clamp(0.35 + 0.35 * Math.sin(f.t * 2 + i * 1.3) + energy * 0.3, 0, 1);
      drawCentered(ctx, this.plateLight, cx + this.plateNodes[i]!, gy - 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
