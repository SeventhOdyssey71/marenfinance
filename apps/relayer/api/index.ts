import { createRelayer } from '../src/create.js';

/**
 * Vercel Functions entrypoint (fluid compute, Node runtime).
 *
 * The relayer is built once per instance and reused across invocations, so the
 * nonce manager's serialisation holds for concurrent requests landing on the
 * same instance. It does NOT hold across instances — see the README: on Vercel
 * you must run with `RELAYER_STORE=redis` and understand that two instances can
 * still race on nonce allocation. The mitigation is that `sendTransaction`
 * failures invalidate the cached nonce and force a chain resync.
 *
 * The stuck-transaction sweeper is deliberately not started here: there is no
 * process to run it in between requests. On Vercel, replacement is driven by an
 * external cron hitting the standalone deployment, or by the operator.
 */

const relayerPromise = createRelayer({ env: process.env, startWatcher: false });

export default async function handler(request: Request): Promise<Response> {
  const { app } = await relayerPromise;
  return app.fetch(request);
}

export const config = { runtime: 'nodejs' };
