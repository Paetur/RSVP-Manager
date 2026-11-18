// Destructive acceptance is confined to disposable WASM PostgreSQL fixtures.
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {createDatabase, signIn} = require('./helpers/alpha-database.cjs');
const admin='11111111-1111-4111-8111-111111111111', session='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const {createShortcutFixture} = require('./helpers/shortcut-fixture.cjs');
const value = async (db, sql, args=[]) => (await db.query(sql,args)).rows[0].v;
const owner = db => db.exec('RESET ROLE');
const asAdmin = db => db.exec('SET ROLE authenticated');
async function claims(db,user=admin,sid=session) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:sid})]);
}
async function fresh() {
  const db=await createDatabase();await signIn(db);return db;
}
async function backup(db) {await asAdmin(db);return value(db,'SELECT public.admin_export_backup() v');}
async function preview(db,keep=true) {await asAdmin(db);return value(db,'SELECT public.admin_preview_wipe_all($1) v',[keep]);}
async function prepare(db,keep=true) {const p=await preview(db,keep);return value(db,'SELECT public.admin_prepare_wipe_all($1,$2) v',[keep,p.destination_state]);}
async function wipe(db,prepared,keep=true,confirmation='WIPE') {await asAdmin(db);return value(db,'SELECT public.admin_wipe_all($1,$2,$3) v',[keep,confirmation,prepared.token]);}
const other='22222222-2222-4222-8222-222222222222', otherSession='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', secondSession='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function seed() {
  const f=await createShortcutFixture({count:2}),{db,q,value:v}=f;
  await f.owner();
  await q("INSERT INTO auth.users VALUES($1,'second@example.invalid',now(),'unchanged-password')",[other]);
  await q("INSERT INTO public.admins(user_id,name) VALUES($1,'Other full administrator')",[other]);
  await q('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2),($3,$4)',[otherSession,other,secondSession,admin]);
  await q("INSERT INTO app_private.installation_state(installation_id,schema_version,release_version,installer_hash,site_url,first_admin_id,admin_email,progress,initialized_at) SELECT installation_id,'20261114034908','0.9.0-alpha.7',repeat('f',64),'https://destination.invalid/',$1,'synthetic@example.invalid','{\"completed\":true}',now() FROM app_private.backup_origin",[admin]);
  await db.exec("UPDATE public.event_settings SET is_published=false,website_url='https://destination.invalid/',event_name='Private synthetic event',organizer_name='Synthetic organizer' WHERE id=1");
  await f.asAdmin();
  await q('SELECT public.admin_save_venue(null,$1)',[{name:'Synthetic venue',timezone:'UTC'}]);
  await f.owner();
  return f;
}
async function snapshot(db) {
  await owner(db);
  const tables=await value(db,'SELECT app_private.wipe_all_state() v');
  const auth=await value(db,"SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.users x),'sessions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.sessions x),'revoked',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY session_id),'[]') FROM app_private.admin_session_revocations x),'setup',(SELECT to_jsonb(x) FROM app_private.installation_state x),'scope',(SELECT to_jsonb(x) FROM app_private.shortcut_runtime x)) v");
  return {tables,auth};
}

