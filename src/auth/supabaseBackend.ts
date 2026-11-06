import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { DAILY_BLOCK_CAP, type ItemSlot } from '../collection/cards';
import type { AuthBackend, ClaimResult, LeaderKind, LeaderPage, LeaderRow, Player, RunBudgetState } from './types';
import { parseServerTime, RUN_LIMIT_SECONDS, RUN_WINDOW_MS } from './runBudget';
import { parseBountyClaim, parseChainLive, type BountyClaim, type ChainLive } from '../chain/types';

/** X profil fotoğrafı: '_normal' (48px) yerine 400×400 sürümü */
function largeAvatar(url: unknown): string | null {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  return url.replace(/_normal(\.\w+)$/, '_400x400$1');
}

interface ProfileRow {
  x_handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  active_hamster?: string | null;
}

function toPlayer(u: User, profile?: ProfileRow): Player {
  const m = u.user_metadata ?? {};
  const handle = profile?.x_handle ?? m.user_name ?? m.preferred_username ?? '';
  return {
    id: u.id,
    handle: String(handle),
    name: String(profile?.display_name ?? m.full_name ?? m.name ?? handle),
    avatarUrl: largeAvatar(profile?.avatar_url ?? m.avatar_url ?? m.picture),
    activeHamster: profile?.active_hamster ?? 'starter-hamster',
  };
}

