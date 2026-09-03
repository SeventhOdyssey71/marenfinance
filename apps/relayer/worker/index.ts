// Cloudflare Worker entrypoint for the Maren relayer.
//
// The Worker is a thin front door. Every request is routed to ONE named Durable
// Object instance, which is where the relayer actually lives (see relayer-do.ts).
// That single-instance routing is what makes the nonce sequence and daily budget
// authoritative — two instances would race nonces and each believe it owns the
// whole budget.

import { RelayerDO, type WorkerEnv } from './relayer-do.js';

export { RelayerDO };

// A fixed name → the one and only relayer instance. All traffic and the Cron
// sweep address the same DO id.
const SINGLETON = 'maren-relayer-singleton';

function relayer(env: WorkerEnv): DurableObjectStub<RelayerDO> {
  return env.RELAYER.get(env.RELAYER.idFromName(SINGLETON));
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return relayer(env).fetch(request);
  },

  // Cron backstop for the settlement sweep. The DO's own alarm is the primary
  // timer; this ensures the sweep still resumes after an idle instance with no
  // alarm armed. Schedule in wrangler.jsonc `triggers.crons`.
  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    await relayer(env).sweepNow();
  },
} satisfies ExportedHandler<WorkerEnv>;
