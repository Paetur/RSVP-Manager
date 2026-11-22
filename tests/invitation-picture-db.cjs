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
    const save = (picture, body = "Hello {invitation_link}") => require("./helpers/named-template.cjs").saveTemplate(db, { image: picture, body, channel: "manual" });
    const load = () => v("SELECT public.admin_load_data() v");
    await save(image);
    const template = (await load()).invitationTemplates[0];
    assert.deepEqual(template.versions.en.message_image, image);
    const provenance = { source_template_id: template.id, source_template_revision: template.revision };
    const h = await v("SELECT public.admin_save_household(null,$1) v", [{ household_name: "Synthetic", planning_group_id: "general", language: "en" }]);
    await q("SELECT public.admin_create_guest($1,$2)", [h, { first_name: "Example" }]);
    const values = { channel: "manual", status: "draft", message_body: "Hello {invitation_link}", message_image: image };
    const id = await v("SELECT public.admin_save_delivery(null,$1,$2,null) v", [
      h, { ...values, ...provenance },
    ]);
    const initial = await v("SELECT to_jsonb(q) v FROM public.invitation_send_queue q WHERE id=$1", [id]);
    assert.match(initial.template_snapshot_ref, /^[0-9a-f]{64}$/);
    assert.match(initial.message_image.picture_ref, /^[0-9a-f]{64}$/);
    assert.equal(initial.message_image.image, undefined);
    await save(null, "New wording {invitation_link}");
    assert.deepEqual((await load()).queue.find(row => row.id === id).message_image, image, "template removal never changes a saved draft");
    await assert.rejects(() => q("SELECT public.admin_save_delivery(null,$1,$2,null)", [
      h, { ...values, ...provenance },
    ]), /Invitation has changed/);
    await assert.rejects(() => q("SELECT content FROM app_private.invitation_snapshots"), /permission denied/);
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
    const snapshotTable = backup.payload.tables["app_private.invitation_snapshots"];
    const compactPicture = {picture_ref: initial.message_image.picture_ref, name: image.name, crop: image.crop};
    assert.deepEqual(backup.payload.tables["public.message_templates"][0].message_image, compactPicture);
    assert.deepEqual(backup.payload.tables["public.invitation_send_queue"][0].message_image, compactPicture);
    const sharedPicture = snapshotTable.find(snapshot => snapshot.kind === "picture");
    assert.equal(snapshotTable.filter(snapshot => snapshot.kind === "picture").length, 1);
    assert.deepEqual(sharedPicture, {id: compactPicture.picture_ref, kind: "picture", content: image.image});
    const savedTemplate = snapshotTable.find(snapshot => snapshot.kind === "template");
    assert.equal(savedTemplate.id, initial.template_snapshot_ref);
    assert.match(JSON.stringify(savedTemplate.content), /Hello \{invitation_link\}/);
    assert.ok(!JSON.stringify(savedTemplate.content).includes(image.image));
    const destination = await createDatabase();
    try {
      await signIn(destination);
      async function rejectSnapshotChange(change, error) {
        const modified = structuredClone(backup);
        const tables = modified.payload.tables;
        change(tables["app_private.invitation_snapshots"], tables["public.invitation_send_queue"][0]);
        modified.payload.counts["app_private.invitation_snapshots"] = tables["app_private.invitation_snapshots"].length;
        modified.checksum = (await destination.query(
          "SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') v", [modified.payload],
        )).rows[0].v;
        await assert.rejects(() => destination.query("SELECT public.admin_preview_backup($1)", [modified]), error);
      }
      await rejectSnapshotChange((snapshots) => snapshots.splice(snapshots.findIndex(s => s.kind === "picture"), 1), /Missing, mismatched or unused/);
      await rejectSnapshotChange((_, queue) => { queue.template_snapshot_ref = sharedPicture.id; }, /Missing, mismatched or unused/);
      await rejectSnapshotChange((_, queue) => { queue.message_image.image = image.image; }, /Invalid invitation picture reference/);
      await rejectSnapshotChange((snapshots) => { snapshots.find(s => s.kind === "picture").content += "A"; }, /Invitation snapshot checksum mismatch/);
      await rejectSnapshotChange((snapshots) => snapshots.push({ ...sharedPicture, id: "a".repeat(64) }), /Missing, mismatched or unused/);
      const rehearsal = (await destination.query("SELECT public.admin_preview_backup($1) v", [backup])).rows[0].v;
      assert.equal(rehearsal.can_restore, true, rehearsal.reason);
      await destination.query("SELECT public.admin_restore_backup($1,$2) v", [backup, "RESTORE " + backup.payload.tables["public.event_settings"][0].event_name]);
      const restored = (await destination.query("SELECT public.admin_load_data() v")).rows[0].v;
      assert.deepEqual(restored.invitationTemplates[0].versions.en.message_image, image);
      assert.deepEqual(restored.queue[0].message_image, image);
      assert.equal(restored.queue[0].template_snapshot_ref, initial.template_snapshot_ref);
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
    assert.deepEqual(await v("SELECT message_snapshot->'message_image' v FROM public.invitation_deliveries WHERE queue_id=$1", [id]), compactPicture);
    assert.equal((await row()).template_snapshot_ref, initial.template_snapshot_ref);
    const storedAudit = await v("SELECT new_value->'message_image' v FROM public.invitation_delivery_audit WHERE queue_id=$1 AND action='ready' LIMIT 1", [id]);
    assert.deepEqual(storedAudit, compactPicture);
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
    const noLogs = await v("SELECT public.admin_export_backup('backup',ARRAY['households','wording'],false) v");
    assert.equal(noLogs.payload.tables["app_private.invitation_snapshots"].filter(snapshot => snapshot.kind === "picture").length, 1,
      "different photo names share the same stored JPEG");
    assert.equal(noLogs.payload.tables["public.invitation_delivery_audit"].length, 0);
    const saveGermanPicture = (picture) => require("./helpers/named-template.cjs").saveTemplate(db, {
      language: "de", channel: "manual", image: picture,
    });
    const germanImage = {
      image: "data:image/jpeg;base64," + fs.readFileSync("tests/fixtures/shortcut-test.jpg").toString("base64"),
      name: "alternate-language.jpg",
      crop: { x: 0, y: 0, width: 640, height: 400, sourceWidth: 640, sourceHeight: 400 },
    };
    await saveGermanPicture(germanImage);
    const bilingualTemplate = (await load()).invitationTemplates[0];
    const bilingualHousehold = await v("SELECT public.admin_save_household(null,$1) v", [{
      household_name: "Snapshot dependency", planning_group_id: "general", language: "en",
    }]);
    await q("SELECT public.admin_create_guest($1,$2)", [bilingualHousehold, { first_name: "Example" }]);
    const currentCode = await v("SELECT invite_code v FROM public.households WHERE id=$1", [bilingualHousehold]);
    const savedCode = currentCode === "ABCDEFGH" ? "HGFEDCBA" : "ABCDEFGH";
    const unrelatedLink = "https://outside.example.invalid/?code=ZXCVBNM2";
    const restoredDraftId = await v("SELECT public.admin_save_delivery(null,$1,$2,null) v", [bilingualHousehold, {
      ...values, source_template_id: bilingualTemplate.id, source_template_revision: bilingualTemplate.revision,
      message_subject: `RSVP ${savedCode}`,
      message_body: `Custom (https://source.example.invalid/?=${savedCode}), also https://source.example.invalid/?code=${currentCode}. ${unrelatedLink}`,
    }]);
    await db.exec("RESET ROLE");
    await q("UPDATE public.invitation_send_queue SET invitation_code_snapshot=$1 WHERE id=$2", [savedCode, restoredDraftId]);
    await db.exec("SET ROLE authenticated");
    await saveGermanPicture(null);
    await q("SELECT public.admin_save_food_interest_reply('{\"en\":\"Synthetic food reply\"}','{}','[]')");
    const albumRevision = (await load()).settings.invitation_album_revision;
    await q("SELECT public.admin_save_invitation_picture(null,'Synthetic album entry',$1,$2)", [germanImage, albumRevision]);
    const selectedFull = await v("SELECT public.admin_export_backup('backup',ARRAY['households'],false) v");
    const germanSnapshot = selectedFull.payload.tables["app_private.invitation_snapshots"].find(row => row.content === germanImage.image);
    assert.ok(germanSnapshot, "an older template revision keeps the picture in its alternate language");
    assert.ok(selectedFull.payload.tables["app_private.invitation_snapshots"].some(row =>
      row.kind === "template" && row.content.versions.de?.message_image?.picture_ref === germanSnapshot.id));
    const partialWording = await v("SELECT public.admin_export_backup('template',ARRAY['wording'],false) v");
    assert.deepEqual(partialWording.payload.tables["app_private.invitation_snapshots"], [sharedPicture]);
    assert.deepEqual(partialWording.payload.tables["public.invitation_send_queue"], []);
    const partialHouseholds = await v("SELECT public.admin_export_backup('template',ARRAY['households'],false) v");
    assert.deepEqual(partialHouseholds.payload.tables["app_private.invitation_snapshots"], []);
    assert.deepEqual(partialHouseholds.payload.tables["public.event_settings"][0].invitation_picture_album, []);
    const exportPartial = async (...sections) => (await v("SELECT public.admin_export_backup('template',$1,false) v", [sections])).payload.tables;
    const language = await exportPartial("language_text");
    assert.deepEqual(language["public.message_templates"].map(row => row.template_key), ["food-interest-reply"]);
    assert.deepEqual(language["app_private.invitation_snapshots"], []);
    const invitations = await exportPartial("invitation_templates");
    assert.ok(invitations["public.message_templates"].every(row => row.template_key.startsWith("invitation:")));
    assert.deepEqual(invitations["app_private.invitation_snapshots"], [sharedPicture]);
    assert.deepEqual(invitations["public.event_settings"][0].invitation_picture_album, []);
    const albumOnly = await exportPartial("picture_album");
    assert.deepEqual(albumOnly["public.event_settings"][0].invitation_picture_album[0].picture, germanImage);
    assert.deepEqual(albumOnly["public.message_templates"], []);
    assert.deepEqual(albumOnly["app_private.invitation_snapshots"], []);
    await assert.rejects(() => exportPartial("drafts"), /Select Households/);
    const partialDrafts = await v("SELECT public.admin_export_backup('template',ARRAY['households','drafts'],false) v");
    const partialTables = partialDrafts.payload.tables;
    assert.deepEqual(partialTables["public.invitation_send_queue"].map(row => row.id).sort(), [shared, distinct, textOnly, restoredDraftId].sort());
    assert.equal(partialTables["public.invitation_send_queue"].every(row => row.status === "draft" && row.created_by === null && row.invitation_code_snapshot === null), true);
    assert.equal(partialTables["public.households"].every(row => row.invite_code === null), true);
    assert.deepEqual(partialTables["public.message_templates"], []);
    assert.deepEqual(partialTables["public.invitation_delivery_audit"], []);
    assert.deepEqual(partialDrafts.payload.identities, []);
    assert.ok(partialTables["app_private.invitation_snapshots"].some(row => row.id === germanSnapshot.id));
    const savedDraft = partialTables["public.invitation_send_queue"].find(row => row.id === restoredDraftId);
    assert.equal(savedDraft.message_body, `Custom ({invitation_link}), also {invitation_link}. ${unrelatedLink}`);
    assert.equal(savedDraft.message_subject, "RSVP {invitation_link}");

    const allBackup = await v("SELECT public.admin_export_backup() v");
    await db.exec("RESET ROLE");
    const projected = await v("SELECT app_private.project_backup($1,'template',ARRAY['wording'],false) v", [allBackup]);
    assert.deepEqual(projected.payload.tables, partialWording.payload.tables);
    const narrowerDrafts = await v("SELECT app_private.project_backup($1,'template',ARRAY['households','drafts'],false) v", [allBackup]);
    assert.deepEqual(narrowerDrafts.payload.tables, partialTables);
    const tamperedDraft = structuredClone(partialDrafts.payload);
    tamperedDraft.tables["public.invitation_send_queue"][0].status = "sent";
    const tampered = await v("SELECT app_private.seal_backup($1) v", [tamperedDraft]);
    const destinationDrafts = await createDatabase();
    try {
      await signIn(destinationDrafts);
      const preview = async archive => (await destinationDrafts.query("SELECT public.admin_preview_backup($1) v", [archive])).rows[0].v;
      await assert.rejects(() => preview(tampered), /delivery history or an invitation code/);
      const report = await preview(partialDrafts);
      assert.equal(report.can_restore, true, report.reason);
      await destinationDrafts.query("SELECT public.admin_restore_backup($1,$2)", [partialDrafts, `RESTORE ${report.event_name}`]);
      const getDestination = async () => (await destinationDrafts.query("SELECT public.admin_load_data() v")).rows[0].v;
      const restored = await getDestination();
      assert.equal(restored.settings.is_published, false);
      assert.equal(restored.households.find(row => row.id === bilingualHousehold).invite_code, null);
      assert.deepEqual(restored.queue.find(row => row.id === restoredDraftId).message_image, image);
      assert.deepEqual(restored.deliveries, []);
      await destinationDrafts.exec("RESET ROLE; UPDATE public.event_settings SET is_published=true WHERE id=1; SET ROLE authenticated");
      const published = await getDestination();
      const freshCode = published.households.find(row => row.id === bilingualHousehold).invite_code;
      assert.match(freshCode, /^[A-HJ-NP-Z2-9]{8}$/);
      assert.notEqual(freshCode, currentCode);
      assert.notEqual(freshCode, savedCode);
      const link = `https://destination.example.invalid/?=${freshCode}`;
      await destinationDrafts.query(saveDelivery, [restoredDraftId, bilingualHousehold, {
        ...values, status: "ready", expected_invitation_code: freshCode,
        message_subject: savedDraft.message_subject.replaceAll("{invitation_link}", link),
        message_body: savedDraft.message_body.replaceAll("{invitation_link}", link),
      }, savedDraft.revision]);
      const readyDraft = (await getDestination()).queue.find(row => row.id === restoredDraftId);
      assert.equal(readyDraft.invitation_code_snapshot, freshCode);
      assert.equal(readyDraft.message_subject, `RSVP ${link}`);
    } finally { await destinationDrafts.close(); }
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
    await assert.rejects(() => q("SELECT content FROM app_private.invitation_snapshots"), /permission denied/);
    console.log("PASS invitation pictures: private templates, independent draft/sent snapshots, JPEG validation on every write path, link fallback, backup inclusion, publication and permission guards.");
  } finally { await db.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
