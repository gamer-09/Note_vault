const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 310_000;
const CHECK_TEXT = 'quiet-notes-private-space-v1';

function randomBytes(length = 16) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

export async function deriveVaultKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: asBytes(salt),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBytes(key, input) {
  const iv = randomBytes(12);
  const bytes = asBytes(input);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv, cipher };
}

export async function decryptBytes(key, envelope) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBytes(envelope.iv) },
    key,
    envelope.cipher
  );
  return new Uint8Array(plain);
}

export async function createVaultConfig(passphrase) {
  const salt = randomBytes(16);
  const key = await deriveVaultKey(passphrase, salt);
  const check = await encryptBytes(key, encoder.encode(CHECK_TEXT));
  return {
    key,
    config: {
      version: 1,
      iterations: ITERATIONS,
      salt,
      check,
      createdAt: Date.now(),
    },
  };
}

export async function unlockVault(passphrase, config) {
  if (!config?.salt || !config?.check) return null;
  try {
    const key = await deriveVaultKey(passphrase, config.salt);
    const check = decoder.decode(await decryptBytes(key, config.check));
    return check === CHECK_TEXT ? key : null;
  } catch {
    return null;
  }
}

export async function encryptVaultRecord(key, metadata, bytes) {
  const metadataEnvelope = await encryptBytes(key, encoder.encode(JSON.stringify(metadata)));
  const contentEnvelope = await encryptBytes(key, bytes);
  return {
    id: metadata.id,
    addedAt: metadata.addedAt,
    metadata: metadataEnvelope,
    content: contentEnvelope,
  };
}

export async function decryptVaultMetadata(key, record) {
  const bytes = await decryptBytes(key, record.metadata);
  return JSON.parse(decoder.decode(bytes));
}

export async function decryptVaultContent(key, record) {
  return decryptBytes(key, record.content);
}

export async function reencryptVaultRecord(oldKey, newKey, record) {
  const metadata = await decryptVaultMetadata(oldKey, record);
  const content = await decryptVaultContent(oldKey, record);
  return encryptVaultRecord(newKey, metadata, content);
}

export function textToBytes(text) {
  return encoder.encode(text);
}

export function bytesToText(bytes) {
  return decoder.decode(bytes);
}
