(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    T = (text) => window.RSVP_I18N?.t(text) || text;
  const names = [
    "database",
    "administrator",
    "secrets",
    "functions",
    "configuration",
    "verification",
  ];
  let csrf = "",
    state = null,
    selected = 0,
    busy = false;
  const status = (text, error = false) => {
    $("automaticStatus").textContent = text;
    $("automaticStatus").classList.toggle("hidden", !text);
    $("automaticStatus").classList.toggle("error", error);
  };
  async function api(action, input = {}) {
    const response = await fetch("setup-api/" + action, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Setup-CSRF": csrf },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok)
      throw Error(
        (result.error && T(result.error)) ||
          T(
            "Setup could not complete this step. Retry after checking the project connection and permissions.",
          ),
      );
    return result;
  }
  const activeNames = () => state?.local ? ["database", "administrator", "verification"] : names;
  function render() {
    const complete = !!state?.initialized;
    const local = !!state?.local || document.querySelector('input[name="target"]:checked')?.value === "local";
    $("automaticWizard").classList.toggle("automatic-local", local);
    document.querySelector('[data-run="database"]').textContent = T(local ? "Verify database" : "Initialize database");
    document.querySelector('[data-auto-panel="1"] h2').textContent = T(local ? "Verify database" : "Initialize database");
    document.querySelector('[data-auto-panel="1"] p').textContent = T(local
      ? "Local mode creates the first administrator on an installed empty schema. Complete the local database, Auth and Edge Function installation first."
      : "Install the current schema, or add missing objects in a compatible partial installation. Existing rows are kept. Incompatible schemas and initialized applications are not overwritten.");
    document.querySelectorAll("[data-auto-step]").forEach(button => {
      const index = Number(button.dataset.autoStep);
      button.classList.toggle("hidden", local && index > 2 && index < 6);
    });
    document
      .querySelectorAll("[data-auto-panel]")
      .forEach((node) =>
        node.classList.toggle(
          "hidden",
          complete || Number(node.dataset.autoPanel) !== selected,
        ),
      );
    document.querySelectorAll("[data-auto-step]").forEach((button) => {
      const index = Number(button.dataset.autoStep),
        allowed =
          index === 0 ||
          (!!state &&
            names.slice(0, index - 1).filter(name => activeNames().includes(name)).every((name) => state.steps[name]));
      button.disabled = busy || complete || !allowed || (index === 2 && !!state?.steps.administrator);
      button.classList.toggle("active", index === selected);
      button.setAttribute(
        "aria-current",
        index === selected ? "step" : "false",
      );
      button.classList.toggle(
        "setup-step-complete",
        index === 0 ? !!state : !!state?.steps[names[index - 1]],
      );
    });
    document
      .querySelectorAll(
        "[data-auto-panel] button, #automaticAddSecret, #automaticDisconnect",
      )
      .forEach((button) => (button.disabled = busy || complete || (button.closest("#automaticAdministrator") !== null && !!state?.steps.administrator)));
    $("automaticAdministrator").querySelector('button[type="submit"]').disabled ||= !administratorValid();
    $("automaticComplete").classList.toggle("hidden", !complete);
    if (complete && state.publicConfig) {
      $("automaticCompletionNote").textContent = T(
        state.existingInstallation
          ? "Existing installation detected. No project settings were changed."
          : "The application is initialized. The event remains unpublished.",
      );
      const bridge = new URL("setup.html", state.siteUrl);
      bridge.hash =
        "connection=" + encodeURIComponent(JSON.stringify(state.publicConfig));
      $("automaticLogin").href = bridge.href;
    }
  }
  const nextStep = () => {
    if (state?.initialized) return 6;
    const missing = activeNames().find(name => !state?.steps[name]);
    return missing ? names.indexOf(missing) + 1 : 6;
  };
  function administratorValid() {
    const form = $("automaticAdministrator"), password = form.elements.password, confirm = form.elements.confirmPassword;
    const mismatch = confirm.value.length > 0 && confirm.value !== password.value;
    confirm.setCustomValidity(mismatch ? T("The passwords do not match.") : "");
    $("automaticAdministratorValidation").textContent = mismatch ? T("The passwords do not match.") : "";
    $("automaticAdministratorValidation").hidden = !mismatch;
    return form.elements.email.validity.valid && password.validity.valid && confirm.validity.valid;
  }
  function targetChoice() {
    const local = document.querySelector('input[name="target"]:checked')?.value === "local";
    document.querySelectorAll("[data-cloud-field]").forEach(input => {
      input.disabled = local; input.closest("label").classList.toggle("hidden", local);
    });
    const database = $("automaticConnect").elements.databaseUrl;
    database.disabled = !local; database.required = local;
    $("automaticDatabaseConnectionLabel").classList.toggle("hidden", !local);
    $("automaticLocalHelp").classList.toggle("hidden", !local);
    $("automaticConnect").elements.projectUrl.placeholder = local ? "http://127.0.0.1:54321" : "https://your-project.supabase.co";
    render();
  }
  async function operate(action, input = {}, sourceForm = null) {
    if (busy) return;
    if (action === "connect") state = null;
    busy = true;
    render();
    status(T("Working…"));
    try {
      state = await api(action, input);
      selected = nextStep();
      status(T(state.initialized ? "Setup complete" : "Step completed."));
    } catch (error) {
      status(
        error instanceof Error
          ? error.message
          : T(
              "Setup could not complete this step. Retry after checking the project connection and permissions.",
            ),
        true,
      );
    } finally {
      // Values are intentionally not retained for retry; project progress is retained server-side.
      $("automaticShowPassword").checked = false;
      $("automaticAdministrator").querySelectorAll("[data-sensitive]").forEach(input => input.type = "password");
      sourceForm
        ?.querySelectorAll('input[type="password"], [data-sensitive]')
        .forEach((input) => (input.value = ""));
      if (action === "secrets")
        $("automaticOptionalSecrets")
          .querySelectorAll('input[type="password"]')
          .forEach((input) => (input.value = ""));
      input = null;
      busy = false;
      render();
    }
  }
  function optionalSecrets() {
    return [
      ...$("automaticOptionalSecrets").querySelectorAll(
        ".automatic-secret-row",
      ),
    ]
      .map((row) => ({
        name: row.querySelector('[name="secretName"]').value.trim(),
        value: row.querySelector('[name="secretValue"]').value,
      }))
      .filter((entry) => entry.name || entry.value);
  }
  function addSecret() {
    if ($("automaticOptionalSecrets").childElementCount >= 10) return;
    const row = document.createElement("div");
    row.className = "automatic-secret-row";
    for (const [name, text, type] of [
      ["secretName", "Secret name", "text"],
      ["secretValue", "Secret value", "password"],
    ]) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      label.append(document.createTextNode(T(text)));
      input.name = name;
      input.type = type;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = type === "password" ? 8192 : 75;
      label.append(input);
      row.append(label);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn secondary";
    remove.textContent = T("Remove");
    remove.addEventListener("click", () => row.remove());
    row.append(remove);
    $("automaticOptionalSecrets").append(row);
  }
  async function init() {
    await window.RSVP_I18N.load();
    $("automaticLanguage").value = window.RSVP_I18N.language;
    $("automaticLanguage").addEventListener("change", (event) =>
      window.RSVP_I18N.setLanguage(event.target.value),
    );
    // Privileged credential entry is available only on the loopback companion, never Pages.
    if (location.protocol !== "http:" || location.hostname !== "127.0.0.1")
      return;
    try {
      const response = await fetch("setup-api/session", {
          cache: "no-store",
          credentials: "same-origin",
        }),
        session = await response.json();
      if (
        !response.ok ||
        session.companion !== true ||
        !/^[a-f0-9]{64}$/.test(session.csrf)
      )
        return;
      csrf = session.csrf;
      state = session.state;
      selected = state ? nextStep() : 0;
      $("companionUnavailable").classList.add("hidden");
      $("automaticWizard").classList.remove("hidden");
    } catch {
      return;
    }
    document.querySelectorAll("[data-auto-step]").forEach((button) =>
      button.addEventListener("click", () => {
        selected = Number(button.dataset.autoStep);
        status("");
        render();
      }),
    );
    document.querySelectorAll('input[name="target"]').forEach(input => input.addEventListener("change", targetChoice));
    $("automaticAdministrator").addEventListener("input", render);
    $("automaticShowPassword").addEventListener("change", event => {
      $("automaticAdministrator").querySelectorAll("[data-sensitive]").forEach(input => input.type = event.target.checked ? "text" : "password");
    });
    $("automaticConnect").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const input = Object.fromEntries(new FormData(form));
      if (input.target === "cloud") delete input.target;
      operate("connect", input, form);
    });
    $("automaticAdministrator").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      if (!administratorValid()) return;
      operate("administrator", {email:form.elements.email.value,password:form.elements.password.value}, form);
    });
    document
      .querySelectorAll("[data-run]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          operate(
            button.dataset.run,
            button.dataset.run === "secrets"
              ? { optional: optionalSecrets() }
              : {},
          ),
        ),
      );
    $("automaticAddSecret").addEventListener("click", addSecret);
    $("automaticDisconnect").addEventListener("click", async () => {
      if (busy) return;
      await api("disconnect").catch(() => {});
      $("automaticConnect").reset();
      $("automaticAdministrator").reset();
      $("automaticOptionalSecrets").replaceChildren();
      state = null;
      csrf = "";
      location.reload();
    });
    $("automaticDownload").addEventListener("click", () => {
      if (!state?.publicConfig) return;
      const text =
          "window.RSVP_CONFIG = Object.freeze(" +
          JSON.stringify(state.publicConfig, null, 2) +
          ");\n",
        url = URL.createObjectURL(
          new Blob([text], { type: "text/javascript" }),
        ),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "config.js";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    targetChoice();
  }
  document.addEventListener("DOMContentLoaded", () =>
    init().catch(() =>
      status(
        T(
          "Setup could not complete this step. Retry after checking the project connection and permissions.",
        ),
        true,
      ),
    ),
  );
})();
