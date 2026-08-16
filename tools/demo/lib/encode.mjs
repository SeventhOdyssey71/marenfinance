/**
 * Getting the take out of Playwright and into a file people can open.
 *
 * Playwright writes VP8 WebM and nothing else, and it only finalises the file when the
 * browser *context* closes — not the page, not the browser. Reading `page.video().path()`
 * before that gives you a path to a partially written file, which is the usual reason a
 * recorded video turns out to be a few seconds long or unplayable.
 *
 * WebM is the deliverable. MP4 is produced alongside it when an ffmpeg already exists on
 * the machine, because WebM will not play in QuickTime, will not drop into Keynote, and is
 * awkward in Slack — which is to say, it will not play in the three places a demo-day video
 * actually gets opened. We do not install ffmpeg to make that happen; if it is absent the
 * run still succeeds and says so.
 */

import { spawn } from 'node:child_process';
import { stat, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', () => resolve({ code: -1, out }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

/**
 * Find an ffmpeg we are allowed to use.
 *
 * PATH first — that is the one the operator chose. Playwright ships its own build for
 * screen recording, and using it is not an installation: it is already on disk as a
 * dependency of this very script. If neither exists we return null and the caller degrades.
 */
export async function findFfmpeg() {
  const which = await run('which', ['ffmpeg']);
  if (which.code === 0 && which.out.trim()) {
    return { path: which.out.trim().split('\n')[0], source: 'PATH' };
  }

  try {
    const { registry } = await import('playwright-core/lib/server/registry/index.js');
    const bundled = registry.findExecutable('ffmpeg')?.executablePath();
    if (bundled && existsSync(bundled)) return { path: bundled, source: 'playwright' };
  } catch {
    // Playwright's internal layout is not a public API; if it moved, we simply have no
    // bundled fallback. That is a missing mp4, not a failed run.
  }
  return null;
}

/** Seconds of video, read back from the encoded file rather than from our own stopwatch. */
export async function probeDuration(ffmpegPath, file) {
  // ffprobe sits next to ffmpeg when ffmpeg came from a package manager, but Playwright
  // ships ffmpeg alone. Parsing ffmpeg's own banner works for both.
  const { out } = await run(ffmpegPath, ['-i', file]);
  const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * @param {{ page: import('playwright-core').Page,
 *           context: import('playwright-core').BrowserContext,
 *           outWebm: string, log: (m: string) => void }} options
 */
export async function finalise({ page, context, outWebm, log }) {
  const video = page.video();
  if (!video) throw new Error('this page was not recording — recordVideo was not set');

  // Closing the context is what flushes the muxer. Everything after this is a real file.
  await context.close();

  await mkdir(dirname(outWebm), { recursive: true });
  await rm(outWebm, { force: true });
  await video.saveAs(outWebm);
  // The scratch copy Playwright wrote under its own temp dir is now redundant.
  await video.delete().catch(() => {});

  const { size } = await stat(outWebm);
  log(`webm: ${outWebm} (${(size / 1e6).toFixed(1)} MB)`);

  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) {
    log('mp4: skipped — no ffmpeg found on PATH and none bundled. The webm is complete.');
    return { webm: outWebm, mp4: null, bytes: size, seconds: null };
  }

  const seconds = await probeDuration(ffmpeg.path, outWebm);
  const outMp4 = outWebm.replace(/\.webm$/, '.mp4');
  await rm(outMp4, { force: true });

  log(`mp4: transcoding with ffmpeg (${ffmpeg.source})`);
  const { code, out } = await run(ffmpeg.path, [
    '-y',
    '-i',
    outWebm,
    '-c:v',
    'libx264',
    // yuv420p is the pixel format QuickTime and every hardware decoder will accept.
    // Without it x264 may pick yuv444p from the VP8 source and macOS refuses to play it.
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    '-preset',
    'slow',
    // Constant frame rate. Playwright's WebM is variable-rate, and VFR is what makes a
    // recording stutter or desync once it is dropped into an editor.
    '-r',
    '30',
    '-vsync',
    'cfr',
    // Puts the moov atom first so the file starts playing before it has fully downloaded.
    '-movflags',
    '+faststart',
    outMp4,
  ]);

  if (code !== 0) {
    log(`mp4: ffmpeg failed (exit ${code}); the webm is still valid`);
    log(out.split('\n').slice(-6).join('\n'));
    return { webm: outWebm, mp4: null, bytes: size, seconds };
  }

  const mp4Stat = await stat(outMp4);
  log(`mp4: ${outMp4} (${(mp4Stat.size / 1e6).toFixed(1)} MB)`);
  return { webm: outWebm, mp4: outMp4, bytes: size, seconds };
}

/** Pull evenly spaced stills out of the take so a human can check it without scrubbing. */
export async function extractFrames({ video, outDir, count = 12, log }) {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) return null;
  const seconds = await probeDuration(ffmpeg.path, video);
  if (!seconds) return null;

  await mkdir(outDir, { recursive: true });
  const stamps = [];
  for (let i = 0; i < count; i += 1) {
    const t = ((i + 0.5) * seconds) / count;
    const file = join(outDir, `frame-${String(i).padStart(2, '0')}.png`);
    await run(ffmpeg.path, ['-y', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', file]);
    stamps.push({ t, file });
  }
  log?.(`frames: ${count} stills in ${outDir}`);
  return stamps;
}
