/**
 * The app under the camera.
 *
 * The walkthrough is recorded against `next start` — the production build — not `next dev`.
 * Dev mode recompiles routes on first visit, so the first navigation to each page stalls
 * for a second or two behind a compile that has nothing to do with the product. On camera
 * that reads as the app being slow. The production server serves prebuilt routes, so the
 * only latency left in the video is real latency: RPC round trips to Mezo.
 *
 * The port is chosen by asking the OS for a free one rather than hardcoding 3000, because
 * a developer recording a take almost certainly has their own dev server on 3000 already,
 * and silently recording *that* — a dev build, possibly with unsaved changes — is the kind
 * of reproducibility bug that is invisible until someone asks why the video does not match
 * the branch.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Ask the kernel for a port nobody is using, then immediately give it back. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, { timeoutMs = 60_000, log }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server never became ready at ${url} (last: ${lastError})`);
}

/**
 * Boot the production build of apps/web and resolve once it answers.
 *
 * Set DEMO_BASE_URL to skip this entirely and record against a server you are already
 * running — useful while iterating on the scene list, where re-booting Next on every
 * attempt is pure waiting.
 *
 * @param {{ webDir: string, log: (msg: string) => void }} options
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
export async function startWebServer({ webDir, log }) {
  const external = process.env.DEMO_BASE_URL;
  if (external) {
    log(`using existing server at ${external} (DEMO_BASE_URL)`);
    await waitForHttp(external, { log });
    return { baseUrl: external.replace(/\/$/, ''), close: async () => {} };
  }

  if (!existsSync(join(webDir, '.next', 'BUILD_ID'))) {
    throw new Error(
      `apps/web has no production build. Run:\n` +
        `  CI=true pnpm --filter @maren/web build\n` +
        `(looked for ${join(webDir, '.next', 'BUILD_ID')})`,
    );
  }

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  log(`booting next start on ${port}`);

  const child = spawn(
    process.execPath,
    [join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--port', String(port)],
    {
      cwd: webDir,
      // The recording is of the app, not of Next's banner. stdout is kept for the failure
      // path — if the server dies, its output is the only explanation available.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
    },
  );

  const output = [];
  child.stdout.on('data', (d) => output.push(String(d)));
  child.stderr.on('data', (d) => output.push(String(d)));

  let exited = null;
  child.on('exit', (code, signal) => {
    exited = `next start exited early (code=${code} signal=${signal})\n${output.join('')}`;
  });

  try {
    await waitForHttp(baseUrl, { log });
  } catch (err) {
    child.kill('SIGKILL');
    throw new Error(exited ?? `${err.message}\n${output.join('')}`);
  }

  log(`server ready at ${baseUrl}`);

  return {
    baseUrl,
    async close() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      // Next occasionally ignores SIGTERM while a request is in flight; the recording is
      // already written by this point, so escalating is safe.
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 4_000);
        child.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
