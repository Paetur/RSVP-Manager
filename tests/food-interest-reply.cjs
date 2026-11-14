const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync("js/food-interest-reply.js", "utf8"),
  context,
);
const { render, validate } = context.window.RSVP_FOOD_INTEREST_REPLY;
for (const text of [
  "Around {invite-deadline:+5}",
  "{invite-deadline}",
  "{invite-deadline:-366}",
  "A plain reply",
])
  assert.equal(validate(text), text);
for (const text of [
  "{invite-deadline:+367}",
  "{invite-deadline:5}",
  "{unknown}",
  "{invite-deadline:+5",
  "x".repeat(6001),
])
  assert.throws(() => validate(text));
assert.equal(
  render("Around {invite-deadline:+5}", {
    deadline: "2027-03-27T23:30:00Z",
    timezone: "Europe/Berlin",
    language: "en",
    fallback: "Later",
  }),
  "Around 2 April 2027",
);
assert.equal(
  render("{invite-deadline:-1}", {
    deadline: "2027-01-01T01:00:00Z",
    timezone: "America/Los_Angeles",
    language: "en",
  }),
  "30 December 2026",
);
assert.equal(
  render("Around {invite-deadline:+5}", {
    fallback: "Please check again later.",
  }),
  "Please check again later.",
);
assert.equal(render("", { fallback: "Later" }), "Later");
assert.equal(render("Plain reply", { fallback: "Later" }), "Plain reply");
assert.equal(
  render("<img src=x onerror=alert(1)>", {}),
  "<img src=x onerror=alert(1)>",
);
assert.throws(() => render("Text", { fallback: "{invite-deadline}" }));
console.log(
  "PASS reply templates: strict grammar/limits, event-zone calendar offsets across DST/year boundaries, missing-deadline fallback and plain text.",
);
