import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowUpDown,
  Bold,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  DatabaseBackup,
  Download,
  File,
  FileImage,
  FileText,
  Folder,
  FolderLock,
  FolderPlus,
  HardDrive,
  Italic,
  KeyRound,
  List,
  ListChecks,
  Lock,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Palette,
  Pin,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  clearVaultRecords,
  deleteMeta,
  deleteNote,
  deleteVaultRecord,
  getAllNotes,
  getAllVaultRecords,
  getMeta,
  getVaultRecord,
  putNote,
  putVaultRecord,
  replaceAllNotes,
  replaceVaultWithConfig,
  setMeta,
} from './db';
import {
  bytesToText,
  createVaultConfig,
  decryptVaultContent,
  decryptVaultMetadata,
  encryptVaultRecord,
  reencryptVaultRecord,
  textToBytes,
  unlockVault,
} from './crypto';
import { useVaultAutoLock } from './useVaultAutoLock';
import { createPortableVaultArchive, importPortableVaultArchive } from './vaultArchive';

const TRIGGER_PREFIX = 'Password = ';
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function triggerLine(body = '') {
  return body.endsWith('\n') ? body.slice(0, -1) : body;
}

function isPotentialTriggerBody(body = '') {
  const line = triggerLine(body);
  return !line.includes('\n') && (TRIGGER_PREFIX.startsWith(line) || line.startsWith(TRIGGER_PREFIX));
}

function makeNote(folderId = '') {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '',
    body: '',
    folderId,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    triggerEligible: true,
  };
}

function formatListDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullDate(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes > 10 * 1024 ** 2 ? 0 : 1)} MB`;
}

function titleFor(note) {
  return note.title.trim() || note.body.trim().split('\n')[0] || 'Untitled note';
}

function previewFor(note) {
  const body = note.body.trim().replace(/\s+/g, ' ');
  return body || 'Start writing…';
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind || ''}`} role="status">
      <Check size={16} />
      <span>{toast.message}</span>
    </div>
  );
}

function EmptyNotes({ onCreate }) {
  return (
    <div className="empty-editor">
      <div className="empty-illustration">
        <NotebookPen size={36} strokeWidth={1.6} />
      </div>
      <h2>A clear page, when you need one.</h2>
      <p>Create a note for thoughts, lists, plans, or anything in between.</p>
      <button className="primary-button" onClick={onCreate}>
        <Plus size={17} /> New note
      </button>
    </div>
  );
}

function SettingsModal({
  open,
  onClose,
  theme,
  setTheme,
  notes,
  folders,
  onImport,
  vaultConfigured,
  onVaultConfigured,
  onImportVaultBackup,
  notify,
}) {
  const [versionTaps, setVersionTaps] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [saving, setSaving] = useState(false);
  const importRef = useRef(null);
  const vaultImportRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setVersionTaps(0);
      setPassphrase('');
      setConfirmPassphrase('');
    }
  }, [open]);

  if (!open) return null;

  const exportNotes = () => {
    const cleanNotes = notes.map(({ triggerEligible, ...note }) => note);
    const payload = JSON.stringify({ app: 'Quiet Notes', version: 2, exportedAt: new Date().toISOString(), folders, notes: cleanNotes }, null, 2);
    downloadBlob(new Blob([payload], { type: 'application/json' }), `quiet-notes-${new Date().toISOString().slice(0, 10)}.json`);
    notify('Notes exported');
  };

  const setupVault = async (event) => {
    event.preventDefault();
    if (passphrase.length < 8) return notify('Use at least 8 characters', 'error');
    if (passphrase.trim() !== passphrase) return notify('Passphrase cannot start or end with a space', 'error');
    if (passphrase !== confirmPassphrase) return notify('Passphrases do not match', 'error');

    setSaving(true);
    try {
      const { config } = await createVaultConfig(passphrase);
      await setMeta('vaultConfig', config);
      onVaultConfigured(true);
      setPassphrase('');
      setConfirmPassphrase('');
      notify('Private space is ready');
    } catch (error) {
      console.error(error);
      notify('Could not create private space', 'error');
    } finally {
      setSaving(false);
    }
  };

  const eraseVault = async () => {
    if (!window.confirm('Erase the private space and every encrypted item in it? This cannot be undone.')) return;
    await clearVaultRecords();
    await deleteMeta('vaultConfig');
    onVaultConfigured(false);
    setPassphrase('');
    setConfirmPassphrase('');
    notify('Private space erased');
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-label="Settings">
        <header className="modal-header">
          <div>
            <span className="eyebrow">Preferences</span>
            <h2>Settings</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={20} /></button>
        </header>

        <div className="settings-scroll">
          <div className="settings-group">
            <div className="settings-label"><Palette size={16} /> Appearance</div>
            <div className="segmented-control">
              <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}><Sun size={16} /> Light</button>
              <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}><Moon size={16} /> Dark</button>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-label"><HardDrive size={16} /> Your data</div>
            <p className="settings-copy">Notes stay in this browser. Export a backup before clearing browser data.</p>
            <div className="settings-actions">
              <button className="secondary-button" onClick={exportNotes}><Download size={16} /> Export notes</button>
              <button className="secondary-button" onClick={() => importRef.current?.click()}><Upload size={16} /> Import</button>
              <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={onImport} />
            </div>
          </div>

          {versionTaps >= 5 && (
            <div className="settings-group private-settings">
              <div className="settings-label"><ShieldCheck size={16} /> Private workspace</div>
              {!vaultConfigured ? (
                <form onSubmit={setupVault}>
                  <p className="settings-copy">Create the passphrase used by your private typing shortcut. It is verified cryptographically and is never saved as readable text.</p>
                  <label className="field-label">Passphrase
                    <input className="text-input" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="At least 8 characters" />
                  </label>
                  <label className="field-label">Confirm passphrase
                    <input className="text-input" type="password" autoComplete="new-password" value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} placeholder="Type it again" />
                  </label>
                  <button className="primary-button full-width" disabled={saving}>{saving ? 'Creating…' : 'Create private space'}</button>
                  <button type="button" className="secondary-button full-width restore-standalone" onClick={() => vaultImportRef.current?.click()}><DatabaseBackup size={16} /> Restore portable backup</button>
                  <input ref={vaultImportRef} hidden type="file" accept="application/json,.json,.qnvault" onChange={onImportVaultBackup} />
                </form>
              ) : (
                <div className="configured-vault-wrap">
                  <div className="configured-vault">
                    <div className="configured-row">
                      <span className="status-dot" />
                      <div><strong>Private space enabled</strong><small>Encrypted with AES-GCM</small></div>
                    </div>
                    <button className="danger-text-button" onClick={eraseVault}><Trash2 size={15} /> Erase private space</button>
                  </div>
                  <p className="settings-copy backup-copy">Create portable backups from the unlocked vault. You can restore one here on any browser or device.</p>
                  <div className="settings-actions vault-backup-actions">
                    <button className="secondary-button full-width" onClick={() => vaultImportRef.current?.click()}><Upload size={16} /> Restore portable backup</button>
                    <input ref={vaultImportRef} hidden type="file" accept="application/json,.json,.qnvault" onChange={onImportVaultBackup} />
                  </div>
                </div>
              )}
              <div className="security-note"><Lock size={14} /> Losing the passphrase means losing access. There is no recovery or cloud copy.</div>
            </div>
          )}

          <button className="version-row" onClick={() => setVersionTaps((value) => Math.min(5, value + 1))} aria-label="Application version">
            <span><Sparkles size={15} /> Quiet Notes</span>
            <span>Version 1.2.1</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function FileTypeIcon({ item, size = 21 }) {
  if (item.kind === 'note') return <FileText size={size} />;
  if (item.type?.startsWith('image/')) return <FileImage size={size} />;
  if (item.type === 'application/pdf') return <FileText size={size} />;
  return <File size={size} />;
}

