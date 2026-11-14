// File transport only: the backup envelope, checksum and SQL validation stay unchanged.
(function () {
  "use strict";
  const MAX_BYTES = 20 * 1024 * 1024;
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
  async function encode(data, compressed = false) {
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
    return { blob, extension: compressed ? ".json.gz" : ".json" };
  }
  async function decode(file) {
    if (file.size > MAX_BYTES) throw tooLarge();
    const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    let blob = file;
    if (signature[0] === 0x1f && signature[1] === 0x8b) {
      if (typeof DecompressionStream !== "function")
        throw Error(
          T(
            "Decompression is not supported in this browser. Open a JSON backup.",
          ),
        );
      const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
      // Preserve the bounded-size error while replacing opaque browser gzip errors.
      try {
        blob = await readBounded(stream, true);
      } catch (error) {
        if (error.code !== "BACKUP_TOO_LARGE")
          throw Error(T("The compressed backup is damaged or incomplete."));
        throw error;
      }
    }
    return JSON.parse(await blob.text());
  }
  window.RSVP_BACKUP_FILES = { canCompress, encode, decode };
})();
