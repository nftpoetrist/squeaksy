/**
 * YALNIZCA GELİŞTİRME (?dev&mockWallet=1|2): gerçek bir tarayıcı cüzdanı gibi EIP-6963 ile duyurulan sahte cüzdan.
 * Bağlantıyı onaylar, ağ değiştirir; ekran görüntüsü ve akış testi için. Yayın derlemesine girmez (main.ts DEV koşulu).
 * ?mockChain=1 → cüzdan yanlış ağda (Ethereum) başlar; ?mockReject → bağlantı isteğini reddeder.
 */
import type { Eip1193 } from './eip6963';

// Markasız deneme logosu (gerçek bir cüzdanın logosu değil)
const ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M20 3 L35 12 L35 28 L20 37 L5 28 L5 12 Z" fill="#8b7cff"/><path d="M20 11 L28 16 L28 24 L20 29 L12 24 L12 16 Z" fill="#fff1a8"/></svg>',
  );

function makeProvider(address: string, startChain: number, reject: boolean, stuck: boolean): Eip1193 {
  let chain = startChain;
  // Gerçek cüzdan gibi verilen izni hatırlar (sekme boyunca): yenilemede sessiz bağlanma test edilebilsin
  const key = `mock-granted-${address}`;
  let granted = sessionStorage.getItem(key) === '1';
  const handlers = new Map<string, Set<(...a: any[]) => void>>();
  const emit = (e: string, v: unknown) => handlers.get(e)?.forEach((f) => f(v));
  return {
    async request({ method, params }) {
      await new Promise((r) => setTimeout(r, 250));
      switch (method) {
        case 'eth_requestAccounts':
          if (reject) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          granted = true;
          sessionStorage.setItem(key, '1');
          return [address];
        case 'eth_accounts':
          return granted ? [address] : [];
        case 'eth_chainId':
          return '0x' + chain.toString(16);
        case 'wallet_switchEthereumChain': {
          // ?mockStuck: test ağı kapalı bir cüzdan gibi isteği yok sayar, Ethereum'a geçer
          const id = stuck ? 1 : parseInt(String((params as Array<{ chainId: string }>)[0]!.chainId), 16);
          chain = id;
          emit('chainChanged', '0x' + id.toString(16));
          return null;
        }
        default:
          throw Object.assign(new Error(`mock: ${method} not supported`), { code: 4200 });
      }
    },
    // @ts-expect-error yalnızca test kancası
    silentChain(n: number) {
      chain = n;
    },
    on(e, f) {
      if (!handlers.has(e)) handlers.set(e, new Set());
      handlers.get(e)!.add(f);
    },
    removeListener(e, f) {
      handlers.get(e)?.delete(f);
    },
  };
}

export function installMockWallets(count: number, startChain: number, reject: boolean, stuck = false): void {
  const wallets = [
    { uuid: 'mock-1', name: 'Test Wallet', icon: ICON, rdns: 'xyz.squeaksy.test', address: '0x7a3f9c21b8d04e6f5a1c2b3d4e5f60718293a4b5' },
    { uuid: 'mock-2', name: 'Plain Wallet', icon: '', rdns: 'xyz.squeaksy.plain', address: '0x51c0ffee00000000000000000000000000c0ffee' },
    // Uzun liste testi (?mockWallet=6): panel kaydırması
    ...[3, 4, 5, 6].map((n) => ({ uuid: `mock-${n}`, name: `Test Wallet ${n}`, icon: ICON, rdns: `xyz.squeaksy.test${n}`, address: `0x${String(n).repeat(40)}` })),
  ].slice(0, Math.max(1, count));
  const providers = wallets.map((w) => makeProvider(w.address, startChain, reject, stuck));
  // Test: window.squeaksyMockSilentChain(56) → ağ değişir ama chainChanged bildirimi gönderilmez
  (window as unknown as Record<string, unknown>).squeaksyMockSilentChain = (id: number) =>
    providers.forEach((p) => (p as unknown as { silentChain: (n: number) => void }).silentChain(id));
  const announce = () =>
    wallets.forEach((w, i) =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: Object.freeze({ info: { uuid: w.uuid, name: w.name, icon: w.icon, rdns: w.rdns }, provider: providers[i] }),
        }),
      ),
    );
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
}
