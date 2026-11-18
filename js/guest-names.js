// Display-only surname folding. Stored guest names always remain complete.
(function () {
  "use strict";
  function lastName(guest, invitation, settings) {
    const surname = guest?.last_name || "";
    if (settings?.show_repeated_surname !== false) return surname;
    const householdName = invitation?.household?.last_name?.trim();
    const guests = (invitation?.guests || []).filter((person) => !person.archived_at);
    return householdName && guests.length && guests.every((person) => person.last_name?.trim() === householdName)
      ? "" : surname;
  }
  window.RSVP_GUEST_NAMES = Object.freeze({ lastName });
})();

// Shared projection for administrator previews and the actual guest viewport.
(function () {
  "use strict";
  let selected = "phone";
  const viewport = () => matchMedia("(max-width: 700px)").matches ? "phone" : "wide";
  const keys = ["guest_title_visibility", "show_repeated_surname", "guest_name_layout", "guest_design", "guest_background", "guest_theme_toggle", "guest_theme_default", "notification_preferences"];
  function effective(settings = {}, mode = viewport(), languages = []) {
    const overrides = settings.guest_interface_modes?.[mode] || {};
    const titles = mode === "phone" ? Object.fromEntries(languages.map(l => [typeof l === "string" ? l : l.language_code, false])) : settings.guest_title_visibility || {};
    return { ...settings, guest_title_visibility: mode === "phone" ? Object.fromEntries(languages.map(l => [typeof l === "string" ? l : l.language_code, false])) : settings.guest_title_visibility || {}, guest_name_layout: mode === "phone" ? "above" : "inline", ...overrides, guest_title_visibility: { ...titles, ...overrides.guest_title_visibility } };
  }
  window.RSVP_GUEST_INTERFACE = {
    keys, viewport, effective,
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
