import { COMPANION_PALETTE, companionPixels, type CompanionSize } from './companion';
import { BASE_H, BASE_W, DEFAULT_POSE, drawHamsterPose, HAMSTER_PALETTE } from './hamsterBase';

const views = document.getElementById('views')!;

function tileOf(src: HTMLCanvasElement, scale: number, caption: string, sky = false): void {
  const fig = document.createElement('figure');
  const tile = document.createElement('div');
  tile.className = sky ? 'tile sky' : 'tile';
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  c.style.width = `${src.width * scale}px`;
  c.style.height = `${src.height * scale}px`;
  tile.appendChild(c);
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  fig.append(tile, cap);
  views.appendChild(fig);
}

function companionCanvas(size: CompanionSize): HTMLCanvasElement {
  const px = companionPixels(size);
  const c = document.createElement('canvas');
  c.width = px[0]!.length;
  c.height = px.length;
  const ctx = c.getContext('2d')!;
  px.forEach((row, y) =>
    row.forEach((k, x) => {
      if (!k) return;
      ctx.fillStyle = COMPANION_PALETTE[k];
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return c;
}

const withBuddy = drawHamsterPose(DEFAULT_POSE).img;
void BASE_W;
void BASE_H;

tileOf(companionCanvas('full'), 8, 'Emblem (exact) ×8');
tileOf(companionCanvas('mini'), 14, 'Buddy ×14');
tileOf(withBuddy, 12, 'Hamster + buddy ×12');
tileOf(withBuddy, 6, 'Card ×6', true);
tileOf(withBuddy, 3, 'In-game ×3', true);

const pal = document.getElementById('palette')!;
for (const [k, v] of Object.entries(HAMSTER_PALETTE)) {
  const d = document.createElement('div');
  d.className = 'sw';
  d.style.background = v;
  d.title = `${k} ${v}`;
  pal.appendChild(d);
}

// --- Türler: Rare (sky) ve Legendary (inferno)
import('./hamsterBase').then(({ drawHamsterPose: draw, DEFAULT_POSE: P }) => {
  const plain = { ...P, companion: false };
  tileOf(draw(plain, 'starter').img, 10, 'Squeaksy (Common) ×10', true);
  tileOf(draw(plain, 'sky').img, 10, 'Skyeaksy (Rare) ×10', true);
  tileOf(draw(plain, 'inferno').img, 10, 'Infernoksy (Legendary) ×10', true);
  tileOf(draw({ ...P, eyes: 'closed', rest: true, squash: 1, headBob: 1, companion: false }, 'sky').img, 6, 'Skyeaksy asleep ×6', true);
  tileOf(draw({ ...P, eyes: 'closed', rest: true, squash: 1, headBob: 1, companion: false }, 'inferno').img, 6, 'Infernoksy asleep ×6', true);
});

// --- Seraphoksy (Mythic, tasarım önizlemesi): ışık efektli canlı kare + düz sprite + uyku + Pixsy ile
Promise.all([import('./hamsterBase'), import('../background/layers/hamsterFx')]).then(([hb, fx]) => {
  const plain = { ...hb.DEFAULT_POSE, companion: false };
  const img = hb.drawHamsterPose(plain, 'seraph').img;
  // Canlı: oyundaki gibi koyu zeminde, efektler 'lighter' ile
  const W = img.width + 30;
  const H = img.height + 22;
  const live = document.createElement('canvas');
  live.width = W;
  live.height = H;
  const ctx = live.getContext('2d')!;
  const aura = new fx.HamsterAura('seraph');
  const ox = 15;
  const oy = 12;
  const fig = document.createElement('figure');
  const tile = document.createElement('div');
  tile.className = 'tile sky';
  live.style.width = `${W * 10}px`;
  live.style.height = `${H * 10}px`;
  live.style.imageRendering = 'pixelated';
  tile.appendChild(live);
  const cap = document.createElement('figcaption');
  cap.textContent = 'Seraphoksy (Mythic) live ×10';
  fig.append(tile, cap);
  views.prepend(fig);
  let t = 0;
  const frame = () => {
    t += 1 / 30;
    aura.update(1 / 30, ox + hb.ANCHOR_X, oy + img.height * 0.55, 1);
    ctx.fillStyle = '#121d4a';
    ctx.fillRect(0, 0, W, H);
    aura.drawBehind(ctx, img, ox, oy, false, t, 1);
    ctx.drawImage(img, ox, oy);
    aura.drawFront(ctx);
  };
  setInterval(frame, 1000 / 30);
  tileOf(img, 10, 'Seraphoksy ×10', true);
  tileOf(hb.drawHamsterPose({ ...hb.DEFAULT_POSE }, 'seraph', 'pixsy').img, 8, 'Seraphoksy + Pixsy ×8', true);
  tileOf(hb.drawHamsterPose({ ...hb.DEFAULT_POSE, eyes: 'closed', rest: true, squash: 1, headBob: 1, companion: false }, 'seraph').img, 6, 'Seraphoksy asleep ×6', true);
});

// --- Pixsy türleri: Common · ETH (Rare) · BTC (Legendary)
import('./companion').then(({ companionPixels: px, COMPANION_PALETTE: pal }) => {
  const draw = (size: CompanionSize, kind: 'pixsy' | 'eth' | 'btc') => {
    const g = px(size, kind);
    const c = document.createElement('canvas');
    c.width = g[0]!.length;
    c.height = g.length;
    const ctx = c.getContext('2d')!;
    g.forEach((row, y) =>
      row.forEach((k, x) => {
        if (!k) return;
        ctx.fillStyle = pal[k];
        ctx.fillRect(x, y, 1, 1);
      }),
    );
    return c;
  };
  for (const k of ['pixsy', 'eth', 'btc'] as const) tileOf(draw('full', k), 9, `${k.toUpperCase()} Pixsy ×9`, true);
  for (const k of ['pixsy', 'eth', 'btc'] as const) tileOf(draw('mini', k), 12, `${k.toUpperCase()} mini ×12`, true);
});
