// Read-only reference; insertion remains scoped to the editor's token contract.
(function () {
  "use strict";
  function render({ R, T }) {
    const host = R.byId("placeholderReference"); host.replaceChildren();
    const entries = Object.values(window.RSVP_PLACEHOLDERS.groups).flat().map(name => ["{" + name + "}", name === "contact_salutation" ? T("Invitation salutation") : name.replaceAll("_", " ")]);
    entries.push(["{rsvp_deadline:+5}", T("Five days after the RSVP deadline")], ["{rsvp_deadline:-2}", T("Two days before the RSVP deadline")]);
    host.append(R.dom("h2", {}, T("Placeholders")),
      R.dom("p", { class: "muted" }, T("Use the {…} button beside an editor to insert a supported placeholder.")),
      window.RSVP_PLACEHOLDER_HELP.browser({ R, T, entries, action: "Copy", className: "placeholder-reference-browser",
        onAction: async (token, button, row) => {
          try { await navigator.clipboard.writeText(token); button.textContent = T("Copied"); }
          catch (_) {
            let input = row.querySelector("input");
            if (!input) { input = R.dom("input"); input.readOnly = true; row.append(input); }
            input.value = token; input.select();
          }
        },
      }),
      R.dom("p", { class: "micro" }, T("Change the offset from −366 to +366 calendar days. Without a deadline, the no-deadline reply is used.")),
      R.dom("p", { class: "micro" }, T("Set an RSVP deadline before sharing an invitation with deadline placeholders.")),
      R.dom("p", { class: "micro" }, T("Other wording fields keep the placeholders of their original phrase.")));
  }
  window.RSVP_ADMIN_PLACEHOLDERS = Object.freeze({ render });
})();
