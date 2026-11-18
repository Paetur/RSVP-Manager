// Explicit historical Phase A endpoints; all SQL runs in disposable WASM PostgreSQL.
// The current 43-table application update is covered by queued-upgrade.cjs.
const fs = require("node:fs"), assert = require("node:assert/strict");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
const { statements, buildUpgrade, sha256 } = require("../tools/build-shortcuts-upgrade.cjs");
const args = process.argv.slice(2), paths = {};
assert.equal(args.length, 4, "Usage: node tests/shortcuts-upgrade.cjs --from /protected/pre-phase-a.sql --to /protected/accepted-phase-c.sql");
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--from", "--to"].includes(args[i]) && !paths[args[i]], "Choose each explicit Phase A endpoint once");
  paths[args[i]] = args[i + 1];
}
const from = fs.readFileSync(paths["--from"], "utf8"), to = fs.readFileSync(paths["--to"], "utf8");
(async () => {
  assert.equal(statements("-- ;\nBEGIN;/* nested /* ; */ comment */ SELECT E'one\\\'two;';DO $tag$ BEGIN PERFORM ';';END $tag$;COMMIT;").length, 4);
  assert.throws(() => statements("SELECT $$unterminated;"), /Unterminated/);
  const options = { from, to, expectedFromSha256: sha256(from) }, upgrade = buildUpgrade(options);
  assert.throws(() => buildUpgrade({ ...options, expectedFromSha256: "0".repeat(64) }), /SHA-256/);
  assert.throws(() => buildUpgrade({ ...options, to: to.replace("CREATE TABLE public.admins (", "CREATE TABLE public.renamed_admins (") }), /non-function baseline statement/);
  assert.ok(!upgrade.sql.includes("Alpha baseline requires an empty application schema"));
  assert.match(upgrade.sql, /^BEGIN;$/m); assert.match(upgrade.sql, /COMMIT;\s*$/);
  const db = await createDatabase({ install: false }), rollback = await createDatabase({ install: false }), wrong = await createDatabase({ install: false });
  try {
    const value = async (database, sql, params = []) => (await database.query(sql, params)).rows[0].v;
    await db.exec(from); await signIn(db);
    const household = await value(db, "SELECT public.admin_save_household(null,$1) v", [{ household_name: "Preserve upgrade household", planning_group_id: "general", language: "en", notes: "Keep this data" }]);
    const guest = await value(db, "SELECT public.admin_create_guest($1,$2) v", [household, { first_name: "Synthetic", last_name: "Upgrade" }]);
    const image = { image: "data:image/jpeg;base64," + fs.readFileSync("tests/fixtures/customization.jpg").toString("base64"), name: "synthetic-upgrade.jpg", crop: { x: 0, y: 0, width: 3, height: 2, sourceWidth: 3, sourceHeight: 2 } };
    await db.query("SELECT public.admin_save_delivery(null,$1,$2,null)", [household, { channel: "manual", status: "draft", message_body: "Preserve {invitation_link}", message_image: image }]);
    await db.exec("RESET ROLE");
    const eventSession = await value(db, "INSERT INTO public.event_sessions(session_key,name) VALUES('upgrade-dinner','Synthetic dinner') RETURNING id v");
    await db.query("INSERT INTO public.household_session_defaults VALUES($1,$2,true)", [household,eventSession]);
    const food = await value(db, "INSERT INTO public.food_items(name_en,quantity_needed) VALUES('Synthetic food',3) RETURNING id v");
    await db.query("UPDATE public.households SET food=true WHERE id=$1", [household]);
    await db.exec("UPDATE public.event_settings SET food_stage='selection',is_published=true WHERE id=1");
    const code = await value(db, "SELECT invite_code v FROM public.households WHERE id=$1", [household]);
    await db.query("SELECT public.submit_household_rsvp($1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$2)", [code,[{guest_id:guest,session_id:eventSession,status:'attending'}]]);
    await db.query("SELECT public.set_household_food_claim($1,$2,2,null)", [code,food]);
    await db.query("SELECT public.confirm_household_food($1)", [code]);
    await db.exec("UPDATE public.event_settings SET is_published=false WHERE id=1;SET ROLE authenticated");
    const before = await value(db, "SELECT public.admin_export_backup() v");
    await db.exec("RESET ROLE");
    const authBefore = await value(db, "SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u)) FROM auth.users u),'sessions',(SELECT jsonb_agg(to_jsonb(s)) FROM auth.sessions s)) v");
    const installation = await value(db, "SELECT installation_id v FROM app_private.backup_origin");
    await db.exec(upgrade.sql);
    assert.equal(await value(db, "SELECT installation_id v FROM app_private.backup_origin"), installation);
    assert.deepEqual(await value(db, "SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u)) FROM auth.users u),'sessions',(SELECT jsonb_agg(to_jsonb(s)) FROM auth.sessions s)) v"), authBefore);
    const extra = { "public.households": ["first_visited_at", "last_visited_at", "visit_count"], "public.invitation_send_queue": ["handed_to_shortcuts_at", "shortcuts_processed_at", "verified_sent_at", "shortcuts_error", "shortcuts_attempt_id", "shortcuts_batch_id"] };
    await db.exec("SET ROLE authenticated");
    const after = await value(db, "SELECT public.admin_export_backup() v");
    for (const [table, rows] of Object.entries(before.payload.tables)) {
      const projected = after.payload.tables[table].map(row => Object.fromEntries(Object.entries(row).filter(([name]) => !(extra[table] || []).includes(name))));
      assert.deepEqual(projected.map(JSON.stringify).sort(), rows.map(JSON.stringify).sort(), table + " preserved through scoped upgrade");
    }
    assert.equal(after.payload.tables["public.households"][0].visit_count, "0", "old raw loads are not promoted to qualified visits");
    assert.deepEqual(after.payload.tables["public.invitation_send_queue"][0].message_image, image);
    assert.equal(after.payload.tables["public.event_settings"][0].is_published, false);
    await db.exec("RESET ROLE");
    await assert.rejects(db.exec(upgrade.sql), /already installed or partly applied/); await db.exec("ROLLBACK");
    await rollback.exec(from);
    await rollback.exec("UPDATE public.event_settings SET event_name='Preserve failed upgrade' WHERE id=1");
    await assert.rejects(rollback.exec(upgrade.sql.replace(/COMMIT;\s*$/, () => "DO $$ BEGIN RAISE EXCEPTION 'synthetic late upgrade failure';END $$;COMMIT;")), /synthetic late upgrade failure/);
    await rollback.exec("ROLLBACK");
    assert.equal(await value(rollback, "SELECT to_regclass('public.invitation_shortcut_batches') IS NULL v"), true);
    assert.equal(await value(rollback, "SELECT count(*)::int v FROM information_schema.columns WHERE table_schema='public' AND table_name='households' AND column_name='visit_count'"), 0);
    assert.equal(await value(rollback, "SELECT event_name v FROM public.event_settings"), "Preserve failed upgrade");
    await wrong.exec(from);
    await wrong.exec("CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql AS $$SELECT ARRAY[]::text[]$$");
    await assert.rejects(wrong.exec(upgrade.sql), /source function does not match/); await wrong.exec("ROLLBACK");
    assert.equal(await value(wrong, "SELECT to_regclass('public.invitation_shortcut_batches') IS NULL v"), true);
    console.log("PASS offline scoped upgrade: explicit source hash, SQL parser and shape guards; old→new data/image/Auth preservation, no visit inference, replay/source rejection and atomic late-failure rollback.");
  } finally { await db.close(); await rollback.close(); await wrong.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
