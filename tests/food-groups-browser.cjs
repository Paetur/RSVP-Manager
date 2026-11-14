const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
// Food Groups editor lifecycle through synthetic APIs only.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("food-groups");
const behavior = `
window.__groupWrites=[];window.__ungroupAttempts=0;
const groupsRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='admin_save_food_group'){
  window.__groupWrites.push(args);
  if(window.__failGroupSave){window.__failGroupSave=false;return {error:{message:'Synthetic group save conflict'}};}
  const group=window.__groups.find(g=>g.id===args.p_id);
  Object.assign(group,{name:args.p_name,category:args.p_category,item_ids:args.p_item_ids,updated_at:'2026-11-12T12:00:00Z'});
  return {data:group.id};
 }
 if(name==='admin_delete_food_group'){
  window.__ungroupAttempts++;
  return {error:{message:'Synthetic ungroup conflict'}};
 }
 return groupsRpc(name,args);
};`;
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
          body: mock + "\n" + extra + "\n" + behavior,
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(
        () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
      );
      await page.locator("[data-tab=food]").click();

      const row = page.locator("#foodGroupsHost .food-group-admin").first();
      const details = row.locator("details"),
        form = details.locator("form");
      await details.locator("summary").click();
      assert.equal(
        await form.locator("input[type=checkbox]:checked").count(),
        2,
      );
      const name = form.getByLabel("Name", { exact: true });
      await name.fill("Renamed snacks");
      await page.evaluate(() => (window.__failGroupSave = true));
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await form
        .locator(".form-feedback")
        .filter({ hasText: "Synthetic group save conflict" })
        .waitFor();
      assert.equal(await name.inputValue(), "Renamed snacks");
      assert.equal(
        await page.evaluate(() => window.__groups[0].name),
        "Chips & nuts",
      );
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await details.locator("summary").click();
      assert.equal(await name.inputValue(), "Chips & nuts");
      await name.fill("Renamed snacks");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await row
        .locator(":scope>strong")
        .filter({ hasText: /^Renamed snacks$/ })
        .waitFor();
      assert.equal(
        await page.evaluate(() => window.__groupWrites[1].p_expected_updated),
        "2026-11-11T09:00:00Z",
      );
      await page.evaluate(() =>
        fixtures.food_claims.push({
          food_item_id: fixtures.food_items[0].id,
          household_id: h2,
          quantity: 1,
        }),
      );
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      await details.locator("summary").click();
      assert.equal(
        await form.getByLabel("Chips", { exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await form.getByLabel("Chips", { exact: true }).isChecked(),
        true,
      );
      const ungroup = row.getByRole("button", {
        name: "Ungroup items",
        exact: true,
      });
      page.once("dialog", (d) => d.dismiss());
      await ungroup.click();
      assert.equal(await page.evaluate(() => window.__ungroupAttempts), 0);
      page.once("dialog", (d) => d.accept());
      await ungroup.click();
      await page
        .locator("#adminMessage")
        .filter({ hasText: "Synthetic ungroup conflict" })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__groups.length), 1);
      assert.equal(
        await page.evaluate(
          () => fixtures.food_items.filter((i) => i.food_group_id).length,
        ),
        2,
      );
      assert.equal(await page.evaluate(() => fixtures.food_claims.length), 1);
      await page.evaluate(() => {
        window.__accessPermissions.preset = "custom";
        window.__accessPermissions.sections.food = "view";
      });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      assert.equal(await row.locator("details").count(), 0);
      assert.equal(
        await row
          .getByRole("button", { name: "Ungroup items", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await row.locator(":scope>strong").innerText(),
        "Renamed snacks",
      );
      assert.equal(
        await page.evaluate(() => fixtures.event_settings[0].is_published),
        false,
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
    console.log(
      "PASS Food Groups: failed-save drafts, Cancel/reset, revision forwarding, refreshed claimed-item locks, ungroup cancellation/server denial, retained commitments and refreshed view-only access.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
