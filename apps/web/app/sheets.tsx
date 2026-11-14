"use client";
// Everything around the board: onboarding, the global leaderboard, tournaments (create, lobby,
// live standings, results). The board itself lives in page.tsx.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { mult, usd } from "@/lib/board";
import { FIXTURE, type Session, type Tourney, api, call, reason } from "@/lib/near";

export const short = (id: string) => {
  const s = id.replace(/\.testnet$/, "").replace(/\.riptide-6024-engine$/, "");
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-5)}` : s;
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const pts = (n: number) => n.toLocaleString("en-US");

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

// ---- onboarding ------------------------------------------------------------

const STEPS = [
  { h: "The bird is the price", p: "Its height is the live wNEAR/RFT price on a Rhea (Ref) testnet pool, read on-chain every ~2 s." },
  { h: "Shape the next pipe", p: "Drag the gap up or down, pull its lips to stretch it. Narrow or far from the bird pays more." },
  { h: "Drop to bet", p: "If the bird is inside the gap when it reaches the pipe, you win stake × multiplier. If it hits the pipe, you lose the stake." },
];
const OKEY = "riptide:onboarded";

export function Onboarding({ onGuest, onWallet, onDemo, hasSession }: { onGuest: () => void; onWallet: () => void; onDemo: () => void; hasSession: boolean }) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(!localStorage.getItem(OKEY));
    } catch {}
  }, []);
  if (!open) return null;
  const done = () => {
    try {
      localStorage.setItem(OKEY, "1");
    } catch {}
    setOpen(false);
  };
  const s = STEPS[step]!;
  const last = step === STEPS.length - 1;
  return (
    <div className="scrim onboard">
      <section className="sheet" role="dialog" aria-label="How to play">
        <p className="kicker">{step + 1} / {STEPS.length}</p>
        <h2 className="big">{s.h}</h2>
        <p className="body">{s.p}</p>
        <div className="dots">{STEPS.map((_, i) => <i key={i} className={i === step ? "on" : ""} />)}</div>
        {!last ? (
          <div className="row">
            <button className="link" onClick={done}>Skip</button>
            <button className="play" onClick={() => setStep(step + 1)}>Next</button>
          </div>
        ) : hasSession ? (
          <button className="play wide" onClick={done}>Play</button>
        ) : (
          <div className="col">
            <button className="play wide" onClick={() => (done(), FIXTURE ? onDemo() : onGuest())}>{FIXTURE ? "Play demo ($10 pretend)" : "Play as guest — $10 testnet, no wallet"}</button>
            {!FIXTURE && <button className="ghost wide" onClick={() => (done(), onWallet())}>Connect a NEAR testnet wallet</button>}
            {!FIXTURE && <button className="link" onClick={() => (done(), onDemo())}>Practice in demo first</button>}
          </div>
        )}
      </section>
    </div>
  );
}

// ---- leaderboard -----------------------------------------------------------

export function Leaderboard({ me, onClose }: { me?: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["leaders"], queryFn: api.leaders, refetchInterval: 5000 });
  return (
    <Sheet title="Leaderboard · all-time P&L" onClose={onClose}>
      {FIXTURE ? (
        <p className="body">The leaderboard is on-chain. Switch to Live to climb it.</p>
      ) : !q.data ? (
        <p className="body">Loading…</p>
      ) : !q.data.length ? (
        <p className="body">No settled trades yet. Be the first.</p>
      ) : (
        <ol className="rank">
          {q.data.map((r, i) => (
            <li key={r.account_id} className={r.account_id === me ? "me" : ""}>
              <span className="n">{i + 1}</span>
              <span className="who">{short(r.account_id)}</span>
              <span className="meta">{r.wins}/{r.trades} · best {r.best_bps ? mult(r.best_bps) : "—"}</span>
              <b className={r.pnl >= 0 ? "up" : "down"}>{usd(r.pnl, true)}</b>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}

// ---- tournaments -----------------------------------------------------------

const ENTRIES = [0, 1000, 5000, 10000];
const LENGTHS = [3, 5, 10];

/** Create one, or join an open one. `onOpen(id)` switches the board to that tournament. */
export function Tournaments({ session, onOpen, onClose, needSession }: { session: Session | null; onOpen: (id: number) => void; onClose: () => void; needSession: () => void }) {
  const [entry, setEntry] = useState(1000);
  const [mins, setMins] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const live = useQuery({
    queryKey: ["tourneys"],
    queryFn: async () => (await Promise.all((await api.tourneysLive()).map(api.tourney))).filter((t): t is Tourney => !!t),
    refetchInterval: 4000,
  });
  const create = async () => {
    if (!session) return needSession();
    setBusy(true);
    setErr("");
    try {
      // starts in 60 s so friends have time to open the link
      const id = await call<number>(session, "create_tourney", { entry, start_ms: Date.now() + 60_000, length_ms: mins * 60_000 });
      onOpen(id);
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Tournaments" onClose={onClose}>
      {FIXTURE ? (
        <p className="body">Tournaments run on-chain. Switch to Live to play friends.</p>
      ) : (
        <>
          <p className="body">Everyone pays the entry, gets {pts(10_000)} points and plays the same live pipes. Most points at the bell takes 50% of the pot, 2nd 30%, 3rd 20%.</p>
          <h3>Entry</h3>
          <div className="seg">{ENTRIES.map((v) => <button key={v} className={entry === v ? "on" : ""} onClick={() => setEntry(v)}>{v ? usd(v).replace(".00", "") : "Free"}</button>)}</div>
          <h3>Length</h3>
          <div className="seg">{LENGTHS.map((v) => <button key={v} className={mins === v ? "on" : ""} onClick={() => setMins(v)}>{v} min</button>)}</div>
          <button className="play wide" disabled={busy} onClick={create}>{busy ? "Creating…" : `Create · starts in 1 min`}</button>
          {err && <p className="err">{err}</p>}
          <h3>Open now</h3>
          {!live.data?.length ? (
            <p className="body muted">None open. Create one and share the link.</p>
          ) : (
            <ul className="list">
              {live.data.map((t) => (
                <li key={t.id}>
                  <button onClick={() => onOpen(t.id)}>
                    <span>#{t.id} · {t.entry ? usd(t.entry) : "free"} · {t.players.length} playing</span>
                    <b>{Date.now() < t.start_ms ? `starts ${clock(t.start_ms - Date.now())}` : Date.now() < t.end_ms ? `${clock(t.end_ms - Date.now())} left` : "finishing"}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Banner over the board while you're in a tournament: lobby -> live -> results. */
export function TourneyBar({ t, now, me, session, onLeave, onJoined, needSession }: {
  t: Tourney; now: number; me?: string; session: Session | null; onLeave: () => void; onJoined: () => void; needSession: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const mine = t.players.findIndex((p) => p.account_id === me);
  const joined = mine >= 0;
  const phase = t.settled ? "done" : now < t.start_ms ? "lobby" : now < t.end_ms ? "live" : "bell";
  const join = async () => {
    if (!session) return needSession();
    setBusy(true);
    setErr("");
    try {
      await call(session, "join_tourney", { id: t.id });
      onJoined();
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?t=${t.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <>
      <div className={`tbar ${phase}`}>
        <button className="tmain" onClick={() => setOpen(true)}>
          <b>#{t.id} · pot {usd(t.pot)}</b>
          <span>
            {phase === "lobby" && `starts in ${clock(t.start_ms - now)} · ${t.players.length} in`}
            {phase === "live" && `${clock(t.end_ms - now)} left${joined ? ` · you're #${mine + 1} of ${t.players.length}` : " · watching"}`}
            {phase === "bell" && "bell! settling last pipes…"}
            {phase === "done" && (joined ? `final #${mine + 1} · won ${usd(t.players[mine]!.prize)}` : "finished")}
          </span>
        </button>
        {phase === "lobby" && !joined && <button className="play sm" disabled={busy} onClick={join}>{busy ? "…" : `Join ${t.entry ? usd(t.entry) : "free"}`}</button>}
        {phase === "lobby" && <button className="ghost sm" onClick={copy}>{copied ? "Copied" : "Link"}</button>}
        <button className="x" aria-label="Leave tournament view" onClick={onLeave}>×</button>
      </div>
      {err && <p className="terr">{err}</p>}
      {open && (
        <Sheet title={`Tournament #${t.id}`} onClose={() => setOpen(false)}>
          <p className="body">{t.entry ? `${usd(t.entry)} entry` : "Free"} · pot {usd(t.pot)} · {Math.round((t.end_ms - t.start_ms) / 60_000)} min · 50/30/20</p>
          <ol className="rank">
            {t.players.map((p, i) => (
              <li key={p.account_id} className={p.account_id === me ? "me" : ""}>
                <span className="n">{i + 1}</span>
                <span className="who">{short(p.account_id)}</span>
                <span className="meta">{pts(p.chips)} pts</span>
                <b className="up">{t.settled ? usd(p.prize) : ""}</b>
              </li>
            ))}
          </ol>
          {phase === "lobby" && <button className="ghost wide" onClick={copy}>{copied ? "Link copied" : "Copy invite link"}</button>}
        </Sheet>
      )}
    </>
  );
}
