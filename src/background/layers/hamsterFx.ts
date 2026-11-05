import { ANCHOR_X, type HamsterVariant } from '../../character/hamsterBase';
import { hex } from '../util/color';
import { drawCentered, glowSprite, RectBatch } from '../util/pixel';

/** Sprite'ın her sütunundaki en üst dolu piksel (alevler buradan yükselir) */
const topCache = new WeakMap<HTMLCanvasElement, Int16Array>();
function silhouetteTop(img: HTMLCanvasElement): Int16Array {
  let t = topCache.get(img);
  if (t) return t;
  const { width: w, height: h } = img;
  const d = img.getContext('2d')!.getImageData(0, 0, w, h).data;
  t = new Int16Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (d[(y * w + x) * 4 + 3]! > 0) {
        t[x] = y;
        break;
      }
    }
  }
  topCache.set(img, t);
  return t;
}

const FLAME = ['#fff3a0', '#ffd23a', '#ff8a2a', '#e0302a', '#7a0a18'];
/** Alevler yüzü örtmesin: sadece sırt + kafa üstü (sprite sütunu) */
const FLAME_MAX_X = 24;
/** Bu sütundan itibaren kafa/taç */
const CROWN_X = 13;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  kind: number;
}

/**
 * Hamster türüne özel efekt:
 *  inferno: sırttan yükselen piksel alev dilleri + uçuşan korlar + kızıl hale
 *  sky    : etrafında parıldayan pastel yıldızlar + yumuşak gök halesi
 *  seraph : arkasında yavaşça dönen ışık hüzmeleri + süt beyazı/altın hale + yukarı süzülen ışık zerreleri
 * Hem oyunda (her kare) hem kart görselinde (tek kare) kullanılır.
 */
/**
 * Parçacıklar sahnede değil, sahibine göre yaşar: sahip (hamster / Pixsy) bu kare ne kadar
 * yer değiştirdiyse hepsi o kadar kaydırılır. Aksi halde yürürken / koşarken yıldızlar geride
 * kalıp yana kayıyormuş gibi görünür.
 */
function follow(parts: Array<{ x: number; y: number }>, last: { x: number; y: number }, cx: number, cy: number): void {
  const dx = cx - last.x;
  const dy = cy - last.y;
  if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
    for (const p of parts) {
      p.x += dx;
      p.y += dy;
    }
  }
  last.x = cx;
  last.y = cy;
}

export class HamsterAura {
  private parts: Particle[] = [];
  private spawn = 0;
  private flame = FLAME.map(() => new RectBatch());
  private dots = [new RectBatch(), new RectBatch(), new RectBatch()];
  private glow: HTMLCanvasElement | null = null;
  private rays = new RectBatch();
  private halo = new RectBatch();
  private haloHi = new RectBatch();
  private haloSh = new RectBatch();
  private raysHi = new RectBatch();
  /** Son kare merkez: parçacıklar hamsterle birlikte taşınır */
  private last = { x: NaN, y: NaN };

  constructor(readonly variant: HamsterVariant) {
    if (variant === 'inferno') this.glow = glowSprite(22, hex('#ff3a1a'), 0.5, 5, 1.3);
    else if (variant === 'sky') this.glow = glowSprite(20, hex('#9fd8ff'), 0.35, 5, 1.4);
    else if (variant === 'seraph') this.glow = glowSprite(22, hex('#fff2c4'), 0.95, 5, 1.7);
  }

  get active(): boolean {
    return this.variant !== 'starter';
  }

