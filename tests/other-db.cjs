// Synthetic current-schema authorization checks. No live project connections.
const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;`,
    );
    await db.exec(fs.readFileSync("supabase/install.sql", "utf8"));
    await db.exec(
      "INSERT INTO public.other_categories(name) VALUES('Equipment')",
    );
    const original = (
      await db.query(
        "INSERT INTO public.other_items(item,category_id,created_at,updated_at) VALUES('Chairs',(SELECT id FROM public.other_categories WHERE name='Equipment'),'2026-03-01','2026-04-01') RETURNING *",
      )
    ).rows[0];
    const admin = "11111111-1111-4111-8111-111111111111",
      session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.query(
      "INSERT INTO auth.users VALUES($1,'admin@example.invalid',now(),'unused')",
      [admin],
    );
    await db.query(
      "INSERT INTO public.admins(user_id,name) VALUES($1,'Example')",
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
    const value = async (q, p = []) => (await db.query(q, p)).rows[0].v;
    const cat = await value(
      "SELECT public.admin_save_other_category(null,'Equipment',null) v",
    );
    assert.equal(
      (
        await value(
          "SELECT public.admin_save_other_category(null,'Equipment',null) v",
        )
      ).id,
      cat.id,
      "category retry is idempotent",
    );
    const payload = {
      item: "Updated chairs",
      notes: "Comment",
      assigned_to: "Helper",
      status: "done",
      category_id: cat.id,
      sort_order: 1,
    };
    const saved = await value("SELECT public.admin_save_other($1,$2,$3) v", [
      original.id,
      payload,
      original.updated_at,
    ]);
    assert.equal(
      new Date(saved.created_at).toISOString(),
      original.created_at.toISOString(),
    );
    assert.equal(saved.category_id, cat.id);
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_save_other($1,$2,$3)", [
          original.id,
          payload,
          original.updated_at,
        ]),
      /Item changed/,
    );
    const newId = "44444444-4444-4444-8444-444444444444";
    await value("SELECT public.admin_save_other($1,$2,null) v", [
      newId,
      payload,
    ]);
    await value("SELECT public.admin_save_other($1,$2,null) v", [
      newId,
      payload,
    ]);
    assert.equal(
      await value(
        "SELECT count(*)::integer v FROM public.other_items WHERE id=$1",
        [newId],
      ),
      1,
      "new item retries do not duplicate",
    );
    await assert.rejects(
      () =>
        db.query(
          "INSERT INTO public.other_items(item,category_id) VALUES('Bypass',$1)",
          [cat.id],
        ),
      /permission denied/,
    );
    const backup = await value("SELECT public.admin_export_backup() v");
    assert.ok(backup.payload.tables["public.other_items"]);
    assert.ok(backup.payload.tables["public.other_categories"]);
    assert.equal(backup.payload.tables["public.things_to_do"], undefined);
    assert.equal(
      backup.payload.tables["public.legacy_stuff_to_bring"],
      undefined,
    );
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
    await db.exec("SET ROLE authenticated");
    assert.equal(
      (await db.query("SELECT * FROM public.other_items")).rows.length,
      0,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_save_other($1,$2,null)", [
          newId,
          payload,
        ]),
      /Sign in|Administrator/,
    );
    await db.exec("RESET ROLE;SET ROLE anon");
    await assert.rejects(
      () => db.query("SELECT * FROM public.other_items"),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
    const beforeCategoryChanges = (
      await db.query("SELECT * FROM public.other_items ORDER BY id")
    ).rows;
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [admin, JSON.stringify({ sub: admin, session_id: session })],
    );
    await db.exec("SET ROLE authenticated");
    const empty = await value(
      "SELECT public.admin_save_other_category(null,'Empty category',null) v",
    );
    const beforeOrder = (
      await db.query(
        "SELECT id FROM public.other_categories ORDER BY sort_order,lower(name),id",
      )
    ).rows.map((row) => row.id);
    const ordered = await value(
      "SELECT public.admin_move_other_category($1,-1) v",
      [empty.id],
    );
    const moved = ordered.find((row) => row.id === empty.id);
    assert.equal(
      ordered.findIndex((row) => row.id === empty.id),
      beforeOrder.indexOf(empty.id) - 1,
      "category moves up",
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_move_other_category($1,2)", [empty.id]),
      /Direction/,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_delete_other_category($1,$2)", [
          empty.id,
          empty.updated_at,
        ]),
      /Category changed/,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_delete_other_category($1,$2)", [
          cat.id,
          ordered.find((row) => row.id === cat.id).updated_at,
        ]),
      /Move items/,
    );
    await db.query("SELECT public.admin_delete_other_category($1,$2)", [
      empty.id,
      moved.updated_at,
    ]);
    await db.query("SELECT public.admin_delete_other_category($1,$2)", [
      empty.id,
      moved.updated_at,
    ]);
    assert.equal(
      await value(
        "SELECT count(*)::integer v FROM public.other_categories WHERE id=$1",
        [empty.id],
      ),
      0,
    );
    assert.deepEqual(
      (await db.query("SELECT * FROM public.other_items ORDER BY id")).rows,
      beforeCategoryChanges,
      "category controls preserve all item data",
    );
    await db.exec("RESET ROLE");
    const firstVenue = await value(
      "INSERT INTO public.event_locations(name,sort_order) VALUES('First venue',10) RETURNING id v",
    );
    const secondVenue = await value(
      "INSERT INTO public.event_locations(name,sort_order) VALUES('Second venue',11) RETURNING id v",
    );
    const venueData = (
      await db.query(
        "SELECT to_jsonb(v)-'sort_order' AS v FROM public.event_locations v ORDER BY id",
      )
    ).rows;
    await db.exec("SET ROLE authenticated");
    await db.query("SELECT public.admin_move_venue($1,-1)", [secondVenue]);
    const venueIds = (
      await db.query(
        "SELECT id FROM public.event_locations ORDER BY sort_order,lower(name),id",
      )
    ).rows.map((row) => row.id);
    assert.equal(
      venueIds.indexOf(secondVenue) + 1,
      venueIds.indexOf(firstVenue),
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT to_jsonb(v)-'sort_order' AS v FROM public.event_locations v ORDER BY id",
        )
      ).rows,
      venueData,
      "ordering preserves all venue details",
    );
    await assert.rejects(
      () => db.query("SELECT public.admin_move_venue($1,0)", [secondVenue]),
      /Direction/,
    );
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      () => db.query("SELECT public.admin_move_other_category($1,1)", [cat.id]),
      /Sign in|Administrator/,
    );
    await assert.rejects(
      () => db.query("SELECT public.admin_move_venue($1,1)", [firstVenue]),
      /Sign in|Administrator/,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_delete_other_category($1,$2)", [
          cat.id,
          cat.updated_at,
        ]),
      /Sign in|Administrator/,
    );
    await db.exec("RESET ROLE;SET ROLE anon");
    await assert.rejects(
      () => db.query("SELECT public.admin_move_other_category($1,1)", [cat.id]),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("SELECT public.admin_move_venue($1,1)", [firstVenue]),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_delete_other_category($1,$2)", [
          cat.id,
          cat.updated_at,
        ]),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
    console.log(
      "PASS Other: current item/category CRUD, metadata preservation, row conflicts, retry safety, backups and authorization.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
