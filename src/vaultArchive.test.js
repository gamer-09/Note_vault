import { describe, expect, it } from 'vitest';
import {
  bytesToText,
  createVaultConfig,
  decryptVaultContent,
  decryptVaultMetadata,
  encryptVaultRecord,
  textToBytes,
  unlockVault,
} from './crypto';
import {
  createPortableVaultArchive,
  importPortableVaultArchive,
  VAULT_ARCHIVE_CIPHER,
  VAULT_ARCHIVE_KDF,
  VAULT_ARCHIVE_MAGIC,
  VAULT_ARCHIVE_VERSION,
} from './vaultArchive';

const SOURCE_PASSPHRASE = 'source vault passphrase';
const ARCHIVE_PASSPHRASE = 'portable archive passphrase';

async function sourceRecords() {
  const { key } = await createVaultConfig(SOURCE_PASSPHRASE);
  const metadata = [
    {
      id: 'private-note-1',
      name: 'Bank recovery codes',
      type: 'text/plain',
      kind: 'note',
      folder: 'Critical secrets',
      size: 20,
      addedAt: 1_725_000_000_000,
      updatedAt: 1_725_000_000_000,
    },
    {
      id: 'file-2',
      name: 'passport-scan.bin',
      type: 'application/octet-stream',
      kind: 'file',
      folder: 'Identity',
      size: 6,
      addedAt: 1_725_000_100_000,
      updatedAt: 1_725_000_100_000,
    },
  ];
  const contents = [textToBytes('alpha recovery phrase'), new Uint8Array([0, 1, 2, 253, 254, 255])];
  const records = [];
  for (let index = 0; index < metadata.length; index += 1) {
    records.push(await encryptVaultRecord(key, metadata[index], contents[index]));
  }
  return { key, records, metadata, contents };
}

function changeOneBase64Byte(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  let changed = '';
  for (const byte of bytes) changed += String.fromCharCode(byte);
  return btoa(changed);
}

describe('portable encrypted vault archive', () => {
  it('round-trips a complete workspace into one ciphertext on another device', async () => {
    const source = await sourceRecords();
    const serialized = await createPortableVaultArchive({
      records: source.records,
      vaultKey: source.key,
      passphrase: ARCHIVE_PASSPHRASE,
    });
    const archive = JSON.parse(serialized);

    expect(archive).toEqual({
      header: {
        format: VAULT_ARCHIVE_MAGIC,
        version: VAULT_ARCHIVE_VERSION,
        kdf: {
          name: VAULT_ARCHIVE_KDF.name,
          hash: VAULT_ARCHIVE_KDF.hash,
          iterations: VAULT_ARCHIVE_KDF.iterations,
          salt: expect.any(String),
        },
        cipher: {
          name: VAULT_ARCHIVE_CIPHER.name,
          keyBits: VAULT_ARCHIVE_CIPHER.keyBits,
          tagBits: VAULT_ARCHIVE_CIPHER.tagBits,
          iv: expect.any(String),
        },
      },
      ciphertext: expect.any(String),
    });
    expect(serialized).not.toContain('Bank recovery codes');
    expect(serialized).not.toContain('Critical secrets');
    expect(serialized).not.toContain('alpha recovery phrase');
    expect(Uint8Array.from(atob(archive.header.kdf.salt), (character) => character.charCodeAt(0))).toHaveLength(16);
    expect(Uint8Array.from(atob(archive.header.cipher.iv), (character) => character.charCodeAt(0))).toHaveLength(12);

    // Import receives only the file and archive passphrase — no source key/config.
    const restored = await importPortableVaultArchive({
      serializedArchive: serialized,
      passphrase: ARCHIVE_PASSPHRASE,
    });
    const unlockedKey = await unlockVault(ARCHIVE_PASSPHRASE, restored.config);
    expect(unlockedKey).not.toBeNull();
    await expect(unlockVault(SOURCE_PASSPHRASE, restored.config)).resolves.toBeNull();
    expect(restored.records).toHaveLength(source.records.length);

    for (let index = 0; index < restored.records.length; index += 1) {
      await expect(decryptVaultMetadata(unlockedKey, restored.records[index])).resolves.toEqual(source.metadata[index]);
      const content = await decryptVaultContent(unlockedKey, restored.records[index]);
      expect(Array.from(content)).toEqual(Array.from(source.contents[index]));
    }
    expect(bytesToText(await decryptVaultContent(unlockedKey, restored.records[0]))).toBe('alpha recovery phrase');
  });

  it('fails closed for a wrong archive passphrase or one-byte ciphertext tampering', async () => {
    const source = await sourceRecords();
    const serialized = await createPortableVaultArchive({ records: source.records, vaultKey: source.key, passphrase: ARCHIVE_PASSPHRASE });

    await expect(importPortableVaultArchive({ serializedArchive: serialized, passphrase: 'wrong archive passphrase' }))
      .rejects.toMatchObject({ name: 'VaultArchiveError', code: 'AUTH_FAILED' });

    const tampered = JSON.parse(serialized);
    tampered.ciphertext = changeOneBase64Byte(tampered.ciphertext);
    await expect(importPortableVaultArchive({ serializedArchive: JSON.stringify(tampered), passphrase: ARCHIVE_PASSPHRASE }))
      .rejects.toMatchObject({ name: 'VaultArchiveError', code: 'AUTH_FAILED' });
  });

  it('rejects unknown format versions and KDF changes instead of guessing', async () => {
    const source = await sourceRecords();
    const serialized = await createPortableVaultArchive({ records: source.records, vaultKey: source.key, passphrase: ARCHIVE_PASSPHRASE });
    const unsupportedVersion = JSON.parse(serialized);
    unsupportedVersion.header.version = 99;
    await expect(importPortableVaultArchive({ serializedArchive: JSON.stringify(unsupportedVersion), passphrase: ARCHIVE_PASSPHRASE }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });

    const unsupportedKdf = JSON.parse(serialized);
    unsupportedKdf.header.kdf.iterations = 1;
    await expect(importPortableVaultArchive({ serializedArchive: JSON.stringify(unsupportedKdf), passphrase: ARCHIVE_PASSPHRASE }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_KDF' });
  });
});
