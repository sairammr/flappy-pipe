use near_sdk::json_types::U128;
use near_sdk::store::{IterableSet, LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

mod phi;
pub mod pricer;
use pricer::*;

pub const WINDOW_MS: u64 = 5_000;
pub const COLUMNS: u64 = 10;
pub const RING: usize = 128;
pub const MIN_SAMPLE_GAP_MS: u64 = 800;
pub const STALE_MS: u64 = 5_000;
pub const START_CHIPS: u64 = 10_000;
pub const MAX_CHIPS_PER_TAP: u64 = 1_000;
pub const MAX_OPEN_PER_ACCOUNT: usize = 32;
pub const KEEP_SETTLED: usize = 16;
pub const MAX_GAP_BANDS: i64 = 8;
const BOARD_SAMPLES: usize = 64;
const SETTLEABLE_SCAN: usize = 500;
/// Gate prices kept (one per 5 s window, ~85 min); older unsettled bets refund.
pub const GATES: u64 = 1024;
/// A gate is only priced if samples on both sides of it are at most this far apart.
pub const MAX_GATE_GAP_MS: u64 = 10_000;
pub const TOP: usize = 20;
pub const TOURNEY_CHIPS: u64 = 10_000;
pub const TOURNEY_MAX_PLAYERS: usize = 50;
pub const TOURNEY_MAX_LIVE: usize = 50;
pub const PRIZE_BPS: [u64; 3] = [5_000, 3_000, 2_000];

#[ext_contract(ext_pool)]
#[allow(dead_code)]
trait Pool {
    fn get_pool(&self, pool_id: u64);
}

#[near(serializers = [json])]
pub struct PoolInfo {
    pub amounts: Vec<U128>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    pub owner: AccountId,
    pub pool_contract: AccountId,
    pub pool_id: u64,
    pub tick: U128,
    pub edge_bps: u32,
}

/// One price feed: a Rhea pool, its band height, its sample ring.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Market {
    pub label: String,
    pub pool_contract: AccountId,
    pub pool_id: u64,
    pub tick: U128,
    pub ring: Vec<Sample>,
    pub head: u32,
}

#[near(serializers = [json])]
pub struct MarketView {
    pub id: u32,
    pub label: String,
    pub pool_contract: AccountId,
    pub pool_id: u64,
    pub tick: U128,
    pub spot: Option<U128>,
    pub last_sample_ms: Option<u64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy)]
pub struct Sample {
    pub ts_ms: u64,
    pub price: u128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Status {
    Open,
    Won,
    Lost,
    Refunded,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Position {
    pub owner: AccountId,
    pub band_lo: i64,
    pub band_hi: i64,
    pub window_idx: u64,
    pub price_lo: u128,
    pub price_hi: u128,
    pub placed_at_ms: u64,
    pub quote_bps: u32,
    pub stake: u64,
    pub session_id: u64,
    pub status: Status,
}

impl Position {
    fn window_end_ms(&self) -> u64 {
        (self.window_idx + 1) * WINDOW_MS
    }
}

#[near(serializers = [borsh])]
#[derive(Default, Clone)]
pub struct Acct {
    pub open: Vec<u64>,
    pub settled: Vec<u64>, // oldest first, <= KEEP_SETTLED
}

#[near(serializers = [json])]
pub struct PositionView {
    pub id: u64,
    pub band_lo: i64,
    pub band_hi: i64,
    pub window_idx: u64,
    pub price_lo: U128,
    pub price_hi: U128,
    pub window_start_ms: u64,
    pub window_end_ms: u64,
    pub placed_at_ms: u64,
    pub quote_bps: u32,
    pub stake: u64,
    pub session_id: u64,
    pub status: Status,
    pub market: u32,
}

#[near(serializers = [json])]
pub struct SampleView {
    pub ts_ms: u64,
    pub price: U128,
}

#[near(serializers = [json])]
pub struct BoardView {
    pub now_ms: u64,
    pub spot: Option<U128>,
    pub last_sample_ms: Option<u64>,
    pub sigma_bps: u32,
    pub sigma_ppm: u64,
    pub tick: U128,
    pub band0: i64,
    pub window0: u64,
    pub samples: Vec<SampleView>,
}

#[near(serializers = [json])]
pub struct LeaderRow {
    pub account_id: AccountId,
    pub chips: u64,
}

/// Cash results per player (session 1 trades + tournament prizes), in mUSD.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Stats {
    pub pnl: i64,
    pub trades: u32,
    pub wins: u32,
    pub best_bps: u32,
}

#[near(serializers = [json])]
pub struct LeaderView {
    pub account_id: AccountId,
    #[serde(flatten)]
    pub stats: Stats,
}

/// A timed tournament: everyone pays `entry` mUSD from their balance, gets TOURNEY_CHIPS,
/// trades the same live pipes until `end_ms`; the pot goes 50/30/20 by final chips.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Tourney {
    pub host: AccountId,
    pub entry: u64,
    pub start_ms: u64,
    pub end_ms: u64,
    pub players: Vec<AccountId>,
    pub open: u32,
    pub pot: u64,
    pub settled: bool,
}

#[near(serializers = [json])]
pub struct TourneyPlayer {
    pub account_id: AccountId,
    pub chips: u64,
    pub prize: u64,
}

#[near(serializers = [json])]
pub struct TourneyView {
    pub id: u64,
    pub host: AccountId,
    pub entry: u64,
    pub start_ms: u64,
    pub end_ms: u64,
    pub pot: u64,
    pub open: u32,
    pub settled: bool,
    /// ranked by chips, best first
    pub players: Vec<TourneyPlayer>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Riptide {
    config: Config,
    markets: Vec<Market>,
    next_id: u64,
    positions: LookupMap<u64, Position>,
    accts: LookupMap<AccountId, Acct>,
    open: IterableSet<u64>,
    chips: LookupMap<AccountId, u64>,
    players: Vector<AccountId>,
    cash_cfg: CashConfig,
    vault_units: u64,
    open_liability: u64,
    cash: LookupMap<AccountId, u64>,
    cash_players: Vector<AccountId>,
    /// window_idx -> price at that window's end (the gate), last GATES windows
    gates: LookupMap<u64, u128>,
    stats: LookupMap<AccountId, Stats>,
    top: Vec<(AccountId, i64)>,
    tourneys: LookupMap<u64, Tourney>,
    next_tourney: u64,
    stacks: LookupMap<(u64, AccountId), u64>,
    live: Vec<u64>,
    prizes: LookupMap<(u64, AccountId), u64>,
    /// position id -> market, for markets other than 0
    pos_market: LookupMap<u64, u32>,
}

/// Layout deployed as v3 (single pool); read once by `migrate`.
#[near(serializers = [borsh])]
pub struct OldRiptide {
    config: Config,
    ring: Vec<Sample>,
    head: u32,
    next_id: u64,
    positions: LookupMap<u64, Position>,
    accts: LookupMap<AccountId, Acct>,
    open: IterableSet<u64>,
    chips: LookupMap<AccountId, u64>,
    players: Vector<AccountId>,
    cash_cfg: CashConfig,
    vault_units: u64,
    open_liability: u64,
    cash: LookupMap<AccountId, u64>,
    cash_players: Vector<AccountId>,
    gates: LookupMap<u64, u128>,
    stats: LookupMap<AccountId, Stats>,
    top: Vec<(AccountId, i64)>,
    tourneys: LookupMap<u64, Tourney>,
    next_tourney: u64,
    stacks: LookupMap<(u64, AccountId), u64>,
    live: Vec<u64>,
    prizes: LookupMap<(u64, AccountId), u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct CashConfig {
    pub yocto_per_unit: U128,
    pub cash_edge_bps: u32,
    pub max_cash_stake: u64,
    pub max_exposure_bps: u32,
    pub cash_max_quote_bps: u32,
}

impl Default for CashConfig {
    fn default() -> Self {
        Self {
            yocto_per_unit: U128(100_000_000_000_000_000_000), // 1e20 yocto per mUSD: 1 NEAR = 10_000 mUSD = $10
            cash_edge_bps: 300,
            max_cash_stake: 1_000,
            max_exposure_bps: 2_000,
            cash_max_quote_bps: 1_000_000,
        }
    }
}

#[near(serializers = [json])]
pub struct VaultView {
    pub vault_units: u64,
    pub open_liability: u64,
    pub yocto_per_unit: U128,
    pub cash_edge_bps: u32,
    pub max_cash_stake: u64,
    pub max_exposure_bps: u32,
    pub cash_max_quote_bps: u32,
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

#[near]
impl Riptide {
    #[init]
    pub fn new(owner: AccountId, pool_contract: AccountId, pool_id: u64, tick: U128) -> Self {
        require!(tick.0 > 0, "tick must be > 0");
        Self {
            config: Config { owner, pool_contract: pool_contract.clone(), pool_id, tick, edge_bps: 0 },
            markets: vec![Market { label: "wNEAR/RFT".into(), pool_contract, pool_id, tick, ring: Vec::new(), head: 0 }],
            next_id: 0,
            positions: LookupMap::new(b"p"),
            accts: LookupMap::new(b"a"),
            open: IterableSet::new(b"o"),
            chips: LookupMap::new(b"c"),
            players: Vector::new(b"l"),
            cash_cfg: CashConfig::default(),
            vault_units: 0,
            open_liability: 0,
            cash: LookupMap::new(b"C"),
            cash_players: Vector::new(b"L"),
            gates: LookupMap::new(b"g"),
            stats: LookupMap::new(b"s"),
            top: Vec::new(),
            tourneys: LookupMap::new(b"t"),
            next_tourney: 2,
            stacks: LookupMap::new(b"k"),
            live: Vec::new(),
            prizes: LookupMap::new(b"z"),
            pos_market: LookupMap::new(b"m"),
        }
    }

