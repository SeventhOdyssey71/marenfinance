import { serve, type ServerType } from '@hono/node-server';
import { createRelayer } from './create.js';

/**
 * Standalone entrypoint: `pnpm dev` / `pnpm start`.
 *
 * This is the deployment shape that gets the stuck-transaction sweeper, because
 * it is the one with a process that outlives a request.
 */

const relayer = await createRelayer({ env: process.env, startWatcher: true });
const { app, service, config, logger } = relayer;

const server: ServerType = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(
    { event: 'server.listening', port: info.port, accepting: service.accepting },
    service.accepting
      ? `relayer listening on :${info.port}`
      : `relayer listening on :${info.port} but REFUSING to relay — GET /health for why`,
  );
});

/**
 * Graceful shutdown.
 *
 * Order matters: stop accepting connections, then drain. Draining first would
 * let new work arrive during the drain and never finish. `service.drain` waits
 * on in-flight *broadcasts* — a transaction already in the mempool does not need
 * this process to survive, but a request that is between "nonce allocated" and
 * "broadcast returned" absolutely does, and killing it there is how you get a
 * nonce gap that stalls every later transaction.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'server.shutdown', signal }, 'shutting down');

  server.close();
  await service.drain(config.shutdownDrainMs);
  relayer.watcher?.stop();

  logger.info({ event: 'server.stopped' }, 'stopped');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandledRejection', err: reason }, 'unhandled rejection');
});
