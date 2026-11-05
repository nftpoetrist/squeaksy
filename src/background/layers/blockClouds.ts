import { offX, offY, type Frame, type Scene } from '../scene';
import { hex } from '../util/color';
import { clamp, lerp, TAU } from '../util/math';
import { createCanvas, drawCentered, glowSprite, plotLine, RectBatch } from '../util/pixel';
import { mulberry32, rand, randInt, type Rng } from '../util/rng';

interface TilePalette {
  top: string;
  topHi: string;
  hi: string;
  base: string;
  sh: string;
  side: string;
  deep: string;
}

/** Boş (henüz koşulmamış) blok yuvaları: renksiz. Gündüz hafif sıcak tona karışır. */
const EMPTY: TilePalette = { top: '#3a3470', topHi: '#4e4890', hi: '#3e3878', base: '#1a1636', sh: '#262150', side: '#18142e', deep: '#0e0b20' };
const EMPTY_SUN: TilePalette = { top: '#8a5a8a', topHi: '#a87aa0', hi: '#7a4a7a', base: '#4a2a50', sh: '#5a3460', side: '#3a2040', deep: '#24122a' };
/** Hamster koştukça dolan bloklar */
const GOLD: TilePalette = { top: '#ffeaa0', topHi: '#fff8d8', hi: '#fff0a0', base: '#ffc93c', sh: '#d8961e', side: '#a86418', deep: '#5a3210' };
/** Skyeaksy (Rare): gök mavisi gövde, pembe üst yüz, lavanta gölge */
const SKY_FILL: TilePalette = { top: '#ffd6ef', topHi: '#ffffff', hi: '#d4f4ff', base: '#8fd0ff', sh: '#a996ff', side: '#c78ae0', deep: '#4a4aa8' };
/** Infernoksy (Legendary): kızıl-kor gövde, alev sarısı üst yüz */
const FIRE_FILL: TilePalette = { top: '#ffb03a', topHi: '#ffe46a', hi: '#ff7a3a', base: '#e0342a', sh: '#a81c28', side: '#8e1424', deep: '#4a0610' };

/** Seraphoksy (Mythic): süt beyazı / inci gövde, altın kenar, lavanta gölge */
const HEAVEN_FILL: TilePalette = { top: '#ffffff', topHi: '#ffffff', hi: '#fff6dc', base: '#f3f0fb', sh: '#ddd2f3', side: '#e8cf86', deep: '#6a5aa8' };

/** Dolgu temaları: 0 altın (Squeaksy) · 1 gök (Skyeaksy) · 2 ateş (Infernoksy) · 3 cennet (Seraphoksy) */
export type FillTheme = 'starter' | 'sky' | 'inferno' | 'seraph';
const THEME_INDEX: Record<FillTheme, number> = { starter: 0, sky: 1, inferno: 2, seraph: 3 };
const THEME_FILL = [GOLD, SKY_FILL, FIRE_FILL, HEAVEN_FILL];
const THEME_CHAIN = [
  { A: '#ffc93c', B: '#d8961e', Hi: '#fff6c8', Sh: '#5a3210' },
  { A: '#9fe9ff', B: '#a996ff', Hi: '#ffffff', Sh: '#4a4aa8' },
  { A: '#ff6a1e', B: '#c81e2a', Hi: '#ffd23a', Sh: '#4a0610' },
  { A: '#ffffff', B: '#f2d98f', Hi: '#ffffff', Sh: '#6a5aa8' },
  // 4: Squeekchain (Gerçek Bulut'un zinciri). Oyuncu temaları 0..3 kullanır, bu dizin onlara hiç verilmez.
  { A: '#7ee2f8', B: '#3fb8e0', Hi: '#e8fcff', Sh: '#0c3a5a' },
];
const THEME_GLOW = ['#ffc04a', '#8fe0ff', '#ff5a1a', '#fff3c4', '#4ee6ff'];
/** Gerçek Bulut (Squeekchain): gerçek hamsterin bloklarıyla dolan camgöbeği bulut */
const CHAIN_THEME = 4;
const REAL_FILL: TilePalette = { top: '#c8f8ff', topHi: '#ffffff', hi: '#a8f0ff', base: '#3fc8e8', sh: '#2a9cc8', side: '#1f78a8', deep: '#0c3a5a' };
/** Boşken de kimliği belli olsun: hafif camgöbeği tonlu boş yuvalar */
const REAL_EMPTY: TilePalette = { top: '#2f5878', topHi: '#43779a', hi: '#355f80', base: '#112840', sh: '#1a3a56', side: '#0f233a', deep: '#081624' };
/** Gerçek Bulut'un küme indeksi (oyuncu zincirindeki kümeler 0..n-1) */
export const REAL_CLUSTER = -2;

/** Gerçek Bulut'un görünen durumu (canlı veriden) */
export interface RealCloudState {
  /** 0..1: inşa edilen gerçek bloğun dolma oranı */
  fill: number;
  /** Bloklar tamamlandı, zincire yazılmayı bekliyor: bulut dolu ve çıtırdıyor */
  pending: boolean;
  /** Veri taze mi (değilse bulut ve zinciri sönük) */
  live: boolean;
  /** Gerçek çark şu an koşuyor mu (zincirde veri paketleri akar) */
  active: boolean;
}
const FLAME = ['#fff3a0', '#ffd23a', '#ff8a2a', '#e0302a', '#7a0a18'];
/** Yıldırım çarpınca 'lighter' ile üstüne bindirilen elektrik silueti */
const LIT: TilePalette = { top: '#ffffff', topHi: '#ffffff', hi: '#ffffff', base: '#a8ccff', sh: '#7fa8f0', side: '#6a8ce0', deep: '#4a64c0' };

interface Tile {
  /** Küme tuvalindeki sol-üst köşe */
  x: number;
  y: number;
  top: boolean;
  right: boolean;
}

