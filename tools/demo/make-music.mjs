#!/usr/bin/env node
/**
 * Generate the launch film's score, and REFUSE a take that contains singing.
 *
 * WHY THIS EXISTS. The first score was generated with "No vocals" in the prose prompt
 * and came back with a vocal line in it — quiet, sitting under the narration, and
 * easy to miss on a first listen while being obvious once heard. Prose instructions
 * to a music model are a request, not a constraint.
 *
 * So this asks twice: `force_instrumental: true` as an actual API parameter, AND a
 * prompt that describes only instruments. Then it MEASURES the result rather than
 * trusting either.
 *
 * THE MEASUREMENT. Speech modulates its amplitude envelope hard at the syllable
 * rate, 3-8 Hz, inside the 300-3400 Hz band. Sustained instrumental music does not:
 * pads hold, and piano decays are far slower. So the fraction of envelope energy in
 * that band separates the two cleanly. Measured on this film's own assets, the
 * spoken lines score 0.32-0.37 and the rejected vocal take scored 0.328 — the score
 * was indistinguishable from the voiceover, which is exactly why it sounded like a
 * second voice underneath one.
 *
 * Takes are generated until one lands under the threshold, and the best is kept.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node tools/demo/make-music.mjs [--seconds 44] [--tries 4]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY is not set'); process.exit(1); }

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const SECONDS = Number(arg('seconds', 44));
const TRIES = Number(arg('tries', 4));
const OUT = resolve('design/launch-film/audio');

/** Anything at or above this is treated as containing a voice. */
const SPEECH_THRESHOLD = 0.24;

const PROMPT = [
  'Purely instrumental score for a calm, story-led product film. Absolutely no singing,',
  'no vocal samples, no choir, no humming, no spoken word, no vocoder and no human voice',
  'of any kind — the only sound sources are a warm analog synth pad, a soft repeating',
  'piano motif, a gentle low sub pulse and light room ambience. Opens sparse and intimate,',
  'a quiet rhythmic pulse enters around fifteen seconds, and it opens up warmly through the',
  'final twelve seconds before resolving hopeful and unhurried, leaving air at the very end',
  'rather than stopping abruptly. Restrained throughout, never busy. No drums, no risers,',
  'no impacts. Clean modern production with generous headroom for a narrator to sit on top.',
].join(' ');

/** Fraction of envelope energy in the 3-8 Hz syllabic band. See the header. */
function speechiness(file) {
  const r = spawnSync('python3', ['-c', `
import subprocess, numpy as np, sys
out = subprocess.run(['ffmpeg','-v','error','-i',sys.argv[1],'-ac','1','-ar','16000','-f','f32le','-'],
                     capture_output=True).stdout
x = np.frombuffer(out, dtype=np.float32)
if len(x) < 16000: print('0'); sys.exit()
X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1/16000)
X[(f < 300) | (f > 3400)] = 0
env = np.abs(np.fft.irfft(X))
k = 160
env = env[:len(env)//k*k].reshape(-1, k).mean(axis=1)
env = env - env.mean()
if env.std() == 0: print('0'); sys.exit()
E = np.abs(np.fft.rfft(env)); ef = np.fft.rfftfreq(len(env), 1/100)
tot = E[(ef >= 0.5) & (ef <= 20)].sum()
print(f"{(E[(ef >= 3) & (ef <= 8)].sum() / tot) if tot else 0:.4f}")
`, file], { encoding: 'utf8' });
  return Number((r.stdout || '0').trim());
}

await mkdir(OUT, { recursive: true });
let best = null;

for (let i = 1; i <= TRIES; i += 1) {
  const res = await fetch('https://api.elevenlabs.io/v1/music', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: PROMPT,
      music_length_ms: Math.round(SECONDS * 1000),
      // Asked as a parameter, not only as prose. Still verified below.
      force_instrumental: true,
    }),
  });
  if (!res.ok) { console.error(`take ${i}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
  const file = join(OUT, `music-take-${i}.mp3`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  const s = speechiness(file);
  const verdict = s >= SPEECH_THRESHOLD ? 'REJECT — contains a voice' : 'ok';
  process.stdout.write(`  take ${i}: speechiness ${s.toFixed(3)}  ${verdict}\n`);
  if (!best || s < best.s) best = { s, file };
  if (s < SPEECH_THRESHOLD) break;
}

if (!best) { console.error('no take produced'); process.exit(1); }
if (best.s >= SPEECH_THRESHOLD) {
  console.error(`\nEVERY take scored >= ${SPEECH_THRESHOLD} (best ${best.s.toFixed(3)}).`);
  console.error('Do not ship this: it will sound like a second voice under the narration.');
  process.exit(1);
}
await writeFile(join(OUT, 'music.mp3'), await (await import('node:fs/promises')).readFile(best.file));
process.stdout.write(`\nkept ${best.file} (speechiness ${best.s.toFixed(3)}) -> ${join(OUT, 'music.mp3')}\n`);
