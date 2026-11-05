import { WheelLayer, type WheelPalette } from '../background/layers/wheel';
import { hamsterRunFrames, RUN_STRIDE } from '../background/layers/hamster';
import type { Frame, Scene } from '../background/scene';
import { ANCHOR_X, ANCHOR_Y } from '../character/hamsterBase';
import { cardArt, pixsyImage } from '../collection/art';
import { FINALE_BONUS } from '../collection/cards';
import './about.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Piksel tuvali: iç çözünürlük küçük, CSS ile tam sayı katına büyütülür (keskin pikseller) */
function pixelCanvas(w: number, h: number, scale: number, cls: string): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = el('canvas', cls);
  c.width = w;
  c.height = h;
  c.style.width = `${w * scale}px`;
  c.style.height = `${h * scale}px`;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/* ------------------------------------------------------------------ Blok küpleri */
const BLOCK = {
  empty: ['#1f2540', '#2d3558', '#121629'],
  gold: ['#ffd84d', '#fff1a8', '#a8740f'],
  // Gerçek Bulut (Squeekchain) renkleri: sahnedeki cyan bulutla aynı
  ice: ['#3fc8e8', '#c8f8ff', '#0c3a5a'],
  iceEmpty: ['#112840', '#2f5878', '#081624'],
} as const;

/** Bulut bloğu: 7x6 yüz + 2 piksel üst yüz + koyu kenar (oyundaki bloklarla aynı his) */
function cube(ctx: CanvasRenderingContext2D, x: number, y: number, kind: keyof typeof BLOCK, glow = 0): void {
  const [face, top, edge] = BLOCK[kind];
  ctx.fillStyle = edge;
  ctx.fillRect(x - 1, y - 1, 9, 10);
  ctx.fillStyle = top;
  ctx.fillRect(x, y, 7, 2);
  ctx.fillStyle = face;
  ctx.fillRect(x, y + 2, 7, 6);
  if (glow > 0) {
    ctx.globalAlpha = glow;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 7, 8);
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ Canlı sahne: çark + bulut */
/**
 * Sitedeki çark aynen (WheelLayer), içinde koşan Squeaksy. Her ~0.7 sn bulutun bir bloğu
 * altına döner ve bir yıldız yükselir; bulut dolunca zincir yanar, beyaz çakar ve baştan başlar.
 */
function heroStage(): { node: HTMLElement; tick: (t: number, dt: number) => void } {
  const W = 164;
  const H = 118;
  const S = 4;
  const node = el('div', 'about__stage');
  const [canvas, ctx] = pixelCanvas(W, H, S, 'about__stage-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'A hamster runs in a golden wheel while a block cloud above fills with gold');
  node.append(canvas);

  const R = 40;
  const groundY = 112;
  const scene = { W, H, u: 0.5, PAD: 0, horizon: groundY, wheel: { cx: 114, cy: groundY - R - 6, R, groundY } } as unknown as Scene;
  const wheel = new WheelLayer();
  wheel.build(scene);
  const frames = hamsterRunFrames('starter', 'pixsy');

  // Bulut kümesi: alt sıra 4, orta 3, tepe 1
  const cells: Array<[number, number]> = [
    [6, 34], [15, 34], [24, 34], [33, 34],
    [10, 25], [19, 25], [28, 25],
    [19, 16],
  ];
  const perBlock = 0.7;
  let filled = 0;
  let acc = 0;
  let flash = 0;
  let phase = 0;
  const pops: Array<{ x: number; y: number; age: number }> = [];

  const star = (x: number, y: number, a: number) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffd84d';
    ctx.fillRect(x - 1, y - 3, 3, 7);
    ctx.fillRect(x - 3, y - 1, 7, 3);
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(x, y - 1, 1, 3);
    ctx.globalAlpha = 1;
  };

  const tick = (t: number, dt: number) => {
    wheel.update(dt, 48 / wheel.innerRadius);
    phase += (Math.abs(wheel.speed) * wheel.innerRadius * dt) / RUN_STRIDE;
    acc += dt;
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (acc >= perBlock) {
      acc = 0;
      if (filled < cells.length) {
        const [x, y] = cells[filled]!;
        filled++;
        pops.push({ x: x + 3, y: y - 2, age: 0 });
      } else {
        filled = 0;
        flash = 1;
      }
    }

    ctx.clearRect(0, 0, W, H);
    // Zincir: bulutun sağ ucundan çarkın tepesine, hafif sarkan piksel halkalar
    const lit = filled === cells.length;
    const [ax, ay] = [41, 39];
    const bx = scene.wheel.cx;
    const by = scene.wheel.cy - R - 2;
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const x = Math.round(ax + (bx - ax) * k);
      const y = Math.round(ay + (by - ay) * k + Math.sin(k * Math.PI) * 7);
      ctx.fillStyle = i % 2 ? (lit ? '#ffd84d' : '#6a5cc8') : lit ? '#a8740f' : '#3b3470';
      ctx.fillRect(x, y, 2, 2);
    }
    cells.forEach(([x, y], i) => cube(ctx, x, y, i < filled ? 'gold' : 'empty', flash * 0.8));
    // Çark + içinde koşan hamster (ön jant hamsteri çerçeveler)
    const f = { t, flash: flash * 0.4, p: { sun: 0 } } as unknown as Frame;
    wheel.draw(ctx, f, scene, () => {
      const fr = frames[Math.floor(phase) % frames.length]!;
      ctx.drawImage(fr.img, Math.round(scene.wheel.cx - ANCHOR_X), Math.round(scene.wheel.cy + wheel.innerRadius - 1 - ANCHOR_Y));
    });
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i]!;
      p.age += dt;
      if (p.age > 1) pops.splice(i, 1);
      else star(p.x, Math.round(p.y - p.age * 12), 1 - p.age);
    }
  };
  return { node, tick };
}

