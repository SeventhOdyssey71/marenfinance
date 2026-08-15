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
 * There is exactly one unsponsored action, and it is structural rather than a policy we
 * could choose differently. `MarenVault.deposit()` is `payable`, and the relayer refuses
 * any request carrying value, unconditionally. An ERC-2771 forwarder cannot carry the
 * caller's BTC — `msg.value` would come from the relayer's own key, which is precisely
 * the funding confusion R1 exists to prevent ("the shielded relayer could be induced to
 * fund an attacker's deposit, draining the relayer").
 *
 * So: the first deposit is an ordinary transaction the user signs and pays BTC gas for.
 * Everything after it — borrow, repay, withdraw, close, and all of Pay and Earn — is
 * relayed and costs the user nothing.
 *
 * Every "gasless" claim in the interface is derived from this function rather than typed
 * into a screen, so a screen cannot drift into promising something the relayer will
 * refuse. R13's discipline generalises from attestations to fee claims: a promise that
 * exists in the interface and not in the contracts is worse than no promise, because it
 * stops people looking.
 */

export type ActionType =
  'deposit' | 'withdraw' | 'borrow' | 'repay' | 'send' | 'earn-deposit' | 'earn-withdraw';

export function isSponsoredKind(type: ActionType): boolean {
  switch (type) {
    case 'deposit':
      // Payable. Cannot be relayed. See above.
      return false;
    case 'withdraw':
    case 'borrow':
    case 'repay':
    case 'send':
    case 'earn-deposit':
    case 'earn-withdraw':
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
