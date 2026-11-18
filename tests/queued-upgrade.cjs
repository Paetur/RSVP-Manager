// An explicit prior installer is required. All SQL executes in one disposable DB.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {createDatabase,signIn}=require('./helpers/alpha-database.cjs');
const {build,schemaSql,sha256}=require('../tools/build-queued-upgrade.cjs');
const args=process.argv.slice(2);assert.ok(args.length===2&&args[0]==='--from','Usage: node tests/queued-upgrade.cjs --from /protected/prior-install.sql');
const from=fs.readFileSync(args[1],'utf8'),to=fs.readFileSync('supabase/migrations/20261114034908_alpha_baseline.sql','utf8');
(async()=>{
 const db=await createDatabase({install:false});
 try{
  await db.exec(from);const value=async(sql,params=[])=>(await db.query(sql,params)).rows[0].v;
  const expectedSchemaSha256=await value(schemaSql+' v');
  const options={from,to,expectedFromSha256:sha256(from),expectedSchemaSha256};
  const {sql,manifest}=build(options);
  assert.equal(manifest.privateDdl,3);assert.equal(manifest.newFunctions,8);assert.ok(manifest.existingFunctionGuards>=7);
  assert.ok(!sql.includes('Alpha baseline requires an empty application schema'));
  assert.throws(()=>build({...options,expectedFromSha256:'0'.repeat(64)}),/Source SHA-256 mismatch/);
  assert.throws(()=>build({...options,to:to.replace('CREATE TABLE public.households (','CREATE TABLE public.unknown_households (')}),/Unsupported non-function baseline change/);
  await signIn(db);
  const household=await value('SELECT public.admin_save_household(null,$1) v',[{household_name:'Synthetic queued upgrade',planning_group_id:'general',language:'en'}]);
  await db.query('SELECT public.admin_create_guest($1,$2)',[household,{first_name:'Synthetic',last_name:'Upgrade'}]);
  await db.query('SELECT public.admin_save_delivery(null,$1,$2,null)',[household,{channel:'manual',status:'draft',message_body:'Keep this reviewed snapshot',message_image:{image:'data:image/jpeg;base64,'+fs.readFileSync('tests/fixtures/customization.jpg').toString('base64'),name:'synthetic-queued.jpg',crop:{x:0,y:0,width:3,height:2,sourceWidth:3,sourceHeight:2}}}]);
  await db.exec('RESET ROLE');
  const state=()=>value("SELECT jsonb_build_object('payload',app_private.backup_payload()-'created_at','admins',(SELECT jsonb_agg(to_jsonb(x) ORDER BY user_id) FROM public.admins x),'authUsers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.users x),'authSessions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.sessions x),'installation',(SELECT to_jsonb(x) FROM app_private.backup_origin x),'runtime',(SELECT to_jsonb(x)-'enabled' FROM app_private.shortcut_runtime x)) v");
  const before=await state();
  await assert.rejects(db.exec(sql.replace(/COMMIT;\s*$/,()=>"DO $$ BEGIN RAISE EXCEPTION 'synthetic late queued upgrade';END $$;COMMIT;")),/synthetic late queued upgrade/);await db.exec('ROLLBACK');assert.deepEqual(await state(),before);
  const conflict=sql.replace('BEGIN;\n',()=>"BEGIN;\nCREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql AS $$SELECT ARRAY[]::text[]$$;\n");
  await assert.rejects(db.exec(conflict),/Upgrade source function does not match/);await db.exec('ROLLBACK');assert.deepEqual(await state(),before);
  const drift=sql.replace('BEGIN;\n','BEGIN;\nALTER TABLE public.households ADD COLUMN synthetic_drift text;\n');
  await assert.rejects(db.exec(drift),/schema fingerprint differs/);await db.exec('ROLLBACK');assert.deepEqual(await state(),before);
  await db.exec(sql);assert.deepEqual(await state(),before);assert.equal(await value('SELECT enabled v FROM app_private.shortcut_runtime'),false);
  assert.equal(await value(schemaSql+' v'),expectedSchemaSha256,'43-table backup contract stays byte equivalent');
  await db.exec('SET ROLE authenticated');assert.equal((await value('SELECT public.admin_load_data() v')).settings.apple_shortcuts_enabled,false);await db.exec('RESET ROLE');
  await assert.rejects(db.exec(sql),/already installed or partly applied/);await db.exec('ROLLBACK');assert.deepEqual(await state(),before);
  console.log('PASS exact-source queued upgrade: selected source/hash + unchanged 43-table manifest, explicit three private DDL, required function guards, extra-DDL/source/schema/replay rejection, Auth/data/image/runtime preservation and late-failure rollback.');
 }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
