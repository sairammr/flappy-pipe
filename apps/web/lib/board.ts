// Core board: frozen view types (docs/IMPLEMENTATION.md) + skin-blind geometry.
// Prices are handled in "band units" u = price / tick, so the big U128 strings
// never need BigInt math on the hot path (double precision is ample for u).

export const WINDOW_MS = 5000;
export const COLUMNS = 10;
export const ROWS = 9;

export type Sample = { ts_ms: number; price: string };
export type Board = {
  now_ms: number;
  spot: string | null;
  last_sample_ms: number | null;
  sigma_ppm: number; // per 5 s, exactly what the contract's pricer uses
  tick: string;
  band0: number;
  window0: number;
  samples: Sample[];
};
export const MAX_GAP = 4; // bands; the contract allows 8, the screen shows ~5

// Display quote for a gap [lo, hi] (bands, hi inclusive) over window `win`: the contract's
// formula (docs/IMPLEMENTATION.md "Pricer") in floats. The contract recomputes at place time;
// min_quote_bps absorbs the rounding difference.
function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  const t = 1 / (1 + 0.3275911 * x); // Abramowitz-Stegun 7.1.26
  return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
}
const phi = (z: number) => 0.5 * erfc(-z / Math.SQRT2);
export type Pricing = { cash_edge_bps: number; cash_max_quote_bps: number };
export function quoteGap(spotU: number, sigmaPpm: number, lo: number, hi: number, win: number, nowMs: number, p?: Pricing): number | null {
  const t = (win + 1) * WINDOW_MS - nowMs;
  if (t <= 0 || !spotU) return null;
  const sig = (sigmaPpm / 1e6) * Math.sqrt(t / WINDOW_MS);
  const P = Math.max(1, Math.floor((phi((hi + 1 - spotU) / spotU / sig) - phi((lo - spotU) / spotU / sig)) * 1e4));
  const q = Math.min(p?.cash_max_quote_bps ?? 5_000_000, Math.floor(((10000 - (p?.cash_edge_bps ?? 0)) * 1e4) / P));
  return q < 10500 ? null : q;
}
export type Status = "Open" | "Won" | "Lost" | "Refunded";
export type Position = {
  id: number;
  band_lo: number;
  band_hi: number; // inclusive
  window_idx: number;
  price_lo: string;
  price_hi: string;
  window_start_ms: number;
  window_end_ms: number;
  placed_at_ms: number;
  quote_bps: number;
  stake: number;
  session_id: number;
  status: Status;
};

// Money is mUSD everywhere: 1 unit = $0.001, so the default $0.10 trade is 100.
export const usd = (musd: number, sign = false) =>
  `${sign ? (musd < 0 ? "−" : "+") : musd < 0 ? "−" : ""}$${(Math.abs(musd) / 1000).toFixed(2)}`;

export const toU =(price: string, tick: string) => Number(price) / Number(tick);
export const mult = (bps: number) => {
  const m = bps / 10000;
  return m >= 10 ? `${Math.floor(m)}x` : `${m.toFixed(1)}x`;
};

export type Geo = {
  w: number;
  h: number; // playfield height (ground excluded)
  nowX: number;
  nowMs: number;
  pxPerMs: number;
  rowH: number;
  midY: number;
  centerU: number;
};

// Zoomed in: ~4 future columns and ~5 bands on screen, so a gap is thumb-sized.
// The contract still accepts window0..window0+9; those just sit off the right edge.
const FUTURE_MS = 4.2 * WINDOW_MS;
const VISIBLE_ROWS = 5.5;

const MAX_COL_PX = 130; // wide screens show more pipes instead of fatter ones

export function makeGeo(w: number, h: number, nowMs: number, centerU: number): Geo {
  const nowX = Math.round(w * (w < 600 ? 0.2 : 0.25));
  const pxPerMs = Math.min((w - nowX) / FUTURE_MS, MAX_COL_PX / WINDOW_MS);
  return { w, h, nowX, nowMs, pxPerMs, rowH: h / VISIBLE_ROWS, midY: h / 2, centerU };
}

export const xOf = (g: Geo, ms: number) => g.nowX + (ms - g.nowMs) * g.pxPerMs;
export const yOf = (g: Geo, u: number) => g.midY - (u - g.centerU) * g.rowH;
export const msAt = (g: Geo, x: number) => g.nowMs + (x - g.nowX) / g.pxPerMs;
export const uAt = (g: Geo, y: number) => g.centerU + (g.midY - y) / g.rowH;

export type Rect = { x: number; y: number; w: number; h: number };


// ---- replay: what the bird does is exactly what the contract settles on ---------------

// The bird is drawn this far behind chain time, so it only ever moves between real on-chain
// samples (one lands every ~2 s and takes ~1 s more to reach the browser). It never guesses.
export const LAG_MS = 3000;

export type Pt2 = { t: number; u: number }; // sample time (ms), price in band units

/** Price at time t, straight lines between samples; holds the last one if t is past it. */
export function uAtTime(ss: Pt2[], t: number): number {
  if (!ss.length) return NaN;
  if (t <= ss[0]!.t) return ss[0]!.u;
  for (let i = 1; i < ss.length; i++) {
    const a = ss[i - 1]!, b = ss[i]!;
    if (t <= b.t) return a.u + ((b.u - a.u) * (t - a.t)) / (b.t - a.t || 1);
  }
  return ss.at(-1)!.u;
}

/** Client mirror of the contract's `outcome` (pass-through: every sample in
 *  [window_start, window_end] inside [band_lo, band_hi + 1)), plus `at`: the moment the bird
 *  visibly decides it — where its line crosses the lip on the way to the first bad sample, or
 *  the window end for a pass. null = not decided yet (or samples no longer cover the window). */
export function resolve(ss: Pt2[], p: Pick<Position, "band_lo" | "band_hi" | "window_start_ms" | "window_end_ms">): { status: Exclude<Status, "Open">; at: number } | null {
  const start = p.window_start_ms, end = p.window_end_ms, lo = p.band_lo, hi = p.band_hi + 1;
  if (!ss.length || ss[0]!.t > start) return null;
  const out = (u: number) => u < lo || u >= hi;
  let prev: Pt2 | null = null, seen = false;
  for (const s of ss) {
    if (s.t > end) break;
    if (s.t >= start) {
      if (out(s.u)) {
        let at = s.t;
        if (prev) at = out(prev.u) ? prev.t : prev.t + (((s.u < lo ? lo : hi) - prev.u) / (s.u - prev.u)) * (s.t - prev.t);
        return { status: "Lost", at: Math.max(start, at) };
      }
      seen = true;
    }
    prev = s;
  }
  if (ss.at(-1)!.t < end) return null;
  return { status: seen ? "Won" : "Refunded", at: end };
}
