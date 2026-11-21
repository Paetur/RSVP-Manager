// Compact saved-value views only. Editors, drafts and writes remain controller-owned.
(function () {
  "use strict";
  function create({ R, T, getStore, adminTime, planningName }) {
    const $ = R.byId;
    let contactOpen = false;
    const locale = () => window.RSVP_I18N?.locale?.() || "en-GB";
    const language = () => window.RSVP_I18N?.language || "en";
    const value = input => input === null || input === undefined || input === "" ? "—" : String(input);
    function date(input) {
      if (!input) return "";
      try { return R.formatDate(input, language(), getStore().settings?.timezone); }
      catch (_) { return value(input); }
    }
    function clock(input) {
      if (!input) return "";
      const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(input);
      if (!match) return value(input);
      try {
        return new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", timeZone: "UTC", ...R.timeOptions() })
          .format(new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))));
      } catch (_) { return value(input); }
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
        ["Organizer", settings.organizer_name],
        ["Food deadline", stamp(settings.food_deadline)],
        ["Timezone", settings.timezone],
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
    function selected(id) {
      const control = $(id);
      return control?.selectedOptions?.[0]?.textContent || control?.value || "—";
    }
    function personal(host) {
      host.classList.add("compact-saved-view");
      rows(host, [
        ["Language", T({ en: "English", de: "German", fo: "Faroese" }[$("interfaceLanguage")?.value] || selected("interfaceLanguage"))],
        ["Appearance", selected("themePreference")],
        ["Time format", selected("timeFormat")],
        ["Button hover appearance", selected("buttonHover")],
      ]);
    }
    function grouping(host) {
      host.classList.add("compact-saved-view");
      const grouping = $("inviteGroupBy")?.querySelector("input:checked")?.value || "relational";
      const labels = { none: "None", relational: "Relational group", service: "Service" };
      const shown = [...($("inviteDefaultFields")?.querySelectorAll("[data-invite-default-field]:checked") || [])]
        .map(input => input.nextElementSibling?.textContent).filter(Boolean);
      const columns = [...($("inviteDefaultFields")?.querySelectorAll('[data-invite-default-layout="2"] input:checked') || [])]
        .map(input => [...input.nextElementSibling.children].map(node => node.textContent).join(" / ")).filter(Boolean);
      rows(host, [
        ["Group by", T(labels[grouping])],
        [T("Default shown fields") + " · " + T("Rows") + " 1", shown.join(" · ") || T("None selected")],
        [T("Default shown fields") + " · " + T("Rows") + " 2", columns.join(" · ")],
      ]);
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
        [$("personalPreferencesForm"), personal],
        [$("invitesAppearanceForm"), grouping],
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
