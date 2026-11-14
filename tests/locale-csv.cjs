const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { localeContract } = require("../tools/locale-contract.cjs");
const {
  parseCsv,
  importLanguageCsv,
} = require("../tools/import-language-csv.cjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-locale-csv-"));
try {
  fs.mkdirSync(path.join(temporary, "locales/en"), { recursive: true });
  for (const file of ["interface", "food", "types"])
    fs.copyFileSync(
      "locales/en/" + file + ".json",
      path.join(temporary, "locales/en", file + ".json"),
    );
  fs.copyFileSync(
    "locales/aliases.json",
    path.join(temporary, "locales/aliases.json"),
  );
  const aliases = JSON.parse(fs.readFileSync("locales/aliases.json", "utf8"));
  const catalogs = Object.fromEntries(
    ["interface", "food", "types"].map((category) => [
      category,
      JSON.parse(fs.readFileSync("locales/de/" + category + ".json", "utf8")),
    ]),
  );
  const contract = localeContract(aliases);
  const rows = [contract.header];
  for (const [source, fullKey] of Object.entries(aliases)) {
    const [category, ...parts] = fullKey.split(".");
    const value = parts.reduce((node, part) => node[part], catalogs[category]);
    rows.push([
      contract.format_version,
      contract.catalog_version,
      "de",
      category,
      parts.join("."),
      source,
      value,
    ]);
  }
  const saved = rows.find((row) => row[5] === "Save");
  saved[6] = 'Speichern, "jetzt"\nNächste Zeile';
  const csv = (values) =>
    "\uFEFF" +
    values
      .map((row) =>
        row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n") +
    "\r\n";
  assert.deepEqual(parseCsv(csv(rows)), rows);
  const result = importLanguageCsv(csv(rows), temporary);
  assert.equal(result.language, "de");
  assert.equal(result.files.length, 3);
  const savedFile = path.join(temporary, "locales/de/interface.json");
  const imported = JSON.parse(fs.readFileSync(savedFile, "utf8"));
  assert.equal(imported.messages.save, saved[6]);
  const before = fs.readFileSync(savedFile, "utf8");
  assert.throws(
    () => importLanguageCsv(csv(rows.slice(0, -1)), temporary),
    /Missing translation keys/,
  );
  assert.throws(
    () => importLanguageCsv(csv([...rows, rows[1]]), temporary),
    /duplicate/,
  );
  const invalid = structuredClone(rows);
  invalid[1][2] = "../../bad";
  assert.throws(
    () => importLanguageCsv(csv(invalid), temporary),
    /Invalid language/,
  );
  const placeholder = structuredClone(rows);
  placeholder.find((row) => row[5] === "Quantity for {item}")[6] =
    "Missing token";
  assert.throws(
    () => importLanguageCsv(csv(placeholder), temporary),
    /placeholders/,
  );
  const oldFormat = rows.map((row, i) =>
    i ? row.slice(2) : contract.header.slice(2),
  );
  assert.throws(
    () => importLanguageCsv(csv(oldFormat), temporary),
    /Unsupported CSV format/,
  );
  for (const [column, value] of [
    [0, "1"],
    [0, "3"],
    [1, "sha256:stale"],
  ]) {
    const bad = structuredClone(rows);
    bad[1][column] = value;
    assert.throws(() => importLanguageCsv(csv(bad), temporary), /version/);
  }
  const wrongSource = structuredClone(rows);
  wrongSource[1][5] = "Old source";
  assert.throws(
    () => importLanguageCsv(csv(wrongSource), temporary),
    /Invalid/,
  );
  const malformed = structuredClone(rows);
  malformed[1].pop();
  assert.throws(() => importLanguageCsv(csv(malformed), temporary), /Invalid/);
  assert.equal(
    fs.readFileSync(savedFile, "utf8"),
    before,
    "all version/schema/source/placeholder failures leave catalogs unchanged",
  );
  assert.throws(() => parseCsv('a,"not closed'), /Unclosed/);
  assert.throws(() => parseCsv('"a"oops,b'), /quoting/);
  const english = rows.map((row, index) =>
    index ? [...row.slice(0, 6), row[5]] : [...row],
  );
  for (const row of english.slice(1)) row[2] = "en";
  english.find((row) => row[5] === "Save")[6] = "Store";
  importLanguageCsv(csv(english), temporary);
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(temporary, "locales/en/interface.json"),
        "utf8",
      ),
    ).messages.save,
    "Store",
  );
  console.log(
    "PASS locale CSV: complete nested catalogs, BOM/quotes/commas/newlines, stable keys, English wording, placeholders and validation before writes",
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
