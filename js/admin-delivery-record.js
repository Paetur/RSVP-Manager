// Invitation delivery draft editor, records, household sections and history.
// Permissions, mutable data, RPCs and reload remain controller-owned.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    disclosure,
    adminTime,
    show,
    can,
    managementRpc,
    householdPrimaryContact,
    householdPrimaryGuest,
    primaryContactChannel,
    managementForm,
    saveForm,
    invitationDraft,
    actorName,
    field,
    reload,
  }) {
    const $ = R.byId;
    function deliveryEditor(h, q = {}) {
      const primary = householdPrimaryContact(h),
        guest = householdPrimaryGuest(h);
      const f = managementForm();
      if (!q.id && q.message_body) f.dataset.initialDraft = "true";
      const channel = field(
        f,
        T("interface.messages.delivery_channel"),
        q.channel ||
          (primary
            ? primaryContactChannel(primary)
            : guest?.preferred_contact_method) ||
          "manual",
        [
          ["manual", T("interface.messages.manual_in_person")],
          ["email", T("interface.messages.email")],
          ["whatsapp", "WhatsApp"],
          ["sms", "SMS"],
          ["postal", T("interface.messages.postal")],
        ],
      );
      const contact = field(
        f,
        T("interface.messages.delivery_recipient"),
        q.contact_id || "",
        [
          ["", T("interface.messages.household_contact_details")],
          ...getStore()
            .contacts.filter((c) => c.household_id === h.id && !c.archived_at)
            .map((c) => [
              c.id,
              (c.contact_name || c.contact_type) + " · " + c.contact_value,
            ]),
        ],
      );
      const recipient = R.dom("p", { class: "micro span-2" });
      function showRecipient() {
        const c = getStore().contacts.find((c) => c.id === contact.value);
        const primaryType = {
          email: "email",
          sms: "phone",
          whatsapp: "phone",
          postal: "postal",
          manual: "other",
        }[channel.value];
        const value =
          c?.contact_value ||
          (primary?.contact_type === primaryType
            ? primary.contact_value
            : {
                email: guest?.email,
                sms: guest?.mobile,
                whatsapp: guest?.mobile,
                postal: h.postal_address,
                manual: h.household_name,
              }[channel.value]);
        recipient.textContent =
          T("interface.messages.recipient") +
          (value ||
            T(
              "interface.messages.missing_add_contact_details_before_marking_ready",
            ));
      }
      showRecipient();
      channel.addEventListener("change", showRecipient);
      contact.addEventListener("change", showRecipient);
      f.append(recipient);
      const useTemplate = !q.id && !q.message_body;
      let automatic = useTemplate ? invitationDraft(h, channel.value) : null;
      if (automatic?.hasTemplate) f.dataset.initialDraft = "true";
      const subject = field(
        f,
        T("interface.messages.message_subject"),
        q.message_subject ??
          automatic?.subject ??
          (q.id ? "" : getStore().settings?.event_name),
        null,
        "text",
        false,
        300,
      );
      const body = field(
        f,
        T("interface.messages.message_text"),
        q.message_body ??
          automatic?.body ??
          (getStore().settings?.is_published && h.invite_code
            ? R.invitationURL(h.invite_code)
            : "{invitation_link}"),
        null,
        "textarea",
        true,
        10000,
      );
      body.closest("label").classList.add("span-2");
      const picture = window.RSVP_INVITATION_IMAGE.editor(
        f, q.message_image ?? automatic?.image, { R, T },
      );
      if (useTemplate)
        channel.addEventListener("change", () => {
          const next = invitationDraft(h, channel.value);
          if (subject.value === automatic.subject) subject.value = next.subject;
          if (body.value === automatic.body) body.value = next.body;
          if (JSON.stringify(picture.get()) === JSON.stringify(automatic.image || null))
            picture.set(next.image);
          automatic = next;
          f.dataset.initialDraft = String(next.hasTemplate);
        });
      if (
        getStore().settings?.is_published &&
        h.invite_code &&
        q.id &&
        ["draft", "ready", "failed"].includes(q.status)
      ) {
        body.value = body.value.replaceAll(
          "{invitation_link}",
          R.invitationURL(h.invite_code),
        );
      }
      const status = field(
        f,
        T("interface.messages.delivery_status"),
        !getStore().settings?.is_published &&
          ["ready", "failed"].includes(q.status)
          ? "draft"
          : q.status || "draft",
        [
          ["draft", T("interface.messages.draft")],
          ...(getStore().settings?.is_published
            ? [["ready", T("interface.messages.ready_to_send")]]
            : []),
          ...(q.id
            ? [
                ...(getStore().settings?.is_published
                  ? [["failed", T("interface.messages.failed_attempt")]]
                  : []),
                ["cancelled", T("interface.messages.cancelled")],
              ]
            : []),
        ],
      );
      const reason = field(
        f,
        T("interface.messages.delivery_change_note"),
        "",
        null,
        "textarea",
        false,
        2000,
      );
      status.addEventListener(
        "change",
        () =>
          (reason.required = ["failed", "cancelled"].includes(status.value)),
      );
      f.append(
        R.dom(
          "p",
          { class: "micro span-2" },
          T(
            "interface.messages.saving_a_draft_or_marking_it_ready_does_not_send_a_message_review",
          ),
        ),
      );
      return saveForm(
        f,
        q.id
          ? T("interface.messages.save_delivery_changes")
          : T("interface.messages.create_delivery_draft"),
        async () =>
          managementRpc("admin_save_delivery", {
            p_id: q.id || null,
            p_household_id: h.id,
            p_expected_revision: q.revision ?? null,
            p_values: {
              channel: channel.value,
              contact_id: contact.value || null,
              message_subject: subject.value.trim(),
              message_body: body.value,
              message_image: await picture.read(),
              status: status.value,
              reason: reason.value.trim(),
            },
          }),
      );
    }

    function deliveryRecord(h, q, editable = true) {
      const store = getStore();
      const d = disclosure(
        ({
          email: T("interface.messages.email"),
          sms: "SMS",
          whatsapp: "WhatsApp",
          postal: T("interface.messages.postal"),
          manual: T("interface.messages.manual"),
        }[q.channel] || q.channel) +
          " · " +
          ({
            draft: T("interface.messages.draft"),
            ready: T("interface.messages.ready"),
            sent: T("interface.messages.recorded_sent"),
            failed: T("interface.messages.failed"),
            cancelled: T("interface.messages.cancelled"),
          }[q.status] || q.status) +
          " · " +
          adminTime(q.updated_at),
      );
      d.dataset.deliveryId = q.id;
      const recipient = q.recipient_snapshot || {};
      d.append(
        R.dom(
          "p",
          { class: "small" },
          T("interface.messages.to") +
            [recipient.contact_name, recipient.contact_value]
              .filter(Boolean)
              .join(" · "),
        ),
        R.dom("p", { class: "micro" }, q.message_subject || ""),
        R.dom("pre", { class: "delivery-message" }, q.message_body),
      );
      window.RSVP_INVITATION_IMAGE.preview(d, q.message_image, { R, T });
      const copy = R.dom(
        "button",
        { type: "button", class: "invite-text-action" },
        T("interface.messages.copy_message"),
      );
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(q.message_body);
          show(T("interface.messages.message_copied"), "success");
        } catch (error) {
          show(R.safeError(error), "error");
        }
      });
      d.append(copy);
      if (
        store.settings?.is_published &&
        can("sendInvites") &&
        q.status === "ready" &&
        !h.archived_at &&
        q.invitation_code_snapshot === h.invite_code
      ) {
        window.RSVP_DEVICE_DELIVERY.appendShare(d, {
          R,
          T,
          q,
          show,
          authorize: () =>
            managementRpc("admin_authorize_device_send", { p_queue_id: q.id }),
          recordHandoff: (id) =>
            managementRpc("admin_record_share_handoff", {
              p_queue_id: q.id,
              p_expected_revision: q.revision,
              p_handoff_id: id,
            }),
        });
        try {
          const href = window.RSVP_DEVICE_DELIVERY.compose(q);
          if (href) {
            const link = R.dom(
              "a",
              { class: "invite-text-action" },
              T(
                {
                  email: "Open email",
                  sms: "Open Messages",
                  whatsapp: "Open WhatsApp",
                }[q.channel],
              ),
            );
            link.href = href;
            link.rel = "noopener noreferrer";
            if (q.channel === "whatsapp") link.target = "_blank";
            link.addEventListener("click", async (event) => {
              event.preventDefault();
              const popup =
                q.channel === "whatsapp"
                  ? window.open("about:blank", "_blank")
                  : null;
              try {
                if (
                  (await managementRpc("admin_authorize_device_send", {
                    p_queue_id: q.id,
                  })) !== true
                )
                  throw Error(
                    T(
                      "This action is not allowed by your administrator permissions.",
                    ),
                  );
                if (popup) {
                  popup.opener = null;
                  popup.location.href = href;
                } else location.href = href;
              } catch (error) {
                popup?.close();
                show(R.safeError(error), "error");
              }
            });
            d.append(link);
            d.append(
              R.dom(
                "p",
                { class: "micro" },
                T(
                  q.channel === "sms"
                    ? "Copy the message, open Messages, then paste and send."
                    : "Review the message in your device app and tap Send.",
                ),
              ),
            );
            d.append(
              R.dom(
                "p",
                { class: "micro" },
                T(
                  "interface.messages.opening_an_app_does_not_mark_this_message_as_sent_return_here_to_",
                ),
              ),
            );
          }
        } catch (error) {
          d.append(R.dom("p", { class: "notice" }, T(error.message)));
        }
      } else if (
        store.settings?.is_published &&
        can("sendInvites") &&
        q.status === "ready"
      )
        d.append(
          R.dom(
            "p",
            { class: "notice" },
            T(
              "interface.messages.refresh_and_save_this_delivery_again_before_sending",
            ),
          ),
        );
      if (
        store.settings?.is_published &&
        can("invites", "edit") &&
        editable &&
        q.status === "sent" &&
        !h.archived_at
      ) {
        const followup = disclosure(
          T("interface.messages.prepare_reminder"),
          "edit-only",
        );
        followup.append(
          R.dom(
            "p",
            { class: "micro" },
            T(
              "interface.messages.creates_a_separate_draft_using_current_contact_details_review_the",
            ),
          ),
        );
        const code = h.language || store.settings?.default_language || "en";
        const message =
          window.RSVP_I18N?.t(
            "interface.messages.a_friendly_reminder_to_reply_to_our_invitation",
            {},
            code,
          ) || "A friendly reminder to reply to our invitation:";
        followup.append(
          deliveryEditor(h, {
            channel: q.channel,
            contact_id: q.contact_id,
            message_subject: q.message_subject,
            message_body: message + "\n" + R.invitationURL(h.invite_code),
          }),
        );
        d.append(followup);
      }
      const sent = store.deliveries.find((x) => x.queue_id === q.id);
      if (sent)
        d.append(
          R.dom(
            "p",
            { class: "notice success" },
            T("interface.messages.manually_recorded_as_sent") +
              adminTime(sent.confirmed_at) +
              " · " +
              actorName(sent.confirmed_by) +
              (sent.delivery_note ? " · " + sent.delivery_note : ""),
          ),
        );
      if (
        can("invites", "edit") &&
        editable &&
        !["sent", "cancelled"].includes(q.status)
      ) {
        const edit = disclosure(
          T("interface.messages.edit_delivery"),
          "edit-only",
        );
        edit.append(deliveryEditor(h, q));
        d.append(edit);
      }
      if (
        store.settings?.is_published &&
        can("sendInvites") &&
        q.status === "ready"
      ) {
        const form = R.dom("form", { class: "invitation-send-form form-grid" }),
          note = field(
            form,
            T("interface.messages.sent_note"),
            "",
            null,
            "textarea",
            false,
            2000,
          ),
          ack = field(
            form,
            T(
              "interface.messages.i_sent_this_message_to_the_displayed_recipient",
            ),
            false,
            null,
            "checkbox",
            true,
          ),
          save = R.dom(
            "button",
            { class: "btn", type: "submit" },
            T("interface.messages.record_as_sent"),
          );
        save.disabled = true;
        ack.addEventListener("change", () => (save.disabled = !ack.checked));
        form.append(save);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!ack.checked || !can("sendInvites")) return;
          save.disabled = true;
          try {
            await managementRpc("admin_record_delivery_sent", {
              p_queue_id: q.id,
              p_expected_revision: q.revision,
              p_note: note.value.trim(),
            });
            await reload();
          } catch (error) {
            show(R.safeError(error), "error");
            save.disabled = false;
          }
        });
        d.append(form);
      }
      return d;
    }
    function deliverySection(h) {
      const store = getStore();
      const d = disclosure(
        T("interface.messages.invitation_delivery"),
        "feature-section",
      );
      const records = store.queue
        .filter((q) => q.household_id === h.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      d.append(
        R.dom(
          "p",
          { class: "micro" },
          records.length
            ? T("interface.messages.sent_recorded_sent_pending_pending", {
                sent: records.filter((q) => q.status === "sent").length,
                pending: records.filter((q) =>
                  ["draft", "ready", "failed"].includes(q.status),
                ).length,
              })
            : T("interface.messages.no_delivery_recorded_yet"),
        ),
      );
      if (!h.archived_at && can("invites", "edit")) {
        const create = disclosure(
          T("interface.messages.prepare_delivery"),
          "edit-only",
        );
        create.append(deliveryEditor(h));
        d.append(create);
      }
      if (!store.settings?.is_published)
        d.append(
          R.dom(
            "p",
            { class: "micro" },
            T(
              "Prepare drafts now. Marking ready and sending become available after publication.",
            ),
          ),
        );
      records.forEach((q) => d.append(deliveryRecord(h, q)));
      return d;
    }
    function renderDeliveryLog() {
      const store = getStore();
      const box = $("deliveryLog");
      box.replaceChildren();
      const filter = $("deliveryStatusFilter").value;
      const records = store.queue
        .filter((q) => !filter || q.status === filter)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      $("deliveryCounts").textContent = T(
        "interface.messages.ready_ready_sent_recorded_sent_failed_failed",
        {
          ready: store.queue.filter((q) => q.status === "ready").length,
          sent: store.queue.filter((q) => q.status === "sent").length,
          failed: store.queue.filter((q) => q.status === "failed").length,
        },
      );
      for (const q of records) {
        const h = store.households.find((h) => h.id === q.household_id);
        if (!h) continue;
        const wrapper = disclosure(
          h.household_name +
            (h.archived_at ? T("interface.messages.archived_2") : ""),
        );
        wrapper.append(deliveryRecord(h, q, false));
        box.append(wrapper);
      }
      if (!records.length)
        box.append(
          R.dom(
            "p",
            { class: "micro" },
            T("interface.messages.no_deliveries_match_this_status"),
          ),
        );
    }

    return {
      editor: deliveryEditor,
      record: deliveryRecord,
      section: deliverySection,
      renderLog: renderDeliveryLog,
    };
  }
  window.RSVP_ADMIN_DELIVERY_RECORD = Object.freeze({ create });
})();
