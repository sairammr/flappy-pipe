# Riptide — Spec

> Euphoria-style tap trading on NEAR. A continuous grid of cells divided by
> price and time sits over a live Rhea/Ref AMM pool. Each cell is a price range
> × a 5-second window, showing a live multiplier. Tap a cell and the multiplier
> is locked; if the price touches that range before the line passes your cell,
> you win multiplier × stake.
>
> **Two modes.** *Cash* — real NEAR per tap, Euphoria's exact loop, paid from an
> LP vault. *Tournament* — $10 entry, play with virtual chips, final standings
> settle to NEAR you keep.
>
> The *game presentation* is a swappable skin. Flappy Bird is the placeholder.
> Nothing below the skin boundary knows what a bird is.
>
> Target: NEAR HACKATHON — `games` track, `defi` secondary.
> Repo status: pre-git. Spec date 2026-11-14.

---

## 1. What this is, exactly

No sugarcoating, because earlier drafts of this spec had some:

**Players predict price.** A cell is a bet that the pool's spot price enters a
given price range within a given few seconds. The cell's multiplier is quoted
live and frozen at the instant you tap it.

It is a short-horizon price-touch prediction market with dynamic multipliers,
presented as an arcade game.

What is *not* claimed:

- Not a perp. No leverage, no margin, no funding, no liquidation. Euphoria
  calls itself derivatives; our version is binary touch contracts, nothing more.
- Not liquidity prediction. Pool depth feeds difficulty, never a player's
  prediction. Price is the only pool quantity that moves on a tap cadence —
  depth moves on LP add/remove a few times an hour, and net swap flow is price
  with extra steps in a constant-product pool.
- Not an original mechanic. It is a deliberate replica of Euphoria's loop.

What *is* ours:

1. **The oracle is the pool.** `poke()` is permissionless and cross-contract
   calls Rhea's `get_pool`. Prices originate from Rhea's own contract. No
   keeper key, no signer, no attestation. The poker daemon is a liveness
   convenience; its going down refunds players rather than winning against them.
2. **Quotes are computed on-chain, not served.** Euphoria's multipliers come
   from third-party market makers over CLOB mechanics plus their in-house desk.
   We have no market makers, so the contract derives every quote from on-chain
   state with baked constants. Nobody quotes you a price; there is no quote
   server to trust, bribe or front-run. **This is the one deliberate divergence
   from Euphoria**, and it is forced.
3. **Tournament mode has no counterparty risk at all.** Chips are virtual, so
   locked dynamic quotes cost nothing to honor and the prize pool is just the
   entry fees.
4. **Skin-agnostic core.** The game layer is a presentation module. The thing
   on-chain is cells, quotes and chips.

### Mechanics confirmed against Euphoria

| Euphoria | Here |
|---|---|
| Cells divided by price and time | Same |
| Each cell = a price range × 5s window | Same |
| Tap opens a contract at the multiplier quoted at that moment | Same, locked in the position |
| Win if price touches the cell at least once before the line passes it | Same (`touch_mode`, §5.4) |
| Lose → stake does not come back. Binary | Same |
| Multipliers update with distance from spot, time remaining, volatility | Same, on-chain pricer (§5.5) |
| Trade size bottom-right, default $0.10 | Same, default ≈$0.10 in NEAR |
| Tier caps: new $5/trade $25/cell, standard $10/trade $50/cell | Same, and doubles as vault exposure control |
| No order book, no leverage control, no charts | Same |
| Mobile-first (PWA / TG mini app) | Mobile-first PWA |
| Leaderboard with P&L, follow, weekly rewards | Leaderboard; follow and weekly rewards cut |
| Multipliers quoted by market makers | **Diverges** — on-chain pricer + LP vault |
| ETH only, MegaETH, sub-10ms | Rhea pool pair on NEAR, ~1s blocks |

## 2. Goals, non-goals, anti-goals

**Goals**

1. A judge opens the page on a phone, taps a cell, and sees it resolve in
   seconds — no reading required.
2. Price originates on-chain from a real AMM contract, verifiably.
3. Multipliers move continuously and visibly, and the one you tapped is the one
   you get.
4. Tournament mode works with no solvent treasury whatsoever.
5. The skin can be replaced in one file without touching the contract.
6. Public repo, reproducible README, demo that works without our servers up
   (beyond the poker, whose absence is safe).
