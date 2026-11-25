// Field-scoped token help. Insertion uses the editor's native input lifecycle.
(function () {
  "use strict";
  let nextId = 0;
  const labels = { event: "Event", household: "Household", venue: "Venue", session: "Session", delivery: "Invitation salutation", other: "Other" };
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
    { R, T, kind, requiredLink = false, tokens: allowedTokens, insertToken, editingSurface },
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
        if (insertToken) return insertToken(token);
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
    for (const target of [input, button, panel, editingSurface].filter(Boolean))
      target.addEventListener("keydown", escape);
    input.placeholderHelp = { button, panel };
  }

  const salutationLabels = { "{titles}": "Title", "{firstname}": "First name", "{lastname}": "Last name", "{relation}": "Relation", "{nickname}": "Nickname" };

  function attachTokenEditor(input, { R, T, tokens }) {
    const label = input.closest("label");
    const name = input.getAttribute("aria-label");
    const tokenSet = new Set(tokens.map(token => token.toLowerCase()));
    const pattern = new RegExp("(" + tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    const validation = R.dom("small", { class: "token-text-error", id: "token-text-error-" + ++nextId });
    const editor = R.dom("div", { class: "token-text-editor" });
    editor.contentEditable = "true";
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", name);
    editor.setAttribute("aria-describedby", validation.id);
    editor.setAttribute("aria-required", String(input.required));
    let caret, dragged;

    const editable = () => !input.disabled && !input.readOnly && input.form?.getAttribute("aria-busy") !== "true";
    function read(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.data;
      return node.dataset?.placeholder ?? Array.from(node.childNodes, read).join("");
    }
    function part(text) {
      if (!tokenSet.has(text.toLowerCase())) return document.createTextNode(text);
      const caption = T(salutationLabels[text.toLowerCase()] || text);
      const chip = R.dom("span", { class: "token-text-chip", title: T("Drag to reorder") }, caption);
      chip.contentEditable = "false";
      chip.draggable = true;
      chip.dataset.placeholder = text;
      const remove = R.dom("button", { class: "token-text-remove", type: "button" }, "×");
      remove.setAttribute("aria-label", T("Remove") + " " + caption);
      chip.append(remove);
      return chip;
    }
    function selectedRange() {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return null;
      const range = selection.getRangeAt(0);
      return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
    }
    function remember() {
      const range = selectedRange();
      if (range) caret = range.cloneRange();
    }
    function select(range) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      caret = range.cloneRange();
    }
    function insertionRange() {
      if (caret && editor.contains(caret.startContainer) && editor.contains(caret.endContainer)) return caret.cloneRange();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      return range;
    }
    function updateValidation() {
      editor.setAttribute("aria-invalid", String(!input.validity.valid));
      validation.hidden = input.validity.valid;
      validation.textContent = input.validity.valid ? "" : input.validationMessage;
    }
    function updateValue() {
      const value = read(editor);
      if (input.value !== value) {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      remember();
    }
    function displayValue() {
      if (read(editor) !== input.value) {
        editor.replaceChildren(...input.value.split(pattern).filter(Boolean).map(part));
        caret = null;
      }
      queueMicrotask(updateValidation);
    }
    function addSpaces(chip) {
      let before = chip.previousSibling, after = chip.nextSibling;
      while (before?.nodeType === Node.TEXT_NODE && !before.length) before = before.previousSibling;
      while (after?.nodeType === Node.TEXT_NODE && !after.length) after = after.nextSibling;
      if (before?.dataset?.placeholder) chip.before(" ");
      if (after?.dataset?.placeholder) chip.after(" ");
    }
    function insertNode(range, node, separate = false) {
      range.deleteContents();
      range.insertNode(node);
      if (separate) addSpaces(node);
      range.setStartAfter(node);
      range.collapse(true);
      select(range);
    }
    function tokenizeTypedText() {
      const range = selectedRange();
      let at;
      for (const node of Array.from(editor.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const pieces = node.data.split(pattern);
        if (pieces.length < 2) continue;
        let position = 0;
        const items = pieces.filter(Boolean).map(piece => {
          const item = part(piece);
          if (!at && range?.collapsed && range.startContainer === node && range.startOffset <= position + piece.length) {
            at = { item, offset: range.startOffset - position };
          }
          position += piece.length;
          return item;
        });
        node.replaceWith(...items);
      }
      if (at) {
        if (at.item.nodeType === Node.TEXT_NODE) range.setStart(at.item, at.offset);
        else range.setStartAfter(at.item);
        range.collapse(true);
        select(range);
      }
    }

    attach(input, { R, T, tokens, editingSurface: editor, insertToken: token => {
      const range = insertionRange();
      editor.focus({ preventScroll: true });
      insertNode(range, part(token), true);
      updateValue();
    } });
    label.after(editor, validation);
    input.classList.add("token-text-value");
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    input.addEventListener("focus", () => editor.focus({ preventScroll: true }));
    input.addEventListener("invalid", event => {
      event.preventDefault();
      updateValidation();
      editor.focus();
    });
    input.addEventListener("input", displayValue);
    input.addEventListener("change", displayValue);
    displayValue();
    for (const event of ["pointerup", "keyup", "focusout"]) editor.addEventListener(event, remember);
    editor.addEventListener("beforeinput", event => {
      if (!editable() || event.inputType.startsWith("format") || ["insertParagraph", "insertLineBreak"].includes(event.inputType)) event.preventDefault();
    });
    editor.addEventListener("input", event => {
      event.stopPropagation();
      if (!event.isComposing) tokenizeTypedText();
      updateValue();
    });
    editor.addEventListener("paste", event => {
      event.preventDefault();
      const value = event.clipboardData?.getData("text/plain").replace(/[\r\n]+/g, " ");
      if (!editable() || !value) return;
      insertNode(selectedRange() || insertionRange(), document.createTextNode(value));
      tokenizeTypedText();
      updateValue();
    });
    for (const action of ["copy", "cut"]) editor.addEventListener(action, event => {
      const range = selectedRange();
      if (!range || range.collapsed || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", read(range.cloneContents()));
      if (action === "cut" && editable()) {
        range.deleteContents();
        updateValue();
      }
    });
    editor.addEventListener("click", event => {
      const remove = event.target.closest(".token-text-remove");
      if (!remove || !editable()) return;
      const range = document.createRange();
      range.setStartBefore(remove.parentElement);
      range.collapse(true);
      remove.parentElement.remove();
      editor.focus({ preventScroll: true });
      select(range);
      updateValue();
    });
    editor.addEventListener("keydown", event => {
      const chip = event.target.closest(".token-text-remove")?.parentElement;
      if (!chip || !event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key) || !editable()) return;
      const chips = [...editor.querySelectorAll(".token-text-chip")];
      const earlier = event.key === "ArrowLeft";
      const neighbor = chips[chips.indexOf(chip) + (earlier ? -1 : 1)];
      if (!neighbor) return;
      event.preventDefault();
      const range = document.createRange();
      if (earlier) range.setStartBefore(neighbor);
      else range.setStartAfter(neighbor);
      range.collapse(true);
      insertNode(range, chip, true);
      chip.querySelector("button").focus();
      updateValue();
    });
    editor.addEventListener("dragstart", event => {
      const chip = event.target.closest(".token-text-chip");
      if (!chip || !editable()) return;
      dragged = chip;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", chip.dataset.placeholder);
    });
    editor.addEventListener("dragend", () => { dragged = null; });
    editor.addEventListener("dragover", event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = dragged && editable() ? "move" : "none";
    });
    editor.addEventListener("drop", event => {
      event.preventDefault();
      const chip = event.target.closest(".token-text-chip");
      if (!dragged || dragged === chip || !editable()) return;
      const range = document.createRange();
      if (chip) {
        const rect = chip.getBoundingClientRect();
        if (event.clientX < (rect.left + rect.right) / 2) range.setStartBefore(chip);
        else range.setStartAfter(chip);
      } else {
        const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
        const fallback = position ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
        const node = position?.offsetNode || fallback?.startContainer;
        if (!node || !editor.contains(node) || dragged.contains(node)) return;
        range.setStart(node, position?.offset ?? fallback.startOffset);
      }
      range.collapse(true);
      insertNode(range, dragged, true);
      updateValue();
    });
    return editor;
  }

  window.RSVP_PLACEHOLDER_HELP = Object.freeze({ attach, attachTokenEditor, browser });
})();
