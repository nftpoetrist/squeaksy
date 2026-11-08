/**
 * Claim: oyunda kazanılan yıldızlar zincirde STARS olarak cüzdana geçer (bkz. docs/onchain.md).
 *   1. Giriş + cüzdan + Sepolia kontrolü (cüzdan bağlı değilse bağlanma penceresi açılır)
 *   2. Bekleyen bloklar sunucuya yazılır (kazanılan toplam güncel olsun)
 *   3. Sunucudan (Worker /api/claim-voucher) imzalı fiş: hesabın kazandığı TOPLAM
 *   4. Cüzdanda tek işlem: SqueaksyStars.claim(...) → kontrat farkı mint eder
 *   5. İşlem kaydedilir (sayfa yenilense de takip sürer), makbuz gelince sayaç düşer
 * Hiçbir hata yıldız silmez: sunucuda hiçbir şey düşülmez, sayı yalnızca zincirde onaylanan claim kadar azalır.
 * Bu dosya Claim'e ilk basışta yüklenir (viem ile birlikte): sayfanın açılışını ağırlaştırmaz.
 */
import { encodeFunctionData, type Hex } from 'viem';
import type { TokenLedger } from '../auth/ledger';
import type { SupabaseBackend } from '../auth/supabaseBackend';
import { EXPLORER } from '../wallet/chain';
import { sepoliaClient } from './rpc';
import { SwitchError, chainName, sepoliaHelp, type WalletManager } from '../wallet/wallet';
import { STARS_ADDRESS } from './config';
import { feeCaps } from './fees';

const CLAIM_ABI = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'bytes32' },
      { name: 'totalEarned', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
] as const;

const FAUCET = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';

export type ClaimStatus =
  | { kind: 'idle' }
  /** step: 1 hazırlık (ağ, kayıt, fiş) · 2 cüzdanda onay · 3 Sepolia'da onaylanıyor */
  | { kind: 'busy'; text: string; step: 1 | 2 | 3; tx?: string }
  | { kind: 'done'; amount: number; tx: string }
  | { kind: 'error'; text: string; step?: 1 | 2 | 3; title?: string; link?: { href: string; label: string } };

export interface ClaimDeps {
  backend: SupabaseBackend;
  wallet: WalletManager;
  ledger: TokenLedger;
  openWallet: () => void;
}

interface Pending {
  hash: Hex;
  total: number;
  amount: number;
  at: number;
}

const pub = sepoliaClient;
const pendingKey = (playerId: string) => `squeaksy.claimTx.${playerId}`;

function readPending(playerId: string): Pending | null {
  try {
    const v = JSON.parse(localStorage.getItem(pendingKey(playerId)) ?? 'null') as Pending | null;
    return v && /^0x[0-9a-f]{64}$/i.test(v.hash) ? v : null;
  } catch {
    return null;
  }
}
function writePending(playerId: string, p: Pending | null): void {
  try {
    if (p) localStorage.setItem(pendingKey(playerId), JSON.stringify(p));
    else localStorage.removeItem(pendingKey(playerId));
  } catch {
    /* depolama kapalı: takip yalnızca bu sayfada */
  }
}

/** Sunucu (Worker) hata kodları → oyuncu metni */
function voucherError(code: string, body: Record<string, unknown>): string {
  switch (code) {
    case 'not_signed_in':
      return 'Sign in first, then claim.';
    case 'nothing_to_claim':
      return 'Nothing to claim yet. Run your hamster to earn stars.';
    case 'account_bound':
      return `Your stars are linked to ${String(body.wallet ?? 'another wallet')}. Connect that wallet to claim.`;
    case 'wallet_used':
      return 'This wallet is already linked to another player. Connect a different wallet.';
    case 'paused':
      return 'Claiming is paused for a moment. Your stars are safe, try again later.';
    case 'chain_unreachable':
      return 'Sepolia is not responding right now. Your stars are safe, try again in a minute.';
    default:
      return 'Claiming is not available right now. Your stars are safe, try again later.';
  }
}

