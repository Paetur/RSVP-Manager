const { refreshFixture, selectOverviewTab, setInvitesGrouping, setFixtureInviteRows, ensureInviteSelection } = require("./helpers/admin-toolbar.cjs");
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
fixtures.invitation_send_queue=[{id:'queue-sent',household_id:h2,channel:'email',status:'sent',message_body:'Sent example',created_at:'2026-11-10T12:00:00Z',updated_at:'2026-11-10T12:00:00Z',revision:2,recipient_snapshot:{contact_name:'Example recipient',contact_value:'example@example.invalid'}},{id:'queue-ready',household_id:h3,channel:'sms',status:'ready',message_body:'Ready example {invitation_link}',created_at:'2026-11-11T12:00:00Z',updated_at:'2026-11-11T12:00:00Z',revision:1,recipient_snapshot:{contact_name:'Other recipient',contact_value:'+298123456'}}];fixtures.invitation_deliveries=[{queue_id:'queue-sent',confirmed_at:'2026-11-10T12:00:00Z',confirmed_by:h1,message_snapshot:{channel:'email',subject:'Sent subject',body:'Sent example'},recipient_snapshot:{contact_name:'Example recipient'}}];
const overviewTemplate={
  id:'overview-template', revision:'overview-revision', name:'Synthetic invitation',
  channels:['email'], language_tags:['en','fo'],
  versions:{en:{language_code:'en',subject:'Synthetic subject',body:'Draft message {invitation_link}',options:['subject','message']}}
};
window.__readScopedFixture=({table,fields,key,value})=>{
  (window.__sentReads??=[]).push({table,fields,key,value});
  if(window.__failSentRead===value){
    window.__failSentRead=null;
    return {error:{message:'Synthetic confirmation read failure'}};
  }
};
const overviewRpc=client.rpc;
const guestChannels = window.__guestOverviewChannels = new Map();
client.channel = (topic, options) => {
  const record = { options, listener: null, channel: {
    on(type, filter, listener) { record.type = type; record.filter = filter; record.listener = listener; return this; },
    subscribe(listener) { listener("SUBSCRIBED"); return this; },
  } };
  guestChannels.set(topic, record);
  return record.channel;
};
client.removeChannel = channel => {
  for (const [topic, record] of guestChannels) if (record.channel === channel) guestChannels.delete(topic);
};
client.rpc=async(name,a)=>{
  if (name === "admin_guest_overview") {
    const state = window.__guestOverviewFixture;
    if (!state) return { error: { code: "PGRST202", message: "Synthetic previous backend" } };
    state.reads++;
    return { data: structuredClone(state.snapshot) };
  }
  if(name==='admin_invitation_activity'){
    const household=fixtures.households.find(item=>item.id===a.p_household_id);
    if(!household)return {data:null};
    (window.__activityReads??=[]).push(a.p_household_id);
    const activity=structuredClone(window.__activityFixture?.[a.p_household_id] || {
      first_visited_at:household.first_visited_at??null,
      last_visited_at:household.last_visited_at??null,
      visit_count:household.visit_count??0,
      invitation_loads:{first_at:null,last_at:null,count:0},
    });
    if(window.__holdActivityRead===a.p_household_id){
      window.__holdActivityRead=null;
      await new Promise(resolve=>window.__releaseActivityRead=resolve);
    }
    return {data:activity};
  }
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
      if(window.__holdReadyFor===a.p_household_id&&a.p_values.status==='ready'){
        window.__holdReadyFor=null;
        await new Promise(resolve=>window.__resumeReady=()=>{delete window.__resumeReady;resolve();});
      }
      const household=fixtures.households.find(h=>h.id===item.household_id);
      if(a.p_values.status==='ready'&&'expected_invitation_code' in a.p_values&&
          a.p_values.expected_invitation_code!==household.invite_code)
        return {error:{message:'Invitation has changed; prepare the delivery again'}};
      if(a.p_values.only_if_ready&&item.status!=='ready')return {error:{message:'Synthetic invitation is no longer ready'}};
      const values={...a.p_values};
      delete values.only_if_ready;
      Object.assign(item,values,{revision:item.revision+1,updated_at:'2026-11-12T13:00:00Z'});
      if(a.p_values.status==='ready')item.invitation_code_snapshot=household.invite_code;
    }else{
      const household=fixtures.households.find(h=>h.id===a.p_household_id);
      const guest=fixtures.guests.find(g=>g.id===household?.primary_guest_id&&!g.is_child&&!g.archived_at);
      const channel=a.p_values.channel;
      const hasPrimaryPhone=fixtures.household_contacts.some(c=>c.household_id===a.p_household_id&&c.is_household_primary&&!c.archived_at&&c.contact_type==='phone');
      // The production RPC stores the delivery channel as the snapshot type when it falls back to guest mobile.
      const recipient=!a.p_values.contact_id&&!hasPrimaryPhone&&guest?.mobile&&['sms','whatsapp'].includes(channel)
        ? {contact_name:[guest.first_name,guest.last_name].filter(Boolean).join(' '),contact_type:channel,contact_value:guest.mobile}
        : channel==='manual'
          ? {contact_name:household.household_name,contact_type:'manual',contact_value:household.household_name}
          : {contact_name:'Synthetic recipient',contact_value:'synthetic@example.invalid'};
      item={id:crypto.randomUUID(),household_id:a.p_household_id,...a.p_values,revision:1,
        created_at:'2026-11-12T12:00:00Z',updated_at:'2026-11-12T12:00:00Z',
        recipient_snapshot:recipient};
      fixtures.invitation_send_queue.push(item);
      window.__createdDraftId=item.id;
      if(window.__holdDraftFor===a.p_household_id){
        window.__holdDraftFor=null;
        await new Promise(resolve=>window.__resumeDraft=()=>{delete window.__resumeDraft;resolve();});
      }
    }
    return {data:item.id};
  }
  if(name==='admin_record_delivery_sent'){
    (window.__sentAttempts??=[]).push(a);
    if(window.__holdSent===a.p_queue_id){window.__holdSent=null;await new Promise(resolve=>window.__resumeSent=()=>{delete window.__resumeSent;resolve();});}
    const item=fixtures.invitation_send_queue.find(q=>q.id===a.p_queue_id),household=fixtures.households.find(h=>h.id===item?.household_id);
    if(!fixtures.event_settings[0].is_published||!window.__accessPermissions.sendInvites)return {error:{message:'Synthetic send permission denied'}};
    if(window.__failSent===a.p_queue_id){window.__failSent=null;return {error:{message:'Synthetic Sent failure'}};}
    if(!item||!household||household.archived_at||item.invitation_code_snapshot!==household.invite_code||!item.message_body||!item.recipient_snapshot?.contact_value)return {error:{message:'Synthetic stale invitation'}};
    (window.__sentWrites??=[]).push(a);
    if(item.status==='sent')return {data:fixtures.invitation_deliveries.find(delivery=>delivery.queue_id===item.id)?.id};
    if(item.status!=='ready'||item.revision!==a.p_expected_revision)return {error:{message:'Synthetic stale revision'}};
    const id=crypto.randomUUID();
    fixtures.invitation_deliveries.push({id,queue_id:item.id,confirmed_at:'2026-11-20T12:00:00Z',confirmed_by:h1});
    item.status='sent';item.sent_at=item.updated_at='2026-11-20T12:00:00Z';item.revision++;
    if(window.__loseSentResponse===a.p_queue_id){
      window.__loseSentResponse=null;
      window.__failSentRead=a.p_queue_id;
      return {error:{message:'Synthetic connection failure after confirmation'}};
    }
    return {data:id};
  }
  if(name==='admin_change_marker'&&window.__manualSendMarker)return {data:window.__manualSendMarker};
  if(name==='admin_load_data'){
    if(window.__holdBulkReload){
      window.__holdBulkReload=false;
      await new Promise(resolve=>window.__resumeBulkReload=()=>{delete window.__resumeBulkReload;resolve();});
    }
    if(window.__failBulkReload){
      window.__failBulkReload=false;
      return {error:{message:'Synthetic invite refresh failure'}};
    }
  }
  const result=await overviewRpc(name,a);
  if(name==='admin_load_data'){
    result.data.invitationTemplates=[overviewTemplate,...(window.__bulkTemplates||[])];
    if(window.__manualSendMarker)result.data.change_marker=window.__manualSendMarker;
  }
  return result;
};`;

async function checkLiveGuestOverview(page) {
  const ids = await page.evaluate(() => {
    const topic = "rsvp:guest-overview:invites";
    const ready = fixtures.invitation_send_queue.find(item => item.id === "queue-ready");
    const defaults = structuredClone(fixtures.household_session_defaults);
    const activeGuests = fixtures.guests.filter(guest => guest.household_id === h2);
    const state = window.__guestOverviewFixture = {
      reads: 0, defaults, originalRecord: structuredClone(ready),
      snapshot: {
        realtime: true, topics: [topic, "rsvp:guest-overview:food"],
        households: fixtures.households.map(({ id, rsvp_state }) => ({ id, rsvp_state, visit_count: 0, food_interest: null })),
        guests: fixtures.guests.map(({ id, household_id, is_child }) => ({ id, household_id, is_child: Boolean(is_child) })),
        responses: [], claims: [], overrides: [], submissions: 0,
      },
    };
    fixtures.household_session_defaults.push({ household_id: h2, session_id: s1, is_invited: true });
    Object.assign(ready, { status: "draft", channel: "manual", invitation_code_snapshot: fixtures.households.find(row => row.id === h3).invite_code });
    return { seen: h2, draft: h3, guest: activeGuests[0].id, session: s1, topic,
      guests: state.snapshot.guests.length, replies: activeGuests.length };
  });
  await refreshFixture(page);
  await page.waitForFunction(() => window.__guestOverviewFixture.reads >= 2);
  assert.deepEqual(await page.evaluate(() => [...window.__guestOverviewChannels].map(([topic, entry]) =>
    [topic, entry.options.config.private, entry.type, entry.filter.event])), [
    ["rsvp:guest-overview:invites", true, "broadcast", "changed"],
    ["rsvp:guest-overview:food", true, "broadcast", "changed"],
  ]);
  const loads = () => page.evaluate(() => window.__fetchCount);
  const reads = () => page.evaluate(() => window.__guestOverviewFixture.reads);
  const beforeLoads = await loads();
  await chooseInviteFilter(page, "inviteLanguageFilter", ["de", "fo"]);
  const draft = page.locator('[data-invite-household="' + ids.draft + '"]');
  await draft.locator("[data-bulk-select]").check();
  await draft.getByRole("button", { name: /^Review/ }).click();
  const record = draft.locator("[data-primary-delivery]");
  await record.getByText("Edit delivery", { exact: true }).click();
  const form = record.locator("form.delivery-review-form");
  await form.locator(".delivery-customize").evaluate(node => { node.open = true; });
  const draftMessage = form.getByRole("textbox", { name: "Message text", exact: true });
  const unsaved = "Synthetic unsaved invitation {invitation_link}";
  await draftMessage.fill(unsaved);
  const seen = page.locator('#inviteOverviewCounts [data-invite-filter="seen"]');
  const seenRow = page.locator('[data-invite-household="' + ids.seen + '"]');
  await seen.focus();
  const nodes = [await seen.elementHandle(), await draft.elementHandle(), await form.elementHandle(), await seenRow.elementHandle()];
  const beforeReads = await reads();
  await page.evaluate(({ topic, seen, guest, session }) => {
    const snapshot = window.__guestOverviewFixture.snapshot;
    Object.assign(snapshot.households.find(row => row.id === seen), {
      visit_count: 1, first_visited_at: "2026-11-24T12:00:00Z", last_visited_at: "2026-11-24T12:00:00Z",
      food_interest: true, rsvp_state: "locked",
    });
    snapshot.guests.push({ id: crypto.randomUUID(), household_id: seen, is_child: true });
    snapshot.submissions = 1;
    snapshot.responses.push({ guest_id: guest, session_id: session, rsvp_status: "attending" });
    const item = fixtures.food_items[0];
    snapshot.claims.push({ household_id: seen, food_item_id: item.id, quantity: item.quantity_needed });
    const notice = { event: "changed", payload: {} };
    window.__guestOverviewChannels.get(topic).listener(notice);
    window.__guestOverviewChannels.get("rsvp:guest-overview:food").listener(notice);
  }, ids);
  await seen.locator("b").filter({ hasText: /^1$/ }).waitFor();
  assert.equal(await reads(), beforeReads + 1, "a burst of guest events reads one scoped snapshot");
  assert.equal(await loads(), beforeLoads, "guest activity does not reload the administrator store");
  assert.ok(await page.evaluate(([button, row, editor, seenHousehold]) => button.isConnected && document.activeElement === button &&
    row.isConnected && row.open && editor.isConnected && seenHousehold.isConnected, nodes));
  assert.equal(await seenRow.locator(".invite-copy-invitation").innerText(), "Seen");
  assert.equal(await seenRow.locator(".invite-overview-reply").innerText(), `Replied (1/${ids.replies + 1}) · F: Y`);
  assert.equal(await draftMessage.inputValue(), unsaved);
  assert.ok(await draft.locator("[data-bulk-select]").isChecked());
  assert.equal(await page.locator('#inviteLanguageFilter [aria-pressed="true"]').count(), 2);
  assert.equal(await page.locator('#inviteOverviewCounts [data-invite-filter="replied"] b').textContent(), "1");
  assert.equal(await page.locator("#inviteSeenSummary").textContent(), "1 sent · 0 not seen · 1 seen");
  assert.equal(await page.locator('[data-overview-card="households"] .stat-heading b').last().textContent(), String(ids.guests + 1));
  assert.equal(await page.locator('[data-overview-card="rsvp"] .stat-heading b').textContent(), "1");
  assert.equal(await page.locator('[data-invite-attendance-filter="attending"] b').textContent(), "1");
  assert.equal(await page.locator('[data-invite-attendance-filter="pending"] b').textContent(), String(ids.replies));
  assert.equal(await page.locator('[data-invite-food-filter="yes"] b').textContent(), "1");
  assert.equal(await page.locator('[data-overview-card="food"] .stat-counts dd').nth(1).textContent(), "1");
  assert.equal(await page.locator('[data-overview-card="food"] .stat-counts dd').last().textContent(), "1");
  assert.equal(await page.evaluate(() => window.__invitesStore.responses.length), 0, "the report baseline is untouched");
  await page.evaluate(id => {
    const snapshot = window.__guestOverviewFixture.snapshot;
    snapshot.households.find(row => row.id === id).food_interest = false;
    window.__guestOverviewChannels.get("rsvp:guest-overview:food").listener({ event: "changed", payload: {} });
  }, ids.draft);
  // The Food card is in the inactive Overview tab, so read the connected count directly.
  await page.locator('[data-invite-food-filter="no"] b').filter({ hasText: /^1$/ }).waitFor({ state: "attached" });
  assert.equal(await reads(), beforeReads + 2);
  assert.equal(await draftMessage.inputValue(), unsaved);
  await seen.click();
  assert.deepEqual(await page.locator("[data-invite-household]").evaluateAll(rows => rows.map(row => row.dataset.inviteHousehold)), [ids.seen],
    "the same filter button uses the fresh projection after a deliberate click");
  await seen.click();
  await chooseInviteFilter(page, "inviteLanguageFilter");
  await page.evaluate(() => {
    const fixture = window.__guestOverviewFixture;
    fixtures.household_session_defaults = fixture.defaults;
    fixtures.invitation_send_queue = fixtures.invitation_send_queue.map(item =>
      item.id === fixture.originalRecord.id ? fixture.originalRecord : item);
    delete window.__guestOverviewFixture;
  });
  await refreshFixture(page);
  await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled && !window.__guestOverviewChannels.size);
}

async function chooseInviteFilter(page, id, selected = []) {
  await selectOverviewTab(page, "invitation");
  const filter = page.locator("#" + id);
  for (const key of selected) {
    const option = filter.locator('button[data-value="' + key + '"]');
    if ((await option.getAttribute("aria-pressed")) !== "true") await option.click();
  }
  const active = await filter.locator('button[data-value][aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.dataset.value));
  for (const key of active) if (!selected.includes(key)) await filter.locator('button[data-value="' + key + '"]').click();
}

async function checkInvitationActivity(page) {
  await selectOverviewTab(page, "invitation");
  const { sentId, readyId, initialReads, households } = await page.evaluate(() => {
    const store = window.__invitesStore;
    return {
      sentId: store.queue.find(item => item.id === "queue-sent").household_id,
      readyId: store.queue.find(item => item.id === "queue-ready").household_id,
      initialReads: window.__fetchCount,
      households: structuredClone(store.households),
    };
  });
  const openedAt = "2026-11-22T20:25:44.125Z";
  const firstVisitedAt = "2026-11-22T21:25:44.125Z";
  const lastVisitedAt = "2026-11-22T22:25:44.125Z";
  const row = id => page.locator('[data-invite-household="' + id + '"]');
  const fact = (id, name) => row(id).locator('[data-shortcut-fact="' + name + '"]');
  const invitationLabel = id => row(id).locator(".invite-copy-invitation .invite-copy-pill");
  const toggle = id => row(id).locator(":scope > summary .invite-compact-name").click();
  const statusCounts = () => Promise.all(["sent", "unseen", "seen"].map(state =>
    page.locator('#inviteOverviewCounts [data-invite-filter="' + state + '"] b').textContent()));
  const expectVisit = async (id, count) => {
    await fact(id, "visits").filter({ hasText: new RegExp("^" + count + "$") }).waitFor();
    const firstVisit = await fact(id, "first_visit").textContent();
    const lastVisit = await fact(id, "last_visit").textContent();
    assert.match(firstVisit, /2026/);
    assert.match(lastVisit, /2026/);
    assert.equal(await invitationLabel(id).textContent(), count === 1 ? "Seen" : "Seen (" + count + ")");
    return { firstVisit, lastVisit };
  };

  assert.equal(await invitationLabel(readyId).textContent(), "Invitation", "a Ready invitation starts with its delivery label");
  if (!await row(sentId).evaluate(node => node.open)) await toggle(sentId);
  assert.equal(await fact(sentId, "visits").textContent(), "0");
  const submenus = row(sentId).locator(".invite-household-submenus");
  await submenus.waitFor();
  const geometry = await submenus.locator(":scope > details").evaluateAll(nodes => nodes.map(node => {
    const { top, bottom, height } = node.getBoundingClientRect();
    return { top, bottom, height };
  }));
  assert.equal(geometry.length, 3);
  assert.ok(geometry.every(({ height }) => height > 0), "all Invitation submenus are visible");
  assert.ok(geometry.slice(1).every(({ top }, index) =>
    top >= geometry[index].bottom && top - geometry[index].bottom <= 8), "Invitation submenus sit close together");
  await page.evaluate(id => { window.__holdActivityRead = id; }, sentId);
  await toggle(sentId);
  await toggle(sentId);
  await page.waitForFunction(() => typeof window.__releaseActivityRead === "function");

  await page.locator("#settingsToggle").click();
  await page.evaluate(({ sentId, openedAt }) => {
    window.__activityFixture = { [sentId]: {
      first_visited_at: null, last_visited_at: null, visit_count: 0,
      invitation_loads: { first_at: openedAt, last_at: openedAt, count: 1 },
    } };
    window.__logFixtures.unshift({
      event_key: "opened:1", occurred_at: openedAt, category: "invitations", action: "opened",
      household_id: sentId, household_name: "Example child", actor: "Guest", subject: "Invitation opened",
      details: { recording: "Successful invitation load" },
    });
  }, { sentId, openedAt });
  await page.locator("[data-settings-tab=logs]").click();
  await page.locator('#logRows time[datetime="' + openedAt + '"]').waitFor();
  const readsBeforeRaw = await page.evaluate(() => window.__activityReads.length);
  await page.locator("#mainSectionToggle").click();
  await page.waitForFunction(previous => window.__activityReads.length > previous, readsBeforeRaw);
  assert.deepEqual(await row(sentId).locator("[data-shortcut-fact]").evaluateAll(nodes =>
    nodes.map(node => node.dataset.shortcutFact)), ["last_sent", "first_visit", "last_visit", "visits", "rsvp"],
  "Last sent is above the single set of visit fields and RSVP status");
  const lastSent = await fact(sentId, "last_sent").textContent();
  assert.match(lastSent, /2026/);
  assert.equal(await fact(sentId, "first_visit").textContent(), "Not yet");
  assert.equal(await fact(sentId, "last_visit").textContent(), "Not yet");
  assert.equal(await fact(sentId, "visits").textContent(), "0", "a raw link load is not a qualified visit");
  assert.equal(await invitationLabel(sentId).textContent(), "Marked sent", "a raw link load keeps the delivery label");
  assert.deepEqual(await statusCounts(), ["1", "2", "0"], "Not seen covers both Ready and sent rows that have no visit");

  await page.locator("#settingsToggle").click();
  await page.evaluate(({ sentId, firstVisitedAt, lastVisitedAt }) => {
    Object.assign(window.__activityFixture[sentId], {
      first_visited_at: firstVisitedAt, last_visited_at: lastVisitedAt, visit_count: 2,
    });
  }, { sentId, firstVisitedAt, lastVisitedAt });
  await page.locator("#mainSectionToggle").click();
  const { firstVisit, lastVisit } = await expectVisit(sentId, 2);
  assert.notEqual(lastVisit, firstVisit, "the expanded facts show the latest qualifying visit");
  await page.evaluate(async () => {
    window.__releaseActivityRead();
    delete window.__releaseActivityRead;
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  assert.equal(await fact(sentId, "last_visit").textContent(), lastVisit, "an older lookup cannot replace the latest visit");
  assert.equal(await fact(sentId, "last_sent").textContent(), lastSent, "a visit leaves the recorded send time alone");
  assert.equal(await fact(sentId, "rsvp").textContent(), "Awaiting reply");
  assert.deepEqual(await statusCounts(), ["1", "1", "1"], "a fresh sent visit moves it from Not seen to Seen");
  const summary = page.locator("#inviteSeenSummary");
  assert.equal(await summary.textContent(), "1 sent · 1 not seen · 1 seen");

  await toggle(sentId);
  const readyFilter = page.locator('[data-invite-filter="ready"]');
  await readyFilter.click();
  if (!await row(readyId).evaluate(node => node.open)) await toggle(readyId);
  assert.equal(await fact(readyId, "visits").textContent(), "0");
  assert.equal(await fact(readyId, "last_sent").textContent(), "Not yet");
  const current = row(readyId).locator('[data-invite-delivery-submenu="current"]');
  const currentWasOpen = await current.evaluate(node => node.open);
  if (!currentWasOpen) await current.locator(":scope > summary").click();
  await current.evaluate(node => { window.__openReadyBeforeVisit = node; });
  await page.evaluate(({ readyId, firstVisitedAt }) => {
    window.__activityFixture[readyId] = {
      first_visited_at: firstVisitedAt, last_visited_at: firstVisitedAt, visit_count: 1,
    };
    window.__invitesTestView.refreshInvitationActivity();
  }, { readyId, firstVisitedAt });
  await expectVisit(readyId, 1);
  assert.deepEqual(await statusCounts(), ["1", "0", "2"], "a Ready visit moves to Seen without increasing Sent");
  assert.equal(await summary.textContent(), "0 sent · 0 not seen · 1 seen", "the summary updates for the current Ready filter");
  assert.equal(await readyFilter.getAttribute("aria-pressed"), "true");
  assert.equal(await current.evaluate(node => node.open && node === window.__openReadyBeforeVisit), true,
    "refreshing the Ready visit keeps the open invitation content in place");
  await page.evaluate(({ readyId, lastVisitedAt }) => {
    Object.assign(window.__activityFixture[readyId], { last_visited_at: lastVisitedAt, visit_count: 2 });
    window.__invitesTestView.refreshInvitationActivity();
  }, { readyId, lastVisitedAt });
  await expectVisit(readyId, 2);
  assert.deepEqual(await statusCounts(), ["1", "0", "2"], "another visit updates the row count without increasing Seen households");
  await page.evaluate(id => {
    window.__holdActivityRead = id;
    window.__invitesTestView.refreshInvitationActivity();
  }, readyId);
  await page.waitForFunction(() => typeof window.__releaseActivityRead === "function");
  await page.evaluate(id => {
    window.__invitesStore.households.find(household => household.id === id).visit_count = 3;
    window.__invitesTestView.refreshOverviewCounts();
  }, readyId);
  assert.equal(await invitationLabel(readyId).innerText(), "Seen (3)");
  await page.evaluate(async () => {
    window.__releaseActivityRead();
    delete window.__releaseActivityRead;
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  assert.equal(await invitationLabel(readyId).innerText(), "Seen (3)", "a slower lookup cannot roll back a newer overview count");
  assert.equal(await page.evaluate(() => window.__fetchCount), initialReads, "activity refresh does not reload the dashboard");

  if (!currentWasOpen) await current.locator(":scope > summary").click();
  await toggle(readyId);
  await readyFilter.click();
  await page.evaluate(({ households, openedAt }) => {
    window.__invitesStore.households = households;
    delete window.__activityFixture;
    delete window.__openReadyBeforeVisit;
    window.__logFixtures = window.__logFixtures.filter(entry => entry.occurred_at !== openedAt);
    window.__invitesTestView.render();
  }, { households, openedAt });
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
  const status = page.locator("#bulkInviteStatus");
  const action = bulk;
  const generate = action.getByRole("button", { name: "Make draft(s)", exact: true });
  const clearSelection = async () => {
    const checked = await list.locator("[data-bulk-select]:checked").evaluateAll(nodes => nodes.map(node => node.dataset.bulkSelect));
    for (const id of checked) await householdInput(id).uncheck();
  };
  const householdInput = id => list.locator('[data-bulk-select="' + id + '"]');
  const householdRow = id => list.locator('[data-invite-household="' + id + '"]');
  assert.equal(await bulk.locator('.bulk-invite-list,.bulk-invite-row').count(),0,'Action uses the shared Invites list');
  assert.equal(await generate.isVisible(),false,"empty selection hides the action buttons");
  assert.match(await list.locator("#inviteSelectionCount").innerText(), /^0\/[0-9]+$/);
  assert.equal(await list.locator("[data-bulk-select]:checked").count(),0);
  const publicationHint=status.getByText("Publish the event to activate sending.",{exact:true});
  assert.equal(await publicationHint.isVisible(),true);
  assert.equal(await action.getByRole("checkbox").count(), 0, "Action uses the shared row selection");
  await householdInput(ids[0]).check();
  assert.equal(await generate.isDisabled(), true, "viewer cannot generate the selected missing draft");

  await page.evaluate(() => { window.__accessPermissions.sections.invites = "edit"; });
  await refreshFixture(page);
  await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
  await clearSelection();
  assert.equal(await generate.isVisible(), false, "empty selection hides the action buttons");
  await householdInput(ids[0]).check();
  assert.match(await list.locator("#inviteSelectionCount").innerText(), /^1\/[0-9]+$/);
  await page.evaluate(id => {
    window.__holdDraftFor = id;
    window.__holdBulkReload = true;
  }, ids[0]);
  await generate.click();
  await page.waitForFunction(() => typeof window.__resumeDraft === "function");
  const feedback = status.locator("#bulkInviteFeedback"), spinner = feedback.locator(".bulk-invite-spinner");
  const pending = "Please wait while drafts are updated…";
  assert.equal(await feedback.innerText(), pending);
  assert.equal(await spinner.isVisible(), true);
  assert.equal(await spinner.getAttribute("aria-hidden"), "true");
  assert.equal(await bulk.locator("#bulkInviteContent").getAttribute("aria-busy"), "true");
  assert.equal(await bulk.getByRole("button").evaluateAll(buttons => buttons.every(button => button.disabled)), true);
  assert.equal(await publicationHint.isVisible(), true, "draft creation retains the unpublished event guidance");
  const [buttonsBox, hintBox, feedbackBox] = await Promise.all([action.locator(".bulk-invite-actions").boundingBox(), publicationHint.boundingBox(), feedback.boundingBox()]);
  assert.ok(hintBox.y >= buttonsBox.y + buttonsBox.height && feedbackBox.y >= hintBox.y + hintBox.height,
    "publication guidance and progress have separate lines beneath the action buttons");
  assert.ok(Math.abs(feedbackBox.x + feedbackBox.width - buttonsBox.x - buttonsBox.width) <= 1,
    "feedback aligns with the right edge of the action buttons");
  await generate.dispatchEvent("click");
  await page.evaluate(() => window.__resumeDraft());
  await page.waitForFunction(() => typeof window.__resumeBulkReload === "function");
  assert.equal(await feedback.innerText(), pending, "draft progress remains visible during the data refresh");
  assert.equal(await spinner.isVisible(), true);
  assert.equal(await generate.isDisabled(), true);
  await page.evaluate(() => window.__resumeBulkReload());
  await feedback.getByText("1 draft created", { exact: true }).waitFor();
  assert.equal(await bulk.locator("#bulkInviteContent").getAttribute("aria-busy"), "false");
  assert.equal(await spinner.count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__draftWrites.map(write => write.p_household_id)), [ids[0]]);
  assert.equal(await page.evaluate(id=>fixtures.invitation_send_queue.find(q=>q.household_id===id)?.template_id,ids[0]),"overview-template");
  assert.equal(await generate.isDisabled(), true, "existing drafts need no generation");

  await clearSelection();
  await selectOverviewTab(page, "invitation");
  const needsDraft = page.locator('[data-invite-filter="needs-draft"]');
  await needsDraft.click();
  assert.match(await needsDraft.innerText(), /No drafts/);
  assert.equal(await householdRow(ids[0]).count(), 0, "an existing Draft is outside Needs draft");
  await chooseInviteFilter(page, "inviteChannelFilter", ["messages", "whatsapp", "sms"]);
  assert.equal(await householdRow(ids[4]).count(), 0, "Services hides an unselected Email household");
  await list.locator("[data-bulk-select-all]").check();
  assert.deepEqual(await list.locator("[data-bulk-select]:checked").evaluateAll(nodes => nodes.map(node => node.dataset.bulkSelect).sort()), ids.slice(1, 4).sort());
  await generate.click();
  await status.getByText("1 draft created · 1 with multiple matches · 1 with no match", { exact: true }).waitFor();
  assert.equal(await needsDraft.getAttribute("aria-pressed"), "true", "generation keeps Needs draft active");
  assert.equal(await householdRow(ids[1]).count(), 0, "a generated Draft leaves the missing view");
  assert.equal(await householdRow(ids[2]).isVisible(), true, "ambiguous match stays in Needs draft");
  assert.equal(await householdRow(ids[3]).isVisible(), true, "missing template match stays in Needs draft");
  assert.equal(await page.locator('#inviteChannelFilter [data-value="whatsapp"]').getAttribute('aria-pressed'),'true','Services selection survives generation reload');
  const writes = await page.evaluate(() => window.__draftWrites);
  assert.deepEqual(writes.map(write => write.p_household_id).sort(), [ids[0], ids[1]].sort(),
    "Generation queues only selected visible households with one exact service-language match");
  assert.ok(writes.every(write => write.p_id === null && write.p_expected_revision === null && write.p_values.status === "draft" && write.p_values.only_if_missing === true));
  assert.deepEqual(writes.find(write => write.p_household_id === ids[1]).p_values, {
    channel: "sms", contact_id: null, message_subject: "", message_body: "Short text {invitation_link}",
    message_image: null, status: "draft", only_if_missing: true, template_id: "Messages invitation",
    template_revision: "Messages invitation-revision",
  }, "Messages uses its own template service, selected content options, and SMS transport");
  await clearSelection();
  await chooseInviteFilter(page, "inviteChannelFilter");
  await householdInput(ids[4]).check();
  await generate.click();
  await status.getByText("0 drafts created · 1 changed during generation", { exact: true }).waitFor();
  assert.equal(await generate.isEnabled(), true, "a changed recipient remains available for a fresh attempt");
  await page.evaluate(() => { window.__failBulkReload = true; });
  await generate.click();
  await feedback.getByText("1 draft created · Bulk invites could not be refreshed.", { exact: true }).waitFor();
  assert.equal(await bulk.locator("#bulkInviteContent").getAttribute("aria-busy"), "false");
  assert.equal(await spinner.count(), 0);
  assert.equal(await page.evaluate(id=>fixtures.invitation_send_queue.find(q=>q.household_id===id)?.template_id,ids[4]),"overview-template");
  assert.doesNotMatch(await page.locator("#adminMessage").textContent(), /Synthetic invite refresh failure/);
  await refreshFixture(page);
  await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
  assert.equal(await page.evaluate(ids => fixtures.invitation_send_queue.filter(queue =>
    [ids[2], ids[3]].includes(queue.household_id)).length, ids), 0, "zero/ambiguous results create no draft");
  assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
  assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.find(queue => queue.id === "queue-ready").status), "ready");
  assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.find(queue => queue.id === "queue-sent").status), "sent");
  assert.equal(await action.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.equal(await status.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);

  await clearSelection();
  await needsDraft.click();
  await page.evaluate(() => { fixtures.event_settings[0].is_published = true; });
  await refreshFixture(page);
  await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
  assert.equal(await publicationHint.count(), 0);
  assert.equal(await list.locator("[data-bulk-select]:checked").count(),0);
  assert.match(await list.locator("#inviteSelectionCount").innerText(), /^0\/[0-9]+$/, "counter follows visible selectable rows");
  assert.equal(await status.locator("#bulkInviteHint").isVisible(),false,"a completed batch keeps feedback without a stale publication or review hint");
}


async function checkMobileDraftSelection(page, published) {
  const { phones, hidden, sent } = await page.evaluate(published => {
    const planningGroup = fixtures.event_settings[0].planning_config.groups[0].id;
    fixtures.event_settings[0].is_published = published;
    fixtures.households = [];
    fixtures.guests = [];
    fixtures.invitation_send_queue = [];
    fixtures.invitation_deliveries = [];
    window.__draftWrites = [];
    window.__sentWrites = [];
    window.__mobileCopies = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: async text => { window.__mobileCopies.push(text); } },
    });
    window.__bulkTemplates = [{
      id: "mobile-template", revision: "mobile-revision", name: "Mobile invitation",
      channels: ["messages", "sms", "whatsapp"], language_tags: ["en"],
      versions: { en: { language_code: "en", body: "Mobile invitation {invitation_link}", options: ["message"] } },
    }];
    const alphabet = "ABCDEFGHJKLMNP";
    const add = (service, index) => {
      const id = crypto.randomUUID(), guest = crypto.randomUUID();
      const code = published ? "ABCD23" + alphabet[index] + "4" : null;
      const phone = service === "email" ? null : "+1 202 555 01" + String(index).padStart(2, "0");
      fixtures.households.push({
        id, household_name: "Synthetic household " + (index + 1),
        planning_group_id: planningGroup, primary_guest_id: guest,
        language: "en", invite_code: code, rsvp_state: "open",
      });
      fixtures.guests.push({
        id: guest, household_id: id, first_name: "Synthetic", last_name: "Primary",
        mobile: phone, email: service === "email" ? "hidden@example.invalid" : null,
        preferred_contact_method: service === "messages" ? null : service,
      });
      return { id, service, phone, link: code ? window.RSVP.invitationURL(code) : null };
    };
    const services = ["messages", "sms", "whatsapp"];
    const phones = Array.from({ length: published ? 12 : 3 }, (_, index) => add(services[index % services.length], index));
    const hidden = add("email", phones.length);
    const sent = add("messages", phones.length + 1);
    fixtures.invitation_send_queue.push({
      id: "mobile-already-sent", household_id: sent.id, channel: "sms", status: "sent", revision: 2,
      created_at: "2026-11-20T12:00:00Z", updated_at: "2026-11-20T12:00:00Z",
      sent_at: "2026-11-20T12:00:00Z", message_body: "Existing selected invitation",
      recipient_snapshot: { contact_name: "Synthetic Primary", contact_type: "sms", contact_value: sent.phone },
    });
    fixtures.invitation_deliveries.push({
      queue_id: "mobile-already-sent", confirmed_at: "2026-11-20T12:00:00Z", confirmed_by: h1,
    });
    return { phones, hidden, sent };
  }, published);
  await refreshFixture(page);
  await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
  await setInvitesGrouping(page, "service");
  await selectOverviewTab(page, "invitation");
  const activeStatus = page.locator('[data-invite-filter][aria-pressed="true"]');
  if (await activeStatus.count()) await activeStatus.click();
  await chooseInviteFilter(page, "inviteChannelFilter", ["messages", "sms", "whatsapp"]);
  const list = page.locator("#inviteRows");
  const selectAll = list.getByRole("checkbox", { name: "Select all", exact: true });
  const row = id => list.locator('[data-invite-household="' + id + '"]');
  const select = id => row(id).locator("[data-bulk-select]");
  const checked = () => list.locator("[data-bulk-select]:checked").evaluateAll(nodes => nodes.map(node => node.dataset.bulkSelect).sort());
  const action = page.locator("#bulkInvitesHost"), status = page.locator("#bulkInviteStatus");
  const generate = action.getByRole("button", { name: "Make draft(s)", exact: true });
  const makeInvitation = action.getByRole("button", { name: "Make invitation(s)", exact: true });
  const markSent = action.getByRole("button", { name: "Mark sent", exact: true });
  const allPhones = phones.map(phone => phone.id).sort();
  const serviceNames = { messages: "Messages", sms: "SMS", whatsapp: "WhatsApp" };
  assert.equal(await selectAll.isVisible(), true, "the shared header checkbox is reachable at this width");
  assert.equal(await row(hidden.id).count(), 0);
  assert.equal(await row(sent.id).isVisible(), true);
  assert.equal(await select(sent.id).isDisabled(), true);
  assert.equal(await generate.isVisible(), false);
  assert.equal(await list.locator("#inviteSelectionCount").innerText(), "0/" + phones.length);
  await select(phones[0].id).check();
  assert.equal(await selectAll.evaluate(node => node.indeterminate), true);
  assert.equal(await list.locator("#inviteSelectionCount").innerText(), "1/" + phones.length);
  await selectAll.click();
  assert.deepEqual(await checked(), allPhones, "all selects only the visible eligible rows");
  assert.equal(await selectAll.isChecked(), true);
  assert.equal(await list.locator("#inviteSelectionCount").innerText(), phones.length + "/" + phones.length);
  await selectAll.click();
  assert.deepEqual(await checked(), [], "pressing the checked header clears the visible selection");
  assert.equal(await generate.isVisible(), false);
  await selectAll.focus();
  await page.keyboard.press("Space");
  assert.deepEqual(await checked(), allPhones);
  assert.equal(await selectAll.evaluate(node => node === document.activeElement), true);

  const beforeGeneration = await page.evaluate(() => window.__fetchCount);
  await generate.click();
  await status.getByText(phones.length + " drafts created", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__fetchCount), beforeGeneration + 1);
  assert.equal(await activeStatus.count(), 0);
  assert.deepEqual(await checked(), allPhones, "saved mobile snapshots keep the selected rows visible");
  assert.equal(await selectAll.isChecked(), true);
  assert.equal(await page.evaluate(() => window.__sentWrites.length), 0, "generation does not mark any record sent");
  assert.equal(await page.evaluate(() => window.__draftWrites.filter(w => w.p_values.status !== "draft").length), 0);
  const snapshots = await page.evaluate(() => fixtures.invitation_send_queue.filter(queue => queue.status !== "sent").map(queue => [
    queue.household_id, queue.channel, queue.recipient_snapshot.contact_type,
    queue.recipient_snapshot.contact_value, queue.status, queue.revision, queue.message_body,
  ]));
  assert.deepEqual(snapshots.sort(), phones.map(phone => {
    const channel = phone.service === "messages" ? "sms" : phone.service;
    return [phone.id, channel, channel, phone.phone, "draft", 1,
      "Mobile invitation " + (phone.link || "{invitation_link}")];
  }).sort(), "selected mobile rows generate Draft snapshots");
  assert.equal(await generate.isDisabled(), true, "selected saved drafts cannot be generated again");
  if (published) {
    await makeInvitation.click();
    await status.getByText(phones.length + " invitations marked ready.", { exact: true }).waitFor();
  } else {
    assert.equal(await makeInvitation.isDisabled(), true, "unpublished drafts cannot become invitations");
  }
  for (const phone of phones) {
    const group = list.locator('[data-invite-service="' + phone.service + '"]');
    assert.equal(await group.locator('[data-invite-household="' + phone.id + '"]').count(), 1, "the row stays in its original Service group");
    const current = row(phone.id);
    if (page.viewportSize().width < 1024 && !await current.evaluate(node => node.open)) {
      await current.locator(':scope > summary .invite-compact-name').click();
    }
    assert.equal(await current.locator(".invite-copy-recipient:visible").innerText(), serviceNames[phone.service]);
    if (published) assert.equal(await row(phone.id).locator(".invite-copy-invitation").innerText(), "Invitation");
    else {
      assert.equal(await row(phone.id).getByRole("button", { name: /^Review/ }).count(), 1);
      assert.equal(await row(phone.id).locator(".invite-copy-invitation,.invite-copy-text").count(), 0);
    }
  }
  const expectedCopies = [];
  for (const phone of phones.slice(0, 3)) {
    await row(phone.id).locator(".invite-copy-recipient:visible").click();
    expectedCopies.push(phone.phone);
    if (published) {
      await row(phone.id).locator(".invite-copy-invitation").click();
      expectedCopies.push("Mobile invitation " + phone.link);
    }
  }
  assert.deepEqual(await page.evaluate(() => window.__mobileCopies), expectedCopies);
  await chooseInviteFilter(page, "inviteChannelFilter", ["none"]);
  assert.equal(await list.locator(".invite-household").count(), 0);
  assert.deepEqual(await checked(), [], "changing Services prunes all hidden selections");
  await chooseInviteFilter(page, "inviteChannelFilter");
  assert.equal(await list.locator(".invite-household").count(), phones.length + 2);
  assert.deepEqual(await checked(), [], "restoring visibility does not restore discarded selections");

  if (published) {
    await chooseInviteFilter(page, "inviteChannelFilter", ["messages", "sms", "whatsapp"]);
    await selectAll.check();
    assert.deepEqual(await checked(), allPhones);
    const readyWrites = await page.evaluate(() => window.__draftWrites.filter(w => w.p_values.status === "ready"));
    assert.equal(readyWrites.length, 12);
    assert.ok(readyWrites.every(w => w.p_expected_revision === 1 && w.p_values.expected_invitation_code));
    assert.equal(await action.getByRole("button", { name: "Review selected drafts", exact: true }).count(), 0);
    assert.equal(await markSent.isEnabled(), true, "all twelve Ready records can be marked Sent");
    const before = await page.evaluate(() => window.__fetchCount);
    await markSent.click();
    await status.getByText("12 invitations marked sent.", { exact: true }).waitFor();
    const result = await page.evaluate(() => ({
      loads: window.__fetchCount,
      attempts: window.__sentAttempts,
      newDeliveries: fixtures.invitation_deliveries.filter(d => d.queue_id !== "mobile-already-sent").length,
    }));
    assert.equal(result.loads, before, "the Ready-only Sent batch updates its rows without a dashboard reload");
    assert.equal(result.newDeliveries, 12);
    assert.equal(result.attempts.length, 12);
    assert.ok(result.attempts.every(a => a.p_expected_revision === 2));
    assert.deepEqual(await checked(), []);
  }

}

async function checkReadyGenerationBoundaries(page) {
  const ids = await page.evaluate(() => {
    fixtures.event_settings[0].is_published = true;
    window.__accessPermissions.sections.invites = "edit";
    window.__accessPermissions.sendInvites = true;
    window.__bulkTemplates = ["whatsapp", "manual", "sms"].map(service => ({
      id: service + "-guard-template", revision: service + "-revision", channels: [service], language_tags: ["en"],
      versions: { en: { language_code: "en", body: (service === "sms" ? "Incomplete {unresolved} " : "Synthetic invitation ") + "{invitation_link}", options: ["message"] } },
    }));
    window.__draftWrites = [];
    window.__sentWrites = [];
    return ["A eligible", "B stale code", "C manual", "D interrupted", "E no send permission", "F incomplete"].map((name, index) => {
      const id = crypto.randomUUID(), guest = crypto.randomUUID(), code = "QRSWXP2" + (index + 2);
      fixtures.households.push({ id, household_name: name, primary_guest_id: guest,
        invite_code: code, language: "en", rsvp_state: "open" });
      fixtures.guests.push({ id: guest, household_id: id, first_name: "Synthetic",
        mobile: index === 2 ? null : "+1 202 555 0134", preferred_contact_method: index === 2 ? null : index === 5 ? "sms" : "whatsapp" });
      return { id, code };
    });
  });
  const refresh = async () => {
    await refreshFixture(page);
    await page.waitForFunction(() => !document.querySelector("#refreshButton").disabled);
  };
  await refresh();
  const generate = page.locator("#bulkInvitesHost").getByRole("button", { name: "Make draft(s)", exact: true });
  const prepare = page.locator("#bulkInvitesHost").getByRole("button", { name: "Make invitation(s)", exact: true });
  const feedback = page.locator("#bulkInviteFeedback");
  const select = id => page.locator('#inviteRows [data-bulk-select="' + id + '"]');
  const statuses = () => page.evaluate(ids => ids.map(({ id }) => fixtures.invitation_send_queue.find(q => q.household_id === id)?.status), ids);
  const mixed = [...ids.slice(0, 3), ids[5]];
  for (const { id } of mixed) await select(id).check();
  await generate.click();
  await feedback.filter({ hasText: "4 drafts created" }).waitFor();
  assert.deepEqual((await statuses()).filter(Boolean), ["draft", "draft", "draft", "draft"]);
  await page.evaluate(({ id }) => { window.__holdReadyFor = id; }, ids[1]);
  await prepare.click();
  await page.waitForFunction(() => typeof window.__resumeReady === "function");
  assert.equal(await feedback.innerText(), "Please wait while invitations are prepared…");
  await page.evaluate(({ id }) => {
    // Replace the database fixture object so the rendered client snapshot is stale.
    fixtures.households = fixtures.households.map(h => h.id === id ? { ...h, invite_code: "QRSTAB23" } : h);
    window.__resumeReady();
  }, ids[1]);
  await feedback.filter({ hasText: "Invitation has changed" }).waitFor();
  assert.match(await feedback.innerText(), /1 invitation marked ready/);
  const mixedStatuses = await statuses();
  assert.deepEqual([mixedStatuses[0], mixedStatuses[1], mixedStatuses[2], mixedStatuses[5]], ["ready", "draft", "draft", "draft"]);
  const staleWrite = await page.evaluate(id => window.__draftWrites.find(write =>
    write.p_household_id === id && write.p_values.status === "ready"), ids[1].id);
  assert.equal(staleWrite.p_values.expected_invitation_code, ids[1].code);
  assert.equal(await page.evaluate(() => window.__sentWrites.length), 0);

  for (const { id } of mixed) if (await select(id).isChecked()) await select(id).uncheck();
  await select(ids[3].id).check();
  await page.evaluate(({ id }) => { window.__holdDraftFor = id; }, ids[3]);
  await generate.click();
  await page.waitForFunction(() => typeof window.__resumeDraft === "function");
  await chooseInviteFilter(page, "inviteChannelFilter", ["email"]);
  await page.evaluate(() => window.__resumeDraft());
  await feedback.filter({ hasText: "1 draft created" }).waitFor();
  assert.equal((await statuses())[3], "draft", "the completed write stays Draft after the filter changes");
  await chooseInviteFilter(page, "inviteChannelFilter");

  await page.evaluate(() => { window.__accessPermissions.sendInvites = false; });
  await refresh();
  await select(ids[4].id).check();
  await generate.click();
  await feedback.filter({ hasText: "1 draft created" }).waitFor();
  assert.equal((await statuses())[4], "draft", "draft editors can generate a draft without sending permission");
  assert.equal(await prepare.isDisabled(), true, "draft editors need sending permission to make an invitation");
  assert.equal(await page.evaluate(ids => window.__draftWrites.filter(write =>
    ids.some(({ id }) => id === write.p_household_id) && write.p_values.status === "ready").length, ids.slice(3)), 0);
}

async function checkScreenProfiles(page) {
  const start = page.viewportSize();
  const rows = page.locator('#inviteRows');
  const summaryFields = rows.locator('.invite-overview-heading > span:not(.invite-overview-select)');
  for (const [width, screen, rowLayout] of [[511, 'phone', '2'], [512, 'tablet', '1'], [1023, 'tablet', '1'], [1024, 'desktop', '2']]) {
    await page.setViewportSize({ ...start, width });
    await page.locator(`#inviteRows[data-screen="${screen}"][data-rows="${rowLayout}"] .invite-household`).first().waitFor();
    const fields = await summaryFields.allTextContents();
    if (screen === 'phone') assert.deepEqual(fields, ['Household', 'Invitation', 'RSVP']);
    else assert.ok(fields.includes('Service'));
  }
  await page.setViewportSize(start);
  await page.locator('#inviteRows[data-screen="phone"] .invite-household').first().waitFor();
  const first = rows.locator('.invite-household').first();
  const name = first.locator(':scope > summary .invite-compact-name');
  if (!await first.evaluate(node => node.open)) await name.click();
  assert.equal(await first.locator('.invite-expanded-actions .invite-preview').isVisible(), true);
  assert.equal(await first.locator('.invite-expanded-actions .invite-edit-household').isVisible(), true);
  assert.equal(await first.locator(':scope > summary .invite-preview, :scope > summary .invite-edit-household').count(), 0);
  await page.evaluate(() => {
    const preferences = window.RSVP_ADMIN_PREFERENCES;
    window.__defaultInviteProfile = preferences.getInvitesProfile;
    preferences.getInvitesProfile = screen => ({ ...window.__defaultInviteProfile(screen),
      showActions: false, expandedFields: ['recipient'] });
    window.__invitesTestView.render();
  });
  assert.equal(await first.locator('.invite-expanded-actions').count(), 0);
  assert.deepEqual(await first.locator('.invite-expanded-fields dt').allTextContents(), ['Recipient']);
  await page.evaluate(() => {
    window.RSVP_ADMIN_PREFERENCES.getInvitesProfile = window.__defaultInviteProfile;
    delete window.__defaultInviteProfile;
    window.__invitesTestView.render();
  });
  if (await first.evaluate(node => node.open)) await name.click();
}

