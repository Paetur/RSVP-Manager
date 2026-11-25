// URL/storage/redirect contracts with synthetic URLs and no live API calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const source=fs.readFileSync('js/core.js','utf8'),storage=new Map(),created=[];
 storage.set('rsvp-manager-setup-preview-v1',JSON.stringify({supabaseUrl:'https://old.invalid',supabaseKey:'sb_publishable_old'}));
 function browser(base,page='setup.html'){
  const root=new URL(base),context={URL,URLSearchParams,Intl,Date,atob,window:{location:{href:new URL(page,root).href,origin:root.origin},RSVP_CONFIG:{},supabase:{createClient:(...args)=>{created.push(args);return {};}}},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},document:{querySelector:()=>({src:new URL('js/core.js',root).href})}};
  vm.runInNewContext(source,context);return context.window.RSVP;
 }
 const root=browser('https://site.example.invalid/'),marriage=browser('https://site.example.invalid/marriage/'),other=browser('https://site.example.invalid/other/');
 assert.equal(root.getClient(),null);assert.equal(marriage.getClient(),null,'legacy setup state is not reused');
 marriage.savePreview('https://marriage-api.invalid','sb_publishable_marriage');root.savePreview('https://root-api.invalid','sb_publishable_root');
 assert.equal(other.getClient(),null);assert.equal(marriage.config().supabaseUrl,'https://marriage-api.invalid');
 const admin=browser('https://site.example.invalid/marriage/','admin/');assert.equal(admin.config().supabaseUrl,'https://marriage-api.invalid');
 marriage.getClient();admin.getClient();root.getClient();assert.equal(created[0][2].auth.storageKey,created[1][2].auth.storageKey);assert.notEqual(created[0][2].auth.storageKey,created[2][2].auth.storageKey);
 assert.equal(marriage.invitationURL('ABCDEFGH'),'https://site.example.invalid/marriage/?=ABCDEFGH');assert.equal(admin.guestPreviewURL('sample',true),'https://site.example.invalid/marriage/admin/#guest-preview=sample');assert.equal(admin.guestPreviewURL(),'https://site.example.invalid/marriage/#guest-preview=landing');
 const {siteOrigin,siteURL}=await import('../supabase/functions/_shared/site-origin.mjs');const origin=siteOrigin('https://site.example.invalid');
 assert.equal(siteURL(undefined,origin),origin+'/');assert.equal(siteURL(origin+'/marriage',origin),origin+'/marriage/');assert.equal(siteURL(origin+'/events/marriage/',origin),origin+'/events/marriage/');
 for(const invalid of ['',null,{},'//attacker.invalid/','https://attacker.invalid/marriage/',origin+'/marriage/?x=1',origin+'/marriage/#x','https://user:pass@site.example.invalid/marriage/',origin+'/x/../marriage/',origin+'/x/%2e%2e/marriage/',origin+'/marriage%2fother/',origin+'/marriage//nested/',origin+'/marriage\\other'])assert.throws(()=>siteURL(invalid,origin),undefined,String(invalid));
 const {invitationHandler}=await import('../supabase/functions/admin-invitations/handler.mjs');
 let existing=false,redirect;
 const service={auth:{getUser:async()=>({data:{user:{id:'synthetic'}}}),admin:{inviteUserByEmail:async(email,options)=>{redirect=options.redirectTo;return {};}},signInWithOtp:async(args)=>{redirect=args.options.emailRedirectTo;assert.equal(args.options.shouldCreateUser,false);return {};}},rpc:async()=>({data:true})};
 const caller={rpc:async()=>({data:{id:'synthetic',attempt_id:'synthetic',email:'user@example.invalid',existing_confirmed:existing}})};
 const handler=invitationHandler({origin,siteUrl:origin+'/marriage/',url:'https://api.example.invalid',serviceKey:'synthetic',createClient:(url,key,opts)=>opts.global?caller:service});
 const request=(body={email:'user@example.invalid',name:'Example'},requestOrigin=origin)=>new Request('https://api.example.invalid',{method:'POST',headers:{origin:requestOrigin,authorization:'Bearer aaa.bbb.ccc','content-type':'application/json'},body:JSON.stringify(body)});
 for(existing of [false,true]){assert.equal((await handler(request())).status,200);assert.equal(redirect,origin+'/marriage/admin/?admin-invitation=1');}
 assert.equal((await handler(request(undefined,'https://attacker.invalid'))).status,403);assert.equal((await handler(request({email:'user@example.invalid',name:'Example',siteUrl:'https://attacker.invalid'}))).status,400);
 console.log('PASS subdirectory: installation-scoped connection/Auth state, root/nested URLs, invitation/OTP redirects and exact-origin/forged-target rejection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