function PrivateNoteDialog({ open, onClose, onSave, busy, folders, defaultFolder }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [folder, setFolder] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setText('');
      setFolder(defaultFolder || '');
    }
  }, [open, defaultFolder]);

  if (!open) return null;
  return (
    <div className="modal-backdrop vault-dialog-backdrop" onMouseDown={onClose}>
      <form className="small-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSave(name, text, folder); }}>
        <header className="modal-header">
          <div><span className="eyebrow">Encrypted item</span><h2>New private note</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        <label className="field-label">Name
          <input autoFocus className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Note name" maxLength={120} />
        </label>
        <label className="field-label">Encrypted folder
          <input className="text-input" list="vault-folder-options" value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="Unfiled or type a new folder" maxLength={60} />
          <datalist id="vault-folder-options">{folders.map((folderName) => <option key={folderName} value={folderName} />)}</datalist>
        </label>
        <label className="field-label">Content
          <textarea className="text-input private-note-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="Write something private…" />
        </label>
        <button className="primary-button full-width" disabled={busy || !name.trim()}>{busy ? 'Encrypting…' : 'Encrypt & save'}</button>
      </form>
    </div>
  );
}

function PreviewDialog({ preview, onClose }) {
  if (!preview) return null;
  return (
    <div className="modal-backdrop vault-dialog-backdrop" onMouseDown={onClose}>
      <section className="preview-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div><span className="eyebrow">Private preview</span><h2>{preview.name}</h2></div>
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="preview-content">
          {preview.kind === 'text' && <pre>{preview.text}</pre>}
          {preview.kind === 'image' && <img src={preview.url} alt={preview.name} />}
          {preview.kind === 'pdf' && <iframe src={preview.url} title={preview.name} />}
        </div>
      </section>
    </div>
  );
}

