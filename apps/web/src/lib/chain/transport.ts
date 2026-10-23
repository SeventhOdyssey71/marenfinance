import { getChain, type MezoNetwork } from '@maren/sdk';
import {
  createPublicClient,
  fallback,
  http,
  webSocket,
  type Chain,
  type PublicClient,
  type Transport,
} from 'viem';

/**
 * How this app talks to Mezo.
 *
 * ONE ENDPOINT IS NOT A CONFIGURATION, IT IS A SINGLE POINT OF FAILURE. `packages/sdk`'s
 * chain definitions list Mezo's RPCs in a deliberate order and say, at length, why
 * failover across that list is mandatory: these hosts are transiently flaky, and one of
 * them has been observed answering `-32601 method not found` for methods it fully
 * supports, then serving them correctly an hour later. A client pinned to `http()` with no
 * URL takes the first entry and nothing else, so every one of those hours is an outage for
 * the user rather than a hiccup.
 *
 * So every client in the app is built here, from `fallback()` over the whole list.
 *
 * WHY `rank: false`. viem can reorder a fallback list by observed latency. That would
 * quietly overrule the ordering `chains.ts` argues for — boar first because it was stable
 * throughout testing, drpc last because it is the one that went strange — and swap in a
 * marginally faster host that has already demonstrated it can start lying about which
 * methods exist. Stability is worth more than 40ms here, so the order stays as written.
 *
 * THE TIMEOUTS ARE MEASURED, NOT GUESSED. Against matsnet on 2026-08-18:
 *
 *   eth_blockNumber / eth_call     ~170-300ms
 *   eth_getLogs over 10,000 blocks ~0.9-1.8s
 *
 * A single budget for both would have to be sized for the log scan, which would mean a
 * hung endpoint holding an interactive read for the better part of ten seconds. So there
 * are two, and the split is exactly the measurement above: interactive reads get 2s, which
 * is roughly seven times the observed latency and still moves to the next endpoint inside
 * two seconds when one dies; log scans get 8s, because a 1.8s request that failed over at
 * 2s would be a self-inflicted outage on a healthy network.
 */

/** Interactive reads: balances, positions, the oracle, handle resolution. */
export const READ_TIMEOUT_MS = 2_000;

/**
 * Log scans. Wider on purpose — see above. Still bounded, because an `eth_getLogs` that
 * has not answered in eight seconds is not going to.
 */
export const LOG_TIMEOUT_MS = 8_000;

/**
 * THE ORDER, MEASURED 2026-10-23 against matsnet (rpc-bench, 25-30 rounds per call):
 *
 *                                  eth_call p50   20 in parallel   JSON-RPC batch   head
 *   wss://rpc-ws.test.mezo.org     ~250ms         0 failed          n/a (one socket) 0
 *   https://rpc.test.mezo.org      ~450ms         0 failed          yes, to 200      0
 *   https://mezo-testnet.drpc.org  ~600ms         up to 11/20 fail  no               1-4 behind
 *
 * So the socket goes first: the same read costs about half as long once it is open, and
 * one connection carries every request instead of a TLS session per burst. Mezo's HTTP is
 * the failover and batches whatever multicall cannot (balances, receipts, log pages) into
 * one round trip. drpc stays last: on the free tier it answers bursts with spurious
 * `-32601 method does not exist`, rejects batches outright and trails the head.
 *
 * A dead socket costs nothing extra: the request errors and `fallback()` moves to HTTP,
 * exactly as it would past a dead HTTP host. viem reconnects the socket in the background.
 */

/**
 * JSON-RPC batching, only where it was measured to work. A batch sent to a host that does
 * not support it fails EVERY call inside it, so this is an allowlist, never a default:
 * drpc's free tier answered every batch with an error for each entry.
 */
const BATCHES = new Set(['https://rpc.test.mezo.org']);

/**
 * A socket with a deadline, because viem's has none for connecting.
 *
 * viem resolves the socket on `open` and rejects on `error`, and only starts a request's
 * timeout once the socket is open. A connection that STALLS (a proxy that takes the TCP
 * connection and never finishes the upgrade, a captive portal, a socket that closes
 * before opening without raising an error) therefore holds every request forever, and
 * `fallback()` never gets the failure it needs to move on. Measured on this app with the
 * socket blocked: /app sat sixty seconds with no data and made no HTTP request at all.
 *
 * So each request races the transport's own timeout, and a socket that misses it is
 * skipped outright for a cooling-off period that doubles each time (30s up to 5min).
 * Skipping is an instant rejection, so the fallback goes straight to HTTP instead of
 * paying the deadline again on every read. viem keeps connecting in the background; if
 * the socket opens later, the next attempt after the cool-off finds it ready.
 */
class SocketDeadlineError extends Error {
  constructor(url: string, reason: string) {
    super(`${url}: ${reason}`);
    this.name = 'SocketDeadlineError';
  }
}

