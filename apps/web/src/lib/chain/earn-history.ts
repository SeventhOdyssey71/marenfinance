import {
  MAREN_EARN_EVENTS,
  MAREN_EARN_HARVEST_EVENT,
  MEZO_MAX_LOG_RANGE,
  getDeploymentBlock,
  getMarenAddresses,
  valueBtcInMusd,
  type MezoNetwork,
} from '@maren/sdk';
import type { Address, Log, PublicClient } from 'viem';

import type { TrailingYield } from '../data/types';

/**
 * MarenEarn's realised history, read from the chain's own logs.
 *
 * TWO HONEST FIGURES, FROM TWO DIFFERENT EVENTS, AT DIFFERENT SCOPES. This is the whole
 * subtlety of the feature, so it is stated here rather than discovered later:
 *
 *   1. `depositedWei` is the CALLER'S cost basis, from the ERC-4626 `Deposit`/`Withdraw`
 *      events filtered to their address: everything they put in, minus everything they
 *      took out. It exists so the balance screen can show a realised/unrealised delta
 *      against what the user actually contributed.
 *
 *   2. `trailing` is the VAULT-WIDE realised gain, from the `Harvested` event, which has no
 *      user in it. `Harvested.btcClaimed` is the native BTC seized at liquidation and
 *      pulled out of the Stability Pool in that harvest, valued here at the current oracle
 *      price. This is deliberately NOT attributed to the caller: doing that honestly would
 *      need each depositor's share balance reconstructed at every past harvest, which is an
 *      indexer's job, not a bounded log scan's. So this reports what the vault realised, and
 *      the screen labels it vault-wide and backward-looking, exactly as it does the asset
 *      breakdown that sits beside it.
 *
 * WHY VALUE `btcClaimed` AT THE CURRENT PRICE. The seized BTC is still held by the vault
 * (`swapRouter` is unset, so `harvest()` holds rather than swaps), and `totalAssets()`
 * marks that held BTC at the oracle price too. Valuing the realised gain the same way keeps
 * the trailing figure and the share price on one definition. When a swap route is wired and
 * `Harvested.musdCompounded` starts being non-zero, this stays a fair mark of the same BTC.
 * When the oracle has no price, `valueBtcInMusd` returns zero, an understatement in the
 * safe direction and the identical fallback the contract uses.
 *
 * WHY IT WALKS BACKWARDS IN BOUNDED WINDOWS. Same reason as `logs.ts`: Mezo's RPC caps
 * `eth_getLogs` at 10,000 blocks, so history is scanned in a fixed maximum span back from
 * the head, floored at the deployment block. Today the vault is younger than that span, so
 * the scan is complete; the cap is what stops this becoming a slow page load once it is not,
 * at which point the answer is an indexer, the same note `logs.ts` and the README carry.
 */

/** Matches `logs.ts`: six 10,000-block windows, about 3.3 days of matsnet history. */
const MAX_WINDOWS = 6n;

export interface EarnHistory {
  /** The caller's net cost basis in MUSD, 1e18. Floored at zero. */
  depositedWei: bigint;
  /** Vault-wide realised liquidation gains over the observed window. */
  trailing: TrailingYield;
}

const EMPTY_TRAILING: TrailingYield = {
  windowDays: 0,
  realisedWei: 0n,
  liquidationEvents: 0,
  lastGainAt: null,
};

type DecodedLog = Log & { eventName?: string; args?: Record<string, unknown> };

/**
 * Read the caller's cost basis and the vault's trailing realised yield.
 *
 * `priceWei` is passed in rather than read here so the Earn screen's single price read is
 * reused: it is the same oracle number the rest of that screen is already priced off. A
 * `null` price means the oracle could not be read, and realised gains then value to zero
 * rather than to a guess, which is the contract's own behaviour.
 *
 * Throws on transport failure rather than returning zeroes. A zero cost basis and an empty
 * window are CLAIMS about the chain, and neither may be manufactured by a request that
 * failed, for the same reason the Activity reader refuses to.
 */
