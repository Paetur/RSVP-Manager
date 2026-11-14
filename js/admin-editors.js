(function () {
  "use strict";
  function create({ R, T, can, iconAction, closeRecord }) {
    const opened = new Set();
    const messages = new Map();
    let pendingFocus = null,
      pendingRecordFocus = null;
    const policies = [
      [
        "#personalPreferencesForm",
        "personal-preferences",
        "Interface",
        "personal",
      ],
      ["#eventFeaturesHost form", "event-features", "Features", "settings"],
      [
        "#planningConfigHost form",
        "event-planning",
        "Event planning",
        "settings",
      ],
      [
        "#guestAppearanceHost form",
        "guest-customization",
        "Guest invitation",
        "settings",
      ],
      [
        "#notificationSettingsHost form",
        "notification-preferences",
        "Status messages",
        "settings",
      ],
      [
        "#invitationTemplatesList form",
        null,
        "Invitation templates",
        "settings",
      ],
      [
        "#foodTranslationGrid form.food-translation-grid",
        null,
        "Translations",
        "languages",
      ],
      ["#languageRows form", null, "Languages", "languages"],
    ];
    const editable = (policy) =>
      policy[3] === "personal" || can(policy[3], "edit");
    function readSummary(form, summary) {
      summary.replaceChildren();
      if (form.localReadSource) {
        summary.append(form.localReadSource.cloneNode(true));
        return;
      }
      const heading = form.querySelector(":scope > h3");
      if (heading) summary.append(heading.cloneNode(true));
      const photo = form.querySelector(".customization-photo-meta");
      if (photo) summary.append(photo.cloneNode(true));
      const list = R.dom("dl", { class: "record-read-grid" });
      for (const input of form.querySelectorAll("input,select,textarea")) {
        if (
          ["hidden", "file", "color", "range", "password"].includes(
            input.type,
          ) ||
          (input.type === "radio" && !input.checked) ||
          input.closest(".notification-types.hidden,.customization-crop")
        )
          continue;
        const labelNode = input.closest("label"),
          copy = labelNode?.cloneNode(true);
        copy
          ?.querySelectorAll("input,select,textarea,.translation-reading")
          .forEach((node) => node.remove());
        const caption =
          input.getAttribute("aria-label") ||
          labelNode?.querySelector("strong")?.textContent ||
          copy?.textContent.trim();
        if (!caption) continue;
        const scope = input
          .closest("fieldset")
          ?.querySelector(":scope > legend")?.textContent;
        const label =
          input.type === "radio" && scope
            ? scope
            : scope
              ? scope + " · " + caption
              : caption;
        const value =
          input.type === "radio"
            ? caption
            : input.type === "checkbox"
              ? T(input.checked ? "Enabled" : "Disabled")
              : input.tagName === "SELECT"
                ? input.selectedOptions[0]?.textContent
                : input.value;
        if (value) list.append(R.dom("dt", {}, label), R.dom("dd", {}, value));
      }
      summary.append(list);
      for (const source of form.querySelectorAll(
        '[data-read-only-action="true"]',
      )) {
        const action = source.cloneNode(true);
        action.disabled = false;
        action.addEventListener("click", () => source.click());
        summary.append(action);
      }
    }
    function close(form, focus = false) {
      if (!form?.localEditor) return;
      const { key, box, summary, button, card } = form.localEditor;
      opened.delete(key);
      // Some editors rebuild synchronously on Cancel. Close the replacement,
      // too, so the visible state and the persisted edit key stay in sync.
      for (const current of document.querySelectorAll(".local-editor-box"))
        if (current.dataset.editorKey === key) {
          current.classList.remove("local-editor-open");
          current
            .closest("[data-settings-card]")
            ?.classList.remove("settings-card-editing");
        }
      box.classList.remove("local-editor-open");
      card?.classList.remove("settings-card-editing");
      readSummary(form, summary);
      form.localEditor.feedback.textContent = messages.get(key) || "";
      if (
        focus &&
        button.isConnected &&
        !button.classList.contains("permission-hidden")
      )
        button.focus({ preventScroll: true });
    }
    function bind(form, policy) {
      if (form.localEditor) {
        if (!editable(policy)) opened.delete(form.localEditor.key);
        form.localEditor.card?.classList.toggle(
          "settings-card-editing",
          opened.has(form.localEditor.key),
        );
        form.localEditor.box.classList.toggle(
          "local-editor-open",
          opened.has(form.localEditor.key),
        );
        form.localEditor.button.disabled =
          form.getAttribute("aria-busy") === "true" || !editable(policy);
        form.localEditor.button.classList.toggle(
          "permission-hidden",
          !editable(policy),
        );
        if (
          pendingFocus === form.localEditor.key &&
          form.localEditor.button.getClientRects().length
        ) {
          form.localEditor.button.focus({ preventScroll: true });
          pendingFocus = null;
        }
        return;
      }
      if (!form.querySelector("button[type=submit]")) return;
      const key =
        policy[1] || form.dataset.formKey || form.dataset.languageCode;
      if (!key) return;
      const box = R.dom("section", { class: "local-editor-box" }),
        summary = R.dom("div", { class: "local-editor-summary" }),
        feedback = R.dom("p", {
          class: "micro local-editor-feedback",
          role: "status",
        });
      if (!editable(policy)) opened.delete(key);
      box.dataset.editorKey = key;
      const languageRow = form.matches("#languageRows form");
      if (languageRow) {
        box.classList.add("settings-language-card");
        box.dataset.settingsCard = key;
        const heading = R.dom("div", { class: "settings-card-heading" });
        heading.append(
          R.dom(
            "h3",
            {},
            (form.querySelector("input:not([type=checkbox])")?.value ||
              form.dataset.languageCode) +
              " · " +
              form.dataset.languageCode,
          ),
        );
        box.append(heading);
      }
      const card = languageRow
        ? box
        : policy[1]
          ? form.closest("[data-settings-card]")
          : null;
      const header = card?.querySelector(":scope>.settings-card-heading");
      const title =
        T(policy[2]) +
        (form.dataset.languageCode ? " · " + form.dataset.languageCode : "");
      const button = iconAction("edit", T("Edit") + " · " + title, () => {
        if (!editable(policy) || form.getAttribute("aria-busy") === "true")
          return;
        messages.delete(key);
        feedback.textContent = "";
        opened.add(key);
        box.classList.add("local-editor-open");
        card?.classList.add("settings-card-editing");
        form
          .querySelector(
            "input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          )
          ?.focus();
      });
      button.disabled =
        form.getAttribute("aria-busy") === "true" || !editable(policy);
      button.dataset.localEdit = key;
      button.classList.add("local-editor-pencil");
      const source = form.parentElement.querySelector(
        ":scope > .planning-summary,:scope > .view-only",
      );
      if (source) {
        source.classList.remove("view-only");
        form.localReadSource = source;
        source.remove();
      }
      form.before(box);
      box.append(summary, feedback, form);
      if (header) {
        header.append(button);
        button.classList.add("settings-card-pencil");
      } else box.insertBefore(button, feedback);
      form.classList.add("local-editor-form");
      form.localEditor = { key, box, summary, button, feedback, card };
      feedback.textContent = messages.get(key) || "";
      box.classList.toggle("local-editor-open", opened.has(key));
      card?.classList.toggle("settings-card-editing", opened.has(key));
      button.classList.toggle("permission-hidden", !editable(policy));
      readSummary(form, summary);
      if (pendingFocus === key && button.getClientRects().length) {
        button.focus({ preventScroll: true });
        pendingFocus = null;
      }
      form.addEventListener(
        "submit",
        (event) => {
          if (!opened.has(key) || !editable(policy)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        true,
      );
      for (const cancel of form.querySelectorAll(
        "[data-discard],button[type=button]",
      )) {
        if (
          cancel.hasAttribute("data-discard") ||
          cancel.textContent.trim() === T("Cancel")
        )
          cancel.addEventListener("click", () => {
            if (form.getAttribute("aria-busy") !== "true") close(form, true);
          });
      }
    }
    function refresh(summaries = false) {
      if (pendingRecordFocus) {
        const pencil = [
          ...document.querySelectorAll("[data-record-pencil]"),
        ].find(
          (node) =>
            node.dataset.recordPencil === pendingRecordFocus &&
            node.getClientRects().length,
        );
        if (pencil) {
          pencil.focus({ preventScroll: true });
          pendingRecordFocus = null;
        }
      }
      for (const policy of policies)
        for (const form of document.querySelectorAll(policy[0])) {
          bind(form, policy);
          if (
            summaries &&
            form.localEditor &&
            !opened.has(form.localEditor.key)
          )
            readSummary(form, form.localEditor.summary);
        }
    }
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        refresh();
      });
    });
    observer.observe(document.getElementById("adminApp"), {
      childList: true,
      subtree: true,
    });
    return {
      refresh,
      saved(form, message = T("Saved")) {
        if (form?.dataset.recordEditor) {
          pendingRecordFocus = form.dataset.recordEditor;
          closeRecord?.(form);
        }
        if (form?.localEditor) {
          pendingFocus = form.localEditor.key;
          messages.set(pendingFocus, message);
        }
        close(form, true);
        if (form?.localEditor && form.getAttribute("aria-busy") === "true")
          form.localEditor.button.disabled = true;
      },
      cancel(form) {
        if (form?.localEditor) messages.delete(form.localEditor.key);
        close(form, true);
      },
      hasUnsaved() {
        if (window.RSVP_ADMIN_PREFERENCES?.hasUnsaved()) return true;
        return [...document.querySelectorAll("#adminApp form")].some((form) => {
          if (form.dataset.dirty !== undefined)
            return form.dataset.dirty === "true";
          return [...form.querySelectorAll("[data-clean-original]")].some(
            (input) =>
              (["checkbox", "radio"].includes(input.type)
                ? String(input.checked)
                : input.value) !== input.dataset.cleanOriginal,
          );
        });
      },
    };
  }
  window.RSVP_ADMIN_EDITORS = { create };
})();
