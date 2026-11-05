import { cardById, CARDS, DEFAULT_EQUIPPED, ITEM_SLOTS, STARTER_HAMSTER, STARTER_OWNED, type ItemSlot } from '../collection/cards';
import type { TokenLedger } from './ledger';
import type { AuthBackend, Player } from './types';

/** Sunucu hata mesajlarının oyuncuya gösterilen karşılıkları */
const ERRORS: Record<string, string> = {
  'insufficient tokens': 'Not enough stars yet',
  'already owned': 'You already own this hamster',
  'not for sale': 'This card is not for sale',
  'not owned': 'Buy this hamster first',
  'not sellable': 'Starter cards cannot be sold',
  'sold out': 'Sold out! Every one of them has an owner.',
  'not authenticated': 'Sign in with X first',
  'not an item for this slot': 'This item does not fit there',
  busy: 'One moment, finishing the last action…',
  // Sunucuda mağaza fonksiyonları henüz kurulmamışsa (PostgREST "function not found")
  'Could not find the function': 'The shop is not open yet. Please try again later.',
  'Could not find the table': 'This feature is not open yet. Please try again later.',
};

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return v;
  return 'Something went wrong, try again';
}

/**
 * Oyuncunun kartları ve koşan hamsteri. Başlangıç kartları herkese açık;
 * diğerleri kulübeden satın alınır. Satın alma ve değiştirme sunucuda doğrulanır.
 */
export class Inventory {
  private player: Player | null = null;
  private owned = new Set<string>(STARTER_OWNED);
  private activeId = STARTER_HAMSTER;
  /** Yuva → takılı eşya (null = boş) */
  private equipped: Record<ItemSlot, string | null> = { ...DEFAULT_EQUIPPED };
  private listeners: Array<() => void> = [];
  busy = false;
  /** Son değişiklik oyuncunun bir işleminden mi geldi (animasyon için); yüklemede false */
  lastChangeByUser = false;

  constructor(
    private readonly backend: AuthBackend,
    private readonly ledger: TokenLedger,
  ) {}

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(byUser = false): void {
    this.lastChangeByUser = byUser;
    for (const fn of this.listeners) fn();
  }

  get signedIn(): boolean {
    return this.player !== null;
  }

  /** Koşan hamsterin kart kimliği */
  get active(): string {
    return this.activeId;
  }

  isOwned(id: string): boolean {
    return this.owned.has(id);
  }

  /** Sınırlı kartlar: dünya genelinde sahip olunan adet */
  private supply: Record<string, number> = {};
  private supplyTimer = 0;

  /** Kalan adet (sınırsız kartta null) */
  supplyLeft(id: string): number | null {
    const max = cardById(id)?.maxSupply;
    if (max === undefined) return null;
    return Math.max(0, max - (this.supply[id] ?? 0));
  }

  /** Sahip olunan adet (dünya genelinde) */
  supplyOwned(id: string): number {
    return this.supply[id] ?? 0;
  }

  /** Arzı sunucudan yeniler (açılışta, satın alma/satıştan sonra ve 2 dakikada bir) */
  async refreshSupply(): Promise<void> {
    try {
      this.supply = await this.backend.fetchSupply();
      this.changed(this.lastChangeByUser);
    } catch (err) {
      console.warn('[Squeaksy] arz bilgisi alınamadı', err);
    }
    window.clearTimeout(this.supplyTimer);
    this.supplyTimer = window.setTimeout(() => void this.refreshSupply(), 120_000);
  }

  /** Yuvadaki takılı eşya */
  equippedIn(slot: ItemSlot): string | null {
    return this.equipped[slot];
  }

  isEquipped(id: string): boolean {
    return ITEM_SLOTS.some((s) => this.equipped[s] === id);
  }

  /**
   * Eşyayı takar ya da çıkarır. Giriş yapılmışsa sunucuya yazılır;
   * misafirde sadece bu oturumda geçerlidir.
   */
  async toggleItem(id: string): Promise<void> {
    const card = cardById(id);
    if (!card || card.kind !== 'Item' || !card.slot) throw new Error('not an item for this slot');
    if (!this.owned.has(id)) throw new Error('not owned');
    if (this.busy) throw new Error('busy');
    const slot = card.slot;
    const next = this.equipped[slot] === id ? null : id;
    if (this.player) {
      this.busy = true;
      this.changed();
      try {
        await this.ledger.flush(); // bonus oranı değişmeden önce
        await this.backend.setEquipped(slot, next);
      } finally {
        this.busy = false;
      }
    }
    this.equipped[slot] = next;
    this.changed(true);
  }

