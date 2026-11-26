// Action layout uses public assets and synthetic records only.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { refreshFixture, toggleFixtureTheme, setFixtureInviteRows, ensureInviteSelection } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("invites-actions-layout");
const seed = `
 fixtures.event_settings[0].food_enabled=true;
 fixtures.event_settings[0].food_stage='interest';
 const readyHousehold=fixtures.households.find(h=>h.id===h2);
 readyHousehold.food_interest=true;
 fixtures.invitation_send_queue.push({
  id:'action-layout-earlier-sent',household_id:readyHousehold.id,channel:'manual',status:'sent',
  revision:1,created_at:'2026-11-14T12:00:00Z',updated_at:'2026-11-14T18:00:00Z',
  invitation_code_snapshot:readyHousehold.invite_code,message_body:'Earlier synthetic invitation',
 });
 fixtures.invitation_send_queue.push({
  id:'action-layout-ready',household_id:readyHousehold.id,channel:'manual',status:'ready',
  revision:1,created_at:'2026-11-15T12:00:00Z',updated_at:'2026-11-15T12:00:00Z',
  invitation_code_snapshot:readyHousehold.invite_code,message_body:'Synthetic ready invitation',
  recipient_snapshot:{contact_name:'Example',contact_type:'manual',contact_value:'Example'},
 });
`;

async function refresh(page) {
 await refreshFixture(page);
 await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
}

async function assertRightmostSelection(page) {
 const aligned = await page.locator('#inviteRows .invite-household > summary').evaluateAll(rows => rows.every(row => {
  const checkbox = row.querySelector('[data-bulk-select]')?.closest('label');
  const box = row.getBoundingClientRect(), style = getComputedStyle(row);
  const inset = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth);
  return checkbox && Math.abs(checkbox.getBoundingClientRect().right - (box.right - inset)) <= 1;
 }));
 assert.equal(aligned,true,'selection labels align to the far right of every row');
}

async function tabletInlineActions(page) {
 const host = page.locator('#inviteRows');
 const household = host.locator('.invite-household').first();
 const row = household.locator(':scope > summary');
 const inline = row.locator('.invite-preview,.invite-edit-household');
 const expanded = household.locator('.invite-expanded-actions .invite-preview,.invite-expanded-actions .invite-edit-household');
 const select = page.locator('#inviteSelectionToggle');
 const configure = async (showInlineActions, showActions, rows) => {
  await page.evaluate(profile => { window.__fixtureInviteProfiles = { tablet: profile }; }, { showInlineActions, showActions });
  await setFixtureInviteRows(page, rows);
 };
 await setFixtureInviteRows(page, 2);
 assert.equal(await inline.count(), 0, 'Tablet two-row actions are off by default');
 assert.equal(await expanded.count(), 2, 'the existing Expanded household setting remains active');
 await configure(true, true, 2);
 assert.equal(await inline.count(), 2);
 assert.equal(await expanded.count(), 2);
 assert.equal(await inline.first().getAttribute('href'), await expanded.first().getAttribute('href'));
 await assertRightmostSelection(page);
 await select.press('Enter');
 assert.equal(await host.locator('[data-bulk-select], .invite-overview-heading > .invite-overview-select').count(), 0);
 await select.press('Enter');
 await assertRightmostSelection(page);
 const fits = await host.locator('.invite-household > summary').evaluateAll(rows => rows.every(row => {
  const controls = row.querySelector('.invite-overview-select');
  const actions = [...controls.querySelectorAll('.admin-row-icon')].map(node => node.getBoundingClientRect());
  const checkbox = controls.querySelector('.bulk-invite-select').getBoundingClientRect();
  const cells = [...row.children];
  return actions.length === 2 && actions.every(action => action.width >= 43.5 && action.height >= 43.5) &&
   actions[0].right <= actions[1].left && actions[1].right <= checkbox.left &&
   cells.every(cell => cell.scrollWidth <= cell.clientWidth + 1) && document.documentElement.scrollWidth <= innerWidth + 1;
 }));
 assert.equal(fits, true, 'Tablet action targets, selection and the two-row field text fit together');

 const edit = row.locator('.invite-edit-household');
 await edit.press('Enter');
 const dialog = page.locator('dialog.household-details-dialog[open]');
 await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
 await dialog.waitFor({ state: 'hidden' });
 await edit.and(page.locator(':focus')).waitFor();

 await configure(true, false, 2);
 assert.equal(await inline.count(), 2);
 assert.equal(await expanded.count(), 0, 'inline actions respect the independent expanded preference');
 await page.evaluate(() => { fixtures.event_settings[0].is_published = true; });
 await refresh(page);
 assert.equal(await row.locator('.invite-preview').count(), 1);
 assert.equal(await row.locator('.invite-edit-household').count(), 0);
 await assertRightmostSelection(page);
 await page.evaluate(() => { fixtures.event_settings[0].is_published = false; });
 await refresh(page);
 await configure(true, true, 1);
 assert.equal(await inline.count(), 0, 'the Tablet preference applies only while 2 Row is active');
 assert.equal(await expanded.count(), 2);
 await configure(false, true, 1);
}

