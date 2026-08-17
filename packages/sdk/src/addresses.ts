import type { Address } from 'viem';
import type { MezoNetwork } from './chains';

/**
 * MUSD protocol addresses on Mezo.
 *
 * PROVENANCE — these were verified three independent ways before being committed:
 *   1. `mezo-org/musd` repo deployment artifacts (solidity/artifacts/deployments/)
 *   2. The OpenZeppelin proxy manifest (solidity/.openzeppelin/unknown-31612.json), 14/14 match
 *   3. Live `eth_getCode` + functional calls against both RPCs
 *
 * Spot-checked live on 2026-08-15:
 *   MUSD.symbol()                -> "MUSD"   (both networks)
 *   MUSD.decimals()              -> 18
 *   BorrowerOperations.minNetDebt() -> 1.8e21
 *   TroveManager.MCR()           -> 1.1e18
 *   TroveManager.CCR()           -> 1.5e18
 *
 * All core contracts are TransparentUpgradeableProxy — always integrate against the
 * proxy address below, never an implementation address.
 *
 * DO NOT edit these by hand. Re-derive from @mezo-org/musd-contracts and re-verify
 * on-chain. A wrong address here silently sends user funds nowhere.
 */
export interface MusdAddresses {
  musd: Address;
  borrowerOperations: Address;
  borrowerOperationsSignatures: Address;
  troveManager: Address;
  stabilityPool: Address;
  priceFeed: Address;
  sortedTroves: Address;
  hintHelpers: Address;
  activePool: Address;
  defaultPool: Address;
  collSurplusPool: Address;
  gasPool: Address;
  pcv: Address;
  interestRateManager: Address;
  governableVariables: Address;
}

const MAINNET: MusdAddresses = {
  musd: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
  borrowerOperations: '0x44b1bac67dDA612a41a58AAf779143B181dEe031',
  borrowerOperationsSignatures: '0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a',
  troveManager: '0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193',
  stabilityPool: '0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32',
  priceFeed: '0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88',
  sortedTroves: '0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f',
  hintHelpers: '0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3',
  activePool: '0x3012C2fE1240e3754E5C200A0946bb0E07474876',
  defaultPool: '0xE4B5913C0c82dB2eFC553b95c0173efb90a07c8B',
  collSurplusPool: '0xBF51807ACb3394B8550f0554FB9098856Ef5F491',
  gasPool: '0x3EB418BdBE95b4b9cf465ecfBD8424685ACD1Bc1',
  pcv: '0x391EcC7ffEFc48cff41D0F2Bb36e38b82180B993',
  interestRateManager: '0x4a453700d157717Fe02fB62E7700ED7845048285',
  governableVariables: '0x560AC4Ea44Fb7EB2D4d3c00608CB1CAb2613d389',
};

const TESTNET: MusdAddresses = {
  musd: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  borrowerOperations: '0xCdF7028ceAB81fA0C6971208e83fa7872994beE5',
  borrowerOperationsSignatures: '0xD757e3646AF370b15f32EB557F0F8380Df7D639e',
  troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
  stabilityPool: '0x1CCA7E410eE41739792eA0A24e00349Dd247680e',
  priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366',
  sortedTroves: '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA',
  hintHelpers: '0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6',
  activePool: '0x143A063F62340DA3A8bEA1C5642d18C6D0F7FF51',
  defaultPool: '0x59851D252090283f9367c159f0C9036e75483300',
  collSurplusPool: '0xB4C35747c26E4aB5F1a7CdC7E875B5946eFa6fa9',
  gasPool: '0x8fa3EF45137C3AFF337e42f98023C1D7dd3666C0',
  pcv: '0x4dDD70f4C603b6089c07875Be02fEdFD626b80Af',
  interestRateManager: '0xD4D6c36A592A2c5e86035A6bca1d57747a567f37',
  governableVariables: '0x6552059B6eFc6aA4AE3ea45f28ED4D92acE020cD',
};

export const MUSD_ADDRESSES: Record<MezoNetwork, MusdAddresses> = {
  mainnet: MAINNET,
  testnet: TESTNET,
};

export function getMusdAddresses(network: MezoNetwork): MusdAddresses {
  return MUSD_ADDRESSES[network];
}

/**
 * Multicall3 at the canonical cross-chain address.
 * VERIFIED live 2026-08-15: 7,619 bytes of code present on BOTH 31612 and 31611.
 */
export const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

/**
 * Mezo's BTC/USD price oracle is a NATIVE CHAIN PRECOMPILE, not a deployed
 * Chainlink/Pyth contract. It implements only `decimals()` and `latestRoundData()`
 * from ChainlinkAggregatorV3Interface — `description()` reverts.
 * Source: github.com/mezo-org/mezod/precompile/priceoracle/
 */
export const MEZO_PRICE_ORACLE_PRECOMPILE: Address = '0x7b7c000000000000000000000000000000000015';

/** The BTC gas-token precompile on Mezo. */
export const MEZO_BTC_PRECOMPILE: Address = '0x7b7C000000000000000000000000000000000000';

/** The MEZO token precompile. */
export const MEZO_TOKEN_PRECOMPILE: Address = '0x7B7c000000000000000000000000000000000001';

