// Display-only surname folding. Stored guest names always remain complete.
(function () {
  "use strict";
  function lastName(guest, invitation, settings) {
    const surname = guest?.last_name || "";
    if (settings?.show_repeated_surname !== false) return surname;
    const householdName = invitation?.household?.last_name?.trim();
    const guests = (invitation?.guests || []).filter((person) => !person.archived_at);
    return householdName && guests.length && guests.every((person) => person.last_name?.trim() === householdName)
      ? "" : surname;
  }
  window.RSVP_GUEST_NAMES = Object.freeze({ lastName });
})();
