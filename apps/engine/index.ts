// Riptide engine: one process, four jobs (SPEC §5.11, docs/IMPLEMENTATION.md "Engine").
// Every job is a permissionless call over on-chain state, so restarting loses nothing.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, FailoverRpcProvider, JsonRpcProvider, type KeyPairString, actions } from "near-api-js";

import type { Board } from "./quote";

const env = process.env;
const RPC = env.RPC_URL ?? "https://rpc.testnet.fastnear.com";
const CONTRACT = env.CONTRACT_ID ?? "riptide-6024.testnet";
const PREFIX = env.ACCOUNT_PREFIX ?? "riptide-6024";
const REF = "ref-finance-101.testnet";
// Contract markets (see `markets()`): each is a Rhea pool with wNEAR as amounts[0].
// `size` scales the bot's swaps to the pool's depth so every market moves a few bps a swap.
const MARKETS = [
  // each pool gets a swap every ~5 s, so swaps are 2x the single-pool size to keep the birds lively
  { id: 0, pool: 0, a: "wrap.testnet", b: "rft.tokenfactory.testnet", size: 2 }, // ~1500 wNEAR deep
  { id: 1, pool: 275, a: "wrap.testnet", b: "elixir.thegame.testnet", size: 0.24 }, // ~177 wNEAR
  { id: 2, pool: 274, a: "wrap.testnet", b: "gold.thegame.testnet", size: 0.1 }, // ~70 wNEAR
];
const PORT = Number(env.PORT ?? 8787);
const ALWAYS_ON = env.ALWAYS_ON === "1";
const IDLE_AFTER_MS = 10 * 60_000;
const TGAS = 1_000_000_000_000n;

// Public testnet RPCs rate-limit (fastnear answers 429 under a 1 Hz poke + bots), so fail over.
const provider = new FailoverRpcProvider(
  [RPC, "https://test.rpc.fastnear.com", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org", "https://testnet-rpc.intea.rs"].map((url) => new JsonRpcProvider({ url })),
);

function account(id: string, envName: string): Account {
  const key =
    env[envName] ??
    JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key;
  return new Account(id, provider, key as KeyPairString);
}

const engine = account(`${PREFIX}-engine.testnet`, "ENGINE_KEY");
const bot = account(`${PREFIX}-bot.testnet`, "BOT_KEY");
const npcs = [1, 2, 3].map((i) => account(`${PREFIX}-npc${i}.testnet`, `NPC${i}_KEY`));

const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args }) as Promise<T>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0]!.slice(0, 160);

// Presence: the frontend pings while someone is on the page. Bot and NPCs only spend gas then.
let lastPing = 0;
const active = () => ALWAYS_ON || Date.now() - lastPing < IDLE_AFTER_MS;

// --- 1. poke every 2s while active (10s idle). Fire-and-forget: a poke takes 3-6s to land
// (call -> get_pool -> callback), so awaiting each one would space samples ~9s apart and make
// every bet "price stale". near-api-js hands concurrent calls increasing nonces.
async function pokeLoop() {
  for (;;) {
    // one tx, one poke action per market
    engine
      .signAndSendTransaction({ receiverId: CONTRACT, actions: MARKETS.map((m) => actions.functionCall("poke", { market: m.id }, 30n * TGAS, 0n)), waitUntil: "INCLUDED" })
      .catch((e) => console.log("poke:", short(e)));
    // 2 s: samples still land every ~2-3 s (gates need one within 10 s) at half the gas of 1 Hz
    await sleep(active() ? 2000 : 10_000);
  }
}

// --- 2. settle whatever is ready, every 2s ---
async function settleLoop() {
  for (;;) {
    try {
      const ids = await view<number[]>(CONTRACT, "settleable", { limit: 50 });
      if (ids?.length) {
        await engine.callFunction({ contractId: CONTRACT, methodName: "settle", args: { position_ids: ids }, gas: 300n * TGAS, waitUntil: "INCLUDED" });
        console.log(`settled ${ids.length}`);
      }
      // Tournaments: pay out at the bell once every bet in them is settled.
      for (const id of (await view<number[]>(CONTRACT, "tourneys_live")) ?? []) {
        const t = await view<{ end_ms: number; open: number }>(CONTRACT, "tourney", { id });
        if (t && t.open === 0 && Date.now() >= t.end_ms + 1000) {
          await engine.callFunction({ contractId: CONTRACT, methodName: "settle_tourney", args: { id }, gas: 300n * TGAS, waitUntil: "INCLUDED" });
          console.log(`tourney ${id} settled`);
        }
      }
    } catch (e) {
      console.log("settle:", short(e));
    }
    await sleep(2000);
  }
}

