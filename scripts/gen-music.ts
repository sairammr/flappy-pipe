// bun scripts/gen-music.ts <out.wav> — an original, license-free chiptune loop for the game and
// the video: C–G–Am–F at 112 bpm, square-wave arpeggio, triangle bass, noise hats. 16 bars.
import { writeFileSync } from "node:fs";

const SR = 44100, BPM = 112, BEAT = 60 / BPM, BARS = 16;
const N = Math.round(SR * BEAT * 4 * BARS);
const out = new Float32Array(N);
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const CHORDS = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]]; // C G Am F (MIDI)
const sq = (p: number) => (p % 1 < 0.5 ? 1 : -1);
const tri = (p: number) => 4 * Math.abs((p % 1) - 0.5) - 1;
let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function note(start: number, dur: number, f: number, vol: number, wave: (p: number) => number, decay = 6) {
  const s0 = Math.round(start * SR), n = Math.round(dur * SR);
  for (let i = 0; i < n && s0 + i < N; i++) {
    const t = i / SR, env = Math.min(1, t * 200) * Math.exp(-t * decay);
    out[s0 + i]! += vol * env * wave(f * t);
  }
}
for (let bar = 0; bar < BARS; bar++) {
  const chord = CHORDS[bar % 4]!, t0 = bar * 4 * BEAT;
  // bass: root on every beat, octave jump on 3
  for (let b = 0; b < 4; b++) note(t0 + b * BEAT, BEAT * 0.9, hz(chord[0]! - 12 + (b === 2 ? 12 : 0)), 0.32, tri, 3);
  // arpeggio: 8 eighths up and down the chord, an octave up; second half of the loop adds 16ths
  const arp = [0, 1, 2, 1 + 3, 2, 1, 0, 1].map((k) => (chord[k % 3]! + 24 + (k >= 3 ? 12 : 0)));
  const sub = bar >= 8 ? 2 : 1;
  for (let k = 0; k < 8 * sub; k++) note(t0 + (k * BEAT) / (2 * sub), BEAT / (2 * sub), hz(arp[k % 8]!), 0.07, sq, 9);
  // a little melody on the top every other bar
  if (bar % 2 === 1) note(t0 + 3 * BEAT, BEAT, hz(chord[2]! + 24), 0.06, sq, 4);
  // hats on the offbeats, kick-ish thump on 1 and 3
  for (let b = 0; b < 4; b++) {
    note(t0 + b * BEAT + BEAT / 2, 0.05, 1, 0.08, () => noise(), 60);
    if (b % 2 === 0) note(t0 + b * BEAT, 0.12, 55, 0.35, (p) => Math.sin(2 * Math.PI * p * (1 - p / 40)), 25);
  }
}
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const pcm = Buffer.alloc(44 + N * 2);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + N * 2, 4); pcm.write("WAVEfmt ", 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) pcm.writeInt16LE(Math.round((out[i]! / peak) * 0.9 * 32767), 44 + i * 2);
writeFileSync(process.argv[2] ?? "music.wav", pcm);
console.log(`${(N / SR).toFixed(1)} s loop`);
