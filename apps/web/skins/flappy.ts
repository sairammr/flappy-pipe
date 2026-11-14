/*
 * Flappy skin (placeholder, swappable).
 * Sprites: samuelcust/flappy-bird-assets — MIT (public/flappy/LICENSE-assets.txt).
 * Canvas loop adapted from omariosouto/flappy-bird-devsoutinho (jogo.js) — MIT:
 * scrolling background/ground (`planoDeFundo`, `chao` repeat-modulo) and the
 * 4-frame wing cycle (`movimentos` up/mid/down/mid every N frames). Its game
 * rules (gravity, flap input, collisions) are not used: here the bird IS the
 * price and the pipes are 5 s windows.
 */
import type { Rect } from "../lib/board";
import type { GapState, Pt, Skin } from "./skin";

const SRC = ["background-day", "base", "pipe-green", "pipe-red", "yellowbird-upflap", "yellowbird-midflap", "yellowbird-downflap"] as const;
const img: Partial<Record<(typeof SRC)[number], HTMLImageElement>> = {};
const ok = (i?: HTMLImageElement): i is HTMLImageElement => !!i && i.complete && i.naturalWidth > 0;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill = "#fff") {
  ctx.font = `800 ${size}px ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#3b2a14";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// Pipe body: a horizontal slice of the sprite stretched over the segment keeps its shading.
function pipe(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, red = false) {
  if (h <= 0) return;
  const i = red ? img["pipe-red"] : img["pipe-green"];
  if (ok(i)) ctx.drawImage(i, 0, 120, 52, 40, x, y, w, h);
  else (ctx.fillStyle = red ? "#c0392b" : "#5ec639"), ctx.fillRect(x, y, w, h);
}
// Pipe lip (top 24px of the sprite), slightly wider than the body, on each gap edge.
function lip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, red = false) {
  const i = red ? img["pipe-red"] : img["pipe-green"];
  const h = Math.min(24, w * 0.4);
  if (ok(i)) ctx.drawImage(i, 0, 0, 52, 24, x - 3, y - h / 2, w + 6, h);
}

const GAP_FILL: Record<GapState, string> = {
  aim: "255,255,255",
  bad: "230,70,60",
  open: "255,225,77",
  won: "61,220,110",
  lost: "40,20,10",
};

const FLAP = ["yellowbird-upflap", "yellowbird-midflap", "yellowbird-downflap", "yellowbird-midflap"] as const;

export const flappy: Skin = {
  id: "flappy",
  groundH: 48,
  copy: {
    play: "Play",
    guest: "No wallet? Play as guest",
    hint: "Slide the gap, stretch its lips, then Drop. Bird through the gap pays.",
    signedOut: "Press Play to fly",
    won: "Through!",
    lost: "Hit the pipe",
  },

  load() {
    return Promise.all(
      SRC.map(
        (n) =>
          new Promise<void>((done) => {
            const i = new Image();
            i.onload = i.onerror = () => done();
            i.src = `/flappy/${n}.png`;
            img[n] = i;
          }),
      ),
    ).then(() => {});
  },

  background(ctx, w, h, scrollPx) {
    ctx.fillStyle = "#4ec0ca";
    ctx.fillRect(0, 0, w, h);
    const bg = img["background-day"];
    if (!ok(bg)) return;
    const s = h / 512, tw = 288 * s;
    // planoDeFundo: draw twice side by side; here as many as needed, slow parallax.
    for (let x = -((scrollPx * 0.2) % tw); x < w; x += tw) ctx.drawImage(bg, x, 0, tw + 1, h);
  },

  column(ctx, r, gaps, ghost, t) {
    // The pipe stands on the window's end, the gate: the bet is decided exactly where the
    // bird's centre meets the pipe's centre line.
    const w = Math.min(56, r.w * 0.5), cx = r.x + r.w, x = cx - w / 2;
    const red = gaps.length > 0 && gaps.every((g) => g.state === "lost");
    const sorted = [...gaps].sort((a, b) => a.y - b.y);
    ctx.globalAlpha = ghost ? 0.3 : 1;
    let top = r.y;
    for (const g of sorted) {
      pipe(ctx, x, top, w, g.y - top, red);
      top = g.y + g.h;
    }
    pipe(ctx, x, top, w, r.y + r.h - top, red);
    for (const g of sorted) lip(ctx, x, g.y, w, red), lip(ctx, x, g.y + g.h, w, red);
    ctx.globalAlpha = 1;

    const pulse = 0.5 + 0.5 * Math.sin(t / 160);
    for (const g of sorted) {
      const c = GAP_FILL[g.state];
      ctx.fillStyle = `rgba(${c},${g.state === "aim" ? 0.18 : g.state === "lost" ? 0.35 : 0.2 + 0.25 * pulse})`;
      ctx.fillRect(x, g.y + 3, w, g.h - 6);
      if (g.state === "aim" || g.state === "bad") {
        ctx.strokeStyle = `rgba(${c},0.95)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.strokeRect(x + 1, g.y + 4, w - 2, g.h - 8);
        ctx.setLineDash([]);
      }
      const big = Math.max(14, Math.min(26, g.h * 0.32));
      if (g.label) label(ctx, g.label, cx, g.y + g.h / 2 - (g.sub ? big * 0.35 : 0), big, g.state === "won" ? "#b8ffcc" : g.state === "bad" ? "#ffb3ab" : "#fff");
      if (g.sub) label(ctx, g.sub, cx, g.y + g.h / 2 + big * 0.6, Math.round(big * 0.5), "#ffe14d");
    }
  },

  pop(ctx, text, win, x, y, alpha, sub) {
    ctx.globalAlpha = Math.max(0, alpha);
    if (sub) label(ctx, sub, x, y - 26, 16, "#fff");
    label(ctx, text, x, y, 30, win ? "#b8ffcc" : "#ffb3ab");
    ctx.globalAlpha = 1;
  },

  mover(ctx, trail, now, frame) {
    if (trail.length) {
      ctx.lineJoin = ctx.lineCap = "round";
      for (const [lw, col] of [[5, "rgba(59,42,20,0.55)"], [2.5, "#fff"]] as const) {
        ctx.beginPath();
        const pts = [...trail, now];
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length - 1; i++) {
          const a = pts[i]!, b = pts[i + 1]!;
          ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
        ctx.lineTo(now.x, now.y);
        ctx.lineWidth = lw;
        ctx.strokeStyle = col;
        ctx.stroke();
      }
    }
    // movimentos: up/mid/down/mid, advance every 8 frames
    const b = img[FLAP[Math.floor(frame / 8) % 4]];
    const prev: Pt = trail.at(-1) ?? now;
    const tilt = Math.max(-0.6, Math.min(0.6, Math.atan2(now.y - prev.y, Math.max(8, now.x - prev.x))));
    ctx.save();
    ctx.translate(now.x, now.y);
    ctx.rotate(tilt);
    if (ok(b)) ctx.drawImage(b, -22, -16, 44, 31);
    else (ctx.fillStyle = "#f8d000"), ctx.beginPath(), ctx.arc(0, 0, 12, 0, 7), ctx.fill();
    ctx.restore();
  },

  ground(ctx, w, h, scrollPx) {
    const g = img.base, gh = this.groundH;
    ctx.fillStyle = "#ded895";
    ctx.fillRect(0, h - gh, w, gh);
    if (!ok(g)) return;
    const tw = 336 * (gh / 112) * 2;
    // chao: x = movement % repeat
    for (let x = -(scrollPx % tw); x < w; x += tw) ctx.drawImage(g, x, h - gh, tw + 1, gh * 2);
  },
};

