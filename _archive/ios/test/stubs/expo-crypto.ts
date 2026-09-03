/** Test stub. The real module is a native Expo binding. */
import { randomBytes } from 'node:crypto';

export function getRandomBytes(count: number): Uint8Array {
  return new Uint8Array(randomBytes(count));
}
