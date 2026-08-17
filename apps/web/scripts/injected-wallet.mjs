/**
 * A real signer inside a Playwright page.
 *
 * The dApp's write paths cannot be exercised by a browser with no wallet in it — every
 * button is disabled, which is correct behaviour and useless for testing. Rather than
 * mock a wallet (this repo has just finished deleting its last mock), this installs a
 * genuine EIP-1193 provider at `window.ethereum` whose `eth_sendTransaction` is signed by
 * a real private key and broadcast to a real node.
 *
 * HOW THE HALVES SPLIT. Key material never enters the page: signing happens in Node,
 * through viem, behind a Playwright binding. The in-page provider is a thin shim that
 * forwards reads straight to the RPC over `fetch` and forwards writes to that binding. So
 * the page sees exactly the interface MetaMask would present, and the browser process
 * never holds anything worth stealing.
 *
 * WHAT THIS IS NOT. It is not a stub: `eth_call`, `eth_getLogs`, `eth_estimateGas` and
 * everything else go to the real Mezo RPC, and a transaction sent through it is a
 * transaction on matsnet with a hash anybody can look up. If a contract would revert, it
 * reverts here.
 */

import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Install the provider.
 *
 * @param {import('playwright-core').BrowserContext} context
 * @param {{ privateKey: `0x${string}`, chain: import('viem').Chain, rpcUrl: string }} options
 * @returns {Promise<{ address: `0x${string}`, sent: string[] }>}
 */
export async function installWallet(context, { privateKey, chain, rpcUrl }) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  /** Every hash this wallet has broadcast, in order. The proof harness reads this. */
  const sent = [];

  // Signing lives here, in Node. The page can ask for a signature; it can never read the
  // key that produces one.
  await context.exposeBinding('__marenSendTransaction', async (_source, tx) => {
    const request = {
      to: tx.to ?? undefined,
      data: tx.data ?? undefined,
      value: tx.value ? BigInt(tx.value) : undefined,
      gas: tx.gas ? BigInt(tx.gas) : undefined,
    };
    const hash = await wallet.sendTransaction(request);
    sent.push(hash);
    return hash;
  });

  await context.exposeBinding('__marenSignMessage', async (_source, message) =>
    wallet.signMessage({ message }),
  );

  await context.addInitScript(
    ({ address, chainIdHex, rpc }) => {
      const listeners = new Map();

      const rpcCall = async (method, params) => {
        const response = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? [] }),
        });
        const json = await response.json();
        if (json.error) {
          // Re-thrown with the node's own code and data so viem's error decoding — the
          // thing this app leans on to turn a revert into a sentence — sees exactly what
          // it would see through a real wallet.
          const error = new Error(json.error.message);
          error.code = json.error.code;
          error.data = json.error.data;
          throw error;
        }
        return json.result;
      };

      const provider = {
        isMetaMask: true,
        isMaren: true,

        async request({ method, params }) {
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [address];
            case 'eth_chainId':
              return chainIdHex;
            case 'net_version':
              return String(parseInt(chainIdHex, 16));
            case 'wallet_switchEthereumChain':
            case 'wallet_addEthereumChain':
              // Already on the only chain this provider serves.
              return null;
            case 'eth_sendTransaction': {
              const tx = params[0];
              return window.__marenSendTransaction({
                to: tx.to ?? null,
                data: tx.data ?? null,
                value: tx.value ?? null,
                gas: tx.gas ?? null,
              });
            }
            case 'personal_sign':
              return window.__marenSignMessage(params[0]);
            default:
              return rpcCall(method, params);
          }
        },

        on(event, handler) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(handler);
          return provider;
        },
        removeListener(event, handler) {
          listeners.get(event)?.delete(handler);
          return provider;
        },
      };

      window.ethereum = provider;

      // EIP-6963. wagmi's injected connector discovers providers this way in preference
      // to `window.ethereum`, and a provider that only does the latter is found late or
      // not at all.
      const info = {
        uuid: '11111111-2222-3333-4444-555555555555',
        name: 'Maren Test Signer',
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
        rdns: 'finance.maren.test',
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: Object.freeze({ info, provider }),
          }),
        );
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    },
    {
      address: account.address,
      chainIdHex: `0x${chain.id.toString(16)}`,
      rpc: rpcUrl,
    },
  );

  return { address: account.address, sent, publicClient };
}

