import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { decryptKeystore, KeystoreError, loadKeystoreFile } from '../src/keystore.js';

/**
 * Keystore loading.
 *
 * The scrypt case is checked against a keystore produced by the real tool an
 * operator would use:
 *
 *   cast wallet import maren-relayer-test \
 *     --private-key 0x59c6...690d --keystore-dir test/fixtures \
 *     --unsafe-password testpassword
 *
 * Encrypting with our own code and decrypting it again would prove nothing about
 * interoperability with foundry, which is the entire reason this path exists.
 * The key inside the fixture is anvil's published account #1 — worthless, and
 * deliberately not a key that could ever hold funds.
 *
 * The pbkdf2 case uses the canonical vector from the Web3 Secret Storage
 * specification.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/cast-wallet-keystore.json', import.meta.url));
const FIXTURE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const FIXTURE_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

/** Web3 Secret Storage spec, pbkdf2 vector. password "testpassword". */
const PBKDF2_VECTOR = {
  crypto: {
    cipher: 'aes-128-ctr',
    cipherparams: { iv: '6087dab2f9fdbbfaddc31a909735c1e6' },
    ciphertext: '5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46',
    kdf: 'pbkdf2',
    kdfparams: {
      c: 262144,
      dklen: 32,
      prf: 'hmac-sha256',
      salt: 'ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd',
    },
    mac: '517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2',
  },
  id: '3198bc9c-6672-5ab3-d995-4942343ae5b6',
  version: 3,
};
const PBKDF2_KEY = '0x7a28b5ba57c53603b0b07b56bba752f7784bf506fa95edc395f5cf6c7514fe9d';

describe('cast wallet keystore support', () => {
  it('decrypts a keystore written by `cast wallet import`', async () => {
    const key = await loadKeystoreFile(FIXTURE, 'testpassword');
    expect(key).toBe(FIXTURE_KEY);
    expect(privateKeyToAccount(key).address).toBe(FIXTURE_ADDRESS);
  });

  it('decrypts the pbkdf2 vector from the Web3 Secret Storage spec', async () => {
    expect(await decryptKeystore(PBKDF2_VECTOR, 'testpassword')).toBe(PBKDF2_KEY);
  });

  it('rejects a wrong password at the MAC, before decrypting anything', async () => {
    const document = JSON.parse(await readFile(FIXTURE, 'utf8')) as unknown;
    await expect(decryptKeystore(document, 'not-the-password')).rejects.toBeInstanceOf(
      KeystoreError,
    );
    await expect(decryptKeystore(document, 'not-the-password')).rejects.toThrow(/MAC mismatch/);
  });

  it('rejects a document that is not a v3 keystore', async () => {
    await expect(decryptKeystore({ version: 1 }, 'x')).rejects.toThrow(/version 3/);
  });

  it('rejects an unsupported kdf rather than guessing', async () => {
    const document = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
      crypto: Record<string, unknown>;
    };
    document.crypto['kdf'] = 'argon2id';
    await expect(decryptKeystore(document, 'testpassword')).rejects.toThrow(
      /unsupported keystore kdf/,
    );
  });

  it('explains the OpenSSL N < 2^(16r) bound instead of leaking a memory error', async () => {
    // These are the parameters of the *scrypt* vector in the Web3 Secret Storage
    // spec (N=262144, r=1). Node's OpenSSL backend cannot derive them at any
    // maxmem, so we detect it and say which parameter is the problem.
    const document = {
      version: 3,
      crypto: {
        cipher: 'aes-128-ctr',
        cipherparams: { iv: '83dbcc02d8ccb40e466191a123791e0e' },
        ciphertext: 'd172bf743a674da9cdad04534d56926ef8358534d458fffccd4e6ad2fbde479c',
        kdf: 'scrypt',
        kdfparams: {
          dklen: 32,
          n: 262144,
          p: 8,
          r: 1,
          salt: 'ab0c7876052600dd703518d6fc3fe8984592145b591fc8fb5c6d43190334ba19',
        },
        mac: '2103ac29920d71da29f15d75b4a16dbe95cfd7ff8faea1056c33131d846e3097',
      },
    };
    await expect(decryptKeystore(document, 'testpassword')).rejects.toThrow(/N < 2\^\(16\*r\)/);
  });

  it('reports a missing file clearly', async () => {
    await expect(loadKeystoreFile('/nonexistent/keystore.json', 'x')).rejects.toThrow(
      /cannot read keystore/,
    );
  });
});
