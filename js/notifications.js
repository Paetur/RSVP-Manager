// Filter temporary notices only; audit logs, form errors and receipts are separate.
(function () {
  "use strict";
  const types = ["info", "success", "warning", "error"];
  const policies = { admin: null, guest: null };
  function normalize(policy) {
    return {
      preset: ["all", "errors", "custom"].includes(policy?.preset)
        ? policy.preset
        : "all",
      ...(typeof policy?.autoDismiss === "boolean"
        ? { autoDismiss: policy.autoDismiss }
        : {}),
      ...(typeof policy?.showTimestamp === "boolean"
        ? { showTimestamp: policy.showTimestamp }
        : {}),
      types: Array.isArray(policy?.types)
        ? types.filter((type) => policy.types.includes(type))
        : [...types],
    };
  }
  function allows(scope, type = "info") {
    const policy = normalize(policies[scope]);
    const kind = types.includes(type) ? type : "info";
    return (
      policy.preset === "all" ||
      (policy.preset === "errors"
        ? kind === "error"
        : policy.types.includes(kind))
    );
  }
  function showTimestamp(scope) {
    return scope === "admin"
      ? policies.admin?.showTimestamp !== false
      : scope === "guest" && policies.guest?.showTimestamp === true;
  }
  function decorate(node, scope, date) {
    const old = node.querySelector(":scope > time.status-time");
    if (old) {
      const separator = old.nextSibling;
      if (
        separator?.nodeType === Node.TEXT_NODE &&
        separator.textContent === " · "
      )
        separator.remove();
      old.remove();
    }
    if (date) node.dataset.notificationAt = date.toISOString();
    if (
      !showTimestamp(scope) ||
      node.classList.contains("hidden") ||
      !node.textContent
    )
      return;
    const stored = Date.parse(node.dataset.notificationAt),
      now = date || (Number.isFinite(stored) ? new Date(stored) : new Date());
    node.dataset.notificationAt = now.toISOString();
    const time = document.createElement("time");
    time.className = "status-time";
    time.dateTime = now.toISOString();
    time.title = time.dateTime;
    time.textContent = new Intl.DateTimeFormat(
      window.RSVP_I18N?.locale() || "en-GB",
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        ...window.RSVP?.timeOptions(),
      },
    ).format(now);
    node.prepend(time, document.createTextNode(" · "));
  }
  function configure(scope, policy) {
    if (!Object.hasOwn(policies, scope)) return;
    policies[scope] = normalize(policy);
    const node = document.getElementById(
      scope === "admin" ? "adminMessage" : "guestStatus",
    );
    if (node && !allows(scope, node.dataset.notificationType)) {
      node.textContent = "";
      node.classList.add("hidden");
      delete node.dataset.notificationAt;
    } else if (node) decorate(node, scope);
  }
  window.RSVP_NOTIFICATIONS = {
    types,
    normalize,
    allows,
    configure,
    showTimestamp,
    decorate,
    autoDismissGuest: () => policies.guest?.autoDismiss === true,
    autoDismissAdmin: () => policies.admin?.autoDismiss !== false,
  };
})();
