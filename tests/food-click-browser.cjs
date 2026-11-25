// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("food-click");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
      );
      const behavior =
        "\nfixtures.event_settings[0].food_stage='selection';window.__invite.household.rsvp_state='locked';window.__foodAnswer=null;const previous=client.functions.invoke;client.functions.invoke=async(name,request)=>{if(request.body.action==='set_household_food_interest'&&!request.body.args.p_interest&&fixtures.food_claims.length)return {error:{message:'Existing commitments'}};if(request.body.action==='set_household_food_claim'){const a=request.body.args;fixtures.food_claims=fixtures.food_claims.filter(c=>c.food_item_id!==a.p_food_item_id);if(a.p_quantity)fixtures.food_claims.push({food_item_id:a.p_food_item_id,quantity:a.p_quantity});return {data:null};}return previous(name,request);};";
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + behavior,
        }),
      );
      await page.goto(
        "http://127.0.0.1:" + server.address().port + "/?ABCDEFGH",
      );
      const host = page.locator("#foodInterestHost"),
        yes = host.getByRole("button", {
          name: "I can bring food",
          exact: true,
        }),
        no = host.getByRole("button", {
          name: "I can’t bring food",
          exact: true,
        });
      await yes.waitFor();
      const boxes = await host.locator(".food-interest-choices button").evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { top: r.top, left: r.left };
        }),
      );
      assert.equal(boxes[0].top, boxes[1].top);
      assert.ok(boxes[1].left > boxes[0].left);
      assert.equal(await page.locator("#foodList").isHidden(), true);
      assert.equal(await host.locator("form").count(), 0);
      await yes.click();
      assert.equal(await page.locator("#foodList").isHidden(), true, "the draft does not open the menu");
      await page.locator("#confirmFoodInterest").click();
      await page.locator("#foodList:not(.hidden)").waitFor();
      assert.equal(await page.evaluate(() => window.__interestWrites), 1);
      assert.ok(
        (await page.locator("#foodSelectionPrompt").innerText()).startsWith(
          "Pick an item you would like to bring",
        ),
      );
      assert.equal(
        await page.evaluate(() => window.__fixtures.food_claims.length),
        0,
        "answer alone never reserves food",
      );
      const pair = page
        .locator(".guest-food-category")
        .filter({ hasText: "Coffee" })
        .locator(":scope>.food-list>.guest-food-choice");
      assert.equal(await pair.count(), 2);
      const pairRects = await pair.evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { top: r.top, left: r.left };
        }),
      );
      assert.equal(
        pairRects[0].top,
        pairRects[1].top,
        "two food choices share a row at " + width,
      );
      assert.ok(pairRects[1].left > pairRects[0].left);
      for (const tile of await pair.locator(":scope>button").all())
        assert.ok((await tile.boundingBox()).height >= 44);
      assert.equal(await host.isHidden(), true, "returning guests go directly to food choices");
      assert.equal(await no.count(), 0, "a confirmed answer cannot be switched");
      const group = page.locator(".guest-food-group").first(),
        pick = group.locator(":scope>button");
      await pick.waitFor();
      assert.ok(
        await pick.evaluate(
          (button) =>
            button.classList.contains("food-interest-choice") &&
            button.getBoundingClientRect().height >= 44,
        ),
      );
      assert.equal(
        await group
          .getByRole("button", { name: "Select group", exact: true })
          .count(),
        0,
      );
      await page.evaluate(() => (window.__failGroup = true));
      await pick.click();
      await page.locator("#guestStatus.error").waitFor();
      assert.equal(
        await page.evaluate(() => window.__fixtures.food_claims.length),
        0,
      );
      await pick.click();
      await page.waitForFunction(
        () => window.__fixtures.food_claims.length === 2,
      );
      assert.equal(
        await group.locator(":scope>details").evaluate((n) => n.open),
        false,
        "Selection does not expand the disclosure",
      );
      assert.equal(await yes.count(), 0, "the answer buttons stay hidden after selecting food");
      assert.deepEqual(
        await page.evaluate(() => ({ answer: window.__foodAnswer, writes: window.__interestWrites })),
        { answer: true, writes: 1 },
        "food selections keep the saved Yes without writing a second answer",
      );
      assert.equal(
        await page.evaluate(() => window.__fixtures.food_claims.length),
        2,
        "No cannot remove existing commitments",
      );
      await pick.click();
      await page.waitForFunction(
        () => window.__fixtures.food_claims.length === 0,
      );
      await page.waitForFunction(
        () =>
          document
            .querySelector(".guest-food-group>button")
            .getAttribute("aria-pressed") === "false",
      );
      assert.equal(
        await pick.getAttribute("aria-pressed"),
        "false",
        "clicking a selected tile removes the group",
      );
      const itemTile = page
        .locator(
          ".guest-food-category>.food-list>.guest-food-choice:not(.guest-food-group)>button",
        )
        .first();
      await itemTile.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector(
              ".guest-food-category>.food-list>.guest-food-choice:not(.guest-food-group)>button",
            )
            .getAttribute("aria-pressed") === "true",
      );
      assert.equal(
        await page.evaluate(() => window.__fixtures.food_claims.length),
        1,
      );
      await itemTile.click();
      await page.waitForFunction(
        () => window.__fixtures.food_claims.length === 0,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      if (width === 1024) {
        await page.evaluate(() => {
          document.querySelector(".guest-layout").style.display = "block";
          document.querySelector(".guest-main").style.maxWidth = "760px";
        });
        const cards = page
          .locator(".guest-food-category")
          .filter({ hasText: "Coffee" })
          .locator(":scope>.food-list>.food-item");
        if ((await cards.count()) > 1) {
          const positions = await cards.evaluateAll((nodes) =>
            nodes.slice(0, 2).map((n) => {
              const r = n.getBoundingClientRect();
              return { top: r.top, left: r.left };
            }),
          );
          assert.equal(positions[0].top, positions[1].top);
          assert.ok(positions[1].left > positions[0].left);
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS food click flow: confirmed interest, returning guest menu, full-card group selection, error/retry, toggle-off selection and separate details, protected commitments and phone/desktop bounds.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