/* ------------------------------------------------------------------ Squeekchain sahnesi: cyan çark + gerçek bulut */
/** Squeekchain çarkı: altın yerine buz mavisi jant (Gerçek Bulut'un renkleri) */
const ICE_WHEEL: WheelPalette = {
  outline: '#0c3a5a',
  hi: '#c8f8ff',
  lo: '#2a9cc8',
  mid: '#3fc8e8',
  shade: '#1f78a8',
  lip: '#0f4a6e',
  back: '#155a80',
  backDeep: '#0a2e48',
  rung: '#2aa8d8',
  rungHi: '#a8f0ff',
  spoke: '#2f5878',
  spokeHi: '#4f8fb8',
  steel: '#143049',
  steelHi: '#24557a',
  steelDeep: '#0a1a2c',
  plate: '#1a3a56',
  plateHi: '#2f5878',
  trim: '#3fc8e8',
  glow: '#7ef9ff',
  spark: '#a8f0ff',
};

/**
 * Üst sahnenin aynası: çark solda, içinde Infernoksy koşar; bulut sağda ve gerçek bulut gibi cyan dolar.
 * Bulut dolunca bloklar "Sepolia'ya iner": cyan şimşek çakar, yıldızlar buluttan yağar, bulut baştan başlar.
 */
