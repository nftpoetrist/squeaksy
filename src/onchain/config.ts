/**
 * Onchain mod (Sepolia: STARS claim + soulbound kartlar). Şimdilik YALNIZCA test kurulumunda açık:
 * `npm run dev:onchain` (.env.onchain.local → VITE_ONCHAIN_TEST=1). Canlı site ve normal `npm run dev` eski
 * davranışla çalışır (bkz. docs/onchain.md). Yayına geçişte bu anahtar canlıda da açılacak.
 */
export const ONCHAIN = import.meta.env.VITE_ONCHAIN_TEST === '1';

/** Test kurulumunda X yerine anonim "Test sign in" (X API kredisi gerektirmez) */
export const TEST_SIGN_IN = ONCHAIN && import.meta.env.DEV;

export const STARS_ADDRESS = (import.meta.env.VITE_STARS_ADDRESS as string | undefined)?.toLowerCase() ?? '';
export const CARDS_ADDRESS = (import.meta.env.VITE_CARDS_ADDRESS as string | undefined)?.toLowerCase() ?? '';