function deadlineSocket(url: string, timeout: number): Transport {
  const inner = webSocket(url, {
    timeout,
    retryCount: 0,
    // A ping every 30s keeps idle proxies from dropping the socket between refetches.
    keepAlive: { interval: 30_000 },
    reconnect: { attempts: 5, delay: 2_000 },
  });
  let skipUntil = 0;
  let coolOff = 30_000;

  return (config) => {
    const transport = inner(config);
    return {
      ...transport,
      async request(args) {
        if (Date.now() < skipUntil) throw new SocketDeadlineError(url, 'cooling off');
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new SocketDeadlineError(url, 'deadline')), timeout);
        });
        try {
          const result = await Promise.race([transport.request(args), deadline]);
          coolOff = 30_000;
          return result;
        } catch (error) {
          if (error instanceof SocketDeadlineError || /socket/i.test(String(error))) {
            skipUntil = Date.now() + coolOff;
            coolOff = Math.min(coolOff * 2, 300_000);
          }
          throw error;
        } finally {
          clearTimeout(timer);
        }
      },
    } as ReturnType<Transport>;
  };
}

/**
 * Retries are the FALLBACK's job, not the individual transport's.
 *
 * viem's `http()` retries a failed request against the same URL. Layering that under
 * `fallback()` multiplies the wait before the next endpoint is even tried: at three
 * endpoints and viem's default of three retries apiece, a total outage takes twelve
 * attempts to discover. `retryCount: 0` here means a failure moves ON rather than digging
 * in, and one whole-list retry is applied at the fallback level for the case where every
 * endpoint blinked at once.
 */
function endpoints(chain: Chain, timeout: number) {
  const sockets = (chain.rpcUrls.default.webSocket ?? []).map((url) =>
    deadlineSocket(url, timeout),
  );
  const https = chain.rpcUrls.default.http.map((url) =>
    http(url, {
      timeout,
      retryCount: 0,
      // 16ms gathers one render's worth of stray reads; 50 is a quarter of the measured cap.
      batch: BATCHES.has(url) ? { batchSize: 50, wait: 16 } : false,
    }),
  );
  return [...sockets, ...https];
}

export function mezoTransport(chain: Chain, timeout: number = READ_TIMEOUT_MS) {
  return fallback(endpoints(chain, timeout), {
    rank: false,
    retryCount: 1,
    retryDelay: 250,
  });
}

/**
 * A client for the one thing that is legitimately slow.
 *
 * `readActivity` walks the chain in 10,000-block windows, and those requests take about a
 * second each on a healthy node. Running them through the app's 2s interactive budget
 * would put them one bad second away from being failed over on a network that is working
 * perfectly, so they get their own client with the wider timeout rather than the whole app
 * inheriting a budget sized for the slowest thing it does.
 *
 * Memoised per network: a new client per render would throw away viem's request
 * deduplication and, with `fallback`, its knowledge of which endpoint answered last.
 */
const logClients = new Map<MezoNetwork, PublicClient>();

/**
 * One client per endpoint, in the order `chains.ts` argues for.
 *
 * WHY `fallback()` IS NOT ENOUGH FOR EVERYTHING. viem's fallback moves on when a request
 * FAILS. `eth_getTransactionReceipt` for a transaction the node does not have does not
 * fail: it answers `{"result": null}`, a perfectly successful JSON-RPC response, and viem
 * raises `TransactionReceiptNotFoundError` at the action layer afterwards. The transport
 * never saw a problem, so it never failed over.
 *
 * Measured on 2026-08-19, that is not hypothetical. https://rpc.test.mezo.org served a
 * MarenPay log and then `null` for that same transaction's receipt, while
 * https://mezo-testnet.drpc.org returned the receipt in full, containing the very log the
 * primary had just served. Three of five rows on the test account's Activity screen read
 * "awaiting receipt" for transactions confirmed days earlier.
 *
 * `chains.ts` states the rule this answers: "Never certify or condemn an endpoint on a
 * single probe. Repeat it." An empty answer is such a probe.
 */
const endpointClients = new Map<MezoNetwork, PublicClient[]>();

export function getEndpointClients(network: MezoNetwork): PublicClient[] {
  const existing = endpointClients.get(network);
  if (existing) return existing;

  const chain = getChain(network);
  const clients = chain.rpcUrls.default.http.map(
    (url) =>
      createPublicClient({
        chain,
        transport: http(url, { timeout: LOG_TIMEOUT_MS, retryCount: 0 }),
      }) as PublicClient,
  );

  endpointClients.set(network, clients);
  return clients;
}

export function getLogClient(network: MezoNetwork): PublicClient {
  const existing = logClients.get(network);
  if (existing) return existing;

  const chain = getChain(network);
  const client = createPublicClient({
    chain,
    transport: mezoTransport(chain, LOG_TIMEOUT_MS),
  }) as PublicClient;

  logClients.set(network, client);
  return client;
}
