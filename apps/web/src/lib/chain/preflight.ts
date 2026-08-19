import {
  MAREN_POLICY,
  MAREN_VAULT,
  borrowCeiling,
  collateralRatio,
  formatBtc,
  formatCollateralRatio,
  formatMusd,
  maxWithdrawable,
  previewBorrow,
} from '@maren/sdk';

import { describeRevert, type RevertReason } from './errors';
import { priceGate, type PriceFeed } from './price';
import type { Balances, EarnPosition, Position, ProtocolStats } from '../data/types';

/**
 * PREFLIGHT — every precondition, evaluated from chain state, BEFORE the control is enabled.
 *
 * This module exists because of one transaction. The owner opened the Vault, dragged the
 * borrow slider to 17.95 MUSD, pressed Borrow, paid the gas, and got a revert. Nothing
 * about that failure was a surprise to the chain: Maren's pooled trove sits at 151.05%
 * against the 180% `MIN_TROVE_CR` the vault checks unconditionally, so on that day NO
 * borrow could succeed — not 17.95 MUSD, not one wei, not at any collateral ratio the user
 * could have reached by depositing. The app had already read that number. It rendered it,
 * in amber, on the panel above. And then it let him sign.
 *
 * DISCOVERING A GUARANTEED FAILURE BY PAYING FOR IT IS THE WORST POSSIBLE WAY TO LEARN IT.
 *
 * So the rule this module enforces is: a control is enabled only when every condition the
 * contract will check has already been checked here and passed. Where one fails, the
 * control is disabled and the reason is stated beside it — not in a modal afterwards.
 *
 * THREE PROPERTIES, IN ORDER OF HOW MUCH THEY MATTER:
 *
 *   1. THE CHECKS ARE THE CONTRACT'S, IN THE CONTRACT'S ORDER. Each one below names the
 *      line of `MarenVault.sol` it stands in for. A preflight that invents its own rules
 *      is a second implementation of the vault, and the two will disagree eventually — in
 *      whichever direction is worse for the user.
 *
 *   2. THE COPY IS THE CONTRACT'S TOO. Every refusal is built by `describeRevert()` from
 *      `./errors.ts`, called with the arguments the revert itself would have carried. The
 *      sentence on the disabled Borrow button is therefore literally the sentence the user
 *      would have read after paying for the revert — "This is not about your position —
 *      the pool itself is fully drawn right now" — with the same live numbers in it. There
 *      is no second, gentler copy deck that can go stale.
 *
 *   3. IT FAILS CLOSED. An unread balance, an unread `ProtocolStats`, a price feed we have
 *      not classified yet — all of them BLOCK. "We do not know" and "you may proceed" are
 *      different answers, and only one of them is safe to guess.
 *
 * WHAT THIS DOES NOT REPLACE: the `eth_call` simulation in `./write.ts`, which runs
 * against live state immediately before the wallet opens. This module stops a doomed
 * action being offered; the simulation stops a doomed action being signed when state moved
 * between the render and the press. Both, always — see the comment on `send()` there.
 */

/** Where a constraint lives. Chooses a tone; never changes the words. */
export type BlockerScope =
  /** The shared trove or the vault itself. The user cannot fix it by acting differently. */
  | 'pool'
  /** This user's own position — fixable by depositing, repaying, or asking for less. */
  | 'position'
  /** What the wallet is holding. */
  | 'wallet'
  /** The BTC/USD oracle. */
  | 'feed'
  /** What has been typed into the form. */
  | 'input'
  /** We have not finished reading the chain. Blocks, and says so. */
  | 'loading';

export interface Blocker extends RevertReason {
  scope: BlockerScope;
}

export interface Preflight {
  /** True when every precondition this app can evaluate is satisfied. */
  ok: boolean;
  /** The first unsatisfied precondition, or null. */
  blocker: Blocker | null;
  /**
   * True when NO amount can succeed, so the amount control itself is dead.
   *
   * Distinct from `blocker !== null`: typing 900 MUSD when 35 is available is a blocked
   * ACTION with a live control, and dragging back down fixes it. A pooled trove under its
   * floor is a dead RANGE, and there is nothing to drag to.
   */
  rangeDead: boolean;
  /** The largest amount that could succeed right now. Zero when nothing can. */
  maxWei: bigint;
}

