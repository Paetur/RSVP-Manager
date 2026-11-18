const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("playwright");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { selectContentTranslation } = require("./helpers/language-ui.cjs");
const { server, mock, extra } = createFoodHarness("guest-titles-placeholders");
const additions = `
window.__invite.guests[0].courtesy_title='Son';
window.__invite.guests.push({id:'daughter',first_name:'Emma',last_name:'Example',courtesy_title:'Daughter'});
window.__invite.invitations.push({...window.__invite.invitations[0],guest_id:'daughter'});
fixtures.event_settings[0].guest_title_visibility={en:true,de:true,fo:false};
fixtures.event_settings[0].guest_interface_modes={phone:{guest_title_visibility:{de:true}}};
fixtures.event_locations=Array.from({length:5},(_,i)=>({...fixtures.event_locations[0],id:'language-venue-'+i,name:'Language venue '+i,sort_order:i}));
fixtures.event_sessions=Array.from({length:5},(_,i)=>({...fixtures.event_sessions[0],id:'language-session-'+i,name:'Language session '+i,sort_order:i}));
const titleRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='admin_save_guest_interface'){if(window.__failTitles){window.__failTitles=false;return {error:{message:'Synthetic title save failure'}};}fixtures.event_settings[0].guest_interface_modes[args.p_mode]=args.p_values;window.__titleSaves=(window.__titleSaves||0)+1;return {data:null};}
 const r=await titleRpc(name,args);
 if(name==='get_public_event_v2'){r.data.event.guest_title_visibility=fixtures.event_settings[0].guest_title_visibility;r.data.event.guest_interface_modes=fixtures.event_settings[0].guest_interface_modes;r.data.locations[0].welcome_en='We look forward to celebrating our day with you in Germany.';}
 return r;
};`;
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }),
        errors = [];
      page.setDefaultTimeout(9000);
      page.on("pageerror", (e) => errors.push(e.message));
      const resourceFailures = [];
      page.on("requestfailed", (req) =>
        resourceFailures.push([
          new URL(req.url()).pathname,
          req.failure()?.errorText,
        ]),
      );
      page.on("response", (res) => {
        if (res.status() >= 400)
          resourceFailures.push([new URL(res.url()).pathname, res.status()]);
      });
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + additions,
        }),
      );
      const base =
        process.env.RSVP_INSTALLED_SITE ||
        "http://127.0.0.1:" + server.address().port;
      // Isolate configuration as well as SDK data; never contact the installed backend.
      if (process.env.RSVP_INSTALLED_SITE)
        await page.route("**/js/config.js?*", (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body: 'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};',
          }),
        );
      let productionRequests = 0;
      await page.route(/\/(rest|auth|functions)\/v1\//, (route) => {
        productionRequests++;
        return route.abort();
      });
      if (process.env.RSVP_INSTALLED_SITE)
        await page.route(base + "/**", async (route) => {
          if (route.request().resourceType() !== "document")
            return route.fallback();
          const response = await route.fetch();
          await route.fulfill({
            response,
            body: (await response.text()).replace(/ integrity="[^"]+"/g, ""),
          });
        });
      await page.goto(base + "/?ABCDEFGH");
      await page
        .locator(".rsvp-person-name")
        .first()
        .waitFor()
        .catch(async (e) => {
          console.error(
            JSON.stringify({
              errors,
              resourceFailures,
              productionRequests,
              diagnostic: await page.evaluate(() => ({
                mockLoaded: typeof window.__invite,
                coreLoaded: !!window.RSVP,
                status: document.getElementById("guestStatus")?.textContent,
                heading: document.title,
              })),
            }),
          );
          throw e;
        });
      await page.locator('[data-language="de"]').click();
      await page.waitForFunction(() =>
        document
          .querySelectorAll(".guest-courtesy-title")[1]
          ?.textContent.includes("Tochter"),
      );
      assert.match(
        await page.locator(".guest-courtesy-title").last().textContent(),
        /Tochter/,
      );
      assert.equal(
        await page.locator(".guest-courtesy-title").first().isVisible(),
        true,
        "configured German titles are visible on phone and wide layouts",
      );
      await page.locator('[data-language="fo"]').click();
      await page.waitForFunction(
        () => document.querySelectorAll(".guest-courtesy-title").length === 0,
      );
      assert.equal(
        await page.locator(".guest-courtesy-title").count(),
        0,
        "language-specific hiding",
      );
      await page.locator('[data-language="en"]').click();
      await page.waitForFunction((wide) => {
        const title = document.querySelector(".guest-courtesy-title");
        return wide ? title?.textContent.trim() === "Son" : !title;
      }, width > 700);
      const row = page.locator(".rsvp-person-row").first();
      await row.locator('input[value="attending"]').check();
      const chosen = row.locator(".radio-pill").first();
      const before = await chosen.evaluate((n) => ({
        tick: getComputedStyle(n, "::before").content,
        color: getComputedStyle(n).backgroundColor,
      }));
      assert.match(before.tick, /✓/);
      const centered = await page
        .locator(".venue-welcome")
        .first()
        .evaluate((n) => {
          const options = n
              .closest(".rsvp-session")
              .querySelector(".response-options")
              .getBoundingClientRect(),
            r = n.getBoundingClientRect(),
            s = getComputedStyle(n);
          return {
            textAlign: s.textAlign,
            offset: Math.abs(
              (r.left + parseFloat(s.paddingLeft) + r.right) / 2 -
                (options.left + options.right) / 2,
            ),
          };
        });
      assert.equal(centered.textAlign, "center");
      assert(centered.offset < 5, JSON.stringify({ width, ...centered }));
      if (process.env.RSVP_GUEST_ALBUM_PREVIEW_DIR) {
        fs.mkdirSync(process.env.RSVP_GUEST_ALBUM_PREVIEW_DIR, {
          recursive: true,
        });
        await page.screenshot({
          path:
            process.env.RSVP_GUEST_ALBUM_PREVIEW_DIR + `/guest-${width}.png`,
          fullPage: true,
        });
      }
      await page.goto(base + "/admin/");
      await page.waitForFunction(
        () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
      );
      await page.locator("#settingsToggle").click();
      await page
        .getByRole("tab", { name: "Placeholders", exact: true })
        .click();
      await page
        .getByRole("searchbox", { name: "Search placeholders" })
        .fill("deadline");
      assert.equal(await page.locator(".placeholder-reference-row").count(), 4);
      await page.locator("#contentLanguagesToggle").click();
      assert.deepEqual(await page.locator("#contentTranslationTabs [data-translation-tab]").evaluateAll(nodes => nodes.map(n => n.dataset.translationTab)), ["welcome","venue","session","guests","food"]);
      assert.equal(await page.locator('[data-translation-record="welcome"]').evaluate(n => n.open), true, "welcome expanded by default");
      for (const category of ["venue","session"]) {
        await page.locator(`#contentTranslationTabs [data-translation-tab="${category}"]`).click();
        assert.deepEqual(await page.locator("#foodTranslationGrid [data-translation-record]").evaluateAll(nodes => nodes.map(n => n.open)), [true,true,true,false,false], "first three " + category + " cards expanded");
      }
      await page.locator('#contentTranslationTabs [data-translation-tab="venue"]').click();
      await page.locator('#foodTranslationGrid .translation-record-card').first().locator('summary').click();
      await page.locator('#contentTranslationTabs [data-translation-tab="session"]').click();
      await page.locator('#contentTranslationTabs [data-translation-tab="venue"]').click();
      assert.equal(await page.locator('#foodTranslationGrid .translation-record-card').first().evaluate(n=>n.open), false, 'manual collapse survives navigation');
      await page.locator('#contentTranslationTabs [data-translation-tab="guests"]').click();
      for (const key of ['food-explanation','food-interest-reply']) assert.equal(await page.locator(`[data-translation-record="${key}"]`).evaluate(n=>n.open),true);
      assert.equal(await page.locator('[data-translation-record="guest-titles"]').count(),0);
      assert.equal(await page.locator('#foodTranslationTabs').isVisible(),false,'guest wording cards share one view');
      await selectContentTranslation(page, "guests");

      await page.locator('#settingsToggle').click();
      await page.locator('[data-settings-tab="interface"]').click();
      const mode = width > 700 ? "wide" : "phone";
      await page.locator(`#guest-appearance-tab-${mode}`).click();
      const card = page.locator(`#guest-appearance-mode-${mode}`);
      await openBox(page, "guest-customization:" + mode);
      const germanTitle = card.getByRole("checkbox", { name: / · de$/ });
      await germanTitle.uncheck();
      await page.evaluate(() => {
        window.__failTitles = true;
      });
      await card.getByRole("button", { name: "Save", exact: true }).click();
      await card.getByText("Synthetic title save failure", { exact: true }).waitFor();
      assert.equal(
        await germanTitle.isChecked(),
        false,
      );
      await card.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__titleSaves === 1);
      assert.equal(
        await page.evaluate(
          (mode) => fixtures.event_settings[0].guest_interface_modes[mode].guest_title_visibility.de,
          mode,
        ),
        false,
      );
      assert.equal(
        await page.evaluate(() => fixtures.event_settings[0].is_published),
        false,
      );
      assert.equal(
        productionRequests,
        0,
        "synthetic installed-site acceptance makes no production API requests",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS guest titles/placeholders: EN/DE/FO, phone hiding, centered welcome, selected tick, reference search and failed-save/retry without publication.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
