// Field-scoped token help. Insertion uses the editor's native input lifecycle.
(function () {
  "use strict";
  let nextId = 0;
  const labels = { event: "Event", household: "Household", venue: "Venue", session: "Session", other: "Other" };
  function category(token) {
    const name = token.slice(1, -1).split(":")[0];
    return Object.entries(window.RSVP_PLACEHOLDERS?.groups || {}).find(([, names]) => names.includes(name))?.[0] || "other";
  }
  // Both the field picker and the reference share the same category/search UI.
  // The caller supplies its supported entries; this component never adds tokens.
  function browser({ R, T, entries, action, onAction, className = "" }) {
    const host = R.dom("div", { class: "placeholder-browser " + className }),
      nav = R.dom("nav", { class: "tab-bar placeholder-category-tabs" }),
      search = R.dom("input", { type: "search", placeholder: T("Search placeholders") }),
      rows = R.dom("div", { class: "placeholder-browser-rows" });
    nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", T("Placeholder categories"));
    search.setAttribute("aria-label", T("Search placeholders"));
    let selected = "all";
    const items = entries.map(([token, description = ""]) => ({ token, description, category: category(token) }));
    const available = ["all", ...Object.keys(labels).filter(scope => items.some(item => item.category === scope))];
    const tabs = [];
    function update() {
      rows.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      for (const item of items.filter(item => (selected === "all" || item.category === selected) &&
        [item.token, item.description, T(labels[item.category])].join(" ").toLocaleLowerCase().includes(query))) {
        const row = R.dom("div", { class: action === "Copy" ? "placeholder-reference-row" : "placeholder-token-row" }),
          text = R.dom("div"), button = R.dom("button", { type: "button", class: action === "Copy" ? "btn secondary" : "small-tool" }, T(action));
        button.setAttribute("aria-label", T(action) + " " + item.token);
        text.append(R.dom("code", {}, item.token));
        if (item.description) text.append(R.dom("small", {}, item.description));
        button.addEventListener("click", async () => { await onAction(item.token, button, row); });
        row.append(text, button); rows.append(row);
      }
      if (!rows.children.length) rows.append(R.dom("p", { class: "micro placeholder-no-results" }, T("No matching placeholders")));
      for (const tab of tabs) {
        const active = tab.dataset.placeholderCategory === selected;
        tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
      }
    }
    for (const scope of available) {
      const tab = R.dom("button", { type: "button" }, T(scope === "all" ? "All" : labels[scope]));
      tab.dataset.placeholderCategory = scope; tab.setAttribute("role", "tab");
      tab.addEventListener("click", () => { selected = scope; update(); });
      tabs.push(tab); nav.append(tab);
    }
    nav.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const index = tabs.indexOf(event.target); if (index < 0) return;
      event.preventDefault(); event.stopPropagation();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
    search.addEventListener("input", update); host.append(nav, search, rows); update();
    return host;
  }
  function attach(
    input,
    { R, T, kind, requiredLink = false, tokens: allowedTokens },
  ) {
    if (input.placeholderHelp) return;
    const wrap = input.closest("label"),
      heading = R.dom("span", { class: "placeholder-field-heading" }),
      caption = wrap.querySelector(":scope > span"),
      button = R.dom(
        "button",
        { type: "button", class: "small-tool placeholder-help-toggle" },
        "{…}",
      ),
      panel = R.dom("section", { class: "placeholder-help hidden" }),
      id = "placeholder-help-" + ++nextId;
    panel.id = id;
    panel.setAttribute("aria-label", T("Available placeholders"));
    button.setAttribute(
      "aria-label",
      T("Available placeholders") + " · " + input.getAttribute("aria-label"),
    );
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", id);
    if (caption) heading.append(caption);
    else {
      const nodes = [...wrap.childNodes].filter(
        (node) => node.nodeType === Node.TEXT_NODE,
      );
      const text = nodes
        .map((node) => node.textContent)
        .join("")
        .trim();
      nodes.forEach((node) => node.remove());
      heading.append(
        R.dom("span", {}, text || input.getAttribute("aria-label")),
      );
    }
    heading.append(button);
    wrap.prepend(heading);
    // The help contains buttons, so keep it outside the input's label.
    wrap.after(panel);
    let selection = [input.value.length, input.value.length];
    const remember = () => {
      selection = [input.selectionStart, input.selectionEnd];
    };
    for (const event of ["select", "keyup", "click", "blur", "input"])
      input.addEventListener(event, remember);
    const setOpen = (open) => {
      panel.classList.toggle("hidden", !open);
      button.setAttribute("aria-expanded", String(open));
    };
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setOpen(panel.classList.contains("hidden"));
    });
    panel.append(R.dom("p", { class: "micro" }, T("Insert a placeholder at the cursor.")));
    const tokens = allowedTokens
      ? allowedTokens.map((token) => [token, ""])
      : kind === "invitation"
        ? window.RSVP_INVITATION_TEXT.tokens.map((token) => [token, token.startsWith("{rsvp_deadline") ? T("RSVP deadline date") : ""])
        : kind === "food-reply"
          ? window.RSVP_PLACEHOLDERS.tokens().map(token => [token, ""])
          : [["{invitation_link}", T("Link")], ["{event_name}", T("Event name")], ["{household_name}", T("Household name")]];
    panel.append(browser({ R, T, entries: tokens, action: "Insert", className: "placeholder-insertion-browser",
      onAction: token => {
        if (input.disabled || input.readOnly || input.form?.getAttribute("aria-busy") === "true") return;
        input.focus({ preventScroll: true });
        const end = input.value.length, start = Math.min(selection[0], end), finish = Math.min(selection[1], end);
        input.setRangeText(token, start, finish, "end"); remember();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
    }));
    if (kind === "food-reply")
      panel.append(
        R.dom(
          "p",
          { class: "micro" },
          T(
            "Change the offset from −366 to +366 calendar days. Without a deadline, the no-deadline reply is used.",
          ),
        ),
      );
    if (requiredLink)
      panel.append(
        R.dom(
          "p",
          { class: "micro" },
          T("Include the invitation link placeholder in the message."),
        ),
      );
    const close = R.dom(
      "button",
      { class: "small-tool", type: "button" },
      T("Close"),
    );
    close.addEventListener("click", () => {
      setOpen(false);
      button.focus({ preventScroll: true });
    });
    panel.append(close);
    const escape = (event) => {
      if (event.key === "Escape" && !panel.classList.contains("hidden")) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.focus({ preventScroll: true });
      }
    };
    for (const target of [input, button, panel])
      target.addEventListener("keydown", escape);
    input.placeholderHelp = { button, panel };
  }
  window.RSVP_PLACEHOLDER_HELP = Object.freeze({ attach, browser });
})();