7. **One approval, then zero.** A player approves once, at sign-in. No wallet
   prompt, popup or confirmation ever appears during play (§6.2).

**Non-goals**

- Leverage, funding, liquidation, real derivatives.
- Token, airdrop, social login, native app, follow graph, weekly rewards.
- Charts, order book, position management beyond an open-positions list.
- Building an AMM. We read Rhea; we never write a DEX.
- Market makers, CLOB, or any external quote source.
- Deciding the final skin. Flappy is a placeholder and expected to change.

**Anti-goals** — ship these and it failed even if it runs:

- A trusted off-chain price signer or quote server.
- A displayed multiplier the contract cannot actually pay.
- An uncapped vault against a price feed any trader can push.
- Anything requiring sub-second on-chain settlement.

## 3. Constraints

- NEAR block time ~0.6–1.2s. **This is the hard one.** Euphoria needs sub-10ms
  and a 5s cell; we get ~1s. A tap is one block, so the nearest cell has
  perhaps 3–4 blocks of life. Consequences: the nearest column is deliberately
  the *next* 5s window rather than the current one, and `min_quote_bps`
  protects a player whose tap lands a block late (§5.5).
- No `f64` in contract math. Every formula below is integer fixed-point against
  baked tables, or it does not ship.
- Rhea mainnet: `v2.ref-finance.near`. Rhea testnet: `ref-finance-101.testnet`
  (live, ~2980 pools, verified 2026-11-14). `get_pool` returns `pool_kind`,
  `amounts`, `token_account_ids`, `shares_total_supply`, `total_fee`, `amp`.
- **No mocks.** The oracle reads a real Rhea pool on testnet. Testnet pools are
  mostly idle (2 of 2982 changed in a 2-minute watch), so our swap bot trades
  real swaps against that real pool (§7).
- Function-call access keys cannot attach a deposit. Every gameplay method is
  therefore non-payable; money enters once via `deposit()` (§6.2).
- Testnet-only projects are eligible (Q-010). No mainnet deploy and no token
  spend without explicit human go-ahead.
- Existing repo: Bun workspace, `apps/web` is a bare Next.js 15 / React 19 app
  with React Query and two stray files (`rail.tsx`, `rail.css`) to delete.
- **Not a git repo.** `git init` + public remote is a submission blocker.

## 4. Approaches considered

**Underlying.** (A) Price grid — chosen. (B) Liquidity/depth grid — rejected,
depth moves in lumps, board sits dead. (C) Both layered — rejected, two state
machines. (D) "Depth shapes the board, swaps move the ball" — rejected as a
*framing*; it was A wearing B's vocabulary. Depth still enters, honestly and
narrowly, via the σ estimator (§5.3).

**Discrete rounds vs continuous grid.** Rounds were specced first (30s rounds,
2s columns, σ bands frozen at round open) because they make settlement a tidy
batch. Rejected on replica grounds: Euphoria has no rounds, and a grid that
resets every 30s instead of scrolling is a visibly worse product. Continuous
costs per-position settlement, which turns out *simpler* than round
bookkeeping.

**Static weight table vs dynamic quote.** Dynamic, per Euphoria. A static table
can't react to the price having already moved most of the way to your band,
which makes late taps free money and forces a no-placing window to compensate.
The dynamic quote *is* the anti-front-run mechanism.

**Counterparty.** Euphoria: market makers + in-house desk. Unavailable. Options
were (a) pari-mutuel pools — rejected, cannot honor a locked quote, which is
the whole UX; (b) LP vault priced by an on-chain pricer — chosen for cash mode,
with edge and exposure caps; (c) no counterparty at all — chosen for tournament
mode, via virtual chips. Running both is what lets the safe mode carry the demo
while the faithful mode carries the UX claim.

**Skin: deferred.** Candidates were Pipe Builder (inverted Flappy — you place
the gaps, the market flies the bird), Mine Layer, Deep Sea Hook, Snake &
Apples. All are the same contract. Flappy is the placeholder.

---

## 5. The prediction core (skin-blind)

### 5.1 No rounds — a continuous grid

There is no round. There is a clock, a price history, and open positions.

