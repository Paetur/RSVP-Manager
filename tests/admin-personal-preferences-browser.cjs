const { openBox } = require("./helpers/local-edit-ui.cjs");
// Real controls with a synthetic account service. No production Auth/data writes.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { refreshFixture, selectOverviewTab } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("admin-personal-preferences");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  const profiles = {
    a: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "a@example.invalid",
      user_metadata: {
        unrelated: "preserved",
        rsvp_interface_language: "en",
        rsvp_interface_appearance: "dark",
        rsvp_interface_time_format: "24",
      },
    },
    b: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "b@example.invalid",
      user_metadata: {},
    },
  };
  let fail = false,
    writes = [],
    delay;
  const defaultCards = ["households", "food", "rsvp", "invites", "services", "language"];
  const savedCards = ["food", "households", "rsvp", "services", "invites"];
  const cardOrder = (page) => page.locator("#statsGrid [data-overview-card]")
    .evaluateAll((cards) => cards.map((card) => card.dataset.overviewCard));
  const settingsOrder = (page) => page.locator("#overviewCardOrder [data-overview-setting]")
    .evaluateAll((rows) => rows.map((row) => row.dataset.overviewSetting));
  async function openOverview(page) {
    await page.locator("#mainSectionToggle").click();
    await page.locator('[data-tab="invites"]').click();
  }
  async function editOverview(page) {
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=checklist]").click();
    return openBox(page, "overview-appearance");
  }
  async function device(account, storage) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ account, storage }) => {
        if (window !== window.top) return;
        window.__testAccount = account;
        if (storage)
          for (const [key, value] of Object.entries(storage))
            localStorage.setItem(key, value);
      },
      { account, storage },
    );
    await page.exposeFunction("profileRequest", async (patch) => {
      if (patch) {
        writes.push(patch);
        if (delay) await delay;
        if (fail) {
          fail = false;
          return { error: { message: "Synthetic offline" } };
        }
        Object.assign(profiles[account].user_metadata, patch);
      }
      return { data: { user: profiles[account] } };
    });
    await routeSyntheticSdk(page, mock + "\n" + extra +
      `\nfixtures.guests.push({id:"99999999-9999-4999-8999-999999999990",household_id:h3,first_name:"Second",language:"de"});
client.auth.getUser=()=>window.profileRequest();client.auth.updateUser=values=>window.profileRequest(values.data);`);
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
    );
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=checklist]").click();
    await openBox(page, "personal-preferences");
    return { context, page, errors };
  }
  try {
    const a = await device("a", {
      "event-appearance": "light",
      "rsvp-time-format": "12",
      "rsvp-interface-language": "fo",
    });
    const page = a.page,
      save = page.locator("#savePersonalPreferences"),
      cancel = page.locator("#cancelPersonalPreferences");
    assert.equal(await page.locator("#themePreference").inputValue(), "dark");
    assert.equal(await page.locator("#timeFormat").inputValue(), "24");
    assert.equal(await page.locator("#interfaceLanguage").inputValue(), "en");
    assert(await save.isDisabled());
    for (const id of ["interfaceLanguage", "themePreference", "timeFormat", "buttonHover"])
      assert.equal(await page.locator("#" + id).isVisible(), false, "duplicate select hidden: " + id);
    assert.deepEqual(
      await page.evaluate(() => {
        localStorage.setItem("rsvp-time-format", "12");
        return window.RSVP.timeOptions();
      }),
      { hourCycle: "h23" },
    );
    await page.evaluate(async () => {
      window.__accessPermissions.sections.settings = "view";
      await window.RSVP_ADMIN_ACCESS.refresh();
    });
    // Edits remain a local draft until Save; Cancel discards all four choices.
    await page.locator('[data-preference-choices="appearance"] [data-preference-choice="light"]').click();
    await page.locator('[data-preference-choices="time"] [data-preference-choice="12"]').click();
    await page.locator('[data-preference-choices="language"] [data-preference-choice="de"]').click();
    assert(await save.isEnabled());
    assert.equal(writes.length, 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      "en",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    assert.deepEqual(await page.evaluate(() => window.RSVP.timeOptions()), {
      hourCycle: "h23",
    });
    await cancel.click();
    assert.equal(await page.locator("#themePreference").inputValue(), "dark");
    assert.equal(await page.locator("#timeFormat").inputValue(), "24");
    assert.equal(await page.locator("#interfaceLanguage").inputValue(), "en");
    assert(await save.isDisabled());
    assert.equal(writes.length, 0);
    await openBox(page, "personal-preferences");
    assert.equal(await page.locator("#buttonHover").inputValue(), "toolbar");
    // One explicit Save batches only the changed fields and blocks duplicate work.
    await page.locator('[data-preference-choices="appearance"] [data-preference-choice="light"]').click();
    await page.locator('[data-preference-choices="time"] [data-preference-choice="12"]').click();
    await page.locator('[data-preference-choices="hover"] [data-preference-choice="create"]').click();
    let release;
    delay = new Promise((r) => (release = r));
    await save.click();
    await page
      .locator("#personalPreferencesStatus[data-state=saving]")
      .waitFor();
    assert(await cancel.isDisabled());
    assert(await page.locator("#logout").isDisabled());
    assert(await save.isDisabled());
    release();
    delay = null;
    await page
      .locator("#personalPreferencesStatus[data-state=saved]")
      .waitFor({ state: "attached" });
    assert.deepEqual(writes[0], {
      rsvp_interface_appearance: "light",
      rsvp_interface_time_format: "12",
      rsvp_interface_button_hover: "create",
    });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.buttonHover), "create");
    assert.equal(profiles.a.user_metadata.unrelated, "preserved");
    assert.equal(profiles.a.user_metadata.rsvp_interface_language, "en");
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "light",
    );
    assert(await save.isDisabled());
    await openBox(page, "personal-preferences");
    // A failed save retains the draft and the applied value; retry persists it.
    fail = true;
    await page.locator('[data-preference-choices="time"] [data-preference-choice="24"]').click();
    await save.click();
    await page
      .locator("#personalPreferencesStatus[data-state=error]")
      .waitFor();
    assert.equal(await page.locator("#timeFormat").inputValue(), "24");
    assert.deepEqual(await page.evaluate(() => window.RSVP.timeOptions()), {
      hour12: true,
    });
    assert.equal(profiles.a.user_metadata.rsvp_interface_time_format, "12");
    assert(await save.isEnabled());
    await save.click();
    await page
      .locator("#personalPreferencesStatus[data-state=saved]")
      .waitFor({ state: "attached" });
    await openBox(page, "invites-appearance");
    await page.locator('#inviteGroupBy input[data-invite-grouping="none"]').check();
    await page.locator("#saveInvitesAppearance").click();
    await page.locator("#invitesAppearanceStatus[data-state=saved]").waitFor({ state: "attached" });
    assert.equal(profiles.a.user_metadata.rsvp_invites_grouped, false);

    // The real Overview and its editor share one saved order per account.
    await openOverview(page);
    assert.deepEqual(await cardOrder(page), defaultCards);
    const inviteRows = page.locator("#inviteRows .invite-household");
    const allCount = await inviteRows.count();
    await selectOverviewTab(page, "invitation");
    await page.locator('#inviteLanguageFilter [data-value="de"]').click();
    const filteredCount = await inviteRows.count();
    assert.ok(filteredCount > 0 && filteredCount < allCount, "the Language card actively narrows the list");
    await page.setViewportSize({ width: 1160, height: 1100 });
    const editor = await editOverview(page);
    assert.deepEqual(await settingsOrder(page), defaultCards);
    assert.deepEqual(await editor.locator('[data-overview-setting-tab] h4').allTextContents(), ["Information", "Invitation"]);
    const row = (id) => editor.locator('[data-overview-setting="' + id + '"]');
    const moveHouseholdsDown = row("households").locator('[data-overview-move="down"]');
    assert.match(await moveHouseholdsDown.getAttribute("aria-label"), /^Move down · Households/);
    assert.equal(await row("rsvp").locator('[data-overview-move="down"]').isDisabled(), true);
    assert.equal(await row("invites").locator('[data-overview-move="up"]').isDisabled(), true);
    await moveHouseholdsDown.focus();
    await page.keyboard.press("Enter");
    assert.equal(await moveHouseholdsDown.evaluate((button) => button === document.activeElement), true);
    const reorderedInformation = ["food", "households", "rsvp", "invites", "services", "language"];
    assert.deepEqual(await settingsOrder(page), reorderedInformation);
    const serviceGrip = row("services").locator("[data-overview-grip]");
    async function dragServicesTo(id) {
      await serviceGrip.scrollIntoViewIfNeeded();
      const grip = await serviceGrip.boundingBox();
      const target = await row(id).boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 20, target.y + 6, { steps: 12 });
      await page.mouse.move(target.x + 21, target.y + 6);
      await page.mouse.up();
    }
    await dragServicesTo("rsvp");
    assert.deepEqual(await settingsOrder(page), reorderedInformation, "dragging onto a different tab cannot change the saved order");
    await dragServicesTo("invites");
    const visibleLanguage = row("language").locator('input[type="checkbox"]');
    await visibleLanguage.uncheck();
    const layout = [...savedCards, "language"]
      .map((id) => ({ id, shown: id !== "language" }));
    assert.deepEqual(await settingsOrder(page), layout.map(({ id }) => id));
    assert.deepEqual(await cardOrder(page), defaultCards, "edits stay in the independent draft");

    const overviewSave = editor.locator("#saveOverviewAppearance");
    fail = true;
    await overviewSave.click();
    await page.locator("#overviewAppearanceStatus[data-state=error]").waitFor();
    assert.equal(await visibleLanguage.isChecked(), false, "a failed save retains the visibility draft");
    assert.deepEqual(await cardOrder(page), defaultCards, "a failed save keeps the applied layout");
    await overviewSave.click();
    await page.locator("#overviewAppearanceStatus[data-state=saved]").waitFor({ state: "attached" });
    assert.deepEqual(writes.at(-1), { rsvp_overview_layout: layout });
    await openOverview(page);
    assert.deepEqual(await cardOrder(page), savedCards);
    assert.equal(await inviteRows.count(), allCount, "hiding the Language card clears its active filter");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.deepEqual(await cardOrder(page), savedCards, "phone and desktop use the same saved order");

    await editOverview(page);
    assert.ok(await editor.evaluate((form) => form.scrollWidth <= form.clientWidth + 1), "the Overview editor fits a phone");
    await editor.locator("#resetOverviewAppearance").click();
    assert.deepEqual(await settingsOrder(page), defaultCards);
    assert.equal(await visibleLanguage.isChecked(), true);
    await editor.locator("#cancelOverviewAppearance").click();
    await openOverview(page);
    assert.deepEqual(await cardOrder(page), savedCards, "Cancel preserves the saved layout after staging a reset");

    const second = await device("a");
    assert.deepEqual(await cardOrder(second.page), savedCards, "the Overview layout follows the signed-in account");
    assert.equal(await second.page.locator('#inviteGroupBy input[data-invite-grouping="none"]').isChecked(), true, "grouping follows the account to another device");
    assert.equal(
      await second.page.locator("#themePreference").inputValue(),
      "light",
    );
    assert.equal(await second.page.locator("#timeFormat").inputValue(), "24");
    profiles.b.user_metadata.rsvp_overview_layout = [
      { id: "language", shown: true }, { id: "guests", shown: false },
      { id: "food", shown: true }, { id: "households", shown: true },
      { id: "services", shown: true }, { id: "rsvp", shown: false },
      { id: "invites", shown: true },
    ];
    const b = await device("b", {
      "event-appearance": "dark",
      "rsvp-time-format": "12",
      "rsvp-interface-language": "de",
    });
    assert.deepEqual(await cardOrder(b.page), ["food", "households", "language", "services", "invites"],
      "legacy preferences keep each tab's relative order and the saved Households choice");
    await b.page.evaluate(() => { window.__accessPermissions.sections.food = "none"; });
    await refreshFixture(b.page);
    await b.page.locator('#statsGrid [data-overview-card="food"]').waitFor({ state: "detached" });
    await editOverview(b.page);
    assert.deepEqual(await settingsOrder(b.page), ["households", "rsvp", "language", "services", "invites"], "the editor cannot show a card the administrator cannot access");
    await b.page.evaluate(() => { window.__accessPermissions.sections.households = "none"; });
    await refreshFixture(b.page);
    await b.page.locator("#statsGrid .overview-people-breakdown").waitFor({ state: "detached" });
    assert.equal(await b.page.locator("#inviteGroupTrees").count(), 1, "Invite-only access keeps the group filters without exposing guest totals");
    assert.equal(
      await b.page.locator("#themePreference").inputValue(),
      "system",
    );
    assert.equal(await b.page.locator("#timeFormat").inputValue(), "locale");
    assert.equal(await b.page.locator('#inviteGroupBy input[data-invite-grouping="relational"]').isChecked(), true, "another account keeps the default grouping");
    assert.equal(await b.page.locator("#interfaceLanguage").inputValue(), "en");
    profiles.b.user_metadata.rsvp_interface_language = "fo";
    await b.page.evaluate(
      (user) => window.RSVP_ADMIN_PREFERENCES.load(user),
      profiles.b,
    );
    assert.match(
      await b.page
        .locator("#personalPreferencesForm button[type=submit]")
        .innerText(),
      /Goym/,
    );
    const count = writes.length;
    await b.page.evaluate(() => window.RSVP_ADMIN_PREFERENCES.clear());
    assert.equal(
      await b.page.evaluate(() =>
        window.RSVP_ADMIN_PREFERENCES.stage("time", "24"),
      ),
      false,
    );
    assert.equal(writes.length, count);
    const restored = await editOverview(page);
    await restored.locator("#resetOverviewAppearance").click();
    await restored.locator("#saveOverviewAppearance").click();
    await page.locator("#overviewAppearanceStatus[data-state=saved]").waitFor({ state: "attached" });
    await openOverview(page);
    assert.deepEqual(await cardOrder(page), defaultCards);
    assert.equal(await page.locator("#inviteLanguageFilter [aria-pressed=true]").count(), 0);
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=checklist]").click();
    await openBox(page, "personal-preferences");
    // The header shortcut is desktop-only; it preserves other Interface drafts.
    await page.setViewportSize({ width: 1160, height: 900 });
    await page.locator('[data-preference-choices="time"] [data-preference-choice="12"]').click();
    await page.locator("#themeToggle").click();
    await page
      .locator("#personalPreferencesStatus[data-state=saved]")
      .waitFor({ state: "attached" });
    assert.equal(profiles.a.user_metadata.rsvp_interface_appearance, "dark");
    assert.equal(profiles.a.user_metadata.rsvp_interface_time_format, "24");
    assert.equal(await page.locator("#timeFormat").inputValue(), "12");
    assert(await save.isEnabled());
    await cancel.click();
    await openBox(page, "personal-preferences");
    // Language reload checks unrelated dirty forms before committing any fields.
    await page.evaluate(() => {
      const f = document.createElement("form");
      f.id = "other-dirty-test";
      const i = document.createElement("input");
      f.append(i);
      document.body.append(f);
      i.value = "Unsaved work";
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator('[data-preference-choices="language"] [data-preference-choice="de"]').click();
    const writesBefore = writes.length;
    await save.click();
    await page.locator(".inline-confirmation").getByRole("button", { name: "Stay here", exact: true }).click();
    assert.equal(writes.length, writesBefore);
    assert.equal(await page.locator("#interfaceLanguage").inputValue(), "de");
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      "en",
    );
    await page.evaluate(() =>
      document.getElementById("other-dirty-test").remove(),
    );
    fail = true;
    await save.click();
    await page
      .locator("#personalPreferencesStatus[data-state=error]")
      .waitFor();
    assert.equal(await page.locator("#interfaceLanguage").inputValue(), "de");
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      "en",
    );
    let complete;
    delay = new Promise((r) => (complete = r));
    await save.click();
    await page
      .locator("#personalPreferencesStatus[data-state=saving]")
      .waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      "en",
    );
    complete();
    delay = null;
    await page.waitForFunction(
      () =>
        document.documentElement.lang === "de" &&
        document.querySelector("#inviteOverviewCounts .invite-stat-row"),
    );
    assert.equal(profiles.a.user_metadata.rsvp_interface_language, "de");
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=checklist]").click();
    assert.equal(
      await page.locator("#savePersonalPreferences").innerText(),
      "Speichern",
    );
    assert.equal(
      await page.locator("#cancelPersonalPreferences").innerText(),
      "Abbrechen",
    );
    for (const device of [a, second, b]) {
      assert.deepEqual(device.errors, []);
      await device.context.close();
    }
    console.log(
      "PASS personal Interface Save/Cancel: draft-only edits, discard, changed-field batching, view-only access, pending locks, failure retention/retry, account/device isolation, immediate header toggle, EN/DE/FO buttons and safe persist-before-language-reload.",
    );
    console.log("PASS Overview appearance: keyboard and pointer reorder, focus, visibility and filter clearing, responsive and per-account persistence, failed save retry, Reset and Cancel.");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
