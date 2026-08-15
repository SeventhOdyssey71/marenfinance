import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { Address, Hex } from 'viem';

/**
 * The signing key: stored in the iOS Keychain via expo-secure-store with
 * `requireAuthentication: true`, so the item is created with a `SecAccessControl` that
 * forces a Face ID / Touch ID presence check before the bytes can be read.
 *
 * Two rules this module exists to enforce:
 *
 *   1. The private key is never held in module scope, never in Zustand, never in React
 *      state. It is read from the Keychain for the duration of one signature and
 *      dropped. Every read costs a biometric prompt, which is the point.
 *
 *   2. If the device cannot offer biometric protection, we do NOT quietly downgrade to
 *      an unprotected Keychain item. SECURITY-LESSONS.md R13 is about not claiming a
 *      control you did not implement; storing a key unprotected while the UI says
 *      "protected by Face ID" would be exactly that. Instead the key stays in memory
 *      for the session only and the UI says so in as many words.
 */

const KEY_ALIAS = 'finance.maren.app.signingKey.v1';

/** Shown to the user by iOS in the Face ID sheet. */
const AUTH_PROMPT = 'Unlock your Maren signing key';

export type BiometricCapability =
  | { available: true; kind: 'faceId' | 'touchId' | 'other'; enrolled: true }
  /** Hardware exists but the user has not enrolled — recoverable in iOS Settings. */
  | { available: true; kind: 'faceId' | 'touchId' | 'other'; enrolled: false }
  | { available: false; reason: string };

export async function getBiometricCapability(): Promise<BiometricCapability> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) {
    return { available: false, reason: 'This device has no biometric sensor.' };
  }

  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  const kind = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    ? 'faceId'
    : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
      ? 'touchId'
      : 'other';

  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return { available: true, kind, enrolled };
}

export function biometricName(cap: BiometricCapability): string {
  if (!cap.available) return 'Biometrics';
  return cap.kind === 'faceId' ? 'Face ID' : cap.kind === 'touchId' ? 'Touch ID' : 'Biometrics';
}

/**
 * How the key for this session is actually held. The UI reads this and must never
 * describe a `session-only` key as protected.
 */
export type KeyProtection =
  | { mode: 'keychain-biometric'; label: string }
  | { mode: 'session-only'; reason: string };

/** In-memory fallback. Cleared on reload; never written to disk. */
let sessionKey: Hex | null = null;

export interface StoredWallet {
  address: Address;
  protection: KeyProtection;
}

export function deriveAddress(privateKey: Hex): Address {
  return privateKeyToAccount(privateKey).address;
}

export function createPrivateKey(): Hex {
  // viem's generatePrivateKey uses @noble/curves, which reads crypto.getRandomValues.
  // react-native-get-random-values is imported once in app/_layout.tsx to provide it.
  return generatePrivateKey();
}

/** Accepts a key with or without the 0x prefix; validates length and hex alphabet. */
export function normalisePrivateKey(input: string): Hex | null {
  const trimmed = input.trim();
  const body = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(body)) return null;
  return `0x${body.toLowerCase()}` as Hex;
}

/**
 * Persist a key. Returns how it ended up being held so the caller can tell the truth
 * about it — this function never silently degrades.
 */
export async function storeKey(privateKey: Hex): Promise<KeyProtection> {
  const cap = await getBiometricCapability();

  if (cap.available && cap.enrolled) {
    try {
      await SecureStore.setItemAsync(KEY_ALIAS, privateKey, {
        // The two flags that matter. `requireAuthentication` creates the item with a
        // biometry-backed SecAccessControl; `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps it
        // out of iCloud Keychain and off any restored backup.
        requireAuthentication: true,
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        authenticationPrompt: AUTH_PROMPT,
      });
      sessionKey = null;
      return { mode: 'keychain-biometric', label: biometricName(cap) };
    } catch (error) {
      // Falling through to session-only is a downgrade, so it is reported, not hidden —
      // but it is reported in words a person can act on, not as a raw native stack.
      sessionKey = privateKey;
      return { mode: 'session-only', reason: explainKeychainFailure(error) };
    }
  }

  sessionKey = privateKey;
  return {
    mode: 'session-only',
    reason: cap.available
      ? 'No Face ID or Touch ID is enrolled on this device.'
      : cap.reason,
  };
}

