/**
 * Squeekchain amblem yaratığı — hamstere eşlik eden küçük arkadaş (sırtında oturur).
 *
 * FULL: referans görselin BİREBİR piksel kopyası. Kaynak 27×27 noktalı LED matrisi
 * (nokta aralığı 14.6 px); her nokta örneklenip sınıflandırıldı → 1 nokta = 1 piksel.
 * MINI: aynı görselin birebir küçültülmüş hali (13×9) — sırttaki yaratık.
 *
 *   # siyah (10,10,12)   o altın (250,191,73)   . boş (görseldeki mavi zemin)
 */

export const COMPANION_PALETTE = {
  cK: '#0a0a0c', // amblem siyahı
  cG: '#fabf49', // amblem altını
  // --- ETH Pixsy (Rare): Ethereum mor-mavisi + elmas
  eK: '#1a1846', // kenar / göz (gece laciverti)
  eB: '#6f86ee', // gövde
  eH: '#9fb0ff', // gövde ışığı
  eS: '#4f63c8', // gövde gölgesi
  eA: '#ffffff', // elmas: ışıklı yüz
  eL: '#d4dcff', // elmas: açık yüz
  eM: '#2c2f8a', // elmas: koyu yüz
  // --- BTC Pixsy (Legendary): Bitcoin turuncusu + ₿
  bK: '#3a1604', // kenar / göz
  bB: '#f7931a', // gövde
  bH: '#ffbf4d', // gövde ışığı
  bS: '#c8680a', // gövde gölgesi
  bW: '#ffffff', // ₿ işareti
  bY: '#fff1c2', // ₿ parlaması
  bR: '#e0282e', // kırmızı detay (kulak içi, yan çizgiler, boynuzlar)
  bD: '#8e1018', // koyu kırmızı (çizgi gölgesi, boynuz dibi)
  bL: '#ff7a5e', // boynuz ışığı
  bO: '#ff6a1e', // alev turuncusu
  bF: '#ffd23a', // alev sarısı
} as const;

/**
 * BTC Pixsy'nin şeytan boynuzları: ₿'nin üstteki iki çizgisiyle aynı hizada başlar,
 * kafadan yukarı uzanır, uçları dışa kıvrılır (₿'nin çizgileri boynuza dönüşmüş gibi).
 * [x, y, renk] — y, boynuz boşluğu eklenmiş haritaya göredir.
 */
const LEFT_HORN: Record<CompanionSize, Array<[number, number, 'R' | 'D' | 'L']>> = {
  // dipte kalın (₿'nin sol çizgisi hizasında), dışa açılıp yukarı kıvrılan sivri uç
  full: [
    [9, 9, 'D'], [10, 9, 'D'],
    [9, 8, 'R'], [10, 8, 'R'],
    [8, 7, 'L'], [9, 7, 'R'], [10, 7, 'R'],
    [7, 6, 'L'], [8, 6, 'R'], [9, 6, 'R'],
    [6, 5, 'L'], [7, 5, 'R'], [8, 5, 'D'],
    [6, 4, 'L'], [7, 4, 'R'],
    [6, 3, 'R'],
    [6, 2, 'L'],
  ],
  mini: [
    [5, 4, 'D'],
    [4, 3, 'R'], [5, 3, 'R'],
    [4, 2, 'R'],
    [3, 1, 'R'],
    [3, 0, 'L'],
  ],
};
/** Sağ boynuz: sol boynuzun aynası */
const BTC_HORNS: Record<CompanionSize, Array<[number, number, 'R' | 'D' | 'L']>> = {
  full: [...LEFT_HORN.full, ...LEFT_HORN.full.map(([x, y, c]) => [22 - x, y, c] as [number, number, 'R' | 'D' | 'L'])],
  mini: [...LEFT_HORN.mini, ...LEFT_HORN.mini.map(([x, y, c]) => [12 - x, y, c] as [number, number, 'R' | 'D' | 'L'])],
};

/**
 * BTC Pixsy'nin kırmızı detayları: kulak içleri + iki yanda yukarı kıvrılan yarış çizgileri.
 * [x, y, renk]; sadece gövde pikselinin üstüne boyanır (silüet değişmez).
 */
