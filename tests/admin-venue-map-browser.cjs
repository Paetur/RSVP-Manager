const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("admin-venue-map");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } }),
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
          body:
            mock +
            "\n" +
            extra +
            "\n" +
            stageExtra +
            "\nfixtures.event_locations=[{id:cat1,name:'Synthetic venue',address:'Example street 12',timezone:'Europe/Berlin',map_url:'https://maps.example.invalid/venue',sort_order:1,archived_at:null}];",
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      await page.locator("[data-tab=venues]").click();
      const venue = page
          .locator("#venueList>details")
          .filter({ has: page.getByText("Synthetic venue", { exact: true }) })
          .first(),
        map = venue.locator(":scope>summary .admin-venue-map");
      await map.waitFor();
      assert.equal(
        await map.locator("iframe").getAttribute("referrerpolicy"),
        "no-referrer",
      );
      assert.ok(
        (await map.locator("iframe").getAttribute("src")).includes(
          "Synthetic%20venue%2C%20Example%20street%2012",
        ),
      );
      assert.equal(
        await map.locator(".venue-map-link").count(),
        0,
        "admin thumbnail has no visible caption",
      );
      assert.equal(
        await map.locator("a").first().getAttribute("href"),
        "https://maps.example.invalid/venue",
      );
      assert.equal(
        await map.locator("a").first().getAttribute("rel"),
        "noopener noreferrer",
      );
      const open = await venue.evaluate((n) => n.open);
      for (const link of await map.locator("a").all()) {
        await link.evaluate((n) =>
          n.addEventListener("click", (e) => e.preventDefault()),
        );
        await link.click();
        assert.equal(
          await venue.evaluate((n) => n.open),
          open,
          "map click keeps disclosure state",
        );
      }

      if (!(await venue.evaluate((n) => n.open)))
        await venue.locator(":scope>summary strong").click();
      await venue.locator("[data-record-pencil]").click();
      const field = venue.locator("input[type=url]");
      await field.waitFor();
      assert.equal(
        await field.inputValue(),
        "https://maps.example.invalid/venue",
      );
      await page.evaluate(() => {
        fixtures.event_locations[0].name = "Updated venue";
        fixtures.event_locations[0].map_url =
          "https://maps.example.invalid/updated";
      });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      const updated = page
        .locator("#venueList>details")
        .filter({ has: page.getByText("Updated venue", { exact: true }) })
        .first();
      await updated.locator(":scope>summary .admin-venue-map").waitFor();
      assert.equal(
        await updated.locator(".guest-map-thumbnail").getAttribute("href"),
        "https://maps.example.invalid/updated",
      );
      assert.ok(
        (await updated.locator("iframe").getAttribute("src")).includes(
          "Updated%20venue",
        ),
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
      "PASS admin mini maps: saved directions, correct venue query, lazy/private iframe, no disclosure toggle, retained edit URL and phone/desktop bounds.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
