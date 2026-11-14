// Field-scoped token help. Insertion uses the editor's native input lifecycle.
(function () {
  "use strict";
  let nextId = 0;
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
    panel.append(
      R.dom("p", { class: "micro" }, T("Insert a placeholder at the cursor.")),
    );
    const tokens = allowedTokens
      ? allowedTokens.map((token) => [token, ""])
      : kind === "food-reply"
        ? [
            ["{invite-deadline}", T("RSVP deadline date")],
            ["{invite-deadline:+5}", T("Five days after the RSVP deadline")],
            ["{invite-deadline:-2}", T("Two days before the RSVP deadline")],
          ]
        : [
            ["{invitation_link}", T("Link")],
            ["{event_name}", T("Event name")],
            ["{household_name}", T("Household name")],
          ];
    for (const [token, description] of tokens) {
      const row = R.dom("div", { class: "placeholder-token-row" }),
        text = R.dom("div"),
        insert = R.dom(
          "button",
          { type: "button", class: "small-tool" },
          T("Insert"),
        );
      text.append(R.dom("code", {}, token), R.dom("small", {}, description));
      insert.setAttribute("aria-label", T("Insert") + " " + token);
      insert.addEventListener("click", () => {
        if (
          input.disabled ||
          input.readOnly ||
          input.form?.getAttribute("aria-busy") === "true"
        )
          return;
        input.focus({ preventScroll: true });
        const end = input.value.length,
          start = Math.min(selection[0], end),
          finish = Math.min(selection[1], end);
        input.setRangeText(token, start, finish, "end");
        remember();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      row.append(text, insert);
      panel.append(row);
    }
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
  window.RSVP_PLACEHOLDER_HELP = Object.freeze({ attach });
})();
