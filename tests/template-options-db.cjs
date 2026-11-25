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
    const loadTemplate = async id => (await load()).invitationTemplates.find(template => template.id === id);
    const createTemplate = attrs => value("SELECT public.admin_save_invitation_template(NULL,$1) v", [{ ...values, ...attrs }]);
    const messageTemplateValues = {
      name: "Tagged Messages template", channels: ["messages"], language_tags: ["en", "fo"],
      versions: { en: content, fo: content },
    };
    const messageTemplateId = await createTemplate(messageTemplateValues);
    const messages = await loadTemplate(messageTemplateId);
    assert.deepEqual(named.language_tags, [], "pre-tagging template content language does not imply a tag");
    assert.deepEqual(messages.language_tags, ["en", "fo"]);
    for (const tags of ["en", [null], ["xx"], ["en", "en"]]) {
      await assert.rejects(createTemplate({ ...messageTemplateValues, name: "Invalid tagged template", language_tags: tags }), /language tags/);
    }
    const smsTemplateId = await createTemplate({ name: "Tagged SMS template", channels: ["sms"], language_tags: ["en"] });
    const sms = await loadTemplate(smsTemplateId);
    const createFamily = async (name, language, method) => {
      const id = await value("SELECT public.admin_save_household(NULL,$1) v", [{ household_name: name, planning_group_id: "general", language }]);
      const details = { first_name: "Kim", mobile: "5551234567", preferred_contact_method: "sms" };
      const guest = await value("SELECT public.admin_save_guest_details(NULL,$1,$2) v", [id, details]);
      await db.query("SELECT public.admin_set_household_primary_guest($1,$2)", [id, guest]);
      if (method !== "sms") await db.query("SELECT public.admin_save_guest_details($1,$2,$3)", [guest, id, { ...details, preferred_contact_method: method }]);
      return id;
    };
    const generate = (household, template, channel = "sms") => value("SELECT public.admin_save_delivery(NULL,$1,$2,NULL) v", [household, {
      channel, status: "draft", only_if_missing: true, template_id: template.id, template_revision: template.revision, message_body: "Matched {invitation_link}",
    }]);
    const messagesFamily = await createFamily("Messages family", "en", null);
    const germanFamily = await createFamily("German family", "de", null);
    const smsFamily = await createFamily("SMS family", "en", "sms");
    assert.equal(await generate(messagesFamily, sms), null, "SMS and Messages match distinct templates");
    assert.equal(await generate(smsFamily, messages), null, "Messages and SMS share delivery channel but stay distinct");
    assert.equal(await generate(germanFamily, messages), null, "no exact language tag means no draft");
    assert.equal(await generate(messagesFamily, messages, "email"), null, "stale household channel cannot create a draft");
    const duplicateId = await createTemplate({ ...messageTemplateValues, name: "Another Messages template" });
    assert.equal(await generate(messagesFamily, messages), null, "a concurrent matching template prevents generation");
    await db.query("SELECT public.admin_delete_invitation_template($1,$2)", [duplicateId, await loadTemplate(duplicateId)]);
    await db.query("SELECT public.admin_save_invitation_template($1,$2,$3)", [messageTemplateId, { ...messageTemplateValues, name: "Updated Messages template" }, messages]);
    assert.equal(await generate(messagesFamily, messages), null, "a concurrent template edit invalidates the old revision");
    const updatedMessages = await loadTemplate(messageTemplateId);
    assert.ok(await generate(messagesFamily, updatedMessages), "two versions of one tagged template count as one match");
    assert.equal(await generate(messagesFamily, updatedMessages), null, "a second generation preserves the existing draft");
    assert.ok(await generate(smsFamily, sms), "the untagged legacy template does not make the SMS match ambiguous");
    assert.equal(await value("SELECT is_published v FROM public.event_settings WHERE id=1"), false, "generating drafts does not publish");
    await assert.rejects(db.query("SELECT app_private.matches_bulk_draft_template(NULL,'sms',NULL,NULL)"), /permission denied/);
    await db.exec("RESET ROLE; UPDATE public.admins SET access_permissions=app_private.permission_preset('view'); SET ROLE authenticated");
    await assert.rejects(db.query("SELECT public.admin_delete_delivery_draft($1,2)", [draft]), /permission/);
    await assert.rejects(db.query("SELECT public.admin_delete_invitation_template($1,$2)", [id, named]), /permission/);
    await db.exec("SET ROLE anon");
    await assert.rejects(db.query("SELECT public.admin_delete_delivery_draft($1,2)", [draft]), /permission/);
    await assert.rejects(db.query("SELECT public.admin_delete_invitation_template($1,$2)", [id, named]), /permission/);
    console.log("PASS template options, validation, backup inclusion, guarded deletion, exact service/language matching, stale revisions, and draft preservation.");
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
