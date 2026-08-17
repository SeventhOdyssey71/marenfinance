'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useAccount, useChainId, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { erc20Abi, type Address, type Hash, type Hex } from 'viem';
import { getChain, getMarenAddresses, getMusdAddresses } from '@maren/sdk';

import { marenEarnAbi, marenPayAbi, marenRegistryAbi, marenVaultAbi } from './abis';
import { hintsForDelta, NO_HINTS, type Hints } from './hints';
import { NETWORK } from '../data/source';

/**
 * The write path. Every real transaction the app can send is built here.
 *
 * This module exists so that `TxIntent.submit` — the seam the confirmation sheet already
 * had, and which nothing was filling — can be handed a function that returns a real hash.
 * Nothing here decides whether a transaction SUCCEEDED. That judgement belongs to
 * `confirmTransaction` in `./receipt.ts` and happens once, in `useTxRunner`, for every
 * action in the app. A submit function's whole job is to get a hash or throw.
 *
 * THREE THINGS THIS DOES BEFORE SIGNING, IN ORDER:
 *
 *   1. Checks the wallet is on the right chain. Signing against 31612 when the contracts
 *      are on 31611 produces a transaction that either goes nowhere or, worse, hits an
 *      unrelated contract at the same address.
 *   2. Derives sorted-list hints with `eth_call` (see `./hints.ts`). Never in the
 *      transaction.
 *   3. SIMULATES. `simulateContract` runs the call against current state and reverts
 *      exactly as the real transaction would — for free, before the wallet ever opens.
 *      This is what turns "borrow reverts with a hex blob after you paid gas" into "here
 *      is why, and you have not signed anything". It is the single highest-value line in
 *      this file.
 *
 * WHAT IS DELIBERATELY NOT HERE: anything routed through MarenRelayHub. The hub is
 * deployed, but no relayer service is running anywhere to submit for it, so a "gasless"
 * path would be a button that hangs. Sponsorship is reported honestly per-action in the
 * UI instead — see `gasNote` below.
 */

const targetChain = getChain(NETWORK);
const maren = getMarenAddresses(NETWORK);
const musd = getMusdAddresses(NETWORK);

/**
 * NO RELAYER IS RUNNING.
 *
 * `MarenRelayHub` exists on matsnet at the address in `@maren/sdk`, and the contracts
 * trust it — but `apps/relayer` is not deployed to any host. Until it is, every action in
 * this app is submitted by the user's own wallet and paid for in BTC gas, including the
 * ones the architecture intends to sponsor.
 *
 * This constant is the single place that fact is recorded, so that when a relayer does go
 * up the UI stops claiming "no gas" in exactly one edit rather than in nine strings.
 */
export const RELAYER_AVAILABLE = false;

/**
 * Honest gas copy for an action that WOULD be sponsored if a relayer were running.
 *
 * The disclosure used to be three sentences: what the relayer would normally do, that no
 * relayer is running, that the contracts are ready and the service is not deployed. In a
 * confirmation sheet that is four lines of infrastructure above the button the user is
 * about to press. The fact survives; the explanation of it does not. What a signer needs
 * to know is who is paying, and that is one clause.
 */
export function gasNote(
  sponsorable: boolean,
  detail: string,
): { sponsored: boolean; note: string } {
  if (sponsorable && !RELAYER_AVAILABLE) {
    return {
      sponsored: false,
      note: `${detail} You pay the Bitcoin gas. No relayer is running yet.`,
    };
  }
  return { sponsored: sponsorable && RELAYER_AVAILABLE, note: detail };
}

export class WrongNetworkError extends Error {
  constructor(actual: number) {
    super(
      `Your wallet is on chain ${actual}. Maren is deployed on ${targetChain.name} (${targetChain.id}). Switch networks and try again.`,
    );
    this.name = 'WrongNetworkError';
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super('No wallet is connected, so there is nothing to sign with.');
    this.name = 'NotConnectedError';
  }
}

