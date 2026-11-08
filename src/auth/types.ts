import type { ItemSlot } from '../collection/cards';

/** X ile giriş yapmış oyuncu */
export interface Player {
  id: string;
  /** X kullanıcı adı (@ olmadan) */
  handle: string;
  name: string;
  /** X profil fotoğrafı (büyük boy) */
  avatarUrl: string | null;
  /** Koşan hamsterin kart kimliği (blok başı token oranını belirler) */
  activeHamster: string;
}

/** claim_tokens sonucu */
export interface ClaimResult {
  balance: number;
  creditedBlocks: number;
  creditedBonus: number;
  /** Bugün (UTC) yıldız kazandırabilecek kalan blok; eski sunucu şeması döndürmezse undefined */
  dailyLeft?: number;
  /** Koşan hamsterin canı: 24 saatlik pencerede kalan saniye (eski şemada undefined) */
  runLeft?: number;
  /** Koşu penceresinin bittiği an (ISO); pencere başlamadıysa null */
  runResetAt?: string | null;
  /** Sırttaki Pixsy (sunucunun saydığı; null = sırt boş). Eski şemada undefined. */
  itemId?: string | null;
  /** Pixsy'nin 24 saatlik penceresinde kalan saniye */
  itemLeft?: number;
  /** Pixsy penceresinin bittiği an (ISO) */
  itemResetAt?: string | null;
  /** Pixsy'nin canı bu talepte bitti: sunucu onu sırttan indirdi (istemci minderine uçurur) */
  itemRested?: boolean;
}

/** Hamsterin koşu hakkı: 24 saatte en fazla 2 saat */
export interface RunBudgetState {
  /** Kalan koşu süresi (sn) */
  left: number;
  /** Pencerenin bittiği an (ISO); pencere başlamadıysa null */
  resetAt: string | null;
}

/** Giriş + bakiye arka ucu (Supabase ya da geliştirici için sahte) */
export interface AuthBackend {
  /** Giriş yapılabilir mi (anahtarlar tanımlı mı) */
  readonly configured: boolean;
  /** Mevcut oturumu yükler (OAuth dönüşü dahil); oturum yoksa null */
  init(): Promise<Player | null>;
  onChange(fn: (p: Player | null) => void): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Giriş butonunun yazısı (test kurulumunda "Test sign in"); yoksa "Sign in with X" */
  readonly signInLabel?: string;
  /** Sunucudaki bakiye */
  fetchBalance(): Promise<number>;
  /** Bugün (UTC) kalan blok hakkı (bilinmiyorsa null) */
  fetchDailyLeft?(): Promise<number | null>;
  claim(blocks: number, bonus: number): Promise<ClaimResult>;
  /** Hamster canları (hamster kartı → durum; kaydı olmayan hamster tam canlı). Eski şemada null */
  fetchRunBudgets?(): Promise<Record<string, RunBudgetState> | null>;
  /** Pixsy canları (sırt eşyaları; null = bu şemada yok, sınır uygulanmaz) */
  fetchItemBudgets?(): Promise<Record<string, RunBudgetState> | null>;
  /** Satın alınmış kartlar (başlangıç kartları hariç) */
  fetchOwned(): Promise<string[]>;
  /** Kart satın alır; yeni bakiyeyi döner */
  buy(cardId: string): Promise<{ balance: number }>;
  /** Kartların ödenen satın alma fiyatı (kart → yıldız). Satış bunun yarısını geri verir. */
  fetchPaid(): Promise<Record<string, number>>;
  /** Satın alınmış kartı ödenen fiyatın yarısına satar; yeni bakiyeyi döner */
  sell(cardId: string): Promise<{ balance: number }>;
  /** Takılı eşyalar (yuva → kart; null = boş). Kayıt olmayan yuvalar varsayılanı kullanır */
  fetchEquipped(): Promise<Partial<Record<ItemSlot, string | null>>>;
  /** Eşya tak (cardId) / çıkar (null) */
  setEquipped(slot: ItemSlot, cardId: string | null): Promise<void>;
  /** Sınırlı kartlarda dünya genelinde sahip olunan adet (kart → adet) */
  fetchSupply(): Promise<Record<string, number>>;
  /** Koşan hamsteri değiştirir (sunucu sahipliği doğrular) */
  setActiveHamster(cardId: string): Promise<void>;
  /** Sıralama: 'stars' (toplam yıldız) veya 'cards' (sahip olunan kart). Açık değilse hata fırlatır. */
  fetchLeaderboard(kind: LeaderKind, page: number, pageSize: number): Promise<LeaderPage>;
}

export type LeaderKind = 'stars' | 'cards';

export interface LeaderRow {
  rank: number;
  handle: string;
  avatarUrl: string | null;
  stars: number;
  cards: number;
  /** Koşan hamsterin kart kimliği */
  hamster: string;
}

export interface LeaderPage {
  rows: LeaderRow[];
  /** Sıralamadaki toplam oyuncu */
  total: number;
  /** Giriş yapan oyuncunun kendi satırı (misafirse null) */
  me: LeaderRow | null;
  /** Tam sıralama henüz açık değil: sadece oyuncunun kendi satırı biliniyor (rank 0 = bilinmiyor) */
  partial?: boolean;
}