async function geometry(page, published = false) {
 const rows = page.locator('#inviteRows'), household = rows.locator('.invite-household').first();
 const row = household.locator(':scope > summary');
 const desktop = await rows.getAttribute('data-screen') === 'desktop';
 assert.equal(await row.locator('.invite-create,.invite-share,.invite-row-actions').count(),0);
 assert.equal(await page.locator('.invite-overview-heading').getByText('Actions',{exact:true}).count(),0);
 const selection = row.locator('.invite-overview-select');
 const open = await household.evaluate(node => node.open);
 if (!desktop) {
  assert.equal(await selection.locator('.invite-preview,.invite-edit-household').count(),0);
  if (!open) await household.evaluate(node => { node.open = true; });
 }
 const actions = desktop ? selection : household.locator('.invite-expanded-actions');
 assert.equal(await actions.locator('.invite-preview + .invite-edit-household').count(),published?0:1);
 assert.equal(await actions.locator('.invite-preview').count(),1);
 assert.equal(await actions.locator((published ? '.invite-preview' : '.invite-edit-household') + ' + .bulk-invite-select').count(),desktop?1:0);
 const result = await actions.evaluate((node, desktop) => {
  const line=node.getBoundingClientRect();
  const controls=[...node.querySelectorAll('.invite-preview,.invite-edit-household')];
  const boxes=controls.map(control=>control.getBoundingClientRect());
  const checkbox=node.querySelector('[data-bulk-select]')?.getBoundingClientRect();
  const touch=!desktop||matchMedia('(pointer: coarse)').matches;
  return {
   touch:!touch||boxes.every(box=>box.width>=43.5&&box.height>=43.5),
   sameSize:boxes.every(box=>box.width===boxes[0].width&&box.height===boxes[0].height),
   contained:boxes.every(box=>box.left>=line.left-1&&box.right<=line.right+1),
   round:controls.every(control=>getComputedStyle(control).borderRadius==='50%'),
   aligned:boxes.every(box=>Math.abs((box.top+box.bottom)-(boxes[0].top+boxes[0].bottom))<=2 &&
    (!checkbox || box.right < checkbox.left && Math.abs((box.top+box.bottom)-(checkbox.top+checkbox.bottom))<=2)),
   pageFits:document.documentElement.scrollWidth<=innerWidth+1,
  };
 }, desktop);
 if (!desktop && !open) await household.evaluate(node => { node.open = false; });
 assert.deepEqual(result,{touch:true,sameSize:true,contained:true,round:true,aligned:true,pageFits:true},'round controls fit in their action area and retain their touch targets');
 await assertRightmostSelection(page);
}

