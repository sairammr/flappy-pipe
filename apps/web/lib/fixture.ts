// Fixture mode (NEXT_PUBLIC_FIXTURE=1): a local stand-in for the contract that
// returns the exact frozen view shapes. Seeded from fixtures/board.json, then a
// random walk + the spec's pricer keep it alive so the board can be played.
import seed from "../fixtures/board.json";
import { MAX_GAP, WINDOW_MS, quoteGap, type Board, type Position, type Sample } from "./board";

const tick = Number(seed.tick);
let spot = Number(seed.spot);
let samples: { ts_ms: number; price: number }[] = [];
let last = 0;
const positions: Position[] = [];
const SIGMA_PPM = seed.sigma_bps * 100;
let balance = 0; // mUSD: 1 unit = $0.001
export const VAULT = { cash_edge_bps: 300, cash_max_quote_bps: 1_000_000, max_cash_stake: 1000 };
let nextId = 1000;


function step(now: number) {
  if (!samples.length) {
    for (let i = 64; i > 0; i--) walk(now - i * 1000);
  }
  while (now - last >= 1000) walk(last + 1000);
}
function walk(ts: number) {
  spot *= 1 + (Math.random() - 0.5) * 0.0007 + (Number(seed.spot) / spot - 1) * 0.02;
  samples.push({ ts_ms: ts, price: spot });
  if (samples.length > 128) samples.shift();
  last = ts;
}

function settle(now: number) {
  for (const p of positions) {
    if (p.status !== "Open" || now < p.window_end_ms + 1000) continue;
    // pass-through: every sample inside the window must be inside the gap
    const lo = Number(p.price_lo), hi = Number(p.price_hi);
    const path = samples.filter((s) => s.ts_ms >= p.window_start_ms && s.ts_ms <= p.window_end_ms);
    p.status = !path.length ? "Refunded" : path.every((s) => s.price >= lo && s.price < hi) ? "Won" : "Lost";
    balance += p.status === "Won" ? Math.floor((p.stake * p.quote_bps) / 1e4) : p.status === "Refunded" ? p.stake : 0;
  }
}

const big = (n: number) => BigInt(Math.round(n)).toString();

export function board(): Board {
  const now = Date.now();
  step(now);
  settle(now);
  const band0 = Math.floor(spot / tick);
  const window0 = Math.floor(now / WINDOW_MS) + 1;
  const s: Sample[] = samples.slice(-64).map((x) => ({ ts_ms: x.ts_ms, price: big(x.price) }));
  return { now_ms: now, spot: big(spot), last_sample_ms: last, sigma_ppm: SIGMA_PPM, tick: seed.tick, band0, window0, samples: s };
}

export const getPositions = (): Position[] => positions.slice().sort((a, b) => b.id - a.id);
export const getBalance = () => balance;

export function call(method: string, args: Record<string, unknown>): unknown {
  const a = args as Record<string, number>;
  if (method === "deposit") return void (balance += a.musd!);
  if (method === "withdraw") return void (balance = Math.max(0, balance - a.musd!));
  if (method !== "place") return;
  const { band_lo, band_hi, window_idx, min_quote_bps, stake } = a as Record<string, number>;
  const now = Date.now();
  if (band_lo > band_hi || band_hi - band_lo >= MAX_GAP * 2) throw new Error("bad gap");
  if (window_idx < Math.floor(now / WINDOW_MS) + 1) throw new Error("window closed");
  const q = quoteGap(spot / tick, SIGMA_PPM, band_lo, band_hi, window_idx, now, VAULT);
  if (q == null || q < min_quote_bps) throw new Error("quote moved");
  if (stake > balance) throw new Error("insufficient balance");
  balance -= stake;
  const p: Position = {
    id: nextId++, band_lo, band_hi, window_idx,
    price_lo: big(band_lo * tick), price_hi: big((band_hi + 1) * tick),
    window_start_ms: window_idx * WINDOW_MS, window_end_ms: (window_idx + 1) * WINDOW_MS,
    placed_at_ms: now, quote_bps: q, stake, session_id: 1, status: "Open",
  };
  positions.push(p);
  return p.id;
}
