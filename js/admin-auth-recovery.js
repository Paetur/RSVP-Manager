(function () {
  "use strict";
  function create({ R, T, onBlock, onMessage }) {
    const $ = R.byId, entry = new URL(location.href),
      hash = new URLSearchParams(entry.hash.slice(1)),
      intent = entry.searchParams.get("auth") === "recovery" || hash.get("type") === "recovery" ||
        (!entry.searchParams.has("admin-invitation") &&
          (hash.has("error") || hash.has("error_code") || entry.searchParams.has("error") || entry.searchParams.has("error_code")));
    let db = null, active = intent, ready = false, busy = false,
      recoveryUser = null, recoveryTask = null, revision = 0, finishing = false,
      sessionNeedsCleanup = intent;
    const requestPanel = $("passwordRecoveryRequestPanel"),
      resetPanel = $("passwordRecoveryPanel"),
      requestForm = $("passwordRecoveryRequestForm"),
      resetForm = $("passwordRecoveryForm"),
      requestStatus = $("passwordRecoveryRequestStatus"),
      resetStatus = $("passwordRecoveryStatus");
    const expired = () => T("This password reset link is invalid, expired or already used. Request a new link.");
    const cleanURL = (recovering = false) =>
      history.replaceState(null, "", location.pathname + (recovering ? "?auth=recovery" : ""));
    function feedback(node, text, error = false) {
      node.textContent = text;
      node.classList.toggle("auth-error", error);
    }
    function hideAccess() {
      for (const id of ["loginPanel", "acceptInvitationPanel", "adminApp", "adminTopActions"])
        $(id)?.classList.add("hidden");
      document.querySelector(".admin-section-menu")?.classList.add("hidden");
    }
    function block() {
      active = true;
      hideAccess();
      onBlock();
    }
    function showReset() {
      block();
      requestPanel.classList.add("hidden");
      resetPanel.classList.remove("hidden");
    }
    function controls(form, disabled) {
      form.setAttribute("aria-busy", String(disabled));
      form.querySelectorAll("input,button").forEach(input => input.disabled = disabled);
    }
    function clearPasswords() {
      $("recoveryPassword").value = "";
      $("recoveryPasswordConfirm").value = "";
    }
    function invalid() {
      ready = false;
      recoveryUser = null;
      clearPasswords();
      showReset();
      resetForm.classList.add("hidden");
      $("requestAnotherReset").classList.remove("hidden");
      feedback(resetStatus, expired(), true);
      cleanURL(true);
    }
    function handleRecovery(session) {
      sessionNeedsCleanup = true;
      if (!session?.user?.id || !session.access_token) {
        invalid();
        return;
      }
      const ticket = ++revision;
      ready = false;
      recoveryUser = session.user.id;
      showReset();
      resetForm.classList.add("hidden");
      feedback(resetStatus, T("Checking your password reset link…"));
      // Auth callbacks run under the SDK lock; verify only after returning.
      recoveryTask = new Promise(resolve => setTimeout(async () => {
        try {
          const result = await db.auth.getUser();
          if (ticket !== revision) return;
          if (result.error || result.data?.user?.id !== recoveryUser) {
            invalid();
            return;
          }
          $("recoveryEmail").value = result.data.user.email || "";
          ready = true;
          cleanURL(true);
          resetForm.classList.remove("hidden");
          $("requestAnotherReset").classList.add("hidden");
          feedback(resetStatus, "");
        } catch (_) {
          if (ticket === revision) invalid();
        } finally {
          resolve();
        }
      }, 0));
    }
    async function revealSetupHelp() {
      const help = $("adminSetupHelp"), link = $("adminSetupLink");
      if (!help || !link) return;
      let available = !db;
      if (db) {
        try {
          const result = await db.rpc("get_setup_status");
          available = !result.error && result.data?.initialized === false && result.data?.setup_locked !== true;
        } catch (_) {}
      }
      help.classList.toggle("hidden", !available);
      link.classList.toggle("hidden", !available);
    }
    function openRequest() {
      if (busy) return;
      block();
      ready = false;
      requestPanel.classList.remove("hidden");
      resetPanel.classList.add("hidden");
      $("recoveryRequestEmail").value = $("recoveryEmail").value || $("loginEmail").value;
      feedback(requestStatus, "");
      $("recoveryRequestEmail").focus();
    }
    async function returnToLogin(message = "") {
      if (busy) return;
      busy = true;
      finishing = true;
      ready = false;
      ++revision;
      clearPasswords();
      $("cancelPasswordRecovery").disabled = true;
      $("cancelPasswordRecoveryRequest").disabled = true;
      try {
        if (db && sessionNeedsCleanup) {
          const result = await db.auth.signOut({ scope: "local" });
          if (result.error) throw result.error;
        }
        sessionNeedsCleanup = false;
        recoveryUser = null;
        active = false;
        cleanURL();
        requestPanel.classList.add("hidden");
        resetPanel.classList.add("hidden");
        $("loginPanel").classList.remove("hidden");
        $("loginPassword").value = "";
        onMessage(message, message ? "success" : "info");
        $("loginEmail").focus();
      } catch (_) {
        feedback(requestPanel.classList.contains("hidden") ? resetStatus : requestStatus,
          T("Could not end the recovery session. Try returning to sign-in again."), true);
      } finally {
        busy = false;
        finishing = false;
        $("cancelPasswordRecovery").disabled = false;
        $("cancelPasswordRecoveryRequest").disabled = false;
      }
    }
    $("forgotPassword").addEventListener("click", openRequest);
    $("requestAnotherReset").addEventListener("click", openRequest);
    $("cancelPasswordRecovery").addEventListener("click", () => returnToLogin());
    $("cancelPasswordRecoveryRequest").addEventListener("click", () => returnToLogin());
    requestForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !db || !requestForm.reportValidity()) return;
      busy = true;
      controls(requestForm, true);
      feedback(requestStatus, "");
      try {
        const redirect = new URL("admin/", R.siteRoot);
        const result = await db.auth.resetPasswordForEmail($("recoveryRequestEmail").value.trim(), {
          redirectTo: redirect.href,
        });
        // Auth may report account-specific client errors; keep the outcome neutral.
        if (result.error && (!result.error.status || result.error.status === 429 || result.error.status >= 500))
          throw result.error;
        feedback(requestStatus, T("If an account matches this email, you will receive a password reset link."));
      } catch (_) {
        feedback(requestStatus, T("Could not request a reset link. Check the connection and try again."), true);
      } finally {
        busy = false;
        controls(requestForm, false);
      }
    });
    resetForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !ready || !db || !resetForm.reportValidity()) return;
      const password = $("recoveryPassword").value;
      if (password.length < 12 || password !== $("recoveryPasswordConfirm").value) {
        feedback(resetStatus, T("Enter matching passwords of at least 12 characters."), true);
        return;
      }
      busy = true;
      controls(resetForm, true);
      const ticket = revision;
      feedback(resetStatus, T("Saving new password…"));
      try {
        const current = await db.auth.getUser();
        if (ticket !== revision || current.error || current.data?.user?.id !== recoveryUser) {
          invalid();
          return;
        }
        const result = await db.auth.updateUser({ password });
        if (result.error) {
          if ([401, 403].includes(result.error.status) || ["session_not_found", "refresh_token_not_found"].includes(result.error.code))
            invalid();
          else
            feedback(resetStatus, T("Could not save the new password. Check the connection and password requirements, then try again."), true);
          return;
        }
        ready = false;
        clearPasswords();
        resetForm.classList.add("hidden");
        $("loginEmail").value = current.data.user.email || "";
        busy = false;
        await returnToLogin(T("Password updated. Sign in with your new password."));
      } catch (_) {
        feedback(resetStatus, T("Could not save the new password. Check the connection and password requirements, then try again."), true);
      } finally {
        busy = false;
        controls(resetForm, false);
      }
    });
    async function start() {
      const config = R.config();
      // A recovery session must never share mutable storage, auth events or an
      // SDK lock with the normal account: another tab may sign in while saving.
      db = intent && config.supabaseUrl && config.supabaseKey ?
        window.supabase.createClient(R.normalizeUrl(config.supabaseUrl), R.validateKey(config.supabaseKey), {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: true,
            storageKey: "rsvp-password-recovery:" + R.siteRoot.href,
          },
        }) : R.getClient();
      $("forgotPassword").disabled = !db;
      revealSetupHelp();
      if (!db) return;
      db.auth.onAuthStateChange?.((event, session) => {
        if (event === "PASSWORD_RECOVERY") handleRecovery(session);
        else if (active && !finishing &&
          (event === "SIGNED_OUT" || (session?.user?.id && recoveryUser && session.user.id !== recoveryUser))) {
          ++revision;
          invalid();
        }
      });
      if (!intent) return;
      showReset();
      try {
        const result = await db.auth.getSession();
        // The pinned SDK emits PASSWORD_RECOVERY on the next task after initialization.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (recoveryTask) await recoveryTask;
        if (result.error || !ready) invalid();
      } catch (_) {
        invalid();
      }
    }
    return {
      start,
      blocksAccess: () => active,
      refreshText: () => {
        for (const node of [requestStatus, resetStatus])
          if (node.textContent) node.textContent = T(node.textContent);
      },
    };
  }
  window.RSVP_ADMIN_AUTH_RECOVERY = { create };
})();
