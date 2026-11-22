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
    narrowRows: "rsvp_invites_narrow_rows",
    wideRows: "rsvp_invites_wide_rows",
    overviewLayout: "rsvp_overview_layout",
  };
  const overviewGroups = [
    ["information", "Information", ["households", "food", "rsvp"]],
    ["invitation", "Invitation", ["invites", "services", "language"]],
  ];
  const overviewCardTabs = new Map(overviewGroups.flatMap(([tab, , ids]) => ids.map(id => [id, tab])));
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
    timePreference = "locale",
    overviewCards = new Map(),
    draggedOverviewId = null;
  const T = (...args) => window.RSVP_I18N.t(...args);
  const element = (id) => document.getElementById(id);
  const form = () => element("personalPreferencesForm");
  const invitesForm = () => element("invitesAppearanceForm");
  const overviewForm = () => element("overviewAppearanceForm");
  const personalKinds = ["language", "appearance", "time", "hover"];
  const inviteWidths = [
    ["narrowRows", "Narrow screens (below 1024 px)", 1],
    ["wideRows", "Wide screens (1024 px and wider)", 2],
  ];
  const invitesKinds = ["grouped", "shownFields", "twoRowColumns", "narrowRows", "wideRows"];
  const overviewKinds = ["overviewLayout"];
  const kindsFor = node => node === overviewForm() ? overviewKinds : node === invitesForm() ? invitesKinds : personalKinds;
  const formFor = kind => kind === "overviewLayout" ? overviewForm() : invitesKinds.includes(kind) ? invitesForm() : form();
  function valid(kind, value) {
    if (kind === "overviewLayout") return Array.isArray(value);
    if (kind === "shownFields") return Array.isArray(value) && new Set(value).size === value.length && value.every(key => inviteFieldKeys.has(key));
    if (kind === "twoRowColumns") return Array.isArray(value) && new Set(value).size === value.length && value.every(key => inviteColumnKeys.has(key));
    if (kind === "grouped") return typeof value === "boolean" || value === "service";
    if (kind === "narrowRows" || kind === "wideRows") return value === 1 || value === 2;
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
  function normalizeOverviewLayout(value) {
    const saved = Array.isArray(value) ? value : [];
    const cards = new Map();
    const hasHouseholds = saved.some(item => item?.id === "households" && typeof item.shown === "boolean");
    for (const item of saved) {
      // Preserve the existing Households choice when both old cards were saved.
      const id = !hasHouseholds && item?.id === "guests" ? "households" : item?.id;
      if (overviewCardTabs.has(id) && typeof item.shown === "boolean" && !cards.has(id))
        cards.set(id, item.shown);
    }
    for (const id of overviewCardTabs.keys()) if (!cards.has(id)) cards.set(id, true);
    return overviewGroups.flatMap(([tab]) => [...cards]
      .filter(([id]) => overviewCardTabs.get(id) === tab)
      .map(([id, shown]) => ({ id, shown })));
  }
  function copyValue(kind, value) {
    if (kind === "shownFields") return normalizeShownFields(value);
    if (kind === "overviewLayout") return normalizeOverviewLayout(value);
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
                narrowRows: 1,
                wideRows: 2,
                overviewLayout: normalizeOverviewLayout(),
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
    if (save) save.disabled = busy || !account || !hasUnsaved(personalKinds);
    const groupingSave = element("saveInvitesAppearance");
    if (groupingSave) groupingSave.disabled = busy || !account || !hasUnsaved(invitesKinds);
    const overviewSave = element("saveOverviewAppearance"), reset = element("resetOverviewAppearance");
    if (overviewSave) overviewSave.disabled = busy || !account || !hasUnsaved(overviewKinds);
    if (reset) reset.disabled = busy || !account || !draft || sameValue("overviewLayout", draft.overviewLayout, normalizeOverviewLayout());
    for (const node of [form(), invitesForm(), overviewForm()]) node?.setAttribute("aria-busy", String(busy));
    for (const button of overviewForm()?.querySelectorAll("#overviewCardOrder button,#overviewCardOrder input") || [])
      button.disabled = busy || !account || button.hasAttribute("data-overview-edge");
    for (const grip of overviewForm()?.querySelectorAll("[data-overview-grip]") || [])
      grip.draggable = !busy && !!account && grip.closest("ol").children.length > 1;
    for (const button of form()?.querySelectorAll("[data-preference-choice]") || []) button.disabled = busy || !account;
    for (const host of [element("inviteGroupBy"), element("inviteRowsPreference"), element("inviteDefaultFields")])
      for (const input of host?.querySelectorAll("input") || []) input.disabled = busy || !account || input.hasAttribute("data-invite-fixed-field") || input.hasAttribute("data-invite-fixed-column");
  }
  function renderDraft() {
    if (draft)
      for (const [kind, id] of Object.entries(controlIds)) {
        const node = element(id);
        if (node) node.value = draft[kind];
      }
    syncInviteGrouping();
    syncInviteRows();
    syncInviteDefaultFields();
    renderOverviewLayout();
    updateControls();
    syncChoices();
  }
  function canMoveOverviewCard(id, target) {
    return !busy && !!account && id !== target && overviewCards.has(id) && overviewCards.has(target) &&
      overviewCards.get(id).tab === overviewCards.get(target).tab;
  }
  function moveOverviewCard(id, target, after) {
    if (!draft || !canMoveOverviewCard(id, target)) return;
    const layout = draft.overviewLayout;
    const tab = overviewCards.get(id).tab;
    const inGroup = card => overviewCards.get(card.id)?.tab === tab;
    const eligible = layout.filter(inGroup);
    const [moved] = eligible.splice(eligible.findIndex(card => card.id === id), 1);
    eligible.splice(eligible.findIndex(card => card.id === target) + Number(after), 0, moved);
    // Keep preferences for temporarily unavailable cards in their original slots.
    let next = 0;
    stage("overviewLayout", layout.map(card => inGroup(card) ? eligible[next++] : card));
  }
  function clearOverviewDropHint(host) {
    host.querySelector("[data-overview-drop]")?.removeAttribute("data-overview-drop");
  }
  function renderOverviewGroup(host, tab, name, layout) {
    const R = window.RSVP;
    const eligible = layout.filter(card => overviewCards.get(card.id)?.tab === tab);
    if (!eligible.length) return null;
    const group = R.dom("li", { class: "overview-card-setting-group" });
    group.dataset.overviewSettingTab = tab;
    const heading = R.dom("h4", { id: "overviewCardGroup-" + tab }, T(name));
    const list = R.dom("ol", { class: "overview-card-settings" });
    list.setAttribute("aria-labelledby", heading.id);
    for (const [index, { id, shown }] of eligible.entries()) {
      const { label } = overviewCards.get(id);
      const row = R.dom("li", { class: "overview-card-setting" });
      row.dataset.overviewSetting = id;
      const grip = R.dom("span", { class: "overview-card-grip", title: T("Drag to reorder") }, "⠿");
      grip.dataset.overviewGrip = "";
      grip.setAttribute("aria-hidden", "true");
      grip.draggable = !busy && !!account && eligible.length > 1;
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
      const choice = R.dom("label", { class: "checkbox-label" });
      const input = R.dom("input", { type: "checkbox" });
      input.checked = shown;
      input.disabled = busy || !account;
      input.addEventListener("change", () => stage("overviewLayout", layout.map(card =>
        card.id === id ? { id, shown: input.checked } : card)));
      choice.append(input, R.dom("span", {}, label));
      const buttons = R.dom("div", { class: "overview-card-moves" });
      for (const [direction, offset, glyph, caption] of [["up", -1, "↑", "Move up"], ["down", 1, "↓", "Move down"]]) {
        const target = eligible[index + offset];
        const text = T(caption) + " · " + label;
        const button = R.dom("button", { type: "button", class: "btn secondary", title: text }, glyph);
        button.setAttribute("aria-label", text);
        button.dataset.overviewMove = direction;
        if (target) button.addEventListener("click", () => moveOverviewCard(id, target.id, offset > 0));
        else button.dataset.overviewEdge = "";
        button.disabled = busy || !account || !target;
        buttons.append(button);
      }
      row.append(grip, choice, buttons);
      list.append(row);
    }
    group.append(heading, list);
    return group;
  }
  function renderOverviewLayout() {
    const host = element("overviewCardOrder");
    if (!host) return;
    host.closest("[data-settings-card]").hidden = !overviewCards.size;
    const active = document.activeElement, activeRow = active?.closest("[data-overview-setting]");
    const activeId = host.contains(activeRow) ? activeRow.dataset.overviewSetting : null;
    const activeMove = active?.dataset.overviewMove;
    const layout = draft?.overviewLayout || normalizeOverviewLayout();
    draggedOverviewId = null;
    host.replaceChildren(...overviewGroups.map(([tab, name]) => renderOverviewGroup(host, tab, name, layout)).filter(Boolean));
    const replacement = activeId && host.querySelector('[data-overview-setting="' + activeId + '"]');
    if (replacement) {
      const sameControl = activeMove && replacement.querySelector('[data-overview-move="' + activeMove + '"]:enabled');
      (sameControl || (activeMove && replacement.querySelector("[data-overview-move]:enabled")) ||
        replacement.querySelector("input:enabled"))?.focus({ preventScroll: true });
    }
  }
  function renderOverviewSummary(host) {
    const R = window.RSVP, layout = baseline?.overviewLayout || normalizeOverviewLayout();
    const groups = [];
    for (const [tab, name] of overviewGroups) {
      const list = R.dom("dl", { class: "record-read-grid compact-read-grid" });
      for (const { id, shown } of layout) {
        const card = overviewCards.get(id);
        if (card?.tab === tab) list.append(R.dom("dt", {}, card.label), R.dom("dd", {}, T(shown ? "Shown" : "Hidden")));
      }
      if (!list.childElementCount) continue;
      const group = R.dom("div", { class: "overview-card-setting-group" });
      group.append(R.dom("h4", {}, T(name)), list);
      groups.push(group);
    }
    host.replaceChildren(...groups);
  }
  function setOverviewCards(cards) {
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
    const target = formFor(kind);
    status("", "", target);
    if (kind === "overviewLayout" && target) {
      if (hasUnsaved(overviewKinds)) target.dispatchEvent(new Event("input", { bubbles: true }));
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
      if (Object.hasOwn(patch, "time"))
        document.dispatchEvent(new Event("rsvp:time-format"));
      if (invitesKinds.some(kind => Object.hasOwn(patch, kind))) document.dispatchEvent(new Event("rsvp:invites-appearance"));
      if (Object.hasOwn(patch, "overviewLayout")) document.dispatchEvent(new Event("rsvp:overview-appearance"));
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
    get invitesNarrowRows() { return baseline?.narrowRows ?? 1; },
    get invitesWideRows() { return baseline?.wideRows ?? 2; },
    get overviewLayout() { return normalizeOverviewLayout(baseline?.overviewLayout); },
    setOverviewCards,
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
        status(); status("", "", invitesForm()); status("", "", overviewForm());
        window.RSVP_I18N.markClean(overviewForm());
        renderDraft();
      }
    },
    clear() {
      generation++;
      account = baseline = draft = null;
      overviewCards = new Map();
      draggedOverviewId = null;
      busy = false;
      timePreference = "locale";
      document.documentElement.dataset.buttonHover = "toolbar";
      status(); status("", "", invitesForm()); status("", "", overviewForm());
      window.RSVP_I18N.markClean(overviewForm());
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
    if (overviewForm()) overviewForm().renderReadSummary = renderOverviewSummary;
    overviewForm()?.addEventListener("submit", event => { event.preventDefault(); submit(overviewForm()); });
    element("cancelOverviewAppearance")?.addEventListener("click", () => cancel(overviewForm()));
    element("resetOverviewAppearance")?.addEventListener("click", () => {
      if (stage("overviewLayout", normalizeOverviewLayout()))
        (overviewForm().querySelector("#saveOverviewAppearance:enabled") || element("cancelOverviewAppearance"))?.focus();
    });
    syncInviteGrouping();
    syncInviteRows();
    syncInviteDefaultFields();
    updateControls();
  });
})();
