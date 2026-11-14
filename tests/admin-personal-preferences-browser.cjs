const { openBox } = require("./helpers/local-edit-ui.cjs");
// Real controls with a synthetic account service. No production Auth/data writes.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("admin-personal-preferences");
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
  async function device(account, storage) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ account, storage }) => {
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
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body:
          mock +
          "\n" +
          extra +
          `\nclient.auth.getUser=()=>window.profileRequest();client.auth.updateUser=values=>window.profileRequest(values.data);`,
      }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
    );
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=interface]").click();
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
    // Edits remain a local draft until Save; Cancel discards all three choices.
    await page.locator("#themePreference").selectOption("light");
    await page.locator("#timeFormat").selectOption("12");
    await page.locator("#interfaceLanguage").selectOption("de");
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
    // One explicit Save batches only the changed fields and blocks duplicate work.
    await page.locator("#themePreference").selectOption("light");
    await page.locator("#timeFormat").selectOption("12");
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
    });
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
    await page.locator("#timeFormat").selectOption("24");
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
    const second = await device("a");
    assert.equal(
      await second.page.locator("#themePreference").inputValue(),
      "light",
    );
    assert.equal(await second.page.locator("#timeFormat").inputValue(), "24");
    const b = await device("b", {
      "event-appearance": "dark",
      "rsvp-time-format": "12",
      "rsvp-interface-language": "de",
    });
    assert.equal(
      await b.page.locator("#themePreference").inputValue(),
      "system",
    );
    assert.equal(await b.page.locator("#timeFormat").inputValue(), "locale");
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
    await openBox(page, "personal-preferences");
    // Header toggle persists immediately but leaves other Interface drafts intact.
    await page.locator("#timeFormat").selectOption("12");
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
    await page.locator("#interfaceLanguage").selectOption("de");
    const writesBefore = writes.length;
    page.once("dialog", (dialog) => dialog.dismiss());
    await save.click();
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
        document.querySelectorAll("#statsGrid .stat-card").length === 4,
    );
    assert.equal(profiles.a.user_metadata.rsvp_interface_language, "de");
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=interface]").click();
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
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
