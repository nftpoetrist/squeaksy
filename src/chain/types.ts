/**
 * Squeekchain Live: sunucunun (Supabase chain_live()) verdiği canlı zincir durumu.
 * Squeekchain'in kendi şeması: coreStatus ∈ IDLE | ACTIVE | COUNTER_FAULT ('SPINNING' diye bir değer yok).
 * UNKNOWN: veri yok / tanınmayan değer.
 */
export type WheelStatus = 'IDLE' | 'ACTIVE' | 'COUNTER_FAULT' | 'UNKNOWN';

/** Gerçek blok(lar) zincire indi: herkesin ekranında fırtına */
export interface ChainStorm {
  /** tx_hash:log_index (kesinleşme kimliği) */
  id: string;
  /** Bu kesinleşmede tamamlanan gerçek blok sayısı */
  blocks: number;
  first: number;
  last: number;
  /** Sepolia işlem özeti (0x + 64 hex) */
  tx: string;
  /** Sunucunun kaydettiği an */
  at: string;
  /** Fırtına anında hamsteri koşan oyuncunun alacağı Block Bounty (0 = bu inişte ödül yok) */
  bounty: number;
  /**
   * Yalnızca bilgi: sunucu kurulmadan önceki bir iniş (bilgi balonunda "Last landing" + Sepolia bağlantısı için).
   * Asla fırtına ya da ödül tetiklemez.
   */
  historic?: boolean;
}

export interface ChainLive {
  serverTime: string;
  /** Son /v1/status okuması (null: hiç okunmadı) */
  statusAt: string | null;
  coreAt: string | null;
  wheel: { status: WheelStatus; hardware: boolean; fresh: boolean; observedAt: string | null };
  build: {
    /** Güvenli (12 onaylı) kesinleşmiş son blok yüksekliği */
    settledHeight: number | null;
    settledProgressPpb: number | null;
    /** Squeekchain'in tahmini (optimistic) durumu: sadece görsel */
    projectedHeight: number | null;
    projectedProgressPpb: number | null;
  };
  lastStorm: ChainStorm | null;
  bounty: { enabled: boolean; perBlock: number; min: number; max: number; windowSeconds: number };
}

/**
 * claim_storm_bounty sonucu. granted dışındaki her durumda hiçbir şey kaydedilmez.
 * not_running: sunucuya göre hamster son saniyelerde blok kazanmadı · expired: iniş çok eski ·
 * already: bu inişin ödülü zaten alındı · unavailable: bu inişte ödül yok / ödüller kapalı
 */
export interface BountyClaim {
  status: 'granted' | 'not_running' | 'expired' | 'already' | 'unavailable';
  bounty: number;
  balance: number | null;
}

/** Zincir verisinin kaynağı (Supabase; geliştirmede sahte) */
export interface ChainSource {
  fetchChainLive(): Promise<ChainLive | null>;
  /** Fırtına anında koşan oyuncu ödülü ister; sunucu koşuyu kendi kaydından doğrular (misafirde null) */
  claimStormBounty(settlementId: string): Promise<BountyClaim | null>;
}

const TX_RE = /^0x[0-9a-f]{64}$/;

/** Sunucudan gelen veriyi tipine oturtur; beklenmeyen alan tipinde null döner (güvenli taraf). */
export function parseChainLive(raw: unknown): ChainLive | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, any>;
  const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const w = j.wheel ?? {};
  const b = j.build ?? {};
  const st = ['IDLE', 'ACTIVE', 'COUNTER_FAULT'].includes(w.status) ? (w.status as WheelStatus) : 'UNKNOWN';
  const s = j.lastStorm;
  const storm: ChainStorm | null =
    s && typeof s.id === 'string' && typeof s.tx === 'string' && TX_RE.test(s.tx) && num(s.blocks) !== null
      ? { id: s.id, blocks: num(s.blocks)!, first: num(s.first) ?? 0, last: num(s.last) ?? 0, tx: s.tx, at: str(s.at) ?? '', bounty: Math.max(0, Math.floor(num(s.bounty) ?? 0)) }
      : null;
  const bo = j.bounty ?? {};
  return {
    serverTime: str(j.serverTime) ?? new Date().toISOString(),
    statusAt: str(j.statusAt),
    coreAt: str(j.coreAt),
    wheel: { status: st, hardware: w.hardware === true, fresh: w.fresh === true, observedAt: str(w.observedAt) },
    build: {
      settledHeight: num(b.settledHeight),
      settledProgressPpb: num(b.settledProgressPpb),
      projectedHeight: num(b.projectedHeight),
      projectedProgressPpb: num(b.projectedProgressPpb),
    },
    lastStorm: storm,
    bounty: {
      enabled: bo.enabled === true,
      perBlock: num(bo.perBlock) ?? 0,
      min: num(bo.min) ?? 0,
      max: num(bo.max) ?? 0,
      windowSeconds: num(bo.windowSeconds) ?? 0,
    },
  };
}

const CLAIM_STATUS = ['granted', 'not_running', 'expired', 'already', 'unavailable'] as const;

export function parseBountyClaim(raw: unknown): BountyClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, any>;
  if (!CLAIM_STATUS.includes(j.status)) return null;
  const bal = Number(j.balance);
  return {
    status: j.status,
    bounty: j.status === 'granted' ? Math.max(0, Math.floor(Number(j.bounty) || 0)) : 0,
    balance: j.balance === null || j.balance === undefined || !Number.isFinite(bal) ? null : bal,
  };
}

export function sepoliaTxUrl(tx: string): string | null {
  return TX_RE.test(tx) ? `https://sepolia.etherscan.io/tx/${tx}` : null;
}
