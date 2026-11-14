# Riptide — handoff

Written 2026-11-14 15:25 UTC. Submission closes **2026-11-14 23:59 UTC**
(05:29 IST Nov 15). Read this first; it supersedes `PLAN.md` (stale schedule,
pre-pivot) and the parts of `SPEC.md` listed in §9.

---

## 1. State in one paragraph

Single-player **Live** mode works end to end on NEAR testnet: a player gets
$10 (guest, zero approvals; or wallet, two approvals before play), shapes the
gap of the next Flappy pipe, taps Drop, the bet is placed silently with a
locked multiplier, the engine settles it from on-chain price samples taken
from a real Rhea pool, wins are paid from a house vault, and the player can
withdraw. Verified in a headless phone browser and by `bun run verify`.
**Not done:** tournament mode (next feature, user-requested), hosting, README,
git commit/public repo, demo video, X post, submission.

## 2. What the product is

Euphoria-style short-horizon price trading, skinned as Flappy Bird.

- The bird's height is the live price of **Rhea (Ref) testnet pool 0**
  (`ref-finance-101.testnet`, wNEAR/RFT). Price is read by the contract itself
  via a cross-contract `get_pool` call — no off-chain price signer.
- Every 5 s window is a pipe. Pipes keep spawning ahead of the bird.
- The player shapes the **gap** of the next pipe: slide it up/down, stretch its
  lips (1–4 price bands; a band is a fixed price step, now 4 bps). Until the
  player touches it, the gap rides 2 bands around the bird.
- **Drop** places the bet. **Win** iff every price sample inside that pipe's
  5 s window is inside the gap ("bird passes through"). Pays stake ×
  multiplier. Any sample outside → lose stake. No samples → refund.
- Multiplier = 1 / P(price at window end inside gap), driftless, from realized
  volatility, minus 3% house edge, capped 100x, rejected below 1.05x. Wider
  gap / gap on the bird → lower multiplier.
- Money is dollars to the player. On-chain unit is **mUSD = $0.001**.
  Testnet demo rate: **$10 = 1 NEAR** (`yocto_per_unit = 1e20`). No "chips"
  anywhere in the UI (explicit user decision).
- Modes in the UI: **Demo** (local simulator, pretend $10, no chain) and
  **Live** (testnet). A Multiplayer/tournament mode is planned (§8).

## 3. Repo map

```
SPEC.md                    original spec (partly superseded, see §9)
PLAN.md                    early plan: bug list B1–B10 still valid, schedule stale
docs/IMPLEMENTATION.md     SOURCE OF TRUTH for the contract interface + engine
docs/SIGNING.md            why the wallet path is "app-held key added at sign-in"
docs/HANDOFF.md            this file
contracts/riptide/         Rust, near-sdk 5.x. lib.rs (state, oracle, game, money,
                           views, 23 tests), pricer.rs, phi.rs (generated table)
scripts/gen-phi-table.ts   regenerates phi.rs
apps/engine/index.ts       Bun: poke 1 Hz, settle 2 s, swap bot, 3 NPCs, /guest, /ping
apps/engine/verify.ts      one real-money round on testnet, prints explorer links
apps/engine/quote.ts       Board view type
apps/web/app/page.tsx      the whole game screen (canvas loop, gap editing, money UI)
apps/web/lib/board.ts      skin-blind geometry, types, local quote (mirrors contract)
apps/web/lib/near.ts       RPC views, modes, sessions, wallet/guest, deposit/withdraw
apps/web/lib/fixture.ts    Demo-mode simulator with the same view shapes
apps/web/skins/            Skin interface + flappy.ts (swappable presentation)
apps/web/public/flappy/    MIT sprites (samuelcust/flappy-bird-assets)
```

Third-party code: sprites from `samuelcust/flappy-bird-assets` (MIT); canvas
loop ideas (scrolling background/ground, 4-frame wing flap) adapted from
`omariosouto/flappy-bird-devsoutinho` (MIT). Credited at the top of
`apps/web/skins/flappy.ts`. Must also be listed in the README (hackathon Q-005).

