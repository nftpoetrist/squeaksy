// NFT bilgisi: GET /api/nft/:tokenId (SqueaksyCards.tokenURI = taban adres + tokenId, ör. https://squeaksy.xyz/api/nft/12).
// Cüzdanlar (MetaMask), Etherscan ve pazar yerleri kartın adını, resmini ve özelliklerini buradan okur.
// Token numarası kartın türünü ve kopya numarasını taşır: tokenId = tür × 1.000.000 + kopyaNo (ör. 1000012 = Skyeaksy #12).
// Zincirden yalnızca o türün kaç kez mint edildiği okunur (cards(tür).minted): kopya numaraları 1'den sırayla verilir ve
// kartlar hiç yakılmaz, yani kopyaNo ≤ minted ⇔ kart var. Bu okuma hiç geri dönmez (zincir yazılımına göre değişen hata
// biçimine bağlı değil). Mint edilmemiş ya da geçersiz numara 404.
// Kart metinleri ve görselleri sitedeki kartlardan üretilir (tools/nft-assets.mjs → worker/nftCards.ts, public/nft/*.png).
import { createPublicClient, isAddress, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { NFT_CARDS } from './nftCards.ts';
import { sepoliaTransport } from './rpc.ts';

export interface NftEnv {
  SEPOLIA_RPC_URL: string;
  SEPOLIA_RPC_FALLBACKS?: string;
  CARDS_ADDRESS?: string;
}

const CARDS_ABI = [
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

/** SqueaksyCards.SERIAL_BASE */
export const SERIAL_BASE = 1_000_000n;

function reply(status: number, body: unknown, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
      // Cüzdanlar ve pazar yerleri tarayıcıdan da okur
      'access-control-allow-origin': '*',
    },
  });
}

/** tokenId → NFT bilgisi (ERC-721 metadata JSON) */
export async function handleNft(req: Request, env: NftEnv, rawId: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, { error: 'method_not_allowed' }, 'no-store');
  if (!/^[1-9]\d{0,9}$/.test(rawId)) return reply(400, { error: 'bad_token_id' }, 'no-store');
  const cards = env.CARDS_ADDRESS?.toLowerCase();
  if (!cards || !isAddress(cards) || !env.SEPOLIA_RPC_URL) return reply(503, { error: 'unavailable' }, 'no-store');

  const tokenId = BigInt(rawId);
  const cardType = tokenId / SERIAL_BASE;
  const serial = tokenId % SERIAL_BASE;
  const card = NFT_CARDS.find((c) => BigInt(c.chainType) === cardType);
  // Bilinmeyen tür ya da arzın dışındaki kopya no: zincire sormadan yok
  if (!card || serial < 1n || serial > BigInt(card.maxSupply)) return reply(404, { error: 'not_minted' }, 'no-store');

  const client = createPublicClient({ chain: sepolia, transport: sepoliaTransport(env) });
  let minted: number;
  try {
    const [, , m] = await client.readContract({ address: cards as Hex, abi: CARDS_ABI, functionName: 'cards', args: [cardType] });
    minted = m;
  } catch {
    return reply(502, { error: 'chain_unreachable' }, 'no-store');
  }
  // Henüz mint edilmedi (önbelleğe alınmaz: mint olunca hemen görünsün)
  if (serial > BigInt(minted)) return reply(404, { error: 'not_minted' }, 'no-store');

  const origin = new URL(req.url).origin;
  const n = Number(serial);
  const fmt = (v: number) => v.toLocaleString('en-US');
  const stars = (v: number) => `+${v} ${v === 1 ? 'star' : 'stars'}`;
  const earn =
    card.kind === 'Hamster'
      ? `Runs the wheel for ${stars(card.starsPerBlock ?? 0)} per block.`
      : `Rides on a hamster's back for ${stars(card.bonusPerBlock ?? 0)} per block.`;
  const body = {
    name: `${card.name} #${n}`,
    description: `${card.flavor} ${card.rarity} ${card.kind} card from the Squeaksy ${card.set} set, ${fmt(n)} of ${fmt(card.maxSupply)}. ${earn} Minted with STARS, soulbound: it stays in its wallet for good. Play at squeaksy.xyz.`,
    image: `${origin}/nft/${card.id}.png`,
    external_url: `${origin}/#market`,
    attributes: [
      { trait_type: 'Kind', value: card.kind },
      { trait_type: 'Type', value: card.type },
      { trait_type: 'Rarity', value: card.rarity },
      card.kind === 'Hamster'
        ? { trait_type: 'Stars per block', value: card.starsPerBlock, display_type: 'number' }
        : { trait_type: 'Bonus per block', value: card.bonusPerBlock, display_type: 'number' },
      ...card.stats.map((s) => ({ trait_type: s.label, value: s.value, max_value: 5 })),
      { trait_type: 'Serial', value: n, display_type: 'number', max_value: card.maxSupply },
      { trait_type: 'Max supply', value: card.maxSupply, display_type: 'number' },
      { trait_type: 'Set', value: card.set },
      { trait_type: 'Soulbound', value: 'Yes' },
    ],
  };
  // Kart bilgisi değişmez (kopya numarası kalıcı): 1 saat önbellek
  return reply(200, body, 'public, max-age=3600');
}
