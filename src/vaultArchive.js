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
import {
  MAX_PASSPHRASE_LENGTH,
  MAX_PORTABLE_ARCHIVE_BYTES,
  MAX_PORTABLE_ARCHIVE_ITEMS,
  MAX_PRIVATE_ITEM_BYTES,
  ValidationError,
  validateVaultMetadata,
} from './securityValidation';

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
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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

function base64ByteLength(value, fieldName, allowEmpty = false) {
  if (typeof value !== 'string') {
    throw new VaultArchiveError('INVALID_FORMAT', `${fieldName} is missing.`);
  }
  if (!value.length && allowEmpty) return 0;
  if (!value.length || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new VaultArchiveError('INVALID_FORMAT', `${fieldName} is not valid base64.`);
  }

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function base64ToBytes(value, fieldName, allowEmpty = false) {
  const expectedLength = base64ByteLength(value, fieldName, allowEmpty);
  if (expectedLength === 0) return new Uint8Array(0);

  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (bytes.byteLength !== expectedLength || bytesToBase64(bytes) !== value) {
      throw new Error('Non-canonical base64');
    }
    return bytes;
  } catch {
    throw new VaultArchiveError('INVALID_FORMAT', `${fieldName} is not valid base64.`);
  }
}

function byteLength(value) {
  return Number.isSafeInteger(value?.byteLength) && value.byteLength >= 0 ? value.byteLength : -1;
}

function estimateSerializedArchiveBytes(records) {
  // The encrypted metadata keeps its original JSON byte length, and AES-GCM
  // adds a 16-byte tag to each envelope. This conservative estimate prevents
  // building very large duplicate strings/buffers before the final size check.
  let payloadBytes = 160;
  for (const record of records) {
    const metadataCipherBytes = byteLength(record?.metadata?.cipher);
    const contentCipherBytes = byteLength(record?.content?.cipher);
    if (metadataCipherBytes < 16 || contentCipherBytes < 16) {
      throw new VaultArchiveError('INVALID_PAYLOAD', 'A private item has an invalid encrypted envelope.');
    }

    const contentBytes = contentCipherBytes - 16;
    if (contentBytes > MAX_PRIVATE_ITEM_BYTES) {
      throw new VaultArchiveError('ITEM_TOO_LARGE', 'A private item is larger than the supported 25 MB limit.');
    }

    const encodedContentBytes = 4 * Math.ceil(contentBytes / 3);
    payloadBytes += (metadataCipherBytes - 16) + encodedContentBytes + 40;
  }

  return 512 + 4 * Math.ceil((payloadBytes + 16) / 3);
}

function parseArchive(serializedArchive) {
  if (typeof serializedArchive !== 'string' || !serializedArchive.length) {
    throw new VaultArchiveError('INVALID_FORMAT', 'The archive is empty or unreadable.');
  }
  if (serializedArchive.length > MAX_PORTABLE_ARCHIVE_BYTES) {
    throw new VaultArchiveError('ARCHIVE_TOO_LARGE', 'Portable backups must be 100 MB or smaller.');
  }

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
  if (ciphertext.byteLength < VAULT_ARCHIVE_CIPHER.tagBits / 8) {
    throw new VaultArchiveError('INVALID_FORMAT', 'The archive ciphertext is too short.');
  }

  return { salt, iv, ciphertext };
}

function validatePayload(payload) {
  if (payload?.schema !== PAYLOAD_SCHEMA || payload.version !== PAYLOAD_VERSION || !Array.isArray(payload.items)) {
    throw new VaultArchiveError('INVALID_PAYLOAD', 'The decrypted workspace payload is invalid.');
  }
  if (payload.items.length > MAX_PORTABLE_ARCHIVE_ITEMS) {
    throw new VaultArchiveError('INVALID_PAYLOAD', 'The archive contains too many private items.');
  }
  if (typeof payload.exportedAt !== 'string' || !Number.isFinite(Date.parse(payload.exportedAt))) {
    throw new VaultArchiveError('INVALID_PAYLOAD', 'The archive timestamp is invalid.');
  }

  try {
    const items = payload.items.map((item) => {
      if (!item || typeof item !== 'object' || typeof item.content !== 'string') {
        throw new ValidationError('The decrypted workspace contains an invalid item.');
      }
      const contentSize = base64ByteLength(item.content, 'item content', true);
      const metadata = validateVaultMetadata(item.metadata, { contentSize });
      return { metadata, content: item.content };
    });
    return { ...payload, items };
  } catch (error) {
    if (error instanceof VaultArchiveError) throw error;
    throw new VaultArchiveError('INVALID_PAYLOAD', 'The decrypted workspace contains an invalid item.');
  }
}

