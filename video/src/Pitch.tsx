import { loadFont as loadFredoka } from "@remotion/google-fonts/Fredoka";
import { loadFont as loadDM } from "@remotion/google-fonts/DMSans";
import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import durations from "./durations.json";
import { FPS, PAD, SCENES, type Scene } from "./script";

const { fontFamily: HEAD } = loadFredoka("normal", { weights: ["700"], subsets: ["latin"] });
const { fontFamily: BODY } = loadDM("normal", { weights: ["400", "700"], subsets: ["latin"] });

const C = { ink: "#16130E", ink2: "#221D15", cream: "#F6F1E3", sun: "#FFE14D", sky: "#4EC0CA", win: "#3DDC6E", hit: "#FF6B5E", muted: "#BDB5A0" };
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const audio = durations as Record<string, number>;
/** Frames per scene: its voiceover + air, but never shorter than the footage it shows. */
export const sceneFrames = (s: Scene) => Math.round(Math.max(audio[s.id] ? audio[s.id] + PAD : 0, s.seconds) * FPS);
export const totalFrames = () => SCENES.reduce((a, s) => a + sceneFrames(s), 0);

// ---- building blocks ----------------------------------------------------------

const useIn = (delay = 0, dur = 18) => {
  const f = useCurrentFrame();
  return interpolate(f, [delay, delay + dur], [0, 1], { ...clamp, easing: ease });
};

const Rise: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, children, style }) => {
  const k = useIn(delay);
  return <div style={{ opacity: k, transform: `translateY(${(1 - k) * 30}px)`, ...style }}>{children}</div>;
};

/** Bottom caption = the voiceover line, so the video works muted on X. */
const Caption: React.FC<{ text: string }> = ({ text }) => {
  const k = useIn(4, 14);
  return (
    <div style={{ position: "absolute", left: 160, right: 160, bottom: 56, display: "flex", justifyContent: "center", opacity: k }}>
      <div style={{ background: "rgba(22,19,14,0.82)", color: C.cream, fontFamily: BODY, fontSize: 32, lineHeight: 1.35, padding: "14px 26px", borderRadius: 16, textAlign: "center", maxWidth: 1500 }}>{text}</div>
    </div>
  );
};

/** A phone frame around a portrait screen recording. */
const Phone: React.FC<{ src: string; start?: number; rate?: number; height?: number }> = ({ src, start = 0, rate = 1, height = 900 }) => {
  const w = (height * 430) / 932;
  return (
    <div style={{ width: w + 28, height: height + 28, borderRadius: 54, background: "#0b0a07", padding: 14, boxShadow: "0 40px 90px rgba(0,0,0,0.45)" }}>
      <div style={{ width: w, height, borderRadius: 42, overflow: "hidden" }}>
        <Video src={staticFile(src)} trimBefore={Math.round(start * FPS)} playbackRate={rate} muted style={{ width: w, height, objectFit: "cover" }} />
      </div>
    </div>
  );
};

/** A price line drawn left to right with the bird riding its head. */
const priceY = (x: number, seed = 0) => 300 + 70 * Math.sin(x / 140 + seed) + 40 * Math.sin(x / 53 + 2 * seed) + 18 * Math.sin(x / 17);
const FlyingBird: React.FC<{ width: number; progress: number; seed?: number; color?: string; pipes?: boolean }> = ({ width, progress, seed = 0, color = C.cream, pipes = false }) => {
  const f = useCurrentFrame();
  const head = progress * width;
  const pts: string[] = [];
  for (let x = 0; x <= head; x += 6) pts.push(`${x},${priceY(x, seed).toFixed(1)}`);
  const bx = head, by = priceY(head, seed), tilt = Math.atan2(priceY(head + 6, seed) - by, 6);
  const flap = ["yellowbird-upflap", "yellowbird-midflap", "yellowbird-downflap", "yellowbird-midflap"][Math.floor(f / 5) % 4];
  return (
    <svg width={width} height={600} viewBox={`0 0 ${width} 600`} style={{ overflow: "visible" }}>
      {pipes &&
        [0.35, 0.55, 0.75, 0.95].map((p, i) => {
          // the gap a player set on each pipe; the second one is a miss so both outcomes show
          const x = p * width, gy = priceY(x, seed) + [0, 95, -10, 15][i]!, gap = 120, passed = head > x, won = Math.abs(priceY(x, seed) - gy) < gap / 2;
          const fill = passed ? (won ? C.win : C.hit) : "#73BF2E";
          return (
            <g key={i} opacity={0.95}>
              <rect x={x - 26} y={-200} width={52} height={gy - gap / 2 + 200} rx={6} fill={fill} stroke="#3b2a14" strokeWidth={4} />
              <rect x={x - 26} y={gy + gap / 2} width={52} height={800} rx={6} fill={fill} stroke="#3b2a14" strokeWidth={4} />
              <rect x={x - 26} y={gy - gap / 2} width={52} height={gap} fill="rgba(255,255,255,0.18)" />
            </g>
          );
        })}
      <polyline points={pts.join(" ")} fill="none" stroke="rgba(59,42,20,0.5)" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <image href={staticFile(`${flap}.png`)} x={bx - 34} y={by - 24} width={68} height={48} transform={`rotate(${(tilt * 180) / Math.PI} ${bx} ${by})`} style={{ imageRendering: "pixelated" }} />
    </svg>
  );
};

