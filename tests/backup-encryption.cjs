// Native Web Crypto, real Argon2id and synthetic payloads. No database or real backup.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  { webcrypto } = require("node:crypto"),
  { Worker: Thread } = require("node:worker_threads");
const root = path.resolve(__dirname, "..");
let workers = 0;
class Worker {
  constructor(url) {
    workers++;
    this.thread = new Thread(
      `const {parentPort,workerData}=require('node:worker_threads');global.self=global;global.importScripts=()=>{global.sodium=require(workerData.sodium);};global.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);global.close=()=>parentPort.close();eval(require('node:fs').readFileSync(workerData.file,'utf8'));parentPort.on('message',data=>global.onmessage({data}));`,
      {
        eval: true,
        workerData: {
          file: require("node:url").fileURLToPath(url),
          sodium: require.resolve("libsodium-wrappers-sumo"),
        },
      },
    );
    this.thread.on("message", (data) => this.onmessage?.({ data }));
    this.thread.on("error", () => this.onerror?.({ preventDefault() {} }));
  }
  postMessage(data, transfer) {
    this.thread.postMessage(data, transfer);
  }
  terminate() {
    this.thread.terminate();
  }
}
function load(overrides = {}) {
  const context = {
    window: { RSVP_I18N: { t: (s) => s } },
    document: {
      currentScript: {
        src: require("node:url").pathToFileURL(
          path.join(root, "js/backup-crypto.js"),
        ).href,
      },
    },
    crypto: webcrypto,
    WebAssembly,
    Worker,
    URL,
    Uint8Array,
    TextEncoder,
    Blob,
    CompressionStream,
    DecompressionStream,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    Error,
    TypeError,
    JSON,
    ...overrides,
  };
  for (const file of ["js/backup-crypto.js", "js/backup-files.js"])
    vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  return {
    files: context.window.RSVP_BACKUP_FILES,
    crypto: context.window.RSVP_BACKUP_CRYPTO,
  };
}
const password = 'Pæsswörd 🔐 " $ \\ : Ω',
  payload = {
    format: "rsvp-application-backup",
    version: 2,
    checksum: "synthetic",
    payload: {
      selection: { mode: "backup", sections: ["food"], include_logs: false },
      tables: {
        "public.food_items": [{ name: "Käse 🥗 Føroyskt", note: '\n"\\{}' }],
      },
    },
  };
