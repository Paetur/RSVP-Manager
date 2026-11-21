const { refreshFixture, setInvitesGrouping } = require("./helpers/admin-toolbar.cjs");
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("invites-overview", { root: process.env.RSVP_TEST_SITE_ROOT, out: process.env.RSVP_TEST_ARTIFACTS });
const overviewMock = String.raw`
fixtures.event_settings[0].food_stage='interest';
fixtures.guests.push({id:'99999999-9999-4999-8999-999999999999',household_id:h3,first_name:'Other',last_name:'Example'});
fixtures.invitation_send_queue=[{id:'queue-sent',household_id:h2,channel:'email',status:'sent',message_body:'Sent example',created_at:'2026-11-10T12:00:00Z',updated_at:'2026-11-10T12:00:00Z',revision:2,recipient_snapshot:{contact_name:'Example recipient',contact_value:'example@example.invalid'}},{id:'queue-ready',household_id:h3,channel:'sms',status:'ready',message_body:'Ready example {invitation_link}',created_at:'2026-11-11T12:00:00Z',updated_at:'2026-11-11T12:00:00Z',revision:1,recipient_snapshot:{contact_name:'Other recipient',contact_value:'+298123456'}}];fixtures.invitation_deliveries=[{queue_id:'queue-sent',confirmed_at:'2026-11-10T12:00:00Z',confirmed_by:h1}];
const overviewTemplate={
  id:'overview-template', revision:'overview-revision', name:'Synthetic invitation',
  channels:['email'], language_tags:['en','fo'],
  versions:{en:{language_code:'en',subject:'Synthetic subject',body:'Draft message {invitation_link}',options:['subject','message']}}
};
const overviewRpc=client.rpc;
client.rpc=async(name,a)=>{
  if(name==='admin_save_delivery'){
    (window.__draftWrites??=[]).push(a);
    if(!['edit'].includes(window.__accessPermissions.sections.invites))return {error:{message:'Synthetic edit permission denied'}};
    if(a.p_values.status==='ready'&&(!fixtures.event_settings[0].is_published||!window.__accessPermissions.sendInvites))return {error:{message:'Synthetic send permission denied'}};
    if (a.p_household_id===window.__racingHousehold) {
      window.__racingHousehold = null;
      return {data:null};
    }
    let item;
    if(a.p_id){
      item=fixtures.invitation_send_queue.find(q=>q.id===a.p_id);
      if(!item||item.revision!==a.p_expected_revision)return {error:{message:'Synthetic stale revision'}};
      Object.assign(item,a.p_values,{revision:item.revision+1,updated_at:'2026-11-12T13:00:00Z'});
      if(a.p_values.status==='ready'){
        const household=fixtures.households.find(h=>h.id===item.household_id);
        item.invitation_code_snapshot=household.invite_code;
        if(window.__swapReadyRecipient===item.id){
          window.__swapReadyRecipient=null;
          item.recipient_snapshot={...item.recipient_snapshot,contact_type:'phone',contact_value:'+298 98 76 54'};
        }
        if(window.__holdReady===item.id){window.__holdReady=null;await new Promise(resolve=>window.__resumeReady=()=>{delete window.__resumeReady;resolve();});}
        if(window.__badReadyAck===item.id){window.__badReadyAck=null;return {data:crypto.randomUUID()};}
      }
    }else{
      item={id:crypto.randomUUID(),household_id:a.p_household_id,...a.p_values,revision:1,
        created_at:'2026-11-12T12:00:00Z',updated_at:'2026-11-12T12:00:00Z',
        recipient_snapshot:{contact_name:'Synthetic recipient',contact_value:'synthetic@example.invalid'}};
      fixtures.invitation_send_queue.push(item);
      window.__createdDraftId=item.id;
    }
    return {data:item.id};
  }
  if(name==='admin_record_delivery_sent'){
    (window.__sentWrites??=[]).push(a);
    if(window.__holdSent===a.p_queue_id){window.__holdSent=null;await new Promise(resolve=>window.__resumeSent=()=>{delete window.__resumeSent;resolve();});}
    const item=fixtures.invitation_send_queue.find(q=>q.id===a.p_queue_id),household=fixtures.households.find(h=>h.id===item?.household_id);
    if(!fixtures.event_settings[0].is_published||!window.__accessPermissions.sendInvites)return {error:{message:'Synthetic send permission denied'}};
    if(window.__failSent===a.p_queue_id){window.__failSent=null;return {error:{message:'Synthetic Sent failure'}};}
    if(!item||!household||household.archived_at||item.invitation_code_snapshot!==household.invite_code||!item.message_body||!item.recipient_snapshot?.contact_value)return {error:{message:'Synthetic stale invitation'}};
    if(item.status==='sent')return {data:item.id};
    if(item.status!=='ready'||item.revision!==a.p_expected_revision)return {error:{message:'Synthetic stale revision'}};
    fixtures.invitation_deliveries.push({queue_id:item.id,confirmed_at:'2026-11-20T12:00:00Z',confirmed_by:h1});
    item.status='sent';item.sent_at='2026-11-20T12:00:00Z';item.revision++;
    return {data:item.id};
  }
  const result=await overviewRpc(name,a);
  if(name==='admin_load_data')result.data.invitationTemplates=[overviewTemplate,...(window.__bulkTemplates||[])];
  return result;
};`;

async function chooseInviteFilter(page, id, selected = null) {
  const dropdown = page.locator("#" + id + " details");
  const keys = await dropdown.locator("button[data-value]").evaluateAll(nodes => nodes.map(node => node.dataset.value));
  for (const key of keys) {
    const option = dropdown.locator('button[data-value="' + key + '"]');
    const wanted = selected === null || selected.includes(key);
    if ((await option.getAttribute("aria-pressed") === "true") !== wanted) {
      if (!await dropdown.evaluate(node => node.open)) await dropdown.locator("summary").click();
      await option.click();
    }
  }
  if (await dropdown.evaluate(node => node.open)) await dropdown.locator("summary").press("Escape");
}