## 4. Testnet deployment

| Account | Role | Notes |
|---|---|---|
| `riptide-6024.testnet` | game contract + owner | ~22 NEAR |
| `riptide-6024-engine.testnet` | pokes, settles, sponsors guests | ~12.3 NEAR — **burns ~1.25 NEAR per guest**, top up before demo |
| `riptide-6024-bot.testnet` | swap bot on pool 0 | ~5.3 NEAR + wNEAR/RFT inventory |
| `riptide-6024-npc1/2/3.testnet` | NPC traders (free chips, session 0) | |
| `riptide-6024-fund1.testnet` | `verify` account | |
| `riptide-6024-fund2.testnet` | used in contract smoke tests | |

Keys: `~/.near-credentials/testnet/<id>.json` (legacy keychain). Never commit.
Guests are sub-accounts `g<…>.riptide-6024-engine.testnet`; their keys live only
in the browser's localStorage.

Live contract config: pool `ref-finance-101.testnet` / `0`, **tick
`3784000000000000000`** (4 bps of spot ≈ 9.46e21; price = amounts[1]·1e36/amounts[0]),
`edge_bps` 0 (session 0), `cash_edge_bps` 300, `max_cash_stake` 1000 ($1),
`max_exposure_bps` 2000, `cash_max_quote_bps` 1_000_000 (100x),
`yocto_per_unit` 1e20. House vault ≈ 100,500 mUSD (~$100.5), funded by the
engine account.

Key transactions:
- Upgrade with cash mode + `migrate()`: `3nCKwMqpgSwXkpND3FwzopNoXcYg6sS81Vj5rRshYaqy`
- First deploy: `CDAenqY93n8xMKK2vPXRHoAppGZarYB5PUYcx5835XE1`
- Vault funded 10 NEAR: `33CpABtumh4GGe7BMuhuDhXSQRxdJzek6m4YK1Zd6Jkn`
- Last `verify` run (cash): place `HYxMZHKttJ8k4F8dUp9nVZvhLXyUpoJzqY8Sdz4Uefcx`, settle `7rE9YVa3QcjokHiKnLHqoQQLrkp4b11i3JGLzua7iyVf`
- First real swap by the bot on pool 0: `6zL2tjvuyyqfbEWoeiPcmcjuN9PLaRxpbqkUcUYWva1v`

Explorer: `https://testnet.nearblocks.io/txns/<hash>`.

## 5. How to run

Prereqs on this Mac: bun 1.3.11, near-cli-rs 0.31.1. **No Xcode CLT**, so Rust
builds run in Docker (colima) — container `riptide-build` (rust:1-bookworm +
cargo-near 0.23, crate mounted at `/w`).

```sh
# contract: test + build (wasm → contracts/riptide/target/linux/near/riptide.wasm)
docker exec riptide-build bash -c 'cd /w && cargo test && cargo near build non-reproducible-wasm'

# engine (must be running for prices, settlement and guest accounts)
ALWAYS_ON=1 bun run engine                   # http :8787; GUEST_COOLDOWN_MS=0 for local testing
bun run verify                               # one real-money round, prints tx links

# web
cd apps/web && bunx next dev -p 3001         # port 3000 is taken by another project here
# .env.local: NEXT_PUBLIC_ENGINE_URL=http://localhost:8787 (see .env.example)
```

Engine env: `RPC_URL`, `CONTRACT_ID`, `ACCOUNT_PREFIX`, `PORT`, `ALWAYS_ON`,
`GUEST_COOLDOWN_MS` (default 10 min per IP), and for hosting
`ENGINE_KEY`/`BOT_KEY`/`NPC1_KEY`..`NPC3_KEY` (private keys instead of the
keychain files).

Currently running on this machine (will die with the session/laptop):
engine on :8787, `next dev` on :3001 (LAN: `http://192.168.29.240:3001`),
Docker container `riptide-build`.

