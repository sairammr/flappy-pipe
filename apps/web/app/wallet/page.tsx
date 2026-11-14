"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { mult, usd } from "@/lib/board";
import { useAccount, useSession } from "@/lib/hooks";
import { CONTRACT, FIXTURE, YOCTO_PER_MUSD, deposit, nearBalance, playAsGuest, playWithWallet, reason, sendNear, withdraw } from "@/lib/near";

import { short } from "../sheets";

const AMOUNTS = [1000, 5000, 10000, 25000];
const RESERVE = 5n * 10n ** 22n; // 0.05 NEAR left on a guest account for storage + gas
const near = (yocto: bigint) => (Number(yocto / 10n ** 20n) / 1e4).toFixed(3);
const musdToNear = (m: number) => (m / 10_000).toFixed(m % 10_000 ? 2 : 0);

export default function WalletPage() {
  const qc = useQueryClient();
  const [session, setSession, ready] = useSession();
  const id = session?.accountId ?? "";
  const acct = useAccount(id);
  const outside = useQuery({ queryKey: ["near", id], queryFn: () => nearBalance(id), enabled: !!id && !FIXTURE, refetchInterval: 5000 });
  const [amount, setAmount] = useState(10000);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const bal = acct.data?.bal ?? 0;
  const guestRoom = outside.data != null ? outside.data - RESERVE : 0n; // what a guest account can still deposit
  const canDeposit = session?.kind !== "guest" || FIXTURE || BigInt(amount) * YOCTO_PER_MUSD <= guestRoom;

  const run = async (key: string, f: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await f();
      setMsg({ ok: true, text: ok });
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["near"] });
    } catch (e) {
      setMsg({ ok: false, text: reason(e) });
    } finally {
      setBusy("");
    }
  };
  const cashOut = () =>
    run("out", async () => {
      await withdraw(session!, bal);
      // Guests can forward the payout to their own wallet in the same step.
      if (session!.kind === "guest" && to.trim()) {
        const have = await nearBalance(id);
        if (have > RESERVE) await sendNear(session!, to.trim(), have - RESERVE);
      }
    }, to.trim() && session?.kind === "guest" ? `Cashed out ${usd(bal)} and sent it to ${to.trim()}.` : `Cashed out ${usd(bal)} to ${short(id)}.`);

  // Demo/Live and the session live in this browser: render after mount so server HTML matches.
  if (!ready) return <div className="page" />;
  return (
    <div className="page">
      <p className="kicker">Wallet</p>
      <h1>Your money</h1>

      {!session ? (
        <section className="panel">
          <p className="body">Sign in to get a balance. A guest gets a fresh testnet account holding $10, with no wallet and no popups.</p>
          <div className="row gap">
            <button className="play" disabled={!!busy} onClick={() => run("guest", async () => setSession(await (FIXTURE ? playAsGuest().then(async (s) => (await deposit(s), s)) : playAsGuest())), "Guest account ready with $10.")}>
              {busy === "guest" ? "Creating…" : "Play as guest — $10"}
            </button>
            {!FIXTURE && <button className="ghost" disabled={!!busy} onClick={() => run("wallet", async () => setSession(await playWithWallet()), "Wallet connected.")}>Connect NEAR wallet</button>}
          </div>
          {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
        </section>
      ) : (
        <>
          <section className="panel row3">
            <div><span className="muted small">Game balance</span><b className="stat">{acct.data ? usd(bal) : "—"}</b></div>
            {!FIXTURE && <div><span className="muted small">In your account</span><b className="stat">{outside.data != null ? `${near(outside.data)} NEAR` : "—"}</b></div>}
            <div><span className="muted small">{session.kind === "guest" ? "Guest account" : "Wallet"}</span><b className="stat mono sm">{short(id)}</b></div>
          </section>

          <section className="panel">
            <h2>Deposit</h2>
            <p className="body muted">{FIXTURE ? "Demo money: free, pretend dollars." : `$10 = 1 testnet NEAR. It moves from your account into the game contract (${CONTRACT}).`}</p>
            <div className="seg">{AMOUNTS.map((v) => <button key={v} className={amount === v ? "on" : ""} onClick={() => setAmount(v)}>{usd(v).replace(".00", "")}</button>)}</div>
            <button className="play wide" disabled={!!busy || !canDeposit} onClick={() => run("in", () => deposit(session, amount), `Deposited ${usd(amount)}.`)}>
              {busy === "in" ? "Depositing…" : `Deposit ${usd(amount)}${FIXTURE ? "" : ` · ${musdToNear(amount)} NEAR`}`}
            </button>
            {!canDeposit && <p className="muted small">Your guest account holds {near(outside.data ?? 0n)} NEAR. Send testnet NEAR to <span className="mono">{id}</span> to deposit more, or connect a wallet.</p>}
            {session.kind === "wallet" && <p className="muted small">Your wallet asks you to approve the deposit.</p>}
          </section>

          <section className="panel">
            <h2>Cash out</h2>
            <p className="body muted">Takes your whole game balance out as testnet NEAR. Open bets stay in play and pay into your balance when they settle.</p>
            {session.kind === "guest" && !FIXTURE && (
              <label className="field">
                <span className="small muted">Send it on to (optional)</span>
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="yourname.testnet" spellCheck={false} autoCapitalize="off" />
              </label>
            )}
            <button className="play wide" disabled={!!busy || bal <= 0} onClick={cashOut}>
              {busy === "out" ? "Cashing out…" : `Cash out ${usd(bal)}${FIXTURE ? "" : ` · ${musdToNear(bal)} NEAR`}`}
            </button>
            {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
          </section>

          <section className="panel">
            <h2>Recent trades</h2>
            {!acct.data?.list.length ? (
              <p className="body muted">No trades yet.</p>
            ) : (
              <table className="lb">
                <thead><tr><th>Bet</th><th className="num">Multiplier</th><th className="num">Result</th></tr></thead>
                <tbody>
                  {acct.data.list.slice(0, 16).map((p) => (
                    <tr key={p.id}>
                      <td>{p.session_id >= 2 ? `${p.stake} pts · #${p.session_id}` : usd(p.stake)}</td>
                      <td className="num">{mult(p.quote_bps)}</td>
                      <td className={`num ${p.status === "Won" ? "up" : p.status === "Lost" ? "down" : ""}`}>
                        {p.status === "Won" ? `+${p.session_id >= 2 ? Math.floor((p.stake * p.quote_bps) / 1e4) - p.stake : usd(Math.floor((p.stake * p.quote_bps) / 1e4) - p.stake)}` : p.status === "Lost" ? `−${p.session_id >= 2 ? p.stake : usd(p.stake)}` : p.status.toLowerCase()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <section className="panel">
        <h2>How the money works</h2>
        <ul className="bullets">
          <li><b>Testnet only.</b> $10 is 1 testnet NEAR. Nothing here is worth real money.</li>
          <li><b>Your balance lives in the contract.</b> Deposits and cash-outs are on-chain transfers you can see on nearblocks.</li>
          <li><b>Each Drop moves your stake to the house vault</b> and locks the multiplier. Win: the vault pays stake × multiplier into your balance.</li>
          <li><b>Limits:</b> $0.10 to $1 per pipe, up to 100x, and the vault never takes on more than 20% of itself in open bets.</li>
          <li><b>No popups while playing.</b> Guests hold their own key in this browser; wallet players approve one limited game key at sign-in.</li>
        </ul>
      </section>
    </div>
  );
}
