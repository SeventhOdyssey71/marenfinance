import { describe, expect, it } from 'vitest';

import { balanceActions, type BalanceActionKey, type BalanceActionState } from './balanceActions';

/**
 * The Balances panel's promise: it never offers an action the chain would revert, and a
 * disabled action always says why in one line. These assertions are that promise, checked.
 *
 * The logic is pure, so it is exercised directly rather than through a rendered panel —
 * the same discipline the rest of this app's tests follow.
 */

const WAD = 10n ** 18n;

/** A healthy, live, borrowing-capable account. Individual tests degrade one field. */
function healthy(overrides: Partial<BalanceActionState> = {}): BalanceActionState {
  return {
    position: { collateralWei: WAD, debtWei: 5_000n * WAD },
    balances: { musdWei: 1_000n * WAD },
    priceLive: true,
    priceReason: null,
    canBorrow: true,
    ...overrides,
  };
}

function byKey(state: BalanceActionState): Record<BalanceActionKey, { enabled: boolean; reason: string | null }> {
  const out = {} as Record<BalanceActionKey, { enabled: boolean; reason: string | null }>;
  for (const action of balanceActions(state)) out[action.key] = { enabled: action.enabled, reason: action.reason };
  return out;
}

describe('balanceActions', () => {
  it('returns the five actions in lifecycle order', () => {
    const keys = balanceActions(healthy()).map((a) => a.key);
    expect(keys).toEqual(['deposit', 'withdraw', 'borrow', 'repay', 'pay']);
  });

  it('enables every action for a healthy, live, funded account', () => {
    for (const action of balanceActions(healthy())) {
      expect(action.enabled).toBe(true);
      expect(action.reason).toBeNull();
    }
  });

  it('gives every enabled action a null reason and every disabled action a non-empty one', () => {
    // A stale price disables the price-dependent actions; the invariant must hold across the mix.
    const actions = balanceActions(healthy({ priceLive: false, priceReason: 'Price feed is 90s old.' }));
    for (const action of actions) {
      if (action.enabled) expect(action.reason).toBeNull();
      else expect(action.reason && action.reason.length).toBeGreaterThan(0);
    }
  });

  describe('repay', () => {
    it('is disabled with "No debt to repay." when there is no debt', () => {
      const repay = byKey(healthy({ position: { collateralWei: WAD, debtWei: 0n } })).repay;
      expect(repay.enabled).toBe(false);
      expect(repay.reason).toBe('No debt to repay.');
    });

    it('is disabled when the wallet holds no MUSD, even with debt outstanding', () => {
      const repay = byKey(healthy({ balances: { musdWei: 0n } })).repay;
      expect(repay.enabled).toBe(false);
      expect(repay.reason).toBe('No MUSD to repay with.');
    });

    it('reports no debt before it reports a stale price', () => {
      // Precedence: the more fundamental fact wins.
      const repay = byKey(
        healthy({ position: { collateralWei: WAD, debtWei: 0n }, priceLive: false, priceReason: 'stale' }),
      ).repay;
      expect(repay.reason).toBe('No debt to repay.');
    });
  });

  describe('withdraw', () => {
    it('is disabled with a collateral reason when collateral is zero', () => {
      const withdraw = byKey(healthy({ position: { collateralWei: 0n, debtWei: 0n } })).withdraw;
      expect(withdraw.enabled).toBe(false);
      expect(withdraw.reason).toBe('No collateral to withdraw.');
    });
  });

  describe('borrow', () => {
    it('tells a new user to deposit first when there is no collateral', () => {
      const borrow = byKey(healthy({ position: { collateralWei: 0n, debtWei: 0n } })).borrow;
      expect(borrow.enabled).toBe(false);
      expect(borrow.reason).toBe('Deposit Bitcoin first.');
    });

    it('is disabled at the collateral floor', () => {
      const borrow = byKey(healthy({ canBorrow: false })).borrow;
      expect(borrow.enabled).toBe(false);
      expect(borrow.reason).toBe('At your collateral floor. Repay or add collateral to borrow.');
    });
  });

  describe('pay', () => {
    it('is disabled with "No MUSD to send." when the wallet is empty', () => {
      const pay = byKey(healthy({ balances: { musdWei: 0n } })).pay;
      expect(pay.enabled).toBe(false);
      expect(pay.reason).toBe('No MUSD to send.');
    });

    it('is NOT price-gated: it stays enabled when the oracle is stale', () => {
      const pay = byKey(healthy({ priceLive: false, priceReason: 'Price feed is 90s old.' })).pay;
      expect(pay.enabled).toBe(true);
    });
  });

  describe('a stale or unavailable price', () => {
    it('carries the gate reason verbatim onto the price-dependent actions', () => {
      const reason = "Price feed is 90s old. Mezo's oracle rejects anything over 60s.";
      const actions = byKey(healthy({ priceLive: false, priceReason: reason }));
      expect(actions.deposit.reason).toBe(reason);
      expect(actions.withdraw.reason).toBe(reason);
      expect(actions.borrow.reason).toBe(reason);
      expect(actions.repay.reason).toBe(reason);
    });

    it('still denies, with a fallback sentence, if the gate somehow supplied no reason', () => {
      // Fail-closed: a malformed state denies rather than enabling.
      const actions = byKey(healthy({ priceLive: false, priceReason: null }));
      expect(actions.deposit.enabled).toBe(false);
      expect(actions.deposit.reason && actions.deposit.reason.length).toBeGreaterThan(0);
    });
  });

  describe('a failed read', () => {
    it('disables the position-dependent actions when the position is unknown', () => {
      const actions = byKey(healthy({ position: null }));
      expect(actions.withdraw.enabled).toBe(false);
      expect(actions.borrow.enabled).toBe(false);
      expect(actions.repay.enabled).toBe(false);
    });

    it('disables pay when the balance is unknown', () => {
      const pay = byKey(healthy({ balances: null })).pay;
      expect(pay.enabled).toBe(false);
      expect(pay.reason).toBe('Your balance could not be read.');
    });
  });
});
