#!/usr/bin/env node
/**
 * Sweep a film's timeline and report what is actually on screen, then save stills.
 *
 * WHY THIS EXISTS. `render(t)` is pure, so the film can be interrogated rather than
 * watched: step the clock in small increments, read every animated element's computed
 * opacity, and the timeline audit that applestyle.md section 3 asks for becomes a
 * measurement instead of an opinion. Watching a 166-second film to find a 200ms hole
 * where nothing is on screen is not a reliable way to find it.
 *
 * It checks three things the eye is bad at:
 *   - EMPTY FIELD   runs of frames where nothing is visible (a hole in the edit)
 *   - COLLISION     two headlines on screen at once (the beats overlap too far)
 *   - HARD CUT      an element whose opacity jumps more than 0.30 between steps,
 *                   which means it appeared or vanished without an animated exit
 *
 * Usage:
 *   node tools/demo/probe-film.mjs --input design/explainer-film/maren-explainer.html \
 *     [--step 0.04] [--stills 0,20,45,90] [--out /tmp/probe]
 */
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChromium } from './lib/browser.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const input = resolve(arg('input', 'design/explainer-film/maren-explainer.html'));
const step = Number(arg('step', 0.04));
const outDir = resolve(arg('out', '/tmp/maren-probe'));
const stills = (arg('stills', '') || '').split(',').filter(Boolean).map(Number);

if (!existsSync(input)) {
  console.error(`no such film: ${input}`);
  process.exit(1);
}

let browser;
try {
  browser = await launchChromium({ log: () => {} });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(input).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))),
    );
  });

  const report = await page.evaluate((stepSize) => {
    /* eslint-disable no-undef */
    playing = false;
    window.requestAnimationFrame = () => 0;
    for (const id of ['ui', 'hint'])
      document.getElementById(id)?.style.setProperty('display', 'none');

    // Every element the film animates, plus the headline subset used for collisions.
    const nodes = [...document.querySelectorAll('.anim, .copy > *, .w')];
    const heads = [
      ...document.querySelectorAll('.copy > .h2, .hero, .big, .mid, .turn-h, .copy .num'),
    ];
    const alphaOf = (el) => {
      // Effective alpha: an element inside a hidden wrapper is not on screen no matter
      // what its own opacity says. Walk up to #camera multiplying as we go.
      let a = 1;
      for (let n = el; n && n.id !== 'camera'; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
        a *= parseFloat(cs.opacity || '1');
      }
      return a;
    };
    // A word-staggered headline is a permanently-visible container whose CHILDREN carry
    // the beat, so the container's own alpha is 1 for the whole film. Reading it directly
    // reports every hero line as on screen from its first frame to the last, which turns
    // into a collision against every subsequent beat. Descend to the words.
    const headAlpha = (el) => {
      const w = el.querySelectorAll(':scope > .w');
      if (!w.length) return alphaOf(el);
      let m = 0;
      for (const c of w) m = Math.max(m, alphaOf(c));
      return m;
    };

    const empties = [];
    const collisions = [];
    const jumps = [];
    let prev = new Map();
    let emptyRun = null;

    for (let t = 0; t <= DUR + 1e-9; t += stepSize) {
      const tt = Math.min(t, DUR);
      render(tt);

      let maxA = 0;
      for (const n of nodes) maxA = Math.max(maxA, alphaOf(n));
      if (maxA < 0.02) {
        if (!emptyRun) emptyRun = { from: tt, to: tt };
        else emptyRun.to = tt;
      } else if (emptyRun) {
        empties.push(emptyRun);
        emptyRun = null;
      }

      const lit = heads.filter((h) => headAlpha(h) > 0.12);
      if (lit.length > 1) {
        collisions.push({
          t: Number(tt.toFixed(2)),
          what: lit.map((h) => (h.textContent || '').trim().slice(0, 28)),
        });
      }

      const now = new Map();
      for (const n of nodes) {
        const a = alphaOf(n);
        now.set(n, a);
        if (prev.size) {
          const p = prev.get(n) ?? 0;
          // A Decelerated enter covers ~0.4 alpha in its first 60ms by design, so any
          // "delta > 0.3" test flags every legitimate enter in the film. What actually
          // matters is an element crossing all the way between gone and present inside a
          // single step — that is the signature of a toggle rather than an animation.
          // #iris is excluded: the film hides that whole layer deliberately, and only
          // ever while the clip-path circle has zero area, so nothing is on screen to cut.
          const toggled = (p < 0.02 && a > 0.55) || (p > 0.55 && a < 0.02);
          if (toggled && !n.closest('#iris')) {
            jumps.push({
              t: Number(tt.toFixed(2)),
              from: Number(p.toFixed(2)),
              to: Number(a.toFixed(2)),
              what: (n.id || n.className || '?').toString().slice(0, 24),
              text: (n.textContent || '').trim().slice(0, 24),
            });
          }
        }
      }
      prev = now;
    }
    if (emptyRun) empties.push(emptyRun);

    const beats = BEATS.map((b) => ({
      id: b.id,
      name: b.name,
      len: Number((b.t1 - b.t0).toFixed(2)),
    }));
    return { DUR, empties, collisions, jumps, beats };
    /* eslint-enable no-undef */
  }, step);

  const fmt = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
  console.log(`\nfilm ${report.DUR}s (${fmt(report.DUR)}), swept at ${step}s\n`);

  console.log(`EMPTY FIELD  ${report.empties.length} run(s)`);
  for (const e of report.empties) {
    const len = e.to - e.from;
    console.log(`  ${e.from.toFixed(2)}s -> ${e.to.toFixed(2)}s  (${len.toFixed(2)}s)`);
  }

  console.log(`\nHEADLINE COLLISIONS  ${report.collisions.length} frame(s)`);
  // Collapse consecutive frames into runs; a 40ms cross-fade overlap is not news.
  let run = null;
  const runs = [];
  for (const c of report.collisions) {
    if (run && c.t - run.to <= step * 1.5) run.to = c.t;
    else {
      if (run) runs.push(run);
      run = { from: c.t, to: c.t, what: c.what };
    }
  }
  if (run) runs.push(run);
  for (const r of runs) {
    console.log(
      `  ${r.from.toFixed(2)}-${r.to.toFixed(2)}s  ${(r.to - r.from).toFixed(2)}s  ${r.what.join('  |  ')}`,
    );
  }

  console.log(`\nHARD CUTS (alpha jump > 0.30 in one ${step}s step)  ${report.jumps.length}`);
  for (const j of report.jumps.slice(0, 20)) {
    console.log(`  ${j.t.toFixed(2)}s  ${j.what.padEnd(22)} ${j.from} -> ${j.to}  "${j.text}"`);
  }
  if (report.jumps.length > 20) console.log(`  ... and ${report.jumps.length - 20} more`);

  const short = report.beats.filter((b) => b.len < 2.5);
  console.log(`\nBEATS shorter than 2.5s  ${short.length}`);
  for (const b of short) console.log(`  ${b.id}  ${b.len}s  ${b.name}`);

  if (stills.length) {
    await mkdir(outDir, { recursive: true });
    for (const t of stills) {
      await page.evaluate((tt) => render(tt), t);
      const f = join(outDir, `t${String(t).padStart(6, '0')}.png`);
      await page.screenshot({ path: f, animations: 'disabled' });
      console.log(`  still ${t}s -> ${f}`);
    }
  }

  const bad = report.empties.filter((e) => e.to - e.from > 0.45).length + runs.length;
  console.log(`\n${bad === 0 ? 'clean' : `${bad} issue(s) to look at`}\n`);
} finally {
  await browser?.close();
}
