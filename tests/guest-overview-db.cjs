// Disposable database and fake Realtime provider. No live project configuration.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");

const invites = "rsvp:guest-overview:invites";
const food = "rsvp:guest-overview:food";
const fixture = `
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages(topic text, event text, extension text, payload jsonb, private boolean);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA realtime TO anon,authenticated;
GRANT SELECT,INSERT ON realtime.messages TO anon,authenticated;
CREATE POLICY test_unrelated_read ON realtime.messages FOR SELECT USING (true);
CREATE POLICY test_unrelated_write ON realtime.messages FOR INSERT WITH CHECK (true);
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('realtime.topic',true),'')
$$;
CREATE FUNCTION realtime.send(p_payload jsonb,p_event text,p_topic text,p_private boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF current_setting('test.broadcast_failure',true)='on' THEN RAISE EXCEPTION 'Provider unavailable'; END IF;
 INSERT INTO realtime.messages VALUES(p_topic,p_event,'broadcast',p_payload,p_private);
END $$;
REVOKE ALL ON FUNCTION realtime.send(jsonb,text,text,boolean) FROM PUBLIC;
`;

(async () => {
  const db = await createDatabase({ install: false });
  const query = (sql, args = []) => db.query(sql, args);
  const value = async (sql, args) => (await query(sql, args)).rows[0].value;
  const overview = () => value("SELECT public.admin_guest_overview() value");
  const messageRows = async () => {
    await db.exec("RESET ROLE");
    return (await query("SELECT topic,event,payload,private FROM realtime.messages ORDER BY topic,event")).rows;
  };
  const role = async (name, user = "", session = "", topic = "") => {
    await db.exec("RESET ROLE");
    await query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false),set_config('realtime.topic',$3,false)",
      [user, JSON.stringify({ sub: user, session_id: session }), topic]);
    await db.exec("SET ROLE " + name);
  };
  const owner = "11111111-1111-4111-8111-111111111111";
  const ownerSession = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    await db.exec(fixture);
    const installer = readFileSync("supabase/install.sql", "utf8");
    await db.exec(installer);
    const policySetup = installer.match(/DO \$guest_overview_access\$[\s\S]*?END \$guest_overview_access\$;/)[0];
    const currentPolicy = () => value("SELECT oid value FROM pg_policy WHERE polrelid='realtime.messages'::regclass AND polname='rsvp_guest_overview_read'");
    const existingPolicy = await currentPolicy();
    await db.exec("DROP POLICY rsvp_guest_overview_server_only ON realtime.messages");
    await db.exec(policySetup);
    assert.equal(await currentPolicy(), existingPolicy, "repair keeps existing policies in place");
    assert.equal(await value("SELECT app_private.guest_overview_realtime_available() value"), true);
    const household = await value("INSERT INTO public.households(household_name,planning_group_id,food,notes) VALUES('Example','general',true,'Private notes') RETURNING id value");
    const guest = await value("INSERT INTO public.guests(household_id,first_name,notes) VALUES($1,'Example','Private guest notes') RETURNING id value", [household]);
    const session = await value("INSERT INTO public.event_sessions(session_key,name) VALUES('test','Test session') RETURNING id value");
    await query("INSERT INTO public.household_session_defaults VALUES($1,$2,true)", [household, session]);
    const item = await value("INSERT INTO public.food_items(name_en,quantity_needed) VALUES('Test food',4) RETURNING id value");
    await db.exec("UPDATE public.event_settings SET is_published=true,food_stage='selection' WHERE id=1");
    const code = await value("SELECT invite_code value FROM public.households WHERE id=$1", [household]);

    await signIn(db);
    const marker = await value("SELECT public.admin_change_marker() value");
    const initial = await overview();
    assert.equal(initial.realtime, true);
    assert.deepEqual(initial.topics, [invites, food]);
    assert.equal(initial.households[0].visit_count, 0);
    assert.equal(initial.submissions, 0);
    assert.deepEqual(initial.claims, []);

    await role("service_role");
    await query("SELECT public.get_invitation_logged($1)", [code]);
    assert.deepEqual(await messageRows(), [], "a raw invitation load is silent");

    await role("service_role");
    const visit = await value("SELECT public.issue_household_visit_receipt($1,$2) value", [code, randomUUID()]);
    await db.exec("BEGIN");
    assert.equal(await value("SELECT public.acknowledge_household_visit($1,$2,$3) value", [code, visit.id, visit.sessionId]), true);
    await db.exec("ROLLBACK");
    assert.deepEqual(await messageRows(), [], "aborted guest writes cannot broadcast");
    await role("service_role");
    for (let index = 0; index < 2; index++)
      assert.equal(await value("SELECT public.acknowledge_household_visit($1,$2,$3) value", [code, visit.id, visit.sessionId]), true);
    assert.deepEqual(await messageRows(), [{ topic: invites, event: "changed", payload: {}, private: true }]);

    const request = randomUUID(), answers = [{ guest_id: guest, session_id: session, status: "attending" }];
    await role("service_role");
    const combined = () => value("SELECT public.submit_household_response($1,$2,$3,'Private guest reply',true) value", [code, request, answers]);
    assert.equal((await combined()).rsvp.already_processed, false);
    assert.equal((await combined()).rsvp.already_processed, true);
    assert.deepEqual((await messageRows()).map(row => row.topic), [food, invites, invites]);

    await role("service_role");
    const claim = (quantity, notes = "") => query("SELECT public.set_household_food_claim($1,$2,$3,$4)", [code, item, quantity, notes]);
    await db.exec("BEGIN");
    await claim(1, "Private claim text");
    await claim(2, "Private claim text");
    await db.exec("COMMIT");
    assert.deepEqual((await messageRows()).map(row => row.topic), [food, food, invites, invites],
      "a group of Food changes emits once for Food");
    await role("service_role");
    await claim(2, "Notes only");
    assert.equal((await messageRows()).length, 4, "notes-only claims do not change totals");

    await role("service_role");
    await db.exec("SET test.broadcast_failure='on'");
    await claim(1);
    await db.exec("RESET test.broadcast_failure");
    assert.equal((await messageRows()).length, 4);
    await role("authenticated", owner, ownerSession);
    const counts = await overview();
    assert.equal(counts.households[0].visit_count, 1);
    assert.equal(counts.households[0].food_interest, true);
    assert.equal(counts.households[0].rsvp_state, "locked");
    assert.deepEqual(counts.guests, [{ id: guest, household_id: household, is_child: false, archived_at: null }]);
    assert.equal(counts.submissions, 1);
    assert.deepEqual(counts.responses, [{ guest_id: guest, session_id: session, rsvp_status: "attending" }]);
    assert.deepEqual(counts.claims, [{ household_id: household, food_item_id: item, quantity: 1 }], "a provider outage preserves the guest write");
    assert.doesNotMatch(JSON.stringify(counts), /Private|invite_code|first_name|message/);
    assert.equal(await value("SELECT public.admin_change_marker() value"), marker, "guest signals stay separate from admin edits");
    await assert.rejects(query("INSERT INTO realtime.messages VALUES($1,'fake','broadcast','{}',true)", [invites]), /row-level security/);

    await db.exec("RESET ROLE");
    const reviewer = randomUUID(), reviewerSession = randomUUID();
    await query("INSERT INTO auth.users (id,email,email_confirmed_at) VALUES($1,'reviewer@example.invalid',now())", [reviewer]);
    await query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [reviewerSession, reviewer]);
    await query("INSERT INTO public.admins(user_id,name,access_permissions) VALUES($1,'Reviewer',jsonb_set(app_private.permission_preset('custom'),'{sections,food}','\"view\"'))", [reviewer]);
    await role("authenticated", reviewer, reviewerSession, food);
    const foodOnly = await overview();
    assert.deepEqual(foodOnly.topics, [food]);
    assert.deepEqual(foodOnly.households, [{ id: household, food_interest: true }]);
    assert.deepEqual(foodOnly.responses, []);
    assert.equal(foodOnly.submissions, 0);
    assert.equal((await query("SELECT topic FROM realtime.messages WHERE topic=$1", [food])).rowCount, 2);
    assert.equal((await query("SELECT topic FROM realtime.messages WHERE topic=$1", [invites])).rowCount, 0);
    await role("authenticated", reviewer, reviewerSession, invites);
    assert.equal((await query("SELECT topic FROM realtime.messages WHERE topic=$1", [invites])).rowCount, 0);

    await role("anon", "", "", invites);
    assert.equal((await query("SELECT topic FROM realtime.messages")).rowCount, 0);
    await assert.rejects(overview, /permission denied/);
    await role("authenticated");
    await assert.rejects(overview, { code: "PT401" });
    await db.exec("RESET ROLE; DROP FUNCTION realtime.send(jsonb,text,text,boolean)");
    await role("authenticated", owner, ownerSession);
    const fallback = await overview();
    assert.equal(fallback.realtime, false);
    assert.deepEqual(fallback.topics, [invites, food], "an unavailable provider leaves the polling projection available");
    await role("service_role");
    await assert.rejects(overview, /permission denied/);
    await db.exec("RESET ROLE");
    await query("DELETE FROM auth.sessions WHERE id=$1", [reviewerSession]);
    await role("authenticated", reviewer, reviewerSession, food);
    assert.equal((await query("SELECT topic FROM realtime.messages")).rowCount, 0, "revoked sessions cannot join");
    await assert.rejects(overview, { code: "PT401" });

    console.log("PASS guest Overview: private permission-scoped notifications, visit and RSVP replay, grouped food writes, rollback, provider failure, and projection privacy.");
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
