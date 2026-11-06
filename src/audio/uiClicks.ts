import type { AudioManager } from './AudioManager';

/** Tık sesi çıkaran her şey: butonlar, linkler, sekmeler, kartlar (sitedeki tüm tıklanabilir öğeler) */
const CLICKABLE = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  'summary',
  'label[for]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="submit"]',
  'input[type="button"]',
  'select',
].join(',');

function clickable(t: EventTarget | null): Element | null {
  const el = t instanceof Element ? t.closest(CLICKABLE) : null;
  if (!el || el.matches(':disabled')) return null;
  return el;
}

/**
 * Sitedeki her butona basışta tık sesi (ses açıkken; ses düğmesi kapalıysa sessiz).
 * Gecikme olmasın diye: fare/kalemde basıldığı an (pointerdown) çalar; dokunmatikte kaydırma ile
 * karışmasın diye dokunma bitince (click) çalar; klavyede Enter/Space (click, detail 0) çalar.
 * Tek bir belge dinleyicisi: sonradan eklenen butonlar da kendiliğinden kapsanır.
 */
export function bindUiClicks(audio: AudioManager): void {
  audio.prefetch('ui.click');
  let lastAt = 0;
  let lastPointer = '';
  const fire = () => {
    const now = performance.now();
    // Aynı basışın ikinci olayı (pointerdown + click) iki kez çalmasın
    if (now - lastAt < 80) return;
    lastAt = now;
    const opts = { rate: 0.97 + Math.random() * 0.06 };
    if (audio.canPlay('ui.click')) {
      audio.play('ui.click', opts);
      return;
    }
    // Sayfadaki ilk basış: ses motoru bu basışla açılır; hazır olunca (birkaç ms) tık yine çalar
    if (!audio.isEnabled) return;
    // Motor hemen kurulur; yağmur kaydının yüklenmesi beklenmez, sadece küçük tık dosyası hazırlanır
    void audio.unlock();
    void audio.ready('ui.click').then(() => {
      if (performance.now() - now < 400) audio.play('ui.click', opts);
    });
  };
  document.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = e.pointerType;
      if (e.pointerType === 'touch' || e.button !== 0) return;
      if (clickable(e.target)) fire();
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'click',
    (e) => {
      const keyboard = e.detail === 0;
      if (!keyboard && lastPointer !== 'touch') return;
      if (clickable(e.target)) fire();
    },
    { capture: true, passive: true },
  );
}
