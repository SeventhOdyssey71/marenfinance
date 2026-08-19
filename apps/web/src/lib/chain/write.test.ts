import { describe, expect, it } from 'vitest';

import { gasNote } from './write';

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