(async()=>{
  // A new installation is closed until an authorized settings opt-in.
  let db=await fresh();
  try {
    assert.equal((await value(db,'SELECT public.admin_load_data() v')).settings.apple_shortcuts_enabled,false);
    await assert.rejects(db.query('SELECT public.admin_set_shortcuts_enabled(null,false)'),/Choose whether/);
    assert.deepEqual(await value(db,'SELECT public.admin_set_shortcuts_enabled(true,false) v'),{enabled:true});
    assert.equal((await value(db,'SELECT public.admin_load_data() v')).settings.apple_shortcuts_enabled,true);
    await assert.rejects(db.query('SELECT public.admin_set_shortcuts_enabled(false,false)'),/setting changed/);
    const restoreBackup=await backup(db);
    await db.query('SELECT public.admin_restore_backup($1,$2)',[restoreBackup,'RESTORE My event']);
    assert.equal((await value(db,'SELECT public.admin_load_data() v')).settings.apple_shortcuts_enabled,false,'successful recovery returns the experiment to off');
    await db.query('SELECT public.admin_set_shortcuts_enabled(true,false)');
    await owner(db);await db.exec("UPDATE public.admins SET access_permissions=app_private.permission_preset('view')");await asAdmin(db);
    await assert.rejects(db.query('SELECT public.admin_set_shortcuts_enabled(false,true)'),/permission/i);
    await assert.rejects(preview(db),/permission/i);
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT public.admin_set_shortcuts_enabled(false,true)'),/permission/i);
    await assert.rejects(db.query('SELECT public.admin_preview_wipe_all(true)'),/permission/i);
    await owner(db);await db.exec("UPDATE public.admins SET access_permissions=app_private.permission_preset('full')");
    await db.query('INSERT INTO app_private.admin_session_revocations(session_id,user_id,revoked_by) VALUES($1,$2,$2)',[session,admin]);await asAdmin(db);
    await assert.rejects(preview(db),/session|expired/i);
    await assert.rejects(db.query('SELECT public.admin_set_shortcuts_enabled(false,true)'),/session|expired/i);
    // Local Supabase runs safeupdate, which PGlite cannot load.
    await owner(db);
    for (const helper of ['revoke_shortcut_capabilities', 'revoke_guest_visit_receipts']) {
      const definition=await value(db,'SELECT pg_get_functiondef($1::regprocedure) v',['app_private.'+helper+'()']);
      const deletions=definition.match(/^\s*DELETE FROM app_private\.[^;]+;/gmi) || [];
      assert.ok(deletions.length>0,helper);
      for (const deletion of deletions) assert.match(deletion,/\bWHERE \w+ IS NOT NULL;$/i,helper);
    }
  } finally {await db.close();}

  // Disabling stops new work, retaining only authenticated recovery for old claims.
  const f=await createShortcutFixture({count:2});
  try {
    const b=await f.createBatch(f.deliveries),manifest=await f.dispatch(b,'manifest');
    const first=manifest.invitations[0],second=manifest.invitations[1],claim=randomUUID(),event=randomUUID();
    await f.dispatch(b,'claim',{attempt_id:first.attempt_id,claim_id:claim});
    await f.asAdmin();await f.value('SELECT public.admin_set_shortcuts_enabled(false,true) v');
    await assert.rejects(f.createBatch([f.deliveries[1]]),/disabled/i);
    await f.asAdmin();await assert.rejects(f.q("SELECT public.admin_manage_shortcut_batch($1,'renew')",[b.batch_id]),/disabled/i);
    const off=await f.dispatch(b,'manifest');assert.deepEqual(off.invitations,[]);assert.equal(off.statuses.length,2);
    await assert.rejects(f.dispatch(b,'claim',{attempt_id:second.attempt_id,claim_id:randomUUID()}),/disabled/i);
    await assert.rejects(f.dispatch(b,'image',{attempt_id:first.attempt_id}),/disabled/i);
    const result={attempt_id:first.attempt_id,claim_id:claim,event_id:event,channel:'whatsapp',result:'processed',details:{text_action_completed:true,photo_action_completed:true}};
    assert.equal((await f.dispatch(b,'results',result)).accepted,true);
    assert.equal((await f.dispatch(b,'results',result)).idempotent,true);
    await f.owner();assert.equal(await f.value('SELECT count(*)::int v FROM public.invitation_deliveries'),0);
    assert.equal(await f.value('SELECT count(*)::int v FROM public.rsvp_submissions'),0);
    assert.equal(await f.value('SELECT count(*)::int v FROM public.invitation_send_queue WHERE verified_sent_at IS NOT NULL'),0);
    await f.asAdmin();assert.equal((await f.value("SELECT public.admin_manage_shortcut_batch($1,'revoke') v",[b.batch_id])).revoked,true);
  } finally {await f.db.close();}

  // Confirmation, option, expiry, identity and stale-state protection before clear.
  let fixture=await seed();db=fixture.db;
  try {
    await assert.rejects(preview(db,null),/Choose whether/);
    await owner(db);await db.exec('UPDATE public.event_settings SET is_published=true');
    await assert.rejects(preview(db),/Unpublish/);
    await owner(db);await db.exec('UPDATE public.event_settings SET is_published=false');
    let prepared=await prepare(db),before=await snapshot(db);
    assert.ok(prepared.token && prepared.safety_backup && Date.parse(prepared.expires_at)>Date.now());
    assert.equal(prepared.current_counts['public.admins'],2);
    assert.deepEqual(prepared.safety_backup.payload.tables,(await backup(db)).payload.tables);
    await assert.rejects(wipe(db,prepared,true,'wipe'),/Type WIPE/);
    await assert.rejects(wipe(db,prepared,false),/fresh safety backup/);
    await owner(db);await claims(db,admin,secondSession);await assert.rejects(wipe(db,prepared),/fresh safety backup/);
    await owner(db);await claims(db,other,otherSession);await assert.rejects(wipe(db,prepared),/fresh safety backup/);
    await owner(db);await claims(db);assert.deepEqual(await snapshot(db),before);
    await db.query("UPDATE app_private.restore_safety_receipts SET created_at=clock_timestamp()-interval '6 minutes' WHERE id=$1",[prepared.token]);
    await assert.rejects(wipe(db,prepared),/fresh safety backup/);
    prepared=await prepare(db);
    await owner(db);await db.exec("UPDATE public.event_settings SET organizer_name='Concurrent synthetic edit'");
    await assert.rejects(wipe(db,prepared),/Destination changed/);
    prepared=await prepare(db);before=await snapshot(db);
    await db.exec("CREATE FUNCTION pg_temp.fail_wipe_defaults() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic late wipe failure';END$$;CREATE TRIGGER synthetic_wipe_failure BEFORE INSERT ON public.event_languages FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_wipe_defaults();");
    await assert.rejects(wipe(db,prepared),/synthetic late wipe failure/);
    assert.deepEqual(await snapshot(db),before,'late failure rolls back data, revocations, defaults and feature state');
    await db.exec('DROP TRIGGER synthetic_wipe_failure ON public.event_languages');
  } finally {await db.close();}

  // Full reset with or without keeping the requesting administrator.
  for(const keep of [true,false]) {
    fixture=await seed();db=fixture.db;
    try {
      const authBefore=await value(db,"SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.users x),'sessions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.sessions x)) v");
      const adminBefore=await value(db,'SELECT to_jsonb(x) v FROM public.admins x WHERE user_id=$1',[admin]);
      const setupBefore=await value(db,'SELECT to_jsonb(x) v FROM app_private.installation_state x');
      const installation=await value(db,'SELECT installation_id v FROM app_private.backup_origin');
      const codes=await value(db,'SELECT jsonb_agg(to_jsonb(x) ORDER BY code) v FROM app_private.invitation_code_registry x');
      const scopes=await value(db,"SELECT jsonb_build_array((SELECT generation FROM app_private.shortcut_runtime),(SELECT generation FROM app_private.guest_visit_scope)) v");
      const prepared=await prepare(db,keep),result=await wipe(db,prepared,keep);
      assert.equal(result.application_data_cleared,true);assert.equal(result.current_admin_retained,keep);assert.equal(result.sign_out_required,!keep);assert.equal(result.setup_required,!keep);
      await owner(db);
      assert.deepEqual(await value(db,"SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.users x),'sessions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.sessions x)) v"),authBefore);
      assert.equal(await value(db,'SELECT installation_id v FROM app_private.backup_origin'),installation);
      assert.deepEqual(await value(db,'SELECT jsonb_agg(to_jsonb(x) ORDER BY code) v FROM app_private.invitation_code_registry x'),codes,'retired invitation codes cannot be reissued to a new household');
      const afterScopes=await value(db,"SELECT jsonb_build_array((SELECT generation FROM app_private.shortcut_runtime),(SELECT generation FROM app_private.guest_visit_scope)) v");assert.ok(afterScopes.every((id,i)=>id!==scopes[i]));
      assert.equal(await value(db,'SELECT enabled v FROM app_private.shortcut_runtime'),false);
      assert.equal(await value(db,"SELECT test_enabled OR cardinality(test_household_ids)<>0 OR cardinality(test_phones)<>0 v FROM app_private.shortcut_runtime"),false);
      const settings=await value(db,'SELECT to_jsonb(x) v FROM public.event_settings x');
      assert.equal(settings.event_name,'My event');assert.equal(settings.website_url,'https://destination.invalid/');assert.equal(settings.is_published,false);assert.equal(settings.guest_background,null);assert.deepEqual(settings.invitation_picture_album,[]);
      assert.deepEqual((await db.query('SELECT language_code FROM public.event_languages ORDER BY sort_order')).rows.map(x=>x.language_code),['en','fo','de']);
      const counts=await value(db,'SELECT app_private.wipe_all_counts() v');
      for(const [table,count] of Object.entries(counts)) assert.equal(Number(count),table==='public.event_settings'?1:table==='public.event_languages'?3:table==='public.admins'&&keep?1:0,table);
      assert.equal(await value(db,'SELECT count(*)::int v FROM app_private.restore_safety_receipts'),0);
      assert.equal(await value(db,'SELECT count(*)::int v FROM app_private.admin_session_revocations'),keep?2:3);
      if(keep){assert.deepEqual(await value(db,'SELECT to_jsonb(x) v FROM public.admins x'),adminBefore);assert.deepEqual(await value(db,'SELECT to_jsonb(x) v FROM app_private.installation_state x'),setupBefore);await asAdmin(db);assert.equal(await value(db,"SELECT public.admin_has_permission('full') v"),true);await assert.rejects(wipe(db,prepared,keep),/fresh safety backup/);}
      else {assert.equal(await value(db,'SELECT count(*)::int v FROM app_private.installation_state'),0);await asAdmin(db);await assert.rejects(value(db,'SELECT public.admin_load_data() v'),/session|expired|access/i);}
      await owner(db);assert.deepEqual(await value(db,'SELECT public.get_setup_status() v'),{initialized:keep,setup_locked:keep,schema_version:'20261114034908'});
      await claims(db,other,otherSession);await asAdmin(db);await assert.rejects(value(db,'SELECT public.admin_load_data() v'),/session|expired|access/i);
    } finally {await db.close();}
  }
  console.log('PASS experiment default-off/opt-in permissions, disabled claims/images/renewals with results recovery; standalone Wipe all safety backup, option/session/expiry/stale/replay guards, atomic late rollback, retain-both choices, Auth/config/identity/code-ledger preservation and session revocation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
