/**
 * Kart mint'i: cüzdandaki STARS yakılır, kart zincirde soulbound olarak cüzdana gelir (bkz. docs/onchain.md).
 *   1. Hazırlık: cüzdan + Sepolia, cüzdan oyuncunun bağlı cüzdanı mı, zincirde kart açık / stokta / sende yok, STARS yeterli
 *   2. Cüzdanda tek işlem: SqueaksyCards.mint(cardType) (izin / approve gerekmez: kontrat STARS'ı kendisi yakar)
 *   3. Sepolia'da onay, sonra zincir okuyucu kartı görene kadar beklenir (oyun kartı tanısın, hemen koşturulabilsin)
 * Hata hiçbir şey kaybettirmez: işlem geri dönerse STARS da yerinde kalır.
 * Bu dosya Mint'e ilk basışta yüklenir (viem ile birlikte).
 */
import { encodeFunctionData, type Hex } from 'viem';
import type { SupabaseBackend } from '../auth/supabaseBackend';
import { cardById } from '../collection/cards';
import { EXPLORER, shortAddress } from '../wallet/chain';
import { sepoliaClient } from './rpc';
import { SwitchError, chainName, sepoliaHelp, type WalletManager } from '../wallet/wallet';
import { CARDS_ADDRESS, STARS_ADDRESS } from './config';
import { feeCaps } from './fees';

const CARDS_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'cardType', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'giftMint',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'cardType', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'signature', type: 'bytes' }],
    outputs: [{ type: 'uint256' }],
  },
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
  { type: 'function', name: 'hasCard', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
] as const;
const STARS_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'walletOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
] as const;

const FAUCET = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';

export type MintStep = 1 | 2 | 3;
export type MintStatus =
  | { kind: 'busy'; step: MintStep; text: string; tx?: string }
  | { kind: 'done'; tx: string; serial?: number }
  | { kind: 'error'; step: MintStep; text: string; title?: string; link?: { href: string; label: string } };

export interface MintDeps {
  backend: SupabaseBackend;
  wallet: WalletManager;
  playerId: string;
  openWallet: () => void;
  /** Sitenin zaten bildiği (işlem sonrası korunan) bağ ve bakiye: yeni bir okuma henüz işlemi görmemiş sunucuya denk gelebilir */
  linkedHint?: string | null;
  starsHint?: number | null;
}

const pub = sepoliaClient;

interface Pending {
  hash: Hex;
  card: string;
  at: number;
}
const pendingKey = (playerId: string) => `squeaksy.mintTx.${playerId}`;
function readPending(playerId: string): Pending[] {
  try {
    const v = JSON.parse(localStorage.getItem(pendingKey(playerId)) ?? '[]') as Pending[];
    return Array.isArray(v) ? v.filter((p) => /^0x[0-9a-f]{64}$/i.test(p.hash) && typeof p.card === 'string') : [];
  } catch {
    return [];
  }
}
function writePending(playerId: string, list: Pending[]): void {
  try {
    if (list.length) localStorage.setItem(pendingKey(playerId), JSON.stringify(list));
    else localStorage.removeItem(pendingKey(playerId));
  } catch {
    /* depolama kapalı */
  }
}
const dropPending = (playerId: string, hash: Hex) => writePending(playerId, readPending(playerId).filter((p) => p.hash !== hash));

/** Bu kart için yolda olan bir mint işlemi var mı (çift gönderimi önler) */
export function pendingMint(playerId: string, card: string): Pending | null {
  return readPending(playerId).find((p) => p.card === card) ?? null;
}

/** Cüzdandaki STARS (doğrudan zincirden, okuyucu gecikmesi yok) */
export async function walletStars(address: string): Promise<number> {
  if (!STARS_ADDRESS) return 0;
  const v = await pub.readContract({ address: STARS_ADDRESS as Hex, abi: STARS_ABI, functionName: 'balanceOf', args: [address as Hex] });
  return Number(v);
}

