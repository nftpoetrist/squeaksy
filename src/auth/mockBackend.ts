import { CARDS, cardById, DAILY_BLOCK_CAP, ratePerBlock, type ItemSlot } from '../collection/cards';
import type { AuthBackend, ClaimResult, LeaderKind, LeaderPage, LeaderRow, Player, RunBudgetState } from './types';
import { RUN_LIMIT_SECONDS, RUN_WINDOW_MS } from './runBudget';

/** Basit sahte profil fotoğrafı (data URL): pikselleştirmeyi denemek için */
function fakeAvatar(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 200;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 200, 200);
  g.addColorStop(0, '#2b6cff');
  g.addColorStop(1, '#ff5db1');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = '#ffe2c4';
  ctx.beginPath();
  ctx.arc(100, 86, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(100, 200, 70, 62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a2410';
  ctx.beginPath();
  ctx.arc(100, 66, 46, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#1a1030';
  ctx.fillRect(82, 84, 8, 8);
  ctx.fillRect(110, 84, 8, 8);
  return c.toDataURL();
}

/**
 * Yalnızca geliştirme: ?dev&mockUser=handle → Supabase olmadan giriş arayüzünü dener.
 * Bakiye sessionStorage'da tutulur (gerçek kalıcılık Supabase'dedir).
 */
export class MockBackend implements AuthBackend {
  readonly configured = true;
  private listeners: Array<(p: Player | null) => void> = [];
  private player: Player | null = null;

  constructor(
    private readonly handle: string,
    private readonly startBalance = 0,
  ) {}

  private get key(): string {
    return `squeaksy.mock.${this.handle}`;
  }

  async init(): Promise<Player | null> {
    if (this.startBalance > 0 && this.load('seeded') !== '1') {
      this.store('seeded', '1');
      try {
        sessionStorage.setItem(this.key, String(this.startBalance));
      } catch {
        /* yok say */
      }
    }
    let signedIn = false;
    try {
      signedIn = sessionStorage.getItem(this.key + '.out') !== '1';
    } catch {
      signedIn = true;
    }
    this.player = signedIn ? this.make() : null;
    return this.player;
  }

  private make(): Player {
    return { id: `mock-${this.handle}`, handle: this.handle, name: this.handle, avatarUrl: fakeAvatar(), activeHamster: this.load('active') ?? 'starter-hamster' };
  }

  onChange(fn: (p: Player | null) => void): void {
    this.listeners.push(fn);
  }

  private emit(p: Player | null): void {
    this.player = p;
    for (const fn of this.listeners) fn(p);
  }

  async signIn(): Promise<void> {
    try {
      sessionStorage.removeItem(this.key + '.out');
    } catch {
      /* yok say */
    }
    this.emit(this.make());
  }

  async signOut(): Promise<void> {
    try {
      sessionStorage.setItem(this.key + '.out', '1');
    } catch {
      /* yok say */
    }
    this.emit(null);
  }

  async fetchBalance(): Promise<number> {
    try {
      return Number(sessionStorage.getItem(this.key) ?? 0);
    } catch {
      return 0;
    }
  }

  /** Yalnızca geliştirme (sahte zincir): bakiyeye ödül ekler, yeni bakiyeyi döner */
  addMockBalance(n: number): number {
    try {
      const next = Number(sessionStorage.getItem(this.key) ?? 0) + Math.max(0, Math.floor(n));
      sessionStorage.setItem(this.key, String(next));
      return next;
    } catch {
      return 0;
    }
  }

  private store(k: string, v: string): void {
    try {
      sessionStorage.setItem(`${this.key}.${k}`, v);
    } catch {
      /* yok say */
    }
  }

  private load(k: string): string | null {
    try {
      return sessionStorage.getItem(`${this.key}.${k}`);
    } catch {
      return null;
    }
  }

  async fetchOwned(): Promise<string[]> {
    return JSON.parse(this.load('owned') ?? '[]') as string[];
  }

  async fetchPaid(): Promise<Record<string, number>> {
    return JSON.parse(this.load('paid') ?? '{}') as Record<string, number>;
  }

  async buy(cardId: string): Promise<{ balance: number }> {
    const price = cardById(cardId)?.price ?? 0;
    const owned = await this.fetchOwned();
    if (price <= 0) throw new Error('not for sale');
    if (owned.includes(cardId)) throw new Error('already owned');
    const max = cardById(cardId)?.maxSupply;
    if (max !== undefined && ((await this.fetchSupply())[cardId] ?? 0) >= max) throw new Error('sold out');
    const bal = await this.fetchBalance();
    if (bal < price) throw new Error('insufficient tokens');
    this.store('owned', JSON.stringify([...owned, cardId]));
    this.store('paid', JSON.stringify({ ...(await this.fetchPaid()), [cardId]: price }));
    try {
      sessionStorage.setItem(this.key, String(bal - price));
    } catch {
      /* yok say */
    }
    return { balance: bal - price };
  }

  async sell(cardId: string): Promise<{ balance: number }> {
    const price = cardById(cardId)?.price ?? 0;
    const owned = await this.fetchOwned();
    if (price <= 0) throw new Error('not sellable');
    if (!owned.includes(cardId)) throw new Error('not owned');
    // Ödenen fiyatın yarısı (fiyat sonradan değişse de istikrarlı)
    const paid = await this.fetchPaid();
    const bal = (await this.fetchBalance()) + Math.floor((paid[cardId] ?? price) / 2);
    delete paid[cardId];
    this.store('paid', JSON.stringify(paid));
    this.store('owned', JSON.stringify(owned.filter((id) => id !== cardId)));
    try {
      sessionStorage.setItem(this.key, String(bal));
    } catch {
      /* yok say */
    }
    if (this.load('active') === cardId) this.store('active', 'starter-hamster');
    if (this.player?.activeHamster === cardId) this.player.activeHamster = 'starter-hamster';
    return { balance: bal };
  }

  async fetchEquipped(): Promise<Partial<Record<ItemSlot, string | null>>> {
    return JSON.parse(this.load('equipped') ?? '{}') as Partial<Record<ItemSlot, string | null>>;
  }

  async setEquipped(slot: ItemSlot, cardId: string | null): Promise<void> {
    const card = cardId ? cardById(cardId) : null;
    if (cardId && (card?.kind !== 'Item' || card.slot !== slot)) throw new Error('not an item for this slot');
    if (cardId && (card?.price ?? 0) > 0 && !(await this.fetchOwned()).includes(cardId)) throw new Error('not owned');
    const eq = await this.fetchEquipped();
    eq[slot] = cardId;
    this.store('equipped', JSON.stringify(eq));
  }

  async fetchSupply(): Promise<Record<string, number>> {
    // Sahte oturum: diğer oyuncular yerine sabit bir sayı + bu oturumun aldıkları
    const owned = await this.fetchOwned();
    const base: Record<string, number> = { 'sky-unicorn': 1234, 'inferno-king': 377, 'seraph-twin': 41, 'eth-pixsy': 2048, 'btc-pixsy': 512 };
    const out: Record<string, number> = {};
    // Test: ?mockSoldOut=btc-pixsy → o kart tükenmiş görünür
    const soldOut = new URLSearchParams(location.search).get('mockSoldOut');
    for (const [id, n] of Object.entries(base)) out[id] = id === soldOut ? (cardById(id)?.maxSupply ?? n) : n + (owned.includes(id) ? 1 : 0);
    return out;
  }

  async setActiveHamster(cardId: string): Promise<void> {
    if (cardId !== 'starter-hamster' && !(await this.fetchOwned()).includes(cardId)) throw new Error('not owned');
    this.store('active', cardId);
    if (this.player) this.player.activeHamster = cardId;
  }

  async fetchLeaderboard(kind: LeaderKind, page: number, pageSize: number): Promise<LeaderPage> {
    const me = this.player
      ? { handle: this.player.handle, stars: await this.fetchBalance(), cards: 2 + (await this.fetchOwned()).length, hamster: this.player.activeHamster }
      : null;
    const all = sampleBoard(kind, me);
    const mine = me ? all.find((r) => r.handle === me.handle) ?? null : null;
    if (mine) mine.avatarUrl = this.player?.avatarUrl ?? null;
    return { rows: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, me: mine };
  }

  /** Günlük kalan blok (test: ?dev&mockDailyLeft=5 → 5 blok sonra tavan) */
  private dailyLeft(): number {
    const saved = this.load('dailyLeft');
    if (saved !== null) return Number(saved);
    const p = Number(new URLSearchParams(location.search).get('mockDailyLeft'));
    return Number.isFinite(p) && p >= 0 && new URLSearchParams(location.search).has('mockDailyLeft') ? p : DAILY_BLOCK_CAP;
  }

  async fetchDailyLeft(): Promise<number | null> {
    return this.dailyLeft();
  }

  /**
   * Koşu hakkı (sunucudaki kuralın aynısı, tarayıcıda). Test: ?dev&mockUser=a&mockRunLeft=20 → 20 sn sonra dinlenir;
   * ?mockResting=90 → dinleniyor, 90 sn sonra uyanır.
   */
  private runState(id = this.player?.activeHamster ?? 'starter-hamster'): { start: number | null; used: number } {
    const raw = this.load(`run.${id}`);
    if (raw) {
      const v = JSON.parse(raw) as { start: number | null; used: number };
      if (v.start !== null && Date.now() >= v.start + RUN_WINDOW_MS) return { start: null, used: 0 };
      return v;
    }
    const q = new URLSearchParams(location.search);
    // mockRunLeft: her hamsterin kendi kısa canı (hepsi ayrı ayrı test edilir); ilk koşuda başlar
    const left = Number(q.get('mockRunLeft'));
    // mockResting: sadece açılıştaki (aktif) hamster dinleniyor
    const resting = Number(q.get('mockResting'));
    if (id === (this.player?.activeHamster ?? 'starter-hamster') && q.has('mockResting') && resting > 0) {
      return { start: Date.now() + resting * 1000 - RUN_WINDOW_MS, used: RUN_LIMIT_SECONDS };
    }
    if (q.has('mockRunLeft') && left >= 0) return { start: null, used: Math.max(0, RUN_LIMIT_SECONDS - left) };
    return { start: null, used: 0 };
  }

  private toBudget(v: { start: number | null; used: number }): RunBudgetState {
    return { left: Math.max(0, Math.ceil(RUN_LIMIT_SECONDS - v.used)), resetAt: v.start === null ? null : new Date(v.start + RUN_WINDOW_MS).toISOString() };
  }

  async fetchRunBudgets(): Promise<Record<string, RunBudgetState> | null> {
    const out: Record<string, RunBudgetState> = {};
    // Tüm hamster kartları (sonradan satın alınanlar da kendi canıyla gelsin)
    for (const id of CARDS.filter((c) => c.kind === 'Hamster').map((c) => c.id)) {
      const v = this.runState(id);
      this.store(`run.${id}`, JSON.stringify(v));
      if (v.start !== null || v.used > 0) out[id] = this.toBudget(v);
    }
    return out;
  }

  async claim(rawBlocks: number, rawBonus: number): Promise<ClaimResult> {
    const run = this.runState();
    const now = Date.now();
    const elapsed = Math.max(0, (now - Number(this.load('lastClaim') ?? now)) / 1000);
    this.store('lastClaim', String(now));
    const runCap = Math.max(0, Math.ceil((RUN_LIMIT_SECONDS - run.used) / 0.7));
    const left = this.dailyLeft();
    const blocks = Math.min(rawBlocks, left, runCap);
    if (blocks > 0) {
      if (run.start === null) run.start = now;
      run.used = Math.min(RUN_LIMIT_SECONDS, run.used + Math.max(Math.min(elapsed, 15), blocks * 0.7));
      // Can bitti: tam 24 saat dinlenme, bittiği andan
      if (run.used >= RUN_LIMIT_SECONDS) run.start = now;
    }
    this.store(`run.${this.player?.activeHamster ?? 'starter-hamster'}`, JSON.stringify(run));
    const bonus = blocks > 0 ? rawBonus : 0;
    this.store('dailyLeft', String(left - blocks));
    const eq = await this.fetchEquipped();
    const back = eq.back === undefined ? 'pixsy' : eq.back;
    const frac = Number(this.load('fraction') ?? 0);
    const earned = blocks * ratePerBlock(this.player?.activeHamster, back) + frac;
    const whole = Math.floor(earned);
    this.store('fraction', String(earned - whole));
    const balance = (await this.fetchBalance()) + whole + bonus * 10;
    try {
      sessionStorage.setItem(this.key, String(balance));
    } catch {
      /* yok say */
    }
    const budget = this.toBudget(run);
    return { balance, creditedBlocks: blocks, creditedBonus: bonus, dailyLeft: left - blocks, runLeft: budget.left, runResetAt: budget.resetAt };
  }
}

/** Anahtarlar tanımlı değilken: giriş butonu görünür ama "henüz yapılandırılmadı" der */
export class UnconfiguredBackend implements AuthBackend {
  readonly configured = false;
  async init(): Promise<Player | null> {
    return null;
  }
  onChange(): void {}
  async signIn(): Promise<void> {
    throw new Error('X login is not configured yet');
  }
  async signOut(): Promise<void> {}
  async fetchBalance(): Promise<number> {
    return 0;
  }
  async claim(): Promise<ClaimResult> {
    throw new Error('not configured');
  }
  async fetchOwned(): Promise<string[]> {
    return [];
  }
  async fetchPaid(): Promise<Record<string, number>> {
    return {};
  }
  async buy(): Promise<{ balance: number }> {
    throw new Error('not configured');
  }
  async sell(): Promise<{ balance: number }> {
    throw new Error('not configured');
  }
  async fetchEquipped(): Promise<Partial<Record<ItemSlot, string | null>>> {
    return {};
  }
  async setEquipped(): Promise<void> {
    throw new Error('not configured');
  }
  async fetchSupply(): Promise<Record<string, number>> {
    return {};
  }
  async setActiveHamster(): Promise<void> {
    throw new Error('not configured');
  }
  async fetchLeaderboard(): Promise<LeaderPage> {
    throw new Error('not configured');
  }
}

/** Geliştirme önizlemesi için deterministik örnek oyuncular (gerçek kişiler değil) */
const SAMPLE_NAMES = [
  'SqueekLegend', 'WheelWizard', 'CloudChaser', 'PixsyMaster', 'BlockBuilder', 'StormRunner', 'TinyPaws', 'GoldenSpin',
  'NightOwlHamster', 'ChainHopper', 'StarNibbler', 'RainyRuns', 'SkyBlocks', 'HutKeeper', 'BoltCatcher', 'CozyWheel',
  'MoonlitPaws', 'ThunderNap', 'PebbleRunner', 'SeedHoarder', 'LuckyLaps', 'DriftyDreams', 'CheekPouch', 'MistyMiles',
];
function sampleBoard(kind: LeaderKind, me: { handle: string; stars: number; cards: number; hamster: string } | null): LeaderRow[] {
  const hamsters = ['seraph-twin', 'inferno-king', 'sky-unicorn', 'starter-hamster'];
  const rows: LeaderRow[] = SAMPLE_NAMES.map((handle, i) => ({
    rank: 0,
    handle,
    avatarUrl: null,
    stars: Math.round(125750 * Math.pow(0.86, i) + ((i * 137) % 300)),
    cards: Math.max(2, 6 - Math.floor(i / 4) + ((i * 7) % 3)),
    hamster: hamsters[i < 4 ? i : (i * 5) % 4]!,
  }));
  if (me) rows.push({ rank: 0, handle: me.handle, avatarUrl: null, stars: me.stars, cards: me.cards, hamster: me.hamster });
  rows.sort((a, b) => (kind === 'cards' ? b.cards - a.cards : 0) || b.stars - a.stars);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}