  /** Kartın ödenen fiyatı (kart → yıldız) */
  private paid: Record<string, number> = {};

  /** Satışta geri gelecek yıldız: ödenen fiyatın yarısı (bilinmiyorsa katalog fiyatının yarısı) */
  refundFor(id: string): number {
    return Math.floor((this.paid[id] ?? cardById(id)?.price ?? 0) / 2);
  }

  /** Sahip olunan kartlar (katalog sırasıyla) */
  ownedIds(): string[] {
    return CARDS.filter((c) => this.owned.has(c.id)).map((c) => c.id);
  }

  async setPlayer(p: Player | null): Promise<void> {
    this.player = p;
    this.owned = new Set(STARTER_OWNED);
    this.paid = {};
    this.activeId = STARTER_HAMSTER;
    this.equipped = { ...DEFAULT_EQUIPPED };
    this.changed();
    if (!p) return;
    try {
      for (const id of await this.backend.fetchOwned()) this.owned.add(id);
      this.paid = await this.backend.fetchPaid().catch(() => ({}));
    } catch (err) {
      console.warn('[Squeaksy] kartlar yüklenemedi', err);
    }
    try {
      const eq = await this.backend.fetchEquipped();
      for (const slot of ITEM_SLOTS) {
        const id = eq[slot];
        // Sadece sahip olunan eşyalar geçerli (kayıt yoksa varsayılan)
        if (id === undefined) continue;
        this.equipped[slot] = id === null || this.owned.has(id) ? id : DEFAULT_EQUIPPED[slot];
      }
    } catch (err) {
      console.warn('[Squeaksy] takılı eşyalar yüklenemedi', err);
    }
    if (this.player !== p) return;
    // Sunucudaki aktif hamster yalnızca sahip olunuyorsa geçerli
    this.activeId = this.owned.has(p.activeHamster) ? p.activeHamster : STARTER_HAMSTER;
    this.changed();
  }

  /** Kulübeden satın alır (önce bekleyen tokenlar sunucuya yazılır) */
  async buy(id: string): Promise<void> {
    if (!this.player) throw new Error('not authenticated');
    if (this.busy) throw new Error('busy');
    this.busy = true;
    this.changed();
    try {
      await this.ledger.flush();
      const { balance } = await this.backend.buy(id).catch((err: unknown) => {
        if (String(err).includes('sold out')) void this.refreshSupply();
        throw err;
      });
      this.ledger.setServerBalance(balance);
      this.owned.add(id);
      this.paid[id] = cardById(id)?.price ?? 0;
      this.supply[id] = (this.supply[id] ?? 0) + 1;
    } finally {
      this.busy = false;
      this.changed(true);
    }
  }

  /** Satın alınmış kartı ödenen fiyatın yarısına satar. Koşan hamster satılırsa başlangıç hamsterine dönülür. */
  async sell(id: string): Promise<void> {
    if (!this.player) throw new Error('not authenticated');
    if (this.busy) throw new Error('busy');
    if (!this.owned.has(id)) throw new Error('not owned');
    if (!(cardById(id)?.price ?? 0)) throw new Error('not sellable');
    this.busy = true;
    this.changed();
    try {
      await this.ledger.flush();
      const { balance } = await this.backend.sell(id);
      this.ledger.setServerBalance(balance);
      this.owned.delete(id);
      delete this.paid[id];
      this.supply[id] = Math.max(0, (this.supply[id] ?? 1) - 1);
      for (const slot of ITEM_SLOTS) if (this.equipped[slot] === id) this.equipped[slot] = null;
      if (this.activeId === id) {
        this.activeId = STARTER_HAMSTER;
        this.player.activeHamster = STARTER_HAMSTER;
      }
    } finally {
      this.busy = false;
      this.changed(true);
    }
  }

  /** Koşan hamsteri değiştirir (önce bekleyenler eski oranla yazılır) */
  async equip(id: string): Promise<void> {
    if (!this.player || this.busy || id === this.activeId) return;
    if (!this.owned.has(id) || cardById(id)?.kind !== 'Hamster') return;
    this.busy = true;
    this.changed();
    try {
      await this.ledger.flush();
      await this.backend.setActiveHamster(id);
      this.player.activeHamster = id;
      this.activeId = id;
    } finally {
      this.busy = false;
      this.changed(true);
    }
  }
}
