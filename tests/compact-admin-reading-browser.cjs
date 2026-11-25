// Actual public UI assets and synthetic records/account only. No real API writes.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { selectInterfaceSettingsTab } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("compact-admin-reading");
const aliases = JSON.parse(fs.readFileSync("locales/aliases.json", "utf8"));
const catalogs = Object.fromEntries(["en", "de", "fo"].map(language => [language,
  Object.fromEntries(["interface", "food", "types"].map(category => [category, JSON.parse(fs.readFileSync("locales/" + language + "/" + category + ".json", "utf8"))]))]));
const translated = (source, language) => {
  const key = aliases[source];
  return key ? key.split(".").reduce((value, part) => value?.[part], catalogs[language]) || source : source;
};
const seed = `
Object.assign(fixtures.event_settings[0],{event_time:'14:00:00',organizer_name:'Synthetic organizer',organizer_email:'organizer@example.invalid',organizer_phone:'+12025550123',food_deadline:'2027-02-10T00:00:00Z',rsvp_deadline:'2027-02-01T00:00:00Z',timezone:'UTC',food_stage:'interest'});
const compactFrom=client.from;client.from=name=>{const q=compactFrom(name);if(name==='event_settings')q.upsert=async values=>{Object.assign(fixtures.event_settings[0],values);window.__compactEventWrites=(window.__compactEventWrites||0)+1;return {data:null,error:null};};return q;};
client.auth.updateUser=async values=>{Object.assign(window.__personalProfile,values.data);return {data:{user:{id:h1,email:'test-admin@example.invalid',user_metadata:window.__personalProfile}},error:null};};
`;
async function paired(list) {
  const geometry = await list.evaluate(node => {
    const rows = [...node.querySelectorAll(":scope > dt")].map(label => {
      const left = label.getBoundingClientRect(), right = label.nextElementSibling.getBoundingClientRect();
      return Math.abs(left.top - right.top) < 1 && right.left > left.left && right.right <= node.getBoundingClientRect().right + 1;
    });
    return { columns: getComputedStyle(node).gridTemplateColumns.split(" ").length, pairs: rows.every(Boolean) };
  });
  assert.equal(geometry.columns, 2, "saved labels and values keep two columns");
  assert.equal(geometry.pairs, true, "each saved value remains beside its label");
}
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    for (const language of ["en", "de", "fo"]) for (const width of [320, 390, 430, 1160]) for (const theme of ["light", "dark"]) {
      const tr = source => translated(source, language);
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ theme, language }) => {
        localStorage.setItem("rsvp-interface-language", language);
        window.__personalProfile = { rsvp_interface_language: language, rsvp_interface_appearance: theme,
          rsvp_interface_time_format: "24", rsvp_interface_button_hover: "toolbar", rsvp_invites_grouped: true };
      }, { theme, language });
      await routeSyntheticSdk(page, mock + "\n" + extra + "\n" + seed);
      await page.route("**/version.json", route => route.fulfill({ contentType: "application/json", body: '{"version":"0.9.0-alpha.7"}' }));
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(() => document.querySelector("#inviteOverviewCounts .invite-stat-row"));
      await page.locator("#adminVersion").filter({ hasText: "v0.9.0-alpha.7" }).waitFor({ state: "attached" });
      assert.equal(await page.locator("#adminVersion").isVisible(), width > 700, "version appears only at desktop widths");
      await page.locator('[data-tab="events"]').click();
      const event = page.locator('[data-reading-for="event-settings"]');
      assert.deepEqual(await event.locator(":scope > .compact-read-grid > dt").allTextContents(), ["Event", "When", "RSVP by", "Timezone", "Organizer", "Food deadline"].map(tr));
      assert.match(await event.innerText(), /2027.*14[:.]00|14[:.]00.*2027/);
      assert.equal(await event.locator(".compact-contact-details").getAttribute("open"), null);
      if (width <= 700) assert.ok(await event.locator(".compact-contact-details > summary").evaluate(node => node.getBoundingClientRect().height) >= 44, "contact disclosure keeps a 44px phone target");
      assert.equal(await event.getByText("organizer@example.invalid", { exact: true }).isVisible(), false);
      await paired(event.locator(":scope > .compact-read-grid"));
      await event.locator(".compact-contact-details > summary").click();
      assert.equal(await event.getByText("organizer@example.invalid", { exact: true }).isVisible(), true);
      await paired(event.locator(".compact-contact-details > .compact-read-grid"));
      const planning = page.locator('[data-editor-key="event-planning"] .local-editor-summary');
      assert.deepEqual(await planning.locator(".compact-read-grid > dt").allTextContents(), ["Event type", "Groups", "Labels"].map(tr));
      assert.match(await planning.innerText(), /Example group A · Example group B/);
      await paired(planning.locator(".compact-read-grid"));
      const features = page.locator('[data-editor-key="event-features"] .local-editor-summary');
      assert.deepEqual(await features.locator(".compact-read-grid > dt").allTextContents(), ["Food", "Other tasks"].map(tr));
      await paired(features.locator(".compact-read-grid"));
      const card = page.locator('[data-settings-card="event-settings"]');
      const oldWidth = await card.evaluate(node => node.getBoundingClientRect().width);
      await page.locator('[data-record-pencil="event-settings"]').click();
      const eventForm = page.locator("#eventSettingsForm");
      assert.equal(await eventForm.locator('input[data-clock-part][type="text"]').first().inputValue(), "14:00");
      const timezone = eventForm.locator("select#settingTimezone");
      assert.equal(await timezone.inputValue(), "UTC");
      await timezone.selectOption("Europe/Berlin");
      assert.equal(await eventForm.locator("#settingDeadline").inputValue(), "2027-02-01T01:00");
      await page.locator("#settingName").fill("Synthetic edited celebration");
      if (width >= 1100) assert.ok(await card.evaluate(node => node.getBoundingClientRect().width) > oldWidth * 1.7, "open event editor still uses full desktop row");

      // Saving another personal preference does not discard the event draft.
      await page.locator("#settingsToggle").click();
      await selectInterfaceSettingsTab(page);
      const personal = page.locator('[data-editor-key="personal-preferences"] .local-editor-summary');
      const groups = personal.locator(".interface-preference-group");
      assert.deepEqual(await groups.locator("h3").allTextContents(), ["Appearance", "Date and time"].map(tr));
      assert.deepEqual(await groups.nth(0).locator("dt").allTextContents(), ["Theme", "Language", "Button hover appearance"].map(tr));
      assert.deepEqual(await groups.nth(1).locator("dt").allTextContents(), ["Date format", "Time format", "Example"].map(tr));
      for (const group of await groups.all()) await paired(group.locator(".compact-read-grid"));
      await selectInterfaceSettingsTab(page, "invites");
      const invites = page.locator('[data-editor-key="invites-appearance"] .local-editor-summary .compact-read-grid');
      assert.deepEqual((await invites.locator("dt").allTextContents()).slice(0, 3),
        ["Group by", "Narrow screens (below 1024 px)", "Wide screens (1024 px and wider)"].map(tr));
      await paired(invites);
      await selectInterfaceSettingsTab(page);
      await openBox(page, "personal-preferences");
      const alternate = theme === "light" ? "dark" : "light";
      await page.locator('[data-preference-choices="appearance"] [data-preference-choice="' + alternate + '"]').click();
      await page.locator("#savePersonalPreferences").click();
      await page.waitForFunction(() => document.getElementById("personalPreferencesForm").getAttribute("aria-busy") !== "true");
      assert.equal(await groups.nth(0).locator("dd").first().innerText(), tr(alternate === "light" ? "Light" : "Dark"));
      await openBox(page, "personal-preferences");
      await page.locator("#interfaceDateTimeTab").click();
      await page.locator('[data-preference-choices="time"] [data-preference-choice="12"]').click();
      await page.locator("#cancelPersonalPreferences").click();
      assert.equal(await page.locator("#timeFormat").inputValue(), "24", "Cancel restores the saved personal preference");
      await page.locator("#mainSectionToggle").click();
      await page.locator('[data-tab="events"]').click();
      assert.equal(await page.locator("#settingName").inputValue(), "Synthetic edited celebration", "other preference save retains the event draft");
      await page.locator("#eventSettingsForm").getByRole("button", { name: tr("Save"), exact: true }).click();
      await page.waitForFunction(() => window.__compactEventWrites === 1);
      await event.getByText("Synthetic edited celebration", { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => {
        const { timezone, rsvp_deadline, food_deadline } = fixtures.event_settings[0];
        return { timezone, rsvp_deadline, food_deadline };
      }), { timezone: "Europe/Berlin", rsvp_deadline: "2027-02-01T00:00:00Z", food_deadline: "2027-02-10T00:00:00Z" });
      assert.equal(await event.locator(".compact-contact-details").evaluate(node => node.open), true, "contact disclosure remains open through a save/reload");
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
      const overflow = await page.evaluate(() => ({ fits: document.documentElement.scrollWidth <= innerWidth + 1,
        nodes: [...document.querySelectorAll("body *")].filter(node => node.getClientRects().length && node.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(node => ({ tag:node.tagName, id:node.id, class:node.className, right:node.getBoundingClientRect().right })) }));
      assert.equal(overflow.fits, true, language + ":" + width + ":" + theme + " " + JSON.stringify(overflow.nodes));
      assert.deepEqual(errors, []);
      if (process.env.RSVP_COMPACT_PREVIEW_DIR) {
        const finalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
        fs.mkdirSync(process.env.RSVP_COMPACT_PREVIEW_DIR, { recursive: true });
        await page.locator('[data-panel="events"]').screenshot({ path: path.join(process.env.RSVP_COMPACT_PREVIEW_DIR, "events-" + language + "-" + width + "-" + finalTheme + ".png") });
        await page.locator("#settingsToggle").click();
        await selectInterfaceSettingsTab(page);
        await page.locator('[data-settings-card="personal-preferences"]').screenshot({ path: path.join(process.env.RSVP_COMPACT_PREVIEW_DIR, "interface-" + language + "-" + width + "-" + finalTheme + ".png") });
      }
      await page.close();
    }
    console.log("PASS compact saved settings: EN/DE/FO paired phone/wide Events and Interface rows, collapsed contacts, desktop-only version, full-row editors, retained independent drafts and Save/Cancel.");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
