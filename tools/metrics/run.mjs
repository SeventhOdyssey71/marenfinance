#!/usr/bin/env -S node --import tsx
/**
 * Maren pilot metrics, read live from the chain.
 *
 * The `--import tsx` shebang is load-bearing: this tool imports `@maren/sdk`, which the
 * monorepo consumes as TypeScript source with extensionless relative imports, and plain
 * `node` resolves neither. `pnpm --filter @maren/metrics start` uses tsx the same way for
 * environments whose `env` lacks `-S`.
 *
 * One question, answered from contract reads and logs with no third-party tracker and no
 * fabricated data: do real users borrow small and then SPEND it, or just poke and leave?
 *
 * Usage:
 *   node tools/metrics/run.mjs [--network testnet|mainnet] [--out <path.json>] [--json]
 *
 * Default network is matsnet (testnet, chain 31611), where Maren is deployed. Mainnet has
 * no Maren deployment yet, so the tool says so and exits rather than inventing zeros.
 *
 * Output: a dated human summary on stdout, and a machine-readable JSON snapshot written to
 * disk (default under tools/metrics/snapshots/) so the pilot can track every metric over
 * time. Every number is a real contract read or a decoded log; nothing is defaulted into
 * existence.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  MEZO_CHAIN_IDS,
  formatMusd,
  getMarenAddresses,
  marenEarnAbi,
  marenVaultAbi,
} from '@maren/sdk';

import {
  countFunded,
  countHandles,
  newAddressClaims,
  spendRatio,
  sumField,
  summarizeLinks,
  summarizePayments,
} from './lib/aggregate.mjs';
import { makeClient, readUintForEach, readView, scanAllLogs } from './lib/chain.mjs';
import { pick } from './lib/events.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(args) {
  const out = { network: 'testnet', outPath: null, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--network') out.network = args[(i += 1)];
    else if (arg === '--out') out.outPath = args[(i += 1)];
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  if (out.network !== 'testnet' && out.network !== 'mainnet') {
    throw new Error(`--network must be "testnet" or "mainnet", got "${out.network}"`);
  }
  return out;
}

/** MUSD wei to a plain number-with-unit string, via the SDK's own formatter. */
function musd(wei) {
  return formatMusd(wei, { unit: true });
}

