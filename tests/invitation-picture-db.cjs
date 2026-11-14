// Private image persistence and history on disposable current-alpha databases.
const assert = require("node:assert/strict"), fs = require("node:fs");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
(async () => {
  const db = await createDatabase();
  const q = (sql, args = []) => db.query(sql, args);
  const v = async (sql, args = []) => (await q(sql, args)).rows[0].v;
  const image = {
    image: "data:image/jpeg;base64," + fs.readFileSync("tests/fixtures/customization.jpg").toString("base64"),
    name: "synthetic.jpg", crop: { x: 0, y: 0, width: 3, height: 2, sourceWidth: 3, sourceHeight: 2 },
  };
  try {
    await signIn(db);
    const save = (picture, body = "Hello {invitation_link}") => q(
      "SELECT public.admin_save_invitation_template('en','whatsapp','',$1,$2)", [body, picture],
    );
    await save(image);
    assert.deepEqual((await v("SELECT public.admin_load_data() v")).invitationTemplates[0].message_image, image);
    const h = await v("SELECT public.admin_save_household(null,$1) v", [{ household_name: "Synthetic", planning_group_id: "general", language: "en" }]);
    await q("SELECT public.admin_create_guest($1,$2)", [h, { first_name: "Example" }]);
    const values = { channel: "manual", status: "draft", message_body: "Hello {invitation_link}", message_image: image };
    const id = await v("SELECT public.admin_save_delivery(null,$1,$2,null) v", [h, values]);
    await save(null);
    assert.deepEqual(await v("SELECT message_image v FROM public.invitation_send_queue WHERE id=$1", [id]), image, "template removal never changes a saved draft");
    for (const invalid of [
      { ...image, image: "https://example.invalid/private.jpg" },
      { ...image, image: "data:image/svg+xml;base64,AAAA" },
      { ...image, image: "data:image/jpeg;base64,YQ==" },
      { ...image, crop: { ...image.crop, sourceWidth: 9999 } },
      { ...image, extra: "unbounded metadata" },
    ]) {
      await assert.rejects(() => save(invalid), /JPEG|crop|picture/);
      await assert.rejects(() => q("SELECT public.admin_save_delivery($1,$2,$3,1)", [id, h, { ...values, message_image: invalid }]), /JPEG|crop|picture/);
      await assert.rejects(() => q("UPDATE public.invitation_send_queue SET message_image=$1 WHERE id=$2", [invalid, id]), /permission denied/);
      await db.exec("RESET ROLE");
      await assert.rejects(() => q("UPDATE public.invitation_send_queue SET message_image=$1 WHERE id=$2", [invalid, id]), /JPEG|crop|picture/);
      await db.exec("SET ROLE authenticated");
    }
    await save(image, "");
    assert.equal((await v("SELECT public.admin_load_data() v")).invitationTemplates[0].body, "{invitation_link}", "picture-only template retains a link fallback");
    const backup = await v("SELECT public.admin_export_backup() v");
    assert.deepEqual(backup.payload.tables["public.message_templates"][0].message_image, image);
    assert.deepEqual(backup.payload.tables["public.invitation_send_queue"][0].message_image, image);
    const destination = await createDatabase();
    try {
      await signIn(destination);
      const rehearsal = (await destination.query("SELECT public.admin_preview_backup($1) v", [backup])).rows[0].v;
      assert.equal(rehearsal.can_restore, true, rehearsal.reason);
      await destination.query("SELECT public.admin_restore_backup($1,$2) v", [backup, "RESTORE " + backup.payload.tables["public.event_settings"][0].event_name]);
      const restored = (await destination.query("SELECT public.admin_load_data() v")).rows[0].v;
      assert.deepEqual(restored.invitationTemplates[0].message_image, image);
      assert.deepEqual(restored.queue[0].message_image, image);
    } finally { await destination.close(); }
    assert.equal(await v("SELECT is_published v FROM public.event_settings"), false);
    await assert.rejects(() => q("SELECT public.admin_record_delivery_sent($1,1,null)", [id]), /published/);
    await db.exec("RESET ROLE; UPDATE public.event_settings SET is_published=true WHERE id=1; SET ROLE authenticated");
    await q("SELECT public.admin_save_delivery($1,$2,$3,1)", [id, h, { ...values, status: "ready", message_body: "https://example.invalid/?=ABCDEFGH" }]);
    await q("SELECT public.admin_record_delivery_sent($1,2,null)", [id]);
    assert.deepEqual(await v("SELECT message_snapshot->'message_image' v FROM public.invitation_deliveries WHERE queue_id=$1", [id]), image);
    await assert.rejects(() => q("SELECT public.admin_save_delivery($1,$2,$3,3)", [id, h, { ...values, message_image: null }]), /read-only/);
    // Settings view cannot write pictures; anonymous callers cannot read them.
    await db.exec("RESET ROLE");
    await q("UPDATE public.admins SET access_permissions=app_private.permission_preset('view')");
    await db.exec("SET ROLE authenticated");
    await assert.rejects(() => save(image), /permission|access/i);
    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(() => q("SELECT message_image FROM public.message_templates"), /permission denied/);
    await assert.rejects(() => save(image), /permission denied/);
    console.log("PASS invitation pictures: private templates, independent draft/sent snapshots, JPEG validation on every write path, link fallback, backup inclusion, publication and permission guards.");
  } finally { await db.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