(async () => {
  const { files, crypto } = load();
  let sample;
  // OpenSSL 3.6 independently produced this Argon2id v1.3 vector (m=65536,t=3,p=1).
  const vectorWorker = new Worker(
    require("node:url").pathToFileURL(
      path.join(root, "js/backup-kdf-worker.js"),
    ),
  );
  const answer = await new Promise((resolve, reject) => {
    vectorWorker.onmessage = (e) => resolve(e.data.key);
    vectorWorker.onerror = reject;
    vectorWorker.postMessage(
      {
        password: new TextEncoder().encode("password"),
        salt: Uint8Array.from({ length: 16 }, (_, i) => i),
        parameters: { memoryKiB: 65536, iterations: 3, parallelism: 1 },
      },
      [],
    );
  });
  assert.equal(
    Buffer.from(answer).toString("hex"),
    "def6fd068289b9a0cf1114f8e978a2c4dab6faef377d895b9c2d59fc93fc5653",
  );
  vectorWorker.terminate();

  for (const compressed of [false, true])
    for (const encrypted of [false, true]) {
      const output = await files.encode(
        payload,
        compressed,
        encrypted ? { password } : null,
      );
      assert.equal(
        output.extension,
        encrypted ? ".encrypted.json" : compressed ? ".json.gz" : ".json",
      );
      assert.deepEqual(await files.decode(output.blob, password), payload);
      if (encrypted) {
        const outer = JSON.parse(await output.blob.text());
        assert.equal(outer.compression, compressed ? "gzip" : "none");
        assert.equal(outer.encryption.parameters.memoryKiB, 65536);
        assert.equal(outer.encryption.parameters.iterations, 3);
        assert.equal(outer.encryption.parameters.parallelism, 1);
        assert.equal(atob(outer.encryption.salt).length, 16);
        assert.equal(atob(outer.encryption.nonce).length, 12);
        assert(!(await output.blob.text()).includes("Käse"));
        sample = outer;
      }
    }
  for (const data of [{}, { padding: "æ".repeat(500000) }]) {
    const output = await files.encode(data, false, { password });
    assert.deepEqual(await files.decode(output.blob, password), data);
  }
  const first = await files.encode(payload, false, { password }),
    second = await files.encode(payload, false, { password });
  const a = JSON.parse(await first.blob.text()),
    b = JSON.parse(await second.blob.text());
  assert.notEqual(a.encryption.salt, b.encryption.salt);
  assert.notEqual(a.encryption.nonce, b.encryption.nonce);
  assert.notEqual(a.data, b.data);
  const blob = (value) => new Blob([JSON.stringify(value)]),
    clone = () => JSON.parse(JSON.stringify(a));
  await assert.rejects(
    files.decode(first.blob, "wrong"),
    (error) => error.code === "BACKUP_AUTHENTICATION_FAILED",
  );
  for (const tamper of [
    (e) => {
      const bytes = Buffer.from(e.data, "base64");
      bytes[0] ^= 1;
      e.data = bytes.toString("base64");
    },
    (e) => (e.compression = "gzip"),
    (e) => (e.encryption.parameters.iterations = 4),
    (e) => {
      e.encryption.nonce = Buffer.alloc(12, 7).toString("base64");
    },
    (e) => {
      e.encryption.salt = Buffer.alloc(16, 7).toString("base64");
    },
  ]) {
    const changed = clone();
    tamper(changed);
    await assert.rejects(
      files.decode(blob(changed), password),
      (error) => error.code === "BACKUP_AUTHENTICATION_FAILED",
    );
  }
  let requests = 0;
  const before = workers;
  for (const bad of [
    (e) => (e.version = 99),
    (e) => (e.format = "unknown"),
    (e) => (e.compression = "zip"),
    (e) => (e.encryption.algorithm = "aes-cbc"),
    (e) => (e.encryption.kdf = "pbkdf2"),
    (e) => (e.encryption.parameters.memoryKiB = 2 ** 30),
    (e) => (e.encryption.parameters.iterations = 100000),
    (e) => (e.encryption.parameters.parallelism = 999),
    (e) => (e.encryption.parameters.memoryKiB = 1),
    (e) => (e.encryption.parameters.iterations = 1),
    (e) => (e.encryption.parameters.memoryKiB = 65536.1),
    (e) => (e.encryption.parameters.extra = true),
    (e) => (e.extra = true),
    (e) => (e.data = "!!!!"),
    (e) => (e.encryption.nonce = "AA=="),
    (e) => (e.data = ""),
    (e) => (e.encryption = null),
  ]) {
    const changed = clone();
    bad(changed);
    await assert.rejects(
      files.decode(blob(changed), () => {
        requests++;
        return password;
      }),
    );
  }
  assert.equal(
    workers,
    before,
    "reject bad metadata before allocating a worker",
  );
  assert.equal(requests, 0, "reject bad metadata before asking for a password");
  await assert.rejects(
    files.decode(first.blob),
    (error) => error.code === "BACKUP_PASSWORD_REQUIRED",
  );
  await assert.rejects(
    files.encode(payload, false, { password: "" }),
    (error) => error.code === "BACKUP_PASSWORD_REQUIRED",
  );
  await assert.rejects(
    files.encode(payload, false, { password: "x".repeat(1025) }),
    (error) => error.code === "BACKUP_PASSWORD_LENGTH",
  );
  const missing = load({ Worker: undefined });
  assert.equal(missing.crypto.canEncrypt(), false);
  await assert.rejects(missing.files.decode(first.blob, password), /HTTPS/);
  assert.deepEqual(
    await missing.files.decode((await files.encode(payload)).blob),
    payload,
  );
  const wrongOrder = await files.encode(a, true);
  await assert.rejects(files.decode(wrongOrder.blob, password), /Unsupported/);
  const bomb = require("node:zlib").gzipSync(
    Buffer.from(" ".repeat(20 * 1024 * 1024 + 1)),
  );
  const encryptedBomb = await crypto.encrypt(
    new Uint8Array(bomb),
    password,
    "gzip",
  );
  await assert.rejects(
    files.decode(blob(encryptedBomb), password),
    /exceeds 20 MB when opened/,
  );
  await assert.rejects(files.decode(new Blob(["{"])), SyntaxError);
  console.log(
    "PASS encrypted backup transport: four modes, native AES-GCM + real Argon2id, fresh salts/nonces, authenticated header/ciphertext tampering, wrong passwords, Unicode, empty/1MB data, metadata/work bounds, cancellation-safe preflight and decompression limits; current JSON/gzip unchanged.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
