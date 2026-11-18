// Offline exact-source scaffold for the optional experiment / application-clear change.
// This writes an artifact only. No database connection or installed update occurs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {statements}=require('./build-shortcuts-upgrade.cjs');
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const schemaSql="SELECT encode(sha256(convert_to(jsonb_build_object('tables',to_jsonb(app_private.backup_tables()),'columns',(SELECT jsonb_object_agg(t,app_private.backup_columns(t)) FROM unnest(app_private.backup_tables()) t))::text,'UTF8')),'hex')";
function info(sql){
 const h=sql.match(/^CREATE(?: OR REPLACE)? FUNCTION ((?:public|app_private)\.[a-z_][a-z_0-9]*)\(([\s\S]*?)\) RETURNS\b/);if(!h)return null;
 const b=sql.match(/\bAS (\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)([\s\S]*)\1;$/);assert.ok(b,'Unsupported function body: '+h[1]);
 const types=h[2].trim()?h[2].split(',').map(s=>s.trim().replace(/\s+DEFAULT[\s\S]*$/i,'').replace(/^(?:IN|OUT|INOUT|VARIADIC)\s+/i,'').replace(/^[a-z_][a-z_0-9]*\s+/i,'').replace(/\s+/g,' ')):[];
 return {key:h[1]+'('+types.join(',')+')',body:b[2]};
}
function build({from,to,expectedFromSha256,expectedSchemaSha256}){
 assert.match(expectedFromSha256||'',/^[a-f0-9]{64}$/,'Explicit source SHA-256 required');
 assert.match(expectedSchemaSha256||'',/^[a-f0-9]{64}$/,'Explicit 43-table schema SHA-256 required');
 assert.equal(sha256(from),expectedFromSha256,'Source SHA-256 mismatch');
 const old=statements(from),next=statements(to),changed=[],guards=new Map(),newFunctions=[];
 for(const list of [old,next]){assert.equal(list[0],'BEGIN;');assert.equal(list.at(-1),'COMMIT;');assert.equal(list.filter(s=>/^(?:BEGIN|COMMIT|ROLLBACK);$/.test(s)).length,2);}
 assert.ok(next.length>old.length,'Expected appended scoped functions');
 const changes=new Set();
 for(let i=0;i<old.length-1;i++){
  if(old[i]===next[i])continue;
  const before=info(old[i]),after=info(next[i]);
  if(before&&after&&before.key===after.key){guards.set(before.key,before);changed.push(next[i].replace(/^CREATE FUNCTION /,'CREATE OR REPLACE FUNCTION '));continue;}
  if(old[i].startsWith('CREATE TABLE app_private.shortcut_runtime (')){
   assert.equal(next[i],old[i].replace(' generation uuid NOT NULL DEFAULT gen_random_uuid(),',' generation uuid NOT NULL DEFAULT gen_random_uuid(),\n enabled boolean NOT NULL DEFAULT false,'));changes.add('enabled');continue;
  }
  if(old[i].startsWith('CREATE TABLE app_private.restore_safety_receipts (')){
   assert.equal(next[i],old[i].replace("CHECK (operation IN ('replace','wipe'))","CHECK (operation IN ('replace','wipe','clear'))"));changes.add('clear');continue;
  }
  assert.fail('Unsupported non-function baseline change at '+(i+1)+': '+old[i].slice(0,100));
 }
 assert.deepEqual([...changes].sort(),['clear','enabled']);
 const existing=new Map(old.map(info).filter(Boolean).map(x=>[x.key,x]));
 for(const s of next.slice(old.length-1,-1)){
  assert.ok(/^(?:CREATE FUNCTION|REVOKE|GRANT)\b/.test(s),'Unsupported appended operation: '+s.slice(0,100));
  const f=info(s);if(f){assert.ok(!existing.has(f.key),'Unexpected appended existing function: '+f.key);newFunctions.push(f.key);}changed.push(s);
 }
 assert.equal(newFunctions.length,8,'Expected exactly the reviewed eight new helper/RPC functions');
 for(const key of ['app_private.backup_tables()','app_private.backup_columns(text)']){assert.ok(existing.has(key));guards.set(key,existing.get(key));}
 const required=['public.admin_load_data()','app_private.revoke_shortcut_capabilities()','public.admin_create_shortcut_batch(jsonb,text,boolean)','public.admin_manage_shortcut_batch(uuid,text)','public.dispatch_shortcut_batch(uuid,text,text,jsonb)'];
 for(const key of required)assert.ok(guards.has(key),'Missing required replacement '+key);
 const checks=[...guards.values()].map(f=>" IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure("+literal(f.key)+") AND prosrc="+literal(f.body)+") THEN RAISE EXCEPTION "+literal('Upgrade source function does not match: '+f.key)+";END IF;");
 const absent=newFunctions.map(key=>" IF pg_catalog.to_regprocedure("+literal(key)+") IS NOT NULL THEN RAISE EXCEPTION 'Application queue upgrade is already installed or partly applied';END IF;");
 const sql='-- Installed application update only; do not replay the fresh alpha installer.\n-- Source SHA256 '+expectedFromSha256+'\n-- Target SHA256 '+sha256(to)+'\nBEGIN;\nSET LOCAL lock_timeout=\'10s\';\nSET LOCAL statement_timeout=\'120s\';\nSET LOCAL standard_conforming_strings=on;\nSET LOCAL search_path=\'\';\nSET LOCAL check_function_bodies=false;\nSELECT pg_catalog.pg_advisory_xact_lock(42319,11);\nSELECT pg_catalog.pg_advisory_xact_lock(19421,7744);\nDO $queue_source$\nBEGIN\n IF to_regclass(\'app_private.shortcut_runtime\') IS NULL OR to_regclass(\'app_private.restore_safety_receipts\') IS NULL THEN RAISE EXCEPTION \'Current installed 43-table alpha schema required\';END IF;\n IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=\'app_private.shortcut_runtime\'::regclass AND attname=\'enabled\' AND NOT attisdropped) THEN RAISE EXCEPTION \'Application queue upgrade is already installed or partly applied\';END IF;\n'+absent.join('\n')+'\n'+checks.join('\n')+'\n IF cardinality(app_private.backup_tables())<>43 OR ('+schemaSql+') IS DISTINCT FROM '+literal(expectedSchemaSha256)+" THEN RAISE EXCEPTION 'Installed 43-table schema fingerprint differs from selected source';END IF;\nEND $queue_source$;\n\n"+
  "ALTER TABLE app_private.shortcut_runtime ADD COLUMN enabled boolean NOT NULL DEFAULT false;\nALTER TABLE app_private.restore_safety_receipts DROP CONSTRAINT restore_safety_receipts_operation_check;\nALTER TABLE app_private.restore_safety_receipts ADD CONSTRAINT restore_safety_receipts_operation_check CHECK(operation IN ('replace','wipe','clear'));\n\n"+changed.join('\n\n')+'\n\nCOMMIT;\n';
 return {sql,manifest:{purpose:'application-experiment-clear-scoped-upgrade',sourceSha256:expectedFromSha256,targetSha256:sha256(to),expectedSchemaSha256,upgradeSha256:sha256(sql),existingFunctionGuards:guards.size,newFunctions:newFunctions.length,changedStatements:changed.length,privateDdl:3}};
}
if(require.main===module){try{
 const args=process.argv.slice(2),a={};assert.equal(args.length,10,'Usage: --from PATH --to PATH --expected-from-sha256 SHA --expected-schema-sha256 SHA --out PATH');for(let i=0;i<args.length;i+=2){assert.ok(['--from','--to','--expected-from-sha256','--expected-schema-sha256','--out'].includes(args[i])&&!a[args[i]]);a[args[i]]=args[i+1];}
 const output=path.resolve(a['--out']);assert.ok(!output.startsWith(path.join(path.resolve(__dirname,'..'),'supabase')+path.sep),'Scoped output must remain outside canonical installer/migrations');
 assert.ok(!fs.existsSync(output)&&!fs.existsSync(output+'.json'),'Choose a new explicit output path');const b=build({from:fs.readFileSync(a['--from'],'utf8'),to:fs.readFileSync(a['--to'],'utf8'),expectedFromSha256:a['--expected-from-sha256'],expectedSchemaSha256:a['--expected-schema-sha256']});fs.writeFileSync(output,b.sql,{flag:'wx',mode:0o600});fs.writeFileSync(output+'.json',JSON.stringify(b.manifest,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(b.manifest));
 }catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={build,schemaSql,sha256};
