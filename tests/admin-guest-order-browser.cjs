const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock } = createFoodHarness("admin-guest-order");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.addInitScript(() =>
      localStorage.setItem("rsvp-interface-language", "en"),
    );
    const fixture = `fixtures.event_settings[0].default_language='en';fixtures.guests=fixtures.guests.filter(g=>g.household_id!==h2);fixtures.guests.push(...[{id:'a',first_name:'Zoe',is_child:false,sort_order:9},{id:'b',first_name:'Alice',is_child:false,sort_order:2},{id:'c',first_name:'Charlie',is_child:true,sort_order:0},{id:'d',first_name:'Ben',is_child:true,sort_order:4}].map(g=>({...g,household_id:h2})));`;
    await p.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + fixture,
      }),
    );
    await p.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await p.locator("[data-tab=households]").click();
    await p.locator("#expandHouseholds").click();

    const list = p.locator(
      '[data-tree-key="household:22222222-2222-4222-8222-222222222222"] > .household-expanded > .household-guest-list',
    );
    assert.deepEqual(
      await list.locator(".household-guest-info>strong").allTextContents(),
      ["Alice", "Zoe", "Charlie", "Ben"],
    );
    for (const [id, label, disabled] of [
      ["b", "Move guest up", true],
      ["a", "Move guest down", true],
      ["c", "Move guest up", true],
      ["d", "Move guest down", true],
      ["b", "Move guest down", false],
      ["c", "Move guest down", false],
    ])
      assert.equal(
        await list
          .locator("[data-guest-id=" + id + "]")
          .getByRole("button", { name: label, exact: true })
          .isDisabled(),
        disabled,
      );
    console.log(
      "PASS admin: same adult-first crossed-order display and within-group movement buttons.",
    );
  } finally {
    await b.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