const BTC_ACCENTS: Record<CompanionSize, Array<[number, number, 'R' | 'D']>> = {
  full: [
    // kulak içleri
    [4, 1, 'R'], [5, 1, 'R'], [6, 2, 'R'], [17, 1, 'R'], [18, 1, 'R'], [16, 2, 'R'],
    // sol yan çizgiler (alttan yukarı kıvrılır)
    [1, 10, 'D'], [2, 9, 'R'], [3, 8, 'R'], [1, 11, 'R'], [2, 12, 'R'], [3, 11, 'R'], [4, 10, 'R'], [3, 13, 'D'],
    // sağ yan çizgiler (ayna)
    [21, 10, 'D'], [20, 9, 'R'], [19, 8, 'R'], [21, 11, 'R'], [20, 12, 'R'], [19, 11, 'R'], [18, 10, 'R'], [19, 13, 'D'],
    // ₿ altında ince kırmızı çizgi
    [8, 13, 'R'], [9, 13, 'R'], [10, 13, 'R'], [11, 13, 'R'], [12, 13, 'R'], [13, 13, 'R'], [14, 13, 'R'],
  ],
  mini: [
    [3, 1, 'R'], [9, 1, 'R'],
    [1, 6, 'R'], [2, 5, 'R'], [2, 7, 'D'],
    [11, 6, 'R'], [10, 5, 'R'], [10, 7, 'D'],
  ],
};

/** Pixsy türleri: Squeekchain amblemi (Common) · ETH (Rare) · BTC (Legendary) */
export type PixsyKind = 'pixsy' | 'eth' | 'btc';

/**
 * Semboller ('.' = dokunma). pad: haritanın üstüne eklenen boş satır (boynuz için yer).
 * ETH: logo, kafanın tepesinde iki kulağın arasından yükselen bir boynuz.
 * BTC: ₿, gözlerin arasında (FULL: sütun 9-13 · MINI: sütun 5-7).
 */
const SYMBOLS: Record<Exclude<PixsyKind, 'pixsy'>, Record<CompanionSize, { x: number; y: number; pad: number; rows: string[] }>> = {
  eth: {
    // Ethereum logosu boynuz gibi: ince uç, uzun üst elmas, bel çizgisi, alt V — tabanı kafaya oturur
    full: { x: 9, y: 0, pad: 8, rows: ['..A..', '..A..', '.AAL.', '.AAL.', 'AAALL', '.MML.', '..M..', 'A...L', '.AAL.', '..A..'] },
    mini: { x: 5, y: 0, pad: 4, rows: ['.A.', 'AAL', 'AML', '.M.'] },
  },
  btc: {
    // ₿: B harfi + üstte ve altta iki dikey çizgi (üsttekiler boynuzlarla hizalı)
    full: { x: 9, y: 11, pad: 8, rows: ['.W.W.', 'WWWY.', 'W...W', 'W...W', 'WWWW.', 'W...W', 'W...W', 'WWWW.', '.W.W.'] },
    mini: { x: 5, y: 5, pad: 4, rows: ['.W.', 'WW.', 'W.W', 'WW.', 'W.W', 'WW.', '.W.'] },
  },
};
export type CompanionColor = keyof typeof COMPANION_PALETTE;

/** Görselden okunan nokta haritası (mavi zemin kırpıldı) — birebir */
export const EMBLEM_FULL = [
  '.....###.......###.....',
  '....#ooo#.....#ooo#....',
  '...#ooooo#####ooooo#...',
  '...#ooooooooooooooo#...',
  '..#ooooooooooooooooo#..',
  '..#oooo#ooooooo#oooo#..',
  '..#ooo###ooooo###ooo#..',
  '..#ooo###ooooo###ooo#..',
  '.#oooo###ooooo###oooo#.',
  '#ooooo###ooooo###ooooo#',
  '#ooooo###ooooo###ooooo#',
  '#oooooo#ooooooo#oooooo#',
  '.#ooooooooooooooooooo#.',
  '..##ooooooooooooooo##..',
  '....##ooooooooooo##....',
  '......###########......',
] as const;

