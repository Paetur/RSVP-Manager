const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
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
fixtures.invitation_deliveries=[{queue_id:'view-sent',confirmed_at:'2026-11-12T12:00:00Z',confirmed_by:h1,delivery_note:'Synthetic delivery note'}];`;
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + seed,
      }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
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
    const section = first.locator('[id^="invite-delivery-"]');
    const current = section.locator(".current-invitation");
    const history = section.locator(".household-delivery-history");
    await current.waitFor();
    assert.deepEqual(await recordIds(current), ["view-ready"], "newest cancelled row belongs to history");
    assert.deepEqual(await recordIds(history), ["view-cancelled", "view-failed", "view-sent"]);
    const ready = current.locator('[data-delivery-id="view-ready"]');
    await ready.locator(":scope > summary").click();
    assert.ok(await ready.getByText("Edit delivery", { exact: true }).isVisible());
    const sent = history.locator('[data-delivery-id="view-sent"]');
    await sent.locator(":scope > summary").click();
    assert.ok(await sent.getByText("Synthetic sent invitation", { exact: true }).isVisible());
    assert.match(await sent.innerText(), /Synthetic delivery note/);
    assert.equal(await sent.getByText("Edit delivery", { exact: true }).count(), 0);
    await second.locator(":scope > summary .invite-compact-name").click();
    await second.locator(".current-invitation").waitFor();
    assert.deepEqual(await recordIds(second), ["view-draft"], "records stay scoped to their own household");

    await page.evaluate(() => { window.__accessPermissions.sections.households = "none"; });
    await refreshFixture(page);
    await page.waitForFunction(() => !document.querySelector('[data-tab="households"]').getClientRects().length);
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
    await page.locator('[data-invite-filter="all"]').click();

    await page.evaluate(() => {
      const ready = fixtures.invitation_send_queue.find(q => q.status === "ready");
      fixtures.invitation_send_queue = [
        { ...ready, id: "view-refreshed", created_at: "2026-11-16T12:00:00Z" },
      ];
    });
    await refreshFixture(page);
    await current.locator('[data-delivery-id="view-refreshed"]').waitFor();
    assert.deepEqual(await recordIds(current), ["view-refreshed"]);
    assert.equal(await history.count(), 0, "the household history uses the reloaded store");
    assert.equal(await inactive.count(), 0, "empty inactive grouping stays hidden");
    assert.ok(await second.getByText("No delivery recorded yet.", { exact: true }).isVisible());
    assert.deepEqual(errors, []);
    console.log(
      "PASS delivery views: household-scoped history, current draft choice, saved records and notes, current edit action, inactive access and replaced-store reload.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
