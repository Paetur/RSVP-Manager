// Record-owned async decisions and editors. No browser alert/confirm or modal layer.
(function () {
  "use strict";
  const T = (s) => window.RSVP_I18N?.t(s) || s;
  const panels = new Set();
  let suspended = false;
  let lastTrigger = null;
  document.addEventListener("click", event => {
    lastTrigger = event.target.closest?.("button,a,input,select");
    for (const dropdown of document.querySelectorAll("details.filter-choice[open]")) {
      if (!dropdown.contains(event.target)) dropdown.open = false;
    }
  }, true);
  const currentTrigger = () => document.activeElement && document.activeElement !== document.body ? document.activeElement : lastTrigger;
  function anchorFor(trigger) {
    const chain = [];
    for (let n = trigger; n && n !== document.body; n = n.parentElement) {
      for (const name of ["data-settings-card", "data-food-item-id", "data-household-id", "data-household-detail-key", "data-invite-household", "data-food-category-id", "data-form-key", "id"]) {
        if (n.hasAttribute?.(name)) chain.push([name, n.getAttribute(name)]);
      }
    }
    return chain;
  }
  function owner(trigger) {
    const record = trigger?.closest?.(".invitation-template,.food-expanded,.guest-food-choice,.household-expanded,.admin-member,.admin-management,.settings-card,.panel");
    const host = record || document.getElementById("adminApp") || document.querySelector("main") || document.body;
    return host.closest("form")?.parentElement || host;
  }
  function panel(attrs = {}, trigger = currentTrigger(), host = null) {
    const node = window.RSVP.dom("section", attrs);
    node.inlineAnchors = anchorFor(trigger);
    node.inlineTrigger = trigger;
    node.classList.add("inline-editor-panel");
    node.setAttribute("role", "region");
    node.openInline = () => {
      const target = host || owner(trigger);
      if (!target.isConnected) return node.close();
      if (target.tagName === "DETAILS") target.open = true;
      target.append(node);
      panels.add(node);
      node.setAttribute("open", "");
    };
    node.close = () => {
      node.dispatchEvent(new Event("close"));
      node.remove();
      panels.delete(node);
      setTimeout(() => {
        if (trigger?.isConnected && !trigger.disabled && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
      }, 0);
    };
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      const cancel = new Event("cancel", { cancelable: true });
      if (node.dispatchEvent(cancel)) node.close();
    });
    return node;
  }
  function confirm(message, { action = "Confirm", trigger = currentTrigger(), host, onSave,
    cancelAction = onSave ? "Stay here" : "Cancel", label = T(action) } = {}) {
    const R = window.RSVP;
    return new Promise((resolve) => {
      const target = host || trigger?.closest?.(".form-actions") || owner(trigger);
      const view = panel({ class: "inline-confirmation" }, trigger, target);
      view.setAttribute("aria-label", label);
      const actions = R.dom("div", { class: "form-actions" }),
        apply = R.dom("button", { type: "button", class: "btn secondary" }, T(action)),
        cancel = R.dom("button", { type: "button", class: "btn secondary" }, T(cancelAction));
      apply.dataset.inlineConfirm = "true";
      let settled = false, saving = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        view.close();
        resolve(value);
      };
      const observer = new MutationObserver(() => { if (!view.isConnected && !saving && !suspended) finish(false); });
      view.append(R.dom("p", {}, message), actions);
      if (onSave) {
        const save = R.dom("button", { type: "button", class: "btn" }, T("Save and continue"));
        save.addEventListener("click", async () => {
          save.disabled = apply.disabled = cancel.disabled = true;
          saving = true;
          try { if (await onSave()) finish(true); }
          finally { saving = false; save.disabled = apply.disabled = cancel.disabled = false; }
        });
        actions.append(save);
      }
      actions.append(apply, cancel);
      apply.addEventListener("click", () => finish(true));
      cancel.addEventListener("click", () => finish(false));
      view.addEventListener("close", () => finish(false));
      view.openInline();
      observer.observe(document.body, { childList: true, subtree: true });
      cancel.focus({ preventScroll: true });
      // The decision must stay visible when its trigger is at the viewport edge.
      view.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
  }
  function confirmIrreversible(trigger) {
    const message = T("Are you really sure. This can NOT be undone");
    return confirm(message, { trigger, action: "Yes", cancelAction: "No", label: message });
  }
  async function saveForms(forms) {
    for (let form of forms) {
      if (!form.isConnected) {
        const key = form.dataset.formKey || form.id;
        form = [...document.querySelectorAll("form")].find(f => (f.dataset.formKey || f.id) === key);
        if (!form) continue;
      }
      const save = form.querySelector('button[type="submit"]:not(:disabled)');
      if (!save) continue;
      if (!form.reportValidity()) return false;
      form.requestSubmit(save);
      await new Promise((resolve) => {
        const done = () => !form.isConnected || form.getAttribute("aria-busy") !== "true";
        const observer = new MutationObserver(() => { if (done()) { observer.disconnect(); resolve(); } });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy"] });
        queueMicrotask(() => { if (done()) { observer.disconnect(); resolve(); } });
      });
      if (form.querySelector('.form-feedback[data-state="error"]')) return false;
    }
    return true;
  }
  function suspend() {
    suspended = true;
    const current = [...panels].filter(p => p.isConnected && !p.parentElement.closest(".inline-editor-panel"));
    const fragment = document.createDocumentFragment();
    for (const panel of current) fragment.append(panel);
    return () => {
      for (const panel of current) {
        let target;
        for (const [name, value] of panel.inlineAnchors) {
          target = [...document.querySelectorAll("[" + name + "]")].find(n => n.getAttribute(name) === value && !n.closest(".inline-editor-panel"));
          if (target) break;
        }
        if (!target) { panel.close(); continue; }
        const host = owner(target);
        if (host.tagName === "DETAILS") host.open = true;
        host.append(panel);
      }
      suspended = false;
    };
  }
  let languageTabsId = 0;
  function languages(host) {
    const rows = [...host.querySelectorAll("[data-language-code]")];
    if (rows.length < 2) return;
    const R = window.RSVP, nav = R.dom("nav", { class: "tab-bar inline-language-tabs" });
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", T("Languages"));
    const prefix = "inline-language-" + ++languageTabsId;
    function select(code) {
      rows.forEach(row => row.classList.toggle("hidden", row.dataset.languageCode !== code));
      for (const button of nav.children) button.setAttribute("aria-selected", String(button.dataset.inlineLanguageCode === code));
    }
    for (const [index, row] of rows.entries()) {
      const code = row.dataset.languageCode;
      row.id = prefix + "-" + index;
      const button = R.dom("button", { type: "button" }, row.querySelector("strong")?.textContent || code.toUpperCase());
      button.dataset.inlineLanguageCode = code;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", row.id);
      button.addEventListener("click", () => select(code));
      nav.append(button);
    }
    host.prepend(nav);
    select(rows.find(row => row.dataset.languageCode === window.RSVP_I18N?.language)?.dataset.languageCode || rows[0].dataset.languageCode);
  }
  function multiChoice({ R, T, label, options, selected, onChange, disabled = false, group, className = "", beforeOptions }) {
    const classes = ["template-choice", "filter-choice", className].filter(Boolean).join(" ");
    const dropdown = R.dom("details", { class: classes, ...(group ? { name: group } : {}) });
    const summary = R.dom("summary");
    const caption = R.dom("span", { class: "filter-choice-label" }, T(label));
    const selection = R.dom("span", { class: "filter-choice-selection template-choice-values" });
    const menu = R.dom("div", { class: "template-choice-menu" });
    if (beforeOptions) menu.append(beforeOptions);
    const controls = options.map(([key, name]) => {
      const button = R.dom("button", { type: "button", disabled }, T(name));
      button.dataset.value = key;
      button.setAttribute("aria-label", button.textContent);
      button.addEventListener("click", () => {
        if (!selected.delete(key)) selected.add(key);
        update();
        onChange(key);
      });
      menu.append(button);
      return [key, button];
    });
    function update() {
      const names = [];
      for (const [key, button] of controls) {
        const active = selected.has(key);
        button.setAttribute("aria-pressed", String(active));
        if (active) names.push(button.textContent);
      }
      const preview = names.length === 0 ? [T("None selected")] : names.length === controls.length ? [T("All")] : names;
      selection.replaceChildren(...preview.map(name => R.dom("span", { class: "template-choice-pill" }, name)));
    }
    dropdown.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !dropdown.open) return;
      event.preventDefault();
      event.stopPropagation();
      dropdown.open = false;
      summary.focus();
    });
    summary.append(caption, selection);
    dropdown.append(summary, menu);
    update();
    return dropdown;
  }
  window.RSVP_INLINE = { panel, confirm, confirmIrreversible, saveForms, suspend, languages, multiChoice };
})();