/**
 * A signer that can read everything and sign nothing.
 *
 * WHY THIS EXISTS. The claim the preflight work has to prove is a NEGATIVE: with the
 * pooled trove at 151%, no signature is ever requested for a borrow. A wallet holding a
 * real private key cannot prove that, because a wallet holding a real private key can
 * always sign — the most it can show is that it happened not to. This one is structurally
 * incapable of it. Every signing method throws, and every attempt is recorded, so "no
 * signature was requested" is measured rather than asserted.
 *
 * It impersonates a real address on a real chain. `eth_accounts` returns it, and every
 * read — `eth_call`, `eth_getBalance`, `eth_getLogs`, the lot — goes to Mezo's own RPC
 * against that account's genuine state. The app cannot tell the difference until it asks
 * for a signature, which is precisely the moment we want to observe.
 *
 * `respondWithHash` is the one exception and it is for SCREENSHOTS ONLY. When set,
 * `eth_sendTransaction` still records the attempt and still broadcasts nothing — it
 * returns the hash of a transaction that is ALREADY on matsnet, so the sheet's pending and
 * settled states render against a real receipt, a real block number and a real gas figure.
 * Nothing is fabricated and nothing is sent; the only fiction is that this click is what
 * produced that transaction. Any script using it must say so in its output.
 *
 * @param {import('playwright-core').BrowserContext} context
 * `signDelayMs` holds the wallet "open" before it answers, so the state where a user is
 * looking at their wallet can be photographed. It changes how long the refusal takes, not
 * whether it is a refusal.
 *
 * @param {{ address: `0x${string}`, chain: import('viem').Chain, rpcUrl: string, respondWithHash?: `0x${string}`, signDelayMs?: number }} options
 * @returns {Promise<{ address: `0x${string}`, signatureRequests: Array<{method: string, at: number}>, sent: string[] }>}
 */
export async function installReadOnlyWallet(
  context,
  { address, chain, rpcUrl, respondWithHash = null, signDelayMs = 0 },
) {
  /** Every time the page asked this wallet to sign anything. The proof reads this. */
  const signatureRequests = [];
  const sent = [];

  await context.exposeBinding('__marenSigningRequested', async (_source, method) => {
    signatureRequests.push({ method, at: Date.now() });
    if (signDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, signDelayMs));
    if (method === 'eth_sendTransaction' && respondWithHash) {
      sent.push(respondWithHash);
      return respondWithHash;
    }
    return null;
  });

  await context.addInitScript(
    ({ address, chainIdHex, rpc }) => {
      const listeners = new Map();

      const rpcCall = async (method, params) => {
        const response = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? [] }),
        });
        const json = await response.json();
        if (json.error) {
          const error = new Error(json.error.message);
          error.code = json.error.code;
          error.data = json.error.data;
          throw error;
        }
        return json.result;
      };

      const SIGNING = new Set([
        'eth_sendTransaction',
        'eth_sendRawTransaction',
        'eth_sign',
        'eth_signTypedData',
        'eth_signTypedData_v4',
        'personal_sign',
      ]);

      const provider = {
        isMetaMask: true,
        isMaren: true,

        async request({ method, params }) {
          if (SIGNING.has(method)) {
            const answer = await window.__marenSigningRequested(method);
            if (answer) return answer;
            // EIP-1193 4001. The app decodes this through `isUserRejection`, so the sheet
            // reports a declined signature rather than an unexplained failure.
            const error = new Error('This signer is read-only and cannot sign.');
            error.code = 4001;
            throw error;
          }
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [address];
            case 'eth_chainId':
              return chainIdHex;
            case 'net_version':
              return String(parseInt(chainIdHex, 16));
            case 'wallet_switchEthereumChain':
            case 'wallet_addEthereumChain':
              return null;
            default:
              return rpcCall(method, params);
          }
        },

        on(event, handler) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(handler);
          return provider;
        },
        removeListener(event, handler) {
          listeners.get(event)?.delete(handler);
          return provider;
        },
      };

      window.ethereum = provider;

      const info = {
        uuid: '11111111-2222-3333-4444-555555555556',
        name: 'Maren Read-Only Signer',
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
        rdns: 'finance.maren.readonly',
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: Object.freeze({ info, provider }),
          }),
        );
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    },
    { address, chainIdHex: `0x${chain.id.toString(16)}`, rpc: rpcUrl },
  );

  return { address, signatureRequests, sent };
}

/**
 * Click through the app's connect menu.
 *
 * Kept here so both the behaviour checks and the on-chain proof connect the same way, and
 * a change to the wallet menu breaks one obvious place rather than several scripts.
 *
 * @param {import('playwright-core').Page} page
 */
export async function connectWallet(page) {
  // wagmi's injected connector reconnects on its own when the provider is already
  // present and `shimDisconnect` remembers the session, so by the time this runs the
  // connect button is often gone. That is a connected wallet, not a failure.
  const alreadyOn = await page.locator('header .num').count();
  if (alreadyOn > 0) return true;

  const connect = page.getByRole('button', { name: /Connect wallet/ }).first();
  if ((await connect.count()) === 0) return false;
  await connect.click();
  const option = page.getByRole('menuitem').first();
  await option.waitFor({ state: 'visible', timeout: 5_000 });
  await option.click();
  // The account pill replaces the connect button once wagmi has the account.
  await page.waitForTimeout(1_500);
  return true;
}
