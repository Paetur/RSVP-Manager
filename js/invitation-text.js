// Invitation help, validation and rendering share the scoped token registry.
(function () {
  "use strict";
  const defaultSalutationPattern = "{titles} {firstname} {lastname}";
  const salutationTokens = Object.freeze(["{titles}", "{firstname}", "{lastname}", "{relation}", "{nickname}"]);
  const salutationToken = /\{(titles|firstname|lastname|relation|nickname)\}/gi;
  const contactTypes = { email: "email", messages: "phone", sms: "phone", whatsapp: "phone", postal: "postal", manual: "other" };

  function validateSalutationPattern(pattern) {
    return typeof pattern === "string" && Array.from(pattern).length <= 200 && !/[\r\n]/.test(pattern) &&
      pattern.search(salutationToken) >= 0 && !/[{}]/.test(pattern.replace(salutationToken, ""));
  }

  function salutationSettings(store, guest, configuration = guest.invitation_salutation, language) {
    const settings = store.settings || {};
    const selectedLanguage = language || guest.language || settings.default_language || "en";
    const languages = store.languages?.length ? store.languages : [selectedLanguage];
    // Invitations are shared across devices. Inherit the Wide defaults regardless of the editor's viewport.
    const wide = window.RSVP_GUEST_INTERFACE.effective(settings, "wide", languages);
    return {
      show_titles: configuration?.show_titles ?? window.RSVP_GUEST_NAMES.showTitle(wide, selectedLanguage),
      show_repeated_surname: configuration?.show_repeated_surname ?? (wide.show_repeated_surname !== false),
    };
  }

  const cleanSalutation = value => String(value || "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();

  function guestSalutation(store, guest, { configuration = guest.invitation_salutation, household, language } = {}) {
    const selectedLanguage = language || guest.language || household?.language || store.settings?.default_language || "en";
    const settings = salutationSettings(store, guest, configuration, selectedLanguage);
    const names = window.RSVP_GUEST_NAMES;
    let lastName = guest.last_name;
    if (household?.id) {
      // Include unsaved edits so the editor and saved delivery use the same surname rule.
      const guests = (store.guests || []).filter(person => person.household_id === household.id && person.id !== guest.id);
      lastName = names.lastName(guest, { household, guests: [...guests, guest] }, settings);
    }
    const values = {
      titles: settings.show_titles ? names.courtesyTitle(guest.courtesy_title, selectedLanguage) : "",
      firstname: guest.first_name,
      lastname: lastName,
      relation: guest.relation,
      nickname: configuration?.nickname,
    };
    const fallback = cleanSalutation([values.titles, values.firstname, values.lastname].filter(Boolean).join(" "));
    const pattern = configuration?.pattern || defaultSalutationPattern;
    if (pattern === defaultSalutationPattern || !validateSalutationPattern(pattern)) return fallback;
    let hasValue = false;
    const rendered = pattern.replace(salutationToken, (_, key) => {
      const value = cleanSalutation(values[key.toLowerCase()]);
      if (value) hasValue = true;
      return value;
    });
    // A missing optional value should never leave an empty "Dear" in a delivery.
    return hasValue ? cleanSalutation(rendered) : fallback;
  }

  function deliverySalutation(store, household, { contactId, channel, language }) {
    const contacts = (store.contacts || []).filter(contact => contact.household_id === household.id && !contact.archived_at);
    const contact = contactId ? contacts.find(candidate => candidate.id === contactId)
      : contacts.find(candidate => candidate.is_household_primary && (!channel || candidate.contact_type === contactTypes[channel]));
    const guestId = contact ? contact.guest_id : household.primary_guest_id;
    const guest = guestId && (store.guests || []).find(person => person.id === guestId && !person.archived_at && (contact || !person.is_child));
    if (guest) {
      const source = guest.household_id === household.id ? household : (store.households || []).find(record => record.id === guest.household_id);
      if (source && !source.archived_at) {
        const text = guestSalutation(store, guest, { household: source, language });
        if (text) return text;
      }
    }
    return cleanSalutation(contact?.contact_name) || cleanSalutation(window.RSVP_HOUSEHOLD_NAME(household));
  }

  function context(store, binding = {}) {
    const resolved = window.RSVP_PLACEHOLDERS.context(store, binding);
    resolved.values.contact_salutation = binding.sample ? resolved.values.household_name
      : binding.household ? deliverySalutation(store, binding.household, binding) : null;
    return { values: resolved.values, options: { ...resolved.options, scope: "delivery" } };
  }

  function deliverySubject(household, queue, R) {
    const subject = queue.message_subject || "";
    return queue.status === "draft" && household.invite_code
      ? subject.replaceAll("{invitation_link}", R.invitationURL(household.invite_code))
      : subject;
  }

  function deliveryMessage(household, queue, R) {
    if (!queue || !household.invite_code) return null;
    const link = R.invitationURL(household.invite_code);
    const message = queue.message_body?.replaceAll("{invitation_link}", link);
    if (!message || /[{}]/.test(message + deliverySubject(household, queue, R))) return null;
    return [...message.matchAll(/https?:\/\/[^\s<>"']+/g)]
      .some(match => match[0].replace(/[).,!?;]+$/, "") === link) ? message : null;
  }
  window.RSVP_INVITATION_TEXT = {
    defaultSalutationPattern,
    salutationTokens,
    validateSalutationPattern,
    salutationSettings,
    guestSalutation,
    context,
    deliveryMessage,
    deliverySubject,
    validate: text => { try { return window.RSVP_PLACEHOLDERS.validate(text, "delivery"); } catch (_) { throw Error("The invitation template contains an unknown placeholder."); } },
    fill: (text, values, options = {}) => window.RSVP_PLACEHOLDERS.fill(text, { ...values, rsvp_deadline: values.rsvp_deadline || options.deadline }, { ...options, scope: "delivery" }),
    get tokens() { return window.RSVP_PLACEHOLDERS.tokens("delivery"); },
  };
})();
