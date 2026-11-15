(function () {
  "use strict";
  // Construct only explicit single-recipient handoffs. Opening a composer never records sending.
  function compose(q) {
    if (/[{}]/.test((q.message_body || "") + (q.message_subject || ""))) throw Error("Replace unresolved placeholders before sharing.");
    const raw = String(q.recipient_snapshot?.contact_value || "").trim();
    if (q.channel === "email") {
      if (!/^[^\s@<>?,;:]+@[^\s@<>?,;:]+\.[^\s@<>?,;:]+$/.test(raw))
        throw Error("Enter one valid email address.");
      return (
        "mailto:" +
        encodeURIComponent(raw) +
        "?subject=" +
        encodeURIComponent(q.message_subject || "") +
        "&body=" +
        encodeURIComponent(q.message_body || "")
      );
    }
    if (!["sms", "whatsapp"].includes(q.channel)) return null;
    if (!/^(\+|00)[1-9][0-9 ()-]*$/.test(raw))
      throw Error("Use an international phone number, including country code.");
    const digits = raw.replace(/^00/, "+").replace(/[^0-9]/g, "");
    if (digits.length < 7 || digits.length > 15)
      throw Error("Use an international phone number, including country code.");
    return q.channel === "sms"
      ? "sms:+" + digits
      : "https://wa.me/" +
          digits +
          "?text=" +
          encodeURIComponent(q.message_body || "");
  }
  function sharePayload(q, pictureOnly = false) {
    if (/[{}]/.test((q.message_body || "") + (q.message_subject || ""))) throw Error("Replace unresolved placeholders before sharing.");
    if (q.message_image) {
      const files = [window.RSVP_INVITATION_IMAGE.file(q.message_image)];
      // Keep the invitation link inside the caption when sharing a file: some
      // targets discard a separate URL when they also receive an attachment.
      return pictureOnly ? { files } : {
        files,
        title: String(q.message_subject || ""),
        text: String(q.message_body || ""),
      };
    }
    const body = String(q.message_body || "");
    const payload = { title: String(q.message_subject || ""), text: body };
    // Link-oriented targets need an explicit URL. Select only the current
    // invitation link already present in the reviewed message, never another URL.
    const code = String(q.invitation_code_snapshot || "");
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return payload;
    for (const match of body.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      const candidate = match[0].replace(/[).,!?;]+$/, "");
      try {
        const url = new URL(candidate);
        const queryCode = decodeURIComponent(
          url.search.slice(1).replace(/^=/, ""),
        );
        if (url.username || url.password || queryCode !== code) continue;
        payload.url = candidate;
        payload.text = body
          .replaceAll(candidate, "")
          .replace(/[ \t]+\n/g, "\n")
          .trim();
        break;
      } catch (_) {
        // Malformed links retain the existing text-only handoff.
      }
    }
    return payload;
  }
  function appendShare(host, { R, T, q: initialQ, getDraft, testOnly = false, triggerClass = "invite-text-action", authorize, recordHandoff, show }) {
    const shareLabel = T(testOnly ? "interface.messages.test_invitation_sharing" : "interface.messages.share_invitation");
    const trigger = R.dom(
      "button",
      { type: "button", class: triggerClass },
      shareLabel,
    );
    host.append(trigger);
    trigger.addEventListener("click", async () => {
      if (trigger.disabled) return;
      trigger.disabled = true;
      let q = initialQ;
      try {
        if (getDraft) q = await getDraft();
      } catch (error) {
        show(R.safeError(error), "error");
        trigger.disabled = false;
        return;
      }
      const dialog = R.inlinePanel({
        class: "food-recipe-dialog invitation-share-dialog",
      }, trigger);
      dialog.setAttribute(
        "aria-label",
        shareLabel,
      );
      dialog.append(
        R.dom("h2", {}, shareLabel),
        R.dom(
          "p",
          { class: "small" },
          [
            q.recipient_snapshot?.contact_name,
            q.recipient_snapshot?.contact_value,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        R.dom("pre", { class: "delivery-message" }, q.message_body || ""),
        R.dom(
          "p",
          { class: "micro" },
          T(testOnly ? "interface.messages.test_invitation_preview_help" : "interface.messages.share_invitation_help"),
        ),
      );
      window.RSVP_INVITATION_IMAGE.preview(dialog, q.message_image, { R, T });
      if (q.message_image)
        dialog.append(R.dom("p", { class: "micro" }, T("interface.messages.invitation_picture_share_help")));
      const feedback = R.dom("p", { class: "micro", role: "status" }),
        actions = R.dom("div", { class: "form-actions" });
      const share = R.dom(
        "button",
        { type: "button", class: "btn" },
        T("interface.messages.share_invitation"),
      );
      if (q.message_image) share.textContent = T("interface.messages.share_picture_and_text");
      const sharePicture = R.dom("button", { type: "button", class: "btn secondary" }, T("interface.messages.share_picture"));
      const copy = R.dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("interface.messages.copy_message"),
      );
      const close = R.dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("interface.messages.popup_close"),
      );
      share.disabled = sharePicture.disabled = copy.disabled = true;
      const supported =
        window.isSecureContext && typeof navigator.share === "function";
      share.classList.toggle("hidden", !supported);
      sharePicture.classList.toggle("hidden", !supported || !q.message_image);
      if (!supported)
        feedback.textContent = T("interface.messages.share_unavailable");
      const retry = R.dom(
        "button",
        { type: "button", class: "btn secondary hidden" },
        T("interface.messages.retry_share_logging"),
      );
      actions.append(share, sharePicture, retry, copy, close);
      dialog.append(feedback, actions);
      document.body.append(dialog);
      dialog.openInline();
      close.addEventListener("click", () => dialog.close());
      dialog.addEventListener("cancel", (event) => {
        if (busy) event.preventDefault();
      });
      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          trigger.disabled = false;
          if (trigger.isConnected) trigger.focus();
        },
        { once: true },
      );
      let busy = false,
        handoffId = null,
        pictureShared = false;
      async function logHandoff() {
        retry.disabled = true;
        try {
          if (testOnly) {
            feedback.textContent = T("interface.messages.test_invitation_preview_complete");
            return;
          }
          await recordHandoff(handoffId);
          if (dialog.isConnected) {
            retry.classList.add("hidden");
            feedback.textContent =
              T("interface.messages.share_handoff_completed") +
              ". " +
              T(
                "interface.messages.opening_an_app_does_not_mark_this_message_as_sent_return_here_to_",
              );
          }
        } catch (error) {
          if (dialog.isConnected) {
            retry.classList.remove("hidden");
            feedback.textContent = T("interface.messages.share_logging_failed");
          }
        } finally {
          retry.disabled = false;
        }
      }
      retry.addEventListener("click", async () => {
        if (busy || !handoffId) return;
        busy = true;
        share.disabled = sharePicture.disabled = copy.disabled = close.disabled = true;
        try {
          await logHandoff();
        } finally {
          busy = false;
          if (dialog.isConnected) {
            copy.disabled = close.disabled = false;
            share.disabled = true;
            sharePicture.disabled = pictureShared || !retry.classList.contains("hidden");
          }
        }
      });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(q.message_body || "");
          feedback.textContent = T("interface.messages.message_copied");
        } catch (error) {
          feedback.textContent = R.safeError(error);
        }
      });
      // Authorization is completed before this second, direct user gesture.
      // Do not await network work before invoking the activation-gated native sheet.
      async function performShare(pictureOnly) {
        const button = pictureOnly ? sharePicture : share;
        if (busy || button.disabled) return;
        busy = true;
        share.disabled = sharePicture.disabled = copy.disabled = close.disabled = true;
        try {
          const payload = sharePayload(q, pictureOnly);
          if ((payload.files && typeof navigator.canShare !== "function") ||
              (navigator.canShare && !navigator.canShare(payload)))
            throw Error(T("interface.messages.share_unavailable"));
          await navigator.share(payload);
          if (pictureOnly) pictureShared = true;
          handoffId = R.randomId();
          await logHandoff();
        } catch (error) {
          if (error.name !== "AbortError" && dialog.isConnected)
            feedback.textContent = R.safeError(error);
        } finally {
          busy = false;
          if (dialog.isConnected) {
            copy.disabled = close.disabled = false;
            share.disabled = handoffId !== null;
            sharePicture.disabled = pictureShared || !retry.classList.contains("hidden");
          }
        }
      }
      share.addEventListener("click", () => performShare(false));
      sharePicture.addEventListener("click", () => performShare(true));
      dialog.setAttribute("aria-busy", "true");
      try {
        if ((await authorize()) !== true)
          throw Error(
            T("This action is not allowed by your administrator permissions."),
          );
        if (dialog.isConnected) share.disabled = sharePicture.disabled = copy.disabled = false;
      } catch (error) {
        if (dialog.isConnected) feedback.textContent = R.safeError(error);
        else show(R.safeError(error), "error");
      } finally {
        dialog.removeAttribute("aria-busy");
      }
    });
  }
  window.RSVP_DEVICE_DELIVERY = Object.freeze({
    compose,
    sharePayload,
    appendShare,
  });
})();
