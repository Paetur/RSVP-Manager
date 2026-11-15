// Venue/session presentation. Shared forms and assignment dialogs stay in the
// controller; read current data and editing state through callbacks on demand.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    isEditing,
    getLanguage,
    adminTime,
    ordered,
    disclosure,
    btn,
    rpcAction,
    venueForm,
    sessionForm,
    sessionHouseholdDialog,
    show,
  }) {
    const $ = R.byId;
    function venueSummaryRow(
      name,
      metadata,
      mapUrl,
      archived = false,
      actions = null,
      address = "",
    ) {
      const venue = disclosure("");
      const summary = venue.firstElementChild;
      summary.classList.add("venue-summary");
      const layout = R.dom("span", { class: "venue-summary-layout" });
      const content = R.dom("span", { class: "venue-summary-content" }),
        details = R.dom("span", { class: "venue-summary-details" });
      details.append(R.dom("strong", {}, name));
      if (metadata)
        details.append(R.dom("small", { class: "muted" }, metadata));
      content.append(details);
      layout.append(content);
      const links = R.dom("span", { class: "venue-summary-links" });
      if (archived)
        links.append(
          R.dom("small", { class: "muted" }, T("interface.messages.archived")),
        );
      if (mapUrl) {
        try {
          const url = new URL(mapUrl);
          if (url.protocol === "https:") {
            const map = R.dom("span", {
                class: "admin-venue-map guest-mini-map",
              }),
              thumbnail = R.dom("a", { class: "guest-map-thumbnail" });
            for (const link of [thumbnail]) {
              link.href = url.href;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.addEventListener("click", (event) =>
                event.stopPropagation(),
              );
            }
            thumbnail.setAttribute(
              "aria-label",
              T("interface.messages.map_directions") + " · " + name,
            );
            const frame = R.dom("iframe");
            frame.title = T("interface.messages.map_directions") + " · " + name;
            frame.loading = "lazy";
            frame.referrerPolicy = "no-referrer";
            frame.tabIndex = -1;
            frame.setAttribute("aria-hidden", "true");
            frame.src =
              "https://maps.google.com/maps?q=" +
              encodeURIComponent([name, address].filter(Boolean).join(", ")) +
              "&z=15&output=embed";
            thumbnail.append(frame);
            map.append(thumbnail);
            content.append(map);
          }
        } catch (_) {}
      }
      if (actions) links.append(actions);
      if (links.childElementCount) layout.append(links);
      summary.append(layout);
      return venue;
    }
    function recordTimes(record) {
      const times = R.dom("dl", { class: "record-timestamps micro" });
      for (const [label, value] of [["Created", record.created_at], ["Updated", record.updated_at]]) {
        const display = R.dom("dd");
        if (value) {
          const time = R.dom("time", {}, adminTime(value));
          time.dateTime = value;
          time.title = new Date(value).toISOString();
          display.append(time);
        } else display.textContent = T("Not recorded");
        times.append(R.dom("dt", {}, T(label)), display);
      }
      return times;
    }
    function render() {
      const store = getStore();
      const venues = $("venueList");
      venues.replaceChildren();
      const orderedVenues = ordered(store.locations, "name");
      for (const [index, v] of orderedVenues.entries()) {
        const actions = R.dom("span", {
          class: "session-order-actions edit-only",
        });
        actions.append(
          btn(
            "↑",
            T("Move venue up"),
            () =>
              rpcAction(
                "admin_move_venue",
                { p_venue_id: v.id, p_direction: -1 },
                T("Venue order saved"),
              ),
            index === 0,
          ),
          btn(
            "↓",
            T("Move venue down"),
            () =>
              rpcAction(
                "admin_move_venue",
                { p_venue_id: v.id, p_direction: 1 },
                T("Venue order saved"),
              ),
            index === orderedVenues.length - 1,
          ),
        );
        const venue = venueSummaryRow(
          v.name,
          [v.address, v.country_code, v.timezone].filter(Boolean).join(" · "),
          v.map_url,
          !!v.archived_at,
          actions,
          v.address,
        );
        venue.append(recordTimes(v), venueForm(v));
        venues.append(venue);
      }
      $("newVenueForm").replaceChildren(venueForm({}));
      const div = $("sessionsList");
      div.replaceChildren();
      const sessions = ordered(store.sessions, "name");
      for (const [index, s] of sessions.entries()) {
        const v = store.locations.find((v) => v.id === s.location_id);
        const metadata = [
          v?.name,
          s.starts_at
            ? R.formatDate(
                s.starts_at,
                getLanguage(),
                v?.timezone || store.settings?.timezone,
              )
            : T("interface.messages.unscheduled"),
          v?.timezone,
          s.requires_rsvp
            ? T("interface.messages.rsvp_required")
            : T("interface.messages.information_only"),
        ]
          .filter(Boolean)
          .join(" · ");
        const actions = R.dom("span", {
          class: "session-order-actions edit-only",
        });
        actions.append(
          btn(
            "↑",
            T("interface.messages.move_session_up"),
            () =>
              rpcAction(
                "admin_move_session",
                { p_session_id: s.id, p_direction: -1 },
                T("interface.messages.session_order_saved"),
              ),
            index === 0,
          ),
          btn(
            "↓",
            T("interface.messages.move_session_down"),
            () =>
              rpcAction(
                "admin_move_session",
                { p_session_id: s.id, p_direction: 1 },
                T("interface.messages.session_order_saved"),
              ),
            index === sessions.length - 1,
          ),
        );
        const d = venueSummaryRow(
          s.name + (s.is_active ? "" : T("interface.messages.inactive")),
          metadata,
          null,
          false,
          actions,
        );
        const form = sessionForm(s);
        const households = R.dom(
          "button",
          { class: "btn secondary edit-only", type: "button" },
          T("interface.messages.manage_households"),
        );
        households.addEventListener("click", async () => {
          if (!isEditing()) return;
          households.disabled = true;
          try {
            await sessionHouseholdDialog(s, households);
          } catch (error) {
            show(R.safeError(error), "error");
          } finally {
            households.disabled = false;
          }
        });
        households.dataset.requiresSection = "invites";
        households.dataset.requiresLevel = "edit";
        form.querySelector(".form-actions").append(households);
        d.append(recordTimes(s), form);
        div.append(d);
      }
      $("newSessionEditor").replaceChildren(sessionForm({}));
    }

    return { render };
  }
  window.RSVP_ADMIN_VENUES = { create };
})();
