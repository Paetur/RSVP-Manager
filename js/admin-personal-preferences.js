(function () {
  "use strict";
  const fields = {
    language: "rsvp_interface_language",
    appearance: "rsvp_interface_appearance",
    time: "rsvp_interface_time_format",
  };
  const controlIds = {
    language: "interfaceLanguage",
    appearance: "themePreference",
    time: "timeFormat",
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
  function valid(kind, value) {
    return kind === "language"
      ? window.RSVP_I18N.enabled(value)
      : (kind === "appearance"
          ? ["system", "light", "dark"]
          : ["locale", "12", "24"]
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
              }[kind],
        ];
      }),
    );
  }
  function changes() {
    return baseline && draft
      ? Object.fromEntries(
          Object.entries(draft).filter(
            ([kind, value]) => value !== baseline[kind],
          ),
        )
      : {};
  }
  function hasUnsaved() {
    return Object.keys(changes()).length > 0;
  }
  function status(text = "", state = "") {
    const node = element("personalPreferencesStatus");
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
    ]) {
      const node = element(id);
      if (node) node.disabled = busy || !account;
    }
    const save = element("savePersonalPreferences");
    if (save) save.disabled = busy || !account || !hasUnsaved();
    form()?.setAttribute("aria-busy", String(busy));
  }
  function renderDraft() {
    if (draft)
      for (const [kind, id] of Object.entries(controlIds)) {
        const node = element(id);
        if (node) node.value = draft[kind];
      }
    updateControls();
  }
  async function apply(values, ticket) {
    await window.RSVP_I18N.setLanguage(values.language);
    if (ticket !== generation) return;
    window.RSVP_THEME.setAdminPreference(values.appearance);
    timePreference = values.time;
    try {
      localStorage.setItem("rsvp-time-format", timePreference);
    } catch (_) {}
  }
  function stage(kind, value) {
    if (busy || !account || !Object.hasOwn(fields, kind) || !valid(kind, value))
      return false;
    draft[kind] = value;
    status();
    renderDraft();
    return true;
  }
  async function commit(patch) {
    if (busy || !account || !Object.keys(patch).length) return false;
    const ticket = generation,
      id = account.id;
    busy = true;
    updateControls();
    status(T("Saving…"), "saving");
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
      if (!hasUnsaved()) window.RSVP_I18N.markClean(form());
      status(T("Saved"), "saved");
      return true;
    } catch (_) {
      if (ticket === generation)
        status(
          T("Your preference could not be saved. Please try again."),
          "error",
        );
      return false;
    } finally {
      if (ticket === generation) {
        busy = false;
        renderDraft();
      }
    }
  }
  async function submit() {
    const patch = changes();
    if (busy || !account || !Object.keys(patch).length) return;
    const languageChanged = Object.hasOwn(patch, "language");
    if (languageChanged && !window.RSVP_I18N.confirmLanguageReload(form()))
      return;
    if (await commit(patch)) {
      window.RSVP_LOCAL_EDITORS?.saved(form());
      if (languageChanged) window.RSVP_I18N.reloadLanguagePage();
    }
  }
  function cancel() {
    if (busy || !baseline) return;
    draft = { ...baseline };
    window.RSVP_I18N.markClean(form());
    status();
    renderDraft();
  }
  window.RSVP_ADMIN_PREFERENCES = {
    get timeFormat() {
      return timePreference;
    },
    hasUnsaved,
    stage,
    cancel,
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
        status();
        renderDraft();
      }
    },
    clear() {
      generation++;
      account = baseline = draft = null;
      busy = false;
      timePreference = "locale";
      status();
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
    form()?.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    element("cancelPersonalPreferences")?.addEventListener("click", cancel);
    updateControls();
  });
})();
