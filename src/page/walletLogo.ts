import { pixelIcon } from './pixelIcons';

/** Cüzdan logosu: olduğu gibi; yoksa / yüklenemezse piksel cüzdan ikonu */
export function walletLogo(icon: string, name: string, cls: string): HTMLElement {
  const fallback = () => {
    const box = Object.assign(document.createElement('span'), { className: `${cls} wallet-logo--px` });
    box.append(pixelIcon('wallet', 2));
    box.setAttribute('aria-hidden', 'true');
    return box;
  };
  if (!icon) return fallback();
  const img = Object.assign(document.createElement('img'), { className: cls });
  img.alt = '';
  img.width = 40;
  img.height = 40;
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = icon;
  img.title = name;
  img.addEventListener(
    'error',
    () => {
      console.warn('[Squeaksy] wallet logo could not be shown:', name, icon.slice(0, 48));
      img.replaceWith(fallback());
    },
    { once: true },
  );
  return img;
}
