// Actual main-list search controls with public assets and synthetic APIs only.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("admin-search");
const ids = ["householdSearch", "inviteSearch", "foodSearch", "logSearch"];
const noMatch = "synthetic-no-search-match-zzzz";
const screenshots = process.env.RSVP_SEARCH_ARTIFACTS;
if (screenshots) fs.mkdirSync(screenshots, { recursive: true });

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [390, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: 1050 }, hasTouch: width < 700 }), errors = [];
      page.setDefaultTimeout(10000);
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("rsvp-interface-language", "en");
        document.addEventListener("DOMContentLoaded", () => {
          window.__searchNodes = {};
          window.__searchInputs = {};
          for (const id of ["householdSearch", "inviteSearch", "foodSearch", "logSearch"]) {
            const input = document.getElementById(id);
            window.__searchNodes[id] = input; window.__searchInputs[id] = 0;
            input.addEventListener("input", () => window.__searchInputs[id]++);
          }
        }, { once: true });
      });
      await routeSyntheticSdk(page, mock + "\n" + extra);
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(() => document.querySelector("#inviteOverviewCounts .invite-stat-row"));
      assert.equal(await page.locator(".admin-search-control").count(), 4);
      assert.equal(await page.locator("#translationSearch").evaluate(node => node.closest(".admin-search-control")), null,
        "Languages retains its independent unsaved-editor navigation guard");
      assert.equal(await page.evaluate(() => Object.entries(window.__searchNodes).every(([id, node]) => node === document.getElementById(id))), true,
        "enhancing controls preserves existing input nodes and their listeners");
      await page.evaluate(() => {
        window.__searchApi = window.RSVP_ADMIN_SEARCH.enhance({ R: window.RSVP, T: value => value,
          iconAction: () => { throw Error("Repeated enhancement must reuse the existing control"); },
          ids: ["householdSearch", "inviteSearch", "foodSearch", "logSearch", "translationSearch"] });
      });
      assert.equal(await page.locator(".admin-search-control").count(), 4, "enhancement is idempotent and excludes Languages");
      const before = await page.evaluate(() => window.__calls.length);

      for (const [id, tab, rows] of [["householdSearch", "households", "#householdRows .household-tree-node"],
        ["inviteSearch", "invites", "#inviteRows [data-invite-household]"],
        ["foodSearch", "food", "#adminFoodList .food-compact-item"]]) {
        await page.locator('[data-tab="' + tab + '"]').click();
        const input = page.locator("#" + id), toggle = page.locator("#" + id + "Toggle"), panel = page.locator("#" + id + "Panel"), close = page.locator("#" + id + "Close");
        const original = await page.locator(rows).count(); assert.ok(original > 0, tab + " fixture renders rows");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await toggle.getAttribute("aria-controls"), id + "Panel");
        assert.equal(await panel.isVisible(), false);
        await toggle.click(); assert.equal(await input.evaluate(node => document.activeElement === node), true);
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        for (const control of [toggle, close]) {
          const box = await control.boundingBox(); assert.ok(box.width >= 43.5 && box.height >= 43.5, "search actions retain 44px touch targets");
        }
        if (screenshots) await page.screenshot({ path: path.join(screenshots, id + "-open-" + width + ".png") });
        await input.fill(noMatch);
        assert.equal(await page.locator(rows).count(), 0, tab + " retains its actual existing filter handler");
        const events = await page.evaluate(key => window.__searchInputs[key], id);
        await close.click();
        assert.equal(await input.inputValue(), ""); assert.equal(await panel.isVisible(), false);
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
        assert.equal(await page.locator(rows).count(), original, "closing restores the unfiltered list");
        assert.equal(await page.evaluate(key => window.__searchInputs[key], id), events + 1, "one clear reaches retained input listeners once");
        await toggle.click(); await input.fill(noMatch); await input.press("Escape");
        assert.equal(await panel.isVisible(), false); assert.equal(await input.inputValue(), "");
        assert.equal(await toggle.evaluate(node => document.activeElement === node), true);
        assert.equal(await page.locator(rows).count(), original);
        await toggle.click(); await input.fill(noMatch); await toggle.click();
        assert.equal(await panel.isVisible(), false); assert.equal(await input.inputValue(), "", "toggle-close cannot conceal a live filter");
        assert.equal(await page.locator(rows).count(), original);
        await page.evaluate(key => window.__searchApi.open(key), id);
        assert.equal(await input.evaluate(node => document.activeElement === node), true, "programmatic open focuses the retained input");
        await page.evaluate(key => window.__searchApi.close(key), id);
        await input.evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); }, noMatch);
        assert.equal(await panel.isVisible(), true, "a programmatic live query is never hidden");
        await close.click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "openable search fits the current viewport");
      }
      assert.equal(await page.evaluate(start => window.__calls.slice(start).some(call => /save|delete|record|publish|create|send|claim/i.test(call.name)), before), false,
        "search/open/clear never performs data or delivery writes");

      await page.locator("#settingsToggle").click();
      await page.locator('[data-settings-tab="logs"]').click();
      await page.waitForFunction(() => window.__lastLogQuery && !document.getElementById("logApply").disabled);
      await page.locator("#logSearchToggle").click();
      await page.locator("#logSearch").fill(noMatch); await page.locator("#logApply").click();
      await page.waitForFunction(value => window.__lastLogQuery.p_search === value && !document.getElementById("logApply").disabled, noMatch);
      const queries = await page.evaluate(() => window.__calls.filter(call => call.name === "admin_query_logs").length);
      await page.locator("#logSearchClose").click();
      await page.waitForFunction(() => window.__lastLogQuery.p_search === "" && !document.getElementById("logApply").disabled);
      assert.equal(await page.locator("#logSearch").inputValue(), "");
      assert.equal(await page.locator("#logSearchPanel").isVisible(), false);
      assert.equal(await page.locator("#logSearchToggle").evaluate(node => document.activeElement === node), true);
      assert.equal(await page.evaluate(() => window.__calls.filter(call => call.name === "admin_query_logs").length), queries + 1,
        "log clear callback refreshes applied server-side search exactly once");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      if (screenshots) await page.screenshot({ path: path.join(screenshots, "logs-closed-" + width + ".png") });
      assert.deepEqual(errors, []);
      await page.close();
    }

    const page = await browser.newPage();
    await page.addInitScript(value => {
      localStorage.setItem("rsvp-interface-language", "en");
      document.addEventListener("DOMContentLoaded", () => { document.getElementById("householdSearch").value = value; }, { once: true });
    }, noMatch);
    await routeSyntheticSdk(page, mock + "\n" + extra);
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(() => document.querySelector("#inviteOverviewCounts .invite-stat-row"));
    await page.locator('[data-tab="households"]').click();
    assert.equal(await page.locator("#householdSearchToggle").getAttribute("aria-expanded"), "true", "restored filters are shown on initial enhancement");
    assert.equal(await page.locator("#householdSearchPanel").isVisible(), true);
    assert.equal(await page.locator("#householdRows .household-tree-node").count(), 0);
    await page.locator("#householdSearchClose").click();
    assert.ok(await page.locator("#householdRows .household-tree-node").count() > 0);
    await page.close();
    console.log("PASS main-list search: original nodes/listeners, actual Household/Invites/Food filters, open/close/Escape/toggle clearing, programmatic/restored visibility, focus/ARIA/touch sizing, idempotence, unchanged Languages lifecycle, single Logs refresh and zero state writes at phone/desktop widths.");
    if (screenshots) console.log("Synthetic screenshots: " + screenshots);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
