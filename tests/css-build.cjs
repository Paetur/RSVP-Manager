// Exercise build/check behavior in an isolated synthetic tree, never the website.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-css-build-"));
try {
  for (const dir of ["tools", "styles", "css"])
    fs.mkdirSync(path.join(root, dir));
  fs.copyFileSync(
    path.join(__dirname, "../tools/build-css.cjs"),
    path.join(root, "tools/build-css.cjs"),
  );
  const write = (name, text) => fs.writeFileSync(path.join(root, name), text);
  const manifest = (names) =>
    write("styles/manifest.json", JSON.stringify(names));
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(root, "tools/build-css.cjs"), ...args],
      { encoding: "utf8" },
    );
  write("styles/01-first.css", ".sample { color: red; }\n");
  write("styles/02-last.css", ".sample { color: blue; }\n");
  manifest(["01-first.css", "02-last.css"]);
  write("css/app.css", "stale CSS");
  assert.notEqual(run("--check").status, 0);
  assert.equal(
    fs.readFileSync(path.join(root, "css/app.css"), "utf8"),
    "stale CSS",
    "check must not rewrite stale output",
  );
  assert.equal(run().status, 0);
  assert.equal(
    fs.readFileSync(path.join(root, "css/app.css"), "utf8"),
    ".sample { color: red; }\n.sample { color: blue; }\n",
  );
  assert.equal(run("--check").status, 0);
  manifest(["02-last.css", "01-first.css"]);
  assert.notEqual(
    run("--check").status,
    0,
    "source order is part of the generated contract",
  );
  assert.equal(run().status, 0);
  assert.equal(
    fs.readFileSync(path.join(root, "css/app.css"), "utf8"),
    ".sample { color: blue; }\n.sample { color: red; }\n",
  );
  manifest(["../outside.css"]);
  assert.notEqual(run().status, 0);
  manifest(["01-first.css", "01-first.css"]);
  assert.notEqual(run().status, 0);
  assert.notEqual(run("--unknown").status, 0);
  console.log(
    "PASS CSS build: byte/order preservation, stale-output detection without mutation, explicit rebuild and invalid manifest/argument rejection.",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
