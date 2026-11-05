import type { BountyClaim, ChainLive, ChainSource, ChainStorm, WheelStatus } from './types';

const API = 'https://api.squeekchain.com';
const CHAIN_ID = '11155111';
const BLOCK_UNITS = 1_000_000_000n;
const TX_RE = /^0x[0-9a-f]{64}$/;

async function getJson(path: string): Promise<any> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(API + path, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`${path}: http ${r.status}`);
    return await r.json();
  } finally {
    window.clearTimeout(t);
  }
}

function units(v: unknown): bigint | null {
  return typeof v === 'string' && /^\d{1,30}$/.test(v) ? BigInt(v) : null;
}

/**
 * Gerçek Squeekchain verisini tarayıcıdan doğrudan okur (api.squeekchain.com, herkese açık, CORS açık).
 * Sunucu (Supabase chain_live) henüz kurulu değilken / ulaşılamazken bulut yine gerçek hamsteri gösterir.
 * YALNIZCA GÖRSEL: tarayıcının okuduğu veriye ödül bağlanmaz (bounty her zaman kapalı, claim yok).
 * Fırtına yalnızca güvenli (12 onaylı, confirmationStatus 'safe') gerçek blok inişinde.
 */
export class DirectChainSource implements ChainSource {
  async fetchChainLive(): Promise<ChainLive | null> {
    const [st, se] = await Promise.all([getJson('/v1/status'), getJson('/v1/settlements?range=7d')]);
    if (se?.chain?.chainId !== CHAIN_ID) throw new Error('settlements: unexpected chain');
    if (st?.installationId && se?.installationId && st.installationId !== se.installationId) throw new Error('installation mismatch');

    const now = typeof st?.generatedAt === 'string' ? st.generatedAt : new Date().toISOString();
    const m = st?.measurement ?? {};
    const status: WheelStatus = ['IDLE', 'ACTIVE', 'COUNTER_FAULT'].includes(m.coreStatus) ? m.coreStatus : 'UNKNOWN';
    const observed = Date.parse(m.observedAt);
    const staleAfter = Math.min(Number(m.staleAfterSeconds) || 120, 600) * 1000;
    const fresh = m.freshness === 'online' && Number.isFinite(observed) && Date.parse(now) - observed < staleAfter;

    // İnşa edilen blok: anchor = zincire yazılmış, projected = Squeekchain'in tahmini (sadece görsel)
    const b = st?.builder?.status === 'available' ? st.builder : null;
    const anchor = units(b?.anchor?.cumulativeBlockUnits);
    const projected = units(b?.projected?.cumulativeBlockUnits);

    // Son güvenli gerçek blok inişi (liste en yeniden eskiye)
    let lastStorm: ChainStorm | null = null;
    for (const s of Array.isArray(se?.recentSettlements) ? se.recentSettlements : []) {
      const tx = typeof s?.transactionHash === 'string' ? s.transactionHash.toLowerCase() : '';
      const blocks = Number(s?.completedBlockCount);
      if (s?.confirmationStatus !== 'safe' || !TX_RE.test(tx) || !(blocks > 0)) continue;
      lastStorm = {
        id: `${tx}:${s.logIndex}`,
        blocks,
        first: Number(s.firstCompletedBlock) || 0,
        last: Number(s.lastCompletedBlock) || 0,
        tx,
        at: typeof s.blockTimestamp === 'string' ? s.blockTimestamp : now,
        bounty: 0,
      };
      break;
    }

    const h = (u: bigint | null) => (u === null ? null : Number(u / BLOCK_UNITS));
    const ppb = (u: bigint | null) => (u === null ? null : Number(u % BLOCK_UNITS));
    return {
      serverTime: now,
      statusAt: now,
      coreAt: typeof se?.generatedAt === 'string' ? se.generatedAt : now,
      wheel: { status, hardware: m.provenance === 'hardware', fresh, observedAt: typeof m.observedAt === 'string' ? m.observedAt : null },
      build: {
        // Güvenli (12 onaylı) son yükseklik: son güvenli inişin son bloğu. Böylece bloklar "iniyor"
        // görünümü fırtına (güvenli iniş) gelene kadar sürer; arada bulut erkenden sıfırlanmaz.
        settledHeight: lastStorm ? Math.max(lastStorm.last, 0) : h(anchor),
        settledProgressPpb: ppb(anchor),
        projectedHeight: h(projected ?? anchor),
        projectedProgressPpb: ppb(projected ?? anchor),
      },
      lastStorm,
      bounty: { enabled: false, perBlock: 0, min: 0, max: 0, windowSeconds: 0 },
    };
  }

  async claimStormBounty(): Promise<BountyClaim | null> {
    return null;
  }
}

/**
 * Önce sunucu (Supabase: doğrulanmış veri + ödüller); sunucu fonksiyonu yoksa / hata verirse
 * gerçek API'den doğrudan (sadece görsel). Ödül talebi her zaman yalnızca sunucuya gider.
 */
export class FallbackChainSource implements ChainSource {
  /** Sunucu bir kez gerçek veri verdiyse artık yedeğe dönülmez: fırtına kimlikleri hep aynı kaynaktan gelir
   *  (aksi halde bir iniş ödülsüz yedekten görülüp sunucudaki ödüllü hali "zaten görüldü" sayılabilirdi) */
  private primaryOk = false;
  /** Sunucu tarafı kurulu değilken (ör. SQL henüz çalıştırılmadı) her yoklamada sorulmaz */
  private skipPrimaryUntil = 0;

  constructor(
    private readonly primary: ChainSource,
    private readonly fallback: ChainSource,
  ) {}

  async fetchChainLive(): Promise<ChainLive | null> {
    if (this.primaryOk || Date.now() >= this.skipPrimaryUntil) {
      try {
        const live = await this.primary.fetchChainLive();
        if (live && live.statusAt) {
          this.primaryOk = true;
          return live;
        }
      } catch {
        /* sunucuya ulaşılamadı / fonksiyon yok */
      }
      // Sunucu daha önce çalıştıysa geçici bir hata: veri "gecikmiş" görünür, yedeğe geçilmez
      if (this.primaryOk) return null;
      this.skipPrimaryUntil = Date.now() + 5 * 60_000;
    }
    return this.fallback.fetchChainLive();
  }

  claimStormBounty(id: string): Promise<BountyClaim | null> {
    return this.primary.claimStormBounty(id);
  }
}
