import { getDeploymentBlock, getMarenAddresses, getMusdAddresses } from '@maren/sdk';
import { keccak256, parseAbi, toFunctionSelector, type Abi, type Address, type Hex } from 'viem';
import ts from 'typescript';
import { RELAYABLE_FUNCTIONS } from '../../apps/relayer/src/registry.js';

export const IDENTITY_ABI = parseAbi([
  'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)',
  'function trustedForwarder() view returns (address)',
  'function allowedCall(address target, bytes4 selector) view returns (bool)',
  'function decimals() view returns (uint8)',
]);

export interface ReadCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockNumber: bigint;
}
export interface DeploymentReader {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getCode(args: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>;
  readContract(args: ReadCall): Promise<unknown>;
}
export interface Observation {
  name: string;
  status: 'pass' | 'fail';
  detail: string;
}
const maren = getMarenAddresses('testnet');
const musd = getMusdAddresses('testnet');
const sameAddress = (actual: unknown, expected: string) =>
  typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();

export function domainMatches(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 7) return false;
  const [fields, name, version, chainId, verifyingContract, salt, extensions] = value;
  return (
    fields === '0x0f' &&
    name === 'Maren Forwarder' &&
    version === '1' &&
    chainId === 31611n &&
    sameAddress(verifyingContract, maren.marenForwarder) &&
    salt === `0x${'0'.repeat(64)}` &&
    Array.isArray(extensions) &&
    extensions.length === 0
  );
}

/** Every on-chain read uses one block; a failure never becomes an empty/zero value. */
export async function attestDeployment(reader: DeploymentReader) {
  const observations: Observation[] = [];
  const observe = async (name: string, read: () => Promise<string>) => {
    try {
      observations.push({ name, status: 'pass', detail: await read() });
    } catch (error) {
      observations.push({
        name,
        status: 'fail',
        detail: error instanceof Mismatch ? error.message : 'RPC read unavailable or undecodable',
      });
    }
  };
  let block: bigint | null = null;
  await observe('chain identity', async () => {
    requireThat((await reader.getChainId()) === 31611, 'RPC is not Mezo testnet (31611)');
    block = await reader.getBlockNumber();
    requireThat(block >= getDeploymentBlock('testnet')!, 'RPC is behind the Maren deployment');
    return `Mezo testnet at block ${block}`;
  });
  if (observations[0]?.status !== 'pass' || block === null) {
    return { passed: false, blockNumber: null, observations };
  }
  const blockNumber: bigint = block;
  const read = (address: Address, functionName: string, args?: readonly unknown[]) =>
    reader.readContract({
      address,
      abi: IDENTITY_ABI,
      functionName,
      blockNumber,
      ...(args ? { args } : {}),
    });
  // Run in small batches so public testnet RPC limits do not turn a release
  // check into its own outage. Each failure is recorded independently.
  const checks: Array<() => Promise<void>> = [];
  for (const [name, address] of Object.entries({ ...maren, musd: musd.musd })) {
    checks.push(() =>
      observe(`${name} runtime code`, async () => {
        const code = await reader.getCode({ address, blockNumber });
        requireThat(
          typeof code === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(code),
          'no deployed runtime code',
        );
        return `${(code!.length - 2) / 2} bytes; keccak256 ${keccak256(code!)}`;
      }),
    );
  }
  checks.push(() =>
    observe('forwarder EIP-712 domain', async () => {
      requireThat(
        domainMatches(await read(maren.marenForwarder, 'eip712Domain')),
        'domain differs from the client signing domain',
      );
      return 'Maren Forwarder / 1 / 31611 / configured hub; no salt or extensions';
    }),
  );
  checks.push(() =>
    observe('MUSD decimals', async () => {
      requireThat((await read(musd.musd, 'decimals')) === 18, 'MUSD is not an 18-decimal token');
      return '18';
    }),
  );
  for (const [name, address] of Object.entries(maren)) {
    if (name === 'marenForwarder') continue;
    checks.push(() =>
      observe(`${name} trusted forwarder`, async () => {
        requireThat(
          sameAddress(await read(address, 'trustedForwarder'), maren.marenForwarder),
          'target trusts a different forwarder',
        );
        return maren.marenForwarder;
      }),
    );
  }
  for (const [name, calls] of Object.entries(RELAYABLE_FUNCTIONS)) {
    for (const call of calls) {
      checks.push(() =>
        observe(`allowed ${call.id}`, async () => {
          requireThat(
            (await read(maren.marenForwarder, 'allowedCall', [
              maren[name as keyof typeof maren],
              call.selector,
            ])) === true,
            'hub refuses a selector offered by the relayer',
          );
          return call.selector;
        }),
      );
    }
  }
  for (const [target, signature] of [
    [maren.marenVault, 'deposit(address,address)'],
    [maren.marenPay, 'createLink(address,uint256,uint64,string)'],
  ] as const) {
    checks.push(() =>
      observe(`not sponsored ${signature}`, async () => {
        requireThat(
          (await read(maren.marenForwarder, 'allowedCall', [
            target,
            toFunctionSelector(signature),
          ])) === false,
          'unexpected payable/unsupported sponsorship entry',
        );
        return 'disabled';
      }),
    );
  }
  for (let i = 0; i < checks.length; i += 4)
    await Promise.all(checks.slice(i, i + 4).map((check) => check()));
  observations.sort((a, b) => a.name.localeCompare(b.name));
  return {
    passed: observations.every((o) => o.status === 'pass'),
    blockNumber: blockNumber.toString(),
    observations,
  };
}