/**
 * Sırttaki küçük yaratık: referans görselin sarı amblemi OLDUĞU GİBİ küçültüldü (13×9).
 * Görselin yüksek çözünürlüklü pikselleri alan ortalamasıyla örneklendi ve her hücre
 * en yakın renge (altın / siyah / boş) atandı — elle çizim değil, birebir küçültme.
 */
export const EMBLEM_MINI = [
  '..###...###..',
  '.##oo###oo##.',
  '.#ooooooooo#.',
  '.#o##ooo##o#.',
  '.#o##ooo##o#.',
  '#oo##ooo##oo#',
  '#ooo#ooo#ooo#',
  '.##ooooooo##.',
  '..#########..',
] as const;

export type CompanionSize = 'mini' | 'full';

export function companionMap(size: CompanionSize): readonly string[] {
  return size === 'full' ? EMBLEM_FULL : EMBLEM_MINI;
}

/**
 * Piksel haritası (null = boş). Common Pixsy referans amblemin birebir kopyasıdır;
 * ETH/BTC aynı silüeti kendi renkleriyle (ışık/gölge) boyar ve gözlerin arasına sembol koyar.
 */
export function companionPixels(size: CompanionSize = 'mini', kind: PixsyKind = 'pixsy'): (CompanionColor | null)[][] {
  const base = companionMap(size);
  if (kind === 'pixsy') return base.map((row) => [...row].map((ch) => (ch === '#' ? 'cK' : ch === 'o' ? 'cG' : null)));
  const sym = SYMBOLS[kind][size];
  // Boynuz için haritanın üstüne boş satırlar
  const map = [...Array.from({ length: sym.pad }, () => '.'.repeat(base[0]!.length)), ...base];
  const p = kind === 'eth' ? 'e' : 'b';
  const K = `${p}K` as CompanionColor;
  const B = `${p}B` as CompanionColor;
  const Hc = `${p}H` as CompanionColor;
  const Sc = `${p}S` as CompanionColor;
  const at = (x: number, y: number) => map[y]?.[x] ?? '.';
  const g = map.map((row, y) =>
    [...row].map((ch, x): CompanionColor | null => {
      if (ch === '#') return K;
      if (ch !== 'o') return null;
      // Üstü kenar olan gövde pikselleri ışık, altı kenar olanlar gölge
      if (at(x, y - 1) !== 'o') return Hc;
      if (at(x, y + 1) !== 'o') return Sc;
      return B;
    }),
  );
  if (kind === 'btc') {
    // Kırmızı detaylar alev şeritleri gibi: kırmızı / sarı dönüşümlü (kulak içleri sarı-turuncu)
    const ear = size === 'full' ? 2 : 1;
    for (const [x, y] of BTC_ACCENTS[size]) {
      const yy = y + sym.pad;
      if (map[yy]?.[x] !== 'o') continue;
      const c = y <= ear ? (x % 2 ? 'bF' : 'bO') : (x + y) % 2 === 0 ? 'bR' : 'bF';
      g[yy]![x] = c as CompanionColor;
    }
    // Boynuzlar: dipte koyu kırmızı → kırmızı/turuncu şeritler → sarı uç (alev gibi)
    const tipRows = size === 'full' ? 3 : 1;
    const baseRow = size === 'full' ? 8 : 3;
    for (const [x, y] of BTC_HORNS[size]) {
      if (!g[y] || x < 0 || x >= g[y]!.length || g[y]![x]) continue;
      const c = y >= baseRow + 1 ? 'bD' : y <= tipRows - 1 ? 'bF' : y % 2 === 0 ? 'bO' : 'bR';
      g[y]![x] = c as CompanionColor;
    }
  }
  sym.rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx];
      if (ch === '.') continue;
      const key = `${p}${ch}` as CompanionColor;
      if (key in COMPANION_PALETTE) g[sym.y + dy]![sym.x + dx] = key;
    }
  });
  return g;
}
