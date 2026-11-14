# Riptide — implementation plan

Source of truth for interfaces while three workstreams run in parallel.
`SPEC.md` says *why*; `PLAN.md` §1 lists the bug fixes (B1–B10) that override
it; this file freezes *what each piece exposes*. Change an interface here
first, then in code.

Deadline: **2026-11-14 23:59 UTC**. Feature freeze 20:00 UTC.

## Accounts (testnet, created 2026-11-14 via `near account create-account sponsor-by-faucet-service`)

Keys live in `~/.near-credentials/testnet/<id>.json` (legacy keychain). Never
commit them; hosted processes take them from env vars.

| Account | Role |
|---|---|
| `riptide-6024.testnet` | game contract + owner |
| `riptide-6024-engine.testnet` | pokes, settles |
| `riptide-6024-bot.testnet` | swap bot on Rhea pool 0 |
| `riptide-6024-npc1/2/3.testnet` | NPC players |

Oracle: `ref-finance-101.testnet` pool `0` (`wrap.testnet` 24 dec /
`rft.tokenfactory.testnet` 8 dec, fee 40 bps).

## Layout

```
contracts/riptide/        Rust, near-sdk 5.x, cargo-near        (workstream A)
apps/web/                 Next.js 15 / React 19, canvas game     (workstream B)
apps/engine/              Bun: poke, settle, swap bot, NPCs      (workstream C)
scripts/gen-phi-table.ts  PHI2 table generator                   (A)
```

## Contract interface (frozen)

Units: on-chain time is ns; **every view returns ms** as JSON numbers. Prices
are `U128` strings. Chips are `u64` JSON numbers.

### Constants / config

```
WINDOW_MS        = 5000        // cell width in time
COLUMNS          = 10          // windows shown/placeable: window0 .. window0+9
ROWS             = 9           // bands shown: band0-4 .. band0+4
RING             = 128         // price samples kept
MIN_SAMPLE_GAP   = 800 ms      // B4: poke within this of last sample records nothing
STALE_MS         = 5000        // place rejected if last sample older
MIN_QUOTE_BPS    = 10500       // B1: 1.05x; quotes below are rejected, not clamped up
MAX_QUOTE_BPS    = 5_000_000   // 500x
START_CHIPS      = 10_000
MAX_CHIPS_PER_TAP= 1_000
MAX_OPEN_PER_ACCOUNT = 32
SIGMA_MIN_BPS / SIGMA_MAX_BPS = 2 / 500   (per 5 s)
```

Config (owner-settable via `set_config`): `pool_contract`, `pool_id`, `tick`
(U128, band height in price units), `edge_bps` (0, session 0), and the
real-money knobs `yocto_per_unit` (1e20 ⇒ 1 NEAR = 10_000 mUSD = $10),
`cash_edge_bps` (300), `max_cash_stake` (1000 mUSD = $1), `max_exposure_bps`
(2000), `cash_max_quote_bps` (1_000_000 = 100x).

### Real money (session 1) — the game players see

Unit is **mUSD = $0.001** (1000 mUSD = $1; UI default trade 100 mUSD = $0.10).
Free chips (session 0) stay on-chain for NPCs / a later tournament only.

- `deposit()` credits `floor(attached / yocto_per_unit)` mUSD; dust stays.
- `place(...)` = `place_chips(1, ...)`: stake ≤ `max_cash_stake`; quote uses
  `cash_edge_bps` and is capped at `cash_max_quote_bps`. Requires
  `open_liability + payout <= vault_units * max_exposure_bps / 10000` else
  panics `"house limit"` (payout = stake * quote_bps / 10000). Then
  balance -= stake, vault += stake, open_liability += payout.
- Settle: Won ⇒ vault -= payout, player += payout; Refunded ⇒ vault -= stake,
  player += stake; Lost ⇒ nothing. Always open_liability -= payout.
- `withdraw(units)` (1 yocto) transfers `units * yocto_per_unit`; restored if
  the transfer fails. `fund_vault()` anyone; `vault_withdraw(units)` owner,
  1 yocto, cannot take the vault below `open_liability`.

### Price

`price = amounts[1] * 1e36 / amounts[0]` in U256, must fit u128 else sample
rejected (B5; 1e36 not 1e18 because pool 0 is 24-dec vs 8-dec and 1e18 leaves
~9461 units of resolution). Zero reserve → sample rejected.

### Cells (B6 — absolute)

```
band b   = [b * tick, (b+1) * tick)          b: i64
window w = [w * 5000ms, (w+1) * 5000ms)      w: u64
band0    = floor(spot / tick)
window0  = floor(now_ms / 5000) + 1          // next boundary, never the current window
placeable: window0 <= w <= window0 + 9
```

### Pricer