function SecurityDialog({ open, onClose, onRotate, busy }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  useEffect(() => {
    if (open) {
      setPassphrase('');
      setConfirmPassphrase('');
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop vault-dialog-backdrop" onMouseDown={onClose}>
      <form className="small-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onRotate(passphrase, confirmPassphrase); }}>
        <header className="modal-header">
          <div><span className="eyebrow">Security</span><h2>Change passphrase</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        <p className="settings-copy">Every private item will be re-encrypted with a fresh key. Your typing shortcut will use the new passphrase immediately.</p>
        <label className="field-label">New passphrase
          <input autoFocus className="text-input" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="At least 8 characters" />
        </label>
        <label className="field-label">Confirm new passphrase
          <input className="text-input" type="password" autoComplete="new-password" value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} placeholder="Type it again" />
        </label>
        <div className="security-note"><ShieldCheck size={14} /> The update is applied atomically after all items are successfully re-encrypted.</div>
        <button className="primary-button full-width" disabled={busy}>{busy ? 'Re-encrypting…' : 'Change passphrase'}</button>
      </form>
    </div>
  );
}

function BackupDialog({ open, onClose, onExport, busy }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (open) {
      setPassphrase('');
      setConfirmation('');
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop vault-dialog-backdrop" onMouseDown={onClose}>
      <form className="small-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onExport(passphrase, confirmation); }}>
        <header className="modal-header">
          <div><span className="eyebrow">Portable archive</span><h2>Back up private space</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        <p className="settings-copy">The complete workspace will become one authenticated ciphertext. This archive passphrase will also unlock the restored vault on another device.</p>
        <label className="field-label">Archive passphrase
          <input autoFocus className="text-input" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="At least 8 characters" />
        </label>
        <label className="field-label">Confirm archive passphrase
          <input className="text-input" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Type it again" />
        </label>
        <div className="security-note"><DatabaseBackup size={14} /> Keep both the archive and its passphrase. There is no recovery if either is lost.</div>
        <button className="primary-button full-width" disabled={busy}>{busy ? 'Encrypting archive…' : 'Create encrypted backup'}</button>
      </form>
    </div>
  );
}

function Vault({ encryptionKey, onEncryptionKeyChange, onLock, notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState('all');
  const [destinationFolder, setDestinationFolder] = useState('');
  const [noteDialog, setNoteDialog] = useState(false);
  const [securityDialog, setSecurityDialog] = useState(false);
  const [backupDialog, setBackupDialog] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  useVaultAutoLock(onLock);

  const loadItems = async () => {
    setLoading(true);
    try {
      const records = await getAllVaultRecords();
      const decrypted = await Promise.all(records.map(async (record) => {
        try {
          return await decryptVaultMetadata(encryptionKey, record);
        } catch {
          return null;
        }
      }));
      setItems(decrypted.filter(Boolean).sort((a, b) => b.addedAt - a.addedAt));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const folders = useMemo(() => [...new Set(items.map((item) => item.folder?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const visibleItems = useMemo(() => items.filter((item) => {
    const matchesFolder = folderFilter === 'all' || (folderFilter === 'unfiled' ? !item.folder : item.folder === folderFilter);
    return matchesFolder && item.name.toLowerCase().includes(query.toLowerCase());
  }), [items, query, folderFilter]);
  const totalSize = items.reduce((sum, item) => sum + (item.size || 0), 0);

  const saveFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (files.some((file) => file.size > MAX_FILE_SIZE)) return notify('Each file must be 25 MB or smaller', 'error');

    setBusy(true);
    try {
      for (const file of files) {
        const now = Date.now();
        const metadata = {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type || 'application/octet-stream',
          kind: 'file',
          folder: destinationFolder.trim(),
          size: file.size,
          addedAt: now,
          updatedAt: now,
        };
        const record = await encryptVaultRecord(encryptionKey, metadata, await file.arrayBuffer());
        await putVaultRecord(record);
      }
      await loadItems();
      notify(`${files.length} encrypted item${files.length === 1 ? '' : 's'} added`);
    } catch (error) {
      console.error(error);
      notify('Could not encrypt that file', 'error');
    } finally {
      setBusy(false);
    }
  };

  const savePrivateNote = async (name, text, folder) => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const now = Date.now();
      const content = textToBytes(text);
      const metadata = {
        id: crypto.randomUUID(),
        name: name.trim(),
        type: 'text/plain',
        kind: 'note',
        folder: folder.trim(),
        size: content.byteLength,
        addedAt: now,
        updatedAt: now,
      };
      await putVaultRecord(await encryptVaultRecord(encryptionKey, metadata, content));
      setNoteDialog(false);
      await loadItems();
      notify('Private note encrypted');
    } catch (error) {
      console.error(error);
      notify('Could not save private note', 'error');
    } finally {
      setBusy(false);
    }
  };

  const decryptItem = async (item) => {
    const record = await getVaultRecord(item.id);
    if (!record) throw new Error('Encrypted item was not found.');
    return decryptVaultContent(encryptionKey, record);
  };

  const downloadItem = async (item) => {
    setBusy(true);
    try {
      const bytes = await decryptItem(item);
      downloadBlob(new Blob([bytes], { type: item.type }), item.name);
      notify('Decrypted download ready');
    } catch (error) {
      console.error(error);
      notify('Could not decrypt this item', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openItem = async (item) => {
    setBusy(true);
    try {
      const bytes = await decryptItem(item);
      if (item.kind === 'note' || item.type.startsWith('text/')) {
        setPreview({ kind: 'text', name: item.name, text: bytesToText(bytes) });
      } else if (item.type.startsWith('image/')) {
        setPreview({ kind: 'image', name: item.name, url: URL.createObjectURL(new Blob([bytes], { type: item.type })) });
      } else if (item.type === 'application/pdf') {
        setPreview({ kind: 'pdf', name: item.name, url: URL.createObjectURL(new Blob([bytes], { type: item.type })) });
      } else {
        downloadBlob(new Blob([bytes], { type: item.type }), item.name);
      }
    } catch (error) {
      console.error(error);
      notify('Could not decrypt this item', 'error');
    } finally {
      setBusy(false);
    }
  };

  const moveItem = async (item) => {
    const folder = window.prompt('Move to encrypted folder (leave blank for Unfiled):', item.folder || '');
    if (folder === null) return;
    setBusy(true);
    try {
      const content = await decryptItem(item);
      const metadata = { ...item, folder: folder.trim().slice(0, 60), updatedAt: Date.now() };
      await putVaultRecord(await encryptVaultRecord(encryptionKey, metadata, content));
      setItems((current) => current.map((entry) => entry.id === item.id ? metadata : entry));
      notify(metadata.folder ? `Moved to ${metadata.folder}` : 'Moved to Unfiled');
    } catch (error) {
      console.error(error);
      notify('Could not move this item', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm(`Permanently erase “${item.name}”?`)) return;
    await deleteVaultRecord(item.id);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    notify('Encrypted item erased');
  };

  const exportPortableBackup = async (passphrase, confirmation) => {
    if (passphrase.length < 8) return notify('Use at least 8 characters', 'error');
    if (passphrase.trim() !== passphrase) return notify('Passphrase cannot start or end with a space', 'error');
    if (passphrase !== confirmation) return notify('Passphrases do not match', 'error');

    setBusy(true);
    try {
      const records = await getAllVaultRecords();
      const archive = await createPortableVaultArchive({ records, vaultKey: encryptionKey, passphrase });
      downloadBlob(new Blob([archive], { type: 'application/vnd.quiet-notes.vault+json' }), `quiet-notes-vault-${new Date().toISOString().slice(0, 10)}.qnvault`);
      setBackupDialog(false);
      notify(`Portable backup created with ${records.length} item${records.length === 1 ? '' : 's'}`);
    } catch (error) {
      console.error(error);
      notify('Could not create the portable backup', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rotatePassphrase = async (passphrase, confirmation) => {
    if (passphrase.length < 8) return notify('Use at least 8 characters', 'error');
    if (passphrase.trim() !== passphrase) return notify('Passphrase cannot start or end with a space', 'error');
    if (passphrase !== confirmation) return notify('Passphrases do not match', 'error');

    setBusy(true);
    try {
      const records = await getAllVaultRecords();
      const { key: newKey, config } = await createVaultConfig(passphrase);
      const reencrypted = await Promise.all(records.map((record) => reencryptVaultRecord(encryptionKey, newKey, record)));
      await replaceVaultWithConfig(reencrypted, config);
      onEncryptionKeyChange(newKey);
      setSecurityDialog(false);
      notify('Passphrase changed and items re-encrypted');
    } catch (error) {
      console.error(error);
      notify('Could not change the passphrase', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="vault-shell">
      <header className="vault-topbar">
        <div className="vault-brand">
          <div className="vault-brand-mark"><FolderLock size={22} /></div>
          <div><span className="eyebrow">Private workspace</span><h1>Secure space</h1></div>
        </div>
        <div className="vault-top-actions">
          <button className="lock-button" onClick={() => setBackupDialog(true)}><DatabaseBackup size={16} /> Backup</button>
          <button className="lock-button" onClick={() => setSecurityDialog(true)}><KeyRound size={16} /> Security</button>
          <button className="lock-button" onClick={onLock}><Lock size={16} /> Lock & close</button>
        </div>
      </header>

      <section className="vault-hero">
        <div>
          <span className="security-pill"><ShieldCheck size={14} /> End-to-end local encryption</span>
          <h2>Only open while you’re here.</h2>
          <p>Files and private notes are encrypted before they enter browser storage. The key exists only in this open session.</p>
        </div>
        <div className="vault-stats">
          <strong>{items.length}</strong><span>items</span>
          <i />
          <strong>{formatBytes(totalSize)}</strong><span>encrypted</span>
        </div>
      </section>

      <section className="vault-content">
        <div className="vault-toolbar">
          <div className="vault-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search private items" /></div>
          <div className="vault-actions">
            <button className="secondary-button" onClick={() => setNoteDialog(true)}><FileText size={16} /> Private note</button>
            <button className="primary-button" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={16} /> {busy ? 'Working…' : 'Add files'}</button>
            <input ref={fileRef} hidden type="file" multiple onChange={saveFiles} />
          </div>
        </div>

        <div className="vault-folderbar">
          <div className="folder-chips" aria-label="Encrypted folders">
            <button className={folderFilter === 'all' ? 'active' : ''} onClick={() => setFolderFilter('all')}><Folder size={14} /> All</button>
            <button className={folderFilter === 'unfiled' ? 'active' : ''} onClick={() => setFolderFilter('unfiled')}>Unfiled</button>
            {folders.map((folderName) => <button key={folderName} className={folderFilter === folderName ? 'active' : ''} onClick={() => setFolderFilter(folderName)}>{folderName}</button>)}
          </div>
          <label className="vault-destination"><FolderPlus size={15} /><span>Save new files to</span>
            <input list="vault-upload-folder-options" value={destinationFolder} onChange={(event) => setDestinationFolder(event.target.value)} placeholder="Unfiled" maxLength={60} />
            <datalist id="vault-upload-folder-options">{folders.map((folderName) => <option key={folderName} value={folderName} />)}</datalist>
          </label>
        </div>

        <div className="storage-notice"><HardDrive size={15} /><span><strong>No cloud sync.</strong> Encrypted bytes live in this browser profile and disappear if its site data is cleared.</span></div>

        {loading ? (
          <div className="vault-empty"><div className="spinner" /><p>Unlocking your items…</p></div>
        ) : visibleItems.length ? (
          <div className="vault-grid">
            {visibleItems.map((item) => (
              <article className="vault-card" key={item.id}>
                <button className="vault-card-main" onClick={() => openItem(item)}>
                  <div className={`file-icon ${item.type?.startsWith('image/') ? 'image' : ''}`}><FileTypeIcon item={item} /></div>
                  <div className="file-info"><strong>{item.name}</strong><span>{item.folder ? `${item.folder} · ` : ''}{formatBytes(item.size)} · {formatListDate(item.addedAt)}</span></div>
                  <ChevronRight size={18} />
                </button>
                <div className="vault-card-actions">
                  <button onClick={() => moveItem(item)} aria-label={`Move ${item.name} to folder`}><Folder size={15} /></button>
                  <button onClick={() => downloadItem(item)} aria-label={`Download ${item.name}`}><Download size={15} /></button>
                  <button onClick={() => removeItem(item)} aria-label={`Delete ${item.name}`}><Trash2 size={15} /></button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="vault-empty">
            <div className="empty-illustration dark"><Archive size={34} strokeWidth={1.6} /></div>
            <h3>{query || folderFilter !== 'all' ? 'Nothing matches this view' : 'Your private space is empty'}</h3>
            <p>{query || folderFilter !== 'all' ? 'Try a different search or folder.' : 'Add a file or create a private note. Everything is encrypted before it is stored.'}</p>
          </div>
        )}
      </section>

      <PrivateNoteDialog open={noteDialog} onClose={() => setNoteDialog(false)} onSave={savePrivateNote} busy={busy} folders={folders} defaultFolder={destinationFolder} />
      <SecurityDialog open={securityDialog} onClose={() => setSecurityDialog(false)} onRotate={rotatePassphrase} busy={busy} />
      <BackupDialog open={backupDialog} onClose={() => setBackupDialog(false)} onExport={exportPortableBackup} busy={busy} />
      <PreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </main>
  );
}

export default function App() {
  const [notes, setNotes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [folders, setFolders] = useState([]);
  const [folderFilter, setFolderFilter] = useState('all');
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('quiet-notes-sort') || 'updated');
  const [theme, setTheme] = useState(() => localStorage.getItem('quiet-notes-theme') || 'light');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [encryptionKey, setEncryptionKey] = useState(null);
  const [view, setView] = useState('notes');
  const [saveState, setSaveState] = useState('Saved');
  const [toast, setToast] = useState(null);
  const [mobilePane, setMobilePane] = useState('list');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const toastTimer = useRef(null);
  const triggerAttempt = useRef(0);
  const bodyInputRef = useRef(null);
  const moreMenuRef = useRef(null);

  const notify = (message, kind = '') => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 2_600);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('quiet-notes-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('quiet-notes-sort', sortBy);
  }, [sortBy]);

  useEffect(() => {
    if (!moreMenuOpen) return undefined;
    const closeMenu = (event) => {
      if (!moreMenuRef.current?.contains(event.target)) setMoreMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [moreMenuOpen]);

  useEffect(() => {
    let mounted = true;
    Promise.all([getAllNotes(), getMeta('vaultConfig'), getMeta('noteFolders')]).then(async ([savedNotes, config, savedFolders]) => {
      if (!mounted) return;
      if (!savedNotes.length) {
        const first = makeNote();
        await putNote(first);
        if (!mounted) return;
        setNotes([first]);
        setActiveId(first.id);
      } else {
        setNotes(savedNotes);
        setActiveId(savedNotes[0].id);
      }
      setVaultConfigured(Boolean(config));
      setFolders(Array.isArray(savedFolders) ? savedFolders : []);
      setLoaded(true);
    }).catch((error) => {
      console.error(error);
      notify('Could not open local notes storage', 'error');
      setLoaded(true);
    });
    return () => { mounted = false; };
  }, []);

  const sortedNotes = useMemo(() => [...notes].sort((a, b) => {
    const pinOrder = Number(b.pinned) - Number(a.pinned);
    if (pinOrder) return pinOrder;
    if (sortBy === 'created') return b.createdAt - a.createdAt;
    if (sortBy === 'title') return titleFor(a).localeCompare(titleFor(b));
    return b.updatedAt - a.updatedAt;
  }), [notes, sortBy]);
  const visibleNotes = useMemo(() => sortedNotes.filter((note) => {
    if (filter === 'pinned' && !note.pinned) return false;
    if (folderFilter !== 'all' && (note.folderId || '') !== folderFilter) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${note.title} ${note.body}`.toLowerCase().includes(needle);
  }), [sortedNotes, query, filter, folderFilter]);
  const currentNote = notes.find((note) => note.id === activeId) || null;

  useEffect(() => {
    if (!loaded || !currentNote) return;
    const privateCandidate = currentNote.triggerEligible && !currentNote.title && isPotentialTriggerBody(currentNote.body);
    if (privateCandidate) return;

    setSaveState('Saving…');
    const timer = window.setTimeout(async () => {
      try {
        await putNote(currentNote);
        setSaveState('Saved');
      } catch {
        setSaveState('Could not save');
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [loaded, currentNote?.id, currentNote?.title, currentNote?.body, currentNote?.folderId, currentNote?.pinned, currentNote?.updatedAt]);

  useEffect(() => {
    if (!vaultConfigured || !currentNote?.triggerEligible || currentNote.title) return;
    const line = triggerLine(currentNote.body);
    if (!line.startsWith(TRIGGER_PREFIX) || line.includes('\n')) return;
    const candidate = line.slice(TRIGGER_PREFIX.length);
    if (!candidate) return;

    const attemptNumber = ++triggerAttempt.current;
    const timer = window.setTimeout(async () => {
      const config = await getMeta('vaultConfig');
      const key = await unlockVault(candidate, config);
      if (!key || attemptNumber !== triggerAttempt.current) return;

      await deleteNote(currentNote.id);
      const remaining = notes.filter((note) => note.id !== currentNote.id);
      setNotes(remaining);
      setActiveId(remaining[0]?.id || null);
      setEncryptionKey(key);
      setView('vault');
      setMobilePane('list');
    }, currentNote.body.endsWith('\n') ? 40 : 650);

    return () => window.clearTimeout(timer);
  }, [currentNote?.body, currentNote?.title, currentNote?.triggerEligible, currentNote?.id, vaultConfigured]);

  const createNote = async () => {
    const note = makeNote(folderFilter === 'all' ? '' : folderFilter);
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
    setFilter('all');
    setQuery('');
    setMobilePane('editor');
    await putNote(note);
  };

  const selectNote = (id) => {
    setActiveId(id);
    setMoreMenuOpen(false);
    setMobilePane('editor');
  };

  const updateCurrent = (field, value) => {
    if (!activeId) return;
    setNotes((current) => current.map((note) => {
      if (note.id !== activeId) return note;
      const next = { ...note, [field]: value, updatedAt: Date.now() };
      if (note.triggerEligible) {
        const title = field === 'title' ? value : note.title;
        const body = field === 'body' ? value : note.body;
        next.triggerEligible = !title && isPotentialTriggerBody(body);
      }
      return next;
    }));
  };

  const createFolder = async (assignToCurrent = false) => {
    const name = window.prompt('Name this folder:')?.trim();
    if (!name) return;
    if (folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) return notify('That folder already exists', 'error');
    const folder = { id: crypto.randomUUID(), name: name.slice(0, 50) };
    const updated = [...folders, folder];
    setFolders(updated);
    await setMeta('noteFolders', updated);
    if (assignToCurrent && currentNote) updateCurrent('folderId', folder.id);
    else setFolderFilter(folder.id);
    notify('Folder created');
  };

  const applyInlineFormat = (before, after = before, placeholder = 'text') => {
    if (!currentNote || !bodyInputRef.current) return;
    const input = bodyInputRef.current;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = currentNote.body.slice(start, end) || placeholder;
    const replacement = `${before}${selected}${after}`;
    updateCurrent('body', `${currentNote.body.slice(0, start)}${replacement}${currentNote.body.slice(end)}`);
    window.setTimeout(() => {
      input.focus();
      const selectionStart = start + before.length;
      input.setSelectionRange(selectionStart, selectionStart + selected.length);
    });
  };

  const applyLineFormat = (marker) => {
    if (!currentNote || !bodyInputRef.current) return;
    const input = bodyInputRef.current;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const lineStart = currentNote.body.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const nextBreak = currentNote.body.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? currentNote.body.length : nextBreak;
    const selected = currentNote.body.slice(lineStart, lineEnd) || 'List item';
    const replacement = selected.split('\n').map((line) => `${marker}${line}`).join('\n');
    updateCurrent('body', `${currentNote.body.slice(0, lineStart)}${replacement}${currentNote.body.slice(lineEnd)}`);
    window.setTimeout(() => {
      input.focus();
      input.setSelectionRange(lineStart + marker.length, lineStart + replacement.length);
    });
  };

  const togglePin = async () => {
    if (!currentNote) return;
    const changed = { ...currentNote, pinned: !currentNote.pinned, updatedAt: Date.now() };
    setNotes((current) => current.map((note) => note.id === changed.id ? changed : note));
    await putNote(changed);
    notify(changed.pinned ? 'Note pinned' : 'Note unpinned');
  };

  const duplicateCurrent = async () => {
    if (!currentNote) return;
    const now = Date.now();
    const duplicate = {
      ...currentNote,
      id: crypto.randomUUID(),
      title: currentNote.title.trim() ? `${currentNote.title} (copy)` : '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      triggerEligible: false,
    };
    setNotes((current) => [duplicate, ...current]);
    setActiveId(duplicate.id);
    setMoreMenuOpen(false);
    await putNote(duplicate);
    notify('Note duplicated');
  };

  const copyCurrent = async () => {
    if (!currentNote) return;
    const text = currentNote.title.trim() ? `${currentNote.title}\n\n${currentNote.body}` : currentNote.body;
    try {
      await navigator.clipboard.writeText(text);
      setMoreMenuOpen(false);
      notify('Note copied to clipboard');
    } catch {
      notify('Clipboard access was blocked', 'error');
    }
  };

  const exportCurrent = () => {
    if (!currentNote) return;
    const heading = currentNote.title.trim();
    const text = heading ? `${heading}\n${'='.repeat(Math.min(heading.length, 80))}\n\n${currentNote.body}` : currentNote.body;
    const filename = `${titleFor(currentNote).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'note'}.txt`;
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
    setMoreMenuOpen(false);
    notify('Note exported');
  };

  const removeCurrent = async () => {
    if (!currentNote || !window.confirm(`Delete “${titleFor(currentNote)}”?`)) return;
    setMoreMenuOpen(false);
    await deleteNote(currentNote.id);
    const remaining = notes.filter((note) => note.id !== currentNote.id);
    setNotes(remaining);
    setActiveId(remaining[0]?.id || null);
    setMobilePane('list');
    notify('Note deleted');
  };

  const importNotes = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.notes)) throw new Error('Invalid backup');
      const folderMap = new Map();
      const importedFolders = Array.isArray(parsed.folders) ? parsed.folders.reduce((result, folder) => {
        const name = String(folder.name || '').trim().slice(0, 50);
        if (!name) return result;
        const existing = [...folders, ...result].find((entry) => entry.name.toLowerCase() === name.toLowerCase());
        const id = existing?.id || crypto.randomUUID();
        folderMap.set(folder.id, id);
        if (!existing) result.push({ id, name });
        return result;
      }, []) : [];
      const imported = parsed.notes.map((note) => ({
        id: crypto.randomUUID(),
        title: String(note.title || '').slice(0, 300),
        body: String(note.body || ''),
        folderId: folderMap.get(note.folderId) || '',
        createdAt: Number(note.createdAt) || Date.now(),
        updatedAt: Date.now(),
        pinned: Boolean(note.pinned),
        triggerEligible: false,
      }));
      const merged = [...imported, ...notes];
      const mergedFolders = [...folders, ...importedFolders];
      await Promise.all([replaceAllNotes(merged), setMeta('noteFolders', mergedFolders)]);
      setNotes(merged);
      setFolders(mergedFolders);
      setActiveId(imported[0]?.id || activeId);
      notify(`${imported.length} note${imported.length === 1 ? '' : 's'} imported`);
    } catch {
      notify('That file is not a valid Quiet Notes backup', 'error');
    }
  };

  const importVaultBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const passphrase = window.prompt('Enter the portable backup passphrase:');
      if (passphrase === null) return;
      const restored = await importPortableVaultArchive({ serializedArchive: await file.text(), passphrase });
      if (vaultConfigured && !window.confirm('Replace the current private space with this portable backup? Existing private items will be erased.')) return;
      await replaceVaultWithConfig(restored.records, restored.config);
      setVaultConfigured(true);
      notify(`Portable backup restored with ${restored.records.length} item${restored.records.length === 1 ? '' : 's'}`);
    } catch (error) {
      console.error(error);
      if (error.code === 'AUTH_FAILED') notify('Wrong backup passphrase or modified archive', 'error');
      else if (error.code?.startsWith('UNSUPPORTED_')) notify(error.message, 'error');
      else notify('That is not a valid Quiet Notes portable backup', 'error');
    }
  };

  const lockVault = () => {
    setEncryptionKey(null);
    setView('notes');
  };

  if (view === 'vault' && encryptionKey) {
    return <><Vault encryptionKey={encryptionKey} onEncryptionKeyChange={setEncryptionKey} onLock={lockVault} notify={notify} /><Toast toast={toast} /></>;
  }

  return (
    <div className={`app-shell mobile-${mobilePane}`}>
      <aside className="navigation-rail">
        <div className="brand-mark"><NotebookPen size={22} /></div>
        <nav>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => { setFilter('all'); setMobilePane('list'); }} aria-label="All notes"><FileText size={20} /><span>Notes</span></button>
          <button className={filter === 'pinned' ? 'active' : ''} onClick={() => { setFilter('pinned'); setMobilePane('list'); }} aria-label="Pinned notes"><Pin size={20} /><span>Pinned</span></button>
        </nav>
        <button className="rail-settings" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings size={20} /><span>Settings</span></button>
      </aside>

      <section className="note-browser">
        <header className="browser-header">
          <div>
            <span className="eyebrow">My notebook</span>
            <h1>{filter === 'pinned' ? 'Pinned' : folderFilter === 'all' ? 'All notes' : folderFilter === '' ? 'Unfiled' : folders.find((folder) => folder.id === folderFilter)?.name || 'Folder'}</h1>
          </div>
          <button className="new-note-button" onClick={createNote} aria-label="New note"><Plus size={20} /></button>
        </header>
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" /></label>
        <div className="browser-filters">
          <label className="compact-select"><Folder size={14} /><select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} aria-label="Filter by folder">
            <option value="all">All folders</option>
            <option value="">Unfiled</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select></label>
          <button className="compact-icon-button" onClick={() => createFolder(false)} aria-label="Create folder"><FolderPlus size={15} /></button>
          <label className="compact-select sort-select"><ArrowUpDown size={14} /><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort notes">
            <option value="updated">Updated</option>
            <option value="created">Created</option>
            <option value="title">Title</option>
          </select></label>
        </div>
        <div className="note-count">{visibleNotes.length} {visibleNotes.length === 1 ? 'note' : 'notes'}</div>
        <div className="note-list">
          {visibleNotes.map((note) => (
            <button className={`note-card ${note.id === activeId ? 'active' : ''}`} key={note.id} onClick={() => selectNote(note.id)}>
              <div className="note-card-heading"><strong>{titleFor(note)}</strong>{note.pinned && <Pin size={13} fill="currentColor" />}</div>
              <p>{previewFor(note)}</p>
              <span>{formatListDate(note.updatedAt)}</span>
            </button>
          ))}
          {!visibleNotes.length && (
            <div className="empty-list"><Search size={24} /><strong>No notes here</strong><span>{query ? 'Try another search.' : folderFilter !== 'all' ? 'Create or move a note into this folder.' : filter === 'pinned' ? 'Pin a note to keep it here.' : 'Create a new note to get started.'}</span></div>
          )}
        </div>
        <button className="mobile-settings" onClick={() => setSettingsOpen(true)}><Settings size={18} /> Settings</button>
      </section>

      <section className="editor-pane">
        {!loaded ? (
          <div className="empty-editor"><div className="spinner" /><p>Opening your notes…</p></div>
        ) : currentNote ? (
          <>
            <header className="editor-toolbar">
              <button className="mobile-back" onClick={() => setMobilePane('list')}><ArrowLeft size={20} /></button>
              <div className="save-state"><span className={saveState === 'Saved' ? 'saved-dot' : ''} />{saveState}</div>
              <div className="editor-actions">
                <button className={currentNote.pinned ? 'active' : ''} onClick={togglePin} aria-label="Pin note"><Pin size={18} fill={currentNote.pinned ? 'currentColor' : 'none'} /></button>
                <button onClick={removeCurrent} aria-label="Delete note"><Trash2 size={18} /></button>
                <div className="more-menu-wrap" ref={moreMenuRef}>
                  <button className={`more-menu-trigger ${moreMenuOpen ? 'active' : ''}`} onClick={() => setMoreMenuOpen((open) => !open)} onKeyDown={(event) => { if (event.key === 'Escape') setMoreMenuOpen(false); }} aria-label="More options" aria-haspopup="menu" aria-expanded={moreMenuOpen}><MoreHorizontal size={19} /></button>
                  {moreMenuOpen && (
                    <div className="note-more-menu" role="menu">
                      <button role="menuitem" onClick={copyCurrent}><Copy size={16} /><span>Copy note</span></button>
                      <button role="menuitem" onClick={duplicateCurrent}><FileText size={16} /><span>Duplicate note</span></button>
                      <button role="menuitem" onClick={exportCurrent}><Download size={16} /><span>Export as text</span></button>
                      <i />
                      <button role="menuitem" className="danger" onClick={removeCurrent}><Trash2 size={16} /><span>Delete note</span></button>
                    </div>
                  )}
                </div>
              </div>
            </header>
            <article className="editor-document">
              <input className="title-input" value={currentNote.title} onChange={(event) => updateCurrent('title', event.target.value)} placeholder="Untitled note" maxLength={300} />
              <div className="note-meta">
                <span><Clock3 size={14} /> {formatFullDate(currentNote.updatedAt)}</span>
                <label className="note-folder-select"><Folder size={14} /><select value={currentNote.folderId || ''} onChange={(event) => updateCurrent('folderId', event.target.value)} aria-label="Move note to folder">
                  <option value="">Unfiled</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select></label>
                <button className="inline-folder-button" onClick={() => createFolder(true)} aria-label="Create and assign folder"><FolderPlus size={14} /></button>
              </div>
              <div className="format-toolbar" aria-label="Text formatting">
                <button onClick={() => applyInlineFormat('**')} title="Bold"><Bold size={16} /></button>
                <button onClick={() => applyInlineFormat('_')} title="Italic"><Italic size={16} /></button>
                <button onClick={() => applyLineFormat('- ')} title="Bullet list"><List size={17} /></button>
                <button onClick={() => applyLineFormat('- [ ] ')} title="Checklist"><ListChecks size={17} /></button>
                <button onClick={() => applyInlineFormat('`')} title="Inline code"><Code2 size={16} /></button>
                <span>Markdown formatting</span>
              </div>
              <textarea ref={bodyInputRef} className="body-input" value={currentNote.body} onChange={(event) => updateCurrent('body', event.target.value)} placeholder="Start writing…" spellCheck="true" />
              <footer className="editor-footer">
                <span>{currentNote.body.trim() ? currentNote.body.trim().split(/\s+/).length : 0} words</span>
                <span>{currentNote.body.length} characters</span>
              </footer>
            </article>
          </>
        ) : <EmptyNotes onCreate={createNote} />}
      </section>

      <button className="mobile-fab" onClick={createNote}><Plus size={22} /></button>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        notes={notes}
        folders={folders}
        onImport={importNotes}
        vaultConfigured={vaultConfigured}
        onVaultConfigured={setVaultConfigured}
        onImportVaultBackup={importVaultBackup}
        notify={notify}
      />
      <Toast toast={toast} />
    </div>
  );
}
