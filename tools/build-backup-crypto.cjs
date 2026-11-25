// Reproducible TS and pinned vendor assets; static checks need no installed packages.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  args = process.argv.slice(2);
assert(
  args.length === 0 ||
    (args.length === 1 && ["--check", "--check-static"].includes(args[0])),
  "Usage: build-backup-crypto.cjs [--check|--check-static]",
);
const check = args.includes("--check"),
  manifestPath = path.join(root, "js/vendor/backup-crypto-manifest.json");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const packages = ["libsodium-sumo", "libsodium-wrappers-sumo"];
const sources = [
  "js/backup-crypto.ts",
  "js/backup-kdf-worker.js",
  "tools/build-backup-crypto.cjs",
];
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json")));
for (const name of packages)
  assert.equal(lock.packages["node_modules/" + name].version, "0.8.4");
assert.equal(
  JSON.parse(fs.readFileSync(path.join(root, "package.json"))).dependencies[
    "libsodium-wrappers-sumo"
  ],
  "0.8.4",
);
if (args.includes("--check-static")) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  assert.deepEqual(
    manifest.packages,
    Object.fromEntries(packages.map((name) => [name, "0.8.4"])),
  );
  assert.deepEqual(Object.keys(manifest.sources).sort(), [...sources].sort());
  for (const [name, expected] of Object.entries({
    ...manifest.files,
    ...manifest.sources,
  }))
    assert.equal(
      hash(fs.readFileSync(path.join(root, name))),
      expected,
      name + " is stale; run node tools/build-backup-crypto.cjs",
    );
  console.log(
    "PASS crypto static manifest: source/output/vendor hashes and lockfile pins; no dependency install.",
  );
  process.exit(0);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-backup-crypto-"));
try {
  cp.execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "--target",
      "ES2022",
      "--module",
      "none",
      "--lib",
      "ES2022,DOM",
      "--strict",
      "--skipLibCheck",
      "--types",
      "node",
      "--outDir",
      temp,
      path.join(root, "js/backup-crypto.ts"),
    ],
    { cwd: root, stdio: "pipe" },
  );
  const names = {
    "js/backup-crypto.js": path.join(temp, "backup-crypto.js"),
    "js/vendor/libsodium-sumo.js": require.resolve("libsodium-sumo"),
    "js/vendor/libsodium-wrappers.js": require.resolve(
      "libsodium-wrappers-sumo",
    ),
  };
  const files = {};
  for (const [target, origin] of Object.entries(names)) {
    const bytes = fs.readFileSync(origin),
      destination = path.join(root, target);
    files[target] = hash(bytes);
    if (check)
      assert(bytes.equals(fs.readFileSync(destination)), target + " is stale");
    else {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
  }
  for (const name of packages)
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(root, "node_modules", name, "package.json")),
      ).version,
      "0.8.4",
    );
  const notices =
    "# Cryptography third-party notices\n\nSelf-hosted libsodium-sumo and libsodium-wrappers-sumo 0.8.4 (https://github.com/jedisct1/libsodium.js).\n\n" +
    packages
      .map(
        (name) =>
          "## " +
          name +
          "\n\n" +
          fs.readFileSync(
            path.join(root, "node_modules", name, "LICENSE"),
            "utf8",
          ),
      )
      .join("\n\n");
  files["docs/CryptographyNotices.md"] = hash(notices);
  const noticesPath = path.join(root, "docs/CryptographyNotices.md");
  if (check) assert.equal(fs.readFileSync(noticesPath, "utf8"), notices);
  else fs.writeFileSync(noticesPath, notices);
  const manifest =
    JSON.stringify(
      {
        packages: Object.fromEntries(packages.map((name) => [name, "0.8.4"])),
        files,
        sources: Object.fromEntries(
          sources.map((name) => [
            name,
            hash(fs.readFileSync(path.join(root, name))),
          ]),
        ),
      },
      null,
      2,
    ) + "\n";
  if (check) assert.equal(fs.readFileSync(manifestPath, "utf8"), manifest);
  else fs.writeFileSync(manifestPath, manifest);
  console.log(
    "PASS backup crypto build: TypeScript and pinned self-hosted Argon2 assets match.",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
