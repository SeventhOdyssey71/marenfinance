'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSignTypedData,
  useWriteContract,
} from 'wagmi';
import {
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain, getMarenAddresses, getMusdAddresses } from '@maren/sdk';

import { marenEarnAbi, marenPayAbi, marenRegistryAbi, marenVaultAbi } from './abis';
import { ExplainedError } from './errors';
import { hintsForDelta, NO_HINTS, type Hints } from './hints';
import {
  actionIsRelayable,
  buildForwardRequest,
  FORWARD_REQUEST_TYPES,
  forwarderDomain,
  postRelay,
  probeRelayer,
  relayGasLimit,
  RELAYER_CONFIGURED,
  RELAYER_URL,
  relayRequestBody,
  shouldRelay,
  type RelayerHealth,
  type WriteActionId,
} from './relay';
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
 * THE FOURTH THING, WHEN A RELAYER IS RUNNING: it routes. When
 * `NEXT_PUBLIC_RELAYER_URL` is set, that relayer's `/healthz` says it is accepting, and
 * `MarenRelayHub` will forward this exact call, the transaction is signed as an EIP-712
 * `ForwardRequest` and POSTed to the relayer instead of broadcast from the wallet. All
 * three conditions, every time — see `shouldRelay` in `./relay.ts`, which is the only
 * place that decision is made. Anything else self-submits exactly as it did before.
 */

const targetChain = getChain(NETWORK);
const maren = getMarenAddresses(NETWORK);
const musd = getMusdAddresses(NETWORK);

/** `MarenRelayHub.nonces(owner)`. The only forwarder read this app performs. */
const forwarderNoncesAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Whether a relayer is configured at all. Build-time, therefore identical on the server
 * and in the browser, therefore safe for copy that renders in both.
 *
 * This replaces a hand-edited `RELAYER_AVAILABLE = false`. The flag was honest while
 * nothing posted to a relayer, and became a hazard the moment something did: it recorded
 * an intention, and `DEPLOY.md` had to warn an operator not to flip it. Configuration and
 * a live health probe are facts, and neither can be set to the wrong value by editing
 * a constant.
 */
export { RELAYER_CONFIGURED };

/** What the app currently knows about the relayer. Drives copy and routing alike. */
export interface RelayerStatus {
  /** A relayer URL is configured. Known before the first render. */
  readonly configured: boolean;
  /** It answered `/healthz` and said it is accepting. Never true on first render. */
  readonly live: boolean;
  /** The last probe, or null before one has completed. */
  readonly health: RelayerHealth | null;
}

const NOT_LIVE: RelayerStatus = { configured: RELAYER_CONFIGURED, live: false, health: null };

/**
 * Probe the relayer, once per cache window, and re-render when the answer changes.
 *
 * STARTS FALSE, ALWAYS. The first render happens before any probe can complete, and on
 * the server there is no probe at all, so the honest initial state is "you pay". Copy
 * that depends on this must be able to start at "you pay" and move — the other order
 * would claim sponsorship the app has not yet confirmed, which is the exact thing the old
 * `RELAYER_AVAILABLE` flag existed to prevent.
 */
export function useRelayerStatus(): RelayerStatus {
  const [status, setStatus] = useState<RelayerStatus>(NOT_LIVE);

  useEffect(() => {
    if (!RELAYER_CONFIGURED) return;
    let alive = true;
    void probeRelayer(RELAYER_URL).then((health) => {
      if (!alive) return;
      setStatus({ configured: true, live: health.accepting, health });
    });
    return () => {
      alive = false;
    };
  }, []);

  return status;
}

/**
 * Honest gas copy for one action.
 *
 * Three states, and the difference between the last two is the point. "No relayer is
 * running yet" is true of this repository as it ships and false of a deployment that has
 * one which is merely refusing work — telling an operator with a budget-exhausted relayer
 * that none exists would send them looking for the wrong problem.
 *
 * The disclosure is one clause on purpose. It used to be three sentences of
 * infrastructure above the button a user was about to press. What a signer needs to know
 * is who is paying.
 */