    /// One-shot upgrade from the v3 (single pool) layout: that pool and its ring become
    /// market 0; everything else is kept as is.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let o: OldRiptide = env::state_read().unwrap_or_else(|| env::panic_str("no old state"));
        let c = &o.config;
        let m0 = Market { label: "wNEAR/RFT".into(), pool_contract: c.pool_contract.clone(), pool_id: c.pool_id, tick: c.tick, ring: o.ring, head: o.head };
        Self {
            config: o.config,
            markets: vec![m0],
            next_id: o.next_id,
            positions: o.positions,
            accts: o.accts,
            open: o.open,
            chips: o.chips,
            players: o.players,
            cash_cfg: o.cash_cfg,
            vault_units: o.vault_units,
            open_liability: o.open_liability,
            cash: o.cash,
            cash_players: o.cash_players,
            gates: o.gates,
            stats: o.stats,
            top: o.top,
            tourneys: o.tourneys,
            next_tourney: o.next_tourney,
            stacks: o.stacks,
            live: o.live,
            prizes: o.prizes,
            pos_market: LookupMap::new(b"m"),
        }
    }

    // ---------- oracle ----------

    /// Samples one market's pool (default market 0).
    pub fn poke(&self, market: Option<u32>) -> PromiseOrValue<()> {
        let m = market.unwrap_or(0);
        let mk = self.market(m);
        if self.last(m).is_some_and(|l| now_ms() < l.ts_ms + MIN_SAMPLE_GAP_MS) {
            return PromiseOrValue::Value(());
        }
        ext_pool::ext(mk.pool_contract.clone())
            .with_static_gas(Gas::from_tgas(10))
            .get_pool(mk.pool_id)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_pool(m))
            .into()
    }

    #[private]
    pub fn on_pool(&mut self, market: u32, #[callback_result] pool: Result<PoolInfo, PromiseError>) -> bool {
        let Ok(pool) = pool else { return false };
        if pool.amounts.len() < 2 {
            return false;
        }
        match pool_price(pool.amounts[0].0, pool.amounts[1].0) {
            Some(p) => self.record(market, now_ms(), p),
            None => false,
        }
    }

    // ---------- gameplay ----------

    pub fn join_free(&mut self) {
        let who = env::predecessor_account_id();
        match self.chips.get(&who) {
            None => {
                self.players.push(who.clone());
                self.chips.insert(who, START_CHIPS);
            }
            Some(&c) if c < 100 => {
                self.chips.insert(who, START_CHIPS);
            }
            _ => {}
        }
    }

    pub fn place_chips(
        &mut self,
        session_id: u64,
        band_lo: i64,
        band_hi: i64,
        window_idx: u64,
        min_quote_bps: u32,
        chips: u64,
        market: Option<u32>,
    ) -> u64 {
        let m = market.unwrap_or(0);
        require!((m as usize) < self.markets.len(), "unknown market");
        let max = if session_id == 1 { self.cash_cfg.max_cash_stake } else { MAX_CHIPS_PER_TAP };
        if session_id >= 2 {
            let t = self.tourneys.get(&session_id).unwrap_or_else(|| env::panic_str("unknown session"));
            // every bet's gate is inside the tournament, so the bell settles everything
            require!(window_idx * WINDOW_MS >= t.start_ms && (window_idx + 1) * WINDOW_MS <= t.end_ms, "outside tournament");
        }
        require!(chips > 0 && chips <= max, "bad chip amount");
        let who = env::predecessor_account_id();
        let have = self.bal(session_id, &who).unwrap_or_else(|| env::panic_str("join or deposit first"));
        require!(have >= chips, "not enough chips");
        let now = now_ms();
        let w0 = now / WINDOW_MS + 1;
        require!(window_idx >= w0 && window_idx < w0 + COLUMNS, "window not placeable");
        let last = self.last(m).unwrap_or_else(|| env::panic_str("no price yet"));
        require!(now <= last.ts_ms + STALE_MS, "price stale");
        let (lo, hi, q) = self.range_quote(m, session_id, last, band_lo, band_hi, window_idx, now);
        require!(q >= MIN_QUOTE_BPS && q >= min_quote_bps, "quote below minimum");
        if session_id == 1 {
            let payout = chips * q as u64 / 10_000;
            let cap = self.vault_units as u128 * self.cash_cfg.max_exposure_bps as u128 / 10_000;
            require!((self.open_liability + payout) as u128 <= cap, "house limit");
            self.vault_units += chips;
            self.open_liability += payout;
        }
        if session_id >= 2 {
            self.tourneys.get_mut(&session_id).unwrap().open += 1;
        }
        let mut acct = self.accts.get(&who).cloned().unwrap_or_default();
        require!(acct.open.len() < MAX_OPEN_PER_ACCOUNT, "too many open positions");

        let id = self.next_id;
        self.next_id += 1;
        self.set_bal(session_id, &who, have - chips);
        self.positions.insert(
            id,
            Position {
                owner: who.clone(),
                band_lo,
                band_hi,
                window_idx,
                price_lo: lo,
                price_hi: hi,
                placed_at_ms: now,
                quote_bps: q,
                stake: chips,
                session_id,
                status: Status::Open,
            },
        );
        acct.open.push(id);
        self.accts.insert(who, acct);
        self.open.insert(id);
        if m > 0 {
            self.pos_market.insert(id, m);
        }
        id
    }

