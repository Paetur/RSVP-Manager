// Pure reference-runner acceptance. Synthetic data; no network, device or DB.
const assert = require("node:assert/strict");
const { createRunner, createFetchTransport } = require("../js/shortcut-device-runner.js");
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = number => "00000000-0000-4000-8000-" + String(number).padStart(12, "0");
const batchId = uuid(900), apiBase = "https://backend.example.invalid/functions/v1/invitation-shortcuts";
const initialCapability = "synthetic_device_capability_" + "x".repeat(40);
const renewedCapability = "synthetic_device_capability_" + "y".repeat(40);
const recipients = ["+19995550101", "+19995550102"];
const jpeg = Uint8Array.from([255, 216, 1, 2, 3, 255, 217]);
let checks = 0, nextRun = 1000;

function fixture({ count = 1, mode = "live_test", image = true, completed = { text: false, photo: false } } = {}) {
  let document = null, revision = 0;
  const requests = [], performed = [], writes = [];
  const items = Array.from({ length: count }, (_, index) => {
    const attempt_id = uuid(index + 1), invitation_code = "AAAAAAA" + "ABCDEFGHJK"[index];
    const invitation_link = "https://site.example.invalid/event/?=" + invitation_code;
    return { attempt_id, delivery_id: uuid(index + 101), household_name: "Synthetic household " + (index + 1),
      phone: recipients[index % 2], message: "Synthetic invitation " + (index + 1) + "\n" + invitation_link,
      invitation_code, invitation_link,
      image_url: image ? apiBase + "/batches/" + batchId + "/attempts/" + attempt_id + "/image" : null };
  });
  const server = { capability: initialCapability, claims: new Map(), results: new Map(), hook: null };
  const store = {
    failSave: null,
    async load() { return { revision, value: document === null ? null : copy(document) }; },
    async compareAndSwap(key, expectedRevision, value) {
      if (expectedRevision !== revision) return false;
      if (store.failSave?.(value, document)) { store.failSave = null; throw Error("synthetic persistence failure"); }
      document = copy(value); revision++; writes.push(copy(value)); return true;
    },
  };
  const body = extra => ({ schema_version: 1, batch_id: batchId, ...extra });
  async function handler(request) {
    if (request.headers.Authorization !== "Bearer " + server.capability) return { status: 401 };
    if (request.url === apiBase + "/batches/" + batchId) {
      const statuses = items.map(item => ({ attempt_id: item.attempt_id, delivery_id: item.delivery_id,
        state: server.results.get(item.attempt_id)?.result || (server.claims.has(item.attempt_id) ? "claimed" : "pending") }));
      const invitations = items.filter(item => !server.claims.has(item.attempt_id));
      return { status: 200, body: body({ mode, invitations: copy(invitations), statuses,
        expires_at: "2099-01-01T00:00:00Z", progress: { total: items.length, pending: invitations.length } }) };
    }
    if (request.kind === "image") return { status: 200, bytes: new Uint8Array(jpeg) };
    const payload = request.body;
    if (request.url.endsWith("/claims")) {
      assert.equal(document.attempts[payload.attempt_id].phase, "claim_requested", "claim ID persisted before HTTP");
      if (server.claims.has(payload.attempt_id)) return { status: 200, body: body({ attempt_id: payload.attempt_id, claimed: false, state: "claimed" }) };
      server.claims.set(payload.attempt_id, payload.claim_id);
      return { status: 200, body: body({ attempt_id: payload.attempt_id, claimed: true, state: "claimed", mode,
        required_actions: { text: !completed.text, photo: image && !completed.photo }, completed_actions: copy(completed) }) };
    }
    assert(request.url.endsWith("/results"));
    assert.deepEqual(document.attempts[payload.attempt_id].result, payload, "entire immutable result persisted before callback");
    assert.equal(server.claims.get(payload.attempt_id), payload.claim_id);
    const previous = server.results.get(payload.attempt_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(payload)) return { status: 409 };
    server.results.set(payload.attempt_id, copy(payload));
    return { status: 200, body: body({ accepted: true, idempotent: !!previous, state: payload.result }) };
  }
  const http = async request => {
    requests.push(copy({ ...request, bytes: undefined }));
    if (server.hook) return server.hook(request, () => handler(request));
    return handler(request);
  };
  const actions = Object.fromEntries(["text", "photo"].map(name => [name, async input => {
    assert.equal(document.attempts[input.attemptId].started_actions[name], true, "Started persisted before app action");
    assert.equal(Object.hasOwn(input, "capability"), false);
    assert.equal(input.message, items.find(item => item.attempt_id === input.attemptId).message);
    if (image) assert.deepEqual(input.imageBytes, jpeg, "downloaded JPEG bytes preserved");
    performed.push({ name, attemptId: input.attemptId });
    return { completed: true };
  }]));
  function runner(extra = {}) {
    return createRunner({ apiBase, batchId, capability: initialCapability, expectedMode: mode,
      expectedRecipients: recipients, runId: uuid(nextRun++), store, http, actions, ...extra });
  }
  return { runner, store, server, requests, performed, writes, items, actions,
    document: () => copy(document),
    replaceDocument: value => { document = copy(value); revision++; },
  };
}
async function rejects(promise, code) { await assert.rejects(promise, error => error.code === code); }
async function test(name, callback) {
  await callback(); checks++; process.stdout.write("PASS " + name + "\n");
}
function assertPrivate(document) {
  const text = JSON.stringify(document);
  for (const value of [initialCapability, renewedCapability, ...recipients, "Synthetic household", "Synthetic invitation", "https://", "image_url"])
    assert.equal(text.includes(value), false, "journal excludes private payload: " + value.slice(0, 12));
}