// Transient record popups live outside rerendered cards. Native dialog provides
// keyboard containment; each logical record owns at most one open instance.
(function () {
  "use strict";
  const open = new Map();
  document.addEventListener("rsvp:admin-access-lost", () => { for (const dialog of open.values()) dialog.close(); });
  window.RSVP_POPUPS = {
    get: key => open.get(key),
    reconcile(can) {
      for (const [key, dialog] of open) {
        if ((key.startsWith("food-") && dialog.dataset.permissionEdit === "true" && !can("languages", "edit")) || ((key.startsWith("invitation-delivery:") || key.startsWith("template-choice:")) && !can("invites", "edit"))) dialog.close();
      }
    },
    create(key, attrs = {}, trigger = document.activeElement) {
      const existing = open.get(key);
      if (existing) { existing.querySelector("input,button,select,textarea")?.focus(); return existing; }
      const R = window.RSVP, dialog = R.dom("dialog", attrs);
      dialog.classList.add("record-popup");
      dialog.dataset.popupKey = key;
      open.set(key, dialog);
      const nativeClose = dialog.close.bind(dialog);
      dialog.close = () => {
        if (dialog.open) nativeClose();
        else dialog.dispatchEvent(new Event("close"));
      };
      dialog.openInline = () => {
        if (!dialog.isConnected) document.body.append(dialog);
        if (!dialog.open) dialog.showModal();
      };
      dialog.addEventListener("close", () => {
        open.delete(key); dialog.remove();
        if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
      }, { once: true });
      dialog.addEventListener("cancel", event => {
        if (dialog.querySelector('[aria-busy="true"]')) { event.preventDefault(); return; }
        const forms = [...dialog.querySelectorAll("form")];
        if (forms.some(f => f.dataset.dirty === "true" || window.RSVP_I18N?.isDirty?.(f))) {
          event.preventDefault();
          R.inlineConfirm(window.RSVP_I18N.t("Discard unsaved changes?"), { trigger: dialog.querySelector("button"), host: dialog, action: "Discard changes" }).then(yes => { if (yes) dialog.close(); });
        }
      });
      return dialog;
    },
  };
})();

(function () {
  "use strict";
  function formatDeletes(root = document) {
    const I = window.RSVP_I18N, R = window.RSVP;
    if (!I || !R) return;
    const label = I.t("Delete");
    for (const button of root.querySelectorAll("button,a.btn")) {
      if (button.dataset.deleteLabel === label) continue;
      const text = button.textContent.trim(), title = button.getAttribute("aria-label") || button.title || text;
      const terms = ["Delete", "Löschen", "Strika", label];
      if (!terms.some(term => text === term || text.startsWith(term + " ") || title === term || title.startsWith(term + " "))) continue;
      button.dataset.deleteLabel = label;
      button.classList.add("delete-action", "danger");
      if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", title);
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(icon.namespaceURI, "path"); path.setAttribute("d", "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7"); icon.append(path);
      button.replaceChildren(icon, R.dom("span", {}, label));
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    formatDeletes();
    new MutationObserver(() => formatDeletes()).observe(document.body, { childList: true, subtree: true });
  });
})();
