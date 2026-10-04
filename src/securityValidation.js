export const MAX_PRIVATE_ITEM_BYTES = 25 * 1024 * 1024;
export const MAX_PORTABLE_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_PORTABLE_ARCHIVE_ITEMS = 10_000;
export const MAX_NOTE_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORTED_NOTES = 10_000;
export const MAX_PASSPHRASE_LENGTH = 1_024;
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f-\u009f]/g;
const MIME_TOKEN = /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/i;
const SAFE_RASTER_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export class ValidationError extends Error {
  constructor(message, code = 'INVALID_INPUT') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export function normalizeMimeType(value) {
  if (typeof value !== 'string') return 'application/octet-stream';
  const type = value.trim().toLowerCase();
  if (!type || type.length > 127 || !MIME_TOKEN.test(type)) return 'application/octet-stream';
  return type;
}

export function validateUploadFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0) {
    throw new ValidationError('Choose a valid file.');
  }
  if (file.size > MAX_PRIVATE_ITEM_BYTES) {
    throw new ValidationError('Each file must be 25 MB or smaller.', 'FILE_TOO_LARGE');
  }

  const name = file.name.normalize('NFC').replace(CONTROL_CHARACTERS_GLOBAL, '').trim().slice(0, 255);
  if (!name) throw new ValidationError('The selected file needs a usable name.');

  return {
    name,
    type: normalizeMimeType(file.type),
    size: file.size,
  };
}

export function validateVaultMetadata(value, { contentSize } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Private item metadata is invalid.');
  }

  const { id, name, type, kind, folder, size, addedAt, updatedAt } = value;
  if (typeof id !== 'string' || !id || id.length > 128 || CONTROL_CHARACTERS.test(id)) {
    throw new ValidationError('Private item identifier is invalid.');
  }

  if (typeof name !== 'string' || !name.trim() || name.length > 255 || CONTROL_CHARACTERS.test(name)) {
      throw new ValidationError('Private item name is invalid.');
  }

  if (typeof type !== 'string' || type.length > 127) {
    throw new ValidationError('Private item type is invalid.');
  }
  if (kind !== 'note' && kind !== 'file') {
    throw new ValidationError('Private item kind is invalid.');
  }
  if (typeof folder !== 'string' || folder.length > 60 || CONTROL_CHARACTERS.test(folder)) {
      throw new ValidationError('Private item folder is invalid.');
  }

  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PRIVATE_ITEM_BYTES) {
    throw new ValidationError('Private item size is invalid.');
  }
  if (contentSize !== undefined && size !== contentSize) {
    throw new ValidationError('Private item size does not match its encrypted content.');
  }

  const validTimestamp = (timestamp) => Number.isSafeInteger(timestamp) && Number.isFinite(new Date(timestamp).getTime());
  if (!validTimestamp(addedAt) || !validTimestamp(updatedAt)) {
    throw new ValidationError('Private item timestamps are invalid.');
  }

  return {
    id,
    name,
    type: normalizeMimeType(type),
    kind,
    folder,
    size,
    addedAt,
    updatedAt,
  };
}

export function safeDownloadName(value, fallback = 'download') {
  const cleaned = String(value ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\\/<>:"|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

function startsWithBytes(bytes, signature, offset = 0) {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function hasAscii(bytes, value, start = 0, end = bytes.byteLength) {
  const signature = Array.from(value, (character) => character.charCodeAt(0));
  const limit = Math.min(end, bytes.byteLength) - signature.length;
  for (let offset = start; offset <= limit; offset += 1) {
    if (startsWithBytes(bytes, signature, offset)) return true;
  }
  return false;
}

export function getSafePreviewKind(item, inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  const type = normalizeMimeType(item?.type);

  if ((item?.kind === 'note' || type.startsWith('text/')) && bytes.byteLength <= MAX_TEXT_PREVIEW_BYTES) {
    return 'text';
  }

  if (type === 'application/pdf' && hasAscii(bytes, '%PDF-', 0, 1_024)) return 'pdf';
  if (!SAFE_RASTER_TYPES.has(type)) return null;

  const validImage = {
    'image/avif': hasAscii(bytes, 'ftypavif') || hasAscii(bytes, 'ftypavis'),
    'image/bmp': startsWithBytes(bytes, [0x42, 0x4d]),
    'image/gif': hasAscii(bytes, 'GIF87a', 0, 6) || hasAscii(bytes, 'GIF89a', 0, 6),
    'image/jpeg': startsWithBytes(bytes, [0xff, 0xd8, 0xff]),
    'image/png': startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/webp': startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && hasAscii(bytes, 'WEBP', 8, 12),
  };

  return validImage[type] ? 'image' : null;
}
