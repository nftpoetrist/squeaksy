import type { AudioManager } from '../audio/AudioManager';

/** 13×11 piksel hoparlör: 1 koyu kenar, 2 gövde, 3 parlak; w = ses dalgası, x = kapalı işareti */
const ON = [
  '.....1.......',
  '....12.....w.',
  '...122..w...w',
  '1111222..w..w',
  '1332222..w..w',
  '1322222..w..w',
  '1322222..w..w',
  '1111222..w..w',
  '...122..w...w',
  '....12.....w.',
  '.....1.......',
];
const OFF = [
  '.....1.......',
  '....12.......',
  '...122.......',
  '1111222.x...x',
  '1332222..x.x.',
  '1322222...x..',
  '1322222..x.x.',
  '1111222.x...x',
  '...122.......',
  '....12.......',
  '.....1.......',
];
const COLORS: Record<string, string> = { '1': '#5a3210', '2': '#ffc93c', '3': '#fff6c8', w: '#fff6c8', x: '#d8961e' };

function drawIcon(canvas: HTMLCanvasElement, on: boolean): void {
  const map = on ? ON : OFF;
  canvas.width = map[0]!.length;
  canvas.height = map.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = COLORS[row[x]!];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

const KEY = 'squeaksy.sound';

function loadPref(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function savePref(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* gizli pencere vb.: tercih sadece bu oturumda geçerli */
  }
}

/**
 * Oyun panelinin sağ üstünde, yıldız sayacının hemen solunda ses aç/kapa düğmesi.
 * Tarayıcılar kullanıcı etkileşimi olmadan ses çaldırmaz: tercih "açık" kaydedildiyse ses,
 * sayfadaki ilk tıklama / tuş ile başlar.
 */
export function mountSoundToggle(stage: HTMLElement, hud: HTMLElement, audio: AudioManager): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sound-toggle';
  const icon = document.createElement('canvas');
  icon.className = 'sound-toggle__icon';
  icon.setAttribute('aria-hidden', 'true');
  btn.append(icon);
  stage.appendChild(btn);

  let on = loadPref();
  const render = () => {
    drawIcon(icon, on);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Mute rain and thunder' : 'Play calm rain and thunder');
    btn.title = on ? 'Sound on: soft rain and distant thunder' : 'Sound off';
  };
  render();
  audio.setEnabled(on);

  btn.addEventListener('click', async () => {
    on = !on;
    savePref(on);
    render();
    await audio.unlock();
    audio.setEnabled(on);
    // Ses açıldı: onay tıkı (kapalıyken basışta tık çalamazdı)
    if (on) void audio.ready('ui.click').then(() => audio.play('ui.click'));
  });

  // Sayacın solunda, dikeyde ortalı (sayaç genişliği yıldız sayısıyla değişir)
  const place = () => {
    const sr = stage.getBoundingClientRect();
    const hr = hud.getBoundingClientRect();
    if (!hr.width) return;
    btn.style.right = `${Math.round(sr.right - hr.left + 8)}px`;
    btn.style.top = `${Math.round(hr.top - sr.top + (hr.height - btn.offsetHeight) / 2)}px`;
  };
  new ResizeObserver(place).observe(hud);
  window.addEventListener('resize', place);
  // Sayaç yer değiştirdi (ör. yanına Claim butonu geldi): boyutu değişmese de yeniden hizala
  window.addEventListener('squeaksy:hud', place);
  place();
}
