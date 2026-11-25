// Opt-in real PostgreSQL concurrency checks. Requires a fresh, explicitly disposable database.
// The runner refuses an ordinary application database before creating any schema or fixtures.
const { Client } = require("pg"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const database = "rsvp_guest_feedback_disposable";
const admin = "11111111-1111-4111-8111-111111111111",
  session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function waitBlocked(db, pid) {
  for (let n = 0; n < 100; n++) {
    const r = await db.query("SELECT cardinality(pg_blocking_pids($1)) n", [
      pid,
    ]);
    if (r.rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("Expected concurrent request to wait for the transaction lock");
}
(async () => {
  if (
    process.env.RSVP_GROUP_TEST_DISPOSABLE !== "yes" ||
    !process.env.RSVP_GROUP_TEST_DATABASE_URL
  )
    throw Error(
      "Set RSVP_GROUP_TEST_DISPOSABLE=yes and RSVP_GROUP_TEST_DATABASE_URL for a fresh throwaway database",
    );
  const options = {
      connectionString: process.env.RSVP_GROUP_TEST_DATABASE_URL,
      connectionTimeoutMillis: 5000,
    },
    db = new Client(options),
    left = new Client(options),
    right = new Client(options);
  await db.connect();
  let leftConnected = false,
    rightConnected = false;
  try {
    assert.equal(
      (await db.query("SELECT current_database() n")).rows[0].n,
      database,
      "Refusing a database without the explicit disposable name",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::integer n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','v','m','S','p')",
        )
      ).rows[0].n,
      0,
      "Disposable database must be empty",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::integer n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')",
        )
      ).rows[0].n,
      0,
      "Requires an isolated cluster without application roles",
    );
    await db.query(
      `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;`,
    );
    await db.query(fs.readFileSync("supabase/install.sql", "utf8"));
    await db.query(
      "UPDATE public.event_settings SET food_stage='selection' WHERE id=1",
    );
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
    const value = async (q, args = []) => (await db.query(q, args)).rows[0].v;
    const households = [];
    for (const name of ["First", "Second", "Companions"]) {
      const h = await value(
        "INSERT INTO public.households(household_name,language,planning_group_id,food) VALUES($1,'en','general',true) RETURNING id v",
        [name],
      );
      await db.query(
        "INSERT INTO public.guests(household_id,first_name) VALUES($1,'Existing')",
        [h],
      );
      households.push(h);
    }
    const items = [];
    for (const name of ["Chips", "Nuts"])
      items.push(
        await value(
          "INSERT INTO public.food_items(name_en,quantity_needed) VALUES($1,1) RETURNING id v",
          [name],
        ),
      );
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [admin, JSON.stringify({ sub: admin, session_id: session })],
    );
    const group = await value(
      "SELECT public.admin_save_food_group(NULL,'Chips & nuts','{}',NULL,$1::uuid[]) v",
      [items],
    );
    await db.query(
      "SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)",
    );
    await db.query(
      "UPDATE public.event_settings SET is_published=true WHERE id=1",
    );
    const codes = [];
    for (const h of households)
      codes.push(
        await value("SELECT invite_code v FROM public.households WHERE id=$1", [
          h,
        ]),
      );
    await left.connect();
    leftConnected = true;
    await right.connect();
    rightConnected = true;
    for (const client of [left, right])
      await client.query(
        "SET statement_timeout='8s';SET lock_timeout='5s';SET ROLE service_role",
      );
    const competing = await Promise.allSettled([
      left.query("SELECT public.set_household_food_group($1,$2,1)", [
        codes[0],
        group,
      ]),
      right.query("SELECT public.set_household_food_group($1,$2,1)", [
        codes[1],
        group,
      ]),
    ]);
    assert.equal(
      competing.filter((r) => r.status === "fulfilled").length,
      1,
      "Exactly one household wins the last complete group",
    );
    assert.match(
      competing.find((r) => r.status === "rejected").reason.message,
      /Insufficient remaining quantity/,
    );
    const claims = (
      await db.query(
        "SELECT household_id,food_item_id,quantity FROM public.food_claims ORDER BY food_item_id",
      )
    ).rows;
    assert.equal(claims.length, 2);
    assert.equal(new Set(claims.map((c) => c.household_id)).size, 1);
    assert.ok(claims.every((c) => c.quantity === 1));
    const winner = households.indexOf(claims[0].household_id);
    await left.query("SELECT public.set_household_food_group($1,$2,0)", [
      codes[winner],
      group,
    ]);
    // A regroup request arriving while a reservation is uncommitted must wait, then reject.
    await left.query("BEGIN");
    await left.query("SELECT public.set_household_food_group($1,$2,1)", [
      codes[0],
      group,
    ]);
    await right.query("RESET ROLE");
    await right.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [admin, JSON.stringify({ sub: admin, session_id: session })],
    );
    await right.query("SET ROLE authenticated");
    const stamp = await value(
        "SELECT updated_at::text v FROM public.food_groups WHERE id=$1",
        [group],
      ),
      pid = (await right.query("SELECT pg_backend_pid() n")).rows[0].n;
    const regroup = right
      .query(
        "SELECT public.admin_save_food_group($1,'Changed','{}',NULL,$2::uuid[],$3)",
        [group, items, stamp],
      )
      .then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
    try {
      await waitBlocked(db, pid);
    } finally {
      await left.query("COMMIT");
    }
    assert.match(
      (await regroup).error?.message || "",
      /Resolve existing commitments/,
    );
    assert.equal(
      await value("SELECT name v FROM public.food_groups WHERE id=$1", [group]),
      "Chips & nuts",
    );
    // Closing the menu waits for an in-flight reservation and preserves its commitments.
    await left.query("BEGIN");
    await left.query("SELECT public.set_household_food_group($1,$2,1)", [
      codes[0],
      group,
    ]);
    const closeMenu = right
      .query("SELECT public.admin_set_food_stage('interest','selection')")
      .then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
    try {
      await waitBlocked(db, pid);
    } finally {
      await left.query("COMMIT");
    }
    assert.equal((await closeMenu).ok, true);
    assert.equal(
      (await db.query("SELECT public.get_household_food($1) v", [codes[0]]))
        .rows[0].v.items.length,
      0,
    );
    assert.equal(
      await value("SELECT count(*)::integer v FROM public.food_claims"),
      2,
    );
    await right.query(
      "SELECT public.admin_set_food_stage('selection','interest')",
    );
    // The same companion UUID submitted on separate connections remains a single person.
    await right.query("RESET ROLE");
    await right.query(
      "SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)",
    );
    await right.query("SET ROLE service_role");
    const guest = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const retries = await Promise.all([
      left.query(
        "SELECT public.add_household_guest($1,$2,'New','Person',false)",
        [codes[2], guest],
      ),
      right.query(
        "SELECT public.add_household_guest($1,$2,'New','Person',false)",
        [codes[2], guest],
      ),
    ]);
    assert.equal(retries.length, 2);
    assert.equal(
      await value("SELECT count(*)::integer v FROM public.guests WHERE id=$1", [
        guest,
      ]),
      1,
    );
    // Two different additions at the household limit cannot both pass the count check.
    await db.query(
      "INSERT INTO public.guests(household_id,first_name) SELECT $1,'Synthetic '||n FROM generate_series(1,17) n",
      [households[2]],
    );
    assert.equal(
      await value(
        "SELECT count(*)::integer v FROM public.guests WHERE household_id=$1",
        [households[2]],
      ),
      19,
    );
    const additions = await Promise.allSettled([
      left.query(
        "SELECT public.add_household_guest($1,gen_random_uuid(),'Last','A',false)",
        [codes[2]],
      ),
      right.query(
        "SELECT public.add_household_guest($1,gen_random_uuid(),'Last','B',false)",
        [codes[2]],
      ),
    ]);
    assert.equal(additions.filter((r) => r.status === "fulfilled").length, 1);
    assert.match(
      additions.find((r) => r.status === "rejected").reason.message,
      /Contact the organizer/,
    );
    assert.equal(
      await value(
        "SELECT count(*)::integer v FROM public.guests WHERE household_id=$1",
        [households[2]],
      ),
      20,
    );
    // A reservation holding a food row must finish while an archive waits for it.
    // Acquiring the global management lock from inside save_food_selection inverted this order.
    const archiveItem = await value(
      "INSERT INTO public.food_items(name_en,quantity_needed) VALUES('Archive race',3) RETURNING id v",
    );
    const archiveStamp = await value(
      "SELECT updated_at::text v FROM public.food_items WHERE id=$1",
      [archiveItem],
    );
    await right.query("RESET ROLE");
    await right.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [admin, JSON.stringify({ sub: admin, session_id: session })],
    );
    await right.query("SET ROLE authenticated");
    await left.query("BEGIN");
    await left.query("RESET ROLE");
    await left.query("SELECT 1 FROM public.food_items WHERE id=$1 FOR UPDATE", [
      archiveItem,
    ]);
    await left.query("SET LOCAL ROLE service_role");
    const archive = right
      .query(
        "SELECT public.admin_item_lifecycle('food_items',$1,'archive',$2)",
        [archiveItem, archiveStamp],
      )
      .then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
    try {
      await waitBlocked(db, pid);
      await left.query("SELECT public.set_household_food_claim($1,$2,1,null)", [
        codes[0],
        archiveItem,
      ]);
    } finally {
      await left.query("COMMIT");
    }
    assert.equal((await archive).ok, true);
    assert.equal(
      await value(
        "SELECT quantity v FROM public.food_claims WHERE food_item_id=$1",
        [archiveItem],
      ),
      1,
    );
    assert.equal(
      await value(
        "SELECT archived_at IS NOT NULL v FROM public.food_items WHERE id=$1",
        [archiveItem],
      ),
      true,
    );
    // Two concurrent parent moves must not create a cycle after either commits.
    const treeA = await value(
        "INSERT INTO public.food_categories(name) VALUES('Tree A') RETURNING id v",
      ),
      treeB = await value(
        "INSERT INTO public.food_categories(name) VALUES('Tree B') RETURNING id v",
      );
    for (const client of [left, right]) {
      await client.query("RESET ROLE");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [admin, JSON.stringify({ sub: admin, session_id: session })],
      );
      await client.query("SET ROLE authenticated");
    }
    await left.query("BEGIN");
    await left.query(
      "SELECT public.admin_save_food_category($1,'Tree A',$2,'Tree A',NULL)",
      [treeA, treeB],
    );
    const cycle = right
      .query(
        "SELECT public.admin_save_food_category($1,'Tree B',$2,'Tree B',NULL)",
        [treeB, treeA],
      )
      .then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
    try {
      await waitBlocked(db, pid);
    } finally {
      await left.query("COMMIT");
    }
    assert.match((await cycle).error?.message || "", /hierarchy|cycles/);
    assert.equal(
      await value(
        "SELECT parent_id v FROM public.food_categories WHERE id=$1",
        [treeB],
      ),
      null,
    );
    // Multi-unit requests still compete against the same item capacity atomically.
    const quantityItem = await value(
      "INSERT INTO public.food_items(name_en,quantity_needed) VALUES('Quantity race',5) RETURNING id v",
    );
    for (const client of [left, right]) {
      await client.query("RESET ROLE");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)",
      );
      await client.query("SET ROLE service_role");
    }
    const quantityRace = await Promise.allSettled([
      left.query("SELECT public.set_household_food_claim($1,$2,3,NULL)", [
        codes[0],
        quantityItem,
      ]),
      right.query("SELECT public.set_household_food_claim($1,$2,3,NULL)", [
        codes[1],
        quantityItem,
      ]),
    ]);
    assert.equal(
      quantityRace.filter((r) => r.status === "fulfilled").length,
      1,
    );
    assert.match(
      quantityRace.find((r) => r.status === "rejected").reason.message,
      /Insufficient/,
    );
    assert.equal(
      await value(
        "SELECT sum(quantity)::integer v FROM public.food_claims WHERE food_item_id=$1",
        [quantityItem],
      ),
      3,
    );
    const responseHousehold = await value(
      "INSERT INTO public.households(household_name,language,planning_group_id,food) VALUES('Joint response','en','general',true) RETURNING id v",
    );
    const responseGuest = await value(
      "INSERT INTO public.guests(household_id,first_name) VALUES($1,'Guest') RETURNING id v",
      [responseHousehold],
    );
    const responseSession = await value(
      "INSERT INTO public.event_sessions(session_key,name) VALUES('shared_response','Shared response') RETURNING id v",
    );
    await db.query("INSERT INTO public.household_session_defaults VALUES($1,$2,true)", [responseHousehold, responseSession]);
    const responseCode = await value("SELECT invite_code v FROM public.households WHERE id=$1", [responseHousehold]);
    const submit = (client) => client.query("SELECT public.submit_household_response($1,$2,$3,NULL,false) v", [
      responseCode,
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      JSON.stringify([{ guest_id: responseGuest, session_id: responseSession, status: "attending" }]),
    ]);
    await left.query("BEGIN");
    const firstResponse = (await submit(left)).rows[0].v;
    const duplicateResponse = submit(right);
    try {
      await waitBlocked(db,pid);
    } finally {
      await left.query("COMMIT");
    }
    const retryResponse = (await duplicateResponse).rows[0].v;
    assert.equal(firstResponse.rsvp.already_processed,false);
    assert.equal(retryResponse.rsvp.already_processed,true);
    assert.equal(retryResponse.rsvp.submission_id,firstResponse.rsvp.submission_id);
    assert.equal(retryResponse.food.interest,false);
    assert.equal(await value("SELECT count(*)::integer v FROM public.rsvp_submissions WHERE household_id=$1", [responseHousehold]),1);
    console.log(
      "PASS real PostgreSQL: competing food capacity and rollback, food stage/reservation/archive locks, companion retries and limits, category cycle prevention, and exactly one combined response under concurrent retry",
    );
  } finally {
    if (leftConnected) {
      await left.query("ROLLBACK").catch(() => {});
      await left.end();
    }
    if (rightConnected) await right.end();
    await db.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
