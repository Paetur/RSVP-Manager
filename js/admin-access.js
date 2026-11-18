(function () {
  "use strict";
  const T = (text, params) => window.RSVP_I18N.t(text, params),
    R = window.RSVP;
  const sections = [
    ["venues", "Venues & sessions"],
    ["households", "Households & guests"],
    ["food", "Food"],
    ["other", "Other"],
    ["invites", "Invites & delivery"],
    ["languages", "Languages"],
    ["settings", "Settings"],
    ["administrators", "Administrators"],
  ];
  let ctx,
    access = null,
    draft = null,
    features = {};
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const permissionPreset = (preset) => ({
    preset,
    sections: Object.fromEntries(
      sections.map(([key]) => [
        key,
        preset === "full" ? "edit" : preset === "view" ? "view" : "none",
      ]),
    ),
    sendInvites: preset === "full",
    exportBackup: preset === "full",
    restoreBackup: preset === "full",
    revokeSessions: preset === "full",
  });
  const can = (section, level = "view") =>
    features[section + "_enabled"] !== false &&
    !!access &&
    (section === "full"
      ? access.permissions.preset === "full"
      : [
            "sendInvites",
            "exportBackup",
            "restoreBackup",
            "revokeSessions",
          ].includes(section)
        ? access.permissions[section] === true
        : level === "edit"
          ? access.permissions.sections[section] === "edit"
          : ["view", "edit"].includes(access.permissions.sections[section]));
  async function rpc(name, args = {}) {
    const result = await R.adminRpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  }
  function summary(p) {
    if (p.preset === "full") return T("Full administrator");
    if (p.preset === "view") return T("View only");
    return T("Custom access · {edit} editable, {view} view only", {
      edit: Object.values(p.sections).filter((v) => v === "edit").length,
      view: Object.values(p.sections).filter((v) => v === "view").length,
    });
  }
  const canPreviewGuest = () =>
    [
      "households",
      "invites",
      "venues",
      ...(features.food_enabled === false ? [] : ["food"]),
    ].every((section) => can(section));
  const settingsAllowed = (name) =>
    name === "checklist" ||
    (name === "placeholders" && (can("settings") || can("languages") || can("invites"))) ||
    (name === "interface" && can("settings")) ||
    (name === "administrators" && can("administrators")) ||
    (name === "languages" && can("languages")) ||
    (["application", "templates"].includes(name) && can("settings")) ||
    (name === "backups" && (can("exportBackup") || can("restoreBackup"))) ||
    (name === "logs" && can("full"));
  const tabAllowed = (name) =>
    name === "settings" ||
    (name === "overview" && ["households", "invites", "food"].some((s) => can(s))) ||
    (name === "language" && can("languages")) ||
    (name === "events" && can("settings")) ||
    can(name);
  async function refresh() {
    access = await rpc("admin_get_access");
    if (!access?.permissions?.sections)
      throw Error(T("Administrator permissions are unavailable."));
    return access;
  }
  function setHidden(node, hidden) {
    if (node) node.classList.toggle("permission-hidden", hidden);
  }
  function apply() {
    if (!access) return;
    for (const tab of document.querySelectorAll("[data-tab]"))
      setHidden(tab, !tabAllowed(tab.dataset.tab));
    setHidden(R.byId("contentLanguagesToggle"), !can("languages"));
    setHidden(R.byId("guestPreviewButton"), !canPreviewGuest());
    for (const tab of document.querySelectorAll("[data-settings-tab]"))
      setHidden(tab, !settingsAllowed(tab.dataset.settingsTab));
    for (const panel of document.querySelectorAll("[data-panel]")) {
      const name = panel.dataset.panel,
        section = name === "language" ? "languages" : name === "events" ? "settings" : name;
      setHidden(panel, !tabAllowed(name));
      panel.dataset.permissionEdit = String(
        name === "settings" || can(section, "edit"),
      );
      for (const save of panel.querySelectorAll(
        "form button[type=submit],button[type=submit][form]",
      ))
        if (
          name !== "settings" &&
          !can(section, "edit") &&
          !save.closest(".invitation-send-form")
        )
          save.disabled = true;
    }
    for (const panel of document.querySelectorAll("[data-settings-panel]")) {
      const name = panel.dataset.settingsPanel,
        section = {
          checklist: "personal",
          application: "settings",
          templates: "settings",
          administrators: "administrators",
          languages: "languages",
          interface: "settings",
          backups: "restoreBackup",
          logs: "full",
        }[name];
      panel.dataset.permissionEdit = String(
        section === "personal" || can(section, "edit"),
      );
      if (name !== "checklist" && !can(section, "edit"))
        for (const control of panel.querySelectorAll(
          "form input,form textarea,form button[type=submit]",
        ))
          control.disabled = true;
    }
    setHidden(R.byId("authUsersLink"), !can("full"));
    setHidden(R.byId("exportBackup"), !can("exportBackup"));
    const restore =
      R.byId("backupFile")?.closest("form") ||
      R.byId("backupFile")?.closest("details");
    if (restore) setHidden(restore, !can("restoreBackup"));
    for (const id of [
      "backupFile",
      "previewBackup",
      "restoreBackupButton",
    ])
      setHidden(
        R.byId(id)?.closest("label") || R.byId(id),
        !can("restoreBackup"),
      );
    for (const node of document.querySelectorAll("[data-requires-section]"))
      setHidden(
        node,
        !can(
          node.dataset.requiresSection,
          node.dataset.requiresLevel || "view",
        ),
      );
    for (const node of document.querySelectorAll("[data-requires-power]"))
      setHidden(node, !can(node.dataset.requiresPower));
    setHidden(R.byId("launchChecklist")?.closest(".panel"), !can("full"));
  }
  function action(label, fn, disabled = false) {
    const button = R.dom(
      "button",
      { class: "small-tool edit-only", type: "button" },
      T(label),
    );
    button.disabled = disabled;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fn();
      } catch (error) {
        ctx.show(R.safeError(error), "error");
      } finally {
        button.disabled = disabled;
      }
    });
    return button;
  }
  async function saveState(a, state) {
    if (
      !await window.RSVP_INLINE.confirm(T(
          state === "active"
            ? "Enable administrator {name} with their saved access?"
            : "Suspend administrator {name}? Their current sessions will lose application access.",
          { name: a.name },
        ), { action: state === "active" ? "Enable access" : "Suspend access" })
    )
      return;
    await rpc("admin_set_member_state", {
      p_user_id: a.user_id,
      p_state: state,
    });
    draft = null;
    await ctx.reload();
  }
  function pencil(a) {
    return ctx.iconAction(
      "edit",
      T("Edit access") + " · " + a.name,
      () => {
        draft = {
          id: a.user_id,
          name: a.name,
          permissions: clone(a.access_permissions),
          original: clone(a.access_permissions),
        };
        redraw();
        document.querySelector("[data-access-form] input")?.focus();
      },
      false,
      "edit-only",
    );
  }
  function redraw() {
    const y = window.scrollY,
      focused = document.activeElement;
    let selector;
    if (focused?.name)
      selector =
        "[name=" +
        CSS.escape(focused.name) +
        "][value=" +
        CSS.escape(focused.value) +
        "]";
    else if (focused?.dataset.preset)
      selector = "[data-preset=" + focused.dataset.preset + "]";
    else if (focused?.dataset.power)
      selector = "[data-power=" + focused.dataset.power + "]";
    renderMembers();
    ctx.renderInvitations();
    apply();
    if (selector)
      document.querySelector(selector)?.focus({ preventScroll: true });
    window.scrollTo(0, y);
  }
  function renderMembers() {
    const host = R.byId("adminList");
    host.replaceChildren();
    const admins = ctx.getStore().admins,
      fullCount = admins.filter(
        (a) =>
          a.access_state === "active" && a.access_permissions.preset === "full",
      ).length;
    for (const a of admins) {
      const wrap = R.dom("div", { class: "admin-member" }),
        info = R.dom("div"),
        line = R.dom("div", { class: "preview-titleline" }),
        actions = R.dom("div", { class: "admin-member-actions" });
      line.append(
        R.dom("strong", {}, a.name),
        R.dom(
          "span",
          { class: "state-tag" },
          T(
            a.access_state === "active"
              ? "Active"
              : a.access_state === "restored"
                ? "Restored · Disabled"
                : "Suspended",
          ),
        ),
      );
      info.append(
        line,
        R.dom("div", { class: "email" }, a.email),
        R.dom("small", { class: "micro" }, summary(a.access_permissions)),
      );
      wrap.append(info, actions);
      if (ctx.isEditing() && can("administrators", "edit")) {
        actions.append(pencil(a));
        const full = a.access_permissions.preset === "full",
          locked =
            full &&
            (!can("full") || (a.access_state === "active" && fullCount <= 1));
        actions.append(
          action(
            a.access_state === "active" ? "Suspend access" : "Enable access",
            () =>
              saveState(
                a,
                a.access_state === "active" ? "suspended" : "active",
              ),
            locked,
          ),
        );
        if (a.access_state !== "active")
          actions.append(
            action(
              "Remove administrator",
              async () => {
                if (
                  !await window.RSVP_INLINE.confirm(T(
                      "Remove administrator {name}? Their Auth account and historical records remain.",
                      { name: a.name },
                    ), { action: "Remove administrator" })
                )
                  return;
                await rpc("admin_remove_member", { p_user_id: a.user_id });
                await ctx.reload();
              },
              full && !can("full"),
            ),
          );
      }
      host.append(wrap);
      if (draft?.id === a.user_id && ctx.isEditing()) host.append(editor(a));
    }
    if (!admins.length)
      host.append(
        R.dom("p", { class: "micro" }, T("No administrators to display.")),
      );
  }
  function editor(a) {
    const form = R.dom("form", { class: "permission-editor edit-only" });
    form.dataset.accessForm = a.user_id;
    form.append(R.dom("h3", {}, T("Access") + " · " + a.name));
    const label = R.dom("label", {}, T("Display name")),
      name = R.dom("input", { value: draft.name, max: 120 });
    name.maxLength = 120;
    name.required = true;
    label.append(name);
    form.append(label);
    const mutable = can("full");
    if (a.invitation_id) name.disabled = true;
    if (mutable) {
      const presets = R.dom("div", { class: "permission-presets" });
      presets.setAttribute("role", "group");
      presets.setAttribute("aria-label", T("Access preset"));
      for (const [key, text] of [
        ["full", "Full administrator"],
        ["view", "View only"],
        ["custom", "Custom"],
      ]) {
        const button = R.dom(
          "button",
          { type: "button", class: "small-tool" },
          T(text),
        );
        button.dataset.preset = key;
        button.setAttribute(
          "aria-pressed",
          String(draft.permissions.preset === key),
        );
        button.addEventListener("click", () => {
          draft.name = name.value;
          draft.permissions = permissionPreset(key);
          redraw();
        });
        presets.append(button);
      }
      form.append(presets);
      form.append(
        R.dom(
          "p",
          { class: "permission-help" },
          T(
            "No access hides a section. View shows summaries. Edit allows changes.",
          ),
        ),
      );
      const grid = R.dom("div", { class: "permission-grid" });
      for (const text of ["Section", "No access", "View", "Edit"])
        grid.append(R.dom("div", { class: "permission-head" }, T(text)));
      for (const [index, [key, text]] of sections.entries()) {
        if ([0, 5, 7].includes(index))
          grid.append(
            R.dom(
              "div",
              { class: "permission-group" },
              T(
                index === 0
                  ? "Main"
                  : index === 5
                    ? "Languages & settings"
                    : "Administrator management",
              ),
            ),
          );
        grid.append(R.dom("div", { class: "permission-label" }, T(text)));
        for (const value of ["none", "view", "edit"]) {
          const label = R.dom("label", { class: "permission-cell" }),
            input = R.dom("input", {
              type: "radio",
              name: "permission-" + key,
              value,
            });
          input.checked = draft.permissions.sections[key] === value;
          input.setAttribute(
            "aria-label",
            T(text) +
              " · " +
              T(
                value === "none"
                  ? "No access"
                  : value === "view"
                    ? "View"
                    : key === "administrators"
                      ? "Manage members"
                      : "Edit",
              ),
          );
          input.addEventListener("change", () => {
            draft.name = name.value;
            draft.permissions.sections[key] = value;
            draft.permissions.preset = "custom";
            if (key === "invites" && value === "none")
              draft.permissions.sendInvites = false;
            if (key === "administrators" && value === "none")
              draft.permissions.revokeSessions = false;
            redraw();
          });
          label.append(input);
          if (key === "administrators" && value === "edit") {
            label.classList.add("permission-manage-members");
            label.append(R.dom("small", {}, T("Manage members")));
          }
          grid.append(label);
        }
      }
      form.append(grid);
      form.append(
        R.dom(
          "p",
          { class: "permission-help" },
          T(
            "Only Full administrators can change access. Settings excludes administrator and backup powers.",
          ),
        ),
      );
      const extras = R.dom("div", { class: "permission-extras" });
      for (const [key, text] of [
        ["sendInvites", "Send invitations & reminders"],
        ["revokeSessions", "Revoke other administrators’ sessions"],
        ["exportBackup", "Export application backup"],
        ["restoreBackup", "Restore application backup"],
      ]) {
        const label = R.dom("label"),
          input = R.dom("input", { type: "checkbox" });
        input.dataset.power = key;
        input.checked = draft.permissions[key];
        input.disabled =
          (key === "sendInvites" &&
            draft.permissions.sections.invites === "none") ||
          (key === "revokeSessions" &&
            draft.permissions.sections.administrators === "none");
        input.addEventListener("change", () => {
          draft.name = name.value;
          draft.permissions[key] = input.checked;
          draft.permissions.preset = "custom";
          redraw();
        });
        label.append(input, R.dom("span", {}, T(text)));
        extras.append(label);
      }
      form.append(extras);
      form.append(
        R.dom(
          "p",
          { class: "permission-help" },
          T(
            "Sending is separate from editing invitations. Backup exports include data from the whole event.",
          ),
        ),
      );
    } else
      form.append(
        R.dom(
          "p",
          { class: "micro" },
          summary(a.access_permissions) +
            " · " +
            T("Only Full administrators can change access."),
        ),
      );
    const save = R.dom("button", { class: "btn", type: "submit" }, T("Save")),
      cancel = R.dom(
        "button",
        { class: "btn secondary", type: "button" },
        T("Cancel"),
      ),
      footer = R.dom("div", { class: "form-actions" });
    footer.append(save, cancel);
    form.append(footer);
    function update() {
      if (!draft || draft.id !== a.user_id) return;
      draft.name = name.value;
      save.disabled =
        form.getAttribute("aria-busy") === "true" ||
        (name.value === a.name &&
          JSON.stringify(draft.permissions) === JSON.stringify(draft.original));
    }
    name.addEventListener("input", update);
    cancel.addEventListener("click", () => {
      draft = null;
      redraw();
    });
    update();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (save.disabled || !can("administrators", "edit")) return;
      const nameValue = name.value.trim();
      if (!nameValue) return;
      if (!await window.RSVP_INLINE.confirm(T("Save access changes for {name}?", { name: a.name }) + "\n" + sections.filter(([key]) => draft.original.sections?.[key] !== draft.permissions.sections?.[key]).map(([key, label]) => T(label) + ": " + T(draft.original.sections?.[key] || "none") + " → " + T(draft.permissions.sections?.[key] || "none")).join("\n"), { action: "Save" }))
        return;
      form.setAttribute("aria-busy", "true");
      update();
      ctx.formFeedback(form, "saving");
      try {
        if (a.invitation_id)
          await rpc("admin_set_invitation_access", {
            p_id: a.invitation_id,
            p_permissions: draft.permissions,
          });
        else
          await rpc("admin_update_member", {
            p_user_id: a.user_id,
            p_name: nameValue,
            p_permissions: mutable ? draft.permissions : null,
            p_expected: a.access_permissions,
          });
        draft = null;
        await ctx.reload();
        ctx.show(T("Saved"), "success");
      } catch (error) {
        ctx.formFeedback(form, "error", R.safeError(error));
      } finally {
        form.removeAttribute("aria-busy");
        update();
      }
    });
    return form;
  }
  function sessionDevice(agent = "") {
    const browser = [
      [/Edg(?:e|A|iOS)?\//, "Edge"],
      [/OP(?:R|iOS)\//, "Opera"],
      [/SamsungBrowser\//, "Samsung Internet"],
      [/(?:Firefox|FxiOS)\//, "Firefox"],
      [/(?:Chrome|CriOS|Chromium)\//, "Chrome"],
      [/Safari\//, "Safari"],
    ].find(([pattern]) => pattern.test(agent))?.[1];
    const device = [
      [/iPad/i, "iPad"],
      [/iPhone/i, "iPhone"],
      [/iPod/i, "iPod"],
      [/Android/i, "Android"],
      [/Windows/i, "Windows"],
      [/CrOS/i, "ChromeOS"],
      [/Macintosh|Mac OS X/i, "Apple device"],
      [/Linux/i, "Linux"],
    ].find(([pattern]) => pattern.test(agent))?.[1];
    if (browser && device)
      return T("{browser} on {device}", { browser, device: T(device) });
    return browser || (device ? T(device) : T("Browser session"));
  }
  async function renderSessions() {
    const host = R.byId("adminSessions");
    if (!host) return;
    host.replaceChildren();
    try {
      const sessions = await rpc("admin_list_sessions");
      for (const s of sessions || []) {
        const row = R.dom("div", { class: "admin-member" }),
          info = R.dom("div");
        const title = R.dom("div", { class: "preview-titleline" });
        title.append(
          R.dom("strong", {}, s.name + " · " + sessionDevice(s.user_agent)),
        );
        if (s.current)
          title.append(
            R.dom("span", { class: "state-tag" }, T("This session")),
          );
        const times = [T("Signed in") + " " + ctx.adminTime(s.created_at)];
        if (s.refreshed_at)
          times.push(
            T("Session refreshed") + " " + ctx.adminTime(s.refreshed_at),
          );
        info.append(
          title,
          R.dom("small", { class: "micro" }, times.join(" · ")),
        );
        const label = T("Revoke session");
        const revoke = ctx.iconAction(
          "signOut",
          label,
          async () => {
            if (
              !await window.RSVP_INLINE.confirm(T(
                  s.current
                    ? "Revoke this session? You will return to login."
                    : "Revoke this application session?",
                ), { action: "Revoke session" })
            )
              return;
            await rpc("admin_revoke_session", { p_session_id: s.id });
            if (s.current)
              document.dispatchEvent(new Event("rsvp:admin-access-lost"));
            else await renderSessions();
          },
          false,
          "session-revoke-action",
        );
        revoke.append(document.createTextNode(label));
        row.append(info, revoke);
        host.append(row);
      }
      if (!sessions?.length)
        host.append(R.dom("p", { class: "micro" }, T("No active sessions.")));
    } catch (error) {
      host.append(R.dom("p", { class: "micro" }, R.safeError(error)));
    }
  }
  function render() {
    renderMembers();
    const own = R.byId("adminSessionsPanel"),
      target = document.querySelector(
        '[data-settings-panel="' +
          (can("administrators") ? "administrators" : "checklist") +
          '"]',
      );
    if (target && own) target.append(own);
    renderSessions();
    apply();
  }
  async function manual() {
    const form = R.byId("addAdminForm");
    if (!form.reportValidity() || !can("administrators", "edit")) return;
    const email = R.byId("newAdminEmail").value.trim(),
      name = R.byId("newAdminName").value.trim();
    try {
      const account = await rpc("admin_lookup_verified_user", {
        p_email: email,
      });
      if (!account) {
        ctx.show(
          T(
            "No eligible verified Auth account found. Send an invitation instead.",
          ),
          "warning",
        );
        return;
      }
      if (
        !await window.RSVP_INLINE.confirm(T(
            "Add {email} with View only access? No invitation email will be sent.",
            { email: account.email },
          ), { action: "Add administrator" })
      )
        return;
      await rpc("admin_add_existing_user", { p_email: email, p_name: name });
      form.reset();
      await ctx.reload();
    } catch (error) {
      ctx.show(R.safeError(error), "error");
    }
  }
  function invitationAccess(card, invitation) {
    if (!can("full")) return;
    const a = {
      user_id: "invitation:" + invitation.id,
      invitation_id: invitation.id,
      name: invitation.name,
      access_permissions:
        invitation.access_permissions || permissionPreset("view"),
    };
    if (ctx.isEditing())
      card.querySelector(".admin-invitation-actions").append(pencil(a));
    if (draft?.id === a.user_id && ctx.isEditing()) {
      const form = editor(a);
      form.classList.add("span-2");
      card.append(form);
    }
  }
  function init(context) {
    ctx = context;
    R.byId("addAdminManually").addEventListener("click", manual);
    R.byId("revokeOtherSessions").addEventListener("click", async () => {
      if (!await window.RSVP_INLINE.confirm(T("Revoke your other application sessions?"), { action: "Revoke your other application sessions?" })) return;
      try {
        await rpc("admin_revoke_other_sessions");
        await renderSessions();
      } catch (error) {
        ctx.show(R.safeError(error), "error");
      }
    });
  }
  window.RSVP_ADMIN_ACCESS = {
    init,
    refresh,
    can,
    setFeatures(value) {
      features = value || {};
    },
    settingsAllowed,
    tabAllowed,
    canPreviewGuest,
    apply,
    render,
    renderMembers,
    invitationAccess,
    permissionPreset,
    summary,
    get current() {
      return access;
    },
    clear() {
      access = null;
      draft = null;
    },
  };
})();