/** Supabase Auth (X / OAuth 2.0 sağlayıcısı) + profiles tablosu */
export class SupabaseBackend implements AuthBackend {
  readonly configured = true;
  private sb: SupabaseClient;
  private listeners: Array<(p: Player | null) => void> = [];
  private player: Player | null = null;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }

  async init(): Promise<Player | null> {
    const { data } = await this.sb.auth.getSession();
    this.player = data.session ? await this.load(data.session.user) : null;
    this.sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') this.emit(null);
      else if (event === 'SIGNED_IN' && session && session.user.id !== this.player?.id) {
        void this.load(session.user).then((p) => this.emit(p));
      }
    });
    // OAuth dönüşündeki ?code=... parametresini adres çubuğundan temizle
    const url = new URL(location.href);
    if (url.searchParams.has('code')) {
      url.searchParams.delete('code');
      history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    }
    return this.player;
  }

  private async load(u: User): Promise<Player> {
    // Profil satırını X bilgisiyle oluştur/güncelle (sunucuda, auth.users'tan)
    const { data, error } = await this.sb.rpc('sync_profile');
    if (error) console.warn('[Squeaksy] sync_profile', error.message);
    this.player = toPlayer(u, data ?? undefined);
    return this.player;
  }

  private emit(p: Player | null): void {
    this.player = p;
    for (const fn of this.listeners) fn(p);
  }

  onChange(fn: (p: Player | null) => void): void {
    this.listeners.push(fn);
  }

  async signIn(): Promise<void> {
    const redirectTo = location.origin + location.pathname;
    const { error } = await this.sb.auth.signInWithOAuth({ provider: 'x', options: { redirectTo } });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  async fetchDailyLeft(): Promise<number | null> {
    if (!this.player) return null;
    const { data, error } = await this.sb.from('profiles').select('day_start, day_blocks').eq('id', this.player.id).maybeSingle();
    // Eski şema (sütunlar yok) ya da profil yok: bilinmiyor
    if (error || !data) return null;
    const row = data as { day_start: string | null; day_blocks: number | null };
    const today = new Date().toISOString().slice(0, 10);
    return row.day_start === today ? Math.max(0, DAILY_BLOCK_CAP - Number(row.day_blocks ?? 0)) : DAILY_BLOCK_CAP;
  }

  async fetchRunBudgets(): Promise<Record<string, RunBudgetState> | null> {
    if (!this.player) return null;
    const { data, error } = await this.sb.from('hamster_runs').select('hamster_id, window_start, run_seconds').eq('user_id', this.player.id);
    // Eski şema (tablo yok): can sınırı yok sayılır
    if (error) return null;
    const out: Record<string, RunBudgetState> = {};
    for (const row of (data ?? []) as Array<{ hamster_id: string; window_start: string; run_seconds: number | string }>) {
      const start = parseServerTime(row.window_start);
      if (!Number.isFinite(start) || Date.now() >= start + RUN_WINDOW_MS) continue;
      out[row.hamster_id] = { left: Math.max(0, Math.ceil(RUN_LIMIT_SECONDS - Number(row.run_seconds))), resetAt: new Date(start + RUN_WINDOW_MS).toISOString() };
    }
    return out;
  }

  async fetchBalance(): Promise<number> {
    if (!this.player) return 0;
    const { data, error } = await this.sb.from('profiles').select('balance').eq('id', this.player.id).maybeSingle();
    if (error) throw error;
    return Number(data?.balance ?? 0);
  }

  async fetchPaid(): Promise<Record<string, number>> {
    if (!this.player) return {};
    // price_paid sütunu sunucuda henüz yoksa sessizce boş döner (satış o zaman katalog fiyatından hesaplanır)
    const { data, error } = await this.sb.from('owned_cards').select('card_id, price_paid').eq('user_id', this.player.id);
    if (error) return {};
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ card_id: string; price_paid: number | null }>) if (r.price_paid != null) out[r.card_id] = Number(r.price_paid);
    return out;
  }

  async fetchOwned(): Promise<string[]> {
    if (!this.player) return [];
    const { data, error } = await this.sb.from('owned_cards').select('card_id').eq('user_id', this.player.id);
    if (error) throw error;
    return (data ?? []).map((r: { card_id: string }) => r.card_id);
  }

  async buy(cardId: string): Promise<{ balance: number }> {
    const { data, error } = await this.sb.rpc('buy_card', { p_card: cardId });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { balance: number };
    return { balance: Number(row.balance) };
  }

  async sell(cardId: string): Promise<{ balance: number }> {
    const { data, error } = await this.sb.rpc('sell_card', { p_card: cardId });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { balance: number };
    if (this.player?.activeHamster === cardId) this.player.activeHamster = 'starter-hamster';
    return { balance: Number(row.balance) };
  }

  async fetchEquipped(): Promise<Partial<Record<ItemSlot, string | null>>> {
    if (!this.player) return {};
    const { data, error } = await this.sb.from('equipped_items').select('slot, card_id').eq('user_id', this.player.id);
    if (error) throw error;
    const out: Partial<Record<ItemSlot, string | null>> = {};
    for (const r of (data ?? []) as Array<{ slot: ItemSlot; card_id: string | null }>) out[r.slot] = r.card_id;
    return out;
  }

  async setEquipped(slot: ItemSlot, cardId: string | null): Promise<void> {
    const { error } = await this.sb.rpc('set_equipped_item', { p_slot: slot, p_card: cardId });
    if (error) throw new Error(error.message);
  }

  async fetchSupply(): Promise<Record<string, number>> {
    const { data, error } = await this.sb.rpc('card_supply');
    if (error) throw new Error(error.message);
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ card_id: string; owned: number }>) out[r.card_id] = Number(r.owned);
    return out;
  }

  async fetchLeaderboard(kind: LeaderKind, page: number, pageSize: number): Promise<LeaderPage> {
    type Raw = { rank: number; x_handle: string; avatar_url: string | null; stars: number; cards: number; active_hamster: string; total: number; is_me: boolean };
    const { data, error } = await this.sb.rpc('leaderboard', { p_kind: kind, p_page: page, p_size: pageSize });
    if (error) {
      // Sıralama fonksiyonu sunucuda henüz yoksa: giriş yapan oyuncu en azından kendi satırını görür
      if (!this.player) throw new Error(error.message);
      const [stars, owned] = await Promise.all([this.fetchBalance(), this.fetchOwned()]);
      const me: LeaderRow = { rank: 0, handle: this.player.handle, avatarUrl: this.player.avatarUrl, stars, cards: 2 + owned.length, hamster: this.player.activeHamster };
      return { rows: [], total: 0, me, partial: true };
    }
    const map = (r: Raw): LeaderRow => ({
      rank: Number(r.rank),
      handle: r.x_handle,
      // X'in küçük (48px) fotoğrafı yerine büyük sürüm: tabloda keskin görünür
      avatarUrl: r.avatar_url ? largeAvatar(r.avatar_url) : null,
      stars: Number(r.stars),
      cards: Number(r.cards),
      hamster: r.active_hamster,
    });
    const raw = (data ?? []) as Raw[];
    const rows = raw.filter((r) => !r.is_me).map(map);
    const mine = raw.find((r) => r.is_me);
    return { rows, total: Number(raw[0]?.total ?? 0), me: mine ? map(mine) : null };
  }

  async setActiveHamster(cardId: string): Promise<void> {
    const { error } = await this.sb.rpc('set_active_hamster', { p_card: cardId });
    if (error) throw new Error(error.message);
    if (this.player) this.player.activeHamster = cardId;
  }

  /** Squeekchain Live: herkese açık canlı durum (giriş gerekmez). Fonksiyon henüz kurulmadıysa hata fırlatır. */
  async fetchChainLive(): Promise<ChainLive | null> {
    const { data, error } = await this.sb.rpc('chain_live');
    if (error) throw new Error(error.message);
    return parseChainLive(data);
  }

  /** Fırtına anında koşan oyuncu Block Bounty'yi ister; sunucu koşuyu kendi kaydından doğrular (misafirde null) */
  async claimStormBounty(settlementId: string): Promise<BountyClaim | null> {
    if (!this.player) return null;
    const { data, error } = await this.sb.rpc('claim_storm_bounty', { p_settlement: settlementId });
    if (error) throw new Error(error.message);
    return parseBountyClaim(data);
  }

  async claim(blocks: number, bonus: number): Promise<ClaimResult> {
    const { data, error } = await this.sb.rpc('claim_tokens', { p_blocks: blocks, p_bonus: bonus });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as {
      balance: number;
      credited_blocks: number;
      credited_bonus: number;
      daily_left?: number;
      run_left?: number | null;
      run_reset_at?: string | null;
    };
    return {
      balance: Number(row.balance),
      creditedBlocks: row.credited_blocks,
      creditedBonus: row.credited_bonus,
      dailyLeft: row.daily_left === undefined || row.daily_left === null ? undefined : Number(row.daily_left),
      runLeft: row.run_left === undefined || row.run_left === null ? undefined : Number(row.run_left),
      runResetAt: row.run_reset_at ?? null,
    };
  }
}