/**
 * Hesabın bağlı cüzdanı doğrudan zincirden. Zincir okuyucu ilk claim'den sonra 10-60 sn geride kalabilir;
 * bu arada oyuncuya "önce claim et" denmesin.
 */
export async function chainLinkedWallet(account: string): Promise<string | null> {
  if (!STARS_ADDRESS || !/^0x[0-9a-f]{64}$/i.test(account)) return null;
  const w = await pub.readContract({ address: STARS_ADDRESS as Hex, abi: STARS_ABI, functionName: 'walletOf', args: [account as Hex] });
  return /^0x0{40}$/.test(w) ? null : w.toLowerCase();
}

/** Zincirdeki kart bilgisi (fiyat, arz) */
export async function chainCard(cardType: number): Promise<{ price: number; maxSupply: number; minted: number; exists: boolean; mintOpen: boolean }> {
  const [price, maxSupply, minted, exists, mintOpen] = await pub.readContract({
    address: CARDS_ADDRESS as Hex,
    abi: CARDS_ABI,
    functionName: 'cards',
    args: [BigInt(cardType)],
  });
  return { price: Number(price), maxSupply, minted, exists, mintOpen };
}

function walletError(err: unknown): MintStatus {
  const e = err as { code?: number; message?: string; shortMessage?: string };
  const msg = String(e.message ?? e.shortMessage ?? '');
  if (e.code === 4001 || /reject|denied|cancel/i.test(msg)) return { kind: 'error', step: 2, text: 'Cancelled in your wallet. Your STARS are safe.' };
  if (/insufficient funds|exceeds balance/i.test(msg))
    return { kind: 'error', step: 2, text: 'Not enough Sepolia ETH for the network fee. Get a little from a faucet, then mint again.', link: { href: FAUCET, label: 'Sepolia faucet' } };
  console.warn('[Squeaksy] mint işlemi gönderilemedi', e.code, msg);
  return { kind: 'error', step: 2, text: 'The wallet could not send the mint. Your STARS are safe, try again.' };
}