/** Cüzdan hatası → oyuncu metni (+ gerekirse faucet bağlantısı) */
function walletError(err: unknown): ClaimStatus {
  const e = err as { code?: number; message?: string; shortMessage?: string };
  const msg = String(e.message ?? e.shortMessage ?? '');
  if (e.code === 4001 || /reject|denied|cancel/i.test(msg)) return { kind: 'error', text: 'Cancelled in your wallet. Your stars are safe.' };
  if (/insufficient funds|exceeds balance|not enough/i.test(msg))
    return { kind: 'error', text: 'Not enough Sepolia ETH for the network fee. Get a little from a faucet, then claim again.', link: { href: FAUCET, label: 'Sepolia faucet' } };
  console.warn('[Squeaksy] claim işlemi gönderilemedi', e.code, msg);
  return { kind: 'error', text: 'The wallet could not send the claim. Your stars are safe, try again.' };
}


/** İşlemi bekle: başarılıysa sayaç düşer (onaylanmış toplam ipucu), değilse yıldızlar yerinde kalır */
async function waitFor(deps: ClaimDeps, playerId: string, p: Pending, onStatus: (s: ClaimStatus) => void): Promise<void> {
  onStatus({ kind: 'busy', step: 3, text: 'Confirming on Sepolia. This takes a few seconds.', tx: `${EXPLORER}/tx/${p.hash}` });
  try {
    const rc = await pub.waitForTransactionReceipt({ hash: p.hash, timeout: 10 * 60_000, pollingInterval: 2_000 });
    writePending(playerId, null);
    if (rc.status !== 'success') {
      await deps.ledger.syncBalance();
      onStatus({ kind: 'error', step: 3, text: 'The claim did not go through. Your stars are safe, try again.' });
      return;
    }
    // Zincirde onaylandı: okuyucu yetişene kadar sayaç bu toplamla hesaplanır (geri yükselmez)
    deps.backend.setClaimedHint(p.total);
    await deps.ledger.syncBalance();
    onStatus({ kind: 'done', amount: p.amount, tx: `${EXPLORER}/tx/${p.hash}` });
  } catch (err) {
    // Zaman aşımı / ağ: işlem hâlâ yolda olabilir; kayıt durur, sonraki açılışta takip sürer
    console.warn('[Squeaksy] claim makbuzu beklenemedi', err);
    if (Date.now() - p.at > 30 * 60_000) writePending(playerId, null);
    onStatus({ kind: 'error', step: 3, title: 'Still waiting', text: 'Sepolia is slow right now. Your stars are safe; the claim finishes on its own.', link: { href: `${EXPLORER}/tx/${p.hash}`, label: 'View transaction' } });
  }
}

/** Sayfa açılışında: yarım kalmış claim işlemini takip et */
export async function resumeClaim(deps: ClaimDeps, onStatus: (s: ClaimStatus) => void): Promise<void> {
  const id = deps.ledger.playerId;
  if (!id) return;
  const p = readPending(id);
  if (p) await waitFor(deps, id, p, onStatus);
}

let running = false;
/** Her Claim denemesinin numarası: Cancel ile artar; eski denemenin geç gelen cevabı arayüzü değiştirmez */
let attempt = 0;

/**
 * Bekleyen denemeyi bırak (ör. MetaMask cevap vermeden kapatıldı). Cüzdan isteği yine de sonradan onaylanırsa işlem
 * kaybolmaz: hash kaydedilir ve takip edilir (sonucu yine gösterilir).
 */
export function cancelClaim(): void {
  attempt++;
  running = false;
}

