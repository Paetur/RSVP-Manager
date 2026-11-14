const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
// Food list/controller boundary with synthetic APIs; no live event is contacted.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("food-list-state");
const behavior = `
const venueA='88888888-1111-4111-8111-111111111111',venueB='88888888-2222-4222-8222-222222222222';
fixtures.event_locations=[{id:venueA,name:'Venue A',timezone:'Europe/Berlin',sort_order:1},{id:venueB,name:'Venue B',timezone:'Europe/Berlin',sort_order:2}];
fixtures.food_categories.push({id:'empty-category',name:'Empty',sort_order:3});
fixtures.food_items.push({id:'legacy-item',name_en:'Legacy dish',category:'Legacy',quantity_needed:2,active:true,quantity_type:'Piece(s)'});
window.__created=[];window.__registered=[];window.__deleted=[];
const listFrom=client.from;client.from=(table)=>{const query=listFrom(table);if(['food_items','food_categories'].includes(table))query.insert=async(record)=>{
 if(table==='food_items'){window.__created.push(record);if(window.__failCreate){window.__failCreate=false;return {error:{message:'Synthetic create failure'}};}fixtures.food_items.push({id:crypto.randomUUID(),...record});}
 else{window.__registered.push(record);fixtures.food_categories.push({id:crypto.randomUUID(),...record});}
 return {error:null};};return query;};
const listRpc=client.rpc;client.rpc=async(name,args)=>{if(name==='admin_delete_food_category'){window.__deleted.push(args);if(window.__failDelete){window.__failDelete=false;return {error:{message:'Synthetic category conflict'}};}fixtures.food_categories=fixtures.food_categories.filter(c=>c.id!==args.p_category_id);return {data:null};}return listRpc(name,args);};`;
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
        () =>
          document.querySelectorAll("#adminFoodList>.food-category").length ===
          4,
      );
      await page.locator("[data-tab=food]").click();

      async function addItem(category) {
        const trigger = category
          .locator(":scope>summary")
          .getByRole("button", {
            name: "Add item or sub-category",
            exact: true,
          });
        await trigger.scrollIntoViewIfNeeded();
        // Finish test-driven scrolling before opening a menu that closes on scroll.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await trigger.click();
        await page
          .getByRole("dialog", {
            name: "Add item or sub-category",
            exact: true,
          })
          .getByRole("button", { name: "Add item", exact: true })
          .click();
      }
      const snacks = page.locator(
        '[data-food-category-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]',
      );
      await addItem(snacks);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "newFoodName",
      );
      await page.locator("#newFoodName").fill("Draft dish");
      await page.locator("#newFoodQuantity").fill("2");
      await page
        .locator("#newFoodVenues")
        .getByLabel("Venue B", { exact: true })
        .uncheck();
      async function draftIntact() {
        assert.equal(
          await page.locator("#newFoodName").inputValue(),
          "Draft dish",
        );
        assert.equal(
          await page.locator("#newFoodCategory").inputValue(),
          "Snacks",
        );
        assert.equal(
          await page
            .locator("#newFoodVenues")
            .getByLabel("Venue A", { exact: true })
            .isChecked(),
          true,
        );
        assert.equal(
          await page
            .locator("#newFoodVenues")
            .getByLabel("Venue B", { exact: true })
            .isChecked(),
          false,
        );
        assert.equal(
          await page
            .locator("#addFoodForm")
            .evaluate(
              (n) =>
                n.closest("[data-food-category-id]")?.dataset.foodCategoryId,
            ),
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        );
      }
      await page.locator("#foodSearch").fill("Chips");
      await draftIntact();
      await page.locator("#foodShowArchived").check();
      await draftIntact();
      await page.locator("#foodSearch").fill("");
      await draftIntact();
      await page.evaluate(() => (window.__failCreate = true));
      await page.locator("#addFoodForm button[type=submit]").click();
      await page
        .locator("#adminMessage")
        .filter({ hasText: "Synthetic create failure" })
        .waitFor();
      await draftIntact();
      assert.deepEqual(
        await page.evaluate(() => window.__created[0].venue_ids),
        ["88888888-1111-4111-8111-111111111111"],
      );
      await page.locator("#addFoodForm button[type=submit]").click();
      await page.waitForFunction(
        () =>
          fixtures.food_items.some((i) => i.name_en === "Draft dish") &&
          !document.querySelector("#addFoodForm").hasAttribute("aria-busy"),
      );
      assert.equal(await page.locator("#newFoodName").inputValue(), "");
      assert.equal(
        await page.locator("#addFoodForm").evaluate((n) => n.parentElement.id),
        "foodCreateStaging",
      );
      await addItem(snacks);
      await page.locator("#newFoodName").fill("Cancel this");
      await page
        .locator("#newFoodVenues")
        .getByLabel("Venue B", { exact: true })
        .uncheck();
      await page.locator("#cancelFoodCreate").click();
      assert.equal(await page.locator("#newFoodName").inputValue(), "");
      assert.equal(
        await page
          .locator("#newFoodVenues")
          .getByLabel("Venue B", { exact: true })
          .isChecked(),
        true,
      );
      const legacy = page.locator("#adminFoodList>.food-category").filter({
        has: page
          .locator(".food-category-title")
          .filter({ hasText: /^Legacy$/ }),
      });
      await legacy
        .locator(":scope>summary")
        .getByRole("button", {
          name: "Register existing category",
          exact: true,
        })
        .click();
      await page.waitForFunction(
        () =>
          window.__registered.length === 1 &&
          fixtures.food_categories.some((c) => c.name === "Legacy"),
      );
      assert.deepEqual(await page.evaluate(() => window.__registered[0]), {
        name: "Legacy",
        sort_order: 3,
      });
      await snacks
        .locator(":scope>summary")
        .getByRole("button", { name: "Rename food category", exact: true })
        .click();
      await snacks.locator(".food-category-name-form button.danger").click();
      await page
        .locator("#adminMessage")
        .filter({ hasText: "Move items to another category" })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__deleted.length), 0);
      const empty = page.locator('[data-food-category-id="empty-category"]');
      await empty
        .locator(":scope>summary")
        .getByRole("button", { name: "Rename food category", exact: true })
        .click();
      const remove = empty.locator(".food-category-name-form button.danger");
      page.once("dialog", (d) => d.dismiss());
      await remove.click();
      assert.equal(await page.evaluate(() => window.__deleted.length), 0);
      await page.evaluate(() => (window.__failDelete = true));
      page.once("dialog", (d) => d.accept());
      await remove.click();
      await page
        .locator("#adminMessage")
        .filter({ hasText: "Synthetic category conflict" })
        .waitFor();
      assert.equal(await empty.count(), 1);
      page.once("dialog", (d) => d.accept());
      await remove.click();
      await page.waitForFunction(
        () => !fixtures.food_categories.some((c) => c.id === "empty-category"),
      );
      assert.deepEqual(await page.evaluate(() => window.__deleted[1]), {
        p_category_id: "empty-category",
        p_expected_name: "Empty",
      });
      assert.equal(await page.evaluate(() => fixtures.food_items.length), 6);
      await page.evaluate(() => {
        window.__accessPermissions.preset = "custom";
        window.__accessPermissions.sections.food = "view";
      });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      assert.equal(
        await page.locator("#adminFoodList .edit-only:visible").count(),
        0,
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
      "PASS Food list state: add focus, category/venue draft retention across search/archive renders, failed create/retry, Cancel reset, registration payload, guarded deletion/retry, retained items and refreshed view-only access.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
