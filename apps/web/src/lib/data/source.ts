'use client';

import { useEffect, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { getChain, getMarenAddresses, isDeployed, resolveNetwork, type MezoNetwork } from '@maren/sdk';
import type { Address } from 'viem';

import { readActivity, type ActivityWindow } from '../chain/logs';
import { classifyPrice, type PriceFeed } from '../chain/price';
import * as live from './live';
import type { Balances, EarnPosition, Handle, Position, ProtocolStats } from './types';

/**
 * THE ONLY DATA SOURCE. There is no second one.
 *
 * This module used to hold a mock/live switch, and `./mock.ts` beside it held a cast of
 * invented people — `@nadia`, `@okonkwo`, `@mira` — with invented amounts and invented
 * transaction hashes that the Activity screen rendered as working explorer links under a
 * header reading "Live from Mezo testnet". A reviewer who clicked one would have found
 * nothing on chain and been right to disbelieve every other number in the product.
 *
 * That file is deleted. So is the switch, so is the demo-control store, and so is the
 * fallback that let a disconnected visitor see a populated dashboard. What replaced them:
 *
 *   1. EVERY hook below reads the chain, or reports that it cannot. There is no third
 *      outcome and no seeded data to fall back to.
 *   2. A disconnected visitor gets EMPTY STATES plus `useProtocolStats()` — the pooled
 *      trove and the BTC/USD oracle, which are real, public, and readable without a
 *      wallet. The app still has something true to show; it just is not pretending the
 *      something belongs to the visitor.
 *   3. Nothing is synthesised. Not a hash, not an address, not a handle, not an amount,
 *      not a timestamp — not behind a flag, not for a screenshot.
 *
 * `isDeployed()` survives because mainnet genuinely is all zeroes. It no longer selects a
 * mock; it selects an honest unavailable state.
 */

export const NETWORK: MezoNetwork = resolveNetwork(process.env.NEXT_PUBLIC_MEZO_NETWORK);

const targetChain = getChain(NETWORK);

export interface DataSource {
  network: MezoNetwork;
  /** The address whose position is on screen, or null when no wallet is connected. */
  account: Address | null;
  /** A wallet is connected. Says nothing about which chain it is on. */
  connected: boolean;
  /** Connected AND on the chain Maren is deployed to. */
  ready: boolean;
  /** Maren's contracts exist on the configured network. False on mainnet. */
  deployed: boolean;
}

/** True once Maren's contracts exist at the addresses in the SDK. */
export function contractsDeployed(network: MezoNetwork = NETWORK): boolean {
  return isDeployed(getMarenAddresses(network).marenVault);
}

export function useDataSource(): DataSource {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const connected = isConnected && Boolean(address);
  const deployed = contractsDeployed(NETWORK);

  return {
    network: NETWORK,
    account: connected && address ? address : null,
    connected,
    ready: connected && deployed && chainId === targetChain.id,
    deployed,
  };
}

/**
 * Query keys carry the network and the account, so disconnecting or switching wallets
 * cannot leave one screen showing the previous account's figures.
 */
function key(parts: readonly unknown[], source: DataSource) {
  return ['maren', source.network, source.account ?? 'anonymous', ...parts];
}

/** The context a live read needs. Null whenever a read would be meaningless. */
function useLiveContext() {
  const source = useDataSource();
  const client = usePublicClient();
  const ctx =
    source.ready && client && source.account
      ? { client, network: source.network, account: source.account }
      : null;
  return { source, client, ctx };
}

/**
 * The BTC/USD feed, classified against the wall clock every second.
 *
 * Needs no wallet: the oracle is a chain precompile and its answer is the same for
 * everyone, so this is one of the few things a disconnected visitor can be shown that is
 * both real and theirs to check.
 *
 * `classifyPrice` runs on every render rather than only on fetch, because a price that was
 * live when it arrived becomes stale 61 seconds later whether or not we refetch, and a
 * screen that keeps calling it live is exactly the failure the state exists to prevent.
 */
export function usePrice(): PriceFeed {
  const source = useDataSource();
  const client = usePublicClient();

  const query = useQuery({
    queryKey: key(['price'], source),
    queryFn: async () => {
      if (!client) throw new Error('No RPC transport for Mezo is available.');
      return live.readPrice({ client, network: source.network, account: ZERO });
    },
    enabled: Boolean(client) && source.deployed,
    // Well inside the oracle's own 60s tolerance, so a healthy feed never drifts into
    // looking stale purely because we stopped asking.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const nowSeconds = useNowSeconds();

  if (!source.deployed) {
    return { state: 'unavailable', reason: `Maren is not deployed on Mezo ${source.network}.` };
  }
  if (query.isPending || nowSeconds === null) return { state: 'loading' };
  if (query.error) return { state: 'unavailable', reason: 'Mezo’s oracle did not answer.' };
  return classifyPrice(query.data ?? null, nowSeconds);
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

export function usePosition(): UseQueryResult<Position> {
  const { source, ctx } = useLiveContext();
  return useQuery<Position>({
    queryKey: key(['position'], source),
    queryFn: async () => {
      if (!ctx) throw new Error('No connected account to read a position for.');
      return live.readPosition(ctx);
    },
    enabled: ctx !== null,
  });
}

export function useBalances(): UseQueryResult<Balances> {
  const { source, ctx } = useLiveContext();
  return useQuery<Balances>({
    queryKey: key(['balances'], source),
    queryFn: async () => {
      if (!ctx) throw new Error('No connected account to read balances for.');
      return live.readBalances(ctx);
    },
    enabled: ctx !== null,
  });
}

export function useEarn(): UseQueryResult<EarnPosition> {
  const { source, ctx } = useLiveContext();
  return useQuery<EarnPosition>({
    queryKey: key(['earn'], source),
    queryFn: async () => {
      if (!ctx) throw new Error('No connected account to read Earn for.');
      return live.readEarn(ctx);
    },
    enabled: ctx !== null,
  });
}

/**
 * Activity, from `eth_getLogs`.
 *
 * Returns the whole `ActivityWindow`, not just the rows, because the SPAN is part of the
 * answer. "Nothing here" means something different when the scan reached the deployment
 * block than when it only reached three days back, and the screen renders a different
 * empty state for each. Flattening this to `ActivityItem[]` would throw away the
 * distinction and let the UI overclaim.
 */
export function useActivity(): UseQueryResult<ActivityWindow> {
  const { source, ctx } = useLiveContext();
  return useQuery<ActivityWindow>({
    queryKey: key(['activity'], source),
    queryFn: async () => {
      if (!ctx) throw new Error('No connected account to read activity for.');
      return readActivity(ctx.client, ctx.network, ctx.account);
    },
    enabled: ctx !== null,
    // A log scan is many round trips. Nothing on this screen changes second to second,
    // and re-running it on every window focus would be rude to a public RPC.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The protocol's own figures — the pooled trove and the oracle.
 *
 * Deliberately independent of the connected account, because this is what an app with a
 * real product behind it can honestly show someone who has not connected yet. Every field
 * is a contract read anyone can repeat.
 */
export function useProtocolStats(): UseQueryResult<ProtocolStats> {
  const source = useDataSource();
  const client = usePublicClient();
  return useQuery<ProtocolStats>({
    queryKey: ['maren', source.network, 'protocol'],
    queryFn: async () => {
      if (!client) throw new Error('No RPC transport for Mezo is available.');
      return live.readProtocolStats({ client, network: source.network, account: ZERO });
    },
    enabled: Boolean(client) && source.deployed,
    refetchInterval: 30_000,
  });
}

/** The account's own `@handle`, from MarenRegistry's reverse resolution. */
export function usePrimaryHandle(): UseQueryResult<string | null> {
  const { source, ctx } = useLiveContext();
  return useQuery<string | null>({
    queryKey: key(['primary-handle'], source),
    queryFn: async () => {
      if (!ctx) return null;
      return live.reverseResolve(ctx, ctx.account);
    },
    enabled: ctx !== null,
  });
}

/**
 * Handle resolution. The resolved address is displayed beside the handle before any
 * confirmation — a user always sees where money is actually going.
 *
 * Resolution needs an RPC but not a signer, so this works while disconnected: someone can
 * check a handle before they commit to anything, which is the point of having handles.
 */
export function useResolvedHandle(query: string): UseQueryResult<Handle | null> {
  const source = useDataSource();
  const client = usePublicClient();
  const trimmed = query.trim();
  const isHandle = trimmed.startsWith('@') && trimmed.length > 1;

  return useQuery<Handle | null>({
    queryKey: key(['handle', trimmed], source),
    queryFn: async () => {
      if (!client) throw new Error('No RPC transport for Mezo is available.');
      return live.resolveHandle({ client, network: source.network, account: ZERO }, trimmed);
    },
    enabled: isHandle && Boolean(client) && source.deployed,
  });
}

/** Is a handle free to register? `null` while unknown — never guessed. */
export function useHandleAvailable(handle: string): UseQueryResult<boolean> {
  const source = useDataSource();
  const client = usePublicClient();
  const cleaned = handle.trim().replace(/^@/, '').toLowerCase();

  return useQuery<boolean>({
    queryKey: key(['handle-available', cleaned], source),
    queryFn: async () => {
      if (!client) throw new Error('No RPC transport for Mezo is available.');
      return live.handleAvailable({ client, network: source.network, account: ZERO }, cleaned);
    },
    enabled: cleaned.length >= 3 && Boolean(client) && source.deployed,
  });
}

// ── internals ────────────────────────────────────────────────────────────────

/**
 * The wall clock, in seconds, as state — `null` until the client has read it.
 *
 * Two reasons it is not simply `Date.now()` at render time. A timestamp baked into SSR
 * output is a hydration mismatch waiting to happen; and a placeholder of `0` would make
 * every observation look zero seconds old, which is the one wrong answer this app must
 * never give. `null` means "we do not know what time it is", and the caller treats that
 * as loading rather than as fresh.
 */
function useNowSeconds(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
