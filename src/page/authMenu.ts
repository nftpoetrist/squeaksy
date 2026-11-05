import type { TokenLedger } from '../auth/ledger';
import type { AuthBackend, Player } from '../auth/types';

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
 * Navbar'ın sağ üstü: çıkışta "Sign in with X" butonu, girişte piksel profil
 * fotoğrafı + @kullanıcı adı + token bakiyesi; tıklayınca küçük menü (Sign out).
 */
export function mountAuthMenu(slot: HTMLElement, backend: AuthBackend, ledger: TokenLedger, getShownBalance: () => number): {
  render: (p: Player | null) => void;
  refreshBalance: () => void;
} {
  slot.classList.add('nav__auth');
  const fmt = new Intl.NumberFormat('en-US');
  let balanceEl: HTMLElement | null = null;
  let closeMenu: (() => void) | null = null;

  const refreshBalance = () => {
    if (balanceEl) balanceEl.textContent = ledger.loaded ? fmt.format(getShownBalance()) : '…';
  };

  const render = (p: Player | null) => {
    closeMenu?.();
    slot.replaceChildren();
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
      label.append('Sign in', Object.assign(document.createElement('span'), { className: 'x-signin__long', textContent: ' with X' }));
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
      slot.append(btn);
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
    const bal = document.createElement('span');
    bal.className = 'profile__balance';
    const coin = document.createElement('i');
    coin.className = 'profile__coin';
    coin.setAttribute('aria-hidden', 'true');
    balanceEl = document.createElement('b');
    bal.append(coin, balanceEl, document.createTextNode(' stars'));
    info.append(handle, bal);
    btn.append(avatar, info);

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
    menu.append(name, out);
    wrap.append(btn, menu);
    slot.append(wrap);

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
    btn.addEventListener('click', () => {
      if (!menu.hidden) {
        close();
        return;
      }
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      closeMenu = close;
      window.setTimeout(() => document.addEventListener('click', onDoc));
      document.addEventListener('keydown', onKey);
    });

    refreshBalance();
  };

  return { render, refreshBalance };
}
