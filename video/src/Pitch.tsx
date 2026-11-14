import { loadFont as loadFredoka } from "@remotion/google-fonts/Fredoka";
import { loadFont as loadDM } from "@remotion/google-fonts/DMSans";
import { Audio, Video } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import durations from "./durations.json";
import { FADE, FPS, PAD, SCENES, type Scene } from "./script";

const { fontFamily: HEAD } = loadFredoka("normal", { weights: ["700"], subsets: ["latin"] });
const { fontFamily: BODY } = loadDM("normal", { weights: ["400", "700"], subsets: ["latin"] });

const C = { ink: "#16130E", ink2: "#221D15", cream: "#F6F1E3", sun: "#FFE14D", sky: "#4EC0CA", win: "#3DDC6E", hit: "#FF6B5E", muted: "#BDB5A0", pipe: "#73BF2E", line: "#3b2a14" };
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const audio = durations as Record<string, number>;
/** Frames per scene: its voiceover + air, never shorter than the footage it shows. */
export const sceneFrames = (s: Scene) => Math.round(Math.max(audio[s.id] ? audio[s.id] + PAD : 0, s.seconds) * FPS);
/** Crossfades overlap neighbouring scenes, so they come off the total. */
export const totalFrames = () => SCENES.reduce((a, s) => a + sceneFrames(s), 0) - FADE * (SCENES.length - 1);

// ---- building blocks ----------------------------------------------------------

const useIn = (delay = 0, dur = 18) => interpolate(useCurrentFrame(), [delay, delay + dur], [0, 1], { ...clamp, easing: ease });
const useAt = (t: number, dur = 0.5) => interpolate(useCurrentFrame() / FPS, [t, t + dur], [0, 1], { ...clamp, easing: ease });

const Rise: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, children, style }) => {
  const k = useIn(delay);
  return <div style={{ opacity: k, transform: `translateY(${(1 - k) * 30}px)`, ...style }}>{children}</div>;
};
const Kicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Rise><p style={{ fontFamily: BODY, color: C.sun, fontSize: 28, fontWeight: 700, letterSpacing: 5, margin: 0 }}>{children}</p></Rise>
);
const Title: React.FC<{ children: React.ReactNode; size?: number; delay?: number }> = ({ children, size = 76, delay = 4 }) => (
  <Rise delay={delay}><h2 style={{ fontFamily: HEAD, color: C.cream, fontSize: size, lineHeight: 1.05, margin: "14px 0 0" }}>{children}</h2></Rise>
);

/** Bottom caption = the voiceover line, so the video works muted on X. */
const Caption: React.FC<{ text: string }> = ({ text }) => {
  const k = useIn(6, 14);
  return (
    <div style={{ position: "absolute", left: 160, right: 160, bottom: 48, display: "flex", justifyContent: "center", opacity: k }}>
      <div style={{ background: "rgba(22,19,14,0.85)", color: C.cream, fontFamily: BODY, fontSize: 30, lineHeight: 1.35, padding: "12px 26px", borderRadius: 16, textAlign: "center", maxWidth: 1500, border: "1px solid rgba(255,255,255,0.08)" }}>{text}</div>
    </div>
  );
};

/** A phone frame around a portrait screen recording. */
const Phone: React.FC<{ src: string; start?: number; rate?: number; height?: number }> = ({ src, start = 0, rate = 1, height = 780 }) => {
  const w = (height * 430) / 932;
  return (
    <div style={{ width: w + 28, height: height + 28, borderRadius: 54, background: "#0b0a07", padding: 14, boxShadow: "0 40px 90px rgba(0,0,0,0.45)", flex: "none" }}>
      <div style={{ width: w, height, borderRadius: 42, overflow: "hidden" }}>
        <Video src={staticFile(src)} trimBefore={Math.round(start * FPS)} playbackRate={rate} muted style={{ width: w, height, objectFit: "cover" }} />
      </div>
    </div>
  );
};

