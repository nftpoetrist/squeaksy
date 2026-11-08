/**
 * Oyun paneli: en üst satırda yıldız sayacının sağında Claim butonu (yalnızca onchain modda ve girişliyken).
 * Sayaç claim edilmemiş yıldızları gösterir; Claim onları zincirde STARS olarak cüzdana geçirir.
 * Satırın altında küçük durum kutusu: cüzdanda onay, Sepolia'da bekleme (işlem bağlantısı), sonuç, hata.
 * Claim akışı (onchain/claim.ts, viem ile) ilk basışta yüklenir.
 */
import './claim.css';
import type { TokenLedger } from '../auth/ledger';
import type { SupabaseBackend } from '../auth/supabaseBackend';
import type { WalletManager } from '../wallet/wallet';
import type { ClaimDeps, ClaimStatus } from '../onchain/claim';
import { drawStar } from './tokenHud';

const loadClaim = () => import('../onchain/claim');

export function mountClaimButton(stage: HTMLElement, deps: ClaimDeps & { ledger: TokenLedger; backend: SupabaseBackend; wallet: WalletManager }): {
  refresh: () => void;
} {
  const wrap = document.createElement('div');
  wrap.className = 'claim';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'claim__btn';
  // Sayaçtaki piksel yıldızın aynısı
  const star = document.createElement('canvas');
  star.className = 'claim__star';
  star.setAttribute('aria-hidden', 'true');
  drawStar(star);
  const label = document.createElement('span');
  label.className = 'claim__label';
  label.textContent = 'Claim';
  // Üzerinden geçen piksel parıltı + köşelerde yanıp sönen minik yıldızlar (claim edilecek yıldız varken)
  const shine = document.createElement('span');
  shine.className = 'claim__shine';
  shine.setAttribute('aria-hidden', 'true');
  const sparks = [0, 1, 2].map((i) => {
    const sp = document.createElement('span');
    sp.className = `claim__spark claim__spark--${i}`;
    sp.setAttribute('aria-hidden', 'true');
    return sp;
  });
  btn.append(star, label, shine, ...sparks);
  btn.title = 'Claim your stars to your wallet as STARS on Sepolia';
  const box = document.createElement('div');
  box.className = 'claim__box';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.hidden = true;
  const btnWrap = document.createElement('div');
  btnWrap.className = 'claim__wrapbtn';
  const glow = document.createElement('span');
  glow.className = 'claim__glow';
  glow.setAttribute('aria-hidden', 'true');
  btnWrap.append(glow, btn);
  wrap.append(btnWrap, box);
  stage.append(wrap);

  let status: ClaimStatus = { kind: 'idle' };
  let hideTimer = 0;
  const fmt = new Intl.NumberFormat('en-US');

  const link = (href: string, text: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    return a;
  };

  const STEPS = ['Prepare', 'Wallet', 'Sepolia'] as const;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  /**
   * Durum kutusu: Claim butonuyla aynı dil (koyu dış hat, basamaklı zemin, altın iç kenar, taban). Yanıp sönme yok:
   * başlık, 3 adım (hazırlık · cüzdan · Sepolia), sakin akan piksel ilerleme çubuğu, sabit mesaj.
   */
  let stuckTimer = 0;
  const show = (s: ClaimStatus) => {
    status = s;
    window.clearTimeout(hideTimer);
    window.clearTimeout(stuckTimer);
    box.className = `claim__box is-${s.kind}`;
    box.replaceChildren();
    if (s.kind === 'idle') {
      box.hidden = true;
      refresh();
      return;
    }
    box.hidden = false;

    // Başlık: piksel yıldız + durum
    const head = el('div', 'claim__head');
    const icon = el('canvas', 'claim__icon');
    icon.setAttribute('aria-hidden', 'true');
    drawStar(icon);
    const title = s.kind === 'busy' ? 'Claiming' : s.kind === 'done' ? 'Claimed' : (s.title ?? 'Not claimed');
    head.append(icon, el('span', 'claim__title', title));
    // Kapat: hazırlık / cüzdan adımında beklemeyi bırakır (Cancel); Sepolia adımında takip arka planda sürer
    const close = el('button', 'claim__close');
    close.type = 'button';
    close.setAttribute('aria-label', s.kind === 'busy' && s.step < 3 ? 'Cancel' : 'Close');
    close.addEventListener('click', () => void dismiss());
    head.append(close);
    box.append(head);

    // Adımlar
    const now = s.kind === 'busy' ? s.step : s.kind === 'done' ? 4 : (s.step ?? 1);
    const steps = el('ol', 'claim__steps');
    STEPS.forEach((name, i) => {
      const n = i + 1;
      const li = el('li', 'claim__step', name);
      li.classList.add(n < now ? 'is-done' : n === now ? (s.kind === 'error' ? 'is-fail' : 'is-now') : 'is-todo');
      steps.append(li);
    });
    box.append(steps);

    // İlerleme çubuğu (bekleme: sakin akan altın blok, bitti: yeşil dolu, hata: kırmızı durdu)
    const bar = el('div', 'claim__bar');
    bar.append(el('i'));
    box.append(bar);

    if (s.kind === 'done') {
      // Cüzdandaki STARS değişti (Market'teki Mint butonları güncellensin)
      window.dispatchEvent(new CustomEvent('squeaksy:claimed', { detail: { amount: s.amount } }));
      const big = el('p', 'claim__big');
      const sm = el('canvas', 'claim__icon claim__icon--sm');
      sm.setAttribute('aria-hidden', 'true');
      drawStar(sm);
      big.append(sm, document.createTextNode(`+${fmt.format(s.amount)} STARS`));
      box.append(big, el('p', 'claim__msg', 'Now in your wallet on Sepolia.'));
      const row = el('div', 'claim__row');
      row.append(link(s.tx, 'View transaction'));
      const add = el('button', 'claim__add', 'Add STARS to wallet');
      add.type = 'button';
      add.addEventListener('click', async () => {
        const { addStarsToWallet } = await loadClaim();
        add.textContent = (await addStarsToWallet(deps.wallet)) ? 'Added' : 'Add STARS to wallet';
      });
      row.append(add);
      box.append(row);
      hideTimer = window.setTimeout(() => show({ kind: 'idle' }), 20_000);
    } else {
      box.append(el('p', 'claim__msg', s.text));
      const href = s.kind === 'busy' ? s.tx : s.link?.href;
      const row = el('div', 'claim__row');
      if (href) row.append(link(href, s.kind === 'busy' ? 'View transaction' : (s.link?.label ?? 'View')));
      // Hazırlık / cüzdan adımı: Cancel butonu (cüzdan cevap vermeden kapatılırsa takılı kalmasın)
      if (s.kind === 'busy' && s.step < 3) {
        const cancel = el('button', 'claim__cancel', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => void dismiss());
        row.append(cancel);
        if (s.step === 2) {
          // 20 sn cevap yoksa: cüzdan büyük ihtimalle kapatıldı
          stuckTimer = window.setTimeout(() => {
            if (status !== s) return;
            box.insertBefore(el('p', 'claim__msg claim__msg--hint', 'No answer from your wallet? If you closed it, press Cancel and claim again.'), row);
          }, 20_000);
        }
      }
      if (row.childElementCount) box.append(row);
    }
    refresh();
  };

  /** Kutuyu kapat; bekleyen hazırlık / cüzdan adımı varsa bırak */
  const dismiss = async () => {
    if (status.kind === 'busy' && status.step < 3) {
      const m = await loadClaim();
      m.cancelClaim();
    }
    show({ kind: 'idle' });
  };

  const refresh = () => {
    const signedIn = deps.ledger.signedIn;
    const was = wrap.hidden;
    wrap.hidden = !signedIn;
    if (was !== wrap.hidden) requestAnimationFrame(() => place());
    const n = Math.floor(deps.ledger.total + 1e-6);
    const busy = status.kind === 'busy';
    btn.disabled = busy || !deps.ledger.loaded || n < 1;
    btn.classList.toggle('is-ready', !btn.disabled);
    btnWrap.classList.toggle('is-ready', !btn.disabled);
    // Yazı hep aynı: genişlik değişirse satırdaki sayaç ve ses düğmesi kayar (gönderiliyor bilgisi yıldızda ve kutuda)
    btn.classList.toggle('is-busy', busy);
    btn.setAttribute('aria-label', busy ? 'Claiming your stars' : n >= 1 ? `Claim ${fmt.format(n)} stars to your wallet` : 'Nothing to claim yet');
  };

  btn.addEventListener('click', async () => {
    const { runClaim, onLateClaim } = await loadClaim();
    onLateClaim(show);
    await runClaim(deps, show);
  });

  // Tek satır: [ses] [yıldız sayacı] [Claim]. Claim en sağda, sayaçla aynı yükseklikte; sayaç Claim'in genişliği kadar
  // sola kayar (CSS: #world.has-claim), ses düğmesi ve coin hedefi de onunla birlikte güncellenir.
  let lastW = -1;
  let lastH = -1;
  const place = () => {
    const hud = stage.querySelector<HTMLElement>('.token-hud');
    stage.classList.toggle('has-claim', !wrap.hidden);
    if (!hud || wrap.hidden) {
      lastW = -1;
      window.dispatchEvent(new Event('squeaksy:hud'));
      return;
    }
    const h = hud.offsetHeight;
    if (h && h !== lastH) {
      btn.style.height = `${h}px`;
      lastH = h;
    }
    const w = btn.offsetWidth;
    if (w !== lastW) {
      stage.style.setProperty('--claim-w', `${w}px`);
      lastW = w;
      window.dispatchEvent(new Event('squeaksy:hud'));
    }
  };
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(place);
    const hud = stage.querySelector<HTMLElement>('.token-hud');
    if (hud) ro.observe(hud);
    ro.observe(btn);
  }
  window.addEventListener('resize', place);

  deps.ledger.onChange(() => {
    refresh();
    place();
  });
  deps.wallet.onChange(refresh);

  // Yarım kalmış claim (sayfa yenilendi): takibe devam et
  let resumedFor: string | null = null;
  const resume = () => {
    const id = deps.ledger.playerId;
    if (!id || id === resumedFor || !deps.ledger.loaded) return;
    resumedFor = id;
    if (localStorage.getItem(`squeaksy.claimTx.${id}`)) void loadClaim().then((m) => m.resumeClaim(deps, show));
  };
  deps.ledger.onChange(resume);

  refresh();
  place();
  // Yalnızca geliştirme: durum kutusunu önizleme (window.squeaksyClaimPreview({ kind: 'busy', step: 3, text: '…' }))
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).squeaksyClaimPreview = show;
  return { refresh };
}
