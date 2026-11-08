/**
 * Navbar cüzdanı.
 * Bağlı değil: X profilinin solunda "Sign in with X" ile aynı mavi piksel buton (piksel cüzdan ikonu + "Connect wallet").
 * Bağlı: ayrı çip YOK, cüzdan X profiliyle birleşir (authMenu.ts): X fotoğrafı + @kullanıcı adı, altında küçük yazıyla
 * kısa cüzdan adresi (yeşil nokta Sepolia, kırmızı yanlış ağ). Cüzdan menüsü (Sepolia'ya geç, adres kopyala, Etherscan,
 * bağlantıyı kes) profil menüsünün içindedir; parçaları buradan gelir (walletLine, appendWalletMenu).
 */
import './wallet.css';
import { EXPLORER, shortAddress } from '../wallet/chain';
import { SwitchError, chainName, sepoliaHelp, type WalletManager } from '../wallet/wallet';
import { pixelIcon } from './pixelIcons';

/** Pencere (QR üreteciyle) ilk tıklamada yüklenir: açılışta sayfayı ağırlaştırmaz */
let modalModule: Promise<typeof import('./walletModal')> | null = null;
/** Panel kodunu yükle ve konsolu önceden çiz (bir kez) */
function preloadModal(): Promise<typeof import('./walletModal')> {
  modalModule ??= import('./walletModal').then((m) => {
    m.prewarm();
    return m;
  });
  return modalModule;
}
export async function openWalletModal(wallet: WalletManager, opts?: import('./walletModal').WalletModalOptions): Promise<void> {
  const m = await preloadModal();
  m.openWalletModal(wallet, opts);
}

/** Son Sepolia geçişi başarısızsa nedeni (profil menüsünde gösterilir, yeniden çizimde kaybolmaz) */
let switchHint: string | null = null;

/** Profil kutusunun ikinci satırı: ağ noktası + kısa cüzdan adresi (bağlı değilse null) */
export function walletLine(wallet: WalletManager): HTMLElement | null {
  const s = wallet.state;
  if (s.status !== 'connected' || !s.address) return null;
  const line = document.createElement('span');
  line.className = 'profile__balance profile__wallet';
  const dot = document.createElement('i');
  dot.className = 'wallet-chip__dot';
  dot.setAttribute('aria-hidden', 'true');
  line.append(dot, document.createTextNode(shortAddress(s.address)));
  line.title = wallet.onSepolia ? `${s.address} · Sepolia` : `${s.address} · wrong network`;
  return line;
}

/**
 * Profil menüsüne cüzdan bölümünü ekler: cüzdan adı + tam adres, (yanlış ağdaysa) Sepolia'ya geç + ipucu,
 * adres kopyala, Etherscan, bağlantıyı kes. rerender(true): profil yeniden çizilip menü açık kalır.
 */
export function appendWalletMenu(menu: HTMLElement, wallet: WalletManager, rerender: (keepOpen: boolean) => void): void {
  const s = wallet.state;
  if (s.status !== 'connected' || !s.address) return;
  const onNet = wallet.onSepolia;
  const sec = document.createElement('div');
  sec.className = 'wallet-menu';
  const name = document.createElement('p');
  name.className = 'wallet-menu__name';
  const dot = document.createElement('i');
  dot.className = `wallet-chip__dot${onNet ? '' : ' is-wrong'}`;
  dot.setAttribute('aria-hidden', 'true');
  name.append(dot, document.createTextNode(`${s.name || 'Wallet'} · ${onNet ? 'Sepolia' : chainName(s.chainId)}`));
  const full = document.createElement('p');
  full.className = 'wallet-menu__addr';
  full.textContent = s.address;
  sec.append(name, full);

  const item = (text: string, fn: () => void | Promise<void>, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (cls) b.className = cls;
    b.textContent = text;
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fn();
    });
    sec.append(b);
    return b;
  };
  if (!onNet) {
    const sw = item(
      'Switch to Sepolia',
      async () => {
        sw.disabled = true;
        sw.textContent = 'Check your wallet…';
        try {
          switchHint = null;
          await wallet.switchToSepolia();
        } catch (err) {
          // Cüzdan geçmediyse nedenini göster ve menüyü açık tut
          switchHint =
            err instanceof SwitchError && err.reason === 'rejected'
              ? 'Switch cancelled in your wallet.'
              : `Your wallet stayed on ${chainName(err instanceof SwitchError ? err.chainId : wallet.state.chainId)}. ${sepoliaHelp(wallet.state.name)}`;
          rerender(true);
        }
      },
      'wallet-menu__switch',
    );
    if (switchHint) {
      const hint = document.createElement('p');
      hint.className = 'wallet-menu__hint';
      hint.setAttribute('role', 'status');
      hint.textContent = switchHint;
      sec.append(hint);
    }
  } else {
    switchHint = null;
  }
  const copy = item('Copy address', async () => {
    try {
      await navigator.clipboard.writeText(s.address!);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
    window.setTimeout(() => (copy.textContent = 'Copy address'), 1400);
  });
  const scan = document.createElement('a');
  scan.setAttribute('role', 'menuitem');
  scan.className = 'wallet-menu__link';
  scan.href = `${EXPLORER}/address/${s.address}`;
  scan.target = '_blank';
  scan.rel = 'noopener noreferrer';
  scan.textContent = 'View on Etherscan';
  sec.append(scan);
  item('Disconnect wallet', () => wallet.disconnect());
  menu.append(sec);
}

/** "Connect wallet" butonu: yalnızca X ile giriş yapılmışken ve cüzdan bağlı değilken görünür */
export function mountWalletButton(slot: HTMLElement, wallet: WalletManager): { setSignedIn: (v: boolean) => void } {
  slot.classList.add('nav__wallet');
  let signedIn = false;

  const render = () => {
    slot.replaceChildren();
    const s = wallet.state;
    const connected = s.status === 'connected' && !!s.address;
    slot.hidden = !signedIn || connected;
    if (slot.hidden) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-signin wallet-btn';
    const label = document.createElement('span');
    if (s.status === 'connecting') {
      label.textContent = 'Connecting…';
      btn.disabled = true;
    } else {
      label.append('Connect', Object.assign(document.createElement('span'), { className: 'x-signin__long', textContent: ' wallet' }));
    }
    btn.append(pixelIcon('wallet', 2, 'px-icon wallet-btn__icon'), label);
    btn.title = 'Connect a wallet to claim your stars on Sepolia';
    btn.setAttribute('aria-label', 'Connect wallet');
    btn.addEventListener('click', () => void openWalletModal(wallet));
    // Fare üstüne gelince / dokununca hemen hazırla; ayrıca tarayıcı boşta kalınca
    btn.addEventListener('pointerenter', () => void preloadModal(), { once: true });
    btn.addEventListener('focus', () => void preloadModal(), { once: true });
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => void preloadModal(), { timeout: 4000 });
    else window.setTimeout(() => void preloadModal(), 1500);
    slot.append(btn);
  };

  wallet.onChange(render);
  render();
  return {
    setSignedIn: (v) => {
      if (v === signedIn) return;
      signedIn = v;
      render();
    },
  };
}
