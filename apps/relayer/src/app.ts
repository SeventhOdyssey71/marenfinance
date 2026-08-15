import { Hono } from 'hono';
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { resolveClientIp } from './clientip.js';
import { isRelayError, RelayError } from './errors.js';
import { hashIp, newRequestId, type Logger } from './logger.js';
import { settlementHttpStatus } from './receipt.js';
import type { RelayerService } from './service.js';

/**
 * HTTP surface. Four endpoints, no more.
 *
 * Everything that decides anything lives in service.ts; this file only moves
 * values between HTTP and that service, and turns typed `RelayError`s into
 * responses. There is no business logic in a handler, because logic in a handler
 * is logic that only one of the two deployment targets (standalone, Vercel) gets
 * exercised against.
 */

export interface AppDeps {
  readonly service: RelayerService;
  readonly logger: Logger;
  /** Overridable so tests can drive socket-address resolution deterministically. */
  readonly socketIp?: (c: Context) => string | undefined;
}

type Vars = { requestId: string };

/** BigInt-safe JSON. bigint values are emitted as decimal strings. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

/**
 * The socket peer address, when the runtime exposes one.
 *
 * `@hono/node-server` provides it; the Vercel adapter does not, which is exactly
 * why `RELAYER_CLIENT_IP_HEADER` defaults to the platform's unforgeable header
 * there. Anything that throws or is absent resolves to `undefined`, and
 * `resolveClientIp` then falls back to the shared `unknown` bucket.
 */
function defaultSocketIp(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

export function buildApp(deps: AppDeps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();
  const { service, logger } = deps;

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? newRequestId();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    const started = Date.now();
    await next();
    logger.info(
      {
        event: 'http',
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - started,
      },
      'request complete',
    );
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId');
    if (isRelayError(err)) {
      logger.warn(
        { event: 'error', requestId, code: err.code, status: err.status },
        err.message,
      );
      return c.json({ ...err.toJSON(), requestId }, err.status as 400);
    }
    // Unexpected failures never leak an internal message to the client — a stack
    // trace from a signing path is exactly the thing not to hand out.
    logger.error({ event: 'error.unhandled', requestId, err }, 'unhandled error');
    return c.json(
      { error: 'UPSTREAM_ERROR', detail: 'internal error', meta: {}, requestId },
      500,
    );
  });

  // --- POST /relay ---------------------------------------------------------
  app.post('/relay', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new RelayError('MALFORMED_REQUEST', 400, 'body is not valid JSON');
    }
    const resolved = resolveClientIp({
      socketIp: (deps.socketIp ?? defaultSocketIp)(c),
      header: (name) => c.req.header(name),
      trustedProxies: service.config.trustedProxies,
      platformHeader: service.config.clientIpHeader,
    });
    const result = await service.relay(body, {
      requestId: c.get('requestId'),
      // Hashed here: the raw address never reaches the service or the logger.
      ipHash: hashIp(resolved.ip, service.config.ipSalt),
      ipSource: resolved.source,
    });
    // 202, not 200. The transaction is broadcast, not delivered (R15). Poll
    // `statusUrl` until `state === 'confirmed'` before telling a user anything
    // happened.
    return c.json(jsonSafe(result) as Record<string, unknown>, 202);
  });

  // --- GET /status/:hash ---------------------------------------------------
  app.get('/status/:hash', async (c) => {
    const settlement = await service.status(c.req.param('hash'));
    return c.json(
      jsonSafe(settlement) as Record<string, unknown>,
      settlementHttpStatus(settlement.state),
    );
  });

  // --- GET /quota/:address -------------------------------------------------
  app.get('/quota/:address', async (c) => {
    const quota = await service.quota(c.req.param('address'));
    return c.json(jsonSafe(quota) as Record<string, unknown>, 200);
  });

  // --- GET /health ---------------------------------------------------------
  app.get('/health', async (c) => {
    const health = await service.health();
    // 503 when not accepting, so a load balancer takes us out rather than
    // sending traffic at a relayer that will refuse it.
    return c.json(jsonSafe(health) as Record<string, unknown>, health.accepting ? 200 : 503);
  });

  app.notFound((c) =>
    c.json({ error: 'NOT_FOUND', detail: 'no such endpoint', meta: {} }, 404),
  );

  return app;
}
