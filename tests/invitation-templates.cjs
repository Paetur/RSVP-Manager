// Synthetic template generation only; no browser, live records or network.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const context = { window: {}, Intl, Date };
vm.runInNewContext(fs.readFileSync("js/household-name.js", "utf8"), context);
for (const file of ["text-placeholders", "food-interest-reply", "guest-names", "invitation-text", "admin-invitation-album"]) vm.runInNewContext(fs.readFileSync("js/" + file + ".js", "utf8"), context);
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
  getStore: () => {
    // Keep the table of language test cases compact, then build current named groups.
    const groups = new Map();
    for (const row of store.invitationTemplates) {
      if (!groups.has(row.channel)) groups.set(row.channel, { id: row.channel, name: row.channel, channels: [row.channel], versions: {} });
      if (!Object.keys(groups.get(row.channel).versions).length) groups.get(row.channel).versions[row.language_code] = row;
    }
    return { ...store, invitationTemplates: [...groups.values()] };
  },
  languages: () => enabled.map((code) => [code, code]),
});
const household = {
  language: "de",
  household_name: "Example household",
  invite_code: "ABCDEFGH",
};
assert.equal(
  api.draft(household, "email").body,
  "DE Example household: {invitation_link}",
  "named content is selected explicitly, independently of household language, without revealing an unpublished link",
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
store.invitationTemplates.push({language_code:"en",channel:"sms",subject:"Unused subject",body:"Long {invitation_link}",short_body:"Short {invitation_link}",options:["shortMessage"]});
assert.equal(api.draft(household,"sms").body,"Short https://example.invalid/?=ABCDEFGH");
assert.equal(api.draft(household,"sms").subject,"");
store.settings.is_published = false;
assert.equal(api.draft(household, "whatsapp").body, "{invitation_link}");
store.settings.rsvp_deadline = "2027-03-27T23:30:00Z";
store.settings.timezone = "Europe/Berlin";
store.invitationTemplates.push({language_code:"en",channel:"manual",body:"Reply by {rsvp_deadline:+5}: {invitation_link}"});
assert.match(api.draft(household,"manual").body,/2 April 2027/);
store.settings.rsvp_deadline = null;
assert.match(api.draft(household,"manual").body,/\{rsvp_deadline:\+5\}/,"a missing date remains visibly unresolved in a draft");
assert.throws(()=>context.window.RSVP_INVITATION_TEXT.validate("{rsvp_deadline:+367}"),/unknown placeholder/);
const invitationText = context.window.RSVP_INVITATION_TEXT;
const greetingHousehold = { ...household, id: "h", primary_guest_id: "g", last_name: "Example" };
const primaryGuest = { id: "g", household_id: "h", first_name: "Alex", last_name: "Example", courtesy_title: "Ms.", relation: "Mom" };
const alternateGuest = { id: "g2", household_id: "h2", first_name: "Jamie", invitation_salutation: { pattern: "{nickname}", nickname: "Auntie" } };
store.households = [greetingHousehold, { id: "h2", household_name: "Other household" }];
store.guests = [primaryGuest, alternateGuest];
store.contacts = [
  { id: "c", household_id: "h", contact_type: "email", contact_name: "Taylor Example" },
  { id: "c2", household_id: "h", contact_type: "email", contact_name: "Jamie", guest_id: "g2" },
];
store.invitationTemplates[0].subject = "Dear {contact_salutation}";
store.invitationTemplates[0].body = "Dear {contact_salutation}, {household_name}: {invitation_link}";
assert.equal(api.draft(greetingHousehold, "email").subject, "Dear Ms. Alex Example");
assert.equal(api.draft(greetingHousehold, "email", { contactId: "c" }).subject, "Dear Taylor Example");
primaryGuest.invitation_salutation = { pattern: "{Relation}" };
assert.equal(api.draft(greetingHousehold, "email").body, "Dear Mom, Example household: {invitation_link}");
assert.equal(api.draft(greetingHousehold, "email", { contactId: "c" }).subject, "Dear Taylor Example", "standalone contacts use their own saved name");
assert.equal(api.draft(greetingHousehold, "email", { contactId: "c2" }).subject, "Dear Auntie", "a linked alternate uses their own nickname");
primaryGuest.invitation_salutation = { pattern: "{Nickname}", nickname: "Mama" };
assert.equal(api.draft(greetingHousehold, "email").subject, "Dear Mama");
assert.equal(api.draft({ ...greetingHousehold, primary_guest_id: "g2" }, "email").subject, "Dear Auntie", "choosing a different primary guest changes newly rendered wording");
primaryGuest.invitation_salutation = { pattern: "{nickname}" };
assert.equal(api.draft(greetingHousehold, "email").subject, "Dear Ms. Alex Example", "a missing nickname falls back to the guest's name");
delete primaryGuest.invitation_salutation;
store.settings.guest_interface_modes = { phone: { guest_title_visibility: { de: true } }, wide: { guest_title_visibility: { de: false }, show_repeated_surname: false } };
assert.equal(invitationText.guestSalutation(store, primaryGuest, { household: greetingHousehold }), "Alex");
primaryGuest.invitation_salutation = { show_titles: true, show_repeated_surname: true };
assert.equal(invitationText.guestSalutation(store, primaryGuest, { household: greetingHousehold }), "Ms. Alex Example");
context.window.RSVP_I18N = { t: (source, _params, language) => language === "de" && source === "Ms." ? "Frau" : source };
delete primaryGuest.invitation_salutation;
primaryGuest.language = "en";
store.settings.guest_interface_modes.wide = { guest_show_titles: true, guest_title_visibility: { de: true, en: false }, show_repeated_surname: true };
assert.equal(api.draft(greetingHousehold, "email", { language: "de" }).subject, "Dear Frau Alex Example", "draft titles follow the message language, including visibility");
assert.equal(api.draft(greetingHousehold, "email", { language: "en" }).subject, "Dear Alex Example");
store.settings.guest_interface_modes.wide.guest_show_titles = false;
assert.equal(api.draft(greetingHousehold, "email", { language: "de" }).subject, "Dear Alex Example", "the Wide master switch hides inherited draft titles");
primaryGuest.invitation_salutation = { show_titles: true };
assert.equal(api.draft(greetingHousehold, "email", { language: "de" }).subject, "Dear Frau Alex Example", "an explicit guest override takes precedence");
const disabledLanguages = context.window.RSVP_GUEST_INTERFACE.effective({ guest_interface_modes: { phone: { guest_title_visibility: { de: true } } } }, "phone", [
  { language_code: "en", enabled: true }, { language_code: "de", enabled: false }, { language_code: "fo", enabled: false },
]);
assert.equal(disabledLanguages.guest_title_visibility.fo, false, "the Phone defaults include disabled languages for the save comparison");
assert.equal(disabledLanguages.guest_show_titles, false, "disabled language flags do not enable the inherited master switch");
for (const invalid of ["", "Text only", "{firstname} {unknown}", "{relation:+2}", "{{relation}}", "{firstname}\n{lastname}"]) {
  assert.equal(invitationText.validateSalutationPattern(invalid), false);
}
assert.equal(invitationText.validateSalutationPattern("{Nickname} ({Firstname})"), true);
console.log(
  "PASS invitation templates: named content/channel selection, scoped salutation and fallback, unpublished links and replaced-store reads.",
);
