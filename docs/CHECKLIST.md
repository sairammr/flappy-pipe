# Riptide — submission checklist

Deadline 2026-11-14 23:59 UTC. Order = priority. `[x]` only when verified.

## 1. Game feel (Euphoria-style moments)
- [x] Bird replays real on-chain samples (3 s buffer), never a guessed price
- [x] Pipe drawn over its exact 5 s window (what's under the pipe is what counts)
- [x] Hit/pass decided on screen the instant the bird does it (same rule as contract), chain confirms later
- [x] Hit: red pipe, shake, red flash, vibrate, "Hit the pipe −$0.10" at impact; pass: green flash, "+$0.28"
- [x] Win pays into the balance on screen at once
- [x] RPC node-lag fixes: board never steps back, positions+balance read at one block, newest wins
- [x] Aimed pipe stays ≥3 s ahead so a Drop never lands on a started window ("window not placeable")
- [x] Verified: demo + live testnet, headless phone browser, 0 console errors (`bun apps/web/lib/board.check.ts`)

## 2. On-chain logic (audit 2026-11-14, see HANDOFF §10)
- [ ] Price "stay inside the gap" properly (P(all samples in gap), not P(end in gap)); quoted odds are currently too generous to the house
- [ ] Per-window min/max/count so a loss can't turn into a refund once samples leave the 128-ring
- [ ] Storage: charge/deposit for storage on first deposit; cap players list
- [ ] `leaderboard` view: paginate (unbounded loop today)
- [ ] `set_config` bounds (yocto_per_unit, pool) + 1 yocto
- [ ] Redeploy + `migrate`, re-run `bun run verify`
- [ ] README discloses: house bot moves pool 0, front-running window, owner powers

## 3. NEAR Intents
- [ ] Not used anywhere today (repo name only). Decide: 1Click deposit (mainnet-only) or drop the claim in README/pitch

## 4. Global leaderboard
- [ ] Contract: per-player cash P&L, trades, best multiplier; paginated `leaderboard(from, limit)`
- [ ] UI: leaderboard drawer (all-time + today), your rank

## 5. Multiplayer / tournament (design in HANDOFF §8.2)
- [ ] Contract: `create_session`, `join_session`, `settle_session` (pot split 50/30/20, <2 players refund, ties split, late join rejected, bets end before bell)
- [ ] Engine: settle sessions at the bell
- [ ] UI: create, share link `/?t=<id>`, lobby, countdown, live leaderboard, results
- [ ] Verified with 2 browsers on testnet

## 6. Onboarding
- [ ] First-run screen: what the bird is, how to shape a gap, Drop, how you win/lose (3 steps, skippable)
- [ ] Clear Demo vs Live, guest vs wallet
- [ ] Empty/offline/broke states

## 7. Ship
- [x] Git repo with history
- [ ] README (do X → see Y, accounts, tx links, third-party + AI disclosure, risks)
- [ ] Host web (Vercel) + engine (always-on box), env keys
- [ ] Top up engine account + vault
- [ ] Wallet sign-in test (Meteor/Intear) — human
- [ ] Pitch deck
- [ ] Demo video + X post — human
- [ ] Public repo + submit — human confirms
