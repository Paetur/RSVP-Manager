// Current catalog v2 is a clean baseline; test only isolated databases.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const auth =
  "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;";
(async () => {
  const db = new PGlite(),
    v = async (s, a = []) => (await db.query(s, a)).rows[0].v;
  try {
    await db.exec(auth);
    await db.exec(fs.readFileSync("supabase/install.sql", "utf8"));
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
    const registry = await v("SELECT app_private.translation_keys() v"),
      expected = JSON.parse(fs.readFileSync("locales/aliases.json"));
    assert.deepEqual(registry, expected);
    assert.equal(Object.keys(registry).length, Object.keys(expected).length);
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
    console.log(
      "PASS canonical locales: exact current registry, canonical override storage, canonical unit wording and clean source aliases.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
