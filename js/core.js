(function () {
  "use strict";
  const T = (text, params) => window.RSVP_I18N?.t(text, params) || text;
  const coreScript = document.querySelector("script[data-app-core]");
  const siteRoot = new URL(
    "../",
    coreScript ? coreScript.src : window.location.href,
  );
  const CLIENT_STORAGE_KEY = "rsvp-manager-setup:" + siteRoot.href;
  const codePattern = /^[A-HJ-NP-Z2-9]{8}$/;
  let client = null;
  let preview = null;
  function config() {
    if (preview) return preview;
    let saved = null;
    try {
      saved = localStorage.getItem(CLIENT_STORAGE_KEY);
    } catch (_) {}
    let override = {};
    try {
      override = saved ? JSON.parse(saved) : {};
    } catch (_) {}
    const deployed = window.RSVP_CONFIG || {};
    return deployed.supabaseUrl && deployed.supabaseKey ? deployed : override;
  }
  function normalizeUrl(url) {
    const parsed = new URL(String(url || "").trim());
    const page = new URL(window.location.href);
    const localHttp =
      parsed.protocol === "http:" &&
      (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
        (page.protocol === "http:" && parsed.hostname === page.hostname));
    if (parsed.protocol !== "https:" && !localHttp) {
      throw new Error(T("Supabase URL must use HTTPS (except localhost)."));
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error(
        T(
          "Use only the Supabase project URL, with no credentials or query string.",
        ),
      );
    return parsed.origin;
  }
  function validateKey(key) {
    const clean = String(key || "").trim();
    if (!clean || clean.includes(" ") || clean.startsWith("sb_secret_"))
      throw new Error(
        T("Use only a publishable or anon key, never a secret key."),
      );
    if (clean.split(".").length === 3) {
      try {
        const part = clean.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const claims = JSON.parse(atob(part));
        if (claims.role && claims.role !== "anon") {
          const error = new Error(T("This JWT is not an anon key."));
          error.code = "INVALID_KEY_ROLE";
          throw error;
        }
      } catch (e) {
        if (e.code === "INVALID_KEY_ROLE") throw e;
        throw new Error(T("The supplied JWT key is malformed."));
      }
    } else if (!clean.startsWith("sb_publishable_"))
      throw new Error(T("Expected a publishable key or legacy anon JWT."));
    return clean;
  }
  function savePreview(url, key) {
    const validated = {
      supabaseUrl: normalizeUrl(url),
      supabaseKey: validateKey(key),
    };
    preview = validated;
    try {
      localStorage.setItem(CLIENT_STORAGE_KEY, JSON.stringify(validated));
    } catch (_) {}
    client = null;
    return validated;
  }
  function getClient() {
    if (client) return client;
    const cfg = config();
    if (!cfg.supabaseUrl || !cfg.supabaseKey) return null;
    if (!window.supabase || typeof window.supabase.createClient !== "function")
      throw new Error(
        T(
          "Supabase JavaScript library did not load. Check the network connection.",
        ),
      );
    client = window.supabase.createClient(
      normalizeUrl(cfg.supabaseUrl),
      validateKey(cfg.supabaseKey),
      {
        auth: {
          persistSession: true,
          storageKey:
            "rsvp-auth:" + siteRoot.href + ":" + normalizeUrl(cfg.supabaseUrl),
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
    return client;
  }
  async function adminRpc(name, args = {}, { notifyAccessLoss = true } = {}) {
    try {
      const result = await sendAdminRpc(name, args);
      if (
        notifyAccessLoss && ["PT401", "AUTH_SESSION_MISSING"].includes(result.error?.code) &&
        typeof document.dispatchEvent === "function"
      )
        document.dispatchEvent(new Event("rsvp:admin-access-lost"));
      return result;
    } catch (_) {
      return {
        data: null,
        error: { message: T("Could not reach the database.") },
      };
    }
  }
  async function sendAdminRpc(name, args = {}) {
    if (!/^(admin_[a-z_]+|is_admin)$/.test(name))
      return {
        data: null,
        error: { message: T("Invalid administrator action") },
      };
    const db = getClient();
    if (!db)
      return { data: null, error: { message: T("Database not configured") } };
    const expired = () => ({
      data: null,
      error: {
        code: "AUTH_SESSION_MISSING",
        message: T(
          "Your sign-in has expired. Sign in again before saving. Your edits have not been submitted.",
        ),
      },
    });
    let sessionResult = await db.auth.getSession();
    let session = sessionResult.data?.session;
    if (sessionResult.error || !session?.access_token) {
      sessionResult = await db.auth.refreshSession();
      session = sessionResult.data?.session;
    }
    if (
      sessionResult.error ||
      !session?.access_token ||
      session.access_token.startsWith("sb_")
    )
      return expired();
    const cfg = config();
    async function send(token) {
      const response = await fetch(
        normalizeUrl(cfg.supabaseUrl) + "/rest/v1/rpc/" + name,
        {
          method: "POST",
          headers: {
            apikey: validateKey(cfg.supabaseKey),
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        },
      );
      const body = await response.text();
      let value = null;
      try {
        value = body ? JSON.parse(body) : null;
      } catch (_) {
        return {
          data: null,
          error: { message: T("The server returned an unreadable response.") },
          status: response.status,
        };
      }
      return response.ok
        ? { data: value, error: null, status: response.status }
        : {
            data: null,
            error:
              typeof value === "object" && value
                ? value
                : { message: T("Administrator request failed.") },
            status: response.status,
          };
    }
    let result = await send(session.access_token);
    if (
      result.status === 401 ||
      (result.error?.code === "42501" &&
        /permission denied for function/i.test(result.error.message || ""))
    ) {
      const refreshed = await db.auth.refreshSession();
      const token = refreshed.data?.session?.access_token;
      if (refreshed.error || !token || token.startsWith("sb_"))
        return expired();
      result = await send(token);
    }
    return { data: result.data, error: result.error };
  }
  async function guestRpc(action, args) {
    try {
      const client = getClient();
      if (!client)
        return { data: null, error: new Error(T("Database not configured")) };
      let headers;
      if (action === "get_invitation_v2" || action === "acknowledge_household_visit") {
        // Reuse an existing sign-in so the gateway can suppress administrator
        // visits to real links. This does not change the guest's sign-in state.
        try {
          const session = (await client.auth.getSession()).data?.session;
          if (session?.access_token)
            headers = { Authorization: "Bearer " + session.access_token };
        } catch (_) {}
      }
      const { data, error } = await client.functions.invoke("guest-gateway", {
        body: { action, args },
        ...(headers ? { headers } : {}),
      });
      if (error?.context instanceof Response) {
        try {
          const body = await error.context.clone().json();
          if (typeof body?.error === "string" && body.error.length <= 250)
            return { data: null, error: { message: T(body.error) } };
        } catch (_) {}
      }
      return { data, error };
    } catch (_) {
      return {
        data: null,
        error: { message: T("Could not reach the database.") },
      };
    }
  }
  function randomId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    // Private HTTP test installations still have cryptographically random bytes.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }
  function invitationURL(code) {
    const url = new URL("./", siteRoot);
    url.search = "?=" + encodeURIComponent(code);
    return url.href;
  }
  function guestPreviewTarget(hash = window.location.hash) {
    return (
      /^#guest-preview=(landing|sample|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i
        .exec(hash)?.[1]
        .toLowerCase() || null
    );
  }
  function guestPreviewURL(target = "landing", admin = false) {
    const url = new URL(admin ? "admin/" : "./", siteRoot);
    url.hash = "guest-preview=" + target;
    return url.href;
  }
  function getInviteCode() {
    const raw = window.location.search.slice(1).trim();
    const params = new URLSearchParams(raw);
    const candidate =
      params.get("invite") ||
      params.get("code") ||
      params.get("") ||
      (raw.includes("=") ? "" : raw);
    const code = String(candidate || "")
      .trim()
      .toUpperCase();
    return codePattern.test(code) ? code : null;
  }
  function dom(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "class") node.className = value;
      else if (
        name === "type" ||
        name === "value" ||
        name === "max" ||
        name === "min" ||
        name === "name" ||
        name === "id" ||
        name === "placeholder"
      )
        node.setAttribute(name, value);
      else if (name === "disabled") node.disabled = !!value;
      else if (name === "title") node.title = value;
    }
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function byId(id) {
    return document.getElementById(id);
  }
  function showStatus(target, message, type = "info") {
    const node = typeof target === "string" ? byId(target) : target;
    if (!node) return;
    const scope =
      node.id === "adminMessage"
        ? "admin"
        : node.id === "guestStatus"
          ? "guest"
          : null;
    node.dataset.notificationType = type;
    const visible =
      !!message &&
      (!scope || window.RSVP_NOTIFICATIONS?.allows(scope, type) !== false);
    node.textContent = visible ? String(message) : "";
    node.classList.toggle("hidden", !visible);
    node.classList.remove("error", "warning", "success");
    if (type !== "info") node.classList.add(type);
    if (visible && scope)
      window.RSVP_NOTIFICATIONS?.decorate(node, scope, new Date());
    else if (!visible) delete node.dataset.notificationAt;
    return visible;
  }
  function dateLocale(lang) {
    try {
      const code =
        { fo: "fo-FO", en: "en-GB", de: "de-DE" }[lang] || lang || "en-GB";
      return Intl.DateTimeFormat.supportedLocalesOf(code).length
        ? code
        : "en-GB";
    } catch (_) {
      return "en-GB";
    }
  }
  function timeOptions(preference) {
    try {
      const value =
        preference ??
        (window.RSVP_ADMIN_PREFERENCES?.timeFormat ||
          localStorage.getItem("rsvp-time-format"));
      return value === "12"
        ? { hour12: true }
        : value === "24"
          ? { hourCycle: "h23" }
          : {};
    } catch (_) {
      return {};
    }
  }
  function formatDate(date, lang = "en", tz, options = {}) {
    if (!date) return "";
    // YYYY-MM-DD must not shift a calendar day when the browser's timezone differs.
    const calendarDate = /^\d{4}-\d\d-\d\d$/.test(date);
    const locale = dateLocale(lang);
    const timeZone = calendarDate ? "UTC" : tz || "UTC";
    const instant = new Date(calendarDate ? date + "T00:00:00Z" : date);
    const dateStyle = options.dateStyle || (calendarDate ? "long" : "medium");
    const time = calendarDate ? {} : {
      timeStyle: options.timeStyle || "short",
      ...timeOptions(options.timeFormat),
    };
    const dateFormat = options.dateFormat || "locale";
    if (dateFormat === "locale" && !options.separator)
      return new Intl.DateTimeFormat(locale, { dateStyle, timeZone, ...time }).format(instant);

    let formatted;
    if (dateFormat === "dots" || dateFormat === "iso") {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", timeZone,
      });
      const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
      const year = parts.year.padStart(4, "0");
      formatted = dateFormat === "dots"
        ? [parts.day, parts.month, year].join(".")
        : [year, parts.month, parts.day].join("-");
    } else {
      const parts = dateFormat === "short"
        ? { year: "numeric", month: "short", day: "numeric" }
        : { dateStyle };
      formatted = new Intl.DateTimeFormat(locale, { ...parts, timeZone }).format(instant);
    }
    if (calendarDate) return formatted;
    return formatted + (options.separator || " · ") +
      new Intl.DateTimeFormat(locale, { ...time, timeZone }).format(instant);
  }
  function formatClock(time, lang = "en", preference) {
    if (!/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(time)) return time || "";
    const instant = new Date("2000-01-01T" + time + "Z");
    return new Intl.DateTimeFormat(dateLocale(lang), {
      hour: "2-digit", minute: "2-digit", timeZone: "UTC", ...timeOptions(preference),
    }).format(instant);
  }

  function zonedInput(value, timezone) {
    if (!value) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value));
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  function zonedInstant(value, timezone) {
    if (!value) return null;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
      throw Error(T("Enter a complete date and time."));
    const wall = Date.parse(value + "Z");
    if (!Number.isFinite(wall)) throw Error(T("Invalid date and time."));
    const offsets = new Set(
      [-36, 0, 36].map((hours) => {
        const t = wall + hours * 3600000;
        return Date.parse(zonedInput(t, timezone) + "Z") - t;
      }),
    );
    const matches = [...offsets]
      .map((offset) => wall - offset)
      .filter((t) => zonedInput(t, timezone) === value);
    if (matches.length !== 1)
      throw Error(
        T(
          "This local time is ambiguous or does not exist because clocks change. Choose a time outside the clock change.",
        ),
      );
    return new Date(matches[0]).toISOString();
  }

  function safeError(error) {
    return error && typeof error.message === "string"
      ? error.message
      : T("Something went wrong.");
  }
  function dl(filename, contents, type = "text/javascript;charset=utf-8") {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function configSource() {
    const cfg = config();
    return (
      "// Event Invitation public browser configuration. NEVER add a secret/service_role key.\n" +
      "window.RSVP_CONFIG = Object.freeze(" +
      JSON.stringify(
        { supabaseUrl: cfg.supabaseUrl, supabaseKey: cfg.supabaseKey },
        null,
        2,
      ) +
      ");\n"
    );
  }
  let activePopup = null,
    popupCount = 0,
    popupHandlersInstalled = false;
  function closePopups(focus = false) {
    if (!activePopup) return;
    const { wrap, button, menu } = activePopup;
    activePopup = null;
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
    wrap.append(menu);
    if (focus && button.isConnected) button.focus();
  }
  function iconPopup(button, content) {
    installPopupHandlers();
    const wrap = dom("div", { class: "icon-popup-control" }),
      menu = dom("div", { class: "icon-popup-menu hidden" });
    menu.id = "icon-popup-" + ++popupCount;
    menu.setAttribute("role", "dialog");
    menu.setAttribute(
      "aria-label",
      button.getAttribute("aria-label") || button.title || T("Options"),
    );
    menu.append(content);
    button.setAttribute("aria-expanded", "false");

    button.setAttribute("aria-controls", menu.id);
    button.addEventListener("click", () => {
      if (activePopup?.button === button) {
        closePopups();
        return;
      }
      closePopups();
      document.body.append(menu);
      menu.classList.remove("hidden");
      button.setAttribute("aria-expanded", "true");
      activePopup = { wrap, button, menu, scrollX: window.scrollX, scrollY: window.scrollY };
      const rect = button.getBoundingClientRect(),
        size = menu.getBoundingClientRect();
      menu.style.left =
        Math.max(
          8,
          Math.min(rect.right - size.width, innerWidth - size.width - 8),
        ) + "px";
      menu.style.top =
        Math.max(
          8,
          rect.bottom + 8 + size.height > innerHeight
            ? rect.top - size.height - 8
            : rect.bottom + 8,
        ) + "px";
      menu.querySelector("select,input,button")?.focus();
    });
    wrap.append(button, menu);
    return wrap;
  }
  function installPopupHandlers() {
    if (popupHandlersInstalled) return;
    popupHandlersInstalled = true;
    document.addEventListener("click", (e) => {
      if (
        activePopup &&
        !activePopup.button.contains(e.target) &&
        !activePopup.menu.contains(e.target)
      )
        closePopups();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && activePopup) {
        e.preventDefault();
        closePopups(true);
      }
    });
    window.addEventListener("resize", () => closePopups());
    document.addEventListener(
      "scroll",
      (e) => {
        if (!activePopup || activePopup.menu.contains(e.target)) return;
        // A scroll queued before the opener was clicked has already positioned the menu.
        if (e.target === document && activePopup.scrollX === window.scrollX &&
            activePopup.scrollY === window.scrollY) return;
        closePopups();
      },
      { capture: true, passive: true },
    );
  }
  function openRecipeDialog(label, text, trigger, onPrintBlocked, popup) {
    closePopups();
    const dialog = popup || inlinePanel({ class: "food-recipe-dialog" }, trigger);
    dialog.dataset.permissionEdit = "false";
    dialog.setAttribute("aria-label", T("food.messages.recipe"));
    dialog.append(dom("h2", {}, T("food.messages.recipe") + " · " + label));
    const content = text?.trim()
      ? recipeContent(text)
      : dom("p", { class: "muted" }, T("No recipe has been added yet."));
    content.classList.add("recipe-reading");
    dialog.append(content);
    const footer = dom("div", { class: "form-actions" }),
      print = dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("interface.messages.print"),
      ),
      close = dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("Close"),
      );
    print.disabled = !text?.trim();
    print.addEventListener("click", () => {
      if (text?.trim() && !window.RSVP.printRecipe(label, text))
        onPrintBlocked?.();
    });
    close.addEventListener("click", () => dialog.close());
    footer.append(print, close);
    dialog.append(footer);
    if (!popup)
      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        },
        { once: true },
      );
    (byId("adminApp") || document.body).append(dialog);
    dialog.openInline();
    (print.disabled ? close : print).focus();
    return dialog;
  }
  function recipeContent(text) {
    const body = dom("div", { class: "recipe-content" });
    let list = null;
    for (const line of text.split(/\r?\n/)) {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        if (!list) {
          list = dom("ul");
          body.append(list);
        }
        list.append(dom("li", {}, bullet[1]));
        continue;
      }
      list = null;
      const value = line.trim();
      if (value) body.append(dom(value.endsWith(":") ? "h4" : "p", {}, value));
      else
        body.append(
          dom("div", { class: "recipe-break", "aria-hidden": "true" }),
        );
    }
    return body;
  }
  function printRecipe(label, text) {
    const view = dom("section", { class: "recipe-print-view" });
    view.append(dom("h1", {}, label), recipeContent(text));
    document.querySelector(".recipe-print-view")?.remove();
    document.body.append(view);
    window.addEventListener("afterprint", () => view.remove(), { once: true });
    window.print();
    return true;
  }

  const foodTypes = [
    "Batch(s)",
    "Piece(s)",
    "Tray(s)",
    "Packet(s)",
    "Kg",
    "Grams",
  ];
  // One display policy for editors, invitation choices and saved reviews.
  function orderedGuests(guests) {
    return [...(guests || [])].sort(
      (a, b) =>
        Number(!!a.is_child) - Number(!!b.is_child) ||
        (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) ||
        String(a.first_name || "").localeCompare(String(b.first_name || "")) ||
        String(a.last_name || "").localeCompare(String(b.last_name || "")) ||
        String(a.id || "").localeCompare(String(b.id || "")),
    );
  }
  // The stored category name stays unchanged; paths are presentation only.
  function foodCategoryTree(categories) {
    const rows = (categories || []).map((c) => ({ ...c })),
      byId = new Map(rows.filter((c) => c.id).map((c) => [c.id, c])),
      seen = new Set(),
      result = [];
    function append(c, path, depth) {
      if (seen.has(c)) return;
      seen.add(c);
      const names = [...path, c.name];
      result.push({ ...c, depth, path: names.join(" / ") });
      for (const child of rows)
        if (c.id && child.parent_id === c.id) append(child, names, depth + 1);
    }
    for (const c of rows)
      if (!c.parent_id || !byId.has(c.parent_id)) append(c, [], 0);
    // Defensive rendering for malformed imported fixtures; SQL rejects cycles.
    for (const c of rows) if (!seen.has(c)) append(c, [], 0);
    return result;
  }
  function foodCategoryWithin(categories, childId, ancestorId) {
    const byId = new Map((categories || []).map((c) => [c.id, c])),
      seen = new Set();
    let current = childId;
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = byId.get(current)?.parent_id;
    }
    return false;
  }
  function relationGroupOrder(topId, households, groups) {
    const ids = [
      ...new Set([
        ...groups
          .filter((g) => !g.planning_group_id || g.planning_group_id === topId)
          .map((g) => g.id),
        ...households.map((h) => h.relation_group_id || ""),
      ]),
    ];
    const byId = new Map(groups.map((g) => [g.id, g]));
    return ids.sort((a, b) => {
      const ar = byId.get(a),
        br = byId.get(b);
      return (
        (ar?.sort_order || 0) - (br?.sort_order || 0) ||
        (ar?.name || "").localeCompare(br?.name || "")
      );
    });
  }
  function householdTreeOrder(members, ordered) {
    const ids = new Set(members.map((h) => h.id)),
      visited = new Set(),
      result = [];
    const children = new Map();
    for (const h of members) {
      if (!children.has(h.parent_id)) children.set(h.parent_id, []);
      children.get(h.parent_id).push(h);
    }
    function visit(h) {
      if (visited.has(h.id)) return;
      visited.add(h.id);
      result.push(h);
      for (const child of ordered(children.get(h.id) || [], "household_name"))
        visit(child);
    }
    for (const root of ordered(
      members.filter((h) => !h.parent_id || !ids.has(h.parent_id)),
      "household_name",
    ))
      visit(root);
    // Match Households' fallback for malformed/cyclic data without duplicating rows.
    for (const h of members) visit(h);
    return result;
  }
  const inlinePanel = (...args) => window.RSVP_INLINE.panel(...args);
  window.RSVP = {
    householdName: window.RSVP_HOUSEHOLD_NAME,
    inlinePanel,
    relationGroupOrder,
    householdTreeOrder,
    foodCategoryTree,
    foodCategoryWithin,
    orderedGuests,
    config,
    getClient,
    adminRpc,
    guestRpc,
    guestPreviewTarget,
    guestPreviewURL,
    normalizeUrl,
    validateKey,
    savePreview,
    randomId,
    invitationURL,
    getInviteCode,
    codePattern,
    siteRoot,
    dom,
    byId,
    showStatus,
    formatDate,
    formatClock,
    timeOptions,
    zonedInput,
    zonedInstant,
    safeError,
    dl,
    configSource,
    iconPopup,
    closePopups,
    openRecipeDialog,
    recipeContent,
    printRecipe,
    foodTypes,
  };
})();
