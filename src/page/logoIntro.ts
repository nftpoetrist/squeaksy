/**
 * Site açılışı (navbar): logo küçük bir çarka dönüşür, içinde minik hamster koşar.
 * Çark döndükçe "SQUEAKSY" yazısı soldan sağa beyazdan altın sarısına boyanır ve
 * parlar. Yazı tamamen boyanınca hamster çarktan zıplar, yazının üstünden geçer ve
 * son harfin (Y) hemen sağında kıvrılıp uyur.
 */

const LOGO = 20; // çark tuvali (iç piksel)
const W = LOGO;
const H = LOGO;
const CX = 9.5;
const CY = 9.5;
/** Yazının tamamen boyanması için gereken tur sayısı */
const TURNS = 3;

const PAL: Record<string, string> = {
  L: '#f8bb69',
  F: '#ed9b44',
  S: '#d47f30',
  D: '#b3611f',
  W: '#fff8ec',
  E: '#1b1020',
  N: '#ff6f90',
  T: '#ffc1cd',
};

// Minik hamster (8×6, sağa bakar)
const BODY = ['....LL..', '..LLLLL.', '.LFFFFEL', 'DFFFFWWN', 'DSFWWWW.'];
const RUN_A = [...BODY, '.T...T..'];
const RUN_B = [...BODY, '..T.T...'];
const SLEEP = ['........', '....LL..', '..LLLLL.', '.LFFFFDL', 'DFFFFWWN', 'DSSWWWW.'];
/** Hamsterin çarktaki yeri (sol-üst) */
const HOME = { x: 6, y: 8 };

type Phase = 'run' | 'brake' | 'hop' | 'sleep';
/** Zıplama/uyku katmanı: piksel ölçeği ve logonun üstündeki boşluk (CSS px) */
const FLY_SCALE = 2;
const FLY_PAD = 14;
const HOP_TIME = 0.9;

function sprite(ctx: CanvasRenderingContext2D, rows: string[], x0: number, y0: number): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PAL[row[x]!];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x0) + x, Math.round(y0) + y, 1, 1);
    }
  });
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, 1, 1);
}

/** Çark: dış halka (üstü açık altın), iç kenar, dönen parmaklıklar, göbek */
function drawWheel(ctx: CanvasRenderingContext2D, angle: number, glow: number): void {
  for (let y = 0; y < LOGO; y++) {
    for (let x = 0; x < LOGO; x++) {
      const d = Math.hypot(x - CX, y - CY);
      if (d > 9.6) continue;
      if (d > 8.5) px(ctx, x, y, '#1f3050');
      else if (d > 6.6) px(ctx, x, y, y < 9 ? (glow > 0.5 ? '#fff0a0' : '#ffe07a') : '#e0a040');
      else if (d > 5.7) px(ctx, x, y, '#1f3050');
    }
  }
  // 4 parmaklık (8 kol), çarkla birlikte döner
  for (let k = 0; k < 4; k++) {
    const a = angle + (k * Math.PI) / 4;
    for (let r = -5.4; r <= 5.4; r += 0.5) {
      px(ctx, Math.round(CX - 0.5 + Math.cos(a) * r), Math.round(CY - 0.5 + Math.sin(a) * r), '#52d8f8');
    }
  }
  ctx.fillStyle = '#1f3050';
  ctx.fillRect(8, 8, 3, 3);
  px(ctx, 9, 9, '#ffe07a');
}

/** Sabit (dönmeyen) çark logosu: alt navbar vb. için */
export function drawStaticWheel(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = LOGO;
  canvas.height = LOGO;
  drawWheel(ctx, Math.PI / 8, 0);
}

