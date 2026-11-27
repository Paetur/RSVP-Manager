// Actual guest rendering and a viewport transition, using synthetic gateway data.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFoodHarness}=require('./helpers/food-browser-harness.cjs');
const {server,mock,extra}=createFoodHarness('guest-interface-modes');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:511,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const seed=`Object.assign(window.__invite.household,{last_name:'Example',language:'de'});window.__invite.guests[0].courtesy_title='Mr.';
window.__invite.guests.push({id:'beth',first_name:'Beth',last_name:'Example',courtesy_title:'Ms.',name_display_overrides:{show_titles:true,show_repeated_surname:true}});
window.__invite.guests.push({id:'cara',first_name:'Cara',last_name:'Example',courtesy_title:'Daughter',name_display_overrides:{show_titles:false,show_repeated_surname:false}});
window.__invite.invitations.push(...['beth','cara'].map(guest_id=>({...window.__invite.invitations[0],guest_id})));
const modeRpc=client.rpc;client.rpc=async(n,a)=>{const r=await modeRpc(n,a);if(n==='get_public_event_v2')r.data.event.guest_interface_modes={
  phone:{guest_name_layout:'above',guest_show_titles:false,guest_title_visibility:{de:true},show_repeated_surname:false,guest_theme_default:'light',notification_preferences:{guest:{preset:'errors'}}},
  wide:{guest_name_layout:'inline',guest_show_titles:true,guest_title_visibility:{de:true,en:false,fo:true},show_repeated_surname:true,guest_theme_default:'dark',notification_preferences:{guest:{preset:'all'}}},
};return r;};`;
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:mock+'\n'+extra+'\n'+seed}));
  await page.route('**maps.google.com/**',r=>r.fulfill({body:'Synthetic map'}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?=EFGHJKLM');
  const names=page.locator('.rsvp-person-name'),name=names.first();await name.waitFor();
  const allowsSuccess=()=>page.evaluate(()=>window.RSVP_NOTIFICATIONS.allows('guest','success'));
  assert.deepEqual(await names.allInnerTexts(),['Alex','Frau Beth Example','Cara'],'phone master switch and per-guest overrides');
  assert.equal(await page.locator('body').getAttribute('data-guest-name-layout'),'above');
  assert.equal(await name.evaluate(n=>getComputedStyle(n).textAlign),'center');
  assert.equal(await allowsSuccess(),false,'511 px uses the Phone message filter');
  await page.locator('#rsvpRows input[value=attending]').first().check();
  await page.setViewportSize({width:512,height:1000});
  await page.waitForFunction(()=>document.body.dataset.guestNameLayout==='inline');
  assert.deepEqual(await names.allInnerTexts(),['Herr Alex Example','Frau Beth Example','Cara'],'German titles and overrides on Wide');
  assert.equal(await name.evaluate(n=>getComputedStyle(n).textAlign),'left');
  assert.equal(await allowsSuccess(),true,'512 px uses the Wide message filter');
  assert.equal(await page.locator('#rsvpRows input[value=attending]').first().isChecked(),true,'responsive mode changes retain unsaved attendance');
  assert.equal(await page.locator('#rsvpRows fieldset').first().getAttribute('aria-label'),await name.innerText());
  await page.locator('[data-language="en"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.rsvp-person-name')[1]?.innerText==='Ms. Beth Example');
  assert.deepEqual(await names.allInnerTexts(),['Alex Example','Ms. Beth Example','Cara'],'English language switch applies the explicit flag');
  await page.locator('[data-language="fo"]').click();
  await page.waitForFunction(()=>document.querySelector('.rsvp-person-name')?.innerText==='Harra Alex Example');
  assert.deepEqual(await names.allInnerTexts(),['Harra Alex Example','Frú Beth Example','Cara'],'Faroese adult courtesy titles');
  assert.equal(await page.locator('#rsvpRows input[value=attending]').first().isChecked(),true,'language changes retain unsaved attendance');
  await page.setViewportSize({width:511,height:1000});
  await page.waitForFunction(()=>document.body.dataset.guestNameLayout==='above');
  assert.equal(await allowsSuccess(),false,'returning to 511 px restores the Phone message filter');
  assert.equal(await page.locator('#rsvpRows input[value=attending]').first().isChecked(),true,'returning to Phone retains unsaved attendance');
  assert.deepEqual(errors,[]);
  console.log('PASS guest Phone/Wide names, titles, surnames, placement, accessible labels and message filters at 511 and 512 px, with attendance draft retained.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