export function gasNote(
  sponsorable: boolean,
  detail: string,
  relayer: Pick<RelayerStatus, 'configured' | 'live'> = NOT_LIVE,
): { sponsored: boolean; note: string } {
  if (!sponsorable) return { sponsored: false, note: detail };
  if (relayer.live) {
    return { sponsored: true, note: `Maren pays the gas for this action. ${detail}` };
  }
  return {
    sponsored: false,
    note: relayer.configured
      ? `${detail} You pay the Bitcoin gas. Maren’s relayer is not taking work right now.`
      : `${detail} You pay the Bitcoin gas. No relayer is running yet.`,
  };
}

/**
 * The gas claim on its own, for the one-line disclosure beside a button.
 *
 * Shares every branch with `gasNote`, so the line under a Send button and the line in the
 * sheet that Send opens cannot say different things. An action that Maren does not
 * sponsor at all says so plainly rather than borrowing the "no relayer is running"
 * sentence, which would suggest it will change when one does.
 */
export function gasLine(
  sponsorable: boolean,
  relayer: Pick<RelayerStatus, 'configured' | 'live'> = NOT_LIVE,
): string {
  if (!sponsorable) return 'You pay the Bitcoin gas. Maren does not sponsor this action.';
  return gasNote(true, '', relayer).note.trim();
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

/**
 * The inner hash a payment link's one-time key signs, BEFORE the EIP-191 prefix.
 *
 * Reproduced byte-for-byte from `MarenPay.linkClaimDigest`:
 *
 *   keccak256(abi.encode("MarenPay.claimLink", block.chainid, address(this), linkId, recipient))
 *
 * with abi types `[string, uint256, address, uint256, address]`. This is the web twin of
 * iOS `MarenEncoding.claimLinkInner`, which is golden-tested against Foundry's `cast
 * abi-encode`; the string literal, the argument order and the types are identical here, so
 * the two apps produce the same 32 bytes for the same link and recipient.
 */
export function claimLinkInnerHash(input: {
  chainId: number;
  marenPay: Address;
  linkId: bigint;
  recipient: Address;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'string' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      ['MarenPay.claimLink', BigInt(input.chainId), input.marenPay, input.linkId, input.recipient],
    ),
  );
}

/**
 * Sign a link claim with the link's one-time bearer key.
 *
 * THE SIGNATURE BINDS THE PAYOUT TO ONE RECIPIENT. The digest above names `recipient`, so a
 * signature produced here is only ever valid for the address it already carries — a copied
 * signature cannot be replayed to redirect the funds, which is what lets a link travel over
 * an untrusted channel. The secret itself never touches the chain; only its signature over
 * the recipient does.
 *
 * The wrapping `signMessage({ message: { raw } })` applies the EIP-191
 * `\x19Ethereum Signed Message:\n32` prefix to the 32-byte inner hash, which is exactly
 * what the contract's `MessageHashUtils.toEthSignedMessageHash` does before
 * `ECDSA.recover`. The returned 65-byte signature has `v` as 27/28, the shape the contract
 * recovers against. This mirrors iOS `MezoActions.signClaimLink` / `EthereumAccount.signMessage`.
 */
export async function signClaimLink(input: {
  secret: Hex;
  chainId: number;
  marenPay: Address;
  linkId: bigint;
  recipient: Address;
}): Promise<Hex> {
  const inner = claimLinkInnerHash(input);
  const linkAccount = privateKeyToAccount(input.secret);
  return linkAccount.signMessage({ message: { raw: inner } });
}

