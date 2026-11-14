"use client";
import { useQuery } from "@tanstack/react-query";

import { mult, usd } from "@/lib/board";
import { useSession } from "@/lib/hooks";
import { FIXTURE, api } from "@/lib/near";

import { short } from "../sheets";

export default function LeaderboardPage() {
  const [session, , ready] = useSession();
  const me = session?.accountId;
  const q = useQuery({ queryKey: ["leaders"], queryFn: api.leaders, refetchInterval: 5000 });
  const rows = q.data ?? [];
  const mine = rows.findIndex((r) => r.account_id === me);
  // Demo/Live and the session live in this browser: render after mount so server HTML matches.
  if (!ready) return <div className="page" />;
  return (
    <div className="page">
      <p className="kicker">Global · on-chain</p>
      <h1>Leaderboard</h1>
      <p className="body muted">All-time profit and loss from cash trades and tournament prizes. Kept by the contract at every settle, so nobody can edit it.</p>
      {FIXTURE ? (
        <div className="panel"><p className="body">The leaderboard lives on-chain. Switch to <b>Live testnet</b> in the menu to climb it.</p></div>
      ) : !q.data ? (
        <div className="panel"><p className="body">Loading…</p></div>
      ) : !rows.length ? (
        <div className="panel"><p className="body">No settled trades yet. Be the first.</p></div>
      ) : (
        <>
          {me && (
            <div className="panel row3">
              <div><span className="muted small">Your rank</span><b className="stat">{mine >= 0 ? `#${mine + 1}` : "—"}</b></div>
              <div><span className="muted small">Your P&amp;L</span><b className={`stat ${mine >= 0 && rows[mine]!.pnl < 0 ? "down" : "up"}`}>{mine >= 0 ? usd(rows[mine]!.pnl, true) : "—"}</b></div>
              <div><span className="muted small">Win rate</span><b className="stat">{mine >= 0 && rows[mine]!.trades ? `${Math.round((100 * rows[mine]!.wins) / rows[mine]!.trades)}%` : "—"}</b></div>
            </div>
          )}
          <table className="lb">
            <thead>
              <tr><th>#</th><th>Player</th><th className="num">P&amp;L</th><th className="num hide-sm">Wins</th><th className="num hide-sm">Win rate</th><th className="num">Best</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.account_id} className={r.account_id === me ? "me" : ""}>
                  <td>{i + 1}</td>
                  <td className="mono">{short(r.account_id)}</td>
                  <td className={`num ${r.pnl >= 0 ? "up" : "down"}`}>{usd(r.pnl, true)}</td>
                  <td className="num hide-sm">{r.wins}/{r.trades}</td>
                  <td className="num hide-sm">{r.trades ? `${Math.round((100 * r.wins) / r.trades)}%` : "—"}</td>
                  <td className="num">{r.best_bps ? mult(r.best_bps) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
