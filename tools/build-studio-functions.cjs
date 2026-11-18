// Generate paste-ready Studio entrypoints without changing handler logic.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const shared = ["_shared/site-origin.mjs", "_shared/request-body.mjs"];
const files = {
  "guest-gateway": [...shared, "guest-gateway/index.ts"],
  "admin-invitations": [
    ...shared,
    "admin-invitations/handler.mjs",
    "admin-invitations/index.ts",
  ],
  "invitation-shortcuts": [
    ...shared,
    "invitation-shortcuts/handler.mjs",
    "invitation-shortcuts/index.ts",
  ],
};
function generatedFiles(sourceRoot = root) {
  const version = fs
    .readFileSync(path.join(sourceRoot, "VERSION"), "utf8")
    .trim();
  const outputs = new Map();
  const manifest = { format: 1, version, functions: {} };
  for (const [name, inputs] of Object.entries(files)) {
    const sources = {};
    const pieces = inputs.map((name) => {
      const relative = "supabase/functions/" + name;
      const raw = fs.readFileSync(path.join(sourceRoot, relative), "utf8");
      sources[relative] = sha(raw);
      const body = raw.replace(
        /^import\s+\{[^;]+\}\s+from\s+["']\.{1,2}\/[^"']+["'];\s*\n/gm,
        "",
      );
      assert(
        !/^import.*from\s+["']\.{1,2}\//m.test(body),
        "Unresolved relative import: " + relative,
      );
      return "// Source: " + relative + "\n" + body.trim();
    });
    const text =
      "// Generated Studio entrypoint for RSVP Manager " +
      version +
      ".\n" +
      "// Paste the COMPLETE file into index.ts for " +
      name +
      ".\n" +
      "// Set the function JWT verification toggle to OFF; this handler validates requests itself.\n" +
      "// Source hashes and version are recorded in manifest.json. Do not edit generated files.\n\n" +
      pieces.join("\n\n") +
      "\n";
    outputs.set(name + ".ts", text);
    manifest.functions[name] = {
      file: name + ".ts",
      sha256: sha(text),
      verify_jwt: false,
      sources,
    };
  }
  outputs.set("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  return outputs;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  assert(
    args.length === 0 || args.join(" ") === "--check",
    "Usage: node tools/build-studio-functions.cjs [--check]",
  );
  const directory = path.join(root, "supabase/studio");
  if (!args.length) fs.mkdirSync(directory, { recursive: true });
  for (const [name, content] of generatedFiles()) {
    const target = path.join(directory, name);
    if (args.length)
      assert.equal(
        fs.readFileSync(target, "utf8"),
        content,
        "Stale Studio file: " + name,
      );
    else fs.writeFileSync(target, content);
  }
  console.log(
    (args.length ? "PASS" : "Built") +
      " Studio entrypoints: " + Object.keys(files).length + " self-contained handlers with version/source hashes.",
  );
}
module.exports = { generatedFiles };