async function checkBulkDraftGeneration(page) {
  const ids = await page.evaluate(() => {
    window.__draftWrites = [];
    const template = (id, channels, language_tags, options = ["subject", "message"]) => ({
      id, revision: id + "-revision", name: id, channels, language_tags,
      versions: { en: { language_code: "en", subject: "Alternate subject",
        body: "Alternate content {invitation_link}", short_body: "Short text {invitation_link}", options } },
    });
    window.__bulkTemplates = [
      template("Messages invitation", ["messages"], ["en", "de"], ["shortMessage"]),
      template("WhatsApp one", ["whatsapp"], ["en"]),
      template("WhatsApp two", ["whatsapp"], ["en", "de"]),
      template("English SMS only", ["sms"], ["en"]),
      template("Untagged", ["email", "sms"], []),
    ];
    const households = [
      ["email", "en"], ["messages", "en"], ["whatsapp", "en"], ["sms", "de"], ["email", "fo"],
    ].map(([service, language], index) => {
      const id = crypto.randomUUID();
      const guest = crypto.randomUUID();
      fixtures.households.push({
        id, household_name: "Bulk scope " + (index + 1), rsvp_state: "open",
        language, sort_order: 10 + index, primary_guest_id: guest,
      });
      fixtures.guests.push({
        id: guest, household_id: id, first_name: "Synthetic", language,
        email: service === "email" ? "synthetic@example.invalid" : null,
        mobile: service === "email" ? null : "+298123456",
        preferred_contact_method: service === "messages" ? null : service,
      });
      return id;
    });
    window.__racingHousehold = households[4];
    return households;
  });
  await refreshFixture(page);
  await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
  await page.locator("[data-tab=invites]").click();
  const bulk = page.locator("#bulkInvitesHost"), list = page.locator("#inviteRows");
  const status = bulk.locator(".bulk-invite-status-row");
  const scope = bulk.getByRole("group", { name: "Action", exact: true });
  const allMissing = scope.getByRole("checkbox", { name: "All missing", exact: true });
  const selected = scope.getByRole("checkbox", { name: "Selected", exact: true });
  const generate = scope.getByRole("button", { name: "Generate Drafts", exact: true });
  const householdInput = id => list.locator('[data-bulk-select="' + id + '"]');
  const householdRow = id => list.locator(".invite-household", { has: householdInput(id) });
  assert.equal(await bulk.locator('.bulk-invite-list,.bulk-invite-row').count(),0,'Action uses the shared Invites list');
  assert.equal(await generate.isVisible(),true);
  assert.equal(await bulk.locator(".bulk-invite-count").count(),0,"selection counter is removed");
  assert.equal(await list.locator("[data-bulk-select]:checked").count(),0);
  const publicationHint=status.getByText("Publish the event to activate sending.",{exact:true});
  assert.equal(await publicationHint.isVisible(),true);
  assert.equal(await allMissing.isChecked(),true);assert.equal(await selected.isChecked(),false);
  assert.equal(await generate.isDisabled(),true,"viewer cannot generate any missing draft");

  await page.evaluate(() => { window.__accessPermissions.sections.invites = "edit"; });
  await refreshFixture(page);
  await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
  assert.equal(await generate.isEnabled(), true);
  await selected.check();
  assert.equal(await allMissing.isChecked(), false);
  assert.equal(await generate.isDisabled(), true, "empty selection cannot generate");
  assert.equal(await selected.evaluate(node => node === document.activeElement), true);
  await householdInput(ids[0]).check();
  await householdInput("33333333-3333-4333-8333-333333333333").check();
  assert.equal(await list.locator("[data-bulk-select]:checked").count(),2,"shared checkboxes retain the selected scope without a counter");
  await generate.click();
  await bulk.getByText("1 draft created", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__draftWrites.map(write => write.p_household_id)), [ids[0]]);
  assert.equal(await page.evaluate(id=>fixtures.invitation_send_queue.find(q=>q.household_id===id)?.template_id,ids[0]),"overview-template");
  assert.equal(await generate.isDisabled(), true, "selected existing drafts and Ready records remain unchanged");

  await selected.uncheck();
  assert.equal(await generate.isDisabled(), true, "an unchecked scope does not run");
  await chooseInviteFilter(page,"inviteChannelFilter",["whatsapp"]);
  assert.equal(await householdRow(ids[4]).count(),0,"Services hides an Email household before global generation");
  await allMissing.check();await generate.click();
  await bulk.getByText("1 draft created · 1 with multiple matches · 1 with no match · 1 changed during generation",{exact:true}).waitFor();
  assert.equal(await page.locator('#inviteChannelFilter [data-value="whatsapp"]').getAttribute('aria-pressed'),'true','Services selection survives generation reload');
  const writes = await page.evaluate(() => window.__draftWrites);
  assert.deepEqual(writes.map(write => write.p_household_id).sort(), [ids[0], ids[1], ids[4]].sort(),
    "All missing includes hidden households and queues only exact service-language matches");
  assert.ok(writes.every(write => write.p_id === null && write.p_expected_revision === null && write.p_values.status === "draft" && write.p_values.only_if_missing === true));
  assert.deepEqual(writes.find(write => write.p_household_id === ids[1]).p_values, {
    channel: "sms", contact_id: null, message_subject: "", message_body: "Short text {invitation_link}",
    message_image: null, status: "draft", only_if_missing: true, template_id: "Messages invitation",
    template_revision: "Messages invitation-revision",
  }, "Messages uses its own template service, selected content options, and SMS transport");
  await chooseInviteFilter(page,"inviteChannelFilter");
  await householdInput(ids[4]).check();
  await selected.check();
  await generate.click();
  await bulk.getByText("1 draft created", { exact: true }).waitFor();
  assert.equal(await page.evaluate(id=>fixtures.invitation_send_queue.find(q=>q.household_id===id)?.template_id,ids[4]),"overview-template");
  assert.equal(await page.evaluate(ids => fixtures.invitation_send_queue.filter(queue =>
    [ids[2], ids[3]].includes(queue.household_id)).length, ids), 0, "zero/ambiguous results create no draft");
  assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
  assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.find(queue => queue.id === "queue-ready").status), "ready");
  assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.find(queue => queue.id === "queue-sent").status), "sent");
  assert.equal(await scope.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.equal(await status.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);

  const selectedIds = await list.locator("[data-bulk-select]:checked").evaluateAll(nodes => nodes.map(node => node.dataset.bulkSelect));
  for (const id of selectedIds) await householdInput(id).uncheck();
  await page.evaluate(() => { fixtures.event_settings[0].is_published = true; });
  await refreshFixture(page);
  await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
  assert.equal(await publicationHint.count(), 0);
  assert.equal(await list.locator("[data-bulk-select]:checked").count(),0);
  assert.equal(await bulk.locator(".bulk-invite-count").count(),0,"selection counter remains absent after publication");
  assert.equal(await status.count(),0,"an empty status row is omitted when there is no publication or incomplete-draft hint");
}


