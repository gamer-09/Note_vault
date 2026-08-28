/*
 * © 2026 gamer-09. All rights reserved.
 * This code is proprietary. Unauthorized copying, modification,
 * distribution, or use of this software is strictly prohibited.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createVaultConfig,
  decryptBytes,
  deriveVaultKey,
  encryptBytes,
  textToBytes,
  unlockVault,
} from './crypto';
import { deleteMeta, getMeta, setMeta } from './db';

const PASSPHRASE = 'correct horse battery staple';

function containsReference(value, target, seen = new Set()) {
  if (value === target) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).some((key) => containsReference(value[key], target, seen));
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('vault cryptography — adversarial behavior', () => {
  it('fails closed for a wrong passphrase without exposing partial verification data', async () => {
    const { config } = await createVaultConfig(PASSPHRASE);
    const originalCheck = new Uint8Array(config.check.cipher).slice();

    await expect(unlockVault('definitely-wrong', config)).resolves.toBeNull();

    // Failed unlocks and malformed checks deliberately have the same public result.
    const malformed = { ...config, check: { ...config.check, cipher: new Uint8Array([1, 2, 3]).buffer } };
    await expect(unlockVault(PASSPHRASE, malformed)).resolves.toBeNull();
    expect(Array.from(new Uint8Array(config.check.cipher))).toEqual(Array.from(originalCheck));
    expect(JSON.stringify(config)).not.toContain(PASSPHRASE);
    expect(config).not.toHaveProperty('passphrase');
    expect(config).not.toHaveProperty('key');
  });

  it('rejects a one-byte ciphertext modification through the AES-GCM authentication tag', async () => {
    const { key, config } = await createVaultConfig(PASSPHRASE);
    const envelope = await encryptBytes(key, textToBytes('high-value private content'));
    const tamperedCipher = new Uint8Array(envelope.cipher).slice();
    tamperedCipher[Math.floor(tamperedCipher.length / 2)] ^= 0x01;

    let error;
    try {
      await decryptBytes(key, { ...envelope, cipher: tamperedCipher });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(error.name).toBe('OperationError');

    const tamperedCheck = new Uint8Array(config.check.cipher).slice();
    tamperedCheck[tamperedCheck.length - 1] ^= 0x80;
    await expect(unlockVault(PASSPHRASE, {
      ...config,
      check: { ...config.check, cipher: tamperedCheck },
    })).resolves.toBeNull();
  });

  it('keeps the non-extractable CryptoKey out of localStorage, sessionStorage, and IndexedDB', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const { key, config } = await createVaultConfig(PASSPHRASE);

    expect(key.extractable).toBe(false);
    expect(key.usages).toEqual(['encrypt', 'decrypt']);

    // This mirrors the only persisted vault setup path used by the application.
    await setMeta('vaultConfig', config);
    const persisted = await getMeta('vaultConfig');

    expect(storageWrite).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(persisted).not.toHaveProperty('key');
    expect(containsReference(persisted, key)).toBe(false);
    expect(JSON.stringify(persisted)).not.toContain(PASSPHRASE);
    expect(await unlockVault(PASSPHRASE, persisted)).not.toBeNull();

    await deleteMeta('vaultConfig');
  });

  it('uses PBKDF2-SHA-256 with exactly 310,000 iterations and the supplied salt', async () => {
    const deriveSpy = vi.spyOn(crypto.subtle, 'deriveKey');
    const { key, config } = await createVaultConfig(PASSPHRASE);
    const [algorithm, , derivedKeyAlgorithm, extractable, usages] = deriveSpy.mock.calls.at(-1);

    expect(algorithm.name).toBe('PBKDF2');
    expect(algorithm.hash).toBe('SHA-256');
    expect(algorithm.iterations).toBe(310_000);
    expect(Array.from(algorithm.salt)).toEqual(Array.from(config.salt));
    expect(config.iterations).toBe(310_000);
    expect(config.salt).toHaveLength(16);
    expect(derivedKeyAlgorithm).toEqual({ name: 'AES-GCM', length: 256 });
    expect(extractable).toBe(false);
    expect(usages).toEqual(['encrypt', 'decrypt']);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });

  it('creates a unique random salt for every vault and binds derivation to that salt', async () => {
    const vaults = [];
    for (let index = 0; index < 4; index += 1) vaults.push(await createVaultConfig(PASSPHRASE));

    const salts = vaults.map(({ config }) => hex(config.salt));
    expect(new Set(salts).size).toBe(vaults.length);
    vaults.forEach(({ config }) => expect(config.salt).toHaveLength(16));

    const first = vaults[0];
    const wrongSalt = vaults[1].config.salt;
    const wrongSaltKey = await deriveVaultKey(PASSPHRASE, wrongSalt);
    await expect(decryptBytes(wrongSaltKey, first.config.check)).rejects.toMatchObject({ name: 'OperationError' });
    await expect(unlockVault(PASSPHRASE, first.config)).resolves.not.toBeNull();
  });
});
