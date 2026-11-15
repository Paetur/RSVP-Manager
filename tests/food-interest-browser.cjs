const {openBox}=require('./helpers/local-edit-ui.cjs');
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("food-interest");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch();
    const base = "http://127.0.0.1:" + server.address().port;
    for (const width of [390, 1024]) {
      const page = await browser.newPage({
          viewport: { width, height: 1050 },
          hasTouch: true,
        }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "de"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra,
        }),
      );
      await page.goto(base + "/?ABCDEFGH");
      await page.locator("#foodCard:not(.hidden)").waitFor();
      assert.equal(await page.locator("#foodList").isHidden(), true);
      assert.equal(await page.locator("#confirmFood").isHidden(), true);
      assert.equal(await page.locator("#foodInterestHost form").count(), 0);
      const choices = page.locator(".food-interest-choices");
      assert.equal(await choices.getByRole("button").count(), 2);
      await page.evaluate(() => (window.__failInterest = true));
      await choices
        .getByRole("button", {
          name: "Ich kann kein Essen mitbringen",
          exact: true,
        })
        .click();
      await page.locator("#guestStatus.error").waitFor();
      assert.equal(await page.evaluate(() => window.__foodAnswer), null);
      await choices
        .getByRole("button", {
          name: "Ich kann kein Essen mitbringen",
          exact: true,
        })
        .click();
      await page.waitForFunction(() => window.__interestWrites === 1);
      assert.equal(await page.evaluate(() => window.__foodAnswer), false);
      await page.locator("#languageSwitcher [data-language=en]").click();
      assert.equal(
        await choices
          .getByRole("button", { name: "I can’t bring food", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await choices
        .getByRole("button", { name: "I can bring food", exact: true })
        .click();
      await page.waitForFunction(() => window.__interestWrites === 2);
      assert.equal(
        await page.locator("#foodList").isHidden(),
        true,
        "interest mode never opens the list",
      );
      assert.equal(
        await page.locator("#foodInterestHost button[type=submit]").count(),
        0,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    const page = await browser.newPage({
        viewport: { width: 1024, height: 1100 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem("rsvp-interface-language", "en"),
    );
    await page.route("**maps.google.com/**", (r) =>
      r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
    );
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + stageExtra,
      }),
    );
    await page.goto(base + "/admin/");
    await page.waitForFunction(
      () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
    );
    await page.locator("[data-tab=food]").click();
    for (const id of ["foodGroupsSection", "foodCategoriesSection"])
      assert.equal(await page.locator("#" + id).evaluate((n) => n.open), true);
    assert.equal(
      await page
        .locator("#foodAddGroupHost")
        .evaluate((n) => !!n.closest("#foodGroupsSection")),
      true,
    );
    assert.equal(
      await page
        .locator("#foodAddCategory")
        .evaluate((n) => !!n.closest("#foodCategoriesSection")),
      true,
    );

    const category = page.locator("[data-food-category-id]").first();
    await category
      .locator(":scope>summary")
      .getByRole("button", { name: "Rename food category", exact: true })
      .click();
    const categoryGlobe = category
      .locator(".food-category-name-form")
      .getByRole("button", { name: "Language", exact: true });
    assert.equal(await categoryGlobe.innerText(), "");
    await category
      .locator(".food-category-name-form")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    const item = category.locator(".food-compact-item").first();
    await item
      .getByRole("button", { name: "Edit food item", exact: true })
      .click();
    const form = item.locator(".food-edit-form");
    assert.equal(
      await form
        .locator(".food-name-control")
        .getByRole("button", { name: "Language", exact: true })
        .innerText(),
      "",
    );
    assert.equal(
      await form.locator(".food-name-control").evaluate((n) => {
        const a = n.querySelector("input").getBoundingClientRect(),
          b = n.querySelector("button").getBoundingClientRect();
        return b.left >= a.right - 1;
      }),
      true,
    );
    assert.equal(
      await form.locator(".food-unit-control").evaluate((n) => {
        const a = n.querySelector("select").getBoundingClientRect(),
          b = n.querySelector("button").getBoundingClientRect();
        return b.left >= a.right - 1;
      }),
      true,
    );
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator("#settingsToggle").click();
    await openBox(page,'event-features');
    const stage = page.locator("#eventFeaturesHost form");
    assert.equal(await stage.locator(".feature-stage-card").count(), 2);
    await stage.locator("input[value=selection]").check();
    await stage.locator("button[type=submit]").click();
    await page.locator(".inline-confirmation").getByRole("button",{name:"Cancel",exact:true}).click();
    assert.equal(await page.evaluate(() => window.__stageWrites || 0), 0);
    await stage.locator("button[type=submit]").click();
    await page.locator(".inline-confirmation").getByRole("button",{name:"Save",exact:true}).click();
    await page.waitForFunction(() => window.__stageWrites === 1);
    assert.equal(
      await page.evaluate(
        () => window.__fixtures.event_settings[0].is_published,
      ),
      false,
    );
    assert.equal(
      await stage.locator("input[name=food_stage]:checked").inputValue(),
      "selection",
    );
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await page.screenshot({
      path: path.join(out, "admin-food-sections.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await openBox(page,'event-features');
    await stage.getByRole("checkbox", { name: "Food", exact: true }).uncheck();
    assert.equal(
      await stage.locator("input[value=interest]").isDisabled(),
      true,
    );
    await stage.locator("button[type=submit]").click();
    await page.waitForFunction(
      () =>
        window.__stageWrites === 2 &&
        document
          .querySelector("[data-tab=food]")
          .classList.contains("permission-hidden"),
    );
    assert.equal(
      await page
        .locator("[data-tab=food]")
        .evaluate((n) => n.classList.contains("permission-hidden")),
      true,
    );
    await openBox(page,'event-features');
    await stage.getByRole("checkbox", { name: "Food", exact: true }).check();
    await stage.locator("button[type=submit]").click();
    await page.waitForFunction(
      () =>
        window.__stageWrites === 3 &&
        !document
          .querySelector("[data-tab=food]")
          .classList.contains("permission-hidden"),
    );
    assert.equal(
      await page
        .locator("[data-tab=food]")
        .evaluate((n) => n.classList.contains("permission-hidden")),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS food interest UI: click-to-save yes/no, failure/retry, translated saved answers, no detailed list, separate panels/add windows, icon alignment and explicit non-publication stage switch",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
