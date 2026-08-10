const DB_NAME = 'quiet-notes-data';
const DB_VERSION = 1;

let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('vaultItems')) {
        const vaultItems = db.createObjectStore('vaultItems', { keyPath: 'id' });
        vaultItems.createIndex('addedAt', 'addedAt');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The notes database is open in another tab.'));
  });

  return dbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, action) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const result = await action(store);

  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Database transaction was aborted.'));
  });

  return result;
}

export async function getAllNotes() {
  const notes = await withStore('notes', 'readonly', (store) => requestResult(store.getAll()));
  return notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export function putNote(note) {
  return withStore('notes', 'readwrite', (store) => requestResult(store.put(note)));
}

export function deleteNote(id) {
  return withStore('notes', 'readwrite', (store) => requestResult(store.delete(id)));
}

export function replaceAllNotes(notes) {
  return withStore('notes', 'readwrite', async (store) => {
    await requestResult(store.clear());
    for (const note of notes) await requestResult(store.put(note));
  });
}

export function getMeta(key) {
  return withStore('meta', 'readonly', (store) => requestResult(store.get(key))).then((entry) => entry?.value);
}

export function setMeta(key, value) {
  return withStore('meta', 'readwrite', (store) => requestResult(store.put({ key, value })));
}

export function deleteMeta(key) {
  return withStore('meta', 'readwrite', (store) => requestResult(store.delete(key)));
}

export function getAllVaultRecords() {
  return withStore('vaultItems', 'readonly', (store) => requestResult(store.getAll()));
}

export function getVaultRecord(id) {
  return withStore('vaultItems', 'readonly', (store) => requestResult(store.get(id)));
}

export function putVaultRecord(record) {
  return withStore('vaultItems', 'readwrite', (store) => requestResult(store.put(record)));
}

export function deleteVaultRecord(id) {
  return withStore('vaultItems', 'readwrite', (store) => requestResult(store.delete(id)));
}

export function clearVaultRecords() {
  return withStore('vaultItems', 'readwrite', (store) => requestResult(store.clear()));
}

export async function replaceVaultWithConfig(records, config) {
  const db = await openDatabase();
  const transaction = db.transaction(['vaultItems', 'meta'], 'readwrite');
  const vaultStore = transaction.objectStore('vaultItems');
  const metaStore = transaction.objectStore('meta');

  vaultStore.clear();
  records.forEach((record) => vaultStore.put(record));
  metaStore.put({ key: 'vaultConfig', value: config });

  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Vault update was aborted.'));
  });
}
