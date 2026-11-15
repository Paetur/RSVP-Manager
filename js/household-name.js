// One display projection; stored household fields and historical snapshots stay separate.
(function () {
  "use strict";
  window.RSVP_HOUSEHOLD_NAME = (household) => {
    const parts = [household?.household_name ?? household?.name, household?.last_name]
      .map(value => typeof value === "string" ? value.trim() : "");
    const [name, surname] = parts;
    // Existing installations may already include the surname in the saved label.
    // Avoid doubling it during a data-preserving upgrade; never rewrite the fields.
    const escaped = surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (surname && new RegExp("(^|\\s)" + escaped + "(?=\\s|$)", "iu").test(name)) return name;
    return parts.filter(Boolean).join(" ");
  };
})();