function chainStage(): { node: HTMLElement; tick: (t: number, dt: number) => void } {
  const W = 164;
  const H = 118;
  const S = 4;
  const node = el('div', 'about__stage about__stage--chain');
  const [canvas, ctx] = pixelCanvas(W, H, S, 'about__stage-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Infernoksy runs in an ice blue wheel while the Squeekchain cloud fills, then real blocks land as lightning and stars rain down');
  node.append(canvas);

  const R = 40;
  const groundY = 112;
  const scene = { W, H, u: 0.5, PAD: 0, horizon: groundY, wheel: { cx: 50, cy: groundY - R - 6, R, groundY } } as unknown as Scene;
  const wheel = new WheelLayer(ICE_WHEEL);
  wheel.build(scene);
  const frames = hamsterRunFrames('inferno', null);

  // Gerçek bulut kümesi (sağda): alt 4, orta 4 (kaydırılmış), tepe 2 = 10 blok (etiketteki 10 hücre)
  const cells: Array<[number, number]> = [
    [118, 36], [127, 36], [136, 36], [145, 36],
    [122, 27], [131, 27], [140, 27], [149, 27],
    [127, 18], [136, 18],
  ];
  const perBlock = 0.42;
  let filled = 0;
  let acc = 0;
  let strike = 0;
  let flash = 0;
  let phase = 0;
  let bolt: Array<[number, number]> = [];
  const rain: Array<{ x: number; y: number; v: number; age: number }> = [];

  const makeBolt = () => {
    const pts: Array<[number, number]> = [];
    let x = 134;
    for (let y = 46; y <= groundY - 2; y += 6) {
      pts.push([x, y]);
      x += Math.round((Math.random() - 0.5) * 10);
      x = Math.max(116, Math.min(156, x));
    }
    return pts;
  };

  const star = (x: number, y: number, a: number) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffd84d';
    ctx.fillRect(x - 1, y - 3, 3, 7);
    ctx.fillRect(x - 3, y - 1, 7, 3);
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(x, y - 1, 1, 3);
    ctx.globalAlpha = 1;
  };

  const tick = (t: number, dt: number) => {
    wheel.update(dt, 48 / wheel.innerRadius);
    phase += (Math.abs(wheel.speed) * wheel.innerRadius * dt) / RUN_STRIDE;
    if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
    if (strike > 0) {
      strike -= dt;
      if (strike <= 0) filled = 0;
    } else {
      acc += dt;
      if (acc >= perBlock) {
        acc = 0;
        if (filled < cells.length) filled++;
        else {
          // İniş: şimşek + yıldız yağmuru
          strike = 1.1;
          flash = 1;
          bolt = makeBolt();
          for (let i = 0; i < 7; i++) rain.push({ x: 116 + Math.round(Math.random() * 40), y: 44 + Math.random() * 6, v: 26 + Math.random() * 18, age: -i * 0.06 });
        }
      }
    }

    ctx.clearRect(0, 0, W, H);
    // Zincir: bulutun sol ucundan çarkın tepesine (cyan, iniş anında parlar)
    const lit = strike > 0;
    const [ax, ay] = [117, 41];
    const bx = scene.wheel.cx;
    const by = scene.wheel.cy - R - 2;
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const x = Math.round(ax + (bx - ax) * k);
      const y = Math.round(ay + (by - ay) * k + Math.sin(k * Math.PI) * 7);
      ctx.fillStyle = i % 2 ? (lit ? '#c8f8ff' : '#3fc8e8') : lit ? '#7ef9ff' : '#1f78a8';
      ctx.fillRect(x, y, 2, 2);
    }
    // Şimşek (bulutun altından zemine)
    if (strike > 0.55 || (strike > 0 && Math.floor(strike * 20) % 3 === 0)) {
      for (let i = 0; i < bolt.length - 1; i++) {
        const [x0, y0] = bolt[i]!;
        const [x1, y1] = bolt[i + 1]!;
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let j = 0; j <= n; j++) {
          const x = Math.round(x0 + ((x1 - x0) * j) / n);
          const y = Math.round(y0 + ((y1 - y0) * j) / n);
          ctx.fillStyle = '#3fc8e8';
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    cells.forEach(([x, y], i) => cube(ctx, x, y, i < filled ? 'ice' : 'iceEmpty', flash * 0.7));
    const f = { t, flash: flash * 0.3, p: { sun: 0 } } as unknown as Frame;
    wheel.draw(ctx, f, scene, () => {
      const fr = frames[Math.floor(phase) % frames.length]!;
      ctx.drawImage(fr.img, Math.round(scene.wheel.cx - ANCHOR_X), Math.round(scene.wheel.cy + wheel.innerRadius - 1 - ANCHOR_Y));
    });
    for (let i = rain.length - 1; i >= 0; i--) {
      const p = rain[i]!;
      p.age += dt;
      if (p.age < 0) continue;
      p.y += p.v * dt;
      if (p.y > groundY - 3 || p.age > 2.4) rain.splice(i, 1);
      else star(p.x, Math.round(p.y), Math.min(1, 2.4 - p.age));
    }
  };
  return { node, tick };
}

/* ------------------------------------------------------------------ Squeekchain sütun ikonları (piksel) */
/** Küçük piksel halka: merkez, yarıçap, kalınlık için noktalar */
function ringPx(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, filter?: (sin: number) => boolean): void {
  ctx.fillStyle = color;
  const steps = Math.ceil(Math.PI * 2 * r * 2);
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    if (filter && !filter(Math.sin(th))) continue;
    ctx.fillRect(Math.round(cx + Math.cos(th) * r), Math.round(cy + Math.sin(th) * r), 1, 1);
  }
}

