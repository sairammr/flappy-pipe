# Riptide — submission checklist

Deadline 2026-11-14 23:59 UTC. Testnet only (user decision). `[x]` only when verified.

## 1. Game feel (Euphoria-style moments)
- [x] Bird replays real on-chain samples (4 s buffer, slows instead of guessing), never a guessed price
- [x] Pipe stands on the window end (the gate): decided where the bird's centre meets the pipe
- [x] Hit/pass decided on screen the instant the bird gets there (same rule as contract), chain confirms later
- [x] Hit: red pipe, shake, red flash, vibrate, "Hit the pipe −$0.10"; pass: green flash, "+$0.28 Through!"
- [x] Win pays into the balance on screen at once
- [x] RPC node-lag fixes: board never steps back, positions+balance read at one block, newest wins
- [x] Aimed pipe stays ≥4.5 s ahead so a Drop never lands on a started window
- [x] Verified: demo + live testnet, headless phone browser, 0 console errors (`bun apps/web/lib/board.check.ts`)

## 2. On-chain logic (audit 2026-11-14)
- [x] Fair pricing: rule changed to the gate (price at window end), which is exactly what the pricer prices
- [x] Gate prices stored at poke time → a late settle can't turn a loss into a refund
- [x] Quotes priced from the last sample time, not now
- [x] `leaderboard` view bounded; new bounded `leaders()` top 20
- [x] `set_config`: 1 yocto, bounds, unit rate locked after first deposit
- [x] Redeployed with `migrate` (tx 7ooWKBU5…), balances + vault kept; 30 contract tests pass
- [x] README discloses: house bot moves pool 0, front-running window, owner powers, storage, faucet
- [ ] Storage deposits for players (documented as known limitation instead)
- [x] Re-run `bun run verify` on v3 → `verify: OK` (place ELNg2raZ…, settle 6EZCiAPQ…)

## 3. NEAR Intents
- [x] Decision: testnet only → not used; README + deck say so and name it as the mainnet path

## 4. Global leaderboard
- [x] Contract: per-player cash P&L, trades, wins, best multiplier; `leaders()`, `stats()`
- [x] UI: 🏆 sheet, your row highlighted
- [x] Verified populated on testnet (`leaders()` returns ranked rows)

## 5. Multiplayer / tournament
- [x] Contract: create/join/settle_tourney (50/30/20, ties split, <2 refund, late join rejected, bets end before bell); 5 tests
- [x] Engine: settles tournaments at the bell
- [x] UI: ⚔ sheet (create, open list), `/?t=<id>` link, lobby banner + Join + copy link, live rank + countdown, standings, results
- [x] Verified end-to-end with 2 browsers on testnet: tournament #2, $1 entry, both played, engine settled at the bell, tie split $1/$1
- [x] Browser RPC failover (fastnear 429s have no CORS header); 4/4 drops placed after

## 6. Onboarding
- [x] First-run 3-step sheet (bird = price, shape the pipe, Drop), skippable, ends in guest / wallet / demo
- [x] Demo vs Live pill; tournaments + leaderboard explain they're Live-only in Demo
- [x] Offline / broke / watching / out-of-points / bell states

## 6b. Product pass (user request 18:00 UTC)
- [x] Multiple markets on-chain (RFT, ELIXIR, GOLD), switcher on top, one shared balance
- [x] Cash out on top (confirm sheet) + Wallet page: deposit $1–$25, cash out, forward to any account, history, how money works
- [x] Sidebar (desktop) / ☰ drawer (phone): Play, Multiplayer, Leaderboard, Wallet, How to play, Demo/Live, account
- [x] Leaderboard page (rank, P&L, win rate, best), Multiplayer page (create with market + start time → copyable link → lobby; open list with Join/Link/Watch)
- [x] Drop button: "Drop $0.10 · 2.4x / win $0.24", or why it's off
- [x] Gap: tap to place, drag to move, −/+ size buttons
- [x] Engine under public RPC limits (bot balance cache, NPCs off)
- [x] Verified: ELIXIR drops placed + won, tournament created from page → lobby on GOLD, demo deposit/cash out, 0 page errors

## 6c. Demo readiness (19:50 UTC)
- [x] Fresh-player run on live testnet: onboarding → guest funded 7 s → Drop → settle → cash out, 0 page errors
- [x] Fixed: "Funding your $10…" instead of a premature Deposit button; Drop button clamped on the board; wallet RPC; verify tracks its own position
- [x] Dev server default is Live (was started with the demo flag)
- [x] 31 contract tests, board.check, tsc, `bun run verify` (Won, #741)

## 7. Ship
- [x] Git repo with history, pushed to private `sairammr/flappy-pipe`
- [x] README (do X → see Y, accounts, tx links, third-party + AI disclosure, risks)
- [x] Pitch deck (Slides artifact)
- [ ] Host web (Vercel) + engine (always-on box) — needs the human's accounts
- [x] Top up: engine 30 NEAR, bot 10.9 NEAR (faucet accounts fund3–6); engine idles when nobody plays
- [x] Wallet sign-in via near-connect (NEAR CLI wallet, scripted): key added, $1 deposit, silent Drop (txs in README). Meteor/Intear UI not tried
- [x] Demo video: Remotion, 88 s, real testnet recordings (video/). [ ] Soniox voiceover (needs key) [ ] X post — human
- [ ] Make repo public + submit — human confirms
