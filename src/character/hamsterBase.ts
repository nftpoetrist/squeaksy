/**
 * SQUEAKSY — hamster karakteri (onaylı temel tasarım + poz parametreleri).
 *
 * Anatomi kuralları (her karede aynı):
 *  - Kafa + gövde + yanak keseleri + namlu TEK silüet olarak birleşir (boyun yok),
 *    ardından tek bir yüzey gibi gölgelenir.
 *  - Gövde kısa, geniş ve alçak ("küçük oval patates"); koşarken uzamaz.
 *  - Kafa tam daire değil: alından öne eğimle inen belirgin bir namlu; ucunda pembe
 *    üçgen burun, hemen altında minik ağız; namlunun üstü kürk, altı beyaz.
 *  - Küçük, yuvarlak, pembe içli kulaklar; çok kısa bacaklar; minik pembe patiler.
 *
 * Poz parametreleri sadece konum/küçük yaylanma değiştirir — oranlar sabittir.
 */

import { COMPANION_PALETTE, companionPixels, type PixsyKind } from './companion';

export const HAMSTER_PALETTE = {
  ...COMPANION_PALETTE,
  O: '#3a1c0e', // dış çizgi
  H: '#ffdca3', // kürk parlaması
  L: '#f8bb69', // açık kürk
  F: '#ed9b44', // kürk
  S: '#d47f30', // kürk gölgesi
  D: '#b3611f', // koyu kürk
  W: '#fff8ec', // krem
  C: '#efd9bd', // krem gölgesi
  P: '#ffa6ba', // kulak içi
  Q: '#e5829a', // kulak içi koyu
  K: '#ff92a8', // yanak pembesi / dil
  N: '#ff6f90', // burun
  E: '#1b1020', // göz
  X: '#ffffff', // göz parlaması
  Y: '#fff3a0', // heyecanlı göz parıltısı
  M: '#6a2525', // ağız
  T: '#ffc1cd', // pati
  U: '#e48aa1', // pati koyu
  // --- Varyant renk bantları (başlangıç hamsteri kullanmaz)
  F2: '#ed9b44', // orta bant kürk
  F3: '#ed9b44', // alt bant kürk
  S2: '#d47f30', // alt bant gölge
  // --- Unicorn boynuzu
  hW: '#fffbea',
  hG: '#ffd86e',
  hP: '#ff9ccf',
  // --- Kral tacı
  cH: '#fff6c8',
  cG: '#ffc93c',
  cD: '#b8701a',
  gR: '#ff2a4a',
  gW: '#ffffff',
  // --- Alev deseni
  fO: '#ff8a2a',
  fY: '#ffd23a',
} as const;
export type HamsterColor = keyof typeof HAMSTER_PALETTE;

/**
 * Hamster türleri: aynı anatomi, farklı renk + aksesuar.
 *  starter : onaylı başlangıç hamsteri (Common)
 *  sky     : gökyüzü/bulut renklerinde, unicorn boynuzlu (Rare)
 *  inferno : cehennem kırmızısı, alev desenli, kral taçlı (Legendary)
 *  seraph  : süt beyazı, altın-inci çizgili, iki kafalı (biri geriye bakar), halelli (Mythic)
 */
export type HamsterVariant = 'starter' | 'sky' | 'inferno' | 'seraph';