/** Gerçek çark: buz mavisi jant, teller, göbek ve stand */
function iconRealWheel(): HTMLCanvasElement {
  const [c, ctx] = pixelCanvas(32, 31, 3, 'about__pillar-art');
  const cx = 16;
  const cy = 14;
  // Stand
  ctx.fillStyle = '#143049';
  for (let i = 0; i < 12; i++) {
    ctx.fillRect(cx - 1 - Math.round(i * 0.55), cy + 2 + i, 1, 1);
    ctx.fillRect(cx + 1 + Math.round(i * 0.55), cy + 2 + i, 1, 1);
  }
  ctx.fillStyle = '#0c3a5a';
  ctx.fillRect(4, 28, 24, 3);
  ctx.fillStyle = '#3fc8e8';
  ctx.fillRect(5, 28, 22, 1);
  ctx.fillStyle = '#c8f8ff';
  [7, 12, 19, 24].forEach((x) => ctx.fillRect(x, 29, 1, 1));
  // Teller
  ctx.fillStyle = '#2f5878';
  for (let k = 0; k < 6; k++) {
    const th = (k / 6) * Math.PI * 2 + 0.3;
    for (let d = 2; d < 10; d++) ctx.fillRect(Math.round(cx + Math.cos(th) * d), Math.round(cy + Math.sin(th) * d), 1, 1);
  }
  // Jant: koyu kenar + cyan gövde + üstte parlama
  ringPx(ctx, cx, cy, 13.4, '#0c3a5a');
  ringPx(ctx, cx, cy, 12.5, '#3fc8e8');
  ringPx(ctx, cx, cy, 11.6, '#3fc8e8');
  ringPx(ctx, cx, cy, 10.7, '#1f78a8');
  ringPx(ctx, cx, cy, 9.8, '#0c3a5a');
  ringPx(ctx, cx, cy, 12.5, '#c8f8ff', (sin) => sin < -0.6);
  ringPx(ctx, cx, cy, 11.6, '#a8f0ff', (sin) => sin < -0.85);
  // Jantın üstünde koşu basamakları
  ctx.fillStyle = '#a8f0ff';
  for (let k = 0; k < 12; k++) {
    const th = (k / 12) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(th) * 12), Math.round(cy + Math.sin(th) * 12), 1, 1);
  }
  // Göbek
  ctx.fillStyle = '#0c3a5a';
  ctx.fillRect(cx - 2, cy - 2, 5, 5);
  ctx.fillStyle = '#7ef9ff';
  ctx.fillRect(cx - 1, cy - 1, 3, 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx, cy - 1, 1, 1);
  // Koşan alevin izi (Infernoksy): jantın dibinde küçük ateş
  ctx.fillStyle = '#e8441c';
  ctx.fillRect(cx - 3, cy + 7, 5, 2);
  ctx.fillStyle = '#ffae42';
  ctx.fillRect(cx - 2, cy + 6, 3, 2);
  ctx.fillStyle = '#fff1a8';
  ctx.fillRect(cx - 1, cy + 6, 1, 1);
  return c;
}

/** Gerçek bloklar: cyan bulut blokları ve altından çakan şimşek (Sepolia'ya iniş) */
function iconRealBlocks(): HTMLCanvasElement {
  const [c, ctx] = pixelCanvas(30, 31, 3, 'about__pillar-art');
  // Piksel şimşek (koyu kenar, cyan gövde, beyaz çekirdek)
  const BOLT = [
    '......####',
    '.....#ooh#',
    '....#ooh#.',
    '...#ooh#..',
    '..#ooo####',
    '.#oohooo#.',
    '.####oh#..',
    '...#oh#...',
    '..#oh#....',
    '..#h#.....',
    '..##......',
  ];
  BOLT.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '.') return;
      ctx.fillStyle = ch === '#' ? '#0c3a5a' : ch === 'h' ? '#ffffff' : '#3fc8e8';
      ctx.fillRect(9 + i, 20 + j, 1, 1);
    }),
  );
  cube(ctx, 2, 10, 'ice');
  cube(ctx, 11, 10, 'ice');
  cube(ctx, 20, 10, 'iceEmpty');
  cube(ctx, 7, 1, 'ice');
  cube(ctx, 16, 1, 'ice');
  return c;
}

/** Piksel yıldız (7x7, koyu kenarlı) */
function bigStar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const rows = [
    '....###....',
    '....#o#....',
    '...#ooo#...',
    '####ohoo###',
    '#oooohooooo#'.slice(0, 11),
    '.#ooooooo#.',
    '..#ooooo#..',
    '..#ooooo#..',
    '.#oo###oo#.',
    '.#o#...#o#.',
    '.##.....##.',
  ];
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '.') return;
      ctx.fillStyle = ch === '#' ? '#8a5a00' : ch === 'h' ? '#ffffff' : j < 5 ? '#fff1a8' : '#ffd84d';
      ctx.fillRect(x + i, y + j, 1, 1);
    }),
  );
}