const ok = (maxWei: bigint): Preflight => ({ ok: true, blocker: null, rangeDead: false, maxWei });

const blocked = (
  blocker: Blocker,
  opts: { rangeDead?: boolean; maxWei?: bigint } = {},
): Preflight => ({
  ok: false,
  blocker,
  rangeDead: opts.rangeDead ?? false,
  maxWei: opts.maxWei ?? 0n,
});

/** A refusal in the contract's own words, with the arguments the revert would carry. */
const fromContract = (
  scope: BlockerScope,
  name: string,
  args: readonly unknown[] = [],
): Blocker => ({ ...describeRevert(name, args), scope });

/** A refusal the contract has no error for — a wallet balance, a form field. */
const local = (scope: BlockerScope, title: string, detail: string): Blocker => ({
  scope,
  title,
  detail,
  name: null,
});

/**
 * Blocks while the chain state a check needs has not arrived.
 *
 * Deliberately not silent. A disabled control with no explanation is the failure this
 * module exists to remove, so even "we are still reading" gets a sentence.
 */
const reading = (what: string): Blocker =>
  local('loading', 'Reading the chain', `Maren is still reading ${what}. This takes a moment.`);

/**
 * BTC left unspent so a deposit can still pay for itself.
 *
 * Mezo's base fee is around 1.3M wei/gas, so 1e13 wei covers roughly 7.7 million gas —
 * far more than any call here uses, and 1/100th of the 0.001 BTC minimum deposit, so it
 * cannot push a legitimate deposit under the floor. The alternative, letting someone spend
 * their entire balance as collateral, produces a wallet that cannot afford to withdraw it.
 */
export const GAS_HEADROOM_WEI = 10_000_000_000_000n;

/**
 * MUSD's Recovery Mode, stated as a refusal rather than left to the chain to discover.
 *
 * This is the one blocker in the module that is not about Maren at all. When MUSD's
 * system-wide TCR falls under the 150% CCR, `BorrowerOperations` starts refusing whole
 * classes of operation with bare `require` strings, and Maren's contracts cannot see it
 * coming: `MarenVault` never calls `checkRecoveryMode`, so its own preflight arithmetic
 * says the borrow is fine right up until MUSD refuses it. Read out of the deployed
 * BorrowerOperations runtime bytecode on 2026-08-19:
 *
 *   "BorrowerOps: Collateral withdrawal not permitted Recovery Mode"
 *       every withdrawColl, at any ratio, however overcollateralised the trove is
 *   "BorrowerOps: Cannot decrease your Trove's ICR in Recovery Mode"
 *       every bare withdrawMUSD, because taking on debt without adding collateral
 *       always lowers ICR
 *   "BorrowerOps: Operation not permitted during Recovery Mode"
 *       closeTrove and refinance, both keeper-only
 *
 * Note what is NOT on that list: `addColl` and `repayMUSD` both RAISE the trove's ratio, so
 * deposit and repay stay open. Blocking them too would be the more damaging error, because
 * they are the two actions that get the protocol out of Recovery Mode.
 */
const recoveryModeBlocker = (what: string, stats: ProtocolStats): Blocker =>
  local(
    'pool',
    'MUSD is in Recovery Mode',
    `The whole MUSD protocol is under its 150% system-wide ratio` +
      `${stats.systemTcrWei === null ? '' : `, at ${formatCollateralRatio(stats.systemTcrWei)}`}` +
      `, and while it is, Mezo refuses ${what} from every trove on the chain. This is not ` +
      `about your position or about Maren. Depositing and repaying are still open, and both ` +
      `help lift the protocol back over the line.`,
  );

export interface VaultState {
  price: PriceFeed;
  position: Position | undefined;
  balances: Balances | undefined;
  stats: ProtocolStats | undefined;
}

// ── deposit ──────────────────────────────────────────────────────────────────

