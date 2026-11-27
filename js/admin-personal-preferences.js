(function () {
  "use strict";
  const fields = {
    language: "rsvp_interface_language",
    appearance: "rsvp_interface_appearance",
    date: "rsvp_interface_date_format",
    time: "rsvp_interface_time_format",
    hover: "rsvp_interface_button_hover",
    grouped: "rsvp_invites_grouped",
    showText: "rsvp_invites_show_text",
    invitesProfiles: "rsvp_invites_profiles",
    shownFields: "rsvp_invites_shown_fields",
    twoRowColumns: "rsvp_invites_two_row_columns",
    narrowRows: "rsvp_invites_narrow_rows",
    wideRows: "rsvp_invites_wide_rows",
    overviewLayout: "rsvp_overview_layout",
  };
  const legacyOverviewGroups = [
    ["information", ["households", "food", "rsvp"]],
    ["invitation", ["invites", "services", "language"]],
  ];
  const legacyOverviewTabs = new Map(legacyOverviewGroups.flatMap(([tab, ids]) => ids.map(id => [id, tab])));
  const defaultOverviewOrder = ["households", "invites", "rsvp", "food", "services", "language"];
  const invitesFields = Object.freeze([
    ["householdInfo", "Household info"],
    ["recipient", "Recipient"],
    ["serviceInfo", "Service"],
    ["delivery", "Invitation"],
    ["reply", "RSVP"],
    ["food", "Food"],
  ].map(field => Object.freeze(field)));
  const invitesColumnGroups = Object.freeze([
    ["serviceInfo", "Service", ["serviceInfo", "recipient"]],
    ["delivery", "Invitation", ["delivery"]],
    ["reply", "RSVP", ["reply"]],
    ["food", "Food", ["food"]],
  ].map(([key, label, members]) => Object.freeze([key, label, Object.freeze(members)])));
  const invitesRequiredFields = Object.freeze(["serviceInfo", "delivery"]);
  const defaultInvitesShownFields = Object.freeze(["recipient", "serviceInfo", "delivery", "reply", "food"]);
  const defaultInvitesTwoRowColumns = Object.freeze(invitesColumnGroups.map(([key]) => key));
  const invitesDefaultsKey = "rsvp_invites_defaults";
  const inviteScreens = [
    ["phone", "Phone screen (below 512 px)", 2, "narrowRows"],
    ["tablet", "Tablet screen (512–1023 px)", 1, "narrowRows"],
    ["desktop", "Desktop screen (1024 px and wider)", 2, "wideRows"],
  ];
  const shownFieldsWithoutRecipient = defaultInvitesShownFields.filter(key => key !== "recipient");
  const freshInvitesProfiles = {
    phone: { rows: 1, showActions: false },
    tablet: {
      rows: 2,
      shownFields: shownFieldsWithoutRecipient,
      showActions: false,
      showInlineActions: true,
      expandedFields: [],
    },
    desktop: { shownFields: shownFieldsWithoutRecipient },
  };
  const inviteExpandedFields = invitesFields.filter(([key]) => ["householdInfo", "recipient", "reply", "food"].includes(key));
  const inviteSecondLines = {
    household: "Household info", serviceInfo: "Recipient", delivery: "Last sent / last visit", reply: "Food",
  };
  const inviteGroupingChoices = [
    ["none", "Alphabetic", false],
    ["relational", "Relational", true],
    ["service", "Service", "service"],
  ];
  // Silently drop retired fields when reading a saved layout that used them.
  const inviteFieldKeys = new Set([...invitesFields.map(([key]) => key), "lastSent", "replyInfo"]);
  const inviteColumnKeys = new Set(defaultInvitesTwoRowColumns);
  const controlIds = {
    language: "interfaceLanguage",
    appearance: "themePreference",
    date: "dateFormat",
    time: "timeFormat",
    hover: "buttonHover",
  };
  const dateFormats = ["locale", "short", "dots", "iso"];
  const sampleDate = "2026-11-24";
  const sampleDateBounds = { min: "0001-01-01", max: "9999-12-31" };
  const datePickerSelector = "input[type=date],input[type=datetime-local],input[type=time],input[data-clock-source]";
  const deviceHourCycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
  let account = null,
    baseline = null,
    draft = null,
    invitesDefaults = null,
    busy = false,
    generation = 0,
    timePreference = "locale",
    pickerPreviewId = 0,
    overviewCards = new Map(),
    settingsIconAction,
    draggedOverviewId = null,
    inviteScreen = "phone";
  const T = (...args) => window.RSVP_I18N.t(...args);
  const element = (id) => document.getElementById(id);
  const form = () => element("personalPreferencesForm");
  const invitesForm = () => element("invitesAppearanceForm");
  const overviewForm = () => element("overviewAppearanceForm");
  const preferenceForms = () => [form(), invitesForm(), overviewForm()].filter(Boolean);
  const invitesKinds = ["grouped", "showText", "invitesProfiles"];
  const interfaceKinds = Object.keys(controlIds);
  const overviewKinds = ["overviewLayout"];
  const kindsFor = node => node === overviewForm() ? overviewKinds : node === invitesForm() ? invitesKinds : interfaceKinds;
  const formFor = kind => overviewKinds.includes(kind) ? overviewForm() : invitesKinds.includes(kind) ? invitesForm() : form();
  function valid(kind, value) {
    if (kind === "overviewLayout") return Array.isArray(value);
    if (kind === "invitesProfiles") return value && typeof value === "object" && !Array.isArray(value);
    if (kind === "shownFields") return Array.isArray(value) && new Set(value).size === value.length && value.every(key => inviteFieldKeys.has(key));
    if (kind === "twoRowColumns") return Array.isArray(value) && new Set(value).size === value.length && value.every(key => inviteColumnKeys.has(key));
    if (kind === "grouped") return typeof value === "boolean" || value === "service";
    if (kind === "showText") return typeof value === "boolean";
    if (kind === "narrowRows" || kind === "wideRows") return value === 1 || value === 2;
    if (kind === "date") return dateFormats.includes(value);
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
  function inviteScreenFields(screen, rows) {
    if (rows === 1) return invitesFields;
    const columns = invitesColumnGroups.filter(([key]) => key !== "food");
    return screen === "phone" ? [["householdInfo", "Household info"], ...columns] : columns;
  }
  function inviteFieldRequired(screen, key) {
    return invitesRequiredFields.includes(key) && (screen !== "phone" || key === "delivery");
  }
  function normalizeInvitesProfiles(value, legacy = {}) {
    // Older saved layouts still use their original fallbacks for omitted fields.
    const fallbackProfiles = Object.keys(legacy).length ? {} : freshInvitesProfiles;
    const profiles = valid("invitesProfiles", value) ? value : fallbackProfiles;
    const legacyTwoRow = legacy.twoRowColumns;
    // The old Food column is now part of RSVP. Keep it visible for accounts that had selected it.
    const twoRowFallback = legacyTwoRow?.includes("food") ? [...legacyTwoRow, "reply"] : legacyTwoRow;
    return Object.fromEntries(inviteScreens.map(([screen, , defaultRows, legacyRows]) => {
      const saved = profiles[screen];
      function shown(kind, rows, fallback) {
        // An explicitly saved Phone profile may opt into more fields than the compact default.
        const fields = Array.isArray(saved?.[kind]) ? saved[kind] :
          screen === "phone" ? fallback.filter(key => key === "delivery" || key === "reply") : fallback;
        return inviteScreenFields(screen, rows).flatMap(([key]) =>
          inviteFieldRequired(screen, key) || fields.includes(key) ? [key] : []);
      }
      return [screen, {
        rows: valid(legacyRows, saved?.rows) ? saved.rows : legacy[legacyRows] ?? defaultRows,
        shownFields: shown("shownFields", 1, legacy.shownFields ?? defaultInvitesShownFields),
        twoRowColumns: shown("twoRowColumns", 2, twoRowFallback ?? defaultInvitesTwoRowColumns),
        showActions: typeof saved?.showActions === "boolean" ? saved.showActions : true,
        ...(screen === "tablet" ? { showInlineActions: saved?.showInlineActions === true } : {}),
        expandedFields: screen === "desktop" ? [] : inviteExpandedFields.flatMap(([key]) =>
          !Array.isArray(saved?.expandedFields) || saved.expandedFields.includes(key) ? [key] : []),
      }];
    }));
  }
  function normalizeOverviewLayout(value) {
    const saved = Array.isArray(value) ? value : [];
    const cards = new Map();
    const legacyGroups = new Map();
    const hasHouseholds = saved.some(item => item?.id === "households" && typeof item.shown === "boolean");
    for (const item of saved) {
      // Preserve the existing Households choice when both old cards were saved.
      const id = !hasHouseholds && item?.id === "guests" ? "households" : item?.id;
      if (legacyOverviewTabs.has(id) && typeof item.shown === "boolean" && !cards.has(id)) {
        cards.set(id, { id, shown: item.shown });
        if (item.tab === "information" || item.tab === "invitation") legacyGroups.set(id, item.tab);
      }
    }
    const fallbackOrder = legacyGroups.size ? legacyOverviewTabs.keys() : defaultOverviewOrder;
    for (const id of fallbackOrder) if (!cards.has(id)) cards.set(id, { id, shown: true });
    const order = [...cards.values()];
    // Explicit group assignments identify an older layout. Read those cards in the
    // original visual order, then use one flat order for any later saves.
    return legacyGroups.size ? legacyOverviewGroups.flatMap(([tab]) =>
      order.filter(({ id }) => (legacyGroups.get(id) || legacyOverviewTabs.get(id)) === tab)) : order;
  }
  function copyValue(kind, value) {
    if (kind === "shownFields") return normalizeShownFields(value);
    if (kind === "overviewLayout") return normalizeOverviewLayout(value);
    if (kind === "invitesProfiles") return normalizeInvitesProfiles(value);
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
    if (kind === "overviewLayout")
      return a.every(({ id, shown }, index) => id === b[index].id && shown === b[index].shown);
    if (kind === "invitesProfiles") return JSON.stringify(a) === JSON.stringify(b);
    return ["shownFields", "twoRowColumns"].includes(kind)
      ? a.length === b.length && a.every((value, index) => value === b[index])
      : a === b;
  }
  function preferences(user) {
    const metadata = user?.user_metadata || {};
    const values = Object.fromEntries(
      Object.keys(fields).filter(kind => kind !== "invitesProfiles").map((kind) => {
        const value = metadata[fields[kind]];
        return [
          kind,
          valid(kind, value)
            ? copyValue(kind, value)
            : {
                language: window.RSVP_I18N.defaultLanguage,
                appearance: "system",
                date: "locale",
                time: "locale",
                hover: "toolbar",
                grouped: true,
                showText: true,
                shownFields: defaultInvitesShownFields.slice(),
                twoRowColumns: defaultInvitesTwoRowColumns.slice(),
                narrowRows: 1,
                wideRows: 2,
                overviewLayout: normalizeOverviewLayout(),
              }[kind],
        ];
      }),
    );
    const legacy = Object.fromEntries(
      ["shownFields", "twoRowColumns", "narrowRows", "wideRows"]
        .filter(kind => valid(kind, metadata[fields[kind]]))
        .map(kind => [kind, values[kind]]),
    );
    values.invitesProfiles = normalizeInvitesProfiles(metadata[fields.invitesProfiles], legacy);
    return values;
  }
  function copyInvitesAppearance(values) {
    return Object.fromEntries(invitesKinds.map(kind => [kind, copyValue(kind, values[kind])]));
  }
  function storedInvitesDefaults(user) {
    const defaults = user?.user_metadata?.[invitesDefaultsKey];
    return defaults && invitesKinds.every(kind => valid(kind, defaults[kind])) ? copyInvitesAppearance(defaults) : null;
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
    const node = target?.querySelector(".form-feedback[role=status]");
    if (!node) return;
    node.textContent = text;
    node.dataset.state = state;
    node.hidden = !text;
  }
  function updateControls() {
    for (const id of [
      ...Object.values(controlIds),
      "inviteShowText",
      "themeToggle",
      "logout",
      "cancelPersonalPreferences",
      "cancelInvitesAppearance",
      "cancelOverviewAppearance",
    ]) {
      const node = element(id);
      if (node) node.disabled = busy || !account;
    }
    const save = element("savePersonalPreferences");
    if (save) save.disabled = busy || !account || !hasUnsaved(interfaceKinds);
    const invitesSave = element("saveInvitesAppearance"), resetInvites = element("resetInvitesAppearance");
    if (invitesSave) invitesSave.disabled = busy || !account || !hasUnsaved(invitesKinds);
    if (resetInvites) resetInvites.disabled = busy || !invitesDefaults ||
      invitesKinds.every(kind => sameValue(kind, draft[kind], invitesDefaults[kind]));
    const sample = element("interfaceSampleDate");
    if (sample) sample.disabled = busy || !account;
    const overviewSave = element("saveOverviewAppearance"), reset = element("resetOverviewAppearance");
    if (overviewSave) overviewSave.disabled = busy || !account || !hasUnsaved(overviewKinds);
    if (reset) reset.disabled = busy || !account || !draft ||
      sameValue("overviewLayout", draft.overviewLayout, normalizeOverviewLayout());
    for (const node of preferenceForms()) node.setAttribute("aria-busy", String(busy));
    for (const button of overviewForm()?.querySelectorAll("#overviewCardOrder button,#overviewCardOrder input") || [])
      button.disabled = busy || !account;
    for (const grip of overviewForm()?.querySelectorAll("[data-overview-grip]") || [])
      grip.draggable = !busy && !!account;
    for (const button of form()?.querySelectorAll("[data-preference-choice]") || []) button.disabled = busy || !account;
    for (const id of ["inviteGroupBy", "inviteRowsPreference", "inviteDefaultFields", "inviteExpandedPreferences"]) {
      const fieldset = element(id);
      if (fieldset) fieldset.disabled = busy || !account;
    }
    for (const tab of element("inviteScreenTabs")?.querySelectorAll("button") || []) tab.disabled = busy || !account;
  }
  function renderDraft() {
    syncDateTimeControls();
    if (draft)
      for (const [kind, id] of Object.entries(controlIds)) {
        const node = element(id);
        if (node) node.value = draft[kind];
      }
    syncInviteGrouping();
    syncInviteScreen();
    const showText = element("inviteShowText");
    if (showText) showText.checked = draft?.showText ?? true;
    renderOverviewLayout();
    updateControls();
    syncChoices();
    renderDateTimeExample();
  }
  function canMoveOverviewCard(id, target) {
    return !busy && !!account && id !== target && overviewCards.has(id) && overviewCards.has(target);
  }
  function moveOverviewCard(id, target, after) {
    if (!draft || !canMoveOverviewCard(id, target)) return;
    const layout = draft.overviewLayout;
    const moved = layout.find(card => card.id === id);
    const available = card => overviewCards.has(card.id);
    const eligible = layout.filter(card => available(card) && card.id !== id);
    eligible.splice(eligible.findIndex(card => card.id === target) + Number(after), 0, moved);
    // Keep permission-hidden cards in their slots while reordering visible settings.
    let next = 0;
    stage("overviewLayout", layout.map(card => available(card) ? eligible[next++] : card));
  }
  function clearOverviewDropHint(host) {
    host.querySelector("[data-overview-drop]")?.removeAttribute("data-overview-drop");
  }
  function showOverviewMoves(id, label, trigger, moves) {
    const key = "overview-card-reorder";
    if (busy || !account || window.RSVP_POPUPS.get(key)) return;
    const R = window.RSVP, ticket = generation;
    const focusSelector = '[data-overview-setting="' + id + '"] [data-overview-grip]:enabled';
    const dialog = window.RSVP_POPUPS.create(key, { class: "overview-appearance-popup" }, trigger);
    const heading = R.dom("h2", { id: key + "-heading" }, label);
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.addEventListener("close", () => {
      if (!trigger.isConnected) overviewForm()?.querySelector(focusSelector)?.focus({ preventScroll: true });
    });
    const actions = R.dom("div", { class: "form-actions" });
    for (const { caption, move } of moves) {
      const button = R.dom("button", { type: "button", class: "btn secondary" }, caption);
      button.addEventListener("click", () => {
        if (generation === ticket && trigger.isConnected) move();
        dialog.close();
      });
      actions.append(button);
    }
    const cancel = R.dom("button", { type: "button", class: "btn secondary" }, T("Cancel"));
    cancel.addEventListener("click", () => dialog.close());
    actions.append(cancel);
    dialog.append(heading, actions);
    element("adminApp").append(dialog);
    dialog.openInline();
  }
  function renderOverviewLayout() {
    const host = element("overviewCardOrder");
    if (!host) return;
    host.closest("[data-settings-card]").hidden = !overviewCards.size;
    const active = document.activeElement, activeRow = active?.closest("[data-overview-setting]");
    const activeId = host.contains(activeRow) ? activeRow.dataset.overviewSetting : null;
    const activeGrip = active?.hasAttribute("data-overview-grip");
    const R = window.RSVP;
    const layout = draft?.overviewLayout || normalizeOverviewLayout();
    const eligible = layout.filter(card => overviewCards.has(card.id));
    draggedOverviewId = null;
    host.replaceChildren();
    for (const [index, { id, shown }] of eligible.entries()) {
      const label = overviewCards.get(id);
      const row = R.dom("li", { class: "overview-card-setting" });
      const cardLabel = R.dom("span", { class: "overview-card-label" }, label);
      row.dataset.overviewSetting = id;
      const gripTitle = T("Drag to reorder") + " · " + label;
      const grip = R.dom("button", { type: "button", class: "overview-card-grip", title: gripTitle }, "⠿");
      grip.dataset.overviewGrip = "";
      grip.setAttribute("aria-label", gripTitle);
      grip.setAttribute("aria-haspopup", "dialog");
      grip.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
      grip.draggable = !busy && !!account;
      const moves = [];
      for (const [key, offset, caption] of [["ArrowUp", -1, "Move up"], ["ArrowDown", 1, "Move down"]]) {
        const neighbor = eligible[index + offset];
        if (!neighbor) continue;
        moves.push({
          key,
          caption: T(caption),
          move: () => moveOverviewCard(id, neighbor.id, offset > 0),
        });
      }
      grip.addEventListener("click", () => showOverviewMoves(id, label, grip, moves));
      grip.addEventListener("keydown", event => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        moves.find(({ key }) => key === event.key)?.move();
      });
      grip.addEventListener("dragstart", event => {
        draggedOverviewId = id;
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
      });
      grip.addEventListener("dragend", () => {
        draggedOverviewId = null;
        clearOverviewDropHint(host);
      });
      const afterPointer = event => {
        const box = row.getBoundingClientRect();
        return event.clientY >= box.top + box.height / 2;
      };
      row.addEventListener("dragover", event => {
        clearOverviewDropHint(host);
        if (!canMoveOverviewCard(draggedOverviewId, id)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        row.dataset.overviewDrop = afterPointer(event) ? "after" : "before";
      });
      row.addEventListener("dragleave", event => {
        if (!(event.relatedTarget instanceof Node) || !row.contains(event.relatedTarget))
          row.removeAttribute("data-overview-drop");
      });
      row.addEventListener("drop", event => {
        if (!draggedOverviewId) return;
        event.preventDefault();
        const source = draggedOverviewId;
        draggedOverviewId = null;
        clearOverviewDropHint(host);
        moveOverviewCard(source, id, afterPointer(event));
      });
      const choice = R.dom("label", { class: "checkbox-label overview-card-visibility" });
      const input = R.dom("input", { type: "checkbox" });
      input.checked = shown;
      input.disabled = busy || !account;
      input.setAttribute("aria-label", label + " · " + T("Shown"));
      input.addEventListener("change", () => stage("overviewLayout", layout.map(card =>
        card.id === id ? { ...card, shown: input.checked } : card)));
      choice.append(input);
      row.append(grip, cardLabel, choice);
      host.append(row);
    }
    const replacement = activeId && host.querySelector('[data-overview-setting="' + activeId + '"]');
    replacement?.querySelector(activeGrip ? "[data-overview-grip]:enabled" : "input:enabled")?.focus({ preventScroll: true });
  }
  function setOverviewCards(cards, iconAction) {
    if (settingsIconAction !== iconAction) {
      settingsIconAction = iconAction;
      syncInviteScreen();
    }
    const available = new Map(cards.filter(({ id }) => legacyOverviewTabs.has(id)).map(({ id, label }) => [id, label]));
    if (available.size === overviewCards.size && [...available].every(([id, label]) => overviewCards.get(id) === label)) return;
    overviewCards = available;
    renderOverviewLayout();
    updateControls();
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
  function syncInviteCheckboxes(host, dataset, choices) {
    const R = window.RSVP;
    const signature = choices.map(([key]) => key).join(" ");
    if (host.dataset.fields !== signature) {
      host.replaceChildren(...choices.map(([key]) => {
        const label = R.dom("label", { class: "checkbox-label" });
        const input = R.dom("input", { type: "checkbox" });
        input.dataset[dataset] = key;
        label.append(input, R.dom("span", { class: "invite-default-pair-label" }));
        return label;
      }));
      host.dataset.fields = signature;
    }
    choices.forEach(([, label, checked, fixed, secondary], index) => {
      const [input, text] = host.children[index].children;
      input.checked = checked;
      input.disabled = fixed;
      text.replaceChildren(R.dom("span", {}, T(label)));
      if (secondary) text.append(R.dom("small", { class: "muted" }, T(secondary)));
    });
  }
  function renderInviteAppearanceSample(profile, visible) {
    const R = window.RSVP;
    const sample = element("inviteAppearanceSample");
    sample.dataset.screen = inviteScreen;
    sample.dataset.rows = String(profile.rows);
    const desktop = inviteScreen === "desktop";
    const paired = profile.rows === 2;
    const rows = R.dom("div", { class: "invite-appearance-sample-grid" });
    const extras = R.dom("div", { class: "invite-appearance-sample-grid invite-appearance-sample-extras" });
    const expanded = R.dom("dl", { class: "invite-appearance-sample-facts" });
    const names = new Map([["household", "Household"], ...invitesFields]);
    const food = new Intl.NumberFormat(window.RSVP_I18N.locale()).format(2);
    const previewValues = {
      household: "Linden",
      householdInfo: T("interface.messages.count_guests", { count: 3 }) + " · EN",
      recipient: "Alex Linden",
      serviceInfo: T("WhatsApp"),
      delivery: T("Ready"),
      reply: T("Awaiting reply"),
      food,
    };
    const secondary = paired ? {
      household: inviteScreen !== "phone" || visible.includes("householdInfo") ? previewValues.householdInfo : "",
      serviceInfo: previewValues.recipient,
      reply: T("interface.messages.invites_food_answer", { answer: food }),
    } : {};
    for (const key of ["household", ...visible]) {
      if (paired && key === "householdInfo") continue;
      const cell = R.dom("div", { class: "invite-appearance-sample-field" });
      cell.dataset.inviteSampleField = key;
      cell.append(R.dom("strong", {}, T(names.get(key))));
      if (key === "delivery") {
        const chips = R.dom("span", { class: "invite-appearance-sample-chips" });
        chips.append(R.dom("span", { class: "invite-copy-pill" }, previewValues.delivery));
        if (draft?.showText ?? true) chips.append(R.dom("span", { class: "invite-copy-pill" }, T("Text")));
        cell.append(chips);
      } else cell.append(R.dom("span", {}, previewValues[key]));
      if (paired && key === "delivery") {
        const sent = "2026-11-24T18:20:00Z", timestamp = formatDate(sent, undefined, "UTC");
        const time = R.dom("time", { class: "muted" }, timestamp);
        time.dateTime = sent;
        time.setAttribute("aria-label", T("Last sent") + " · " + timestamp);
        cell.append(time);
      } else if (secondary[key]) cell.append(R.dom("small", { class: "muted" }, secondary[key]));
      const parent = inviteScreen === "phone" && !["household", "delivery", "reply"].includes(key) ? extras : rows;
      parent.append(cell);
    }
    for (const key of profile.expandedFields) {
      expanded.append(R.dom("dt", {}, T(names.get(key))), R.dom("dd", {}, previewValues[key]));
    }
    function sampleActions(shown) {
      if (!shown || !settingsIconAction) return null;
      const actions = R.dom("div", { class: "invite-appearance-sample-actions" });
      actions.dataset.inviteSampleActions = "";
      actions.append(settingsIconAction("show", T("Guest preview"), null, true),
        settingsIconAction("edit", T("interface.messages.edit"), null, true));
      return actions;
    }
    const inlineActions = sampleActions(desktop ? profile.showActions : paired && profile.showInlineActions);
    const expandedActions = desktop ? null : sampleActions(profile.showActions);
    if (inlineActions) rows.append(inlineActions);
    const grouping = { relational: "Family", service: "WhatsApp" }[groupingMode(draft?.grouped)];
    const grouped = grouping ? R.dom("div", { class: "invite-appearance-sample-group" }, T(grouping)) : null;
    const sampleRow = element("inviteAppearanceSampleRow");
    sampleRow.replaceChildren(...(grouped ? [grouped, rows] : [rows]));
    if (extras.childElementCount) sampleRow.append(extras);
    const expandedContent = [expanded.childElementCount ? expanded : null, expandedActions].filter(Boolean);
    element("inviteAppearanceSampleExpanded").hidden = expandedContent.length === 0;
    element("inviteAppearanceSampleFields").replaceChildren(...expandedContent);
  }
  function syncInviteScreen() {
    const tabs = element("inviteScreenTabs");
    if (!tabs) return;
    const profile = draft?.invitesProfiles[inviteScreen] || normalizeInvitesProfiles()[inviteScreen];
    for (const tab of tabs.querySelectorAll("button")) {
      const active = tab.dataset.inviteScreen === inviteScreen;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) element("inviteScreenPreferences").setAttribute("aria-labelledby", tab.id);
    }
    const [, widthLabel] = inviteScreens.find(([screen]) => screen === inviteScreen);
    element("inviteScreenRange").textContent = T(widthLabel);
    for (const input of element("inviteRowsPreference").querySelectorAll("input")) {
      input.checked = Number(input.value) === profile.rows;
    }
    const columns = profile.rows === 2;
    const visible = columns ? profile.twoRowColumns : profile.shownFields;
    const choices = inviteScreenFields(inviteScreen, profile.rows).map(([key, label]) => [
      key, label, visible.includes(key), inviteFieldRequired(inviteScreen, key), columns && inviteSecondLines[key],
    ]);
    choices.unshift(["household", "Household", true, true, columns && inviteScreen !== "phone" && inviteSecondLines.household]);
    const actions = ["showActions", "Action buttons", profile.showActions, false];
    if (inviteScreen === "desktop") choices.push(actions);
    if (inviteScreen === "tablet" && columns) choices.push(["showInlineActions", "Action buttons", profile.showInlineActions, false]);
    syncInviteCheckboxes(element("inviteShownFieldChoices"), "inviteDefaultField", choices);
    element("inviteExpandedPreferences").hidden = inviteScreen === "desktop";
    const expanded = inviteExpandedFields.map(([key, label]) => [key, label, profile.expandedFields.includes(key), false]);
    expanded.push(actions);
    syncInviteCheckboxes(element("inviteExpandedFieldChoices"), "inviteExpandedField", expanded);
    renderInviteAppearanceSample(profile, visible);
  }
  function stageInviteScreen(patch) {
    const profiles = draft?.invitesProfiles;
    if (!profiles || !stage("invitesProfiles", { ...profiles, [inviteScreen]: { ...profiles[inviteScreen], ...patch } })) {
      syncInviteScreen();
    }
  }
  function stageInviteField(input, key, kind) {
    const selected = new Set(draft?.invitesProfiles[inviteScreen][kind]);
    if (input.checked) selected.add(key);
    else selected.delete(key);
    stageInviteScreen({ [kind]: [...selected] });
  }
  function displayTimeFormat(value) {
    if (value !== "locale") return value;
    return deviceHourCycle === "h11" || deviceHourCycle === "h12" ? "12" : "24";
  }
  function formatDate(value, language, timezone, options = {}) {
    return window.RSVP.formatDate(value, language || window.RSVP_I18N.language, timezone, {
      ...options,
      dateFormat: baseline?.date,
      timeFormat: displayTimeFormat(timePreference),
    });
  }
  function formatClock(value, language) {
    return window.RSVP.formatClock(value, language || window.RSVP_I18N.language, displayTimeFormat(timePreference));
  }
  function dateTimeExample(values = baseline, day = sampleDate) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || day < sampleDateBounds.min || day > sampleDateBounds.max)
      return "";
    const instant = new Date(day + "T18:30:00Z");
    if (!Number.isFinite(instant.getTime()) || !instant.toISOString().startsWith(day + "T")) return "";
    return window.RSVP.formatDate(instant, values?.language || window.RSVP_I18N.language, "UTC", {
      dateFormat: values?.date,
      timeFormat: displayTimeFormat(values?.time || "locale"),
      separator: " · ",
    });
  }
  function renderDateTimeExample() {
    const output = element("interfaceLiveExample");
    if (output) output.textContent = dateTimeExample(draft, element("interfaceSampleDate").value);
  }
  function syncDateTimeControls() {
    const date = element("dateFormat");
    if (date)
      for (const option of date.options) option.textContent = option.value === "locale"
        ? T("Language default")
        : window.RSVP.formatDate(sampleDate, window.RSVP_I18N.language, "UTC", { dateFormat: option.value });
    const time = element("timeFormat");
    if (time)
      for (const option of time.options) option.textContent = T({
        locale: "System default", 12: "12-hour (AM/PM)", 24: "24-hour",
      }[option.value]);
    const sample = element("interfaceSampleDate");
    if (sample) sample.previousElementSibling.textContent = T("Sample date");
    const example = element("interfaceLiveExample");
    if (example) example.previousElementSibling.textContent = T("Example");
  }
  function mountDateTimeControls() {
    const R = window.RSVP;
    const host = element("interfaceDateHost");
    if (host) {
      const select = R.dom("select", { id: "dateFormat" });
      for (const value of dateFormats) select.append(R.dom("option", { value }));
      select.addEventListener("change", () => stage("date", select.value));
      const label = R.dom("label", {}, T("Date format"));
      label.append(select);
      host.append(label);
    }
    const example = element("interfaceDateExample");
    if (example) {
      const input = R.dom("input", { id: "interfaceSampleDate", type: "date", ...sampleDateBounds });
      const label = R.dom("label");
      const result = R.dom("div");
      const output = R.dom("output", { id: "interfaceLiveExample", for: "dateFormat timeFormat interfaceSampleDate" });
      input.value = sampleDate;
      input.addEventListener("input", renderDateTimeExample);
      label.append(R.dom("span"), input);
      result.append(R.dom("span"), output);
      example.append(label, result);
    }
    syncDateTimeControls();
    renderDateTimeExample();
  }
  const clockEditors = new WeakMap();
  function pickerParts(value, hasDate, mode) {
    const [day, time] = hasDate ? value.split("T") : ["", value];
    if (!time) return [day, ""];
    const [hours, minutes] = time.split(":");
    const hour = Number(hours);
    return [day, mode === "24" ? hours + ":" + minutes
      : String((hour % 12) || 12) + ":" + minutes + (hour < 12 ? " AM" : " PM")];
  }
  function typedClock(value, mode) {
    const text = value.trim();
    if (!text) return "";
    const match = mode === "24"
      ? /^([01]?\d|2[0-3]):?([0-5]\d)$/.exec(text)
      : /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(am|pm)$/i.exec(text);
    if (!match) return null;
    const hour = mode === "24" ? Number(match[1]) : Number(match[1]) % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
    return String(hour).padStart(2, "0") + ":" + match[2];
  }
  function syncClockEditor(input) {
    const existing = clockEditors.get(input);
    const explicit = timePreference === "12" || timePreference === "24";
    if (existing && existing.mode !== timePreference) {
      const value = input.value;
      existing.date?.remove();
      existing.clock.remove();
      existing.wrapper.before(existing.label);
      existing.wrapper.remove();
      input.type = input.dataset.clockSource;
      input.required = existing.required;
      input.value = value;
      delete input.dataset.clockSource;
      clockEditors.delete(input);
    } else if (existing) {
      existing.sync();
      return true;
    }
    if (!explicit || !["time", "datetime-local"].includes(input.type)) return false;
    const label = input.closest("label");
    if (!label?.parentNode) return false;
    const R = window.RSVP, mode = timePreference, required = input.required, hasDate = input.type === "datetime-local";
    if (input.nextElementSibling?.classList.contains("admin-picker-preview")) input.nextElementSibling.remove();
    const context = input.getAttribute("aria-label") || label.textContent.trim();
    const wrapper = R.dom("div", { class: hasDate ? "admin-fixed-clock admin-fixed-clock-datetime" : "admin-fixed-clock" });
    label.before(wrapper);
    wrapper.append(label);
    const clock = R.dom("input", { type: "text", placeholder: mode === "24" ? "HH:MM" : "HH:MM AM/PM" });
    clock.dataset.clockPart = "";
    clock.autocomplete = "off";
    if (mode === "24") clock.inputMode = "numeric";
    clock.setAttribute("aria-label", hasDate ? context + " · " + T("Event time") : context);
    const date = hasDate ? R.dom("input", { type: "date" }) : null;
    if (date) {
      date.dataset.clockPart = "";
      date.setAttribute("aria-label", context);
      label.append(date);
      wrapper.append(clock);
    } else label.append(clock);
    const stored = input.value;
    input.dataset.clockSource = input.type;
    input.type = "hidden";
    input.required = false;
    input.value = stored;
    function updateValidity(time) {
      clock.required = required || Boolean(date?.value);
      clock.setCustomValidity(time === null ? T("Invalid date and time.") : "");
      if (date) date.required = required || Boolean(clock.value.trim());
    }
    function sync() {
      const [day, time] = pickerParts(input.value, hasDate, mode);
      if (date) date.value = day;
      clock.value = time;
      updateValidity(typedClock(time, mode));
    }
    function update() {
      const time = typedClock(clock.value, mode);
      updateValidity(time);
      const value = time && (!date || date.value) ? (date ? date.value + "T" + time : time) : "";
      const baseline = input.dataset.cleanOriginal;
      const baselineMinutes = baseline?.slice(0, hasDate ? 16 : 5);
      input.value = value === baselineMinutes ? baseline : value;
    }
    for (const part of [clock, date].filter(Boolean)) {
      part.addEventListener("input", update);
      part.addEventListener("change", () => {
        update();
        if (input.value) sync();
      });
    }
    if (input.dataset.cleanOriginal !== undefined) {
      const [day, time] = pickerParts(input.dataset.cleanOriginal, hasDate, mode);
      if (date) date.dataset.cleanOriginal = day;
      clock.dataset.cleanOriginal = time;
    }
    if (date) date.disabled = input.disabled;
    clock.disabled = input.disabled;
    clockEditors.set(input, { mode, required, label, wrapper, clock, date, sync });
    sync();
    return true;
  }
  function formatPicker(input) {
    if (!input.matches(datePickerSelector)) return null;
    const value = input.value;
    if (!value) return "";
    const type = input.dataset.clockSource || input.type;
    if (type === "time") return formatClock(value);
    // A native datetime-local value is already the requested wall time.
    const date = type === "datetime-local" ? value + "Z" : value;
    if (!/^\d{4}-/.test(date) || !Number.isFinite(Date.parse(date))) return value;
    return formatDate(date, undefined, "UTC");
  }
  function refreshDatePicker(input) {
    if (!input.matches?.(datePickerSelector) || input.id === "interfaceSampleDate" || Object.hasOwn(input.dataset, "clockPart")) return;
    if (syncClockEditor(input)) return;
    let hint = input.nextElementSibling;
    if (!hint?.classList.contains("admin-picker-preview")) {
      hint = window.RSVP.dom("small", {
        class: "muted admin-picker-preview", id: "admin-picker-preview-" + ++pickerPreviewId,
        "aria-hidden": "true",
      });
      input.after(hint);
      // Exclude the companion from the label's name and expose it as a description.
      input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), hint.id].filter(Boolean).join(" "));
    }
    const formatted = formatPicker(input);
    hint.hidden = !formatted;
    if (hint.textContent !== formatted) hint.textContent = formatted;
  }
  function refreshDatePickers(root = document) {
    for (const input of root.querySelectorAll(datePickerSelector)) refreshDatePicker(input);
  }
  function syncChoices() {
    if (!form()) return;
    for (const [kind, id] of Object.entries(controlIds)) {
      const select = element(id); if (!select?.options) continue;
      let group = form().querySelector('[data-preference-choices="' + kind + '"]');
      if (!group) {
        const R = window.RSVP;
        group = R.dom("fieldset", { class: "interface-choice-group" }); group.dataset.preferenceChoices = kind;
        group.append(R.dom("legend"));
        select.closest("label").after(group); select.closest("label").hidden = true; select.closest("label").classList.add("hidden");
      }
      group.querySelector("legend").textContent = T({
        language: "Language", appearance: "Theme", date: "Date format", time: "Time format", hover: "Button hover appearance",
      }[kind]);
      const signature = JSON.stringify([...select.options].map(o => [o.value, o.text]));
      if (group.dataset.options !== signature) {
        group.querySelectorAll("button").forEach(n => n.remove()); group.dataset.options = signature;
        [...select.options].forEach((option, index) => {
          const button = window.RSVP.dom("button", { type: "button", class: "btn secondary interface-choice" }, kind === "hover" ? T("Choice " + (index + 1)) : option.text);
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
  function updateDraft(target) {
    status("", "", target);
    if (target) {
      if (hasUnsaved(kindsFor(target))) target.dispatchEvent(new Event("input", { bubbles: true }));
      else window.RSVP_I18N.markClean(target);
    }
    renderDraft();
  }
  function stage(kind, value) {
    if (busy || !account || !Object.hasOwn(fields, kind) || !valid(kind, value))
      return false;
    draft[kind] = copyValue(kind, value);
    updateDraft(formFor(kind));
    return true;
  }
  function mergeInvitesProfileChanges(current, next) {
    const profiles = preferences(current).invitesProfiles;
    for (const [screen, profile] of Object.entries(next)) {
      for (const [key, value] of Object.entries(profile)) {
        if (JSON.stringify(value) !== JSON.stringify(baseline.invitesProfiles[screen][key]))
          profiles[screen][key] = value;
      }
    }
    return profiles;
  }
  async function commit(patch) {
    if (busy || !account || !Object.keys(patch).length) return false;
    const ticket = generation,
      id = account.id,
      target = formFor(Object.keys(patch)[0]);
    const savingInvites = invitesKinds.some(kind => Object.hasOwn(patch, kind));
    busy = true;
    updateControls();
    status(T("Saving…"), "saving", target);
    try {
      const db = window.RSVP.getClient();
      const current = await db.auth.getUser();
      if (current.error) throw current.error;
      if (ticket !== generation) return false;
      if (current.data?.user?.id !== id) throw new Error("Account changed");
      if (Object.hasOwn(patch, "invitesProfiles"))
        patch = { ...patch, invitesProfiles: mergeInvitesProfileChanges(current.data.user, patch.invitesProfiles) };
      // Only changed preference fields are patched; unrelated metadata and
      // preferences changed on another device are not overwritten.
      const data = Object.fromEntries(Object.entries(patch).map(([kind, value]) => [fields[kind], copyValue(kind, value)]));
      const savedDefaults = savingInvites ? storedInvitesDefaults(current.data.user) : null;
      // Keep the original saved appearance before the first change. Opening or resetting the form performs no write.
      if (savingInvites && !savedDefaults) data[invitesDefaultsKey] = invitesDefaults;
      const result = await db.auth.updateUser({ data });
      if (result.error) throw result.error;
      if (ticket !== generation) return false;
      if (result.data?.user?.id !== id) throw new Error("Account changed");
      account = result.data.user;
      if (savedDefaults) invitesDefaults = savedDefaults;
      baseline = { ...baseline, ...copyPreferences(patch) };
      draft = { ...draft, ...copyPreferences(patch) };
      await apply(baseline, ticket);
      if (ticket !== generation) return false;
      if (Object.hasOwn(patch, "date") || Object.hasOwn(patch, "time"))
        document.dispatchEvent(new Event("rsvp:time-format"));
      if (savingInvites) document.dispatchEvent(new Event("rsvp:invites-appearance"));
      if (overviewKinds.some(kind => Object.hasOwn(patch, kind))) document.dispatchEvent(new Event("rsvp:overview-appearance"));
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
    const saveButton = target.querySelector('button[type="submit"]');
    const restoreFocus = document.activeElement === saveButton;
    const saved = await commit(patch);
    if (restoreFocus && !target.closest("[hidden], .hidden") &&
        (document.activeElement === saveButton || document.activeElement === document.body)) {
      const cancelButton = target.querySelector('button[id^="cancel"]:enabled');
      (saved ? cancelButton : saveButton)?.focus({ preventScroll: true });
    }
    if (saved && languageChanged) window.RSVP_I18N.reloadLanguagePage();
  }
  function cancel(target = form()) {
    if (busy || !baseline) return;
    for (const kind of kindsFor(target)) draft[kind] = copyValue(kind, baseline[kind]);
    const sample = element("interfaceSampleDate");
    if (target === form() && sample) sample.value = sampleDate;
    window.RSVP_I18N.markClean(target);
    status("", "", target);
    renderDraft();
  }
  window.RSVP_ADMIN_PREFERENCES = {
    get timeFormat() {
      return timePreference;
    },
    formatDate,
    formatClock,
    formatPicker,
    refreshDatePicker,
    refreshDatePickers,
    get invitesGrouped() { return baseline?.grouped !== false; },
    get invitesGrouping() { return groupingMode(baseline?.grouped); },
    get invitesShowText() { return baseline?.showText ?? true; },
    get invitesFields() { return invitesFields; },
    get invitesColumnGroups() { return invitesColumnGroups; },
    get invitesRequiredFields() { return invitesRequiredFields; },
    get defaultInvitesShownFields() { return defaultInvitesShownFields; },
    get invitesShownFields() { return (baseline?.shownFields || defaultInvitesShownFields).slice(); },
    get invitesTwoRowColumns() { return (baseline?.twoRowColumns || defaultInvitesTwoRowColumns).slice(); },
    get invitesNarrowRows() { return baseline?.narrowRows ?? 1; },
    get invitesWideRows() { return baseline?.wideRows ?? 2; },
    getInvitesProfile(screen) {
      const profile = baseline?.invitesProfiles[screen] || normalizeInvitesProfiles()[screen];
      return { ...profile, shownFields: [...profile.shownFields], twoRowColumns: [...profile.twoRowColumns], expandedFields: [...profile.expandedFields] };
    },
    get overviewLayout() { return normalizeOverviewLayout(baseline?.overviewLayout); },
    setOverviewCards,
    hasUnsaved,
    stage,
    cancel: () => cancel(),
    async load(user) {
      const ticket = ++generation;
      if (account?.id !== user?.id) inviteScreen = "phone";
      account = user;
      baseline = preferences(user);
      draft = copyPreferences(baseline);
      invitesDefaults = account ? storedInvitesDefaults(user) || copyInvitesAppearance(baseline) : null;
      busy = true;
      updateControls();
      await apply(baseline, ticket);
      if (ticket === generation) {
        busy = false;
        for (const target of preferenceForms()) {
          status("", "", target);
          window.RSVP_I18N.markClean(target);
        }
        renderDraft();
      }
    },
    clear() {
      generation++;
      account = baseline = draft = null;
      invitesDefaults = null;
      inviteScreen = "phone";
      overviewCards = new Map();
      draggedOverviewId = null;
      busy = false;
      timePreference = "locale";
      document.documentElement.dataset.buttonHover = "toolbar";
      for (const target of preferenceForms()) {
        status("", "", target);
        window.RSVP_I18N.markClean(target);
      }
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
      element("interfaceHoverHost")?.append(label);
      select.addEventListener("change", () => stage("hover", select.value));
      mountDateTimeControls();
      syncChoices();
    }
    const interfaceTabs = [...(element("interfaceEditTabs")?.querySelectorAll('[role="tab"]') || [])];
    for (const tab of interfaceTabs) tab.addEventListener("click", () => {
      for (const item of interfaceTabs) {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
        element(item.getAttribute("aria-controls")).hidden = !active;
      }
    });
    form()?.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    element("cancelPersonalPreferences")?.addEventListener("click", () => cancel());
    invitesForm()?.addEventListener("submit", event => { event.preventDefault(); submit(invitesForm()); });
    element("cancelInvitesAppearance")?.addEventListener("click", () => cancel(invitesForm()));
    element("resetInvitesAppearance")?.addEventListener("click", () => {
      if (busy || !invitesDefaults) return;
      Object.assign(draft, copyInvitesAppearance(invitesDefaults));
      updateDraft(invitesForm());
      (invitesForm().querySelector("#saveInvitesAppearance:enabled") || element("cancelInvitesAppearance"))?.focus();
    });
    element("inviteShowText")?.addEventListener("change", ({ currentTarget }) => {
      if (!stage("showText", currentTarget.checked)) renderDraft();
    });
    for (const tab of element("inviteScreenTabs")?.querySelectorAll("button") || []) {
      tab.addEventListener("click", () => {
        inviteScreen = tab.dataset.inviteScreen;
        syncInviteScreen();
      });
    }
    element("inviteRowsPreference")?.addEventListener("change", ({ target }) => {
      if (target.checked) stageInviteScreen({ rows: Number(target.value) });
    });
    element("inviteShownFieldChoices")?.addEventListener("change", ({ target }) => {
      const key = target.dataset.inviteDefaultField;
      if (key === "showActions" || key === "showInlineActions") stageInviteScreen({ [key]: target.checked });
      else if (key) stageInviteField(target, key, draft?.invitesProfiles[inviteScreen].rows === 2 ? "twoRowColumns" : "shownFields");
    });
    element("inviteExpandedFieldChoices")?.addEventListener("change", ({ target }) => {
      const key = target.dataset.inviteExpandedField;
      if (key === "showActions") stageInviteScreen({ showActions: target.checked });
      else if (key) stageInviteField(target, key, "expandedFields");
    });
    overviewForm()?.addEventListener("submit", event => { event.preventDefault(); submit(overviewForm()); });
    element("cancelOverviewAppearance")?.addEventListener("click", () => cancel(overviewForm()));
    element("resetOverviewAppearance")?.addEventListener("click", () => {
      if (stage("overviewLayout", normalizeOverviewLayout()))
        (overviewForm().querySelector("#saveOverviewAppearance:enabled") || element("cancelOverviewAppearance"))?.focus();
    });
    syncInviteGrouping();
    syncInviteScreen();
    updateControls();
    refreshDatePickers();
    for (const name of ["input", "change"]) document.addEventListener(name, event => refreshDatePicker(event.target));
    document.addEventListener("reset", event => queueMicrotask(() => refreshDatePickers(event.target)));
  });
})();