/** Block Bounty: buluttan yağan yıldızlar */
function iconBounty(): HTMLCanvasElement {
  const [c, ctx] = pixelCanvas(32, 30, 3, 'about__pillar-art');
  // Düşüş izi
  ctx.fillStyle = 'rgba(255, 216, 77, 0.5)';
  [[6, 0, 3], [23, 4, 3], [14, 10, 4]].forEach(([x, y, h]) => ctx.fillRect(x!, y!, 1, h!));
  bigStar(ctx, 1, 3);
  bigStar(ctx, 18, 7);
  bigStar(ctx, 9, 15);
  // Parıltı
  ctx.fillStyle = '#7ef9ff';
  [[28, 2], [3, 26], [26, 25]].forEach(([x, y]) => {
    ctx.fillRect(x! - 1, y!, 3, 1);
    ctx.fillRect(x!, y! - 1, 1, 3);
  });
  return c;
}

const CHAIN_PILLARS = [
  { n: '01', title: 'Real Wheel', text: 'A physical wheel on Squeekchain counts every lap of the real hamster, live.', icon: iconRealWheel },
  { n: '02', title: 'Real Blocks', text: 'Every 10 minute round its work settles on Sepolia. Lightning strikes here when they land.', icon: iconRealBlocks },
  { n: '03', title: 'Bounty', text: 'Hamster running when they land? Get 3 stars per real block, from 25 up to 150.', icon: iconBounty },
];

/* ------------------------------------------------------------------ Sütun ikonları (oyunun kendi pikselleri) */
function iconBlocks(): HTMLCanvasElement {
  const [c, ctx] = pixelCanvas(30, 22, 3, 'about__pillar-art');
  cube(ctx, 2, 12, 'gold');
  cube(ctx, 11, 12, 'gold');
  cube(ctx, 20, 12, 'empty');
  cube(ctx, 7, 3, 'gold');
  cube(ctx, 16, 3, 'empty');
  return c;
}

/** Mini koleksiyon kartı: altın çerçeve + gerçek hamster görseli (küçültülmeden, keskin) */
function iconCard(): HTMLCanvasElement {
  const art = cardArt('hamster');
  const cw = art.width + 8;
  const ch = art.height + 16;
  const [c, ctx] = pixelCanvas(cw + 8, ch + 4, 2, 'about__pillar-art');
  // Arkadaki kart (mor), öndeki kart (altın): koleksiyon hissi
  ctx.fillStyle = '#3b3470';
  ctx.fillRect(8, 0, cw, ch);
  ctx.fillStyle = '#6a5cc8';
  ctx.fillRect(9, 1, cw - 2, ch - 2);
  const ox = 0;
  const oy = 4;
  ctx.fillStyle = '#a8740f';
  ctx.fillRect(ox, oy, cw, ch);
  ctx.fillStyle = '#ffd84d';
  ctx.fillRect(ox + 1, oy + 1, cw - 2, ch - 2);
  ctx.fillStyle = '#1a1424';
  ctx.fillRect(ox + 2, oy + 2, cw - 4, ch - 4);
  ctx.fillStyle = '#2c2440';
  ctx.fillRect(ox + 3, oy + 3, cw - 6, art.height + 2);
  ctx.drawImage(art, ox + 4, oy + 4);
  ctx.fillStyle = '#ffd84d';
  ctx.fillRect(ox + 4, oy + art.height + 8, 14, 2);
  ctx.fillStyle = '#6f6a8a';
  ctx.fillRect(ox + 4, oy + art.height + 11, 9, 1);
  return c;
}

/** Squeekchain amblemi (Pixsy): topluluğun simgesi */
function iconEmblem(): HTMLCanvasElement {
  const img = pixsyImage('pixsy');
  const [c, ctx] = pixelCanvas(img.width, img.height, 3, 'about__pillar-art');
  ctx.drawImage(img, 0, 0);
  return c;
}

const PILLARS = [
  { n: '01', title: 'Run', text: `Each lap fills a block in the clouds. Fill every cloud and a storm pays +${FINALE_BONUS} bonus stars.`, icon: iconBlocks },
  { n: '02', title: 'Collect', text: 'Spend stars on limited hamster cards and Pixsy buddies. Rarer ones earn more per block.', icon: iconCard },
  { n: '03', title: 'Belong', text: 'Made for the Squeekchain community. Sign in with X to keep your stars and cards.', icon: iconEmblem },
];

