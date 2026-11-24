import { createHash, randomBytes } from "node:crypto";

export const quote = (value: string) =>
  "E'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
export function block(body: string) {
  let tag: string;
  do {
    tag = "$setup_" + randomBytes(12).toString("hex") + "$";
  } while (body.includes(tag));
  return "DO " + tag + "BEGIN\n" + body + "\nEND " + tag + ";";
}
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

// PostgreSQL dump statements contain dollar-quoted bodies and quoted semicolons.
// Split only outer statements; never rewrite the SQL inside a function.
export function statements(sql: string, delimiter = ";"): string[] {
  const result: string[] = [];
  let text = "",
    nesting = 0;
  for (let i = 0; i < sql.length; ) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      text += "\n";
      continue;
    }
    if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw Error("Invalid installer comment");
      text += " ";
      continue;
    }
    const dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end < 0) throw Error("Invalid installer body");
      text += sql.slice(i, end + dollar.length);
      i = end + dollar.length;
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const token = sql[i];
      text += token;
      i++;
      let closed = false;
      while (i < sql.length) {
        const char = sql[i++];
        text += char;
        if (char === "\\" && token === "'" && i < sql.length) {
          text += sql[i++];
          continue;
        }
        if (char === token) {
          if (sql[i] === token) text += sql[i++];
          else {
            closed = true;
            break;
          }
        }
      }
      if (!closed) throw Error("Invalid installer string");
      continue;
    }
    if (delimiter === "," && (sql[i] === "[" || sql[i] === "(")) nesting++;
    if (delimiter === "," && (sql[i] === "]" || sql[i] === ")")) nesting--;
    if (sql[i] === delimiter && !nesting) {
      if (text.trim()) result.push(text.trim());
      text = "";
      i++;
    } else text += sql[i++];
  }
  if (text.trim()) result.push(text.trim());
  return result;
}

type ObjectDefinition = { sql: string; missing: string; name: string };
const identifier = "[a-z_][a-z0-9_]*";
const qualified = `(${identifier}\\.${identifier})`;

function columnCatalog(table: string, name: string) {
  return `SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass(${quote(table)}) AND attname=${quote(name)} AND NOT attisdropped`;
}