```
column index k = 0..9      window_k = [ T0 + 5k , T0 + 5(k+1) )
where T0 = next 5s boundary after now  (ceil(now / 5s) * 5s)

horizon = 50s
```

Columns scroll left as the clock advances; the vertical axis follows spot. Cell
`(k, n)` is a concrete, absolute `(price_lo, price_hi, window_start,
window_end)` — resolved to absolute values at tap time and stored that way, so
a position never moves under its owner even as the grid scrolls.

Column 0 is the **next** boundary, not the current partial window. At ~1s
blocks a tap into the current window could expire before it is included.

### 5.2 Rows

9 rows, `n = −4..+4`, price bands in units of σ around spot at tap time:

| row | band |
|---|---|
| 0 | ±0.5σ around spot |
| ±1 | 0.5σ – 1.5σ |
| ±2 | 1.5σ – 2.5σ |
| ±3 | 2.5σ – 3.5σ |
| ±4 | beyond 3.5σ (open tail) |

The center row stays, unlike an earlier draft of this spec that dropped it as a
free win. No special case is needed: it is already touched, so the pricer quotes
it at the floor (1.01x) and it is simply the boring cell. Faithful, and one less
branch.

### 5.3 σ — the volatility estimator, and where depth enters

σ is the pool's realized per-5s-step volatility from the sample ring, as
**mean absolute return**:

```
sigma_bps = avg( |p_i − p_{i−1}| / p_{i−1} )   over the last N=64 samples,
                                                rescaled to a 5s step
```

Mean absolute return, not stddev of log returns: no logarithms, no floats, pure
integer fixed-point, robust to the single outlier a thin pool throws.
`// ponytail: mean-abs-return estimator; swap for EWMA stddev if bands read wrong`

This is the only place pool depth enters, and it enters honestly: a thin pool
moves further on the same swap volume, so realized σ is larger, bands are
wider, the board is visibly wilder. One estimator, no second game.

Clamped to `SIGMA_MIN = 5 bps`, `SIGMA_MAX = 500 bps` (config), so a dead pool
cannot produce a degenerate board.

### 5.4 Win condition

```rust
enum TouchMode { Cumulative, Slice }
```

- **Cumulative (default):** the position wins if price entered `[lo, hi]` at any
  time from the tap through `window_end`. Matches "price enters your selected
  zone at any point before the price line passes your square."
- **Slice:** wins only if price entered the band inside `[window_start,
  window_end)`. Matches "the reference price touched the cell you chose at
  least once within five seconds."

Euphoria's own docs read both ways and this cannot be resolved from outside, so
it is a config enum rather than a guess baked into the money rule. Cumulative
ships as default: it produces a far better multiplier gradient, and `Slice`
flattens everything toward the middle of the payout range.

Touch once is enough; price need not stay. Binary outcome: win pays
`multiplier × stake`, loss returns nothing.

### 5.5 The pricer — dynamic quotes

Euphoria's three inputs — distance from **current** price, time remaining,
volatility — computed by the contract at tap time. The player never supplies a
quote.

```
d_bps  = |near edge of target band − spot| / spot        (bps, 0 if inside)
steps  = ceil( (window_end − now) / 5s )                 // 1..10
z      = d_bps * 1e4 / (sigma_bps * SQRT[steps])
P_bps  = PHI2[z]                                         // 2*(1 − Φ(z))
quote  = (10000 − edge_bps) * 1e4 / P_bps
quote  = clamp(quote, 10100, MAX_QUOTE)                  // 1.01x floor
```

Three baked constants, no on-chain statistics:

- `SQRT[1..10]` — `sqrt(steps)` at 1e4 scale: `10000, 14142, 17321, 20000,
  22361, 24495, 26458, 28284, 30000, 31623`. Ten values, so no integer-sqrt
  routine is needed.
- `PHI2[z]` — `2*(1 − Φ(z))` for z from 0 to 4.0 in steps of 0.05, 81 entries
  in bps, linearly interpolated, saturating above z=4. Anchors for review:
  `z=0 → 10000`, `0.5 → 6170`, `1.0 → 3173`, `1.5 → 1336`, `2.0 → 455`,
  `2.5 → 124`, `3.0 → 27`, `3.5 → 5`, `4.0 → 1`. Generated by
  `scripts/gen-phi-table.ts`, committed alongside the table so a reviewer can
  regenerate it.
