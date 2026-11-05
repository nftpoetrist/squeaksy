# Squeaksy

A cozy pixel idle game built for the [Squeekchain](https://squeekchain.com) community.

Wake your hamster, let it run in the golden wheel and fill the chained block clouds. Every completed block pays stars. Fill every cloud and a storm pays a bonus. Spend stars on limited hamsters and Pixsy buddies that earn more per block, and climb the leaderboard.

Stars are an in-game score: no wallet, no real money.

## Tech

- [Vite](https://vite.dev) + TypeScript, no framework. All art and sound are generated in code (pixel sprites on canvas, synthesized audio).
- [Supabase](https://supabase.com) for X sign-in, balances, cards and the leaderboard. All game rules that matter (earning limits, prices, supply) are enforced in the database (`supabase/schema.sql`), not in the browser.

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

## License

All rights reserved unless a license file says otherwise.