/** Every write the app can perform. Each returns a hash, or throws. */
export interface MarenWrites {
  /** True when a real signer is connected to the right chain. */
  ready: boolean;
  depositBtc: (amountWei: bigint) => Promise<Hash>;
  borrowMusd: (amountWei: bigint) => Promise<Hash>;
  repayMusd: (amountWei: bigint) => Promise<Hash>;
  withdrawBtc: (amountWei: bigint) => Promise<Hash>;
  /** ERC-20 approval. Its own transaction on purpose — see the note in `useMarenWrites`. */
  approveMusd: (spender: Address, amountWei: bigint) => Promise<Hash>;
  payAddress: (to: Address, amountWei: bigint, memo: string) => Promise<Hash>;
  payHandle: (handle: string, amountWei: bigint, memo: string) => Promise<Hash>;
  /** `payer` is the zero address when anyone may fulfil the request. */
  createRequest: (payer: Address, amountWei: bigint, memo: string) => Promise<Hash>;
  createLink: (
    linkKey: Address,
    amountWei: bigint,
    expiryUnix: bigint,
    memo: string,
  ) => Promise<Hash>;
  earnDeposit: (assetsWei: bigint) => Promise<Hash>;
  earnWithdraw: (assetsWei: bigint) => Promise<Hash>;
  commitHandle: (commitment: Hex) => Promise<Hash>;
  registerHandle: (handle: string, secret: Hex) => Promise<Hash>;
}

export interface MarenWriteOptions {
  /**
   * Called the instant a simulation passes and BEFORE the wallet is asked for anything.
   *
   * The transaction sheet uses it to move from "Checking this will succeed" to "Waiting
   * for your wallet", which is the difference between two states a user can tell apart:
   * one where nothing has been asked of them and one where something has. It also makes
   * the ordering observable — if a refusal arrives without this ever firing, no signature
   * was requested, and the sheet says so in those words.
   */
  onSimulated?: () => void;
}

