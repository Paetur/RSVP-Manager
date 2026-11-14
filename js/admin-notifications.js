(function () {
  "use strict";
  let draft = null;
  function render(ctx) {
    const { R } = ctx,
      N = window.RSVP_NOTIFICATIONS;
    const T = (text) => window.RSVP_I18N.t(text);
    const host = R.byId("notificationSettingsHost");
    if (!host) return;
    host.replaceChildren();
    if (!ctx.can("settings")) return;
    const original = ctx.getStore().settings?.notification_preferences || null;
    const initial = {
      admin: {
        ...N.normalize(original?.admin),
        autoDismiss: original?.admin?.autoDismiss !== false,
        showTimestamp: original?.admin?.showTimestamp !== false,
      },
      guest: {
        ...N.normalize(original?.guest),
        autoDismiss: original?.guest?.autoDismiss === true,
        showTimestamp: original?.guest?.showTimestamp === true,
      },
    };
    const revision = JSON.stringify(original);
    if (!draft || draft.revision !== revision)
      draft = { revision, value: structuredClone(initial) };
    const working = draft.value;
    let busy = false;
    const form = R.dom("form", { class: "notification-settings" });
    form.dataset.formKey = "notification-preferences";
    const heading = R.dom("div", { class: "settings-card-heading" });
    heading.append(R.dom("h3", {}, T("Status messages")));
    host.append(heading);
    form.append(
      R.dom(
        "p",
        { class: "micro" },
        T(
          "Choose which temporary messages appear. Saved logs, form errors and confirmation lists are unchanged.",
        ),
      ),
    );
    const controls = [],
      cards = R.dom("div", { class: "notification-scopes" });
    const presets = [
      ["all", "All messages"],
      ["errors", "Errors only"],
      ["custom", "Custom"],
    ];
    for (const [scope, title] of [
      ["admin", "Admin"],
      ["guest", "Guest"],
    ]) {
      const box = R.dom("fieldset"),
        custom = R.dom("div", { class: "notification-types" });
      box.append(R.dom("legend", {}, T(title)));
      const options = R.dom("div", { class: "permission-presets" });
      for (const [key, label] of presets) {
        const item = R.dom("label", { class: "radio-pill" });
        const input = R.dom("input", {
          type: "radio",
          name: "notifications-" + scope,
          value: key,
        });
        input.checked = working[scope].preset === key;
        input.dataset.cleanOriginal = key;
        item.append(input, document.createTextNode(T(label)));
        options.append(item);
        controls.push(input);
        input.addEventListener("change", () => {
          working[scope].preset = key;
          update();
        });
      }
      for (const [key, label] of [
        ["info", "Information"],
        ["success", "Success"],
        ["warning", "Warnings"],
        ["error", "Errors"],
      ]) {
        const item = R.dom("label", { class: "checkbox-label" });
        const input = R.dom("input", { type: "checkbox", value: key });
        input.checked = working[scope].types.includes(key);
        input.dataset.cleanOriginal = String(
          initial[scope].types.includes(key),
        );
        item.append(input, document.createTextNode(T(label)));
        custom.append(item);
        controls.push(input);
        input.addEventListener("change", () => {
          working[scope].types = N.types.filter((type) =>
            Array.from(custom.querySelectorAll("input:checked")).some(
              (n) => n.value === type,
            ),
          );
          update();
        });
      }
      custom.dataset.scope = scope;
      box.append(options, custom);
      {
        const label = R.dom("label", { class: "checkbox-label" });
        const autoDismiss = R.dom("input", { type: "checkbox" });
        autoDismiss.checked = working[scope].autoDismiss;
        autoDismiss.dataset.cleanOriginal = String(initial[scope].autoDismiss);
        label.append(
          autoDismiss,
          document.createTextNode(T("Hide messages after 5 seconds")),
        );
        box.append(label);
        controls.push(autoDismiss);
        autoDismiss.addEventListener("change", () => {
          working[scope].autoDismiss = autoDismiss.checked;
          update();
        });
      }
      {
        const label = R.dom("label", { class: "checkbox-label" }),
          timestamp = R.dom("input", { type: "checkbox" });
        timestamp.checked = working[scope].showTimestamp;
        timestamp.dataset.cleanOriginal = String(initial[scope].showTimestamp);
        label.append(timestamp, document.createTextNode(T("Show timestamps")));
        box.append(label);
        controls.push(timestamp);
        timestamp.addEventListener("change", () => {
          working[scope].showTimestamp = timestamp.checked;
          update();
        });
      }
      cards.append(box);
    }
    const actions = R.dom("div", { class: "form-actions" });
    const save = R.dom("button", { type: "submit", class: "btn" }, T("Save"));
    const cancel = R.dom(
      "button",
      { type: "button", class: "btn secondary" },
      T("Cancel"),
    );
    const status = R.dom("p", { class: "micro" });
    status.setAttribute("role", "status");
    cancel.addEventListener("click", () => {
      if (busy) return;
      window.RSVP_LOCAL_EDITORS?.cancel(form);
      window.RSVP_I18N.markClean(form);
      draft = null;
      render(ctx);
    });
    actions.append(save, cancel);
    form.append(cards, actions, status);
    host.append(form);
    function dirty() {
      return JSON.stringify(working) !== JSON.stringify(initial);
    }
    function update() {
      if (busy) form.setAttribute("aria-busy", "true");
      else form.removeAttribute("aria-busy");
      if (!form.isConnected) return;
      const disabled = busy || !ctx.isEditing() || !ctx.can("settings", "edit");
      for (const control of [...controls, save, cancel])
        control.disabled = disabled;
      for (const custom of form.querySelectorAll(".notification-types"))
        custom.classList.toggle(
          "hidden",
          working[custom.dataset.scope].preset !== "custom",
        );
      save.disabled = disabled || !dirty();
      form.dataset.dirty = String(dirty());
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      busy = true;
      status.textContent = T("Saving…");
      update();
      try {
        const { error } = await R.adminRpc(
          "admin_save_notification_preferences",
          { p_preferences: structuredClone(working), p_expected: original },
        );
        if (error) throw error;
        window.RSVP_I18N.markClean(form);
        draft = null;
        window.RSVP_LOCAL_EDITORS?.saved(
          form,
          T("Status message preferences saved."),
        );
        await ctx.reload();
        // Inline acknowledgement remains visible even when the saved filter hides successes.
        const result = R.byId("notificationSettingsHost").querySelector(
          ".local-editor-feedback",
        );
        if (result) result.textContent = T("Status message preferences saved.");
      } catch (error) {
        status.textContent = R.safeError(error);
      } finally {
        busy = false;
        update();
      }
    });
    form.cleanSaveUpdate = update;
    update();
  }
  window.RSVP_ADMIN_NOTIFICATIONS = {
    render,
    hasUnsaved: () =>
      !!document.querySelector(
        '#notificationSettingsHost form[data-dirty="true"]',
      ),
  };
})();