/**
 * `MarenVault.deposit()` — the checks, in source order:
 *   `if (depositsPaused) revert DepositsArePaused();`
 *   `if (amount < MIN_DEPOSIT) revert DepositBelowMinimum(amount, MIN_DEPOSIT);`
 *   `if (newTotal > depositCap) revert DepositCapExceeded(newTotal, depositCap);`
 *
 * Plus the one the contract cannot raise because it never gets that far: a wallet that
 * does not hold the BTC. That surfaces as an `insufficient funds` transport error with no
 * revert data at all, which is the least legible failure in the whole product.
 *
 * Needs no price. `deposit` is the one vault entrypoint that works with the oracle down,
 * and gating it on the feed would close the only door that is genuinely open.
 */
export function preflightDeposit(state: VaultState, amountWei: bigint): Preflight {
  const { stats, balances } = state;
  if (!stats) return blocked(reading('the vault’s deposit cap and pause flags'));
  if (!balances) return blocked(reading('your wallet balance'));

  const spendable = balances.btcWei > GAS_HEADROOM_WEI ? balances.btcWei - GAS_HEADROOM_WEI : 0n;
  const capHeadroom =
    stats.depositCapWei > stats.totalCollateralWei
      ? stats.depositCapWei - stats.totalCollateralWei
      : 0n;
  const maxWei = spendable < capHeadroom ? spendable : capHeadroom;

  if (stats.depositsPaused) {
    return blocked(fromContract('pool', 'DepositsArePaused'), { rangeDead: true });
  }

  if (capHeadroom < MAREN_VAULT.minDeposit) {
    // The cap cannot fit even the minimum, so no amount works. Quoted with the numbers the
    // contract would have reverted with rather than as a generic "vault full".
    return blocked(
      fromContract('pool', 'DepositCapExceeded', [
        stats.totalCollateralWei + MAREN_VAULT.minDeposit,
        stats.depositCapWei,
      ]),
      { rangeDead: true },
    );
  }

  if (spendable < MAREN_VAULT.minDeposit) {
    return blocked(
      local(
        'wallet',
        'Not enough Bitcoin in this wallet',
        `The minimum deposit is ${formatBtc(MAREN_VAULT.minDeposit)} and this wallet holds ` +
          `${formatBtc(balances.btcWei)}, of which ${formatBtc(GAS_HEADROOM_WEI)} is kept back ` +
          `for gas. Fund the wallet and it will enable itself.`,
      ),
      { rangeDead: true },
    );
  }

  if (amountWei === 0n) {
    return blocked(local('input', 'Enter an amount', 'Nothing has been entered to deposit yet.'), {
      maxWei,
    });
  }
  if (amountWei < MAREN_VAULT.minDeposit) {
    return blocked(
      fromContract('input', 'DepositBelowMinimum', [amountWei, MAREN_VAULT.minDeposit]),
      { maxWei },
    );
  }
  if (stats.totalCollateralWei + amountWei > stats.depositCapWei) {
    return blocked(
      fromContract('input', 'DepositCapExceeded', [
        stats.totalCollateralWei + amountWei,
        stats.depositCapWei,
      ]),
      { maxWei },
    );
  }
  if (amountWei > spendable) {
    return blocked(
      local(
        'wallet',
        'More than this wallet can send',
        `This wallet holds ${formatBtc(balances.btcWei)}, and ${formatBtc(GAS_HEADROOM_WEI)} of ` +
          `it is kept back to pay the gas for this deposit. The most you can deposit is ` +
          `${formatBtc(spendable)}.`,
      ),
      { maxWei },
    );
  }

  return ok(maxWei);
}

// ── borrow ───────────────────────────────────────────────────────────────────

