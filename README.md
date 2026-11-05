# Squeaksy

A cozy pixel idle game built for the [Squeekchain](https://squeekchain.com) community.

**Play: [squeaksy.xyz](https://squeaksy.xyz)**

Wake your hamster, let it run in the golden wheel and fill the chained block clouds. Every completed block pays stars. Fill every cloud and a storm pays a bonus. Spend stars on limited hamsters and Pixsy buddies that earn more per block, and climb the leaderboard.

Stars are an in-game score: sign in with X, no wallet, no token, no real money.

## The game

- **Hamsters:** Squeaksy (Common, 1 star per block), Skyeaksy (Rare, 2), Infernoksy (Legendary, 4), Seraphoksy (Mythic, 8).
- **Pixsy buddies** ride on your hamster's back. ETH Pixsy adds 0.5 and BTC Pixsy adds 1 star per block.
- **Limited supply:** Rare cards 5,000 each, Legendary 1,000, Mythic 300 worldwide. Cards sell back for half of the price paid.
- **Leaderboard:** overall stars and top collectors, 100 players per page. Every player has their own rank: on a tie, whoever joined first ranks higher.
- Works on mobile in landscape.

## Squeekchain Live

The game is tied to the real Squeekchain hamster (Sepolia):

- The **Real Cloud** fills with the block the real hamster is building right now.
- The weather follows his wheel: clear sky while he runs, drizzle while he rests.
- When a `BatchSettled` event with completed blocks reaches 12 confirmations, cyan lightning strikes the Real Cloud on every open screen at once, with a link to the transaction.
- **Block Bounty:** every signed-in player whose hamster is running at that moment gets 3 stars per real block (25 to 150). A resting hamster gets nothing.

The server (Supabase, `pg_cron` + `pg_net`) reads `api.squeekchain.com` every 30 seconds and checks the chain ID, the Core contract and the confirmations. Rewards come only from settled chain events, and the server itself checks that the player was running, so a browser can't fake a landing or a reward. Design notes: [docs/squeekchain-live.md](docs/squeekchain-live.md).

The **About** section explains the Real Cloud next to the game itself: Infernoksy runs an ice blue wheel, the cloud fills and real blocks land as lightning.

## Squeekchain links

- Website: [squeekchain.com](https://squeekchain.com)
- Docs: [docs.squeekchain.com](https://docs.squeekchain.com/)
- Whitepaper: [docs.squeekchain.com/whitepaper](https://docs.squeekchain.com/whitepaper/)
- X: [@squeekchain](https://x.com/squeekchain) · Discord: [discord.gg/squeekchain](https://discord.gg/squeekchain)

## Tech

- [Vite](https://vite.dev) + TypeScript, no framework. Pixel art is drawn in code on canvas. Lightning and thunder are synthesized; the rain is a recorded loop.
- [Supabase](https://supabase.com) for X sign-in, balances, cards, the leaderboard and Squeekchain Live. All game rules that matter (earning limits, prices, supply, Block Bounty) are enforced in the database (`supabase/schema.sql`), not in the browser. Setup: [supabase/README.md](supabase/README.md).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in your own Supabase URL and anon key
npm run dev
```

Without Supabase keys the game still runs; sign-in is simply disabled.

## Build

```bash
npm run build   # output in dist/
```

## Squeekchain Genesis

squeekchain-project: 6fe40ef9-cbb1-4e11-8ec3-d8b55ef4eb67

## License

All rights reserved unless a license file says otherwise.
