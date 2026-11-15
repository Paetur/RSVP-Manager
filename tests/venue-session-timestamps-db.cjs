// Current schema only, with synthetic records in a disposable database.
const assert = require("node:assert/strict");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
(async () => {
  const db = await createDatabase();
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
  try {
    await signIn(db);
    const venueValues = { name: "Timestamp venue", timezone: "UTC" };
    const venue = await value("SELECT public.admin_save_venue(NULL,$1) v", [venueValues]);
    const record = (table, id) => value(`SELECT to_jsonb(t) v FROM public.${table} t WHERE id=$1`, [id]);
    const first = await record("event_locations", venue);
    assert.ok(first.created_at && first.updated_at);
    await db.query("SELECT public.admin_save_venue($1,$2)", [venue, venueValues]);
    const unchanged = await record("event_locations", venue);
    assert.equal(unchanged.created_at, first.created_at);
    assert.equal(unchanged.updated_at, first.updated_at, "no-op save is not an edit");
    await db.query("SELECT public.admin_save_venue($1,$2)", [venue, { ...venueValues, address: "Example road" }]);
    const edited = await record("event_locations", venue);
    assert.equal(edited.created_at, first.created_at);
    assert.ok(edited.updated_at > first.updated_at);
    await db.query("SELECT public.admin_save_translation($1,'de','Zeitstempelort')", ["venue:" + venue + ":name"]);
    const translated = await record("event_locations", venue);
    assert.ok(translated.updated_at > edited.updated_at, "translated edits touch their parent record");
    await db.query("SELECT public.admin_save_translation($1,'de','Zeitstempelort')", ["venue:" + venue + ":name"]);
    assert.equal((await record("event_locations", venue)).updated_at, translated.updated_at);
    const sessionValues = { name: "Timestamp session", session_key: "timestamp-session", location_id: venue };
    const session = await value("SELECT public.admin_save_session(NULL,$1) v", [sessionValues]);
    const originalSession = await record("event_sessions", session);
    assert.ok(originalSession.created_at && originalSession.updated_at);
    await db.query("SELECT public.admin_save_session($1,$2)", [session, { ...sessionValues, name: "Updated session" }]);
    const editedSession = await record("event_sessions", session);
    assert.equal(editedSession.created_at, originalSession.created_at);
    assert.ok(editedSession.updated_at > originalSession.updated_at);
    await db.query("SELECT public.admin_save_translation($1,'fo','Ein frágreiðing')", ["session:" + session + ":description"]);
    assert.ok((await record("event_sessions", session)).updated_at > editedSession.updated_at);
    // Deleting a translation is also an edit of the represented session.
    await db.exec("RESET ROLE");
    const beforeDelete = await record("event_sessions", session);
    await db.query("DELETE FROM public.session_translations WHERE session_id=$1 AND language_code='fo'", [session]);
    assert.ok((await record("event_sessions", session)).updated_at > beforeDelete.updated_at);
    // The current backup contract retains all four fields without an adapter.
    const backup = await value("SELECT app_private.backup_payload() v").catch(async () => {
      await db.exec("RESET ROLE");
      return value("SELECT app_private.backup_payload() v");
    });
    assert.ok(backup.tables["public.event_locations"].find(x => x.id === venue).created_at);
    assert.ok(backup.tables["public.event_sessions"].find(x => x.id === session).updated_at);
    await db.exec("RESET ROLE");
    await db.query("UPDATE public.event_locations SET created_at='2000-01-01',updated_at='2000-01-01' WHERE id=$1", [venue]);
    const guarded = await record("event_locations", venue);
    assert.equal(guarded.created_at, first.created_at, "creation date cannot be rewritten by an edit");
    assert.equal(guarded.updated_at, translated.updated_at, "date-only spoofing is ignored");
    assert.equal(await value("SELECT has_function_privilege('authenticated','app_private.stamp_translated_event_record()','execute') v"), false);
    await db.exec("SET ROLE anon");
    await assert.rejects(db.query("SELECT public.admin_save_session($1,$2)", [session, sessionValues]), /permission|administrator/i);
    console.log("PASS server creation/edit timestamps, immutable creation dates, no-op saves, venue/session translations, backup fields and permission denial.");
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
