// Synthetic Settings/name-preference acceptance; no installation API writes.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {createFoodHarness}=require('./helpers/food-browser-harness.cjs');
const {server,mock,extra}=createFoodHarness('guest-interface');
const seed=`fixtures.households.forEach(h=>h.last_name='Family');fixtures.event_settings[0].guest_title_visibility={en:true,de:false,fo:true};fixtures.event_settings[0].show_repeated_surname=true;window.__nameCalls=[];const priorNameRpc=client.rpc;client.rpc=async(name,args)=>{if(name==='admin_save_guest_name_preferences'){window.__nameCalls.push(args);if(window.__nameFail){window.__nameFail=false;return {error:{message:'Synthetic name save failure'}};}Object.assign(fixtures.event_settings[0],{guest_title_visibility:args.p_titles,show_repeated_surname:args.p_show_repeated_surname});return {data:null};}return priorNameRpc(name,args);};`;
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();try{
for(const width of [390,1160]){const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('rsvp-interface-language','en'));
await page.route('**/supabase.min.js',route=>route.fulfill({contentType:'text/javascript',body:mock+'\n'+extra+'\n'+seed}));
await page.route('**/js/config.js?*',route=>route.fulfill({contentType:'text/javascript',body:'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};'}));
await page.route(/\/(rest|auth|functions)\/v1\//,route=>route.abort());
await page.route('**/admin/',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace(/ integrity="[^"]+"/g,'')})});
await page.goto((process.env.RSVP_TEST_BASE_URL||'http://127.0.0.1:'+server.address().port)+'/admin/');await page.waitForFunction(()=>document.querySelectorAll('#statsGrid .stat-card').length===4);
const firstHousehold = await page.evaluate(() => fixtures.households.find(h => h.id === document.querySelector('#inviteRows [data-invite-household]').dataset.inviteHousehold));
assert.equal(await page.locator('#inviteRows .invite-compact-name').first().innerText(), firstHousehold.household_name + ' Family');
await page.locator('#inviteSearch').fill('Family');assert.ok(await page.locator('#inviteRows [data-invite-household]').count()>0);await page.locator('#inviteSearch').fill('');
await page.locator('#settingsToggle').click();
await page.getByRole('tab',{name:'Interface',exact:true}).click();assert.equal(await page.locator('[data-settings-card="personal-preferences"]').isVisible(),true);assert.equal(await page.locator('#launchChecklist').isVisible(),true);
await page.getByRole('tab',{name:'Guests Interface',exact:true}).click();assert.equal(await page.locator('[data-settings-card="personal-preferences"]').isVisible(),false);const names=page.locator('#guestNamesHost');assert.equal(await names.isVisible(),true);assert.equal(await names.locator('select').count(),0);
await names.getByRole('button',{name:'Edit · Guest titles',exact:true}).click();
const repeated=names.getByRole('checkbox',{name:'Show repeated surname beside each guest',exact:true});assert.equal(await repeated.isChecked(),true);await repeated.uncheck();
const german=names.getByRole('checkbox',{name:'de',exact:true});assert.equal(await german.isChecked(),false);await german.check();
await page.evaluate(()=>window.__nameFail=true);await names.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>window.__nameCalls.length===1);assert.equal(await repeated.isChecked(),false);await names.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>window.__nameCalls.length===2);await page.waitForFunction(()=>!document.querySelector('#guestNamesHost form')?.hasAttribute('aria-busy'));
assert.equal(await page.evaluate(()=>window.__nameCalls[1].p_show_repeated_surname),false);assert.equal(await page.evaluate(()=>window.__nameCalls[1].p_titles.de),true);
await page.locator('#mainSectionToggle').click();await page.locator('[data-tab="households"]').click();assert.ok(await page.getByLabel('Last name',{exact:true}).count()>0);assert.equal(await page.locator('#household-form-' + firstHousehold.id).getByLabel('Name',{exact:true}).inputValue(),firstHousehold.household_name);
await page.locator('#contentLanguagesToggle').click();await page.locator('[data-translation-tab="guests"]').click();assert.equal(await page.locator('[data-translation-record="guest-titles"]').count(),0);
assert.deepEqual(errors,[]);await page.close();}
console.log('PASS Settings relocation, personal/guest separation, checkbox defaults and save/failure/retry, household surname input, removed Languages titles at phone/desktop sizes.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}})().catch(e=>{console.error(e.stack);process.exitCode=1});