(async () => {
  await test("six invitations, two synthetic recipients, exact actions/JPEG and callback ordering", async () => {
    const f = fixture({ count: 6 });
    assert.deepEqual(await f.runner().run(), { state: "complete", processed: 6 });
    assert.equal(f.performed.length, 12);
    assert.equal(f.server.results.size, 6);
    assert.equal(f.requests.filter(request => request.kind === "image").length, 6);
    for (const item of f.items) {
      const image = f.requests.findIndex(request => request.url === item.image_url);
      const claim = f.requests.findIndex(request => request.body?.attempt_id === item.attempt_id && request.url.endsWith("/claims"));
      assert(image < claim, "JPEG fetched before claim");
      const attempt = f.document().attempts[item.attempt_id];
      assert.equal(attempt.claim_id, item.attempt_id);
      assert.equal(attempt.event_id, item.attempt_id);
      assert.equal(attempt.acknowledged, true);
    }
    for (const document of f.writes) assertPrivate(document);
  });
  await test("dry run never invokes app actions; serialized restart processes pending items only", async () => {
    const f = fixture({ count: 6, mode: "dry_run" });
    assert.deepEqual(await f.runner().run({ limit: 2 }), { state: "paused", processed: 2 });
    assert.deepEqual(await f.runner().run(), { state: "complete", processed: 4 });
    assert.equal(f.performed.length, 0);
    assert.equal(f.server.results.size, 6);
  });
  await test("lost claim response requires review and explicit reconciliation, never automatic action", async () => {
    const f = fixture(); let lost = false;
    f.server.hook = async (request, handle) => {
      const response = await handle();
      if (request.url.endsWith("/claims") && !lost) { lost = true; throw Error("lost claim reply"); }
      return response;
    };
    await rejects(f.runner().run(), "transport_failed");
    assert.equal((await f.runner().run()).state, "review_required");
    assert.equal(f.server.results.size, 0, "restart does not invent a callback before review");
    await rejects(f.runner().reconcile(), "confirmation_required");
    await f.runner().reconcile({ confirmStopped: true });
    assert.equal(f.server.results.get(uuid(1)).result, "unknown");
    assert.equal(f.performed.length, 0);
    assert.equal(f.requests.filter(request => request.url.endsWith("/claims")).length, 1);
  });
  await test("interruption after action began never repeats that action", async () => {
    const f = fixture();
    f.store.failSave = value => value.attempts[uuid(1)]?.completed_actions.text === true;
    await rejects(f.runner().run(), "store_failed");
    assert.equal(f.document().attempts[uuid(1)].started_actions.text, true);
    assert.equal(f.document().attempts[uuid(1)].completed_actions.text, false);
    assert.equal((await f.runner().run()).state, "review_required");
    await f.runner().reconcile({ confirmStopped: true });
    assert.deepEqual(f.performed.map(action => action.name), ["text"]);
    assert.equal(f.server.results.get(uuid(1)).result, "unknown");
  });
  await test("interruption between text and photo preserves known completion and reports partial on review", async () => {
    const f = fixture();
    f.store.failSave = value => value.attempts[uuid(1)]?.started_actions.photo === true;
    await rejects(f.runner().run(), "store_failed");
    assert.equal((await f.runner().run()).state, "review_required");
    await f.runner().reconcile({ confirmStopped: true });
    assert.deepEqual(f.performed.map(action => action.name), ["text"]);
    assert.deepEqual(f.server.results.get(uuid(1)).details, {
      text_action_completed: true, photo_action_completed: false, error_stage: "unknown", error_code: "unknown",
    });
    assert.equal(f.server.results.get(uuid(1)).result, "partial");
  });
  await test("storage failure before Started prevents the external action", async () => {
    const f = fixture();
    f.store.failSave = value => value.attempts[uuid(1)]?.started_actions.text === true;
    await rejects(f.runner().run(), "store_failed");
    assert.equal(f.performed.length, 0);
    assert.equal(f.server.results.size, 0);
    assert.equal((await f.runner().run()).state, "review_required");
  });
  await test("storage failure before claim HTTP prevents claim and every app action", async () => {
    const f = fixture();
    f.store.failSave = value => value.attempts[uuid(1)]?.phase === "claim_requested";
    await rejects(f.runner().run(), "store_failed");
    assert.equal(f.server.claims.size, 0); assert.equal(f.performed.length, 0);
  });
  await test("storage failure before result prevents callback; review retains completed actions", async () => {
    const f = fixture();
    f.store.failSave = value => value.attempts[uuid(1)]?.phase === "result_pending";
    await rejects(f.runner().run(), "store_failed");
    assert.equal(f.server.results.size, 0);
    assert.equal(f.document().attempts[uuid(1)].result, null);
    await f.runner().reconcile({ confirmStopped: true });
    assert.equal(f.server.results.get(uuid(1)).result, "processed");
    assert.equal(f.performed.length, 2);
  });
  await test("lost callback response replays only the same persisted result/event ID", async () => {
    const f = fixture(); let lost = false;
    f.server.hook = async (request, handle) => {
      const response = await handle();
      if (request.url.endsWith("/results") && !lost) { lost = true; throw Error("lost callback reply"); }
      return response;
    };
    await rejects(f.runner().run(), "transport_failed");
    const result = f.document().attempts[uuid(1)].result;
    await f.runner().retryCallbacks();
    assert.equal(f.performed.length, 2);
    const callbacks = f.requests.filter(request => request.url.endsWith("/results"));
    assert.equal(callbacks.length, 2);
    callbacks.forEach(request => assert.deepEqual(request.body, result));
    assert.equal(f.document().attempts[uuid(1)].acknowledged, true);
  });
  await test("acknowledgment persistence failure replays the immutable outbox without actions", async () => {
    const f = fixture();
    f.store.failSave = value => value.attempts[uuid(1)]?.acknowledged === true;
    await rejects(f.runner().run(), "store_failed");
    assert.equal(f.document().attempts[uuid(1)].phase, "result_pending");
    await f.runner().retryCallbacks();
    assert.equal(f.performed.length, 2);
    assert.equal(f.server.results.size, 1);
    assert.equal(f.requests.filter(request => request.url.endsWith("/results")).length, 2);
  });
  await test("expired capability retains outbox; same-batch renewal remains in RAM", async () => {
    const f = fixture();
    f.server.hook = async (request, handle) => request.url.endsWith("/results") ? { status: 401 } : handle();
    await rejects(f.runner().run(), "authorization_required");
    const before = f.document().attempts[uuid(1)].result;
    const resumed = f.runner();
    assert.throws(() => resumed.replaceCapability({ batchId: uuid(901), capability: renewedCapability }), error => error.code === "configuration");
    resumed.replaceCapability({ batchId, capability: renewedCapability });
    f.server.capability = renewedCapability; f.server.hook = null;
    await resumed.retryCallbacks();
    assert.deepEqual(f.server.results.get(uuid(1)), before);
    assert.equal(f.performed.length, 2);
    assertPrivate(f.document());
  });
  await test("conflicting callback stops and retains the outbox", async () => {
    const f = fixture();
    f.server.hook = async (request, handle) => request.url.endsWith("/results") ? { status: 409 } : handle();
    await rejects(f.runner().run(), "conflict");
    assert.equal(f.document().attempts[uuid(1)].acknowledged, false);
    assert.equal(f.performed.length, 2);
  });
  await test("only exact successful callback acknowledgments remove pending status", async () => {
    for (const patch of [{ accepted: false }, { state: "failed" }, { batch_id: uuid(901) }, { idempotent: "true" }]) {
      const f = fixture();
      f.server.hook = async (request, handle) => {
        const response = await handle();
        return request.url.endsWith("/results") ? { ...response, body: { ...response.body, ...patch } } : response;
      };
      await assert.rejects(f.runner().run());
      assert.equal(f.document().attempts[uuid(1)].acknowledged, false);
    }
  });
  await test("corrupt or payload-bearing journals fail closed before HTTP", async () => {
    const f = fixture(); await f.runner().run();
    const corrupt = f.document(); corrupt.attempts[uuid(1)].phone = recipients[0]; f.replaceDocument(corrupt);
    const count = f.requests.length;
    await rejects(f.runner().run(), "corrupt_journal");
    assert.equal(f.requests.length, count);
  });
  await test("duplicate launch and repeated claim never repeat external actions", async () => {
    const f = fixture(); await f.runner().run();
    assert.deepEqual(await f.runner().run(), { state: "complete", processed: 0 });
    assert.equal(f.performed.length, 2);
    const g = fixture(); g.server.claims.set(uuid(1), uuid(1));
    // Mimic a stale Pending manifest from before another device claimed it.
    g.server.hook = async (request, handle) => {
      const response = await handle();
      if (request.url === apiBase + "/batches/" + batchId) response.body.invitations = copy(g.items);
      return response;
    };
    assert.equal((await g.runner().run()).state, "review_required");
    assert.equal(g.performed.length, 0);
  });
  await test("atomic storage lock rejects concurrent runs; stranded lock needs explicit recovery", async () => {
    const f = fixture(); let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const originalText = f.actions.text;
    f.actions.text = async input => { entered(); await gate; return originalText(input); };
    const first = f.runner(), pending = first.run(); await started;
    await rejects(f.runner().run(), "busy");
    await rejects(first.run(), "busy");
    release(); await pending;
    const stranded = f.document(); stranded.active_run = uuid(888); f.replaceDocument(stranded);
    await rejects(f.runner().run(), "busy");
    await f.runner().reconcile({ confirmStopped: true });
    assert.equal(f.document().active_run, null);
    assert.equal(f.performed.length, 2);
  });
  await test("CAS conflict before lock acquisition permits only one run", async () => {
    const f = fixture(); const original = f.store.compareAndSwap;
    let conflict = true;
    f.store.compareAndSwap = async (...args) => {
      if (conflict) { conflict = false; return false; }
      return original(...args);
    };
    await rejects(f.runner().run(), "busy");
    assert.equal(f.requests.length, 0); assert.equal(f.performed.length, 0);
    await f.runner().run(); assert.equal(f.performed.length, 2);
  });
  await test("image failure or invalid bytes never claim or complete an invitation", async () => {
    for (const response of [{ status: 503 }, { status: 200, bytes: Uint8Array.from([1, 2, 3, 4]) }]) {
      const f = fixture();
      f.server.hook = async (request, handle) => request.kind === "image" ? response : handle();
      await assert.rejects(f.runner().run());
      assert.equal(f.server.claims.size, 0); assert.equal(f.server.results.size, 0); assert.equal(f.performed.length, 0);
    }
  });
  await test("claim flags preserve prior text completion and perform photo only", async () => {
    const f = fixture({ completed: { text: true, photo: false } });
    await f.runner().run();
    assert.deepEqual(f.performed.map(action => action.name), ["photo"]);
    assert.deepEqual(f.server.results.get(uuid(1)).details, { text_action_completed: true, photo_action_completed: true });
    const noPhoto = fixture({ image: false }); await noPhoto.runner().run();
    assert.deepEqual(noPhoto.performed.map(action => action.name), ["text"]);
    assert.equal(noPhoto.server.results.get(uuid(1)).details.photo_action_completed, false);
  });
  await test("five-minute lease stops a later native stage but still permits its callback", async () => {
    const f = fixture(); let elapsed = 0;
    const text = f.actions.text;
    f.actions.text = async input => { const result = await text(input); elapsed = 300000; return result; };
    assert.equal((await f.runner({ now: () => elapsed }).run()).state, "review_required");
    assert.deepEqual(f.performed.map(action => action.name), ["text"]);
    assert.equal(f.server.results.get(uuid(1)).result, "partial");
    assert.equal(f.document().attempts[uuid(1)].started_actions.photo, false);
  });
  await test("uncertain app outcome stops the batch without repeating or opening later actions", async () => {
    const f = fixture({ count: 2 });
    f.actions.photo = async () => { throw Error("provider details that must never persist"); };
    assert.equal((await f.runner().run()).state, "review_required");
    assert.equal(f.server.results.get(uuid(1)).result, "partial");
    assert.equal(f.server.claims.size, 1);
    assert.equal(JSON.stringify(f.document()).includes("provider details"), false);
  });
  await test("wrong recipient, mode or image URL fails before image/claim/action", async () => {
    for (const mutate of [item => { item.phone = "+19995550103"; }, item => { item.image_url = "https://other.example.invalid/image"; }]) {
      const f = fixture(); mutate(f.items[0]);
      await rejects(f.runner().run(), "invalid_manifest");
      assert.equal(f.requests.length, 1); assert.equal(f.server.claims.size, 0); assert.equal(f.performed.length, 0);
    }
    const f = fixture(); const runner = f.runner({ expectedMode: "dry_run" });
    await rejects(runner.run(), "invalid_response"); assert.equal(f.server.claims.size, 0);
  });
  await test("fetch adapter rejects redirects, omits cookies and preserves exact image bytes", async () => {
    let init;
    const transport = createFetchTransport(async (url, options) => { init = options; return new Response(jpeg, { status: 200 }); });
    const response = await transport({ url: apiBase, method: "GET", kind: "image", headers: { Authorization: "Bearer synthetic" } });
    assert.deepEqual(response.bytes, jpeg);
    assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.equal(init.referrerPolicy, "no-referrer");
    const oversized = createFetchTransport(async () => new Response(jpeg, { headers: { "content-length": "1400001" } }));
    await rejects(oversized({ url: apiBase, method: "GET", kind: "image", headers: {} }), "invalid_response");
  });
  process.stdout.write("PASS " + checks + " reference device-runner checks; no native Shortcut, HTTPS, WhatsApp or delivery acceptance claimed.\n");
})().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