/**
 * `MarenVault.borrow()` — the checks, in source order:
 *   `if (borrowingPaused) revert BorrowingIsPaused();`
 *   `if (amount == 0) revert ZeroAmount();`
 *   `if (!troveOpen) revert TroveNotOpen();`
 *   `uint256 price = _price();`                      → reverts on a stale oracle
 *   `if (cr < MIN_BORROW_CR) revert InsufficientCollateralRatio(cr, MIN_BORROW_CR);`
 *   `if (troveCr < MIN_TROVE_CR) revert TroveCollateralRatioTooLow(troveCr, MIN_TROVE_CR);`
 *
 * THE LAST ONE IS THE WHOLE REASON THIS FILE EXISTS, and it is the one no amount of
 * user-side arithmetic finds, because it is not about the user. `troveCr` is the SHARED
 * trove's ratio and the check is unconditional — a borrow served entirely out of
 * `reserveMUSD`, which adds no trove debt whatsoever, is refused just the same. Today the
 * trove is at 151.05% against a 180% floor, so the honest maximum borrow for every account
 * in the product is zero, and the slider must say so rather than offering a 35 MUSD range
 * in which every single value reverts.
 *
 * It is checked BEFORE the user's own ratio, out of source order, deliberately: when both
 * fail, "the pool is fully drawn and you cannot fix it" is the more useful sentence than
 * "borrow less", which would send someone to drag a slider that has nowhere good to go.
 */
export function preflightBorrow(state: VaultState, amountWei: bigint): Preflight {
  const { stats, position, price } = state;
  if (!stats) return blocked(reading('the shared trove'));
  if (!position) return blocked(reading('your position'));

  if (stats.borrowingPaused) {
    return blocked(fromContract('pool', 'BorrowingIsPaused'), { rangeDead: true });
  }
  if (!stats.troveOpen) {
    return blocked(fromContract('pool', 'TroveNotOpen'), { rangeDead: true });
  }

  // Checked before the price gate, and before Maren's own floors, because it outranks both:
  // no amount and no collateral ratio gets a borrow through Recovery Mode, so this is a dead
  // range rather than a slider to drag back. A `null` here means the price read that
  // `checkRecoveryMode` needs failed, and the gate immediately below refuses for that same
  // reason, so falling through on null cannot open a door.
  if (stats.recoveryMode === true) {
    return blocked(recoveryModeBlocker('any new borrowing', stats), { rangeDead: true });
  }

  const gate = priceGate(price);
  if (!gate.allowed) {
    return blocked(
      {
        ...fromContract('feed', 'PriceFeedUnavailable'),
        // The contract's copy, prefixed with what we can see that it cannot: how stale.
        detail: `${gate.reason} ${describeRevert('PriceFeedUnavailable').detail}`,
      },
      { rangeDead: true },
    );
  }
  const priceWei = price.state === 'live' ? price.priceWei : 0n;

  // The pool-level floor. Unconditional in the contract, so unconditional here.
  if (stats.troveIcrWei < MAREN_VAULT.minTroveCr) {
    return blocked(
      fromContract('pool', 'TroveCollateralRatioTooLow', [
        stats.troveIcrWei,
        MAREN_VAULT.minTroveCr,
      ]),
      { rangeDead: true },
    );
  }

  if (position.collateralWei === 0n) {
    return blocked(
      local(
        'position',
        'Nothing to borrow against',
        `Borrowing needs collateral. Deposit at least ${formatBtc(MAREN_VAULT.minDeposit)} of ` +
          `Bitcoin first. It stays yours, and you can withdraw it.`,
      ),
      { rangeDead: true },
    );
  }

  const ceiling = borrowCeiling(position, priceWei);
  if (ceiling.amountWei === 0n) {
    return blocked(
      ceiling.mezoHeadroomWei === 0n
        ? local(
            'pool',
            'This trove is at Mezo’s borrowing ceiling',
            `Mezo fixes a per-trove ceiling at the price the trove opened at, and this one is ` +
              `fully drawn. Adding collateral does not raise it; only a refinance does.`,
          )
        : fromContract('position', 'InsufficientCollateralRatio', [
            collateralRatio(position.collateralWei, position.debtWei, priceWei),
            MAREN_VAULT.minBorrowCr,
          ]),
      { rangeDead: true },
    );
  }

  if (amountWei === 0n) {
    return blocked(fromContract('input', 'ZeroAmount'), { maxWei: ceiling.amountWei });
  }
  if (amountWei > ceiling.amountWei) {
    return blocked(
      ceiling.binding === 'ceiling'
        ? local(
            'input',
            'Past Mezo’s per-trove ceiling',
            `The trove can draw ${formatMusd(ceiling.mezoHeadroomWei)} more in total, whatever ` +
              `your own ratio allows. Ask for less.`,
          )
        : local(
            'input',
            'Past Maren’s floor',
            `Borrowing that much would put you under Maren’s ` +
              `${formatCollateralRatio(MAREN_VAULT.minBorrowCr)} floor. The most you can draw ` +
              `right now is ${formatMusd(ceiling.amountWei)}.`,
          ),
      { maxWei: ceiling.amountWei },
    );
  }

  // Belt to the ceiling's braces: recompute the resulting ratio the way the contract will.
  const preview = previewBorrow(position, priceWei, amountWei);
  if (preview.collateralRatio < MAREN_VAULT.minBorrowCr) {
    return blocked(
      fromContract('position', 'InsufficientCollateralRatio', [
        preview.collateralRatio,
        MAREN_VAULT.minBorrowCr,
      ]),
      { maxWei: ceiling.amountWei },
    );
  }

  return ok(ceiling.amountWei);
}

