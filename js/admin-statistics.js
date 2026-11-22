// Statistics presentation reads the current permission-filtered store on each render.
(function () {
  "use strict";
  window.RSVP_ADMIN_STATISTICS = {
    create({ R, T, getStore, can, planningLabel, planningConfiguration }) {
      const $ = R.byId;
      function render() {
        const store = getStore();
        const {
          invitedCount,
          children,
          rsvpSessions,
          available,
          full,
          hidden,
          contributingHouseholds,
        } = window.RSVP_ADMIN_OVERVIEW.eventCounts(store, can("invites"));
        function card(label, value, rows, footnote) {
          const node = R.dom("div", { class: "stat-card stat-card-compact" }),
            heading = R.dom("div", { class: "stat-heading" }),
            counts = R.dom("dl", { class: "stat-counts" });
          heading.append(R.dom("b", {}, value), R.dom("span", {}, label));
          for (const [name, count] of rows)
            counts.append(R.dom("dt", {}, name), R.dom("dd", {}, count));
          node.append(heading, counts);
          if (footnote)
            node.append(R.dom("p", { class: "stat-footnote" }, footnote));
          return node;
        }
        const cards = [];
        const showHouseholds = can("households"), showInvites = can("invites");
        function guestCounts() {
          const guests = card(planningLabel("guests"), invitedCount, [[T("Adults"), invitedCount - children], [T("Children"), children]]);
          const guestSection = R.dom("div", { class: "stat-people-guests" });
          guestSection.append(...guests.childNodes);
          return guestSection;
        }
        if (showHouseholds || showInvites) {
          const people = showHouseholds
            ? card(planningLabel("households"), store.households.filter(h => !h.archived_at).length, showInvites ? [] : [
                [T("interface.messages.top_level_groups"), planningConfiguration().groups.length],
                [T("interface.messages.relation_groups"), store.relationGroups.length],
              ])
            : R.dom("div", { class: "stat-card stat-card-compact" });
          people.classList.add("stat-people");
          if (showInvites) {
            people.querySelector(".stat-counts")?.remove();
            people.append(R.dom("div", { id: "inviteGroupTrees" }));
          } else people.append(guestCounts());
          cards.push(people);
        }
        if (showInvites) {
          const rsvp = card(
            T("interface.messages.new_rsvp_submissions"),
            store.submissions.length,
            [[T("interface.messages.sessions"), rsvpSessions.length]],
            T("Attendance totals across sessions"),
          );
          rsvp.insertBefore(R.dom("div", { id: "inviteAttendanceCounts", class: "invite-stat-rows" }), rsvp.querySelector(".stat-footnote"));
          if (showHouseholds) rsvp.append(guestCounts());
          cards.push(rsvp);
        }
        if (can("food")) {
          const food = card(T("food.messages.food_items"), store.food.length, [
            [T("interface.messages.available"), available],
            [T("interface.messages.fully_assigned"), full],
            [T("interface.messages.hidden_status"), hidden],
            [T("Contributing households"), contributingHouseholds],
          ]);
          if (store.settings?.food_enabled !== false) {
            const interest = R.dom("div", { class: "stat-interest", id: "inviteFoodInterest" });
            interest.append(R.dom("small", {}, T("Food interest") + " · " + planningLabel("households")),
              R.dom("div", { id: "inviteFoodCounts", class: "invite-stat-rows" }));
            food.append(interest);
          }
          cards.push(food);
        }
        if (can("invites")) {
          const status = card(T("Invites"), 0, []);
          status.classList.add("invite-status-card");
          status.querySelector(".stat-heading b").id = "inviteStatusTotal";
          status.querySelector(".stat-counts").remove();
          status.append(R.dom("div", { id: "inviteOverviewCounts", class: "invite-stat-rows" }));
          cards.push(status);
        }
        $("statsGrid").replaceChildren(...cards);
        let overviewHint = $("overviewAccessSummary");
        if (!overviewHint) {
          overviewHint = R.dom("p", {
            class: "panel",
            id: "overviewAccessSummary",
          });
          $("statsGrid").after(overviewHint);
        }
        overviewHint.textContent = T(
          "Use the available tabs to open the sections you can access.",
        );
        overviewHint.classList.toggle(
          "hidden",
          $("statsGrid").childElementCount > 0,
        );
      }
      return { render };
    },
  };
})();
