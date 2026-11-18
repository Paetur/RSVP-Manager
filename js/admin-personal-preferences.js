(function () {
  "use strict";
  const fields = {
    language: "rsvp_interface_language",
    appearance: "rsvp_interface_appearance",
    time: "rsvp_interface_time_format",
    hover: "rsvp_interface_button_hover",
    grouped: "rsvp_invites_grouped",
  };
  const controlIds = {
    language: "interfaceLanguage",
    appearance: "themePreference",
    time: "timeFormat",
    hover: "buttonHover",
    grouped: "inviteGroupView",
  };
  let account = null,
    baseline = null,
    draft = null,
    busy = false,
    generation = 0,
    timePreference = "locale";
  const T = (...args) => window.RSVP_I18N.t(...args);
  const element = (id) => document.getElementById(id);
  const form = () => element("personalPreferencesForm");
  const invitesForm = () => element("invitesAppearanceForm");
  const personalKinds = ["language", "appearance", "time", "hover"];
  const kindsFor = node => node === invitesForm() ? ["grouped"] : personalKinds;
  function valid(kind, value) {
    if (kind === "grouped") return typeof value === "boolean";
    return kind === "language"
      ? window.RSVP_I18N.enabled(value)
      : (kind === "appearance"
          ? ["system", "light", "dark"]
          : kind === "hover" ? ["toolbar", "pencil", "create"] : ["locale", "12", "24"]
        ).includes(value);
  }
  function preferences(user) {
    const metadata = user?.user_metadata || {};
    return Object.fromEntries(
      Object.keys(fields).map((kind) => {
        const value = metadata[fields[kind]];
        return [
          kind,
          valid(kind, value)
            ? value
            : {
                language: window.RSVP_I18N.defaultLanguage,
                appearance: "system",
                time: "locale",
                hover: "toolbar",
                grouped: true,
              }[kind],
        ];
      }),
    );
  }
  function changes(kinds = Object.keys(fields)) {
    return baseline && draft
      ? Object.fromEntries(
          Object.entries(draft).filter(
            ([kind, value]) => kinds.includes(kind) && value !== baseline[kind],
          ),
        )
      : {};
  }
  function hasUnsaved(kinds) {
    return Object.keys(changes(kinds)).length > 0;
  }
  function status(text = "", state = "", target = form()) {
    const node = element(target === invitesForm() ? "invitesAppearanceStatus" : "personalPreferencesStatus");
    if (!node) return;
    node.textContent = text;
    node.dataset.state = state;
    node.hidden = !text;
  }
  function updateControls() {
    for (const id of [
      ...Object.values(controlIds),
      "themeToggle",
      "logout",
      "cancelPersonalPreferences",
      "cancelInvitesAppearance",
    ]) {
      const node = element(id);
      if (node) node.disabled = busy || !account;
    }
    const save = element("savePersonalPreferences");
    if (save) save.disabled = busy || !account || !hasUnsaved(personalKinds);
    const groupingSave = element("saveInvitesAppearance");
    if (groupingSave) groupingSave.disabled = busy || !account || !hasUnsaved(["grouped"]);
    for (const node of [form(), invitesForm()]) node?.setAttribute("aria-busy", String(busy));
    for (const button of form()?.querySelectorAll("[data-preference-choice]") || []) button.disabled = busy || !account;
  }
  function renderDraft() {
    if (draft)
      for (const [kind, id] of Object.entries(controlIds)) {
        const node = element(id);
        if (node) { if (kind === "grouped") node.checked = draft[kind]; else node.value = draft[kind]; }
      }
    updateControls();
    syncChoices();
  }
  function syncChoices() {
    if (!form()) return;
    for (const [kind, id] of Object.entries(controlIds)) {
      const select = element(id); if (!select?.options) continue;
      let group = form().querySelector('[data-preference-choices="' + kind + '"]');
      if (!group) {
        const R = window.RSVP;
        group = R.dom("fieldset", { class: "interface-choice-group" }); group.dataset.preferenceChoices = kind;
        group.append(R.dom("legend", {}, T({ language:"Language", appearance:"Appearance", time:"Time format", hover:"Button hover appearance" }[kind])));
        select.closest("label").after(group); select.closest("label").hidden = true; select.closest("label").classList.add("hidden");
      }
      const signature = JSON.stringify([...select.options].map(o => [o.value, o.text]));
      if (group.dataset.options !== signature) {
        group.querySelectorAll("button").forEach(n => n.remove()); group.dataset.options = signature;
        [...select.options].forEach((option, index) => {
          const button = window.RSVP.dom("button", { type:"button", class:"interface-choice" }, kind === "hover" ? T("Choice " + (index + 1)) : option.text);
          button.dataset.preferenceChoice = option.value;
          if (kind === "hover") { button.classList.add("hover-choice"); button.dataset.hoverChoice = option.value; }
          button.addEventListener("click", () => { select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); }); group.append(button);
        });
      }
      for (const button of group.querySelectorAll("button")) { button.setAttribute("aria-pressed", String(button.dataset.preferenceChoice === select.value)); button.disabled = busy || !account; }
    }
  }
  async function apply(values, ticket) {
    await window.RSVP_I18N.setLanguage(values.language);
    if (ticket !== generation) return;
    window.RSVP_THEME.setAdminPreference(values.appearance);
    document.documentElement.dataset.buttonHover = values.hover;
    timePreference = values.time;
    try {
      localStorage.setItem("rsvp-time-format", timePreference);
    } catch (_) {}
  }
  function stage(kind, value) {
    if (busy || !account || !Object.hasOwn(fields, kind) || !valid(kind, value))
      return false;
    draft[kind] = value;
    status("", "", kind === "grouped" ? invitesForm() : form());
    renderDraft();
    return true;
  }
  async function commit(patch) {
    if (busy || !account || !Object.keys(patch).length) return false;
    const ticket = generation,
      id = account.id,
      target = Object.hasOwn(patch, "grouped") ? invitesForm() : form();
    busy = true;
    updateControls();
    status(T("Saving…"), "saving", target);
    try {
      const db = window.RSVP.getClient();
      const current = await db.auth.getUser();
      if (current.error) throw current.error;
      if (ticket !== generation) return false;
      if (current.data?.user?.id !== id) throw new Error("Account changed");
      // Only changed preference fields are patched; unrelated metadata and
      // preferences changed on another device are not overwritten.
      const result = await db.auth.updateUser({
        data: Object.fromEntries(
          Object.entries(patch).map(([kind, value]) => [fields[kind], value]),
        ),
      });
      if (result.error) throw result.error;
      if (ticket !== generation) return false;
      if (result.data?.user?.id !== id) throw new Error("Account changed");
      account = result.data.user;
      baseline = { ...baseline, ...patch };
      draft = { ...draft, ...patch };
      await apply(baseline, ticket);
      if (ticket !== generation) return false;
      if (Object.hasOwn(patch, "time"))
        document.dispatchEvent(new Event("rsvp:time-format"));
      if (Object.hasOwn(patch, "grouped")) document.dispatchEvent(new Event("rsvp:invites-appearance"));
      if (!hasUnsaved(kindsFor(target))) window.RSVP_I18N.markClean(target);
      status(T("Saved"), "saved", target);
      return true;
    } catch (_) {
      if (ticket === generation)
        status(
          T("Your preference could not be saved. Please try again."),
          "error",
          target,
        );
      return false;
    } finally {
      if (ticket === generation) {
        busy = false;
        renderDraft();
      }
    }
  }
  async function submit(target = form()) {
    const patch = changes(kindsFor(target));
    if (busy || !account || !Object.keys(patch).length) return;
    const languageChanged = Object.hasOwn(patch, "language");
    if (languageChanged && !await window.RSVP_I18N.confirmLanguageReload(form()))
      return;
    if (await commit(patch)) {
      window.RSVP_LOCAL_EDITORS?.saved(target);
      if (languageChanged) window.RSVP_I18N.reloadLanguagePage();
    }
  }
  function cancel(target = form()) {
    if (busy || !baseline) return;
    for (const kind of kindsFor(target)) draft[kind] = baseline[kind];
    window.RSVP_I18N.markClean(target);
    status("", "", target);
    renderDraft();
  }
  window.RSVP_ADMIN_PREFERENCES = {
    get timeFormat() {
      return timePreference;
    },
    get invitesGrouped() { return baseline?.grouped !== false; },
    hasUnsaved,
    stage,
    cancel: () => cancel(),
    async load(user) {
      const ticket = ++generation;
      account = user;
      baseline = preferences(user);
      draft = { ...baseline };
      busy = true;
      updateControls();
      await apply(baseline, ticket);
      if (ticket === generation) {
        busy = false;
        status(); status("", "", invitesForm());
        renderDraft();
      }
    },
    clear() {
      generation++;
      account = baseline = draft = null;
      busy = false;
      timePreference = "locale";
      document.documentElement.dataset.buttonHover = "toolbar";
      status(); status("", "", invitesForm());
      updateControls();
      try {
        for (const key of [
          "rsvp-interface-language",
          "rsvp-time-format",
          "event-appearance",
        ])
          localStorage.removeItem(key);
      } catch (_) {}
      window.RSVP_THEME.setAdminPreference("system");
    },
    // The top-bar appearance toggle remains an immediate account action. It
    // updates only appearance and preserves other unsaved Interface choices.
    async save(kind, value) {
      if (busy || !account || kind !== "appearance" || !valid(kind, value))
        return false;
      return commit({ appearance: value });
    },
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (form()) {
      const R = window.RSVP, label = R.dom("label");
      const select = R.dom("select", { id: "buttonHover" });
      for (const [value, text] of [["toolbar","Toolbar"],["pencil","Pencil"],["create","Create button"]]) select.append(R.dom("option", { value }, T(text)));
      label.append(R.dom("span", {}, T("Button hover appearance")), select);
      form().querySelector(".form-grid").append(label);
      select.addEventListener("change", () => stage("hover", select.value));
      syncChoices();
    }
    form()?.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    element("cancelPersonalPreferences")?.addEventListener("click", () => cancel());
    invitesForm()?.addEventListener("submit", event => { event.preventDefault(); submit(invitesForm()); });
    element("cancelInvitesAppearance")?.addEventListener("click", () => cancel(invitesForm()));
    element("inviteGroupView")?.addEventListener("change", event => stage("grouped", event.target.checked));
    updateControls();
  });
})();
