# Riptide

Flappy Bird where the bird is a live on-chain price. You bet real (testnet) dollars on where
it will be when it reaches the next pipe.

- The bird's height is a live **Rhea (Ref) testnet pool** price. Three markets:
  wNEAR/RFT (pool 0), wNEAR/ELIXIR (pool 275), wNEAR/GOLD (pool 274), one shared balance.
  The contract reads each pool itself with a cross-contract `get_pool` call. No off-chain
  price signer is involved.
- A pipe stands every 5 s. Drag the gap of the next pipe up or down, or stretch its lips, then
  tap **Drop**. If the bird is inside the gap when it reaches the pipe, you win
  stake × multiplier. If it hits the pipe, you lose the stake.
- The multiplier is `1 / P(price at the pipe inside the gap)`, computed from realized
  volatility, minus a 3% house edge and capped at 100x. A narrow gap, or one far from the
  bird, pays more.
- Everything is settled on-chain by a permissionless `settle`: balances, bets, the house vault,
  the global leaderboard and tournaments.

**Testnet only.** $10 = 1 testnet NEAR (`yocto_per_unit = 1e20`, unit = mUSD = $0.001).

## Try it: do X, see Y

| Do | See |
|---|---|
| Open the app and pick **Demo** | Local simulator with a pretend $10. No chain, no wallet. |
| Pick **Live** and tap **Play as guest** | About 10 s later you have a fresh testnet account holding $10 in the game, with zero wallet prompts |
| Pick **RFT / ELIXIR / GOLD** at the top | The board switches to that pool's live price |
| Tap where you think the bird will be (or drag the gap; − / + change its size), then **Drop $0.10 · 2.4x** | Your balance drops by the stake right away. The pipe turns solid with "2.4x / win $0.24" |
| Watch the bird reach that pipe | Inside the gap: green flash and "+$0.14 Through!", and the balance goes up at once. On the pipe: red pipe, shake and "−$0.10 Hit the pipe". The chain's `settle` confirms it a few seconds later |
| **Leaderboard** (sidebar; ☰ on phones) | Global on-chain cash P&L, win rate, best multiplier, your rank |
| **Multiplayer** → $1 · 3 min · GOLD → **Create** | A tournament with a link `/?t=<id>&m=<market>` to copy. Friends open it and tap **Join $1** |
| Play while it runs | Everyone starts with 10,000 points on the same pipes, with a live rank in the banner. At the bell the pot pays 50/30/20 into balances |
| **Cash out** (top right) or **Wallet** | Balance back out as testnet NEAR; guests can forward it to any `*.testnet` account. Wallet also deposits $1–$25 and lists your trades |

## Prove it from the command line

```sh
bun install
bun run verify          # one real-money round on testnet; prints every tx as a nearblocks link
docker exec riptide-build bash -c 'cd /w && cargo test'   # 30 contract tests (Rust runs in Docker here)
bun apps/web/lib/board.check.ts                             # the client's copy of the settle rule
```

## Run it

```sh
bun install
ALWAYS_ON=1 bun run engine                 # :8787 — poke 1 Hz, settle 2 s, tournaments, swap bot, NPCs, guest faucet
cd apps/web && cp .env.example .env.local  # set NEXT_PUBLIC_ENGINE_URL=http://localhost:8787
bunx next dev -p 3001
```

The engine's keys come from `~/.near-credentials/testnet/<id>.json`, or from the
`ENGINE_KEY` / `BOT_KEY` / `NPC1_KEY`..`NPC3_KEY` env vars when hosted. Without the engine
the board freezes and open bets refund. Every engine job calls a permissionless method, so
anyone can run one.

Contract: `contracts/riptide` (near-sdk 5.30). Build with `cargo near build non-reproducible-wasm`.

## How it works

```
Rhea pool 0 ──get_pool──▶ riptide-6024.testnet ◀──place / settle── browser (session key, no popups)
     ▲                       │  samples ring (128), gate prices,      ▲
     │ swaps (bot)           │  bets, vault, stats, tournaments       │ board / positions views
     └──── engine (Bun) ─────┴── poke 1 Hz, settle 2 s, settle_tourney┘
```

- **Oracle.** `poke()` → `get_pool` → `on_pool` (`#[private]`, `#[callback_result]`) records
  a price sample (at most one per 800 ms). As each sample lands, the contract prices every
  window end (pipe) it crossed on the straight line from the previous sample, and stores it in
  `gates` (last 1024 windows).