async function checkOverviewFilters(page) {
  await selectOverviewTab(page, "information");
  const seed = await page.evaluate(() => {
    const store = window.__invitesStore;
    const prior = structuredClone({ households:store.households, defaults:store.defaults, responses:store.responses, relationGroups:store.relationGroups, sessions:store.sessions });
    const [sent, ready] = ["queue-sent", "queue-ready"].map(id =>
      store.households.find(h => h.id === store.queue.find(row => row.id === id).household_id));
    const [sideA, sideB] = store.settings.planning_config.groups;
    Object.assign(sent, { planning_group_id: sideA.id, relation_group_id: "related-a" });
    Object.assign(ready, { planning_group_id: sideB.id, relation_group_id: "related-b" });
    store.relationGroups = [
      { id: "related-a", name: "Scoped relationship", planning_group_id: sideA.id },
      { id: "related-b", name: "Shared relationship", planning_group_id: null },
    ];
    const session = store.sessions.find(value => value.is_active && value.requires_rsvp).id;
    store.sessions.push({ id: "second-rsvp", is_active: true, requires_rsvp: true, name: "Synthetic second RSVP" },
      { id: "optional-session", is_active: true, requires_rsvp: false, name: "Synthetic optional session" });
    store.defaults = [sent, ready].map(h => ({ household_id:h.id, session_id:session, is_invited:true }));
    store.defaults.push({ household_id:ready.id, session_id:"second-rsvp", is_invited:true });
    store.responses = store.guests.filter(g => g.household_id === sent.id).map((g, index) => ({
      guest_id:g.id, session_id:session, rsvp_status:index ? "declined" : "attending",
    }));
    window.__invitesTestView.render();
    return { prior, sent:sent.id, ready:ready.id, sideA:sideA.id, sideB:sideB.id, calls:window.__calls.length };
  });
  const all=[seed.sent,seed.ready].sort();
  const rows=()=>page.locator('#inviteRows [data-invite-household]').evaluateAll(nodes=>nodes.map(node=>node.dataset.inviteHousehold).sort());
  const attend=page.locator('[data-invite-attendance-filter="attending"]');
  const decline=page.locator('[data-invite-attendance-filter="declined"]');
  const pending=page.locator('[data-invite-attendance-filter="pending"]');
  const relation=page.locator('[data-invite-group-tree="relation"]');
  const scoped=relation.locator('[data-invite-group="relation:planning:'+seed.sideA+'"]');
  const shared=relation.locator('[data-invite-group="relation:group:related-b"]');
  const top=page.locator('[data-invite-group="top:'+seed.sideB+'"]');
  assert.equal(await relation.locator('ul ul [data-invite-group="relation:group:related-a"]').count(),1,'scoped relationship is nested beneath its planning group');
  assert.deepEqual(await page.locator('#inviteOverviewCounts [data-invite-filter] > span').allTextContents(),
    ['No drafts','Review','Ready','Sent','Not seen','Seen','Waiting Reply','Replied']);
  assert.deepEqual(await page.locator('#inviteAttendanceCounts b').allTextContents(),['1','1','2'],'counts refer to guest/session answers');
  assert.match(await page.locator('#statsGrid [data-overview-card="households"] .overview-people-breakdown').innerText(), /\d+ Adults · \d+ Children/);
  const sessions = page.locator('#inviteSessionTree details');
  const second = sessions.locator('[data-invite-session="second-rsvp"]');
  await sessions.locator('summary').click();
  assert.equal(await sessions.locator('[data-invite-session="optional-session"]').count(),0);
  await second.click();
  assert.deepEqual(await rows(),[seed.ready],'a session limits the list to households invited to it');
  assert.equal(await second.getAttribute('aria-pressed'),'true');
  assert.equal(await second.evaluate(button=>button===document.activeElement),true);
  assert.equal(await sessions.locator('summary .invite-session-active').innerText(),'Synthetic second RSVP');
  assert.deepEqual(await page.locator('#inviteAttendanceCounts b').allTextContents(),['0','0','1'],'only attendance in the selected session is counted');
  await attend.click();
  assert.deepEqual(await rows(),[],'attendance from another session cannot satisfy the selected session filter');
  await attend.click();
  await second.click();
  assert.deepEqual(await rows(),all,'repeating a session selection returns to all sessions');
  const groupTrees=page.locator('#inviteGroupTrees details');
  const topTree=page.locator('[data-invite-group-tree="top"]');
  assert.deepEqual(await groupTrees.evaluateAll(nodes=>nodes.map(node=>node.open)),[true,false],
    'Top-level groups starts expanded and Relational groups stays collapsed');
  await relation.locator('summary').click();
  await scoped.click();assert.deepEqual(await rows(),[seed.sent]);
  await shared.click();assert.deepEqual(await rows(),all,'selected relational groups combine');
  await top.click();assert.deepEqual(await rows(),[seed.ready],'top-level and relational group choices intersect');
  await top.click();assert.deepEqual(await rows(),all,'pressing an active group clears that choice');
  await scoped.click();await shared.click();
  await topTree.locator('summary').click();
  await attend.click();assert.deepEqual(await rows(),[seed.sent]);
  assert.equal(await topTree.evaluate(node=>node.open),false,'a manually collapsed Top-level groups tree stays collapsed after rerender');
  assert.equal(await attend.evaluate(button=>button===document.activeElement),true,'attendance filter keeps focus after rerender');
  await topTree.locator('summary').click();
  assert.equal(await topTree.evaluate(node=>node.open),true);
  await decline.click();assert.deepEqual(await rows(),[seed.sent],'mixed households can match either RSVP answer');
  await pending.click();assert.deepEqual(await rows(),[seed.ready],'unanswered only matches an invited session without a response');
  await pending.click();assert.deepEqual(await rows(),all,'pressing the active attendance filter restores all rows');
  const informationTab=page.getByRole('tab',{name:'Information',exact:true});
  const invitationTab=page.getByRole('tab',{name:'Invitation',exact:true});
  const activeFilters=page.getByRole('group',{name:'Active filters',exact:true});
  const clearFilters=activeFilters.getByRole('button',{name:'Clear filters',exact:true});
  assert.equal(await activeFilters.isHidden(),true,'the list omits a filter summary when no filters are active');
  await informationTab.press('ArrowRight');
  assert.equal(await invitationTab.getAttribute('aria-selected'),'true');
  assert.equal(await invitationTab.evaluate(tab=>tab===document.activeElement),true);
  assert.equal(await page.locator('#overviewInformationPanel').isHidden(),true);
  const readyStatus=page.locator('[data-invite-filter="ready"]');
  await readyStatus.click();assert.deepEqual(await rows(),[seed.ready]);
  await informationTab.click();
  assert.equal(await page.locator('#overviewInvitationPanel').isHidden(),true);
  assert.deepEqual(await rows(),[seed.ready],'an invitation status filter remains active on the Information tab');
  assert.deepEqual(await activeFilters.locator('li').allTextContents(),['Invites · Ready']);
  await selectOverviewTab(page,'invitation');
  assert.equal(await readyStatus.getAttribute('aria-pressed'),'true');
  await chooseInviteFilter(page,'inviteLanguageFilter',['de']);
  await chooseInviteFilter(page,'inviteChannelFilter',['whatsapp','email']);
  await informationTab.click();
  await second.click();
  await attend.click();
  await top.click();
  await shared.click();
  await page.locator('[data-invite-food-filter="unanswered"]').click();
  const searchToggle=page.locator('#inviteSearchToggle');
  const search=page.locator('#inviteSearch');
  await searchToggle.click();
  await search.fill('Example Hill');
  assert.deepEqual(await activeFilters.locator('li strong').allTextContents(),[
    'Sessions','Search','Invites','RSVP','Top-level groups','Relational groups','Language','Services','Food interest',
  ]);
  assert.equal(await activeFilters.getByText('Search · Example Hill',{exact:true}).count(),1);
  assert.equal(await activeFilters.getByText('Relational groups · Shared relationship',{exact:true}).count(),1);
  assert.equal(await activeFilters.getByText('Services · WhatsApp, Email',{exact:true}).count(),1);
  assert.deepEqual(await rows(),[],'the clear action stays available on an empty result');
  const groupChoice=page.locator('#inviteQuickGrouping input:checked');
  const rowChoice=page.locator('#inviteRows');
  const previousGroup=await groupChoice.inputValue(), previousRows=await rowChoice.getAttribute('data-rows');
  await page.evaluate(()=>window.__invitesTestView.refreshOverviewCounts());
  assert.equal(await clearFilters.isVisible(),true,'live count refresh retains the active filters');
  await clearFilters.press('Enter');
  assert.equal(await activeFilters.isHidden(),true);
  assert.equal(await search.inputValue(),'');
  assert.equal(await readyStatus.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#statsGrid .invite-stat-row[aria-pressed="true"]').count(),0);
  assert.deepEqual(await rows(),all,'clearing every active filter restores all rows');
  assert.equal(await groupChoice.inputValue(),previousGroup);
  assert.equal(await rowChoice.getAttribute('data-rows'),previousRows);
  assert.equal(await searchToggle.evaluate(button=>button===document.activeElement),true);
  await searchToggle.press('Escape');
  assert.equal(await page.evaluate(()=>window.__calls.length),seed.calls,'overview controls do not write application data');
  await page.evaluate(prior=>{
    const store=window.__invitesStore;
    Object.assign(store,prior,{relationGroups:[]});
    window.__invitesTestView.render();
  },seed.prior);
  assert.equal(await relation.count(),0,'a blank relational group tree is omitted');
  await page.evaluate(records=>{window.__invitesStore.relationGroups=records;window.__invitesTestView.render();},seed.prior.relationGroups);
}

async function checkSeenPresentation(page) {
  await selectOverviewTab(page, "invitation");
  const seed = await page.evaluate(() => {
    const store = window.__invitesStore;
    const { households, guests, queue } = store;
    const [sentUnseen, readySeen] = ["queue-sent", "queue-ready"].map(id => queue.find(item => item.id === id).household_id);
    const unsentSeen = households.find(household => !household.invite_code).id;
    const readyUnseen = crypto.randomUUID();
    const unprepared = crypto.randomUUID();
    const visitAt = "2026-11-22T21:25:44.125Z";
    const visit = { first_visited_at: visitAt, last_visited_at: visitAt, visit_count: 1 };
    store.households = [
      ...households.map(household => {
        if (household.id === sentUnseen) return { ...household, visit_count: 0 };
        if (household.id === readySeen) return { ...household, ...visit, visit_count: 2 };
        return { ...household, ...visit, ...(household.id === unsentSeen ? { invite_code: "SYNTHABC", last_visited_at: null } : {}) };
      }),
      { id: readyUnseen, household_name: "Synthetic Ready household", language: "en", invite_code: "SYNTH2BC", visit_count: 0 },
      { id: unprepared, household_name: "Synthetic unprepared household", language: "en", visit_count: 0 },
    ];
    store.guests = [...guests, ...[unsentSeen, readyUnseen, unprepared].map(id =>
      ({ id: crypto.randomUUID(), household_id: id, first_name: "Synthetic guest" }))];
    store.queue = [...queue, {
      ...queue.find(item => item.id === "queue-ready"), id: "queue-ready-unseen", household_id: readyUnseen,
    }];
    window.__invitesTestView.render();
    return { prior: { households, guests, queue }, sentUnseen, readySeen, unsentSeen, readyUnseen, unprepared };
  });
  const filter = state => page.locator('#inviteOverviewCounts [data-invite-filter="' + state + '"]');
  const row = id => page.locator('#inviteRows [data-invite-household="' + id + '"]');
  const rows = () => page.locator('#inviteRows [data-invite-household]').evaluateAll(nodes => nodes.map(node => node.dataset.inviteHousehold).sort());
  const summary = page.locator('.invite-heading-title #inviteSeenSummary');
  const all = [seed.sentUnseen, seed.readySeen, seed.unsentSeen, seed.readyUnseen, seed.unprepared].sort();
  assert.deepEqual(await Promise.all(["sent", "unseen", "seen"].map(state => filter(state).locator("b").textContent())),
    ["1", "2", "2"], "Seen and Not seen count qualifying rows independently of the Sent total");
  assert.equal(await summary.innerText(), "1 sent · 2 not seen · 2 seen");
  const offsets = await Promise.all(["sent", "unseen", "seen"].map(state =>
    filter(state).locator("span").evaluate(node => node.getBoundingClientRect().left)));
  assert.equal(new Set(offsets).size, 1, "Sent, Not seen and Seen are peer rows with aligned labels");
  const labels = [[seed.unsentSeen, "Seen"], [seed.readySeen, "Seen (2)"],
    [seed.readyUnseen, "Invitation"], [seed.sentUnseen, "Marked sent"], [seed.unprepared, "Not sent"]];
  for (const layout of [1, 2]) {
    await setFixtureInviteRows(page, layout);
    for (const [id, label] of labels) {
      assert.equal(await row(id).locator(".invite-copy-invitation .invite-copy-pill").innerText(), label,
        "a qualifying visit replaces the primary delivery label in either layout");
      assert.equal(await row(id).locator(".invite-copy-text").isVisible(), label === "Invitation",
        "the optional Text button only appears beside Invitation");
    }
    assert.equal(await page.locator("#inviteRows .invite-overview-heading").getByText("Seen", { exact: true }).count(), 0);
    const visitTimestamp = row(seed.readySeen).locator('.invite-delivery-time');
    if (layout === 1) assert.equal(await visitTimestamp.count(), 0);
    else {
      assert.ok(await visitTimestamp.getAttribute('datetime'));
      assert.match(await visitTimestamp.innerText(), /\d/);
      assert.doesNotMatch(await visitTimestamp.innerText(), /Last (visit|seen|sent)/i);
    }
    assert.doesNotMatch((await page.locator("#inviteRows .invite-overview-delivery").allInnerTexts()).join(" "), /Not seen/);
  }

  await filter("seen").click();
  assert.deepEqual(await rows(), [seed.readySeen, seed.unsentSeen].sort(), "Seen includes both a Ready and an unmarked invitation");
  assert.equal(await filter("seen").getAttribute("aria-pressed"), "true");
  assert.equal(await summary.innerText(), "0 sent · 0 not seen · 2 seen");
  await filter("seen").click();
  assert.deepEqual(await rows(), all);
  await filter("unseen").click();
  assert.deepEqual(await rows(), [seed.sentUnseen, seed.readyUnseen].sort());
  assert.equal(await summary.innerText(), "1 sent · 2 not seen · 0 seen");
  await filter("unseen").click();
  await filter("sent").click();
  assert.deepEqual(await rows(), [seed.sentUnseen], "Sent still requires explicitly recording delivery");
  assert.equal(await summary.innerText(), "1 sent · 1 not seen · 0 seen");
  await filter("sent").click();
  await chooseInviteFilter(page, "inviteLanguageFilter", ["fo"]);
  assert.deepEqual(await rows(), [seed.sentUnseen, seed.unsentSeen].sort());
  assert.equal(await summary.innerText(), "1 sent · 1 not seen · 1 seen", "summary reflects the current language filter");
  await chooseInviteFilter(page, "inviteLanguageFilter");
  await setFixtureInviteRows(page, 1);
  await page.evaluate(prior => {
    Object.assign(window.__invitesStore, prior);
    window.__invitesTestView.render();
  }, seed.prior);
}

async function checkRsvpFoodPresentation(page) {
  const seed = await page.evaluate(() => {
    const store = window.__invitesStore;
    const { households, guests, defaults, overrides, responses } = store;
    const [declined, yes] = ["queue-ready", "queue-sent"].map(id => store.queue.find(item => item.id === id).household_id);
    const unanswered = households.find(household => household.id !== declined && household.id !== yes).id;
    const session = store.sessions.find(item => item.is_active && item.requires_rsvp).id;
    const declinedGuests = Array.from({ length: 4 }, () => ({
      id: crypto.randomUUID(), household_id: declined, first_name: "Synthetic guest",
    }));
    const priorDeclinedIds = new Set(guests.filter(guest => guest.household_id === declined).map(guest => guest.id));
    store.households = households.map(household => {
      if (household.id === declined) return { ...household, rsvp_state: "locked", food_interest: false };
      if (household.id === yes) return { ...household, food_interest: true };
      return { ...household, food_interest: null };
    });
    store.guests = [...guests.filter(guest => !priorDeclinedIds.has(guest.id)), ...declinedGuests];
    if (!store.guests.some(guest => guest.household_id === unanswered && !guest.archived_at))
      store.guests.push({ id: crypto.randomUUID(), household_id: unanswered, first_name: "Synthetic guest" });
    store.defaults = [...defaults.filter(item => item.household_id !== declined),
      { household_id: declined, session_id: session, is_invited: true }];
    store.overrides = overrides.filter(item => !priorDeclinedIds.has(item.guest_id));
    store.responses = [...responses.filter(item => !priorDeclinedIds.has(item.guest_id)), ...declinedGuests.map(guest =>
      ({ guest_id: guest.id, session_id: session, rsvp_status: "declined" }))];
    window.__invitesTestView.render();
    return { prior: { households, guests, defaults, overrides, responses }, declined, yes, unanswered };
  });
  const reply = id => page.locator('#inviteRows [data-invite-household="' + id + '"] .invite-overview-reply');
  assert.equal(await reply(seed.declined).innerText(), "Replied (0/4) · F: N",
    "four declines produce zero attendees and the saved No answer");
  assert.match(await reply(seed.yes).innerText(), / · F: Y$/);
  assert.doesNotMatch(await reply(seed.unanswered).innerText(), /F: [YN]/,
    "an unanswered food question does not become No");

  await setFixtureInviteRows(page, 2);
  const answer = id => reply(id).locator(".invite-rsvp-food-answer:visible");
  assert.equal((await reply(seed.declined).innerText()).split("\n")[0], "Replied (0/4)");
  for (const [id, text] of [[seed.declined, "Food: No"], [seed.yes, "Food: Yes"]]) {
    assert.equal(await answer(id).innerText(), text);
    assert.ok(await answer(id).evaluate(node => {
      const primary = node.parentElement.firstElementChild;
      return primary !== node && primary.getBoundingClientRect().bottom <= node.getBoundingClientRect().top + 1;
    }), "Food answer is below the RSVP status in two rows");
  }
  assert.equal(await answer(seed.unanswered).count(), 0);

  const fields = page.locator("#inviteShownFieldsHost .invite-shown-fields");
  if (!await fields.evaluate(menu => menu.open)) await fields.locator("summary").click();
  assert.equal(await fields.locator('button[data-value="food"]').count(), 0);
  await fields.locator('button[data-value="reply"]').click();
  await page.keyboard.press("Escape");
  assert.equal(await reply(seed.declined).count(), 0, "hiding the RSVP column also hides its Food detail");
  await setFixtureInviteRows(page, 1);
  await page.evaluate(prior => {
    Object.assign(window.__invitesStore, prior);
    window.__invitesTestView.render();
  }, seed.prior);
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
  const before=await state();
  const heading=()=>page.locator('#inviteRows .invite-overview-heading > span:not(.invite-overview-select)').allTextContents();
  assert.equal(await page.locator('#inviteRows').getAttribute('data-rows'),'1');
  assert.deepEqual(await heading(),['Household','Household info','Recipient','Service','Invitation','RSVP'],'one row shows its remaining optional detail columns');
  assert.equal(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta,#inviteRows .invite-overview-recipient small').count(),0,'one row keeps optional household and contact details separate');
  assert.equal(await fields.locator('button[data-value="lastSent"],button[data-value="replyInfo"]').count(),0,'retired detail fields are absent from View');
  for(const text of await page.locator('#inviteRows .invite-copy-recipient .invite-copy-pill').allTextContents())assert.match(text,/^(Messages|Email|WhatsApp|SMS|None)$/,'one-row service info omits numbers and email addresses');
  // Keep a distinct one-row choice so two-row defaults cannot silently replace it.
  await toggle('recipient');await page.keyboard.press('Escape');
  const oneRowBefore=await state();
  await setFixtureInviteRows(page,2);
  assert.deepEqual(await heading(),['Household','Service','Invitation','RSVP'],'two rows nests secondary details and food interest under primary headings');
  assert.equal(await page.locator('#inviteRows .invite-household > summary > .invite-overview-household-info,#inviteRows .invite-household > summary > .invite-overview-recipient').count(),0,'secondary details move beneath their primary cells');
  assert.ok(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta').count()>0);
  for(const text of await page.locator('#inviteRows .invite-copy-recipient .invite-copy-pill').allTextContents())assert.match(text,/^(Messages|Email|WhatsApp|SMS|None)$/,'two-row service detail also omits number/email');
  const activityTimes = await page.locator('#inviteRows .invite-delivery-time:visible').allInnerTexts();
  assert.ok(activityTimes.length > 0);
  for (const date of activityTimes) {
    assert.match(date, /\d/);
    assert.doesNotMatch(date, /Last (visit|seen|sent)/i);
  }
  assert.doesNotMatch((await page.locator('#inviteRows .invite-overview-reply').allInnerTexts()).join(' '),/responses/);
  const twoState=await state();
  assert.deepEqual(twoState.shown,['reply'],'two rows starts with RSVP and its Food detail');
  assert.deepEqual(await fields.locator('button[data-value]').evaluateAll(nodes=>nodes.map(node=>node.dataset.value)),['reply'],'two-row View controls the RSVP column and its details together');
  assert.deepEqual({...twoState,shown:before.shown},before,'two rows preserves selected households, RPC history and delivery data');
  await toggle('reply');await page.keyboard.press('Escape');
  assert.deepEqual(await heading(),['Household','Service','Invitation'],'Food follows RSVP visibility in two rows');
  assert.equal(await page.locator('#inviteRows .invite-overview-reply,#inviteRows .invite-overview-interest').count(),0,'two-row choices hide each optional primary/detail pair');
  assert.ok(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta').count()>0,'Household and its details stay mandatory when optional columns are hidden');
  await setFixtureInviteRows(page,1);assert.deepEqual(await state(),oneRowBefore,'returning to one row restores its previous fields and operational state');
  await setFixtureInviteRows(page,2);
  assert.deepEqual([...(await state()).shown].sort(),[...twoState.shown].sort(),'re-entering two rows resets its temporary columns to saved defaults');
  await setFixtureInviteRows(page,1);assert.deepEqual(await state(),oneRowBefore,'temporary two-row field changes never replace one-row choices');
  await toggle('recipient');await page.keyboard.press('Escape');
  await select.uncheck();
  await page.evaluate(()=>{window.__invitesStore.defaults=window.__rowsDefaultsBefore;delete window.__rowsDefaultsBefore;window.__invitesTestView.render();});
  await toggle('householdInfo');
  await page.keyboard.press('Escape');
  const defaultsBefore=await state();
  await setFixtureInviteRows(page,2);
  await toggle('reply');await page.keyboard.press('Escape');
  const rowTwoTemporary=await state();
  await page.evaluate(()=>{
    window.__fixtureInviteProfiles = { desktop: { shownFields: ['recipient','serviceInfo','delivery'] } };
    window.__invitesTestView.render();
  });
  assert.deepEqual(await state(),rowTwoTemporary,'changed one-row defaults preserve active two-row temporary choices');
  await setFixtureInviteRows(page,1);
  assert.deepEqual((await state()).shown,['recipient'],'changed saved defaults replace earlier one-row overrides while required fields stay visible');
  await page.evaluate(()=>{delete window.__fixtureInviteProfiles;window.__invitesTestView.render();});
  assert.deepEqual(await state(),defaultsBefore,'restoring one-row defaults preserves operational data and restores those fields');
  await toggle('householdInfo');await page.keyboard.press('Escape');
  const oneRowTemporary=await state();
  await page.evaluate(()=>{
    window.__fixtureInviteProfiles = { desktop: { twoRowColumns: ['serviceInfo','delivery'] } };
    window.__invitesTestView.render();
  });
  assert.deepEqual(await state(),oneRowTemporary,'changed two-row defaults preserve one-row temporary choices');
  await setFixtureInviteRows(page,2);
  assert.deepEqual((await state()).shown,[],'two rows uses its own saved optional column defaults');
  assert.equal(await page.locator('#inviteRows .invite-overview-reply').count(),0,'saved two-row choices omit both lines of unselected RSVP');
  assert.ok(await page.locator('#inviteRows .invite-overview-service-info .invite-copy-recipient,#inviteRows .invite-overview-delivery .invite-copy-invitation').count()>0,'Service and Invitation stay mandatory with custom two-row defaults');
  assert.ok(await page.locator('#inviteRows .invite-overview-identity .invite-household-meta').count()>0,'saved two-row choices cannot hide Household details');
  await setFixtureInviteRows(page,1);assert.deepEqual(await state(),oneRowTemporary,'two-row saved defaults never replace one-row temporary fields');
  await page.evaluate(()=>{delete window.__fixtureInviteProfiles;window.__invitesTestView.render();});
  assert.deepEqual(await state(),oneRowTemporary,'restoring two-row defaults does not reset one-row fields');
  await toggle('householdInfo');await page.keyboard.press('Escape');
  await setFixtureInviteRows(page,2);
  await page.evaluate(()=>{window.__invitesActorOverride='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';window.__invitesTestView.render();});
  assert.equal(await page.locator('#inviteRows').getAttribute('data-rows'),'2','the active screen profile still governs Rows after an account change');
  await setFixtureInviteRows(page,1);
  assert.deepEqual((await state()).shown,defaultsBefore.shown,'another actor receives saved defaults rather than the previous actor temporary choice');
  await page.evaluate(()=>{delete window.__invitesActorOverride;window.__invitesTestView.render();});
}

async function checkGroupingPreservation(page) {
  await ensureInviteSelection(page);
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
  assert.equal(await page.locator('#inviteRows .invite-overview-group').evaluateAll(groups=>groups.every(n=>parseFloat(getComputedStyle(n).borderTopWidth)>0&&parseFloat(getComputedStyle(n).borderBottomLeftRadius)>0)),true,'service groups have outlined containers');
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
  await setFixtureInviteRows(page,2);
  await row.evaluate(node=>{node.open=false;});
  const beforeContact=await snapshot();
  await row.locator('.invite-overview-service-info > .invite-overview-recipient').click();
  assert.deepEqual(await snapshot(),beforeContact,'plain contact detail is outside the Service copy action');
  assert.equal(await row.locator('.invite-copy-recipient .invite-overview-recipient').count(),0,'the Service copy button contains only its service chip');
  await setFixtureInviteRows(page,1);
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
  const beforeText=await state();
  const expected='Saved Føroyskt — 🧪\r\n'+prepared.link;
  assert.equal(await text.innerText(),'Text');
  assert.match(await text.getAttribute('aria-label'),/^Copy message · /);
  assert.equal(await invitation.innerText(),'Invitation');
  assert.match(await invitation.getAttribute('aria-label'),/^Copy picture and text · /);
  assert.equal(await invitation.evaluate(button=>{
    const b=button.getBoundingClientRect(),pill=button.querySelector('.invite-copy-pill').getBoundingClientRect();
    return b.width>=27.5&&b.height>=27.5&&['left','top','width','height'].every(key=>Math.abs(b[key]-pill[key])<=1);
  }),true,'the copy hit area matches the visible Invitation chip');
  const otherId=await page.locator('#inviteRows [data-invite-household]:not([data-invite-household="'+prepared.id+'"]) .invite-copy-recipient:not(:disabled)').first().evaluate(button=>button.closest('[data-invite-household]').dataset.inviteHousehold);
  const other=page.locator('#inviteRows [data-invite-household="'+otherId+'"] .invite-copy-recipient');
  await row.evaluate(node=>{node.open=false;});
  await text.click();
  await page.waitForFunction(value=>window.__invitesCopied.at(-1)===value,expected);
  assert.deepEqual(await page.evaluate(()=>window.__imageCopyCalls),[],'Text writes only the plain message and RSVP link');
  assert.equal(await row.evaluate(node=>node.open),false,'Text copy does not toggle household details');
  const before=await state();
  assert.deepEqual(before,{...beforeText,copies:beforeText.copies+1},'Text copy leaves selections and delivery state intact');
  await invitation.click();
  assert.equal(await page.locator('#inviteRows [data-invite-copy]:not(:disabled)').count(),0,'pending image preparation disables copy actions across households');
  await other.dispatchEvent('click');await invitation.dispatchEvent('click');await text.dispatchEvent('click');
  assert.deepEqual(await state(),before,'pending image preparation cannot overwrite a recipient/message or change selection/delivery state');
  assert.deepEqual(await page.evaluate(()=>window.__imageCopyCalls),[{image:'data:image/jpeg;base64,c3ludGhldGlj',message:expected,currentAtStart:true}]);
  await page.evaluate(()=>window.__completeImageCopy(false));
  await page.waitForFunction(()=>window.__invitesFeedback.at(-1)?.[0]==='Picture and text copied. Check the caption after pasting.');
  assert.equal(await row.evaluate(node=>node.open),false,'picture copy does not toggle household details');
  assert.equal(await invitation.isEnabled(),true,'image completion restores the Invitation chip');
  assert.equal(await other.isEnabled(),true,'image completion restores other household copy actions');
  assert.deepEqual(await state(),before,'completed picture copy preserves selected households and saved delivery records');
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
    else if(change==='queue')assert.equal(await invitation.isDisabled(),true,'a replacement Draft disables stale Ready copy controls');
    else assert.equal(await invitation.isEnabled(),true,'copy completion restores fresh valid controls after '+change);
    assert.equal(await page.evaluate(()=>window.__calls.length),before.calls,'image copy never invokes a backend operation');
  }
  await page.evaluate(()=>{
    delete window.__invitesActorOverride;delete window.__invitesPermission;
    window.__invitesStore.queue=structuredClone(window.__imageCopyBefore.queue);
    const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');
    q.message_image={image:'data:image/jpeg;base64,c3ludGhldGlj'};q.message_body='Saved Føroyskt — 🧪\r\n{invitation_link}';
    q.status='draft';window.__invitesTestView.render();
  });
  assert.equal(await row.locator('.invite-copy-invitation,.invite-copy-text').count(),0,
    'a saved Draft picture remains under Review before preparation');
  assert.equal(await row.getByRole('button',{name:/^Review/}).count(),1);
  await page.evaluate(()=>{window.__invitesStore.queue.find(q=>q.id==='queue-ready').status='ready';window.__invitesTestView.render();});
  const beforeFailure=await page.evaluate(()=>window.__invitesCopied.length);
  await invitation.click();await page.evaluate(()=>window.__completeImageCopy(true));
  await page.waitForFunction(()=>window.__invitesFeedback.at(-1)?.[0]==='Invitation text copied.');
  assert.equal(await page.evaluate(()=>window.__invitesCopied.length),beforeFailure+1);
  assert.equal(await page.evaluate(()=>window.__invitesCopied.at(-1)),expected,'image fallback copies the exact message and reports the result');
  assert.equal(await invitation.isEnabled(),true,'fallback restores the Invitation chip');
  await page.evaluate(()=>{
    window.RSVP_INVITATION_IMAGE=window.__imageCopyBefore.helper;window.__invitesStore.queue=window.__imageCopyBefore.queue;
    delete window.__imageCopyBefore;delete window.__completeImageCopy;window.__invitesTestView.render();
  });
  assert.equal(await text.isEnabled(),true,'Text is also available for a ready invitation without a picture');
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
  const row=page.locator('[data-invite-household="'+prepared.id+'"]'),recipient=row.locator('.invite-copy-recipient'),invitation=row.locator('.invite-copy-invitation'),text=row.locator('.invite-copy-text');
  const calls=await page.evaluate(()=>window.__calls.length),queueBefore=await page.evaluate(()=>JSON.stringify(window.__invitesStore.queue));
  await row.evaluate(node=>{node.open=false;});
  await recipient.click();await invitation.click();await text.click();
  const message='Original saved invitation\n'+prepared.link;
  assert.deepEqual(await page.evaluate(()=>window.__invitesCopied),['+298 12 34 56',message,message]);
  assert.equal(await row.evaluate(node=>node.open),false,'copy buttons do not toggle household disclosure');
  assert.equal(await page.evaluate(()=>window.__calls.length),calls,'Invites copying uses no RPC');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.__invitesStore.queue)),queueBefore,'copying preserves saved delivery/status/history');
  await checkCompactCopyTargets(page,row);
  await checkInvitesPictureCopy(page,prepared);
  const primaryBeforeVisit=await invitation.elementHandle();
  await text.focus();
  assert.equal(await text.evaluate(button=>button===document.activeElement),true);
  await page.evaluate(id=>{
    window.__invitesStore.households.find(household=>household.id===id).visit_count=2;
    window.__invitesTestView.refreshOverviewCounts();
  },prepared.id);
  assert.equal(await invitation.innerText(),'Seen (2)');
  assert.equal(await text.isVisible(),false,'a qualifying visit hides Text from the active Ready row');
  assert.equal(await page.evaluate(button=>button===document.activeElement,primaryBeforeVisit),true,'focus moves from the hidden Text button to the existing primary copy control');
  assert.match(await invitation.getAttribute('aria-label'),/^Copy Invitation · /);
  await invitation.click();
  assert.equal(await page.evaluate(()=>window.__invitesCopied.at(-1)),message,'the Seen label retains the Ready invitation copy action');
  // The old rendered button must read the actual current store at click time.
  await page.evaluate(()=>{const q=window.__invitesStore.queue.find(q=>q.id==='queue-ready');q.message_body='Newest Føroyskt — 🧪\r\n{invitation_link}';});
  await invitation.click();assert.equal(await page.evaluate(()=>window.__invitesCopied.at(-1)),'Newest Føroyskt — 🧪\r\n'+prepared.link);
  await page.evaluate(id=>{
    const store=window.__invitesStore,q=store.queue.find(q=>q.id==='queue-ready');
    store.queue.push({...q,id:'new-current-draft',status:'draft',message_body:'New saved draft\n{invitation_link}',created_at:'2026-11-21T12:00:00Z',updated_at:'2026-11-21T12:00:00Z'});
    store.queue.push({...q,id:'newer-cancelled',status:'cancelled',message_body:'Cancelled content',created_at:'2026-11-22T12:00:00Z',updated_at:'2026-11-22T12:00:00Z'});
  },prepared.id);
  const beforeDraft=await page.evaluate(()=>window.__invitesCopied.length);
  await invitation.dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.__invitesCopied.length),beforeDraft,'a newly saved Draft invalidates the earlier Ready copy action');
  await page.evaluate(()=>window.__invitesTestView.render());
  assert.equal(await row.getByRole('button',{name:/^Review/}).count(),1,'the current Draft opens for review');
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
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),1,'an empty selection includes a represented disabled language');
  for (const id of ['inviteChannelFilter','inviteLanguageFilter']) {
    const filter=page.locator('#'+id);
    assert.equal(await filter.getByRole('button',{name:/^All\b/}).count(),0);
    assert.equal(await filter.locator('[aria-pressed="true"]').count(),0);
  }
  await chooseInviteFilter(page,'inviteChannelFilter',['email','messages']);
  assert.equal(await page.locator('[data-invite-household="22222222-2222-4222-8222-222222222222"]').count(),1,'OR includes the selected Email service');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),1,'OR also includes the selected Messages service');
  assert.equal(await page.locator('[data-invite-household="invites-none-service"]').count(),0,'OR excludes an unselected service');
  await chooseInviteFilter(page,'inviteLanguageFilter',['zz']);assert.equal(await page.locator('#inviteRows .invite-household').count(),1,'Language and Services combine with AND');
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
  await page.locator('#inviteChannelFilter [data-value="messages"]').click();
  assert.equal(await page.locator('#inviteChannelFilter [aria-pressed="true"]').count(),0,'clearing the only service leaves no service selected');
  await page.locator('#inviteLanguageFilter [data-value="zz"]').click();
  assert.equal(await page.locator('#inviteLanguageFilter [aria-pressed="true"]').count(),0,'clearing the only language leaves no language selected');
  assert.equal(await page.locator('[data-invite-household="invites-none-service"]').count(),1,'empty language and service selections restore unrestricted results');
  await selectOverviewTab(page,'information');
  const unanswered=page.locator('[data-invite-food-filter="unanswered"]'),yes=page.locator('[data-invite-food-filter="yes"]');
  await unanswered.click();assert.equal(await unanswered.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),1,'Food Unanswered includes the synthetic unresponded household');
  await yes.click();assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),0,'Food Yes filters the same shared list');
  await yes.click();assert.equal(await yes.getAttribute('aria-pressed'),'false','repeating the selected Food row restores All');
  assert.equal(await page.locator('[data-invite-household="invites-default-mobile"]').count(),1);
  await unanswered.click();
  await selectOverviewTab(page,'invitation');
  const readyFilter=page.locator('[data-invite-filter="ready"]');
  await readyFilter.click();await readyFilter.click();
  assert.equal(await unanswered.getAttribute('aria-pressed'),'true','clearing invitation status leaves Food filtering active');
  await selectOverviewTab(page,'information');
  await unanswered.click();
  await page.evaluate(id=>window.__invitesTestView.openHousehold(id),prepared.id);
  assert.equal(await page.locator('#deliveryLog, #deliveryStatusFilter').count(),0,'Delivery history is inside the household');
  await page.evaluate(saved=>{Object.assign(window.__accessPermissions,saved.permissions);fixtures.event_settings=saved.settings;fixtures.households=saved.households;fixtures.guests=saved.guests;fixtures.invitation_send_queue=saved.queue;fixtures.event_languages=saved.languages;delete window.__invitesPermission;delete window.__invitesActorOverride;},saved);
  await refreshFixture(page);await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);
}

