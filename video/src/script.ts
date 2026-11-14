// The pitch + demo, scene by scene. `say` is the voiceover (scripts/voiceover.ts → Soniox TTS →
// public/voiceover/<id>.mp3) and the on-screen caption.
// `seconds` is the minimum length (the footage it shows); with audio, at least audio + PAD.
export type Scene = { id: string; seconds: number; say: string };

export const SCENES: Scene[] = [
  { id: "cold", seconds: 5, say: "This bird is a live price on NEAR. And you’re betting on where it flies." },
  {
    id: "problem",
    seconds: 9,
    say: "Tap-trading games are exploding. But they run on the house’s own servers, so you can’t check a single outcome. And on-chain versions drown you in wallet popups.",
  },
  {
    id: "solution",
    seconds: 9,
    say: "Riptide fixes both. Every pipe is five seconds. Tap where you think the bird will be, hit Drop, and your multiplier locks on-chain.",
  },
  {
    id: "demo",
    seconds: 30,
    say: "Here it is, live on testnet. Through the gap, and you’re paid the instant the bird gets there. Fifty-nine cents. Then forty-four. Hit the pipe, and you lose your dime. No popups. No waiting.",
  },
  {
    id: "fair",
    seconds: 11,
    say: "It’s fair by construction. The contract prices each pipe from realized volatility, and settles on the exact price where the bird meets the pipe. The same line you see on screen.",
  },
  {
    id: "near",
    seconds: 14,
    say: "NEAR is the engine room. The contract reads Rhea pools itself through cross-contract calls, holds the vault, and anyone can trigger settlement. Function-call keys mean one approval at sign-in, and guests get a funded account in seconds.",
  },
  {
    id: "multi",
    seconds: 12,
    say: "Then bring your friends. Create a tournament, share the link, and race on the same pipes. The contract pays the pot at the bell, and every result lands on a global leaderboard.",
  },
  { id: "proof", seconds: 7, say: "Three live markets. Thirty-one contract tests. Every claim reproducible from the README." },
  { id: "next", seconds: 6, say: "Next: mainnet, deeper pools, and NEAR Intents deposits from any chain." },
  { id: "close", seconds: 7, say: "Riptide. Fly the price. Play it now, and tell us which market we should add next." },
];

export const FPS = 30;
export const PAD = 0.5; // seconds of air after each line
export const FADE = 12; // frames of crossfade between scenes
