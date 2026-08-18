import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from '../src/config.js';
import { resolvePrivateKey } from '../src/chain.js';
import { readPassphraseFile, secretFileModeWarning, KeystoreError } from '../src/keystore.js';
import { makeEnv } from './helpers.js';

/**
 * How the hot key reaches this process.
 *
 * The preferred mode is a keystore file plus a PASSPHRASE FILE, which is the
 * pattern the rest of this repo uses for deploy keys. The point is not
 * aesthetic: an environment variable is readable from `/proc/<pid>/environ`,
 * from `docker inspect`, from a process listing on some systems, and from
 * anything that serialises the environment into a crash report. A file is not.
 *
 * `RELAYER_PRIVATE_KEY` still works, because a developer running `pnpm dev`
 * against anvil should not have to manage a keystore. It is demoted rather than
 * removed: warned about at every boot, reported on `/healthz`, and refused
 * outright on mainnet.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/cast-wallet-keystore.json', import.meta.url));
const FIXTURE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const FIXTURE_PASSPHRASE = 'testpassword';

async function tempFile(name: string, contents: string, mode = 0o600): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'maren-relayer-'));
  const path = join(dir, name);
  await writeFile(path, contents);
  await chmod(path, mode);
  return path;
}

describe('keystore passphrase files', () => {
  it('reads a passphrase and unlocks a real `cast wallet` keystore with it', async () => {
    const passwordFile = await tempFile('passphrase', FIXTURE_PASSPHRASE);
    const { config, problems } = loadConfig(
      makeEnv({
        RELAYER_PRIVATE_KEY: undefined,
        RELAYER_KEYSTORE_PATH: FIXTURE,
        RELAYER_KEYSTORE_PASSWORD_FILE: passwordFile,
      }),
    );
    expect(problems).toEqual([]);
    expect(config.key?.kind).toBe('keystore-file');

    const key = await resolvePrivateKey(config);
    expect(key).toBe(FIXTURE_KEY);
    expect(privateKeyToAccount(key).address).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  });

  it('strips exactly one trailing newline, because `echo` writes one', async () => {
    const withNewline = await tempFile('passphrase', `${FIXTURE_PASSPHRASE}\n`);
    expect(await readPassphraseFile(withNewline)).toBe(FIXTURE_PASSPHRASE);

    const withCrlf = await tempFile('passphrase', `${FIXTURE_PASSPHRASE}\r\n`);
    expect(await readPassphraseFile(withCrlf)).toBe(FIXTURE_PASSPHRASE);
  });

  it('preserves everything else, including a passphrase that ends in a space', async () => {
    // Trimming all trailing whitespace would silently mangle this one, and the
    // operator would go looking at the keystore after seeing a MAC mismatch.
    const path = await tempFile('passphrase', 'a passphrase ending in a space \n');
    expect(await readPassphraseFile(path)).toBe('a passphrase ending in a space ');

    const twoNewlines = await tempFile('passphrase', 'secret\n\n');
    expect(await readPassphraseFile(twoNewlines)).toBe('secret\n');
  });

  it('says the file is empty rather than trying an empty passphrase', async () => {
    // An empty passphrase fails at the MAC, which reads as "wrong password" and
    // sends the reader looking in the wrong place.
    const empty = await tempFile('passphrase', '\n');
    await expect(readPassphraseFile(empty)).rejects.toThrow(/is empty/);
    await expect(readPassphraseFile(empty)).rejects.toBeInstanceOf(KeystoreError);
  });

  it('names the passphrase file when it cannot be read', async () => {
    await expect(readPassphraseFile('/nonexistent/passphrase')).rejects.toThrow(
      /cannot read the keystore passphrase file at \/nonexistent\/passphrase/,
    );
  });

  it('never puts the passphrase or the key into an error message', async () => {
    const passwordFile = await tempFile('passphrase', 'the-wrong-passphrase');
    const { config } = loadConfig(
      makeEnv({
        RELAYER_PRIVATE_KEY: undefined,
        RELAYER_KEYSTORE_PATH: FIXTURE,
        RELAYER_KEYSTORE_PASSWORD_FILE: passwordFile,
      }),
    );
    const error = await resolvePrivateKey(config).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toMatch(/MAC mismatch/);
    expect(message).not.toContain('the-wrong-passphrase');
    expect(message).not.toContain(FIXTURE_KEY.slice(2));
  });

  it('warns about a secret file other users can read, and stays quiet about a 600 one', async () => {
    const loose = await tempFile('passphrase', FIXTURE_PASSPHRASE, 0o644);
    expect(await secretFileModeWarning(loose, 'the keystore passphrase file')).toMatch(
      /readable by other users/,
    );

    const tight = await tempFile('passphrase', FIXTURE_PASSPHRASE, 0o600);
    expect(await secretFileModeWarning(tight, 'the keystore passphrase file')).toBeNull();

    // A file that cannot be stat'ed is somebody else's error to report.
    expect(await secretFileModeWarning('/nonexistent/passphrase', 'x')).toBeNull();
  });
});

describe('key source resolution', () => {
  const noKey = { RELAYER_PRIVATE_KEY: undefined } as const;

  it('prefers the passphrase file and does not warn about it', () => {
    const { config, warnings, problems } = loadConfig(
      makeEnv({
        ...noKey,
        RELAYER_KEYSTORE_PATH: '/keys/relayer',
        RELAYER_KEYSTORE_PASSWORD_FILE: '/keys/relayer.pass',
      }),
    );
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
    expect(config.key).toEqual({
      kind: 'keystore-file',
      path: '/keys/relayer',
      passwordFile: '/keys/relayer.pass',
    });
  });

  it('accepts a passphrase in the environment, and says why that is second best', () => {
    const { config, warnings, problems } = loadConfig(
      makeEnv({
        ...noKey,
        RELAYER_KEYSTORE_PATH: '/keys/relayer',
        RELAYER_KEYSTORE_PASSWORD: 'hunter2',
      }),
    );
    expect(problems).toEqual([]);
    expect(config.key?.kind).toBe('keystore');
    expect(warnings.join('\n')).toMatch(/RELAYER_KEYSTORE_PASSWORD_FILE is the preferred mode/);
    // The value itself is never echoed back into a warning.
    expect(warnings.join('\n')).not.toContain('hunter2');
  });

  it('refuses two passphrase sources rather than picking one', () => {
    const { config, problems } = loadConfig(
      makeEnv({
        ...noKey,
        RELAYER_KEYSTORE_PATH: '/keys/relayer',
        RELAYER_KEYSTORE_PASSWORD: 'hunter2',
        RELAYER_KEYSTORE_PASSWORD_FILE: '/keys/relayer.pass',
      }),
    );
    expect(config.key).toBeNull();
    expect(problems.join('\n')).toMatch(/both set/);
  });

  it('refuses a private key and a keystore together', () => {
    const { config, problems } = loadConfig(
      makeEnv({
        RELAYER_KEYSTORE_PATH: '/keys/relayer',
        RELAYER_KEYSTORE_PASSWORD_FILE: '/keys/relayer.pass',
      }),
    );
    expect(config.key).toBeNull();
    expect(problems.join('\n')).toMatch(/set exactly one/);
  });

  it('names the real mistake when a passphrase is set with no keystore path', () => {
    // Without this the operator is told "no signing key configured" while
    // looking straight at a passphrase variable they can see they set.
    const { problems } = loadConfig(
      makeEnv({ ...noKey, RELAYER_KEYSTORE_PASSWORD_FILE: '/keys/relayer.pass' }),
    );
    expect(problems.join('\n')).toMatch(/RELAYER_KEYSTORE_PATH is not/);
  });

  it('says which of the two keystore variables is missing', () => {
    const { problems } = loadConfig(makeEnv({ ...noKey, RELAYER_KEYSTORE_PATH: '/keys/relayer' }));
    expect(problems.join('\n')).toMatch(/RELAYER_KEYSTORE_PASSWORD_FILE \(preferred\)/);
  });

  it('warns loudly about a raw key in the environment, without blocking development', () => {
    const { config, warnings, problems } = loadConfig(makeEnv());
    expect(problems).toEqual([]);
    expect(config.key?.kind).toBe('env');
    expect(warnings.join('\n')).toMatch(/DEVELOPMENT-ONLY/);
    expect(warnings.join('\n')).toMatch(/RELAYER_KEYSTORE_PASSWORD_FILE/);
  });

  it('never echoes the private key, even when it is malformed', () => {
    const { config, problems } = loadConfig(makeEnv({ RELAYER_PRIVATE_KEY: '0xdefinitelynothex' }));
    expect(config.key).toBeNull();
    expect(problems.join('\n')).toMatch(/not a 32-byte/);
    expect(problems.join('\n')).not.toContain('definitelynothex');
  });

  it('REFUSES a raw environment key on mainnet', () => {
    // A key that was "only meant to be temporary" holding real BTC is the shape
    // this prevents, and there is no signal after boot that would surface it.
    const { config, problems } = loadConfig(
      makeEnv({ RELAYER_NETWORK: 'mainnet', RELAYER_FORWARDER_ADDRESS: `0x${'11'.repeat(20)}` }),
    );
    expect(config.key).toBeNull();
    expect(problems.join('\n')).toMatch(
      /development-only key mode and is not permitted on mainnet/,
    );
    // And it points at both the fix and the gate that is still not built.
    expect(problems.join('\n')).toMatch(/KMS\/HSM/);
  });

  it('allows a keystore on mainnet, which is the mode that is meant to be used there', () => {
    const { config, problems } = loadConfig(
      makeEnv({
        ...noKey,
        RELAYER_NETWORK: 'mainnet',
        RELAYER_FORWARDER_ADDRESS: `0x${'11'.repeat(20)}`,
        RELAYER_KEYSTORE_PATH: '/keys/relayer',
        RELAYER_KEYSTORE_PASSWORD_FILE: '/keys/relayer.pass',
      }),
    );
    expect(config.key?.kind).toBe('keystore-file');
    expect(problems).toEqual([]);
  });

  it('still refuses to relay with no key at all', () => {
    const { config, problems } = loadConfig(makeEnv({ ...noKey }));
    expect(config.key).toBeNull();
    expect(problems.join('\n')).toMatch(/no signing key configured/);
  });
});
