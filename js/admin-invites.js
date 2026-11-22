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
    invitationSection,
    deliveryEditor,
    invitationTemplateChoices,
    invitationDraft,
    managementRpc,
    reload,
    rsvpSection,
    householdFacts,
    adminTime,
    show,
    getSelectionControl = () => null,
    getSelectAllControl = () => null,
    onVisibleHouseholds = () => {},
  }) {
    const $ = R.byId;
    let inviteOverviewFilter = "all", inviteInterestFilter = "all", inviteAttendanceFilter = "all", visibleHouseholdIds = [];
    const filterStates = new Map();
    const groupSelections = { top: new Set(), relation: new Set() };
    const overlayName = "invite-overview-filters";
    const wideScreen = matchMedia("(min-width: 1024px)");
    const serviceLabels = { messages: "Messages", email: "Email", whatsapp: "WhatsApp", sms: "SMS", none: "None" };
    const visibleFields = window.RSVP_ADMIN_PREFERENCES.invitesFields;
    const columnGroups = window.RSVP_ADMIN_PREFERENCES.invitesColumnGroups;
    const requiredFields = window.RSVP_ADMIN_PREFERENCES.invitesRequiredFields;
    const shown = new Set();
    let shownOwner, shownDefaults, shownColumnDefaults, rowLayout = 1, oneRowShown = [], clipboardBusy = false;

    function renderShownFields() {
      const host = $("inviteShownFieldsHost");
      const owner = getActor(), defaults = window.RSVP_ADMIN_PREFERENCES.invitesShownFields;
      const columnDefaults = window.RSVP_ADMIN_PREFERENCES.invitesTwoRowColumns;
      const signature = JSON.stringify(defaults), columnSignature = JSON.stringify(columnDefaults);
      const changedOwner = shownOwner !== owner, changedFields = shownDefaults !== signature;
      const changedColumns = shownColumnDefaults !== columnSignature;
      const preferences = window.RSVP_ADMIN_PREFERENCES;
      const nextLayout = wideScreen.matches ? preferences.invitesWideRows : preferences.invitesNarrowRows;
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
      host.append(window.RSVP_INLINE.multiChoice({
        R,
        T,
        label: "Shown fields",
        options: (rowLayout === 1 ? visibleFields : columnGroups).filter(([key]) => !requiredFields.includes(key)),
        selected: shown,
        onChange: render,
        group: overlayName,
        allOrNone: true,
        className: "invite-shown-fields",
      }));
    }
    function openCurrentDelivery(row, householdId) {
      row.open = true;
      row.dispatchEvent(new Event("toggle"));
      const key = "invite-household:" + householdId;
      rememberDisclosure(key, true);
      const invitation = row.querySelector(".invite-household-invitation"),
        current = invitation?.querySelector(".current-invitation > [data-delivery-id]"),
        submenu = current?.closest("[data-invite-delivery-submenu]") ||
          invitation?.querySelector('[data-invite-delivery-submenu="logs"]');
      if (!submenu) return;
      invitation.open = submenu.open = true;
      if (current) current.open = true;
      rememberDisclosure(key + ":invitation", true);
      rememberDisclosure(key + ":invitation:" + submenu.dataset.inviteDeliverySubmenu, true);
      const focus = current?.querySelector("[data-mark-delivery-ready]:enabled") ||
        current?.querySelector("summary") || submenu.querySelector("summary");
      focus?.focus({ preventScroll: true });
      focus?.scrollIntoView({ block: "nearest" });
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
        R, T, label, options: values, selected: state.selected, group: overlayName, allOrNone: true,
        onChange(key, action) {
          render();
          const control = action ? '[data-multi-select="' + action + '"]' : '[data-value="' + CSS.escape(key) + '"]';
          $(id).querySelector(control)?.focus({ preventScroll: true });
        },
      });
      dropdown.open = openFilter === id;
      host.replaceChildren(dropdown);
      return state.selected;
    }
    function countFilterButton(label, count, pressed) {
      const button = R.dom("button", { type: "button", class: "stat-row invite-stat-row" });
      button.setAttribute("aria-pressed", String(pressed));
      button.classList.toggle("is-selected", pressed);
      button.append(R.dom("span", {}, label), R.dom("b", {}, count));
      return button;
    }

    function renderCountFilters(host, choices, selected, data, update) {
      host.replaceChildren(...choices.map(([key, label, count], index) => {
        const button = countFilterButton(T(label), count, selected === key);
        button.dataset[data] = key;
        button.addEventListener("click", () => {
          update(selected === key ? "all" : key);
          render();
          host.children[index]?.focus({ preventScroll: true });
        });
        return button;
      }));
    }

    function renderGroupTrees(store, all) {
      const host = $("inviteGroupTrees");
      if (!host) return () => true;
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
            const button = countFilterButton(entry.label, all.filter(entry.matches).length, selected.has(entry.key));
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
          setDisclosure(tree, "invite-overview-group-tree:" + scope, true);
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
      const label = kind === "recipient" ? "Copy" : picture ? "Copy picture and text" : "Copy Invitation";
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
            try {
              await window.RSVP_INVITATION_IMAGE.writeClipboard(attachment, value, { isCurrent: current });
            } catch (error) {
              if (!current()) return;
              await navigator.clipboard.writeText(value);
              if (current()) show(T("Invitation text copied."), "success");
              return;
            }
          } else await navigator.clipboard.writeText(value);
          if (current()) show(T(attachment ? "Picture and text copied. Check the caption after pasting." : "Copied"), "success");
        } catch (error) {
          if (current()) show(R.safeError(error), "error");
        } finally { setClipboardBusy(false); }
      });
      return control;
    }
    function render() {
      const store = getStore();
      const box = $("inviteRows");
      box.replaceChildren();
      renderShownFields();
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
        ["needs-draft", "No drafts", (r) => !r.latest],
        ["review", "Review", (r) => r.latest?.status === "draft"],
        ["ready", "Ready", (r) => r.ready],
        ["sent", "Sent", (r) => r.sent],
        ["awaiting", "Waiting Reply", (r) => r.sent && !r.replied],
        ["replied", "Replied", (r) => r.replied],
      ];
      const countHost = $("inviteOverviewCounts");
      const statusTotal = $("inviteStatusTotal");
      if (statusTotal) statusTotal.textContent = String(all.length);
      if (countHost) renderCountFilters(countHost, filters.map(([key, label, test]) => [key, label, all.filter(test).length]),
        inviteOverviewFilter, "inviteFilter", next => { inviteOverviewFilter = next; });
      const attendanceHost = $("inviteAttendanceCounts");
      if (attendanceHost) renderCountFilters(attendanceHost, [
        ["attending", "Attending"], ["declined", "Not attending"], ["pending", "Unanswered"],
      ].map(([key, label]) => [key, label, all.reduce((sum, model) => sum + model.attendance[key], 0)]),
        inviteAttendanceFilter, "inviteAttendanceFilter", next => { inviteAttendanceFilter = next; });
      else inviteAttendanceFilter = "all";
      const matchesGroups = renderGroupTrees(store, all);
      const openFilter = ["inviteLanguageFilter", "inviteChannelFilter"].find(id => $(id).querySelector("details[open]"));
      const languageChoices = languages();
      // Existing households can retain a disabled language; All must still show them.
      for (const code of new Set(all.map(row => row.h.language || store.settings?.default_language || "en"))) {
        if (!languageChoices.some(([key]) => key === code))
          languageChoices.push(languages(code).find(([key]) => key === code) || [code, code.toUpperCase()]);
      }
      const selectedLanguages = filterChoices("inviteLanguageFilter", "Language", languageChoices, openFilter);
      const services = filterChoices("inviteChannelFilter", "Services", Object.entries(serviceLabels), openFilter);
      const canInterestFilter = can("food") && store.settings?.food_enabled !== false;
      const showFoodInterest = canInterestFilter && store.settings?.food_stage === "interest";
      const showFoodItems = can("food") && store.settings?.food_enabled !== false && store.settings?.food_stage === "selection";
      const showFood = displayedFields.has("food") && (showFoodInterest || showFoodItems);
      if (!canInterestFilter) inviteInterestFilter = "all";
      const foodHost = $("inviteFoodCounts");
      if (foodHost) {
        const interestBox = $("inviteFoodInterest") || foodHost;
        interestBox.hidden = !canInterestFilter;
        foodHost.hidden = !canInterestFilter;
        if (canInterestFilter) {
          const counts = window.RSVP_ADMIN_OVERVIEW.foodInterestCounts(store);
          renderCountFilters(foodHost, [["yes", "Yes"], ["no", "No"], ["unanswered", "Unanswered"]]
            .map(([key, label]) => [key, label, counts[key]]),
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
        (inviteAttendanceFilter === "all" || r.attendance[inviteAttendanceFilter] > 0) &&
        selectedLanguages.has(r.h.language || store.settings?.default_language || "en") &&
        services.has(r.service) &&
        (!canInterestFilter || inviteInterestFilter === "all" ||
          window.RSVP_ADMIN_OVERVIEW.foodInterestStatus(store, r.h) === inviteInterestFilter);
      const test = filters.find(([key]) => key === inviteOverviewFilter)?.[2] || (() => true);
      const visible = all.filter(model => test(model) && matchesFilters(model));
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
        col.key === "selection" ? "74px" : col.key === "actions" ? "100px" :
        ["householdInfo", "serviceInfo", "replyInfo"].includes(col.key) ? "minmax(50px, .8fr)" :
        col.key === "lastSent" ? "minmax(65px, 1fr)" : "minmax(80px, 1fr)").join(" "));
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
                ready: "Invitation",
                sent: "Marked sent",
                failed: "Failed",
                cancelled: "Cancelled",
              }[model.latest.status] || "Not sent"
            : "Not sent";
        const invitationActions = R.dom("span", { class: "invite-copy-options" });
        if (model.latest?.status === "draft") {
          const review = R.dom("button", {
            type: "button",
            class: "invite-copy-action invite-review-action",
            "aria-label": T("Review") + " · " + R.householdName(h),
          });
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
          const rsvp = rsvpSection(h);
          rsvp.id = "invite-rsvp-" + h.id;
          rsvp.querySelector("summary").replaceChildren(T("RSVP"), " ",
            R.dom("small", { class: "invite-rsvp-state muted" }, T(h.rsvp_state === "locked" ? "Locked" : "Open")));
          setDisclosure(rsvp, key + ":rsvp");
          const invitation = invitationSection(h, model.latest);
          invitation.classList.add("invite-household-invitation");
          setDisclosure(invitation, key + ":invitation", true);
          for (const section of invitation.querySelectorAll("[data-invite-delivery-submenu]"))
            setDisclosure(section, key + ":invitation:" + section.dataset.inviteDeliverySubmenu);
          content.append(rsvp, invitation);
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
        // The shared control owns eligibility and native checkbox
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
      let inactiveShown = false;
      if (can("invites") && inviteOverviewFilter === "all" && inviteInterestFilter === "all" && inviteAttendanceFilter === "all") {
        const activeIds = new Set(all.map(model => model.h.id));
        const historyIds = new Set(store.queue.map(record => record.household_id));
        const inactive = ordered(store.households.filter(h => !activeIds.has(h.id) && historyIds.has(h.id)), "household_name")
          .map(invitationOverview).filter(matchesFilters);
        if (inactive.length) {
          box.append(inactiveHouseholds(inactive, Boolean(search)));
          inactiveShown = true;
        }
      }
      if (!visible.length && !inactiveShown)
        list.append(
          R.dom(
            "p",
            { class: "muted" },
            T(inviteOverviewFilter === "needs-draft" && all.every(model => model.latest)
              ? "No households need a draft."
              : "No households match these filters."),
          ),
        );

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
      for (const selected of Object.values(groupSelections)) selected.clear();
      $("inviteSearch").value = "";
      for (const state of filterStates.values()) state.selected = new Set(state.keys);
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
      if (getActor() && getStore().settings && can("invites")) render();
    });
    document.addEventListener("pointerdown", event => {
      for (const menu of $("inviteSortingHeading").parentElement.querySelectorAll("details[open]"))
        if (!menu.contains(event.target)) menu.open = false;
    });
    return { render, openHousehold, getVisibleHouseholdIds: () => visibleHouseholdIds.slice() };
  }
  window.RSVP_ADMIN_INVITES = { create };
})();
