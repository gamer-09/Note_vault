# Quiet Notes Threat Model

## Purpose and scope

Quiet Notes is an ordinary local notepad with a concealed private workspace. The private workspace encrypts its contents at rest in the browser with AES-256-GCM. Its key is derived from the passphrase with PBKDF2-SHA-256 using 310,000 iterations and a random 16-byte salt. The unlocked `CryptoKey` is non-extractable, exists only in memory, and is cleared after five minutes of inactivity or when the vault is locked.

This document describes the intended security boundary. It is not a claim that the application can make data physically invisible, resist a compromised operating system, or provide forensic deniability.

## Assets being protected

Inside the private workspace:

- File contents
- Private-note contents
- Original filenames and MIME types
- Encrypted folder names
- Encrypted item metadata such as names, types, folders, and declared content sizes
- Portable `.qnvault` archive contents

Ordinary notes are outside this boundary and are stored locally without encryption.

## What it is intended to protect against

### Casual browser-storage inspection

Someone browsing IndexedDB, copying the browser profile, or searching the disk should not see private filenames or readable private content without the passphrase. They can still see that Quiet Notes has stored encrypted data.

### Another user of the same machine while the vault is locked

A person using the browser or machine after the vault has been locked should not be able to decrypt the private workspace without the passphrase. This assumes they cannot access a still-unlocked operating-system session containing malicious monitoring software.

### Casual screen glances while the vault is closed

The normal notepad does not advertise the private workspace, and the temporary trigger note is deleted after a successful unlock. A person glancing at the normal notepad or locked state should not see vault contents.

This does **not** protect against someone viewing or photographing the screen while the private workspace is open.

### Modification of encrypted records or archives

AES-GCM authentication causes modified ciphertext to fail decryption rather than produce unauthenticated garbage. Portable archives also fail closed when their ciphertext is changed or the passphrase is wrong.

### Loss or copying of a portable archive

A copied `.qnvault` file does not expose its filenames, folders, metadata, or contents without its archive passphrase. The format version, KDF parameters, salt, IV, and ciphertext length remain visible.

## What it explicitly does not protect against

### Malicious browser extensions

An extension with sufficient page or browser permissions may read keystrokes, observe the DOM, intercept file data, or capture decrypted content while the vault is open.

### Keyloggers and screen-capture software

A keylogger can capture the trigger passphrase. Screen recording, screenshots, cameras, or remote-desktop software can capture content displayed while unlocked.

### Physical access while unlocked

Anyone who can use the device while the vault is open can read, copy, download, modify, or erase private items. Auto-lock reduces this window but does not eliminate it.

### A compromised operating system or browser

Administrator-level malware, a compromised browser runtime, injected JavaScript, memory inspection, or a hostile application update can defeat this design. Client-side encryption cannot protect plaintext from the environment that must decrypt and display it.

### Weak passphrases and offline guessing

An attacker with copied encrypted records or a `.qnvault` archive can attempt passphrase guesses offline. PBKDF2 increases the cost of each guess but cannot make a short or reused passphrase strong.

### Secure deletion and forensic erasure

Deleting an item, clearing IndexedDB, or clearing site data does not guarantee physical overwrite of SSD, browser-cache, backup, swap, or filesystem remnants. Quiet Notes does not provide secure deletion or anti-forensic guarantees.

### Denial of service

A person with browser-profile access can delete or corrupt site data. Encryption protects confidentiality and detects ciphertext modification; it does not guarantee availability. There is no recovery service.

### Traffic and hosting compromise

The project has no application backend or cloud synchronization, but a hosted copy still depends on its hosting provider, browser, dependencies, and update path. A compromised deployment could serve code that steals a passphrase or plaintext during use. Verify the deployment source and use a trusted HTTPS origin.

## Information that may remain visible

The local browser profile may reveal:

- That Quiet Notes and a private workspace have been used
- Vault configuration version, PBKDF2 iteration count, salt, and verification ciphertext
- The number of encrypted IndexedDB records
- Ciphertext sizes and approximate content sizes
- Record identifiers and some storage timestamps
- Application preferences and ordinary, unencrypted notes

The portable archive exposes only its format/KDF/cipher header and total ciphertext length, not its internal item count or item metadata.

## Security assumptions

The design assumes:

- The browser's Web Crypto implementation and random-number generator are correct
- AES-GCM IVs and salts generated by `crypto.getRandomValues` are unpredictable
- The user chooses a strong, unique passphrase and does not disclose it
- The application is loaded from a trusted build over HTTPS or localhost
- The device is not compromised while private content is being decrypted
- The user locks the vault before leaving the device

## Operational guidance

- Use a long, unique passphrase stored in a trusted password manager
- Keep the operating system, browser, and extensions updated
- Remove unnecessary browser extensions
- Lock the vault and the operating-system session before stepping away
- Keep tested portable backups in a separate location
- Protect the backup passphrase separately from the `.qnvault` file
- Use full-disk encryption such as BitLocker, FileVault, or LUKS for device-level protection

## Security claims not made

Quiet Notes is not presented as:

- A secure enclave or hardware-backed key store
- Protection against a hostile or monitored endpoint
- Plausible deniability or hidden-volume technology
- Guaranteed secure deletion
- A substitute for full-disk encryption
- A formally audited cryptographic product

Security issues should be reported privately to the repository owner before public disclosure when possible.
