// Delivery overview presentation only. The controller supplies current data,
// permissions, disclosure state and the existing section/action builders.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    getOverviewStore = getStore,
    getActor,
    ordered,
    invitationOverview,
    planningConfiguration,
    groupLabel,
    languages,
    canPreviewGuest,
    can,
    iconAction,
    editHousehold,
    setDisclosure,
    rememberDisclosure,
    deliverySection,
    invitationSection,
    managementRpc,
    rsvpSection,
    householdFacts,
    adminTime,
    show,
    getSelectionControl = () => null,
    getSelectAllControl = () => null,
    onVisibleHouseholds = () => {},
    getSentState = () => null,
    retrySent = () => {},
  }) {
    const $ = R.byId;
    let inviteOverviewFilter = "all", inviteInterestFilter = "all", inviteAttendanceFilter = "all", visibleHouseholdIds = [];
    let inviteSessionFilter = null;
    const languageSelection = new Set(), serviceSelection = new Set();
    const groupSelections = { top: new Set(), relation: new Set() };
    const wideScreen = matchMedia("(min-width: 1024px)");
    const serviceLabels = { messages: "Messages", email: "Email", whatsapp: "WhatsApp", sms: "SMS", none: "None" };
    const visibleFields = window.RSVP_ADMIN_PREFERENCES.invitesFields;
    const columnGroups = window.RSVP_ADMIN_PREFERENCES.invitesColumnGroups;
    const requiredFields = window.RSVP_ADMIN_PREFERENCES.invitesRequiredFields;
    const shown = new Set();
    const activityReaders = new WeakMap();
    const overviewCounters = new Map();
    let shownOwner, shownDefaults, shownColumnDefaults, rowLayout = 1, oneRowShown = [], clipboardBusy = false;
    let rowOverride, responsiveLayout;
    let refreshSentRows = () => {};

    function refreshInvitationActivity() {
      $("inviteRows")?.querySelectorAll("details[data-invite-household][open]").forEach(
        row => activityReaders.get(row)?.()
      );
    }

    function renderShownFields() {
      const host = $("inviteShownFieldsHost");
      const owner = getActor(), defaults = window.RSVP_ADMIN_PREFERENCES.invitesShownFields;
      const columnDefaults = window.RSVP_ADMIN_PREFERENCES.invitesTwoRowColumns;
      const signature = JSON.stringify(defaults), columnSignature = JSON.stringify(columnDefaults);
      const changedOwner = shownOwner !== owner, changedFields = shownDefaults !== signature;
      const changedColumns = shownColumnDefaults !== columnSignature;
      const preferences = window.RSVP_ADMIN_PREFERENCES;
      const savedLayout = wideScreen.matches ? preferences.invitesWideRows : preferences.invitesNarrowRows;
      if (changedOwner || responsiveLayout !== savedLayout) rowOverride = undefined;
      responsiveLayout = savedLayout;
      const nextLayout = rowOverride ?? savedLayout;
      const changedLayout = rowLayout !== nextLayout;
      // Keep temporary one-row choices across responsive layout changes.
      if (changedOwner || changedFields) oneRowShown = defaults.slice();
      else if (changedLayout && rowLayout === 1) oneRowShown = [...shown];
      rowLayout = nextLayout;
      if (changedOwner || changedLayout || rowLayout === 1 && changedFields || rowLayout === 2 && changedColumns) {
        shown.clear();
        for (const key of rowLayout === 2 ? columnDefaults : oneRowShown) shown.add(key);
        host.replaceChildren();
      }
      shownOwner = owner;
      shownDefaults = signature;
      shownColumnDefaults = columnSignature;
      if (host.childElementCount) return;
      const layoutChoices = R.dom("fieldset", { class: "invite-layout-choices" });
      layoutChoices.append(R.dom("legend", { class: "sr-only" }, T("Rows")));
      for (const [rows, label] of [[1, "1 Row"], [2, "2 Row"]]) {
        const choice = R.dom("label", { class: "invite-layout-choice" });
        const input = R.dom("input", { type: "radio", name: "inviteQuickRowLayout", value: rows });
        input.checked = rowLayout === rows;
        input.addEventListener("change", () => {
          if (!input.checked) return;
          rowOverride = rows;
          render();
          // Row changes replace the available fields and the dropdown controls.
          const next = host.querySelector("details");
          next.open = true;
          next.querySelector('input[name="inviteQuickRowLayout"]:checked')?.focus({ preventScroll: true });
        });
        choice.append(input, R.dom("span", {}, T(label)));
        layoutChoices.append(choice);
      }
      host.append(window.RSVP_INLINE.multiChoice({
        R,
        T,
        label: "View",
        options: (rowLayout === 1 ? visibleFields : columnGroups).filter(([key]) => !requiredFields.includes(key)),
        selected: shown,
        onChange: render,
        beforeOptions: layoutChoices,
        className: "invite-shown-fields",
      }));
    }
    function openCurrentDelivery(row, householdId) {
      row.open = true;
      row.dispatchEvent(new Event("toggle"));
      const key = "invite-household:" + householdId;
      rememberDisclosure(key, true);
      const invitation = row.querySelector(".invite-household-invitation"),
        current = invitation?.querySelector("[data-primary-delivery]"),
        submenu = current?.closest("[data-invite-delivery-submenu]") ||
          invitation?.querySelector('[data-invite-delivery-submenu="logs"]');
      if (!submenu) return;
      invitation.open = submenu.open = true;
      if (current?.matches("details")) current.open = true;
      rememberDisclosure(key + ":invitation", true);
      rememberDisclosure(key + ":invitation:" + submenu.dataset.inviteDeliverySubmenu, true);
      const focus = current?.querySelector("[data-mark-delivery-ready]:enabled") ||
        current?.querySelector(":scope > summary") || submenu.querySelector(":scope > summary");
      focus?.focus({ preventScroll: true });
      focus?.scrollIntoView({ block: "nearest" });
    }
    function countFilterButton(label, count, pressed, measure) {
      const button = R.dom("button", { type: "button", class: "stat-row invite-stat-row" });
      const check = R.dom("i", { class: "invite-stat-check" }, "✓");
      button.setAttribute("aria-pressed", String(pressed));
      check.setAttribute("aria-hidden", "true");
      button.append(R.dom("span", {}, label), check);
      if (count != null) {
        const value = R.dom("b", {}, count);
        if (measure) overviewCounters.set(value, measure);
        button.append(value);
      }
      return button;
    }

    function renderOptionFilter(host, choices, selected, models, value) {
      if (!host) return;
      const counts = new Map(choices.map(([key]) => [key, 0]));
      for (const key of selected) if (!counts.has(key)) selected.delete(key);
      for (const model of models) {
        const key = value(model);
        if (counts.has(key)) counts.set(key, counts.get(key) + 1);
      }
      host.replaceChildren(...choices.map(([key, label], index) => {
        const button = countFilterButton(T(label), counts.get(key), selected.has(key),
          ({ models }) => models.filter(model => value(model) === key).length);
        button.dataset.value = key;
        button.addEventListener("click", () => {
          if (!selected.delete(key)) selected.add(key);
          render();
          host.children[index]?.focus({ preventScroll: true });
        });
        return button;
      }));
    }

    function renderCountFilters(host, choices, selected, data, update) {
      host.replaceChildren(...choices.map(([key, label, count, measure], index) => {
        const button = countFilterButton(T(label), count, selected === key, measure);
        button.dataset[data] = key;
        button.addEventListener("click", () => {
          update(selected === key ? "all" : key);
          render();
          host.children[index]?.focus({ preventScroll: true });
        });
        return button;
      }));
    }

    function renderSessionTree(sessions) {
      const host = $("inviteSessionTree");
      if (!host) return;
      const list = R.dom("ul", { class: "invite-group-list" });
      const tree = R.dom("details", { class: "invite-group-tree" });
      const heading = R.dom("summary");
      const selected = sessions.find(session => session.id === inviteSessionFilter);
      heading.append(R.dom("span", {}, T("Sessions")), selected
        ? R.dom("span", { class: "invite-session-active", title: selected.name }, selected.name)
        : R.dom("b", {}, sessions.length));
      for (const session of sessions) {
        const item = R.dom("li");
        const button = countFilterButton(session.name, null, inviteSessionFilter === session.id);
        button.dataset.inviteSession = session.id;
        button.addEventListener("click", () => {
          inviteSessionFilter = inviteSessionFilter === session.id ? null : session.id;
          render();
          host.querySelector('[data-invite-session="' + CSS.escape(session.id) + '"]')?.focus({ preventScroll: true });
        });
        item.append(button);
        list.append(item);
      }
      tree.append(heading, list);
      setDisclosure(tree, "invite-overview-sessions");
      host.replaceChildren(...(sessions.length ? [tree] : []));
      const note = host.closest(".stat-card")?.querySelector(".stat-footnote");
      if (note) note.hidden = !sessions.length || Boolean(inviteSessionFilter);
    }

    function renderGroupTrees(store, all) {
      const host = $("inviteGroupTrees");
      if (!host) {
        for (const selected of Object.values(groupSelections)) selected.clear();
        return () => true;
      }
      const configured = planningConfiguration().groups;
      const relations = ordered(store.relationGroups, "name");
      const relationOption = group => ({
        key: "group:" + group.id,
        label: group.name,
        matches: ({ h }) => h.relation_group_id === group.id,
      });
      const topKeys = new Set(configured.map(group => group.id));
      const scoped = new Map();
      for (const relation of relations) {
        const options = scoped.get(relation.planning_group_id) || [];
        options.push(relationOption(relation));
        scoped.set(relation.planning_group_id, options);
      }
      const trees = [
        ["top", "Top-level groups", configured.length, configured.map(group => ({
          key: group.id, label: groupLabel(group.id), matches: ({ h }) => h.planning_group_id === group.id,
        }))],
        ["relation", "Relational groups", relations.length, [
          ...configured.flatMap(group => {
            const children = scoped.get(group.id);
            return children ? [{
              key: "planning:" + group.id, label: groupLabel(group.id), children,
              matches: model => model.h.planning_group_id === group.id && children.some(child => child.matches(model)),
            }] : [];
          }),
          ...relations.filter(group => !topKeys.has(group.planning_group_id)).map(relationOption),
        ]],
      ];
      const filters = [];
      host.replaceChildren();
      for (const [scope, label, count, nodes] of trees) {
        const options = new Map();
        const selected = groupSelections[scope];
        function list(entries) {
          const tree = R.dom("ul", { class: "invite-group-list" });
          for (const entry of entries) {
            const item = R.dom("li");
            const key = scope + ":" + entry.key;
            const button = countFilterButton(entry.label, all.filter(entry.matches).length, selected.has(entry.key),
              ({ models }) => models.filter(entry.matches).length);
            button.dataset.inviteGroup = key;
            button.addEventListener("click", () => {
              if (!selected.delete(entry.key)) selected.add(entry.key);
              render();
              host.querySelector('[data-invite-group="' + CSS.escape(key) + '"]')?.focus({ preventScroll: true });
            });
            options.set(entry.key, entry.matches);
            item.append(button);
            if (entry.children) item.append(list(entry.children));
            tree.append(item);
          }
          return tree;
        }
        if (nodes.length) {
          const tree = R.dom("details", { class: "invite-group-tree" });
          tree.dataset.inviteGroupTree = scope;
          const heading = R.dom("summary");
          heading.append(R.dom("span", {}, T(label)), R.dom("b", {}, count));
          tree.append(heading, list(nodes));
          setDisclosure(tree, "invite-overview-group-tree:" + scope, scope === "top");
          host.append(tree);
        }
        const active = [];
        for (const key of selected) {
          const matches = options.get(key);
          if (matches) active.push(matches);
          else selected.delete(key);
        }
        if (active.length) filters.push(active);
      }
      return model => filters.every(options => options.some(matches => matches(model)));
    }

    function invitationNotSeen(model) {
      return !model.seen && (model.ready || model.sent);
    }

    function currentModel(id) {
      const store = getStore(), household = store.households.find(h => h.id === id && !h.archived_at);
      return household && store.guests.some(g => g.household_id === id && !g.archived_at) ? invitationOverview(household) : null;
    }
    function copyValue(model, kind) {
      if (!model) return null;
      if (kind === "recipient") return ["phone", "email"].includes(model.contactType) ? model.contactValue : null;
      if (!getStore().settings?.is_published || model.latest?.status !== "ready" ||
          model.service === "none" && model.latest.channel !== "manual" ||
          model.latest.invitation_code_snapshot && model.latest.invitation_code_snapshot !== model.h.invite_code) return null;
      return window.RSVP_INVITATION_TEXT.deliveryMessage(model.h, model.latest, R);
    }
    function setClipboardBusy(busy) {
      clipboardBusy = busy;
      for (const button of $("inviteRows").querySelectorAll("[data-invite-copy]")) {
        const id = button.closest("[data-invite-household]")?.dataset.inviteHousehold;
        button.disabled = busy || !getActor() || !can("invites") || !copyValue(currentModel(id), button.dataset.inviteCopy);
      }
    }
    function copyButton(model, kind, className) {
      const picture = kind === "invitation" && model.latest?.message_image;
      const label = kind === "recipient" ? "Copy" : kind === "message" ? "Copy message" : picture ? "Copy picture and text" : "Copy Invitation";
      const control = R.dom("button", { type: "button", class: className,
        disabled: clipboardBusy || !getActor() || !can("invites") || !copyValue(model, kind) });
      control.dataset.inviteCopy = kind;
      control.title = T(label);
      control.setAttribute("aria-label", T(label) + " · " + R.householdName(model.h));
      control.addEventListener("click", async event => {
        event.preventDefault(); event.stopPropagation();
        const actor = getActor(), captured = currentModel(model.h.id), value = copyValue(captured, kind);
        if (clipboardBusy || !actor || !can("invites") || !value || control.disabled) return;
        const attachment = kind === "invitation" ? captured.latest?.message_image : null;
        const image = attachment?.image, queueId = captured.latest?.id, revision = captured.latest?.revision;
        const current = () => {
          const fresh = currentModel(model.h.id);
          return actor === getActor() && can("invites") && control.isConnected && copyValue(fresh, kind) === value &&
            (kind === "recipient" || fresh.latest?.id === queueId && fresh.latest?.revision === revision &&
              (!attachment || fresh.latest?.message_image?.image === image));
        };
        // One clipboard operation at a time also prevents a slower picture
        // preparation from overwriting a later household's recipient/message.
        setClipboardBusy(true);
        try {
          if (attachment) {
            // Call synchronously in this click: Safari needs user activation.
            // The helper supplies promises for conversion rather than awaiting it.
            try {
              await window.RSVP_INVITATION_IMAGE.writeClipboard(attachment, value, { isCurrent: current });
            } catch (error) {
              if (!current()) return;
              await navigator.clipboard.writeText(value);
              if (current()) show(T("Invitation text copied."), "success");
              return;
            }
          } else await navigator.clipboard.writeText(value);
          if (current()) show(T(attachment ? "Picture and text copied. Check the caption after pasting." :
            kind === "message" ? "Invitation text copied." : "Copied"), "success");
        } catch (error) {
          if (current()) show(R.safeError(error), "error");
        } finally { setClipboardBusy(false); }
      });
      return control;
    }
    function overviewModels(store) {
      return ordered(store.households.filter(h => !h.archived_at &&
        store.guests.some(g => g.household_id === h.id && !g.archived_at)), "household_name")
        .map(household => invitationOverview(household, inviteSessionFilter, store));
    }
    function renderSeenSummary(visible) {
      const summary = $("inviteSeenSummary");
      const next = T("interface.messages.invites_seen_summary", {
        sent: visible.filter(model => model.sent).length,
        unseen: visible.filter(invitationNotSeen).length,
        seen: visible.filter(model => model.seen).length,
      });
      if (summary.textContent !== next) summary.textContent = next;
    }
    function refreshOverviewCounts() {
      const store = getOverviewStore(), models = overviewModels(store);
      const food = $("inviteFoodCounts") && can("food")
        ? window.RSVP_ADMIN_OVERVIEW.foodInterestCounts(store) : null;
      for (const [node, measure] of overviewCounters) {
        if (!node.isConnected) continue;
        const value = String(measure({ models, food }));
        if (node.textContent !== value) node.textContent = value;
      }
      // Keep the visible set and bulk selection stable until the next deliberate render.
      const visible = new Set(visibleHouseholdIds);
      renderSeenSummary(models.filter(model => visible.has(model.h.id)));
    }
    function render() {
      const store = getOverviewStore();
      overviewCounters.clear();
      const sessions = window.RSVP_ADMIN_OVERVIEW.rsvpSessions(store);
      if (!$("inviteSessionTree") || !sessions.some(session => session.id === inviteSessionFilter)) inviteSessionFilter = null;
      renderSessionTree(sessions);
      const box = $("inviteRows");
      box.replaceChildren();
      renderShownFields();
      box.dataset.rows = String(rowLayout);
      const displayedFields = rowLayout === 1 ? new Set([...shown, ...requiredFields]) : new Set([
        "householdInfo",
        ...columnGroups.filter(([key]) => requiredFields.includes(key) || shown.has(key)).flatMap(([, , fields]) => fields),
      ]);
      const search = $("inviteSearch").value.trim().toLowerCase(), all = overviewModels(store);
      const filters = [
        ["needs-draft", "No drafts", (r) => !r.latest],
        ["review", "Review", (r) => r.latest?.status === "draft"],
        ["ready", "Ready", (r) => r.ready],
        ["sent", "Sent", (r) => r.sent],
        ["unseen", "interface.messages.invites_unseen", invitationNotSeen],
        ["seen", "Seen", (r) => r.seen],
        ["awaiting", "Waiting Reply", (r) => r.sent && !r.replied],
        ["replied", "Replied", (r) => r.replied],
      ];
      const countHost = $("inviteOverviewCounts");
      const statusTotal = $("inviteStatusTotal");
      if (statusTotal) {
        statusTotal.textContent = String(all.length);
        overviewCounters.set(statusTotal, ({ models }) => models.length);
      }
      if (countHost) renderCountFilters(countHost, filters.map(([key, label, test]) =>
        [key, label, all.filter(test).length, ({ models }) => models.filter(test).length]),
        inviteOverviewFilter, "inviteFilter", next => { inviteOverviewFilter = next; });
      else inviteOverviewFilter = "all";
      const attendanceHost = $("inviteAttendanceCounts");
      if (attendanceHost) renderCountFilters(attendanceHost, [
        ["attending", "Attending"], ["declined", "Not attending"], ["pending", "Unanswered"],
      ].map(([key, label]) => {
        const count = models => models.reduce((sum, model) => sum + model.attendance[key], 0);
        return [key, label, count(all), ({ models }) => count(models)];
      }),
        inviteAttendanceFilter, "inviteAttendanceFilter", next => { inviteAttendanceFilter = next; });
      else inviteAttendanceFilter = "all";
      const matchesGroups = renderGroupTrees(store, all);
      const languageHost = $("inviteLanguageFilter"), serviceHost = $("inviteChannelFilter");
      const householdLanguage = row => row.h.language || store.settings?.default_language || "en";
      if (languageHost) {
        const languageChoices = languages();
        // Existing households can retain a disabled language; All must still show them.
        for (const code of new Set(all.map(householdLanguage))) {
          if (!languageChoices.some(([key]) => key === code))
            languageChoices.push(languages(code).find(([key]) => key === code) || [code, code.toUpperCase()]);
        }
        renderOptionFilter(languageHost, languageChoices, languageSelection, all, householdLanguage);
      } else languageSelection.clear();
      if (serviceHost) renderOptionFilter(serviceHost, Object.entries(serviceLabels), serviceSelection, all, row => row.service);
      else serviceSelection.clear();
      const canInterestFilter = can("food") && store.settings?.food_enabled !== false;
      const showFoodInterest = canInterestFilter && store.settings?.food_stage === "interest";
      const showFoodItems = can("food") && store.settings?.food_enabled !== false && store.settings?.food_stage === "selection";
      const showFood = displayedFields.has("food") && (showFoodInterest || showFoodItems);
      const foodHost = $("inviteFoodCounts");
      if (!canInterestFilter || !foodHost) inviteInterestFilter = "all";
      if (foodHost) {
        const interestBox = $("inviteFoodInterest") || foodHost;
        interestBox.hidden = !canInterestFilter;
        foodHost.hidden = !canInterestFilter;
        if (canInterestFilter) {
          const counts = window.RSVP_ADMIN_OVERVIEW.foodInterestCounts(store);
          renderCountFilters(foodHost, [["yes", "Yes"], ["no", "No"], ["unanswered", "Unanswered"]]
            .map(([key, label]) => [key, label, counts[key], ({ food }) => food?.[key] ?? 0]),
            inviteInterestFilter, "inviteFoodFilter", next => { inviteInterestFilter = next; });
        } else foodHost.replaceChildren();
      }
      const matchesFilters = (r) =>
        (!search ||
          [R.householdName(r.h), r.contactName, r.contactValue]
            .join(" ")
            .toLowerCase()
            .includes(search)) &&
        matchesGroups(r) &&
        (!inviteSessionFilter || r.total > 0) &&
        (inviteAttendanceFilter === "all" || r.attendance[inviteAttendanceFilter] > 0) &&
        (!languageSelection.size || languageSelection.has(householdLanguage(r))) &&
        (!serviceSelection.size || serviceSelection.has(r.service)) &&
        (!canInterestFilter || inviteInterestFilter === "all" ||
          window.RSVP_ADMIN_OVERVIEW.foodInterestStatus(store, r.h) === inviteInterestFilter);
      const test = filters.find(([key]) => key === inviteOverviewFilter)?.[2] || (() => true);
      const visible = all.filter(model => test(model) && matchesFilters(model));
      renderSeenSummary(visible);
      visibleHouseholdIds = visible.map(model => model.h.id);
      onVisibleHouseholds(visibleHouseholdIds.slice());
      box.classList.toggle("has-food-interest", showFoodInterest);
      const hasActions = !store.settings?.is_published && (canPreviewGuest() || can("households", "edit"));
      const columns = [
        { key: "identity", label: "Household" },
        ...visibleFields.flatMap(([key, label]) => {
          if (key === "food" || !displayedFields.has(key) || rowLayout === 2 && ["householdInfo", "recipient", "lastSent", "replyInfo"].includes(key)) return [];
          if (key === "replyInfo" && !visible.some(model => model.total)) return [];
          return [{ key, label }];
        }),
        ...(showFood ? [{ key: "food", label: "Food" }] : []),
        ...(hasActions ? [{ key: "actions", label: "Actions" }] : []),
        { key: "selection", label: "" },
      ];
      box.style.setProperty("--invite-columns", "minmax(140px, 1.5fr) " + columns.slice(1).map(col =>
        col.key === "selection" ? "74px" : col.key === "actions" ? "100px" :
        ["householdInfo", "serviceInfo", "lastSent", "replyInfo"].includes(col.key) ? "minmax(50px, .8fr)" :
        col.key === "delivery" && rowLayout === 1 ? "minmax(104px, 1.15fr)" : "minmax(80px, 1fr)").join(" "));
      const heading = R.dom("div", { class: "invite-overview-heading" });
      for (const col of columns) {
        const cell = R.dom("span", {}, col.label ? T(col.label) : "");
        if (col.key === "selection") {
          cell.className = "invite-overview-select";
          const selectAll = getSelectAllControl();
          if (selectAll) cell.append(selectAll);
        }
        heading.append(cell);
      }
      box.append(heading);
      const list = R.dom("div", { class: "invite-compact-list" });
      box.append(list);
      const renderedRows = new Map();
      function drawRow(model, container) {
        const h = model.h,
          originalHousehold = getStore().households.find(household => household.id === h.id),
          key = "invite-household:" + h.id,
          row = R.dom("details", { class: "invite-household" });
        row.dataset.inviteHousehold = h.id;
        setDisclosure(row, key);
        const summary = R.dom("summary", {
            class: "invite-compact-row invite-overview-row",
          }),
          identity = R.dom("span", { class: "invite-overview-identity" });
        identity.append(R.dom("strong", { class: "invite-compact-name" }, R.householdName(h)));
        const householdInfo = R.dom("span", { class: "invite-overview-household-info" });
        householdInfo.append(R.dom("small", { class: "muted invite-household-meta" },
          T("interface.messages.count_guests", { count: model.guests }) + " · " +
          (h.language || store.settings?.default_language || "en").toUpperCase()));
        householdInfo.setAttribute("aria-label", T("Household info") + ": " + householdInfo.textContent);
        const foodInterest = R.dom("span", { class: "invite-overview-interest" });
        if (showFoodInterest) {
          const state = window.RSVP_ADMIN_OVERVIEW.foodInterestStatus(store, h),
            label = T({ yes: "Yes", no: "No", unanswered: "–" }[state] || "Unanswered"),
            badge = R.dom("small", { class: "muted invite-food-interest" }, label);
          badge.dataset.foodInterest = state;
          foodInterest.setAttribute("aria-label", T("Food interest") + ": " + label);
          foodInterest.append(R.dom("small", { class: "muted invite-interest-label" }, T("Food")), badge);
        }
        if (showFoodItems) {
          const count = (store.claims || []).filter(c => c.household_id === h.id).reduce((n,c) => n + Number(c.quantity || 0), 0);
          foodInterest.append(R.dom("small", { class: "muted invite-interest-label" }, T("Food")), R.dom("small", { class: "invite-food-interest" }, count || "–"));
        }
        const recipient = R.dom("span", { class: "invite-overview-recipient" });
        recipient.append(R.dom("span", { class: "invite-recipient-name" }, model.contactName));
        const serviceInfo = R.dom("span", { class: "invite-overview-service-info" });
        const recipientCopy = copyButton(model, "recipient", "invite-copy-action invite-copy-recipient");
        recipientCopy.append(R.dom("span", { class: "invite-copy-pill" }, T(serviceLabels[model.service])));
        serviceInfo.append(recipientCopy);
        serviceInfo.setAttribute("aria-label", T("Service") + ": " + T(serviceLabels[model.service]));
        const delivery = R.dom("span", { class: "invite-overview-delivery" }),
          invitationActions = R.dom("span", { class: "invite-copy-options" }),
          sendFeedback = R.dom("span", { class: "invite-send-feedback" });
        sendFeedback.hidden = true;
        function renderInvitationActions() {
          const deliveryLabel = model.latest
            ? {
                draft: "Draft",
                ready: "Invitation",
                sent: "Marked sent",
                failed: "Failed",
                cancelled: "Cancelled",
              }[model.latest.status] || "Not sent"
            : "Not sent";
          invitationActions.replaceChildren();
          if (model.latest?.status === "draft") {
            const review = R.dom("button", {
              type: "button",
              class: "invite-copy-action invite-review-action",
            });
            review.setAttribute("aria-label", T("Review") + " · " + R.householdName(h));
            review.append(R.dom("span", { class: "invite-copy-pill" }, T("Review")));
            review.addEventListener("click", event => {
              event.preventDefault();
              event.stopPropagation();
              if (getActor() && can("invites") && row.isConnected) openCurrentDelivery(row, h.id);
            });
            invitationActions.append(review);
          } else {
            const invitation = copyButton(model, "invitation", "invite-copy-action invite-copy-invitation");
            invitation.append(R.dom("span", { class: "invite-copy-pill" }, T(deliveryLabel)));
            invitationActions.append(invitation);
            if (model.latest?.status === "ready") {
              const text = copyButton(model, "message", "invite-copy-action invite-copy-text");
              text.append(R.dom("span", { class: "invite-copy-pill" }, T("Text")));
              invitationActions.append(text);
            }
          }
        }
        function renderSendFeedback() {
          const state = getSentState(h.id);
          if (sendFeedback.dataset.inviteSendState === (state || "")) return;
          sendFeedback.hidden = !state;
          sendFeedback.dataset.inviteSendState = state || "";
          if (state === "pending") {
            sendFeedback.replaceChildren(R.dom("small", {}, T("Recording…")));
          } else if (state === "retry") {
            const retry = R.dom("button", { type: "button", class: "invite-send-retry",
              disabled: !can("sendInvites") || !getStore().settings?.is_published }, T("Retry"));
            retry.dataset.retryMarkSent = "";
            retry.setAttribute("aria-label", T("Retry") + " · " + R.householdName(h));
            retry.addEventListener("click", event => {
              event.preventDefault();
              event.stopPropagation();
              retrySent(h.id);
            });
            sendFeedback.replaceChildren(retry);
          } else sendFeedback.replaceChildren();
        }
        const seen = R.dom("small", { class: "muted invite-overview-seen" });
        const visitStatus = R.dom("span", { class: "invite-overview-visit-status" });
        function renderSeen() {
          seen.hidden = rowLayout === 2 && !(model.seen || invitationNotSeen(model));
          if (seen.hidden) {
            delete seen.dataset.inviteSeen;
            return;
          }
          seen.dataset.inviteSeen = model.seen ? "seen" : "unseen";
          if (rowLayout === 1) {
            seen.textContent = T(model.seen ? "Yes" : "No");
            return;
          }
          if (!model.seen) {
            seen.textContent = T("interface.messages.invites_unseen");
            return;
          }
          const visitedAt = h.last_visited_at || h.first_visited_at;
          const visitTime = visitedAt ? R.dom("time", {}, adminTime(visitedAt)) : null;
          if (visitTime) visitTime.dateTime = visitedAt;
          seen.replaceChildren(
            R.dom("span", { class: "sr-only" }, T("Seen") + " "),
            visitTime || "–",
          );
        }
        renderSeen();
        renderInvitationActions();
        renderSendFeedback();
        delivery.append(invitationActions, sendFeedback);
        if (rowLayout === 2) delivery.append(seen);
        else visitStatus.append(R.dom("small", { class: "muted invite-seen-label" }, T("Seen")), seen);
        const reply = R.dom("span", { class: "invite-overview-reply" });
        const replyStatus = document.createTextNode("");
        function renderReplyStatus() {
          replyStatus.data = T(
            model.replied
              ? "Replied"
              : model.answers
                ? "Partly answered"
                : model.sent
                  ? "Awaiting reply"
                  : "No reply",
          );
        }
        renderReplyStatus();
        reply.append(replyStatus);
        const replyInfo = R.dom("span", { class: "invite-overview-reply-info" });
        if (model.total)
          replyInfo.append(R.dom("small", { class: "muted" }, T("{answered} / {total} responses", {
            answered: model.answers, total: model.total,
          })));
        if (rowLayout === 2) {
          if (displayedFields.has("householdInfo")) identity.append(householdInfo);
          if (displayedFields.has("recipient")) serviceInfo.append(recipient);
          if (displayedFields.has("replyInfo") && model.total) reply.append(replyInfo);
        }
        const content = R.dom("div", { class: "invite-household-content" });
        let filled = false, facts, invitation, latestActivityRequest = 0;
        function renderHouseholdFacts() {
          const summary = householdFacts(h);
          const value = R.dom("dd", {}, model.lastSent ? adminTime(model.lastSent) : T("Not yet"));
          value.dataset.shortcutFact = "last_sent";
          summary.prepend(R.dom("dt", {}, T("Last sent")), value);
          return summary;
        }
        async function refreshActivity() {
          const actor = getActor();
          const readable = () => actor && actor === getActor() && can("invites") &&
            row.isConnected && row.open && !row.closest("[hidden], .hidden");
          if (!facts || !readable()) return;
          const request = ++latestActivityRequest;
          try {
            const activity = await managementRpc("admin_invitation_activity", { p_household_id: h.id });
            if (!activity || request !== latestActivityRequest || !readable() ||
                !getStore().households.includes(originalHousehold)) return;
            const { first_visited_at, last_visited_at, visit_count } = activity;
            // Refresh the dashboard's visit fields without replacing the open household.
            Object.assign(h, { first_visited_at, last_visited_at, visit_count });
            if (originalHousehold !== h)
              Object.assign(originalHousehold, { first_visited_at, last_visited_at, visit_count });
            const wasSeen = model.seen;
            model.seen = Number(visit_count) > 0;
            const next = renderHouseholdFacts();
            facts.replaceWith(next);
            facts = next;
            renderSeen();
            if (model.seen !== wasSeen) refreshOverviewCounts();
          } catch (_) {
            // Keep the dashboard's visit facts if the activity lookup is unavailable.
          }
        }
        activityReaders.set(row, refreshActivity);
        function renderInvitationSection() {
          const next = invitationSection(originalHousehold || h, model.latest);
          next.classList.add("invite-household-invitation");
          setDisclosure(next, key + ":invitation", true);
          for (const section of next.querySelectorAll("[data-invite-delivery-submenu]"))
            setDisclosure(section, key + ":invitation:" + section.dataset.inviteDeliverySubmenu);
          return next;
        }
        function fillSections() {
          if (filled) return;
          filled = true;
          if (householdFacts) {
            facts = renderHouseholdFacts();
            content.append(facts);
          }
          const rsvp = rsvpSection(originalHousehold || h);
          rsvp.id = "invite-rsvp-" + h.id;
          rsvp.querySelector("summary").replaceChildren(T("RSVP"), " ",
            R.dom("small", { class: "invite-rsvp-state muted" }, T(h.rsvp_state === "locked" ? "Locked" : "Open")));
          setDisclosure(rsvp, key + ":rsvp");
          invitation = renderInvitationSection();
          content.append(rsvp, invitation);
        }
        row.addEventListener("toggle", () => {
          if (!row.open) return;
          fillSections();
          refreshActivity();
        });
        if (row.open) fillSections();
        const actions = R.dom("span", { class: "invite-row-actions" });
        if (!store.settings?.is_published && canPreviewGuest()) {
          const preview = R.dom("a", { class: "admin-row-icon invite-preview" });
          preview.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
          preview.title = T("Preview");
          preview.href = R.guestPreviewURL(h.id);
          preview.target = "_blank";
          preview.rel = "noopener noreferrer";
          preview.setAttribute(
            "aria-label",
            T("Preview") + " · " + R.householdName(h),
          );
          actions.append(preview);
        }

        if (!store.settings?.is_published && can("households", "edit")) {
          const edit = iconAction("edit", T("interface.messages.edit_household") + R.householdName(h), () => editHousehold(h.id)); edit.classList.add("invite-edit-household"); actions.append(edit);
        }
        const selection = R.dom("span", { class: "invite-overview-select" });
        const select = getSelectionControl(h.id);
        // The shared control owns eligibility and native checkbox
        // activation; its label isolates clicks/keys from this summary.
        if (select) selection.append(select);
        const cells = { identity, householdInfo, recipient, serviceInfo, delivery, lastSent: visitStatus, reply, replyInfo, food: foodInterest, actions, selection };
        for (const col of columns) summary.append(cells[col.key]);
        row.append(summary, content);
        container.append(row);
        function refreshSentRow(next) {
          const focused = document.activeElement;
          const retryWasFocused = sendFeedback.contains(focused);
          if (next) {
            Object.assign(model, next);
            renderInvitationActions();
            renderReplyStatus();
            renderSeen();
            const lastSent = facts?.querySelector('[data-shortcut-fact="last_sent"]');
            if (lastSent) lastSent.textContent = model.lastSent ? adminTime(model.lastSent) : T("Not yet");
            // Preserve an open editor while reconciling a background save.
            if (invitation && !invitation.contains(focused) &&
                !invitation.querySelector('[data-dirty="true"], .record-open, .local-editor-open')) {
              const nextSection = renderInvitationSection();
              invitation.replaceWith(nextSection);
              invitation = nextSection;
            }
          }
          renderSendFeedback();
          const current = selection.querySelector("input"), fresh = getSelectionControl(h.id)?.querySelector("input");
          if (current && fresh) {
            current.checked = fresh.checked;
            current.disabled = fresh.disabled;
          }
          if ((retryWasFocused && !sendFeedback.contains(focused)) ||
              (next && !focused?.isConnected) || focused === current && current?.disabled)
            summary.focus({ preventScroll: true });
        }
        renderedRows.set(h.id, { row, refreshSentRow });
        return row;
      }
      const grouping = window.RSVP_ADMIN_PREFERENCES.invitesGrouping;
      const groupSections = [], destinations = new Map();
      const visibleIds = new Set(visibleHouseholdIds);
      function drawGroup(section, models) {
        const destination = { section, ids: models.map(model => model.h.id) };
        if (section !== list) groupSections.push(section);
        for (const model of models) {
          destinations.set(model.h.id, destination);
          if (visibleIds.has(model.h.id)) drawRow(model, section);
        }
        if (section !== list && section.childElementCount > 1) list.append(section);
      }
      function inTreeOrder(members, tree) {
        const models = new Map(members.map(model => [model.h.id, model]));
        return tree.map(household => models.get(household.id)).filter(Boolean);
      }
      box.classList.toggle("is-grouped", grouping !== "none");
      if (grouping === "service") {
        const tree = R.householdTreeOrder(store.households.filter(h => !h.archived_at), ordered);
        for (const service of Object.keys(serviceLabels)) {
          const members = all.filter(model => model.service === service);
          if (!members.length) continue;
          const section = R.dom("section", { class: "invite-overview-group" });
          section.dataset.inviteService = service;
          section.setAttribute("aria-label", T(serviceLabels[service]));
          section.append(R.dom("h3", {}, T(serviceLabels[service])));
          drawGroup(section, inTreeOrder(members, tree));
        }
      } else if (grouping === "relational") {
        for (const top of planningConfiguration().groups) {
          const members = all.filter(
            (r) => r.h.planning_group_id === top.id,
          );
          const households = store.households.filter(
            (h) => !h.archived_at && h.planning_group_id === top.id,
          );
          for (const groupId of R.relationGroupOrder(
            top.id,
            households,
            store.relationGroups,
          )) {
            const groupMembers = members.filter(
              (r) => (r.h.relation_group_id || "") === groupId,
            );
            if (!groupMembers.length) continue;
            const section = R.dom("section", {
              class: "invite-overview-group",
            });
            section.dataset.planningGroupId = top.id;
            section.dataset.relationGroupId = groupId;
            section.append(
              R.dom(
                "h3",
                {},
                groupLabel(top.id) +
                  " / " +
                  (store.relationGroups.find((g) => g.id === groupId)?.name ||
                    T("Ungrouped")),
              ),
            );
            const tree = R.householdTreeOrder(
              households.filter((h) => (h.relation_group_id || "") === groupId),
              ordered,
            );
            drawGroup(section, inTreeOrder(groupMembers, tree));
          }
        }
        const knownGroups = new Set(planningConfiguration().groups.map(group => group.id));
        const ungrouped = all.filter(model => !knownGroups.has(model.h.planning_group_id));
        if (ungrouped.length) {
          const section = R.dom("section", { class: "invite-overview-group" });
          section.dataset.planningGroupId = "";
          section.dataset.relationGroupId = "";
          section.append(R.dom("h3", {}, T("Ungrouped")));
          drawGroup(section, inTreeOrder(ungrouped, R.householdTreeOrder(ungrouped.map(model => model.h), ordered)));
        }
      } else drawGroup(list, all);
      let inactiveShown = false;
      if (can("invites") && inviteOverviewFilter === "all" && inviteInterestFilter === "all" && inviteAttendanceFilter === "all") {
        const activeIds = new Set(all.map(model => model.h.id));
        const historyIds = new Set(store.queue.map(record => record.household_id));
        const inactive = ordered(store.households.filter(h => !activeIds.has(h.id) && historyIds.has(h.id)), "household_name")
          .map(household => invitationOverview(household, inviteSessionFilter)).filter(matchesFilters);
        if (inactive.length) {
          box.append(inactiveHouseholds(inactive, Boolean(search)));
          inactiveShown = true;
        }
      }
      const empty = R.dom("p", { class: "muted" });
      function renderEmpty(models) {
        empty.textContent = T(inviteOverviewFilter === "needs-draft" && models.every(model => model.latest)
          ? "No households need a draft."
          : "No households match these filters.");
        if (!visibleHouseholdIds.length && !inactiveShown) {
          if (!empty.isConnected) list.append(empty);
        } else empty.remove();
      }
      renderEmpty(all);

      function refreshSelectionHeading() {
        const cell = heading.querySelector(".invite-overview-select");
        if (!cell) return;
        const current = cell.querySelector("[data-bulk-select-all]");
        const fresh = getSelectAllControl();
        const input = fresh?.querySelector("[data-bulk-select-all]");
        if (!current || !input) return;
        current.checked = input.checked;
        current.indeterminate = input.indeterminate;
        current.disabled = input.disabled;
        const count = cell.querySelector("#inviteSelectionCount");
        if (count) count.textContent = fresh.querySelector("#inviteSelectionCount").textContent;
      }
      refreshSentRows = (ids, { recorded = false } = {}) => {
        if (!box.contains(list)) return;
        if (!recorded) {
          for (const id of ids) renderedRows.get(id)?.refreshSentRow();
          refreshSelectionHeading();
          return;
        }
        const models = overviewModels(getOverviewStore());
        const previousIds = new Set(visibleHouseholdIds), changedIds = new Set(ids);
        const matches = models.filter(model => changedIds.has(model.h.id)
          ? test(model) && matchesFilters(model) : previousIds.has(model.h.id));
        const matchingRows = new Map(matches.map(model => [model.h.id, model]));
        const nextIds = matches.map(model => model.h.id);
        if (nextIds.length !== visibleHouseholdIds.length ||
            nextIds.some((id, index) => id !== visibleHouseholdIds[index])) {
          visibleHouseholdIds = nextIds;
          onVisibleHouseholds(nextIds.slice());
        }
        for (const id of ids) {
          const prior = renderedRows.get(id), next = matchingRows.get(id);
          if (prior && next) {
            prior.refreshSentRow(next);
          } else if (prior) {
            const section = prior.row.parentElement;
            const restoreFocus = prior.row.contains(document.activeElement);
            prior.row.remove();
            renderedRows.delete(id);
            if (section !== list && section.childElementCount === 1) section.remove();
            if (restoreFocus) {
              const filter = countHost?.querySelector('[aria-pressed="true"]');
              (filter?.getClientRects().length ? filter : $("inviteSearchToggle"))?.focus({ preventScroll: true });
            }
          } else if (next && destinations.has(id)) {
            const { section, ids: siblings } = destinations.get(id);
            if (!section.isConnected) {
              const following = groupSections.slice(groupSections.indexOf(section) + 1).find(group => group.isConnected);
              list.insertBefore(section, following || null);
            }
            const row = drawRow(next, section);
            const following = siblings.slice(siblings.indexOf(id) + 1)
              .map(sibling => renderedRows.get(sibling)?.row).find(sibling => sibling?.parentElement === section);
            section.insertBefore(row, following || null);
          }
        }
        refreshOverviewCounts();
        refreshSelectionHeading();
        renderEmpty(models);
      };
      refreshInvitationActivity();
    }

    function inactiveHouseholds(models, searching) {
      const group = R.dom("details", { class: "admin-management invite-inactive-households" });
      group.append(R.dom("summary", {}, T("Inactive households") + " · " + models.length));
      setDisclosure(group, "invite-inactive-households", searching);
      for (const { h } of models) {
        const row = R.dom("details", { class: "admin-management" });
        row.dataset.inviteInactiveHousehold = h.id;
        const label = R.householdName(h) + (h.archived_at ? T("interface.messages.archived_2") : "");
        row.append(R.dom("summary", {}, label));
        const key = "invite-inactive-household:" + h.id;
        function fill() {
          if (!row.open || row.childElementCount > 1) return;
          const details = deliverySection(h, { historyOnly: true });
          details.id = "invite-delivery-" + h.id;
          setDisclosure(details, key + ":delivery", true);
          row.append(details);
        }
        setDisclosure(row, key);
        row.addEventListener("toggle", fill);
        fill();
        group.append(row);
      }
      return group;
    }

    function openHousehold(householdId) {
      inviteOverviewFilter = "all";
      inviteInterestFilter = "all";
      inviteAttendanceFilter = "all";
      inviteSessionFilter = null;
      for (const selected of Object.values(groupSelections)) selected.clear();
      languageSelection.clear();
      serviceSelection.clear();
      $("inviteSearch").value = "";
      rememberDisclosure("invite-household:" + householdId, true);
      render();
      const rows = $("inviteRows");
      const escapedId = CSS.escape(householdId);
      const row = rows.querySelector('[data-invite-household="' + escapedId + '"]') ||
        rows.querySelector('[data-invite-inactive-household="' + escapedId + '"]');
      if (!row) { window.RSVP_ADMIN_SEARCH.enhance({ R, T, iconAction }).open("inviteSearch"); return; }
      if (!row.dataset.inviteInactiveHousehold) {
        openCurrentDelivery(row, householdId);
        return;
      }
      row.parentElement.open = true;
      row.open = true;
      row.dispatchEvent(new Event("toggle"));
      const delivery = row.querySelector("#invite-delivery-" + escapedId);
      if (delivery) delivery.open = true;
      row.scrollIntoView({ block: "nearest" });
      row.querySelector("summary")?.focus();
    }
    wideScreen.addEventListener("change", () => {
      rowOverride = undefined;
      if (getActor() && getStore().settings && can("invites")) render();
    });
    function closeOutsideShownFields(event) {
      const dropdown = $("inviteShownFieldsHost")?.querySelector("details[open]");
      if (dropdown && !dropdown.contains(event.target)) dropdown.open = false;
    }
    document.addEventListener("pointerdown", closeOutsideShownFields);
    document.addEventListener("focusin", closeOutsideShownFields);
    return { render, openHousehold, refreshInvitationActivity, refreshOverviewCounts,
      refreshSentRows: (...args) => refreshSentRows(...args),
      getVisibleHouseholdIds: () => visibleHouseholdIds.slice() };
  }
  window.RSVP_ADMIN_INVITES = { create };
})();
