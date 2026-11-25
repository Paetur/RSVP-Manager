const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const previews = process.env.FOOD_INTEREST_PREVIEW_DIR;
if (previews) fs.mkdirSync(previews, { recursive: true });
const { chromium, webkit } = require("playwright");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { server, mock, extra, stageExtra } =
  createFoodHarness("guest-food-wording");
const reportingState = () => ({
  // Main can refresh guest counts while the report filter is in use.
  calls: window.__wordingRpcCalls.filter(name => name !== "admin_guest_overview"),
  fixtures: JSON.stringify(window.__fixtures),
});
const additions = String.raw`
window.__invite.household.rsvp_state='locked';
fixtures.event_settings[0].rsvp_deadline='2027-03-27T23:30:00Z';fixtures.event_settings[0].timezone='Europe/Berlin';fixtures.event_settings[0].food_introduction={en:'Original explanation',de:'Erklärung'};
window.__replyRows=[{template_key:'food-interest-reply',language_code:'en',body:'Please return around {rsvp_deadline:+5}'},{template_key:'food-interest-reply-no-deadline',language_code:'en',body:'Please check later.'}];
for(const [n,interest] of [['yes',true],['no',false],['unanswered',null]]){const id='report-'+n;fixtures.households.push({id,household_name:'Report '+n,planning_group_id:'group_a',relation_group_id:cat2,parent_id:null,language:'en',food:true,food_interest:interest});fixtures.guests.push({id:'guest-'+n,household_id:id,first_name:'Guest',last_name:n});}
window.__foodAnswer=JSON.parse(localStorage.getItem('synthetic-food-answer')||'null');
window.__wordingRpcCalls=[];const wordingRpc=client.rpc;client.rpc=async(name,a)=>{window.__wordingRpcCalls.push(name);
 if(name==='admin_save_food_explanation'){if(window.__failCopy){window.__failCopy=false;return {error:{message:'Synthetic save failure'}};}fixtures.event_settings[0].food_introduction=a.p_introduction;window.__explanationWrites=(window.__explanationWrites||0)+1;return {data:null};}
 if(name==='admin_save_food_interest_reply'){window.__replyWrites=(window.__replyWrites||0)+1;window.__replyRows=[];for(const [template_key,values] of [['food-interest-reply',a.p_values],['food-interest-reply-no-deadline',a.p_fallback_values]])for(const [language_code,body] of Object.entries(values))if(body.trim())window.__replyRows.push({template_key,language_code,body});return {data:null};}
 const r=await wordingRpc(name,a);if(name==='admin_load_data')r.data.guestFoodReplies=window.__replyRows;
 if(name==='get_public_event_v2'){Object.assign(r.data.event,{food_introduction:fixtures.event_settings[0].food_introduction,rsvp_deadline:fixtures.event_settings[0].rsvp_deadline,timezone:'Europe/Berlin',food_interest_reply:{en:'Please return around {rsvp_deadline:+5}',de:'Bitte am {rsvp_deadline:+5} wiederkommen'},food_interest_reply_fallback:{en:'Please check later.',de:'Bitte später nachsehen.'}});}
 return r;
};
const wordingInvoke=client.functions.invoke;client.functions.invoke=async(name,request)=>{const result=await wordingInvoke(name,request);if(request.body.action==='set_household_food_interest'&&!result.error)localStorage.setItem('synthetic-food-answer',JSON.stringify(window.__foodAnswer));return result;};
`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await (process.env.RSVP_TEST_BROWSER === "webkit" ? webkit : chromium).launch();
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(9000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "Map fixture" }),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + "\n" + additions,
        }),
      );
      await page.goto(base + "/?ABCDEFGH");
      await page.locator("#foodCard:not(.hidden)").waitFor();
      assert.equal(await page.locator("#foodInterestReply").count(), 0);
      await page.evaluate(() => (window.__failInterest = true));
      await page
        .getByRole("button", { name: "I can bring food", exact: true })
        .click();
      assert.equal(await page.locator("#foodInterestReply").count(), 0);
      const confirm = page.locator("#confirmFoodInterest");
      await confirm.click();
      await page.locator("#foodInterestStatus.error").waitFor();
      assert.equal(await page.locator("#foodInterestReply").count(), 0);
      await confirm.click();
      await page.locator("#foodInterestReply").waitFor();
      assert.equal(
        await page.locator("#foodInterestReply").textContent(),
        "Please return around 2 April 2027",
      );
      assert.equal(await page.locator("#foodList").isHidden(), true);
      if (previews)
        await page
          .locator("#foodCard")
          .screenshot({
            path: path.join(previews, "guest-reply-" + width + ".png"),
          });
      await page.goto(base + "/?ABCDEFGH");
      await page.locator("#foodInterestReply").waitFor();
      assert.equal(
        await page.locator("#foodInterestReply").textContent(),
        "Please return around 2 April 2027",
      );
      await page.locator("#languageSwitcher [data-language=de]").click();
      await page.waitForFunction(() =>
        document
          .getElementById("foodInterestReply")
          ?.textContent.startsWith("Bitte am"),
      );
      assert.equal(
        await page.locator("#foodInterestReply").textContent(),
        "Bitte am 2. April 2027 wiederkommen",
      );
      await page.locator("#languageSwitcher [data-language=en]").click();
      assert.equal(await page.getByRole("button", { name: "I can’t bring food", exact: true }).isDisabled(), true);
      assert.equal(await confirm.count(), 0);
      await page.goto(base + "/admin/");
      await page.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      assert.ok(
        (await page.locator("#statsGrid").textContent()).includes(
          "Food interest",
        ),
      );
      const rows = page.locator("#inviteRows [data-invite-household]");
      const rowIds = () => rows.evaluateAll(nodes => nodes.map(node => node.dataset.inviteHousehold));
      const allHouseholdIds = await rowIds();
      const beforeFilters = await page.evaluate(reportingState);
      const answers = new Map(JSON.parse(beforeFilters.fixtures).households.map(household =>
        [household.id, household.food_interest ?? null]));
      for (const [state, answer] of [["yes", true], ["no", false], ["unanswered", null]]) {
        const filter = page.locator('[data-invite-food-filter="' + state + '"]');
        await filter.click();
        assert.equal(await filter.getAttribute("aria-pressed"), "true");
        assert.equal(await rows.count(), Number(await filter.locator("b").innerText()));
        assert.ok((await rows.count()) > 0);
        assert.deepEqual(await rowIds(), allHouseholdIds.filter(id => answers.get(id) === answer));
      }
      await page.locator('[data-invite-food-filter="unanswered"]').click();
      assert.deepEqual(await rowIds(), allHouseholdIds, "repeating the Food option clears that filter");
      assert.deepEqual(await page.locator("[data-invite-food-filter]").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-pressed"))), ["false", "false", "false"]);
      assert.deepEqual(await page.evaluate(reportingState), beforeFilters,
        "report filters leave application data and other RPCs unchanged");
      if (previews)
        await page
          .locator("[data-panel=invites]")
          .screenshot({
            path: path.join(previews, "interest-overview-" + width + ".png"),
          });
      await page.locator("[data-tab=events]").click();
      await openBox(page, "event-features");
      assert.equal(
        await page.locator("#eventFeaturesHost textarea").count(),
        0,
      );
      await page.locator("#contentLanguagesToggle").click();
      await page
        .locator("#contentTranslationTabs [data-translation-tab=guests]")
        .click();
      let form = await openBox(page, "translations:food-explanation");
      const en = form.locator("[data-language-code=en] textarea");
      assert.equal(await en.inputValue(), "Original explanation");
      await en.fill("Temporary");
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      form = await openBox(page, "translations:food-explanation");
      assert.equal(await en.inputValue(), "Original explanation");
      const replyCard = await openBox(page, "translations:food-interest-reply");
      await replyCard.locator("[data-language-code=en] textarea").first().fill("Independent reply draft");
      await en.fill("Updated explanation");
      await page.evaluate(() => (window.__failCopy = true));
      await form.locator("button[type=submit]").click();
      await form.locator(".form-feedback[data-state=error]").waitFor();
      assert.equal(await en.inputValue(), "Updated explanation");
      await form.locator("button[type=submit]").click();
      await page.waitForFunction(() => window.__explanationWrites === 1);
      await page.waitForFunction(() => document.querySelector('[data-translation-record="food-explanation"] .local-editor-summary')?.textContent.includes('Updated explanation'));
      assert.equal(await replyCard.locator("[data-language-code=en] textarea").first().inputValue(), "Independent reply draft", "saving one guest card retains the other draft");
      await replyCard.getByRole("button", {name:"Cancel",exact:true}).click();
      form = await openBox(page, "translations:food-interest-reply");
      const reply = form.locator("[data-language-code=en] textarea").first();
      if (previews)
        await page
          .locator("#translationEditor")
          .screenshot({
            path: path.join(previews, "reply-settings-" + width + ".png"),
          });
      assert.equal(
        await reply.inputValue(),
        "Please return around {rsvp_deadline:+5}",
      );
      assert.equal(
        await form.locator("[data-language-code=en] output").textContent(),
        "Please return around 2 April 2027",
      );
      await reply.fill("{unsupported}");
      await form.locator("button[type=submit]").click();
      await form.locator(".form-feedback[data-state=error]").waitFor();
      assert.equal(await page.evaluate(() => window.__replyWrites || 0), 0);
      await reply.fill("Come back {rsvp_deadline:+5}");
      await form.locator("button[type=submit]").click();
      await page.waitForFunction(() => window.__replyWrites === 1);
      assert.equal(
        await page.evaluate(
          () => window.__fixtures.event_settings[0].is_published,
        ),
        false,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS food wording UI: persisted Yes/reopen and language dates, hidden menu, failed replies, reporting filters/counts, moved explanation, Cancel/failure/retry, validated reply previews/save and unpublished state at 390/1160px.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
