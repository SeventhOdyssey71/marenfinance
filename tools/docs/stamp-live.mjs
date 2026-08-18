#!/usr/bin/env node
/**
 * Maren Finance — live-number stamp for the documents.
 *
 *   node tools/docs/stamp-live.mjs           read the chains, write docs/src/live.json
 *   node tools/docs/stamp-live.mjs --check   read the chains, print the diff, write nothing
 *
 * WHAT THIS IS FOR
 *
 * Several documents quote numbers that come off a live chain and therefore rot. Mezo
 * mainnet's trove count moves, the BTC price moves every block, and the matsnet pooled
 * trove's collateral and ICR move whenever anyone uses the app. A reviewer who checks
 * one of those numbers and finds it stale has learned something true about the document
 * and something false about the project, which is the worst possible trade.
 *
 * This script does NOT rewrite prose. That is on purpose. A number in a sentence is
 * load-bearing: "Mezo mainnet carries 27 troves. Not 27 thousand. Twenty-seven." cannot
 * be updated by a regular expression without producing nonsense, and an argument built
 * on a number should be re-read by a human when that number moves. What the script does
 * is make checking cost one command instead of six `cast` invocations, so there is no
 * excuse for not checking before a document goes out.
 *
 * WHICH DOCUMENTS QUOTE DRIFTING NUMBERS
 *
 * Keep this list current. It is the whole value of the file.
 *
 *   docs/src/01-thesis.md   The paragraph beginning "The consequence is visible
 *                           on-chain" quotes the mainnet trove count in three separate
 *                           places in two sentences ("27 troves. Not 27 thousand.
 *                           Twenty-seven."), plus the MUSD holder count and supply.
 *                           Section 2's minimum-collateral figure (~0.079 BTC, ~$5,000)
 *                           is derived from the BTC price and moves with it.
 *
 *   docs/src/progress.md    "The pooled trove is live inside Mezo's own TroveManager"
 *                           quotes the matsnet vault's collateral, its debt, and its
 *                           ICR. These change on every deposit, borrow, and keeper
 *                           top-up, so they drift fastest of anything in the documents.
 *
 *   docs/ARCHITECTURE.md    Section 1 quotes the mainnet trove count and a "~$63k BTC"
 *                           price in the worked example for F1.
 *
 * The MUSD holder count and total supply in 01-thesis.md are NOT read here: holders is
 * an indexer aggregate rather than a chain read, and there is no single call that
 * returns it. Check those against the Blockscout token page by hand.
 *
 * NO NEW DEPENDENCIES
 *
 * Raw JSON-RPC over the global fetch, in the style of tools/demo/lib/server.mjs. viem
 * would be nicer and is not worth a dependency in a script that makes six eth_calls.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const LIVE_JSON = path.join(ROOT, 'docs', 'src', 'live.json');

/** How old live.json may be before DOCS_REQUIRE_FRESH=1 refuses a document build. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const RPC_TIMEOUT_MS = 15_000;

/**
 * Endpoints, in the order they are tried. These are the same lists as
 * packages/sdk/src/chains.ts, which documents why boar is first: Mezo's public RPCs are
 * transiently flaky and boar was the one that stayed up throughout testing.
 */
const MAINNET_RPCS = [
  'https://jsonrpc-mezo.boar.network',
  'https://mainnet.mezo.public.validationcloud.io',
  'https://mezo.drpc.org',
];
const MATSNET_RPCS = ['https://rpc.test.mezo.org'];

/** Addresses, mirrored from packages/sdk/src/addresses.ts. */
const MAINNET_SORTED_TROVES = '0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f';
const MAINNET_TROVE_MANAGER = '0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193';
const MATSNET_TROVE_MANAGER = '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0';
const MATSNET_MAREN_VAULT = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';

/**
 * The BTC/USD oracle is a native chain precompile, not a deployed feed. Same address on
 * both networks. It answers `latestRoundData()` and `decimals()` and nothing else;
 * `description()` reverts, so do not add it here.
 */
const ORACLE_PRECOMPILE = '0x7b7c000000000000000000000000000000000015';

/**
 * Selectors, so nobody has to trust a comment. Regenerate with
 * `cast sig "getSize()"` and friends.
 */
const SELECTORS = {
  getSize: '0xde8fa431', // SortedTroves.getSize() -> uint256
  getTroveOwnersCount: '0x49eefeee', // TroveManager.getTroveOwnersCount() -> uint256
  latestRoundData: '0xfeaf968c', // (uint80,int256,uint256,uint256,uint80)
  getTroveColl: '0x480cd578', // TroveManager.getTroveColl(address) -> uint256
  getTroveDebt: '0xd66a2553', // TroveManager.getTroveDebt(address) -> uint256
  getCurrentICR: '0xd293c710', // TroveManager.getCurrentICR(address,uint256) -> uint256
};