async function toolbarGeometry(page, width) {
 const heading=page.locator('.invite-box-heading'), selection=heading.locator('#bulkInviteContent');
 const status=heading.locator('#bulkInviteStatus'), hint=status.locator('#bulkInviteHint');
 const select=page.locator('#inviteRows [data-bulk-select]:enabled').first();
 const mode=heading.locator('#inviteSelectionToggle');
 assert.equal(await selection.isVisible(),false,'the action strip is hidden while browsing');
 assert.equal(await hint.isVisible(),true,'unpublished guidance remains visible without a selection');
 assert.equal(await heading.locator('#inviteSearchPanel').isVisible(),false,'the Search field starts collapsed');
 assert.equal(await page.locator('#inviteRows [data-bulk-select-all],#inviteRows #inviteSelectionCount').count(),0,'selection controls stay hidden while browsing');
 await mode.press('Enter');
 assert.equal(await mode.getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('#inviteSelectionCount').innerText(),/^0\//);
 await select.check();
 assert.equal(await selection.locator('.bulk-invite-count').innerText(),'1 selected');
 assert.deepEqual(await selection.locator('.bulk-invite-actions button').allTextContents(),['Make draft(s)','Make invitation(s)','Mark sent']);
 const result=await page.locator('[data-panel=invites]').evaluate(host=>{
  const heading=host.querySelector('.invite-box-heading'),toolbar=host.querySelector('.invite-heading-toolbar');
  const stats=host.querySelector('#statsGrid'),overview=host.querySelector('#overviewPanel');
  const overviewControls=['#inviteGroupTrees','#inviteSessionTree','#inviteLanguageFilter','#inviteChannelFilter'];
  const box=node=>node.getBoundingClientRect(), h=box(heading), title=box(host.querySelector('.invite-heading-title'));
  const group=box(host.querySelector('#inviteQuickGrouping summary')), view=box(host.querySelector('#inviteShownFieldsHost summary')), select=box(host.querySelector('#inviteSelectionToggle'));
  const action=box(host.querySelector('#bulkInvitesHost'));
  const icon=box(host.querySelector('#inviteSearchToggle')), rows=box(host.querySelector('#inviteRows'));
  const status=box(host.querySelector('#bulkInviteStatus'));
  return {
   adminContainsRows:document.getElementById('adminApp').contains(host.querySelector('#inviteRows')),
   statsBeforeInvites:box(overview).bottom<=h.top+1&&overview.contains(stats)&&!host.querySelector('.invite-sorting'),
   desktop:title.right<=group.left+1&&Math.abs(box(toolbar).top+box(toolbar).height/2-title.top-title.height/2)<2,
   narrow:title.bottom<=group.top+1,
   groupingBesideView:Math.abs(group.top-view.top)<2&&view.left>=group.right-1&&view.left-group.right<=12&&group.height>=44,
   compact:[view,select,icon].every((item,i,items)=>Math.abs(item.top-view.top)<2&&(!i||item.left>=items[i-1].right-1&&item.left-items[i-1].right<=12)),
   rightAligned:Math.abs(icon.right-h.right)<2&&icon.right<=innerWidth+1,
   actionBelow:Math.abs(action.left-h.left)<2&&Math.abs(action.right-h.right)<2&&action.top>=box(toolbar).bottom-1&&rows.top>=action.bottom-1,
   statusBelow:status.top>=box(host.querySelector('.bulk-invite-actions')).bottom-1,
   overviewControls:overviewControls.every(selector=>stats.contains(host.querySelector(selector))),
  };
 });
 assert.deepEqual(result,{adminContainsRows:true,statsBeforeInvites:true,desktop:width>750,narrow:width<=750,groupingBesideView:true,compact:true,rightAligned:true,actionBelow:true,statusBelow:true,overviewControls:true});
 const calls=await page.evaluate(()=>window.__calls.filter(({name})=>name!=='admin_guest_overview').length);
 await selection.getByRole('button',{name:'Clear',exact:true}).press('Enter');
 assert.equal(await selection.isVisible(),false,'clearing the selection closes the action strip');
 assert.match(await page.locator('#inviteSelectionCount').innerText(),/^0\//);
 assert.equal(await page.locator('#inviteRows [data-bulk-select-all]').evaluate(node=>node===document.activeElement),true);
 assert.equal(await page.evaluate(()=>window.__calls.filter(({name})=>name!=='admin_guest_overview').length),calls,'clearing the selection makes no write');
 await select.check();
 await mode.press('Enter');
 assert.equal(await mode.getAttribute('aria-pressed'),'false');
 assert.equal(await mode.evaluate(node=>node===document.activeElement),true);
 assert.equal(await page.locator('#inviteRows [data-bulk-select-all],#inviteRows #inviteSelectionCount,#inviteRows [data-bulk-select]').count(),0);
 assert.equal(await selection.isVisible(),false,'leaving selection mode clears the selected rows');
 await ensureInviteSelection(page);
 const headerGeometry=()=>heading.evaluate(node=>{
  const box=node.getBoundingClientRect();
  const rows=document.querySelector('#inviteRows').getBoundingClientRect();
  return { height:box.height, gap:rows.top-box.bottom };
 });
 const menu=page.locator('#inviteShownFieldsHost details'),overlay=menu.locator('.template-choice-menu');
 const summary=menu.locator('summary'), before=await headerGeometry();
 assert.equal(await summary.innerText(),'View');
 await summary.press('Enter');
 assert.equal(await overlay.evaluate(node=>getComputedStyle(node).position),'absolute');
 assert.deepEqual(await headerGeometry(),before,'the open menu overlays the page without changing the layout');
 assert.ok(await overlay.evaluate(node=>{const b=node.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth+1;}),'overlay fits the page width');
 if(width>=750)await overlay.hover();
 await page.keyboard.press('Escape');
 assert.equal(await menu.evaluate(node=>node.open),false);
 assert.equal(await overlay.evaluate(node=>getComputedStyle(node).display),'none','closing removes the overlay from painting and hit testing');
 assert.equal(await summary.evaluate(node=>node===document.activeElement),true);
}

async function searchDisclosure(page, width) {
 const heading=page.locator('.invite-box-heading'), toggle=heading.locator('#inviteSearchToggle');
 const panel=heading.locator('#inviteSearchPanel'), search=panel.locator('#inviteSearch');
 const close=panel.getByRole('button',{name:'Close',exact:true});
 const rows=page.locator('#inviteRows .invite-household'), original=await rows.count();
 const measure=()=>heading.evaluate(node=>{
  const rects=[node,node.querySelector('#inviteShownFieldsHost summary'),node.querySelector('#inviteSelectionToggle'),node.querySelector('#inviteSearchToggle'),
   node.querySelector('#inviteSearch'),node.querySelector('#inviteSearchClose')].map(el=>el.getBoundingClientRect());
  const [header,view,select,icon,field,closeButton]=rects;
  return {
   height:header.height, left:view.left, compact:icon.left-select.right<=12&&icon.left>=select.right-1,
   rightAligned:Math.abs((field.width?closeButton:icon).right-header.right)<2,
   fieldWidth:field.width, hiddenWidth:node.querySelector('#inviteSearchPanel').getBoundingClientRect().width,
   inline:[icon,field,closeButton].every((item,i,items)=>Math.abs(item.bottom-icon.bottom)<2&&(!i||item.left>=items[i-1].right-1)),
   onNewRow:icon.top>=view.bottom,
   viewport:document.documentElement.scrollWidth<=innerWidth+1,
  };
 });
 assert.equal(await toggle.getAttribute('aria-controls'),'inviteSearchPanel');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.equal(await panel.isVisible(),false);
 const collapsed=await measure();
 assert.equal(collapsed.hiddenWidth,0,'collapsed Search reserves no input space');
 assert.equal(collapsed.compact,true,'Search sits next to Select');
 assert.equal(collapsed.rightAligned,true,'the closed toolbar aligns to the right');
 await toggle.click();
 assert.equal(await search.evaluate(node=>node===document.activeElement),true);
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 const opened=await measure();
 assert.ok(opened.fieldWidth>80&&opened.inline&&opened.viewport&&opened.rightAligned,
  'Search, field and × fit at '+width+'px: '+JSON.stringify(opened));
 assert.equal(opened.onNewRow,width<=600,'narrow screens give the Search field its own row');
 if(width>600)assert.ok(opened.left<collapsed.left,'opening Search grows the toolbar into available space');
 if(width>750)assert.equal(opened.height,collapsed.height,'opening Search does not add a row on wide screens');
 const view=heading.locator('#inviteShownFieldsHost summary');
 await view.press('Enter');
 const overlay=heading.locator('#inviteShownFieldsHost .template-choice-menu');
 assert.ok(await overlay.evaluate(node=>{const b=node.getBoundingClientRect();return b.width>0&&b.left>=0&&b.right<=innerWidth+1;}),
  'the View menu fits while Search is open at '+width+'px');
 await view.press('Escape');
 assert.equal(await panel.isVisible(),true,'closing View leaves the Search disclosure open');
 const grouping=heading.locator('#inviteQuickGrouping');
 await grouping.locator('summary').press('Enter');
 assert.ok(await grouping.locator('.template-choice-menu').evaluate(node=>{const b=node.getBoundingClientRect();return b.width>0&&b.left>=0&&b.right<=innerWidth+1;}),
  'the Group by menu fits while Search is open at '+width+'px');
 await grouping.locator('summary').press('Escape');
 const filter=async()=>{
  await search.fill('synthetic no match');
  assert.equal(await rows.count(),0);
 };
 const expectClosed=async()=>{
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  assert.equal(await search.inputValue(),'');
  assert.equal(await panel.isVisible(),false);
  assert.equal(await toggle.evaluate(node=>node===document.activeElement),true,'closing Search restores icon focus');
  assert.equal(await rows.count(),original,'closing Search restores the original rows');
  assert.deepEqual(await measure(),collapsed,'closing Search restores compact geometry');
 };
 await filter(); await close.click(); await expectClosed();
 await toggle.press('Enter'); await filter(); await search.press('Escape'); await expectClosed();
 await toggle.click(); await filter(); await toggle.click(); await expectClosed();
}

async function groupingChoices(page) {
 const grouping=page.locator('#inviteQuickGrouping'), button=grouping.locator('summary');
 const rows=page.locator('#inviteRows');
 const selected=rows.locator('[data-bulk-select]:checked');
 const guestId=await page.evaluate(()=>{
  const id=crypto.randomUUID();
  fixtures.guests.push({id,household_id:h3,first_name:'Synthetic'});
  return id;
 });
 await refresh(page);
 await rows.locator('[data-bulk-select]:enabled').first().check();
 const state=()=>page.evaluate(()=>({
  saved:window.RSVP_ADMIN_PREFERENCES.invitesGrouping,
  writes:window.__calls.filter(({name})=>name!=='admin_guest_overview').length,
 }));
 const before=await state();
 await button.press('Enter');
 assert.equal(await grouping.getByRole('radio',{name:'Relational',exact:true}).isChecked(),true);
 await grouping.getByRole('radio',{name:'Service',exact:true}).click();
 assert.ok(await rows.locator('[data-invite-service]').count()>0,'choosing Service groups the visible households immediately');
 assert.equal(await selected.count(),1,'grouping preserves the selected household');
 await grouping.getByRole('radio',{name:'Service',exact:true}).press('ArrowRight');
 assert.equal(await grouping.getByRole('radio',{name:'Alphabetic',exact:true}).isChecked(),true);
 assert.equal(await rows.locator('.invite-overview-group').count(),0,'Alphabetic shows a single list');
 assert.deepEqual(await rows.locator('.invite-compact-name').allTextContents(),['Example child','Example hill family'],
  'Alphabetic sorts by household name despite the opposite saved order');
 assert.deepEqual(await state(),before,'toolbar grouping is a view choice and performs no writes');
 await grouping.getByRole('radio',{name:'Alphabetic',exact:true}).press('Escape');
 assert.equal(await button.evaluate(node=>node===document.activeElement),true,'Escape returns focus to Group by');
 await refresh(page);
 assert.equal(await rows.locator('.invite-overview-group').count(),0,'data refresh preserves the current grouping');
 await button.press('Enter');
 await grouping.getByRole('radio',{name:'Relational',exact:true}).click();
 assert.ok(await rows.locator('[data-relation-group-id]').count()>0);
 await page.locator('#inviteShownFieldsHost summary').click();
 assert.equal(await grouping.evaluate(node=>node.open),false,'opening View closes Group by');
 await page.locator('#inviteShownFieldsHost summary').press('Escape');
 await page.locator('#bulkInviteContent').getByRole('button',{name:'Clear',exact:true}).click();
 await page.evaluate(id=>{fixtures.guests=fixtures.guests.filter(guest=>guest.id!==id);},guestId);
 await refresh(page);
}

async function rowsGeometry(page) {
 const rows=page.locator('#inviteRows');
 const screen=await rows.getAttribute('data-screen'), phone=screen==='phone';
 assert.equal(await rows.getAttribute('data-rows'),'1','fixture selects the one-row presentation');
 // Live guest counts can refresh independently of these layout controls.
 const state=()=>page.evaluate(()=>({
  shown:[...document.querySelectorAll('#inviteShownFieldsHost [aria-pressed="true"]')].map(n=>n.dataset.value),
  selected:[...document.querySelectorAll('#inviteRows [data-bulk-select]:checked')].map(n=>n.dataset.bulkSelect),
  calls:window.__calls.filter(({name})=>name!=='admin_guest_overview').length,
 }));
 const fields=page.locator('#inviteShownFieldsHost .invite-shown-fields');
 const toggle=async key=>{if(!await fields.evaluate(node=>node.open))await fields.locator('summary').click();await fields.locator('[data-value="'+key+'"]').click();await page.keyboard.press('Escape');};
 const optionalColumns=['reply'];
 const availableColumns=phone?['householdInfo','serviceInfo','reply']:optionalColumns;
 if(!phone) await toggle('recipient');
 const before=await state();
 await setFixtureInviteRows(page,2);
 assert.equal(await rows.getAttribute('data-rows'),'2','the selected screen preference changes the rendered row layout');
 const result=await page.locator('#inviteRows').evaluate(host=>{
  const row=host.querySelector('.invite-household > summary'),primary=row.querySelector('.invite-overview-identity'),name=primary.querySelector('.invite-compact-name'),meta=primary.querySelector('.invite-household-meta'),serviceCell=row.querySelector('.invite-overview-service-info'),recipient=serviceCell?.querySelector('.invite-overview-recipient'),service=serviceCell?.querySelector('.invite-copy-pill');
  const labels=[...host.querySelectorAll('.invite-overview-heading > span')].map(n=>n.textContent);
  return {inline:!!meta&&!!service&&!!recipient,below:!!meta&&meta.getBoundingClientRect().top>=name.getBoundingClientRect().bottom-1,
   extraColumns:[...row.children].filter(n=>n.matches('.invite-overview-household-info,.invite-overview-recipient')).length,
   headings:labels,service:service?.textContent,pageFits:document.documentElement.scrollWidth<=innerWidth+1,
   fontMatches:getComputedStyle(row.querySelector('.invite-overview-reply')).fontSize===getComputedStyle(name).fontSize};
 });
 assert.equal(result.inline,!phone,'two-row Tablet and Desktop nest household and service details');
 assert.equal(result.below,!phone,'household information sits beneath its name on larger screens');
 assert.equal(result.extraColumns,0,'two rows has no separate secondary detail cells');
 assert.ok(!result.headings.includes('Household info')&&!result.headings.includes('Service info'),'nested details do not retain column headings');
 if(!phone) assert.match(result.service,/^(Messages|Email|WhatsApp|SMS|None)$/,'service detail contains only the service');
 assert.equal(result.pageFits,true,'two-row presentation remains within the viewport');
 assert.equal(result.fontMatches,true,'RSVP font size matches the household row text');
 const twoState=await state();
 assert.deepEqual(twoState.shown,optionalColumns,'choosing two rows enables the saved RSVP column');
 assert.deepEqual(await fields.locator('button[data-value]').evaluateAll(nodes=>nodes.map(node=>node.dataset.value)),availableColumns,'two-row View offers the allowed columns for its screen');
 assert.deepEqual({...twoState,shown:before.shown},before,'two rows preserves selection and backend call history');
 assert.equal(await rows.locator('.invite-rsvp-food-answer:visible').count(),1,'saved food interest supplies the lower RSVP line');
 await assertRightmostSelection(page);
 const activity=rows.locator('.invite-delivery-time[datetime="2026-11-14T18:00:00Z"]');
 assert.equal(await activity.count(),1,'the newest recorded send supplies the invitation timestamp');
 assert.doesNotMatch(await activity.innerText(),/Last sent|Last visit/,'the timestamp displays only the date and time');
 assert.match(await activity.getAttribute('aria-label'),/^Last sent · /,'assistive technology can distinguish a send timestamp');
 if(phone) {
  await toggle('householdInfo');
  await toggle('serviceInfo');
  assert.ok(await rows.locator('.invite-overview-identity .invite-household-meta').count()>0,'Phone can opt into Household info below the household name');
  assert.ok(await rows.locator('.invite-phone-extras .invite-overview-service-info .invite-overview-recipient').count()>0,'Phone can opt into the paired Service and Recipient column');
  await assertRightmostSelection(page);
  await toggle('householdInfo');
  await toggle('serviceInfo');
 }
 await toggle('reply');
 assert.equal(await page.locator('#inviteRows .invite-household > summary > .invite-overview-reply').count(),0,'RSVP and its food line disappear together as one optional column');
 assert.equal(await rows.locator('.invite-overview-interest,.invite-rsvp-food-answer:visible').count(),0,'Food does not reappear as an independent two-row column');
 const required=phone?['.invite-overview-identity','.invite-overview-delivery .invite-copy-invitation']:['.invite-overview-identity .invite-household-meta','.invite-overview-service-info .invite-copy-recipient','.invite-overview-delivery .invite-copy-invitation'];
 for(const selector of required)assert.ok(await page.locator('#inviteRows '+selector).count()>0,'required fields remain visible: '+selector);
 await refresh(page);assert.equal(await rows.getAttribute('data-rows'),'2','ordinary data refresh preserves the chosen row presentation');
 assert.equal(await page.locator('#inviteRows .invite-household > summary > .invite-overview-reply').count(),0,'temporary optional-column choices survive data refresh');
 assert.equal(await rows.locator('.invite-overview-identity .invite-household-meta').count()>0,!phone,'data refresh preserves the selected screen layout');
 await setFixtureInviteRows(page,1);
 assert.equal(await rows.getAttribute('data-rows'),'1','returning to one row uses that screen preference');
 assert.deepEqual((await state()).shown,before.shown,'one row restores its earlier field choices instead of temporary two-row choices');
 await setFixtureInviteRows(page,2);
 assert.deepEqual((await state()).shown,optionalColumns,'each transition to two rows restores its saved optional columns');
 await setFixtureInviteRows(page,1);
 assert.deepEqual((await state()).shown,before.shown,'repeated layout switches retain the one-row choices');
 if(!phone) await toggle('recipient');
 const copy = page.locator('#inviteRows .invite-copy-options').filter({ has: page.locator('.invite-copy-text') }).first();
 assert.ok(await copy.evaluate(cell => {
  const a = cell.querySelector('.invite-copy-invitation .invite-copy-pill').getBoundingClientRect();
  const b = cell.querySelector('.invite-copy-text .invite-copy-pill').getBoundingClientRect();
  return (Math.abs(a.top - b.top) < 1 && a.right <= b.left || a.bottom <= b.top + 1) &&
   Math.max(a.right,b.right) <= cell.getBoundingClientRect().right + 1;
 }), 'Invitation and Text fit without overlapping within their cell');
 assert.equal(await rows.locator('.invite-household > summary > .invite-overview-household-info').count()>0,!phone,'one row restores enabled info columns on larger screens');
 assert.equal(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta,#inviteRows .invite-overview-recipient small').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'one-row presentation remains within the viewport');
 const oneRow=fields.getByRole('radio',{name:'1 Row',exact:true}),twoRows=fields.getByRole('radio',{name:'2 Row',exact:true});
 const savedRows=()=>page.evaluate(()=>['phone','tablet','desktop'].map(screen=>window.RSVP_ADMIN_PREFERENCES.getInvitesProfile(screen).rows));
 const saved=await savedRows(),quickBefore=await state();
 await fields.locator('summary').click();
 assert.equal(await fields.getByRole('button',{name:/^(All|None)$/}).count(),0,'row controls replace the All and None actions');
 assert.equal(await oneRow.isChecked(),true);
 await twoRows.click();
 assert.equal(await rows.getAttribute('data-rows'),'2','the dropdown changes layout immediately');
 assert.equal(await twoRows.isChecked(),true);
 assert.equal(await twoRows.evaluate(node=>document.activeElement===node),true,'the active choice keeps focus after rebuilding fields');
 assert.deepEqual(await state(),{...quickBefore,shown:optionalColumns},'the quick choice preserves selection and application state');
 await twoRows.press('ArrowLeft');
 assert.equal(await rows.getAttribute('data-rows'),'1','arrow keys switch the radio group and list together');
 assert.equal(await oneRow.isChecked(),true);
 assert.deepEqual(await state(),quickBefore,'returning with the quick choice restores one-row fields');
 assert.deepEqual(await savedRows(),saved,'the quick choice does not write either layout preference');
 await oneRow.press('Escape');
 assert.equal(await fields.locator('summary').evaluate(node=>document.activeElement===node),true);
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
   selected:rows.every(row=>row.querySelectorAll('.invite-overview-select [data-bulk-select]').length===1),
   touch:rows.every(row=>[...row.querySelectorAll('.bulk-invite-select')].every(control=>{const b=control.getBoundingClientRect();return b.width>=43.5&&b.height>=43.5;})),
   compactCopies:rows.every(row=>[...row.querySelectorAll('.invite-copy-recipient,.invite-copy-invitation,.invite-copy-text,.invite-review-action')].every(control=>{
    const b=control.getBoundingClientRect(),pill=control.querySelector('.invite-copy-pill').getBoundingClientRect();
    const touch=matchMedia('(max-width: 700px), (pointer: coarse)').matches;
    return touch ? b.width>=43.5 && b.height>=43.5 && b.width>=pill.width && b.height>=pill.height :
     b.width>=27.5&&b.height>=27.5&&['left','top','width','height'].every(key=>Math.abs(b[key]-pill[key])<=1);
   })),
   serviceOutsideCopy:rows.every(row=>!row.querySelector('.invite-copy-recipient .invite-overview-recipient')),
   contained:rows.every(row=>{const a=row.getBoundingClientRect();return [...row.children].every(child=>{const b=child.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1;});}),
   duplicate:host.querySelectorAll('.bulk-invite-row,.bulk-invite-list').length,
   outlines:[...host.querySelectorAll('#inviteRows .invite-overview-group')].every(group=>{const style=getComputedStyle(group);return parseFloat(style.borderTopWidth)>0&&parseFloat(style.borderBottomLeftRadius)>0;}),
   pageFits:document.documentElement.scrollWidth<=innerWidth+1};
 });
 assert.equal(result.cards,6,'the Overview has six cards with household and guest counts combined');assert.ok(result.rows>0);
 assert.equal(result.controls,true,'Action contains three compact buttons without scope checkboxes');
 assert.equal(result.headerSelection,true,'the rightmost heading keeps the Select all touch target');
 assert.equal(result.independent,true,'copy buttons remain outside selection labels');assert.equal(result.selected,true,'each row has one shared selection control');
 assert.equal(result.touch,true,'selection controls retain 44px targets');
 assert.equal(result.compactCopies,true,'copy hit areas follow visible chips and retain 44px touch targets');
 assert.equal(result.serviceOutsideCopy,true,'plain contact details remain outside Service copy hit areas');assert.equal(result.contained,true,'shared rows stay contained');
 assert.equal(result.outlines,true,'relational groups use their own outlined boxes');
 assert.equal(result.duplicate,0,'there is no second household list');assert.equal(result.pageFits,true,'merged Invites does not overflow');
}

