import { WheelLayer } from '../background/layers/wheel';
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
const BLOCK = { empty: ['#1f2540', '#2d3558', '#121629'], gold: ['#ffd84d', '#fff1a8', '#a8740f'] } as const;

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

  const pillars = el('ol', 'about__pillars');
  for (const p of PILLARS) {
    const li = el('li', 'about__pillar');
    const art = el('div', 'about__pillar-icon');
    art.append(p.icon());
    const body = el('div', 'about__pillar-body');
    const h = el('h3');
    h.append(el('span', 'about__num', p.n), document.createTextNode(p.title));
    body.append(h, el('p', '', p.text));
    li.append(art, body);
    pillars.append(li);
  }

  panel.append(hero, el('div', 'about__ground'), pillars);
  section.append(panel);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0;
  for (let i = 0; i < 40; i++) stage.tick((t += 0.08), 0.08);
  if (reduced) return;
  let timer = 0;
  new IntersectionObserver(([e]) => {
    window.clearInterval(timer);
    if (!e?.isIntersecting) return;
    timer = window.setInterval(() => {
      if (document.hidden) return;
      t += 1 / 24;
      stage.tick(t, 1 / 24);
    }, 1000 / 24);
  }).observe(section);
}
