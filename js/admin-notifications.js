(function () {
  "use strict";
  let generation = 0;
  function render(ctx, preserveDraft = false) {
    const { R } = ctx,
      N = window.RSVP_NOTIFICATIONS;
    const T = (text) => window.RSVP_I18N.t(text);
    const { host, mode } = ctx;
    const previous = host.notificationController;
    if (ctx.can("settings", "edit") && preserveDraft && previous?.preserve()) {
      Object.assign(previous.context, ctx); previous.update(); return;
    }
    host.replaceChildren();
    delete host.notificationController;
    if (!ctx.can("settings")) return;
    let original = ctx.getStore().settings?.notification_preferences || null;
    let initial = {
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
    const working = structuredClone(initial);
    const ticket = generation;
    let busy = false, committed = false;
    const form = R.dom("form", { class: "notification-settings" });
    form.dataset.formKey = "notification-preferences:" + mode;
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
          name: "notifications-" + mode + "-" + scope,
          value: key,
        });
        input.checked = working[scope].preset === key;
        input.dataset.cleanOriginal = key;
        item.append(input, document.createTextNode(T(label)));
        options.append(item);
        controls.push(input);
        input.addEventListener("change", () => {
          working[scope].preset = key;
          changed();
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
          changed();
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
          changed();
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
          changed();
        });
      }
      cards.append(box);
    }
    const actions = R.dom("div", { class: "form-actions interface-preference-actions" });
    const save = R.dom("button", { type: "submit", class: "btn" }, T("Save"));
    const cancel = R.dom(
      "button",
      { type: "button", class: "btn secondary" },
      T("Cancel"),
    );
    const status = R.dom("p", { class: "form-feedback micro" });
    status.setAttribute("role", "status");
    cancel.addEventListener("click", () => {
      if (cancel.disabled) return;
      window.RSVP_I18N.markClean(form);
      render(ctx);
      host.querySelector("button[type=button]")?.focus({ preventScroll: true });
    });
    actions.append(cancel, save, status);
    form.append(cards, actions);
    host.append(form);
    function dirty() {
      return JSON.stringify(working) !== JSON.stringify(initial);
    }
    function showStatus(message = "", state = "") {
      status.textContent = message;
      status.dataset.state = state;
      status.hidden = !message;
    }
    function changed() {
      showStatus();
      if (!dirty()) window.RSVP_I18N.markClean(form);
      update();
    }
    function update() {
      if (busy) form.setAttribute("aria-busy", "true");
      else form.removeAttribute("aria-busy");
      if (!form.isConnected) return;
      const editable = ctx.can("settings", "edit"), disabled = busy || !editable;
      for (const control of [...controls, save, cancel])
        control.disabled = disabled;
      actions.classList.toggle("hidden", !editable);
      for (const custom of form.querySelectorAll(".notification-types"))
        custom.classList.toggle(
          "hidden",
          working[custom.dataset.scope].preset !== "custom",
        );
      save.disabled = disabled || !dirty();
      form.dataset.dirty = String(dirty());
      ctx.onUpdate?.();
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (save.disabled || ticket !== generation || !ctx.can("settings", "edit")) return;
      const restoreFocus = form.contains(document.activeElement);
      busy = true;
      showStatus(T("Saving…"), "saving");
      update();
      try {
        const saved = structuredClone(working);
        const { error } = await R.adminRpc(
          "admin_save_guest_interface",
          { p_mode: mode, p_values: { notification_preferences: saved }, p_expected: { notification_preferences: original } },
        );
        if (error) throw error;
        if (ticket !== generation || host.notificationController !== controller) return;
        committed = true;
        original = saved;
        initial = saved;
        window.RSVP_I18N.markClean(form);
        await ctx.reload();
        if (ticket === generation && ctx.can("settings", "edit"))
          host.notificationController?.showStatus(T("Status message preferences saved."), "saved");
      } catch (error) {
        if (ticket === generation && host.notificationController === controller)
          showStatus(R.safeError(error), "error");
      } finally {
        busy = false;
        update();
        if (ticket === generation && restoreFocus && document.activeElement === document.body) {
          const target = host.querySelector(committed ? "button[type=button]" : "button[type=submit]");
          if (target && !target.disabled && target.getClientRects().length)
            target.focus({ preventScroll: true });
        }
      }
    });
    form.cleanSaveUpdate = update;
    const controller = {
      context: ctx, update, showStatus,
      preserve: () => ticket === generation && !committed && (busy || dirty()),
    };
    host.notificationController = controller;
    showStatus();
    update();
  }
  window.RSVP_ADMIN_NOTIFICATIONS = {
    render,
    clear() { generation++; },
    hasUnsaved: () =>
      !!document.querySelector(
        '#notificationSettingsHost form[data-dirty="true"]',
      ),
  };
})();
