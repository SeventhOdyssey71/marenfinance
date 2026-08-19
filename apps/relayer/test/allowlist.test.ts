import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeFunctionData, getAddress, parseEther, toFunctionSelector } from 'viem';
import {
  buildTestRelayer,
  MAREN_VAULT,
  makeEnv,
  NOT_ALLOWLISTED,
  payCalldata,
  signedRequest,
  type ErrorBody,
} from './helpers.js';
import { RELAYABLE_FUNCTIONS, allFunctionIds, defineRelayableFunction } from '../src/registry.js';
import { loadConfig } from '../src/config.js';

/**
 * R4 — allowlist targets AND selectors.
 *
 * "A generic 'relay any call' endpoint is how R1 happens." These tests hold the
 * line in both dimensions, including the case people forget: a selector that is
 * legitimate on one Maren contract being pointed at another.
 */

describe('target and selector allowlist', () => {
  it('rejects a target that is not on the allowlist', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.post('/relay', await signedRequest({ to: NOT_ALLOWLISTED }));

    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toBe('TARGET_NOT_ALLOWED');
    expect(relayer.chainFake.sent).toHaveLength(0);
    expect(relayer.chainFake.simulations).toBe(0);
  });

  it('rejects an unknown selector on an allowlisted target', async () => {
    const relayer = await buildTestRelayer();
    // A perfectly real ERC-20 call. Real, and not ours.
    const data = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'transferFrom',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ],
      args: [
        getAddress('0x5555555555555555555555555555555555555555'),
        getAddress('0x6666666666666666666666666666666666666666'),
        parseEther('1'),
      ],
    });
    const response = await relayer.post('/relay', await signedRequest({ data }));

    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toBe('SELECTOR_NOT_ALLOWED');
    expect(body.meta['selector']).toBe(
      toFunctionSelector('function transferFrom(address,address,uint256)'),
    );
    expect(relayer.chainFake.sent).toHaveLength(0);
  });

  it('scopes selectors per target: a MarenPay function is not relayable on MarenVault', async () => {
    const relayer = await buildTestRelayer();
    // Both addresses are allowlisted, and both contracts have relayable functions of
    // their own. The pairing is what is refused.
    const response = await relayer.post(
      '/relay',
      await signedRequest({ to: MAREN_VAULT, data: payCalldata() }),
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error).toBe('SELECTOR_NOT_ALLOWED');
  });

  it('rejects calldata too short to contain a selector', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.post('/relay', await signedRequest({ data: '0xdead' }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error).toBe('MALFORMED_REQUEST');
  });

  it('rejects a gas limit above the per-request cap', async () => {
    const relayer = await buildTestRelayer(makeEnv({ RELAYER_MAX_GAS_PER_REQUEST: '150000' }));
    const response = await relayer.post('/relay', await signedRequest({ gas: 900_000n }));
    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error).toBe('GAS_LIMIT_TOO_HIGH');
  });

  it('never relays to the forwarder itself', () => {
    expect(RELAYABLE_FUNCTIONS.marenForwarder).toHaveLength(0);
  });

  /**
   * THE REGISTRY MATCHES WHAT THE HUB WILL ACTUALLY FORWARD.
   *
   * `MarenRelayHub` keeps its own `allowedCall[target][selector]` map, written by
   * `_allowlistRelayableCalls` in `script/Deploy.s.sol`, and it checks it on the
   * inherited `execute` as well as on `executeWithFee`. A selector this service admits
   * but the hub refuses gets as far as simulation and reverts `CallNotAllowed` — safe,
   * and still a service advertising a sponsorship the chain will not honour.
   *
   * This reads the deploy script rather than a transcription of it, so adding a selector
   * on one side and not the other fails here. The registry may be NARROWER than the hub
   * (a call the hub would forward that this relayer chooses not to pay for is a policy
   * decision), never wider.
   */
  it('admits nothing MarenRelayHub would refuse on-chain', () => {
    const script = readFileSync(
      new URL('../../../packages/contracts/script/Deploy.s.sol', import.meta.url),
      'utf8',
    );
    const onChain = new Map<string, Set<string>>();
    for (const [, contract, name] of script.matchAll(
      /\bMaren(Registry|Pay|Vault|Earn)\.(\w+)\.selector\b/g,
    )) {
      const key = `maren${contract!}`;
      if (!onChain.has(key)) onChain.set(key, new Set());
      onChain.get(key)!.add(name!);
    }
    // Guard the parse itself: an empty match set would make every assertion below pass.
    expect(onChain.get('marenPay')?.size).toBeGreaterThan(5);
    expect(onChain.get('marenVault')?.has('borrow')).toBe(true);
    // MarenVault.deposit is payable, so it is absent from the script by design.
    expect(onChain.get('marenVault')?.has('deposit')).toBe(false);

    for (const [contract, functions] of Object.entries(RELAYABLE_FUNCTIONS)) {
      for (const fn of functions) {
        expect({ contract, name: fn.abi.name, allowedOnChain: true }).toEqual({
          contract,
          name: fn.abi.name,
          allowedOnChain: onChain.get(contract)?.has(fn.abi.name) === true,
        });
      }
    }
  });

  /**
   * THE SELECTORS MATCH THE SOLIDITY, NOT JUST THE FUNCTION NAMES.
   *
   * The test above reads `Deploy.s.sol` and checks that every id this relayer
   * admits is one the hub is allowlisted for. It compares NAMES, because that is
   * all `MarenPay.pay.selector` gives it — and the drift it was written for was
   * not a name drift. Every entry in `registry.ts` carried a trailing
   * `uint256 relayFee` the contracts never had. The names were all correct. The
   * SIGNATURES were all wrong, so every selector was wrong, so every relay
   * request the web app could send was destined for SELECTOR_NOT_ALLOWED. The
   * name-only test would have passed against that file unchanged.
   *
   * So this one reads the parameter lists out of `packages/contracts/src/*.sol`
   * and holds them against the ABI the registry parses. A parameter added,
   * removed, renamed, reordered or retyped moves the selector, and moves this.
   *
   * Struct parameters are compared by position and name only: `payWithPermit2`
   * takes an `IPermit2.PermitTransferFrom` that the registry spells out as a
   * tuple, and resolving a struct's fields from source is a Solidity parser this
   * test has no business being. That is the one gap left, and it is a field
   * inside one struct rather than a whole file of guesses.
   */
  it('every registered signature matches the parameter list in the Solidity', () => {
    const sources: Record<string, string> = {};
    for (const [key, file] of [
      ['marenPay', 'MarenPay'],
      ['marenRegistry', 'MarenRegistry'],
      ['marenVault', 'MarenVault'],
      ['marenEarn', 'MarenEarn'],
    ] as const) {
      sources[key] = readFileSync(
        new URL(`../../../packages/contracts/src/${file}.sol`, import.meta.url),
        'utf8',
      );
    }

    /** `type name` pairs for one externally callable function, or null. */
    const declaredParams = (
      source: string,
      name: string,
    ): Array<{ type: string; name: string }> | null => {
      const declaration = new RegExp(
        `\\bfunction\\s+${name}\\s*\\(([^()]*)\\)\\s*(?:external|public)\\b`,
      ).exec(source);
      if (declaration === null) return null;
      const body = declaration[1]!.trim();
      if (body === '') return [];
      return body.split(',').map((entry) => {
        const words = entry.trim().split(/\s+/);
        return { type: words[0]!, name: words[words.length - 1]! };
      });
    };

    // Guard the parse itself. A regex that matches nothing would make every
    // assertion below vacuous, which is how the drift got in the first time.
    expect(declaredParams(sources['marenPay']!, 'pay')).toEqual([
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'amount' },
      { type: 'string', name: 'memo' },
    ]);
    expect(declaredParams(sources['marenVault']!, 'closePosition')).toHaveLength(2);
    expect(declaredParams(sources['marenPay']!, 'thisDoesNotExist')).toBeNull();

    for (const [contract, functions] of Object.entries(RELAYABLE_FUNCTIONS)) {
      const source = sources[contract];
      if (source === undefined) continue; // marenForwarder has no relayable calls
      for (const fn of functions) {
        const declared = declaredParams(source, fn.abi.name);
        expect({ fn: fn.id, declared: declared !== null }).toEqual({
          fn: fn.id,
          declared: true,
        });
        expect({ fn: fn.id, params: declared!.map((p) => p.name) }).toEqual({
          fn: fn.id,
          params: fn.abi.inputs.map((input) => input.name),
        });
        for (const [index, input] of fn.abi.inputs.entries()) {
          const solidityType = declared![index]!.type;
          // A struct parameter reaches the ABI as a tuple; anything else must be
          // the same type on both sides or the selector differs.
          const expected = input.type.startsWith('tuple') ? solidityType : input.type;
          expect({ fn: fn.id, param: input.name, type: solidityType }).toEqual({
            fn: fn.id,
            param: input.name,
            type: expected,
          });
        }
      }
    }
  });

  /**
   * The old invariant — "every relayable function MUST take a trailing
   * `uint256 relayFee`" — is withdrawn. `ERC2771Forwarder.executeBatch`'s
   * `atomic` flag covers validation only, so a batched fee leg settles even when
   * the work leg reverts; the replacement is `MarenRelayHub`, which takes the fee
   * and calls the target in one atomic forwarded call. See registry.ts.
   *
   * What still MUST hold is the R2 property underneath it: if a fee is declared,
   * it is a real `uint256` we can actually read out of the signed payload. A
   * parameter that is signed but not enforceable is the shape R13 forbids.
   */
  it('a declared relay fee is a readable uint256, or there is none at all', () => {
    for (const [, functions] of Object.entries(RELAYABLE_FUNCTIONS)) {
      for (const fn of functions) {
        if (fn.feeArgIndex === null) continue;
        const feeInput = fn.abi.inputs[fn.feeArgIndex];
        expect(feeInput?.name).toBe('relayFee');
        expect(feeInput?.type).toBe('uint256');
      }
    }
  });

  it('accepts a relayable function that declares no fee argument', () => {
    // The real contracts will not carry a trailing relayFee — the hub does.
    // Registering one must not throw at module load any more.
    const defined = defineRelayableFunction(
      'marenPay',
      'function pay(address to, uint256 amount, string memo)',
    );
    expect(defined.feeArgIndex).toBeNull();
    expect(defined.selector).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it('still rejects a relayFee of the wrong type', () => {
    // A `relayFee` we would decode into something that is not an amount is worse
    // than no fee at all, because it looks enforced.
    expect(() =>
      defineRelayableFunction('marenPay', 'function pay(address to, string relayFee)'),
    ).toThrow(/must be uint256/);
  });

  describe('configuration can only narrow the code-level registry', () => {
    it('narrows to the named functions', () => {
      const { config, problems } = loadConfig(
        makeEnv({ RELAYER_ALLOWED_FUNCTIONS: 'marenPay.pay' }),
      );
      expect(problems).toHaveLength(0);
      const target = [...config.targets.values()].find((t) => t.name === 'marenPay');
      expect(target?.functions.size).toBe(1);
    });

    it('cannot widen: naming a function outside the registry is a problem', () => {
      const { problems } = loadConfig(
        makeEnv({ RELAYER_ALLOWED_FUNCTIONS: 'marenPay.drainEverything' }),
      );
      expect(problems.join('\n')).toMatch(/not a relayable function/);
    });

    it('an empty narrowing list allows nothing', async () => {
      const relayer = await buildTestRelayer(makeEnv({ RELAYER_ALLOWED_FUNCTIONS: '' }));
      expect(relayer.service.accepting).toBe(false);
      const response = await relayer.post('/relay', await signedRequest());
      expect(response.status).toBe(503);
    });

    it('the registry is a closed, non-empty set', () => {
      const ids = allFunctionIds();
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
