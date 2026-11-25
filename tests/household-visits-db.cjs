// Qualified visits use disposable synthetic databases; never reads installation config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {randomUUID}=require('node:crypto');
const {createDatabase,signIn}=require('./helpers/alpha-database.cjs');
const value=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0].value;
(async()=>{
 const db=await createDatabase({install:false});
 try {
  for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  if(process.env.RSVP_VISIT_SQL)await db.exec(fs.readFileSync(process.env.RSVP_VISIT_SQL,'utf8'));
  const household=await value(db,"INSERT INTO public.households(household_name,planning_group_id,invite_code) VALUES('Synthetic household','general','ABCDEFGH') RETURNING id value");
  await db.query("INSERT INTO public.guests(household_id,first_name) VALUES($1,'Synthetic')",[household]);
  const other=await value(db,"INSERT INTO public.households(household_name,planning_group_id,invite_code) VALUES('Other synthetic','general','HGFEDCBA') RETURNING id value");
  await db.query("INSERT INTO public.guests(household_id,first_name) VALUES($1,'Other')",[other]);
  await db.query("UPDATE public.households SET invite_code='ABCDEFGH' WHERE id=$1",[household]);
  await db.query("UPDATE public.households SET invite_code='HGFEDCBA' WHERE id=$1",[other]);
  const state=()=>value(db,'SELECT jsonb_build_array(first_visited_at,last_visited_at,visit_count) value FROM public.households WHERE id=$1',[household]);
  const activity=(id=household)=>value(db,'SELECT public.admin_invitation_activity($1) value',[id]);
  await db.exec('UPDATE public.event_settings SET is_published=true;SET ROLE service_role');
  await value(db,'SELECT public.get_invitation_logged($1) value',['ABCDEFGH']);
  await value(db,'SELECT public.get_invitation_logged($1) value',['ABCDEFGH']);
  await assert.rejects(()=>activity(),/permission denied/);
  await db.exec('RESET ROLE');
  assert.deepEqual(await state(),[null,null,0],'raw bootstrap does not qualify a visit');
  assert.equal(await value(db,'SELECT count(*)::int value FROM public.invitation_access_audit'),1,'repeated raw loads within 15 minutes are grouped');
  const rawLoadAt=await value(db,"SELECT to_jsonb(occurred_at) value FROM app_private.administration_log_entries WHERE household_id=$1 AND action='opened'",[household]);
  assert.ok(rawLoadAt,'the same raw load appears in Logs');
  await db.exec('SET ROLE anon');
  await assert.rejects(()=>activity(),/permission denied/);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(()=>activity(),{code:'PT401'});
  await db.exec('RESET ROLE');
  await signIn(db);
  const rawLoads={first_at:rawLoadAt,last_at:rawLoadAt,count:1};
  assert.deepEqual(await activity(),{
   first_visited_at:null,last_visited_at:null,visit_count:0,invitation_loads:rawLoads,
  },'the Main panel can display a raw load without treating it as a verified visit');
  assert.deepEqual(await activity(other),{
   first_visited_at:null,last_visited_at:null,visit_count:0,invitation_loads:{first_at:null,last_at:null,count:0},
  },'another household sees no activity from the first');
  assert.equal(await activity(randomUUID()),null,'an authorized query for a missing household returns null');
  await db.exec('RESET ROLE');
  const session=randomUUID();
  const issue=async(code='ABCDEFGH',sid=randomUUID())=>{await db.exec('SET ROLE service_role');return value(db,'SELECT public.issue_household_visit_receipt($1,$2) value',[code,sid]);};
  const ack=async(receipt,code='ABCDEFGH',sid=receipt.sessionId)=>{await db.exec('SET ROLE service_role');return value(db,'SELECT public.acknowledge_household_visit($1,$2,$3) value',[code,receipt.id,sid]);};
  const receipt=await issue('ABCDEFGH',session);
  assert.deepEqual(await issue('ABCDEFGH',session),receipt,'same bootstrap UUID reuses its receipt');
  assert.equal(await ack(receipt,'HGFEDCBA'),false,'receipt is household scoped');
  assert.equal(await ack(receipt,'ABCDEFGH',randomUUID()),false,'receipt binds the page session');
  assert.equal(await ack(receipt),true);
  assert.equal(await ack(receipt),true,'replay acknowledges without another count');
  await db.exec('RESET ROLE');
  const first=await state();assert.equal(first[2],1);assert.equal(first[0],first[1]);assert.ok(Math.abs(Date.parse(first[1])-Date.now())<10000,'server clock owns timestamps');
  const historicalLoadAt=await value(db,"INSERT INTO public.invitation_access_audit(household_id,created_at) VALUES($1,clock_timestamp()-interval '20 minutes') RETURNING to_jsonb(created_at) value",[household]);
  await db.exec('SET ROLE authenticated');
  const verifiedActivity={
   first_visited_at:first[0],last_visited_at:first[1],visit_count:1,
   invitation_loads:{first_at:historicalLoadAt,last_at:rawLoadAt,count:2},
  };
  assert.deepEqual(await activity(),verifiedActivity,'verified visits and persisted raw loads have independent totals and timestamps');
  await db.exec('RESET ROLE');
  assert.equal(await issue('ABCDEFGH',session),null,'consumed session cannot mint another receipt');
  const reload=await issue();assert.equal(await ack(reload),true);
  await db.exec('RESET ROLE');assert.deepEqual(await state(),first,'another reload is coalesced for fifteen minutes');
  await db.query("UPDATE public.households SET first_visited_at=clock_timestamp()-interval '20 minutes',last_visited_at=clock_timestamp()-interval '16 minutes' WHERE id=$1",[household]);
  const later=await issue();assert.equal(await ack(later),true);
  await db.exec('RESET ROLE');assert.equal((await state())[2],2,'a later qualified visit increments');
  const expired=await issue();await db.exec('RESET ROLE');await db.query("UPDATE app_private.guest_visit_receipts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.id]);assert.equal(await ack(expired),false);
  const unpublished=await issue();await db.exec('RESET ROLE;UPDATE public.event_settings SET is_published=false');assert.equal(await ack(unpublished),false);assert.equal(await issue(),null);
  await db.exec('RESET ROLE;UPDATE public.event_settings SET is_published=true');
  const archived=await issue();await db.exec('RESET ROLE');await db.query('UPDATE public.households SET archived_at=now() WHERE id=$1',[household]);assert.equal(await ack(archived),false);assert.equal(await issue(),null);await db.exec('RESET ROLE');await db.query("UPDATE public.households SET archived_at=null,invite_code='ABCDEFGH' WHERE id=$1",[household]);
  const oldScope=await issue();await db.exec('RESET ROLE;SELECT app_private.revoke_guest_visit_receipts()');assert.equal(await ack(oldScope),false,'restores invalidate old receipts');
  const wrongInstallation=await issue();await db.exec('RESET ROLE;UPDATE app_private.backup_origin SET installation_id=gen_random_uuid()');assert.equal(await ack(wrongInstallation),false,'receipt cannot cross installation scope');
  await db.exec('RESET ROLE');
  assert.equal(await value(db,"SELECT bool_and(relrowsecurity) value FROM pg_class WHERE oid IN ('app_private.guest_visit_scope'::regclass,'app_private.guest_visit_receipts'::regclass)"),true);
  assert.equal(await value(db,"SELECT 'app_private.guest_visit_receipts'=ANY(app_private.backup_tables()) value"),false);
  for(const role of ['anon','authenticated']) {
   await db.exec('SET ROLE '+role);
   await assert.rejects(()=>value(db,'SELECT public.issue_household_visit_receipt($1,$2) value',['ABCDEFGH',randomUUID()]),/permission denied/);
   await assert.rejects(()=>value(db,'SELECT public.acknowledge_household_visit($1,$2,$3) value',['ABCDEFGH',randomUUID(),randomUUID()]),/permission denied/);
   await assert.rejects(()=>db.query('SELECT * FROM app_private.guest_visit_receipts'),/permission denied/);
   await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE authenticated');
  await value(db,'SELECT public.admin_guest_preview($1,false) value',[household]);
  const finalActivity=await activity();
  assert.deepEqual(finalActivity.invitation_loads,verifiedActivity.invitation_loads,'administrator preview adds no raw loads');
  await db.exec('RESET ROLE');assert.equal((await state())[2],2,'administrator preview never qualifies a visit');
  const viewer=randomUUID();
  const viewerSession=randomUUID();
  const permissions=await value(db,"SELECT app_private.permission_preset('custom') value");
  permissions.sections.invites='view';
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'viewer@example.invalid',now())",[viewer]);
  await db.query("INSERT INTO public.admins(user_id,name,access_permissions) VALUES($1,'Viewer',$2)",[viewer,permissions]);
  await db.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[viewerSession,viewer]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[viewer,JSON.stringify({sub:viewer,session_id:viewerSession})]);
  await db.exec('SET ROLE authenticated');
  assert.deepEqual(await activity(),finalActivity,'Invites view is sufficient to read activity');
  await db.exec('RESET ROLE');
  permissions.sections.invites='none';
  permissions.sections.households='view';
  await db.query('UPDATE public.admins SET access_permissions=$2 WHERE user_id=$1',[viewer,permissions]);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(()=>activity(),{code:'42501'});
  await db.exec('RESET ROLE');
  await db.query('DELETE FROM auth.sessions WHERE id=$1',[viewerSession]);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(()=>activity(),{code:'PT401'});
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE service_role');
  for(let n=0;n<10;n++)assert.equal(await value(db,"SELECT public.guest_gateway_allow_request($1,'ABCDEFGH','acknowledge_household_visit') value",['a'.repeat(64)]),true);
  assert.equal(await value(db,"SELECT public.guest_gateway_allow_request($1,'ABCDEFGH','acknowledge_household_visit') value",['a'.repeat(64)]),false,'separate small visit action limit');
  console.log('PASS qualified visits: separate raw audit, scoped/expiring receipts, idempotency, reload coalescing, server times, publication/archive checks, restore revocation, private RLS, service-only writes and permission-gated household activity.');
 } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
