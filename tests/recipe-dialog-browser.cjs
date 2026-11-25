const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("recipe-dialog");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body:
            mock +
            "\n" +
            extra +
            "\n" +
            stageExtra +
            "\nfixtures.food_items[0].recipe_text='Mix flour and water.';",
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      await page.evaluate(() => {
        window.__prints = [];
        window.RSVP.printRecipe = (name, text) => {
          window.__prints.push({ name, text });
          return true;
        };
      });
      await page.locator("[data-tab=food]").click();
      const item = page.locator(".food-compact-item").first(),
        trigger = item
          .locator(".food-item-links button")
          .filter({ hasText: "Recipe" });
      await trigger.click();
      let dialog = page.getByRole("dialog", { name: "Recipe", exact: true });
      assert.equal(await dialog.evaluate((node) => node.matches(":modal")), true);
      assert.equal(await dialog.locator("input,textarea").count(), 0);
      assert.equal(await dialog.getByRole("button").count(), 3);
      assert.equal(
        await dialog.getByRole("button", { name: /^Edit/ }).count(),
        1,
      );
      await dialog.getByRole("button", { name: "Print", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.__prints), [
        { name: "Chips", text: "Mix flour and water." },
      ]);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        await trigger.evaluate((n) => document.activeElement === n),
        true,
      );

      await trigger.click();
      dialog = page.getByRole("dialog", { name: "Recipe", exact: true });
      await dialog.getByRole("button", { name: /^Edit/ }).click();
      dialog = page.getByRole("dialog", { name: "Recipe", exact: true });
      assert.equal(await dialog.evaluate((node) => node.matches(":modal")), true);
      assert.equal(await dialog.locator("textarea").count(), 1);
      assert.equal(
        await dialog
          .getByRole("button", { name: "Preview", exact: true })
          .count(),
        1,
      );
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.evaluate(() => {
        window.__accessPermissions.preset = "custom";
        window.__accessPermissions.sections.food = "view";
      });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      await trigger.click();
      dialog = page.getByRole("dialog", { name: "Recipe", exact: true });
      assert.equal(await dialog.locator("textarea").count(), 0);
      assert.equal(
        await dialog
          .getByRole("button", { name: "Print", exact: true })
          .count(),
        1,
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
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
      "PASS shared recipe dialog: admin View/read-only permissions use Print/Close, print content, focus return, unchanged Edit controls and phone/desktop bounds.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
