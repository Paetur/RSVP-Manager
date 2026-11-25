// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("venue-lines");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
      );
      const layout =
        "\nconst venueRpc=client.rpc;client.rpc=async(name,args)=>{const result=await venueRpc(name,args);if(name==='get_public_event_v2'){result.data.locations[0].name='Calvary Chapel Heidelberg';result.data.locations[0].welcome_en='Welcome to our celebration.';result.data.locations[0].address='Vangerowstraße 51 A 69115 Bergheim Deutschland';}return result;};";
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + layout,
        }),
      );
      await page.goto(
        "http://127.0.0.1:" + server.address().port + "/?ABCDEFGH",
      );
      const lines = page
        .locator(".session-venue-lines")
        .first()
        .locator(":scope>span");
      await lines.first().waitFor();
      assert.equal(
        await page
          .locator(".rsvp-session")
          .first()
          .evaluate(
            (n) =>
              n
                .querySelector(".guest-session-heading")
                .nextElementSibling?.classList.contains("venue-welcome") &&
              n
                .querySelector(".venue-welcome")
                .nextElementSibling?.classList.contains(
                  "guest-session-details",
                ),
          ),
        true,
      );
      assert.deepEqual(await lines.allTextContents(), [
        "Calvary Chapel Heidelberg",
        "Vangerowstraße 51 A",
        "69115 Bergheim Deutschland",
        "Time: 10:30 to 19:00",
      ]);
      await page.locator("#languageSwitcher [data-language=de]").click();
      await page.waitForFunction(
        () =>
          document.querySelector(".session-venue-lines>span:last-child")
            .textContent === "Zeit: 10:30 bis 19:00",
      );
      assert.equal(await lines.last().innerText(), "Zeit: 10:30 bis 19:00");
      await page.locator("#languageSwitcher [data-language=fo]").click();
      await page.waitForFunction(() =>
        document
          .querySelector(".session-venue-lines>span:last-child")
          .textContent.startsWith("Tíð:"),
      );
      assert.equal(await lines.last().innerText(), "Tíð: 10:30 til 19:00");
      await page.evaluate(() => localStorage.setItem("rsvp-time-format", "12"));
      await page.locator("#languageSwitcher [data-language=en]").click();
      await page.waitForFunction(() =>
        document
          .querySelector(".session-venue-lines>span:last-child")
          .textContent.startsWith("Time:"),
      );
      assert.match(await lines.last().innerText(), /10:30.*7:00/i);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      const geometry = await page
        .locator(".rsvp-session")
        .first()
        .evaluate((n) => {
          const title = n
              .querySelector(".guest-session-heading")
              .getBoundingClientRect(),
            map = n.querySelector(".guest-mini-map").getBoundingClientRect();
          return map.left >= title.right && Math.abs(map.top - title.top) < 2;
        });
      assert.ok(geometry);
      await page.close();
    }
    console.log(
      "PASS venue lines: exact address breaks, English/German/Faroese time ranges, venue timezone, 12-hour preference and right-hand map at phone/desktop widths.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
