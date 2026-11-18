// Actual installer/helper assets; synthetic connection and intercepted iCloud pages only.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), site = "https://synthetic-test.invalid:8443";
const share = id => "https://www.icloud.com/shortcuts/" + id;
const ids = { Uploader: "a".repeat(32), Runner: "b".repeat(32) };
const files = {
  "/shortcuts-test.html": "tools/shortcuts-test-page.html",
  "/js/shortcuts-test-installer.js": "js/shortcuts-test-installer.js",
  "/js/shortcuts-test-page.js": "js/shortcuts-test-page.js",
  "/js/shortcut-device-runner.js": "js/shortcut-device-runner.js",
  "/css/app.css": "css/app.css",
};
(async () => {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext(), errors = [], external = [], installs = [], staticRequests = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    await context.addInitScript(() => {
      window.__storageWrites = [];
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        window.__storageWrites.push(key);
        return setItem.call(this, key, value);
      };
    });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === site) {
        staticRequests.push(url.pathname);
        if (url.pathname === "/js/config.js") return route.fulfill({ contentType: "text/javascript", body: 'window.RSVP_CONFIG=Object.freeze({supabaseUrl:"https://abcdefghijklmnopqrst.supabase.co",supabaseKey:"sb_publishable_synthetic"});' });
        const file = files[url.pathname];
        if (file) return route.fulfill({ contentType: file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "text/css", body: fs.readFileSync(path.join(root, file)) });
      }
      if (request.isNavigationRequest() && Object.values(ids).some(id => request.url() === share(id))) {
        installs.push(request.url());
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic iCloud installation destination</title>" });
      }
      external.push({ url: request.url(), method: request.method() });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(site + "/shortcuts-test.html");
    const expectedLocation = page.url();
    const input = suffix => page.locator("#shortcutInstall" + suffix + "Url");
    const reviewed = suffix => page.locator("#shortcutInstall" + suffix + "Reviewed");
    const install = suffix => page.locator("#shortcutInstall" + suffix);
    async function disabled(suffix) {
      assert.equal(await install(suffix).getAttribute("href"), null, "unreviewed or invalid destinations have no navigable link");
      assert.equal(await install(suffix).getAttribute("aria-disabled"), "true");
      assert.equal(await install(suffix).getAttribute("tabindex"), "-1");
      assert.equal(await install(suffix).evaluate(element => getComputedStyle(element).opacity), "0.45", "disabled installation links are visibly muted");
    }
    async function noBatchSideEffects() {
      assert.equal(page.url(), expectedLocation, "editing installation options does not navigate");
      assert.equal(external.length, 0, "installer never calls a backend or a third-party URL");
      assert.equal(await page.locator("#shortcutLaunchRunner").getAttribute("aria-disabled"), "true", "installer checks cannot enable native batch launch");
      assert.equal(await page.locator("#shortcutLaunchUploader").getAttribute("aria-disabled"), "true");
      for (const selector of ["#shortcutCreateBatch", "#shortcutDryRun", "#shortcutRetry"])
        assert.equal(await page.locator(selector).isDisabled(), true, "installer checks cannot create/process batches");
      assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, writes: window.__storageWrites })), { local: 0, session: 0, writes: [] });
      assert.equal((await context.cookies()).length, 0);
    }
    for (const suffix of Object.keys(ids)) {
      await disabled(suffix);
      assert.equal(await input(suffix).inputValue(), "");
      assert.equal(await reviewed(suffix).isChecked(), false);
      assert.equal(await input(suffix).getAttribute("autocomplete"), "off");
    }
    assert.equal(staticRequests.includes("/js/shortcuts-test-installer.js"), true);
    await noBatchSideEffects();

    const badLinks = [
      "shortcuts://run-shortcut?name=Untrusted", "javascript:alert(1)",
      "http://www.icloud.com/shortcuts/" + ids.Runner,
      "https://icloud.com/shortcuts/" + ids.Runner,
      "https://www.icloud.com.attacker.invalid/shortcuts/" + ids.Runner,
      "https://attacker.invalid/?next=" + share(ids.Runner),
      "https://" + "name:password@www.icloud.com/shortcuts/" + ids.Runner,
      "https://www.icloud.com:443/shortcuts/" + ids.Runner,
      "https://www.icloud.com:8443/shortcuts/" + ids.Runner,
      share(ids.Runner) + "?capability=synthetic_do_not_forward", share(ids.Runner) + "#private",
      share(ids.Runner) + "/", share(ids.Runner) + "/../" + ids.Uploader,
      "https://www.icloud.com/shortcuts/%62" + "b".repeat(31),
      "https://www.icloud.com/shortcuts/" + "b".repeat(31),
      "https://www.icloud.com/shortcuts/" + "b".repeat(33),
      "https://www.icloud.com/shortcuts/" + "z".repeat(32),
      "https://www.icloud.com\\shortcuts\\" + ids.Runner,
    ];
    for (const value of badLinks) {
      await input("Runner").fill(value);
      if (await reviewed("Runner").isEnabled()) await reviewed("Runner").check();
      await disabled("Runner");
      await install("Runner").evaluate(element => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    }
    await noBatchSideEffects();
    assert.equal(installs.length, 0, "entering URLs and clicking disabled controls never opens iCloud");

    for (const [suffix, id] of Object.entries(ids)) {
      await input(suffix).fill(share(id));
      await disabled(suffix);
      await reviewed(suffix).check();
      assert.equal(await install(suffix).getAttribute("href"), share(id));
      assert.equal(await install(suffix).getAttribute("aria-disabled"), "false");
      assert.equal(await install(suffix).evaluate(element => getComputedStyle(element).opacity), "1", "reviewed installation links use the active appearance");
      const rel = (await install(suffix).getAttribute("rel") || "").split(/\s+/);
      assert.ok(rel.includes("noreferrer"), "installation navigation omits the helper URL as referrer");
      assert.ok(rel.includes("noopener"), "installation page cannot control the helper window");
      assert.equal(await install(suffix).getAttribute("target"), "_blank");
      const popupPromise = context.waitForEvent("page");
      await install(suffix).click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(popup.url(), share(id));
      await popup.close();
    }
    assert.deepEqual(installs.sort(), Object.values(ids).map(share).sort(), "only an explicit click opens the reviewed canonical link");
    await noBatchSideEffects();

    await input("Runner").fill(share("c".repeat(32)));
    assert.equal(await reviewed("Runner").isChecked(), false, "review does not transfer to an edited URL");
    await disabled("Runner");
    await page.locator("#shortcutInstaller summary").click();
    const checkboxes = page.locator('#shortcutInstaller input[type="checkbox"]');
    for (let index = 0; index < await checkboxes.count(); index++) {
      if (await checkboxes.nth(index).isEnabled()) await checkboxes.nth(index).check();
    }
    await noBatchSideEffects();
    await page.locator("#shortcutInstallerReset").click();
    for (const suffix of Object.keys(ids)) {
      assert.equal(await input(suffix).inputValue(), "");
      assert.equal(await reviewed(suffix).isChecked(), false);
      await disabled(suffix);
    }
    assert.equal(await checkboxes.evaluateAll(elements => elements.some(element => element.checked)), false);

    for (const width of [390, 1160]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "test helper fits at viewport " + width);
    }
    await input("Uploader").fill(share(ids.Uploader));
    await reviewed("Uploader").check();
    await page.reload();
    assert.equal(await input("Uploader").inputValue(), "", "installation URLs are not restored after refresh");
    await disabled("Uploader");
    await noBatchSideEffects();
    assert.deepEqual(errors, []);
    console.log("PASS Shortcut installer browser: strict reviewed iCloud destinations, explicit navigation, volatile reset, unchanged batch gates and 390/1160 layout");
    await context.close();
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