    /// Permissionless. Unknown, already-settled and not-yet-settleable ids are skipped.
    pub fn settle(&mut self, position_ids: Vec<u64>) {
        let lasts: Vec<Option<u64>> = (0..self.markets.len() as u32).map(|m| self.last(m).map(|l| l.ts_ms)).collect();
        for id in position_ids {
            let Some(p) = self.positions.get(&id) else { continue };
            if p.status != Status::Open {
                continue;
            }
            let m = self.pos_market.get(&id).copied().unwrap_or(0);
            let Some(last_ts) = lasts[m as usize] else { continue };
            let Some(outcome) = outcome(self.gates.get(&gate_key(m, p.window_idx)).copied(), last_ts, p) else { continue };
            let mut p = p.clone();
            p.status = outcome;
            let payout = p.stake * p.quote_bps as u64 / 10_000;
            let credit = match outcome {
                Status::Won => payout,
                Status::Refunded => p.stake,
                _ => 0,
            };
            if p.session_id == 1 {
                // stake already sits in the vault; the vault pays credits
                self.vault_units = self.vault_units.saturating_sub(credit);
                self.open_liability = self.open_liability.saturating_sub(payout);
                if outcome != Status::Refunded {
                    let mut st = self.stats.get(&p.owner).cloned().unwrap_or_default();
                    st.trades += 1;
                    if outcome == Status::Won {
                        st.wins += 1;
                        st.best_bps = st.best_bps.max(p.quote_bps);
                    }
                    self.add_pnl(&p.owner, st, credit as i64 - p.stake as i64);
                }
            }
            if p.session_id >= 2 {
                if let Some(t) = self.tourneys.get_mut(&p.session_id) {
                    t.open = t.open.saturating_sub(1);
                }
            }
            if credit > 0 {
                let c = self.bal(p.session_id, &p.owner).unwrap_or(0);
                self.set_bal(p.session_id, &p.owner, c + credit);
            }
            self.open.remove(&id);
            let a = self.accts.get_mut(&p.owner).expect("acct");
            a.open.retain(|x| *x != id);
            a.settled.push(id);
            let drop: Vec<u64> = if a.settled.len() > KEEP_SETTLED {
                a.settled.drain(..a.settled.len() - KEEP_SETTLED).collect()
            } else {
                vec![]
            };
            for old in drop {
                self.positions.remove(&old);
            }
            env::log_str(&format!(
                "EVENT_JSON:{{\"standard\":\"riptide\",\"version\":\"1\",\"event\":\"settle\",\"data\":{{\"id\":{id},\"status\":\"{outcome:?}\",\"credit\":{credit}}}}}"
            ));
            self.positions.insert(id, p);
        }
    }

    // ---------- real money (session 1). Unit = mUSD = $0.001 ----------

    /// Player-facing trade: session 1, stake in mUSD. Non-payable (session-key callable).
    pub fn place(&mut self, band_lo: i64, band_hi: i64, window_idx: u64, min_quote_bps: u32, stake: u64, market: Option<u32>) -> u64 {
        self.place_chips(1, band_lo, band_hi, window_idx, min_quote_bps, stake, market)
    }

    /// mUSD balance, 0 if none.
    pub fn balance(&self, account_id: AccountId) -> u64 {
        self.cash.get(&account_id).copied().unwrap_or(0)
    }

    /// Credits floor(attached / yocto_per_unit) mUSD; dust stays with the contract.
    #[payable]
    pub fn deposit(&mut self) -> u64 {
        let who = env::predecessor_account_id();
        let units = self.units_attached();
        let b = match self.cash.get(&who) {
            Some(&b) => b,
            None => {
                self.cash_players.push(who.clone());
                0
            }
        };
        self.cash.insert(who, b + units);
        units
    }

    #[payable]
    pub fn withdraw(&mut self, units: u64) -> Promise {
        near_sdk::assert_one_yocto();
        let who = env::predecessor_account_id();
        let b = self.cash.get(&who).copied().unwrap_or(0);
        require!(units > 0 && b >= units, "insufficient balance");
        self.cash.insert(who.clone(), b - units);
        self.pay(who, units, false)
    }

    #[payable]
    pub fn fund_vault(&mut self) -> u64 {
        let units = self.units_attached();
        self.vault_units += units;
        units
    }

    #[payable]
    pub fn vault_withdraw(&mut self, units: u64) -> Promise {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.config.owner, "owner only");
        require!(units > 0 && self.vault_units >= self.open_liability + units, "vault below liability");
        self.vault_units -= units;
        self.pay(self.config.owner.clone(), units, true)
    }

    /// Restores the debit if the transfer failed.
    #[private]
    pub fn on_withdraw(&mut self, who: AccountId, units: u64, vault: bool) {
        if near_sdk::is_promise_success() {
            return;
        }
        if vault {
            self.vault_units += units;
        } else {
            let b = self.cash.get(&who).copied().unwrap_or(0);
            self.cash.insert(who, b + units);
        }
    }

    pub fn vault(&self) -> VaultView {
        let c = &self.cash_cfg;
        VaultView {
            vault_units: self.vault_units,
            open_liability: self.open_liability,
            yocto_per_unit: c.yocto_per_unit,
            cash_edge_bps: c.cash_edge_bps,
            max_cash_stake: c.max_cash_stake,
            max_exposure_bps: c.max_exposure_bps,
            cash_max_quote_bps: c.cash_max_quote_bps,
        }
    }

    // ---------- tournaments (sessions >= 2) ----------

    /// Host creates and joins. entry in mUSD (0 = free), start within 1 h, 1-30 min long.
    pub fn create_tourney(&mut self, entry: u64, start_ms: u64, length_ms: u64) -> u64 {
        let now = now_ms();
        require!(entry <= 10_000, "entry too high");
        require!(start_ms >= now && start_ms <= now + 3_600_000, "bad start");
        require!(length_ms >= 60_000 && length_ms <= 1_800_000 && length_ms % WINDOW_MS == 0, "bad length");
        require!(self.live.len() < TOURNEY_MAX_LIVE, "too many tournaments");
        let start_ms = start_ms.div_ceil(WINDOW_MS) * WINDOW_MS;
        let id = self.next_tourney;
        self.next_tourney += 1;
        let host = env::predecessor_account_id();
        self.tourneys.insert(id, Tourney { host, entry, start_ms, end_ms: start_ms + length_ms, players: vec![], open: 0, pot: 0, settled: false });
        self.live.push(id);
        self.join_tourney(id);
        id
    }

    /// Pays the entry from your balance, gives you TOURNEY_CHIPS. Before the start only.
    pub fn join_tourney(&mut self, id: u64) {
        let who = env::predecessor_account_id();
        let t = self.tourneys.get(&id).unwrap_or_else(|| env::panic_str("unknown tournament")).clone();
        require!(now_ms() < t.start_ms, "already started");
        require!(!t.players.contains(&who), "already joined");
        require!(t.players.len() < TOURNEY_MAX_PLAYERS, "tournament full");
        if t.entry > 0 {
            let b = self.cash.get(&who).copied().unwrap_or(0);
            require!(b >= t.entry, "insufficient balance");
            self.cash.insert(who.clone(), b - t.entry);
        }
        let t = self.tourneys.get_mut(&id).unwrap();
        t.players.push(who.clone());
        t.pot += t.entry;
        self.stacks.insert((id, who), TOURNEY_CHIPS);
    }

