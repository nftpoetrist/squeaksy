// Sepolia okuma bağlantısı: SEPOLIA_RPC_URL, hata verirse SEPOLIA_RPC_FALLBACKS (virgülle) sırayla (viem fallback)
import { fallback, http, type Transport } from 'viem';

export function sepoliaTransport(env: { SEPOLIA_RPC_URL: string; SEPOLIA_RPC_FALLBACKS?: string }): Transport {
  const extra = (env.SEPOLIA_RPC_FALLBACKS ?? '').split(',').map((u) => u.trim()).filter((u) => /^https:\/\//.test(u));
  return extra.length ? fallback([env.SEPOLIA_RPC_URL, ...extra].map((u) => http(u))) : http(env.SEPOLIA_RPC_URL);
}
