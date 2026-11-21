// Main-list search disclosure; filtering and permissions remain with each controller.
(function () {
  "use strict";
  const ids = ["householdSearch", "inviteSearch", "foodSearch", "logSearch"];
  const enhanced = new WeakMap();

  function enhance({ R, T, iconAction, ids: requested = ids, onClear }) {
    const controls = new Map();
    for (const id of requested) {
      if (!ids.includes(id)) continue;
      const input = R.byId(id);
      if (!input || input.tagName !== "INPUT") continue;
      let control = enhanced.get(input);
      if (!control) {
        const field = input.closest("label") || input;
        const host = R.dom("div", { class: "admin-search-control" });
        host.dataset.adminSearch = id;
        const panel = R.dom("div", { id: id + "Panel", class: "admin-search-panel" });
        panel.hidden = true;
        // Use the existing icon, but retain synchronous focus behavior: the
        // ordinary iconAction callback temporarily disables its button.
        const toggle = iconAction("search", T("Search"), null, false, "admin-search-toggle");
        toggle.id = id + "Toggle";
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", panel.id);
        const close = R.dom("button", { id: id + "Close", type: "button", class: "admin-row-icon admin-search-close" });
        const closeGlyph = R.dom("span", {}, "×");
        closeGlyph.setAttribute("aria-hidden", "true");
        close.append(closeGlyph);
        field.before(host);
        panel.append(field, close);
        host.append(toggle, panel);

        function labels() {
          toggle.title = T("Search"); toggle.setAttribute("aria-label", T("Search"));
          close.title = T("Close"); close.setAttribute("aria-label", T("Close"));
        }
        function reveal(focus = true) {
          panel.hidden = false;
          toggle.setAttribute("aria-expanded", "true");
          if (focus) input.focus();
          return true;
        }
        function collapse() {
          const opened = toggle.getAttribute("aria-expanded") === "true";
          if (!opened && !input.value) return false;
          input.value = "";
          panel.hidden = true;
          toggle.setAttribute("aria-expanded", "false");
          // Preserve the original input/listeners. Never leave a live filter
          // hidden behind a closed disclosure, including a toggle-button close.
          input.dispatchEvent(new Event("input", { bubbles: true }));
          toggle.focus();
          if (typeof control.onClear === "function") control.onClear(id, input);
          return true;
        }
        toggle.addEventListener("click", event => {
          event.preventDefault(); event.stopPropagation();
          if (toggle.getAttribute("aria-expanded") === "true") collapse();
          else reveal();
        });
        close.addEventListener("click", event => {
          event.preventDefault(); event.stopPropagation(); collapse();
        });
        host.addEventListener("keydown", event => {
          if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
            event.preventDefault(); event.stopPropagation(); collapse();
          }
        });
        input.addEventListener("input", () => { if (input.value) reveal(false); });
        document.addEventListener("rsvp:locale-ready", labels);
        labels();
        control = { open: reveal, close: collapse, onClear };
        enhanced.set(input, control);
        // Browser-restored or programmatically supplied filters stay visible.
        if (input.value) reveal(false);
      } else if (typeof onClear === "function") control.onClear = onClear;
      controls.set(id, control);
    }
    return Object.freeze({
      open: id => controls.get(id)?.open() || false,
      close: id => controls.get(id)?.close() || false,
    });
  }
  window.RSVP_ADMIN_SEARCH = Object.freeze({ enhance });
})();
