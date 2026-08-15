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
    // Both endpoints verified 2026-08-15 by executing a real eth_call
    // (TroveManager.getTroveOwnersCount() -> 26), not merely eth_chainId.
    //
    // DO NOT ADD https://mezo.drpc.org HERE.
    // Its public endpoint answers eth_chainId and NOTHING ELSE. Probed method by
    // method on 2026-08-15: eth_blockNumber, eth_getBalance, eth_call, eth_estimateGas,
    // eth_getLogs and eth_getBlockByNumber all return
    //   -32601 "the method ... does not exist/is not available"
    // It requires an API key for everything except chain identification, so a
    // `cast chain-id` smoke test passes against it while the entire application fails.
    // This is exactly the trap that put a dead RPC into viem's shipped Mezo definition.
    default: {
      http: [
        'https://jsonrpc-mezo.boar.network',
        'https://mainnet.mezo.public.validationcloud.io',
      ],
    },
    public: {
      http: [
        'https://jsonrpc-mezo.boar.network',
        'https://mainnet.mezo.public.validationcloud.io',
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
    default: { http: ['https://rpc.test.mezo.org'] },
    public: { http: ['https://rpc.test.mezo.org'] },
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
