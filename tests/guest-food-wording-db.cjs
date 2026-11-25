const assert = require("node:assert/strict");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
(async () => {
  const db = await createDatabase();
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
  try {
    await signIn(db);
    const snapshot = async () =>
      (await value("SELECT public.admin_load_data() v")).guestFoodReplies;
    assert.deepEqual(await snapshot(), []);
    await db.query("SELECT public.admin_save_food_explanation($1,$2)", [
      { en: "Existing explanation", de: "Erklärung" },
      {},
    ]);
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_save_food_explanation($1,$2)", [
          { en: "Overwrite" },
          {},
        ]),
      /changed/,
    );
    assert.equal(
      await value(
        "SELECT food_introduction->>'de' v FROM public.event_settings",
      ),
      "Erklärung",
    );
    await db.query("SELECT public.admin_save_food_interest_reply($1,$2,$3)", [
      {
        en: "Please return around {rsvp_deadline:+5}",
        de: "Bitte am {rsvp_deadline:+5} wiederkommen",
      },
      { en: "Please check again later." },
      [],
    ]);
    const saved = await snapshot();
    assert.equal(saved.length, 3);
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_save_food_interest_reply($1,$2,$3)", [
          { en: "Lost update" },
          {},
          [],
        ]),
      /changed/,
    );
    for (const [replies, fallbacks] of [
      [{ en: "{unknown}" }, {}],
      [{ en: "{rsvp_deadline:+367}" }, {}],
      [{ en: "{rsvp_deadline:5}" }, {}],
      [{ en: "x".repeat(6001) }, {}],
      [{ xx: "Unknown language" }, {}],
      [{}, { en: "{rsvp_deadline}" }],
    ]) {
      await assert.rejects(
        () =>
          db.query("SELECT public.admin_save_food_interest_reply($1,$2,$3)", [
            replies,
            fallbacks,
            saved,
          ]),
        /Invalid/,
      );
      assert.deepEqual(await snapshot(), saved, "Invalid saves are atomic");
    }
    await db.exec("RESET ROLE");
    const payload = await value("SELECT app_private.guest_event() v");
    await db.exec("SET ROLE authenticated");
    assert.equal(
      payload.event.food_interest_reply.en,
      "Please return around {rsvp_deadline:+5}",
    );
    assert.equal(
      payload.event.food_interest_reply_fallback.en,
      "Please check again later.",
    );
    assert.equal(
      await value("SELECT is_published v FROM public.event_settings"),
      false,
    );
    const backup = await value("SELECT public.admin_export_backup() v");
    assert.equal(
      backup.payload.tables["public.message_templates"].filter((r) =>
        r.template_key.startsWith("food-interest-reply"),
      ).length,
      3,
    );
    await db.exec("RESET ROLE");
    await db.query("SELECT app_private.validate_backup($1)", [backup]);
    await db.exec("SET ROLE authenticated");
    const partial = await value(
      "SELECT public.admin_export_backup('template',ARRAY['wording'],false) v",
    );
    assert.equal(
      partial.payload.tables["public.message_templates"].filter((r) =>
        r.template_key.startsWith("food-interest-reply"),
      ).length,
      3,
    );
    await db.exec("RESET ROLE");
    await db.query("SELECT app_private.validate_backup($1)", [partial]);
    await db.exec("SET ROLE authenticated");
    await db.exec("RESET ROLE");
    await db.exec(
      "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('22222222-2222-4222-8222-222222222222','second@example.invalid',now());INSERT INTO public.admins(user_id,name) VALUES('22222222-2222-4222-8222-222222222222','Second')",
    );
    const permissions = await value(
      "SELECT app_private.permission_preset('view') v",
    );
    permissions.preset = "custom";
    for (const key in permissions.sections) permissions.sections[key] = "none";
    permissions.sections.languages = "edit";
    await db.query(
      "UPDATE public.admins SET access_permissions=$1 WHERE user_id='11111111-1111-4111-8111-111111111111'",
      [permissions],
    );
    await db.exec("SET ROLE authenticated");
    const loaded = await value("SELECT public.admin_load_data() v");
    assert.equal(loaded.settings.food_introduction.en, "Existing explanation");
    assert.equal(loaded.guestFoodReplies.length, 3);
    await db.query("SELECT public.admin_save_food_explanation($1,$2)", [
      { en: "Language editor" },
      loaded.settings.food_introduction,
    ]);
    await db.query("SELECT public.admin_save_food_interest_reply($1,$2,$3)", [
      { en: "Edited" },
      {},
      saved,
    ]);
    assert.equal(
      await value(
        "SELECT has_function_privilege('anon','public.admin_save_food_interest_reply(jsonb,jsonb,jsonb)','execute') v",
      ),
      false,
    );
    await db.exec("RESET ROLE");
    permissions.sections.languages = "view";
    await db.query(
      "UPDATE public.admins SET access_permissions=$1 WHERE user_id='11111111-1111-4111-8111-111111111111'",
      [permissions],
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_save_food_interest_reply($1,$2,$3)", [
          {},
          {},
          saved,
        ]),
      /permission/i,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.admin_save_food_explanation($1,$2)", [
          {},
          { en: "Language editor" },
        ]),
      /permission/i,
    );
    await db.exec("RESET ROLE");
    await db.exec(
      "INSERT INTO public.households(id,household_name,food_interest,planning_group_id) SELECT '33333333-3333-4333-8333-333333333333','Reporting household',true,planning_config->'groups'->0->>'id' FROM public.event_settings",
    );
    for (const foodAccess of ["none", "view"]) {
      permissions.sections.languages = "none";
      permissions.sections.invites = "view";
      permissions.sections.food = foodAccess;
      await db.query(
        "UPDATE public.admins SET access_permissions=$1 WHERE user_id='11111111-1111-4111-8111-111111111111'",
        [permissions],
      );
      await db.exec("SET ROLE authenticated");
      const report = await value("SELECT public.admin_load_data() v");
      const h = report.households.find(
        (h) => h.id === "33333333-3333-4333-8333-333333333333",
      );
      assert.equal(
        Object.hasOwn(h, "food_interest"),
        foodAccess === "view",
        "Invites reporting requires independent Food access",
      );
      assert.equal(
        report.guestFoodReplies.length,
        0,
        "Authored guest templates require Languages access",
      );
      await db.exec("RESET ROLE");
    }
    console.log(
      "PASS guest food wording DB: preserved explanations, stale/invalid saves, language-only editor permissions, restricted read/write, guest payload, unchanged publication and Full/Partial backup inclusion.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
