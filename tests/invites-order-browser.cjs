const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("invites-order");
const behavior = `fixtures.event_settings[0].planning_config.groups.reverse();
fixtures.relation_groups=[{id:cat1,name:'Family',sort_order:2},{id:cat2,name:'Zulu first',sort_order:1}];
fixtures.households[0].sort_order=10;fixtures.households[1].sort_order=0;
fixtures.households[2].relation_group_id=cat1;
const newHousehold=(id,name,relation,parent,order)=>({id,household_name:name,planning_group_id:'group_b',relation_group_id:relation,parent_id:parent,sort_order:order,language:'en',rsvp_state:'open'});
fixtures.households.push(newHousehold('root-a','Early root',cat1,null,5),newHousehold('child-a','Child of early root',cat1,'root-a',1),newHousehold('root-z','Zulu root',cat2,null,99),newHousehold('ungrouped','Ungrouped root',null,null,100),newHousehold('archived','Archived root',cat1,null,-1));fixtures.households.at(-1).archived_at='2026-01-01';
for(const h of fixtures.households.filter(h=>h.id!==h1&&!fixtures.guests.some(g=>g.household_id===h.id)))fixtures.guests.push({id:'guest-'+h.id,household_id:h.id,first_name:'Guest',last_name:h.household_name});`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
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
      async function compare() {
        await page.locator("[data-tab=households]").click();
        const household = await page
          .locator("#householdRows > .hierarchy-section")
          .evaluateAll((tops) =>
            tops.flatMap((top) =>
              [...top.querySelectorAll(".hierarchy-group")].map((group) => ({
                top: top.dataset.treeKey.replace("planning-group:", ""),
                relation: group.dataset.relationGroupId,
                ids: [...group.querySelectorAll(".household-tree-node")].map(
                  (h) => h.dataset.treeKey.replace("household:", ""),
                ),
              })),
            ),
          );
        await page.locator("[data-tab=invites]").click();
        const invite = await page
          .locator("#inviteRows .invite-overview-group")
          .evaluateAll((groups) =>
            groups.map((g) => ({
              top: g.dataset.planningGroupId,
              relation: g.dataset.relationGroupId,
              ids: [...g.querySelectorAll("[data-invite-household]")].map(
                (h) => h.dataset.inviteHousehold,
              ),
            })),
          );
        const visible = new Set(invite.flatMap((g) => g.ids));
        const expected = household
          .map((g) => ({ ...g, ids: g.ids.filter((id) => visible.has(id)) }))
          .filter((g) => g.ids.length);
        assert.deepEqual(
          invite,
          expected,
          "group order and parent/child traversal match the actual Households view",
        );
        assert.equal(
          new Set(invite.flatMap((g) => g.ids)).size,
          invite.flatMap((g) => g.ids).length,
          "no duplicate households",
        );
        return invite;
      }
      const first = await compare();
      assert.deepEqual(first[0].ids, ["ungrouped"]);
      assert.deepEqual(first[1].ids, ["root-z"]);
      assert.deepEqual(
        first[2].ids,
        ["root-a", "child-a", "22222222-2222-4222-8222-222222222222"],
        "empty grouping parents still determine descendant placement",
      );
      await page.evaluate(() => {
        fixtures.relation_groups[0].sort_order = -1;
        fixtures.households.find((h) => h.id === "root-a").sort_order = 20;
      });
      await page.locator("#refreshButton").click();
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      const reordered = await compare();
      assert.equal(
        reordered[0].relation,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      );
      assert.deepEqual(reordered[0].ids, [
        "22222222-2222-4222-8222-222222222222",
        "root-a",
        "child-a",
      ]);
      await page.locator("#inviteSearch").fill("Child");
      await compare();
      await page.locator("#inviteSearch").fill("");
      await page.locator("#inviteGroupView").uncheck();
      const flat = await page
        .locator("#inviteRows [data-invite-household]")
        .evaluateAll((rows) => rows.map((r) => r.dataset.inviteHousehold));
      assert.equal(
        flat[0],
        "22222222-2222-4222-8222-222222222222",
        "flat order remains independent of hierarchy",
      );
      await page.locator("#inviteGroupView").check();
      await compare();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS grouped Invites matches Households: top-level/manual relational order, roots/descendants, empty parents, ungrouped/archived, search, refresh/reorder and flat toggle at 390/1160px.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
