// Overview uses the ordinary invitation snapshots and device delivery paths.
(function () {
  "use strict";
  const groups = { messages: "Messages", email: "Email", whatsapp: "WhatsApp", sms: "SMS", none: "None" };
  const deliveries = { email: "email", whatsapp: "whatsapp", sms: "sms", messages: "sms", none: "manual" };
  const statuses = { draft: "Draft", ready: "Ready", sent: "Recorded sent", failed: "Failed" };
  const inviteFilters = { sent: "Sent", draft: "Draft", none: "No Draft" };
  const limit = 10;

  function create({ R, T, getStore, getActor, can, managementRpc, reload, show,
    primaryContact, primaryGuest, invitationDraft, shortcuts, openShortcuts }) {
    const $ = R.byId;
    const host = () => $("bulkInvitesHost");
    const shownServices = new Set(Object.keys(groups));
    const shownInvites = new Set(Object.keys(inviteFilters));
    const selected = new Set();
    let actor = null, review = null, busy = false, notice = "", generation = 0;
    const button = (label, action, disabled = false) => {
      const control = R.dom("button", { type: "button", class: "btn secondary", disabled }, T(label));
      control.addEventListener("click", action);
      return control;
    };
    const element = (tag, className, text) => R.dom(tag, { class: className }, text);
    const canDraft = () => !!getActor() && can("invites", "edit");
    const canSend = () => !!getActor() && can("invites") && can("sendInvites") && getStore().settings?.is_published === true;

    function resolveGroup(contact, guest, delivery) {
      const preferred = contact ? contact.preferred_method : guest?.preferred_contact_method;
      if (delivery === "email" || delivery === "whatsapp") return delivery;
      if (delivery === "sms") return preferred === "sms" ? "sms" : "messages";
      if (delivery) return "none";
      if (contact?.contact_type === "email" || (!contact && preferred === "email" && guest?.email)) return "email";
      if (contact?.contact_type === "phone" || (!contact && guest?.mobile)) {
        if (preferred === "whatsapp" || preferred === "sms") return preferred;
        if (!preferred) return "messages";
      }
      if (!contact && !preferred && guest?.email) return "email";
      return "none";
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
      review = null;
      notice = "";
      host()?.replaceChildren();
    }

    function sync() {
      if (actor === getActor() && can("invites")) return;
      clear();
      actor = getActor();
    }

    function readyMessage(row) {
      const { household, queue } = row;
      if (!queue || !household.invite_code || (row.group === "none" && queue.channel !== "manual")) return null;
      const link = R.invitationURL(household.invite_code);
      const message = queue.message_body?.replaceAll("{invitation_link}", link);
      if (!message || /[{}]/.test(message + (queue.message_subject || ""))) return null;
      return [...message.matchAll(/https?:\/\/[^\s<>"']+/g)]
        .some(match => match[0].replace(/[).,!?;]+$/, "") === link) ? message : null;
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

    function shareCurrent(row, owner) {
      const matched = current(row);
      return getActor() === owner && canSend() && matched && sendable(matched);
    }

    async function writes(items, save, allowed) {
      if (busy || !allowed()) return;
      const owner = getActor(), start = generation;
      let count = 0;
      busy = true; notice = ""; render();
      const continuing = () => generation === start && getActor() === owner && allowed();
      try {
        for (const item of items) {
          if (!continuing()) break;
          const row = current(item);
          if (row && await save(row)) count++;
        }
        if (continuing()) {
          if (!await reload()) throw Error(T("Bulk invites could not be refreshed."));
          if (continuing()) notice = T("{count} invitations prepared.", { count });
        }
      } catch (error) {
        if (continuing()) {
          await reload();
          if (continuing()) notice = T("Bulk preparation stopped. Review the list before trying again.") + " " + R.safeError(error);
        }
      } finally {
        busy = false;
        render();
      }
    }

    function createDrafts() {
      const pending = rows().filter(row => !row.queue);
      return writes(pending, row => {
        const channel = deliveries[row.group];
        const draft = invitationDraft(row.household, channel);
        return managementRpc("admin_save_delivery", {
          p_id: null, p_household_id: row.household.id, p_expected_revision: null,
          p_values: { channel, contact_id: null, message_subject: draft.subject || "",
            message_body: draft.body, message_image: draft.image, status: "draft", only_if_missing: true },
        });
      }, canDraft);
    }

    function markReady(items) {
      review = null;
      return writes(items.filter(row => row.queue.status === "draft"), row => {
        const { queue, household } = row;
        const message = readyMessage(row);
        if (!message) return null;
        return managementRpc("admin_save_delivery", {
          p_id: queue.id, p_household_id: household.id, p_expected_revision: queue.revision,
          p_values: { channel: queue.channel, contact_id: queue.contact_id, message_subject: queue.message_subject || "",
            message_body: message, message_image: queue.message_image, status: "ready" },
        });
      }, () => canDraft() && canSend());
    }

    function copyMessage(section, row, owner) {
      const message = R.dom("textarea", { class: "bulk-invite-copy-text" });
      message.readOnly = true;
      message.rows = 4;
      message.value = row.queue.message_body;
      message.setAttribute("aria-label", T("Message text"));
      const status = element("p", "micro");
      status.setAttribute("role", "status");
      section.append(message, button("Copy message", async () => {
        if (!shareCurrent(row, owner)) return;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(message.value);
            status.textContent = T("interface.messages.message_copied");
            return;
          }
        } catch (_) { /* Manual selection also works on an insecure origin. */ }
        message.select();
        status.textContent = T("Copy the selected message.");
      }), status);
    }

    function renderReview(box, selection) {
      if (!review || !canSend() || !selection.length || busy) return;
      const owner = getActor();
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
        if (review === "copy") copyMessage(item, row, owner);
        else item.append(element("pre", "delivery-message", readyMessage(row)));
        window.RSVP_INVITATION_IMAGE.preview(item, queue.message_image, { R, T });
        if (review === "share") window.RSVP_DEVICE_DELIVERY.appendShare(item, {
          R, T, q: queue,
          canUse: () => shareCurrent(row, owner),
          authorize: async () => shareCurrent(row, owner) && await managementRpc("admin_authorize_device_send", { p_queue_id: queue.id }),
          recordHandoff: id => managementRpc("admin_record_share_handoff", {
            p_queue_id: queue.id, p_expected_revision: queue.revision, p_handoff_id: id,
          }),
          show,
        });
        section.append(item);
      }
      if (review === "ready") section.append(button("Mark ready", () => markReady(selection)));
      section.append(button("Close", () => { review = null; render(); }));
      box.append(section);
    }

    function inviteFilter(queue) {
      if (!queue) return "none";
      return queue.status === "sent" ? "sent" : "draft";
    }

    function filterFieldset(title, options, shown, attribute) {
      const fieldset = element("fieldset", "bulk-invite-filters");
      fieldset.append(R.dom("legend", {}, T(title)));
      for (const [key, label] of Object.entries(options)) {
        const filter = element("label", "bulk-invite-filter");
        const input = R.dom("input", { type: "checkbox", disabled: busy });
        input.setAttribute(attribute, key);
        input.checked = shown.has(key);
        input.addEventListener("change", () => {
          if (input.checked) shown.add(key);
          else shown.delete(key);
          review = null;
          render();
          host()?.querySelector("[" + attribute + '="' + key + '"]')?.focus({ preventScroll: true });
        });
        filter.append(input, document.createTextNode(T(label)));
        fieldset.append(filter);
      }
      return fieldset;
    }

    function render() {
      const box = host();
      if (!box) return;
      sync();
      box.hidden = !actor || !can("invites");
      box.replaceChildren();
      if (box.hidden) return;
      const all = rows();
      const eligible = row => (row.group !== "none" || !row.queue || row.queue.channel === "manual") &&
        !["sent", "failed"].includes(row.queue?.status);
      const visible = all.filter(row => shownServices.has(row.group) && shownInvites.has(inviteFilter(row.queue)));
      const visibleEligible = new Set(visible.filter(eligible).map(row => row.household.id));
      for (const id of selected) {
        if (!visibleEligible.has(id)) selected.delete(id);
      }
      const selection = visible.filter(row => selected.has(row.household.id));
      const sendSelection = !busy && canSend() && selection.length > 0 && selection.every(sendable);
      const readySelection = !busy && canSend() && canDraft() && selection.some(row => row.queue?.status === "draft")
        && selection.every(row => sendable(row) || (row.queue?.status === "draft" && readyMessage(row)));
      const shortcutItems = selection.map(row => ({ id: row.queue?.id, revision: row.queue?.revision }));
      const header = element("div", "bulk-invite-heading");
      const heading = R.dom("h2", { id: "bulkInvitesTitle" }, T("Manage Invites"));
      header.append(heading, button("Create all household templates", createDrafts, busy || !canDraft() || all.every(row => row.queue)));
      box.append(header);

      const filters = element("div", "bulk-invite-filter-bar");
      filters.append(
        filterFieldset("Shown Services", groups, shownServices, "data-bulk-filter"),
        filterFieldset("Shown Invites", inviteFilters, shownInvites, "data-bulk-status-filter"),
      );
      const actions = element("div", "bulk-invite-actions");
      const open = kind => { review = kind; render(); box.querySelector(".bulk-invite-review")?.scrollIntoView({ block: "nearest" }); };
      actions.append(
        button("Send via Apple Shortcuts", () => {
          if (shortcuts.preselectNew(shortcutItems)) openShortcuts();
        }, !sendSelection || !shortcuts.canPreselectNew(shortcutItems)),
        button("Apple Share", () => open("share"), !sendSelection || !window.isSecureContext || typeof navigator.share !== "function"),
        button("Copy & Paste", () => open("copy"), !sendSelection),
      );
      if (readySelection) actions.append(button("Review selected drafts", () => open("ready")));
      const count = element("span", "bulk-invite-count", T("{count} of 10 selected", { count: selected.size }));
      count.setAttribute("aria-live", "polite");
      actions.append(count);
      box.append(filters, actions);
      if (!getStore().settings?.is_published) box.append(element("p", "micro bulk-invite-hint", T("Publish the event to activate sending.")));
      else if (selection.length && !sendSelection && !readySelection)
        box.append(element("p", "micro bulk-invite-hint", T("Review incomplete drafts in Invites and mark them ready.")));
      if (notice) {
        const feedback = element("p", "micro bulk-invite-hint", notice);
        feedback.setAttribute("role", "status");
        box.append(feedback);
      }
      if (review === "ready" ? readySelection : sendSelection) renderReview(box, selection);

      const list = element("div", "bulk-invite-list");
      for (const [key, label] of Object.entries(groups)) {
        const records = visible.filter(row => row.group === key);
        if (!records.length) continue;
        const group = element("section", "bulk-invite-group");
        group.dataset.bulkGroup = key;
        const title = element("h3", "bulk-invite-group-title");
        title.append(document.createTextNode(T(label)), element("span", "muted", String(records.length)));
        group.append(title);
        for (const row of records) {
          const id = row.household.id;
          const line = element("label", "bulk-invite-row");
          const input = R.dom("input", { type: "checkbox", disabled: busy || !eligible(row) || (!selected.has(id) && selected.size >= limit) });
          input.dataset.bulkSelect = id;
          input.checked = selected.has(id);
          input.setAttribute("aria-label", T("Select invitation for {household}", { household: row.name }));
          input.addEventListener("change", () => {
            if (input.checked && selected.size < limit) selected.add(id);
            else selected.delete(id);
            review = null; render();
            box.querySelector('[data-bulk-select="' + CSS.escape(id) + '"]')?.focus({ preventScroll: true });
          });
          const recipient = row.queue?.recipient_snapshot?.contact_value || row.recipient;
          line.title = [row.name, row.group !== "none" ? recipient : null].filter(Boolean).join(" · ");
          line.append(element("strong", "bulk-invite-name", row.name),
            element("span", "bulk-invite-recipient muted", row.group !== "none" ? recipient || "–" : "–"),
            element("span", "bulk-invite-status", T(statuses[row.queue?.status] || "No Draft")),
            input);
          group.append(line);
        }
        list.append(group);
      }
      if (!list.childElementCount) list.append(element("p", "small muted", T("No matching households.")));
      box.append(list);
    }

    return { render, clear };
  }
  window.RSVP_ADMIN_BULK_INVITES = Object.freeze({ create });
})();
