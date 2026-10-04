import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App.jsx';
import { unlockVault } from './crypto';
import { clearVaultRecords, deleteMeta, getAllNotes, getAllVaultRecords, getMeta, replaceAllNotes } from './db';

const PASSPHRASE = 'quiet notes integration passphrase';

let originalViewTransitionDescriptor;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalViewTransitionDescriptor) {
    Object.defineProperty(document, 'startViewTransition', originalViewTransitionDescriptor);
  } else {
    delete document.startViewTransition;
  }
  originalViewTransitionDescriptor = undefined;
});

beforeEach(async () => {
  window.localStorage.clear();
  await replaceAllNotes([]);
  await clearVaultRecords();
  await deleteMeta('vaultConfig');
  await deleteMeta('noteFolders');
});

async function createPrivateSpace() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
  const versionButton = screen.getByRole('button', { name: 'Application version' });
  for (let index = 0; index < 5; index += 1) fireEvent.click(versionButton);

  await screen.findByText(/Create the passphrase used by your private typing shortcut/);
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: PASSPHRASE } });
  fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: PASSPHRASE } });
  fireEvent.click(screen.getByRole('button', { name: 'Create private space' }));
  await screen.findByText('Private space is ready', {}, { timeout: 10_000 });
  fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
}

describe('Quiet Notes security and hidden-workspace regression checks', () => {
  it('keeps the hidden passphrase trigger working, does not save a failed trigger, and stores private content only as ciphertext', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const viewTransitions = [];
    originalViewTransitionDescriptor = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update) => {
        update();
        const transition = { finished: Promise.resolve() };
        viewTransitions.push(transition);
        return transition;
      },
    });
    window.localStorage.setItem('quiet-notes-theme', 'javascript:invalid');
    window.localStorage.setItem('quiet-notes-sort', '<script>invalid</script>');

    const { container } = render(<App />);
    await screen.findByPlaceholderText('Start writing…');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByLabelText('Sort notes')).toHaveValue('updated');
    await createPrivateSpace();

    const config = await getMeta('vaultConfig');
    expect(config).toBeTruthy();
    expect(JSON.stringify(config)).not.toContain(PASSPHRASE);

    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    const body = screen.getByPlaceholderText('Start writing…');
    fireEvent.change(body, { target: { value: 'Password = definitely-not-the-passphrase' } });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 900)));

    expect(screen.queryByRole('heading', { name: 'Secure space' })).not.toBeInTheDocument();
    expect((await getAllNotes()).some((note) => note.body === 'Password = definitely-not-the-passphrase')).toBe(false);

    fireEvent.change(body, { target: { value: `Password = ${PASSPHRASE}` } });
    await screen.findByRole('heading', { name: 'Secure space' }, { timeout: 10_000 });
    await screen.findByText('Your private space is empty', {}, { timeout: 10_000 });
    expect(await getAllNotes()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Private note' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unpublished recovery details' } });
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'private plaintext must not persist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Encrypt & save' }));
    await screen.findByText('Private note encrypted', {}, { timeout: 10_000 });

    const upload = container.querySelector('input[type="file"][multiple]');
    const file = new File(['sensitive file bytes'], 'private-evidence.txt', { type: 'text/plain' });
    fireEvent.change(upload, { target: { files: [file] } });
    await screen.findByText('1 encrypted item added', {}, { timeout: 10_000 });

    const records = await getAllVaultRecords();
    expect(records).toHaveLength(2);
    const persistedRecords = JSON.stringify(records);
    expect(persistedRecords).not.toContain('Unpublished recovery details');
    expect(persistedRecords).not.toContain('private plaintext must not persist');
    expect(persistedRecords).not.toContain('private-evidence.txt');
    expect(persistedRecords).not.toContain('sensitive file bytes');

    fireEvent.click(screen.getByText('private-evidence.txt').closest('button'));
    await screen.findByText('sensitive file bytes');
    fireEvent.mouseDown(container.querySelector('.modal-backdrop.vault-dialog-backdrop'));
    expect(screen.queryByText('sensitive file bytes')).not.toBeInTheDocument();

    expect(window.localStorage.getItem('quiet-notes-theme')).not.toContain(PASSPHRASE);
    expect(window.localStorage.getItem('quiet-notes-sort')).not.toContain(PASSPHRASE);

    const rotatedPassphrase = 'quiet notes rotated passphrase';
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    fireEvent.change(screen.getByLabelText('New passphrase'), { target: { value: rotatedPassphrase } });
    fireEvent.change(screen.getByLabelText('Confirm new passphrase'), { target: { value: rotatedPassphrase } });
    fireEvent.click(screen.getByRole('button', { name: 'Change passphrase' }));
    await screen.findByText('Passphrase changed and items re-encrypted', {}, { timeout: 10_000 });
    const rotatedConfig = await getMeta('vaultConfig');
    expect(await unlockVault(rotatedPassphrase, rotatedConfig)).not.toBeNull();
    await expect(unlockVault(PASSPHRASE, rotatedConfig)).resolves.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Lock & close' }));
    await screen.findByRole('heading', { name: 'All notes' });
    const triggerNoteBody = await screen.findByPlaceholderText('Start writing…');
    fireEvent.change(triggerNoteBody, { target: { value: `Password = ${rotatedPassphrase}` } });
    await screen.findByRole('heading', { name: 'Secure space' }, { timeout: 10_000 });
    expect(await screen.findByText('Unpublished recovery details')).toBeInTheDocument();
    expect(await screen.findByText('private-evidence.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lock & close' }));
    await screen.findByRole('heading', { name: 'All notes' });
    expect(viewTransitions).toHaveLength(4);
  });

  it('imports and renders HTML-looking note text as text, never as active markup', async () => {
    const payload = '<img src=x onerror="alert(1)"><script>steal()</script>';
    const { container } = render(<App />);
    await screen.findByPlaceholderText('Start writing…');
    const backup = {
      app: 'Quiet Notes',
      version: 2,
      exportedAt: new Date().toISOString(),
      folders: [],
      notes: [{
        id: 'untrusted-id',
        title: 'Imported sample',
        body: payload,
        folderId: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
      }],
    };
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    const importInput = container.querySelector('input[type="file"][accept="application/json,.json"]');
    const file = new File([JSON.stringify(backup)], 'notes.json', { type: 'application/json' });
    fireEvent.change(importInput, { target: { files: [file] } });

    await screen.findByText('1 note imported');
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    const body = await screen.findByPlaceholderText('Start writing…');
    expect(body).toHaveValue(payload);
    expect((await getAllNotes()).some((note) => note.body === payload)).toBe(true);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.textContent).toContain(payload);
  });
});
