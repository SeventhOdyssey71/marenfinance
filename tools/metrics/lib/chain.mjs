/**
 * The network layer for the metrics scan. Everything that touches an RPC lives here so the
 * aggregation in `aggregate.mjs` can stay pure and testable.
 *
 * It honours the three log-scan realities the app already handles and the SDK documents:
 *
 *   1. The 10,000-block `eth_getLogs` window (`MEZO_MAX_LOG_RANGE`). A full scan walks from
 *      the deployment block to the head in windows of that width.
 *   2. The deployment-block floor (`getDeploymentBlock`). There is provably no Maren history
 *      before it, so a scan that starts there has read ALL of history, not a recent slice.
 *   3. The flaky testnet RPC. Every request is timeboxed and retried once, and the client
 *      fails over across the endpoint list the SDK verified (primary first, drpc fallback
 *      second), per the warnings in `chains.ts`.
 */
import { MEZO_MAX_LOG_RANGE, getChain, getDeploymentBlock, getMarenAddresses } from '@maren/sdk';
import { createPublicClient, fallback, http } from 'viem';

import { EARN_EVENTS, PAY_EVENTS, REGISTRY_EVENTS, VAULT_EVENTS } from './events.mjs';

/** Per-request timeout. Mezo's public RPC is transiently slow; a call this old is failing. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A public client that fails over across the SDK's verified endpoint list, timeboxes every
 * request and retries once. The endpoint order is the SDK's: primary first, the drpc
 * fallback second, exactly as `chains.ts` insists.
 */
export function makeClient(network) {
  const chain = getChain(network);
  const urls = chain.rpcUrls.default.http;
  const transports = urls.map((url) =>
    http(url, { timeout: REQUEST_TIMEOUT_MS, retryCount: 1, retryDelay: 400 }),
  );
  return createPublicClient({
    chain,
    // `rank: false` keeps the declared order (primary, then drpc) rather than reordering by
    // latency, because the SDK's ordering encodes reliability the ranker cannot see.
    transport: fallback(transports, { rank: false }),
  });
}

/** Wrap any promise in a hard timeout, so a hung read cannot stall the whole scan. */
export function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

/** Split [from, to] into <=10,000-block windows, oldest first. */
export function splitRange(from, to) {
  const windows = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MEZO_MAX_LOG_RANGE - 1n;
    windows.push({ from: cursor, to: end > to ? to : end });
    cursor = end + 1n;
  }
  return windows;
}

/**
 * Scan every Maren log from the deployment block to the head.
 *
 * Unlike the app's reader, this deliberately does NOT cap the window count: the pilot wants
 * the WHOLE history, and it runs from a shell where a minute of scanning is fine. It returns
 * the head it scanned to and the deployment floor so the summary can state the exact range
 * the numbers cover, which is the difference between "no borrows yet" and "no borrows in the
 * slice we happened to read".
 */
export async function scanAllLogs(client, network) {
  const deployedAt = getDeploymentBlock(network);
  if (deployedAt === null) {
    throw new Error(
      `Maren is not deployed on Mezo ${network} (addresses are all zero), so there are no logs to read.`,
    );
  }
  const maren = getMarenAddresses(network);
  const head = await withTimeout(client.getBlockNumber(), REQUEST_TIMEOUT_MS, 'getBlockNumber');

  const windows = splitRange(deployedAt, head);
  const vault = [];
  const pay = [];
  const earn = [];
  const registry = [];

  for (const window of windows) {
    const [v, p, e, r] = await Promise.all([
      withTimeout(
        client.getLogs({
          address: maren.marenVault,
          events: VAULT_EVENTS,
          fromBlock: window.from,
          toBlock: window.to,
        }),
        REQUEST_TIMEOUT_MS,
        'getLogs(vault)',
      ),
      withTimeout(
        client.getLogs({
          address: maren.marenPay,
          events: PAY_EVENTS,
          fromBlock: window.from,
          toBlock: window.to,
        }),
        REQUEST_TIMEOUT_MS,
        'getLogs(pay)',
      ),
      withTimeout(
        client.getLogs({
          address: maren.marenEarn,
          events: EARN_EVENTS,
          fromBlock: window.from,
          toBlock: window.to,
        }),
        REQUEST_TIMEOUT_MS,
        'getLogs(earn)',
      ),
      withTimeout(
        client.getLogs({
          address: maren.marenRegistry,
          events: REGISTRY_EVENTS,
          fromBlock: window.from,
          toBlock: window.to,
        }),
        REQUEST_TIMEOUT_MS,
        'getLogs(registry)',
      ),
    ]);
    vault.push(...v);
    pay.push(...p);
    earn.push(...e);
    registry.push(...r);
  }

  return { deployedAt, head, vault, pay, earn, registry };
}

/**
 * Read one uint view per address, with bounded concurrency, returning a case-folded map.
 *
 * This backs two live numbers the logs alone cannot give:
 *   - `collateral(addr)` for funded positions. A deposit-then-withdraw leaves a Deposited
 *     log but zero collateral, so funded positions have to be read, not counted from logs.
 *   - `balanceOf(addr)` on MarenEarn for current depositors, for the same reason: a
 *     depositor who fully withdrew still has a Deposit log.
 *
 * An address whose read fails (flaky RPC) is omitted rather than recorded as zero, so a
 * transport blip can never silently deflate the funded count.
 */
export async function readUintForEach(client, address, abi, functionName, addresses) {
  const result = new Map();
  const list = [...addresses];
  const CONCURRENCY = 5;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const values = await Promise.all(
      batch.map((addr) =>
        withTimeout(
          client.readContract({ address, abi, functionName, args: [addr] }),
          REQUEST_TIMEOUT_MS,
          `${functionName}(${addr})`,
        ).catch(() => null),
      ),
    );
    batch.forEach((addr, index) => {
      const value = values[index];
      if (typeof value === 'bigint') result.set(addr.toLowerCase(), value);
    });
  }
  return result;
}

/** A single view call, timeboxed, returning null on failure rather than throwing the scan out. */
export async function readView(client, address, abi, functionName, args = []) {
  try {
    return await withTimeout(
      client.readContract({ address, abi, functionName, args }),
      REQUEST_TIMEOUT_MS,
      `${functionName}()`,
    );
  } catch {
    return null;
  }
}