/** A price line drawn left to right with the flapping bird riding its head, through pipes. */
const priceY = (x: number, seed = 0) => 300 + 70 * Math.sin(x / 140 + seed) + 40 * Math.sin(x / 53 + 2 * seed) + 18 * Math.sin(x / 17);
const Flight: React.FC<{ width: number; progress: number; seed?: number; color?: string; pipes?: number[]; offsets?: number[] }> = ({ width, progress, seed = 0, color = C.cream, pipes = [], offsets = [] }) => {
  const f = useCurrentFrame();
  const head = progress * width;
  const pts: string[] = [];
  for (let x = 0; x <= head; x += 6) pts.push(`${x},${priceY(x, seed).toFixed(1)}`);
  const by = priceY(head, seed), tilt = Math.atan2(priceY(head + 6, seed) - by, 6);
  const flap = ["yellowbird-upflap", "yellowbird-midflap", "yellowbird-downflap", "yellowbird-midflap"][Math.floor(f / 5) % 4];
  return (
    <svg width={width} height={600} viewBox={`0 0 ${width} 600`} style={{ overflow: "visible" }}>
      {pipes.map((p, i) => {
        // the gap a player set on this pipe; a non-zero offset is a miss, so both outcomes show
        const x = p * width, gy = priceY(x, seed) + (offsets[i] ?? 0), gap = 120, passed = head > x, won = Math.abs(priceY(x, seed) - gy) < gap / 2;
        const fill = passed ? (won ? C.win : C.hit) : C.pipe;
        return (
          <g key={i}>
            <rect x={x - 26} y={-300} width={52} height={gy - gap / 2 + 300} rx={6} fill={fill} stroke={C.line} strokeWidth={4} />
            <rect x={x - 26} y={gy + gap / 2} width={52} height={900} rx={6} fill={fill} stroke={C.line} strokeWidth={4} />
            <rect x={x - 26} y={gy - gap / 2} width={52} height={gap} fill="rgba(255,255,255,0.2)" />
            {passed && <text x={x} y={gy - gap / 2 - 18} textAnchor="middle" fontFamily={HEAD} fontSize={34} fontWeight={700} fill={won ? C.win : C.hit} stroke={C.line} strokeWidth={6} paintOrder="stroke">{won ? "+$0.27" : "−$0.10"}</text>}
          </g>
        );
      })}
      <polyline points={pts.join(" ")} fill="none" stroke="rgba(59,42,20,0.5)" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <image href={staticFile(`${flap}.png`)} x={head - 34} y={by - 24} width={68} height={48} transform={`rotate(${(tilt * 180) / Math.PI} ${head} ${by})`} style={{ imageRendering: "pixelated" }} />
    </svg>
  );
};

const Notes: React.FC<{ notes: { at: number; text: string; color?: string }[] }> = ({ notes }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, width: 720 }}>
      {notes.map((n, i) => {
        const k = interpolate(f, [n.at * FPS, n.at * FPS + 12], [0, 1], { ...clamp, easing: ease });
        const live = notes[i + 1] ? f < notes[i + 1]!.at * FPS : true;
        return (
          <div key={i} style={{ opacity: k * (live ? 1 : 0.45), transform: `translateX(${(1 - k) * 40}px)`, display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: 26, background: n.color ?? C.sun, color: C.ink, fontFamily: HEAD, fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{i + 1}</div>
            <p style={{ fontFamily: HEAD, fontSize: 48, lineHeight: 1.1, color: C.cream, margin: 0 }}>{n.text}</p>
          </div>
        );
      })}
    </div>
  );
};

// ---- scenes -------------------------------------------------------------------

/** Cold open: the real game at the moment of a win, one line. */
const Cold: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 8, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: C.sky, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 110, paddingBottom: 120 }}>
      <Img src={staticFile("background-day.png")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", imageRendering: "pixelated", opacity: 0.55 }} />
      <Phone src="clips/phone.mp4" start={18} rate={1.1} height={800} />
      <div style={{ width: 800, transform: `scale(${0.85 + 0.15 * pop})`, opacity: pop }}>
        <h1 style={{ fontFamily: HEAD, fontSize: 112, lineHeight: 1, margin: 0, color: C.cream, WebkitTextStroke: `8px ${C.line}`, paintOrder: "stroke" }}>This bird is a live price.</h1>
        <p style={{ fontFamily: BODY, fontWeight: 700, fontSize: 42, margin: "24px 0 0", color: C.ink }}>You bet on where it flies. On NEAR.</p>
      </div>
    </AbsoluteFill>
  );
};

