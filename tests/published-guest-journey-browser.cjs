// Real browser SDK and Studio gateway over an isolated application database.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { chromium } = require("playwright");
const { createGuestJourneyFixture } = require("./helpers/published-guest-journey.cjs");

const origin = "https://published-guest.example.invalid";
const sdkPackage = require.resolve("@supabase/supabase-js/package.json");
const { version: sdkVersion } = require(sdkPackage);
const sdkUrl = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + sdkVersion + "/dist/umd/supabase.min.js";
const sdk = readFileSync(join(dirname(sdkPackage), "dist/umd/supabase.js"));
const integrity = 'integrity="sha384-' + createHash("sha384").update(sdk).digest("base64") + '"';
const site = join(__dirname, "..");
const html = readFileSync(join(site, "index.html"), "utf8");
const sdkScript = [...html.matchAll(/<script\b[^>]*>/g)].find(([tag]) =>
  tag.includes('src="' + sdkUrl + '"'),
)?.[0];
assert.match(sdkScript, /\bintegrity="[^"]+"/, "The checkout must use the pinned SDK");

const invite = person => origin + "/?" + person.code;
const choice = (page, index, answer) =>
  page.locator("#rsvpRows fieldset").nth(index).locator("input[value=" + answer + "]");
const openInvite = async (page, person) => {
  await page.goto(invite(person));
  const householdName = page.locator("#householdName").filter({ hasText: person.name });
  await householdName.waitFor();
  assert.equal(await householdName.innerText(), person.name);
  assert.equal(new URL(page.url()).search, "");
};

