// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } = createFoodHarness(
  "rsvp-confirmed-list",
);
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
      );
      const behavior =
        "\nwindow.__foodAnswer=true;window.__invite.guests=[{id:'child',first_name:'Child',last_name:'Sample',is_child:true},{id:'adult',first_name:'Adult',last_name:'Sample',is_child:false}];window.__invite.invitations=window.__invite.guests.map(g=>({guest_id:g.id,session_id:s1,requires_rsvp:true}));const applySaved=responses=>{window.__invite.household.rsvp_state='locked';for(const link of window.__invite.invitations)link.response=responses.find(r=>r.guest_id===link.guest_id&&r.session_id===link.session_id)?.status;};const saved=sessionStorage.getItem('rsvp-test-confirmed');if(saved)applySaved(JSON.parse(saved));const previous=client.functions.invoke;client.functions.invoke=async(name,request)=>{if(request.body.action==='submit_household_rsvp'){applySaved(request.body.args.p_responses);sessionStorage.setItem('rsvp-test-confirmed',JSON.stringify(request.body.args.p_responses));return {data:{submission_id:'synthetic'}};}return previous(name,request);};";
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + behavior,
        }),
      );
      const base = "http://127.0.0.1:" + server.address().port;
      await page.goto(base + "/?ABCDEFGH");
      await page
        .locator("#rsvpRows input[data-guest-id=adult][value=attending]")
        .check();
      await page
        .locator("#rsvpRows input[data-guest-id=child][value=declined]")
        .check();
      await page.locator("#saveRsvp").click();
      const snapshot = () =>
        page
          .locator("#rsvpReviewRows li")
          .evaluateAll((rows) =>
            rows.map((n) => [
              n.querySelector("span").textContent,
              n.querySelector("strong").textContent,
            ]),
          );
      const before = await snapshot();
      assert.deepEqual(before, [
        ["Adult Sample", "Attending"],
        ["Child Sample", "Not attending"],
      ]);
      await page.locator("#confirmRsvp").click();
      await page.waitForFunction(() =>
        document.getElementById("confirmRsvp").classList.contains("hidden"),
      );
      assert.deepEqual(await snapshot(), before);
      assert.equal(await page.locator("#rsvpEditor").isHidden(), true);
      assert.equal(await page.locator("#rsvpReview").isVisible(), true);
      assert.equal(await page.locator("#editRsvp").isHidden(), true);
      assert.equal(await page.locator("#householdGuestHost").isHidden(), true);
      await page.locator("#languageSwitcher [data-language=de]").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#rsvpReviewRows li strong")?.textContent ===
          "Ich komme",
      );
      assert.deepEqual(
        await page.locator("#rsvpReviewRows li>span").allTextContents(),
        ["Adult Sample", "Child Sample"],
      );
      await page.goto(base + "/?ABCDEFGH");
      await page.locator("#rsvpReview:not(.hidden)").waitFor();
      assert.equal(await page.locator("#rsvpEditor").isHidden(), true);
      assert.equal(await page.locator("#confirmRsvp").isHidden(), true);
      assert.equal(await page.locator("#editRsvp").isHidden(), true);
      assert.deepEqual(
        await page.locator("#rsvpReviewRows li>span").allTextContents(),
        ["Adult Sample", "Child Sample"],
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
      "PASS confirmed RSVP list: same summary before/after confirmation, saved replies on reopen, adult-first order, language changes and no edit/confirm controls.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