const ProblemCard: React.FC<{ t: number; h: string; p: string; icon: React.ReactNode }> = ({ t, h, p, icon }) => {
  const k = useAt(t);
  return (
    <div style={{ flex: 1, opacity: k, transform: `translateY(${(1 - k) * 40}px)`, background: C.ink2, borderRadius: 28, padding: 40, border: "1px solid rgba(255,255,255,0.08)" }}>
      <svg width={80} height={80} viewBox="0 0 80 80" fill={C.sun}>{icon}</svg>
      <h3 style={{ fontFamily: HEAD, color: C.cream, fontSize: 46, margin: "18px 0 10px" }}>{h}</h3>
      <p style={{ fontFamily: BODY, color: C.muted, fontSize: 30, lineHeight: 1.35, margin: 0 }}>{p}</p>
    </div>
  );
};
const Problem: React.FC = () => (
  <AbsoluteFill style={{ background: C.ink, padding: "120px 140px" }}>
    <Kicker>THE PROBLEM</Kicker>
    <Title>Tap-trading games are exploding.<br />Nobody can check them.</Title>
    <div style={{ display: "flex", gap: 36, marginTop: 70 }}>
      <ProblemCard t={1.2} h="Off-chain house" p="Prices and payouts live on the operator’s servers." icon={<><rect x={14} y={10} width={52} height={22} rx={5} /><rect x={14} y={40} width={52} height={22} rx={5} /><circle cx={26} cy={21} r={3} fill={C.ink} /><circle cx={26} cy={51} r={3} fill={C.ink} /></>} />
      <ProblemCard t={3.2} h="Unverifiable" p="You can’t check a single outcome. You just trust them." icon={<><path d="M10 40 Q40 10 70 40 Q40 70 10 40Z" /><circle cx={40} cy={40} r={9} fill={C.ink} /><line x1={14} y1={68} x2={66} y2={12} stroke={C.hit} strokeWidth={7} strokeLinecap="round" /></>} />
      <ProblemCard t={6.5} h="Popup hell" p="On-chain versions ask you to sign every single move." icon={<><rect x={8} y={8} width={44} height={34} rx={6} /><rect x={20} y={22} width={44} height={34} rx={6} opacity={0.8} /><rect x={32} y={36} width={44} height={34} rx={6} opacity={0.6} /></>} />
    </div>
  </AbsoluteFill>
);

const Step: React.FC<{ t: number; n: string; h: string }> = ({ t, n, h }) => {
  const k = useAt(t, 0.4);
  return (
    <div style={{ opacity: k, transform: `scale(${0.8 + 0.2 * k})`, background: "rgba(22,19,14,0.85)", color: C.cream, fontFamily: BODY, fontWeight: 700, fontSize: 34, padding: "12px 24px", borderRadius: 999, display: "flex", gap: 12, alignItems: "center" }}>
      <span style={{ background: C.sun, color: C.ink, borderRadius: 99, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
      {h}
    </div>
  );
};
const Solution: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const drop = useAt(6.8);
  const pulse = 1 + 0.06 * Math.sin((f / fps) * 6);
  return (
    <AbsoluteFill style={{ background: C.sky }}>
      <Img src={staticFile("background-day.png")} style={{ position: "absolute", bottom: 0, width: "100%", height: 760, objectFit: "cover", imageRendering: "pixelated", opacity: 0.9 }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 300 }}>
        <Flight width={1920} progress={interpolate(f, [0, durationInFrames], [0.05, 0.99], clamp)} pipes={[0.38, 0.58, 0.78]} offsets={[0, 95, -12]} />
      </div>
      <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center" }}>
        <h1 style={{ fontFamily: HEAD, fontSize: 150, margin: 0, color: C.cream, WebkitTextStroke: `8px ${C.line}`, paintOrder: "stroke" }}>Riptide</h1>
      </div>
      <div style={{ position: "absolute", top: 270, width: "100%", display: "flex", justifyContent: "center", gap: 20 }}>
        <Step t={3.5} n="1" h="Bird = live price" />
        <Step t={5.2} n="2" h="Tap where it’ll be" />
        <Step t={6.8} n="3" h="Drop — locks on-chain" />
      </div>
      <div style={{ position: "absolute", right: 200, top: 720, opacity: drop, transform: `scale(${pulse})`, background: C.sun, border: `4px solid ${C.line}`, boxShadow: `0 7px 0 ${C.line}`, borderRadius: 20, padding: "12px 26px", textAlign: "center" }}>
        <p style={{ fontFamily: HEAD, fontSize: 44, fontWeight: 700, margin: 0, color: C.ink }}>▼ Drop 2.7x</p>
        <p style={{ fontFamily: BODY, fontSize: 24, fontWeight: 700, margin: 0, color: C.ink }}>$0.10 → win $0.27</p>
      </div>
    </AbsoluteFill>
  );
};