class Mismatch extends Error {}
function requireThat(value: boolean, reason: string): asserts value {
  if (!value) throw new Mismatch(reason);
}

function swiftValues(source: string, struct: string): Record<string, string> {
  const body = source.split(`struct ${struct}:`)[1] ?? '';
  const testnet =
    body.match(new RegExp(`static let testnet = ${struct}\\(([\\s\\S]*?)\\n    \\)`))?.[1] ?? '';
  return Object.fromEntries(
    [...testnet.matchAll(/([A-Za-z][A-Za-z0-9]*):\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
}

export function attestLocalConfiguration(
  files: { swift: string; plist: string; wrangler: string },
  expectedRelayer: string,
): Observation[] {
  const observations: Observation[] = [];
  const check = (name: string, matches: boolean, detail: string) =>
    observations.push({ name, status: matches ? 'pass' : 'fail', detail });
  for (const [struct, expected] of [
    ['MarenAddresses', maren],
    [
      'MusdAddresses',
      Object.fromEntries(
        ['musd', 'troveManager', 'sortedTroves', 'hintHelpers', 'priceFeed'].map((key) => [
          key,
          musd[key as keyof typeof musd],
        ]),
      ),
    ],
  ] as const) {
    const values = swiftValues(files.swift, struct);
    for (const [key, address] of Object.entries(expected))
      check(`iOS ${key}`, sameAddress(values[key], address), `expected SDK testnet ${address}`);
  }
  const chain = files.swift.match(/static let testnet = MezoChain\(([\s\S]*?)\n    \)/)?.[1] ?? '';
  check('iOS chain ID', /chainId:\s*31611\s*,/.test(chain), 'expected 31611');
  const url = files.plist.match(/<key>MAREN_RELAYER_URL<\/key>\s*<string>([^<]*)<\/string>/)?.[1];
  check(
    'iOS relayer URL',
    url?.replace(/\/+$/, '') === expectedRelayer.replace(/\/+$/, ''),
    'must match the endpoint being checked',
  );
  const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', files.wrangler);
  const vars = parsed.error ? {} : (parsed.config?.vars ?? {});
  check('Worker network', vars.RELAYER_NETWORK === 'testnet', 'expected testnet');
  check(
    'Worker forwarder',
    sameAddress(vars.RELAYER_FORWARDER_ADDRESS, maren.marenForwarder),
    `expected ${maren.marenForwarder}`,
  );
  const targets =
    typeof vars.RELAYER_ALLOWED_TARGETS === 'string'
      ? (vars.RELAYER_ALLOWED_TARGETS.split(',') as string[])
      : [];
  const expected = ['marenPay', 'marenRegistry', 'marenVault'];
  check(
    'Worker targets',
    targets.length === expected.length &&
      expected.every(
        (name) =>
          targets.filter(
            (t) => t.toLowerCase() === `${name}:${maren[name as keyof typeof maren]}`.toLowerCase(),
          ).length === 1,
      ),
    'must match the testnet SDK and enabled relay target set',
  );
  return observations;
}

export function attestRelayerHealth(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const value = body as Record<string, unknown>;
  const expectedTargets = ['marenPay', 'marenRegistry', 'marenVault'].map((name) =>
    `${name}:${maren[name as keyof typeof maren]}`.toLowerCase(),
  );
  return (
    value.ok === true &&
    value.accepting === true &&
    value.chainId === 31611 &&
    value.network === 'testnet' &&
    sameAddress(value.forwarder, maren.marenForwarder) &&
    value.store === 'durable' &&
    typeof value.balanceWei === 'string' &&
    /^\d+$/.test(value.balanceWei) &&
    BigInt(value.balanceWei) > 0n &&
    typeof value.nonce === 'number' &&
    Number.isSafeInteger(value.nonce) &&
    value.nonce >= 0 &&
    Array.isArray(value.problems) &&
    value.problems.length === 0 &&
    Array.isArray(value.targets) &&
    value.targets.length === expectedTargets.length &&
    expectedTargets.every(
      (target) =>
        (value.targets as unknown[]).filter(
          (t) => typeof t === 'string' && t.toLowerCase() === target,
        ).length === 1,
    )
  );
}