  /** cx, cy: gövde merkezi (iç piksel); power 0..1 (koşarken 1, uyurken düşük) */
  update(dt: number, cx: number, cy: number, power: number): void {
    if (!this.active) return;
    follow(this.parts, this.last, cx, cy);
    this.spawn -= dt;
    const rate = this.variant === 'inferno' ? 0.05 + (1 - power) * 0.12 : this.variant === 'seraph' ? 0.1 + (1 - power) * 0.16 : 0.18 + (1 - power) * 0.25;
    while (this.spawn <= 0) {
      this.spawn += rate;
      if (this.variant === 'inferno') {
        this.parts.push({ x: cx + (Math.random() - 0.6) * 22, y: cy - 4 - Math.random() * 6, vx: (Math.random() - 0.5) * 6, vy: -(10 + Math.random() * 14) * (0.5 + power), age: 0, life: 0.5 + Math.random() * 0.6, kind: 0 });
      } else if (this.variant === 'seraph') {
        // Yukarı süzülen ışık zerreleri (beyaz / altın / inci), arada parlayan yıldız
        const a = Math.random() * Math.PI * 2;
        const r = 8 + Math.random() * 13;
        this.parts.push({ x: cx + Math.cos(a) * r * 1.3, y: cy + Math.sin(a) * r * 0.7, vx: (Math.random() - 0.5) * 2, vy: -(5 + Math.random() * 7), age: 0, life: 1 + Math.random() * 0.9, kind: Math.floor(Math.random() * 3) });
      } else {
        const a = Math.random() * Math.PI * 2;
        const r = 10 + Math.random() * 10;
        this.parts.push({ x: cx + Math.cos(a) * r * 1.3, y: cy - 2 + Math.sin(a) * r * 0.8, vx: 0, vy: -2, age: 0, life: 0.7 + Math.random() * 0.7, kind: Math.floor(Math.random() * 3) });
      }
    }
    for (const p of this.parts) {
      p.age += dt;
      p.x += (p.vx + (this.variant === 'inferno' ? Math.sin(p.age * 12 + p.y) * 4 : 0)) * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    if (this.parts.length > 80) this.parts.splice(0, this.parts.length - 80);
  }

  /** Sprite'ın arkasına: hale + alev dilleri */
  drawBehind(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, ox: number, oy: number, flip: boolean, t: number, power: number): void {
    if (!this.active) return;
    if (this.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (this.variant === 'inferno' ? 0.55 : this.variant === 'seraph' ? 0.85 : 0.4) * (0.75 + 0.25 * Math.sin(t * 3)) * (0.6 + 0.4 * power);
      drawCentered(ctx, this.glow, ox + ANCHOR_X, oy + img.height * 0.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (this.variant === 'seraph') {
      // Işık hüzmeleri: merkezden dışa 8 ince ışın, yavaşça döner ve nefes alır
      const cx = ox + ANCHOR_X;
      const cy = oy + img.height * 0.5;
      const rot = t * 0.35;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        const a = rot + (i * Math.PI) / 4;
        const len = (i % 2 ? 15 : 21) * (0.85 + 0.15 * Math.sin(t * 1.6 + i));
        for (let r = 9; r < len; r++) {
          const fade = 1 - (r - 9) / (len - 9);
          const px = Math.round(cx + Math.cos(a) * r * 1.25);
          const py = Math.round(cy + Math.sin(a) * r * 0.85);
          this.rays.add(px, py, 1, 1);
          if (fade > 0.6) this.raysHi.add(px, py, 1, 1);
        }
      }
      const pulse = (0.6 + 0.4 * power) * (0.8 + 0.2 * Math.sin(t * 2));
      this.rays.flush(ctx, '#fff1c8', 0.24 * pulse);
      this.raysHi.flush(ctx, '#ffffff', 0.34 * pulse);
      ctx.globalCompositeOperation = 'source-over';
      // Altın hale: üst kafanın tepesinin üstünde süzülür (sprite dışına da taşabilir)
      const top = silhouetteTop(img);
      let hy = 99;
      let hx = 17;
      for (let x = 14; x <= 20 && x < top.length; x++) if (top[x]! >= 0 && top[x]! < hy) [hy, hx] = [top[x]!, x];
      const bob = Math.sin(t * 2.2) > 0.3 ? -1 : 0;
      const y0 = oy + hy - 4 + bob;
      const hl = (flip ? ox + 2 * ANCHOR_X - hx : ox + hx) - 3;
      // Halka: 7 piksel genişlik, 3 satır (üst parlak, alt gölge)
      this.halo.add(hl + 1, y0, 5, 1);
      this.halo.add(hl, y0 + 1, 1, 1);
      this.halo.add(hl + 6, y0 + 1, 1, 1);
      this.haloSh.add(hl + 1, y0 + 2, 5, 1);
      this.haloHi.add(hl + 2, y0, 2, 1);
      this.haloSh.flush(ctx, '#c99a2a');
      this.halo.flush(ctx, '#ffd23a');
      this.haloHi.flush(ctx, '#fff6c8');
      return;
    }
    if (this.variant !== 'inferno') return;
    const top = silhouetteTop(img);
    const amp = 0.55 + 0.45 * power;
    for (let x = 0; x <= FLAME_MAX_X && x < top.length; x++) {
      const ty = top[x]!;
      if (ty < 0) continue;
      // İki dalganın toplamı: titreşen, dalgalanan alev dilleri (sırtta daha uzun)
      const back = 1 - x / FLAME_MAX_X;
      const n = 0.5 + 0.5 * Math.sin(t * 9 + x * 1.7) * Math.sin(t * 5.3 - x * 0.9 + 1);
      // Kafa üstünde (taç bölgesi) alçak alev: taç okunur kalsın
      const head = x >= CROWN_X ? 0.35 : 1;
      const h = Math.round(amp * head * (1.5 + back * 3 + n * 4));
      const sx = flip ? ox + 2 * ANCHOR_X - x : ox + x;
      for (let i = 0; i < h; i++) {
        const k = i / Math.max(1, h);
        const ci = k < 0.2 ? 0 : k < 0.45 ? 1 : k < 0.7 ? 2 : k < 0.92 ? 3 : 4;
        this.flame[ci]!.add(sx, oy + ty - 1 - i, 1, 1);
      }
    }
    this.flame.forEach((b, i) => b.flush(ctx, FLAME[i]!, i === 4 ? 0.7 : 1));
  }

  /** Sprite'ın önüne: korlar / parıltılar */
  drawFront(ctx: CanvasRenderingContext2D): void {
    if (!this.active || this.parts.length === 0) return;
    for (const p of this.parts) {
      const k = p.age / p.life;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (this.variant === 'inferno') {
        this.dots[k < 0.35 ? 0 : k < 0.7 ? 1 : 2]!.add(x, y, 1, 1);
      } else {
        // Parlayan yıldız: ortada büyür, sonra söner
        const b = this.dots[p.kind]!;
        const big = k > 0.25 && k < 0.7;
        b.add(x, y, 1, 1);
        if (big) {
          b.add(x - 1, y, 1, 1);
          b.add(x + 1, y, 1, 1);
          b.add(x, y - 1, 1, 1);
          b.add(x, y + 1, 1, 1);
        }
      }
    }
    if (this.variant === 'inferno') {
      this.dots[0]!.flush(ctx, '#ffe46a');
      this.dots[1]!.flush(ctx, '#ff8a2a');
      this.dots[2]!.flush(ctx, '#c81e2a', 0.8);
    } else if (this.variant === 'seraph') {
      this.dots[0]!.flush(ctx, '#ffffff', 0.95);
      this.dots[1]!.flush(ctx, '#ffe08a', 0.9);
      this.dots[2]!.flush(ctx, '#e9e0ff', 0.9);
    } else {
      this.dots[0]!.flush(ctx, '#ffffff', 0.95);
      this.dots[1]!.flush(ctx, '#9fe9ff', 0.9);
      this.dots[2]!.flush(ctx, '#ffb3dc', 0.9);
    }
  }

  /** Kart görseli için tek kare: sprite + efekt, kenarlarda boşlukla */
  static still(variant: HamsterVariant, img: HTMLCanvasElement, padX = 5, padTop = 8): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.width + padX * 2;
    c.height = img.height + padTop;
    const ctx = c.getContext('2d')!;
    const fx = new HamsterAura(variant);
    // Efekti birkaç saniye "ısıt": parçacıklar sahneye yayılsın
    const cx = padX + ANCHOR_X;
    const cy = padTop + img.height * 0.55;
    for (let i = 0; i < 90; i++) fx.update(1 / 30, cx, cy, 1);
    fx.drawBehind(ctx, img, padX, padTop, false, 1.3, 1);
    ctx.drawImage(img, padX, padTop);
    fx.drawFront(ctx);
    return c;
  }
}

/** Görselin alt kümesi için sütun tepeleri (Pixsy'nin sprite içindeki sütunları) */
export function columnTops(img: HTMLCanvasElement, x0: number, x1: number): Array<[number, number]> {
  const top = silhouetteTop(img);
  const out: Array<[number, number]> = [];
  for (let x = Math.max(0, x0); x <= Math.min(top.length - 1, x1); x++) if (top[x]! >= 0) out.push([x, top[x]!]);
  return out;
}

interface BuddySpark {
  x: number;
  y: number;
  age: number;
  life: number;
  hue: number;
}

/**
 * Pixsy efektleri:
 *  eth (Rare)      : hafif mor ışık + çevresinde parlayıp sönen 4 köşeli yıldızlar
 *  btc (Legendary) : tepesinden yükselen titrek piksel alevler + korlar + sıcak ışık
 * Hamsterin sırtında, sağ alt köşedeki minderde ve kart görselinde kullanılır.
 */
export class BuddyFx {
  private parts: BuddySpark[] = [];
  private spawn = 0;
  private flame = FLAME.map(() => new RectBatch());
  private dots = [new RectBatch(), new RectBatch(), new RectBatch()];
  private glow: HTMLCanvasElement | null;

