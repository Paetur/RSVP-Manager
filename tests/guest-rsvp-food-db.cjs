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
    await login();
    await db.query(
      "SELECT public.admin_reopen_household_rsvp($1,'Organizer approved correction')",
      [hh[0]],
    );
    await logout();
    const next = await v(
      "SELECT public.submit_household_rsvp($1,gen_random_uuid(),$2,$3) v",
      [codes[0], answers, "New comment"],
    );
    assert.notEqual(next.submission_id, saved.submission_id);
    assert.equal(
      await v("SELECT comment v FROM public.rsvp_submissions WHERE id=$1", [
        saved.submission_id,
      ]),
      "No nuts\n<private>",
    );
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
      "SELECT app_private.backup_as_template($1,ARRAY['food']) v",
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
    console.log(
      "PASS new guest SQL: scoped immutable/reviewed comments, idempotent retry/reopen, comment limits and permissions, quantity capacity, nested/sibling order, parent deletion/cycle/depth/stale guards, retained commitments and backup/template/full restore.",
    );
  } finally {
    await db.close();
    await dst.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