    /// Permissionless, after the bell once every bet in it is settled. Pot 50/30/20 by
    /// chips (ties split their places' shares); fewer than 2 players = entries refunded.
    pub fn settle_tourney(&mut self, id: u64) {
        let t = self.tourneys.get(&id).unwrap_or_else(|| env::panic_str("unknown tournament")).clone();
        require!(!t.settled, "already settled");
        require!(now_ms() >= t.end_ms, "not over");
        require!(t.open == 0, "bets still open");
        let prizes = if t.players.len() < 2 {
            t.players.iter().map(|_| t.entry).collect()
        } else {
            let chips: Vec<u64> = t.players.iter().map(|a| self.stacks.get(&(id, a.clone())).copied().unwrap_or(0)).collect();
            split_pot(t.pot, &chips)
        };
        for (a, prize) in t.players.iter().zip(prizes) {
            self.prizes.insert((id, a.clone()), prize);
            if prize > 0 {
                let b = self.cash.get(a).copied().unwrap_or(0);
                self.cash.insert(a.clone(), b + prize);
            }
            if t.entry > 0 && t.players.len() >= 2 {
                let st = self.stats.get(a).cloned().unwrap_or_default();
                self.add_pnl(a, st, prize as i64 - t.entry as i64);
            }
        }
        self.tourneys.get_mut(&id).unwrap().settled = true;
        self.live.retain(|x| *x != id);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"riptide\",\"version\":\"1\",\"event\":\"tourney\",\"data\":{{\"id\":{id},\"pot\":{}}}}}", t.pot));
    }

    pub fn tourney(&self, id: u64) -> Option<TourneyView> {
        let t = self.tourneys.get(&id)?;
        let mut players: Vec<TourneyPlayer> = t
            .players
            .iter()
            .map(|a| TourneyPlayer {
                account_id: a.clone(),
                chips: self.stacks.get(&(id, a.clone())).copied().unwrap_or(0),
                prize: self.prizes.get(&(id, a.clone())).copied().unwrap_or(0),
            })
            .collect();
        players.sort_by(|x, y| y.chips.cmp(&x.chips));
        Some(TourneyView { id, host: t.host.clone(), entry: t.entry, start_ms: t.start_ms, end_ms: t.end_ms, pot: t.pot, open: t.open, settled: t.settled, players })
    }

    /// Unsettled tournaments, oldest first.
    pub fn tourneys_live(&self) -> Vec<u64> {
        self.live.clone()
    }

    // ---------- global leaderboard (cash) ----------

    /// Top players by cash P&L, best first.
    pub fn leaders(&self) -> Vec<LeaderView> {
        self.top
            .iter()
            .map(|(a, _)| LeaderView { account_id: a.clone(), stats: self.stats.get(a).cloned().unwrap_or_default() })
            .collect()
    }

    pub fn stats(&self, account_id: AccountId) -> Stats {
        self.stats.get(&account_id).cloned().unwrap_or_default()
    }

    // ---------- owner ----------

    #[payable]
    pub fn set_config(
        &mut self,
        pool_contract: Option<AccountId>,
        pool_id: Option<u64>,
        tick: Option<U128>,
        edge_bps: Option<u32>,
        yocto_per_unit: Option<U128>,
        cash_edge_bps: Option<u32>,
        max_cash_stake: Option<u64>,
        max_exposure_bps: Option<u32>,
        cash_max_quote_bps: Option<u32>,
    ) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.config.owner, "owner only");
        let locked = !self.cash_players.is_empty();
        let c = &mut self.cash_cfg;
        if let Some(v) = yocto_per_unit {
            // changing the rate after deposits would re-price everyone's balance
            require!(!locked, "rate locked after deposits");
            require!(v.0 > 0, "bad yocto_per_unit");
            c.yocto_per_unit = v;
        }
        if let Some(v) = cash_edge_bps {
            require!(v < 10_000, "edge too high");
            c.cash_edge_bps = v;
        }
        if let Some(v) = max_cash_stake {
            require!(v > 0 && v <= 10_000, "bad max stake");
            c.max_cash_stake = v;
        }
        if let Some(v) = max_exposure_bps {
            require!(v <= 10_000, "exposure too high");
            c.max_exposure_bps = v;
        }
        if let Some(v) = cash_max_quote_bps {
            require!(v >= MIN_QUOTE_BPS && v <= MAX_QUOTE_BPS, "bad quote cap");
            c.cash_max_quote_bps = v;
        }
        if let Some(v) = pool_contract {
            self.config.pool_contract = v.clone();
            self.markets[0].pool_contract = v;
        }
        if let Some(v) = pool_id {
            self.config.pool_id = v;
            self.markets[0].pool_id = v;
        }
        if let Some(v) = tick {
            require!(v.0 > 0, "tick must be > 0");
            self.config.tick = v;
            self.markets[0].tick = v;
        }
        if let Some(v) = edge_bps {
            require!(v < 10_000, "edge too high");
            self.config.edge_bps = v;
        }
    }

    /// Owner adds a market (another pool). Bets on it share balances, vault and caps.
    #[payable]
    pub fn add_market(&mut self, label: String, pool_contract: AccountId, pool_id: u64, tick: U128) -> u32 {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.config.owner, "owner only");
        require!(tick.0 > 0 && label.len() <= 32 && self.markets.len() < 16, "bad market");
        self.markets.push(Market { label, pool_contract, pool_id, tick, ring: Vec::new(), head: 0 });
        self.markets.len() as u32 - 1
    }

    // ---------- views ----------

    pub fn markets(&self) -> Vec<MarketView> {
        (0..self.markets.len() as u32)
            .map(|m| {
                let mk = &self.markets[m as usize];
                let last = self.last(m);
                MarketView { id: m, label: mk.label.clone(), pool_contract: mk.pool_contract.clone(), pool_id: mk.pool_id, tick: mk.tick, spot: last.map(|l| U128(l.price)), last_sample_ms: last.map(|l| l.ts_ms) }
            })
            .collect()
    }

    pub fn board(&self, market: Option<u32>) -> BoardView {
        let m = market.unwrap_or(0);
        let now = now_ms();
        let samples = self.samples(m);
        let s5 = self.sigma5_sq(m);
        let last = samples.last().copied();
        let tick = self.market(m).tick.0;
        let band0 = last.map(|s| (s.price / tick) as i64).unwrap_or(0);
        let window0 = now / WINDOW_MS + 1;
        BoardView {
            now_ms: now,
            spot: last.map(|s| U128(s.price)),
            last_sample_ms: last.map(|s| s.ts_ms),
            sigma_bps: (s5.isqrt() / 100) as u32,
            sigma_ppm: s5.isqrt() as u64,
            tick: self.market(m).tick,
            band0,
            window0,
            samples: samples[samples.len().saturating_sub(BOARD_SAMPLES)..]
                .iter()
                .map(|s| SampleView { ts_ms: s.ts_ms, price: U128(s.price) })
                .collect(),
        }
    }

    pub fn positions(&self, account_id: AccountId) -> Vec<PositionView> {
        let Some(a) = self.accts.get(&account_id) else { return vec![] };
        let mut ids: Vec<u64> = a.open.iter().chain(a.settled.iter()).copied().collect();
        ids.sort_unstable_by(|x, y| y.cmp(x));
        ids.into_iter()
            .filter_map(|id| {
                self.positions.get(&id).map(|p| PositionView {
                    id,
                    band_lo: p.band_lo,
                    band_hi: p.band_hi,
                    window_idx: p.window_idx,
                    price_lo: U128(p.price_lo),
                    price_hi: U128(p.price_hi),
                    window_start_ms: p.window_idx * WINDOW_MS,
                    window_end_ms: p.window_end_ms(),
                    placed_at_ms: p.placed_at_ms,
                    quote_bps: p.quote_bps,
                    stake: p.stake,
                    session_id: p.session_id,
                    status: p.status,
                    market: self.pos_market.get(&id).copied().unwrap_or(0),
                })
            })
            .collect()
    }

    pub fn settleable(&self, limit: u32) -> Vec<u64> {
        let lasts: Vec<u64> = (0..self.markets.len() as u32).map(|m| self.last(m).map_or(0, |l| l.ts_ms)).collect();
        // ponytail: linear scan of the open set, capped; index by window if open count grows past ~500
        self.open
            .iter()
            .take(SETTLEABLE_SCAN)
            .filter(|id| {
                let m = self.pos_market.get(id).copied().unwrap_or(0) as usize;
                self.positions.get(id).is_some_and(|p| lasts[m] >= p.window_end_ms())
            })
            .take(limit as usize)
            .copied()
            .collect()
    }

    pub fn chips(&self, session_id: u64, account_id: AccountId) -> Option<u64> {
        self.bal(session_id, &account_id)
    }

    pub fn leaderboard(&self, session_id: u64) -> Vec<LeaderRow> {
        let players = match session_id {
            0 => &self.players,
            1 => &self.cash_players,
            _ => return vec![],
        };
        // ponytail: first 1000 players only (bounded gas); `leaders()` is the global board
        let mut rows: Vec<LeaderRow> = players
            .iter()
            .take(1000)
            .map(|a| LeaderRow { account_id: a.clone(), chips: self.bal(session_id, a).unwrap_or(0) })
            .collect();
        rows.sort_by(|x, y| y.chips.cmp(&x.chips)); // stable: earlier join wins ties
        rows.truncate(20);
        rows
    }

    /// Current quote for a gap, or null if not placeable right now.
    pub fn quote(&self, band_lo: i64, band_hi: i64, window_idx: u64, session_id: Option<u64>, market: Option<u32>) -> Option<u32> {
        let session_id = session_id.unwrap_or(0);
        let m = market.unwrap_or(0);
        if m as usize >= self.markets.len() {
            return None;
        }
        let now = now_ms();
        let w0 = now / WINDOW_MS + 1;
        let last = self.last(m).filter(|l| now <= l.ts_ms + STALE_MS)?;
        if session_id > 1 && !self.tourneys.contains_key(&session_id) || window_idx < w0 || window_idx >= w0 + COLUMNS || band_lo < 0 || band_lo > band_hi || band_hi - band_lo >= MAX_GAP_BANDS {
            return None;
        }
        let q = self.range_quote(m, session_id, last, band_lo, band_hi, window_idx, now).2;
        (q >= MIN_QUOTE_BPS).then_some(q)
    }

    pub fn config(&self) -> Config {
        self.config.clone()
    }
}

