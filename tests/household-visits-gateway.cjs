// Synthetic edge adapter only; no installation configuration or real network calls.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
(async()=>{
 let handler;const calls=[];let admin=true,authFailure=false,issueFailure=false,invitation=true;
 global.Deno={serve:fn=>handler=fn,env:{get:key=>({RSVP_SITE_ORIGIN:'https://example.invalid',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-legacy-anon-key'})[key]}};
 const originalFetch=global.fetch;
 try {
  global.fetch=async(url,options={})=>{
   const args=options.body?JSON.parse(options.body):null;calls.push({url,args,headers:options.headers});
   if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:randomUUID()}),{status:authFailure?401:200});
   let result=true;
   if(url.endsWith('/is_admin'))result=admin;
   if(url.endsWith('/get_invitation_logged'))result=invitation?{eventData:{event:{is_published:true}},household:{id:randomUUID()}}:null;
   if(url.endsWith('/issue_household_visit_receipt')){if(issueFailure)throw Error('Synthetic unavailable');result={id:randomUUID(),sessionId:args.p_session_id};}
   return new Response(JSON.stringify(result),{status:200});
  };
  await import('../supabase/functions/guest-gateway/index.ts');
  const session=randomUUID();
  const send=(action,args,headers={})=>handler(new Request('https://gateway.invalid',{method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json',...headers},body:JSON.stringify({action,args})}));
  const bootstrap=(headers={})=>send('get_invitation_v2',{p_code:'ABCDEFGH',p_visit_session_id:session},headers);
  let response=await bootstrap();assert.equal(response.status,200);let data=await response.json();assert.equal(data.visitReceipt.sessionId,session);
  assert.deepEqual(calls.find(c=>c.url.endsWith('/get_invitation_logged')).args,{p_code:'ABCDEFGH'},'private bootstrap parameter never reaches raw-load RPC');
  const receipt=data.visitReceipt;
  for(const token of ['sb_publishable_synthetic','synthetic-legacy-anon-key'])assert.ok((await(await bootstrap({authorization:'Bearer '+token})).json()).visitReceipt,'SDK public API keys are eligible without a user session');
  assert.equal((await send('acknowledge_household_visit',{p_code:'ABCDEFGH',p_receipt_id:receipt.id,p_session_id:session})).status,200);
  for(const headers of [{'sec-purpose':'prefetch'},{purpose:'prerender'},{'user-agent':'facebookexternalhit/1.1'},{'user-agent':'Slackbot-LinkExpanding 1.0'}]) {
   assert.equal((await(await bootstrap(headers)).json()).visitReceipt,undefined,'known speculative/bootstrap bot gets no receipt');
   const start=calls.length;
   assert.equal(await(await send('acknowledge_household_visit',{p_code:'ABCDEFGH',p_receipt_id:receipt.id,p_session_id:session},headers)).json(),false);
   assert.ok(!calls.slice(start).some(c=>c.url.endsWith('/acknowledge_household_visit')),'speculative acknowledgments do not reach write RPC');
  }
  assert.equal((await(await bootstrap({authorization:'Bearer signed-admin-token'})).json()).visitReceipt,undefined,'verified active administrator on public link is suppressed');
  const userLookup=calls.find(c=>c.url.endsWith('/is_admin'));assert.equal(userLookup.headers.Authorization,'Bearer signed-admin-token');
  assert.equal(await(await send('acknowledge_household_visit',{p_code:'ABCDEFGH',p_receipt_id:receipt.id,p_session_id:session},{authorization:'Bearer signed-admin-token'})).json(),false);
  admin=false;assert.ok((await(await bootstrap({authorization:'Bearer signed-other-user-token'})).json()).visitReceipt,'verified nonadmin can qualify');
  authFailure=true;assert.equal((await(await bootstrap({authorization:'Bearer stale-user-token'})).json()).visitReceipt,undefined,'unverifiable auth suppresses visits without breaking invitation');authFailure=false;
  issueFailure=true;response=await bootstrap();assert.equal(response.status,200);assert.equal((await response.json()).visitReceipt,undefined);issueFailure=false;
  invitation=false;assert.equal(await(await bootstrap()).json(),null);invitation=true;
  for(const args of [{p_code:'ABCDEFGH',p_visit_session_id:'bad'},{p_code:'ABCDEFGH',p_visit_session_id:session,p_preview:true}])assert.equal((await send('get_invitation_v2',args)).status,400);
  for(const args of [{p_code:'ABCDEFGH',p_receipt_id:receipt.id,p_session_id:session,p_now:new Date().toISOString()},{p_code:'ABCDEFGH',p_receipt_id:'bad',p_session_id:session}])assert.equal((await send('acknowledge_household_visit',args)).status,400);
  assert.equal((await send('acknowledge_household_visit',{p_code:'ABCDEFGH',p_receipt_id:receipt.id,p_session_id:session,p_padding:'x'.repeat(3000)})).status,400);
  console.log('PASS visit gateway: bootstrap receipts, exact request shape, bot/prefetch suppression, active Auth/admin verification, optional failure isolation and server RPC dispatch.');
 } finally {global.fetch=originalFetch;delete global.Deno;}
})().catch(error=>{console.error(error);process.exitCode=1;});
