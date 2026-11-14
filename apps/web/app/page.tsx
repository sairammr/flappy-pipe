"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { type Board, type Geo, LAG_MS, MAX_GAP, type Position, type Pricing, type Status, WINDOW_MS, makeGeo, msAt, mult, quoteGap, resolve, toU, uAt, uAtTime, usd, xOf, yOf } from "@/lib/board";
import { DEPOSIT_MUSD, FIXTURE, MODE, type Session, api, call, deposit, loadSession, ping, playAsGuest, playWithWallet, reason, setMode, signOut, withdraw } from "@/lib/near";
import { Leaderboard, Onboarding, TourneyBar, Tournaments, short } from "./sheets";
import { flappy as skin } from "@/skins/flappy";
import type { Gap } from "@/skins/skin";

const STAKES = [100, 250, 500, 1000];
const TX_MS = 4500; // a Drop lands on-chain ~2-4 s after the tap; its pipe must not have started by then
// One key per bet that survives the optimistic -> on-chain id swap (Drop moves on a pipe, so
// a window never holds two of your bets with the same gap).
const keyOf = (p: Position) => `${p.window_idx}:${p.band_lo}:${p.band_hi}`;
const payOf = (p: Position) => Math.floor((p.stake * p.quote_bps) / 1e4);
// Tournament bets use the contract's session pricing: no house edge, 500x cap.
const TOURNEY_PRICING: Pricing = { cash_edge_bps: 0, cash_max_quote_bps: 5_000_000 };
const pts = (n: number, sign = false) => `${sign && n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")}`;

// The pipe you're shaping: absolute bands [lo, hi] (hi inclusive) on window `win`.
// `drag` says which part the finger holds; du/dlo/dhi are where the drag started.
type Edit = { touched: boolean; lo: number; hi: number; win: number; drag: null | "move" | "top" | "bottom"; y0: number; lo0: number; hi0: number; shownLo: number; shownHi: number };

