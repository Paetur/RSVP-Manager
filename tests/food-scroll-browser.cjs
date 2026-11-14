// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("food-scroll");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 760 } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
      );
      const behavior =
        "\nfixtures.event_settings[0].food_stage='selection';window.__foodAnswer=true;window.__groups=[];fixtures.food_items=Array.from({length:40},(_,i)=>({id:'88888888-8888-4888-8888-'+String(i).padStart(12,'0'),name_en:'Food choice '+i,quantity_needed:10,active:true,category:'Snacks',quantity_type:'Piece(s)'}));const previous=client.functions.invoke;window.__foodLoads=0;client.functions.invoke=async(name,request)=>{const {action,args}=request.body;if(action==='get_household_food')window.__foodLoads++;if(action==='set_household_food_claim'){await new Promise(r=>setTimeout(r,60));fixtures.food_claims=fixtures.food_claims.filter(c=>c.food_item_id!==args.p_food_item_id);if(args.p_quantity)fixtures.food_claims.push({food_item_id:args.p_food_item_id,quantity:args.p_quantity});return {data:null};}return previous(name,request);};";
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + behavior,
        }),
      );
      await page.goto(
        "http://127.0.0.1:" + server.address().port + "/?ABCDEFGH",
      );
      const target = page.locator("#foodList button[data-item-id]").nth(20);
      await target.waitFor();
      await target.evaluate((n) =>
        n.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      const top = () => target.evaluate((n) => n.getBoundingClientRect().top);
      const start = await top();
      for (const selected of ["true", "false"]) {
        await target.click();
        await page.waitForFunction(
          ({ selected }) =>
            document
              .querySelectorAll("#foodList button[data-item-id]")[20]
              .getAttribute("aria-pressed") === selected,
          { selected },
        );
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        assert.ok(
          Math.abs((await top()) - start) < 2,
          "choice moved after " +
            selected +
            " at " +
            width +
            "px: " +
            (await top()) +
            " vs " +
            start,
        );
      }
      await target.focus();
      const loads = await page.evaluate(() => window.__foodLoads);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForFunction((n) => window.__foodLoads > n, loads);
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      assert.ok(
        Math.abs((await top()) - start) < 2,
        "polling moved the visible choice",
      );
      assert.equal(
        await target.evaluate((n) => document.activeElement === n),
        true,
        "polling preserves keyboard focus",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS food scroll: deep-list selection/removal, status insertion, polling and keyboard focus preserve the visible choice at phone/desktop widths.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
