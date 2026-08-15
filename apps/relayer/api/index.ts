import { createRelayer } from '../src/create.js';

/**
 * Vercel Functions entrypoint — NOT A SUPPORTED DEPLOYMENT TARGET.
 *
 * This file and `vercel.json` are kept as the skeleton of a serverless target,
 * but the relayer REFUSES TO RELAY when it detects `VERCEL` (see create.ts).
 * Deploying this gives you a service that answers `/health` with 503 and
 * explains why. That is deliberate: the alternative is a relayer that looks
 * healthy and quietly delivers a fraction of the configured budget.
 *
 * What is missing, and what would have to change to lift the refusal:
 *
 *   1. `reconcile()` — settlement reconciliation runs only from the stuck
 *      transaction sweep, which needs a process that outlives a request. Without
 *      it a reservation permanently holds the signer-chosen
 *      `request.gas * maxFeePerGas` rather than converging on real cost,
 *      measured at ~25x. The daily cap would then buy ~1/25 of the sponsored
 *      transactions an operator configured, with nothing to indicate it.
 *   2. `retryPendingRefunds()` — the deferred-refund queue is an in-process
 *      array. An instance recycle erases it, so a refund the store rejected is
 *      lost while the reservation stays debited in shared storage, and `/health`
 *      comes back clean. A silent day-long outage having spent nothing.
 *   3. Nonce allocation is serialised per instance only.
 *
 * Fixing (1) and (2) means moving both onto a durable trigger — a cron route, or
 * persisting the refund queue in the same store as the counters — not simply
 * calling them at the head of a request, because neither has a request to
 * attach to when there is no traffic.
 *
 * Until then: run the standalone server (`pnpm --filter @maren/relayer start`).
 */

const relayerPromise = createRelayer({ env: process.env, startWatcher: false });

export default async function handler(request: Request): Promise<Response> {
  const { app } = await relayerPromise;
  return app.fetch(request);
}

export const config = { runtime: 'nodejs' };
