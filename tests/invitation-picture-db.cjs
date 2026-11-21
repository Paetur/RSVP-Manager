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
    const save = (picture, body = "Hello {invitation_link}") => require("./helpers/named-template.cjs").saveTemplate(db, { image: picture, body });
    await save(image);
    assert.deepEqual((await v("SELECT public.admin_load_data() v")).invitationTemplates[0].versions.en.message_image, image);
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
    assert.equal((await v("SELECT public.admin_load_data() v")).invitationTemplates[0].versions.en.body, "{invitation_link}", "picture-only template retains a link fallback");
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
      assert.deepEqual(restored.invitationTemplates[0].versions.en.message_image, image);
      assert.deepEqual(restored.queue[0].message_image, image);
    } finally { await destination.close(); }
    assert.equal(await v("SELECT is_published v FROM public.event_settings"), false);
    await assert.rejects(() => q("SELECT public.admin_record_delivery_sent($1,1,null)", [id]), /published/);
    await db.exec("RESET ROLE; UPDATE public.event_settings SET is_published=true WHERE id=1; SET ROLE authenticated");
    const ready = { ...values, status: "ready", message_body: "https://example.invalid/?=ABCDEFGH" };
    const draft = { status: "draft", only_if_ready: true };
    const saveDelivery = "SELECT public.admin_save_delivery($1,$2,$3,$4) v";
    const row = () => v("SELECT to_jsonb(q) v FROM public.invitation_send_queue q WHERE id=$1", [id]);
    await q(saveDelivery, [id, h, ready, 1]);
    const { updated_at: readyAt, ...readyRow } = await row();
    await assert.rejects(() => q(saveDelivery, [id, h, draft, 1]), /changed/);
    await assert.rejects(() => q(saveDelivery, [id, h, { ...draft, message_image: null }, 2]), /valid delivery details/);
    await db.exec("SET ROLE anon");
    await assert.rejects(() => q(saveDelivery, [id, h, draft, 2]), /permission denied/);
    await db.exec("SET ROLE authenticated");
    assert.equal(await v(saveDelivery, [id, h, draft, 2]), id);
    const { updated_at: draftAt, ...draftRow } = await row();
    assert.ok(draftAt >= readyAt);
    assert.deepEqual(draftRow, { ...readyRow, status: "draft", revision: 3 });
    const audit = await v("SELECT action v FROM public.invitation_delivery_audit WHERE queue_id=$1 ORDER BY (new_value->>'revision')::int DESC LIMIT 1", [id]);
    assert.equal(audit, "draft");
    await assert.rejects(() => q(saveDelivery, [id, h, draft, 3]), /changed/);
    await assert.rejects(() => q("SELECT public.admin_record_delivery_sent($1,3,null)", [id]), /ready/);
    await q(saveDelivery, [id, h, ready, 3]);
    await q("SELECT public.admin_record_delivery_sent($1,4,null)", [id]);
    assert.deepEqual(await v("SELECT message_snapshot->'message_image' v FROM public.invitation_deliveries WHERE queue_id=$1", [id]), image);
    await assert.rejects(() => q(saveDelivery, [id, h, draft, 5]), /read-only/);
    await assert.rejects(() => q(saveDelivery, [id, h, { ...values, message_image: null }, 5]), /read-only/);
    async function draftWithPicture(name, picture) {
      const household = await v("SELECT public.admin_save_household(null,$1) v", [{
        household_name: name, planning_group_id: "general", language: "en",
      }]);
      await q("SELECT public.admin_create_guest($1,$2)", [household, { first_name: "Example" }]);
      return v("SELECT public.admin_save_delivery(null,$1,$2,null) v", [
        household, { ...values, message_image: picture },
      ]);
    }
    const shared = await draftWithPicture("Shared picture", image);
    const distinct = await draftWithPicture("Distinct picture metadata", { ...image, name: "other.jpg" });
    const textOnly = await draftWithPicture("Text only", null);
    const retired = await draftWithPicture("Retired picture", { ...image, name: "retired.jpg" });
    await q("SELECT public.admin_delete_delivery_draft($1,1)", [retired]);
    const full = await v("SELECT public.admin_load_data() v");
    const compact = await v("SELECT public.admin_load_data(true) v");
    assert.equal(full.queuePictures, undefined);
    assert.equal(Object.keys(compact.queuePictures).length, 2);
    assert.equal(compact.queue.length, 4);
    const pictureKeys = Object.fromEntries(compact.queue.map(row => [row.id, row.message_image_key]));
    assert.match(pictureKeys[id], /^[0-9a-f]{64}$/);
    assert.equal(pictureKeys[shared], pictureKeys[id], "the common picture is carried once");
    assert.notEqual(pictureKeys[distinct], pictureKeys[id]);
    assert.equal(pictureKeys[textOnly], null);
    assert.equal(Object.hasOwn(pictureKeys, retired), false);
    const originalById = new Map(full.queue.map(row => [row.id, row]));
    for (const { message_image_key: key, ...row } of compact.queue) {
      const picture = key ? compact.queuePictures[key] : null;
      assert.deepEqual({ ...row, message_image: picture }, originalById.get(row.id));
    }
    assert.deepEqual(full.deliveries[0].message_snapshot.message_image, image);
    assert.equal(compact.deliveries[0].message_snapshot.message_image, undefined);
    assert.equal(compact.deliveries[0].message_snapshot.body, full.deliveries[0].message_snapshot.body);
    await db.exec("RESET ROLE");
    await q("UPDATE public.admins SET access_permissions=jsonb_set(app_private.permission_preset('custom'),'{sections,invites}','\"none\"')");
    await db.exec("SET ROLE authenticated");
    const hidden = await v("SELECT public.admin_load_data(true) v");
    assert.deepEqual(hidden.queue, []);
    assert.deepEqual(hidden.queuePictures, {});
    // Settings view cannot write pictures; anonymous callers cannot read them.
    await db.exec("RESET ROLE");
    await q("UPDATE public.admins SET access_permissions=app_private.permission_preset('view')");
    await db.exec("SET ROLE authenticated");
    await assert.rejects(() => save(image), /permission|access/i);
    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(() => q("SELECT message_image FROM public.message_templates"), /permission denied/);
    await assert.rejects(() => save(image), /permission denied/);
    await assert.rejects(() => q("SELECT public.admin_load_data(true)"), /permission denied/);
    console.log("PASS invitation pictures: private templates, independent draft/sent snapshots, JPEG validation on every write path, link fallback, backup inclusion, publication and permission guards.");
  } finally { await db.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
