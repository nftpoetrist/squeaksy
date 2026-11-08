import type { TokenLedger } from '../auth/ledger';
import type { AuthBackend, Player } from '../auth/types';
import type { WalletManager } from '../wallet/wallet';
import { appendWalletMenu, walletLine } from './walletButton';
import { drawStar } from './tokenHud';

/** 7×7 piksel "X" işareti */
function drawXMark(canvas: HTMLCanvasElement): void {
  canvas.width = canvas.height = 7;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0c0a1c';
  for (let i = 0; i < 7; i++) {
    ctx.fillRect(i, i, 1, 1);
    ctx.fillRect(6 - i, i, 1, 1);
  }
  ctx.fillRect(1, 0, 1, 1);
  ctx.fillRect(5, 6, 1, 1);
}

/**
 * Navbar'ın sağ üstü: çıkışta "Sign in with X" butonu, girişte X profil fotoğrafı + @kullanıcı adı + yıldızlar;
 * cüzdan bağlıysa profil ile birleşir: ikinci satırda yıldızlar yerine küçük yazıyla kısa cüzdan adresi (ağ noktasıyla),
 * menüde cüzdan bölümü (walletButton.appendWalletMenu) + Sign out.
 */
export function mountAuthMenu(
  slot: HTMLElement,
  backend: AuthBackend,
  ledger: TokenLedger,
  getShownBalance: () => number,
  wallet?: WalletManager,
): {
  render: (p: Player | null) => void;
  refreshBalance: () => void;
  /** Onchain: profilde cüzdandaki STARS gösterilir (null = henüz bilinmiyor) */
  setWalletStars: (n: number | null) => void;
} {
  slot.classList.add('nav__auth');
  // Kendi kutusu: aynı navbar yuvasında solunda cüzdan butonu durur (walletButton.ts)
  const box = document.createElement('div');
  box.className = 'nav__profile';
  slot.append(box);
  const fmt = new Intl.NumberFormat('en-US');
  let balanceEl: HTMLElement | null = null;
  let closeMenu: (() => void) | null = null;
  let current: Player | null = null;
  /** Bir sonraki çizimde menü açık kalsın (cüzdan menüsü içinden yeniden çizim) */
  let keepOpen = false;

  /** Onchain modda cüzdandaki STARS (undefined: eski mod, oyundaki bakiye gösterilir) */
  let walletStars: number | null | undefined;
  const refreshBalance = () => {
    if (!balanceEl) return;
    if (walletStars !== undefined) {
      // null: henüz okunmadı (sayfa açılışı). Yanlış bir rakam yerine bekleme işareti; okununca gerçek bakiye
      balanceEl.textContent = walletStars === null ? '…' : fmt.format(walletStars);
      balanceEl.parentElement!.title = 'STARS in your wallet';
    } else balanceEl.textContent = ledger.loaded ? fmt.format(getShownBalance()) : '…';
  };
  const setWalletStars = (n: number | null) => {
    walletStars = n;
    refreshBalance();
  };

  const render = (p: Player | null) => {
    current = p;
    closeMenu?.();
    box.replaceChildren();
    balanceEl = null;
    if (!p) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'x-signin';
      const mark = document.createElement('canvas');
      mark.className = 'x-signin__mark';
      mark.setAttribute('aria-hidden', 'true');
      drawXMark(mark);
      const label = document.createElement('span');
      // Dar ekranda sadece "Sign in" (X işareti zaten yanında)
      if (backend.signInLabel) label.textContent = backend.signInLabel;
      else label.append('Sign in', Object.assign(document.createElement('span'), { className: 'x-signin__long', textContent: ' with X' }));
      btn.append(mark, label);
      btn.title = backend.configured ? 'Sign in with your X account to earn stars' : 'X login is not configured yet';
      btn.addEventListener('click', async () => {
        if (!backend.configured) {
          label.textContent = 'Coming soon';
          window.setTimeout(() => (label.textContent = 'Sign in with X'), 1800);
          return;
        }
        btn.disabled = true;
        label.textContent = 'Opening X…';
        try {
          await backend.signIn();
        } catch (err) {
          console.warn('[Squeaksy] X girişi başlatılamadı', err);
          btn.disabled = false;
          // Dar ekranda sadece "Sign in" (X işareti zaten yanında)
      label.append('Sign in', Object.assign(document.createElement('span'), { className: 'x-signin__long', textContent: ' with X' }));
        }
      });
      box.append(btn);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'profile';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'profile__btn';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    // X profil fotoğrafı olduğu gibi; yüklenemezse baş harf gösterilir
    const fallback = () => {
      const letter = document.createElement('span');
      letter.className = 'profile__avatar profile__avatar--letter';
      letter.setAttribute('aria-hidden', 'true');
      letter.textContent = (p.handle[0] ?? '?').toUpperCase();
      return letter;
    };
    let avatar: HTMLElement;
    if (p.avatarUrl) {
      const img = document.createElement('img');
      img.className = 'profile__avatar';
      img.alt = '';
      img.width = 40;
      img.height = 40;
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = p.avatarUrl;
      img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
      avatar = img;
    } else {
      avatar = fallback();
    }
    const info = document.createElement('span');
    info.className = 'profile__info';
    const handle = document.createElement('span');
    handle.className = 'profile__handle';
    handle.textContent = `@${p.handle}`;
    // Cüzdan bağlıysa: ikinci satırda kısa cüzdan adresi
    const wline = wallet ? walletLine(wallet) : null;
    if (wline) {
      btn.classList.add('is-wallet');
      if (!wallet!.onSepolia) btn.classList.add('is-wrong');
      btn.setAttribute('aria-label', `@${p.handle}, wallet ${wallet!.state.address}${wallet!.onSepolia ? '' : ', wrong network'}`);
      info.append(handle, wline);
    } else {
      info.append(handle);
    }
    // Sağda yıldız rozeti: oyun panelindeki sayacın piksel yıldızı + sayı (onchain: cüzdandaki STARS)
    const stars = document.createElement('span');
    stars.className = 'profile__stars';
    const star = document.createElement('canvas');
    star.className = 'profile__star';
    star.setAttribute('aria-hidden', 'true');
    drawStar(star);
    balanceEl = document.createElement('b');
    stars.append(star, balanceEl);
    btn.append(avatar, info, stars);

    const menu = document.createElement('div');
    menu.className = 'profile__menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const name = document.createElement('p');
    name.className = 'profile__name';
    name.textContent = p.name;
    const out = document.createElement('button');
    out.type = 'button';
    out.setAttribute('role', 'menuitem');
    out.textContent = 'Sign out';
    out.addEventListener('click', async () => {
      await ledger.flush();
      await backend.signOut();
    });
    menu.append(name);
    if (wallet)
      appendWalletMenu(menu, wallet, (open) => {
        keepOpen = open;
        render(current);
      });
    menu.append(out);
    wrap.append(btn, menu);
    box.append(wrap);

    const onDoc = (e: MouseEvent) => {
      if (!wrap.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const close = () => {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
      closeMenu = null;
    };
    const open = () => {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      closeMenu = close;
      window.setTimeout(() => document.addEventListener('click', onDoc));
      document.addEventListener('keydown', onKey);
    };
    btn.addEventListener('click', () => {
      if (!menu.hidden) {
        close();
        return;
      }
      open();
      // Menü açılırken cüzdanın gerçek ağını tekrar sor (değiştiyse menü kendini günceller, açık kalır)
      void wallet?.resync();
    });
    if (keepOpen) {
      keepOpen = false;
      open();
    }

    refreshBalance();
  };

  // Cüzdan bağlanınca / değişince profil yeniden çizilir (menü açıksa açık kalır)
  wallet?.onChange(() => {
    if (!current) return;
    keepOpen = closeMenu !== null;
    render(current);
  });

  return { render, refreshBalance, setWalletStars };
}
