/**
 * Proves the Activity screen renders rows decoded from real chain logs.
 *
 *   PLAYWRIGHT_CORE=... MAREN_TEST_PRIVATE_KEY=0x... node scripts/prove-activity.mjs
 *
 * Point it at an account with history. It prints the rows the interface drew, then reads
 * the same events straight from the node with `eth_getLogs` and prints those, so the two
 * can be compared line for line.
 *
 * This is the check the deleted `mock.ts` could never have passed: its rows referenced
 * transaction hashes that no node has ever held.
 */

import { createPublicClient, http, parseAbiItem } from 'viem';

import { connectWallet, installWallet } from './injected-wallet.mjs';

const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const { chromium } = pw.chromium ? pw : pw.default;

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const RPC_URL = process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org';
const VAULT = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';
const DEPLOY_BLOCK = 14_911_471n;

const mezoTestnet = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const key = process.env.MAREN_TEST_PRIVATE_KEY;
if (!key) {
  console.error('MAREN_TEST_PRIVATE_KEY is required.');
  process.exit(1);
}

const rpc = createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL) });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ['--use-gl=angle'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
const wallet = await installWallet(ctx, { privateKey: key, chain: mezoTestnet, rpcUrl: RPC_URL });
const page = await ctx.newPage();

console.log(`Account: ${wallet.address}\n`);

await page.goto(`${BASE}/app/activity`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await connectWallet(page);
await page.waitForTimeout(9000);

const rendered = await page.locator('main').innerText();
console.log('=== WHAT THE INTERFACE DREW ===');
console.log(rendered);

const links = await page
  .locator('main a[href*="/tx/"]')
  .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
console.log('\n=== EXPLORER LINKS RENDERED ===');
links.forEach((l) => console.log(' ', l));

await page.screenshot({
  path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/activity-live.png` : '.activity.png',
  fullPage: true,
});

// The same question, asked of the node directly.
console.log('\n=== WHAT THE NODE SAYS (eth_getLogs, MarenVault) ===');
const head = await rpc.getBlockNumber();
const logs = await rpc.getLogs({
  address: VAULT,
  events: [
    parseAbiItem(
      'event Deposited(address indexed user, uint256 amount, uint256 newCollateral, bool pushedToTrove)',
    ),
    parseAbiItem('event Withdrawn(address indexed user, uint256 amount, uint256 newCollateral)'),
    parseAbiItem(
      'event Borrowed(address indexed user, uint256 amount, uint256 debtAdded, uint256 newDebt, bool fromReserve)',
    ),
    parseAbiItem('event Repaid(address indexed user, uint256 amount, uint256 newDebt)'),
  ],
  fromBlock: head - 9_000n > DEPLOY_BLOCK ? head - 9_000n : DEPLOY_BLOCK,
  toBlock: head,
});

for (const log of logs) {
  if (log.args.user?.toLowerCase() !== wallet.address.toLowerCase()) continue;
  console.log(
    ` ${log.eventName.padEnd(10)} block ${log.blockNumber}  amount ${log.args.amount}  tx ${log.transactionHash}`,
  );
}

await browser.close();
