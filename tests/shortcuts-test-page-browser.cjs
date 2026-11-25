// Actual helper + device runner + IndexedDB; every backend response is synthetic.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), api = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/invitation-shortcuts";
const capability = "synthetic_runtime_authorization_" + "x".repeat(32), batch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const phones = ["+12025550101", "+12025550102"];
const files = { "/shortcuts-test.html": "tools/shortcuts-test-page.html", "/js/shortcuts-test-page.js": "js/shortcuts-test-page.js", "/js/shortcuts-test-installer.js": "js/shortcuts-test-installer.js", "/js/shortcut-device-runner.js": "js/shortcut-device-runner.js", "/css/app.css": "css/app.css" };
const server = http.createServer((request, response) => {
  const file = files[new URL(request.url, "http://localhost").pathname];
  if (!file) { response.writeHead(404); return response.end(); }
  response.setHeader("content-type", file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "text/css");
  response.end(fs.readFileSync(path.join(root, file)));
});
const id = index => "bbbbbbbb-bbbb-4bbb-8bbb-" + String(index).padStart(12, "0");
const deliveries = index => "cccccccc-cccc-4ccc-8ccc-" + String(index).padStart(12, "0");
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.__copied = null;
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.__copied = text; } } });
    });
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    let currentBatch = batch, mode = "dry_run", total = 6, processed = new Set(), failedResult = false, failNextResult = false, fragmentAtConfig;
    function manifest() {
      const invitations = Array.from({ length: 6 }, (_, index) => ({ attempt_id: id(index + 1), delivery_id: deliveries(index + 1),
        household_name: "Synthetic household " + (index + 1), phone: phones[index < 3 ? 0 : 1],
        message: "Synthetic message " + (index + 1) + " https://test.invalid/?ABCDEFGH", invitation_code: "ABCDEFGH", invitation_link: "https://test.invalid/?ABCDEFGH",
        image_url: api + "/batches/" + currentBatch + "/attempts/" + id(index + 1) + "/image" })).filter(item => !processed.has(item.attempt_id));
      return { schema_version: 1, batch_id: currentBatch, mode, expires_at: new Date(Date.now() + 1800000).toISOString(), invitations,
        statuses: Array.from({ length: 6 }, (_, i) => ({ attempt_id: id(i + 1), state: processed.has(id(i + 1)) ? "processed" : "pending" })),
        progress: { total, pending: invitations.length, claimed: 0, processed: processed.size, partial: 0, failed: 0, unknown: 0, skipped: 0 } };
    }
    await page.route("**/*", async route => {
      const request = route.request(), url = request.url();
      if (url.endsWith("/js/config.js")) {
        fragmentAtConfig = await page.evaluate(() => location.hash);
        return route.fulfill({ contentType: "text/javascript", body: "window.RSVP_CONFIG=Object.freeze(" + JSON.stringify({ supabaseUrl: api.split("/functions/")[0], supabaseKey: "sb_publishable_synthetic" }) + ");" });
      }
      if (url.startsWith(api + "/batches/")) {
        requests.push({ url, method: request.method(), authorization: request.headers().authorization });
        assert.equal(request.headers().authorization, "Bearer " + capability);
        assert.equal(url.includes(capability), false);
        const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify({ schema_version: 1, batch_id: currentBatch, ...body }) });
        if (url.endsWith("/image")) return route.fulfill({ contentType: "image/jpeg", body: Buffer.from([255, 216, 255, 217]) });
        if (url.endsWith("/claims")) {
          const body = request.postDataJSON();
          return json({ claimed: true, state: "claimed", mode, attempt_id: body.attempt_id, required_actions: { text: true, photo: true }, completed_actions: { text: false, photo: false } });
        }
        if (url.endsWith("/results")) {
          if (failNextResult) { failNextResult = false; failedResult = true; return route.fulfill({ status: 503, contentType: "application/json", body: "{}" }); }
          const body = request.postDataJSON(); processed.add(body.attempt_id);
          return json({ accepted: true, idempotent: false, state: body.result });
        }
        return json(manifest());
      }
      if (new URL(url).hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    const base = "http://127.0.0.1:" + server.address().port + "/shortcuts-test.html";
    const envelope = { schema_version: 1, api_base: api, batch_id: batch, capability, mode: "dry_run", expected_recipients: phones };
    await page.goto(base + "#pilot=" + encodeURIComponent(JSON.stringify(envelope)));
    assert.equal(fragmentAtConfig, "", "fragment removed before the config script request");
    assert.equal(await page.evaluate(() => location.hash), "");
    assert.equal(await page.evaluate(() => Object.hasOwn(window, "__RSVP_SHORTCUT_PILOT__")), false);
    assert.equal(await page.locator("#shortcutCapability").getAttribute("type"), "password");
    assert.equal(await page.locator("#shortcutBatch").inputValue(), batch);
    assert.equal(await page.locator("#shortcutApi").inputValue(), api);
    assert.equal(requests.length, 0, "no backend contact before explicit inspection");
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutProgress").filter({ hasText: "pending: 6" }).waitFor();
    assert.deepEqual(await page.locator("#shortcutRecipientList li").allTextContents(), phones);
    assert.equal(await page.locator("#shortcutDryRun").isEnabled(), true);
    await page.locator("#shortcutCopy").click();
    await page.waitForFunction(() => document.querySelector("#shortcutLaunchRunner").getAttribute("aria-disabled") === "false");
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.__copied)), envelope);
    for (const selector of ["#shortcutLaunchRunner", "#shortcutLaunchUploader"]) {
      const href = await page.locator(selector).getAttribute("href");
      assert.match(href, /^shortcuts:\/\/run-shortcut\?name=RSVP%20/);
      assert.ok(href.endsWith("&input=clipboard"));
      assert.equal(href.includes(capability), false);
    }
    await page.locator("#shortcutDryRun").click();
    await page.locator("#shortcutBrowserStatus").filter({ hasText: "processed this run: 1" }).waitFor();
    await page.locator("#shortcutProgress").filter({ hasText: "pending: 5" }).waitFor();
    assert.equal(requests.filter(r => r.url.endsWith("/claims")).length, 1);
    const stored = await page.evaluate(async batchId => window.RSVPShortcutsTestPage.createIndexedDBStore().load("rsvp-shortcut-device:v1:" + batchId), batch);
    assert.equal(Object.keys(stored.value.attempts).length, 1);
    const serialized = JSON.stringify(stored);
    for (const privateValue of [capability, ...phones, "Synthetic message", "image_url", "invitation_link", "household_name"])
      assert.equal(serialized.includes(privateValue), false);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await page.locator("#shortcutLimit").selectOption("all");
    await page.locator("#shortcutDryRun").click();
    await page.locator("#shortcutProgress").filter({ hasText: "processed: 6" }).waitFor();
    assert.equal(requests.filter(r => r.url.endsWith("/claims")).length, 6);
    const cas = await page.evaluate(async () => {
      const store = window.RSVPShortcutsTestPage.createIndexedDBStore(), batchId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", key = "rsvp-shortcut-device:v1:" + batchId;
      const value = { version: 1, batch_id: batchId, mode: "dry_run", active_run: null, attempts: {} };
      const results = await Promise.all([store.compareAndSwap(key, 0, value), store.compareAndSwap(key, 0, value)]);
      let rejected = false;
      try { await store.compareAndSwap(key, 1, { ...value, capability: "must_never_persist" }); } catch { rejected = true; }
      return { results, rejected, loaded: await store.load(key) };
    });
    assert.equal(cas.results.filter(Boolean).length, 1, "concurrent CAS admits one durable write");
    assert.equal(cas.rejected, true);
    assert.equal(cas.loaded.revision, 1);
    // Lost callback upload leaves only an identifier/state outbox; uploader does no claims/images.
    currentBatch = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; processed = new Set();
    await page.locator("#shortcutBatch").fill(currentBatch);
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutProgress").filter({ hasText: "pending: 6" }).waitFor();
    await page.locator("#shortcutLimit").selectOption("1"); failNextResult = true;
    await page.locator("#shortcutDryRun").click();
    await page.locator("#shortcutBrowserStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(failedResult, true);
    const before = requests.length;
    await page.locator("#shortcutRetry").click();
    await page.locator("#shortcutBrowserStatus").filter({ hasText: "Pending browser results uploaded" }).waitFor();
    assert.equal(requests.length, before + 1);
    assert.ok(requests.at(-1).url.endsWith("/results"));
    assert.equal(requests.at(-1).method, "POST");
    // Even forced browser button events cannot process a live-test manifest.
    mode = "live_test"; currentBatch = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await page.locator("#shortcutBatch").fill(currentBatch);
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutProgress").filter({ hasText: "Mode: live_test" }).waitFor();
    assert.equal(await page.locator("#shortcutDryRun").isEnabled(), false);
    const liveRequests = requests.length;
    await page.locator("#shortcutDryRun").dispatchEvent("click");
    await page.locator("#shortcutBrowserStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(requests.length, liveRequests);
    mode = "dry_run"; total = 5; currentBatch = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await page.locator("#shortcutBatch").fill(currentBatch);
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutProgress").filter({ hasText: "Total: 5" }).waitFor();
    assert.equal(await page.locator("#shortcutDryRun").isEnabled(), false, "a non-six-item dry run is refused");
    await page.locator("#shortcutClear").click();
    assert.equal(await page.locator("#shortcutCapability").inputValue(), "");
    assert.equal(await page.locator("#shortcutLaunchRunner").getAttribute("aria-disabled"), "true");
    const beforeForeign = requests.length;
    await page.goto(base + "?fresh=foreign#pilot=" + encodeURIComponent(JSON.stringify({ ...envelope, api_base: "https://foreign.invalid/functions/v1/invitation-shortcuts" })));
    assert.equal(await page.locator("#shortcutApi").inputValue(), api);
    assert.equal(await page.locator("#shortcutBatch").inputValue(), "");
    assert.equal(await page.locator("#shortcutCapability").inputValue(), "");
    assert.equal(requests.length, beforeForeign, "a foreign fragment cannot change the pinned API or contact it");
    for (const [label, invalid] of [["four", { schema_version: 1, api_base: api, batch_id: batch, capability }], ["eight", { ...envelope, expires_at: "2099-01-01T00:00:00Z", count: 6 }]]) {
      await page.goto(base + "?fresh=" + label + "#pilot=" + encodeURIComponent(JSON.stringify(invalid)));
      assert.equal(await page.locator("#shortcutBatch").inputValue(), "", "only the exact six-field handoff is accepted");
      assert.equal(await page.evaluate(() => location.hash), "");
    }
    currentBatch = batch; mode = "live_test"; total = 6; processed = new Set();
    await page.goto(base + "?fresh=mode-mismatch#pilot=" + encodeURIComponent(JSON.stringify(envelope)));
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(await page.locator("#shortcutLaunchRunner").getAttribute("aria-disabled"), "true", "the manifest cannot change the handoff mode");
    mode = "dry_run";
    await page.goto(base + "?fresh=recipient-mismatch#pilot=" + encodeURIComponent(JSON.stringify({ ...envelope, expected_recipients: [phones[0], "+12025550103"] })));
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(await page.locator("#shortcutRecipients").isVisible(), false, "a manifest recipient outside the runtime allowlist is refused");
    processed = new Set(Array.from({ length: 5 }, (_, index) => id(index + 1)));
    await page.goto(base + "?fresh=resumed#pilot=" + encodeURIComponent(JSON.stringify(envelope)));
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutProgress").filter({ hasText: "pending: 1" }).waitFor();
    assert.deepEqual(await page.locator("#shortcutRecipientList li").allTextContents(), [phones[1]]);
    await page.locator("#shortcutCopy").click();
    await page.locator("#shortcutStatus").filter({ hasText: "Launch input copied" }).waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.__copied)), envelope, "resume retains the verified two-recipient handoff only in RAM");
    processed.add(id(6));
    await page.goto(base + "?fresh=zero-pending#pilot=" + encodeURIComponent(JSON.stringify(envelope)));
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutProgress").filter({ hasText: "pending: 0" }).waitFor();
    const beforeZeroRetry = requests.length;
    await page.locator("#shortcutRetry").click();
    await page.locator("#shortcutBrowserStatus").filter({ hasText: "Pending browser results uploaded" }).waitFor();
    assert.equal(requests.length, beforeZeroRetry, "a zero-pending reloaded callback drain uses only the retained journal and handoff allowlist");
    assert.deepEqual(errors, []);
    console.log("PASS Shortcuts test helper: synchronous fragment removal, pinned API, authorized progress/recipients, clipboard-only native launch, dry-run pause/resume, private atomic IndexedDB journal, callback-only retry and live-mode refusal. No real backend or messaging app contacted.");
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
