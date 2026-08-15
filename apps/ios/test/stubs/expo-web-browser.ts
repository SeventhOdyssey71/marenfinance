/**
 * Test stub. The real module wraps ASWebAuthenticationSession.
 *
 * The tests never open a browser session; they exercise `assertVerifiableRedirect` and
 * `parseCallback` directly, which is where the R12 guarantees actually live.
 */
export type WebBrowserAuthSessionResult =
  { type: 'success'; url: string } | { type: 'cancel' } | { type: 'dismiss' };

export async function openAuthSessionAsync(): Promise<WebBrowserAuthSessionResult> {
  throw new Error('openAuthSessionAsync is not available in tests.');
}