const VARIANT_COLORS: Record<HamsterVariant, Partial<Record<HamsterColor, string>>> = {
  starter: {},
  sky: {
    O: '#2b2466',
    H: '#ffffff', // bulut beyazı parlama
    L: '#c4ebff', // açık gök
    F: '#86c9ff', // gök mavisi (üst bant)
    F2: '#a996ff', // lavanta (orta bant)
    F3: '#ff9fd2', // gün batımı pembesi (alt bant)
    S: '#6f8ff0',
    S2: '#d27ac0',
    D: '#6a5ad0',
    W: '#fffaff',
    C: '#e9dcff',
    P: '#ffc4e6',
    Q: '#f09ac8',
    K: '#ff9ccf',
    N: '#ff7fb6',
    E: '#1d1450',
    M: '#5a2a6a',
    T: '#ffe0f2',
    U: '#e6a6cc',
    Y: '#bff4ff',
  },
  inferno: {
    O: '#1a0406',
    H: '#ff8a6a', // kızıl parlama
    L: '#f0483e', // açık kızıl
    F: '#c81e2a', // kızıl (orta bant)
    F2: '#8e1020', // koyu kan kırmızısı (üst bant: sırt)
    F3: '#e0342a', // kor kırmızısı (alt bant)
    S: '#6e0a1a',
    S2: '#a8182a',
    D: '#5a0a18',
    W: '#ffd08a', // erimiş krem
    C: '#f09048',
    P: '#ffb03a',
    Q: '#e0702a',
    K: '#ffcf3a',
    N: '#3a0608',
    E: '#200206',
    X: '#ffe46a', // parlayan göz
    Y: '#ffffff',
    M: '#3a0608',
    T: '#ffb07a',
    U: '#c8502a',
  },
  seraph: {
    O: '#33295e', // koyu lavanta dış hat (beyaz silüet net okunsun)
    H: '#ffffff', // ışık
    L: '#f7f4ff', // süt beyazı parlama
    F: '#e9e3fa', // inci beyazı kürk (yanak/göğüs saf beyazından ayrışır)
    F2: '#efc95e', // altın çizgi
    F3: '#fff7dc', // çizginin parlak kenarı
    S: '#c7bce9', // lavanta gölge
    S2: '#d9ad44', // gölgedeki altın çizgi
    D: '#a898d8',
    W: '#ffffff',
    C: '#ebe5fa',
    P: '#ffd9e8',
    Q: '#f2b6cf',
    K: '#ffc9dc',
    N: '#ffa6c2',
    E: '#2a2052',
    X: '#ffffff',
    Y: '#fff6c8',
    M: '#7a4a72',
    T: '#fff0f6',
    U: '#efc0d6',
  },
};

/** Türün tam paleti */
export function variantPalette(v: HamsterVariant): Record<HamsterColor, string> {
  return { ...HAMSTER_PALETTE, ...VARIANT_COLORS[v] };
}

/**
 * Karakter ölçeği: tüm şekil oranları bu katsayıyla ölçeklenir (anatomi aynı kalır).
 * Göz, burun, patiler piksel boyutunu korur → küçük boyda da net okunur.
 */
const K = 0.78;
const S = (v: number) => v * K;
const R = (v: number) => Math.round(v * K);

/** Hareket payı + şapka için üstte boş satırlar */
const OY = 6;
export const BASE_W = Math.ceil(42 * K) + 1;
export const BASE_H = Math.ceil(29 * K) + OY;
/** Ayak tabanı (zemin teması) ve gövde ortası */
export const ANCHOR_X = R(19);
export const ANCHOR_Y = R(25) + OY;

/** Ayak: [dx (ileri +), lift (yerden yükseklik)] */
export type Foot = readonly [number, number];

export interface HamsterPose {
  /** Gövde + kafa dikey kayması (+ aşağı) */
  bob: number;
  /** Kafanın gövdeye göre ek kayması (gecikmeli takip) */
  headBob: number;
  /** Sıkışma (+): gövde biraz basıklaşır ve genişler — taban yerinde kalır */
  squash: number;
  /** Kulakların kafaya göre kayması */
  ear: number;
  /** Sadece yakın kulak (seğirme) */
  earNear: number;
  /** Yanak kesesi zıplaması (ondalıklı, küçük) */
  cheek: number;
  /** Kuyruk kayması */
  tail: number;
  /** Yakın arka, yakın ön, uzak arka, uzak ön */
  feet: readonly [Foot, Foot, Foot, Foot];
  eyes: 'open' | 'closed' | 'half' | 'spark';
  mouth: 'closed' | 'open' | 'pant';
  /** Uyku: patiler gizli, kafa hafif aşağıda */
  rest: boolean;
  /** Sırtta oturan Squeekchain amblem yaratığı */
  companion: boolean;
  /** Yaratığın gövdeye göre gecikmeli zıplaması */
  companionBob: number;
}