interface Cluster {
  tiles: Tile[];
  /** Yıldırımın hedef alabileceği (üstü açık) bloklar */
  targets: number[];
  x: number;
  y: number;
  w: number;
  h: number;
  empty: HTMLCanvasElement;
  emptySun: HTMLCanvasElement;
  /** Tema başına dolu blok görünümü (altın / gök / ateş) */
  fills: HTMLCanvasElement[];
  /** Her bloğu hangi tema doldurdu (dolduran hamsterin rengi kalıcıdır) */
  tileTheme: Uint8Array;
  lit: HTMLCanvasElement;
  /** Doluş sırası (alttan üste, soldan sağa) */
  order: number[];
  /** Blok tamamlanma parıltısı */
  flash: Float32Array;
  /** Zincirdeki ilk bloğun genel sırası (bulutlar soldan sağa sırayla dolar) */
  offset: number;
  filled: number;
  phase: number;
  hit: number;
  hitPower: number;
  hitTile: number;
}

interface Link {
  /** -1 = hamster çarkı */
  a: number;
  b: number;
  t: number;
  speed: number;
  /** 0..1: zincirin a'dan b'ye renk almış kısmı */
  gold: number;
  /** Zincirin rengi: dolduran hamsterin teması */
  theme: number;
}

export interface BlockTarget {
  cluster: number;
  tile: number;
  /** Ekrandaki (iç piksel) çarpma noktası: bloğun üst yüzeyi */
  x: number;
  y: number;
}

/** advance() sonucu: bu adımda tamamlanan bloklar ve bulutlar */
export interface AdvanceResult {
  blocks: BlockTarget[];
  clouds: number[];
}

const PARALLAX = 0.3;

/**
 * Bloklardan oluşan bulutlar: gökyüzünde zincirle birbirine bağlı
 * "blok zinciri" kümeleri. Hamster koştukça bloklar soldan sağa, bulut bulut
 * altınla dolar; dolan bulutun zinciri de altına döner. Yıldırımlar bu bloklara çarpar.
 */
export class BlockCloudLayer {
  private clusters: Cluster[] = [];
  private links: Link[] = [];
  private s = 7;
  private d = 3;
  private hitGlow: HTMLCanvasElement | null = null;
  private packetGlow: HTMLCanvasElement | null = null;
  private glows: HTMLCanvasElement[] = [];
  /** Koşan hamsterin dolgu teması */
  private theme = 0;
  private flame = FLAME.map(() => new RectBatch());
  private sparkle = new RectBatch();
  private chainFire: Array<[number, number]> = [];
  private wheelAnchor = { x: 0, y: 0 };
  private wheelEnergy = 0;
  /** Zincirdeki doluluk (blok cinsinden, kesirli) */
  private blocks = 0;
  private totalBlocks = 1;
  private wheelIdx = -1;
  private fillLine = new RectBatch();
  private chainA = new RectBatch();
  private chainB = new RectBatch();
  private chainHi = new RectBatch();
  private chainShade = new RectBatch();
  private themeBatches = THEME_CHAIN.map(() => ({ A: new RectBatch(), B: new RectBatch(), Hi: new RectBatch(), Sh: new RectBatch() }));
  private packets = new RectBatch();
  private arcs = new RectBatch();
  private ox = 0;
  private oy = 0;
  private t = 0;
  /** Gerçek Bulut + çark bulutuna bağlanan camgöbeği zinciri */
  private real: Cluster | null = null;
  private realFills: HTMLCanvasElement | null = null;
  private realState: RealCloudState = { fill: 0, pending: false, live: false, active: false };
  /** Ekranda görünen doluluk (hedefe yumuşakça yaklaşır: blok blok dolar) */
  private realShown = 0;
  /** Fırtına anı: bulut bir an tamamen dolu ve parlak görünür (saniye) */
  private realBurst = 0;
  private realLinkT = 0;
  /** Fırtına sonrası zincir boyunca çark bulutuna koşan enerji (0..1, -1 = yok) */
  private realSurge = -1;
  private realOnce = false;

