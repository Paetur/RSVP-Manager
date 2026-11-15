// Pure projections: no browser, account, database or mutable application globals.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync("js/household-name.js", "utf8"), context);
vm.runInNewContext(fs.readFileSync("js/admin-overview.js", "utf8"), context);
const { eventCounts, invitationOverview } = context.window.RSVP_ADMIN_OVERVIEW;
const plain = (value) => JSON.parse(JSON.stringify(value));
const h = { id: "h", household_name: "Example", rsvp_state: "open" };
const store = {
  households: [h, { id: "archived", archived_at: "2026-01-01" }],
  guests: [
    { id: "adult", household_id: "h" },
    { id: "child", household_id: "h", is_child: true },
    { id: "gone", household_id: "h", archived_at: "2026-01-01" },
    { id: "hidden", household_id: "archived" },
  ],
  sessions: [
    { id: "s", is_active: true, requires_rsvp: true },
    { id: "optional", is_active: true, requires_rsvp: false },
    { id: "inactive", is_active: false, requires_rsvp: true },
  ],
  defaults: [{ household_id: "h", session_id: "s", is_invited: true }],
  overrides: [{ guest_id: "child", session_id: "s", is_invited: false }],
  responses: [{ guest_id: "adult", session_id: "s", rsvp_status: "attending" }],
  food: [
    { id: "available", active: true, quantity_needed: 3 },
    { id: "full", active: true, quantity_needed: 1 },
    { id: "hidden", active: false, quantity_needed: 5 },
    {
      id: "archived",
      active: true,
      quantity_needed: 1,
      archived_at: "2026-01-01",
    },
  ],
  claims: [
    { food_item_id: "available", household_id: "h", quantity: 1 },
    { food_item_id: "full", household_id: "h", quantity: 1 },
    { food_item_id: "available", household_id: "other", quantity: 0 },
  ],
  queue: [
    {
      id: "sent",
      household_id: "h",
      status: "sent",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      channel: "email",
    },
    {
      id: "followup",
      household_id: "h",
      status: "draft",
      created_at: "2026-02-01",
      channel: "sms",
      recipient_snapshot: {
        contact_name: "Snapshot",
        contact_value: "synthetic",
      },
    },
  ],
  deliveries: [{ queue_id: "sent", confirmed_at: "2026-01-03" }],
};
const original = structuredClone(store);
let counts = plain(eventCounts(store, true));
assert.equal(counts.invitedCount, 2);
assert.equal(counts.children, 1);
assert.deepEqual(counts.sessionReplies, {
  attending: 1,
  declined: 0,
  pending: 0,
});
assert.equal(counts.rsvpSessions.length, 1);
assert.deepEqual(
  [counts.available, counts.full, counts.hidden, counts.contributingHouseholds],
  [1, 1, 1, 1],
);
assert.deepEqual(plain(eventCounts(store, false)).sessionReplies, {
  attending: 0,
  declined: 0,
  pending: 0,
});
const contact = {
  primary: { contact_name: "Current", contact_value: "current" },
  guest: { first_name: "Adult", last_name: "Example" },
  contactChannel: "email",
};
let model = plain(invitationOverview(store, h, contact));
assert.equal(model.latest.id, "followup");
assert.equal(model.sent, true); // A new draft must not erase prior sending history.
assert.equal(model.ready, false);
assert.equal(model.lastSent, "2026-01-03");
assert.equal(model.channel, "sms");
assert.equal(model.contactName, "Snapshot");
assert.equal(model.contactValue, "synthetic");
assert.deepEqual(
  [model.guests, model.total, model.answers, model.replied],
  [2, 1, 1, false],
);
assert.deepEqual(store, original); // Sorting and projections must not mutate the store.
store.overrides = [];
store.responses.push({
  guest_id: "child",
  session_id: "s",
  rsvp_status: "declined",
});
store.queue[1].status = "ready";
h.rsvp_state = "locked";
model = plain(invitationOverview(store, h, contact));
assert.deepEqual(
  [model.total, model.answers, model.ready, model.replied],
  [2, 2, true, true],
);
counts = plain(eventCounts(store, true));
assert.deepEqual(counts.sessionReplies, {
  attending: 1,
  declined: 1,
  pending: 0,
});
store.responses = [];
assert.deepEqual(plain(eventCounts(store, true)).sessionReplies, {
  attending: 0,
  declined: 0,
  pending: 2,
});
store.queue = [];
model = plain(
  invitationOverview(store, h, {
    guest: {
      first_name: "Fallback",
      email: "example.invalid",
      preferred_contact_method: "email",
    },
  }),
);
assert.deepEqual(
  [model.channel, model.contactName, model.contactValue, model.sent],
  ["email", "Fallback", "example.invalid", false],
);
console.log(
  "PASS overview projections: archive/permission boundaries, invitation overrides, food availability, sent/follow-up separation, recipient snapshots, fresh data and input immutability.",
);

const { foodInterestStatus, foodInterestCounts } =
  context.window.RSVP_ADMIN_OVERVIEW;
const interestStore = {
  households: [
    { id: "yes", food_interest: true, food: false },
    { id: "no", food_interest: false },
    { id: "null", food_interest: null },
    { id: "archived", food_interest: true, archived_at: "2026-01-01" },
    { id: "group", food_interest: true },
    { id: "archived-guest", food_interest: true },
  ],
  guests: [
    { household_id: "yes" },
    { household_id: "no" },
    { household_id: "null" },
    { household_id: "archived" },
    { household_id: "archived-guest", archived_at: "2026-01-01" },
  ],
};
assert.deepEqual(plain(foodInterestCounts(interestStore)), {
  yes: 1,
  no: 1,
  unanswered: 1,
});
assert.equal(
  foodInterestStatus(interestStore, interestStore.households[0]),
  "yes",
  "Food access does not change saved interest",
);
assert.equal(
  foodInterestStatus(interestStore, interestStore.households[4]),
  "ineligible",
  "Empty grouping households do not count",
);
console.log(
  "PASS food-interest projection: active households with guests only; Yes/No/null separate from food access and commitments.",
);
