#!/usr/bin/env node
/**
 * Generate the launch film's voiceover, one line per beat, and report the real
 * duration of each.
 *
 * WHY PER LINE, NOT ONE TAKE. The film's timing is a beat list, and a beat cannot
 * be re-timed against a single 40-second audio file without cutting it. Rendering
 * each line separately means the film can be timed to the audio that actually
 * exists: `--json` prints measured durations, and the beat list is derived from
 * them rather than guessed. It also means one bad line is one regeneration.
 *
 * Prosody continuity is preserved with `previous_text` / `next_text`: without them
 * every line is read as an isolated sentence and the delivery resets at each cut,
 * which sounds like twelve voicemails rather than one read.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node tools/demo/make-vo.mjs [--voice <id>] [--out <dir>]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set');
  process.exit(1);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// George — warm, measured, unhurried. The film is Apple-style: the read has to
// sit under the picture, not sell over it.
const VOICE = arg('voice', 'JBFqnCBsd6RMkjVDRZzb');
const OUT = resolve(arg('out', 'design/launch-film/audio'));

/**
 * One entry per beat that speaks. `id` matches the film's BEATS ids so the
 * re-timing step can line them up without a lookup table.
 *
 * The copy deliberately tracks the on-screen line rather than talking over it:
 * a voiceover that says something different from the title forces the viewer to
 * choose which to follow, and they lose both.
 */
const LINES = [
  { id: 'A1', text: 'To spend your Bitcoin, you sell it.' },
  { id: 'A2', text: 'And then it’s gone.' },
  { id: 'A3', text: 'Dollars now. No Bitcoin later.' },
  { id: 'T2a', text: 'Borrow against it instead.' },
  { id: 'T2b', text: 'Keep every satoshi.' },
  { id: 'P1', text: 'Deposit your Bitcoin.' },
  { id: 'P2', text: 'Borrow dollars against it.' },
  { id: 'P3', text: 'See how far it can fall, before you sign.' },
  { id: 'P4', text: 'Pay anyone by handle.' },
  { id: 'P5', text: 'Done when the chain says done.' },
  { id: 'C1', text: 'Non-custodial. Live on Mezo testnet. Pre-audit, not mainnet yet.' },
  { id: 'C2', text: 'Maren. Never sell your Bitcoin.' },
];

function ffprobe(file) {
  return new Promise((ok, fail) => {
    const p = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (c) => (c === 0 ? ok(Number(out.trim())) : fail(new Error('ffprobe failed'))));
  });
}

await mkdir(OUT, { recursive: true });
const results = [];

for (let i = 0; i < LINES.length; i += 1) {
  const line = LINES[i];
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      text: line.text,
      model_id: 'eleven_multilingual_v2',
      previous_text: i > 0 ? LINES[i - 1].text : undefined,
      next_text: i < LINES.length - 1 ? LINES[i + 1].text : undefined,
      voice_settings: {
        // High stability: an ad read should not wander in delivery between takes
        // that will be butted against each other on a timeline.
        stability: 0.55,
        similarity_boost: 0.8,
        // A little style, not none: 0 reads flat, high reads like a movie trailer.
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    console.error(`${line.id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const file = join(OUT, `${line.id}.mp3`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  const dur = await ffprobe(file);
  results.push({ id: line.id, text: line.text, seconds: Number(dur.toFixed(2)) });
  process.stderr.write(`  ${line.id.padEnd(4)} ${dur.toFixed(2)}s  "${line.text}"\n`);
}

await writeFile(join(OUT, 'vo.json'), `${JSON.stringify(results, null, 2)}\n`);
const total = results.reduce((a, r) => a + r.seconds, 0);
process.stderr.write(`\ntotal spoken: ${total.toFixed(2)}s across ${results.length} lines\n`);
