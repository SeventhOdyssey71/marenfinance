import { describe, expect, it } from 'vitest';
import {
  encodeAbiParameters,
  keccak256,
  recoverMessageAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { claimLinkInnerHash, gasNote, signClaimLink } from './write';

/**
 * The gas claim, which is the only thing in this app a user is asked to take on trust
 * before they sign.
 *
 * The routing decision itself is tested in `relay.test.ts` against `shouldRelay`. This
 * file covers the other half of the same fact: what the interface SAYS is happening has
 * to match what is about to happen, in all three states, and it has to be wrong in the
 * safe direction while the answer is still unknown.
 */

const NO_RELAYER = { configured: false, live: false };
const CONFIGURED_BUT_COLD = { configured: true, live: false };
const LIVE = { configured: true, live: true };

describe('gasNote', () => {
  it('claims sponsorship only when a relayer is actually taking work', () => {
    const note = gasNote(true, 'Moves MUSD.', LIVE);
    expect(note.sponsored).toBe(true);
    expect(note.note).toContain('Maren pays the gas for this action');
    expect(note.note).toContain('Moves MUSD.');
  });

  it('says the user pays while no relayer is configured, which is how this ships', () => {
    const note = gasNote(true, 'Moves MUSD.', NO_RELAYER);
    expect(note.sponsored).toBe(false);
    expect(note.note).toContain('You pay the Bitcoin gas');
    expect(note.note).toContain('No relayer is running yet');
  });

  it('defaults to the user paying when nobody passed a status at all', () => {
    // A call site that forgets the third argument must not accidentally promise
    // sponsorship. The unknown state and the no-relayer state read identically.
    const note = gasNote(true, 'Moves MUSD.');
    expect(note.sponsored).toBe(false);
    expect(note.note).toContain('You pay the Bitcoin gas');
  });

  it('distinguishes a relayer that does not exist from one that is refusing work', () => {
    const cold = gasNote(true, 'Moves MUSD.', CONFIGURED_BUT_COLD);
    expect(cold.sponsored).toBe(false);
    expect(cold.note).toContain('is not taking work right now');
    // Telling an operator whose relayer is merely out of budget that none is deployed
    // would send them looking for the wrong problem.
    expect(cold.note).not.toContain('No relayer is running yet');
  });

  it('never claims sponsorship for an action that cannot be sponsored', () => {
    // A deposit is payable: MarenRelayHub reverts ValueNotRelayable, so no relayer state
    // can make this true.
    for (const relayer of [NO_RELAYER, CONFIGURED_BUT_COLD, LIVE]) {
      const note = gasNote(false, 'A deposit costs Bitcoin gas and always will.', relayer);
      expect(note.sponsored).toBe(false);
      expect(note.note).toBe('A deposit costs Bitcoin gas and always will.');
    }
  });

  it('never uses the words this brand has banned for describing a fee', () => {
    for (const relayer of [NO_RELAYER, CONFIGURED_BUT_COLD, LIVE]) {
      const note = gasNote(true, 'Moves MUSD.', relayer);
      // A sponsored fee is paid by Maren, not abolished. "Free" and "zero gas" describe
      // a chain that does not charge, which Mezo does.
      expect(note.note).not.toMatch(/zero gas|no gas|free/i);
    }
  });
});

/**
 * The claim-link signature, which is the consensus-critical seam of the receiving half.
 *
 * The contract does exactly one thing with it:
 *   ECDSA.recover(toEthSignedMessageHash(keccak256(abi.encode(
 *     "MarenPay.claimLink", chainId, marenPay, linkId, recipient))), signature) == linkKey
 * So these tests assert the two facts that check depends on: the signature recovers to the
 * LINK KEY when checked against the recipient it names, and it does NOT when checked against
 * any other recipient. That second fact is the whole point of the scheme — a copied
 * signature cannot be replayed to redirect the funds.
 *
 * The abi.encode below is the same string literal, order and types the contract and the
 * golden-tested iOS `MarenEncoding.claimLinkInner` use, so a drift in any of them fails here.
 */
describe('claimLinkInnerHash / signClaimLink', () => {
  const LINK_SECRET = ('0x' + '11'.repeat(32)) as Hex;
  const CHAIN_ID = 31612;
  const MAREN_PAY = '0x0000000000000000000000000000000000000001' as Address;
  const RECIPIENT = '0x1111111111111111111111111111111111111111' as Address;
  const OTHER = '0x2222222222222222222222222222222222222222' as Address;

  it('reproduces the contract abi.encode → keccak256 for the inner hash', () => {
    const inner = claimLinkInnerHash({
      chainId: CHAIN_ID,
      marenPay: MAREN_PAY,
      linkId: 7n,
      recipient: RECIPIENT,
    });
    const expected = keccak256(
      encodeAbiParameters(
        [
          { type: 'string' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'address' },
        ],
        ['MarenPay.claimLink', BigInt(CHAIN_ID), MAREN_PAY, 7n, RECIPIENT],
      ),
    );
    expect(inner).toBe(expected);
    expect(inner).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('recovers to the link key for the recipient it names', async () => {
    const linkKey = privateKeyToAccount(LINK_SECRET).address;
    const inner = claimLinkInnerHash({
      chainId: CHAIN_ID,
      marenPay: MAREN_PAY,
      linkId: 7n,
      recipient: RECIPIENT,
    });
    const signature = await signClaimLink({
      secret: LINK_SECRET,
      chainId: CHAIN_ID,
      marenPay: MAREN_PAY,
      linkId: 7n,
      recipient: RECIPIENT,
    });
    // Exactly what the contract does: recover the EIP-191 personal-message signature and
    // compare to the link key. `recoverMessageAddress` applies the same prefix `signMessage` did.
    const recovered = await recoverMessageAddress({ message: { raw: inner }, signature });
    expect(recovered.toLowerCase()).toBe(linkKey.toLowerCase());
  });

  it('binds the payout to one recipient: the signature is useless for another', async () => {
    const signature = await signClaimLink({
      secret: LINK_SECRET,
      chainId: CHAIN_ID,
      marenPay: MAREN_PAY,
      linkId: 7n,
      recipient: RECIPIENT,
    });
    const linkKey = privateKeyToAccount(LINK_SECRET).address;
    // A front-runner copies the signature and tries to claim to their OWN address. The
    // contract would recover against `linkClaimDigest(linkId, attacker)`, which is a
    // different inner hash, so the recovered signer is NOT the link key and it reverts.
    const attackerInner = claimLinkInnerHash({
      chainId: CHAIN_ID,
      marenPay: MAREN_PAY,
      linkId: 7n,
      recipient: OTHER,
    });
    const recovered = await recoverMessageAddress({
      message: { raw: attackerInner },
      signature,
    });
    expect(recovered.toLowerCase()).not.toBe(linkKey.toLowerCase());
  });
});
