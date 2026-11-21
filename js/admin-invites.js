// Delivery overview presentation only. The controller supplies current data,
// permissions, disclosure state and the existing section/action builders.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    getActor,
    ordered,
    invitationOverview,
    planningConfiguration,
    groupLabel,
    languages,
    contactMethodLabel,
    canPreviewGuest,
    can,
    iconAction,
    editHousehold,
    setDisclosure,
    rememberDisclosure,
    deliverySection,
    deliveryEditor,
    invitationTemplateChoices,
    invitationDraft,
    managementRpc,
    reload,
    rsvpSection,
    householdFacts,
    adminTime,
    show,
    onDeliveryFilterChange,
    getSelectionControl = () => null,
    onVisibleHouseholds = () => {},
  }) {
    const $ = R.byId;
    let inviteOverviewFilter = "all", inviteInterestFilter = "all", visibleHouseholdIds = [];
    const filterStates = new Map();
    const serviceLabels = { messages: "Messages", email: "Email", whatsapp: "WhatsApp", sms: "SMS", none: "None" };
    const deliveryStates = ["draft", "ready", "sent", "failed", "cancelled"];
    const visibleFields = window.RSVP_ADMIN_PREFERENCES.invitesFields;
    const columnGroups = window.RSVP_ADMIN_PREFERENCES.invitesColumnGroups;
    const requiredFields = window.RSVP_ADMIN_PREFERENCES.invitesRequiredFields;
    const shown = new Set();
    let shownOwner, shownDefaults, shownColumnDefaults, rowLayout = 1, oneRowShown = [], clipboardBusy = false;

    function renderRowsLayout() {
      for (const input of $("inviteRowsLayout").querySelectorAll("input")) {
        input.checked = Number(input.value) === rowLayout;
        if (input.dataset.bound) continue;
        input.dataset.bound = "true";
        input.addEventListener("change", () => {
          if (!input.checked || !["1", "2"].includes(input.value)) return;
          const next = Number(input.value);
          if (next === rowLayout) return;
          if (next === 2) oneRowShown = [...shown];
          shown.clear();
          for (const key of next === 2 ? window.RSVP_ADMIN_PREFERENCES.invitesTwoRowColumns : oneRowShown) shown.add(key);
          rowLayout = next;
          $("inviteShownFieldsHost").replaceChildren();
          render();
        });
      }
    }
    function renderShownFields() {
      const host = $("inviteShownFieldsHost");
      const owner = getActor(), defaults = window.RSVP_ADMIN_PREFERENCES.invitesShownFields;
      const columnDefaults = window.RSVP_ADMIN_PREFERENCES.invitesTwoRowColumns;
      const signature = JSON.stringify(defaults), columnSignature = JSON.stringify(columnDefaults);
      const changedOwner = shownOwner !== owner, changedFields = shownDefaults !== signature;
      const changedColumns = shownColumnDefaults !== columnSignature;
      // Each layout has its own defaults. Changing one must not discard the
      // other layout's temporary choices; account changes always start at 1.
      if (changedOwner || changedFields) oneRowShown = defaults.slice();
      if (changedOwner) rowLayout = 1;
      if (changedOwner || rowLayout === 1 && changedFields || rowLayout === 2 && changedColumns) {
        shown.clear();
        for (const key of rowLayout === 2 ? columnDefaults : oneRowShown) shown.add(key);
        host.replaceChildren();
      }
      shownOwner = owner;
      shownDefaults = signature;
      shownColumnDefaults = columnSignature;
      if (host.childElementCount) return;
      host.append(window.RSVP_INLINE.multiChoice({
        R,
        T,
        label: "Shown fields",
        options: (rowLayout === 1 ? visibleFields : columnGroups).filter(([key]) => !requiredFields.includes(key)),
        selected: shown,
        onChange: render,
        className: "invite-shown-fields",
      }));
    }
    function openDelivery(h) {
      const row = [...$("inviteRows").querySelectorAll("[data-invite-household]")].find(n => n.dataset.inviteHousehold === h.id);
      if (!row) return;
      for (let parent = row.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
      row.open = true; row.dispatchEvent(new Event("toggle"));
      const section = document.getElementById("invite-delivery-" + h.id);
      if (section) { section.open = true; const latest = section.querySelector("[data-delivery-id]"); if (latest) latest.open = true; }
      rememberDisclosure("invite-household:" + h.id, true);
      rememberDisclosure("invite-household:" + h.id + ":delivery", true);
    }
    function filterChoices(id, label, values, openFilter) {
      const host = $(id), keys = new Set(values.map(([key]) => key));
      let state = filterStates.get(id);
      if (!state) {
        state = { selected: new Set(keys), keys };
        filterStates.set(id, state);
      } else {
        const all = state.selected.size === state.keys.size && [...state.keys].every(key => state.selected.has(key));
        for (const key of state.selected) if (!keys.has(key)) state.selected.delete(key);
        if (all) for (const key of keys) state.selected.add(key);
        state.keys = keys;
      }
      const dropdown = window.RSVP_INLINE.multiChoice({
        R, T, label, options: values, selected: state.selected, group: "invite-overview-filters",
        onChange(key) {
          render();
          if (id === "deliveryStatusFilter") onDeliveryFilterChange();
          $(id).querySelector('[data-value="' + CSS.escape(key) + '"]')?.focus({ preventScroll: true });
        },
      });
      dropdown.open = openFilter === id;
      host.replaceChildren(dropdown);
      return state.selected;
    }
    function currentModel(id) {
      const store = getStore(), household = store.households.find(h => h.id === id && !h.archived_at);
      return household && store.guests.some(g => g.household_id === id && !g.archived_at) ? invitationOverview(household) : null;
    }
    function copyValue(model, kind) {
      if (!model) return null;
      if (kind === "recipient") return ["phone", "email"].includes(model.contactType) ? model.contactValue : null;
      if (!getStore().settings?.is_published || !["draft", "ready"].includes(model.latest?.status) ||
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
            (!attachment || fresh.latest?.id === queueId && fresh.latest?.revision === revision && fresh.latest?.message_image?.image === image);
        };
        // One clipboard operation at a time also prevents a slower picture
        // preparation from overwriting a later household's recipient/message.
        setClipboardBusy(true);
        try {
          if (attachment) {
            // Call synchronously in this click: Safari needs user activation.
            // The helper supplies promises for conversion rather than awaiting it.
            await window.RSVP_INVITATION_IMAGE.writeClipboard(attachment, value, { isCurrent: current });
          } else await navigator.clipboard.writeText(value);
          if (current()) show(T(attachment ? "Picture and text copied. Check the caption after pasting." : "Copied"), "success");
        } catch (error) {
          if (current()) show(attachment
            ? T("Picture and text could not be copied. Use Text to copy the invitation message.")
            : R.safeError(error), "error");
        } finally { setClipboardBusy(false); }
      });
      return control;
    }
    function render() {
      const store = getStore();
      const box = $("inviteRows");
      box.replaceChildren();
      renderShownFields();
      renderRowsLayout();
      box.dataset.rows = String(rowLayout);
      const displayedFields = rowLayout === 1 ? new Set([...shown, ...requiredFields]) : new Set([
        "householdInfo",
        ...columnGroups.filter(([key]) => requiredFields.includes(key) || shown.has(key)).flatMap(([, , fields]) => fields),
      ]);
      const search = $("inviteSearch").value.trim().toLowerCase(),
        all = ordered(
          store.households.filter(
            (h) =>
              !h.archived_at &&
              store.guests.some(
                (g) => g.household_id === h.id && !g.archived_at,
              ),
          ),
          "household_name",
        ).map(invitationOverview);
      const filters = [
        ["all", "All", () => true],
        ["not-sent", "Not sent", (r) => !r.sent],
        ["ready", "Ready", (r) => r.ready],
        ["sent", "Marked sent", (r) => r.sent],
        ["awaiting", "Awaiting reply", (r) => r.sent && !r.replied],
        ["replied", "Replied", (r) => r.replied],
      ];
      const countHost = $("inviteOverviewCounts");
      if (countHost) countHost.replaceChildren();
      const statusTotal = $("inviteStatusTotal");
      if (statusTotal) statusTotal.textContent = String(all.length);
      for (const [key, label, test] of countHost ? filters : []) {
        const button = R.dom(
          "button",
          { type: "button", class: "stat-row invite-stat-row invite-count-filter" },
        );
        button.dataset.inviteFilter = key;
        button.setAttribute(
          "aria-pressed",
          String(inviteOverviewFilter === key),
        );
        button.classList.toggle("is-selected", inviteOverviewFilter === key);
        button.append(R.dom("span", {}, T(label)), R.dom("b", {}, all.filter(test).length));
        button.addEventListener("click", () => {
          inviteOverviewFilter = key;
          if (key === "all") inviteInterestFilter = "all";
          render();
        });
        countHost.append(button);
      }
      const openFilter = ["inviteGroupFilter", "inviteLanguageFilter", "inviteChannelFilter", "deliveryStatusFilter"]
        .find(id => $(id).querySelector("details[open]"));
      const groups = filterChoices("inviteGroupFilter", "Group", [
        ...planningConfiguration().groups.map(g => ["top:" + g.id, groupLabel(g.id)]),
        ...ordered(store.relationGroups, "name").map(g => ["relation:" + g.id, g.name]),
      ], openFilter);
      const languageChoices = languages();
      // Existing households can retain a disabled language; All must still show them.
      for (const code of new Set(all.map(row => row.h.language || store.settings?.default_language || "en"))) {
        if (!languageChoices.some(([key]) => key === code))
          languageChoices.push(languages(code).find(([key]) => key === code) || [code, code.toUpperCase()]);
      }
      const selectedLanguages = filterChoices("inviteLanguageFilter", "Language", languageChoices, openFilter);
      const services = filterChoices("inviteChannelFilter", "Services", Object.entries(serviceLabels), openFilter);
      filterChoices("deliveryStatusFilter", "Filter delivery status", deliveryStates.map(key => [key,
        ({ draft: "Draft", ready: "Ready", sent: "Recorded sent", failed: "Failed", cancelled: "Cancelled" })[key]]), openFilter);
      const canInterestFilter = can("food") && store.settings?.food_enabled !== false;
      const showFoodInterest = canInterestFilter && store.settings?.food_stage === "interest";
      const showFoodItems = can("food") && store.settings?.food_enabled !== false && store.settings?.food_stage === "selection";
      const showFood = displayedFields.has("food") && (showFoodInterest || showFoodItems);
      if (!canInterestFilter) inviteInterestFilter = "all";
      const foodHost = $("inviteFoodCounts");
      if (foodHost) {
        foodHost.replaceChildren();
        const interestBox = $("inviteFoodInterest") || foodHost;
        interestBox.hidden = !canInterestFilter;
        foodHost.hidden = !canInterestFilter;
        if (canInterestFilter) {
          const counts = window.RSVP_ADMIN_OVERVIEW.foodInterestCounts(store);
          for (const [key, label] of [["yes", "Yes"], ["no", "No"], ["unanswered", "Unanswered"]]) {
            const control = R.dom("button", { type: "button", class: "stat-row invite-stat-row invite-food-filter" });
            control.dataset.inviteFoodFilter = key;
            control.setAttribute("aria-pressed", String(inviteInterestFilter === key));
            control.classList.toggle("is-selected", inviteInterestFilter === key);
            control.append(R.dom("span", {}, T(label)), R.dom("b", {}, counts[key]));
            control.addEventListener("click", () => {
              inviteInterestFilter = inviteInterestFilter === key ? "all" : key;
              render();
            });
            foodHost.append(control);
          }
        }
      }
      const test =
          filters.find(([key]) => key === inviteOverviewFilter)?.[2] ||
          (() => true),
        visible = all.filter(
          (r) =>
            test(r) &&
            (!search ||
              [R.householdName(r.h), r.contactName, r.contactValue]
                .join(" ")
                .toLowerCase()
                .includes(search)) &&
            (groups.size === filterStates.get("inviteGroupFilter").keys.size || groups.has("top:" + r.h.planning_group_id) || groups.has("relation:" + r.h.relation_group_id)) &&
            selectedLanguages.has(r.h.language || store.settings?.default_language || "en") &&
            services.has(r.service) &&
            (!canInterestFilter || inviteInterestFilter === "all" ||
              window.RSVP_ADMIN_OVERVIEW.foodInterestStatus(store, r.h) === inviteInterestFilter),
        );
      visibleHouseholdIds = visible.map(model => model.h.id);
      onVisibleHouseholds(visibleHouseholdIds.slice());
      $("inviteResultCount").hidden = true;
      box.classList.toggle("has-food-interest", showFoodInterest);
      const hasActions = !store.settings?.is_published && (canPreviewGuest() || can("households", "edit"));
      const columns = [
        { key: "identity", label: "Household" },
        ...visibleFields.flatMap(([key, label]) => {
          if (key === "food" || !displayedFields.has(key) || rowLayout === 2 && ["householdInfo", "recipient", "lastSent", "replyInfo"].includes(key)) return [];
          if (key === "lastSent" && !visible.some(model => model.lastSent) || key === "replyInfo" && !visible.some(model => model.total)) return [];
          return [{ key, label }];
        }),
        ...(showFood ? [{ key: "food", label: showFoodInterest ? "Food interest" : "Food items" }] : []),
        ...(hasActions ? [{ key: "actions", label: "Actions" }] : []),
        { key: "selection", label: "" },
      ];
      box.style.setProperty("--invite-columns", "minmax(140px, 1.5fr) " + columns.slice(1).map(col =>
        col.key === "selection" ? "44px" : col.key === "actions" ? "100px" :
        ["householdInfo", "serviceInfo", "replyInfo"].includes(col.key) ? "minmax(50px, .8fr)" :
        col.key === "lastSent" ? "minmax(65px, 1fr)" : "minmax(80px, 1fr)").join(" "));
      const heading = R.dom("div", { class: "invite-overview-heading" });
      for (const col of columns) {
        const cell = R.dom("span", {}, col.label ? T(col.label) : "");
        if (col.key === "selection") {
          cell.className = "invite-overview-select";
          cell.setAttribute("aria-label", T("Selected"));
        }
        heading.append(cell);
      }
      box.append(heading);
      const list = R.dom("div", { class: "invite-compact-list" });
      box.append(list);
      function drawRow(model, container) {
        const h = model.h,
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
          foodInterest.append(R.dom("small", { class: "muted invite-interest-label" }, T("Food interest")), badge);
        }
        if (showFoodItems) {
          const count = (store.claims || []).filter(c => c.household_id === h.id).reduce((n,c) => n + Number(c.quantity || 0), 0);
          foodInterest.append(R.dom("small", { class: "muted invite-interest-label" }, T("Food items")), R.dom("small", { class: "invite-food-interest" }, count || "–"));
        }
        const recipient = R.dom("span", { class: "invite-overview-recipient" });
        recipient.append(R.dom("span", { class: "invite-recipient-name" }, model.contactName));
        const serviceInfo = R.dom("span", { class: "invite-overview-service-info" });
        const recipientCopy = copyButton(model, "recipient", "invite-copy-action invite-copy-recipient");
        recipientCopy.append(R.dom("span", { class: "invite-copy-pill" }, T(serviceLabels[model.service])));
        serviceInfo.append(recipientCopy);
        serviceInfo.setAttribute("aria-label", T("Service") + ": " + T(serviceLabels[model.service]));
        const delivery = R.dom("span", { class: "invite-overview-delivery" }),
          deliveryLabel = model.latest
            ? {
                draft: "Draft",
                ready: "Ready",
                sent: "Marked sent",
                failed: "Failed",
                cancelled: "Cancelled",
              }[model.latest.status] || "Not sent"
            : "Not sent";
        const invitation = copyButton(model, "invitation", "invite-copy-action invite-copy-invitation");
        invitation.append(R.dom("span", { class: "invite-copy-pill" }, T(deliveryLabel)));
        const invitationActions = R.dom("span", { class: "invite-copy-options" });
        invitationActions.append(invitation);
        if (model.latest?.message_image && ["draft", "ready"].includes(model.latest.status)) {
          const textOnly = copyButton(model, "message", "invite-copy-action invite-copy-text");
          textOnly.append(R.dom("span", { class: "invite-copy-pill" }, T("Text")));
          invitationActions.append(textOnly);
        }
        delivery.append(invitationActions);
        const lastSent = R.dom("span", { class: "invite-overview-last-sent" });
        if (model.lastSent) {
          lastSent.append(R.dom("small", { class: "muted" },
            (rowLayout === 2 ? T("Last sent") + " " : "") + adminTime(model.lastSent)));
        }
        const reply = R.dom(
          "span",
          { class: "invite-overview-reply" },
          T(
            model.replied
              ? "Replied"
              : model.answers
                ? "Partly answered"
                : model.sent
                  ? "Awaiting reply"
                  : "No reply",
          ),
        );
        const replyInfo = R.dom("span", { class: "invite-overview-reply-info" });
        if (model.total)
          replyInfo.append(R.dom("small", { class: "muted" }, T("{answered} / {total} responses", {
            answered: model.answers, total: model.total,
          })));
        if (rowLayout === 2) {
          if (displayedFields.has("householdInfo")) identity.append(householdInfo);
          if (displayedFields.has("recipient")) serviceInfo.append(recipient);
          if (displayedFields.has("lastSent") && model.lastSent) delivery.append(lastSent);
          if (displayedFields.has("replyInfo") && model.total) reply.append(replyInfo);
        }
        const content = R.dom("div", { class: "invite-household-content" });
        let filled = false;
        function fillSections() {
          if (filled) return;
          filled = true;
          if (householdFacts) content.append(householdFacts(h));
          for (const [section, label, build] of [
            ["delivery", "Invitation delivery", (household) => deliverySection(household, { allowCreate: true })],
            ["rsvp", "RSVP", rsvpSection],
          ]) {
            if (section === "delivery" && !store.queue.some(q => q.household_id === h.id)) continue;
            const detail = build(h);
            detail.id = "invite-" + section + "-" + h.id;
            detail.querySelector("summary").textContent = T(label);
            if (section === "rsvp")
              detail
                .querySelector("summary")
                .append(
                  " ",
                  R.dom(
                    "small",
                    { class: "invite-rsvp-state muted" },
                    T(h.rsvp_state === "locked" ? "Locked" : "Open"),
                  ),
                );
            setDisclosure(detail, key + ":" + section, section === "delivery");
            content.append(detail);
          }
        }
        row.addEventListener("toggle", () => {
          if (row.open) fillSections();
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
        // The shared control owns eligibility, max-ten and native checkbox
        // activation; its label isolates clicks/keys from this summary.
        if (select) selection.append(select);
        const cells = { identity, householdInfo, recipient, serviceInfo, delivery, lastSent, reply, replyInfo, food: foodInterest, actions, selection };
        for (const col of columns) summary.append(cells[col.key]);
        row.append(summary, content);
        container.append(row);
      }
      const grouping = window.RSVP_ADMIN_PREFERENCES.invitesGrouping;
      box.classList.toggle("is-grouped", grouping !== "none");
      if (grouping === "service") {
        const tree = R.householdTreeOrder(store.households.filter(h => !h.archived_at), ordered);
        for (const service of Object.keys(serviceLabels)) {
          const members = visible.filter(model => model.service === service);
          if (!members.length) continue;
          const section = R.dom("section", { class: "invite-overview-group" });
          section.dataset.inviteService = service;
          section.setAttribute("aria-label", T(serviceLabels[service]));
          section.append(R.dom("h3", {}, T(serviceLabels[service])));
          const models = new Map(members.map(model => [model.h.id, model]));
          for (const household of tree) {
            const model = models.get(household.id);
            if (model) drawRow(model, section);
          }
          list.append(section);
        }
      } else if (grouping === "relational") {
        for (const top of planningConfiguration().groups) {
          const members = visible.filter(
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
            const models = new Map(
              groupMembers.map((model) => [model.h.id, model]),
            );
            const tree = R.householdTreeOrder(
              households.filter((h) => (h.relation_group_id || "") === groupId),
              ordered,
            );
            for (const household of tree) {
              const model = models.get(household.id);
              if (model) drawRow(model, section);
            }
            list.append(section);
          }
        }
        const knownGroups = new Set(planningConfiguration().groups.map(group => group.id));
        const ungrouped = visible.filter(model => !knownGroups.has(model.h.planning_group_id));
        if (ungrouped.length) {
          const section = R.dom("section", { class: "invite-overview-group" });
          section.dataset.planningGroupId = "";
          section.dataset.relationGroupId = "";
          section.append(R.dom("h3", {}, T("Ungrouped")));
          const models = new Map(ungrouped.map(model => [model.h.id, model]));
          for (const household of R.householdTreeOrder(ungrouped.map(model => model.h), ordered))
            drawRow(models.get(household.id), section);
          list.append(section);
        }
      } else for (const model of visible) drawRow(model, list);
      if (!visible.length)
        list.append(
          R.dom(
            "p",
            { class: "muted" },
            T("No households match these filters."),
          ),
        );

    }

    function openHousehold(householdId) {
      inviteOverviewFilter = "all";
      inviteInterestFilter = "all";
      $("inviteSearch").value = "";
      for (const [id, state] of filterStates)
        if (id !== "deliveryStatusFilter") state.selected = new Set(state.keys);
      rememberDisclosure("invite-household:" + householdId, true);
      render();
      const row = [...$("inviteRows").querySelectorAll("[data-invite-household]")]
        .find((element) => element.dataset.inviteHousehold === householdId);
      if (!row) { window.RSVP_ADMIN_SEARCH.enhance({ R, T, iconAction }).open("inviteSearch"); return; }
      row.open = true;
      row.dispatchEvent(new Event("toggle"));
      const delivery = row.querySelector("#invite-delivery-" + householdId);
      if (delivery) delivery.open = true;
      row.scrollIntoView({ block: "nearest" });
      row.querySelector("summary")?.focus();
    }
    return { render, openHousehold, getVisibleHouseholdIds: () => visibleHouseholdIds.slice(),
      deliveryStatuses: () => filterStates.get("deliveryStatusFilter")?.selected || new Set(deliveryStates) };
  }
  window.RSVP_ADMIN_INVITES = { create };
})();
