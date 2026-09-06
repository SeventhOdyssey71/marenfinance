#!/usr/bin/env node
/**
 * Mux the launch film's picture with its voiceover and score.
 *
 * WHY A CUE SHEET, NOT ONE AUDIO FILE. Each voiceover line is placed at an
 * explicit time against the film's beat list, so re-timing the film means editing
 * numbers here rather than re-cutting a monolithic take. The cue times below are
 * derived from BEATS in maren-launch.html plus each line's measured duration
 * (audio/vo.json), and `--check` asserts no two lines collide and nothing runs
 * past the end — a voiceover that overruns the picture is the one audio bug you
 * cannot hear until the very end of a render.
 *
 * The music is SIDECHAIN-DUCKED by the voiceover rather than set to a fixed low
 * volume. A static level loud enough to feel present under silence will always
 * fight the read; ducking lets the score breathe in the gaps and step back under
 * speech, which is what makes a mix sound produced rather than layered.
 *
 * Usage:
 *   node tools/demo/mix-film-audio.mjs [--video <in.mp4>] [--out <out.mp4>] [--check]
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const AUDIO = resolve('design/launch-film/audio');
const VIDEO = resolve(arg('video', 'design/launch-film/maren-launch-silent.mp4'));
const OUT = resolve(arg('out', 'design/launch-film/maren-launch.mp4'));
const MUSIC = join(AUDIO, 'music.mp3');
const DUR = 41.4;

/**
 * id -> when the line STARTS speaking, in seconds.
 *
 * Each sits just after its beat's copy has settled, so the word and the picture
 * arrive together rather than the read pre-announcing the title.
 */
const CUES = [
  ['A1', 0.60], ['A2', 4.30], ['A3', 6.95],
  ['T2a', 10.90], ['T2b', 13.00],
  ['P1', 15.90], ['P2', 19.20], ['P3', 22.40], ['P4', 26.80], ['P5', 29.80],
  // C1 is the honesty line and deliberately runs across the cut into the end
  // card; a voiceover crossing a cut is normal, and truncating this one would
  // mean dropping "pre-audit, not mainnet yet", which is the point of the line.
  ['C1', 32.70], ['C2', 38.60],
];

const vo = JSON.parse(await readFile(join(AUDIO, 'vo.json'), 'utf8'));
const byId = Object.fromEntries(vo.map((v) => [v.id, v.seconds]));

// --- validate the cue sheet before spending a render on it ------------------
const placed = CUES.map(([id, at]) => {
  if (byId[id] === undefined) throw new Error(`no audio for cue ${id}`);
  return { id, at, end: at + byId[id] };
}).sort((a, b) => a.at - b.at);

const problems = [];
for (let i = 1; i < placed.length; i += 1) {
  if (placed[i].at < placed[i - 1].end - 0.001) {
    problems.push(`${placed[i - 1].id} (ends ${placed[i - 1].end.toFixed(2)}) overlaps ${placed[i].id} (starts ${placed[i].at.toFixed(2)})`);
  }
}
const last = placed[placed.length - 1];
if (last.end > DUR) problems.push(`${last.id} ends at ${last.end.toFixed(2)}s, past the ${DUR}s film`);

for (const p of placed) {
  process.stdout.write(`  ${p.id.padEnd(4)} ${p.at.toFixed(2)} → ${p.end.toFixed(2)}\n`);
}
if (problems.length) {
  console.error('\ncue sheet problems:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`\ncue sheet OK — ${placed.length} lines, last ends ${last.end.toFixed(2)}s of ${DUR}s`);
if (process.argv.includes('--check')) process.exit(0);

for (const f of [VIDEO, MUSIC]) {
  if (!existsSync(f)) { console.error(`missing: ${f}`); process.exit(1); }
}

// --- build the graph --------------------------------------------------------
const voFiles = CUES.map(([id]) => join(AUDIO, `${id}.mp3`));
const inputs = ['-i', VIDEO, '-i', MUSIC, ...voFiles.flatMap((f) => ['-i', f])];

const delays = CUES.map(([, at], i) => {
  const ms = Math.round(at * 1000);
  // Input index: 0 video, 1 music, voice lines start at 2.
  return `[${i + 2}:a]adelay=${ms}|${ms}[v${i}]`;
}).join(';');
const voMix = `${CUES.map((_, i) => `[v${i}]`).join('')}amix=inputs=${CUES.length}:normalize=0[vo]`;

const filter = [
  // normalize=0: the lines never overlap, so summing must not scale them down.
  delays,
  voMix,
  `[vo]asplit=2[voOut][voKey]`,
  // The key MUST be padded to the full duration. sidechaincompress stops when its
  // shortest input ends, so an unpadded key (which runs out at the last spoken
  // word) truncates the score there — and -shortest then trims the PICTURE to
  // match, silently losing the end card's final second.
  `[voKey]apad=whole_dur=${DUR}[voKeyPad]`,
  // Score sits low to begin with; the sidechain then pulls it further under speech.
  `[1:a]volume=0.34,afade=t=in:st=0:d=1.6,afade=t=out:st=${(DUR - 2.2).toFixed(2)}:d=2.2[mus]`,
  `[mus][voKeyPad]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=380[duck]`,
  // loudnorm to -14 LUFS: the platforms this film gets posted to (YouTube, X,
  // LinkedIn) normalise playback to roughly that, so a quieter master is not
  // "subtle" — it is just turned down relative to everything around it. The raw
  // mix measured -23.9 LUFS. TP=-1.5 keeps true-peak headroom for the lossy
  // re-encode those platforms will apply on upload.
  `[duck][voOut]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:${DUR}[aout]`,
].join(';');

const args = [
  '-y', ...inputs,
  '-filter_complex', filter,
  '-map', '0:v', '-map', '[aout]',
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-movflags', '+faststart',
  '-shortest',
  OUT,
];

console.log(`\nmixing -> ${OUT}`);
await new Promise((ok, fail) => {
  const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (c) => (c === 0 ? ok() : fail(new Error(err.slice(-3000)))));
});
console.log('done');