/**
 * About: tek ekranlık, özlü tanıtım. Solda vizyon, sağda canlı çark sahnesi, altta üç sütun.
 * Sahne sadece bölüm ekrandayken oynar; hareket azaltma tercihinde tek kare.
 */
export function mountAbout(section: HTMLElement): void {
  section.replaceChildren();
  const panel = el('div', 'panel about');

  const hero = el('div', 'about__hero');
  const copy = el('div', 'about__copy');
  const kicker = el('span', 'about__kicker');
  kicker.append(el('i', 'about__kicker-star'), el('span', '', 'About Squeaksy'));
  const title = el('h2', 'about__title');
  title.append(document.createTextNode('Every Spin'), el('br'), document.createTextNode('Builds the '), el('em', '', 'Chain'));
  const lead = el(
    'p',
    'about__lead',
    'Squeaksy is a cozy pixel idle game where hamsters power a chain of block clouds. Your hamster runs, every lap fills a block, and every block pays stars.',
  );
  const actions = el('div', 'about__actions');
  const play = el('a', 'about__cta');
  play.href = '#play';
  play.append(el('i', 'about__cta-play'), el('span', '', 'Start playing'));
  const note = el('p', 'about__note', 'Stars are an in-game score. No wallet, no real money.');
  actions.append(play, note);
  copy.append(kicker, title, lead, actions);

  const stage = heroStage();
  const tag = el('div', 'about__tag');
  tag.append(el('i', 'about__tag-star'), el('span', '', '+1 star / block'));
  stage.node.append(tag);
  hero.append(copy, stage.node);

  const pillarList = (items: typeof PILLARS, cls = '') => {
    const ol = el('ol', `about__pillars${cls}`);
    for (const p of items) {
      const li = el('li', 'about__pillar');
      const art = el('div', 'about__pillar-icon');
      art.append(p.icon());
      const body = el('div', 'about__pillar-body');
      const h = el('h3');
      h.append(el('span', 'about__num', p.n), document.createTextNode(p.title));
      body.append(h, el('p', '', p.text));
      li.append(art, body);
      ol.append(li);
    }
    return ol;
  };
  const pillars = pillarList(PILLARS);

  // --- Alt bölüm: Squeekchain bulutu (üst sahnenin aynası: sahne solda, yazı sağda)
  const chain = el('div', 'about__hero about__hero--chain');
  const cStage = chainStage();
  const cTag = el('div', 'about__tag about__tag--chain');
  cTag.append(el('i', 'about__tag-dot'), el('span', '', 'Live on Sepolia'));
  cStage.node.append(cTag);
  const cCopy = el('div', 'about__copy');
  const cKicker = el('span', 'about__kicker about__kicker--chain');
  cKicker.append(el('i', 'about__kicker-dot'), el('span', '', 'The Squeekchain Cloud'));
  const cTitle = el('h2', 'about__title');
  cTitle.append(document.createTextNode('A Real Hamster'), el('br'), document.createTextNode('Fills the '), el('em', '', 'Cloud'));
  const cLead = el(
    'p',
    'about__lead',
    'The ice blue cloud on the play stage is not filled by us. A real hamster runs a real wheel on Squeekchain, and its blocks settle on Sepolia. When they land, lightning strikes here for everyone on the site.',
  );
  const cNote = el('p', 'about__note', 'Only a running hamster collects. A resting one just watches the stars fall.');
  cCopy.append(cKicker, cTitle, cLead, cNote);
  chain.append(cStage.node, cCopy);
  // Kendi tonundaki bant: sahne + üç sütun birlikte
  const chainWrap = el('div', 'about__chain');
  chainWrap.append(chain, el('div', 'about__ground about__ground--inner'), pillarList(CHAIN_PILLARS, ' about__pillars--chain'));

  panel.append(hero, el('div', 'about__ground'), pillars, el('div', 'about__ground about__ground--chain'), chainWrap);
  section.append(panel);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0;
  for (let i = 0; i < 40; i++) {
    stage.tick((t += 0.08), 0.08);
    cStage.tick(t, 0.08);
  }
  if (reduced) return;
  let timer = 0;
  new IntersectionObserver(([e]) => {
    window.clearInterval(timer);
    if (!e?.isIntersecting) return;
    timer = window.setInterval(() => {
      if (document.hidden) return;
      t += 1 / 24;
      stage.tick(t, 1 / 24);
      cStage.tick(t, 1 / 24);
    }, 1000 / 24);
  }).observe(section);
}
