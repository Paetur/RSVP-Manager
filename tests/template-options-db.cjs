// Current template options and guarded draft retirement on a disposable database.
const assert = require("node:assert/strict");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
(async () => {
  const db = await createDatabase();
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
  try {
    await signIn(db);
    const content = { subject: "Retained {event_name}", body: "Full {household_name} · {rsvp_deadline:+4} · {invitation_link}", short_body: "Short {invitation_link}", options: ["shortMessage"] };
    const values = { name: "Short invitation", channels: ["sms", "whatsapp"], versions: { en: content } };
    const id = await value("SELECT public.admin_save_invitation_template(NULL,$1) v", [values]);
    const load = () => value("SELECT public.admin_load_data() v");
    const named = (await load()).invitationTemplates.find(t => t.id === id);
    assert.deepEqual(named.versions.en.options, ["shortMessage"]);
    assert.equal(named.versions.en.body, content.body, "disabled full message is retained");
    assert.equal(named.versions.en.short_body, content.short_body);
    for (const invalid of [{ options: [] }, { options: ["unsupported"] }, { options: ["shortMessage"], short_body: "No link" }, { short_body: "Line\n{invitation_link}" }]) {
      await assert.rejects(db.query("SELECT public.admin_save_invitation_template($1,$2,$3)", [id, { ...values, versions: { en: { ...content, ...invalid } } }, named]), /option|short message/);
    }
    for (const token of ["{not_supported}", "{invite-deadline}", "{invite-deadline:+4}"]) {
      await assert.rejects(db.query("SELECT public.admin_save_invitation_template($1,$2,$3)", [id, { ...values, versions: { en: { ...content, body: token + " {invitation_link}" } } }, named]), /valid invitation link/);
      await assert.rejects(db.query("SELECT public.admin_save_invitation_template($1,$2,$3)", [id, { ...values, versions: { en: { ...content, short_body: token + " {invitation_link}" } } }, named]), /short message/);
    }
    assert.deepEqual((await load()).invitationTemplates.find(t => t.id === id), named, "rejected placeholder changes preserve the saved template exactly");
    const household = await value("SELECT public.admin_save_household(NULL,$1) v", [{ household_name: "Synthetic", planning_group_id: "general", language: "en" }]);
    await db.query("SELECT public.admin_create_guest($1,$2)", [household, { first_name: "Example" }]);
    const draft = await value("SELECT public.admin_save_delivery(NULL,$1,$2,NULL) v", [household, { channel: "manual", status: "draft", message_body: "Snapshot {invitation_link}" }]);
    const removable = await value("SELECT public.admin_save_invitation_template(NULL,$1) v", [{ ...values, name: "Removable template" }]);
    const expected = (await load()).invitationTemplates.find(t => t.id === removable);
    await assert.rejects(db.query("SELECT public.admin_delete_invitation_template($1,$2)", [removable, { ...expected, name: "Stale name" }]), /changed/);
    const beforeDelete = await value("SELECT public.admin_export_backup() v");
    await db.query("SELECT public.admin_delete_invitation_template($1,$2)", [removable, expected]);
    assert.equal((await load()).invitationTemplates.some(t => t.id === removable), false, "deleted template disappears");
    assert.equal(await value("SELECT count(*)::int v FROM public.message_templates WHERE template_key=$1", ["invitation:" + removable]), 0, "all template content rows are removed");
    const afterDelete = await value("SELECT public.admin_export_backup() v");
    for (const table of ["public.invitation_send_queue", "public.invitation_deliveries", "public.invitation_delivery_audit"])
      assert.deepEqual(afterDelete.payload.tables[table], beforeDelete.payload.tables[table], "template deletion retains delivery snapshots and audit: " + table);
    await assert.rejects(db.query("SELECT public.admin_delete_invitation_template($1,$2)", [removable, expected]), /changed/);
    await assert.rejects(db.query("SELECT public.admin_delete_delivery_draft($1,99)", [draft]), /changed/);
    await db.query("SELECT public.admin_delete_delivery_draft($1,1)", [draft]);
    assert.equal((await load()).queue.some(q => q.id === draft), false, "deleted draft disappears from active delivery lists");
    assert.equal(await value("SELECT message_body v FROM public.invitation_send_queue WHERE id=$1", [draft]), "Snapshot {invitation_link}");
    assert.equal(await value("SELECT count(*)::int v FROM public.invitation_delivery_audit WHERE queue_id=$1", [draft]), 2, "creation and deletion history survive");
    await assert.rejects(db.query("SELECT public.admin_delete_delivery_draft($1,2)", [draft]), /unsent drafts/);
    const backup = await value("SELECT public.admin_export_backup() v");
    assert.equal(backup.payload.tables["public.message_templates"][0].short_body, content.short_body);
    assert.equal(backup.payload.tables["public.invitation_send_queue"].length, 1, "backup retains retired snapshot");
    await db.exec("RESET ROLE; UPDATE public.admins SET access_permissions=app_private.permission_preset('view'); SET ROLE authenticated");
    await assert.rejects(db.query("SELECT public.admin_delete_delivery_draft($1,2)", [draft]), /permission/);
    await assert.rejects(db.query("SELECT public.admin_delete_invitation_template($1,$2)", [id, named]), /permission/);
    await db.exec("SET ROLE anon");
    await assert.rejects(db.query("SELECT public.admin_delete_delivery_draft($1,2)", [draft]), /permission/);
    await assert.rejects(db.query("SELECT public.admin_delete_invitation_template($1,$2)", [id, named]), /permission/);
    console.log("PASS template options, independent short/full content, validation, backup inclusion, stale/permission guards; template deletion preserves deliveries; draft deletion retains snapshots/audit.");
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
