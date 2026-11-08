/** Squeaksy kontratlarının ağı: Sepolia (Squeekchain ile aynı; bkz. docs/onchain.md) */
export const SEPOLIA_ID = 11155111;
export const SEPOLIA_HEX = '0xaa36a7';
/** Yalnızca yerel test: Sepolia'nın yerel kopyası gibi tek bir okuma adresi (VITE_SEPOLIA_RPC) */
const DEV_RPC = import.meta.env.DEV ? (import.meta.env.VITE_SEPOLIA_RPC as string | undefined) : undefined;
/** Okuma RPC'si (asıl) */
export const SEPOLIA_RPC = DEV_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
/**
 * Yedek okuma RPC'leri: asıl bağlantı hata verirse sırayla bunlar denenir (onchain/rpc.ts). Anahtarsız, tam geçmişli
 * (2026-11-08 ölçüldü). Yerel kopya ile test ederken yedek yok (gerçek zincire kaçmasın).
 */
export const SEPOLIA_RPC_FALLBACKS: string[] = DEV_RPC ? [] : ['https://sepolia.gateway.tenderly.co'];
export const EXPLORER = 'https://sepolia.etherscan.io';

export const SEPOLIA_PARAMS = {
  chainId: SEPOLIA_HEX,
  chainName: 'Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [SEPOLIA_RPC, ...SEPOLIA_RPC_FALLBACKS],
  blockExplorerUrls: [EXPLORER],
};

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
