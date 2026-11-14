# Riptide — build plan

Written 2026-11-14 ~14:00 UTC against `SPEC.md`. Submission closes
**2026-11-14 23:59 UTC (05:29 IST Nov 15)**. About 10 hours, of which the last
3 are packaging. Everything below is sized for that.

## 1. Spec amendments (apply before coding)

### Bugs — these break money or fairness as written

| # | Where | Problem | Fix |
|---|---|---|---|
| B1 | §5.2, §5.5 | Center cell pays the 1.01x floor on a sure win (spot already inside band). Risk-free +1% per tap; with no chip cap, ~300 taps in a session compounds to ~20x. Tournament winner = fastest spammer; cash vault leaks deterministically. | Reject instead of clamping up: `require!(raw_quote >= MIN_QUOTE)` (1.05x). Add `max_chips_per_tap` (1000). |
| B2 | §5.3, §5.5 | σ is mean absolute return but is fed into Φ as a standard deviation. `E|X| = 0.798σ`, so z is inflated 1.25x and tails overpay ~3.6x (row ±4, 2 steps: fair 21x, quoted 75x). | Multiply σ by `12533/10000` (√(π/2)), or switch to realized variance + `u128::isqrt` (see B3). |
| B3 | §5.5 | `steps = ceil((window_end − now)/5s)` ranges 1..11, not 1..10 (column 9 is 50–55s away). `SQRT[11]` is out of bounds: column 9 panics almost always. | Drop the table: `z = d / isqrt(var_per_sec * t_sec)`. `u128::isqrt` is stable (rustc here is 1.100). Quotes then also decay every second instead of every 5s. |
| B4 | §5.8 | "A griefer can only poke more, which helps" is false. Poke spam flushes the 128-slot ring, and a position older than the ring is refunded. Losing bet → spam poke → refund = free option. | Record a sample only if `now − last.ts >= 800ms`. Ring then covers ≥100s. |
| B5 | §5.8 | `amounts[1] * 10^dec0 * 1e18` overflows u128. Live pool 0 on `ref-finance-101.testnet`: 1.4e13 × 1e24 × 1e18 = 1.4e55. | The pricer only uses price ratios. Drop decimals from the contract; `price = mul_div(amounts[1], 1e18, amounts[0])` via U256. Decimal-adjust in the UI. |
| B6 | §5.10 | `place(col, row)` is relative on both axes. A tap that lands after a 5s boundary or a spot move fills a different window/band than the one tapped, and `min_quote_bps` does not catch it (same indices, similar quote). Per-cell caps and "already-won cell" have no stable key. | Absolute cells: `place_chips(session_id, band_idx: i64, window_idx: u64, min_quote, chips)`, where `band = [band_idx*tick, (band_idx+1)*tick)`, `window_end = (window_idx+1)*5s`, `tick` fixed in config. UI shows the 9 bands nearest spot. |
| B7 | §5.7 | Incremental top-3 breaks when chips fall (stake is deducted at tap): a top-3 player drops, 4th place is never promoted. | No incremental top-3. Keep `players: Vec<AccountId>` (≤64) per session and sort in memory at the bell and in `leaderboard()`. |
| B8 | §5.7 | Positions can outlive the session; `settle_session` has no rule for them. | Reject `place_chips` when `window_end > session.ends_at`. `settle_session` requires `session.open_count == 0`. |
| B9 | §5.7 | Free session is "permanent" + "chips at 0 → out, no re-buy" + "late join rejected". A judge who busts, or arrives mid-session, is locked out. | Free session: join any time, `rebuy()` resets to 10k chips, leaderboard resets every 10 min. Rules above apply to paid sessions only. |
| B10 | §5.9 | Touch test is underspecified for a price that jumps over a band between two samples (AMM price moves in discrete swaps). | Touch = any consecutive pair with `min(p_i, p_i+1) <= hi && max(p_i, p_i+1) >= lo`. |

### Gaps

- **Signing: one approval, then zero** — now SPEC §6.2. Wallet sign-in via
  `@hot-labs/near-connect` with `contractId` + `methodNames` adds a scoped
  function-call key; every tap is signed with it, no prompt. Consequences
  already folded into the spec: all gameplay methods non-payable, money enters
  once via `deposit()` into an in-contract balance, contract pays storage,
  `withdraw` needs 1 yocto so a session key can never drain funds. Guest play
  (faucet account) stays as a secondary link for judges with no testnet wallet.
- **Real pool, no mock** — now SPEC §7. Rhea testnet pool 0 on
  `ref-finance-101.testnet`; our bot makes real swaps against it.
- **§6.1 probability y-axis.** With `y = Φ((p − spot)/σ)` the mover is always
  at the center and never moves vertically; open positions slide instead. With
  B6 the axis is linear price, cells are uniform, multiplier is shown as number
  + heat. The "gap height = multiplier" conceit is dropped.
- **Cumulative touch has no pipe moment.** A position can win long before the
  line reaches its column. Draw an open position as a horizontal lane from tap
  time to `window_end`, not as a single cell.
- **`TouchMode::Slice`** is priced with the cumulative formula, so it is
  mispriced. Cut the enum.
- **Tournament is not manipulation-free.** No solvency risk, but whoever can
  swap the pool can steer a real prize pool. README says so.
- **Storage.** `LookupMap<AccountId, Vector<u64>>` needs a unique prefix per
  account. Use `LookupMap<AccountId, Vec<u64>>`, capped at 64 open.
