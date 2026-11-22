// Invitation help, validation and rendering share the scoped token registry.
(function () {
  "use strict";
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
    deliveryMessage,
    deliverySubject,
    validate: text => { try { return window.RSVP_PLACEHOLDERS.validate(text); } catch (_) { throw Error("The invitation template contains an unknown placeholder."); } },
    fill: (text, values, options = {}) => window.RSVP_PLACEHOLDERS.fill(text, { ...values, rsvp_deadline: values.rsvp_deadline || options.deadline }, options),
    get tokens() { return window.RSVP_PLACEHOLDERS.tokens(); },
  };
})();