// ---- scenes -------------------------------------------------------------------

const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const draw = interpolate(f, [0, 3 * fps], [0, 1], { ...clamp, easing: ease });
  const strike = interpolate(f, [3.2 * fps, 3.8 * fps], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.ink, padding: 140, justifyContent: "center" }}>
      <div style={{ position: "absolute", right: 120, top: 220, opacity: 0.9 }}>
        <svg width={760} height={420}>
          {[...Array(10)].map((_, i) => <line key={i} x1={0} x2={760} y1={i * 42} y2={i * 42} stroke="rgba(255,255,255,0.06)" />)}
          <polyline
            points={[...Array(60)].map((_, i) => `${(i * 760) / 59},${210 + 120 * Math.sin(i / 4) * Math.cos(i / 9)}`).join(" ")}
            fill="none" stroke={C.sun} strokeWidth={5} strokeDasharray={2000} strokeDashoffset={2000 * (1 - draw)}
          />
          <g opacity={strike}>
            <rect x={230} y={150} width={300} height={120} rx={18} fill="rgba(22,19,14,0.9)" stroke={C.hit} strokeWidth={4} />
            <text x={380} y={222} textAnchor="middle" fill={C.hit} fontFamily={HEAD} fontSize={44} fontWeight={700}>server says: lost</text>
          </g>
        </svg>
      </div>
      <Rise><p style={{ fontFamily: BODY, color: C.sun, fontSize: 30, fontWeight: 700, letterSpacing: 4, margin: 0 }}>THE PROBLEM</p></Rise>
      <Rise delay={6}><h1 style={{ fontFamily: HEAD, color: C.cream, fontSize: 104, lineHeight: 1.02, margin: "20px 0", width: 900 }}>Five-second trading is a hit.</h1></Rise>
      <Rise delay={50}><p style={{ fontFamily: BODY, color: C.muted, fontSize: 44, width: 860, margin: 0 }}>The house runs it on its own servers. You can’t check a single outcome.</p></Rise>
    </AbsoluteFill>
  );
};

const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ background: C.sky }}>
      <Img src={staticFile("background-day.png")} style={{ position: "absolute", bottom: 0, width: "100%", height: 760, objectFit: "cover", imageRendering: "pixelated", opacity: 0.9 }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 260 }}>
        <FlyingBird width={1920} progress={interpolate(f, [0, durationInFrames], [0.05, 1], clamp)} pipes />
      </div>
      <div style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", transform: `scale(${0.6 + 0.4 * pop})` }}>
        <h1 style={{ fontFamily: HEAD, fontSize: 170, margin: 0, color: C.cream, WebkitTextStroke: "8px #3b2a14", paintOrder: "stroke" }}>Riptide</h1>
        <p style={{ fontFamily: BODY, fontSize: 44, fontWeight: 700, margin: "6px auto 0", color: C.cream, background: "rgba(22,19,14,0.8)", display: "inline-block", padding: "8px 24px", borderRadius: 14 }}>Flappy Bird where the bird is a live price on NEAR</p>
      </div>
    </AbsoluteFill>
  );
};

