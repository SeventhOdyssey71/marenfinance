/**
 * Screenshots of every state the transaction sheet has, at 1440 and 390.
 *
 *   PLAYWRIGHT_CORE=... node apps/web/scripts/capture-tx-states.mjs
 *
 * READ THIS BEFORE QUOTING ANY IMAGE THIS PRODUCES.
 *
 * NOTHING IS BROADCAST BY THIS SCRIPT, and it holds no key that could broadcast anything.
 * It drives the real app, connected as a real account, against the real deployed contracts
 * with a signer that is structurally incapable of signing. Six of the seven states below
 * are therefore reached exactly as a user reaches them — including the simulation, which
 * really does run, and the wallet refusal, which really is an EIP-1193 4001.
 *
 * The two SETTLED states are the exception and the exception is bounded. To render them,
 * `eth_sendTransaction` returns the hash of a transaction that is ALREADY MINED on matsnet
 * instead of sending one:
 *
 *   delivered  0x3b34e664140c594c3b10f4b500e4ea2e582f00002086485b93c972f1695e8dd2
 *              MarenVault.deposit, 0.001 BTC, by this same account, block 14,923,865,
 *              323,074 gas, status success. This is the transaction whose confirmation
 *              sheet was screenshotted in the brief that asked for this redesign.
 *   reverted   0x9da5b3eddbab83671b319eef68be5de4ac07628f5d741a0f572a122586a0d47f
 *              MarenVault.borrow, block 14,920,507, status reverted, no logs.
 *
 * Everything the sheet then renders — the receipt, the block, the gas actually paid, the
 * revert reason recovered by replaying the call at the block it failed in — is read live
 * from the chain and is true of those transactions. The single fiction is that the click
 * in this run is what produced them. These images are for judging the design of the sheet;
 * they are not evidence that a transaction happened, and `prove-preflight.mjs` is the
 * script that proves things.
 */

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { connectWallet, installReadOnlyWallet } from './injected-wallet.mjs';

const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const { chromium } = pw.chromium ? pw : pw.default;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '.screenshots');
await mkdir(outDir, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const RPC_URL = process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org';
const ACCOUNT = process.env.MAREN_VIEW_ADDRESS ?? '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31';

const DELIVERED_HASH = '0x3b34e664140c594c3b10f4b500e4ea2e582f00002086485b93c972f1695e8dd2';
const REVERTED_HASH = '0x9da5b3eddbab83671b319eef68be5de4ac07628f5d741a0f572a122586a0d47f';

const mezoTestnet = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

console.log('NOTHING IS BROADCAST BY THIS SCRIPT. See the header comment.');
console.log(`  delivered state rendered from ${DELIVERED_HASH}`);
console.log(`  reverted  state rendered from ${REVERTED_HASH}`);
console.log('');

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ['--use-gl=angle'],
});

const written = [];

/**
 * Delay specific JSON-RPC methods, so a state that is normally over in 200ms can be
 * photographed. It changes only the timing of a real answer, never its content.
 */
async function slowDown(page, methods, ms) {
  await page.route(
    (url) => url.hostname === 'rpc.test.mezo.org',
    async (route) => {
      let body = null;
      try {
        body = JSON.parse(route.request().postData() ?? 'null');
      } catch {
        /* not JSON-RPC; pass it through untouched */
      }
      const method = Array.isArray(body) ? body[0]?.method : body?.method;
      if (method && methods.includes(method)) await new Promise((r) => setTimeout(r, ms));
      await route.continue();
    },
  );
}

/**
 * Open the Vault as the real account, choose an action, and open the sheet on it.
 * Returns once the dialog is on screen in the `confirm` phase.
 */