- `edge_bps` — config. `0` in tournament mode (every player faces the same
  board, so an edge changes no ranking and only makes chip scores uglier).
  `300` in cash mode; that is the vault's expected return.
- `MAX_QUOTE` — `5_000_000` (500x) tournament, `1_000_000` (100x) cash.

Consequences worth stating:

- Waiting until price is nearly at your band collapses `d_bps`, so the quote
  collapses with it. Late taps are priced, not banned.
- `place` takes `min_quote_bps`. The contract recomputes the quote at execution
  and rejects the position if it came out below what the player was shown. This
  is what protects a tap that lands a block late — mandatory at ~1s blocks, and
  it costs the player nothing when it fires.
- A cell already resolved as a win cannot be tapped; a cell whose
  `window_end ≤ now` is expired. Both rejected.
- The pricer is driftless by construction. It has no view on direction, which
  is correct for a 50s horizon and keeps the quote symmetric.

### 5.6 Mode A — Cash (Euphoria's loop)

Real NEAR per tap, locked quote, paid from an LP vault. Stakes are debited
from the player's in-contract balance (funded once by `deposit()`), never
attached to the tap, so a tap stays popup-free.

```
tap  → stake debited from balance, quote locked into the position
win  → payout = stake * quote / 1e4,  from the vault
lose → stake accrues to the vault
```

- Default stake ≈ **$0.10 in NEAR** (`default_stake_yocto`, config), set at the
  bottom-right of the board exactly as Euphoria does.
- **Tier caps**, copied from Euphoria and doubling as exposure control:

| tier | per trade | per cell |
|---|---|---|
| new | $5 | $25 |
| standard | $10 | $50 |

  Tier is per account, owner-settable, everyone starts `new`.
- **Global exposure cap**: a tap is refused if
  `open_liability + stake*quote > vault_balance * max_exposure_bps / 1e4`
  (default `2000` = 20%). `open_liability` is maintained incrementally on every
  open and settle. A vault that cannot be emptied by one bad minute survives one.
- LP shares: `vault_deposit()` / `vault_withdraw(shares)` against a share price
  of `vault_balance / total_shares`. No lockup, no rewards token.
- **The honest risk, stated in the README:** a trader who can move the Rhea pool
  can move our oracle. The edge and the caps bound the loss per cell and in
  aggregate; they do not eliminate the attack. On a thin pool, cash mode is
  exploitable and we say so rather than pretending otherwise.

### 5.7 Mode B — Tournament

Fixed entry, fixed timeframe, virtual chips during play, NEAR at the bell.

```
entry_fee     ≈ $10 in NEAR     (config)
session_len   = 5 min           (config)
start_chips   = 10_000          // 1000 chips = $1, so default tap = 100 chips = $0.10
default_tap   = 100 chips
max_players   = 64
prize_split   = 50 / 30 / 20 for ranks 1-3, ties split equally
```

- Same grid, same pricer, same settlement. The only difference is that a
  position's stake is chips rather than yoctoNEAR, and `edge_bps = 0`.
- Entry fee is debited from the in-contract balance, not attached.
- Join during the session's `Joining` phase. Late join is rejected so nobody
  plays a shorter session than anyone else.
- Chips at 0 → out for the rest of the session. No re-buy.
- **Prize pool = Σ entry fees**, paid in NEAR, split by final chip ranking.
  Winners keep it. No vault, no solvency question — this is the mode that makes
  the whole design safe, and it is the one the demo leads with.
- A session with fewer than 2 players refunds entry fees.
- **A permanent free session** (`entry_fee = 0`, no prize) always runs, so a
  judge landing on the page can tap within seconds instead of waiting for a
  bell. Costs one config value and carries the entire demo.
- Top 3 maintained incrementally on every chip update (3-way compare, no sort),
  so the bell needs no on-chain sort over 64 players.
- Live leaderboard is **core to this mode**, not a nice-to-have.

### 5.8 The oracle

```
poke()  →  cross-contract call  <pool>::get_pool{pool_id}
        →  callback records (block_timestamp, price) on-chain
```