async function main() {
  const fixture = await createGuestJourneyFixture(origin);
  const requests = [];
  const errors = [];
  const interceptedConfigs = new Set();
  const dropNextResponse = new Set();
  const calls = (action, person) => requests.filter(request =>
    request.action === action && (!person || request.args.p_code === person.code),
  );
  let browser;
  try {
    browser = await chromium.launch();
    async function guestPage(width) {
      const context = await browser.newContext({
        viewport: { width, height: 1060 },
        serviceWorkers: "block",
      });
      await context.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      // Fulfill all requests in-process. Never continue to a live connection.
      await context.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        try {
          if (url.href === sdkUrl && method === "GET") {
            return route.fulfill({
              contentType: "application/javascript",
              headers: { "access-control-allow-origin": "*" },
              body: sdk,
            });
          }
          assert.equal(url.origin, origin, "Unexpected browser origin");
          if (method === "GET" && url.pathname === "/") {
            return route.fulfill({
              contentType: "text/html",
              body: html.replace(sdkScript, sdkScript.replace(/\bintegrity="[^"]+"/, integrity)),
            });
          }
          if (method === "GET" && ["/js/config.js", "/js/config.production.js"].includes(url.pathname)) {
            interceptedConfigs.add(url.pathname);
            const config = { supabaseUrl: origin, supabaseKey: "sb_publishable_synthetic" };
            return route.fulfill({
              contentType: "application/javascript",
              body: "window.RSVP_CONFIG=" + JSON.stringify(config) + ";",
            });
          }
          if (method === "GET" && /^\/(?:js\/[\w.-]+\.js|css\/[\w.-]+\.css|locales\/[\w/-]+\.json)$/.test(url.pathname)) {
            return route.fulfill({ path: join(site, url.pathname) });
          }
          if (method === "GET" && url.pathname === "/favicon.ico")
            return route.fulfill({ status: 204 });
          if (method === "POST" && url.pathname === "/rest/v1/rpc/get_language_configuration") {
            assert.deepEqual(JSON.parse(request.postData()), {});
            return route.fulfill({ json: await fixture.languageConfiguration() });
          }
          assert.equal(method, "POST", "Unexpected browser request method");
          assert.equal(url.pathname, "/functions/v1/guest-gateway", "Unexpected browser endpoint");
          const body = request.postData();
          const { action, args } = JSON.parse(body);
          const response = await fixture.gateway(new Request(url, {
            method,
            headers: await request.allHeaders(),
            body,
          }));
          const dropped = response.ok && dropNextResponse.delete(action);
          requests.push({ action, args, status: response.status, dropped });
          return dropped ? route.abort("failed") : route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
          });
        } catch (error) {
          errors.push(method + " " + url + "\n" + error.stack);
          return route.abort();
        }
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.stack));
      return page;
    }

    const [primary, competing] = fixture.households;
    const guest = await guestPage(390);
    const otherGuest = await guestPage(1160);
    const confirmRsvp = guest.locator("#confirmRsvp");
    const comment = "Synthetic review note";

    await openInvite(guest, primary);
    await choice(guest, 0, "attending").check();
    await guest.locator("#saveRsvp").click();
    await guest.locator("#guestStatus.warning").waitFor();
    assert.equal(await confirmRsvp.isVisible(), false);
    assert.equal(calls("submit_household_rsvp").length, 0);

    const companion = guest.locator(".guest-add-person");
    await companion.locator("summary").click();
    await companion.locator("input").nth(0).fill("Synthetic");
    await companion.locator("input").nth(1).fill("Companion");
    const saveCompanion = companion.locator("button[type=submit]");
    dropNextResponse.add("add_household_guest");
    await saveCompanion.click();
    await companion.locator("[role=status]:not(:empty)").waitFor();
    await saveCompanion.click();
    const companionChoices = guest.locator('#rsvpRows fieldset[aria-label="Synthetic Companion"]');
    await companionChoices.nth(1).waitFor();
    assert.equal(await companionChoices.count(), 2, "The companion inherits both sessions");
    assert.equal(await choice(guest, 0, "attending").isChecked(), true);
    const added = calls("add_household_guest", primary);
    assert.deepEqual(added.map(({ status, dropped }) => [status, dropped]), [[200, true], [200, false]]);
    assert.deepEqual(added[0].args, added[1].args, "The companion retry uses the same guest ID");

    for (const [index, answer] of ["attending", "declined", "declined", "attending"].entries())
      await choice(guest, index, answer).check();
    await guest.locator("#rsvpComment").fill(comment);
    await guest.locator("#saveRsvp").click();
    await confirmRsvp.waitFor();
    assert.equal(await guest.locator("#rsvpReviewRows li").count(), 4);
    assert.match(await guest.locator("#rsvpReviewRows").innerText(), /not attending/i);
    assert.equal(await guest.locator("#rsvpCommentPreview p").textContent(), comment);
    assert.equal(calls("submit_household_rsvp").length, 0, "Review only reads local choices");

    dropNextResponse.add("submit_household_rsvp");
    await confirmRsvp.click();
    await guest.locator("#guestStatus.error").waitFor();
    await confirmRsvp.click();
    await guest.locator("#guestStatus.success").waitFor();
    const submitted = calls("submit_household_rsvp", primary);
    assert.deepEqual(submitted.map(({ status, dropped }) => [status, dropped]), [[200, true], [200, false]]);
    assert.deepEqual(submitted[0].args, submitted[1].args, "The RSVP retry uses the same request ID");
    const companionId = added[0].args.p_guest_id;
    const [ceremony, reception] = fixture.sessions;
    const answers = new Map(submitted[1].args.p_responses.map(reply =>
      [reply.guest_id + "/" + reply.session_id, reply.status],
    ));
    assert.deepEqual(answers, new Map([
      [primary.guest + "/" + ceremony, "attending"],
      [companionId + "/" + ceremony, "declined"],
      [primary.guest + "/" + reception, "declined"],
      [companionId + "/" + reception, "attending"],
    ]));
    assert.equal(await confirmRsvp.isVisible(), false);

    await guest.reload();
    await guest.locator("#codeCard").waitFor();
    assert.equal(await guest.locator("#invitationCard").isVisible(), false);
    await guest.locator("#inviteCode").fill(primary.code);
    await guest.locator("#codeForm button").click();
    const savedComment = guest.locator("#rsvpCommentPreview p");
    await savedComment.waitFor();
    assert.equal(await savedComment.textContent(), comment);
    assert.equal(await guest.locator("#rsvpReviewRows li").count(), 4);
    assert.equal(await confirmRsvp.isVisible(), false);

    await fixture.startNextVisit();
    await fixture.correct(primary, "declined");
    await openInvite(guest, primary);
    assert.match(await guest.locator("#rsvpReviewRows li").first().innerText(), /not attending/i);
    assert.equal(await confirmRsvp.isVisible(), false, "A direct correction keeps the response locked");
    await fixture.reopen(primary);
    await openInvite(guest, primary);
    assert.equal(await choice(guest, 0, "declined").isChecked(), true);
    await choice(guest, 0, "attending").check();
    await choice(guest, 1, "attending").check();
    await guest.locator("#saveRsvp").click();
    await confirmRsvp.click();
    await guest.locator("#guestStatus.success").waitFor();
    const corrected = calls("submit_household_rsvp", primary).at(-1);
    assert.equal(corrected.status, 200);
    assert.equal(corrected.args.p_responses.filter(reply => reply.status === "attending").length, 3);
    assert.equal(await confirmRsvp.isVisible(), false);

    await fixture.expireDeadline();
    await openInvite(otherGuest, competing);
    await choice(otherGuest, 0, "attending").check();
    await choice(otherGuest, 1, "declined").check();
    await otherGuest.locator("#saveRsvp").click();
    const confirmLate = otherGuest.locator("#confirmRsvp");
    await confirmLate.click();
    await otherGuest.locator("#guestStatus.error").waitFor();
    assert.equal(await confirmLate.isVisible(), true);
    await fixture.allowLate(competing);
    await confirmLate.click();
    await otherGuest.locator("#guestStatus.success").waitFor();
    const late = calls("submit_household_rsvp", competing);
    assert.deepEqual(late.map(request => request.status), [400, 200]);
    assert.deepEqual(late[0].args, late[1].args);

    await fixture.startNextVisit();
    const foodChoice = page => page.locator("#foodList button[data-item-id]");
    for (const page of [guest, otherGuest]) {
      await page.locator("#foodInterestHost button").first().click();
      await foodChoice(page).waitFor();
    }
    // Both pages already display the last unit. Dispatch both clicks without a
    // focus change refreshing one page before it submits the competing claim.
    const claims = [guest, otherGuest].map(page => page.waitForResponse(response =>
      response.url() === origin + "/functions/v1/guest-gateway" &&
      response.request().postDataJSON()?.action === "set_household_food_claim",
    ));
    await Promise.all([
      ...claims,
      foodChoice(guest).evaluate(button => button.click()),
      foodChoice(otherGuest).evaluate(button => button.click()),
    ]);
    const food = calls("set_household_food_claim");
    assert.deepEqual(food.map(request => request.status).sort(), [200, 400]);
    const primaryWon = food.find(request => request.status === 200).args.p_code === primary.code;
    const winningGuest = primaryWon ? guest : otherGuest;
    const winner = primaryWon ? primary : competing;
    const losingGuest = primaryWon ? otherGuest : guest;
    await losingGuest.locator("#guestStatus.error").waitFor();
    assert.equal(await losingGuest.locator("#confirmFood").isVisible(), false);

    await winningGuest.locator("#confirmFood").click();
    assert.match(await winningGuest.locator("#foodReview .food-review-list").innerText(), /1 × Synthetic fruit basket/);
    await winningGuest.locator("#foodReviewConfirm").click();
    const confirmation = winningGuest.locator("#foodReview [role=status]");
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), /confirmed/i);
    const [confirmed] = calls("confirm_household_food", winner);
    assert.equal(confirmed.status, 200);
    assert.deepEqual(confirmed.args.p_expected_claims, [{ food_item_id: fixture.item, quantity: 1 }]);

    await openInvite(winningGuest, winner);
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), /confirmed/i);
    assert.equal(await winningGuest.locator("#foodReviewConfirm").isVisible(), false);

    const final = await fixture.snapshot();
    assert.equal(final.guests, 3);
    for (const [person, expected] of [[primary, [1, 2]], [competing, [1]]])
      assert.deepEqual(
        final.submissions.filter(row => row.household_id === person.id).map(row => row.submission_number).sort(),
        expected,
      );
    assert.deepEqual(final.claims, [{ household_id: winner.id, food_item_id: fixture.item, quantity: 1 }]);
    assert.deepEqual(final.confirmed, [{ id: winner.id }]);
    assert.deepEqual(
      fixture.refusals.map(refusal => refusal.name + ": " + refusal.message).sort(),
      [
        "set_household_food_claim: Insufficient remaining quantity",
        "submit_household_rsvp: RSVP deadline passed",
      ],
    );

    await fixture.setPublished(false);
    await winningGuest.goto(invite(winner));
    await winningGuest.locator("#guestStatus.warning").waitFor();
    assert.equal(await winningGuest.locator("#invitationCard").isVisible(), false);
    assert.deepEqual([...interceptedConfigs].sort(), ["/js/config.js", "/js/config.production.js"]);
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.bridgeErrors, []);
    console.log("PASS published guest journey: incomplete and mixed replies, companion and RSVP retries, reload, organizer corrections, deadline and late window, competing food claims, confirmation and unpublication.");
  } catch (error) {
    if (errors.length) console.error(errors.join("\n"));
    if (fixture.bridgeErrors.length) console.error(fixture.bridgeErrors.join("\n"));
    throw error;
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await fixture.close();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
