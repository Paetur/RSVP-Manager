// Record-owned async decisions and editors. No browser alert/confirm or modal layer.
(function () {
  "use strict";
  const T = (s) => window.RSVP_I18N?.t(s) || s;
  const panels = new Set();
  let suspended = false;
  let lastTrigger = null;
  document.addEventListener("click", event => { lastTrigger = event.target.closest?.("button,a,input,select"); }, true);
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
  function confirm(message, { action = "Confirm", trigger = currentTrigger(), host, onSave } = {}) {
    const R = window.RSVP;
    return new Promise((resolve) => {
      const view = panel({ class: "inline-confirmation" }, trigger, host);
      view.setAttribute("aria-label", T(action));
      const actions = R.dom("div", { class: "form-actions" }),
        apply = R.dom("button", { type: "button", class: "btn secondary" }, T(action)),
        cancel = R.dom("button", { type: "button", class: "btn secondary" }, T(onSave ? "Stay here" : "Cancel"));
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
      owner(trigger).append(view);
      view.openInline();
      observer.observe(document.body, { childList: true, subtree: true });
      cancel.focus({ preventScroll: true });
    });
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
  window.RSVP_INLINE = { panel, confirm, saveForms, suspend, languages };
})();