/** Zincir okuyucu kartı görene kadar bekle (en fazla ~3 dk); görünce true */
export async function waitIndexed(backend: SupabaseBackend, card: string): Promise<boolean> {
  const until = Date.now() + 3 * 60_000;
  while (Date.now() < until) {
    try {
      if ((await backend.fetchOwned()).includes(card)) return true;
    } catch {
      /* geçici hata: tekrar dene */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** İşlemi bekle (makbuz). */
async function waitFor(deps: MintDeps, p: Pending, onStatus: (s: MintStatus) => void): Promise<boolean> {
  const tx = `${EXPLORER}/tx/${p.hash}`;
  onStatus({ kind: 'busy', step: 3, text: 'Minting on Sepolia. This takes a few seconds.', tx });
  try {
    const rc = await pub.waitForTransactionReceipt({ hash: p.hash, timeout: 10 * 60_000, pollingInterval: 2_000 });
    dropPending(deps.playerId, p.hash);
    if (rc.status !== 'success') {
      onStatus({ kind: 'error', step: 3, text: 'The mint did not go through. Your STARS are safe, try again.', link: { href: tx, label: 'View transaction' } });
      return false;
    }
    // Zincirde onaylandı: hemen "yours". Kart koleksiyona hemen eklenir; oyun sunucusu (zincir okuyucu)
    // ~10-60 sn içinde yetişir, o arada kartı takmak kısa bir "syncing" mesajı verir (inventory.ts).
    onStatus({ kind: 'done', tx });
    return true;
  } catch (err) {
    console.warn('[Squeaksy] mint makbuzu beklenemedi', err);
    if (Date.now() - p.at > 30 * 60_000) dropPending(deps.playerId, p.hash);
    onStatus({ kind: 'error', step: 3, title: 'Still waiting', text: 'Sepolia is slow right now. The mint finishes on its own; the card shows up when it lands.', link: { href: tx, label: 'View transaction' } });
    return false;
  }
}

/** Sayfa açılışında: yarım kalmış mint işlemlerini takip et; biten kartlar için onDone çağrılır */
export async function resumeMints(deps: MintDeps, onDone: (card: string) => void): Promise<void> {
  await Promise.all(
    readPending(deps.playerId).map(async (p) => {
      if (await waitFor(deps, p, () => undefined)) onDone(p.card);
    }),
  );
}

let attempt = 0;
/** Bekleyen denemeyi bırak (cüzdan cevap vermeden kapatıldı). İşlem sonradan onaylanırsa yine takip edilir. */
export function cancelMint(): void {
  attempt++;
}

/**
 * Mint: başarılıysa true. onStatus her adımda çağrılır; Cancel'dan sonra gelen bildirimler gönderilmez
 * (işlem yine de onaylanırsa onLate ile haber verilir).
 */
export async function runMint(deps: MintDeps, cardId: string, onStatus: (s: MintStatus) => void, onLate: (card: string) => void): Promise<boolean> {
  const my = ++attempt;
  const out = onStatus;
  onStatus = (st) => {
    if (my === attempt) out(st);
  };
  const fail = (step: MintStep, text: string, extra: Partial<Extract<MintStatus, { kind: 'error' }>> = {}) => {
    onStatus({ kind: 'error', step, text, ...extra });
    return false;
  };

  const { wallet, backend, playerId } = deps;
  const card = cardById(cardId);
  const cardType = card?.chainType;
  if (!card || !cardType) return fail(1, 'This card cannot be minted.');
  if (!CARDS_ADDRESS || !STARS_ADDRESS) return fail(1, 'Minting is not set up on this site yet.');
  const already = pendingMint(playerId, cardId);
  if (already) return waitFor(deps, already, onStatus);

  if (!wallet.connected || !wallet.eip1193 || !wallet.state.address) {
    deps.openWallet();
    return fail(1, 'Connect your wallet, then press Mint again.');
  }
  if (!wallet.onSepolia) {
    onStatus({ kind: 'busy', step: 1, text: 'Switching your wallet to Sepolia…' });
    try {
      await wallet.switchToSepolia();
    } catch (err) {
      return fail(
        1,
        err instanceof SwitchError && err.reason === 'rejected'
          ? 'Switch cancelled. Cards are minted on Sepolia.'
          : `Your wallet stayed on ${chainName(err instanceof SwitchError ? err.chainId : wallet.state.chainId)}. ${sepoliaHelp(wallet.state.name)}`,
      );
    }
  }
  const address = wallet.state.address.toLowerCase() as Hex;

  onStatus({ kind: 'busy', step: 1, text: 'Checking the card and your STARS…' });
  // Kart yalnızca oyuncunun bağlı cüzdanındaysa oyunda sayılır (yıldızlar da o cüzdana claim edilir)
  let linked: string | null;
  try {
    const me = await backend.fetchOnchainMe();
    // Okuyucu henüz görmediyse (ilk claim'den hemen sonra) zincirden
    linked = me?.wallet ?? deps.linkedHint ?? (me?.account ? await chainLinkedWallet(me.account) : null);
  } catch {
    return fail(1, 'Could not reach the game server. Nothing was spent, try again.');
  }
  if (!linked) return fail(1, 'Claim your stars to your wallet first. Cards are minted with the STARS in that wallet.');
  if (linked.toLowerCase() !== address) return fail(1, `Your stars are linked to ${shortAddress(linked)}. Connect that wallet to mint.`);

  let info: Awaited<ReturnType<typeof chainCard>>, have: number, alreadyOwned: boolean, paused: boolean;
  try {
    [info, have, alreadyOwned, paused] = await Promise.all([
      chainCard(cardType),
      walletStars(address),
      pub.readContract({ address: CARDS_ADDRESS as Hex, abi: CARDS_ABI, functionName: 'hasCard', args: [address, BigInt(cardType)] }),
      pub.readContract({ address: CARDS_ADDRESS as Hex, abi: CARDS_ABI, functionName: 'paused' }),
    ]);
  } catch {
    return fail(1, 'Sepolia is not responding right now. Nothing was spent, try again in a minute.');
  }
  have = Math.max(have, deps.starsHint ?? 0);
  if (alreadyOwned) {
    onLate(cardId);
    return fail(1, `You already have ${card.name}. It is in your collection.`, { title: 'Already yours' });
  }
  if (paused || !info.exists || !info.mintOpen) return fail(1, 'Minting this card is paused for a moment. Try again later.');
  if (info.minted >= info.maxSupply) return fail(1, 'Sold out! Every one of them has an owner.', { title: 'Sold out' });
  if (have < info.price)
    return fail(1, `You have ${have.toLocaleString('en-US')} STARS in your wallet and need ${info.price.toLocaleString('en-US')}. Claim more stars first.`, { title: 'Not enough STARS' });

  onStatus({ kind: 'busy', step: 2, text: `Confirm in your wallet to mint ${card.name} for ${info.price.toLocaleString('en-US')} STARS.` });
  if (!(await wallet.confirmSepolia())) return fail(2, 'Your wallet left Sepolia. Nothing was sent. Press Mint again to switch back.');
  let hash: Hex;
  try {
    const fees = await feeCaps(pub as never).catch(() => null);
    hash = (await wallet.eip1193.request({
      method: 'eth_sendTransaction',
      params: [{ from: address, to: CARDS_ADDRESS, data: encodeFunctionData({ abi: CARDS_ABI, functionName: 'mint', args: [BigInt(cardType)] }), ...(fees ?? {}) }],
    })) as Hex;
  } catch (err) {
    if (my !== attempt) return false;
    onStatus(walletError(err));
    return false;
  }
  const p: Pending = { hash, card: cardId, at: Date.now() };
  writePending(playerId, [...readPending(playerId), p]);
  if (my !== attempt) {
    // Cancel'dan sonra onaylandı: işlem gerçek, arka planda takip edilir
    void waitFor(deps, p, () => undefined).then((ok) => ok && onLate(cardId));
    return false;
  }
  return waitFor(deps, p, onStatus);
}

/** Hediye sunucusu (Worker /api/gift-voucher) hata kodları → oyuncu metni */
function giftVoucherError(code: string, body: Record<string, unknown>): string {
  switch (code) {
    case 'not_signed_in':
      return 'Sign in first, then claim your gift.';
    case 'no_gift':
      return 'There is no gift on this account.';
    case 'gift_locked':
      return `Your gift is reserved for ${shortAddress(String(body.wallet ?? ''))}. Connect that wallet to claim it.`;
    case 'wallet_used':
      return 'This wallet is already linked to another player. Connect a different wallet.';
    case 'account_bound':
      return `Your account is linked to ${shortAddress(String(body.wallet ?? ''))}. Connect that wallet to claim your gift.`;
    case 'already_owned':
      return 'This card is already in your wallet.';
    case 'sold_out':
      return 'Sold out! Every one of them has an owner.';
    case 'paused':
      return 'Gifts are paused for a moment. Your gift is safe, try again later.';
    case 'chain_unreachable':
      return 'Sepolia is not responding right now. Your gift is safe, try again in a minute.';
    default:
      return 'Your gift is not available right now. It is safe, try again later.';
  }
}

/**
 * Early oyuncu hediyesi: sunucu fişiyle STARS yakmadan mint (SqueaksyCards.giftMint). Akış ve adımlar mint ile aynı;
 * ilk claim gerekmez, oyuncu yalnızca küçük ağ ücretini öder. Bir hediye yalnızca bir cüzdana (sunucuda kilit).
 */
export async function runGift(deps: MintDeps, cardId: string, onStatus: (s: MintStatus) => void, onLate: (card: string) => void): Promise<boolean> {
  const my = ++attempt;
  const out = onStatus;
  onStatus = (st) => {
    if (my === attempt) out(st);
  };
  const fail = (step: MintStep, text: string, extra: Partial<Extract<MintStatus, { kind: 'error' }>> = {}) => {
    onStatus({ kind: 'error', step, text, ...extra });
    return false;
  };

  const { wallet, backend, playerId } = deps;
  const card = cardById(cardId);
  const cardType = card?.chainType;
  if (!card || !cardType) return fail(1, 'This gift is not available.');
  if (!CARDS_ADDRESS) return fail(1, 'Gifts are not set up on this site yet.');
  const already = pendingMint(playerId, cardId);
  if (already) return waitFor(deps, already, onStatus);

  if (!wallet.connected || !wallet.eip1193 || !wallet.state.address) {
    deps.openWallet();
    return fail(1, 'Connect your wallet, then claim your gift.');
  }
  if (!wallet.onSepolia) {
    onStatus({ kind: 'busy', step: 1, text: 'Switching your wallet to Sepolia…' });
    try {
      await wallet.switchToSepolia();
    } catch (err) {
      return fail(
        1,
        err instanceof SwitchError && err.reason === 'rejected'
          ? 'Switch cancelled. Gifts are minted on Sepolia.'
          : `Your wallet stayed on ${chainName(err instanceof SwitchError ? err.chainId : wallet.state.chainId)}. ${sepoliaHelp(wallet.state.name)}`,
      );
    }
  }
  const address = wallet.state.address.toLowerCase() as Hex;

  onStatus({ kind: 'busy', step: 1, text: 'Preparing your gift…' });
  const token = await backend.accessToken();
  if (!token) return fail(1, 'Sign in again, then claim your gift.');
  let body: Record<string, unknown>;
  let okRes: boolean;
  try {
    const res = await fetch('/api/gift-voucher', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ wallet: address }),
    });
    okRes = res.ok;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    return fail(1, 'Could not reach the gift server. Your gift is safe, try again.');
  }
  if (!okRes) {
    if (body.error === 'already_owned') onLate(cardId);
    return fail(1, giftVoucherError(String(body.error ?? ''), body), body.error === 'already_owned' ? { title: 'Already yours' } : {});
  }
  if (String(body.cards).toLowerCase() !== CARDS_ADDRESS || String(body.wallet).toLowerCase() !== address || Number(body.cardType) !== cardType) {
    return fail(1, 'The gift server answered for a different card or wallet. Nothing was sent.');
  }

  onStatus({ kind: 'busy', step: 2, text: `Confirm in your wallet to receive ${card.name}. It is free, only the small network fee applies.` });
  if (!(await wallet.confirmSepolia())) return fail(2, 'Your wallet left Sepolia. Nothing was sent. Claim your gift again to switch back.');
  let hash: Hex;
  try {
    const fees = await feeCaps(pub as never).catch(() => null);
    hash = (await wallet.eip1193.request({
      method: 'eth_sendTransaction',
      params: [{ from: address, to: CARDS_ADDRESS, data: encodeFunctionData({ abi: CARDS_ABI, functionName: 'giftMint', args: [BigInt(cardType), BigInt(String(body.deadline)), body.signature as Hex] }), ...(fees ?? {}) }],
    })) as Hex;
  } catch (err) {
    if (my !== attempt) return false;
    const st = walletError(err);
    onStatus(st.kind === 'error' ? { ...st, text: st.text.replace('Your STARS are safe', 'Your gift is safe').replace('the mint', 'the gift') } : st);
    return false;
  }
  const p: Pending = { hash, card: cardId, at: Date.now() };
  writePending(playerId, [...readPending(playerId), p]);
  if (my !== attempt) {
    void waitFor(deps, p, () => undefined).then((ok) => ok && onLate(cardId));
    return false;
  }
  return waitFor(deps, p, onStatus);
}