- **RPC.** `rpc.testnet.near.org` is rate-limited. One poke/s + settle + bots +
  a 1s `board()` poll per viewer needs FastNEAR or similar, with a fallback.

### Additions

| # | Add | Why | Cost |
|---|---|---|---|
| A1 | `bun run verify` — sandbox run of a full session (poke → join → place → settle → bell → claim) printing balances, plus README `near view` one-liners against the live deploy | Q-017: Claude Code and Codex screen first for reproducibility and README claims. They cannot tap a phone. | = the §9 integration test + a script entry |
| A2 | NPC players with their own wallets (3 accounts, one rule each: momentum, mean-revert, long-shot) run by the engine | Games track leans on "agent NPCs"; a solo judge otherwise sees a one-row leaderboard | ~40 lines in the engine |
| A3 | Guest play: browser key + faucet-created testnet account, secondary to wallet sign-in | Judges without a testnet wallet can still play | ~40 lines, faucet verified |
| A4 | Settle emits an event with the two samples that proved the touch; UI links it | Goal 2, "verifiably" | ~5 lines |
| A5 | Frontend pokes and settles its own positions when the last sample is >3s old | Goal 6: game survives the engine dying | ~10 lines |
| A6 | Swap bot tracks live NEAR/USD instead of a random walk | Players predict a real price, not our RNG | stretch, ~20 lines |

### Cut order (replaces §11)

Cash mode, vault, tiers, exposure cap (§5.6) → `TouchMode::Slice` → probability
y-axis → tie splitting (tiebreak = earlier join) → A6 → guest play → paid
tournament (free session + NPC leaderboard is still a complete loop). Wallet
sign-in with zero in-game approvals is not on the cut list.

## 2. Resources (verified 2026-11-14)

- Rules: <https://nearhackathon.com/HACKATHON.md>. Q-010 testnet eligible;
  Q-011 no mandatory integrations; Q-012 X post needs a **video**, hosted demo
  up through Nov 18 (ideally Nov 25); Q-014 LICENSE file; Q-017 AI screening.
- Games brief: <https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md>
  — no wallet popups in normal play, agent NPCs, a fast-forward mode for judges.
- Submit: form at <https://nearhackathon.com/#apply> or
  `POST https://nearhackathon.com/api/applications`. Needs a **mainnet** NEAR
  account for payout, public repo URL, public X post URL. Track ids: `games`
  (+ `open`; `defi` only if cash mode ships).
- Ref testnet: `ref-finance-101.testnet` is live, 2982 pools, `get_pool` shape
  matches §3 (plus `pool_kind`, `amp`). Pool 0 = `wrap.testnet` /
  `rft.tokenfactory.testnet`, ~1497 wNEAR, fee 40 bps — chosen oracle pool.
  Organic activity is near zero (2 of 2982 pools changed in 2 min), hence the
  bot. Pool 2961 (NEAR/USDC mirror) moves, but it is another team's
  market-maker (`mm.wincut-mansi.testnet`); not depended on.
- near-connect `signIn({contractId, methodNames})` documented in
  `near/agent-skills` `skills/near-dapp/references/near-connect.md`; wallets:
  HOT, Meteor, Intear, MyNearWallet, Nightly, NEAR Mobile, OKX.
- Testnet faucet: `POST https://helper.testnet.near.org/account` — 200, CORS
  reflects origin, account funded with 10 NEAR. RPC: `rpc.testnet.fastnear.com`.
- Packages: `near-api-js` 7.5.3, `@hot-labs/near-connect` 0.12.0 (fallback only).
- Toolchain present: rustc 1.100, `wasm32-unknown-unknown`, cargo-near 0.23,
  near-cli-rs 0.31.1, bun 1.3.11. No testnet credentials on this machine yet.
- Docs: <https://docs.near.org>, <https://guide.rhea.finance>,
  <https://github.com/near/agent-skills> (near-dapp skill).

## 3. Schedule (UTC)

| Window | Work | Gate |
|---|---|---|
| 14:30–15:00 | `git init`, delete `rail.*`, LICENSE, testnet accounts (contract, engine, 3 NPCs). Bot wraps NEAR + one real swap on Rhea pool 0. near-connect `signIn` with `contractId` on Meteor + MyNearWallet testnet: does a tap prompt? Freeze view JSON shapes. | swap lands; signing path chosen |
| 15:00–17:00 | **Contract:** oracle + ring + variance, pricer + unit tests, `place_chips` / `settle` / refund, free session, `leaderboard`, `board`. **In parallel:** engine (poke, settle, swap bot, NPCs) and frontend grid against a fixture of `board()`. | deployed on testnet, engine poking |
| 17:00–19:00 | Integrate: wallet sign-in (one approval), optimistic tap, lane render, reveal, leaderboard drawer, mobile layout, guest link. | after sign-in, 20 taps on a phone with zero prompts |
| 19:00–20:00 | Paid tournament: `join_session`, bell, prize split, `claim`. **Skip if the 19:00 gate is red.** | |
| 20:00 | **Feature freeze.** | |
| 20:00–21:00 | `bun run verify`, README (do X → see Y, honesty section, AI/library disclosure), host frontend + engine. | fresh clone passes verify |
| 21:00–22:30 | Demo video, push public, X post. | human does all three |
| 22:30–23:30 | Submit, confirm 201. 30 min buffer. | human confirms payload |

Needs a human: mainnet payout account, making the repo public, the X post, the
submission.
