// Invitation display rules leave stored names complete.
(function () {
  "use strict";
  function lastName(guest, invitation, settings) {
    const surname = guest?.last_name || "";
    if ((guest?.name_display_overrides?.show_repeated_surname ?? settings?.show_repeated_surname) !== false) return surname;
    const householdName = invitation?.household?.last_name?.trim();
    const guests = (invitation?.guests || []).filter((person) => !person.archived_at);
    return householdName && guests.length && guests.every((person) => person.last_name?.trim() === householdName)
      ? "" : surname;
  }
  function showTitle(settings, language) {
    return settings?.guest_show_titles !== false && settings?.guest_title_visibility?.[language] !== false;
  }
  function courtesyTitle(title, language) {
    if (!["Mr.", "Ms.", "Son", "Daughter"].includes(title)) return title || "";
    return window.RSVP_I18N?.t(title, {}, language) || title;
  }
  window.RSVP_GUEST_NAMES = Object.freeze({ lastName, showTitle, courtesyTitle });
})();

// Shared projection for administrator previews and the actual guest viewport.
(function () {
  "use strict";
  let selected = "phone";
  const viewportQuery = "(min-width: 512px)";
  const viewport = () => matchMedia(viewportQuery).matches ? "wide" : "phone";
  const keys = ["guest_show_titles", "guest_title_visibility", "show_repeated_surname", "guest_name_layout", "guest_design", "guest_background", "guest_theme_toggle", "guest_theme_default", "notification_preferences"];
  function effective(settings = {}, mode = viewport(), languages = []) {
    const overrides = settings.guest_interface_modes?.[mode] || {};
    const code = language => typeof language === "string" ? language : language.language_code;
    const defaults = mode === "phone" ? Object.fromEntries(languages.map(l => [code(l), false])) : settings.guest_title_visibility;
    const titles = { ...defaults, ...overrides.guest_title_visibility };
    // Older settings have only per-language flags. Keep their visibility on each layout.
    const enabled = languages.length ? languages.filter(l => l.enabled !== false).map(code) : Object.keys(titles);
    const inferred = enabled.some(language => titles[language] !== false)
      || (!languages.length && !enabled.length && mode === "wide");
    return {
      ...settings, guest_name_layout: mode === "phone" ? "above" : "inline", ...overrides,
      guest_title_visibility: titles,
      guest_show_titles: overrides.guest_show_titles ?? inferred,
    };
  }
  window.RSVP_GUEST_INTERFACE = {
    keys, viewportQuery, viewport, effective,
    get selected() { return selected; },
    store(store) { return { ...store, settings: effective(store.settings, selected, store.languages) }; },
    controls({ R, T, getStore, render }) {
      const panel = document.querySelector('[data-settings-panel="interface"]');
      if (!panel || panel.querySelector(".guest-landing-settings")) return;
      const landing = R.dom("section", { class: "guest-landing-settings" }); landing.append(R.dom("h2", {}, T("Landing page")));
      const names = R.byId("guestNamesHost"), appearance = R.byId("guestAppearanceHost");
      panel.insertBefore(landing, names); landing.append(names, appearance);
    },
  };
})();
