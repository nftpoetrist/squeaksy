/** Kart nadirliği: Common (sade) → Rare (holografik) → Legendary (efsanevi parıltı) → Mythic (cennet ışığı) */
export type Rarity = 'common' | 'rare' | 'legendary' | 'mythic';

/** tokensPerBlock: hamster koşarken tamamlanan her blok için verilen token (sunucuda da aynı: tokens_per_block) */
export const RARITIES: Record<Rarity, { label: string; order: number; tokensPerBlock: number }> = {
  common: { label: 'Common', order: 0, tokensPerBlock: 1 },
  rare: { label: 'Rare', order: 1, tokensPerBlock: 2 },
  legendary: { label: 'Legendary', order: 2, tokensPerBlock: 4 },
  mythic: { label: 'Mythic', order: 3, tokensPerBlock: 8 },
};

/** Final ödülü: tüm bulutlar dolunca */
export const FINALE_BONUS = 10;
/** Günde (UTC) en fazla bu kadar blok yıldız kazandırır; sunucudaki claim_tokens ile aynı olmalı */
export const DAILY_BLOCK_CAP = 20000;

import type { HamsterVariant } from '../character/hamsterBase';
import type { PixsyKind } from '../character/companion';

export type CardArt = 'hamster' | 'sky' | 'inferno' | 'seraph' | 'pixsy' | 'pixsy-eth' | 'pixsy-btc';

/** Eşya yuvaları: back = sırt (Pixsy), head = baş (ileride şapkalar) */
export type ItemSlot = 'back' | 'head';
export const ITEM_SLOTS: ItemSlot[] = ['back', 'head'];
/** Kayıt yoksa geçerli olan takılı eşyalar (başlangıç: Pixsy sırtta) */
export const DEFAULT_EQUIPPED: Record<ItemSlot, string | null> = { back: 'pixsy', head: null };

/**
 * Kart istatistikleri (5 üzerinden piksel çubuk). Seviye başına sabit toplam puan:
 * Common 5 · Rare 8 · Legendary 11 · Mythic 15; dağılım karakterin kişiliğine göre.
 * Görsel/karakter bilgisidir: kazancı belirleyen blok başı yıldızdır (RARITIES + Pixsy bonusu).
 */
export interface CardStat {
  label: string;
  /** 1..5 pip */
  value: number;
}

export interface CardAbility {
  name: string;
  text: string;
}

export interface CardDef {
  id: string;
  /** Set içindeki numara */
  no: number;
  name: string;
  /** Kart türü: hamster ya da eşya */
  kind: 'Hamster' | 'Item';
  /** Tür altı: ör. "Wheel runner" / "Hat" */
  type: string;
  rarity: Rarity;
  /** Sağ üstteki büyük değer */
  power: { label: string; value: string };
  art: CardArt;
  /** Hamster kartları: oyundaki görünüm */
  variant?: HamsterVariant;
  /** Kulübeden satın alma fiyatı (token); yoksa başlangıç kartı */
  price?: number;
  /** Eşya kartları: takıldığı yuva */
  slot?: ItemSlot;
  /** Pixsy kartları: oyundaki görünüm (sırtta) */
  buddy?: PixsyKind;
  /** Eşya takılıyken blok başına ekstra yıldız (sunucuda: card_catalog.bonus) */
  bonusPerBlock?: number;
  /** Sınırlı arz: dünya genelinde en fazla bu kadar (sunucuda: card_catalog.max_supply) */
  maxSupply?: number;
  stats: CardStat[];
  /** Metinlerde {perBlock} → nadirliğe göre blok başı token */
  abilities: CardAbility[];
  flavor: string;
}

export const SET_NAME = 'Genesis';
export const SET_SIZE = 100;

/**
 * Kart kataloğu. Şimdilik herkes başlangıç kartlarına sahip; ileride kazanılan /
 * basılan kartlar oyuncunun profiline eklenecek.
 */
