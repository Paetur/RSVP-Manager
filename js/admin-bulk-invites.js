// Invites selection uses the ordinary snapshots and guarded preparation paths.
(function () {
  "use strict";
  const groups = { messages: "Messages", email: "Email", whatsapp: "WhatsApp", sms: "SMS", none: "None" };
  const deliveries = { email: "email", whatsapp: "whatsapp", sms: "sms", messages: "sms", none: "manual" };
  const draftScopes = { missing: "All missing", selected: "Selected" };
  const limit = 10;

  function create({ R, T, getStore, getActor, can, managementRpc, reload,
    primaryContact, primaryGuest, invitationDraft, getVisibleHouseholdIds,
    onSelectionChange = () => {} }) {
    const $ = R.byId;
    const host = () => $("bulkInvitesHost");
    const content = () => $("bulkInviteContent");
    const selected = new Set();
    let visibleHouseholds = new Set();
    let actor = null, review = false, busy = false, notice = "", generation = 0, selectionVersion = 0;
    let draftScope = "missing";
    const button = (label, action, disabled = false) => {
      const control = R.dom("button", { type: "button", class: "btn secondary", disabled }, T(label));
      control.addEventListener("click", action);
      return control;
    };
    const element = (tag, className, text) => R.dom(tag, { class: className }, text);
    const canDraft = () => !!getActor() && can("invites", "edit");
    const canSend = () => !!getActor() && can("invites") && can("sendInvites") && getStore().settings?.is_published === true;

    function resolveGroup(contact, guest, delivery) {
      return window.RSVP_ADMIN_OVERVIEW.invitationService(contact, guest, delivery);
    }

    function rows() {
      const store = getStore();
      const active = new Set(store.guests.filter(guest => !guest.archived_at).map(guest => guest.household_id));
      const latest = new Map();
      for (const delivery of store.queue) {
        if (delivery.status === "cancelled") continue;
        const previous = latest.get(delivery.household_id);
        if (!previous || (delivery.created_at || "") > (previous.created_at || "") ||
            (delivery.created_at === previous.created_at && (delivery.updated_at || "") > (previous.updated_at || "")))
          latest.set(delivery.household_id, delivery);
      }
      return store.households.filter(household => !household.archived_at && active.has(household.id)).map(household => {
        const queue = latest.get(household.id);
        const contact = primaryContact(household), guest = primaryGuest(household);
        let group = resolveGroup(contact, guest, queue?.channel);
        const type = group === "email" ? "email" : "phone";
        const recipient = contact?.contact_type === type ? contact.contact_value :
          type === "email" ? guest?.email : guest?.mobile;
        if (!(queue?.status === "ready" ? queue.recipient_snapshot?.contact_value : recipient)) group = "none";
        return { household, queue, group, recipient, name: R.householdName(household) };
      }).sort((a, b) => a.name.localeCompare(b.name) || a.household.id.localeCompare(b.household.id));
    }

    function clear() {
      generation++;
      actor = null;
      selected.clear();
      visibleHouseholds.clear();
      draftScope = "missing";
      review = false;
      notice = "";
      const panel = host();
      if (panel) panel.hidden = true;
      content()?.replaceChildren();
    }

    function sync() {
      if (actor === getActor() && can("invites")) return;
      clear();
      actor = getActor();
    }

    const eligible = row => (row.group !== "none" || !row.queue || row.queue.channel === "manual") &&
      !["sent", "failed"].includes(row.queue?.status);

    function syncVisible(ids) {
      sync();
      visibleHouseholds = new Set(ids || []);
      const all = new Map(rows().map(row => [row.household.id, row]));
      let hiddenSelection = false;
      for (const id of selected) {
        const row = all.get(id);
        if (visibleHouseholds.has(id) && row && eligible(row)) continue;
        selected.delete(id);
        // A completed item may leave a Draft-only view during an ordinary
        // reload. That pruning must not cancel the remaining captured items.
        if (!visibleHouseholds.has(id) && row?.queue?.status !== "sent") hiddenSelection = true;
        review = false;
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

    function selectionControl(householdId) {
      sync();
      const row = rows().find(item => item.household.id === householdId);
      const label = element("label", "bulk-invite-select");
      const input = R.dom("input", { type: "checkbox", disabled: busy || !actor || !can("invites") ||
        !visibleHouseholds.has(householdId) || !row || !eligible(row) || (!selected.has(householdId) && selected.size >= limit) });
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
        const fresh = rows().find(item => item.household.id === householdId);
        selectionVersion++;
        if (input.checked && visibleHouseholds.has(householdId) && fresh && eligible(fresh) && selected.size < limit)
          selected.add(householdId);
        else selected.delete(householdId);
        review = false;
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

    function sendable(row) {
      return row.queue?.status === "ready" && row.queue.invitation_code_snapshot === row.household.invite_code &&
        !!row.queue.message_body && readyMessage(row) === row.queue.message_body;
    }

    function current(row) {
      const active = rows().find(item => item.household.id === row.household.id);
      return active && active.queue?.id === row.queue?.id && active.queue?.revision === row.queue?.revision
        && active.group === row.group ? active : null;
    }

    async function writes(items, save, allowed, summary = count => T("{count} invitations prepared.", { count }),
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

    function missingDrafts(all) {
      return draftScope ? all.filter(row => !row.queue &&
        (draftScope === "missing" || visibleHouseholds.has(row.household.id) && selected.has(row.household.id))) : [];
    }

    function createDrafts() {
      const scope = draftScope, sameSelection = selectedScope();
      let unmatched = 0, ambiguous = 0, changed = 0;
      return writes(missingDrafts(rows()), async row => {
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
        // The save rechecks the unique match and this template revision under the delivery lock.
        const queueId = await managementRpc("admin_save_delivery", {
          p_id: null, p_household_id: household.id, p_expected_revision: null,
          p_values: { channel, contact_id: null, message_subject: draft.subject || "",
            message_body: draft.body, message_image: draft.image, status: "draft", only_if_missing: true,
            template_id: template.id, template_revision: template.revision },
        });
        if (!queueId) {
          changed++;
        }
        return queueId;
      }, canDraft, count => {
        return [
          T(count === 1 ? "{count} draft created" : "{count} drafts created", { count }),
          ambiguous && T("{count} with multiple matches", { count: ambiguous }),
          unmatched && T("{count} with no match", { count: unmatched }),
          changed && T("{count} changed during generation", { count: changed }),
        ].filter(Boolean).join(" · ");
      }, undefined, () => draftScope === scope && (scope !== "selected" || sameSelection()));
    }

    function markReady(items) {
      const sameSelection = selectedScope();
      review = false;
      return writes(items.filter(row => row.queue.status === "draft"), row => {
        const { queue, household } = row;
        const message = readyMessage(row);
        if (!message) return null;
        return managementRpc("admin_save_delivery", {
          p_id: queue.id, p_household_id: household.id, p_expected_revision: queue.revision,
          p_values: { channel: queue.channel, contact_id: queue.contact_id, message_subject: queue.message_subject || "",
            message_body: message, message_image: queue.message_image, status: "ready" },
        });
      }, () => canDraft() && canSend(), undefined, undefined, sameSelection);
    }

    function draftSendable(row) {
      return row.queue?.status === "draft" && (!row.queue.invitation_code_snapshot ||
        row.queue.invitation_code_snapshot === row.household.invite_code) && !!readyMessage(row);
    }

    function manualSendable(row) {
      return Number.isSafeInteger(row.queue?.revision) && row.queue.revision > 0 &&
        (sendable(row) || (canDraft() && draftSendable(row)));
    }

    function markSent(items) {
      const ids = items.map(row => row.household.id), finished = new Set(), version = selectionVersion;
      const sameSelection = () => {
        const visible = new Set(getVisibleHouseholdIds?.() || []);
        return selectionVersion === version && [...selected].every(id => ids.includes(id)) &&
          ids.every(id => finished.has(id) || selected.has(id) && visible.has(id));
      };
      if (!canSend() || !items.length || !sameSelection() || !items.every(manualSendable)) return;
      review = false;
      return writes(items, async (row, continuing) => {
        const { queue, household } = row;
        if (!queue || !Number.isSafeInteger(queue.revision) || queue.revision < 1 ||
            !manualSendable(row)) return false;
        const revision = queue.revision, code = household.invite_code, message = readyMessage(row);
        const recipient = queue.recipient_snapshot?.contact_value || row.recipient;
        const recipientType = queue.recipient_snapshot?.contact_type || (row.group === "email" ? "email" : "phone");
        let expected = revision;
        if (queue.status === "draft") {
          const prepared = await managementRpc("admin_save_delivery", {
            p_id: queue.id, p_household_id: household.id, p_expected_revision: revision,
            p_values: { channel: queue.channel, contact_id: queue.contact_id, message_subject: queue.message_subject || "",
              message_body: message, message_image: queue.message_image, status: "ready" },
          });
          if (prepared !== queue.id) throw Error(T("Changed. Try again."));
          expected = revision + 1;
          // Ready rebuilds its recipient snapshot. Refresh it before recording a
          // send, while retaining the pre-await revision and displayed recipient.
          if (!continuing()) throw Error(T("Changed. Try again."));
          if (!await reload()) throw Error(T("Bulk invites could not be refreshed."));
          const fresh = rows().find(item => item.household.id === household.id);
          if (!continuing() || !fresh || fresh.queue?.id !== queue.id || fresh.group !== row.group || fresh.household.invite_code !== code ||
              readyMessage(fresh) !== message || fresh.queue.revision !== expected ||
              (fresh.queue.recipient_snapshot?.contact_value || fresh.recipient) !== recipient ||
              (fresh.queue.recipient_snapshot?.contact_type || (fresh.group === "email" ? "email" : "phone")) !== recipientType) throw Error(T("Changed. Try again."));
        }
        if (!continuing()) return false;
        await managementRpc("admin_record_delivery_sent", {
          p_queue_id: queue.id, p_expected_revision: expected, p_note: "",
        });
        finished.add(household.id);
        return true;
      }, canSend, count => T(count === 1 ? "{count} invitation marked sent." : "{count} invitations marked sent.", { count }),
      "Marking sent stopped. Review the list before trying again.", sameSelection);
    }

    function renderReview(box, selection) {
      const section = element("section", "bulk-invite-review");
      section.setAttribute("aria-label", T("Review selected invitations"));
      section.append(element("h3", "", T("Review selected invitations")));
      for (const row of selection) {
        const { queue } = row;
        const item = element("details", "bulk-invite-review-item");
        item.open = selection.length === 1;
        item.append(R.dom("summary", {}, row.name + " · " + T(groups[row.group])));
        const recipient = queue.recipient_snapshot;
        item.append(element("p", "small", [recipient?.contact_name, recipient?.contact_value || row.recipient].filter(Boolean).join(" · ")));
        if (queue.message_subject) item.append(element("p", "small", queue.message_subject));
        item.append(element("pre", "delivery-message", readyMessage(row)));
        window.RSVP_INVITATION_IMAGE.preview(item, queue.message_image, { R, T });
        section.append(item);
      }
      section.append(button("Mark ready", () => markReady(selection)));
      section.append(button("Close", () => { review = false; render(); }));
      box.append(section);
    }

    function actionFieldset(all, selection) {
      const unavailable = busy || !canDraft();
      const enabled = !busy && canSend() && selection.length > 0 && selection.every(manualSendable);
      const fieldset = element("fieldset", "bulk-invite-filters bulk-invite-action");
      const scopes = element("div", "bulk-invite-scopes");
      for (const [key, label] of Object.entries(draftScopes)) {
        const option = element("label", "bulk-invite-filter");
        const input = R.dom("input", { type: "checkbox", disabled: unavailable });
        input.dataset.bulkDraftScope = key;
        input.checked = draftScope === key;
        input.addEventListener("change", () => {
          draftScope = input.checked ? key : null;
          notice = "";
          render();
          host()?.querySelector('[data-bulk-draft-scope="' + key + '"]')?.focus({ preventScroll: true });
        });
        option.append(input, document.createTextNode(T(label)));
        scopes.append(option);
      }
      const count = missingDrafts(all).length;
      const generate = button("Generate Drafts", createDrafts, unavailable || !count);
      const actions = element("div", "bulk-invite-actions");
      actions.append(generate, button("Mark Sent", () => markSent(selection), !enabled));
      fieldset.append(R.dom("legend", {}, T("Action")), scopes, actions);
      return fieldset;
    }

    function render() {
      const panel = host(), box = content();
      if (!panel || !box) return;
      sync();
      panel.hidden = !actor || !can("invites");
      box.replaceChildren();
      if (panel.hidden) return;
      syncVisible(getVisibleHouseholdIds?.());
      const all = rows(), visible = all.filter(row => visibleHouseholds.has(row.household.id));
      const selection = visible.filter(row => selected.has(row.household.id));
      const sendSelection = !busy && canSend() && selection.length > 0 && selection.every(sendable);
      const readySelection = !busy && canSend() && canDraft() && selection.some(row => row.queue?.status === "draft")
        && selection.every(row => sendable(row) || (row.queue?.status === "draft" && readyMessage(row)));
      const controls = element("div", "bulk-invite-controls");
      controls.append(actionFieldset(all, selection));
      box.append(controls);
      if (readySelection) {
        const actions = element("div", "bulk-invite-actions");
        actions.append(button("Review selected drafts", () => {
          review = true;
          render();
          box.querySelector(".bulk-invite-review")?.scrollIntoView({ block: "nearest" });
        }));
        box.append(actions);
      }
      const status = element("div", "bulk-invite-status-row");
      if (!getStore().settings?.is_published)
        status.append(element("p", "micro bulk-invite-hint", T("Publish the event to activate sending.")));
      else if (selection.length && !sendSelection && !readySelection)
        status.append(element("p", "micro bulk-invite-hint", T("Review incomplete drafts in Invites and mark them ready.")));
      if (status.childElementCount) box.append(status);
      if (notice) {
        const feedback = element("p", "micro bulk-invite-hint", notice);
        feedback.setAttribute("role", "status");
        box.append(feedback);
      }
      if (review && readySelection) renderReview(box, selection);
    }

    return { render, clear, syncVisible, selectionControl, selected: id => selected.has(id) };
  }
  window.RSVP_ADMIN_BULK_INVITES = Object.freeze({ create });
})();
