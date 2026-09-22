import { parseAbiItem } from 'viem';

/**
 * ABIs, transcribed from the deployed sources — never invented.
 *
 * Maren's own contracts live in `packages/contracts/src/*.sol`; the MUSD protocol
 * interfaces live in `packages/contracts/src/interfaces/*.sol` and were verified against
 * the live chain (see `packages/sdk/src/addresses.ts` for the provenance trail).
 *
 * Only the members the apps actually call are listed. Adding a function here without
 * finding it in the Solidity source is a bug, not a shortcut: a wrong selector fails at
 * the RPC with an error that reads exactly like a network problem.
 *
 * WHY THIS LIVES IN THE SDK RATHER THAN IN AN APP. It used to live in
 * `apps/web/src/lib/chain/abis.ts`, which was correct while exactly one app read the
 * chain. The iOS app now reads the same contracts, and two hand-maintained
 * transcriptions of the same Solidity is a bug with a delay fuse: one of them gets a
 * fix and the other keeps its selector, and the app that kept the old one fails with an
 * RPC error indistinguishable from a network fault. There is one copy, here, beside the
 * addresses it is called against. `apps/web/src/lib/chain/abis.ts` re-exports it so no
 * web import path changed.
 */

/** MarenVault — pooled Bitcoin credit. `packages/contracts/src/MarenVault.sol`. */
export const marenVaultAbi = [
  // --- writes -------------------------------------------------------------
  // NOTE: `deposit` is the ONE payable entrypoint, which is precisely why it can never
  // be relayed. MarenRelayHub reverts with ValueNotRelayable() on any request carrying
  // value, so a first deposit is always paid for by the user in BTC gas.
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'closePosition',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'upperHint', type: 'address' },
      { name: 'lowerHint', type: 'address' },
    ],
    outputs: [],
  },

  // --- views --------------------------------------------------------------
  {
    type: 'function',
    name: 'collateral',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'btc', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewDebtOf',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'collateralRatioOf',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxBorrowable',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'liquidationPriceOf',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'troveMaxBorrowingCapacity',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    // Every user's collateral added together. Read for the protocol panel a disconnected
    // visitor sees, which is real chain state rather than a seeded preview.
    type: 'function',
    name: 'totalCollateral',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'reserveMUSD',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'troveStatus',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'coll', type: 'uint256' },
      { name: 'netDebt', type: 'uint256' },
      { name: 'icr', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'depositsPaused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'borrowingPaused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    // Whether the pooled trove exists at all. `borrow` reverts with TroveNotOpen() when it
    // does not, and `troveStatus()` reports (0, 0, type(uint256).max) — a ratio of
    // infinity, which reads as "extremely healthy" if taken at face value. Read as its own
    // boolean so the preflight can tell "no trove" from "a very safe trove".
    type: 'function',
    name: 'troveOpen',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    // The vault's collateral ceiling. `deposit` reverts with DepositCapExceeded() when
    // totalCollateral + msg.value would pass it, so the deposit form has to know it.
    type: 'function',
    name: 'depositCap',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    // BTC credited to users but not yet pushed into the trove. A withdrawal larger than
    // this has to pull from the trove, which needs a live price even for a debt-free user.
    type: 'function',
    name: 'idleCollateral',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MIN_DEPOSIT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MIN_BORROW_CR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },

  // --- events -------------------------------------------------------------
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newCollateral', type: 'uint256', indexed: false },
      { name: 'pushedToTrove', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newCollateral', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Borrowed',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'debtAdded', type: 'uint256', indexed: false },
      { name: 'newDebt', type: 'uint256', indexed: false },
      { name: 'fromReserve', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Repaid',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newDebt', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'error',
    name: 'PriceFeedUnavailable',
    inputs: [],
  },
  {
    type: 'error',
    name: 'BorrowingIsPaused',
    inputs: [],
  },
] as const;

