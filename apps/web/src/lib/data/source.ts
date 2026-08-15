'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import {
  getMarenAddresses,
  isDeployed,
  resolveNetwork,
  type MezoNetwork,
} from '@maren/sdk';
import type { Address } from 'viem';

import { classifyPrice, type PriceFeed } from '../chain/price';
import { useDemoState } from './demo';
import * as live from './live';
import * as mock from './mock';
import type {
  ActivityItem,
  Balances,
  EarnPosition,
  Handle,
  PaymentLink,
  PaymentRequest,
  Position,
  Sponsorship,
} from './types';

/**
 * THE MOCK / LIVE SPLIT. This module is the only place that decision is made.
 *
 * Maren's contracts are not deployed yet, so `getMarenAddresses()` returns the zero
 * address for all five and `isDeployed()` is false. Rather than ship an app that renders
 * empty states nobody can evaluate, every read falls through to `./mock.ts` and every
 * screen says so, loudly, in the header.
 *
 * What makes this honest rather than a demo dressed as a product:
 *
 *   1. The live implementations in `./live.ts` are real — real ABIs transcribed from the
 *      Solidity, real addresses from the SDK, real wagmi/viem reads. They are not
 *      stubs waiting to be written.
 *   2. The switch is `isDeployed(marenVault)`. When `Deploy.s.sol` writes addresses into
 *      `packages/sdk/src/addresses.ts`, this flips with no other edit.
 *   3. Nothing downstream branches on the mode except the banner that discloses it, so
 *      there is no second, mock-shaped code path to unwind later.
 *
 * Documented in `apps/web/README.md` under "Mock vs live data".
 */

export type DataMode = 'live' | 'mock';

export const NETWORK: MezoNetwork = resolveNetwork(process.env.NEXT_PUBLIC_MEZO_NETWORK);

export interface DataSource {
  mode: DataMode;
  network: MezoNetwork;
  /** Plain-language reason the app is in this mode. Shown to the user, not logged. */
  reason: string;
  /** The address whose position is on screen. The demo account when mocked. */
  account: Address;
  /** True when a real wallet is connected, regardless of data mode. */
  connected: boolean;
}

/** The gate. One expression, one place. */
export function dataMode(network: MezoNetwork = NETWORK): DataMode {
  return isDeployed(getMarenAddresses(network).marenVault) ? 'live' : 'mock';
}

export function useDataSource(): DataSource {
  const { address, isConnected } = useAccount();
  const mode = dataMode();

  return {
    mode,
    network: NETWORK,
    reason:
      mode === 'mock'
        ? 'Maren’s contracts are not deployed yet, so every figure on this screen is demo data.'
        : `Live from Mezo ${NETWORK}.`,
    account: mode === 'live' && address ? address : mock.MOCK_ADDRESS,
    connected: isConnected,
  };
}

/**
 * Query keys carry the mode, the network, the account and the demo version, so switching
 * demo account or forcing a stale oracle refetches everything at once. A screen half in
 * one state and half in another is worse than either state.
 */
function key(parts: readonly unknown[], source: DataSource, version: number) {
  return ['maren', source.mode, source.network, source.account, version, ...parts];
}

/** Everything a screen needs to know about where its numbers came from. */
function useSource() {
  const source = useDataSource();
  const { version } = useDemoState();
  const client = usePublicClient();
  const ctx =
    source.mode === 'live' && client
      ? { client, network: source.network, account: source.account }
      : null;
  return { source, version, ctx };
}

/**
 * The BTC/USD feed, classified against the wall clock every second.
 *
 * `classifyPrice` runs on every render rather than only on fetch, because a price that
 * was live when it arrived becomes stale 61 seconds later whether or not we refetch, and
 * a screen that keeps calling it live is exactly the failure the state exists to prevent.
 */
export function usePrice(): PriceFeed {
  const { source, version, ctx } = useSource();

  const query = useQuery({
    queryKey: key(['price'], source, version),
    queryFn: async () => (ctx ? live.readPrice(ctx) : mock.readPrice()),
    // Well inside the oracle's own 60s tolerance, so a healthy feed never drifts into
    // looking stale purely because we stopped asking.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  // Re-render on a timer so `ageSeconds` counts up and the state flips on its own.
  const tick = useSecondsTick(query.data ? 1_000 : 0);
  void tick;

  if (query.isPending) return { state: 'loading' };
  if (query.error) {
    return {
      state: 'unavailable',
      reason:
        'Mezo’s oracle did not answer. Its price feed reverts above 60 seconds of staleness, so this is the same condition the protocol would refuse on.',
    };
  }
  return classifyPrice(query.data ?? null, Math.floor(Date.now() / 1000));
}

export function usePosition() {
  const { source, version, ctx } = useSource();
  return useQuery<Position>({
    queryKey: key(['position'], source, version),
    queryFn: async () => (ctx ? live.readPosition(ctx) : mock.readPosition()),
  });
}

export function useBalances() {
  const { source, version, ctx } = useSource();
  return useQuery<Balances>({
    queryKey: key(['balances'], source, version),
    queryFn: async () => (ctx ? live.readBalances(ctx) : mock.readBalances()),
  });
}

export function useEarn() {
  const { source, version, ctx } = useSource();
  return useQuery<EarnPosition>({
    queryKey: key(['earn'], source, version),
    queryFn: async () => (ctx ? live.readEarn(ctx) : mock.readEarn()),
  });
}

export function useActivity() {
  const { source, version } = useSource();
  return useQuery<ActivityItem[]>({
    queryKey: key(['activity'], source, version),
    // The live path needs the Goldsky index (ARCHITECTURE.md §4); until it exists there
    // is no honest live answer, so activity is mock in both modes and labelled as such.
    queryFn: () => mock.readActivity(),
  });
}

export function useRequests() {
  const { source, version } = useSource();
  return useQuery<PaymentRequest[]>({
    queryKey: key(['requests'], source, version),
    queryFn: () => mock.readRequests(),
  });
}

export function useLinks() {
  const { source, version } = useSource();
  return useQuery<PaymentLink[]>({
    queryKey: key(['links'], source, version),
    queryFn: () => mock.readLinks(),
  });
}

export function useSponsorship() {
  const { source, version } = useSource();
  return useQuery<Sponsorship>({
    queryKey: key(['sponsorship'], source, version),
    queryFn: () => mock.readSponsorship(),
  });
}

/**
 * Handle resolution. The resolved address is displayed beside the handle before any
 * confirmation — a user always sees where money is actually going.
 */
export function useResolvedHandle(query: string) {
  const { source, version, ctx } = useSource();
  const trimmed = query.trim();
  const isHandle = trimmed.startsWith('@') && trimmed.length > 1;

  return useQuery<Handle | null>({
    queryKey: key(['handle', trimmed], source, version),
    queryFn: async () => (ctx ? live.resolveHandle(ctx, trimmed) : mock.resolveHandle(trimmed)),
    enabled: isHandle,
  });
}

// ── internals ────────────────────────────────────────────────────────────────

/** A render tick, so time-dependent state (price age) advances without a refetch. */
function useSecondsTick(intervalMs: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setN((v) => v + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return n;
}
