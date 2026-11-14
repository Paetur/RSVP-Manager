// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("guest-order");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
      );
      const order =
        "\nwindow.__invite.guests=[{id:'child1',first_name:'Charlie',last_name:'Test',is_child:true,sort_order:0},{id:'adult1',first_name:'Zoe',last_name:'Test',is_child:false,sort_order:9},{id:'child2',first_name:'Ben',last_name:'Test',is_child:true,sort_order:4},{id:'adult2',first_name:'Alice',last_name:'Test',is_child:false,sort_order:2}];window.__invite.invitations=window.__invite.guests.map(g=>({guest_id:g.id,session_id:s1,requires_rsvp:true}));";
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + order,
        }),
      );
      await page.goto(
        "http://127.0.0.1:" + server.address().port + "/?ABCDEFGH",
      );
      const expected = ["Alice Test", "Zoe Test", "Charlie Test", "Ben Test"];
      await page.locator(".rsvp-person-name").first().waitFor();
      assert.deepEqual(
        await page.locator(".rsvp-person-name").allTextContents(),
        expected,
      );
      for (const input of await page
        .locator("#rsvpRows input[value=attending]")
        .all())
        await input.check();
      await page.locator("#saveRsvp").click();
      await page.locator("#rsvpReview:not(.hidden)").waitFor();
      assert.deepEqual(
        await page.locator("#rsvpReviewRows li>span").allTextContents(),
        expected,
      );
      await page.locator("#languageSwitcher [data-language=de]").click();
      await page.waitForFunction(() => document.documentElement.lang === "de");
      assert.deepEqual(
        await page.locator("#rsvpReviewRows li>span").allTextContents(),
        expected,
      );
      await page.locator("#editRsvp").click();
      assert.deepEqual(
        await page.locator(".rsvp-person-name").allTextContents(),
        expected,
      );
      assert.equal(await page.locator("#rsvpRows input:checked").count(), 4);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.close();
    }
    console.log(
      "PASS guest ordering: adults first, saved ordering within adult/child groups, shuffled invitation links, review/language/Back consistency and retained answers.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