impl Riptide {
    fn bal(&self, session_id: u64, who: &AccountId) -> Option<u64> {
        match session_id {
            0 => self.chips.get(who).copied(),
            1 => self.cash.get(who).copied(),
            s => self.stacks.get(&(s, who.clone())).copied(),
        }
    }

    fn set_bal(&mut self, session_id: u64, who: &AccountId, v: u64) {
        match session_id {
            0 => self.chips.insert(who.clone(), v),
            1 => self.cash.insert(who.clone(), v),
            s => self.stacks.insert((s, who.clone()), v),
        };
    }

    /// Saves stats with pnl += delta and keeps `top` (best TOP by pnl) in order.
    /// ponytail: a player who drops out of `top` only re-enters on their next result.
    fn add_pnl(&mut self, who: &AccountId, mut st: Stats, delta: i64) {
        st.pnl += delta;
        self.top.retain(|(a, _)| a != who);
        let at = self.top.partition_point(|(_, p)| *p >= st.pnl);
        if at < TOP {
            self.top.insert(at, (who.clone(), st.pnl));
            self.top.truncate(TOP);
        }
        self.stats.insert(who.clone(), st);
    }

    fn units_attached(&self) -> u64 {
        let units = env::attached_deposit().as_yoctonear() / self.cash_cfg.yocto_per_unit.0;
        require!(units > 0 && units <= u64::MAX as u128, "deposit too small");
        units as u64
    }

    fn pay(&self, to: AccountId, units: u64, vault: bool) -> Promise {
        let yocto = units as u128 * self.cash_cfg.yocto_per_unit.0;
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(yocto))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_withdraw(to, units, vault))
    }

    #[allow(clippy::too_many_arguments)]
    fn range_quote(&self, m: u32, session_id: u64, last: Sample, band_lo: i64, band_hi: i64, window_idx: u64, now: u64) -> (u128, u128, u32) {
        require!(band_lo >= 0, "band below zero");
        require!(band_lo <= band_hi && band_hi - band_lo < MAX_GAP_BANDS, "bad gap");
        let (lo, hi) = (self.band(m, band_lo).0, self.band(m, band_hi).1);
        // time from the last known price, not from now: the pool may have moved since
        let t_ms = ((window_idx + 1) * WINDOW_MS).saturating_sub(last.ts_ms.min(now)).max(1);
        let (edge, cap) = if session_id == 1 {
            (self.cash_cfg.cash_edge_bps, self.cash_cfg.cash_max_quote_bps)
        } else {
            (self.config.edge_bps, MAX_QUOTE_BPS)
        };
        (lo, hi, quote_bps(last.price, lo, hi, self.sigma5_sq(m), t_ms, edge).min(cap))
    }

    fn market(&self, m: u32) -> &Market {
        self.markets.get(m as usize).unwrap_or_else(|| env::panic_str("unknown market"))
    }

    fn band(&self, m: u32, b: i64) -> (u128, u128) {
        let t = self.market(m).tick.0;
        let lo = (b as u128).checked_mul(t).unwrap_or_else(|| env::panic_str("band overflow"));
        (lo, lo.checked_add(t).unwrap_or_else(|| env::panic_str("band overflow")))
    }

    fn last(&self, m: u32) -> Option<Sample> {
        let mk = self.market(m);
        if mk.ring.len() < RING {
            mk.ring.last().copied()
        } else {
            Some(mk.ring[(mk.head as usize + RING - 1) % RING])
        }
    }

    /// Oldest first.
    fn samples(&self, m: u32) -> Vec<Sample> {
        let mk = self.market(m);
        let h = mk.head as usize;
        if mk.ring.len() < RING {
            mk.ring.clone()
        } else {
            mk.ring[h..].iter().chain(mk.ring[..h].iter()).copied().collect()
        }
    }

    fn sigma5_sq(&self, m: u32) -> u128 {
        let s: Vec<(u64, u128)> = self.samples(m).iter().map(|s| (s.ts_ms, s.price)).collect();
        pricer::sigma5_sq(&s)
    }

    /// Records a sample unless within MIN_SAMPLE_GAP of the last (B4).
    fn record(&mut self, m: u32, ts_ms: u64, price: u128) -> bool {
        if self.last(m).is_some_and(|l| ts_ms < l.ts_ms + MIN_SAMPLE_GAP_MS) {
            return false;
        }
        if let Some(prev) = self.last(m).filter(|l| ts_ms - l.ts_ms <= MAX_GATE_GAP_MS) {
            // Price every window end crossed since the last sample, on the straight line
            // between the two samples (the line the bird is drawn on).
            let mut end = (prev.ts_ms / WINDOW_MS + 1) * WINDOW_MS;
            while end <= ts_ms {
                let (dt, span) = ((end - prev.ts_ms) as u128, (ts_ms - prev.ts_ms) as u128);
                let at = if price >= prev.price { prev.price + (price - prev.price) * dt / span } else { prev.price - (prev.price - price) * dt / span };
                let w = end / WINDOW_MS - 1;
                self.gates.insert(gate_key(m, w), at);
                if w >= GATES {
                    self.gates.remove(&gate_key(m, w - GATES));
                }
                end += WINDOW_MS;
            }
        }
        let s = Sample { ts_ms, price };
        let mk = &mut self.markets[m as usize];
        if mk.ring.len() < RING {
            mk.ring.push(s);
        } else {
            mk.ring[mk.head as usize] = s;
            mk.head = ((mk.head as usize + 1) % RING) as u32;
        }
        true
    }
}

