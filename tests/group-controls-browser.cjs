const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("group-controls");
const groupingMock = `
for(const row of fixtures.relation_groups)row.planning_group_id=null;
const oldGroupRpc=client.rpc;client.rpc=async(name,a)=>{
 if(name==='admin_manage_relation_group'){
  (window.__groupActions??=[]).push(a);let row=fixtures.relation_groups.find(g=>g.id===a.p_id);
  if(a.p_action==='save'){if(row)row.name=a.p_name;else{row={id:crypto.randomUUID(),name:a.p_name,planning_group_id:a.p_planning_group_id,sort_order:3};fixtures.relation_groups.push(row);}}
  if(a.p_action==='delete')fixtures.relation_groups=fixtures.relation_groups.filter(g=>g.id!==a.p_id);
  return {data:row||null};
 }
 if(name==='admin_save_planning_configuration'){fixtures.event_settings[0].planning_config=a.p_config;return {data:null};}
 return oldGroupRpc(name,a);
};`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
await require("./helpers/admin-toolbar.cjs").autoConfirmInline(page);

      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + groupingMock,
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(
        () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
      );
      assert.deepEqual(
        await page.locator("#statsGrid .stat-card").first().locator("dt").evaluateAll(
          labels => labels.map(label => [label.textContent, label.nextElementSibling.textContent]),
        ),
        [["Top-level groups", "2"], ["Relational groups", "2"], ["Adults", "1"], ["Children", "1"]],
      );
      await page.locator("[data-tab=households]").click();
      assert.equal(await page.locator("#newHousehold").count(), 0);
      assert.equal(
        await page
          .locator("#showArchived")
          .evaluate((n) => n.closest(".household-toolbar") !== null),
        true,
      );

      const top = page.locator("#householdRows>.hierarchy-section").first();
      await top
        .locator(":scope>summary")
        .getByRole("button", { name: "Add relational group", exact: true })
        .click();
      assert.equal(
        await top
          .locator(".hierarchy-inline-editor .editor-lifecycle-actions")
          .count(),
        0,
        "new relational group must not expose top-level deletion",
      );
      await top.locator(".hierarchy-inline-editor input").fill("New helpers");
      await top
        .locator(".hierarchy-inline-editor")
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await page.waitForFunction(() =>
        fixtures.relation_groups.some((g) => g.name === "New helpers"),
      );
      assert.equal(
        await page
          .locator("#householdRows>.hierarchy-section")
          .nth(1)
          .getByText("New helpers", { exact: true })
          .count(),
        0,
      );
      const createdId = await page.evaluate(
        () => fixtures.relation_groups.find((g) => g.name === "New helpers").id,
      );
      const group = top.locator('[data-relation-group-id="' + createdId + '"]');
      await group
        .locator(":scope>summary")
        .getByRole("button", { name: "Add household", exact: true })
        .click();
      const form = group.locator(".hierarchy-create-household");
      await form.waitFor();
      assert.equal(
        await form
          .getByRole("combobox", { name: "Top-level group", exact: true })
          .inputValue(),
        "group_a",
      );
      assert.ok(
        await form
          .getByRole("combobox", { name: "Relation group", exact: true })
          .inputValue(),
      );
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await form.count(), 0);
      await group
        .locator(":scope>summary")
        .getByRole("button", { name: "Edit group", exact: true })
        .click();
      await group
        .locator(".hierarchy-inline-editor")
        .getByRole("button", { name: "Delete group", exact: true })
        .click();
      await page.waitForFunction(
        () => !fixtures.relation_groups.some((g) => g.name === "New helpers"),
      );
      await top
        .locator(":scope>summary")
        .getByRole("button", { name: "Edit group", exact: true })
        .click();
      await top
        .locator(":scope>.tree-children>.hierarchy-inline-editor")
        .getByRole("button", { name: "Delete group", exact: true })
        .click();
      assert.match(
        await page.locator("#adminMessage").innerText(),
        /Move households/,
      );
      assert.equal(
        await page.locator("#householdRows>.hierarchy-section").count(),
        2,
      );
      assert.equal(await top.locator(":scope>summary .danger").count(), 0);
      assert.equal(
        await top
          .locator(
            ":scope>.tree-children>.hierarchy-inline-editor .editor-lifecycle-actions",
          )
          .count(),
        1,
      );
      await page.locator("#expandHouseholds").click();
      const guestEntry = page.locator(".household-guest-entry").first();
      await guestEntry
        .locator(".household-guest-row")
        .getByRole("button", { name: /^Edit guest/ })
        .click();
      const guestEditor = guestEntry.locator(".guest-edit-form");
      await guestEditor.waitFor({ state: "visible" });
      assert.equal(
        await guestEntry
          .locator(".household-guest-row")
          .getByRole("button", { name: /Archive guest|Delete guest/ })
          .count(),
        0,
      );
      assert.equal(
        await guestEditor
          .locator(".editor-lifecycle-actions")
          .getByRole("button", { name: /Archive guest/ })
          .count(),
        1,
      );
      assert.equal(
        await guestEditor.evaluate((f) => {
          const row = f.querySelector(".guest-edit-actions"),
            save = row.querySelector("[type=submit]").getBoundingClientRect(),
            cancel = row
              .querySelector("[data-discard]")
              .getBoundingClientRect(),
            end = row
              .querySelector(".editor-lifecycle-actions")
              .getBoundingClientRect();
          return save.left < cancel.left && end.right >= cancel.right;
        }),
        true,
      );
      await page.evaluate(() => {
        window.__archivedGuestId = fixtures.guests[0].id;
        fixtures.guests[0].archived_at = "2026-11-12T10:00:00Z";
      });
      await page.locator("#showArchived").check();
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      await page.locator("#expandHouseholds").click();
      const archivedId = await page.evaluate(() => window.__archivedGuestId);
      const archived = page.locator('[data-guest-id="' + archivedId + '"]');
      await archived
        .locator(".household-guest-row")
        .getByRole("button", { name: /^Edit guest/ })
        .click();
      const archivedEditor = archived.locator(".guest-edit-form");
      assert.equal(
        await archivedEditor
          .getByRole("button", { name: "Restore guest", exact: true })
          .isEnabled(),
        true,
      );
      assert.equal(
        await archivedEditor.locator("button[type=submit]").isDisabled(),
        true,
      );
      assert.equal(
        await archivedEditor.locator("input").first().isDisabled(),
        true,
      );
      await page.locator("[data-tab=food]").click();
      assert.equal(
        await page
          .locator("#foodShowArchived")
          .evaluate((n) => n.closest(".household-toolbar") !== null),
        true,
      );
      await page.locator("[data-tab=other]").click();
      assert.equal(
        await page
          .locator("#otherShowArchived")
          .evaluate((n) => n.closest(".household-toolbar") !== null),
        true,
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
      "PASS group UI: overview counts; contextual relational-group creation; scoped household form; guarded deletion; toolbar archive controls; mobile fit.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