const SideNotes: React.FC<{ notes: { at: number; text: string; color?: string }[] }> = ({ notes }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, width: 700 }}>
      {notes.map((n, i) => {
        const k = interpolate(f, [n.at * FPS, n.at * FPS + 12], [0, 1], { ...clamp, easing: ease });
        const live = notes[i + 1] ? f < notes[i + 1]!.at * FPS : true;
        return (
          <div key={i} style={{ opacity: k * (live ? 1 : 0.45), transform: `translateX(${(1 - k) * 40}px)`, display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: 27, background: n.color ?? C.sun, color: C.ink, fontFamily: HEAD, fontSize: 30, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{i + 1}</div>
            <p style={{ fontFamily: HEAD, fontSize: 50, lineHeight: 1.1, color: C.cream, margin: 0 }}>{n.text}</p>
          </div>
        );
      })}
    </div>
  );
};

const PhoneScene: React.FC<{ src: string; start: number; rate?: number; title: string; notes: { at: number; text: string; color?: string }[] }> = ({ src, start, rate, title, notes }) => (
  <AbsoluteFill style={{ background: C.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 120, paddingBottom: 170 }}>
    <Rise><Phone src={src} start={start} rate={rate} height={780} /></Rise>
    <div>
      <Rise delay={4}><p style={{ fontFamily: BODY, color: C.sun, fontSize: 28, fontWeight: 700, letterSpacing: 4, margin: "0 0 30px" }}>{title}</p></Rise>
      <SideNotes notes={notes} />
    </div>
  </AbsoluteFill>
);

const Near: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const box = (x: number, label: string, sub: string, at: number, dark = false) => {
    const k = interpolate(t, [at, at + 0.5], [0, 1], { ...clamp, easing: ease });
    return (
      <g opacity={k} transform={`translate(${x} ${300 + (1 - k) * 30})`}>
        <rect width={420} height={200} rx={28} fill={dark ? C.sun : C.ink2} stroke={dark ? "#3b2a14" : "rgba(255,255,255,0.15)"} strokeWidth={3} />
        <text x={210} y={92} textAnchor="middle" fontFamily={HEAD} fontSize={44} fontWeight={700} fill={dark ? C.ink : C.cream}>{label}</text>
        <text x={210} y={142} textAnchor="middle" fontFamily={BODY} fontSize={26} fill={dark ? C.ink : C.muted}>{sub}</text>
      </g>
    );
  };
  // packets travelling along the wires: price in, bet in, payout out
  const dot = (from: number, to: number, start: number, color: string, label: string) => {
    const p = ((t - start) % 2.4) / 1.2;
    if (t < start || p > 1) return null;
    const x = from + (to - from) * p;
    return (
      <g>
        <circle cx={x} cy={400} r={14} fill={color} />
        <text x={x} y={372} textAnchor="middle" fontFamily={BODY} fontSize={24} fontWeight={700} fill={color}>{label}</text>
      </g>
    );
  };
  const facts = [
    { at: 2.5, text: "Reads the pool price itself (cross-contract call)" },
    { at: 5, text: "Prices every pipe and locks the multiplier" },
    { at: 7.5, text: "Holds the vault, settles every bet — anyone can call settle" },
    { at: 10, text: "Limited session key: zero popups mid-game" },
  ];
  return (
    <AbsoluteFill style={{ background: C.ink, padding: "110px 120px" }}>
      <Rise><p style={{ fontFamily: BODY, color: C.sun, fontSize: 28, fontWeight: 700, letterSpacing: 4, margin: 0 }}>WHY NEAR</p></Rise>
      <Rise delay={4}><h2 style={{ fontFamily: HEAD, color: C.cream, fontSize: 72, margin: "14px 0 0" }}>The contract is the house, the oracle and the referee</h2></Rise>
      <svg width={1680} height={560} style={{ position: "absolute", left: 120, top: 260 }}>
        <line x1={420} x2={630} y1={400} y2={400} stroke="rgba(255,255,255,0.25)" strokeWidth={4} strokeDasharray="10 10" />
        <line x1={1050} x2={1260} y1={400} y2={400} stroke="rgba(255,255,255,0.25)" strokeWidth={4} strokeDasharray="10 10" />
        {box(0, "Rhea pool", "wNEAR / RFT · ELIXIR · GOLD", 0.2)}
        {box(630, "riptide-6024", "NEAR contract", 0.6, true)}
        {box(1260, "Player", "browser, session key", 1.0)}
        {dot(420, 630, 1.5, C.sky, "price")}
        {dot(1260, 1050, 2.3, C.sun, "bet")}
        {dot(1050, 1260, 3.5, C.win, "payout")}
      </svg>
      <div style={{ position: "absolute", left: 120, top: 770, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 60px", width: 1680 }}>
        {facts.map((x) => {
          const k = interpolate(t, [x.at, x.at + 0.4], [0, 1], { ...clamp, easing: ease });
          return <p key={x.text} style={{ opacity: k, fontFamily: BODY, fontSize: 32, color: C.cream, margin: 0 }}><span style={{ color: C.sun }}>✓ </span>{x.text}</p>;
        })}
      </div>
    </AbsoluteFill>
  );
};

const Multi: React.FC = () => (
  <AbsoluteFill style={{ background: C.ink, alignItems: "center", paddingTop: 70 }}>
    <Rise><p style={{ fontFamily: BODY, color: C.sun, fontSize: 28, fontWeight: 700, letterSpacing: 4, margin: 0, textAlign: "center" }}>MULTIPLAYER</p></Rise>
    <Rise delay={4}><h2 style={{ fontFamily: HEAD, color: C.cream, fontSize: 64, margin: "10px 0 30px" }}>Share a link. Race on the same pipes.</h2></Rise>
    <Rise delay={8}>
      <div style={{ width: 1440, height: 810, borderRadius: 24, overflow: "hidden", boxShadow: "0 40px 90px rgba(0,0,0,0.5)", border: "3px solid rgba(255,255,255,0.12)" }}>
        <Video src={staticFile("clips/desk.mp4")} trimBefore={Math.round(4 * FPS)} playbackRate={1.6} muted style={{ width: 1440, height: 810 }} />
      </div>
    </Rise>
  </AbsoluteFill>
);

const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.ink, justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, opacity: 0.5 }}>
        <FlyingBird width={1920} progress={interpolate(f, [0, durationInFrames], [0.2, 1], clamp)} seed={2} color={C.sun} />
      </div>
      <Rise><h1 style={{ fontFamily: HEAD, color: C.cream, fontSize: 150, margin: 0 }}>Fly the price.</h1></Rise>
      <Rise delay={8}><p style={{ fontFamily: BODY, color: C.muted, fontSize: 40, margin: "16px 0 40px" }}>Live on NEAR testnet · guest play in 10 seconds · tournaments with friends</p></Rise>
      <Rise delay={16}>
        <div style={{ display: "flex", gap: 20 }}>
          <span style={{ background: C.sun, color: C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 34, padding: "14px 28px", borderRadius: 999 }}>github.com/sairammr/riptide</span>
          <span style={{ background: C.sky, color: C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 34, padding: "14px 28px", borderRadius: 999 }}>@NEARProtocol #NEARHackathon</span>
        </div>
      </Rise>
    </AbsoluteFill>
  );
};

