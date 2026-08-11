import { useEffect } from 'react';

export const VAULT_AUTO_LOCK_MS = 5 * 60 * 1000;
export const VAULT_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove'];

/**
 * Arms the private workspace inactivity timer. The supplied onLock callback is
 * responsible for clearing the in-memory CryptoKey; the App callback does that
 * by setting its only key state reference to null.
 */
export function useVaultAutoLock(onLock, active = true) {
  useEffect(() => {
    if (!active) return undefined;

    let timer;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onLock, VAULT_AUTO_LOCK_MS);
    };

    VAULT_ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, arm));
    arm();

    return () => {
      window.clearTimeout(timer);
      VAULT_ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, arm));
    };
  }, [active, onLock]);
}
