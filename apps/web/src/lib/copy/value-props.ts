import { RELAYER_CONFIGURED } from '@/lib/chain/relay';

/** Shared web onboarding copy. Keep sponsorship specific to the action and the
 * configured client; a configured relayer is not a promise of live availability. */

export interface ValueProp {
  key: 'spend' | 'gasless' | 'honest' | 'keys';
  headline: string;
  subhead: string;
}

/** Reused by onboarding and the landing page; native-value deposits are never relayed. */
export const GASLESS_CAVEAT =
  'BTC deposits, link creation and approvals may require your own BTC for gas.';

export const VALUE_PROPS: readonly ValueProp[] = [
  {
    key: 'spend',
    headline: 'Spend Bitcoin, never sell it',
    subhead:
      'Borrow MUSD against your BTC without selling it. Collateral remains subject to liquidation risk.',
  },
  {
    key: 'gasless',
    headline: 'Gasless by design',
    subhead: RELAYER_CONFIGURED
      ? `Maren sponsors eligible transactions while the relayer is available. ${GASLESS_CAVEAT}`
      : 'Sponsorship is not configured for this web client. You pay BTC gas; each transaction shows who pays before you sign.',
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
