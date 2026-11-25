// Destructive operations run exclusively in disposable synthetic databases.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { withRecordRevision, createDatabase, signIn } = require("./helpers/alpha-database.cjs");
const { saveTemplate } = require("./helpers/named-template.cjs");

const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].v;
const codeRegistry = "app_private.invitation_code_registry";
const jpeg = (file, sourceWidth, sourceHeight) => ({
  image: "data:image/jpeg;base64," + readFileSync("tests/fixtures/" + file).toString("base64"),
  name: file,
  crop: { x: 0, y: 0, width: sourceWidth, height: sourceHeight, sourceWidth, sourceHeight },
});

async function exportPlanningFiles(destinationPicture) {
  const source = await createDatabase();
  const v = (sql, args) => scalar(source, sql, args);
  try {
    await signIn(source);
    const venue = await v("SELECT public.admin_save_venue(NULL,$1) v", [{ name: "Planning venue", timezone: "UTC" }]);
    const household = await v("SELECT public.admin_save_household(NULL,$1) v", [{
      household_name: "Planning household", language: "en", planning_group_id: "general",
    }]);
    await source.query("SELECT public.admin_create_guest($1,$2)", [household, { first_name: "Planning guest" }]);
    const picture = jpeg("shortcut-test.jpg", 640, 400);
    await saveTemplate(source, { channel: "manual", image: picture, body: "Planning invitation {invitation_link}" });
    const revision = (await v("SELECT public.admin_load_data() v")).settings.invitation_album_revision;
    await source.query("SELECT public.admin_save_invitation_picture(NULL,'Planning album',$1,$2)", [picture, revision]);
    await source.query("SELECT public.admin_save_delivery(NULL,$1,$2,NULL)", [household, {
      channel: "manual", status: "draft", message_body: "Source draft only", message_image: destinationPicture,
    }]);
    await source.exec("RESET ROLE");
    const session = await v("INSERT INTO public.event_sessions(session_key,name,location_id) VALUES('planning','Planning session',$1) RETURNING id v", [venue]);
    await source.query("INSERT INTO public.household_session_defaults VALUES($1,$2,true)", [household, session]);
    await source.exec("UPDATE public.event_settings SET event_name='New planning event',website_url='https://source.example.invalid',is_published=true WHERE id=1");
    const code = await v("SELECT invite_code v FROM public.households WHERE id=$1", [household]);
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    await source.exec("UPDATE public.event_settings SET is_published=false WHERE id=1; SET ROLE authenticated");
    const full = await v("SELECT public.admin_export_backup() v");
    const all = await v("SELECT public.admin_export_backup('template',ARRAY['venues','households','food','other','wording'],false) v");
    const partial = await v("SELECT public.admin_export_backup('template',ARRAY['venues','households','invitation_templates','picture_album','drafts','code_reservations'],false) v");
    const reservationsOnly = await v("SELECT public.admin_export_backup('template',ARRAY['code_reservations'],false) v");
    assert.equal(partial.payload.tables["public.invitation_send_queue"].length, 1, "the verified source intentionally contains an optional draft");
    assert.ok(partial.payload.tables["app_private.invitation_snapshots"].some(snapshot => snapshot.content === destinationPicture.image));
    assert.deepEqual(all.payload.tables[codeRegistry], [], "Partial export omits reservations by default");
    assert.deepEqual(partial.payload.tables[codeRegistry], full.payload.tables[codeRegistry]);
    assert.equal(partial.payload.tables[codeRegistry][0].code, code);
    assert.equal(partial.payload.tables["public.households"][0].invite_code, null, "the issued code does not activate a Partial backup household");
    assert.deepEqual(reservationsOnly.payload.tables[codeRegistry], full.payload.tables[codeRegistry]);
    assert.deepEqual(reservationsOnly.payload.tables["public.households"], [], "reservations can outlive their original households");
    return { full, all, partial, household, picture, code };
  } finally {
    await source.close();
  }
}

