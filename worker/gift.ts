// Early oyuncu hediyesi: POST /api/gift-voucher. Oyuncunun kendi oturumuyla; hediyesi varsa ve cüzdanı hesabına bağlıysa
// SqueaksyCards.giftMint() için fiş imzalar. Claim şartı yok (herkes 0 yıldızla başlar). Bir hediye yalnızca bir cüzdana:
// hesap zincirde bağlıysa o cüzdana; değilse fiş imzalanmadan önce cüzdan sunucuda kilitlenir (gift_lock_wallet).
import { createPublicClient, isAddress, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { signGift, signerAddress } from './voucher.ts';
import { sepoliaTransport } from './rpc.ts';

export interface GiftEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SEPOLIA_RPC_URL: string;
  SEPOLIA_RPC_FALLBACKS?: string;
  CHAIN_ID: string;
  STARS_ADDRESS: string;
  CARDS_ADDRESS?: string;
  SIGNER_PRIVATE_KEY: string;
  ALLOWED_ORIGINS?: string;
}

const ABI = [
  { type: 'function', name: 'signer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'walletOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'accountTagOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bytes16' }] },
  { type: 'function', name: 'hasCard', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  {
    type: 'function',
    name: 'cards',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'price', type: 'uint128' },
      { name: 'maxSupply', type: 'uint32' },
      { name: 'minted', type: 'uint32' },
      { name: 'exists', type: 'bool' },
      { name: 'mintOpen', type: 'bool' },
    ],
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_TAG = '0x00000000000000000000000000000000';
/** Fişin geçerlilik süresi (sn). Süresi geçerse yenisi istenir; hediye kaybolmaz. */
const VOUCHER_TTL = 30 * 60;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function handleGiftVoucher(req: Request, env: GiftEnv): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const origin = req.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (origin && origin !== new URL(req.url).origin && !allowed.includes(origin)) return json(403, { error: 'bad_origin' });

  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(auth)) return json(401, { error: 'not_signed_in' });

  if (!env.SIGNER_PRIVATE_KEY || !env.STARS_ADDRESS || !env.CARDS_ADDRESS || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SEPOLIA_RPC_URL) {
    return json(503, { error: 'unavailable' });
  }
  const chainId = Number(env.CHAIN_ID || '11155111');
  if (chainId !== sepolia.id) return json(503, { error: 'misconfigured' });
  const stars = env.STARS_ADDRESS.toLowerCase() as Hex;
  const cards = env.CARDS_ADDRESS.toLowerCase() as Hex;
  if (!isAddress(stars) || !isAddress(cards)) return json(503, { error: 'misconfigured' });

  let wallet: Hex;
  try {
    const body = (await req.json()) as { wallet?: unknown };
    if (typeof body.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(body.wallet)) return json(400, { error: 'bad_wallet' });
    wallet = body.wallet.toLowerCase() as Hex;
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (wallet === ZERO_ADDRESS) return json(400, { error: 'bad_wallet' });

  // 1. Oyuncunun hediyesi (kendi oturumuyla; Supabase oturumu doğrular)
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/gift_voucher_request`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: auth, 'content-type': 'application/json' },
    body: '{}',
  });
  if (r.status === 401 || r.status === 403) return json(401, { error: 'not_signed_in' });
  if (!r.ok) return json(502, { error: 'game_server' });
  const info = (await r.json()) as { status?: string; account?: string; card?: string; cardType?: number; cards?: string; chainId?: string };
  if (info.status === 'none') return json(404, { error: 'no_gift' });
  if (info.status !== 'ok') return json(503, { error: 'unavailable' });
  if (info.cards?.toLowerCase() !== cards || info.chainId !== String(chainId)) return json(503, { error: 'misconfigured' });
  if (!info.account || !/^0x[0-9a-f]{64}$/.test(info.account) || !Number.isInteger(info.cardType) || !info.card) {
    return json(502, { error: 'game_server' });
  }
  const account = info.account as Hex;
  const cardType = BigInt(info.cardType!);

  // 2. Zincirden doğrula
  const client = createPublicClient({ chain: sepolia, transport: sepoliaTransport(env) });
  const read = <T>(address: Hex, functionName: 'signer' | 'walletOf' | 'paused' | 'hasCard' | 'cards' | 'accountTagOf', args: readonly unknown[] = []) =>
    client.readContract({ address, abi: ABI, functionName, args } as never) as Promise<T>;
  let onchainSigner: Hex, paused: boolean, bound: Hex, walletTag: Hex, owned: boolean, card: readonly [bigint, number, number, boolean, boolean];
  try {
    [onchainSigner, paused, bound, walletTag, owned, card] = await Promise.all([
      read<Hex>(stars, 'signer'),
      read<boolean>(cards, 'paused'),
      read<Hex>(stars, 'walletOf', [account]),
      read<Hex>(stars, 'accountTagOf', [wallet]),
      read<boolean>(cards, 'hasCard', [wallet, cardType]),
      read<readonly [bigint, number, number, boolean, boolean]>(cards, 'cards', [cardType]),
    ]);
  } catch {
    return json(502, { error: 'chain_unreachable' });
  }
  const key = env.SIGNER_PRIVATE_KEY as Hex;
  if (onchainSigner.toLowerCase() !== signerAddress(key).toLowerCase()) return json(503, { error: 'misconfigured' });
  if (paused) return json(503, { error: 'paused' });
  // Hesap bir cüzdana bağlıysa hediye yalnızca o cüzdana; cüzdan başka bir hesaba bağlıysa hediye bu hesaba alınamaz
  if (bound.toLowerCase() !== ZERO_ADDRESS && bound.toLowerCase() !== wallet) return json(409, { error: 'account_bound', wallet: bound.toLowerCase() });
  if (bound.toLowerCase() === ZERO_ADDRESS && walletTag.toLowerCase() !== ZERO_TAG && walletTag.toLowerCase() !== account.slice(0, 34)) {
    return json(409, { error: 'wallet_used' });
  }
  if (owned) return json(409, { error: 'already_owned' });
  if (!card[3]) return json(503, { error: 'misconfigured' });
  if (card[2] >= card[1]) return json(409, { error: 'sold_out' });

  // 3. Hediyeyi bu cüzdana kilitle (fişin ömrü boyunca ve kart mint edilince başka cüzdana geçilemez)
  const lockRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/gift_lock_wallet`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ p_wallet: wallet }),
  });
  if (!lockRes.ok) return json(502, { error: 'game_server' });
  const lock = (await lockRes.json()) as { status?: string; wallet?: string };
  if (lock.status === 'locked') return json(409, { error: 'gift_locked', wallet: lock.wallet });
  // Veritabanı da aynı kuralları uygular (zincir okuyucunun gördüğüne göre)
  if (lock.status === 'account_bound') return json(409, { error: 'account_bound', wallet: lock.wallet });
  if (lock.status === 'wallet_used' || lock.status === 'already_owned') return json(409, { error: lock.status });
  if (lock.status !== 'ok') return json(404, { error: 'no_gift' });

  // 4. İmzala
  const deadline = BigInt(Math.floor(Date.now() / 1000) + VOUCHER_TTL);
  const signature = await signGift(key, { chainId, cards, wallet, cardType, deadline });
  return json(200, { chainId, cards, wallet, card: info.card, cardType: cardType.toString(), deadline: deadline.toString(), signature });
}
