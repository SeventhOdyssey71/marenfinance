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
import { spawn, spawnSync } from 'node:child_process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const AUDIO = resolve('design/launch-film/audio');
const VIDEO = resolve(arg('video', 'design/launch-film/maren-launch-silent.mp4'));
const OUT = resolve(arg('out', 'design/launch-film/maren-launch.mp4'));
const MUSIC = join(AUDIO, 'music.mp3');
/**
 * Mid-channel level applied to the score, 0..1. 1 leaves it untouched.
 *
 * A generated "instrumental" score once came back with a voice in it, which is why
 * this knob exists: generated vocals are centre-panned while pads are wide, so
 * attenuating the mid suppresses the voice and leaves most of the music.
 *
 * DEFAULT IS 1 — OFF — and must stay off for the current lo-fi score. That track
 * measures side/mid 0.018, i.e. very nearly mono, with 37% of its energy below
 * 200 Hz: suppressing the centre would not trim a vocal off it, it would delete the
 * kick and bass the groove is made of. Only reach for this on a WIDE score that has
 * a voice in it, and check side/mid first.
 *
 * This is a remedy, not a detector. Two attempts to detect the voice programmatically
 * failed honestly: a syllabic-rate measure scored a solo piano control (0.278) above
 * the spoken lines' own threshold, and a vibrato measure put piano (0.306) above the
 * music (0.319). Neither separated voice from instrument, so the mix stopped trying to
 * decide and suppresses the band a centred vocal would occupy instead.
 */
const CENTRE = Number(arg('centre', '1'));
/**
 * Voice level relative to the score, 0..1.
 *
 * Set below 1 because the narration read as too loud — and the cause was not its own
 * gain. Measured on the previous master, speech windows sat at -13.6 dBFS RMS while
 * music-only windows sat at -11.9: the sidechain scooped the bed out from under every
 * line, so the voice was not loud so much as ALONE. Two changes together, rather than
 * only turning the voice down: a small cut here, and gentler ducking below so the score
 * stays audible underneath and the voice sits IN the mix instead of on top of a hole.
 */
const VOICE = Number(arg('voice', '0.70'));
/** Drop the score entirely — the one option that cannot contain a voice. */
const NO_MUSIC = process.argv.includes('--no-music');
const DUR = 43.2;

/**
 * id -> when the line STARTS speaking, in seconds.
 *
 * Each sits just after its beat's copy has settled, so the word and the picture
 * arrive together rather than the read pre-announcing the title.
 */
