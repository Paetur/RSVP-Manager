// File transport only: compress, optionally encrypt; authenticate before decompress/SQL validation.
(function () {
  "use strict";
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_ENCRYPTED_BYTES = Math.ceil((MAX_BYTES + 16) / 3) * 4 + 2048;
  const T = (text) => window.RSVP_I18N.t(text);
  const canCompress = () => typeof CompressionStream === "function";
  function tooLarge(opened = false) {
    const error = Error(
      T(
        opened
          ? "Backup exceeds 20 MB when opened."
          : "interface.messages.backup_exceeds_20_mb",
      ),
    );
    error.code = "BACKUP_TOO_LARGE";
    return error;
  }
  async function readBounded(stream, opened = false) {
    const reader = stream.getReader(),
      chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw tooLarge(opened);
        chunks.push(value);
      }
      return new Blob(chunks);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  async function encode(data, compressed = false, encryption = null) {
    let blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    if (blob.size > MAX_BYTES) throw tooLarge();
    if (compressed) {
      if (!canCompress())
        throw Error(
          T("Compression is not supported in this browser. Use a JSON backup."),
        );
      blob = new Blob(
        [
          await readBounded(
            blob.stream().pipeThrough(new CompressionStream("gzip")),
          ),
        ],
        { type: "application/gzip" },
      );
    }
    if (encryption) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      try {
        const envelope = await window.RSVP_BACKUP_CRYPTO.encrypt(
          bytes,
          encryption.password,
          compressed ? "gzip" : "none",
        );
        return {
          blob: new Blob([JSON.stringify(envelope)], {
            type: "application/json",
          }),
          extension: ".encrypted.json",
        };
      } finally {
        bytes.fill(0);
      }
    }
    return { blob, extension: compressed ? ".json.gz" : ".json" };
  }
  async function decompress(blob) {
    if (typeof DecompressionStream !== "function")
      throw Error(
        T(
          "Decompression is not supported in this browser. Open a JSON backup.",
        ),
      );
    try {
      return await readBounded(
        blob.stream().pipeThrough(new DecompressionStream("gzip")),
        true,
      );
    } catch (error) {
      if (error.code !== "BACKUP_TOO_LARGE")
        throw Error(T("The compressed backup is damaged or incomplete."));
      throw error;
    }
  }
  async function decode(file, passwordOrRequest) {
    if (file.size > MAX_ENCRYPTED_BYTES) throw tooLarge();
    const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (signature[0] === 0x1f && signature[1] === 0x8b) {
      if (file.size > MAX_BYTES) throw tooLarge();
      const opened = await decompress(file),
        parsed = JSON.parse(await opened.text());
      // The encrypted transport is always outside gzip, never wrapped inside it.
      if (
        parsed?.encryption ||
        (parsed?.format === "rsvp-application-backup" && parsed?.version === 1)
      )
        throw Error(T("Unsupported or damaged encrypted backup."));
      return parsed;
    }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (error) {
      if (file.size > MAX_BYTES) throw tooLarge();
      throw error;
    }
    const encrypted =
      parsed &&
      typeof parsed === "object" &&
      (Object.hasOwn(parsed, "encryption") ||
        (parsed.format === "rsvp-application-backup" && parsed.version === 1));
    if (!encrypted) {
      if (file.size > MAX_BYTES) throw tooLarge();
      return parsed;
    }
    const crypto = window.RSVP_BACKUP_CRYPTO;
    crypto.inspect(parsed);
    if (!crypto.canEncrypt())
      throw Error(
        T(
          "Encryption requires HTTPS, Web Crypto and Web Workers. Unencrypted backups remain available.",
        ),
      );
    const password =
      typeof passwordOrRequest === "function"
        ? await passwordOrRequest()
        : passwordOrRequest;
    const opened = await crypto.decrypt(parsed, password);
    let blob;
    try {
      blob = new Blob([opened.bytes]);
    } finally {
      opened.bytes.fill(0);
    }
    if (opened.compression === "gzip") blob = await decompress(blob);
    return JSON.parse(await blob.text());
  }
  window.RSVP_BACKUP_FILES = { canCompress, encode, decode };
})();