  /** Son kare merkez: parçacıklar Pixsy ile birlikte taşınır */
  private last = { x: NaN, y: NaN };

  /** Alev boyu çarpanı: kartta 1, küçük (sırttaki / köşedeki) Pixsy'de daha alçak */
  constructor(
    readonly kind: 'pixsy' | 'eth' | 'btc',
    readonly amp = 0.55,
  ) {
    this.glow =
      kind === 'btc' ? glowSprite(11, hex('#ff8a1a'), 0.6, 4, 1.4) : kind === 'eth' ? glowSprite(10, hex('#8a9fff'), 0.45, 4, 1.4) : null;
  }

  get active(): boolean {
    return this.kind !== 'pixsy';
  }

  /** cx, cy: Pixsy'nin merkezi; w: genişliği (iç piksel) */
  update(dt: number, cx: number, cy: number, w: number): void {
    if (!this.active) return;
    follow(this.parts, this.last, cx, cy);
    this.spawn -= dt;
    while (this.spawn <= 0) {
      if (this.kind === 'eth') {
        // Yıldızlar: Pixsy'nin çevresinde, rastgele yerlerde doğup söner
        const a = Math.random() * Math.PI * 2;
        const r = w * 0.5 + 2 + Math.random() * 5;
        this.parts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.7, age: 0, life: 0.8 + Math.random() * 0.6, hue: Math.floor(Math.random() * 3) });
        this.spawn += 0.22;
      } else {
        // Korlar: tepeden yükselir
        this.parts.push({ x: cx + (Math.random() - 0.5) * w, y: cy - 4, age: 0, life: 0.5 + Math.random() * 0.4, hue: 0 });
        this.spawn += 0.07;
      }
    }
    for (const p of this.parts) {
      p.age += dt;
      if (this.kind === 'btc') {
        p.y -= dt * 18;
        p.x += Math.sin(p.age * 14 + p.y) * dt * 6;
      }
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    if (this.parts.length > 40) this.parts.splice(0, this.parts.length - 40);
  }

