(function () {
  "use strict";
  const T = (text, params) => window.RSVP_I18N?.t(text, params) || text;
  const R = window.RSVP,
    $ = R.byId,
    A = window.RSVP_ADMIN_ACCESS;
  const can = (section, level = "view") => A.can(section, level);
  let authRecovery = null;
  let eventDataActor = null,
    eventLoadVersion = 0,
    eventLoading = false,
    manualSendsDuringLoad = null,
    manualSendInvitesOpen = false,
    guestOverview = null,
    pendingManagementCalls = 0,
    signingOut = false;
  let db = null,
    user = null,
    store = {
      settings: null,
      invitationTemplates: [],
      sessionInvitationLocks: [],
      guestFoodReplies: [],
      sessions: [],
      locations: [],
      households: [],
      guests: [],
      food: [],
      claims: [],
      submissions: [],
      defaults: [],
      content: [],
      admins: [],
      adminInvitations: [],
      relationGroups: [],
      foodCategories: [],
      foodGroups: [],
      foodTypes: [],
      languages: [],
      contacts: [],
      overrides: [],
      responses: [],
      queue: [],
      deliveries: [],
      shortcutBatches: [],
      shortcutItems: [],
      shortcutAttempts: [],
      tasks: [],
      otherCategories: [],
    };
  let publicationBusy = false;
  const mainTabs = ["invites", "events", "venues", "households", "food", "other"];
  let appearanceMode = "wide",
    appearanceOwner = null,
    appearancePreviewOpen = false,
    notificationMode = "wide",
    notificationOwner = null;
  const defaultMainTab = () =>
    mainTabs.find((name) => !A.current || A.tabAllowed(name)) || "settings";
  let activeTab = "invites",
    lastMainTab = "invites",
    activeSettingsTab = "application";
  const expandedGroups = new Map(),
    foodCategoryMessages = new Map();
  let foodCreationCategory = null;
  const qs = (s) => document.querySelector(s);
  let statusTimer = null,
    pendingAdminInvitation = null,
    invitationApiError = "";
  function show(msg, type = "info", autoDismiss = true) {
    clearTimeout(statusTimer);
    if (!R.showStatus("adminMessage", msg, type)) return;
    if (autoDismiss && window.RSVP_NOTIFICATIONS?.autoDismissAdmin() !== false)
      statusTimer = setTimeout(() => R.showStatus("adminMessage", ""), 5000);
  }
  function showEventMenus(ready) {
    $("adminApp").classList.toggle("hidden", !ready);
    qs(".admin-section-menu").classList.toggle("hidden", !ready);
    $("guestPreviewButton").classList.toggle("hidden", !ready);
  }
  function resetEventLoad() {
    eventLoadVersion++;
    eventLoading = false;
    manualSendsDuringLoad = null;
    manualSendInvitesOpen = false;
    eventDataActor = null;
    guestOverview = null;
    changeAlert.loaded(null);
    guestLive.sync();
    showEventMenus(false);
  }
  const currentActor = (actor) =>
    !!actor && actor === user && !signingOut && !authRecovery?.blocksAccess();

  const timezones = Intl.supportedValuesOf?.("timeZone") || [];
  function timezoneOptions(current) {
    const zones = new Set([
      "UTC", "Atlantic/Faroe", "Europe/Berlin",
      Intl.DateTimeFormat().resolvedOptions().timeZone, ...timezones, current,
    ]);
    return [...zones].filter(Boolean).sort().map(zone => [zone, zone]);
  }
  const eventDeadlineFields = [
    ["settingDeadline", "rsvp_deadline"], ["settingFoodDeadline", "food_deadline"],
  ];
  function deadlineWallTime(instant, zone) {
    try { return R.zonedInput(instant, zone); }
    catch (_) { return R.zonedInput(instant, "UTC"); }
  }
  function row(parent, tag, attrs = {}, text) {
    const n = R.dom(tag, attrs, text);
    parent.append(n);
    return n;
  }
  function makeTable(headers, values) {
    const table = R.dom("table", { class: "data-table" });
    const thead = row(table, "thead"),
      tr = row(thead, "tr");
    headers.forEach((h) => row(tr, "th", {}, h));
    const tbody = row(table, "tbody");
    values.forEach((cols) => {
      const tr = row(tbody, "tr");
      cols.forEach((v) => {
        const td = row(tr, "td");
        if (v instanceof Node) td.append(v);
        else td.textContent = String(v ?? "");
      });
    });
    return table;
  }
  function settingsTab(name) {
    if (A.current && !A.settingsAllowed(name))
      name =
        [
          "application",
          "checklist",
          "administrators",
          "languages",
          "interface",
          "templates",
          "placeholders",
          "backups",
          "logs",
        ].find((n) => A.settingsAllowed(n)) || "checklist";
    activeSettingsTab = name;
    document.querySelectorAll("[data-settings-tab]").forEach((b) => {
      const active = b.dataset.settingsTab === name;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
      b.tabIndex = active ? 0 : -1;
    });
    document
      .querySelectorAll("[data-settings-panel]")
      .forEach((n) =>
        n.classList.toggle("hidden", n.dataset.settingsPanel !== name),
      );
    requestAnimationFrame(() => {
      document.querySelector('[data-settings-tab="' + name + '"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
      updateTabOverflow();
    });
    if (name === "logs") loadLogs(true);
    if (name === "placeholders") window.RSVP_ADMIN_PLACEHOLDERS.render({ R, T });
  }
  function tab(name, updateUrl = true) {
    const previousTab = activeTab;
    const oldOverview = name === "overview";
    if (oldOverview) name = "invites";
    if (name === "tasks") name = "other";
    if (![...mainTabs, "language", "settings"].includes(name))
      name = defaultMainTab();
    if (A.current && !A.tabAllowed(name)) name = defaultMainTab();
    activeTab = name;
    if (!["settings", "language"].includes(name)) lastMainTab = name;
    window.RSVP_ADMIN_TOOLS?.showTasks(name === "other");
    window.RSVP_ADMIN_TOOLS?.translationScope(
      name === "language" ? "content" : "settings",
    );
    document.querySelectorAll("[data-tab]").forEach((b) => {
      const active = b.dataset.tab === name;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
      b.tabIndex = active ? 0 : -1;
    });
    document
      .querySelectorAll("[data-panel]")
      .forEach((n) => n.classList.toggle("hidden", n.dataset.panel !== name));
    requestAnimationFrame(updateTabOverflow);
    const selectedTab = document.querySelector('[data-tab="' + name + '"]');
    requestAnimationFrame(() =>
      selectedTab?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
    $("adminApp").classList.toggle("showing-settings", name === "settings");
    $("adminApp").classList.toggle("showing-language", name === "language");
    $("mainSectionToggle").setAttribute(
      "aria-pressed",
      String(!["settings", "language"].includes(name)),
    );
    $("contentLanguagesToggle").setAttribute(
      "aria-pressed",
      String(name === "language"),
    );
    updateSectionDescription();
    updateTabOverflow();
    $("settingsToggle").classList.toggle("active", name === "settings");
    $("settingsToggle").setAttribute(
      "aria-pressed",
      String(name === "settings"),
    );
    if (name === "settings") settingsTab(activeSettingsTab);
    A.apply();
    if (name === "invites" && name !== previousTab) invitesView.refreshInvitationActivity();
    if (previousTab === "invites" && name !== previousTab && manualSendInvitesOpen) {
      manualSendInvitesOpen = false;
      changeAlert.reconcile();
    }
    if (name !== previousTab) guestLive.sync();
    if (updateUrl || oldOverview) {
      const hash = "#" + name;
      const next = location.pathname + location.search + hash;
      if (location.pathname + location.search + location.hash !== next)
        history[oldOverview ? "replaceState" : "pushState"]({ adminSection: name }, "", next);
    }
  }
  function updateSectionDescription() {
    const description =
      activeTab === "settings"
        ? "Manage application settings and administrator access."
        : activeTab === "language"
          ? "Translate event content for guests."
          : "Manage invitations, food and event details.";
    $("adminModeLabel").textContent =
      T(description) +
      (store.settings?.is_published === false
        ? " · " + T("Unpublished · Guest preview only")
        : "");
    const section =
      activeTab === "settings"
        ? "Settings"
        : activeTab === "language"
          ? "Languages"
          : "Home";
    for (const [id, label] of [
      ["mainSectionToggle", "Home"],
      ["contentLanguagesToggle", "Languages"],
      ["settingsToggle", "Settings"],
    ]) {
      const button = $(id);
      let text = button.querySelector(".section-icon-label");
      if (!text) {
        text = R.dom("span", { class: "section-icon-label" });
        button.append(text);
      }
      text.textContent = T(label);
      button.classList.toggle("section-current", label === section);
    }
  }
  function updateTabOverflow() {
    for (const [selector, id, visible] of [
      [".admin-main-tabs", "tabOverflowHint", !["settings", "language"].includes(activeTab)],
      [".settings-tabs", "settingsTabOverflowHint", activeTab === "settings"],
    ]) {
      const nav = document.querySelector(selector), hint = $(id);
      if (nav && hint) hint.classList.toggle("hidden", !visible || nav.scrollWidth <= nav.clientWidth + 1);
    }
  }

  function returnToInvitesAfterDatabaseChange(message) {
    window.RSVP_ADMIN_TOOLS.completeDatabaseChange();
    const url = new URL(location.href);
    url.hash = "invites";
    history.replaceState({
      adminSection: "invites",
      databaseChangeNotice: { actor: user?.id, message },
    }, "", url);
    window.scrollTo(0, 0);
    location.reload();
    return true;
  }
  const {
    formFeedback,
    restoreDraft,
    formActions,
    footerAction,
    cleanSave,
    readingView,
    closeReading,
    managementForm,
    field,
    saveForm,
  } = window.RSVP_ADMIN_FORMS.create({
    R,
    T,
    isEditing: () => true,
    iconAction,
    getActiveTab: () => activeTab,
    rememberDisclosure: (key, open) => expandedGroups.set(key, open),
    reload,
    show,
  });
  const localEditors = window.RSVP_ADMIN_EDITORS.create({
    R,
    T,
    can,
    iconAction,
    closeRecord: closeReading,
  });
  window.RSVP_LOCAL_EDITORS = localEditors;
  function hasOpenAdminWork() {
    if (eventLoading || pendingManagementCalls || publicationBusy ||
        qs('#adminApp [aria-busy="true"], dialog[open]:not(.admin-change-alert), .inline-editor-panel[open]')) return true;
    const open = [
      '#adminApp :is(.record-open, .local-editor-open, .household-detail-editing)',
      '#adminApp :is(.guest-edit-form, .food-edit-form, .contact-editor, .guest-move-panel):not(.hidden)',
      '#adminApp details[open] > :is(#newVenueForm, #newSessionEditor)',
    ];
    return localEditors.hasUnsaved() || [...document.querySelectorAll(open.join(", "))].some(node =>
      !node.closest('[hidden], .hidden, details:not([open])') && node.getClientRects().length > 0);
  }
  const changeAlert = window.RSVP_ADMIN_CHANGE_ALERT.create({
    R, T,
    getActor: () => currentActor(eventDataActor) ? eventDataActor : null,
    hasOpenWork: hasOpenAdminWork,
    readMarker: () => R.adminRpc("admin_change_marker", {}, { notifyAccessLoss: false }),
    refresh: refreshEventData,
    preferInline: () => activeTab === "invites" && manualSendInvitesOpen,
    setInline: showInvitesChangeNotice,
  });
  function showInvitesChangeNotice(visible) {
    let notice = $("inviteEventChangeNotice");
    if (!notice && visible) {
      notice = R.dom("div", { id: "inviteEventChangeNotice", class: "bulk-invite-send-queue micro" });
      const message = R.dom("span", {}, T("interface.messages.event_data_changed") + " " + T("interface.messages.refresh_to_see_latest"));
      message.setAttribute("role", "status");
      const refresh = R.dom("button", { type: "button", class: "btn secondary" }, T("interface.messages.refresh_action"));
      refresh.addEventListener("click", () => $("refreshButton").click());
      notice.append(message, refresh);
      $("bulkInvitesHost").after(notice);
    }
    if (notice) notice.hidden = !visible;
  }
  const guestLive = window.RSVP_ADMIN_GUEST_LIVE.create({
    getClient: () => db,
    getContext: () => currentActor(eventDataActor) && !eventLoading && activeTab === "invites" &&
      (can("invites") || can("food")) ? eventLoadVersion : null,
    readSnapshot: () => R.adminRpc("admin_guest_overview", {}, { notifyAccessLoss: false }),
    onSnapshot: applyGuestOverview,
  });
  function getOverviewStore() {
    return window.RSVP_ADMIN_OVERVIEW.withGuestOverview(store, guestOverview);
  }
  function applyGuestOverview(snapshot) {
    if (!snapshot || !["households", "guests", "responses", "claims", "overrides", "topics"]
      .every(key => Array.isArray(snapshot[key])) || !Number.isSafeInteger(snapshot.submissions)) return;
    if (!snapshot.topics.length && !guestOverview) return;
    guestOverview = snapshot.topics.length ? snapshot : null;
    statisticsView.refreshCounts();
    invitesView.refreshOverviewCounts();
  }
  async function reload({ showFeedback = true } = {}) {
    const actor = user;
    if (!currentActor(actor)) return false;
    const version = ++eventLoadVersion;
    const current = () => currentActor(actor) && version === eventLoadVersion;
    const opening = actor !== eventDataActor;
    const recordedWhileLoading = new Map();
    manualSendsDuringLoad = recordedWhileLoading;
    eventLoading = true;
    if (opening) $("refreshButton").disabled = true;
    if (showFeedback) show(T("interface.messages.loading_event_data"), "info", !opening);
    try {
      await A.refresh(current);
      if (!current()) return false;
      let loaded = await R.adminRpc("admin_load_data", { p_compact_queue_pictures: true });
      if (!current()) return false;
      if (loaded.error?.code === "PGRST202" &&
          loaded.error.message?.includes("admin_load_data(p_compact_queue_pictures)"))
        loaded = await R.adminRpc("admin_load_data");
      if (!current()) return false;
      if (loaded.error) throw loaded.error;
      if (!loaded.data?.settings)
        throw Error(T("Administrator permissions are unavailable."));
      const { queuePictures, change_marker: marker, ...data } = loaded.data;
      if (Array.isArray(data.queue))
        data.queue = data.queue.map(row => {
          if (!Object.hasOwn(row, "message_image_key")) return row;
          const { message_image_key: key, ...delivery } = row;
          if (key == null) return { ...delivery, message_image: null };
          const picture = typeof key === "string" && queuePictures &&
            Object.hasOwn(queuePictures, key) && queuePictures[key];
          if (!picture || typeof picture.image !== "string")
            throw Error(T("The server returned an unreadable response."));
          return { ...delivery, message_image: picture };
        });
      const admins = can("administrators")
        ? await managementRpc("admin_list_members")
        : [];
      if (!current()) return false;
      const adminInvitations = can("administrators")
        ? await managementRpc("admin_list_invitations")
        : [];
      if (!current()) return false;
      for (const result of recordedWhileLoading.values()) mergeManualSend(data, result);
      Object.assign(store, data, { admins, adminInvitations });
      guestOverview = null;
      A.setFeatures(store.settings);
      invitationApiError = "";
      if (store.languages.length)
        window.RSVP_I18N.configure({
          languages: store.languages,
          default_language: store.settings?.default_language,
          fallback_language: store.settings?.fallback_language,
          translations: store.content,
        });
      // Invitation drafts and salutation previews can use a language other than the administrator's.
      await Promise.all([
        window.RSVP_I18N.loadCatalogs(),
        ...window.RSVP_I18N.languages.map(({ language_code }) => window.RSVP_I18N.loadCategory(language_code, "interface")),
      ]);
      if (!current()) return false;
      showEventMenus(true);
      renderAll();
      eventDataActor = actor;
      manualSendInvitesOpen = recordedWhileLoading.size > 0 && activeTab === "invites";
      changeAlert.loaded(marker);
      if (opening && showFeedback) show("");
      return true;
    } catch (e) {
      if (current()) {
        if (opening) showEventMenus(false);
        if (showFeedback) show(R.safeError(e), "error", !opening);
      }
      return false;
    } finally {
      if (version === eventLoadVersion) {
        eventLoading = false;
        manualSendsDuringLoad = null;
        guestLive.sync();
      }
      if (opening && current()) $("refreshButton").disabled = false;
    }
  }
  async function refreshEventData() {
    const actor = user, button = $("refreshButton");
    if (!currentActor(actor)) return false;
    button.disabled = true;
    button.classList.add("is-refreshing");
    try {
      if (!await reload()) return false;
      if (activeTab === "settings" && activeSettingsTab === "logs")
        await loadLogs(true);
      if (currentActor(actor)) show(T("interface.messages.event_data_refreshed"), "success");
      return true;
    } finally {
      button.classList.remove("is-refreshing");
      if (currentActor(actor)) button.disabled = false;
    }
  }
  const statisticsView = window.RSVP_ADMIN_STATISTICS.create({
    R,
    T,
    getStore: getOverviewStore,
    can,
    planningLabel,
    planningConfiguration,
    setOverviewCards: cards => window.RSVP_ADMIN_PREFERENCES.setOverviewCards(cards, iconAction),
  });
  matchMedia("(max-width: 700px)").addEventListener("change", () => {
    window.RSVP_NOTIFICATIONS.configure("admin", window.RSVP_GUEST_INTERFACE.effective(store.settings, undefined, store.languages).notification_preferences?.admin);
  });
  function renderAll() {
    window.RSVP_POPUPS.reconcile(can);
    const householdDialog = window.RSVP_POPUPS.get("invites-household-details");
    if (householdDialog && !editableInvitedHousehold(householdDialog.dataset.householdId))
      householdDialog.close();
    const resumeInline = window.RSVP_INLINE?.suspend();
    try {

    window.RSVP_NOTIFICATIONS.configure(
      "admin",
      window.RSVP_GUEST_INTERFACE.effective(store.settings, undefined, store.languages).notification_preferences?.admin,
    );
    qs('[data-tab="households"]').textContent = planningLabel("households");
    $("householdsTitle").textContent = planningLabel("households");
    $("adminEventTitle").textContent =
      store.settings?.event_name || T("interface.messages.event_dashboard");
    statisticsView.render();
    shortcutsView.render();
    const deployed = window.RSVP_CONFIG || {};
    let websiteConfigured = false;
    try {
      websiteConfigured = Boolean(
        deployed.supabaseUrl &&
          deployed.supabaseKey &&
          R.normalizeUrl(deployed.supabaseUrl) ===
            R.normalizeUrl(R.config().supabaseUrl) &&
          R.validateKey(deployed.supabaseKey),
      );
    } catch (_) {
      websiteConfigured = false;
    }
    const checks = [
      [T("interface.messages.admin_account_connected"), true],
      [
        T("interface.messages.event_name_and_date_entered"),
        !!(store.settings?.event_name && store.settings?.event_date),
      ],
      [
        T("interface.messages.at_least_one_session_created"),
        store.sessions.some((s) => s.is_active),
      ],
      [
        T("interface.messages.invitations_assigned"),
        store.defaults.some((d) => d.is_invited),
      ],
      [
        T("interface.messages.website_connection_in_deployed_config_js"),
        websiteConfigured,
      ],
      [
        T("interface.messages.website_address_saved_in_event_settings"),
        !!store.settings?.website_url,
      ],
      [T("interface.messages.event_published"), !!store.settings?.is_published],
    ];
    window.RSVP_ADMIN_APPLICATION.render({ R, T, checks, settings: store.settings, canEdit: can("settings", "edit"), busy: publicationBusy });
    renderHouseholds();
    invitesView.render();
    renderFood();
    renderAdmins();
    renderSettings();
    renderPlanningSettings();
    renderInvitationTemplates();
    renderSessions();
    renderContent();
    window.RSVP_ADMIN_TOOLS?.render();
    transportSecurity?.refresh();
    experimentalView.render();
    databaseView.render();
    compactRead.apply();
    updateSectionDescription();
    for (const form of $("adminApp").querySelectorAll(
      "#eventSettingsForm,.management-form,.guest-edit-form",
    ))
      cleanSave(form, !form.cleanSaveUpdate);
    for (const form of document.querySelectorAll(
      "#venueList form.management-form,#sessionsList form.management-form",
    ))
      readingView(form, form.dataset.formKey);
    readingView($("eventSettingsForm"), "event-settings");
    readingView($("languagePreferences"), "language-preferences");
    A.render();
    A.apply();
    localEditors.refresh(true);
    if (!A.tabAllowed(activeTab)) tab(defaultMainTab(), false);
    else if (activeTab === "settings" && !A.settingsAllowed(activeSettingsTab))
      settingsTab("checklist");

    } finally { resumeInline?.(); }
  }
  function ordered(list, label) {
    return [...list].sort(
      (a, b) =>
        (a.sort_order || 0) - (b.sort_order || 0) ||
        String((label === "household_name" ? R.householdName(a) : a[label]) || "")
          .toLowerCase()
          .localeCompare(String((label === "household_name" ? R.householdName(b) : b[label]) || "").toLowerCase()) ||
        a.id.localeCompare(b.id),
    );
  }
  function actionGlyph(kind) {
    const drawings = {
      save: ["M5 12l4 4L19 6"],
      download: ["M12 3v12", "m7 10 5 5 5-5", "M4 17v4h16v-4"],
      language: [
        "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
        "M3 12h18",
        "M12 3c5 5 5 13 0 18",
        "M12 3c-5 5-5 13 0 18",
      ],
      move: ["M4 7h15", "m15 3 4 4-4 4", "M20 17H5", "m9 13-4 4 4 4"],
      search: ["M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0", "m16 16 6 6"],
      edit: ["m16 5 3 3", "M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"],
      delete: [
        "M3 6h18",
        "M8 6V4h8v2",
        "M5 6l1 14h12l1-14",
        "M10 10v6",
        "M14 10v6",
      ],
      copy: [
        "M8 3h11a2 2 0 0 1 2 2v11",
        "M16 8H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Z",
      ],
      add: ["M12 5v14", "M5 12h14"],
      unlink: [
        "m10 8 2-2a4 4 0 0 1 6 6l-2 2",
        "m14 16-2 2a4 4 0 0 1-6-6l2-2",
        "M3 3l18 18",
      ],
      signOut: ["M10 4H5v16h5", "M9 12h12", "m17 8 4 4-4 4"],
      show: [
        "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z",
        "M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0",
      ],
      hide: [
        "M3 3l18 18",
        "M10.5 6.1c5.8-.7 9.4 3.6 11.5 5.9a18 18 0 0 1-4.3 4.1",
        "M6.2 7.8A18 18 0 0 0 2 12s3.5 6 10 6c1.2 0 2.3-.2 3.3-.5",
      ],
      share: ["M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "m8.5 10.5 7-4", "m8.5 3 7 4"],
      archive: ["M3 3h18v4H3z", "M5 7v14h14V7", "M10 11h4"],
      restore: ["M4 10a8 8 0 1 1 1 8", "M4 4v6h6"],
    };
    const key = kind === "rename" ? "edit" : kind;
    if (drawings[key]) {
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      for (const d of drawings[key]) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        svg.append(path);
      }
      return svg;
    }
    return null;
  }
  function iconAction(kind, title, onClick, disabled = false, extraClass = "") {
    const glyph = { up: "↑", down: "↓" }[kind] || "";
    const button = R.dom(
      "button",
      { class: "admin-row-icon " + extraClass, type: "button", title },
      glyph,
    );
    const svg = actionGlyph(kind);
    if (svg) button.append(svg);
    button.setAttribute("aria-label", title);
    button.disabled = !!disabled;
    if (onClick)
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        try {
          await onClick();
        } catch (error) {
          show(R.safeError(error), "error");
        } finally {
          button.disabled = !!disabled;
        }
      });
    return button;
  }
  function btn(text, title, onClick, disabled = false) {
    const kind =
      {
        "↑": "up",
        "↓": "down",
        [T("interface.messages.copy_link")]: "copy",
        [T("interface.messages.edit")]: "edit",
        [T("interface.messages.rename")]: "rename",
        [T("interface.messages.register_category")]: "add",
      }[text] || "edit";
    return iconAction(
      kind,
      title,
      onClick,
      disabled,
      text === T("interface.messages.copy_link") ? "" : "edit-only",
    );
  }
  function setDisclosure(details, key, defaultOpen = false, forceOpen = false) {
    details.open =
      forceOpen ||
      (expandedGroups.has(key) ? expandedGroups.get(key) : defaultOpen);
    details.addEventListener("toggle", () => {
      if (!forceOpen) expandedGroups.set(key, details.open);
    });
    return details;
  }
  function expandHouseholdTree(yes) {
    document
      .querySelectorAll("#householdRows details[data-tree-key]")
      .forEach((d) => {
        d.open = yes;
        if (d.dataset.treeKey) expandedGroups.set(d.dataset.treeKey, yes);
      });
  }
  async function rpcAction(name, params, success) {
    await managementRpc(name, params);
    await reload();
    if (success) show(success, "success");
  }
  function householdGroupName(h) {
    return (
      store.relationGroups.find((r) => r.id === h.relation_group_id)?.name ||
      T("interface.messages.ungrouped")
    );
  }
  function isDescendantOf(candidateId, ancestorId) {
    const byId = new Map(store.households.map((h) => [h.id, h]));
    let current = byId.get(candidateId);
    const seen = new Set();
    while (current?.parent_id && !seen.has(current.id)) {
      if (current.parent_id === ancestorId) return true;
      seen.add(current.id);
      current = byId.get(current.parent_id);
    }
    return false;
  }
  function guestSalutationEditor(fields, guest, { first, last, title, relation, language }) {
    const text = window.RSVP_INVITATION_TEXT;
    const saved = guest.invitation_salutation;
    const nickname = field(fields, T("Salutation or nickname"), saved?.nickname, null, "text", false, 100);
    nickname.closest("label").classList.add("guest-edit-field");
    const display = R.dom("details", { class: "guest-name-display" });
    const options = R.dom("div", { class: "guest-edit-fields guest-name-display-options" });
    const displayChoices = [
      ["", T("System default")],
      ["true", T("Show to guests")],
      ["false", T("Hide from guests")],
    ];
    const overrides = [
      ["show_titles", T("Titles")],
      ["show_repeated_surname", T("Show repeated surname")],
    ].map(([key, label]) => {
      const input = field(options, label, String(saved?.[key] ?? ""), displayChoices);
      input.closest("label").classList.add("guest-edit-field");
      return [key, input];
    });
    display.append(R.dom("summary", {}, T("Name display")), options);
    fields.append(display);

    const section = R.dom("fieldset", { class: "guest-salutation" });
    section.append(R.dom("legend", {}, T("Invitation salutation")));
    const format = field(section, T("Salutation format"), saved?.pattern || text.defaultSalutationPattern, null, "text", true, 200);
    format.closest("label").classList.add("guest-edit-field");
    const formatEditor = window.RSVP_PLACEHOLDER_HELP.attachTokenEditor(format, { R, T, tokens: text.salutationTokens });
    section.append(R.dom("p", { class: "micro" }, T("Drag chips to reorder them. Type between chips to add your own text.")));

    const household = () => store.households.find(item => item.id === guest.household_id);
    const draftGuest = () => ({
      ...guest,
      first_name: first.value.trim(),
      last_name: last.value.trim(),
      courtesy_title: title.value,
      relation: relation.value.trim(),
      language: language.value || household()?.language,
    });
    const preview = R.dom("output");
    preview.setAttribute("aria-label", T("Preview"));
    const defaults = R.dom("button", { class: "small-tool", type: "button" }, T("Use default format"));
    const footer = R.dom("div", { class: "guest-salutation-footer" });
    footer.append(R.dom("span", { class: "micro" }, T("Preview")), preview, defaults);
    section.append(footer);
    fields.append(section);

    const controls = [nickname, format, ...overrides.map(([, input]) => input)];
    function configuration() {
      const data = {};
      const pattern = format.value.trim();
      const nicknameValue = nickname.value.trim();
      if (pattern !== text.defaultSalutationPattern) data.pattern = pattern;
      if (nicknameValue) data.nickname = nicknameValue;
      for (const [key, input] of overrides)
        if (input.value) data[key] = input.value === "true";
      return Object.keys(data).length ? data : null;
    }
    function renderPreview() {
      const validFormat = text.validateSalutationPattern(format.value.trim());
      const validNickname = !/[{}\r\n]/.test(nickname.value);
      format.setCustomValidity(validFormat ? "" : T("Use only the listed salutation placeholders."));
      nickname.setCustomValidity(validNickname ? "" : T("Enter a nickname without braces or line breaks."));
      const config = configuration();
      const draft = draftGuest();
      preview.textContent = validFormat && validNickname ? text.guestSalutation(store, draft, {
        configuration: config,
        language: draft.language,
        household: household(),
      }) : "";
      defaults.disabled = config?.pattern === undefined;
    }
    for (const input of [section, options, nickname, first, last, title, relation, language]) {
      input.addEventListener("input", renderPreview);
      input.addEventListener("change", renderPreview);
    }
    defaults.addEventListener("click", () => {
      if (section.closest("form")?.getAttribute("aria-busy") === "true") return;
      format.value = text.defaultSalutationPattern;
      format.dispatchEvent(new Event("input", { bubbles: true }));
      formatEditor.focus({ preventScroll: true });
    });
    renderPreview();
    return {
      changed: () => controls.some(input => input.value !== input.dataset.cleanOriginal),
      configuration,
    };
  }
  function buildGuestEditor(guest) {
    const form = R.dom("form", { class: "guest-edit-form edit-only hidden" });
    form.dataset.formKey = "guest:" + (guest.id || guest.household_id + ":new");
    const fields = R.dom("div", { class: "guest-edit-fields" });
    const restoreOnly = guest.archived_at || store.households.find(h => h.id === guest.household_id)?.archived_at;
    function labeledInput(
      label,
      value,
      maxLength,
      required = false,
      multiline = false,
    ) {
      const wrap = R.dom("label", { class: "guest-edit-field" });
      wrap.append(R.dom("span", {}, label));
      const input = R.dom(
        multiline ? "textarea" : "input",
        multiline ? {} : { type: "text" },
      );
      input.value = value || "";
      input.maxLength = maxLength;
      if (required) input.required = true;
      wrap.append(input);
      fields.append(wrap);
      return input;
    }
    function labeledSelect(label, value, options) {
      const wrap = R.dom("label", { class: "guest-edit-field" });
      wrap.append(R.dom("span", {}, label));
      const select = R.dom("select");
      for (const [key, display] of options)
        select.append(R.dom("option", { value: key }, display));
      select.value = value || "";
      wrap.append(select);
      fields.append(wrap);
      return select;
    }
    const first = labeledInput(
      T("interface.messages.first_name"),
      guest.first_name,
      120,
      true,
    );
    const last = labeledInput(
      T("interface.messages.last_name"),
      guest.last_name,
      120,
    );
    const title = labeledSelect(
      T("interface.messages.title"),
      guest.courtesy_title,
      [
        ["", T("interface.messages.none")],
        ["Mr.", T("Mr.")],
        ["Ms.", T("Ms.")],
        ["Son", T("interface.messages.son")],
        ["Daughter", T("interface.messages.daughter")],
      ],
    );
    const relation = labeledInput(
      T("interface.messages.relation"),
      guest.relation,
      160,
    );
    const language = labeledSelect(
      T("interface.messages.language"),
      guest.language,
      [
        ["", T("interface.messages.household_default")],
        ...languages(guest.language),
      ],
    );
    const salutation = restoreOnly ? null : guestSalutationEditor(fields, guest, { first, last, title, relation, language });
    const phone = labeledInput(T("interface.messages.phone"), guest.phone, 80);
    phone.type = "tel";
    const mobile = labeledInput(
      T("interface.messages.guest_mobile"),
      guest.mobile,
      80,
    );
    mobile.type = "tel";
    const email = labeledInput(T("interface.messages.email"), guest.email, 254);
    email.type = "email";
    const contactMethod = labeledSelect(
      T("interface.messages.guest_contact_method"),
      guest.preferred_contact_method,
      [
        ["", T("interface.messages.unspecified")],
        ["sms", "SMS"],
        ["whatsapp", "WhatsApp"],
        ["email", T("interface.messages.email")],
      ],
    );
    const contactRequired = () => {
      mobile.required = ["sms", "whatsapp"].includes(contactMethod.value);
      email.required = contactMethod.value === "email";
    };
    contactMethod.addEventListener("change", contactRequired);
    contactRequired();
    const childWrap = R.dom("label", { class: "guest-child-field" });
    const child = R.dom("input", { type: "checkbox" });
    child.checked = !!guest.is_child;
    childWrap.append(
      child,
      R.dom("span", {}, T("interface.messages.child_guest")),
    );
    fields.append(childWrap);
    const dietary = labeledInput(
      T("interface.messages.dietary_requirements"),
      guest.dietary_requirements,
      1000,
      false,
      true,
    );
    const notes = labeledInput(
      T("interface.messages.notes"),
      guest.notes,
      2000,
      false,
      true,
    );
    form.append(
      fields,
      R.dom(
        "p",
        { class: "micro" },
        guest.id
          ? T(
              "interface.messages.rsvp_status_and_household_assignment_are_not_changed_by_editing_g",
            )
          : T(
              "interface.messages.new_guests_inherit_this_household_s_session_invitations",
            ),
      ),
    );
    const buttons = R.dom("div", { class: "guest-edit-actions" });
    const save = R.dom(
      "button",
      { type: "submit", class: "btn" },
      T("Save"),
    );
    const cancel = R.dom(
      "button",
      { type: "button", class: "btn secondary" },
      T("interface.messages.cancel"),
    );
    cancel.dataset.discard = "true";
    cancel.addEventListener("click", () => {
      restoreDraft(form);
      form.classList.add("hidden");
    });
    buttons.classList.add("form-actions");
    buttons.append(save, cancel);
    form.append(buttons);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const firstName = first.value.trim();
      if (!firstName) {
        first.focus();
        show(T("interface.messages.first_name_is_required"), "warning");
        return;
      }
      const payload = {
        p_guest_id: guest.id,
        p_first_name: firstName,
        p_last_name: last.value.trim() || null,
        p_courtesy_title: title.value || null,
        p_relation: relation.value.trim() || null,
        p_language: language.value || null,
        p_is_child: child.checked,
        p_dietary_requirements: dietary.value.trim() || null,
        p_notes: notes.value.trim() || null,
        p_phone: phone.value.trim() || null,
        p_mobile: mobile.value.trim() || null,
        p_email: email.value.trim() || null,
        p_preferred_contact_method: contactMethod.value || null,
      };
      save.disabled = true;
      form.setAttribute("aria-busy", "true");
      formFeedback(form, "saving");
      try {
        const fields = Object.fromEntries(
          Object.entries(payload)
            .filter(([k]) => k !== "p_guest_id")
            .map(([k, v]) => [k.slice(2), v]),
        );
        if (salutation?.changed()) fields.invitation_salutation = salutation.configuration();
        const { error } = await R.adminRpc("admin_save_guest_details", {
          p_guest_id: guest.id || null,
          p_household_id: guest.household_id,
          p_values: fields,
        });
        if (error) throw error;
        formFeedback(form, "saved");
        const refreshed = await reload();
        if (refreshed)
          show(T("interface.messages.guest_details_saved"), "success");
      } catch (error) {
        formFeedback(form, "error", R.safeError(error));
        show(R.safeError(error), "error");
      } finally {
        form.removeAttribute("aria-busy");
        form.cleanSaveUpdate?.();
      }
    });
    if (guest.id) {
      footerAction(
        form,
        archiveButton("guests", guest),
        T(
          guest.archived_at
            ? "interface.messages.restore"
            : "interface.messages.archive",
        ),
      );
      if (guest.archived_at || !store.settings?.is_published)
        footerAction(form, deleteRecordButton("guests", guest));
      if (restoreOnly) {
        form.dataset.restoreOnly = "true";
        for (const control of fields.querySelectorAll("input,select,textarea"))
          control.disabled = true;
      }
    }
    cleanSave(form);
    return form;
  }
  function buildGuestList(guests) {
    const list = R.dom("div", { class: "household-guest-list" });
    list.append(
      R.dom(
        "div",
        { class: "guest-list-heading" },
        planningName(planningConfiguration().labels.guests) ||
          T("interface.messages.individual_guests"),
      ),
    );
    const sorted = R.orderedGuests(guests);
    const active = sorted.filter((g) => !g.archived_at);
    for (const g of sorted.filter(
      (g) => $("showArchived").checked || !g.archived_at,
    )) {
      const entry = R.dom("div", { class: "household-guest-entry" });
      entry.dataset.guestId = g.id;
      const header = R.dom("div", { class: "household-guest-row" });
      const info = R.dom("div", { class: "household-guest-info" });
      const name = [g.courtesy_title, g.first_name, g.last_name]
        .filter(Boolean)
        .join(" ");
      info.append(
        R.dom("strong", {}, name || T("interface.messages.unnamed_guest")),
      );
      const meta = [
        g.archived_at ? T("interface.messages.archived") : null,
        g.is_child ? T("interface.messages.child") : null,
        g.relation,
      ]
        .filter(Boolean)
        .join(" · ");
      info.append(R.dom("small", { class: "muted" }, meta));
      const contacts = R.dom("small", { class: "guest-contact-summary muted" });
      for (const [label, value] of [
        [T("interface.messages.phone"), g.phone],
        [T("interface.messages.guest_mobile"), g.mobile],
        [T("interface.messages.email"), g.email],
      ])
        if (value) contacts.append(R.dom("span", {}, label + ": " + value));
      const method = contactMethodLabel(g.preferred_contact_method);
      if (method) contacts.append(R.dom("span", {}, "(" + method + ")"));
      if (contacts.childElementCount) info.append(contacts);
      header.append(info);
      const position = active.findIndex((row) => row.id === g.id),
        order = R.dom("span", { class: "guest-order-actions edit-only" }),
        blocked =
          !!g.archived_at ||
          !!store.households.find((h) => h.id === g.household_id)?.archived_at;
      for (const [direction, label, boundary] of [
        [
          -1,
          "Move guest up",
          position <= 0 || !!active[position - 1]?.is_child !== !!g.is_child,
        ],
        [
          1,
          "Move guest down",
          position === active.length - 1 ||
            !!active[position + 1]?.is_child !== !!g.is_child,
        ],
      ])
        order.append(
          iconAction(
            direction < 0 ? "up" : "down",
            T(label),
            () =>
              rpcAction(
                "admin_order_guest",
                {
                  p_guest_id: g.id,
                  p_direction: direction,
                  p_expected_order: active.map((guest) => guest.id),
                },
                T("Guest order saved"),
              ),
            blocked || boundary,
            "edit-only",
          ),
        );
      header.append(order);
      const editor = buildGuestEditor(g);
      header.append(
        iconAction(
          "edit",
          T("interface.messages.edit_guest") + name,
          () => editor.classList.toggle("hidden"),
          false,
          "edit-only",
        ),
      );
      entry.append(header, editor);
      const management = guestManagement(g);
      header.append(management.actions);
      entry.append(management.form);
      list.append(entry);
    }
    if (!sorted.length)
      list.append(
        R.dom(
          "p",
          { class: "micro" },
          T("interface.messages.no_guests_assigned_to_this_household"),
        ),
      );
    return list;
  }

  function disclosure(title, extra = "") {
    const d = R.dom("details", { class: "admin-management " + extra });
    d.append(R.dom("summary", {}, title));
    return d;
  }
  async function managementRpc(name, args) {
    pendingManagementCalls++;
    try {
      const { data, error } = await R.adminRpc(name, args);
      if (error) throw error;
      return data;
    } finally {
      pendingManagementCalls--;
    }
  }
  async function readManualSend(saved) {
    const client = db;
    const { data: queue, error } = await client.from("invitation_send_queue")
      .select("id,household_id,status,revision,updated_at").eq("id", saved.id).maybeSingle();
    if (error) throw error;
    if (queue?.status !== "sent") return { queue, delivery: null };
    const { data: confirmation, error: confirmationError } = await client.from("invitation_deliveries")
      .select("id,queue_id,confirmed_by,confirmed_at,delivery_note").eq("queue_id", saved.id).maybeSingle();
    if (confirmationError || !confirmation) throw confirmationError || Error("Delivery confirmation is unavailable");
    let snapshot = saved;
    if (queue.revision !== saved.revision + 1) {
      // Another administrator may have edited and recorded this queue item.
      // Use that saved version only when it differs from our prepared copy.
      const { data, error: snapshotError } = await client.from("invitation_send_queue")
        .select("*").eq("id", saved.id).maybeSingle();
      if (snapshotError || !data || data.revision !== queue.revision)
        throw snapshotError || Error("Delivery snapshot is unavailable");
      snapshot = data;
    }
    return {
      queue: { ...snapshot, ...queue },
      delivery: {
        ...confirmation,
        recipient_snapshot: snapshot.recipient_snapshot,
        message_snapshot: {
          channel: snapshot.channel,
          subject: snapshot.message_subject,
          body: snapshot.message_body,
        },
      },
    };
  }
  function mergeManualSend(target, { queue, delivery }) {
    const index = target.queue?.findIndex(item => item.id === queue.id) ?? -1;
    if (index < 0 || target.queue[index].revision > queue.revision) return;
    target.queue[index] = { ...target.queue[index], ...queue };
    if (Array.isArray(target.deliveries) && !target.deliveries.some(item => item.queue_id === queue.id))
      target.deliveries.push(delivery);
  }
  function applyManualSend(result) {
    mergeManualSend(store, result);
    manualSendsDuringLoad?.set(result.queue.id, result);
    if (activeTab === "invites") manualSendInvitesOpen = true;
  }
  async function saveVersionedRecord(name, args, revision) {
    // Older servers omit this projection. Existing revision-aware records must
    // submit the exact value captured with the original form, even on retry.
    if (args.p_id && typeof revision === "string" && revision)
      args.p_values.expected_revision = revision;
    try {
      return await managementRpc(name, args);
    } catch (error) {
      if (error.code === "P0001" && error.message ===
          "This record changed since you opened it. Refresh to review the latest version.")
        throw Error(T("interface.messages.record_changed_edits_preserved"));
      throw error;
    }
  }
  function languages(current) {
    const list = store.languages.length
      ? store.languages
      : window.RSVP_I18N.languages;
    return list
      .filter((l) => l.enabled !== false || l.language_code === current)
      .sort(
        (a, b) =>
          (a.sort_order || 0) - (b.sort_order || 0) ||
          a.language_code.localeCompare(b.language_code),
      )
      .map((l) => [l.language_code, l.display_name]);
  }
  function planningConfiguration() {
    return store.settings?.planning_config || { groups: [], labels: {} };
  }
  function planningName(names) {
    return window.RSVP_I18N.resolve(names);
  }
  function groupLabel(id) {
    return (
      planningName(
        planningConfiguration().groups.find((group) => group.id === id)?.names,
      ) || id
    );
  }
  function planningLabel(key) {
    return (
      planningName(planningConfiguration().labels[key]) ||
      T("interface.messages." + key)
    );
  }
  function householdGroupOrder(rows) {
    const ids = new Set(rows.map((h) => h.planning_group_id));
    return planningConfiguration()
      .groups.map((group) => group.id)
      .filter((id) => ids.has(id));
  }
  function householdForm(h, contactChoice = null, { formKey = "household:" + (h.id || "new"), afterSave } = {}) {
    const f = managementForm();
    const revision = h.record_revision;
    f.dataset.formKey = formKey;
    f.classList.add("household-details-form");
    const name = field(
      f,
      T("interface.messages.name"),
      h.household_name,
      null,
      "text",
      true,
      140,
    );
    const lastName = field(f, T("interface.messages.last_name"), h.last_name || "", null, "text", false, 140);
    const planningGroup = field(
      f,
      T("Top-level group"),
      h.planning_group_id || planningConfiguration().groups[0]?.id,
      planningConfiguration().groups.map((group) => [
        group.id,
        groupLabel(group.id),
      ]),
    );
    const group = field(
      f,
      T("interface.messages.relation_group"),
      h.relation_group_id,
      [
        ["", T("interface.messages.ungrouped")],
        ...ordered(store.relationGroups, "name")
          .filter(
            (g) =>
              !g.planning_group_id ||
              g.planning_group_id === planningGroup.value,
          )
          .map((g) => [g.id, g.name]),
      ],
    );
    const lang = field(
      f,
      T("interface.messages.household_language"),
      h.language || store.settings?.default_language || "en",
      languages(h.language),
    );
    const parent = field(
      f,
      T("interface.messages.parent_household"),
      h.parent_id,
      [["", T("interface.messages.none_top_level")]],
    );
    function parents() {
      const selected = parent.value || h.parent_id || "";
      parent.replaceChildren(
        R.dom("option", { value: "" }, T("interface.messages.none_top_level")),
      );
      for (const x of ordered(store.households, "household_name").filter(
        (x) =>
          x.id !== h.id &&
          !x.archived_at &&
          x.planning_group_id === planningGroup.value &&
          (x.relation_group_id || "") === group.value &&
          !isDescendantOf(x.id, h.id),
      ))
        parent.append(R.dom("option", { value: x.id }, R.householdName(x)));
      parent.value = [...parent.options].some((o) => o.value === selected)
        ? selected
        : "";
    }
    parents();
    planningGroup.addEventListener("change", () => {
      const previous = group.value;
      group.replaceChildren(
        R.dom("option", { value: "" }, T("interface.messages.ungrouped")),
        ...ordered(store.relationGroups, "name")
          .filter(
            (g) =>
              !g.planning_group_id ||
              g.planning_group_id === planningGroup.value,
          )
          .map((g) => R.dom("option", { value: g.id }, g.name)),
      );
      group.value = [...group.options].some((o) => o.value === previous)
        ? previous
        : "";
      parents();
    });
    group.addEventListener("change", parents);
    const phone = field(
      f,
      T("interface.messages.household_landline"),
      h.phone,
      null,
      "tel",
      false,
      80,
    );
    const address = field(
      f,
      T("interface.messages.postal_address"),
      h.postal_address,
      null,
      "textarea",
      false,
      1000,
    );
    const notes = field(
      f,
      T("interface.messages.household_notes"),
      h.notes,
      null,
      "textarea",
    );
    const allowFood = h.id
      ? field(f, T("food.messages.allow_food"), !!h.food, null, "checkbox")
      : null;
    if (allowFood) {
      const label = allowFood.closest("label");
      label.classList.add("household-food-toggle");
      label.prepend(allowFood);
      f.insertBefore(label, address.closest("label"));
    }
    f.append(
      R.dom(
        "p",
        { class: "micro span-2" },
        h.id
          ? T(
              "interface.messages.grouping_changes_with_child_households_require_moving_the_childre",
            )
          : T(
              "interface.messages.empty_households_have_no_invitation_code_add_a_guest_then_use_man",
            ),
      ),
    );
    const sessions = window.RSVP_ADMIN_HOUSEHOLD_SESSIONS.append(f, h, { R, T, getStore: () => store, ordered, can });
    if (contactChoice) f.append(contactChoice.row);
    return saveForm(
      f,
      h.id
        ? T("Save")
        : T("interface.messages.create_household"),
      () => {
        const args = {
          p_id: h.id || null,
          p_values: {
            household_name: name.value.trim(),
            last_name: lastName.value.trim() || null,
            planning_group_id: planningGroup.value,
            relation_group_id: group.value || null,
            language: lang.value,
            parent_id: parent.value || null,
            phone: phone.value.trim(),
            postal_address: address.value.trim(),
            notes: notes.value.trim(),
          },
        };
        if (sessions.changed()) Object.assign(args.p_values, sessions.read());
        const foodChanged = allowFood && allowFood.checked !== !!h.food;
        const primaryChanged =
          contactChoice &&
          contactChoice.value.value !==
            contactChoice.value.dataset.cleanOriginal;
        if (primaryChanged)
          Object.assign(args.p_values, JSON.parse(contactChoice.value.value));
        if (foodChanged || primaryChanged) {
          return saveVersionedRecord("admin_save_household_with_food", {
            ...args,
            p_food: foodChanged ? allowFood.checked : null,
            p_expected_food: !!h.food,
          }, revision);
        }
        return saveVersionedRecord("admin_save_household", args, revision);
      },
      afterSave,
    );
  }
  function guestManagement(g) {
    const box = R.dom("div", { class: "guest-management edit-only" });
    const panel = R.dom("div", { class: "guest-move-panel edit-only hidden" });
    if (!g.archived_at) {
      const f = managementForm();
      const move = iconAction(
        "move",
        T("interface.messages.move_guest"),
        () => {
          const opening = panel.classList.contains("hidden");
          panel.classList.toggle("hidden", !opening);
          move.setAttribute("aria-expanded", String(opening));
          if (opening) target.focus();
        },
        false,
        "edit-only",
      );
      move.setAttribute("aria-expanded", "false");
      box.append(move);
      const target = field(
        f,
        T("interface.messages.destination_household"),
        "",
        [
          ["", T("interface.messages.choose_household")],
          ...ordered(store.households, "household_name")
            .filter(
              (h) =>
                h.id !== g.household_id &&
                !h.archived_at &&
                h.rsvp_state === "open",
            )
            .map((h) => [h.id, R.householdName(h)]),
        ],
        "text",
        true,
      );
      f.append(
        R.dom(
          "p",
          { class: "micro span-2" },
          T(
            "interface.messages.current_session_invitations_are_preserved_as_individual_overrides",
          ),
        ),
      );
      saveForm(f, T("interface.messages.move_guest"), async () => {
        if (
          !await window.RSVP_INLINE.confirm(T(
              "interface.messages.move_this_guest_and_preserve_their_current_session_invitations",
            ), { action: "Move guest" })
        )
          return false;
        await managementRpc("admin_move_guest", {
          p_guest_id: g.id,
          p_household_id: target.value,
        });
      });
      panel.append(f);
    }
    return { actions: box, form: panel };
  }
  function contactMethodLabel(method) {
    return {
      whatsapp: "WhatsApp",
      sms: "SMS",
      email: T("interface.messages.email"),
      postal: T("interface.messages.postal"),
      manual: T("interface.messages.manual"),
    }[method];
  }
  function householdPrimaryGuest(h) {
    return store.guests.find(
      (g) =>
        g.id === h.primary_guest_id &&
        !g.is_child &&
        !g.archived_at &&
        store.households.some(
          (source) => source.id === g.household_id && !source.archived_at,
        ),
    );
  }
  function householdPrimaryContact(h) {
    return store.contacts.find(
      (c) =>
        c.household_id === h.id && c.is_household_primary && !c.archived_at,
    );
  }
  function primaryContactChannel(contact) {
    const fallback = {
      email: "email",
      phone: "sms",
      postal: "postal",
      other: "manual",
    }[contact.contact_type];
    return contact.contact_type === "phone" &&
      contact.preferred_method === "whatsapp"
      ? "whatsapp"
      : fallback;
  }
  function contactSection(h, primaryGuest, primaryName) {
    const section = R.dom("div", { class: "contact-section" });
    const contacts = store.contacts.filter(
      (c) =>
        c.household_id === h.id &&
        ($("showArchived").checked || !c.archived_at),
    );
    if (!contacts.length && !primaryGuest) return null;
    if (primaryGuest) {
      const method = contactMethodLabel(primaryGuest.preferred_contact_method);
      const primary = R.dom("div", {
        class: "household-primary-contact view-only",
      });
      primary.append(
        R.dom("small", { class: "micro" }, T("Primary household contact")),
        R.dom("strong", {}, primaryName + (method ? " (" + method + ")" : "")),
        householdProfile([
          [T("interface.messages.email"), primaryGuest.email],
          [T("interface.messages.phone"), primaryGuest.phone],
          [T("interface.messages.guest_mobile"), primaryGuest.mobile],
        ]),
      );
      section.append(primary);
    }
    const list = R.dom("div", { class: "contact-list" });
    const types = {
      email: T("interface.messages.email"),
      phone: T("interface.messages.phone"),
      postal: T("interface.messages.postal_address"),
      other: T("interface.messages.other"),
    };
    const methods = {
      whatsapp: "WhatsApp",
      sms: "SMS",
      email: T("interface.messages.email"),
      postal: T("interface.messages.postal"),
      manual: T("interface.messages.manual"),
    };
    for (const c of contacts) {
      const card = R.dom("article", {
        class: "contact-card" + (c.is_household_primary ? " view-only" : ""),
      });
      card.dataset.contactId = c.id;
      const header = R.dom("div", { class: "contact-card-header" });
      const info = R.dom("div", { class: "contact-card-info" });
      const name =
        c.contact_name ||
        types[c.contact_type] ||
        T("interface.messages.contact");
      info.append(
        R.dom("strong", {}, name),
        R.dom("span", { class: "contact-card-value" }, c.contact_value),
      );
      const meta = R.dom("div", { class: "contact-card-meta" });
      meta.append(
        R.dom(
          "span",
          {},
          [
            types[c.contact_type] || c.contact_type,
            methods[c.preferred_method],
            c.language_code?.toUpperCase(),
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      if (c.guest_id) {
        const g = store.guests.find((g) => g.id === c.guest_id);
        const source = store.households.find((h) => h.id === g?.household_id);
        meta.append(
          R.dom(
            "span",
            { class: "tag" },
            T("interface.messages.guest") +
              (source ? " · " + R.householdName(source) : ""),
          ),
        );
      }
      if (c.is_household_primary)
        meta.append(
          R.dom("span", { class: "tag" }, T("Primary household contact")),
        );
      else if (c.is_primary)
        meta.append(
          R.dom("span", { class: "tag" }, T("interface.messages.primary")),
        );
      if (c.archived_at)
        meta.append(
          R.dom("span", { class: "tag" }, T("interface.messages.archived")),
        );
      info.append(meta);
      header.append(info);
      const editor = R.dom("div", { class: "contact-editor edit-only hidden" });
      editor.id = "contact-editor-" + c.id;
      if (!h.archived_at) {
        const actions = R.dom("div", {
          class: "contact-card-actions edit-only",
        });
        if (!c.archived_at) {
          const edit = iconAction(
            "edit",
            T("interface.messages.edit_contact") + name,
            () => {
              const opening = editor.classList.contains("hidden");
              if (opening) {
                editor.replaceChildren(
                  contactForm(h, c, () => {
                    editor.classList.add("hidden");
                    edit.setAttribute("aria-expanded", "false");
                    edit.focus();
                  }),
                );
              }
              editor.classList.toggle("hidden", !opening);
              edit.setAttribute("aria-expanded", String(opening));
              if (opening) editor.querySelector("input")?.focus();
            },
            false,
            "edit-only",
          );
          edit.setAttribute("aria-expanded", "false");
          edit.setAttribute("aria-controls", editor.id);
          actions.append(edit);
        }
        actions.append(archiveButton("household_contacts", c));
        header.append(actions);
      }
      card.append(header, editor);
      list.append(card);
    }
    if (contacts.length) section.append(list);
    return section;
  }
  function validPrimaryDelivery(type, method, value) {
    const detail = value?.trim() || "";
    return (
      (type === "email" &&
        method === "email" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(detail)) ||
      (type === "phone" &&
        ["sms", "whatsapp"].includes(method) &&
        /^\+?[\d .()/-]+$/.test(detail) &&
        detail.replace(/\D/g, "").length >= 5)
    );
  }
  function hasPrimaryGuestDelivery(guest) {
    const method = guest.preferred_contact_method;
    return method === "email"
      ? validPrimaryDelivery("email", method, guest.email)
      : validPrimaryDelivery("phone", method, guest.mobile);
  }
  let contactPickerSequence = 0;
  function contactGuestPicker(h, onSelect) {
    const picker = disclosure(
      T("From guest list"),
      "contact-guest-search primary-picker-section",
    );
    const label = R.dom("label", {}, T("interface.messages.search_guests"));
    const search = R.dom("input", {
      type: "search",
      placeholder: T("interface.messages.guest_name_or_household"),
    });
    search.maxLength = 200;
    search.setAttribute("aria-label", T("interface.messages.search_guests"));
    search.autocomplete = "off";
    const options = R.dom("div", {
      class: "contact-guest-results",
      id: "contact-guest-results-" + ++contactPickerSequence,
    });
    search.setAttribute("aria-controls", options.id);
    label.append(search);
    const hint = R.dom("p", { class: "micro" });
    hint.setAttribute("role", "status");
    picker.append(label, hint, options);
    function guestLabel(g) {
      return (
        [g.first_name, g.last_name].filter(Boolean).join(" ") ||
        T("interface.messages.unnamed_guest")
      );
    }
    function renderResults() {
      const normalize = (value) =>
        String(value)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase()
          .replaceAll("ß", "ss")
          .replaceAll("æ", "ae")
          .replaceAll("ø", "o")
          .replaceAll("ð", "d");
      const query = normalize(search.value.trim());
      const matches = store.guests
        .filter(
          (g) =>
            !g.archived_at &&
            !g.is_child &&
            g.household_id !== h.id &&
            store.households.some(
              (source) => source.id === g.household_id && !source.archived_at,
            ),
        )
        .filter((g) =>
          normalize(
            [
              guestLabel(g),
              R.householdName(store.households.find((source) => source.id === g.household_id)),
            ].join(" "),
          ).includes(query),
        )
        .sort(
          (a, b) =>
            guestLabel(a).localeCompare(guestLabel(b)) ||
            a.id.localeCompare(b.id),
        );
      options.replaceChildren();
      hint.textContent = matches.length
        ? T("interface.messages.showing_count_of_total_matching_guests", {
            count: Math.min(matches.length, 10),
            total: matches.length,
          })
        : T("interface.messages.no_active_guests_match_this_search");
      for (const g of matches.slice(0, 10)) {
        const household = store.households.find(
          (source) => source.id === g.household_id,
        );
        const eligible = hasPrimaryGuestDelivery(g);
        const button = R.dom("button", {
          type: "button",
          class: "contact-guest-option",
          disabled: !eligible,
        });
        button.setAttribute(
          "aria-label",
          T("interface.messages.select_guest") +
            guestLabel(g) +
            " — " +
            R.householdName(household),
        );
        button.append(
          R.dom("strong", {}, guestLabel(g)),
          R.dom("small", {}, R.householdName(household)),
        );
        if (!eligible)
          button.append(
            R.dom("small", {}, T("Matching contact details required")),
          );
        button.addEventListener("click", () => onSelect(g));
        options.append(button);
      }
    }
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        options.querySelector("button:not(:disabled)")?.focus();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        picker.open = false;
        picker.querySelector("summary").focus();
      }
    });
    search.addEventListener("input", renderResults);
    picker.addEventListener("toggle", () => {
      if (picker.open) {
        renderResults();
        search.focus();
      }
    });
    return picker;
  }
  function contactFields(f, h, c, primaryOnly = false) {
    f.classList.add("contact-form");
    const name = field(
      f,
      T("interface.messages.contact_name"),
      c.contact_name,
      null,
      "text",
      false,
      140,
    );
    const type = field(
      f,
      T("interface.messages.contact_type"),
      c.contact_type || "email",
      [
        ["email", T("interface.messages.email")],
        ["phone", T("interface.messages.phone")],
        ...(primaryOnly
          ? []
          : [
              ["postal", T("interface.messages.postal_address")],
              ["other", T("interface.messages.other")],
            ]),
      ],
    );
    const value = field(
      f,
      T("interface.messages.contact_details"),
      c.contact_value,
      null,
      "text",
      true,
      1000,
    );
    value.closest("label").classList.add("span-2");
    const lang = field(
      f,
      T("interface.messages.contact_language"),
      c.language_code,
      [
        ["", T("interface.messages.household_default")],
        ...languages(c.language_code),
      ],
    );
    const method = field(
      f,
      T("interface.messages.preferred_delivery_method"),
      c.preferred_method,
      [
        ["", T("interface.messages.unspecified")],
        ["whatsapp", "WhatsApp"],
        ["sms", "SMS"],
        ["email", T("interface.messages.email")],
        ...(primaryOnly
          ? []
          : [
              ["postal", T("interface.messages.postal")],
              ["manual", T("interface.messages.manual")],
            ]),
      ],
    );
    return () => ({
      guest_id: c.guest_id || null,
      contact_name: name.value.trim(),
      contact_type: type.value,
      contact_value: value.value.trim(),
      language_code: lang.value || null,
      preferred_method: method.value || null,
      is_primary: !!c.is_primary,
    });
  }
  function contactForm(h, c, onCancel = null) {
    const f = managementForm(),
      values = contactFields(f, h, c);
    saveForm(
      f,
      c.id
        ? T("Save")
        : T("interface.messages.create_contact"),
      () =>
        managementRpc("admin_save_contact", {
          p_id: c.id || null,
          p_household_id: h.id,
          p_values: values(),
        }),
    );
    const actions = f.querySelector(".form-actions");
    actions.classList.add("contact-form-actions");
    if (onCancel)
      f.querySelector("[data-discard]").addEventListener("click", onCancel);
    return f;
  }
  function householdContactChoice(h, panelId = "primary-contact-picker-" + h.id) {
    const title = T("Primary household contact"),
      row = R.dom("div", { class: "household-contact-row span-2" });
    const panel = R.dom("div", {
      id: panelId,
      class: "household-primary-picker edit-only hidden",
    });
    const choice = R.dom("input", { type: "hidden" });
    const current = householdPrimaryContact(h);
    const saved = JSON.stringify(
      current
        ? { primary_contact_id: current.id }
        : { primary_guest_id: h.primary_guest_id || null },
    );
    choice.value = saved;
    const guestName = (g) =>
      [g.first_name, g.last_name].filter(Boolean).join(" ") ||
      T("interface.messages.unnamed_guest");
    const contactName = (c) => c.contact_name || c.contact_value;
    function update(next) {
      choice.value = JSON.stringify(next);
      choice.dispatchEvent(new Event("change", { bubbles: true }));
      row.querySelector("button")?.focus({ preventScroll: true });
    }
    function render() {
      const draft = JSON.parse(choice.value);
      const guest = store.guests.find((g) => g.id === draft.primary_guest_id);
      const contact =
        draft.primary_contact ||
        store.contacts.find((c) => c.id === draft.primary_contact_id);
      const name = guest
        ? guestName(guest)
        : contact
          ? contactName(contact)
          : "";
      panel.replaceChildren();
      panel.classList.add("hidden");
      row.replaceChildren(choice, R.dom("strong", {}, title));
      const actions = R.dom("div", { class: "household-primary-actions" });
      if (name) {
        const edit = R.dom(
          "button",
          { type: "button", class: "household-contact-link" },
          T("interface.messages.edit"),
        );
        edit.setAttribute("aria-label", T("Edit primary contact"));
        edit.addEventListener("click", () => open(edit));
        const remove = R.dom(
          "button",
          { type: "button", class: "household-contact-link" },
          T("Remove assignment"),
        );
        remove.setAttribute("aria-label", T("Remove assignment"));
        remove.prepend(actionGlyph("unlink"));
        remove.addEventListener("click", () =>
          update({ primary_guest_id: null }),
        );
        actions.append(R.dom("span", {}, name));
        if (choice.value !== saved)
          actions.append(R.dom("small", { class: "micro" }, T("Unsaved")));
        actions.append(edit, remove);
      } else {
        const add = R.dom(
          "button",
          { type: "button", class: "btn secondary" },
          T("interface.messages.add_contact"),
        );
        add.addEventListener("click", () => open(add));
        actions.append(add);
        if (choice.value !== saved)
          actions.append(R.dom("small", { class: "micro" }, T("Unsaved")));
      }
      const opener = actions.querySelector("button");
      opener.setAttribute("aria-expanded", "false");
      opener.setAttribute("aria-controls", panel.id);
      row.append(actions);
    }
    function open(button) {
      if (!panel.classList.contains("hidden")) {
        render();
        row.querySelector("button")?.focus();
        return;
      }
      button.setAttribute("aria-expanded", "true");
      const draft = JSON.parse(choice.value);
      const selected =
        draft.primary_contact ||
        store.contacts.find((c) => c.id === draft.primary_contact_id) ||
        {};
      const household = disclosure(
        T("From your household"),
        "primary-picker-section",
      );
      const choices = R.dom("div", { class: "contact-guest-results" });
      const members = ordered(
        store.guests.filter(
          (g) => g.household_id === h.id && !g.archived_at && !g.is_child,
        ),
        "first_name",
      );
      const savedContacts = ordered(
        store.contacts.filter((c) => c.household_id === h.id && !c.archived_at),
        "contact_name",
      );
      for (const [name, delivery, next] of [
        ...members.map((g) => [
          guestName(g),
          hasPrimaryGuestDelivery(g)
            ? { preferred_method: g.preferred_contact_method }
            : null,
          { primary_guest_id: g.id },
        ]),
        ...savedContacts.map((c) => [
          contactName(c),
          validPrimaryDelivery(
            c.contact_type,
            c.preferred_method,
            c.contact_value,
          )
            ? c
            : null,
          { primary_contact_id: c.id },
        ]),
      ]) {
        const option = R.dom("button", {
          type: "button",
          class: "contact-guest-option",
          disabled: !delivery,
        });
        option.append(
          R.dom("strong", {}, name),
          R.dom(
            "small",
            {},
            delivery
              ? contactMethodLabel(delivery.preferred_method)
              : T("Matching contact details required"),
          ),
        );
        option.addEventListener("click", () => update(next));
        choices.append(option);
      }
      if (!choices.childElementCount)
        choices.append(
          R.dom(
            "p",
            { class: "micro" },
            T("No household contacts to choose from."),
          ),
        );
      household.append(choices);
      const guests = contactGuestPicker(h, (guest) => {
        if (hasPrimaryGuestDelivery(guest))
          update({ primary_guest_id: guest.id });
      });
      const create = disclosure(T("New contact"), "primary-picker-section");
      const editor = managementForm(),
        values = contactFields(editor, h, selected, true);
      const hint = R.dom(
        "p",
        { class: "micro span-2" },
        T(
          "Use Email with an email address, or SMS or WhatsApp with a phone number.",
        ),
      );
      const use = R.dom(
        "button",
        { type: "submit", class: "btn" },
        T("Use contact"),
      );
      function check() {
        const contact = values();
        use.disabled = !validPrimaryDelivery(
          contact.contact_type,
          contact.preferred_method,
          contact.contact_value,
        );
      }
      editor.append(hint);
      editor.addEventListener("input", check);
      editor.addEventListener("change", check);
      check();
      editor.addEventListener("submit", (event) => {
        event.preventDefault();
        if (use.disabled) return;
        const contact = values();
        if (selected.id) contact.id = selected.id;
        update({ primary_contact: contact });
      });
      const cancel = R.dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("Cancel"),
      );
      cancel.addEventListener("click", () => {
        render();
        row.querySelector("button")?.focus({ preventScroll: true });
      });
      formActions(editor, use, cancel);
      create.append(editor);
      panel.append(household, guests, create);
      panel.classList.remove("hidden");
    }
    choice.addEventListener("change", render);
    render();
    return { row, panel, value: choice };
  }
  const logCategories = {
    households: "Households",
    guests: "Guests",
    contacts: "Contacts",
    rsvp: "RSVP",
    invitations: "Invitations",
    login: "Login",
    venues: "Venues",
    sessions: "Sessions",
    food: "Food access",
    administrators: "Administrators",
  };
  const logActions = {
    add: "Added",
    insert: "Added",
    update: "Updated",
    delete: "Deleted",
    move: "Moved",
    archive: "Archived",
    restore: "Restored",
    assign: "Assigned",
    invitations_changed: "Invitation assignments changed",
    submitted: "interface.messages.log_household_rsvp_submitted",
    reopened: "RSVP reopened",
    late_submission_authorized: "Late response allowed",
    response_submitted: "Guest response submitted",
    response_corrected: "Guest response corrected",
    created: "Delivery created",
    draft: "Draft saved",
    ready: "Ready to send",
    sent: "Recorded sent",
    share_handoff_completed: "Share handoff completed",
    failed: "Failed delivery",
    cancelled: "Cancelled",
    opened: "Invitation opened",
    login: "Sign-in session",
    logout: "Signed out",
    logout_requested: "Sign-out requested",
    email_requested: "Administrator email requested",
    email_sent: "Administrator email accepted by service",
    email_failed: "Administrator email failed",
    invitation_cancelled: "Administrator invitation cancelled",
    invitation_accepted: "Administrator invitation accepted",
    remove: "Access removed",
    rename: "Renamed",
    token_refreshed: "Token refreshed",
  };
  let logEntries = [],
    logCursor = null,
    logAppliedFilters = null,
    logActor = "all",
    logGeneration = 0;
  const logChoiceIds = ["logCategory", "logAction"];
  function logSelected(id) {
    return [...$(id + "Options").querySelectorAll("input:checked")].map((input) => input.value);
  }
  function logActionName(action) {
    return T(Object.hasOwn(logActions, action) ? logActions[action] : action.replaceAll("_", " "));
  }
  function renderLogChoices(id, values, labelFor) {
    const list = $(id + "Options");
    const controls = [...list.querySelectorAll("input")];
    if (values.length === controls.length && values.every((value, i) => controls[i].value === value)) {
      controls.forEach((input) => { input.nextElementSibling.textContent = labelFor(input.value); });
      if (!values.length) list.textContent = T("interface.messages.no_log_entries_match_these_filters");
      return;
    }
    const selected = new Set(logSelected(id));
    const focused = list.contains(document.activeElement) ? document.activeElement.value : null;
    const choices = values.map((value) => {
      const label = R.dom("label");
      const input = R.dom("input", { type: "checkbox", value });
      input.checked = selected.has(value);
      label.append(input, R.dom("span", {}, labelFor(value)));
      return label;
    });
    list.replaceChildren(...choices);
    if (!values.length) list.textContent = T("interface.messages.no_log_entries_match_these_filters");
    if (focused != null)
      (choices.find((choice) => choice.firstElementChild.value === focused)?.firstElementChild || $(id).querySelector("summary"))
        .focus({ preventScroll: true });
  }
  function renderLogFilterCaptions() {
    const actor = logActor === "guest" ? T("interface.messages.log_guest_activity")
      : logActor === "admin" ? T("interface.messages.log_admin_activity") : "";
    for (const [id, names, scope, all] of [
      ["logCategory", logSelected("logCategory").map((value) => T(logCategories[value])), actor, "interface.messages.all_categories"],
      ["logAction", logSelected("logAction").map(logActionName), "", "interface.messages.all_actions"],
    ]) {
      const caption = $(id + "Caption");
      const selection = names.length > 2 ? T("interface.messages.invites_count_selected", { count: names.length }) : names.join(", ");
      caption.textContent = [scope, selection].filter(Boolean).join(" · ") || T(all);
      caption.title = [scope, names.join(", ")].filter(Boolean).join(" · ");
    }
    for (const button of $("logActorChoices").querySelectorAll("button"))
      button.setAttribute("aria-pressed", String(button.dataset.logActor === logActor));
  }
  function resetLogChoices(actor = "all") {
    logActor = actor;
    for (const id of logChoiceIds)
      for (const input of $(id + "Options").querySelectorAll("input")) input.checked = false;
    renderLogFilterCaptions();
  }
  function logDateBoundary(value, next = false) {
    if (!value) return null;
    let date = value;
    if (next) {
      const d = new Date(value + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      date = d.toISOString().slice(0, 10);
    }
    return R.zonedInstant(
      date + "T00:00",
      store.settings?.timezone || "Atlantic/Faroe",
    );
  }
  function formatLogValue(value) {
    return value == null
      ? "—"
      : typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : String(value);
  }
  const logDetailLabels = {
    before: "interface.messages.before",
    after: "interface.messages.after",
    session: "interface.messages.session",
    reason: "interface.messages.log_reason",
    submission_id: "interface.messages.log_submission_id",
  };
  const logTechnicalFields = new Set(["entity", "subject_id", "submission_id"]);
  const logAttendance = {
    attending: "interface.messages.attending",
    declined: "interface.messages.not_attending",
    pending: "interface.messages.pending",
  };
  function logResponse(value) {
    return Object.hasOwn(logAttendance, value) ? T(logAttendance[value]) : value;
  }
  function logSummary(entry, details) {
    const { category, action, subject, household_name: household } = entry;
    const actionLabel = logActions[action] || action.replaceAll("_", " ");
    const isHouseholdRsvp = category === "rsvp" && subject === "Household RSVP";
    if (category === "rsvp" && action === "response_submitted") {
      return {
        title: subject || T("interface.messages.unnamed_guest"),
        context: [logResponse(details.after), details.session].filter(Boolean).join(" · "),
        category,
      };
    }
    const primarySubject = isHouseholdRsvp || subject === actionLabel || subject === details.entity
      ? null : subject;
    const context = category === "rsvp" && action === "response_corrected"
      ? [subject, details.session]
      : [primarySubject, household];
    return {
      title: T(actionLabel),
      context: [...new Set(context.filter(Boolean))].join(" · "),
      category: isHouseholdRsvp || (category === "invitations" && action === "opened") ? null : category,
    };
  }
  function appendLogDetail(container, label, value) {
    if (value == null) return;
    const row = R.dom("div", { class: "log-detail-value" });
    row.append(R.dom("strong", {}, label), R.dom("pre", {}, formatLogValue(value)));
    container.append(row);
  }
  function logFieldName(key) {
    return Object.hasOwn(logDetailLabels, key)
      ? T(logDetailLabels[key])
      : key.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
  }
  function renderLogDetails(entry, details, timestamp) {
    const content = R.dom("div", { class: "log-details" });
    const technical = R.dom("details", { class: "log-technical" });
    technical.append(R.dom("summary", {}, T("interface.messages.log_technical_details")));
    appendLogDetail(technical, T("interface.messages.log_event_reference"), entry.event_key);
    appendLogDetail(technical, T("interface.messages.log_timestamp_utc"), timestamp);
    for (const key of logTechnicalFields) appendLogDetail(technical, logFieldName(key), details[key]);

    if (entry.category === "rsvp" && entry.action === "submitted") {
      content.append(R.dom("p", { class: "log-detail-note" }, T("interface.messages.locked_after_submission")));
      appendLogDetail(content, logFieldName("reason"), details.reason);
    } else if (entry.category === "rsvp" && ["response_submitted", "response_corrected"].includes(entry.action)) {
      if (entry.household_name && entry.household_name !== entry.subject)
        appendLogDetail(content, T("interface.messages.household"), entry.household_name);
      appendLogDetail(content, logFieldName("before"), logResponse(details.before));
      if (entry.action === "response_corrected")
        appendLogDetail(content, logFieldName("after"), logResponse(details.after));
      appendLogDetail(content, logFieldName("reason"), details.reason);
    } else if (entry.category === "invitations" && entry.action === "opened" && details.recording) {
      content.append(R.dom("p", { class: "log-detail-note" }, T("interface.messages.log_invitation_open_recording")));
    } else if (details.before && typeof details.before === "object" && details.after && typeof details.after === "object") {
      const keys = [...new Set([...Object.keys(details.before), ...Object.keys(details.after)])]
        .filter((key) => JSON.stringify(details.before[key]) !== JSON.stringify(details.after[key]));
      if (keys.length) content.append(makeTable(
        [T("interface.messages.field"), T("interface.messages.before"), T("interface.messages.after")],
        keys.map((key) => [logFieldName(key), formatLogValue(details.before[key]), formatLogValue(details.after[key])]),
      ));
    } else {
      for (const [key, value] of Object.entries(details)) {
        if (!logTechnicalFields.has(key)) appendLogDetail(content, logFieldName(key), value);
      }
    }
    content.append(technical);
    return content;
  }
  function renderLogs() {
    const box = $("logRows");
    box.replaceChildren();
    for (const e of logEntries) {
      const d = R.dom("details", { class: "log-entry" });
      const summary = R.dom("summary");
      const date = new Date(e.occurred_at);
      const timestamp = date.toISOString();
      const details = e.details || {};
      const activity = logSummary(e, details);
      const time = R.dom(
        "time",
        {},
        window.RSVP_ADMIN_PREFERENCES.formatDate(
          date,
          window.RSVP_I18N?.language || "en",
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          { timeStyle: "medium" },
        ),
      );
      time.dateTime = timestamp;
      const subject = R.dom("span", { class: "log-subject" });
      subject.append(R.dom("strong", {}, activity.title));
      if (activity.context) subject.append(R.dom("small", { class: "muted" }, activity.context));
      summary.append(time, subject);
      if (activity.category) {
        const kind = R.dom("span", { class: "log-kind" });
        kind.append(R.dom("span", { class: "tag" }, T(logCategories[activity.category] || activity.category)));
        summary.append(kind);
      }
      if (e.actor && (e.actor_user_id || !["Guest", "Guest / system"].includes(e.actor)))
        summary.append(R.dom("span", { class: "log-actor" }, e.actor));
      d.append(summary, renderLogDetails(e, details, timestamp));
      box.append(d);
    }
    if (!logEntries.length)
      box.append(
        R.dom(
          "p",
          { class: "muted" },
          T("interface.messages.no_log_entries_match_these_filters"),
        ),
      );
    $("logCount").textContent = T(
      "interface.messages.count_entries_shown_newest_first",
      { count: logEntries.length },
    );
  }
  async function loadLogs(reset = true) {
    if (reset && !$("logFilters").reportValidity()) return;
    renderLogChoices("logCategory", Object.keys(logCategories), (value) => T(logCategories[value]));
    renderLogFilterCaptions();
    const generation = ++logGeneration;
    $("logMore").disabled = true;
    $("logApply").disabled = true;
    $("logStatus").textContent = T("interface.messages.loading_logs");
    try {
      const filters = reset ? {
        p_search: $("logSearch").value.trim(),
        p_categories: logSelected("logCategory"),
        p_actions: logSelected("logAction"),
        p_actor: logActor,
        p_from: logDateBoundary(window.RSVP_ADMIN_LOG_DATES.isoValue($("logFrom"))),
        p_to: logDateBoundary(window.RSVP_ADMIN_LOG_DATES.isoValue($("logTo")), true),
      } : logAppliedFilters;
      if (!filters) return;
      const { data, error } = await R.adminRpc("admin_query_logs_filtered", {
        ...filters,
        p_before_at: reset ? null : logCursor?.occurred_at || null,
        p_before_key: reset ? null : logCursor?.event_key || null,
        p_limit: 50,
      });
      if (error) throw error;
      if (generation !== logGeneration) return;
      const incoming = data?.entries || [];
      logEntries = reset ? incoming : [...logEntries, ...incoming];
      logCursor = logEntries.at(-1) || null;
      logAppliedFilters = filters;
      renderLogs();
      const actions = [...new Set([...(data?.actions || []), ...logSelected("logAction")])];
      renderLogChoices("logAction", actions, logActionName);
      $("logMore").classList.toggle("hidden", !data?.has_more);
      $("logStatus").textContent = "";
    } catch (error) {
      if (generation !== logGeneration) return;
      $("logStatus").textContent = R.safeError(error);
      if (reset) {
        logEntries = [];
        logAppliedFilters = null;
        renderLogs();
      }
      $("logMore").classList.add("hidden");
    } finally {
      if (generation === logGeneration) {
        $("logMore").disabled = false;
        $("logApply").disabled = false;
      }
    }
  }

  document.addEventListener("rsvp:time-format", () => {
    window.RSVP_ADMIN_PREFERENCES.refreshDatePickers($("adminApp"));
    if (logEntries.length) renderLogs();
    if (!localEditors.hasUnsaved()) renderAll();
  });
  function adminTime(value) {
    return value
      ? window.RSVP_ADMIN_PREFERENCES.formatDate(
          value,
          window.RSVP_I18N?.language || "en",
          store.settings?.timezone || "Atlantic/Faroe",
        )
      : "—";
  }
  function actorName(id) {
    return (
      store.admins.find((a) => a.user_id === id)?.name ||
      T("interface.messages.administrator")
    );
  }
  function rsvpSection(h) {
    const d = disclosure(
      T("interface.messages.rsvp_management"),
      "feature-section",
    );
    const zone = store.settings?.timezone || "Atlantic/Faroe";
    d.append(
      R.dom(
        "p",
        { class: "small" },
        `${h.rsvp_state === "locked" ? T("interface.messages.locked_after_submission") : T("interface.messages.open_for_responses")}${h.rsvp_submitted_at ? T("interface.messages.last_submission_time", { time: adminTime(h.rsvp_submitted_at) }) : ""}`,
      ),
    );
    d.append(
      R.dom(
        "p",
        { class: "micro" },
        T(
          "interface.messages.event_deadline_deadline_late_response_permission_late_zone",
          {
            deadline: adminTime(store.settings?.rsvp_deadline),
            late: adminTime(h.late_submission_until),
            zone,
          },
        ),
      ),
    );
    const latest = store.submissions.find(
      (x) => x.id === h.latest_rsvp_submission_id,
    );
    if (latest?.comment) {
      const note = R.dom("div", {
        class: "rsvp-comment-preview admin-rsvp-comment",
      });
      note.append(
        R.dom("strong", {}, T("Comment")),
        R.dom("p", {}, latest.comment),
      );
      d.append(note);
    }
    const rows = [];
    for (const g of store.guests.filter(
      (g) => g.household_id === h.id && !g.archived_at,
    ))
      for (const s of ordered(store.sessions, "name").filter(
        (s) => s.is_active && s.requires_rsvp,
      )) {
        const override = store.overrides.find(
          (o) => o.guest_id === g.id && o.session_id === s.id,
        );
        const invited = override
          ? override.is_invited
          : store.defaults.find(
              (x) => x.household_id === h.id && x.session_id === s.id,
            )?.is_invited;
        if (!invited) continue;
        const current =
          store.responses.find(
            (r) => r.guest_id === g.id && r.session_id === s.id,
          )?.rsvp_status || "pending";
        const name = [g.first_name, g.last_name].filter(Boolean).join(" ");
        rows.push([
          name,
          s.name,
          {
            attending: T("interface.messages.attending"),
            declined: T("interface.messages.not_attending"),
            pending: T("interface.messages.pending"),
          }[current] || current,
        ]);
        if (!h.archived_at) {
          const editor = disclosure(
            T("interface.messages.correct_response") + name + " · " + s.name,
            "edit-only",
          );
          const f = managementForm();
          const status = field(
            f,
            T("interface.messages.corrected_response"),
            current === "pending" ? "" : current,
            [
              ["", T("interface.messages.choose_response")],
              ["attending", T("interface.messages.attending")],
              ["declined", T("interface.messages.not_attending")],
            ],
            "text",
            true,
          );
          const reason = field(
            f,
            T("interface.messages.reason_for_rsvp_correction"),
            "",
            null,
            "textarea",
            true,
            2000,
          );
          f.append(
            R.dom(
              "p",
              { class: "micro span-2" },
              T(
                "interface.messages.this_updates_the_current_response_and_records_the_reason_the_orig",
              ),
            ),
          );
          editor.append(
            saveForm(f, T("interface.messages.save_correction"), () =>
              managementRpc("admin_correct_rsvp", {
                p_guest_id: g.id,
                p_session_id: s.id,
                p_status: status.value,
                p_reason: reason.value.trim(),
              }),
            ),
          );
          d.append(editor);
        }
      }
    const table = makeTable(
      [
        T("interface.messages.guest"),
        T("interface.messages.session"),
        T("interface.messages.current_response"),
      ],
      rows,
    );
    table.classList.add("rsvp-current-responses");
    d.insertBefore(table, d.children[2] || null);
    if (!rows.length)
      d.append(
        R.dom(
          "p",
          { class: "micro" },
          T(
            "interface.messages.no_active_rsvp_sessions_are_assigned_to_this_household",
          ),
        ),
      );
    if (!h.archived_at) {
      if (h.rsvp_state === "locked") {
        const f = managementForm();
        const reason = field(
          f,
          T("interface.messages.reason_for_reopening"),
          "",
          null,
          "textarea",
          true,
          2000,
        );
        f.append(
          R.dom(
            "p",
            { class: "micro span-2" },
            T(
              "interface.messages.reopening_lets_the_household_submit_again_previous_submissions_re",
            ),
          ),
        );
        d.append(
          saveForm(f, T("interface.messages.reopen_rsvp"), async () => {
            if (
              !await window.RSVP_INLINE.confirm(T(
                  "interface.messages.reopen_this_household_s_rsvp_while_preserving_its_submission_hist",
                ), { action: "Reopen RSVP" })
            )
              return false;
            return managementRpc("admin_reopen_household_rsvp", {
              p_household_id: h.id,
              p_reason: reason.value.trim(),
            });
          }),
        );
      } else {
        const late = disclosure(
          T("interface.messages.allow_a_late_response"),
          "edit-only",
        );
        const f = managementForm();
        const until = field(
          f,
          T("interface.messages.allow_responses_until") + zone + ")",
          R.zonedInput(h.late_submission_until, zone),
          null,
          "datetime-local",
          true,
        );
        const reason = field(
          f,
          T("interface.messages.reason_for_late_response"),
          "",
          null,
          "textarea",
          true,
          2000,
        );
        late.append(
          saveForm(f, T("interface.messages.allow_late_response"), () =>
            managementRpc("admin_authorize_late_rsvp", {
              p_household_id: h.id,
              p_until: R.zonedInstant(until.value, zone),
              p_reason: reason.value.trim(),
            }),
          ),
        );
        d.append(late);
      }
    }
    return d;
  }
  const { draft: invitationDraft, render: renderInvitationTemplates } =
    window.RSVP_ADMIN_INVITATION_TEMPLATES.create({
      R,
      T,
      getStore: () => store,
      can,
      languages,
      disclosure,
      expandedGroups,
      row,
      managementForm,
      field,
      saveForm,
      managementRpc,
      show,
      reload,
    });
  const {
    section: deliverySection,
    invitationSection,
    saveReady: saveReadyDelivery,
  } = window.RSVP_ADMIN_DELIVERY_RECORD.create({
    R,
    T,
    getStore: () => store,
    disclosure,
    adminTime,
    show,
    can,
    managementRpc,
    householdPrimaryContact,
    householdPrimaryGuest,
    primaryContactChannel,
    managementForm,
    saveForm,
    invitationDraft,
    actorName,
    field,
    reload,
    changeToDraft: (household, record) => bulkInvitesView.changeToDraft(household, record),
    viewInInvites: (householdId) => {
      tab("invites");
      invitesView.openHousehold(householdId);
    },
  });
  function householdSummary(h, guests, primaryGuest) {
    const active = guests.filter((g) => !g.archived_at).length;
    const descendants = store.households.filter(
      (x) => !x.archived_at && isDescendantOf(x.id, h.id),
    );
    const nestedGuests = store.guests.filter(
      (g) => !g.archived_at && descendants.some((x) => x.id === g.household_id),
    ).length;
    return [
      active
        ? T(active === 1 ? "{count} guest" : "{count} guests", {
            count: active,
          })
        : null,
      descendants.length || !active
        ? T(
            descendants.length === 1
              ? "{count} sub-household"
              : "{count} sub-households",
            { count: descendants.length },
          ) +
          " · " +
          T(
            nestedGuests === 1
              ? "{count} guest in sub-households"
              : "{count} guests in sub-households",
            { count: nestedGuests },
          )
        : null,
      h.language?.toUpperCase(),
      h.archived_at
        ? T("interface.messages.archived")
        : active
          ? primaryGuest
            ? null
            : T("interface.messages.missing_contact")
          : T("interface.messages.grouping_household"),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  function invitationOverview(h, sessionId, overviewStore = store) {
    const primary = householdPrimaryContact(h);
    return window.RSVP_ADMIN_OVERVIEW.invitationOverview(overviewStore, h, {
      primary,
      guest: householdPrimaryGuest(h),
      contactChannel: primary ? primaryContactChannel(primary) : null,
      sessionId,
    });
  }
  function editableInvitedHousehold(householdId) {
    if (store.settings?.is_published || !can("invites") || !can("households", "edit")) return null;
    return store.households.find(item => item.id === householdId && !item.archived_at);
  }
  function editHouseholdFromInvites(householdId, trigger) {
    const key = "invites-household-details", actor = user;
    const household = editableInvitedHousehold(householdId);
    if (!household || !trigger.isConnected || window.RSVP_POPUPS.get(key)) return;
    const dialog = window.RSVP_POPUPS.create(key, { class: "household-details-dialog" }, trigger);
    dialog.dataset.householdId = householdId;
    const title = T("interface.messages.household_details") + " · " + R.householdName(household);
    const heading = R.dom("h2", { id: key + "-heading" }, title);
    dialog.setAttribute("aria-labelledby", heading.id);
    const choice = householdContactChoice(household, "invite-primary-contact-picker-" + householdId);
    const form = householdForm(household, choice, {
      formKey: key + ":" + householdId,
      afterSave: () => { if (dialog.open) dialog.close(); },
    });
    form.id = key + "-form";
    form.saveActions.querySelector('button[type="submit"]').setAttribute("form", form.id);
    form.saveActions.querySelector("[data-discard]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      for (const editor of dialog.querySelectorAll("form")) window.RSVP_I18N.markClean(editor);
      if (trigger.isConnected || activeTab !== "invites" || !currentActor(actor)) return;
      // Saving reloads the list. Find the replacement for the old dialog trigger.
      const row = $("inviteRows").querySelector('[data-invite-household="' + CSS.escape(householdId) + '"]');
      const focus = [row?.querySelector(".invite-edit-household:enabled"), row?.querySelector(".invite-preview"),
        row?.querySelector(":scope > summary"), $("inviteShownFieldsHost").querySelector("summary")]
        .find(control => control?.getClientRects().length);
      focus?.focus({ preventScroll: true });
    });
    dialog.append(heading, form, choice.panel, form.saveActions);
    $("adminApp").append(dialog);
    dialog.openInline();
    form.querySelector("input")?.focus({ preventScroll: true });
  }
  const invitesView = window.RSVP_ADMIN_INVITES.create({
    R,
    T,
    getStore: () => store,
    getOverviewStore,
    getActor: () => user?.id || null,
    getSelectionControl: id => bulkInvitesView.selectionControl(id),
    getSelectAllControl: () => bulkInvitesView.selectAllControl(),
    clearSelection: () => bulkInvitesView.clearSelection({ focus: false }),
    getSentState: id => bulkInvitesView.sentState(id),
    retrySent: id => bulkInvitesView.retrySent(id),
    onVisibleHouseholds: ids => { bulkInvitesView.syncVisible(ids); bulkInvitesView.render(); },
    ordered,
    invitationOverview,
    planningConfiguration,
    groupLabel,
    languages,
    canPreviewGuest: () => A.canPreviewGuest(),
    can,
    iconAction,
    editHousehold: editHouseholdFromInvites,
    setDisclosure,
    rememberDisclosure: (key, open) => expandedGroups.set(key, open),
    deliverySection,
    invitationSection,
    managementRpc,
    rsvpSection,
    householdFacts: h => shortcutsView.householdFacts(h),
    adminTime,
    show,
  });
  function shortcutApiBase() {
    try {
      const backend = new URL(R.config().supabaseUrl);
      if (backend.protocol !== "https:" || backend.username || backend.password || backend.search || backend.hash || !["", "/"].includes(backend.pathname)) return null;
      return backend.origin + "/functions/v1/invitation-shortcuts";
    } catch (_) { return null; }
  }
  const shortcutsView = window.RSVP_ADMIN_SHORTCUTS.create({
    R,
    T,
    getStore: () => store,
    getActor: () => user?.id || null,
    can,
    managementRpc,
    reload,
    adminTime,
    show,
    apiBase: shortcutApiBase,
    isSecure: () => window.isSecureContext && Boolean(shortcutApiBase()),
    confirm: (message, trigger) => window.RSVP_INLINE.confirm(message, { trigger }),
  });
  const bulkInvitesView = window.RSVP_ADMIN_BULK_INVITES.create({
    R, T, getStore: () => store, getActor: () => signingOut ? null : user?.id || null, can, managementRpc,
    saveReady: saveReadyDelivery,
    reload: () => reload({ showFeedback: false }),
    readManualSend, applyManualSend,
    onManualSendChange: (ids, options) => invitesView.refreshSentRows(ids, options),
    primaryContact: householdPrimaryContact, primaryGuest: householdPrimaryGuest, invitationDraft,
    getVisibleHouseholdIds: () => invitesView.getVisibleHouseholdIds(),
    onSelectionChange: () => invitesView.render(),
  });
  const compactRead = window.RSVP_ADMIN_READ_SUMMARIES.create({ R, T, getStore: () => store, adminTime, planningName });
  const transportSecurity = window.RSVP_TRANSPORT_SECURITY?.create(
    document.querySelector('[data-transport-security="settings"]'),
    {
      T,
      getActor: () => can("settings") ? user?.id || null : null,
      canEdit: () => can("settings", "edit"),
      getToken: async () => (await db?.auth.getSession())?.data?.session?.access_token,
      saved: form => localEditors.saved(form),
      cancelled: form => localEditors.cancel(form),
    },
  );
  const experimentalView = window.RSVP_ADMIN_EXPERIMENTAL.create({
    R, T, getStore: () => store, getActor: () => user?.id || null, can,
    managementRpc, reload, show,
    onChange: () => { shortcutsView.clear(); shortcutsView.render(); },
    saved: form => localEditors.saved(form),
    cancelled: form => localEditors.cancel(form),
  });
  const databaseView = window.RSVP_ADMIN_DATABASE.create({
    R, T, getStore: () => store, getActor: () => user?.id || null,
    can, rpc: managementRpc, adminTime, onMessage: show,
    confirm: window.RSVP_INLINE.confirmIrreversible,
    downloadSafetyBackup: (...args) => window.RSVP_ADMIN_TOOLS.downloadSafetyBackup(...args),
    reload: () => returnToInvitesAfterDatabaseChange("Application data cleared. The event is unpublished."),
    signOut: async () => {
      window.RSVP_ADMIN_TOOLS.completeDatabaseChange();
      const result = await db.auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
      A.clear(); user = null;
      shortcutsView.clear(); bulkInvitesView.clear(); transportSecurity?.clear(); experimentalView.clear(); databaseView.clear();
      location.replace(new URL("setup.html", R.siteRoot));
      return true;
    },
  });
  function renderInvitationHierarchy(
    list,
    tree,
    visible,
    drawRow,
    scope,
    forceOpen = false,
  ) {
    for (const groupKey of householdGroupOrder(tree)) {
      const groupHouseholds = tree.filter(
        (h) => h.planning_group_id === groupKey,
      );
      if (!groupHouseholds.some((h) => visible.has(h.id))) continue;
      const groupSection = R.dom("details", {
        class: "hierarchy-section tree-disclosure",
      });
      if (scope)
        setDisclosure(
          groupSection,
          scope + ":planning-group:" + groupKey,
          true,
          forceOpen,
        );
      else groupSection.open = true;
      groupSection.append(
        R.dom(
          "summary",
          { class: "tree-planning-group" },
          groupLabel(groupKey),
        ),
      );
      const groupBody = R.dom("div", { class: "tree-children" });
      groupSection.append(groupBody);
      list.append(groupSection);
      const groups = [
        ...new Set(groupHouseholds.map((h) => h.relation_group_id || "")),
      ].sort((a, b) => {
        const ar = store.relationGroups.find((g) => g.id === a),
          br = store.relationGroups.find((g) => g.id === b);
        return (
          (ar?.sort_order || 0) - (br?.sort_order || 0) ||
          (ar?.name || "").localeCompare(br?.name || "")
        );
      });
      for (const gid of groups) {
        const members = groupHouseholds.filter(
          (h) => (h.relation_group_id || "") === gid,
        );
        if (!members.some((h) => visible.has(h.id))) continue;
        const group = R.dom("details", {
          class: "hierarchy-group tree-disclosure",
        });
        if (scope)
          setDisclosure(
            group,
            scope + ":group:" + groupKey + ":" + gid,
            true,
            forceOpen,
          );
        else group.open = true;
        group.append(
          R.dom(
            "summary",
            { class: "tree-group" },
            householdGroupName(members[0]),
          ),
        );
        const body = R.dom("div", { class: "tree-children" });
        group.append(body);
        groupBody.append(group);
        const visited = new Set();
        function draw(h, parent) {
          if (visited.has(h.id) || !visible.has(h.id)) return;
          visited.add(h.id);
          drawRow(h, parent);
          const children = ordered(
            members.filter((c) => c.parent_id === h.id && c.id !== h.id),
            "household_name",
          );
          if (children.some((c) => visible.has(c.id))) {
            const nested = R.dom("div", {
              class: "tree-children invite-nested-rows",
            });
            parent.append(nested);
            children.forEach((c) => draw(c, nested));
          }
        }
        ordered(
          members.filter((h) => !members.some((p) => p.id === h.parent_id)),
          "household_name",
        ).forEach((h) => draw(h, body));
        ordered(members, "household_name").forEach((h) => draw(h, body));
      }
    }
  }
  function householdProfile(fields) {
    const profile = R.dom("dl", {
      class: "household-profile-summary compact-household-profile",
    });
    for (const [label, value, width] of fields) {
      if (!value?.trim()) continue;
      const field = R.dom("div", {
        class: "household-profile-field" + (width ? " profile-wide" : ""),
      });
      field.append(R.dom("dt", {}, label), R.dom("dd", {}, value));
      profile.append(field);
    }
    return profile;
  }
  function openHierarchyEditor(host, key, label, value, save) {
    host.closest("details").open = true;
    let form = [...host.children].find((n) => n.dataset.formKey === key);
    if (form) {
      form.querySelector("input")?.focus();
      return;
    }
    form = managementForm();
    form.classList.add("hierarchy-inline-editor");
    form.dataset.formKey = key;
    const input = field(form, label, value, null, "text", true, 140);
    saveForm(form, T("interface.messages.save"), () =>
      save(input.value.trim()),
    );
    if (host.lifecycleButton && !key.includes(":new:"))
      footerAction(form, host.lifecycleButton);
    form
      .querySelector("[data-discard]")
      ?.addEventListener("click", () => form.remove());
    host.prepend(form);
    input.focus();
  }
  function renderHouseholds() {
    const box = $("householdRows");
    box.replaceChildren();
    const search = $("householdSearch").value.trim().toLowerCase();
    const all = store.households.filter(
      (h) => $("showArchived").checked || !h.archived_at,
    );
    const byId = new Map(all.map((h) => [h.id, h]));
    const matched = new Set(
      all
        .filter((h) => {
          const guests = store.guests.filter((g) => g.household_id === h.id);
          return [
            R.householdName(h),
            h.language,
            ...guests.map((g) => [g.first_name, g.last_name].join(" ")),
          ]
            .join(" ")
            .toLowerCase()
            .includes(search);
        })
        .map((h) => h.id),
    );
    const visible = new Set(matched);
    if (search)
      for (const id of matched) {
        let h = byId.get(id);
        const seen = new Set();
        while (h?.parent_id && !seen.has(h.id)) {
          seen.add(h.id);
          visible.add(h.parent_id);
          h = byId.get(h.parent_id);
        }
      }
    for (const [
      topIndex,
      topGroup,
    ] of planningConfiguration().groups.entries()) {
      const groupKey = topGroup.id;
      const groupHouseholds = all.filter(
        (h) => h.planning_group_id === groupKey,
      );
      if (search && !groupHouseholds.some((h) => visible.has(h.id))) continue;
      const label = groupLabel(groupKey);
      const groupSection = R.dom("details", {
        class: "hierarchy-section tree-disclosure",
      });
      groupSection.dataset.treeKey = "planning-group:" + groupKey;
      setDisclosure(groupSection, groupSection.dataset.treeKey, true, !!search);
      const heading = R.dom("summary", { class: "tree-planning-group" });
      heading.append(
        R.dom("span", {}, label),
        R.dom(
          "small",
          { class: "tree-count" },
          T("interface.messages.count_households", {
            count: groupHouseholds.length,
          }),
        ),
      );
      groupSection.append(heading);
      const planningGroupBody = R.dom("div", { class: "tree-children" });
      const topActions = R.dom("span", {
        class: "hierarchy-actions edit-only",
      });
      heading.append(topActions);
      const savePlanning = (config) =>
        managementRpc("admin_save_planning_configuration", {
          p_config: config,
          p_expected_config: store.settings.planning_config,
          p_preset: store.settings.event_type,
          p_expected_preset: store.settings.event_type,
        });
      if (can("settings", "edit")) {
        for (const direction of [-1, 1])
          topActions.append(
            iconAction(
              direction < 0 ? "up" : "down",
              T(direction < 0 ? "Move group up" : "Move group down"),
              async () => {
                const config = structuredClone(planningConfiguration());
                const next = topIndex + direction;
                [config.groups[topIndex], config.groups[next]] = [
                  config.groups[next],
                  config.groups[topIndex],
                ];
                await savePlanning(config);
                await reload();
              },
              topIndex + direction < 0 ||
                topIndex + direction >= planningConfiguration().groups.length,
              "edit-only",
            ),
          );
        topActions.append(
          iconAction(
            "edit",
            T("Edit group"),
            () =>
              openHierarchyEditor(
                planningGroupBody,
                "top:" + groupKey,
                T("Top-level group"),
                groupLabel(groupKey),
                async (name) => {
                  const config = structuredClone(planningConfiguration());
                  config.groups.find((g) => g.id === groupKey).names[
                    window.RSVP_I18N.language || "en"
                  ] = name;
                  await savePlanning(config);
                },
              ),
            false,
            "edit-only",
          ),
        );
        topActions.append(
          iconAction(
            "delete",
            T("Delete group"),
            async () => {
              if (
                planningConfiguration().groups.length <= 1 ||
                store.households.some(
                  (h) => h.planning_group_id === groupKey,
                ) ||
                store.relationGroups.some(
                  (g) => g.planning_group_id === groupKey,
                )
              ) {
                show(T("interface.messages.group_not_empty"), "error");
                return;
              }
              if (!await window.RSVP_INLINE.confirm(T("Permanently delete {name}?", { name: label }), { action: "Delete" }))
                return;
              const config = structuredClone(planningConfiguration());
              config.groups = config.groups.filter((g) => g.id !== groupKey);
              await savePlanning(config);
              await reload();
            },
            false,
            "edit-only danger",
          ),
        );
        planningGroupBody.lifecycleButton = topActions.lastElementChild;
        planningGroupBody.lifecycleButton.remove();
      }
      if (can("households", "edit"))
        topActions.insertBefore(
          iconAction(
            "add",
            T("interface.messages.add_relation_group"),
            () =>
              openHierarchyEditor(
                planningGroupBody,
                "relation:new:" + groupKey,
                T("interface.messages.relation_group"),
                "",
                (name) =>
                  managementRpc("admin_manage_relation_group", {
                    p_action: "save",
                    p_name: name,
                    p_planning_group_id: groupKey,
                  }),
              ),
            false,
            "edit-only",
          ),
          topActions.querySelector('[aria-label="' + T("Edit group") + '"]'),
        );
      const groups = R.relationGroupOrder(
        groupKey,
        groupHouseholds,
        store.relationGroups,
      );
      for (const groupId of groups) {
        const members = groupHouseholds.filter(
          (h) => (h.relation_group_id || "") === groupId,
        );
        const visibleMembers = members.filter((h) => visible.has(h.id));
        if (search && !visibleMembers.length) continue;
        const groupBox = R.dom("details", {
          class: "hierarchy-group tree-disclosure",
        });
        groupBox.dataset.treeKey = "group:" + groupKey + ":" + groupId;
        groupBox.dataset.relationGroupId = groupId;
        setDisclosure(groupBox, groupBox.dataset.treeKey, true, !!search);
        const groupTitle = R.dom("summary", { class: "tree-group" });
        groupTitle.append(
          R.dom(
            "span",
            {},
            store.relationGroups.find((g) => g.id === groupId)?.name ||
              T("interface.messages.ungrouped"),
          ),
          R.dom(
            "small",
            { class: "tree-count" },
            T("interface.messages.count_households", { count: members.length }),
          ),
        );
        groupBox.append(groupTitle);
        const groupBody = R.dom("div", { class: "tree-children" });
        const relation = store.relationGroups.find((g) => g.id === groupId),
          groupActions = R.dom("span", {
            class: "hierarchy-actions edit-only",
          });
        groupTitle.append(groupActions);
        if (relation && !relation.planning_group_id)
          groupTitle
            .querySelector(".tree-count")
            .append(" · ", T("interface.messages.shared_group"));
        if (can("households", "edit")) {
          if (relation)
            for (const direction of [-1, 1])
              groupActions.append(
                iconAction(
                  direction < 0 ? "up" : "down",
                  T(direction < 0 ? "Move group up" : "Move group down"),
                  async () => {
                    await managementRpc("admin_manage_relation_group", {
                      p_action: "move",
                      p_id: relation.id,
                      p_planning_group_id: groupKey,
                      p_direction: direction,
                      p_expected: relation,
                    });
                    await reload();
                  },
                  groups.indexOf(groupId) + direction < 0 ||
                    groups.indexOf(groupId) + direction >= groups.length,
                  "edit-only",
                ),
              );
          groupActions.append(
            iconAction(
              "add",
              T("interface.messages.add_household"),
              () => {
                groupBox.open = true;
                const old = groupBody.querySelector(
                  ".hierarchy-create-household",
                );
                if (old) {
                  old.querySelector("input")?.focus();
                  return;
                }
                const form = householdForm({
                  planning_group_id: groupKey,
                  relation_group_id: groupId || null,
                  language: store.settings?.default_language || "en",
                });
                form.dataset.formKey =
                  "household:new:" + groupKey + ":" + groupId;
                form.classList.add("hierarchy-create-household");
                form
                  .querySelector("[data-discard]")
                  ?.addEventListener("click", () => form.remove());
                groupBody.prepend(form);
                form.querySelector("input")?.focus();
              },
              false,
              "edit-only",
            ),
          );
          if (relation) {
            groupActions.append(
              iconAction(
                "edit",
                T("Edit group"),
                () => {
                  groupBox.open = true;
                  openHierarchyEditor(
                    groupBody,
                    "relation:" + groupId,
                    T("interface.messages.relation_group"),
                    relation.name,
                    (name) =>
                      managementRpc("admin_manage_relation_group", {
                        p_action: "save",
                        p_id: relation.id,
                        p_name: name,
                        p_expected: relation,
                      }),
                  );
                },
                false,
                "edit-only",
              ),
            );
            groupActions.append(
              iconAction(
                "delete",
                T("Delete group"),
                async () => {
                  if (
                    store.households.some(
                      (h) => h.relation_group_id === groupId,
                    )
                  ) {
                    show(T("interface.messages.group_not_empty"), "error");
                    return;
                  }
                  if (
                    !await window.RSVP_INLINE.confirm(T("Permanently delete {name}?", { name: relation.name }), { action: "Delete" })
                  )
                    return;
                  await managementRpc("admin_manage_relation_group", {
                    p_action: "delete",
                    p_id: relation.id,
                    p_expected: relation,
                  });
                  await reload();
                },
                false,
                "edit-only danger",
              ),
            );
            groupBody.lifecycleButton = groupActions.lastElementChild;
            groupBody.lifecycleButton.remove();
          }
        }
        const visited = new Set();
        function draw(h, container, depth) {
          if (visited.has(h.id) || !visible.has(h.id)) return;
          visited.add(h.id);
          const children = ordered(
            members.filter((m) => m.parent_id === h.id && m.id !== h.id),
            "household_name",
          );
          const nested = children.some((c) => visible.has(c.id));
          // Every household can expand to show and edit its individual guests.
          const node = R.dom("details", { class: "household-tree-node" });
          node.dataset.treeKey = "household:" + h.id;
          setDisclosure(node, node.dataset.treeKey, false, !!search);
          const card = R.dom("summary", { class: "household-node" });
          const primary = R.dom("div", { class: "household-node-main" });
          const info = R.dom("div", { class: "household-node-name" });
          info.append(
            R.dom(
              "strong",
              {},
              R.householdName(h) || T("interface.messages.unnamed_household"),
            ),
          );
          const guests = store.guests.filter((g) => g.household_id === h.id);
          const primaryGuest = householdPrimaryGuest(h),
            savedContact = householdPrimaryContact(h);
          info.append(
            R.dom(
              "small",
              { class: "muted" },
              householdSummary(h, guests, primaryGuest || savedContact),
            ),
          );
          primary.append(info);
          const actions = R.dom("div", { class: "household-actions" });
          const editor = disclosure(T("interface.messages.household_details"));
          editor.classList.add("household-inline-editor");
          editor.dataset.householdDetailKey = "household-details:" + h.id;
          setDisclosure(editor, editor.dataset.householdDetailKey);
          const primaryName = primaryGuest
            ? [primaryGuest.first_name, primaryGuest.last_name].filter(Boolean).join(" ") || T("interface.messages.unnamed_guest")
            : savedContact?.contact_name || savedContact?.contact_value || "";
          const detailHeading = editor.querySelector("summary");
          const contactValue = savedContact?.contact_value || primaryGuest?.mobile || primaryGuest?.phone || primaryGuest?.email || "";
          const channel = savedContact ? primaryContactChannel(savedContact) : primaryGuest?.preferred_contact_method;
          const caption = R.dom("small", { class: "primary-contact-summary muted" });
          if (primaryName) caption.append(R.dom("span", { "aria-hidden": "true" }, "✓"), R.dom("span", {}, primaryName));
          if (primaryName && contactValue && contactValue !== primaryName) caption.append(R.dom("span", {}, contactValue));
          if (primaryName && channel) caption.append(R.dom("span", {}, "(" + (contactMethodLabel(channel) || channel) + ")"));
          if (h.food) caption.append(R.dom("span", {}, (primaryName ? "- " : "") + T("Food")));
          detailHeading.append(caption);
          const summary = R.dom("div", { class: "household-compact-reading view-only" });
          function compactLine(values, separator) {
            const parts = values.filter(Boolean);
            if (!parts.length) return;
            const line = R.dom("div", { class: "household-reading-line" });
            parts.forEach((value, index) => {
              if (index) line.append(R.dom("span", { "aria-hidden": "true" }, separator));
              line.append(R.dom("span", {}, value));
            }); summary.append(line);
          }
          compactLine([h.postal_address, h.phone], "-");
          compactLine([groupLabel(h.planning_group_id), store.relationGroups.find(g => g.id === h.relation_group_id)?.name, R.householdName(store.households.find(parent => parent.id === h.parent_id)) || T("None (top level)")], "→");
          if (can("invites")) {
            const invited = ordered(store.sessions.filter(session => session.is_active), "name").filter(session => guests.some(guest => !guest.archived_at && (store.overrides.find(o => o.guest_id === guest.id && o.session_id === session.id)?.is_invited ?? store.defaults.find(d => d.household_id === h.id && d.session_id === session.id)?.is_invited)));
            if (invited.length) compactLine([T("Sessions"), invited.map(session => session.name).join(" · ")], "");
          }
          if (h.notes) compactLine([h.notes], "");
          editor.append(summary);
          actions.append(
            iconAction(
              "edit",
              T("interface.messages.edit_household") +
                (R.householdName(h) || "household"),
              () => {
                node.open = true;
                editor.open = true;
                editor.classList.add("household-detail-editing");
                editor.querySelector("input")?.focus();
              },
              false,
              "edit-only",
            ),
          );
          const siblings = ordered(
            members.filter(
              (m) => m.parent_id === h.parent_id && !m.archived_at,
            ),
            "household_name",
          );
          const pos = siblings.findIndex((m) => m.id === h.id);
          actions.prepend(
            btn(
              "↑",
              T("interface.messages.move_household_up"),
              () =>
                rpcAction(
                  "admin_move_household",
                  { p_household_id: h.id, p_direction: -1 },
                  T("interface.messages.household_order_saved"),
                ),
              pos <= 0 || !!h.archived_at,
            ),
          );
          actions.insertBefore(
            btn(
              "↓",
              T("interface.messages.move_household_down"),
              () =>
                rpcAction(
                  "admin_move_household",
                  { p_household_id: h.id, p_direction: 1 },
                  T("interface.messages.household_order_saved"),
                ),
              pos >= siblings.length - 1 || !!h.archived_at,
            ),
            actions.children[1],
          );
          const choice = h.archived_at ? null : householdContactChoice(h);
          const form = householdForm(h, choice);
          form.id = "household-form-" + h.id;
          form.addEventListener("rsvp:form-saved", () => editor.classList.remove("household-detail-editing"));
          form.addEventListener("click", event => { if (event.target.closest("[data-discard]")) editor.classList.remove("household-detail-editing"); });
          editor.append(form);
          if (choice) editor.append(choice.panel);
          const contacts = contactSection(h, primaryGuest, primaryName);
          const footer = form.saveActions;
          footerAction(
            form,
            archiveButton("households", h),
            T(
              h.archived_at
                ? "interface.messages.restore"
                : "interface.messages.archive",
            ),
          );
          if (h.archived_at || !store.settings?.is_published)
            footerAction(form, deleteRecordButton("households", h));
          if (h.archived_at) {
            form.dataset.restoreOnly = "true";
            for (const control of form.querySelectorAll(
              "input,select,textarea",
            ))
              control.disabled = true;
            form.cleanSaveUpdate();
          }
          footer.classList.add("household-form-footer", "edit-only");
          footer
            .querySelector('button[type="submit"]')
            .setAttribute("form", form.id);
          if (contacts) { contacts.classList.add("household-contact-editor"); editor.append(contacts); }
          footer.addEventListener("click", event => { if (event.target.closest("[data-discard]")) editor.classList.remove("household-detail-editing"); });
          editor.append(footer);
          primary.append(actions);
          card.append(primary);
          const expanded = R.dom("div", { class: "household-expanded" });
          expanded.append(editor, buildGuestList(guests));
          if (can("invites") && store.queue.some(q => q.household_id === h.id)) expanded.append(deliverySection(h));
          if (!h.archived_at) {
            const add = disclosure(
              T("interface.messages.add_guest"),
              "edit-only",
            );
            const form = buildGuestEditor({ household_id: h.id });
            form.classList.remove("hidden");
            add.append(form);
            expanded.append(add);
          }
          if (nested) {
            const childList = R.dom("div", { class: "tree-children" });
            childList.append(
              R.dom(
                "div",
                { class: "guest-list-heading" },
                T("interface.messages.child_households"),
              ),
            );
            children.forEach((child) => draw(child, childList, depth + 1));
            expanded.append(childList);
          }
          node.append(card, expanded);
          container.append(node);
        }
        ordered(
          members.filter(
            (h) => !h.parent_id || !members.some((p) => p.id === h.parent_id),
          ),
          "household_name",
        ).forEach((h) => draw(h, groupBody, 0));
        visibleMembers
          .filter((h) => !visited.has(h.id))
          .forEach((h) => draw(h, groupBody, 0));
        groupBox.append(groupBody);
        planningGroupBody.append(groupBox);
      }
      groupSection.append(planningGroupBody);
      box.append(groupSection);
    }
    if (!box.children.length)
      box.append(
        R.dom(
          "p",
          { class: "muted" },
          T("interface.messages.no_matching_households"),
        ),
      );
  }
  function claimedQuantity(item) {
    return store.claims
      .filter((c) => c.food_item_id === item.id)
      .reduce((n, c) => n + c.quantity, 0);
  }
  function foodCategoriesSorted() {
    return R.foodCategoryTree(ordered(store.foodCategories, "name"));
  }
  function foodItemName(item) {
    return item.name_en || T("interface.messages.unnamed_item");
  }
  function foodMenuCategories() {
    const categories = foodCategoriesSorted(),
      known = new Set(categories.map((c) => c.name));
    const unregistered = [
      ...new Set(
        store.food.map((f) => f.category || "").filter((c) => !known.has(c)),
      ),
    ].sort();
    return [
      ...categories.map((c) => ({ ...c, registered: true })),
      ...unregistered.map((name) => ({ name, id: null, registered: false })),
    ];
  }
  function foodMenuItems(category) {
    return ordered(
      store.food.filter((item) => (item.category || "") === category),
      "name_en",
    );
  }
  function foodCategoryOptions(select, current) {
    foodCategoriesSorted().forEach((category) =>
      select.append(
        R.dom(
          "option",
          { value: category.name },
          category.path || category.name,
        ),
      ),
    );
    if (current && !store.foodCategories.some((c) => c.name === current))
      select.append(
        R.dom(
          "option",
          { value: current },
          current + T("interface.messages.unregistered"),
        ),
      );
    select.value = current || "";
  }
  function foodTypeOptions(current) {
    const names = [
      ...new Set([
        ...R.foodTypes,
        ...store.foodTypes.map((type) => type.name),
        ...(current ? [current] : []),
      ]),
    ];
    return names.map((name) => [name, foodTypeLabel(name)]);
  }
  function foodTypeLabel(name, quantity) {
    const singular = {
      "Batch(s)": "Batch",
      "Piece(s)": "Piece",
      "Tray(s)": "Tray",
      "Packet(s)": "Packet",
      Kg: "Kg",
      Grams: "Gram",
    };
    if (R.foodTypes.includes(name)) {
      if (
        quantity === 1 &&
        !store.content.some(
          (row) =>
            row.content_key === "ui:" + window.RSVP_I18N.unitSource(name),
        )
      )
        return T(singular[name]);
      return T(name);
    }
    const values = Object.fromEntries(
      store.content
        .filter((c) => c.content_key === "ui:Food type: " + name)
        .map((c) => [c.language_code, c.content_value]),
    );
    return window.RSVP_I18N.resolve(values) || name;
  }
  function fillNewFoodTypes(selected = "Piece(s)") {
    const select = $("newFoodType");
    select.replaceChildren();
    for (const [value, label] of foodTypeOptions())
      select.append(R.dom("option", { value }, label));
    select.value = selected || "Piece(s)";
  }
  function openFoodTypes(select, trigger) {
    const key = "organizer-food:units";
    if (!can("food", "edit") || window.RSVP_POPUPS.get(key)) return;
    const dialog = window.RSVP_POPUPS.create(key, {
      class: "food-recipe-dialog food-type-manager",
    }, trigger);
    dialog.dataset.foodAccess = "edit";
    dialog.setAttribute("aria-label", T("interface.messages.manage_types"));
    dialog.append(
      R.dom("h2", {}, T("interface.messages.manage_types")),
      R.dom(
        "p",
        { class: "micro" },
        T("interface.messages.shared_food_types_help"),
      ),
    );
    const list = R.dom("div");
    dialog.append(list);
    function renderTypes() {
      list.replaceChildren();
      for (const [name, label] of foodTypeOptions()) {
        const row = R.dom("div", { class: "type-manager-row" }),
          info = R.dom("div");
        info.append(R.dom("strong", {}, label));
        if (label !== name)
          info.append(R.dom("small", { class: "micro" }, " · " + name));
        row.append(
          info,
          R.dom(
            "small",
            { class: "micro" },
            T(R.foodTypes.includes(name) ? "Built-in" : "Custom"),
          ),
        );
        if (can("languages"))
          row.append(
            iconAction("language", T("Translate") + " · " + label, () => {
              dialog.close();
              tab("language");
              window.RSVP_ADMIN_TOOLS.selectFoodType(name);
            }),
          );
        list.append(row);
      }
    }
    renderTypes();
    const form = R.dom("form", { class: "type-manager-add" }),
      label = R.dom("label", {}, T("food.messages.new_food_item_type"));
    const name = R.dom("input", { maxlength: 60, required: true });
    name.setAttribute("aria-label", T("food.messages.new_food_item_type"));
    label.append(name);
    const add = R.dom(
      "button",
      { type: "submit", class: "btn" },
      T("interface.messages.add_type").replace(/^[+＋]\s*/, ""),
    );
    form.append(label, add);
    dialog.append(form);
    const status = R.dom("p", { class: "micro", role: "status" });
    dialog.append(status);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = name.value.trim();
      if (!value) return;
      for (const button of dialog.querySelectorAll("button"))
        button.disabled = true;
      name.disabled = true;
      form.setAttribute("aria-busy", "true");
      try {
        if (!can("food", "edit"))
          throw Error(T("This action is not allowed by your administrator permissions."));
        if (
          foodTypeOptions().some(
            ([existing]) => existing.toLowerCase() === value.toLowerCase(),
          )
        )
          throw Error(T("interface.messages.type_already_exists"));
        const { error } = await db
          .from("food_item_types")
          .insert({ name: value });
        if (error) throw error;
        store.foodTypes.push({ name: value });
        const selected = $("newFoodType").value;
        fillNewFoodTypes(selected);
        for (const field of document.querySelectorAll(
          '.food-edit-form select[name="type"]',
        )) {
          const current = field.value;
          field.replaceChildren(
            ...foodTypeOptions(current).map(([value, label]) =>
              R.dom("option", { value }, label),
            ),
          );
          field.value = current;
        }
        if (select?.isConnected) {
          select.replaceChildren(
            ...foodTypeOptions(value).map(([value, label]) =>
              R.dom("option", { value }, label),
            ),
          );
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        name.value = "";
        renderTypes();
        status.textContent = T("interface.messages.type_added");
        name.focus();
      } catch (error) {
        status.textContent = T(R.safeError(error));
      } finally {
        for (const button of dialog.querySelectorAll("button"))
          button.disabled = false;
        name.disabled = false;
        form.removeAttribute("aria-busy");
        if (dialog.isConnected) name.focus();
      }
    });
    const close = R.dom(
      "button",
      { type: "button", class: "btn secondary" },
      T("Close"),
    );
    close.addEventListener("click", () => dialog.close());
    dialog.append(close);
    close.addEventListener(
      "click",
      (event) => {
        if (form.getAttribute("aria-busy") === "true") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    $("adminApp").append(dialog);
    dialog.openInline();
    name.focus();
  }
  function foodVenueFields(host, current = null) {
    host.replaceChildren();
    const venues = ordered(store.locations, "name").filter(
      (venue) => !venue.archived_at,
    );
    if (!venues.length || (venues.length < 2 && current === null))
      return () => current;
    const group = R.dom("fieldset", { class: "food-venue-options" });
    group.append(R.dom("legend", {}, T("interface.messages.venues")));
    const checks = venues.map((venue) => {
      const check = R.dom("input", { type: "checkbox", value: venue.id });
      check.checked = current === null || current.includes(venue.id);
      const label = R.dom("label", { class: "checkbox-label" });
      label.append(check, document.createTextNode(venue.name));
      group.append(label);
      return check;
    });
    host.append(group);
    return () => {
      const selected = checks
        .filter((check) => check.checked)
        .map((check) => check.value);
      return selected.length === venues.length ? null : selected;
    };
  }
  function foodVenueEligible(h, item) {
    if (item.venue_ids == null) return true;
    return store.sessions.some(
      (session) =>
        session.is_active &&
        item.venue_ids.includes(session.location_id) &&
        store.locations.some(
          (venue) => venue.id === session.location_id && !venue.archived_at,
        ) &&
        store.guests.some(
          (guest) =>
            guest.household_id === h.id &&
            !guest.archived_at &&
            (store.overrides.find(
              (o) => o.guest_id === guest.id && o.session_id === session.id,
            )?.is_invited ??
              store.defaults.find(
                (d) => d.household_id === h.id && d.session_id === session.id,
              )?.is_invited),
        ),
    );
  }
  let newFoodVenues = () => null;
  function foodClaimName(claim) {
    return (
      R.householdName(store.households.find((h) => h.id === claim.household_id)) || T("interface.messages.household_2")
    );
  }
  function foodSelections(item, claims, claimed) {
    const section = R.dom("div", { class: "food-selections edit-only" });
    const available = item.quantity_needed - claimed;
    const eligible = ordered(store.households, "household_name").filter(
      (h) => h.food && !h.archived_at,
    );
    const canEdit = new Set(eligible.map((h) => h.id));
    const selectionArgs = (householdId, quantity, expected) => ({
      p_household_id: householdId,
      p_food_item_id: item.id,
      p_quantity: quantity,
      p_expected_quantity: expected,
    });
    const quantityField = (form, value, max) => {
      const quantity = field(form, T("Quantity"), value, null, "number", true);
      quantity.min = "1";
      quantity.max = String(max);
      quantity.step = "1";
      return quantity;
    };
    if (claims.length) {
      const rows = claims.map((claim) => {
        const name = foodClaimName(claim),
          amount = R.dom(
            "div",
            { class: "food-selection-amount" },
            String(claim.quantity),
          );
        const actions = R.dom("div", { class: "food-selection-actions" });
        if (item.active && canEdit.has(claim.household_id)) {
          const form = R.dom("form", { class: "food-selection-form hidden" });
          const quantity = quantityField(
            form,
            claim.quantity,
            foodVenueEligible(
              eligible.find((h) => h.id === claim.household_id),
              item,
            )
              ? available + claim.quantity
              : claim.quantity,
          );
          amount.append(
            saveForm(form, T("interface.messages.save"), () =>
              managementRpc(
                "admin_set_food_selection",
                selectionArgs(
                  claim.household_id,
                  Number(quantity.value),
                  claim.quantity,
                ),
              ),
            ),
          );
          actions.append(
            iconAction(
              "edit",
              T("interface.messages.edit_quantity_for_household", {
                household: name,
              }),
              () => {
                form.classList.toggle("hidden");
                if (!form.classList.contains("hidden")) quantity.focus();
              },
            ),
          );
          actions.append(
            iconAction(
              "unlink",
              T("Remove assignment for {household}", { household: name }),
              async () => {
                if (
                  !await window.RSVP_INLINE.confirm(T("Remove {household}’s assignment for {item}?", {
                      household: name,
                      item: foodItemName(item),
                    }), { action: "Remove assignment" })
                )
                  return;
                await rpcAction(
                  "admin_set_food_selection",
                  selectionArgs(claim.household_id, 0, claim.quantity),
                  T("interface.messages.changes_saved"),
                );
              },
            ),
          );
        }
        return [name, amount, actions];
      });
      section.append(
        makeTable(
          [T("interface.messages.household_2"), T("Quantity"), ""],
          rows,
        ),
      );
    }
    const selected = new Set(claims.map((c) => c.household_id));
    const options = eligible
      .filter(
        (h) =>
          !h.food_confirmed &&
          !selected.has(h.id) &&
          foodVenueEligible(h, item),
      )
      .map((h) => [h.id, R.householdName(h)]);
    if (item.active && available > 0 && options.length) {
      const editor = disclosure(
        T("interface.messages.add_household"),
        "food-selection-editor",
      );
      editor.dataset.requiresSection = "food";
      editor.dataset.requiresLevel = "edit";
      const form = R.dom("form", { class: "food-selection-form" });
      const choice = field(
        form,
        T("interface.messages.household_2"),
        "",
        [["", T("Choose…")], ...options],
        "text",
        true,
      );
      const quantity = quantityField(form, 1, available);
      editor.append(
        saveForm(form, T("interface.messages.save"), () =>
          managementRpc(
            "admin_set_food_selection",
            selectionArgs(choice.value, Number(quantity.value), 0),
          ),
        ),
      );
      section.append(editor);
    }
    return section;
  }
  function buildFoodEditor(item) {
    const form = R.dom("form", { class: "food-edit-form hidden" });
    form.dataset.formKey = "food:" + item.id;
    const fields = [
      [T("interface.messages.name"), "name_en"],
      [T("Guest note"), "description_en"],
      [T("Admin note"), "admin_comment"],
    ];
    for (const [labelText, key] of fields) {
      const label = R.dom("label");
      label.append(R.dom("span", {}, labelText));
      const input = R.dom(key === "name_en" ? "input" : "textarea", {
        name: key,
      });
      input.value =
        key === "name_en"
          ? foodItemName(item)
          : key === "description_en"
            ? (item.description_en ?? "")
            : item[key] || "";
      input.maxLength = key === "name_en" ? 300 : 4000;
      input.required = key === "name_en";
      label.append(input);
      form.append(label);
    }
    form.elements
      .namedItem("name_en")
      .setAttribute("aria-label", T("interface.messages.name"));
    const nameLabel = form.elements.namedItem("name_en").parentElement;
    nameLabel.classList.add("food-name-field");
    form.elements.namedItem("name_en").id = "food-name-" + item.id;
    nameLabel.htmlFor = "food-name-" + item.id;
    const nameControl = R.dom("span", { class: "food-name-control" });
    nameControl.append(
      form.elements.namedItem("name_en"),
      foodLanguageButton((button) =>
        window.RSVP_ADMIN_TOOLS.openFoodTranslations(item, button),
      ),
    );
    nameLabel.append(nameControl);
    nameControl.querySelector("button").dataset.foodLanguage = item.id;
    const originalComment = form.elements.namedItem("description_en").value;
    const quantityLabel = R.dom("label");
    quantityLabel.append(
      R.dom("span", {}, T("interface.messages.quantity_needed")),
    );
    const quantity = R.dom("input", {
      type: "number",
      min: "0",
      name: "quantity_needed",
    });
    quantity.value = String(item.quantity_needed);
    quantity.required = true;
    quantityLabel.append(quantity);
    form.insertBefore(quantityLabel, form.children[1]);
    const currentType = item.quantity_type || "Piece(s)";
    const type = field(
      form,
      T("Unit"),
      currentType,
      foodTypeOptions(currentType),
    );
    type.name = "type";
    form.insertBefore(type.parentElement, form.children[2]);
    const typeTools = R.dom("span", { class: "food-type-tools" });
    const manageTypes = iconAction(
      "edit",
      T("interface.messages.manage_types"),
      () => openFoodTypes(type, manageTypes),
      false,
      "edit-only",
    );
    typeTools.append(manageTypes);
    const unitLabel = type.parentElement,
      unitControl = R.dom("span", { class: "food-unit-control" });
    unitControl.append(type, typeTools);
    unitLabel.append(unitControl);
    const category = field(
      form,
      T("interface.messages.category"),
      item.category || "",
      [
        ["", T("interface.messages.uncategorized")],
        ...foodCategoriesSorted().map((c) => [c.name, c.path || c.name]),
        ...(!item.category ||
        store.foodCategories.some((c) => c.name === item.category)
          ? []
          : [[item.category, item.category]]),
      ],
    );
    category.name = "category";
    form.insertBefore(category.parentElement, form.children[3]);
    const venueHost = R.dom("div", { class: "span-2" });
    const venueIds = foodVenueFields(venueHost, item.venue_ids ?? null);
    if (venueHost.childElementCount) form.append(venueHost);
    const activeLabel = R.dom("label", {
        class: "checkbox-label food-guest-visibility",
      }),
      active = R.dom("input", { type: "checkbox" }),
      visibility = R.dom("span");
    active.checked = item.active;
    active.setAttribute("aria-label", T("Show to guests"));
    const updateVisibility = () => {
      visibility.replaceChildren(actionGlyph(active.checked ? "show" : "hide"));
      visibility.title = T(
        active.checked ? "Hide from guests" : "Hidden from guests",
      );
    };
    active.addEventListener("change", updateVisibility);
    updateVisibility();
    activeLabel.append(
      active,
      visibility,
      R.dom("span", {}, T("Show to guests")),
    );
    form.append(activeLabel);
    const footer = R.dom("div", { class: "food-edit-buttons form-actions" });
    const save = R.dom(
      "button",
      { type: "submit", class: "btn" },
      T("Save"),
    );
    const cancel = R.dom(
      "button",
      { type: "button", class: "btn secondary" },
      T("interface.messages.cancel"),
    );
    cancel.dataset.discard = "true";
    cancel.addEventListener("click", () => {
      restoreDraft(form);
      form.classList.add("hidden");
    });
    footer.append(save, cancel);
    const lifecycle = lifecycleControls("food_items", item);
    if (lifecycle) footer.append(lifecycle);
    form.append(footer);
    const status = R.dom("p", {
      class: "micro span-2 form-feedback",
      role: "status",
    });
    footer.append(status);
    for (const key of [
      "name_en",
      "quantity_needed",
      "type",
      "category",
      "admin_comment",
      "description_en",
    ])
      form.insertBefore(
        form.elements.namedItem(key).closest("label"),
        venueHost.parentElement === form ? venueHost : footer,
      );
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const required = Number(quantity.value),
        claim = claimedQuantity(item);
      if (
        !Number.isInteger(required) ||
        required < claim ||
        (!active.checked && claim > 0)
      ) {
        show(
          T(
            "interface.messages.quantity_cannot_fall_below_count_claimed_claimed_items_cannot_be_",
            { count: claim },
          ),
          "error",
        );
        return;
      }
      const record = {
        quantity_needed: required,
        active: active.checked,
        quantity_type: type.value,
        category: category.value || null,
        venue_ids: venueIds(),
      };
      for (const [, key] of fields) {
        const value = form.elements.namedItem(key).value;
        if (key === "description_en" && value === originalComment) continue;
        record[key] = value.trim() || (key === "description_en" ? "" : null);
      }
      if (!record.name_en) {
        show(T("interface.messages.name_is_required"), "error");
        return;
      }
      save.disabled = true;
      form.setAttribute("aria-busy", "true");
      formFeedback(form, "saving");
      try {
        const { error } = await db
          .from("food_items")
          .update(record)
          .eq("id", item.id);
        if (error) throw error;
        formFeedback(form, "saved");
        await reload();
        const saved = document.querySelector(
          '[data-tree-key="food:item:' + item.id + '"]',
        );
        if (saved)
          saved.append(
            R.dom(
              "p",
              { class: "micro", role: "status" },
              T("food.messages.food_item_updated"),
            ),
          );
        show(T("food.messages.food_item_updated"), "success");
      } catch (error) {
        formFeedback(form, "error", R.safeError(error));
        show(R.safeError(error), "error");
      } finally {
        form.removeAttribute("aria-busy");
        form.cleanSaveUpdate?.();
      }
    });
    for (const control of form.querySelectorAll("input,select,textarea")) {
      control.dataset.foodOriginal =
        control.type === "checkbox" ? String(control.checked) : control.value;
    }
    const updateSave = () => {
      save.disabled =
        form.getAttribute("aria-busy") === "true" ||
        !Array.from(form.querySelectorAll("input,select,textarea")).some(
          (control) =>
            (control.type === "checkbox"
              ? String(control.checked)
              : control.value) !== control.dataset.foodOriginal,
        );
    };
    form.addEventListener("input", updateSave);
    form.addEventListener("change", updateSave);
    updateSave();
    cleanSave(form);
    return form;
  }
  function openFoodRecipe(item, trigger, editing = false) {
    if (!can("food")) return;
    const editable = can("food", "edit");
    const reading = !editable || (!editing && item.recipe_text?.trim());
    const key = `organizer-food:recipe:${item.id}:${reading ? "read" : "edit"}`;
    if (window.RSVP_POPUPS.get(key)) return;
    const dialog = window.RSVP_POPUPS.create(key, { class: "food-recipe-dialog" }, trigger);
    dialog.dataset.foodAccess = reading ? "view" : "edit";
    if (reading) {
      const view = R.openRecipeDialog(
        foodItemName(item),
        item.recipe_text,
        trigger,
        () =>
          show(
            T("food.messages.allow_pop_ups_to_save_the_recipe_as_pdf"),
            "warning",
          ),
        dialog,
      );
      if (editable) {
        const edit = iconAction(
          "edit",
          T("Edit") + " · " + T("food.messages.recipe"),
          () => {
            view.close();
            openFoodRecipe(item, trigger, true);
          },
        );
        view.querySelector(".form-actions").prepend(edit);
      }
      return view;
    }
    dialog.setAttribute("aria-label", T("food.messages.recipe"));
    dialog.append(
      R.dom("h2", {}, T("food.messages.recipe") + " · " + foodItemName(item)),
    );
    let recipe = null;
    const form = R.dom("form", { class: "form-grid" }),
      preview = R.dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("Preview"),
      );
    preview.disabled = !item.recipe_text?.trim();
    preview.addEventListener("click", () => {
      const value = recipe ? recipe.value : item.recipe_text;
      if (value?.trim() && !R.printRecipe(foodItemName(item), value))
        show(
          T("food.messages.allow_pop_ups_to_save_the_recipe_as_pdf"),
          "warning",
        );
    });
    if (editable) {
      recipe = field(
        form,
        T("food.messages.recipe"),
        item.recipe_text,
        null,
        "textarea",
        false,
        12000,
      );
      recipe.rows = 10;
      recipe.addEventListener(
        "input",
        () => (preview.disabled = !recipe.value.trim()),
      );
      const cancel = R.dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("Cancel"),
      );
      cancel.addEventListener("click", () => dialog.close());
      form.append(cancel);
      saveForm(form, T("Save"), async () => {
        if (!can("food", "edit"))
          throw Error(
            T("This action is not allowed by your administrator permissions."),
          );
        const { data, error } = await db
          .from("food_items")
          .update({ recipe_text: recipe.value.trim() || null })
          .eq("id", item.id)
          .select("id");
        if (error) throw error;
        if (data?.length !== 1)
          throw Error(
            T("This action is not allowed by your administrator permissions."),
          );
        dialog.close();
      });
      form.querySelector(".form-actions").append(preview);
      dialog.append(form);
    }
    $("adminApp").append(dialog);
    dialog.openInline();
    (recipe || dialog.querySelector("button"))?.focus();
  }
  function foodLanguageButton(open) {
    const button = R.dom("button", {
      type: "button",
      class: "admin-row-icon food-language-action",
    });
    button.append(actionGlyph("language"));
    button.title = T("interface.messages.language");

    button.setAttribute("aria-label", T("interface.messages.language"));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      open(button).catch((error) => show(R.safeError(error), "error"));
    });
    return button;
  }
  const { lifecycleControls, archiveButton, deleteRecordButton } =
    window.RSVP_ADMIN_LIFECYCLE.create({
      R,
      T,
      getStore: () => store,
      isEditing: () => true,
      can,
      iconAction,
      managementRpc,
      reload,
      show,
    });
  function foodCategoryEditor(category) {
    const form = R.dom("form", {
        class: "food-category-name-form hidden edit-only",
      }),
      label = R.dom("label", {}, T("Category name")),
      input = R.dom("input", {
        value: category.name,
        maxlength: 120,
        required: true,
      });
    input.id = "food-category-name-" + category.id;
    label.htmlFor = input.id;
    const nameControl = R.dom("span", {
      class: "food-name-control category-name-control",
    });
    nameControl.append(
      input,
      foodLanguageButton((button) =>
        window.RSVP_ADMIN_TOOLS.openFoodCategoryTranslations(category, button),
      ),
    );
    label.append(nameControl);
    const fields = R.dom("div", { class: "food-category-fields" });
    fields.append(label);
    form.append(fields);
    const parentLabel = R.dom("label", {}, T("Parent category")),
      parent = R.dom("select");
    parent.setAttribute("aria-label", T("Parent category"));
    parent.append(
      R.dom("option", { value: "" }, T("interface.messages.none_top_level")),
    );
    for (const c of foodCategoriesSorted().filter(
      (c) => !R.foodCategoryWithin(store.foodCategories, c.id, category.id),
    ))
      parent.append(R.dom("option", { value: c.id }, c.path));
    parent.value = category.parent_id || "";
    parentLabel.append(parent);
    fields.append(parentLabel);
    const actions = R.dom("div", { class: "other-edit-actions" }),
      save = R.dom("button", { type: "submit", class: "btn" }, T("Save")),
      cancel = R.dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("Cancel"),
      );
    actions.append(save, cancel);
    form.append(actions);
    form.dataset.formKey = "food-category:" + category.id;
    const status = R.dom("p", { class: "form-feedback micro", role: "status" });
    form.append(status);
    if (foodCategoryMessages.has(category.id)) formFeedback(form, "saved");
    cancel.addEventListener("click", () => {
      input.value = category.name;
      parent.value = category.parent_id || "";
      form.classList.add("hidden");
      foodCategoryMessages.delete(category.id);
      formFeedback(form);
      form.cleanSaveUpdate();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      form.setAttribute("aria-busy", "true");
      save.disabled = true;
      input.disabled = true;
      parent.disabled = true;
      cancel.disabled = true;
      formFeedback(form, "saving");
      try {
        await managementRpc("admin_save_food_category", {
          p_category_id: category.id,
          p_name: input.value.trim(),
          p_parent_id: parent.value || null,
          p_expected_name: category.name,
          p_expected_parent: category.parent_id || null,
        });
        if (foodCreationCategory === category.name)
          foodCreationCategory = input.value.trim();
        foodCategoryMessages.set(category.id, T("Category saved"));
        formFeedback(form, "saved");
        expandedGroups.set("food:" + input.value.trim(), true);
        let ancestor = store.foodCategories.find((c) => c.id === parent.value);
        const seen = new Set();
        while (ancestor && !seen.has(ancestor.id)) {
          seen.add(ancestor.id);
          expandedGroups.set("food:" + ancestor.name, true);
          ancestor = store.foodCategories.find(
            (c) => c.id === ancestor.parent_id,
          );
        }
        await reload();
        const next = document.querySelector(
          '[data-food-category-id="' + category.id + '"]',
        );
        if (next)
          next
            .querySelector(".food-category-name-form")
            .classList.remove("hidden");
      } catch (error) {
        formFeedback(form, "error", R.safeError(error));
      } finally {
        form.removeAttribute("aria-busy");
        input.disabled = false;
        parent.disabled = false;
        cancel.disabled = false;
        form.cleanSaveUpdate();
      }
    });
    cleanSave(form);
    return form;
  }
  const foodGroupsView = window.RSVP_ADMIN_FOOD_GROUPS.create({
    R,
    T,
    getStore: () => store,
    isEditing: () => true,
    can,
    field,
    foodCategoriesSorted,
    claimedQuantity,
    foodItemName,
    formActions,
    restoreDraft,
    formFeedback,
    managementRpc,
    reload,
    show,
    cleanSave,
  });
  function renderFoodGroups() {
    foodGroupsView.render();
  }
  async function deleteFoodCategory(category) {
    if (store.foodCategories.some((c) => c.parent_id === category.id)) {
      show(T("Move sub-categories before deleting this category."), "error");
      return;
    }
    if (
      store.food.some((f) => f.category === category.name) ||
      (store.foodGroups || []).some((g) => g.category === category.name)
    ) {
      show(
        T("Move items to another category before deleting this category."),
        "error",
      );
      return;
    }
    if (!await window.RSVP_INLINE.confirm(T("Permanently delete {name}?", { name: category.name }), { action: "Delete category" }))
      return;
    await managementRpc("admin_delete_food_category", {
      p_category_id: category.id,
      p_expected_name: category.name,
    });
    await reload();
    show(T("Category deleted"), "success");
  }
  async function registerFoodCategory(category, categoryCount) {
    const { error } = await db.from("food_categories").insert({
      name: category.name,
      sort_order: categoryCount,
    });
    if (error) throw error;
    await reload();
    show(T("interface.messages.category_registered"), "success");
  }
  const foodAccess = window.RSVP_ADMIN_FOOD_ACCESS.create({
    R,
    T,
    getStore: () => store,
    getActor: () => currentActor(user) ? user : null,
    can,
    ordered,
    planningConfiguration,
    groupLabel,
    managementRpc,
    reload,
    show,
    applySavedFoodAccess(id, enabled) {
      const household = store.households.find(record => record.id === id);
      if (household) household.food = enabled;
    },
  });
  const foodView = window.RSVP_ADMIN_FOOD.create({
    R,
    T,
    getStore: () => store,
    can,
    renderFoodGroups,
    creationState: {
      getCategory: () => foodCreationCategory,
      setCategory: (category) => {
        foodCreationCategory = category;
      },
      readVenues: () => newFoodVenues(),
      renderVenues: (selected) => {
        newFoodVenues = foodVenueFields($("newFoodVenues"), selected);
      },
    },
    foodCategoryOptions,
    foodCategoriesSorted,
    fillNewFoodTypes,
    foodMenuCategories,
    foodMenuItems,
    setDisclosure,
    claimedQuantity,
    btn,
    rpcAction,
    foodAccess,
    async openFoodChoices(expectedStage) {
      await managementRpc("admin_set_food_stage", {
        p_stage: "selection",
        p_expected_stage: expectedStage,
      });
      if (await reload()) show(T("interface.messages.food_stage_saved"), "success");
    },
    show,
    iconAction,
    deleteFoodCategory,
    registerFoodCategory,
    foodCategoryEditor,
    addFoodSubcategory: (category) => {
      const details = $("foodAddCategory");
      details.open = true;
      $("newCategoryParent").value = category.id;
      $("categoryName").focus();
    },
    footerAction,
    foodItemName,
    foodTypeLabel,
    buildFoodEditor,
    foodClaimName,
    openFoodRecipe,
    foodSelections,
  });
  function renderFood() {
    foodView.render();
    foodAccess.reconcile();
  }
  async function sendAdminInvitation(values) {
    let result = await db.auth.getSession(),
      session = result.data?.session;
    if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
      result = await db.auth.refreshSession();
      session = result.data?.session;
    }
    if (
      result.error ||
      !session?.access_token ||
      session.access_token.startsWith("sb_")
    )
      throw new Error(
        T("interface.messages.sign_in_again_before_sending_an_invitation"),
      );
    const cfg = R.config();
    // Never retry an email send automatically: a timed-out request may have sent it.
    const response = await fetch(
      R.normalizeUrl(cfg.supabaseUrl) + "/functions/v1/admin-invitations",
      {
        method: "POST",
        headers: {
          apikey: cfg.supabaseKey,
          Authorization: "Bearer " + session.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(30000),
      },
    );
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error(
        T(
          "interface.messages.email_status_is_uncertain_refresh_pending_invitations_before_retr",
        ),
      );
    }
    if (!response.ok)
      throw new Error(
        value.error || T("interface.messages.invitation_could_not_be_sent"),
      );
    return value;
  }
  async function refreshAdminInvitations() {
    const result = await R.adminRpc("admin_list_invitations");
    if (!result.error) {
      store.adminInvitations = result.data || [];
      renderAdminInvitations();
    }
  }
  function renderAdminInvitations() {
    const list = $("adminInvitationsList");
    list.replaceChildren();
    $("adminInvitationsStatus").textContent = invitationApiError;
    $("addAdminForm").querySelector("button").disabled =
      !!invitationApiError || !can("administrators", "edit");
    if (!store.adminInvitations.length) {
      list.append(
        R.dom(
          "p",
          { class: "small muted" },
          T("interface.messages.no_pending_invitations"),
        ),
      );
      return;
    }
    for (const invitation of store.adminInvitations) {
      const expired = new Date(invitation.expires_at) <= new Date();
      const card = R.dom("div", {
          class: "admin-member admin-invitation-card",
        }),
        details = R.dom("div", { class: "admin-invitation-details" }),
        actions = R.dom("div", { class: "admin-invitation-actions edit-only" });
      const state = expired
        ? T("interface.messages.expired")
        : {
            sent: T("interface.messages.awaiting_acceptance"),
            failed: T("interface.messages.email_failed"),
            sending: T("interface.messages.sending_status_pending"),
          }[invitation.delivery_state] || T("interface.messages.pending");
      details.append(
        R.dom(
          "small",
          { class: "micro" },
          A.summary(
            invitation.access_permissions || A.permissionPreset("view"),
          ),
        ),
      );
      details.append(
        R.dom("div", { class: "name" }, invitation.name),
        R.dom("div", { class: "email" }, invitation.email),
        R.dom(
          "p",
          { class: "micro" },
          state +
            T("interface.messages.expires_time", {
              time: adminTime(invitation.expires_at),
            }),
        ),
      );
      if (invitation.last_error_code) {
        const errors = {
          email_address_not_authorized: T(
            "interface.messages.email_sending_is_restricted_check_the_email_configuration",
          ),
          over_email_send_rate_limit: T(
            "interface.messages.the_email_service_sending_limit_was_reached_wait_before_resending",
          ),
          over_request_rate_limit: T(
            "interface.messages.the_email_service_request_limit_was_reached_wait_before_resending",
          ),
          email_status_unknown: T(
            "interface.messages.email_delivery_status_is_uncertain_check_before_resending",
          ),
        };
        details.append(
          R.dom(
            "p",
            { class: "micro", title: invitation.last_error_code },
            errors[invitation.last_error_code] ||
              T(
                "interface.messages.the_email_could_not_be_sent_check_the_email_configuration_before_",
              ),
          ),
        );
      }
      const resend = R.dom(
          "button",
          { class: "btn secondary", type: "button" },
          T("interface.messages.resend"),
        ),
        cancel = R.dom(
          "button",
          { class: "btn secondary", type: "button" },
          T("interface.messages.cancel"),
        );
      const status = R.dom("p", {
        class: "small admin-invitation-status",
        role: "status",
      });
      resend.addEventListener("click", async () => {
        if (
          !await window.RSVP_INLINE.confirm(T(
              "interface.messages.send_another_administrator_invitation_email_to",
            ) +
              invitation.email +
              "?", { action: "Resend invitation" })
        )
          return;
        resend.disabled = true;
        cancel.disabled = true;
        status.textContent = T("interface.messages.sending_invitation");
        try {
          await sendAdminInvitation({
            id: invitation.id,
            email: invitation.email,
            name: invitation.name,
          });
          await refreshAdminInvitations();
          show(
            T("interface.messages.administrator_invitation_email_sent"),
            "success",
          );
        } catch (error) {
          status.textContent = R.safeError(error);
        } finally {
          resend.disabled = false;
          cancel.disabled = false;
        }
      });
      cancel.addEventListener("click", async () => {
        if (
          !await window.RSVP_INLINE.confirm(T("interface.messages.cancel_administrator_invitation_for") +
              invitation.email +
              "?", { action: "Cancel invitation" })
        )
          return;
        resend.disabled = true;
        cancel.disabled = true;
        try {
          await managementRpc("admin_cancel_invitation", {
            p_id: invitation.id,
          });
          await refreshAdminInvitations();
          show(
            T("interface.messages.administrator_invitation_cancelled"),
            "success",
          );
        } catch (error) {
          status.textContent = R.safeError(error);
        } finally {
          resend.disabled = false;
          cancel.disabled = false;
        }
      });
      actions.append(resend, cancel);
      card.append(details, actions, status);
      list.append(card);
      A.invitationAccess?.(card, invitation);
    }
  }
  function renderAdmins() {
    const authApi = new URL(R.config().supabaseUrl);
    if (authApi.hostname.endsWith(".supabase.co")) {
      $("authUsersLink").href =
        "https://supabase.com/dashboard/project/" +
        authApi.hostname.split(".")[0] +
        "/auth/users";
    } else {
      authApi.port = "54323";
      authApi.pathname = "/project/default/auth/users";
      authApi.search = "";
      authApi.hash = "";
      $("authUsersLink").href = authApi.href;
    }
    A.renderMembers();
    renderAdminInvitations();
  }

  function renderContent() {
    for (const lang of ["fo", "en", "de"])
      $("welcome_" + lang).value =
        store.content.find(
          (c) => c.content_key === "welcome" && c.language_code === lang,
        )?.content_value || "";
  }
  function initContent() {
    const I = window.RSVP_I18N,
      phrase = $("wordingPhrase"),
      language = $("wordingLanguage"),
      value = $("wordingValue");
    for (const source of Object.keys(I.catalog).sort()) {
      const option = R.dom("option", { value: source }, source);
      phrase.append(option);
    }
    language.value = I.language;
    function load() {
      value.value = I.wording(phrase.value, language.value);
      value.placeholder = I.t(phrase.value, {}, language.value);
      $("wordingPreview").textContent = I.t(phrase.value, {}, language.value);
    }
    phrase.addEventListener("change", load);
    language.addEventListener("change", load);
    load();
    $("interfaceWordingForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await managementRpc("admin_save_translation", {
          p_key: "ui:" + phrase.value,
          p_language: language.value,
          p_value: value.value,
        });
        I.applyWording(phrase.value, language.value, value.value);
        $("wordingPreview").textContent = I.t(phrase.value, {}, language.value);
        show(T("interface.messages.translation_saved"), "success");
      } catch (error) {
        show(R.safeError(error), "error");
      }
    });
    $("downloadWording").addEventListener("click", () =>
      R.dl("interface-overrides.js", I.source()),
    );
    $("eventContentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = e.target.querySelector("button");
      button.disabled = true;
      try {
        const rows = ["fo", "en", "de"].map((lang) => ({
          content_key: "welcome",
          language_code: lang,
          content_value: $("welcome_" + lang).value.trim(),
        }));
        const { error } = await R.adminRpc("admin_save_translations", {
          p_changes: rows.map((row) => ({
            key: row.content_key,
            language: row.language_code,
            value: row.content_value,
          })),
        });
        if (error) throw error;
        await reload();
        show(T("interface.messages.welcome_messages_saved"), "success");
      } catch (error) {
        show(R.safeError(error), "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  const planningView = window.RSVP_ADMIN_PLANNING.create({
    R,
    T,
    getStore: () => store,
    can,
    planningName,
    languages,
    managementForm,
    field,
    iconAction,
    saveForm,
    managementRpc,
  });
  function renderPlanningSettings() {
    planningView.render();
  }
  const featuresView = window.RSVP_ADMIN_FEATURES.create({
    R,
    T,
    getStore: () => store,
    isEditing: () => true,
    can,
    saveForm,
    managementRpc,
  });
  function renderFeatures() {
    featuresView.render();
  }
  function renderGuestAppearance() {
    const host = $("guestAppearanceHost");
    const owner = user?.id || null,
      retain = owner === appearanceOwner && can("settings"),
      previousSections = new Map(retain ? [...host.querySelectorAll(".guest-mode-settings-card")].map(section =>
        [section.dataset.settingsCard.split(":")[1], section]) : []);
    if (!retain) window.RSVP_CUSTOMIZATION?.clear();
    appearanceOwner = owner;
    appearancePreviewOpen = host.querySelector(".guest-appearance-preview")?.open ?? appearancePreviewOpen;
    host.replaceChildren();
    const heading = R.dom("div", { class: "settings-card-heading guest-appearance-heading" });
    heading.append(R.dom("h3", {}, T("Invitation appearance"))); host.append(heading);
    const modes = R.dom("nav", { class: "guest-appearance-mode-tabs" }),
      columns = R.dom("div", { class: "guest-mode-settings guest-appearance-modes" }),
      preview = R.dom("details", { class: "guest-appearance-preview" }),
      previewSummary = R.dom("summary"),
      previewLabel = R.dom("span", { class: "guest-appearance-preview-label" }),
      previewMode = R.dom("span", { class: "micro" }),
      previewContent = R.dom("div", { class: "guest-appearance-preview-content" }),
      sections = new Map(), previews = new Map();
    modes.setAttribute("role", "tablist"); modes.setAttribute("aria-label", T("Invitation appearance"));
    previewLabel.append(actionGlyph("show"), R.dom("span", {}, T("Preview")), previewMode);
    previewSummary.append(previewLabel);
    preview.append(previewSummary, previewContent); preview.open = appearancePreviewOpen;
    preview.addEventListener("toggle", () => { if (preview.isConnected) appearancePreviewOpen = preview.open; });
    host.append(modes, columns, preview);
    const updateMode = () => {
      const busy = !!host.querySelector('form[aria-busy="true"]');
      for (const button of modes.querySelectorAll("button")) {
        const selected = button.dataset.appearanceMode === appearanceMode;
        button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; button.disabled = busy;
      }
      for (const [mode, section] of sections) section.classList.toggle("hidden", mode !== appearanceMode);
      const activePreview = previews.get(appearanceMode);
      if (activePreview && activePreview.parentElement !== previewContent) previewContent.replaceChildren(activePreview);
      previewMode.textContent = T(appearanceMode === "phone" ? "Phone" : "Wide");
      host.dataset.appearanceMode = appearanceMode;
    };
    for (const mode of ["wide", "phone"]) {
      const button = R.dom("button", { type: "button", id: "guest-appearance-tab-" + mode }, T(mode === "phone" ? "Phone" : "Wide")),
        section = previousSections.get(mode) || R.dom("section", { class: "guest-mode-settings-card", id: "guest-appearance-mode-" + mode });
      button.setAttribute("role", "tab"); section.setAttribute("role", "tabpanel");
      button.dataset.appearanceMode = mode; button.setAttribute("aria-controls", section.id);
      section.setAttribute("aria-labelledby", button.id); section.dataset.settingsCard = "guest-customization:" + mode;
      sections.set(mode, section); columns.append(section); modes.append(button);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        appearanceMode = mode; updateMode(); localEditors.refresh();
      });
      window.RSVP_CUSTOMIZATION?.render({ R, host: section, mode, languages, sharedPreview: true,
        mountPreview: node => { previews.set(mode, node); updateMode(); }, onUpdate: updateMode,
        refreshEditors: () => localEditors.refresh(),
        getStore: () => ({ ...store, settings: window.RSVP_GUEST_INTERFACE.effective(store.settings, mode, store.languages) }), can, isEditing: () => true, reload, show }, true);
    }
    updateMode(); localEditors.refresh();
  }
  function renderNotificationSettings() {
    const host = $("notificationSettingsHost"), owner = user?.id || null,
      retain = owner === notificationOwner && can("settings"),
      previous = new Map(retain ? [...host.querySelectorAll(".notification-mode-card")].map(section =>
        [section.dataset.settingsCard.split(":")[1], section]) : []);
    if (!retain) window.RSVP_ADMIN_NOTIFICATIONS.clear();
    notificationOwner = owner;
    host.replaceChildren();
    const heading = R.dom("div", { class: "settings-card-heading guest-appearance-heading notification-heading" }),
      modes = R.dom("nav", { class: "guest-appearance-mode-tabs notification-mode-tabs" }),
      columns = R.dom("div", { class: "notification-mode-settings" }), sections = new Map();
    heading.append(R.dom("h3", {}, T("Status messages")));
    modes.setAttribute("role", "tablist"); modes.setAttribute("aria-label", T("Status messages"));
    host.append(heading, modes, columns);
    const landing = document.querySelector(".guest-landing-settings");
    if (landing && host.parentElement !== landing) landing.append(host);
    const updateMode = () => {
      const busy = !!host.querySelector('form[aria-busy="true"]');
      for (const button of modes.querySelectorAll("button")) {
        const selected = button.dataset.notificationMode === notificationMode;
        button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; button.disabled = busy;
      }
      for (const [mode, section] of sections) section.classList.toggle("hidden", mode !== notificationMode);
      host.dataset.notificationMode = notificationMode;
    };
    for (const mode of ["wide", "phone"]) {
      const button = R.dom("button", { type: "button", id: "notification-tab-" + mode }, T(mode === "phone" ? "Phone" : "Wide")),
        section = previous.get(mode) || R.dom("section", { class: "notification-mode-card", id: "notification-mode-" + mode });
      button.setAttribute("role", "tab"); button.setAttribute("aria-controls", section.id); button.dataset.notificationMode = mode;
      section.setAttribute("role", "tabpanel"); section.setAttribute("aria-labelledby", button.id);
      section.dataset.settingsCard = "notification-preferences:" + mode;
      sections.set(mode, section); columns.append(section); modes.append(button);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        notificationMode = mode; updateMode(); localEditors.refresh();
      });
      window.RSVP_ADMIN_NOTIFICATIONS.render({ R, host: section, mode,
        getStore: () => ({ ...store, settings: window.RSVP_GUEST_INTERFACE.effective(store.settings, mode, store.languages) }),
        can, isEditing: () => true, reload, onUpdate: updateMode, refreshEditors: () => localEditors.refresh() }, true);
    }
    updateMode(); localEditors.refresh();
  }

  function syncApplicationPublication() {
    window.RSVP_ADMIN_APPLICATION.sync({ R, T, settings: store.settings, canEdit: can("settings", "edit"), busy: publicationBusy });
  }
  function renderSettings() {
    window.RSVP_GUEST_INTERFACE.controls({ R, T, getStore: () => store, render: renderSettings });
    renderNotificationSettings();
    renderFeatures();
    $("guestNamesHost").hidden = true;
    renderGuestAppearance();
    const e = store.settings || {};
    for (const id of ["wordingLanguage"]) {
      const select = $(id),
        previous = select.value;
      select.replaceChildren(
        ...languages()
          .filter(
            ([code]) =>
              !store.languages.length ||
              store.languages.find((l) => l.language_code === code)?.enabled,
          )
          .map(([value, label]) => R.dom("option", { value }, label)),
      );
      select.value = Array.from(select.options).some(
        (o) => o.value === previous,
      )
        ? previous
        : e.default_language;
    }
    $("settingName").value = e.event_name || "";
    $("settingDate").value = e.event_date || "";
    $("settingTime").value = e.event_time || "";
    $("settingOrganizerName").value = e.organizer_name || "";
    $("settingOrganizerEmail").value = e.organizer_email || "";
    $("settingOrganizerPhone").value = e.organizer_phone || "";
    const zone = e.timezone || "UTC", timezone = $("settingTimezone");
    timezone.replaceChildren(...timezoneOptions(zone).map(([value, label]) => R.dom("option", { value }, label)));
    timezone.value = timezone.dataset.previousZone = zone;
    for (const [id, key] of eventDeadlineFields) $(id).value = deadlineWallTime(e[key], zone);
    $("settingUrl").value = e.website_url || "";
    window.RSVP_ADMIN_PREFERENCES.refreshDatePickers($("eventSettingsForm"));
    $("publicationState").textContent = e.is_published
      ? T(
          "interface.messages.event_is_published_invited_guests_can_access_rsvp_you_can_unpubli",
        )
      : T(
          "food.messages.event_is_unpublished_guest_facing_event_details_and_food_remain_h",
        );
    $("publicationState").classList.toggle("success", !!e.is_published);
    $("publicationState").classList.toggle("warning", !e.is_published);
    $("publishEventButton").disabled = !!e.is_published;
    $("unpublishEventButton").disabled = !e.is_published;
    syncApplicationPublication();
  }
  function venueForm(v) {
    const f = managementForm();
    const revision = v.record_revision;
    f.dataset.formKey = "venue:" + (v.id || "new");
    const name = field(
      f,
      T("interface.messages.venue_name"),
      v.name,
      null,
      "text",
      true,
      140,
    );
    const country = field(
      f,
      T("interface.messages.country_code"),
      v.country_code,
      null,
      "text",
      false,
      2,
    );
    country.placeholder = "FO or DE";
    const address = field(
      f,
      T("interface.messages.venue_address"),
      v.address,
      null,
      "textarea",
      false,
      1000,
    );
    const savedZone = v.timezone || store.settings?.timezone || "Atlantic/Faroe";
    const timezone = field(
      f,
      T("interface.messages.venue_timezone"),
      savedZone,
      timezoneOptions(savedZone),
      "text",
      true,
    );
    const map = field(
      f,
      T("interface.messages.map_link_https"),
      v.map_url,
      null,
      "url",
      false,
      2000,
    );
    const notes = field(
      f,
      T("interface.messages.guest_venue_notes"),
      v.notes,
      null,
      "textarea",
    );
    window.RSVP_PLACEHOLDER_HELP.attach(notes, { R, T, kind: "invitation", tokens: window.RSVP_PLACEHOLDERS.tokens("venue") });
    const welcome = Object.fromEntries(
      languages()
        .filter(
          ([code]) =>
            !store.languages.length ||
            store.languages.find((language) => language.language_code === code)
              ?.enabled,
        )
        .map(([code, label]) => {
          const value =
            store.content.find(
              (content) =>
                content.content_key === "venue:" + v.id + ":welcome" &&
                content.language_code === code,
            )?.content_value ?? (code === "en" ? v.welcome_en : "");
          return [
            code,
            field(
              f,
              T("interface.messages.welcome_message") + label,
              value,
              null,
              "textarea",
              false,
              4000,
            ),
          ];
        }),
    );
    const translate = R.dom(
      "button",
      { type: "button", class: "text-button" },
      T("Translate in Languages"),
    );
    translate.dataset.requiresSection = "languages";
    translate.addEventListener("click", () => {
      tab("language");
      window.RSVP_ADMIN_TOOLS.selectVenue(v.id);
    });
    const welcomeBox = R.dom("fieldset", {
      class: "span-2 venue-welcome-editor",
    });
    welcomeBox.disabled = !can("languages", "edit");
    welcomeBox.append(
      R.dom("legend", {}, T("interface.messages.venue_welcome")),
      R.dom(
        "p",
        { class: "micro" },
        T(
          "interface.messages.appears_under_the_session_at_this_venue_on_the_guest_invitation",
        ),
      ),
    );
    for (const control of Object.values(welcome)) {
      welcomeBox.append(control.closest("label"));
      window.RSVP_PLACEHOLDER_HELP.attach(control, { R, T, kind: "invitation", tokens: window.RSVP_PLACEHOLDERS.tokens("venue") });
    }
    if (v.id) welcomeBox.append(translate);
    f.append(welcomeBox);
    const archived = field(
      f,
      T("interface.messages.archived_venue"),
      !!v.archived_at,
      null,
      "checkbox",
    );
    const form = saveForm(
      f,
      v.id
        ? T("Save")
        : T("interface.messages.create_venue"),
      () =>
        saveVersionedRecord("admin_save_venue_with_translations", {
          p_id: v.id || null,
          p_values: {
            name: name.value.trim(),
            country_code: country.value.trim().toUpperCase() || null,
            address: address.value.trim(),
            timezone: timezone.value.trim(),
            map_url: map.value.trim(),
            notes: notes.value.trim(),
            archived: archived.checked,
          },
          p_translations: can("languages", "edit")
            ? Object.fromEntries(
                Object.entries(welcome).map(([lang, control]) => [
                  lang,
                  control.value.trim(),
                ]),
              )
            : {},
        }, revision),
    );
    const footer = R.dom("div", { class: "venue-form-actions span-2" });
    footer.append(form.lastElementChild);
    if (v.id && !v.archived_at && can("food", "edit")) {
      const food = R.dom(
        "button",
        { class: "btn secondary", type: "button" },
        T("food.messages.manage_food"),
      );
      food.setAttribute("aria-haspopup", "dialog");
      food.addEventListener("click", () => venueFoodDialog(v, food));
      footer.append(food);
    }
    const archiveLabel = archived.closest("label");
    archiveLabel.classList.add("checkbox-label");
    archiveLabel.prepend(archived);
    footer.append(archiveLabel);
    form.append(footer);
    return form;
  }
  function sessionForm(s) {
    const f = managementForm();
    const revision = s.record_revision;
    f.classList.add("session-edit-form");
    f.dataset.formKey = "session:" + (s.id || "new");
    const name = field(
      f,
      T("interface.messages.session_name"),
      s.name,
      null,
      "text",
      true,
      140,
    );
    const key = field(
      f,
      T("interface.messages.session_key"),
      s.session_key,
      null,
      "text",
      true,
      80,
    );
    key.pattern = "[a-z0-9_-]+";
    const schedule = R.dom("div", { class: "session-schedule" });
    const timeRange = R.dom("div", { class: "session-time-range" });
    const venue = field(
      schedule,
      T("interface.messages.session_venue"),
      s.location_id,
      [
        ["", T("interface.messages.no_venue")],
        ...ordered(store.locations, "name")
          .filter((v) => !v.archived_at)
          .map((v) => [
            v.id,
            v.name + (v.country_code ? " · " + v.country_code : ""),
          ]),
      ],
    );
    const zone = () =>
      store.locations.find((v) => v.id === venue.value)?.timezone ||
      store.settings?.timezone ||
      "UTC";
    const starts = field(
      timeRange,
      T("interface.messages.starts_venue_local_time"),
      R.zonedInput(s.starts_at, zone()),
      null,
      "datetime-local",
    );
    const ends = field(
      timeRange,
      T("interface.messages.ends_venue_local_time"),
      R.zonedInput(s.ends_at, zone()),
      null,
      "datetime-local",
    );
    const hint = R.dom("p", { class: "micro" });
    const updateHint = () => {
      hint.textContent = T(
        "interface.messages.times_are_entered_in_zone_changing_venue_keeps_the_typed_local_ti",
        { zone: zone() },
      );
    };
    updateHint();
    venue.addEventListener("change", updateHint);
    schedule.append(timeRange, hint);
    const options = R.dom("div", { class: "session-options" });
    const rsvp = field(
      options,
      T("interface.messages.rsvp_required"),
      s.requires_rsvp !== false,
      null,
      "checkbox",
    );
    const active = field(
      options,
      T("interface.messages.active_session"),
      s.is_active !== false,
      null,
      "checkbox",
    );
    f.append(schedule, options);
    return saveForm(
      f,
      s.id
        ? T("Save")
        : T("interface.messages.create_session"),
      () =>
        saveVersionedRecord("admin_save_session", {
          p_id: s.id || null,
          p_values: {
            name: name.value.trim(),
            session_key: key.value.trim(),
            location_id: venue.value || null,
            starts_at: R.zonedInstant(starts.value, zone()),
            ends_at: R.zonedInstant(ends.value, zone()),
            requires_rsvp: rsvp.checked,
            is_active: active.checked,
          },
        }, revision),
    );
  }
  function recoverAssignmentFocus(trigger) {
    const recordKey = trigger.closest("form")?.dataset.formKey;
    if (!recordKey || trigger.isConnected || document.activeElement !== document.body) return;
    const pencil = qs('[data-record-pencil="' + CSS.escape(recordKey) + '"]:not(:disabled)');
    if (pencil?.getClientRects().length) pencil.focus({ preventScroll: true });
  }
  function assignmentDialog({
    key,
    section,
    title,
    name,
    help,
    empty,
    drawChoices,
    saveChanges,
    foodHouseholds = null,
    trigger,
  }) {
    if (
      !trigger.isConnected || !trigger.getClientRects().length ||
      !can("venues", "edit") || !can(section, "edit") || window.RSVP_POPUPS.get(key)
    ) return;
    const label = title + " · " + name;
    const dialog = window.RSVP_POPUPS.create(key, {
      class: "venue-assignment-dialog",
    }, trigger);
    dialog.setAttribute("aria-label", label);
    dialog.dataset.assignmentSection = section;
    const form = R.dom("form");
    form.append(R.dom("p", { class: "micro" }, help));
    const list = R.dom("div", { class: "venue-assignment-list" });
    const selectAllLabel = R.dom("label", {
      class: "checkbox-label venue-select-all",
    });
    const selectAll = R.dom("input", { type: "checkbox" });
    selectAllLabel.append(
      selectAll,
      document.createTextNode(T("interface.messages.select_all")),
    );
    const footer = R.dom("div", { class: "venue-assignment-footer" });
    const status = R.dom("p", { class: "small" });
    status.setAttribute("role", "status");
    const cancel = R.dom(
      "button",
      { class: "btn secondary", type: "button" },
      T("interface.messages.cancel"),
    );
    const save = R.dom(
      "button",
      { class: "btn", type: "submit" },
      T("interface.messages.save"),
    );
    async function closeDialog(button, host) {
      if (form.dataset.dirty === "true") {
        const discard = await window.RSVP_INLINE.confirm(T("Discard unsaved changes?"), {
          trigger: button, host, action: "Discard changes",
        });
        if (!discard) return;
      }
      dialog.close();
    }
    cancel.addEventListener("click", () => closeDialog(cancel, form));
    footer.append(save, cancel);
    form.append(selectAllLabel, list, status, footer);
    const heading = R.dom("h2", { id: key + ":heading" }, label);
    dialog.append(heading, form);
    const updateFood = foodHouseholds
      ? sessionFoodTab(dialog, heading, form, foodHouseholds, trigger, closeDialog)
      : null;
    const assigned = new Set();
    const updateSelection = () => {
      const count = editable.filter((check) => check.checked).length;
      const dirty = editable.some((check) => check.checked !== assigned.has(check.value));
      const busy = form.getAttribute("aria-busy") === "true";
      if (section === "invites") form.dataset.dirty = String(dirty);
      selectAll.checked = !!editable.length && count === editable.length;
      selectAll.indeterminate = count > 0 && count < editable.length;
      save.disabled = busy || !dirty;
      updateFood?.(dirty, busy);
    };
    const checks = [];
    drawChoices(
      list,
      (parent, id, label, checked, disabled = false, detail = "") => {
        const check = R.dom("input", { type: "checkbox", value: id });
        check.checked = checked;
        check.disabled = disabled;
        if (checked) assigned.add(id);
        const row = R.dom("label", { class: "checkbox-label" });
        row.append(check, document.createTextNode(label));
        if (detail) {
          const badge = R.dom("small", { class: "muted" }, detail);
          row.append(badge);
        }
        parent.append(row);
        checks.push(check);
        check.addEventListener("change", updateSelection);
      },
    );
    const editable = checks.filter((check) => !check.disabled);
    selectAllLabel.classList.toggle("hidden", !editable.length);
    if (!checks.length)
      list.append(R.dom("p", { class: "small muted" }, empty));
    updateSelection();
    selectAll.addEventListener("change", () => {
      editable.forEach((check) => {
        check.checked = selectAll.checked;
      });
      updateSelection();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (save.disabled || form.getAttribute("aria-busy") === "true") return;
      const add = editable
        .filter((check) => check.checked && !assigned.has(check.value))
        .map((check) => check.value);
      const remove = editable
        .filter((check) => !check.checked && assigned.has(check.value))
        .map((check) => check.value);
      save.disabled = cancel.disabled = true;
      form.setAttribute("aria-busy", "true");
      updateSelection();
      status.textContent = "";
      try {
        await saveChanges(add, remove);
        dialog.close();
        await reload();
        recoverAssignmentFocus(trigger);
        show(T("interface.messages.changes_saved"), "success");
      } catch (error) {
        status.textContent = R.safeError(error);
      } finally {
        form.removeAttribute("aria-busy");
        cancel.disabled = false;
        updateSelection();
      }
    });
    dialog.openInline();
    (editable.length ? selectAll : cancel).focus();
  }
  function sessionFoodTab(dialog, heading, invitationForm, households, trigger, closeDialog) {
    const key = dialog.dataset.popupKey;
    const tabs = R.dom("div", { class: "translation-tabs venue-tabs" });
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-labelledby", heading.id);
    const invitationTab = R.dom("button", { id: key + ":invitations", type: "button" }, T("Invitations"));
    const foodTab = R.dom("button", { id: key + ":food", type: "button" }, T("Food"));
    // Move the existing form into the first panel so its draft survives switching tabs.
    const invitationPanel = R.dom("div", { id: key + ":invitation-panel" });
    invitationPanel.append(invitationForm);
    const foodPanel = R.dom("div", { id: key + ":food-panel" });
    const panels = [[invitationTab, invitationPanel], [foodTab, foodPanel]];
    function select(selected) {
      for (const [button, panel] of panels) {
        const active = button === selected;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
        panel.hidden = !active;
      }
    }
    for (const [button, panel] of panels) {
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", panel.id);
      button.addEventListener("click", () => select(button));
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", button.id);
      tabs.append(button);
    }
    foodPanel.tabIndex = 0;
    select(invitationTab);
    const tableWrap = R.dom("div", { class: "venue-assignment-list session-food-roster" });
    const values = households.map((h) => {
      const state = h.food ? "allowed" : "blocked";
      const badge = R.dom("span", { class: "tag" }, T(`food.messages.food_access_${state}`));
      badge.dataset.foodStatus = state;
      return [R.householdName(h) || T("interface.messages.unnamed_household"), badge,
        T(h.food_interest === true ? "Yes" : h.food_interest === false ? "No" : "Unanswered")];
    });
    foodPanel.append(R.dom("p", { class: "micro" }, T("food.messages.food_access_session_help")));
    if (values.length) {
      tableWrap.append(makeTable([T("Household"), T("Food access"), T("Food interest")], values));
      foodPanel.append(tableWrap);
    } else foodPanel.append(R.dom("p", { class: "small muted" }, T("food.messages.food_access_no_session_households")));
    const notice = R.dom("p", { class: "micro" }, T("food.messages.food_access_scope"));
    const pending = R.dom("p", { class: "micro" }, T("food.messages.food_access_finish_session_edits"));
    const actions = R.dom("div", { class: "venue-assignment-footer session-food-actions" });
    const manage = R.dom("button", { class: "text-button", type: "button" }, T("food.messages.manage_food_access"));
    manage.setAttribute("aria-haspopup", "dialog");
    manage.addEventListener("click", () => {
      if (manage.disabled || !foodAccess.canView()) return;
      dialog.close();
      foodAccess.open(trigger, () => recoverAssignmentFocus(trigger));
    });
    const close = R.dom("button", { class: "btn secondary", type: "button" }, T("Close"));
    close.addEventListener("click", () => closeDialog(close, foodPanel));
    actions.append(manage, close);
    foodPanel.append(notice, pending, actions);
    dialog.dataset.foodAccess = "view";
    dialog.dataset.requiresHouseholdsView = "true";
    dialog.append(tabs, invitationPanel, foodPanel);
    return (dirty, busy) => {
      manage.disabled = dirty || busy;
      foodTab.disabled = close.disabled = busy;
      pending.hidden = !dirty;
    };
  }
  function venueFoodDialog(venue, trigger) {
    assignmentDialog({
      key: "venue-food:" + venue.id,
      section: "food",
      trigger,
      title: T("food.messages.venue_food"),
      name: venue.name,
      help: T(
        "interface.messages.checked_items_are_available_at_this_venue_changes_apply_here_only",
      ),
      empty: T("food.messages.no_food_items_to_manage"),
      drawChoices(list, addCheck) {
        for (const category of foodMenuCategories()) {
          const items = foodMenuItems(category.name).filter(
            (item) => item.active || item.venue_ids?.includes(venue.id),
          );
          if (!items.length) continue;
          const group = R.dom("fieldset", {
            class: "venue-assignment-category",
          });
          group.append(
            R.dom(
              "legend",
              {},
              category.name || T("interface.messages.uncategorized"),
            ),
          );
          for (const item of items) {
            const checked =
              item.venue_ids?.includes(venue.id) ||
              (item.active && item.venue_ids == null);
            addCheck(group, item.id, foodItemName(item), checked);
          }
          list.append(group);
        }
      },
      saveChanges: (add, remove) =>
        managementRpc("admin_edit_venue_food", {
          p_venue_id: venue.id,
          p_add: add,
          p_remove: remove,
        }),
    });
  }
  async function sessionHouseholdDialog(session, trigger) {
    const protectedIds = new Set(
      await managementRpc("admin_session_invitation_locks"),
    );
    const guests = new Map();
    for (const guest of store.guests.filter((g) => !g.archived_at)) {
      if (!guests.has(guest.household_id)) guests.set(guest.household_id, []);
      guests.get(guest.household_id).push(guest.id);
    }
    const invited = new Set(
      store.defaults
        .filter((d) => d.session_id === session.id && d.is_invited)
        .map((d) => d.household_id),
    );
    const overrides = new Map(
      store.overrides
        .filter((o) => o.session_id === session.id)
        .map((o) => [o.guest_id, o.is_invited]),
    );
    const tree = ordered(
      store.households.filter((h) => !h.archived_at),
      "household_name",
    );
    const visible = new Set(
      tree.filter((h) => guests.has(h.id)).map((h) => h.id),
    );
    const byId = new Map(tree.map((h) => [h.id, h]));
    for (const id of [...visible]) {
      let parent = byId.get(id)?.parent_id;
      while (parent && byId.has(parent) && !visible.has(parent)) {
        visible.add(parent);
        parent = byId.get(parent).parent_id;
      }
    }
    assignmentDialog({
      key: "session-households:" + session.id,
      section: "invites",
      trigger,
      title: T("interface.messages.manage_households"),
      name: session.name,
      help: T(
        "interface.messages.checked_households_are_invited_to_this_session_individual_guest_e",
      ),
      empty: T("interface.messages.no_households_to_manage"),
      // This roster uses saved assignments, with an individual exception winning over the household default.
      foodHouseholds: foodAccess.canView()
        ? tree.filter((h) => typeof h.food === "boolean" &&
          guests.get(h.id)?.some((id) => overrides.get(id) ?? invited.has(h.id)))
        : null,
      drawChoices(list, addCheck) {
        renderInvitationHierarchy(list, tree, visible, (h, parent) => {
          const members = guests.get(h.id);
          if (!members) {
            parent.append(
              R.dom("p", { class: "micro muted" }, R.householdName(h)),
            );
            return;
          }
          const locked = protectedIds.has(h.id);
          const flags = [
            members.some((id) => overrides.has(id))
              ? T("interface.messages.guest_exceptions")
              : null,
            locked ? T("interface.messages.protected_by_rsvp_history") : null,
          ]
            .filter(Boolean)
            .join(" · ");
          addCheck(
            parent,
            h.id,
            R.householdName(h),
            invited.has(h.id),
            locked,
            flags,
          );
        });
      },
      saveChanges: (add, remove) =>
        managementRpc("admin_edit_session_households", {
          p_session_id: session.id,
          p_add: add,
          p_remove: remove,
        }),
    });
  }
  const venuesView = window.RSVP_ADMIN_VENUES.create({
    R,
    T,
    getStore: () => store,
    isEditing: () => true,
    getLanguage: () => window.RSVP_I18N?.language || "en",
    adminTime,
    ordered,
    disclosure,
    btn,
    rpcAction,
    venueForm,
    sessionForm,
    sessionHouseholdDialog,
    show,
  });
  function renderSessions() {
    venuesView.render();
  }
  async function checkAccess() {
    const actor = user;
    if (!currentActor(actor)) return;
    resetEventLoad();
    A.clear();
    const { data: access, error } = await R.adminRpc("is_admin");
    if (!currentActor(actor)) return;
    if (error) throw error;
    if (access !== true) {
      const invitation = await R.adminRpc("admin_my_invitation");
      if (!currentActor(actor)) return;
      if (invitation.error)
        throw new Error(
          T(
            "interface.messages.your_account_does_not_have_administrator_access_or_invitation_acc",
          ),
        );
      if (!invitation.data)
        throw new Error(
          T(
            "interface.messages.no_active_administrator_invitation_was_found_for_this_account_ask",
          ),
        );
      pendingAdminInvitation = invitation.data;
      $("loginPanel").classList.add("hidden");
      $("acceptInvitationPanel").classList.remove("hidden");
      $("acceptInvitationDetails").textContent =
        invitation.data.name + " · " + invitation.data.email;
      $("invitationPasswordFields").classList.toggle(
        "hidden",
        !invitation.data.needs_password,
      );
      for (const id of ["invitationPassword", "invitationPasswordConfirm"])
        $(id).required = !!invitation.data.needs_password;
      return;
    }
    await window.RSVP_ADMIN_PREFERENCES.load(actor);
    if (!currentActor(actor)) return;
    $("acceptInvitationPanel").classList.add("hidden");
    pendingAdminInvitation = null;
    $("loginPanel").classList.add("hidden");
    $("adminTopActions").classList.remove("hidden");
    $("loggedInAs").textContent = actor.email || "";
    const previewTarget = R.guestPreviewTarget();
    if (previewTarget) {
      await A.refresh(() => currentActor(actor));
      if (!currentActor(actor)) return;
      if (A.canPreviewGuest()) {
        await R.adminRpc("admin_record_session", { p_action: "login" });
        if (currentActor(actor)) location.replace(R.guestPreviewURL(previewTarget));
        return;
      }
    }
    const fragment =
      location.hash.slice(1) === "tasks" ? "other" : location.hash.slice(1);
    activeTab = [...mainTabs, "language", "settings", "overview"].includes(fragment)
      ? fragment
      : defaultMainTab();
    tab(activeTab, false);

    const loaded = await reload();
    if (!currentActor(actor)) return;
    const logged = await R.adminRpc("admin_record_session", {
      p_action: "login",
    });
    if (!currentActor(actor)) return;
    const { databaseChangeNotice, ...entry } = history.state || {};
    if (databaseChangeNotice) {
      history.replaceState(entry, "");
      if (loaded && !logged.error && databaseChangeNotice.actor === actor.id)
        show(T(databaseChangeNotice.message), "success");
    }
    if (!loaded) return;
    if (logged.error)
      show(
        T("interface.messages.signed_in_but_session_logging_is_unavailable"),
        "warning",
      );
    if (previewTarget)
      show(
        T(
          "Guest preview requires access to Households, Invites, Venues and Food.",
        ),
        "warning",
      );
  }
  async function init() {
    document.addEventListener("rsvp:admin-access-lost", () => {
      A.clear();
      window.RSVP_ADMIN_PREFERENCES.clear();
      window.RSVP_CUSTOMIZATION?.clear(); appearanceOwner = null;
      user = null;
      resetEventLoad();
      shortcutsView.clear();
      bulkInvitesView.clear();
      transportSecurity?.clear();
      experimentalView.clear();
      databaseView.clear();
      $("adminTopActions").classList.add("hidden");
      $("loggedInAs").textContent = "";
      $("acceptInvitationPanel").classList.add("hidden");
      $("loginPanel").classList.remove("hidden");
      db?.auth.signOut({ scope: "local" }).catch(() => {});
      show(
        T("Your administrator access or session has ended. Sign in again."),
        "warning",
      );
    });

    $("adminTopActions").append(
      $("refreshButton"),
      $("themeToggle"),
      $("guestPreviewButton"),
      $("logout"),
    );
    $("refreshButton").addEventListener("click", refreshEventData);
    $("logout").addEventListener("click", async () => {
      const actor = user, button = $("logout");
      if (!currentActor(actor)) return;
      signingOut = true;
      button.disabled = true;
      eventLoadVersion++;
      showEventMenus(false);
      try {
        const logged = await R.adminRpc("admin_record_session", { p_action: "logout_requested" });
        if (logged.error)
          show(T("interface.messages.session_logging_is_unavailable"), "warning");
        const result = await db.auth.signOut();
        if (result.error) throw result.error;
        user = null;
        resetEventLoad();
        shortcutsView.clear();
        bulkInvitesView.clear();
        transportSecurity?.clear();
        experimentalView.clear();
        databaseView.clear();
        window.RSVP_ADMIN_PREFERENCES.clear();
        location.reload();
      } catch (error) {
        if (user === actor && !authRecovery?.blocksAccess()) {
          showEventMenus(eventDataActor === actor);
          $("refreshButton").disabled = false;
          show(R.safeError(error), "error");
        }
      } finally {
        signingOut = false;
        button.disabled = false;
      }
    });
    window.addEventListener("resize", updateTabOverflow);
    document.addEventListener("keydown", (event) => {
      const nav = event.target.closest('[role="tablist"]');
      if (
        !nav ||
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      )
        return;
      const buttons = Array.from(nav.querySelectorAll('[role="tab"]')).filter(
        (button) => !button.disabled && button.getClientRects().length > 0,
      );
      const index = buttons.indexOf(event.target);
      if (index < 0) return;
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
              buttons.length;
      event.preventDefault();
      buttons[next].click();
      if (nav.isConnected) buttons[next].focus();
    });
    window.addEventListener("popstate", () => {
      const fragment =
        location.hash.slice(1) === "tasks" ? "other" : location.hash.slice(1);
      tab(
        [...mainTabs, "language", "settings", "overview"].includes(fragment)
          ? fragment
          : defaultMainTab(),
        false,
      );
    });
    authRecovery = window.RSVP_ADMIN_AUTH_RECOVERY.create({
      R, T, onMessage: show,
      onBlock: () => {
        A.clear();
        window.RSVP_ADMIN_PREFERENCES.clear();
        user = null;
        resetEventLoad();
        $("loggedInAs").textContent = "";
        shortcutsView.clear();
        bulkInvitesView.clear();
        transportSecurity?.clear();
      experimentalView.clear();
        databaseView.clear();
        pendingAdminInvitation = null;
      },
    });
    // Consume recovery credentials in an isolated client before normal Auth
    // (including language configuration) can read or replace its shared session.
    await authRecovery.start();
    db = R.getClient();
    await window.RSVP_I18N.load();
    authRecovery.refreshText();
    if (!db) {
      $("loginPanel").classList.remove("hidden");
      show(
        T(
          "interface.messages.database_not_connected_complete_the_setup_wizard_first",
        ),
        "warning",
      );
      $("loginForm").querySelector("button").disabled = true;
      return;
    }
    const current = authRecovery.blocksAccess() ? null :
      (await db.auth.getUser()).data?.user;
    $("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (authRecovery.blocksAccess()) return;
      show("");
      const button = e.target.querySelector("button");
      button.disabled = true;
      try {
        const { data, error } = await db.auth.signInWithPassword({
          email: $("loginEmail").value.trim(),
          password: $("loginPassword").value,
        });
        if (error) throw error;
        user = data.user;
        await checkAccess();
      } catch (err) {
        show(R.safeError(err), "error");
      }
      button.disabled = false;
    });
    document
      .querySelectorAll("[data-tab]")
      .forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));
    document
      .querySelectorAll("[data-settings-tab]")
      .forEach((b) =>
        b.addEventListener("click", () => settingsTab(b.dataset.settingsTab)),
      );
    for (const [navId, section] of [["settingsLanguageTabs", "languages"], ["settingsInterfaceTabs", "checklist"]]) {
      const tabs = [...$(navId).querySelectorAll('[role="tab"]')];
      for (const tab of tabs) {
        tab.addEventListener("click", () => {
          if (!A.settingsAllowed(section)) return;
          // Keep open forms and drafts mounted when switching panels.
          for (const item of tabs) {
            const active = item === tab;
            item.classList.toggle("active", active);
            item.setAttribute("aria-selected", String(active));
            item.tabIndex = active ? 0 : -1;
            $(item.getAttribute("aria-controls")).hidden = !active;
          }
        });
      }
    }
    $("settingsToggle").addEventListener("click", () => tab("settings"));
    const logForm = $("logFilters");
    window.RSVP_ADMIN_LOG_DATES.attach(logForm, T);
    logForm.addEventListener("submit", (e) => {
      e.preventDefault();
      loadLogs(true);
    });
    const logMenus = logChoiceIds.map((id) => $(id));
    for (const menu of logMenus) {
      menu.addEventListener("change", () => {
        renderLogFilterCaptions();
        loadLogs(true);
      });
      menu.addEventListener("toggle", () => {
        if (menu.open) for (const other of logMenus) if (other !== menu) other.open = false;
      });
      menu.addEventListener("keydown", (event) => {
        if (!menu.open || event.key !== "Escape") return;
        event.preventDefault();
        menu.open = false;
        menu.querySelector("summary").focus();
      });
    }
    document.addEventListener("click", ({ target }) => {
      for (const menu of logMenus) if (menu.open && !menu.contains(target)) menu.open = false;
    });
    $("logActorChoices").addEventListener("click", ({ target }) => {
      const choice = target.closest("button[data-log-actor]");
      if (!choice) return;
      resetLogChoices(choice.dataset.logActor);
      $("logCategory").open = false;
      $("logCategory").querySelector("summary").focus();
      loadLogs(true);
    });
    $("logReset").addEventListener("click", () => {
      logForm.reset();
      resetLogChoices();
      loadLogs(true);
    });
    $("logMore").addEventListener("click", () => loadLogs(false));
    $("mainSectionToggle").addEventListener("click", () => tab(lastMainTab));
    $("expandHouseholds").addEventListener("click", () =>
      expandHouseholdTree(true),
    );
    $("collapseHouseholds").addEventListener("click", () =>
      expandHouseholdTree(false),
    );
    $("householdSearch").addEventListener("input", renderHouseholds);
    $("inviteSearch").addEventListener("input", invitesView.render);
    document.addEventListener("rsvp:invites-appearance", () => { if (store.settings) invitesView.render(); });
    document.addEventListener("rsvp:overview-appearance", () => {
      if (!store.settings) return;
      statisticsView.render();
      invitesView.render();
    });
    $("showArchived").addEventListener("change", renderHouseholds);
    function setFoodDisclosure(selector, open) {
      if (!open) R.closePopups();
      $("adminFoodList")
        .querySelectorAll(selector)
        .forEach((d) => {
          d.open = open;
          if (d.dataset.treeKey) expandedGroups.set(d.dataset.treeKey, open);
        });
    }
    $("expandFood").addEventListener("click", () =>
      setFoodDisclosure(".food-category", true),
    );
    $("collapseFood").addEventListener("click", () =>
      setFoodDisclosure("details[data-tree-key], details[open]", false),
    );
    $("addFoodType").addEventListener("click", (event) =>
      openFoodTypes($("newFoodType"), event.currentTarget),
    );
    $("foodSearch").addEventListener("input", renderFood);
    window.RSVP_ADMIN_SEARCH.enhance({
      R, T, iconAction,
      ids: ["householdSearch", "inviteSearch", "foodSearch", "logSearch"],
      onClear: (id, input) => { if (id === "logSearch") input.form?.requestSubmit(); },
    });
    $("addCategoryForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("categoryName"),
        name = input.value.trim();
      if (!name) return;
      const button = e.target.querySelector("button");
      button.disabled = true;
      try {
        await managementRpc("admin_save_food_category", {
          p_category_id: null,
          p_name: name,
          p_parent_id: $("newCategoryParent").value || null,
          p_expected_name: null,
          p_expected_parent: null,
        });
        input.value = "";
        await reload();
        show(T("food.messages.food_category_added"), "success");
      } catch (error) {
        show(R.safeError(error), "error");
      } finally {
        button.disabled = false;
      }
    });
    $("cancelFoodCreate").addEventListener("click", () => {
      if ($("addFoodForm").getAttribute("aria-busy") === "true") return;
      foodCreationCategory = null;
      window.RSVP_I18N.markClean($("addFoodForm"));
      $("addFoodForm").reset();
      fillNewFoodTypes("Piece(s)");
      renderFood();
    });
    $("addFoodForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = e.target.querySelector("button");
      button.disabled = true;
      const category = $("newFoodCategory").value;
      const count = Number($("newFoodQuantity").value);
      if (!Number.isInteger(count) || count < 0) {
        show(T("interface.messages.enter_a_non_negative_quantity"), "error");
        button.disabled = false;
        return;
      }
      const items = store.food.filter((f) => f.category === category);
      const record = {
        category,
        name_en: $("newFoodName").value.trim(),
        description_en: $("newFoodUserComment").value.trim() || null,
        admin_comment: $("newFoodAdminComment").value.trim() || null,
        quantity_needed: count,
        quantity_type: $("newFoodType").value || "Piece(s)",
        venue_ids: newFoodVenues(),
        active: true,
        sort_order: Math.max(0, ...items.map((f) => f.sort_order || 0)) + 1,
      };
      e.target.setAttribute("aria-busy", "true");
      for (const control of e.target.querySelectorAll(
        "input,textarea,select,button",
      ))
        control.disabled = true;
      try {
        const { error } = await db.from("food_items").insert(record);
        if (error) throw error;
        foodCreationCategory = null;
        window.RSVP_I18N.markClean(e.target);
        e.target.reset();
        fillNewFoodTypes("Piece(s)");
        await reload();
        show(T("food.messages.food_item_added"), "success");
      } catch (error) {
        show(R.safeError(error), "error");
      } finally {
        e.target.removeAttribute("aria-busy");
        for (const control of e.target.querySelectorAll(
          "input,textarea,select,button",
        ))
          control.disabled = false;
      }
    });
    $("addAdminForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = e.target.querySelector("button");
      button.disabled = true;
      $("adminInviteStatus").textContent = T(
        "interface.messages.sending_invitation",
      );
      try {
        await sendAdminInvitation({
          email: $("newAdminEmail").value.trim(),
          name: $("newAdminName").value.trim(),
        });
        e.target.reset();
        await reload();
        $("adminInviteStatus").textContent = T(
          "interface.messages.administrator_invitation_email_sent",
        );
        show(
          T("interface.messages.administrator_invitation_email_sent"),
          "success",
        );
      } catch (error) {
        $("adminInviteStatus").textContent = R.safeError(error);
        await refreshAdminInvitations();
      } finally {
        button.disabled = false;
      }
    });
    $("acceptInvitationForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!pendingAdminInvitation) return;
      const button = e.target.querySelector('button[type="submit"]');
      button.disabled = true;
      $("acceptInvitationStatus").textContent = T(
        "interface.messages.accepting_invitation",
      );
      try {
        if (pendingAdminInvitation.needs_password) {
          const password = $("invitationPassword").value;
          if (
            password.length < 12 ||
            password !== $("invitationPasswordConfirm").value
          )
            throw new Error(
              T(
                "interface.messages.enter_matching_passwords_of_at_least_12_characters",
              ),
            );
          const result = await db.auth.updateUser({ password });
          if (result.error) throw result.error;
          $("invitationPassword").value = "";
          $("invitationPasswordConfirm").value = "";
          pendingAdminInvitation.needs_password = false;
        }
        const { error } = await R.adminRpc("admin_accept_invitation", {
          p_id: pendingAdminInvitation.id,
        });
        if (error) throw error;
        history.replaceState(null, "", location.pathname);
        await checkAccess();
        show(
          T("interface.messages.administrator_invitation_accepted"),
          "success",
        );
      } catch (error) {
        $("acceptInvitationStatus").textContent = R.safeError(error);
      } finally {
        button.disabled = false;
      }
    });
    $("declineInvitationSession").addEventListener("click", async () => {
      const { error } = await db.auth.signOut();
      if (error) $("acceptInvitationStatus").textContent = R.safeError(error);
      else location.assign(location.pathname);
    });
    for (const id of ["eventSettingsForm", "languagePreferences"]) {
      const form = $(id),
        save = form.querySelector("button[type=submit]"),
        cancel = R.dom(
          "button",
          { type: "button", class: "btn secondary", "data-discard": "true" },
          T("Cancel"),
        );
      cancel.addEventListener("click", () => restoreDraft(form));
      formActions(form, save, cancel);
    }
    $("settingTimezone").addEventListener("change", ({ currentTarget: timezone }) => {
      for (const [id, key] of eventDeadlineFields) {
        const field = $(id), original = store.settings?.[key];
        // A zone-only edit changes the displayed wall time, not the saved instant.
        if (original && field.value === deadlineWallTime(original, timezone.dataset.previousZone)) {
          field.value = deadlineWallTime(original, timezone.value);
          window.RSVP_ADMIN_PREFERENCES.refreshDatePicker(field);
        }
      }
      timezone.dataset.previousZone = timezone.value;
    });
    $("eventSettingsForm").addEventListener("submit", async (e) => {
      if (e.target.querySelector("button[type=submit]").disabled) {
        e.preventDefault();
        return;
      }
      formFeedback(e.target, "saving");
      e.target.setAttribute("aria-busy", "true");
      e.target.cleanSaveUpdate?.();
      e.preventDefault();
      const timezone = $("settingTimezone").value;
      const deadlines = {};
      try {
        for (const [id, key] of eventDeadlineFields) {
          const value = $(id).value, original = store.settings[key];
          deadlines[key] = original && value === deadlineWallTime(original, timezone)
            ? original : R.zonedInstant(value, timezone);
        }
      } catch (error) {
        e.target.removeAttribute("aria-busy");
        formFeedback(e.target, "error", R.safeError(error));
        e.target.cleanSaveUpdate?.();
        return;
      }
      const settings = {
        event_name: $("settingName").value.trim(),
        event_date: $("settingDate").value || null,
        event_time: $("settingTime").value || null,
        organizer_name: $("settingOrganizerName").value.trim() || null,
        organizer_email: $("settingOrganizerEmail").value.trim() || null,
        organizer_phone: $("settingOrganizerPhone").value.trim() || null,
        ...deadlines,
        default_language: store.settings.default_language,
        fallback_language: store.settings?.fallback_language || "en",
        timezone,
        website_url: $("settingUrl").value.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await db
        .from("event_settings")
        .upsert({ id: 1, ...settings }, { onConflict: "id" });
      e.target.removeAttribute("aria-busy");
      if (error) {
        formFeedback(e.target, "error", R.safeError(error));
        show(R.safeError(error), "error");
      } else {
        formFeedback(e.target, "saved");
        window.RSVP_LOCAL_EDITORS?.saved(e.target);
        show(T("interface.messages.event_settings_saved"), "success");
        await reload();
      }
      e.target.cleanSaveUpdate?.();
    });
    $("publishEventButton").addEventListener("click", async () => {
      if (publicationBusy || !can("settings", "edit") || store.settings?.is_published) return;
      if (!$("publishAck").checked) {
        show(
          T(
            "interface.messages.confirm_the_release_acknowledgement_before_publishing",
          ),
          "warning",
        );
        return;
      }
      const ready = () =>
        store.settings?.event_name &&
        store.settings?.event_date &&
        store.settings?.website_url &&
        store.sessions.some((x) => x.is_active) &&
        store.defaults.some((x) => x.is_invited);
      if (!ready()) {
        show(
          T(
            "interface.messages.complete_the_event_name_date_website_url_active_session_and_invit",
          ),
          "error",
        );
        return;
      }
      if (
        !await window.RSVP_INLINE.confirm(T(
            "food.messages.publish_this_event_now_invite_code_holders_may_access_guest_rsvp_",
          ), { action: "Publish event" })
      )
        return;
      if (publicationBusy || !can("settings", "edit") || !$("publishAck").checked || store.settings?.is_published || !ready()) return;
      publicationBusy = true;
      syncApplicationPublication();
      try {
        const { error } = await db.from("event_settings").update({ is_published: true, updated_at: new Date().toISOString() }).eq("id", 1);
        if (error) show(R.safeError(error), "error");
        else {
          show(T("interface.messages.event_published_2"), "success");
          $("publishAck").checked = false;
          await reload();
        }
      } catch (error) { show(R.safeError(error), "error"); }
      finally { publicationBusy = false; syncApplicationPublication(); }
    });
    $("unpublishEventButton").addEventListener("click", async () => {
      if (publicationBusy || !can("settings", "edit") || !store.settings?.is_published) return;
      if (
        !await window.RSVP_INLINE.confirm(T(
            "interface.messages.unpublish_this_event_guest_access_to_published_event_details_will",
          ), { action: "Unpublish event" })
      )
        return;
      if (publicationBusy || !can("settings", "edit")) return;
      publicationBusy = true;
      syncApplicationPublication();
      try {
        const { error } = await db.from("event_settings").update({ is_published: false, updated_at: new Date().toISOString() }).eq("id", 1);
        if (error) show(R.safeError(error), "error");
        else {
          show(T("interface.messages.event_unpublished"), "success");
          await reload();
        }
      } catch (error) { show(R.safeError(error), "error"); }
      finally { publicationBusy = false; syncApplicationPublication(); }
    });

    if (current) {
      user = current;
      try {
        await checkAccess();
      } catch (e) {
        if (currentActor(current)) show(R.safeError(e), "error");
      }
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    (A.init({
      R,
      getStore: () => store,
      reload,
      isEditing: () => true,
      show,
      iconAction,
      formFeedback,
      adminTime,
      renderInvitations: renderAdminInvitations,
    }),
    window.RSVP_ADMIN_TOOLS?.init({
      R,
      getStore: () => store,
      getActor: () => user?.id || null,
      reload,
      returnToInvitesAfterDatabaseChange,
      isEditing: () => true,
      show,
      foodMenuCategories,
      foodMenuItems,
      ordered,
      iconAction,
      cleanSave,
      formFeedback,
      restoreDraft,
      formActions,
      lifecycleControls,
      footerAction,
    }),
    initContent(),
    init()).catch((e) => show(R.safeError(e), "error"));
  });
})();
