// Guest reply wording uses the same scoped token contract as invitation drafts.
(function () {
  "use strict";
  window.RSVP_FOOD_INTEREST_REPLY = {
    validate(text) { if (typeof text !== "string" || text.length > 6000) throw Error("Invalid food interest reply"); return window.RSVP_PLACEHOLDERS.validate(text); },
    render(text, { deadline, timezone = "UTC", language = "en", fallback = "", values = {} } = {}) {
      const P = window.RSVP_PLACEHOLDERS;
      window.RSVP_FOOD_INTEREST_REPLY.validate(text); window.RSVP_FOOD_INTEREST_REPLY.validate(fallback);
      if (/\{rsvp_deadline/.test(fallback)) throw Error("Invalid food interest reply placeholder");
      const options = { timezone, language };
      const result = P.fill(text || fallback, { ...values, rsvp_deadline: values.rsvp_deadline || deadline }, options);
      const replacement = P.fill(fallback, values, options);
      return P.unresolved(result) ? P.unresolved(replacement) ? "" : replacement : result;
    },
  };
})();
