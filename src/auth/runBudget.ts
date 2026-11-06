import type { RunBudgetState } from './types';

/** Her hamsterin canı: 24 saatte en fazla 2 saat koşu (sunucudaki claim_tokens ile aynı kural) */
export const RUN_LIMIT_SECONDS = 2 * 60 * 60;
export const RUN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Sunucu zaman damgası → ms. Postgres mikrosaniye (6 hane) döndürür; Safari (iPhone'daki tüm tarayıcılar)
 * 3 haneden fazlasını okuyamaz ve NaN verir. Kesir 3 haneye kırpılır.
 */
export function parseServerTime(s: string | null | undefined): number {
  if (!s) return NaN;
  // Ayrıca: boşluk → 'T', kısa saat dilimi (+00) → +00:00
  return Date.parse(s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00'));
}

interface Entry {
  left: number;
  resetAt: number | null;
}

/**
 * Hamster canları. Her hamsterin kendi 2 saatlik canı vardır: ilk koşusuyla 24 saatlik pencere başlar.
 * Can kademeli dolmaz: bitmediyse pencere sonunda, bittiyse bittiği andan tam 24 saat sonra tek seferde
 * tam dolar. Dinlenen hamster uyur; başka bir hamster kendi canıyla koşabilir.
 * Asıl kayıt sunucudadır; burada koşarken saniye saniye düşülür (sayaç akıcı olsun), her claim yanıtında
 * sunucunun değerine eşitlenir.
 */
export class RunBudget {
  private map = new Map<string, Entry>();
  private activeId = 'starter-hamster';
  /** Sunucudan bilgi geldi mi (misafir ya da eski şema: sınır yok) */
  private known = false;
  private listeners: Array<() => void> = [];

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private entry(id: string): Entry {
    let e = this.map.get(id);
    if (!e) {
      e = { left: RUN_LIMIT_SECONDS, resetAt: null };
      this.map.set(id, e);
    }
    // Pencere bittiyse can yenilenir
    if (e.resetAt !== null && Date.now() >= e.resetAt) {
      e.left = RUN_LIMIT_SECONDS;
      e.resetAt = null;
    }
    return e;
  }

  /** Girişte tüm canlar (null = bilinmiyor: sınır uygulanmaz) */
  syncAll(all: Record<string, RunBudgetState> | null): void {
    this.map.clear();
    this.known = all !== null;
    for (const [id, s] of Object.entries(all ?? {})) {
      const r = parseServerTime(s.resetAt);
      this.map.set(id, { left: Math.max(0, s.left), resetAt: Number.isFinite(r) ? r : null });
    }
    this.changed();
  }

  /** Claim yanıtı: o hamsterin sunucudaki canı */
  sync(id: string, s: RunBudgetState): void {
    if (!this.known) this.known = true;
    const e = this.entry(id);
    const r = parseServerTime(s.resetAt);
    const reset = Number.isFinite(r) ? r : null;
    const server = Math.max(0, s.left);
    // Aynı pencere: sunucu birkaç saniye geriden gelir (henüz gönderilmemiş koşu); yerel sayaç geri sıçramasın
    const same = reset !== null && e.resetAt !== null && Math.abs(reset - e.resetAt) < 60_000;
    // Can burada az önce bitti, sunucu birkaç saniye geriden geliyor: hamster yataktan geri kalkmasın
    if (e.left <= 0 && e.resetAt !== null && Date.now() < e.resetAt && server > 0 && server < 60) {
      this.changed();
      return;
    }
    e.left = same ? Math.min(e.left, server) : server;
    e.resetAt = reset;
    this.changed();
  }

  /** Koşan hamster değişti */
  setActive(id: string): void {
    if (id === this.activeId) return;
    this.activeId = id;
    this.changed();
  }

  get activeHamster(): string {
    return this.activeId;
  }

  /** Her saniye: koşan hamsterin canı düşer; dinlenenlerin uyanma anı kontrol edilir */
  tick(dt: number, running: boolean): void {
    if (!this.known) return;
    const e = this.entry(this.activeId);
    if (running && e.left > 0) {
      if (e.resetAt === null) e.resetAt = Date.now() + RUN_WINDOW_MS;
      e.left = Math.max(0, e.left - dt);
      // Can bitti: dinlenme tam 24 saat, bittiği andan sayılır (arada hiç dolmaz)
      if (e.left <= 0) e.resetAt = Date.now() + RUN_WINDOW_MS;
    }
    this.changed();
  }

  /** Sınır uygulanıyor mu (giriş yapılmış ve sunucu destekliyor) */
  get active(): boolean {
    return this.known;
  }

  /** Hamsterin kalan canı (sn) */
  left(id = this.activeId): number {
    return this.known ? this.entry(id).left : RUN_LIMIT_SECONDS;
  }

  /** Can 0..1 */
  fraction(id = this.activeId): number {
    return this.left(id) / RUN_LIMIT_SECONDS;
  }

  /** Can bitti: hamster dinleniyor */
  isResting(id = this.activeId): boolean {
    if (!this.known) return false;
    const e = this.entry(id);
    return e.left <= 0 && e.resetAt !== null;
  }

  /** Koşan hamster dinleniyor mu */
  get resting(): boolean {
    return this.isResting(this.activeId);
  }

  /** Uyanmaya kalan süre (ms); dinlenmiyorsa 0 */
  wakeInMs(id = this.activeId): number {
    if (!this.isResting(id)) return 0;
    return Math.max(0, (this.entry(id).resetAt ?? 0) - Date.now());
  }
}

/** 7265 sn → "2:01:05" */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
