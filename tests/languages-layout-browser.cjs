// Actual administrator controllers, synthetic records and APIs only.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const artifactDir = process.env.RSVP_TEST_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-languages-layout-"));
fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { server, mock, extra } = createFoodHarness("languages-layout");
const additions = `
fixtures.event_locations=[{id:'venue-a',name:'First hall',welcome_en:'Welcome',notes:'Front door'},{id:'venue-b',name:'Garden hall'}];
fixtures.event_content.push({content_key:'venue:venue-b:name',language_code:'de',content_value:'Gartenhaus'});
const layoutRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='admin_save_translations'){
  window.__translationWrites=(window.__translationWrites||0)+1;
  if(window.__failTranslation){window.__failTranslation=false;return {error:{message:'Synthetic translation failure'}};}
 }
 const result=await layoutRpc(name,args);
 if(name==='admin_load_data'){
  result.data.guestFoodReplies=[{template_key:'food-interest-reply',language_code:'en',body:'Return {rsvp_deadline:+5}'}];
  result.data.invitationTemplates=[{id:'99999999-1111-4111-8111-111111111111',name:'Synthetic email',channels:['email'],versions:{en:{subject:'Invitation',body:'{invitation_link}',options:['subject','message']}}}];
 }
 return result;
};
`;
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(9000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**/supabase.min.js", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: mock + extra + additions,
        }),
      );
      await page.route("**/js/config*.js*", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: "window.RSVP_CONFIG={supabaseUrl:'https://synthetic.invalid',supabaseKey:'sb_publishable_synthetic'};",
        }),
      );
      await page.goto(base + "/admin/");
      await page.locator("[data-tab=invites]").click();
      await page.locator("#statsGrid .stat-card-compact").first().waitFor();
      assert.equal(
        await page.locator("#statsGrid .stat-card-compact").count(),
        4,
      );
      assert.deepEqual(
        await page
          .locator("#inviteAttendanceCounts ~ .stat-people-guests dt")
          .allTextContents(),
        ["Adults", "Children"],
      );
      if (width === 1160)
        await page
          .locator("#statsGrid")
          .screenshot({ path: path.join(artifactDir, "statistics-wide.png") });
      await page.locator("#contentLanguagesToggle").click();
      const tab = (name) =>
        page.locator(
          "#contentTranslationTabs [data-translation-tab=" + name + "]",
        );
      await tab("venue").click();
      const grid = page.locator("#foodTranslationGrid");
      assert.equal(await grid.locator(".translation-record-card").count(), 2);
      assert.equal(await page.locator("#translationSearch").isVisible(), false);
      await page.locator("#translationSearchToggle").click();
      await page.locator("#translationSearch").fill("Gartenhaus");
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".translation-record-card").length === 1,
      );
      assert.match(await grid.textContent(), /Garden hall/);
      await page.locator("#translationSearchClose").click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".translation-record-card").length === 2,
      );
      let first = await openBox(page, "translations:venue:venue-a:name");
      assert.equal(await first.locator("[data-language-code]").count(), 3);
      await first
        .getByLabel("Name · en", { exact: true })
        .fill("Unsaved first hall");
      let second = await openBox(page, "translations:venue:venue-b:name");
      await second
        .getByLabel("Name · en", { exact: true })
        .fill("Saved garden hall");
      await second.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(
        () =>
          window.__translationWrites === 1 &&
          !document.querySelector("#foodTranslationGrid form[aria-busy]"),
      );
      first = await openBox(page, "translations:venue:venue-a:name");
      assert.equal(
        await first.getByLabel("Name · en", { exact: true }).inputValue(),
        "Unsaved first hall",
        "saving another record preserves this draft",
      );
      page.once("dialog", (dialog) => dialog.dismiss());
      await tab("session").click();
      assert.equal(
        await first.getByLabel("Name · en", { exact: true }).inputValue(),
        "Unsaved first hall",
        "declined discard retains input and section",
      );
      await page.evaluate(() => {
        window.__failTranslation = true;
      });
      await first.getByRole("button", { name: "Save", exact: true }).click();
      await first
        .getByText("Synthetic translation failure", { exact: false })
        .first()
        .waitFor();
      assert.equal(
        await first.getByLabel("Name · en", { exact: true }).inputValue(),
        "Unsaved first hall",
      );
      await first.getByRole("button", { name: "Cancel", exact: true }).click();
      await tab("food").click();
      assert.equal(await grid.locator(".translation-record-card").count(), 4);
      assert.equal(
        await grid.getByLabel("Food item", { exact: true }).count(),
        0,
      );
      await page
        .locator("#foodTranslationTabs [data-translation-tab=food-types]")
        .click();
      assert((await grid.locator(".translation-record-card").count()) >= 6);
      await tab("guests").click();
      const reply = await openBox(page, "translations:food-interest-reply");
      assert.equal(
        await reply.locator(".placeholder-help-toggle").count(),
        6,
        "shared tokens available on both reply fields",
      );
      const input = reply.locator("[data-language-code=en] textarea").first();
      await input.fill("Please return ");
      await reply
        .locator("[data-language-code=en] .placeholder-help-toggle").first()
        .click();
      await reply
        .locator("[data-language-code=en] .placeholder-help").first()
        .getByRole("button", {
          name: "Insert {rsvp_deadline:+5}",
          exact: true,
        })
        .click();
      assert.equal(
        await input.inputValue(),
        "Please return {rsvp_deadline:+5}",
      );
      await input.press("Escape");
      assert.equal(await reply.locator("[data-language-code=en] .placeholder-help").first().isVisible(), false);
      assert.equal(
        await reply
          .getByRole("button", { name: "Save", exact: true })
          .isEnabled(),
        true,
      );
      await reply.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.locator("#settingsToggle").click();
      await page.locator("[data-settings-tab=templates]").click();
      const template = await openBox(page, "invitation-template:99999999-1111-4111-8111-111111111111");
      assert.equal(
        await template.locator(".placeholder-help-toggle:visible").count(),
        2,
      );
      const body = template.getByLabel("Message text", { exact: true });
      await body.fill("Link: ");
      await body.evaluate((node) => node.setSelectionRange(0, 4));
      await body.dispatchEvent("select");
      await template.locator(".placeholder-help-toggle:visible").last().click();
      await template
        .locator(".placeholder-help:visible")
        .getByRole("button", { name: "Insert {invitation_link}", exact: true })
        .click();
      assert.equal(await body.inputValue(), "{invitation_link}: ");
      await template
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      const { openWordingEditor } = require("./helpers/language-ui.cjs");
      const aliases = require("../locales/aliases.json");
      const wording = await openWordingEditor(
        page,
        "en",
        aliases["Quantity for {item}"],
      );
      const phraseHelp = wording.locator(".placeholder-help");
      assert.deepEqual(
        await phraseHelp.locator("code").allTextContents(),
        ["{item}"],
        "shared phrase offers only its original tokens",
      );
      await wording
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await page.locator("#contentLanguagesToggle").click();
      await tab("venue").click();
      first = await openBox(page, "translations:venue:venue-a:name");
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "no horizontal overflow at " + width + " " + theme,
        );
        const pencil = page.locator(
          "[data-local-edit='translations:venue:venue-b:name']",
        );
        const header = pencil.locator("..");
        const bounds = await pencil.boundingBox(),
          parent = await header.boundingBox();
        assert(
          bounds.x >= parent.x &&
            bounds.x + bounds.width <= parent.x + parent.width + 1,
        );
      }
      if (width === 1160)
        await page
          .locator("#translationEditor")
          .screenshot({ path: "/tmp/implemented-language-cards.png" });
      assert.equal(
        await page.evaluate(
          () => window.__fixtures.event_settings[0].is_published,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS Languages/compact statistics: phone/desktop light/dark, translated search, per-record cards, independent drafts, failure/Cancel, contextual token insertion, template selection replacement, unpublished state.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
