// The skin boundary (SPEC §6). Skins get already-projected screen coordinates
// from lib/board.ts and only paint; they never touch prices, time or hit areas.
// Swapping skins = one new file + changing the import in app/page.tsx.
import type { Rect } from "../lib/board";

export type Pt = { x: number; y: number };
type Ctx = CanvasRenderingContext2D;

/** A hole in a column. "aim" = the gap the player is dragging; "bad" = aimed at an unplaceable band. */
export type GapState = "aim" | "bad" | "open" | "won" | "lost";
export type Gap = { y: number; h: number; state: GapState; label: string | null; sub: string | null };

export interface Skin {
  id: string;
  groundH: number;
  copy: { play: string; guest: string; hint: string; signedOut: string; won: string; lost: string };
  load(): Promise<void>;
  /** scrollPx = chain time * px/ms, so decorations scroll in lockstep with the columns */
  background(ctx: Ctx, w: number, h: number, scrollPx: number): void;
  /** One 5 s column spanning the playfield (r), solid except for its gaps.
   *  ghost = the movable aiming column, drawn translucent. */
  column(ctx: Ctx, r: Rect, gaps: Gap[], ghost: boolean, tMs: number): void;
  /** result floating off the bird the moment a pipe is decided, e.g. "+$0.35" with sub
   *  "Through!"; alpha 1 -> 0 over its life */
  pop(ctx: Ctx, text: string, win: boolean, x: number, y: number, alpha: number, sub?: string): void;
  mover(ctx: Ctx, trail: Pt[], now: Pt, frame: number): void;
  ground(ctx: Ctx, w: number, h: number, scrollPx: number): void;
}
