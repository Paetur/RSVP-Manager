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
    shownFields: "rsvp_invites_shown_fields",
    twoRowColumns: "rsvp_invites_two_row_columns",
    narrowRows: "rsvp_invites_narrow_rows",
    wideRows: "rsvp_invites_wide_rows",
    overviewLayout: "rsvp_overview_layout",
    overviewTabNames: "rsvp_overview_tab_names",
  };
  const overviewGroups = [
    ["information", "Information", ["households", "food", "rsvp"]],
    ["invitation", "Invitation", ["invites", "services", "language"]],
  ];
  const overviewCardTabs = new Map(overviewGroups.flatMap(([tab, , ids]) => ids.map(id => [id, tab])));
  const overviewTabLabels = new Map(overviewGroups.map(([tab, label]) => [tab, label]));
  const overviewTabNameLimit = 48;
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
    busy = false,
    generation = 0,
    timePreference = "locale",
    pickerPreviewId = 0,
    overviewCards = new Map(),
    overviewIconAction,
    overviewRenameEditor = null,
    draggedOverviewId = null;
  const T = (...args) => window.RSVP_I18N.t(...args);
  const element = (id) => document.getElementById(id);
  const form = () => element("personalPreferencesForm");
  const invitesForm = () => element("invitesAppearanceForm");
  const overviewForm = () => element("overviewAppearanceForm");
  const preferenceForms = () => [form(), invitesForm(), overviewForm()].filter(Boolean);
  const inviteWidths = [
    ["narrowRows", "Narrow screens (below 1024 px)", 1],
    ["wideRows", "Wide screens (1024 px and wider)", 2],
  ];
  const invitesKinds = ["grouped", "showText", "shownFields", "twoRowColumns", "narrowRows", "wideRows"];
  const interfaceKinds = Object.keys(controlIds);
  const overviewKinds = ["overviewLayout", "overviewTabNames"];
  const kindsFor = node => node === overviewForm() ? overviewKinds : node === invitesForm() ? invitesKinds : interfaceKinds;
  const formFor = kind => overviewKinds.includes(kind) ? overviewForm() : invitesKinds.includes(kind) ? invitesForm() : form();
  function valid(kind, value) {
    if (kind === "overviewLayout") return Array.isArray(value);
    if (kind === "overviewTabNames") return value && typeof value === "object" && !Array.isArray(value);
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
  function overviewCardTab({ id, tab }) {
    return overviewTabLabels.has(tab) ? tab : overviewCardTabs.get(id);
  }
  function normalizeOverviewLayout(value) {
    const saved = Array.isArray(value) ? value : [];
    const cards = new Map();
    const hasHouseholds = saved.some(item => item?.id === "households" && typeof item.shown === "boolean");
    for (const item of saved) {
      // Preserve the existing Households choice when both old cards were saved.
      const id = !hasHouseholds && item?.id === "guests" ? "households" : item?.id;
      if (overviewCardTabs.has(id) && typeof item.shown === "boolean" && !cards.has(id)) {
        const card = { id, shown: item.shown };
        // Legacy layouts and cards assigned to their default tab need no extra key.
        if (overviewTabLabels.has(item.tab) && item.tab !== overviewCardTabs.get(id)) card.tab = item.tab;
        cards.set(id, card);
      }
    }
    for (const id of overviewCardTabs.keys()) if (!cards.has(id)) cards.set(id, { id, shown: true });
    return overviewGroups.flatMap(([tab]) => [...cards.values()].filter(card => overviewCardTab(card) === tab));
  }
  function normalizeOverviewTabNames(value) {
    const names = {};
    for (const tab of overviewTabLabels.keys()) {
      const name = typeof value?.[tab] === "string" ? value[tab].trim().slice(0, overviewTabNameLimit) : "";
      if (name) names[tab] = name;
    }
    return names;
  }
  function copyValue(kind, value) {
    if (kind === "shownFields") return normalizeShownFields(value);
    if (kind === "overviewLayout") return normalizeOverviewLayout(value);
    if (kind === "overviewTabNames") return normalizeOverviewTabNames(value);
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
      return a.every(({ id, shown, tab }, index) => id === b[index].id && shown === b[index].shown && tab === b[index].tab);
    if (kind === "overviewTabNames") return [...overviewTabLabels.keys()].every(tab => a[tab] === b[tab]);
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
                overviewTabNames: {},
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
    const invitesSave = element("saveInvitesAppearance");
    if (invitesSave) invitesSave.disabled = busy || !account || !hasUnsaved(invitesKinds);
    const sample = element("interfaceSampleDate");
    if (sample) sample.disabled = busy || !account;
    const overviewSave = element("saveOverviewAppearance"), reset = element("resetOverviewAppearance");
    if (overviewSave) overviewSave.disabled = busy || !account || !!overviewRenameEditor || !hasUnsaved(overviewKinds);
    if (reset) reset.disabled = busy || !account || !draft || (
      !Object.keys(draft.overviewTabNames).length && sameValue("overviewLayout", draft.overviewLayout, normalizeOverviewLayout())
    );
    for (const node of preferenceForms()) node.setAttribute("aria-busy", String(busy));
    for (const button of overviewForm()?.querySelectorAll("#overviewCardOrder button,#overviewCardOrder input") || [])
      button.disabled = busy || !account;
    for (const grip of overviewForm()?.querySelectorAll("[data-overview-grip]") || [])
      grip.draggable = !busy && !!account;
    for (const button of form()?.querySelectorAll("[data-preference-choice]") || []) button.disabled = busy || !account;
    for (const host of [element("inviteGroupBy"), element("inviteRowsPreference"), element("inviteDefaultFields")])
      for (const input of host?.querySelectorAll("input") || []) input.disabled = busy || !account || input.hasAttribute("data-invite-fixed-field") || input.hasAttribute("data-invite-fixed-column");
  }
  function renderDraft() {
    syncDateTimeControls();
    if (draft)
      for (const [kind, id] of Object.entries(controlIds)) {
        const node = element(id);
        if (node) node.value = draft[kind];
      }
    syncInviteGrouping();
    syncInviteRows();
    const showText = element("inviteShowText");
    if (showText) showText.checked = draft?.showText ?? true;
    syncInviteDefaultFields();
    renderOverviewLayout();
    updateControls();
    syncChoices();
    renderDateTimeExample();
  }
  function canMoveOverviewCard(id, target) {
    return !busy && !!account && id !== target && overviewCards.has(id) && (!target || overviewCards.has(target));
  }
  function moveOverviewCard(id, tab, target, after) {
    if (!draft || !canMoveOverviewCard(id, target)) return;
    const layout = draft.overviewLayout;
    const moved = layout.find(card => card.id === id);
    if (target && overviewCardTab(moved) === tab) {
      const inGroup = card => overviewCards.has(card.id) && overviewCardTab(card) === tab;
      const eligible = layout.filter(card => inGroup(card) && card.id !== id);
      eligible.splice(eligible.findIndex(card => card.id === target) + Number(after), 0, moved);
      // Reordering within a tab keeps temporarily unavailable cards in their slots.
      let next = 0;
      stage("overviewLayout", layout.map(card => inGroup(card) ? eligible[next++] : card));
      return;
    }
    const remaining = layout.filter(card => card.id !== id);
    const position = target ? remaining.findIndex(card => card.id === target) + Number(after) : remaining.length;
    remaining.splice(position, 0, { ...moved, tab });
    stage("overviewLayout", remaining);
  }
  function clearOverviewDropHint(host) {
    host.querySelector("[data-overview-drop]")?.removeAttribute("data-overview-drop");
  }
  function closeOverviewRename(restoreFocus = false) {
    if (!overviewRenameEditor) return;
    const tab = overviewRenameEditor.dataset.overviewRenameEditor;
    overviewRenameEditor.remove();
    overviewRenameEditor = null;
    const trigger = overviewForm()?.querySelector('[data-overview-rename-tab="' + tab + '"]');
    trigger?.setAttribute("aria-expanded", "false");
    trigger?.removeAttribute("aria-controls");
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  }
  function renameOverviewTab(tab, name, title, trigger) {
    if (busy || !draft) return;
    const wasOpen = overviewRenameEditor?.dataset.overviewRenameEditor === tab;
    closeOverviewRename(wasOpen);
    if (wasOpen) {
      updateControls();
      return;
    }
    const R = window.RSVP;
    const editor = R.dom("section", { id: "overview-tab-rename-" + tab, class: "inline-editor-panel overview-tab-rename" });
    editor.dataset.overviewRenameEditor = tab;
    editor.setAttribute("role", "dialog");
    editor.setAttribute("aria-label", title);
    const input = R.dom("input", { type: "text", placeholder: T(name) });
    input.maxLength = overviewTabNameLimit;
    input.dataset.overviewTabName = tab;
    input.value = draft.overviewTabNames[tab] || "";
    // The typed name is local to this editor until its Save button is used.
    input.addEventListener("input", event => event.stopPropagation());
    const label = R.dom("label", {}, T("Name"));
    label.append(input);
    const actions = R.dom("div", { class: "form-actions" });
    const cancel = R.dom("button", { type: "button", class: "btn secondary" }, T("Cancel"));
    const save = R.dom("button", { type: "button", class: "btn" }, T("Save"));
    const dismiss = () => {
      closeOverviewRename(true);
      updateControls();
    };
    cancel.addEventListener("click", dismiss);
    save.addEventListener("click", () => {
      if (busy || !draft) return;
      closeOverviewRename(true);
      stage("overviewTabNames", { ...draft.overviewTabNames, [tab]: input.value });
    });
    editor.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      } else if (event.key === "Enter" && event.target === input) {
        event.preventDefault();
        save.click();
      }
    });
    actions.append(cancel, save);
    editor.append(label, actions);
    overviewRenameEditor = editor;
    trigger.parentElement.after(editor);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", editor.id);
    updateControls();
    input.focus();
    input.select();
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
  function renderOverviewGroup(host, tab, name, layout, names, editing) {
    const R = window.RSVP;
    const available = layout.filter(card => overviewCards.has(card.id));
    const eligible = available.filter(card => overviewCardTab(card) === tab);
    if (!eligible.length && !editing) return null;
    const group = R.dom("li", { class: "overview-card-setting-group" });
    group.dataset.overviewSettingTab = tab;
    const heading = R.dom("h3", { id: (editing ? "overviewCardGroup-" : "overviewSavedCardGroup-") + tab }, names[tab] || T(name));
    const list = R.dom("ol", { class: "overview-card-settings" });
    list.setAttribute("aria-labelledby", heading.id);
    const header = R.dom("div", { class: "overview-tab-heading" });
    header.append(heading);
    group.append(header);
    if (editing) {
      const title = T("Rename") + " · " + heading.textContent;
      const rename = overviewIconAction("edit", title, null, busy || !account, "overview-tab-pencil");
      rename.dataset.overviewRenameTab = tab;
      rename.setAttribute("aria-haspopup", "dialog");
      const renaming = overviewRenameEditor?.dataset.overviewRenameEditor === tab;
      rename.setAttribute("aria-expanded", String(renaming));
      if (renaming) {
        rename.setAttribute("aria-controls", overviewRenameEditor.id);
        group.append(overviewRenameEditor);
      }
      rename.addEventListener("click", () => renameOverviewTab(tab, name, title, rename));
      header.append(rename);
      const canDropOnGroup = event => !event.target.closest("[data-overview-setting]") &&
        canMoveOverviewCard(draggedOverviewId) && !eligible.some(card => card.id === draggedOverviewId);
      group.addEventListener("dragover", event => {
        if (!canDropOnGroup(event)) return;
        clearOverviewDropHint(host);
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        group.dataset.overviewDrop = "inside";
      });
      group.addEventListener("dragleave", event => {
        if (!(event.relatedTarget instanceof Node) || !group.contains(event.relatedTarget))
          group.removeAttribute("data-overview-drop");
      });
      group.addEventListener("drop", event => {
        if (!canDropOnGroup(event)) return;
        event.preventDefault();
        const source = draggedOverviewId;
        draggedOverviewId = null;
        clearOverviewDropHint(host);
        moveOverviewCard(source, tab);
      });
    }
    for (const [index, { id, shown }] of eligible.entries()) {
      const { label } = overviewCards.get(id);
      const row = R.dom("li", { class: "overview-card-setting" });
      const cardLabel = R.dom("span", { class: "overview-card-label" }, label);
      row.dataset.overviewSetting = id;
      if (!editing) {
        const state = R.dom("span", { class: "overview-card-state" });
        state.dataset.shown = String(shown);
        state.setAttribute("role", "img");
        state.setAttribute("aria-label", T(shown ? "Shown" : "Hidden"));
        const glyph = R.dom("span", {}, shown ? "✓" : "–");
        glyph.setAttribute("aria-hidden", "true");
        state.append(glyph);
        row.append(cardLabel, state);
        list.append(row);
        continue;
      }
      const gripTitle = T("Drag to reorder") + " · " + label;
      const grip = R.dom("button", { type: "button", class: "overview-card-grip", title: gripTitle }, "⠿");
      grip.dataset.overviewGrip = "";
      grip.setAttribute("aria-label", gripTitle);
      grip.setAttribute("aria-haspopup", "dialog");
      grip.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
      grip.draggable = !busy && !!account;
      const moves = [];
      const groupIndex = overviewGroups.findIndex(([key]) => key === tab);
      for (const [key, offset, caption] of [["ArrowUp", -1, "Move up"], ["ArrowDown", 1, "Move down"]]) {
        const neighbor = eligible[index + offset];
        const destination = neighbor ? tab : overviewGroups[groupIndex + offset]?.[0];
        if (!destination) continue;
        const target = neighbor || available.filter(card => overviewCardTab(card) === destination).at(offset < 0 ? -1 : 0);
        moves.push({
          key,
          caption: T(caption) + (neighbor ? "" : " · " + (names[destination] || T(overviewTabLabels.get(destination)))),
          move: () => moveOverviewCard(id, destination, target?.id, neighbor ? offset > 0 : offset < 0),
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
        moveOverviewCard(source, tab, id, afterPointer(event));
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
      list.append(row);
    }
    group.append(list);
    return group;
  }
  function renderOverviewGroups(host, layout, names, editing) {
    host.replaceChildren(...overviewGroups.map(([tab, name]) =>
      renderOverviewGroup(host, tab, name, layout, names, editing)).filter(Boolean));
  }
  function renderOverviewLayout() {
    const host = element("overviewCardOrder");
    if (!host) return;
    host.closest("[data-settings-card]").hidden = !overviewCards.size;
    if (!overviewCards.size) {
      closeOverviewRename();
      host.replaceChildren();
      return;
    }
    const active = document.activeElement, activeRow = active?.closest("[data-overview-setting]");
    const activeId = host.contains(activeRow) ? activeRow.dataset.overviewSetting : null;
    const activeGrip = active?.hasAttribute("data-overview-grip");
    const activeRename = active?.dataset.overviewRenameTab;
    const activeInRename = overviewRenameEditor?.contains(active);
    const layout = draft?.overviewLayout || normalizeOverviewLayout();
    draggedOverviewId = null;
    renderOverviewGroups(host, layout, draft?.overviewTabNames || {}, true);
    const replacement = activeId && host.querySelector('[data-overview-setting="' + activeId + '"]');
    if (activeInRename) active.focus({ preventScroll: true });
    else if (replacement) {
      replacement.querySelector(activeGrip ? "[data-overview-grip]:enabled" : "input:enabled")?.focus({ preventScroll: true });
    } else if (activeRename) host.querySelector('[data-overview-rename-tab="' + activeRename + '"]:enabled')?.focus({ preventScroll: true });
  }
  function renderOverviewSummary(host) {
    const R = window.RSVP, layout = baseline?.overviewLayout || normalizeOverviewLayout();
    const groups = R.dom("ol", { class: "overview-card-settings" });
    renderOverviewGroups(groups, layout, baseline?.overviewTabNames || {}, false);
    host.replaceChildren(groups);
  }
  function setOverviewCards(cards, iconAction) {
    overviewIconAction = iconAction;
    const available = new Map(cards.filter(({ id, tab }) => overviewCardTabs.has(id) && overviewCardTabs.get(id) === tab)
      .map(({ id, label, tab }) => [id, { label, tab }]));
    if (available.size === overviewCards.size && [...available].every(([id, { label, tab }]) => {
      const prior = overviewCards.get(id);
      return prior?.label === label && prior?.tab === tab;
    })) return;
    overviewCards = available;
    renderOverviewLayout();
    updateControls();
    const editor = overviewForm()?.localEditor;
    if (editor) renderOverviewSummary(editor.summary);
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
  function syncInviteRows() {
    const host = element("inviteRowsPreference");
    if (!host) return;
    const R = window.RSVP;
    for (const [kind, label, defaultRows] of inviteWidths) {
      let group = host.querySelector('[data-invite-width="' + kind + '"]');
      if (!group) {
        group = R.dom("fieldset", { class: "invite-default-layout" });
        group.dataset.inviteWidth = kind;
        group.append(R.dom("legend"));
        for (const rows of [1, 2]) {
          const option = R.dom("label", { class: "checkbox-label" });
          const input = R.dom("input", { type: "radio", name: kind, value: String(rows) });
          input.addEventListener("change", () => {
            if (input.checked && !stage(kind, rows)) renderDraft();
          });
          option.append(input, R.dom("span"));
          group.append(option);
        }
        host.append(group);
      }
      group.querySelector("legend").textContent = T(label);
      for (const input of group.querySelectorAll("input")) {
        input.checked = Number(input.value) === (draft?.[kind] ?? defaultRows);
        input.nextElementSibling.textContent = T("Rows") + " " + input.value;
      }
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
    for (const [key, label] of [["household", "Household"], ...invitesFields]) {
      const fixed = key === "household" || invitesRequiredFields.includes(key);
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
      input.checked = fixed || (draft?.shownFields || defaultInvitesShownFields).includes(key);
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
  function stage(kind, value) {
    if (busy || !account || !Object.hasOwn(fields, kind) || !valid(kind, value))
      return false;
    draft[kind] = copyValue(kind, value);
    const target = formFor(kind);
    status("", "", target);
    if (target) {
      if (hasUnsaved(kindsFor(target))) target.dispatchEvent(new Event("input", { bubbles: true }));
      else window.RSVP_I18N.markClean(target);
    }
    renderDraft();
    return true;
  }
  async function commit(patch) {
    if (busy || !account || !Object.keys(patch).length) return false;
    const ticket = generation,
      id = account.id,
      target = formFor(Object.keys(patch)[0]);
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
      if (Object.hasOwn(patch, "date") || Object.hasOwn(patch, "time"))
        document.dispatchEvent(new Event("rsvp:time-format"));
      if (invitesKinds.some(kind => Object.hasOwn(patch, kind))) document.dispatchEvent(new Event("rsvp:invites-appearance"));
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
    if (busy || !account || (target === overviewForm() && overviewRenameEditor) || !Object.keys(patch).length) return;
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
    if (target === overviewForm()) closeOverviewRename();
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
    dateTimeExample,
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
    get overviewLayout() { return normalizeOverviewLayout(baseline?.overviewLayout); },
    get overviewTabNames() { return { ...baseline?.overviewTabNames }; },
    setOverviewCards,
    hasUnsaved,
    stage,
    cancel: () => cancel(),
    async load(user) {
      const ticket = ++generation;
      closeOverviewRename();
      account = user;
      baseline = preferences(user);
      draft = copyPreferences(baseline);
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
      closeOverviewRename();
      account = baseline = draft = null;
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
    element("inviteShowText")?.addEventListener("change", ({ currentTarget }) => {
      if (!stage("showText", currentTarget.checked)) renderDraft();
    });
    if (overviewForm()) overviewForm().renderReadSummary = renderOverviewSummary;
    overviewForm()?.addEventListener("submit", event => { event.preventDefault(); submit(overviewForm()); });
    element("cancelOverviewAppearance")?.addEventListener("click", () => cancel(overviewForm()));
    element("resetOverviewAppearance")?.addEventListener("click", () => {
      closeOverviewRename();
      if (stage("overviewTabNames", {}) && stage("overviewLayout", normalizeOverviewLayout()))
        (overviewForm().querySelector("#saveOverviewAppearance:enabled") || element("cancelOverviewAppearance"))?.focus();
    });
    syncInviteGrouping();
    syncInviteRows();
    syncInviteDefaultFields();
    updateControls();
    refreshDatePickers();
    for (const name of ["input", "change"]) document.addEventListener(name, event => refreshDatePicker(event.target));
    document.addEventListener("reset", event => queueMicrotask(() => refreshDatePickers(event.target)));
  });
})();
