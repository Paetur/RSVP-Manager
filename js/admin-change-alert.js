// Check the revision of the administrator's loaded event data without replacing it.
(function () {
  "use strict";
  const key = "admin-event-change";
  const marker = value => typeof value === "string" && value ? value : null;

  function create({ R, T, getActor, hasOpenWork, readMarker, refresh,
    preferInline = () => false, setInline = () => {} }) {
    let baseline = null, observed = null, dismissed = null;
    let generation = 0, timer = null, pendingRead = null;

    function loaded(value) {
      generation++;
      baseline = marker(value);
      observed = dismissed = null;
      pendingRead = null;
      clearInterval(timer);
      timer = baseline ? setInterval(check, 30000) : null;
      window.RSVP_POPUPS.get(key)?.close();
      setInline(false);
    }

    const available = () => baseline && getActor() && !document.hidden && !hasOpenWork();

    function present() {
      if (!observed || observed === baseline || observed === dismissed || !available() ||
          window.RSVP_POPUPS.get(key)) return;
      if (preferInline()) {
        setInline(true);
        return;
      }
      setInline(false);
      const displayedGeneration = generation;
      const dialog = window.RSVP_POPUPS.create(key, { class: "admin-change-alert" });
      const title = R.dom("h2", { id: "adminChangeAlertTitle" }, T("interface.messages.event_data_changed"));
      const detail = R.dom("p", { id: "adminChangeAlertDetail" }, T("interface.messages.refresh_to_see_latest"));
      const actions = R.dom("div", { class: "form-actions" });
      const apply = R.dom("button", { class: "btn", type: "button" }, T("interface.messages.refresh_action"));
      const dismiss = R.dom("button", { class: "btn secondary", type: "button" }, T("interface.messages.dismiss_action"));
      const feedback = R.dom("p", { class: "form-feedback", role: "status" });
      feedback.hidden = true;
      dialog.setAttribute("aria-labelledby", title.id);
      dialog.setAttribute("aria-describedby", detail.id);
      dialog.addEventListener("close", () => {
        if (displayedGeneration === generation) dismissed = observed;
      });
      apply.addEventListener("click", async () => {
        // Recheck immediately before the same reload used by the toolbar.
        if (apply.disabled || !available() || displayedGeneration !== generation) return;
        apply.disabled = dismiss.disabled = true;
        actions.setAttribute("aria-busy", "true");
        feedback.dataset.state = "saving";
        feedback.textContent = T("interface.messages.loading_event_data");
        feedback.hidden = false;
        try {
          if (!await refresh() && dialog.open) {
            feedback.dataset.state = "error";
            feedback.textContent = T("interface.messages.event_refresh_retry");
          }
        } finally {
          actions.removeAttribute("aria-busy");
          apply.disabled = dismiss.disabled = false;
          if (dialog.open) apply.focus({ preventScroll: true });
        }
      });
      dismiss.addEventListener("click", () => dialog.close());
      actions.append(dismiss, apply);
      dialog.append(title, detail, actions, feedback);
      dialog.openInline();
      dismiss.focus({ preventScroll: true });
    }

    async function check() {
      if (!available() || pendingRead) return;
      const actor = getActor(), currentGeneration = generation;
      const request = readMarker();
      pendingRead = request;
      try {
        const { data, error } = await request;
        if (actor !== getActor() || currentGeneration !== generation) return;
        // A partial deployment or absent endpoint must not poll repeatedly.
        if (["PGRST202", "42883"].includes(error?.code)) loaded(null);
        if (error) return;
        observed = marker(data);
        if (!observed || observed === baseline) {
          window.RSVP_POPUPS.get(key)?.close();
          setInline(false);
        }
        else present();
      } finally {
        if (pendingRead === request) pendingRead = null;
      }
    }

    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return { loaded, reconcile: present };
  }

  window.RSVP_ADMIN_CHANGE_ALERT = { create };
})();
