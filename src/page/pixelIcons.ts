/**
 * Piksel ikonlar (menü, leaderboard): her biri küçük bir harita, aynı lacivert dış hat.
 * k = koyu lacivert hat, b = mavi, l = açık mavi, w = beyaz, g = altın, G = açık altın,
 * o = altın gölge, p = mor, P = açık mor, s = gümüş, S = açık gümüş, c = bronz, C = açık bronz, r = kırmızı
 */
const PAL: Record<string, string> = {
  k: '#0f2a6b',
  b: '#2c8ff4',
  l: '#9fe0ff',
  w: '#ffffff',
  g: '#ffc93c',
  G: '#fff1a8',
  o: '#d8961e',
  p: '#6a5cc8',
  P: '#a99cf0',
  s: '#a9b6cc',
  S: '#eef3fb',
  c: '#c27a3a',
  C: '#f0b07a',
  r: '#e2475a',
};

const MAPS = {
  play: [
    '..kkkkkkkkk..',
    '.kbbbbbbbbbk.',
    'kbbkbbbbbwbbk',
    'kbkkkbbbwbwbk',
    'kbbkbbbbbwbbk',
    'kbbbbbbbbbbbk',
    'kbbbkkkkkbbbk',
    'kbbk.....kbbk',
    '.kk.......kk.',
  ],
  cards: [
    '.kkkkkkk..',
    'kbbbbbbbk.',
    'kbwwwwwbkk',
    'kbwwgwwbkp',
    'kbwgggwbkp',
    'kbwwgwwbkp',
    'kbwwwwwbkp',
    'kbbbbbbbkp',
    'kbllllbbkp',
    'kbbbbbbbkp',
    '.kkkkkkkpp',
    '..ppppppp.',
  ],
  market: [
    '...kkkkk...',
    '..kk...kk..',
    '.kkkkkkkkk.',
    'kCcccccccck',
    'kccckkkccck',
    'kcckGggkcck',
    'kcckggokcck',
    'kccckkkccck',
    'kccccccccck',
    '.kkkkkkkkk.',
  ],
  trophy: [
    'kkkkkkkkkkk',
    'kGkGgggggkk',
    'kGkGgggggok',
    '.kkGgggggk.',
    '..kGgggok..',
    '...kgggk...',
    '....kgk....',
    '....kgk....',
    '...kkgkk...',
    '..kGgggok..',
    '..kkkkkkk..',
  ],
  about: [
    '.kkkkk.kkkkk.',
    'kwwwwwkwwwwwk',
    'kwllwwkwwllwk',
    'kwwwwwkwwwwwk',
    'kwllwwkwwllwk',
    'kwwwwwkwwwwwk',
    'kwllwwkwwllwk',
    'kwwwwwkwwwwwk',
    'kbbbbbkbbbbbk',
    '.kkkkkkkkkkk.',
  ],
  gem: [
    '..kkkkkkk..',
    '.kllwllbbk.',
    'kllwllbbbbk',
    'kkkkkkkkkkk',
    '.kbllbbbbk.',
    '..kblbbbk..',
    '...kbbbk...',
    '....kbk....',
    '.....k.....',
  ],
  star: [
    '.....k.....',
    '....kGk....',
    '....kGk....',
    '...kGggk...',
    'kkkkGgggkkk',
    'kGGgggggggk',
    '.kgggggggk.',
    '..kgggggk..',
    '..kggkggk..',
    '.kggk.kggk.',
    '.kkk...kkk.',
  ],
  card: [
    'kkkkkkkk',
    'kbbbbbbk',
    'kbwwwwbk',
    'kbwgwwbk',
    'kbwwwwbk',
    'kbbbbbbk',
    'kbllllbk',
    'kbbbbbbk',
    'kkkkkkkk',
  ],
} as const;

export type PixelIconName = keyof typeof MAPS;

/** Madalya (1 altın, 2 gümüş, 3 bronz): yuvarlak piksel rozet + kurdele; numara CSS ile üstüne yazılır */
const MEDAL = [
  '..kkkkkkk..',
  '.kHHHHHHMk.',
  'kHHFFFFFHMk',
  'kHFFFFFFFMk',
  'kHFFFFFFFMk',
  'kHFFFFFFFMk',
  'kHFFFFFFFMk',
  'kHHFFFFFHMk',
  '.kMMMMMMMk.',
  '..kkkkkkk..',
  '..krk.krk..',
  '.krrk.krrk.',
  '.kkk...kkk.',
];

function paint(map: readonly string[], pal: Record<string, string>, scale: number, cls: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = cls;
  c.width = map[0]!.length;
  c.height = map.length;
  c.style.width = `${c.width * scale}px`;
  c.style.height = `${c.height * scale}px`;
  c.setAttribute('aria-hidden', 'true');
  const ctx = c.getContext('2d')!;
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

export function pixelIcon(name: PixelIconName, scale = 2, cls = 'px-icon'): HTMLCanvasElement {
  return paint(MAPS[name], PAL, scale, cls);
}

export function medalIcon(place: 1 | 2 | 3, scale = 3, cls = 'px-medal'): HTMLCanvasElement {
  const tone =
    place === 1
      ? { H: '#fff1a8', F: '#ffc93c', M: '#d8961e' }
      : place === 2
        ? { H: '#ffffff', F: '#c9d3e3', M: '#8e9ab2' }
        : { H: '#f8c79a', F: '#d98b4a', M: '#9c5a26' };
  return paint(MEDAL, { ...PAL, ...tone }, scale, cls);
}
