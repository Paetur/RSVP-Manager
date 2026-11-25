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
      const layout = await page.locator("#logFilters").evaluate(form => {
        const measure = selector => {
          const { left, top, right, bottom, height } = form.querySelector(selector).getBoundingClientRect();
          return { left, top, right, bottom, height };
        };
        const toolbar = getComputedStyle(form.querySelector(".log-filter-toolbar"));
        return {
          title: measure("h2"), toggle: measure("#logSearchToggle"), heading: measure(".log-heading"),
          toolbarRight: measure(".log-filter-toolbar").right - parseFloat(toolbar.paddingRight) - parseFloat(toolbar.borderRightWidth),
          filters: ["#logCategory", "#logAction", "#logFrom", "#logTo"].map(measure),
          apply: measure("#logApply"), reset: measure("#logReset"),
        };
      });
      const aligned = (first, second) => Math.abs(first.top - second.top) < 2;
      assert.ok(layout.toggle.left >= layout.title.right - 2 && layout.toggle.top < layout.title.bottom,
        "Logs Search sits on the right of the title row");
      const center = box => box.top + box.height / 2;
      assert.ok(Math.abs(center(layout.title) - center(layout.toggle)) < 2, "the title and search control are vertically centered");
      assert.ok(Math.abs(layout.toggle.right - layout.heading.right) < 2, "Search is flush with the heading's right edge");
      const [category, action, from, through] = layout.filters;
      assert.ok(aligned(category, action) && aligned(from, through), "category/action and date controls stay paired");
      assert.ok(layout.filters.every(control => Math.abs(control.height - category.height) < 2), "filter controls have a consistent height");
      assert.ok(layout.reset.right <= layout.apply.left + 1 && Math.abs(layout.apply.right - layout.toolbarRight) < 2,
        "Log actions stay together at the right edge of the toolbar");
      if (width >= 1000) {
        assert.ok(aligned(category, from) && aligned(through, layout.apply), "filters and actions share one desktop row");
      } else {
        assert.ok(from.top >= category.bottom && layout.apply.top >= through.bottom, "phone layout stacks filter pairs and actions");
      }
      const help = page.locator('[data-settings-panel="logs"] .log-help');
      assert.equal(await help.evaluate(node => node.open), false, "log reference notes start collapsed");
      assert.equal(await page.locator("#logRows .log-entry").count(), 50, "the initial page still loads real fixture results");
      await page.locator("#logSearchToggle").click();
      assert.equal(await page.locator("#logSearch").evaluate(input => document.activeElement === input && input.form?.id === "logFilters"), true);
      await page.locator("#logSearch").fill(noMatch);
      await page.locator("#logSearch").press("Enter");
      await page.waitForFunction(value => window.__lastLogQuery.p_search === value && !document.getElementById("logApply").disabled, noMatch);
      assert.match(await page.locator("#logRows").innerText(), /No log entries/);
      const queries = await page.evaluate(() => window.__calls.filter(call => call.name === "admin_query_logs").length);
      await page.locator("#logSearchClose").click();
      await page.waitForFunction(() => window.__lastLogQuery.p_search === "" && !document.getElementById("logApply").disabled);
      assert.equal(await page.locator("#logSearch").inputValue(), "");
      assert.equal(await page.locator("#logSearchPanel").isVisible(), false);
      assert.equal(await page.locator("#logSearchToggle").evaluate(node => document.activeElement === node), true);
      assert.equal(await page.evaluate(() => window.__calls.filter(call => call.name === "admin_query_logs").length), queries + 1,
        "log clear callback refreshes applied server-side search exactly once");
      assert.equal(await page.locator("#logRows .log-entry").count(), 50);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      if (screenshots) await page.screenshot({ path: path.join(screenshots, "logs-closed-" + width + ".png") });
      await page.locator("#logMore").click();
      await page.waitForFunction(() => document.querySelectorAll("#logRows .log-entry").length === 55);
      assert.ok(await page.evaluate(() => window.__lastLogQuery.p_before_key), "older entries use the existing cursor");
      await page.locator("#logCategory").selectOption("households");
      await page.waitForFunction(() => window.__lastLogQuery.p_category === "households" && !document.getElementById("logApply").disabled);
      await page.locator("#logAction").selectOption("update");
      await page.waitForFunction(() => window.__lastLogQuery.p_action === "update" && !document.getElementById("logApply").disabled);
      await page.locator("#logFrom").fill("2026-10-31");
      const filledFrom = await page.locator("#logFrom").boundingBox();
      const blankThrough = await page.locator("#logTo").boundingBox();
      assert.ok(Math.abs(filledFrom.y - blankThrough.y) < 2, "a formatted date hint keeps the two date fields aligned");
      if (width >= 1000) {
        const filledCategory = await page.locator("#logCategory").boundingBox();
        const filledApply = await page.locator("#logApply").boundingBox();
        assert.ok(Math.abs(filledFrom.y - filledCategory.y) < 2 && Math.abs(filledFrom.y - filledApply.y) < 2,
          "a formatted date hint keeps the desktop controls on the same row");
      }
      await page.locator("#logTo").fill("2026-10-31");
      await page.locator("#logApply").click();
      await page.waitForFunction(() => window.__lastLogQuery.p_to && !document.getElementById("logApply").disabled);
      assert.deepEqual(await page.evaluate(() => [window.__lastLogQuery.p_from, window.__lastLogQuery.p_to]),
        ["2026-10-30T23:00:00.000Z", "2026-10-31T23:00:00.000Z"], "dates still use inclusive event-day boundaries");
      assert.equal(await page.locator("#logRows .log-entry").count(), 14);
      await page.locator("#logRows .log-entry > summary").first().click();
      assert.match(await page.locator("#logRows .log-entry[open] .log-details").innerText(), /\+298 654321/);
      await page.locator("#logReset").click();
      await page.waitForFunction(() => !window.__lastLogQuery.p_category && !document.getElementById("logApply").disabled);
      assert.deepEqual(await page.evaluate(() => {
        const { p_search, p_category, p_action, p_from, p_to, p_before_at, p_before_key } = window.__lastLogQuery;
        return [p_search, p_category, p_action, p_from, p_to, p_before_at, p_before_key];
      }), ["", "", "", null, null, null, null], "reset clears the search, filters and cursor");
      assert.equal(await page.locator("#logRows .log-entry").count(), 50);
      assert.equal(await page.evaluate(start => window.__calls.slice(start).some(call => call.name !== "admin_query_logs"), before), false,
        "the Logs flow makes read-only requests");
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

    const restricted = await browser.newPage();
    await routeSyntheticSdk(restricted, mock + "\n" + extra + "\nwindow.__accessPermissions.preset = 'custom';");
    await restricted.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await restricted.waitForFunction(() => document.querySelector("#inviteOverviewCounts .invite-stat-row"));
    await restricted.locator("#settingsToggle").click();
    assert.equal(await restricted.locator('[data-settings-tab="logs"]').isVisible(), false, "custom access does not expose Logs");
    assert.equal(await restricted.evaluate(() => window.__calls.some(call => call.name === "admin_query_logs")), false);
    await restricted.close();
    console.log("PASS main-list search and Logs: shared disclosure, responsive header and filters, Enter submission, single clear refresh, date filtering, paging, reset, and full-administrator access at phone and desktop widths.");
    if (screenshots) console.log("Synthetic screenshots: " + screenshots);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
