import { describe, expect, it } from 'vitest';
import {
  MAX_PRIVATE_ITEM_BYTES,
  PRIVATE_UPLOAD_ACCEPT,
  getSafePreviewKind,
  safeDownloadName,
  validateUploadFile,
  validateVaultMetadata,
} from './securityValidation';

const validMetadata = {
  id: 'item_123',
  name: 'Private note',
  type: 'text/plain',
  kind: 'note',
  folder: '',
  size: 4,
  addedAt: 1_725_000_000_000,
  updatedAt: 1_725_000_000_001,
};

describe('local input validation and safe previews', () => {
  it('accepts empty files, normalizes questionable MIME types, and enforces the per-item size limit', () => {
    expect(validateUploadFile({ name: 'empty.txt', type: '', size: 0 })).toEqual({
      name: 'empty.txt',
      type: 'text/plain',
      size: 0,
    });
    expect(validateUploadFile({ name: 'photo.png', type: 'IMAGE/PNG', size: 8 }).type).toBe('image/png');
    expect(() => validateUploadFile({ name: 'too-large.txt', type: '', size: MAX_PRIVATE_ITEM_BYTES + 1 }))
      .toThrow('Each file must be 25 MB or smaller.');
    expect(() => validateUploadFile({ name: '\u0000\u0001', type: '', size: 0 }))
      .toThrow('The selected file needs a usable name.');
  });

  it('allowlists needed documents/images and rejects scripts, executables, archives, and mismatched MIME types', () => {
    expect(PRIVATE_UPLOAD_ACCEPT.split(',')).toContain('.pdf');
    expect(PRIVATE_UPLOAD_ACCEPT.split(',')).toContain('.docx');
    expect(PRIVATE_UPLOAD_ACCEPT.split(',')).not.toContain('.exe');
    expect(PRIVATE_UPLOAD_ACCEPT.split(',')).not.toContain('.zip');

    expect(validateUploadFile({ name: 'letter.docx', type: 'application/octet-stream', size: 12 }).type)
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    for (const name of ['payload.exe', 'archive.zip', 'active.svg', 'page.html', 'unknown.bin']) {
      expect(() => validateUploadFile({ name, type: 'application/octet-stream', size: 12 }))
        .toThrow('Unsupported file type.');
    }
    expect(() => validateUploadFile({ name: 'fake.pdf', type: 'application/x-msdownload', size: 12 }))
      .toThrow('The file extension and MIME type do not match.');
  });

  it('only accepts well-formed private metadata whose declared size matches content', () => {
    expect(validateVaultMetadata(validMetadata, { contentSize: 4 })).toEqual(validMetadata);
    expect(() => validateVaultMetadata({ ...validMetadata, name: { html: '<img>' } }))
      .toThrow('Private item name is invalid.');
    expect(() => validateVaultMetadata({ ...validMetadata, size: -1 }))
      .toThrow('Private item size is invalid.');
    expect(() => validateVaultMetadata(validMetadata, { contentSize: 3 }))
      .toThrow('Private item size does not match its encrypted content.');
    expect(() => validateVaultMetadata({ ...validMetadata, folder: 'x'.repeat(61) }))
      .toThrow('Private item folder is invalid.');
  });

  it('sanitizes download filenames without changing encrypted item names', () => {
    expect(safeDownloadName('../private\\name?.txt')).toBe('..-private-name-.txt');
    expect(safeDownloadName('\u0000\u0001')).toBe('download');
  });

  it('previews plain text safely and refuses untrusted or mismatched image/PDF content', () => {
    expect(getSafePreviewKind({ kind: 'file', type: 'text/html' }, new TextEncoder().encode('<script>alert(1)</script>'))).toBe('text');
    expect(getSafePreviewKind({ kind: 'file', type: 'image/png' }, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image');
    expect(getSafePreviewKind({ kind: 'file', type: 'image/svg+xml' }, new TextEncoder().encode('<svg onload="alert(1)"/>'))).toBeNull();
    expect(getSafePreviewKind({ kind: 'file', type: 'image/png' }, new TextEncoder().encode('<svg/>'))).toBeNull();
    expect(getSafePreviewKind({ kind: 'file', type: 'application/pdf' }, new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(getSafePreviewKind({ kind: 'file', type: 'application/pdf' }, new TextEncoder().encode('<script>'))).toBeNull();
  });
});
