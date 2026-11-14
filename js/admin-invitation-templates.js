// Invitation template rendering and draft generation; controller owns state and saves.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    can,
    languages,
    disclosure,
    expandedGroups,
    row,
    managementForm,
    field,
    saveForm,
    managementRpc,
    show,
  }) {
    const $ = R.byId;
    const invitationChannels = [
      ["email", "interface.messages.email"],
      ["sms", "SMS"],
      ["whatsapp", "WhatsApp"],
      ["manual", "interface.messages.manual_messenger_template"],
    ];
    const invitationTokens = [
      "invitation_link",
      "event_name",
      "household_name",
    ];
    function invitationTemplate(language, channel) {
      return getStore().invitationTemplates.find(
        (t) => t.language_code === language && t.channel === channel,
      );
    }
    function invitationDraft(h, channel) {
      const enabled = new Set(languages().map(([code]) => code));
      const template = [
        h.language,
        getStore().settings?.fallback_language,
        "en",
      ]
        .filter((code) => enabled.has(code) || code === "en")
        .map((code) => invitationTemplate(code, channel))
        .find(Boolean);
      const values = {
        invitation_link:
          getStore().settings?.is_published && h.invite_code
            ? R.invitationURL(h.invite_code)
            : "{invitation_link}",
        event_name: getStore().settings?.event_name || "",
        household_name: h.household_name || "",
      };
      const fill = (text) =>
        text.replace(
          /\{(invitation_link|event_name|household_name)\}/g,
          (_, key) => values[key],
        );
      return {
        subject: fill(template?.subject || "{event_name}"),
        body: fill(template?.body || "{invitation_link}"),
        image: template?.message_image || null,
        hasTemplate: !!template,
      };
    }
    function previewDraft(subject, body, image) {
      const values = {
        invitation_link: R.guestPreviewURL("landing"),
        event_name: T("interface.messages.sample_invitation_event"),
        household_name: T("Sample household"),
      };
      const fill = (text) => text.replace(
        /\{(invitation_link|event_name|household_name)\}/g,
        (_, token) => values[token],
      );
      return {
        message_subject: fill(subject || "{event_name}"),
        message_body: fill(body || "{invitation_link}"),
        message_image: image || null,
      };
    }
    function renderInvitationTemplates() {
      const host = $("invitationTemplatesList");
      host.replaceChildren();
      if (!can("settings")) return;
      const editable = can("settings", "edit");
      for (const [language, name] of languages()) {
        const group = disclosure(name);
        const key = "invitation-templates:" + language;
        group.open =
          expandedGroups.get(key) ??
          language === (getStore().settings?.default_language || "en");
        group.addEventListener("toggle", () =>
          expandedGroups.set(key, group.open),
        );
        const content = row(group, "div", { class: "admin-management-body" });
        for (const [channel, label] of invitationChannels) {
          const template = invitationTemplate(language, channel);
          const section = row(content, "section", {
            class: "invitation-template",
          });
          section.dataset.settingsCard = key + ":" + channel;
          const heading = row(section, "div", { class: "settings-card-heading" });
          row(heading, "h3", {}, T(label));
          const view = row(section, "div", { class: "view-only" });
          if (template?.subject)
            row(view, "p", { class: "small" }, template.subject);
          if (template?.body)
            row(view, "pre", { class: "delivery-message" }, template.body);
          else
            row(
              view,
              "p",
              { class: "micro" },
              T("No custom template. New drafts use fallback wording."),
            );
          window.RSVP_INVITATION_IMAGE.preview(view, template?.message_image, { R, T });
          // Keep this action outside the editor/read-summary clone lifecycle.
          let testDraft = () => previewDraft(template?.subject, template?.body, template?.message_image);
          const testHost = row(heading, "span", { class: "invitation-template-test" });
          window.RSVP_DEVICE_DELIVERY.appendShare(testHost, {
            R, T, show, testOnly: true, triggerClass: "small-tool",
            authorize: () => can("settings"),
            getDraft: () => testDraft(),
          });
          if (!editable) continue;
          const f = managementForm();
          f.dataset.formKey = key + ":" + channel;
          f.dataset.headerEditor = "true";
          const subject =
            channel === "email"
              ? field(
                  f,
                  T("interface.messages.message_subject"),
                  template?.subject,
                  null,
                  "text",
                  false,
                  300,
                )
              : null;
          subject?.closest("label").classList.add("span-2");
          const body = field(
            f,
            T("interface.messages.message_text"),
            template?.body,
            null,
            "textarea",
            false,
            4000,
          );
          body.closest("label").classList.add("span-2");
          if (subject)
            window.RSVP_PLACEHOLDER_HELP.attach(subject, {
              R,
              T,
              kind: "invitation",
            });
          window.RSVP_PLACEHOLDER_HELP.attach(body, {
            R,
            T,
            kind: "invitation",
            requiredLink: true,
          });
          const help = row(
            f,
            "p",
            { class: "micro span-2" },
            T(
              "Include the invitation link placeholder. Clear the fields to use fallback wording.",
            ),
          );
          const picture = window.RSVP_INVITATION_IMAGE.editor(f, template?.message_image, { R, T });
          testDraft = async () => {
            const editing = f.localEditor?.box.classList.contains("local-editor-open");
            return editing
              ? previewDraft(subject?.value, body.value, await picture.read())
              : previewDraft(template?.subject, template?.body, template?.message_image);
          };
          section.append(
            saveForm(f, T("Save template"), async () => {
              const subjectText = subject?.value.trim() || "",
                bodyText = body.value.trim();
              if (
                (subjectText || bodyText) &&
                !bodyText.includes("{invitation_link}")
              )
                throw Error(
                  T("Include the invitation link placeholder in the message."),
                );
              if (
                [
                  ...`${subjectText}\n${bodyText}`.matchAll(
                    /\{([\p{L}\p{N}_]+)\}/gu,
                  ),
                ].some(([, token]) => !invitationTokens.includes(token))
              )
                throw Error(
                  T("The invitation template contains an unknown placeholder."),
                );
              await managementRpc("admin_save_invitation_template", {
                p_language: language,
                p_channel: channel,
                p_subject: subjectText,
                p_body: bodyText,
                p_image: await picture.read(),
              });
            }),
          );
        }
        host.append(group);
      }
    }

    return { draft: invitationDraft, render: renderInvitationTemplates };
  }
  window.RSVP_ADMIN_INVITATION_TEMPLATES = Object.freeze({ create });
})();