/** Every write the app can perform. Each returns a hash, or throws. */
export interface MarenWrites {
  /** True when a real signer is connected to the right chain. */
  ready: boolean;
  depositBtc: (amountWei: bigint) => Promise<Hash>;
  /**
   * `sponsorable: false` opts this borrow out of relaying.
   *
   * The Vault screen passes it for a direct trove, where Maren's stated policy is that it
   * does not sponsor. The hub's allowlist does not distinguish the two routes, so without
   * this the router would relay a borrow the interface had just said costs BTC gas.
   */
  borrowMusd: (amountWei: bigint, options?: { sponsorable?: boolean }) => Promise<Hash>;
  repayMusd: (amountWei: bigint) => Promise<Hash>;
  withdrawBtc: (amountWei: bigint) => Promise<Hash>;
  /** ERC-20 approval. Its own transaction on purpose — see the note in `useMarenWrites`. */
  approveMusd: (spender: Address, amountWei: bigint) => Promise<Hash>;
  payAddress: (to: Address, amountWei: bigint, memo: string) => Promise<Hash>;
  payHandle: (handle: string, amountWei: bigint, memo: string) => Promise<Hash>;
  /** `payer` is the zero address when anyone may fulfil the request. */
  createRequest: (payer: Address, amountWei: bigint, memo: string) => Promise<Hash>;
  /**
   * Pay a request somebody else created, releasing the requested MUSD to the requester.
   *
   * The amount and recipient live in the request the contract stored at `requestId`, so
   * nothing about the payment is passed here — the contract reads its own record. It pulls
   * MUSD with `transferFrom`, so it needs a prior MarenPay approval exactly as a direct pay
   * does. The contract reverts `RequestNotOpen` if it was already fulfilled or cancelled,
   * and the simulation surfaces that before anything is signed.
   */
  fulfillRequest: (requestId: bigint) => Promise<Hash>;
  /**
   * Claim a payment link into the connected wallet.
   *
   * `secret` is the one-time private key from the link's URL fragment. It signs a digest
   * that names the claimer as recipient (see `signClaimLink`); the claimer's own wallet
   * then submits — or, when a relayer is live, signs the forwarded request. The recipient
   * is always the connected account, so a link cannot be claimed to an address the presser
   * does not control.
   */
  claimLink: (linkId: bigint, secret: Hex) => Promise<Hash>;
  /**
   * Pay N recipients in one call. `recipients[i]` receives `amountsWei[i]`; the arrays
   * are index-aligned and the contract reverts `ArrayLengthMismatch` if they are not.
   * Nothing is pooled — each leg is an independent payer -> recipient transfer.
   */
  splitPayment: (recipients: Address[], amountsWei: bigint[], memo: string) => Promise<Hash>;
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
  const client = usePublicClient({ chainId: targetChain.id });
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const relayer = useRelayerStatus();

  const onRightChain = chainId === targetChain.id;
  const ready = Boolean(isConnected && address && client) && onRightChain;

  // Held in a ref so a fresh callback identity on every render of a screen cannot
  // rebuild every write function underneath an in-flight transaction.
  const onSimulated = useRef(options.onSimulated);
  onSimulated.current = options.onSimulated;

