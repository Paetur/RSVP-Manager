// The only alpha schema source is the baseline; application upgrades start after alpha.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  directory = path.join(root, "supabase/migrations");
const names = fs
  .readdirSync(directory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
assert.equal(
  names.length,
  1,
  "Alpha must have exactly one baseline migration.",
);
assert.match(names[0], /^\d{14}_alpha_baseline\.sql$/);
const body = fs.readFileSync(path.join(directory, names[0]), "utf8");
assert.match(body, /COMMIT;\s*$/, "Fresh installer must finish its transaction after every definition.");
assert.equal((body.match(/^COMMIT;\s*$/gm) || []).length, 1, "Fresh installer must have one final transaction commit.");
for (const retired of [
  "stuff_to_bring",
  "things_to_do",
  "legacy_stuff_to_bring",
  "restored_activity_logs",
])
  assert(
    !new RegExp("(?:public|app_private)\\." + retired + "\\b").test(body),
    "Retired relation in alpha baseline: " + retired,
  );
const output =
  "-- Fresh alpha installation. Generated from the single current baseline.\n-- Run once on an empty Supabase application schema; do not replay over an installed event.\n-- Regenerate/check with tools/build-install-sql.cjs.\n\n" +
  body;
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const meta = {
  format: 1,
  applicationVersion: fs
    .readFileSync(path.join(root, "VERSION"), "utf8")
    .trim(),
  baseline: names[0],
  baselineSha256: sha(body),
  installerSha256: sha(output),
};
const target = path.join(root, "supabase/install.sql"),
  manifest = path.join(root, "supabase/install-manifest.json");
const args = process.argv.slice(2);
assert(
  args.length === 0 || args.join(" ") === "--check",
  "Usage: node tools/build-install-sql.cjs [--check]",
);
if (args.length) {
  assert.equal(fs.readFileSync(target, "utf8"), output, "Installer is stale");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(manifest)),
    meta,
    "Installer manifest is stale",
  );
  console.log("PASS current alpha baseline and installer hashes.");
} else {
  fs.writeFileSync(target, output);
  fs.writeFileSync(manifest, JSON.stringify(meta, null, 2) + "\n");
  console.log("Built fresh alpha installer from " + names[0] + ".");
}