// ── repay ────────────────────────────────────────────────────────────────────

/**
 * `MarenVault.repay()` → `_repay()`:
 *   `if (debt == 0) revert NoDebt();`
 *   `if (repaid == 0) revert ZeroAmount();`
 *   `safeTransferFrom(user, address(this), repaid)`  → needs balance AND allowance
 *
 * Never pausable and never priced: "an exit must always be open". So this function checks
 * nothing about the oracle, on purpose — gating repay on a stale feed would trap exactly
 * the user who most needs out.
 *
 * The allowance is NOT a blocker here. It is a separate transaction with its own button
 * and its own receipt, so it is a step rather than a refusal.
 */
export function preflightRepay(state: VaultState, amountWei: bigint): Preflight {
  const { position, balances } = state;
  if (!position) return blocked(reading('your debt'));
  if (!balances) return blocked(reading('your MUSD balance'));

  const maxWei = position.debtWei < balances.musdWei ? position.debtWei : balances.musdWei;

  if (position.debtWei === 0n) {
    return blocked(fromContract('position', 'NoDebt'), { rangeDead: true });
  }
  if (balances.musdWei === 0n) {
    return blocked(
      local(
        'wallet',
        'No MUSD to repay with',
        `You owe ${formatMusd(position.debtWei)} and this wallet holds no MUSD. Repayment pulls ` +
          `MUSD from your wallet, so it has to be there first.`,
      ),
      { rangeDead: true },
    );
  }
  if (amountWei === 0n) {
    return blocked(fromContract('input', 'ZeroAmount'), { maxWei });
  }
  if (amountWei > balances.musdWei) {
    return blocked(
      local(
        'wallet',
        'More MUSD than you hold',
        `This wallet holds ${formatMusd(balances.musdWei)}. Repay that or less; repaying more ` +
          `than you owe repays exactly what you owe.`,
      ),
      { maxWei },
    );
  }

  return ok(maxWei);
}

// ── withdraw ─────────────────────────────────────────────────────────────────

/**
 * `MarenVault.withdraw()` → `_withdraw()`:
 *   `if (amount == 0) revert ZeroAmount();`
 *   `if (amount > coll) revert InsufficientCollateral(amount, coll);`
 *   `if (debt > 0 && cr < MIN_BORROW_CR) revert InsufficientCollateralRatio(...)`  → priced
 *   `_sendCollateral()` → pulls from the trove when idle BTC is short, which is also priced
 *
 * Never pausable. The price is needed only on two of those paths, and the distinction is
 * worth keeping: a debt-free user whose BTC is sitting idle in the vault can always leave,
 * oracle or no oracle, and telling them otherwise would be a false imprisonment.
 */
