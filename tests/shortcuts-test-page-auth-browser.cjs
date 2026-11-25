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
const sourceBatch = identifier("7", 1);
const selectedRows = (data, mode = "live_test") => data.queue.filter(row => row.message_subject.endsWith(" / " + mode)).sort((a, b) => a.household_id.localeCompare(b.household_id));
function retryFixture() {
  const data = fixture(), rows = selectedRows(data);
  data.shortcutBatches = [{ id: sourceBatch, mode: "live_test", revoked_at: null }];
  data.shortcutItems = rows.map((row, index) => ({ batch_id: sourceBatch, queue_id: row.id, expected_revision: row.revision, ordinal: index + 1 }));
  data.shortcutAttempts = rows.map((row, index) => ({ id: identifier("6", index + 1), batch_id: sourceBatch, queue_id: row.id, attempt_number: 1,
    state: index === 0 ? "unknown" : "pending", text_processed: false, photo_processed: false, completed_at: null, claim_active: false }));
  return data;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
(async () => {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext(), page = await context.newPage(), errors = [], calls = [], creations = [];
    await context.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async value => { window.__copied = value; } } }));
    page.on("pageerror", error => errors.push(error.message));
    let data = fixture(), denyAdmin = true, currentMode = "dry_run", batchId = identifier("5", 1), passwordWasCleared = false;
    let currentCapability = capability, oldExpired = false, zeroPending = false, callbackUploads = 0;
    const renewals = [], revocations = [], retryCreations = [];
    let revokeFailure = null, retryFailure = null, inspectFailure = false, adminGate = null, revokeGate = null, createGate = null;
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
        if (adminGate) { const gate = adminGate; adminGate = null; gate.arrived.resolve(); await gate.release.promise; }
        return denyAdmin ? json({ message: "Synthetic administrator permission failure" }, 403) : json(data);
      }
      if (url === api + "/batches") {
        assert.equal(request.headers().apikey, publicKey); assert.equal(request.headers().authorization, "Bearer " + jwt);
        const body = request.postDataJSON();
        assert.ok(["dry_run", "live_test"].includes(body.mode));
        assert.deepEqual(body.items, selectedRows(data, body.mode).map(row => ({ queue_id: row.id, expected_revision: row.revision })));
        if (body.retry === true) {
          assert.deepEqual(Object.keys(body).sort(), ["items", "mode", "retry"]); assert.equal(body.mode, "live_test");
          assert.ok(data.shortcutBatches.find(row => row.id === sourceBatch).revoked_at, "source must be retired before retry creation");
          retryCreations.push(body); currentMode = "live_test"; batchId = identifier("8", retryCreations.length);
          currentCapability = "synthetic_retry_capability_" + "r".repeat(40); oldExpired = false; zeroPending = false;
          // A committed create is retained even when its HTTP response is lost.
          data.shortcutBatches.push({ id: batchId, mode: currentMode, revoked_at: null });
          data.shortcutItems.push(...body.items.map((row, index) => ({ ...row, batch_id: batchId, ordinal: index + 1 })));
          data.shortcutAttempts.push(...body.items.map((row, index) => ({ id: identifier("9", retryCreations.length * 6 + index), batch_id: batchId,
            queue_id: row.queue_id, attempt_number: 2, state: "pending", text_processed: false, photo_processed: false, completed_at: null, claim_active: false })));
          if (createGate) { const gate = createGate; createGate = null; gate.arrived.resolve(); await gate.release.promise; }
          if (retryFailure === "lost") return route.abort();
          return json({ schema_version: 1, batch_id: batchId, capability: currentCapability, mode: retryFailure === "mode" ? "live" : currentMode,
            count: retryFailure === "count" ? 5 : 6 }, 201);
        }
        assert.deepEqual(Object.keys(body).sort(), ["items", "mode"]);
        creations.push(body); currentMode = body.mode; batchId = identifier("5", creations.length); currentCapability = capability;
        return json({ schema_version: 1, batch_id: batchId, capability, mode: currentMode, count: 6 }, 201);
      }
      if (url.startsWith(api + "/batches/") && url.endsWith("/authorization")) {
        assert.equal(request.headers().apikey, publicKey); assert.equal(request.headers().authorization, "Bearer " + jwt);
        if (request.postDataJSON().action === "revoke") {
          assert.deepEqual(request.postDataJSON(), { action: "revoke" });
          assert.equal(url, api + "/batches/" + sourceBatch + "/authorization"); revocations.push(url);
          if (revokeGate) { const gate = revokeGate; revokeGate = null; gate.arrived.resolve(); await gate.release.promise; }
          if (revokeFailure === "error") return json({ error: "Synthetic retirement denied" }, 403);
          data.shortcutBatches.find(row => row.id === sourceBatch).revoked_at = "2026-11-19T00:00:00.000Z";
          for (const row of data.shortcutAttempts.filter(row => row.batch_id === sourceBatch)) if (row.state === "pending") row.state = "skipped";
          if (revokeFailure === "lost") return route.abort();
          return json({ schema_version: 1, batch_id: revokeFailure === "batch" ? identifier("7", 2) : sourceBatch, revoked: revokeFailure === "boolean" ? "true" : true });
        }
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
        if (oldExpired || inspectFailure) return json({ error: "Synthetic unavailable authorization" }, 401);
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
    // Retire only explicitly cancelled, wholly unsent live_test history, then retry its same reviewed six snapshots.
    const retryButton = page.locator("#shortcutRetireRetry"), unsent = page.locator("#shortcutUnsentConfirmed");
    const retryStatus = page.locator("#shortcutRetireStatus");
    const reloadRetry = async (mutate = () => {}, options = {}) => {
      data = retryFixture(); mutate(data); revokeFailure = null; retryFailure = null; inspectFailure = false;
      await page.reload(); await signIn(true);
      await page.locator("summary").filter({ hasText: "Retry a supervised batch" }).click();
      await page.locator("#shortcutPrepareMode").selectOption(options.mode || "live_test");
      await page.locator("#shortcutBatch").fill(options.batch || sourceBatch);
      if (options.review !== false) await page.locator("#shortcutReviewed").check();
      if (options.confirm !== false && await unsent.isEnabled()) await unsent.check();
    };
    const finishRetry = async expected => {
      await page.waitForFunction(text => document.getElementById("shortcutRetireStatus").textContent.startsWith(text), expected);
    };
    const stoppedWithoutMutation = async label => {
      const before = [revocations.length, retryCreations.length];
      assert.equal(await retryButton.isEnabled(), false, label);
      await retryButton.dispatchEvent("click"); await finishRetry("Operation stopped before retirement");
      assert.deepEqual([revocations.length, retryCreations.length], before, label + " cannot revoke or create");
    };
    await reloadRetry(); await page.locator("#shortcutForgetAdmin").click();
    await stoppedWithoutMutation("missing normal administrator Auth");
    for (const [label, options] of [["dry-run review", { mode: "dry_run" }], ["missing message review", { review: false }],
      ["missing unsent acknowledgement", { confirm: false }], ["wrong source UUID", { batch: identifier("7", 2) }], ["malformed source UUID", { batch: "invalid" }]]) {
      await reloadRetry(() => {}, options); await stoppedWithoutMutation(label);
    }
    const unsafeHistory = [
      ["dry-run source", value => { value.shortcutBatches[0].mode = "dry_run"; }],
      ["production live source", value => { value.shortcutBatches[0].mode = "live"; }],
      ["missing history", value => { delete value.shortcutAttempts; }],
      ["missing source item", value => { value.shortcutItems.pop(); }],
      ["foreign queue item", value => { value.shortcutItems[0].queue_id = value.queue[0].id; }],
      ["different source revision", value => { value.shortcutItems[0].expected_revision++; }],
      ["duplicate ordinal", value => { value.shortcutItems[0].ordinal = 2; }],
      ...["processed", "partial", "claimed", "failed"].map(state => [state + " history", value => { value.shortcutAttempts[0].state = state; }]),
      ["completed caption", value => { value.shortcutAttempts[0].text_processed = true; }],
      ["completed photo", value => { value.shortcutAttempts[0].photo_processed = true; }],
      ["completed timestamp", value => { value.shortcutAttempts[0].completed_at = "2026-11-19T00:00:00Z"; }],
      ["missing typed completion", value => { delete value.shortcutAttempts[0].completed_at; }],
      ["active claim", value => { value.shortcutAttempts[0].claim_active = true; }],
      ["untyped false flag", value => { value.shortcutAttempts[0].text_processed = "false"; }],
      ["newer attempt in another batch", value => { value.shortcutAttempts.push({ ...value.shortcutAttempts[0], id: identifier("6", 9), batch_id: identifier("7", 9), attempt_number: 2 }); }],
      ["earlier completed history", value => { value.shortcutAttempts.push({ ...value.shortcutAttempts[0], id: identifier("6", 9), batch_id: identifier("7", 9), attempt_number: 0 + 1, state: "processed" }); }],
      ...["sent_at", "verified_sent_at", "shortcuts_processed_at"].map(field => [field, value => { selectedRows(value)[0][field] = "2026-11-19T00:00:00Z"; }]),
    ];
    for (const [label, mutate] of unsafeHistory) { await reloadRetry(mutate); await stoppedWithoutMutation(label); }
    await reloadRetry();
    selectedRows(data)[0].revision++;
    const beforeChanged = [revocations.length, retryCreations.length];
    await retryButton.click(); await finishRetry("Operation stopped before retirement");
    assert.deepEqual([revocations.length, retryCreations.length], beforeChanged, "a fresh revision change stops before revoke");
    assert.equal(await page.locator("#shortcutReviewed").isChecked(), false);
    assert.equal(await unsent.isChecked(), false);
    // Fresh history must also be checked after review, not only while enabling the button.
    await reloadRetry(); data.shortcutAttempts[0].claim_active = true;
    await retryButton.click(); await finishRetry("Operation stopped before retirement");
    assert.deepEqual([revocations.length, retryCreations.length], beforeChanged);
    // Changing the entered source while the read-only recheck is in flight invalidates that receipt.
    await reloadRetry(); adminGate = { arrived: deferred(), release: deferred() }; const heldAdmin = adminGate;
    await retryButton.dispatchEvent("click"); await heldAdmin.arrived.promise;
    await page.locator("#shortcutBatch").evaluate(input => { input.value = "77777777-7777-4777-8777-000000000002"; input.dispatchEvent(new Event("input")); });
    heldAdmin.release.resolve(); await finishRetry("Operation stopped before retirement");
    assert.deepEqual([revocations.length, retryCreations.length], beforeChanged, "stale rechecks cannot authorize a changed source");
    for (const failure of ["error", "lost", "batch", "boolean"]) {
      await reloadRetry(); revokeFailure = failure;
      // Previously copied source authorization must not remain launchable after uncertain management.
      batchId = sourceBatch; currentMode = "live_test"; currentCapability = capability; oldExpired = false; zeroPending = false;
      await page.locator("#shortcutCapability").fill(capability);
      await page.locator("#shortcutInspect").click();
      await page.locator("#shortcutStatus").filter({ hasText: "Authorized batch inspected" }).waitFor();
      await page.locator("#shortcutCopy").click();
      await page.locator("#shortcutStatus").filter({ hasText: "Launch input copied" }).waitFor();
      assert.equal(await page.locator("#shortcutLaunchRunner").getAttribute("aria-disabled"), "false");
      await unsent.check();
      const before = retryCreations.length;
      await retryButton.click(); await finishRetry("Source batch");
      assert.equal(retryCreations.length, before, "failed or malformed retirement cannot create");
      assert.equal(await page.locator("#shortcutCapability").inputValue(), "", "uncertain management clears old entered authorization");
      assert.equal(await page.locator("#shortcutLaunchRunner").getAttribute("aria-disabled"), "true");
      assert.equal(await page.locator("#shortcutLaunchUploader").getAttribute("aria-disabled"), "true");
      assert.equal(await page.locator("#shortcutProgress").innerText(), "");
      await unsent.check(); await stoppedWithoutMutation("uncertain retirement receipt is spent");
    }
    // A mutation response cannot carry an obsolete source or administrator scope into the next write.
    for (const changedScope of ["batch", "administrator"]) {
      await reloadRetry(); revokeGate = { arrived: deferred(), release: deferred() }; const held = revokeGate;
      const before = retryCreations.length;
      await retryButton.dispatchEvent("click"); await held.arrived.promise;
      if (changedScope === "administrator") await page.locator("#shortcutForgetAdmin").dispatchEvent("click");
      else await page.locator("#shortcutBatch").evaluate(input => { input.value = "77777777-7777-4777-8777-000000000002"; input.dispatchEvent(new Event("input")); });
      held.release.resolve(); await finishRetry("Source batch");
      assert.equal(retryCreations.length, before, "changed " + changedScope + " after revoke cannot create a retry");
      assert.ok(data.shortcutBatches[0].revoked_at, "the committed revoke remains recorded");
      assert.equal(await page.locator("#shortcutCapability").inputValue(), "");
    }
    await reloadRetry(); createGate = { arrived: deferred(), release: deferred() }; const heldCreate = createGate;
    const beforeHeldCreate = retryCreations.length;
    await retryButton.dispatchEvent("click"); await heldCreate.arrived.promise;
    await retryButton.dispatchEvent("click");
    await page.locator("#shortcutBatch").evaluate(input => { input.value = "77777777-7777-4777-8777-000000000002"; input.dispatchEvent(new Event("input")); });
    const beforeCreateRelease = calls.length;
    heldCreate.release.resolve(); await finishRetry("Source batch");
    assert.equal(retryCreations.length, beforeHeldCreate + 1, "in-flight create cannot be duplicated");
    assert.equal(calls.length, beforeCreateRelease, "a stale create response does not inspect or install launch authorization");
    assert.equal(await page.locator("#shortcutBatch").inputValue(), identifier("7", 2));
    assert.equal(await page.locator("#shortcutCapability").inputValue(), "");
    assert.equal(data.shortcutAttempts.filter(row => row.batch_id === batchId).length, 6, "stale response retains committed history");
    // Positive case: already revoked is recoverable only while every latest attempt remains in that source.
    await reloadRetry(value => { value.shortcutBatches[0].revoked_at = "2026-11-18T00:00:00Z"; });
    assert.equal(await page.locator("#shortcutCapability").inputValue(), "", "old capability and Inspect are not required");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await retryButton.isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "retry panel fits a narrow phone viewport");
    if (process.env.RSVP_RETRY_SCREENSHOT) await page.locator("details").filter({ has: retryButton }).screenshot({ path: process.env.RSVP_RETRY_SCREENSHOT });
    await page.setViewportSize({ width: 1280, height: 900 });
    const oldItems = structuredClone(data.shortcutItems), oldAttempts = structuredClone(data.shortcutAttempts), beforeSuccess = calls.length;
    revokeGate = { arrived: deferred(), release: deferred() }; const heldRevoke = revokeGate;
    await retryButton.dispatchEvent("click"); await heldRevoke.arrived.promise;
    await retryButton.dispatchEvent("click"); heldRevoke.release.resolve(); await finishRetry("Retired unsent source batch");
    assert.deepEqual(calls.slice(beforeSuccess).map(call => new URL(call.url).pathname), ["/rest/v1/rpc/admin_load_data",
      "/functions/v1/invitation-shortcuts/batches/" + sourceBatch + "/authorization", "/functions/v1/invitation-shortcuts/batches",
      "/functions/v1/invitation-shortcuts/batches/" + batchId], "one explicit revoke precedes one retry create and inspection");
    assert.deepEqual(retryCreations.at(-1), { mode: "live_test", retry: true, items: selectedRows(data).map(row => ({ queue_id: row.id, expected_revision: row.revision })) });
    assert.deepEqual(data.shortcutItems.filter(row => row.batch_id === sourceBatch), oldItems, "old item history remains intact");
    assert.deepEqual(data.shortcutAttempts.filter(row => row.batch_id === sourceBatch), oldAttempts.map(row => ({ ...row, state: row.state === "pending" ? "skipped" : row.state })), "old unknown remains unknown; no attempt is reset or removed");
    assert.equal(data.shortcutAttempts.filter(row => row.batch_id === batchId).length, 6);
    assert.equal(await page.locator("#shortcutBatch").inputValue(), batchId);
    assert.equal(await page.locator("#shortcutCapability").inputValue(), currentCapability);
    assert.match(await page.locator("#shortcutProgress").innerText(), /Mode: live_test.*Total: 6; pending: 6; claimed: 0; processed: 0/);
    await page.locator("#shortcutCopy").click();
    await page.locator("#shortcutStatus").filter({ hasText: "Launch input copied" }).waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.__copied)), { schema_version: 1, api_base: api, batch_id: batchId,
      capability: currentCapability, mode: "live_test", expected_recipients: phones });
    assert.equal(await page.locator("#shortcutDryRun").isEnabled(), false);
    assert.equal(creations.length, 2, "explicit retries do not change ordinary batch creation");
    // Lost/invalid create responses and failed post-create inspection never repeat mutations, even after forced clicks.
    for (const failure of ["lost", "mode", "count", "inspect"]) {
      await reloadRetry(); retryFailure = failure; inspectFailure = failure === "inspect";
      const before = retryCreations.length;
      await retryButton.click(); await finishRetry("Source batch");
      assert.equal(retryCreations.length, before + 1);
      assert.equal(data.shortcutAttempts.filter(row => row.batch_id === sourceBatch).length, 6);
      assert.equal(data.shortcutAttempts.filter(row => row.batch_id === batchId).length, 6, "uncertain creation retains its new history");
      const afterUncertain = [revocations.length, retryCreations.length];
      await retryButton.dispatchEvent("click"); await finishRetry("Operation stopped before retirement");
      assert.deepEqual([revocations.length, retryCreations.length], afterUncertain, "no automatic repeat after uncertain creation");
      // A fresh page/admin load cannot reuse the old source once a new latest attempt exists.
      inspectFailure = false; await page.reload(); await signIn(true);
      await page.locator("summary").filter({ hasText: "Retry a supervised batch" }).click();
      await page.locator("#shortcutPrepareMode").selectOption("live_test"); await page.locator("#shortcutBatch").fill(sourceBatch);
      await page.locator("#shortcutReviewed").check(); await unsent.check();
      await stoppedWithoutMutation("new latest retry blocks replay after page reload");
    }
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
    console.log("PASS normal Auth pilot: password endpoint/public apikey, immediate password clearing, protected administrator RPC, strict fixture/review/revision gates, both batch modes, expired/empty-cap same-batch renewal, explicit unsent six-item revoke/retry with history/revision/race/uncertainty guards, callback-only outbox recovery and no auth/token persistence, grants, publication or sends.");
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