  build(scene: Scene, rng: Rng, count: number): void {
    const { W, H, u, wheel } = scene;
    // Blok boyutu dar kenara göre: dikey ekranda bloklar devleşmesin
    this.s = Math.max(6, Math.round(8 * Math.min(u, (W / 480) * 1.3)));
    this.d = Math.max(2, Math.round(this.s * 0.4));
    this.hitGlow = glowSprite(this.s * 3.2, hex('#9fd0ff'), 0.85, 5, 1.3);
    this.packetGlow = glowSprite(3 * u + 1, hex('#ffe58a'), 0.8, 3, 1.2);
    this.glows = THEME_GLOW.map((c) => glowSprite(this.s * 1.4, hex(c), 0.6, 5, 1.4));
    this.wheelAnchor = { x: wheel.cx, y: wheel.cy - wheel.R - 2 };

    const portrait = W < H;
    const n = portrait ? Math.max(3, count - 1) : count;
    this.clusters = [];

    // 1) Çark bulutu: çarkın tam üstünde, biraz daha büyük; zincirin ilk halkası
    const wc = this.makeCluster(portrait ? 5 : 7, 4, rng);
    wc.x = Math.round(clamp(wheel.cx - wc.w / 2 + rand(rng, -6, 6) * u, 6, W - wc.w - 8));
    wc.y = Math.round(clamp(wheel.cy - wheel.R - wc.h - 22 * u, H * 0.07, H * 0.3));
    this.clusters.push(wc);

    // 1b) Gerçek Bulut (Squeekchain): çark bulutunun solunda, alt kenarları hizalı; zincirle ona bağlı.
    // Oyuncunun zincirine dahil değildir (doluluk, final ve rastgele yıldırımlar onu etkilemez).
    // Sığması için çark bulutu gerekirse sağa kayar; diğer bulutlar çark bulutuna göre dizildiği için onlar da kayar.
    // Kendi sabit üreteci: oyuncu bulutlarının şekli (aynı tohumdan gelen sıra) değişmez
    const real = this.makeCluster(portrait ? 3 : 4, 3, mulberry32(0x5eec), [REAL_EMPTY, REAL_FILL]);
    const linkGap = Math.max(10, Math.round(12 * u));
    real.x = 6;
    wc.x = Math.round(Math.min(Math.max(wc.x, real.x + real.w + linkGap), W - wc.w - 8));
    real.y = Math.round(clamp(wc.y + wc.h - real.h - 2 * u, H * 0.04, H * 0.3));
    this.real = real;
    this.realFills = real.fills[0] ?? null;

    // 2) Diğer kümeler: gökyüzünde yumuşak bir dalga boyunca, eşit aralıklı bir gerdanlık gibi
    const others = n - 1;
    const x0 = wc.x + wc.w + 10 * u;
    const span = Math.max(1, W - 8 - x0);
    const gap = span / Math.max(1, others);
    const waveBase = portrait ? 0.17 : 0.25;
    const waveAmp = portrait ? 0.07 : 0.13;
    const phase0 = rand(rng, 0, TAU);
    for (let i = 0; i < others; i++) {
      // Boyut ritmi: büyük - küçük - orta ... (sıkıcı tekrar olmasın diye hafif rastgele)
      const big = i % 3 === 1;
      const cols = Math.max(3, Math.min(Math.floor((gap * 0.6 - this.d) / this.s), (big ? 7 : 5) + randInt(rng, 0, 1)));
      const rows = big ? 4 : 3;
      const c = this.makeCluster(cols, rows, rng);
      const cx = x0 + gap * (i + 0.5);
      const wave = Math.sin(phase0 + i * 1.15) * 0.75 + Math.sin(phase0 * 0.5 + i * 2.3) * 0.25;
      const cy = H * (waveBase + waveAmp * wave);
      c.x = Math.round(clamp(cx - c.w / 2, 6, W - c.w - 8));
      c.y = Math.round(clamp(cy - c.h / 2, H * 0.04, H * 0.46));
      this.clusters.push(c);
    }
    this.clusters.sort((p, q) => p.x - q.x);
    this.wheelIdx = this.clusters.indexOf(wc);

    // Doluş sırası: soldan sağa (çark bulutu en solda → ilk o dolar)
    let off = 0;
    for (const c of this.clusters) {
      c.offset = off;
      off += c.tiles.length;
    }
    this.totalBlocks = Math.max(1, off);

    // Zincir: komşu kümeler + çark → çark bulutu
    this.links = [];
    for (let i = 0; i < this.clusters.length - 1; i++) {
      this.links.push({ a: i, b: i + 1, t: rng(), speed: rand(rng, 0.14, 0.3), gold: 0, theme: 0 });
    }
    this.links.push({ a: -1, b: this.wheelIdx, t: 0, speed: 0.35, gold: 0, theme: 0 });
    this.blocks = 0;
    this.syncFilled(false);
  }

  /** Çarka bağlı bulutun indeksi */
  get wheelCluster(): number {
    return this.wheelIdx;
  }

  get count(): number {
    return this.clusters.length;
  }

  /** Zincirdeki toplam blok sayısı */
  get total(): number {
    return this.totalBlocks;
  }

  /** Tamamlanmış blok sayısı */
  get filledBlocks(): number {
    return Math.floor(this.blocks + 1e-6);
  }

  /** Tamamen dolmuş bulut sayısı */
  get filledClouds(): number {
    let n = 0;
    for (const c of this.clusters) if (c.filled >= c.tiles.length) n++;
    return n;
  }

  /** 0..1: tüm zincirin doluluk oranı */
  get fillProgress(): number {
    return this.blocks / this.totalBlocks;
  }

  get allFull(): boolean {
    return this.blocks >= this.totalBlocks - 1e-6;
  }

  /** Doluluğu doğrudan ayarlar (ödül/olay üretmez; yeniden ölçekleme ve test için). */
  setProgress(p: number): void {
    this.blocks = clamp(p, 0, 1) * this.totalBlocks;
    this.syncFilled(false);
    for (const l of this.links) {
      l.gold = this.isFull(l.a < 0 ? this.wheelIdx : l.a) ? 1 : 0;
      l.theme = this.theme;
    }
  }

  /** Zinciri `amount` blok kadar ilerletir; tamamlanan blokları/bulutları döndürür. */
  advance(amount: number): AdvanceResult | null {
    if (amount <= 0 || this.allFull) return null;
    const before = this.filledBlocks;
    this.blocks = Math.min(this.totalBlocks, this.blocks + amount);
    const after = this.filledBlocks;
    if (after === before) return null;
    const res: AdvanceResult = { blocks: [], clouds: [] };
    for (let g = before; g < after; g++) {
      const ci = this.clusterAt(g);
      const c = this.clusters[ci]!;
      const ti = c.order[g - c.offset]!;
      res.blocks.push({ cluster: ci, tile: ti, ...this.tileCenter(ci, ti) });
      if (g - c.offset === c.tiles.length - 1) res.clouds.push(ci);
    }
    this.syncFilled(true);
    return res;
  }

  /** Tüm bulutları ve zincirleri sıfırlar: döngü baştan başlar. */
  reset(): void {
    this.blocks = 0;
    this.syncFilled(false);
    for (const l of this.links) l.gold = 0;
  }

  private clusterAt(g: number): number {
    for (let i = this.clusters.length - 1; i >= 0; i--) if (g >= this.clusters[i]!.offset) return i;
    return 0;
  }

  private isFull(i: number): boolean {
    const c = this.clusters[i];
    return !!c && c.filled >= c.tiles.length;
  }

  /** Koşan hamsterin teması: bundan sonra dolan bloklar ve zincirler bu renkte */
  setTheme(theme: FillTheme): void {
    this.theme = THEME_INDEX[theme];
  }

