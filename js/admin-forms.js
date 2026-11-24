// Shared form behavior. Draft snapshots live on controls; feedback/open-editor
// state belongs to this controller instance and survives its data reloads.
(function () {
  "use strict";
  function create({
    R,
    T,
    isEditing,
    iconAction,
    getActiveTab,
    rememberDisclosure,
    reload,
    show,
  }) {
    const $ = R.byId;
    const formMessages = new Map(),
      recordEditors = new Set();
    function formFeedback(form, state = "", detail = "") {
      const key = form.dataset.formKey || form.id;
      if (key) formMessages.set(key, { state, detail });
      const label =
        state === "saving"
          ? T("interface.messages.saving_progress")
          : state === "saved"
            ? T("interface.messages.saved_status")
            : state === "error"
              ? T("interface.messages.error_status")
              : "";
      const feedbackHost = form.saveActions || form;
      let status = feedbackHost.querySelector(".form-feedback");
      if (!status) {
        status = R.dom("p", {
          class: "form-feedback micro span-2",
          role: "status",
          "aria-live": "polite",
        });
        (
          form.saveActions ||
          form.querySelector(".form-actions") ||
          form
        ).append(status);
      }
      status.dataset.state = state;
      status.classList.toggle("hidden", !state);
      status.textContent = label + (detail ? " · " + detail : "");
    }
    function restoreDraft(form) {
      if (form.getAttribute("aria-busy") === "true") return;
      for (const control of form.querySelectorAll("input,textarea,select")) {
        if (control.dataset.cleanOriginal === undefined) continue;
        if (["checkbox", "radio"].includes(control.type))
          control.checked = control.dataset.cleanOriginal === "true";
        else control.value = control.dataset.cleanOriginal;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
      window.RSVP_I18N.markClean(form);
      formFeedback(form);
      form.cleanSaveUpdate?.();
      closeReading(form);
    }
    function formActions(form, save, cancel) {
      const row =
        save.closest(
          ".form-actions,.guest-edit-actions,.food-edit-buttons,.other-edit-actions",
        ) || R.dom("div", { class: "form-actions span-2" });
      row.classList.add("form-actions");
      if (!row.parentElement) form.append(row);
      const old = save.parentElement;
      row.append(save, cancel);
      if (old && old !== row && old !== form && !old.childElementCount)
        old.remove();
      return row;
    }
    function footerAction(form, button, text = T("interface.messages.delete")) {
      if (!button) return;
      const actions =
        form.saveActions ||
        form.querySelector(
          ".form-actions,.guest-edit-actions,.other-edit-actions",
        );
      let lifecycle = actions.querySelector(".editor-lifecycle-actions");
      if (!lifecycle) {
        lifecycle = R.dom("span", {
          class: "editor-lifecycle-actions edit-only",
        });
        actions.append(lifecycle);
      }
      button.className =
        "btn secondary edit-only" +
        (button.classList.contains("danger") ? " danger" : "");
      button.textContent = text;
      lifecycle.append(button);
    }
    function cleanSave(form, reset = true) {
      const controls = () =>
        Array.from(form.querySelectorAll("input,textarea,select")).filter(
          (control) => !["button", "submit", "search"].includes(control.type),
        );
      const value = (control) =>
        ["checkbox", "radio"].includes(control.type)
          ? String(control.checked)
          : control.value;
      if (reset || !form.cleanSaveUpdate) {
        for (const control of controls())
          control.dataset.cleanOriginal = value(control);
      }
      const update = () => {
        const actions = form.saveActions || form;
        const save = actions.querySelector('button[type="submit"]');
        if (save)
          save.disabled =
            form.dataset.restoreOnly === "true" ||
            !isEditing() ||
            form.getAttribute("aria-busy") === "true" ||
            (form.dataset.initialDraft !== "true" &&
              !controls().some(
                (control) => value(control) !== control.dataset.cleanOriginal,
              ));
        for (const cancel of actions.querySelectorAll("[data-discard]"))
          cancel.disabled = form.getAttribute("aria-busy") === "true";
      };
      if (!form.cleanSaveUpdate) {
        const changed = () => {
          if (form.getAttribute("aria-busy") !== "true") formFeedback(form);
          form.cleanSaveUpdate();
        };
        form.addEventListener("input", changed);
        form.addEventListener("change", changed);
      }
      form.cleanSaveUpdate = update;
      const message = formMessages.get(form.dataset.formKey || form.id);
      if (message) formFeedback(form, message.state, message.detail);
      update();
    }
    function readingView(form, key, onEdit) {
      for (const old of form.parentElement.querySelectorAll(
        "[data-reading-for],[data-record-pencil]",
      ))
        if (old.dataset.readingFor === key || old.dataset.recordPencil === key)
          old.remove();
      const view = R.dom("div", { class: "form-reading" }),
        list = R.dom("dl", { class: "record-read-grid" });
      view.dataset.readingFor = key;
      if (form.renderReadSummary) form.renderReadSummary(view);
      else {
        for (const control of form.querySelectorAll("input,textarea,select")) {
          if (control.type === "hidden") continue;
          const label = control.closest("label");
          const text =
            control.getAttribute("aria-label") ||
            Array.from(label?.childNodes || [])
              .filter(
                (n) =>
                  n.nodeType === Node.TEXT_NODE ||
                  (n.nodeType === Node.ELEMENT_NODE && n.tagName === "SPAN"),
              )
              .map((n) => n.textContent)
              .join(" ")
              .trim();
          const value =
            control.type === "checkbox"
              ? T(control.checked ? "Enabled" : "Disabled")
              : control.tagName === "SELECT"
                ? control.selectedOptions[0]?.textContent
                : window.RSVP_ADMIN_PREFERENCES.formatPicker(control) ?? control.value;
          if (text && value) {
            list.append(R.dom("dt", {}, text), R.dom("dd", {}, value));
          }
        }
        view.append(list);
      }
      form.before(view);
      form.classList.add("reading-editor");
      form.dataset.recordEditor = key;
      const settingsCard = ["event-settings", "language-preferences"].includes(
        key,
      )
        ? form.closest("[data-settings-card]")
        : null;
      const open = () => {
        settingsCard?.classList.add("settings-card-editing");
        recordEditors.add(key);
        form.classList.add("record-open");
        view.classList.add("editing-open");
        const parent = form.closest("details");
        if (parent) parent.open = true;
        form.querySelector("input,select,textarea")?.focus();
        onEdit?.();
      };
      const button = iconAction(
        "edit",
        T("interface.messages.edit") +
          " · " +
          (settingsCard?.querySelector(
            ".settings-card-heading h2,.settings-card-heading h3",
          )?.textContent ||
            form.querySelector("input")?.value ||
            T("Settings")),
        open,
        false,
        "edit-only",
      );
      button.dataset.recordPencil = key;
      const parent = form.closest("details");
      const host =
        settingsCard?.querySelector(":scope>.settings-card-heading") ||
        parent?.querySelector(":scope>summary .session-order-actions");
      if (host) {
        host.append(button);
        if (settingsCard) button.classList.add("settings-card-pencil");
      } else {
        button.classList.add("record-pencil");
        form.before(button);
      }
      settingsCard?.classList.toggle(
        "settings-card-editing",
        recordEditors.has(key),
      );
      form.classList.toggle("record-open", recordEditors.has(key));
      view.classList.toggle("editing-open", recordEditors.has(key));
      if (isEditing() && recordEditors.has(key) && parent) parent.open = true;
      const cancel = form.querySelector("[data-discard]");
      cancel?.addEventListener("click", () => {
        recordEditors.delete(key);
        settingsCard?.classList.remove("settings-card-editing");
        form.classList.remove("record-open");
        view.classList.remove("editing-open");
        button.focus();
      });
    }

    function closeReading(form) {
      const key = form?.dataset.recordEditor;
      if (!key) return;
      recordEditors.delete(key);
      form
        .closest("[data-settings-card]")
        ?.classList.remove("settings-card-editing");
      form.classList.remove("record-open");
      for (const view of form.parentElement.querySelectorAll(
        "[data-reading-for]",
      ))
        if (view.dataset.readingFor === key)
          view.classList.remove("editing-open");
    }
    function managementForm() {
      return R.dom("form", { class: "form-grid management-form edit-only" });
    }
    function field(
      form,
      label,
      value,
      options = null,
      type = "text",
      required = false,
      max = 2000,
    ) {
      const wrap = R.dom("label");
      wrap.append(R.dom("span", {}, label));
      const input = R.dom(
        options ? "select" : type === "textarea" ? "textarea" : "input",
        options || type === "textarea" ? {} : { type },
      );
      if (options)
        for (const [v, t] of options)
          input.append(R.dom("option", { value: v }, t));
      if (type === "checkbox") input.checked = !!value;
      else input.value = value ?? "";
      input.setAttribute("aria-label", label);
      input.required = required;
      if (!options) input.maxLength = max;
      if (type === "checkbox") {
        wrap.classList.add("checkbox-label");
        wrap.prepend(input);
      } else wrap.append(input);
      window.RSVP_ADMIN_PREFERENCES.refreshDatePicker(input);
      form.append(wrap);
      return input;
    }
    function saveForm(form, label, save) {
      const button = R.dom("button", { class: "btn", type: "submit" }, label),
        cancel =
          Array.from(form.querySelectorAll("button[type=button]")).find(
            (button) => button.textContent === T("Cancel"),
          ) ||
          R.dom(
            "button",
            { class: "btn secondary", type: "button" },
            T("Cancel"),
          );
      cancel.dataset.discard = "true";
      cancel.addEventListener("click", () => restoreDraft(form));
      form.saveActions = formActions(form, button, cancel);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isEditing() || button.disabled) return;
        button.disabled = true;
        form.setAttribute("aria-busy", "true");
        formFeedback(form, "saving");
        try {
          if ((await save()) === false) {
            formFeedback(form);
            return;
          }
          formFeedback(form, "saved");
          if (form.dataset.recordEditor)
            recordEditors.delete(form.dataset.recordEditor);
          window.RSVP_LOCAL_EDITORS?.saved(form);
          form.dispatchEvent(new Event("rsvp:form-saved", { bubbles: true }));
          const editor = form.closest(".household-inline-editor");
          const keepPosition =
            form.id &&
            form.dataset.formKey?.startsWith("household:") &&
            editor?.open &&
            getActiveTab() === "households" &&
            button.isConnected;
          const offset = keepPosition ? button.getBoundingClientRect().top : 0;
          if (keepPosition) {
            rememberDisclosure(editor.dataset.householdDetailKey, editor.open);
            for (
              let details = editor.parentElement.closest(
                "details[data-tree-key]",
              );
              details;
              details = details.parentElement.closest("details[data-tree-key]")
            ) {
              rememberDisclosure(details.dataset.treeKey, details.open);
            }
          }
          if (await reload()) {
            show(T("interface.messages.changes_saved"), "success");
            if (keepPosition && getActiveTab() === "households") {
              const refreshedForm = $(form.id);
              const current = refreshedForm?.saveActions?.querySelector(
                'button[type="submit"]',
              );
              // The saved form is clean, so Save is disabled. Keep keyboard
              // focus on its enabled Cancel control while retaining Save's position.
              const focusTarget = refreshedForm?.saveActions?.querySelector(
                "button[data-discard]:not(:disabled)",
              );
              const pencil = refreshedForm?.parentElement.querySelector(
                "[data-record-pencil]",
              );
              if (
                pencil?.getClientRects().length &&
                !refreshedForm.classList.contains("record-open")
              )
                pencil.focus({ preventScroll: true });
              if (
                current?.getClientRects().length &&
                focusTarget?.getClientRects().length
              ) {
                focusTarget.focus({ preventScroll: true });
                window.scrollBy({
                  top: current.getBoundingClientRect().top - offset,
                  behavior: "instant",
                });
              }
            }
          }
        } catch (error) {
          formFeedback(form, "error", R.safeError(error));
          show(R.safeError(error), "error");
        } finally {
          form.removeAttribute("aria-busy");
          form.cleanSaveUpdate?.();
        }
      });
      cleanSave(form);
      return form;
    }

    return {
      formFeedback,
      restoreDraft,
      formActions,
      footerAction,
      cleanSave,
      readingView,
      closeReading,
      managementForm,
      field,
      saveForm,
    };
  }
  window.RSVP_ADMIN_FORMS = { create };
})();
