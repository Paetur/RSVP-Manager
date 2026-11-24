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
    await require("./helpers/named-template.cjs").saveTemplate(db, { language: "de", body: "Reply {rsvp_deadline:+5}: {invitation_link}", image: picture });
    await db.exec("RESET ROLE");
    const sharedPicture = await value(
      "SELECT message_image->>'picture_ref' v FROM public.message_templates WHERE language_code='de' AND template_key LIKE 'invitation:%'",
    );
    assert.match(sharedPicture, /^[0-9a-f]{64}$/);
    // The scoped existing-installation update uses the same album compaction.
    await q("UPDATE public.event_settings SET invitation_picture_album=app_private.compact_invitation_album(invitation_picture_album) WHERE id=1");
    const storedAlbum = await value("SELECT invitation_picture_album v FROM public.event_settings WHERE id=1");
    assert.deepEqual(storedAlbum[0].picture, { picture_ref: sharedPicture, name: picture.name, crop: picture.crop });
    assert.equal(await value("SELECT count(*)::int v FROM app_private.invitation_snapshots WHERE kind='picture'"), 1);
    await db.exec("SET ROLE authenticated");
    current = await settings();
    assert.deepEqual(current.invitation_picture_album, withPicture.invitation_picture_album);
    await assert.rejects(
      () => q("SELECT public.admin_save_invitation_picture($1,'Forged',$2,$3)", [
        id, storedAlbum[0].picture, current.invitation_album_revision,
      ]),
      /Invalid album picture/,
    );
    await q("SELECT public.admin_save_invitation_picture($1,'Sample',$2,$3)", [id, picture, current.invitation_album_revision]);
    assert.deepEqual((await settings()).invitation_picture_album, withPicture.invitation_picture_album);
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
          require("./helpers/named-template.cjs").saveTemplate(db, { body: token + " {invitation_link}" }),
        /placeholder/,
      );
    const titles = { de: false, en: true };
    const saveTitles = (values, expected) =>
      q("SELECT public.admin_save_guest_interface('wide',$1,$2)", [
        { guest_title_visibility: values }, { guest_title_visibility: expected },
      ]);
    await saveTitles(titles, {});
    await assert.rejects(() => saveTitles({ de: true }, {}), /changed/);
    await assert.rejects(() => saveTitles({ de: "false" }, titles), /Invalid/);
    await assert.rejects(
      () => q("UPDATE public.event_settings SET guest_interface_modes='{}' WHERE id=1"),
      /editor|permission/,
    );
    await db.exec("RESET ROLE");
    const event = await value("SELECT app_private.guest_event() v");
    assert.equal(
      event.event.invitation_picture_album,
      undefined,
      "guest event must never include the shared album",
    );
    assert.equal(event.event.guest_interface_modes.wide.guest_title_visibility.de, false);
    await db.exec("SET ROLE authenticated");
    const backup = await value("SELECT public.admin_export_backup() v");
    assert.deepEqual(
      backup.payload.tables["public.event_settings"][0]
        .invitation_picture_album,
      withPicture.invitation_picture_album,
    );
    const forgedPayload = structuredClone(backup.payload);
    forgedPayload.tables["public.event_settings"][0].invitation_picture_album[0].picture = storedAlbum[0].picture;
    await db.exec("RESET ROLE");
    const forgedBackup = await value("SELECT app_private.seal_backup($1) v", [forgedPayload]);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      () => value("SELECT public.admin_preview_backup($1) v", [forgedBackup]),
      /Backup invitation picture album requires inline images/,
    );
    const withoutAlbum = await value("SELECT public.admin_export_backup('template',ARRAY['venues'],false) v");
    assert.deepEqual(withoutAlbum.payload.tables["public.event_settings"][0].invitation_picture_album, []);
    const partial = await value("SELECT public.admin_export_backup('template',ARRAY['venues','picture_album'],false) v");
    assert.deepEqual(partial.payload.tables["app_private.invitation_snapshots"], []);
    assert.deepEqual(partial.payload.tables["public.event_settings"][0].invitation_picture_album,withPicture.invitation_picture_album);
    const destination = await createDatabase();
    let albumOnlyBackup;
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
      assert.equal(restored.settings.guest_interface_modes.wide.guest_title_visibility.de, false);
      await destination.exec("RESET ROLE");
      const stored = (await destination.query("SELECT invitation_picture_album v FROM public.event_settings WHERE id=1")).rows[0].v;
      assert.deepEqual(stored, storedAlbum);
      await destination.exec("SET ROLE authenticated");
      const template = restored.invitationTemplates[0];
      await destination.query("SELECT public.admin_delete_invitation_template($1,$2)", [template.id, template]);
      albumOnlyBackup = (await destination.query("SELECT public.admin_export_backup() v")).rows[0].v;
      assert.deepEqual(albumOnlyBackup.payload.tables["app_private.invitation_snapshots"], []);
      assert.deepEqual(albumOnlyBackup.payload.tables["public.event_settings"][0].invitation_picture_album, withPicture.invitation_picture_album);
    } finally {
      await destination.close();
    }
    const albumDestination = await createDatabase();
    try {
      await signIn(albumDestination);
      await albumDestination.query("SELECT public.admin_restore_backup($1,$2)", [
        albumOnlyBackup, "RESTORE " + albumOnlyBackup.payload.tables["public.event_settings"][0].event_name,
      ]);
      const restored = (await albumDestination.query("SELECT public.admin_load_data() v")).rows[0].v;
      assert.deepEqual(restored.settings.invitation_picture_album, withPicture.invitation_picture_album);
    } finally {
      await albumDestination.close();
    }
    await q(
      "SELECT public.admin_save_invitation_picture($1,'Sample',null,$2)",
      [id, (await settings()).invitation_album_revision],
    );
    assert.equal((await settings()).invitation_picture_album.length, 0);
    assert.deepEqual(
      (await value("SELECT public.admin_load_data() v")).invitationTemplates[0].versions.de
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
      () => saveTitles({}, titles),
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
      "PASS album/title preferences: shared JPEG storage and private projections, inline format 3 backup and restore, stale-write guards, independent snapshots and View/anonymous denials.",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