(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch();
 try {
  for(const width of [1024,1100,1160,1366,1440,820,512,511,390,320]){
   const page=await browser.newPage({viewport:{width,height:1050},hasTouch:width<700}),errors=[];
   page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('rsvp-interface-language','en');});
   await routeSyntheticSdk(page,mock+'\n'+extra+'\n'+seed);
   await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
   await page.waitForFunction(()=>document.querySelector('#inviteOverviewCounts .invite-stat-row'));
   const screen=width>=1024?'desktop':width>=512?'tablet':'phone';
   assert.equal(await page.locator('#inviteRows').getAttribute('data-screen'),screen,'the exact breakpoint chooses the screen profile');
   const initialRows=await page.evaluate(screen=>window.RSVP_ADMIN_PREFERENCES.getInvitesProfile(screen).rows,screen);
   assert.equal(await page.locator('#inviteRows').getAttribute('data-rows'),String(initialRows),'the saved screen profile chooses the row presentation');
   if(width===1024){
    const fields=page.locator('#inviteShownFieldsHost .invite-shown-fields');
    await fields.locator('summary').click();
    await fields.getByRole('radio',{name:'1 Row',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#inviteRows').dataset.rows==='1');
    await page.setViewportSize({width:1023,height:1050});
    await page.waitForFunction(()=>document.querySelector('#inviteRows').dataset.screen==='tablet');
    await page.setViewportSize({width:511,height:1050});
    await page.waitForFunction(()=>document.querySelector('#inviteRows').dataset.screen==='phone');
    await page.setViewportSize({width:512,height:1050});
    await page.waitForFunction(()=>document.querySelector('#inviteRows').dataset.screen==='tablet');
    await page.setViewportSize({width:1024,height:1050});
    await page.waitForFunction(defaultRows=>document.querySelector('#inviteRows').dataset.screen==='desktop'&&
     document.querySelector('#inviteRows').dataset.rows===String(defaultRows),initialRows);
   }
   await setFixtureInviteRows(page,1);
   await toolbarGeometry(page,width);
   await searchDisclosure(page,width);
   if([390,1366].includes(width))await groupingChoices(page);
   if(width===1366){
    const theme=await page.locator('html').getAttribute('data-theme');
    await toggleFixtureTheme(page);
    await page.waitForFunction(previous=>document.documentElement.dataset.theme!==previous,theme);
    await searchDisclosure(page,width);
    await toggleFixtureTheme(page);
    await page.waitForFunction(previous=>document.documentElement.dataset.theme===previous,theme);
   }
   const fields=page.locator('#inviteShownFieldsHost .invite-shown-fields');
   const summary=fields.locator('summary'), selection=summary.locator('.filter-choice-selection');
   const field=key=>fields.locator('button[data-value='+key+']');
   const toggleField=async(key,visible)=>{
    if(!await fields.evaluate(node=>node.open))await summary.click();
    await field(key).click();
    assert.equal(await field(key).getAttribute('aria-pressed'),String(visible));
   };
   if(screen==='phone') {
    await geometry(page);
    assert.deepEqual(await fields.locator('button[data-value]').evaluateAll(nodes=>nodes.map(node=>node.dataset.value)),['householdInfo','recipient','serviceInfo','reply','food']);
    assert.deepEqual(await page.locator('#inviteRows .invite-overview-heading > span:not(.invite-overview-select)').allTextContents(),['Household','Invitation','RSVP']);
    assert.equal(await page.locator('#inviteRows .invite-phone-extras').count(),0,'Phone defaults to its compact fields');
    for(const key of ['householdInfo','recipient','serviceInfo','food'])await toggleField(key,true);
    assert.deepEqual(await page.locator('#inviteRows .invite-phone-extras').first().locator('.invite-phone-field-label').allTextContents(),['Household info','Recipient','Service']);
    await toggleField('reply',false);
    assert.deepEqual(await page.locator('#inviteRows .invite-overview-heading > span:not(.invite-overview-select)').allTextContents(),['Household','Invitation']);
    assert.ok(await page.locator('#inviteRows .invite-phone-extras .invite-overview-interest').count()>0,'Phone can show Food in 1 Row');
    await assertRightmostSelection(page);
    for(const key of ['householdInfo','recipient','serviceInfo','food'])await toggleField(key,false);
    await toggleField('reply',true);
    await rowsGeometry(page);
   } else {
   assert.doesNotMatch(await selection.innerText(),/Household info/);
   assert.equal(await page.locator('#inviteRows .invite-overview-household-info').count(),0,'household detail starts hidden');
   assert.ok(await page.locator('#inviteRows .invite-overview-service-info .invite-copy-recipient').count()>0,'Service is always present as the contact-value copy chip');
   assert.equal(await field('serviceInfo').count()+await field('delivery').count(),0,'required Service and Invitation are absent from optional Shown choices');
   assert.equal(await field('lastSent').count()+await field('replyInfo').count(),0,'retired details are absent from View');
   assert.equal(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta,#inviteRows .invite-overview-recipient small').count(),0,'primary lines no longer contain secondary details');
   await summary.press('Enter');
   assert.equal(await fields.evaluate(node=>node.open),true);
   await field('food').press('Space');await geometry(page);
   assert.equal(await field('food').getAttribute('aria-pressed'),'false');
   assert.equal(await page.locator('#inviteRows .invite-overview-heading').getByText('Food',{exact:true}).count(),0);
   await page.keyboard.press('Escape');
   assert.equal(await fields.evaluate(node=>node.open),false);
   assert.equal(await summary.evaluate(node=>document.activeElement===node),true);
   await refresh(page);
   assert.equal(await field('food').getAttribute('aria-pressed'),'false','refresh retains the temporary one-row Food setting');
   await toggleField('food',true);await geometry(page);
   const foodHeading=page.locator('#inviteRows .invite-overview-heading').getByText('Food',{exact:true});
   assert.equal(await foodHeading.count(),0,'food interest is included with visible RSVP');
   assert.match(await page.locator('#inviteRows .invite-overview-reply').allTextContents().then(text=>text.join(' ')),/F: Y/);
   for(const key of ['recipient','reply']){
    await toggleField(key,false);await geometry(page);
    if(key==='reply')assert.equal(await foodHeading.count(),1,'saved food interest has a fallback column');
    await toggleField(key,true);await geometry(page);
   }
   for(const key of ['recipient','reply','food'])await toggleField(key,false);
   assert.equal(await fields.locator('button[aria-pressed=true]').count(),0);
   assert.deepEqual(await page.locator('#inviteRows .invite-overview-heading > span:not(.invite-overview-select)').allTextContents(),['Household','Service','Invitation']);
   assert.equal(await page.locator('#inviteRows .invite-overview-heading > span').count(),4,'required Household, Service, Invitation and selection remain');
   for(const key of ['recipient','reply','food'])await toggleField(key,true);
   assert.doesNotMatch(await selection.innerText(),/Household info/);
   await toggleField('householdInfo',true);
   assert.equal(await fields.locator('button[aria-pressed=false]').count(),0);
   assert.deepEqual(await page.locator('#inviteRows .invite-overview-heading > span:not(.invite-overview-select)').allTextContents(),['Household','Household info','Recipient','Service','Invitation','RSVP']);
   const detailCells=await page.locator('#inviteRows .invite-household > summary').first().evaluate(row=>({household:row.querySelector('.invite-overview-household-info')?.textContent,service:row.querySelector('.invite-overview-service-info')?.textContent,order:[...row.children].map(node=>node.className)}));
   assert.match(detailCells.household,/guests?.*[A-Z]{2}/,'household details moved into their own cell');
   assert.ok(detailCells.service,'service details are represented independently');
   assert.ok(detailCells.order.findIndex(value=>value.split(' ').includes('invite-overview-household-info'))>detailCells.order.findIndex(value=>value.split(' ').includes('invite-overview-identity')));
   await geometry(page);
   await rowsGeometry(page);
   await toggleField('householdInfo',false);
   await page.locator('.invite-heading-title h2').click();
   assert.equal(await fields.evaluate(node=>node.open),false);
   await page.evaluate(()=>{
    fixtures.event_settings[0].food_stage='selection';
    fixtures.food_claims.push({household_id:h2,food_item_id:fixtures.food_items[0].id,quantity:2});
   });
   await refresh(page);await geometry(page);
   assert.equal(await foodHeading.count(),1,'food selection retains its quantity column');
   assert.equal(await page.locator('#inviteRows .invite-overview-interest .invite-food-interest').getByText('2',{exact:true}).count(),1);
   assert.match(await page.locator('#inviteRows .invite-overview-reply').allTextContents().then(text=>text.join(' ')),/F: Y/,'a saved answer still appears with RSVP after food choices open');
   await toggleField('food',false);await geometry(page);await toggleField('food',true);await geometry(page);
   }
   if(screen==='tablet')await tabletInlineActions(page);
   await page.evaluate(()=>{
    fixtures.event_settings[0].is_published=true;
    const h=fixtures.households.find(h=>h.id===h2);
    h.visit_count=2;
    fixtures.invitation_send_queue=[{id:'action-layout-draft',household_id:h.id,channel:'manual',status:'draft',revision:1,created_at:'2026-11-16T12:00:00Z',updated_at:'2026-11-16T12:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_name:'Example',contact_type:'manual',contact_value:'Example'},message_body:'Synthetic invitation '+window.RSVP.invitationURL(h.invite_code)}];
   });
   await refresh(page);await geometry(page,true);
   const review=page.locator('#inviteRows .invite-review-action');
   assert.equal(await review.innerText(),'Seen (2)','Seen updates the draft label');
   assert.match(await review.getAttribute('aria-label'),/^Review · /,'the visited draft still announces the Review action');
   const draft=review.locator('xpath=ancestor::details[@data-invite-household]');
   assert.equal(await draft.locator(':scope > summary [data-invite-copy="invitation"], :scope > summary [data-invite-copy="message"]').count(),0);
   await review.press('Enter');
   const current=draft.locator('[data-invite-delivery-submenu="drafts"] [data-delivery-id="action-layout-draft"]');
   assert.ok(await current.locator(':scope > .delivery-message').isVisible());
   const ready=current.locator('[data-mark-delivery-ready]');
   assert.equal(await ready.evaluate(node=>node===document.activeElement),true,'Review opens the current draft and focuses Make invitation(s)');
   assert.equal(await current.getByRole('button',{name:'Copy message',exact:true}).count(),0);
   assert.equal(await draft.locator(':scope > summary [data-bulk-select]').isChecked(),false,'opening Review does not select the household');

   const row=page.locator('#inviteRows .invite-household').first();
   assert.equal(await row.locator('.invite-preview').count(),1,'published invitations retain the preview eye');
   assert.equal(await row.locator('.invite-edit-household').count(),0,'the pencil is reserved for unpublished planning');
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
      await page.locator('#inviteShownFieldsHost summary').click();
      await page.locator('[data-panel=invites]').screenshot({path:path.join(process.env.RSVP_INVITE_PREVIEW_DIR,'invites-shown-open-820.png')});
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
   const manualSelection=page.locator('#inviteRows [data-bulk-select="'+manualHousehold+'"]');
   await manualSelection.check();
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
    const action=page.locator('#bulkInvitesHost');
    const ready=page.locator('#inviteRows [data-bulk-select="'+manualHousehold+'"]');
    const missing=page.locator('#inviteRows [data-bulk-select="'+missingHousehold+'"]');
    const generate=action.getByRole('button',{name:'Make draft(s)',exact:true}),mark=action.getByRole('button',{name:'Mark sent',exact:true});
    for(const theme of ['light','dark']){
     if(await page.locator('html').getAttribute('data-theme')!==theme)await toggleFixtureTheme(page);
     await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
     for(const state of ['disabled','generate','mark-sent']){
      await missing.setChecked(state==='generate');
      await ready.setChecked(state==='mark-sent');
      if(state==='disabled') assert.equal(await action.isVisible(),false);
      else {
       assert.equal(await generate.isEnabled(),state==='generate','selected missing draft controls Generate availability');
       assert.equal(await mark.isEnabled(),state==='mark-sent','selected ready draft controls Mark Sent availability');
      }
      await page.locator('[data-panel=invites]').screenshot({path:path.join(process.env.RSVP_MANUAL_LAYOUT_SCREENSHOT_DIR,'manual-action-'+width+'-'+theme+'-'+state+'.png')});
     }
    }
   }
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS Invites Overview, toolbar and Review: screen profiles, View and Search disclosure, selection mode, Overview cards, draft keyboard focus, publication gates, and no overflow.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
