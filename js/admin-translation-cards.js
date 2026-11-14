// Record cards share the existing local editor's permissions, saves and focus lifecycle.
(function () {
  "use strict";
  const opened = new Map();
  function create(host, { R, T, key, title }) {
    const card = R.dom("details", {
        class: "panel settings-card translation-record-card",
      }),
      heading = R.dom("summary", { class: "settings-card-heading" }),
      body = R.dom("div", { class: "translation-record-body" });
    card.dataset.settingsCard = key;
    card.dataset.translationRecord = key;
    card.open = opened.get(key) ?? false;
    heading.append(R.dom("h3", {}, title));
    card.append(heading, body);
    card.addEventListener("toggle", () => opened.set(key, card.open));
    host.append(card);
    return body;
  }
  function summary(form, target, { R }) {
    const grid = R.dom("div", { class: "translation-language-grid" });
    const rows = form.querySelectorAll("[data-language-code]");
    grid.style.setProperty("--translation-languages", Math.min(3, rows.length));
    for (const source of rows) {
      const language = R.dom("section", {
        class: "translation-language-reading",
      });
      language.append(source.querySelector(":scope > strong").cloneNode(true));
      for (const input of source.querySelectorAll("input,textarea")) {
        const label = input
            .closest("label")
            .querySelector(".placeholder-field-heading > span, :scope > span"),
          field = R.dom("div", { class: "translation-reading-field" });
        field.append(
          R.dom(
            "small",
            { class: "muted" },
            label?.textContent || input.getAttribute("aria-label"),
          ),
          R.dom("p", {}, input.value || "—"),
        );
        language.append(field);
      }
      grid.append(language);
    }
    target.append(grid);
  }
  window.RSVP_ADMIN_TRANSLATION_CARDS = Object.freeze({ create, summary });
})();
