// Pure overview projections. Callers provide the current permission-filtered store;
// this module never caches event records, renders controls or performs writes.
(function () {
  "use strict";
  function withGuestOverview(store, snapshot) {
    if (!snapshot) return store;
    const householdActivity = new Map(snapshot.households.map(row => [row.id, row]));
    const householdIds = new Set(store.households.map(row => row.id));
    const guestDetails = new Map(store.guests.map(row => [row.id, row]));
    const households = store.households.map(household => {
      const activity = householdActivity.get(household.id);
      if (!activity) return household;
      const { visit_count, first_visited_at, last_visited_at } = household;
      // A just-opened household can have a newer visit than a concurrent overview request.
      return {
        ...household, ...activity,
        ...(Number(visit_count) > Number(activity.visit_count)
          ? { visit_count, first_visited_at, last_visited_at } : {}),
      };
    });
    return {
      ...store, households,
      guests: snapshot.guests.filter(row => householdIds.has(row.household_id))
        .map(row => ({ ...guestDetails.get(row.id), ...row })),
      responses: snapshot.responses,
      guestSubmissionCount: snapshot.submissions,
      claims: snapshot.claims,
      overrides: snapshot.overrides,
    };
  }
  function foodInterestStatus(store, household) {
    if (
      household.archived_at ||
      !store.guests.some(
        (g) => g.household_id === household.id && !g.archived_at,
      )
    )
      return "ineligible";
    return household.food_interest === true
      ? "yes"
      : household.food_interest === false
        ? "no"
        : "unanswered";
  }
  function foodInterestCounts(store) {
    const counts = { yes: 0, no: 0, unanswered: 0 };
    for (const h of store.households) {
      const status = foodInterestStatus(store, h);
      if (status in counts) counts[status]++;
    }
    return counts;
  }
  function rsvpSessions(store) {
    return store.sessions.filter(session => session.is_active && session.requires_rsvp);
  }

  function attendanceCounts(store, guests, sessions) {
    const counts = { attending: 0, declined: 0, pending: 0 };
    for (const guest of guests)
      for (const session of sessions) {
        const override = store.overrides.find(
          row => row.guest_id === guest.id && row.session_id === session.id,
        );
        const invited = override ? override.is_invited : store.defaults.find(
          row => row.household_id === guest.household_id && row.session_id === session.id,
        )?.is_invited;
        if (!invited) continue;
        const answer = store.responses.find(
          row => row.guest_id === guest.id && row.session_id === session.id,
        )?.rsvp_status;
        counts[answer === "attending" || answer === "declined" ? answer : "pending"]++;
      }
    return counts;
  }

  function eventCounts(store, includeInvites) {
    const invitedGuests = store.guests.filter(
        (g) =>
          !g.archived_at &&
          !store.households.find((h) => h.id === g.household_id)?.archived_at,
      ),
      invitedCount = invitedGuests.length,
      children = invitedGuests.filter((g) => g.is_child).length;
    const sessions = rsvpSessions(store);
    const sessionReplies = attendanceCounts(store, includeInvites ? invitedGuests : [], sessions);
    const foodTotals = new Map();
    for (const claim of store.claims)
      foodTotals.set(
        claim.food_item_id,
        (foodTotals.get(claim.food_item_id) || 0) + claim.quantity,
      );
    const available = store.food.filter(
        (f) =>
          !f.archived_at &&
          f.active &&
          f.quantity_needed > (foodTotals.get(f.id) || 0),
      ).length,
      full = store.food.filter(
        (f) =>
          !f.archived_at &&
          f.active &&
          f.quantity_needed <= (foodTotals.get(f.id) || 0),
      ).length;
    return {
      invitedCount,
      children,
      sessionReplies,
      rsvpSessions: sessions,
      available,
      full,
      hidden: store.food.filter((f) => !f.archived_at && !f.active).length,
      contributingHouseholds: new Set(
        store.claims.filter((c) => c.quantity > 0).map((c) => c.household_id),
      ).size,
    };
  }
  function invitationService(contact, guest, delivery) {
    const preferred = contact ? contact.preferred_method : guest?.preferred_contact_method;
    if (delivery === "email" || delivery === "whatsapp") return delivery;
    if (delivery === "sms") return preferred === "sms" ? "sms" : "messages";
    if (delivery) return "none";
    if (contact?.contact_type === "email" || (!contact && preferred === "email" && guest?.email)) return "email";
    if (contact?.contact_type === "phone" || (!contact && guest?.mobile)) {
      if (preferred === "whatsapp" || preferred === "sms") return preferred;
      if (!preferred) return "messages";
    }
    if (!contact && !preferred && guest?.email) return "email";
    return "none";
  }

  function invitationRecords(store, householdId) {
    return store.queue
      .filter(record => record.household_id === householdId)
      .sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || "") ||
        (b.updated_at || "").localeCompare(a.updated_at || "") ||
        b.id.localeCompare(a.id),
      );
  }
  function invitationOverview(store, h, { primary, guest, contactChannel, sessionId }) {
    const records = invitationRecords(store, h.id),
      latest = records.find(record => record.status !== "cancelled");
    const sent = records
      .filter((q) => q.status === "sent")
      .map((q) => ({
        q,
        delivery: store.deliveries.find((d) => d.queue_id === q.id),
      }))
      .sort((a, b) =>
        (b.delivery?.confirmed_at || b.q.updated_at || "").localeCompare(
          a.delivery?.confirmed_at || a.q.updated_at || "",
        ),
      );
    const last = sent[0],
      recipient = latest?.recipient_snapshot;
    const channel =
      latest?.channel ||
      (primary ? contactChannel : guest?.preferred_contact_method) ||
      "manual";
    const preferred = primary ? primary.preferred_method : guest?.preferred_contact_method;
    const phone = primary ? primary.contact_type === "phone" && primary.contact_value : guest?.mobile;
    const templateService = phone && !preferred && (channel === "sms" || (!latest && channel === "manual"))
      ? "messages"
      : channel === "postal" ? "manual" : channel;
    const contactName =
      recipient?.contact_name ||
      primary?.contact_name ||
      [guest?.first_name, guest?.last_name].filter(Boolean).join(" ") ||
      window.RSVP_HOUSEHOLD_NAME(h);
    let service = invitationService(primary, guest, latest?.channel);
    const contactValue = recipient?.contact_value || primary?.contact_value ||
      ({ email: guest?.email, messages: guest?.mobile, sms: guest?.mobile, whatsapp: guest?.mobile }[service]) ||
      guest?.mobile || guest?.email || (channel === "postal" ? h.postal_address : "") || "";
    // Guest-mobile snapshots can store the delivery channel in place of "phone".
    const snapshotType = recipient?.contact_type;
    const contactType = (snapshotType === "sms" || snapshotType === "whatsapp" ? "phone" : snapshotType) ||
      (contactValue && contactValue === primary?.contact_value ? primary.contact_type : null) ||
      (contactValue && contactValue === guest?.email ? "email" : contactValue && contactValue === guest?.mobile ? "phone" : null) ||
      (/^[^\s@]+@[^\s@]+$/.test(contactValue) ? "email" : /^\+?[0-9][0-9 ().-]*$/.test(contactValue) ? "phone" : null);
    const expectedType = service === "email" ? "email" : ["messages", "sms", "whatsapp"].includes(service) ? "phone" : null;
    if (!contactValue || !expectedType || contactType !== expectedType) service = "none";
    const guests = store.guests.filter(
      (g) => g.household_id === h.id && !g.archived_at,
    );
    const sessions = rsvpSessions(store);
    const attendance = attendanceCounts(store, guests,
      sessionId ? sessions.filter(session => session.id === sessionId) : sessions);
    const answers = attendance.attending + attendance.declined;
    return {
      h,
      latest,
      sent: !!last,
      seen: Number(h.visit_count) > 0,
      lastSent: last?.delivery?.confirmed_at || last?.q.updated_at,
      channel,
      templateService,
      contactName,
      contactValue,
      contactType,
      service,
      guests: guests.length,
      total: answers + attendance.pending,
      answers,
      attendance,
      replied: h.rsvp_state === "locked",
      ready: latest?.status === "ready",
    };
  }
  window.RSVP_ADMIN_OVERVIEW = {
    withGuestOverview,
    eventCounts,
    rsvpSessions,
    invitationOverview,
    invitationRecords,
    invitationService,
    foodInterestStatus,
    foodInterestCounts,
  };
})();
