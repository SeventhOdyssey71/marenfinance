import {
  BaseError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  type Address,
  type Chain,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain } from '@maren/sdk';
import { RelayError, upstream } from './errors.js';
import {
  FORWARDER_ABI,
  toOnChainRequest,
  type ForwardRequest,
  type ForwarderReader,
} from './forwarder.js';
import type { ReceiptLike, ReceiptReader } from './receipt.js';
import type { GasFees, SubmitContext } from './nonce.js';
import type { RelayerConfig } from './config.js';
import { loadKeystoreFile, readPassphraseFile } from './keystore.js';

/**
 * Everything that talks to a Mezo node, behind one interface so the rest of the
 * service can be tested without a chain and integration-tested against an anvil
 * fork without changing a line of production code.
 */
export interface ChainAdapter extends ForwarderReader, ReceiptReader {
  readonly account: Address;
  readonly chainId: number;
  balance(): Promise<bigint>;
  transactionCount(address: Address): Promise<number>;
  estimateFees(): Promise<GasFees>;
  /**
   * `eth_call` + `eth_estimateGas` against the forwarder. Throws
   * SIMULATION_REVERTED for anything that would revert, so we never burn BTC on
   * a doomed transaction. Returns the gas limit to submit with.
   */
  simulate(request: ForwardRequest): Promise<bigint>;
  sendExecute(request: ForwardRequest, ctx: SubmitContext, gasLimit: bigint): Promise<Hash>;
}

function revertDetail(error: unknown): string {
  if (error instanceof BaseError) {
    // `shortMessage` is the decoded revert reason where one exists. It can
    // contain a custom error name and arguments; it never contains our key.
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return 'unknown revert';
}

/**
 * Resolve the hot key from whichever source config settled on.
 *
 * Nothing here logs, and no error raised below carries the key or the
 * passphrase. `create.ts` puts the message straight into `problems`, which is
 * served on `/health`.
 */
export async function resolvePrivateKey(config: RelayerConfig): Promise<Hex> {
  const key = config.key;
  if (key === null) {
    throw new Error('no signing key configured');
  }
  switch (key.kind) {
    case 'env':
      return key.privateKey;
    case 'keystore':
      return loadKeystoreFile(key.path, key.password);
    case 'keystore-file':
      return loadKeystoreFile(key.path, await readPassphraseFile(key.passwordFile));
  }
}

export interface ViemAdapterDeps {
  readonly config: RelayerConfig;
  readonly privateKey: Hex;
  /** Override for tests / anvil. Defaults to the chain from @maren/sdk. */
  readonly chain?: Chain;
  /**
   * Ordered endpoints, normally the ones that PASSED the boot preflight. Falls
   * back to the configured list, which is only correct before preflight has run.
   */
  readonly rpcUrls?: readonly string[];
}

export function createViemAdapter(deps: ViemAdapterDeps): ChainAdapter {
  const { config } = deps;
  const chain = deps.chain ?? getChain(config.network);
  const urls = deps.rpcUrls ?? config.rpcUrls;
  if (urls.length === 0) {
    throw new Error('cannot build a chain adapter with no RPC endpoints');
  }
  // `fallback` moves to the next endpoint on transport errors and reorders by
  // observed latency. Mezo's public RPC landscape is variable enough that a
  // relayer pinned to one host is a single point of failure — and the failure
  // mode is "we stop paying gas for anyone".
  const transport = fallback(
    urls.map((url) => http(url, { retryCount: 2, timeout: 15_000 })),
    { rank: urls.length > 1 },
  );
  const account = privateKeyToAccount(deps.privateKey);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  const forwarder = config.forwarder;
  if (forwarder === null) {
    throw new Error('cannot build a chain adapter without a forwarder address');
  }

  const encodeExecute = (request: ForwardRequest): Hex =>
    encodeFunctionData({
      abi: FORWARDER_ABI,
      functionName: 'execute',
      args: [toOnChainRequest(request)],
    });

  return {
    account: account.address,
    chainId: chain.id,

    async balance() {
      return publicClient.getBalance({ address: account.address });
    },

    async transactionCount(address: Address) {
      // 'pending' so a restart mid-flight does not reuse a nonce that is still
      // sitting in the mempool.
      return publicClient.getTransactionCount({ address, blockTag: 'pending' });
    },

    async nonces(owner: Address) {
      return publicClient.readContract({
        address: forwarder,
        abi: FORWARDER_ABI,
        functionName: 'nonces',
        args: [owner],
      });
    },

    async hasCode(address: Address) {
      const code = await publicClient.getCode({ address });
      return code !== undefined && code !== '0x';
    },

    async verify(request) {
      return publicClient.readContract({
        address: forwarder,
        abi: FORWARDER_ABI,
        functionName: 'verify',
        args: [request],
      });
    },

    async estimateFees() {
      // Mezo's base fee is 1,300,000 wei. viem's estimator reads it from the
      // latest block rather than assuming, which keeps this correct if Mezo
      // ever changes it.
      const fees = await publicClient.estimateFeesPerGas();
      return {
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      };
    },

    async simulate(request) {
      const data = encodeExecute(request);
      // 1. eth_call — surfaces the revert reason without spending anything.
      try {
        await publicClient.call({ account: account.address, to: forwarder, data, value: 0n });
      } catch (error) {
        throw new RelayError(
          'SIMULATION_REVERTED',
          422,
          `the forwarded call reverts in simulation: ${revertDetail(error)}`,
        );
      }
      // 2. eth_estimateGas — the limit to submit with.
      let estimate: bigint;
      try {
        estimate = await publicClient.estimateGas({
          account: account.address,
          to: forwarder,
          data,
          value: 0n,
        });
      } catch (error) {
        throw new RelayError(
          'SIMULATION_REVERTED',
          422,
          `gas estimation failed: ${revertDetail(error)}`,
        );
      }
      // OpenZeppelin's forwarder checks 63/64ths of remaining gas against
      // `request.gas`, so submitting exactly the estimate can revert at the
      // boundary. 25% headroom, bounded by the per-request cap plus the same
      // margin so an operator's cap still means something.
      const buffered = (estimate * 125n) / 100n;
      const ceiling = (config.policy.maxGasPerRequest * 125n) / 100n + 100_000n;
      return buffered > ceiling ? ceiling : buffered;
    },

    async sendExecute(request, ctx, gasLimit) {
      try {
        return await walletClient.sendTransaction({
          to: forwarder,
          data: encodeExecute(request),
          value: 0n,
          gas: gasLimit,
          nonce: ctx.nonce,
          maxFeePerGas: ctx.maxFeePerGas,
          maxPriorityFeePerGas: ctx.maxPriorityFeePerGas,
        });
      } catch (error) {
        throw new RelayError('SUBMISSION_FAILED', 502, `broadcast failed: ${revertDetail(error)}`);
      }
    },

    async getReceipt(hash: Hash): Promise<ReceiptLike | null> {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        return {
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          effectiveGasPrice: receipt.effectiveGasPrice,
          from: getAddress(receipt.from),
        };
      } catch (error) {
        // viem throws TransactionReceiptNotFoundError while a tx is pending.
        // That is "no receipt yet", not an RPC failure, and the difference
        // matters to receipt.ts (R15).
        if (error instanceof BaseError && error.name === 'TransactionReceiptNotFoundError') {
          return null;
        }
        throw upstream('could not read the transaction receipt');
      }
    },
  };
}
