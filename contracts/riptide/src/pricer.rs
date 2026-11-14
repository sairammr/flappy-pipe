//! Integer-only pricing. Prices are pool ratios scaled 1e36; returns are ppm.
use crate::phi::PHI2;

#[allow(clippy::all, deprecated, unexpected_cfgs, semicolon_in_expressions_from_macros)]
mod u256 {
    uint::construct_uint! {
        pub struct U256(4);
    }
}
pub use u256::U256;

pub const MIN_QUOTE_BPS: u32 = 10_500;
pub const MAX_QUOTE_BPS: u32 = 5_000_000;
pub const SIGMA_MIN_PPM: u128 = 200; // 2 bps per 5 s
pub const SIGMA_MAX_PPM: u128 = 50_000; // 500 bps per 5 s
const WINDOW_MS: u128 = 5_000;
const VOL_PAIRS: usize = 64;

/// amounts[1] * 1e36 / amounts[0]; None on zero reserve or if it does not fit u128 (B5).
pub fn pool_price(a0: u128, a1: u128) -> Option<u128> {
    if a0 == 0 || a1 == 0 {
        return None;
    }
    let p = U256::from(a1) * U256::from(10u128.pow(36)) / U256::from(a0);
    if p.is_zero() || p > U256::from(u128::MAX) {
        return None;
    }
    Some(p.as_u128())
}

/// 2*(1-Phi(z)) in bps; z is 1e4-scaled. Linear interpolation, floor 1.
pub fn phi2(z: u128) -> u32 {
    let i = (z / 500) as usize;
    if i >= 80 {
        return 1;
    }
    let (a, b) = (PHI2[i], PHI2[i + 1]);
    let f = (z % 500) as u32;
    (a - (a - b) * f / 500).max(1)
}

/// Clamped 5s-equivalent variance (ppm^2) from realized variance over the last <=64 pairs.
/// `samples` = (ts_ms, price), oldest first.
pub fn sigma5_sq(samples: &[(u64, u128)]) -> u128 {
    let (lo, hi) = (SIGMA_MIN_PPM * SIGMA_MIN_PPM, SIGMA_MAX_PPM * SIGMA_MAX_PPM);
    if samples.len() < 2 {
        return hi;
    }
    let s = &samples[samples.len().saturating_sub(VOL_PAIRS + 1)..];
    let (mut r2, mut dt) = (0u128, 0u128);
    for w in s.windows(2) {
        let (p0, p1) = (w[0].1, w[1].1);
        let r = (p0.abs_diff(p1) * 1_000_000 / p0).min(1_000_000_000_000);
        r2 += r * r;
        dt += (w[1].0 - w[0].0) as u128;
    }
    if dt == 0 {
        return hi;
    }
    (r2 * WINDOW_MS / dt).clamp(lo, hi)
}

/// 2*Phi(z) in bps for z = (edge - spot)/sigma_t, via PHI2 = 2*(1-Phi(|z|)).
fn cdf2x(edge: u128, spot: u128, sigma_t: u128) -> u32 {
    let gap = edge.abs_diff(spot);
    let ppm = (U256::from(gap) * U256::from(1_000_000u64) / U256::from(spot)).min(U256::from(u64::MAX)).as_u128();
    let t = phi2(ppm.saturating_mul(10_000) / sigma_t);
    if edge >= spot { 20_000 - t } else { t }
}

/// P(price at window_end in [lo, hi)) in bps, driftless, floor 1.
pub fn prob_bps(spot: u128, lo: u128, hi: u128, s5sq: u128, t_ms: u64) -> u32 {
    let sigma_t = (s5sq * t_ms as u128 / WINDOW_MS).isqrt().max(1);
    ((cdf2x(hi, spot, sigma_t) - cdf2x(lo, spot, sigma_t)) / 2).max(1)
}

