// Actual Auth SDK and protected bootstrap SQL against disposable data only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { LocalAdministratorInstallation } from "../setup-service/local-administrator.ts";
import { installationAssets } from "../setup-service/installation.ts";
const require=createRequire(import.meta.url), {fixture}=require("./helpers/setup-management-fixture.cjs");
const assets=installationAssets(process.cwd()), password="Synthetic local setup password!";
const f=await fixture({installed:true});
const config={target:"local",projectUrl:"http://127.0.0.1:54321",publicKey:f.config.publicKey,serviceKey:f.config.serviceKey,siteUrl:"http://localhost:8080/",databaseUrl:"postgresql://postgres:synthetic@127.0.0.1:54322/postgres"};
const query=async(sql,parameters=[])=>{try{return parameters.length?(await f.db.query(sql,parameters)).rows:(await f.db.exec(sql)).at(-1)?.rows||[];}catch(error){await f.db.exec("ROLLBACK").catch(()=>{});throw error;}};
const transport=(input,init)=>{const url=new URL(typeof input==="string"?input:input.url||String(input));url.protocol="https:";url.host=new URL(f.config.projectUrl).host;return f.fetcher(url.href,init);};
const create=(fetcher=transport)=>new LocalAdministratorInstallation(config,assets,fetcher,query);
try{
 for(const change of [{projectUrl:"https://cloud.example.invalid"},{databaseUrl:"postgresql://postgres:synthetic@127.0.0.1/db?host=attacker.invalid"},{databaseUrl:"postgresql://postgres:synthetic@192.0.2.1/db"},{serviceKey:config.publicKey},{publicKey:config.serviceKey}])
  assert.throws(()=>new LocalAdministratorInstallation({...config,...change},assets,f.fetcher,query));
 const locked=create(async(input,init)=>String(input).includes("/rpc/get_setup_status")?new Response('{"initialized":true,"setup_locked":true}',{headers:{"Content-Type":"application/json"}}):transport(input,init));
 await assert.rejects(()=>locked.connect(),/checkpoints differ/);
 assert.equal(f.state.created,0,"API already locked cannot create any Auth account");
 await f.db.query("INSERT INTO public.households(household_name,planning_group_id,language) VALUES('Synthetic existing household','general','en')");
 await assert.rejects(()=>create().connect(),/already contains data/);
 assert.equal(f.state.created,0,"populated no-admin event cannot create an Auth account");
 await f.db.exec("DELETE FROM public.households");
 let install=create();await install.connect();assert.equal(install.publicState().local,true);
 await assert.rejects(()=>install.run("administrator",{email:"owner@example.invalid",password}),/preceding/);
 await install.run("database");
 assert.equal((await f.db.query("SELECT count(*)::int AS n FROM public.admins")).rows[0].n,0);
 f.state.loseCreate=true;
 await assert.rejects(()=>install.run("administrator",{email:"owner@example.invalid",password}),/could not be created/);
 assert.equal(f.state.created,1);
 install=create();await install.connect();
 await assert.rejects(()=>install.run("administrator",{email:"owner@example.invalid",password:"wrong-password"}),/sign-in failed/);
 assert.equal((await f.db.query("SELECT count(*)::int AS n FROM public.admins")).rows[0].n,0);
 await install.run("administrator",{email:"owner@example.invalid",password});
 const calls=f.calls.length;
 await install.run("administrator",{email:"other@example.invalid",password});
 assert.equal(f.state.created,1,"completed first-admin creation stays closed");
 assert(!f.calls.slice(calls).some(call=>call.path.includes("/auth/")),"closed first-admin step never contacts Auth");
 await assert.rejects(()=>install.run("verification"),/runtime probe/);
 assert.equal(install.publicState().initialized,false);
 f.secrets.set("RSVP_SITE_ORIGIN","http://localhost:8080");
 await install.run("verification");
 assert.equal(install.publicState().initialized,true);
 const final=(await f.db.query("SELECT initialized_at,admin_email FROM app_private.installation_state")).rows[0];
 assert(final.initialized_at);assert.equal(final.admin_email,null);
 for(const step of ["database","administrator","verification"])await install.run(step,{email:"second@example.invalid",password});
 assert.equal(f.state.created,1);
 const reopened=create();await reopened.connect();assert.equal(reopened.publicState().existingInstallation,true);
 const exposed=JSON.stringify(reopened.publicState());
 assert(!exposed.includes(config.serviceKey));assert(!exposed.includes(config.databaseUrl));assert(!exposed.includes(password));
 assert.equal((await f.db.query("SELECT is_published FROM public.event_settings")).rows[0].is_published,false);
 const mismatch=await fixture({installed:true});
 try{
  const mismatchTransport=(input,init)=>{const url=new URL(typeof input==="string"?input:input.url||String(input));url.protocol="https:";url.host=new URL(mismatch.config.projectUrl).host;return mismatch.fetcher(url.href,init);};
  const mismatchQuery=async(sql,parameters=[])=>{
    if(sql.startsWith("SELECT id,email,email_confirmed_at"))return [];
    try{return parameters.length?(await mismatch.db.query(sql,parameters)).rows:(await mismatch.db.exec(sql)).at(-1)?.rows||[];}catch(error){await mismatch.db.exec("ROLLBACK").catch(()=>{});throw error;}
  };
  const wrongDatabase=new LocalAdministratorInstallation(config,assets,mismatchTransport,mismatchQuery);
  await wrongDatabase.connect();await wrongDatabase.run("database");
  await assert.rejects(()=>wrongDatabase.run("administrator",{email:"owner@example.invalid",password}),/does not match the database/);
  assert.equal((await mismatch.db.query("SELECT count(*)::int AS n FROM public.admins")).rows[0].n,0,"mismatched Auth row cannot obtain administrator access");
 }finally{await mismatch.db.close();}
 console.log("PASS Local first-admin: real Auth SDK create/login, protected PG grant, lost response retry, wrong-password rejection, locked/mismatched API guard, loopback URL bounds, closed creation, verification retry and initialized reopen; no real backend.");
}finally{await f.db.close();}
