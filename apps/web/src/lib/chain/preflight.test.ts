import { describe, expect, it } from 'vitest';
import { MAREN_VAULT, WAD } from '@maren/sdk';

import {
  GAS_HEADROOM_WEI,
  preflightBorrow,
  preflightDeposit,
  preflightEarnWithdraw,
  preflightMusdSpend,
  preflightRelayed,
  preflightRepay,
  preflightWithdraw,
  type VaultState,
} from './preflight';
import type { PriceFeed } from './price';
import type { Balances, Position, ProtocolStats } from '../data/types';

/**
 * The preflight, tested against the state that produced it.
 *
 * THE FIXTURE IS NOT INVENTED. Every number in `MATSNET` below was read from Mezo matsnet
 * on 2026-08-16 with `eth_call` against MarenVault at
 * 0x46252B00AB59384518d9dB6D1f210ffF1221645b, for the account
 * 0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31:
 *
 *   troveStatus()              → (0.048 BTC, 1801.836820565243436690 MUSD, 1.510537706637935891e18)
 *   collateral(user)           → 0.001 BTC
 *   previewDebtOf(user)        → 0
 *   maxBorrowable(user)        → 34.998263888888888888 MUSD
 *   troveMaxBorrowingCapacity()→ 2749.201745454545454545 MUSD
 *   reserveMUSD()              → 1800 MUSD
 *   depositCap()               → 5 BTC · totalCollateral() → 0.049 BTC
 *   borrowingPaused/depositsPaused → false
 *
 * That is the exact configuration in which the owner dragged the borrow slider to 17.95
 * MUSD, paid the gas, and got a revert. The first test below is that transaction, and it
 * fails now — in the interface, for free, with the reason.
 *
 * NOTE THE SHAPE OF THE 151% CASE. `maxBorrowable` returns 34.99 MUSD, which is a true
 * answer to a question about the USER's ratio and a useless one about whether a borrow can
 * succeed. The vault also requires `troveCr >= MIN_TROVE_CR` and applies it unconditionally
 * — even to a borrow served wholly from the 1,800 MUSD reserve, which adds no trove debt at
 * all. Any preflight that trusted `maxBorrowable` alone would reproduce the original bug
 * exactly, so there is a test asserting the borrow is refused at a size the reserve could
 * cover ten times over.
 */

