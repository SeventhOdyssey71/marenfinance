#!/usr/bin/env node
/**
 * Lay out a film's beat table from the MEASURED duration of its narration.
 *
 * WHY THIS IS COMPUTED RATHER THAN TYPED. A beat has to be long enough to hold its
 * line, and the line's length is not known until it has been generated — a sentence
 * that reads as short can come back at seven seconds. Typing the beat table first and
 * then discovering six cue collisions (which is exactly what happened) means editing
 * thirty-one numbers by hand and re-checking every neighbour. The constraint is
 * arithmetic, so it should be solved as arithmetic:
 *
 *     beat length >= max(floor, spoken + LEAD + TAIL)
 *
 * LEAD is the gap between the beat starting and its line starting, which exists so the
 * headline lands before the voice arrives rather than the read pre-announcing the
 * title. TAIL is the overlap into the next beat: the line must finish before the NEXT
 * beat's t0, not merely before its own t1, because the next line starts LEAD after that.
 *
 * `floor` is what the PICTURE needs regardless of the words — a camera move to
 * complete, a statistic to stay up long enough to read, an end card to breathe. Floors
 * are the only hand-set numbers, and they are the only ones worth arguing about.
 *
 * Usage:
 *   node tools/demo/retime-film.mjs --audio design/explainer-film/audio
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const AUDIO = resolve(arg('audio', 'design/explainer-film/audio'));
const LEAD = 0.55; // beat t0 -> line starts speaking
const TAIL = 0.4; // line ends -> next beat t0 (== the beat overlap)
const OVERLAP = 0.4;

/**
 * id, human name, and the minimum the PICTURE needs, independent of the words.
 * 4.40 is the general floor: 0.43 headline delay + 0.66 rise + 1.85 hold + 0.34 exit,
 * with room to spare against applestyle's 1.5s hold minimum.
 */
const PLAN = [
  ['A1', 'Act 1 · the minimum', 5.0], // camera move 1 lives inside this beat
  ['A2', 'Act 1 · in Bitcoin', 4.4],
  ['A3', 'Act 1 · the count', 4.4],
  ['A4', 'Act 1 · the shape', 4.4],
  ['T2', 'Turn · the iris (signature)', 6.6, 2.6], // +iris grow before the words land
  ['P1', 'Act 2 · 01 deposit', 4.4],
  ['P2', 'Act 2 · 02 borrow', 4.4],
  ['P3', 'Act 2 · before you sign', 6.2], // camera move 2 pushes in and pulls back
  ['P4', 'Act 2 · 03 pay', 4.4],
  ['P5', 'Act 2 · 04 receipt', 4.4],
  ['P6', 'Act 2 · 05 always', 4.4],
  ['B1', 'Act 3 · contracts', 4.4],
  ['B2', 'Act 3 · the app', 4.4],
  ['B3', 'Act 3 · the relayer', 4.4],
  ['B4', 'Act 3 · the proof', 4.4],
  ['B5', 'Act 3 · the rest', 4.4],
  ['M1', 'Act 4 · positions', 4.4],
  ['M2', 'Act 4 · borrowed', 4.4],
  ['M3', 'Act 4 · payments', 4.4],
  ['M4', 'Act 4 · the spend ratio', 6.6], // the film's thesis — it stays up longest
  ['M5', 'Act 4 · the caveat', 4.4],
  ['D1', 'Act 5 · the rule', 4.4],
  ['D2', 'Act 5 · the result', 4.4],
  ['D3', 'Act 5 · the catch', 4.4],
  ['D4', 'Act 5 · the fix', 4.4],
  ['O1', 'Act 6 · the ceiling', 4.4],
  ['O2', 'Act 6 · the redeploy', 4.4],
  ['O3', 'Act 6 · the key', 4.4],
  ['O4', 'Act 6 · the audit', 4.4],
  ['C1', 'Act 7 · the promise', 4.4],
  ['C2', 'Act 7 · end card', 7.4], // camera move 3, then the global fade
];

const vo = JSON.parse(await readFile(join(AUDIO, 'vo.json'), 'utf8'));
const spoken = Object.fromEntries(vo.map((v) => [v.id, v.seconds]));

const beats = [];
let t0 = 0;
for (const [id, name, floor, lead] of PLAN) {
  const dur = spoken[id];
  if (dur === undefined) throw new Error(`no measured audio for ${id}`);
  const need = dur + (lead ?? LEAD) + TAIL;
  const len = Math.max(floor, Math.ceil(need * 20) / 20); // round up to 0.05
  beats.push({
    id,
    name,
    t0,
    t1: t0 + len,
    len,
    dur,
    cue: t0 + (lead ?? LEAD),
    bound: need > floor,
  });
  t0 = t0 + len - OVERLAP;
}

/* T1 is structural: it holds the mark, which enters at the turn and never exits. Its
   t0 is what render() reads; its t1 is only documentation.
   It is derived from T2, not from A4's exit: the iris floods OUT OF the mark, so the
   mark has to be fully on screen before the circle starts growing. Hanging T1 off the
   end of Act 1 put it 0.06s AFTER T2, which would have opened the signature out of
   nothing. 1.30s is the launch film's spacing, and it is enough for the POP to settle. */
const T2 = beats.find((b) => b.id === 'T2');
const P1 = beats.find((b) => b.id === 'P1');
const T1 = {
  id: 'T1',
  name: 'Turn · the mark',
  t0: Number((T2.t0 - 1.3).toFixed(2)),
  t1: Number((P1.t0 - 0.4).toFixed(2)),
};

const DUR = beats[beats.length - 1].t1;
const out = [...beats];
out.splice(
  out.findIndex((b) => b.id === 'T2'),
  0,
  T1,
);

const f = (v) => v.toFixed(2).padStart(6);
console.log(
  `\nDUR = ${DUR.toFixed(2)}  (${Math.floor(DUR / 60)}:${String(Math.round(DUR % 60)).padStart(2, '0')})`,
);
console.log(
  `${beats.filter((b) => b.bound).length} of ${beats.length} beats are held open by their line, not by the floor\n`,
);

console.log('var BEATS = [');
for (const b of out) {
  const pad = `"${b.id}"`.padEnd(6);
  const nm = `"${b.name}",`.padEnd(34);
  console.log(`  { id:${pad} name:${nm} t0:${f(b.t0)}, t1:${f(b.t1)} },`);
}
console.log('];\n');

console.log('CUES (id, starts speaking, ends, beat window):');
for (const b of beats) {
  const end = b.cue + b.dur;
  const next = beats[beats.indexOf(b) + 1];
  const clash = next && end > next.cue + 1e-9 ? '  <-- COLLIDES' : '';
  console.log(
    `  ${b.id.padEnd(3)} ${f(b.cue)} -> ${f(end)}   beat ${f(b.t0)}-${f(b.t1)} (${b.len.toFixed(2)}s, spoken ${b.dur.toFixed(2)}s)${clash}`,
  );
}

console.log('\nLINES `at` values for script.mjs:');
for (const b of beats) console.log(`  ${b.id}: ${b.cue.toFixed(2)}`);