- Permissionless. Anyone may poke. A griefer can only poke *more*, which helps.
- Price from reserves, raw ratio:
  `price = mul_div(amounts[1], 1e18, amounts[0])` in U256. Not
  decimal-adjusted: the pricer only uses ratios, and `amounts[1] * 10^dec0 *
  1e18` overflows u128 on real pools. The UI decimal-adjusts for display.
- The callback pushes to the σ ring buffer and to the price history ring.
- Poker daemon targets every **1s** — one sample per block where possible, so a
  5s cell has ~5 observations. Liveness only. That distinction goes in the
  README in these words.

**Price history ring.** `samples: [Sample; 128]` as a ring of
`{ ts: u64, price: u128 }`. 128 samples at ~1s covers the 50s horizon with
room to spare. Settlement scans the range `[tap_ts, window_end]`, which is at
most ~50 entries. No per-round aggregation, no unbounded storage.

### 5.9 Settlement

Per position, not per batch. A position is settleable once `window_end < now`
and a sample exists at or after `window_end`.

```
settle(position_ids: Vec<u64>)     // permissionless, batched by caller
```

- Scans the price ring over the position's touch window, applies `touch_mode`,
  credits chips or queues a NEAR payout, decrements `open_liability`.
- Permissionless so anyone can settle anyone — the poker daemon does it in
  bulk, but a stuck position is never hostage to our daemon.
- `settleable()` view returns ready ids so the daemon never guesses.
- **If the price ring has no sample covering the window** (our poker died), the
  position is **refunded**, not lost. Our infra failing must never read as the
  house winning.
- Ring overwrite: a position older than the ring is also refunded, with
  `MAX_SETTLE_LAG` making that unreachable in practice.

### 5.10 Contract surface

NEAR, Rust, near-sdk 5.x.

```rust
// --- player: gameplay, all non-payable, all callable by the session key ---
place(band_idx: i64, window_idx: u64, min_quote_bps: u32, stake: U128)       // cash
place_chips(session_id, band_idx: i64, window_idx: u64, min_quote_bps, chips) // tournament
join_free()                                   // free session, also re-buy
join_session(session_id)                      // entry fee from balance
poke()                                        // → Promise, records a sample
settle(position_ids: Vec<u64>)                // permissionless
settle_session(session_id)                    // credits prizes to balance

// --- player: money in/out, wallet-approved, never during play ---
deposit()                                     // #[payable] → balance
withdraw(amount: U128)                        // 1 yocto attached: forces a full-access key

// --- vault ---
vault_deposit()                 // #[payable]
vault_withdraw(shares: U128)

// --- owner ---
set_config(cfg: ConfigPatch)    // pool, decimals, fees, edge, caps, σ bounds, touch_mode
set_tier(account_id, tier)

// --- views ---
board() -> BoardView            // spot, sigma, T0, all 90 cells with live quotes
positions(account_id) -> Vec<PositionView>
settleable(limit) -> Vec<u64>
current_session() -> SessionView        // id, phase, players, prize_pool, top3
leaderboard(session_id) -> Vec<Standing>
chips(session_id, account_id) -> u64
balance(account_id) -> U128
vault() -> VaultView
config() -> Config
```

```rust
struct Position {
    id: u64,
    account: AccountId,
    price_lo: u128, price_hi: u128,     // absolute, frozen at tap
    window_start: u64, window_end: u64, // ns, absolute
    placed_at: u64,
    quote_bps: u32,                     // LOCKED at tap
    stake: u128,                        // yocto (cash) or chips (tournament)
    session_id: Option<u64>,            // None → cash mode
    status: Open | Won | Lost | Refunded,
}

struct Session {
    id: u64,
    starts_at: u64, ends_at: u64,
    entry_fee: u128,
    prize_pool: u128,
    players: u32,
    top3: [(AccountId, u64); 3],
    status: Joining | Live | Paying | Done,
}
```

Storage: `positions: LookupMap<u64, Position>`,
`by_account: LookupMap<AccountId, Vector<u64>>`,
`open_ids: Vector<u64>` (settlement queue),
`sessions: LookupMap<u64, Session>`,
`chips: LookupMap<(u64, AccountId), u64>`,
`claimable: LookupMap<AccountId, u128>`,
`samples: Vector<Sample>` as a 128-slot ring.

**Gas bounding.** `settle` is caller-batched, so the daemon sizes its own
batches. `MAX_OPEN_PER_ACCOUNT = 64`. `// ponytail: Vector scan for the settle
queue; index by window_end if open positions ever get large`

