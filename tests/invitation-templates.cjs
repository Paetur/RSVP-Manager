// Synthetic template generation only; no browser, live records or network.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync("js/admin-invitation-templates.js", "utf8"),
  context,
);
let store = {
    settings: {
      event_name: "Example & event",
      is_published: false,
      fallback_language: "fo",
    },
    invitationTemplates: [
      {
        language_code: "de",
        channel: "email",
        subject: "DE {event_name}",
        body: "DE {household_name}: {invitation_link}",
      },
      {
        language_code: "fo",
        channel: "email",
        subject: "FO {event_name}",
        body: "FO {household_name}: {invitation_link}",
      },
      { language_code: "en", channel: "sms", body: "SMS {invitation_link}" },
    ],
  },
  enabled = ["en", "fo"];
const api = context.window.RSVP_ADMIN_INVITATION_TEMPLATES.create({
  R: {
    byId: () => null,
    invitationURL: (code) => "https://example.invalid/?=" + code,
  },
  getStore: () => store,
  languages: () => enabled.map((code) => [code, code]),
});
const household = {
  language: "de",
  household_name: "Example household",
  invite_code: "ABCDEFGH",
};
assert.equal(
  api.draft(household, "email").body,
  "FO Example household: {invitation_link}",
  "disabled household language uses enabled fallback without revealing unpublished link",
);
enabled.push("de");
assert.equal(api.draft(household, "email").subject, "DE Example & event");
store = {
  settings: {
    event_name: "Changed event",
    is_published: true,
    fallback_language: "en",
  },
  invitationTemplates: [
    {
      language_code: "en",
      channel: "email",
      subject: "New {event_name}",
      body: "Hi {household_name}: {invitation_link}",
    },
  ],
};
assert.equal(
  api.draft(household, "email").body,
  "Hi Example household: https://example.invalid/?=ABCDEFGH",
);
assert.equal(
  api.draft(household, "email").subject,
  "New Changed event",
  "reads replaced store, not captured initial templates/settings",
);
assert.equal(
  api.draft({ ...household, invite_code: null }, "email").body,
  "Hi Example household: {invitation_link}",
);
assert.equal(api.draft(household, "whatsapp").hasTemplate, false);
assert.equal(api.draft(household, "whatsapp").subject, "Changed event");
assert.equal(
  api.draft(household, "whatsapp").body,
  "https://example.invalid/?=ABCDEFGH",
);
store.settings.is_published = false;
assert.equal(api.draft(household, "whatsapp").body, "{invitation_link}");
console.log(
  "PASS invitation templates: enabled-language/channel fallback, placeholders, no unpublished link, missing-code/template fallback and replaced-store reads.",
);
