// Synthetic data/permission changes still need the real reload handler when
// the approved phone layout hides its desktop shortcut. Desktop uses a click.
async function refreshFixture(page) {
  const button = page.locator("#refreshButton");
  if (await button.isVisible()) await button.click();
  else {
    await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
    await button.evaluate((node) => node.click());
  }
}
async function selectDatabaseTab(page, name) {
  const tab = page.locator('[data-database-tab="' + name + '"]');
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
}
async function reopenDatabaseAfterRecovery(page, tab = "backup") {
  await page.waitForFunction(() =>
    location.hash === '#invites' &&
    document.getElementById('mainSectionToggle')?.getAttribute('aria-pressed') === 'true' &&
    document.querySelector('[data-tab="invites"]')?.getAttribute('aria-selected') === 'true' &&
    document.querySelector('#statsGrid .stat-card'));
  await page.locator('#settingsToggle').click();
  const application = page.locator('[data-settings-tab="application"][aria-selected="true"]');
  await application.waitFor({ state: "visible" });
  await page.locator('[data-settings-tab="backups"]').click();
  await selectDatabaseTab(page, tab);
}
module.exports = { refreshFixture, reopenDatabaseAfterRecovery, selectDatabaseTab };
// Screenshot fixtures exercise the real preference handler in both themes;
// desktop shortcut visibility is covered by the dedicated toolbar tests.
async function toggleFixtureTheme(page) {
  const button = page.locator("#themeToggle");
  if (await button.isVisible()) await button.click();
  else await button.evaluate((node) => node.click());
}
module.exports.toggleFixtureTheme = toggleFixtureTheme;
// Suites that previously accepted native confirmations can accept the same
// synthetic operation inline. Dedicated acceptance tests exercise Cancel/Stay.
async function autoConfirmInline(page) {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      for (const button of document.querySelectorAll('[data-inline-confirm="true"]')) {
        if (!button.disabled) button.click();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}
module.exports.autoConfirmInline = autoConfirmInline;

async function selectInterfaceSettingsTab(page, name = "interface") {
  const top = page.locator('[data-settings-tab="checklist"]');
  if (await top.getAttribute("aria-selected") !== "true") await top.click();
  const id = {
    interface: "settingsInterfaceTab",
    invites: "settingsTabInvitesAppearance",
    overview: "settingsTabOverviewAppearance",
  }[name];
  const tab = page.locator("#" + id);
  if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
}
module.exports.selectInterfaceSettingsTab = selectInterfaceSettingsTab;

// Grouping is saved with the other Invites appearance preferences.
async function setInvitesGrouping(page, grouped) {
  if (!await page.locator('#adminApp').evaluate(node => node.classList.contains('showing-settings')))
    await page.locator('#settingsToggle').click();
  await selectInterfaceSettingsTab(page, "invites");
  await require('./local-edit-ui.cjs').openBox(page, 'invites-appearance');
  const mode = typeof grouped === 'boolean' ? (grouped ? 'relational' : 'none') : grouped;
  await page.locator('#inviteGroupBy input[data-invite-grouping="'+mode+'"]').check();
  const save = page.locator('#saveInvitesAppearance');
  if (await save.isEnabled()) {
    await save.click();
    await page.waitForFunction(expected => window.RSVP_ADMIN_PREFERENCES.invitesGrouping === expected, mode);
    await page.waitForFunction(() => document.getElementById('invitesAppearanceForm').getAttribute('aria-busy') !== 'true');
  }
  await page.locator('#mainSectionToggle').click();
  await page.locator('[data-tab=invites]').click();
}
module.exports.setInvitesGrouping = setInvitesGrouping;

async function selectOverviewTab(page, name) {
  const tab = page.locator('[data-overview-tab="' + name + '"]');
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
}
module.exports.selectOverviewTab = selectOverviewTab;

// Presentation suites can exercise either saved layout at their test viewport.
// Preference persistence itself is exercised through the actual Settings editor.
async function setFixtureInviteRows(page, rows) {
  await page.evaluate(value => {
    for (const key of ["invitesNarrowRows", "invitesWideRows"])
      Object.defineProperty(window.RSVP_ADMIN_PREFERENCES, key, { configurable: true, get: () => value });
    document.dispatchEvent(new Event("rsvp:invites-appearance"));
  }, rows);
}
module.exports.setFixtureInviteRows = setFixtureInviteRows;
