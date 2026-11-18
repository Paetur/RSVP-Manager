// Offline, explicit-source Phase A upgrade builder. This never opens a connection.
// Fresh installs still use the single alpha baseline and its generated installer.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const sha256 = text => crypto.createHash("sha256").update(text).digest("hex");

// SQL statement boundaries must ignore quoted/dollar-quoted function bodies,
// nested block comments and comments containing semicolons.
function statements(sql) {
  const result = []; let start = 0, quote = null, escapeQuoted = false, dollar = null, line = false, block = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (line) { if (c === "\n") line = false; continue; }
    if (block) { if (c === "/" && next === "*") { block++; i++; } else if (c === "*" && next === "/") { block--; i++; } continue; }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null; } continue; }
    if (quote) { if (c === quote) { if (next === quote) i++; else quote = null; } else if (c === "\\" && escapeQuoted) i++; continue; }
    if (c === "-" && next === "-") { line = true; i++; continue; }
    if (c === "/" && next === "*") { block = 1; i++; continue; }
    if (c === "'" || c === '"') { quote = c; escapeQuoted = c === "'" && /(?:^|[^A-Za-z_0-9])[eE]$/.test(sql.slice(Math.max(0, i - 2), i)); continue; }
    if (c === "$") { const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/); if (tag) { dollar = tag[0]; i += dollar.length - 1; continue; } }
    if (c === ";") { const statement = leadingCode(sql.slice(start, i + 1)); if (statement) result.push(statement); start = i + 1; }
  }
  assert.ok(!quote && !dollar && !block, "Unterminated SQL quote or comment");
  assert.equal(leadingCode(sql.slice(start)), "", "SQL must end at a statement boundary");
  return result;
}
function leadingCode(sql) {
  let code = sql.trim();
  while (code.startsWith("--") || code.startsWith("/*")) {
    if (code.startsWith("--")) { const end = code.indexOf("\n"); code = end < 0 ? "" : code.slice(end + 1).trim(); }
    else { let depth = 1, i = 2; for (; i < code.length && depth; i++) { if (code.slice(i, i + 2) === "/*") { depth++; i++; } else if (code.slice(i, i + 2) === "*/") { depth--; i++; } } assert.equal(depth, 0, "Unterminated leading SQL comment"); code = code.slice(i).trim(); }
  }
  return code;
}
function functionInfo(sql) {
  const header = sql.match(/^CREATE(?: OR REPLACE)? FUNCTION ((?:public|app_private)\.([a-z_][a-z_0-9]*))\(([\s\S]*?)\) RETURNS\b/);
  if (!header) return null;
  const body = sql.match(/\bAS (\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)([\s\S]*)\1;$/);
  assert.ok(body, "Only dollar-quoted function bodies are supported: " + header[1]);
  const types = header[3].trim() ? header[3].split(",").map(arg => arg.trim().replace(/\s+DEFAULT[\s\S]*$/i, "").replace(/^(?:IN|OUT|INOUT|VARIADIC)\s+/i, "").replace(/^[a-z_][a-z_0-9]*\s+/i, "").replace(/\s+/g, " ")) : [];
  return { key: header[1] + "(" + types.join(",") + ")", schema: header[1].split(".")[0], name: header[2], body: body[2] };
}
function literal(value) { return "'" + value.replaceAll("'", "''") + "'"; }
function buildUpgrade({ from, to, expectedFromSha256 }) {
  assert.match(expectedFromSha256 || "", /^[a-f0-9]{64}$/, "An explicit --expected-from-sha256 is required");
  assert.equal(sha256(from), expectedFromSha256, "Source baseline SHA-256 does not match the explicitly selected source");
  const previous = statements(from), current = statements(to);
  for (const list of [previous, current]) {
    assert.equal(list[0], "BEGIN;", "Expected a complete alpha baseline or generated installer");
    assert.equal(list.at(-1), "COMMIT;", "Expected one final COMMIT");
    assert.equal(list.filter(sql => /^(?:BEGIN|COMMIT|ROLLBACK);$/.test(sql)).length, 2, "Unexpected transaction boundary");
  }
  assert.ok(current.length > previous.length, "Phase A must append its scoped schema definitions");
  const oldFunctions = new Map(previous.map(functionInfo).filter(Boolean).map(info => [info.key, info]));
  const changed = [], guards = new Map();
  for (let i = 0; i < previous.length - 1; i++) {
    if (previous[i] === current[i]) continue;
    const old = functionInfo(previous[i]), replacement = functionInfo(current[i]);
    assert.ok(old && replacement && old.key === replacement.key, "Removed or modified non-function baseline statement at " + (i + 1));
    changed.push(current[i].replace(/^CREATE FUNCTION /, "CREATE OR REPLACE FUNCTION "));
    guards.set(old.key, old);
  }
  for (const sql of current.slice(previous.length - 1, -1)) {
    assert.ok(!/^(?:BEGIN|COMMIT|ROLLBACK|TRUNCATE|DROP|DELETE)\b/i.test(sql), "Unsupported appended upgrade statement");
    assert.ok(/^(?:CREATE(?: OR REPLACE)? (?:TABLE|FUNCTION|INDEX|UNIQUE INDEX|POLICY|TRIGGER)|ALTER TABLE|REVOKE|GRANT|INSERT INTO|UPDATE|COMMENT ON|DO\s+\$)/.test(sql), "Unexpected appended SQL statement: " + sql.slice(0, 100));
    const info = functionInfo(sql), old = info && oldFunctions.get(info.key);
    if (old) guards.set(old.key, old);
    changed.push(old ? sql.replace(/^CREATE FUNCTION /, "CREATE OR REPLACE FUNCTION ") : sql);
  }
  const manifest = oldFunctions.get("app_private.backup_tables()");
  assert.ok(manifest && /'schema_version','20261114034908'/.test(from), "Expected the current alpha schema source");
  guards.set(manifest.key, manifest);
  const checks = [...guards.values()].map(info =>
    " IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=" + literal(info.schema) + " AND p.proname=" + literal(info.name) + " AND p.prosrc=" + literal(info.body) + ") THEN RAISE EXCEPTION " + literal("Upgrade source function does not match: " + info.key) + ";END IF;"
  );
  const output = "-- Scoped Phase A upgrade; generated from explicitly selected source files.\n" +
    "-- Source SHA-256: " + expectedFromSha256 + "\n-- Target SHA-256: " + sha256(to) + "\n" +
    "-- Preserve an operator backup; review this file and test on a disposable copy before use.\n" +
    "-- This is an installed-schema update. Never run the fresh installer over an event.\n" +
    "BEGIN;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '120s';\nSET LOCAL standard_conforming_strings = on;\nSET LOCAL search_path = '';\nSET LOCAL check_function_bodies = false;\nSELECT pg_catalog.pg_advisory_xact_lock(19421,7744);\n" +
    "DO $upgrade_source$\nBEGIN\n IF to_regclass('public.event_settings') IS NULL OR to_regclass('app_private.backup_origin') IS NULL THEN RAISE EXCEPTION 'Upgrade requires the installed current alpha schema';END IF;\n" +
    " IF to_regclass('public.invitation_shortcut_batches') IS NOT NULL OR to_regclass('app_private.guest_visit_scope') IS NOT NULL THEN RAISE EXCEPTION 'Phase A is already installed or partly applied';END IF;\n" +
    checks.join("\n") + "\nEND $upgrade_source$;\n\n" + changed.join("\n\n") + "\n\nCOMMIT;\n";
  return { sql: output, manifest: { format: 1, purpose: "shortcuts-phase-a-scoped-upgrade", sourceSha256: expectedFromSha256, targetSha256: sha256(to), upgradeSha256: sha256(output), statementCount: changed.length, guardedFunctionCount: guards.size } };
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    assert.equal(args.length, 8, "Usage: node tools/build-shortcuts-upgrade.cjs --from PREVIOUS_BASELINE --to CURRENT_BASELINE --expected-from-sha256 SHA256 --out /protected/path/upgrade.sql");
    for (let i = 0; i < args.length; i += 2) { assert.ok(["--from", "--to", "--expected-from-sha256", "--out"].includes(args[i]) && !options[args[i]], "Unknown or repeated option"); options[args[i]] = args[i + 1]; }
    assert.ok(options["--from"] && options["--to"] && options["--out"]);
    const output = path.resolve(options["--out"]), root = path.resolve(__dirname, "..");
    assert.ok(!output.startsWith(path.join(root, "supabase") + path.sep), "Scoped upgrade output must remain outside the canonical Supabase installer/migrations directory");
    assert.ok(!fs.existsSync(output) && !fs.existsSync(output + ".json"), "Output already exists; choose an explicit new artifact path");
    const built = buildUpgrade({ from: fs.readFileSync(options["--from"], "utf8"), to: fs.readFileSync(options["--to"], "utf8"), expectedFromSha256: options["--expected-from-sha256"] });
    fs.writeFileSync(output, built.sql, { mode: 0o600, flag: "wx" }); fs.writeFileSync(output + ".json", JSON.stringify(built.manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log("Built " + built.manifest.statementCount + " scoped SQL statements at " + output + "; no database connection or update performed.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { statements, buildUpgrade, sha256 };