  // Same reason: the write functions are memoised on `ready`, and a probe resolving must
  // not rebuild all thirteen of them mid-transaction. The routing decision reads the
  // freshest value at the moment of the press rather than the one captured at render.
  const relayerRef = useRef(relayer);
  relayerRef.current = relayer;

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
     * Sign the call as a `ForwardRequest` and hand it to the relayer.
     *
     * Reached only through `submitCall` below, and only when all three routing conditions
     * hold. Everything it needs comes from the SAME `params` object the simulation ran
     * against: the calldata is re-encoded from that object's abi, function name and args
     * rather than rebuilt from a second list, so the bytes the user signs cannot drift
     * from the bytes that were proved not to revert.
     *
     * WHAT IS READ FROM THE CHAIN, AND WHY EACH ONE:
     *
     *   - `MarenRelayHub.nonces(from)`. The relayer rejects any other value with a typed
     *     NONCE_MISMATCH, and it is inside the signed struct, so it cannot be corrected
     *     afterwards by anyone.
     *   - A gas estimate for the direct call. If the node will not give one, we do NOT
     *     sign a guess: an under-estimate is an out-of-gas revert that Maren pays for,
     *     and a maximal one reserves an outsized slice of a shared daily budget. We fall
     *     back to the user's own wallet, which is a worse deal for them and an honest
     *     one.
     */
    const relayCall = async (
      account: Address,
      publicClient: NonNullable<typeof client>,
      params: {
        address: Address;
        abi: readonly unknown[];
        functionName: string;
        args: readonly unknown[];
      },
    ): Promise<Hash> => {
      if (RELAYER_URL === null) throw new Error('no relayer is configured');

      const call = {
        address: params.address,
        abi: params.abi as Abi,
        functionName: params.functionName,
        args: params.args,
      } as const;

      // A gas limit we cannot estimate is a gas limit we will not sign. Under-estimating
      // buys an out-of-gas revert that Maren pays for; signing the maximum reserves an
      // outsized slice of a shared daily budget for one action. Neither is worth a guess,
      // and this happens before anything is asked of the user.
      const estimate = await publicClient.estimateContractGas({ ...call, account });

      const nonce = await publicClient.readContract({
        address: maren.marenForwarder,
        abi: forwarderNoncesAbi,
        functionName: 'nonces',
        args: [account],
      });

      const message = buildForwardRequest({
        from: account,
        to: params.address,
        data: encodeFunctionData(call),
        gas: relayGasLimit(estimate),
        nonce,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      // The wallet opens HERE, not after the simulation: the nonce and gas reads above
      // are still "checking", and telling a user their wallet is open while two RPC round
      // trips are in flight is the kind of small lie the sheet's phases exist to avoid.
      onSimulated.current?.();
      const signature = await signTypedDataAsync({
        domain: forwarderDomain(targetChain.id, maren.marenForwarder),
        types: FORWARD_REQUEST_TYPES,
        primaryType: 'ForwardRequest',
        message,
      });

      const accepted = await postRelay(RELAYER_URL, relayRequestBody(message, signature));
      // A hash, not an outcome. `useTxRunner` puts it through `confirmTransaction` exactly
      // as it does a self-submitted one — the relayer answers 202 with `success: false`
      // for precisely this reason.
      return accepted.hash;
    };

    /**
     * SIMULATE, THEN ROUTE, THEN SIGN. NEVER ANOTHER ORDER, NEVER ONLY ONE.
     *
     * Every write in this module goes through here, so the ordering is stated once and
     * cannot be forgotten in the thirteenth one. `simulate` is an `eth_call` against
     * current state: it reverts exactly as the real transaction would, for free, before
     * the wallet ever opens. If it throws, nothing below is reached — no signature is
     * requested, no gas is spent, and the thrown error still carries the contract's own
     * revert data for `explainError` to decode.
     *
     * This is the second of two defences and it is not redundant with the first.
     * `lib/chain/preflight.ts` stops a doomed action being OFFERED, from state that was
     * read when the screen rendered. This stops a doomed action being SIGNED, from state
     * as it is at the moment of the press — a price tick, somebody else's borrow, a
     * guardian pausing the vault between the render and the click. The preflight cannot
     * see those; this cannot explain itself in advance. Both, always.
     *
     * IT SIMULATES ON BOTH PATHS. A relayed call is simulated here from the user's own
     * account before it is signed, and again by the relayer before it is broadcast. The
     * second one protects Maren's gas; this one protects the user from signing something
     * that was already doomed, and it is what puts the contract's decoded reason on the
     * sheet rather than a relayer's SIMULATION_REVERTED.
     *
     * The routing decision is made after the simulation and before anything is asked of
     * the user, which is the only point at which it can be both fresh and free. It is
     * `shouldRelay` that decides, from three facts: a configured URL, a relayer that said
     * it is accepting, and a call `MarenRelayHub` will actually forward.
     *
     * THERE IS NO SILENT FALLBACK, IN EITHER DIRECTION.
     *
     * If the relayer refuses a request we already routed to it, that refusal is reported.
     * Quietly re-opening the wallet to self-submit would charge a user gas after the sheet
     * told them Maren was paying, and they would have no way to know it had happened.
     * `postRelay` marks the relayer unavailable on refusals that will still hold next
     * time, so the retry the user makes goes through their own wallet and the copy says
     * so before they press.
     *
     * And if the sheet claimed sponsorship but the relayer has since gone cold, this
     * refuses rather than self-submitting. A silent switch to the user's wallet at that
     * point is the same lie with the sign flipped, and it would also make the receipt
     * wrong: `confirmTransaction` is told `sponsored` from the intent, so it would report
     * gas paid of zero on a transaction the user paid for.
     */
    const submitCall = async (
      account: Address,
      publicClient: NonNullable<typeof client>,
      params: {
        address: Address;
        abi: readonly unknown[];
        functionName: string;
        args: readonly unknown[];
      },
      action: WriteActionId | null,
      simulate: () => Promise<unknown>,
      write: () => Promise<Hash>,
    ): Promise<Hash> => {
      await simulate();

      // The same row the screen read to decide what to claim. A null action is a caller
      // opting out of sponsorship for a reason the allowlist does not encode — see
      // `borrowMusd` and the direct-trove route.
      const relayable = action !== null && actionIsRelayable(action);

      // What the confirmation sheet promised, when it rendered. `useRelayerStatus` probes
      // once per mount, so this is stable across the life of a screen and only moves when
      // a real refusal knocks it down.
      const claimedSponsorship = relayable && relayerRef.current.live;

      // Answered from the cached probe inside its window, so the common case costs
      // nothing. `shouldRelay` is the only place the three conditions are combined.
      const health = await probeRelayer(RELAYER_URL);
      if (shouldRelay({ url: RELAYER_URL, health, relayable })) {
        return relayCall(account, publicClient, params);
      }

      if (claimedSponsorship) {
        throw new ExplainedError({
          name: 'RELAYER_WENT_COLD',
          title: 'Maren stopped covering the gas for this one',
          detail:
            'The relayer was accepting work when this screen loaded and is not now, and ' +
            'this action was offered to you as sponsored. Nothing was submitted and no gas ' +
            'was spent. Try again and the interface will tell you who pays before you sign.',
        });
      }

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
        return submitCall(
          account,
          publicClient,
          params,
          'depositBtc',
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async borrowMusd(amountWei, options = {}) {
        const { account, publicClient } = requireSigner();
        /**
         * The one write whose sponsorship is not decided by the allowlist alone.
         *
         * `MarenVault.borrow` is on the hub's allowlist unconditionally, so the contract
         * would forward a borrow against a user's own trove as readily as one against the
         * social vault. Maren's stated policy on the Vault screen is that it does not
         * sponsor direct-trove operations, and that is a product decision the allowlist
         * does not encode. The screen passes the opt-out rather than the copy quietly
         * disagreeing with what the router does.
         */
        const borrowAction: WriteActionId | null =
          options.sponsorable === false ? null : 'borrowMusd';
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
        return submitCall(
          account,
          publicClient,
          params,
          borrowAction,
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
        return submitCall(
          account,
          publicClient,
          params,
          'repayMusd',
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
        return submitCall(
          account,
          publicClient,
          params,
          'withdrawBtc',
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
        return submitCall(
          account,
          publicClient,
          params,
          null,
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
        return submitCall(
          account,
          publicClient,
          params,
          'payAddress',
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
        return submitCall(
          account,
          publicClient,
          params,
          'payHandle',
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
        return submitCall(
          account,
          publicClient,
          params,
          'createRequest',
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async fulfillRequest(requestId) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenPay,
          abi: marenPayAbi,
          functionName: 'fulfillRequest',
          args: [requestId],
        } as const;
        return submitCall(
          account,
          publicClient,
          params,
          'fulfillRequest',
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async claimLink(linkId, secret) {
        const { account, publicClient } = requireSigner();
        // The link key (from the URL fragment) signs a digest binding the payout to THIS
        // claimer, reproduced from `MarenPay.linkClaimDigest`. Built here, before the call,
        // so the exact bytes the contract recovers against are what the simulation runs and
        // what gets submitted. A wrong secret recovers to the wrong signer and the contract
        // reverts `InvalidLinkSignature`, which the simulate-first path surfaces at no cost.
        const signature = await signClaimLink({
          secret,
          chainId: targetChain.id,
          marenPay: maren.marenPay,
          linkId,
          recipient: account,
        });
        const params = {
          address: maren.marenPay,
          abi: marenPayAbi,
          functionName: 'claimLink',
          args: [linkId, account, signature],
        } as const;
        return submitCall(
          account,
          publicClient,
          params,
          'claimLink',
          () => publicClient.simulateContract({ ...params, account }),
          () => writeContractAsync({ ...params, chainId: targetChain.id }),
        );
      },

      async splitPayment(recipients, amountsWei, memo) {
        const { account, publicClient } = requireSigner();
        const params = {
          address: maren.marenPay,
          abi: marenPayAbi,
          functionName: 'split',
          args: [recipients, amountsWei, memo],
        } as const;
        return submitCall(
          account,
          publicClient,
          params,
          'splitPayment',
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
        return submitCall(
          account,
          publicClient,
          params,
          'createLink',
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
        return submitCall(
          account,
          publicClient,
          params,
          'earnDeposit',
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
        return submitCall(
          account,
          publicClient,
          params,
          'earnWithdraw',
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
        return submitCall(
          account,
          publicClient,
          params,
          'commitHandle',
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
        return submitCall(
          account,
          publicClient,
          params,
          'registerHandle',
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
