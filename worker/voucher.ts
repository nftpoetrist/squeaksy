// Claim fişi: SqueaksyStars.claim() için EIP-712 imzası (kontrattaki CLAIM_TYPEHASH ile birebir aynı)
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export const CLAIM_TYPES = {
  Claim: [
    { name: 'account', type: 'bytes32' },
    { name: 'wallet', type: 'address' },
    { name: 'totalEarned', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface ClaimMessage {
  chainId: number;
  stars: Hex;
  account: Hex;
  wallet: Hex;
  totalEarned: bigint;
  deadline: bigint;
}

export function signerAddress(privateKey: Hex): Hex {
  return privateKeyToAccount(privateKey).address;
}

export function signClaim(privateKey: Hex, m: ClaimMessage): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: { name: 'Squeaksy Stars', version: '1', chainId: m.chainId, verifyingContract: m.stars },
    types: CLAIM_TYPES,
    primaryType: 'Claim',
    message: { account: m.account, wallet: m.wallet, totalEarned: m.totalEarned, deadline: m.deadline },
  });
}

// Hediye fişi: SqueaksyCards.giftMint() için EIP-712 imzası (kontrattaki GIFT_TYPEHASH ile birebir aynı)
export const GIFT_TYPES = {
  Gift: [
    { name: 'wallet', type: 'address' },
    { name: 'cardType', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface GiftMessage {
  chainId: number;
  cards: Hex;
  wallet: Hex;
  cardType: bigint;
  deadline: bigint;
}

export function signGift(privateKey: Hex, m: GiftMessage): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: { name: 'Squeaksy Cards', version: '1', chainId: m.chainId, verifyingContract: m.cards },
    types: GIFT_TYPES,
    primaryType: 'Gift',
    message: { wallet: m.wallet, cardType: m.cardType, deadline: m.deadline },
  });
}