`board()` returns all 90 cells with live quotes in one view call so the frontend
repaints on a single poll. Views are free; this is the cheapest way to make
multipliers look alive.

One in-contract `balance` per account. Deposits, cash winnings and prize money
land in it; stakes and entry fees come out of it. Nothing is claimed per
position. `withdraw` requires 1 yocto attached, which a function-call key
cannot do — so a leaked session key can play with the balance but never
move it out.

**Storage is paid by the contract**, since a function-call key cannot attach
a storage deposit. Bounded by `MAX_OPEN_PER_ACCOUNT`, and settled positions
are removed, so storage recycles.

### 5.11 Round engine (one Bun process)

One script, four jobs, because four daemons for this is silly:

1. `poke()` every 1s.
2. `settle(settleable())` in batches, continuously.
3. `settle_session()` at each bell, and open the next session.
4. Testnet only: a **swap bot** doing small random-walk swaps against the demo
   pool every ~1.5s, so the board always moves during a demo.

Every job is a permissionless call over on-chain state, so it is idempotent and
restarting loses nothing.

---

## 6. The skin boundary

Everything above is skin-blind. The frontend splits in two.

**Core (built now, skin-independent):** wallet sign-in (§6.2), the scrolling
grid geometry from `board()`, live quote repaint, tap with `min_quote_bps`,
stake selector, open-positions list, win/loss reveal, chips and leaderboard,
session join, deposit/withdraw, mobile-first layout.

**Skin (one module, Flappy placeholder):**

```ts
export interface Skin {
  id: string
  // one grid cell, given its live quote and state
  Cell: FC<{ cell: Cell; quote: number; state: 'idle'|'open'|'won'|'lost'|'expired' }>
  // the price mover: trail so far, position now
  Mover: FC<{ trail: Point[]; now: Point }>
  // band edges / backdrop decoration (pipes, mines, hooks, …)
  Field?: FC<{ bands: Band[] }>
  copy: { tap: string; open: string; won: string; lost: string }
  palette: Record<string, string>
}
```

Swapping to Mine Layer or Deep Sea Hook is one new file plus one import.
**No contract change, ever, for a skin change.**

### 6.1 The Flappy skin, and the y-axis it requires

Mapping:

| Game | Core |
|---|---|
| One pipe | one column = one 5s window |
| The pipe's gap | the cell you tapped = a price band |
| Gap height | the multiplier — narrow gap, big payout |
| The bird | the live pool price, flying right |
| Bird through your gap | win, `multiplier × stake` |
| Bird hits pipe | lose, stake gone |

"Gap height = multiplier" is the whole appeal of this skin, and it is only
honest under the right vertical axis. Under a linear-price or σ-linear axis,
gap height would have to either equal the band (and then it encodes band
*width*, not rarity — the ±4 tail becomes the biggest gap while paying the
most) or encode the multiplier while the real hit area stays the full row slot
(and then the bird visibly clears a wall and still pays). The second is a
lying animation, which a money game cannot ship.

**So the y-axis is compressed probability space, not price.** Screen `y` is the
band's probability mass, power-compressed with a minimum tappable height:

```
y(p) = compress( Φ(z(p)) ),   z(p) = (p − spot) / sigma
compress: power curve, floor each band at MIN_CELL_PX so tails stay thumb-sized
```

Under this axis, all three collapse into one quantity: a band's on-screen
height **is** its rarity **is** its multiplier. Rare bands are visibly thin,
the center row is fat, and a player reads the payout off the gap without a
number. The ±4 tail is ~0.02% of probability mass and would be invisible at
true scale, hence the compression floor; ordering stays strictly honest.

Side effect worth keeping: the bird's vertical motion is exaggerated near spot
and damped in the tails, so the board looks most alive exactly where the price
actually spends its time.

`skins/flappy.tsx` owns the pipes, the bird, the collision art and the copy.
The compressed-probability axis is **core, not skin** — settlement geometry and
hit areas must agree with it in every skin — so `y(p)` lives in the core board
module and skins receive already-projected coordinates.

### 6.2 Signing — one approval, then silent

