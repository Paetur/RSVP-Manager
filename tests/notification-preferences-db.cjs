// Isolated schema and synthetic identities; never connects to a live database.
const { PGlite } = require("@electric-sql/pglite"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const db = new PGlite(),
    q = (sql, a = []) => db.query(sql, a),
    v = async (sql, a = []) => (await q(sql, a)).rows[0].v;
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;",
    );
    await db.exec(fs.readFileSync("supabase/install.sql", "utf8"));
    const id = "11111111-1111-4111-8111-111111111111",
      session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await q(
      "INSERT INTO auth.users VALUES($1,'admin@example.invalid',now(),'unused')",
      [id],
    );
    await q("INSERT INTO public.admins(user_id,name) VALUES($1,'Example')", [
      id,
    ]);
    await q("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
      session,
      id,
    ]);
    await q(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [id, JSON.stringify({ sub: id, session_id: session })],
    );
    assert.equal(
      await v(
        "SELECT notification_preferences v FROM public.event_settings WHERE id=1",
      ),
      null,
    );
    const prefs = {
      admin: {
        preset: "errors",
        types: ["error"],
        autoDismiss: false,
        showTimestamp: false,
      },
      guest: {
        preset: "custom",
        types: ["warning", "error"],
        autoDismiss: true,
        showTimestamp: true,
      },
    };
    for (const scope of ["admin", "guest"]) {
      for (const autoDismiss of [null, "true", 5]) {
        assert.equal(
          await v("SELECT app_private.valid_notification_preferences($1) v", [
            { ...prefs, [scope]: { ...prefs[scope], autoDismiss } },
          ]),
          false,
        );
      }
      for (const autoDismiss of [true, false]) {
        assert.equal(
          await v("SELECT app_private.valid_notification_preferences($1) v", [
            { ...prefs, [scope]: { ...prefs[scope], autoDismiss } },
          ]),
          true,
        );
      }
    }
    for (const scope of ["admin", "guest"]) {
      for (const showTimestamp of [null, "true", 5])
        assert.equal(
          await v("SELECT app_private.valid_notification_preferences($1) v", [
            { ...prefs, [scope]: { ...prefs[scope], showTimestamp } },
          ]),
          false,
        );
      for (const showTimestamp of [true, false])
        assert.equal(
          await v("SELECT app_private.valid_notification_preferences($1) v", [
            { ...prefs, [scope]: { ...prefs[scope], showTimestamp } },
          ]),
          true,
        );
    }
    assert.equal(
      await v("SELECT app_private.valid_notification_preferences($1) v", [
        {
          admin: { preset: "all", types: [] },
          guest: { preset: "errors", types: ["error"] },
        },
      ]),
      true,
      "Legacy scopes without optional flags remain valid",
    );
    assert.equal(
      await v("SELECT app_private.translation_keys()->>'Show timestamps' v"),
      "interface.messages.status_messages_show_timestamp",
    );
    assert.equal(
      await v("SELECT app_private.valid_notification_preferences($1) v", [
        { admin: prefs.admin, guest: { preset: "all", types: [] } },
      ]),
      true,
    );
    assert.equal(
      await v(
        "SELECT app_private.translation_keys()->>'Hide messages after 5 seconds' v",
      ),
      "interface.messages.status_messages_auto_dismiss",
    );
    assert.equal(
      await v(
        "SELECT app_private.translation_keys()?'Hide guest messages after 5 seconds' v",
      ),
      false,
    );
    await db.exec("SET ROLE authenticated");
    await q("SELECT public.admin_save_notification_preferences($1,null)", [
      prefs,
    ]);
    assert.deepEqual(
      (await v("SELECT public.admin_load_data() v")).settings
        .notification_preferences,
      prefs,
    );
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_notification_preferences($1,null)", [
          prefs,
        ]),
      /changed/,
    );
    for (const bad of [
      { ...prefs, extra: true },
      { ...prefs, guest: { preset: "unknown", types: [] } },
      { ...prefs, guest: { preset: "custom", types: ["error", "error"] } },
      { ...prefs, guest: { preset: "custom", types: ["bad"] } },
      { ...prefs, guest: { preset: "custom", types: null } },
      { ...prefs, guest: { preset: "custom", types: [], extra: true } },
      {},
    ])
      await assert.rejects(
        () =>
          q("SELECT public.admin_save_notification_preferences($1,$2)", [
            bad,
            prefs,
          ]),
        /Invalid/,
      );
    await assert.rejects(
      () =>
        q(
          "UPDATE public.event_settings SET notification_preferences=null WHERE id=1",
        ),
      /editor|permission denied/,
    );
    const preview = await v("SELECT public.admin_guest_preview(null,true) v");
    assert.deepEqual(preview.eventData.event.notification_preferences, {
      guest: prefs.guest,
    });
    assert.equal(
      (await v("SELECT public.admin_load_data() v")).settings.is_published,
      false,
    );
    await db.exec("RESET ROLE");
    const payload = await v("SELECT app_private.backup_payload() v");
    assert.equal(payload.schema_version, "20261114034908");
    assert.deepEqual(
      payload.tables["public.event_settings"][0].notification_preferences,
      prefs,
    );
    const envelope = { format: "rsvp-application-backup", version: 3, payload };
    envelope.checksum = await v(
      "SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') v",
      [payload],
    );
    await q("SELECT app_private.validate_backup($1)", [envelope]);
    await q(
      "UPDATE public.admins SET access_permissions=jsonb_set(jsonb_set(app_private.permission_preset('view'),'{preset}',to_jsonb('custom'::text)),'{sections,settings}',to_jsonb('none'::text)) WHERE user_id=$1",
      [id],
    );
    await db.exec("SET ROLE authenticated");
    assert.deepEqual(
      (await v("SELECT public.admin_load_data() v")).settings
        .notification_preferences,
      { admin: prefs.admin },
    );
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_notification_preferences(null,$1)", [
          prefs,
        ]),
      /permissions/,
    );
    await db.exec(
      "RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);SET ROLE anon",
    );
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_notification_preferences($1,null)", [
          prefs,
        ]),
      /permission denied/,
    );
    assert.equal(await v("SELECT public.get_public_event_v2() v"), null);
    await assert.rejects(
      () => q("SELECT notification_preferences FROM public.event_settings"),
      /permission denied/,
    );
    console.log(
      "PASS notification preferences SQL: validation, Settings/edit permission, stale-save and direct-write guards, private guest-only/admin-only projections, backup contract and unpublished/anonymous boundaries.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
