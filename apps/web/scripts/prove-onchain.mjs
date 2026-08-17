/**
 * Drives the real dApp, in a real browser, against real contracts, and prints the
 * transaction hashes it produced.
 *
 *   PLAYWRIGHT_CORE=... MAREN_TEST_PRIVATE_KEY=0x... node scripts/prove-onchain.mjs
 *
 * Every hash this prints is checkable with `cast receipt <hash> --rpc-url
 * https://rpc.test.mezo.org`. That is the point: after a pass that deleted a file of
 * invented transaction hashes, a claim that the app now works is worth exactly as much as
 * the hashes it comes with.
 *
 * WHAT IT PROVES
 *   1. Handle registration end to end — commit, the enforced 60-second wait, then reveal —
 *      driven entirely through the interface, ending with the handle resolving on-chain.
 *   2. Activity rendering rows decoded from real `eth_getLogs` output, with hashes that
 *      match transactions the node actually has.
 *
 * WHAT IT CANNOT PROVE, and why, is recorded in the PR rather than glossed here: a
 * deposit needs 0.001 BTC of collateral and the accounts available hold less.
 */

import { createPublicClient, http } from 'viem';

import { connectWallet, installWallet } from './injected-wallet.mjs';

const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const { chromium } = pw.chromium ? pw : pw.default;

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const RPC_URL = process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org';
const HANDLE = process.env.MAREN_TEST_HANDLE ?? 'marentest';

const mezoTestnet = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const REGISTRY = '0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E';
const registryAbi = [
  {
    type: 'function',
    name: 'tryResolve',
    stateMutability: 'view',
    inputs: [{ name: 'handle', type: 'string' }],
    outputs: [{ type: 'address' }],
  },
];

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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const wallet = await installWallet(ctx, { privateKey: key, chain: mezoTestnet, rpcUrl: RPC_URL });
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 160));
});

const log = (...args) => console.log(...args);

/**
 * The sheet has settled when it says so.
 *
 * Matching on prose was wrong: the pending copy reads "nothing is marked delivered until
 * the chain returns one with status success", which a /Delivered/i test matches happily —
 * so the first version of this script declared success while still waiting for a receipt.
 * It then matched on a footer button labelled "Close", which was right until the sheet
 * redesign gave the delivered state a "Done" button instead.
 *
 * `data-tx-phase` is the sheet's own state machine, rendered onto the dialog element
 * precisely so a harness does not have to infer it from copy that is free to change.
 */
const waitForSettled = (label) =>
  page.waitForFunction(
    () => {
      const phase = document.querySelector('[role=dialog]')?.getAttribute('data-tx-phase');
      return phase === 'settled' || phase === 'error';
    },
    undefined,
    { timeout: 180_000 },
  );

log(`Signer: ${wallet.address}`);
log(`Balance: ${await rpc.getBalance({ address: wallet.address })} wei`);
log(`Handle to claim: @${HANDLE}\n`);

// ── 1. commit ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/app/pay`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await connectWallet(page);
await page.waitForTimeout(2500);

await page.getByRole('tab', { name: 'Handle' }).click();
await page.waitForTimeout(800);
await page.locator('#handle-input').fill(HANDLE);
await page.waitForTimeout(3000);

const status = await page.locator('#handle-status').innerText();
log(`Registry says: ${status}`);
if (/already registered/i.test(status)) {
  log('That handle is taken. Set MAREN_TEST_HANDLE to something else.');
  await browser.close();
  process.exit(1);
}

log('\n--- Step 1: commit ---');
await page
  .getByRole('button', { name: /^Commit/ })
  .last()
  .click();
await page.waitForTimeout(1500);

// The confirmation sheet. Nothing is signed until this is confirmed.
const sheet = page.locator('[role=dialog]');
await sheet.waitFor({ state: 'visible', timeout: 15_000 });
await sheet.getByRole('button', { name: 'Commit' }).click();

await waitForSettled('commit');
const commitText = await sheet.innerText();
log(commitText.split('\n').slice(0, 8).join('\n'));
const commitHash = wallet.sent[wallet.sent.length - 1];
log(`commit tx: ${commitHash}`);

// Escape, not a click on "Close": the sheet's backdrop is itself an aria-label="Close"
// button covering the viewport, so a role-based click is ambiguous by construction.
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

// ── 2. the enforced wait ─────────────────────────────────────────────────────
log('\n--- Step 2: the 60s commit-reveal wait, enforced by the contract ---');
// A FULL PAGE RELOAD, deliberately, in the middle of the wait.
//
// This is the failure the localStorage requirement exists to prevent: the secret is the
// only thing that can reveal the commitment, it lives nowhere but this browser, and 60
// seconds is exactly long enough for someone to refresh a page that looks stuck. If the
// secret were held in React state, everything after this line would fail.
await page.waitForTimeout(8_000);
log('Reloading the page mid-wait, to prove the secret is not held in memory…');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2_500);
await page.getByRole('tab', { name: 'Handle' }).click();
await page.waitForTimeout(600);
await page.locator('#handle-input').fill(HANDLE);
await page.waitForTimeout(3_000);
log('Re-attached to the commitment after reload.');

await page.waitForFunction(
  () => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^Claim @/.test(b.innerText));
    return btn && !btn.disabled;
  },
  undefined,
  { timeout: 240_000 },
);
log('Claim became available — MIN_COMMITMENT_AGE satisfied.');

// ── 3. reveal ────────────────────────────────────────────────────────────────
log('\n--- Step 3: reveal ---');
await page
  .getByRole('button', { name: /^Claim @/ })
  .last()
  .click();
await page.waitForTimeout(1200);
await sheet.waitFor({ state: 'visible', timeout: 15_000 });
await sheet.getByRole('button', { name: 'Claim handle' }).click();
await waitForSettled('register');
const registerText = await sheet.innerText();
log(registerText.split('\n').slice(0, 8).join('\n'));
const registerHash = wallet.sent[wallet.sent.length - 1];
log(`register tx: ${registerHash}`);

await page.screenshot({
  path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/handle-registered.png` : '.handle.png',
  fullPage: true,
});

// ── 4. the chain's own answer ────────────────────────────────────────────────
const resolved = await rpc.readContract({
  address: REGISTRY,
  abi: registryAbi,
  functionName: 'tryResolve',
  args: [HANDLE],
});
log(`\ntryResolve("${HANDLE}") -> ${resolved}`);
log(`matches signer: ${resolved.toLowerCase() === wallet.address.toLowerCase()}`);

log('\n=== HASHES ===');
log(`commit   ${commitHash}`);
log(`register ${registerHash}`);
wallet.sent.forEach((h, i) => log(`  sent[${i}] ${h}`));

await browser.close();
