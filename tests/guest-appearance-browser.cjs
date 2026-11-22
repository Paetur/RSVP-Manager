const {openBox}=require('./helpers/local-edit-ui.cjs');
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("guest-appearance");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("rsvp-interface-language", "en");
      if (!localStorage.getItem("event-appearance"))
        localStorage.setItem("event-appearance", "light");
    });
    await page.route("**maps.google.com/**", (r) =>
      r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
    );
    const behavior = `
fixtures.event_settings[0].guest_theme_toggle = true;
fixtures.event_settings[0].guest_theme_default = 'dark';
const appearanceRpc = client.rpc;
client.rpc = async (name, args) => {
  const settings = fixtures.event_settings[0];
  if (name === 'admin_save_guest_interface') {
    settings.guest_interface_modes ||= {};
    const mode = args.p_mode;
    settings.guest_interface_modes[mode] = { ...settings.guest_interface_modes[mode], ...args.p_values };
    window.__appearanceWrite = args;
    return { data: null };
  }
  const result = await appearanceRpc(name, args);
  if (name === 'get_public_event_v2') {
    result.data.event.guest_theme_toggle = settings.guest_theme_toggle;
    result.data.event.guest_theme_default = settings.guest_theme_default;
  }
  return result;
};
`;
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + stageExtra + behavior,
      }),
    );
    const base = "http://127.0.0.1:" + server.address().port;
    await page.goto(base + "/");
    await page.locator("#codeCard:not(.hidden)").waitFor();
    assert.equal(await page.locator("#themeToggle").isHidden(), true);
    await page.goto(base + "/?ABCDEFGH");
    await page.locator("#themeToggle:not(.hidden)").waitFor();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    assert.equal(
      await page.locator("#themeToggle").getAttribute("data-direct-toggle"),
      "true",
    );
    await page.locator("#themeToggle").click();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "light",
    );
    await page.locator("#themeToggle").click();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("event-appearance")),
      "light",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("rsvp-guest-appearance")),
      "dark",
    );
    await page.goto(base + "/?ABCDEFGH");
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await page.evaluate(() =>
      window.RSVP_THEME.configureGuest({
        showToggle: false,
        defaultTheme: "light",
      }),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "light",
    );
    assert.equal(await page.locator("#themeToggle").isHidden(), true);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() =>
      window.RSVP_THEME.configureGuest({
        showToggle: false,
        defaultTheme: "system",
      }),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    await page.goto(base + "/admin/");
    await page.waitForFunction(
      () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "light",
    );
    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=interface]").click();

    await page.locator('#guestAppearanceHost [data-appearance-mode="phone"]').click();
    await openBox(page, "guest-customization:phone");
    const form = page.locator('[data-settings-card="guest-customization:phone"] form');
    await form
      .getByRole("group", { name: "Guest default appearance", exact: true })
      .getByRole("checkbox", { name: "Light", exact: true })
      .check();
    await form
      .getByRole("checkbox", { name: "Show light/dark toggle on the guest page", exact: true })
      .uncheck();
    await form.locator("button[type=submit]").click();
    await page.waitForFunction(() => !!window.__appearanceWrite);
    assert.equal(await page.evaluate(() => window.__appearanceWrite.p_mode), "phone");
    assert.deepEqual(
      await page.evaluate(() => {
        const settings = window.__fixtures.event_settings[0];
        const phone = settings.guest_interface_modes.phone;
        return {
          phoneToggle: phone.guest_theme_toggle,
          phoneTheme: phone.guest_theme_default,
          baseToggle: settings.guest_theme_toggle,
          baseTheme: settings.guest_theme_default,
          wide: settings.guest_interface_modes.wide,
        };
      }),
      { phoneToggle: false, phoneTheme: "light", baseToggle: true, baseTheme: "dark", wide: undefined },
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "light",
    );
    assert.equal(
      await page.evaluate(
        () => window.__fixtures.event_settings[0].is_published,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS guest appearance: private configuration, direct toggle, separate admin preference, retained guest choice, hidden-toggle enforcement, device changes and Interface settings persistence.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
