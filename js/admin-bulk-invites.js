// Invites selection uses the ordinary snapshots and guarded preparation paths.
(function () {
  "use strict";
  const deliveries = { email: "email", whatsapp: "whatsapp", sms: "sms", messages: "sms", none: "manual" };

  function create({ R, T, getStore, getActor, can, managementRpc, reload,
    primaryContact, primaryGuest, invitationDraft, getVisibleHouseholdIds,
    onSelectionChange = () => {} }) {
    const $ = R.byId;
    const host = () => $("bulkInvitesHost");
    const content = () => $("bulkInviteContent");
    const selected = new Set();
    let visibleHouseholds = new Set(), visibleRows = new Map();
    let actor = null, busy = false, notice = "", generation = 0, selectionVersion = 0;
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
      visibleHouseholds.clear();
      visibleRows.clear();
      notice = "";
      const panel = host();
      if (panel) panel.hidden = true;
      content()?.replaceChildren();
      $("bulkInviteStatus")?.replaceChildren();
    }

    function sync() {
      if (actor === getActor() && can("invites")) return;
      clear();
      actor = getActor();
    }

    const eligible = row => (row.group !== "none" || !row.queue || row.queue.status === "ready" || row.queue.channel === "manual") &&
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

    async function saveStatus(household, queue, values) {
      const saved = await managementRpc("admin_save_delivery", {
        p_id: queue.id, p_household_id: household.id, p_expected_revision: queue.revision, p_values: values,
      });
      if (saved !== queue.id) throw Error(T("Changed. Try again."));
      return true;
    }

    function saveAsReady(household, queue, message) {
      return saveStatus(household, queue, {
        status: "ready",
        channel: queue.channel,
        contact_id: queue.contact_id || null,
        message_subject: window.RSVP_INVITATION_TEXT.deliverySubject(household, queue, R),
        message_body: message,
        message_image: queue.message_image ?? null,
        expected_invitation_code: household.invite_code,
      });
    }

    function saveAsDraft({ household, queue }) {
      return saveStatus(household, queue, { status: "draft", only_if_ready: true });
    }

    async function changeToDraft(household, record) {
      if (busy || !canDraft()) return false;
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

    async function writes(items, save, allowed, summary,
      failure = "Bulk preparation stopped. Review the list before trying again.", scope = () => true) {
      if (busy || !allowed()) return;
      const owner = getActor(), start = generation;
      const snapshots = items.map(row => ({ ...row, queue: row.queue ? { ...row.queue } : null }));
      let count = 0;
      busy = true; notice = ""; refreshSelection();
      const continuing = () => generation === start && getActor() === owner && allowed();
      try {
        for (const item of snapshots) {
          if (!continuing() || !scope()) break;
          const row = current(item);
          if (row && await save(row, () => continuing() && scope())) count++;
        }
        if (continuing()) {
          if (!await reload()) throw Error(T("Bulk invites could not be refreshed."));
          if (continuing()) notice = summary(count);
        }
      } catch (error) {
        if (continuing()) {
          await reload();
          if (continuing()) notice = (count ? summary(count) + " " : "") + T(failure) + " " + R.safeError(error);
        }
      } finally {
        busy = false;
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
      }, canDraft, count => {
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
        return message && saveAsReady(row.household, row.queue, message);
      }, canPrepare, count => T(count === 1 ? "{count} invitation marked ready." : "{count} invitations marked ready.", { count }),
      undefined, selectedScope());
      focusAfterReadiness("[data-bulk-make-draft]:enabled");
    }

    function focusAfterReadiness(selector) {
      if (document.activeElement !== document.body) return;
      const fallback = content()?.querySelector(selector) ??
        $("inviteOverviewCounts")?.querySelector('[aria-pressed="true"]');
      if (fallback?.getClientRects().length) fallback.focus({ preventScroll: true });
    }

    function markSent(items) {
      const ids = new Set(items.map(row => row.household.id)), finished = new Set(), version = selectionVersion;
      const sameSelection = () => {
        const visible = new Set(getVisibleHouseholdIds?.() || []);
        return selectionVersion === version && [...selected].every(id => ids.has(id)) &&
          [...ids].every(id => finished.has(id) || selected.has(id) && visible.has(id));
      };
      if (!canSend() || !items.length || !sameSelection() || !items.every(sendable)) return;
      return writes(items, async (row, continuing) => {
        const { queue, household } = row;
        if (!sendable(row) || !continuing()) return false;
        await managementRpc("admin_record_delivery_sent", {
          p_queue_id: queue.id, p_expected_revision: queue.revision, p_note: "",
        });
        finished.add(household.id);
        return true;
      }, canSend, count => T(count === 1 ? "{count} invitation marked sent." : "{count} invitations marked sent.", { count }),
      "Marking sent stopped. Review the list before trying again.", sameSelection);
    }

    function render() {
      const panel = host(), box = content(), statusBox = $("bulkInviteStatus");
      if (!panel || !box) return;
      sync();
      panel.hidden = !actor || !can("invites");
      box.replaceChildren();
      statusBox?.replaceChildren();
      if (panel.hidden) return;
      syncVisible(getVisibleHouseholdIds?.());
      const selection = [...visibleRows.values()].filter(row => selected.has(row.household.id));
      const actions = element("div", "bulk-invite-actions");
      const sendEnabled = !busy && canSend() && selection.length > 0 && selection.every(sendable);
      const markReady = button("Make invitation(s)", makeInvitations,
        busy || !canPrepare() || !selection.some(preparableMessage));
      markReady.dataset.bulkMarkReady = "";
      const makeDraft = button("Make draft(s)", makeDrafts,
        busy || !canDraft() || !selection.some(canMakeDraft));
      makeDraft.dataset.bulkMakeDraft = "";
      actions.append(
        makeDraft,
        markReady,
        button("Mark sent", () => markSent(selection), !sendEnabled),
      );
      box.append(actions);
      if (!getStore().settings?.is_published)
        statusBox?.append(element("p", "micro bulk-invite-hint", T("Publish the event to activate sending.")));
      else if (selection.some(row => row.queue && !sendable(row)))
        statusBox?.append(element("p", "micro bulk-invite-hint", T("Review incomplete drafts in Invites and mark them ready.")));
      if (notice) {
        const feedback = element("p", "micro bulk-invite-hint", notice);
        feedback.setAttribute("role", "status");
        statusBox?.append(feedback);
      }
    }

    return { render, clear, syncVisible, selectionControl, selectAllControl, changeToDraft,
      selected: id => selected.has(id) };
  }
  window.RSVP_ADMIN_BULK_INVITES = Object.freeze({ create });
})();
