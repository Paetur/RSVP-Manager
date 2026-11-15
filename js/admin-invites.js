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
    rsvpSection,
    adminTime,
    show,
  }) {
    const $ = R.byId;
    let inviteOverviewFilter = "all";
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
        can("food") && store.settings?.food_enabled !== false;
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
      $("inviteResultCount").textContent = T(
        "interface.messages.count_households",
        { count: visible.length },
      );
      box.classList.toggle("has-food-interest", showFoodInterest);
      const heading = R.dom("div", { class: "invite-overview-heading" });
      for (const label of [
        "Household",
        "Recipient / channel",
        "Invitation",
        "RSVP",
        ...(showFoodInterest ? ["Food interest"] : []),
        "Actions",
      ])
        heading.append(R.dom("span", {}, T(label)));
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
            label = T({ yes: "Yes", no: "No", unanswered: "Unanswered" }[state] || "Unanswered"),
            badge = R.dom("small", { class: "muted invite-food-interest" }, label);
          badge.dataset.foodInterest = state;
          foodInterest.setAttribute("aria-label", T("Food interest") + ": " + label);
          foodInterest.append(R.dom("small", { class: "muted invite-interest-label" }, T("Food interest")), badge);
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
          for (const [section, label, build] of [
            ["delivery", "Invitation delivery", (household) => deliverySection(household, { allowCreate: true })],
            ["rsvp", "RSVP", rsvpSection],
          ]) {
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
        if (!store.settings?.is_published && can("households", "edit")) {
          const edit = iconAction("edit", T("interface.messages.edit_household") + R.householdName(h), () => editHousehold(h.id));
          edit.classList.add("invite-edit-household");
          actions.append(edit);
        }
        const prepare = R.dom(
          "button",
          { type: "button", class: "btn secondary" },
          T(
            !can("invites", "edit")
              ? "Review"
              : model.latest
                ? model.latest.status === "sent" ? "Follow up" : "Review"
                : "Create",
          ),
        );
        prepare.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          row.open = true;
          rememberDisclosure(key, true);
          fillSections();
          const target = content.querySelector("#invite-delivery-" + h.id);
          if (target) {
            target.open = true;
            rememberDisclosure(key + ":delivery", true);
            const create = model.latest
              ? [...target.querySelectorAll("[data-delivery-id]")].find((record) => record.dataset.deliveryId === model.latest.id)
              : target.querySelector(".delivery-create");
            if (create?.classList.contains("delivery-create")) create.hidden = false;
            else create?.setAttribute("open", "");
            if (model.latest?.status === "sent")
              create?.querySelector(":scope > details.edit-only")?.setAttribute("open", "");
            create?.scrollIntoView({ block: "nearest" });
          }
        });
        actions.append(prepare);
        if (canPreviewGuest()) {
          const preview = R.dom("a", { class: "btn secondary invite-preview" });
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

        if (store.settings?.is_published && h.invite_code) {
          const copy = R.dom(
            "button",
            { type: "button", class: "invite-text-action" },
            T("Copy link"),
          );
          copy.setAttribute(
            "aria-label",
            T("interface.messages.copy_invitation_link") +
              " · " +
              R.householdName(h),
          );
          copy.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
              await navigator.clipboard.writeText(
                R.invitationURL(h.invite_code),
              );
              show(T("interface.messages.invitation_link_copied"), "success");
            } catch (error) {
              show(R.safeError(error), "error");
            }
          });
          actions.append(copy);
        }
        summary.append(identity, recipient, delivery, reply);
        if (showFoodInterest) summary.append(foodInterest);
        summary.append(actions);
        row.append(summary, content);
        container.append(row);
      }
      if ($("inviteGroupView").checked) {
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