async function checkOverviewFilterFeedback(page, touch) {
  await selectOverviewTab(page, "invitation");
  const filter = page.locator('[data-invite-filter="ready"]');
  const mark = filter.locator('.invite-stat-check[aria-hidden="true"]');
  const appearance = control => control.evaluate(node => {
    const style = getComputedStyle(node);
    return [style.backgroundColor, style.borderTopColor, style.color];
  });
  const idle = await appearance(filter);
  const countRight = await filter.locator("b").evaluate(node => node.getBoundingClientRect().right);
  assert.equal(await mark.count(), 1, "the decorative checkmark is hidden from assistive technology");
  assert.equal(await mark.isVisible(), false);
  if (touch) {
    assert.equal(await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches), true);
    await filter.tap();
    assert.equal(await filter.getAttribute("aria-pressed"), "true");
    assert.equal(await mark.isVisible(), true);
    assert.equal(await filter.locator("b").evaluate(node => node.getBoundingClientRect().right), countRight);
    await filter.tap();
    assert.equal(await filter.getAttribute("aria-pressed"), "false");
    assert.equal(await mark.isVisible(), false);
    assert.deepEqual(await appearance(filter), idle, "the last tap leaves no selection-like colors");
  } else {
    await filter.hover();
    const hover = await appearance(filter);
    assert.equal(hover[0], idle[0], "mouse hover does not fill the row like a selection");
    assert.notEqual(hover[1], idle[1], "mouse hover keeps its own border");
    assert.equal(await mark.isVisible(), false);
    await page.locator('[data-invite-filter="review"]').focus();
    await page.keyboard.press("Tab");
    assert.equal(await filter.evaluate(node => node.matches(":focus-visible")), true);
    assert.equal(await filter.evaluate(node => getComputedStyle(node).outlineStyle), "solid");
    await page.keyboard.press("Space");
    assert.equal(await filter.getAttribute("aria-pressed"), "true");
    assert.equal(await filter.evaluate(node => node === document.activeElement), true);
    assert.equal(await mark.isVisible(), true);
    await page.keyboard.press("Space");
    assert.equal(await filter.getAttribute("aria-pressed"), "false");
    assert.equal(await mark.isVisible(), false);
  }
  const service = page.locator('#inviteChannelFilter [data-value="whatsapp"]');
  const serviceMark = service.locator(".invite-stat-check");
  await service.click();
  assert.equal(await serviceMark.isVisible(), true);
  await selectOverviewTab(page, "information");
  assert.equal(await serviceMark.isVisible(), false, "the inactive Invitation tab hides the selected service checkmark");
  await selectOverviewTab(page, "invitation");
  assert.equal(await service.getAttribute("aria-pressed"), "true", "switching tabs retains the service filter");
  assert.equal(await serviceMark.isVisible(), true);
  await service.click();
  await selectOverviewTab(page, "information");
  if (touch) {
    const sessions = page.locator("#inviteSessionTree details");
    await sessions.locator("summary").tap();
    const session = sessions.locator("[data-invite-session]").first();
    const sessionMark = session.locator('.invite-stat-check[aria-hidden="true"]');
    await session.tap();
    assert.equal(await session.getAttribute("aria-pressed"), "true");
    assert.equal(await sessionMark.isVisible(), true, "a selected filter without a count still has a checkmark");
    await session.tap();
    assert.equal(await session.getAttribute("aria-pressed"), "false");
    assert.equal(await sessionMark.isVisible(), false);
    await sessions.locator("summary").tap();
  }
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
  const bulk=page.locator('#bulkInvitesHost'),status=page.locator('#bulkInviteStatus');
  const mark=bulk.getByRole('button',{name:'Mark sent',exact:true});
  const markReady=bulk.getByRole('button',{name:'Make invitation(s)',exact:true});
  const makeDraft=bulk.getByRole('button',{name:'Make draft(s)',exact:true});
  const input=id=>page.locator('#inviteRows [data-bulk-select="'+id+'"]');
  const row=id=>page.locator('#inviteRows .invite-household',{has:page.locator('[data-bulk-select="'+id+'"]')});
  const sentCount=()=>page.evaluate(()=>window.__sentWrites.length);
  const clear=async()=>{for(const id of await page.locator('#inviteRows [data-bulk-select]:checked').evaluateAll(nodes=>nodes.map(n=>n.dataset.bulkSelect)))await input(id).uncheck();};
  const select=async values=>{await clear();for(const item of values)await input(item.id).check();};
  const message=async text=>status.locator('[role=status]').filter({hasText:text}).waitFor();
  const refresh=async()=>{await refreshFixture(page);await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);};
  assert.equal(await row(ids[0].id).evaluate(n=>n.tagName),'DETAILS');
  assert.equal(await row(ids[0].id).locator('label.bulk-invite-select').count(),1);
  const beforeCopy=await page.evaluate(()=>({draft:window.__draftWrites.length,sent:window.__sentWrites.length,calls:window.__calls.length}));
  const openBefore=await row(ids[0].id).evaluate(node=>node.open);
  await row(ids[0].id).locator('.invite-copy-recipient').click();await page.waitForFunction(()=>window.__copied.length===1);
  assert.equal(await page.evaluate(()=>window.__copied[0]),'+298 12 34 56');
  assert.equal(await row(ids[0].id).locator('.invite-copy-invitation,.invite-copy-text').count(),0,'the unpublished Draft has no message copy controls');
  assert.equal(await row(ids[0].id).getByRole('button',{name:/^Review/}).count(),1);
  assert.equal(await input(ids[0].id).isChecked(),false,'copy actions do not change shared selection');
  assert.equal(await row(ids[0].id).evaluate(node=>node.open),openBefore,'copying does not toggle disclosure');
  await input(ids[0].id).focus();await page.keyboard.press('Space');assert.equal(await input(ids[0].id).isChecked(),true);
  assert.equal(await row(ids[0].id).evaluate(node=>node.open),openBefore,'checkbox Space does not toggle household disclosure');
  await page.keyboard.press('Space');assert.equal(await input(ids[0].id).isChecked(),false);
  assert.deepEqual(await page.evaluate(()=>({draft:window.__draftWrites.length,sent:window.__sentWrites.length,calls:window.__calls.length})),beforeCopy,'copying and selection use no RPC');
  assert.deepEqual(await page.evaluate(()=>window.__opened),[],'manual copying opens no app or tab');
  await input(ids[0].id).check();await chooseInviteFilter(page,'inviteChannelFilter',['email']);
  assert.equal(await page.locator('#inviteRows [data-bulk-select]:checked').count(),0,'a hidden selected household is removed from the shared selection');
  assert.match(await page.locator('#inviteSelectionCount').innerText(),/^0\/[0-9]+$/,'hidden selection clears the header counter');
  assert.equal(await mark.isVisible(),false,'hidden selection removes the action toolbar');
  await chooseInviteFilter(page,'inviteChannelFilter');
  for(const item of ids.slice(0,10))await input(item.id).check();
  assert.equal(await page.locator('#inviteRows [data-bulk-select]:checked').count(),10);
  await input(ids[10].id).check();
  assert.equal(await page.locator('#inviteRows [data-bulk-select]:checked').count(),11,'row selection includes more than ten invites');
  await clear(); await select([ids[2]]);
  const beforeInvalid=await page.evaluate(()=>window.__draftWrites.length);
  assert.equal(await mark.isDisabled(),true); await mark.dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.__draftWrites.length),beforeInvalid,'stale-code selected draft performs no preparation');
  await select([ids[3]]); assert.equal(await mark.isDisabled(),true); await mark.dispatchEvent('click');
  assert.equal(await page.evaluate(()=>window.__draftWrites.length),beforeInvalid,'missing body performs no preparation');
  await select([ids[0]]);
  assert.equal(await markReady.isDisabled(),true,'an unpublished event cannot prepare a selection');
  await mark.dispatchEvent('click'); assert.equal(await sentCount(),0,'unpublished drafts cannot be marked sent');
  await page.evaluate(()=>{fixtures.event_settings[0].is_published=true;window.__accessPermissions.sendInvites=false;}); await refresh();
  await mark.dispatchEvent('click'); assert.equal(await sentCount(),0,'send permission is required');
  await page.evaluate(()=>{window.__accessPermissions.sendInvites=true;}); await refresh();
  assert.equal(await mark.isDisabled(),true,'view-only user cannot promote a draft');
  await select([ids[1]]); assert.equal(await mark.isEnabled(),true,'ready records need no draft-edit permission');
  assert.equal(await makeDraft.isDisabled(),true,'view-only invite access cannot change readiness');
  await mark.click(); await message('1 invitation marked sent.');
  assert.deepEqual(await page.evaluate(()=>window.__sentWrites[0]),{p_queue_id:ids[1].queue,p_expected_revision:1,p_note:''});
  await page.evaluate(()=>{window.__accessPermissions.sections.invites='edit';}); await refresh();
  await selectOverviewTab(page,'invitation');
  const sentFilter = page.locator('[data-invite-filter="sent"]');
  await sentFilter.click();
  assert.equal(await input(ids[0].id).count(),0);
  assert.equal(await input(ids[1].id).count(),1,'Sent includes the completed household');
  await sentFilter.click();
  await select([ids[0],ids[4]]);
  assert.equal(await mark.isDisabled(),true,"a published Draft must be reviewed before Mark Sent");
  const review=row(ids[0].id).getByRole("button",{name:/^Review/});
  await review.click();
  const current=row(ids[0].id).locator("[data-primary-delivery]");
  assert.equal(await current.locator(":scope > .delivery-message").isVisible(),true,"Review opens the household's current draft");
  await current.locator("[data-mark-delivery-ready]").click();
  await row(ids[0].id).locator(".invite-copy-invitation").waitFor();
  assert.equal(await mark.isDisabled(),true,"a mixed Ready/Draft selection still cannot be marked Sent");
  await page.evaluate(item=>{const q=fixtures.invitation_send_queue.find(q=>q.id===item.queue);q.status='ready';q.message_body='Second ready\n'+item.link;},ids[4]); await refresh();
  await mark.evaluate(n=>{n.click();n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  await message('2 invitations marked sent.');
  assert.deepEqual(await page.evaluate(()=>window.__sentWrites.slice(1).map(w=>[w.p_queue_id,w.p_expected_revision])),[[ids[0].queue,2],[ids[4].queue,1]],'Ready confirmations use each prepared revision');
  assert.equal(await page.evaluate(()=>fixtures.invitation_deliveries.filter(d=>[window.__sentWrites[1].p_queue_id,window.__sentWrites[2].p_queue_id].includes(d.queue_id)).length),2,'repeated click records each selected household once');
  // Mixed selections only act on eligible records and keep unselected invitations intact.
  await page.evaluate(([missing, ...ready])=>{
    fixtures.invitation_send_queue=fixtures.invitation_send_queue.filter(q=>q.id!==missing.queue);
    window.__bulkTemplates=[{id:'mixed-draft',name:'Mixed draft',revision:'mixed-revision',channels:['whatsapp'],
      language_tags:['en'],versions:{en:{language_code:'en',body:'New draft {invitation_link}',options:['message']}}}];
    for(const item of ready) {
      const q=fixtures.invitation_send_queue.find(q=>q.id===item.queue);
      q.status='ready';q.message_body='Saved invitation\n'+item.link;
    }
  },[ids[6],ids[9],ids[10]]); await refresh();
  await select([ids[3],ids[5],ids[6],ids[9]]);
  const writesBeforeReadiness=await page.evaluate(()=>window.__draftWrites.length);
  const selectedSnapshots=items=>page.evaluate(items=>items.map(item=>fixtures.invitation_send_queue.find(q=>q.id===item.queue)??null),items);
  const untouched=[ids[1],ids[3],ids[10]];
  const beforeMixed=await selectedSnapshots(untouched);
  assert.equal(await markReady.isEnabled(),true);
  assert.equal(await makeDraft.isEnabled(),true);
  await markReady.click();
  await row(ids[5].id).locator('.invite-copy-invitation').waitFor();
  assert.equal(await markReady.isDisabled(),true,'the remaining invalid draft cannot be promoted');
  const beforeDemotion=await selectedSnapshots([ids[5],ids[9]]);
  const beforeMixedBatch = await page.evaluate(() => window.__fetchCount);
  await makeDraft.click();
  for(const item of [ids[5],ids[6],ids[9]])await row(item.id).locator('.invite-review-action').waitFor();
  await message('1 draft created · 2 invitations changed to draft.');
  assert.equal(await page.evaluate(() => window.__fetchCount), beforeMixedBatch + 1, 'mixed drafting reloads the dashboard once');
  assert.equal(await makeDraft.isDisabled(),true);
  assert.deepEqual(await selectedSnapshots(untouched),beforeMixed,'both actions preserve sent, incomplete and unselected records');
  const afterDemotion=await selectedSnapshots([ids[5],ids[9]]);
  assert.deepEqual(afterDemotion.map(q=>[q.status,q.revision,q.message_body,q.recipient_snapshot]),
    beforeDemotion.map(q=>['draft',q.revision+1,q.message_body,q.recipient_snapshot]),'demotion preserves prepared message and recipient snapshots');
  const readinessWrites=await page.evaluate(before=>window.__draftWrites.slice(before),writesBeforeReadiness);
  assert.deepEqual(readinessWrites.map(w=>[w.p_id,w.p_values.status]),[[ids[5].queue,'ready'],[ids[5].queue,'draft'],[null,'draft'],[ids[9].queue,'draft']]);
  assert.equal(readinessWrites[0].p_values.expected_invitation_code,ids[5].code);
  assert.equal(readinessWrites[2].p_household_id,ids[6].id);
  assert.equal(readinessWrites[2].p_values.only_if_missing,true);
  for(const [index,write] of readinessWrites.filter(w=>w.p_values.only_if_ready).entries()){
    assert.deepEqual(write.p_values,{status:'draft',only_if_ready:true});
    assert.equal(write.p_expected_revision,beforeDemotion[index].revision);
  }
  assert.equal(await sentCount(),3,'changing readiness performs no additional send confirmations');
  // Delay a write while the operator searches, copies and queues another household.
  const [first, failed, next] = [ids[7], ids[8], ids[11]];
  await page.evaluate(([first, failed, next]) => {
    for (const item of [first, failed, next]) {
      const queue = fixtures.invitation_send_queue.find(q => q.id === item.queue);
      queue.status = "ready";
      queue.message_body = "Queued example\n" + item.link;
    }
    window.__holdSent = first.queue;
    window.__failSent = failed.queue;
    window.__manualSendMarker = "manual-send-start";
  }, [first, failed, next]);
  await refresh();
  const beforeBackgroundLoads = await page.evaluate(() => window.__fetchCount);
  await select([first, failed]);
  await mark.click();
  await page.waitForFunction(() => typeof window.__resumeSent === "function");
  await row(first.id).locator('[data-invite-send-state="pending"]').waitFor();
  assert.match(await row(first.id).locator('[data-invite-send-state="pending"]').innerText(), /Recording/);
  await row(failed.id).locator('[data-invite-send-state="pending"]').waitFor();
  await message("2 recording");
  const search = page.locator("#inviteSearch");
  if (!await search.isVisible()) await page.locator("#inviteSearchToggle").click();
  await search.fill("Manual 12");
  assert.equal(await row(first.id).count(), 0, "search may hide a row whose save is in progress");
  const copiesBefore = await page.evaluate(() => window.__copied.length);
  await row(next.id).locator(".invite-copy-text").click();
  await page.waitForFunction(before => window.__copied.length === before + 1, copiesBefore);
  await input(next.id).check();
  await mark.click();
  await message("3 recording");
  await row(next.id).locator(":scope > summary .invite-compact-name").click();
  await search.focus();
  await page.evaluate(() => window.__resumeSent());
  await row(next.id).locator(".invite-overview-delivery").getByText("Marked sent", { exact: true }).waitFor();
  await message("1 needs retry");
  assert.equal(await search.inputValue(), "Manual 12");
  assert.equal(await search.evaluate(node => node === document.activeElement), true, "confirmation leaves keyboard focus in the search field");
  assert.equal(await row(next.id).evaluate(node => node.open), true, "confirmation preserves the open household");
  assert.equal(await page.evaluate(() => window.__fetchCount), beforeBackgroundLoads);
  assert.deepEqual(await page.evaluate(items => items.map(item =>
    fixtures.invitation_send_queue.find(q => q.id === item.queue).status), [first, failed, next]), ["sent", "ready", "sent"]);
  await page.evaluate(() => {
    window.__manualSendMarker = "manual-send-latest";
    window.dispatchEvent(new Event("focus"));
  });
  await page.locator("#inviteEventChangeNotice").waitFor();
  assert.equal(await page.locator("dialog.admin-change-alert").count(),0,"returning from a messaging app keeps the change alert inline");
  assert.equal(await search.evaluate(node => node === document.activeElement), true);

  // A saved record whose initial write response and read-back fail is reconciled
  // by the retry action without a second write or another delivery log entry.
  await page.evaluate(id => { window.__loseSentResponse = id; }, failed.queue);
  await status.locator("[data-retry-all-mark-sent]").click();
  await page.waitForFunction(id => fixtures.invitation_deliveries.some(delivery => delivery.queue_id === id), failed.queue);
  await message("1 needs retry");
  const attempts = () => page.evaluate(id => window.__sentAttempts.filter(write => write.p_queue_id === id).length, failed.queue);
  const attemptsBeforeReconcile = await attempts();
  const readsBeforeReconcile = await page.evaluate(() => window.__sentReads.length);
  await page.locator("#inviteSearchClose").click();
  await row(failed.id).locator('[data-invite-send-state="retry"]').waitFor();
  await row(failed.id).locator("[data-retry-mark-sent]").click();
  await row(failed.id).locator(".invite-overview-delivery").getByText("Marked sent", { exact: true }).waitFor();
  assert.equal(await attempts(), attemptsBeforeReconcile, "retry checks the record before submitting another confirmation");
  assert.deepEqual(await page.evaluate(before => window.__sentReads.slice(before).map(({table,key,value}) => [table,key,value]), readsBeforeReconcile),
    [["invitation_send_queue","id",failed.queue],["invitation_deliveries","queue_id",failed.queue]], "retry reads only the exact saved delivery");
  assert.equal(await page.evaluate(id => fixtures.invitation_deliveries.filter(delivery => delivery.queue_id === id).length, failed.queue), 1);
  assert.equal(await page.evaluate(() => window.__fetchCount), beforeBackgroundLoads);

  // A stale revision is rejected by the existing Sent RPC, leaving Ready intact.
  await page.evaluate(item=>{delete window.__manualSendMarker;const q=fixtures.invitation_send_queue.find(q=>q.id===item.queue);q.status='ready';q.message_body='Stale revision\n'+item.link;window.__holdSent=q.id;},ids[3]); await refresh();
  await select([ids[3]]); const beforeStale=await page.evaluate(()=>fixtures.invitation_deliveries.length); await mark.click();
  await page.waitForFunction(()=>typeof window.__resumeSent==='function');
  await row(ids[3].id).locator('[data-invite-send-state="pending"]').waitFor();
  await page.evaluate(id=>{fixtures.invitation_send_queue.find(q=>q.id===id).revision++;window.__resumeSent();},ids[3].queue);
  await row(ids[3].id).locator('[data-invite-send-state="retry"]').waitFor();
  assert.equal(await page.evaluate(()=>fixtures.invitation_deliveries.length),beforeStale);

}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, hasTouch: width === 390 }),
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
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      const phone = width < 512;
      const initialRows = phone || width >= 1024 ? '2' : '1';
      assert.equal(await page.locator('#inviteRows').getAttribute('data-rows'), initialRows, 'initial layout follows the default screen profiles');
      if (width === 390) await checkScreenProfiles(page);
      const selectionToggle = page.locator('#inviteSelectionToggle');
      const inviteRows = page.locator('#inviteRows');
      const selectAll = inviteRows.locator('[data-bulk-select-all]');
      assert.equal(await selectionToggle.getAttribute('aria-pressed'), 'false');
      assert.equal(await selectAll.isVisible(), false);
      assert.equal(await inviteRows.locator('#inviteSelectionCount').isVisible(), false);
      assert.equal(await inviteRows.locator('[data-bulk-select]:visible').count(), 0);
      await ensureInviteSelection(page);
      assert.equal(await selectAll.isVisible(), true);
      assert.match(await inviteRows.locator('#inviteSelectionCount').innerText(), /^0\/[1-9]/);
      await inviteRows.locator('[data-bulk-select]:enabled').first().check();
      assert.match(await inviteRows.locator('#inviteSelectionCount').innerText(), /^1\//);
      await selectionToggle.click();
      assert.equal(await selectAll.isVisible(), false);
      assert.equal(await selectionToggle.evaluate(button => button === document.activeElement), true);
      await ensureInviteSelection(page);
      assert.match(await inviteRows.locator('#inviteSelectionCount').innerText(), /^0\//);
      await setFixtureInviteRows(page,1);
      assert.equal(await page.evaluate(() => window.RSVP_CONFIG.supabaseUrl), "https://fixture.supabase.invalid",
        "source and installed bootstrap use the intercepted synthetic config");
      assert.equal(
        await page.locator("[data-panel=invites]").isVisible(),
        true,
        "Main opens the Invites workspace",
      );
      assert.equal(
        await page
          .locator(".admin-main-tabs button")
          .first()
          .getAttribute("data-tab"),
        "invites",
      );
      assert.equal(await page.locator("[data-panel=dashboard]").count(), 0);
      assert.equal(await page.locator('#mainSectionToggle').getAttribute('aria-label'),'Home');
      assert.equal(await page.locator('[data-tab="invites"]').innerText(),'Main');
      assert.equal(await page.locator('[data-tab="overview"],[data-panel="overview"]').count(),0,'Overview is merged into Invites');
      assert.equal(await page.locator('#statsGrid').evaluate(node=>node.closest('[data-panel]').dataset.panel),'invites');
      const overview = page.locator('#overviewPanel');
      assert.equal(await overview.getByRole('heading',{name:'Overview',exact:true}).count(),1);
      assert.deepEqual(await overview.locator('[data-overview-tab]').allTextContents(),['Information','Invitation']);
      assert.deepEqual(await overview.locator('[data-overview-card]:visible').evaluateAll(cards=>cards.map(card=>card.dataset.overviewCard)),['households','food','rsvp']);
      assert.equal(await overview.locator('[data-overview-card="guests"]').count(),0);
      assert.match(await overview.locator('.overview-people-totals').innerText(), /\d+ Households\s*\/\s*\d+ Guests/);
      await selectOverviewTab(page,'invitation');
      assert.deepEqual(await overview.locator('[data-overview-card]:visible').evaluateAll(cards=>cards.map(card=>card.dataset.overviewCard)),['invites','services','language']);
      await selectOverviewTab(page,'information');
      if (width === 390 || width === 1440) await checkOverviewFilterFeedback(page, width === 390);
      if(width===1440)assert.equal(await page.evaluate(()=>location.hash),'#invites','legacy Overview bookmark is replaced by Invites');
      assert.equal(
        await page.locator('#inviteGroupBy [data-invite-grouping="relational"]').isChecked(),
        true,
        "grouping starts checked",
      );
      assert.ok(
        (await page.locator("#inviteRows .invite-overview-group").count()) > 0,
      );
      const readyActions = page.locator(".invite-copy-options:has(.invite-copy-text)");
      assert.ok(await readyActions.evaluate(node => {
        const bounds = node.parentElement.getBoundingClientRect();
        const [invitation, text] = [...node.children].map(chip => chip.getBoundingClientRect());
        const sideBySide = Math.abs(invitation.top - text.top) < 1 && invitation.right <= text.left;
        const stacked = invitation.bottom <= text.top;
        return (sideBySide || stacked) && text.right <= bounds.right + 1;
      }), "Invitation and Text fit without overlap at " + width + "px");
      const geometry = await page.locator(".invite-household > summary").first().evaluate((summary) => {
        const identity = summary.querySelector('.invite-overview-identity'), name = identity.querySelector('strong');
        return { extraArrow:getComputedStyle(identity,'::before').content, nameArrow:getComputedStyle(name,'::before').content, detailCells:summary.querySelectorAll('.invite-overview-household-info,.invite-overview-service-info').length, overflow:summary.scrollWidth>summary.clientWidth+1 };
      });
      assert.ok(['none','normal','""'].includes(geometry.extraArrow),'identity must not add a second arrow');
      assert.match(geometry.nameArrow,/›/);
      assert.equal(geometry.detailCells,phone ? 0 : 1,'Service is shown in the summary on tablet and desktop');
      assert.equal(geometry.overflow,false,'summary stays within its width');
      assert.deepEqual(await page.locator('.invite-overview-heading > span:not(.invite-overview-select)').allTextContents(), phone ? ['Household','Invitation','RSVP'] : ['Household','Recipient','Service','Invitation','RSVP']);
      if (width > 1000) {
        assert.equal(await page.evaluate(() => {
          const labels=[...document.querySelectorAll('.invite-overview-heading > span')], cells=[...document.querySelector('.invite-household > summary').children];
          return cells.every((cell,i)=>Math.abs(cell.getBoundingClientRect().left-labels[i].getBoundingClientRect().left)<3);
        }),true,'column headings align with their cells');
        const header = await page.locator(".invite-overview-heading").evaluate(node => {
          const style = getComputedStyle(node);
          const firstGroup = node.parentElement.querySelector(".invite-overview-group");
          return {
            topBorder: parseFloat(style.borderTopWidth),
            groupGap: firstGroup.getBoundingClientRect().top - node.getBoundingClientRect().bottom,
          };
        });
        assert.ok(header.topBorder >= 1, "the invitation columns have a top divider");
        assert.ok(header.groupGap >= 0 && header.groupGap < 10, "the first invitation group sits close below the column headings");
      }
      if(process.env.RSVP_INVITE_PREVIEW_DIR){fs.mkdirSync(process.env.RSVP_INVITE_PREVIEW_DIR,{recursive:true});await page.locator('#inviteRows').screenshot({path:path.join(process.env.RSVP_INVITE_PREVIEW_DIR,`invites-${width}.png`)});}
      if (width === 1440) {
        await checkLiveGuestOverview(page);
        await checkInvitationActivity(page);
        await checkOverviewFilters(page);
        await checkSeenPresentation(page);
        await checkRsvpFoodPresentation(page);
        await checkRowsPresentation(page);
        await checkGroupingPreservation(page);
      }
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
      await selectOverviewTab(page, "invitation");
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
      if (phone) await inviteRows.locator('.invite-compact-name').click();
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
      await page.locator("#inviteSearchToggle").click();
      await page.locator("#inviteSearch").fill("refreshed recipient");
      assert.equal(await page.locator("#inviteRows .invite-household").count(),1);
      await page.locator("#inviteSearch").fill("example@example.invalid");
      assert.equal(await page.locator("#inviteRows .invite-household").count(),0,"Search combines with the active Ready filter");
      await page.locator("#inviteSearchClose").click();
      assert.equal(await page.locator("#inviteSearchPanel").isVisible(),false);
      assert.equal(await page.locator("#inviteSearch").inputValue(),"");
      assert.equal(await page.locator("[data-invite-filter=ready]").getAttribute("aria-pressed"),"true","closing Search preserves the invitation filter");
      assert.equal(await page.locator("#inviteRows .invite-household").count(),1);
      await page.locator("[data-invite-filter=ready]").click();
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
      await sent.locator("details[id^=invite-delivery-]").evaluate(node => { node.open = true; });
      const sentLog = sent.locator("[data-delivery-log-queue-id=queue-sent]");
      await sentLog.evaluate(node => { node.open = true; });
      assert.match(await sentLog.innerText(), /Recorded sent · Email · Sent subject/);
      const draft = sent.locator('[data-delivery-id="' + draftId + '"]');
      await sent.locator('[data-invite-delivery-submenu="drafts"]').evaluate(node => { node.open = true; });
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
      await sent.locator("details[id^=invite-delivery-]").evaluate(node => { node.open = true; });
      await sentLog.evaluate(node => { node.open = true; });
      assert.match(await sentLog.innerText(), /Sent example/);
      assert.match(await sentLog.innerText(), /Recorded sent · Email · Sent subject/);
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
      assert.deepEqual(await page.locator('.invite-overview-heading > span:not(.invite-overview-select)').allTextContents(), phone ? ['Household','Invitation','RSVP'] : ['Household','Recipient','Service','Invitation','RSVP'],'Food permission leaves the unrelated columns visible');
      assert.equal(await page.locator('#inviteRows .invite-preview').count(),0,'a household preview requires Food access when the feature is enabled');
      if (width === 320 || width === 1440) await checkBulkDraftGeneration(page);
      if (width === 1440) { await checkInvitesCopyAndFilters(page); await checkManualInvitations(page); await checkReadyGenerationBoundaries(page); }
      if (width === 320 || width === 1440) {
        await page.reload();
        await page.locator("#inviteRows .invite-household").first().waitFor();
        await ensureInviteSelection(page);
        await checkMobileDraftSelection(page, width === 1440);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS Invites overview: visible select-all and count, separate link loads and qualified visits, Draft-only generation, mixed-selection drafting and readiness, responsive filters, exact Invitation clipboard content and fallback, individual Review, guarded manual Sent, partial recovery and preserved history.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
