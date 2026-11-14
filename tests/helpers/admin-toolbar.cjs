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
module.exports = { refreshFixture };
// Screenshot fixtures exercise the real preference handler in both themes;
// desktop shortcut visibility is covered by the dedicated toolbar tests.
async function toggleFixtureTheme(page) {
  const button = page.locator("#themeToggle");
  if (await button.isVisible()) await button.click();
  else await button.evaluate((node) => node.click());
}
module.exports.toggleFixtureTheme = toggleFixtureTheme;
