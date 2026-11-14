// Browser-only transport encryption. The inner application backup/SQL contract is unchanged.
interface BackupKdfParameters {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}
interface EncryptedBackup {
  format: string;
  version: number;
  compression: "none" | "gzip";
  encryption: {
    algorithm: string;
    kdf: string;
    salt: string;
    nonce: string;
    parameters: BackupKdfParameters;
  };
  data: string;
}
interface Window {
  RSVP_BACKUP_CRYPTO: {
    canEncrypt(): boolean;
    inspect(value: unknown): EncryptedBackup;
    encrypt(
      bytes: Uint8Array<ArrayBuffer>,
      password: string,
      compression: "none" | "gzip",
    ): Promise<EncryptedBackup>;
    decrypt(
      value: unknown,
      password: string,
    ): Promise<{
      bytes: Uint8Array<ArrayBuffer>;
      compression: "none" | "gzip";
    }>;
  };
  RSVP_I18N: { t(text: string): string };
}
(() => {
  "use strict";
  const FORMAT = "rsvp-application-backup",
    VERSION = 1;
  const MAX_BYTES = 20 * 1024 * 1024,
    MAX_CIPHER = MAX_BYTES + 16;
  const DEFAULTS: BackupKdfParameters = {
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
  };
  const workerURL = new URL(
    "./backup-kdf-worker.js?v=20261114-backup-encryption",
    (document.currentScript as HTMLScriptElement).src,
  );
  let deriving = false;
  const fail = (message: string, code: string): Error & { code: string } =>
    Object.assign(new Error(window.RSVP_I18N?.t(message) || message), { code });
  const unsupported = () =>
    fail(
      "Unsupported or damaged encrypted backup.",
      "BACKUP_ENCRYPTION_FORMAT",
    );
  const canEncrypt = () =>
    !!globalThis.crypto?.subtle &&
    typeof Worker === "function" &&
    typeof WebAssembly === "object";
  function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function exact(
    value: unknown,
    keys: string[],
  ): asserts value is Record<string, unknown> {
    if (
      !object(value) ||
      Object.keys(value).sort().join("|") !== [...keys].sort().join("|")
    )
      throw unsupported();
  }
  function base64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary);
  }
  function unbase64(value: unknown, limit: number): Uint8Array<ArrayBuffer> {
    if (
      typeof value !== "string" ||
      value.length > Math.ceil(limit / 3) * 4 ||
      value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
    )
      throw unsupported();
    let binary: string;
    try {
      binary = atob(value);
    } catch {
      throw unsupported();
    }
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.length > limit || base64(bytes) !== value) throw unsupported();
    return bytes;
  }
  function inspect(value: unknown): EncryptedBackup {
    exact(value, ["format", "version", "compression", "encryption", "data"]);
    if (
      value.format !== FORMAT ||
      value.version !== VERSION ||
      !["none", "gzip"].includes(value.compression as string)
    )
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
    if (
      !Number.isInteger(p.memoryKiB) ||
      !Number.isInteger(p.iterations) ||
      p.parallelism !== 1 ||
      (p.memoryKiB as number) < 65536 ||
      (p.memoryKiB as number) > 131072 ||
      (p.memoryKiB as number) % 1024 !== 0 ||
      (p.iterations as number) < 3 ||
      (p.iterations as number) > 4 ||
      (p.memoryKiB as number) * (p.iterations as number) > 393216
    )
      throw fail(
        "Unsupported backup encryption parameters.",
        "BACKUP_KDF_PARAMETERS",
      );
    if (
      unbase64(e.salt, 16).length !== 16 ||
      unbase64(e.nonce, 12).length !== 12 ||
      unbase64(value.data, MAX_CIPHER).length < 16
    )
      throw unsupported();
    return value as unknown as EncryptedBackup;
  }
  // Reconstruct the exact v1 header in a fixed order. Unknown fields are rejected.
  function aad(value: EncryptedBackup): Uint8Array<ArrayBuffer> {
    const e = value.encryption,
      p = e.parameters;
    return new TextEncoder().encode(
      JSON.stringify({
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
      }),
    );
  }
  async function derive(
    password: string,
    salt: Uint8Array<ArrayBuffer>,
    parameters: BackupKdfParameters,
  ): Promise<CryptoKey> {
    if (!canEncrypt())
      throw fail(
        "Encryption requires HTTPS, Web Crypto and Web Workers. Unencrypted backups remain available.",
        "BACKUP_CRYPTO_UNAVAILABLE",
      );
    if (typeof password !== "string" || !password.length)
      throw fail("Enter a backup password.", "BACKUP_PASSWORD_REQUIRED");
    const bytes = new TextEncoder().encode(password);
    if (bytes.length > 1024) {
      bytes.fill(0);
      throw fail(
        "Backup password exceeds 1024 UTF-8 bytes.",
        "BACKUP_PASSWORD_LENGTH",
      );
    }
    if (deriving) {
      bytes.fill(0);
      throw fail(
        "Another backup encryption operation is running.",
        "BACKUP_CRYPTO_BUSY",
      );
    }
    deriving = true;
    let worker: Worker | undefined, raw: Uint8Array<ArrayBuffer> | undefined;
    try {
      raw = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
        worker = new Worker(workerURL);
        const timer = setTimeout(() => {
          worker?.terminate();
          reject(
            fail(
              "Backup key derivation could not complete. Try again on a device with more available memory.",
              "BACKUP_KDF_FAILED",
            ),
          );
        }, 90000);
        const failed = () => {
          clearTimeout(timer);
          reject(
            fail(
              "Backup key derivation could not complete. Try again on a device with more available memory.",
              "BACKUP_KDF_FAILED",
            ),
          );
        };
        worker.onerror = (event) => {
          event.preventDefault();
          failed();
        };
        worker.onmessageerror = failed;
        worker.onmessage = (event) => {
          clearTimeout(timer);
          if (
            event.data?.key instanceof Uint8Array &&
            event.data.key.byteLength === 32
          )
            resolve(event.data.key);
          else failed();
        };
        worker.postMessage({ password: bytes, salt, parameters }, [
          bytes.buffer,
        ]);
      });
      return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
    } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      throw fail(
        "Backup key derivation could not complete. Try again on a device with more available memory.",
        "BACKUP_KDF_FAILED",
      );
    } finally {
      worker?.terminate();
      raw?.fill(0);
      if (bytes.byteLength) bytes.fill(0);
      deriving = false;
    }
  }
  async function encrypt(
    bytes: Uint8Array<ArrayBuffer>,
    password: string,
    compression: "none" | "gzip",
  ): Promise<EncryptedBackup> {
    if (!canEncrypt())
      throw fail(
        "Encryption requires HTTPS, Web Crypto and Web Workers. Unencrypted backups remain available.",
        "BACKUP_CRYPTO_UNAVAILABLE",
      );
    if (bytes.length > MAX_BYTES || !["none", "gzip"].includes(compression))
      throw unsupported();
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      nonce = crypto.getRandomValues(new Uint8Array(12));
    const envelope: EncryptedBackup = {
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
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: aad(envelope),
        tagLength: 128,
      },
      key,
      bytes,
    );
    envelope.data = base64(new Uint8Array(encrypted));
    return envelope;
  }
  async function decrypt(value: unknown, password: string) {
    const envelope = inspect(value),
      e = envelope.encryption;
    const key = await derive(password, unbase64(e.salt, 16), e.parameters);
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: unbase64(e.nonce, 12),
          additionalData: aad(envelope),
          tagLength: 128,
        },
        key,
        unbase64(envelope.data, MAX_CIPHER),
      );
      if (plaintext.byteLength > MAX_BYTES) throw unsupported();
      return {
        bytes: new Uint8Array(plaintext),
        compression: envelope.compression,
      };
    } catch {
      throw fail(
        "Incorrect password or damaged backup.",
        "BACKUP_AUTHENTICATION_FAILED",
      );
    }
  }
  window.RSVP_BACKUP_CRYPTO = Object.freeze({
    canEncrypt,
    inspect,
    encrypt,
    decrypt,
  });
})();
