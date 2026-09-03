/**
 * A one-slot, in-memory handoff for a scanned claim link.
 *
 * The scanner and the claim screen are two routes, and the bearer secret must not travel
 * between them as a navigation parameter: expo-router serialises params into URL-shaped
 * navigation state, and a secret has no business in anything URL-shaped. So the scanner drops
 * the raw link here and navigates; the claim screen takes it once and clears it.
 *
 * Memory only — never disk, never a log. Losing it to a reload just means re-scanning the code.
 */

let pending: string | null = null;

export function stashClaimLink(raw: string): void {
  pending = raw;
}

/** Read and clear the pending link. Returns null when there is nothing waiting. */
export function takeClaimLink(): string | null {
  const value = pending;
  pending = null;
  return value;
}
