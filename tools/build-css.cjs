// Preserve the existing cascade: concatenate explicit source blocks in order.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const source = path.join(root, "styles");
const target = path.join(root, "css/app.css");
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 1 && args[0] === "--check"),
  "Usage: node tools/build-css.cjs [--check]",
);
const names = JSON.parse(
  fs.readFileSync(path.join(source, "manifest.json"), "utf8"),
);
assert(
  Array.isArray(names) && names.length && new Set(names).size === names.length,
  "CSS manifest must list unique source files.",
);
const output = Buffer.concat(
  names.map((name) => {
    assert(
      typeof name === "string" && /^\d{2}-[a-z-]+\.css$/.test(name),
      "Invalid CSS source name.",
    );
    const file = fs.realpathSync(path.join(source, name));
    assert(
      path.dirname(file) === fs.realpathSync(source),
      "CSS sources must stay inside styles/.",
    );
    return fs.readFileSync(file);
  }),
);
if (args[0] === "--check") {
  assert(
    output.equals(fs.readFileSync(target)),
    "css/app.css is stale. Run node tools/build-css.cjs and include the generated file.",
  );
  console.log(
    "PASS CSS build: " +
      names.length +
      " ordered source blocks match css/app.css.",
  );
} else {
  fs.writeFileSync(target, output);
  console.log(
    "Built css/app.css from " + names.length + " ordered source blocks.",
  );
}
