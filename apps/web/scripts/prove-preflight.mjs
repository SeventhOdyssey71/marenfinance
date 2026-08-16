/**
 * PROOF: the app refuses a doomed borrow before a wallet is ever asked for anything.
 *
 *   PLAYWRIGHT_CORE=... node apps/web/scripts/prove-preflight.mjs
 *
 * WHAT IT PROVES, against the live chain and the real deployed contracts:
 *
 *   1. `MarenVault.troveStatus()` reports the pooled trove BELOW `MIN_TROVE_CR`, so the
 *      contract will refuse every borrow at every amount. Read here, independently of the
 *      app, so the rest of the run is measured against the chain rather than the UI.
 *   2. The Borrow control is DISABLED and the reason is on screen, in the contract's own
 *      words, before anything is touched.
 *   3. The slider is disabled and its range is zero — it cannot be dragged to 17.95 MUSD,
 *      which is what was signed the day this work started.
 *   4. NO SIGNATURE IS EVER REQUESTED. The wallet driving this is structurally incapable
 *      of signing (`installReadOnlyWallet`) and records every attempt; the assertion is
 *      that the array is empty. Clicking the disabled button anyway does not change that.
 *   5. NO TRANSACTION WAS SUBMITTED. The account's nonce is read from the chain before and
 *      after the whole run and must be identical.
 *
 * It also checks the other three vault actions and the MUSD-denominated actions on Pay and
 * Earn, because "disabled with a reason" has to be the rule rather than one special case.
 *
 * Screenshots land in apps/web/.screenshots/ at 1440 and 390.
 */

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPublicClient, http } from 'viem';

import { connectWallet, installReadOnlyWallet } from './injected-wallet.mjs';

const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const { chromium } = pw.chromium ? pw : pw.default;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '.screenshots');
await mkdir(outDir, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const RPC_URL = process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org';

/**
 * The account with a real position: 0.001 BTC of collateral in MarenVault, no debt, and
 * around 0.05 BTC in the wallet. Its deposit is transaction
 * 0x3b34e664…95e8dd2 on matsnet — the one whose confirmation sheet started this work.
 */
const ACCOUNT = process.env.MAREN_VIEW_ADDRESS ?? '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31';
const VAULT = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';

const mezoTestnet = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const vaultAbi = [
  {
    type: 'function',
    name: 'troveStatus',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MIN_TROVE_CR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxBorrowable',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
];

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const ratio = (wad) => `${(Number(wad) / 1e16).toFixed(2)}%`;

/**
 * The ratio as the APP renders it — truncated to one decimal, never rounded.
 *
 * BRAND.md §8: a health figure is never rounded up. `formatCollateralRatio` truncates, so
 * a check written with `toFixed(1)` disagrees with the interface every time the second
 * decimal is 5 or more, and would have failed this run for the wrong reason.
 */
const appRatio = (wad) => `${(Math.floor(Number(wad) / 1e15) / 10).toFixed(1)}%`;

// ── 1. the chain, read independently of the app ──────────────────────────────
const rpc = createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL) });

const [, , troveIcr] = await rpc.readContract({
  address: VAULT,
  abi: vaultAbi,
  functionName: 'troveStatus',
});
const minTroveCr = await rpc.readContract({
  address: VAULT,
  abi: vaultAbi,
  functionName: 'MIN_TROVE_CR',
});
const maxBorrowable = await rpc.readContract({
  address: VAULT,
  abi: vaultAbi,
  functionName: 'maxBorrowable',
  args: [ACCOUNT],
});
const nonceBefore = await rpc.getTransactionCount({ address: ACCOUNT });

console.log('=== chain state, read directly ===');
console.log(`  pooled trove ICR       ${ratio(troveIcr)}`);
console.log(`  MarenVault.MIN_TROVE_CR ${ratio(minTroveCr)}`);
console.log(
  `  maxBorrowable(account)  ${maxBorrowable} wei  (${Number(maxBorrowable) / 1e18} MUSD)`,
);
console.log(`  account nonce           ${nonceBefore}`);
console.log('');

check(
  'chain: the pooled trove is genuinely below the floor, so every borrow reverts',
  troveIcr < minTroveCr,
  `${ratio(troveIcr)} < ${ratio(minTroveCr)}`,
);
check(
  'chain: maxBorrowable() alone would still offer a range — which is the trap',
  maxBorrowable > 0n,
  `${(Number(maxBorrowable) / 1e18).toFixed(2)} MUSD of user-ratio headroom that cannot be drawn`,
);

// ── 2. the app, driven by a signer that cannot sign ──────────────────────────
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ['--use-gl=angle'],
});

/** Open the app as the real account, at a viewport, with a read-only signer. */
async function open(width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const wallet = await installReadOnlyWallet(ctx, {
    address: ACCOUNT,
    chain: mezoTestnet,
    rpcUrl: RPC_URL,
  });
  const page = await ctx.newPage();
  return { ctx, page, wallet };
}

const shots = [];

