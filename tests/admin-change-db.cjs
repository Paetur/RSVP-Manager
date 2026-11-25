// Synthetic administrators and records in a disposable database.
const assert = require("node:assert/strict");
const { createDatabase, signIn, withRecordRevision } = require("./helpers/alpha-database.cjs");

(async () => {
  const db = await createDatabase();
  const query = (sql, args = []) => db.query(sql, args);
  const value = async (sql, args) => (await query(sql, args)).rows[0].value;
  const data = () => value("SELECT public.admin_load_data(true) value");
  const marker = () => value("SELECT public.admin_change_marker() value");
  const stale = /This record changed since you opened it/;
  const owner = "11111111-1111-4111-8111-111111111111";
  const ownerSession = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const reviewer = "22222222-2222-4222-8222-222222222222";
  const reviewerSession = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  async function as(actor, session) {
    await db.exec("RESET ROLE");
    await query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [actor, JSON.stringify({ sub: actor, session_id: session })]);
    await db.exec("SET ROLE authenticated");
  }
  try {
    await signIn(db);
    await db.exec("RESET ROLE");
    await query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'viewer@example.invalid',now())", [reviewer]);
    await query("INSERT INTO public.admins(user_id,name,access_permissions) VALUES($1,'Reviewer',jsonb_set(app_private.permission_preset('custom'),'{sections,other}','\"view\"'))", [reviewer]);
    await query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [reviewerSession, reviewer]);

    await as(owner, ownerSession);
    const initialMarker = await marker();
    assert.equal((await data()).change_marker, initialMarker);
    const householdValues = { household_name: "Example household", planning_group_id: "general", language: "en" };
    await db.exec("BEGIN");
    await query("SELECT public.admin_save_household(NULL,$1)", [householdValues]);
    assert.equal(await marker(), initialMarker, "marker advances with a commit");
    await db.exec("ROLLBACK");
    assert.equal(await marker(), initialMarker, "failed/aborted operations stay silent");
    assert.equal((await data()).households.length, 0);

    const household = await value("SELECT public.admin_save_household(NULL,$1) value", [householdValues]);
    assert.notEqual(await marker(), initialMarker);
    const staleHousehold = await withRecordRevision(db, "households", household, householdValues);
    await as(reviewer, reviewerSession);
    const restrictedMarker = await marker();
    assert.equal((await data()).change_marker, restrictedMarker);
    assert.deepEqual((await data()).households, []);
    await as(owner, ownerSession);

    const beforeVisit = await marker();
    await db.exec("RESET ROLE");
    await query("UPDATE public.households SET first_visited_at=now(),last_visited_at=now(),visit_count=1 WHERE id=$1", [household]);
    await db.exec("SET ROLE authenticated");
    assert.equal(await marker(), beforeVisit, "a link visit is outside the administrator alert");
    assert.equal((await withRecordRevision(db, "households", household, {})).expected_revision, staleHousehold.expected_revision);
    await query("SELECT public.admin_save_household($1,$2)", [household, { ...staleHousehold, notes: "First editor saves" }]);
    await assert.rejects(query("SELECT public.admin_save_household_with_food($1,$2,NULL,NULL)", [household, staleHousehold]), stale);
    await assert.rejects(query("SELECT public.admin_save_household($1,$2)", [household, householdValues]), stale);
    assert.equal((await data()).households[0].notes, "First editor saves");

    const venueValues = { name: "Example venue", timezone: "UTC" };
    const venue = await value("SELECT public.admin_save_venue(NULL,$1) value", [venueValues]);
    const editVenue = await withRecordRevision(db, "locations", venue, venueValues);
    const sessionValues = { name: "Example session", session_key: "example", location_id: venue };
    const session = await value("SELECT public.admin_save_session(NULL,$1) value", [sessionValues]);
    const editSession = await withRecordRevision(db, "sessions", session, sessionValues);
    await query("SELECT public.admin_save_venue_with_translations($1,$2,$3)",
      [venue, editVenue, { fo: "Dømi um vælkomu" }]);
    await assert.rejects(query("SELECT public.admin_save_venue_with_translations($1,$2,$3)",
      [venue, editVenue, { fo: "Stale translation" }]), stale);
    const directVenue = await withRecordRevision(db, "locations", venue, venueValues);
    await query("SELECT public.admin_save_translation($1,'de','Willkommen am Veranstaltungsort')", ["venue:" + venue + ":welcome"]);
    await assert.rejects(query("SELECT public.admin_save_venue($1,$2)", [venue, directVenue]), stale);
    await query("SELECT public.admin_save_session($1,$2)", [session, { ...editSession, name: "First session edit" }]);
    await assert.rejects(query("SELECT public.admin_save_session($1,$2)", [session, editSession]), stale);

    await query("SELECT public.admin_save_translation('welcome','de','Willkommen zum Fest')");
    await as(reviewer, reviewerSession);
    assert.equal(await marker(), restrictedMarker, "unrelated permissions do not see event-writing activity");
    await assert.rejects(query("SELECT public.admin_save_household($1,$2)", [household, staleHousehold]), /permission/);

    await as(owner, ownerSession);
    const beforeBackup = await marker();
    for (const [sql, args] of [
      ["SELECT public.admin_export_backup() value", []],
      ["SELECT public.admin_export_backup('template',ARRAY['venues','households'],false) value", []],
    ]) {
      const backup = await value(sql, args);
      assert.equal(Object.keys(backup.payload.tables).length, 44);
      for (const table of ["app_private.admin_change_clock", "app_private.admin_change_pending"])
        assert.equal(backup.payload.tables[table], undefined);
      assert.equal(backup.payload.tables["public.households"][0].record_revision, undefined);
      assert.equal(backup.payload.tables["public.event_locations"][0].record_revision, undefined);
    }
    assert.equal(await marker(), beforeBackup, "backup reads do not announce edits");
    await db.exec("RESET ROLE");
    assert.equal(await value("SELECT count(*)::int value FROM app_private.admin_change_pending"), 0);
    assert.equal(await value("SELECT has_table_privilege('authenticated','app_private.admin_change_clock','select') value"), false);
    assert.equal(await value("SELECT has_function_privilege('authenticated','app_private.queue_admin_change(text[])','execute') value"), false);
    await db.exec("SET ROLE anon");
    await assert.rejects(marker, /permission denied/);
    await as(owner, ownerSession);
    await db.exec("RESET ROLE");
    await query("INSERT INTO app_private.admin_session_revocations(session_id,user_id,revoked_by) VALUES($1,$2,$2)", [ownerSession, owner]);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(marker, /session revoked/);
    console.log("PASS committed and permission-scoped admin change markers, rollback, API access, stale household/venue/session saves, translated edits, visit isolation and unchanged backup schema.");
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
