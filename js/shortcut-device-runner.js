/* Reference/browser-test helper only. Native Apple Shortcuts does not execute
 * this module: its HTTP, durable-file and app actions must mirror this protocol.
 * Completion means configured processing completed, never provider delivery.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RSVPShortcutDeviceRunner = api;
})(typeof globalThis === "object" ? globalThis : this, function (root) {
  "use strict";

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CAPABILITY = /^[A-Za-z0-9_-]{32,256}$/;
  const PHONE = /^\+[1-9][0-9]{6,14}$/;
  const MODES = ["dry_run", "live_test", "live"];
  const RESULTS = ["processed", "partial", "unknown", "failed", "skipped"];
  const ERROR_CODES = ["action_failed", "image_fetch_failed", "cancelled", "unknown"];
  const ACTIONS = ["text", "photo"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const exact = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
  const flags = value => exact(value, ACTIONS) && ACTIONS.every(name => typeof value[name] === "boolean");
  const id = value => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
  const anyCompleted = attempt => attempt.completed_actions.text || attempt.completed_actions.photo;

  class DeviceRunnerError extends Error {
    constructor(code, status) {
      // Never include HTTP/provider errors, recipient data or credentials.
      super("Shortcut device runner: " + code);
      this.name = "DeviceRunnerError";
      this.code = code;
      if (status !== undefined) this.status = status;
    }
  }
  const fail = (code, status) => { throw new DeviceRunnerError(code, status); };
  function validateResult(result, attempt) {
    if (!exact(result, ["event_id", "attempt_id", "claim_id", "channel", "result", "details"]) ||
        result.event_id !== attempt.event_id || result.attempt_id !== attempt.attempt_id || result.claim_id !== attempt.claim_id ||
        result.channel !== "whatsapp" || !RESULTS.includes(result.result) || !object(result.details)) return false;
    const details = result.details;
    if (!Object.keys(details).every(key => ["text_action_completed", "photo_action_completed", "error_stage", "error_code"].includes(key)) ||
        details.text_action_completed !== attempt.completed_actions.text || details.photo_action_completed !== attempt.completed_actions.photo ||
        (details.error_stage !== undefined && !["text", "photo", "unknown"].includes(details.error_stage)) ||
        (details.error_code !== undefined && !ERROR_CODES.includes(details.error_code))) return false;
    if (result.result === "partial" && !anyCompleted(attempt)) return false;
    return result.result !== "processed" || (attempt.required_actions &&
      ACTIONS.every(name => !attempt.required_actions[name] || attempt.completed_actions[name]) &&
      details.error_stage === undefined && details.error_code === undefined);
  }
  function validateJournal(value, batchId, mode) {
    if (!exact(value, ["version", "batch_id", "mode", "active_run", "attempts"]) || value.version !== 1 ||
        value.batch_id !== batchId || value.mode !== mode || (value.active_run !== null && !id(value.active_run)) ||
        !object(value.attempts) || Object.keys(value.attempts).length > 10) fail("corrupt_journal");
    for (const [key, attempt] of Object.entries(value.attempts)) {
      if (!exact(attempt, ["attempt_id", "delivery_id", "claim_id", "event_id", "phase", "required_actions", "completed_actions", "started_actions", "result", "acknowledged"]) ||
          id(key) !== key || attempt.attempt_id !== key || !id(attempt.delivery_id) || attempt.claim_id !== key || attempt.event_id !== key ||
          !["claim_requested", "claimed", "result_pending", "acknowledged"].includes(attempt.phase) ||
          (attempt.required_actions !== null && !flags(attempt.required_actions)) ||
          !flags(attempt.completed_actions) || !flags(attempt.started_actions) || typeof attempt.acknowledged !== "boolean" ||
          (attempt.phase === "claimed" && attempt.required_actions === null) ||
          (attempt.result === null && !["claim_requested", "claimed"].includes(attempt.phase)) ||
          (attempt.result !== null && (!["result_pending", "acknowledged"].includes(attempt.phase) || !validateResult(attempt.result, attempt))) ||
          (attempt.acknowledged !== (attempt.phase === "acknowledged"))) fail("corrupt_journal");
    }
    return value;
  }

  /**
   * store.load(key) -> { revision: nonnegative integer, value: journal|null }
   * store.compareAndSwap(key, expectedRevision, journal) -> boolean
   * Successful CAS atomically replaces the entire value and increments revision
   * by one. It MUST persist before resolving. A plain read/write adapter is unsafe.
   *
   * http({url,method,headers,body?,kind}) -> {status,body? ,bytes?}
   * JSON bodies are objects, image bytes are Uint8Array. No automatic HTTP retry.
   * actions.text/photo(input) -> {completed:true}, or a bounded outcome:
   * {completed:false, uncertain?:boolean, errorCode?:"cancelled"|"action_failed"}.
   * Unknown/throwing app outcomes are uncertain. Adapters never receive a bearer.
   */
  function createRunner(options) {
    if (!object(options)) fail("configuration");
    let parsed;
    try { parsed = new URL(options.apiBase); } catch { fail("configuration"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash ||
        parsed.pathname.includes("//") || /%2f|%5c|%2e/i.test(parsed.pathname)) fail("configuration");
    const apiBase = parsed.href.replace(/\/$/, "");
    const batchId = id(options.batchId), mode = options.expectedMode;
    if (!batchId || !MODES.includes(mode) || !CAPABILITY.test(options.capability || "") ||
        typeof options.http !== "function" || typeof options.store?.load !== "function" ||
        typeof options.store?.compareAndSwap !== "function") fail("configuration");
    const approvedRecipients = new Set(options.expectedRecipients || []);
    if (mode !== "live" && (!Array.isArray(options.expectedRecipients) || options.expectedRecipients.length !== 2 ||
        approvedRecipients.size !== 2 || !options.expectedRecipients.every(phone => PHONE.test(phone)))) fail("configuration");
    if (mode !== "dry_run" && ACTIONS.some(name => typeof options.actions?.[name] !== "function")) fail("configuration");
    const runId = id(options.runId || root.crypto?.randomUUID?.());
    if (!runId) fail("configuration");
    const key = "rsvp-shortcut-device:v1:" + batchId;
    const batchUrl = apiBase + "/batches/" + batchId;
    const store = options.store, http = options.http, actions = options.actions || {};
    const clock = options.now || (() => root.performance?.now?.() ?? Date.now());
    if (typeof clock !== "function") fail("configuration");
    let capability = options.capability; // RAM only; never copied into the journal.
    let running = false, snapshot;

    async function read() {
      let loaded;
      try { loaded = await store.load(key); } catch { fail("store_failed"); }
      if (!exact(loaded, ["revision", "value"]) || !Number.isSafeInteger(loaded.revision) || loaded.revision < 0) fail("corrupt_journal");
      snapshot = { revision: loaded.revision, value: loaded.value === null ? {
        version: 1, batch_id: batchId, mode, active_run: null, attempts: {},
      } : validateJournal(clone(loaded.value), batchId, mode) };
    }
    async function update(change) {
      const next = clone(snapshot.value);
      change(next);
      validateJournal(next, batchId, mode);
      let saved;
      try { saved = await store.compareAndSwap(key, snapshot.revision, next); } catch { fail("store_failed"); }
      if (saved !== true) fail("busy");
      snapshot = { revision: snapshot.revision + 1, value: next };
    }
    async function locked(work, recover = false) {
      if (running) fail("busy");
      running = true;
      let held = false, result, error;
      try {
        await read();
        if (snapshot.value.active_run !== null && !recover) fail("busy");
        await update(value => { value.active_run = runId; });
        held = true;
        result = await work();
      } catch (caught) { error = caught instanceof DeviceRunnerError ? caught : new DeviceRunnerError("runner_failed"); }
      if (held) {
        try {
          // CAS also prevents an old run releasing a lock acquired by recovery.
          await update(value => { if (value.active_run !== runId) fail("busy"); value.active_run = null; });
        } catch (caught) { if (!error) error = caught; }
      }
      running = false;
      if (error) throw error;
      return result;
    }
    async function request(url, method = "GET", body, kind = "json") {
      let response;
      try {
        response = await http({ url, method, kind,
          headers: { Authorization: "Bearer " + capability, ...(body ? { "Content-Type": "application/json" } : {}) },
          ...(body ? { body: clone(body) } : {}),
        });
      } catch { fail("transport_failed"); }
      if (!object(response) || !Number.isInteger(response.status)) fail("invalid_response");
      if (response.status !== 200) {
        if ([401, 403].includes(response.status)) fail("authorization_required", response.status);
        if (response.status === 409) fail("conflict", 409);
        if ([429, 503].includes(response.status)) fail("retry_later", response.status);
        fail("request_rejected", response.status);
      }
      return response;
    }
    function envelope(body) {
      if (!object(body) || body.schema_version !== 1 || id(body.batch_id) !== batchId) fail("invalid_response");
      return body;
    }
    function imageUrl(attemptId) { return batchUrl + "/attempts/" + attemptId + "/image"; }
    function manifest(body) {
      const data = envelope(body);
      if (data.mode !== mode || !Array.isArray(data.invitations) || data.invitations.length > 10 ||
          !Array.isArray(data.statuses) || data.statuses.length > 10 || !object(data.progress) ||
          !Number.isFinite(Date.parse(data.expires_at))) fail("invalid_response");
      const seen = new Set(), deliveries = new Set();
      for (const item of data.invitations) {
        const attemptId = id(item?.attempt_id), deliveryId = id(item?.delivery_id);
        if (!attemptId || !deliveryId || seen.has(attemptId) || deliveries.has(deliveryId) ||
            typeof item.household_name !== "string" || !PHONE.test(item.phone || "") ||
            typeof item.message !== "string" || !item.message.trim() || item.message.length > 12000 ||
            typeof item.invitation_link !== "string" || !item.invitation_link.startsWith("https://") ||
            !/^[A-HJ-NP-Z2-9]{8}$/.test(item.invitation_code || "") || !item.message.includes(item.invitation_link) ||
            (item.image_url !== null && item.image_url !== imageUrl(attemptId)) ||
            (mode !== "live" && !approvedRecipients.has(item.phone))) fail("invalid_manifest");
        seen.add(attemptId); deliveries.add(deliveryId);
      }
      return data;
    }
    async function upload(attemptId) {
      const attempt = snapshot.value.attempts[attemptId];
      if (!attempt.result || attempt.acknowledged) return;
      const response = envelope((await request(batchUrl + "/results", "POST", attempt.result)).body);
      if (response.accepted !== true || response.state !== attempt.result.result || typeof response.idempotent !== "boolean") fail("invalid_acknowledgment");
      await update(value => {
        value.attempts[attemptId].acknowledged = true;
        value.attempts[attemptId].phase = "acknowledged";
      });
    }
    async function drain() {
      for (const attempt of Object.values(snapshot.value.attempts)) {
        if (attempt.result && !attempt.acknowledged) await upload(attempt.attempt_id);
      }
    }
    async function finish(attemptId, outcome, stage, code) {
      await update(value => {
        const attempt = value.attempts[attemptId];
        if (attempt.result) fail("immutable_result");
        attempt.result = {
          event_id: attempt.event_id, attempt_id: attemptId, claim_id: attempt.claim_id,
          channel: "whatsapp", result: outcome,
          details: { text_action_completed: attempt.completed_actions.text, photo_action_completed: attempt.completed_actions.photo,
            ...(stage ? { error_stage: stage } : {}), ...(code ? { error_code: code } : {}) },
        };
        attempt.phase = "result_pending";
      });
      await upload(attemptId);
    }
    function needsReview() {
      return Object.values(snapshot.value.attempts).filter(attempt => !attempt.result).map(attempt => attempt.attempt_id);
    }
    async function process(item) {
      const attemptId = id(item.attempt_id), deliveryId = id(item.delivery_id);
      let imageBytes = null;
      // Fetch before claim: a five-minute claim can expire during slow transfer or
      // permissions. Never follow a manifest-provided image URL with a credential.
      if (item.image_url !== null) {
        imageBytes = (await request(imageUrl(attemptId), "GET", undefined, "image")).bytes;
        if (!(imageBytes instanceof Uint8Array) || imageBytes.length < 4 || imageBytes.length > 1400000 ||
            imageBytes[0] !== 255 || imageBytes[1] !== 216) fail("invalid_image");
      }
      await update(value => {
        value.attempts[attemptId] = {
          attempt_id: attemptId, delivery_id: deliveryId,
          // Both are UUIDs already unique to this processing attempt, not a retry.
          claim_id: attemptId, event_id: attemptId, phase: "claim_requested",
          required_actions: null, completed_actions: { text: false, photo: false },
          started_actions: { text: false, photo: false }, result: null, acknowledged: false,
        };
      });
      const claimRequestedAt = clock();
      if (!Number.isFinite(claimRequestedAt)) fail("configuration");
      const claimed = envelope((await request(batchUrl + "/claims", "POST", { attempt_id: attemptId, claim_id: attemptId })).body);
      if (id(claimed.attempt_id) !== attemptId || typeof claimed.claimed !== "boolean") fail("invalid_claim");
      if (!claimed.claimed) return false; // A repeated or lost claim never permits an app action.
      if (claimed.state !== "claimed" || claimed.mode !== mode || !flags(claimed.required_actions) || !flags(claimed.completed_actions) ||
          claimed.required_actions.text !== !claimed.completed_actions.text ||
          claimed.required_actions.photo !== (imageBytes !== null && !claimed.completed_actions.photo)) fail("invalid_claim");
      await update(value => {
        const attempt = value.attempts[attemptId];
        attempt.phase = "claimed";
        attempt.required_actions = clone(claimed.required_actions);
        attempt.completed_actions = clone(claimed.completed_actions);
      });
      for (const name of ACTIONS) {
        if (!claimed.required_actions[name]) continue;
        // The server lease is five minutes. Starting this clock before HTTP is
        // conservative; a delayed response cannot extend permission to act.
        const elapsed = clock() - claimRequestedAt;
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 300000) {
          await finish(attemptId, anyCompleted(snapshot.value.attempts[attemptId]) ? "partial" : "unknown", name, "unknown");
          return false;
        }
        await update(value => { value.attempts[attemptId].started_actions[name] = true; });
        let outcome;
        try {
          outcome = mode === "dry_run" ? { completed: true } : await actions[name]({
            attemptId, deliveryId, phone: item.phone, message: item.message,
            invitationLink: item.invitation_link, imageBytes,
          });
        } catch { outcome = { completed: false, uncertain: true, errorCode: "action_failed" }; }
        if (outcome?.completed !== true) {
          const attempt = snapshot.value.attempts[attemptId];
          const code = ["cancelled", "action_failed"].includes(outcome?.errorCode) ? outcome.errorCode : "unknown";
          const result = anyCompleted(attempt) ? "partial" : outcome?.uncertain === false ? (code === "cancelled" ? "skipped" : "failed") : "unknown";
          await finish(attemptId, result, name, code);
          return false;
        }
        await update(value => { value.attempts[attemptId].completed_actions[name] = true; });
      }
      await finish(attemptId, "processed");
      return true;
    }

    return {
      async run({ limit = 10 } = {}) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 10) fail("configuration");
        return locked(async () => {
          await drain();
          const review = needsReview();
          if (review.length) return { state: "review_required", attempt_ids: review, processed: 0 };
          const data = manifest((await request(batchUrl)).body);
          let processed = 0;
          for (const item of data.invitations) {
            if (snapshot.value.attempts[id(item.attempt_id)]) continue;
            if (processed >= limit) return { state: "paused", processed };
            if (!await process(item)) return { state: "review_required", attempt_ids: [id(item.attempt_id)], processed };
            processed++;
          }
          return { state: "complete", processed };
        });
      },
      async retryCallbacks() {
        return locked(async () => { await drain(); return { state: "callbacks_uploaded" }; });
      },
      async reconcile({ confirmStopped = false } = {}) {
        // Explicit operator assertion: the old native run has stopped. Recovery
        // may take a stranded lock; it never authorizes another external action.
        if (confirmStopped !== true) fail("confirmation_required");
        return locked(async () => {
          await drain();
          for (const attemptId of needsReview()) {
            const attempt = snapshot.value.attempts[attemptId];
            if (attempt.required_actions && ACTIONS.every(name => !attempt.required_actions[name] || attempt.completed_actions[name])) {
              await finish(attemptId, "processed");
              continue;
            }
            const stage = ACTIONS.find(name => attempt.started_actions[name] && !attempt.completed_actions[name]) || "unknown";
            await finish(attemptId, anyCompleted(attempt) ? "partial" : "unknown", stage, "unknown");
          }
          return { state: "reconciled" };
        }, true);
      },
      replaceCapability(replacement) {
        if (!object(replacement) || id(replacement.batchId) !== batchId || !CAPABILITY.test(replacement.capability || "")) fail("configuration");
        if (running) fail("busy");
        capability = replacement.capability;
      },
      async inspect() { if (running) fail("busy"); await read(); return clone(snapshot.value); },
    };
  }

  // Optional browser adapter. Request redirects fail rather than forwarding a
  // bearer. The caller still supplies a real atomic durable store and actions.
  function createFetchTransport(fetchImpl) {
    if (typeof fetchImpl !== "function") fail("configuration");
    return async request => {
      const response = await fetchImpl(request.url, {
        method: request.method, headers: request.headers, redirect: "error", credentials: "omit",
        cache: "no-store", referrerPolicy: "no-referrer",
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      if (response.status !== 200) return { status: response.status };
      const maximum = request.kind === "image" ? 1400000 : 200000;
      if (Number(response.headers.get("content-length")) > maximum) fail("invalid_response");
      const reader = response.body?.getReader();
      if (!reader) fail("invalid_response");
      const parts = []; let length = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > maximum) { await reader.cancel(); fail("invalid_response"); }
        parts.push(next.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return request.kind === "image" ? { status: 200, bytes } : { status: 200, body: JSON.parse(new TextDecoder().decode(bytes)) };
    };
  }
  return { createRunner, createFetchTransport, DeviceRunnerError };
});
