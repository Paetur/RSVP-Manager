const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { selectWorkTab } = require("./helpers/language-ui.cjs");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra } = createFoodHarness("household-sessions");
const seed = `
window.__sessionHousehold=fixtures.households.find(h=>!h.archived_at&&fixtures.guests.some(g=>g.household_id===h.id&&!g.archived_at)).id;
fixtures.households.find(h=>h.id===window.__sessionHousehold).rsvp_state='open';
fixtures.rsvp_submissions=fixtures.rsvp_submissions.filter(s=>s.household_id!==window.__sessionHousehold);
const sessionHouseholdRpc=client.rpc;client.rpc=async(name,args)=>{
 if((name==='admin_save_household'||name==='admin_save_household_with_food')&&args.p_values.session_assignments){
  if(window.__failSessionHousehold){window.__failSessionHousehold=false;return {error:{message:'Synthetic combined save failure'}};}
  window.__sessionHouseholdSave=args;
  for(const a of args.p_values.session_assignments){if(a.guest_id){fixtures.guest_session_overrides=fixtures.guest_session_overrides.filter(x=>x.guest_id!==a.guest_id||x.session_id!==a.session_id);if(a.is_invited!==null)fixtures.guest_session_overrides.push(a);}else{fixtures.household_session_defaults=fixtures.household_session_defaults.filter(x=>x.household_id!==args.p_id||x.session_id!==a.session_id);fixtures.household_session_defaults.push({household_id:args.p_id,session_id:a.session_id,is_invited:a.is_invited});}}
 }
 return sessionHouseholdRpc(name,args);
};`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } }),
        errors = [];
      page.setDefaultTimeout(9000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + seed,
        }),
      );
      const base = process.env.RSVP_INSTALLED_SITE || "http://127.0.0.1:" + server.address().port;
      let productionRequests=0;
      if (process.env.RSVP_INSTALLED_SITE) {
        await page.route("**/js/config.js?*", r=>r.fulfill({contentType:"text/javascript",body:'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};'}));
        await page.route(/\/(rest|auth|functions)\/v1\//, r=>{productionRequests++;return r.abort()});
        await page.route(base+"/**",async r=>{if(r.request().resourceType()!=="document")return r.fallback();const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace(/ integrity="[^"]+"/g,"")})});
      }
      await page.goto(base + "/admin/");
      await page.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      const id = await page.evaluate(() => window.__sessionHousehold);
      await selectWorkTab(page, "households");
      await page
        .locator("#householdRows details")
        .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
      const edit = page.locator('[data-tree-key="household:' + id + '"] > summary')
        .getByRole("button", { name: /^Edit household:/ });
      await edit.click();
      const form = page.locator("#household-form-" + id),
        checks = form.locator(".household-session-choices input");
      assert.ok((await checks.count()) > 0);
      const initial = await checks.first().isChecked();
      await checks.first().setChecked(!initial);
      const exceptions = form.locator(".household-session-exceptions");
      if (!(await exceptions.evaluate((n) => n.open)))
        await exceptions.locator("summary").click();
      const override = exceptions.locator("select").first();
      await override.selectOption("true");
      await page.evaluate(() => {
        window.__failSessionHousehold = true;
      });
      await page
        .locator('button[type=submit][form="household-form-' + id + '"]')
        .click();
      await page
        .locator(
          '[data-household-detail-key="household-details:' +
            id +
            '"] [data-state=error]',
        )
        .waitFor();
      assert.equal(await checks.first().isChecked(), !initial);
      assert.equal(await override.inputValue(), "true");
      await page
        .locator('button[type=submit][form="household-form-' + id + '"]')
        .click();
      await page.waitForFunction(() => !!window.__sessionHouseholdSave);
      const sent = await page.evaluate(
        () => window.__sessionHouseholdSave.p_values,
      );
      assert(
        sent.session_assignments.some(
          (a) => a.guest_id && a.is_invited === true,
        ),
      );
      assert(
        sent.session_assignments.some(
          (a) => a.guest_id === null && a.is_invited === !initial,
        ),
      );
      assert(sent.session_assignments_expected);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      await page.evaluate((id) => {
        fixtures.households.find((h) => h.id === id).rsvp_state = "locked";
      }, id);
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      await page
        .locator("#householdRows details")
        .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
      await edit.click();
      assert.equal(
        await form
          .locator(".household-session-choices input:not(:disabled)")
          .count(),
        0,
      );
      await selectWorkTab(page, "invites");
      const invite = page.locator('[data-invite-household="' + id + '"]');
      await invite.locator(":scope > summary").click();
      assert.equal(await invite.locator('[id^="invite-sessions-"]').count(), 0);
      assert.equal(productionRequests,0,"installed-site fixtures make no production API requests");
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.close();
    }
    console.log(
      "PASS Household details session checkboxes, guest exceptions, failed-save/retry, combined payload, history lock and removed Invites section at 390/1160px.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
