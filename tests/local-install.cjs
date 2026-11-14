// Synthetic configuration and edge requests only. Never calls an API or sends email.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const origin='http://macbookair-rsvp.local:8080';
 function browser(at){const context={URL,URLSearchParams,Intl,Date,window:{location:{href:at+'/setup.html',origin:at}},localStorage:{getItem:()=>null},document:{querySelector:()=>({src:at+'/js/core.js'})}};vm.createContext(context);for(const file of ['js/config.production.js','js/config.js','js/core.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);return context;}
 const local=browser(origin);assert.equal(local.window.RSVP.getClient(),null);assert.equal(local.window.RSVP_CONFIG.supabaseUrl,'');
 assert.equal(local.window.RSVP.normalizeUrl('http://macbookair-rsvp.local:54321'),'http://macbookair-rsvp.local:54321');
 assert.throws(()=>local.window.RSVP.normalizeUrl('http://different.invalid:54321'),/HTTPS/);
 assert.equal(local.window.RSVP.normalizeUrl('http://localhost:54321'),'http://localhost:54321');
 assert.equal(browser('https://example.invalid').window.RSVP.getClient(),null,'a fresh download must not connect to an existing installation');
 assert.equal(browser('https://different.invalid').window.RSVP.getClient(),null);
 assert.throws(()=>browser('https://macbookair-rsvp.local').window.RSVP.normalizeUrl('http://macbookair-rsvp.local:54321'),/HTTPS/);
 const {siteOrigin}=await import('../supabase/functions/_shared/site-origin.mjs');
 for(const invalid of [undefined,'','*','null','https://example.invalid/path','https://user:pass@example.invalid','https://example.invalid?x=1'])assert.throws(()=>siteOrigin(invalid));
 const {invitationHandler}=await import('../supabase/functions/admin-invitations/handler.mjs');
 let redirect='';const service={auth:{getUser:async()=>({data:{user:{id:'synthetic'}}}),admin:{inviteUserByEmail:async(email,options)=>{redirect=options.redirectTo;return {};}}},rpc:async()=>({data:true})};
 const caller={rpc:async()=>({data:{id:'synthetic',attempt_id:'synthetic',email:'synthetic@example.invalid'}})};
 const invitation=invitationHandler({origin,url:'https://synthetic.invalid',serviceKey:'synthetic',createClient:(url,key,options)=>options.global?caller:service});
 const preflight=at=>new Request('https://synthetic.invalid',{method:'OPTIONS',headers:{origin:at}});
 assert.equal((await invitation(preflight(origin))).headers.get('access-control-allow-origin'),origin);
 assert.equal((await invitation(preflight('https://attacker.invalid'))).status,403);
 assert.equal((await invitation(new Request('https://synthetic.invalid',{method:'POST',headers:{origin,authorization:'Bearer aaa.bbb.ccc','content-type':'application/json'},body:JSON.stringify({email:'synthetic@example.invalid',name:'Synthetic'})}))).status,200);
 assert.equal(redirect,origin+'/admin/?admin-invitation=1');
 let gateway;global.Deno={serve:fn=>gateway=fn,env:{get:key=>key==='RSVP_SITE_ORIGIN'?origin:undefined}};
 try{await import('../supabase/functions/guest-gateway/index.ts');
  assert.equal((await gateway(preflight(origin))).headers.get('access-control-allow-origin'),origin);
  assert.equal((await gateway(preflight('https://attacker.invalid'))).status,403);
  assert.equal((await gateway(new Request('https://synthetic.invalid',{method:'POST',headers:{origin},body:'{'}))).status,400);
 }finally{delete global.Deno;}
 console.log('PASS: clean clone, origin-scoped hosted configuration, same-host local HTTP, configured Edge CORS and invitation redirect');
})().catch(error=>{console.error(error);process.exitCode=1;});