  /** Arkaya: ışık + (BTC) alev dilleri. tops: ekrandaki sütun tepeleri */
  drawBehind(ctx: CanvasRenderingContext2D, cx: number, cy: number, tops: Array<[number, number]>, t: number): void {
    if (!this.active) return;
    if (this.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (this.kind === 'btc' ? 0.6 : 0.4) + 0.2 * Math.sin(t * 3);
      drawCentered(ctx, this.glow, cx, cy);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (this.kind !== 'btc') return;
    tops.forEach(([x, y], i) => {
      const n = 0.5 + 0.5 * Math.sin(t * 10 + x * 1.9) * Math.sin(t * 6.1 - x * 0.8 + 1);
      const mid = 1 - Math.abs(i / Math.max(1, tops.length - 1) - 0.5) * 1.2; // ortada daha uzun
      const h = Math.max(1, Math.round(this.amp * (1 + mid * 3 + n * 3)));
      for (let k = 0; k < h; k++) {
        const f = k / Math.max(1, h);
        const ci = f < 0.2 ? 0 : f < 0.45 ? 1 : f < 0.7 ? 2 : f < 0.92 ? 3 : 4;
        this.flame[ci]!.add(x, y - 1 - k, 1, 1);
      }
    });
    this.flame.forEach((b, i) => b.flush(ctx, FLAME[i]!, i === 4 ? 0.7 : 1));
  }

  /** Öne: yıldızlar / korlar */
  drawFront(ctx: CanvasRenderingContext2D): void {
    if (!this.active || this.parts.length === 0) return;
    for (const p of this.parts) {
      const k = p.age / p.life;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (this.kind === 'eth') {
        // 4 köşeli yıldız: ortada büyür, sonra söner
        const b = this.dots[p.hue]!;
        b.add(x, y, 1, 1);
        if (k > 0.2 && k < 0.75) {
          b.add(x - 1, y, 1, 1);
          b.add(x + 1, y, 1, 1);
          b.add(x, y - 1, 1, 1);
          b.add(x, y + 1, 1, 1);
        }
        if (k > 0.35 && k < 0.6) {
          b.add(x - 2, y, 1, 1);
          b.add(x + 2, y, 1, 1);
          b.add(x, y - 2, 1, 1);
          b.add(x, y + 2, 1, 1);
        }
      } else {
        this.dots[k < 0.35 ? 0 : k < 0.7 ? 1 : 2]!.add(x, y, 1, 1);
      }
    }
    if (this.kind === 'eth') {
      this.dots[0]!.flush(ctx, '#ffffff', 0.95);
      this.dots[1]!.flush(ctx, '#d4dcff', 0.9);
      this.dots[2]!.flush(ctx, '#b9a8ff', 0.85);
    } else {
      this.dots[0]!.flush(ctx, '#ffe46a');
      this.dots[1]!.flush(ctx, '#ff8a2a');
      this.dots[2]!.flush(ctx, '#e0282e', 0.85);
    }
  }

  /** Kart görseli: Pixsy + efekt tek karede (üstte alevler/yıldızlar için boşluk) */
  static still(kind: 'pixsy' | 'eth' | 'btc', img: HTMLCanvasElement, padX = 4, padTop = 6): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.width + padX * 2;
    c.height = img.height + padTop + 2;
    const ctx = c.getContext('2d')!;
    const fx = new BuddyFx(kind, 1);
    const cx = padX + img.width / 2;
    const cy = padTop + img.height / 2;
    for (let i = 0; i < 60; i++) fx.update(1 / 30, cx, cy, img.width);
    const tops = columnTops(img, 0, img.width - 1).map(([x, y]) => [padX + x, padTop + y] as [number, number]);
    fx.drawBehind(ctx, cx, cy, tops, 1.1);
    ctx.drawImage(img, padX, padTop);
    fx.drawFront(ctx);
    return c;
  }
}
