// One current catalog contract; old exports are intentionally unsupported.
const crypto = require("node:crypto");
const CSV_HEADER = [
  "format_version",
  "catalog_version",
  "language_code",
  "category",
  "key",
  "source",
  "translation",
];
function localeContract(aliases) {
  const entries = Object.entries(aliases)
    .map(([source, key]) => [key, source])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw Error("Canonical locale keys must have one source each");
  return {
    format_version: "2",
    catalog_version:
      "sha256:" +
      crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
    header: CSV_HEADER,
  };
}
module.exports = { CSV_HEADER, localeContract };
