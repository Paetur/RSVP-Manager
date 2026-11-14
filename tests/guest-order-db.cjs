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
      household_name: "Order fixture",
      planning_group_id: "general",
      language: "en",
    },
  ]);
  const add = async (name, child = false) =>
    scalar("select public.admin_create_guest($1,$2) value", [
      h,
      { first_name: name, is_child: child },
    ]);
  const a = await add("Zoe"),
    b = await add("Alice"),
    c = await add("Charlie", true),
    d = await add("Ben", true);
  // Historical crossed manual positions must display as adults, then children.
  await db.exec("RESET ROLE");
  for (const [id, n] of [
    [c, 0],
    [b, 2],
    [d, 4],
    [a, 9],
  ])
    await q("update public.guests set sort_order=$2 where id=$1", [id, n]);
  const ids = async () =>
    (
      await q(
        "select id from public.guests where household_id=$1 and archived_at is null order by is_child,sort_order nulls last,lower(first_name),id",
        [h],
      )
    ).rows.map((x) => x.id);
  await db.exec("SET ROLE authenticated");
  assert.deepEqual(await ids(), [b, a, c, d]);
  await q("select public.admin_order_guest($1,1,$2)", [a, [b, a, c, d]]);
  assert.deepEqual(await ids(), [b, a, c, d]);
  await q("select public.admin_order_guest($1,-1,$2)", [c, [b, a, c, d]]);
  assert.deepEqual(await ids(), [b, a, c, d]);
  await reject(
    "select public.admin_order_guest($1,1,$2)",
    [b, [c, b, d, a]],
    /order changed/,
  );
  await q("select public.admin_order_guest($1,-1,$2)", [a, [b, a, c, d]]);
  assert.deepEqual(await ids(), [a, b, c, d]);
  await reject(
    "select public.admin_order_guest($1,1,$2)",
    [a, [b, a, c, d]],
    /order changed/,
  );
  await q("select public.admin_order_guest($1,-1,$2)", [d, [a, b, c, d]]);
  assert.deepEqual(await ids(), [a, b, d, c]);
  // A status change appends to the new section, and leaves identity intact.
  await q("select public.admin_save_guest_details($1,$2,$3)", [
    a,
    h,
    { first_name: "Zoe", is_child: true },
  ]);
  assert.deepEqual(await ids(), [b, d, c, a]);
  await q("select public.admin_save_guest_details($1,$2,$3)", [
    d,
    h,
    { first_name: "Ben", is_child: false },
  ]);
  assert.deepEqual(await ids(), [b, d, c, a]);
  await db.exec("RESET ROLE");
  await q("update public.guests set sort_order=null where id=$1", [d]);
  await db.exec("SET ROLE authenticated");
  const e = await add("Aaron");
  assert.deepEqual(await ids(), [b, d, e, c, a]);
  const f = await add("Abby", true);
  assert.deepEqual(await ids(), [b, d, e, c, a, f]);
  // The trigger retains explicit restored manual positions and does not touch replies.
  await db.exec("RESET ROLE");
  const before = await scalar(
    "select count(*)::int value from public.guest_session_responses",
  );
  await q("update public.guests set notes=$2 where id=$1", [
    e,
    "Unrelated edit",
  ]);
  assert.deepEqual(await ids(), [b, d, e, c, a, f]);
  assert.equal(
    await scalar(
      "select count(*)::int value from public.guest_session_responses",
    ),
    before,
  );
  await db.exec("SET ROLE anon");
  await reject(
    "select public.admin_order_guest($1,1,null)",
    [b],
    /permission denied/,
  );
  await db.close();
  console.log(
    "PASS guest order DB: crossed historical order, group boundaries, moves, stale order, adult/child changes, additions and permissions.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