/// Raw quote in bps (capped at MAX_QUOTE_BPS); caller rejects < MIN_QUOTE_BPS.
pub fn quote_bps(spot: u128, lo: u128, hi: u128, s5sq: u128, t_ms: u64, edge_bps: u32) -> u32 {
    let p = prob_bps(spot, lo, hi, s5sq, t_ms) as u64;
    let q = (10_000 - edge_bps.min(10_000) as u64) * 10_000 / p;
    q.min(MAX_QUOTE_BPS as u64) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phi2_edges() {
        assert_eq!(phi2(0), 10_000);
        assert_eq!(phi2(5_000), 6171);
        assert_eq!(phi2(10_000), 3173);
        assert_eq!(phi2(40_000), 1);
        assert_eq!(phi2(39_999), 1);
        assert_eq!(phi2(1_000_000), 1);
        // halfway between z=1.00 (3173) and z=1.05
        let mid = phi2(10_250);
        assert!(mid < 3173 && mid > PHI2[21]);
        // monotone non-increasing
        let mut prev = u32::MAX;
        for z in (0..45_000).step_by(37) {
            let p = phi2(z);
            assert!(p <= prev && p >= 1);
            prev = p;
        }
    }

    #[test]
    fn price_real_pool0() {
        let p = pool_price(1496987320520486836637619916, 14163247510076).unwrap();
        assert!(p > 9_460_000_000_000_000_000_000 && p < 9_462_000_000_000_000_000_000, "{p}");
        assert_eq!(pool_price(0, 5), None);
        assert_eq!(pool_price(5, 0), None);
        assert_eq!(pool_price(1, u128::MAX), None); // overflow rejected
        assert_eq!(pool_price(u128::MAX, 1), None); // rounds to zero
    }

    #[test]
    fn quote_shapes() {
        let spot = 1_000_000u128 * 1_000_000;
        let tick = spot / 1000; // 10 bps
        let s = 2_000u128 * 2_000; // 20 bps / 5 s
        let band = |lo: i128, hi: i128| ((spot as i128 + lo * tick as i128) as u128, (spot as i128 + (hi + 1) * tick as i128) as u128);
        let q = |r: (u128, u128), t| quote_bps(spot, r.0, r.1, s, t, 0);
        // wider gap => lower quote
        let (w1, w3, w5) = (q(band(-1, 0), 10_000), q(band(-2, 1), 10_000), q(band(-3, 2), 10_000));
        assert!(w1 > w3 && w3 > w5, "{w1} {w3} {w5}");
        // centred gap is cheapest for its width
        let off = q(band(1, 6), 10_000);
        assert!(off > w5, "{off} {w5}");
        // far-away gap pays more
        assert!(q(band(10, 15), 10_000) > off);
        // centred gap gets cheaper as time shrinks, off-centre gets dearer
        assert!(q(band(-3, 2), 5_000) < w5);
        assert!(q(band(10, 15), 50_000) < q(band(10, 15), 10_000));
        // extreme distance capped; whole-distribution gap ~1x (B1: rejected by caller)
        assert_eq!(q((spot * 2, spot * 3), 5_000), MAX_QUOTE_BPS);
        assert!(q((spot / 2, spot * 2), 5_000) < MIN_QUOTE_BPS);
        // probability symmetric around spot
        let a = prob_bps(spot, spot, spot + 3 * tick, s, 10_000);
        let b = prob_bps(spot, spot - 3 * tick, spot, s, 10_000);
        assert!(a.abs_diff(b) <= 1, "{a} {b}");
    }

    #[test]
    fn sigma_clamps() {
        assert_eq!(sigma5_sq(&[]), SIGMA_MAX_PPM.pow(2));
        assert_eq!(sigma5_sq(&[(0, 100)]), SIGMA_MAX_PPM.pow(2));
        let flat: Vec<_> = (0..10).map(|i| (i * 1000, 1_000_000u128)).collect();
        assert_eq!(sigma5_sq(&flat), SIGMA_MIN_PPM.pow(2));
        // +-0.1% every 1s => r=1000ppm, var/ms = 1e6/1000 => 5s var = 5e6
        let wob: Vec<_> = (0..10).map(|i| (i * 1000, if i % 2 == 0 { 1_000_000u128 } else { 1_001_000 })).collect();
        let v = sigma5_sq(&wob);
        assert!(v > 4_900_000 && v <= 5_000_000, "{v}");
    }
}
