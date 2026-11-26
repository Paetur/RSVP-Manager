// Logs uses a day-first text field and keeps the chosen date in ISO form for the query.
(function () {
  "use strict";

  function isoValue(input) {
    const value = input.value.trim();
    if (!value) return "";
    const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value) || /^(\d{2})(\d{2})(\d{4})$/.exec(value);
    if (!parts || parts[3] === "0000") return null;
    const [, day, month, year] = parts;
    const iso = `${year}-${month}-${day}`;
    const date = new Date(iso + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
  }

  function displayDate(iso) {
    return iso.split("-").reverse().join("/");
  }

  function attach(form, T) {
    const { dom } = window.RSVP;
    const fields = form.querySelectorAll(".log-date-field > input[type=text]");
    const refreshFields = [];
    for (const input of fields) {
      const control = dom("span", { class: "log-date-calendar" });
      const picker = dom("input", { type: "date", min: "0001-01-01", max: "9999-12-31" });
      // The native companion has its own display and must not get a second preview from preferences.
      picker.dataset.clockPart = "date";
      control.append(picker);
      input.after(control);

      const label = input.id === "logFrom" ? "From" : "Through";
      function refresh() {
        const iso = isoValue(input);
        input.setCustomValidity(iso === null ? T("interface.messages.log_invalid_date") : "");
        picker.value = iso || "";
        picker.setAttribute("aria-label", T("interface.messages.log_date_calendar", { field: T(label) }));
      }
      refreshFields.push(refresh);
      refresh();

      input.addEventListener("input", () => {
        // Mobile digit keyboards can enter the date without typing a slash.
        const iso = isoValue(input);
        if (iso && /^\d{8}$/.test(input.value)) input.value = displayDate(iso);
        refresh();
      });
      picker.addEventListener("change", () => {
        input.value = displayDate(picker.value);
        refresh();
      });

      function openPicker(event) {
        if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
        try {
          picker.showPicker?.();
          if (event.type === "keydown" && picker.showPicker) event.preventDefault();
        } catch {
          // The native control can still open on focus or pointer input.
        }
      }
      picker.addEventListener("keydown", openPicker);
      picker.addEventListener("click", openPicker);
    }
    const refresh = () => refreshFields.forEach(update => update());
    form.addEventListener("reset", () => {
      for (const input of fields) input.setCustomValidity("");
    });
    document.addEventListener("rsvp:locale-ready", refresh);
  }

  window.RSVP_ADMIN_LOG_DATES = { attach, isoValue };
})();
