"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { usd } from "@/lib/board";
import { useAccount, useSession } from "@/lib/hooks";
import { FIXTURE, type Tourney, api, call, playAsGuest, reason } from "@/lib/near";

import { short } from "../sheets";

const ENTRIES = [0, 1000, 5000, 10000];
const LENGTHS = [3, 5, 10];
const STARTS = [30, 60, 120];
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const linkOf = (id: number, m: number) => `${location.origin}/?t=${id}&m=${m}`;

export default function MultiplayerPage() {
  const qc = useQueryClient();
  const [session, setSession, ready] = useSession();
  const acct = useAccount(session?.accountId ?? "");
  const markets = useQuery({ queryKey: ["markets"], queryFn: api.markets, staleTime: 60_000 });
  const [entry, setEntry] = useState(1000);
  const [mins, setMins] = useState(3);
  const [start, setStart] = useState(60);
  const [market, setMarket] = useState(0);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [made, setMade] = useState<{ id: number; m: number } | null>(null);
  const [copied, setCopied] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const live = useQuery({
    queryKey: ["tourneys"],
    queryFn: async () => (await Promise.all((await api.tourneysLive()).map(api.tourney))).filter((t): t is Tourney => !!t),
    refetchInterval: 4000,
    enabled: !FIXTURE,
  });

  const guest = async () => {
    setBusy("guest");
    setErr("");
    try {
      setSession(await playAsGuest());
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy("");
    }
  };
  const create = async () => {
    if (!session) return;
    setBusy("create");
    setErr("");
    try {
      const id = await call<number>(session, "create_tourney", { entry, start_ms: Date.now() + start * 1000, length_ms: mins * 60_000 });
      setMade({ id, m: market });
      qc.invalidateQueries({ queryKey: ["tourneys"] });
      qc.invalidateQueries({ queryKey: ["account"] });
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy("");
    }
  };
  const join = async (t: Tourney) => {
    if (!session) return;
    setBusy(`join${t.id}`);
    setErr("");
    try {
      await call(session, "join_tourney", { id: t.id });
      qc.invalidateQueries({ queryKey: ["tourneys"] });
      qc.invalidateQueries({ queryKey: ["account"] });
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy("");
    }
  };
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {}
  };
  const bal = acct.data?.bal ?? 0;

  // Demo/Live and the session live in this browser: render after mount so server HTML matches.
  if (!ready) return <div className="page" />;
  return (
    <div className="page">
      <p className="kicker">Multiplayer</p>
      <h1>Tournaments</h1>
      <p className="body muted">Everyone pays the entry, gets 10,000 points and plays the same live pipes. Most points at the bell takes 50% of the pot, 2nd 30%, 3rd 20%. Ties split, under 2 players everyone is refunded. All of it is enforced by the contract.</p>

      {FIXTURE ? (
        <div className="panel"><p className="body">Tournaments run on-chain. Switch to <b>Live testnet</b> in the menu.</p></div>
      ) : (
        <>
          <section className="panel">
            <h2>Create a tournament</h2>
            {made ? (
              <div className="made">
                <p className="body">Tournament <b>#{made.id}</b> is open. Send this link; friends tap Join before it starts.</p>
                <div className="linkbox">
                  <code>{linkOf(made.id, made.m)}</code>
                  <button className="ghost sm" onClick={() => copy(linkOf(made.id, made.m), "made")}>{copied === "made" ? "Copied" : "Copy"}</button>
                </div>
                <div className="row gap">
                  <Link className="play" href={`/?t=${made.id}&m=${made.m}`}>Open lobby</Link>
                  <button className="link" onClick={() => setMade(null)}>Create another</button>
                </div>
              </div>
            ) : (
              <>
                <h3>Entry</h3>
                <div className="seg">{ENTRIES.map((v) => <button key={v} className={entry === v ? "on" : ""} onClick={() => setEntry(v)}>{v ? usd(v).replace(".00", "") : "Free"}</button>)}</div>
                <h3>Length</h3>
                <div className="seg">{LENGTHS.map((v) => <button key={v} className={mins === v ? "on" : ""} onClick={() => setMins(v)}>{v} min</button>)}</div>
                <h3>Starts in</h3>
                <div className="seg">{STARTS.map((v) => <button key={v} className={start === v ? "on" : ""} onClick={() => setStart(v)}>{v < 60 ? `${v} s` : `${v / 60} min`}</button>)}</div>
                <h3>Market</h3>
                <div className="seg">{(markets.data ?? []).map((m) => <button key={m.id} className={market === m.id ? "on" : ""} onClick={() => setMarket(m.id)}>{m.label.replace("wNEAR/", "")}</button>)}</div>
                {!session ? (
                  <button className="play wide" disabled={busy === "guest"} onClick={guest}>{busy === "guest" ? "Creating your guest account…" : "Play as guest to create"}</button>
                ) : entry > bal ? (
                  <p className="err">Entry is {usd(entry)} but your balance is {usd(bal)}. <Link href="/wallet">Deposit</Link> or pick a smaller entry.</p>
                ) : (
                  <button className="play wide" disabled={busy === "create"} onClick={create}>{busy === "create" ? "Creating…" : `Create · ${entry ? `${usd(entry)} entry` : "free"} · ${mins} min`}</button>
                )}
              </>
            )}
            {err && <p className="err">{err}</p>}
          </section>

          <section className="panel">
            <h2>Open now</h2>
            {!live.data ? (
              <p className="body muted">Loading…</p>
            ) : !live.data.length ? (
              <p className="body muted">None open. Create one above and share the link.</p>
            ) : (
              <ul className="tlist">
                {live.data.map((t) => {
                  const lobby = now < t.start_ms, joined = t.players.some((p) => p.account_id === session?.accountId);
                  return (
                    <li key={t.id}>
                      <div>
                        <b>#{t.id} · {t.entry ? `${usd(t.entry)} entry` : "free"} · pot {usd(t.pot)}</b>
                        <span className="muted small">
                          {t.players.length} {t.players.length === 1 ? "player" : "players"} · host {short(t.host)} ·{" "}
                          {lobby ? `starts in ${clock(t.start_ms - now)}` : now < t.end_ms ? `${clock(t.end_ms - now)} left` : "settling"}
                        </span>
                      </div>
                      <div className="row gap">
                        {lobby && !joined && session && (
                          <button className="play sm" disabled={busy === `join${t.id}` || t.entry > bal} onClick={() => join(t)}>
                            {busy === `join${t.id}` ? "…" : `Join ${t.entry ? usd(t.entry) : "free"}`}
                          </button>
                        )}
                        <button className="ghost sm" onClick={() => copy(linkOf(t.id, 0), `t${t.id}`)}>{copied === `t${t.id}` ? "Copied" : "Link"}</button>
                        <Link className="ghost sm" href={`/?t=${t.id}`}>{joined ? "Play" : "Watch"}</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
