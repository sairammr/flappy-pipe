// Game audio: Flappy Bird effects (samuelcust/flappy-bird-assets, MIT) and an original chiptune
// loop (scripts/gen-music.ts). Browsers only allow sound after a user gesture, so music starts
// on the first tap. One switch mutes everything; remembered per browser.
const KEY = "riptide:sound";
const SFX = { wing: 0.5, point: 0.55, hit: 0.6, die: 0.45, swoosh: 0.35 } as const;
export type Sfx = keyof typeof SFX;

let on = (() => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
})();
let music: HTMLAudioElement | null = null;
const cache = new Map<Sfx, HTMLAudioElement>();

export const soundOn = () => on;

export function play(name: Sfx) {
  if (!on || typeof Audio === "undefined") return;
  let a = cache.get(name);
  if (!a) cache.set(name, (a = new Audio(`/flappy/audio/${name}.ogg`)));
  const c = a.cloneNode() as HTMLAudioElement; // overlapping plays
  c.volume = SFX[name];
  c.play().catch(() => {});
}

/** Call from a user gesture; safe to call repeatedly. */
export function startMusic() {
  if (!on || typeof Audio === "undefined") return;
  if (!music) {
    music = new Audio("/flappy/audio/music.ogg");
    music.loop = true;
    music.volume = 0.18;
  }
  if (music.paused) music.play().catch(() => {});
}

export function setSound(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? "on" : "off");
  } catch {}
  if (v) startMusic();
  else music?.pause();
}
