// Display the installation's public release metadata without blocking sign-in.
(async function () {
  "use strict";
  const label = document.getElementById("adminVersion");
  if (!label) return;
  try {
    const response = await fetch(new URL("version.json", window.RSVP.siteRoot), {
      cache: "no-store",
    });
    if (!response.ok) return;
    const { version } = await response.json();
    if (typeof version !== "string" ||
        !/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(version)) return;
    label.textContent = "v" + version;
    label.hidden = false;
  } catch (_) {
    // A plain source checkout can omit deployment metadata.
  }
})();
