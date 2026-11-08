/**
 * "Connect wallet" penceresi: kullanıcının referans görselindeki mavi el konsolunun AYNISI.
 * Konsol kodla çizilen temiz piksel sanatı (walletConsoleArt.ts, 218 × 166; ölçü ve renkler referanstan),
 * keskin büyütülür. Başlık, SELECT / BACK ve A / B gerçek yazıdır; hamster göz kırpar, parıltılar yanıp söner.
 * Yalnızca liste paneli canlıdır: bulunan cüzdanlar (satır görünümü referanstan ölçüldü), WalletConnect, QR.
 * Görseldeki tuşların üstünde görünmez gerçek butonlar var:
 *   yön tuşu yukarı/aşağı (ve klavye okları) satır seçer, A / sağ / Enter bağlanır, B / sol / BACK / Esc geri döner,
 *   SELECT sıradaki satıra geçer, X kapatır. Basılan tuş görselde kararır.
 * Cüzdan logoları sade ve olduğu gibi gösterilir: zemin, çerçeve, yuvarlak kesim yok.
 */
import qrcode from 'qrcode-generator';
import { ART_H, ART_W, HAMSTER_AT, HAMSTER_H, HAMSTER_W, drawConsole, drawHamster, drawSparkle, prewarmConsole } from './walletConsoleArt';

/** Panel açılmadan önce çizimleri hazırla (walletButton boşta çağırır) */
export function prewarm(): void {
  prewarmConsole();
  for (let i = 0; i < 2; i++) sparkCache[i] ??= drawSparkle();
}
import { detectedWallets, onWalletsChange, type DetectedWallet } from '../wallet/eip6963';
import { walletErrorText, type WalletManager } from '../wallet/wallet';
import { pixelIcon } from './pixelIcons';
import { walletLogo } from './walletLogo';

let closeOpen: (() => void) | null = null;
const sparkCache: HTMLCanvasElement[] = [];

const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

/** WalletConnect bağlantısını açan telefon uygulamaları (evrensel bağlantılar) */
const APP_LINKS: Array<[string, (u: string) => string]> = [
  ['MetaMask', (u) => `https://metamask.app.link/wc?uri=${encodeURIComponent(u)}`],
  ['Trust Wallet', (u) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(u)}`],
  ['Rainbow', (u) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(u)}`],
];

/** Konsoldaki tuşların yeri (konsol hücresi, 218 × 166): [sol, üst, genişlik, yükseklik, biçim] */
const HITS = {
  up: [22, 55, 11, 12, 'up'],
  down: [22, 77, 11, 9, 'down'],
  left: [13, 67, 9, 11, 'left'],
  right: [33, 67, 9, 11, 'right'],
  select: [17, 97, 22, 9, 'pill'],
  back: [17, 109, 22, 9, 'pill'],
  a: [191, 60, 16, 16, 'round'],
  b: [177, 75, 16, 16, 'round'],
  close: [192, 28, 11, 10, 'square'],
} as const;
/** Gerçek yazılar: [sol, üst, genişlik, yükseklik, yazı, sınıf] */
const TEXTS: Array<[number, number, number, number, string, string]> = [
  [64, 30, 90, 14, 'Connect wallet', 'wcon__title'],
  [19, 98, 18, 7, 'Select', 'wcon__label'],
  [19, 110, 18, 7, 'Back', 'wcon__label'],
  [192, 61, 15, 15, 'A', 'wcon__letter'],
  [178, 76, 15, 15, 'B', 'wcon__letter'],
];
/** Liste paneli (konsolda koyu alan) */
const PANEL = { x: 51, y: 46, w: 117, h: 100 };
/** Parıltılar (konsolun üstünde, yanıp söner) */
const SPARKS: Array<[number, number, number]> = [
  [56, 6, 0],
  [150, 7, 0.9],
];

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Piksel QR: lacivert modüller, açık buz zemin, 4 modül sessiz alan */
function qrCanvas(text: string): HTMLCanvasElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const pad = 4;
  const c = el('canvas', 'wallet-qr__code');
  c.width = c.height = n + pad * 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e6efff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#0f2a6b';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect(col + pad, r + pad, 1, 1);
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', 'WalletConnect QR code');
  return c;
}

