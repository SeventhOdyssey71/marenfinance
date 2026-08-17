import { describe, expect, it } from 'vitest';

import { MAREN_POLICY, MAREN_VAULT, WAD } from './constants';
import { directTroveThreshold } from './borrow';
import { classifyRatio, MAX_CR } from './position';
import { formatPercentTenths } from './format';
import { chooseVaultRoute, vaultCapacity, vaultShareTenths } from './vault';

/**
 * The social vault's own arithmetic, tested against the vault that exists.
 *
 * THE FIXTURE IS NOT INVENTED. `VAULT` below is `MarenVault` at
 * 0x46252B00AB59384518d9dB6D1f210ffF1221645b on Mezo matsnet, read on 2026-08-17:
 *
 *   totalCollateral()  -> 0.069061097205866344 BTC
 *   depositCap()       -> 5 BTC
 *   troveStatus()      -> (0.069061097205866344 BTC, 1801.917676103319484085 MUSD, 2.219762105654257116e18)
 *   collateral(0x457e…CE31) -> 0.001 BTC
 *
 * Those are the figures the vault panel puts on screen, so they are the figures these
 * assertions are written against.
 */
const VAULT = {
  totalCollateralWei: 69_061_097_205_866_344n,
  depositCapWei: 5n * WAD,
  troveIcrWei: 2_219_762_105_654_257_116n, // 221.9%
  userCollateralWei: 10n ** 15n, // 0.001 BTC
};

/** BTC at $63,071.83, the live price read from Mezo's oracle. */
const PRICE = 63_071_830_000_000_000_000_000n;

describe('vaultCapacity', () => {
  it('reports the live vault as barely used, and not full', () => {
    const capacity = vaultCapacity(VAULT.totalCollateralWei, VAULT.depositCapWei);
    // 0.069061 / 5 = 1.38122%, truncated to a tenth.
    expect(capacity.filledTenths).toBe(13);
    expect(formatPercentTenths(capacity.filledTenths)).toBe('1.3%');
    expect(capacity.headroomWei).toBe(VAULT.depositCapWei - VAULT.totalCollateralWei);
    expect(capacity.full).toBe(false);
  });

  it('truncates rather than rounding, so a bar never fills before the cap does', () => {
    // 99.97% of the cap. Rounding to nearest would print 100.0% while 0.0015 BTC of room
    // is left, which is room enough for a deposit.
    const cap = 10n * WAD;
    const capacity = vaultCapacity(cap - 15n * 10n ** 14n, cap);
    expect(capacity.filledTenths).toBe(999);
    expect(formatPercentTenths(capacity.filledTenths)).toBe('99.9%');
    expect(capacity.full).toBe(false);
  });

  it('calls the vault full while the headroom is under one minimum deposit', () => {
    const cap = 5n * WAD;
    // Half a minimum deposit of room. Every deposit from here reverts, so "not quite
    // full" would be a distinction without a difference to anybody trying to use it.
    const capacity = vaultCapacity(cap - MAREN_VAULT.minDeposit / 2n, cap);
    expect(capacity.headroomWei).toBeGreaterThan(0n);
    expect(capacity.full).toBe(true);
  });

  it('never reports more than 100%, even past the cap', () => {
    const capacity = vaultCapacity(7n * WAD, 5n * WAD);
    expect(capacity.filledTenths).toBe(1000);
    expect(capacity.headroomWei).toBe(0n);
    expect(capacity.full).toBe(true);
  });

  it('fails closed when the cap reads zero', () => {
    const capacity = vaultCapacity(0n, 0n);
    expect(capacity.filledTenths).toBe(1000);
    expect(capacity.full).toBe(true);
  });
});

