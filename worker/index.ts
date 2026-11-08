// Cloudflare Worker: statik siteyi sunar (ASSETS) + /api/claim-voucher + /api/nft/:id (kart NFT bilgisi, worker/nft.ts).
// Fiş akışı (bkz. docs/onchain.md):
//   1. Oyuncu kendi Supabase oturumuyla gelir; claim_voucher_request() hesap kimliğini ve KAZANILAN TOPLAMI verir.
//   2. Zincirden okunur: imzacı, hesabın bağlı cüzdanı, cüzdanın bağlı hesabı, daha önce claim edilen.
//   3. Kurallar uygunsa fiş imzalanır. Burada hiçbir şey yazılmaz: yıldızlar kontrat mint edene kadar oyunda kalır.
// Gizli değer: SIGNER_PRIVATE_KEY (Cloudflare → Worker → Settings → Variables and Secrets → Secret). Kodda ya da repoda ASLA.
import { createPublicClient, isAddress, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { signClaim, signerAddress } from './voucher.ts';
import { handleNft } from './nft.ts';
import { handleGiftVoucher } from './gift.ts';
import { sepoliaTransport } from './rpc.ts';

interface Fetcher {
  fetch(req: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SEPOLIA_RPC_URL: string;
  /** Yedek okuma RPC'leri (virgülle): asıl bağlantı hata verirse sırayla */
  SEPOLIA_RPC_FALLBACKS?: string;
  CHAIN_ID: string;
  STARS_ADDRESS: string;
  SIGNER_PRIVATE_KEY: string;
  /** Yalnızca yerel geliştirme (.dev.vars): sayfanın başka adresten geldiği izinli kökenler, virgülle (ör. http://localhost:5173) */
  ALLOWED_ORIGINS?: string;
  /** SqueaksyCards adresi: /api/nft/:id (kart bilgisi) zincirden kartın türünü ve kopya numarasını okur */
  CARDS_ADDRESS?: string;
}

const STARS_ABI = [
  { type: 'function', name: 'signer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'walletOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  // Cüzdanın bağlı olduğu hesabın etiketi: hesap kimliğinin ilk 16 baytı (0 = bağlı değil)
  { type: 'function', name: 'accountTagOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bytes16' }] },
  { type: 'function', name: 'claimed', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_TAG = '0x00000000000000000000000000000000';
/** Fişin geçerlilik süresi (sn). Süresi geçen fiş yerine yenisi istenir; kayıp olmaz. */
const VOUCHER_TTL = 30 * 60;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function handleClaimVoucher(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const origin = req.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (origin && origin !== new URL(req.url).origin && !allowed.includes(origin)) return json(403, { error: 'bad_origin' });

  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(auth)) return json(401, { error: 'not_signed_in' });

  if (!env.SIGNER_PRIVATE_KEY || !env.STARS_ADDRESS || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SEPOLIA_RPC_URL) {
    return json(503, { error: 'unavailable' });
  }
  const chainId = Number(env.CHAIN_ID || '11155111');
  if (chainId !== sepolia.id) return json(503, { error: 'misconfigured' });
  const stars = env.STARS_ADDRESS.toLowerCase() as Hex;
  if (!isAddress(stars)) return json(503, { error: 'misconfigured' });

  let wallet: Hex;
  try {
    const body = (await req.json()) as { wallet?: unknown };
    if (typeof body.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(body.wallet)) return json(400, { error: 'bad_wallet' });
    wallet = body.wallet.toLowerCase() as Hex;
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (wallet === ZERO_ADDRESS) return json(400, { error: 'bad_wallet' });

  // 1. Hesap ve kazanılan toplam (oyuncunun kendi oturumu; Supabase oturumu doğrular)
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/claim_voucher_request`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: auth, 'content-type': 'application/json' },
    body: '{}',
  });
  if (r.status === 401 || r.status === 403) return json(401, { error: 'not_signed_in' });
  if (!r.ok) return json(502, { error: 'game_server' });
  const info = (await r.json()) as { status?: string; account?: string; totalEarned?: string; stars?: string; chainId?: string; giftWallet?: string | null };
  if (info.status !== 'ok') return json(503, { error: 'unavailable' });
  if (info.stars?.toLowerCase() !== stars || info.chainId !== String(chainId)) return json(503, { error: 'misconfigured' });
  if (!info.account || !/^0x[0-9a-f]{64}$/.test(info.account) || !info.totalEarned || !/^\d+$/.test(info.totalEarned)) {
    return json(502, { error: 'game_server' });
  }
  const account = info.account as Hex;
  const totalEarned = BigInt(info.totalEarned);

  // 2. Zincirden doğrula (okuyucu gecikmesine güvenilmez: her şey o anki zincir durumundan)
  const client = createPublicClient({ chain: sepolia, transport: sepoliaTransport(env) });
  const read = <T>(functionName: 'signer' | 'walletOf' | 'accountTagOf' | 'claimed' | 'paused', args: readonly unknown[] = []) =>
    client.readContract({ address: stars, abi: STARS_ABI, functionName, args } as never) as Promise<T>;
  let onchainSigner: Hex, paused: boolean, bound: Hex, walletTag: Hex, claimed: bigint;
  try {
    [onchainSigner, paused, bound, walletTag, claimed] = await Promise.all([
      read<Hex>('signer'),
      read<boolean>('paused'),
      read<Hex>('walletOf', [account]),
      read<Hex>('accountTagOf', [wallet]),
      read<bigint>('claimed', [account]),
    ]);
  } catch {
    return json(502, { error: 'chain_unreachable' });
  }
  const key = env.SIGNER_PRIVATE_KEY as Hex;
  if (onchainSigner.toLowerCase() !== signerAddress(key).toLowerCase()) return json(503, { error: 'misconfigured' });
  if (paused) return json(503, { error: 'paused' });
  if (bound.toLowerCase() !== ZERO_ADDRESS && bound.toLowerCase() !== wallet) {
    return json(409, { error: 'account_bound', wallet: bound.toLowerCase() });
  }
  // Cüzdan başka bir hesaba bağlı mı: etiket = hesap kimliğinin ilk 16 baytı (kontrat aynı karşılaştırmayı yapar)
  if (bound.toLowerCase() === ZERO_ADDRESS && walletTag.toLowerCase() !== ZERO_TAG && walletTag.toLowerCase() !== account.slice(0, 34)) {
    return json(409, { error: 'wallet_used' });
  }
  // Hediye bir cüzdana kilitliyse ilk claim de o cüzdana: kart ve yıldızlar aynı cüzdanda olsun
  if (bound.toLowerCase() === ZERO_ADDRESS && info.giftWallet && info.giftWallet.toLowerCase() !== wallet) {
    return json(409, { error: 'account_bound', wallet: info.giftWallet.toLowerCase() });
  }
  if (totalEarned <= claimed) return json(409, { error: 'nothing_to_claim', claimed: claimed.toString() });

  // 3. İmzala
  const deadline = BigInt(Math.floor(Date.now() / 1000) + VOUCHER_TTL);
  const signature = await signClaim(key, { chainId, stars, account, wallet, totalEarned, deadline });
  return json(200, {
    chainId,
    stars,
    account,
    wallet,
    totalEarned: totalEarned.toString(),
    claimed: claimed.toString(),
    amount: (totalEarned - claimed).toString(),
    deadline: deadline.toString(),
    signature,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/claim-voucher') {
      try {
        return await handleClaimVoucher(req, env);
      } catch {
        return json(500, { error: 'internal' });
      }
    }
    if (url.pathname === '/api/gift-voucher') {
      try {
        return await handleGiftVoucher(req, env);
      } catch {
        return json(500, { error: 'internal' });
      }
    }
    const nft = url.pathname.match(/^\/api\/nft\/([^/]+)$/);
    if (nft) {
      try {
        return await handleNft(req, env, nft[1]!);
      } catch {
        return json(500, { error: 'internal' });
      }
    }
    if (url.pathname.startsWith('/api/')) return json(404, { error: 'not_found' });
    return env.ASSETS.fetch(req);
  },
};