export interface WalletModalOptions {
  /** Test: QR görünümünü bu bağlantıyla doğrudan aç (?dev&wcUri=…) */
  demoUri?: string;
}

export function openWalletModal(wallet: WalletManager, opts: WalletModalOptions = {}): void {
  closeOpen?.();
  const back = el('div', 'px-modal wconsole-back');
  const root = el('div', 'wcon');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'wallet-modal-title');
  root.tabIndex = -1;

  const place = (e: HTMLElement, x: number, y: number, w: number, h: number) =>
    Object.assign(e.style, { left: pct(x, ART_W), top: pct(y, ART_H), width: pct(w, ART_W), height: pct(h, ART_H) });
  const art = drawConsole();
  const hamFrames = [drawHamster(false), drawHamster(true)];
  const hamster = el('span', 'wcon__hamster-box');
  hamster.append(hamFrames[0]!);
  place(hamster, HAMSTER_AT.x, HAMSTER_AT.y, HAMSTER_W, HAMSTER_H);
  const sparks = SPARKS.map(([x, y, delay], i) => {
    const s = (sparkCache[i] ??= drawSparkle());
    s.style.animationDelay = `${delay}s`;
    place(s, x, y, 9, 9);
    return s;
  });
  const texts = TEXTS.map(([x, y, w, h, text, cls]) => {
    const t = el(cls === 'wcon__title' ? 'h3' : 'span', cls, text);
    if (cls === 'wcon__title') t.id = 'wallet-modal-title';
    else t.setAttribute('aria-hidden', 'true');
    place(t, x, y, w, h);
    return t;
  });
  // Hamster ara sıra göz kırpar
  let blinkTimer = 0;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    blinkTimer = window.setInterval(() => {
      hamster.replaceChildren(hamFrames[1]!);
      window.setTimeout(() => hamster.replaceChildren(hamFrames[0]!), 160);
    }, 3800);
  }

  const panel = el('div', 'wcon__panel');
  place(panel, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
  const view = el('div', 'wcon__view');
  const note = el('p', 'wcon__note');
  note.setAttribute('aria-live', 'polite');
  panel.append(view, note);

  const hit = (key: keyof typeof HITS, label: string) => {
    const [x, y, w, h, shape] = HITS[key];
    const b = el('button', `wcon__hit wcon__hit--${shape}`);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.dataset.key = key;
    b.tabIndex = key === 'close' ? 0 : -1;
    place(b, x, y, w, h);
    return b;
  };
  const dUp = hit('up', 'Previous wallet');
  const dDown = hit('down', 'Next wallet');
  const dLeft = hit('left', 'Back');
  const dRight = hit('right', 'Connect');
  const bSelect = hit('select', 'Select next');
  const bBack = hit('back', 'Back');
  const bA = hit('a', 'Connect');
  const bB = hit('b', 'Back');
  const closeBtn = hit('close', 'Close');

  root.append(art, ...sparks, hamster, ...texts, panel, dUp, dDown, dLeft, dRight, bSelect, bBack, bA, bB, closeBtn);
  back.append(root);
  document.body.append(back);
  const prevFocus = document.activeElement as HTMLElement | null;

  let mode: 'list' | 'wait' | 'qr' = 'list';
  let stopWatch: (() => void) | null = null;
  const SAFE = 'Only used to claim stars and mint cards. We never ask for your seed phrase.';

  const setNote = (text: string, tone: '' | 'busy' | 'error' = '') => {
    note.textContent = text || SAFE;
    note.classList.toggle('is-safe', !text);
    root.classList.toggle('is-busy', tone === 'busy');
    root.classList.toggle('is-error', tone === 'error');
  };

  const close = () => {
    window.clearInterval(blinkTimer);
    offState();
    stopWatch?.();
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    closeOpen = null;
    if (wallet.state.status === 'connecting') void wallet.cancelConnect();
    prevFocus?.focus({ preventScroll: true });
  };

  // Bağlanınca pencere kendiliğinden kapanır
  const offState = wallet.onChange((s) => {
    if (s.status === 'connected') close();
  });

  // ------------------------------------------------ satırlar ve seçim
  const items = () => [...view.querySelectorAll<HTMLElement>('.wallet-opt:not(:disabled), .wallet-app, .wallet-copy')];
  /** Seçili satır: parlayan kenar + altın ok (odak durumundan bağımsız, fare ve klavyede aynı) */
  const mark = (item: HTMLElement | undefined, scroll = false) => {
    for (const x of view.querySelectorAll('.is-selected')) x.classList.remove('is-selected');
    if (!item) return;
    item.classList.add('is-selected');
    item.focus({ preventScroll: true });
    if (scroll) {
      // Yalnızca liste içinde, yalnızca gerektiği kadar (sayfa kaymaz)
      const v = view.getBoundingClientRect();
      const r = item.getBoundingClientRect();
      if (r.top < v.top) view.scrollTop -= v.top - r.top;
      else if (r.bottom > v.bottom) view.scrollTop += r.bottom - v.bottom;
    }
  };
  const selected = () => view.querySelector<HTMLElement>('.is-selected');
  const select = (dir: 1 | -1) => {
    const list = items();
    if (!list.length) return;
    const cur = selected();
    const i = cur ? list.indexOf(cur) : -1;
    mark(list[i < 0 ? 0 : (i + dir + list.length) % list.length], true);
  };
  const activate = () => (selected() ?? items()[0])?.click();
  view.addEventListener('pointerover', (e) => {
    const it = (e.target as HTMLElement).closest<HTMLElement>('.wallet-opt:not(:disabled), .wallet-app, .wallet-copy');
    if (it && !it.classList.contains('is-selected')) mark(it);
  });
  view.addEventListener('focusin', (e) => {
    const it = (e.target as HTMLElement).closest<HTMLElement>('.wallet-opt, .wallet-app, .wallet-copy');
    if (it && !it.classList.contains('is-selected')) mark(it);
  });
  const goBack = () => {
    if (mode === 'list') close();
    else void backToList();
  };
  /** Tuş basılma efekti (fare, dokunma ya da klavye) */
  const press = (b: HTMLElement) => {
    b.classList.add('is-pressed');
    window.setTimeout(() => b.classList.remove('is-pressed'), 140);
  };
  const bind = (b: HTMLElement, fn: () => void) =>
    b.addEventListener('click', () => {
      press(b);
      fn();
    });
  bind(dUp, () => select(-1));
  bind(dDown, () => select(1));
  bind(dLeft, goBack);
  bind(dRight, activate);
  bind(bSelect, () => select(1));
  bind(bBack, goBack);
  bind(bA, activate);
  bind(bB, goBack);
  bind(closeBtn, close);

  const optionButton = (logo: HTMLElement, name: string, subText: string, action: string, disabled = false) => {
    const b = el('button', 'wallet-opt');
    b.type = 'button';
    b.setAttribute('role', 'listitem');
    const text = el('span', 'wallet-opt__text');
    text.append(el('span', 'wallet-opt__name', name), el('span', 'wallet-opt__sub', subText));
    const logoBox = el('span', 'wallet-opt__logobox');
    logoBox.append(logo);
    b.append(logoBox, text, el('span', 'wallet-opt__go', action));
    b.disabled = disabled;
    return b;
  };

  const walletRow = (w: DetectedWallet) => {
    const b = optionButton(walletLogo(w.info.icon, w.info.name, 'wallet-opt__logo'), w.info.name, 'Browser wallet', 'Connect');
    b.addEventListener('click', async () => {
      showWait(w.info.name);
      try {
        await wallet.connectInjected(w);
      } catch (err) {
        showList();
        setNote(walletErrorText(err), 'error');
      }
    });
    return b;
  };

  const wcRow = () => {
    const logo = el('span', 'wallet-opt__logo wallet-logo--qr');
    // Koyu panel zemininde okunsun: modüller açık buz rengi, iç kareler boş
    logo.append(pixelIcon('qr', 2, 'px-icon', { k: '#cfe6ff', w: '' }));
    logo.setAttribute('aria-hidden', 'true');
    const ready = !!wallet.wcProjectId;
    const b = optionButton(logo, 'WalletConnect', isTouch() ? 'Phone wallet app' : 'Scan with your phone', ready ? (isTouch() ? 'Open' : 'QR code') : 'Soon', !ready);
    b.addEventListener('click', () => void startWc());
    return b;
  };

  const showList = () => {
    mode = 'list';
    root.dataset.mode = 'list';
    const list = el('div', 'wallet-list');
    list.setAttribute('role', 'list');
    const wallets = detectedWallets();
    for (const w of wallets) list.append(walletRow(w));
    list.append(wcRow());
    view.replaceChildren(list);
    if (!wallets.length) {
      const hint = el('p', 'wcon__hint');
      hint.append('No browser wallet found. Install ');
      const mm = el('a', undefined, 'MetaMask');
      mm.href = 'https://metamask.io/download';
      mm.target = '_blank';
      mm.rel = 'noopener noreferrer';
      const rb = el('a', undefined, 'Rabby');
      rb.href = 'https://rabby.io';
      rb.target = '_blank';
      rb.rel = 'noopener noreferrer';
      hint.append(mm, ' or ', rb, ', or use WalletConnect.');
      view.append(hint);
    }
    setNote('');
    mark(items()[0]);
  };

  const showWait = (name: string) => {
    mode = 'wait';
    root.dataset.mode = 'wait';
    const wait = el('div', 'wallet-wait');
    wait.append(pixelIcon('wallet', 4));
    view.replaceChildren(wait);
    setNote(`Confirm in ${name}…`, 'busy');
    root.focus({ preventScroll: true });
  };

  const showQr = (uri: string) => {
    mode = 'qr';
    root.dataset.mode = 'qr';
    const wrap = el('div', 'wallet-qr');
    wrap.append(el('span', 'wallet-qr__title', 'WalletConnect'));
    if (isTouch()) {
      const apps = el('div', 'wallet-apps');
      for (const [name, link] of APP_LINKS) {
        const a = el('a', 'wallet-app', `Open ${name}`);
        a.href = link(uri);
        a.rel = 'noopener noreferrer';
        apps.append(a);
      }
      const other = el('a', 'wallet-app wallet-app--other', 'Other wallet app');
      other.href = uri;
      apps.append(other);
      wrap.append(apps);
      setNote('Approve in your wallet app, then come back here', 'busy');
    } else {
      wrap.append(qrCanvas(uri));
      setNote('Scan with your wallet app, then approve', 'busy');
    }
    const copy = el('button', 'wallet-copy', 'Copy link');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(uri);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
      window.setTimeout(() => (copy.textContent = 'Copy link'), 1600);
    });
    wrap.append(copy);
    view.replaceChildren(wrap);
    mark(items()[0]);
  };

  const startWc = async () => {
    showWait('WalletConnect');
    setNote('Preparing WalletConnect…', 'busy');
    try {
      await wallet.connectWalletConnect((uri) => showQr(uri));
    } catch (err) {
      if (!back.isConnected) return;
      showList();
      setNote(walletErrorText(err), 'error');
    }
  };

  /** Geri: bekleyen bağlantıyı iptal edip listeye dön */
  const backToList = async () => {
    await wallet.cancelConnect();
    showList();
  };

  // ------------------------------------------------ klavye: oklar, Enter, Esc, Tab (pencere içinde kalır)
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      press(bB);
      goBack();
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      press(k === 'ArrowDown' ? dDown : dUp);
      select(k === 'ArrowDown' ? 1 : -1);
    } else if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      press(k === 'ArrowRight' ? dRight : dLeft);
      if (k === 'ArrowLeft') goBack();
    } else if (k === 'Enter' && selected()) {
      e.preventDefault();
      press(bA);
      activate();
    } else if (k === 'Tab') {
      const list = [...root.querySelectorAll<HTMLElement>('.wcon__panel button:not(:disabled), .wcon__panel a[href], .wcon__hit--square')];
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
      list[next]!.focus();
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  closeOpen = close;

  // Liste açıkken yeni bir cüzdan duyurulursa (eklenti geç yüklendi) güncelle
  stopWatch = onWalletsChange(() => {
    if (mode === 'list') showList();
  });

  if (opts.demoUri) showQr(opts.demoUri);
  else showList();
}