export function useMarenWrites(options: MarenWriteOptions = {}): MarenWrites {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const onRightChain = chainId === targetChain.id;
  const ready = Boolean(isConnected && address && client) && onRightChain;

  // Held in a ref so a fresh callback identity on every render of a screen cannot
  // rebuild every write function underneath an in-flight transaction.
  const onSimulated = useRef(options.onSimulated);
  onSimulated.current = options.onSimulated;

  /**
   * The guard every write goes through. Throws a NAMED error rather than returning null,
   * because a submit function that quietly resolves to nothing would be reported by the
   * transaction sheet as a success with a missing hash.
   */
  const requireSigner = useCallback((): {
    account: Address;
    publicClient: NonNullable<typeof client>;
  } => {
    if (!isConnected || !address) throw new NotConnectedError();
    if (!onRightChain) throw new WrongNetworkError(chainId);
    if (!client) throw new Error('No RPC transport for Mezo is available right now.');
    return { account: address, publicClient: client };
  }, [address, chainId, client, isConnected, onRightChain]);

  return useMemo<MarenWrites>(() => {
    /**
     * Hints for a vault operation, expressed as the delta it applies to the POOLED trove.
     * Read-only, and never allowed to fail the transaction: `hintsForDelta` swallows its
     * own errors and falls back to a head-walk.
     */
    const hints = async (collDelta: bigint, debtDelta: bigint): Promise<Hints> => {
      if (!client) return NO_HINTS;
      return hintsForDelta(client, NETWORK, { collDelta, debtDelta });
    };

    /**
     * SIMULATE, THEN SIGN. NEVER THE OTHER WAY, NEVER ONLY ONE.
     *
     * Every write in this module goes through here, so the ordering is stated once and
     * cannot be forgotten in the thirteenth one. `simulate` is an `eth_call` against
     * current state: it reverts exactly as the real transaction would, for free, before
     * the wallet ever opens. If it throws, `write` is never reached — no signature is
     * requested, no gas is spent, and the thrown error still carries the contract's own
     * revert data for `explainError` to decode.
     *
     * This is the second of two defences and it is not redundant with the first.
     * `lib/chain/preflight.ts` stops a doomed action being OFFERED, from state that was
     * read when the screen rendered. This stops a doomed action being SIGNED, from state
     * as it is at the moment of the press — a price tick, somebody else's borrow, a
     * guardian pausing the vault between the render and the click. The preflight cannot
     * see those; this cannot explain itself in advance. Both, always.
     */
    const simulateThenSign = async (
      simulate: () => Promise<unknown>,
      write: () => Promise<Hash>,
    ): Promise<Hash> => {
      await simulate();
      onSimulated.current?.();
      return write();
    };

    return {
      ready,

      // --- vault ------------------------------------------------------------
      async depositBtc(amountWei) {
        const { account, publicClient } = requireSigner();
        // Collateral goes in; the trove's debt is untouched.
        const { upper, lower } = await hints(amountWei, 0n);
        const params = {
          address: maren.marenVault,
          abi: marenVaultAbi,
          functionName: 'deposit',
          args: [upper, lower],
          value: amountWei,
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async borrowMusd(amountWei) {
        const { account, publicClient } = requireSigner();
        // Worst case for the hint: the whole amount is drawn as new trove debt rather
        // than served from Maren's MUSD reserve. Over-stating the debt moves the hint
        // one way along the list, which the on-chain walk corrects.
        const { upper, lower } = await hints(0n, amountWei);
        const params = {
          address: maren.marenVault,
          abi: marenVaultAbi,
          functionName: 'borrow',
          args: [amountWei, upper, lower],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async repayMusd(amountWei) {
        const { account, publicClient } = requireSigner();
        const { upper, lower } = await hints(0n, -amountWei);
        const params = {
          address: maren.marenVault,
          abi: marenVaultAbi,
          functionName: 'repay',
          args: [amountWei, upper, lower],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async withdrawBtc(amountWei) {
        const { account, publicClient } = requireSigner();
        const { upper, lower } = await hints(-amountWei, 0n);
        const params = {
          address: maren.marenVault,
          abi: marenVaultAbi,
          functionName: 'withdraw',
          args: [amountWei, upper, lower],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      // --- MUSD approval ------------------------------------------------------
      /**
       * Its own transaction, surfaced to the user as its own step.
       *
       * The alternative — approving silently inside another action — would mean one press
       * produced two signatures and one of them had no receipt check. The rule in
       * `receipt.ts` is that nothing is delivered without a receipt, and that rule is
       * easier to keep than to reason about: one action, one hash, one receipt.
       */
      async approveMusd(spender, amountWei) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: musd.musd,
          abi: erc20Abi,
          functionName: 'approve',
          args: [spender, amountWei],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      // --- pay ----------------------------------------------------------------
      async payAddress(to, amountWei, memo) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenPay,
          abi: marenPayAbi,
          functionName: 'pay',
          args: [to, amountWei, memo],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async payHandle(handle, amountWei, memo) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenPay,
          abi: marenPayAbi,
          functionName: 'payToHandle',
          args: [handle.replace(/^@/, ''), amountWei, memo],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async createRequest(payer, amountWei, memo) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenPay,
          abi: marenPayAbi,
          functionName: 'createRequest',
          args: [payer, amountWei, memo],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async createLink(linkKey, amountWei, expiryUnix, memo) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenPay,
          abi: marenPayAbi,
          functionName: 'createLink',
          args: [linkKey, amountWei, expiryUnix, memo],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      // --- earn ----------------------------------------------------------------
      async earnDeposit(assetsWei) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenEarn,
          abi: marenEarnAbi,
          functionName: 'deposit',
          args: [assetsWei, account],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async earnWithdraw(assetsWei) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenEarn,
          abi: marenEarnAbi,
          functionName: 'withdraw',
          args: [assetsWei, account, account],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      // --- registry -------------------------------------------------------------
      async commitHandle(commitment) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenRegistry,
          abi: marenRegistryAbi,
          functionName: 'commit',
          args: [commitment],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async registerHandle(handle, secret) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenRegistry,
          abi: marenRegistryAbi,
          functionName: 'register',
          args: [handle.replace(/^@/, ''), secret],
        } as const;
        return simulateThenSign(
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },
    };
  }, [client, ready, requireSigner, writeContractAsync]);
}

/** Where MUSD has to be approved for each action that pulls it. */
export const SPENDERS = {
  vault: maren.marenVault,
  pay: maren.marenPay,
  earn: maren.marenEarn,
} as const;

export const MUSD_ADDRESS = musd.musd;

/**
 * The MUSD allowance a spender currently holds, and whether it covers an amount.
 *
 * Every action that moves MUSD — repay, pay, deposit into Earn — pulls it with
 * `transferFrom`, so it needs an allowance first. Reading it here lets each screen show
 * the approval as its own visible step rather than discovering the shortfall inside a
 * revert. `needed` is false while the read is in flight: an unknown allowance must not
 * flash an approval prompt that then disappears.
 */
export function useMusdAllowance(
  spender: Address,
  amountWei: bigint,
): { allowanceWei: bigint | null; needed: boolean; refetch: () => void } {
  const { address } = useAccount();
  const chainId = useChainId();

  const { data, refetch } = useReadContract({
    address: musd.musd,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, spender] : undefined,
    chainId: targetChain.id,
    query: { enabled: Boolean(address) && chainId === targetChain.id },
  });

  const allowanceWei = data ?? null;
  return {
    allowanceWei,
    needed: allowanceWei !== null && amountWei > 0n && allowanceWei < amountWei,
    refetch: () => void refetch(),
  };
}