const btc = (n: string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n;
const musd = (n: string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n;

/** BTC/USD as the oracle precompile reported it on the day. */
const PRICE_WEI = 63_071_830_000_000_000_000_000n;

const livePrice: PriceFeed = {
  state: 'live',
  priceWei: PRICE_WEI,
  observedAt: 1_755_300_000,
  ageSeconds: 3,
};

const stalePrice: PriceFeed = {
  state: 'stale',
  lastKnownWei: PRICE_WEI,
  observedAt: 1_755_299_000,
  ageSeconds: 412,
};

const MATSNET: ProtocolStats = {
  totalCollateralWei: btc('0.049'),
  troveCollateralWei: btc('0.048'),
  troveNetDebtWei: 1_801_836_820_565_243_436_690n,
  troveIcrWei: 1_510_537_706_637_935_891n, // 151.05%
  reserveMusdWei: musd('1800'),
  troveMaxBorrowingCapacityWei: 2_749_201_745_454_545_454_545n,
  troveOpen: true,
  depositCapWei: btc('5'),
  idleCollateralWei: btc('0.001'),
  depositsPaused: false,
  borrowingPaused: false,
  // MUSD's own TCR, which is a different number from the pooled trove's ICR and moves
  // independently of it. 190.5% on matsnet on 2026-08-19, comfortably over the 150% CCR.
  systemTcrWei: 1_905_253_389_925_169_356n,
  recoveryMode: false,
};

/** The same trove, recapitalised past the floor. Only `troveIcrWei` moves. */
const HEALTHY_POOL: ProtocolStats = { ...MATSNET, troveIcrWei: 2_400_000_000_000_000_000n };

/**
 * A healthy Maren pool inside an UNHEALTHY MUSD. The combination is the whole point: every
 * Maren-side number says go, and Mezo refuses anyway. 148% is under the 150% CCR.
 */
const RECOVERY_MODE: ProtocolStats = {
  ...HEALTHY_POOL,
  systemTcrWei: 1_480_000_000_000_000_000n,
  recoveryMode: true,
};

const POSITION: Position = {
  collateralWei: btc('0.001'),
  debtWei: 0n,
  principalWei: 0n,
  interestWei: 0n,
  interestRateBps: 100,
  maxBorrowingCapacityWei: 2_749_201_745_454_545_454_545n,
  vaultMaxBorrowableWei: 34_998_263_888_888_888_888n,
  route: 'pooled',
  openedAt: 0,
};

const BALANCES: Balances = { musdWei: 0n, btcWei: 50_799_999_952_831_196n };

const state = (over: Partial<VaultState> = {}): VaultState => ({
  price: livePrice,
  position: POSITION,
  balances: BALANCES,
  stats: MATSNET,
  ...over,
});

describe('borrow — the transaction that produced this module', () => {
  it('refuses 17.95 MUSD, the amount that was actually signed and reverted', () => {
    const result = preflightBorrow(state(), musd('17.95'));

    expect(result.ok).toBe(false);
    expect(result.blocker?.name).toBe('TroveCollateralRatioTooLow');
    expect(result.maxWei).toBe(0n);
  });

  it('kills the whole range, not just that amount', () => {
    // The failure mode being designed out: a slider whose stops are all reverts.
    for (const amount of [1n, musd('0.01'), musd('17.95'), musd('34.99')]) {
      const result = preflightBorrow(state(), amount);
      expect(result.ok).toBe(false);
      expect(result.rangeDead).toBe(true);
      expect(result.maxWei).toBe(0n);
    }
  });

  it('refuses even an amount the MUSD reserve could serve outright', () => {
    // 100 MUSD against an 1,800 MUSD reserve adds no trove debt whatsoever, and the vault
    // refuses it anyway: the `troveCr` check is unconditional. A preflight that modelled
    // "reserve-served borrows are free" would wrongly enable this.
    const result = preflightBorrow(state(), musd('100'));
    expect(result.ok).toBe(false);
    expect(result.blocker?.name).toBe('TroveCollateralRatioTooLow');
  });

  it('carries the contract’s own words, with the live ratios in them', () => {
    const { blocker } = preflightBorrow(state(), musd('17.95'));
    expect(blocker?.detail).toContain('151.0%');
    expect(blocker?.detail).toContain('180.0%');
    expect(blocker?.detail).toContain('itself is fully drawn right now');
    expect(blocker?.detail).toContain('Your collateral is untouched and you can withdraw it');
    // Not the user's fault, and the scope says so — which is what colours it amber.
    expect(blocker?.scope).toBe('pool');
  });

  it('opens again the moment the shared trove clears its floor', () => {
    const result = preflightBorrow(state({ stats: HEALTHY_POOL }), musd('17.95'));
    expect(result.ok).toBe(true);
    expect(result.rangeDead).toBe(false);
    expect(result.maxWei).toBe(34_998_263_888_888_888_888n);
  });

  it('still caps at maxBorrowable once the pool is healthy', () => {
    const result = preflightBorrow(state({ stats: HEALTHY_POOL }), musd('35.5'));
    expect(result.ok).toBe(false);
    expect(result.blocker?.scope).toBe('input');
    expect(result.maxWei).toBe(34_998_263_888_888_888_888n);
  });

  it('blocks on a stale oracle before it looks at any ratio', () => {
    const result = preflightBorrow(
      state({ stats: HEALTHY_POOL, price: stalePrice }),
      musd('17.95'),
    );
    expect(result.ok).toBe(false);
    expect(result.blocker?.scope).toBe('feed');
    expect(result.blocker?.detail).toContain('412s old');
  });

  it('blocks while borrowing is paused', () => {
    const paused = { ...HEALTHY_POOL, borrowingPaused: true };
    const result = preflightBorrow(state({ stats: paused }), musd('1'));
    expect(result.blocker?.name).toBe('BorrowingIsPaused');
    expect(result.rangeDead).toBe(true);
  });

  it('blocks when the pooled trove has never been opened', () => {
    const unseeded = { ...HEALTHY_POOL, troveOpen: false };
    const result = preflightBorrow(state({ stats: unseeded }), musd('1'));
    expect(result.blocker?.name).toBe('TroveNotOpen');
  });

  it('fails closed while the chain has not been read', () => {
    expect(preflightBorrow(state({ stats: undefined }), musd('1')).ok).toBe(false);
    expect(preflightBorrow(state({ position: undefined }), musd('1')).ok).toBe(false);
  });
});

describe('deposit', () => {
  it('allows the 0.05 BTC the form defaults to', () => {
    expect(preflightDeposit(state(), btc('0.05')).ok).toBe(true);
  });

  it('refuses below MIN_DEPOSIT, in the contract’s words', () => {
    const result = preflightDeposit(state(), btc('0.0001'));
    expect(result.ok).toBe(false);
    expect(result.blocker?.name).toBe('DepositBelowMinimum');
    expect(result.blocker?.detail).toContain('0.001 BTC');
  });

  it('keeps back gas rather than letting a wallet spend itself dry', () => {
    const result = preflightDeposit(state(), BALANCES.btcWei);
    expect(result.ok).toBe(false);
    expect(result.blocker?.scope).toBe('wallet');
    expect(result.maxWei).toBe(BALANCES.btcWei - GAS_HEADROOM_WEI);
  });

  it('refuses a deposit that would cross the vault’s cap', () => {
    const result = preflightDeposit(state(), btc('4.99'));
    expect(result.ok).toBe(false);
    expect(result.blocker?.name).toBe('DepositCapExceeded');
  });

  it('works with the oracle down — deposit needs no price', () => {
    expect(preflightDeposit(state({ price: stalePrice }), btc('0.05')).ok).toBe(true);
  });

  it('blocks while deposits are paused', () => {
    const paused = { ...MATSNET, depositsPaused: true };
    const result = preflightDeposit(state({ stats: paused }), btc('0.05'));
    expect(result.blocker?.name).toBe('DepositsArePaused');
    expect(result.rangeDead).toBe(true);
  });
});

describe('repay', () => {
  const INDEBTED: Position = { ...POSITION, debtWei: musd('20'), principalWei: musd('20') };

  it('refuses when there is no debt', () => {
    const result = preflightRepay(state(), musd('5'));
    expect(result.blocker?.name).toBe('NoDebt');
    expect(result.rangeDead).toBe(true);
  });

  it('refuses when the wallet holds no MUSD', () => {
    const result = preflightRepay(state({ position: INDEBTED }), musd('5'));
    expect(result.ok).toBe(false);
    expect(result.blocker?.scope).toBe('wallet');
  });

  it('allows a repayment covered by the balance', () => {
    const funded = state({ position: INDEBTED, balances: { ...BALANCES, musdWei: musd('50') } });
    const result = preflightRepay(funded, musd('20'));
    expect(result.ok).toBe(true);
    // Capped at the debt, not the balance: repaying more repays exactly what is owed.
    expect(result.maxWei).toBe(musd('20'));
  });

  it('stays open with a stale oracle — an exit is never priced', () => {
    const funded = state({
      position: INDEBTED,
      balances: { ...BALANCES, musdWei: musd('50') },
      price: stalePrice,
    });
    expect(preflightRepay(funded, musd('20')).ok).toBe(true);
  });
});

describe('withdraw', () => {
  it('lets a debt-free user take everything', () => {
    const result = preflightWithdraw(state(), btc('0.001'));
    expect(result.ok).toBe(true);
    expect(result.maxWei).toBe(btc('0.001'));
  });

  it('refuses more collateral than the account holds', () => {
    const result = preflightWithdraw(state(), btc('0.01'));
    expect(result.blocker?.name).toBe('InsufficientCollateral');
  });

  it('lets a debt-free user leave even with the oracle down, up to the idle balance', () => {
    // MarenVault._sendCollateral pays out of idle BTC first and needs no price to do it.
    const result = preflightWithdraw(state({ price: stalePrice }), btc('0.001'));
    expect(result.ok).toBe(true);
  });

  it('blocks a withdrawal against debt while the oracle is stale', () => {
    const indebted: Position = { ...POSITION, debtWei: musd('20'), principalWei: musd('20') };
    const result = preflightWithdraw(
      state({ position: indebted, price: stalePrice }),
      btc('0.0001'),
    );
    expect(result.ok).toBe(false);
    expect(result.blocker?.scope).toBe('feed');
    expect(result.blocker?.detail).toContain('Repaying is still open');
  });

  it('caps at the 180% floor when there is debt', () => {
    // 0.001 BTC at $63,071.83 is $63.07 of collateral. Holding 180% against 20 MUSD of
    // debt reserves $36, so about 0.000429 BTC can leave.
    const indebted: Position = { ...POSITION, debtWei: musd('20'), principalWei: musd('20') };
    const result = preflightWithdraw(state({ position: indebted }), btc('0.001'));
    expect(result.ok).toBe(false);
    expect(result.maxWei).toBeGreaterThan(0n);
    expect(result.maxWei).toBeLessThan(btc('0.001'));
    // And the figure it quotes really does hold the floor.
    const remaining = POSITION.collateralWei - result.maxWei;
    expect((remaining * PRICE_WEI) / musd('20')).toBeGreaterThanOrEqual(MAREN_VAULT.minBorrowCr);
  });
});

/**
 * MUSD's Recovery Mode, which is the one refusal in this module that is not Maren's.
 *
 * Every fixture here uses HEALTHY_POOL, so Maren's own arithmetic says yes to all of it.
 * That is the case worth testing: the pooled trove is over its floor, the user is over
 * theirs, the oracle is fresh, and Mezo refuses anyway because the PROTOCOL is under its
 * 150% CCR. Before these fields existed the controls stayed enabled and the user paid gas
 * to be told, in Solidity, "BorrowerOps: Collateral withdrawal not permitted Recovery Mode".
 *
 * The three restrictions being modelled were read out of the deployed BorrowerOperations
 * runtime bytecode on 2026-08-19, not from Mezo's docs, which describe only the third.
 */
describe('MUSD Recovery Mode', () => {
  it('kills the entire borrow range even on a pool that is otherwise healthy', () => {
    const result = preflightBorrow(state({ stats: RECOVERY_MODE }), musd('17.95'));

    expect(result.ok).toBe(false);
    expect(result.rangeDead).toBe(true);
    expect(result.maxWei).toBe(0n);
    // Not the user's doing, so it must not be coloured as their mistake.
    expect(result.blocker?.scope).toBe('pool');
    expect(result.blocker?.title).toBe('MUSD is in Recovery Mode');
  });

  it('names the protocol’s own ratio, not the pool’s', () => {
    const { blocker } = preflightBorrow(state({ stats: RECOVERY_MODE }), musd('1'));
    // 148% is MUSD's TCR. 240% is the pooled trove's ICR, and quoting that here would be
    // both true and completely misleading about why this failed.
    expect(blocker?.detail).toContain('148.0%');
    expect(blocker?.detail).not.toContain('240.0%');
    expect(blocker?.detail).toContain('Depositing and repaying are still open');
  });

  it('outranks the stale-oracle gate, because no fresher price would help', () => {
    const result = preflightBorrow(
      state({ stats: RECOVERY_MODE, price: stalePrice }),
      musd('17.95'),
    );
    expect(result.blocker?.scope).toBe('pool');
    expect(result.blocker?.title).toBe('MUSD is in Recovery Mode');
  });

  it('does not block on an UNKNOWN recovery mode, which the price gate already covers', () => {
    // `recoveryMode: null` means the price read that answers it failed. Blocking twice for
    // one cause would report a protocol emergency that may not exist.
    const unknown = { ...HEALTHY_POOL, systemTcrWei: null, recoveryMode: null };
    expect(preflightBorrow(state({ stats: unknown }), musd('17.95')).ok).toBe(true);
  });

  it('refuses every withdrawal when no collateral is sitting idle', () => {
    // All of it is inside the trove, so `_sendCollateral` must call `withdrawColl`, and
    // that is the call Mezo blocks outright.
    const noIdle = { ...RECOVERY_MODE, idleCollateralWei: 0n };
    const result = preflightWithdraw(state({ stats: noIdle }), btc('0.0001'));

    expect(result.ok).toBe(false);
    expect(result.rangeDead).toBe(true);
    expect(result.maxWei).toBe(0n);
    expect(result.blocker?.scope).toBe('pool');
  });

  it('still lets idle collateral leave, because it never touches BorrowerOperations', () => {
    const partIdle = { ...RECOVERY_MODE, idleCollateralWei: btc('0.0004') };
    const result = preflightWithdraw(state({ stats: partIdle }), btc('0.0004'));
    expect(result.ok).toBe(true);
  });

  it('caps a withdrawal at the idle balance and says why it is not about the ratio', () => {
    const partIdle = { ...RECOVERY_MODE, idleCollateralWei: btc('0.0004') };
    // The account is debt-free, so its own ratio permits all 0.001 BTC. Recovery Mode is
    // the only thing binding, and the copy has to say so or the user goes to repay a debt
    // they do not have.
    const result = preflightWithdraw(state({ stats: partIdle }), btc('0.001'));

    expect(result.ok).toBe(false);
    expect(result.maxWei).toBe(btc('0.0004'));
    expect(result.blocker?.scope).toBe('pool');
    expect(result.blocker?.title).toBe('MUSD is in Recovery Mode');
    expect(result.blocker?.detail).not.toContain('floor');
  });

  it('leaves deposit and repay open, since both lift the protocol back out', () => {
    const indebted: Position = { ...POSITION, debtWei: musd('20'), principalWei: musd('20') };
    const funded: Balances = { ...BALANCES, musdWei: musd('20') };

    expect(preflightDeposit(state({ stats: RECOVERY_MODE }), btc('0.01')).ok).toBe(true);
    expect(
      preflightRepay(state({ stats: RECOVERY_MODE, position: indebted, balances: funded }), musd('20')).ok,
    ).toBe(true);
  });

  it('changes nothing at all when the protocol is not in Recovery Mode', () => {
    // The regression guard for the clamp: HEALTHY_POOL has 0.001 BTC idle and the account
    // holds 0.001 BTC, so a null cap must not silently become a binding one.
    const result = preflightWithdraw(state({ stats: HEALTHY_POOL }), btc('0.001'));
    expect(result.ok).toBe(true);
    expect(result.maxWei).toBe(btc('0.001'));
  });
});

describe('MUSD-denominated actions elsewhere in the product', () => {
  it('closes Send, Link and Earn deposits when the wallet holds no MUSD', () => {
    const result = preflightMusdSpend(BALANCES, musd('10'), { verb: 'send', noun: 'Send' });
    expect(result.ok).toBe(false);
    expect(result.rangeDead).toBe(true);
    expect(result.blocker?.title).toBe('No MUSD to send');
    expect(result.blocker?.detail).toContain('borrowing against Bitcoin in the Vault');
  });

  it('refuses more than the balance', () => {
    const funded: Balances = { ...BALANCES, musdWei: musd('5') };
    const result = preflightMusdSpend(funded, musd('10'), { verb: 'send', noun: 'Send' });
    expect(result.ok).toBe(false);
    expect(result.maxWei).toBe(musd('5'));
  });

  it('closes an Earn withdrawal when there are no shares', () => {
    const result = preflightEarnWithdraw(
      { sharesWei: 0n, assetsWei: 0n, depositedWei: 0n, trailing: emptyTrailing },
      musd('1'),
    );
    expect(result.rangeDead).toBe(true);
  });

  it('allows an Earn withdrawal up to the assets held', () => {
    const held = {
      sharesWei: musd('40'),
      assetsWei: musd('42'),
      depositedWei: musd('40'),
      trailing: emptyTrailing,
    };
    expect(preflightEarnWithdraw(held, musd('42')).ok).toBe(true);
    expect(preflightEarnWithdraw(held, musd('42.01')).ok).toBe(false);
  });

  it('refuses anything that would need the relayer, while none is deployed', () => {
    const result = preflightRelayed(false);
    expect(result.ok).toBe(false);
    expect(result.blocker?.title).toBe('Maren’s relayer is not running');
    expect(preflightRelayed(true).ok).toBe(true);
  });
});

const emptyTrailing = {
  windowDays: 0,
  realisedWei: 0n,
  liquidationEvents: 0,
  lastGainAt: null,
};

describe('the arithmetic these fixtures depend on', () => {
  it('states the fixture price and the WAD scale it is in', () => {
    expect(PRICE_WEI / WAD).toBe(63_071n);
  });
});
