// Üretildi: node tools/nft-assets.mjs (kaynak: src/collection/cards.ts). Elle düzenlemeyin.
export interface NftCard {
  chainType: number;
  id: string;
  name: string;
  kind: 'Hamster' | 'Pixsy';
  type: string;
  rarity: string;
  starsPerBlock?: number;
  bonusPerBlock?: number;
  maxSupply: number;
  stats: Array<{ label: string; value: number }>;
  abilities: Array<{ name: string; text: string }>;
  flavor: string;
  set: string;
}

export const NFT_CARDS: NftCard[] = [
  {
    "chainType": 1,
    "id": "sky-unicorn",
    "name": "Skyeaksy",
    "kind": "Hamster",
    "type": "Cloud runner",
    "rarity": "Rare",
    "starsPerBlock": 2,
    "maxSupply": 5000,
    "stats": [
      {
        "label": "Speed",
        "value": 3
      },
      {
        "label": "Stamina",
        "value": 2
      },
      {
        "label": "Luck",
        "value": 3
      }
    ],
    "abilities": [
      {
        "name": "Wheel Run",
        "text": "Fills a block every 1.6 s: +2 stars."
      },
      {
        "name": "Stardust",
        "text": "Leaves stardust on every run."
      }
    ],
    "flavor": "Born above the clouds.",
    "set": "Genesis"
  },
  {
    "chainType": 2,
    "id": "inferno-king",
    "name": "Infernoksy",
    "kind": "Hamster",
    "type": "Flame runner",
    "rarity": "Legendary",
    "starsPerBlock": 4,
    "maxSupply": 2500,
    "stats": [
      {
        "label": "Speed",
        "value": 5
      },
      {
        "label": "Stamina",
        "value": 4
      },
      {
        "label": "Luck",
        "value": 2
      }
    ],
    "abilities": [
      {
        "name": "Blazing Run",
        "text": "Fills a block every 1.6 s: +4 stars."
      },
      {
        "name": "Crown of Fire",
        "text": "Burns brighter with every lap."
      }
    ],
    "flavor": "Its throne is made of embers.",
    "set": "Genesis"
  },
  {
    "chainType": 3,
    "id": "seraph-twin",
    "name": "Seraphoksy",
    "kind": "Hamster",
    "type": "Heaven runner",
    "rarity": "Mythic",
    "starsPerBlock": 8,
    "maxSupply": 1250,
    "stats": [
      {
        "label": "Speed",
        "value": 5
      },
      {
        "label": "Stamina",
        "value": 5
      },
      {
        "label": "Luck",
        "value": 5
      }
    ],
    "abilities": [
      {
        "name": "Halo Run",
        "text": "Fills a block every 1.6 s: +8 stars."
      },
      {
        "name": "Twin Light",
        "text": "Two heads, one heart, a sky full of light."
      }
    ],
    "flavor": "It came down from above to run.",
    "set": "Genesis"
  },
  {
    "chainType": 4,
    "id": "eth-pixsy",
    "name": "ETH Pixsy",
    "kind": "Pixsy",
    "type": "Buddy",
    "rarity": "Rare",
    "bonusPerBlock": 0.5,
    "maxSupply": 5000,
    "stats": [
      {
        "label": "Style",
        "value": 3
      },
      {
        "label": "Charm",
        "value": 3
      },
      {
        "label": "Luck",
        "value": 2
      }
    ],
    "abilities": [
      {
        "name": "Ether Boost",
        "text": "While worn: +0.5 star every block."
      },
      {
        "name": "Ether Glow",
        "text": "Twinkles with tiny stars."
      }
    ],
    "flavor": "A smart little buddy. Gas not included.",
    "set": "Genesis"
  },
  {
    "chainType": 5,
    "id": "btc-pixsy",
    "name": "BTC Pixsy",
    "kind": "Pixsy",
    "type": "Buddy",
    "rarity": "Legendary",
    "bonusPerBlock": 1,
    "maxSupply": 2500,
    "stats": [
      {
        "label": "Style",
        "value": 4
      },
      {
        "label": "Charm",
        "value": 2
      },
      {
        "label": "Luck",
        "value": 5
      }
    ],
    "abilities": [
      {
        "name": "Digital Gold",
        "text": "While worn: +1 star every block."
      },
      {
        "name": "Devil Flame",
        "text": "Burns with every lap."
      }
    ],
    "flavor": "21 million reasons to run.",
    "set": "Genesis"
  }
];
