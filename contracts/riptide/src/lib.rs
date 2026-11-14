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

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Riptide {
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
}

/// Layout deployed before cash mode; read once by `migrate`.
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
    balances: LookupMap<AccountId, u128>,
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
            config: Config { owner, pool_contract, pool_id, tick, edge_bps: 0 },
            ring: Vec::new(),
            head: 0,
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
        }
    }

    /// One-shot upgrade from the pre-cash layout. Keeps session 0, ring and positions.
    /// ponytail: the old yocto `balances` map (prefix "b") is abandoned, testnet smoke funds only.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let o: OldRiptide = env::state_read().unwrap_or_else(|| env::panic_str("no old state"));
        Self {
            config: o.config,
            ring: o.ring,
            head: o.head,
            next_id: o.next_id,
            positions: o.positions,
            accts: o.accts,
            open: o.open,
            chips: o.chips,
            players: o.players,
            cash_cfg: CashConfig::default(),
            vault_units: 0,
            open_liability: 0,
            cash: LookupMap::new(b"C"),
            cash_players: Vector::new(b"L"),
        }
    }

    // ---------- oracle ----------

    pub fn poke(&self) -> PromiseOrValue<()> {
        if self.last().is_some_and(|l| now_ms() < l.ts_ms + MIN_SAMPLE_GAP_MS) {
            return PromiseOrValue::Value(());
        }
        ext_pool::ext(self.config.pool_contract.clone())
            .with_static_gas(Gas::from_tgas(10))
            .get_pool(self.config.pool_id)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_pool())
            .into()
    }

    #[private]
    pub fn on_pool(&mut self, #[callback_result] pool: Result<PoolInfo, PromiseError>) -> bool {
        let Ok(pool) = pool else { return false };
        if pool.amounts.len() < 2 {
            return false;
        }
        match pool_price(pool.amounts[0].0, pool.amounts[1].0) {
            Some(p) => self.record(now_ms(), p),
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
    ) -> u64 {
        require!(session_id <= 1, "unknown session");
        let max = if session_id == 1 { self.cash_cfg.max_cash_stake } else { MAX_CHIPS_PER_TAP };
        require!(chips > 0 && chips <= max, "bad chip amount");
        let who = env::predecessor_account_id();
        let have = self.bal(session_id, &who).unwrap_or_else(|| env::panic_str("join or deposit first"));
        require!(have >= chips, "not enough chips");
        let now = now_ms();
        let w0 = now / WINDOW_MS + 1;
        require!(window_idx >= w0 && window_idx < w0 + COLUMNS, "window not placeable");
        let last = self.last().unwrap_or_else(|| env::panic_str("no price yet"));
        require!(now <= last.ts_ms + STALE_MS, "price stale");
        let (lo, hi, q) = self.range_quote(session_id, last, band_lo, band_hi, window_idx, now);
        require!(q >= MIN_QUOTE_BPS && q >= min_quote_bps, "quote below minimum");
        if session_id == 1 {
            let payout = chips * q as u64 / 10_000;
            let cap = self.vault_units as u128 * self.cash_cfg.max_exposure_bps as u128 / 10_000;
            require!((self.open_liability + payout) as u128 <= cap, "house limit");
            self.vault_units += chips;
            self.open_liability += payout;
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
        id
    }

    /// Permissionless. Unknown, already-settled and not-yet-settleable ids are skipped.
    pub fn settle(&mut self, position_ids: Vec<u64>) {
        let samples = self.samples();
        for id in position_ids {
            let Some(p) = self.positions.get(&id) else { continue };
            if p.status != Status::Open {
                continue;
            }
            let Some(outcome) = outcome(&samples, p) else { continue };
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
    pub fn place(&mut self, band_lo: i64, band_hi: i64, window_idx: u64, min_quote_bps: u32, stake: u64) -> u64 {
        self.place_chips(1, band_lo, band_hi, window_idx, min_quote_bps, stake)
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

    // ---------- owner ----------

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
        require!(env::predecessor_account_id() == self.config.owner, "owner only");
        let c = &mut self.cash_cfg;
        if let Some(v) = yocto_per_unit {
            require!(v.0 > 0, "bad yocto_per_unit");
            c.yocto_per_unit = v;
        }
        if let Some(v) = cash_edge_bps {
            require!(v < 10_000, "edge too high");
            c.cash_edge_bps = v;
        }
        if let Some(v) = max_cash_stake {
            c.max_cash_stake = v;
        }
        if let Some(v) = max_exposure_bps {
            require!(v <= 10_000, "exposure too high");
            c.max_exposure_bps = v;
        }
        if let Some(v) = cash_max_quote_bps {
            c.cash_max_quote_bps = v;
        }
        if let Some(v) = pool_contract {
            self.config.pool_contract = v;
        }
        if let Some(v) = pool_id {
            self.config.pool_id = v;
        }
        if let Some(v) = tick {
            require!(v.0 > 0, "tick must be > 0");
            self.config.tick = v;
        }
        if let Some(v) = edge_bps {
            require!(v < 10_000, "edge too high");
            self.config.edge_bps = v;
        }
    }

    // ---------- views ----------

    pub fn board(&self) -> BoardView {
        let now = now_ms();
        let samples = self.samples();
        let s5 = self.sigma5_sq();
        let last = samples.last().copied();
        let tick = self.config.tick.0;
        let band0 = last.map(|s| (s.price / tick) as i64).unwrap_or(0);
        let window0 = now / WINDOW_MS + 1;
        BoardView {
            now_ms: now,
            spot: last.map(|s| U128(s.price)),
            last_sample_ms: last.map(|s| s.ts_ms),
            sigma_bps: (s5.isqrt() / 100) as u32,
            sigma_ppm: s5.isqrt() as u64,
            tick: self.config.tick,
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
                })
            })
            .collect()
    }

    pub fn settleable(&self, limit: u32) -> Vec<u64> {
        let samples = self.samples();
        let Some(last) = samples.last() else { return vec![] };
        // ponytail: linear scan of the open set, capped; index by window if open count grows past ~500
        self.open
            .iter()
            .take(SETTLEABLE_SCAN)
            .filter(|id| self.positions.get(id).is_some_and(|p| last.ts_ms >= p.window_end_ms()))
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
        // ponytail: sorts every player per call; fine to a few thousand players
        let mut rows: Vec<LeaderRow> = players
            .iter()
            .map(|a| LeaderRow { account_id: a.clone(), chips: self.bal(session_id, a).unwrap_or(0) })
            .collect();
        rows.sort_by(|x, y| y.chips.cmp(&x.chips)); // stable: earlier join wins ties
        rows.truncate(20);
        rows
    }

    /// Current quote for a gap, or null if not placeable right now.
    pub fn quote(&self, band_lo: i64, band_hi: i64, window_idx: u64, session_id: Option<u64>) -> Option<u32> {
        let session_id = session_id.unwrap_or(0);
        let now = now_ms();
        let w0 = now / WINDOW_MS + 1;
        let last = self.last().filter(|l| now <= l.ts_ms + STALE_MS)?;
        if session_id > 1 || window_idx < w0 || window_idx >= w0 + COLUMNS || band_lo < 0 || band_lo > band_hi || band_hi - band_lo >= MAX_GAP_BANDS {
            return None;
        }
        let q = self.range_quote(session_id, last, band_lo, band_hi, window_idx, now).2;
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
            _ => None,
        }
    }

    fn set_bal(&mut self, session_id: u64, who: &AccountId, v: u64) {
        if session_id == 1 { self.cash.insert(who.clone(), v) } else { self.chips.insert(who.clone(), v) };
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

    fn range_quote(&self, session_id: u64, last: Sample, band_lo: i64, band_hi: i64, window_idx: u64, now: u64) -> (u128, u128, u32) {
        require!(band_lo >= 0, "band below zero");
        require!(band_lo <= band_hi && band_hi - band_lo < MAX_GAP_BANDS, "bad gap");
        let (lo, hi) = (self.band(band_lo).0, self.band(band_hi).1);
        let t_ms = (window_idx + 1) * WINDOW_MS - now;
        let (edge, cap) = if session_id == 1 {
            (self.cash_cfg.cash_edge_bps, self.cash_cfg.cash_max_quote_bps)
        } else {
            (self.config.edge_bps, MAX_QUOTE_BPS)
        };
        (lo, hi, quote_bps(last.price, lo, hi, self.sigma5_sq(), t_ms, edge).min(cap))
    }

    fn band(&self, b: i64) -> (u128, u128) {
        let t = self.config.tick.0;
        let lo = (b as u128).checked_mul(t).unwrap_or_else(|| env::panic_str("band overflow"));
        (lo, lo.checked_add(t).unwrap_or_else(|| env::panic_str("band overflow")))
    }

    fn last(&self) -> Option<Sample> {
        if self.ring.len() < RING {
            self.ring.last().copied()
        } else {
            Some(self.ring[(self.head as usize + RING - 1) % RING])
        }
    }

    /// Oldest first.
    fn samples(&self) -> Vec<Sample> {
        let h = self.head as usize;
        if self.ring.len() < RING {
            self.ring.clone()
        } else {
            self.ring[h..].iter().chain(self.ring[..h].iter()).copied().collect()
        }
    }

    fn sigma5_sq(&self) -> u128 {
        let s: Vec<(u64, u128)> = self.samples().iter().map(|s| (s.ts_ms, s.price)).collect();
        pricer::sigma5_sq(&s)
    }

    /// Records a sample unless within MIN_SAMPLE_GAP of the last (B4).
    fn record(&mut self, ts_ms: u64, price: u128) -> bool {
        if self.last().is_some_and(|l| ts_ms < l.ts_ms + MIN_SAMPLE_GAP_MS) {
            return false;
        }
        let s = Sample { ts_ms, price };
        if self.ring.len() < RING {
            self.ring.push(s);
        } else {
            self.ring[self.head as usize] = s;
            self.head = ((self.head as usize + 1) % RING) as u32;
        }
        true
    }
}