  /** Gerçek Bulut'un canlı durumu. İlk çağrıda doluluk anında yerine oturur, sonra blok blok ilerler. */
  setReal(s: RealCloudState): void {
    this.realState = { fill: clamp(s.fill, 0, 1), pending: s.pending, live: s.live, active: s.active };
    if (!this.realOnce) {
      this.realOnce = true;
      this.realShown = s.pending ? 1 : this.realState.fill;
    }
  }

  /** Gerçek bloklar indi: bulut bir an dolu parlar, sonra yeni bloğun doluluğuna döner; zincirden enerji akar */
  burstReal(): void {
    this.realBurst = 1.1;
    this.realShown = 1;
    this.realSurge = 0;
    if (this.real) this.real.flash.fill(1);
  }

  /** Gerçek Bulut'un sahnedeki kutusu (iç piksel, sallanma hariç): etiket yerleşimi için */
  realBox(): { x: number; y: number; w: number; h: number } | null {
    const c = this.real;
    if (!c) return null;
    return { x: Math.round(c.x + this.ox), y: Math.round(c.y + this.oy), w: c.w - this.d, h: c.h };
  }

  private syncFilled(flash: boolean): void {
    for (const c of this.clusters) {
      const filled = clamp(Math.floor(this.blocks - c.offset + 1e-6), 0, c.tiles.length);
      for (let k = c.filled; k < filled; k++) c.tileTheme[c.order[k]!] = this.theme;
      if (flash && filled > c.filled) for (let k = c.filled; k < filled; k++) c.flash[c.order[k]!] = 1;
      c.filled = filled;
    }
  }

  /** Bloğun ekrandaki ön yüz merkezi (iç piksel) */
  private tileCenter(ci: number, ti: number): { x: number; y: number } {
    const c = this.clusters[ci]!;
    const t = c.tiles[ti]!;
    const [px, py] = this.screenPos(c);
    return { x: px + t.x + (this.s >> 1), y: py + t.y + (this.s >> 1) };
  }

  /** Bulutun ekrandaki merkezi (iç piksel) */
  cloudCenter(ci: number): { x: number; y: number } {
    const c = ci === REAL_CLUSTER ? this.real : this.clusters[ci];
    if (!c) return { x: 0, y: 0 };
    const [px, py] = this.screenPos(c);
    return { x: px + (c.w >> 1), y: py + (c.h >> 1) };
  }

  /** Çarkın tepesi (ekran iç pikseli) ve hızı (0..1): bağlantı ve paket akışı için */
  setWheel(anchorX: number, anchorY: number, energy: number): void {
    this.wheelAnchor = { x: anchorX, y: anchorY };
    this.wheelEnergy = energy;
  }

