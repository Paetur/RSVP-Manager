// Synthetic accounts and settings only; every served file comes from a public snapshot.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("review-interface-status");
const behavior = `
client.auth.getUser=()=>window.profileRequest();client.auth.updateUser=values=>window.profileRequest(values.data);
window.__noticeWrites=[];
const noticeRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='admin_save_guest_interface'){
  if(window.__holdNotices)await new Promise(resolve=>window.__releaseNotices=resolve);
  if(window.__failNotices){window.__failNotices=false;return {error:{message:'Synthetic notification failure'}};}
  window.__noticeWrites.push(args);fixtures.event_settings[0].guest_interface_modes||={};
  fixtures.event_settings[0].guest_interface_modes[args.p_mode]={...fixtures.event_settings[0].guest_interface_modes[args.p_mode],...args.p_values};return {data:null};
 }
 return noticeRpc(name,args);
};`;
(async () => {
 await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
 const browser = await chromium.launch();
 try {
  for (const width of [1160, 390]) {
   const profile={id:'11111111-1111-4111-8111-111111111111',email:'example@example.invalid',user_metadata:{unrelated:'preserved',rsvp_interface_language:'en',rsvp_interface_appearance:'dark',rsvp_interface_time_format:'24'}};
   const writes=[];let failPreference=false;
   const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width===390}),errors=[];
   page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('rsvp-interface-language','en');});
   await page.exposeFunction('profileRequest',async patch=>{
    if(patch){writes.push(patch);if(failPreference){failPreference=false;return {error:{message:'Synthetic preference failure'}};}Object.assign(profile.user_metadata,patch);}
    return {data:{user:profile}};
   });
   await routeSyntheticSdk(page,mock+'\n'+extra+'\n'+behavior);
   await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
   await page.waitForFunction(()=>document.querySelectorAll('#statsGrid .stat-card').length===4);
   assert.equal(await page.locator('[data-panel=invites] #inviteGroupView').count(),0,'grouping moved out of Invites');
   assert.equal(await page.locator('#inviteShownFieldsHost .invite-shown-fields').count(),1);
   const heading=page.locator('.invite-box-heading'),counts=page.locator('#inviteOverviewCounts');
   assert.ok((await heading.boundingBox()).y < (await counts.boundingBox()).y,'shown fields in header above counts');
   if(width>700){const title=await heading.locator('h2').boundingBox(),fields=await page.locator('#inviteShownFieldsHost').boundingBox();assert.ok(fields.x>title.x+title.width,'shown fields sits on header right');}
   await page.locator('#settingsToggle').click();await page.locator('[data-settings-tab=checklist]').click();
   assert.equal(await page.locator('#invitesAppearanceForm').evaluate(form=>Boolean(form.closest('[data-settings-card=personal-preferences] > .interface-invites-appearance'))),true,'grouping lives inside the Interface box');
   assert.equal(await page.locator('#invitesAppearanceForm').evaluate(form=>!form.parentElement.closest('form')),true,'preference editors are distinct sibling forms');
   await openBox(page,'personal-preferences');
   for(const id of ['interfaceLanguage','themePreference','timeFormat','buttonHover'])assert.equal(await page.locator('#'+id).isVisible(),false,'duplicate dropdown removed: '+id);
   assert.equal(await page.locator('#personalPreferencesForm [data-preference-choices]:visible').count(),4);
   await page.locator('[data-preference-choices=time] [data-preference-choice="12"]').click();
   await openBox(page,'invites-appearance');await page.locator('#inviteGroupView').uncheck();
   assert.equal(await page.evaluate(()=>window.RSVP_ADMIN_PREFERENCES.invitesGrouped),true,'grouping remains saved while draft changes');
   await page.locator('#saveInvitesAppearance').click();await page.locator('#invitesAppearanceStatus[data-state=saved]').waitFor({state:'attached'});
   assert.deepEqual(writes[0],{rsvp_invites_grouped:false});
   assert.equal(await page.locator('#timeFormat').inputValue(),'12','other card draft remains');
   assert.equal(profile.user_metadata.rsvp_interface_time_format,'24','other card not persisted');
   assert.equal(profile.user_metadata.unrelated,'preserved');
   await page.locator('#mainSectionToggle').click();await page.locator('[data-tab=invites]').click();
   assert.equal(await page.locator('#inviteRows .invite-overview-group').count(),0,'saved flat grouping applies');
   await page.locator('#settingsToggle').click();await page.locator('[data-settings-tab=checklist]').click();
   await openBox(page,'invites-appearance');await page.locator('#inviteGroupView').check();await page.locator('#cancelInvitesAppearance').click();
   assert.equal(await page.locator('#inviteGroupView').isChecked(),false);
   await openBox(page,'invites-appearance');await page.locator('#inviteGroupView').check();failPreference=true;
   await page.locator('#saveInvitesAppearance').click();await page.locator('#invitesAppearanceStatus[data-state=error]').waitFor();
   assert.equal(await page.locator('#inviteGroupView').isChecked(),true,'failed preference retains draft');
   assert.equal(await page.evaluate(()=>window.RSVP_ADMIN_PREFERENCES.invitesGrouped),false);
   await page.locator('#saveInvitesAppearance').click();await page.locator('#invitesAppearanceStatus[data-state=saved]').waitFor({state:'attached'});
   assert.equal(await page.evaluate(()=>window.RSVP_ADMIN_PREFERENCES.invitesGrouped),true);
   await page.locator('#cancelPersonalPreferences').click();
   await page.locator('[data-settings-tab=interface]').click();
   const disclosure=page.locator('#notificationSettingsHost');
   assert.equal(await disclosure.locator('details.notification-settings-disclosure').count(),0,'Status messages uses a standard card');
   assert.equal(await disclosure.locator(':scope > .settings-card-heading').isVisible(),true);
   assert.equal(await disclosure.locator(':scope > [role=tablist]').isVisible(),true);
   const pencilGeometry=await page.evaluate(()=>{
    const relative=id=>{const host=document.getElementById(id),pencil=[...host.querySelectorAll('[data-local-edit]')].find(node=>node.getClientRects().length);const card=host.getBoundingClientRect(),button=pencil.getBoundingClientRect();return {top:button.top-card.top,right:card.right-button.right};};
    return {appearance:relative('guestAppearanceHost'),status:relative('notificationSettingsHost')};
   });
   for(const inset of ['top','right'])assert.ok(Math.abs(pencilGeometry.appearance[inset]-pencilGeometry.status[inset])<=1,'matching card pencil '+inset+' inset');
   const wide=page.locator('[data-settings-card="notification-preferences:wide"]'),phone=page.locator('[data-settings-card="notification-preferences:phone"]');
   const selectMode=async mode=>{await page.locator('button[data-notification-mode='+mode+']').click();};
   assert.equal(await wide.isVisible(),true);assert.equal(await phone.isVisible(),false);
   assert.equal(await disclosure.locator('[data-local-edit]:visible').count(),1,'one active header pencil');
   assert.equal(await wide.locator('form').isVisible(),false,'status starts read-only');
   await openBox(page,'notification-preferences:wide');
   await wide.getByRole('group',{name:'Admin',exact:true}).getByRole('radio',{name:'Errors only',exact:true}).check();
   await page.locator('button[data-notification-mode=wide]').focus();await page.keyboard.press('End');
   assert.equal(await phone.isVisible(),true,'keyboard chooses actual Phone');
   await openBox(page,'notification-preferences:phone');
   const guest=phone.getByRole('group',{name:'Guest',exact:true});await guest.getByRole('radio',{name:'Errors only',exact:true}).check();
   await page.evaluate(()=>window.__holdNotices=true);await phone.getByRole('button',{name:'Save',exact:true}).click();
   await page.waitForFunction(()=>!!window.__releaseNotices);
   assert.equal(await page.locator('button[data-notification-mode=wide]').isDisabled(),true,'pending save locks mode switch');
   await page.evaluate(()=>{window.__holdNotices=false;window.__releaseNotices();});
   await page.waitForFunction(()=>window.__noticeWrites.length===1);await page.waitForFunction(()=>!document.getElementById('refreshButton').disabled);
   assert.equal(await phone.isVisible(),true);
   await selectMode('wide');
   assert.equal(await wide.getByRole('group',{name:'Admin',exact:true}).getByRole('radio',{name:'Errors only',exact:true}).isChecked(),true,'other mode draft retained after save');
   await page.evaluate(()=>window.__failNotices=true);await wide.getByRole('button',{name:'Save',exact:true}).click();
   await wide.getByText('Synthetic notification failure',{exact:true}).waitFor();
   await selectMode('phone');await openBox(page,'notification-preferences:phone');
   await phone.getByRole('group',{name:'Guest',exact:true}).getByRole('radio',{name:'All messages',exact:true}).check();
   await phone.getByRole('button',{name:'Save',exact:true}).click();
   await page.waitForFunction(()=>window.__noticeWrites.length===2);await page.waitForFunction(()=>!document.getElementById('refreshButton').disabled);
   await selectMode('wide');await wide.getByText('Synthetic notification failure',{exact:true}).waitFor();
   await refreshFixture(page);await page.waitForFunction(()=>!document.getElementById('refreshButton').disabled);
   await wide.getByText('Synthetic notification failure',{exact:true}).waitFor();
   await wide.getByRole('button',{name:'Save',exact:true}).click();
   await page.waitForFunction(()=>window.__noticeWrites.length===3);await page.waitForFunction(()=>!document.getElementById('refreshButton').disabled);
   assert.deepEqual(await page.evaluate(()=>window.__noticeWrites.map(call=>call.p_mode)),['phone','phone','wide']);
   assert.deepEqual(await page.evaluate(()=>window.__noticeWrites[2].p_expected),{notification_preferences:null},'original scoped optimistic baseline kept');
   await openBox(page,'notification-preferences:wide');
   await wide.getByRole('group',{name:'Admin',exact:true}).getByRole('radio',{name:'All messages',exact:true}).check();
   await wide.getByRole('button',{name:'Cancel',exact:true}).click();
   assert.equal(await wide.locator('form').isVisible(),false);
   assert.equal(await wide.locator('[data-local-edit]').evaluate(node=>node===document.activeElement),true,'Cancel focuses replacement pencil');
   await page.evaluate(()=>{window.__accessPermissions.preset='custom';window.__accessPermissions.sections.settings='view';});
   await refreshFixture(page);await page.waitForFunction(()=>!document.getElementById('refreshButton').disabled);
   assert.equal(await disclosure.locator('[data-local-edit]:visible').count(),0,'view-only has no status pencil');
   assert.equal(await page.evaluate(()=>fixtures.event_settings[0].is_published),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow');
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS Interface choices, independent account grouping Save/Cancel/retry, top-right shown fields, Status actual mode keyboard/drafts/failure/pending/reload/permission/focus at phone and wide widths.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
