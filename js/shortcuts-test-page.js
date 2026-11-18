// Technical isolated test helper; never a product send action or provider receipt.
(function () {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CAPABILITY = /^[A-Za-z0-9_-]{32,256}$/;
  const PHONE = /^\+[1-9][0-9]{6,14}$/;
  const byId = id => document.getElementById(id);
  const elements = Object.fromEntries(["Api", "Batch", "Capability", "Inspect", "Renew", "Copy", "Clear", "Status", "Progress", "Recipients", "RecipientList", "LaunchRunner", "LaunchUploader", "Limit", "DryRun", "Retry", "BrowserStatus", "Email", "Password", "SignIn", "ForgetAdmin", "ReloadReady", "AuthStatus", "PrepareMode", "Review", "ReviewSummary", "ReviewImage", "ReviewMessages", "Reviewed", "CreateBatch"].map(name => [name, byId("shortcut" + name)]));
  const exact = (value, names) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === names.slice().sort().join(",");
  const isId = value => typeof value === "string" && UUID.test(value);
  const flags = value => exact(value, ["text", "photo"]) && typeof value.text === "boolean" && typeof value.photo === "boolean";
  const error = () => Error("Test helper operation failed");
  const clone = value => JSON.parse(JSON.stringify(value));

  // Accept only the runner's identifier/state journal. No recipient/text/image or bearer fields.
  function safeJournal(value, key) {
    if (!exact(value, ["version", "batch_id", "mode", "active_run", "attempts"]) || value.version !== 1 || !isId(value.batch_id) ||
        key !== "rsvp-shortcut-device:v1:" + value.batch_id || value.mode !== "dry_run" || (value.active_run !== null && !isId(value.active_run)) ||
        !value.attempts || typeof value.attempts !== "object" || Array.isArray(value.attempts) || Object.keys(value.attempts).length > 10) throw error();
    for (const [id, attempt] of Object.entries(value.attempts)) {
      if (!isId(id) || !exact(attempt, ["attempt_id", "delivery_id", "claim_id", "event_id", "phase", "required_actions", "completed_actions", "started_actions", "result", "acknowledged"]) ||
          attempt.attempt_id !== id || !isId(attempt.delivery_id) || attempt.claim_id !== id || attempt.event_id !== id ||
          !["claim_requested", "claimed", "result_pending", "acknowledged"].includes(attempt.phase) ||
          (attempt.required_actions !== null && !flags(attempt.required_actions)) || !flags(attempt.completed_actions) || !flags(attempt.started_actions) || typeof attempt.acknowledged !== "boolean") throw error();
      const result = attempt.result;
      if (result !== null && (!exact(result, ["event_id", "attempt_id", "claim_id", "channel", "result", "details"]) || result.event_id !== id || result.attempt_id !== id || result.claim_id !== id ||
          result.channel !== "whatsapp" || !["processed", "partial", "unknown", "failed", "skipped"].includes(result.result) || !result.details || typeof result.details !== "object" ||
          !Object.keys(result.details).every(name => ["text_action_completed", "photo_action_completed", "error_stage", "error_code"].includes(name)) ||
          typeof result.details.text_action_completed !== "boolean" || typeof result.details.photo_action_completed !== "boolean" ||
          (result.details.error_stage !== undefined && !["text", "photo", "unknown"].includes(result.details.error_stage)) ||
          (result.details.error_code !== undefined && !["action_failed", "image_fetch_failed", "cancelled", "unknown"].includes(result.details.error_code)))) throw error();
    }
    return clone(value);
  }
  function createIndexedDBStore() {
    let opening;
    function database() {
      if (!window.indexedDB) return Promise.reject(error());
      if (!opening) opening = new Promise((resolve, reject) => {
        const request = indexedDB.open("rsvp-shortcuts-browser-dry-run-v1", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("journals");
        request.onsuccess = () => resolve(request.result);
        request.onerror = request.onblocked = () => reject(error());
      });
      return opening;
    }
    function validKey(key) { if (typeof key !== "string" || !/^rsvp-shortcut-device:v1:[0-9a-f-]{36}$/.test(key)) throw error(); }
    function record(value, key) {
      if (value === undefined) return { revision: 0, value: null };
      if (!exact(value, ["revision", "value"]) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw error();
      return { revision: value.revision, value: safeJournal(value.value, key) };
    }
    return {
      async load(key) {
        validKey(key);
        const db = await database();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction("journals", "readonly");
          const request = transaction.objectStore("journals").get(key);
          let loaded;
          request.onsuccess = () => { try { loaded = record(request.result, key); } catch { transaction.abort(); } };
          transaction.oncomplete = () => resolve(loaded);
          transaction.onerror = transaction.onabort = () => reject(error());
        });
      },
      async compareAndSwap(key, expectedRevision, value) {
        validKey(key);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw error();
        const safe = safeJournal(value, key), db = await database();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction("journals", "readwrite", { durability: "strict" }), store = transaction.objectStore("journals"), request = store.get(key);
          let saved = false;
          request.onsuccess = () => {
            try {
              if (record(request.result, key).revision === expectedRevision) { store.put({ revision: expectedRevision + 1, value: safe }, key); saved = true; }
            } catch { transaction.abort(); }
          };
          // Resolve only after the atomic read/compare/write transaction is durable.
          transaction.oncomplete = () => resolve(saved);
          transaction.onerror = transaction.onabort = () => reject(error());
        });
      },
    };
  }
  // Expose the stateless store factory for focused adapter acceptance, never active authorization.
  window.RSVPShortcutsTestPage = Object.freeze({ createIndexedDBStore, verifyReady });
  let apiBase, backendBase, publicKey, manifest = null, recipients = new Set(), handoffMode = null, copied = false, busy = false, runner = null;
  let userJWT = null, readyData = null, reviewSnapshot = null;
  const store = createIndexedDBStore();
  try {
    const backend = new URL(window.RSVP_CONFIG?.supabaseUrl);
    if (backend.protocol !== "https:" || backend.username || backend.password || !["", "/"].includes(backend.pathname) || backend.search || backend.hash) throw error();
    apiBase = backend.origin + "/functions/v1/invitation-shortcuts";
    backendBase = backend.origin;
    const configuredKey = window.RSVP_CONFIG?.supabaseKey;
    if (typeof configuredKey === "string" && /^sb_publishable_[A-Za-z0-9_-]+$/.test(configuredKey)) publicKey = configuredKey;
    else if (typeof configuredKey === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(configuredKey)) {
      try { if (JSON.parse(atob(configuredKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "anon") publicKey = configuredKey; } catch { /* Privileged/invalid browser keys stay disabled. */ }
    }
    elements.Api.value = apiBase;
  } catch { elements.Status.textContent = "A dedicated HTTPS public test connection is required."; }
  const pilot = window.__RSVP_SHORTCUT_PILOT__;
  delete window.__RSVP_SHORTCUT_PILOT__;
  if (pilot && exact(pilot, ["schema_version", "api_base", "batch_id", "capability", "mode", "expected_recipients"]) && pilot.schema_version === 1 && pilot.api_base === apiBase && isId(pilot.batch_id) && CAPABILITY.test(pilot.capability || "") &&
      ["dry_run", "live_test"].includes(pilot.mode) && Array.isArray(pilot.expected_recipients) && pilot.expected_recipients.length === 2 && new Set(pilot.expected_recipients).size === 2 && pilot.expected_recipients.every(phone => PHONE.test(phone))) {
    elements.Batch.value = pilot.batch_id.toLowerCase();
    elements.Capability.value = pilot.capability;
    handoffMode = pilot.mode; recipients = new Set(pilot.expected_recipients);
  }
  function credentials() {
    const batchId = elements.Batch.value.trim().toLowerCase(), capability = elements.Capability.value.trim();
    if (!apiBase || !isId(batchId) || !CAPABILITY.test(capability) || !window.RSVPShortcutDeviceRunner) throw error();
    return { batchId, capability };
  }
  function dryRunAllowed() { return manifest?.mode === "dry_run" && manifest.progress.total === 6 && recipients.size === 2 && !!window.indexedDB; }
  function controls() {
    for (const name of ["Batch", "Capability", "Inspect", "Copy", "Clear", "Limit"]) elements[name].disabled = busy || !apiBase;
    elements.DryRun.disabled = busy || !dryRunAllowed();
    elements.Retry.disabled = busy || !dryRunAllowed();
    elements.Renew.disabled = busy || !userJWT || !isId(elements.Batch.value.trim());
    for (const name of ["Email", "Password", "SignIn", "ForgetAdmin"]) elements[name].disabled = busy || !publicKey;
    elements.ReloadReady.disabled = busy || !userJWT;
    elements.PrepareMode.disabled = busy || !readyData;
    elements.Reviewed.disabled = busy || !reviewSnapshot;
    elements.CreateBatch.disabled = busy || !userJWT || !reviewSnapshot || !elements.Reviewed.checked;
    for (const name of ["LaunchRunner", "LaunchUploader"]) {
      elements[name].setAttribute("aria-disabled", String(busy || !copied));
      elements[name].tabIndex = busy || !copied ? -1 : 0;
    }
  }
  function changed() {
    copied = false; manifest = null; recipients = new Set(); handoffMode = null; runner = null;
    elements.Progress.textContent = ""; elements.RecipientList.replaceChildren(); elements.Recipients.hidden = true;
    elements.Status.textContent = ""; elements.BrowserStatus.textContent = ""; controls();
  }
  async function operation(work, target = elements.Status, failureMessage) {
    if (busy) return;
    busy = true; controls(); target.textContent = "Working…";
    try { await work(); }
    catch { target.textContent = failureMessage || "Operation stopped. Check authorization, connectivity and batch state. No messaging app was opened by this browser operation."; }
    finally { busy = false; controls(); }
  }
  async function postJSON(url, body, headers, expected = 200, maximum = 2000000) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
      redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    if (response.status !== expected || Number(response.headers.get("content-length")) > maximum) throw error();
    const reader = response.body?.getReader();
    if (!reader) throw error();
    const parts = []; let length = 0;
    while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > maximum) { await reader.cancel(); throw error(); } parts.push(next.value); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function verifyReady(data, mode, websiteURL = window.location.href) {
    const website = new URL(websiteURL);
    if (!["dry_run", "live_test"].includes(mode) || data?.settings?.event_name !== "SYNTHETIC SHORTCUTS TEST" || data.settings.is_published !== true ||
        !Array.isArray(data.households) || data.households.length !== 6 || !Array.isArray(data.guests) || data.guests.length !== 6 ||
        !Array.isArray(data.contacts) || data.contacts.length !== 6 || !Array.isArray(data.queue) || data.queue.length !== 12) throw error();
    const households = data.households.slice().sort((a, b) => String(a.household_name).localeCompare(String(b.household_name))), phones = new Map(), selected = [], images = new Set();
    for (let index = 0; index < 6; index++) {
      const number = index + 1, household = households[index];
      if (!isId(household.id) || household.household_name !== "Synthetic Shortcuts " + number || household.archived_at ||
          !/^[A-HJ-NP-Z2-9]{8}$/.test(household.invite_code || "")) throw error();
      const guests = data.guests.filter(row => row.household_id === household.id), contacts = data.contacts.filter(row => row.household_id === household.id);
      if (guests.length !== 1 || contacts.length !== 1) throw error();
      const guest = guests[0], contact = contacts[0], phone = contact.contact_value;
      if (!isId(guest.id) || !isId(contact.id) || guest.first_name !== "Synthetic Guest " + number || guest.last_name != null || guest.archived_at || guest.is_child === true ||
          household.primary_guest_id !== guest.id || guest.mobile !== phone || (guest.phone && guest.phone !== phone) || guest.email ||
          contact.contact_name !== "Synthetic Contact " + number || contact.contact_type !== "phone" || !PHONE.test(phone || "") || contact.archived_at ||
          contact.guest_id !== guest.id || contact.preferred_method !== "whatsapp" || contact.is_primary !== true || (contact.is_household_primary != null && contact.is_household_primary !== false) ||
          (household.phone && household.phone !== phone)) throw error();
      phones.set(phone, (phones.get(phone) || 0) + 1);
      for (const queueMode of ["dry_run", "live_test"]) {
        const queues = data.queue.filter(row => row.household_id === household.id && row.message_subject === "SYNTHETIC SHORTCUTS TEST / " + queueMode);
        if (queues.length !== 1) throw error();
        const queue = queues[0], snapshot = queue.recipient_snapshot, image = queue.message_image;
        if (!isId(queue.id) || queue.status !== "ready" || queue.channel !== "whatsapp" || queue.contact_id !== contact.id ||
            !Number.isSafeInteger(queue.revision) || queue.revision < 1 || queue.revision > 999999999 || queue.invitation_code_snapshot !== household.invite_code ||
            snapshot?.contact_name !== contact.contact_name || snapshot.contact_type !== "phone" || snapshot.contact_value !== phone ||
            typeof queue.message_body !== "string" || queue.message_body.length > 12000 || !queue.message_body.includes("SYNTHETIC") ||
            !queue.message_body.includes(queueMode) || !queue.message_body.includes(household.household_name) || /[{}]/.test(queue.message_body) ||
            typeof image?.image !== "string" || !/^data:image\/jpeg;base64,\/9j\//.test(image.image) || image.image.length > 1900000 ||
            image.crop?.width !== 640 || image.crop?.height !== 400) throw error();
        const links = queue.message_body.match(/https:\/\/[^\s<>"']+/g) || [];
        if (links.length !== 1) throw error();
        const link = new URL(links[0]);
        if (link.protocol !== "https:" || link.username || link.password || link.hostname !== website.hostname || link.port !== website.port ||
            link.pathname !== "/" || link.hash || link.searchParams.get("") !== household.invite_code) throw error();
        images.add(image.image);
        if (queueMode === mode) selected.push({ household: household.household_name, phone, body: queue.message_body, image: image.image, queue_id: queue.id, expected_revision: queue.revision });
      }
    }
    if (new Set(households.map(row => row.id)).size !== 6 || new Set(data.guests.map(row => row.id)).size !== 6 ||
        new Set(data.contacts.map(row => row.id)).size !== 6 || new Set(data.queue.map(row => row.id)).size !== 12 || phones.size !== 2 || [...phones.values()].some(count => count !== 3) || images.size !== 1) throw error();
    return selected;
  }
  function renderReview() {
    reviewSnapshot = null; elements.Reviewed.checked = false; elements.Review.hidden = true;
    elements.ReviewMessages.replaceChildren(); elements.ReviewImage.removeAttribute("src");
    if (!readyData) return;
    const selected = verifyReady(readyData, elements.PrepareMode.value);
    reviewSnapshot = { mode: elements.PrepareMode.value, selected };
    elements.ReviewSummary.textContent = "Verified dedicated synthetic event: six active households, guests and phone contacts, twelve Ready WhatsApp snapshots, two recipients used three times. Selected mode: " + reviewSnapshot.mode + ".";
    elements.ReviewImage.src = selected[0].image;
    elements.ReviewMessages.replaceChildren(...selected.map(row => {
      const section = document.createElement("section"), heading = document.createElement("h4"), message = document.createElement("textarea");
      heading.textContent = row.household + " → " + row.phone; message.readOnly = true; message.rows = 5; message.value = row.body;
      section.append(heading, message); return section;
    }));
    elements.Review.hidden = false;
  }
  function forgetAdmin() {
    userJWT = null; readyData = null; reviewSnapshot = null; elements.Reviewed.checked = false; elements.Review.hidden = true;
    elements.ReviewMessages.replaceChildren(); elements.ReviewImage.removeAttribute("src"); elements.ReviewSummary.textContent = "";
  }
  async function loadReady() {
    if (!userJWT || !publicKey) throw error();
    readyData = null; renderReview();
    const data = await postJSON(backendBase + "/rest/v1/rpc/admin_load_data", {}, { apikey: publicKey, Authorization: "Bearer " + userJWT });
    verifyReady(data, elements.PrepareMode.value); readyData = data; renderReview();
    elements.AuthStatus.textContent = "Normal administrator sign-in verified. Review the six existing messages for the selected mode before creating a batch.";
  }
  async function inspect() {
    const { batchId, capability } = credentials();
    const response = await window.RSVPShortcutDeviceRunner.createFetchTransport(window.fetch.bind(window))({ url: apiBase + "/batches/" + batchId, method: "GET", kind: "json", headers: { Authorization: "Bearer " + capability } });
    const data = response.body;
    if (response.status !== 200 || data?.schema_version !== 1 || data.batch_id?.toLowerCase() !== batchId ||
        !["dry_run", "live_test", "live"].includes(data.mode) || !Array.isArray(data.invitations) || data.invitations.length > 10 || !data.progress ||
        !["total", "pending", "claimed", "processed", "partial", "failed", "unknown", "skipped"].every(name => Number.isInteger(data.progress[name]) && data.progress[name] >= 0 && data.progress[name] <= 10) ||
        data.progress.total < 1 || data.progress.pending > data.progress.total || data.invitations.some(item => !PHONE.test(item?.phone || ""))) throw error();
    if (handoffMode && (data.mode !== handoffMode || data.invitations.some(item => !recipients.has(item.phone)))) throw error();
    const returnedPhones = new Set(data.invitations.map(item => item.phone));
    if (!handoffMode && ["dry_run", "live_test"].includes(data.mode)) {
      if (recipients.size === 2) { if ([...returnedPhones].some(phone => !recipients.has(phone))) throw error(); }
      else { if (returnedPhones.size !== 2) throw error(); recipients = returnedPhones; }
      handoffMode = data.mode;
    }
    manifest = data;
    elements.Progress.textContent = "Mode: " + data.mode + ". Total: " + data.progress.total + "; pending: " + data.progress.pending + "; claimed: " + data.progress.claimed + "; processed: " + data.progress.processed + "; uncertain/error: " + (data.progress.partial + data.progress.failed + data.progress.unknown) + ".";
    elements.RecipientList.replaceChildren(...[...returnedPhones].map(phone => { const item = document.createElement("li"); item.textContent = phone; return item; }));
    elements.Recipients.hidden = returnedPhones.size === 0;
    elements.Status.textContent = handoffMode ? "Authorized batch inspected. Verified native launch input can now be copied. Browser execution permits only the six-item dry run." : "Authorized progress inspected. This test helper cannot launch a live batch.";
  }
  function browserRunner() {
    const auth = credentials();
    if (!dryRunAllowed()) throw error();
    if (!runner) runner = window.RSVPShortcutDeviceRunner.createRunner({ apiBase, ...auth, expectedMode: "dry_run", expectedRecipients: [...recipients], store,
      http: window.RSVPShortcutDeviceRunner.createFetchTransport(window.fetch.bind(window)) });
    return runner;
  }
  byId("shortcutAdminForm").addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    const email = elements.Email.value.trim(); let password = elements.Password.value;
    elements.Password.value = ""; forgetAdmin();
    operation(async () => {
      try {
        if (!publicKey || !email || !password) throw error();
        const signed = await postJSON(backendBase + "/auth/v1/token?grant_type=password", { email, password }, { apikey: publicKey }, 200, 100000);
        password = "";
        const access = signed.access_token; delete signed.refresh_token; delete signed.access_token;
        if (typeof access !== "string" || access.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access) || signed.token_type !== "bearer") throw error();
        userJWT = access;
        await loadReady();
      } catch { password = ""; forgetAdmin(); throw error(); }
    }, elements.AuthStatus, "Sign-in or administrator fixture verification failed. Use an existing confirmed test administrator. This page cannot grant access or change event data.");
  });
  elements.ForgetAdmin.addEventListener("click", () => { forgetAdmin(); elements.Password.value = ""; elements.AuthStatus.textContent = "Administrator authorization cleared from this page's memory."; controls(); });
  elements.ReloadReady.addEventListener("click", () => operation(loadReady, elements.AuthStatus));
  elements.PrepareMode.addEventListener("change", () => { try { renderReview(); } catch { forgetAdmin(); elements.AuthStatus.textContent = "Synthetic fixture verification failed."; } controls(); });
  elements.Reviewed.addEventListener("change", controls);
  elements.CreateBatch.addEventListener("click", () => operation(async () => {
    if (!userJWT || !reviewSnapshot || !elements.Reviewed.checked) throw error();
    const reviewed = reviewSnapshot;
    const fresh = await postJSON(backendBase + "/rest/v1/rpc/admin_load_data", {}, { apikey: publicKey, Authorization: "Bearer " + userJWT });
    if (JSON.stringify(verifyReady(fresh, reviewed.mode)) !== JSON.stringify(reviewed.selected)) { readyData = fresh; renderReview(); throw error(); }
    const created = await postJSON(apiBase + "/batches", { mode: reviewed.mode, items: reviewed.selected.map(({ queue_id, expected_revision }) => ({ queue_id, expected_revision })) }, { apikey: publicKey, Authorization: "Bearer " + userJWT }, 201, 100000);
    if (created.schema_version !== 1 || !isId(created.batch_id) || !CAPABILITY.test(created.capability || "") || created.mode !== reviewed.mode || created.count !== 6) throw error();
    changed(); elements.Batch.value = created.batch_id.toLowerCase(); elements.Capability.value = created.capability;
    handoffMode = reviewed.mode; recipients = new Set(reviewed.selected.map(row => row.phone));
    elements.Reviewed.checked = false; reviewSnapshot = null; elements.Review.hidden = true; elements.ReviewMessages.replaceChildren(); elements.ReviewImage.removeAttribute("src");
    await inspect();
    elements.AuthStatus.textContent = "Reviewed synthetic batch created with your live administrator session. Authorization remains in memory. Inspect and copy launch input below.";
  }, elements.AuthStatus));
  byId("shortcutTestForm").addEventListener("submit", event => { event.preventDefault(); operation(inspect); });
  for (const name of ["Batch", "Capability"]) elements[name].addEventListener("input", changed);
  elements.Renew.addEventListener("click", () => operation(async () => {
    const batchId = elements.Batch.value.trim().toLowerCase();
    if (!userJWT || !publicKey || !apiBase || !isId(batchId)) throw error();
    // The normal administrator RPC already verified these two synthetic phones.
    // Keep the existing handoff scope when present, including zero-pending resume.
    if (recipients.size !== 2) recipients = new Set(verifyReady(readyData, "dry_run").map(row => row.phone));
    const renewed = await postJSON(apiBase + "/batches/" + batchId + "/authorization", { action: "renew" }, { apikey: publicKey, Authorization: "Bearer " + userJWT }, 200, 100000);
    if (renewed.schema_version !== 1 || renewed.batch_id?.toLowerCase() !== batchId || renewed.revoked === true || !CAPABILITY.test(renewed.capability || "")) throw error();
    elements.Capability.value = renewed.capability; copied = false; manifest = null;
    try {
      await inspect();
      if (!["dry_run", "live_test"].includes(handoffMode)) throw error();
      runner?.replaceCapability({ batchId, capability: renewed.capability });
    } catch { elements.Capability.value = ""; manifest = null; copied = false; runner = null; throw error(); }
    elements.Status.textContent = "Authorization renewed for the same batch; mode and remaining recipients verified. Existing outbox kept. Copy fresh launch input or upload pending browser results only.";
  }));
  elements.Copy.addEventListener("click", () => operation(async () => {
    const auth = credentials();
    if (!manifest || !["dry_run", "live_test"].includes(handoffMode) || manifest.mode !== handoffMode || recipients.size !== 2) throw error();
    await navigator.clipboard.writeText(JSON.stringify({ schema_version: 1, api_base: apiBase, batch_id: auth.batchId, capability: auth.capability, mode: handoffMode, expected_recipients: [...recipients] }));
    copied = true; elements.Status.textContent = "Launch input copied. Open the installed Shortcut now; replace the clipboard after the run.";
  }));
  for (const name of ["LaunchRunner", "LaunchUploader"]) elements[name].addEventListener("click", event => {
    if (busy || !copied) { event.preventDefault(); elements.Status.textContent = "Inspect the authorized batch and copy launch input first."; }
  });
  elements.Clear.addEventListener("click", () => { elements.Capability.value = ""; changed(); elements.Status.textContent = "Entered authorization cleared. Replace any previously copied launch input on the system clipboard separately."; });
  elements.DryRun.addEventListener("click", () => operation(async () => {
    const result = await browserRunner().run({ limit: elements.Limit.value === "1" ? 1 : 10 });
    elements.BrowserStatus.textContent = "Browser dry run: " + result.state + "; processed this run: " + result.processed + ". No messaging app actions ran.";
    await inspect();
  }, elements.BrowserStatus));
  elements.Retry.addEventListener("click", () => operation(async () => {
    await browserRunner().retryCallbacks();
    elements.BrowserStatus.textContent = "Pending browser results uploaded. No claims, image fetches or app actions were repeated. Inspect progress to refresh counts.";
  }, elements.BrowserStatus));
  window.addEventListener("pagehide", () => { elements.Capability.value = ""; elements.Password.value = ""; forgetAdmin(); runner = null; copied = false; });
  controls();
})();