const Demo: React.FC = () => (
  <AbsoluteFill style={{ background: C.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 120, paddingBottom: 170 }}>
    <Rise><Phone src="clips/phone.mp4" start={5} rate={1.35} height={780} /></Rise>
    <div>
      <Kicker>LIVE ON NEAR TESTNET</Kicker>
      <div style={{ height: 30 }} />
      <Notes
        notes={[
          { at: 0.5, text: "Tap where the bird will be" },
          { at: 2.5, text: "Drop — multiplier locks on-chain" },
          { at: 11.5, text: "Through: +$0.59, paid instantly", color: C.win },
          { at: 18.5, text: "Again: $10.34 → $11.82", color: C.win },
          { at: 26.5, text: "Hit the pipe: −$0.10", color: C.hit },
        ]}
      />
    </div>
  </AbsoluteFill>
);

/** How a pipe is priced and settled: samples → line → gate → probability of the gap. */
const Fair: React.FC = () => {
  const draw = useAt(0.6, 2.5), gate = useAt(3.4), curve = useAt(5.5, 1.2), formula = useAt(8);
  const W = 1000, samples = [0, 140, 300, 420, 560, 700, 820].map((x, i) => ({ x: x + 60, y: 260 + [30, -40, 10, -70, -20, -50, 40][i]! }));
  const gx = 700, i = samples.findIndex((s) => s.x > gx), a = samples[i - 1]!, b = samples[i]!;
  const gy = a.y + ((b.y - a.y) * (gx - a.x)) / (b.x - a.x);
  const shown = samples.filter((s) => s.x <= 60 + draw * 820);
  const bell = [...Array(61)].map((_, k) => { const y = 60 + k * 7; const z = (y - 245) / 70; return { x: 1180 + 230 * Math.exp((-z * z) / 2), y }; });
  return (
    <AbsoluteFill style={{ background: C.ink, padding: "110px 140px" }}>
      <Kicker>FAIR BY CONSTRUCTION</Kicker>
      <Title size={68}>The multiplier prices exactly what you win on</Title>
      <svg width={1640} height={560} style={{ position: "absolute", left: 140, top: 330 }}>
        <rect x={0} y={0} width={W} height={520} rx={24} fill={C.ink2} />
        <g opacity={gate}>
          <rect x={gx - 22} y={0} width={44} height={gy - 55} fill={C.pipe} stroke={C.line} strokeWidth={3} />
          <rect x={gx - 22} y={gy + 55} width={44} height={520 - gy - 55} fill={C.pipe} stroke={C.line} strokeWidth={3} />
          <rect x={gx - 22} y={gy - 55} width={44} height={110} fill="rgba(255,225,77,0.25)" />
        </g>
        <polyline points={shown.map((s) => `${s.x},${s.y}`).join(" ")} fill="none" stroke={C.cream} strokeWidth={5} strokeLinejoin="round" />
        {shown.map((s) => <circle key={s.x} cx={s.x} cy={s.y} r={10} fill={C.sky} />)}
        <g opacity={gate}>
          <circle cx={gx} cy={gy} r={16} fill={C.win} stroke={C.line} strokeWidth={4} />
          <text x={gx + 34} y={gy - 70} fontFamily={BODY} fontSize={28} fontWeight={700} fill={C.win}>price at the gate</text>
        </g>
        <text x={40} y={490} fontFamily={BODY} fontSize={24} fill={C.muted}>● on-chain samples, read straight from the pool</text>
        <g opacity={curve}>
          <polygon points={["1180,190", ...bell.filter((p) => p.y >= 190 && p.y <= 300).map((p) => `${p.x},${p.y}`), "1180,300"].join(" ")} fill="rgba(255,225,77,0.35)" />
          <polyline points={bell.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={C.sun} strokeWidth={4} />
          <line x1={1180} x2={1180} y1={60} y2={480} stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
          <text x={1180} y={36} fontFamily={BODY} fontSize={26} fill={C.muted}>where the price can be at the gate</text>
          <text x={1430} y={258} fontFamily={HEAD} fontSize={44} fontWeight={700} fill={C.sun}>P = 36%</text>
        </g>
      </svg>
      <div style={{ position: "absolute", left: 140, top: 880, opacity: formula, fontFamily: HEAD, fontSize: 50, color: C.cream }}>
        multiplier = <span style={{ color: C.sun }}>1 / P</span> minus a 3% edge → <span style={{ color: C.sun }}>2.7x</span>
      </div>
    </AbsoluteFill>
  );
};

const Near: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const box = (x: number, label: string, sub: string, s: number, dark = false) => {
    const k = interpolate(t, [s, s + 0.5], [0, 1], { ...clamp, easing: ease });
    return (
      <g opacity={k} transform={`translate(${x} ${300 + (1 - k) * 30})`}>
        <rect width={420} height={200} rx={28} fill={dark ? C.sun : C.ink2} stroke={dark ? C.line : "rgba(255,255,255,0.15)"} strokeWidth={3} />
        <text x={210} y={92} textAnchor="middle" fontFamily={HEAD} fontSize={44} fontWeight={700} fill={dark ? C.ink : C.cream}>{label}</text>
        <text x={210} y={142} textAnchor="middle" fontFamily={BODY} fontSize={26} fill={dark ? C.ink : C.muted}>{sub}</text>
      </g>
    );
  };
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
    { at: 2.5, text: "Cross-contract calls read the Rhea pool price" },
    { at: 5.5, text: "Holds the vault · anyone can call settle" },
    { at: 9.5, text: "Function-call keys: one approval, then zero popups" },
    { at: 13, text: "Guests get a funded sub-account in seconds" },
  ];
  return (
    <AbsoluteFill style={{ background: C.ink, padding: "110px 120px" }}>
      <Kicker>WHY NEAR</Kicker>
      <Title size={68}>The contract is the house, the oracle and the referee</Title>
      <svg width={1680} height={560} style={{ position: "absolute", left: 120, top: 250 }}>
        <line x1={420} x2={630} y1={400} y2={400} stroke="rgba(255,255,255,0.25)" strokeWidth={4} strokeDasharray="10 10" />
        <line x1={1050} x2={1260} y1={400} y2={400} stroke="rgba(255,255,255,0.25)" strokeWidth={4} strokeDasharray="10 10" />
        {box(0, "Rhea pools", "RFT · ELIXIR · GOLD", 0.2)}
        {box(630, "riptide-6024", "NEAR contract", 0.6, true)}
        {box(1260, "Player", "browser · session key", 1.0)}
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
    <Kicker>MULTIPLAYER</Kicker>
    <Title size={64}>Share a link. Race on the same pipes.</Title>
    <Rise delay={8} style={{ marginTop: 30 }}>
      <div style={{ width: 1440, height: 810, borderRadius: 24, overflow: "hidden", boxShadow: "0 40px 90px rgba(0,0,0,0.5)", border: "3px solid rgba(255,255,255,0.12)" }}>
        <Video src={staticFile("clips/desk.mp4")} trimBefore={Math.round(4 * FPS)} playbackRate={1.7} muted style={{ width: 1440, height: 810 }} />
      </div>
    </Rise>
  </AbsoluteFill>
);

