// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("food-review");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
      );
      const behavior =
        "\nfixtures.event_settings[0].food_stage='selection';window.__foodAnswer=true;fixtures.food_items[0].recipe_text='Mix the ingredients and bake.';window.__confirmCalls=[];window.__failConfirm=true;const previous=client.functions.invoke;client.functions.invoke=async(name,request)=>{if(request.body.action==='confirm_household_food'){window.__confirmCalls.push(request.body.args);if(window.__failConfirm){window.__failConfirm=false;return {error:{message:'Synthetic confirmation failure'}};}}return previous(name,request);};";
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + behavior,
        }),
      );
      await page.goto(
        "http://127.0.0.1:" + server.address().port + "/?ABCDEFGH",
      );
      await page.locator(".guest-food-group>button").first().click();
      await page.waitForFunction(
        () => window.__fixtures.food_claims.length === 2,
      );
      await page.locator("#confirmFood").click();
      const review = page.locator("#foodReview");
      await review.waitFor();
      assert.equal(await page.locator("#foodCard>h2").isVisible(), true);
      assert.equal(await page.locator("#foodCard>p").first().isHidden(), true);
      assert.equal(
        await review
          .getByText(
            "Check what your household will bring before confirming.",
            { exact: true },
          )
          .count(),
        0,
      );
      assert.equal(
        await page.locator("#guestEventName").innerText(),
        "Synthetic celebration",
      );
      assert.equal(await page.locator(".brand-symbol").count(), 0);
      assert.equal(await page.locator("h1 #welcomeMessage").count(), 1);
      assert.equal(
        await page
          .locator(".hero-panel")
          .getByText(
            "Private invitations · Please do not share your invitation link.",
            { exact: true },
          )
          .count(),
        0,
      );
      assert.equal(
        await page
          .locator("footer")
          .getByText(
            "Private invitations · Please do not share your invitation link.",
            { exact: true },
          )
          .count(),
        1,
      );
      assert.equal(
        await review
          .locator(".guest-response.rsvp-review-session .food-review-list>li")
          .count(),
        2,
      );
      assert.equal(
        await review
          .locator(".food-review-summary")
          .evaluate((n) => parseFloat(getComputedStyle(n).borderTopWidth) > 0),
        true,
      );
      assert.equal(await page.locator("#foodList").isHidden(), true);
      assert.equal(await page.evaluate(() => window.__confirmCalls.length), 0);
      const recipe = review.getByRole("button", {
        name: "Recipe · Chips",
        exact: true,
      });
      await recipe.click();
      await page.getByRole("region", { name: "Recipe", exact: true }).waitFor();
      assert.ok(
        (
          await page
            .getByRole("region", { name: "Recipe", exact: true })
            .innerText()
        ).includes("Mix the ingredients"),
      );
      const recipeDialog = page.getByRole("region", {
        name: "Recipe",
        exact: true,
      });
      assert.equal(await recipeDialog.getByRole("button").count(), 2);
      await page.evaluate(() => {
        window.__recipePrints = [];
        window.RSVP.printRecipe = (name, text) => {
          window.__recipePrints.push({ name, text });
          return true;
        };
      });
      await recipeDialog
        .getByRole("button", { name: "Print", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => window.__recipePrints[0].name),
        "Chips",
      );
      await recipeDialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
      assert.equal(
        await recipe.evaluate((n) => document.activeElement === n),
        true,
      );
      await review
        .getByRole("button", { name: "Back to edit", exact: true })
        .click();
      assert.equal(await page.locator("#foodList").isHidden(), false);
      assert.equal(await page.locator("#foodCard>h2").isVisible(), true);
      assert.equal(await page.locator("#foodCard>p").first().isVisible(), true);
      assert.equal(
        await page.evaluate(() => window.__fixtures.food_claims.length),
        2,
      );
      assert.equal(await page.locator("#foodFollowup").isVisible(), true);
      await page.locator("#confirmFood").click();
      const confirm = review.locator("#foodReviewConfirm");
      await confirm.press("Enter");
      const feedback = review.getByRole("alert");
      await feedback.waitFor();
      assert.equal(await feedback.innerText(), "Synthetic confirmation failure");
      assert.equal(await page.locator("#guestStatus.error").count(), 0);
      assert.equal(await review.isVisible(), true);
      assert.equal(await confirm.isEnabled(), true);
      assert.equal(
        await feedback.evaluate((notice) => {
          const retry = notice.nextElementSibling;
          const { top, bottom } = notice.getBoundingClientRect();
          return retry === document.activeElement && top >= 0 &&
            bottom <= innerHeight && retry.getAttribute("aria-describedby") === notice.id;
        }),
        true,
      );
      await confirm.press("Enter");
      await page.waitForFunction(() => window.__foodConfirmed === true);
      await page.waitForFunction(
        () => !document.getElementById("foodReviewConfirm"),
      );
      assert.equal(await review.locator("li").count(), 2);
      assert.equal(await review.getByRole("alert").count(), 0);
      assert.equal(
        await page.evaluate(
          () => window.__confirmCalls[1].p_expected_claims.length,
        ),
        2,
      );
      assert.equal(await page.locator("#foodHint").innerText(), "");
      assert.equal(
        await review
          .getByText("Thank you! Your food selection is confirmed.", {
            exact: true,
          })
          .count(),
        1,
      );
      assert.equal(
        await page.locator("#guestStatus").innerText(),
        "Thank you! Your food selection is confirmed.",
      );
      assert.equal(await page.locator("#foodCard>.eyebrow").isVisible(), true);
      assert.equal(await page.locator("#foodCard>h2").isVisible(), true);
      assert.equal(
        await review.evaluate((n) => n.firstElementChild.getAttribute("role")),
        "status",
      );
      assert.equal(await page.locator("#foodList").isHidden(), true);
      assert.equal(await recipe.isVisible(), true);
      assert.equal(await page.locator("#foodFollowup").isVisible(), true);
      assert.ok(
        (await page.locator("#foodFollowup").innerText()).includes(
          "everyone’s replies",
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
      "PASS food review: selected list, inline recipe popup, Back retains reservations, no premature confirmation, failure/retry, reviewed claim snapshot and confirmed list.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
