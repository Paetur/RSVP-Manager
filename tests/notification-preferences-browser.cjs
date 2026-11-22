const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
// Synthetic APIs only. Message filters never alter saved audit/receipt content.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { server, mock, extra, stageExtra, cleanup } = createPublicFoodHarness(
  "notification-preferences:phone",
);
const behavior = `
window.__noticeWrites=[];
const noticesRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='admin_save_guest_interface'){
  if(window.__failNotices){window.__failNotices=false;return {error:{message:'Synthetic notification save failure'}};}
  window.__noticeWrites.push(args);fixtures.event_settings[0].guest_interface_modes||={};fixtures.event_settings[0].guest_interface_modes[args.p_mode]={...fixtures.event_settings[0].guest_interface_modes[args.p_mode],...args.p_values};return {data:null};
 }
 const result=await noticesRpc(name,args);
 if(name==='get_public_event_v2'&&result.data?.event)result.data.event.notification_preferences={guest:fixtures.event_settings[0].notification_preferences?.guest};
 return result;
};`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    async function pageFor(policy) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 1100 },
      });
      page.setDefaultTimeout(8000);
      await page.addInitScript(() => {
        if (window.top === window) localStorage.setItem("rsvp-interface-language", "en");
      });
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "Map fixture" }),
      );
      await routeSyntheticSdk(page,
        mock + "\n" + extra + "\n" + stageExtra + "\n" + behavior +
        (policy
          ? '\nfixtures.event_settings[0].food_stage="selection";window.__foodAnswer=true;fixtures.food_items[0].recipe_text="Synthetic recipe";fixtures.event_settings[0].notification_preferences={guest:' + JSON.stringify(policy) + "};"
          : ""));
      return page;
    }
    const base = "http://127.0.0.1:" + server.address().port,
      page = await pageFor();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/admin/");
    await page.waitForFunction(
      () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
    );
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=interface]").click();
    assert.equal(await page.locator("details.notification-settings-disclosure").count(), 0);
    assert.equal(await page.locator("#notificationSettingsHost > .settings-card-heading").isVisible(), true);
    await page.locator('button[data-notification-mode="phone"]').click();
    const host = page.locator('[data-settings-card="notification-preferences:phone"]');
    await host.waitFor();
    assert.equal(await host.locator("form").isVisible(), false);
    await openBox(page, "notification-preferences:phone");

    let admin = host.getByRole("group", { name: "Admin", exact: true }),
      guest = host.getByRole("group", { name: "Guest", exact: true });
    assert.equal(
      await admin
        .getByRole("checkbox", {
          name: "Hide messages after 5 seconds",
          exact: true,
        })
        .isChecked(),
      true,
    );
    assert.equal(
      await guest
        .getByRole("checkbox", {
          name: "Hide messages after 5 seconds",
          exact: true,
        })
        .isChecked(),
      false,
    );
    assert.equal(
      await admin
        .getByRole("checkbox", { name: "Show timestamps", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await guest
        .getByRole("checkbox", { name: "Show timestamps", exact: true })
        .isChecked(),
      false,
    );
    const redecorated = await page.evaluate(() => {
      const R = window.RSVP,
        N = window.RSVP_NOTIFICATIONS;
      R.showStatus("adminMessage", "Timestamp example", "info");
      const node = document.getElementById("adminMessage"),
        at = node.querySelector("time").dateTime;
      N.configure("admin", { preset: "all", types: [], showTimestamp: false });
      const off = node.textContent;
      N.configure("admin", { preset: "all", types: [], showTimestamp: true });
      const on = node.querySelectorAll("time").length,
        retained = node.querySelector("time").dateTime === at;
      N.configure("admin", null);
      R.showStatus("adminMessage", "");
      return { off, on, retained };
    });
    assert.deepEqual(redecorated, {
      off: "Timestamp example",
      on: 1,
      retained: true,
    });
    await admin
      .getByRole("checkbox", { name: "Show timestamps", exact: true })
      .uncheck();
    await guest
      .getByRole("checkbox", { name: "Show timestamps", exact: true })
      .check();
    await admin
      .getByRole("checkbox", {
        name: "Hide messages after 5 seconds",
        exact: true,
      })
      .uncheck();
    await admin.getByRole("radio", { name: "Custom", exact: true }).check();
    for (const name of ["Information", "Success", "Warnings"])
      await admin.getByRole("checkbox", { name, exact: true }).uncheck();
    await guest
      .getByRole("radio", { name: "Errors only", exact: true })
      .check();
    await guest
      .getByRole("checkbox", {
        name: "Hide messages after 5 seconds",
        exact: true,
      })
      .check();
    assert.equal(await page.evaluate(() => window.__noticeWrites.length), 0);
    await host.getByRole("button", { name: "Save", exact: true }).click();
    await host
      .getByText("Status message preferences saved.", { exact: true })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.__noticeWrites[0].p_expected),
      { notification_preferences: null },
    );
    assert.equal(
      await page.evaluate(() => fixtures.event_settings[0].is_published),
      false,
    );
    assert.equal(
      await page.evaluate(
        () =>
          fixtures.event_settings[0].guest_interface_modes.phone.notification_preferences.guest.autoDismiss,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        () =>
          fixtures.event_settings[0].guest_interface_modes.phone.notification_preferences.admin.autoDismiss,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        () =>
          fixtures.event_settings[0].guest_interface_modes.phone.notification_preferences.admin
            .showTimestamp,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        () =>
          fixtures.event_settings[0].guest_interface_modes.phone.notification_preferences.guest
            .showTimestamp,
      ),
      true,
    );
    await page.evaluate(() =>
      window.RSVP.showStatus("adminMessage", "Saved example", "success"),
    );
    assert.equal(await page.locator("#adminMessage").isHidden(), true);
    await page.evaluate(() =>
      window.RSVP.showStatus("adminMessage", "Error example", "error"),
    );
    assert.equal(
      await page.locator("#adminMessage").innerText(),
      "Error example",
    );
    await openBox(page, "notification-preferences:phone");
    admin = host.getByRole("group", { name: "Admin", exact: true });
    await admin
      .getByRole("radio", { name: "All messages", exact: true })
      .check();
    await admin
      .getByRole("checkbox", { name: "Show timestamps", exact: true })
      .check();
    await page.evaluate(() => (window.__failNotices = true));
    await host.getByRole("button", { name: "Save", exact: true }).click();
    await host
      .getByText("Synthetic notification save failure", { exact: true })
      .waitFor();
    assert.equal(
      await admin
        .getByRole("radio", { name: "All messages", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => fixtures.event_settings[0].guest_interface_modes.phone.notification_preferences.admin.preset,
      ),
      "custom",
    );
    assert.equal(
      await admin
        .getByRole("checkbox", { name: "Show timestamps", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () =>
          fixtures.event_settings[0].guest_interface_modes.phone.notification_preferences.admin
            .showTimestamp,
      ),
      false,
    );
    await host.getByRole("button", { name: "Cancel", exact: true }).click();
    await openBox(page, "notification-preferences:phone");
    assert.equal(
      await host
        .getByRole("group", { name: "Admin", exact: true })
        .getByRole("checkbox", { name: "Show timestamps", exact: true })
        .isChecked(),
      false,
    );
    assert.equal(
      await host
        .getByRole("group", { name: "Admin", exact: true })
        .getByRole("radio", { name: "Custom", exact: true })
        .isChecked(),
      true,
    );
    await page.evaluate(() => {
      window.__accessPermissions.preset = "custom";
      window.__accessPermissions.sections.settings = "view";
    });
    await refreshFixture(page);
    await page.waitForFunction(
      () => !document.querySelector("#refreshButton").disabled,
    );
    assert.equal(await host.locator("button[type=submit]").isDisabled(), true);
    assert.equal(await host.locator("form").isVisible(), false);
    assert.equal(await host.locator("[data-local-edit]:visible").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    for (const policy of [
      {},
      { autoDismiss: false },
      { autoDismiss: true },
      { showTimestamp: false },
      { showTimestamp: true, autoDismiss: false },
    ]) {
      const adminPage = await pageFor();
      await adminPage.clock.install();
      await adminPage.goto(base + "/admin/");
      await adminPage.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      await adminPage.evaluate((policy) => {
        fixtures.event_settings[0].notification_preferences = {
          admin: { preset: "all", types: [], ...policy },
          guest: { preset: "all", types: [] },
        };
      }, policy);
      async function refreshNotice() {
        await refreshFixture(adminPage);
        await adminPage.waitForFunction(
          () => !document.querySelector("#refreshButton").disabled,
        );
        assert.equal(
          await adminPage.locator("#adminMessage").isVisible(),
          true,
        );
        assert.equal(
          await adminPage.locator("#adminMessage time.status-time").count(),
          policy.showTimestamp === false ? 0 : 1,
        );
      }
      await refreshNotice();
      if (policy.autoDismiss !== false) {
        await adminPage.clock.fastForward(4000);
        await refreshNotice();
        await adminPage.clock.fastForward(1500);
        assert.equal(
          await adminPage.locator("#adminMessage").isVisible(),
          true,
          "replacement gets its own timer",
        );
        await adminPage.clock.fastForward(3500);
        assert.equal(await adminPage.locator("#adminMessage").isHidden(), true);
      } else {
        await adminPage.clock.fastForward(6000);
        assert.equal(
          await adminPage.locator("#adminMessage").isVisible(),
          true,
          "unchecked Admin option keeps notice visible",
        );
      }
      await adminPage.close();
    }
    for (const policy of [
      { preset: "all", types: [] },
      { preset: "errors", types: [] },
      { preset: "custom", types: ["info", "error"] },
      { preset: "custom", types: ["success"], showTimestamp: true },
      { preset: "all", types: [], autoDismiss: true, showTimestamp: true },
      { preset: "all", types: [], showTimestamp: false },
    ]) {
      const guestPage = await pageFor(policy),
        guestErrors = [];
      guestPage.on("pageerror", (e) => guestErrors.push(e.message));
      await guestPage.clock.install();
      await guestPage.goto(base + "/?ABCDEFGH");
      await guestPage.locator(".guest-food-group>button").first().click();
      await guestPage.waitForFunction(() => fixtures.food_claims.length === 2);
      await guestPage.locator("#confirmFood").click();
      await guestPage.locator("#foodReviewConfirm").click();
      await guestPage.waitForFunction(
        () =>
          window.__foodConfirmed === true &&
          !document.getElementById("foodReviewConfirm"),
      );
      const visible =
        policy.preset === "all" || policy.types.includes("success");
      assert.equal(
        await guestPage.locator("#guestStatus").isVisible(),
        visible,
      );
      assert.equal(
        await guestPage.locator("#guestStatus time.status-time").count(),
        visible && policy.showTimestamp === true ? 1 : 0,
      );
      if (visible) {
        const text = await guestPage.locator("#guestStatus").innerText();
        assert(text.endsWith("Thank you! Your food selection is confirmed."));
        if (policy.showTimestamp !== true)
          assert.equal(text, "Thank you! Your food selection is confirmed.");
        else
          assert(
            Number.isFinite(
              Date.parse(
                await guestPage
                  .locator("#guestStatus time")
                  .getAttribute("datetime"),
              ),
            ),
          );
      }
      assert.equal(
        await guestPage.locator("#foodReview time.status-time").count(),
        0,
        "Permanent confirmations are not timestamped",
      );
      assert.equal(
        await guestPage
          .locator("#foodReview")
          .getByText("Thank you! Your food selection is confirmed.", {
            exact: true,
          })
          .count(),
        1,
      );
      assert.equal(await guestPage.locator("#foodReview li").count(), 2);
      assert.equal(await guestPage.locator("#foodFollowup").isVisible(), true);
      assert.equal(await guestPage.locator("#foodCard>h2").isVisible(), true);
      if (policy.autoDismiss) {
        await guestPage.clock.fastForward(4000);
        assert.equal(await guestPage.locator("#guestStatus").isVisible(), true);
        await guestPage.evaluate(() => {
          window.RSVP.printRecipe = () => false;
        });
        await guestPage
          .locator("#foodReview")
          .getByRole("button", { name: "Recipe · Chips", exact: true })
          .click();
        const dialog = guestPage.getByRole("region", {
          name: "Recipe",
          exact: true,
        });
        await dialog
          .getByRole("button", { name: "Print", exact: true })
          .click();
        const replacement = await guestPage.locator("#guestStatus").innerText();
        assert.notEqual(
          replacement,
          "Thank you! Your food selection is confirmed.",
        );
        await guestPage.clock.fastForward(1500);
        assert.equal(
          await guestPage.locator("#guestStatus").innerText(),
          replacement,
          "old timer must not dismiss a replacement notice",
        );
        await guestPage.clock.fastForward(3500);
        assert.equal(await guestPage.locator("#guestStatus").isHidden(), true);
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        assert.equal(
          await guestPage
            .locator("#foodReview")
            .getByText("Thank you! Your food selection is confirmed.", {
              exact: true,
            })
            .isVisible(),
          true,
        );
      } else {
        await guestPage.clock.fastForward(6000);
        assert.equal(
          await guestPage.locator("#guestStatus").isVisible(),
          visible,
          "default guest notice stays until replaced",
        );
      }
      await guestPage.evaluate(() =>
        window.RSVP.showStatus("guestStatus", "Guest error", "error"),
      );
      assert.equal(
        await guestPage.locator("#guestStatus").isVisible(),
        policy.preset !== "custom" || policy.types.includes("error"),
      );
      await guestPage.evaluate(() =>
        window.RSVP.showStatus(
          document.querySelector("#foodFollowup"),
          "Inline form result",
          "error",
        ),
      );
      assert.equal(
        await guestPage.locator("#foodFollowup").innerText(),
        "Inline form result",
      );
      assert.deepEqual(guestErrors, []);
      await guestPage.close();
    }
    console.log(
      "PASS status settings UI: separate presets/custom types, explicit Save/Cancel, failed-save drafts, permissions; food notification restored and filtered, optional five-second guest expiry/replacement and persistent receipt/list/follow-up unaffected.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