/** simulateTo: yalnızca test — animasyonu o saniyeye kadar anında ileri sarar */
export function mountLogoIntro(canvas: HTMLCanvasElement, word: HTMLElement, opts: { simulateTo?: number } = {}): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = W;
  canvas.height = H;
  canvas.classList.add('nav__logo--intro');
  word.classList.add('nav__word');

  // Çarktan Y'nin yanına zıplama ve uyku: marka alanını örten şeffaf piksel katman
  const brand = canvas.parentElement!;
  brand.classList.add('nav__brand--intro');
  const fly = document.createElement('canvas');
  fly.className = 'nav__fly';
  fly.setAttribute('aria-hidden', 'true');
  brand.appendChild(fly);
  const fctx = fly.getContext('2d')!;
  const from = { x: 0, y: 0 };
  const to = { x: 0, y: 0 };
  /** Katmanı marka alanına göre boyutlar; çıkış (çark) ve varış ("S" altı) noktalarını hesaplar */
  const layoutFly = () => {
    const br = brand.getBoundingClientRect();
    // Sağda Y'nin yanındaki uyku yeri + "z"ler için pay
    const cw = Math.ceil((br.width + 44) / FLY_SCALE);
    const ch = Math.ceil((br.height + FLY_PAD + 26) / FLY_SCALE);
    fly.width = cw;
    fly.height = ch;
    fly.style.width = `${cw * FLY_SCALE}px`;
    fly.style.height = `${ch * FLY_SCALE}px`;
    fly.style.top = `${-FLY_PAD}px`;
    const lr = canvas.getBoundingClientRect();
    const k = lr.width / LOGO; // logo pikseli → CSS
    from.x = (lr.left - br.left + HOME.x * k) / FLY_SCALE;
    from.y = (lr.top - br.top + FLY_PAD + HOME.y * k) / FLY_SCALE;
    // Son harfin (Y) kutusu: hamster onun hemen sağında, yazının tabanında uyur
    const text = word.firstChild;
    let sx = br.width;
    let sb = br.height * 0.75;
    if (text && text.textContent) {
      const r = document.createRange();
      const n = text.textContent.length;
      r.setStart(text, n - 1);
      r.setEnd(text, n);
      const sr = r.getBoundingClientRect();
      sx = sr.right - br.left + 3;
      sb = sr.bottom - br.top - 4; // harf tabanı (satır boşluğu hariç)
    }
    to.x = Math.round(sx / FLY_SCALE);
    to.y = Math.round((sb + FLY_PAD) / FLY_SCALE) - 6;
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let phase: Phase = 'run';
  let t = 0; // faz süresi
  let total = 0;
  let angle = 0;
  let omega = 0;
  let fill = 0;
  let legs = 0;
  let glow = 0;
  let last = 0;
  let raf = 0;
  let watchdog = 0;
  let zzzTimer = 0;
  let startZzz: (() => void) | null = null;

  const setWord = () => {
    word.style.setProperty('--fill', `${(fill * 100).toFixed(1)}%`);
    word.style.setProperty('--glow', glow.toFixed(3));
  };

  const drawSleep = (time: number) => {
    // Çark boş, durgun
    ctx.clearRect(0, 0, W, H);
    drawWheel(ctx, angle, 0);
    // Y'nin yanında uyuyan hamster + sağına doğru yükselen minik "z"ler
    fctx.clearRect(0, 0, fly.width, fly.height);
    sprite(fctx, SLEEP, to.x, to.y);
    for (let i = 0; i < 2; i++) {
      const k = (time * 0.3 + i / 2) % 1;
      const zx = Math.round(to.x + 8 + k * 3);
      const zy = Math.round(to.y + 1 - k * 6);
      fctx.globalAlpha = 1 - k * 0.7;
      fctx.fillStyle = '#2c6fd0';
      // 3×4 piksel "z" (oyundaki uyku harfleriyle aynı)
      fctx.fillRect(zx, zy, 3, 1);
      fctx.fillRect(zx + 1, zy + 1, 1, 1);
      fctx.fillRect(zx, zy + 2, 1, 1);
      fctx.fillRect(zx, zy + 3, 3, 1);
      fctx.globalAlpha = 1;
    }
  };

  const finish = () => {
    if (phase === 'sleep') return;
    window.clearTimeout(watchdog);
    if (phase !== 'hop') layoutFly();
    phase = 'sleep';
    fill = 1.02;
    glow = 0.45;
    word.classList.add('is-lit');
    setWord();
    cancelAnimationFrame(raf);
    // Uyku: "z"ler düşük kare hızında (neredeyse sıfır maliyet)
    const t0 = performance.now();
    drawSleep(0);
    startZzz = () => {
      window.clearInterval(zzzTimer);
      zzzTimer = window.setInterval(() => {
        if (!document.hidden) drawSleep((performance.now() - t0) / 1000);
      }, 160);
    };
    startZzz();
    // Pencere boyutu değişince uyku yeri "S"nin altında kalsın
    window.addEventListener('resize', () => {
      layoutFly();
      drawSleep((performance.now() - t0) / 1000);
    });
  };

  if (reduced) {
    finish();
    return;
  }


  /** Bir adım ilerletir ve çizer; animasyon bittiyse false döner */
  const step = (dt: number): boolean => {
    t += dt;
    total += dt;

    if (phase === 'run') {
      // Kısa bekleme, sonra ivmelenir
      const target = total < 0.35 ? 0 : Math.PI * 2 * 1.05;
      omega += (target - omega) * Math.min(1, dt * 3);
      angle += omega * dt;
      fill = Math.min(1, angle / (Math.PI * 2 * TURNS));
      glow = fill * 0.6;
      if (fill >= 1) {
        phase = 'brake';
        t = 0;
      }
    } else if (phase === 'brake') {
      omega *= Math.exp(-dt * 6);
      angle += omega * dt;
      // Yazı tamamlanınca kısa bir parlama nabzı
      glow = 0.6 + 0.6 * Math.sin(Math.min(1, t / 0.5) * Math.PI);
      if (t > 0.55) {
        phase = 'hop';
        t = 0;
        layoutFly();
      }
    } else if (phase === 'hop') {
      // Çarktan zıplar, yazının altına süzülür
      omega *= Math.exp(-dt * 7);
      angle += omega * dt;
      glow = 0.45 + 0.15 * (1 - Math.min(1, t / HOP_TIME));
      if (t >= HOP_TIME) {
        finish();
        return false;
      }
    }
    legs += omega * dt * 1.6;
    setWord();

    ctx.clearRect(0, 0, W, H);
    drawWheel(ctx, angle, phase === 'brake' ? glow - 0.6 : 0);
    const run = Math.floor(legs) % 2 === 0 ? RUN_A : RUN_B;
    if (phase === 'hop') {
      const k = Math.min(1, t / HOP_TIME);
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 11;
      fctx.clearRect(0, 0, fly.width, fly.height);
      sprite(fctx, k < 0.8 ? RUN_A : SLEEP, x, y);
    } else {
      // Koşarken minik zıplama
      const bob = omega > 1 && Math.floor(legs * 2) % 2 === 0 ? -1 : 0;
      sprite(ctx, run, HOME.x, HOME.y + bob);
    }
    return true;
  };

  const frame = (now: number) => {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    if (step(dt)) raf = requestAnimationFrame(frame);
  };

  setWord();
  if (opts.simulateTo !== undefined) {
    for (let s = 0; s < opts.simulateTo; s += 1 / 60) if (!step(1 / 60)) return;
    return;
  }
  step(0); // ilk kare hemen çizilsin (logo boş görünmesin)
  raf = requestAnimationFrame(frame);
  // Güvenlik: tarayıcı bekleyen kareyi düşürse bile (sekme dondurma, geri/ileri önbelleği)
  // açılış takılı kalmasın; en geç 12 sn'de yazı altın ve hamster uykuda olur.
  watchdog = window.setTimeout(finish, 12_000);
  const resume = () => {
    if (document.hidden) return;
    if (phase === 'sleep') {
      startZzz?.();
      return;
    }
    cancelAnimationFrame(raf);
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
  document.addEventListener('resume', resume);
  window.addEventListener('pagehide', () => window.clearInterval(zzzTimer));
}
