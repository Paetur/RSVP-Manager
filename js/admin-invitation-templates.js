// Named templates own content and service choices. Deliveries retain
// independent message snapshots when a template changes or is deleted.
(function () {
  "use strict";
  function create({ R, T, getStore, can, languages, disclosure, row, managementForm, field, saveForm, managementRpc, show, reload }) {
    const services = [["email", "interface.messages.email"], ["messages", "Messages"], ["whatsapp", "WhatsApp"], ["sms", "SMS"], ["manual", "Manual"]];
    const contentOptions = [["subject", "Subject"], ["message", "Message"], ["shortMessage", "Short Message"], ["picture", "Picture"]];
    const album = window.RSVP_ADMIN_INVITATION_ALBUM.create({ R, T, getStore, can, managementForm, field, saveForm, managementRpc, show });
    const cards = new Map();
    let newCard = null, editorNumber = 0, choiceHost = null;
    const templates = () => getStore().invitationTemplates || [];
    // The row's language is storage metadata, never a delivery-selection rule.
    function version(template) { return Object.values(template?.versions || {})[0] || null; }
    function options(v) { return v?.options || ["subject", "message", "picture"]; }
    function choices(h, channel, templateService = channel) { return templates().filter(t => t.channels.includes(templateService) && version(t, h.language)); }
    function draft(h, channel, binding = {}) {
      const service = binding.templateService || channel;
      const candidates = choices(h, channel, service);
      const named = binding.templateId ? candidates.find(t => t.id === binding.templateId) : candidates[0];
      const template = version(named, h.language), context = { venueId: binding.venueId ?? template?.context_venue_id ?? "", sessionId: binding.sessionId ?? template?.context_session_id ?? "" };
      const resolved = window.RSVP_PLACEHOLDERS.context(getStore(), { household: h, language: binding.language || template?.language_code || h.language || "en", ...context });
      const fill = text => { try { return window.RSVP_PLACEHOLDERS.fill(text, resolved.values, resolved.options); } catch (_) { return text; } };
      const enabled = options(template), short = enabled.includes("shortMessage") && (channel === "sms" || !enabled.includes("message"));
      return { subject: template ? enabled.includes("subject") ? fill(template.subject) : "" : fill("{event_name}"), body: fill((short ? template?.short_body : enabled.includes("message") ? template?.body : "") || "{invitation_link}"), image: channel === "sms" || !enabled.includes("picture") ? null : template?.message_image || null, hasTemplate: !!template, context, templateId: named?.id, templateRevision: named?.revision };
    }
    function preview(subject, body, image, language, binding) {
      const resolved = window.RSVP_PLACEHOLDERS.context(getStore(), { language, sample: true, ...binding });
      resolved.values.event_name = T("interface.messages.sample_invitation_event");
      const fill = text => {
        const value = window.RSVP_PLACEHOLDERS.fill(text, resolved.values, resolved.options);
        if (window.RSVP_PLACEHOLDERS.unresolved(value)) throw Error(T("Fill the missing placeholder values or choose a venue/session before sharing."));
        return value;
      };
      return { message_subject: fill(subject || ""), message_body: fill(body || "{invitation_link}"), message_image: image || null };
    }
    function invalidPlaceholders(text) {
      return [...new Set(text.match(/\{[^{}]*\}|[{}]/g) || [])].filter(token => {
        try { window.RSVP_INVITATION_TEXT.validate(token); return false; }
        catch (_) { return true; }
      });
    }
    function languageLabels(tags) {
      const labels = new Map(languages());
      for (const tag of tags) {
        if (!labels.has(tag)) labels.set(tag, languages(tag).find(([code]) => code === tag)?.[1] || tag);
      }
      return labels;
    }
    function multiChoice(form, group, fieldKey, caption, items, initial) {
      const key = group + "-" + fieldKey;
      const field = R.dom("div", { class: "template-choice-field" });
      const label = R.dom("span", { id: key + "-label" }, caption);
      const detail = R.dom("details", { class: "template-choice", name: group });
      detail.dataset.templateChoice = fieldKey;
      const summary = R.dom("summary");
      const pills = R.dom("span", { class: "template-choice-values", id: key + "-values" });
      summary.setAttribute("aria-labelledby", label.id + " " + pills.id);
      summary.append(pills);
      const menu = R.dom("div", { class: "template-choice-menu" });
      const input = R.dom("input", { type: "hidden", value: JSON.stringify(initial) });
      const values = () => JSON.parse(input.value);
      const order = [...new Set([...initial, ...items.map(([key]) => key)])];
      const buttons = items.map(([value, text]) => {
        const button = R.dom("button", { type: "button" }, text);
        button.dataset.value = value;
        button.addEventListener("click", () => {
          if (!can("settings", "edit") || form.getAttribute("aria-busy") === "true") return;
          const selection = new Set(values());
          if (!selection.delete(value)) selection.add(value);
          input.value = JSON.stringify(order.filter(key => selection.has(key)));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        menu.append(button);
        return button;
      });
      const refresh = () => {
        const selected = values();
        pills.replaceChildren();
        for (const button of buttons) {
          const active = selected.includes(button.dataset.value);
          button.setAttribute("aria-pressed", String(active));
          if (active) pills.append(R.dom("span", { class: "template-choice-pill" }, button.textContent));
        }
        if (!pills.childElementCount) pills.textContent = T("None selected");
      };
      input.addEventListener("change", refresh);
      detail.addEventListener("keydown", event => {
        if (event.key !== "Escape" || !detail.open) return;
        event.preventDefault();
        event.stopPropagation();
        detail.open = false;
        summary.focus();
      });
      detail.append(summary, menu);
      field.append(label, detail, input);
      refresh();
      return { field, input, values };
    }
    function editor(template, section, fresh = false) {
      const form = managementForm();
      form.dataset.formKey = "invitation-template:" + (template?.id || "new");
      if (!fresh) form.dataset.headerEditor = "true";
      else form.dataset.startOpen = "true";
      const name = field(form, T("Name"), template?.name || "", null, "text", true, 120);
      name.closest("label").classList.add("span-2");
      const group = "invitation-template-choices-" + ++editorNumber;
      const original = version(template), tags = template?.language_tags || [];
      const serviceChoice = multiChoice(form, group, "service", T("Service"), services.map(([key, label]) => [key, T(label)]), template?.channels || ["email"]);
      const optionChoice = multiChoice(form, group, "options", T("Options"), contentOptions.map(([key, label]) => [key, T(label)]), options(original));
      const languageChoice = multiChoice(form, group, "languages", T("Language tags"), [...languageLabels(tags)], tags);
      const choices = R.dom("div", { class: "template-choice-grid span-2" });
      choices.append(serviceChoice.field, optionChoice.field, languageChoice.field);
      const versions = [];
      const issues = R.dom("div", { class: "template-placeholder-issues span-2" });
      issues.setAttribute("role", "status");
      form.append(choices, issues);
      const code = Object.keys(template?.versions || {})[0] || getStore().settings?.default_language || "en";
      {
        const box = R.dom("section", { class: "span-2 template-content" });
        const fields = R.dom("div", { class: "form-grid" }); box.append(fields); form.append(box);
        const subject = field(fields, T("interface.messages.message_subject"), original?.subject || "", null, "text", false, 300);
        const body = field(fields, T("interface.messages.message_text"), original?.body || "", null, "textarea", false, 4000);
        body.closest("label").classList.add("span-2");
        const short = field(fields, T("Short Message"), original?.short_body || "", null, "text", false, 4000);
        short.closest("label").classList.add("span-2");
        const venue = field(fields, T("Venue context"), original?.context_venue_id || "", [["", T("No specific venue")], ...getStore().locations.filter(v => !v.archived_at).map(v => [v.id, v.name])]);
        const session = field(fields, T("Session context"), original?.context_session_id || "", [["", T("No specific session")], ...getStore().sessions.filter(s => s.is_active).map(s => [s.id, s.name])]);
        const pictureHost = R.dom("div", { class: "span-2" }); fields.append(pictureHost);
        const picture = album.editor(pictureHost, original?.message_image);
        window.RSVP_PLACEHOLDER_HELP.attach(subject, { R, T, kind: "invitation" });
        window.RSVP_PLACEHOLDER_HELP.attach(body, { R, T, kind: "invitation", requiredLink: true });
        window.RSVP_PLACEHOLDER_HELP.attach(short, { R, T, kind: "invitation", requiredLink: true });

        const update = () => {
          const enabled = optionChoice.values();
          for (const [key, input] of [["subject", subject], ["message", body], ["shortMessage", short]]) {
            const hidden = !enabled.includes(key);
            input.closest("label").hidden = hidden;
            if (hidden && input.placeholderHelp) {
              input.placeholderHelp.panel.classList.add("hidden");
              input.placeholderHelp.button.setAttribute("aria-expanded", "false");
            }
          }
          pictureHost.hidden = !enabled.includes("picture");
          if (pictureHost.hidden) picture.close?.();
        };
        optionChoice.input.addEventListener("change", update); update();
        versions.push({ code, box, subject, body, short, venue, session, picture });
      }
      const textFields = () => versions.flatMap(v => [[v.subject, T("interface.messages.message_subject")], [v.body, T("interface.messages.message_text")], [v.short, T("Short Message")]]);
      const refreshIssues = () => {
        issues.replaceChildren();
        for (const [input, caption] of textFields()) for (const token of invalidPlaceholders(input.value)) {
          const warning = R.dom("section", { class: "notice warning template-placeholder-issue" });
          warning.append(R.dom("p", {}, T("Unsupported placeholder in {field}: {placeholder}.", { field: caption, placeholder: token })));
          const retired = /^\{invite-deadline(?::([+-]\d{1,3}))?\}$/.exec(token);
          if (retired) {
            const replacement = "{rsvp_deadline" + (retired[1] ? ":" + retired[1] : "") + "}";
            if (!invalidPlaceholders(replacement).length) {
              const replace = R.dom("button", { type: "button", class: "btn secondary" }, T("Replace {placeholder} with {replacement}", { placeholder: token, replacement }));
              replace.dataset.replacePlaceholder = token;
              replace.addEventListener("click", () => {
                if (!can("settings", "edit") || form.getAttribute("aria-busy") === "true") return;
                input.value = input.value.replaceAll(token, replacement);
                input.dispatchEvent(new Event("input", { bubbles: true }));
              });
              warning.append(replace, R.dom("p", { class: "micro" }, T("Replacement changes this draft only. Save to keep it.")));
            }
          }
          issues.append(warning);
        }
        issues.hidden = !issues.childElementCount;
      };
      form.addEventListener("input", refreshIssues);
      form.addEventListener("change", refreshIssues);
      refreshIssues();
      const saved = saveForm(form, T("Save"), async () => {
        const channels = serviceChoice.values(), enabled = optionChoice.values();
        if (!channels.length) throw Error(T("Choose at least one service"));
        if (!enabled.length) throw Error(T("Choose at least one option"));
        const values = { ...template?.versions };
        for (const v of versions) {
          const subject = v.subject.value.trim(), body = v.body.value.trim(), short = v.short.value.trim(), image = await v.picture.read();
          for (const [text, caption] of [[subject, T("interface.messages.message_subject")], [body, T("interface.messages.message_text")], [short, T("Short Message")]]) {
            const unsupported = invalidPlaceholders(text);
            if (unsupported.length) throw Error(T("Unsupported placeholder in {field}: {placeholder}.", { field: caption, placeholder: unsupported[0] }));
            window.RSVP_INVITATION_TEXT.validate(text);
          }
          values[v.code] = { subject, body, short_body: short, options: enabled, message_image: image, context_venue_id: v.venue.value || null, context_session_id: v.session.value || null };
        }
        await managementRpc("admin_save_invitation_template", { p_id: template?.id || null, p_values: { name: name.value.trim(), channels, language_tags: languageChoice.values(), versions: values }, p_expected: template || null });
        if (fresh) newCard = null;
      });
      if (template) {
        const remove = R.dom("button", { type: "button", class: "btn secondary danger" }, T("Delete"));
        remove.addEventListener("click", async () => {
          if (remove.disabled || !can("settings", "edit") || form.getAttribute("aria-busy") === "true") return;
          remove.disabled = true;
          form.setAttribute("aria-busy", "true"); form.cleanSaveUpdate?.();
          let failed = false;
          try {
            if (!await window.RSVP_INLINE.confirm(T("Delete template?") + " " + template.name, { action: "Delete", trigger: remove })) return;
            if (!can("settings", "edit") || !remove.isConnected) return;
            await managementRpc("admin_delete_invitation_template", { p_id: template.id, p_expected: template });
            cards.delete(template.id); await reload();
          } catch (error) { failed = true; show(R.safeError(error), "error"); }
          finally {
            remove.disabled = false;
            form.removeAttribute("aria-busy"); form.cleanSaveUpdate?.();
            if (failed && remove.isConnected && !remove.disabled && remove.getClientRects().length) remove.focus({ preventScroll: true });
          }
        });
        const destructive = R.dom("span", { class: "editor-lifecycle-actions" }); destructive.append(remove); saved.saveActions.append(destructive);
      }
      saved.templateTestDraft = async () => {
        const v = versions[0], enabled = optionChoice.values(), sms = serviceChoice.values().every(c => c === "sms" || c === "messages");
        return preview(enabled.includes("subject") ? v.subject.value : "", enabled.includes("shortMessage") && (sms || !enabled.includes("message")) ? v.short.value : enabled.includes("message") ? v.body.value : "{invitation_link}", enabled.includes("picture") && !sms ? await v.picture.read() : null, getStore().settings?.default_language, { venueId: v.venue.value, sessionId: v.session.value });
      };
      section.append(saved);
      return saved;
    }
    function render() {
      const host = R.byId("invitationTemplatesList"); host.replaceChildren();
      album.render(R.byId("invitationAlbum"));
      if (!choiceHost) {
        choiceHost = host;
        host.ownerDocument.addEventListener("click", event => {
          for (const dropdown of choiceHost.querySelectorAll(".template-choice[open]")) {
            if (!dropdown.contains(event.target)) dropdown.open = false;
          }
        });
      }
      if (!can("settings")) return;
      if (can("settings", "edit")) {
        const add = disclosure(T("Add template"), "admin-management edit-only template-create"),
          summary = add.querySelector(":scope > summary"), body = R.dom("div", { class: "admin-management-body" });
        summary.dataset.addTemplate = "true";
        const appendEditor = () => {
          if (newCard || !add.open) return;
          const section = R.dom("section", { class: "invitation-template template-create-editor" });
          const form = editor(null, section, true); newCard = section; body.append(section); form.querySelector("input")?.focus();
          form.querySelector("[data-discard]")?.addEventListener("click", () => {
            const current = section.closest("details.template-create");
            section.remove(); newCard = null;
            if (current) { current.open = false; current.querySelector(":scope > summary")?.focus(); }
          });
        };
        add.append(body); host.append(add);
        if (newCard) { body.append(newCard); add.open = true; }
        add.addEventListener("toggle", appendEditor);
      }
      for (const template of templates()) {
        const cached = cards.get(template.id), oldForm = cached?.querySelector("form");
        if (can("settings", "edit") && oldForm?.localEditor?.box.classList.contains("local-editor-open") && window.RSVP_I18N.isDirty(oldForm)) { host.append(cached); continue; }
        const section = R.dom("details", { class: "invitation-template" });
        section.dataset.settingsCard = "invitation-template:" + template.id;
        section.open = cached?.open ?? false;
        const heading = R.dom("summary", { class: "settings-card-heading" });
        heading.setAttribute("aria-label", template.name);
        heading.append(R.dom("h3", {}, template.name));
        section.append(heading);
        const view = R.dom("div", { class: "view-only" });
        view.append(R.dom("p", { class: "small" }, services.filter(([key]) => template.channels.includes(key)).map(([, label]) => T(label)).join(" · ")));
        const tags = template.language_tags || [], labels = languageLabels(tags);
        view.append(R.dom("p", { class: "small template-language-tags" }, T("Language tags") + " · " + (tags.map(key => labels.get(key)).join(", ") || T("None selected"))));
        const v = version(template), enabled = options(v);
        if (enabled.includes("subject") && v?.subject) view.append(R.dom("strong", {}, v.subject));
        if (enabled.includes("message")) view.append(R.dom("pre", { class: "delivery-message" }, v?.body));
        if (enabled.includes("shortMessage")) view.append(R.dom("p", { class: "template-short-message" }, v?.short_body));
        if (enabled.includes("picture")) window.RSVP_INVITATION_IMAGE.preview(view, v?.message_image, { R, T });
        section.append(view);
        const form = can("settings", "edit") ? editor(template, section) : null;
        const test = R.dom("span", { class: "invitation-template-test" }); heading.append(test);
        window.RSVP_DEVICE_DELIVERY.appendShare(test, { R, T, show, testOnly: true, triggerClass: "small-tool", authorize: () => can("settings"), getDraft: () => {
          if (form?.localEditor?.box.classList.contains("local-editor-open")) return form.templateTestDraft();
          const sms = template.channels.every(c => c === "sms" || c === "messages");
          return preview(enabled.includes("subject") ? v?.subject : "", enabled.includes("shortMessage") && (sms || !enabled.includes("message")) ? v?.short_body : enabled.includes("message") ? v?.body : "{invitation_link}", enabled.includes("picture") && !sms ? v?.message_image : null, getStore().settings?.default_language, { venueId: v?.context_venue_id, sessionId: v?.context_session_id });
        } });
        cards.set(template.id, section);
        host.append(section);
      }
    }
    return { draft, choices, render };
  }
  window.RSVP_ADMIN_INVITATION_TEMPLATES = Object.freeze({ create });
})();