/**
 * Produces one authenticated ciphertext containing the complete decrypted
 * workspace. Only format/KDF/cipher parameters remain visible in the header.
 */
export async function createPortableVaultArchive({ records, vaultKey, passphrase }) {
  if (!vaultKey || typeof passphrase !== 'string' || passphrase.length < 8 || passphrase.length > MAX_PASSPHRASE_LENGTH || passphrase.trim() !== passphrase) {
    throw new VaultArchiveError('INVALID_INPUT', 'A vault key and an archive passphrase of 8–1,024 characters without outer spaces are required.');
  }
  if (!Array.isArray(records) || records.length > MAX_PORTABLE_ARCHIVE_ITEMS) {
    throw new VaultArchiveError('INVALID_INPUT', 'The workspace has too many items to back up.');
  }
  if (estimateSerializedArchiveBytes(records) > MAX_PORTABLE_ARCHIVE_BYTES) {
    throw new VaultArchiveError('ARCHIVE_TOO_LARGE', 'This backup would exceed the 100 MB portable archive limit.');
  }

  const items = [];
  const ids = new Set();
  for (const record of records) {
    let metadata;
    let content;
    try {
      metadata = validateVaultMetadata(await decryptVaultMetadata(vaultKey, record));
      content = await decryptVaultContent(vaultKey, record);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new VaultArchiveError('INVALID_PAYLOAD', 'A private item has invalid metadata.');
      }
      throw error;
    }
    if (metadata.size !== content.byteLength) {
      throw new VaultArchiveError('INVALID_PAYLOAD', 'A private item size does not match its content.');
    }
    if (ids.has(metadata.id)) {
      throw new VaultArchiveError('INVALID_PAYLOAD', 'The workspace contains duplicate private item identifiers.');
    }
    ids.add(metadata.id);
    items.push({ metadata, content: bytesToBase64(content) });
  }

  const payload = {
    schema: PAYLOAD_SCHEMA,
    version: PAYLOAD_VERSION,
    exportedAt: new Date().toISOString(),
    items,
  };
  const payloadText = JSON.stringify(payload);
  if (textToBytes(payloadText).byteLength + 16 > MAX_PORTABLE_ARCHIVE_BYTES) {
    throw new VaultArchiveError('ARCHIVE_TOO_LARGE', 'This backup would exceed the 100 MB portable archive limit.');
  }

  const salt = randomBytes(VAULT_ARCHIVE_KDF.saltBytes);
  const archiveKey = await deriveVaultKey(passphrase, salt);
  const encrypted = await encryptBytes(archiveKey, textToBytes(payloadText));

  const serialized = JSON.stringify({
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
  if (serialized.length > MAX_PORTABLE_ARCHIVE_BYTES) {
    throw new VaultArchiveError('ARCHIVE_TOO_LARGE', 'This backup would exceed the 100 MB portable archive limit.');
  }
  return serialized;
}

/**
 * Decrypts a portable archive and re-encrypts every item into a fresh vault.
 * The archive passphrase becomes the passphrase for the restored vault.
 */
export async function importPortableVaultArchive({ serializedArchive, passphrase }) {
  if (
    typeof passphrase !== 'string'
    || passphrase.length < 8
    || passphrase.length > MAX_PASSPHRASE_LENGTH
    || passphrase.trim() !== passphrase
  ) {
    throw new VaultArchiveError('AUTH_FAILED', 'The archive passphrase is incorrect or the file was modified.');
  }

  const { salt, iv, ciphertext } = parseArchive(serializedArchive);
  let plaintext;
  try {
    const archiveKey = await deriveVaultKey(passphrase, salt);
    plaintext = await decryptBytes(archiveKey, { iv, cipher: ciphertext });
  } catch {
    throw new VaultArchiveError('AUTH_FAILED', 'The archive passphrase is incorrect or the file was modified.');
  }

  let payload;
  try {
    payload = validatePayload(JSON.parse(bytesToText(plaintext)));
  } catch (error) {
    if (error instanceof VaultArchiveError) throw error;
    throw new VaultArchiveError('INVALID_PAYLOAD', 'The decrypted workspace payload is invalid.');
  }

  const { key, config } = await createVaultConfig(passphrase);
  const records = [];
  for (const item of payload.items) {
    const content = base64ToBytes(item.content, 'item content', true);
    records.push(await encryptVaultRecord(key, item.metadata, content));
  }

  return {
    config,
    records,
    exportedAt: payload.exportedAt,
  };
}
