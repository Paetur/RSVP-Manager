// Synthetic template generation only; no browser, live records or network.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const context = { window: {}, Intl, Date };
vm.runInNewContext(fs.readFileSync("js/household-name.js", "utf8"), context);
for (const file of ["text-placeholders", "food-interest-reply", "invitation-text", "admin-invitation-album"]) vm.runInNewContext(fs.readFileSync("js/" + file + ".js", "utf8"), context);
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
context.window.RSVP = { invitationURL: code => "https://example.invalid/?=" + code };
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
store.invitationTemplates.push({language_code: "en", channel: "whatsapp", body: "{invitation_link}", message_image: {image: "synthetic-picture"}});
assert.equal(api.draft(household, "whatsapp").image.image, "synthetic-picture");
assert.equal(api.draft(household, "sms").image, null, "pictures never spill across channels");
store.settings.is_published = false;
assert.equal(api.draft(household, "whatsapp").body, "{invitation_link}");
store.settings.rsvp_deadline = "2027-03-27T23:30:00Z";
store.settings.timezone = "Europe/Berlin";
store.invitationTemplates.push({language_code:"en",channel:"manual",body:"Reply by {rsvp_deadline:+5}: {invitation_link}"});
assert.match(api.draft(household,"manual").body,/2 April 2027/);
store.settings.rsvp_deadline = null;
assert.match(api.draft(household,"manual").body,/\{rsvp_deadline:\+5\}/,"a missing date remains visibly unresolved in a draft");
assert.throws(()=>context.window.RSVP_INVITATION_TEXT.validate("{rsvp_deadline:+367}"),/unknown placeholder/);
console.log(
  "PASS invitation templates: enabled-language/channel fallback, placeholders, no unpublished link, missing-code/template fallback and replaced-store reads.",
);