/// None = not settleable yet. Pass-through: every sample in [window_start, window_end]
/// must be inside [lo, hi); none => refund.
fn outcome(samples: &[Sample], p: &Position) -> Option<Status> {
    let (start, end) = (p.window_idx * WINDOW_MS, p.window_end_ms());
    if samples.last()?.ts_ms < end {
        return None;
    }
    let mut seen = false;
    for s in samples.iter().filter(|s| s.ts_ms >= start && s.ts_ms <= end) {
        if s.price < p.price_lo || s.price >= p.price_hi {
            return Some(Status::Lost);
        }
        seen = true;
    }
    Some(if seen { Status::Won } else { Status::Refunded })
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
    fn pass_through_rule() {
        // gap [110,120), window 1 = [5_000, 10_000]
        let p = pos(110, 120, 1);
        assert_eq!(outcome(&[s(0, 115), s(5_000, 115)], &p), None);
        // all inside, incl. exactly lo and the window edges; outside samples before/after ignored
        let won = [s(4_000, 200), s(5_000, 110), s(8_000, 119), s(10_000, 115), s(10_001, 500)];
        assert_eq!(outcome(&won, &p), Some(Status::Won));
        // exactly hi is outside (exclusive)
        assert_eq!(outcome(&[s(5_000, 115), s(7_000, 120), s(10_000, 115)], &p), Some(Status::Lost));
        // one dip below lo
        assert_eq!(outcome(&[s(5_000, 115), s(7_000, 109), s(10_000, 115)], &p), Some(Status::Lost));
        // no sample in window
        assert_eq!(outcome(&[s(4_000, 115), s(10_500, 115)], &p), Some(Status::Refunded));
    }

    #[test]
    fn ring_wrap_and_gap() {
        let mut c = fresh();
        assert!(c.record(1_000, 1));
        assert!(!c.record(1_799, 2)); // B4
        assert!(c.record(1_800, 3));
        for i in 0..200u64 {
            c.record(2_800 + i * 1_000, 10 + i as u128);
        }
        let v = c.samples();
        assert_eq!(v.len(), RING);
        assert_eq!(v.last().unwrap().price, 209);
        assert_eq!(v[0].price, 209 - 127);
        assert!(v.windows(2).all(|w| w[1].ts_ms > w[0].ts_ms));
        assert_eq!(c.last().unwrap().price, 209);
    }

    /// 10 bps wiggle each second, spot ends mid band 1000.
    fn seeded() -> Riptide {
        let mut c = fresh();
        for i in 0..20u64 {
            c.record(i * 1_000, if i % 2 == 0 { SPOT } else { SPOT + SPOT / 1000 });
        }
        c.record(20_000, SPOT + TICK / 2);
        ctx(20_100, 1);
        c.join_free();
        c
    }

    #[test]
    fn place_and_settle_flow() {
        let mut c = seeded();
        let b = c.board();
        assert_eq!((b.band0, b.window0), (1000, 5));
        assert_eq!(b.sigma_ppm as u128, c.sigma5_sq().isqrt());
        let q = c.quote(999, 1001, 5, None).expect("placeable");
        assert!(c.quote(999, 1005, 5, None).unwrap() < q); // wider = cheaper
        let id = c.place_chips(0, 999, 1001, 5, q, 500);
        assert_eq!(c.chips(0, accounts(1)), Some(START_CHIPS - 500));
        assert_eq!(c.positions(accounts(1))[0].band_hi, 1001);
        c.record(25_000, SPOT + TICK);
        assert!(c.settleable(10).is_empty());
        c.settle(vec![id, 999]);
        assert_eq!(c.positions(accounts(1))[0].status, Status::Open);
        c.record(30_000, SPOT + 2 * TICK - 1);
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
        let q = c.quote(999, 1001, 5, None).unwrap();
        c.place_chips(0, 999, 1001, 5, q + 1, 100);
    }

    #[test]
    #[should_panic(expected = "quote below minimum")]
    fn sure_thing_rejected() {
        // flat price => sigma at floor => a 7-band gap around spot is ~certain (B1)
        let mut c = fresh();
        for i in 0..20u64 {
            c.record(i * 1_000, SPOT + TICK / 2);
        }
        ctx(19_100, 1);
        c.join_free();
        assert_eq!(c.quote(997, 1003, 4, None), None);
        c.place_chips(0, 997, 1003, 4, 0, 100);
    }

    #[test]
    #[should_panic(expected = "bad gap")]
    fn gap_width_cap() {
        let mut c = seeded();
        c.place_chips(0, 996, 1004, 5, 0, 100);
    }

    #[test]
    #[should_panic(expected = "bad gap")]
    fn gap_inverted() {
        let mut c = seeded();
        c.place_chips(0, 1003, 1002, 5, 0, 100);
    }

    #[test]
    #[should_panic(expected = "price stale")]
    fn stale_rejected() {
        let mut c = seeded();
        ctx(25_100, 1);
        c.place_chips(0, 1003, 1004, 6, 0, 100);
    }

    #[test]
    fn refund_and_pruning() {
        let mut c = seeded();
        let ids: Vec<u64> = (0..20).map(|_| c.place_chips(0, 1003, 1004, 5, 0, 10)).collect();
        c.record(31_000, SPOT); // nothing in [25_000, 30_000]
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
        c.place_chips(1, 999, 1001, 5, 0, 1_000);
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
        c.place_chips(1, 999, 1001, 5, 0, 100);
    }

    #[test]
    fn cash_quotes() {
        let c = cash_seeded();
        let (q0, q1) = (c.quote(999, 1001, 5, None).unwrap(), c.quote(999, 1001, 5, Some(1)).unwrap());
        assert_eq!(q1 as u64, q0 as u64 * 9_700 / 10_000 + 0 * 1, "edge 300 bps: {q0} {q1}");
        // far gap: chips quote hits 500x, cash capped at 100x
        assert_eq!(c.quote(1060, 1060, 5, Some(0)), Some(MAX_QUOTE_BPS));
        assert_eq!(c.quote(1060, 1060, 5, Some(1)), Some(1_000_000));
    }

    #[test]
    #[should_panic(expected = "house limit")]
    fn exposure_cap() {
        let mut c = cash_seeded();
        // cap = 100_000 * 20% = 20_000 units of liability; 1000-unit long shots at 100x = 100_000
        c.place_chips(1, 1060, 1060, 5, 0, 1_000);
    }

    #[test]
    fn vault_conservation() {
        let mut c = cash_seeded();
        let t0 = total(&c);
        let win = c.place_chips(1, 999, 1001, 5, 0, 1_000);
        let lose = c.place(1003, 1004, 5, 0, 500);
        let refund = c.place_chips(1, 999, 1001, 7, 0, 300);
        assert_eq!(total(&c), t0);
        assert_eq!(c.balance(accounts(1)), 10_000 - 1_800);
        assert!(c.open_liability > 0);
        c.record(25_000, SPOT + TICK);
        c.record(30_000, SPOT + TICK);
        c.record(41_000, SPOT + TICK); // nothing in [35_000, 40_000]
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
    fn migrate_keeps_session0() {
        let mut c = seeded();
        let id = c.place_chips(0, 999, 1001, 5, 0, 100);
        c.positions.flush();
        c.accts.flush();
        c.open.flush();
        c.chips.flush();
        c.players.flush();
        let Riptide { config, ring, head, next_id, positions, accts, open, chips, players, .. } = c;
        let old = OldRiptide { config, ring, head, next_id, positions, accts, open, chips, players, balances: LookupMap::new(b"b") };
        env::state_write(&old);
        let m = Riptide::migrate();
        assert_eq!(m.chips(0, accounts(1)), Some(START_CHIPS - 100));
        assert_eq!(m.positions(accounts(1))[0].id, id);
        assert_eq!(m.leaderboard(0).len(), 1);
        assert_eq!(m.vault().vault_units, 0);
        assert_eq!(m.vault().cash_edge_bps, 300);
    }
}