async function openDepositSheet(page, { amount = '0.001' } = {}) {
  await page.goto(`${BASE}/app/vault`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await connectWallet(page);
  await page.waitForTimeout(4000);
  await page.getByRole('tab', { name: 'Deposit' }).click();
  await page.waitForTimeout(1200);
  await page.locator('input[inputmode=decimal]').first().fill(amount);
  await page.waitForTimeout(600);
  await page
    .locator('main')
    .getByRole('button', { name: /^Deposit/ })
    .last()
    .click();
  await page.locator('[role=dialog]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function shoot(page, name) {
  const dialog = page.locator('[role=dialog]');
  await dialog.screenshot({ path: join(outDir, `${name}.png`) });
  written.push(name);
  const phase = await dialog.getAttribute('data-tx-phase');
  console.log(`  ${name.padEnd(34)} phase=${phase}`);
}

/** A fresh context with the read-only signer, optionally answering with a mined hash. */
async function context(width, height, respondWithHash = null, signDelayMs = 0) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const wallet = await installReadOnlyWallet(ctx, {
    address: ACCOUNT,
    chain: mezoTestnet,
    rpcUrl: RPC_URL,
    respondWithHash,
    signDelayMs,
  });
  const page = await ctx.newPage();
  return { ctx, page, wallet };
}

for (const [width, height, tag] of [
  [1440, 1000, '1440'],
  [390, 844, '390'],
]) {
  // ── confirm ────────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await context(width, height);
    await openDepositSheet(page);
    await shoot(page, `sheet-confirm-${tag}`);
    await ctx.close();
  }

  // ── checking: the eth_call simulation, before the wallet is touched ────────
  {
    const { ctx, page, wallet } = await context(width, height);
    await openDepositSheet(page);
    // Only the simulation is slowed, and only after the sheet is already open, so the
    // page load above is unaffected.
    await slowDown(page, ['eth_call'], 6_000);
    await page
      .locator('[role=dialog]')
      .getByRole('button', { name: /^Deposit/ })
      .click();
    await page.waitForTimeout(1500);
    await shoot(page, `sheet-checking-${tag}`);
    console.log(
      `    signature requests while checking: ${wallet.signatureRequests.length} (must be 0)`,
    );
    await ctx.close();
  }

  // ── signing: simulation passed, the wallet is open ─────────────────────────
  //
  // The delay lives in the signer, not in an RPC route: `eth_sendTransaction` never
  // reaches the node from this provider, it reaches the binding that refuses it.
  {
    const { ctx, page } = await context(width, height, null, 15_000);
    await openDepositSheet(page);
    await page
      .locator('[role=dialog]')
      .getByRole('button', { name: /^Deposit/ })
      .click();
    // Long enough for the simulation to return, short enough that the refusal has not.
    await page.waitForTimeout(6_000);
    await shoot(page, `sheet-signing-${tag}`);
    await ctx.close();
  }

  // ── pending: a hash exists, no receipt yet ─────────────────────────────────
  {
    const { ctx, page } = await context(width, height, DELIVERED_HASH);
    await openDepositSheet(page);
    await slowDown(page, ['eth_getTransactionReceipt'], 12_000);
    await page
      .locator('[role=dialog]')
      .getByRole('button', { name: /^Deposit/ })
      .click();
    await page.waitForTimeout(6_000);
    await shoot(page, `sheet-pending-${tag}`);
    await ctx.close();
  }

  // ── delivered ──────────────────────────────────────────────────────────────
  {
    const { ctx, page } = await context(width, height, DELIVERED_HASH);
    await openDepositSheet(page);
    await page
      .locator('[role=dialog]')
      .getByRole('button', { name: /^Deposit/ })
      .click();
    await page.waitForTimeout(9_000);
    await shoot(page, `sheet-success-${tag}`);
    await ctx.close();
  }

  // ── failed on-chain, with the reason recovered by replay ───────────────────
  {
    const { ctx, page } = await context(width, height, REVERTED_HASH);
    await openDepositSheet(page);
    await page
      .locator('[role=dialog]')
      .getByRole('button', { name: /^Deposit/ })
      .click();
    await page.waitForTimeout(12_000);
    await shoot(page, `sheet-failure-onchain-${tag}`);
    await ctx.close();
  }

  // ── refused at the wallet, nothing sent ────────────────────────────────────
  {
    const { ctx, page } = await context(width, height);
    await openDepositSheet(page);
    await page
      .locator('[role=dialog]')
      .getByRole('button', { name: /^Deposit/ })
      .click();
    await page.waitForTimeout(8_000);
    await shoot(page, `sheet-failure-declined-${tag}`);
    await ctx.close();
  }
}

await browser.close();
console.log(`\nWrote ${written.length} sheet captures to ${outDir}`);
