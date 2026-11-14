const { openBox } = require("./helpers/local-edit-ui.cjs");
// Real planning controls and shared save lifecycle; synthetic APIs only.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("admin-planning");
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const seed = `
fixtures.event_languages.forEach(l=>l.display_name={en:'English',de:'Deutsch',fo:'Føroyskt'}[l.language_code]||l.language_code);
fixtures.event_settings[0].is_published=false;
fixtures.event_settings[0].event_type='wedding';
fixtures.event_settings[0].planning_config={groups:[{id:'bound',names:{en:'Existing family'}},{id:'free',names:{en:'Helpers'}}],labels:{households:{},guests:{}}};
fixtures.households[0].planning_group_id='bound';
window.__planningCalls=[];
const priorPlanningRpc=client.rpc;client.rpc=async(name,args)=>{if(name==='admin_save_planning_configuration'){
window.__planningCalls.push(structuredClone(args));
if(window.__planningFail){window.__planningFail=false;return {error:{message:'Synthetic planning conflict'}};}
fixtures.event_settings[0].planning_config=structuredClone(args.p_config);fixtures.event_settings[0].event_type=args.p_preset;return {data:null,error:null};}
return priorPlanningRpc(name,args);};`;
    await page.route("**/supabase.min.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + seed,
      }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
    );
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=event]").click();

    await openBox(page, "event-planning");
    const host = page.locator("#planningConfigHost"),
      form = host.locator("form"),
      groups = host.locator(".planning-groups > fieldset");
    const save = form.getByRole("button", {
      name: "Save",
      exact: true,
      includeHidden: true,
    });
    assert.equal(await save.isDisabled(), true);
    assert.equal(
      await groups
        .first()
        .getByRole("button", { name: "Remove group", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await groups
        .nth(1)
        .getByRole("button", { name: "Remove group", exact: true })
        .isDisabled(),
      false,
    );
    const before = await page.evaluate(() =>
      structuredClone(fixtures.event_settings[0].planning_config),
    );
    // Preserve a representative real DOM for the before/after cascade comparison.
    if (process.env.PLANNING_CSS_FIXTURE)
      fs.writeFileSync(
        process.env.PLANNING_CSS_FIXTURE,
        await page.evaluate(
          () =>
            '<main id="adminApp" data-mode="edit"><section class="panel">' +
            document.querySelector("#planningConfigHost").outerHTML +
            document.querySelector("#eventFeaturesHost").outerHTML +
            "</section></main>",
        ),
      );
    await groups
      .first()
      .getByLabel("English", { exact: true })
      .fill("Discarded label");
    await form
      .getByLabel("Event preset", { exact: true })
      .selectOption("conference");
    assert.deepEqual(
      await page.evaluate(() => fixtures.event_settings[0].planning_config),
      before,
      "editing only changes a cloned draft",
    );
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await groups.first().getByLabel("English", { exact: true }).inputValue(),
      "Existing family",
    );
    assert.equal(
      await form.getByLabel("Event preset", { exact: true }).inputValue(),
      "wedding",
    );
    assert.equal(await save.isDisabled(), true);
    await openBox(page, "event-planning");
    await form.getByRole("button", { name: "Add group", exact: true }).click();
    assert.equal(await groups.count(), 3);
    assert.equal(
      await groups
        .last()
        .getByLabel("English", { exact: true })
        .evaluate((n) => document.activeElement === n),
      true,
    );
    await groups
      .last()
      .getByLabel("English", { exact: true })
      .fill("New helpers");
    await groups
      .last()
      .getByRole("button", { name: "Move group up", exact: true })
      .click();
    assert.equal(
      await groups.nth(1).getByLabel("English", { exact: true }).inputValue(),
      "New helpers",
    );
    await groups
      .nth(1)
      .getByRole("button", { name: "Remove group", exact: true })
      .click();
    assert.equal(await groups.count(), 2);
    assert.equal(await page.evaluate(() => window.__planningCalls.length), 0);
    await groups
      .first()
      .getByLabel("English", { exact: true })
      .fill("Retained family");
    await form
      .getByLabel("Event preset", { exact: true })
      .selectOption("conference");
    await form
      .getByRole("button", { name: "Use preset suggestions", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#planningConfigHost .planning-groups > fieldset",
        ).length === 4,
    );
    assert.equal(
      await groups.nth(2).getByLabel("English", { exact: true }).inputValue(),
      "Attendees",
    );
    await page.evaluate(() => (window.__planningFail = true));
    await save.click();
    await form.locator(".form-feedback[data-state=error]").waitFor();
    assert.equal(
      await groups.first().getByLabel("English", { exact: true }).inputValue(),
      "Retained family",
    );
    assert.equal(
      await form.getByLabel("Event preset", { exact: true }).inputValue(),
      "conference",
    );
    assert.deepEqual(
      await page.evaluate(() => fixtures.event_settings[0].planning_config),
      before,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__planningCalls[0].p_expected_config),
      before,
    );
    assert.equal(await save.isEnabled(), true);
    await save.click();
    await page.waitForFunction(
      () =>
        fixtures.event_settings[0].event_type === "conference" &&
        document.querySelector("#planningConfigHost button[type=submit]")
          .disabled,
    );
    assert.equal(
      await groups.first().getByLabel("English", { exact: true }).inputValue(),
      "Retained family",
    );
    await openBox(page, "event-planning");
    assert.equal(await groups.count(), 4);
    const calls = await page.evaluate(() => window.__planningCalls);
    assert.deepEqual(
      calls[1],
      calls[0],
      "retry forwards the same reviewed draft and expected baseline",
    );
    assert.equal(calls[1].p_expected_preset, "wedding");
    assert.equal(calls[1].p_config.labels.households.en, "Bookings");
    assert.equal(
      await page.evaluate(() => fixtures.event_settings[0].is_published),
      false,
    );
    // Read-only membership keeps the summary and removes all edit controls.
    await page.evaluate(() => {
      window.__accessPermissions.sections.settings = "view";
    });
    await page.locator("#refreshButton").click();
    await page.waitForFunction(
      () => !document.querySelector("#refreshButton").disabled,
    );
    assert.equal(await form.count(), 0);
    assert.match(await host.innerText(), /Retained family/);
    assert.deepEqual(errors, []);
    console.log(
      "PASS Event planning: cloned draft, bound-group guard, clean Save, Cancel, add/move/remove and focus, preset suggestions, failed-save retention, expected baseline/retry, refreshed labels and view-only summary; event stays unpublished.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
