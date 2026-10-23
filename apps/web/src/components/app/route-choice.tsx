'use client';

import {
  MAREN_VAULT,
  MIN_NET_DEBT,
  chooseVaultRoute,
  formatBtc,
  formatMusd,
  type RouteChoice as Choice,
} from '@maren/sdk';

import { Num } from '@/components/app/money';
import { Info } from '@/components/app/primitives';
import { Check } from '@/components/ui/icons';

/**
 * THE CHOICE, MADE EXPLICIT.
 *
 * There are two ways to hold MUSD debt against Bitcoin on Mezo, and until this pass the
 * app picked one for you and mentioned it afterwards, in a row reading "Route after:
 * Pooled". A user could deposit, borrow, and repay without ever learning that a decision
 * had been made on their behalf, or what the other option would have cost them.
 *
 * Both are now on screen, before the amount field, with the live threshold that separates
 * them and the recommendation stated as a sentence rather than implied by a tag.
 *
 * ONE THING THIS COMPONENT MUST NOT IMPLY. `MarenVault.deposit()` always pools. There is
 * no branch in the contract that opens a trove of your own, and the old "Route after:
 * Direct trove" row read as though there were. What clearing the threshold actually buys
 * you is the OPTION of a trove of your own, opened on MUSD itself, and this panel says so
 * in the same breath as the recommendation. Quoting a route the button does not take
 * would be the same class of error as quoting a borrow the contract will refuse.
 */
export function RouteChoice({
  collateralWei,
  priceWei,
}: {
  /** The collateral the decision is judged on: what this account holds after this deposit. */
  collateralWei: bigint;
  /** A LIVE price only. Null renders the reason rather than a threshold computed from zero. */
  priceWei: bigint | null;
}) {
  const choice = priceWei === null ? null : chooseVaultRoute(collateralWei, priceWei);

  if (!choice) {
    return (
      <div className="bg-surface-inset p-4">
        <p className="text-text-muted text-sm leading-relaxed">
          Which route this deposit takes depends on the BTC price, and the oracle has not given a
          usable one. Depositing still works.
        </p>
      </div>
    );
  }

  const social = choice.recommended === 'social-vault';

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RouteOption
          name="Your own trove"
          amount={formatBtc(choice.ownTroveFromWei)}
          amountLabel="from"
          chosen={!social}
          sentence="Opened on MUSD itself, so nothing is shared and there is no pooling risk."
        />
        <RouteOption
          name="The social vault"
          amount={formatBtc(choice.socialVaultFromWei)}
          amountLabel="from"
          chosen={social}
          sentence="One position, shared with everyone else in it, which is what makes a small loan possible at all."
        />
      </div>

      <p className="text-text mt-4 max-w-[68ch] text-pretty text-sm leading-relaxed" role="status">
        {recommendation(choice)}
      </p>

      <Info summary="Why the threshold is where it is">
        MUSD will not open a trove below {formatMusd(MIN_NET_DEBT)} of net debt, so a trove of your
        own needs {formatBtc(choice.ownTroveFromWei)} at the{' '}
        {/* The threshold moves with the price, which is why it is read rather than written down. */}
        250% ratio Maren recommends. Below that the social vault is the only way in, and it starts
        at {formatBtc(MAREN_VAULT.minDeposit)}. Depositing here always goes into the social vault:
        Maren does not open a trove for you.
      </Info>
    </div>
  );
}

/** The recommendation, as a sentence with this account's own numbers in it. */
function recommendation(choice: Choice): string {
  if (choice.belowBothMinimums) {
    return `${formatBtc(choice.collateralWei)} is under the ${formatBtc(
      choice.socialVaultFromWei,
    )} minimum, so neither route is open yet.`;
  }
  if (choice.recommended === 'own-trove') {
    return `${formatBtc(choice.collateralWei)} is past the ${formatBtc(
      choice.ownTroveFromWei,
    )} a trove of your own needs, and a trove of your own shares nothing. This deposit still goes into the social vault.`;
  }
  return `${formatBtc(choice.collateralWei)} is ${formatBtc(
    choice.shortfallWei,
  )} short of a trove of your own, so this deposit goes into the social vault.`;
}

/**
 * One route, as a card.
 *
 * Two square boxes. The recommended one is drawn in ink with a check and the word; the
 * other in a hairline. The word carries the meaning and the line carries the emphasis,
 * so it reads without relying on colour, and the violet stays on the one button that
 * acts.
 */
function RouteOption({
  name,
  amount,
  amountLabel,
  sentence,
  chosen,
}: {
  name: string;
  amount: string;
  amountLabel: string;
  sentence: string;
  chosen: boolean;
}) {
  return (
    <div
      className={`bg-surface border p-4 ${
        chosen ? 'border-text' : 'border-[var(--border-hairline)]'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-text text-sm font-medium">{name}</span>
        {/* Only the recommended card is tagged. The other one was tagged "not this
            deposit", which is true of a route you cannot reach and false the moment you
            can: a user past the threshold is recommended a trove of their own AND is
            still depositing into the social vault. The sentence below carries that. */}
        {chosen ? (
          <span className="text-text inline-flex items-center gap-1 text-[0.8125rem]">
            <Check className="size-3.5 shrink-0" />
            Recommended
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5 [&_.num]:text-lg">
        <span className="text-text-muted text-xs">{amountLabel}</span>
        <Num>{amount}</Num>
      </div>
      <p className="text-text-muted mt-1.5 text-pretty text-xs leading-relaxed">{sentence}</p>
    </div>
  );
}
