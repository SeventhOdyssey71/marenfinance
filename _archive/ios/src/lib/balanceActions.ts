/**
 * Which balance actions a user can take right now, and a plain reason for each one they
 * cannot.
 *
 * This mirrors the web app's preflight-reason pattern: an action is never offered as a
 * live button when the chain would revert it. A disabled action carries a one-line reason
 * a person can act on ("No debt to repay") rather than a dead control with no explanation.
 *
 * It is a pure function of read state so it can be tested at the boundary, away from any
 * React Native runtime. The Balances panel binds its buttons to the result; it does not
 * re-derive any of this in the view.
 *
 * The precedence inside each action is deliberate and ordered from the most fundamental
 * fact to the most incidental. Repay's first question is whether there is any debt at all;
 * only once there is do we ask whether the price feed is live, and only then whether the
 * wallet holds the MUSD to repay with. Answering in the other order would tell someone the
 * oracle is stale when their real blocker is that they owe nothing.
 */

export type BalanceActionKey = 'deposit' | 'withdraw' | 'borrow' | 'repay' | 'pay';

/** Only the fields the enablement rules read. Kept narrow so a test need not build a whole Position. */
export interface BalanceActionState {
  /** null when the position could not be read. */
  position: { collateralWei: bigint; debtWei: bigint } | null;
  /** null when balances could not be read. */
  balances: { musdWei: bigint } | null;
  /** True only when the oracle observation is live enough for the protocol to accept it. */
  priceLive: boolean;
  /**
   * The reason a price-dependent action is blocked, verbatim from `priceGate`. Shown when
   * `priceLive` is false. Null only when the price is live.
   */
  priceReason: string | null;
  /**
   * From `useHealth().canBorrow`: whether Maren policy still allows more borrowing. null
   * when it is unknown (no live price or no position), in which case the price and
   * collateral checks are what gate borrow, not this.
   */
  canBorrow: boolean | null;
}

export interface BalanceAction {
  key: BalanceActionKey;
  label: string;
  enabled: boolean;
  /** One line, shown under a disabled button. Null when the action is enabled. */
  reason: string | null;
}

const LABELS: Record<BalanceActionKey, string> = {
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  borrow: 'Borrow',
  repay: 'Repay',
  pay: 'Pay',
};

/** A blocked action, with its reason. */
function blocked(key: BalanceActionKey, reason: string): BalanceAction {
  return { key, label: LABELS[key], enabled: false, reason };
}

/** An available action. */
function open(key: BalanceActionKey): BalanceAction {
  return { key, label: LABELS[key], enabled: true, reason: null };
}

/**
 * The one place a price-blocked action's reason is chosen.
 *
 * Falls back to a generic sentence if `priceReason` is somehow null while `priceLive` is
 * false — the gate is meant to always supply one, and fail-closed means we still deny
 * rather than quietly enable on a malformed state.
 */
function priceBlock(key: BalanceActionKey, state: BalanceActionState): BalanceAction {
  return blocked(key, state.priceReason ?? 'The price feed is not live, so this would revert.');
}

function depositAction(state: BalanceActionState): BalanceAction {
  // Depositing opens or adjusts a trove, which reads the oracle and reverts on a stale
  // observation. It is the one entry action that needs no existing position, so it is
  // gated only on the price, exactly as the Vault screen gates it.
  if (!state.priceLive) return priceBlock('deposit', state);
  return open('deposit');
}

function withdrawAction(state: BalanceActionState): BalanceAction {
  if (state.position === null) return blocked('withdraw', 'Your position could not be read.');
  if (state.position.collateralWei === 0n) return blocked('withdraw', 'No collateral to withdraw.');
  if (!state.priceLive) return priceBlock('withdraw', state);
  return open('withdraw');
}

function borrowAction(state: BalanceActionState): BalanceAction {
  if (state.position === null) return blocked('borrow', 'Your position could not be read.');
  if (state.position.collateralWei === 0n) return blocked('borrow', 'Deposit Bitcoin first.');
  if (!state.priceLive) return priceBlock('borrow', state);
  if (state.canBorrow === false) {
    return blocked('borrow', 'At your collateral floor. Repay or add collateral to borrow.');
  }
  return open('borrow');
}

function repayAction(state: BalanceActionState): BalanceAction {
  if (state.position === null) return blocked('repay', 'Your position could not be read.');
  if (state.position.debtWei === 0n) return blocked('repay', 'No debt to repay.');
  if (!state.priceLive) return priceBlock('repay', state);
  if (state.balances === null) return blocked('repay', 'Your balance could not be read.');
  if (state.balances.musdWei === 0n) return blocked('repay', 'No MUSD to repay with.');
  return open('repay');
}

function payAction(state: BalanceActionState): BalanceAction {
  // Paying moves MUSD through the relayer and never touches the oracle, so it is not
  // price-gated. It needs only a balance to send.
  if (state.balances === null) return blocked('pay', 'Your balance could not be read.');
  if (state.balances.musdWei === 0n) return blocked('pay', 'No MUSD to send.');
  return open('pay');
}

/**
 * The five actions, in the order they appear under the balance header.
 *
 * Order is deposit, withdraw, borrow, repay, pay — collateral in and out, then debt out
 * and in, then spend. It reads as the lifecycle of the account.
 */
export function balanceActions(state: BalanceActionState): BalanceAction[] {
  return [
    depositAction(state),
    withdrawAction(state),
    borrowAction(state),
    repayAction(state),
    payAction(state),
  ];
}
