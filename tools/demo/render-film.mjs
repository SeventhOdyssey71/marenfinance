#!/usr/bin/env node
/**
 * Render a self-contained motion film (`design/launch-film/*.html`) to an .mp4.
 *
 * WHY NOT SCREEN-RECORD IT. Playwright's `recordVideo` and a QuickTime capture both sample
 * the page in real time, so every dropped frame, every GC pause and every compositor hiccup
 * lands in the master. The film is built as one pure `render(t)` over a single clock, which
 * means time is an INPUT, not something that elapses: we can pause the clock, call
 * `render(t)` at exact frame boundaries, and screenshot each one. The output is therefore
 * deterministic and judder-free regardless of how slow the machine is, and re-rendering the
 * same film twice produces byte-identical frames.
 *
 * The film owns all of its motion through `render(t)`; the only CSS transitions in the file
 * are on the playback chrome, which this script hides before the first frame.
 *
 * Supersampling: the page renders at deviceScaleFactor 2 (3840x2160) and ffmpeg downsamples
 * to 1080p with lanczos. A film that is mostly type looks noticeably cleaner this way than a
 * native 1x capture, where the hinting breaks up on thin strokes.
 *
 * Usage:
 *   node tools/demo/render-film.mjs --input design/launch-film/maren-launch.html \
 *     --out design/launch-film/maren-launch.mp4 [--fps 30] [--scale 2] [--crf 16]
 */
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { launchChromium } from './lib/browser.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const input = resolve(arg('input', 'design/launch-film/maren-launch.html'));
const out = resolve(arg('out', input.replace(/\.html$/, '.mp4')));
const fps = Number(arg('fps', 30));
const scale = Number(arg('scale', 2));
const crf = Number(arg('crf', 16));
const log = (m) => process.stdout.write(`${m}\n`);

if (!existsSync(input)) {
  console.error(`no such film: ${input}`);
  process.exit(1);
}

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}\n${err.slice(-4000)}`))));
  });
}

let browser;
let frameDir;
try {
  browser = await launchChromium({ log });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: scale,
    // The film paints its own white ground; a dark UA default would show through any
    // sub-pixel gap at the frame edge.
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(input).href, { waitUntil: 'load' });

  // Everything is inlined as data URIs, so "loaded" is really "decoded". Wait for the font
  // and every image, otherwise frame 0 captures a flash of fallback type.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))),
    );
  });

  const duration = await page.evaluate(() => {
    // The film's `loop()` calls `render(t)` on EVERY rAF tick, not only while playing, so
    // merely setting `playing = false` is not enough: the next tick would repaint the film's
    // own `t` over the frame we just asked for, and every capture would come back as t=0.
    // Neutralising rAF stops loop() rescheduling itself (the already-queued callback fires
    // once more, harmlessly), which hands the clock entirely to this script.
    // eslint-disable-next-line no-undef
    playing = false;
    window.requestAnimationFrame = () => 0;
    // #ui is the control bar, #hint the keyboard legend. Both are opacity-based and get
    // re-shown by the film's own idle timer, so remove them from layout outright.
    for (const id of ['ui', 'hint']) document.getElementById(id)?.style.setProperty('display', 'none');
    // eslint-disable-next-line no-undef
    return DUR;
  });

  const total = Math.ceil(duration * fps) + 1;
  log(`film ${duration}s -> ${total} frames at ${fps}fps, ${1920 * scale}x${1080 * scale}`);

  frameDir = await mkdtemp(join(tmpdir(), 'maren-film-'));
  for (let f = 0; f < total; f += 1) {
    const t = Math.min(f / fps, duration);
    // Time is an input. This is the whole reason the output cannot judder.
    await page.evaluate((tt) => {
      // eslint-disable-next-line no-undef
      render(tt);
    }, t);
    await page.screenshot({
      path: join(frameDir, `f${String(f).padStart(6, '0')}.png`),
      animations: 'disabled',
    });
    if (f % 150 === 0 || f === total - 1) log(`  frame ${f + 1}/${total}`);
  }

  const written = (await readdir(frameDir)).length;
  if (written !== total) throw new Error(`expected ${total} frames, wrote ${written}`);

  log(`encoding -> ${out}`);
  await run('ffmpeg', [
    '-y',
    '-framerate', String(fps),
    '-i', join(frameDir, 'f%06d.png'),
    '-vf', 'scale=1920:1080:flags=lanczos',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', String(crf),
    // yuv420p is what QuickTime, Keynote, Twitter and every browser will actually play.
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    out,
  ]);
  log(`done: ${out}`);
} finally {
  await browser?.close();
  if (frameDir) await rm(frameDir, { recursive: true, force: true });
}