export async function runClaim(deps: ClaimDeps, onStatus: (s: ClaimStatus) => void): Promise<void> {
  if (running) return;
  running = true;
  const my = ++attempt;
  // Bırakılmış denemenin durum bildirimleri arayüze gitmez
  const out = onStatus;
  onStatus = (st: ClaimStatus) => {
    if (my === attempt) out(st);
  };
  try {
    const { backend, wallet, ledger } = deps;
    const playerId = ledger.playerId;
    if (!playerId) return onStatus({ kind: 'error', text: 'Sign in first, then claim.' });
    const already = readPending(playerId);
    if (already) return await waitFor(deps, playerId, already, onStatus);
    if (!wallet.connected || !wallet.eip1193 || !wallet.state.address) {
      deps.openWallet();
      return onStatus({ kind: 'error', text: 'Connect a wallet, then press Claim again.' });
    }
    if (!STARS_ADDRESS) return onStatus({ kind: 'error', text: 'Claiming is not set up on this site yet.' });

    // Ağ: Sepolia değilse geçiş (cüzdan geçmezse nedeni söylenir)
    if (!wallet.onSepolia) {
      onStatus({ kind: 'busy', step: 1, text: 'Switching your wallet to Sepolia…' });
      try {
        await wallet.switchToSepolia();
      } catch (err) {
        return onStatus({
          kind: 'error',
          text:
            err instanceof SwitchError && err.reason === 'rejected'
              ? 'Switch cancelled. Claims happen on Sepolia.'
              : `Your wallet stayed on ${chainName(err instanceof SwitchError ? err.chainId : wallet.state.chainId)}. ${sepoliaHelp(wallet.state.name)}`,
        });
      }
    }

    // Bekleyen bloklar sunucuya: fiş en güncel toplamla imzalansın
    onStatus({ kind: 'busy', step: 1, text: 'Saving your latest stars…' });
    await ledger.flush();

    // Fiş
    onStatus({ kind: 'busy', step: 1, text: 'Preparing your claim…' });
    const token = await backend.accessToken();
    if (!token) return onStatus({ kind: 'error', text: 'Sign in again, then claim.' });
    const address = wallet.state.address;
    let body: Record<string, unknown>;
    let ok: boolean;
    try {
      const res = await fetch('/api/claim-voucher', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: address }),
      });
      ok = res.ok;
      body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      return onStatus({ kind: 'error', text: 'Could not reach the claim server. Your stars are safe, try again.' });
    }
    if (!ok) return onStatus({ kind: 'error', text: voucherError(String(body.error ?? ''), body) });
    const total = Number(body.totalEarned);
    const amount = Number(body.amount);
    if (String(body.stars).toLowerCase() !== STARS_ADDRESS || String(body.wallet).toLowerCase() !== address.toLowerCase()) {
      return onStatus({ kind: 'error', text: 'The claim server answered for a different contract or wallet. Nothing was sent.' });
    }

    // Cüzdanda tek işlem
    onStatus({ kind: 'busy', step: 2, text: `Confirm in your wallet to claim ${amount.toLocaleString('en-US')} stars.` });
    const data = encodeFunctionData({
      abi: CLAIM_ABI,
      functionName: 'claim',
      args: [body.account as Hex, BigInt(String(body.totalEarned)), BigInt(String(body.deadline)), body.signature as Hex],
    });
    if (!(await wallet.confirmSepolia())) {
      return onStatus({ kind: 'error', step: 2, text: 'Your wallet left Sepolia. Nothing was sent. Press Claim again to switch back.' });
    }
    let hash: Hex;
    try {
      const fees = await feeCaps(pub as never).catch(() => null);
      hash = (await wallet.eip1193.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: STARS_ADDRESS, data, ...(fees ?? {}) }],
      })) as Hex;
    } catch (err) {
      return onStatus({ ...walletError(err), step: 2 } as ClaimStatus);
    }
    const p: Pending = { hash, total, amount, at: Date.now() };
    writePending(playerId, p);
    // Cancel'dan sonra onaylandıysa: işlem gerçek, takip edilir ve sonucu yeniden gösterilir
    await waitFor(deps, playerId, p, my === attempt ? onStatus : late);
  } finally {
    if (my === attempt) running = false;
  }
}

/** Bırakılmış bir denemenin işlemi sonradan onaylandığında sonucu gösterecek yer (claimButton bağlar) */
let late: (s: ClaimStatus) => void = () => undefined;
export function onLateClaim(fn: (s: ClaimStatus) => void): void {
  late = fn;
}

/** STARS'ı cüzdanda görünür yap (EIP-747) */
export async function addStarsToWallet(wallet: WalletManager): Promise<boolean> {
  const p = wallet.eip1193;
  if (!p || !STARS_ADDRESS) return false;
  try {
    return Boolean(
      await p.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: STARS_ADDRESS, symbol: 'STARS', decimals: 0 } } }),
    );
  } catch {
    return false;
  }
}