const Counter: React.FC<{ to: number; t: number; label: string; suffix?: string }> = ({ to, t, label, suffix = "" }) => {
  const k = useAt(t, 1.2);
  return (
    <div style={{ flex: 1, opacity: Math.min(1, k * 3), background: C.ink2, borderRadius: 28, padding: "40px 30px", textAlign: "center" }}>
      <p style={{ fontFamily: HEAD, fontSize: 130, color: C.sun, margin: 0, lineHeight: 1 }}>{Math.round(to * k)}{suffix}</p>
      <p style={{ fontFamily: BODY, fontSize: 32, color: C.cream, margin: "14px 0 0" }}>{label}</p>
    </div>
  );
};
const Proof: React.FC = () => (
  <AbsoluteFill style={{ background: C.ink, padding: "130px 140px" }}>
    <Kicker>PROOF, NOT PROMISES</Kicker>
    <Title>Everything here ran on testnet</Title>
    <div style={{ display: "flex", gap: 32, marginTop: 70 }}>
      <Counter to={3} t={0.6} label="live Rhea markets" />
      <Counter to={31} t={1.8} label="contract tests" />
      <Counter to={740} t={3.2} label="bets placed on-chain" suffix="+" />
    </div>
  </AbsoluteFill>
);

const Milestone: React.FC<{ t: number; h: string; p: string; arrow: boolean }> = ({ t, h, p, arrow }) => {
  const k = useAt(t);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, flex: 1 }}>
      <div style={{ flex: 1, opacity: k, transform: `translateY(${(1 - k) * 30}px)`, borderTop: `6px solid ${C.sun}`, paddingTop: 22 }}>
        <h3 style={{ fontFamily: HEAD, fontSize: 56, color: C.cream, margin: 0 }}>{h}</h3>
        <p style={{ fontFamily: BODY, fontSize: 32, color: C.muted, margin: "8px 0 0" }}>{p}</p>
      </div>
      {arrow && <span style={{ fontFamily: HEAD, fontSize: 60, color: C.sun, opacity: k }}>→</span>}
    </div>
  );
};
const Next: React.FC = () => (
  <AbsoluteFill style={{ background: C.ink, padding: "130px 140px" }}>
    <Kicker>WHAT’S NEXT</Kicker>
    <Title>From testnet game to on-chain arcade</Title>
    <div style={{ display: "flex", gap: 24, marginTop: 80, alignItems: "center" }}>
      <Milestone t={0.6} h="Mainnet" p="deep pools, TWAP oracle" arrow />
      <Milestone t={2.2} h="NEAR Intents" p="deposit from any chain" arrow />
      <Milestone t={3.8} h="More markets" p="community-picked pools" arrow={false} />
    </div>
  </AbsoluteFill>
);

