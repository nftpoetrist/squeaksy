import type { ChainLive, ChainSource, ChainStorm } from './types';

/** Yoklama aralığı: 20 sn ± 3 sn (herkes aynı saniyede sormasın) */
const POLL_MS = 20_000;
const JITTER_MS = 3_000;
/** Sunucu son okumayı bundan daha önce yaptıysa veri "gecikmiş" sayılır */
const DELAYED_AFTER_MS = 3 * 60_000;
/** Bundan eski bir iniş "şimdi oldu" gibi fırtınayla gösterilmez (ör. sekme uzun süre arka plandaydı) */
const STORM_FRESH_MS = 5 * 60_000;

export type FeedHealth = 'loading' | 'ok' | 'delayed';

export interface FeedState {
  live: ChainLive | null;
  health: FeedHealth;
  /** Sunucu saatine göre şimdi (istemci saati kaymış olabilir) */
  serverNow: () => number;
}

/**
 * Supabase'teki chain_live() kaydını sekme görünürken yoklar. Yeni bir gerçek blok inişi
 * (lastStorm.id değişti) 'storm' olarak bildirilir. İlk yüklemede fırtına tetiklenmez.
 */
export class ChainFeed {
  private live: ChainLive | null = null;
  private health: FeedHealth = 'loading';
  private timer = 0;
  private inflight = false;
  private skew = 0;
  private started = false;
  private readonly updateFns: Array<(s: FeedState) => void> = [];
  private readonly stormFns: Array<(s: ChainStorm, fresh: boolean) => void> = [];

  constructor(private readonly source: ChainSource) {}

  onUpdate(fn: (s: FeedState) => void): void {
    this.updateFns.push(fn);
  }

  /** fresh=false: iniş birkaç dakikadan eski (oyuncu yokken oldu): fırtına değil, sadece ödül gösterilir */
  onStorm(fn: (s: ChainStorm, fresh: boolean) => void): void {
    this.stormFns.push(fn);
  }

  get state(): FeedState {
    return { live: this.live, health: this.health, serverNow: () => Date.now() + this.skew };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        window.clearTimeout(this.timer);
        this.timer = 0;
      } else void this.poll();
    });
    void this.poll();
  }

  /** Hemen sor (geliştirici testleri için de) */
  async poll(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    window.clearTimeout(this.timer);
    try {
      const next = await this.source.fetchChainLive();
      this.apply(next);
    } catch (err) {
      console.warn('[Squeaksy] Squeekchain verisi alınamadı', err);
      this.apply(null);
    } finally {
      this.inflight = false;
      if (!document.hidden) this.timer = window.setTimeout(() => void this.poll(), POLL_MS + (Math.random() * 2 - 1) * JITTER_MS);
    }
  }

  private apply(next: ChainLive | null): void {
    const prev = this.live;
    if (next) {
      const st = Date.parse(next.serverTime);
      if (Number.isFinite(st)) this.skew = st - Date.now();
      this.live = next;
      const statusAt = next.statusAt ? Date.parse(next.statusAt) : NaN;
      this.health = Number.isFinite(statusAt) && st - statusAt < DELAYED_AFTER_MS ? 'ok' : 'delayed';
    } else {
      // Ağ hatası: son bilinen veri kalır ama "gecikmiş" olarak gösterilir
      this.health = 'delayed';
    }
    const s = this.state;
    for (const fn of this.updateFns) fn(s);
    // Yeni iniş: önceki bilinen fırtınadan farklı. İlk veride (prev yok) tetiklenmez.
    const storm = next?.lastStorm;
    if (prev && storm && storm.id !== prev.lastStorm?.id) {
      const at = Date.parse(storm.at.replace(/(\.\d{3})\d+/, '$1'));
      const fresh = !Number.isFinite(at) || Date.now() + this.skew - at < STORM_FRESH_MS;
      for (const fn of this.stormFns) fn(storm, fresh);
    }
  }
}
