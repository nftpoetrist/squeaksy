/**
 * Cüzdan bağlantısı (tek kaynak): tarayıcı cüzdanları (EIP-6963) + WalletConnect.
 * - Son kullanılan cüzdan hatırlanır; sayfa yenilenince açılır pencere çıkmadan (eth_accounts) yeniden bağlanır.
 * - Hesap / ağ değişimi ve kopma anında güncellenir.
 * - İmza istenmez: cüzdan yalnızca claim ve kart mint işlemleri için kullanılır (hesaba kontrat bağlar).
 */
import { startDiscovery, waitForWallet, type DetectedWallet, type Eip1193 } from './eip6963';
import { SEPOLIA_HEX, SEPOLIA_ID, SEPOLIA_PARAMS } from './chain';
import type { WcSession } from './walletConnect';

export type WalletKind = 'injected' | 'walletconnect';

export interface WalletState {
  status: 'disconnected' | 'connecting' | 'connected';
  address: string | null;
  chainId: number | null;
  kind: WalletKind | null;
  name: string;
  icon: string;
}

const STORE_KEY = 'squeaksy.wallet';

interface Saved {
  kind: WalletKind;
  rdns?: string;
}

function readSaved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Saved | null;
    return v && (v.kind === 'injected' || v.kind === 'walletconnect') ? v : null;
  } catch {
    return null;
  }
}

function writeSaved(v: Saved | null): void {
  try {
    if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* gizli sekme vb. */
  }
}

