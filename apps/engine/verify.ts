// `bun run verify`: one full round on testnet against the live contract, printed as evidence.
// poke → board → deposit (if needed) → place → poke until the window closes → settle → balance.
// Signs as VERIFY_ACCOUNT (default riptide-6024-fund1.testnet) using VERIFY_KEY or ~/.near-credentials.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, FailoverRpcProvider, JsonRpcProvider, type KeyPairString } from "near-api-js";

import type { Board } from "./quote";

const RPC = process.env.RPC_URL ?? "https://rpc.testnet.fastnear.com";
const CONTRACT = process.env.CONTRACT_ID ?? "riptide-6024.testnet";
const ID = process.env.VERIFY_ACCOUNT ?? "riptide-6024-fund1.testnet";
const KEY =
  process.env.VERIFY_KEY ??
  JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${ID}.json`, "utf8")).private_key;

// Public testnet RPCs rate-limit (fastnear answers 429 under a 1 Hz poke + bots), so fail over.
const provider = new FailoverRpcProvider(
  [RPC, "https://test.rpc.fastnear.com", "https://near-testnet.drpc.org", "https://testnet-rpc.intea.rs"].map((url) => new JsonRpcProvider({ url })),
);
const me = new Account(ID, provider, KEY as KeyPairString);
const view = <T>(method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId: CONTRACT, method, args }) as Promise<T>;
const call = async (methodName: string, args: Record<string, unknown> = {}) => {
  const r = await me.callFunctionRaw({ contractId: CONTRACT, methodName, args, gas: 100_000_000_000_000n });
  const hash = r.transaction_outcome.id;
  console.log(`  tx ${methodName}: https://testnet.nearblocks.io/txns/${hash}`);
  return r;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Position = { id: number; status: string; quote_bps: number; stake: number; band_lo: number; band_hi: number; window_end_ms: number };

console.log(`contract ${CONTRACT} as ${ID}`);
console.log("config", await view("config"));

await call("poke");
await sleep(1200);
await call("poke");
const b = await view<Board>("board");
console.log(`board: spot ${b.spot}, sigma ${b.sigma_ppm} ppm/5s, band0 ${b.band0}, window0 ${b.window0}, ${b.samples.length} samples`);
if (!b.spot) throw new Error("no price yet: is the engine poking?");

// Real-money path: balance is mUSD (1 unit = $0.001). Top up $1 (0.1 NEAR) if below a trade.
if ((await view<number>("balance", { account_id: ID })) < 100) {
  const r = await me.callFunctionRaw({ contractId: CONTRACT, methodName: "deposit", args: {}, deposit: 10n ** 23n, gas: 30_000_000_000_000n });
  console.log(`  tx deposit: https://testnet.nearblocks.io/txns/${r.transaction_outcome.id}`);
}
// A 2-band gap around the bird on the second pipe out: roughly a coin flip, so either outcome is plausible.
const lo = b.band0, hi = b.band0 + 1, win = b.window0 + 2;
const q = await view<number | null>("quote", { band_lo: lo, band_hi: hi, window_idx: win, session_id: 1 });
if (!q) throw new Error("gap unplaceable");
const before = await view<number>("balance", { account_id: ID });
console.log(`trading $0.10 on gap ${lo}..${hi}, window ${win} at ~${(q / 1e4).toFixed(2)}x (balance ${(before / 1000).toFixed(3)})`);
await call("place", { band_lo: lo, band_hi: hi, window_idx: win, min_quote_bps: Math.floor(q * 0.8), stake: 100 });

const [pos] = await view<Position[]>("positions", { account_id: ID });
console.log(`position ${pos!.id} locked at ${(pos!.quote_bps / 1e4).toFixed(2)}x, window ends in ${((pos!.window_end_ms - Date.now()) / 1000).toFixed(1)}s`);
while (Date.now() < pos!.window_end_ms + 1500) {
  await call("poke");
  await sleep(1000);
}
await call("poke");
await call("settle", { position_ids: [pos!.id] });
const after = (await view<Position[]>("positions", { account_id: ID })).find((p) => p.id === pos!.id)!;
const bal = await view<number>("balance", { account_id: ID });
console.log(`result: ${after.status}; balance ${(before / 1000).toFixed(3)} → ${(bal / 1000).toFixed(3)}`);
console.log("house vault", await view("vault"));
if (after.status === "Open") throw new Error("position still open after settle");
console.log("verify: OK");
