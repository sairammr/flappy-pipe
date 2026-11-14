// Chain access: view calls over plain JSON-RPC, and silent signing with an
// app-held function-call key (see docs/SIGNING.md). Key material lives only in
// localStorage, never in the repo.
import * as fx from "./fixture";
import type { Board, Position } from "./board";

export type Vault = { cash_edge_bps: number; cash_max_quote_bps: number; max_cash_stake: number };
export type Leader = { account_id: string; pnl: number; trades: number; wins: number; best_bps: number };
export type Tourney = {
  id: number; host: string; entry: number; start_ms: number; end_ms: number; pot: number; open: number; settled: boolean;
  players: { account_id: string; chips: number; prize: number }[]; // best first
};

export const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ID || "riptide-6024.testnet";
export const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.testnet.fastnear.com";
// Public testnet RPCs rate-limit per IP (a 429 has no CORS header, so the browser sees a
// network error); fail over in order, starting from the last one that answered.
const RPCS = [RPC, "https://test.rpc.fastnear.com", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org"].filter((u, i, a) => a.indexOf(u) === i);
let good = 0;
export const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL || "";
// Modes: "demo" = local simulator with a pretend $10, no chain, no wallet; "live" = real testnet
// NEAR in the contract (deposit $10, trade, withdraw). Picked at runtime, remembered per browser.
export type Mode = "demo" | "live";
const MKEY = "riptide:mode";
export const MODE: Mode = (() => {
  try {
    const m = localStorage.getItem(MKEY);
    if (m === "demo" || m === "live") return m;
  } catch {}
  return process.env.NEXT_PUBLIC_FIXTURE === "1" ? "demo" : "live";
})();
export const FIXTURE = MODE === "demo";
export function setMode(m: Mode) {
  localStorage.setItem(MKEY, m);
  location.reload();
}
export const GAME_METHODS = ["place", "poke", "settle", "place_chips", "create_tourney", "join_tourney", "settle_tourney"];
// Money is mUSD on-chain (1 unit = $0.001). Demo rate on testnet: $10 = 1 NEAR.
export const YOCTO_PER_MUSD = 10n ** 20n;
export const DEPOSIT_MUSD = 10_000; // $10
const ALLOWANCE = "1000000000000000000000000"; // 1 NEAR
const GAS = BigInt(30e12);

// The public RPC is load-balanced over nodes at slightly different heights, so `block` pins a
// read to the height another read returned (see api.account).
async function rpc(body: string) {
  for (let i = 0; i < RPCS.length; i++) {
    const k = (good + i) % RPCS.length;
    try {
      const res = await fetch(RPCS[k]!, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (res.status === 429 || res.status >= 500) continue;
      const j = await res.json();
      good = k;
      return j;
    } catch {}
  }
  throw new Error("all RPCs busy");
}
async function viewAt<T>(method: string, args: object = {}, block?: number): Promise<{ v: T; height: number }> {
  const j = await rpc(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "query",
    params: { request_type: "call_function", ...(block ? { block_id: block } : { finality: "optimistic" }), account_id: CONTRACT, method_name: method, args_base64: btoa(JSON.stringify(args)) },
  }));
  if (j.error || j.result?.error) throw new Error(j.error?.cause?.name || j.result?.error || "rpc error");
  return { v: JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))), height: j.result.block_height };
}
const view = async <T>(method: string, args: object = {}) => (await viewAt<T>(method, args)).v;

export const api = {
  board: () => (FIXTURE ? Promise.resolve(fx.board()) : view<Board>("board")),
  positions: (account_id: string) => (FIXTURE ? Promise.resolve(fx.getPositions()) : view<Position[]>("positions", { account_id })),
  balance: (account_id: string) => (FIXTURE ? Promise.resolve(fx.getBalance()) : view<number>("balance", { account_id })),
  /** Positions and balance from the same block: a settle changes both at once, so mixing
   *  heights would count a payout twice or not at all. */
  account: async (account_id: string) => {
    if (FIXTURE) return { list: fx.getPositions(), bal: fx.getBalance(), height: Date.now() };
    const p = await viewAt<Position[]>("positions", { account_id });
    const b = await viewAt<number>("balance", { account_id }, p.height).catch(() => viewAt<number>("balance", { account_id }));
    const list = b.height === p.height ? p.v : (await viewAt<Position[]>("positions", { account_id }, b.height)).v;
    return { list, bal: b.v, height: b.height };
  },
  // Leaderboard and tournaments are on-chain only; demo has none.
  leaders: () => (FIXTURE ? Promise.resolve([] as Leader[]) : view<Leader[]>("leaders")),
  tourney: (id: number) => view<Tourney | null>("tourney", { id }),
  tourneysLive: () => (FIXTURE ? Promise.resolve([] as number[]) : view<number[]>("tourneys_live")),
  vault: () => (FIXTURE ? Promise.resolve(fx.VAULT) : view<Vault>("vault")),
};

// ---- session -------------------------------------------------------------

export type Session = { accountId: string; key: string; kind: "wallet" | "guest" };
const SKEY = `riptide:session:${MODE}`; // practice and testnet sessions never mix

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SKEY) || "null");
  } catch {
    return null;
  }
}
function saveSession(s: Session) {
  localStorage.setItem(SKEY, JSON.stringify(s));
  localStorage.setItem(`riptide:key:${s.accountId}`, s.key);
}
export function signOut() {
  localStorage.removeItem(SKEY);
  account = null;
}

