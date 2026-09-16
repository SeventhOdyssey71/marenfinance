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
 * THE MEASUREMENT. A first attempt used syllabic-rate modulation (3-8 Hz envelope
 * energy in the speech band) and had to be thrown away: it scored a solo piano
 * control at 0.278, above the spoken lines' own threshold, because piano attacks
 * modulate at roughly the syllable rate. A vibrato measure was worse still, ranking
 * piano (0.306) above the suspect music (0.319).
 *
 * What does separate them is SIBILANCE — the broadband 5-9 kHz energy that fricatives
 * make and struck or sustained instruments do not. Measured on this film's assets:
 * spoken lines 0.16-0.19, solo piano 0.017. That is an order of magnitude, not a
 * judgement call.
 *
 * Note what this can and cannot catch. It catches a voice with consonants. It will NOT
 * catch a wordless "ooh" pad, which is what the rejected take actually contained — so
 * a passing score means "no one is talking in here", not "no human sound at all". The
 * mix's centre-channel suppression is what covers the rest.
 *
 * Takes are generated until one lands under the threshold, and the best is kept.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node tools/demo/make-music.mjs [--seconds 44] [--tries 4]
 *     [--out design/explainer-film/audio]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set');
  process.exit(1);
}

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const SECONDS = Number(arg('seconds', 44));
const TRIES = Number(arg('tries', 4));
const OUT = resolve(arg('out', 'design/launch-film/audio'));

/** Anything at or above this is treated as containing a voice. */
/** Voice measures 0.16-0.19 here, piano 0.017. 0.08 sits well clear of both. */
const SPEECH_THRESHOLD = 0.08;

const PROMPT = [
  'Clean lo-fi hip hop instrumental for a calm product film. Warm tape-saturated electric',
  'piano playing a simple repeating motif, soft dusty vinyl crackle, a mellow upright bass',
  'line, and a relaxed unhurried drum groove with brushed rimshots and a soft kick. Gentle',
  'low-pass warmth throughout, slightly off-grid and human. Absolutely no singing, no vocal',
  'samples, no choir, no humming, no spoken word, no vocoder and no human voice of any kind.',
  'Around seventy beats per minute. Steady and understated from beginning to end so a narrator',
  'can sit on top of it, with air at the end rather than an abrupt stop.',
].join(' ');

/** Share of spectral energy in the 5-9 kHz fricative band. See the header. */
function speechiness(file) {
  const r = spawnSync(
    'python3',
    [
      '-c',
      `
import subprocess, numpy as np, sys
out = subprocess.run(['ffmpeg','-v','error','-i',sys.argv[1],'-ac','1','-ar','22050','-f','f32le','-'],
                     capture_output=True).stdout
x = np.frombuffer(out, dtype=np.float32)
if len(x) < 22050: print('0'); sys.exit()
n, hop = 1024, 256
fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
S = np.abs(np.fft.rfft(fr, axis=1)); f = np.fft.rfftfreq(n, 1/22050)
print(f"{(S[:, (f>=5000)&(f<=9000)].sum(axis=1) / (S.sum(axis=1)+1e-12)).mean():.4f}")
`,
      file,
    ],
    { encoding: 'utf8' },
  );
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
  if (!res.ok) {
    console.error(`take ${i}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const file = join(OUT, `music-take-${i}.mp3`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  const s = speechiness(file);
  const verdict = s >= SPEECH_THRESHOLD ? 'REJECT — contains a voice' : 'ok';
  process.stdout.write(`  take ${i}: speechiness ${s.toFixed(3)}  ${verdict}\n`);
  if (!best || s < best.s) best = { s, file };
  if (s < SPEECH_THRESHOLD) break;
}

if (!best) {
  console.error('no take produced');
  process.exit(1);
}
if (best.s >= SPEECH_THRESHOLD) {
  console.error(`\nEVERY take scored >= ${SPEECH_THRESHOLD} (best ${best.s.toFixed(3)}).`);
  console.error('Do not ship this: it will sound like a second voice under the narration.');
  process.exit(1);
}
await writeFile(
  join(OUT, 'music.mp3'),
  await (await import('node:fs/promises')).readFile(best.file),
);
process.stdout.write(
  `\nkept ${best.file} (speechiness ${best.s.toFixed(3)}) -> ${join(OUT, 'music.mp3')}\n`,
);