// --- 3. swap bot: mean-reverting random walk of real swaps on Rhea pool 0 ---
type Pool = { amounts: [string, string] };
// raw B per raw A is ~1e-11 on pool 0 (8 vs 24 decimals), so scale well past it before dividing
const poolPrice = (p: Pool) => Number((BigInt(p.amounts[1]) * 10n ** 30n) / BigInt(p.amounts[0])) / 1e30;

type Market = (typeof MARKETS)[number];
async function swap(m: Market, tokenIn: string, tokenOut: string, amountIn: bigint) {
  const msg = JSON.stringify({
    force: 0,
    actions: [{ pool_id: m.pool, token_in: tokenIn, token_out: tokenOut, amount_in: amountIn.toString(), min_amount_out: "0" }],
  });
  await bot.callFunction({
    contractId: tokenIn,
    methodName: "ft_transfer_call",
    args: { receiver_id: REF, amount: amountIn.toString(), msg },
    deposit: 1n,
    gas: 100n * TGAS,
    waitUntil: "INCLUDED",
  });
}

// One swap per tick, markets in turn: a mean-reverting random walk around each pool's start.
async function botLoop() {
  let anchors: number[] = [];
  while (!anchors.length) {
    anchors = await Promise.all(MARKETS.map(async (m) => poolPrice(await view<Pool>(REF, "get_pool", { pool_id: m.pool })))).catch((e) => (console.log("bot: anchors:", short(e)), []));
    if (!anchors.length) await sleep(3000);
  }
  console.log(`bot: anchors ${anchors.join(", ")}`);
  // Balances are read every 30 swaps or after a failed swap, not every time: public RPCs
  // rate-limit per IP, and the pool read is the one that matters.
  const bals = new Map<string, string>();
  const refresh = async () => {
    for (const t of new Set(MARKETS.flatMap((m) => [m.a, m.b]))) bals.set(t, await view<string>(t, "ft_balance_of", { account_id: bot.accountId }));
  };
  // Pools are re-read every few swaps; between reads the cached amounts are close enough to size
  // a swap and lean it back toward the anchor.
  const pools = new Map<number, Pool>();
  for (let k = 0; ; k++) {
    if (!active()) {
      await sleep(5000);
      continue;
    }
    const m = MARKETS[k % MARKETS.length]!;
    try {
      if (k % 30 === 0 || !bals.size) await refresh();
      if (k % (MARKETS.length * 4) < MARKETS.length || !pools.has(m.pool)) pools.set(m.pool, await view<Pool>(REF, "get_pool", { pool_id: m.pool }));
      const pool = pools.get(m.pool)!;
      const balA = bals.get(m.a) ?? "0", balB = bals.get(m.b) ?? "0";
      const price = poolPrice(pool);
      // Selling wNEAR pushes price (B per wNEAR) down. Lean that way when above the anchor.
      const dev = Math.log(price / anchors[m.id]!);
      const pSellA = Math.min(0.9, Math.max(0.1, 0.5 + dev * 30));
      // ponytail: fixed size band + 5% jumps; tune if the board reads too calm or too wild
      const sizeNear = m.size * (0.1 + Math.random() * 0.3) * (Math.random() < 0.05 ? 4 : 1);
      const inA = BigInt(Math.floor(sizeNear * 1e6)) * 10n ** 18n; // yocto wNEAR
      const inB = (inA * BigInt(pool.amounts[1])) / BigInt(pool.amounts[0]); // same value in raw B
      const sellA = Math.random() < pSellA;
      const [tin, tout, amt] =
        sellA && BigInt(balA) >= inA ? [m.a, m.b, inA] : !sellA && BigInt(balB) >= inB ? [m.b, m.a, inB] : BigInt(balA) >= inA ? [m.a, m.b, inA] : BigInt(balB) >= inB ? [m.b, m.a, inB] : [];
      if (!tin) bals.clear(); // cached balances ran dry: re-read next tick
      else {
        // Fire and forget, like pokes: waiting ~2 s per swap left each pool still for ~20 s.
        bals.set(tin, (BigInt(bals.get(tin) ?? "0") - (amt as bigint)).toString());
        swap(m, tin as string, tout as string, amt as bigint).catch((e) => (console.log("bot swap:", short(e)), bals.clear()));
      }
    } catch (e) {
      console.log("bot:", short(e));
      bals.clear();
    }
    await sleep(700 + Math.random() * 500);
  }
}

// --- 4. NPC players, one rule each: a gap [lo, hi] on the next pipe ---
type Gap = { lo: number; hi: number; win: number };
const rules: Record<string, (b: Board, trend: number) => Gap> = {
  // momentum: 2-band gap leaning one band the way price has been moving
  momentum: (b, trend) => ({ lo: b.band0 + (trend >= 0 ? 0 : -1), hi: b.band0 + (trend >= 0 ? 1 : 0), win: b.window0 + 1 }),
  // mean-revert: 2-band gap leaning against the recent move, a pipe further out
  revert: (b, trend) => ({ lo: b.band0 + (trend >= 0 ? -1 : 0), hi: b.band0 + (trend >= 0 ? 0 : 1), win: b.window0 + 2 }),
  // long-shot: 1-band gap two bands off the bird
  longshot: (b) => {
    const d = Math.random() < 0.5 ? 2 : -2;
    return { lo: b.band0 + d, hi: b.band0 + d, win: b.window0 + 1 };
  },
};