async function testPlanningCodeReservations({ partial, household, code }) {
  const db = await createDatabase();
  const v = (sql, args) => scalar(db, sql, args);
  const preview = (file, sections) => v("SELECT public.admin_preview_backup($1,'template',$2,false) v", [file, sections]);
  try {
    const forgedPayload = structuredClone(partial.payload);
    forgedPayload.tables["public.households"][0].invite_code = code;
    const forged = await v("SELECT app_private.seal_backup($1) v", [forgedPayload]);
    await signIn(db);
    await assert.rejects(() => preview(forged, null), /Partial backup contains delivery history or an invitation code/);
    const withoutReservations = partial.payload.selection.sections.filter(section => section !== "code_reservations");
    const excluded = await preview(partial, withoutReservations);
    assert.equal(excluded.can_restore, true, excluded.reason);
    assert.equal(excluded.counts[codeRegistry], 0, "the restore can leave optional reservations out");
    const included = await preview(partial, partial.payload.selection.sections);
    assert.equal(included.can_restore, true, included.reason);
    assert.equal(included.counts[codeRegistry], 1);
    await db.query("SELECT public.admin_restore_backup($1,$2,'template',$3,false)", [partial, "RESTORE " + included.event_name, included.selection.sections]);
    const restored = (await v("SELECT public.admin_export_backup() v")).payload.tables;
    assert.deepEqual(restored[codeRegistry], partial.payload.tables[codeRegistry]);
    assert.equal(restored["public.households"][0].invite_code, null);
    await db.exec("RESET ROLE; UPDATE public.event_settings SET is_published=true WHERE id=1");
    const newCode = await v("SELECT invite_code v FROM public.households WHERE id=$1", [household]);
    assert.match(newCode, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.notEqual(newCode, code, "an imported reservation cannot become an active invitation link");
  } finally {
    await db.close();
  }
}

async function testPlanningRestart(db, { venue, household, queue }) {
  const v = (sql, args) => scalar(db, sql, args);
  const originalPicture = jpeg("customization.jpg", 3, 2);
  const source = await exportPlanningFiles(originalPicture);
  await testPlanningCodeReservations(source);
  const exportFull = () => v("SELECT public.admin_export_backup() v");
  const preview = backup => v("SELECT public.admin_preview_planning_restart($1) v", [backup]);
  const prepare = (backup, checked) => v("SELECT public.admin_prepare_planning_restart($1,$2) v", [backup, checked.destination_state]);
  const restart = (backup, checked, token, verb = "RESTART") => v("SELECT public.admin_restart_planning($1,$2,$3) v", [backup, verb + " " + checked.event_name, token]);
  const readSecurity = () => v(`SELECT jsonb_build_object(
    'admins',(SELECT jsonb_agg(to_jsonb(a) ORDER BY user_id) FROM public.admins a),
    'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u),
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM auth.sessions s)) v`);

  await saveTemplate(db, { channel: "manual", image: originalPicture, body: "Original invitation {invitation_link}" });
  await db.query("SELECT public.admin_prepare_invitation('planning-operator@example.invalid','Synthetic operator')");
  await db.exec("RESET ROLE");
  const auth = await readSecurity();
  const session = await v("INSERT INTO public.event_sessions(session_key,name,location_id) VALUES('original','Original session',$1) RETURNING id v", [venue]);
  const food = await v("INSERT INTO public.food_items(name_en,quantity_needed) VALUES('Original food',3) RETURNING id v");
  const guest = await v("SELECT id v FROM public.guests WHERE household_id=$1", [household]);
  await db.query("INSERT INTO public.household_session_defaults VALUES($1,$2,true)", [household, session]);
  await db.query("UPDATE public.households SET food=true WHERE id=$1", [household]);
  await db.exec("INSERT INTO public.other_categories(name) VALUES('Original tasks'); INSERT INTO public.other_items(item,category_id) SELECT 'Original task',id FROM public.other_categories WHERE name='Original tasks'; UPDATE public.event_settings SET website_url='https://destination.example.invalid',food_stage='selection',is_published=true WHERE id=1");
  const destinationCode = await v("SELECT invite_code v FROM public.households WHERE id=$1", [household]);
  const retire = destinationCode === 'ABCD2345' ? 'EFGH6789' : 'ABCD2345';
  await db.query("INSERT INTO app_private.invitation_code_registry(code,household_id) VALUES($1,$2)", [retire, household]);
  await db.query("SELECT public.submit_household_rsvp($1,gen_random_uuid(),$2)", [destinationCode, [{ guest_id: guest, session_id: session, status: "attending" }]]);
  await db.query("SELECT public.set_household_food_claim($1,$2,2,NULL)", [destinationCode, food]);
  await db.query("INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,new_value) SELECT id,auth.uid(),'created',to_jsonb(q) FROM public.invitation_send_queue q WHERE id=$1", [queue]);

  await db.exec("SET ROLE authenticated");
  await assert.rejects(() => preview(source.partial), /unpublished/i);
  await db.exec("RESET ROLE; UPDATE public.event_settings SET is_published=false WHERE id=1; SET ROLE authenticated");
  await assert.rejects(() => preview(source.full), /Partial/i);
  const fullPlanning = await preview(source.all);
  assert.equal(fullPlanning.can_restore, true, fullPlanning.reason);
  assert.equal(fullPlanning.counts["public.guests"], 1);
  assert.equal(fullPlanning.counts["public.household_session_defaults"], 1);
  assert.equal(fullPlanning.counts["public.invitation_send_queue"], 0);
  const first = await preview(source.partial);
  assert.equal(first.can_restore, true, first.reason);
  assert.ok(first.preserved_tables.includes("app_private.invitation_code_registry"));
  assert.equal(first.current_counts["public.food_items"], 1);
  assert.equal(first.counts["public.food_items"], 0);
  assert.equal(first.current_counts["public.other_items"], 1);
  assert.equal(first.counts["public.other_items"], 0);
  assert.equal(first.counts["public.invitation_send_queue"], 0);
  assert.equal(first.counts["app_private.invitation_snapshots"], 1);
  assert.equal(first.selection.sections.includes("drafts"), false);
  assert.equal(first.selection.sections.includes("code_reservations"), false);
  assert.equal(first.counts[codeRegistry], 0, "Restart never imports reservations from the source");

  const stale = await prepare(source.partial, first);
  await db.query("SELECT public.admin_save_venue($1,$2)", [venue, await withRecordRevision(db, "locations", venue, { name: "Concurrent planning edit", timezone: "UTC" })]);
  await assert.rejects(() => restart(source.partial, first, stale.token), /destination changed/i);
  await assert.rejects(() => prepare(source.partial, first), /destination changed/i);

  const before = await exportFull();
  const checked = await preview(source.partial);
  assert.notEqual(before.payload.installation_id, source.partial.payload.installation_id);
  assert.deepEqual((await exportFull()).payload.tables, before.payload.tables, "preview leaves the destination unchanged");
  const prepared = await prepare(source.partial, checked);
  assert.equal(prepared.safety_backup.payload.installation_id, before.payload.installation_id);
  assert.deepEqual(prepared.safety_backup.payload.selection, { mode: "backup", sections: ["venues", "households", "food", "other", "wording"], include_logs: true });
  assert.deepEqual(prepared.safety_backup.payload.tables, before.payload.tables, "Full safety download captures all current planning and history");
  assert.equal((await v("SELECT public.admin_preview_event_replacement($1) v", [prepared.safety_backup])).can_restore, true);
  const replacePreview = await v("SELECT public.admin_preview_event_replacement($1) v", [before]);
  const replaceSafety = await v("SELECT public.admin_prepare_event_replacement($1,$2) v", [before, replacePreview.destination_state]);
  await assert.rejects(() => restart(source.partial, checked, replaceSafety.token), /safety backup/i);
  await assert.rejects(() => v("SELECT public.admin_replace_event_data($1,$2,$3) v", [before, "REPLACE " + replacePreview.event_name, prepared.token]), /safety backup/i);
  await assert.rejects(() => restart(source.partial, checked, prepared.token, "REPLACE"), /RESTART/i);

  await db.exec("RESET ROLE; UPDATE public.admins SET access_permissions=app_private.permission_preset('view'); SET ROLE authenticated");
  await assert.rejects(() => preview(source.partial), /permission/i);
  await assert.rejects(() => prepare(source.partial, checked), /permission/i);
  await assert.rejects(() => restart(source.partial, checked, prepared.token), /permission/i);
  await db.exec("RESET ROLE");
  await db.query("UPDATE public.admins SET access_permissions=$1", [auth.admins[0].access_permissions]);
  // Prepare again after the deliberate access changes so the test uses a current receipt.
  await db.exec("SET ROLE authenticated");
  const authorized = await preview(source.partial);
  const safe = await prepare(source.partial, authorized);
  const result = await restart(source.partial, authorized, safe.token);
  assert.equal(result.planning_restarted, true);
  await assert.rejects(() => restart(source.partial, authorized, safe.token), /safety backup/i);
  const after = (await exportFull()).payload.tables;
  assert.equal(after["public.event_settings"][0].event_name, "New planning event");
  assert.equal(after["public.event_settings"][0].website_url, "https://destination.example.invalid");
  assert.equal(after["public.event_settings"][0].is_published, false);
  assert.equal(after["public.event_settings"][0].food_stage, "interest");
  assert.equal(after["public.households"][0].id, source.household);
  assert.equal(after["public.households"][0].invite_code, null);
  assert.equal(after["public.household_session_defaults"].length, 1);
  for (const name of ["invitation_send_queue", "invitation_deliveries", "invitation_delivery_audit", "invitation_shortcut_batches", "rsvp_submissions", "guest_session_responses", "food_claims", "food_items", "other_items"])
    assert.deepEqual(after["public." + name], [], name + " is cleared");
  assert.deepEqual(after["app_private.invitation_code_registry"], before.payload.tables["app_private.invitation_code_registry"], "destination code reservations remain intact");
  const planner = await v("SELECT public.admin_load_data() v");
  assert.deepEqual(planner.invitationTemplates[0].versions.en.message_image, source.picture);
  assert.deepEqual(planner.settings.invitation_picture_album[0].picture, source.picture);
  assert.equal(after["app_private.invitation_snapshots"].length, 1, "draft-only photo dependency is removed");
  assert.deepEqual(after["public.admin_invitations"], before.payload.tables["public.admin_invitations"]);
  await db.exec("BEGIN; RESET ROLE; UPDATE public.event_settings SET is_published=true WHERE id=1");
  const newCode = await v("SELECT invite_code v FROM public.households WHERE id=$1", [source.household]);
  assert.match(newCode, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.ok(![destinationCode, retire].includes(newCode), "publication issues a fresh code without reusing the destination's retired links");
  await db.exec("ROLLBACK");

  const recover = await v("SELECT public.admin_preview_event_replacement($1) v", [safe.safety_backup]);
  assert.equal(recover.can_restore, true, recover.reason);
  const recoveryToken = await v("SELECT public.admin_prepare_event_replacement($1,$2) v", [safe.safety_backup, recover.destination_state]);
  await v("SELECT public.admin_replace_event_data($1,$2,$3) v", [safe.safety_backup, "REPLACE " + recover.event_name, recoveryToken.token]);
  const recovered = (await exportFull()).payload.tables;
  const archived = safe.safety_backup.payload.tables;
  const ordered = rows => rows.map(row => JSON.stringify(row)).sort();
  for (const name of Object.keys(archived).filter(name => name !== "public.backup_restore_audit")) {
    assert.deepEqual(ordered(recovered[name]), ordered(archived[name]), name + " restored from safety file");
  }
  assert.equal(recovered["public.backup_restore_audit"].length, archived["public.backup_restore_audit"].length + 2);
  assert.deepEqual((await v("SELECT public.admin_load_data() v")).invitationTemplates[0].versions.en.message_image, originalPicture);
  assert.equal(await v("SELECT public.admin_has_permission('full') v"), true);
  await db.exec("RESET ROLE");
  const preserved = await readSecurity();
  assert.deepEqual(preserved.users, auth.users);
  assert.deepEqual(preserved.sessions, auth.sessions);
  assert.equal(preserved.admins[0].role, auth.admins[0].role);
  assert.deepEqual(preserved.admins[0].access_permissions, auth.admins[0].access_permissions);
  await db.exec("SET ROLE anon");
  await assert.rejects(() => preview(source.partial), /permission/i);
  await db.exec("SET ROLE authenticated");
  console.log("PASS planning restart replaces populated synthetic data, strips optional drafts and history, keeps access, settings and retired codes, and restores the original event from the downloaded Full safety backup.");
}

(async () => {
  const db = await createDatabase();
  const v = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
  const seal = async backup => ({...backup,checksum:await v("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') v",[backup.payload])});
  const copy = value => JSON.parse(JSON.stringify(value));
  try {
    await signIn(db);
    const venue = await v("SELECT public.admin_save_venue(NULL,$1) v", [{name:"Original venue",timezone:"UTC"}]);
    const group = await v("SELECT planning_config->'groups'->0->>'id' v FROM public.event_settings WHERE id=1");
    const household = await v("SELECT public.admin_save_household(NULL,$1) v", [{household_name:"Sample household",language:"en",planning_group_id:group,notes:"Before testing"}]);
    await db.exec("RESET ROLE");
    await db.query("INSERT INTO public.guests(household_id,first_name,last_name) VALUES($1,'Alex','Example')", [household]);
    const queue = await v("INSERT INTO public.invitation_send_queue(household_id,channel,message_body,created_by) VALUES($1,'manual','Preserve batch snapshot',auth.uid()) RETURNING id v", [household]);
    const batch = await v("INSERT INTO public.invitation_shortcut_batches(mode,created_by,expires_at) VALUES('live',auth.uid(),clock_timestamp()+interval '30 minutes') RETURNING id v");
    await db.query("INSERT INTO public.invitation_shortcut_items(batch_id,queue_id,ordinal,expected_revision) VALUES($1,$2,1,1)", [batch,queue]);
    const attempt = await v("INSERT INTO public.invitation_shortcut_attempts(batch_id,queue_id,attempt_number,state,claim_id) VALUES($1,$2,1,'claimed',gen_random_uuid()) RETURNING id v", [batch,queue]);
    await db.query("INSERT INTO app_private.invitation_shortcut_capabilities(batch_id,token_hash,creator_id,session_id,installation_id,generation,expires_at) SELECT $1,repeat('f',64),auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',o.installation_id,r.generation,clock_timestamp()+interval '30 minutes' FROM app_private.backup_origin o CROSS JOIN app_private.shortcut_runtime r", [batch]);
    await db.query("INSERT INTO app_private.invitation_shortcut_leases(attempt_id,expires_at) VALUES($1,clock_timestamp()+interval '5 minutes')", [attempt]);
    await db.query("INSERT INTO app_private.guest_visit_receipts(installation_id,generation,household_id,session_id) SELECT o.installation_id,s.generation,$1,gen_random_uuid() FROM app_private.backup_origin o CROSS JOIN app_private.guest_visit_scope s", [household]);
    const scopes = await v("SELECT jsonb_build_array((SELECT generation FROM app_private.shortcut_runtime),(SELECT generation FROM app_private.guest_visit_scope)) v");
    await db.exec("SET ROLE authenticated");
    const backup = await v("SELECT public.admin_export_backup() v");
    assert.ok(backup.payload.installation_id);
    const code = backup.payload.tables["public.households"][0].invite_code;
    await db.query("SELECT public.admin_save_venue($1,$2)",[venue, await withRecordRevision(db, "locations", venue, {name:"Changed venue",timezone:"UTC"})]);
    const current = await v("SELECT public.admin_export_backup() v");
    const editorBeforeRestore = await withRecordRevision(db, "households", household, {
      household_name: "Pending stale edit", language: "en", planning_group_id: group,
    });
    const markerBeforeRestore = await v("SELECT public.admin_change_marker() v");
    const clean = await v("SELECT public.admin_preview_backup($1) v",[backup]);
    assert.equal(clean.can_restore,false,"clean recovery still refuses populated destinations");
    const preview = await v("SELECT public.admin_preview_event_replacement($1) v",[backup]);
    assert.equal(preview.can_restore,true,preview.reason);
    assert.equal(await v("SELECT public.admin_change_marker() v"),markerBeforeRestore,"dry run leaves the marker unchanged");
    assert.deepEqual((await v("SELECT public.admin_export_backup() v")).payload.tables,current.payload.tables,"preview rolls all changes back");
    await db.exec("RESET ROLE");
    assert.deepEqual(await v("SELECT jsonb_build_array((SELECT generation FROM app_private.shortcut_runtime),(SELECT generation FROM app_private.guest_visit_scope)) v"),scopes,"preview restores operational generations");
    assert.equal(await v("SELECT count(*)::int v FROM app_private.invitation_shortcut_capabilities"),1);
    await db.exec("SET ROLE authenticated");
    const safety = await v("SELECT public.admin_prepare_event_replacement($1,$2) v",[backup,preview.destination_state]);
    assert.deepEqual(safety.safety_backup.payload.tables,current.payload.tables);
    await assert.rejects(db.query("SELECT public.admin_replace_event_data($1,'wrong',$2)",[backup,safety.token]),/Type REPLACE/);
    const result = await v("SELECT public.admin_replace_event_data($1,$2,$3) v",[backup,"REPLACE "+preview.event_name,safety.token]);
    assert.equal(result.current_access_preserved,true);
    assert.notEqual(await v("SELECT public.admin_change_marker() v"),markerBeforeRestore);
    await assert.rejects(db.query("SELECT public.admin_save_household($1,$2)",[household,editorBeforeRestore]),
      /This record changed since you opened it/,"legacy timestamps in restored profiles do not validate a pre-restore edit");
    const restored = await v("SELECT public.admin_export_backup() v");
    assert.equal(restored.payload.tables["public.event_locations"][0].name,"Original venue");
    assert.equal(restored.payload.tables["public.households"][0].invite_code,code);
    assert.equal(restored.payload.tables["public.event_settings"][0].is_published,false);
    assert.equal(await v("SELECT public.admin_has_permission('full') v"),true);
    assert.equal(await v("SELECT count(*)::int v FROM public.backup_restore_audit"),1);
    assert.equal(await v("SELECT count(*)::int v FROM public.invitation_shortcut_attempts"),1,"durable device history survives replacement");
    await db.exec("RESET ROLE");
    const afterScopes = await v("SELECT jsonb_build_array((SELECT generation FROM app_private.shortcut_runtime),(SELECT generation FROM app_private.guest_visit_scope)) v");
    assert.ok(afterScopes.every((scope,i)=>scope!==scopes[i]));
    for(const table of ['invitation_shortcut_capabilities','invitation_shortcut_leases','guest_visit_receipts','restore_safety_receipts'])assert.equal(await v('SELECT count(*)::int v FROM app_private.'+table),0);
    await db.exec("SET ROLE service_role");
    await assert.rejects(db.query("SELECT public.dispatch_shortcut_batch($1,repeat('f',64),'manifest','{}'::jsonb)",[batch]),/expired|invalid|capability|access|available/i);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(db.query("SELECT public.admin_replace_event_data($1,$2,$3)",[backup,"REPLACE "+preview.event_name,safety.token]),/fresh safety backup/);
    const next = await v("SELECT public.admin_preview_event_replacement($1) v",[backup]);
    const staleSafety = await v("SELECT public.admin_prepare_event_replacement($1,$2) v",[backup,next.destination_state]);
    await db.query("SELECT public.admin_save_venue($1,$2)",[venue, await withRecordRevision(db, "locations", venue, {name:"Concurrent edit",timezone:"UTC"})]);
    await assert.rejects(db.query("SELECT public.admin_replace_event_data($1,$2,$3)",[backup,"REPLACE "+preview.event_name,staleSafety.token]),/Destination changed/);
    const foreign = copy(backup);foreign.payload.installation_id="99999999-9999-4999-8999-999999999999";
    await assert.rejects(db.query("SELECT public.admin_preview_event_replacement($1)",[await seal(foreign)]),/this installation/);
    const malformed = copy(backup);malformed.payload.tables["public.guests"][0].household_id="99999999-9999-4999-8999-999999999999";
    const beforeBad = await v("SELECT public.admin_export_backup() v");
    const bad = await v("SELECT public.admin_preview_event_replacement($1) v",[await seal(malformed)]);
    assert.deepEqual((await v("SELECT public.admin_export_backup() v")).payload.tables, beforeBad.payload.tables);
    assert.equal(bad.can_restore,false);
    assert.equal(await v("SELECT name v FROM public.event_locations WHERE id=$1",[venue]),"Concurrent edit","failed replacement retains destination");
    await testPlanningRestart(db, { venue, household, queue });
    await db.exec("RESET ROLE");
    const auth = await v("SELECT jsonb_agg(to_jsonb(u) ORDER BY id) v FROM auth.users u");
    await db.exec("UPDATE public.event_settings SET is_published=true WHERE id=1;SET ROLE authenticated");
    await assert.rejects(db.query("SELECT public.admin_preview_event_replacement($1)",[backup]),/unpublished/);
    await db.exec("RESET ROLE;UPDATE public.event_settings SET is_published=false WHERE id=1;UPDATE public.admins SET access_permissions=app_private.permission_preset('view');SET ROLE authenticated");
    await assert.rejects(db.query("SELECT public.admin_preview_event_replacement($1)",[backup]),/permission/);
    await db.exec("RESET ROLE");
    assert.deepEqual(await v("SELECT jsonb_agg(to_jsonb(u) ORDER BY id) v FROM auth.users u"),auth);
    assert.equal(await v("SELECT has_table_privilege('authenticated','app_private.restore_safety_receipts','select') v"),false);
    await db.exec("SET ROLE anon");
    await assert.rejects(db.query("SELECT public.admin_preview_event_replacement($1)",[backup]),/permission/);
    console.log("PASS populated replacement/dry-run/rollback, complete safety backup, typed confirmation, stale-state/replay/origin/permission/publication guards, unchanged clean recovery and preserved access/Auth/codes.");
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode=1; });
