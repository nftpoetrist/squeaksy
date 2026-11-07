import type { TokenLedger } from '../auth/ledger';
import type { PixelStormBackground } from '../background/Background';
import { DAILY_BLOCK_CAP } from '../collection/cards';

/** 11×11 piksel yıldız ikonu (oyunun para birimi): 1 koyu kenar, 2 gövde, 3 parlak, 4 gölge */
const STAR = [
  '.....1.....',
  '....131....',
  '....131....',
  '...12321...',
  '11112222111',
  '13322222241',
  '.122222241.',
  '..1222241..',
  '..1224221..',
  '.12441.141.',
  '.111...111.',
];
const COLORS: Record<string, string> = { '1': '#5a3210', '2': '#ffc93c', '3': '#fff6c8', '4': '#d8961e' };

function drawStar(canvas: HTMLCanvasElement): void {
  canvas.width = STAR.length;
  canvas.height = STAR.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  STAR.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = COLORS[row[x]!];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

/**
 * Oyun çerçevesinin sağ üstündeki token sayacı. Gösterilen sayı = profil bakiyesi −
 * henüz yolda olan coinler; böylece her coin sayaca vardığı anda sayı bir artar.
 * Giriş yapılmamışken "Sign in with X to earn" der ve tıklanınca girişi başlatır.
 */
export function mountTokenHud(
  stage: HTMLElement,
  bg: PixelStormBackground,
  ledger: TokenLedger,
  signIn: () => void,
): { refresh: () => void } {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'token-hud';
  el.innerHTML = `<canvas class="token-hud__coin" aria-hidden="true"></canvas>
    <span class="token-hud__text">
      <span class="token-hud__count" aria-live="polite">0</span>
      <span class="token-hud__sub"></span>
    </span>`;
  stage.appendChild(el);
  const coin = el.querySelector<HTMLCanvasElement>('.token-hud__coin')!;
  const count = el.querySelector<HTMLSpanElement>('.token-hud__count')!;
  const sub = el.querySelector<HTMLSpanElement>('.token-hud__sub')!;
  drawStar(coin);

  const fmt = new Intl.NumberFormat('en-US');
  const bump = () => {
    el.classList.remove('is-bump');
    void el.offsetWidth; // animasyonu yeniden başlat
    el.classList.add('is-bump');
  };
  const refresh = () => {
    const signedIn = ledger.signedIn;
    el.classList.toggle('is-guest', !signedIn);
    el.disabled = signedIn;
    el.title = signedIn ? `Stars: ${ledger.perBlock} per completed block, +10 when every cloud is full` : 'Sign in with X to earn stars';
    const s = bg.chainStatus;
    el.classList.toggle('is-surge', s.phase === 'charge');
    if (!signedIn) {
      count.textContent = '';
      sub.textContent = 'Sign in with X to earn';
      return;
    }
    count.textContent = ledger.loaded ? fmt.format(Math.max(0, Math.floor(ledger.total - bg.coinsInFlight + 1e-6))) : '…';
    el.classList.toggle('is-capped', ledger.capped);
    if (ledger.capped) {
      sub.textContent = 'Daily limit reached';
      el.title = `Daily limit: ${fmt.format(DAILY_BLOCK_CAP)} blocks. Stars start again at 00:00 UTC.`;
      return;
    }
    sub.textContent = s.phase === 'charge' ? 'Storm surge!' : `Cloud ${Math.min(s.clouds + 1, s.totalClouds)} / ${s.totalClouds}`;
  };
  // Coinlerin uçacağı nokta: ikonun merkezi (sahneye göre)
  // Panel gizliyken (Leaderboard sayfası) ölçüm 0×0 çıkar: o zaman eski hedef korunur,
  // yoksa coinler sol üst köşeye (gökyüzünün soluna) uçar.
  const place = () => {
    const r = coin.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || sr.width === 0 || sr.height === 0) return;
    bg.setTokenTarget(r.left - sr.left + r.width / 2, r.top - sr.top + r.height / 2);
  };

  el.addEventListener('click', () => {
    if (!ledger.signedIn) signIn();
  });
  bg.events.on('token:collect', () => {
    refresh();
    bump();
  });
  bg.events.on('chain:cloud', refresh);
  bg.events.on('chain:finale', refresh);
  bg.events.on('scene:resize', place);
  ledger.onChange(refresh);
  window.addEventListener('resize', place);
  window.addEventListener('squeaksy:page', () => requestAnimationFrame(place));
  // Sayaç genişleyince/daralınca (giriş, büyüyen sayı, font yüklenmesi) ikon yer değiştirir: hedef de güncellenir
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    ro.observe(stage);
  }
  void document.fonts?.ready.then(place);
  place();
  refresh();
  return { refresh };
}