export function preflightWithdraw(state: VaultState, amountWei: bigint): Preflight {
  const { position, price, stats } = state;
  if (!position) return blocked(reading('your position'));
  if (!stats) return blocked(reading('the vault’s idle collateral'));

  const gate = priceGate(price);
  const priceWei = price.state === 'live' ? price.priceWei : 0n;
  const hasDebt = position.debtWei > 0n;

  if (position.collateralWei === 0n) {
    return blocked(
      local(
        'position',
        'No collateral to withdraw',
        'This account has no Bitcoin credited to it in the vault.',
      ),
      { rangeDead: true },
    );
  }

  /**
   * Recovery Mode kills `withdrawColl` outright, at any ratio. But it kills only that call,
   * and `_sendCollateral` reaches for BorrowerOperations only when the vault's IDLE balance
   * is short: BTC credited to a user but not yet pushed into the trove leaves the vault
   * directly and never touches MUSD. So the honest cap is the idle balance, not zero, and
   * getting that distinction wrong would tell someone whose Bitcoin is sitting untroved
   * that they cannot have it back.
   *
   * `null` when we are not in Recovery Mode or cannot tell, and null must not clamp.
   */
  const recoveryCapWei = stats.recoveryMode === true ? stats.idleCollateralWei : null;
  if (recoveryCapWei === 0n) {
    return blocked(recoveryModeBlocker('every collateral withdrawal', stats), { rangeDead: true });
  }

  // Priced only where the contract prices it.
  if (!gate.allowed && hasDebt) {
    return blocked(
      local(
        'feed',
        describeRevert('PriceFeedUnavailable').title,
        `${gate.reason} Withdrawing against outstanding debt has to check your collateral ratio, ` +
          `which needs the oracle. Repaying is still open, and repaying in full reopens withdrawal.`,
      ),
      { rangeDead: true },
    );
  }
  if (!gate.allowed && stats.idleCollateralWei < position.collateralWei) {
    // Debt-free, but the BTC has to come out of the trove — which needs a price.
    const idle = stats.idleCollateralWei;
    if (amountWei > idle) {
      return blocked(
        local(
          'feed',
          describeRevert('PriceFeedUnavailable').title,
          `${gate.reason} ${formatBtc(idle)} is sitting idle in the vault and can leave without a ` +
            `price; anything beyond that has to be pulled out of the shared trove, which cannot ` +
            `happen while the oracle is stale.`,
        ),
        { maxWei: idle },
      );
    }
  }

  const availableByRatio = hasDebt ? maxWithdrawable(position, priceWei) : position.collateralWei;
  const available =
    recoveryCapWei !== null && recoveryCapWei < availableByRatio ? recoveryCapWei : availableByRatio;

  if (hasDebt && availableByRatio === 0n) {
    return blocked(
      fromContract('position', 'InsufficientCollateralRatio', [
        collateralRatio(position.collateralWei, position.debtWei, priceWei),
        MAREN_VAULT.minBorrowCr,
      ]),
      { rangeDead: true },
    );
  }
  if (amountWei === 0n) {
    return blocked(fromContract('input', 'ZeroAmount'), { maxWei: available });
  }
  if (amountWei > position.collateralWei) {
    return blocked(
      fromContract('input', 'InsufficientCollateral', [amountWei, position.collateralWei]),
      { maxWei: available },
    );
  }
  if (amountWei > available) {
    // Two different refusals wear the same shape here, and saying the wrong one sends the
    // user to fix something that is not broken. If Recovery Mode is what is binding, their
    // ratio is irrelevant and repaying more will not help; only the idle balance moves.
    const boundByRecovery = recoveryCapWei !== null && recoveryCapWei < availableByRatio;
    return blocked(
      boundByRecovery
        ? local(
            'pool',
            'MUSD is in Recovery Mode',
            `While the MUSD protocol sits under its 150% system-wide ratio, Mezo refuses every ` +
              `withdrawal from a trove. ${formatBtc(recoveryCapWei)} of your Bitcoin has not been ` +
              `pushed into the shared trove yet and can still leave; the rest has to wait for the ` +
              `protocol to recover. Repaying is open and helps get it there.`,
          )
        : local(
            'input',
            'More than your ratio can release',
            `Taking that much out would leave you under Maren’s ` +
              `${formatCollateralRatio(MAREN_POLICY.minHealthyCr)} floor. ` +
              `${formatBtc(available)} can leave and keep you above it.`,
          ),
      { maxWei: available },
    );
  }

  return ok(available);
}

