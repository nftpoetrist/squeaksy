import { ANCHOR_X, ANCHOR_Y, DEFAULT_POSE, drawHamsterPose, type HamsterVariant } from '../../character/hamsterBase';
import type { Frame, Scene } from '../scene';
import { hex } from '../util/color';
import { createCanvas, drawCentered, glowSprite, RectBatch } from '../util/pixel';
import { COMPANION_PALETTE, companionPixels, type PixsyKind } from '../../character/companion';
import { BuddyFx, columnTops, HamsterAura } from './hamsterFx';

/** Pixsy türünün küçük piksel görseli (köşe, uçuş animasyonu) */
const itemSprites = new Map<PixsyKind, HTMLCanvasElement>();
export function itemSprite(kind: PixsyKind): HTMLCanvasElement {
  let c = itemSprites.get(kind);
  if (!c) {
    const px = companionPixels('mini', kind);
    c = createCanvas(px[0]!.length, px.length).canvas;
    const ctx = c.getContext('2d')!;
    px.forEach((row, y) =>
      row.forEach((k, x) => {
        if (!k) return;
        ctx.fillStyle = COMPANION_PALETTE[k];
        ctx.fillRect(x, y, 1, 1);
      }),
    );
    itemSprites.set(kind, c);
  }
  return c;
}

/** Eşya köşesindeki (takılı olmayan) eşya */
interface StoredItem {
  id: string;
  img: HTMLCanvasElement;
  fx: BuddyFx;
  /** Taban orta noktası (iç piksel) */
  x: number;
  y: number;
  phase: number;
}

const HUT_W = 46;
/** Kulübe ve uyuyan hamsterlerin zemin çizgisinden ne kadar geride durduğu (iç piksel) */
const BACK = 5;
const HUT_H = 38;

