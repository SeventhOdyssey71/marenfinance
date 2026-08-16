'use client';

import { getMarenAddresses, type MezoNetwork } from '@maren/sdk';
import type { Address, Hex, PublicClient } from 'viem';

import { marenRegistryAbi } from './abis';

/**
 * Handle registration: the secret, and where it lives.
 *
 * MarenRegistry is commit-reveal. `register("sele")` alone in a public mempool is a free
 * option for anyone watching — copy the calldata, pay more gas, take the name — so step
 * one publishes `keccak(handle, owner, secret)`, which is opaque, and step two reveals the
 * secret at least 60 seconds later. The commitment binds the handle to the OWNER, so a
 * copied commitment is worthless to whoever copied it.
 *
 * THE SECRET IS THE WHOLE PROBLEM. It exists only in the user's browser: it is never sent
 * to a server, and after step one the chain holds only its hash. Lose it between the two
 * steps and the handle is unrecoverable until the commitment expires seven days later —
 * from the user's point of view, they typed a name, paid gas, and got nothing.
 *
 * A refresh, a crash, a closed tab and a phone call all happen inside a 60-second wait. So
 * the secret goes to `localStorage` BEFORE the commit transaction is even offered for
 * signature, keyed by network and handle. Holding it in React state — which is what
 * "generate it when they press the button" would mean — loses it on the first reload, and
 * the reload is not a rare case: it is what people do when a countdown looks stuck.
 *
 * It is deleted only once the handle is registered, which is the first moment it is
 * genuinely worthless.
 */

export interface PendingCommitment {
  handle: string;
  /** 32 random bytes. The only copy in existence after this is written. */
  secret: Hex;
  owner: Address;
  /** `makeCommitment(handle, owner, secret)`, computed by the contract itself. */
  commitment: Hex;
  network: MezoNetwork;
  /** Set once the commit transaction has a hash. Absent means "not submitted yet". */
  txHash?: Hex;
}

const PREFIX = 'maren.handle-commitment';

function storageKey(network: MezoNetwork, handle: string): string {
  return `${PREFIX}.${network}.${handle.toLowerCase()}`;
}

/**
 * A 32-byte secret from the platform CSPRNG.
 *
 * `crypto.getRandomValues`, never `Math.random`: this value is the only thing standing
 * between a user and someone else revealing their handle, and `Math.random` is seeded
 * predictably enough to be worth attacking.
 */
export function newSecret(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

export function saveCommitment(pending: PendingCommitment): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(pending.network, pending.handle), JSON.stringify(pending));
}

export function loadCommitment(network: MezoNetwork, handle: string): PendingCommitment | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKey(network, handle));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingCommitment;
    // A stored blob that does not carry a secret is worse than none: it would let the UI
    // show a "ready to reveal" step that cannot possibly succeed.
    if (!parsed?.secret || !parsed?.commitment || !parsed?.handle) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCommitment(network: MezoNetwork, handle: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(network, handle));
}

/** Every commitment this browser is still holding a secret for. */
export function listCommitments(network: MezoNetwork): PendingCommitment[] {
  if (typeof window === 'undefined') return [];
  const out: PendingCommitment[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(`${PREFIX}.${network}.`)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as PendingCommitment;
      if (parsed?.secret && parsed?.handle) out.push(parsed);
    } catch {
      // A corrupt entry is skipped rather than thrown: one bad key must not hide the
      // others, which may still be revealable.
    }
  }
  return out;
}

/**
 * Ask the CONTRACT for the commitment digest rather than hashing it here.
 *
 * `makeCommitment` is `pure`, so this is a free `eth_call` and it removes an entire class
 * of bug: a local `keccak256(abi.encode(...))` that disagrees with the contract's encoding
 * by one byte produces a commitment that can be published and can never be revealed, and
 * the failure only shows up 60 seconds later as `CommitmentNotFound`.
 */
export async function computeCommitment(
  client: PublicClient,
  network: MezoNetwork,
  handle: string,
  owner: Address,
  secret: Hex,
): Promise<Hex> {
  return client.readContract({
    address: getMarenAddresses(network).marenRegistry,
    abi: marenRegistryAbi,
    functionName: 'makeCommitment',
    args: [handle, owner, secret],
  });
}

/** When the chain recorded this commitment. Zero means it is not on-chain yet. */
export async function readCommittedAt(
  client: PublicClient,
  network: MezoNetwork,
  commitment: Hex,
): Promise<bigint> {
  return client.readContract({
    address: getMarenAddresses(network).marenRegistry,
    abi: marenRegistryAbi,
    functionName: 'commitments',
    args: [commitment],
  });
}

/**
 * Handle rules, checked before a transaction rather than inside one.
 *
 * Transcribed from `MarenRegistry._validate`. Duplicated here on purpose: the contract is
 * the authority and will refuse anything invalid regardless, but discovering
 * `HandleInvalidCharacter(4, 0x2e)` after paying gas is a worse way to learn you cannot
 * use a full stop.
 */
export function validateHandle(input: string): string | null {
  const handle = input.trim().replace(/^@/, '');
  if (handle.length === 0) return null;
  if (handle.length < 3) return 'Handles are at least 3 characters.';
  if (handle.length > 32) return 'Handles are at most 32 characters.';
  const bad = [...handle].find((c) => !/[a-z0-9_]/.test(c));
  if (bad !== undefined) {
    return `“${bad}” is not allowed — handles use lowercase letters, digits and underscores only.`;
  }
  return null;
}
