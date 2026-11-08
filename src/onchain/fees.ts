/**
 * Sepolia işlem ücreti: Sepolia'da temel ücret neredeyse 0, ücretin tamamı bahşiş (öncelik ücreti).
 * Ölçüm (2026-11-08): bloklar ortalama %35 dolu, en düşük bahşişli işlemler bile her bloğa giriyor; 0,05 gwei yeterli.
 * MetaMask'ın varsayılanı (~1-1,5 gwei) aynı işlemi ~24 kat pahalı yapıyordu.
 * Bloklar gerçekten dolmaya başlarsa (son 5 blok ortalaması %80 üstü) sıradaki bloğa girmek için orta seviye
 * (%25'lik dilim) bahşiş, en fazla 1 gwei. Üst sınır: taban ücretin 2 katı + bahşiş.
 */
import type { PublicClient } from 'viem';

const CHEAP_TIP = 50_000_000n; // 0,05 gwei
const MAX_TIP = 1_000_000_000n; // 1 gwei

export async function feeCaps(pub: PublicClient): Promise<{ maxFeePerGas: `0x${string}`; maxPriorityFeePerGas: `0x${string}` }> {
  const [blk, hist] = await Promise.all([
    pub.getBlock(),
    pub.getFeeHistory({ blockCount: 5, rewardPercentiles: [25] }).catch(() => null),
  ]);
  const base = blk.baseFeePerGas ?? 1_000_000_000n;
  let tip = CHEAP_TIP;
  const ratios = hist?.gasUsedRatio ?? [];
  const busy = ratios.length > 0 && ratios.reduce((a, b) => a + b, 0) / ratios.length > 0.8;
  if (busy) {
    const tips = (hist?.reward ?? []).map((r) => r[0] ?? 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const mid = tips.length ? tips[Math.floor(tips.length / 2)]! : CHEAP_TIP;
    tip = mid < CHEAP_TIP ? CHEAP_TIP : mid > MAX_TIP ? MAX_TIP : mid;
  }
  return { maxFeePerGas: `0x${(base * 2n + tip).toString(16)}`, maxPriorityFeePerGas: `0x${tip.toString(16)}` };
}
