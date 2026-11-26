// Invites selection uses the ordinary snapshots and guarded preparation paths.
(function () {
  "use strict";
  const deliveries = { email: "email", whatsapp: "whatsapp", sms: "sms", messages: "sms", none: "manual" };
  const progressMessages = {
    draft: "Please wait while drafts are updated…",
    invitation: "Please wait while invitations are prepared…",
  };

  function create({ R, T, getStore, getActor, can, managementRpc, reload,
    primaryContact, primaryGuest, invitationDraft, saveReady, getVisibleHouseholdIds,
    readManualSend, applyManualSend, onManualSendChange,
    onSelectionChange = () => {} }) {
    const $ = R.byId;
    const host = () => $("bulkInvitesHost");
    const content = () => $("bulkInviteContent");
    const selected = new Set();
    const sends = new Map();
    let visibleHouseholds = new Set(), visibleRows = new Map();
    let actor = null, busy = false, progress = "", notice = null, generation = 0, selectionVersion = 0;
    let sendWorker = null;
    const button = (label, action, disabled = false) => {
      const control = R.dom("button", { type: "button", class: "btn secondary", disabled }, T(label));
      control.addEventListener("click", action);
      return control;
    };
    const element = (tag, className, text) => R.dom(tag, { class: className }, text);
    const canDraft = () => !!getActor() && can("invites", "edit");
    const canSend = () => !!getActor() && can("invites") && can("sendInvites") && getStore().settings?.is_published === true;
    const canPrepare = () => canDraft() && canSend();

    function resolveGroup(contact, guest, delivery) {
      return window.RSVP_ADMIN_OVERVIEW.invitationService(contact, guest, delivery);
    }

    function rows(householdId) {
      const store = getStore();
      const active = new Set(store.guests.filter(guest => !guest.archived_at).map(guest => guest.household_id));
      const latest = new Map();
      for (const delivery of store.queue) {
        if (delivery.status === "cancelled" || (householdId && delivery.household_id !== householdId)) continue;
        const previous = latest.get(delivery.household_id);
        if (!previous || (delivery.created_at || "") > (previous.created_at || "") ||
            (delivery.created_at === previous.created_at && ((delivery.updated_at || "") > (previous.updated_at || "") ||
              (delivery.updated_at === previous.updated_at && delivery.id > previous.id))))
          latest.set(delivery.household_id, delivery);
      }
      return store.households.filter(household => (!householdId || household.id === householdId) &&
        !household.archived_at && active.has(household.id)).map(household => {
        const queue = latest.get(household.id);
        const contact = primaryContact(household), guest = primaryGuest(household);
        let group = resolveGroup(contact, guest, queue?.channel);
        const type = group === "email" ? "email" : "phone";
        const recipient = contact?.contact_type === type ? contact.contact_value :
          type === "email" ? guest?.email : guest?.mobile;
        if (!(queue?.status === "ready" ? queue.recipient_snapshot?.contact_value : recipient)) group = "none";
        return { household, queue, group, name: R.householdName(household) };
      }).sort((a, b) => a.name.localeCompare(b.name) || a.household.id.localeCompare(b.household.id));
    }

    function clear() {
      generation++;
      actor = null;
      selected.clear();
      sends.clear();
      sendWorker = null;
      visibleHouseholds.clear();
      visibleRows.clear();
      progress = "";
      notice = null;
      const panel = host();
      if (panel) panel.hidden = true;
      content()?.replaceChildren();
      renderStatus();
    }

    function sync() {
      if (actor === getActor() && can("invites")) return;
      clear();
      actor = getActor();
    }

    const eligible = row => !sends.has(row.household.id) &&
      (row.group !== "none" || !row.queue || row.queue.status === "ready" || row.queue.channel === "manual") &&
      !["sent", "failed"].includes(row.queue?.status);

    function syncVisible(ids) {
      sync();
      visibleHouseholds = new Set(ids || []);
      const all = new Map(rows().map(row => [row.household.id, row]));
      visibleRows = new Map([...all].filter(([id]) => visibleHouseholds.has(id)));
      let hiddenSelection = false;
      for (const id of selected) {
        const row = all.get(id);
        if (visibleHouseholds.has(id) && row && eligible(row)) continue;
        selected.delete(id);
        // A completed item may leave an invitation filter during an ordinary
        // reload. That pruning must not cancel the remaining captured items.
        if (!visibleHouseholds.has(id) && row?.queue?.status !== "sent") hiddenSelection = true;
      }
      if (hiddenSelection) selectionVersion++;
    }

    function refreshSelection() {
      render();
      onSelectionChange();
    }

    function clearSelection({ focus = true } = {}) {
      if (busy || actor !== getActor() || !can("invites")) return false;
      selectionVersion++;
      selected.clear();
      notice = null;
      refreshSelection();
      if (focus) $("inviteRows")?.querySelector("[data-bulk-select-all]:enabled")?.focus({ preventScroll: true });
      return true;
    }

    function selectedScope() {
      const ids = [...selected], version = selectionVersion;
      return () => {
        const visible = new Set(getVisibleHouseholdIds?.() || []);
        return selectionVersion === version && selected.size === ids.length &&
          ids.every(id => selected.has(id) && visible.has(id));
      };
    }

    function selectableVisibleIds() {
      return [...visibleRows.values()].filter(eligible)
        .map(row => row.household.id);
    }

    function selectAllControl() {
      sync();
      const ids = selectableVisibleIds();
      const count = ids.filter(id => selected.has(id)).length;
      const checked = ids.length > 0 && count === ids.length;
      const mixed = count > 0 && !checked;
      const label = element("label", "bulk-invite-select");
      const input = R.dom("input", { type: "checkbox", disabled: busy || !actor || !can("invites") || !ids.length });
      input.dataset.bulkSelectAll = "";
      input.setAttribute("aria-label", T("interface.messages.select_all"));
      input.setAttribute("aria-describedby", "inviteSelectionCount");
      input.checked = checked;
      input.indeterminate = mixed;
      input.addEventListener("change", () => {
        selectionVersion++;
        if (busy || !getActor() || actor !== getActor() || !can("invites")) {
          input.checked = checked;
          input.indeterminate = mixed;
          return;
        }
        syncVisible(getVisibleHouseholdIds?.());
        for (const id of selectableVisibleIds()) {
          if (input.checked) selected.add(id);
          else selected.delete(id);
        }
        refreshSelection();
        $("inviteRows")?.querySelector("[data-bulk-select-all]")?.focus({ preventScroll: true });
      });
      const counter = R.dom("span", { id: "inviteSelectionCount" }, count + "/" + ids.length);
      label.classList.add("bulk-invite-select-all");
      label.append(counter, input);
      return label;
    }

    function selectionControl(householdId) {
      sync();
      const row = visibleRows.get(householdId);
      const label = element("label", "bulk-invite-select");
      const input = R.dom("input", { type: "checkbox", disabled: busy || !actor || !can("invites") ||
        !visibleHouseholds.has(householdId) || !row || !eligible(row) });
      input.dataset.bulkSelect = householdId;
      input.checked = selected.has(householdId);
      input.setAttribute("aria-label", T("Select invitation for {household}", { household: row?.name || "" }));
      // Keep a label-sized touch target inside the details summary, while
      // retaining the native checkbox and label activation behavior.
      label.addEventListener("click", event => event.stopPropagation());
      label.addEventListener("keydown", event => {
        if ([" ", "Enter"].includes(event.key)) event.stopPropagation();
      });
      input.addEventListener("change", () => {
        if (busy || !getActor() || actor !== getActor() || !can("invites")) {
          // A stale or forced checkbox event still cancels a captured write
          // scope, even though disabled controls cannot change the selection.
          selectionVersion++;
          input.checked = selected.has(householdId);
          return;
        }
        syncVisible(getVisibleHouseholdIds?.());
        const fresh = visibleRows.get(householdId);
        selectionVersion++;
        if (input.checked && visibleHouseholds.has(householdId) && fresh && eligible(fresh))
          selected.add(householdId);
        else selected.delete(householdId);
        refreshSelection();
        $("inviteRows")?.querySelector('[data-bulk-select="' + CSS.escape(householdId) + '"]')?.focus({ preventScroll: true });
      });
      label.append(input);
      return label;
    }

    function readyMessage(row) {
      if (row.group === "none" && row.queue?.channel !== "manual") return null;
      return window.RSVP_INVITATION_TEXT.deliveryMessage(row.household, row.queue, R);
    }

    const revisioned = queue => Number.isSafeInteger(queue?.revision) && queue.revision > 0;

    function sendable(row) {
      return row.queue?.status === "ready" && revisioned(row.queue) &&
        row.queue.invitation_code_snapshot === row.household.invite_code && !!row.queue.recipient_snapshot?.contact_value?.trim() &&
        !!row.queue.message_body && readyMessage(row) === row.queue.message_body;
    }

    function preparableMessage({ household, queue, group }) {
      return queue?.status === "draft" && revisioned(queue) &&
        (!queue.invitation_code_snapshot || queue.invitation_code_snapshot === household.invite_code)
        ? readyMessage({ household, queue, group }) : null;
    }

    const draftable = row => row.queue?.status === "ready" && revisioned(row.queue);
    const canMakeDraft = row => !row.queue || draftable(row);

    async function saveAsDraft({ household, queue }) {
      const id = await managementRpc("admin_save_delivery", {
        p_id: queue.id,
        p_household_id: household.id,
        p_expected_revision: queue.revision,
        p_values: { status: "draft", only_if_ready: true },
      });
      if (id !== queue.id) throw Error(T("Changed. Try again."));
      return true;
    }

    async function changeToDraft(household, record) {
      if (busy || sends.has(household.id) || !canDraft()) return false;
      const owner = getActor();
      const [row] = rows(household.id);
      if (!row || row.queue?.id !== record.id || row.queue?.revision !== record.revision || !draftable(row)) return false;
      return await saveAsDraft(row) && getActor() === owner && canDraft();
    }

    function current(row) {
      const [active] = rows(row.household.id);
      return active && active.queue?.id === row.queue?.id && active.queue?.revision === row.queue?.revision
        && active.group === row.group ? active : null;
    }

    async function writes(items, save, allowed, pending, summary,
      failure = "Bulk preparation stopped. Review the list before trying again.", scope = () => true) {
      if (busy || !allowed()) return;
      const owner = getActor(), start = generation;
      const snapshots = items.map(row => ({ ...row, queue: row.queue ? { ...row.queue } : null }));
      let count = 0;
      busy = true;
      progress = pending;
      notice = null;
      refreshSelection();
      const continuing = () => generation === start && getActor() === owner && allowed();
      try {
        let operationFailure = "";
        try {
          for (const item of snapshots) {
            if (!continuing() || !scope()) break;
            const row = current(item);
            if (row && await save(row, () => continuing() && scope())) count++;
          }
        } catch (error) {
          operationFailure = T(failure) + " " + R.safeError(error);
        }
        if (!continuing()) return;
        const refreshed = await reload().catch(() => false);
        if (continuing()) {
          notice = {
            text: [
              (count || !operationFailure) && summary(count),
              operationFailure,
              !refreshed && T("Bulk invites could not be refreshed."),
            ].filter(Boolean).join(" · "),
            state: operationFailure || !refreshed ? "error" : count ? "success" : "notice",
          };
        }
      } finally {
        busy = false;
        progress = "";
        refreshSelection();
      }
    }

    async function makeDrafts() {
      syncVisible(getVisibleHouseholdIds?.());
      const items = [...visibleRows.values()].filter(row => selected.has(row.household.id) && canMakeDraft(row));
      if (!items.length || busy || !canDraft()) return;
      let reverted = 0, unmatched = 0, ambiguous = 0, changed = 0;
      await writes(items, async row => {
        if (row.queue) {
          if (!draftable(row)) return false;
          await saveAsDraft(row);
          reverted++;
          return true;
        }
        const { household } = row;
        const service = row.group === "none" ? "manual" : row.group;
        const matches = (getStore().invitationTemplates || []).filter(template =>
          template.channels.includes(service) && template.language_tags?.includes(household.language));
        if (matches.length !== 1) {
          if (matches.length) ambiguous++;
          else unmatched++;
          return false;
        }
        const [template] = matches;
        const channel = deliveries[row.group];
        const draft = invitationDraft(household, channel, {
          templateId: template.id, templateService: service, language: household.language,
        });
        const values = { channel, contact_id: null, message_subject: draft.subject || "",
          message_body: draft.body, message_image: draft.image };
        // The server checks template identity and eligibility under its delivery lock.
        const queueId = await managementRpc("admin_save_delivery", {
          p_id: null, p_household_id: household.id, p_expected_revision: null,
          p_values: { ...values, status: "draft", only_if_missing: true,
            template_id: template.id, template_revision: template.revision },
        });
        if (!queueId) {
          changed++;
          return false;
        }
        return true;
      }, canDraft, "draft", count => {
        const drafts = count - reverted;
        return [
          (drafts || !reverted) && T(drafts === 1 ? "{count} draft created" : "{count} drafts created", { count: drafts }),
          reverted && T(reverted === 1 ? "{count} invitation changed to draft." : "{count} invitations changed to draft.", { count: reverted }),
          ambiguous && T("{count} with multiple matches", { count: ambiguous }),
          unmatched && T("{count} with no match", { count: unmatched }),
          changed && T("{count} changed during generation", { count: changed }),
        ].filter(Boolean).join(" · ");
      }, undefined, selectedScope());
      focusAfterReadiness("[data-bulk-mark-ready]:enabled");
    }

    async function makeInvitations() {
      syncVisible(getVisibleHouseholdIds?.());
      const items = [...visibleRows.values()].filter(row => selected.has(row.household.id) && preparableMessage(row));
      if (!items.length || busy || !canPrepare()) return;
      await writes(items, (row, continuing) => {
        if (!continuing()) return false;
        const message = preparableMessage(row);
        return message && saveReady(row.household, row.queue, message);
      }, canPrepare, "invitation", count => T(count === 1 ? "{count} invitation marked ready." : "{count} invitations marked ready.", { count }),
      undefined, selectedScope());
      focusAfterReadiness("[data-bulk-make-draft]:enabled");
    }

    function focusAfterReadiness(selector) {
      if (document.activeElement !== document.body) return;
      const fallback = [
        content()?.querySelector(selector),
        $("inviteRows")?.querySelector("[data-bulk-select-all]:enabled"),
        $("inviteOverviewCounts")?.querySelector('[aria-pressed="true"]'),
        $("inviteSearchToggle"),
      ].find(control => control?.getClientRects().length);
      fallback?.focus({ preventScroll: true });
    }

    function updateSending(ids, recorded = false) {
      render();
      onManualSendChange(ids, { recorded });
    }

    function markSent() {
      syncVisible(getVisibleHouseholdIds?.());
      const items = [...visibleRows.values()].filter(row => selected.has(row.household.id));
      if (busy || !canSend() || !items.length || !items.every(row => eligible(row) && sendable(row))) return;
      const ids = [];
      for (const row of items) {
        const id = row.household.id;
        sends.set(id, { row, state: "pending", attempted: false });
        selected.delete(id);
        ids.push(id);
      }
      selectionVersion++;
      notice = null;
      updateSending(ids);
      focusAfterReadiness("[data-bulk-mark-sent]:enabled");
      void drainSends();
    }

    function retrySent(id) {
      sync();
      if (!canSend()) return;
      const ids = [];
      for (const [householdId, job] of sends) {
        if ((id == null || householdId === id) && job.state === "retry") {
          job.state = "pending";
          ids.push(householdId);
        }
      }
      if (!ids.length) return;
      notice = null;
      updateSending(ids);
      void drainSends();
    }

    async function drainSends() {
      if (sendWorker || !canSend()) return;
      const worker = { generation, actor: getActor() };
      sendWorker = worker;
      let recordedCount = 0;
      const currentActor = () => sendWorker === worker && generation === worker.generation && getActor() === worker.actor;
      try {
        while (currentActor() && canSend()) {
          const entry = [...sends].find(([, job]) => job.state === "pending");
          if (!entry) break;
          const [id, job] = entry;
          const { queue } = job.row;
          const read = () => readManualSend(queue);
          try {
            const previous = job.attempted ? await read() : null;
            if (!currentActor()) return;
            let recorded = previous?.delivery ? previous : null;
            const active = current(job.row);
            if (!recorded && (!canSend() || !active || !sendable(active) ||
                (previous && (previous.queue?.status !== "ready" || previous.queue.revision !== queue.revision)))) {
              sends.delete(id);
              notice = { text: T("Changed. Try again."), state: "error" };
              updateSending([id]);
              continue;
            }
            if (!recorded) {
              job.attempted = true;
              try {
                await managementRpc("admin_record_delivery_sent", {
                  p_queue_id: queue.id, p_expected_revision: queue.revision, p_note: "",
                });
              } catch (_) {
                // The response can be lost after the database commits. Read the
                // exact queue item before making a retry available.
              }
              if (!currentActor()) return;
              recorded = await read();
            }
            if (!currentActor()) return;
            if (!recorded?.delivery) {
              job.state = "retry";
              updateSending([id]);
              continue;
            }
            applyManualSend(recorded);
            sends.delete(id);
            recordedCount++;
            notice = {
              text: T(recordedCount === 1 ? "{count} invitation marked sent." : "{count} invitations marked sent.", { count: recordedCount }),
              state: "success",
            };
            updateSending([id], true);
          } catch (_) {
            if (!currentActor()) return;
            job.state = "retry";
            updateSending([id]);
          }
        }
        if (currentActor() && !canSend()) {
          const ids = [];
          for (const [id, job] of sends) {
            if (job.state !== "pending") continue;
            job.state = "retry";
            ids.push(id);
          }
          if (ids.length) updateSending(ids);
        }
      } finally {
        if (sendWorker === worker) sendWorker = null;
      }
    }

    function renderStatus(hint = "", publicationRequired = false) {
      const status = $("bulkInviteStatus"), guidance = $("bulkInviteHint"), feedback = $("bulkInviteFeedback");
      if (!status || !guidance || !feedback) return false;
      const message = progress ? T(progressMessages[progress]) : notice?.text || "";
      const state = progress ? "busy" : notice?.state || "";
      let queue = $("bulkInviteSendQueue");
      if (!queue) {
        queue = R.dom("div", { id: "bulkInviteSendQueue", class: "bulk-invite-send-queue" });
        const summary = R.dom("span", { id: "bulkInviteSendSummary" });
        summary.setAttribute("role", "status");
        const retry = button("Retry", () => retrySent());
        retry.dataset.retryAllMarkSent = "";
        queue.append(summary, retry);
        status.append(queue);
      }
      const jobs = [...sends.values()], retryCount = jobs.filter(job => job.state === "retry").length;
      const pendingCount = jobs.length - retryCount;
      const summary = queue.firstElementChild, retry = queue.lastElementChild;
      const queueMessage = [
        pendingCount && T("{count} recording", { count: pendingCount }),
        retryCount && T("{count} needs retry", { count: retryCount }),
      ].filter(Boolean).join(" · ");
      if (summary.textContent !== queueMessage) summary.textContent = queueMessage;
      retry.hidden = !retryCount;
      retry.disabled = !canSend();
      queue.hidden = !jobs.length;
      const explanation = !message || publicationRequired ? hint : "";
      status.hidden = !(message || explanation || jobs.length);
      guidance.hidden = !explanation;
      if (guidance.textContent !== explanation) guidance.textContent = explanation;
      if (feedback.textContent === message && feedback.dataset.state === state) return !status.hidden;
      feedback.dataset.state = state;
      const icon = state === "busy" || state === "success"
        ? element("span", state === "busy" ? "bulk-invite-spinner" : "bulk-invite-result-icon") : null;
      icon?.setAttribute("aria-hidden", "true");
      feedback.replaceChildren(...[icon, message && R.dom("span", {}, message)].filter(Boolean));
      return !status.hidden;
    }

    function render() {
      const panel = host(), box = content();
      if (!panel || !box) return;
      const active = document.activeElement;
      const focusedAction = box.contains(active) &&
        [".bulk-invite-clear", "[data-bulk-make-draft]", "[data-bulk-mark-ready]", "[data-bulk-mark-sent]"]
          .find(selector => active.matches(selector));
      sync();
      box.replaceChildren();
      box.setAttribute("aria-busy", String(busy));
      if (!actor || !can("invites")) {
        panel.hidden = box.hidden = true;
        renderStatus();
        return;
      }
      syncVisible(getVisibleHouseholdIds?.());
      const selection = [...visibleRows.values()].filter(row => selected.has(row.household.id));
      box.hidden = !selection.length;
      if (selection.length) {
        const context = element("div", "bulk-invite-selection");
        const clear = R.dom("button", {
          type: "button", class: "bulk-invite-clear", disabled: busy,
        }, T("interface.messages.clear_selection"));
        clear.addEventListener("click", () => clearSelection());
        context.append(element("span", "bulk-invite-count", T("interface.messages.invites_count_selected", { count: selection.length })), clear);
        const actions = element("div", "bulk-invite-actions");
        const makeDraft = button("Make draft(s)", makeDrafts,
          busy || !canDraft() || !selection.some(canMakeDraft));
        const markReady = button("Make invitation(s)", makeInvitations,
          busy || !canPrepare() || !selection.some(preparableMessage));
        const mark = button("Mark sent", markSent,
          busy || !canSend() || !selection.every(sendable));
        makeDraft.dataset.bulkMakeDraft = "";
        markReady.dataset.bulkMarkReady = "";
        mark.dataset.bulkMarkSent = "";
        makeDraft.classList.toggle("is-running", progress === "draft");
        markReady.classList.toggle("is-running", progress === "invitation");
        actions.append(makeDraft, markReady, mark);
        box.append(context, actions);
      }
      const publicationRequired = !getStore().settings?.is_published;
      const hint = publicationRequired ? T("Publish the event to activate sending.") :
        selection.some(row => row.queue && !sendable(row)) ? T("Review incomplete drafts in Invites and mark them ready.") : "";
      const hasStatus = renderStatus(hint, publicationRequired);
      panel.hidden = !selection.length && !hasStatus;
      if (focusedAction) box.querySelector(focusedAction + ":enabled")?.focus({ preventScroll: true });
    }

    return { render, clear, syncVisible, selectionControl, selectAllControl, clearSelection, changeToDraft, retrySent,
      sentState: id => sends.get(id)?.state || null,
      selected: id => selected.has(id) };
  }
  window.RSVP_ADMIN_BULK_INVITES = Object.freeze({ create });
})();