## 6. Evidence (what has actually been verified)

- Contract: 23 unit tests pass (pricer, PHI table, range quotes, pass-through
  win/lose/refund incl. exact edges, ring wraparound, sample gap, min-quote
  guard, gap width cap, deposit/withdraw/failed-transfer restore, exposure cap,
  vault conservation, edge, 100x cap, migration keeps session 0).
- Testnet: `bun run verify` → `verify: OK` on the cash path.
- Browser (headless Chromium, 390×844, live testnet): guest created + $10
  deposited in 9 s with zero prompts → 3 × $0.10 Drops (balance $9.70 at once)
  → engine settled all 3 → "Your trades" shows results → Withdraw → $0.00.
- Demo mode: $10 start, trades, settles, floaters, no console errors.
- Browser multiplier vs on-chain `quote` view: within ~1–3% (min_quote guard
  is 85% of shown quote to absorb that plus price drift during the ~2–3 s tx).
- Live stats at 2.5 bps bands: sample every ~2 s, realized vol ~4–5 bps per 5 s.

**Not verified:** a real wallet sign-in (needs a browser extension: Meteor or
Intear on testnet). Path is implemented per `docs/SIGNING.md` — one approval to
add the session key, one to deposit $10, then zero during play.

## 7. Decisions log (user, in order)

1. Zero popups during gameplay; one approval at start is fine → app-held
   function-call key added at sign-in; guest mode for no-wallet judges.
2. Real Rhea testnet pool, no mocks → pool 0 + our own swap bot (testnet pools
   are otherwise idle: 2 of 2982 moved in 2 min).
3. Flappy Bird skin, reuse an existing implementation → MIT sprites + adapted loop.
4. "Pipes always on is bad" → then "spawn pipes continuously, move the gap up/down
   and resize it" → current gap-shaping mechanic, **pass-through** win rule,
   range pricing.
5. Calmer visuals: fixed camera (re-centres only near the screen edge),
   smoothed trail, zoomed in (~4 pipes, ~5 bands visible).
6. Show results as money: "+$0.28" / "−$0.10" floaters.
7. Modes: test / multiplayer / real. → **"No chips, work like Euphoria"**:
   single player with real (testnet) dollars first, tournament after.
8. Deposit $10, play to $0 → cash mode = session 1 on-chain, house vault.

## 8. Next steps, in priority order

1. **Commit.** Nothing is committed yet (`git init` done, no commits). Use
   `.gitignore` as is; check no keys/`.env.local` are staged. Ask the human
   before making the remote public / pushing (hackathon rule: human confirms).