export async function readEarnHistory(
  client: PublicClient,
  network: MezoNetwork,
  account: Address,
  priceWei: bigint | null,
): Promise<EarnHistory> {
  const deployedAt = getDeploymentBlock(network);
  if (deployedAt === null) {
    // Not deployed here, so there is genuinely no history. The caller (readEarn) only runs
    // when connected to a deployed network, but this keeps the reader honest on its own.
    return { depositedWei: 0n, trailing: EMPTY_TRAILING };
  }

  const maren = getMarenAddresses(network);
  const head = await client.getBlockNumber();

  const horizon = MAX_WINDOWS * MEZO_MAX_LOG_RANGE;
  const floor = head > horizon && head - horizon > deployedAt ? head - horizon : deployedAt;

  const events = [...MAREN_EARN_EVENTS, MAREN_EARN_HARVEST_EVENT];
  const raw: DecodedLog[] = [];
  for (const window of splitRange(floor, head)) {
    const logs = await client.getLogs({
      address: maren.marenEarn,
      events,
      fromBlock: window.from,
      toBlock: window.to,
    });
    raw.push(...(logs as DecodedLog[]));
  }

  // ── cost basis: the caller's own Deposit/Withdraw assets ──────────────────────
  let deposited = 0n;
  let withdrawn = 0n;
  // ── realised gain: vault-wide Harvested.btcClaimed ────────────────────────────
  let realisedBtc = 0n;
  let liquidationEvents = 0;
  let lastGainBlock: bigint | null = null;

  for (const log of raw) {
    const args = log.args ?? {};
    if (log.eventName === 'Deposit') {
      if (sameAddress(args.owner, account)) deposited += big(args.assets);
    } else if (log.eventName === 'Withdraw') {
      if (sameAddress(args.owner, account)) withdrawn += big(args.assets);
    } else if (log.eventName === 'Harvested') {
      const claimed = big(args.btcClaimed);
      // A harvest that claimed nothing is not a liquidation gain. Counting it would inflate
      // the event count with keeper heartbeats and misdate "most recent gain".
      if (claimed > 0n) {
        realisedBtc += claimed;
        liquidationEvents += 1;
        if (
          log.blockNumber !== null &&
          (lastGainBlock === null || log.blockNumber > lastGainBlock)
        ) {
          lastGainBlock = log.blockNumber;
        }
      }
    }
  }

  const depositedWei = deposited > withdrawn ? deposited - withdrawn : 0n;

  // No realised gain means there is nothing to report a window for. Reported as a
  // zero-length window, which the Earn screen renders as its honest "no return yet" empty
  // state rather than as "0.00 MUSD over N days", a result of an experiment nobody ran.
  if (liquidationEvents === 0) {
    return { depositedWei, trailing: EMPTY_TRAILING };
  }

  // Only now, with a gain to describe, is it worth the extra block reads for the window's
  // real duration and the timestamp of the most recent gain.
  const blocksNeeded = [
    ...new Set([floor, head, lastGainBlock].filter((b): b is bigint => b !== null)),
  ];
  const stamps = new Map<string, number>();
  await Promise.all(
    blocksNeeded.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        stamps.set(blockNumber.toString(), Number(block.timestamp));
      } catch {
        // Left unknown rather than guessed from an assumed block interval.
      }
    }),
  );

  const floorTs = stamps.get(floor.toString());
  const headTs = stamps.get(head.toString());
  const windowDays =
    floorTs !== undefined && headTs !== undefined && headTs > floorTs
      ? Math.max(1, Math.round((headTs - floorTs) / 86_400))
      : 1;
  const lastGainAt = lastGainBlock !== null ? (stamps.get(lastGainBlock.toString()) ?? null) : null;

  return {
    depositedWei,
    trailing: {
      windowDays,
      realisedWei: valueBtcInMusd(realisedBtc, priceWei ?? 0n),
      liquidationEvents,
      lastGainAt,
    },
  };
}

/** Same window walk as `logs.ts`, kept local so a change to one reader cannot silently move the other. */
function splitRange(from: bigint, to: bigint): { from: bigint; to: bigint }[] {
  const windows: { from: bigint; to: bigint }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MEZO_MAX_LOG_RANGE - 1n;
    windows.push({ from: cursor, to: end > to ? to : end });
    cursor = end + 1n;
  }
  return windows;
}

function sameAddress(a: unknown, b: Address): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

function big(value: unknown): bigint {
  return typeof value === 'bigint' ? value : 0n;
}