const VIEWS: Record<string, React.FC> = {
  hook: Hook,
  intro: Intro,
  onboard: () => (
    <PhoneScene src="clips/onboard.mp4" start={0.5} title="START" notes={[{ at: 0.3, text: "Three cards explain the game" }, { at: 3.5, text: "Play as guest: $10 testnet" }, { at: 5.2, text: "No wallet, no popups" }]} />
  ),
  demo: () => (
    <PhoneScene
      src="clips/phone.mp4" start={5} rate={1.35} title="PLAY · LIVE ON TESTNET"
      notes={[
        { at: 0.5, text: "Tap where the bird will be" },
        { at: 2.5, text: "Drop — multiplier locks on-chain" },
        { at: 11.5, text: "Through the gap: +$0.59, paid instantly", color: C.win },
        { at: 18.5, text: "Again: $10.34 → $11.82", color: C.win },
        { at: 26.5, text: "Hit the pipe: stake lost", color: C.hit },
      ]}
    />
  ),
  near: Near,
  multi: Multi,
  close: Close,
};

export const Pitch: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      {SCENES.map((s) => {
        const from = at, d = sceneFrames(s);
        at += d;
        const View = VIEWS[s.id]!;
        return (
          <Sequence key={s.id} from={from} durationInFrames={d} name={s.id}>
            <View />
            <Caption text={s.say} />
            {audio[s.id] ? <Audio src={staticFile(`voiceover/${s.id}.mp3`)} /> : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
