import { FINALE_BONUS, tokensPerBlock } from '../collection/cards';
import type { AuthBackend, Player } from './types';

const FLUSH_DELAY = 3000;
const RETRY = [4000, 10000, 30000, 60000];

/**
 * Oyuncunun token defteri. Kazanılan tokenlar önce bekleme kuyruğuna yazılır
 * (sayfa kapansa / ağ kopsa bile tarayıcıda saklanır), birkaç saniyede bir
 * sunucuya (claim_tokens) gönderilir. Asıl bakiye sunucudadır.
 */
export class TokenLedger {
  private player: Player | null = null;
  private balance = 0;
  private pendingBlocks = 0;
  private pendingBonus = 0;
  private ready = false;
  private timer = 0;
  private inflight: Promise<void> | null = null;
  private failures = 0;
  private listeners: Array<() => void> = [];
  /** Günlük tavan doldu: bu zamana (bir sonraki UTC gece yarısı) kadar yıldız kazanılmaz */
  private cappedUntil = 0;
  private capTimer = 0;

  constructor(private readonly backend: AuthBackend) {
    // Sekme kapanırken/gizlenirken bekleyenleri hemen göndermeyi dene
    const onHide = () => {
      if (document.visibilityState === 'hidden') void this.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => void this.flush());
  }

  /** Blok başı yıldız oranı (hamster + sırttaki Pixsy); main.ts envanterden bağlar */
  rate: (() => number) | null = null;

  /** Blok başı yıldız: hamster nadirliği + sırttaki Pixsy bonusu (ör. 1.5) */
  get perBlock(): number {
    return this.rate ? this.rate() : tokensPerBlock(this.player?.activeHamster);
  }

  /** Görünen toplam: sunucu bakiyesi + henüz gönderilmemiş kazançlar */
  get total(): number {
    return this.balance + this.pendingBlocks * this.perBlock + this.pendingBonus * FINALE_BONUS;
  }

  get signedIn(): boolean {
    return this.player !== null;
  }

  /** Bugünkü (UTC) blok tavanı doldu mu */
  get capped(): boolean {
    return Date.now() < this.cappedUntil;
  }

  /** Sunucunun bildirdiği kalan hak 0 ise ertesi UTC gece yarısına kadar kazanç durur */
  private applyDailyLeft(left: number | null | undefined): void {
    window.clearTimeout(this.capTimer);
    if (left === null || left === undefined || left > 0) {
      const was = this.capped;
      this.cappedUntil = 0;
      if (was) this.changed();
      return;
    }
    const now = new Date();
    this.cappedUntil = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    // Yeni gün başlayınca kendiliğinden yeniden açılır
    this.capTimer = window.setTimeout(() => {
      this.cappedUntil = 0;
      this.changed();
    }, this.cappedUntil - Date.now() + 1000);
    this.changed();
  }

  /** Bakiye sunucudan yüklendi mi */
  get loaded(): boolean {
    return this.ready;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private get key(): string | null {
    return this.player ? `squeaksy.pending.${this.player.id}` : null;
  }

  async setPlayer(p: Player | null): Promise<void> {
    window.clearTimeout(this.timer);
    this.player = p;
    this.balance = 0;
    this.pendingBlocks = 0;
    this.pendingBonus = 0;
    this.ready = false;
    this.failures = 0;
    this.applyDailyLeft(null);
    this.changed();
    if (!p) return;
    this.restore();
    try {
      const [bal, left] = await Promise.all([this.backend.fetchBalance(), this.backend.fetchDailyLeft?.().catch(() => null) ?? null]);
      this.balance = bal;
      if (this.player === p) this.applyDailyLeft(left);
    } catch (err) {
      console.warn('[Squeaksy] bakiye yüklenemedi', err);
    }
    if (this.player !== p) return;
    this.ready = true;
    this.changed();
    if (this.pendingBlocks || this.pendingBonus) void this.flush();
  }

  /** Hamster bir blok tamamladı: +perBlock token (sunucu blok sayısını nadirlikle çarpar) */
  addBlock(): void {
    if (!this.player || this.capped) return;
    this.pendingBlocks++;
    this.persist();
    this.changed();
    this.schedule(this.pendingBlocks >= 20 ? 0 : FLUSH_DELAY);
  }

  /** Final: tüm bloklar tamamlandı, yıldırımlar çarptı: +10 */
  addBonus(): void {
    if (!this.player || this.capped) return;
    this.pendingBonus++;
    this.persist();
    this.changed();
    this.schedule(FLUSH_DELAY);
  }

  private schedule(ms: number): void {
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      void this.flush();
    }, ms);
  }

  /** Satın alma sonrası sunucunun döndürdüğü bakiye */
  setServerBalance(b: number): void {
    this.balance = b;
    this.ready = true;
    this.changed();
  }

  /** Bekleyenleri gönderir; gönderim sürüyorsa onun bitmesini bekler */
  flush(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!this.player || (!this.pendingBlocks && !this.pendingBonus)) return Promise.resolve();
    this.inflight = this.send().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async send(): Promise<void> {
    const p = this.player!;
    const blocks = this.pendingBlocks;
    const bonus = this.pendingBonus;
    try {
      const res = await this.backend.claim(blocks, bonus);
      if (this.player !== p) return;
      this.pendingBlocks -= blocks;
      this.pendingBonus -= bonus;
      this.balance = res.balance;
      this.ready = true;
      this.failures = 0;
      this.persist();
      this.applyDailyLeft(res.dailyLeft);
      this.changed();
    } catch (err) {
      console.warn('[Squeaksy] tokenlar gönderilemedi, tekrar denenecek', err);
      const wait = RETRY[Math.min(this.failures, RETRY.length - 1)]!;
      this.failures++;
      this.schedule(wait);
      return;
    }
    if (this.player === p && (this.pendingBlocks || this.pendingBonus)) this.schedule(FLUSH_DELAY);
  }

  private persist(): void {
    const k = this.key;
    if (!k) return;
    try {
      if (this.pendingBlocks || this.pendingBonus) localStorage.setItem(k, JSON.stringify({ b: this.pendingBlocks, x: this.pendingBonus }));
      else localStorage.removeItem(k);
    } catch {
      /* depolama kapalıysa sadece bellekte kalır */
    }
  }

  private restore(): void {
    const k = this.key;
    if (!k) return;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return;
      const v = JSON.parse(raw) as { b?: unknown; x?: unknown };
      this.pendingBlocks = Math.max(0, Math.floor(Number(v.b) || 0));
      this.pendingBonus = Math.max(0, Math.floor(Number(v.x) || 0));
    } catch {
      /* bozuk kayıt: yok say */
    }
  }
}
