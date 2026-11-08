/** Sepolia okuma bağlantısı: asıl RPC, hata verirse sırayla yedekler (viem fallback). Claim ve mint akışları kullanır. */
import { createPublicClient, fallback, http } from 'viem';
import { sepolia } from 'viem/chains';
import { SEPOLIA_RPC, SEPOLIA_RPC_FALLBACKS } from '../wallet/chain';

const transport = SEPOLIA_RPC_FALLBACKS.length ? fallback([SEPOLIA_RPC, ...SEPOLIA_RPC_FALLBACKS].map((u) => http(u))) : http(SEPOLIA_RPC);

export const sepoliaClient = createPublicClient({ chain: sepolia, transport });
