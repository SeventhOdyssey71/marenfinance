'use client';

import { useSyncExternalStore } from 'react';

/**
 * Demo controls for the mock data source.
 *
 * These exist so the states that matter most — a pooled position, and an oracle that has
 * stopped — can be seen without deploying a contract or waiting for Mezo's oracle to
 * actually stall. They are only reachable while the app is in mock mode; see
 * `lib/data/source.ts`, which is the single place the mock/live decision is made.
 *
 * A tiny external store rather than context: the mock module needs to read this
 * synchronously from outside React, and every query key carries `version` so a change
 * here refetches everything rather than leaving half the screen on old numbers.
 */

export type DemoAccount = 'direct' | 'pooled';

export interface DemoState {
  /** Which mock account is loaded. Changes the borrow route, and so the whole Vault. */
  account: DemoAccount;
  /**
   * Backdates the oracle observation by this many seconds, which drives the app into
   * the `stale` price state. Mezo's real tolerance is 60s.
   */
  forcedStaleSeconds: number;
  /** Bumped on every change so react-query keys change with it. */
  version: number;
}

let state: DemoState = { account: 'direct', forcedStaleSeconds: 0, version: 0 };

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read outside React — the mock data functions use this. */
export function demoState(): DemoState {
  return state;
}

export function setDemoAccount(account: DemoAccount): void {
  if (state.account === account) return;
  state = { ...state, account, version: state.version + 1 };
  emit();
}

export function setForcedStaleSeconds(seconds: number): void {
  if (state.forcedStaleSeconds === seconds) return;
  state = { ...state, forcedStaleSeconds: seconds, version: state.version + 1 };
  emit();
}

/** Bump the version without changing anything else — used after a simulated action. */
export function bumpDemoVersion(): void {
  state = { ...state, version: state.version + 1 };
  emit();
}

/**
 * The server snapshot is a stable, module-level object rather than a fresh literal.
 * Returning a new object each call makes React re-render forever during hydration.
 */
const SERVER_SNAPSHOT: DemoState = { account: 'direct', forcedStaleSeconds: 0, version: 0 };

export function useDemoState(): DemoState {
  return useSyncExternalStore(subscribe, demoState, () => SERVER_SNAPSHOT);
}
