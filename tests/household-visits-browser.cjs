// Actual guest rendering with a synthetic gateway. No live account/event/network API.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFoodHarness}=require('./helpers/food-browser-harness.cjs');
const {server,mock,extra}=createFoodHarness('household-visits');
const behavior=`
window.__visitCalls=[];window.__visitFailure=false;
const visitGateway=client.functions.invoke;
client.functions.invoke=async(name,request)=>{
 const {action,args}=request.body;window.__visitCalls.push({action,args,headers:request.headers,visible:document.visibilityState,prerendering:document.prerendering,rendered:!document.querySelector('#invitationCard').classList.contains('hidden')&&!!document.querySelector('.rsvp-session')});
 if(action==='get_invitation_v2') {const result=await visitGateway(name,request);result.data={...result.data,visitReceipt:{id:'99999999-9999-4999-8999-999999999999',sessionId:args.p_visit_session_id}};return result;}
 if(action==='acknowledge_household_visit') {if(window.__visitFailure)return {error:{message:'Synthetic analytics unavailable'}};return {data:true};}
 return visitGateway(name,request);
};
const visitRpc=client.rpc;client.rpc=async(name,args)=>{if(name!=='admin_guest_preview')return visitRpc(name,args);return {data:{eventData:(await visitRpc('get_public_event_v2')).data,invitation:window.__invite,food:null}};};
`;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try {
  browser=await chromium.launch();
  const base='http://127.0.0.1:'+server.address().port;
  const prepare=async(init)=>{
   const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
   if(init)await page.addInitScript(init);
   await page.route('**/supabase.min.js',route=>route.fulfill({contentType:'text/javascript',body:mock+'\n'+extra+'\n'+behavior}));
   await page.route('**maps.google.com/**',route=>route.fulfill({body:'Synthetic map'}));
   return {page,errors};
  };
  let {page,errors}=await prepare();
  await page.goto(base+'/?=ABCDEFGH');await page.waitForFunction(()=>window.__visitCalls?.some(c=>c.action==='acknowledge_household_visit'));
  const calls=await page.evaluate(()=>window.__visitCalls);
  const ack=calls.find(c=>c.action==='acknowledge_household_visit'),bootstrap=calls.find(c=>c.action==='get_invitation_v2');
  assert.equal(ack.rendered,true,'ack happens after the invitation renders');assert.equal(ack.visible,'visible');assert.equal(ack.args.p_session_id,bootstrap.args.p_visit_session_id);assert.equal(ack.headers.Authorization,'Bearer synthetic-session-token','existing Auth session accompanies real-link visits');
  await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.evaluate(()=>window.__visitCalls.filter(c=>c.action==='acknowledge_household_visit').length),1,'visibility changes do not repeat a successful acknowledgement');assert.deepEqual(errors,[]);await page.close();
  ({page,errors}=await prepare(()=>{window.__syntheticVisibility='hidden';Object.defineProperty(document,'visibilityState',{get:()=>window.__syntheticVisibility});}));
  await page.goto(base+'/?ABCDEFGH');await page.locator('.rsvp-session').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>window.__visitCalls.filter(c=>c.action==='acknowledge_household_visit').length),0,'hidden tab never acknowledges');
  await page.evaluate(()=>{window.__syntheticVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>window.__visitCalls.some(c=>c.action==='acknowledge_household_visit'));assert.deepEqual(errors,[]);await page.close();
  ({page,errors}=await prepare(()=>{window.__syntheticPrerender=true;Object.defineProperty(document,'prerendering',{get:()=>window.__syntheticPrerender});}));
  await page.goto(base+'/?ABCDEFGH');await page.locator('.rsvp-session').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.evaluate(()=>window.__visitCalls.filter(c=>c.action==='acknowledge_household_visit').length),0,'prerender never acknowledges');
  await page.evaluate(()=>{window.__syntheticPrerender=false;document.dispatchEvent(new Event('prerenderingchange'));});await page.waitForFunction(()=>window.__visitCalls.some(c=>c.action==='acknowledge_household_visit'));assert.deepEqual(errors,[]);await page.close();
  ({page,errors}=await prepare(()=>{window.__syntheticVisibility='hidden';Object.defineProperty(document,'visibilityState',{get:()=>window.__syntheticVisibility});}));
  await page.goto(base+'/?ABCDEFGH');await page.locator('.rsvp-session').waitFor();await page.evaluate(()=>{window.__visitFailure=true;window.__syntheticVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>window.__visitCalls.filter(c=>c.action==='acknowledge_household_visit').length===3);
  const attempts=await page.evaluate(()=>window.__visitCalls.filter(c=>c.action==='acknowledge_household_visit').map(c=>c.args));assert.deepEqual(attempts[0],attempts[1]);assert.deepEqual(attempts[1],attempts[2]);
  await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('prerenderingchange'));});assert.equal(await page.evaluate(()=>window.__visitCalls.filter(c=>c.action==='acknowledge_household_visit').length),3,'visibility changes cannot exceed the retry cap');
  assert.equal(await page.locator('#guestStatus.error').count(),0,'analytics failure never becomes page error');assert.deepEqual(errors,[]);await page.close();
  for(const target of ['sample','landing','11111111-1111-4111-8111-111111111111']) {
   ({page,errors}=await prepare());await page.goto(base+'/?ABCDEFGH#guest-preview='+target);await page.locator('#guestEventName').filter({hasText:'Synthetic celebration'}).waitFor();assert.equal(await page.evaluate(()=>window.__visitCalls.length),0,'all administrator preview targets avoid guest visit transport');assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS visit browser: rendered+visible qualification, prerender deferral, existing Auth reuse, stable retry receipt/session, failure isolation and all preview targets suppressed.');
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
