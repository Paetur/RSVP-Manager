// Standalone application-data wipe. Tokens/backup payloads remain in memory;
// existing backup encoding and the destructive writes are controller-owned.
(function () {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const expiry = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const count = (counts, name) => Math.max(0, Number(counts?.["public." + name] ?? counts?.[name]) || 0);
  function create({ R, T, getStore, can, rpc, reload, signOut, getActor = () => null,
    confirm, downloadSafetyBackup, adminTime = value => new Date(value).toLocaleString(), onMessage }) {
    let actor = getActor(), generation = 0, keep = true, busy = false;
    let preview = null, receipt = null, message = "", messageKind = "", cleared = false;
    const host = () => R.byId("databaseWipeHost");
    const allowed = () => Boolean(getActor() && can("full"));
    const gate = () => allowed() && getStore().settings?.is_published === false && !cleared;
    function invalidate() { preview = null; receipt = null; }
    function clear() {
      generation++; actor = getActor(); keep = true; busy = false; cleared = false;
      invalidate(); message = ""; messageKind = "";
    }
    function current(ticket, owner) { return ticket === generation && owner === getActor() && gate(); }
    function status(value, kind = "") { message = value; messageKind = kind; }
    function sync() {
      if (actor !== getActor() || (!allowed() && (preview || receipt || busy))) clear();
      if (!gate() && !cleared && (preview || receipt)) { generation++; busy = false; invalidate(); }
      if (receipt && expiry(receipt.expiresAt) <= Date.now()) {
        receipt = null;
        status(T("Wipe preparation expired. Review the current data and prepare again."), "error");
      }
    }
    function button(text, id, action, disabled = false, danger = false) {
      const node = R.dom("button", { id, type: "button", class: "btn secondary" + (danger ? " danger" : ""), disabled }, T(text));
      node.addEventListener("click", action);
      return node;
    }
    async function operation(work, errorMessage) {
      if (busy) return;
      const ticket = generation, owner = getActor();
      busy = true; render();
      try { await work(ticket, owner); }
      catch (_) {
        if (ticket === generation && owner === getActor()) {
          invalidate(); status(T(errorMessage), "error");
        }
      } finally {
        if (ticket === generation) {
          if (owner !== getActor()) clear();
          else busy = false;
          render();
        }
      }
    }
    async function review() {
      if (!gate() || busy) return;
      invalidate(); status("");
      const retention = keep;
      await operation(async (ticket, owner) => {
        const result = await rpc("admin_preview_wipe_all", { p_keep_current_admin: retention });
        if (!current(ticket, owner) || retention !== keep) return;
        if (result?.can_wipe !== true || result.keep_current_admin !== retention ||
            typeof result.destination_state !== "string" || !result.destination_state ||
            !result.current_counts || typeof result.current_counts !== "object") throw Error("Invalid wipe review");
        preview = result;
      }, "The wipe review could not be prepared. Refresh and try again.");
    }
    async function prepare() {
      if (!gate() || busy || !preview) return;
      const checked = preview, retention = keep;
      receipt = null; status("");
      await operation(async (ticket, owner) => {
        const result = await rpc("admin_prepare_wipe_all", {
          p_keep_current_admin: retention, p_expected_state: checked.destination_state,
        });
        const stillCurrent = () => current(ticket, owner) && retention === keep && preview === checked;
        if (!stillCurrent()) return;
        if (!UUID.test(result?.token || "") || result.keep_current_admin !== retention ||
            result.destination_state !== checked.destination_state || expiry(result.expires_at) <= Date.now() ||
            !result.safety_backup || typeof downloadSafetyBackup !== "function") throw Error("Invalid wipe preparation");
        const downloaded = await downloadSafetyBackup(result.safety_backup, stillCurrent);
        if (!stillCurrent()) return;
        if (downloaded === false) throw Error("Safety backup was not downloaded");
        if (expiry(result.expires_at) <= Date.now()) throw Error("Expired wipe preparation");
        receipt = { token: result.token, expiresAt: result.expires_at, keep: retention };
        status(T("Safety backup downloaded. Store it privately before wiping application data."), "saved");
      }, "The safety backup could not be downloaded. Review the current data and prepare again.");
    }
    function ready() {
      return gate() && !busy && receipt && receipt.keep === keep && expiry(receipt.expiresAt) > Date.now();
    }
    async function wipe() {
      if (!ready()) return;
      const prepared = receipt, retention = keep;
      await operation(async (ticket, owner) => {
        const trigger = R.byId("databaseWipeAll");
        if (!trigger || !await confirm(trigger)) return;
        if (!current(ticket, owner) || receipt !== prepared || retention !== keep || expiry(prepared.expiresAt) <= Date.now()) return;
        const result = await rpc("admin_wipe_all", {
          p_keep_current_admin: retention, p_confirmation: "WIPE", p_safety_token: prepared.token,
        });
        if (ticket !== generation || owner !== getActor()) return;
        if (result?.application_data_cleared !== true || result.current_admin_retained !== retention || result.sign_out_required !== !retention)
          throw Error("Uncertain wipe result");
        cleared = true; invalidate();
        status(T("Application data cleared. The event is unpublished."), "saved");
        onMessage?.(message, "success");
        if (retention) {
          try {
            if (!await reload()) status(T("Application data cleared. Refresh the page before continuing."), "saved");
          } catch (_) { status(T("Application data cleared. Refresh the page before continuing."), "saved"); }
        } else {
          try {
            if (await signOut() === false) status(T("Application data cleared. Sign out to finish."), "saved");
          } catch (_) { status(T("Application data cleared. Sign out to finish."), "saved"); }
        }
      }, "The wipe could not be confirmed. Review the current data and prepare again before retrying.");
      if (ready()) R.byId("databaseWipeAll")?.focus({ preventScroll: true });
    }
    function render() {
      const box = host();
      if (!box) return;
      sync(); box.hidden = !allowed();
      box.replaceChildren();
      if (box.hidden) return;
      box.setAttribute("aria-busy", String(busy));
      box.append(R.dom("h2", {}, T("Wipe all")),
        R.dom("p", {}, T("Permanently clears application data, private pictures, invitation links, replies, food commitments, delivery history and application administrator access.")),
        R.dom("p", { class: "micro" }, T("Supabase Auth accounts and passwords, database schema and connection settings are retained.")));
      const statusNode = R.dom("p", { id: "databaseWipeStatus", class: "form-feedback micro" }, message);
      statusNode.setAttribute("role", "status");
      statusNode.setAttribute("aria-live", "polite");
      statusNode.dataset.state = messageKind;
      if (cleared) { box.append(statusNode); return; }
      if (getStore().settings?.is_published !== false)
        box.append(R.dom("p", { class: "notice" }, T("Unpublish the event before preparing a wipe.")));
      const label = R.dom("label", { class: "checkbox-label" }), retain = R.dom("input", {
        id: "databaseKeepAdmin", type: "checkbox", disabled: busy || !gate(),
      });
      retain.checked = keep;
      retain.addEventListener("change", () => {
        if (busy || !gate()) return;
        keep = retain.checked; generation++; invalidate(); status(""); render();
        R.byId("databaseKeepAdmin")?.focus();
      });
      label.append(retain, document.createTextNode(T("Retain current administrator")));
      box.append(label,
        R.dom("p", { class: "micro" }, T(keep ? "Keeps only your current administrator access to this application." :
          "If unchecked, application administrator access is removed and you will be signed out. First-administrator setup will be required.")),
        button("Review wipe", "databasePreviewWipe", review, busy || !gate()));
      if (preview) {
        const reviewBox = R.dom("section", { id: "databaseWipePreview" });
        reviewBox.append(R.dom("h3", {}, preview.event_name || T("Current event")),
          R.dom("p", { class: "micro" }, T("Review the current data and download the safety backup before continuing.")));
        const counts = preview.current_counts, rows = R.dom("dl", { class: "record-read-grid" });
        for (const [caption, value] of [
          ["Households", count(counts, "households")], ["Guests", count(counts, "guests")],
          ["Delivery drafts and records", count(counts, "invitation_send_queue") + count(counts, "invitation_deliveries")],
          ["RSVP submissions", count(counts, "rsvp_submissions")], ["Food commitments", count(counts, "food_claims")],
          ["Administrators", count(counts, "admins")],
        ]) rows.append(R.dom("dt", {}, T(caption)), R.dom("dd", {}, String(value)));
        reviewBox.append(rows, button("Download safety backup", "databasePrepareWipe", prepare, busy || !gate()));
        box.append(reviewBox);
      }
      if (receipt) {
        box.append(R.dom("p", { class: "micro" }, T("Wipe preparation expires: {time}", { time: adminTime(receipt.expiresAt) })),
          button("Wipe all", "databaseWipeAll", wipe, !ready(), true));
      }
      box.append(statusNode);
    }
    return { render, clear };
  }
  window.RSVP_ADMIN_DATABASE = Object.freeze({ create });
})();