```
sigma over t:   var_per_ms = Σ r_i² / Σ dt_i  over the last ≤64 sample pairs,
                r_i in ppm (1e-6) of p_{i-1}; sigma_t = isqrt(var_per_ms * t_ms)
                then clamp the 5s-equivalent sigma to [SIGMA_MIN, SIGMA_MAX]
t_ms            = window_end_ms - now_ms
gap             = [band_lo * tick, (band_hi + 1) * tick)      // band_hi inclusive, width <= 8 bands
z_lo, z_hi      = (gap edge - spot) / sigma_t, signed, ppm-of-spot over sigma, 1e4 scale
Φ(z)            = 1 - PHI2(z)/2 for z >= 0, PHI2(|z|)/2 for z < 0   // PHI2 = 2*(1-Φ), 0..4.0 step 0.05
P_bps           = Φ(z_hi) - Φ(z_lo), floor 1          // P(price at window_end inside the gap)
quote_bps       = (10000 - edge_bps) * 10000 / P_bps, capped at MAX_QUOTE_BPS
```

Bigger gap ⇒ higher P ⇒ lower multiplier (Flappy: gap height = payout).
`quote_bps < MIN_QUOTE_BPS` ⇒ rejected. The frontend computes display quotes
locally with this formula from `board().sigma_ppm`; the contract recomputes at
place time and `min_quote_bps` guards the difference.

### Settlement — gate rule (v3, 2026-11-14; replaces pass-through)

The pipe stands on the window end (the gate). When a sample lands, the
contract prices every window end it crossed since the previous sample on the
straight line between the two (the line the bird is drawn on) and stores it
in `gates[window_idx]` (last 1024 windows). Win iff the gate price is inside
`[lo, hi)`. No gate price (samples > 10 s apart, or > 1024 windows old) ⇒
Refunded.

- Why: the pricer computes P(price at window end in gap), so the quoted
  multiplier is now the fair one (minus edge). Pass-through needed
  P(all samples inside), which the pricer overstated. Storing the gate at poke
  time also means a late settle can't turn a loss into a refund.
- Quote time `t = window_end - last_sample_ts` (not from now).
- Settleable once a sample with `ts >= window_end` exists.
- Win credits `stake * quote_bps / 10000` (chips in session 0/≥2, mUSD in session 1).

### Methods

```rust
#[init] new(owner: AccountId, pool_contract: AccountId, pool_id: u64, tick: U128)

// gameplay — all NON-payable (callable by a function-call key)
poke() -> Promise                       // get_pool → on_pool callback records sample; no-op (no promise) within 800 ms of last sample
join_free()                             // session 0. first join or chips < 100 → chips = START_CHIPS
place(band_lo: i64, band_hi: i64, window_idx: u64,
      min_quote_bps: u32, stake: u64) -> u64        // REAL MONEY, stake in mUSD; position id
place_chips(session_id: u64, band_lo: i64, band_hi: i64, window_idx: u64,
            min_quote_bps: u32, chips: u64) -> u64   // session 0 chips (NPCs); session 1 = place()
settle(position_ids: Vec<u64>)          // permissionless; ignores ids not yet settleable

// money — need a deposit / 1 yocto, so signed by the wallet, not the session key
#[payable] deposit() -> u64             // mUSD credited
#[payable] withdraw(units: u64) -> Promise     // assert_one_yocto, units = mUSD
#[payable] fund_vault() -> u64          // anyone; mUSD added to the house vault
#[payable] vault_withdraw(units: u64)   // owner, assert_one_yocto, vault >= open_liability after

// owner
set_config(pool_contract: Option<AccountId>, pool_id: Option<u64>,
           tick: Option<U128>, edge_bps: Option<u32>,
           yocto_per_unit: Option<U128>, cash_edge_bps: Option<u32>,
           max_cash_stake: Option<u64>, max_exposure_bps: Option<u32>,
           cash_max_quote_bps: Option<u32>)
migrate()                               // private, one-shot upgrade v2 -> v3 (run 2026-11-14, tx 7ooWKBU5…)
// set_config is #[payable] + assert_one_yocto; yocto_per_unit locked after the first deposit

// markets (v4, tx CD9y3jUM…): every pool has its own tick, ring and gates; balance, vault, caps shared
// poke(market?), board(market?), quote(..., session_id?, market?), place(..., market?), place_chips(..., market?)
// all default to market 0, so v3 callers keep working. positions() rows carry `market`.
#[payable] add_market(label: String, pool_contract, pool_id: u64, tick: U128) -> u32   // owner, 1 yocto
markets(): { id, label, pool_contract, pool_id, tick, spot, last_sample_ms }[]
// live: 0 wNEAR/RFT (pool 0), 1 wNEAR/ELIXIR (pool 275), 2 wNEAR/GOLD (pool 274); a pool must
// have wNEAR as amounts[0] so price = amounts[1]*1e36/amounts[0] fits u128

// tournaments (sessions >= 2)
create_tourney(entry: u64, start_ms: u64, length_ms: u64) -> u64  // entry mUSD <= $10; start within 1 h (rounded up to a window); 1-30 min; host auto-joins
join_tourney(id: u64)                   // before start; pays entry from balance; stack = 10_000 points
settle_tourney(id: u64)                 // permissionless after end, once open == 0; pot 50/30/20 by chips, ties split, <2 players refund
```

