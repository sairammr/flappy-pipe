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
- [ ] Re-run `bun run verify` on v3

## 3. NEAR Intents
- [x] Decision: testnet only → not used; README + deck say so and name it as the mainnet path

## 4. Global leaderboard
- [x] Contract: per-player cash P&L, trades, wins, best multiplier; `leaders()`, `stats()`
- [x] UI: 🏆 sheet, your row highlighted
- [ ] Verified populated on testnet (fills on the next cash settles)

## 5. Multiplayer / tournament
- [x] Contract: create/join/settle_tourney (50/30/20, ties split, <2 refund, late join rejected, bets end before bell); 5 tests
- [x] Engine: settles tournaments at the bell
- [x] UI: ⚔ sheet (create, open list), `/?t=<id>` link, lobby banner + Join + copy link, live rank + countdown, standings, results
- [ ] Verified end-to-end with 2 browsers on testnet (running)

## 6. Onboarding
- [x] First-run 3-step sheet (bird = price, shape the pipe, Drop), skippable, ends in guest / wallet / demo
- [x] Demo vs Live pill; tournaments + leaderboard explain they're Live-only in Demo
- [x] Offline / broke / watching / out-of-points / bell states

## 7. Ship
- [x] Git repo with history, pushed to private `sairammr/riptide`
- [x] README (do X → see Y, accounts, tx links, third-party + AI disclosure, risks)
- [x] Pitch deck (Slides artifact)
- [ ] Host web (Vercel) + engine (always-on box) — needs the human's accounts
- [ ] Top up engine account (~8.9 NEAR, 1.25 per guest) + vault
- [ ] Wallet sign-in test (Meteor/Intear) — human
- [ ] Demo video + X post — human
- [ ] Make repo public + submit — human confirms
