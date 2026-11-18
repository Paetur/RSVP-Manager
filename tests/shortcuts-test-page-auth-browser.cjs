// Normal Auth + existing protected RPC/batch route, intercepted synthetic responses only.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), site = "https://synthetic-test.invalid:8443", backend = "https://abcdefghijklmnopqrst.supabase.co";
const api = backend + "/functions/v1/invitation-shortcuts", publicKey = "sb_publishable_synthetic", password = "synthetic-password-runtime-only";
const jwt = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from('{"role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}').toString("base64url") + ".synthetic_signature";
const capability = "synthetic_batch_capability_" + "z".repeat(40), phones = ["+12025550101", "+12025550102"];
const identifier = (kind, number) => kind.repeat(8) + "-" + kind.repeat(4) + "-4" + kind.repeat(3) + "-8" + kind.repeat(3) + "-" + String(number).padStart(12, "0");
const image = { image: "data:image/jpeg;base64," + fs.readFileSync(path.join(root, "tests/fixtures/shortcut-test.jpg")).toString("base64"), name: "synthetic-test.jpg", crop: { width: 640, height: 400 } };
function fixture() {
  const data = { settings: { event_name: "SYNTHETIC SHORTCUTS TEST", is_published: true }, households: [], guests: [], contacts: [], queue: [] };
  const codes = ["ABCDEFGH", "BCDEFGHJ", "CDEFGHJK", "DEFGHJKL", "EFGHJKLM", "FGHJKLMN"];
  for (let number = 1; number <= 6; number++) {
    const household = identifier("1", number), guest = identifier("2", number), contact = identifier("3", number), phone = phones[number <= 3 ? 0 : 1];
    data.households.push({ id: household, household_name: "Synthetic Shortcuts " + number, archived_at: null, invite_code: codes[number - 1], primary_guest_id: guest });
    data.guests.push({ id: guest, household_id: household, first_name: "Synthetic Guest " + number, last_name: null, archived_at: null, is_child: false, mobile: phone });
    data.contacts.push({ id: contact, household_id: household, guest_id: guest, contact_name: "Synthetic Contact " + number, contact_type: "phone", contact_value: phone, archived_at: null, preferred_method: "whatsapp", is_primary: true, is_household_primary: false });
    for (const [index, mode] of ["dry_run", "live_test"].entries())
      data.queue.push({ id: identifier("4", number + index * 6), household_id: household, contact_id: contact, channel: "whatsapp", status: "ready", revision: 1,
        message_subject: "SYNTHETIC SHORTCUTS TEST / " + mode, message_body: "SYNTHETIC " + mode + " / Synthetic Shortcuts " + number + "\n" + site + "/?=" + codes[number - 1], message_image: image,
        recipient_snapshot: { contact_name: "Synthetic Contact " + number, contact_type: "phone", contact_value: phone }, invitation_code_snapshot: codes[number - 1] });
  }
  return data;
}
(async () => {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext(), page = await context.newPage(), errors = [], calls = [], creations = [];
    await context.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async value => { window.__copied = value; } } }));
    page.on("pageerror", error => errors.push(error.message));
    let data = fixture(), denyAdmin = true, currentMode = "dry_run", batchId = identifier("5", 1), passwordWasCleared = false;
    let currentCapability = capability, oldExpired = false, zeroPending = false, callbackUploads = 0;
    const renewals = [];
    const files = { "/shortcuts-test.html": "tools/shortcuts-test-page.html", "/js/shortcut-device-runner.js": "js/shortcut-device-runner.js", "/js/shortcuts-test-page.js": "js/shortcuts-test-page.js", "/js/shortcuts-test-installer.js": "js/shortcuts-test-installer.js", "/css/app.css": "css/app.css" };
    await page.route("**/*", async route => {
      const request = route.request(), url = request.url(), parsed = new URL(url);
      if (parsed.origin === site) {
        if (parsed.pathname === "/js/config.js") return route.fulfill({ contentType: "text/javascript", body: "window.RSVP_CONFIG=Object.freeze(" + JSON.stringify({ supabaseUrl: backend, supabaseKey: publicKey }) + ");" });
        const file = files[parsed.pathname];
        return file ? route.fulfill({ contentType: file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "text/css", body: fs.readFileSync(path.join(root, file)) }) : route.abort();
      }
      if (parsed.origin !== backend) return route.abort();
      calls.push({ url, method: request.method(), headers: request.headers(), body: request.postDataJSON() });
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url === backend + "/auth/v1/token?grant_type=password") {
        assert.equal(request.headers().apikey, publicKey);
        assert.equal(request.headers().authorization, undefined);
        assert.deepEqual(request.postDataJSON(), { email: "pilot-admin@example.invalid", password });
        passwordWasCleared = await page.locator("#shortcutPassword").inputValue() === "";
        return json({ access_token: jwt, refresh_token: "synthetic_refresh_not_persisted", token_type: "bearer" });
      }
      if (url === backend + "/rest/v1/rpc/admin_load_data") {
        assert.equal(request.headers().apikey, publicKey); assert.equal(request.headers().authorization, "Bearer " + jwt);
        assert.deepEqual(request.postDataJSON(), {});
        return denyAdmin ? json({ message: "Synthetic administrator permission failure" }, 403) : json(data);
      }
      if (url === api + "/batches") {
        assert.equal(request.headers().apikey, publicKey); assert.equal(request.headers().authorization, "Bearer " + jwt);
        const body = request.postDataJSON();
        assert.ok(["dry_run", "live_test"].includes(body.mode));
        assert.deepEqual(Object.keys(body).sort(), ["items", "mode"]);
        assert.deepEqual(body.items, data.queue.filter(row => row.message_subject.endsWith(" / " + body.mode)).sort((a, b) => a.household_id.localeCompare(b.household_id)).map(row => ({ queue_id: row.id, expected_revision: row.revision })));
        creations.push(body); currentMode = body.mode; batchId = identifier("5", creations.length); currentCapability = capability;
        return json({ schema_version: 1, batch_id: batchId, capability, mode: currentMode, count: 6 }, 201);
      }
      if (url.startsWith(api + "/batches/") && url.endsWith("/authorization")) {
        assert.equal(request.headers().apikey, publicKey); assert.equal(request.headers().authorization, "Bearer " + jwt);
        assert.deepEqual(request.postDataJSON(), { action: "renew" });
        renewals.push(url);
        if (url !== api + "/batches/" + batchId + "/authorization") return json({ error: "Synthetic wrong batch" }, 403);
        currentCapability = "synthetic_renewed_capability_" + "q".repeat(40); oldExpired = false;
        return json({ schema_version: 1, batch_id: batchId, capability: currentCapability, expires_at: new Date(Date.now() + 1800000).toISOString() });
      }
      if (url === api + "/batches/" + batchId + "/results") {
        assert.equal(request.headers().authorization, "Bearer " + currentCapability);
        callbackUploads++;
        return json({ schema_version: 1, batch_id: batchId, accepted: true, idempotent: true, state: "processed" });
      }
      if (url === api + "/batches/" + batchId) {
        assert.equal(request.headers().authorization, "Bearer " + currentCapability);
        if (oldExpired) return json({ error: "Synthetic expired authorization" }, 401);
        return json({ schema_version: 1, batch_id: batchId, mode: currentMode, invitations: zeroPending ? [] : phones.map(phone => ({ phone })),
          progress: { total: 6, pending: zeroPending ? 0 : 6, claimed: 0, processed: zeroPending ? 6 : 0, partial: 0, failed: 0, unknown: 0, skipped: 0 } });
      }
      assert.fail("Unexpected backend endpoint in synthetic Auth test");
    });
    await page.goto(site + "/shortcuts-test.html");
    assert.equal(calls.length, 0);
    const signIn = async success => {
      await page.locator("#shortcutEmail").fill("pilot-admin@example.invalid");
      await page.locator("#shortcutPassword").fill(password);
      await page.locator("#shortcutSignIn").click();
      await page.locator("#shortcutAuthStatus").filter({ hasText: success ? "Normal administrator sign-in verified" : "verification failed" }).waitFor();
      assert.equal(await page.locator("#shortcutPassword").inputValue(), "");
    };
    await signIn(false);
    assert.equal(passwordWasCleared, true);
    assert.equal(await page.locator("#shortcutCreateBatch").isEnabled(), false);
    assert.equal(creations.length, 0, "an Auth user without administrator access cannot prepare a batch or grant access");
    denyAdmin = false;
    for (const corrupt of [value => { value.settings.is_published = false; }, value => { value.guests[0].first_name = "Outside namespace"; }, value => { value.queue[0].status = "draft"; }, value => { value.contacts.push({ id: identifier("6", 1), contact_type: "email", contact_value: "outside@example.invalid" }); }]) {
      data = fixture(); corrupt(data); await signIn(false);
      assert.equal(creations.length, 0);
    }
    data = fixture(); await signIn(true);
    assert.equal(await page.locator("#shortcutReviewMessages textarea").count(), 6);
    assert.equal(await page.locator("#shortcutReviewImage").getAttribute("src"), image.image);
    assert.equal(await page.locator("#shortcutCreateBatch").isEnabled(), false);
    const beforeReview = calls.length;
    await page.locator("#shortcutCreateBatch").dispatchEvent("click");
    await page.locator("#shortcutAuthStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(calls.length, beforeReview, "explicit review is required even for a forced button event");
    await page.locator("#shortcutReviewed").check();
    data.queue[0].revision = 2;
    await page.locator("#shortcutCreateBatch").click();
    await page.locator("#shortcutAuthStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(await page.locator("#shortcutReviewed").isChecked(), false, "changed snapshots require a fresh review");
    assert.equal(creations.length, 0);
    await page.locator("#shortcutReviewed").check();
    await page.locator("#shortcutCreateBatch").click();
    await page.locator("#shortcutAuthStatus").filter({ hasText: "Reviewed synthetic batch created" }).waitFor();
    assert.equal(creations.length, 1); assert.equal(creations[0].mode, "dry_run");
    assert.equal(await page.locator("#shortcutBatch").inputValue(), batchId);
    assert.equal(await page.locator("#shortcutCapability").inputValue(), capability);
    await page.locator("#shortcutCopy").click();
    await page.locator("#shortcutStatus").filter({ hasText: "Launch input copied" }).waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.__copied)), { schema_version: 1, api_base: api, batch_id: batchId, capability, mode: "dry_run", expected_recipients: phones });
    await page.locator("#shortcutPrepareMode").selectOption("live_test");
    assert.equal(await page.locator("#shortcutReviewed").isChecked(), false);
    assert.ok((await page.locator("#shortcutReviewMessages textarea").evaluateAll(rows => rows.map(row => row.value))).every(text => text.includes("live_test")));
    await page.locator("#shortcutReviewed").check();
    await page.locator("#shortcutCreateBatch").click();
    await page.locator("#shortcutAuthStatus").filter({ hasText: "Reviewed synthetic batch created" }).waitFor();
    assert.equal(creations.length, 2); assert.equal(creations[1].mode, "live_test");
    assert.equal(await page.locator("#shortcutDryRun").isEnabled(), false);
    // Renew an expired existing batch with normal Auth, preserving an existing result outbox.
    await page.locator("#shortcutForgetAdmin").click();
    batchId = identifier("5", 1); currentMode = "dry_run"; oldExpired = true;
    await page.locator("#shortcutBatch").fill(batchId);
    await page.locator("#shortcutCapability").fill(capability);
    await page.locator("#shortcutInspect").click();
    await page.locator("#shortcutStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(await page.locator("#shortcutRenew").isEnabled(), false);
    const beforeMissingAuth = calls.length;
    await page.locator("#shortcutRenew").dispatchEvent("click");
    await page.locator("#shortcutStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(calls.length, beforeMissingAuth, "renewal requires a normal signed-in user");
    await signIn(true);
    await page.locator("#shortcutBatch").fill("invalid");
    assert.equal(await page.locator("#shortcutRenew").isEnabled(), false);
    const beforeInvalid = calls.length;
    await page.locator("#shortcutRenew").dispatchEvent("click");
    await page.locator("#shortcutStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(calls.length, beforeInvalid, "invalid batch IDs cannot reach authorization");
    await page.locator("#shortcutBatch").fill(identifier("9", 1));
    await page.locator("#shortcutRenew").click();
    await page.locator("#shortcutStatus").filter({ hasText: "Operation stopped" }).waitFor();
    assert.equal(await page.locator("#shortcutCapability").inputValue(), capability, "a denied wrong batch cannot replace authorization");
    await page.locator("#shortcutBatch").fill(batchId);
    await page.locator("#shortcutCapability").fill("");
    const outbox = await page.evaluate(async batch => {
      const id = "77777777-7777-4777-8777-777777777777", delivery = "88888888-8888-4888-8888-888888888888";
      const result = { event_id: id, attempt_id: id, claim_id: id, channel: "whatsapp", result: "processed", details: { text_action_completed: true, photo_action_completed: true } };
      const value = { version: 1, batch_id: batch, mode: "dry_run", active_run: null, attempts: { [id]: { attempt_id: id, delivery_id: delivery, claim_id: id, event_id: id, phase: "result_pending", required_actions: { text: true, photo: true }, completed_actions: { text: true, photo: true }, started_actions: { text: true, photo: true }, result, acknowledged: false } } };
      const store = window.RSVPShortcutsTestPage.createIndexedDBStore();
      await store.compareAndSwap("rsvp-shortcut-device:v1:" + batch, 0, value);
      return value;
    }, batchId);
    zeroPending = true;
    const beforeRenew = calls.length;
    await page.locator("#shortcutRenew").click();
    await page.locator("#shortcutStatus").filter({ hasText: "Authorization renewed for the same batch" }).waitFor();
    assert.equal(await page.locator("#shortcutBatch").inputValue(), batchId);
    assert.equal(await page.locator("#shortcutCapability").inputValue(), currentCapability);
    assert.deepEqual(calls.slice(beforeRenew).map(call => new URL(call.url).pathname), ["/functions/v1/invitation-shortcuts/batches/" + batchId + "/authorization", "/functions/v1/invitation-shortcuts/batches/" + batchId]);
    const beforeUpload = calls.length;
    await page.locator("#shortcutRetry").click();
    await page.locator("#shortcutBrowserStatus").filter({ hasText: "Pending browser results uploaded" }).waitFor();
    assert.equal(calls.length, beforeUpload + 1); assert.equal(callbackUploads, 1);
    assert.ok(calls.at(-1).url.endsWith("/results"));
    assert.deepEqual(calls.at(-1).body, Object.values(outbox.attempts)[0].result);
    assert.equal(creations.length, 2, "renewal/uploader never prepares another batch");
    assert.equal(renewals.length, 2, "only explicit valid and denied wrong-batch requests reached renewal");
    const storedOutbox = await page.evaluate(async batch => window.RSVPShortcutsTestPage.createIndexedDBStore().load("rsvp-shortcut-device:v1:" + batch), batchId);
    assert.equal(storedOutbox.value.batch_id, batchId);
    assert.equal(Object.values(storedOutbox.value.attempts)[0].delivery_id, Object.values(outbox.attempts)[0].delivery_id);
    assert.equal(Object.values(storedOutbox.value.attempts)[0].acknowledged, true);
    for (const privateValue of [jwt, password, capability, currentCapability, ...phones]) assert.equal(JSON.stringify(storedOutbox).includes(privateValue), false);
    const persistent = await context.storageState();
    assert.deepEqual(persistent.cookies, []);
    assert.ok(persistent.origins.every(origin => origin.localStorage.length === 0));
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.deepEqual(await page.evaluate(() => indexedDB.databases().then(databases => databases.map(database => database.name))), ["rsvp-shortcuts-browser-dry-run-v1"]);
    for (const secret of [jwt, password, "synthetic_refresh_not_persisted"])
      assert.equal((await page.content()).includes(secret), false);
    assert.ok(calls.every(call => !call.url.includes(jwt) && !call.url.includes(password) && !call.url.includes(capability)));
    assert.equal(calls.some(call => /publish|grant|\/admin\/|signup|claims|sent/i.test(new URL(call.url).pathname)), false);
    await page.locator("#shortcutForgetAdmin").click();
    assert.equal(await page.locator("#shortcutCreateBatch").isEnabled(), false);
    assert.equal(await page.locator("#shortcutReview").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log("PASS normal Auth pilot: password endpoint/public apikey, immediate password clearing, protected administrator RPC, strict fixture/review/revision gates, both batch modes, expired/empty-cap same-batch renewal, callback-only outbox recovery and no auth/token persistence, grants, publication or sends.");
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
