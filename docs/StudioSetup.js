// Public versioned source files only. No Supabase connection or API requests.
(async function () {
  const status = document.getElementById("codeStatus");
  try {
    const site = new URL("../", window.location.href);
    for (const element of document.querySelectorAll("[data-site-origin]"))
      element.textContent = site.origin;
    for (const element of document.querySelectorAll("[data-site-url]"))
      element.textContent = site.href;
    for (const element of document.querySelectorAll("[data-origin-header]"))
      element.textContent = "Origin: " + site.origin;
    for (const element of document.querySelectorAll("[data-admin-redirect]"))
      element.textContent = new URL("admin/?admin-invitation=1", site).href;
    const release = await fetch("../version.json", { cache: "no-store" }).then(
      (response) => {
        if (!response.ok) throw Error("Release version unavailable");
        return response.json();
      },
    );
    const manifest = await fetch("../supabase/studio/manifest.json", {
      cache: "no-store",
    }).then((r) => {
      if (!r.ok) throw Error("Code manifest unavailable");
      return r.json();
    });
    if (manifest.version !== release.version)
      throw Error("Guide/code version mismatch");
    document.getElementById("studioVersion").textContent = manifest.version;
    for (const [name, field, button] of [
      ["guest-gateway", "guestCode", "copyGuest"],
      ["admin-invitations", "adminCode", "copyAdmin"],
    ]) {
      const entry = manifest.functions[name];
      const response = await fetch("../supabase/studio/" + entry.file, {
        cache: "no-store",
      });
      if (!response.ok) throw Error("Code file unavailable");
      const bytes = await response.arrayBuffer();
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== entry.sha256) throw Error("Code file checksum mismatch");
      document.getElementById(field).value = new TextDecoder().decode(bytes);
      const copy = document.getElementById(button);
      copy.disabled = false;
      const manualCopy = () => {
        document.getElementById(field).focus();
        document.getElementById(field).select();
        status.textContent = "Select and copy the complete code from the box.";
      };
      copy.onclick = () => {
        if (!navigator.clipboard?.writeText) {
          manualCopy();
          return;
        }
        navigator.clipboard
          .writeText(document.getElementById(field).value)
          .then(() => {
            status.textContent = "Complete " + name + " code copied.";
          })
          .catch(manualCopy);
      };
    }
    status.textContent =
      "Both " +
      manifest.version +
      " code files verified. Copy each complete file into its Studio index.ts.";
  } catch (error) {
    for (const id of ["copyGuest", "copyAdmin"])
      document.getElementById(id).disabled = true;
    status.textContent = "Unable to prepare code: " + error.message;
  }
})();
