import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupLegacyTrackingKeys } from './legacyTrackingCleanup';

const LEGACY_KEYS = ['site_stats', 'site_fp', 'wippy_stats', 'wippy_fp'];

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('retired visitor-tracker data cleanup', () => {
  it('removes only known legacy tracking keys and preserves app preferences', () => {
    for (const key of LEGACY_KEYS) {
      window.localStorage.setItem(key, 'legacy');
      window.sessionStorage.setItem(key, 'legacy');
    }
    window.localStorage.setItem('quiet-notes-theme', 'dark');
    window.sessionStorage.setItem('unrelated', 'keep');

    cleanupLegacyTrackingKeys();

    for (const key of LEGACY_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    }
    expect(window.localStorage.getItem('quiet-notes-theme')).toBe('dark');
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep');
  });

  it('does not prevent app startup when storage removal throws', () => {
    const removeLocal = vi.fn(() => { throw new Error('storage blocked'); });
    const removeSession = vi.fn(() => { throw new Error('storage blocked'); });

    expect(() => cleanupLegacyTrackingKeys({
      localStorage: { removeItem: removeLocal },
      sessionStorage: { removeItem: removeSession },
    })).not.toThrow();
    expect(removeLocal).toHaveBeenCalled();
    expect(removeSession).toHaveBeenCalled();
  });
});
