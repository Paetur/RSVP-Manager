# Encrypted backup files

Encryption is optional and independent of gzip compression. It protects a downloaded file; it does not change Full/Partial selection, checksums, database authorization or restore safeguards.

## Using encryption

Under Settings → Backups, select **Encrypt backup**, enter a backup password and repeat it. Download produces `.encrypted.json`, with optional gzip applied **before** encryption. Keep the password separately: the application cannot recover an encrypted file without it. Passwords are cleared after the export attempt and when leaving the backup screen; they are not saved in event settings, browser storage or RPC arguments.

On import, select the file normally. Encrypted files are recognized by their contents, regardless of filename. A password dialog appears only for a supported encrypted file. Incorrect passwords or corrupted ciphertext prevent opening and cannot reach database validation/restore. Use **Open encrypted backup** to retry; Cancel leaves validation/restore disabled. Successful decryption continues through the existing JSON/selection checks, Validate backup and restore confirmation/acknowledgement. It does not restore automatically.

Current unencrypted JSON and `.json.gz` files remain supported without modification. This adds no historical schema/export adapter. Full restore still accepts Full files only; Partial backup/restore excludes logs and still uses planning-template resets.

## Browser requirements

Encryption needs a secure context (HTTPS or localhost), Web Crypto, Web Workers and WebAssembly. Unsupported environments keep unencrypted backups available. A plain HTTP server reached through a LAN hostname is not a secure context.

For an HTTP-only development VM, a localhost tunnel can provide a trustworthy browser origin without changing server configuration:

```sh
ssh -L 8080:127.0.0.1:8080 USER@VM_HOST
```

Then open `http://localhost:8080/admin/` and sign in. Use the installation’s existing public backend configuration. This is an administrator backup-testing option, not authorization to change guest-gateway origins or bypass origin checks. Production installations should use HTTPS.

## File and cryptography contract

The encrypted outer envelope has `format: "rsvp-application-backup"`, `version: 1`, `compression: "none" | "gzip"`, `encryption` and Base64 `data`. The inner application backup remains the existing **version 2** envelope. The two versions describe different layers.

Encryption is native Web Crypto AES-256-GCM with a 128-bit authentication tag appended to ciphertext. Each export generates a new 16-byte random salt and 12-byte random nonce using `crypto.getRandomValues`. Argon2id version 1.3 derives a 32-byte key with memory 65,536 KiB, 3 iterations and parallelism 1. The key is imported as non-extractable. The password and raw key buffers are cleared where possible, and the disposable worker terminates after one operation. JavaScript strings and browser/runtime internal copies cannot be guaranteed to be zeroized.

Argon2id comes from self-hosted `libsodium-wrappers-sumo` / `libsodium-sumo` 0.8.4, pinned by the lockfile, with third-party licenses in [Cryptography notices](CryptographyNotices.md). The maintained upstream library has published independent audit history; the historical audit is not an independent audit of this particular wrapper release, Argon2id build or application integration. References: [libsodium API](https://doc.libsodium.org/password_hashing/default_phf), [upstream JavaScript bindings](https://github.com/jedisct1/libsodium.js), [published assessment scope](https://www.privateinternetaccess.com/blog/libsodium-v1-0-12-and-v1-0-13-security-assessment/). Local tests include an Argon2id known-answer vector independently checked with OpenSSL, plus actual Worker/WASM and AES-GCM browser round trips.

AAD is UTF-8 JSON with this fixed property order: `format`, `version`, `compression`, then `encryption` containing `algorithm`, `kdf`, `salt`, `nonce`, `parameters`; parameters contain `memoryKiB`, `iterations`, `parallelism`. All header fields are authenticated. Input object-property order is irrelevant because this representation is reconstructed; unknown fields are rejected. Binary fields require canonical padded Base64. Algorithms and versions must match the supported contract; failed authentication never falls back to a plaintext parser.

Before prompting or deriving a key, imports enforce memory 65,536–131,072 KiB in 1,024 KiB increments, iterations 3–4, parallelism exactly 1, and memory × iterations no greater than 393,216. Unsupported values are rejected before allocation. Only one local key derivation may run at a time, with a 90-second timeout. No silent weakening of parameters is allowed when memory is unavailable.

Opened JSON and compressed bytes retain the existing 20 MiB limit. Encrypted file size allows the bounded Base64 overhead: `ceil((20 MiB + 16) / 3) * 4 + 2048` bytes. Decompression is separately bounded, including after authentication. Encryption adds no secret server fields and no new database tables, APIs or restore permissions.

## Source and verification

`js/backup-crypto.ts` is the reusable source; `js/backup-crypto.js` is generated for the existing browser script architecture. `js/backup-kdf-worker.js` isolates password hashing; `js/backup-files.js` owns serialize/compress/encrypt and decrypt/decompress/parse. `js/admin-backup-encryption.js` owns password controls/dialog lifecycle. Compiled/vendor assets are included in static publication; no CDN is required at backup time.

```sh
node tools/build-backup-crypto.cjs
node tools/build-backup-crypto.cjs --check
node tools/build-backup-crypto.cjs --check-static
node tests/backup-files.cjs
node tests/backup-encryption.cjs
```

The static check is dependency-free for lightweight pushes and checks source/output/vendor hashes against the manifest and lockfile. The strict build uses pinned TypeScript 5.9.3 and compares generated output, vendors and licenses. Browser acceptance is `tests/backup-encryption-browser.cjs`; existing unencrypted EN/DE/FO acceptance is `tests/backup-compression-browser.cjs`. Full CI runs the stronger checks before release/hosted deployment.