export const DEFAULT_POSE: HamsterPose = {
  bob: 0,
  headBob: 0,
  squash: 0,
  ear: 0,
  earNear: 0,
  cheek: 0,
  tail: 0,
  feet: [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ],
  eyes: 'open',
  mouth: 'closed',
  rest: false,
  companion: true,
  companionBob: 0,
};

const inE = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
  const nx = (x + 0.5 - cx) / rx;
  const ny = (y + 0.5 - cy) / ry;
  return nx * nx + ny * ny <= 1;
};

/** Göz bölgesinin sol-üst köşesi (pozdan bağımsız sabit sütunlar, kafa ile kayar) */
export const EYE_RECT = { x: R(27), w: 3, h: 5 };

export function hamsterPixels(
  pose: HamsterPose = DEFAULT_POSE,
  variant: HamsterVariant = 'starter',
  buddy: PixsyKind = 'pixsy',
): (HamsterColor | null)[][] {
  const W = BASE_W;
  const H = BASE_H;
  const g: (HamsterColor | null)[][] = Array.from({ length: H }, () => new Array<HamsterColor | null>(W).fill(null));
  const set = (x: number, y: number, c: HamsterColor) => {
    if (x >= 0 && y >= 0 && x < W && y < H) g[y]![x] = c;
  };
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? g[y]![x]! : null);

  const Y = OY + pose.bob; // gövde
  const HY = Y + pose.headBob; // kafa grubu
  const sq = pose.squash;

  // ---------------------------------------------------------------- 1) silüet
  const body = (x: number, y: number) => inE(x, y, S(17), S(16.4) + Y + sq, S(13.6) + sq * 0.6, S(8.4) - sq);
  const head = (x: number, y: number) => inE(x, y, S(25), S(12.4) + HY, S(9.2), S(7.3));
  const bridge = (x: number, y: number) => inE(x, y, S(31), S(12.8) + HY, S(5.8), S(4.6));
  const cheek = (x: number, y: number) => inE(x, y, S(29.4), S(16.2) + HY + pose.cheek, S(5.2), S(4));
  const snout = (x: number, y: number) => inE(x, y, S(35.2), S(14.2) + HY, S(3.6), S(2.4));
  const mask = (x: number, y: number) => body(x, y) || head(x, y) || bridge(x, y) || cheek(x, y) || snout(x, y);

  const top = new Array<number>(W).fill(H);
  const bottom = new Array<number>(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (!mask(x, y)) continue;
      top[x] = Math.min(top[x]!, y);
      bottom[x] = Math.max(bottom[x]!, y);
    }
  }
  const left = new Array<number>(H).fill(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask(x, y)) left[y] = Math.min(left[y]!, x);

  // ---------------------------------------------------------------- 2) kürk gölgelemesi
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask(x, y)) continue;
      const dTop = y - top[x]!;
      const dBot = bottom[x]! - y;
      const dLeft = x - left[y]!;
      let c: HamsterColor = 'F';
      if (dTop === 0) c = x > R(6) && x < R(31) ? 'H' : 'L';
      else if (dTop <= 2) c = 'L';
      if (dLeft <= 1 && dTop > 1) c = 'S';
      if (dBot <= 1) c = 'S';
      if (dBot === 0 && x < R(8)) c = 'D';
      set(x, y, c);
    }
  }
  // Kalça hattı
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!body(x, y)) continue;
      const cy = S(20) + Y;
      if (inE(x, y, S(9.5), cy, S(4.6), S(4)) && !inE(x, y, S(9.5), cy, S(4.6) - 1, S(4) - 1) && y < cy && x > R(6) && x < R(13)) set(x, y, 'S');
    }
  }
  // Sırtta kürk tutamları
  for (const x of [9, 13, 17, 21].map(R)) set(x, top[x]! + 1, 'H');

  // ---------------------------------------------------------------- 3) krem bölgeler
  for (let x = R(7); x <= R(27); x++) {
    const from = bottom[x]! - 2 + (x % 3 === 0 ? 1 : 0);
    for (let y = from; y <= bottom[x]!; y++) {
      if (!body(x, y)) continue;
      set(x, y, y === bottom[x]! ? 'C' : 'W');
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask(x, y) && inE(x, y, S(24), S(20.4) + Y, S(3.6), S(2.6))) set(x, y, 'W');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (cheek(x, y) && y >= R(13) + HY) set(x, y, y >= R(18) + HY ? 'C' : 'W');
      if ((snout(x, y) || inE(x, y, S(32.4), S(14.8) + HY, S(3.2), S(2.2))) && mask(x, y) && y >= R(14) + HY) set(x, y, y >= R(16) + HY && x > R(34) ? 'C' : 'W');
    }
  }
  for (let x = R(31); x <= R(38) + 1; x++) {
    const t = top[x]!;
    if (t < H) set(x, t, 'L');
  }

  // ---------------------------------------------------------------- 3b) tür renk bantları + desenler
  if (variant !== 'starter') {
    // Kürk yukarıdan aşağı üç banda ayrılır; bant geçişlerinde piksel dither
    const band = (x: number, y: number) => {
      const yy = y - Y;
      const d = (x + y) & 1;
      return yy < 9 - d ? 0 : yy < 13 - d ? 1 : 2;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = get(x, y);
        if (!mask(x, y) || (c !== 'F' && c !== 'S')) continue;
        const b = band(x, y);
        if (variant === 'seraph') {
          // Sırtta ritmik, hafif eğik altın şeritler (çizgi çizgi); karın/yanaklar saf beyaz kalır
          if (b === 2) continue;
          const k = (x + Math.floor((y - Y) / 2)) % 5;
          if (k === 0) set(x, y, c === 'F' ? 'F2' : 'S2');
          else if (k === 1 && c === 'F' && b === 0) set(x, y, 'F3');
          continue;
        }
        if (variant === 'sky') {
          // gök mavisi → lavanta → gün batımı pembesi
          if (c === 'F') set(x, y, b === 0 ? 'F' : b === 1 ? 'F2' : 'F3');
          else if (b === 2) set(x, y, 'S2');
        } else {
          // sırt koyu kızıl → kızıl → kor
          if (c === 'F') set(x, y, b === 0 ? 'F2' : b === 1 ? 'F' : 'F3');
          else if (b === 2) set(x, y, 'S2');
        }
      }
    }
    if (variant === 'seraph') {
      // çizgiler yeterli: sırtta ek desen yok
    } else if (variant === 'sky') {
      // Sırtta küçük bulut tutamları
      for (const x of [16, 20]) {
        const t = top[x]!;
        set(x, t, 'H');
        set(x - 1, t + 1, 'H');
        set(x, t + 1, 'H');
        set(x + 1, t + 1, 'L');
      }
    } else {
      // Yanlarda yukarı kıvrılan alev desenleri (kor → turuncu → sarı uç)
      for (const [x, len] of [
        [8, 4],
        [12, 5],
        [16, 4],
        [20, 3],
      ] as const) {
        const b0 = bottom[x]! - 3;
        for (let i = 0; i < len; i++) {
          const y = b0 - i;
          const xx = x + Math.floor(i / 2);
          if (!body(xx, y)) break;
          set(xx, y, i >= len - 1 ? 'fY' : i >= len - 2 ? 'fO' : 'fO');
          if (i < len - 2 && body(xx + 1, y)) set(xx + 1, y, i === 0 ? 'fY' : 'fO');
        }
      }
    }
  }

  // ---------------------------------------------------------------- 4) sırttaki yaratık
  if (pose.companion) {
    const cp = companionPixels('mini', buddy);
    const cw = cp[0]!.length;
    const ch = cp.length;
    // Sırtın arka-üst kısmına oturur: tabanı sırt kürküne 1 piksel gömülü
    const seatX = R(10);
    const cx0 = seatX - Math.floor(cw / 2);
    const cy0 = top[seatX]! + 1 - (ch - 1) + pose.companionBob;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const c = cp[y]![x];
      if (c) set(cx0 + x, cy0 + y, c);
    }
  }

  // ---------------------------------------------------------------- 5) kulaklar (daima tam görünür)
  const ear = (cx: number, cy: number, r: number, far: boolean) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!inE(x, y, cx, cy, r, r) || mask(x, y)) continue;
        const inner = inE(x, y, cx + 0.2, cy + 0.5, r - 1.2, r - 1.2);
        set(x, y, inner ? (far ? 'Q' : 'P') : far ? 'S' : 'F');
      }
    }
  };
  ear(S(20.4), S(6) + HY + pose.ear, 2.3, true);
  ear(S(26.7), S(4.1) + HY + pose.ear + pose.earNear, 2.5, false);

  // ---------------------------------------------------------------- 6) yüz
  const ey = R(8) + HY; // göz bölgesinin üst satırı
  const gx = EYE_RECT.x; // göz sütunları: gx..gx+2
  if (pose.eyes === 'closed') {
    set(gx, ey + 3, 'E');
    set(gx + 1, ey + 3, 'E');
    set(gx + 2, ey + 3, 'E');
    set(gx + 1, ey + 4, 'S');
  } else {
    for (let y = ey + 1; y <= ey + 3; y++) for (let x = gx; x <= gx + 2; x++) set(x, y, 'E');
    set(gx + 1, ey + 4, 'E');
    set(gx + 1, ey, 'E');
    set(gx, ey + 1, pose.eyes === 'spark' ? 'Y' : 'X');
    if (pose.eyes === 'spark') set(gx + 2, ey + 3, 'X');
    if (pose.eyes === 'half') {
      set(gx + 1, ey, 'S');
      set(gx, ey + 1, 'S');
      set(gx + 1, ey + 1, 'S');
      set(gx + 2, ey + 1, 'S');
      set(gx, ey + 2, 'X');
    }
  }
  const ck = Math.round(pose.cheek);
  set(gx + 3, R(15) + HY + ck, 'K');
  set(gx + 4, R(15) + HY + ck, 'K');
  // Burun ve ağız
  const nx = R(38); // namlu ucu
  const ny = R(13) + HY;
  set(nx - 1, ny, 'N');
  set(nx, ny, 'N');
  set(nx, ny + 1, 'N');
  if (pose.mouth === 'closed') {
    set(nx - 1, ny + 2, 'M');
  } else {
    set(nx - 2, ny + 2, 'M');
    set(nx - 1, ny + 2, 'M');
    set(nx - 2, ny + 3, 'K');
    if (pose.mouth === 'pant') set(nx - 1, ny + 3, 'K');
  }
  set(nx - 3, ny + 2, 'C');
  set(nx - 4, ny + 3, 'C');

  // ---------------------------------------------------------------- 6) patiler (zemine sabit) + kuyruk
  const groundY = R(25) + OY;
  const solid = (x: number, y: number) => mask(x, y);
  const foot = (bx: number, f: Foot, cols: readonly HamsterColor[], stub: HamsterColor | null) => {
    const [dx, lift] = f;
    const fy = groundY - lift;
    cols.forEach((c, i) => set(bx + dx + i, fy, c));
    // Kısa bacak: patiden gövdeye kadar (en fazla 2 piksel) — asla kopuk değil
    if (stub) {
      for (let y = fy - 1; y >= fy - 2; y--) {
        const x = bx + dx + 1;
        if (solid(x, y)) break;
        set(x, y, stub);
        if (cols.length > 2) set(x + 1, y, stub);
      }
    }
  };
  if (!pose.rest) {
    const [nb, nf, fb, ff] = pose.feet;
    foot(R(13), fb, ['U', 'U'], 'D');
    foot(R(22), ff, ['U', 'U'], 'D');
    foot(R(8), nb, ['T', 'T', 'U'], 'S');
    foot(R(25), nf, ['T', 'T', 'U'], 'F');
  } else {
    // Uykuda: göğse toplanmış minik ön pati
    set(R(26), groundY, 'T');
    set(R(26) + 1, groundY, 'U');
  }
  set(R(2), R(15) + Y + pose.tail, 'S');
  set(R(2), R(16) + Y + pose.tail, 'S');

  // ---------------------------------------------------------------- 7) kabarık kürk uçları
  for (const [x, y, c] of [
    [R(27), R(20) + HY, 'C'],
    [R(30), R(20) + HY, 'C'],
    [R(33), R(18) + HY, 'C'],
  ] as const) {
    if (!get(x, y)) set(x, y, c);
  }

  // ---------------------------------------------------------------- 7b) aksesuarlar (dış çizgiden önce: çizgi onları da çevreler)
  if (variant === 'sky') {
    // Unicorn boynuzu: alından ileri-yukarı uzanan sarmal (krem / altın / pembe)
    // Gözün hemen üstü, yakın kulağın önü
    const bx = R(29);
    const hb = top[bx]!;
    for (let i = 0; i < 9; i++) {
      const y = hb - i;
      const x = bx + Math.floor(i / 2);
      // Sarmal: çapraz şeritler (her satırda renk bir kayar)
      const a: HamsterColor = i % 3 === 0 ? 'hP' : i % 3 === 1 ? 'hW' : 'hG';
      const b: HamsterColor = i % 3 === 0 ? 'hW' : i % 3 === 1 ? 'hG' : 'hP';
      set(x, y, a);
      if (i < 7) set(x - 1, y, b);
      if (i < 3) set(x + 1, y, a === 'hW' ? 'hG' : 'hW');
    }
    set(bx + 4, hb - 9, 'hW'); // parlayan uç
  } else if (variant === 'seraph') {
    // Hale sprite'ta değil: üst kafanın üstünde efekt katmanında süzülür (HamsterAura)
  } else if (variant === 'inferno') {
    // Kral tacı: kafanın tepesinde, üç sivri uç + kırmızı mücevherler
    const cx0 = R(18);
    const base = Math.min(top[cx0]!, top[cx0 + 3]!, top[cx0 + 6]!) - 1;
    const rows = ['G..G..G', 'GG.G.GG', 'GGGGGGG', 'GRGWGRG', 'DDDDDDD'];
    rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        const c: HamsterColor = ch === 'R' ? 'gR' : ch === 'W' ? 'gW' : ch === 'D' ? 'cD' : r === 0 ? 'cH' : 'cG';
        set(cx0 + i, base - (rows.length - 1) + r, c);
      }
    });
    set(cx0 + 1, base - 2, 'cH'); // taç parlaması
  }

  // ---------------------------------------------------------------- 8) kalın dış çizgi
  const out: Array<[number, number]> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (get(x, y)) continue;
      if (get(x - 1, y) || get(x + 1, y) || get(x, y - 1) || get(x, y + 1)) out.push([x, y]);
    }
  }
  for (const [x, y] of out) set(x, y, 'O');
  if (variant === 'seraph') {
    twinHead(g, HY);
    // Melek kanadı: sırtta, yukarı ve geriye açılır (Pixsy takılıysa onun arkasında kalır)
    const WING = [
      'O..........',
      'HO.........',
      'HHO....O...',
      'GHHO..OHO..',
      'OGHHOOHHHO.',
      '.OGHHHHHHHO',
      '.OGGHHHHHHO',
      '..OGGGHHHHO',
      '...OOOGGHO.',
      '......OOO..',
    ];
    const wx0 = 1;
    const wbase = top[7]! + 5;
    WING.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        const tx = wx0 + i;
        const ty = wbase - (WING.length - 1) + r;
        if (tx < 0 || ty < 0 || tx >= BASE_W || ty >= BASE_H) continue;
        // Sırt kürkünün ve boşluğun üstüne çizilir; yüzler, krem ve Pixsy korunur
        const cur = g[ty]![tx];
        if (cur && !['F', 'F2', 'F3', 'S', 'S2', 'L', 'H', 'D', 'O'].includes(cur)) continue;
        g[ty]![tx] = ch === 'O' ? 'O' : ch === 'H' ? 'H' : 'F2';
      }
    });
  }
  return g;
}

