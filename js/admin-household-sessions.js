// Household invitation defaults and per-guest exceptions share the household draft.
(function () {
  "use strict";
  function append(form, h, { R, T, getStore, ordered, can }) {
    if (!can("invites")) return { changed: () => false };
    const store = getStore(),
      guests = store.guests.filter(
        (g) => g.household_id === h.id && !g.archived_at,
      );
    const guestIds = new Set(guests.map((g) => g.id));
    const expected = {
      defaults: store.defaults
        .filter((d) => d.household_id === h.id)
        .map(({ session_id, is_invited }) => ({ session_id, is_invited }))
        .sort((a, b) => a.session_id.localeCompare(b.session_id)),
      overrides: store.overrides
        .filter((o) => guestIds.has(o.guest_id))
        .map(({ guest_id, session_id, is_invited }) => ({
          guest_id,
          session_id,
          is_invited,
        }))
        .sort(
          (a, b) =>
            a.guest_id.localeCompare(b.guest_id) ||
            a.session_id.localeCompare(b.session_id),
        ),
    };
    const locked =
      !!h.id &&
      (h.rsvp_state !== "open" ||
        store.submissions.some((s) => s.household_id === h.id) ||
        (store.sessionInvitationLocks || []).includes(h.id));
    const editable = can("invites", "edit") && !locked;
    const host = R.dom("section", {
        class: "household-session-selection span-2",
      }),
      choices = R.dom("fieldset", {
        class: "food-venue-options household-session-choices",
      }),
      exceptions = R.dom("details", { class: "household-session-exceptions" });
    const controls = [];
    choices.append(
      R.dom("legend", {}, T("interface.messages.session_invitations")),
    );
    host.append(
      R.dom(
        "p",
        { class: "micro" },
        T(
          "interface.messages.household_defaults_apply_to_each_guest_unless_an_individual_excep",
        ),
      ),
    );
    if (locked)
      host.append(
        R.dom(
          "p",
          { class: "notice" },
          T(
            "interface.messages.invitations_are_protected_because_this_household_has_rsvp_history",
          ),
        ),
      );
    exceptions.append(R.dom("summary", {}, T("Individual guest exceptions")));
    for (const session of ordered(store.sessions, "name")) {
      const check = R.dom("input", {
          type: "checkbox",
          value: session.id,
          disabled: !editable,
        }),
        label = R.dom("label", { class: "checkbox-label" }),
        text = R.dom("span");
      check.checked = !!expected.defaults.find(
        (d) => d.session_id === session.id,
      )?.is_invited;
      check.setAttribute("aria-label", session.name);
      const venue = store.locations.find((v) => v.id === session.location_id);
      text.append(
        document.createTextNode(
          session.name +
            (session.is_active ? "" : T("interface.messages.inactive_2")),
        ),
      );
      if (venue) text.append(R.dom("small", { class: "micro" }, venue.name));
      label.append(check, text);
      choices.append(label);
      controls.push({
        session_id: session.id,
        guest_id: null,
        input: check,
        initial: check.checked,
        value: () => check.checked,
      });
      for (const guest of guests) {
        const existing = expected.overrides.find(
            (o) => o.guest_id === guest.id && o.session_id === session.id,
          ),
          wrap = R.dom("label"),
          select = R.dom("select", { disabled: !editable });
        const caption =
          [guest.first_name, guest.last_name].filter(Boolean).join(" ") +
          " — " +
          session.name;
        wrap.append(R.dom("span", {}, caption));
        select.setAttribute("aria-label", caption);
        for (const [value, key] of [
          ["inherit", "follow_household"],
          ["true", "invited"],
          ["false", "not_invited"],
        ])
          select.append(
            R.dom("option", { value }, T("interface.messages." + key)),
          );
        select.value = existing ? String(existing.is_invited) : "inherit";
        wrap.append(select);
        exceptions.append(wrap);
        controls.push({
          session_id: session.id,
          guest_id: guest.id,
          input: select,
          initial: select.value,
          value: () => select.value,
        });
      }
    }
    if (controls.length) {
      host.append(choices);
      if (guests.length) host.append(exceptions);
    } else
      host.append(
        R.dom(
          "p",
          { class: "micro" },
          T("interface.messages.create_sessions_in_settings_first"),
        ),
      );
    form.append(host);
    return {
      changed: () => editable && controls.some((c) => c.value() !== c.initial),
      read: () => ({
        session_assignments_expected: expected,
        session_assignments: controls
          .filter((c) => c.value() !== c.initial)
          .map((c) => ({
            session_id: c.session_id,
            guest_id: c.guest_id,
            is_invited: c.guest_id
              ? c.value() === "inherit"
                ? null
                : c.value() === "true"
              : c.value(),
          })),
      }),
    };
  }
  window.RSVP_ADMIN_HOUSEHOLD_SESSIONS = Object.freeze({ append });
})();
