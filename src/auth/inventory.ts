import { cardById, CARDS, DEFAULT_EQUIPPED, ITEM_SLOTS, STARTER_HAMSTER, STARTER_OWNED, type ItemSlot } from '../collection/cards';
import type { TokenLedger } from './ledger';
import type { AuthBackend, Player } from './types';
import type { MintDeps, MintStatus } from '../onchain/mint';

/** Onchain mint için gerekenler (main.ts bağlar; yalnızca onchain modda) */
export type MintContext = Omit<MintDeps, 'playerId'>;
const loadMint = () => import('../onchain/mint');

/** Sunucu hata mesajlarının oyuncuya gösterilen karşılıkları */
const ERRORS: Record<string, string> = {
  'insufficient tokens': 'Not enough stars yet',
  'already owned': 'You already own this hamster',
  'not for sale': 'This card is not for sale',
  'not owned': 'Buy this hamster first',
  'card syncing': 'Your new card is still landing in the game. Try again in a few seconds.',
  'item resting': 'This Pixsy is out of energy and resting. It is fully charged 24 hours after it ran out.',
  'not sellable': 'Starter cards cannot be sold',
  'sold out': 'Sold out! Every one of them has an owner.',
  'not authenticated': 'Sign in with X first',
  'mint onchain': 'Cards are minted onchain with the STARS in your wallet.',
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

  get playerId(): string | null {
    return this.player?.id ?? null;
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

  /** Onchain mint (null: eski satın alma) */
  private mintCtx: MintContext | null = null;
  /** Bağlı cüzdandaki STARS (onchain mod; null = henüz bilinmiyor / cüzdan yok) */
  walletStars: number | null = null;
  /** Bağlı cüzdan (onchain_me; claim edilmemişse null) */
  linkedWallet: string | null = null;
  /** Early oyuncu hediyesi (kart kimliği; yoksa null) */
  giftCard: string | null = null;

  get mintEnabled(): boolean {
    return this.mintCtx !== null;
  }

  /** Cüzdan bağlı mı (onchain mod) */
  get walletConnected(): boolean {
    return !!this.mintCtx?.wallet.connected;
  }

  openWallet(): void {
    this.mintCtx?.openWallet();
  }

  enableMint(ctx: MintContext): void {
    this.mintCtx = ctx;
    // Claim bitince cüzdandaki STARS değişti
    window.addEventListener('squeaksy:claimed', (e) => this.onClaimed((e as CustomEvent<{ amount?: number }>).detail?.amount));
    // Sayfa açıkken dakikada bir: başka sekme / cihazdaki işlemler ve geride kalan okuyucu da yansısın
    window.setInterval(() => {
      if (this.player && !document.hidden) void this.refreshWalletStars(!!this.linkedWallet);
    }, 60_000);
    // Sekmeye geri dönünce / pencere odak alınca hemen (başka sekme ya da telefondaki işlem beklemeden yansısın); en sık 5 sn'de bir
    let lastWake = 0;
    const wake = () => {
      if (!this.player || document.hidden || Date.now() - lastWake < 5000) return;
      lastWake = Date.now();
      void this.refreshWalletStars(!!this.linkedWallet);
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    // Yalnızca adres / ağ değişince yeniden çiz (cüzdan durumu birkaç saniyede bir yoklanır)
    let key = '';
    ctx.wallet.onChange((st) => {
      const k = `${st.address ?? ''}:${st.chainId ?? ''}`;
      if (k === key) return;
      key = k;
      this.changed(this.lastChangeByUser);
      // Cüzdan sonradan bağlandıysa: bağ ve bakiye yeniden okunur
      if (st.address && !this.linkedWallet) void this.refreshWalletStars();
    });
    if (this.player) void this.refreshWalletStars();
  }

  /**
   * İşlemden hemen sonraki okuma, işlemi henüz görmemiş bir RPC sunucusuna denk gelebilir (eski bakiye, "bağlı değil").
   * Bu süre içinde eski okumalar yok sayılır: claim sonrası bakiye min'in altına inmez, mint sonrası below'un altına
   * inene kadar eski değer korunur.
   */
  private starsGuard: { until: number; min?: number; below?: number } | null = null;
  private starsTimers: number[] = [];
  private starsSeq = 0;

  /** İşlem sonrası artan aralıklarla yeniden okur (RPC sunucuları ve zincir okuyucu yetişsin) */
  private refreshSoon(): void {
    for (const t of this.starsTimers) window.clearTimeout(t);
    this.starsTimers = [1500, 4000, 8000, 15_000, 30_000, 60_000, 90_000].map((ms) => window.setTimeout(() => void this.refreshWalletStars(true), ms));
  }

  /** Claim zincirde onaylandı: rakam ve cüzdan bağı hemen güncellenir, sonra zincirden doğrulanır */
  private onClaimed(amount: number | undefined): void {
    const ctx = this.mintCtx;
    if (!ctx || !this.player) return;
    this.linkedWallet ??= ctx.wallet.state.address?.toLowerCase() ?? null;
    if (amount && amount > 0) {
      const min = (this.starsGuard?.min ?? this.walletStars ?? 0) + amount;
      this.walletStars = min;
      this.starsGuard = { until: Date.now() + 75_000, min };
    }
    this.changed(this.lastChangeByUser);
    void this.refreshWalletStars(true);
    this.refreshSoon();
  }

  /**
   * Cüzdandaki STARS. Bağlı cüzdan biliniyorsa bakiye HER ZAMAN doğrudan zincirden okunur: zincir okuyucu son işlemleri
   * birkaç on saniye geç işler, sayfa yenilenince ondan okunan bakiye son claim'leri göstermiyordu. Zincire ulaşılamazsa
   * okuyucunun değeri kullanılır. direct: bağ okuyucuda henüz yoksa (ilk claim'den hemen sonra) zincirden de aranır.
   */
  async refreshWalletStars(direct = false): Promise<void> {
    const ctx = this.mintCtx;
    const player = this.player;
    if (!ctx || !player) return;
    const seq = ++this.starsSeq;
    try {
      const me = await ctx.backend.fetchOnchainMe();
      let linked = me?.wallet ?? null;
      // Okuyucu ilk claim'den sonra 10-60 sn geride kalabilir: cüzdan bağlıyken ya da claim'den hemen sonra zincirden bak
      const fromChain = !linked && !!me?.account && (direct || ctx.wallet.connected);
      if (fromChain) {
        try {
          linked = await (await loadMint()).chainLinkedWallet(me!.account);
        } catch (err) {
          console.warn('[Squeaksy] cüzdan bağı zincirden okunamadı', err);
        }
      }
      // Bağ zincirde kalıcı: bir kez bilindiyse eski bir okuma onu silemez
      linked ??= this.linkedWallet;
      let n = me?.walletStars ?? 0;
      if (linked) {
        try {
          n = await (await loadMint()).walletStars(linked);
        } catch (err) {
          console.warn('[Squeaksy] STARS zincirden okunamadı, zincir okuyucunun değeri gösteriliyor', err);
        }
      }
      // Bu arada daha yeni bir okuma başladıysa ya da oyuncu değiştiyse bu sonuç yok sayılır
      if (seq !== this.starsSeq || this.player !== player) return;
      this.linkedWallet = linked;
      const g = this.starsGuard;
      if (g && Date.now() < g.until) {
        if (g.min !== undefined && n < g.min) n = g.min;
        if (g.below !== undefined && n >= g.below) n = this.walletStars ?? n;
      } else if (g) this.starsGuard = null;
      this.walletStars = n;
      this.changed(this.lastChangeByUser);
    } catch (err) {
      console.warn('[Squeaksy] cüzdan STARS okunamadı', err);
    }
  }

  /** Zincirde mint edildi ama oyun sunucusu (zincir okuyucu) henüz görmedi: takma / koşturma kısa süre bekler */
  private syncing = new Set<string>();

  /** Kart zincirde mint edildi (veya zaten cüzdandaydı): koleksiyona ekle */
  private gotMinted(id: string, spent = false): void {
    if (!this.owned.has(id)) {
      this.owned.add(id);
      this.supply[id] = (this.supply[id] ?? 0) + 1;
    }
    const ctx = this.mintCtx;
    if (ctx && !this.syncing.has(id)) {
      this.syncing.add(id);
      void loadMint()
        .then((m) => m.waitIndexed(ctx.backend, id))
        .finally(() => this.syncing.delete(id));
    }
    // Mint STARS yaktı: bakiye düşene kadar eski okumalar yok sayılır (hediye STARS yakmaz)
    if (spent && this.walletStars !== null) this.starsGuard = { until: Date.now() + 75_000, below: this.walletStars };
    this.changed(true);
    void this.refreshWalletStars(true);
    this.refreshSoon();
    window.setTimeout(() => void this.refreshSupply(), 15_000);
  }

  /**
   * Onchain mint: cüzdandaki STARS yakılır, kart cüzdana gelir. onStatus adım adım bildirir.
   * Başarılıysa true. Cancel ile bırakılırsa (cancelMint) arayüz serbest kalır; işlem sonradan onaylanırsa kart yine eklenir.
   */
  async mint(id: string, onStatus: (s: MintStatus) => void, gift = false): Promise<boolean> {
    const ctx = this.mintCtx;
    if (!ctx || !this.player) throw new Error('not authenticated');
    if (this.busy) throw new Error('busy');
    const playerId = this.player.id;
    this.busy = true;
    this.changed();
    let ok = false;
    try {
      const m = await loadMint();
      const run = gift ? m.runGift : m.runMint;
      ok = await run({ ...ctx, playerId, linkedHint: this.linkedWallet, starsHint: this.walletStars }, id, onStatus, (card) => this.player?.id === playerId && this.gotMinted(card));
    } finally {
      this.busy = false;
      if (ok) this.gotMinted(id, !gift);
      else this.changed(true);
    }
    return ok;
  }

  /** Mint penceresi Cancel'a basıldı: bekleyen cüzdan isteğini bırak */
  async cancelMint(): Promise<void> {
    (await loadMint()).cancelMint();
    this.busy = false;
    this.changed();
  }

  /** Pixsy canı bitmiş mi (main.ts bağlar: Pixsy can sayacı) */
  itemResting: (id: string) => boolean = () => false;

  /**
   * Sırttaki Pixsy'nin canı bitti: kendi uçma efektiyle minderine uçar (hamster koşmaya devam eder).
   * Önce ekranda (tam bittiği an), sonra sunucuda: bekleyen bloklar yazılır, sırt boşaltılır.
   */
  async restItem(id: string): Promise<void> {
    const card = cardById(id);
    if (!card?.slot || this.equipped[card.slot] !== id) return;
    const slot = card.slot;
    this.equipped[slot] = null;
    this.changed(true);
    if (!this.player) return;
    try {
      await this.ledger.flush();
      // Sunucu claim_tokens'ta zaten indirir; burada da yazılır (hamster tam o an durduysa birkaç saniye kalmış olabilir)
      if (this.equipped[slot] === null) await this.backend.setEquipped(slot, null);
    } catch (err) {
      console.warn('[Squeaksy] Pixsy sırttan indirilemedi', err);
    }
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
    if (this.busy || this.loading) throw new Error('busy');
    if (this.syncing.has(id) && this.equipped[card.slot] !== id) throw new Error('card syncing');
    // Canı bitmiş Pixsy takılamaz (çıkarmak her zaman serbest)
    if (this.equipped[card.slot] !== id && this.itemResting(id)) throw new Error('item resting');
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

  /** Oyuncu verisi (kartlar, takılı eşyalar) yükleniyor: bu arada takma / değiştirme beklenir (yoksa yüklenen kayıt üstüne yazar) */
  private loading = false;

  async setPlayer(p: Player | null): Promise<void> {
    this.player = p;
    this.loading = p !== null;
    this.owned = new Set(STARTER_OWNED);
    this.paid = {};
    this.walletStars = null;
    this.linkedWallet = null;
    this.giftCard = null;
    this.starsGuard = null;
    for (const t of this.starsTimers) window.clearTimeout(t);
    this.starsTimers = [];
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
    if (this.mintCtx) {
      void this.refreshWalletStars();
      void this.mintCtx.backend.fetchMyGift().then((g) => {
        if (this.player !== p) return;
        this.giftCard = g;
        this.changed();
      });
      // Yarım kalmış mint (sayfa yenilendi): takibe devam et
      const ctx = this.mintCtx;
      try {
        if (localStorage.getItem(`squeaksy.mintTx.${p.id}`))
          void loadMint().then((m) => m.resumeMints({ ...ctx, playerId: p.id }, (card) => this.player === p && this.gotMinted(card)));
      } catch {
        /* depolama kapalı */
      }
    }
    // Sunucudaki aktif hamster yalnızca sahip olunuyorsa geçerli
    this.activeId = this.owned.has(p.activeHamster) ? p.activeHamster : STARTER_HAMSTER;
    this.loading = false;
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
    if (this.loading) throw new Error('busy');
    if (this.syncing.has(id)) throw new Error('card syncing');
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
