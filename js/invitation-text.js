// Invitation help, validation and rendering share the scoped token registry.
(function () {
  "use strict";
  window.RSVP_INVITATION_TEXT = {
    validate: text => { try { return window.RSVP_PLACEHOLDERS.validate(text); } catch (_) { throw Error("The invitation template contains an unknown placeholder."); } },
    fill: (text, values, options = {}) => window.RSVP_PLACEHOLDERS.fill(text, { ...values, rsvp_deadline: values.rsvp_deadline || options.deadline }, options),
    get tokens() { return window.RSVP_PLACEHOLDERS.tokens(); },
  };
})();
