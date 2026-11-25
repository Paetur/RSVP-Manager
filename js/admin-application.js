// Application status is a projection. Publication writes remain in admin.js.
(function () {
  "use strict";
  function sync({ R, T, settings, canEdit, busy = false }) {
    const published = !!settings?.is_published,
      badge = R.byId("publicationBadge"), summary = R.byId("publicationSummary"),
      ack = R.byId("publishAck"), publish = R.byId("publishEventButton"), unpublish = R.byId("unpublishEventButton");
    if (!badge || !summary || !ack || !publish || !unpublish) return;
    badge.textContent = T(published ? "Published" : "Unpublished");
    badge.classList.toggle("published", published);
    summary.replaceChildren();
    for (const [label, value] of [
      ["Guest access", published ? "Invited guests" : "Private preview only"],
      ["Website", "Online"],
      ["Invitation delivery", published ? "Available" : "Available after publication"],
    ]) {
      const row = R.dom("div"); row.append(R.dom("dt", {}, T(label)), R.dom("dd", {}, T(value))); summary.append(row);
    }
    ack.disabled = busy || !canEdit;
    ack.closest("label")?.classList.toggle("hidden", published);
    publish.classList.toggle("hidden", published);
    unpublish.classList.toggle("hidden", !published);
    publish.disabled = busy || published || !canEdit || !ack.checked;
    unpublish.disabled = busy || !published || !canEdit;
    // The handler reads this current projection, rather than capturing a stale store.
    ack.applicationState = { R, T, settings, canEdit, busy };
    if (!ack.dataset.applicationBound) {
      ack.dataset.applicationBound = "true";
      ack.addEventListener("change", () => sync(ack.applicationState));
    }
  }
  function render({ R, T, checks, settings, canEdit, busy = false }) {
    const pending = R.byId("launchChecklist"), completed = R.byId("completedLaunchChecks"),
      count = R.byId("launchChecklistCount"), completedLabel = R.byId("completedLaunchChecksLabel");
    if (!pending || !completed || !count || !completedLabel) return;
    pending.replaceChildren(); completed.replaceChildren();
    for (const [label, done] of checks) {
      const row = R.dom("li"), icon = R.dom("span", { class: done ? "yes" : "no" }, done ? "✓" : "○");
      icon.setAttribute("aria-hidden", "true");
      row.append(icon, R.dom("span", { class: "launch-check-label" }, label));
      if (!done) row.append(R.dom("span", { class: "application-status-badge" }, T("Pending")));
      (done ? completed : pending).append(row);
    }
    const done = checks.filter(([, value]) => value).length;
    count.textContent = done + " / " + checks.length;
    completedLabel.textContent = T(done === 1 ? "{count} completed check" : "{count} completed checks", { count: done });
    completed.closest("details")?.classList.toggle("hidden", !done);
    if (!pending.children.length) pending.append(R.dom("li", { class: "micro" }, T("All checks completed")));
    sync({ R, T, settings, canEdit, busy });
  }
  window.RSVP_ADMIN_APPLICATION = Object.freeze({ render, sync });
})();
