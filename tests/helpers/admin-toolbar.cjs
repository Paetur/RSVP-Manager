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
async function reopenDatabaseAfterRecovery(page) {
  await page.waitForFunction(() =>
    location.hash === '#overview' &&
    document.getElementById('mainSectionToggle')?.getAttribute('aria-pressed') === 'true' &&
    document.querySelector('[data-tab="overview"]')?.getAttribute('aria-selected') === 'true' &&
    document.querySelector('#statsGrid .stat-card'));
  await page.locator('#settingsToggle').click();
  const application = page.locator('[data-settings-tab="application"][aria-selected="true"]');
  await application.waitFor({ state: "visible" });
  await page.locator('[data-settings-tab="backups"]').click();
}
module.exports = { refreshFixture, reopenDatabaseAfterRecovery };
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

// Grouping is now an account preference with its own per-card Save/Cancel.
async function setInvitesGrouping(page, grouped) {
  if (!await page.locator('#adminApp').evaluate(node => node.classList.contains('showing-settings')))
    await page.locator('#settingsToggle').click();
  await page.locator('[data-settings-tab=checklist]').click();
  await require('./local-edit-ui.cjs').openBox(page, 'invites-appearance');
  await page.locator('#inviteGroupView').setChecked(grouped);
  const save = page.locator('#saveInvitesAppearance');
  if (await save.isEnabled()) {
    await save.click();
    await page.waitForFunction(expected => window.RSVP_ADMIN_PREFERENCES.invitesGrouped === expected, grouped);
    await page.waitForFunction(() => document.getElementById('invitesAppearanceForm').getAttribute('aria-busy') !== 'true');
  }
  await page.locator('#mainSectionToggle').click();
  await page.locator('[data-tab=invites]').click();
}
module.exports.setInvitesGrouping = setInvitesGrouping;