export const CARDS: CardDef[] = [
  {
    id: 'starter-hamster',
    no: 1,
    name: 'Squeaksy',
    kind: 'Hamster',
    type: 'Wheel runner',
    rarity: 'common',
    power: { label: '/BLK', value: '+1' },
    art: 'hamster',
    variant: 'starter',
    stats: [
      { label: 'Speed', value: 2 },
      { label: 'Stamina', value: 2 },
      { label: 'Luck', value: 1 },
    ],
    abilities: [
      { name: 'Wheel Run', text: 'Fills a block every 1.6 s: +{perBlock} star.' },
      { name: 'Storm Surge', text: 'All clouds full: +10 stars.' },
    ],
    flavor: 'Every chain starts with one spin.',
  },
  {
    id: 'pixsy',
    no: 2,
    name: 'Pixsy',
    kind: 'Item',
    type: 'Buddy',
    slot: 'back',
    buddy: 'pixsy',
    rarity: 'common',
    power: { label: 'BONUS', value: '+0' },
    art: 'pixsy',
    stats: [
      { label: 'Style', value: 2 },
      { label: 'Charm', value: 2 },
      { label: 'Luck', value: 1 },
    ],
    abilities: [{ name: 'Squeek Buddy', text: 'Rides on top of your hamster on every run.' }],
    flavor: 'A tiny Squeekchain emblem that never misses a lap.',
  },
  {
    id: 'eth-pixsy',
    no: 5,
    name: 'ETH Pixsy',
    kind: 'Item',
    type: 'Buddy',
    slot: 'back',
    buddy: 'eth',
    bonusPerBlock: 0.5,
    rarity: 'rare',
    power: { label: '/BLK', value: '+0.5' },
    art: 'pixsy-eth',
    price: 600,
    maxSupply: 5000,
    stats: [
      { label: 'Style', value: 3 },
      { label: 'Charm', value: 3 },
      { label: 'Luck', value: 2 },
    ],
    abilities: [
      { name: 'Ether Boost', text: 'While worn: +0.5 star every block.' },
      { name: 'Ether Glow', text: 'Twinkles with tiny stars.' },
    ],
    flavor: 'A smart little buddy. Gas not included.',
  },
  {
    id: 'btc-pixsy',
    no: 6,
    name: 'BTC Pixsy',
    kind: 'Item',
    type: 'Buddy',
    slot: 'back',
    buddy: 'btc',
    bonusPerBlock: 1,
    rarity: 'legendary',
    power: { label: '/BLK', value: '+1' },
    art: 'pixsy-btc',
    price: 1500,
    maxSupply: 1000,
    stats: [
      { label: 'Style', value: 4 },
      { label: 'Charm', value: 2 },
      { label: 'Luck', value: 5 },
    ],
    abilities: [
      { name: 'Digital Gold', text: 'While worn: +1 star every block.' },
      { name: 'Devil Flame', text: 'Burns with every lap.' },
    ],
    flavor: '21 million reasons to run.',
  },
  {
    id: 'sky-unicorn',
    no: 3,
    name: 'Skyeaksy',
    kind: 'Hamster',
    type: 'Cloud runner',
    rarity: 'rare',
    power: { label: '/BLK', value: '+2' },
    art: 'sky',
    variant: 'sky',
    price: 1000,
    maxSupply: 5000,
    stats: [
      { label: 'Speed', value: 3 },
      { label: 'Stamina', value: 2 },
      { label: 'Luck', value: 3 },
    ],
    abilities: [
      { name: 'Wheel Run', text: 'Fills a block every 1.6 s: +{perBlock} stars.' },
      { name: 'Stardust', text: 'Leaves stardust on every run.' },
    ],
    flavor: 'Born above the clouds.',
  },
  {
    id: 'inferno-king',
    no: 4,
    name: 'Infernoksy',
    kind: 'Hamster',
    type: 'Flame runner',
    rarity: 'legendary',
    power: { label: '/BLK', value: '+4' },
    art: 'inferno',
    variant: 'inferno',
    price: 4000,
    maxSupply: 1000,
    stats: [
      { label: 'Speed', value: 5 },
      { label: 'Stamina', value: 4 },
      { label: 'Luck', value: 2 },
    ],
    abilities: [
      { name: 'Blazing Run', text: 'Fills a block every 1.6 s: +{perBlock} stars.' },
      { name: 'Crown of Fire', text: 'Burns brighter with every lap.' },
    ],
    flavor: 'Its throne is made of embers.',
  },
  {
    id: 'seraph-twin',
    no: 7,
    name: 'Seraphoksy',
    kind: 'Hamster',
    type: 'Heaven runner',
    rarity: 'mythic',
    power: { label: '/BLK', value: '+8' },
    art: 'seraph',
    variant: 'seraph',
    price: 12000,
    maxSupply: 300,
    stats: [
      { label: 'Speed', value: 5 },
      { label: 'Stamina', value: 5 },
      { label: 'Luck', value: 5 },
    ],
    abilities: [
      { name: 'Halo Run', text: 'Fills a block every 1.6 s: +{perBlock} stars.' },
      { name: 'Twin Light', text: 'Two heads, one heart, a sky full of light.' },
    ],
    flavor: 'It came down from above to run.',
  },
];

export function cardById(id: string): CardDef | undefined {
  return CARDS.find((c) => c.id === id);
}

/** Oyuncunun sahip olduğu kartlar (şimdilik: başlangıç seti) */
export const STARTER_OWNED = ['starter-hamster', 'pixsy'];

export const STARTER_HAMSTER = 'starter-hamster';

/** Blok başı toplam yıldız: hamster nadirliği + sırttaki Pixsy bonusu */
export function ratePerBlock(hamsterId: string | null | undefined, backItemId: string | null | undefined): number {
  return tokensPerBlock(hamsterId) + (backItemId ? (cardById(backItemId)?.bonusPerBlock ?? 0) : 0);
}

/** Aktif hamsterin blok başı token oranı */
export function tokensPerBlock(hamsterId: string | null | undefined): number {
  const card = CARDS.find((c) => c.id === hamsterId) ?? CARDS.find((c) => c.id === STARTER_HAMSTER)!;
  return RARITIES[card.rarity].tokensPerBlock;
}
