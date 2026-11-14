// Plain-text guest reply templates shared by editor previews and invitations.
(function () {
  "use strict";
  const token = /\{invite-deadline(?::([+-]\d{1,3}))?\}/g;
  function validate(text) {
    if (typeof text !== "string" || text.length > 6000)
      throw Error("Invalid food interest reply");
    const rest = text.replace(token, (_match, offset) => {
      if (Math.abs(Number(offset || 0)) > 366)
        throw Error("Invalid food interest reply placeholder");
      return "";
    });
    if (/[{}]/.test(rest))
      throw Error("Invalid food interest reply placeholder");
    return text;
  }
  function render(
    text,
    { deadline, timezone = "UTC", language = "en", fallback = "" } = {},
  ) {
    validate(text);
    validate(fallback);
    if (/[{}]/.test(fallback))
      throw Error("Invalid food interest reply placeholder");
    if (!text.trim()) return fallback;
    const matches = [...text.matchAll(token)];
    if (!matches.length) return text;
    if (!deadline || !Number.isFinite(Date.parse(deadline))) return fallback;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: timezone,
      })
        .formatToParts(new Date(deadline))
        .map((p) => [p.type, p.value]),
    );
    return text.replace(token, (_match, offset) => {
      const day = new Date(
        Date.UTC(
          Number(parts.year),
          Number(parts.month) - 1,
          Number(parts.day),
        ),
      );
      day.setUTCDate(day.getUTCDate() + Number(offset || 0));
      const preferred =
        language === "fo" ? "fo-FO" : language === "en" ? "en-GB" : language;
      const locale = Intl.DateTimeFormat.supportedLocalesOf(preferred).length
        ? preferred
        : "en-GB";
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(day);
    });
  }
  window.RSVP_FOOD_INTEREST_REPLY = { validate, render };
})();
