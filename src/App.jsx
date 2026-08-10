import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  Download,
  File,
  FileImage,
  FileText,
  FolderLock,
  HardDrive,
  Image,
  Lock,
  Menu,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Palette,
  Paperclip,
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
  setMeta,
} from './db';
import {
  bytesToText,
  createVaultConfig,
  decryptVaultContent,
  decryptVaultMetadata,
  encryptVaultRecord,
  textToBytes,
  unlockVault,
} from './crypto';

const TRIGGER_PREFIX = 'Password = ';
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function triggerLine(body = '') {
  return body.endsWith('\n') ? body.slice(0, -1) : body;
}

function isPotentialTriggerBody(body = '') {
  const line = triggerLine(body);
  return !line.includes('\n') && (TRIGGER_PREFIX.startsWith(line) || line.startsWith(TRIGGER_PREFIX));
}

function makeNote() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '',
    body: '',
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
  onImport,
  vaultConfigured,
  onVaultConfigured,
  notify,
}) {
  const [versionTaps, setVersionTaps] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [saving, setSaving] = useState(false);
  const importRef = useRef(null);

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
    const payload = JSON.stringify({ app: 'Quiet Notes', version: 1, exportedAt: new Date().toISOString(), notes: cleanNotes }, null, 2);
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
                </form>
              ) : (
                <div className="configured-vault">
                  <div className="configured-row">
                    <span className="status-dot" />
                    <div><strong>Private space enabled</strong><small>Encrypted with AES-GCM</small></div>
                  </div>
                  <button className="danger-text-button" onClick={eraseVault}><Trash2 size={15} /> Erase private space</button>
                </div>
              )}
              <div className="security-note"><Lock size={14} /> Losing the passphrase means losing access. There is no recovery or cloud copy.</div>
            </div>
          )}

          <button className="version-row" onClick={() => setVersionTaps((value) => Math.min(5, value + 1))} aria-label="Application version">
            <span><Sparkles size={15} /> Quiet Notes</span>
            <span>Version 1.0.0</span>
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

