/**
 * The ABIs, which now live in `@maren/sdk`.
 *
 * They moved the day the iOS app started reading the same contracts. Two hand-maintained
 * transcriptions of one Solidity file is a bug with a delay fuse: a fix lands in one, the
 * other keeps its old selector, and the app holding the stale copy fails at the RPC with
 * an error that reads exactly like a network fault. `packages/sdk/src/abis.ts` is the
 * single copy, and it sits beside the addresses it is called against.
 *
 * This file stays as a re-export so no import path in this app changed with the move. New
 * code may import from `@maren/sdk` directly; either reaches the same objects.
 */
export {
  marenEarnAbi,
  marenPayAbi,
  marenRegistryAbi,
  marenVaultAbi,
  priceFeedAbi,
  priceOracleAbi,
  troveManagerAbi,
  MAREN_EARN_EVENTS,
  MAREN_PAY_EVENTS,
  MAREN_VAULT_EVENTS,
} from '@maren/sdk';
