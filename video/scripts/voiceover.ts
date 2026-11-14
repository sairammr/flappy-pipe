// SONIOX_API_KEY=... [VOICE=Daniel] bun scripts/voiceover.ts
// One mp3 per scene from src/script.ts via Soniox TTS (REST), then src/durations.json so each
// scene lasts as long as its line. Re-run after editing the script.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { SCENES } from "../src/script";

const key = process.env.SONIOX_API_KEY;
if (!key) throw new Error("set SONIOX_API_KEY");
const voice = process.env.VOICE ?? "Daniel";
mkdirSync("public/voiceover", { recursive: true });
const durations: Record<string, number> = {};
for (const s of SCENES) {
  const res = await fetch("https://tts-rt.soniox.com/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "tts-rt-v2", language: "en", voice, audio_format: "mp3", sample_rate: 44100, bitrate: 128000, text: s.say }),
  });
  if (!res.ok) throw new Error(`${s.id}: ${res.status} ${await res.text()}`);
  const file = `public/voiceover/${s.id}.mp3`;
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  durations[s.id] = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  console.log(s.id, durations[s.id]!.toFixed(2), "s");
}
writeFileSync("src/durations.json", JSON.stringify(durations, null, 2) + "\n");