Wallet connection is `@hot-labs/near-connect` (+ `near-connect-hooks`), the
connector NEAR's own `near-dapp` agent skill uses. Network: testnet.

```
first visit:  board renders and moves (view calls, no account needed)
tap "Play":   connector.signIn({ contractId: riptide, methodNames: GAME_METHODS })
              → the ONE wallet approval: adds a function-call key scoped to
                riptide + GAME_METHODS, zero-deposit only
every tap:    place / place_chips signed with that key → no prompt
```

`GAME_METHODS = [place, place_chips, join_free, join_session, poke, settle,
settle_session]`.

- **Who holds the key depends on the wallet.** Extension/app wallets (Meteor,
  HOT, Intear) keep the limited key and sign matching zero-deposit calls
  without a prompt. If a wallet prompts anyway, use the app-held key path:
  the app generates an ed25519 key, the wallet signs one tx adding it as a
  function-call key, and the app signs every tap locally with near-api-js.
  Either way: one approval at the start, zero during play. Which path each
  wallet takes is checked on testnet in hour 1 of the build.
- **Paid modes add exactly one more approval, before play:** `deposit()`.
  Sent in the same `signAndSendTransactions` batch as the key where the wallet
  allows, so it is still one prompt.
- **Allowance.** The key gets a gas allowance (default 0.25 NEAR). Taps attach
  10 Tgas (~0.001 NEAR prepaid), and the engine does the poking and settling,
  so a player's key pays for taps only: ~250 taps per approval. The UI warns at
  10% left; renewing is one approval between taps, never mid-tap.
- **Optimistic taps.** The lane draws on tap, the tx goes out behind it, and a
  rejection rolls it back with a one-line inline reason. Nonces are tracked
  locally so fast taps do not serialise on RPC round-trips.
- **Clean UI.** One screen: board, stake selector, balance/chips. Leaderboard
  is a drawer. No modals, toasts or onboarding during play. The wallet popup
  at "Play" is the only foreign UI a player ever sees.
- **Guest play (secondary link, "no wallet? play as guest").** Most judges
  will not have a testnet wallet. The browser makes a key and creates a funded
  testnet account through `https://helper.testnet.near.org/account` (verified
  2026-11-14: 200, CORS open, 10 NEAR). Zero approvals. Testnet only;
  README says so.

---

## 7. Deployment

**Testnet, real Rhea.** Eligible under Q-010, zero mainnet spend, nothing
mocked.

1. `riptide.<acct>.testnet` — the game contract.
2. Oracle pool: **`ref-finance-101.testnet` pool 0** (`wrap.testnet` /
   `rft.tokenfactory.testnet`, ~1497 wNEAR deep, 40 bps fee). Chosen because
   it is real, existing, shallow enough for small swaps to move it visibly,
   and the bot only needs wNEAR (`near_deposit` on `wrap.testnet`) to trade
   both directions. Pool 1084 (USDT/wNEAR, ~87k wNEAR) is too deep to move;
   pool 2961 (NEAR/USDC mirror) is another team's market-maker, not ours to
   depend on.
3. Swap bot: random-walk swaps of ~0.2–1 wNEAR every ~2s against pool 0,
   mean-reverting to an anchor so price does not drift away. Real
   `ft_transfer_call` swaps through Rhea's contract; anyone else's swap on the
   pool moves the board too.
   - Fee budget: 40 bps per swap. Continuous at 2s ≈ 3–7 NEAR/hour. The bot
     runs only while someone is playing (the frontend pings the engine; the
     bot sleeps 10 min after the last ping). Funded from faucet accounts.

`pool_contract` / `pool_id` are config, so mainnet `v2.ref-finance.near` is a
`set_config` call and no code change. Mainnet only on explicit human go-ahead.

## 8. Failure modes and edges

