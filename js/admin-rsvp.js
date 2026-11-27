(function () {
  "use strict";

  function create({ R, T, getStore, can, ordered, disclosure, makeTable, adminTime, managementRpc, reload, show, iconAction, buildGuestEditor }) {
    const popupKey = "invites-rsvp-editor";
    const guestPopupKey = "invites-rsvp-guest-editor";
    const tr = (key, args) => T(`interface.messages.${key}`, args);
    const responseLabels = {
      attending: "attending",
      declined: "not_attending",
      pending: "pending",
    };
    const responseLabel = (value) => tr(responseLabels[value || "pending"]);
    const foodLabel = (value) => tr(value === true ? "food_interest_yes" : value === false ? "food_interest_no" : "food_interest_unanswered");
    const guestName = (g) => [g.first_name, g.last_name].filter(Boolean).join(" ");
    const guestEditLabel = (name) => tr("edit_guest") + name;
    const action = (label, primary = false, type = "button") =>
      R.dom("button", { type, class: primary ? "btn" : "btn secondary" }, label);

    function attendance(h, store) {
      const sessions = ordered(store.sessions, "name").filter(s => s.is_active && s.requires_rsvp);
      const defaults = new Map(store.defaults.filter(a => a.household_id === h.id).map(a => [a.session_id, a.is_invited]));
      const pairs = (items) => new Map(items.map(a => [a.guest_id + ":" + a.session_id, a]));
      const overrides = pairs(store.overrides);
      const responses = pairs(store.responses);
      const rows = [];
      for (const guest of store.guests.filter(g => g.household_id === h.id && !g.archived_at)) {
        for (const session of sessions) {
          const key = guest.id + ":" + session.id;
          if (!(overrides.get(key)?.is_invited ?? defaults.get(session.id))) continue;
          rows.push({ guest, session, status: responses.get(key)?.rsvp_status || null });
        }
      }
      return { rows, inherited: sessions.filter(s => defaults.get(s.id)) };
    }

    function attendanceTable(rows, cell) {
      const table = makeTable([tr("guest"), tr("session"), tr("current_response")],
        rows.map(item => [guestName(item.guest), item.session.name, cell(item)]));
      table.classList.add("rsvp-current-responses");
      return table;
    }

    function control(label, input, className = "rsvp-edit-field") {
      const wrap = R.dom("label", { class: className });
      wrap.append(R.dom("span", {}, label), input);
      return wrap;
    }

    function selectResponse(label, status) {
      const select = R.dom("select");
      select.setAttribute("aria-label", label);
      if (!status) select.append(R.dom("option", { value: "" }, responseLabel(null)));
      for (const value of ["attending", "declined"])
        select.append(R.dom("option", { value }, responseLabel(value)));
      select.value = status || "";
      return select;
    }

    function editableGuest(householdId, guestId) {
      if (!can("invites", "edit") || !can("households", "edit")) return;
      const store = getStore();
      if (!store.households.some(h => h.id === householdId && !h.archived_at)) return;
      return store.guests.find(g => g.id === guestId && g.household_id === householdId && !g.archived_at);
    }

    function openGuest(householdId, guestId, trigger, onSave) {
      const popups = window.RSVP_POPUPS;
      const guest = editableGuest(householdId, guestId);
      if (!guest || !trigger.isConnected || !popups.get(popupKey)?.open || popups.get(guestPopupKey)) return;
      const dialog = popups.create(guestPopupKey, { class: "rsvp-guest-dialog" }, trigger);
      dialog.dataset.householdId = householdId;
      dialog.dataset.guestId = guestId;
      const heading = R.dom("h2", { id: guestPopupKey + "-heading" }, guestEditLabel(guestName(guest)));
      dialog.setAttribute("aria-labelledby", heading.id);
      const form = buildGuestEditor(guest, { close: () => { if (dialog.open) dialog.close(); }, onSave });
      dialog.addEventListener("close", () => window.RSVP_I18N.markClean(form));
      dialog.append(heading, form);
      R.byId("adminApp").append(dialog);
      dialog.openInline();
      form.querySelector("input")?.focus({ preventScroll: true });
    }

    function editForm(h, model, locked, foodEditable, canAddGuests, hasFoodClaims) {
      const group = R.dom("div", { class: "rsvp-dialog-fields" });
      const fields = [];
      if (model.rows.length) {
        const answers = R.dom("div", { class: "rsvp-edit-attendance" });
        answers.classList.toggle("rsvp-edit-with-guest-actions", canAddGuests);
        const headings = R.dom("div", { class: "rsvp-edit-response rsvp-edit-response-heading" });
        headings.setAttribute("aria-hidden", "true");
        for (const key of ["guest", "session", "current_response"]) headings.append(R.dom("span", {}, tr(key)));
        answers.append(headings);
        for (const { guest, session, status } of model.rows) {
          const name = guestName(guest);
          const select = selectResponse(name + " · " + session.name, status);
          const row = R.dom("div", { class: "rsvp-edit-response" });
          const guestLabel = R.dom("span", { class: "rsvp-response-guest" }, name);
          row.append(guestLabel, R.dom("span", { class: "rsvp-response-session" }, session.name), select);
          let edit;
          if (canAddGuests) {
            edit = iconAction("edit", guestEditLabel(name), () => openGuest(h.id, guest.id, edit, saved => {
              const updated = guestName(saved);
              for (const field of fields) {
                if (field.guestId === guest.id) field.rename(updated);
              }
            }), false, "household-rsvp-guest-edit");
            edit.setAttribute("aria-haspopup", "dialog");
            row.append(edit);
          }
          answers.append(row);
          fields.push({ guestId: guest.id, sessionId: session.id, status, select, rename(updated) {
            guestLabel.textContent = updated;
            select.setAttribute("aria-label", updated + " · " + session.name);
            if (edit) {
              edit.title = guestEditLabel(updated);
              edit.setAttribute("aria-label", edit.title);
            }
          } });
        }
        group.append(answers);
      }
      const previousFood = h.food_interest ?? null;
      let food;
      if (foodEditable) {
        food = R.dom("select");
        if (previousFood === null) food.append(R.dom("option", { value: "" }, foodLabel(null)));
        food.append(R.dom("option", { value: "true" }, foodLabel(true)));
        food.append(R.dom("option", { value: "false", disabled: hasFoodClaims }, foodLabel(false)));
        food.value = previousFood === null ? "" : String(previousFood);
        group.append(control(tr("food_interest_reporting"), food));
        if (hasFoodClaims) group.append(R.dom("p", { class: "micro rsvp-form-hint" }, T("food.messages.remove_commitments_before_no")));
      }

      const guests = new Map();
      if (canAddGuests) {
        const guestHost = R.dom("div", { class: "rsvp-new-guests" });
        const add = action(tr("add_guest"));
        add.addEventListener("click", () => {
          const id = R.randomId();
          const draft = R.dom("fieldset", { class: "rsvp-new-guest" });
          const first = R.dom("input", { type: "text" });
          const last = R.dom("input", { type: "text" });
          const child = R.dom("input", { type: "checkbox" });
          const remove = action(tr("rsvp_remove_guest_draft"));
          first.required = true;
          first.maxLength = last.maxLength = 120;
          draft.append(R.dom("legend", {}, tr("add_guest")), control(tr("first_name"), first),
            control(tr("last_name"), last), control(tr("child_guest"), child, "rsvp-edit-checkbox"));
          const answers = model.inherited.map(session => {
            const select = selectResponse(session.name, null);
            select.required = locked;
            draft.append(control(session.name, select));
            return { session, select };
          });
          draft.append(remove);
          guests.set(id, { first, last, child, answers });
          guestHost.append(draft);
          remove.addEventListener("click", () => {
            guests.delete(id);
            draft.remove();
            group.dispatchEvent(new Event("change", { bubbles: true }));
            add.focus({ preventScroll: true });
          });
          group.dispatchEvent(new Event("change", { bubbles: true }));
          first.focus();
        });
        group.append(guestHost, add);
      }

      function collect() {
        const responses = [];
        const lines = [];
        const changes = {};
        for (const { guestId, sessionId, status, select } of fields) {
          if (!select.value || select.value === status) continue;
          responses.push({ guest_id: guestId, session_id: sessionId, status: select.value, expected_status: status });
          lines.push(select.getAttribute("aria-label") + " · " + responseLabel(select.value));
        }
        if (food?.value && food.value !== String(previousFood)) {
          const interest = food.value === "true";
          changes.food = { interest, expected_interest: previousFood };
          lines.push(tr("food_interest_reporting") + " · " + foodLabel(interest));
        }
        if (guests.size) {
          changes.guests = [];
          for (const [id, { first, last, child, answers }] of guests) {
            const guest = { id, first_name: first.value.trim(), last_name: last.value.trim(), is_child: child.checked };
            changes.guests.push(guest);
            lines.push(tr("rsvp_guest_added_for_review", { name: guestName(guest) }));
            for (const { session, select } of answers) {
              if (!select.value) continue;
              responses.push({ guest_id: id, session_id: session.id, status: select.value, expected_status: null });
              lines.push(guestName(guest) + " · " + session.name + " · " + responseLabel(select.value));
            }
          }
        }
        if (responses.length) changes.responses = responses;
        return { changes, lines };
      }
      return {
        group,
        dirty: () => collect().lines.length > 0,
        review() {
          for (const { first, answers } of guests.values()) {
            if (!first.value.trim()) {
              first.focus();
              throw Error(tr("first_name_is_required"));
            }
            const pending = answers.find(({ select }) => select.required && !select.value);
            if (pending) {
              pending.select.focus();
              throw Error(tr("rsvp_guest_pending"));
            }
          }
          const { changes, lines } = collect();
          return {
            lines,
            help: tr("rsvp_edit_confirm") + " " + tr(locked ? "rsvp_edit_state_locked" : "rsvp_edit_state_open"),
            args: {
              p_expected_state: h.rsvp_state,
              p_expected_submission_id: h.latest_rsvp_submission_id ?? null,
              p_changes: changes,
            },
          };
        },
      };
    }

    function lateForm(h, zone) {
      const group = R.dom("div", { class: "rsvp-dialog-fields" });
      const until = R.dom("input", { type: "datetime-local" });
      const initial = R.zonedInput(h.late_submission_until, zone);
      until.value = initial;
      group.append(control(tr("allow_responses_until") + zone + ")", until));
      return {
        group,
        dirty: () => !!until.value && until.value !== initial,
        review() {
          const value = R.zonedInstant(until.value, zone);
          if (!value || Date.parse(value) <= Date.now()) {
            until.focus();
            throw Error(T("Choose a valid future expiry"));
          }
          return { help: tr("rsvp_late_confirm", { time: adminTime(value) }), args: { p_until: value } };
        },
      };
    }

    function open(h, trigger, { title, rpc, noteArg = "p_note", editor, permissions = [] }) {
      if (!can("invites", "edit") || !trigger.isConnected || window.RSVP_POPUPS.get(popupKey)) return;
      const dialog = window.RSVP_POPUPS.create(popupKey, { class: "rsvp-admin-dialog" }, trigger);
      dialog.dataset.householdId = h.id;
      dialog.rsvpPermissions = ["invites", ...permissions];
      const heading = R.dom("h2", { id: popupKey + "-heading" }, title + " · " + R.householdName(h));
      heading.tabIndex = -1;
      dialog.setAttribute("aria-labelledby", heading.id);
      const form = R.dom("form", { class: "rsvp-dialog-form" });
      form.noValidate = true;
      const confirmation = R.dom("section", { class: "rsvp-confirmation" });
      const help = R.dom("p", { class: "small" });
      const differences = R.dom("ul", { class: "rsvp-review-list" });
      const toggleNote = R.dom("input", { type: "checkbox" });
      const note = R.dom("textarea");
      note.maxLength = 2000;
      note.rows = 2;
      const noteControl = control(tr("admin_note"), note);
      noteControl.hidden = true;
      toggleNote.addEventListener("change", () => {
        noteControl.hidden = !toggleNote.checked;
        if (toggleNote.checked) note.focus();
      });
      confirmation.append(help, differences, control(tr("rsvp_add_note"), toggleNote, "rsvp-edit-checkbox"), noteControl);
      const status = R.dom("p", { class: "rsvp-dialog-feedback small" });
      status.setAttribute("role", "status");
      const footer = R.dom("div", { class: "form-actions rsvp-dialog-actions" });
      const review = action(tr("rsvp_review_changes"), true, "submit");
      const confirm = action(tr("inline_confirm_eebdd"), true, "submit");
      const back = action(tr("back"));
      const cancel = action(tr("cancel"));
      footer.append(review, confirm, back, cancel);
      dialog.classList.add("rsvp-dialog-with-fields");
      form.append(editor.group);
      form.append(confirmation, status, footer);
      dialog.append(heading, form);
      let pending = null;
      let saving = false;
      function update() {
        editor.group.hidden = Boolean(pending);
        confirmation.hidden = confirm.hidden = !pending;
        review.hidden = Boolean(pending);
        back.hidden = !pending;
        cancel.hidden = Boolean(pending);
        review.disabled = saving || !editor.dirty();
        confirm.disabled = back.disabled = cancel.disabled = saving;
        toggleNote.disabled = note.disabled = saving;
        form.dataset.dirty = String(editor.dirty() || (toggleNote.checked && !!note.value.trim()));
      }
      function renderReview() {
        help.textContent = pending?.help || "";
        differences.hidden = !pending?.lines?.length;
        differences.replaceChildren(...(pending?.lines || []).map(line => R.dom("li", {}, line)));
        update();
      }
      for (const event of ["input", "change"]) form.addEventListener(event, update);
      back.addEventListener("click", () => {
        pending = null;
        status.textContent = "";
        update();
        review.focus();
      });
      cancel.addEventListener("click", async () => {
        if (form.dataset.dirty === "true" && !await window.RSVP_INLINE.confirm(T("Discard unsaved changes?"), {
          action: "Discard changes", trigger: cancel, host: dialog,
        })) return;
        dialog.close();
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (saving) return;
        status.textContent = "";
        if (!pending) {
          if (review.disabled) return;
          try {
            pending = editor.review();
            renderReview();
            back.focus();
          } catch (error) { status.textContent = T(R.safeError(error)); }
          return;
        }
        // Keyboard submission on a note field should never confirm a review.
        if (event.submitter !== confirm) return;
        saving = true;
        update();
        form.setAttribute("aria-busy", "true");
        try {
          const savedNote = toggleNote.checked ? note.value.trim() || null : null;
          await managementRpc(rpc, {
            p_household_id: h.id,
            ...pending.args,
            [noteArg]: savedNote,
          });
        } catch (error) {
          status.textContent = T(R.safeError(error));
          saving = false;
          form.removeAttribute("aria-busy");
          update();
          return;
        }
        const refreshed = await reload();
        if (dialog.open) dialog.close();
        if (refreshed) show(tr("changes_saved"), "success");
      });
      dialog.addEventListener("close", () => {
        if (trigger.isConnected) return;
        const section = R.byId("invite-rsvp-" + h.id);
        const replacement = Array.from(section?.querySelectorAll("button[data-rsvp-action]:enabled") || []);
        const focusTarget = replacement.find(button => button.dataset.rsvpAction === trigger.dataset.rsvpAction) ||
          replacement[0] || section?.querySelector("summary");
        focusTarget?.focus({ preventScroll: true });
      });
      R.byId("adminApp").append(dialog);
      renderReview();
      dialog.openInline();
      heading.focus({ preventScroll: true });
    }

    function reconcile() {
      const popups = window.RSVP_POPUPS;
      const dialog = popups.get(popupKey);
      if (!dialog) return;
      const store = getStore();
      const close = dialog.rsvpPermissions.some(section => !can(section, "edit")) ||
        !store.households.some(h => h.id === dialog.dataset.householdId && !h.archived_at);
      const guestDialog = popups.get(guestPopupKey);
      if (guestDialog && (close || !editableGuest(guestDialog.dataset.householdId, guestDialog.dataset.guestId))) guestDialog.close();
      if (close) dialog.close();
    }

    function section(h) {
      const store = getStore();
      const model = attendance(h, store);
      const zone = store.settings?.timezone || "Atlantic/Faroe";
      const submitted = Boolean(h.latest_rsvp_submission_id);
      const locked = submitted || h.rsvp_state === "locked";
      const canEdit = !h.archived_at && can("invites", "edit");
      const foodVisible = store.settings?.food_enabled && can("food");
      const foodEditable = foodVisible && submitted && can("food", "edit");
      const canAddGuests = can("households", "edit");
      const box = disclosure(tr("rsvp_management"), "invite-rsvp-panel");
      const body = R.dom("div", { class: "invite-rsvp-body" });
      const tools = R.dom("div", { class: "invite-rsvp-actions" });
      function tool(key, label, config) {
        const button = action(label);
        button.dataset.rsvpAction = key;
        button.setAttribute("aria-haspopup", "dialog");
        button.addEventListener("click", () => open(h, button, config()));
        tools.append(button);
        return button;
      }
      if (canEdit) {
        if (model.rows.length || foodEditable || canAddGuests) {
          tool("edit", tr("rsvp_edit"), () => ({
            title: tr("rsvp_edit"), rpc: "admin_edit_household_rsvp",
            editor: editForm(h, model, locked, foodEditable, canAddGuests, store.claims.some(c => c.household_id === h.id)),
            permissions: [...(foodEditable ? ["food"] : []), ...(canAddGuests ? ["households"] : [])],
          }));
        }
        if (!locked) {
          tool("late", tr("allow_a_late_response"), () => ({
            title: tr("allow_a_late_response"), rpc: "admin_authorize_late_rsvp", noteArg: "p_reason", editor: lateForm(h, zone),
          }));
        }
        if (tools.childElementCount) body.append(tools);
      }
      if (model.rows.length) body.append(attendanceTable(model.rows, ({ status }) => responseLabel(status)));
      else body.append(R.dom("p", { class: "micro" }, tr("no_active_rsvp_sessions_are_assigned_to_this_household")));

      if (foodVisible) {
        const food = R.dom("p", { class: "small invite-rsvp-food" });
        food.append(R.dom("strong", {}, tr("food_interest_reporting")), " · ", foodLabel(h.food_interest ?? null));
        body.append(food);
      }
      const latest = store.submissions.find(x => x.id === h.latest_rsvp_submission_id);
      if (latest?.comment) {
        const comment = R.dom("div", { class: "rsvp-comment-preview admin-rsvp-comment" });
        comment.append(R.dom("strong", {}, T("Comment")), R.dom("p", {}, latest.comment));
        body.append(comment);
      }
      const meta = R.dom("div", { class: "invite-rsvp-metadata" });
      if (h.rsvp_submitted_at) meta.append(R.dom("span", {}, tr("last_submission_time", { time: adminTime(h.rsvp_submitted_at) }).replace(/^\s*·\s*/, "")));
      const deadline = store.settings?.rsvp_deadline;
      const late = locked ? null : h.late_submission_until;
      if (deadline || late)
        meta.append(R.dom("span", {}, tr("event_deadline_deadline_late_response_permission_late_zone", {
          deadline: adminTime(deadline), late: adminTime(late), zone,
        })));
      if (meta.childElementCount) body.append(meta);
      box.append(body);
      return box;
    }

    return { section, reconcile };
  }

  window.RSVP_ADMIN_RSVP = { create };
})();
