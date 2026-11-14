// Disposable current-alpha databases only. Never reads deployment credentials.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const auth = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());
CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;`;
const admin = "11111111-1111-4111-8111-111111111111",
  session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function createDatabase({ install = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(auth);
    if (install) await db.exec(fs.readFileSync("supabase/install.sql", "utf8"));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function signIn(db) {
  await db.query(
    "INSERT INTO auth.users VALUES($1,'synthetic@example.invalid',now(),'unused')",
    [admin],
  );
  await db.query(
    "INSERT INTO public.admins(user_id,name) VALUES($1,'Synthetic')",
    [admin],
  );
  await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
    session,
    admin,
  ]);
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [admin, JSON.stringify({ sub: admin, session_id: session })],
  );
  await db.exec("SET ROLE authenticated");
}
module.exports = { auth, createDatabase, signIn };