function parseChain(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = v.startsWith('0x') ? parseInt(v, 16) : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function firstAccount(v: unknown): string | null {
  const a = Array.isArray(v) ? v[0] : null;
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null;
}

/** Cüzdan hatasını oyuncuya gösterilecek kısa metne çevirir */
export function walletErrorText(err: unknown): string {
  const e = err as { code?: number; message?: string } | null;
  const code = e?.code;
  const msg = String(e?.message ?? '');
  if (code === 4001 || /reject|denied|cancel/i.test(msg)) return 'Request cancelled in your wallet';
  if (code === -32002) return 'Your wallet already has a request open. Check the wallet window';
  if (/expired|timed? ?out/i.test(msg)) return 'The connection timed out. Try again';
  return 'Could not connect. Try again';
}

/** Sepolia'ya geçilemedi: rejected = kullanıcı reddetti, unsupported = cüzdan geçmedi / Sepolia'yı desteklemiyor */
export class SwitchError extends Error {
  constructor(
    readonly reason: 'rejected' | 'unsupported',
    readonly chainId: number | null,
  ) {
    super(reason);
  }
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  59144: 'Linea',
  81457: 'Blast',
};
export function chainName(id: number | null): string {
  return id ? (CHAIN_NAMES[id] ?? `chain ${id}`) : 'another network';
}

/** Cüzdana özel Sepolia açma ipucu (yalnızca bilinen yollar) */
export function sepoliaHelp(walletName: string): string {
  const n = walletName.toLowerCase();
  if (n.includes('phantom')) return 'In Phantom: Settings > Developer Settings > turn on Testnet Mode, then try again.';
  if (n.includes('metamask')) return 'In MetaMask: open the network list, turn on Show test networks, then try again.';
  if (n.includes('coinbase')) return 'In Coinbase Wallet: Settings > Developer settings > turn on testnets, then try again.';
  return `Turn on test networks in ${walletName || 'your wallet'}, choose Sepolia, then try again.`;
}

export class WalletManager {
  state: WalletState = { status: 'disconnected', address: null, chainId: null, kind: null, name: '', icon: '' };
  readonly wcProjectId: string;
  private provider: Eip1193 | null = null;
  private wc: WcSession | null = null;
  private listeners = new Set<(s: WalletState) => void>();
  private unbind: (() => void) | null = null;

  constructor(wcProjectId: string) {
    this.wcProjectId = wcProjectId;
    startDiscovery();
  }

  get connected(): boolean {
    return this.state.status === 'connected' && !!this.state.address;
  }

  get onSepolia(): boolean {
    return this.state.chainId === SEPOLIA_ID;
  }

  /** Bağlı cüzdanın EIP-1193 sağlayıcısı (claim / mint işlemleri için) */
  get eip1193(): Eip1193 | null {
    return this.connected ? this.provider : null;
  }

  onChange(fn: (s: WalletState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<WalletState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Sayfa açılışı: kayıtlı cüzdana sessizce bağlan (izin önceden verildiyse) */
  async restore(): Promise<void> {
    const saved = readSaved();
    if (!saved) return;
    try {
      if (saved.kind === 'injected' && saved.rdns) {
        const w = await waitForWallet(saved.rdns);
        if (!w) return;
        const accounts = await w.provider.request({ method: 'eth_accounts' });
        const address = firstAccount(accounts);
        if (!address) return;
        await this.attach(w.provider, 'injected', w.info.name, w.info.icon, address);
      } else if (saved.kind === 'walletconnect' && this.wcProjectId) {
        const { restoreWalletConnect } = await import('./walletConnect');
        const s = await restoreWalletConnect(this.wcProjectId);
        if (!s) {
          writeSaved(null);
          return;
        }
        this.wc = s;
        await this.attach(s.provider, 'walletconnect', s.name, s.icon, s.address, s.chainId);
      }
    } catch (err) {
      console.warn('[Squeaksy] cüzdan yeniden bağlanamadı', err);
    }
  }

  async connectInjected(w: DetectedWallet): Promise<void> {
    this.set({ status: 'connecting', name: w.info.name, icon: w.info.icon, kind: 'injected' });
    try {
      const accounts = await w.provider.request({ method: 'eth_requestAccounts' });
      const address = firstAccount(accounts);
      if (!address) throw new Error('No account');
      await this.attach(w.provider, 'injected', w.info.name, w.info.icon, address);
      writeSaved({ kind: 'injected', rdns: w.info.rdns });
    } catch (err) {
      this.reset();
      throw err;
    }
  }

  async connectWalletConnect(onUri: (uri: string) => void): Promise<void> {
    if (!this.wcProjectId) throw new Error('WalletConnect is not set up');
    this.set({ status: 'connecting', name: 'WalletConnect', icon: '', kind: 'walletconnect' });
    try {
      const { connectWalletConnect } = await import('./walletConnect');
      const s = await connectWalletConnect(this.wcProjectId, onUri);
      this.wc = s;
      await this.attach(s.provider, 'walletconnect', s.name, s.icon, s.address, s.chainId);
      writeSaved({ kind: 'walletconnect' });
    } catch (err) {
      this.reset();
      throw err;
    }
  }

  /** Pencere kapatıldı: bekleyen bağlantı iptal */
  async cancelConnect(): Promise<void> {
    if (this.state.status !== 'connecting') return;
    if (this.state.kind === 'walletconnect') {
      const { abortWalletConnect } = await import('./walletConnect');
      await abortWalletConnect();
    }
    this.reset();
  }

  async disconnect(): Promise<void> {
    const wc = this.wc;
    writeSaved(null);
    this.reset();
    if (wc) await wc.disconnect();
  }

  /**
   * Sepolia'ya geç; cüzdanda yoksa ekle. Sonunda cüzdanın GERÇEKTEN Sepolia'da olduğu doğrulanır:
   * bazı cüzdanlar (ör. test ağı kapalı Phantom) isteği yok sayıp kendi varsayılan ağında (Ethereum) kalır.
   * Öyleyse SwitchError fırlatır (cüzdanın kaldığı ağ ile).
   */
  async switchToSepolia(): Promise<void> {
    const p = this.provider;
    if (!p) return;
    const readChain = async () => parseChain(await p.request({ method: 'eth_chainId' }).catch(() => null));
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_HEX }] });
    } catch (err) {
      const e = err as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
      const unknownChain = e.code === 4902 || e.data?.originalError?.code === 4902 || /unrecognized|not (been )?added|unknown chain/i.test(String(e.message ?? ''));
      if (e.code === 4001) throw new SwitchError('rejected', await readChain());
      if (!unknownChain) {
        console.warn('[Squeaksy] Sepolia geçişi başarısız', this.state.name, e.code, e.message);
        throw new SwitchError('unsupported', await readChain());
      }
      try {
        await p.request({ method: 'wallet_addEthereumChain', params: [SEPOLIA_PARAMS] });
      } catch (err2) {
        const e2 = err2 as { code?: number; message?: string };
        console.warn('[Squeaksy] Sepolia eklenemedi', this.state.name, e2.code, e2.message);
        throw new SwitchError(e2.code === 4001 ? 'rejected' : 'unsupported', await readChain());
      }
    }
    // Cüzdan ağ değişimini biraz geç bildirebilir: kısa süre bekleyip doğrula
    let id = await readChain();
    for (let i = 0; i < 6 && id !== SEPOLIA_ID; i++) {
      await new Promise((r) => setTimeout(r, 200));
      id = await readChain();
    }
    if (id) this.set({ chainId: id });
    if (id !== SEPOLIA_ID) {
      console.warn('[Squeaksy] cüzdan Sepolia\'ya geçmedi', this.state.name, 'ağ:', id);
      throw new SwitchError('unsupported', id);
    }
  }

  /**
   * İşlem göndermeden hemen önce: cüzdan ŞU AN gerçekten Sepolia'da mı. Ağ durumu birkaç saniyede bir okunur; oyuncu
   * fiş beklenirken ağ değiştirirse işlem başka bir ağa (ör. Ethereum) gidip gerçek ücret ödetebilirdi.
   */
  async confirmSepolia(): Promise<boolean> {
    const p = this.provider;
    if (!p) return false;
    const id = parseChain(await p.request({ method: 'eth_chainId' }).catch(() => null));
    if (id && id !== this.state.chainId && p === this.provider) this.set({ chainId: id });
    return id === SEPOLIA_ID;
  }

  private async attach(p: Eip1193, kind: WalletKind, name: string, icon: string, address: string, chainId?: number): Promise<void> {
    this.unbind?.();
    this.provider = p;
    const id = chainId ?? parseChain(await p.request({ method: 'eth_chainId' }).catch(() => null));
    const onAccounts = (accs: unknown) => {
      const a = firstAccount(accs);
      if (a) this.set({ address: a });
      else void this.disconnect();
    };
    const onChain = (c: unknown) => {
      const n = parseChain(c);
      if (n) this.set({ chainId: n });
    };
    const onDisconnect = () => {
      // Tarayıcı cüzdanlarında "disconnect" ağ kopması da olabilir; hesap hâlâ varsa bağlı kal
      void p
        .request({ method: 'eth_accounts' })
        .then((accs) => (firstAccount(accs) ? undefined : this.disconnect()))
        .catch(() => this.disconnect());
    };
    p.on?.('accountsChanged', onAccounts);
    p.on?.('chainChanged', onChain);
    p.on?.('disconnect', onDisconnect);
    if (kind === 'walletconnect') p.on?.('session_delete', onDisconnect);
    // Bazı cüzdanlar ağ / hesap değişimini bildirmez (ya da geç bildirir): ağ ve hesap aktif olarak da okunur.
    // Birkaç saniyede bir, sekmeye dönünce ve pencere odak alınca. Cüzdana yerel bir sorgu: ağ trafiği yok.
    const resync = () => void this.resync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') resync();
    }, 3000);
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', onVisible);
    this.unbind = () => {
      p.removeListener?.('accountsChanged', onAccounts);
      p.removeListener?.('chainChanged', onChain);
      p.removeListener?.('disconnect', onDisconnect);
      if (kind === 'walletconnect') p.removeListener?.('session_delete', onDisconnect);
      window.clearInterval(timer);
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', onVisible);
    };
    this.set({ status: 'connected', address, chainId: id, kind, name, icon });
  }

  /** Cüzdanın o anki ağını ve hesabını oku; değiştiyse durumu güncelle (menü açılırken de çağrılır) */
  async resync(): Promise<void> {
    const p = this.provider;
    if (!p || this.state.status !== 'connected') return;
    try {
      const [c, accs] = await Promise.all([p.request({ method: 'eth_chainId' }), p.request({ method: 'eth_accounts' })]);
      if (p !== this.provider) return;
      const id = parseChain(c);
      const a = firstAccount(accs);
      const patch: Partial<WalletState> = {};
      if (id && id !== this.state.chainId) patch.chainId = id;
      // Kilitli cüzdan boş liste döner: bağlantıyı koparmayız, yalnızca farklı bir hesaba geçildiyse güncelleriz
      if (a && a !== this.state.address) patch.address = a;
      if (Object.keys(patch).length) this.set(patch);
    } catch {
      /* cüzdan meşgul / kilitli: bir sonraki denemede */
    }
  }

  private reset(): void {
    this.unbind?.();
    this.unbind = null;
    this.provider = null;
    this.wc = null;
    this.set({ status: 'disconnected', address: null, chainId: null, kind: null, name: '', icon: '' });
  }
}
