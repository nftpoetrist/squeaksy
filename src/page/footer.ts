import { DEFAULT_POSE, drawHamsterPose } from '../character/hamsterBase';

/** Piksel "z" harfi (3x3 / 4x4) */
function z(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillRect(x, y, s, 1);
  for (let i = 1; i < s - 1; i++) ctx.fillRect(x + s - 1 - i, y + i, 1, 1);
  ctx.fillRect(x, y + s - 1, s, 1);
}

/**
 * Footer: alt çizginin üstünde uyuyan Skyeaksy (sırtında ETH Pixsy).
 * Nefes alır (yavaşça şişip iner) ve üstünden küçük "z"ler süzülür. Footer ekrandayken
 * saniyede 6 kare çizilir; hareket azaltma tercihinde tek kare.
 */
export function mountFooter(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('.footer__sleeper');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const breath = [0.9, 1.2].map((squash) => drawHamsterPose({ ...DEFAULT_POSE, squash, headBob: 1, eyes: 'closed', rest: true }, 'sky', 'eth').img);
  const img = breath[0]!;
  const zw = 14;
  const zh = 10;
  canvas.width = img.width + zw;
  canvas.height = img.height + zh;
  const S = 2;
  canvas.style.width = `${canvas.width * S}px`;
  canvas.style.height = `${canvas.height * S}px`;
  ctx.imageSmoothingEnabled = false;

  const draw = (t: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(breath[Math.sin(t * 1.4) > 0 ? 1 : 0]!, 0, zh);
    // İki "z": sırayla yükselir ve solar
    for (let k = 0; k < 2; k++) {
      const p = (t * 0.32 + k * 0.5) % 1;
      const s = k === 0 ? 4 : 3;
      ctx.globalAlpha = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
      ctx.fillStyle = '#2c6fd0';
      z(ctx, Math.round(img.width - 4 + p * 8), Math.round(zh - 2 - p * 10), s);
    }
    // Rare parıltısı: iki küçük piksel yıldız sırayla göz kırpar (pembe + açık mavi)
    const twinkle: Array<[number, number, string, number]> = [
      [1, zh + 3, '#ffb8e0', 0],
      [img.width + 6, zh + img.height - 9, '#9fe6ff', 0.5],
    ];
    for (const [x, y, c, off] of twinkle) {
      const a = Math.max(0, Math.sin((t * 0.9 + off) * Math.PI * 2));
      if (a < 0.2) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = c;
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  };

  let t = 0;
  draw(0.6);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let timer = 0;
  new IntersectionObserver(([e]) => {
    window.clearInterval(timer);
    if (!e?.isIntersecting) return;
    timer = window.setInterval(() => {
      if (document.hidden) return;
      t += 1 / 6;
      draw(t);
    }, 1000 / 6);
  }).observe(root);
}