/**
 * Seraphoksy'nin ikinci kafası: ön kafa bölgesinin kopyası, biraz geride ve yukarıda, o da öne bakar.
 * Ön kafanın üstüne çizilir ama ön kafanın yüzü (göz, burun, yanak) korunur: iki yüz de tam görünür.
 * Pozla birlikte hareket eder (kafa sallanması, göz kırpma, uyku).
 */
export const TWIN = { dx: -4, dy: -7 } as const;
function twinHead(g: (HamsterColor | null)[][], HY: number): void {
  const W = BASE_W;
  const H = BASE_H;
  const X0 = 14; // ön kafa bölgesi: bu sütundan sağa
  const yMax = HY + 13; // ve bu satırdan yukarı
  const faceX = 19; // ön kafanın korunan yüzü
  const faceY = HY + 5;
  const src = g.map((r) => r.slice());
  for (let y = 0; y <= yMax && y < H; y++) {
    for (let x = X0; x < W; x++) {
      const c = src[y]![x];
      if (!c) continue;
      const tx = x + TWIN.dx;
      const ty = y + TWIN.dy;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      if (src[ty]![tx] && tx >= faceX && ty >= faceY) continue;
      // Sırttaki Pixsy her zaman önde kalır
      const under = src[ty]![tx];
      if (under && under in COMPANION_PALETTE) continue;
      g[ty]![tx] = c;
    }
  }
}

