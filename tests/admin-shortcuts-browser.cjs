// Actual organizer module, isolated synthetic records and injected guarded operations.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), api = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/invitation-shortcuts";
const id = number => number.toString(16).padStart(8, "0") + "-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = new Date().toISOString(), future = new Date(Date.now() + 1800000).toISOString(), past = new Date(Date.now() - 1800000).toISOString();
function fixture() {
  const store = { settings: { is_published: true, apple_shortcuts_enabled: true }, queue: [], households: [], guests: [], deliveries: [], submissions: [], shortcutBatches: [], shortcutItems: [], shortcutAttempts: [] };
  for (let number = 1; number <= 16; number++) {
    store.households.push({ id: id(100 + number), household_name: "Synthetic household " + number, invite_code: "TEST" + String(number).padStart(4, "0"), rsvp_state: "open", first_visited_at: null, last_visited_at: null, visit_count: 0 });
    store.guests.push({ id: id(200 + number), household_id: id(100 + number) });
    store.queue.push({ id: id(400 + number), household_id: id(100 + number), revision: 1, status: "ready", channel: "whatsapp", message_body: "Synthetic message " + number + " https://example.invalid/?=TEST" + String(number).padStart(4, "0"), invitation_code_snapshot: "TEST" + String(number).padStart(4, "0"), recipient_snapshot: { contact_name: "Synthetic recipient " + number, contact_value: "+1202555" + String(number).padStart(4, "0") }, message_image: number === 13 ? { image: "data:image/jpeg;base64,/9j/2Q==" } : null });
  }
  for (const [number, state, expiry, active] of [[12, "processed", future, false], [13, "partial", future, false], [14, "claimed", future, false], [15, "pending", future, false], [16, "claimed", future, true]]) {
    store.shortcutBatches.push({ id: id(900 + number), mode: "live", created_by: id(1), created_at: now, expires_at: expiry, revoked_at: null });
    store.shortcutItems.push({ batch_id: id(900 + number), queue_id: id(400 + number), ordinal: 1, expected_revision: 1 });
    store.shortcutAttempts.push({ id: id(1000 + number), batch_id: id(900 + number), queue_id: id(400 + number), attempt_number: 1, state, started_at: state === "pending" ? null : now, completed_at: ["processed", "partial"].includes(state) ? now : null, text_processed: ["processed", "partial"].includes(state), photo_processed: state === "processed", error_stage: state === "partial" ? "photo" : null, error_message: state === "partial" ? "image_fetch_failed" : null, claim_active: active });
  }
  store.households[11].first_visited_at = past;
  store.households[11].last_visited_at = now;
  store.households[11].visit_count = 2;
  store.queue.push({ ...store.queue[0], id: id(600), channel: "email" }, { ...store.queue[0], id: id(601), channel: "sms" }, { ...store.queue[0], id: id(602), channel: "manual" }, { ...store.queue[0], id: id(603), status: "draft" }, { ...store.queue[0], id: id(604), recipient_snapshot: { contact_value: "bad phone" } }, { ...store.queue[0], id: id(605), message_body: "Unresolved {household_name}" });
  return store;
}
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1160, height: 850 } }), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><main class="site-width"><section id="shortcutBatchHost" class="panel"></section><div id="householdFacts"></div></main></body></html>' });
    });
    await page.goto("https://synthetic.invalid/");
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, "css/app.css"), "utf8") });
    const english = JSON.parse(fs.readFileSync(path.join(root, "locales/en/interface.json"), "utf8"));
    await page.evaluate(({ english, api, actor }) => {
      const T = key => english.messages[key.replace(/^interface\.messages\./, "")] || key;
      const R = { byId: value => document.getElementById(value), householdName: value => value.household_name,
        dom(tag, attributes = {}, value) {
          const element = document.createElement(tag);
          for (const [key, item] of Object.entries(attributes)) {
            if (typeof item === "boolean") element[key] = item;
            else element.setAttribute(key, item);
          }
          if (value !== undefined) element.textContent = String(value);
          return element;
        } };
      const h = window.h = { store: null, actor, full: true, send: true, invites: true, secure: true, calls: [], copies: [], notices: [], reloads: 0,
        confirmResult: true, changeActorOnConfirm: false, failCreate: false, holdCreate: false, sequence: 0, T, R, api };
      window.RSVP_INVITATION_IMAGE = { preview(host, value) { if (value?.image) { const image = document.createElement("img"); image.src = value.image; host.append(image); } } };
      h.rpc = async (name, args) => {
        h.calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
        if (name === "admin_create_shortcut_batch") {
          h.sequence++;
          const batch = { id: (3000 + h.sequence).toString(16).padStart(8, "0") + "-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mode: args.p_mode, created_by: h.actor, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1800000).toISOString(), revoked_at: null };
          h.store.shortcutBatches.push(batch);
          args.p_items.forEach((item, index) => {
            const previous = h.store.shortcutAttempts.filter(value => value.queue_id === item.queue_id).sort((a, b) => b.attempt_number - a.attempt_number)[0];
            h.store.shortcutItems.push({ batch_id: batch.id, queue_id: item.queue_id, ordinal: index + 1, expected_revision: item.expected_revision });
            h.store.shortcutAttempts.push({ id: (4000 + h.sequence * 20 + index).toString(16).padStart(8, "0") + "-aaaa-4aaa-8aaa-aaaaaaaaaaaa", batch_id: batch.id, queue_id: item.queue_id, attempt_number: (previous?.attempt_number || 0) + 1, state: "pending", text_processed: !!previous?.text_processed, photo_processed: !!previous?.photo_processed, claim_active: false });
          });
          const result = { batch_id: batch.id, capability: "synthetic_capability_" + String(h.sequence).repeat(48), mode: batch.mode, count: args.p_items.length, expires_at: batch.expires_at };
          h.lastCapability = result.capability;
          if (h.failCreate) { h.failCreate = false; throw Error("synthetic timeout after preparation"); }
          if (h.holdCreate) await new Promise(resolve => { h.releaseCreate = resolve; });
          return result;
        }
        if (name === "admin_manage_shortcut_batch") {
          const batch = h.store.shortcutBatches.find(value => value.id === args.p_batch_id);
          if (args.p_action === "revoke") { batch.revoked_at = new Date().toISOString(); return { batch_id: batch.id, revoked: true }; }
          batch.expires_at = new Date(Date.now() + 1800000).toISOString();
          h.lastCapability = "synthetic_renewed_capability_" + "r".repeat(48);
          return { batch_id: batch.id, capability: h.lastCapability, mode: batch.mode, count: h.store.shortcutItems.filter(value => value.batch_id === batch.id).length, expires_at: batch.expires_at };
        }
        throw Error("Unexpected operation");
      };
    }, { english, api, actor: id(1) });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, "js/admin-shortcuts.js"), "utf8") });
    await page.evaluate(() => {
      const h = window.h;
      h.view = window.RSVP_ADMIN_SHORTCUTS.create({ R: h.R, T: h.T, getStore: () => h.store,
        can: permission => permission === "sendInvites" ? h.send : permission === "full" ? h.full : h.invites,
        getActor: () => h.actor, managementRpc: h.rpc, reload: async () => { h.reloads++; return true; },
        adminTime: value => value, show: value => h.notices.push(value), apiBase: () => h.secure ? h.api : null,
        isSecure: () => h.secure, confirm: async () => { if (h.changeActorOnConfirm) h.actor = "different-actor"; return h.confirmResult; },
        clipboard: { writeText: async value => h.copies.push(value) } });
    });
    async function reset(options = {}) {
      await page.evaluate(({ store, options, actor }) => {
        Object.assign(window.h, { store, actor, full: true, send: true, invites: true, secure: true, calls: [], copies: [], notices: [], reloads: 0, confirmResult: true, changeActorOnConfirm: false, failCreate: false, holdCreate: false, ...options });
        window.h.view.clear(); window.h.view.render();
      }, { store: fixture(), options, actor: id(1) });
    }
    const selection = number => page.locator('[data-shortcut-select="' + id(400 + number) + '"]');
    const ack = kind => page.locator('[data-shortcut-reviewed="' + kind + '"]');
    const create = kind => page.locator('[data-shortcut-create="' + kind + '"]');
    async function settled() { await page.waitForFunction(() => document.getElementById("shortcutBatchHost").getAttribute("aria-busy") === "false"); }
    async function newSelection(numbers) { for (const number of numbers) await selection(number).check(); await ack("new").check(); }
    async function openBatch(batchId) { await page.locator('[data-shortcut-batch="' + batchId + '"]').evaluate(element => { element.open = true; }); }
    await reset();
    const projected = await page.evaluate(() => {
      const value = window.RSVP_ADMIN_SHORTCUTS.projection(window.h.store);
      return { ready: value.readyCount, kinds: Object.fromEntries(value.entries.map(entry => [entry.queue.id, entry.kind])) };
    });
    assert.equal(projected.ready, 11, "Ready count excludes processed, active and explicit-retry drafts");
    assert.equal(projected.kinds[id(412)], "processed");
    assert.equal(projected.kinds[id(413)], "retry");
    assert.equal(projected.kinds[id(414)], "retry", "expired claim is uncertain, not automatically Ready");
    assert.equal(projected.kinds[id(415)], "active");
    assert.equal(projected.kinds[id(416)], "active");
    assert.equal(await selection(12).count(), 0, "processed attempts cannot be selected again");
    assert.equal(await selection(15).count(), 0, "active batch is resumed rather than recreated");
    await page.evaluate(() => { window.h.store.settings.is_published = false; window.h.view.render(); });
    assert.equal(await selection(1).isDisabled(), true, "unpublished event cannot prepare live batches");
    assert.equal(await page.locator(".shortcut-batch").count(), 5, "history remains readable before publication");
    await reset({ secure: false });
    assert.equal(await selection(1).isDisabled(), true, "HTTP callback configuration cannot enable sending");
    await reset({ send: false });
    assert.equal(await selection(1).isDisabled(), true);
    assert.equal(await page.locator(".shortcut-batch").count(), 5);
    assert.equal(await page.locator("[data-shortcut-resume]").count(), 0, "read-only organizer cannot obtain credentials");
    await reset();
    for (let number = 1; number <= 10; number++) await selection(number).check();
    assert.equal(await selection(11).isDisabled(), true, "eleventh selection is blocked");
    await selection(1).uncheck(); await selection(11).check();
    await ack("new").check(); await create("new").click(); await settled();
    let result = await page.evaluate(() => ({ calls: window.h.calls, batches: window.h.store.shortcutBatches, queue: window.h.store.queue, visits: window.h.store.households[11].visit_count }));
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].name, "admin_create_shortcut_batch");
    assert.deepEqual(result.calls[0].args.p_items.map(item => item.queue_id), Array.from({ length: 10 }, (_, i) => id(402 + i)));
    assert.ok(result.calls[0].args.p_items.every(item => item.expected_revision === 1));
    assert.equal(result.calls[0].args.p_retry, false);
    assert.equal(result.calls[0].args.p_mode, "live");
    assert.ok(result.queue.every(queue => queue.status !== "sent" && !queue.handed_to_shortcuts_at && !queue.shortcuts_processed_at && !queue.verified_sent_at), "batch preparation cannot mark handoff/processed/Sent/verified");
    assert.equal(result.visits, 2, "delivery actions do not alter visits or RSVP");
    const createdBatch = result.batches.at(-1).id;
    await page.locator("[data-shortcut-copy]").click();
    const copied = await page.evaluate(() => JSON.parse(window.h.copies.at(-1)));
    assert.equal(copied.api_base, api); assert.equal(copied.batch_id, createdBatch); assert.equal(copied.mode, "live");
    assert.equal(copied.expected_recipients.length, 10);
    assert.equal((await page.content()).includes(copied.capability), false, "capability never enters DOM");
    assert.equal((await page.locator("body").textContent()).includes(copied.capability), false);
    for (const kind of ["runner", "uploader"]) {
      const target = await page.locator('[data-shortcut-launch="' + kind + '"]').getAttribute("href");
      assert.match(target, /^shortcuts:\/\/run-shortcut\?name=RSVP%20/); assert.ok(target.endsWith("&input=clipboard"));
      assert.equal(target.includes(copied.capability), false);
      assert.ok(copied.expected_recipients.every(value => !target.includes(value)));
    }
    await openBatch(createdBatch);
    await page.locator('[data-shortcut-resume="' + createdBatch + '"]').click(); await settled();
    result = await page.evaluate(() => ({ calls: window.h.calls, attempts: window.h.store.shortcutAttempts.length }));
    assert.equal(result.calls.filter(call => call.name === "admin_create_shortcut_batch").length, 1, "resume never creates another batch");
    assert.deepEqual(result.calls.at(-1), { name: "admin_manage_shortcut_batch", args: { p_batch_id: createdBatch, p_action: "renew" } });
    assert.equal(result.attempts, 15, "renew preserves all existing runs");
    await page.locator("[data-shortcut-copy]").click();
    assert.notEqual(await page.evaluate(() => JSON.parse(window.h.copies.at(-1)).capability), copied.capability);
    await page.evaluate(() => { window.h.actor = "new-actor"; window.h.view.render(); });
    assert.equal(await page.locator("[data-shortcut-copy]").count(), 0, "actor change clears retained authorization");

    await reset(); await newSelection([1]);
    await page.evaluate(() => { window.h.store.queue[0].revision++; window.h.view.render(); });
    assert.equal(await selection(1).isChecked(), false, "revision changes invalidate selection");
    assert.equal(await ack("new").isChecked(), false);
    assert.equal(await create("new").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);

    await reset({ failCreate: true }); await newSelection([1]); await create("new").click(); await settled();
    assert.equal(await page.evaluate(() => window.h.calls.length), 1, "uncertain create is never automatically retried");
    assert.equal(await selection(2).isDisabled(), true, "uncertain outcomes require history refresh");
    await page.locator("[data-shortcut-refresh]").click(); await settled();
    assert.equal(await selection(2).isDisabled(), false);
    assert.equal(await page.evaluate(() => window.h.calls.length), 1);

    await reset();
    await page.locator("details.shortcut-selection").evaluate(element => { element.open = true; });
    await selection(13).check(); await ack("retry").check();
    assert.equal(await create("retry").isDisabled(), true, "retry needs a separate stopped-device acknowledgment");
    await page.locator("[data-shortcut-retry-acknowledged]").check();
    await page.evaluate(() => { window.h.confirmResult = false; });
    await create("retry").click(); await settled();
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);
    await page.evaluate(() => { window.h.confirmResult = true; });
    await create("retry").click(); await settled();
    result = await page.evaluate(() => ({ calls: window.h.calls, attempts: window.h.store.shortcutAttempts }));
    assert.deepEqual(result.calls[0].args, { p_items: [{ queue_id: id(413), expected_revision: 1 }], p_mode: "live", p_retry: true });
    assert.equal(result.attempts.filter(attempt => attempt.queue_id === id(413)).length, 2);
    assert.ok(result.attempts.filter(attempt => attempt.queue_id === id(413)).every(attempt => attempt.text_processed && !attempt.photo_processed), "explicit retry carries text completion and retains photo failure");

    await reset(); await openBatch(id(915));
    await page.evaluate(() => { window.h.changeActorOnConfirm = true; });
    await page.locator('[data-shortcut-revoke="' + id(915) + '"]').click(); await settled();
    assert.equal(await page.evaluate(() => window.h.calls.length), 0, "account change during confirmation cancels mutation");

    await reset();
    await page.locator("details.shortcut-selection").evaluate(element => { element.open = true; });
    await selection(13).check(); await ack("retry").check(); await page.locator("[data-shortcut-retry-acknowledged]").check();
    await page.evaluate(() => { window.h.changeActorOnConfirm = true; });
    await create("retry").click(); await settled();
    assert.equal(await page.evaluate(() => window.h.calls.length), 0, "account change during retry confirmation cancels preparation");

    await reset({ secure: false });
    await page.evaluate(() => { window.h.store.settings.is_published = false; window.h.view.render(); });
    await openBatch(id(915));
    assert.equal(await page.locator('[data-shortcut-resume="' + id(915) + '"]').isDisabled(), true);
    await page.locator('[data-shortcut-revoke="' + id(915) + '"]').click(); await settled();
    assert.deepEqual(await page.evaluate(() => window.h.calls), [{ name: "admin_manage_shortcut_batch", args: { p_batch_id: id(915), p_action: "revoke" } }], "existing authorization can still be revoked before publication/onHTTP");

    await reset({ holdCreate: true }); await newSelection([1]); await create("new").click();
    await page.waitForFunction(() => !!window.h.releaseCreate);
    await page.evaluate(() => { window.h.view.clear(); window.h.releaseCreate(); }); await settled();
    assert.equal(await page.locator("[data-shortcut-copy]").count(), 0, "clear invalidates in-flight authorization even for the same user");

    await reset();
    const facts = page.locator('[data-shortcut-attempt="' + id(1012) + '"]');
    assert.equal(await facts.locator('[data-shortcut-fact="processed"]').textContent(), now);
    assert.equal(await facts.locator('[data-shortcut-fact="verified"]').textContent(), english.messages.shortcut_unverified);
    assert.equal(await facts.locator('[data-shortcut-fact="confirmed"]').textContent(), english.messages.shortcut_not_yet);
    assert.equal(await facts.locator('[data-shortcut-fact="visits"]').textContent(), "2");
    assert.equal(await facts.locator('[data-shortcut-fact="rsvp"]').textContent(), english.messages.invitation_custom_awaiting_reply, "visits and processing do not imply RSVP");
    assert.equal(await facts.locator('[data-shortcut-fact="first_visit"]').textContent(), past);
    assert.equal(await facts.locator('[data-shortcut-fact="last_visit"]').textContent(), now);
    await page.evaluate(() => { const h = window.h; document.getElementById("householdFacts").append(h.view.householdFacts(h.store.households[0])); });
    assert.equal(await page.locator('#householdFacts [data-shortcut-fact="visits"]').textContent(), "0", "households without a batch still expose independent visits");
    for (const width of [390, 1160]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "fits viewport " + width);
    }
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, "no capabilities or recipient data persist");
    assert.equal(requests.length, 1, "module performs no network operations besides injected authorized RPCs");
    assert.deepEqual(errors, []);
    console.log("PASS organizer Shortcuts: publication/HTTPS/permission gates, max10/review/revisions, safe create/resume/retry/clear, independent delivery/visits/RSVP, private clipboard and390/1160 layout.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