export function schemaPlan(installer: string) {
  const objects: ObjectDefinition[] = [],
    permissions: string[] = [],
    seeds: string[] = [],
    checks: string[] = [];
  const tables: string[] = [];
  const functions = new Map<string, { object: ObjectDefinition; check: number }>();
  for (const sql of statements(installer)) {
    let match: RegExpMatchArray | null;
    if (
      /^(BEGIN|COMMIT|SET\s|SELECT pg_catalog\.|DO \$fresh_install\$)/.test(sql)
    )
      continue;
    if (
      (match = sql.match(
        new RegExp(`^CREATE SCHEMA (?:IF NOT EXISTS )?(${identifier})$`),
      ))
    ) {
      objects.push({
        sql,
        name: match[1],
        missing: `to_regnamespace(${quote(match[1])}) IS NULL`,
      });
    } else if (
      (match = sql.match(new RegExp(`^CREATE TABLE ${qualified}\\s*\\(`)))
    ) {
      const table = match[1];
      tables.push(table);
      objects.push({
        sql,
        name: table,
        missing: `to_regclass(${quote(table)}) IS NULL`,
      });
      // Refuse incompatible existing tables instead of inventing destructive ALTERs.
      for (const line of sql
        .slice(sql.indexOf("(") + 1, sql.lastIndexOf(")"))
        .split("\n")) {
        const column = line
          .trim()
          .match(
            new RegExp(
              `^(${identifier})\\s+(.+?)(?:\\s+DEFAULT|\\s+NOT NULL|\\s+PRIMARY KEY|\\s+REFERENCES|\\s+CHECK|\\s+UNIQUE|,?$)`,
            ),
          );
        if (
          !column ||
          /^(CONSTRAINT|CHECK|PRIMARY|FOREIGN|UNIQUE)\b/.test(line.trim())
        )
          continue;
        const name = column[1],
          type = column[2].replace(/,$/, "");
        checks.push(
          `EXISTS (${columnCatalog(table, name)} AND atttypid=to_regtype(${quote(type)}))`,
        );
      }
    } else if (
      (match = sql.match(
        new RegExp(`^CREATE (OR REPLACE )?FUNCTION ${qualified}\\(([^]*?)\\)\\s+RETURNS\\b`),
      ))
    ) {
      // Dump arguments always name their parameters; split defaults without losing commas in literals.
      const types = statements(match[3], ",").map((arg) =>
        arg.replace(/\s+DEFAULT[^]*$/, "").replace(/^\S+\s+/, ""),
      );
      const name = match[2] + "(" + types.join(",") + ")";
      const previous = functions.get(name);
      if (Boolean(previous) !== Boolean(match[1]))
        throw Error("Unexpected installer function definition: " + name);
      const body = sql.match(
        /\bAS\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([^]*?)\1/,
      );
      if (!body) throw Error("Unsupported function body in installer");
      const check = `EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(${quote(name)}) AND prosrc=${quote(body[2])} AND prosecdef=${/SECURITY DEFINER/.test(sql.slice(0, body.index))})`;
      if (previous) {
        // Use the final installer definition when the function is missing.
        previous.object.sql = sql.replace(/^CREATE OR REPLACE /, "CREATE ");
        checks[previous.check] = check;
      } else {
        const object = { sql, name, missing: `to_regprocedure(${quote(name)}) IS NULL` };
        functions.set(name, { object, check: checks.length });
        objects.push(object);
        checks.push(check);
      }
    } else if (
      (match = sql.match(
        new RegExp(`^CREATE (?:UNIQUE )?INDEX (${identifier}) ON ${qualified}`),
      ))
    ) {
      const schema = match[2].split(".")[0],
        name = schema + "." + match[1];
      objects.push({
        sql,
        name,
        missing: `to_regclass(${quote(name)}) IS NULL`,
      });
    } else if (
      (match = sql.match(new RegExp(`^CREATE VIEW ${qualified}\\s`)))
    ) {
      objects.push({
        sql,
        name: match[1],
        missing: `to_regclass(${quote(match[1])}) IS NULL`,
      });
    } else if (
      (match = sql.match(
        new RegExp(`^CREATE (?:CONSTRAINT )?TRIGGER (${identifier})\\s+[^]*?\\s+ON\\s+${qualified}\\s`),
      ))
    ) {
      objects.push({
        sql,
        name: match[2] + ":" + match[1],
        missing: `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=to_regclass(${quote(match[2])}) AND tgname=${quote(match[1])} AND NOT tgisinternal)`,
      });
    } else if (
      (match = sql.match(
        new RegExp(`^CREATE POLICY (${identifier}) ON ${qualified} `),
      ))
    ) {
      objects.push({
        sql,
        name: match[2] + ":" + match[1],
        missing: `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=to_regclass(${quote(match[2])}) AND polname=${quote(match[1])})`,
      });
    } else if (
      (match = sql.match(
        new RegExp(
          `^(ALTER TABLE (?:ONLY )?${qualified})\\s+(ADD (?:COLUMN|CONSTRAINT)\\s+[^]*)$`,
        ),
      ))
    ) {
      const [, alter, table, actions] = match;
      for (const action of statements(actions, ",")) {
        const column = action.match(
          new RegExp(`^ADD COLUMN (${identifier})\\s+(.+?)(?=\\s+(?:NOT NULL|DEFAULT|CHECK|REFERENCES|UNIQUE|PRIMARY KEY)\\b|$)`),
        );
        const constraint = action.match(new RegExp(`^ADD CONSTRAINT (${identifier})\\s`));
        if (column) {
          const [, name, type] = column;
          const catalog = columnCatalog(table, name);
          const required = /^\s+NOT NULL\b/.test(action.slice(column[0].length));
          objects.push({
            sql: alter + " " + action,
            name: table + "." + name,
            missing: `NOT EXISTS (${catalog})`,
          });
          checks.push(
            `EXISTS (${catalog} AND atttypid=to_regtype(${quote(type)}) AND attnotnull=${required})`,
          );
        } else if (constraint) {
          const name = constraint[1];
          objects.push({
            sql: alter + " " + action,
            name: table + ":" + name,
            missing: `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=to_regclass(${quote(table)}) AND conname=${quote(name)})`,
          });
        } else throw Error("Unsupported installer table alteration: " + action.slice(0, 65));
      }
    } else if (
      (match = sql.match(
        new RegExp(
          `^ALTER TABLE ${qualified} ALTER COLUMN (${identifier}) ADD GENERATED`,
        ),
      ))
    ) {
      objects.push({
        sql,
        name: match[1] + ":" + match[2],
        missing: `EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass(${quote(match[1])}) AND attname=${quote(match[2])} AND attidentity='')`,
      });
    } else if (
      /^(GRANT |REVOKE |NOTIFY pgrst|ALTER TABLE \S+ ENABLE ROW LEVEL SECURITY|DO \$(?:admin_change_triggers|guest_overview_access)\$)/.test(
        sql,
      )
    ) {
      permissions.push(sql);
    } else if (
      /^INSERT INTO public\.(event_languages|event_settings) /.test(sql) ||
      sql === "INSERT INTO app_private.admin_change_clock DEFAULT VALUES" ||
      /^INSERT INTO app_private\.(backup_origin|shortcut_runtime|guest_visit_scope)\(singleton\) VALUES\(true\)$/.test(sql)
    ) {
      seeds.push(sql + " ON CONFLICT DO NOTHING");
    } else throw Error("Unsupported installer statement: " + sql.slice(0, 65));
  }
  const verification = [
    ...objects.map((object) => `NOT (${object.missing})`),
    ...checks,
    ...tables.map(
      (table) =>
        `EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=to_regclass(${quote(table)}) AND relrowsecurity)`,
    ),
  ];
  const verifySQL =
    "SELECT " +
    verification.map((condition) => "(" + condition + ")").join(" AND ") +
    " AS valid";
  const repairSQL =
    [
      "BEGIN",
      "SELECT pg_catalog.pg_advisory_xact_lock(19421,9201)",
      "SET LOCAL check_function_bodies=false",
      "SET LOCAL search_path=''",
      ...objects.map((object) =>
        block(
          `IF ${object.missing} THEN EXECUTE ${quote(object.sql)}; END IF;`,
        ),
      ),
      ...permissions,
      ...seeds,
    ].join(";\n") + ";\n";
  return {
    tables,
    objects,
    verifySQL,
    repairSQL,
    verifyExpression: verification
      .map((condition) => "(" + condition + ")")
      .join(" AND "),
  };
}
