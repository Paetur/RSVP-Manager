(function () {
  "use strict";
  const fields = {
    language: "rsvp_interface_language",
    appearance: "rsvp_interface_appearance",
    time: "rsvp_interface_time_format",
    hover: "rsvp_interface_button_hover",
    grouped: "rsvp_invites_grouped",
    shownFields: "rsvp_invites_shown_fields",
    twoRowColumns: "rsvp_invites_two_row_columns",
  };
  const invitesFields = Object.freeze([
    ["householdInfo", "Household info"],
    ["recipient", "Recipient"],
    ["serviceInfo", "Service"],
    ["delivery", "Invitation"],
    ["lastSent", "Last sent"],
    ["reply", "RSVP"],
    ["replyInfo", "RSVP info"],
    ["food", "Food"],
  ].map(field => Object.freeze(field)));
  const invitesColumnGroups = Object.freeze([
    ["serviceInfo", "Service", ["serviceInfo", "recipient"]],
    ["delivery", "Invitation", ["delivery", "lastSent"]],
    ["reply", "RSVP", ["reply", "replyInfo"]],
    ["food", "Food", ["food"]],
  ].map(([key, label, members]) => Object.freeze([key, label, Object.freeze(members)])));
  const invitesRequiredFields = Object.freeze(["serviceInfo", "delivery"]);
  const defaultInvitesShownFields = Object.freeze(["recipient", "serviceInfo", "delivery", "lastSent", "reply", "replyInfo", "food"]);
  const defaultInvitesTwoRowColumns = Object.freeze(invitesColumnGroups.map(([key]) => key));
  const inviteGroupingChoices = [
    ["none", "None", false],
    ["relational", "Relational group", true],
    ["service", "Service", "service"],
  ];
  const inviteFieldKeys = new Set(invitesFields.map(([key]) => key));
  const inviteColumnKeys = new Set(defaultInvitesTwoRowColumns);
  const controlIds = {
    language: "interfaceLanguage",
    appearance: "themePreference",
    time: "timeFormat",
    hover: "buttonHover",
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
  const invitesKinds = ["grouped", "shownFields", "twoRowColumns"];
  const kindsFor = node => node === invitesForm() ? invitesKinds : personalKinds;
  function valid(kind, value) {
    if (kind === "shownFields") return Array.isArray(value) && new Set(value).size === value.length && value.every(key => inviteFieldKeys.has(key));
    if (kind === "twoRowColumns") return Array.isArray(value) && new Set(value).size === value.length && value.every(key => inviteColumnKeys.has(key));
    if (kind === "grouped") return typeof value === "boolean" || value === "service";
    return kind === "language"
      ? window.RSVP_I18N.enabled(value)
      : (kind === "appearance"
          ? ["system", "light", "dark"]
          : kind === "hover" ? ["toolbar", "pencil", "create"] : ["locale", "12", "24"]
        ).includes(value);
  }
  function groupingMode(value) {
    return value === false ? "none" : value === "service" ? "service" : "relational";
  }
  function normalizeShownFields(value) {
    const selected = new Set([...(valid("shownFields", value) ? value : defaultInvitesShownFields), ...invitesRequiredFields]);
    return invitesFields.filter(([key]) => selected.has(key)).map(([key]) => key);
  }
  function copyValue(kind, value) {
    if (kind === "shownFields") return normalizeShownFields(value);
    if (kind === "twoRowColumns") {
      const selected = new Set([...(valid(kind, value) ? value : defaultInvitesTwoRowColumns), ...invitesRequiredFields]);
      return invitesColumnGroups.filter(([key]) => selected.has(key)).map(([key]) => key);
    }
    return value;
  }
  function copyPreferences(values) {
    return Object.fromEntries(Object.entries(values).map(([kind, value]) => [kind, copyValue(kind, value)]));
  }
  function sameValue(kind, a, b) {
    return ["shownFields", "twoRowColumns"].includes(kind)
      ? a.length === b.length && a.every((value, index) => value === b[index])
      : a === b;
  }
  function preferences(user) {
    const metadata = user?.user_metadata || {};
    return Object.fromEntries(
      Object.keys(fields).map((kind) => {
        const value = metadata[fields[kind]];
        return [
          kind,
          valid(kind, value)
            ? copyValue(kind, value)
            : {
                language: window.RSVP_I18N.defaultLanguage,
                appearance: "system",
                time: "locale",
                hover: "toolbar",
                grouped: true,
                shownFields: defaultInvitesShownFields.slice(),
                twoRowColumns: defaultInvitesTwoRowColumns.slice(),
              }[kind],
        ];
      }),
    );
  }
  function changes(kinds = Object.keys(fields)) {
    return baseline && draft
      ? Object.fromEntries(
          Object.entries(draft).filter(
            ([kind, value]) => kinds.includes(kind) && !sameValue(kind, value, baseline[kind]),
          ).map(([kind, value]) => [kind, copyValue(kind, value)]),
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
    if (groupingSave) groupingSave.disabled = busy || !account || !hasUnsaved(invitesKinds);
    for (const node of [form(), invitesForm()]) node?.setAttribute("aria-busy", String(busy));
    for (const button of form()?.querySelectorAll("[data-preference-choice]") || []) button.disabled = busy || !account;
    for (const host of [element("inviteGroupBy"), element("inviteDefaultFields")])
      for (const input of host?.querySelectorAll("input") || []) input.disabled = busy || !account || input.hasAttribute("data-invite-fixed-field") || input.hasAttribute("data-invite-fixed-column");
  }
  function renderDraft() {
    if (draft)
      for (const [kind, id] of Object.entries(controlIds)) {
        const node = element(id);
        if (node) node.value = draft[kind];
      }
    syncInviteGrouping();
    syncInviteDefaultFields();
    updateControls();
    syncChoices();
  }
  function syncInviteGrouping() {
    const host = element("inviteGroupBy");
    if (!host) return;
    for (const [key, label, value] of inviteGroupingChoices) {
      let input = host.querySelector('[data-invite-grouping="' + key + '"]');
      if (!input) {
        const option = window.RSVP.dom("label", { class: "checkbox-label" });
        input = window.RSVP.dom("input", { type: "radio", name: "inviteGrouping", value: key });
        input.dataset.inviteGrouping = key;
        input.addEventListener("change", () => {
          if (input.checked && !stage("grouped", value)) renderDraft();
        });
        option.append(input, window.RSVP.dom("span"));
        host.append(option);
      }
      input.nextElementSibling.textContent = T(label);
      input.checked = input.value === groupingMode(draft?.grouped);
    }
  }
  function syncInviteDefaultFields() {
    const host = element("inviteDefaultFields");
    if (!host) return;
    const R = window.RSVP;
    for (const layout of ["1", "2"]) {
      let group = host.querySelector('[data-invite-default-layout="' + layout + '"]');
      if (!group) {
        group = R.dom("fieldset", { class: "invite-default-layout" });
        group.dataset.inviteDefaultLayout = layout;
        group.append(R.dom("legend"));
        host.append(group);
      }
      group.querySelector("legend").textContent = T("Rows") + " " + layout;
    }
    const oneRowHost = host.querySelector('[data-invite-default-layout="1"]');
    const twoRowHost = host.querySelector('[data-invite-default-layout="2"]');
    for (const [key, label] of invitesFields) {
      const fixed = invitesRequiredFields.includes(key);
      let input = oneRowHost.querySelector('[data-invite-default-field="' + key + '"]');
      if (!input) {
        const option = window.RSVP.dom("label", { class: "checkbox-label" });
        input = window.RSVP.dom("input", { type: "checkbox" });
        input.dataset.inviteDefaultField = key;
        if (fixed) input.dataset.inviteFixedField = key;
        else input.addEventListener("change", () => {
            const selected = new Set(draft?.shownFields || defaultInvitesShownFields);
            if (input.checked) selected.add(key); else selected.delete(key);
            if (!stage("shownFields", normalizeShownFields([...selected]))) renderDraft();
          });
        option.append(input, window.RSVP.dom("span"));
        oneRowHost.append(option);
      }
      input.nextElementSibling.textContent = T(label);
      input.checked = (draft?.shownFields || defaultInvitesShownFields).includes(key);
      input.disabled = fixed;
    }
    const groupOptions = [["household", "Household", ["householdInfo"]], ...invitesColumnGroups];
    for (const [key, label, members] of groupOptions) {
      const fixed = key === "household" || invitesRequiredFields.includes(key);
      let input = twoRowHost.querySelector(fixed ? '[data-invite-fixed-column="' + key + '"]' : '[data-invite-default-column="' + key + '"]');
      if (!input) {
        const option = R.dom("label", { class: "checkbox-label" });
        input = R.dom("input", { type: "checkbox" });
        if (fixed) input.dataset.inviteFixedColumn = key;
        else {
          input.dataset.inviteDefaultColumn = key;
          input.addEventListener("change", () => {
            const selected = new Set(draft?.twoRowColumns || defaultInvitesTwoRowColumns);
            if (input.checked) selected.add(key); else selected.delete(key);
            if (!stage("twoRowColumns", copyValue("twoRowColumns", [...selected]))) renderDraft();
          });
        }
        option.append(input, R.dom("span", { class: "invite-default-pair-label" }));
        twoRowHost.append(option);
      }
      const labelHost = input.nextElementSibling;
      const secondary = key === "household" ? "Household info" : invitesFields.find(([field]) => field === members[1])?.[1];
      labelHost.replaceChildren(R.dom("span", {}, T(label)));
      if (secondary) labelHost.append(R.dom("small", { class: "muted" }, T(secondary)));
      input.checked = fixed || (draft?.twoRowColumns || defaultInvitesTwoRowColumns).includes(key);
      input.disabled = fixed;
    }
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
    draft[kind] = copyValue(kind, value);
    status("", "", invitesKinds.includes(kind) ? invitesForm() : form());
    renderDraft();
    return true;
  }
  async function commit(patch) {
    if (busy || !account || !Object.keys(patch).length) return false;
    const ticket = generation,
      id = account.id,
      target = invitesKinds.some(kind => Object.hasOwn(patch, kind)) ? invitesForm() : form();
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
          Object.entries(patch).map(([kind, value]) => [fields[kind], copyValue(kind, value)]),
        ),
      });
      if (result.error) throw result.error;
      if (ticket !== generation) return false;
      if (result.data?.user?.id !== id) throw new Error("Account changed");
      account = result.data.user;
      baseline = { ...baseline, ...copyPreferences(patch) };
      draft = { ...draft, ...copyPreferences(patch) };
      await apply(baseline, ticket);
      if (ticket !== generation) return false;
      if (Object.hasOwn(patch, "time"))
        document.dispatchEvent(new Event("rsvp:time-format"));
      if (invitesKinds.some(kind => Object.hasOwn(patch, kind))) document.dispatchEvent(new Event("rsvp:invites-appearance"));
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
    for (const kind of kindsFor(target)) draft[kind] = copyValue(kind, baseline[kind]);
    window.RSVP_I18N.markClean(target);
    status("", "", target);
    renderDraft();
  }
  window.RSVP_ADMIN_PREFERENCES = {
    get timeFormat() {
      return timePreference;
    },
    get invitesGrouped() { return baseline?.grouped !== false; },
    get invitesGrouping() { return groupingMode(baseline?.grouped); },
    get invitesFields() { return invitesFields; },
    get invitesColumnGroups() { return invitesColumnGroups; },
    get invitesRequiredFields() { return invitesRequiredFields; },
    get defaultInvitesShownFields() { return defaultInvitesShownFields; },
    get invitesShownFields() { return (baseline?.shownFields || defaultInvitesShownFields).slice(); },
    get invitesTwoRowColumns() { return (baseline?.twoRowColumns || defaultInvitesTwoRowColumns).slice(); },
    hasUnsaved,
    stage,
    cancel: () => cancel(),
    async load(user) {
      const ticket = ++generation;
      account = user;
      baseline = preferences(user);
      draft = copyPreferences(baseline);
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
      renderDraft();
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
    syncInviteGrouping();
    syncInviteDefaultFields();
    updateControls();
  });
})();
