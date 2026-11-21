// A prior released baseline is required; all data and SQL stay in disposable PGlite.
const assert = require("node:assert/strict"), fs = require("node:fs"), cp = require("node:child_process"), crypto = require("node:crypto");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
const { statements } = require("../tools/build-shortcuts-upgrade.cjs");
const args = process.argv.slice(2);
assert.ok(!args.length || args.length === 2 && args[0] === "--from", "Usage: node tests/upgrade-alpha9-db.cjs [--from /protected/alpha8-baseline.sql]");
const previous = args.length ? fs.readFileSync(args[1], "utf8") : cp.execFileSync("git", ["show", "v0.9.0-alpha.8:supabase/migrations/20261114034908_alpha_baseline.sql"], { encoding: "utf8" });
const current = fs.readFileSync("supabase/migrations/20261114034908_alpha_baseline.sql", "utf8"), upgrade = fs.readFileSync("supabase/upgrades/alpha8-to-alpha9.sql", "utf8");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
assert.equal(sha(previous), upgrade.match(/Source baseline SHA-256: ([a-f0-9]{64})/)[1], "use the exact published alpha.8 baseline");
assert.equal(sha(current), upgrade.match(/Target baseline SHA-256: ([a-f0-9]{64})/)[1], "upgrade targets the current canonical baseline");
function bodyFor(source, name) {
  const sql = statements(source).find(sql => sql.startsWith("CREATE FUNCTION " + name + "("));
  assert.ok(sql, name);
  return sql.match(/\bAS (\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)([\s\S]*)\1;$/)[2];
}
(async () => {
  const db = await createDatabase({ install: false });
  const value = async (sql, params = []) => (await db.query(sql, params)).rows[0].v;
  try {
    await db.exec(previous);
    await db.exec("CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean); CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,metadata jsonb); INSERT INTO storage.buckets VALUES('private',false); INSERT INTO storage.objects VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','private','synthetic-private-photo.jpg','{\"synthetic\":true}');");
    await signIn(db);
    const picture = { image: "data:image/jpeg;base64," + fs.readFileSync("tests/fixtures/customization.jpg").toString("base64"), name: "synthetic-upgrade.jpg", crop: { x: 0, y: 0, width: 3, height: 2, sourceWidth: 3, sourceHeight: 2 } };
    const templateId = await value("SELECT public.admin_save_invitation_template(NULL,$1) v", [{ name: "Retained template", channels: ["email"], versions: { en: { subject: "Retained subject", body: "Keep {household_name} {invitation_link}", options: ["subject", "message", "picture"], message_image: picture } } }]);
    const family = await value("SELECT public.admin_save_household(NULL,$1) v", [{ household_name: "Synthetic upgrade household", planning_group_id: "general", language: "en" }]);
    await db.query("SELECT public.admin_create_guest($1,$2)", [family, { first_name: "Synthetic", last_name: "Guest" }]);
    await db.query("SELECT public.admin_save_delivery(NULL,$1,$2,NULL)", [family, { channel: "manual", status: "draft", message_body: "Retained draft {invitation_link}", message_image: picture }]);
    await db.exec("RESET ROLE");
    await db.query("UPDATE public.event_settings SET guest_background=$1 WHERE id=1", [picture]);
    const tables = (await db.query("SELECT n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app_private','auth','storage') AND c.relkind IN ('r','p') ORDER BY 1")).rows.map(row => row.name);
    async function state() {
      const data = {};
      for (const name of tables) data[name] = await value("SELECT coalesce(jsonb_agg(payload ORDER BY payload::text),'[]') v FROM (SELECT to_jsonb(t)" + (name === "public.message_templates" ? "-'delivery_language_tags'" : "") + " payload FROM " + name + " t) rows");
      return data;
    }
    const before = await state(), oldKeys = await value("SELECT app_private.translation_keys() v");
    const contract = await value("SELECT app_private.backup_tables() v");
    assert.equal(contract.length, 43);
    const marker = "SELECT pg_catalog.pg_advisory_xact_lock(19421,7744);";
    async function rejected(sql, pattern) {
      await assert.rejects(db.exec(sql), pattern);
      await db.exec("ROLLBACK");
      assert.deepEqual(await state(), before, "rejected upgrade preserves every existing row, including Auth/Storage/photos");
      assert.equal(await value("SELECT count(*)::int v FROM information_schema.columns WHERE table_schema='public' AND table_name='message_templates' AND column_name='delivery_language_tags'"), 0);
    }
    await rejected(upgrade.replace(marker, marker + "\nUPDATE public.event_settings SET is_published=true;"), /unpublished/);
    await rejected(upgrade.replace(marker, () => marker + "\nCREATE OR REPLACE FUNCTION app_private.valid_template_channels(value text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT false$$;"), /source function does not match/);
    await rejected(upgrade.replace(marker, marker + "\nALTER TABLE public.households ADD COLUMN unexpected_source_drift text;"), /schema fingerprint/);
    await rejected(upgrade.replace("DO $preserved$", "UPDATE public.event_settings SET organizer_name='Unexpected write';\nDO $preserved$"), /Existing rows changed/);
    await rejected(upgrade.replace("DO $preserved$", "GRANT EXECUTE ON FUNCTION app_private.matches_bulk_draft_template(public.households,text,uuid,uuid) TO authenticated;\nDO $preserved$"), /owner-only/);
    await rejected(upgrade.replace(/COMMIT;\s*$/, () => "DO $$ BEGIN RAISE EXCEPTION 'synthetic late alpha9 failure'; END $$;\nCOMMIT;"), /synthetic late alpha9 failure/);
    await db.exec(upgrade);
    assert.deepEqual(await state(), before, "success preserves all previous column values and rows");
    assert.deepEqual(await value("SELECT app_private.backup_tables() v"), contract);
    assert.equal(await value("SELECT count(*)::int v FROM public.message_templates WHERE delivery_language_tags IS NOT NULL"), 0);
    assert.equal(await value("SELECT column_default v FROM information_schema.columns WHERE table_schema='public' AND table_name='message_templates' AND column_name='delivery_language_tags'"), null, "new nullable column matches the baseline without a default/backfill");
    const keys = await value("SELECT app_private.translation_keys() v");
    for (const [label, key] of Object.entries(oldKeys)) assert.equal(keys[label], key, "existing translation mappings survive");
    assert.deepEqual(keys, JSON.parse(fs.readFileSync("locales/aliases.json", "utf8")));
    assert.equal(Object.keys(keys).length - Object.keys(oldKeys).length, 107);
    for (const name of ["public.admin_save_delivery", "public.admin_save_invitation_template", "app_private.invitation_templates", "app_private.valid_template_channels", "app_private.translation_keys", "app_private.matches_bulk_draft_template"])
      assert.equal(await value("SELECT prosrc v FROM pg_proc WHERE oid=$1::regprocedure", [{ "public.admin_save_delivery": "public.admin_save_delivery(uuid,uuid,jsonb,integer)", "public.admin_save_invitation_template": "public.admin_save_invitation_template(uuid,jsonb,jsonb)", "app_private.invitation_templates": "app_private.invitation_templates()", "app_private.valid_template_channels": "app_private.valid_template_channels(text[])", "app_private.translation_keys": "app_private.translation_keys()", "app_private.matches_bulk_draft_template": "app_private.matches_bulk_draft_template(public.households,text,uuid,uuid)" }[name]]), bodyFor(current, name));
    const backup = await value("SELECT app_private.seal_backup(app_private.backup_payload()) v");
    assert.ok(backup.payload.columns["public.message_templates"].some(column => column.name === "delivery_language_tags"));
    await db.query("SELECT app_private.validate_backup($1)", [backup]);
    assert.equal(await value("SELECT is_published v FROM public.event_settings WHERE id=1"), false);
    assert.equal(await value("SELECT enabled v FROM app_private.shortcut_runtime WHERE singleton"), false);
    await assert.rejects(db.exec(upgrade), /already installed or partly applied/); await db.exec("ROLLBACK");
    assert.deepEqual(await state(), before, "replay cannot change previous data");
    await db.exec("SET ROLE authenticated");
    await assert.rejects(db.query("SELECT app_private.matches_bulk_draft_template(NULL,'email',NULL,NULL)"), /permission denied/);
    const loaded = await value("SELECT public.admin_load_data() v");
    const template = loaded.invitationTemplates.find(row => row.id === templateId);
    assert.deepEqual(template.language_tags, []);
    await db.query("SELECT public.admin_save_invitation_template($1,$2,$3)", [templateId, { name: template.name, channels: ["messages"], language_tags: ["en"], versions: template.versions }, template]);
    assert.deepEqual((await value("SELECT public.admin_load_data() v")).invitationTemplates.find(row => row.id === templateId).language_tags, ["en"]);
    await db.exec("SET ROLE anon");
    await assert.rejects(db.query("SELECT public.admin_save_invitation_template(NULL,'{}')"), /permission denied/);
    console.log("PASS alpha8-to-alpha9 upgrade: exact source/schema guards, all-row/Auth/Storage/photo preservation, canonical functions/107 additive labels, private matcher grants, 43-table backup, untagged templates, role denials, replay and injected late-failure rollback.");
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
