const LEGACY_TRACKING_KEYS = Object.freeze(['site_stats', 'site_fp', 'wippy_stats', 'wippy_fp']);

/** Remove leftovers from the retired visitor tracker without touching app preferences. */
export function cleanupLegacyTrackingKeys(storages = {}) {
  try {
    const localStorage = storages.localStorage || window.localStorage;
    LEGACY_TRACKING_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage may be disabled by the browser; tracking data is not used by this app.
  }

  try {
    const sessionStorage = storages.sessionStorage || window.sessionStorage;
    LEGACY_TRACKING_KEYS.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Continue app startup even when session storage is unavailable.
  }
}
