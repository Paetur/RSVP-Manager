const assert = require("node:assert/strict");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
(async () => {
  const db = await createDatabase(),
    q = (sql, args = []) => db.query(sql, args);
  const value = async (sql, args) => (await q(sql, args)).rows[0].v;
  try {
    await signIn(db);
    await db.exec("RESET ROLE");
    const sid = await value(
      "INSERT INTO public.event_sessions(session_key,name) VALUES('sample','Sample session') RETURNING id v",
    );
    await db.exec("SET ROLE authenticated");
    const initial = {
      household_name: "Synthetic household",
      planning_group_id: "general",
      language: "en",
    };
    const id = await value("SELECT public.admin_save_household(null,$1) v", [
      initial,
    ]);
    const snapshot = async () => {
      await db.exec("RESET ROLE");
      const result = await value(
        "SELECT app_private.household_session_snapshot($1) v",
        [id],
      );
      await db.exec("SET ROLE authenticated");
      return result;
    };
    await assert.rejects(() => q("SELECT app_private.household_session_snapshot($1)", [id]), /permission denied/);
    const old = await snapshot();
    await q("SELECT public.admin_save_household($1,$2)", [
      id,
      {
        ...initial,
        household_name: "Changed together",
        session_assignments_expected: old,
        session_assignments: [
          { session_id: sid, guest_id: null, is_invited: true },
        ],
      },
    ]);
    const state = await value("SELECT public.admin_load_data() v");
    assert.equal(
      state.households.find((h) => h.id === id).household_name,
      "Changed together",
    );
    assert.equal(
      state.defaults.find((d) => d.household_id === id).is_invited,
      true,
    );
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_household($1,$2)", [
          id,
          {
            ...initial,
            household_name: "Must roll back",
            session_assignments_expected: old,
            session_assignments: [],
          },
        ]),
      /changed; refresh/,
    );
    assert.equal(
      (await value("SELECT public.admin_load_data() v")).households.find(
        (h) => h.id === id,
      ).household_name,
      "Changed together",
    );
    await q("SELECT public.admin_create_guest($1,$2)", [
      id,
      { first_name: "Example" },
    ]);
    const guestId = (
      await value("SELECT public.admin_load_data() v")
    ).guests.find((g) => g.household_id === id).id;
    for (const invited of [true, null]) {
      const expected = await snapshot();
      await q("SELECT public.admin_save_household($1,$2)", [
        id,
        {
          ...initial,
          household_name: "Changed together",
          session_assignments_expected: expected,
          session_assignments: [
            { session_id: sid, guest_id: guestId, is_invited: invited },
          ],
        },
      ]);
      const saved = (
        await value("SELECT public.admin_load_data() v")
      ).overrides.find((o) => o.guest_id === guestId);
      assert.equal(saved?.is_invited, invited === null ? undefined : true);
    }
    const current = await snapshot();
    const beforeFood = (
      await value("SELECT public.admin_load_data() v")
    ).households.find((h) => h.id === id).food;
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_household_with_food($1,$2,$3,$4)", [
          id,
          {
            ...initial,
            session_assignments_expected: current,
            session_assignments: [
              { session_id: sid, guest_id: null, is_invited: false },
            ],
          },
          !beforeFood,
          !beforeFood,
        ]),
      /changed/i,
    );
    assert.equal(
      (await value("SELECT public.admin_load_data() v")).defaults.find(
        (d) => d.household_id === id,
      ).is_invited,
      true,
      "later food failure rolls back session changes too",
    );
    await db.exec("RESET ROLE");
    await q("UPDATE public.households SET rsvp_state='locked' WHERE id=$1", [
      id,
    ]);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_household($1,$2)", [
          id,
          {
            ...initial,
            session_assignments_expected: current,
            session_assignments: [
              { session_id: sid, guest_id: null, is_invited: false },
            ],
          },
        ]),
      /RSVP history/,
    );
    assert.equal(
      (await value("SELECT public.admin_load_data() v")).households.find(
        (h) => h.id === id,
      ).household_name,
      "Changed together",
    );
    await q("SELECT public.admin_save_household($1,$2)", [
      id,
      { ...initial, household_name: "Details still editable" },
    ]);
    await db.exec("RESET ROLE");
    await q("UPDATE public.households SET rsvp_state='open' WHERE id=$1", [id]);
    await db.exec(
      "UPDATE public.admins SET access_permissions=jsonb_set(jsonb_set(app_private.permission_preset('full'),'{preset}','\"custom\"'),'{sections,invites}','\"view\"'); SET ROLE authenticated",
    );
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_household($1,$2)", [
          id,
          {
            ...initial,
            session_assignments_expected: current,
            session_assignments: [
              { session_id: sid, guest_id: null, is_invited: false },
            ],
          },
        ]),
      /permission|access/i,
    );
    assert.equal(
      (await value("SELECT public.admin_load_data() v")).households.find(
        (h) => h.id === id,
      ).household_name,
      "Details still editable",
    );
    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(
      () => q("SELECT public.admin_save_household($1,$2)", [id, initial]),
      /permission denied/,
    );
    console.log(
      "PASS atomic household/session save: defaults, stale-snapshot rollback, RSVP-history rollback, ordinary locked-household edits and Invites/anonymous permission gates.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