/** MarenPay — payments over MUSD. `packages/contracts/src/MarenPay.sol`. */
export const marenPayAbi = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'payToHandle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'createRequest',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'payer', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'fulfillRequest',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelRequest',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'createLink',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'linkKey', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'linkId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimLink',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'linkId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reclaimLink',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'linkId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'split',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'total', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'requests',
    stateMutability: 'view',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [
      { name: 'requester', type: 'address' },
      { name: 'payer', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'createdAt', type: 'uint64' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'links',
    stateMutability: 'view',
    inputs: [{ name: 'linkId', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'linkKey', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
      { name: 'claimed', type: 'bool' },
      { name: 'reclaimed', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'linkClaimDigest',
    stateMutability: 'view',
    inputs: [
      { name: 'linkId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'event',
    name: 'Paid',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'memoHash', type: 'bytes32', indexed: true },
      { name: 'memo', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaidToHandle',
    inputs: [
      { name: 'node', type: 'bytes32', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'handle', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RequestCreated',
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true },
      { name: 'requester', type: 'address', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'memo', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LinkCreated',
    inputs: [
      { name: 'linkId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'linkKey', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'expiry', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LinkClaimed',
    inputs: [
      { name: 'linkId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** MarenRegistry — `@handle` → address. `packages/contracts/src/MarenRegistry.sol`. */
export const marenRegistryAbi = [
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'view',
    inputs: [{ name: 'handle', type: 'string' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    // Returns address(0) instead of reverting. Used where "unregistered" is an
    // expected answer rather than an error — e.g. as-you-type resolution.
    name: 'tryResolve',
    stateMutability: 'view',
    inputs: [{ name: 'handle', type: 'string' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'primaryHandle',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'available',
    stateMutability: 'view',
    inputs: [{ name: 'handle', type: 'string' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'makeCommitment',
    stateMutability: 'pure',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'secret', type: 'bytes32' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    // commitment => the block timestamp it was made at. Zero means "not committed".
    // Read rather than trusted from the browser: this is the clock the contract's own
    // 60-second check compares against, so a countdown derived from anything else can
    // tell the user to reveal a second before the chain will accept it.
    type: 'function',
    name: 'commitments',
    stateMutability: 'view',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [{ name: 'committedAt', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MIN_COMMITMENT_AGE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MAX_COMMITMENT_AGE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'commit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'secret', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setPrimaryHandle',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'handle', type: 'string' }],
    outputs: [],
  },
] as const;

/** MarenEarn — ERC-4626 over the MUSD Stability Pool. `packages/contracts/src/MarenEarn.sol`. */
export const marenEarnAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxDeposit',
    stateMutability: 'view',
    inputs: [{ name: 'receiver', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxWithdraw',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'assetBreakdown',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'musdIdle', type: 'uint256' },
      { name: 'musdInPool', type: 'uint256' },
      { name: 'btcHeld', type: 'uint256' },
      { name: 'btcPending', type: 'uint256' },
      { name: 'btcValued', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'isUsingStalePrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

/**
 * MUSD's TroveManager. `packages/contracts/src/interfaces/ITroveManager.sol`.
 *
 * `getTroveMaxBorrowingCapacity` is the one that matters for the UI: it is the REAL
 * borrow ceiling, fixed at the price the trove opened at. An ICR-derived estimate is a
 * different number and quoting it is how a borrow ends in an opaque revert.
 */
export const troveManagerAbi = [
  {
    type: 'function',
    name: 'getTroveMaxBorrowingCapacity',
    stateMutability: 'view',
    inputs: [{ name: '_borrower', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTroveColl',
    stateMutability: 'view',
    inputs: [{ name: '_borrower', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTroveDebt',
    stateMutability: 'view',
    inputs: [{ name: '_borrower', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getCurrentICR',
    stateMutability: 'view',
    inputs: [
      { name: '_borrower', type: 'address' },
      { name: '_price', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    // Six returns on Mezo, not Liquity v1's four: debt is split principal/interest.
    type: 'function',
    name: 'getEntireDebtAndColl',
    stateMutability: 'view',
    inputs: [{ name: '_borrower', type: 'address' }],
    outputs: [
      { name: 'coll', type: 'uint256' },
      { name: 'principal', type: 'uint256' },
      { name: 'interest', type: 'uint256' },
      { name: 'pendingCollateral', type: 'uint256' },
      { name: 'pendingPrincipal', type: 'uint256' },
      { name: 'pendingInterest', type: 'uint256' },
    ],
  },
  {
    // True when MUSD's system-wide TCR is under the 150% CCR. Takes the price as an
    // argument and is a plain view on TroveManager, so unlike `PriceFeed.fetchPrice()` it
    // does NOT revert on a stale oracle: the caller supplies whatever price it has.
    type: 'function',
    name: 'checkRecoveryMode',
    stateMutability: 'view',
    inputs: [{ name: '_price', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    // The system-wide Total Collateral Ratio, 1e18. Read alongside `checkRecoveryMode` so
    // the UI can say how far from the 150% threshold the whole protocol is, rather than
    // only that a boolean flipped.
    type: 'function',
    name: 'getTCR',
    stateMutability: 'view',
    inputs: [{ name: '_price', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * MUSD's PriceFeed. `fetchPrice()` is `view` and REVERTS above 60s of oracle staleness.
 * There is no `lastGoodPrice()` to fall back to — the revert IS the staleness signal.
 */
export const priceFeedAbi = [
  {
    type: 'function',
    name: 'fetchPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * The Mezo BTC/USD oracle precompile, read directly so the UI can learn the observation
 * TIMESTAMP. `PriceFeed.fetchPrice()` only ever answers "here is a price" or reverts; it
 * cannot tell us how old a price is, and "how old" is what the staleness state needs.
 * Chainlink's AggregatorV3 shape, of which the precompile implements exactly two members.
 */
export const priceOracleAbi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

// ── the events an Activity scan reads ────────────────────────────────────────
//
// Written as `parseAbiItem` strings rather than pulled out of the ABIs above because the
// INDEXED-NESS of each parameter is load-bearing for a log query in a way it is not for a
// call, and stating it inline keeps the topic layout visible next to the decoding that
// depends on it. Both apps import these rather than transcribing them twice: the web's
// log reader and the iOS one must agree about which events exist and where the account
// sits in each, or the two would disagree about what a user's history is.

/** MarenVault. The account is always `user`, at topic 1. */
export const MAREN_VAULT_EVENTS = [
  parseAbiItem(
    'event Deposited(address indexed user, uint256 amount, uint256 newCollateral, bool pushedToTrove)',
  ),
  parseAbiItem('event Withdrawn(address indexed user, uint256 amount, uint256 newCollateral)'),
  parseAbiItem(
    'event Borrowed(address indexed user, uint256 amount, uint256 debtAdded, uint256 newDebt, bool fromReserve)',
  ),
  parseAbiItem('event Repaid(address indexed user, uint256 amount, uint256 newDebt)'),
] as const;

/** MarenPay. The account can be `from`, `to`, `requester`, `payer`, `creator` or `recipient`. */
export const MAREN_PAY_EVENTS = [
  parseAbiItem(
    'event Paid(address indexed from, address indexed to, uint256 amount, bytes32 indexed memoHash, string memo)',
  ),
  // FIVE parameters, one trailing string. It carried a sixth (`string memo`) until
  // 2026-08-19, which was not a cosmetic mismatch: an event's topic0 is the hash of its
  // full signature, so the extra argument produced
  //   0x310129e95d2636b0c6579ab8cd368da4f0581810c0e2b22a46d7fe0761133c1d
  // where the deployed MarenPay (matsnet 0xe475Ff919D54E055809f516E3bed8a5c7a101836)
  // actually emits
  //   0xf0db1b294d6bbc31336b73cb68f72c857041a71d934da23f335b2aa2d56a38fd
  // Each hash was located in the contract's runtime bytecode to confirm it. `eth_getLogs`
  // filters on topic0, so the wrong one matched NOTHING and every payment sent to an
  // `@handle` was silently missing from Activity, with no error to notice. The other four
  // MarenPay topics were checked the same way and all match.
  // Source of truth: `packages/contracts/src/MarenPay.sol:107`.
  parseAbiItem(
    'event PaidToHandle(bytes32 indexed node, address indexed from, address indexed to, uint256 amount, string handle)',
  ),
  parseAbiItem(
    'event RequestCreated(uint256 indexed requestId, address indexed requester, address indexed payer, uint256 amount, string memo)',
  ),
  parseAbiItem(
    'event LinkCreated(uint256 indexed linkId, address indexed creator, address indexed linkKey, uint256 amount, uint64 expiry)',
  ),
  parseAbiItem(
    'event LinkClaimed(uint256 indexed linkId, address indexed recipient, uint256 amount)',
  ),
] as const;

/** MarenEarn is an ERC-4626, so these are the standard vault events, not Maren's own. */
export const MAREN_EARN_EVENTS = [
  parseAbiItem(
    'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  ),
  parseAbiItem(
    'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
  ),
] as const;

/**
 * The one event that quantifies a realised liquidation gain: `btcClaimed` is the native
 * BTC MarenEarn pulled out of the MUSD Stability Pool in that harvest, i.e. the collateral
 * seized from liquidated troves and credited to the vault's depositors. Summing it over a
 * window is the ONLY on-chain figure for realised yield, because the Stability Pool has no
 * emissions and the ERC-4626 Deposit/Withdraw events carry cost basis, not gain.
 *
 * It is kept out of `MAREN_EARN_EVENTS` on purpose. That set feeds the Activity reader,
 * which renders per-account rows keyed off an indexed `owner`/`sender`; `Harvested` has no
 * user in it (it is a vault-wide event, triggered by a keeper, not by the viewer), so it
 * would only ever be decoded and then dropped there. The trailing-yield reader imports it
 * separately. None of its fields are indexed, which is fine: the scan reads every harvest
 * on the vault and there is only one vault.
 */
export const MAREN_EARN_HARVEST_EVENT = parseAbiItem(
  'event Harvested(uint256 btcClaimed, uint256 btcHeld, uint256 musdCompounded, uint256 feePaid)',
);
