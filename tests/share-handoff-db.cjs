// Disposable PostgreSQL (PGlite). No network, production data or credentials.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  let checks = 0;
  const q = (s, p = []) => db.query(s, p);
  const scalar = async (s, p) => (await q(s, p)).rows[0].value;
  async function reject(s, p, pattern) {
    await assert.rejects(() => q(s, p), pattern);
    checks++;
  }
  await db.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz NOT NULL DEFAULT now()); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`,
  );
  for (const file of fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await db.exec(
    "UPDATE public.event_settings SET food_stage='selection' WHERE id=1",
  );
  await db.exec(
    `INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111','test@example.invalid'),('22222222-2222-4222-8222-222222222222','other@example.invalid');INSERT INTO public.admins(user_id,name) VALUES('11111111-1111-4111-8111-111111111111','Test');INSERT INTO auth.sessions(id,user_id) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','11111111-1111-4111-8111-111111111111');SET request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5"}';SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111'; SET ROLE authenticated;`,
  );

  const h = await scalar("select public.admin_save_household(null,$1) value", [
    {
      household_name: "Share fixture",
      planning_group_id: "general",
      language: "en",
    },
  ]);
  await q("select public.admin_create_guest($1,$2)", [
    h,
    { first_name: "Synthetic" },
  ]);
  await q("update public.event_settings set is_published=true where id=1");
  const delivery = await scalar(
    "select public.admin_save_delivery(null,$1,$2,null) value",
    [
      h,
      {
        channel: "manual",
        status: "ready",
        message_body: "Synthetic invitation",
      },
    ],
  );
  const revision = await scalar(
    "select revision value from public.invitation_send_queue where id=$1",
    [delivery],
  );
  const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const record = () =>
    q("select public.admin_record_share_handoff($1,$2,$3)", [
      delivery,
      revision,
      id,
    ]);
  await record();
  await record();
  assert.equal(
    await scalar(
      "select count(*)::int value from public.invitation_delivery_audit where queue_id=$1 and action='share_handoff_completed'",
      [delivery],
    ),
    1,
  );
  assert.equal(
    await scalar(
      "select status value from public.invitation_send_queue where id=$1",
      [delivery],
    ),
    "ready",
  );
  assert.equal(
    await scalar(
      "select revision value from public.invitation_send_queue where id=$1",
      [delivery],
    ),
    revision,
  );
  assert.equal(
    await scalar(
      "select count(*)::int value from public.invitation_deliveries where queue_id=$1",
      [delivery],
    ),
    0,
  );
  await reject(
    "select public.admin_record_share_handoff($1,$2,$3)",
    [delivery, revision + 1, id],
    /changed/,
  );
  await q("update public.event_settings set is_published=false where id=1");
  await assert.rejects(record, /published/);
  await q("update public.event_settings set is_published=true where id=1");
  await db.exec("RESET ROLE");
  assert.equal(
    await scalar(
      "select count(*)::int value from app_private.administration_log_entries where action='share_handoff_completed'",
    ),
    1,
  );
  await db.exec("SET ROLE anon");
  await assert.rejects(record, /permission denied/);
  await db.exec("RESET ROLE");
  await q(
    "update public.admins set access_permissions=app_private.permission_preset('view')",
  );
  await db.exec("SET ROLE authenticated");
  await assert.rejects(record, /permission|access/i);
  await db.close();
  console.log(
    "PASS handoff audit: idempotent log, unchanged ready/revision, no sent record, separate admin log action, publication/revision/permission guards.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
