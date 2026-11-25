// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } = createFoodHarness(
  "private-guest-event",
);
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 950 },
    });
    const errors = [];
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
          "\nwindow.__guestCalls=[];const tracked=client.rpc;client.rpc=async(name,args)=>{window.__guestCalls.push(name);return tracked(name,args);};const invoke=client.functions.invoke;client.functions.invoke=async(name,request)=>request.body.args?.p_code==='AAAAAAAA'?{data:null}:invoke(name,request);",
      }),
    );
    const base = "http://127.0.0.1:" + server.address().port;
    const brand = page.locator("#guestBrand");
    await page.goto(base + "/");
    await page.locator("#codeCard:not(.hidden)").waitFor();
    assert.equal(await brand.getAttribute("href"), "./");
    assert.equal(await page.locator(".guest-mini-map").count(), 0);
    assert.equal(
      await page.evaluate(() =>
        window.__guestCalls.some((n) => n.startsWith("get_public_event")),
      ),
      false,
    );
    await page.goto(base + "/?AAAAAAAA");
    await page.locator("#guestStatus.warning").waitFor();
    assert.equal(await brand.getAttribute("href"), "./");
    assert.equal(await page.locator(".rsvp-session").count(), 0);
    await page.goto(base + "/?ABCDEFGH");
    await page.locator(".guest-mini-map").waitFor();
    assert.equal(await brand.getAttribute("href"), null);
    const attending = page.locator("#rsvpRows input[value=attending]").first();
    await attending.check();
    await brand.click();
    assert.equal(await page.locator("#codeCard").isHidden(), true);
    assert.equal(await attending.isChecked(), true);
    assert.equal(
      await page.locator(".guest-mini-map .guest-map-link").innerText(),
      "Map & directions",
    );
    assert.equal(
      await page
        .locator(".guest-map-thumbnail iframe")
        .getAttribute("referrerpolicy"),
      "no-referrer",
    );
    assert.equal(await page.evaluate(() => location.search), "");
    const placement = await page.locator(".rsvp-session").evaluate((n) => {
      const heading = n
          .querySelector(".guest-session-heading")
          .getBoundingClientRect(),
        map = n.querySelector(".guest-mini-map").getBoundingClientRect();
      return map.left >= heading.right && Math.abs(map.top - heading.top) < 2;
    });
    assert.ok(placement);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS private guest UI: no-code landing, invalid code, invitation envelope, upper-right mini map, exact caption without arrow, no-referrer and phone bounds.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
