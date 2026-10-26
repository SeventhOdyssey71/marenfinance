/**
 * Off-site destinations that appear in more than one place.
 *
 * These live here rather than inline so a moved link is one edit, not a grep. A
 * TestFlight invite URL in particular is not permanent: it changes if the public
 * link is regenerated, and a stale one sends people to an "expired" page that
 * looks like the app is gone.
 */

/** Public TestFlight invite for the iOS beta. */
export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/uhmv9YPE';

/** Canonical copy for every public route into the iOS beta. */
export const IOS_APP_CTA = 'Get iOS app';
