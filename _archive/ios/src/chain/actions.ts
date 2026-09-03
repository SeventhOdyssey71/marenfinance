import {
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  zeroAddress,
  type Chain,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import {
  getChain,
  getMarenAddresses,
  marenEarnAbi,
  marenPayAbi,
  marenVaultAbi,
  MEZO_CHAIN_IDS,
  type MezoNetwork,
} from '@maren/sdk';

import { getDataSource, mutate } from '../data/source';
import { requireAccount } from '../data/context';
import { isSponsoredKind as isSponsoredKindImpl } from './sponsorship';
import { accessKey } from '../wallet/keystore';
import { confirmTransaction, type TxOutcome } from './receipt';
import { getReadClient, mezoTransport } from './transport';
import { hintsForDelta } from './hints';
import {
  buildForwardRequest,
  forwarderDomain,
  forwarderNoncesAbi,
  FORWARD_REQUEST_TYPES,
  isRelayerConfigured,
  postRelay,
  RelayRefused,
  relayGasLimit,
  relayRequestBody,
  RELAYER_URL,
} from './relay';
import { privateKeyToAccount } from 'viem/accounts';
import type { LocalAccount } from 'viem/accounts';

/**
 * Every value-moving action in the app.
 *
 * Each one follows the same three steps, in this order, with no shortcuts:
 *
 *   1. Biometric-gated key access. `accessKey()` prompts for Face ID and returns the
 *      key for the duration of the signature only.
 *   2. Submit, yielding a transaction hash.
 *   3. `confirmTransaction` — the single R15 checkpoint. A hash is not a success, so
 *      nothing here returns until a receipt has been read and found to say 'success'.
 *
 * Local state is mutated *after* step 3 and only in the 'delivered' branch. That
 * ordering is the entire point: a reverted transaction must leave the UI showing the
 * pre-transaction balance, not an optimistic one it then has to walk back.
 *
 * THERE ARE TWO SUBMIT TRANSPORTS, and which one runs is decided by `dataSource` and
 * whether a relayer is configured — never faked. See `submitAction`.
 */

/**
 * Ids the chain assigns to an action that creates something, read back from the receipt.
 *
 * A payment request and a claimable link are only useful once you know the id the contract
 * gave them (`nextRequestId++` / `nextLinkId++`), and that id is not known until the
 * transaction is mined. It is NEVER guessed from `nextRequestId()` before submitting — that
 * races every other creator on the chain — it is decoded from the `RequestCreated` /
 * `LinkCreated` event in this transaction's own receipt. When the receipt cannot be read the
 * ref is simply absent, and the screen says the action landed but points the user at Activity
 * for the id rather than inventing one.
 */
export interface CreatedRefs {
  readonly requestId?: bigint;
  readonly linkId?: bigint;
}

export type ActionResult =
  | { kind: 'ok'; outcome: Extract<TxOutcome, { kind: 'delivered' }>; refs?: CreatedRefs }
  | { kind: 'declined'; reason: string }
  | { kind: 'failed'; outcome: TxOutcome };

export type ActionKind =
  | { type: 'deposit'; btcWei: bigint }
  | { type: 'withdraw'; btcWei: bigint }
  | { type: 'borrow'; musdWei: bigint }
  | { type: 'repay'; musdWei: bigint }
  | { type: 'send'; musdWei: bigint; to: string; memo?: string }
  | { type: 'earn-deposit'; musdWei: bigint }
  | { type: 'earn-withdraw'; musdWei: bigint }
  /** Pay many at once. Each leg is an independent payer -> recipient transfer; nothing pools. */
  | { type: 'split'; recipients: string[]; amounts: bigint[]; memo?: string }
  /** Record an on-chain ask. Moves no funds; `payer` is left open so anyone may fulfil it. */
  | { type: 'request'; musdWei: bigint; memo?: string }
  /** Escrow MUSD to whoever holds the one-time link secret. `linkKey` is that secret's address. */
  | { type: 'link-create'; linkKey: string; musdWei: bigint; expiry: bigint; memo?: string }
  /** Take an unclaimed link back after its expiry. */
  | { type: 'link-reclaim'; linkId: bigint }
  /**
   * Collect a claimable link into the claimer's own wallet. `secret` is the one-time bearer
   * key from the link's URL fragment: it signs the CLAIMER'S address so the payout is bound
   * to them and an observer who saw the link cannot redirect it. It is a secret — never
   * logged, never put in a query string, held only for the duration of this claim.
   */
  | { type: 'link-claim'; linkId: bigint; secret: Hex };

/**
 * Whether the relayer sponsors this action.
 *
 * The rule and its justification live in `./sponsorship`, which has no dependencies so
 * that it can be tested without pulling in the Keychain. Re-exported here so call sites
 * that already hold an `ActionKind` do not have to reach for the string themselves.
 */
export { isSponsoredKind, type ActionType } from './sponsorship';

export function isSponsored(action: ActionKind): boolean {
  return isSponsoredKindImpl(action.type);
}

/**
 * The sentence this build says when it CANNOT sign to Mezo.
 *
 * This is shown only when the reads are live but no relayer is configured. `submitMock`
 * returns a hash derived from a clock, and the transaction sheet renders a hash as a
 * tappable explorer link — so letting it run while the app is showing live figures would
 * put a link to a transaction that does not exist next to a set of numbers that do. A
 * reviewer taps it, finds nothing on chain, and is then right to disbelieve the real
 * figures beside it. That is the single most expensive thing a chain app can do, and it is
 * why the guard is a refusal rather than a warning banner.
 *
 * Once a relayer URL IS configured, the live path below signs and submits for real, and
 * this message is never reached in live mode.
 */
const LIVE_WRITES_UNAVAILABLE =
  'This build reads Mezo but has no relayer configured to sign to it, so submitting here would produce a receipt and a transaction hash that do not exist on chain. Set EXPO_PUBLIC_RELAYER_URL, or switch to demo data in Settings to walk the flow.';

/**
 * Route the submission.
 *
 *   - demo data           → the simulator, exactly as before. This is the default source.
 *   - live + relayer set  → the real path: relayed gasless actions, direct BTC deposit.
 *   - live + no relayer   → declined honestly. We do not pretend live writes work.
 */
export async function submitAction(action: ActionKind): Promise<ActionResult> {
  if (getDataSource() === 'live') {
    if (!isRelayerConfigured() || RELAYER_URL === null) {
      return { kind: 'declined', reason: LIVE_WRITES_UNAVAILABLE };
    }
    return submitLive(action, RELAYER_URL);
  }
  return submitSimulated(action);
}

// ── live transport ─────────────────────────────────────────────────────────

/** What a live action becomes on-chain, resolved once and used by every path below. */
interface LiveCall {
  readonly to: `0x${string}`;
  readonly data: Hex;
  /** Non-zero only for the payable BTC deposit; a relayed call must carry no value. */
  readonly value?: bigint;
  /** True when `MarenRelayHub` will forward this exact call. Decides relay vs self-submit. */
  readonly relayable: boolean;
  /** True when the relayer pays the gas — so `confirmTransaction` reports zero user gas. */
  readonly sponsored: boolean;
}

/**
 * The live submit path: Face ID, build the call, route it, confirm it.
 *
 * The routing here mirrors the web's `write.ts` but is decided by the CONTRACT'S allowlist,
 * not by the interface's sponsorship copy:
 *
 *   - the payable `deposit` goes DIRECT from a walletClient carrying BTC value, because the
 *     hub reverts `ValueNotRelayable` on any value and always will;
 *   - `borrow` / `repay` / `withdraw` / `pay` / `split` / `createRequest` are on the hub's
 *     allowlist and are RELAYED as signed `ForwardRequest`s, costing the user nothing;
 *   - `createLink` and `reclaimLink` are NOT allowlisted (Deploy.s.sol's payCalls stops at
 *     claimLink), so they SELF-SUBMIT from the user's wallet and the user pays the BTC gas —
 *     the same divergence as Earn, and the link screens say so in as many words;
 *   - Earn is NOT on the hub's allowlist (`MarenEarn` is absent from
 *     `Deploy.s.sol:_allowlistRelayableCalls`), so it self-submits from the user's wallet
 *     even though `sponsorship.ts` marks it sponsored. Relaying it would earn a
 *     `CallNotAllowed` revert that Maren pays to discover. This divergence is called out as
 *     a follow-up rather than papered over.
 */
async function submitLive(action: ActionKind, relayerUrl: string): Promise<ActionResult> {
  // 1 — Face ID on every signing action, without exception.
  const key = await accessKey();
  if (key.kind === 'denied') return { kind: 'declined', reason: key.reason };
  if (key.kind === 'missing') {
    return { kind: 'declined', reason: 'No signing key is available on this device.' };
  }

  // The account and network the read layer is bound to. `requireAccount` throws the stated
  // "no account is loaded" error rather than letting a null address reach the chain.
  const { network, account: loadedAddress } = requireAccount();
  const account = privateKeyToAccount(key.privateKey);
  if (getAddress(account.address) !== getAddress(loadedAddress)) {
    // The Keychain key does not derive the loaded address. Signing would produce a valid
    // transaction from the WRONG account, which is worse than not signing at all.
    return {
      kind: 'declined',
      reason: 'The signing key on this device does not match the loaded account.',
    };
  }

  let call: LiveCall;
  try {
    call = await buildLiveCall(action, network, account.address);
  } catch (error) {
    return { kind: 'declined', reason: describeSubmitError(error) };
  }

  // 2 — Submit, yielding a hash. Each transport throws on failure; none returns a fake hash.
  let hash: Hash;
  try {
    hash =
      call.value !== undefined
        ? await submitDirect(network, account, call)
        : call.relayable
          ? await submitRelayed(network, account, call, relayerUrl)
          : await submitDirect(network, account, call);
  } catch (error) {
    if (error instanceof RelayRefused) {
      return { kind: 'declined', reason: error.reason.detail };
    }
    return { kind: 'declined', reason: describeSubmitError(error) };
  }

  // 3 — The R15 checkpoint. Nothing bypasses this. A relayed call reports zero user gas.
  const outcome = await confirmTransaction(getReadClient(network), hash, {
    sponsored: call.sponsored,
  });
  if (outcome.kind !== 'delivered') return { kind: 'failed', outcome };

  // A create-shaped action needs the id the chain assigned; it is read from this receipt's
  // own event, never guessed. The chain has otherwise moved, and the next read is the truth,
  // so there is no optimistic local mutation.
  const refs = await readCreatedRefs(network, action, hash);
  return { kind: 'ok', outcome, refs };
}

/**
 * Decode the id a create-shaped action was given, from its own transaction receipt.
 *
 * Only `request` and `link-create` produce one. The `RequestCreated` / `LinkCreated` event is
 * emitted whoever submits the call, so this works for the relayed request and the
 * self-submitted link alike. Every failure path returns `undefined` rather than a placeholder:
 * an id we did not read is one the screen must not pretend to have.
 */
async function readCreatedRefs(
  network: MezoNetwork,
  action: ActionKind,
  hash: Hash,
): Promise<CreatedRefs | undefined> {
  if (action.type !== 'request' && action.type !== 'link-create') return undefined;
  const marenPay = getMarenAddresses(network).marenPay.toLowerCase();
  try {
    const receipt = await getReadClient(network).getTransactionReceipt({ hash });
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== marenPay) continue;
      let decoded: ReturnType<typeof decodeEventLog>;
      try {
        decoded = decodeEventLog({ abi: marenPayAbi, data: log.data, topics: log.topics });
      } catch {
        continue; // Not one of MarenPay's events, or an event this ABI does not carry.
      }
      if (action.type === 'request' && decoded.eventName === 'RequestCreated') {
        return { requestId: (decoded.args as { requestId: bigint }).requestId };
      }
      if (action.type === 'link-create' && decoded.eventName === 'LinkCreated') {
        return { linkId: (decoded.args as { linkId: bigint }).linkId };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Encode the calldata for an action and record how it must be routed.
 *
 * Vault operations carry sorted-list hints derived off-chain (`hintsForDelta`, read-only,
 * never allowed to fail the transaction). The deltas are the pooled trove's, and the sign
 * of each is stated here at the call site rather than hidden in the hint helper.
 */
async function buildLiveCall(
  action: ActionKind,
  network: MezoNetwork,
  from: `0x${string}`,
): Promise<LiveCall> {
  const maren = getMarenAddresses(network);

  switch (action.type) {
    case 'deposit': {
      // Collateral goes in; the trove's debt is untouched. Payable, so never relayable.
      const { upper, lower } = await hintsForDelta(network, {
        collDelta: action.btcWei,
        debtDelta: 0n,
      });
      return {
        to: maren.marenVault,
        data: encodeFunctionData({ abi: marenVaultAbi, functionName: 'deposit', args: [upper, lower] }),
        value: action.btcWei,
        relayable: false,
        sponsored: false,
      };
    }
    case 'withdraw': {
      const { upper, lower } = await hintsForDelta(network, {
        collDelta: -action.btcWei,
        debtDelta: 0n,
      });
      return {
        to: maren.marenVault,
        data: encodeFunctionData({
          abi: marenVaultAbi,
          functionName: 'withdraw',
          args: [action.btcWei, upper, lower],
        }),
        relayable: true,
        sponsored: true,
      };
    }
    case 'borrow': {
      // Worst case for the hint: the whole amount is drawn as new trove debt. Over-stating
      // moves the hint one way along the list, which the on-chain walk corrects.
      const { upper, lower } = await hintsForDelta(network, {
        collDelta: 0n,
        debtDelta: action.musdWei,
      });
      return {
        to: maren.marenVault,
        data: encodeFunctionData({
          abi: marenVaultAbi,
          functionName: 'borrow',
          args: [action.musdWei, upper, lower],
        }),
        relayable: true,
        sponsored: true,
      };
    }
    case 'repay': {
      const { upper, lower } = await hintsForDelta(network, {
        collDelta: 0n,
        debtDelta: -action.musdWei,
      });
      return {
        to: maren.marenVault,
        data: encodeFunctionData({
          abi: marenVaultAbi,
          functionName: 'repay',
          args: [action.musdWei, upper, lower],
        }),
        relayable: true,
        sponsored: true,
      };
    }
    case 'send': {
      // `to` is already an address here: the Pay screen resolves any handle before it
      // builds the action. `getAddress` throws on anything that is not one, which is caught
      // and declined rather than sent.
      return {
        to: maren.marenPay,
        data: encodeFunctionData({
          abi: marenPayAbi,
          functionName: 'pay',
          args: [getAddress(action.to), action.musdWei, action.memo ?? ''],
        }),
        relayable: true,
        sponsored: true,
      };
    }
    case 'earn-deposit': {
      // Not on the hub allowlist — self-submitted, user pays. See `submitLive`.
      return {
        to: maren.marenEarn,
        data: encodeFunctionData({
          abi: marenEarnAbi,
          functionName: 'deposit',
          args: [action.musdWei, from],
        }),
        relayable: false,
        sponsored: false,
      };
    }
    case 'earn-withdraw': {
      return {
        to: maren.marenEarn,
        data: encodeFunctionData({
          abi: marenEarnAbi,
          functionName: 'withdraw',
          args: [action.musdWei, from, from],
        }),
        relayable: false,
        sponsored: false,
      };
    }
    case 'split': {
      // `split` IS on the hub's allowlist (Deploy.s.sol payCalls[8]), so it is relayed and
      // gasless. Recipients arrive already resolved to addresses; `getAddress` throws on
      // anything else, which is caught and declined rather than sent. Each leg moves funds
      // under the payer's own MUSD allowance, exactly as `pay` does — nothing is pooled.
      return {
        to: maren.marenPay,
        data: encodeFunctionData({
          abi: marenPayAbi,
          functionName: 'split',
          args: [action.recipients.map((r) => getAddress(r)), action.amounts, action.memo ?? ''],
        }),
        relayable: true,
        sponsored: true,
      };
    }
    case 'request': {
      // `createRequest` IS allowlisted (payCalls[4]) and moves no funds, so it is relayed and
      // gasless. `payer` is left as the zero address so anyone may fulfil the ask.
      return {
        to: maren.marenPay,
        data: encodeFunctionData({
          abi: marenPayAbi,
          functionName: 'createRequest',
          args: [zeroAddress, action.musdWei, action.memo ?? ''],
        }),
        relayable: true,
        sponsored: true,
      };
    }
    case 'link-create': {
      // `createLink` is NOT on the allowlist (Deploy.s.sol payCalls stops at claimLink; create
      // and reclaim are absent), so it SELF-SUBMITS and the creator pays the BTC gas. It also
      // escrows MUSD via transferFrom, so it needs a prior MUSD allowance to MarenPay, exactly
      // as `pay` and `split` do. The copy on the review step says the gas is the user's.
      return {
        to: maren.marenPay,
        data: encodeFunctionData({
          abi: marenPayAbi,
          functionName: 'createLink',
          args: [getAddress(action.linkKey), action.musdWei, action.expiry, action.memo ?? ''],
        }),
        relayable: false,
        sponsored: false,
      };
    }
    case 'link-reclaim': {
      // `reclaimLink` is also absent from the allowlist, so it too self-submits and the creator
      // pays the gas. The contract reverts before its expiry, so the UI only offers this once
      // the chosen expiry has passed.
      return {
        to: maren.marenPay,
        data: encodeFunctionData({
          abi: marenPayAbi,
          functionName: 'reclaimLink',
          args: [action.linkId],
        }),
        relayable: false,
        sponsored: false,
      };
    }
    case 'link-claim': {
      // `claimLink` IS on the hub's allowlist (Deploy.s.sol payCalls[9]), so it is RELAYED and
      // gasless — the whole point of a claimable link is that a brand-new recipient holding no
      // BTC can collect the escrowed MUSD.
      //
      // The payout is bound to THIS claimer. MarenPay.claimLink takes the recipient explicitly
      // and verifies an ECDSA signature by the link's one-time key over
      // `linkClaimDigest(linkId, recipient)`, so a signature an observer copied off the wire is
      // only ever valid for the recipient it already names — it cannot be redirected. We sign
      // for the claimer's own loaded address (`from`).
      const recipient = getAddress(from);

      // `linkClaimDigest` = toEthSignedMessageHash(keccak256(abi.encode("MarenPay.claimLink",
      // chainId, marenPay, linkId, recipient))). The abi.encode is reproduced exactly here; a
      // mismatch would recover to the wrong signer and the contract would revert
      // `InvalidLinkSignature`, spending nothing.
      const inner = keccak256(
        encodeAbiParameters(
          [
            { type: 'string' },
            { type: 'uint256' },
            { type: 'address' },
            { type: 'uint256' },
            { type: 'address' },
          ],
          [
            'MarenPay.claimLink',
            BigInt(MEZO_CHAIN_IDS[network]),
            maren.marenPay,
            action.linkId,
            recipient,
          ],
        ),
      );

      // The bearer key signs, and only for the length of this call. `signMessage` over raw
      // bytes applies the same EIP-191 prefix `toEthSignedMessageHash` does, so `ECDSA.recover`
      // lands on the stored `linkKey`. The key is never logged and never leaves this scope.
      const linkAccount = privateKeyToAccount(action.secret);
      const signature = await linkAccount.signMessage({ message: { raw: inner } });

      return {
        to: maren.marenPay,
        data: encodeFunctionData({
          abi: marenPayAbi,
          functionName: 'claimLink',
          args: [action.linkId, recipient, signature],
        }),
        relayable: true,
        sponsored: true,
      };
    }
  }
}

/**
 * Sign the call as an EIP-712 `ForwardRequest` and hand it to the relayer.
 *
 * The nonce is `MarenRelayHub.nonces(from)`, read on-chain and never guessed — it is inside
 * the signed struct, so no one can correct a wrong one afterwards. The gas is a direct-call
 * estimate: a gas limit we cannot estimate is a gas limit we will not sign, so an estimate
 * failure throws here and the action is declined rather than a guess being paid for.
 */
async function submitRelayed(
  network: MezoNetwork,
  account: LocalAccount,
  call: LiveCall,
  relayerUrl: string,
): Promise<Hash> {
  const hub = getMarenAddresses(network).marenForwarder;
  const chainId = MEZO_CHAIN_IDS[network];
  const client = getReadClient(network);

  const [estimate, nonce] = await Promise.all([
    client.estimateGas({ account: account.address, to: call.to, data: call.data }),
    client.readContract({
      address: hub,
      abi: forwarderNoncesAbi,
      functionName: 'nonces',
      args: [account.address],
    }),
  ]);

  const message = buildForwardRequest({
    from: account.address,
    to: call.to,
    data: call.data,
    gas: relayGasLimit(estimate),
    nonce,
    nowSeconds: Math.floor(Date.now() / 1000),
  });

  const signature = await account.signTypedData({
    domain: forwarderDomain(chainId, hub),
    types: FORWARD_REQUEST_TYPES,
    primaryType: 'ForwardRequest',
    message,
  });

  const accepted = await postRelay(relayerUrl, relayRequestBody(message, signature));
  // A hash, not an outcome — `confirmTransaction` above puts it through the receipt check.
  return accepted.hash;
}

/**
 * Broadcast the call from the user's own wallet. Used for the payable BTC deposit (which
 * carries `value`) and for Earn, which the hub will not forward.
 */
async function submitDirect(
  network: MezoNetwork,
  account: LocalAccount,
  call: LiveCall,
): Promise<Hash> {
  const chain = getChain(network) as unknown as Chain;
  const walletClient = createWalletClient({ account, chain, transport: mezoTransport(chain) });
  return walletClient.sendTransaction({
    account,
    chain,
    to: call.to,
    data: call.data,
    value: call.value,
  });
}

/** Turn a thrown submit error into one honest sentence. Never a raw viem/native stack. */
function describeSubmitError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/No account is loaded/i.test(raw)) {
    return 'No account is loaded, so there is nothing to sign with.';
  }
  if (/invalid address|getAddress/i.test(raw)) {
    return 'The recipient is not a valid Mezo address, so nothing was submitted.';
  }
  return 'The transaction could not be prepared, so nothing was submitted and no gas was spent.';
}

// ── simulated transport ──────────────────────────────────────────────────────
//
// The demo path, used whenever `dataSource` is 'mock'. `submitMock` is deliberately shaped
// around the same `Pick<PublicClient, 'waitForTransactionReceipt'>` that confirmTransaction
// accepts. Local state IS mutated here after the receipt check, because in demo mode the
// in-memory ledger is the only source of truth there is.

async function submitSimulated(action: ActionKind): Promise<ActionResult> {
  // 1 — Face ID on every signing action, without exception.
  const key = await accessKey();
  if (key.kind === 'denied') return { kind: 'declined', reason: key.reason };
  if (key.kind === 'missing') {
    return { kind: 'declined', reason: 'No signing key is available on this device.' };
  }

  const sponsored = isSponsored(action);

  // 2 — Submit.
  const hash = await submitMock(action);

  // 3 — The R15 checkpoint. Nothing bypasses this.
  const outcome = await confirmTransaction(mockClient, hash, { sponsored });

  if (outcome.kind !== 'delivered') return { kind: 'failed', outcome };

  const refs = applyLocalEffect(action);
  return { kind: 'ok', outcome, refs };
}

/**
 * Move the in-memory demo ledger and, for a create-shaped action, return the id the demo
 * assigned. The live path never calls this — the chain has already moved — and reads its ids
 * back from the receipt instead. See `mock.ts:mutate` for the counters these ids come from.
 */
function applyLocalEffect(action: ActionKind): CreatedRefs | undefined {
  switch (action.type) {
    case 'deposit':
      mutate.depositBtc(action.btcWei);
      return undefined;
    case 'withdraw':
      mutate.withdrawBtc(action.btcWei);
      return undefined;
    case 'borrow':
      mutate.borrow(action.musdWei);
      return undefined;
    case 'repay':
      mutate.repay(action.musdWei);
      return undefined;
    case 'send':
      mutate.send(action.musdWei);
      return undefined;
    case 'earn-deposit':
      mutate.earnDeposit(action.musdWei);
      return undefined;
    case 'earn-withdraw':
      mutate.earnWithdraw(action.musdWei);
      return undefined;
    case 'split':
      mutate.split(action.amounts.reduce((sum, a) => sum + a, 0n));
      return undefined;
    case 'request':
      return { requestId: mutate.createRequest() };
    case 'link-create':
      return { linkId: mutate.createLink(action.musdWei) };
    case 'link-reclaim':
      mutate.reclaimLink(action.linkId);
      return undefined;
    case 'link-claim':
      mutate.claimLink(action.linkId);
      return undefined;
  }
}

async function submitMock(action: ActionKind): Promise<Hash> {
  await delay(900);
  const seed = `${action.type}:${Date.now()}`;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const body = h.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
  return `0x${body}` as Hash;
}

const mockClient = {
  async waitForTransactionReceipt({ hash }: { hash: Hash }): Promise<TransactionReceipt> {
    await delay(1_400);
    return {
      status: 'success',
      blockNumber: 4_281_907n,
      gasUsed: 148_213n,
      effectiveGasPrice: 1_200_000_000n,
      transactionHash: hash,
    } as unknown as TransactionReceipt;
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
