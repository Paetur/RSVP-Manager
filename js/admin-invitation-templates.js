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
  }) {
    const $ = R.byId;
    const invitationChannels = [
      ["email", "interface.messages.email"],
      ["sms", "SMS"],
      ["whatsapp", "WhatsApp"],
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
        hasTemplate: !!template,
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
          row(section, "h3", {}, T(label));
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
          if (!editable) continue;
          const f = managementForm();
          f.dataset.formKey = key + ":" + channel;
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
