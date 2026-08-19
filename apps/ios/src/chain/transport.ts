import { getChain, type MezoNetwork } from '@maren/sdk';
import { createPublicClient, fallback, http, type Chain, type PublicClient } from 'viem';

/**
 * How this app talks to Mezo.
 *
 * The reasoning is the web app's, in `apps/web/src/lib/chain/transport.ts`, and it is
 * repeated here rather than shared because the two runtimes differ in ways that matter
 * below. The parts that are the same are the same on purpose:
 *
 * ONE ENDPOINT IS NOT A CONFIGURATION, IT IS A SINGLE POINT OF FAILURE. `packages/sdk`'s
 * chain definitions list Mezo's RPCs in a deliberate order and record, at length, why
 * failover across that list is mandatory: these hosts are transiently flaky, and one has
 * been observed answering `-32601 method not found` for methods it fully supports and
 * then serving them correctly an hour later. A client pinned to one URL turns that hour
 * into an outage for the user.
 *
 * WHY `rank: false`. viem can reorder a fallback list by observed latency, which would
 * quietly overrule the ordering `chains.ts` argues for. Stability is worth more than a
 * few tens of milliseconds on a phone, so the order stays as written.
 *
 * TWO BUDGETS, NOT ONE. Interactive reads and log scans have different shapes: an
 * `eth_call` answers in a few hundred milliseconds, a 10,000-block `eth_getLogs` takes
 * roughly one to two seconds. A single timeout sized for the scan would let a hung
 * endpoint hold a balance read for the better part of ten seconds, so there are two.
 * The mobile figures are wider than the web's by 50%: a phone on cellular adds latency
 * the desktop measurements never saw, and failing over an endpoint that was merely on a
 * slow radio makes the app worse rather than more robust.
 *
 * WHAT IS DIFFERENT FROM THE WEB. React Native has no `wagmi`, so nothing above this file
 * configures a client for us and nothing coalesces reads on our behalf. Both are handled
 * here: `batch.multicall` is set on the client itself, so the several `readContract`
 * calls a screen issues in the same tick leave the device as ONE `aggregate3` against
 * Multicall3 rather than as five round trips over a mobile link. That is the same
 * physical request the web produces through wagmi's batcher, arrived at differently.
 */

/** Interactive reads: balances, positions, the oracle, handle resolution. */
export const READ_TIMEOUT_MS = 3_000;

/** Log scans. Wider on purpose, and still bounded. */
export const LOG_TIMEOUT_MS = 12_000;

/**
 * How long viem may hold a batch open before sending it.
 *
 * Short enough to be invisible (a screen mounts its hooks within one tick) and long
 * enough that the four or five reads a screen makes land in the same `aggregate3`. Larger
 * values buy nothing here because nothing issues reads on a delay.
 */
const BATCH_WAIT_MS = 16;

/**
 * Retries are the FALLBACK's job, not the individual transport's.
 *
 * viem's `http()` retries against the same URL. Layered under `fallback()` that
 * multiplies the wait before the next endpoint is tried at all, so a total outage takes
 * many attempts to discover. `retryCount: 0` here means a failure moves ON, and one
 * whole-list retry is applied at the fallback level for the case where every endpoint
 * blinked at once.
 */
function endpoints(chain: Chain, timeout: number) {
  return chain.rpcUrls.default.http.map((url) => http(url, { timeout, retryCount: 0 }));
}

/**
 * The SDK's chain object, retyped as this app's `Chain`.
 *
 * It is the SAME OBJECT at runtime, and the cast is a build-graph artefact rather than a
 * claim about it. `@maren/sdk` and this app declare different TypeScript versions
 * (5.9 and Expo's 6.0), so pnpm gives each its own resolution of viem, and viem's `Chain`
 * is generic over formatter types that then compare as two unrelated structural types.
 * The alternative to this one-line cast is aligning the two TypeScript majors across the
 * monorepo, which is a change to how the iOS app builds and not something to slip into a
 * data-layer pass. It is confined to this function so no other file has to know.
 */
function appChain(network: MezoNetwork): Chain {
  return getChain(network) as unknown as Chain;
}

export function mezoTransport(chain: Chain, timeout: number = READ_TIMEOUT_MS) {
  return fallback(endpoints(chain, timeout), {
    rank: false,
    retryCount: 1,
    retryDelay: 250,
  });
}

/**
 * Clients are memoised per network.
 *
 * A new client per render would throw away viem's request deduplication, its batching
 * window, and `fallback`'s knowledge of which endpoint answered last. On a phone that is
 * the difference between one request per screen and one per hook.
 */
const readClients = new Map<MezoNetwork, PublicClient>();
const logClients = new Map<MezoNetwork, PublicClient>();

/** The client every interactive read goes through. Batches into Multicall3. */
export function getReadClient(network: MezoNetwork): PublicClient {
  const existing = readClients.get(network);
  if (existing) return existing;

  const chain = appChain(network);
  const client = createPublicClient({
    chain,
    transport: mezoTransport(chain, READ_TIMEOUT_MS),
    /**
     * Multicall3 is at the canonical address on both Mezo networks, and its presence was
     * verified on-chain rather than assumed. See `MULTICALL3_ADDRESS` in the SDK, and the
     * `blockCreated` bisection recorded in `chains.ts`.
     */
    batch: { multicall: { wait: BATCH_WAIT_MS } },
  }) as PublicClient;

  readClients.set(network, client);
  return client;
}

/**
 * One client per endpoint, in the order `chains.ts` argues for.
 *
 * WHY `fallback()` IS NOT ENOUGH FOR EVERYTHING. viem's fallback moves to the next
 * endpoint when a request FAILS. `eth_getTransactionReceipt` for a transaction the node
 * does not have does not fail: it answers `{"result": null}`, which is a perfectly
 * successful JSON-RPC response, and viem raises `TransactionReceiptNotFoundError` at the
 * action layer afterwards. The transport never saw a problem, so it never failed over.
 *
 * Measured on 2026-08-19, that is not hypothetical. https://rpc.test.mezo.org served a
 * MarenPay log and then `null` for that same transaction's receipt, while
 * https://mezo-testnet.drpc.org returned the receipt in full, containing the very log the
 * primary had just served. Three of five rows on the test account's Activity screen
 * therefore read "awaiting receipt" for transactions that were confirmed days earlier.
 *
 * `chains.ts` states the rule this answers: "Never certify or condemn an endpoint on a
 * single probe. Repeat it." An empty answer is exactly such a probe, so the receipt read
 * asks the next endpoint before believing it.
 */
const endpointClients = new Map<MezoNetwork, PublicClient[]>();

export function getEndpointClients(network: MezoNetwork): PublicClient[] {
  const existing = endpointClients.get(network);
  if (existing) return existing;

  const chain = appChain(network);
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

/**
 * A separate client for the one thing that is legitimately slow.
 *
 * `readActivityWindow` walks the chain in 10,000-block windows. Running those through the
 * interactive budget would fail them over on a network that is working perfectly.
 * Multicall batching is deliberately OFF here: `eth_getLogs` is not a contract call and
 * cannot be aggregated, so the batcher would only add a wait before each request.
 */
export function getLogClient(network: MezoNetwork): PublicClient {
  const existing = logClients.get(network);
  if (existing) return existing;

  const chain = appChain(network);
  const client = createPublicClient({
    chain,
    transport: mezoTransport(chain, LOG_TIMEOUT_MS),
  }) as PublicClient;

  logClients.set(network, client);
  return client;
}