function PrivateNoteDialog({ open, onClose, onSave, busy }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setText('');
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop vault-dialog-backdrop" onMouseDown={onClose}>
      <form className="small-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSave(name, text); }}>
        <header className="modal-header">
          <div><span className="eyebrow">Encrypted item</span><h2>New private note</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        <label className="field-label">Name
          <input autoFocus className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Note name" maxLength={120} />
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

function Vault({ encryptionKey, onLock, notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [noteDialog, setNoteDialog] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

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

  useEffect(() => {
    let timer;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onLock, 5 * 60 * 1000);
    };
    const events = ['pointerdown', 'keydown', 'mousemove'];
    events.forEach((eventName) => window.addEventListener(eventName, arm));
    arm();
    return () => {
      window.clearTimeout(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, arm));
    };
  }, [onLock]);

  const visibleItems = useMemo(() => items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [items, query]);
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

  const savePrivateNote = async (name, text) => {
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

  const removeItem = async (item) => {
    if (!window.confirm(`Permanently erase “${item.name}”?`)) return;
    await deleteVaultRecord(item.id);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    notify('Encrypted item erased');
  };

  return (
    <main className="vault-shell">
      <header className="vault-topbar">
        <div className="vault-brand">
          <div className="vault-brand-mark"><FolderLock size={22} /></div>
          <div><span className="eyebrow">Private workspace</span><h1>Secure space</h1></div>
        </div>
        <button className="lock-button" onClick={onLock}><Lock size={16} /> Lock & close</button>
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

        <div className="storage-notice"><HardDrive size={15} /><span><strong>No cloud sync.</strong> Encrypted bytes live in this browser profile and disappear if its site data is cleared.</span></div>

        {loading ? (
          <div className="vault-empty"><div className="spinner" /><p>Unlocking your items…</p></div>
        ) : visibleItems.length ? (
          <div className="vault-grid">
            {visibleItems.map((item) => (
              <article className="vault-card" key={item.id}>
                <button className="vault-card-main" onClick={() => openItem(item)}>
                  <div className={`file-icon ${item.type?.startsWith('image/') ? 'image' : ''}`}><FileTypeIcon item={item} /></div>
                  <div className="file-info"><strong>{item.name}</strong><span>{formatBytes(item.size)} · {formatListDate(item.addedAt)}</span></div>
                  <ChevronRight size={18} />
                </button>
                <div className="vault-card-actions">
                  <button onClick={() => downloadItem(item)} aria-label={`Download ${item.name}`}><Download size={15} /></button>
                  <button onClick={() => removeItem(item)} aria-label={`Delete ${item.name}`}><Trash2 size={15} /></button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="vault-empty">
            <div className="empty-illustration dark"><Archive size={34} strokeWidth={1.6} /></div>
            <h3>{query ? 'Nothing matches that search' : 'Your private space is empty'}</h3>
            <p>{query ? 'Try a different name.' : 'Add a file or create a private note. Everything is encrypted before it is stored.'}</p>
          </div>
        )}
      </section>

      <PrivateNoteDialog open={noteDialog} onClose={() => setNoteDialog(false)} onSave={savePrivateNote} busy={busy} />
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
  const [theme, setTheme] = useState(() => localStorage.getItem('quiet-notes-theme') || 'light');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [encryptionKey, setEncryptionKey] = useState(null);
  const [view, setView] = useState('notes');
  const [saveState, setSaveState] = useState('Saved');
  const [toast, setToast] = useState(null);
  const [mobilePane, setMobilePane] = useState('list');
  const toastTimer = useRef(null);
  const triggerAttempt = useRef(0);

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
    let mounted = true;
    Promise.all([getAllNotes(), getMeta('vaultConfig')]).then(async ([savedNotes, config]) => {
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
      setLoaded(true);
    }).catch((error) => {
      console.error(error);
      notify('Could not open local notes storage', 'error');
      setLoaded(true);
    });
    return () => { mounted = false; };
  }, []);

  const sortedNotes = useMemo(() => [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), [notes]);
  const visibleNotes = useMemo(() => sortedNotes.filter((note) => {
    if (filter === 'pinned' && !note.pinned) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${note.title} ${note.body}`.toLowerCase().includes(needle);
  }), [sortedNotes, query, filter]);
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
  }, [loaded, currentNote?.id, currentNote?.title, currentNote?.body, currentNote?.pinned, currentNote?.updatedAt]);

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
    const note = makeNote();
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
    setFilter('all');
    setQuery('');
    setMobilePane('editor');
    await putNote(note);
  };

  const selectNote = (id) => {
    setActiveId(id);
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

  const togglePin = async () => {
    if (!currentNote) return;
    const changed = { ...currentNote, pinned: !currentNote.pinned, updatedAt: Date.now() };
    setNotes((current) => current.map((note) => note.id === changed.id ? changed : note));
    await putNote(changed);
    notify(changed.pinned ? 'Note pinned' : 'Note unpinned');
  };

  const removeCurrent = async () => {
    if (!currentNote || !window.confirm(`Delete “${titleFor(currentNote)}”?`)) return;
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
      const imported = parsed.notes.map((note) => ({
        id: crypto.randomUUID(),
        title: String(note.title || '').slice(0, 300),
        body: String(note.body || ''),
        createdAt: Number(note.createdAt) || Date.now(),
        updatedAt: Date.now(),
        pinned: Boolean(note.pinned),
        triggerEligible: false,
      }));
      const merged = [...imported, ...notes];
      await replaceAllNotes(merged);
      setNotes(merged);
      setActiveId(imported[0]?.id || activeId);
      notify(`${imported.length} note${imported.length === 1 ? '' : 's'} imported`);
    } catch {
      notify('That file is not a valid Quiet Notes backup', 'error');
    }
  };

  const lockVault = () => {
    setEncryptionKey(null);
    setView('notes');
  };

  if (view === 'vault' && encryptionKey) {
    return <><Vault encryptionKey={encryptionKey} onLock={lockVault} notify={notify} /><Toast toast={toast} /></>;
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
            <h1>{filter === 'pinned' ? 'Pinned' : 'All notes'}</h1>
          </div>
          <button className="new-note-button" onClick={createNote} aria-label="New note"><Plus size={20} /></button>
        </header>
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" /></label>
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
            <div className="empty-list"><Search size={24} /><strong>No notes here</strong><span>{query ? 'Try another search.' : 'Pin a note to keep it here.'}</span></div>
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
                <button aria-label="More options"><MoreHorizontal size={19} /></button>
              </div>
            </header>
            <article className="editor-document">
              <input className="title-input" value={currentNote.title} onChange={(event) => updateCurrent('title', event.target.value)} placeholder="Untitled note" maxLength={300} />
              <div className="note-meta"><Clock3 size={14} /> {formatFullDate(currentNote.updatedAt)}</div>
              <textarea className="body-input" value={currentNote.body} onChange={(event) => updateCurrent('body', event.target.value)} placeholder="Start writing…" spellCheck="true" />
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
        onImport={importNotes}
        vaultConfigured={vaultConfigured}
        onVaultConfigured={setVaultConfigured}
        notify={notify}
      />
      <Toast toast={toast} />
    </div>
  );
}
