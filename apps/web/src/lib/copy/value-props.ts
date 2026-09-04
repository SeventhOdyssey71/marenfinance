/**
 * The four things Maren honestly does, in one place.
 *
 * These sentences appear on the first-run intro and are the SAME four value props the iOS
 * app shows in `IntroOnboardingView`. Single-sourcing them here is the point: when a claim
 * is edited it must be edited once, and the two apps cannot quietly drift into promising
 * different things. A cross-language package that Swift could also import is out of scope,
 * so the rule is kept by hand — if you change a sentence here, change it in the iOS
 * `IntroPage.all` too.
 *
 * The wording for the first three matches iOS verbatim. The fourth deliberately does NOT:
 * iOS says the key lives in that device's Secure Enclave, which is true on a phone and
 * false in a browser. The web truth is the honest, platform-correct version of the same
 * promise — your own wallet, non-custodial, never on Maren's servers.
 */

export interface ValueProp {
  /** Stable key for React lists and per-page icon mapping. */
  key: 'spend' | 'gasless' | 'honest' | 'keys';
  headline: string;
  subhead: string;
}

/**
 * The gasless caveat, as ONE sentence, reused everywhere the first-deposit exception is
 * stated so the site cannot phrase it three different ways. It is exactly the second
 * sentence of the iOS "Gasless by design" prop, so composing the prop from it keeps that
 * prop identical to iOS while still single-sourcing the caveat for the marketing page.
 * The fuller "why" (sending Bitcoin cannot be done on your behalf) lives in the FAQ, which
 * is the place for the mechanism.
 */
export const GASLESS_CAVEAT = 'Only your very first deposit pays its own gas.';

export const VALUE_PROPS: readonly ValueProp[] = [
  {
    key: 'spend',
    headline: 'Spend Bitcoin, never sell it',
    subhead: 'Borrow MUSD against your BTC and keep every satoshi. Your Bitcoin stays yours.',
  },
  {
    key: 'gasless',
    headline: 'Gasless by design',
    subhead: `Maren covers the network fee on your transactions. ${GASLESS_CAVEAT}`,
  },
  {
    key: 'honest',
    headline: 'Honest by default',
    subhead:
      'Every figure is read live from the chain, and a receipt says done only when the blockchain does.',
  },
  {
    key: 'keys',
    headline: 'You hold the keys',
    subhead: 'Maren is non-custodial. Your keys stay in your own wallet, never on our servers.',
  },
] as const;
