// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("invites-overview");
const overviewMock = String.raw`
fixtures.guests.push({id:'99999999-9999-4999-8999-999999999999',household_id:h3,first_name:'Other',last_name:'Example'});
fixtures.invitation_send_queue=[{id:'queue-sent',household_id:h2,channel:'email',status:'sent',message_body:'Sent example',created_at:'2026-11-10T12:00:00Z',updated_at:'2026-11-10T12:00:00Z',revision:2,recipient_snapshot:{contact_name:'Example recipient',contact_value:'example@example.invalid'}},{id:'queue-ready',household_id:h3,channel:'sms',status:'ready',message_body:'Ready example',created_at:'2026-11-11T12:00:00Z',updated_at:'2026-11-11T12:00:00Z',revision:1,recipient_snapshot:{contact_name:'Other recipient',contact_value:'+298123456'}}];fixtures.invitation_deliveries=[{queue_id:'queue-sent',confirmed_at:'2026-11-10T12:00:00Z',confirmed_by:h1}];
const overviewRpc=client.rpc;client.rpc=async(name,a)=>{if(name==='admin_save_delivery'){(window.__draftWrites??=[]).push(a);const item={id:crypto.randomUUID(),household_id:a.p_household_id,...a.p_values,revision:1,created_at:'2026-11-12T12:00:00Z',updated_at:'2026-11-12T12:00:00Z',recipient_snapshot:{contact_name:'Synthetic recipient',contact_value:'synthetic@example.invalid'}};fixtures.invitation_send_queue.push(item);return {data:item.id};}return overviewRpc(name,a);};`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } }),
        errors = [];
      page.setDefaultTimeout(8000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "Map fixture" }),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + overviewMock,
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(
        () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
      );
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
      assert.equal(
        await page
          .locator("[data-panel=invites] > :first-child")
          .getAttribute("id"),
        "statsGrid",
      );
      assert.equal(
        await page.locator("#inviteGroupView").isChecked(),
        true,
        "grouping starts checked",
      );
      assert.ok(
        (await page.locator("#inviteRows .invite-overview-group").count()) > 0,
      );
      await page.locator("#settingsToggle").click();
      assert.equal(
        await page
          .locator(".settings-tabs button")
          .first()
          .getAttribute("data-settings-tab"),
        "checklist",
      );
      await page.locator("[data-settings-tab=checklist]").click();
      assert.equal(
        await page
          .locator("[data-settings-panel=checklist] #launchChecklist")
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
      await page.locator("#inviteGroupView").uncheck();
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
      await page.locator("#refreshButton").click();
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
        await page.locator("#inviteGroupView").isChecked(),
        false,
        "refresh preserves the chosen layout",
      );
      assert.equal(
        await page.locator("#inviteRows .invite-overview-group").count(),
        0,
      );
      await page.locator("[data-invite-filter=all]").click();
      await page.locator("#inviteSearch").fill("example@example.invalid");
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await page.locator("#inviteSearch").fill("");
      await page.locator("#inviteLanguageFilter").selectOption("de");
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await page.locator("#inviteLanguageFilter").selectOption("all");
      await page.locator("#inviteChannelFilter").selectOption("email");
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await page.locator("#inviteChannelFilter").selectOption("all");
      await page.locator("#inviteGroupView").check();
      assert.ok((await page.locator(".invite-overview-group").count()) > 0);
      await page.locator("#inviteGroupView").uncheck();

      const sent = page.locator(
        '[data-invite-household="22222222-2222-4222-8222-222222222222"]',
      );
      await sent
        .getByRole("button", { name: "Follow up", exact: true })
        .click();
      await sent
        .getByText(
          "Prepare drafts now. Marking ready and sending become available after publication.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await sent
          .getByRole("button", { name: "Record as sent", exact: true })
          .count(),
        0,
      );
      await sent
        .locator("[data-delivery-id=queue-sent]")
        .evaluate((n) => (n.open = true));
      assert.match(await sent.innerText(), /Manually recorded as sent/);
      const create = sent
        .locator(
          "#invite-delivery-22222222-2222-4222-8222-222222222222>details",
        )
        .first();
      await create.evaluate((n) => (n.open = true));
      const form = create.locator("form");
      assert.equal(
        await form
          .getByRole("combobox", { name: "Delivery status", exact: true })
          .locator("option[value=ready]")
          .count(),
        0,
      );
      await form
        .locator("textarea")
        .first()
        .fill("Draft message {invitation_link}");
      await form
        .getByRole("button", { name: "Create delivery draft", exact: true })
        .click();
      await page.waitForFunction(() => window.__draftWrites?.length === 1);
      assert.equal(
        await page.evaluate(() => window.__draftWrites[0].p_values.status),
        "draft",
      );
      assert.equal(
        await page.evaluate(
          () =>
            fixtures.invitation_send_queue.find((q) => q.id === "queue-sent")
              .message_body,
        ),
        "Sent example",
      );
      assert.equal(
        await page.evaluate(() => fixtures.event_settings[0].is_published),
        false,
      );
      assert.match(
        await page.locator("[data-invite-filter=sent]").innerText(),
        /1/,
      );
      // The extracted view must pick up changed permissions on the next reload.
      await page.evaluate(() => {
        window.__accessPermissions.preset = "custom";
        window.__accessPermissions.sections.invites = "view";
      });
      await page.locator("#refreshButton").click();
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      assert.equal(
        await sent.getByRole("button", { name: "Review", exact: true }).count(),
        1,
      );
      assert.equal(
        await sent
          .getByRole("button", { name: "Follow up", exact: true })
          .count(),
        0,
      );
      await sent.getByRole("button", { name: "Review", exact: true }).click();
      assert.equal(
        await sent
          .locator("button:visible")
          .filter({ hasText: "Create delivery draft" })
          .count(),
        0,
      );
      assert.equal(await page.evaluate(() => window.__draftWrites.length), 1);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS Invites overview: flat/grouped layout, household counts, separate sent/RSVP filters, recipient/language/channel search, unpublished drafts, preserved sent history and mobile/desktop fit.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
