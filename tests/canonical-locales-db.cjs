// Current catalog v2 is a clean baseline; test only isolated databases.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const migration = "20261113013341_canonical_locale_registry.sql";
const auth =
  "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;";
(async () => {
  const db = new PGlite(),
    v = async (s, a = []) => (await db.query(s, a)).rows[0].v;
  try {
    await db.exec(auth);
    const install = fs.readFileSync("supabase/install.sql", "utf8");
    await db.exec(install.split("-- Migration: " + migration)[0]);
    const id = "11111111-1111-4111-8111-111111111111",
      session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.query(
      "INSERT INTO auth.users VALUES($1,'synthetic@example.invalid',now(),'unused')",
      [id],
    );
    await db.query(
      "INSERT INTO public.admins(user_id,name) VALUES($1,'Synthetic')",
      [id],
    );
    await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
      session,
      id,
    ]);
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [id, JSON.stringify({ sub: id, session_id: session })],
    );
    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT public.admin_save_translation('ui:Save','de','Test')",
    );
    await db.exec("RESET ROLE");
    await assert.rejects(
      () =>
        db.exec(fs.readFileSync("supabase/migrations/" + migration, "utf8")),
      /Review saved interface overrides/,
    );
    await db.exec("ROLLBACK");
    assert.equal(
      await v("SELECT count(*)::int v FROM public.translation_overrides"),
      1,
    );
    await db.exec("DELETE FROM public.translation_overrides");
    const before = await v("SELECT app_private.backup_payload() v"),
      acl = await v(
        "SELECT proacl::text v FROM pg_proc WHERE oid='app_private.translation_keys()'::regprocedure",
      );
    await db.exec(fs.readFileSync("supabase/migrations/" + migration, "utf8"));
    for (const file of fs
      .readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql") && f > migration)
      .sort())
      await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
    const registry = await v("SELECT app_private.translation_keys() v"),
      expected = JSON.parse(fs.readFileSync("locales/aliases.json"));
    assert.deepEqual(registry, expected);
    assert.equal(Object.keys(registry).length, Object.keys(expected).length);
    const afterTables = (await v("SELECT app_private.backup_payload() v"))
      .tables;
    assert.equal(
      await v(
        "SELECT to_regclass('app_private.restored_activity_logs') IS NULL v",
      ),
      true,
      "Snapshot cleanup leaves no history table",
    );
    assert.deepEqual(
      afterTables,
      before.tables,
      "All existing event data and domain unit identities unchanged",
    );
    assert.equal(
      await v(
        "SELECT proacl::text v FROM pg_proc WHERE oid='app_private.translation_keys()'::regprocedure",
      ),
      acl,
    );
    for (const [source, key] of Object.entries(expected))
      assert(!/^[+＋] /.test(source), "No obsolete Add prefix");
    assert(!registry["User Comment"]);
    assert(!registry["＋ Add venue"]);
    assert.equal(registry["Guest note"], "interface.messages.guest_note");
    await db.exec("SET ROLE authenticated");
    await db.query(
      "SELECT public.admin_save_translation('ui:Batches','de','Chargen')",
    );
    assert.equal(
      await v(
        "SELECT translation_key v FROM public.translation_overrides WHERE source_text='Batches'",
      ),
      "types.units.batch_s",
    );
    await db.exec("RESET ROLE");
    const fresh = new PGlite();
    try {
      await fresh.exec(auth);
      await fresh.exec(install);
      assert.deepEqual(
        (await fresh.query("SELECT app_private.translation_keys() v")).rows[0]
          .v,
        expected,
      );
    } finally {
      await fresh.close();
    }
    console.log(
      "PASS canonical locales: saved-override guard/rollback, exact v2 registry, all event rows and ACL preserved, canonical unit wording, clean source aliases and fresh-install equivalence.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
