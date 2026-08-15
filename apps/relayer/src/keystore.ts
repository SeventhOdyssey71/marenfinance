import { readFile } from 'node:fs/promises';
import {
  createDecipheriv,
  pbkdf2 as pbkdf2Cb,
  scrypt as scryptCb,
  type BinaryLike,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';
import { keccak256, type Hex } from 'viem';

// `promisify` cannot pick the options overload of `scrypt`, so the signature is
// restated here rather than dropping the options argument — the options are what
// raise Node's 32 MiB scrypt memory ceiling for standard geth parameters.
const scrypt = promisify(scryptCb) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;
const pbkdf2 = promisify(pbkdf2Cb);

/**
 * Web3 Secret Storage v3 keystore reader — the format `cast wallet import`
 * writes to `~/.foundry/keystores/<name>`.
 *
 * Why this exists: putting a hot key in `RELAYER_PRIVATE_KEY` means the key is
 * readable by anything that can read the process environment, and it tends to end
 * up in shell history, `.env` files and CI logs. An operator who would rather
 * hold the key in a passphrase-protected keystore should not have to give that up
 * to run this service. Both paths are supported; exactly one may be configured.
 *
 * Implemented against `node:crypto` rather than pulling in a dependency for it.
 * Supports scrypt (what foundry and modern geth write) and pbkdf2 (older files).
 */

interface KeystoreV3 {
  version: number;
  crypto?: KeystoreCrypto;
  Crypto?: KeystoreCrypto;
}

interface KeystoreCrypto {
  cipher: string;
  ciphertext: string;
  cipherparams: { iv: string };
  kdf: string;
  kdfparams: Record<string, unknown>;
  mac: string;
}

export class KeystoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeystoreError';
  }
}

function hexToBuf(value: string): Buffer {
  return Buffer.from(value.replace(/^0x/, ''), 'hex');
}

function num(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new KeystoreError(`keystore kdfparams.${key} is missing or not a number`);
  }
  return value;
}

function str(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string') {
    throw new KeystoreError(`keystore kdfparams.${key} is missing or not a string`);
  }
  return value;
}

async function deriveKey(crypto: KeystoreCrypto, password: string): Promise<Buffer> {
  const params = crypto.kdfparams;
  const salt = hexToBuf(str(params, 'salt'));
  const dklen = num(params, 'dklen');
  const secret = Buffer.from(password, 'utf8');

  if (crypto.kdf === 'scrypt') {
    const N = num(params, 'n');
    const r = num(params, 'r');
    const p = num(params, 'p');
    // Node's default scrypt maxmem is 32 MiB. `cast wallet` writes N=8192, r=8,
    // which needs ~8 MiB, but geth's heavier profile (N=262144, r=8) needs
    // ~256 MiB, so size the allowance from the parameters instead of hoping.
    const maxmem = Math.max(64 * 1024 * 1024, 256 * N * r * 2);
    // OpenSSL enforces the scrypt spec bound N < 2^(128*r/8). With r=1 that
    // caps N at 65536, so a keystore written with N=262144, r=1 — including the
    // scrypt vector in the Web3 Secret Storage spec itself — cannot be derived
    // by Node at all. Say so, rather than surfacing OpenSSL's "memory limit
    // exceeded", which sends the reader looking at the wrong parameter.
    if (r < 8 && N >= 2 ** (16 * r)) {
      throw new KeystoreError(
        `keystore uses scrypt N=${N} with r=${r}; Node's OpenSSL backend requires N < 2^(16*r) = ${2 ** (16 * r)}. Re-export the key with \`cast wallet import\` (r=8).`,
      );
    }
    return scrypt(secret, salt, dklen, { N, r, p, maxmem });
  }
  if (crypto.kdf === 'pbkdf2') {
    const prf = str(params, 'prf');
    if (prf !== 'hmac-sha256') {
      throw new KeystoreError(`unsupported pbkdf2 prf ${prf}`);
    }
    const c = num(params, 'c');
    return (await pbkdf2(secret, salt, c, dklen, 'sha256')) as Buffer;
  }
  throw new KeystoreError(`unsupported keystore kdf ${crypto.kdf}`);
}

/** Decrypt a v3 keystore document into a 0x-prefixed private key. */
export async function decryptKeystore(document: unknown, password: string): Promise<Hex> {
  const parsed = document as KeystoreV3;
  const crypto = parsed.crypto ?? parsed.Crypto;
  if (parsed.version !== 3 || crypto === undefined) {
    throw new KeystoreError('not a version 3 keystore');
  }

  const derived = await deriveKey(crypto, password);
  const ciphertext = hexToBuf(crypto.ciphertext);

  // MAC covers derivedKey[16:32] || ciphertext. A wrong password fails here,
  // before any decryption output can be used.
  const mac = keccak256(
    new Uint8Array(Buffer.concat([derived.subarray(16, 32), ciphertext])),
  ).slice(2);
  if (mac !== crypto.mac.replace(/^0x/, '').toLowerCase()) {
    throw new KeystoreError('keystore MAC mismatch — wrong password or corrupt file');
  }

  if (crypto.cipher !== 'aes-128-ctr') {
    throw new KeystoreError(`unsupported keystore cipher ${crypto.cipher}`);
  }
  const decipher = createDecipheriv(
    'aes-128-ctr',
    derived.subarray(0, 16),
    hexToBuf(crypto.cipherparams.iv),
  );
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length !== 32) {
    throw new KeystoreError(`decrypted key is ${plaintext.length} bytes, expected 32`);
  }
  return `0x${plaintext.toString('hex')}`;
}

/** Read and decrypt a keystore file from disk. */
export async function loadKeystoreFile(path: string, password: string): Promise<Hex> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new KeystoreError(`cannot read keystore at ${path}`);
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new KeystoreError(`keystore at ${path} is not valid JSON`);
  }
  return decryptKeystore(document, password);
}
