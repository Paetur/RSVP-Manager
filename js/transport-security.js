(function () {
  "use strict";

  const errorMessages = {
    unauthorized: "Sign in as an administrator to manage certificates.",
    forbidden: "Your administrator permissions do not allow this change.",
    invalid_certificate: "The certificate or private key is invalid.",
    certificate_hostname: "The certificate does not match this hostname.",
    certificate_untrusted: "The certificate chain could not be verified.",
    invalid_hostname: "Enter a valid hostname for this certificate.",
    acme_unavailable: "Cloud certificate issuance is unavailable on this installation.",
    acme_failed: "Cloud validation did not complete. Check your domain and try again.",
    transport_lockout: "Keep at least one verified connection available.",
    restart_failed: "The server could not apply the change. The previous connection settings were kept.",
    busy: "Another HTTP/SSL change is in progress. Try again shortly.",
  };

  function hostname(value) {
    return value.trim().toLowerCase().replace(/\.$/, "");
  }
  function validHost(value, mode) {
    if (value.length > 253 || /^\d+(?:\.\d+)*$/.test(value)) return false;
    const labels = value.split(".");
    if (mode === "cloud" && (labels.length < 2 || labels.at(-1) === "local" || !/[a-z]/.test(labels.at(-1))))
      return false;
    return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }
  function stateFrom(body) {
    const state = body?.state;
    const cert = state?.certificate;
    if (!state || typeof state.httpEnabled !== "boolean" ||
        typeof state.httpsEnabled !== "boolean" || typeof state.httpsReady !== "boolean" ||
        (state.httpRedirect !== undefined && typeof state.httpRedirect !== "boolean") ||
        (state.httpRedirect && !(state.httpEnabled && state.httpsEnabled)) ||
        !(cert === null || (cert && typeof cert.hostname === "string" &&
          ["local", "cloud", "upload"].includes(cert.mode))) ||
        (!state.httpEnabled && !state.httpsEnabled) || (state.httpsReady && !cert))
      throw new Error();
    return state;
  }
  function protocolSettings(httpEnabled, httpsEnabled, httpRedirect) {
    const settings = { httpEnabled, httpsEnabled };
    if (typeof httpRedirect === "boolean")
      settings.httpRedirect = httpEnabled && httpsEnabled && httpRedirect;
    return settings;
  }
  function sameProtocols(left, right) {
    return left.httpEnabled === right.httpEnabled && left.httpsEnabled === right.httpsEnabled &&
      (left.httpRedirect ?? false) === (right.httpRedirect ?? false);
  }
  function requestError(code) {
    return Object.assign(new Error(), { code });
  }
  function create(root, { T, getActor, getToken, canEdit, saved, cancelled }) {
    if (!root) return null;
    const find = selector => root.querySelector(selector);
    const wizard = root.dataset.transportSecurity === "wizard";
    const managed = window.RSVP_CONFIG?.tlsControlAvailable === true;
    const endpoint = new URL("https://" + window.location.hostname + "/tls-api/");
    const generation = find("[data-tls-generation]");
    const generate = find("[data-tls-generate]");
    const host = find("[data-tls-host]");
    const hostLabel = find("[data-tls-host-label]");
    const hostFields = find("[data-tls-host-fields]");
    const hostError = find("[data-tls-host-error]");
    const modes = [...generation.querySelectorAll("input[type=radio]")];
    const status = find("[data-tls-status]");
    const retry = find("[data-tls-retry]");
    const finish = find("[data-tls-finish]");
    const goAdmin = find("[data-tls-go-admin]");
    const openGenerate = find("[data-tls-open-generate]");
    const openUpload = find("[data-tls-open-upload]");
    const download = find("[data-tls-download]");
    const upload = find("[data-tls-upload]");
    const protocols = find("[data-tls-protocols]");
    const http = find("[data-tls-http]");
    const https = find("[data-tls-https]");
    const redirectOption = find("[data-tls-redirect-option]");
    const redirect = find("[data-tls-redirect]");
    const save = find("[data-tls-save]");
    const cancel = find("[data-tls-cancel]");
    const hint = find("[data-tls-hint]");
    const uploadsSecure = window.location.protocol === "https:";
    const uploadHint = find("[data-tls-upload-hint]");
    if (uploadHint) {
      const secureAdmin = new URL(window.location.href);
      secureAdmin.protocol = "https:";
      secureAdmin.port = "";
      secureAdmin.hash = "settings";
      find("[data-tls-https-link]").href = secureAdmin.href;
    }
    const hostDrafts = new Map();
    let state = null, actor = null, epoch = 0, busy = false, requested = false;
    let mode = managed ? modes.find(input => input.checked).value : (wizard ? "none" : "local");
    modes.find(input => input.value === mode).checked = true;

    function feedback(text = "", params) {
      status.textContent = text ? T(text, params) : "";
      status.hidden = !text;
    }
    function prefill() {
      const detected = mode === "cloud" ? state?.detectedDomain : state?.detectedHostname;
      const value = typeof detected === "string" ? hostname(detected) : "";
      if (validHost(value, mode)) return value;
      const current = hostname(window.location.hostname);
      return validHost(current, mode) ? current : "";
    }
    function showMode() {
      hostLabel.textContent = T(mode === "cloud" ? "Fully qualified domain name" : "Hostname");
      hostFields.classList.toggle("hidden", mode === "none");
      host.value = mode === "none" ? "" : hostDrafts.get(mode) ?? prefill();
      if (goAdmin) goAdmin.hidden = true;
      render();
    }
    function syncProtocolDraft() {
      if (protocols) {
        http.checked = state?.httpEnabled ?? true;
        https.checked = state?.httpsEnabled ?? false;
        if (redirect) redirect.checked = state?.httpRedirect ?? false;
      }
    }
    function protocolDraft() {
      const httpRedirect = typeof state?.httpRedirect === "boolean"
        ? redirect?.checked ?? state.httpRedirect
        : undefined;
      return protocolSettings(http.checked, https.checked, httpRedirect);
    }
    function render() {
      const editable = managed && Boolean(actor) && canEdit();
      const certificate = state?.certificate;
      const ready = Boolean(state?.httpsReady);
      const pending = ready && certificate.active === false;
      const usable = editable && Boolean(state) && !busy;
      const entered = hostname(host.value), valid = validHost(entered, mode);
      generate.disabled = !usable || mode === "none" || !valid;
      hostError.hidden = mode === "none" || !hostDrafts.has(mode) || !entered || valid;
      hostError.textContent = hostError.hidden ? "" : T(mode === "cloud"
        ? "Enter a fully qualified domain name."
        : "Enter a valid hostname for this certificate.");
      host.disabled = busy;
      for (const input of modes) input.disabled = busy;
      if (retry) retry.hidden = !managed || !actor || Boolean(state) || busy;
      if (wizard) {
        finish.disabled = busy || (mode !== "none" &&
          !(ready && certificate?.mode === mode && certificate.hostname === hostname(host.value)));
        return;
      }
      if (!editable) {
        generation.hidden = true;
        upload.hidden = true;
        upload.reset();
      }
      openGenerate.disabled = !usable;
      openUpload.disabled = !usable || !uploadsSecure;
      uploadHint.hidden = !editable || uploadsSecure;
      download.disabled = !actor || !certificate || busy;
      for (const input of upload.elements) input.disabled = !usable || !uploadsSecure;
      openGenerate.setAttribute("aria-expanded", String(!generation.hidden));
      openUpload.setAttribute("aria-expanded", String(!upload.hidden));
      find("[data-tls-summary-host]").textContent = certificate?.hostname || state?.detectedHostname || T("Unknown");
      find("[data-tls-summary-certificate]").textContent = T(!state ? "Unknown" : !certificate ? "Not installed" :
        !ready ? "Certificate needs verification" : pending ? "Certificate ready to apply" :
        ({ cloud: "Ready · Cloud", local: "Ready · Local CA", upload: "Ready · Uploaded" })[certificate.mode]);
      find("[data-tls-summary-connection]").textContent = T(!state ? "Unknown" :
        state.httpRedirect ? "HTTP redirects to HTTPS" :
        state.httpsEnabled ? (state.httpEnabled ? "HTTP and HTTPS/SSL" : "HTTPS/SSL") : "HTTP");
      if (redirectOption) {
        redirectOption.hidden = !(typeof state?.httpRedirect === "boolean" && http.checked && https.checked);
        redirect.disabled = !usable || redirectOption.hidden || (!ready && !redirect.checked);
      }
      http.disabled = !usable || (!state?.httpsEnabled && http.checked) || (!https.checked && http.checked);
      https.disabled = !usable || (!ready && !https.checked) || (!http.checked && https.checked);
      save.disabled = !usable || (!http.checked && !https.checked) ||
        (sameProtocols(protocolDraft(), state) && !(pending && https.checked));
      cancel.disabled = busy;
      protocols.setAttribute("aria-busy", String(busy));
      protocols.dataset.editorAvailable = String(managed && Boolean(actor) && Boolean(state));
      if (protocols.localEditor && canEdit()) protocols.localEditor.button.disabled = !usable;
      hint.textContent = T(!ready ? "A matching certificate enables HTTPS/SSL." :
        !state.httpsEnabled ? "Enable and verify HTTPS/SSL before disabling HTTP." :
        pending ? "Save with HTTPS/SSL enabled to apply the new certificate." : "HTTPS/SSL is verified.");
    }

    async function request(action, payload, stillCurrent = () => true) {
      const headers = {};
      if (payload !== undefined || action === "certificate") {
        const token = await getToken();
        if (!stillCurrent() || typeof token !== "string" || !token) throw requestError("unauthorized");
        headers.Authorization = "Bearer " + token;
      }
      if (payload !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(new URL(action, endpoint), {
        method: payload === undefined ? "GET" : "POST",
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(action === "generate" && payload?.mode === "cloud" ? 245000 : 15000),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw requestError(detail?.code);
      }
      return action === "certificate" ? response.blob() : stateFrom(await response.json());
    }
    async function operate(work, completed, waiting) {
      if (busy || !actor) return;
      const revision = epoch, owner = actor;
      busy = true;
      feedback(waiting);
      render();
      const sameActor = () => revision === epoch && getActor() === owner;
      try {
        const result = await work(sameActor);
        if (sameActor()) completed(result);
      } catch (error) {
        if (sameActor())
          feedback(errorMessages[error.code] || "Could not reach the HTTP/SSL service. Retry over HTTPS.");
      } finally {
        if (revision === epoch) {
          busy = false;
          render();
        }
      }
    }
    function accept(next) {
      state = next;
      syncProtocolDraft();
      if (!hostDrafts.has(mode) && mode !== "none") host.value = prefill();
    }
    function read() {
      requested = true;
      void operate(() => request("state"), next => { accept(next); feedback(); }, "Checking HTTP/SSL…");
    }
    function clear() {
      epoch++;
      actor = null;
      state = null;
      busy = false;
      requested = false;
      hostDrafts.clear();
      if (!wizard) {
        generation.hidden = true;
        upload.hidden = true;
        upload.reset();
        syncProtocolDraft();
      }
      showMode();
      feedback();
    }
    function refresh() {
      const nextActor = getActor();
      if (nextActor !== actor) {
        clear();
        actor = nextActor;
      }
      if (managed && actor && !requested) read();
      else if (!managed) feedback("This installation does not expose HTTP/SSL controls. Manage certificates with your host.");
      render();
    }

    for (const input of modes) input.addEventListener("change", () => {
      mode = input.value;
      showMode();
    });
    host.addEventListener("input", () => {
      hostDrafts.set(mode, host.value);
      if (goAdmin) goAdmin.hidden = true;
      render();
    });
    generation.addEventListener("submit", event => {
      event.preventDefault();
      if (generate.disabled) return;
      const selected = mode, selectedHost = hostname(host.value);
      void operate(current => request("generate", { mode: selected, hostname: selectedHost }, current), next => {
        if (next.certificate?.mode !== selected || next.certificate.hostname !== selectedHost)
          throw new Error();
        accept(next);
        feedback(next.certificate.mode === "local"
          ? "Certificate generated. Devices must trust the local CA."
          : "Certificate generated.");
      }, selected === "cloud" ? "Requesting a cloud certificate…" : "Generating a local certificate…");
    });
    retry?.addEventListener("click", read);

    if (wizard) {
      function finishSetup() {
        feedback("Setup complete.");
        goAdmin.hidden = false;
        goAdmin.focus();
      }
      finish.addEventListener("click", () => {
        if (finish.disabled) return;
        if (mode === "none" || (state.httpsEnabled && state.certificate.active))
          return finishSetup();
        const options = protocolSettings(state.httpEnabled, true, state.httpRedirect);
        void operate(current => request("apply", options, current), next => {
          if (!sameProtocols(next, options) || next.certificate?.active !== true)
            throw new Error();
          accept(next);
          finishSetup();
        }, "Verifying the connection settings…");
      });
    } else {
      // Keep the connection/certificate summary visible alongside the action buttons.
      protocols.renderReadSummary = () => {};
      openGenerate.addEventListener("click", () => {
        generation.hidden = !generation.hidden;
        upload.hidden = true;
        upload.reset();
        render();
        if (!generation.hidden) host.focus();
      });
      openUpload.addEventListener("click", () => {
        if (!uploadsSecure) return;
        upload.hidden = !upload.hidden;
        generation.hidden = true;
        render();
        if (!upload.hidden) upload.elements.certificate.focus();
        else upload.reset();
      });
      upload.addEventListener("submit", event => {
        event.preventDefault();
        if (!uploadsSecure || !canEdit() || busy) return;
        const certificateFile = upload.elements.certificate.files[0];
        const key = upload.elements.privateKey.files[0];
        if (!certificateFile || !key || certificateFile.size > 65536 || key.size > 65536) {
          upload.reset();
          feedback("Choose a PEM certificate chain and private key, each no larger than 64 KiB.");
          return;
        }
        upload.reset();
        void operate(async current => request("upload", { certificate: await certificateFile.text(), privateKey: await key.text() }, current), next => {
          if (next.certificate?.mode !== "upload") throw new Error();
          accept(next);
          upload.hidden = true;
          feedback("Certificate uploaded.");
        }, "Checking uploaded certificate…");
      });
      download.addEventListener("click", () => {
        if (download.disabled) return;
        void operate(current => request("certificate", undefined, current), blob => {
          const href = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = href;
          link.download = "rsvp-certificate.pem";
          link.click();
          setTimeout(() => URL.revokeObjectURL(href), 1000);
          feedback();
        }, "Downloading public certificate…");
      });
      http.addEventListener("change", render);
      https.addEventListener("change", render);
      redirect?.addEventListener("change", render);
      cancel.addEventListener("click", () => {
        if (busy) return;
        syncProtocolDraft();
        feedback();
        cancelled(protocols);
        render();
      });
      protocols.addEventListener("submit", event => {
        event.preventDefault();
        if (save.disabled) return;
        const options = protocolDraft();
        void operate(current => request("apply", options, current), next => {
          if (!sameProtocols(next, options) ||
              (options.httpsEnabled && state.certificate?.active === false && next.certificate?.active !== true))
            throw new Error();
          accept(next);
          feedback();
          saved(protocols);
          if (next.httpRedirect && window.location.protocol === "http:") {
            const securePage = new URL(window.location.href);
            securePage.protocol = "https:";
            securePage.port = "";
            window.location.replace(securePage.href);
          }
        }, "Verifying the connection settings…");
      });
    }
    showMode();
    return { refresh, clear };
  }
  window.RSVP_TRANSPORT_SECURITY = Object.freeze({ create });
})();
