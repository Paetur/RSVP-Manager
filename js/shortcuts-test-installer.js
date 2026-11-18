// Local pilot installation links and volatile operator checks, independent of batch authorization.
(function () {
  "use strict";
  const panel = document.getElementById("shortcutInstaller");
  if (!panel) return;
  const checks = Array.from(panel.querySelectorAll("[data-shortcut-installer-check]"));
  const progress = document.getElementById("shortcutInstallerProgress");
  const entries = ["Uploader", "Runner"].map(name => ({
    input: document.getElementById("shortcutInstall" + name + "Url"),
    reviewed: document.getElementById("shortcutInstall" + name + "Reviewed"),
    link: document.getElementById("shortcutInstall" + name),
    status: document.getElementById("shortcutInstall" + name + "Status")
  }));

  function shareUrl(value) {
    // Match the entire URL before navigation: no credentials, ports, redirects or runtime input.
    const match = typeof value === "string" && /^https:\/\/www\.icloud\.com\/shortcuts\/([0-9a-fA-F]{32})$/.exec(value.trim());
    return match ? "https://www.icloud.com/shortcuts/" + match[1].toLowerCase() : null;
  }
  function update(entry) {
    const url = shareUrl(entry.input.value), enabled = Boolean(url && entry.reviewed.checked);
    entry.link.setAttribute("aria-disabled", String(!enabled));
    if (enabled) {
      entry.link.href = url;
      entry.link.removeAttribute("tabindex");
    } else {
      entry.link.removeAttribute("href");
      entry.link.setAttribute("tabindex", "-1");
    }
    entry.status.textContent = !entry.input.value.trim() ? "An iCloud share link is needed." : !url ?
      "Use an iCloud Shortcut share link with a 32-character ID and no extra URL fields." : !entry.reviewed.checked ?
      "Review this shortcut and check its confirmation to enable installation." :
      "Ready to open Apple's installation screen. Review the actions before adding the shortcut.";
  }
  function updateProgress() {
    progress.textContent = checks.filter(check => check.checked).length + " of " + checks.length + " manual checks complete.";
  }
  for (const entry of entries) {
    entry.input.addEventListener("input", () => {
      // A review belongs to one supplied shortcut, not a later replacement link.
      entry.reviewed.checked = false;
      update(entry);
      updateProgress();
    });
    entry.reviewed.addEventListener("change", () => update(entry));
    entry.link.addEventListener("click", event => {
      const url = shareUrl(entry.input.value);
      if (!url || !entry.reviewed.checked) { event.preventDefault(); update(entry); return; }
      entry.link.href = url;
    });
    update(entry);
  }
  for (const check of checks) check.addEventListener("change", updateProgress);
  document.getElementById("shortcutInstallerReset").addEventListener("click", () => {
    for (const check of checks) check.checked = false;
    for (const entry of entries) { entry.input.value = ""; update(entry); }
    updateProgress();
  });
  updateProgress();
})();