async function checkRowsPresentation(page) {
  const fields=page.locator('#inviteShownFieldsHost .invite-shown-fields');
  const toggle=async key=>{if(!await fields.evaluate(node=>node.open))await fields.locator('summary').click();await fields.locator('[data-value="'+key+'"]').click();};
  await toggle('householdInfo');
  await page.keyboard.press('Escape');
  const prepared=await page.evaluate(()=>{
    const store=window.__invitesStore;
    window.__rowsDefaultsBefore=structuredClone(store.defaults);
    const household=store.households.find(h=>store.queue.some(q=>q.household_id===h.id&&q.status==='ready'));
    const session=store.sessions.find(s=>s.is_active&&s.requires_rsvp);
    store.defaults=store.defaults.filter(d=>d.household_id!==household.id||d.session_id!==session.id);
    store.defaults.push({household_id:household.id,session_id:session.id,is_invited:true});
    window.__invitesTestView.render();return household.id;
  });
  const select=page.locator('#inviteRows [data-bulk-select="'+prepared+'"]');
  await select.check();
  const state=()=>page.evaluate(()=>({
    shown:[...document.querySelectorAll('#inviteShownFieldsHost [aria-pressed="true"]')].map(n=>n.dataset.value),
    selected:[...document.querySelectorAll('#inviteRows [data-bulk-select]:checked')].map(n=>n.dataset.bulkSelect),
    calls:window.__calls.length,queue:JSON.stringify(window.__invitesStore.queue),deliveries:JSON.stringify(window.__invitesStore.deliveries),
  }));
  const before=await state(),one=page.locator('#inviteRowsLayout input[value="1"]'),two=page.locator('#inviteRowsLayout input[value="2"]');
  const heading=()=>page.locator('#inviteRows .invite-overview-heading > span').allTextContents();
  assert.equal(await one.isChecked(),true);
  assert.deepEqual(await heading(),['Household','Household info','Recipient','Service','Invitation','Last sent','RSVP','RSVP info','Food interest','Actions',''],'one row keeps all secondary details in separate columns');
  assert.equal(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta,#inviteRows .invite-overview-recipient small,#inviteRows .invite-overview-delivery small,#inviteRows .invite-overview-reply small').count(),0,'one row has no nested secondary details');
  assert.match((await page.locator('#inviteRows .invite-overview-last-sent').allTextContents()).join(' '),/2026/);
  assert.match((await page.locator('#inviteRows .invite-overview-reply-info').allTextContents()).join(' '),/0 \/ [1-9]\d* responses/);
  for(const text of await page.locator('#inviteRows .invite-copy-recipient .invite-copy-pill').allTextContents())assert.match(text,/^(Messages|Email|WhatsApp|SMS|None)$/,'one-row service info omits numbers and email addresses');
  await toggle('lastSent');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inviteRows .invite-overview-last-sent').count(),0,'Last sent has its own independent Shown choice');
  assert.ok(await page.locator('#inviteRows .invite-overview-delivery').count()>0,'hiding dates preserves invitation status');
  await toggle('lastSent');await toggle('replyInfo');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inviteRows .invite-overview-reply-info').count(),0,'response counts have their own independent Shown choice');
  assert.ok(await page.locator('#inviteRows .invite-overview-reply').count()>0,'hiding response counts preserves RSVP status');
  await toggle('replyInfo');await page.keyboard.press('Escape');
  // Keep a distinct one-row choice so two-row defaults cannot silently replace it.
  await toggle('lastSent');await page.keyboard.press('Escape');
  const oneRowBefore=await state();
  await two.check();
  assert.deepEqual(await heading(),['Household','Service','Invitation','RSVP','Food interest','Actions',''],'two rows removes secondary column headings');
  assert.equal(await page.locator('#inviteRows .invite-household > summary > .invite-overview-household-info,#inviteRows .invite-household > summary > .invite-overview-recipient,#inviteRows .invite-household > summary > .invite-overview-last-sent,#inviteRows .invite-household > summary > .invite-overview-reply-info').count(),0,'secondary details move beneath their primary cells');
  assert.ok(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta').count()>0);
  for(const text of await page.locator('#inviteRows .invite-copy-recipient .invite-copy-pill').allTextContents())assert.match(text,/^(Messages|Email|WhatsApp|SMS|None)$/,'two-row service detail also omits number/email');
  assert.match((await page.locator('#inviteRows .invite-overview-delivery small').allTextContents()).join(' '),/Last sent/);
  assert.match((await page.locator('#inviteRows .invite-overview-reply small').allTextContents()).join(' '),/0 \/ [1-9]\d* responses/);
  const twoState=await state();
  assert.deepEqual(twoState.shown,['reply','food'],'two rows starts with both optional paired columns');
  assert.deepEqual(await fields.locator('button[data-value]').evaluateAll(nodes=>nodes.map(node=>node.dataset.value)),['reply','food'],'two-row Shown controls only optional whole columns');
  assert.deepEqual({...twoState,shown:before.shown},before,'two rows preserves selected households, RPC history and delivery data');
  await toggle('reply');await toggle('food');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inviteRows .invite-overview-reply,#inviteRows .invite-overview-interest').count(),0,'two-row choices hide each optional primary/detail pair');
  assert.ok(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta').count()>0,'Household and its details stay mandatory when optional columns are hidden');
  await one.check();assert.deepEqual(await state(),oneRowBefore,'returning to one row restores its previous fields and operational state');
  await two.check();
  assert.deepEqual([...(await state()).shown].sort(),[...twoState.shown].sort(),'re-entering two rows resets its temporary columns to saved defaults');
  await one.check();assert.deepEqual(await state(),oneRowBefore,'temporary two-row field changes never replace one-row choices');
  await toggle('lastSent');await page.keyboard.press('Escape');
  await select.uncheck();
  await page.evaluate(()=>{window.__invitesStore.defaults=window.__rowsDefaultsBefore;delete window.__rowsDefaultsBefore;window.__invitesTestView.render();});
  await toggle('householdInfo');
  await page.keyboard.press('Escape');
  const defaultsBefore=await state();
  await two.check();
  await toggle('reply');await page.keyboard.press('Escape');
  const rowTwoTemporary=await state();
  await page.evaluate(()=>{
    window.__rowsSavedDefaults=Object.getOwnPropertyDescriptor(window.RSVP_ADMIN_PREFERENCES,'invitesShownFields');
    Object.defineProperty(window.RSVP_ADMIN_PREFERENCES,'invitesShownFields',{configurable:true,get:()=>['recipient','delivery']});
    window.__invitesTestView.render();
  });
  assert.deepEqual(await state(),rowTwoTemporary,'changed one-row defaults preserve active two-row temporary choices');
  await one.check();
  assert.deepEqual((await state()).shown,['recipient'],'changed saved defaults replace earlier one-row overrides while required fields stay visible');
  await page.evaluate(()=>{Object.defineProperty(window.RSVP_ADMIN_PREFERENCES,'invitesShownFields',window.__rowsSavedDefaults);delete window.__rowsSavedDefaults;window.__invitesTestView.render();});
  assert.deepEqual(await state(),defaultsBefore,'restoring one-row defaults preserves operational data and restores those fields');
  await toggle('householdInfo');await page.keyboard.press('Escape');
  const oneRowTemporary=await state();
  await page.evaluate(()=>{
    window.__rowsSavedColumns=Object.getOwnPropertyDescriptor(window.RSVP_ADMIN_PREFERENCES,'invitesTwoRowColumns');
    Object.defineProperty(window.RSVP_ADMIN_PREFERENCES,'invitesTwoRowColumns',{configurable:true,get:()=>['serviceInfo','delivery','food']});
    window.__invitesTestView.render();
  });
  assert.deepEqual(await state(),oneRowTemporary,'changed two-row defaults preserve one-row temporary choices');
  await two.check();
  assert.deepEqual((await state()).shown,['food'],'two rows uses its own saved optional column defaults');
  assert.equal(await page.locator('#inviteRows .invite-overview-reply').count(),0,'saved two-row choices omit both lines of unselected RSVP');
  assert.ok(await page.locator('#inviteRows .invite-overview-service-info .invite-copy-recipient,#inviteRows .invite-overview-delivery .invite-copy-invitation').count()>0,'Service and Invitation stay mandatory with custom two-row defaults');
  assert.ok(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta').count()>0,'saved two-row choices cannot hide Household details');
  await one.check();assert.deepEqual(await state(),oneRowTemporary,'two-row saved defaults never replace one-row temporary fields');
  await page.evaluate(()=>{Object.defineProperty(window.RSVP_ADMIN_PREFERENCES,'invitesTwoRowColumns',window.__rowsSavedColumns);delete window.__rowsSavedColumns;window.__invitesTestView.render();});
  assert.deepEqual(await state(),oneRowTemporary,'restoring two-row defaults does not reset one-row fields');
  await toggle('householdInfo');await page.keyboard.press('Escape');
  await two.check();
  await page.evaluate(()=>{window.__invitesActorOverride='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';window.__invitesTestView.render();});
  assert.equal(await one.isChecked(),true,'a different actor starts with one row instead of the previous actor layout');
  assert.deepEqual((await state()).shown,defaultsBefore.shown,'another actor receives saved defaults rather than the previous actor two-row All choice');
  await page.evaluate(()=>{delete window.__invitesActorOverride;window.__invitesTestView.render();});
}

async function checkGroupingPreservation(page) {
  const ready=await page.evaluate(()=>window.__invitesStore.queue.find(q=>q.status==='ready'));
  const input=page.locator('#inviteRows [data-bulk-select="'+ready.household_id+'"]');
  await input.check();
  const state=()=>page.evaluate(()=>({selected:[...document.querySelectorAll('#inviteRows [data-bulk-select]:checked')].map(n=>n.dataset.bulkSelect),queue:JSON.stringify(window.__invitesStore.queue),deliveries:JSON.stringify(window.__invitesStore.deliveries),writes:window.__calls.filter(c=>/save_delivery|record_delivery_sent|mark_delivery/.test(c.name)).length}));
  const before=await state();
  await setInvitesGrouping(page,'service');
  assert.equal(await page.evaluate(()=>window.RSVP_ADMIN_PREFERENCES.invitesGrouping),'service');
  assert.deepEqual(await state(),before,'changing grouping preserves captured rows and delivery/write state');
  assert.ok(await page.locator('#inviteRows .invite-overview-group[data-invite-service]').count()>0);
  assert.equal(await page.locator('#inviteRows [data-invite-household]').evaluateAll(nodes=>new Set(nodes.map(n=>n.dataset.inviteHousehold)).size===nodes.length),true,'service grouping never duplicates rows');
  assert.equal(await page.locator('#inviteRows .invite-overview-group').evaluateAll(groups=>groups.every(n=>parseFloat(getComputedStyle(n).borderTopWidth)>0&&parseFloat(getComputedStyle(n).borderRadius)>0)),true,'service groups have outlined containers');
  const copied=await page.evaluate(()=>{window.__groupCopies=[];window.__groupClipboardBefore=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__groupCopies.push(text)}});return true;});
  assert.equal(copied,true);
  const row=page.locator('[data-invite-household="'+ready.household_id+'"]'),open=await row.evaluate(node=>node.open);
  await row.locator('.invite-copy-recipient').click();
  await page.waitForFunction(()=>window.__groupCopies.length===1);
  assert.equal(await page.evaluate(()=>window.__groupCopies[0]),ready.recipient_snapshot.contact_value,'service grouping retains the actual recipient copy value');
  assert.equal(await row.evaluate(node=>node.open),open,'grouped copy does not toggle household details');
  assert.deepEqual(await state(),before,'grouped copy does not alter selection or delivery writes');
  await page.evaluate(()=>{if(window.__groupClipboardBefore)Object.defineProperty(navigator,'clipboard',window.__groupClipboardBefore);else delete navigator.clipboard;delete window.__groupClipboardBefore;});
  await setInvitesGrouping(page,true);
  assert.ok(await page.locator('#inviteRows .invite-overview-group[data-planning-group-id]').count()>0);
  assert.deepEqual(await state(),before,'restoring relational grouping retains selection and existing delivery state');
  await page.locator('#inviteRows [data-bulk-select="'+ready.household_id+'"]').uncheck();
}

async function checkCompactCopyTargets(page, row) {
  const snapshot=()=>page.evaluate(()=>({
    copies:window.__invitesCopied.length,
    selected:[...document.querySelectorAll('#inviteRows [data-bulk-select]:checked')].map(node=>node.dataset.bulkSelect),
    queue:JSON.stringify(window.__invitesStore.queue),
  }));
  for(const selector of ['.invite-copy-recipient','.invite-copy-invitation']){
    const control=row.locator(selector);
    const sameBounds=await control.evaluate(button=>{
      const b=button.getBoundingClientRect(),pill=button.querySelector('.invite-copy-pill').getBoundingClientRect();
      return b.width>=27.5&&b.height>=27.5&&['left','top','width','height'].every(key=>Math.abs(b[key]-pill[key])<=1);
    });
    assert.equal(sameBounds,true,'copy hit area matches the visible chip: '+selector);
    await row.evaluate(node=>{node.open=false;});
    const before=await snapshot();
    const point=await control.evaluate(button=>{
      const b=button.getBoundingClientRect(),cell=button.closest('.invite-overview-service-info,.invite-overview-delivery').getBoundingClientRect();
      return cell.right-b.right>3?{x:b.right+2,y:b.top+b.height/2}:null;
    });
    assert.ok(point,'fixture retains blank space after the compact copy chip');
    await page.mouse.click(point.x,point.y);
    assert.deepEqual(await snapshot(),before,'blank cell space does not copy, select or change delivery state');
    assert.equal(await row.evaluate(node=>node.open),true,'blank space keeps the normal household disclosure action');
  }
  await page.locator('#inviteRowsLayout input[value="2"]').check();
  await row.evaluate(node=>{node.open=false;});
  const beforeContact=await snapshot();
  await row.locator('.invite-overview-service-info > .invite-overview-recipient').click();
  assert.deepEqual(await snapshot(),beforeContact,'plain contact detail is outside the Service copy action');
  assert.equal(await row.locator('.invite-copy-recipient .invite-overview-recipient').count(),0,'the Service copy button contains only its service chip');
  await page.locator('#inviteRowsLayout input[value="1"]').check();
  await row.evaluate(node=>{node.open=false;});
  const beforeKeyboard=await page.evaluate(()=>window.__invitesCopied.length);
  await row.locator('.invite-copy-recipient').focus();await page.keyboard.press('Enter');
  await row.locator('.invite-copy-invitation').focus();await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>window.__invitesCopied.length),beforeKeyboard+2,'compact native buttons retain Enter/Space copying');
  assert.equal(await row.evaluate(node=>node.open),false,'keyboard copying does not toggle the household');
}

