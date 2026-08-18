import { getChain, type MezoNetwork } from '@maren/sdk';
import { createPublicClient, fallback, http, type Chain, type PublicClient } from 'viem';

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
  return chain.rpcUrls.default.http.map((url) => http(url, { timeout, retryCount: 0 }));
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