for (const [width, height, tag] of [
  [1440, 1200, '1440'],
  [390, 900, '390'],
]) {
  const { ctx, page, wallet } = await open(width, height);

  await page.goto(`${BASE}/app/vault`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await connectWallet(page);
  await page.waitForTimeout(4000);

  await page.getByRole('tab', { name: 'Borrow' }).click();
  await page.waitForTimeout(2500);

  const panel = await page.locator('main').innerText();

  // --- the reason, in the contract's own words, before anything is touched ---
  check(
    `${tag}: the borrow refusal is on screen before any attempt`,
    /the pool itself is fully drawn right now/.test(panel),
    'the same sentence the revert carries',
  );
  check(
    `${tag}: it says this is not the user's fault`,
    /This is not about your position/.test(panel) &&
      /Your collateral is untouched and you can withdraw it/.test(panel),
  );
  check(
    `${tag}: it names the live ratios rather than a hardcoded example`,
    panel.includes(appRatio(troveIcr)) && panel.includes(appRatio(minTroveCr)),
    `${appRatio(troveIcr)} against ${appRatio(minTroveCr)}, read from troveStatus()`,
  );
  check(
    `${tag}: it names the contract check, so the claim is falsifiable`,
    /TroveCollateralRatioTooLow/.test(panel),
  );

  // --- the controls ---
  const borrowButton = page.getByRole('button', { name: /^Borrow/ }).last();
  check(`${tag}: the Borrow button is disabled`, await borrowButton.isDisabled());

  const slider = page.locator('input[type=range]');
  check(`${tag}: the borrow slider is disabled`, await slider.isDisabled());
  check(
    `${tag}: the slider's range is zero, so 17.95 MUSD is unreachable`,
    (await slider.getAttribute('aria-valuetext'))?.includes('Borrowing is unavailable') === true,
    await slider.getAttribute('aria-valuetext'),
  );
  check(
    `${tag}: the disabled slider points at the explanation`,
    (await slider.getAttribute('aria-describedby')) === 'borrow-blocked',
  );
  const headline = await page.locator('.t-numeric-xl').first().innerText();
  check(`${tag}: the amount reads 0.00, not a number that cannot be borrowed`, headline === '0.00');

  // The panel itself, cropped — the refusal and the two dead controls in one frame.
  // A full-page capture at this height cuts off below the explanation, which is the half
  // of the evidence that matters.
  const card = page.locator('section').filter({ hasText: 'Borrow MUSD' }).last();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await card.screenshot({ path: join(outDir, `preflight-borrow-disabled-${tag}.png`) });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(outDir, `preflight-vault-page-${tag}.png`),
    fullPage: true,
  });
  shots.push(`preflight-borrow-disabled-${tag}.png`, `preflight-vault-page-${tag}.png`);

  // --- clicking it anyway must do nothing at all ---
  await borrowButton.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1200);
  check(
    `${tag}: forcing a click on the disabled control opens no sheet`,
    (await page.locator('[role=dialog]').count()) === 0,
  );
  check(
    `${tag}: no signature was requested, at any point`,
    wallet.signatureRequests.length === 0,
    `${wallet.signatureRequests.length} requests`,
  );

  // --- the sweep: the other actions state their own reasons ---
  await page.getByRole('tab', { name: 'Repay' }).click();
  await page.waitForTimeout(1200);
  const repay = await page.locator('main').innerText();
  check(
    `${tag}: repay is disabled with a reason, on an account with no debt`,
    /Nothing to repay/.test(repay) &&
      (await page
        .getByRole('button', { name: /^Repay/ })
        .last()
        .isDisabled()),
  );

  await page.getByRole('tab', { name: 'Withdraw' }).click();
  await page.waitForTimeout(1200);
  // The field opens empty on purpose — nobody should be nudged toward a number here — so
  // the exit is exercised by taking the maximum the position can release.
  await page.getByRole('button', { name: /BTC$/ }).first().click();
  await page.waitForTimeout(600);
  const withdrawAmount = await page.locator('input[inputmode=decimal]').first().inputValue();
  check(
    `${tag}: withdraw stays OPEN — an exit is never closed`,
    Number(withdrawAmount) > 0 &&
      !(await page
        .getByRole('button', { name: /^Withdraw/ })
        .last()
        .isDisabled()),
    `${withdrawAmount} BTC releasable while borrowing is shut`,
  );

  await page.getByRole('tab', { name: 'Deposit' }).click();
  await page.waitForTimeout(1200);
  check(
    `${tag}: deposit stays OPEN — it needs no price and no pool headroom`,
    !(await page
      .getByRole('button', { name: /^Deposit/ })
      .last()
      .isDisabled()),
  );

  if (tag === '1440') {
    // Pay and Earn: anything needing MUSD, on an account that holds none.
    await page.goto(`${BASE}/app/pay`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const pay = await page.locator('main').innerText();
    check(
      'pay: Send is disabled with a plain reason when the wallet holds no MUSD',
      /No MUSD to send/.test(pay) &&
        (await page.getByRole('button', { name: /^Send/ }).last().isDisabled()),
    );
    check(
      'pay: the reason connects back to why there is no MUSD',
      /borrowing against Bitcoin in the Vault/.test(pay),
    );
    await page.screenshot({ path: join(outDir, 'preflight-pay-disabled-1440.png') });
    shots.push('preflight-pay-disabled-1440.png');

    await page.goto(`${BASE}/app/earn`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const earn = await page.locator('main').innerText();
    check(
      'earn: depositing is disabled with a plain reason when the wallet holds no MUSD',
      /No MUSD to deposit/.test(earn) &&
        (await page
          .getByRole('button', { name: /^Deposit into Earn/ })
          .last()
          .isDisabled()),
    );
    await page.screenshot({ path: join(outDir, 'preflight-earn-disabled-1440.png') });
    shots.push('preflight-earn-disabled-1440.png');
  }

  check(
    `${tag}: still no signature requested after the whole sweep`,
    wallet.signatureRequests.length === 0,
    JSON.stringify(wallet.signatureRequests),
  );

  await ctx.close();
}

await browser.close();

// ── 3. the chain again ───────────────────────────────────────────────────────
const nonceAfter = await rpc.getTransactionCount({ address: ACCOUNT });
check(
  'chain: the account nonce is unchanged, so nothing was submitted',
  nonceAfter === nonceBefore,
  `${nonceBefore} → ${nonceAfter}`,
);

console.log('');
console.log('Screenshots:', shots.join(', '));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