async function checkInvitesPictureCopy(page, prepared) {
  const row=page.locator('[data-invite-household="'+prepared.id+'"]');
  const invitation=row.locator('.invite-copy-invitation'),text=row.locator('.invite-copy-text');
  const originalQueue=await page.evaluate(()=>JSON.stringify(window.__invitesStore.queue));
  await page.evaluate(code=>{
    window.__imageCopyBefore={helper:window.RSVP_INVITATION_IMAGE,queue:structuredClone(window.__invitesStore.queue)};
    window.__imageCopyCalls=[];
    window.RSVP_INVITATION_IMAGE={...window.RSVP_INVITATION_IMAGE,writeClipboard:(picture,message,{isCurrent})=>{
      const call={image:picture.image,message,currentAtStart:isCurrent()};window.__imageCopyCalls.push(call);
      return new Promise((resolve,reject)=>{window.__completeImageCopy=fail=>{call.currentAtCompletion=isCurrent();delete window.__completeImageCopy;fail?reject(Error('Synthetic image clipboard failure')):resolve();};});
    }};
    const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');
    q.message_image={image:'data:image/jpeg;base64,c3ludGhldGlj'};
    q.message_body='Saved Føroyskt — 🧪\r\n{invitation_link}';q.invitation_code_snapshot=code;
    window.__invitesTestView.render();
  },prepared.code);
  const state=()=>page.evaluate(()=>({
    calls:window.__calls.length,queue:JSON.stringify(window.__invitesStore.queue),
    selected:[...document.querySelectorAll('#inviteRows [data-bulk-select]:checked')].map(node=>node.dataset.bulkSelect),
    copies:window.__invitesCopied.length,
  }));
  const before=await state();
  const expected='Saved Føroyskt — 🧪\r\n'+prepared.link;
  assert.equal(await text.count(),1,'an invitation with a saved picture offers a separate Text fallback');
  assert.match(await invitation.getAttribute('aria-label'),/^Copy picture and text · /);
  assert.match(await text.getAttribute('aria-label'),/^Copy message · /);
  for(const control of [invitation,text])assert.equal(await control.evaluate(button=>{
    const b=button.getBoundingClientRect(),pill=button.querySelector('.invite-copy-pill').getBoundingClientRect();
    return b.width>=27.5&&b.height>=27.5&&['left','top','width','height'].every(key=>Math.abs(b[key]-pill[key])<=1);
  }),true,'picture and Text copy hit areas both match their visible chips');
  const otherId=await page.locator('#inviteRows [data-invite-household]:not([data-invite-household="'+prepared.id+'"]) .invite-copy-recipient:not(:disabled)').first().evaluate(button=>button.closest('[data-invite-household]').dataset.inviteHousehold);
  const other=page.locator('#inviteRows [data-invite-household="'+otherId+'"] .invite-copy-recipient');
  await row.evaluate(node=>{node.open=false;});
  await invitation.click();
  assert.equal(await page.locator('#inviteRows [data-invite-copy]:not(:disabled)').count(),0,'pending image preparation disables copy actions across households');
  await other.dispatchEvent('click');await text.dispatchEvent('click');
  assert.deepEqual(await state(),before,'pending image preparation cannot overwrite a recipient/message or change selection/delivery state');
  assert.deepEqual(await page.evaluate(()=>window.__imageCopyCalls),[{image:'data:image/jpeg;base64,c3ludGhldGlj',message:expected,currentAtStart:true}]);
  await page.evaluate(()=>window.__completeImageCopy(false));
  await page.waitForFunction(()=>window.__invitesFeedback.at(-1)?.[0]==='Picture and text copied. Check the caption after pasting.');
  assert.equal(await row.evaluate(node=>node.open),false,'picture copy does not toggle household details');
  assert.equal(await text.isEnabled(),true,'image completion restores the Text fallback');
  assert.equal(await other.isEnabled(),true,'image completion restores other household copy actions');
  assert.deepEqual(await state(),before,'completed picture copy preserves selected households and saved delivery records');
  await text.click();
  assert.equal(await page.evaluate(()=>window.__invitesCopied.at(-1)),expected,'Text copies the exact saved message and invitation link');
  assert.equal(await page.evaluate(()=>window.__imageCopyCalls.length),1,'Text never invokes image conversion');
  for(const change of ['image','revision','queue','actor','permission','disconnected']){
    await page.evaluate(()=>{
      delete window.__invitesActorOverride;delete window.__invitesPermission;
      window.__invitesStore.queue=structuredClone(window.__imageCopyBefore.queue);
      const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');
      q.message_image={image:'data:image/jpeg;base64,c3ludGhldGlj'};q.message_body='Saved Føroyskt — 🧪\r\n{invitation_link}';
      window.__invitesTestView.render();
    });
    const beforeFeedback=await page.evaluate(()=>window.__invitesFeedback.length);
    await invitation.click();
    await page.evaluate(change=>{
      const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');
      if(change==='image')q.message_image.image='data:image/jpeg;base64,Y2hhbmdlZA==';
      if(change==='revision')q.revision++;
      if(change==='queue'){window.__invitesStore.queue.push({...q,id:'new-image-draft',status:'draft',created_at:'2026-11-30T12:00:00Z',updated_at:'2026-11-30T12:00:00Z'});}
      if(change==='actor')window.__invitesActorOverride=null;
      if(change==='permission')window.__invitesPermission=false;
      if(change==='disconnected')window.__invitesTestView.render();
      window.__completeImageCopy(false);
    },change);
    assert.equal(await page.evaluate(()=>window.__imageCopyCalls.at(-1).currentAtCompletion),false,'the helper sees stale '+change+' before image completion');
    assert.equal(await page.evaluate(()=>window.__invitesFeedback.length),beforeFeedback,'stale '+change+' suppresses late image-copy feedback');
    if(['actor','permission'].includes(change))assert.equal(await page.locator('#inviteRows [data-invite-copy]:not(:disabled)').count(),0,'copy completion keeps revoked '+change+' controls disabled');
    else assert.equal(await text.isEnabled(),true,'copy completion restores fresh valid controls after '+change);
    assert.equal(await page.evaluate(()=>window.__calls.length),before.calls,'image copy never invokes a backend operation');
  }
  await page.evaluate(()=>{
    delete window.__invitesActorOverride;delete window.__invitesPermission;
    window.__invitesStore.queue=structuredClone(window.__imageCopyBefore.queue);
    const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');
    q.message_image={image:'data:image/jpeg;base64,c3ludGhldGlj'};q.status='draft';window.__invitesTestView.render();
  });
  assert.equal(await text.count(),1,'a saved Draft picture also offers the Text fallback');
  const beforeFailure=await page.evaluate(()=>window.__invitesCopied.length);
  await invitation.click();await page.evaluate(()=>window.__completeImageCopy(true));
  await page.waitForFunction(()=>window.__invitesFeedback.at(-1)?.[0]==='Picture and text could not be copied. Use Text to copy the invitation message.');
  assert.equal(await page.evaluate(()=>window.__invitesCopied.length),beforeFailure,'failed image copy never silently replaces the clipboard with text');
  assert.equal(await text.isEnabled(),true,'failed image copy leaves a deliberate Text fallback');
  await page.evaluate(()=>{
    window.RSVP_INVITATION_IMAGE=window.__imageCopyBefore.helper;window.__invitesStore.queue=window.__imageCopyBefore.queue;
    delete window.__imageCopyBefore;delete window.__completeImageCopy;window.__invitesTestView.render();
  });
  assert.equal(await text.count(),0,'invitations without a picture keep the single existing copy chip');
  assert.deepEqual({...await state(),copies:before.copies},{...before,queue:originalQueue},'picture and fallback copies preserve selection, backend history and saved invitation records');
}