/** ABI-encode a single address argument: left-pad the 20 bytes to a 32-byte word. */
function encodeAddress(address) {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/** ABI-encode a single uint256 argument. */
function encodeUint(value) {
  return value.toString(16).padStart(64, '0');
}

/** Split a returndata blob into 32-byte words as bigints. */
function words(hex) {
  const body = hex.replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(BigInt(`0x${body.slice(i, i + 64)}`));
  return out;
}

/**
 * One JSON-RPC round trip, walking the endpoint list until one answers.
 *
 * Every endpoint failing throws with all of their errors attached, because "the RPC is
 * down" and "the third fallback rejected our user agent" need different responses and
 * a single message cannot distinguish them.
 */
async function rpc(urls, method, params) {
  const failures = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
      if (body.result === undefined) throw new Error('no result field');
      return body.result;
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`every RPC failed for ${method}\n    ${failures.join('\n    ')}`);
}

/** `eth_call` returning a single uint256. */
async function callUint(urls, to, data) {
  const result = await rpc(urls, 'eth_call', [{ to, data }, 'latest']);
  const [value] = words(result);
  if (value === undefined) throw new Error(`empty returndata from ${to} ${data.slice(0, 10)}`);
  return value;
}

/**
 * Format a fixed-point integer as a decimal string, trimmed.
 *
 * Deliberately string arithmetic on the bigint rather than Number: 64560.94e18 does not
 * survive a float, and a document number that is silently wrong in its last digits is
 * exactly what this script exists to prevent.
 */
