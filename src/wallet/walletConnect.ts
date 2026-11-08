/**
 * WalletConnect (telefon cüzdanları, eklentisiz tarayıcılar). Yalnızca bağlantı katmanı kullanılır:
 * WalletConnect'in kendi penceresi YOK, QR ve uygulama butonlarını Squeaksy kendisi çizer (walletModal.ts).
 * Bu dosya ayrı parça olarak, yalnızca oyuncu WalletConnect'i seçtiğinde (ya da kayıtlı oturum varsa) yüklenir.
 */
import UniversalProvider from '@walletconnect/universal-provider';
import type { Eip1193 } from './eip6963';
import { SEPOLIA_ID, SEPOLIA_RPC } from './chain';

const CHAIN = `eip155:${SEPOLIA_ID}`;

export interface WcSession {
  provider: Eip1193;
  address: string;
  chainId: number;
  /** Karşıdaki cüzdanın adı ve logosu (oturumdan) */
  name: string;
  icon: string;
  disconnect(): Promise<void>;
}

let upPromise: Promise<UniversalProvider> | null = null;

function getProvider(projectId: string): Promise<UniversalProvider> {
  upPromise ??= UniversalProvider.init({
    projectId,
    metadata: {
      name: 'Squeaksy',
      description: 'Hamster-powered stars on Squeekchain',
      url: location.origin,
      icons: [`${location.origin}/apple-touch-icon.png`],
    },
  });
  return upPromise;
}

/** Oturumdaki ilk Sepolia hesabı: "eip155:11155111:0xabc…" */
function sessionAccount(up: UniversalProvider): string | null {
  const accs = up.session?.namespaces?.eip155?.accounts ?? [];
  const mine = accs.find((a) => a.startsWith(`${CHAIN}:`)) ?? accs[0];
  const addr = mine?.split(':')[2];
  return addr && /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : null;
}

/** Oturumda onaylanan ağlar ("eip155:1", "eip155:11155111" …) */
function approvedChains(up: UniversalProvider): string[] {
  const ns = up.session?.namespaces?.eip155;
  const fromAccounts = (ns?.accounts ?? []).map((a) => a.split(':').slice(0, 2).join(':'));
  return [...new Set([...(ns?.chains ?? []), ...fromAccounts])];
}

function wrap(up: UniversalProvider): WcSession | null {
  const address = sessionAccount(up);
  if (!address) return null;
  // Cüzdan Sepolia'yı da onayladıysa oturumun varsayılan ağı Sepolia olur. Yoksa kütüphane ağ sorusuna (eth_chainId)
  // oturumun ilk ağını (çoğu zaman Ethereum) döndürür ve işlemler Sepolia'ya gitse bile site "yanlış ağ" gösterir.
  const chains = approvedChains(up);
  const onSepolia = chains.includes(CHAIN);
  if (onSepolia) up.setDefaultChain(CHAIN, SEPOLIA_RPC);
  const first = Number((chains[0] ?? '').split(':')[1]);
  const peer = up.session?.peer?.metadata;
  const icon = peer?.icons?.find((i) => /^https:\/\//.test(i)) ?? '';
  const provider: Eip1193 = {
    request: (args) => up.request(args as { method: string; params?: unknown[] }, CHAIN),
    on: (event, fn) => up.on(event, fn),
    removeListener: (event, fn) => up.removeListener(event, fn),
  };
  return {
    provider,
    address,
    chainId: onSepolia ? SEPOLIA_ID : Number.isFinite(first) && first > 0 ? first : SEPOLIA_ID,
    name: (peer?.name ?? 'WalletConnect').slice(0, 40),
    icon,
    disconnect: async () => {
      try {
        await up.disconnect();
      } catch {
        /* oturum zaten kapanmış olabilir */
      }
    },
  };
}

/** Kayıtlı WalletConnect oturumu varsa (sayfa yenilendi) sessizce döner; açılır pencere yok */
export async function restoreWalletConnect(projectId: string): Promise<WcSession | null> {
  const up = await getProvider(projectId);
  return up.session ? wrap(up) : null;
}

/** Yeni bağlantı: onUri QR / uygulama bağlantısı için çağrılır; cüzdan onaylayınca döner */
export async function connectWalletConnect(projectId: string, onUri: (uri: string) => void): Promise<WcSession> {
  const up = await getProvider(projectId);
  if (up.session) {
    const s = wrap(up);
    if (s) return s;
    await up.disconnect().catch(() => undefined);
  }
  const handler = (uri: string) => onUri(uri);
  up.on('display_uri', handler);
  try {
    await up.connect({
      optionalNamespaces: {
        eip155: {
          chains: [CHAIN],
          methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_watchAsset'],
          events: ['chainChanged', 'accountsChanged'],
          rpcMap: { [String(SEPOLIA_ID)]: SEPOLIA_RPC, [CHAIN]: SEPOLIA_RPC },
        },
      },
    });
  } finally {
    up.removeListener('display_uri', handler);
  }
  const s = wrap(up);
  if (!s) throw new Error('No Sepolia account in this wallet');
  return s;
}

/** Oyuncu pencereyi kapattı: bekleyen eşleştirme iptal */
export async function abortWalletConnect(): Promise<void> {
  if (!upPromise) return;
  try {
    (await upPromise).abortPairingAttempt();
  } catch {
    /* yok */
  }
}
