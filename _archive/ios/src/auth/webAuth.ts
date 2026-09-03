import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

/**
 * R12 — "Loopback + CSRF, not custom URL schemes."
 *
 * SECURITY-LESSONS.md R12: Talise (M1) delivered its mobile bearer token over an
 * unverified `talise://` custom scheme. Any other app on the device could register the
 * same scheme and receive the token. Its CLI got this right — a loopback listener with
 * a random CSRF token compared using `timingSafeEqual`, plus a base-URL allowlist.
 *
 * Maren's iOS app takes the first option R12 offers: `ASWebAuthenticationSession` with
 * a **verified universal link**. On iOS, `WebBrowser.openAuthSessionAsync` is
 * ASWebAuthenticationSession, and passing an `https://` redirect makes iOS deliver the
 * callback only to the app whose `associatedDomains` entitlement Apple validated against
 * that domain's `apple-app-site-association` file. A hostile app cannot claim it.
 *
 * Three defences, all enforced below rather than documented:
 *
 *   1. `assertVerifiableRedirect` rejects any redirect URI that is not https on the
 *      configured origin. Passing `maren://callback` throws. This is why the app's
 *      custom scheme (needed by Expo's dev client) can never be used for auth.
 *   2. A 256-bit `state` is generated per attempt and compared in constant time.
 *   3. The returned URL's origin is re-checked against the allowlist before any
 *      parameter on it is read.
 */

/** The only origin an auth callback may arrive on. */
export const AUTH_ORIGIN = 'https://maren.finance';

/** The universal-link path Apple's AASA file must map to this app. */
export const AUTH_CALLBACK_PATH = '/auth/callback';

export const AUTH_REDIRECT_URI = `${AUTH_ORIGIN}${AUTH_CALLBACK_PATH}`;

export class InsecureRedirectError extends Error {
  override readonly name = 'InsecureRedirectError';
}

/**
 * Fail closed on anything that is not a verified universal link.
 *
 * Exported and unit-tested: this is the assertion that encodes R12, so it is checked
 * by a test rather than by a reviewer remembering to look.
 */
export function assertVerifiableRedirect(redirectUri: string): void {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new InsecureRedirectError(`Redirect URI is not a URL: ${redirectUri}`);
  }

  if (url.protocol !== 'https:') {
    throw new InsecureRedirectError(
      `R12: auth redirect must be a verified universal link over https, got "${url.protocol}". ` +
        'A custom URL scheme is claimable by any other app on the device.',
    );
  }

  if (url.origin !== AUTH_ORIGIN) {
    throw new InsecureRedirectError(
      `R12: auth redirect origin "${url.origin}" is not the allowlisted ${AUTH_ORIGIN}.`,
    );
  }
}

/**
 * Constant-time string comparison — the `timingSafeEqual` R12 credits Talise's CLI for.
 *
 * Node's crypto.timingSafeEqual does not exist in Hermes, so this is the standard
 * accumulate-XOR-over-all-bytes construction. It always walks the full length of the
 * longer input, so it leaks neither the position of the first difference nor, beyond
 * the length itself, anything about the contents.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** 256 bits of CSRF state, hex encoded. */
export function generateState(): string {
  const bytes = Crypto.getRandomBytes(32);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type AuthResult =
  | { kind: 'success'; code: string }
  | { kind: 'cancelled' }
  /** The callback came back with a state that did not match. Treated as an attack. */
  | { kind: 'csrf-mismatch' }
  | { kind: 'error'; reason: string };

export interface StartAuthOptions {
  /** The authorize endpoint. Must be https on the Maren origin. */
  authorizeUrl: string;
  redirectUri?: string;
}

/**
 * Open ASWebAuthenticationSession and validate what comes back.
 *
 * Note what this function does NOT do: it never falls back to a custom scheme when the
 * universal link fails to resolve. If the AASA file is not published, auth simply does
 * not work, and that is the correct outcome (R8: gates fail closed).
 */
export async function startWebAuth({
  authorizeUrl,
  redirectUri = AUTH_REDIRECT_URI,
}: StartAuthOptions): Promise<AuthResult> {
  assertVerifiableRedirect(redirectUri);
  assertVerifiableRedirect(authorizeUrl);

  const state = generateState();
  const url = new URL(authorizeUrl);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    // On iOS this is ASWebAuthenticationSession. `preferEphemeralSession` keeps the
    // Safari cookie jar out of it so a shared device does not leak a prior session.
    result = await WebBrowser.openAuthSessionAsync(url.toString(), redirectUri, {
      preferEphemeralSession: true,
    });
  } catch (error) {
    return { kind: 'error', reason: error instanceof Error ? error.message : String(error) };
  }

  if (result.type === 'cancel' || result.type === 'dismiss') return { kind: 'cancelled' };
  if (result.type !== 'success') return { kind: 'error', reason: `Session ended: ${result.type}` };

  return parseCallback(result.url, state);
}

/**
 * Validate a callback URL. Separated from the browser call so it is directly testable.
 *
 * Order matters: the origin is checked before any parameter is read, and the state is
 * checked before the code is returned. Reading `code` from an unverified origin would
 * defeat the point of the universal link.
 */
export function parseCallback(callbackUrl: string, expectedState: string): AuthResult {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return { kind: 'error', reason: 'Callback was not a URL.' };
  }

  // Re-check the origin on the way back in, not just on the way out.
  if (url.origin !== AUTH_ORIGIN || url.protocol !== 'https:') {
    return { kind: 'error', reason: `Callback arrived on untrusted origin ${url.origin}.` };
  }

  const returnedState = url.searchParams.get('state') ?? '';
  if (!timingSafeEqualString(returnedState, expectedState)) {
    return { kind: 'csrf-mismatch' };
  }

  const error = url.searchParams.get('error');
  if (error) return { kind: 'error', reason: error };

  const code = url.searchParams.get('code');
  if (!code) return { kind: 'error', reason: 'Callback carried no authorization code.' };

  return { kind: 'success', code };
}
