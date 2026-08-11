import { useCallback, useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVaultConfig } from './crypto';
import { useVaultAutoLock, VAULT_AUTO_LOCK_MS } from './useVaultAutoLock';

function VaultSessionHarness({ initialKey, onKeyReferenceChange }) {
  const [key, setKey] = useState(initialKey);
  const clearKey = useCallback(() => setKey(null), []);
  useVaultAutoLock(clearKey, key !== null);

  useEffect(() => {
    onKeyReferenceChange(key);
  }, [key, onKeyReferenceChange]);

  return <output data-testid="key-state">{key === null ? 'cleared' : 'present'}</output>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('private workspace in-memory auto-lock', () => {
  it('removes the actual CryptoKey state reference after five inactive minutes', async () => {
    const { key } = await createVaultConfig('timer test passphrase');
    const observedReferences = [];
    vi.useFakeTimers();

    render(<VaultSessionHarness initialKey={key} onKeyReferenceChange={(value) => observedReferences.push(value)} />);
    expect(screen.getByTestId('key-state')).toHaveTextContent('present');
    expect(observedReferences.at(-1)).toBe(key);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VAULT_AUTO_LOCK_MS - 1);
    });
    expect(observedReferences.at(-1)).toBe(key);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByTestId('key-state')).toHaveTextContent('cleared');
    expect(observedReferences.at(-1)).toBeNull();
    expect(observedReferences).toEqual([key, null]);
  });

  it('restarts the five-minute inactivity window when vault activity occurs', async () => {
    const { key } = await createVaultConfig('activity reset passphrase');
    const observedReferences = [];
    vi.useFakeTimers();

    render(<VaultSessionHarness initialKey={key} onKeyReferenceChange={(value) => observedReferences.push(value)} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    fireEvent.mouseMove(window);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    expect(observedReferences.at(-1)).toBe(key);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });
    expect(observedReferences.at(-1)).toBeNull();
  });
});