const CUES = [
  ['A1', 0.60], ['A2', 3.30], ['A3', 7.40],
  ['T2a', 10.60], ['T2b', 12.10],
  ['P1', 15.60], ['P2', 18.90], ['P3', 22.30], ['P4', 26.50], ['P5', 29.95],
  // C1 IS DELIBERATELY NOT SPOKEN. The three honest lines — "Non-custodial.",
  // "Live on Mezo testnet.", "Pre-audit. Not mainnet yet." — still rise ON SCREEN
  // across 32.22-36.97, so the disclosure is not dropped, only un-narrated. Reading
  // a caveat aloud in a launch film makes it the loudest thing in the room; showing
  // it keeps it exactly as true and lets the score carry the beat instead.
  ['C2', 38.60],
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
if (NO_MUSIC) console.log('score dropped (--no-music): voice over picture only');
else console.log(`score mid-channel at ${CENTRE} (centre suppression for the vocal artefact)`);

/**
 * Every clip is levelled to a common loudness BEFORE it is placed.
 *
 * They are generated separately and come back 1-3 LU apart, which broke the mix in a way
 * that was audible but easy to misread as "the voice is too loud". A threshold-based duck
 * keyed off an uneven voice fires unevenly: measured on the previous master, the bed was
 * pulled to -26.9 dB under one line (voice standing +0.8 dB proud of a hole) and left at
 * -21.3 under another (voice sitting 5.1 dB UNDER the bed). So some lines leapt out and
 * others were buried, and no single voice-gain setting could fix both.
 *
 * Each clip is measured, then given a static gain to VO_TARGET. Static rather than a
 * compressor because these are finished takes: the goal is to align them with each other,
 * not to squash the dynamics inside a performance.
 */
const VO_TARGET = -23;
const clipGain = (file) => {
  const r = spawnSync('ffmpeg', ['-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const m = (r.stderr || '').match(/I:\s+(-?[\d.]+)\s+LUFS/g);
  if (!m) return 1;
  const lufs = Number(m[m.length - 1].match(/(-?[\d.]+)/)[1]);
  return 10 ** ((VO_TARGET - lufs) / 20);
};

const delays = CUES.map(([id, at], i) => {
  const ms = Math.round(at * 1000);
  const g = clipGain(join(AUDIO, `${id}.mp3`)).toFixed(3);
  // Input index: 0 video, 1 music, voice lines start at 2.
  return `[${i + 2}:a]volume=${g},adelay=${ms}|${ms}[v${i}]`;
}).join(';');
const voMix = `${CUES.map((_, i) => `[v${i}]`).join('')}amix=inputs=${CUES.length}:normalize=0[vo]`;

const filter = NO_MUSIC ? [
  delays,
  voMix,
  // apad BEFORE the trim. With no score there is nothing else running to the end of
  // the film, so the audio stream stops at the last spoken word and -shortest then
  // trims the PICTURE to match — the master came out 42.4s instead of 43.2s and lost
  // the end card's fade. Same failure the sidechain key had, same fix.
  `[vo]apad=whole_dur=${DUR},atrim=0:${DUR}[aout]`,
] : [
  // normalize=0: the lines never overlap, so summing must not scale them down.
  delays,
  voMix,
  `[vo]asplit=2[voRaw][voKey]`,
  `[voRaw]volume=${VOICE}[voOut]`,
  // The key MUST be padded to the full duration. sidechaincompress stops when its
  // shortest input ends, so an unpadded key (which runs out at the last spoken
  // word) truncates the score there — and -shortest then trims the PICTURE to
  // match, silently losing the end card's final second.
  `[voKey]apad=whole_dur=${DUR}[voKeyPad]`,
  // Score sits low to begin with; the sidechain then pulls it further under speech.
  `[1:a]stereotools=mlev=${CENTRE},volume=${(0.34 / Math.max(CENTRE, 0.35)).toFixed(2)},afade=t=in:st=0:d=1.6,afade=t=out:st=${(DUR - 2.2).toFixed(2)}:d=2.2[mus]`,
  // Gentler than it was (was threshold 0.04, ratio 6, release 380). That setting pulled
  // the bed down about 9 dB under speech, which is a broadcast-style duck: correct when
  // the music is wallpaper, wrong when it is a lo-fi groove the film is partly carried by.
  // At 3.5:1 with a faster release the score dips but never disappears, and comes back
  // between lines instead of pumping.
  `[mus][voKeyPad]sidechaincompress=threshold=0.06:ratio=3.5:attack=25:release=250[duck]`,
  // loudnorm to -14 LUFS: the platforms this film gets posted to (YouTube, X,
  // LinkedIn) normalise playback to roughly that, so a quieter master is not
  // "subtle" — it is just turned down relative to everything around it. The raw
  // mix measured -23.9 LUFS. TP=-1.5 keeps true-peak headroom for the lossy
  // re-encode those platforms will apply on upload.
  `[duck][voOut]amix=inputs=2:normalize=0,atrim=0:${DUR}[aout]`,
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

// --- two-pass loudnorm ------------------------------------------------------
// Single-pass loudnorm ESTIMATES the correction from a running window, and with
// sparse speech over a quiet bed it undershoots: the voice-only master measured
// -15.8 LUFS against a -14 target. Two-pass measures the finished mix first, then
// applies the exact correction, which is the only way to actually land on target.
function measure(file) {
  const r = spawnSync('ffmpeg', ['-i', file, '-af',
    'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/\{[\s\S]*?\}/g);
  if (!m) throw new Error('loudnorm measurement failed');
  return JSON.parse(m[m.length - 1]);
}
const m = measure(OUT);
const tmp = `${OUT}.norm.mp4`;
await new Promise((ok, fail) => {
  const p2 = spawn('ffmpeg', ['-y', '-i', OUT, '-map', '0:v', '-map', '0:a',
    '-af', `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
           `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
  let e = ''; p2.stderr.on('data', (d) => (e += d));
  p2.on('close', (c) => (c === 0 ? ok() : fail(new Error(e.slice(-2000)))));
});
await (await import('node:fs/promises')).rename(tmp, OUT);
console.log(`done (two-pass loudnorm from measured ${Number(m.input_i).toFixed(1)} LUFS)`);
