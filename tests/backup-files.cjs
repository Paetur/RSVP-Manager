// Real native gzip streams and independent Node zlib, with synthetic payloads only.
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  zlib = require("node:zlib");
const source = fs.readFileSync("js/backup-files.js", "utf8");
function load(overrides = {}) {
  const context = {
    window: { RSVP_I18N: { t: (s) => s } },
    Blob,
    CompressionStream,
    DecompressionStream,
    Uint8Array,
    Error,
    TypeError,
    JSON,
    ...overrides,
  };
  vm.runInNewContext(source, context);
  return context.window.RSVP_BACKUP_FILES;
}
(async () => {
  const files = load(),
    payload = {
      format: "rsvp-application-backup",
      version: 2,
      checksum: "synthetic",
      payload: {
        selection: { mode: "backup", include_logs: true, sections: ["food"] },
        tables: {
          "public.food_items": [{ name: "Smør · Käse 🥗", quantity_needed: 5 }],
        },
      },
    };
  const plain = await files.encode(payload);
  assert.equal(plain.extension, ".json");
  assert.match(plain.blob.type, /application\/json/);
  assert.deepEqual(await files.decode(plain.blob), payload);
  const compressed = await files.encode(payload, true),
    bytes = Buffer.from(await compressed.blob.arrayBuffer());
  assert.equal(compressed.extension, ".json.gz");
  assert.equal(compressed.blob.type, "application/gzip");
  assert.deepEqual(
    JSON.parse(zlib.gunzipSync(bytes).toString("utf8")),
    payload,
  );
  assert.deepEqual(await files.decode(compressed.blob), payload);
  const external = zlib.gzipSync(JSON.stringify(payload));
  assert.deepEqual(
    await files.decode(new Blob([external])),
    payload,
    "accept independently produced gzip by content",
  );
  for (const corrupt of [
    external.subarray(0, external.length - 8),
    Buffer.from([0x1f, 0x8b, 0x08]),
    Buffer.from(external),
  ]) {
    if (corrupt.length === external.length) corrupt[corrupt.length - 8] ^= 0xff;
    await assert.rejects(
      files.decode(new Blob([corrupt])),
      /damaged or incomplete/,
    );
  }
  const unavailable = load({
    CompressionStream: undefined,
    DecompressionStream: undefined,
  });
  assert.equal(unavailable.canCompress(), false);
  await assert.rejects(
    unavailable.encode(payload, true),
    /Compression is not supported/,
  );
  await assert.rejects(
    unavailable.decode(compressed.blob),
    /Decompression is not supported/,
  );
  assert.deepEqual(
    await unavailable.decode(plain.blob),
    payload,
    "plain JSON remains available without gzip support",
  );
  const oversized = new Blob([" ".repeat(20 * 1024 * 1024 + 1)]);
  await assert.rejects(files.decode(oversized), /backup_exceeds_20_mb/);
  await assert.rejects(
    files.encode({ padding: " ".repeat(20 * 1024 * 1024) }, true),
    /backup_exceeds_20_mb/,
  );
  const bomb = zlib.gzipSync(Buffer.from(" ".repeat(20 * 1024 * 1024 + 1)));
  assert.ok(bomb.length < 25000);
  await assert.rejects(
    files.decode(new Blob([bomb])),
    /exceeds 20 MB when opened/,
  );
  await assert.rejects(files.decode(new Blob(["{"])), SyntaxError);
  assert.deepEqual(
    await files.decode(new Blob([" ".repeat(20 * 1024 * 1024 - 2) + "{}"])),
    {},
    "exact opened-size boundary is accepted",
  );
  console.log(
    "PASS backup files: JSON/native+zlib gzip round trips, Unicode, unchanged envelope, corrupt/truncated/CRC failures, unsupported API fallback, 20 MB input/expanded bounds.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