export default function Game() {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [mounted, setMounted] = useState(false);
  const [stake, setStake] = useState(100); // $0.10, Euphoria's default trade
  const [line, setLine] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "leaders" | "tourneys">(null);
  // ?t=<id>: the board plays that tournament (session id) instead of cash (session 1).
  const [tid, setTid] = useState<number | null>(null);
  const [, setTick] = useState(0); // re-render for the drop button's live quote + optimistic balance
  const rerender = () => setTick((n) => n + 1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<Board | null>(null);
  const geoRef = useRef<Geo | null>(null);
  const offsetRef = useRef<number | null>(null);
  const stakeRef = useRef(stake);
  stakeRef.current = stake;
  const edit = useRef<Edit>({ touched: false, lo: NaN, hi: NaN, win: 0, drag: null, y0: 0, lo0: 0, hi0: 0, shownLo: NaN, shownHi: NaN });
  const pricingRef = useRef<Pricing | undefined>(undefined); // house edge + quote cap, for local quotes
  const sessRef = useRef(1); // the session the board plays: 1 = cash, >= 2 = tournament
  const fmtRef = useRef((n: number, sign?: boolean) => usd(n, sign));
  const tWinRef = useRef<{ lo: number; hi: number } | null>(null); // a tournament's first/last pipe
  const serverPos = useRef<Position[]>([]);
  const pending = useRef<Position[]>([]);
  // What each bet shows right now. A pipe is decided the instant the bird decides it on
  // screen (same rule as the contract, same samples); the chain's settle confirms it later and
  // wins any disagreement.
  const shown = useRef(new Map<string, Status>());
  // "+$0.35 Through!" / "−$0.10 Hit the pipe" rising off the bird at that instant.
  const floaters = useRef<{ text: string; sub: string; win: boolean; ms: number; u: number; t0: number }[]>([]);
  const fx = useRef({ t0: -1e9, hit: false });

  useEffect(() => {
    setMounted(true);
    const t = Number(new URLSearchParams(location.search).get("t"));
    if (t >= 2 && !FIXTURE) setTid(t);
    const s = loadSession();
    // Demo needs no sign-in: a local player with a pretend $10 exists from the first frame.
    if (!s && FIXTURE) playAsGuest().then((s) => deposit(s).then(() => setSession(s)));
    else setSession(s);
  }, []);
  useEffect(() => {
    ping();
    const t = setInterval(ping, 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!line) return;
    const t = setTimeout(() => setLine(""), 4000);
    return () => clearTimeout(t);
  }, [line]);

  const board = useQuery({ queryKey: ["board"], queryFn: api.board, refetchInterval: 1000 });
  const acct = session?.accountId ?? "";
  // Positions and balance in one query: a settle changes both, so reading them together keeps
  // the provisional payout below from being counted twice or not at all.
  const account = useQuery({
    queryKey: ["account", acct],
    // Keep the newest block's answer: a lagging node must not roll the balance back.
    queryFn: async () => {
      const r = await api.account(acct), last = qc.getQueryData<typeof r>(["account", acct]);
      return last && last.height > r.height ? last : r;
    },
    enabled: !!session,
    refetchInterval: 2000,
  });
  const balance = { data: account.data?.bal };
  const vault = useQuery({ queryKey: ["vault"], queryFn: api.vault, staleTime: 60_000 });
  const tq = useQuery({ queryKey: ["tourney", tid], queryFn: () => api.tourney(tid!), enabled: tid != null, refetchInterval: 2000 });
  const tour = tid != null ? tq.data ?? null : null;
  const myRow = tour?.players.find((p) => p.account_id === acct);
  const pricing = tid != null ? TOURNEY_PRICING : vault.data;
  const fmt = tid != null ? pts : usd;
  pricingRef.current = pricing;
  sessRef.current = tid ?? 1;
  fmtRef.current = fmt;
  tWinRef.current = tour ? { lo: tour.start_ms / WINDOW_MS, hi: tour.end_ms / WINDOW_MS - 1 } : null;
  const openTourney = (id: number | null) => {
    history.replaceState(null, "", id ? `?t=${id}` : "/");
    edit.current.win = 0; // re-aim at the first open pipe of the new session
    setTid(id);
    setSheet(null);
  };
  useEffect(() => {
    const b = board.data;
    // Another RPC node may answer from an older block; never step the board back in time.
    if (!b || (boardRef.current && b.now_ms < boardRef.current.now_ms)) return;
    boardRef.current = b;
    const target = b.now_ms - Date.now();
    const o = offsetRef.current;
    offsetRef.current = o == null || Math.abs(o - target) > 3000 ? target : o + (target - o) * 0.2;
    const e = edit.current;
    // Until you touch it, the gap rides with the bird (2 bands around it). Once you move or
    // stretch it, it stays exactly where you put it.
    if (Number.isNaN(e.lo)) (e.lo = b.band0), (e.hi = b.band0 + 1), (e.shownLo = e.lo), (e.shownHi = e.hi);
    else if (!e.touched) (e.hi += b.band0 - e.lo), (e.lo = b.band0);
    rerender();
  }, [board.data]);

  useEffect(() => {
    const list = account.data?.list ?? [];
    serverPos.current = list;
    const ids = new Set(list.map((p) => p.id));
    pending.current = pending.current.filter((p) => !ids.has(p.id) && (p.id < 0 || Date.now() - p.placed_at_ms < 20_000));
  }, [account.data]);

  // ---- render loop --------------------------------------------------------
  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0, frame = 0, centerU = NaN, recenter = false, view = NaN, lastT = 0;
    skin.load();
    const fit = () => {
      const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * d);
      cv.height = Math.round(r.height * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    fit();

    const draw = (tMs: number) => {
      frame++;
      const d = window.devicePixelRatio || 1, W = cv.width / d, H = cv.height / d;
      const b = boardRef.current;
      const now = Date.now() + (offsetRef.current ?? 0); // chain time: quotes, bet cut-offs
      const spotU = b?.spot ? toU(b.spot, b.tick) : 0;
      const ss = b ? b.samples.map((s) => ({ t: s.ts_ms, u: toU(s.price, b.tick) })) : [];
      // Screen time (where the bird is) runs LAG_MS behind chain time. If the next sample is
      // late it slows down instead of guessing, then catches up — the bird never jumps.
      const tNow = performance.now(), dt = Math.min(100, tNow - lastT), target = now - LAG_MS, head = ss.at(-1)?.t ?? target;
      lastT = tNow;
      if (Number.isNaN(view) || Math.abs(view - target) > 8000) view = target;
      else view += dt * (view > head ? 0.25 : view < target - 300 ? 1.3 : 1);
      // The bird replays the real samples, so it never shows a price the contract didn't see.
      const birdU = uAtTime(ss, view);
      if (!Number.isNaN(birdU) && Number.isNaN(centerU)) centerU = birdU;
      // The camera is fixed: only when the bird is about to leave the screen does it glide
      // back to centre, so pipes never drift while you're aiming.
      const off = Number.isNaN(birdU) ? 0 : birdU - centerU;
      if (Math.abs(off) > 1.8) recenter = true;
      if (recenter) (centerU += off * 0.04), (recenter = Math.abs(off) > 0.15);
      // The aimed pipe always starts after a Drop tapped now would land, else it moves on.
      const e = edit.current, tw = tWinRef.current;
      const minWin = Math.max(Math.floor((now + (FIXTURE ? 0 : TX_MS)) / WINDOW_MS) + 1, tw?.lo ?? 0);
      if (e.win < minWin) e.win = minWin;
      const g = makeGeo(W, H - skin.groundH, view, centerU);
      geoRef.current = g;
      const scroll = view * g.pxPerMs;
      // Hit: short shake + red flash. Through: green flash.
      const k = (tNow - fx.current.t0) / 350;
      ctx.save();
      if (k < 1 && fx.current.hit) ctx.translate((Math.random() - 0.5) * 12 * (1 - k), (Math.random() - 0.5) * 12 * (1 - k));
      skin.background(ctx, W, H, scroll);

      if (b && !Number.isNaN(birdU)) {
        const colW = WINDOW_MS * g.pxPerMs;
        const col = (win: number) => ({ x: xOf(g, win * WINDOW_MS), y: 0, w: colW, h: g.h });
        const gapOf = (lo: number, hi: number) => ({ y: yOf(g, hi + 1), h: (hi - lo + 1) * g.rowH });

        // Your bets: solid pipes, one per window, a gap per bet.
        const mine = new Map<number, Gap[]>();
        for (const p of [...serverPos.current, ...pending.current]) {
          if (p.session_id !== sessRef.current) continue;
          const r = resolve(ss, p);
          // Revealed when the bird gets there, never before (the chain may settle while the
          // bird is still LAG_MS behind); the chain's verdict wins once it has one.
          const due = view >= (r?.at ?? p.window_end_ms);
          const key = keyOf(p), was = shown.current.get(key);
          // Once decided on screen it stays decided, unless the chain's verdict differs.
          const status: Status = !due ? "Open" : p.status !== "Open" ? p.status : r?.status ?? (was && was !== "Open" ? was : "Open");
          shown.current.set(key, status);
          if (was === "Open" && status !== "Open") {
            const won = status === "Won", lost = status === "Lost";
            floaters.current.push({
              text: status === "Refunded" ? "refunded" : fmtRef.current(won ? payOf(p) - p.stake : -p.stake, true),
              sub: won ? skin.copy.won : lost ? skin.copy.lost : "no price in window",
              win: won, ms: view, u: birdU, t0: tNow,
            });
            if (status !== "Refunded") fx.current = { t0: tNow, hit: lost };
            if (lost) navigator.vibrate?.(60);
            rerender(); // balance shows the payout now
          }
          if (xOf(g, p.window_end_ms) < -colW) continue;
          const st = status === "Won" ? "won" : status === "Lost" ? "lost" : "open";
          const pay = payOf(p);
          const gaps = mine.get(p.window_idx) ?? [];
          gaps.push({
            ...gapOf(p.band_lo, p.band_hi), state: st,
            label: st === "won" ? fmtRef.current(pay - p.stake, true) : st === "lost" ? fmtRef.current(-p.stake, true) : mult(p.quote_bps),
            sub: st === "open" ? `win ${fmtRef.current(pay)}` : null,
          });
          mine.set(p.window_idx, gaps);
        }

        // Pipes keep spawning every 5 s like Flappy. Ones you haven't played are faint and
        // carry your current gap, so you can see the corridor you're setting up.
        e.shownLo += (e.lo - e.shownLo) * 0.35;
        e.shownHi += (e.hi - e.shownHi) * 0.35;
        const q = quoteGap(spotU, b.sigma_ppm, e.lo, e.hi, e.win, Math.min(now, b.last_sample_ms ?? now), pricingRef.current);
        for (let w = Math.floor(msAt(g, -colW) / WINDOW_MS); xOf(g, w * WINDOW_MS) < W; w++) {
          if (mine.has(w)) skin.column(ctx, col(w), mine.get(w)!, false, tMs);
          else if (w === e.win)
            skin.column(ctx, col(w), [{
              y: yOf(g, e.shownHi + 1), h: (e.shownHi - e.shownLo + 1) * g.rowH, state: q ? "aim" : "bad",
              label: q ? mult(q) : "—", sub: q ? `win ${fmtRef.current(Math.floor((stakeRef.current * q) / 1e4))}` : "too safe",
            }], false, tMs);
          else if (w > e.win && (!tw || w <= tw.hi)) skin.column(ctx, col(w), [{ ...gapOf(e.lo, e.hi), state: "aim", label: null, sub: null }], true, tMs);
        }

        const trail = ss.filter((s) => s.t < view).map((s) => ({ x: xOf(g, s.t), y: yOf(g, s.u) })).filter((p) => p.x > -20);
        skin.mover(ctx, trail, { x: g.nowX, y: yOf(g, birdU) }, frame);

        // Result pops off the bird where it happened, rises 60px and fades over 1.8 s.
        floaters.current = floaters.current.filter((f) => tNow - f.t0 < 1800);
        for (const f of floaters.current) {
          const k = (tNow - f.t0) / 1800;
          skin.pop(ctx, f.text, f.win, Math.max(60, xOf(g, f.ms)), yOf(g, f.u) - 30 - 60 * k, 1 - k * k, f.sub);
        }
      }
      skin.ground(ctx, W, H, scroll);
      ctx.restore();
      if (k < 1) {
        ctx.fillStyle = fx.current.hit ? `rgba(230,40,30,${0.28 * (1 - k)})` : `rgba(60,230,110,${0.18 * (1 - k)})`;
        ctx.fillRect(0, 0, W, H);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => (cancelAnimationFrame(raf), ro.disconnect());
  }, []);

  // ---- actions ------------------------------------------------------------
  const start = async (how: typeof playWithWallet) => {
    setBusy(true);
    try {
      setSession(await how());
    } catch (e) {
      setLine(reason(e));
    } finally {
      setBusy(false);
    }
  };

  // Shaping the pipe: grab a lip to stretch the gap, grab anywhere else to slide it.
  const onDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const g = geoRef.current, e = edit.current;
    if (!g || Number.isNaN(e.lo)) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
    const top = yOf(g, e.hi + 1), bottom = yOf(g, e.lo), grab = Math.max(22, g.rowH * 0.2);
    e.touched = true;
    e.drag = Math.abs(y - top) < grab ? "top" : Math.abs(y - bottom) < grab ? "bottom" : "move";
    e.y0 = y;
    e.lo0 = e.lo;
    e.hi0 = e.hi;
  };
  const onMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const g = geoRef.current, e = edit.current;
    if (!g || !e.drag) return;
    const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
    const dBands = Math.round((uAt(g, y) - uAt(g, e.y0)));
    if (e.drag === "move") (e.lo = e.lo0 + dBands), (e.hi = e.hi0 + dBands);
    else if (e.drag === "top") e.hi = Math.max(e.lo, Math.min(e.lo + MAX_GAP - 1, e.hi0 + dBands));
    else e.lo = Math.min(e.hi, Math.max(e.hi - MAX_GAP + 1, e.lo0 + dBands));
    rerender();
  };
  const onUp = () => void (edit.current.drag = null);

  // Drop: bet on the shaped pipe, then move on to the next pipe with the same gap, so
  // tapping Drop again plays the following pipe.
  const drop = async () => {
    const g = geoRef.current, b = boardRef.current, e = edit.current;
    if (!g || !b?.spot) return;
    if (!session) return setLine(skin.copy.signedOut);
    if (tid != null && !myRow) return setLine(tour && Date.now() < tour.start_ms ? "Join the tournament to play" : "You're watching this tournament");
    if (tWinRef.current && e.win > tWinRef.current.hi) return setLine("Bell — no more pipes in this tournament");
    if ((shownBal ?? 0) < stakeRef.current) return setLine(tid != null ? "Out of points" : "Balance too low — deposit to keep playing");
    const nowMs = Date.now() + (offsetRef.current ?? 0);
    const q = quoteGap(toU(b.spot, b.tick), b.sigma_ppm, e.lo, e.hi, e.win, Math.min(nowMs, b.last_sample_ms ?? nowMs), pricing);
    if (!q) return setLine("Gap too safe for a payout — narrow it or move it off the bird");
    const amount = stakeRef.current;
    const opt: Position = {
      id: -Math.random(), band_lo: e.lo, band_hi: e.hi, window_idx: e.win, price_lo: "", price_hi: "",
      window_start_ms: e.win * WINDOW_MS, window_end_ms: (e.win + 1) * WINDOW_MS,
      placed_at_ms: nowMs, quote_bps: q, stake: amount, session_id: tid ?? 1, status: "Open",
    };
    pending.current.push(opt);
    e.win += 1;
    rerender();
    try {
      const where = { band_lo: opt.band_lo, band_hi: opt.band_hi, window_idx: opt.window_idx, min_quote_bps: Math.floor(q * 0.85) };
      opt.id = await call<number>(session, tid != null ? "place_chips" : "place", tid != null ? { ...where, session_id: tid, chips: amount } : { ...where, stake: amount });
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["tourney"] });
    } catch (err) {
      pending.current = pending.current.filter((p) => p !== opt);
      setLine(reason(err));
    } finally {
      rerender();
    }
  };

  const sess = tid ?? 1;
  const inflight = pending.current.filter((p) => p.id < 0 && p.session_id === sess).reduce((a, p) => a + p.stake, 0);
  // Pipes the bird already decided but the chain hasn't settled yet pay out on screen at once.
  const decided = [...serverPos.current, ...pending.current.filter((p) => p.id >= 0)]
    .filter((p) => p.status === "Open" && p.session_id === sess)
    .reduce((a, p) => a + (shown.current.get(keyOf(p)) === "Won" ? payOf(p) : shown.current.get(keyOf(p)) === "Refunded" ? p.stake : 0), 0);
  const base = tid != null ? myRow?.chips : balance.data;
  const shownBal = base == null ? null : base - inflight + decided;
  const broke = tid == null && session != null && shownBal != null && shownBal < STAKES[0]!;
  const money = async (f: () => Promise<unknown>) => {
    if (!session) return;
    setBusy(true);
    try {
      await f();
      qc.invalidateQueries({ queryKey: ["account"] });
    } catch (err) {
      setLine(reason(err));
    } finally {
      setBusy(false);
    }
  };
  const offline = board.isError && !board.data;
  const b = boardRef.current, e = edit.current;
  const chainNow = Date.now() + (offsetRef.current ?? 0);
  const pipesLeft = !tWinRef.current || e.win <= tWinRef.current.hi;
  const liveQ = b?.spot && !Number.isNaN(e.lo) && pipesLeft ? quoteGap(toU(b.spot, b.tick), b.sigma_ppm, e.lo, e.hi, e.win, Math.min(chainNow, b.last_sample_ms ?? Infinity), pricing) : null;
  const mineHere = [...pending.current, ...serverPos.current].filter((p) => p.session_id === sess);

  return (
    <main className="game">
      {mounted && (
        <div className="modes" role="tablist" aria-label="Mode">
          {(["demo", "live"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={MODE === m} className={MODE === m ? "on" : ""} onClick={() => MODE !== m && setMode(m)}>
              {m === "demo" ? "Demo" : "Live"}
            </button>
          ))}
        </div>
      )}
      {mounted && (
        <div className="corner">
          <button aria-label="Leaderboard" title="Leaderboard" onClick={() => setSheet("leaders")}>🏆</button>
          <button aria-label="Tournaments" title="Play friends" onClick={() => setSheet("tourneys")}>⚔︎</button>
        </div>
      )}
      {tour && (
        <TourneyBar t={tour} now={chainNow} me={acct} session={session} onLeave={() => openTourney(null)}
          onJoined={() => qc.invalidateQueries({ queryKey: ["tourney"] })} needSession={() => setLine("Play as guest or connect a wallet first")} />
      )}
      <canvas
        ref={canvasRef}
        className="board"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      <div className="line" aria-live="polite">
        {offline ? "Board offline, retrying…" : line || (!session ? (
          <button className="link" disabled={busy} onClick={() => start(playAsGuest)}>{skin.copy.guest}</button>
        ) : mineHere.length === 0 ? skin.copy.hint : "")}
      </div>

      <section className={`drawer${drawer ? " open" : ""}`}>
        <button className="handle" aria-label="Your trades" onClick={() => setDrawer(!drawer)}><i /></button>
        <h2>{tid != null ? `Your tournament #${tid} trades` : "Your trades"}</h2>
        <ol className="trades">
          {mineHere.slice(0, 12).map((p) => {
            const st = p.status !== "Open" ? p.status : shown.current.get(keyOf(p)) ?? "Open";
            const res = st === "Won" ? fmt(payOf(p) - p.stake, true) : st === "Lost" ? fmt(-p.stake, true) : st === "Refunded" ? "refunded" : "open";
            return (
              <li key={p.id} className={st.toLowerCase()}>
                <span>{fmt(p.stake)} · {mult(p.quote_bps)} · {p.band_hi - p.band_lo + 1}-band gap</span>
                <b>{res}</b>
              </li>
            );
          })}
        </ol>
        {session && (
          <div className="money">
            <button className="link" disabled={busy} onClick={() => money(() => deposit(session))}>Deposit {usd(DEPOSIT_MUSD)}</button>
            <button className="link" disabled={busy || !balance.data} onClick={() => money(() => withdraw(session, balance.data!))}>
              Withdraw {usd(balance.data ?? 0)}
            </button>
          </div>
        )}
        {session && (
          <button className="link" onClick={() => (signOut(), setSession(null), setDrawer(false))}>
            Sign out {short(session.accountId)}
          </button>
        )}
      </section>

      <nav className="bar">
        <div className="chips">
          <b>{shownBal == null ? "—" : fmt(shownBal)}</b>
          <span>{tid != null ? "points" : mounted && FIXTURE ? "demo" : "balance"}</span>
        </div>
        <div className="stakes" role="radiogroup" aria-label="Stake">
          {STAKES.map((v) => (
            <button key={v} role="radio" aria-checked={stake === v} className={stake === v ? "on" : ""} onClick={() => setStake(v)}>
              {tid != null ? (v < 1000 ? v : "1k") : v < 1000 ? `${v / 10}¢` : usd(v).replace(".00", "")}
            </button>
          ))}
        </div>
        {session && broke ? (
          <button className="play" disabled={busy} onClick={() => money(() => deposit(session))}>{busy ? "…" : `Deposit ${usd(DEPOSIT_MUSD)}`}</button>
        ) : session ? (
          <button className="play" disabled={!liveQ || (tid != null && !myRow)} onClick={drop}>
            {liveQ ? `Drop ${mult(liveQ)}` : "Drop"}
          </button>
        ) : (
          <button className="play" disabled={busy} onClick={() => start(playWithWallet)}>{busy ? "…" : skin.copy.play}</button>
        )}
      </nav>

      <Onboarding hasSession={!!session} onGuest={() => start(playAsGuest)} onWallet={() => start(playWithWallet)} onDemo={() => !FIXTURE && setMode("demo")} />
      {sheet === "leaders" && <Leaderboard me={acct} onClose={() => setSheet(null)} />}
      {sheet === "tourneys" && (
        <Tournaments session={session} onOpen={openTourney} onClose={() => setSheet(null)} needSession={() => (setSheet(null), setLine("Play as guest or connect a wallet first"))} />
      )}
    </main>
  );
}
