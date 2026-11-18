// Organizer projection and explicit actions for existing invitation delivery batches.
(function () {
  "use strict";
  const STATES = ["pending", "claimed", "processed", "partial", "failed", "unknown", "skipped"];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CAPABILITY = /^[A-Za-z0-9_-]{32,256}$/;
  const PHONE = /^\+[1-9][0-9]{6,14}$/;
  const phrases = {
    "title": "interface.messages.shortcut_title",
    "help": "interface.messages.shortcut_help",
    "unpublished": "interface.messages.shortcut_unpublished",
    "https": "interface.messages.shortcut_https",
    "permission": "interface.messages.shortcut_permission",
    "device_help": "interface.messages.shortcut_device_help",
    "ready": "interface.messages.shortcut_ready",
    "batch_size": "interface.messages.shortcut_batch_size",
    "limit": "interface.messages.shortcut_limit",
    "new": "interface.messages.shortcut_new",
    "retry_title": "interface.messages.shortcut_retry_title",
    "retry_help": "interface.messages.shortcut_retry_help",
    "no_ready": "interface.messages.shortcut_no_ready",
    "select": "interface.messages.shortcut_select",
    "review": "interface.messages.shortcut_review",
    "reviewed": "interface.messages.shortcut_reviewed",
    "retry_ack": "interface.messages.shortcut_retry_ack",
    "prepare": "interface.messages.shortcut_prepare",
    "retry": "interface.messages.shortcut_retry",
    "confirm_retry": "interface.messages.shortcut_confirm_retry",
    "selection_changed": "interface.messages.shortcut_selection_changed",
    "error": "interface.messages.shortcut_error",
    "prepared": "interface.messages.shortcut_prepared",
    "history": "interface.messages.shortcut_history",
    "no_history": "interface.messages.shortcut_no_history",
    "refresh": "interface.messages.shortcut_refresh",
    "created": "interface.messages.shortcut_created",
    "expires": "interface.messages.shortcut_expires",
    "state": "interface.messages.shortcut_state",
    "processed": "interface.messages.shortcut_processed",
    "partial": "interface.messages.shortcut_partial",
    "unknown": "interface.messages.shortcut_unknown",
    "skipped": "interface.messages.shortcut_skipped",
    "revoked": "interface.messages.shortcut_revoked",
    "resume": "interface.messages.shortcut_resume",
    "resume_help": "interface.messages.shortcut_resume_help",
    "revoke": "interface.messages.shortcut_revoke",
    "confirm_revoke": "interface.messages.shortcut_confirm_revoke",
    "revoked_notice": "interface.messages.shortcut_revoked_notice",
    "copy": "interface.messages.shortcut_copy",
    "copied": "interface.messages.shortcut_copied",
    "runner": "interface.messages.shortcut_runner",
    "uploader": "interface.messages.shortcut_uploader",
    "clear": "interface.messages.shortcut_clear",
    "no_cap": "interface.messages.shortcut_no_cap",
    "recipient": "interface.messages.shortcut_recipient",
    "handed": "interface.messages.shortcut_handed",
    "verified": "interface.messages.shortcut_verified",
    "confirmed": "interface.messages.shortcut_confirmed",
    "first_visit": "interface.messages.shortcut_first_visit",
    "last_visit": "interface.messages.shortcut_last_visit",
    "visits": "interface.messages.shortcut_visits",
    "rsvp": "interface.messages.shortcut_rsvp",
    "visit_help": "interface.messages.shortcut_visit_help",
    "unverified": "interface.messages.shortcut_unverified",
    "not_yet": "interface.messages.shortcut_not_yet",
    "text": "interface.messages.shortcut_text",
    "photo": "interface.messages.shortcut_photo",
    "not_required": "interface.messages.shortcut_not_required",
    "complete": "interface.messages.shortcut_complete",
    "incomplete": "interface.messages.shortcut_incomplete",
    "replied": "interface.messages.shortcut_replied",
    "confirmed_rsvp": "interface.messages.shortcut_confirmed_rsvp",
    "native_instructions": "interface.messages.shortcut_native_instructions",
    "mode_live": "interface.messages.shortcut_mode_live",
    "mode_dry_run": "interface.messages.shortcut_mode_dry_run",
    "mode_live_test": "interface.messages.shortcut_mode_live_test",
    "pending": "interface.messages.shortcut_pending",
    "claimed": "interface.messages.in_progress",
    "failed": "interface.messages.failed",
    "errors": "interface.messages.status_messages_errors",
    "household": "interface.messages.household_2",
    "channel": "interface.messages.invitation_custom_channel",
    "awaiting": "interface.messages.invitation_custom_awaiting_reply"
  };
  const list = value => Array.isArray(value) ? value : [];
  const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const phone = value => typeof value === "string" ? value.replace(/[ ().-]/g, "") : "";
  function stateOf(attempt, batch, now) {
    if (attempt.state === "claimed" && attempt.claim_active === false) return "unknown";
    if (attempt.state === "pending" && (batch?.revoked_at || (time(batch?.expires_at) ?? 0) <= now)) return "unknown";
    return STATES.includes(attempt.state) ? attempt.state : "unknown";
  }
  function hasInvitationLink(body, code) {
    for (const match of body.matchAll(/https:\/\/[^\s<>"']+/g)) {
      try {
        const link = new URL(match[0].replace(/[).,!?;]+$/, ""));
        if (link.protocol === "https:" && !link.username && !link.password &&
            ["", "invite", "code"].some(key => link.searchParams.get(key) === code)) return true;
      } catch { /* Continue through URLs already present in this reviewed snapshot. */ }
    }
    return false;
  }
  function projection(store, now = Date.now()) {
    const batches = list(store.shortcutBatches).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const byBatch = new Map(batches.map(batch => [batch.id, batch]));
    const attempts = list(store.shortcutAttempts);
    const households = new Map(list(store.households).map(household => [household.id, household]));
    const entries = list(store.queue).filter(queue => {
      const household = households.get(queue.household_id);
      return queue.channel === "whatsapp" && queue.status === "ready" && household && !household.archived_at &&
        list(store.guests).some(guest => guest.household_id === household.id && !guest.archived_at) &&
        queue.invitation_code_snapshot && queue.invitation_code_snapshot === household.invite_code &&
        PHONE.test(phone(queue.recipient_snapshot?.contact_value)) && Number.isInteger(queue.revision) && queue.revision > 0 &&
        typeof queue.message_body === "string" && queue.message_body.trim() && !/[{}]/.test(queue.message_body + (queue.message_subject || "")) &&
        hasInvitationLink(queue.message_body, household.invite_code);
    }).map(queue => {
      const history = attempts.filter(attempt => attempt.queue_id === queue.id).sort((a, b) => b.attempt_number - a.attempt_number);
      const previous = history[0], batch = byBatch.get(previous?.batch_id);
      const state = previous ? stateOf(previous, batch, now) : null;
      const kind = history.some(attempt => attempt.state === "processed") ? "processed" : !previous ? "new" :
        (previous.state === "claimed" && previous.claim_active !== false) ||
        (previous.state === "pending" && batch && !batch.revoked_at && (time(batch.expires_at) ?? 0) > now) ? "active" : "retry";
      return { queue, household: households.get(queue.household_id), previous, state, kind };
    });
    const histories = batches.map(batch => {
      const members = list(store.shortcutItems).filter(item => item.batch_id === batch.id).sort((a, b) => a.ordinal - b.ordinal);
      const rows = members.map(item => {
        const queue = list(store.queue).find(value => value.id === item.queue_id);
        const attempt = attempts.find(value => value.batch_id === batch.id && value.queue_id === item.queue_id);
        return { item, queue, household: households.get(queue?.household_id), attempt, state: attempt ? stateOf(attempt, batch, now) : "unknown" };
      });
      const progress = Object.fromEntries(STATES.map(state => [state, rows.filter(row => row.state === state).length]));
      return { batch, rows, progress };
    });
    return { entries, histories, readyCount: entries.filter(entry => entry.kind === "new").length };
  }
  function create({ R, T, getStore, can, managementRpc, reload, adminTime, show, apiBase, isSecure, confirm, getActor = () => null, clipboard }) {
    const $ = R.byId;
    const selections = { new: new Map(), retry: new Map() };
    const reviewed = { new: false, retry: false };
    let retryAcknowledged = false, busy = false, uncertain = false, held = null, actor = getActor(), status = "", generation = 0;
    const open = new Set();
    const text = key => T(phrases[key] || phrases.unknown);
    const name = household => household ? R.householdName(household) : text("household");
    const timestamp = value => time(value) === null ? text("not_yet") : adminTime(value);
    function secureBase() {
      try {
        const url = new URL(apiBase?.());
        return isSecure?.() && url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
          ? url.href.replace(/\/$/, "") : null;
      } catch { return null; }
    }
    function permitted() { return can("invites") && can("sendInvites"); }
    function enabled() { return getStore().settings?.apple_shortcuts_enabled === true; }
    function gate() { return enabled() && permitted() && !!getStore().settings?.is_published && !!secureBase(); }
    function clear() {
      generation++;
      held = null; actor = getActor();
      selections.new.clear(); selections.retry.clear(); reviewed.new = reviewed.retry = false;
      retryAcknowledged = false; uncertain = false; status = "";
    }
    function sync() {
      if (actor !== getActor() || !permitted()) clear();
      if (held && (time(held.expiresAt) ?? 0) <= Date.now()) held = null;
      if (held && !gate()) held = null;
      if (held && list(getStore().shortcutBatches).some(batch => batch.id === held.batchId && batch.revoked_at)) held = null;
    }
    function button(label, action, attributes = {}) {
      const element = R.dom("button", { type: "button", class: "btn secondary", ...attributes }, text(label));
      element.addEventListener("click", action);
      return element;
    }
    function detail(key, label, className) {
      const element = R.dom("details", { class: className });
      element.open = open.has(key);
      element.append(R.dom("summary", {}, label));
      element.addEventListener("toggle", () => { if (element.open) open.add(key); else open.delete(key); });
      return element;
    }
    function facts(values) {
      const element = R.dom("dl", { class: "shortcut-facts" });
      for (const [key, value] of values) {
        const definition = R.dom("dd", {}, value);
        definition.dataset.shortcutFact = key;
        element.append(R.dom("dt", {}, text(key)), definition);
      }
      return element;
    }
    function rsvp(household) {
      return household?.rsvp_state === "locked" ? text("confirmed_rsvp") :
        list(getStore().submissions).some(value => value.household_id === household?.id) ? text("replied") : text("awaiting");
    }
    function householdFacts(household) {
      return facts([
        ["first_visit", timestamp(household?.first_visited_at)],
        ["last_visit", timestamp(household?.last_visited_at)],
        ["visits", String(Math.max(0, Number(household?.visit_count) || 0))],
        ["rsvp", rsvp(household)],
      ]);
    }
    function currentSelection(kind) {
      const model = projection(getStore());
      return [...selections[kind]].map(([id, revision]) => model.entries.find(entry => entry.queue.id === id && entry.queue.revision === revision && entry.kind === kind));
    }
    function canPreselectNew(items) {
      if (!gate() || busy || uncertain || actor !== getActor() || !Array.isArray(items) ||
          items.length < 1 || items.length > 10) return false;
      const eligible = new Map(projection(getStore()).entries.filter(entry => entry.kind === "new")
        .map(({ queue }) => [queue.id, queue.revision]));
      const seen = new Set();
      for (const item of items) {
        if (!item || typeof item.id !== "string" || !Number.isInteger(item.revision) ||
            seen.has(item.id) || eligible.get(item.id) !== item.revision) return false;
        seen.add(item.id);
      }
      return true;
    }
    function preselectNew(items) {
      if (!canPreselectNew(items)) return false;
      selections.new = new Map(items.map(({ id, revision }) => [id, revision]));
      reviewed.new = false;
      retryAcknowledged = false;
      status = "";
      render();
      return true;
    }
    async function operation(work) {
      if (busy) return;
      busy = true; render();
      const operationGeneration = generation;
      try { await work(); }
      catch {
        if (generation === operationGeneration) {
          uncertain = true; held = null; status = text("error");
          show?.(status, "error");
        }
      } finally { busy = false; render(); }
    }
    function acceptAuthorization(result, expectedMode, recipients, expectedCount, expectedActor) {
      if (getActor() !== expectedActor || !gate()) return;
      if (!result || !UUID.test(result.batch_id || "") || !CAPABILITY.test(result.capability || "") ||
          result.mode !== expectedMode || !Number.isInteger(result.count) || result.count !== expectedCount ||
          (time(result.expires_at) ?? 0) <= Date.now()) throw Error("Invalid batch authorization");
      held = { batchId: result.batch_id, capability: result.capability, expiresAt: result.expires_at,
        mode: result.mode, recipients, actor: expectedActor, copied: false };
    }
    async function prepare(kind, trigger) {
      if (busy || uncertain || !gate() || !reviewed[kind] || (kind === "retry" && !retryAcknowledged)) return;
      const entries = currentSelection(kind);
      if (entries.length < 1 || entries.length > 10 || entries.some(entry => !entry)) {
        reviewed[kind] = false; status = text("selection_changed"); render(); return;
      }
      const initiatingActor = getActor(), initiatingGeneration = generation;
      await operation(async () => {
        if (kind === "retry" && !await confirm(text("confirm_retry"), trigger)) return;
        const current = currentSelection(kind);
        if (generation !== initiatingGeneration || getActor() !== initiatingActor || !gate() || current.length !== entries.length || current.some((entry, index) => !entry || entry.queue.id !== entries[index].queue.id || entry.queue.revision !== entries[index].queue.revision)) {
          reviewed[kind] = false; status = text("selection_changed"); return;
        }
        const expectedActor = initiatingActor;
        const result = await managementRpc("admin_create_shortcut_batch", {
          p_items: entries.map(entry => ({ queue_id: entry.queue.id, expected_revision: entry.queue.revision })),
          p_mode: "live", p_retry: kind === "retry",
        });
        if (generation !== initiatingGeneration || getActor() !== initiatingActor || !gate()) return;
        acceptAuthorization(result, "live", [...new Set(entries.map(entry => phone(entry.queue.recipient_snapshot.contact_value)))], entries.length, expectedActor);
        selections[kind].clear(); reviewed[kind] = false; retryAcknowledged = false;
        status = text("prepared");
        if (!await reload()) { uncertain = true; status = text("error"); }
      });
    }
    async function refresh() {
      await operation(async () => {
        if (!await reload()) throw Error("Refresh failed");
        uncertain = false; reviewed.new = reviewed.retry = false; status = "";
      });
    }
    async function manage(history, action, trigger) {
      if (busy || !permitted() || (history.batch.created_by !== getActor() && !can("full")) ||
          history.batch.revoked_at || (action === "renew" && !gate())) return;
      const initiatingActor = getActor(), initiatingGeneration = generation;
      await operation(async () => {
        if (action === "revoke" && !await confirm(text("confirm_revoke"), trigger)) return;
        if (generation !== initiatingGeneration || getActor() !== initiatingActor || !permitted() || (action === "renew" && !gate())) return;
        const expectedActor = initiatingActor;
        const result = await managementRpc("admin_manage_shortcut_batch", { p_batch_id: history.batch.id, p_action: action });
        if (generation !== initiatingGeneration || getActor() !== initiatingActor || !permitted()) return;
        if (action === "renew") {
          if (result?.batch_id !== history.batch.id) throw Error("Invalid renewed batch");
          const recipients = [...new Set(history.rows.map(row => phone(row.queue?.recipient_snapshot?.contact_value)))];
          if (!recipients.length || recipients.some(value => !PHONE.test(value))) throw Error("Invalid batch recipient");
          acceptAuthorization(result, history.batch.mode, recipients, history.rows.length, expectedActor);
          status = text("resume_help");
        } else {
          if (result?.batch_id !== history.batch.id || result.revoked !== true) throw Error("Invalid revocation");
          if (held?.batchId === history.batch.id) held = null;
          status = text("revoked_notice");
        }
        if (!await reload()) { uncertain = true; status = text("error"); }
      });
    }
    function renderLaunch(host) {
      if (!held || !gate() || held.actor !== getActor()) return;
      const section = R.dom("div", { class: "shortcut-selection" });
      section.append(R.dom("p", { class: "micro" }, text("expires") + ": " + timestamp(held.expiresAt)));
      const controls = R.dom("div", { class: "shortcut-toolbar" });
      const copy = button("copy", async () => {
        const authorization = held, copyGeneration = generation;
        if (busy || !authorization || !gate() || (time(authorization.expiresAt) ?? 0) <= Date.now()) return;
        try {
          const value = JSON.stringify({ schema_version: 1, api_base: secureBase(), batch_id: authorization.batchId,
            capability: authorization.capability, mode: authorization.mode, expected_recipients: authorization.recipients });
          await (clipboard || navigator.clipboard).writeText(value);
          if (generation !== copyGeneration || held !== authorization || getActor() !== authorization.actor || !gate()) return;
          held.copied = true; status = text("copied"); render();
        } catch { held = null; status = text("error"); render(); }
      }, { disabled: busy });
      copy.dataset.shortcutCopy = held.batchId;
      controls.append(copy);
      for (const [kind, shortcut] of [["runner", "RSVP Batch Runner"], ["uploader", "RSVP Upload Results"]]) {
        const link = R.dom("a", { class: "btn secondary", "aria-disabled": String(!held.copied || busy) }, text(kind));
        link.dataset.shortcutLaunch = kind;
        const target = "shortcuts://run-shortcut?name=" + encodeURIComponent(shortcut) + "&input=clipboard";
        if (held.copied && !busy) link.href = target;
        else link.tabIndex = -1;
        link.addEventListener("click", event => {
          if (!held || !held.copied || busy || !gate() || held.actor !== getActor() || (time(held.expiresAt) ?? 0) <= Date.now()) event.preventDefault();
        });
        controls.append(link);
      }
      controls.append(button("clear", () => { held = null; status = text("no_cap"); render(); }, { disabled: busy }));
      section.append(controls); host.append(section);
    }
    function renderCandidates(host, model, kind) {
      const entries = model.entries.filter(entry => entry.kind === kind);
      if (kind === "retry" && !entries.length) return;
      const section = kind === "retry" ? detail("retry-list", text("retry_title"), "shortcut-selection") : R.dom("div", { class: "shortcut-selection" });
      if (kind === "new") section.append(R.dom("h3", {}, text("new")));
      else section.append(R.dom("p", { class: "micro" }, text("retry_help")));
      if (!entries.length) section.append(R.dom("p", { class: "muted" }, text("no_ready")));
      const candidates = R.dom("div", { class: "shortcut-candidates" });
      for (const entry of entries) {
        const { queue, household } = entry;
        const row = R.dom("div", { class: "shortcut-candidate" });
        const label = R.dom("label", { class: "checkbox-label" });
        const include = R.dom("input", { type: "checkbox" });
        include.dataset.shortcutSelect = queue.id;
        include.checked = selections[kind].has(queue.id);
        include.disabled = busy || uncertain || !gate() || (!include.checked && selections[kind].size >= 10);
        include.setAttribute("aria-label", text("select") + ": " + name(household));
        include.addEventListener("change", () => {
          if (include.checked && selections[kind].size < 10) selections[kind].set(queue.id, queue.revision);
          else selections[kind].delete(queue.id);
          reviewed[kind] = false; retryAcknowledged = false; status = ""; render();
          $("shortcutBatchHost")?.querySelector('[data-shortcut-select="' + queue.id + '"]')?.focus({ preventScroll: true });
        });
        label.append(include, R.dom("strong", {}, name(household)));
        row.append(label, R.dom("p", { class: "micro" }, [queue.recipient_snapshot?.contact_name, queue.recipient_snapshot?.contact_value, "WhatsApp"].filter(Boolean).join(" · ")));
        if (entry.previous) row.append(R.dom("p", { class: "micro" }, text("state") + ": " + text(entry.state)));
        const preview = detail("preview:" + queue.id, text("review"), "shortcut-review");
        const message = R.dom("pre", { class: "shortcut-review-message" }, queue.message_body);
        message.dataset.shortcutPreview = queue.id;
        if (queue.message_subject) preview.append(R.dom("p", { class: "small" }, queue.message_subject));
        preview.append(message);
        window.RSVP_INVITATION_IMAGE?.preview(preview, queue.message_image, { R, T });
        for (const image of preview.querySelectorAll("img")) image.classList.add("shortcut-review-image");
        row.append(preview); candidates.append(row);
      }
      section.append(candidates);
      if (entries.length) {
        const ack = R.dom("label", { class: "checkbox-label" }), checkbox = R.dom("input", { type: "checkbox" });
        checkbox.dataset.shortcutReviewed = kind; checkbox.checked = reviewed[kind];
        checkbox.disabled = busy || uncertain || !gate() || !selections[kind].size;
        checkbox.addEventListener("change", () => {
          reviewed[kind] = checkbox.checked; render();
          $("shortcutBatchHost")?.querySelector('[data-shortcut-reviewed="' + kind + '"]')?.focus({ preventScroll: true });
        });
        ack.append(checkbox, document.createTextNode(text("reviewed"))); section.append(ack);
        if (kind === "retry") {
          const acknowledgement = R.dom("label", { class: "checkbox-label" }), input = R.dom("input", { type: "checkbox" });
          input.dataset.shortcutRetryAcknowledged = "true"; input.checked = retryAcknowledged;
          input.disabled = busy || uncertain || !gate() || !selections.retry.size;
          input.addEventListener("change", () => {
            retryAcknowledged = input.checked; render();
            $("shortcutBatchHost")?.querySelector("[data-shortcut-retry-acknowledged]")?.focus({ preventScroll: true });
          });
          acknowledgement.append(input, document.createTextNode(text("retry_ack"))); section.append(acknowledgement);
        }
        const controls = R.dom("div", { class: "shortcut-toolbar" });
        controls.append(R.dom("span", { class: "micro" }, text("batch_size") + ": " + selections[kind].size + " / 10"));
        const prepareButton = button(kind === "retry" ? "retry" : "prepare", event => prepare(kind, event.currentTarget), {
          disabled: busy || uncertain || !gate() || !reviewed[kind] || selections[kind].size < 1 || selections[kind].size > 10 || (kind === "retry" && !retryAcknowledged),
        });
        prepareButton.dataset.shortcutCreate = kind;
        controls.append(prepareButton); section.append(controls);
      }
      host.append(section);
    }
    function renderHistory(host, model) {
      const history = R.dom("div", { class: "shortcut-history" });
      history.append(R.dom("h3", {}, text("history")));
      if (!model.histories.length) history.append(R.dom("p", { class: "muted" }, text("no_history")));
      for (const item of model.histories) {
        const { batch, rows, progress } = item;
        const mode = ["live", "dry_run", "live_test"].includes(batch.mode) ? text("mode_" + batch.mode) : text("unknown");
        const label = text("created") + " " + timestamp(batch.created_at) + " · " + mode + " · " + progress.processed + " / " + rows.length;
        const card = detail("batch:" + batch.id, label, "shortcut-batch");
        card.dataset.shortcutBatch = batch.id;
        const metrics = R.dom("div", { class: "shortcut-summary" });
        for (const state of STATES) metrics.append(R.dom("span", {}, text(state) + ": " + progress[state]));
        card.append(metrics, R.dom("p", { class: "micro" }, batch.revoked_at ? text("revoked") + ": " + timestamp(batch.revoked_at) : text("expires") + ": " + timestamp(batch.expires_at)));
        if (!batch.revoked_at && permitted() && (batch.created_by === getActor() || can("full"))) {
          const controls = R.dom("div", { class: "shortcut-toolbar" });
          const resume = button("resume", event => manage(item, "renew", event.currentTarget), { disabled: busy || !gate() });
          resume.dataset.shortcutResume = batch.id;
          const revoke = button("revoke", event => manage(item, "revoke", event.currentTarget), { disabled: busy });
          revoke.dataset.shortcutRevoke = batch.id;
          controls.append(resume, revoke); card.append(controls, R.dom("p", { class: "micro" }, text("resume_help")));
        }
        for (const row of rows) {
          const { queue, household, attempt, state } = row;
          const recipient = queue?.recipient_snapshot || {};
          const attemptCard = detail("attempt:" + (attempt?.id || row.item.queue_id), [name(household), recipient.contact_value, text(state)].filter(Boolean).join(" · "), "shortcut-attempt");
          if (attempt) attemptCard.dataset.shortcutAttempt = attempt.id;
          const confirmed = list(getStore().deliveries).filter(delivery => delivery.queue_id === queue?.id).sort((a, b) => String(b.confirmed_at).localeCompare(String(a.confirmed_at)))[0];
          attemptCard.append(facts([
            ["household", name(household)],
            ["recipient", [recipient.contact_name, recipient.contact_value].filter(Boolean).join(" · ") || text("not_yet")],
            ["channel", queue?.channel === "whatsapp" ? "WhatsApp" : text("unknown")],
            ["handed", timestamp(attempt?.started_at)],
            ["processed", attempt?.state === "processed" ? timestamp(attempt.completed_at) : text("not_yet")],
            ["verified", queue?.verified_sent_at ? timestamp(queue.verified_sent_at) : text("unverified")],
            ["confirmed", confirmed ? timestamp(confirmed.confirmed_at) : queue?.status === "sent" ? timestamp(queue.updated_at) : text("not_yet")],
            ["text", attempt?.text_processed ? text("complete") : text("incomplete")],
            ["photo", !queue?.message_image ? text("not_required") : attempt?.photo_processed ? text("complete") : text("incomplete")],
          ]), householdFacts(household));
          if (["failed", "partial", "unknown"].includes(state) || attempt?.error_message) {
            const stage = attempt?.error_stage === "photo" ? T("interface.messages.layout_picture") :
              attempt?.error_stage === "text" ? T("interface.messages.message_text") :
              text(attempt?.error_stage === "unknown" ? "unknown" : "state");
            attemptCard.append(R.dom("p", { class: "notice" }, text("errors") + ": " + text(state) + " · " + stage));
          }
          card.append(attemptCard);
        }
        history.append(card);
      }
      host.append(history);
    }
    function render() {
      const host = $("shortcutBatchHost");
      if (!host) return;
      sync();
      const hidden = !enabled() || !can("invites");
      const workspace = $("shortcutWorkspace");
      if (workspace) { workspace.hidden = hidden; workspace.classList.toggle("hidden", hidden); }
      host.hidden = hidden; host.classList.toggle("hidden", hidden);
      if (hidden) { clear(); host.replaceChildren(); return; }
      const model = projection(getStore());
      for (const kind of ["new", "retry"]) for (const [id, revision] of selections[kind]) {
        if (!model.entries.some(entry => entry.kind === kind && entry.queue.id === id && entry.queue.revision === revision)) {
          selections[kind].delete(id); reviewed[kind] = false; retryAcknowledged = false; status = text("selection_changed");
        }
      }
      host.classList.add("shortcut-batches"); host.replaceChildren();
      host.setAttribute("aria-busy", String(busy));
      host.append(R.dom("h2", {}, text("title")), R.dom("p", { class: "micro" }, text("help")));
      if (!getStore().settings?.is_published) host.append(R.dom("p", { class: "notice" }, text("unpublished")));
      if (!secureBase()) host.append(R.dom("p", { class: "notice" }, text("https")));
      if (!permitted()) host.append(R.dom("p", { class: "micro" }, text("permission")));
      host.append(R.dom("p", { class: "micro" }, text("device_help")));
      const summary = R.dom("div", { class: "shortcut-summary" });
      summary.append(R.dom("span", {}, text("ready") + ": " + model.readyCount), R.dom("span", {}, text("channel") + ": WhatsApp"), R.dom("span", {}, text("limit")));
      const controls = R.dom("div", { class: "shortcut-toolbar" });
      const refreshButton = button("refresh", refresh, { disabled: busy }); refreshButton.dataset.shortcutRefresh = "true";
      const instructions = R.dom("a", { href: "../docs/ShortcutsNativeRunner.md" }, text("native_instructions"));
      controls.append(refreshButton, instructions); host.append(summary, controls);
      const notice = R.dom("p", { class: "shortcut-status", role: "status", "aria-live": "polite" }, status);
      notice.dataset.shortcutStatus = "true"; host.append(notice);
      renderLaunch(host); renderCandidates(host, model, "new"); renderCandidates(host, model, "retry");
      renderHistory(host, model);
      host.append(R.dom("p", { class: "micro" }, text("visit_help")));
    }
    return { render, clear, householdFacts, canPreselectNew, preselectNew };
  }
  window.RSVP_ADMIN_SHORTCUTS = Object.freeze({ create, projection });
})();