function pct(ratio) {
  return ratio === null ? 'n/a (nobody has borrowed yet)' : `${(ratio * 100).toFixed(1)}%`;
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node tools/metrics/run.mjs [--network testnet|mainnet] [--out <path.json>] [--json]',
    );
    return;
  }

  const { network } = opts;
  const readAt = new Date();
  const client = makeClient(network);
  const maren = getMarenAddresses(network);

  // --- scan every Maren log from the deployment block to the head --------------
  const scan = await scanAllLogs(client, network);

  const deposited = pick(scan.vault, 'Deposited');
  const borrowed = pick(scan.vault, 'Borrowed');
  const paid = [...pick(scan.pay, 'Paid'), ...pick(scan.pay, 'PaidToHandle')];
  const requestsCreated = pick(scan.pay, 'RequestCreated');
  const requestsFulfilled = pick(scan.pay, 'RequestFulfilled');
  const linksCreated = pick(scan.pay, 'LinkCreated');
  const linksClaimed = pick(scan.pay, 'LinkClaimed');
  const earnDeposits = pick(scan.earn, 'Deposit');
  const handleLogs = scan.registry;

  // --- funded positions: distinct depositors, then LIVE collateral > 0 ---------
  const depositorSet = new Set();
  for (const log of deposited) {
    const user = log.args?.user;
    if (typeof user === 'string') depositorSet.add(user.toLowerCase());
  }
  const collateralByAddress = await readUintForEach(
    client,
    maren.marenVault,
    marenVaultAbi,
    'collateral',
    depositorSet,
  );
  const fundedPositions = countFunded(collateralByAddress);
  const totalCollateralLive = await readView(
    client,
    maren.marenVault,
    marenVaultAbi,
    'totalCollateral',
  );

  // --- MUSD borrowed through Maren: gross drawn via the vault, all time --------
  const musdBorrowedWei = sumField(borrowed, 'amount');

  // --- payments ----------------------------------------------------------------
  const payments = summarizePayments(paid);
  const requests = {
    created: requestsCreated.length,
    settled: requestsFulfilled.length,
    settledVolume: sumField(requestsFulfilled, 'amount'),
  };

  // --- money links / claims ----------------------------------------------------
  // createLink IS deployed on matsnet (MarenPay.sol:316, LinkCreated at :121), so this is a
  // real metric, not a skipped one. If it were ever missing, the honest tell is zero
  // LinkCreated logs across the whole history, which we surface rather than hide.
  const links = summarizeLinks(linksCreated, linksClaimed);
  const claims = newAddressClaims(linksClaimed, [...scan.vault, ...scan.pay, ...scan.earn]);
  const linksDeployed = true;

  // --- handles registered ------------------------------------------------------
  const handlesRegistered = countHandles(handleLogs);

  // --- earn: live TVL and current depositors -----------------------------------
  const earnTvlWei = await readView(client, maren.marenEarn, marenEarnAbi, 'totalAssets');
  const earnDepositorSet = new Set();
  for (const log of earnDeposits) {
    const owner = log.args?.owner;
    if (typeof owner === 'string') earnDepositorSet.add(owner.toLowerCase());
  }
  const earnBalances = await readUintForEach(
    client,
    maren.marenEarn,
    marenEarnAbi,
    'balanceOf',
    earnDepositorSet,
  );
  let earnCurrentDepositors = 0;
  for (const bal of earnBalances.values()) if (bal > 0n) earnCurrentDepositors += 1;

  // --- THE demand test ---------------------------------------------------------
  const spend = spendRatio(borrowed, paid);

  // --- assemble the snapshot ---------------------------------------------------
  const snapshot = {
    tool: '@maren/metrics',
    schema: 1,
    network,
    chainId: MEZO_CHAIN_IDS[network],
    readAt: readAt.toISOString(),
    scannedFromBlock: scan.deployedAt.toString(),
    scannedToBlock: scan.head.toString(),
    contracts: {
      marenVault: maren.marenVault,
      marenPay: maren.marenPay,
      marenRegistry: maren.marenRegistry,
      marenEarn: maren.marenEarn,
    },
    fundedPositions: {
      value: fundedPositions,
      distinctDepositorsAllTime: depositorSet.size,
      totalCollateralWei: totalCollateralLive === null ? null : totalCollateralLive.toString(),
      note: 'distinct addresses whose live collateral(addr) read is > 0. THE core adoption number.',
    },
    musdBorrowed: {
      wei: musdBorrowedWei.toString(),
      display: musd(musdBorrowedWei),
      note: 'gross MUSD drawn through the vault over all history (sum of Borrowed.amount). The demand-creation number.',
    },
    payments: {
      count: payments.count,
      volumeWei: payments.volume.toString(),
      volumeDisplay: musd(payments.volume),
      distinctSenders: payments.distinctSenders,
      distinctRecipients: payments.distinctRecipients,
      requestsCreated: requests.created,
      requestsSettled: requests.settled,
      requestsSettledVolumeWei: requests.settledVolume.toString(),
      requestsSettledVolumeDisplay: musd(requests.settledVolume),
    },
    moneyLinks: {
      deployed: linksDeployed,
      created: links.created.count,
      createdVolumeWei: links.created.volume.toString(),
      claimed: links.claimed.count,
      claimedVolumeWei: links.claimed.volume.toString(),
      claimsByBrandNewAddresses: claims.brandNewClaims,
      note: 'brand new = the claim is that address first appearance in ANY Maren log (new to Maren, not to the chain). The growth-loop signal.',
    },
    handlesRegistered: {
      value: handlesRegistered,
      note: 'distinct nodes on MarenRegistry.HandleRegistered.',
    },
    earn: {
      tvlWei: earnTvlWei === null ? null : earnTvlWei.toString(),
      tvlDisplay: earnTvlWei === null ? null : musd(earnTvlWei),
      currentDepositors: earnCurrentDepositors,
      distinctDepositorsAllTime: earnDepositorSet.size,
      note: 'TVL is live totalAssets(); current depositors have balanceOf(addr) > 0.',
    },
    spendRatio: {
      borrowers: spend.borrowers,
      borrowedThenSpent: spend.borrowedThenSpent,
      ratio: spend.ratio,
      ratioDisplay: pct(spend.ratio),
      definition:
        'Of addresses that borrowed (user on Borrowed), how many later appear as from on a payment (Paid/PaidToHandle) at or after their first borrow. THE demand-test metric.',
    },
  };

  // --- write the JSON snapshot -------------------------------------------------
  const stamp = readAt.toISOString().slice(0, 10);
  const outPath = opts.outPath
    ? resolve(opts.outPath)
    : join(HERE, 'snapshots', `maren-metrics-${network}-${stamp}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    console.error(`\nSnapshot written to ${outPath}`);
    return;
  }

  // --- dated human summary -----------------------------------------------------
  const chainId = MEZO_CHAIN_IDS[network];
  const label = network === 'testnet' ? 'matsnet' : 'mainnet';
  const lines = [
    '',
    `Maren pilot metrics  ${label} (chain ${chainId})`,
    `read live ${readAt.toISOString()}`,
    `blocks ${scan.deployedAt} to ${scan.head} (deployment floor to head, full history)`,
    '',
    'ADOPTION',
    `  Funded positions .............. ${fundedPositions}   (distinct depositors all time: ${depositorSet.size})`,
    `  Total collateral (live) ....... ${totalCollateralLive === null ? 'unavailable' : `${totalCollateralLive} wei BTC`}`,
    `  Handles registered ............ ${handlesRegistered}`,
    '',
    'DEMAND CREATION',
    `  MUSD borrowed through Maren ... ${musd(musdBorrowedWei)}   (gross drawn, all time)`,
    '',
    'SPENDING',
    `  Payments ...................... ${payments.count} for ${musd(payments.volume)}`,
    `    distinct senders ............ ${payments.distinctSenders}`,
    `    distinct recipients ......... ${payments.distinctRecipients}`,
    `  Requests created / settled .... ${requests.created} / ${requests.settled}  (${musd(requests.settledVolume)} settled)`,
    '',
    'GROWTH LOOP',
    `  Money links created / claimed . ${links.created.count} / ${links.claimed.count}`,
    `  Claims by brand-new addresses . ${claims.brandNewClaims}   (new to Maren)`,
    '',
    'EARN',
    `  TVL (live totalAssets) ........ ${earnTvlWei === null ? 'unavailable' : musd(earnTvlWei)}`,
    `  Current depositors ............ ${earnCurrentDepositors}   (ever deposited: ${earnDepositorSet.size})`,
    '',
    'THE DEMAND TEST  (spend ratio)',
    `  Borrowers ..................... ${spend.borrowers}`,
    `  ...who then spent ............. ${spend.borrowedThenSpent}`,
    `  Spend ratio ................... ${pct(spend.ratio)}`,
    '    of addresses that borrowed, how many then sent a payment. This is THE metric.',
    '',
    `Snapshot written to ${outPath}`,
    '',
  ];
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(`\nmetrics scan failed: ${error.message}`);
  console.error('This is a real failure (transport or config), not an empty result. Nothing was fabricated.');
  exit(1);
});
