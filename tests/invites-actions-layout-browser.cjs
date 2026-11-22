// Action layout uses public assets and synthetic records only.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { refreshFixture, toggleFixtureTheme, setFixtureInviteRows } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("invites-actions-layout");
const seed = `fixtures.event_settings[0].food_enabled=true;fixtures.event_settings[0].food_stage='interest';`;

async function refresh(page) {
 await refreshFixture(page);
 await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
}

async function geometry(page, count) {
 const row = page.locator("#inviteRows .invite-household > summary").first();
 assert.equal(await row.locator('.invite-create,.invite-share').count(),0,'Invites removes create/share row actions');
 const actions = row.locator(":scope > .invite-row-actions");
 if(!count){
  assert.equal(await actions.count(),0,'published rows have no action column');
  assert.equal(await page.locator('.invite-overview-heading').getByText('Actions',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  return;
 }
 assert.equal(await actions.locator(":scope > *").count(), count);
 const result = await actions.evaluate(node => {
  const strip=node.getBoundingClientRect(),row=node.parentElement.getBoundingClientRect();
  const boxes=[...node.children].map(child=>child.getBoundingClientRect());
  const heading=document.querySelector('.invite-overview-heading').children[[...node.parentElement.children].indexOf(node)];
  return {
   oneLine:boxes.every(box=>Math.abs(box.top-boxes[0].top)<1),
   touch:boxes.every(box=>box.width>=43.5&&box.height>=43.5),
   contained:boxes.every(box=>box.left>=strip.left-1&&box.right<=strip.right+1&&box.left>=row.left-1&&box.right<=row.right+1),
   separated:boxes.every((box,index)=>!index||box.left>=boxes[index-1].right+3),
   aligned:!heading||!heading.getClientRects().length||Math.abs(heading.getBoundingClientRect().left-strip.left)<1,
   pageFits:document.documentElement.scrollWidth<=innerWidth+1,
  };
 });
 assert.equal(result.oneLine,true,'all action controls remain in one row');
 assert.equal(result.touch,true,'action controls retain 44px touch size');
 assert.equal(result.contained,true,'buttons stay inside action strip and household row');
 assert.equal(result.separated,true,'action controls do not overlap');
 assert.equal(result.aligned,true,'Actions heading follows the same optional-column grid');
 assert.equal(result.pageFits,true,'optional columns do not create page overflow');
}

async function toolbarGeometry(page, width) {
 const result=await page.locator('[data-panel=invites]').evaluate(host=>{
  const heading=host.querySelector('.invite-box-heading'),action=host.querySelector('#bulkInvitesHost');
  const sorting=host.querySelector('.invite-sorting'),stats=host.querySelector('#statsGrid');
  const buttons=[...action.querySelectorAll('.bulk-invite-actions > button')];
  const filters=host.querySelector('.invite-overview-filters'),search=host.querySelector('#inviteSearchToggle');
  const controls=[...filters.children];
  const box=node=>node.getBoundingClientRect(),h=box(heading),s=box(search);
  const actionBoxes=[...buttons,search].map(box);
  const buttonsInOrder=actionBoxes.every((current,index)=>!index||
   current.top>=actionBoxes[index-1].bottom-1||
   (current.left>=actionBoxes[index-1].right-1&&Math.abs(current.top-actionBoxes[index-1].top)<2));
  const center=rect=>rect.top+rect.height/2;
  return {adminContainsRows:document.getElementById('adminApp').contains(host.querySelector('#inviteRows')),actionInHeader:heading.contains(action),rightAligned:Math.abs(s.right-h.right)<2,
   sortingBetween:sorting.contains(filters)&&stats.parentElement===sorting.parentElement&&box(stats).bottom<=box(sorting).top+1&&box(sorting).bottom<=h.top+1&&sorting.nextElementSibling.contains(heading),
   sortingOutlined:parseFloat(getComputedStyle(sorting).borderTopWidth)>0,
   actionUnframed:!action.querySelector('fieldset')&&parseFloat(getComputedStyle(action).borderTopWidth)===0,
   searchInHeader:heading.contains(search),buttonsInOrder,
   buttonNames:buttons.map(button=>button.textContent),
   desktopSameLine:actionBoxes.every(current=>Math.abs(center(current)-center(s))<1),
   filterOrder:controls.map(node=>node.id),
   groupTreesInOverview:stats.contains(host.querySelector('#inviteGroupTrees')),
   rowsOutsideSorting:!filters.querySelector('fieldset')};
 });
 assert.equal(result.adminContainsRows,true,'Invites rows stay inside the administrator root');
 assert.equal(result.actionInHeader,true,'Action belongs to the top Invites header');
 assert.equal(result.rightAligned,true,'Search aligns to the right header edge');
 assert.equal(result.sortingBetween,true,'Sorting sits in its own panel below the statistics and directly above Invites');
 assert.equal(result.sortingOutlined,true,'Sorting has its own outline');
 assert.equal(result.actionUnframed,true,'the action buttons have no group outline');
 assert.equal(result.searchInHeader,true,'Search stays in the Invites header');
 assert.deepEqual(result.buttonNames,['Make draft(s)','Make invitation(s)','Mark sent']);
 assert.equal(result.buttonsInOrder,true,'action and Search positions follow toolbar order at '+width+'px');
 if(width>1000)assert.equal(result.desktopSameLine,true,'the desktop toolbar stays on one row');
 assert.deepEqual(result.filterOrder,['inviteShownFieldsHost','inviteLanguageFilter','inviteChannelFilter']);
 assert.equal(result.groupTreesInOverview,true,'group trees are part of the overview');
 assert.equal(result.rowsOutsideSorting,true,'Rows lives in Invites appearance');
 const sorting=page.locator('.invite-sorting');
 const sortingGeometry=()=>sorting.evaluate(node=>{
  const box=node.getBoundingClientRect();
  const header=node.nextElementSibling.querySelector('.invite-box-heading').getBoundingClientRect();
  return { height:box.height, gap:header.top-box.bottom };
 });
 for(const id of ['inviteShownFieldsHost','inviteLanguageFilter','inviteChannelFilter']){
  const menu=page.locator('#'+id+' details');
  const before=await sortingGeometry();
  await menu.locator('summary').press('Enter');
  assert.equal(await menu.locator('.template-choice-menu').evaluate(node=>getComputedStyle(node).position),'absolute');
  assert.deepEqual(await sortingGeometry(),before,'the open menu overlays the page without changing the layout');
  assert.ok(await menu.locator('.template-choice-menu').evaluate(node=>{const b=node.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth+1;}),'overlay fits the page width');
  await page.keyboard.press('Escape');
  assert.equal(await menu.evaluate(node=>node.open),false);
 }
 await page.locator('#inviteSearchToggle').click();
 assert.equal(await page.locator('#inviteSearch').evaluate(node=>node===document.activeElement),true);
 assert.equal(await page.locator('#inviteSearch').evaluate(node=>{const b=node.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth+1&&b.width>0;}),true,'expanded Search input fits the viewport');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'expanded Search causes no horizontal overflow');
 await page.locator('#inviteSearchClose').click();
 assert.equal(await page.locator('#inviteSearchToggle').evaluate(node=>node===document.activeElement),true,'closing Search restores focus to its toolbar control');
}

async function rowsGeometry(page) {
 const rows=page.locator('#inviteRows');
 assert.equal(await rows.getAttribute('data-rows'),'1','fixture selects the one-row presentation');
 const state=()=>page.evaluate(()=>({
  shown:[...document.querySelectorAll('#inviteShownFieldsHost [aria-pressed="true"]')].map(n=>n.dataset.value),
  selected:[...document.querySelectorAll('#inviteRows [data-bulk-select]:checked')].map(n=>n.dataset.bulkSelect),
  calls:window.__calls.length,
 }));
 const fields=page.locator('#inviteShownFieldsHost .invite-shown-fields');
 const toggle=async key=>{if(!await fields.evaluate(node=>node.open))await fields.locator('summary').click();await fields.locator('[data-value="'+key+'"]').click();await page.keyboard.press('Escape');};
 const optionalColumns=['reply','food'];
 await toggle('lastSent');
 const before=await state();
 await setFixtureInviteRows(page,2);
 assert.equal(await rows.getAttribute('data-rows'),'2','the selected screen preference changes the rendered row layout');
 const result=await page.locator('#inviteRows').evaluate(host=>{
  const row=host.querySelector('.invite-household > summary'),primary=row.querySelector('.invite-overview-identity'),name=primary.querySelector('.invite-compact-name'),meta=primary.querySelector('.invite-household-meta'),serviceCell=row.querySelector('.invite-overview-service-info'),recipient=serviceCell.querySelector('.invite-overview-recipient'),service=serviceCell.querySelector('.invite-copy-pill');
  const labels=[...host.querySelectorAll('.invite-overview-heading > span')].map(n=>n.textContent);
  return {inline:!!meta&&!!service&&!!recipient,below:!!meta&&meta.getBoundingClientRect().top>=name.getBoundingClientRect().bottom-1,
   extraColumns:[...row.children].filter(n=>n.matches('.invite-overview-household-info,.invite-overview-recipient,.invite-overview-last-sent,.invite-overview-reply-info')).length,
   headings:labels,service:service?.textContent,pageFits:document.documentElement.scrollWidth<=innerWidth+1,
   fontMatches:getComputedStyle(row.querySelector('.invite-overview-reply')).fontSize===getComputedStyle(name).fontSize};
 });
 assert.equal(result.inline,true,'two-row presentation nests enabled household and service details');
 assert.equal(result.below,true,'household info sits beneath its name');
 assert.equal(result.extraColumns,0,'two rows has no separate secondary detail cells');
 assert.ok(!result.headings.includes('Household info')&&!result.headings.includes('Service info'),'nested details do not retain column headings');
 assert.match(result.service,/^(Messages|Email|WhatsApp|SMS|None)$/,'service detail contains only the service');
 assert.equal(result.pageFits,true,'two-row presentation remains within the viewport');
 assert.equal(result.fontMatches,true,'RSVP font size matches the household row text');
 const twoState=await state();
 assert.deepEqual(twoState.shown,optionalColumns,'choosing two rows enables both optional saved column groups');
 assert.deepEqual(await fields.locator('button[data-value]').evaluateAll(nodes=>nodes.map(node=>node.dataset.value)),optionalColumns,'two-row Shown offers optional paired columns and keeps Household, Service and Invitation mandatory');
 assert.deepEqual({...twoState,shown:before.shown},before,'two rows preserves selection and backend call history');
 for(const [key,selector] of [['reply','.invite-overview-reply'],['food','.invite-overview-interest']]){
  await toggle(key);
  assert.equal(await page.locator('#inviteRows .invite-household > summary > '+selector).count(),0,'hiding a two-row column removes its complete upper/lower pair: '+key);
  assert.ok(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta').count()>0,'Household details remain visible when an optional column is hidden');
  await toggle(key);
 }
 await toggle('reply');
 assert.equal(await page.locator('#inviteRows .invite-household > summary > .invite-overview-reply').count(),0,'RSVP and response detail disappear together as one optional column');
 for(const selector of ['.invite-overview-identity .invite-household-meta','.invite-overview-service-info .invite-copy-recipient','.invite-overview-delivery .invite-copy-invitation'])assert.ok(await page.locator('#inviteRows '+selector).count()>0,'Household, Service and Invitation remain visible: '+selector);
 await refresh(page);assert.equal(await rows.getAttribute('data-rows'),'2','ordinary data refresh preserves the chosen row presentation');
 assert.equal(await page.locator('#inviteRows .invite-household > summary > .invite-overview-reply').count(),0,'temporary optional-column choices survive data refresh');
 assert.ok(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta').count()>0,'data refresh preserves mandatory Household details');
 await setFixtureInviteRows(page,1);
 assert.equal(await rows.getAttribute('data-rows'),'1','returning to one row uses that screen preference');
 assert.deepEqual((await state()).shown,before.shown,'one row restores its earlier field choices instead of temporary two-row choices');
 await setFixtureInviteRows(page,2);
 assert.deepEqual((await state()).shown,optionalColumns,'each transition to two rows restores its saved optional columns');
 await setFixtureInviteRows(page,1);
 assert.deepEqual((await state()).shown,before.shown,'repeated layout switches retain the one-row choices');
 await toggle('lastSent');
 assert.ok(await page.locator('#inviteRows .invite-household > summary > .invite-overview-household-info').count()>0,'one row restores enabled info columns');
 assert.equal(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta,#inviteRows .invite-overview-recipient small').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'one-row presentation remains within the viewport');
}

async function mergedInvitesGeometry(page) {
 const result=await page.locator('[data-panel=invites]').evaluate(host=>{
  const action=host.querySelector('#bulkInvitesHost');
  const buttons=[...action.querySelectorAll('.bulk-invite-actions > button')].map(n=>n.getBoundingClientRect());
  const heading=host.querySelector('#inviteRows .invite-overview-heading');
  const headerSelect=heading.querySelector('[data-bulk-select-all]').closest('label');
  const headerTarget=headerSelect.getBoundingClientRect();
  const rows=[...host.querySelectorAll('#inviteRows .invite-household > summary')];
  return {cards:host.querySelectorAll('#statsGrid .stat-card').length,rows:rows.length,
   controls:!action.querySelector('input[type=checkbox]')&&buttons.length===3,
   headerSelection:heading.lastElementChild.contains(headerSelect)&&headerTarget.width>=43.5&&headerTarget.height>=43.5,
   independent:rows.every(row=>[...row.querySelectorAll('button')].every(button=>!button.closest('label'))),
   selected:rows.every(row=>row.lastElementChild.classList.contains('invite-overview-select')&&row.querySelectorAll('[data-bulk-select]').length===1),
   touch:rows.every(row=>[...row.querySelectorAll('.bulk-invite-select')].every(control=>{const b=control.getBoundingClientRect();return b.width>=43.5&&b.height>=43.5;})),
   compactCopies:rows.every(row=>[...row.querySelectorAll('.invite-copy-recipient,.invite-copy-invitation,.invite-copy-text,.invite-review-action')].every(control=>{
    const b=control.getBoundingClientRect(),pill=control.querySelector('.invite-copy-pill').getBoundingClientRect();
    return b.width>=27.5&&b.height>=27.5&&['left','top','width','height'].every(key=>Math.abs(b[key]-pill[key])<=1);
   })),
   serviceOutsideCopy:rows.every(row=>!row.querySelector('.invite-copy-recipient .invite-overview-recipient')),
   contained:rows.every(row=>{const a=row.getBoundingClientRect();return [...row.children].every(child=>{const b=child.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1;});}),
   duplicate:host.querySelectorAll('.bulk-invite-row,.bulk-invite-list').length,
   outlines:[...host.querySelectorAll('#inviteRows .invite-overview-group')].every(group=>{const style=getComputedStyle(group);return parseFloat(style.borderTopWidth)>0&&parseFloat(style.borderRadius)>0;}),
   pageFits:document.documentElement.scrollWidth<=innerWidth+1};
 });
 assert.equal(result.cards,4,'Invites contains the merged statistics and status cards');assert.ok(result.rows>0);
 assert.equal(result.controls,true,'Action contains three compact buttons without scope checkboxes');
 assert.equal(result.headerSelection,true,'the rightmost heading keeps the Select all touch target');
 assert.equal(result.independent,true,'copy buttons remain outside selection labels');assert.equal(result.selected,true,'one shared checkbox is the rightmost cell');
 assert.equal(result.touch,true,'selection controls retain 44px targets');
 assert.equal(result.compactCopies,true,'copy hit areas match their visible rounded chips with at least28px size');
 assert.equal(result.serviceOutsideCopy,true,'plain contact details remain outside Service copy hit areas');assert.equal(result.contained,true,'shared rows stay contained');
 assert.equal(result.outlines,true,'relational groups use their own outlined boxes');
 assert.equal(result.duplicate,0,'there is no second household list');assert.equal(result.pageFits,true,'merged Invites does not overflow');
}

(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch();
 try {
  for(const width of [1024,1100,1160,1366,1440,820,390,320]){
   const page=await browser.newPage({viewport:{width,height:1050},hasTouch:width<700}),errors=[];
   page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('rsvp-interface-language','en');});
   await routeSyntheticSdk(page,mock+'\n'+extra+'\n'+seed);
   await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
   await page.waitForFunction(()=>document.querySelectorAll('#statsGrid .stat-card').length===4);
   assert.equal(await page.locator('#inviteRows').getAttribute('data-rows'),width>=1024?'2':'1','screen-size defaults choose the row presentation');
   if(width===1024){
    await page.setViewportSize({width:1023,height:1050});
    await page.waitForFunction(()=>document.querySelector('#inviteRows').dataset.rows==='1');
    await page.setViewportSize({width:1024,height:1050});
    await page.waitForFunction(()=>document.querySelector('#inviteRows').dataset.rows==='2');
   }
   await setFixtureInviteRows(page,1);
   await toolbarGeometry(page,width);
   const fields=page.locator('#inviteShownFieldsHost .invite-shown-fields');
   const summary=fields.locator('summary'), selection=summary.locator('.filter-choice-selection');
   const field=key=>fields.locator('button[data-value='+key+']');
   const toggleField=async(key,visible)=>{
    if(!await fields.evaluate(node=>node.open))await summary.click();
    await field(key).click();
    assert.equal(await field(key).getAttribute('aria-pressed'),String(visible));
   };
   assert.doesNotMatch(await selection.innerText(),/Household info/);
   assert.equal(await page.locator('#inviteRows .invite-overview-household-info').count(),0,'household detail starts hidden');
   assert.ok(await page.locator('#inviteRows .invite-overview-service-info .invite-copy-recipient').count()>0,'Service is always present as the contact-value copy chip');
   assert.equal(await field('serviceInfo').count()+await field('delivery').count(),0,'required Service and Invitation are absent from optional Shown choices');
   assert.equal(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta,#inviteRows .invite-overview-recipient small').count(),0,'primary lines no longer contain secondary details');
   await summary.press('Enter');
   assert.equal(await fields.evaluate(node=>node.open),true);
   await field('food').press('Space');await geometry(page,2);
   assert.equal(await field('food').getAttribute('aria-pressed'),'false');
   assert.equal(await page.locator('#inviteRows .invite-overview-heading').getByText('Food interest',{exact:true}).count(),0);
   await page.keyboard.press('Escape');
   assert.equal(await fields.evaluate(node=>node.open),false);
   assert.equal(await summary.evaluate(node=>document.activeElement===node),true);
   await refresh(page);
   assert.doesNotMatch(await selection.innerText(),/Food/);
   await toggleField('food',true);await geometry(page,2);
   assert.equal(await page.locator('#inviteRows .invite-overview-heading').getByText('Food interest',{exact:true}).count(),1);
   for(const key of ['recipient','reply']){
    await toggleField(key,false);await geometry(page,2);
    await toggleField(key,true);await geometry(page,2);
   }
   for(const key of ['recipient','lastSent','reply','replyInfo','food'])await toggleField(key,false);
   assert.equal(await selection.innerText(),'None selected');
   assert.equal(await page.locator('#inviteRows .invite-overview-heading > span').count(),5,'required Household, Service, Invitation, Actions and selection remain');
   for(const key of ['recipient','lastSent','reply','replyInfo','food'])await toggleField(key,true);
   assert.doesNotMatch(await selection.innerText(),/Household info/);
   await toggleField('householdInfo',true);
   assert.equal(await selection.innerText(),'All');
   assert.deepEqual(await page.locator('#inviteRows .invite-overview-heading > span:not(.invite-overview-select)').allTextContents(),['Household','Household info','Recipient','Service','Invitation','RSVP','Food interest','Actions']);
   const detailCells=await page.locator('#inviteRows .invite-household > summary').first().evaluate(row=>({household:row.querySelector('.invite-overview-household-info')?.textContent,service:row.querySelector('.invite-overview-service-info')?.textContent,order:[...row.children].map(node=>node.className)}));
   assert.match(detailCells.household,/guests?.*[A-Z]{2}/,'household details moved into their own cell');
   assert.ok(detailCells.service,'service details are represented independently');
   assert.ok(detailCells.order.findIndex(value=>value.split(' ').includes('invite-overview-household-info'))>detailCells.order.findIndex(value=>value.split(' ').includes('invite-overview-identity')));
   await geometry(page,2);
   if (!await fields.evaluate(node=>node.open)) await summary.click();
   await fields.locator('button[data-multi-select="none"]').click();
   assert.equal(await selection.innerText(),'None selected');
   assert.deepEqual(await page.locator('#inviteRows .invite-overview-heading > span:not(.invite-overview-select)').allTextContents(),['Household','Service','Invitation','Actions']);
   await fields.locator('button[data-multi-select="all"]').click();
   assert.equal(await selection.innerText(),'All');
   await rowsGeometry(page);
   await toggleField('householdInfo',false);
   await page.locator('#inviteSortingHeading').click();
   assert.equal(await fields.evaluate(node=>node.open),false);
   await page.evaluate(()=>{fixtures.event_settings[0].food_stage='selection';});
   await refresh(page);await geometry(page,2);
   assert.equal(await page.locator('#inviteRows .invite-overview-heading').getByText('Food items',{exact:true}).count(),1);
   await toggleField('food',false);await geometry(page,2);await toggleField('food',true);await geometry(page,2);
   await page.evaluate(()=>{
    fixtures.event_settings[0].is_published=true;
    const h=fixtures.households.find(h=>h.id===h2);
    fixtures.invitation_send_queue=[{id:'action-layout-draft',household_id:h.id,channel:'manual',status:'draft',revision:1,created_at:'2026-11-16T12:00:00Z',updated_at:'2026-11-16T12:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_name:'Example',contact_type:'manual',contact_value:'Example'},message_body:'Synthetic invitation '+window.RSVP.invitationURL(h.invite_code)}];
   });
   await refresh(page);await geometry(page,0);
   const review=page.locator('#inviteRows .invite-review-action');
   assert.equal(await review.innerText(),'Review');
   const draft=review.locator('xpath=ancestor::details[@data-invite-household]');
   assert.equal(await draft.locator(':scope > summary [data-invite-copy="invitation"], :scope > summary [data-invite-copy="message"]').count(),0);
   await review.press('Enter');
   const current=draft.locator('.current-invitation [data-delivery-id="action-layout-draft"]');
   assert.ok(await current.evaluate(record=>record.open&&record.closest('[data-invite-household]').open));
   const ready=current.locator('[data-mark-delivery-ready]');
   assert.equal(await ready.evaluate(node=>node===document.activeElement),true,'Review opens the current draft and focuses Make invitation(s)');
   assert.equal(await current.getByRole('button',{name:'Copy message',exact:true}).count(),0);
   assert.equal(await draft.locator(':scope > summary [data-bulk-select]').isChecked(),false,'opening Review does not select the household');

   const row=page.locator('#inviteRows .invite-household > summary').first();
   assert.equal(await row.locator('.invite-preview,.invite-edit-household').count(),0,'published presentation retains eye/edit gates');
   assert.equal(await row.locator('.invite-share,.invite-create').count(),0);
   if(process.env.RSVP_INVITE_PREVIEW_DIR&&[390,820,1366].includes(width)){
    await page.evaluate(()=>{
     const base=fixtures.households.find(h=>h.id===h2);
     const samples=[['Preview email','email','preview@example.invalid','en'],['Preview Messages','messages','+1 (202) 555-0102','de'],['Preview WhatsApp','whatsapp','+1 (202) 555-0103','fo'],['Preview SMS','sms','+1 (202) 555-0104','en']];
     fixtures.invitation_send_queue=[];
     samples.forEach(([name,service,contact,language],index)=>{
      const id=index?crypto.randomUUID():base.id,guest=crypto.randomUUID(),code='MNPQRS2'+(index+2);
      const household=index?{id,household_name:name,primary_guest_id:guest,planning_group_id:base.planning_group_id,relation_group_id:base.relation_group_id,language,invite_code:code,rsvp_state:'open'}:base;
      if(index){fixtures.households.push(household);fixtures.guests.push({id:guest,household_id:id,first_name:'Synthetic',mobile:contact,preferred_contact_method:service==='messages'?null:service});}
      household.invite_code=code;
      fixtures.invitation_send_queue.push({id:crypto.randomUUID(),household_id:id,channel:service==='messages'?'sms':service,status:index%2?'draft':'ready',revision:1,created_at:'2026-11-20T12:00:00Z',updated_at:'2026-11-20T12:00:00Z',invitation_code_snapshot:code,
       recipient_snapshot:{contact_name:'Synthetic contact '+(index+1),contact_type:service==='email'?'email':'phone',contact_value:contact},message_body:'Synthetic invitation for '+name+'\n'+window.RSVP.invitationURL(code)});
     });
    });
    await refresh(page);
    fs.mkdirSync(process.env.RSVP_INVITE_PREVIEW_DIR,{recursive:true,mode:0o700});
    for(const theme of ['light','dark']){
     if(await page.locator('html').getAttribute('data-theme')!==theme)await toggleFixtureTheme(page);
     await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
     await page.screenshot({path:path.join(process.env.RSVP_INVITE_PREVIEW_DIR,'invites-full-'+width+'-'+theme+'.png'),fullPage:true});
     await page.locator('[data-panel=invites]').screenshot({path:path.join(process.env.RSVP_INVITE_PREVIEW_DIR,'invites-'+width+'-'+theme+'.png')});
     if(width===820&&theme==='light'){
      await page.locator('#inviteChannelFilter details summary').click();
      await page.locator('[data-panel=invites]').screenshot({path:path.join(process.env.RSVP_INVITE_PREVIEW_DIR,'invites-services-open-820.png')});
      await page.keyboard.press('Escape');
     }
    }
   }
   const manualHousehold=await page.evaluate(()=>{
    const h=fixtures.households.find(h=>h.id===h2);
    fixtures.invitation_send_queue=[{id:'manual-layout-ready',household_id:h.id,channel:'email',status:'ready',revision:1,created_at:'2026-11-20T12:00:00Z',updated_at:'2026-11-20T12:00:00Z',invitation_code_snapshot:h.invite_code,
     recipient_snapshot:{contact_name:'Synthetic layout recipient',contact_value:'a.very.long.synthetic.recipient.for.the.manual.invitation.layout@example.invalid'},
     message_body:'Synthetic layout invitation '+window.RSVP.invitationURL(h.invite_code)}];
    return h.id;
   });
   await refresh(page);
   await page.locator('[data-tab=invites]').click();
   await page.locator('#bulkInviteContent > .bulk-invite-actions').waitFor();
   await mergedInvitesGeometry(page);
   if(process.env.RSVP_MANUAL_LAYOUT_SCREENSHOT_DIR&&[390,820,1366,1440].includes(width)){
    fs.mkdirSync(process.env.RSVP_MANUAL_LAYOUT_SCREENSHOT_DIR,{recursive:true,mode:0o700});
    await page.locator('#bulkInvitesHost').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(process.env.RSVP_MANUAL_LAYOUT_SCREENSHOT_DIR,'manual-overview-'+width+'.png'),fullPage:true});
    await page.locator('#bulkInvitesHost').screenshot({path:path.join(process.env.RSVP_MANUAL_LAYOUT_SCREENSHOT_DIR,'manual-action-'+width+'.png')});
    // Select the rows that enable each action without invoking either write.
    const missingHousehold=await page.evaluate(()=>{
     const id=crypto.randomUUID(),guest=crypto.randomUUID();
     fixtures.households.push({id,household_name:'Synthetic missing draft',primary_guest_id:guest,language:'en',invite_code:'MNPQRSTU',rsvp_state:'open'});
     fixtures.guests.push({id:guest,household_id:id,first_name:'Synthetic',email:'preview@example.invalid',preferred_contact_method:'email'});
     return id;
    });
    await refresh(page);
    const bulk=page.locator('#bulkInvitesHost'),action=bulk.getByRole('group',{name:'Action',exact:true});
    const ready=page.locator('#inviteRows [data-bulk-select="'+manualHousehold+'"]');
    const missing=page.locator('#inviteRows [data-bulk-select="'+missingHousehold+'"]');
    const generate=action.getByRole('button',{name:'Make draft(s)',exact:true}),mark=action.getByRole('button',{name:'Mark sent',exact:true});
    for(const theme of ['light','dark']){
     if(await page.locator('html').getAttribute('data-theme')!==theme)await toggleFixtureTheme(page);
     await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
     for(const state of ['disabled','generate','mark-sent']){
      await missing.setChecked(state==='generate');
      await ready.setChecked(state==='mark-sent');
      assert.equal(await generate.isEnabled(),state==='generate','selected missing draft controls Generate availability');
      assert.equal(await mark.isEnabled(),state==='mark-sent','selected ready draft controls Mark Sent availability');
      await page.locator('[data-panel=invites]').screenshot({path:path.join(process.env.RSVP_MANUAL_LAYOUT_SCREENSHOT_DIR,'manual-action-'+width+'-'+theme+'-'+state+'.png')});
     }
    }
   }
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS Invites Sorting, toolbar and Review: optional columns, current-draft keyboard focus, publication gates, chip-sized copy targets, independent 44px selection/Rows controls and no overflow at 320/390/820/1024/1100/1160/1366/1440.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
