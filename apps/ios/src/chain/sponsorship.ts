/**
 * Who pays the gas. This is policy, not transport, and it has no dependencies.
 *
 * It lives apart from `actions.ts` deliberately. `actions.ts` reaches the Keychain and
 * the mock ledger, so importing it into a test drags the whole native surface in — and a
 * rule this load-bearing should be testable without a device. Everything here is a pure
 * function over a string union.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * Two kinds of action are unsponsored, for two different reasons.
 *
 * 1. STRUCTURAL. `MarenVault.deposit()` is `payable`, and the relayer refuses any request
 *    carrying value, unconditionally. An ERC-2771 forwarder cannot carry the caller's BTC —
 *    `msg.value` would come from the relayer's own key, which is precisely the funding
 *    confusion R1 exists to prevent ("the shielded relayer could be induced to fund an
 *    attacker's deposit, draining the relayer"). So the first deposit is an ordinary
 *    transaction the user signs and pays BTC gas for.
 *
 * 2. NOT ALLOWLISTED. `MarenEarn` is absent from the relay hub's allowlist — `Deploy.s.sol`
 *    passes only MarenRegistry, MarenPay and MarenVault to `_allowlistRelayableCalls`, per
 *    selector. An Earn deposit or withdrawal therefore cannot be relayed and settles from
 *    the user's own wallet; relaying it would earn a `CallNotAllowed` revert the relayer
 *    pays to discover. Making Earn gasless is a redeploy (add MarenEarn to that allowlist),
 *    not a copy change, so this stays honest until that ships.
 *
 *    THE SAME IS TRUE OF TWO PAY CALLS. `_allowlistRelayableCalls` lists MarenPay's payCalls
 *    exactly, and `createLink` and `reclaimLink` are NOT among them (the list stops at
 *    `claimLink`). So a claimable link is created and reclaimed from the user's own wallet
 *    and they pay the BTC gas, even though every other Pay call is relayed. This is not an
 *    oversight to paper over in the copy — it is what the deployed allowlist says.
 *
 * Everything else — borrow, repay, withdraw, and the rest of Pay (pay, split, createRequest,
 * fulfillRequest, claimLink) — is relayed and costs the user nothing.
 *
 * Every "gasless" claim in the interface is derived from this function rather than typed
 * into a screen, so a screen cannot drift into promising something the relayer will
 * refuse. R13's discipline generalises from attestations to fee claims: a promise that
 * exists in the interface and not in the contracts is worse than no promise, because it
 * stops people looking.
 */

export type ActionType =
  | 'deposit'
  | 'withdraw'
  | 'borrow'
  | 'repay'
  | 'send'
  | 'earn-deposit'
  | 'earn-withdraw'
  | 'split'
  | 'request'
  | 'link-create'
  | 'link-reclaim';

export function isSponsoredKind(type: ActionType): boolean {
  switch (type) {
    case 'deposit':
      // Payable. Cannot be relayed. See rule 1 above.
      return false;
    case 'earn-deposit':
    case 'earn-withdraw':
      // MarenEarn is not on the relay hub's allowlist, so Earn settles from the user's
      // own wallet and they pay the BTC gas. See rule 2 above.
      return false;
    case 'link-create':
    case 'link-reclaim':
      // createLink / reclaimLink are absent from the allowlist, so they self-submit and the
      // user pays the BTC gas. See rule 2 above.
      return false;
    case 'withdraw':
    case 'borrow':
    case 'repay':
    case 'send':
    case 'split':
    case 'request':
      return true;
  }
}

/**
 * A user above the ~0.079 BTC threshold is steered to a *direct* Mezo trove, whose
 * borrow/repay/withdraw go through Mezo's own BorrowerOperationsSignatures and are not
 * Maren-sponsored. That is a different rail with different economics; the Vault screen
 * states it separately rather than folding it into the rule above.
 */
export const DIRECT_TROVE_IS_SPONSORED = false;
