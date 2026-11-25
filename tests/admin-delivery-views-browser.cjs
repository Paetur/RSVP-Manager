const { refreshFixture, selectOverviewTab } = require("./helpers/admin-toolbar.cjs");
// Real delivery UI and synthetic records; never contacts a populated database.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("admin-delivery-views");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 820, height: 1180 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem("rsvp-interface-language", "en"),
    );
    const seed = `
fixtures.event_settings[0].is_published=true;
const archivedId='88888888-1111-4888-8111-888888888888';
fixtures.households.push({id:archivedId,household_name:'Archived example',invite_code:'QRSTUVWX',language:'en',archived_at:'2026-11-15T12:00:00Z'});
fixtures.guests.push({id:'99999999-1111-4999-8111-999999999999',household_id:archivedId,first_name:'Past',last_name:'Guest',language:'en',rsvp_status:'pending'});
fixtures.guests.push({id:'77777777-1111-4777-8111-777777777777',household_id:h3,first_name:'Another',last_name:'Guest',language:'en',rsvp_status:'pending'});
const deliveryHouseholds=fixtures.households.filter(h=>h.invite_code&&!h.archived_at&&fixtures.guests.some(g=>g.household_id===h.id&&!g.archived_at));
const deliveryRow=(status,h,day,suffix=status)=>({id:'view-'+suffix,household_id:h.id,channel:'manual',status,revision:1,created_at:'2026-11-'+day+'T12:00:00Z',updated_at:'2026-11-'+day+'T12:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_name:'Example recipient'},message_subject:'Example',message_body:'Synthetic '+status+' invitation'});
fixtures.invitation_send_queue=[deliveryRow('sent',deliveryHouseholds[0],12),deliveryRow('failed',deliveryHouseholds[0],13),deliveryRow('ready',deliveryHouseholds[0],14),deliveryRow('cancelled',deliveryHouseholds[0],15),deliveryRow('draft',deliveryHouseholds[1],14),deliveryRow('ready',fixtures.households.find(h=>h.id===archivedId),14,'archived'),deliveryRow('sent',fixtures.households.find(h=>h.id===h1),14,'guestless')];
const readySample=fixtures.invitation_send_queue.find(row=>row.id==='view-ready');
readySample.channel='whatsapp';
readySample.recipient_snapshot={contact_name:'Example recipient',contact_type:'phone',contact_value:'+12025550111'};
fixtures.invitation_deliveries=[{queue_id:'view-sent',confirmed_at:'2026-11-12T12:00:00Z',confirmed_by:h1,delivery_note:'Synthetic delivery note',recipient_snapshot:{contact_name:'Frozen recipient'},message_snapshot:{channel:'email',subject:'Frozen subject',body:'Original frozen invitation',template_snapshot_ref:'synthetic-template'}}];
const reviewDraft=fixtures.invitation_send_queue.find(row=>row.id==='view-draft');
reviewDraft.message_body='Synthetic invitation {invitation_link}';
reviewDraft.message_subject='RSVP {invitation_link}';
reviewDraft.invitation_code_snapshot=null;
window.__readyAttempts=[];
const priorReadyRpc=client.rpc;
client.rpc=async(name,args)=>{
  if(name==='admin_save_delivery'&&args.p_id===reviewDraft.id){
    window.__readyAttempts.push(args);
    if(window.__failReady){window.__failReady=false;return {error:{message:'Synthetic preparation failure'}};}
  }
  return priorReadyRpc(name,args);
};`;
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + seed,
      }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
    );
    await page.locator("[data-tab=invites]").click();
    const ids = await page.evaluate(() => deliveryHouseholds.map(h => h.id));
    const first = page.locator('[data-invite-household="' + ids[0] + '"]');
    const second = page.locator('[data-invite-household="' + ids[1] + '"]');
    const recordIds = (parent) => parent.locator("[data-delivery-id]")
      .evaluateAll(nodes => nodes.map(node => node.dataset.deliveryId));
    assert.equal(await page.locator("#deliveryLog, .delivery-log-section").count(), 0);
    assert.equal(await first.locator("[data-delivery-id]").count(), 0, "collapsed household builds no records");
    await first.locator(":scope > summary .invite-compact-name").click();
    const menu = first.locator(".invite-household-invitation");
    const history = menu.locator('[data-invite-delivery-submenu="logs"]');
    const invitation = menu.locator('[data-invite-delivery-submenu="current"]');
    const current = invitation.locator(".current-invitation");
    await menu.waitFor();
    assert.deepEqual(await menu.locator("[data-invite-delivery-submenu] > summary").allTextContents(),
      ["Current invitation(s)", "Drafts", "Delivery logs · 2"]);
    assert.equal(await history.evaluate(node => node.open), false, "Delivery logs starts collapsed");
    assert.equal(await menu.evaluate(node => node.previousElementSibling.id.startsWith("invite-rsvp-")), true);
    if (!await invitation.evaluate(node => node.open)) await invitation.locator(":scope > summary").click();
    await current.waitFor();
    assert.equal(await history.locator(".current-invitation").count(), 0, "Delivery logs are independent of the current invitation");
    assert.deepEqual(await recordIds(current), ["view-ready", "view-sent"], "ready and last sent for this invitation stay available");
    assert.deepEqual(await recordIds(history), ["view-cancelled"], "a cancellation keeps its own historical status");
    assert.deepEqual(await recordIds(menu.locator('[data-invite-delivery-submenu="drafts"]')), ["view-failed"]);
    const ready = current.locator('[data-delivery-id="view-ready"]');
    assert.match(await ready.locator(":scope > summary").textContent(), /WhatsApp · Ready/);
    await ready.locator(":scope > summary").click();
    await ready.locator(".delivery-message").first().waitFor();
    assert.equal(await current.getByRole("heading", { name: "Current invitation", exact: true }).count(), 0);
    assert.ok(await ready.getByText("Edit delivery", { exact: true }).isVisible());
    assert.ok(await ready.getByRole("button", { name: "Change to Draft", exact: true }).isVisible());
    assert.equal(await ready.locator("a[href^='https://wa.me/'], .invitation-send-form").count(), 0);
    for (const name of ["Copy message", "Share invitation", "Record as sent"])
      assert.equal(await ready.getByRole("button", { name, exact: true }).count(), 0, name + " belongs outside Current invitation");
    assert.equal(await ready.getByLabel("Sent note", { exact: true }).count(), 0);
    if (!await history.evaluate(node => node.open)) await history.locator(":scope > summary").click();
    const currentSent = current.locator('[data-delivery-id="view-sent"]');
    await currentSent.locator(":scope > summary").click();
    assert.ok(await currentSent.getByText("Synthetic sent invitation", { exact: true }).isVisible());
    assert.ok(await currentSent.getByText("Prepare reminder", { exact: true }).isVisible());
    assert.equal(await currentSent.locator(".notice.success").count(), 0, "sent detail lives in Delivery logs");
    const sent = history.locator('[data-delivery-log-queue-id="view-sent"]');
    assert.match(await sent.locator(":scope > summary").textContent(), /^Recorded sent · Email · Frozen subject · .+ · .+/);
    await sent.locator(":scope > summary").click();
    assert.ok(await sent.getByText("Original frozen invitation", { exact: true }).isVisible());
    assert.ok(await sent.getByText("To: Frozen recipient", { exact: true }).isVisible());
    assert.match(await sent.innerText(), /Synthetic delivery note/);
    assert.equal(await sent.getByText("Synthetic sent invitation", { exact: true }).count(), 0, "history uses the stored snapshot");
    assert.equal(await sent.locator("button, a, form").count(), 0, "history cannot edit, hand off or re-send a message");
    await second.locator(":scope > summary .invite-compact-name").click();
    await second.locator(".current-invitation").waitFor({ state: "attached" });
    assert.deepEqual(await recordIds(second), ["view-draft"], "records stay scoped to their own household");
    const draft = second.locator('[data-delivery-id="view-draft"]');
    const markReady = draft.locator("[data-mark-delivery-ready]");
    async function openDraft() {
      const drafts = second.locator('[data-invite-delivery-submenu="drafts"]');
      if (!await drafts.evaluate(node => node.open)) await drafts.locator(":scope > summary").click();
      await draft.locator(".delivery-message").first().waitFor();
    }
    await openDraft();
    assert.equal(await markReady.innerText(), "Make invitation(s)");
    assert.equal(await draft.getByRole("button", { name: "Copy message", exact: true }).count(), 0);
    assert.equal(await markReady.evaluate(button =>
      button.parentElement.previousElementSibling.querySelector("summary").textContent === "Edit delivery"), true);
    const inviteCode = await page.evaluate(() => deliveryHouseholds[1].invite_code);
    assert.ok((await draft.locator(".delivery-message").first().innerText()).endsWith("?=" + inviteCode));
    assert.match(await draft.locator(":scope > .micro").first().innerText(), new RegExp("^RSVP .*\\?=" + inviteCode + "$"));

    await page.evaluate(() => { window.__accessPermissions.sendInvites = false; });
    await refreshFixture(page);
    await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
    await openDraft();
    assert.equal(await markReady.count(), 0, "current preparation requires sending permission");
    await page.evaluate(() => {
      window.__accessPermissions.sendInvites = true;
      reviewDraft.message_body = "An invitation with a stale link https://example.invalid/?=RETIRED";
    });
    await refreshFixture(page);
    await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
    await openDraft();
    await markReady.click();
    await page.locator("#adminMessage").getByText("Refresh and save this delivery again before sending.").waitFor();
    assert.equal(await page.evaluate(() => window.__readyAttempts.length), 0, "stale links cannot be marked ready");
    await page.evaluate(() => { reviewDraft.message_body = "Synthetic invitation {invitation_link}"; window.__failReady = true; });
    await refreshFixture(page);
    await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
    await openDraft();
    await markReady.click();
    await page.locator("#adminMessage").getByText("Synthetic preparation failure").waitFor();
    assert.equal(await markReady.isEnabled(), true, "failed preparation can be retried");
    assert.equal(await markReady.evaluate(button => document.activeElement === button), true);
    assert.equal(await page.evaluate(() => reviewDraft.status), "draft");
    await markReady.click();
    await second.locator(":scope > summary .invite-copy-invitation").waitFor();
    const secondInvitation = second.locator('[data-invite-delivery-submenu="current"]');
    if (!await secondInvitation.evaluate(node => node.open)) await secondInvitation.locator(":scope > summary").click();
    await draft.locator(":scope > .delivery-message").waitFor();
    assert.equal(await draft.locator(":scope > summary").count(), 0, "opening one current invitation reveals its preview directly");
    assert.equal(await markReady.count(), 0);
    const attempt = await page.evaluate(() => window.__readyAttempts.at(-1));
    assert.equal(attempt.p_expected_revision, 1);
    assert.equal(attempt.p_values.expected_invitation_code, inviteCode);
    assert.equal(attempt.p_values.status, "ready");
    assert.ok(attempt.p_values.message_body.endsWith("?=" + inviteCode));
    assert.equal(attempt.p_values.message_subject, attempt.p_values.message_body.replace("Synthetic invitation ", "RSVP "));
    const readySnapshot = await page.evaluate(() => structuredClone(reviewDraft));
    const demote = draft.getByRole("button", { name: "Change to Draft", exact: true });
    await demote.click();
    const review = second.locator(":scope > summary .invite-review-action");
    await review.waitFor();
    assert.equal(await review.evaluate(button => document.activeElement === button), true, "demotion returns focus to Review");
    const draftSnapshot = await page.evaluate(() => structuredClone(reviewDraft));
    assert.equal(draftSnapshot.status, "draft");
    assert.equal(draftSnapshot.revision, readySnapshot.revision + 1);
    assert.equal(draftSnapshot.message_body, readySnapshot.message_body, "demotion keeps the invitation content");
    assert.deepEqual(draftSnapshot.recipient_snapshot, readySnapshot.recipient_snapshot, "demotion keeps the recipient snapshot");
    assert.deepEqual(await page.evaluate(() => window.__readyAttempts.at(-1).p_values),
      { status: "draft", only_if_ready: true });
    await review.click();
    await markReady.click();
    await second.locator(':scope > summary [data-invite-copy="invitation"]').getByText("Invitation", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__calls.some(call => call.name === "admin_record_delivery_sent")), false);

    await page.evaluate(() => { window.__accessPermissions.sections.households = "none"; });
    await refreshFixture(page);
    await page.waitForFunction(() => !document.querySelector('[data-tab="households"]').getClientRects().length);
    await selectOverviewTab(page, "invitation");
    const inactive = page.locator(".invite-inactive-households");
    assert.equal(await inactive.evaluate(node => node.open), false, "inactive household records start collapsed");
    assert.equal(await page.locator("#inviteStatusTotal").innerText(), "2", "inactive rows do not change active totals");
    await inactive.locator(":scope > summary").click();
    const pastHouseholds = inactive.locator("[data-invite-inactive-household]");
    assert.equal(await pastHouseholds.count(), 2, "Invites-only access retains archived and guestless households");
    for (const [index, id] of ["view-archived", "view-guestless"].entries()) {
      const past = pastHouseholds.nth(index);
      await past.locator(":scope > summary").click();
      const entry = past.locator('[data-delivery-id="' + id + '"]');
      await entry.locator(":scope > summary").click();
      assert.equal(await past.locator("[data-bulk-select], .current-invitation, .invitation-send-form, form.delivery-review-form").count(), 0);
      assert.ok(await entry.getByRole("button", { name: "Copy message" }).isVisible(), "historical text stays accessible");
    }
    await page.setViewportSize({ width: 320, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "open history fits a narrow screen");
    await page.locator('[data-invite-filter="needs-draft"]').click();
    assert.equal(await inactive.count(), 0, "inactive households do not contribute to draft generation");
    await page.locator('[data-invite-filter="needs-draft"]').click();

    await page.evaluate(() => {
      const ready = fixtures.invitation_send_queue.find(q => q.status === "ready");
      fixtures.invitation_send_queue = [
        { ...ready, id: "view-refreshed", created_at: "2026-11-16T12:00:00Z" },
      ];
    });
    await refreshFixture(page);
    await current.locator('[data-delivery-id="view-refreshed"]').waitFor();
    assert.deepEqual(await recordIds(current), ["view-refreshed"]);
    assert.equal(await history.locator("[data-delivery-id]").count(), 0, "the household history uses the reloaded store");
    assert.equal(await inactive.count(), 0, "empty inactive grouping stays hidden");
    const secondHistory = second.locator("details[id^=invite-delivery-]");
    if (!await secondHistory.evaluate(node => node.open)) await secondHistory.locator(":scope > summary").click();
    assert.ok(await second.getByText("No delivery recorded yet.", { exact: true }).isVisible());
    await page.evaluate(() => {
      const only = fixtures.invitation_send_queue[0];
      only.status = "sent";
      fixtures.invitation_deliveries = [{ queue_id: only.id, confirmed_at: only.updated_at,
        confirmed_by: h1, delivery_note: "Synthetic current confirmation" }];
    });
    await refreshFixture(page);
    const confirmation = history.locator('[data-delivery-log-queue-id="view-refreshed"]');
    await confirmation.getByText(/Synthetic current confirmation/).waitFor();
    assert.match(await confirmation.innerText(), /^Recorded sent · WhatsApp · Example/);
    assert.equal(await confirmation.locator("summary, .delivery-message").count(), 0, "a confirmation without a stored message has no fabricated preview");
    assert.equal(await history.locator("[data-delivery-id]").count(), 0, "the confirmation avoids duplicating the current record");
    assert.deepEqual(errors, []);
    console.log(
      "PASS delivery views: standalone current invitation, household history, revision-checked readiness round trip, permissions, stale link and failed retry, inactive access and replaced-store reload.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
