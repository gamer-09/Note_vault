# Quiet Notes

A polished everyday notepad with a concealed, encrypted private workspace.

## What it does

- Create, edit, search, pin, and delete ordinary notes
- Autosave notes in the browser with light and dark themes
- Export/import normal notes as JSON backups
- Install as a PWA for an app-like desktop experience
- Open a private workspace through a typing shortcut on a completely blank new note
- Encrypt private files, filenames, file types, and private notes with AES-256-GCM
- Derive the encryption key from the passphrase with PBKDF2-SHA-256 (310,000 iterations)
- Keep the unlocked key in memory only and auto-lock after five minutes of inactivity
- Preview encrypted text, images, and PDFs; decrypt other files only when downloading

## Version 1.1 features

Six productivity and privacy additions are included:

1. **Note folders** — create folders, assign notes, and filter the notebook by folder.
2. **Formatting and checklists** — apply bold, italic, bullets, checkboxes, and inline-code Markdown from the editor toolbar.
3. **Flexible note sorting** — sort by last updated, creation date, or title while pinned notes stay first.
4. **Encrypted vault folders** — file new items into encrypted folders, filter by folder, and move existing items without exposing folder names in storage.
5. **Passphrase rotation** — change the vault passphrase from the unlocked Security panel; every item is atomically re-encrypted with a fresh key.
6. **Encrypted backup and restore** — export the raw encrypted vault as a `.qnvault` backup and restore it from the concealed Settings panel. The backup still requires its original passphrase.

Version 1.1.1 also activates the editor's **More options** menu with copy, duplicate, text export, and delete actions.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. For a production build:

```bash
npm run build
npm run preview
```

## Set up the concealed private workspace

1. Open **Settings**.
2. At the bottom, click the ordinary **Quiet Notes · Version 1.1.1** row five times.
3. Set and confirm a passphrase of at least eight characters.
4. Close Settings.
5. Create a completely blank new note.
6. In the body, type exactly:

   ```text
   Password = your passphrase
   ```

   Pause briefly or press Enter. The temporary blank note is deleted and the private workspace opens.
7. Use **Lock & close** to clear the key from memory and return to the notepad.

The trigger only works on a fresh note with a blank title. Trigger-like text is deliberately excluded from normal-note autosave while the note remains eligible, so the passphrase is not written into the notes database.

## Storage and security model

Private items are encrypted **before** being stored in IndexedDB. Their names, MIME types, and contents are not readable in browser storage without the passphrase. There is no backend, account, analytics service, or cloud sync in this project.

### Important, honest limitation

No application can store a file on a PC while also storing no bytes anywhere on that PC. Quiet Notes stores encrypted bytes inside the browser profile rather than visible plaintext files in Documents/Downloads. A normal file browser will not show the original filenames or readable contents, but forensic tools can still detect that encrypted application data exists.

- Clearing this site's browser data permanently erases the private workspace.
- Losing the passphrase permanently loses access; there is no recovery key.
- A compromised browser, malicious extension, keylogger, or malware running while the vault is unlocked can defeat client-side protection.
- Ordinary notes are local but **not encrypted**. Only items placed inside the private workspace are encrypted.
- The current per-file limit is 25 MB to avoid excessive browser-memory use.

For stronger OS-level protection, combine this app with full-disk encryption (BitLocker, FileVault, or LUKS) and a trusted browser profile.

## Project structure

```text
src/App.jsx       Main notes UI, hidden setup flow, and private workspace
src/crypto.js     PBKDF2 and AES-GCM helpers
src/db.js         IndexedDB persistence
src/styles.css    Responsive desktop/mobile styling
public/sw.js      Offline app-shell cache
```

## License

See [LICENSE](LICENSE).
