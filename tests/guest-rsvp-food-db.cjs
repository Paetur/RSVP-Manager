// New guest comments, quantities and category trees on disposable databases only.
const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const admin = "11111111-1111-4111-8111-111111111111",
  session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function setup() {
  const db = new PGlite();
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;`,
  );
  await db.exec(fs.readFileSync("supabase/install.sql", "utf8"));
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
  return db;
}
(async () => {
  const db = await setup(),
    dst = await setup();
  try {
    const v = async (q, args = []) => (await db.query(q, args)).rows[0].v;
    const login = async () => {
      await db.query(
        "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [admin, JSON.stringify({ sub: admin, session_id: session })],
      );
      await db.exec("SET ROLE authenticated");
    };
    const logout = async () => {
      await db.exec("RESET ROLE");
      await db.query(
        "SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)",
      );
    };
    const hh = [];
    for (const name of ["One", "Two"]) {
      const id = await v(
        "INSERT INTO public.households(household_name,planning_group_id,language,food) VALUES($1,'general','en',true) RETURNING id v",
        [name],
      );
      await db.query(
        "INSERT INTO public.guests(household_id,first_name) VALUES($1,'Guest')",
        [id],
      );
      hh.push(id);
    }
    const sid = await v(
      "INSERT INTO public.event_sessions(session_key,name) VALUES('party','Party') RETURNING id v",
    );
    for (const id of hh)
      await db.query(
        "INSERT INTO public.household_session_defaults VALUES($1,$2,true)",
        [id, sid],
      );
    const codes = [];
    for (const id of hh)
      codes.push(
        await v("SELECT invite_code v FROM public.households WHERE id=$1", [
          id,
        ]),
      );
    const guest = await v(
        "SELECT id v FROM public.guests WHERE household_id=$1",
        [hh[0]],
      ),
      answers = [{ guest_id: guest, session_id: sid, status: "attending" }],
      request = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await assert.rejects(
      () =>
        db.query("SELECT public.submit_household_rsvp($1,$2,$3,$4)", [
          codes[0],
          request,
          answers,
          "No nuts",
        ]),
      /not published/,
    );
    await db.exec(
      "UPDATE public.event_settings SET is_published=true,food_stage='selection' WHERE id=1",
    );
    codes.length = 0;
    for (const id of hh)
      codes.push(
        await v("SELECT invite_code v FROM public.households WHERE id=$1", [
          id,
        ]),
      );
    await assert.rejects(
      () =>
        db.query("SELECT public.submit_household_rsvp($1,$2,$3,$4)", [
          codes[0],
          request,
          answers,
          "x".repeat(2001),
        ]),
      /2000/,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.submit_household_rsvp($1,$2,$3,$4)", [
          codes[1],
          request,
          answers,
          "Forged household",
        ]),
      /unauthorized|Incomplete/,
    );
    const saved = await v(
      "SELECT public.submit_household_rsvp($1,$2,$3,$4) v",
      [codes[0], request, answers, "  No nuts\n<private>  "],
    );
    assert.equal(saved.already_processed, false);
    assert.equal(
      await v("SELECT comment v FROM public.rsvp_submissions WHERE id=$1", [
        saved.submission_id,
      ]),
      "No nuts\n<private>",
    );
    assert.equal(
      (await v("SELECT public.get_invitation_v2($1) v", [codes[0]])).household
        .rsvp_comment,
      "No nuts\n<private>",
    );
    assert.equal(
      (await v("SELECT public.get_invitation_v2($1) v", [codes[1]])).household
        .rsvp_comment,
      null,
      "Comment stays scoped to its household",
    );
    assert.equal(
      (
        await v("SELECT public.submit_household_rsvp($1,$2,$3,$4) v", [
          codes[0],
          request,
          answers,
          "No nuts\n<private>",
        ])
      ).already_processed,
      true,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.submit_household_rsvp($1,$2,$3,$4)", [
          codes[0],
          request,
          answers,
          "Changed",
        ]),
      /different answers/,
    );
    await assert.rejects(
      () =>
        db.query(
          "UPDATE public.rsvp_submissions SET comment='Changed' WHERE id=$1",
          [saved.submission_id],
        ),
      /immutable|history|cannot|append/i,
    );
    for (const signature of [
      "public.admin_reopen_household_rsvp(uuid,text)",
      "public.admin_lock_household_rsvp(uuid,uuid,text)",
      "public.admin_correct_food_interest(uuid,boolean,boolean,text)",
    ]) {
      assert.equal(await v("SELECT to_regprocedure($1) v", [signature]), null);
    }
    await db.exec("SET ROLE service_role");
    await assert.rejects(() => v(
      "SELECT public.submit_household_rsvp($1,gen_random_uuid(),$2,$3) v",
      [codes[0], answers, "New comment"],
    ), /RSVP is locked/i);
    await db.exec("RESET ROLE");
    assert.equal(await v("SELECT comment v FROM public.rsvp_submissions WHERE id=$1", [saved.submission_id]),
      "No nuts\n<private>");
    await login();
    const cat = async (name, parent = null) =>
      v("SELECT public.admin_save_food_category(NULL,$1,$2,NULL,NULL) v", [
        name,
        parent,
      ]);
    const root = await cat("Meal"),
      child = await cat("Desserts", root),
      leaf = await cat("Cakes", child),
      sibling = await cat("Fruit", child);
    await assert.rejects(
      () =>
        db.query(
          "SELECT public.admin_save_food_category($1,'Meal',$2,'Meal',NULL)",
          [root, leaf],
        ),
      /hierarchy|cycles/,
    );
    assert.equal(
      await v("SELECT parent_id v FROM public.food_categories WHERE id=$1", [
        root,
      ]),
      null,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_delete_food_category($1,$2)", [
          child,
          "Desserts",
        ]),
      /sub-categories/,
    );
    await assert.rejects(
      () =>
        db.query(
          "SELECT public.admin_save_food_category($1,'Changed',NULL,'Stale',$2)",
          [leaf, child],
        ),
      /changed/,
    );
    await db.query("SELECT public.admin_move_food_category($1,-1)", [sibling]);
    assert(
      (await v("SELECT sort_order v FROM public.food_categories WHERE id=$1", [
        sibling,
      ])) <
        (await v(
          "SELECT sort_order v FROM public.food_categories WHERE id=$1",
          [leaf],
        )),
    );
    await logout();
    await assert.rejects(
      () =>
        db.query("UPDATE public.food_categories SET parent_id=$1 WHERE id=$1", [
          root,
        ]),
      /self_parent/,
    );
    await assert.rejects(
      () =>
        db.query("UPDATE public.food_categories SET parent_id=$1 WHERE id=$2", [
          leaf,
          root,
        ]),
      /hierarchy/,
    );
    let parent = leaf;
    for (let n = 4; n <= 8; n++)
      parent = await v(
        "INSERT INTO public.food_categories(name,parent_id) VALUES($1,$2) RETURNING id v",
        ["Depth " + n, parent],
      );
    await assert.rejects(
      () =>
        db.query(
          "INSERT INTO public.food_categories(name,parent_id) VALUES('Too deep',$1)",
          [parent],
        ),
      /8 levels/,
    );
    const food = await v(
      "INSERT INTO public.food_items(name_en,description_en,quantity_needed,category) VALUES('Nut-free cake','Bring in a labelled container',6,'Cakes') RETURNING id v",
    );
    await db.query("SELECT public.set_household_food_claim($1,$2,3,NULL)", [
      codes[0],
      food,
    ]);
    await db.query("SELECT public.set_household_food_claim($1,$2,2,NULL)", [
      codes[1],
      food,
    ]);
    await assert.rejects(
      () =>
        db.query("SELECT public.set_household_food_claim($1,$2,5,NULL)", [
          codes[0],
          food,
        ]),
      /Insufficient/,
    );
    let payload = await v("SELECT public.get_household_food($1) v", [codes[0]]);
    assert.equal(
      payload.claims.find((c) => c.food_item_id === food).quantity,
      3,
    );
    assert.equal(
      payload.items.find((i) => i.id === food).description_en,
      "Bring in a labelled container",
    );
    assert.equal(
      payload.categories.find((c) => c.id === leaf).parent_id,
      child,
    );
    await login();
    await db.query(
      "SELECT public.admin_save_food_category($1,'Cakes',NULL,'Cakes',$2)",
      [leaf, child],
    );
    assert.equal(
      await v("SELECT category v FROM public.food_items WHERE id=$1", [food]),
      "Cakes",
    );
    assert.equal(
      await v(
        "SELECT quantity v FROM public.food_claims WHERE household_id=$1 AND food_item_id=$2",
        [hh[0], food],
      ),
      3,
    );
    await db.query(
      "SELECT public.admin_save_food_category($1,'Cakes',$2,'Cakes',NULL)",
      [leaf, child],
    );
    const backup = await v("SELECT public.admin_export_backup() v");
    assert.equal(backup.payload.schema_version, "20261114034908");
    assert.equal(
      backup.payload.tables["public.rsvp_submissions"].find(
        (s) => s.id === saved.submission_id,
      ).comment,
      "No nuts\n<private>",
    );
    await db.exec("RESET ROLE");
    const template = await v(
      "SELECT app_private.project_backup($1,'template',ARRAY['food'],false) v",
      [backup],
    );
    assert.equal(
      template.payload.tables["public.food_categories"].find(
        (c) => c.id === leaf,
      ).parent_id,
      child,
    );
    assert.equal(template.payload.tables["public.rsvp_submissions"].length, 0);
    const corrupt = structuredClone(backup);
    corrupt.payload.tables["public.food_categories"].find(
      (c) => c.id === root,
    ).parent_id = leaf;
    corrupt.checksum = await v(
      "SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') v",
      [corrupt.payload],
    );
    await assert.rejects(
      () => db.query("SELECT app_private.validate_backup($1)", [corrupt]),
      /hierarchy/,
    );
    await dst.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [admin, JSON.stringify({ sub: admin, session_id: session })],
    );
    await dst.exec("SET ROLE authenticated");
    await dst.query("SELECT public.admin_restore_backup($1,$2)", [
      backup,
      "RESTORE " + backup.payload.tables["public.event_settings"][0].event_name,
    ]);
    await dst.exec("RESET ROLE");
    assert.equal(
      (
        await dst.query(
          "SELECT comment FROM public.rsvp_submissions WHERE id=$1",
          [saved.submission_id],
        )
      ).rows[0].comment,
      "No nuts\n<private>",
    );
    assert.equal(
      (
        await dst.query(
          "SELECT parent_id FROM public.food_categories WHERE id=$1",
          [leaf],
        )
      ).rows[0].parent_id,
      child,
    );
    assert.equal(
      (await dst.query("SELECT is_published FROM public.event_settings"))
        .rows[0].is_published,
      false,
    );
    await logout();
    await db.exec("SET ROLE anon");
    await assert.rejects(
      () =>
        db.query("SELECT public.submit_household_rsvp($1,$2,$3,NULL)", [
          codes[0],
          request,
          answers,
        ]),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query(
          "SELECT public.admin_save_food_category(NULL,'Forged',NULL,NULL,NULL)",
        ),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
    const jointHousehold = await v(
      "INSERT INTO public.households(household_name,planning_group_id,language,food) VALUES('Joint response','general','en',false) RETURNING id v",
    );
    const jointGuest = await v(
      "INSERT INTO public.guests(household_id,first_name) VALUES($1,'Joint guest') RETURNING id v",
      [jointHousehold],
    );
    await db.query("INSERT INTO public.household_session_defaults VALUES($1,$2,true)", [jointHousehold, sid]);
    const jointCode = await v("SELECT invite_code v FROM public.households WHERE id=$1", [jointHousehold]);
    const jointAnswers = [{ guest_id: jointGuest, session_id: sid, status: "declined" }];
    const jointRequest = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const submitJoint = (interest = false, responses = jointAnswers) => v(
      "SELECT public.submit_household_response($1,$2,$3,$4,$5) v",
      [jointCode, jointRequest, responses, "Shared review", interest],
    );
    const availability = async () => (await v("SELECT public.get_invitation_v2($1) v", [jointCode])).household.can_submit_rsvp;
    const jointRows = () => v(`SELECT jsonb_build_object(
      'state',h.rsvp_state,'food',h.food_interest,
      'submissions',(SELECT count(*) FROM public.rsvp_submissions s WHERE s.household_id=h.id),
      'audit',(SELECT count(*) FROM public.rsvp_household_audit a WHERE a.household_id=h.id)
    ) v FROM public.households h WHERE h.id=$1`, [jointHousehold]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec("SET ROLE " + role);
      await assert.rejects(() => submitJoint(), /permission denied/);
      await db.exec("RESET ROLE");
    }
    await db.exec("SET ROLE service_role");
    assert.equal(await v("SELECT public.guest_gateway_allow_request($1,$2,'submit_household_response') v", ["a".repeat(64), jointCode]), true);
    await assert.rejects(() => submitJoint(), /Food answer unavailable/);
    await db.exec("RESET ROLE");
    assert.deepEqual(await jointRows(), { state: "open", food: null, submissions: 0, audit: 0 });

    await db.exec("UPDATE public.event_settings SET food_stage='interest',rsvp_deadline=now()-interval '1 day' WHERE id=1");
    assert.equal(await availability(), false);
    await assert.rejects(() => submitJoint(), /RSVP deadline passed/);
    await login();
    await db.query("SELECT public.admin_authorize_late_rsvp($1,now()+interval '1 day',NULL)", [jointHousehold]);
    await logout();
    assert.equal(await availability(), true);
    await assert.rejects(() => submitJoint(false, answers), /Incomplete or unauthorized/);
    assert.deepEqual(await jointRows(), { state: "open", food: null, submissions: 0, audit: 1 });
    await db.exec("SET ROLE service_role");
    const joint = await submitJoint();
    assert.equal(joint.rsvp.already_processed, false);
    assert.equal(joint.food.interest, false);
    const replay = await submitJoint();
    assert.equal(replay.rsvp.already_processed, true);
    assert.equal(replay.rsvp.submission_id, joint.rsvp.submission_id);
    await assert.rejects(() => submitJoint(true), /different answers/);
    await db.exec("RESET ROLE");
    assert.equal(await availability(), false);
    assert.deepEqual(await jointRows(), { state: "locked", food: false, submissions: 1, audit: 2 });

    const editRsvp = (household, state, expected, changes, note = null) => db.query(
      "SELECT public.admin_edit_household_rsvp($1,$2,$3,$4,$5)",
      [household, state, expected, changes, note],
    );
    const correctFood = (household, submissionId, interest, expected, note) =>
      editRsvp(household, "locked", submissionId, { food: { interest, expected_interest: expected } }, note);
    const amendFood = (code, interest, expected) =>
      v("SELECT public.set_household_food_interest($1,$2,$3) v", [code, interest, expected]);
    const guestFood = code => v("SELECT public.get_household_food($1) v", [code]);
    const jointLatest = joint.rsvp.submission_id;
    const originalSubmission = () => v(
      "SELECT to_jsonb(s) v FROM public.rsvp_submissions s WHERE id=$1",
      [jointLatest],
    );
    const attendanceRows = () => v(
      "SELECT jsonb_agg(to_jsonb(r) ORDER BY r.session_id) v FROM public.guest_session_responses r WHERE guest_id=$1",
      [jointGuest],
    );
    const savedSubmission = await originalSubmission();
    const savedAttendance = await attendanceRows();

    await db.exec("SET ROLE service_role");
    assert.equal((await guestFood(jointCode)).interest, false);
    await assert.rejects(() => amendFood(jointCode, true, false), /already confirmed/i);
    assert.equal((await amendFood(jointCode, false, false)).interest, false);
    await db.exec("RESET ROLE");
    await login();
    await assert.rejects(() => correctFood(jointHousehold, jointLatest, true, false, "x".repeat(2001)), /2000/i);
    await assert.rejects(() => db.query("SELECT public.admin_authorize_late_rsvp($1,now()+interval '1 day',NULL)", [
      jointHousehold,
    ]), /RSVP is locked/i);
    await correctFood(jointHousehold, jointLatest, true, false, "  Guest changed their answer  ");
    await assert.rejects(() => correctFood(jointHousehold, jointLatest, false, false), /changed|stale|refresh/i);
    await logout();

    assert.deepEqual(await jointRows(), { state: "locked", food: true, submissions: 1, audit: 2 });
    assert.deepEqual(await attendanceRows(), savedAttendance);
    assert.deepEqual(await originalSubmission(), savedSubmission);
    assert.deepEqual(await v(`SELECT jsonb_build_object(
      'actor',actor_user_id,'old',before_value->'food_interest','new',after_value->'food_interest',
      'reason',after_value->>'reason'
    ) v FROM public.management_audit WHERE entity_type='food_interest' AND action='update' AND household_id=$1`,
    [jointHousehold]), { actor: admin, old: false, new: true, reason: "Guest changed their answer" });
    await db.exec("SET ROLE service_role");
    assert.equal((await guestFood(jointCode)).interest, true);
    await assert.rejects(() => amendFood(jointCode, false, true), /already confirmed/i);
    await assert.rejects(() => submitJoint(), /different answers/);
    await db.exec("RESET ROLE");
    await login();
    await correctFood(jointHousehold, jointLatest, false, true);
    await logout();
    assert.equal((await jointRows()).food, false);
    assert.deepEqual(await originalSubmission(), savedSubmission);

    const commitments = () => v(
      "SELECT jsonb_agg(to_jsonb(c) ORDER BY c.food_item_id) v FROM public.food_claims c WHERE c.household_id=$1",
      [hh[0]],
    );
    const previousCommitments = await commitments();
    assert.equal(previousCommitments[0].quantity, 3);
    await login();
    await db.query("SELECT public.admin_set_food_stage('selection','interest')");
    await assert.rejects(() => correctFood(hh[0], saved.submission_id, false, true), /commitment|food choices/i);
    await logout();
    await db.exec("SET ROLE service_role");
    assert.equal((await guestFood(codes[0])).interest, true);
    await assert.rejects(() => amendFood(codes[0], false, true), /already confirmed/i);
    await db.query("SELECT public.confirm_household_food($1,$2)", [
      codes[0], [{ food_item_id: food, quantity: 3 }],
    ]);
    await db.exec("RESET ROLE");
    assert.deepEqual(await commitments(), previousCommitments);

    const foodConfirmation = () => v(
      "SELECT jsonb_build_object('interest',food_interest,'confirmed',food_confirmed,'confirmed_at',food_confirmed_at) v FROM public.households WHERE id=$1",
      [hh[0]],
    );
    const beforeRemoval = await foodConfirmation();
    assert.equal(beforeRemoval.confirmed, true);
    assert.ok(beforeRemoval.confirmed_at);
    await login();
    await assert.rejects(() => correctFood(hh[0], saved.submission_id, false, true), /commitment|food choices/i);
    await db.query("SELECT public.admin_set_food_selection($1,$2,0,3)", [hh[0], food]);
    await logout();
    assert.equal(await commitments(), null, "Only the separate assignment removal deletes the claim");
    await login();
    await correctFood(hh[0], saved.submission_id, false, true, "Guest cancelled after removing the assignment");
    await logout();
    assert.deepEqual(await foodConfirmation(), { interest: false, confirmed: false, confirmed_at: null });
    assert.equal(await commitments(), null);

    const additional = "33333333-3333-4333-8333-333333333333";
    const addition = { id: additional, first_name: "Forgotten", last_name: "Child", is_child: true };
    const reply = (guestId, status, expectedStatus) => ({
      guest_id: guestId, session_id: sid, status, expected_status: expectedStatus,
    });
    const directEdit = {
      responses: [reply(jointGuest, "attending", "declined"), reply(additional, "declined", null)],
      guests: [addition],
      food: { interest: true, expected_interest: false },
    };
    const jointGuestLink = () => v("SELECT public.get_invitation_v2($1) v", [jointCode]);
    const jointGuestCount = () => v("SELECT count(*)::int v FROM public.guests WHERE household_id=$1", [jointHousehold]);
    const beforeLockedEditAttendance = await attendanceRows();
    await login();
    await assert.rejects(() => editRsvp(jointHousehold, "open", jointLatest, directEdit), /changed|stale|refresh/i);
    await assert.rejects(() => editRsvp(jointHousehold, "locked", jointLatest, {
      ...directEdit, responses: [directEdit.responses[0]],
    }), /Answer each required RSVP/i);
    await logout();
    assert.equal(await jointGuestCount(), 1, "A failed locked RSVP edit rolls back the guest addition");
    assert.equal((await jointRows()).food, false, "A failed locked RSVP edit rolls back the food correction");
    assert.deepEqual(await attendanceRows(), beforeLockedEditAttendance);
    const originalLockedEditRows = await jointRows();
    await login();
    await editRsvp(jointHousehold, "locked", jointLatest, directEdit, "  Household confirmed by phone  ");
    await assert.rejects(() => editRsvp(jointHousehold, "locked", jointLatest, {
      responses: [reply(jointGuest, "declined", "declined")],
    }), /changed|stale|refresh/i);
    await logout();
    assert.equal(await jointGuestCount(), 2);
    assert.deepEqual(await jointRows(), { ...originalLockedEditRows, food: true });
    const editedLink = await jointGuestLink();
    assert.equal(editedLink.household.rsvp_state, "locked");
    assert.equal(editedLink.household.rsvp_comment, "Shared review", "The admin note stays private");
    assert.equal(editedLink.guests.find((g) => g.id === additional)?.is_child, true);
    assert.equal(editedLink.invitations.find((r) => r.guest_id === jointGuest).response, "attending");
    assert.equal(editedLink.invitations.find((r) => r.guest_id === additional).response, "declined");
    assert.equal(await v(
      "SELECT reason v FROM public.rsvp_response_audit WHERE guest_id=$1 AND action='admin_correction' AND actor_user_id=$2",
      [jointGuest, admin],
    ), "Household confirmed by phone");

    // A backup can describe a household that was left open by an older organizer workflow.
    await db.query("UPDATE public.households SET rsvp_state='open',late_submission_until=now()+interval '1 day' WHERE id=$1", [jointHousehold]);
    const legacyLink = await jointGuestLink();
    assert.equal(legacyLink.household.rsvp_state, "locked");
    assert.equal(legacyLink.household.can_submit_rsvp, false);
    assert.equal(legacyLink.household.can_add_guests, false);
    await db.exec("SET ROLE service_role");
    await assert.rejects(() => db.query("SELECT public.submit_household_rsvp($1,gen_random_uuid(),$2,NULL)", [
      jointCode, jointAnswers,
    ]), /RSVP is locked/i);
    assert.equal((await v("SELECT public.submit_household_rsvp($1,$2,$3,$4) v", [
      jointCode, jointRequest, jointAnswers, "Shared review",
    ])).already_processed, true, "A lost first response can still be retried after an admin correction");
    await assert.rejects(() => db.query("SELECT public.add_household_guest($1,gen_random_uuid(),'Unexpected','Guest',false)", [jointCode]),
      /cannot be added after an RSVP submission/i);
    await db.exec("RESET ROLE");
    const legacyAdditional = { ...addition, id: "66666666-6666-4666-8666-666666666666" };
    await login();
    await assert.rejects(() => db.query("SELECT public.admin_authorize_late_rsvp($1,now()+interval '1 day',NULL)", [jointHousehold]),
      /RSVP is locked/i);
    await assert.rejects(() => db.query("SELECT public.admin_create_guest($1,$2)", [jointHousehold, { first_name: "Pending" }]),
      /without submitted RSVPs/i);
    await assert.rejects(() => editRsvp(jointHousehold, "open", jointLatest, { guests: [legacyAdditional] }),
      /Answer each required RSVP/i);
    await editRsvp(jointHousehold, "open", jointLatest, {
      guests: [legacyAdditional], responses: [reply(legacyAdditional.id, "attending", null)],
    });
    await logout();
    assert.equal((await jointGuestLink()).household.rsvp_state, "locked");
    assert.equal((await jointGuestLink()).household.can_submit_rsvp, false);
    assert.equal((await jointRows()).submissions, 1);
    assert.deepEqual(await originalSubmission(), savedSubmission);
    await db.query("UPDATE public.households SET rsvp_state='locked',late_submission_until=NULL WHERE id=$1", [jointHousehold]);

    await db.exec("SET ROLE anon");
    await assert.rejects(() => correctFood(hh[0], saved.submission_id, false, true), /permission denied/);
    await assert.rejects(() => editRsvp(jointHousehold, "locked", jointLatest, directEdit), /permission denied/);
    await db.exec("RESET ROLE");
    await db.query(
      "INSERT INTO auth.users VALUES('22222222-2222-4222-8222-222222222222','other@example.invalid',now(),'unused')",
    );
    await db.exec(
      "INSERT INTO public.admins(user_id,name) VALUES('22222222-2222-4222-8222-222222222222','Other Full admin')",
    );
    const permissions = await v(
      "SELECT access_permissions v FROM public.admins WHERE user_id=$1",
      [admin],
    );
    permissions.preset = "view";
    for (const k in permissions.sections) permissions.sections[k] = "view";
    for (const k of [
      "sendInvites",
      "exportBackup",
      "restoreBackup",
      "revokeSessions",
    ])
      permissions[k] = false;
    await db.query(
      "UPDATE public.admins SET access_permissions=$1 WHERE user_id=$2",
      [permissions, admin],
    );
    await login();
    await assert.rejects(
      () =>
        db.query(
          "SELECT public.admin_save_food_category(NULL,'Forbidden',NULL,NULL,NULL)",
        ),
      /permission|access/i,
    );
    await assert.rejects(() => correctFood(hh[0], saved.submission_id, false, true), /permission|access/i);
    await assert.rejects(() => editRsvp(jointHousehold, "locked", jointLatest, directEdit), /permission|access/i);
    await logout();
    permissions.preset = "custom";
    permissions.sections.invites = "edit";
    await db.query("UPDATE public.admins SET access_permissions=$1 WHERE user_id=$2", [permissions, admin]);
    await login();
    await assert.rejects(() => editRsvp(jointHousehold, "locked", jointLatest, {
      food: { interest: false, expected_interest: true },
    }), /permission|access/i);
    await assert.rejects(() => editRsvp(jointHousehold, "locked", jointLatest, { guests: [addition] }), /permission|access/i);
    console.log(
      "PASS RSVP and food SQL: immutable comments, first-response retries and late allowance, admin-only corrections, legacy state handling, audit notes, permissions, food commitments and backup/template/full restore.",
    );
  } finally {
    await db.close();
    await dst.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
