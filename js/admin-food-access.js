// Event-wide food eligibility uses the audited household permission and write.
(function () {
  "use strict";

  function create({
    R, T, getStore, getActor, can, ordered, planningConfiguration, groupLabel,
    managementRpc, reload, show, applySavedFoodAccess,
  }) {
    const key = "food-access";
    const label = "food.messages.food_access";
    const commitmentLock = "food.messages.disabling_access_is_blocked_while_food_commitments_or_a_confirmed";
    const permissionError = "interface.messages.access_this_action_is_not_allowed_by_your_administrator_permissions";
    let reconcile = () => {};

    function canView() {
      return Boolean(getActor() && getStore().settings && can("food") && can("households"));
    }

    function householdRows() {
      const { households, guests, claims } = getStore();
      const active = new Set(guests.filter(guest => !guest.archived_at).map(guest => guest.household_id));
      const claimed = new Set(claims.map(claim => claim.household_id));
      return households.filter(household =>
        !household.archived_at && active.has(household.id) && typeof household.food === "boolean"
      ).map(household => ({
        id: household.id,
        name: R.householdName(household) || T("interface.messages.unnamed_household"),
        allowed: household.food,
        interest: household.food_interest,
        locked: household.food && (household.food_confirmed === true || claimed.has(household.id)),
      }));
    }

    function rosterGroups(entries) {
      const { households, relationGroups } = getStore();
      const ungrouped = T("interface.messages.ungrouped");
      const topGroups = new Map(planningConfiguration().groups.map(({ id }) => [id, []]));
      topGroups.set("", []);
      for (const household of households) {
        if (household.archived_at) continue;
        (topGroups.get(household.planning_group_id) || topGroups.get("")).push(household);
      }
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      const relationNames = new Map(relationGroups.map(({ id, name }) => [id, name]));
      const groups = [];
      for (const [id, households] of topGroups) {
        if (!households.some(household => byId.has(household.id))) continue;
        const subgroups = [];
        for (const relationId of R.relationGroupOrder(id, households, relationGroups)) {
          const members = households.filter(household => (household.relation_group_id || "") === relationId);
          // Resolve saved tree order before filtering so a hidden parent cannot reorder its children.
          const rows = R.householdTreeOrder(members, ordered)
            .map(household => byId.get(household.id)).filter(Boolean);
          if (rows.length) subgroups.push({ name: relationNames.get(relationId), rows });
        }
        const someNamed = subgroups.some(subgroup => subgroup.name);
        if (someNamed)
          for (const subgroup of subgroups) subgroup.name ||= ungrouped;
        groups.push({ name: id ? groupLabel(id) : ungrouped, subgroups });
      }
      return groups;
    }

    function open(trigger, restoreFocus) {
      if (!canView()) return false;
      const existing = window.RSVP_POPUPS.get(key);
      if (existing) {
        existing.querySelector("input")?.focus();
        return true;
      }

      const owner = getActor();
      const dialog = window.RSVP_POPUPS.create(key, { class: "food-access-dialog" }, trigger);
      dialog.dataset.foodAccess = "view";
      dialog.dataset.requiresHouseholdsView = "true";
      dialog.setAttribute("aria-label", T(label));
      dialog.setAttribute("aria-describedby", "foodAccessScope");
      const title = R.dom("h2", {}, T(label));
      const scope = R.dom("p", { id: "foodAccessScope", class: "muted" }, T("food.messages.food_access_scope"));
      const form = R.dom("form", { class: "food-access-form" });
      const search = R.dom("input", { id: "foodAccessSearch", type: "search",
        placeholder: T("food.messages.food_access_search") });
      search.setAttribute("aria-label", T("food.messages.food_access_search"));
      const filters = R.dom("div", { class: "food-access-filters" });
      filters.setAttribute("role", "group");
      filters.setAttribute("aria-label", T(label));
      const headings = R.dom("tr");
      for (const label of ["Household", "Food interest", "food.messages.allow_food"]) {
        const cell = R.dom("th", {}, T(label));
        cell.scope = "col";
        headings.append(cell);
      }
      const header = R.dom("thead");
      header.append(headings);
      const roster = R.dom("div", { class: "food-access-roster" });
      const lockHelp = R.dom("p", { id: "foodAccessLockHelp", class: "micro muted" }, T(commitmentLock));
      const status = R.dom("p", { class: "status hidden" });
      status.setAttribute("role", "status");
      status.tabIndex = -1;
      const actions = R.dom("div", { class: "form-actions" });
      const save = R.dom("button", { type: "submit", class: "btn" }, T("Save"));
      const cancel = R.dom("button", { type: "button", class: "btn secondary" });
      actions.append(save, cancel);
      form.append(search, filters, roster, lockHelp, status, actions);
      dialog.append(title, scope, form);

      const drafts = new Map();
      const buttons = new Map();
      const current = () => getActor() === owner && canView();
      const canEdit = () => current() && can("households", "edit");
      let filter = "allowed", saving = false, discarding = false;
      for (const [value, name] of [
        ["allowed", "food.messages.food_access_allowed"],
        ["all", "All"],
        ["blocked", "food.messages.food_access_blocked"],
      ]) {
        const button = R.dom("button", { type: "button", class: "btn secondary" });
        button.dataset.foodAccessFilter = value;
        button.addEventListener("click", () => {
          filter = value;
          render();
        });
        filters.append(button);
        buttons.set(value, { button, name });
      }

      function updateForm() {
        const editable = canEdit();
        form.dataset.dirty = String(drafts.size > 0);
        form.setAttribute("aria-busy", String(saving));
        save.classList.toggle("hidden", !editable);
        save.disabled = saving || discarding || drafts.size === 0;
        search.disabled = saving;
        cancel.disabled = saving || discarding;
        cancel.textContent = T(editable || drafts.size ? "Cancel" : "Close");
      }

      function render() {
        if (!current()) {
          dialog.close();
          return;
        }
        const entries = householdRows();
        const allowed = entries.filter(row => row.allowed).length;
        const counts = { allowed, all: entries.length, blocked: entries.length - allowed };
        for (const [value, { button, name }] of buttons) {
          button.textContent = T(name) + " " + counts[value];
          button.setAttribute("aria-pressed", String(filter === value));
          button.disabled = saving;
        }

        const term = search.value.trim().toLocaleLowerCase();
        const visible = entries.filter(row => (filter === "all" || row.allowed === (filter === "allowed"))
          && row.name.toLocaleLowerCase().includes(term));
        const editable = canEdit();
        const focused = roster.contains(document.activeElement)
          ? document.activeElement.closest("tr")?.dataset.foodAccessHousehold : null;
        let refocus;
        function drawRow(entry) {
          const row = R.dom("tr");
          row.dataset.foodAccessHousehold = entry.id;
          const name = R.dom("th", {}, entry.name);
          name.scope = "row";
          const interest = T(entry.interest === true ? "Yes" : entry.interest === false ? "No" : "Unanswered");
          const access = R.dom("td");
          const change = R.dom("label", { class: "food-access-toggle" });
          const checkbox = R.dom("input", { type: "checkbox", disabled: !editable || saving || entry.locked });
          checkbox.checked = drafts.get(entry.id)?.next ?? entry.allowed;
          checkbox.setAttribute("aria-label", T("food.messages.allow_food") + " · " + entry.name);
          if (entry.locked) checkbox.setAttribute("aria-describedby", lockHelp.id);
          checkbox.addEventListener("change", () => {
            if (!canEdit() || saving || entry.locked) return;
            const expected = drafts.get(entry.id)?.expected ?? entry.allowed;
            if (checkbox.checked === expected) drafts.delete(entry.id);
            else drafts.set(entry.id, { expected, next: checkbox.checked, name: entry.name });
            updateForm();
          });
          change.append(checkbox);
          access.append(change);
          row.append(name, R.dom("td", {}, interest), access);
          if (entry.id === focused && !checkbox.disabled) refocus = checkbox;
          return row;
        }
        roster.replaceChildren();
        for (const { name, subgroups } of rosterGroups(visible)) {
          const group = R.dom("fieldset", { class: "venue-assignment-category food-access-group" });
          const table = R.dom("table", { class: "food-access-table" });
          table.append(header.cloneNode(true));
          for (const subgroup of subgroups) {
            const body = R.dom("tbody");
            if (subgroup.name) {
              const heading = R.dom("tr", { class: "food-access-relational-heading" });
              const name = R.dom("th", {}, subgroup.name);
              name.scope = "rowgroup";
              name.colSpan = 3;
              heading.append(name);
              body.append(heading);
            }
            body.append(...subgroup.rows.map(drawRow));
            table.append(body);
          }
          group.append(R.dom("legend", {}, name), table);
          roster.append(group);
        }
        if (!visible.length)
          roster.append(R.dom("p", { class: "muted food-access-empty" }, T("food.messages.food_access_empty")));
        lockHelp.classList.toggle("hidden", !visible.some(entry => entry.locked));
        updateForm();
        refocus?.focus({ preventScroll: true });
      }

      async function requestClose() {
        if (saving || discarding) return;
        if (!drafts.size) {
          dialog.close();
          return;
        }
        discarding = true;
        updateForm();
        try {
          if (await window.RSVP_INLINE.confirm(T("Discard unsaved changes?"), {
            trigger: cancel, host: dialog, action: "Discard changes",
          })) dialog.close();
        } finally {
          discarding = false;
          if (dialog.open) updateForm();
        }
      }

      search.addEventListener("input", render);
      cancel.addEventListener("click", requestClose);
      dialog.addEventListener("cancel", event => {
        if (!saving && !drafts.size) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void requestClose();
      }, true);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (saving || discarding || !canEdit() || !drafts.size) return;
        saving = true;
        R.showStatus(status, "");
        render();
        let saved = 0, failure = "";
        for (const [id, { expected, next, name }] of drafts) {
          if (!current() || !dialog.open) return;
          try {
            if (!canEdit()) throw new Error(T(permissionError));
            await managementRpc("admin_set_food_access", {
              p_household_id: id,
              p_expected: expected,
              p_enabled: next,
              p_reason: T("food.messages.food_access_update_reason"),
            });
            if (!current() || !dialog.open) return;
            applySavedFoodAccess(id, next);
            drafts.delete(id);
            saved++;
          } catch (error) {
            failure = name + " · " + R.safeError(error);
            break;
          }
        }
        const refreshed = !saved || await reload({ showFeedback: false });
        if (!current() || !dialog.open) return;
        saving = false;
        if (!failure) {
          dialog.close();
          show(T(refreshed ? "interface.messages.changes_saved" : "food.messages.food_access_saved_refresh_failed"),
            refreshed ? "success" : "info");
          return;
        }
        render();
        R.showStatus(status, failure, "error");
        status.focus();
      });
      dialog.addEventListener("close", () => {
        reconcile = () => {};
        restoreFocus?.();
      }, { once: true });
      reconcile = render;
      render();
      dialog.openInline();
      search.focus();
      return true;
    }

    return { canView, open, reconcile: () => reconcile() };
  }

  window.RSVP_ADMIN_FOOD_ACCESS = { create };
})();
