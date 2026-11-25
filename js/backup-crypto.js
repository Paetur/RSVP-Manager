"use strict";
(() => {
    "use strict";
    const FORMAT = "rsvp-application-backup", VERSION = 1;
    const MAX_BYTES = 20 * 1024 * 1024, MAX_CIPHER = MAX_BYTES + 16;
    const DEFAULTS = {
        memoryKiB: 65536,
        iterations: 3,
        parallelism: 1,
    };
    const workerURL = new URL("./backup-kdf-worker.js?v=20261114-backup-encryption", document.currentScript.src);
    let deriving = false;
    const fail = (message, code) => Object.assign(new Error(window.RSVP_I18N?.t(message) || message), { code });
    const unsupported = () => fail("Unsupported or damaged encrypted backup.", "BACKUP_ENCRYPTION_FORMAT");
    const canEncrypt = () => !!globalThis.crypto?.subtle &&
        typeof Worker === "function" &&
        typeof WebAssembly === "object";
    function object(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }
    function exact(value, keys) {
        if (!object(value) ||
            Object.keys(value).sort().join("|") !== [...keys].sort().join("|"))
            throw unsupported();
    }
    function base64(bytes) {
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(binary);
    }
    function unbase64(value, limit) {
        if (typeof value !== "string" ||
            value.length > Math.ceil(limit / 3) * 4 ||
            value.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
            throw unsupported();
        let binary;
        try {
            binary = atob(value);
        }
        catch {
            throw unsupported();
        }
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        if (bytes.length > limit || base64(bytes) !== value)
            throw unsupported();
        return bytes;
    }
    function inspect(value) {
        exact(value, ["format", "version", "compression", "encryption", "data"]);
        if (value.format !== FORMAT ||
            value.version !== VERSION ||
            !["none", "gzip"].includes(value.compression))
            throw unsupported();
        exact(value.encryption, [
            "algorithm",
            "kdf",
            "salt",
            "nonce",
            "parameters",
        ]);
        const e = value.encryption;
        if (e.algorithm !== "aes-256-gcm" || e.kdf !== "argon2id")
            throw unsupported();
        exact(e.parameters, ["memoryKiB", "iterations", "parallelism"]);
        const p = e.parameters;
        // Bound work before allocating memory, opening a worker, or asking for a password.
        if (!Number.isInteger(p.memoryKiB) ||
            !Number.isInteger(p.iterations) ||
            p.parallelism !== 1 ||
            p.memoryKiB < 65536 ||
            p.memoryKiB > 131072 ||
            p.memoryKiB % 1024 !== 0 ||
            p.iterations < 3 ||
            p.iterations > 4 ||
            p.memoryKiB * p.iterations > 393216)
            throw fail("Unsupported backup encryption parameters.", "BACKUP_KDF_PARAMETERS");
        if (unbase64(e.salt, 16).length !== 16 ||
            unbase64(e.nonce, 12).length !== 12 ||
            unbase64(value.data, MAX_CIPHER).length < 16)
            throw unsupported();
        return value;
    }
    // Reconstruct the exact v1 header in a fixed order. Unknown fields are rejected.
    function aad(value) {
        const e = value.encryption, p = e.parameters;
        return new TextEncoder().encode(JSON.stringify({
            format: value.format,
            version: value.version,
            compression: value.compression,
            encryption: {
                algorithm: e.algorithm,
                kdf: e.kdf,
                salt: e.salt,
                nonce: e.nonce,
                parameters: {
                    memoryKiB: p.memoryKiB,
                    iterations: p.iterations,
                    parallelism: p.parallelism,
                },
            },
        }));
    }
    async function derive(password, salt, parameters) {
        if (!canEncrypt())
            throw fail("Encryption requires HTTPS, Web Crypto and Web Workers. Unencrypted backups remain available.", "BACKUP_CRYPTO_UNAVAILABLE");
        if (typeof password !== "string" || !password.length)
            throw fail("Enter a backup password.", "BACKUP_PASSWORD_REQUIRED");
        const bytes = new TextEncoder().encode(password);
        if (bytes.length > 1024) {
            bytes.fill(0);
            throw fail("Backup password exceeds 1024 UTF-8 bytes.", "BACKUP_PASSWORD_LENGTH");
        }
        if (deriving) {
            bytes.fill(0);
            throw fail("Another backup encryption operation is running.", "BACKUP_CRYPTO_BUSY");
        }
        deriving = true;
        let worker, raw;
        try {
            raw = await new Promise((resolve, reject) => {
                worker = new Worker(workerURL);
                const timer = setTimeout(() => {
                    worker?.terminate();
                    reject(fail("Backup key derivation could not complete. Try again on a device with more available memory.", "BACKUP_KDF_FAILED"));
                }, 90000);
                const failed = () => {
                    clearTimeout(timer);
                    reject(fail("Backup key derivation could not complete. Try again on a device with more available memory.", "BACKUP_KDF_FAILED"));
                };
                worker.onerror = (event) => {
                    event.preventDefault();
                    failed();
                };
                worker.onmessageerror = failed;
                worker.onmessage = (event) => {
                    clearTimeout(timer);
                    if (event.data?.key instanceof Uint8Array &&
                        event.data.key.byteLength === 32)
                        resolve(event.data.key);
                    else
                        failed();
                };
                worker.postMessage({ password: bytes, salt, parameters }, [
                    bytes.buffer,
                ]);
            });
            return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
                "encrypt",
                "decrypt",
            ]);
        }
        catch (error) {
            if (error instanceof Error && "code" in error)
                throw error;
            throw fail("Backup key derivation could not complete. Try again on a device with more available memory.", "BACKUP_KDF_FAILED");
        }
        finally {
            worker?.terminate();
            raw?.fill(0);
            if (bytes.byteLength)
                bytes.fill(0);
            deriving = false;
        }
    }
    async function encrypt(bytes, password, compression) {
        if (!canEncrypt())
            throw fail("Encryption requires HTTPS, Web Crypto and Web Workers. Unencrypted backups remain available.", "BACKUP_CRYPTO_UNAVAILABLE");
        if (bytes.length > MAX_BYTES || !["none", "gzip"].includes(compression))
            throw unsupported();
        const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12));
        const envelope = {
            format: FORMAT,
            version: VERSION,
            compression,
            encryption: {
                algorithm: "aes-256-gcm",
                kdf: "argon2id",
                salt: base64(salt),
                nonce: base64(nonce),
                parameters: { ...DEFAULTS },
            },
            data: "",
        };
        const key = await derive(password, salt, envelope.encryption.parameters);
        const encrypted = await crypto.subtle.encrypt({
            name: "AES-GCM",
            iv: nonce,
            additionalData: aad(envelope),
            tagLength: 128,
        }, key, bytes);
        envelope.data = base64(new Uint8Array(encrypted));
        return envelope;
    }
    async function decrypt(value, password) {
        const envelope = inspect(value), e = envelope.encryption;
        const key = await derive(password, unbase64(e.salt, 16), e.parameters);
        try {
            const plaintext = await crypto.subtle.decrypt({
                name: "AES-GCM",
                iv: unbase64(e.nonce, 12),
                additionalData: aad(envelope),
                tagLength: 128,
            }, key, unbase64(envelope.data, MAX_CIPHER));
            if (plaintext.byteLength > MAX_BYTES)
                throw unsupported();
            return {
                bytes: new Uint8Array(plaintext),
                compression: envelope.compression,
            };
        }
        catch {
            throw fail("Incorrect password or damaged backup.", "BACKUP_AUTHENTICATION_FAILED");
        }
    }
    window.RSVP_BACKUP_CRYPTO = Object.freeze({
        canEncrypt,
        inspect,
        encrypt,
        decrypt,
    });
})();
