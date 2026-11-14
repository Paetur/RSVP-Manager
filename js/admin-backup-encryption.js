// Passwords exist only in temporary controls/operation memory, never settings or RPCs.
(function () {
  "use strict";
  function create({ R, T }) {
    const $ = R.byId;
    let pending = null;
    const toggle = $("backupExportEncrypted"),
      fields = $("backupEncryptionFields"),
      password = $("backupEncryptionPassword"),
      confirmation = $("backupEncryptionConfirm");
    function clearPasswords() {
      password.value = "";
      confirmation.value = "";
    }
    function update() {
      const supported = window.RSVP_BACKUP_CRYPTO.canEncrypt();
      toggle.disabled = !supported;
      if (!supported) toggle.checked = false;
      fields.classList.toggle("hidden", !toggle.checked);
      password.disabled = confirmation.disabled = !toggle.checked;
      $("backupEncryptionUnavailable").classList.toggle("hidden", supported);
      if (!toggle.checked) clearPasswords();
    }
    toggle.addEventListener("change", update);
    function exportOptions() {
      if (!toggle.checked) return null;
      if (!window.RSVP_BACKUP_CRYPTO.canEncrypt())
        throw Error(
          T(
            "Encryption requires HTTPS, Web Crypto and Web Workers. Unencrypted backups remain available.",
          ),
        );
      if (!password.value) {
        password.focus();
        throw Error(T("Enter a backup password."));
      }
      if (password.value !== confirmation.value) {
        confirmation.focus();
        throw Error(T("Backup passwords do not match."));
      }
      return { password: password.value };
    }
    function cancelPending() {
      pending?.();
      pending = null;
    }
    function resetImport() {
      cancelPending();
      $("retryEncryptedBackup").classList.add("hidden");
    }
    function requestPassword() {
      cancelPending();
      $("retryEncryptedBackup").classList.remove("hidden");
      return new Promise((resolve, reject) => {
        const dialog = R.dom("dialog", { class: "backup-password-dialog" }),
          form = R.dom("form"),
          label = R.dom("label"),
          input = R.dom("input", {
            type: "password",
            autocomplete: "off",
            maxlength: 1024,
            required: true,
          }),
          actions = R.dom("div", { class: "form-actions" }),
          open = R.dom(
            "button",
            { type: "submit", class: "btn" },
            T("Open encrypted backup"),
          ),
          cancel = R.dom(
            "button",
            { type: "button", class: "btn secondary" },
            T("Cancel"),
          );
        const title = T("Encrypted backup");
        dialog.setAttribute("aria-label", title);
        dialog.append(
          R.dom("h2", {}, title),
          R.dom(
            "p",
            { class: "micro" },
            T(
              "Enter this file’s backup password. It is not your administrator password.",
            ),
          ),
        );
        label.append(R.dom("span", {}, T("Backup password")), input);
        input.setAttribute("aria-label", T("Backup password"));
        form.append(label, actions);
        actions.append(open, cancel);
        dialog.append(form);
        let settled = false;
        const cleanup = () => {
          input.value = "";
          if (pending === abort) pending = null;
          dialog.close();
          dialog.remove();
        };
        const abort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          const error = Error(T("Opening encrypted backup cancelled."));
          error.code = "BACKUP_PASSWORD_CANCELLED";
          reject(error);
        };
        pending = abort;
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          if (!input.value || settled) return;
          settled = true;
          const value = input.value;
          cleanup();
          resolve(value);
        });
        cancel.addEventListener("click", abort);
        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          abort();
        });
        $("adminApp").append(dialog);
        dialog.showModal();
        input.focus();
      });
    }
    $("retryEncryptedBackup").addEventListener("click", () =>
      $("backupFile").dispatchEvent(new Event("change")),
    );
    // Clear visible secrets when leaving the tab or the page. No storage APIs are used.
    window.addEventListener("pagehide", () => {
      clearPasswords();
      cancelPending();
    });
    const tab = toggle.closest("[data-settings-panel]");
    new MutationObserver(() => {
      if (tab.classList.contains("hidden")) {
        clearPasswords();
        cancelPending();
      }
    }).observe(tab, { attributes: true, attributeFilter: ["class"] });
    update();
    return {
      update,
      exportOptions,
      clearPasswords,
      resetImport,
      requestPassword,
      opened: () => $("retryEncryptedBackup").classList.add("hidden"),
    };
  }
  window.RSVP_ADMIN_BACKUP_ENCRYPTION = Object.freeze({ create });
})();
