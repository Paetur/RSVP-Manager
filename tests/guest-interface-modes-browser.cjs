// Actual guest rendering and a viewport transition, using synthetic gateway data.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFoodHarness}=require('./helpers/food-browser-harness.cjs');
const {server,mock,extra}=createFoodHarness('guest-interface-modes');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const seed=`window.__invite.household.last_name='Example';window.__invite.guests[0].courtesy_title='Son';
const modeRpc=client.rpc;client.rpc=async(n,a)=>{const r=await modeRpc(n,a);if(n==='get_public_event_v2')r.data.event.guest_interface_modes={phone:{guest_name_layout:'above',guest_title_visibility:{de:false},show_repeated_surname:false,guest_theme_default:'light'},wide:{guest_name_layout:'inline',guest_title_visibility:{de:true},show_repeated_surname:true,guest_theme_default:'dark'}};return r;};`;
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:mock+'\n'+extra+'\n'+seed}));
  await page.route('**maps.google.com/**',r=>r.fulfill({body:'Synthetic map'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?=EFGHJKLM');
  const name=page.locator('.rsvp-person-name').first();await name.waitFor();
  assert.equal(await name.innerText(),'Alex');
  assert.equal(await page.locator('body').getAttribute('data-guest-name-layout'),'above');
  assert.equal(await name.evaluate(n=>getComputedStyle(n).textAlign),'center');
  await page.locator('#rsvpRows input[value=attending]').check();
  await page.setViewportSize({width:1160,height:1000});
  await page.waitForFunction(()=>document.body.dataset.guestNameLayout==='inline');
  assert.match(await name.innerText(),/Sohn Alex Example/);
  assert.equal(await name.evaluate(n=>getComputedStyle(n).textAlign),'left');
  assert.equal(await page.locator('#rsvpRows input[value=attending]').isChecked(),true,'responsive mode changes retain unsaved attendance');
  assert.equal(await page.locator('#rsvpRows fieldset').first().getAttribute('aria-label'),await name.innerText());
  assert.deepEqual(errors,[]);
  console.log('PASS guest Phone/Wide names, titles, surnames, placement and accessible labels; viewport transition retains attendance draft.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
