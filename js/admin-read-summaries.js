// Compact saved-value views only. Editors, drafts and writes remain controller-owned.
(function () {
  "use strict";
  function create({ R, T, getStore, adminTime, planningName }) {
    const $ = R.byId;
    let contactOpen = false;
    const language = () => window.RSVP_I18N?.language || "en";
    const value = input => input === null || input === undefined || input === "" ? "—" : String(input);
    function date(input) {
      if (!input) return "";
      try { return window.RSVP_ADMIN_PREFERENCES.formatDate(input, language(), getStore().settings?.timezone); }
      catch (_) { return value(input); }
    }
    function clock(input) {
      if (!input) return "";
      try { return window.RSVP_ADMIN_PREFERENCES.formatClock(input, language()); }
      catch (_) { return value(input); }
    }
    function stamp(input) {
      if (!input) return "—";
      try { return adminTime(input); } catch (_) { return value(input); }
    }
    function rows(host, entries) {
      const list = R.dom("dl", { class: "record-read-grid compact-read-grid" });
      for (const [label, content] of entries) list.append(R.dom("dt", {}, T(label)), R.dom("dd", {}, value(content)));
      host.append(list);
      return list;
    }
    function event(host) {
      const settings = getStore().settings || {};
      host.classList.add("compact-saved-view");
      rows(host, [
        ["Event", settings.event_name],
        ["When", [date(settings.event_date), clock(settings.event_time)].filter(Boolean).join(" · ")],
        ["RSVP by", stamp(settings.rsvp_deadline)],
        ["Timezone", settings.timezone],
        ["Organizer", settings.organizer_name],
        ["Food deadline", stamp(settings.food_deadline)],
      ]);
      const contacts = [
        ["Email", settings.organizer_email],
        ["Phone", settings.organizer_phone],
        ["Website URL", settings.website_url],
      ].filter(([, content]) => content);
      if (contacts.length) {
        const details = R.dom("details", { class: "compact-contact-details" });
        details.open = contactOpen;
        details.append(R.dom("summary", {}, T("Contact & website")));
        rows(details, contacts);
        details.addEventListener("toggle", () => { if (details.isConnected) contactOpen = details.open; });
        host.append(details);
      }
    }
    function planning(host) {
      const settings = getStore().settings || {}, config = settings.planning_config || {};
      const type = { wedding: "Wedding", reunion: "Reunion", conference: "Conference", custom: "Custom" }[settings.event_type] || "Custom";
      const label = (names, fallback) => planningName(names || {}) || T(fallback);
      host.classList.add("compact-saved-view");
      rows(host, [
        ["Event type", T(type)],
        ["Groups", (config.groups || []).map(group => planningName(group.names || {}) || group.id).join(" · ")],
        ["Labels", [label(config.labels?.households, "Households"), label(config.labels?.guests, "Guests")].join(" · ")],
      ]);
    }
    function features(host) {
      const settings = getStore().settings || {};
      host.classList.add("compact-saved-view");
      rows(host, [
        ["Food", settings.food_enabled === false ? T("Disabled") : T(settings.food_stage === "selection" ? "interface.messages.food_stage_selection" : "interface.messages.food_stage_interest")],
        ["Other tasks", T(settings.other_enabled === false ? "Disabled" : "Enabled")],
      ]);
    }
    function apply() {
      const callbacks = [
        [$("eventSettingsForm"), event],
        [$("planningConfigHost")?.querySelector("form"), planning],
        [$("eventFeaturesHost")?.querySelector("form"), features],
      ];
      for (const [form, render] of callbacks) if (form) form.renderReadSummary = render;
      // Read-only planning has no form or local editor, but uses the same facts.
      const planningHost = $("planningConfigHost");
      if (planningHost && !planningHost.querySelector("form")) {
        const summary = planningHost.querySelector(".planning-summary");
        if (summary) { summary.replaceChildren(); planning(summary); }
      }
    }
    return { apply };
  }
  window.RSVP_ADMIN_READ_SUMMARIES = Object.freeze({ create });
})();
