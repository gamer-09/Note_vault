import {
  createVaultConfig,
  decryptBytes,
  decryptVaultContent,
  decryptVaultMetadata,
  deriveVaultKey,
  encryptBytes,
  encryptVaultRecord,
  textToBytes,
  bytesToText,
} from './crypto';

export const VAULT_ARCHIVE_MAGIC = 'quiet-notes-vault';
export const VAULT_ARCHIVE_VERSION = 1;
export const VAULT_ARCHIVE_KDF = Object.freeze({
  name: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 310_000,
  saltBytes: 16,
});
export const VAULT_ARCHIVE_CIPHER = Object.freeze({
  name: 'AES-GCM',
  keyBits: 256,
  tagBits: 128,
  ivBytes: 12,
});

const PAYLOAD_SCHEMA = 'quiet-notes-workspace';
const PAYLOAD_VERSION = 1;

export class VaultArchiveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VaultArchiveError';
    this.code = code;
  }
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value, fieldName) {
  if (typeof value !== 'string' || !value.length) {
    throw new VaultArchiveError('INVALID_FORMAT', `${fieldName} is missing.`);
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new VaultArchiveError('INVALID_FORMAT', `${fieldName} is not valid base64.`);
  }
}

function parseArchive(serializedArchive) {
  let archive;
  try {
    archive = JSON.parse(serializedArchive);
  } catch {
    throw new VaultArchiveError('INVALID_FORMAT', 'The archive is not valid JSON.');
  }

  if (archive?.header?.format !== VAULT_ARCHIVE_MAGIC) {
    throw new VaultArchiveError('INVALID_FORMAT', 'This is not a Quiet Notes vault archive.');
  }
  if (archive.header.version !== VAULT_ARCHIVE_VERSION) {
    throw new VaultArchiveError('UNSUPPORTED_VERSION', `Vault archive version ${archive.header.version} is not supported.`);
  }

  const { kdf, cipher } = archive.header;
  if (
    kdf?.name !== VAULT_ARCHIVE_KDF.name
    || kdf?.hash !== VAULT_ARCHIVE_KDF.hash
    || kdf?.iterations !== VAULT_ARCHIVE_KDF.iterations
  ) {
    throw new VaultArchiveError('UNSUPPORTED_KDF', 'The archive uses unsupported key-derivation parameters.');
  }
  if (
    cipher?.name !== VAULT_ARCHIVE_CIPHER.name
    || cipher?.keyBits !== VAULT_ARCHIVE_CIPHER.keyBits
    || cipher?.tagBits !== VAULT_ARCHIVE_CIPHER.tagBits
  ) {
    throw new VaultArchiveError('UNSUPPORTED_CIPHER', 'The archive uses an unsupported cipher configuration.');
  }

  const salt = base64ToBytes(kdf.salt, 'KDF salt');
  const iv = base64ToBytes(cipher.iv, 'cipher IV');
  const ciphertext = base64ToBytes(archive.ciphertext, 'ciphertext');
  if (salt.byteLength !== VAULT_ARCHIVE_KDF.saltBytes || iv.byteLength !== VAULT_ARCHIVE_CIPHER.ivBytes) {
    throw new VaultArchiveError('INVALID_FORMAT', 'The archive salt or IV has an invalid length.');
  }

  return { archive, salt, iv, ciphertext };
}

function validatePayload(payload) {
  if (payload?.schema !== PAYLOAD_SCHEMA || payload.version !== PAYLOAD_VERSION || !Array.isArray(payload.items)) {
    throw new VaultArchiveError('INVALID_PAYLOAD', 'The decrypted workspace payload is invalid.');
  }

  payload.items.forEach((item) => {
    if (!item?.metadata || typeof item.metadata !== 'object' || typeof item.metadata.id !== 'string' || typeof item.content !== 'string') {
      throw new VaultArchiveError('INVALID_PAYLOAD', 'The decrypted workspace contains an invalid item.');
    }
  });
  return payload;
}

/**
 * Produces one authenticated ciphertext containing the complete decrypted
 * workspace. Only format/KDF/cipher parameters remain visible in the header.
 */
export async function createPortableVaultArchive({ records, vaultKey, passphrase }) {
  if (!vaultKey || typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new VaultArchiveError('INVALID_INPUT', 'A vault key and an archive passphrase of at least 8 characters are required.');
  }

  const items = [];
  for (const record of records) {
    const metadata = await decryptVaultMetadata(vaultKey, record);
    const content = await decryptVaultContent(vaultKey, record);
    items.push({ metadata, content: bytesToBase64(content) });
  }

  const payload = {
    schema: PAYLOAD_SCHEMA,
    version: PAYLOAD_VERSION,
    exportedAt: new Date().toISOString(),
    items,
  };
  const salt = randomBytes(VAULT_ARCHIVE_KDF.saltBytes);
  const archiveKey = await deriveVaultKey(passphrase, salt);
  const encrypted = await encryptBytes(archiveKey, textToBytes(JSON.stringify(payload)));

  return JSON.stringify({
    header: {
      format: VAULT_ARCHIVE_MAGIC,
      version: VAULT_ARCHIVE_VERSION,
      kdf: {
        name: VAULT_ARCHIVE_KDF.name,
        hash: VAULT_ARCHIVE_KDF.hash,
        iterations: VAULT_ARCHIVE_KDF.iterations,
        salt: bytesToBase64(salt),
      },
      cipher: {
        name: VAULT_ARCHIVE_CIPHER.name,
        keyBits: VAULT_ARCHIVE_CIPHER.keyBits,
        tagBits: VAULT_ARCHIVE_CIPHER.tagBits,
        iv: bytesToBase64(encrypted.iv),
      },
    },
    ciphertext: bytesToBase64(encrypted.cipher),
  });
}

/**
 * Decrypts a portable archive and re-encrypts every item into a fresh vault.
 * The archive passphrase becomes the passphrase for the restored vault.
 */
export async function importPortableVaultArchive({ serializedArchive, passphrase }) {
  if (typeof passphrase !== 'string' || !passphrase.length) {
    throw new VaultArchiveError('AUTH_FAILED', 'The archive passphrase is incorrect or the file was modified.');
  }

  const { salt, iv, ciphertext } = parseArchive(serializedArchive);
  let payload;
  try {
    const archiveKey = await deriveVaultKey(passphrase, salt);
    const plaintext = await decryptBytes(archiveKey, { iv, cipher: ciphertext });
    payload = validatePayload(JSON.parse(bytesToText(plaintext)));
  } catch (error) {
    if (error instanceof VaultArchiveError) throw error;
    throw new VaultArchiveError('AUTH_FAILED', 'The archive passphrase is incorrect or the file was modified.');
  }

  const { key, config } = await createVaultConfig(passphrase);
  const records = [];
  for (const item of payload.items) {
    const content = base64ToBytes(item.content, 'item content');
    records.push(await encryptVaultRecord(key, item.metadata, content));
  }

  return {
    config,
    records,
    exportedAt: payload.exportedAt,
  };
}
