/**
 * Tarayıcıdaki cüzdanları bulur (EIP-6963): her cüzdan kendini adı, logosu ve kimliğiyle (rdns) duyurur.
 * Birden çok cüzdan yüklüyse birbirine karışmaz. Duyuru yapmayan eski cüzdanlar (bazı mobil uygulama
 * tarayıcıları) için window.ethereum yedek olarak "Browser wallet" diye eklenir.
 */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, fn: (...args: any[]) => void): void;
  removeListener?(event: string, fn: (...args: any[]) => void): void;
}

export interface WalletInfo {
  uuid: string;
  name: string;
  /** data:image/... (EIP-6963 gereği); geçersizse boş */
  icon: string;
  rdns: string;
}

export interface DetectedWallet {
  info: WalletInfo;
  provider: Eip1193;
}

export const LEGACY_RDNS = 'legacy.injected';

const found = new Map<string, DetectedWallet>();
const listeners = new Set<() => void>();
let started = false;

/**
 * Cüzdanın kendi logosu. Yalnızca gömülü resim (data:image/…) kabul edilir: uzak adres = takip / içerik değişimi riski.
 * Cüzdanlar logoyu farklı biçimlerde gönderiyor (baştaki boşluk / satır sonu, büyük harf, kodlanmamış "#" içeren SVG,
 * base64 içinde satır sonu); hepsi tarayıcının sorunsuz göstereceği tek biçime çevrilir. Aksi halde (ör. Phantom,
 * Backpack) <img> yüklenemiyor ve yedek piksel ikon görünüyordu.
 */
export function safeIcon(icon: unknown): string {
  if (typeof icon !== 'string') return '';
  const s = icon.trim();
  if (s.length > 2_000_000) return '';
  const m = /^data:(image\/[a-z0-9.+-]+)((?:;[^,;]+)*?)(;base64)?,([\s\S]*)$/i.exec(s);
  if (!m) return '';
  const mime = m[1]!.toLowerCase();
  if (!/^image\/(svg\+xml|png|webp|jpe?g|gif|avif)$/.test(mime)) return '';
  const payload = m[4]!;
  if (m[3]) return `data:${mime};base64,${payload.replace(/\s+/g, '')}`;
  // Düz metin (çoğunlukla SVG): önce çöz, sonra güvenli biçimde yeniden kodla
  let raw = payload;
  try {
    raw = decodeURIComponent(payload);
  } catch {
    /* zaten çözülmüş */
  }
  return `data:${mime}${m[2] ?? ''},${encodeURIComponent(raw)}`;
}

function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
}

export function startDiscovery(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('eip6963:announceProvider', (e: Event) => {
    const d = (e as CustomEvent).detail as { info?: Partial<WalletInfo>; provider?: Eip1193 } | undefined;
    const p = d?.provider;
    const rdns = typeof d?.info?.rdns === 'string' ? d.info.rdns : '';
    const name = cleanName(d?.info?.name);
    if (!p || typeof p.request !== 'function' || !rdns || !name) return;
    found.set(rdns, { info: { uuid: String(d!.info!.uuid ?? rdns), name, icon: safeIcon(d!.info!.icon), rdns }, provider: p });
    for (const fn of listeners) fn();
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** Bulunan cüzdanlar. Hiçbiri duyuru yapmadıysa ve window.ethereum varsa onu döner. */
export function detectedWallets(): DetectedWallet[] {
  const list = [...found.values()].sort((a, b) => a.info.name.localeCompare(b.info.name));
  if (list.length) return list;
  const legacy = (window as unknown as { ethereum?: Eip1193 & Record<string, unknown> }).ethereum;
  if (legacy && typeof legacy.request === 'function') {
    const name = legacy.isMetaMask ? 'MetaMask' : legacy.isCoinbaseWallet ? 'Coinbase Wallet' : legacy.isTrust ? 'Trust Wallet' : 'Browser wallet';
    return [{ info: { uuid: LEGACY_RDNS, name, icon: '', rdns: LEGACY_RDNS }, provider: legacy }];
  }
  return [];
}

export function findWallet(rdns: string): DetectedWallet | undefined {
  return detectedWallets().find((w) => w.info.rdns === rdns);
}

export function onWalletsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Duyurular birkaç yüz ms içinde gelir: kayıtlı cüzdanı ararken kısa süre beklenir */
export function waitForWallet(rdns: string, ms = 600): Promise<DetectedWallet | undefined> {
  const now = findWallet(rdns);
  if (now && rdns !== LEGACY_RDNS) return Promise.resolve(now);
  return new Promise((resolve) => {
    const stop = onWalletsChange(() => {
      const w = findWallet(rdns);
      if (w) {
        stop();
        clearTimeout(t);
        resolve(w);
      }
    });
    const t = setTimeout(() => {
      stop();
      resolve(findWallet(rdns));
    }, ms);
  });
}