describe('vaultShareTenths', () => {
  it('sizes the live test account against the live vault', () => {
    // 0.001 / 0.069061097205866344 = 1.4480%, truncated.
    const share = vaultShareTenths(VAULT.userCollateralWei, VAULT.totalCollateralWei);
    expect(share).toBe(14);
    expect(formatPercentTenths(share)).toBe('1.4%');
  });

  it('truncates, so a share is never flattered', () => {
    // 0.0499 of 1 BTC is 4.99%, which must not present as 5.0%.
    expect(vaultShareTenths(499n * 10n ** 14n, WAD)).toBe(49);
  });

  it('is zero for an account with nothing in the vault, and for an empty vault', () => {
    expect(vaultShareTenths(0n, VAULT.totalCollateralWei)).toBe(0);
    expect(vaultShareTenths(VAULT.userCollateralWei, 0n)).toBe(0);
  });

  it('never exceeds the whole vault', () => {
    expect(vaultShareTenths(2n * WAD, WAD)).toBe(1000);
  });
});

describe('chooseVaultRoute', () => {
  it('sends a small deposit to the social vault, and says how far short it is', () => {
    const small = 5n * 10n ** 16n; // 0.05 BTC
    const choice = chooseVaultRoute(small, PRICE);
    expect(choice).not.toBeNull();
    expect(choice?.recommended).toBe('social-vault');
    expect(choice?.socialVaultFromWei).toBe(MAREN_VAULT.minDeposit);
    // The threshold is the SDK's one implementation, not a second opinion.
    expect(choice?.ownTroveFromWei).toBe(directTroveThreshold(PRICE));
    expect(choice?.shortfallWei).toBe(directTroveThreshold(PRICE) - small);
    expect(choice?.belowBothMinimums).toBe(false);
  });

  it('sends collateral that clears the protocol minimum to a trove of its own', () => {
    const large = 2n * WAD;
    const choice = chooseVaultRoute(large, PRICE);
    expect(choice?.recommended).toBe('own-trove');
    expect(choice?.shortfallWei).toBe(0n);
  });

  it('flips exactly at the threshold it quotes, so the number on screen is the rule', () => {
    const threshold = directTroveThreshold(PRICE);
    expect(chooseVaultRoute(threshold, PRICE)?.recommended).toBe('own-trove');
    expect(chooseVaultRoute(threshold - 10n ** 12n, PRICE)?.recommended).toBe('social-vault');
  });

  it('marks an amount under 0.001 BTC as having no route at all', () => {
    const choice = chooseVaultRoute(10n ** 14n, PRICE); // 0.0001 BTC
    expect(choice?.belowBothMinimums).toBe(true);
    expect(choice?.recommended).toBe('social-vault');
  });

  it('returns null without a live price rather than quoting a threshold of zero', () => {
    expect(chooseVaultRoute(WAD, 0n)).toBeNull();
  });
});

describe('classifyRatio', () => {
  it('reads the live pooled trove as healthy, above the 180% floor', () => {
    expect(classifyRatio(VAULT.troveIcrWei)).toBe('healthy');
  });

  it('agrees with the policy thresholds at their exact boundaries', () => {
    expect(classifyRatio(MAREN_POLICY.minHealthyCr)).toBe('healthy');
    expect(classifyRatio(MAREN_POLICY.minHealthyCr - 1n)).toBe('caution');
    expect(classifyRatio(MAREN_POLICY.warnCr - 1n)).toBe('warning');
    expect(classifyRatio(MAREN_POLICY.vaultLiquidationCr - 1n)).toBe('danger');
    expect(classifyRatio(WAD)).toBe('liquidatable');
  });

  it('treats the no-debt sentinel as no health rather than as infinite health', () => {
    // `troveStatus()` reports type(uint256).max before the trove is seeded, which is
    // above MAX_CR. A screen that classified that as "healthy" would put a green chip on
    // a vault that does not exist yet.
    expect(classifyRatio(MAX_CR)).toBe('none');
    expect(classifyRatio(2n ** 256n - 1n)).toBe('none');
  });
});

describe('formatPercentTenths', () => {
  it('keeps one decimal without a rounding step', () => {
    expect(formatPercentTenths(0)).toBe('0.0%');
    expect(formatPercentTenths(7)).toBe('0.7%');
    expect(formatPercentTenths(13)).toBe('1.3%');
    expect(formatPercentTenths(1000)).toBe('100.0%');
  });

  it('groups thousands, for a figure that is a percentage of something small', () => {
    expect(formatPercentTenths(12_345)).toBe('1,234.5%');
  });
});
