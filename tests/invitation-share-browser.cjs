// Real DOM and synthetic APIs. Native OS share-sheet appearance needs an iPad.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("invitation-share");
async function openHouseholdDelivery(page, household) {
  await page.locator('[data-tab="households"]').click();
  const profile = page.locator('[data-tree-key="household:' + household + '"]');
  await profile.evaluate(node => {
    for (let parent = node; parent; parent = parent.parentElement) {
      if (parent.matches("details")) parent.open = true;
    }
  });
  const delivery = profile.locator(":scope > .household-expanded > .feature-section")
    .filter({ has: page.locator(".invitation-delivery-sections") });
  await delivery.evaluate(node => node.open = true);
  return delivery;
}
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const viewport of [
      { width: 820, height: 1180 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
      { width: 1280, height: 950 },
    ]) {
      const page = await browser.newPage({
        viewport,
      });
      page.on("pageerror", (e) => console.error(e.message));
      await page.addInitScript(() => {
        localStorage.setItem("rsvp-interface-language", "en");
        window.__shares = [];
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data) => {
            window.__shares.push({
              ...data,
              activation: navigator.userActivation.isActive,
            });
            if (window.__shareError)
              throw new DOMException(
                "Synthetic share failure",
                window.__shareError,
              );
          },
        });
        Object.defineProperty(navigator, "canShare", {
          configurable: true,
          value: () => !window.__unsupported,
        });
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: async (text) => (window.__copied = text) },
        });
      });
      const seed = `fixtures.event_settings[0].is_published=true;const h=fixtures.households.find(h=>!h.archived_at&&h.invite_code);window.__shareHousehold=h.id;fixtures.invitation_send_queue=[{id:'share-ready',household_id:h.id,channel:'email',status:'ready',revision:1,created_at:'2026-11-13T10:00:00Z',updated_at:'2026-11-13T10:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_name:'Example recipient',contact_value:'example@example.invalid'},message_subject:'Invitation',message_body:'Hello Føroyskt & Deutsch\\nhttps://example.invalid/?'+h.invite_code},{id:'share-stale',household_id:h.id,channel:'email',status:'ready',revision:1,created_at:'2026-11-13T10:00:00Z',updated_at:'2026-11-13T10:00:00Z',invitation_code_snapshot:'RETIRED',recipient_snapshot:{},message_body:'Stale'}];const previousShareRpc=client.rpc;client.rpc=async(name,args)=>{if(name==='admin_record_share_handoff'){window.__logAttempts=(window.__logAttempts||[]);window.__logAttempts.push(args);if(window.__failLog){window.__failLog=false;return {error:{message:'Synthetic logging failure'}};}return {data:null};}if(name==='admin_authorize_device_send'){window.__authCalls=(window.__authCalls||0)+1;return {data:!window.__denyShare};}return previousShareRpc(name,args);};`;
      const currentFixture = `
        fixtures.invitation_send_queue.push({
          ...fixtures.invitation_send_queue.find(q=>q.id==='share-ready'),
          id:'share-current',
          created_at:'2026-11-14T10:00:00Z',
          updated_at:'2026-11-14T10:00:00Z'
        });
      `;
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + seed + currentFixture,
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      await page.locator("[data-tab=invites]").click();
      const household = await page.evaluate(() => window.__shareHousehold);
      const row = page.locator(`#inviteRows [data-invite-household="${household}"]`);
      await row.locator(":scope > summary .invite-compact-name").click();
      const logs = row.locator('[data-invite-delivery-submenu="logs"]');
      await logs.locator(":scope > summary").click();
      assert.equal(await logs.getByRole("button", { name: "Share invitation", exact: true }).count(), 0);
      assert.equal(await row.locator('[data-invite-delivery-submenu="current"]')
        .getByRole("button", { name: "Share invitation", exact: true }).count(), 0);
      const delivery = await openHouseholdDelivery(page, household);
      const ready = delivery.locator("[data-delivery-id=share-ready]"),
        trigger = ready.getByRole("button", {
          name: "Share invitation",
          exact: true,
        });
      await ready.locator(":scope > summary").click();
      await trigger.waitFor();
      assert.equal(await delivery.locator("[data-delivery-id=share-stale]")
        .getByRole("button", { name: "Share invitation", exact: true }).count(), 0);
      await trigger.click();
      const dialog = page.getByRole("region", {
        name: "Share invitation",
        exact: true,
      });
      const share = dialog.getByRole("button", {
        name: "Share invitation",
        exact: true,
      });
      await share.waitFor();
      await page.waitForFunction(() =>
        document.querySelector(
          ".invitation-share-dialog button.btn:not(:disabled)",
        ),
      );
      assert.equal(await page.evaluate(() => window.__shares.length), 0);
      assert.equal(await page.evaluate(() => window.__authCalls), 1);
      await share.click();
      await page.waitForFunction(() => window.__shares.length === 1);
      const payload = await page.evaluate(() => window.__shares[0]);
      assert.equal(payload.title, "Invitation");
      assert.match(payload.text, /Føroyskt & Deutsch/);
      assert.equal(payload.activation, true);
      assert.equal(
        payload.url,
        "https://example.invalid/?EFGHJKLM",
        "Explicit current invitation URL is supplied to link-oriented targets",
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.__calls.filter(
              (c) => c.name === "admin_record_delivery_sent",
            ).length,
        ),
        0,
      );
      assert.equal(
        await share.isDisabled(),
        true,
        "successful handoff must not permit accidental re-sharing",
      );
      await page.waitForFunction(() => window.__logAttempts?.length === 1);
      await dialog.getByText(/Share handoff completed/).waitFor();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      for (const error of ["AbortError", "DataError"]) {
        await page.evaluate((e) => (window.__shareError = e), error);
        await trigger.click();
        await share.waitFor();
        await page.waitForFunction(
          () =>
            !document.querySelector(".invitation-share-dialog button.btn")
              .disabled,
        );
        await share.click();
        await page.waitForFunction(
          () =>
            !document.querySelector(".invitation-share-dialog button.btn")
              .disabled,
        );
        if (error === "AbortError")
          assert.doesNotMatch(
            await dialog.innerText(),
            /Synthetic share failure/,
          );
        else
          await dialog
            .getByText("Synthetic share failure", { exact: true })
            .waitFor();
        assert.equal(await page.evaluate(() => window.__logAttempts.length), 1);
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      await page.evaluate(() => {
        window.__shareError = null;
        window.__failLog = true;
      });
      await trigger.click();
      await page.waitForFunction(
        () =>
          !document.querySelector(".invitation-share-dialog button.btn")
            .disabled,
      );
      await share.click();
      await dialog
        .getByRole("button", { name: "Retry logging", exact: true })
        .waitFor();
      const beforeRetry = await page.evaluate(() => window.__shares.length);
      await dialog
        .getByRole("button", { name: "Retry logging", exact: true })
        .click();
      await dialog.getByText(/Share handoff completed/).waitFor();
      assert.equal(
        await page.evaluate(() => window.__shares.length),
        beforeRetry,
        "retry must not open native sheet",
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.__logAttempts[1].p_handoff_id ===
            window.__logAttempts[2].p_handoff_id,
        ),
        true,
      );
      await dialog
        .getByRole("button", { name: "Copy message", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => window.__copied),
        await page.evaluate(
          () =>
            fixtures.invitation_send_queue.find((q) => q.id === "share-ready")
              .message_body,
        ),
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.waitForFunction(
        (n) => document.activeElement === n,
        await trigger.elementHandle(),
      );
      await page.evaluate(() => (window.__denyShare = true));
      await trigger.click();
      await dialog
        .getByText(
          "This action is not allowed by your administrator permissions.",
          { exact: true },
        )
        .waitFor();
      assert(await share.isDisabled());
      assert(
        await dialog
          .getByRole("button", { name: "Copy message", exact: true })
          .isDisabled(),
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.evaluate(() => {
        window.__denyShare = false;
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: undefined,
        });
      });
      await trigger.click();
      await dialog
        .getByText(
          "System sharing is unavailable here. Use Copy message or open a device app.",
          { exact: true },
        )
        .waitFor();
      assert(await share.isHidden());
      await dialog
        .getByRole("button", { name: "Copy message", exact: true })
        .click();
      assert.equal(
        await page.evaluate(
          () =>
            window.__calls.filter(
              (c) => c.name === "admin_record_delivery_sent",
            ).length,
        ),
        0,
      );
      for (const restriction of [
        "fixtures.event_settings[0].is_published=false;",
        "window.__accessPermissions.sendInvites=false;",
      ]) {
        const restricted = await browser.newPage();
        await restricted.addInitScript(() =>
          localStorage.setItem("rsvp-interface-language", "en"),
        );
        await restricted.route("**/supabase.min.js", (r) =>
          r.fulfill({
            contentType: "text/javascript",
            body: mock + "\n" + extra + "\n" + seed + currentFixture + "\n" + restriction,
          }),
        );
        await restricted.goto(
          "http://127.0.0.1:" + server.address().port + "/admin/",
        );
        await restricted.waitForFunction(
          () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
        );
        const restrictedDelivery = await openHouseholdDelivery(restricted, household);
        await restrictedDelivery.locator("[data-delivery-id=share-ready]").waitFor({ state: "attached" });
        assert.equal(await restrictedDelivery
          .getByRole("button", { name: "Share invitation", exact: true }).count(), 0);
        await restricted.close();
      }
      console.log(
        "PASS invitation share: authorization before direct gesture, Unicode payload, no auto-sent writes, stale-code exclusion, cancellation/error, permission denial, copy fallback and focus return.",
      );
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