/** Satın alınmamış hamster: koyu, mor tonlu gölge (hatlar hafifçe seçilir) */
function shade(img: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(14, 11, 34, 0.72)';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Kulübenin önünde uyuyan hamster */
interface Sleeper {
  id: string;
  variant: HamsterVariant;
  frames: HTMLCanvasElement[];
  /** Satın alınmamış: koyu, gölgeli siluet (efektsiz); fiyatı üstünde DOM etiketiyle yazar */
  locked: boolean;
  aura: HamsterAura;
  /** Ayak noktası (iç piksel) */
  x: number;
  y: number;
  phase: number;
}

export interface HutSpot {
  id: string;
  /** Uyuyan hamsterin kapladığı kutu (iç piksel) */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ahşap kulübe: kütük duvarlar, kiremitli çatı, yuvarlak kapı, ışıklı pencere, baca */
function paintHut(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(HUT_W, HUT_H);
  const px = (c: string, x: number, y: number, w = 1, h = 1) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  const O = '#2a160c';
  // Baca (çatının arkasında)
  px(O, 31, 3, 6, 10);
  px('#857f94', 32, 4, 4, 9);
  px('#6a6478', 32, 7, 4, 1);
  px('#6a6478', 34, 10, 2, 1);
  px('#a9a3b8', 32, 4, 4, 1);

  // Duvar: yatay kütükler
  const wx = 6;
  const ww = 34;
  const wy = 17;
  const wh = 17;
  px(O, wx - 1, wy - 1, ww + 2, wh + 2);
  for (let r = 0; r < wh; r++) {
    const log = Math.floor(r / 3);
    const inLog = r % 3;
    const c = inLog === 2 ? '#5e3418' : log % 2 === 0 ? (inLog === 0 ? '#b27238' : '#9a5e2c') : inLog === 0 ? '#a66a34' : '#8a5428';
    px(c, wx, wy + r, ww, 1);
  }
  // Kütük uçları (iki yanda yuvarlak kesitler)
  for (let r = 0; r < wh; r += 3) {
    for (const ex of [wx - 2, wx + ww - 1]) {
      px(O, ex, wy + r - 1 + 1, 3, 3);
      px('#d49a5a', ex + 1, wy + r + 1, 1, 1);
      px('#c88a4a', ex, wy + r + 1, 1, 1);
      px('#c88a4a', ex + 2, wy + r + 1, 1, 1);
    }
  }

  // Taş temel
  px(O, wx - 2, wy + wh, ww + 4, 4);
  for (let i = 0; i < ww + 2; i += 4) {
    px(i % 8 === 0 ? '#857f94' : '#77718a', wx - 1 + i, wy + wh + 1, 3, 2);
  }

  // Yuvarlak üstlü kapı
  const dx = 18;
  const dy = 22;
  px(O, dx - 1, dy + 1, 11, wh - 4);
  px(O, dx, dy - 1, 9, 2);
  px('#5a3018', dx, dy + 1, 9, wh - 6);
  px('#5a3018', dx + 1, dy, 7, 1);
  px('#3a1e10', dx + 1, dy + 2, 7, wh - 7);
  px('#3a1e10', dx + 2, dy + 1, 5, 1);
  px('#4a2814', dx + 4, dy + 2, 1, wh - 7); // kapı tahtası çizgisi
  px('#ffd84d', dx + 6, dy + 7, 1, 1); // tokmak

  // Pencere (sıcak ışık)
  const qx = 30;
  const qy = 21;
  px(O, qx - 1, qy - 1, 8, 7);
  px('#ffcf6a', qx, qy, 6, 5);
  px('#fff0b0', qx, qy, 3, 2);
  px('#5a3018', qx + 2, qy, 1, 5);
  px('#5a3018', qx, qy + 2, 6, 1);
  px('#6a3a1c', qx - 1, qy + 5, 8, 1); // pervaz

  // Çatı: üçgen, kiremit sıraları, saçak
  const ax = 23;
  const top = 1;
  const base = 18;
  for (let y = top; y <= base; y++) {
    const half = Math.round(((y - top) / (base - top)) * 22) + 1;
    const x0 = ax - half;
    const x1 = ax + half;
    px(O, x0 - 1, y, x1 - x0 + 3, 1);
    const row = Math.floor((y - top) / 3);
    const c = (y - top) % 3 === 2 ? '#4a2412' : row % 2 === 0 ? '#8a4a24' : '#7a4020';
    px(c, x0, y, x1 - x0 + 1, 1);
    // Sol eğimde ışık, sağ eğimde gölge
    px('#c27a3a', x0, y, 2, 1);
    px('#5a2c14', x1 - 1, y, 2, 1);
  }
  px(O, ax - 1, 0, 3, 1);
  px('#4a2412', 0, base, HUT_W, 1); // saçak
  px(O, 0, base + 1, HUT_W, 1);
  return canvas;
}

/**
 * Oyun penceresinin sağ altındaki küçük ahşap kulübe ve önünde uyuyan
 * hamsterler (koşan hamster hariç diğerleri). Satın alma/değiştirme arayüzü
 * DOM tarafındadır; bu katman sadece çizer ve tıklanabilir alanları verir.
 */
export class HutLayer {
  private hut: HTMLCanvasElement | null = null;
  private glow: HTMLCanvasElement | null = null;
  private hx = 0;
  private hy = 0;
  private visible = false;
  private sleepers: Sleeper[] = [];
  private wanted: Array<{ id: string; variant: HamsterVariant; owned?: boolean }> = [];
  private bed = new RectBatch();
  private bedHi = new RectBatch();
  private bedSh = new RectBatch();
  private bedEdge = new RectBatch();
  private smoke: Array<{ x: number; y: number; age: number }> = [];
  private smokeIn = 0;
  private smokeBatch = new RectBatch();
  private zzz = new RectBatch();
  private groundY = 0;
  private W = 0;
  private H = 0;
  private items: StoredItem[] = [];
  private wantedItems: Array<{ id: string; kind: PixsyKind }> = [];
  private itemGlow: HTMLCanvasElement | null = null;
  private itemShadow = new RectBatch();
  private cushion = new RectBatch();
  private cushionHi = new RectBatch();
  private cushionSh = new RectBatch();

  build(scene: Scene, minX: number): void {
    this.hut ??= paintHut();
    this.glow = glowSprite(10, hex('#ffb347'), 0.6, 4, 1.3);
    this.groundY = scene.wheel.groundY;
    this.W = scene.W;
    this.H = scene.H;
    this.itemGlow = glowSprite(9, hex('#ffc93c'), 0.45, 4, 1.4);
    this.hx = scene.W - HUT_W - 8;
    // Kulübe ve önündeki hamsterler biraz geride (yukarıda); ön zemin Pixsy'lere kalır
    this.hy = this.groundY - BACK - HUT_H + 2;
    // Dar ekranda kulübe + uyuyanlar sığmıyorsa gizlenir (çark alanına girmesin)
    this.minX = minX;
    this.fitCheck();
    this.layoutSleepers();
    this.layoutItems();
  }

  /** Takılı olmayan eşyalar: oyun panelinin en sağ alt köşesinde toplanır */
  setStoredItems(items: Array<{ id: string; kind: PixsyKind }>): void {
    this.wantedItems = items;
    this.layoutItems();
  }

  private layoutItems(): void {
    const old = new Map(this.items.map((it) => [it.id, it.fx]));
    const list = this.wantedItems.map((it) => ({ id: it.id, img: itemSprite(it.kind), fx: old.get(it.id)?.kind === it.kind ? old.get(it.id)! : new BuddyFx(it.kind) }));
    // Sağdan sola dizilir; zeminin ön şeridinde. Kısa panelde (yatay telefon) altındaki fiyat
    // etiketi de görünür kalsın diye yukarı alınır; masaüstünde (H ≥ ~200) konum değişmez.
    const y = Math.min(this.H - 18, this.groundY + 22);
    this.items = list.map((it, i) => ({ id: it.id, img: it.img!, fx: it.fx, x: this.W - 16 - i * 22, y, phase: i * 0.9 }));
  }

  /** Eşyaların kutuları (iç piksel): DOM tıklama alanları için */
  itemSpots(): HutSpot[] {
    if (!this.visible) return [];
    return this.items.map((it) => ({ id: it.id, x: it.x - 9, y: it.y - it.img.height - 4, w: 18, h: it.img.height + 6 }));
  }

  /** Kulübe önünde uyuyacak hamsterler */
  setSleepers(list: Array<{ id: string; variant: HamsterVariant; owned?: boolean }>): void {
    this.wanted = list;
    this.layoutSleepers();
  }

  /** Uyuyan sayısına göre (en az 2 yer) kulübe alanı çarka değmeden sığıyor mu */
  private minX = 0;
  private fitCheck(): void {
    this.visible = this.hx - 16 - Math.max(2, this.wanted.length) * 32 > this.minX;
  }

  private layoutSleepers(): void {
    this.fitCheck();
    const old = new Map(this.sleepers.map((s) => [s.id, s]));
    this.sleepers = this.wanted.map((w, i) => {
      const prev = old.get(w.id);
      const locked = w.owned === false;
      const frames =
        prev && prev.variant === w.variant && prev.locked === locked
          ? prev.frames
          : [0.9, 1.2].map((sq) => {
              const img = drawHamsterPose({ ...DEFAULT_POSE, squash: sq, headBob: 1, eyes: 'closed', rest: true, companion: false }, w.variant).img;
              return locked ? shade(img) : img;
            });
      return {
        id: w.id,
        variant: w.variant,
        frames,
        locked,
        aura: prev && prev.variant === w.variant ? prev.aura : new HamsterAura(w.variant),
        // Kulübenin solunda, kapıya dönük sıralanır
        x: Math.round(this.hx - 16 - i * 32),
        y: this.groundY - BACK,
        phase: i * 1.7,
      };
    });
  }

  /** Değiş-tokuş koşucusu yolda: bu türün uyuyan hâli varana kadar çizilmez */
  hiddenVariant: HamsterVariant | null = null;
  /** Uçan eşya yolda: köşedeki hâli varana kadar çizilmez */
  hiddenItem: string | null = null;

  /** Bu türdeki uyuyan hamsterin ayak noktası (iç piksel) */
  sleeperPos(variant: HamsterVariant): [number, number] | null {
    if (!this.visible) return null;
    const s = this.sleepers.find((x) => x.variant === variant);
    return s ? [s.x, s.y] : null;
  }

  /** Köşedeki eşyanın merkezi (iç piksel) */
  itemPos(id: string): [number, number] | null {
    if (!this.visible) return null;
    const it = this.items.find((x) => x.id === id);
    return it ? [it.x, it.y - it.img.height / 2] : null;
  }

  get groundLine(): number {
    return this.groundY;
  }

  /** Uyuyan hamsterlerin kutuları (iç piksel): DOM'daki tıklama alanları için */
  spots(): HutSpot[] {
    if (!this.visible) return [];
    return this.sleepers.map((s) => ({ id: s.id, x: s.x - ANCHOR_X, y: s.y - ANCHOR_Y + 8, w: 34, h: ANCHOR_Y - 6 }));
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.smokeIn -= dt;
    if (this.smokeIn <= 0) {
      this.smoke.push({ x: this.hx + 34, y: this.hy + 2, age: 0 });
      this.smokeIn = 0.7 + Math.random() * 0.5;
    }
    for (const p of this.smoke) {
      p.age += dt;
      p.y -= dt * 4;
      p.x += dt * (1.5 + Math.sin(p.age * 2.2) * 1.2);
    }
    this.smoke = this.smoke.filter((p) => p.age < 2.6);
    for (const s of this.sleepers) s.aura.update(dt, s.x, s.y - 10, 0.2);
    for (const it of this.items) it.fx.update(dt, it.x, it.y - it.img.height / 2, it.img.width);
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame): void {
    if (!this.visible || !this.hut) return;
    // Baca dumanı
    // Küçük, yuvarlak ve giderek seyrelen duman
    for (const p of this.smoke) {
      if (p.age > 1.8 && Math.floor(p.age * 10) % 2 === 0) continue;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (p.age < 0.9) {
        this.smokeBatch.add(x, y, 2, 2);
      } else {
        this.smokeBatch.add(x, y - 1, 2, 1);
        this.smokeBatch.add(x - 1, y, 4, 2);
        this.smokeBatch.add(x, y + 2, 2, 1);
      }
    }
    this.smokeBatch.flush(ctx, '#bdb6d4', 0.28);

    ctx.drawImage(this.hut, this.hx, this.hy);
    // Gece pencere ışığı yayılır
    const night = 1 - f.p.sun;
    if (this.glow && night > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = night * (0.55 + 0.08 * Math.sin(f.t * 2.3));
      drawCentered(ctx, this.glow, this.hx + 33, this.hy + 23);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // Yataklar: Pixsy minderleriyle aynı stil, hamster boyunda (hamster yolda olsa da yatak durur)
    for (const s of this.sleepers) {
      const bx = Math.round(s.x - 14);
      const by = s.y - 1;
      this.bedSh.add(bx + 1, by + 4, 28, 1);
      this.bedEdge.add(bx, by + 1, 30, 3);
      this.bed.add(bx + 1, by, 28, 3);
      this.bedHi.add(bx + 3, by, 24, 1);
      // Yastık: başın altında (sağ uç) küçük kabarık bir tümsek
      this.bed.add(bx + 20, by - 1, 8, 1);
      this.bedHi.add(bx + 21, by - 1, 6, 1);
    }
    this.bedSh.flush(ctx, '#05040c', 0.5);
    this.bedEdge.flush(ctx, '#3b3670');
    this.bed.flush(ctx, '#6a5cc8');
    this.bedHi.flush(ctx, '#8f82e0');

    // Uyuyan hamsterler (nefes alır), efektleri ve "z"leri
    for (const s of this.sleepers) {
      if (s.variant === this.hiddenVariant) continue;
      const img = s.frames[Math.sin(f.t * 1.6 + s.phase) > 0 ? 1 : 0]!;
      const ox = Math.round(s.x - ANCHOR_X);
      const oy = Math.round(s.y - ANCHOR_Y);
      if (s.locked) {
        ctx.drawImage(img, ox, oy);
      } else {
        s.aura.drawBehind(ctx, img, ox, oy, false, f.t + s.phase, 0.2);
        ctx.drawImage(img, ox, oy);
        s.aura.drawFront(ctx);
      }
      for (let i = 0; i < 2; i++) {
        const t = (f.t * 0.3 + i / 2 + s.phase * 0.1) % 1;
        const zx = Math.round(ox + 26 + t * 5 + i);
        const zy = Math.round(oy + 13 - t * 10);
        this.zzz.add(zx, zy, 2, 1);
        this.zzz.add(zx, zy + 1, 1, 1);
        this.zzz.add(zx, zy + 2, 2, 1);
      }
    }
    this.zzz.flush(ctx, '#bfe6ff', 0.8);

    // Eşya köşesi: takılı olmayan eşyalar (minder + parıltı, ara sıra küçük bir zıplama)
    for (const it of this.items) {
      const hiddenNow = it.id === this.hiddenItem;
      // Küçük piksel minder: eşya burada "saklanıyor"
      const cx0 = Math.round(it.x - 8);
      this.itemShadow.add(cx0 + 1, it.y + 3, 15, 1);
      this.cushionSh.add(cx0, it.y + 1, 17, 2);
      this.cushion.add(cx0 + 1, it.y, 15, 2);
      this.cushionHi.add(cx0 + 2, it.y, 13, 1);
      if (this.itemGlow && !hiddenNow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 + 0.2 * Math.sin(f.t * 2 + it.phase);
        drawCentered(ctx, this.itemGlow, it.x, it.y - it.img.height / 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }
    this.itemShadow.flush(ctx, '#05040c', 0.5);
    this.cushionSh.flush(ctx, '#3b3670');
    this.cushion.flush(ctx, '#6a5cc8');
    this.cushionHi.flush(ctx, '#8f82e0');
    for (const it of this.items) {
      if (it.id === this.hiddenItem) continue;
      const k = (f.t * 0.45 + it.phase) % 1;
      const hop = k < 0.12 ? Math.round(Math.sin((k / 0.12) * Math.PI) * 2) : 0;
      const ox = Math.round(it.x - it.img.width / 2);
      const oy = Math.round(it.y - it.img.height - hop);
      // ETH: yıldızlar · BTC: alevler
      const tops = columnTops(it.img, 0, it.img.width - 1).map(([x, y]) => [ox + x, oy + y] as [number, number]);
      it.fx.drawBehind(ctx, it.x, oy + it.img.height / 2, tops, f.t + it.phase);
      ctx.drawImage(it.img, ox, oy);
      it.fx.drawFront(ctx);
    }
  }
}
