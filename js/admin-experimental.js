// Application-wide experimental opt-in. Personal Auth preferences stay separate.
(function () {
  "use strict";
  function create({ R, T, getStore, getActor, can, managementRpc, reload, show, onChange, saved, cancelled }) {
    const form = R.byId("shortcutExperimentalForm");
    const helper = R.byId("shortcutsTestHelper");
    const checkbox = R.byId("shortcutExperimentalEnabled");
    const save = R.byId("saveShortcutExperimental");
    const cancel = R.byId("cancelShortcutExperimental");
    const status = R.byId("shortcutExperimentalStatus");
    let owner = null, initialized = false, baseline = false, draft = false, busy = false, generation = 0;
    const current = () => getStore().settings?.apple_shortcuts_enabled === true;
    const permitted = () => Boolean(getActor()) && can("settings", "edit");
    const dirty = () => initialized && draft !== baseline;
    function feedback(message = "", state = "") {
      status.textContent = message;
      status.hidden = !message;
      status.dataset.state = state;
    }
    function controls() {
      checkbox.checked = draft;
      checkbox.disabled = busy || !permitted();
      save.disabled = busy || !permitted() || !dirty();
      cancel.disabled = busy;
      form.dataset.dirty = String(dirty());
      form.setAttribute("aria-busy", String(busy));
    }
    function renderHelper(actor) {
      if (!helper) return;
      // The synthetic helper has its own backend and is configured only on test installations.
      let destination;
      const configured = window.RSVP_CONFIG?.shortcutsTestHelperUrl;
      if (actor && can("settings") && typeof configured === "string") {
        try {
          const url = new URL(configured);
          if (url.protocol === "https:" && url.hostname === window.location.hostname &&
              url.pathname === "/shortcuts-test.html" && !url.username && !url.password &&
              !url.search && !url.hash)
            destination = url.href;
        } catch (_) {}
      }
      helper.hidden = !destination;
      if (destination) helper.href = destination;
      else helper.removeAttribute("href");
    }
    function clear() {
      generation++;
      owner = null; initialized = false; baseline = draft = false; busy = false;
      feedback(); controls(); renderHelper(null);
    }
    function render() {
      if (!form) return;
      const actor = getActor();
      if (owner !== actor) {
        clear(); owner = actor;
      }
      if (!initialized || (!busy && (!dirty() || draft === current()))) {
        baseline = draft = current(); initialized = true;
      }
      if (!permitted() && dirty()) {
        baseline = draft = current();
        generation++; busy = false; feedback();
      }
      renderHelper(actor);
      form.renderReadSummary = host => {
        const list = R.dom("dl", { class: "record-read-grid compact-read-grid" });
        list.append(R.dom("dt", {}, T("Status")), R.dom("dd", {}, T(current() ? "Enabled" : "Disabled")));
        host.append(list);
      };
      controls();
    }
    checkbox?.addEventListener("change", () => {
      if (busy || !permitted()) { controls(); return; }
      draft = checkbox.checked; feedback(); controls();
    });
    cancel?.addEventListener("click", () => {
      if (busy) return;
      baseline = draft = current(); initialized = true;
      feedback(); controls(); window.RSVP_I18N?.markClean(form); cancelled?.(form);
    });
    form?.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !permitted() || !dirty()) return;
      const ticket = generation, actor = getActor(), requested = draft, expected = baseline;
      busy = true; feedback(T("Saving…"), "saving"); controls();
      try {
        const result = await managementRpc("admin_set_shortcuts_enabled", { p_enabled: requested, p_expected: expected });
        if (generation !== ticket || getActor() !== actor || !permitted()) return;
        if (!result || typeof result.enabled !== "boolean" || result.enabled !== requested) throw Error("Invalid setting response");
        getStore().settings.apple_shortcuts_enabled = result.enabled;
        baseline = draft = result.enabled;
        onChange?.(result.enabled);
        await reload();
        if (generation !== ticket || getActor() !== actor || !permitted()) return;
        window.RSVP_I18N?.markClean(form); feedback(T("Saved"), "saved"); saved?.(form);
      } catch (_) {
        if (generation === ticket && getActor() === actor) {
          const message = T("Your experimental setting could not be saved. Refresh and try again.");
          feedback(message, "error"); show?.(message, "error");
        }
      } finally {
        if (generation === ticket) { busy = false; controls(); }
      }
    });
    if (form) form.cleanSaveUpdate = controls;
    return { render, clear };
  }
  window.RSVP_ADMIN_EXPERIMENTAL = { create };
})();
