// Delivery overview presentation only. The controller supplies current data,
// permissions, disclosure state and the existing section/action builders.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
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
  }) {
    const $ = R.byId;
    let inviteOverviewFilter = "all", focusAfterSave = null;
    const shown = new Set(["recipient", "delivery", "reply", "food"]);
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
    async function create(h, model, trigger) {
      const preferred = model.channel === "postal" ? "manual" : model.channel;
      let choices = invitationTemplateChoices(h, preferred).map(t => ({ template: t, channel: preferred }));
      if (!choices.length) choices = getStore().invitationTemplates.map(t => ({ template: t, channel: t.channels[0] }));
      async function save(choice) {
        const channel = choice?.channel || preferred;
        const draft = invitationDraft(h, channel, { templateId: choice?.template.id });
        try {
          await managementRpc("admin_save_delivery", { p_id: null, p_household_id: h.id, p_expected_revision: null, p_values: { channel, contact_id: null, message_subject: draft.subject, message_body: draft.body, message_image: draft.image, status: "draft", reason: "" } });
          if (await reload()) openDelivery(h);
        } catch (error) { show(R.safeError(error), "error"); }
      }
      if (!choices.length) return save(null);
      const dialog = window.RSVP_POPUPS.create("template-choice:" + h.id, { class: "template-choice-popup" }, trigger);
      dialog.setAttribute("aria-label", T("Choose template")); dialog.append(R.dom("h2", {}, T("Choose template")));
      for (const choice of choices) {
        const button = R.dom("button", { type: "button", class: "btn secondary" }, choice.template.name);
        button.addEventListener("click", () => { dialog.close(); save(choice); }); dialog.append(button);
      }
      const cancel = R.dom("button", { type: "button", class: "btn secondary" }, T("Cancel")); cancel.addEventListener("click", () => dialog.close()); dialog.append(cancel); dialog.openInline();
    }
    function render() {
      const store = getStore();
      const box = $("inviteRows");
      box.replaceChildren();
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
        ["not-sent", "Not sent", (r) => !r.sent && !r.ready],
        ["ready", "Ready", (r) => r.ready],
        ["sent", "Marked sent", (r) => r.sent],
        ["awaiting", "Awaiting reply", (r) => r.sent && !r.replied],
        ["replied", "Replied", (r) => r.replied],
      ];
      const countHost = $("inviteOverviewCounts");
      countHost.replaceChildren();
      for (const [key, label, test] of filters) {
        const button = R.dom(
          "button",
          { type: "button", class: "small-tool invite-count-filter" },
          T(label),
        );
        button.dataset.inviteFilter = key;
        button.setAttribute(
          "aria-pressed",
          String(inviteOverviewFilter === key),
        );
        button.append(R.dom("b", {}, all.filter(test).length));
        button.addEventListener("click", () => {
          inviteOverviewFilter = key;
          render();
        });
        countHost.append(button);
      }
      function options(id, values) {
        const select = $(id),
          previous = select.value;
        select.replaceChildren(
          ...values.map(([value, label]) => R.dom("option", { value }, label)),
        );
        select.value = values.some(([value]) => value === previous)
          ? previous
          : "all";
        return select.value;
      }
      const group = options("inviteGroupFilter", [
          ["all", T("All groups")],
          ...planningConfiguration().groups.map((g) => [
            "top:" + g.id,
            groupLabel(g.id),
          ]),
          ...ordered(store.relationGroups, "name").map((g) => [
            "relation:" + g.id,
            g.name,
          ]),
        ]),
        language = options("inviteLanguageFilter", [
          ["all", T("All languages")],
          ...languages(),
        ]),
        channel = options("inviteChannelFilter", [
          ["all", T("All channels")],
          ...["email", "sms", "whatsapp", "manual", "postal"].map((c) => [
            c,
            contactMethodLabel(c) || T(c),
          ]),
        ]);
      const showFoodInterest =
        can("food") && store.settings?.food_enabled !== false && store.settings?.food_stage === "interest";
      const showFoodItems = can("food") && store.settings?.food_enabled !== false && store.settings?.food_stage === "selection";
      const showFood = shown.has("food") && (showFoodInterest || showFoodItems);
      $("inviteFoodInterestFilterLabel").classList.toggle(
        "hidden",
        !showFoodInterest,
      );
      const interestCounts =
        window.RSVP_ADMIN_OVERVIEW.foodInterestCounts(store);
      const interest = options("inviteFoodInterestFilter", [
        ["all", T("All")],
        ...[
          ["yes", "Yes"],
          ["no", "No"],
          ["unanswered", "Unanswered"],
        ].map(([value, label]) => [
          value,
          T(label) + " (" + interestCounts[value] + ")",
        ]),
      ]);
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
            (group === "all" ||
              group === "top:" + r.h.planning_group_id ||
              group === "relation:" + r.h.relation_group_id) &&
            (language === "all" || r.h.language === language) &&
            (channel === "all" || r.channel === channel) &&
            (!showFoodInterest ||
              interest === "all" ||
              window.RSVP_ADMIN_OVERVIEW.foodInterestStatus(store, r.h) ===
                interest),
        );
      $("inviteResultCount").hidden = true;
      box.classList.toggle("has-food-interest", showFoodInterest);
      const fieldHost = $("inviteShownFieldsHost");
      let fields = fieldHost.querySelector(".invite-shown-fields");
      if (!fields) {
        fields = R.dom("fieldset", { class: "invite-shown-fields" }); fields.append(R.dom("legend", {}, T("Shown fields")));
        for (const [key, label] of [["recipient","Recipient / channel"],["delivery","Invitation"],["reply","RSVP"],["food","Food"]]) {
          const wrap = R.dom("label", { class: "checkbox-label" }), input = R.dom("input", { type: "checkbox" }); input.checked = shown.has(key);
          wrap.append(input, document.createTextNode(T(label))); fields.append(wrap);
          input.addEventListener("change", () => { if (input.checked) shown.add(key); else shown.delete(key); render(); });
        } fieldHost.append(fields);
      }
      const columns = [{ key:"identity", label:"Household" }, ...["recipient","delivery","reply"].filter(k => shown.has(k)).map(key => ({ key, label: {recipient:"Recipient / channel",delivery:"Invitation",reply:"RSVP"}[key] })), ...(showFood ? [{key:"food",label:showFoodInterest ? "Food interest" : "Food items"}] : []), {key:"actions",label:"Actions"}];
      box.style.setProperty("--invite-columns", "minmax(160px, 1.6fr) " + columns.slice(1,-1).map(() => "minmax(75px, 1fr)").join(" ") + " minmax(152px, 1fr)");
      const heading = R.dom("div", { class: "invite-overview-heading" });
      for (const col of columns) heading.append(R.dom("span", {}, T(col.label)));
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
        identity.append(
          R.dom("strong", { class: "invite-compact-name" }, R.householdName(h)),
          R.dom(
            "small",
            { class: "muted invite-household-meta" },
            T("interface.messages.count_guests", { count: model.guests }) +
              " · " +
              (
                h.language ||
                store.settings?.default_language ||
                "en"
              ).toUpperCase(),
          ),
        );
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
        recipient.append(
          R.dom("span", {}, model.contactName),
          R.dom(
            "small",
            { class: "muted" },
            contactMethodLabel(model.channel) || T(model.channel),
          ),
        );
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
        delivery.append(
          R.dom("span", { class: "tag" }, T(deliveryLabel)),
          R.dom(
            "small",
            { class: "muted" },
            model.lastSent
              ? T("Last sent") + " " + adminTime(model.lastSent)
              : T("Never sent"),
          ),
        );
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
        if (model.total)
          reply.append(
            R.dom(
              "small",
              { class: "muted" },
              T("{answered} / {total} responses", {
                answered: model.answers,
                total: model.total,
              }),
            ),
          );
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
        if (can("invites", "edit")) {
          const add = R.dom("button", { type: "button", class: "admin-row-icon invite-create", "aria-label": T("Create") }, "+");
          add.setAttribute("aria-label", T("Create"));
          add.addEventListener("click", async event => { event.preventDefault(); event.stopPropagation(); add.disabled = true; try { await create(h, model, add); } finally { if (add.isConnected) add.disabled = false; } }); actions.append(add);
        }
        if (store.settings?.is_published && model.latest) {
          const share = iconAction("share", T("Invitation delivery"), () => openDelivery(h));
          share.classList.add("invite-share"); actions.append(share);
        }
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
        const cells = { identity, recipient, delivery, reply, food: foodInterest, actions };
        for (const col of columns) summary.append(cells[col.key]);
        row.append(summary, content);
        container.append(row);
      }
      if (window.RSVP_ADMIN_PREFERENCES.invitesGrouped) {
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
      } else for (const model of visible) drawRow(model, list);
      if (!visible.length)
        list.append(
          R.dom(
            "p",
            { class: "muted" },
            T("No households match these filters."),
          ),
        );
      if (focusAfterSave) {
        const household = [...box.querySelectorAll("[data-invite-household]")].find(n => n.dataset.inviteHousehold === focusAfterSave);
        household?.querySelector(".invite-share,.invite-create")?.focus({ preventScroll: true });
        focusAfterSave = null;
      }
    }

    function openHousehold(householdId) {
      inviteOverviewFilter = "all";
      $("inviteSearch").value = "";
      for (const id of ["inviteGroupFilter", "inviteLanguageFilter", "inviteChannelFilter", "inviteFoodInterestFilter"]) $(id).value = "all";
      rememberDisclosure("invite-household:" + householdId, true);
      render();
      const row = [...$("inviteRows").querySelectorAll("[data-invite-household]")]
        .find((element) => element.dataset.inviteHousehold === householdId);
      if (!row) { $("inviteSearch").focus(); return; }
      row.open = true;
      row.dispatchEvent(new Event("toggle"));
      const delivery = row.querySelector("#invite-delivery-" + householdId);
      if (delivery) delivery.open = true;
      row.scrollIntoView({ block: "nearest" });
      row.querySelector("summary")?.focus();
    }
    return { render, openHousehold };
  }
  window.RSVP_ADMIN_INVITES = { create };
})();
