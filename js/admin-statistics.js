// Statistics presentation reads the current permission-filtered store on each render.
(function () {
  "use strict";
  window.RSVP_ADMIN_STATISTICS = {
    create({ R, T, getStore, can, planningLabel, planningConfiguration }) {
      const $ = R.byId;
      const tabs = [
        { key: "information", button: $("overviewInformationTab"), panel: $("overviewInformationPanel"), label: "Information" },
        { key: "invitation", button: $("overviewInvitationTab"), panel: $("overviewInvitationPanel"), label: "Invitation" },
      ];
      let activeTab = tabs[0];
      const countNodes = new Map();
      function currentCounts(store) {
        const { invitedCount, children, available, full, hidden, contributingHouseholds } =
          window.RSVP_ADMIN_OVERVIEW.eventCounts(store, false);
        return {
          households: store.households.filter(h => !h.archived_at).length,
          guests: invitedCount,
          peopleBreakdown: `${invitedCount - children} ${T("Adults")} · ${children} ${T("Children")}`,
          submissions: store.guestSubmissionCount ?? store.submissions.length,
          available, full, hidden, contributingHouseholds,
        };
      }
      function refreshCounts() {
        const counts = currentCounts(getStore());
        for (const [key, node] of countNodes) {
          const value = String(counts[key]);
          if (node.isConnected && node.textContent !== value) node.textContent = value;
        }
      }
      function selectTab(tab) {
        activeTab = tab;
        for (const item of tabs) {
          const selected = item === tab;
          item.button.setAttribute("aria-selected", String(selected));
          item.button.tabIndex = selected ? 0 : -1;
          item.panel.hidden = !selected;
          item.panel.inert = !selected;
        }
      }
      for (const tab of tabs) tab.button.addEventListener("click", () => {
        if (!tab.button.hidden) selectTab(tab);
      });

      function render() {
        const store = getStore();
        const metrics = currentCounts(store);
        countNodes.clear();
        function metric(key, node) {
          countNodes.set(key, node);
          return node;
        }
        const cards = new Map();
        function card(tab, id, label, value, rows, footnote, headingKey) {
          const node = R.dom("div", { class: "stat-card stat-card-compact" }),
            heading = R.dom("div", { class: "stat-heading" }),
            counts = R.dom("dl", { class: "stat-counts" });
          node.dataset.overviewCard = id;
          cards.set(id, { id, label, tab, node });
          if (value !== undefined) {
            const total = R.dom("b", {}, value);
            heading.append(headingKey ? metric(headingKey, total) : total);
          }
          heading.append(R.dom("span", {}, label));
          for (const [name, count, key] of rows) {
            const value = R.dom("dd", {}, count);
            counts.append(R.dom("dt", {}, name), key ? metric(key, value) : value);
          }
          node.append(heading, counts);
          if (footnote)
            node.append(R.dom("p", { class: "stat-footnote" }, footnote));
          return node;
        }
        const showHouseholds = can("households"), showInvites = can("invites");
        function filterCard(key, id, label) {
          const caption = T(label);
          const filter = card("invitation", key, caption, undefined, []);
          const list = R.dom("div", { id, class: "invite-stat-rows" });
          list.setAttribute("role", "group");
          list.setAttribute("aria-label", caption);
          filter.querySelector(".stat-counts").replaceWith(list);
        }
        if (showHouseholds || showInvites) {
          const householdsLabel = planningLabel("households");
          const people = card("information", "households", householdsLabel,
            undefined, showInvites ? [] : [
              [T("interface.messages.top_level_groups"), planningConfiguration().groups.length],
              [T("interface.messages.relation_groups"), store.relationGroups.length],
            ]);
          people.classList.add("stat-people");
          const heading = people.querySelector(".stat-heading");
          if (showHouseholds) {
            const householdTotal = R.dom("span");
            householdTotal.append(metric("households", R.dom("b", {}, metrics.households)), " " + householdsLabel);
            const guestTotal = R.dom("span");
            guestTotal.append(metric("guests", R.dom("b", {}, metrics.guests)), " " + planningLabel("guests"));
            heading.classList.add("overview-people-totals");
            heading.replaceChildren(householdTotal, R.dom("span", {}, " / "), guestTotal);
            heading.after(metric("peopleBreakdown", R.dom("p", { class: "overview-people-breakdown" }, metrics.peopleBreakdown)));
          } else heading.remove();
          if (showInvites) {
            people.querySelector(".stat-counts")?.remove();
            people.append(R.dom("div", { id: "inviteGroupTrees" }));
          }
        }
        if (showInvites) {
          const rsvp = card(
            "information",
            "rsvp",
            T("interface.messages.new_rsvp_submissions"),
            metrics.submissions,
            [],
            T("Attendance totals across sessions"),
            "submissions",
          );
          rsvp.querySelector(".stat-counts").replaceWith(R.dom("div", { id: "inviteSessionTree" }),
            R.dom("div", { id: "inviteAttendanceCounts", class: "invite-stat-rows" }));
        }
        if (can("food")) {
          const food = card("information", "food", T("food.messages.food_items"), store.food.length, [
            [T("interface.messages.available"), metrics.available, "available"],
            [T("interface.messages.fully_assigned"), metrics.full, "full"],
            [T("interface.messages.hidden_status"), metrics.hidden, "hidden"],
            [T("Contributing households"), metrics.contributingHouseholds, "contributingHouseholds"],
          ]);
          if (store.settings?.food_enabled !== false) {
            const interest = R.dom("div", { class: "stat-interest", id: "inviteFoodInterest" });
            interest.append(R.dom("small", {}, T("Food interest") + " · " + planningLabel("households")),
              R.dom("div", { id: "inviteFoodCounts", class: "invite-stat-rows" }));
            food.append(interest);
          }
        }
        if (showInvites) {
          const status = card("invitation", "invites", T("Invites"), 0, []);
          status.classList.add("invite-status-card");
          status.querySelector(".stat-heading b").id = "inviteStatusTotal";
          status.querySelector(".stat-counts").remove();
          status.append(R.dom("div", { id: "inviteOverviewCounts", class: "invite-stat-rows" }));
        }
        if (showInvites) {
          filterCard("language", "inviteLanguageFilter", "Language");
          filterCard("services", "inviteChannelFilter", "Services");
        }
        const preferences = window.RSVP_ADMIN_PREFERENCES;
        preferences.setOverviewCards([...cards.values()].map(({ id, label, tab }) => ({ id, label, tab })));
        const visible = preferences.overviewLayout.flatMap(({ id, shown }) => shown && cards.has(id) ? [cards.get(id)] : []);
        for (const tab of tabs) {
          tab.button.textContent = T(tab.label);
          tab.panel.replaceChildren(...visible.filter(card => card.tab === tab.key).map(card => card.node));
          tab.button.hidden = !tab.panel.childElementCount;
        }
        // Keep inactive cards connected so their filters continue to scope the Invites list.
        selectTab(!activeTab || activeTab.button.hidden ? tabs.find(tab => !tab.button.hidden) : activeTab);
        const overview = $("overviewPanel");
        $("overviewPanelTitle").textContent = T("Overview");
        $("overviewTablist").setAttribute("aria-label", T("Overview"));
        overview.hidden = !visible.length;
        let overviewHint = $("overviewAccessSummary");
        if (!overviewHint) {
          overviewHint = R.dom("p", {
            class: "panel",
            id: "overviewAccessSummary",
          });
          overview.after(overviewHint);
        }
        overviewHint.textContent = T(
          "Use the available tabs to open the sections you can access.",
        );
        overviewHint.classList.toggle(
          "hidden",
          cards.size > 0,
        );
      }
      return { render, refreshCounts };
    },
  };
})();