2. **Tournament mode with a shareable link** (user's next ask). Agreed design:
   host creates `(entry $0/$1/$5/$10 from balance, length 3/5/10 min, start
   time)` → link `/?t=<id>` → players join in the lobby before start (one
   approval if not signed in; entry fee debited from balance) → everyone gets
   equal virtual stack, same live pipes → live leaderboard → at the bell engine
   calls `settle_session`: pot = Σ entries, split 50/30/20 to balances, <2
   players refund, ties split, late join rejected, bets must end before bell.
   Contract already has sessions/chips/leaderboard plumbing (session 0 free,
   session 1 cash); needs `create_session/join_session/settle_session`,
   session phase + end time, prize payout. UI: lobby, countdown, leaderboard
   drawer, link copy. Estimate ~3 h total.
3. **Wallet test** with Meteor or Intear on testnet (human, 5 min).
4. **Hosting**: frontend (Vercel) + engine (any always-on box; needs the keys as
   env vars and a public URL for `NEXT_PUBLIC_ENGINE_URL`). Hosted demo should
   stay up through Nov 18 (ideally Nov 25). Without the engine, the board
   freezes and bets refund.
5. **Top up** the engine account (guests cost 1.25 NEAR each) and the vault
   (`fund_vault`) before judging. `near account create-account
   sponsor-by-faucet-service` works from the CLI; the browser faucet
   (`helper.testnet.near.org`) now returns 429.
6. **README** for a machine reader (hackathon Q-017: Claude Code + Codex screen
   for reproducibility): what it is, "do X → see Y", `bun run verify`, accounts,
   tx links, third-party/AI-code disclosure, honest risk section (§10).
7. **Demo video + X post** (human; tag @NEARProtocol #NEARHackathon; video is
   mandatory for local-only demos per Q-012).
8. **Submit** via form or `POST https://nearhackathon.com/api/applications`
   (human confirms payload; needs a **mainnet** NEAR payout account, public repo
   URL, X post URL; tracks `games` + `defi`/`open`). Feature freeze target
   20:00 UTC.

## 9. Where SPEC.md is stale

- Rows/columns relative to spot → **absolute bands** (`band_lo..band_hi`) and
  absolute windows.
- Touch-anywhere win (cumulative) → **pass-through** (all samples in the
  window inside the gap).
- Single-band cells, `cells` in `board()` → gaps of 1–8 bands (UI caps 4);
  board has `sigma_ppm`, no cells; quotes via `quote()` view or local formula.
- "Chips" tournament as the lead mode → **cash (mUSD) single player** leads;
  session 0 free chips exist only for NPCs/tournament.
- `mockpool` → real Rhea pool 0 + swap bot.
- Wallet-selector → near-connect 0.12 with `addFunctionCallKey` (the
  deprecated `signIn({contractId})` is a no-op there).
- σ via mean-abs-return table → realized variance + `isqrt`; band = 4 bps fixed tick.

## 10. Known issues / risks

- **Oracle manipulation:** anyone who can swap pool 0 moves our price. Testnet
  pool is shallow (~1500 wNEAR). Caps (3% edge, $1/trade, 100x, 20% exposure)
  bound vault loss; they don't remove the attack. Must be stated in README.
- **Front-running:** a swap visible before the next `poke` lets someone place a
  gap the price already moved into. Same mitigation/disclosure.
- **Pricing approximation:** quote uses P(end inside gap); the real win
  condition (stay inside the whole window) is harder, so true odds are worse
  than quoted → house-favourable, players lose more often than the multiplier
  implies. Fine for a demo; disclose, or price "stay inside" properly later.
- **"quote below minimum"** rejections when price moves during the ~2–3 s tx;
  guard set to 85% of shown quote.
- **Public RPC limits:** fastnear 429s under load; engine/verify use a failover
  list (fastnear ×2, drpc, intea). The browser still uses one RPC
  (`NEXT_PUBLIC_RPC_URL`).
- **Nonce collisions:** don't sign manual txs as `riptide-6024-engine` while
  the engine runs; `verify` uses `fund1`, never an NPC account.
- **Samples every ~2 s, not 1 s** (poke = 3 receipts). Pass-through windows see
  ~2–3 samples.
- Engine is a single local process; it is also the guest faucet (per-IP
  limit, 1.25 NEAR each) — a griefer can drain it; fine for judging week.
- `leaderboard()` rows still name the amount `chips` (also for session 1).
- npc1's 0.05 NEAR from an early yocto-deposit smoke test is stranded in the
  contract (test money).
- `apps/web/fixtures/board.json` still contains old `cells`/`sigma_bps`
  fields; the simulator only reads `spot`, `tick`, `sigma_bps` from it.

## 11. Gotchas for whoever continues

- `docs/IMPLEMENTATION.md` is the interface contract between web, engine and
  contract — change it first.
- When editing via JS `String.replace`, `$$` in the replacement becomes `$`
  (this once deleted the `$` from the dollar formatter).
- Python's TLS store on this Mac is broken; use bun/curl for HTTP.
- `rpc.testnet.near.org` is slow/rate-limited; lava endpoints return 410.
- Port 3000 belongs to another local project (drift-near).
- The Next dev overlay will flag hydration mismatches; anything depending on
  localStorage (mode) must render only after mount.
