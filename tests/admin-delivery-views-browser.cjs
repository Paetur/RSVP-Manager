const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
// Real delivery UI and synthetic records; never contacts a populated database.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("admin-delivery-views");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 820, height: 1180 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem("rsvp-interface-language", "en"),
    );
    const seed = `fixtures.event_settings[0].is_published=true;const deliveryH=fixtures.households.find(h=>h.invite_code&&!h.archived_at);fixtures.invitation_send_queue=['ready','failed','sent'].map((status,i)=>({id:'view-'+status,household_id:deliveryH.id,channel:'manual',status,revision:1,created_at:'2026-11-13T1'+(2-i)+':00:00Z',updated_at:'2026-11-13T12:00:00Z',invitation_code_snapshot:deliveryH.invite_code,recipient_snapshot:{contact_name:'Example recipient'},message_subject:'Example',message_body:'Synthetic invitation'}));`;
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + seed,
      }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
    );
    await page.locator("[data-tab=invites]").click();
    const section = page.locator(".delivery-log-section");
    await section.evaluate((n) => (n.open = true));
    const ids = () =>
      page
        .locator("#deliveryLog [data-delivery-id]")
        .evaluateAll((ns) => ns.map((n) => n.dataset.deliveryId));
    assert.deepEqual(await ids(), ["view-ready", "view-failed", "view-sent"]);
    assert.match(
      await page.locator("#deliveryCounts").innerText(),
      /1 ready.*1 recorded sent.*1 failed/,
    );
    assert.equal(
      await page
        .locator("#deliveryLog [data-delivery-id=view-ready]")
        .getByText("Edit delivery", { exact: true })
        .count(),
      0,
      "history view keeps the original non-editable record contract",
    );
    const filter = page.locator("#deliveryStatusFilter details");
    async function selectStatuses(selected) {
      const keys = await filter.locator("button[data-value]").evaluateAll(nodes => nodes.map(node => node.dataset.value));
      for (const key of keys) {
        const option = filter.locator('[data-value="' + key + '"]');
        if ((await option.getAttribute("aria-pressed") === "true") === selected.includes(key)) continue;
        if (!await filter.evaluate(node => node.open)) await filter.locator("summary").click();
        await option.click();
      }
      if (await filter.evaluate(node => node.open)) await filter.locator("summary").press("Escape");
    }
    const selectedStatuses = () => filter.locator('[aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.dataset.value));
    await selectStatuses(["failed"]);
    assert.deepEqual(await ids(), ["view-failed"]);
    await page.evaluate(() => {
      const previous = fixtures.invitation_send_queue.find(
        (q) => q.status === "failed",
      );
      fixtures.invitation_send_queue = [
        {
          ...previous,
          id: "view-refreshed",
          created_at: "2026-11-14T12:00:00Z",
        },
      ];
    });
    await refreshFixture(page);
    await page.waitForFunction(() =>
      document.querySelector("#deliveryLog [data-delivery-id=view-refreshed]"),
    );
    assert.deepEqual(await ids(), ["view-refreshed"]);
    assert.deepEqual(
      await selectedStatuses(),
      ["failed"],
    );
    assert.match(
      await page.locator("#deliveryCounts").innerText(),
      /0 ready.*0 recorded sent.*1 failed/,
    );
    await selectStatuses(["sent"]);
    assert.deepEqual(await ids(), []);
    assert.match(
      await page.locator("#deliveryLog").innerText(),
      /No deliveries match this status/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS delivery views: newest-first history, per-status filtering/counts, read-only record contract, replaced-store reload and retained filter/empty state.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