/// Market 0 keeps the v3 keys (plain window index).
fn gate_key(m: u32, w: u64) -> u64 {
    ((m as u64) << 40) | w
}

/// None = not settleable yet. Gate rule: the price where the bird meets the pipe (window
/// end, interpolated between the samples around it) must be inside [lo, hi). No gate price
/// (samples too far apart, or older than GATES windows) => refund.
fn outcome(gate: Option<u128>, last_ts: u64, p: &Position) -> Option<Status> {
    match gate {
        Some(g) => Some(if g >= p.price_lo && g < p.price_hi { Status::Won } else { Status::Lost }),
        None if last_ts >= p.window_end_ms() => Some(Status::Refunded),
        None => None,
    }
}

/// Pot shares by final chips (best first): 50/30/20, leftover shares to 1st, tied players
/// split the shares of the places they cover. Rounding dust goes to the first player.
fn split_pot(pot: u64, chips: &[u64]) -> Vec<u64> {
    let n = chips.len();
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|a, b| chips[*b].cmp(&chips[*a])); // stable: earlier join first
    let mut share = vec![0u64; n]; // bps by place
    for (i, b) in PRIZE_BPS.iter().enumerate() {
        share[if i < n { i } else { 0 }] += b;
    }
    let mut out = vec![0u64; n];
    let mut i = 0;
    while i < n {
        let mut j = i;
        while j + 1 < n && chips[order[j + 1]] == chips[order[i]] {
            j += 1;
        }
        let bps: u64 = share[i..=j].iter().sum();
        for k in i..=j {
            out[order[k]] = pot * bps / 10_000 / (j - i + 1) as u64;
        }
        i = j + 1;
    }
    let paid: u64 = out.iter().sum();
    out[order[0]] += pot - paid;
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const SPOT: u128 = 1_000_000_000_000; // 1e12
    const TICK: u128 = 1_000_000_000; // 0.1%

    fn ctx(ms: u64, who: usize) {
        testing_env!(VMContextBuilder::new()
            .block_timestamp(ms * 1_000_000)
            .predecessor_account_id(accounts(who))
            .current_account_id(accounts(0))
            .build());
    }

    fn fresh() -> Riptide {
        ctx(0, 0);
        Riptide::new(accounts(0), "pool.testnet".parse().unwrap(), 0, U128(TICK))
    }

    fn pos(lo: u128, hi: u128, window_idx: u64) -> Position {
        Position {
            owner: accounts(1),
            band_lo: 0,
            band_hi: 0,
            window_idx,
            price_lo: lo,
            price_hi: hi,
            placed_at_ms: 1_000,
            quote_bps: 20_000,
            stake: 100,
            session_id: 0,
            status: Status::Open,
        }
    }

    fn s(ts_ms: u64, price: u128) -> Sample {
        Sample { ts_ms, price }
    }

    #[test]
    fn gate_rule() {
        let p = pos(110, 120, 1); // gap [110,120), gate at 10_000
        assert_eq!(outcome(None, 9_999, &p), None);
        assert_eq!(outcome(Some(110), 10_000, &p), Some(Status::Won)); // lo inclusive
        assert_eq!(outcome(Some(120), 10_000, &p), Some(Status::Lost)); // hi exclusive
        assert_eq!(outcome(None, 10_000, &p), Some(Status::Refunded));
    }

    #[test]
    fn gates_interpolate() {
        let mut c = fresh();
        c.record(0, 8_000, 100);
        c.record(0, 12_000, 140); // crosses 10_000 halfway => 120
        assert_eq!(c.gates.get(&1).copied(), Some(120));
        c.record(0, 13_000, 90);
        c.record(0, 15_000, 70); // exactly on the gate
        assert_eq!(c.gates.get(&2).copied(), Some(70));
        c.record(0, 26_000, 70); // 11 s gap: gates 3 and 4 unpriced
        assert!(c.gates.get(&3).is_none() && c.gates.get(&4).is_none());
        c.record(0, 27_000, 80);
        c.record(0, 31_000, 120); // crosses 30_000 => 110
        assert_eq!(c.gates.get(&5).copied(), Some(110));
    }

    #[test]
    fn pot_split() {
        assert_eq!(split_pot(1_000, &[5, 9, 7, 1]), vec![200, 500, 300, 0]);
        assert_eq!(split_pot(1_000, &[5, 9]), vec![300, 700]);
        assert_eq!(split_pot(1_000, &[9, 9, 1]), vec![400, 400, 200]); // tie for 1st splits 50+30
        assert_eq!(split_pot(1_001, &[3, 3, 3]), vec![335, 333, 333]); // dust to first
        assert_eq!(split_pot(1_000, &[9]), vec![1_000]);
    }

    #[test]
    fn ring_wrap_and_gap() {
        let mut c = fresh();
        assert!(c.record(0, 1_000, 1));
        assert!(!c.record(0, 1_799, 2)); // B4
        assert!(c.record(0, 1_800, 3));
        for i in 0..200u64 {
            c.record(0, 2_800 + i * 1_000, 10 + i as u128);
        }
        let v = c.samples(0);
        assert_eq!(v.len(), RING);
        assert_eq!(v.last().unwrap().price, 209);
        assert_eq!(v[0].price, 209 - 127);
        assert!(v.windows(2).all(|w| w[1].ts_ms > w[0].ts_ms));
        assert_eq!(c.last(0).unwrap().price, 209);
    }

    /// 10 bps wiggle each second, spot ends mid band 1000.
    fn seeded() -> Riptide {
        let mut c = fresh();
        for i in 0..20u64 {
            c.record(0, i * 1_000, if i % 2 == 0 { SPOT } else { SPOT + SPOT / 1000 });
        }
        c.record(0, 20_000, SPOT + TICK / 2);
        ctx(20_100, 1);
        c.join_free();
        c
    }

    #[test]
    fn place_and_settle_flow() {
        let mut c = seeded();
        let b = c.board(None);
        assert_eq!((b.band0, b.window0), (1000, 5));
        assert_eq!(b.sigma_ppm as u128, c.sigma5_sq(0).isqrt());
        let q = c.quote(999, 1001, 5, None, None).expect("placeable");
        assert!(c.quote(999, 1005, 5, None, None).unwrap() < q); // wider = cheaper
        let id = c.place_chips(0, 999, 1001, 5, q, 500, None);
        assert_eq!(c.chips(0, accounts(1)), Some(START_CHIPS - 500));
        assert_eq!(c.positions(accounts(1))[0].band_hi, 1001);
        c.record(0, 25_000, SPOT + TICK);
        assert!(c.settleable(10).is_empty());
        c.settle(vec![id, 999]);
        assert_eq!(c.positions(accounts(1))[0].status, Status::Open);
        c.record(0, 30_000, SPOT + 2 * TICK - 1); // gate 5 = this sample
        assert_eq!(c.settleable(10), vec![id]);
        c.settle(vec![id]);
        assert_eq!(c.positions(accounts(1))[0].status, Status::Won);
        let after = START_CHIPS - 500 + 500 * q as u64 / 10_000;
        assert_eq!(c.chips(0, accounts(1)), Some(after));
        c.settle(vec![id]); // idempotent
        assert_eq!(c.chips(0, accounts(1)), Some(after));
        assert_eq!(c.leaderboard(0)[0].account_id, accounts(1));
    }

    #[test]
    #[should_panic(expected = "quote below minimum")]
    fn min_quote_guard() {
        let mut c = seeded();
        let q = c.quote(999, 1001, 5, None, None).unwrap();
        c.place_chips(0, 999, 1001, 5, q + 1, 100, None);
    }

    #[test]
    #[should_panic(expected = "quote below minimum")]
    fn sure_thing_rejected() {
        // flat price => sigma at floor => a 7-band gap around spot is ~certain (B1)
        let mut c = fresh();
        for i in 0..20u64 {
            c.record(0, i * 1_000, SPOT + TICK / 2);
        }
        ctx(19_100, 1);
        c.join_free();
        assert_eq!(c.quote(997, 1003, 4, None, None), None);
        c.place_chips(0, 997, 1003, 4, 0, 100, None);
    }

    #[test]
    #[should_panic(expected = "bad gap")]
    fn gap_width_cap() {
        let mut c = seeded();
        c.place_chips(0, 996, 1004, 5, 0, 100, None);
    }

    #[test]
    #[should_panic(expected = "bad gap")]
    fn gap_inverted() {
        let mut c = seeded();
        c.place_chips(0, 1003, 1002, 5, 0, 100, None);
    }

    #[test]
    #[should_panic(expected = "price stale")]
    fn stale_rejected() {
        let mut c = seeded();
        ctx(25_100, 1);
        c.place_chips(0, 1003, 1004, 6, 0, 100, None);
    }

    #[test]
    fn refund_and_pruning() {
        let mut c = seeded();
        let ids: Vec<u64> = (0..20).map(|_| c.place_chips(0, 1003, 1004, 5, 0, 10, None)).collect();
        c.record(0, 31_000, SPOT); // nothing in [25_000, 30_000]
        c.settle(ids);
        assert_eq!(c.chips(0, accounts(1)), Some(START_CHIPS));
        let pv = c.positions(accounts(1));
        assert_eq!(pv.len(), KEEP_SETTLED);
        assert!(pv.iter().all(|p| p.status == Status::Refunded));
        assert_eq!(pv[0].id, 19);
        assert!(c.positions.get(&0).is_none());
    }

    #[test]
    fn join_rebuy() {
        let mut c = fresh();
        ctx(0, 1);
        c.join_free();
        c.chips.insert(accounts(1), 50);
        c.join_free();
        assert_eq!(c.chips(0, accounts(1)), Some(START_CHIPS));
        c.chips.insert(accounts(1), 500);
        c.join_free();
        assert_eq!(c.chips(0, accounts(1)), Some(500));
        assert_eq!(c.players.len(), 1);
    }

    // ---------- cash mode ----------

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    fn pay_ctx(ms: u64, who: usize, yocto: u128) {
        testing_env!(VMContextBuilder::new()
            .block_timestamp(ms * 1_000_000)
            .predecessor_account_id(accounts(who))
            .current_account_id(accounts(0))
            .attached_deposit(NearToken::from_yoctonear(yocto))
            .build());
    }

    /// seeded() + acct1 deposits 1 NEAR, acct2 funds the vault with 10 NEAR.
    fn cash_seeded() -> Riptide {
        let mut c = seeded();
        pay_ctx(20_100, 1, NEAR + 5);
        assert_eq!(c.deposit(), 10_000);
        pay_ctx(20_100, 2, 10 * NEAR);
        assert_eq!(c.fund_vault(), 100_000);
        ctx(20_100, 1);
        c
    }

    fn total(c: &Riptide) -> u64 {
        c.vault_units + c.chips(1, accounts(1)).unwrap()
    }

    #[test]
    fn deposit_withdraw() {
        let mut c = cash_seeded();
        assert_eq!(c.chips(1, accounts(1)), Some(10_000));
        assert_eq!(c.leaderboard(1)[0].chips, 10_000);
        pay_ctx(20_200, 1, 1);
        c.withdraw(4_000);
        assert_eq!(c.chips(1, accounts(1)), Some(6_000));
        testing_env!(
            VMContextBuilder::new().current_account_id(accounts(0)).predecessor_account_id(accounts(0)).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Failed]
        );
        c.on_withdraw(accounts(1), 4_000, false); // failed transfer => restore
        assert_eq!(c.chips(1, accounts(1)), Some(10_000));
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn withdraw_insufficient() {
        let mut c = cash_seeded();
        pay_ctx(20_200, 1, 1);
        c.withdraw(10_001);
    }

    #[test]
    #[should_panic(expected = "vault below liability")]
    fn vault_withdraw_respects_liability() {
        let mut c = cash_seeded();
        c.place_chips(1, 999, 1001, 5, 0, 1_000, None);
        pay_ctx(20_200, 0, 1);
        c.vault_withdraw(c.vault_units - c.open_liability + 1);
    }

    #[test]
    fn join_free_is_session0_only() {
        let mut c = seeded(); // acct1 joined session 0
        assert_eq!(c.chips(1, accounts(1)), None);
        assert!(c.leaderboard(1).is_empty());
    }

    #[test]
    #[should_panic(expected = "join or deposit first")]
    fn cash_needs_deposit() {
        let mut c = seeded();
        c.place_chips(1, 999, 1001, 5, 0, 100, None);
    }

    #[test]
    fn cash_quotes() {
        let c = cash_seeded();
        let (q0, q1) = (c.quote(999, 1001, 5, None, None).unwrap(), c.quote(999, 1001, 5, Some(1), None).unwrap());
        assert!((q1 as u64).abs_diff(q0 as u64 * 9_700 / 10_000) <= 1, "edge 300 bps: {q0} {q1}");
        // far gap: chips quote hits 500x, cash capped at 100x
        assert_eq!(c.quote(1060, 1060, 5, Some(0), None), Some(MAX_QUOTE_BPS));
        assert_eq!(c.quote(1060, 1060, 5, Some(1), None), Some(1_000_000));
    }

    #[test]
    #[should_panic(expected = "house limit")]
    fn exposure_cap() {
        let mut c = cash_seeded();
        // cap = 100_000 * 20% = 20_000 units of liability; 1000-unit long shots at 100x = 100_000
        c.place_chips(1, 1060, 1060, 5, 0, 1_000, None);
    }

    #[test]
    fn vault_conservation() {
        let mut c = cash_seeded();
        let t0 = total(&c);
        let win = c.place_chips(1, 999, 1001, 5, 0, 1_000, None);
        let lose = c.place(1003, 1004, 5, 0, 500, None);
        let refund = c.place_chips(1, 999, 1001, 7, 0, 300, None);
        assert_eq!(total(&c), t0);
        assert_eq!(c.balance(accounts(1)), 10_000 - 1_800);
        assert!(c.open_liability > 0);
        c.record(0, 25_000, SPOT + TICK);
        c.record(0, 30_000, SPOT + TICK);
        c.record(0, 41_000, SPOT + TICK); // nothing in [35_000, 40_000]
        c.settle(vec![win, lose, refund]);
        let st: Vec<Status> = [win, lose, refund].iter().map(|i| c.positions.get(i).unwrap().status).collect();
        assert_eq!(st, vec![Status::Won, Status::Lost, Status::Refunded]);
        assert_eq!(total(&c), t0);
        assert_eq!(c.open_liability, 0);
        let qw = c.positions.get(&win).unwrap().quote_bps as u64;
        assert_eq!(c.chips(1, accounts(1)), Some(10_000 - 1_800 + 1_000 * qw / 10_000 + 300));
        // session 0 untouched
        assert_eq!(c.chips(0, accounts(1)), Some(START_CHIPS));
    }

    #[test]
    fn migrate_keeps_everything() {
        let mut c = cash_seeded();
        let id = c.place_chips(1, 999, 1001, 5, 0, 100, None);
        c.positions.flush();
        c.accts.flush();
        c.open.flush();
        c.chips.flush();
        c.players.flush();
        c.cash.flush();
        c.cash_players.flush();
        let (vault, liab) = (c.vault_units, c.open_liability);
        c.gates.flush();
        c.stats.flush();
        c.tourneys.flush();
        c.stacks.flush();
        c.prizes.flush();
        let Riptide { config, mut markets, next_id, positions, accts, open, chips, players, cash_cfg, vault_units, open_liability, cash, cash_players, gates, stats, top, tourneys, next_tourney, stacks, live, prizes, .. } = c;
        let m0 = markets.remove(0);
        let old = OldRiptide { config, ring: m0.ring, head: m0.head, next_id, positions, accts, open, chips, players, cash_cfg, vault_units, open_liability, cash, cash_players, gates, stats, top, tourneys, next_tourney, stacks, live, prizes };
        env::state_write(&old);
        let mut m = Riptide::migrate();
        assert_eq!(m.balance(accounts(1)), 10_000 - 100);
        assert_eq!((m.vault_units, m.open_liability), (vault, liab));
        assert_eq!(m.positions(accounts(1))[0].id, id);
        m.record(0, 25_000, SPOT);
        m.record(0, 30_000, SPOT);
        m.settle(vec![id]);
        assert_eq!(m.positions(accounts(1))[0].status, Status::Won);
        assert_eq!(m.leaders()[0].account_id, accounts(1));
        assert_eq!(m.stats(accounts(1)).trades, 1);
    }

    #[test]
    fn leaders_ranked_by_pnl() {
        let mut c = cash_seeded();
        let win = c.place_chips(1, 999, 1001, 5, 0, 100, None);
        pay_ctx(20_100, 3, NEAR);
        c.deposit();
        ctx(20_100, 3);
        let lose = c.place(1003, 1004, 5, 0, 200, None);
        c.record(0, 25_000, SPOT);
        c.record(0, 30_000, SPOT);
        c.settle(vec![win, lose]);
        let l = c.leaders();
        assert_eq!(l.iter().map(|r| r.account_id.clone()).collect::<Vec<_>>(), vec![accounts(1), accounts(3)]);
        assert_eq!(l[1].stats.pnl, -200);
        assert_eq!((l[0].stats.wins, l[0].stats.trades), (1, 1));
        assert!(l[0].stats.pnl > 0 && l[0].stats.best_bps > 10_000);
    }

    #[test]
    fn tourney_flow() {
        let mut c = cash_seeded(); // acct1 has 10_000 mUSD
        pay_ctx(20_100, 3, NEAR);
        c.deposit();
        pay_ctx(20_100, 4, NEAR);
        c.deposit();
        ctx(20_100, 1);
        let id = c.create_tourney(1_000, 21_000, 60_000);
        assert_eq!(id, 2);
        let t = c.tourney(id).unwrap();
        assert_eq!((t.start_ms, t.end_ms), (25_000, 85_000));
        ctx(20_200, 3);
        c.join_tourney(id);
        ctx(20_200, 4);
        c.join_tourney(id);
        assert_eq!(c.balance(accounts(4)), 9_000);
        assert_eq!(c.tourney(id).unwrap().pot, 3_000);
        // acct3 bets on window 5 (gate 30_000) and wins; acct4 loses; acct1 sits out
        c.record(0, 23_000, SPOT + TICK / 2);
        ctx(23_100, 3);
        let w = c.place_chips(id, 999, 1001, 5, 0, 1_000, None);
        ctx(23_100, 4);
        let l = c.place_chips(id, 1003, 1004, 5, 0, 1_000, None);
        c.record(0, 28_000, SPOT);
        c.record(0, 30_000, SPOT);
        c.settle(vec![w, l]);
        assert_eq!(c.tourney(id).unwrap().open, 0);
        ctx(85_000, 2);
        c.settle_tourney(id);
        let t = c.tourney(id).unwrap();
        assert!(t.settled);
        assert_eq!(t.players.iter().map(|p| (p.account_id.clone(), p.prize)).collect::<Vec<_>>(), vec![(accounts(3), 1_500), (accounts(1), 900), (accounts(4), 600)]);
        assert_eq!(c.balance(accounts(3)), 9_000 + 1_500);
        assert_eq!(c.stats(accounts(4)).pnl, -400);
        assert!(c.tourneys_live().is_empty());
        assert_eq!(c.vault_units, 100_000); // tournaments never touch the vault
    }

    #[test]
    #[should_panic(expected = "already started")]
    fn tourney_late_join() {
        let mut c = cash_seeded();
        let id = c.create_tourney(0, 21_000, 60_000);
        ctx(25_000, 3);
        c.join_tourney(id);
    }

    #[test]
    #[should_panic(expected = "outside tournament")]
    fn tourney_bet_past_bell() {
        let mut c = cash_seeded();
        let id = c.create_tourney(0, 21_000, 60_000);
        c.record(0, 80_000, SPOT);
        ctx(80_100, 1);
        c.place_chips(id, 999, 1001, 17, 0, 100, None); // gate 90_000 > bell 85_000
    }

    #[test]
    fn tourney_single_player_refund() {
        let mut c = cash_seeded();
        let id = c.create_tourney(500, 21_000, 60_000);
        assert_eq!(c.balance(accounts(1)), 9_500);
        ctx(85_000, 2);
        c.settle_tourney(id);
        assert_eq!(c.balance(accounts(1)), 10_000);
    }

    #[test]
    fn second_market_is_separate() {
        let mut c = cash_seeded();
        pay_ctx(20_100, 0, 1);
        let m = c.add_market("B".into(), "pool.testnet".parse().unwrap(), 7, U128(TICK));
        assert_eq!(m, 1);
        // market 1 has its own ring: no price there yet
        assert!(c.quote(999, 1001, 5, Some(1), Some(1)).is_none());
        for i in 0..20u64 {
            c.record(1, i * 1_000, if i % 2 == 0 { 2 * SPOT } else { 2 * SPOT + SPOT / 1000 });
        }
        c.record(1, 20_000, 2 * SPOT + TICK / 2);
        ctx(20_100, 1);
        let b = c.board(Some(1));
        assert_eq!(b.band0, 2000);
        let id = c.place(1999, 2001, 5, 0, 100, Some(1));
        let same_window_m0 = c.place(999, 1001, 5, 0, 100, None);
        assert_eq!(c.positions(accounts(1))[0].market, 0);
        assert_eq!(c.positions(accounts(1))[1].market, 1);
        // market 0 gate inside its gap, market 1 gate outside its gap
        c.record(0, 25_000, SPOT);
        c.record(0, 30_000, SPOT);
        c.record(1, 30_000, 3 * SPOT);
        c.settle(vec![id, same_window_m0]);
        assert_eq!(c.positions.get(&id).unwrap().status, Status::Lost);
        assert_eq!(c.positions.get(&same_window_m0).unwrap().status, Status::Won);
        assert_eq!(c.markets().len(), 2);
    }
}