async function npcLoop(npc: Account, rule: string) {
  try {
    await npc.callFunction({ contractId: CONTRACT, methodName: "join_free", args: {}, waitUntil: "INCLUDED" });
  } catch (e) {
    console.log(`${rule}: join_free:`, short(e));
  }
  for (;;) {
    await sleep(4000 + Math.random() * 4000);
    if (!active()) continue;
    try {
      const [b, chips] = await Promise.all([
        view<Board>(CONTRACT, "board"),
        view<number | null>(CONTRACT, "chips", { session_id: 0, account_id: npc.accountId }),
      ]);
      if (chips === null || chips < 100) {
        await npc.callFunction({ contractId: CONTRACT, methodName: "join_free", args: {}, waitUntil: "INCLUDED" });
        continue;
      }
      const s = b.samples.slice(-6).map((x) => Number(x.price));
      const trend = s.length > 1 ? s.at(-1)! - s[0]! : 0;
      const gap = rules[rule]!(b, trend);
      const q = await view<number | null>(CONTRACT, "quote", { band_lo: gap.lo, band_hi: gap.hi, window_idx: gap.win });
      if (!q) continue;
      const stake = Math.min(chips, [100, 200, 300][Math.floor(Math.random() * 3)]!);
      await npc.callFunction({
        contractId: CONTRACT,
        methodName: "place_chips",
        args: { session_id: 0, band_lo: gap.lo, band_hi: gap.hi, window_idx: gap.win, min_quote_bps: Math.floor(q * 0.95), chips: stake },
        gas: 30n * TGAS,
        waitUntil: "INCLUDED",
      });
      console.log(`${rule}: ${stake} chips on bands ${gap.lo}..${gap.hi} window ${gap.win} @ ${(q / 1e4).toFixed(2)}x`);
    } catch (e) {
      console.log(`${rule}:`, short(e));
    }
  }
}

// Guest accounts: the public testnet faucet rate-limits (429), so the engine sponsors guests
// itself: a sub-account of the engine holding the browser's key, funded with $10 of play
// money (1 NEAR at the demo rate) plus gas. Testnet only; limited per IP.
const GUEST_NEAR = 1_250_000_000_000_000_000_000_000n; // $10 deposit + ~0.25 NEAR for gas
const GUEST_COOLDOWN_MS = Number(env.GUEST_COOLDOWN_MS ?? 10 * 60_000);
const guestsByIp = new Map<string, number>();
async function sponsorGuest(req: Request, ip: string) {
  const { publicKey } = (await req.json().catch(() => ({}))) as { publicKey?: string };
  if (!publicKey || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(publicKey)) return Response.json({ error: "bad key" }, { status: 400 });
  const last = guestsByIp.get(ip) ?? 0;
  if (Date.now() - last < GUEST_COOLDOWN_MS) return Response.json({ error: "one guest per 10 min" }, { status: 429 });
  guestsByIp.set(ip, Date.now());
  const accountId = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}.${engine.accountId}`;
  try {
    await engine.createAccount({ newAccountId: accountId, publicKey, nearToTransfer: GUEST_NEAR });
    console.log(`guest: ${accountId}`);
    return Response.json({ accountId });
  } catch (e) {
    guestsByIp.delete(ip);
    console.log("guest:", short(e));
    return Response.json({ error: short(e) }, { status: 502 });
  }
}

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
    const path = new URL(req.url).pathname;
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (path === "/guest" && req.method === "POST") {
      // Behind a tunnel/proxy every request comes from one local address; use the client's.
      const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? server.requestIP(req)?.address ?? "?";
      const r = await sponsorGuest(req, ip);
      for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
      return r;
    }
    if (path === "/ping") lastPing = Date.now();
    if (path === "/ping" || path === "/health")
      return Response.json({ active: active(), lastPing, contract: CONTRACT }, { headers });
    return new Response("not found", { status: 404, headers });
  },
});

// A public RPC hiccup must never take the engine down: every loop retries on its own.
process.on("unhandledRejection", (e) => console.log("unhandled:", short(e)));

console.log(`engine: contract ${CONTRACT}, rpc ${RPC}, http :${PORT}, always_on=${ALWAYS_ON}`);
pokeLoop();
settleLoop();
botLoop();
// NPCs play free chips (session 0), which no screen shows any more; they cost RPC calls.
if (env.NPCS === "1") {
  npcLoop(npcs[0]!, "momentum");
  npcLoop(npcs[1]!, "revert");
  npcLoop(npcs[2]!, "longshot");
}
