// Statistics presentation reads the current permission-filtered store on each render.
(function () {
  "use strict";
  window.RSVP_ADMIN_STATISTICS = {
    create({ R, T, getStore, can, planningLabel, planningConfiguration, setOverviewCards }) {
      const $ = R.byId;
      const grid = $("statsGrid"), previous = $("overviewPrevious"), next = $("overviewNext");
      const columns = grid.firstElementChild;
      const controls = previous.parentElement;
      const countNodes = new Map();
      let layoutFrame = 0, scrollBeforeRender = null;
      function syncScrollControls() {
        const max = grid.scrollWidth - grid.clientWidth;
        controls.hidden = max <= 1;
        grid.tabIndex = controls.hidden ? -1 : 0;
        previous.setAttribute("aria-disabled", String(grid.scrollLeft <= 1));
        next.setAttribute("aria-disabled", String(grid.scrollLeft >= max - 1));
      }
      function queueLayout() {
        if (layoutFrame) return;
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = 0;
          if (grid.clientWidth) {
            // Keep the height of a single row so only cards that fit can stack.
            const height = Math.max(0, ...Array.from(columns.children, card => card.getBoundingClientRect().height));
            columns.style.blockSize = `${height}px`;
            if (scrollBeforeRender !== null) {
              grid.scrollLeft = scrollBeforeRender;
              scrollBeforeRender = null;
            }
          }
          syncScrollControls();
        });
      }
      function scrollCards(direction) {
        const firstLeft = columns.firstElementChild?.offsetLeft;
        const nextColumn = Array.from(columns.children).find(card => card.offsetLeft > firstLeft);
        if (!nextColumn) return;
        grid.scrollBy({ left: direction * (nextColumn.offsetLeft - firstLeft) });
        syncScrollControls();
      }
      for (const [button, direction] of [[previous, -1], [next, 1]]) {
        button.addEventListener("click", () => {
          if (button.getAttribute("aria-disabled") !== "true") scrollCards(direction);
        });
      }
      grid.addEventListener("scroll", syncScrollControls, { passive: true });
      const layoutObserver = typeof ResizeObserver === "function" ? new ResizeObserver(queueLayout) : null;
      layoutObserver?.observe(grid);
      if (!layoutObserver) {
        window.addEventListener("resize", queueLayout);
        grid.addEventListener("toggle", queueLayout, true);
      }
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
      function render() {
        const store = getStore();
        const metrics = currentCounts(store);
        countNodes.clear();
        function metric(key, node) {
          countNodes.set(key, node);
          return node;
        }
        const cards = new Map();
        function card(id, label, value, rows, footnote, headingKey) {
          const node = R.dom("div", { class: "stat-card stat-card-compact" }),
            heading = R.dom("div", { class: "stat-heading" }),
            counts = R.dom("dl", { class: "stat-counts" });
          node.dataset.overviewCard = id;
          cards.set(id, { id, label, node });
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
          const filter = card(key, caption, undefined, []);
          const list = R.dom("div", { id, class: "invite-stat-rows" });
          list.setAttribute("role", "group");
          list.setAttribute("aria-label", caption);
          filter.querySelector(".stat-counts").replaceWith(list);
        }
        if (showHouseholds || showInvites) {
          const householdsLabel = planningLabel("households");
          const people = card("households", householdsLabel,
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
          const food = card("food", T("food.messages.food_items"), store.food.length, [
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
          const status = card("invites", T("Invites"), 0, []);
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
        setOverviewCards([...cards.values()].map(({ id, label }) => ({ id, label })));
        const visible = preferences.overviewLayout.flatMap(({ id, shown }) => {
          const card = cards.get(id);
          return shown && card ? [card.node] : [];
        });
        const overview = $("overviewPanel");
        $("overviewPanelTitle").textContent = T("Overview");
        scrollBeforeRender = visible.length ? (scrollBeforeRender ?? grid.scrollLeft) : null;
        if (layoutObserver) {
          for (const card of columns.children) layoutObserver.unobserve(card);
          for (const card of visible) layoutObserver.observe(card, { box: "border-box" });
        }
        columns.replaceChildren(...visible);
        overview.hidden = !visible.length;
        for (const [button, label] of [[previous, "Previous"], [next, "Next"]]) {
          button.title = T(label);
          button.setAttribute("aria-label", button.title);
        }
        queueLayout();
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
