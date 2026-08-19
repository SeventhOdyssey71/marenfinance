import { defineChain } from 'viem';

/**
 * Mezo chain definitions.
 *
 * VERIFIED LIVE 2026-08-15 via `cast chain-id`:
 *   https://jsonrpc-mezo.boar.network -> 31612
 *   https://rpc.test.mezo.org         -> 31611
 *
 * WARNING: several official Mezo doc pages list RPC hosts that do NOT resolve
 * (`rpc.mezo.org`, `testnet-rpc.mezo.org`). Do not "fix" these URLs to match the
 * docs without re-running `cast chain-id` against them first.
 * Authoritative source: https://github.com/mezo-org/chains
 *
 * Native gas currency is BTC with 18 decimals (NOT 8 — this is an EVM chain and
 * BTC is the gas token, so it follows the 18-decimal EVM convention).
 */

/** Mezo mainnet. Chain ID 31612 (0x7b7c). */
export const mezoMainnet = defineChain({
  id: 31612,
  name: 'Mezo',
  network: 'mezo',
  nativeCurrency: {
    name: 'Bitcoin',
    symbol: 'BTC',
    decimals: 18,
  },
  rpcUrls: {
    // All three verified 2026-08-15 by executing a real eth_call
    // (TroveManager.getTroveOwnersCount() -> 26), not merely eth_chainId.
    //
    // ORDER MATTERS, AND FAILOVER IS NOT OPTIONAL.
    // Mezo's public RPCs are transiently flaky. During testing, mezo.drpc.org returned
    //   -32601 "the method ... does not exist/is not available"
    // for eth_call, eth_getLogs, eth_estimateGas and eth_blockNumber across a full probe
    // sweep — and then served all of them correctly 10/10 about an hour later. The
    // methods are supported; a backend behind the load balancer was degraded and
    // reported "unsupported" rather than "unavailable", which is indistinguishable from
    // a capability limit if you probe once.
    //
    // Two consequences, both load-bearing:
    //   1. Never certify or condemn an endpoint on a single probe. Repeat it.
    //   2. Every client MUST use failover across this list rather than pinning one URL.
    //      A -32601 is not proof of a missing feature on this chain.
    //
    // boar is first because it was stable throughout. drpc is retained because it is the
    // only endpoint advertising WebSocket, which live position-health subscriptions want.
    default: {
      http: [
        'https://jsonrpc-mezo.boar.network',
        'https://mainnet.mezo.public.validationcloud.io',
        'https://mezo.drpc.org',
      ],
    },
    public: {
      http: [
        'https://jsonrpc-mezo.boar.network',
        'https://mainnet.mezo.public.validationcloud.io',
        'https://mezo.drpc.org',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'Mezo Explorer',
      url: 'https://explorer.mezo.org',
      // Blockscout REST v2 lives on the `api.` subdomain.
      // `explorer.mezo.org/api/v2/...` returns 404 — verified.
      apiUrl: 'https://api.explorer.mezo.org/api',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      // Bisected on-chain: no code at 351759, code at 351760.
      blockCreated: 351760,
    },
  },
  testnet: false,
});

/** Mezo testnet, a.k.a. "matsnet". Chain ID 31611 (0x7b7b). */
export const mezoTestnet = defineChain({
  id: 31611,
  name: 'Mezo Matsnet',
  network: 'mezo-matsnet',
  nativeCurrency: {
    name: 'Bitcoin',
    symbol: 'BTC',
    decimals: 18,
  },
  rpcUrls: {
    // Two endpoints, in this order, and the order is load-bearing for the same reason it
    // is on mainnet: a client pinned to one URL has no answer for the hour that URL is
    // degraded.
    //
    // rpc.test.mezo.org is primary and stays primary. It answered every method in a
    // repeated sweep on 2026-08-18: eth_call, eth_blockNumber and a 10,000-block
    // eth_getLogs, 5/5 each.
    //
    // mezo-testnet.drpc.org is second, VERIFIED 2026-08-18 rather than copied from a doc
    // page: eth_chainId -> 0x7b7b (31611), and MUSD.symbol() at
    // 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 returned a response byte-identical to the
    // primary's, decoding to "MUSD". Its head tracked the primary's within one block.
    //
    // ONE MEASURED CAVEAT, recorded rather than hidden: on the free tier it answered a
    // 10,000-block eth_getLogs only 3 times in 5, failing the other two with
    // `Request timeout on the free plan, please upgrade`. Per this file's own rule that is
    // not grounds to drop it — it serves every other method reliably, and a log scan that
    // fails is reported to the user as unknown rather than as an empty history. It is
    // second, never first, precisely because of this.
    //
    // A SECOND MEASURED CAVEAT, and this one cuts the other way. On 2026-08-19 the PRIMARY
    // returned a MarenPay log from eth_getLogs and then `result: null` from
    // eth_getTransactionReceipt for that same transaction hash
    // (0x059f329fda15d6eb430d514040f7060fe41b354eac478c2c9ad4e5dba490559a), while the
    // secondary returned the full receipt, including the very log the primary had just
    // served. The two endpoints disagree about a mined transaction, and the primary is the
    // one that was wrong.
    //
    // The consequence for readers, and it is not optional: A MISSING RECEIPT IS NOT A
    // MISSING HISTORY. Both log readers (apps/web and apps/ios, chain/logs.ts) absorb a
    // per-transaction receipt failure and mark that ROW as awaiting a receipt, rather than
    // failing the whole scan. Failing the scan turned one inconsistent row into "we could
    // not read your history", which is the worst available answer and was also a false one.
    default: { http: ['https://rpc.test.mezo.org', 'https://mezo-testnet.drpc.org'] },
    public: { http: ['https://rpc.test.mezo.org', 'https://mezo-testnet.drpc.org'] },
  },
  blockExplorers: {
    default: {
      name: 'Mezo Matsnet Explorer',
      url: 'https://explorer.test.mezo.org',
      apiUrl: 'https://api.explorer.test.mezo.org/api',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
  testnet: true,
});

export type MezoNetwork = 'mainnet' | 'testnet';

export const MEZO_CHAINS = {
  mainnet: mezoMainnet,
  testnet: mezoTestnet,
} as const;

export const MEZO_CHAIN_IDS = {
  mainnet: 31612,
  testnet: 31611,
} as const;

/** Resolve the active network from env, defaulting to testnet for safety. */
export function resolveNetwork(value: string | undefined): MezoNetwork {
  return value === 'mainnet' ? 'mainnet' : 'testnet';
}

export function getChain(network: MezoNetwork) {
  return MEZO_CHAINS[network];
}
