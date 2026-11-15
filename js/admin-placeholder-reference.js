// Read-only reference; insertion remains scoped to the editor's token contract.
(function () {
  "use strict";
  function render({ R, T }) {
    const host = R.byId("placeholderReference");
    host.replaceChildren();
    const search = R.dom("input", {
      type: "search",
      placeholder: T("Search placeholders"),
    });
    search.setAttribute("aria-label", T("Search placeholders"));
    const rows = R.dom("div", { class: "placeholder-reference-rows" });
    host.append(
      R.dom("h2", {}, T("Placeholders")),
      R.dom(
        "p",
        { class: "muted" },
        T(
          "Use the {…} button beside an editor to insert a supported placeholder.",
        ),
      ),
      search,
      rows,
    );
    const entries = Object.entries(window.RSVP_PLACEHOLDERS.groups).flatMap(([scope, names]) => names.map(name => ["{" + name + "}", name.replaceAll("_", " "), T("Placeholder context") + ": " + T(scope)]));
    entries.push(["{rsvp_deadline:+5}", T("Five days after the RSVP deadline"), T("Invitation templates and Food Interest Reply")], ["{rsvp_deadline:-2}", T("Two days before the RSVP deadline"), T("Invitation templates and Food Interest Reply")]);
    function update() {
      rows.replaceChildren();
      for (const entry of entries.filter((r) =>
        r.join(" ").toLowerCase().includes(search.value.trim().toLowerCase()),
      )) {
        const line = R.dom("div", { class: "placeholder-reference-row" }),
          description = R.dom("div"),
          copy = R.dom(
            "button",
            { type: "button", class: "btn secondary" },
            T("Copy"),
          );
        description.append(
          R.dom("strong", {}, entry[1]),
          R.dom("p", { class: "micro" }, entry[2]),
        );
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(entry[0]);
            copy.textContent = T("Copied");
          } catch (_) {
            const input = R.dom("input", { readonly: true });
            input.value = entry[0];
            line.append(input);
            input.select();
          }
        });
        line.append(R.dom("code", {}, entry[0]), description, copy);
        rows.append(line);
      }
    }
    search.addEventListener("input", update);
    update();
    host.append(
      R.dom(
        "p",
        { class: "micro" },
        T(
          "Change the offset from −366 to +366 calendar days. Without a deadline, the no-deadline reply is used.",
        ),
      ),
      R.dom(
        "p",
        { class: "micro" },
        T(
          "Set an RSVP deadline before sharing an invitation with deadline placeholders.",
        ),
      ),
      R.dom(
        "p",
        { class: "micro" },
        T(
          "Other wording fields keep the placeholders of their original phrase.",
        ),
      ),
    );
  }
  window.RSVP_ADMIN_PLACEHOLDERS = Object.freeze({ render });
})();
