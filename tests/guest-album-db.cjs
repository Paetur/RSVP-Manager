// New preferences, album privacy and current backup contract on disposable data.
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
(async () => {
  const db = await createDatabase();
  const q = (sql, args = []) => db.query(sql, args);
  const value = async (sql, args) => (await q(sql, args)).rows[0].v;
  const picture = {
    image:
      "data:image/jpeg;base64," +
      fs.readFileSync("tests/fixtures/customization.jpg").toString("base64"),
    name: "sample.jpg",
    crop: { x: 0, y: 0, width: 3, height: 2, sourceWidth: 3, sourceHeight: 2 },
  };
  try {
    await signIn(db);
    const settings = async () =>
      (await value("SELECT public.admin_load_data() v")).settings;
    let current = await settings();
    await q(
      "SELECT public.admin_save_invitation_picture(null,'Sample',$1,$2)",
      [picture, current.invitation_album_revision],
    );
    const withPicture = await settings(),
      id = withPicture.invitation_picture_album[0].id;
    assert.deepEqual(withPicture.invitation_picture_album[0].picture, picture);
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_invitation_picture(null,'Stale',$1,$2)", [
          picture,
          current.invitation_album_revision,
        ]),
      /changed/,
    );
    await q(
      "SELECT public.admin_save_invitation_template('de','whatsapp','',$1,$2)",
      ["Reply {rsvp_deadline:+5}: {invitation_link}", picture],
    );
    for (const token of [
      "{unknown}",
      "{rsvp_deadline:+367}",
      "{rsvp_deadline:+1.5}",
      "{rsvp_deadline:5}",
      "{rsvp_deadline",
      "{event_name}}",
    ])
      await assert.rejects(
        () =>
          q(
            "SELECT public.admin_save_invitation_template('en','whatsapp','',$1,null)",
            [token + " {invitation_link}"],
          ),
        /unknown placeholder/,
      );
    await q("SELECT public.admin_save_guest_title_visibility($1,$2)", [
      { de: false, en: true },
      {},
    ]);
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_guest_title_visibility($1,$2)", [
          { de: true },
          {},
        ]),
      /changed/,
    );
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_guest_title_visibility($1,$2)", [
          { de: "false" },
          { de: false, en: true },
        ]),
      /Invalid/,
    );
    await assert.rejects(
      () =>
        q(
          "UPDATE public.event_settings SET guest_title_visibility='{}' WHERE id=1",
        ),
      /editor|permission/,
    );
    await db.exec("RESET ROLE");
    const event = await value("SELECT app_private.guest_event() v");
    assert.equal(
      event.event.invitation_picture_album,
      undefined,
      "guest event must never include the shared album",
    );
    assert.equal(event.event.guest_title_visibility.de, false);
    await db.exec("SET ROLE authenticated");
    const backup = await value("SELECT public.admin_export_backup() v");
    assert.deepEqual(
      backup.payload.tables["public.event_settings"][0]
        .invitation_picture_album,
      withPicture.invitation_picture_album,
    );
    const destination = await createDatabase();
    try {
      await signIn(destination);
      const preview = (
        await destination.query("SELECT public.admin_preview_backup($1) v", [
          backup,
        ])
      ).rows[0].v;
      assert.equal(preview.can_restore, true, preview.reason);
      await destination.query("SELECT public.admin_restore_backup($1,$2)", [
        backup,
        "RESTORE " +
          backup.payload.tables["public.event_settings"][0].event_name,
      ]);
      const restored = (
        await destination.query("SELECT public.admin_load_data() v")
      ).rows[0].v;
      assert.deepEqual(
        restored.settings.invitation_picture_album,
        withPicture.invitation_picture_album,
      );
      assert.equal(restored.settings.guest_title_visibility.de, false);
    } finally {
      await destination.close();
    }
    await q(
      "SELECT public.admin_save_invitation_picture($1,'Sample',null,$2)",
      [id, withPicture.invitation_album_revision],
    );
    assert.equal((await settings()).invitation_picture_album.length, 0);
    assert.deepEqual(
      (await value("SELECT public.admin_load_data() v")).invitationTemplates[0]
        .message_image,
      picture,
      "album removal preserves template snapshot",
    );
    await db.exec(
      "RESET ROLE; UPDATE public.admins SET access_permissions=app_private.permission_preset('view'); SET ROLE authenticated",
    );
    const deniedRevision = (await settings()).invitation_album_revision;
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_invitation_picture(null,'Denied',$1,$2)", [
          picture,
          deniedRevision,
        ]),
      /permission|access/i,
    );
    await assert.rejects(
      () => q("SELECT public.admin_save_guest_title_visibility('{}','{}')"),
      /permission|access/i,
    );
    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(
      () =>
        q("SELECT public.admin_save_invitation_picture(null,'Denied',$1,'')", [
          picture,
        ]),
      /permission denied/,
    );
    assert.equal(await value("SELECT public.get_public_event_v2() v"), null);
    console.log(
      "PASS album/title preferences: JPEG persistence, stale-write guards, strict deadline tokens, private guest projection, backup round-trip, independent snapshots and View/anonymous denials.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
