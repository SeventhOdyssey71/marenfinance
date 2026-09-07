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
 * WRITTEN AS ONE PARAGRAPH, THEN CUT AT THE BEATS. The previous script restated
 * each on-screen title in turn, which made twelve captions rather than one story:
 * every line was a complete thought, so nothing pulled the viewer into the next
 * shot and the film had no momentum. Read these in sequence and they are a single
 * continuous sentence-chain — "it" is the same Bitcoin the whole way through, and
 * each line lands on a conjunction or a consequence that only resolves in the one
 * after it ("But to spend it…" / "So don't sell it." / "It starts with…" / "And
 * before you sign…" / "Then spend it").
 *
 * The titles still carry the claims; the voice carries the causation between them.
 * That division is deliberate: a voiceover that duplicates the title wastes the
 * only channel that can say WHY, and one that contradicts it makes the viewer
 * choose which to follow.
 */
const LINES = [
  { id: 'A1', text: 'You’ve held it for years.' },
  { id: 'A2', text: 'But to spend it, you have to sell it. And what you sell is gone.' },
  { id: 'A3', text: 'Dollars today. No Bitcoin tomorrow.' },
  { id: 'T2a', text: 'So don’t sell it.' },
  { id: 'T2b', text: 'Borrow against it, and keep every satoshi.' },
  { id: 'P1', text: 'It starts with a deposit.' },
  { id: 'P2', text: 'Your Bitcoin becomes a credit line you draw on.' },
  { id: 'P3', text: 'And before you sign, you see exactly how far it can fall.' },
  { id: 'P4', text: 'Then spend it. To a name, not an address.' },
  { id: 'P5', text: 'Done when the chain says it’s done.' },
  { id: 'C1', text: 'Non-custodial. Live on Mezo testnet. Pre-audit, not mainnet yet.' },
  { id: 'C2', text: 'Maren. Spend Bitcoin. Never sell it.' },
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
        // Loosened from 0.55 for the story rewrite. High stability keeps takes
        // consistent, which is what a caption read wants — but it also flattens the
        // rise and fall that makes a line sound like it is going somewhere. At 0.45
        // the reading of "But to spend it, you have to sell it" actually leans on
        // "have to", and the clauses that hand off to the next beat keep their lift
        // instead of landing closed. Low enough to breathe, high enough that twelve
        // separately-generated takes still sound like one person in one session.
        stability: 0.45,
        similarity_boost: 0.8,
        // Raised with it. 0 reads flat, high reads like a movie trailer; this sits
        // where a narrator is telling you something rather than selling it.
        style: 0.28,
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
