"use client";
// Overlays on the Play page: onboarding and the tournament banner (lobby, live standings,
// results). Full pages live in app/leaderboard, app/multiplayer, app/wallet.
import { useEffect, useState } from "react";

import { usd } from "@/lib/board";
import { FIXTURE, type Session, type Tourney, call, reason } from "@/lib/near";

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
  { h: "The bird is the price", p: "Its height is a live Rhea (Ref) testnet pool price, read on-chain every 1–3 s. Pick a market at the top." },
  { h: "Aim the next pipe", p: "Tap where you think the bird will be, or drag the gap. − and + change its size. Narrow or far from the bird pays more." },
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

// ---- tournaments -----------------------------------------------------------

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
