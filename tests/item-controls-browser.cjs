// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("item-controls");
const lifecycleFixture = `\nfixtures.other_categories=[{id:'77777777-7777-4777-8777-777777777777',name:'Preparations',sort_order:1,updated_at:'2026-11-12T10:00:00Z'}];fixtures.other_items=[{id:'88888888-1111-4111-8111-111111111111',category_id:fixtures.other_categories[0].id,item:'Unused task',status:'open',assigned_to:'',notes:'',updated_at:'2026-11-12T10:00:00Z'},{id:'88888888-2222-4222-8222-222222222222',category_id:fixtures.other_categories[0].id,item:'Assigned task',status:'assigned',assigned_to:'Example helper',notes:'Keep this',updated_at:'2026-11-12T10:00:00Z'}];for(const f of fixtures.food_items)f.updated_at='2026-11-12T10:00:00Z';const lifecycleRpc=client.rpc;client.rpc=async(n,a)=>{if(n==='admin_item_lifecycle'){(window.__lifecycleCalls??=[]).push(a);const rows=fixtures[a.p_entity],i=rows.findIndex(x=>x.id===a.p_id),item=rows[i];const bound=a.p_entity==='food_items'?!!item.food_group_id||fixtures.food_claims.some(c=>c.food_item_id===item.id):!!item.assigned_to||item.status!=='open';if(a.p_action==='inspect')return {data:{bound,archived:!!item.archived_at,updated_at:item.updated_at}};if(a.p_action==='delete')rows.splice(i,1);else{item.archived_at=a.p_action==='archive'?'2026-11-12T11:00:00Z':null;item.updated_at='2026-11-12T11:00:00Z';}return {data:{deleted:a.p_action==='delete'}};}if(n==='admin_delete_food_category'){window.__categoryDeletes=(window.__categoryDeletes||0)+1;fixtures.food_categories=fixtures.food_categories.filter(c=>c.id!==a.p_category_id);return {data:null};}return lifecycleRpc(n,a);};`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      page.setDefaultTimeout(7000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "Map fixture" }),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + lifecycleFixture,
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(
        () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
      );

      await page.locator("[data-tab=food]").click();
      const category = page.locator("[data-food-category-id]").first();
      await category
        .getByRole("button", { name: "Rename food category", exact: true })
        .click();
      const control = category.locator(".category-name-control");
      assert.equal(await control.locator("input").count(), 1);
      assert.ok(
        await control
          .getByRole("button", { name: "Language", exact: true })
          .evaluate((n) => n.getBoundingClientRect().height === 44),
      );
      await category
        .locator(".food-category-name-form")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await category
        .getByRole("button", { name: "Rename food category", exact: true })
        .click();
      await category
        .locator(".food-category-name-form")
        .getByRole("button", { name: "Delete category", exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.__categoryDeletes || 0), 0);
      const coffee = page
        .locator(".food-compact-item")
        .filter({ hasText: "Coffee" });
      await coffee.evaluate((n) => (n.closest(".food-category").open = true));
      await coffee
        .getByRole("button", { name: "Edit food item", exact: true })
        .click();
      await coffee
        .locator(".item-lifecycle-actions")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await page.waitForFunction(
        () => !window.__fixtures.food_items.some((i) => i.name_en === "Coffee"),
      );
      const chips = page
        .locator(".food-compact-item")
        .filter({ hasText: "Chips" });
      await chips
        .getByRole("button", { name: "Edit food item", exact: true })
        .click();
      await chips
        .locator(".item-lifecycle-actions")
        .getByRole("button", { name: "Archive", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          !!window.__fixtures.food_items.find((i) => i.name_en === "Chips")
            .archived_at,
      );
      assert.equal(await chips.count(), 0);
      await page.locator("#foodShowArchived").check();
      await chips.waitFor();
      assert.match(await chips.innerText(), /Archived/);
      await chips
        .getByRole("button", { name: "Edit food item", exact: true })
        .click();
      await chips
        .locator(".item-lifecycle-actions")
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          !window.__fixtures.food_items.find((i) => i.name_en === "Chips")
            .archived_at,
      );
      await page.locator("[data-tab=other]").click();
      const free = page
        .locator(".other-line")
        .filter({ hasText: "Unused task" });
      await free.getByRole("button", { name: /^Edit item/ }).click();
      await free
        .locator(".item-lifecycle-actions")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          !window.__fixtures.other_items.some((i) => i.item === "Unused task"),
      );
      assert.equal(await free.count(), 0);
      const assigned = page
        .locator(".other-line")
        .filter({ hasText: "Assigned task" });
      await assigned.getByRole("button", { name: /^Edit item/ }).click();
      await assigned
        .locator(".item-lifecycle-actions")
        .getByRole("button", { name: "Archive", exact: true })
        .click();
      await page.waitForFunction(
        () => !!window.__fixtures.other_items[0].archived_at,
      );
      assert.equal(await assigned.count(), 0);
      await page.locator("#otherShowArchived").check();
      await assigned.waitFor();
      assert.match(await assigned.innerText(), /Example helper/);
      await assigned.getByRole("button", { name: /^Edit item/ }).click();
      await assigned
        .locator(".item-lifecycle-actions")
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await page.waitForFunction(
        () => !window.__fixtures.other_items[0].archived_at,
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
      "PASS lifecycle UI: aligned category globe; guarded category action; unused Food/Other deletion; linked archive; show archived; restore; draft-model refresh; phone/tablet bounds.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