const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.ink, justifyContent: "center", alignItems: "center", paddingBottom: 80 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 40, opacity: 0.5 }}>
        <Flight width={1920} progress={interpolate(f, [0, durationInFrames], [0.2, 1], clamp)} seed={2} color={C.sun} />
      </div>
      <Rise><h1 style={{ fontFamily: HEAD, color: C.cream, fontSize: 150, margin: 0 }}>Fly the price.</h1></Rise>
      <Rise delay={8}><p style={{ fontFamily: BODY, color: C.muted, fontSize: 40, margin: "16px 0 40px", textAlign: "center" }}>Live on NEAR testnet · guest play in 10 seconds · tournaments with friends</p></Rise>
      <Rise delay={16}>
        <div style={{ display: "flex", gap: 20 }}>
          <span style={{ background: C.sun, color: C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 36, padding: "14px 30px", borderRadius: 999 }}>riptide-navy.vercel.app</span>
          <span style={{ background: C.cream, color: C.ink, fontFamily: BODY, fontWeight: 700, fontSize: 36, padding: "14px 30px", borderRadius: 999 }}>github.com/sairammr/riptide</span>
        </div>
      </Rise>
      <Rise delay={24}><p style={{ fontFamily: BODY, color: C.sky, fontSize: 32, fontWeight: 700, margin: "30px 0 0" }}>@NEARProtocol #NEARHackathon</p></Rise>
    </AbsoluteFill>
  );
};

const VIEWS: Record<string, React.FC> = { cold: Cold, problem: Problem, solution: Solution, demo: Demo, fair: Fair, near: Near, multi: Multi, proof: Proof, next: Next, close: Close };

export const Pitch: React.FC = () => (
  <AbsoluteFill style={{ background: C.ink }}>
    <TransitionSeries>
      {SCENES.flatMap((s, i) => {
        const View = VIEWS[s.id]!;
        const scene = (
          <TransitionSeries.Sequence key={s.id} durationInFrames={sceneFrames(s)} name={s.id}>
            <View />
            <Caption text={s.say} />
            {audio[s.id] ? <Audio src={staticFile(`voiceover/${s.id}.mp3`)} /> : null}
          </TransitionSeries.Sequence>
        );
        return i === 0 ? [scene] : [<TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: FADE })} />, scene];
      })}
    </TransitionSeries>
  </AbsoluteFill>
);