  /** custom: [boş, dolu] paleti (Gerçek Bulut). Verilmezse oyuncu temaları boyanır. */
  private makeCluster(cols: number, rows: number, rng: Rng, custom?: [TilePalette, TilePalette]): Cluster {
    const s = this.s;
    const d = this.d;
    const occ: boolean[][] = [];
    const phase = rng() * TAU;
    for (let c = 0; c < cols; c++) {
      const t = (c + 0.5) / cols;
      const dome = Math.sin(Math.PI * t);
      const bump = 0.5 + 0.5 * Math.sin(t * Math.PI * 3 + phase);
      const h = clamp(Math.round(1 + (rows - 1) * dome * (0.7 + 0.45 * bump)), 1, rows);
      occ.push(Array.from({ length: rows }, (_, r) => r < h));
    }
    const has = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows && occ[c]![r]!;
    const m = 1;
    const w = cols * s + d + m * 2;
    const h = rows * s + d + m * 2;
    const tiles: Tile[] = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (!has(c, r)) continue;
        tiles.push({ x: m + c * s, y: m + d + (rows - 1 - r) * s, top: !has(c, r + 1), right: !has(c + 1, r) });
      }
    }
    const targets = tiles.map((t, i) => (t.top ? i : -1)).filter((i) => i >= 0);
    const order = tiles.map((_, i) => i).sort((a, b) => tiles[b]!.y - tiles[a]!.y || tiles[a]!.x - tiles[b]!.x);
    return {
      tiles,
      targets,
      x: 0,
      y: 0,
      w,
      h,
      empty: this.paint(tiles, w, h, custom ? custom[0] : EMPTY),
      emptySun: custom ? this.paint(tiles, w, h, custom[0]) : this.paint(tiles, w, h, EMPTY_SUN),
      fills: custom ? [this.paint(tiles, w, h, custom[1])] : THEME_FILL.map((pal) => this.paint(tiles, w, h, pal)),
      tileTheme: new Uint8Array(tiles.length),
      lit: this.paint(tiles, w, h, LIT),
      order,
      flash: new Float32Array(tiles.length),
      offset: 0,
      filled: 0,
      phase,
      hit: 0,
      hitPower: 0,
      hitTile: -1,
    };
  }

  /** İki geçiş: önce üst/yan yüzler, sonra ön yüzler (öndekiler arkadakini örter). */
  private paint(tiles: Tile[], w: number, h: number, p: TilePalette): HTMLCanvasElement {
    const { canvas, ctx } = createCanvas(w, h);
    const s = this.s;
    const d = this.d;
    const batches = new Map<string, RectBatch>();
    const add = (color: string, x: number, y: number, bw = 1, bh = 1) => {
      let b = batches.get(color);
      if (!b) {
        b = new RectBatch();
        batches.set(color, b);
      }
      b.add(x, y, bw, bh);
    };
    const flushAll = () => {
      for (const [color, b] of batches) b.flush(ctx, color);
      batches.clear();
    };

    for (const t of tiles) {
      if (t.top) {
        for (let i = 0; i < d; i++) add(i === d - 1 ? p.topHi : p.top, t.x + i + 1, t.y - 1 - i, s - 1, 1);
      }
      if (t.right) {
        for (let j = 0; j < d; j++) add(j === d - 1 ? p.deep : p.side, t.x + s + j, t.y - j, 1, s - 1);
      }
    }
    flushAll();
    for (const t of tiles) {
      add(p.base, t.x, t.y, s - 1, s - 1);
      add(p.hi, t.x, t.y, s - 1, 1);
      add(p.hi, t.x, t.y, 1, s - 1);
      add(p.sh, t.x, t.y + s - 2, s - 1, 1);
      add(p.sh, t.x + s - 2, t.y + 1, 1, s - 2);
      add(p.deep, t.x, t.y + s - 1, s, 1);
      add(p.deep, t.x + s - 1, t.y, 1, s);
      if (s >= 7) {
        // Blok paneli: içte küçük çerçeve
        add(p.sh, t.x + 2, t.y + 2, s - 5, 1);
        add(p.sh, t.x + 2, t.y + 2, 1, s - 5);
        add(p.hi, t.x + 3, t.y + s - 3, s - 5, 1);
        add(p.hi, t.x + s - 3, t.y + 3, 1, s - 5);
      }
    }
    flushAll();
    return canvas;
  }

  /** Yıldırım için hedef seçer. */
  pickTarget(prefer?: number): BlockTarget | null {
    // Gerçek Bulut yalnızca açıkça istenince (gerçek blok inişi) hedef olur; rastgele yıldırım ona düşmez
    if (prefer === REAL_CLUSTER) {
      const c = this.real;
      if (!c) return null;
      const ti = c.targets[Math.floor(Math.random() * c.targets.length)] ?? 0;
      const tile = c.tiles[ti]!;
      const [px, py] = this.screenPos(c);
      return { cluster: REAL_CLUSTER, tile: ti, x: px + tile.x + Math.round((this.s + this.d) / 2), y: py + tile.y - Math.round(this.d / 2) };
    }
    if (this.clusters.length === 0) return null;
    // Rastgele yıldırımlar çark bulutuna değil diğer kümelere düşer.
    const pool = this.clusters.map((_, i) => i).filter((i) => i !== this.wheelIdx);
    const ci =
      prefer !== undefined && prefer >= 0 && prefer < this.clusters.length
        ? prefer
        : pool.length
          ? pool[Math.floor(Math.random() * pool.length)]!
          : Math.floor(Math.random() * this.clusters.length);
    const c = this.clusters[ci]!;
    const ti = c.targets[Math.floor(Math.random() * c.targets.length)] ?? 0;
    const tile = c.tiles[ti]!;
    const [px, py] = this.screenPos(c);
    return { cluster: ci, tile: ti, x: px + tile.x + Math.round((this.s + this.d) / 2), y: py + tile.y - Math.round(this.d / 2) };
  }

  hit(target: BlockTarget, power: number): void {
    const c = target.cluster === REAL_CLUSTER ? this.real : this.clusters[target.cluster];
    if (!c) return;
    c.hit = 1;
    c.hitPower = power;
    c.hitTile = target.tile;
  }

  private screenPos(c: Cluster): [number, number] {
    const bob = Math.round(Math.sin(this.t * 0.55 + c.phase) * 1.2);
    const jolt = c.hit > 0.88 ? -1 : 0;
    return [Math.round(c.x + this.ox), Math.round(c.y + this.oy + bob + jolt)];
  }

  update(dt: number, pulses: boolean): void {
    this.t += dt;
    for (const c of this.clusters) c.hit = Math.max(0, c.hit - dt * (c.hitPower > 1.5 ? 0.9 : 1.4));
    this.updateReal(dt);
    if (pulses) {
      for (const l of this.links) {
        // Çark kablosu: çark döndükçe paketler hızlanır ve sıklaşır
        const sp = l.a < 0 ? l.speed * (0.15 + this.wheelEnergy * 2.2) : l.speed;
        l.t = (l.t + dt * sp) % (l.a < 0 ? 1.05 : 1.5);
      }
    }
    // Dolan bulutun zinciri: altın, bir sonraki buluta doğru akarak yayılır
    for (const l of this.links) {
      const up = this.clusters[l.a < 0 ? this.wheelIdx : l.a];
      if (up && this.isFull(l.a < 0 ? this.wheelIdx : l.a)) {
        // Zincir, bulutun son bloğunu dolduran hamsterin renginde yayılır
        if (l.gold === 0) l.theme = up.tileTheme[up.order[up.order.length - 1]!]!;
        l.gold = Math.min(1, l.gold + dt * 1.1);
      }
    }
    for (const c of this.clusters) for (let i = 0; i < c.flash.length; i++) c.flash[i] = Math.max(0, c.flash[i]! - dt * 1.5);
  }

  private updateReal(dt: number): void {
    const c = this.real;
    if (!c) return;
    c.hit = Math.max(0, c.hit - dt * (c.hitPower > 1.5 ? 0.9 : 1.4));
    for (let i = 0; i < c.flash.length; i++) c.flash[i] = Math.max(0, c.flash[i]! - dt * 1.2);
    if (this.realBurst > 0) {
      this.realBurst = Math.max(0, this.realBurst - dt);
    } else {
      // Hedefe blok blok yaklaşır (aşağı inişte anında: yeni blok boş başlar)
      const target = this.realState.pending ? 1 : this.realState.fill;
      if (target < this.realShown - 1e-4) this.realShown = target;
      else this.realShown = Math.min(target, this.realShown + dt * 0.35);
    }
    if (this.realSurge >= 0) {
      this.realSurge += dt * 1.25;
      if (this.realSurge > 1) this.realSurge = -1;
    }
    // Gerçek çark koşarken zincirde veri paketleri akar
    if (this.realState.active && this.realState.live) this.realLinkT = (this.realLinkT + dt * 0.45) % 1.4;
  }

  private anchor(i: number, side: 'left' | 'right' | 'bottom'): [number, number] {
    if (i < 0) return [this.wheelAnchor.x, this.wheelAnchor.y];
    const c = this.clusters[i]!;
    const [x, y] = this.screenPos(c);
    if (side === 'bottom') return [x + (c.w >> 1), y + c.h - 2];
    return [side === 'left' ? x + 1 : x + c.w - this.d - 1, y + Math.round(c.h * 0.62)];
  }

  /** Bir bulut: boş yuvalar + dolan altın bloklar (alttan üste). */
  private drawCluster(ctx: CanvasRenderingContext2D, c: Cluster, x: number, y: number, sun: number): void {
    const s = this.s;
    const d = this.d;
    const total = c.tiles.length;
    const full = c.filled >= total;
    ctx.globalAlpha = 1;
    if (!full) {
      ctx.drawImage(c.empty, x, y);
      if (sun > 0.01) {
        ctx.globalAlpha = sun;
        ctx.drawImage(c.emptySun, x, y);
        ctx.globalAlpha = 1;
      }
    }
    const uniform = full && c.tileTheme.every((v) => v === c.tileTheme[0]);
    if (uniform) {
      ctx.drawImage(c.fills[c.tileTheme[0]!]!, x, y);
    } else {
      for (let k = 0; k < c.filled; k++) {
        const ti = c.order[k]!;
        const t = c.tiles[ti]!;
        const top = t.top ? d : 0;
        const rx = t.x;
        const ry = t.y - top;
        const rw = s + (t.right ? d : 0);
        const rh = s + top;
        ctx.drawImage(c.fills[c.tileTheme[ti]!]!, rx, ry, rw, rh, x + rx, y + ry, rw, rh);
      }
      // Dolmakta olan blok: ön yüz alttan yukarı, koşan hamsterin renginde dolar
      // (Dolu bulutta dolmakta olan blok yoktur: kesir bir sonraki buluta aittir.
      //  Karışık temalı dolu bulutta bu kontrol olmadan c.order[total] okunup çöküyordu.)
      const frac = this.blocks - c.offset - c.filled;
      if (!full && frac > 0 && frac < 1) {
        const t = c.tiles[c.order[c.filled]!]!;
        const fh = Math.round((s - 1) * frac);
        if (fh > 0) {
          const sy = t.y + s - 1 - fh;
          ctx.drawImage(c.fills[this.theme]!, t.x, sy, s - 1, fh, x + t.x, y + sy, s - 1, fh);
          this.fillLine.add(x + t.x + 1, y + sy, s - 3, 1);
          this.fillLine.flush(ctx, '#fff6c8', 0.6 + 0.4 * Math.sin(this.t * 8));
        }
      }
    }
    // Parıltılar: yeni dolan blok + tamamen dolan bulut nabız atar (tema renginde)
    if (this.glows.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < total; i++) {
        const a = Math.max(c.flash[i]!, full ? 0.18 + 0.18 * Math.sin(this.t * 3 + i * 0.7 + c.phase) : 0);
        if (a < 0.03) continue;
        const t = c.tiles[i]!;
        ctx.globalAlpha = Math.min(1, a);
        drawCentered(ctx, this.glows[c.tileTheme[i]!]!, x + t.x + (s >> 1), y + t.y + (s >> 1));
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // Tema efektleri: gök bloklarında yıldız parıltısı, ateş bloklarının tepesinde alev
    for (let k = 0; k < c.filled; k++) {
      const ti = c.order[k]!;
      const th = c.tileTheme[ti]!;
      const t = c.tiles[ti]!;
      // Gök ve cennet bloklarında yıldız parıltısı
      if (th === 1 || th === 3) {
        const v = Math.sin(this.t * 1.7 + ti * 2.3 + c.phase * 5);
        if (v > 0.9) {
          const sx = x + t.x + 1 + ((ti * 3) % (s - 2));
          const sy = y + t.y + 1 + ((ti * 5) % (s - 2));
          this.sparkle.add(sx, sy, 1, 1);
          if (v > 0.96) {
            this.sparkle.add(sx - 1, sy, 1, 1);
            this.sparkle.add(sx + 1, sy, 1, 1);
            this.sparkle.add(sx, sy - 1, 1, 1);
            this.sparkle.add(sx, sy + 1, 1, 1);
          }
        }
      } else if (th === 2 && t.top) {
        // Üst yüzden yükselen titrek alev dilleri (bulut doluysa daha yüksek)
        const baseY = y + t.y - d;
        for (let col = 0; col < s; col++) {
          const gx = x + t.x + col + 1;
          const n = 0.5 + 0.5 * Math.sin(this.t * 9 + gx * 1.7) * Math.sin(this.t * 5.3 - gx * 0.9 + ti);
          const h = Math.round((full ? 1.6 : 1) * (0.5 + n * 3.5));
          for (let j = 0; j < h; j++) {
            const f = j / Math.max(1, h);
            const ci = f < 0.2 ? 0 : f < 0.45 ? 1 : f < 0.7 ? 2 : f < 0.92 ? 3 : 4;
            this.flame[ci]!.add(gx, baseY - 1 - j, 1, 1);
          }
        }
      }
    }
  }

  /** Gerçek Bulut'un sağ kenarından çark bulutunun sol kenarına sarkık zincir */
  private realLinkPath(): { pt: (t: number) => [number, number]; len: number } | null {
    const c = this.real;
    if (!c || this.wheelIdx < 0) return null;
    const [rx, ry] = this.screenPos(c);
    const ax = rx + c.w - this.d - 1;
    const ay = ry + Math.round(c.h * 0.62);
    const [bx, by] = this.anchor(this.wheelIdx, 'left');
    const dist = Math.hypot(bx - ax, by - ay);
    const sag = Math.max(3, dist * 0.14);
    return { pt: (t) => [lerp(ax, bx, t), lerp(ay, by, t) + sag * 4 * t * (1 - t)], len: dist + sag };
  }

  /** Gerçek Bulut: camgöbeği bloklar, inşa edilen bloğun doluluğu kadar (son blok alttan yukarı dolar) */
  private drawReal(ctx: CanvasRenderingContext2D): void {
    const c = this.real;
    const fill = this.realFills;
    if (!c || !fill) return;
    const s = this.s;
    const d = this.d;
    const [x, y] = this.screenPos(c);
    const live = this.realState.live;
    const total = c.tiles.length;
    const amount = this.realShown * total;
    const whole = Math.min(total, Math.floor(amount + 1e-6));
    const full = whole >= total;
    ctx.globalAlpha = live ? 1 : 0.55;
    if (!full) ctx.drawImage(c.empty, x, y);
    if (full) ctx.drawImage(fill, x, y);
    else {
      for (let k = 0; k < whole; k++) {
        const t = c.tiles[c.order[k]!]!;
        const top = t.top ? d : 0;
        const rw = s + (t.right ? d : 0);
        const rh = s + top;
        ctx.drawImage(fill, t.x, t.y - top, rw, rh, x + t.x, y + t.y - top, rw, rh);
      }
      const frac = amount - whole;
      if (frac > 0.02) {
        const t = c.tiles[c.order[whole]!]!;
        const fh = Math.round((s - 1) * frac);
        if (fh > 0) {
          const sy = t.y + s - 1 - fh;
          ctx.drawImage(fill, t.x, sy, s - 1, fh, x + t.x, y + sy, s - 1, fh);
          this.fillLine.add(x + t.x + 1, y + sy, s - 3, 1);
          this.fillLine.flush(ctx, '#e8fcff', (0.6 + 0.4 * Math.sin(this.t * 8)) * (live ? 1 : 0.5));
        }
      }
    }
    // Parıltı: yeni dolan bloklar, dolu bekleyen bulutun nabzı, fırtına anının patlaması
    const glow = this.glows[CHAIN_THEME];
    const pending = this.realState.pending && live;
    if (glow) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < total; i++) {
        const pulse = pending || this.realBurst > 0 ? 0.3 + 0.25 * Math.sin(this.t * 6 + i * 0.9) : 0;
        const a = Math.max(c.flash[i]!, pulse);
        if (a < 0.03) continue;
        const t = c.tiles[i]!;
        ctx.globalAlpha = Math.min(1, a);
        drawCentered(ctx, glow, x + t.x + (s >> 1), y + t.y + (s >> 1));
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    // Zincire yazılmayı bekleyen dolu bulut: üstünde küçük elektrik çıtırtıları
    if (pending && Math.sin(this.t * 13) > 0.2) {
      const t = c.tiles[c.targets[Math.floor(this.t * 7) % c.targets.length] ?? 0]!;
      let ax = x + t.x + (s >> 1);
      let ay = y + t.y - 1;
      for (let i = 0; i < 4; i++) {
        const nx = clamp(ax + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.round(Math.random())), x, x + c.w - 1);
        const ny = clamp(ay - Math.round(Math.random() * 2), y - 4, y + c.h - 1);
        plotLine(ax, ay, nx, ny, (qx, qy) => this.arcs.add(qx, qy));
        ax = nx;
        ay = ny;
      }
      this.arcs.flush(ctx, '#c8fbff', 0.9);
    }
    // Yıldırım isabeti (gerçek blok inişi)
    if (c.hit > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, c.hit * c.hit);
      ctx.drawImage(c.lit, x, y);
      const t = c.tiles[c.hitTile];
      if (t && this.hitGlow) {
        ctx.globalAlpha = Math.min(1, c.hit);
        drawCentered(ctx, this.hitGlow, x + t.x + (s >> 1), y + t.y);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Eğri boyunca 3 pikselde bir halka dizer: yüzü görünen oval halka ile
   * yandan görünen halka sırayla gelir; halkalar zincirin yönüne göre döner.
   * `gold` (0..1) oranına kadar olan halkalar altın çizilir.
   */
  private chainLinks(pt: (t: number) => [number, number], approxLen: number, gold: number, theme = 0): void {
    const tb = this.themeBatches[theme]!;
    const N = Math.max(8, Math.ceil(approxLen * 1.5));
    let [px, py] = pt(0);
    let acc = 0;
    let next = 0;
    let k = 0;
    for (let i = 1; i <= N; i++) {
      const [x, y] = pt(i / N);
      const dx = x - px;
      const dy = y - py;
      acc += Math.hypot(dx, dy);
      const g = i / N <= gold;
      const A = g ? tb.A : this.chainA;
      const B = g ? tb.B : this.chainB;
      const Hi = g ? tb.Hi : this.chainHi;
      const Sh = g ? tb.Sh : this.chainShade;
      while (acc >= next) {
        const cx = Math.round(x);
        const cy = Math.round(y);
        const vertical = Math.abs(dy) > Math.abs(dx);
        if (k % 2 === 0) {
          // yüzü görünen oval halka
          if (vertical) {
            A.add(cx, cy - 2);
            A.add(cx - 1, cy - 1, 1, 3);
            A.add(cx + 1, cy - 1, 1, 3);
            A.add(cx, cy + 2);
            Hi.add(cx - 1, cy - 1);
            Sh.add(cx + 2, cy - 1, 1, 3);
          } else {
            A.add(cx - 1, cy - 1, 3, 1);
            A.add(cx - 2, cy);
            A.add(cx + 2, cy);
            A.add(cx - 1, cy + 1, 3, 1);
            Hi.add(cx - 1, cy - 1);
            Sh.add(cx - 1, cy + 2, 3, 1);
          }
        } else if (vertical) {
          // yandan görünen halka
          B.add(cx, cy - 1, 1, 3);
          Sh.add(cx + 1, cy - 1, 1, 3);
        } else {
          B.add(cx - 1, cy, 3, 1);
          Sh.add(cx - 1, cy + 1, 3, 1);
        }
        // Ateş teması: renk almış zincir boyunca alev noktaları
        if (g && theme === 2 && k % 2 === 0) this.chainFire.push([cx, cy]);
        k++;
        next += 3;
      }
      px = x;
      py = y;
    }
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame): void {
    this.ox = offX(f, PARALLAX);
    this.oy = offY(f, PARALLAX);
    const sun = f.p.sun;

    // --- Piksel zincirler (sarkık) ve üzerlerinde akan veri paketleri
    const packetPts: Array<[number, number]> = [];
    for (const l of this.links) {
      const [ax, ay] = l.a < 0 ? this.anchor(-1, 'bottom') : this.anchor(l.a, 'right');
      const [bx, by] = l.a < 0 ? this.anchor(l.b, 'bottom') : this.anchor(l.b, 'left');
      const sag = l.a < 0 ? 0 : Math.max(3, Math.hypot(bx - ax, by - ay) * 0.14);
      const pt = (t: number): [number, number] => [lerp(ax, bx, t), lerp(ay, by, t) + sag * 4 * t * (1 - t)];
      this.chainLinks(pt, Math.hypot(bx - ax, by - ay) + sag, l.gold, l.theme);
      if (l.t < 1) {
        const [x, y] = pt(l.t);
        packetPts.push([Math.round(x), Math.round(y)]);
        this.packets.add(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
      }
    }
    // Gerçek Bulut → çark bulutu: camgöbeği zincir (veri gecikmişse renksiz)
    const rp = this.realLinkPath();
    if (rp) {
      this.chainLinks(rp.pt, rp.len, this.realState.live ? 1 : 0, CHAIN_THEME);
      if (this.realState.active && this.realState.live && this.realLinkT < 1) {
        const [x, y] = rp.pt(this.realLinkT);
        packetPts.push([Math.round(x), Math.round(y)]);
        this.packets.add(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
      }
    }
    const sunny = sun > 0.5;
    this.chainShade.flush(ctx, sunny ? '#7a4a3a' : '#2a2260', 0.9);
    this.chainA.flush(ctx, sunny ? '#a89ad0' : '#8f82e0');
    this.chainB.flush(ctx, sunny ? '#8a7cc0' : '#6a5cc8');
    this.chainHi.flush(ctx, sunny ? '#e8e0ff' : '#ddd6ff');
    this.themeBatches.forEach((b, i) => {
      const c = THEME_CHAIN[i]!;
      b.Sh.flush(ctx, c.Sh, 0.9);
      b.A.flush(ctx, c.A);
      b.B.flush(ctx, c.B);
      b.Hi.flush(ctx, c.Hi);
    });
    // Alev almış zincirler (Infernoksy): halkaların üstünde titreşen küçük alevler
    for (const [cx, cy] of this.chainFire) {
      const n = 0.5 + 0.5 * Math.sin(this.t * 11 + cx * 1.3) * Math.sin(this.t * 6.7 - cy * 0.7);
      const h = 1 + Math.round(n * 4);
      for (let j = 0; j < h; j++) {
        const f = j / Math.max(1, h);
        const ci = f < 0.25 ? 1 : f < 0.6 ? 2 : f < 0.9 ? 3 : 4;
        this.flame[ci]!.add(cx + (j > 2 ? Math.round(Math.sin(this.t * 8 + cx)) : 0), cy - 2 - j, 1, 1);
      }
    }
    this.chainFire.length = 0;
    if (this.packetGlow) {
      ctx.globalCompositeOperation = 'lighter';
      for (const [x, y] of packetPts) {
        ctx.globalAlpha = 0.9;
        drawCentered(ctx, this.packetGlow, x, y);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    this.packets.flush(ctx, '#fff4c0');

    // --- Gerçek Bulut + fırtına sonrası zincirde koşan enerji
    this.drawReal(ctx);
    if (rp && this.realSurge >= 0 && this.glows[CHAIN_THEME]) {
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const tt = this.realSurge - k * 0.07;
        if (tt < 0 || tt > 1) continue;
        const [x, y] = rp.pt(tt);
        ctx.globalAlpha = 1 - k * 0.3;
        drawCentered(ctx, this.glows[CHAIN_THEME]!, Math.round(x), Math.round(y));
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // --- Blok bulutları
    for (const c of this.clusters) {
      const [x, y] = this.screenPos(c);
      this.drawCluster(ctx, c, x, y, sun);
      // Yıldırım isabeti: tüm küme elektrikle parlar
      if (c.hit > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        const k = c.hit * c.hit;
        ctx.globalAlpha = Math.min(1, k * (c.hitPower > 1.5 ? 1 : 0.75));
        ctx.drawImage(c.lit, x, y);
        const t = c.tiles[c.hitTile];
        if (t && this.hitGlow) {
          ctx.globalAlpha = Math.min(1, c.hit);
          drawCentered(ctx, this.hitGlow, x + t.x + (this.s >> 1), y + t.y);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      // Küme üzerinde gezinen elektrik arkları
      if (c.hit > 0.15) {
        const t = c.tiles[c.hitTile];
        if (t) {
          const n = c.hitPower > 1.5 ? 6 : 3;
          for (let a = 0; a < n; a++) {
            let ax = x + t.x + (this.s >> 1);
            let ay = y + t.y;
            const dir = a % 2 === 0 ? -1 : 1;
            const len = 4 + Math.floor(Math.random() * (c.w * 0.4));
            for (let i = 0; i < len; i++) {
              const nx = clamp(ax + dir * (1 + Math.round(Math.random())), x, x + c.w - 1);
              const ny = clamp(ay + Math.round((Math.random() - 0.45) * 3), y, y + c.h - 1);
              plotLine(ax, ay, nx, ny, (qx, qy) => this.arcs.add(qx, qy));
              ax = nx;
              ay = ny;
            }
          }
          this.arcs.flush(ctx, '#e6f4ff', Math.min(1, c.hit * 1.2));
        }
      }
    }
    // Tema efektleri tek seferde: alevler (ateş blokları + zincirler) ve gök yıldızları
    this.flame.forEach((b, i) => b.flush(ctx, FLAME[i]!, i === 4 ? 0.7 : 1));
    this.sparkle.flush(ctx, '#ffffff', 0.95);
  }
}