/**
 * Turn a native Keychain error into something a user can act on.
 *
 * The raw errors are Swift exception strings such as "FunctionCallException: Calling the
 * 'setValueWithKeyAsync' function has failed … MissingPlistKeyException: You must set
 * `NSFaceIDUsageDescription`". Surfacing that verbatim in a banking app is noise: it
 * tells the person nothing about what to do and everything about our stack. We keep the
 * meaning, drop the trace, and say what it means for their key.
 */
export function explainKeychainFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/NSFaceIDUsageDescription|MissingPlistKey/i.test(raw)) {
    // The usual cause is running inside Expo Go, whose Info.plist is not ours. A
    // development or release build of Maren carries the key (see app.json).
    return 'This build cannot open a biometry-protected Keychain item. Maren’s own builds declare the Face ID usage key; Expo Go does not, so the key cannot be persisted here.';
  }
  if (/UserCancel|authentication.*cancel|-128/i.test(raw)) {
    return 'The biometric prompt was cancelled, so the key was not written.';
  }
  if (/biometry.*(not enrolled|lockout)|-7/i.test(raw)) {
    return 'Biometry is unavailable or locked out on this device.';
  }
  return 'The Keychain refused to store the key on this device.';
}

export type KeyAccess =
  | { kind: 'ok'; privateKey: Hex }
  | { kind: 'denied'; reason: string }
  | { kind: 'missing' };

/**
 * Read the key, forcing a biometric prompt.
 *
 * Called once per signing action — never cached. The Face ID gate on *every* signing
 * action is a hard requirement, and the cheapest way to guarantee it is to make the
 * key physically unavailable without one.
 */
export async function accessKey(): Promise<KeyAccess> {
  if (sessionKey) {
    // Session-only keys still get an explicit presence check when one is possible, so
    // the "biometrics on every signature" promise holds wherever the hardware allows.
    const cap = await getBiometricCapability();
    if (cap.available && cap.enrolled) {
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: AUTH_PROMPT,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (!auth.success) return { kind: 'denied', reason: 'Authentication was not completed.' };
    }
    return { kind: 'ok', privateKey: sessionKey };
  }

  try {
    const stored = await SecureStore.getItemAsync(KEY_ALIAS, {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: AUTH_PROMPT,
    });
    if (!stored) return { kind: 'missing' };
    return { kind: 'ok', privateKey: stored as Hex };
  } catch (error) {
    // A cancelled Face ID prompt lands here. It is a denial, not an error state.
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: 'denied', reason };
  }
}

/** Whether a Keychain item exists, without prompting for biometrics. */
export async function hasStoredKey(): Promise<boolean> {
  if (sessionKey) return true;
  try {
    // A zero-length read still tells us whether the item exists on most iOS versions;
    // where it does not, the wallet address cached in AsyncStorage is the source of
    // truth for "is there an account", and this only gates the sign-out affordance.
    const stored = await SecureStore.getItemAsync(KEY_ALIAS, { requireAuthentication: false });
    return stored !== null;
  } catch {
    return true;
  }
}

export async function clearKey(): Promise<void> {
  sessionKey = null;
  try {
    await SecureStore.deleteItemAsync(KEY_ALIAS, { requireAuthentication: false });
  } catch {
    // Deleting an item that is not there is not an error worth surfacing.
  }
}

/**
 * Gate an action behind a biometric presence check without reading the key.
 * Used for reveal-recovery-phrase and sign-out, where no signature is produced.
 */
export async function requirePresence(reason: string): Promise<boolean> {
  const cap = await getBiometricCapability();
  if (!cap.available || !cap.enrolled) return true;
  const auth = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
  });
  return auth.success;
}