function formatUnits(value, decimals, places = decimals) {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  let fraction = digits.slice(digits.length - decimals).slice(0, places);
  fraction = fraction.replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/** Mainnet: how many troves exist, and what BTC is worth. */
async function readMainnet() {
  const [blockHex, size, ownersCount, oracle] = await Promise.all([
    rpc(MAINNET_RPCS, 'eth_blockNumber', []),
    callUint(MAINNET_RPCS, MAINNET_SORTED_TROVES, SELECTORS.getSize),
    callUint(MAINNET_RPCS, MAINNET_TROVE_MANAGER, SELECTORS.getTroveOwnersCount),
    rpc(MAINNET_RPCS, 'eth_call', [
      { to: ORACLE_PRECOMPILE, data: SELECTORS.latestRoundData },
      'latest',
    ]),
  ]);

  // Two independent reads of the same fact. SortedTroves is the list the redemption
  // walks; TroveManager's array is the owner registry. They agree in normal operation,
  // and a disagreement is worth seeing rather than averaging away.
  const [, answer, , updatedAt] = words(oracle);

  return {
    chainId: 31612,
    blockNumber: Number(BigInt(blockHex)),
    troveCount: Number(size),
    troveOwnersCount: Number(ownersCount),
    troveCountAgrees: size === ownersCount,
    btcPriceUsd: formatUnits(answer, 18, 2),
    btcPriceRaw: answer.toString(),
    oracleUpdatedAt: new Date(Number(updatedAt) * 1000).toISOString(),
  };
}

/** Matsnet: the state of Maren's own pooled trove. */
async function readMatsnet() {
  const oracle = await rpc(MATSNET_RPCS, 'eth_call', [
    { to: ORACLE_PRECOMPILE, data: SELECTORS.latestRoundData },
    'latest',
  ]);
  const [, price, , updatedAt] = words(oracle);

  const [blockHex, coll, debt, icr] = await Promise.all([
    rpc(MATSNET_RPCS, 'eth_blockNumber', []),
    callUint(
      MATSNET_RPCS,
      MATSNET_TROVE_MANAGER,
      SELECTORS.getTroveColl + encodeAddress(MATSNET_MAREN_VAULT),
    ),
    callUint(
      MATSNET_RPCS,
      MATSNET_TROVE_MANAGER,
      SELECTORS.getTroveDebt + encodeAddress(MATSNET_MAREN_VAULT),
    ),
    // ICR is asked of the protocol at the protocol's own price rather than divided out
    // here, so the figure in the documents is the one TroveManager would liquidate on.
    callUint(
      MATSNET_RPCS,
      MATSNET_TROVE_MANAGER,
      SELECTORS.getCurrentICR + encodeAddress(MATSNET_MAREN_VAULT) + encodeUint(price),
    ),
  ]);

  return {
    chainId: 31611,
    blockNumber: Number(BigInt(blockHex)),
    vault: MATSNET_MAREN_VAULT,
    collateralBtc: formatUnits(coll, 18, 6),
    debtMusd: formatUnits(debt, 18, 2),
    icrPercent: formatUnits(icr * 100n, 18, 1),
    btcPriceUsd: formatUnits(price, 18, 2),
    oracleUpdatedAt: new Date(Number(updatedAt) * 1000).toISOString(),
  };
}

/**
 * Read both chains and assemble the payload.
 *
 * `quotedIn` travels with the numbers on purpose. Someone opening live.json six months
 * from now should not have to open this file to find out which documents to check.
 */
export async function readLiveNumbers() {
  const [mainnet, matsnet] = await Promise.all([readMainnet(), readMatsnet()]);
  return {
    readAt: new Date().toISOString(),
    source: 'tools/docs/stamp-live.mjs',
    note: 'Generated. Numbers in the documents are placed by hand; this file is what you check them against.',
    mainnet,
    matsnet,
    quotedIn: {
      'mainnet.troveCount': ['docs/src/01-thesis.md', 'docs/ARCHITECTURE.md'],
      'mainnet.btcPriceUsd': ['docs/src/01-thesis.md', 'docs/ARCHITECTURE.md'],
      'matsnet.collateralBtc': ['docs/src/progress.md'],
      'matsnet.debtMusd': ['docs/src/progress.md'],
      'matsnet.icrPercent': ['docs/src/progress.md'],
    },
  };
}

/** Read the stamped file. Returns null when it has never been written. */
export async function loadLiveJson() {
  try {
    return JSON.parse(await readFile(LIVE_JSON, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`docs/src/live.json is unreadable: ${error.message}`);
  }
}

/**
 * The freshness gate the document build calls.
 *
 * OFF BY DEFAULT, and that is the important part. A document build must work on a
 * plane, in a hotel, and in a CI job with no outbound network. Requiring a fresh chain
 * read to produce a PDF would mean an RPC outage stops us shipping a document whose
 * content has nothing to do with the chain. So the check runs only when the caller
 * opts in with DOCS_REQUIRE_FRESH=1, which is what you set before sending documents to
 * someone who will check the numbers.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Promise<{checked: boolean, ageMs?: number, readAt?: string}>}
 */
export async function assertFreshIfRequired(env) {
  if (env.DOCS_REQUIRE_FRESH !== '1') return { checked: false };

  const live = await loadLiveJson();
  if (!live) {
    throw new Error(
      'DOCS_REQUIRE_FRESH=1 but docs/src/live.json does not exist.\n' +
        '  Run: node tools/docs/stamp-live.mjs',
    );
  }

  const readAt = Date.parse(live.readAt ?? '');
  if (Number.isNaN(readAt)) {
    throw new Error('DOCS_REQUIRE_FRESH=1 but docs/src/live.json has no usable readAt timestamp.');
  }

  const ageMs = Date.now() - readAt;
  if (ageMs > MAX_AGE_MS) {
    const hours = (ageMs / 3_600_000).toFixed(1);
    throw new Error(
      `DOCS_REQUIRE_FRESH=1 and docs/src/live.json is ${hours}h old (limit 24h).\n` +
        '  Run: node tools/docs/stamp-live.mjs\n' +
        '  Then re-read the numbers in 01-thesis.md and progress.md before building.',
    );
  }

  return { checked: true, ageMs, readAt: live.readAt };
}

/** Print old value beside new so a human can see what moved. */
function printComparison(previous, next) {
  const rows = [];
  const walk = (prefix, a, b) => {
    for (const [key, value] of Object.entries(b)) {
      if (key === 'quotedIn' || key === 'readAt' || key === 'note' || key === 'source') continue;
      if (value && typeof value === 'object') walk(`${prefix}${key}.`, a?.[key] ?? {}, value);
      else rows.push([`${prefix}${key}`, a?.[key], value]);
    }
  };
  walk('', previous ?? {}, next);

  const width = Math.max(...rows.map(([name]) => name.length));
  console.log('');
  for (const [name, before, after] of rows) {
    const changed = before !== undefined && String(before) !== String(after);
    const marker = changed ? '  <- changed' : '';
    const from = changed ? `${before} -> ` : '';
    console.log(`  ${name.padEnd(width)}  ${from}${after}${marker}`);
  }
  console.log('');
}

async function main() {
  const check = argv.includes('--check');

  console.log('Reading Mezo mainnet (31612) and matsnet (31611)...');
  const previous = await loadLiveJson();
  const next = await readLiveNumbers();

  printComparison(previous, next);

  if (!next.mainnet.troveCountAgrees) {
    console.warn(
      `  ! SortedTroves.getSize() is ${next.mainnet.troveCount} but ` +
        `TroveManager.getTroveOwnersCount() is ${next.mainnet.troveOwnersCount}. ` +
        'Investigate before quoting either.',
    );
  }

  if (check) {
    console.log('--check: nothing written.');
    return;
  }

  await writeFile(LIVE_JSON, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`Wrote docs/src/live.json at ${next.readAt}`);
  console.log('The documents are NOT rewritten. Check these against:');
  for (const [field, files] of Object.entries(next.quotedIn)) {
    console.log(`  ${field} -> ${files.join(', ')}`);
  }
}

/**
 * Running the file scans and writes; importing it does nothing, which is what
 * tools/pdf/build.mjs relies on when it calls assertFreshIfRequired.
 */
if (argv[1] && path.resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nstamp-live failed: ${error.message}`);
    exit(1);
  });
}