Sessions: `0` = free chips (NPCs), `1` = real money (mUSD), `>= 2` = tournaments
(`place_chips(id, ...)`, only windows fully inside `[start_ms, end_ms]`, edge 0, cap 500x).

### Views (exact JSON)

```ts
board(): {
  now_ms: number,
  spot: string | null,           // U128, null until first sample
  last_sample_ms: number | null,
  sigma_ppm: number,             // per 5 s, after clamp, exactly what the pricer uses
  tick: string,
  band0: number,                 // i64
  window0: number,
  samples: { ts_ms: number, price: string }[]   // last 64, oldest first
}
positions(account_id): {
  id: number, band_lo: number, band_hi: number, window_idx: number,
  price_lo: string, price_hi: string,
  window_start_ms: number, window_end_ms: number, placed_at_ms: number,
  quote_bps: number, stake: number, session_id: number,
  status: "Open" | "Won" | "Lost" | "Refunded"
}[]                               // open + last 16 settled, newest first
settleable(limit: number): number[]
chips(session_id: number, account_id: string): number | null   // session 1 = mUSD
leaderboard(session_id: number): { account_id: string, chips: number }[]  // top 20 by balance (first 1000 players)
leaders(): { account_id, pnl: number, trades, wins, best_bps }[]          // global top 20 by cash P&L (trades + prizes)
stats(account_id): { pnl, trades, wins, best_bps }
tourney(id): { id, host, entry, start_ms, end_ms, pot, open, settled,
               players: { account_id, chips, prize }[] } | null           // players best first
tourneys_live(): number[]                                                 // unsettled tournament ids
config(): { owner, pool_contract, pool_id, tick: string, edge_bps }
balance(account_id): number    // mUSD, 0 if none
quote(band_lo, band_hi, window_idx, session_id?: number): number | null  // exact on-chain quote now; session defaults 0
vault(): { vault_units: number, open_liability: number, yocto_per_unit: string,
           cash_edge_bps: number, max_cash_stake: number, max_exposure_bps: number,
           cash_max_quote_bps: number }
```

Storage is paid by the contract (function-call keys cannot attach deposit).
Settled positions beyond the last 16 per account are deleted.

## Signing (frontend)

Methods a session key may call: `place, poke, settle, place_chips, create_tourney, join_tourney, settle_tourney`
(`deposit`/`withdraw` need attached NEAR, so they go through the wallet).
See SPEC §6.2. Contract id read from `NEXT_PUBLIC_CONTRACT_ID`
(default `riptide-6024.testnet`), RPC `https://rpc.testnet.fastnear.com`.

## Engine (`apps/engine`)

One Bun process, keys from `~/.near-credentials` locally or
`ENGINE_KEY`/`BOT_KEY`/`NPC{1,2,3}_KEY` env vars when hosted.

1. `poke()` every 1 s (engine account).
2. `settle(settleable(50))` every 2 s, then `settle_tourney(id)` for every `tourneys_live()` past its bell with `open == 0`.
3. Swap bot: every ~2 s, swap 0.1–0.4 wNEAR ↔ RFT on pool 0 via
   `ft_transfer_call` to `ref-finance-101.testnet`, direction biased back
   toward an anchor price (mean-reverting random walk).
4. NPCs: each joins session 0, taps one cell every 4–8 s by one rule
   (npc1 momentum, npc2 mean-revert, npc3 long-shot).
5. `GET /ping` (HTTP, CORS open): frontend calls it every 30 s; bot and NPCs
   sleep 10 min after the last ping. Poke/settle always run.

## Order of work

| UTC | A: contract | B: frontend | C: engine (main thread) |
|---|---|---|---|
| 14:40–16:30 | PHI2 gen, oracle, pricer, place, settle, views, unit tests | canvas Flappy board against `fixtures/board.json`, wallet + guest signing | bot setup + first real swap, poke/settle loop, NPCs |
| 16:30 | deploy + init on `riptide-6024.testnet` | point at live contract | point at live contract |
| 16:30–19:00 | fixes, phase 2 if green | tap flow, positions, reveal, leaderboard drawer, mobile | `bun run verify`, hosting |
| 20:00 | freeze | freeze | freeze |