// ── MUSD-denominated actions outside the vault ───────────────────────────────

/**
 * The shared precondition for Pay's Send and Link, and Earn's deposit: MUSD in the wallet.
 *
 * None of these have a Maren custom error to borrow, because the refusal happens inside
 * MUSD's own ERC-20 during `transferFrom` — which reverts with a bare
 * `ERC20InsufficientBalance` the user has no way to connect to anything they did. Today
 * this matters more than usual: the pooled trove is under its floor, so nobody can borrow
 * MUSD, so the honest state of a fresh account is that Send, Link and Earn are all closed
 * and it is not the user's fault.
 */
export function preflightMusdSpend(
  balances: Balances | undefined,
  amountWei: bigint,
  action: { verb: string; noun: string },
): Preflight {
  if (!balances) return blocked(reading('your MUSD balance'));

  if (balances.musdWei === 0n) {
    return blocked(
      local(
        'wallet',
        `No MUSD to ${action.verb}`,
        `This wallet holds no MUSD, so there is nothing to ${action.verb}. MUSD comes from ` +
          `borrowing against Bitcoin in the Vault, or from being paid by someone else.`,
      ),
      { rangeDead: true },
    );
  }
  if (amountWei === 0n) {
    return blocked(
      local('input', 'Enter an amount', `Nothing has been entered to ${action.verb} yet.`),
      { maxWei: balances.musdWei },
    );
  }
  if (amountWei > balances.musdWei) {
    return blocked(
      local(
        'wallet',
        'More MUSD than you hold',
        `This wallet holds ${formatMusd(balances.musdWei)}. ${action.noun} that or less.`,
      ),
      { maxWei: balances.musdWei },
    );
  }

  return ok(balances.musdWei);
}

/** Earn withdrawal: you can only take out shares you hold. */
export function preflightEarnWithdraw(
  earn: EarnPosition | undefined,
  amountWei: bigint,
): Preflight {
  if (!earn) return blocked(reading('your Earn balance'));

  if (earn.assetsWei === 0n) {
    return blocked(
      local(
        'position',
        'Nothing in Earn',
        'This account holds no shares in the Earn vault, so there is nothing to withdraw.',
      ),
      { rangeDead: true },
    );
  }
  if (amountWei === 0n) {
    return blocked(local('input', 'Enter an amount', 'Nothing has been entered to withdraw yet.'), {
      maxWei: earn.assetsWei,
    });
  }
  if (amountWei > earn.assetsWei) {
    return blocked(
      local(
        'position',
        'More than you have in Earn',
        `This account has ${formatMusd(earn.assetsWei)} in Earn.`,
      ),
      { maxWei: earn.assetsWei },
    );
  }

  return ok(earn.assetsWei);
}

/**
 * The relayer, stated once.
 *
 * `MarenRelayHub` is deployed and the contracts trust it, but `apps/relayer` is hosted
 * nowhere, so nothing in this product may depend on it. Rather than disable the actions
 * that WOULD be sponsored — which would close Pay and Earn entirely for a reason that has
 * nothing to do with the user — every one of them falls back to the user's own wallet and
 * says so in `gasNote()`. This function is what a control would call if it ever genuinely
 * required relaying, and it is exported so that "nothing requires the relayer" stays a
 * checkable claim rather than an assumption.
 */
export function preflightRelayed(relayerAvailable: boolean): Preflight {
  if (relayerAvailable) return ok(0n);
  return blocked(
    local(
      'pool',
      'Maren’s relayer is not running',
      'This action can only be submitted by a relayer, and no relayer service is deployed yet. ' +
        'The contracts are ready for it; the service is not.',
    ),
    { rangeDead: true },
  );
}