| Case | Behavior |
|---|---|
| No sample covers a position's window | Position refunded |
| Position older than the 128-sample ring | Refunded |
| `get_pool` call fails | Callback records nothing |
| Pool has 0 reserves | Sample rejected, no σ update |
| Spot unknown / stale > 5s | `place` rejected. Never take money against an unknown price |
| Tap on an already-won cell | Rejected |
| Tap on an expired cell (`window_end ≤ now`) | Rejected |
| Quote came out below `min_quote_bps` | Rejected, nothing charged |
| Tap lands a block late | Caught by `min_quote_bps`, else fills at the honest new quote |
| σ collapses on a dead pool | Clamped to `SIGMA_MIN` |
| Tier cap exceeded (per trade or per cell) | Rejected, nothing charged |
| Global exposure cap hit | Rejected, nothing charged |
| Vault cannot cover a win | Unreachable while the cap holds; if it ever happens, payout is queued to `claimable` and LP withdrawals halt |
| Player chips hit 0 | Paid session: out, no re-buy. Free session: `join_free` re-buys |
| Session key allowance runs out | Tap fails before broadcast; UI asks for one re-approval between taps |
| Wallet prompts on a limited-key call anyway | Switch that wallet to the app-held key path (§6.2) |
| Faucet down (guest play) | Guest link hidden; wallet path unaffected |
| Session with <2 players | Entry fees refunded |
| Tie on final chips | Prize rank split equally |
| Whale pushes pool price | Tournament: ranking only, no real money per tap. Cash: bounded by edge + caps, stated plainly in README |

## 9. Tests

Money and quote paths only; no framework theater.

- Unit: `PHI2` interpolation at table edges and above z=4; quote monotonicity
  (falls as `d` falls, rises as `steps` falls); quote floor and cap; band
  membership at exact edges; both `touch_mode` branches including a touch
  exactly at `window_start` and at `window_end`; `min_quote_bps` guard;
  refund-on-missing-samples; ring wraparound; tier caps; exposure cap
  arithmetic; vault share price across deposit/withdraw/win/loss; chip credit
  arithmetic; top-3 maintenance including ties; prize split summing to the pool
  exactly; σ clamping and rescaling to a 5s step.
- One `near-workspaces` integration test per mode:
  cash — poke → place → poke×N → settle → claim, asserting vault and player
  balances; tournament — join → place_chips → settle → settle_session → claim.
- A σ sanity script over real `get_pool` samples from mainnet, to tune
  `SIGMA_MIN/MAX` against an actual pool.

## 10. Build order

Everything except the skin's final identity.

1. `git init`, delete `rail.tsx`/`rail.css`, LICENSE (MIT), README skeleton.
2. `scripts/gen-phi-table.ts` → the `PHI2` constant.
3. Testnet accounts; bot wraps NEAR and swaps once against Rhea pool 0;
   verify near-connect `signIn` with `contractId` on Meteor + MyNearWallet
   testnet (does a tap prompt?).
4. `riptide`: config, oracle (`poke` + callback), σ, price ring.
5. `riptide`: the pricer. **Tests here** — this is the money math.
6. `riptide`: positions, `place`, `settle`, refunds, `claim`. **Tests here.**
7. `riptide`: vault, tier caps, exposure cap (cash mode).
8. `riptide`: sessions, chips, `settle_session`, leaderboard (tournament mode).
9. Round engine (poke + settle + session bell + swap bot).
10. Frontend core: wallet, scrolling grid, live quotes, tap, stake selector,
    positions list, reveal, chips, leaderboard, claim. Mobile-first.
11. `skins/flappy.tsx` placeholder.
12. README for a machine reader (Q-017): what it is, "do X → see Y" steps, and
    the honest cash-mode risk note.

## 11. Cut list, in cut order

Follow graph · weekly rewards · pick history beyond open positions ·
multi-pool selection · sound · VIP tier · depth and volume display from
`indexer.ref.finance` · skin #2 · cash mode (if the clock runs out, tournament
mode alone is a complete product).

## 12. Binding amendments

`PLAN.md` §1 bugs B1–B10 override the sections they name (center-cell floor,
σ unit, `SQRT` bounds, poke-spam refund, u128 overflow, absolute cells,
top-3, session end, free-session re-buy, touch between samples).

## 13. Open

- **Final skin.** Flappy placeholder ships; Pipe Builder / Mine Layer / Deep Sea
  Hook / Snake & Apples all drop into §6 unchanged.
- `touch_mode` default, to be settled by watching a real board.
- `PHI2` and σ bounds tuning against real pool samples.
- Whether column 0 should be the next 5s boundary or `now + 1 block`, once real
  tap latency is measured on testnet.
- Entry fee denomination: NEAR config value today, so "$10" drifts with price.
  A stablecoin entry fee is the fix and is out of scope for v1.
