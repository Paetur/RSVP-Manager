(function () {
  "use strict";
  const T = (text, params) => window.RSVP_I18N?.t(text, params) || text;
  const R = window.RSVP,
    $ = R.byId;
  const connectionAtEntry = { ...R.config() },
    companionHandoff = location.hash.startsWith("#connection=")
      ? location.hash.slice("#connection=".length) : null;
  if (companionHandoff !== null)
    history.replaceState(null, "", location.pathname + location.search);
  let step = 1,
    mode = "existing",
    connected = false,
    verified = false;
  let connectionVersion = 0;
  let databaseLocation = "", setupLocked = false;
  const transportSecurity = window.RSVP_TRANSPORT_SECURITY?.create(
    document.querySelector('[data-transport-security="wizard"]'),
    {
      T,
      getActor: () => verified ? "verified" : null,
      canEdit: () => verified,
      getToken: async () => (await R.getClient()?.auth.getSession())?.data?.session?.access_token,
    },
  );
  function localEndpoints() {
    const host =
      R.siteRoot.protocol === "http:" ? R.siteRoot.hostname : "localhost";
    const studio = new URL("http://localhost:54323");
    studio.hostname = host;
    const api = new URL("http://localhost:54321");
    api.hostname = host;
    return { studio: studio.href, api: api.origin };
  }
  function updateDatabaseChoice() {
    const isNew = mode === "new",
      isLocal = isNew && databaseLocation === "local";
    $("databaseLocationChoices").classList.toggle("hidden", !isNew);
    $("newDatabaseInstructions").classList.toggle(
      "hidden",
      !isNew || !databaseLocation,
    );
    $("newCloudInstructions").classList.toggle(
      "hidden",
      !isNew || databaseLocation !== "cloud",
    );
    $("newLocalInstructions").classList.toggle("hidden", !isLocal);
    $("setupUrl").placeholder = isLocal
      ? localEndpoints().api
      : "https://your-project.supabase.co";
    $("localStudioLink").href = localEndpoints().studio;
    $("setupSiteSecrets").textContent = T(
      isLocal
        ? "interface.messages.setup_local_site_settings"
        : "interface.messages.setup_site_secrets",
      { origin: R.siteRoot.origin, siteUrl: R.siteRoot.href },
    );
    for (const id of ["setupDeploymentGuide"]) {
      $(id).href = isLocal ? "docs/LocalSetup.html" : "docs/StudioSetup.html";
      $(id).textContent = T(
        isLocal
          ? "Local Supabase setup guide"
          : "Edge Function deployment guide",
      );
    }
    document
      .querySelectorAll("[data-setup-local]")
      .forEach((el) => el.classList.toggle("hidden", !isLocal));
    document
      .querySelectorAll("[data-setup-cloud]")
      .forEach((el) => el.classList.toggle("hidden", isLocal));
  }
  function invalidateConnection() {
    $("bootstrapSql").value = "";
    connected = false;
    verified = false;
    transportSecurity?.clear();
    return ++connectionVersion;
  }
  const stateMessage = (m, t = "info") => R.showStatus("setupStatus", m, t);
  function displayStep(next) {
    if (setupLocked) return;
    if (next > 1 && mode === "new" && !databaseLocation) {
      stateMessage(T("Choose Local or Cloud before continuing."), "warning");
      return;
    }

    if (next > 2 && !connected) {
      stateMessage(
        T("interface.messages.test_your_supabase_connection_before_continuing"),
        "warning",
      );
      return;
    }
    if (next > 4 && !verified) {
      stateMessage(
        T("interface.messages.administrator_verification_required"),
        "warning",
      );
      return;
    }
    if (next === 4 && !verified) {
      stateMessage(
        T("interface.messages.sign_in_as_an_administrator_first"),
        "warning",
      );
      return;
    }
    step = Math.max(1, Math.min(5, next));
    document
      .querySelectorAll("[data-step-panel]")
      .forEach((p) =>
        p.classList.toggle("hidden", Number(p.dataset.stepPanel) !== step),
      );
    document
      .querySelectorAll("[data-step]")
      .forEach((b) =>
        b.classList.toggle("active", Number(b.dataset.step) === step),
      );
    if (step === 5) transportSecurity?.refresh();
    stateMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function testConnection(e) {
    e.preventDefault();
    const button =
      e.submitter || e.target.querySelector('button[type="submit"]');
    button.disabled = true;
    const version = invalidateConnection();
    try {
      const cfg = R.savePreview($("setupUrl").value, $("setupKey").value);
      const db = R.getClient();
      if (!(await checkSetup(db))) return;
      const { error } = await db.rpc("get_public_event");
      if (version !== connectionVersion) return;
      if (error)
        throw new Error(
          T(
            "interface.messages.database_connection_or_schema_validation_failed",
          ) + R.safeError(error),
        );
      const probe = await R.guestRpc("get_invitation_v2", {
        p_code: "AAAAAAAA",
      });
      if (version !== connectionVersion) return;
      if (probe.error)
        throw new Error(
          T(
            "interface.messages.guest_edge_function_is_unavailable_deploy_the_guest_gateway_funct",
          ) + R.safeError(probe.error),
        );
      connected = true;
      stateMessage(
        T(
          "interface.messages.connected_to_host_the_protected_guest_gateway_responded",
          { host: new URL(cfg.supabaseUrl).hostname },
        ),
        "success",
      );
      setTimeout(() => {
        if (version === connectionVersion && step === 2) displayStep(3);
      }, 1100);
    } catch (err) {
      if (version === connectionVersion)
        stateMessage(R.safeError(err), "error");
    } finally {
      button.disabled = false;
    }
  }
  function hideWizard() {
    setupLocked = true;
    $("bootstrapSql").value = "";
    $("setupCompanionEntry").classList.add("hidden");
    document.querySelectorAll(".steps, .wizard-step").forEach(node => node.classList.add("hidden"));
  }
  async function checkSetup(db) {
    try {
      const {data,error} = await db.rpc("get_setup_status");
      if(error || !data || typeof data.initialized !== "boolean") throw Error();
      if(data.setup_locked === true || data.initialized === true) {
        hideWizard();
        $("setupClosed").classList.remove("hidden");
        $("setupProbeFailure").classList.add("hidden");
        return false;
      }
      return true;
    } catch {
      hideWizard();
      $("setupProbeFailure").classList.remove("hidden");
      $("setupClosed").classList.add("hidden");
      return false;
    }
  }
  async function makeBootstrap() {
    if (!connected || setupLocked) return;
    const email = $("bootstrapEmail").value.trim(), version = connectionVersion;
    $("bootstrapSql").value = "";
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      stateMessage(T("interface.messages.enter_a_valid_administrator_email"), "warning");
      return;
    }
    const button = $("makeBootstrap");
    button.disabled = true;
    try {
      if (!(await checkSetup(R.getClient())) || version !== connectionVersion || !connected || $("bootstrapEmail").value.trim() !== email) return;
      const safeEmail = email.replace(/'/g, "''");
      const populated = [
        "households", "guests", "food_items", "food_claims", "other_items",
        "event_locations", "event_sessions", "message_templates", "invitation_send_queue",
        "invitation_deliveries", "guest_session_responses", "rsvp_submissions",
      ].map(table => "EXISTS(SELECT 1 FROM public." + table + ")").join("\n    OR ");
      $("bootstrapSql").value = `-- Run in your own Supabase SQL Editor after creating and confirming the Auth user.
BEGIN;
SELECT pg_advisory_xact_lock(19421,9201);
LOCK TABLE public.admins IN SHARE ROW EXCLUSIVE MODE;
DO $rsvp_first_admin$
BEGIN
  IF (public.get_setup_status()->>'setup_locked')::boolean IS DISTINCT FROM false
    OR (SELECT is_published FROM public.event_settings WHERE id=1) IS DISTINCT FROM false
    OR EXISTS(SELECT 1 FROM app_private.installation_state WHERE id)
    OR ${populated}
  THEN RAISE EXCEPTION 'First-time setup is closed or the event already contains data'; END IF;
END $rsvp_first_admin$;
INSERT INTO public.admins(user_id,name)
SELECT id,'Primary Administrator' FROM auth.users
WHERE lower(email)=lower('${safeEmail}')
  AND email_confirmed_at IS NOT NULL
  AND (SELECT count(*) FROM auth.users WHERE lower(email)=lower('${safeEmail}'))=1;
DO $rsvp_first_admin$
BEGIN
  IF (SELECT count(*) FROM public.admins)<>1 THEN
    RAISE EXCEPTION 'Create and confirm exactly one matching Auth account before running this SQL';
  END IF;
END $rsvp_first_admin$;
COMMIT;`;
      stateMessage(T("interface.messages.first_admin_sql_generated_this_must_be_executed_in_the_private_su"), "success");
    } finally {
      button.disabled = false;
    }
  }
  async function verifyAdmin(e) {
    e.preventDefault();
    const b = e.submitter || e.target.querySelector('button[type="submit"]');
    b.disabled = true;
    const version = connectionVersion;
    if (!connected) {
      b.disabled = false;
      return;
    }
    verified = false;
    try {
      const db = R.getClient();
      const { error } = await db.auth.signInWithPassword({
        email: $("setupAdminEmail").value.trim(),
        password: $("setupAdminPassword").value,
      });
      if (error) throw error;
      if (version !== connectionVersion) return;
      const access = await db.rpc("is_admin");
      if (version !== connectionVersion) return;
      if (access.error) throw access.error;
      if (access.data !== true)
        throw new Error(
          T(
            "interface.messages.this_account_does_not_have_administrator_access_run_the_first_adm",
          ),
        );
      verified = true;
      $("setupAdminPassword").value = "";
      displayStep(4);
    } catch (err) {
      if (version === connectionVersion)
        stateMessage(R.safeError(err), "error");
    } finally {
      b.disabled = false;
    }
  }
  async function setup() {
    const existing = connectionAtEntry, configured = !!(existing.supabaseUrl && existing.supabaseKey);
    let fromCompanion = false;
    if (companionHandoff !== null) {
      const handoff = companionHandoff;
      try {
        const config = JSON.parse(decodeURIComponent(handoff));
        if (!config || Object.keys(config).sort().join(",") !== "supabaseKey,supabaseUrl")
          throw Error();
        const url = R.normalizeUrl(config.supabaseUrl), key = R.validateKey(config.supabaseKey);
        if (configured) {
          if (url !== R.normalizeUrl(existing.supabaseUrl) || key !== R.validateKey(existing.supabaseKey))
            throw Error();
          // A completed companion may reopen sign-in, never replace this installation.
        } else {
          R.savePreview(url, key);
        }
        fromCompanion = true;
      } catch {
        hideWizard();
        $("setupProbeFailure").classList.remove("hidden");
        stateMessage(T("Invalid public connection configuration."), "error");
        return;
      }
    }
    if (configured && !(await checkSetup(R.getClient()))) return;
    const cfg = R.config();
    if (fromCompanion) {
      location.replace(new URL("admin/", R.siteRoot).href);
      return;
    }

    $("setupAuthURLs").textContent = T("interface.messages.setup_auth_urls", {
      siteUrl: R.siteRoot.href,
      redirectUrl: new URL("admin/?admin-invitation=1", R.siteRoot).href,
    });
    $("setupUrl").value = cfg.supabaseUrl || "";
    $("setupKey").value = cfg.supabaseKey || "";
    document.querySelectorAll('input[name="dbMode"]').forEach((b) =>
      b.addEventListener("change", () => {
        mode = b.value;
        updateDatabaseChoice();
        invalidateConnection();
        stateMessage("");
      }),
    );
    document.querySelectorAll('input[name="databaseLocation"]').forEach((b) =>
      b.addEventListener("change", () => {
        databaseLocation = b.value;
        updateDatabaseChoice();
        invalidateConnection();
        stateMessage("");
      }),
    );
    updateDatabaseChoice();
    document
      .querySelectorAll("[data-next]")
      .forEach((b) => b.addEventListener("click", () => displayStep(step + 1)));
    document
      .querySelectorAll("[data-back]")
      .forEach((b) => b.addEventListener("click", () => displayStep(step - 1)));
    document
      .querySelectorAll(".steps button")
      .forEach((b) =>
        b.addEventListener("click", () => displayStep(Number(b.dataset.step))),
      );
    $("connectForm").addEventListener("submit", testConnection);
    $("connectForm").addEventListener("input", () => {
      invalidateConnection();
      stateMessage("");
    });
    $("makeBootstrap").addEventListener("click", makeBootstrap);
    $("bootstrapEmail").addEventListener("input", () => { $("bootstrapSql").value = ""; });
    $("copyBootstrap").addEventListener("click", async () => {
      if (!$("bootstrapSql").value) {
        stateMessage(T("interface.messages.generate_sql_first"), "warning");
        return;
      }
      try {
        await navigator.clipboard.writeText($("bootstrapSql").value);
        stateMessage(T("interface.messages.sql_copied"), "success");
      } catch {
        stateMessage(T("interface.messages.unable_to_copy_sql_select_it_manually"), "warning");
      }
    });
    $("setupLoginForm").addEventListener("submit", verifyAdmin);
    $("downloadConfig").addEventListener("click", () =>
      R.dl("config.js", R.configSource()),
    );
    $("copyConfig").addEventListener("click", () =>
      navigator.clipboard
        .writeText(R.configSource())
        .then(() =>
          stateMessage(T("interface.messages.configuration_copied"), "success"),
        )
        .catch(() =>
          stateMessage(
            T(
              "interface.messages.clipboard_access_denied_download_the_file_instead",
            ),
            "warning",
          ),
        ),
    );
    displayStep(1);
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("setupRetry").addEventListener("click", () => location.reload());
    window.RSVP_I18N.load()
      .then(setup)
      .catch((e) => stateMessage(R.safeError(e), "error"));
  });
})();