/**
 * x402 — Mezo's first-party gasless MUSD payment rail. LIVE ON MAINNET.
 *
 * The buyer signs ONE EIP-712 message (MUSD is permit2 + EIP-2612) and the facilitator
 * settles on-chain. No on-chain approval, no gas on the buyer's side.
 *
 * VERIFIED live 2026-08-15: settlement proxy has 5,829 bytes of code on mainnet.
 * Docs: https://mezo.org/docs/developers/getting-started/musd-payments-x402/
 * SDK:  @x402/evm >= 2.15.0
 *
 * Same settlement address on both networks. CAIP-2: eip155:31612 / eip155:31611.
 */
export const X402_SETTLEMENT: Address = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001';
export const X402_FACILITATOR_URL = 'https://facilitator.vativ.io';

/** Uniswap Permit2, canonical address. Deployed on Mezo. */
export const PERMIT2_ADDRESS: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/**
 * ERC-4337 EntryPoint v0.7 IS deployed here (verified: 32,073 bytes, byte-identical
 * to Ethereum L1) — but it is INERT. Per the Mezo block explorer's index it has never
 * processed a single UserOperation (zero transactions, no logs; verified against a control
 * read of MUSD, which returns 104,681, so the empty result is not an indexer artefact),
 * and Mezo's RPCs do not implement `debug_traceCall`, so no ERC-7562-compliant bundler
 * can run against it.
 *
 * Recorded here ONLY so nobody rediscovers it and concludes 4337 is a viable path.
 * It is not. Maren uses EIP-2612 permit + ERC-2771 relaying, with EIP-7702 as the
 * upgrade path. See docs/ARCHITECTURE.md §4.
 */
export const ERC4337_ENTRYPOINT_V07_INERT: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/**
 * Maren's own deployments. Populated by `packages/contracts/script/Deploy.s.sol`,
 * which writes back to this file's companion JSON. Zero address = not yet deployed.
 */
export interface MarenAddresses {
  marenVault: Address;
  marenPay: Address;
  marenForwarder: Address;
  marenRegistry: Address;
  marenEarn: Address;
}

const ZERO = '0x0000000000000000000000000000000000000000' as const;

export const MAREN_ADDRESSES: Record<MezoNetwork, MarenAddresses> = {
  mainnet: {
    marenVault: ZERO,
    marenPay: ZERO,
    marenForwarder: ZERO,
    marenRegistry: ZERO,
    marenEarn: ZERO,
  },
  // Deployed to Mezo matsnet on 2026-08-15 from
  // 0x54196397D6f01b48739dB3957257cB33cD341885, and source-verified on Blockscout.
  // Runtime bytecode sizes were checked against the local build before these were
  // written here: Vault 14,508 · Earn 11,396 · Pay 9,264 · RelayHub 7,934 ·
  // Registry 4,742. See docs/DEPLOYMENTS.md for tx hashes.
  testnet: {
    marenVault: '0x46252B00AB59384518d9dB6D1f210ffF1221645b',
    marenPay: '0xe475Ff919D54E055809f516E3bed8a5c7a101836',
    // MarenRelayHub extends MarenForwarder and is the single trusted forwarder;
    // the standalone forwarder is deliberately not deployed. Verified on-chain:
    // MarenPay.trustedForwarder() returns this address.
    marenForwarder: '0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C',
    marenRegistry: '0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E',
    marenEarn: '0xE3B02b215085B99Ce61E0F5ea9763Ac637aa7826',
  },
};

export function getMarenAddresses(network: MezoNetwork): MarenAddresses {
  return MAREN_ADDRESSES[network];
}

export function isDeployed(address: Address): boolean {
  return address !== ZERO;
}

/**
 * The block Maren's contracts first existed at, per network.
 *
 * This is the floor for any `eth_getLogs` scan: there is provably no Maren history
 * before it, so a reader that starts here and finds nothing has read ALL of the
 * history, not merely a recent slice. That distinction is the whole reason this
 * constant exists — Activity has to be able to say "you have done nothing yet"
 * without ever implying "we only looked at the last few hours".
 *
 * PROVENANCE — derived on 2026-08-16 by bisecting `eth_getCode` against
 * https://rpc.test.mezo.org, not copied from a deploy log:
 *
 *   MarenRegistry 14,911,471 · MarenPay 14,911,472
 *   MarenVault    14,911,473 · MarenEarn 14,911,474
 *
 * The value below is the earliest of those, so one floor covers every contract.
 *
 * Mainnet is `null` because Maren is not deployed there — the addresses above are
 * genuinely all zeroes. `null` means "there is no history to read", which callers must
 * handle as an unavailable state rather than as an empty one.
 */
export const MAREN_DEPLOYMENT_BLOCK: Record<MezoNetwork, bigint | null> = {
  mainnet: null,
  testnet: 14_911_471n,
};

export function getDeploymentBlock(network: MezoNetwork): bigint | null {
  return MAREN_DEPLOYMENT_BLOCK[network];
}

/**
 * The widest `[fromBlock, toBlock]` span Mezo's public RPC will answer in one call.
 *
 * Measured, not assumed: a wider range returns
 * `{"code":-32000,"message":"maximum [from, to] blocks distance: 10000"}`.
 * At matsnet's ~4.7s blocks that is roughly 13 hours per request, which is what forces
 * a log reader to walk backwards in windows rather than asking for everything at once.
 */
export const MEZO_MAX_LOG_RANGE = 10_000n;
