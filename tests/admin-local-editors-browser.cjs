const { refreshFixture, selectInterfaceSettingsTab } = require("./helpers/admin-toolbar.cjs");
const fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { server, mock, extra, stageExtra, out } =
  createFoodHarness("local-editors");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const seed = `fixtures.event_languages.forEach(l=>l.display_name={en:"English",fo:"Føroyskt",de:"Deutsch"}[l.language_code]);fixtures.event_settings[0].is_published=false;fixtures.event_settings[0].planning_config={groups:[{id:'bound',names:{en:'Existing family'}}],labels:{households:{},guests:{}}};fixtures.households[0].planning_group_id='bound';const localRpc=client.rpc;client.rpc=async(n,a)=>{if(n==='admin_save_features'&&window.__failFeatures){window.__failFeatures=false;return {error:{message:'Synthetic feature conflict'}};}return localRpc(n,a);};`;
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + stageExtra + "\n" + seed,
      }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
    );
    assert.equal(await page.locator("#editModeButton").count(), 0);
    assert.equal(
      await page.locator("#adminApp").getAttribute("data-mode"),
      null,
    );
    await page.locator("[data-tab=events]").click();
    assert.equal(
      await page.locator("#eventFeaturesHost form").isVisible(),
      false,
    );
    assert.equal(
      await page.locator("#planningConfigHost form").isVisible(),
      false,
    );
    const features = await openBox(page, "event-features");
    await features
      .getByRole("checkbox", { name: "Other", exact: true })
      .uncheck();
    const planning = await openBox(page, "event-planning");
    assert(
      await planning
        .getByRole("button", { name: "Remove group", exact: true })
        .isDisabled(),
    );
    await page.evaluate(() => (window.__failFeatures = true));
    await features.getByRole("button", { name: "Save", exact: true }).click();
    await features.locator(".form-feedback[data-state=error]").waitFor();
    assert.equal(
      await features
        .getByRole("checkbox", { name: "Other", exact: true })
        .isChecked(),
      false,
    );
    assert(await planning.isVisible());
    await features.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await features.isVisible(), false);
    assert(await planning.isVisible());
    await planning.getByRole("button", { name: "Cancel", exact: true }).click();
    await openBox(page, "event-features");
    await features
      .getByRole("checkbox", { name: "Other", exact: true })
      .uncheck();
    await features.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => window.__stageWrites === 1);
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[data-editor-key="event-features"]')
          .classList.contains("local-editor-open"),
    );
    assert.equal(
      await page.evaluate(() => fixtures.event_settings[0].is_published),
      false,
    );
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=interface]").click();
    fs.mkdirSync(out, { recursive: true });
    await page
      .locator("[data-settings-panel=interface]")
      .screenshot({ path: path.join(out, "interface-read-phone.png") });
    for (const key of [
      "personal-preferences",
      "guest-customization:wide",
      "notification-preferences:wide",
    ]) {
      await page.locator(key === "personal-preferences" ? "[data-settings-tab=checklist]" : "[data-settings-tab=interface]").click();
      const form = await openBox(page, key);
      assert(await form.isVisible());
      if (key === "personal-preferences")
        await page
          .locator("[data-settings-panel=checklist]")
          .screenshot({ path: path.join(out, "interface-edit-phone.png") });
      const cancel = form.getByRole("button", { name: "Cancel", exact: true });
      await cancel.click();
      await page.waitForFunction(
        (k) =>
          !document
            .querySelector('[data-editor-key="' + k + '"]')
            .classList.contains("local-editor-open"),
        key,
      );
    }
    await page.locator("[data-settings-tab=templates]").click();
    await page.locator("details.template-create > summary").click();
    await page.locator('[data-form-key="invitation-template:new"]').waitFor();
    assert(
      await page
        .locator("#invitationTemplatesList [data-form-key=\"invitation-template:new\"]")
        .isVisible(),
    );
    await page
      .locator("#invitationTemplatesList [data-form-key=\"invitation-template:new\"]")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page.evaluate(() => {
      for (const k in window.__accessPermissions.sections)
        window.__accessPermissions.sections[k] = "view";
    });
    await refreshFixture(page);
    await page.waitForFunction(
      () => !document.getElementById("refreshButton").disabled,
    );
    assert.equal(
      await page
        .locator("#invitationTemplatesList [data-local-edit]:visible")
        .count(),
      0,
    );
    await page.locator("[data-settings-tab=checklist]").click();
    assert(
      await page
        .locator('[data-local-edit="personal-preferences"]')
        .isVisible(),
    );
    await selectInterfaceSettingsTab(page, "invites");
    const invites = await openBox(page, "invites-appearance");
    assert.equal(await invites.locator("#inviteShowText").isEnabled(), true);
    await invites.locator("#cancelInvitesAppearance").click();
    await page.locator("[data-settings-tab=interface]").click();
    assert.equal(
      await page
        .locator('[data-local-edit^="guest-customization:"]:visible')
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator('[data-local-edit^="notification-preferences:"]:visible')
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS local editing: global switch absent; independent boxes, local Save/Cancel, failed drafts retained, successful Save closes only its box, bound guards, unpublished state, templates/Interface panels and view-only permissions.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
