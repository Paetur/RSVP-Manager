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
  await db.exec('UPDATE public.event_settings SET is_published=true;SET ROLE service_role');
  await value(db,'SELECT public.get_invitation_logged($1) value',['ABCDEFGH']);
  await db.exec('RESET ROLE');
  assert.deepEqual(await state(),[null,null,0],'raw bootstrap does not qualify a visit');
  assert.equal(await value(db,'SELECT count(*)::int value FROM public.invitation_access_audit'),1,'raw audit remains separate');
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
  await signIn(db);
  await value(db,'SELECT public.admin_guest_preview($1,false) value',[household]);
  await db.exec('RESET ROLE');assert.equal((await state())[2],2,'administrator preview never qualifies a visit');
  await db.exec('SET ROLE service_role');
  for(let n=0;n<10;n++)assert.equal(await value(db,"SELECT public.guest_gateway_allow_request($1,'ABCDEFGH','acknowledge_household_visit') value",['a'.repeat(64)]),true);
  assert.equal(await value(db,"SELECT public.guest_gateway_allow_request($1,'ABCDEFGH','acknowledge_household_visit') value",['a'.repeat(64)]),false,'separate small visit action limit');
  console.log('PASS qualified visits: separate raw audit, scoped/expiring receipts, idempotency, reload coalescing, server times, publication/archive checks, restore revocation, private RLS and service-only grants.');
 } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
