// Real browser SDK and Studio gateway over an isolated application database.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { chromium } = require("playwright");
const { createGuestJourneyFixture } = require("./helpers/published-guest-journey.cjs");

const origin = "https://published-guest.example.invalid";
const sdkPackage = require.resolve("@supabase/supabase-js/package.json");
const { version: sdkVersion } = require(sdkPackage);
const sdkUrl = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + sdkVersion + "/dist/umd/supabase.min.js";
const sdk = readFileSync(join(dirname(sdkPackage), "dist/umd/supabase.js"));
const integrity = 'integrity="sha384-' + createHash("sha384").update(sdk).digest("base64") + '"';
const site = resolve(process.env.RSVP_TEST_SITE_ROOT || join(__dirname, ".."));
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
  const combinedAction = "submit_household_response";
  let failNextCombined = false;
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
          if (action === combinedAction && failNextCombined) {
            failNextCombined = false;
            requests.push({ action, args, status: 503, dropped: false });
            return route.fulfill({ status: 503, json: { error: "Synthetic request unavailable" } });
          }
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

    const [primary, competing, bringingFood, decliningFood] = fixture.households;
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
    await guest.locator("#rsvpNext").press("Enter");
    assert.equal(await guest.locator("#rsvpCommentLabel").evaluate(node => node === document.activeElement), true,
      "RSVP Next skips directly to the final step when Food is unavailable");
    await guest.locator("#rsvpCommentDisclosure summary").press("Enter");
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
    assert.equal(await choice(guest, 0, "declined").isChecked(), true);
    assert.equal(await choice(guest, 0, "attending").isDisabled(), true);
    assert.equal(await guest.locator("#saveRsvp").isVisible(), false);
    assert.deepEqual(await fixture.responseState(primary), { rsvp: "locked", food: null, submissions: 1 });

    await fixture.expireDeadline();
    await openInvite(otherGuest, competing);
    assert.equal(await choice(otherGuest, 0, "attending").isDisabled(), true, "a freshly loaded closed RSVP is read-only");
    assert.equal(await otherGuest.locator("#saveRsvp").isVisible(), false);
    await fixture.resetDeadline();
    await openInvite(otherGuest, competing);
    await choice(otherGuest, 0, "attending").check();
    await choice(otherGuest, 1, "declined").check();
    await otherGuest.locator("#saveRsvp").click();
    const confirmLate = otherGuest.locator("#confirmRsvp");
    await confirmLate.waitFor();
    await fixture.expireDeadline();
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
    await fixture.enableFood();
    await openInvite(guest, primary);
    await openInvite(otherGuest, competing);
    const foodChoice = page => page.locator("#foodList button[data-item-id]");
    async function assertReturningFood(page) {
      await page.getByRole("heading", { name: "Choose food to bring", exact: true }).waitFor();
      assert.equal(await page.locator("#rsvpReviewTitle").innerText(), "Your RSVP");
      assert.equal(await page.locator("#foodInterestHost").isHidden(), true);
    }
    for (const page of [guest, otherGuest]) {
      await page.locator("#foodInterestYes").click();
      await page.locator("#confirmFoodInterest").click();
      await page.locator('.food-interest-choices[data-confirmed="true"] #foodInterestYes[aria-pressed="true"]:disabled').waitFor();
      assert.equal(await page.locator("#foodList").isHidden(), true);
      assert.equal(await page.locator("#confirmFood").isHidden(), true);
    }
    const returning = [[guest, primary, "Alex", "Not attending"], [otherGuest, competing, "Sam", "Attending"]];
    for (const [, person] of returning) {
      const response = await fixture.responseState(person);
      assert.equal(response.rsvp, "locked");
      assert.equal(response.food, true);
    }
    assert.equal(calls("set_household_food_claim").length, 0);

    await fixture.openFoodChoices();
    await fixture.startNextVisit();
    for (const [page, person, firstName, answer] of returning) {
      await openInvite(page, person);
      await assertReturningFood(page);
      await foodChoice(page).waitFor();
      const savedRsvp = page.locator("#rsvpReview");
      assert.equal(await savedRsvp.isVisible(), true);
      const guestReply = savedRsvp.locator("li").filter({ hasText: firstName }).first();
      assert.equal(await guestReply.locator("strong").innerText(), answer);
      assert.equal(await savedRsvp.evaluate(node => !!(
        node.compareDocumentPosition(document.getElementById("foodCard")) & Node.DOCUMENT_POSITION_FOLLOWING
      )), true, "the saved RSVP precedes the food menu");
      assert.equal(await page.locator("#confirmRsvp").isVisible(), false);
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
    await winningGuest.getByRole("button", { name: "Confirm food choices", exact: true }).click();
    const confirmation = winningGuest.locator("#foodReview [role=status]");
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), /confirmed/i);
    const [confirmed] = calls("confirm_household_food", winner);
    assert.equal(confirmed.status, 200);
    assert.deepEqual(confirmed.args.p_expected_claims, [{ food_item_id: fixture.item, quantity: 1 }]);

    await openInvite(winningGuest, winner);
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), /confirmed/i);
    assert.match(await winningGuest.locator("#foodReview .food-review-list").innerText(), /1 × Synthetic fruit basket/);
    assert.equal(await winningGuest.locator("#rsvpReview").isVisible(), true);
    assert.equal(await winningGuest.locator("#foodReviewTitle").innerText(), "You’re bringing");
    assert.equal(await winningGuest.locator("#foodList").isHidden(), true);
    assert.equal(await winningGuest.locator("#foodReviewConfirm").isVisible(), false);

    const final = await fixture.snapshot();
    assert.equal(final.guests, 5);
    for (const person of [primary, competing]) {
      assert.deepEqual(
        final.submissions.filter(row => row.household_id === person.id).map(row => row.submission_number),
        [1],
      );
    }
    assert.deepEqual(final.claims, [{ household_id: winner.id, food_item_id: fixture.item, quantity: 1 }]);
    assert.deepEqual(final.confirmed, [{ id: winner.id }]);
    assert.deepEqual(
      fixture.refusals.map(refusal => refusal.name + ": " + refusal.message).sort(),
      [
        "set_household_food_claim: Insufficient remaining quantity",
        "submit_household_rsvp: RSVP deadline passed",
      ],
    );

    await guest.context().close();
    await otherGuest.context().close();
    await fixture.resetDeadline();

    async function checkCombinedResponse(page, person, foodInterest) {
      await fixture.startNextVisit();
      await openInvite(page, person);
      const review = page.locator("#reviewResponses");
      const submit = page.locator("#confirmRsvp");
      const edit = page.locator("#editRsvp");
      const error = page.locator("#responseSubmitError");
      const preview = page.locator("#foodInterestPreview");
      const foodYes = page.locator("#foodInterestYes");
      const foodNo = page.locator("#foodInterestNo");
      const selectedFood = foodInterest ? foodYes : foodNo;
      const reviewNote = "Synthetic combined response";
      const editedNote = reviewNote + " after an edit";
      const commentSummary = page.locator("#rsvpCommentDisclosure summary");
      const commentInput = page.locator("#rsvpComment");
      const nextRsvp = page.locator("#rsvpNext");
      const nextFood = page.locator("#foodNext");
      const narrow = page.viewportSize().width < 700;
      const focusIs = locator => locator.evaluate(node => node === document.activeElement);
      const hasAction = (action, host) => action.evaluate((node, selector) => Boolean(node.closest(selector)), host);
      await review.waitFor();
      assert.equal(await edit.isVisible(), false, "Edit answers is hidden before review");
      assert.equal(await commentSummary.innerText(), "RSVP comment");
      assert.equal(await commentInput.isHidden(), true, "the optional comment starts collapsed");
      assert.equal(await page.locator("#rsvpCommentPanel").evaluate(panel =>
        Boolean(document.getElementById("foodCard").compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
      if (narrow) {
        const footer = page.locator("#guestResponseFooter");
        assert.equal(await hasAction(review, "#guestResponseFooter"), true);
        assert.equal(await footer.locator("button:visible").count(), 1);
        const start = await footer.evaluate(node => ({ position: getComputedStyle(node).position, y: node.getBoundingClientRect().top }));
        assert.equal(start.position, "fixed");
        await page.evaluate(() => window.scrollBy({ top: 250, behavior: "instant" }));
        const shifted = await footer.evaluate(node => ({ y: node.getBoundingClientRect().top, scrollY }));
        assert.ok(shifted.scrollY > 0);
        assert.equal(shifted.y, start.y, "the narrow action stays stationary when the invitation scrolls");
      } else {
        assert.equal(await hasAction(review, "#combinedResponseActions.panel"), true);
        assert.equal(await page.locator("#combinedResponseActions").evaluate(panel =>
          panel.getBoundingClientRect().top >= document.getElementById("rsvpCommentPanel").getBoundingClientRect().bottom), true,
          "the wide Review panel follows the comment");
      }
      assert.equal(await page.locator("#saveRsvp").isVisible(), false);
      assert.equal(await page.locator("#confirmFoodInterest").isVisible(), false);
      await choice(page, 0, "attending").check();
      if (narrow) {
        await nextRsvp.press("Enter");
        await page.locator("#rsvpValidation").waitFor();
        assert.equal(await focusIs(choice(page, 1, "attending")), true, "RSVP Next focuses the first unanswered session");
        assert.equal(await submit.isVisible(), false);
      }
      await choice(page, 1, "declined").check();
      await nextRsvp.press("Enter");
      assert.equal(await focusIs(foodYes), true, "RSVP Next goes to the visible Food question");
      if (narrow) {
        await nextFood.press("Enter");
        await page.locator("#foodResponseValidation").waitFor();
        assert.equal(await focusIs(foodYes), true, "Food Next stays at an unanswered Food question");
        assert.equal(await submit.isVisible(), false);
      }

      await foodNo.click();
      await nextFood.press("Enter");
      assert.equal(await focusIs(commentSummary), true, "Food Next goes to the optional comment and Review step");
      if (foodInterest) {
        await commentSummary.press("Enter");
        await commentInput.fill(reviewNote);
      }
      await review.click();
      await submit.waitFor();
      assert.equal(await review.isVisible(), false, "Review is replaced by Submit during confirmation");
      const assertNarrowReviewPlacement = async () => {
        const footer = page.locator("#guestResponseFooter");
        await footer.locator("#editRsvp + #confirmRsvp").waitFor();
        const buttons = await footer.locator("button:visible").evaluateAll(nodes => nodes.map(node => {
          const { left, right, bottom } = node.getBoundingClientRect();
          return { id: node.id, left, right, bottom };
        }));
        assert.deepEqual(buttons.map(({ id }) => id), ["editRsvp", "confirmRsvp"]);
        assert.ok(buttons[0].right <= buttons[1].left && Math.abs(buttons[0].bottom - buttons[1].bottom) <= 1,
          "phone Edit answers sits on the left and Submit on the right of the pinned footer");
        assert.equal(await footer.evaluate(node => getComputedStyle(node).position), "fixed");
      };
      const reviewPlacement = () => page.locator("#rsvpReview").evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const content = box("#rsvpReviewRows"), food = box("#foodInterestPreview");
        const submit = box("#confirmRsvp"), edit = box("#editRsvp");
        const bottom = Math.max(content.bottom, food.bottom);
        return {
          editRightDifference: edit.right - content.right,
          editBelowCards: edit.top >= bottom,
          submitLeftDifference: submit.left - content.left,
          submitBelowCards: submit.top >= bottom,
          baselineDifference: submit.bottom - edit.bottom,
        };
      });
      const assertWideReviewPlacement = async () => {
        await page.locator("#rsvpReviewAction #confirmRsvp + #editRsvp").waitFor();
        const placement = await reviewPlacement();
        assert.ok(Math.abs(placement.submitLeftDifference) <= 1 && placement.submitBelowCards,
          "wide Submit sits below the review cards on the left");
        assert.ok(Math.abs(placement.editRightDifference) <= 1 && placement.editBelowCards,
          "wide Edit answers sits below the review cards on the right");
        assert.ok(Math.abs(placement.baselineDifference) <= 1, "the wide actions align along their bottom edge");
      };
      if (narrow) {
        await assertNarrowReviewPlacement();
        const viewport = page.viewportSize();
        await page.setViewportSize({ ...viewport, width: 1160 });
        await assertWideReviewPlacement();
        await page.setViewportSize(viewport);
        await assertNarrowReviewPlacement();
      } else {
        await assertWideReviewPlacement();
      }
      assert.equal(await page.locator("#rsvpReviewRows li").count(), 2);
      assert.match(await page.locator("#rsvpReviewRows").innerText(), /not attending/i);
      assert.match(await preview.innerText(), /can’t bring food/i);
      if (foodInterest) assert.equal(await page.locator("#rsvpCommentPreview p").textContent(), reviewNote);
      else assert.equal(await page.locator("#rsvpCommentPreview").isHidden(), true, "a blank comment does not block review");
      assert.equal(calls(combinedAction, person).length, 0, "Review leaves both answers unsaved");
      assert.deepEqual(await fixture.responseState(person), { rsvp: "open", food: null, submissions: 0 });

      if (foodInterest) {
        failNextCombined = true;
        await submit.click();
        await error.waitFor();
        assert.deepEqual(await fixture.responseState(person), { rsvp: "open", food: null, submissions: 0 });
        await edit.click();
        assert.equal(await edit.isVisible(), false, "Edit answers is hidden on returning to the answers");
        assert.equal(await page.locator("#rsvpComment").inputValue(), reviewNote);
        assert.equal(await choice(page, 0, "attending").isChecked(), true);
        assert.equal(await choice(page, 1, "declined").isChecked(), true);
        assert.equal(await foodNo.getAttribute("aria-pressed"), "true");
        await selectedFood.click();
        await page.locator("#rsvpComment").fill(editedNote);
        await review.click();
        await submit.waitFor();
        assert.match(await preview.innerText(), /can bring food/i);

        dropNextResponse.add(combinedAction);
        await submit.click();
        await error.waitFor();
        assert.deepEqual(await fixture.responseState(person), { rsvp: "locked", food: true, submissions: 1 },
          "the combined response persisted even when its network result was lost");
      }

      await submit.click();
      await page.locator("#rsvpReviewHelp").filter({ hasText: "Your RSVP and food answer have been saved." }).waitFor();
      async function assertSavedFoodAnswer() {
        if (foodInterest) await assertReturningFood(page);
        else {
          await selectedFood.waitFor();
          assert.equal(await selectedFood.getAttribute("aria-pressed"), "true");
          assert.equal(await selectedFood.isDisabled(), true);
        }
      }
      await assertSavedFoodAnswer();
      assert.equal(await submit.isVisible(), false);
      assert.equal(await edit.isVisible(), false, "a submitted response has no Edit answers action");
      assert.equal(await page.locator("#rsvpReview").isVisible(), true);
      assert.deepEqual(await fixture.responseState(person), { rsvp: "locked", food: foodInterest, submissions: 1 });
      assert.equal(calls("submit_household_rsvp", person).length, 0);
      assert.equal(calls("set_household_food_interest", person).length, 0);

      const attempts = calls(combinedAction, person);
      assert.deepEqual(
        attempts.map(({ status, dropped }) => [status, dropped]),
        foodInterest ? [[503, false], [200, true], [200, false]] : [[200, false]],
      );
      const saved = attempts.at(-1).args;
      assert.match(saved.p_request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      const { p_responses: responses, ...submission } = saved;
      assert.deepEqual(submission, {
        p_code: person.code, p_request_id: saved.p_request_id,
        p_comment: foodInterest ? editedNote : null, p_food_interest: foodInterest,
      });
      assert.equal(responses.length, 2);
      assert.deepEqual(new Map(responses.map(reply => [reply.guest_id + "/" + reply.session_id, reply.status])),
        new Map([[person.guest + "/" + ceremony, "attending"], [person.guest + "/" + reception, "declined"]]));
      if (foodInterest) {
        assert.notEqual(attempts[0].args.p_request_id, saved.p_request_id, "changing the reviewed answers uses a new request ID");
        assert.deepEqual(attempts[1].args, saved, "retry after a lost response uses the identical payload and request ID");
      }

      await page.reload();
      await page.locator("#codeCard").waitFor();
      await page.locator("#inviteCode").fill(person.code);
      await page.locator("#codeForm button").click();
      await page.locator("#rsvpReview").waitFor();
      await assertSavedFoodAnswer();
      assert.equal(await review.isVisible(), false);
      assert.equal(await submit.isVisible(), false);
      assert.equal(await edit.isVisible(), false);
      if (saved.p_comment) assert.equal(await page.locator("#rsvpCommentPreview p").textContent(), saved.p_comment);
      else assert.equal(await page.locator("#rsvpCommentPreview").isHidden(), true);
    }

    const bringsFood = await guestPage(390);
    await checkCombinedResponse(bringsFood, bringingFood, true);
    await fixture.denyFoodAccess(bringingFood);
    await fixture.startNextVisit();
    const deniedFood = bringsFood.waitForResponse(response =>
      response.url() === origin + "/functions/v1/guest-gateway" &&
      response.request().postDataJSON()?.action === "get_household_food",
    );
    await openInvite(bringsFood, bringingFood);
    assert.equal(await (await deniedFood).json(), null);
    await bringsFood.locator("#rsvpReviewRows li").first().waitFor();
    assert.equal(await bringsFood.locator("#foodCard").isHidden(), true, "food access remains required after a saved Yes");
    assert.equal(await bringsFood.locator("#rsvpReviewTitle").isHidden(), true);
    assert.deepEqual(await fixture.responseState(bringingFood), { rsvp: "locked", food: true, submissions: 1 });
    await bringsFood.context().close();
    const noFood = await guestPage(1160);
    await checkCombinedResponse(noFood, decliningFood, false);
    assert.equal(await noFood.locator("#foodList").isHidden(), true, "a saved No never opens the menu");
    assert.equal(await noFood.locator("#confirmFood").isHidden(), true);

    await fixture.setPublished(false);
    await noFood.goto(invite(decliningFood));
    await noFood.locator("#guestStatus.warning").waitFor();
    assert.equal(await noFood.locator("#invitationCard").isVisible(), false);
    assert.deepEqual([...interceptedConfigs].sort(), ["/js/config.js", "/js/config.production.js"]);
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.bridgeErrors, []);
    console.log("PASS published guest journey: RSVP-only and food-only flows, atomic combined response, edited and idempotent retries, reload, deadline and late window, food choices after first submission, competing claims, confirmed return visits and unpublication.");
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
