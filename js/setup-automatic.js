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
        result.error ||
          T(
            "Setup could not complete this step. Retry after checking the project connection and permissions.",
          ),
      );
    return result;
  }
  function render() {
    const complete = !!state?.initialized;
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
            names.slice(0, index - 1).every((name) => state.steps[name]));
      button.disabled = busy || complete || !allowed;
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
      .forEach((button) => (button.disabled = busy));
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
  const nextStep = () =>
    state?.initialized
      ? 6
      : Math.max(0, names.findIndex((name) => !state?.steps[name]) + 1);
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
      sourceForm
        ?.querySelectorAll('input[type="password"]')
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
    $("automaticConnect").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const input = Object.fromEntries(new FormData(form));
      operate("connect", input, form);
    });
    $("automaticAdministrator").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      operate("administrator", Object.fromEntries(new FormData(form)), form);
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
    render();
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
