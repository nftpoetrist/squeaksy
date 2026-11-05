/**
 * Akıcı sayfa kaydırma. Tarayıcının kendi "smooth" kaydırması çok sert başlayıp (tek karede yüzlerce
 * piksel) uzun bir kuyrukla bitiyor; bu da takılıyormuş gibi hissettiriyor. Burada mesafeye göre süre
 * seçilir, yumuşak başlayıp yumuşak biten bir eğriyle her karede (rAF) ilerlenir.
 * Kullanıcı tekerlek/dokunma/klavye ile müdahale ederse kaydırma hemen bırakılır.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let active = 0;
let cancelActive: (() => void) | null = null;

/** Yumuşak başla, ortada akıcı, yumuşak dur */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function maxScroll(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

/** Sayfayı verilen dikey konuma akıcı şekilde kaydırır; bitince (ya da bırakılınca) çözülür. */
export function smoothScrollTo(top: number): Promise<void> {
  cancelActive?.();
  const target = Math.round(Math.min(maxScroll(), Math.max(0, top)));
  const from = window.scrollY;
  const dist = target - from;
  if (Math.abs(dist) < 2 || reduced.matches) {
    window.scrollTo({ top: target, behavior: 'instant' });
    return Promise.resolve();
  }
  // Kısa mesafe hızlı, uzun mesafe biraz daha uzun ama hiç sürünmez (420–900 ms)
  const dur = Math.min(900, Math.max(420, 300 + Math.sqrt(Math.abs(dist)) * 12));
  return new Promise((resolve) => {
    const start = performance.now();
    const stop = () => {
      cancelAnimationFrame(active);
      active = 0;
      cancelActive = null;
      for (const ev of INTERRUPT) window.removeEventListener(ev, stop);
      resolve();
    };
    const INTERRUPT = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    for (const ev of INTERRUPT) window.addEventListener(ev, stop, { passive: true });
    cancelActive = stop;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      window.scrollTo({ top: from + dist * ease(k), behavior: 'instant' });
      if (k < 1) active = requestAnimationFrame(step);
      else stop();
    };
    active = requestAnimationFrame(step);
  });
}

/** Elemana akıcı kaydırma. `start`: sabit menünün altına hizalar (scroll-padding-top), `center`: ekran ortası. */
export function smoothScrollToEl(el: HTMLElement, block: 'start' | 'center' = 'start'): Promise<void> {
  const r = el.getBoundingClientRect();
  if (block === 'center') return smoothScrollTo(window.scrollY + r.top - (window.innerHeight - r.height) / 2);
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  return smoothScrollTo(window.scrollY + r.top - pad);
}

/**
 * Sayfa içi bağlantılar (#collection, #market…) bu kaydırmayla gider. Leaderboard sayfasına giriş/çıkış
 * hash yönlendirmesine bırakılır (orada sayfa değişir, kaydırma yok).
 */
export function bindAnchorScroll(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    if (!(a instanceof HTMLAnchorElement)) return;
    const hash = a.hash;
    if (!hash || hash === '#leaderboard' || document.body.classList.contains('is-page-lb')) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return;
    e.preventDefault();
    if (location.hash !== hash) history.pushState(null, '', hash);
    void smoothScrollToEl(el);
  });
}