async function checkInvitesCopyAndFilters(page) {
  const saved=await page.evaluate(()=>({permissions:structuredClone(window.__accessPermissions),settings:structuredClone(fixtures.event_settings),households:structuredClone(fixtures.households),guests:structuredClone(fixtures.guests),queue:structuredClone(fixtures.invitation_send_queue),languages:structuredClone(fixtures.event_languages)}));
  await page.evaluate(()=>{window.__accessPermissions.preset='custom';window.__accessPermissions.sections.invites='view';window.__accessPermissions.sections.food='view';window.__accessPermissions.sendInvites=false;});
  await refreshFixture(page);await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);
  await page.locator('[data-tab=invites]').click();
  const prepared=await page.evaluate(()=>{
    const store=window.__invitesStore,h=store.households.find(h=>h.id===h3),q=store.queue.find(q=>q.id==='queue-ready');
    store.settings.is_published=true;store.settings.food_enabled=true;store.settings.food_stage='interest';
    q.message_body='Original saved invitation\n{invitation_link}';q.invitation_code_snapshot=h.invite_code;q.recipient_snapshot.contact_name='Copy test';q.recipient_snapshot.contact_type='phone';q.recipient_snapshot.contact_value='+298 12 34 56';
    window.__invitesCopied=[];window.__invitesFeedback=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__invitesCopied.push(value);}}});
    window.__invitesTestView.render();return {id:h.id,code:h.invite_code,link:window.RSVP.invitationURL(h.invite_code)};
  });
  const row=page.locator('[data-invite-household="'+prepared.id+'"]'),recipient=row.locator('.invite-copy-recipient'),invitation=row.locator('.invite-copy-invitation');
  const calls=await page.evaluate(()=>window.__calls.length),queueBefore=await page.evaluate(()=>JSON.stringify(window.__invitesStore.queue));
  await row.evaluate(node=>{node.open=false;});
  await recipient.click();await invitation.click();
  assert.deepEqual(await page.evaluate(()=>window.__invitesCopied),['+298 12 34 56','Original saved invitation\n'+prepared.link]);
  assert.equal(await row.evaluate(node=>node.open),false,'copy buttons do not toggle household disclosure');
  assert.equal(await page.evaluate(()=>window.__calls.length),calls,'Invites copying uses no RPC');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.__invitesStore.queue)),queueBefore,'copying preserves saved delivery/status/history');
  await checkCompactCopyTargets(page,row);
  await checkInvitesPictureCopy(page,prepared);
  // The old rendered button must read the actual current store at click time.
  await page.evaluate(()=>{const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');q.message_body='Newest Føroyskt — 🧪\r\n{invitation_link}';});
  await invitation.click();assert.equal(await page.evaluate(()=>window.__invitesCopied.at(-1)),'Newest Føroyskt — 🧪\r\n'+prepared.link);
  await page.evaluate(id=>{
    const store=window.__invitesStore,q=store.queue.find(q=>q.id==='queue-ready');
    store.queue.push({...q,id:'new-current-draft',status:'draft',message_body:'New saved draft\n{invitation_link}',created_at:'2026-11-21T12:00:00Z',updated_at:'2026-11-21T12:00:00Z'});
    store.queue.push({...q,id:'newer-cancelled',status:'cancelled',message_body:'Cancelled content',created_at:'2026-11-22T12:00:00Z',updated_at:'2026-11-22T12:00:00Z'});
  },prepared.id);
  await invitation.click();assert.equal(await page.evaluate(()=>window.__invitesCopied.at(-1)),'New saved draft\n'+prepared.link,'newest noncancelled draft replaces old Ready without rerender');
  for(const state of ['sent','failed']){
    await page.evaluate(state=>{window.__invitesStore.queue.find(q=>q.id==='new-current-draft').status=state;window.__invitesTestView.render();},state);
    assert.equal(await invitation.isDisabled(),true,'new '+state+' record prevents copying older Ready');
  }
  await page.evaluate(()=>{window.__invitesStore.queue=window.__invitesStore.queue.filter(q=>!['new-current-draft','newer-cancelled'].includes(q.id));});
  for(const invalid of ['stale-code','missing-link','unresolved']){
    await page.evaluate(invalid=>{const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');q.invitation_code_snapshot=invalid==='stale-code'?'RETIREDX':'';q.message_body=invalid==='missing-link'?'Missing link':invalid==='unresolved'?'Unknown {other} {invitation_link}':'Current {invitation_link}';window.__invitesTestView.render();},invalid);
    assert.equal(await invitation.isDisabled(),true,invalid+' cannot authorize invitation copy');
  }
  await page.evaluate(()=>{const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');q.message_body='Valid {invitation_link}';q.invitation_code_snapshot='';window.__invitesTestView.render();window.__invitesPermission=false;});
  const beforeMissing=await page.evaluate(()=>window.__invitesCopied.length);
  await page.evaluate(id=>{delete window.__invitesPermission;window.__invitesStore.households.find(h=>h.id===id).archived_at='2026-11-20T12:00:00Z';},prepared.id);
  await invitation.dispatchEvent('click');await recipient.dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.__invitesCopied.length),beforeMissing,'a removed/archived current household cannot be copied from stale controls');
  await page.evaluate(id=>{delete window.__invitesStore.households.find(h=>h.id===id).archived_at;window.__invitesPermission=false;},prepared.id);
  const beforeDenied=await page.evaluate(()=>window.__invitesCopied.length);await invitation.dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.__invitesCopied.length),beforeDenied,'a lost view permission is checked at click');
  await page.evaluate(()=>{delete window.__invitesPermission;window.__invitesTestView.render();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Synthetic clipboard failure');}}});});
  await invitation.click();await page.waitForFunction(()=>window.__invitesFeedback.at(-1)?.[1]==='error');
  assert.equal(await invitation.isEnabled(),true,'clipboard failure leaves the valid action available for a deliberate retry');
  for(const change of ['value','actor','permission','disconnected']){
    await page.evaluate(()=>{delete window.__invitesActorOverride;delete window.__invitesPermission;window.__invitesTestView.render();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>{window.__invitesCopied.push(value);return new Promise(resolve=>window.__finishInvitesCopy=resolve);}}});});
    const before=await page.evaluate(()=>({copies:window.__invitesCopied.length,feedback:window.__invitesFeedback.length}));
    await invitation.click();assert.equal(await invitation.isDisabled(),true);await invitation.dispatchEvent('click');
    assert.equal(await page.evaluate(()=>window.__invitesCopied.length),before.copies+1,'pending clipboard work cannot be duplicated by the same button');
    await page.evaluate(change=>{if(change==='value')window.__invitesStore.queue.find(q=>q.id==='queue-ready').message_body='Changed during copy {invitation_link}';if(change==='actor')window.__invitesActorOverride=null;if(change==='permission')window.__invitesPermission=false;if(change==='disconnected')window.__invitesTestView.render();window.__finishInvitesCopy();delete window.__finishInvitesCopy;},change);
    assert.equal(await page.evaluate(()=>window.__invitesFeedback.length),before.feedback,'changed '+change+' suppresses late clipboard feedback');
    assert.equal(await page.evaluate(()=>window.__invitesCopied.length),before.copies+1,'completion never starts another write');
  }
  await page.evaluate(()=>{delete window.__invitesActorOverride;delete window.__invitesPermission;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.__invitesCopied.push(value)}});
    const store=window.__invitesStore,base=store.households.find(h=>h.id===h3);store.languages.push({language_code:'zz',display_name:'Disabled fixture language',enabled:false,sort_order:99});
    const add=(id,name,code,service,language)=>{const guest=id+'-guest';store.households.push({id,household_name:name,primary_guest_id:guest,planning_group_id:base.planning_group_id,relation_group_id:base.relation_group_id,language,invite_code:code,rsvp_state:'open'});store.guests.push({id:guest,household_id:id,first_name:name,mobile:'+1 (202) 555-0134',preferred_contact_method:service==='messages'?null:service});if(service==='none')store.queue.push({id:id+'-queue',household_id:id,channel:'manual',status:'draft',revision:1,created_at:'2026-11-20T12:00:00Z',updated_at:'2026-11-20T12:00:00Z',recipient_snapshot:{contact_name:'Postal fixture',contact_type:'address',contact_value:'Synthetic address'},message_body:'None {invitation_link}',invitation_code_snapshot:code});};
    add('invites-default-mobile','Default mobile fixture','YZAB2345','messages','zz');add('invites-none-service','None service fixture','YZAB2346','none','en');window.__invitesTestView.render();});
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),1,'All includes a represented disabled language');
  await chooseInviteFilter(page,'inviteChannelFilter',['email','messages']);
  assert.equal(await page.locator('[data-invite-household="22222222-2222-4222-8222-222222222222"]').count(),1,'OR includes the selected Email service');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),1,'OR also includes the selected Messages service');
  assert.equal(await page.locator('[data-invite-household="invites-none-service"]').count(),0,'OR excludes an unselected service');
  await chooseInviteFilter(page,'inviteLanguageFilter',['zz']);assert.equal(await page.locator('#inviteRows .invite-household').count(),1,'different dropdowns combine with AND');
  await chooseInviteFilter(page,'inviteLanguageFilter');await chooseInviteFilter(page,'inviteChannelFilter',['none']);
  assert.equal(await page.locator('[data-invite-household="invites-none-service"]').count(),1);assert.equal(await page.locator('[data-invite-household="invites-none-service"] .invite-copy-recipient').isDisabled(),true,'None/postal is not a digital recipient');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),0,'None excludes the Messages service');
  await chooseInviteFilter(page,'inviteChannelFilter',['messages']);await chooseInviteFilter(page,'inviteLanguageFilter',['zz']);
  assert.equal(await page.locator('#inviteRows .invite-household').count(),1,'explicit disabled-language choice still works');
  const mobile=page.locator('[data-invite-household="invites-default-mobile"] .invite-copy-recipient');
  assert.equal(await mobile.locator('small').count(),0,'the primary contact copy pill omits service details');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"] .invite-copy-recipient .invite-copy-pill').innerText(),'Messages','mandatory Service displays its label while copying the actual number');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"] .invite-overview-recipient button').count(),0,'contact person stays plain text');
  await mobile.click();
  assert.equal(await page.evaluate(()=>window.__invitesCopied.at(-1)),'+1 (202) 555-0134','default Messages uses the actual mobile number');
  await chooseInviteFilter(page,'inviteChannelFilter',[]);assert.equal(await page.locator('#inviteRows .invite-household').count(),0,'no services selected matches no household');
  for(const id of ['inviteChannelFilter','inviteLanguageFilter','inviteGroupFilter','deliveryStatusFilter'])await chooseInviteFilter(page,id);
  const unanswered=page.locator('[data-invite-food-filter="unanswered"]'),yes=page.locator('[data-invite-food-filter="yes"]');
  await unanswered.click();assert.equal(await unanswered.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),1,'Food Unanswered includes the synthetic unresponded household');
  await yes.click();assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),0,'Food Yes filters the same shared list');
  await yes.click();assert.equal(await yes.getAttribute('aria-pressed'),'false','repeating the selected Food row restores All');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),1);
  await unanswered.click();await page.locator('[data-invite-filter="all"]').click();assert.equal(await unanswered.getAttribute('aria-pressed'),'false','status All also clears the Food filter');
  const deliveryLog=page.locator('#deliveryStatusFilter').locator('xpath=ancestor::details[1]');
  if(!await deliveryLog.evaluate(node=>node.open))await deliveryLog.locator(':scope > summary').click();
  await chooseInviteFilter(page,'deliveryStatusFilter',['ready','sent']);
  const logBefore=await page.locator('#deliveryLog [data-delivery-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.deliveryId));
  await page.evaluate(id=>window.__invitesTestView.openHousehold(id),prepared.id);
  assert.deepEqual(await page.evaluate(()=>[...window.__invitesTestView.deliveryStatuses()].sort()),['ready','sent'],'View in Invites preserves the independent delivery-log filter');
  assert.equal(await page.locator('#deliveryStatusFilter [data-value="draft"]').getAttribute('aria-pressed'),'false');
  assert.deepEqual(await page.locator('#deliveryLog [data-delivery-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.deliveryId)),logBefore,'navigation leaves the filtered delivery-log rows unchanged');
  await chooseInviteFilter(page,'deliveryStatusFilter');
  await page.evaluate(saved=>{Object.assign(window.__accessPermissions,saved.permissions);fixtures.event_settings=saved.settings;fixtures.households=saved.households;fixtures.guests=saved.guests;fixtures.invitation_send_queue=saved.queue;fixtures.event_languages=saved.languages;delete window.__invitesPermission;delete window.__invitesActorOverride;},saved);
  await refreshFixture(page);await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);
}

async function checkManualInvitations(page) {
  const ids = await page.evaluate(() => {
    window.__draftWrites = []; window.__sentWrites = []; window.__copied = []; window.__opened = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copied.push(value); } } });
    window.open = (...args) => { window.__opened.push(args); return null; };
    fixtures.event_settings[0].is_published = false;
    window.__accessPermissions.preset = 'custom'; window.__accessPermissions.sections.invites = 'view'; window.__accessPermissions.sendInvites = true;
    return Array.from({length:12},(_,index)=>{
      const id=crypto.randomUUID(),guest=crypto.randomUUID(),queue=crypto.randomUUID(),alphabet='ABCDEFGHJKLMNP';
      const code='MNPQRS'+alphabet[index]+alphabet[index+1],link=window.RSVP.invitationURL(code),status=index===1?'ready':'draft';
      fixtures.households.push({id,household_name:'Manual '+String(index+1).padStart(2,'0'),language:'en',invite_code:code,primary_guest_id:guest,rsvp_state:'open'});
      fixtures.guests.push({id:guest,household_id:id,first_name:'Manual',mobile:'+298 12 34 56',preferred_contact_method:'whatsapp'});
      fixtures.invitation_send_queue.push({id:queue,household_id:id,channel:'whatsapp',contact_id:null,status,revision:1,
        created_at:'2026-11-20T12:00:00Z',updated_at:'2026-11-20T12:00:00Z',message_subject:'Manual invitation',
        message_body:index===3?'':status==='ready'?'Ready invitation\n'+link:'Full draft invitation\n{invitation_link}',
        invitation_code_snapshot:index===2?'RETIREDX':code,
        recipient_snapshot:{contact_name:'Manual contact',contact_type:'phone',contact_value:'+298 12 34 56'}});
      return {id,queue,code,link};
    });
  });
  await refreshFixture(page); await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);
  await page.locator('[data-tab=invites]').click();
  const bulk=page.locator('#bulkInvitesHost'),mark=bulk.getByRole('group',{name:'Action',exact:true}).getByRole('button',{name:'Mark Sent',exact:true});
  const input=id=>page.locator('#inviteRows [data-bulk-select="'+id+'"]');
  const row=id=>page.locator('#inviteRows .invite-household',{has:page.locator('[data-bulk-select="'+id+'"]')});
  const sentCount=()=>page.evaluate(()=>window.__sentWrites.length);
  const clear=async()=>{for(const id of await page.locator('#inviteRows [data-bulk-select]:checked').evaluateAll(nodes=>nodes.map(n=>n.dataset.bulkSelect)))await input(id).uncheck();};
  const select=async values=>{await clear();for(const item of values)await input(item.id).check();};
  const message=async text=>bulk.locator('[role=status]').filter({hasText:text}).waitFor();
  const refresh=async()=>{await refreshFixture(page);await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);};
  assert.equal(await row(ids[0].id).evaluate(n=>n.tagName),'DETAILS');
  assert.equal(await row(ids[0].id).locator('label.bulk-invite-select').count(),1);
  const beforeCopy=await page.evaluate(()=>({draft:window.__draftWrites.length,sent:window.__sentWrites.length,calls:window.__calls.length}));
  const openBefore=await row(ids[0].id).evaluate(node=>node.open);
  await row(ids[0].id).locator('.invite-copy-recipient').click();await page.waitForFunction(()=>window.__copied.length===1);
  assert.equal(await page.evaluate(()=>window.__copied[0]),'+298 12 34 56');
  assert.equal(await row(ids[0].id).locator('.invite-copy-invitation').isDisabled(),true,'unpublished invitation text cannot be copied');
  assert.equal(await input(ids[0].id).isChecked(),false,'copy actions do not change shared selection');
  assert.equal(await row(ids[0].id).evaluate(node=>node.open),openBefore,'copying does not toggle disclosure');
  await input(ids[0].id).focus();await page.keyboard.press('Space');assert.equal(await input(ids[0].id).isChecked(),true);
  assert.equal(await row(ids[0].id).evaluate(node=>node.open),openBefore,'checkbox Space does not toggle household disclosure');
  await page.keyboard.press('Space');assert.equal(await input(ids[0].id).isChecked(),false);
  assert.deepEqual(await page.evaluate(()=>({draft:window.__draftWrites.length,sent:window.__sentWrites.length,calls:window.__calls.length})),beforeCopy,'copying and selection use no RPC');
  assert.deepEqual(await page.evaluate(()=>window.__opened),[],'manual copying opens no app or tab');
  await input(ids[0].id).check();await chooseInviteFilter(page,'inviteChannelFilter',['email']);
  assert.equal(await page.locator('#inviteRows [data-bulk-select]:checked').count(),0,'a hidden selected household is removed from the shared selection');
  assert.equal(await bulk.locator('.bulk-invite-count').count(),0,'hidden selection does not recreate a counter');
  assert.equal(await mark.isDisabled(),true,'hidden selection leaves Mark Sent disabled');
  await chooseInviteFilter(page,'inviteChannelFilter');
  for(const item of ids.slice(0,10))await input(item.id).check();
  assert.equal(await page.locator('#inviteRows [data-bulk-select]:checked').count(),10);
  assert.equal(await input(ids[10].id).isDisabled(),true,'selection remains limited to ten');
  await clear(); await select([ids[2]]);
  const beforeInvalid=await page.evaluate(()=>window.__draftWrites.length);
  assert.equal(await mark.isDisabled(),true); await mark.dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.__draftWrites.length),beforeInvalid,'stale-code selected draft performs no preparation');
  await select([ids[3]]); assert.equal(await mark.isDisabled(),true); await mark.dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.__draftWrites.length),beforeInvalid,'missing body performs no preparation');
  await select([ids[0]]);
  await mark.dispatchEvent('click'); assert.equal(await sentCount(),0,'unpublished drafts cannot be marked sent');
  await page.evaluate(()=>{fixtures.event_settings[0].is_published=true;window.__accessPermissions.sendInvites=false;}); await refresh();
  await mark.dispatchEvent('click'); assert.equal(await sentCount(),0,'send permission is required');
  await page.evaluate(()=>{window.__accessPermissions.sendInvites=true;}); await refresh();
  assert.equal(await mark.isDisabled(),true,'view-only user cannot promote a draft');
  await select([ids[1]]); assert.equal(await mark.isEnabled(),true,'ready records need no draft-edit permission');
  await mark.click(); await message('1 invitation marked sent.');
  assert.deepEqual(await page.evaluate(()=>window.__sentWrites[0]),{p_queue_id:ids[1].queue,p_expected_revision:1,p_note:''});
  await page.evaluate(()=>{window.__accessPermissions.sections.invites='edit';}); await refresh();
  await page.locator('[data-invite-filter=not-sent]').click();
  assert.equal(await input(ids[0].id).count(),1);assert.equal(await input(ids[1].id).count(),0,'Not sent excludes the completed Sent household');
  await select([ids[0],ids[4]]);
  await mark.evaluate(n=>{n.click();n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  await message('2 invitations marked sent.');
  assert.deepEqual(await page.evaluate(()=>window.__sentWrites.slice(1).map(w=>[w.p_queue_id,w.p_expected_revision])),[[ids[0].queue,2],[ids[4].queue,2]],'two Drafts survive intermediate Ready reload/pruning and use captured revision+1');
  assert.equal(await page.evaluate(()=>fixtures.invitation_deliveries.filter(d=>[window.__sentWrites[1].p_queue_id,window.__sentWrites[2].p_queue_id].includes(d.queue_id)).length),2,'repeated click records each selected household once');
  await page.locator('[data-invite-filter=all]').click();
  // A selected Ready record can finish before another selected Draft needs a reload.
  await page.evaluate(item=>{const q=fixtures.invitation_send_queue.find(q=>q.id===item.queue);q.status='ready';q.message_body='Mixed ready\n'+item.link;},ids[5]); await refresh();
  await select([ids[5],ids[6]]); await mark.click(); await message('2 invitations marked sent.');
  assert.deepEqual(await page.evaluate(()=>window.__sentWrites.slice(-2).map(w=>w.p_expected_revision)),[1,2]);
  // Stop accurately after one successful Sent and one server failure.
  await page.evaluate(items=>{for(const item of items){const q=fixtures.invitation_send_queue.find(q=>q.id===item.queue);q.status='ready';q.message_body='Partial ready\n'+item.link;}window.__failSent=items[1].queue;},[ids[7],ids[8]]); await refresh();
  await select([ids[7],ids[8]]); await mark.click(); await message('Marking sent stopped.');
  assert.match(await bulk.locator('[role=status]').last().innerText(),/1 invitation marked sent\./);
  assert.deepEqual(await page.evaluate(items=>items.map(item=>fixtures.invitation_send_queue.find(q=>q.id===item.queue).status),[ids[7],ids[8]]),['sent','ready']);
  const firstWrites=await page.evaluate(id=>window.__sentWrites.filter(w=>w.p_queue_id===id).length,ids[7].queue);
  await mark.click(); await message('1 invitation marked sent.');
  assert.equal(await page.evaluate(id=>window.__sentWrites.filter(w=>w.p_queue_id===id).length,ids[7].queue),firstWrites,'retry cannot repeat the already Sent member');
  // A stale revision is rejected by the existing Sent RPC, leaving Ready intact.
  await page.evaluate(item=>{const q=fixtures.invitation_send_queue.find(q=>q.id===item.queue);q.status='ready';q.message_body='Stale revision\n'+item.link;window.__holdSent=q.id;},ids[3]); await refresh();
  await select([ids[3]]); const beforeStale=await page.evaluate(()=>fixtures.invitation_deliveries.length); await mark.click();
  await page.waitForFunction(()=>typeof window.__resumeSent==='function');
  await page.evaluate(id=>{fixtures.invitation_send_queue.find(q=>q.id===id).revision++;window.__resumeSent();},ids[3].queue);
  await message('Marking sent stopped.'); assert.equal(await page.evaluate(()=>fixtures.invitation_deliveries.length),beforeStale);
  // A Ready acknowledgment for another UUID cannot authorize the Sent write.
  await page.evaluate(item=>{const q=fixtures.invitation_send_queue.find(q=>q.id===item.queue);q.invitation_code_snapshot=item.code;window.__badReadyAck=q.id;},ids[2]); await refresh();
  await select([ids[2]]); const beforeAck=await sentCount(); await mark.click(); await message('Marking sent stopped.');
  assert.equal(await sentCount(),beforeAck); assert.equal(await page.evaluate(id=>fixtures.invitation_send_queue.find(q=>q.id===id).status,ids[2].queue),'ready');
  // A rebuilt recipient snapshot must still match what the operator copied.
  await page.evaluate(id=>window.__swapReadyRecipient=id,ids[9].queue); await select([ids[9]]);
  const beforeRecipient=await sentCount(); await mark.click(); await message('Marking sent stopped.');
  assert.equal(await sentCount(),beforeRecipient); assert.equal(await page.evaluate(id=>fixtures.invitation_send_queue.find(q=>q.id===id).status,ids[9].queue),'ready');
  // Selection change after a persisted Ready save stops before the Sent write.
  await page.evaluate(id=>window.__holdReady=id,ids[10].queue); await select([ids[10]]); await mark.click();
  await page.waitForFunction(()=>typeof window.__resumeReady==='function');
  await input(ids[10].id).evaluate(n=>{n.checked=false;n.dispatchEvent(new Event('change',{bubbles:true}));});
  const beforeSelection=await sentCount(); await page.evaluate(()=>window.__resumeReady()); await message('Marking sent stopped.');
  assert.equal(await sentCount(),beforeSelection); assert.equal(await page.evaluate(id=>fixtures.invitation_send_queue.find(q=>q.id===id).status,ids[10].queue),'ready');
  // An unrelated Services change can still cancel a captured operation while
  // its Ready promotion is pending; this is distinct from its own status change.
  await page.evaluate(item=>{const q=fixtures.invitation_send_queue.find(q=>q.id===item.queue);q.status='draft';window.__holdReady=q.id;},ids[3]);await refresh();
  await select([ids[3]]);await mark.click();await page.waitForFunction(()=>typeof window.__resumeReady==='function');
  const beforeFiltered=await sentCount();await chooseInviteFilter(page,'inviteChannelFilter',['email']);
  await page.evaluate(()=>window.__resumeReady());await message('Marking sent stopped.');
  assert.equal(await sentCount(),beforeFiltered,'hiding the captured household prevents its Sent write');
  await chooseInviteFilter(page,'inviteChannelFilter');
  // Actor loss/logout clears the same controller and prevents the second write.
  await page.evaluate(id=>window.__holdReady=id,ids[11].queue); await select([ids[11]]); await mark.click();
  await page.waitForFunction(()=>typeof window.__resumeReady==='function');
  const beforeActor=await sentCount(); await page.evaluate(()=>{window.__bulkActorOverride=null;window.__bulkTestView.clear();window.__resumeReady();});
  await page.waitForFunction(()=>document.querySelector('#bulkInvitesHost').hidden);
  assert.equal(await sentCount(),beforeActor);
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } }),
        errors = [];
      page.setDefaultTimeout(8000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        localStorage.setItem("rsvp-interface-language", "en");
        let invitesFactory;
        Object.defineProperty(window, "RSVP_ADMIN_INVITES", { configurable: true,
          get: () => invitesFactory,
          set: value => { invitesFactory = { ...value, create: options => {
            const view=value.create({ ...options,
              getStore:()=>{window.__invitesStore=options.getStore();return window.__invitesStore;},
              getActor:()=>window.__invitesActorOverride===undefined?options.getActor():window.__invitesActorOverride,
              can:(...args)=>window.__invitesPermission!==false&&options.can(...args),
              show:(...args)=>{(window.__invitesFeedback??=[]).push(args);options.show(...args);},
            });window.__invitesTestView=view;return view;
          } }; },
        });
        let bulkFactory;
        Object.defineProperty(window, "RSVP_ADMIN_BULK_INVITES", { configurable: true,
          get: () => bulkFactory,
          set: value => { bulkFactory = { ...value, create: options => {
            const view = value.create({ ...options, getActor: () => window.__bulkActorOverride === undefined ? options.getActor() : window.__bulkActorOverride });
            window.__bulkTestView = view; return view;
          } }; },
        });
      });
      // Installed runtime config overrides local fixture preferences. Intercept
      // both config scripts so source and installed assets use synthetic APIs.
      for (const config of ["config.production.js", "config.js"]) {
        await page.route("**/js/" + config + "*", route => route.fulfill({
          contentType: "text/javascript",
          body: 'window.RSVP_CONFIG=Object.freeze({supabaseUrl:"https://fixture.supabase.invalid",supabaseKey:"sb_publishable_synthetic"});',
        }));
      }
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "Map fixture" }),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + overviewMock,
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/" + (width===1440?"#overview":""));
      await page.waitForFunction(
        () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
      );
      assert.equal(await page.evaluate(() => window.RSVP_CONFIG.supabaseUrl), "https://fixture.supabase.invalid",
        "source and installed bootstrap use the intercepted synthetic config");
      assert.equal(
        await page.locator("[data-panel=invites]").isVisible(),
        true,
        "Invites is the landing section",
      );
      assert.equal(
        await page
          .locator(".admin-main-tabs button")
          .first()
          .getAttribute("data-tab"),
        "invites",
      );
      assert.equal(await page.locator("[data-panel=dashboard]").count(), 0);
      assert.equal(await page.locator('[data-tab="overview"],[data-panel="overview"]').count(),0,'Overview is merged into Invites');
      assert.equal(await page.locator('#statsGrid').evaluate(node=>node.closest('[data-panel]').dataset.panel),'invites');
      if(width===1440)assert.equal(await page.evaluate(()=>location.hash),'#invites','legacy Overview bookmark is replaced by Invites');
      assert.equal(
        await page.locator('#inviteGroupBy [data-invite-grouping="relational"]').isChecked(),
        true,
        "grouping starts checked",
      );
      assert.ok(
        (await page.locator("#inviteRows .invite-overview-group").count()) > 0,
      );
      const geometry = await page.locator(".invite-household > summary").first().evaluate((summary) => {
        const identity = summary.querySelector('.invite-overview-identity'), name = identity.querySelector('strong');
        const reply=summary.querySelector('.invite-overview-reply').getBoundingClientRect(), food=summary.querySelector('.invite-overview-interest').getBoundingClientRect();
        return { extraArrow:getComputedStyle(identity,'::before').content, nameArrow:getComputedStyle(name,'::before').content, detailCells:summary.querySelectorAll('.invite-overview-household-info,.invite-overview-service-info').length, foodAfterReply:food.left>=reply.right-1, foodDomAfterReply:summary.querySelector('.invite-overview-reply').compareDocumentPosition(summary.querySelector('.invite-overview-interest'))&Node.DOCUMENT_POSITION_FOLLOWING, overflow:summary.scrollWidth>summary.clientWidth+1 };
      });
      assert.ok(['none','normal','""'].includes(geometry.extraArrow),'identity must not add a second arrow');
      assert.match(geometry.nameArrow,/›/);
      assert.equal(geometry.detailCells,1,'Service is mandatory while household detail starts hidden');
      assert.ok(geometry.foodDomAfterReply,'Food follows RSVP in the logical column order');
      if(width>1000)assert.equal(geometry.foodAfterReply,true,'Food follows RSVP horizontally in the wide view');
      assert.equal(geometry.overflow,false,'summary stays within its width');
      assert.deepEqual(await page.locator('.invite-overview-heading > span').allTextContents(),['Household','Recipient','Service','Invitation','Last sent','RSVP','Food interest','Actions','']);
      if (width > 1000) assert.equal(await page.evaluate(() => {
        const labels=[...document.querySelectorAll('.invite-overview-heading > span')], cells=[...document.querySelector('.invite-household > summary').children];
        return cells.every((cell,i)=>Math.abs(cell.getBoundingClientRect().left-labels[i].getBoundingClientRect().left)<3);
      }),true,'column headings align with their cells');
      if(process.env.RSVP_INVITE_PREVIEW_DIR){fs.mkdirSync(process.env.RSVP_INVITE_PREVIEW_DIR,{recursive:true});await page.locator('#inviteRows').screenshot({path:path.join(process.env.RSVP_INVITE_PREVIEW_DIR,`invites-${width}.png`)});}
      if(width===1440){await checkRowsPresentation(page);await checkGroupingPreservation(page);}
      await page.locator("#settingsToggle").click();
      assert.equal(
        await page
          .locator(".settings-tabs button")
          .first()
          .getAttribute("data-settings-tab"),
        "application",
      );
      await page.locator("[data-settings-tab=application]").click();
      assert.equal(
        await page
          .locator("[data-settings-panel=application] #launchChecklist")
          .isVisible(),
        true,
      );
      assert.equal(await page.locator("#statsGrid").isVisible(), false);
      await page.locator("#mainSectionToggle").click();
      assert.equal(
        await page.locator("[data-panel=invites]").isVisible(),
        true,
      );
      await page.goBack();
      assert.equal(
        await page.locator("[data-panel=settings]").isVisible(),
        true,
      );
      await page.goForward();
      assert.equal(
        await page.locator("[data-panel=invites]").isVisible(),
        true,
      );
      await setInvitesGrouping(page, false);
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        2,
      );
      assert.equal(
        await page.locator("#inviteRows .hierarchy-section").count(),
        0,
        "flat layout after unchecking grouping",
      );
      assert.match(
        await page.locator("[data-invite-filter=sent]").innerText(),
        /1/,
      );
      assert.match(
        await page.locator("[data-invite-filter=awaiting]").innerText(),
        /1/,
      );
      await page.locator("[data-invite-filter=ready]").click();
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      assert.match(
        await page.locator("#inviteRows").innerText(),
        /Other recipient/,
      );
      // A data reload must use fresh records without resetting the progress filter.
      await page.evaluate(() => {
        fixtures.invitation_send_queue.find(
          (q) => q.id === "queue-ready",
        ).recipient_snapshot.contact_name = "Refreshed recipient";
      });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      assert.equal(
        await page
          .locator("[data-invite-filter=ready]")
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      assert.match(
        await page.locator("#inviteRows").innerText(),
        /Refreshed recipient/,
      );
      assert.equal(
        await page.locator('#inviteGroupBy [data-invite-grouping="relational"]').isChecked(),
        false,
        "refresh preserves the chosen layout",
      );
      assert.equal(
        await page.locator("#inviteRows .invite-overview-group").count(),
        0,
      );
      await page.locator("[data-invite-filter=all]").click();
      await page.locator("#inviteSearchToggle").click();
      await page.locator("#inviteSearch").fill("example@example.invalid");
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await page.locator("#inviteSearch").fill("");
      await chooseInviteFilter(page,"inviteLanguageFilter",["de"]);
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await chooseInviteFilter(page,"inviteLanguageFilter");
      await chooseInviteFilter(page,"inviteChannelFilter",["email"]);
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await chooseInviteFilter(page,"inviteChannelFilter");
      await setInvitesGrouping(page, true);
      assert.ok((await page.locator(".invite-overview-group").count()) > 0);
      await setInvitesGrouping(page, false);

      const sent = page.locator(
        '[data-invite-household="22222222-2222-4222-8222-222222222222"]',
      );
      assert.equal(await page.locator('#inviteRows .invite-create,#inviteRows .invite-share').count(),0,'Invites has no create or share actions');
      // Draft generation is exercised through the shared Action box below. Keep existing
      // delivery editing and Sent-history checks using a saved draft fixture.
      const draftId = await page.evaluate(() => {
        const h = fixtures.households.find(h => h.id === h2), id = crypto.randomUUID();
        fixtures.invitation_send_queue.push({id,household_id:h.id,channel:'email',status:'draft',revision:1,
          created_at:'2026-11-20T12:00:00Z',updated_at:'2026-11-20T12:00:00Z',
          template_id:'overview-template',template_revision:'overview-revision',message_subject:'Synthetic subject',
          message_body:'Draft message {invitation_link}',invitation_code_snapshot:h.invite_code,
          recipient_snapshot:{contact_name:'Synthetic recipient',contact_value:'synthetic@example.invalid'}});
        window.__createdDraftId=id;window.__draftWrites=[];return id;
      });
      await refreshFixture(page);await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);
      await sent.evaluate(node=>{node.open=true;node.dispatchEvent(new Event('toggle'));});
      assert.equal(await sent.getByRole("button", { name: "Record as sent", exact: true }).count(), 0);
      await sent.locator("[data-delivery-id=queue-sent]").evaluate(node => { node.open = true; });
      assert.match(await sent.innerText(), /Manually recorded as sent/);
      const draft = sent.locator('[data-delivery-id="' + draftId + '"]');
      await draft.evaluate(node => { node.open = true; });
      await draft.getByText("Edit delivery", { exact: true }).click();
      const form = draft.locator("form.delivery-review-form");
      assert.equal(await form.getByRole("combobox", { name: "Delivery status", exact: true }).locator("option[value=ready]").count(), 0, "unpublished drafts cannot be marked Ready");
      await form.locator(".delivery-customize").evaluate(node => { node.open = true; });
      await form.getByRole("textbox", { name: "Message text", exact: true }).fill("Updated draft {invitation_link}");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__draftWrites.length === 1);
      assert.equal(await page.evaluate(() => window.__draftWrites[0].p_id), draftId);
      assert.equal(await page.evaluate(() => window.__draftWrites[0].p_values.status), "draft");
      assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.find(queue => queue.id === window.__createdDraftId).message_body), "Updated draft {invitation_link}");
      assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.find(queue => queue.id === "queue-sent").message_body), "Sent example");
      assert.equal(await page.evaluate(() => fixtures.invitation_deliveries.length), 1, "draft creation/editing preserves the original Sent confirmation");
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
      assert.match(await page.locator("[data-invite-filter=sent]").innerText(), /1/);
      assert.equal(await sent.locator('.invite-household-content > .shortcut-facts [data-shortcut-fact="visits"]').textContent(), "0", "every expanded household shows visit tracking without requiring a Shortcuts batch");
      assert.equal(await sent.locator('.invite-household-content > .shortcut-facts [data-shortcut-fact="rsvp"]').textContent(), "Awaiting reply", "Sent and zero visits do not imply RSVP confirmation");
      // The extracted view must pick up changed permissions on the next reload.
      await page.evaluate(() => {
        window.__accessPermissions.preset = "custom";
        window.__accessPermissions.sections.invites = "view";
      });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      assert.equal(await sent.getByRole("button", { name: "Create", exact: true }).count(), 0, "view-only invitation access cannot create drafts");
      await sent.evaluate(node => { node.open = true; node.dispatchEvent(new Event("toggle")); });
      await sent.locator("[data-delivery-id=queue-sent]").evaluate(node => { node.open = true; });
      assert.match(await sent.innerText(), /Sent example/);
      assert.match(await sent.innerText(), /Manually recorded as sent/);
      assert.equal(await sent.getByText("Edit delivery", { exact: true }).count(), 0, "view-only access keeps delivery records read-only");
      assert.equal(await sent.locator("form.delivery-review-form").count(), 0);
      assert.equal(await page.evaluate(() => window.__draftWrites.length), 1);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.evaluate(() => { window.__accessPermissions.sections.food = "none"; });
      await refreshFixture(page);
      await page.waitForFunction(() => !document.querySelector('#refreshButton').disabled);
      assert.equal(await page.locator('.invite-overview-interest').count(),0,'food column follows Food permission');
      assert.deepEqual(await page.locator('.invite-overview-heading > span').allTextContents(),['Household','Recipient','Service','Invitation','Last sent','RSVP','Actions',''],'Food permission removes only the Food column');
      if (width === 320 || width === 1440) await checkBulkDraftGeneration(page);
      if (width === 1440) { await checkInvitesCopyAndFilters(page); await checkManualInvitations(page); }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS Invites overview: responsive filters/drafts, exact clipboard text without selection or RPC, guarded manual Sent with captured revisions, multi-row reloads, partial recovery, recipient/selection/actor races and preserved history.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