/** ONE wallet approval: sign-in that adds our app-generated key as a
 *  function-call key (near-connect `addFunctionCallKey`). Every tap after is
 *  signed locally. */
export async function playWithWallet(): Promise<Session> {
  const [{ NearConnector }, { KeyPair }] = await Promise.all([import("@hot-labs/near-connect"), import("near-api-js")]);
  const kp = KeyPair.fromRandom("ed25519");
  const publicKey = kp.getPublicKey().toString();
  const connector = new NearConnector({ network: "testnet", features: { testnet: true, signInWithFunctionCallKey: true } });
  const wallet = await connector.connect({
    addFunctionCallKey: {
      contractId: CONTRACT,
      publicKey,
      allowMethods: { anyMethod: false, methodNames: GAME_METHODS },
      gasAllowance: { kind: "limited", amount: ALLOWANCE },
    },
  });
  const [acc] = await wallet.getAccounts({ network: "testnet" });
  if (!acc) throw new Error("no account");
  const s: Session = { accountId: acc.accountId, key: kp.toString(), kind: "wallet" };
  // Belt and braces: a wallet that advertises the feature but skipped the key
  // gets one AddKey tx (a second prompt, only in that broken case).
  if (!(await hasKey(acc.accountId, publicKey))) {
    await wallet.signAndSendTransaction({
      receiverId: acc.accountId,
      actions: [{ type: "AddKey", params: { publicKey, accessKey: { permission: { receiverId: CONTRACT, methodNames: GAME_METHODS, allowance: ALLOWANCE } } } }],
    });
  }
  saveSession(s);
  return s;
}

async function hasKey(accountId: string, publicKey: string) {
  for (let i = 0; i < 4; i++) {
    const r = await rpc(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey } })).catch(() => ({}));
    if (r.result && !r.result.error) return true;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  return false;
}

/** Zero approvals: faucet-funded testnet account with a full-access key held here. */
export async function playAsGuest(): Promise<Session> {
  const { KeyPair } = await import("near-api-js");
  const kp = KeyPair.fromRandom("ed25519");
  const accountId = `rt-${crypto.getRandomValues(new Uint32Array(2)).join("").slice(0, 12)}.testnet`;
  let id = accountId;
  if (!FIXTURE) {
    // The engine sponsors guests (the public faucet rate-limits): a fresh account holding this
    // browser's key and $10 of testnet NEAR, which we deposit straight into the game.
    const r = await fetch(`${ENGINE}/guest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: kp.getPublicKey().toString() }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.accountId) throw new Error(j.error ?? `guest ${r.status}`);
    id = j.accountId;
  }
  const s: Session = { accountId: id, key: kp.toString(), kind: "guest" };
  saveSession(s);
  if (!FIXTURE) await deposit(s);
  return s;
}

// ---- silent calls --------------------------------------------------------

// near-api-js 7 Account keeps a per-key NonceManager (locally incremented, so
// rapid taps don't collide) and retries on InvalidNonce after re-fetching.
let account: import("near-api-js").Account | null = null;

export async function call<T = unknown>(s: Session, method: string, args: object, deposit = 0n): Promise<T> {
  if (FIXTURE) return fx.call(method, args as Record<string, unknown>) as T;
  if (!account || account.accountId !== s.accountId) {
    const { Account, FailoverRpcProvider, JsonRpcProvider } = await import("near-api-js");
    const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url })));
    account = new Account(s.accountId, provider, s.key as `ed25519:${string}`);
  }
  return account.callFunction<T & {}>({ contractId: CONTRACT, methodName: method, args, gas: GAS, deposit }) as Promise<T>;
}

// Money in/out. A guest holds a full-access key, so these are silent. A wallet player's
// session key cannot attach NEAR, so these go through the wallet: one approval each, never
// during a trade.
async function viaWallet(method: string, args: object, deposit: string) {
  const { NearConnector } = await import("@hot-labs/near-connect");
  const wallet = await new NearConnector({ network: "testnet" }).wallet();
  await wallet.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [{ type: "FunctionCall", params: { methodName: method, args, gas: "30000000000000", deposit } }],
  });
}
export async function deposit(s: Session, musd = DEPOSIT_MUSD) {
  if (FIXTURE) return void fx.call("deposit", { musd });
  const yocto = BigInt(musd) * YOCTO_PER_MUSD;
  if (s.kind === "guest") await call(s, "deposit", {}, yocto);
  else await viaWallet("deposit", {}, yocto.toString());
}
export async function withdraw(s: Session, musd: number) {
  if (FIXTURE) return void fx.call("withdraw", { musd });
  if (s.kind === "guest") await call(s, "withdraw", { units: musd }, 1n);
  else await viaWallet("withdraw", { units: musd }, "1");
}

/** One line for the inline status, from whatever near-api-js threw. */
export function reason(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  const panic = m.match(/panicked: ([^"\n]+)/)?.[1] ?? m.match(/ExecutionError\("([^"]+)/)?.[1];
  return (panic ?? m).replace(/^Smart contract panicked: /, "").slice(0, 80);
}

export function ping() {
  if (ENGINE) fetch(`${ENGINE}/ping`).catch(() => {});
}