/** Sırttaki Pixsy'nin sprite içindeki kutusu (tıklama alanı için; varsayılan pozdan) */
let buddyBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
export function companionBounds(): { x0: number; y0: number; x1: number; y1: number } {
  if (buddyBox) return buddyBox;
  const g = hamsterPixels(DEFAULT_POSE);
  const keys = new Set<string>(Object.keys(COMPANION_PALETTE));
  let x0 = BASE_W;
  let y0 = BASE_H;
  let x1 = -1;
  let y1 = -1;
  g.forEach((row, y) =>
    row.forEach((k, x) => {
      if (!k || !keys.has(k)) return;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }),
  );
  buddyBox = { x0, y0, x1, y1 };
  return buddyBox;
}

export interface HamsterFrame {
  img: HTMLCanvasElement;
  /** Gözün sol-üst köşesi (göz kırpma katmanı için); kapalı gözde null */
  eye: readonly [number, number] | null;
}

export function drawHamsterPose(pose: HamsterPose = DEFAULT_POSE, variant: HamsterVariant = 'starter', buddy: PixsyKind = 'pixsy'): HamsterFrame {
  const px = hamsterPixels(pose, variant, buddy);
  const pal = variantPalette(variant);
  const c = document.createElement('canvas');
  c.width = BASE_W;
  c.height = BASE_H;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < BASE_H; y++) {
    for (let x = 0; x < BASE_W; x++) {
      const k = px[y]![x];
      if (!k) continue;
      ctx.fillStyle = pal[k];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return { img: c, eye: pose.eyes === 'closed' ? null : [EYE_RECT.x, R(8) + OY + pose.bob + pose.headBob] };
}