- **Settle rule.** A bet wins iff `gates[window] ∈ [band_lo·tick, (band_hi+1)·tick)`. If there
  is no gate price (samples more than 10 s apart), the stake is refunded. The browser draws the
  bird on the same straight lines between the same samples, 4 s behind chain time, and settles
  each pipe with the same rule at the moment the bird reaches it. The chain's verdict overrides
  the browser if they ever disagree.
- **Money.** `deposit` (payable), then `place` moves the stake into the house vault and adds the
  payout to `open_liability`. A bet is rejected if total liability would exceed 20% of the
  vault, or if the stake is over $1. `withdraw` needs 1 yocto and restores the balance if the
  transfer fails.
- **No popups.** Signing in adds an app-held function-call key limited to game methods (see
  `docs/SIGNING.md`). Guests get an engine-sponsored sub-account. Deposit and withdraw go
  through the wallet.
- **Tournaments** (sessions ≥ 2). `create_tourney`, `join_tourney` (before the start; the
  entry is paid from your balance) and `place_chips(id, …)` (only pipes inside the
  tournament). `settle_tourney` is permissionless after the bell and pays the pot 50/30/20 by
  points. Ties split their places' shares, and with fewer than 2 players the entries are
  refunded. The vault is never touched.
- **Leaderboard.** `leaders()` lists the top 20 by cash P&L (trades plus tournament prizes),
  kept sorted at settle time with bounded gas.

Interface reference: `docs/IMPLEMENTATION.md`. Project state and decisions: `docs/HANDOFF.md`.

## Testnet deployment

| Account | Role |
|---|---|
| `riptide-6024.testnet` | game contract + owner |
| `riptide-6024-engine.testnet` | poke, settle, guest sponsor |
| `riptide-6024-bot.testnet` | swap bot on pool 0 |
| `riptide-6024-npc1/2/3.testnet` | NPC traders |

Key transactions (`https://testnet.nearblocks.io/txns/<hash>`):
- v3 upgrade (gate rule, leaderboard, tournaments) + `migrate`: `7ooWKBU5unLVhQRbWdXGfKcaMKUR8dSY1n7yTpcJ8GY5`
- v2 upgrade (cash mode): `3nCKwMqpgSwXkpND3FwzopNoXcYg6sS81Vj5rRshYaqy`
- First deploy: `CDAenqY93n8xMKK2vPXRHoAppGZarYB5PUYcx5835XE1`
- Vault funded with 10 NEAR: `33CpABtumh4GGe7BMuhuDhXSQRxdJzek6m4YK1Zd6Jkn`
- First real swap by the bot on pool 0: `6zL2tjvuyyqfbEWoeiPcmcjuN9PLaRxpbqkUcUYWva1v`

## Risks (read before trusting it with anything)

- **The house moves the price.** Testnet pool 0 is otherwise idle, so our own bot's random
  swaps are what move it. The operator, or anyone with ~1500 wNEAR, could push the price out of
  a player's gap. On mainnet this needs a deep pool or a TWAP/multi-source oracle.
- **Front-running.** A bet is priced from the last sample, which can be up to 5 s old. Someone
  who sees the live pool move first gets a small edge. The $1 stake cap, the 100x cap and the
  20% exposure cap bound the vault's loss; they don't remove the edge.
- **Owner powers.** `set_config` (1 yocto, owner only) can change the pool, tick and caps. The
  unit rate is locked after the first deposit. There is no timelock.
- **Storage.** The contract pays for player storage. Positions are pruned to 32 open + 16
  settled per account, but spam accounts can still grow state.
- **Guest faucet.** The engine gives 1.25 testnet NEAR per IP every 10 min. It is a testnet
  convenience and can be drained.
- **Liveness.** Samples need the engine's poke. If samples are more than 10 s apart, the gates
  in between are unpriced and those bets refund. Nothing is lost, but nothing is won.
- **NEAR Intents** is not used. The project is testnet-only, and 1Click / `intents.near` are
  mainnet services.

## Credits and AI disclosure

- Sprites: [samuelcust/flappy-bird-assets](https://github.com/samuelcust/flappy-bird-assets)
  (MIT, `apps/web/public/flappy/LICENSE-assets.txt`).
- Canvas loop ideas (scrolling background/ground, 4-frame wing flap) adapted from
  [omariosouto/flappy-bird-devsoutinho](https://github.com/omariosouto/flappy-bird-devsoutinho)
  (MIT). Credited in `apps/web/skins/flappy.ts`.
- Written with AI coding assistants (Claude Code). A human directed the product decisions;
  they are logged in `docs/HANDOFF.md` §7.

MIT licensed.
