(function () {
  "use strict";
  const R = window.RSVP;
  const previewTarget = R.guestPreviewTarget();
  const dict = {
    invitation: "interface.messages.event_invitation_2",
    welcome:
      "interface.messages.invitation_custom_we_look_forward_to_celebrating_our_day_with_you",
    enter: "interface.messages.open_your_invitation",
    codeHelp:
      "interface.messages.enter_the_eight_character_code_from_your_invitation",
    open: "interface.messages.open",
    dear: "interface.messages.dear_guests",
    who: "interface.messages.please_let_us_know_who_will_attend",
    attending: "interface.messages.attending",
    declined: "interface.messages.not_attending",
    locked: "interface.messages.your_response_has_been_received_and_locked",
    thanks: "interface.messages.thank_you_your_response_is_recorded",
    missing: "interface.messages.no_invitation_was_found_for_that_code",
    choose:
      "interface.messages.choose_a_response_for_every_invited_guest_and_session",
    offline: "interface.messages.could_not_reach_the_database",
    notPublished: "interface.messages.this_event_has_not_been_published_yet",
    food: "interface.messages.what_can_you_bring",
    foodHelp: "interface.messages.food_selection_help",
    confirmFood: "interface.messages.confirm_my_selections",
    foodDone: "food.messages.thank_you_your_food_selection_is_confirmed",
    saveFood: "interface.messages.save",
    foodSaved: "food.messages.food_selection_saved",
    available: "interface.messages.available",
    all: "interface.messages.all_invited_guests_are_listed",
  };
  let languageChange = 0,
    foodInterestDraft;
  let foodInterestSaving = false,
    foodLoadVersion = 0,
    foodReviewSignature = null,
    foodConfirmSaving = false;
  const contentTranslations = new Map();
  let rsvpCommentDraft = "",
    reviewComment = "",
    foodSavePending = false;
  const foodQuantityDrafts = new Map();
  let language = window.RSVP_I18N.language,
    eventData = null,
    invitation = null,
    code = null,
    foodState = null,
    pendingRsvp = null,
    reviewResponses = null,
    rsvpSubmitting = false;
  const $ = R.byId;
  function t(k, params = {}) {
    return window.RSVP_I18N.t(dict[k] || k, params, language);
  }
  let guestStatusTimer = null;
  let pendingVisit = null,
    visitSending = false,
    visitRetryTimer = null;
  const visitSessionId = previewTarget ? null : R.randomId();
  async function acknowledgeVisibleVisit() {
    if (previewTarget || !pendingVisit || pendingVisit.attempts >= 3 || visitSending || document.visibilityState !== "visible" || document.prerendering || $("invitationCard").classList.contains("hidden")) return;
    const visit = pendingVisit;
    visitSending = true;
    try {
      const { error } = await R.guestRpc("acknowledge_household_visit", {
        p_code: visit.code,
        p_receipt_id: visit.receipt.id,
        p_session_id: visit.receipt.sessionId,
      });
      if (!error && pendingVisit === visit) pendingVisit = null;
    } catch (_) { /* Analytics failures never become guest-page errors. */ }
    finally {
      visitSending = false;
      if (pendingVisit === visit && ++visit.attempts < 3)
        visitRetryTimer = setTimeout(acknowledgeVisibleVisit, 3000);
    }
  }
  function queueRenderedVisit(receipt, inviteCode) {
    if (previewTarget || !receipt?.id || receipt.sessionId !== visitSessionId) return;
    pendingVisit = { receipt, code: inviteCode, attempts: 0 };
    clearTimeout(visitRetryTimer);
    // Wait for the rendered invitation to reach a frame; visibility/prerender
    // changes re-check the same receipt without creating another visit.
    requestAnimationFrame(() => requestAnimationFrame(acknowledgeVisibleVisit));
  }
  function status(s, type = "info") {
    clearTimeout(guestStatusTimer);
    guestStatusTimer = null;
    preserveFoodViewport(() => {
      const visible = R.showStatus("guestStatus", s, type);
      if (visible && window.RSVP_NOTIFICATIONS?.autoDismissGuest())
        guestStatusTimer = setTimeout(() => status(""), 5000);
    });
  }
  async function setLanguage(lang, save = false) {
    const change = ++languageChange;
    language = window.RSVP_I18N.enabled(lang)
      ? lang
      : window.RSVP_I18N.defaultLanguage;
    await window.RSVP_I18N.setLanguage(language, save);
    if (change !== languageChange) return;
    document.querySelectorAll("[data-language]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.language === language);
      b.setAttribute("aria-pressed", String(b.dataset.language === language));
    });
    $("invitationDescription").textContent = t("welcome");
    $("codeCard").querySelector("h2").textContent = t("enter");
    $("codeCard").querySelector("p").textContent = t("codeHelp");
    $("codeForm").querySelector("button").textContent = t("open");
    $("saveRsvp").textContent = t("Review RSVP");
    $("confirmFood").textContent = t("interface.messages.food_review");
    $("foodCard").querySelector("h2").textContent = t("food");
    $("foodCard").querySelector("p").textContent = t("foodHelp");
    $("rsvpCommentLabel").textContent = t("RSVP comment (optional)");
    $("rsvpCommentHelp").textContent = t(
      "Dietary requirements or anything else we should know.",
    );
    $("rsvpCommentPreviewLabel").textContent = t("Comment");
    $("rsvpReviewTitle").textContent = t("Review RSVP");
    $("rsvpReviewHelp").textContent = t(
      "Check the answers for each guest and session. Confirming locks the RSVP.",
    );
    $("confirmRsvp").textContent = t("Confirm RSVP");
    $("editRsvp").textContent = t("Back to edit");
    const answers = new Map(
      Array.from(
        $("rsvpRows").querySelectorAll("input[type=radio]:checked"),
        (input) => [input.name, input.value],
      ),
    );
    renderEvent();
    if (invitation) renderInvitation(answers);
    if (foodState) renderFood();
  }
  function translated(key, legacy = {}, last = "") {
    return (
      window.RSVP_I18N.resolve(
        { ...legacy, ...contentTranslations.get(key) },
        language,
      ) || last
    );
  }
  function renderGuestBackground(background) {
    const old = $("guestPhotoBackdrop");
    if (
      !background ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(background.image || "")
    ) {
      old?.remove();
      document.body.classList.remove("guest-photo");
      return;
    }
    const crop = background.crop || {},
      numbers = ["x", "y", "width", "height", "sourceWidth", "sourceHeight"];
    if (
      !numbers.every((key) => Number.isFinite(crop[key]) && crop[key] >= 0) ||
      !crop.width ||
      !crop.height ||
      crop.x + crop.width > crop.sourceWidth ||
      crop.y + crop.height > crop.sourceHeight
    )
      return;
    const signature = background.image + JSON.stringify(crop);
    if (old?.dataset.photoSignature === signature) return;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      crop.width +
      '" height="' +
      crop.height +
      '" viewBox="' +
      [crop.x, crop.y, crop.width, crop.height].join(" ") +
      '"><image width="' +
      crop.sourceWidth +
      '" height="' +
      crop.sourceHeight +
      '" href="' +
      background.image +
      '"/></svg>';
    const layer = old || R.dom("div", { id: "guestPhotoBackdrop" });
    layer.setAttribute("aria-hidden", "true");
    layer.dataset.photoSignature = signature;
    layer.style.backgroundImage =
      'url("data:image/svg+xml;base64,' + btoa(svg) + '")';
    if (!old) document.body.prepend(layer);
    document.body.classList.add("guest-photo");
  }
  function wording(text, binding = {}) {
    const P = window.RSVP_PLACEHOLDERS;
    if (!text || !P) return text || "";
    const resolved = P.context({ ...eventData, guests: invitation?.guests || [], invitations: invitation?.invitations || [], responses: invitation?.responses || [] }, { household: invitation?.household, language, ...binding });
    if (code) resolved.values.invitation_link = R.invitationURL(code);
    try { const result = P.fill(text, resolved.values, resolved.options); return P.unresolved(result) ? window.RSVP_I18N.t("Details will follow.") : result; } catch (_) { return window.RSVP_I18N.t("Details will follow."); }
  }
  function renderEvent() {
    const event = window.RSVP_GUEST_INTERFACE.effective(eventData?.event, undefined, window.RSVP_I18N.languages);
    if (!eventData?.event) return;
    window.RSVP_NOTIFICATIONS.configure(
      "guest",
      event.notification_preferences?.guest,
    );
    document.body.dataset.guestNameLayout = event.guest_name_layout;
    renderGuestBackground(event.guest_background);
    window.RSVP_GUEST_DESIGN?.configure(event.guest_design);
    window.RSVP_THEME?.configureGuest({
      showToggle: event.guest_theme_toggle !== false,
      defaultTheme: event.guest_theme_default || "dark",
    });
    const name =
      event.event_name || window.RSVP_I18N.t("interface.messages.your_event_2");
    $("guestEventName").textContent = name;
    $("eventDate").textContent = R.formatDate(
      event.event_date,
      language,
      event.timezone,
    );
    document.title =
      name + " | " + window.RSVP_I18N.t("interface.messages.invitation");
    const content = eventData.content || {};
    $("welcomeMessage").textContent =
      wording(window.RSVP_I18N.resolve(content, language) || t("welcome"));
  }
  matchMedia("(max-width: 700px)").addEventListener("change", () => {
    if (!eventData?.event) return;
    renderEvent();
    for (const node of document.querySelectorAll("[data-guest-name-id]")) {
      const guest = invitation?.guests?.find(g => g.id === node.dataset.guestNameId);
      if (guest) {
        node.replaceChildren(...guestNameNode(guest).childNodes);
        node.closest("fieldset.rsvp-guest")?.setAttribute("aria-label", guestName(guest));
      }
    }
  });
  function sessionLabel(session) {
    return translated("session:" + session.id + ":name", {}, session.name);
  }
  function orderedInvitationGuests() {
    return R.orderedGuests(invitation?.guests);
  }
  function guestTitle(guest) {
    if (window.RSVP_GUEST_INTERFACE.effective(eventData?.event, undefined, window.RSVP_I18N.languages).guest_title_visibility?.[language] === false) return "";
    const title = guest?.courtesy_title || "";
    return title === "Son" ? t("interface.messages.son") : title === "Daughter" ? t("interface.messages.daughter") : title;
  }
  function guestLastName(guest) {
    return window.RSVP_GUEST_NAMES.lastName(guest, invitation, window.RSVP_GUEST_INTERFACE.effective(eventData?.event));
  }
  function guestName(guest) {
    return [guestTitle(guest), guest?.first_name, guestLastName(guest)].filter(Boolean).join(" ") || t("interface.messages.guest");
  }
  function guestNameNode(guest, tag = "span", attrs = {}) {
    const name = R.dom(tag, attrs);
    name.dataset.guestNameId = guest.id;
    if (guestTitle(guest)) name.append(R.dom("span", { class: "guest-courtesy-title" }, guestTitle(guest) + " "));
    name.append(document.createTextNode([guest?.first_name, guestLastName(guest)].filter(Boolean).join(" ") || t("interface.messages.guest")));
    return name;
  }
  function appendSessionDetails(card, session) {
    const venue = eventData?.locations?.find(
      (v) => v.id === session.location_id,
    );
    const zone = venue?.timezone || eventData?.event?.timezone || "UTC";
    const detailRow = R.dom("div", { class: "guest-session-details" }),
      details = R.dom("p", {
        class: "micro session-venue session-venue-lines",
      });
    const line = (text) => {
      if (text) details.append(R.dom("span", {}, text));
    };
    line(venue?.name);
    const address = (venue?.address || "").trim();
    for (const part of address
      .replace(/,?\s+(?=\d{3,6}\s+[^\d\s])/, "\n")
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean))
      line(part);
    const preferredLocale =
        language === "en" ? "en-GB" : language === "fo" ? "fo-FO" : language,
      locale = Intl.DateTimeFormat.supportedLocalesOf(preferredLocale).length
        ? preferredLocale
        : "en-GB";
    const time = (value) =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: zone,
        ...R.timeOptions(),
      }).format(new Date(value));
    const firstDate = session.starts_at
        ? R.zonedInput(session.starts_at, zone).slice(0, 10)
        : null,
      lastDate = session.ends_at
        ? R.zonedInput(session.ends_at, zone).slice(0, 10)
        : null;
    if (
      firstDate &&
      firstDate !== eventData?.event?.event_date &&
      (!lastDate || firstDate === lastDate)
    )
      line(
        new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeZone: zone,
        }).format(new Date(session.starts_at)),
      );
    if (session.starts_at && session.ends_at) {
      const multiDay = firstDate !== lastDate;
      line(
        t("interface.messages.venue_time_range", {
          start: multiDay
            ? R.formatDate(session.starts_at, language, zone)
            : time(session.starts_at),
          end: multiDay
            ? R.formatDate(session.ends_at, language, zone)
            : time(session.ends_at),
        }),
      );
    } else if (session.starts_at || session.ends_at)
      line(
        t("interface.messages.venue_time", {
          time: time(session.starts_at || session.ends_at),
        }),
      );
    if (details.childElementCount) detailRow.append(details);
    const welcome = translated("venue:" + venue?.id + ":welcome", {
      en: venue?.welcome_en,
    });
    if (welcome) card.append(R.dom("p", { class: "venue-welcome" }, wording(welcome, { venueId: venue?.id, sessionId: session.id })));
    const description = translated("session:" + session.id + ":description", {}, session.description);
    if (description) card.append(R.dom("p", { class: "session-description" }, wording(description, { venueId: venue?.id, sessionId: session.id })));
    card.append(detailRow);
    if (venue?.notes) card.append(R.dom("p", { class: "micro" }, wording(venue.notes, { venueId: venue?.id, sessionId: session.id })));
    if (venue?.map_url) {
      try {
        const url = new URL(venue.map_url);
        if (url.protocol === "https:") {
          const map = R.dom(
            "a",
            { class: "quiet-link guest-map-link" },
            t("interface.messages.map_directions"),
          );
          map.href = url.href;
          map.target = "_blank";
          map.rel = "noopener noreferrer";
          const tile = R.dom("div", { class: "guest-mini-map" }),
            thumbnail = R.dom("a", {
              class: "guest-map-thumbnail",
              href: url.href,
              target: "_blank",
              rel: "noopener noreferrer",
              "aria-label":
                t("interface.messages.map_directions") + " · " + venue.name,
            });
          const frame = R.dom("iframe", {
            title: t("interface.messages.map_directions") + " · " + venue.name,
            loading: "lazy",
            referrerpolicy: "no-referrer",
            tabindex: "-1",
            "aria-hidden": "true",
          });
          thumbnail.href = url.href;
          thumbnail.target = "_blank";
          thumbnail.rel = "noopener noreferrer";
          thumbnail.setAttribute(
            "aria-label",
            t("interface.messages.map_directions") + " · " + venue.name,
          );
          frame.loading = "lazy";
          frame.referrerPolicy = "no-referrer";
          frame.tabIndex = -1;
          frame.setAttribute("aria-hidden", "true");
          frame.src =
            "https://maps.google.com/maps?q=" +
            encodeURIComponent(
              [venue.name, venue.address].filter(Boolean).join(", "),
            ) +
            "&z=15&output=embed";
          thumbnail.append(frame);
          tile.append(thumbnail, map);
          card.prepend(tile);
        }
      } catch (_) {}
    }
  }
  function renderInvitation(answers = new Map()) {
    const h = invitation.household || {},
      locked = h.rsvp_state === "locked";
    $("rsvpComment").value = rsvpCommentDraft;
    $("rsvpComment").disabled = locked || rsvpSubmitting;
    $("householdName").textContent =
      R.householdName(h) || t(previewTarget === "sample" ? "Sample household" : "dear");
    $("invitationCard").classList.remove("hidden");
    const rows = $("rsvpRows"),
      guestHost = $("householdGuestHost");
    rows.before(guestHost);
    rows.replaceChildren();
    let answerCount = 0;
    for (const session of eventData?.sessions || []) {
      const guests = orderedInvitationGuests()
        .map((guest) => [
          guest,
          invitation.invitations?.find(
            (link) =>
              link.guest_id === guest.id && link.session_id === session.id,
          ),
        ])
        .filter(([, link]) => link);
      if (!guests.length) continue;
      const card = R.dom("section", { class: "guest-response rsvp-session" });
      const heading = R.dom("div", { class: "guest-session-heading" });
      heading.append(R.dom("h3", {}, sessionLabel(session)));
      card.append(heading);
      appendSessionDetails(card, session);
      const groups = [];
      for (const [guest, link] of guests) {
        if (!link.requires_rsvp) {
          card.append(
            guestNameNode(guest, "p", { class: "rsvp-guest small" }),
          );
          continue;
        }
        const fieldset = R.dom("fieldset", { class: "rsvp-guest rsvp-inline" });
        fieldset.setAttribute("aria-label", guestName(guest));
        const personRow = R.dom("div", { class: "rsvp-person-row" });
        personRow.append(
          guestNameNode(guest, "span", { class: "rsvp-person-name", "aria-hidden": "true" }),
        );
        const options = R.dom("div", { class: "response-options" }),
          group = [];
        const name = "reply_" + guest.id + "_" + session.id;
        for (const value of ["attending", "declined"]) {
          const label = R.dom("label", { class: "radio-pill" });
          const input = R.dom("input", {
            type: "radio",
            form: "rsvpForm",
            name,
            value,
            disabled: locked,
          });
          input.dataset.guestId = guest.id;
          input.dataset.sessionId = session.id;
          input.checked =
            (locked ? link.response : (answers.get(name) ?? link.response)) ===
            value;
          group.push(input);
          label.append(input, document.createTextNode(" " + t(value)));
          options.append(label);
        }
        personRow.append(options);
        fieldset.append(personRow);
        card.append(fieldset);
        groups.push(group);
      }
      answerCount += groups.length;
      rows.append(card);
    }
    if (!answerCount) rows.append(R.dom("p", { class: "muted" }, t("all")));
    $("saveRsvp").classList.toggle("hidden", locked || !answerCount);
    $("rsvpHint").textContent = locked
      ? t("locked")
      : answerCount
        ? t("who")
        : "";
    const cards = rows.querySelectorAll(".rsvp-session");
    (cards[cards.length - 1] || rows).append(guestHost);
    renderHouseholdGuestForm();
    renderRsvpReview();
  }
  function renderHouseholdGuestForm() {
    const host = $("householdGuestHost");
    host.replaceChildren();
    if (invitation?.household?.rsvp_state === "locked" || reviewResponses)
      return;
    if (!previewTarget && !invitation?.household?.can_add_guests) return;
    const details = R.dom("details", { class: "guest-add-person" });
    details.append(R.dom("summary", {}, t("interface.messages.add_companion")));
    const form = R.dom("form", { class: "form-grid" });
    const first = R.dom("input"),
      last = R.dom("input"),
      child = R.dom("input", { type: "checkbox" });
    first.required = true;
    first.maxLength = 120;
    last.maxLength = 120;
    first.autocomplete = "given-name";
    last.autocomplete = "family-name";
    for (const [key, input] of [
      ["interface.messages.first_name", first],
      ["interface.messages.last_name", last],
      ["interface.messages.child", child],
    ]) {
      const label = R.dom("label", {}, t(key));
      if (input === child) {
        label.className = "checkbox-label";
        label.prepend(input);
      } else label.append(input);
      form.append(label);
    }
    const actions = R.dom("div", { class: "form-actions span-2" }),
      save = R.dom(
        "button",
        { type: "submit", class: "btn" },
        t("interface.messages.add_to_household"),
      ),
      cancel = R.dom(
        "button",
        { type: "button", class: "btn secondary" },
        t("interface.messages.cancel"),
      );
    const feedback = R.dom("p", { class: "micro span-2" });
    feedback.setAttribute("role", "status");
    actions.append(save, cancel);
    form.append(actions, feedback);
    details.append(form);
    host.append(details);
    let request = null,
      busy = false;
    const update = () => {
      save.disabled = busy || !first.value.trim();
      cancel.disabled = busy;
    };
    form.addEventListener("input", () => {
      request = null;
      feedback.textContent = "";
      update();
    });
    update();
    cancel.addEventListener("click", () => {
      form.reset();
      request = null;
      details.open = false;
      feedback.textContent = "";
      update();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy || !first.value.trim()) return;
      request = request || {
        p_code: code,
        p_guest_id: R.randomId(),
        p_first_name: first.value.trim(),
        p_last_name: last.value.trim(),
        p_is_child: child.checked,
      };
      const answers = new Map(
        Array.from(
          $("rsvpRows").querySelectorAll("input[type=radio]:checked"),
          (input) => [input.name, input.value],
        ),
      );
      busy = true;
      update();
      for (const input of [first, last, child]) input.disabled = true;
      feedback.textContent = t("interface.messages.saving_progress");
      try {
        if (previewTarget) {
          if (invitation.guests.length >= 20) {
            feedback.textContent = t("interface.messages.guest_add_error");
            return;
          }
          let lastOrder = Math.max(
            0,
            ...invitation.guests.map((g) => g.sort_order ?? 0),
          );
          for (const guest of orderedInvitationGuests())
            if (guest.sort_order == null) guest.sort_order = ++lastOrder;
          invitation.guests.push({
            id: request.p_guest_id,
            first_name: request.p_first_name,
            last_name: request.p_last_name,
            is_child: request.p_is_child,
            sort_order:
              Math.max(0, ...invitation.guests.map((g) => g.sort_order ?? 0)) +
              1,
          });
          for (const session of eventData?.sessions || []) {
            const offered = invitation.invitations.find(
              (link) => link.session_id === session.id,
            );
            if (offered)
              invitation.invitations.push({
                guest_id: request.p_guest_id,
                session_id: session.id,
                requires_rsvp: offered.requires_rsvp,
                response: "pending",
              });
          }
          pendingRsvp = null;
          reviewResponses = null;
          renderInvitation(answers);
          status(t("interface.messages.guest_added"), "success");
          return;
        }
        const { data, error } = await R.guestRpc(
          "add_household_guest",
          request,
        );
        if (error || !data?.household) {
          feedback.textContent = t("interface.messages.guest_add_error");
          return;
        }
        invitation = data;
        pendingRsvp = null;
        reviewResponses = null;
        renderInvitation(answers);
        status(t("interface.messages.guest_added"), "success");
      } finally {
        busy = false;
        for (const input of [first, last, child]) input.disabled = false;
        update();
      }
    });
  }
  function renderRsvpReview() {
    const locked = invitation?.household?.rsvp_state === "locked",
      reviewing = locked || !!reviewResponses;
    $("householdGuestHost").classList.toggle("hidden", reviewing);
    $("rsvpEditor").classList.toggle("hidden", reviewing);
    $("rsvpReview").classList.toggle("hidden", !reviewing);
    $("confirmRsvp").classList.toggle("hidden", locked);
    $("editRsvp").classList.toggle("hidden", locked);
    $("confirmRsvp").disabled = $("editRsvp").disabled =
      locked || rsvpSubmitting;
    const comment = locked
      ? invitation?.household?.rsvp_comment || ""
      : reviewComment;
    $("rsvpCommentPreview").classList.toggle("hidden", !reviewing || !comment);
    $("rsvpCommentPreview").querySelector("p").textContent = comment;
    $("rsvpReviewHelp").textContent = locked
      ? t("thanks")
      : t(
          "Check the answers for each guest and session. Confirming locks the RSVP.",
        );
    const rows = $("rsvpReviewRows");
    rows.replaceChildren();
    if (!reviewing) return;
    const displayedResponses = locked
      ? (invitation.invitations || [])
          .filter(
            (link) =>
              link.requires_rsvp &&
              ["attending", "declined"].includes(link.response),
          )
          .map((link) => ({
            guest_id: link.guest_id,
            session_id: link.session_id,
            status: link.response,
          }))
      : reviewResponses || [];
    const orderedGuests = orderedInvitationGuests(),
      guests = new Map(orderedGuests.map((guest) => [guest.id, guest])),
      guestOrder = new Map(
        orderedGuests.map((guest, index) => [guest.id, index]),
      );
    for (const session of eventData?.sessions || []) {
      const responses = displayedResponses
        .filter((response) => response.session_id === session.id)
        .sort(
          (a, b) =>
            (guestOrder.get(a.guest_id) ?? Infinity) -
            (guestOrder.get(b.guest_id) ?? Infinity),
        );
      if (!responses.length) continue;
      const card = R.dom("section", {
        class: "guest-response rsvp-review-session",
      });
      const list = R.dom("ul");
      for (const response of responses) {
        const item = R.dom("li");
        item.append(
          guestNameNode(guests.get(response.guest_id)),
          R.dom("strong", {}, t(response.status)),
        );
        list.append(item);
      }
      card.append(R.dom("h4", {}, sessionLabel(session)), list);
      rows.append(card);
    }
  }
  async function loadInvitation(inviteCode) {
    const db = R.getClient();
    if (!db) return;
    status("");
    const { data, error } = await R.guestRpc("get_invitation_v2", {
      p_code: inviteCode,
      ...(visitSessionId ? { p_visit_session_id: visitSessionId } : {}),
    });
    if (error) {
      status(R.safeError(error), "error");
      return;
    }
    if (!data?.eventData) {
      status(t("missing"), "warning");
      return;
    }
    eventData = data.eventData;
    indexEventTranslations();
    renderEvent();
    if (code !== inviteCode) foodQuantityDrafts.clear();
    code = inviteCode;
    invitation = data;
    rsvpCommentDraft = data.household?.rsvp_comment || "";
    reviewComment = "";
    pendingRsvp = null;
    reviewResponses = null;
    $("rsvpRows").before($("householdGuestHost"));
    $("rsvpRows").replaceChildren();
    $("codeCard").classList.add("hidden");
    $("invitationCard").classList.remove("hidden");
    const guestLang = invitation.household?.language;
    if (
      !window.RSVP_I18N.hasPreference() &&
      window.RSVP_I18N.enabled(guestLang)
    )
      language = guestLang;
    await setLanguage(language);
    queueRenderedVisit(data.visitReceipt, inviteCode);
    await loadFood();
  }
  $("rsvpComment").addEventListener("input", () => {
    rsvpCommentDraft = $("rsvpComment").value;
  });
  function reviewRsvp(event) {
    event.preventDefault();
    if (
      !invitation ||
      (!code && !previewTarget) ||
      invitation.household?.rsvp_state === "locked" ||
      reviewResponses ||
      rsvpSubmitting
    )
      return;
    const responses = [];
    const checked = new Map(
      Array.from(
        $("rsvpRows").querySelectorAll("input[type=radio]:checked"),
        (input) => [input.name, input.value],
      ),
    );
    for (const link of invitation.invitations || []) {
      if (!link.requires_rsvp) continue;
      const name = "reply_" + link.guest_id + "_" + link.session_id,
        answer = checked.get(name);
      if (!answer) {
        status(t("choose"), "warning");
        $("rsvpForm").elements.namedItem(name)?.[0]?.focus();
        return;
      }
      responses.push({
        guest_id: link.guest_id,
        session_id: link.session_id,
        status: answer,
      });
    }
    if (!responses.length) return;
    if ($("rsvpComment").value.length > 2000) {
      status(t("RSVP comment must be at most 2000 characters"), "error");
      $("rsvpComment").focus();
      return;
    }
    rsvpCommentDraft = $("rsvpComment").value;
    reviewComment = rsvpCommentDraft.trim();
    reviewResponses = responses;
    status("");
    renderRsvpReview();
    const first = $("rsvpReviewRows").firstElementChild || $("rsvpReview");
    first.tabIndex = -1;
    first.focus();
  }
  function editRsvp() {
    if (rsvpSubmitting || invitation?.household?.rsvp_state === "locked")
      return;
    reviewResponses = null;
    status("");
    renderRsvpReview();
    $("saveRsvp").focus();
  }
  function lockReviewedRsvp(responses) {
    for (const link of invitation.invitations || []) {
      const response = responses.find(
        (answer) =>
          answer.guest_id === link.guest_id &&
          answer.session_id === link.session_id,
      );
      if (response) link.response = response.status;
    }
    invitation.household.rsvp_comment = reviewComment;
    invitation.household.rsvp_state = "locked";
    reviewResponses = null;
    renderInvitation();
  }
  async function confirmRsvp() {
    if (
      !reviewResponses ||
      rsvpSubmitting ||
      invitation?.household?.rsvp_state === "locked"
    )
      return;
    const responses = reviewResponses;
    if (previewTarget) {
      lockReviewedRsvp(responses);
      status(t("thanks"), "success");
      return;
    }
    const signature = JSON.stringify({ responses, comment: reviewComment });
    if (pendingRsvp?.signature !== signature)
      pendingRsvp = { signature, id: R.randomId() };
    rsvpSubmitting = true;
    $("confirmRsvp").disabled = true;
    $("editRsvp").disabled = true;
    status("");
    try {
      const { error } = await R.guestRpc("submit_household_rsvp", {
        p_code: code,
        p_request_id: pendingRsvp.id,
        p_responses: responses,
        p_comment: reviewComment || null,
      });
      if (error) {
        status(R.safeError(error), "error");
        return;
      }
      lockReviewedRsvp(responses);
      await loadInvitation(code);
      status(t("thanks"), "success");
    } finally {
      rsvpSubmitting = false;
      const locked = invitation?.household?.rsvp_state === "locked";
      $("confirmRsvp").disabled = $("editRsvp").disabled = locked;
    }
  }
  async function loadFood() {
    if (foodInterestSaving) return;
    const revision = ++foodLoadVersion;
    const db = R.getClient();
    try {
      const { data, error } = await R.guestRpc("get_household_food", {
        p_code: code,
      });
      if (revision !== foodLoadVersion || foodInterestSaving) return;
      if (error || !data || !Array.isArray(data.items)) {
        $("foodCard").classList.add("hidden");
        return;
      }
      // The database must itself restrict food data to households with food access.
      foodState = data;
      $("foodCard").classList.remove("hidden");
      renderFood();
    } catch (_) {
      $("foodCard").classList.add("hidden");
    }
  }
  async function saveFoodInterest(chosen) {
    const original = foodState.interest ?? null;
    if (foodInterestSaving || foodSavePending || chosen === original) return;
    foodInterestDraft = chosen;
    foodInterestSaving = true;
    ++foodLoadVersion;
    renderFood();
    try {
      if (previewTarget) {
        foodState.interest = chosen;
        foodInterestDraft = undefined;
        status(t("foodSaved"), "success");
        return;
      }
      const { data, error } = await R.guestRpc("set_household_food_interest", {
        p_code: code,
        p_interest: chosen,
        p_expected_interest: original,
      });
      if (error || !data) {
        foodInterestDraft = undefined;
        status(t("interface.messages.food_interest_failed"), "error");
        return;
      }
      foodState = data;
      foodInterestDraft = undefined;
      status(t("interface.messages.food_interest_saved"), "success");
    } catch (_) {
      foodInterestDraft = undefined;
      status(t("interface.messages.food_interest_failed"), "error");
    } finally {
      foodInterestSaving = false;
      renderFood();
    }
  }
  function renderFoodInterest() {
    const host = $("foodInterestHost");
    host.replaceChildren();
    const original = foodState.interest ?? null;
    const choices = R.dom("div", { class: "food-interest-choices" });
    choices.setAttribute("role", "group");
    choices.setAttribute(
      "aria-label",
      t("interface.messages.food_interest_question"),
    );
    choices.setAttribute("aria-busy", String(foodInterestSaving));
    for (const value of [true, false]) {
      const button = R.dom(
        "button",
        { type: "button", class: "food-interest-choice guest-response" },
        t(
          "interface.messages." +
            (value ? "food_interest_yes" : "food_interest_no"),
        ),
      );
      button.setAttribute("aria-label", button.textContent);
      button.setAttribute(
        "aria-pressed",
        String(
          (foodInterestDraft === undefined ? original : foodInterestDraft) ===
            value,
        ),
      );
      button.disabled = foodInterestSaving || foodSavePending;
      button.addEventListener("click", () => saveFoodInterest(value));
      choices.append(button);
    }
    host.append(choices);
    if (
      foodState.stage === "interest" &&
      original === true &&
      !foodInterestSaving
    ) {
      const event = eventData?.event || {},
        fallback =
          window.RSVP_I18N.resolve(
            event.food_interest_reply_fallback || {},
            language,
          ) ||
          t("Thank you! We’ll share more information about the food later.");
      let message;
      try {
        message = window.RSVP_FOOD_INTEREST_REPLY.render(
          window.RSVP_I18N.resolve(event.food_interest_reply || {}, language),
          {
            deadline: event.rsvp_deadline,
            values: window.RSVP_PLACEHOLDERS.context({ ...eventData, guests: invitation?.guests || [], invitations: invitation?.invitations || [], responses: invitation?.responses || [] }, { household: invitation?.household, language }).values,
            timezone: event.timezone || "UTC",
            language,
            fallback,
          },
        );
      } catch (_) {
        message = t(
          "Thank you! We’ll share more information about the food later.",
        );
      }
      host.append(
        R.dom(
          "p",
          { class: "food-interest-reply", id: "foodInterestReply" },
          message,
        ),
      );
    }
  }
  function preserveFoodViewport(update) {
    const list = $("foodList"),
      visible = (node) => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      };
    const choices =
      list && !list.classList.contains("hidden")
        ? Array.from(
            list.querySelectorAll("button[data-item-id],button[data-group-id]"),
          )
        : [];
    const focused = choices.includes(document.activeElement)
      ? document.activeElement
      : null;
    const anchor =
      focused && visible(focused) ? focused : choices.find(visible);
    if (!anchor) {
      update();
      return;
    }
    const key = anchor.dataset.groupId ? "groupId" : "itemId",
      value = anchor.dataset[key],
      top = anchor.getBoundingClientRect().top;
    update();
    if (list.classList.contains("hidden")) return;
    const current = Array.from(
      list.querySelectorAll("button[data-item-id],button[data-group-id]"),
    ).find((node) => node.dataset[key] === value);
    if (!current) return;
    if (focused === anchor && !current.disabled)
      current.focus({ preventScroll: true });
    const delta = current.getBoundingClientRect().top - top;
    if (Math.abs(delta) > 0.5)
      window.scrollBy({ top: delta, left: 0, behavior: "instant" });
  }
  function renderFood() {
    preserveFoodViewport(() => {
      renderFoodContent();
      renderFoodReview();
    });
  }
  function renderFoodContent() {
    if (!foodState) return;
    const interestOnly = foodState.stage === "interest",
      showSelection = !interestOnly && foodState.interest === true;
    $("foodCard").querySelector("h2").textContent = t("food");
    $("foodCard").querySelector("p").textContent =
      wording(window.RSVP_I18N.resolve(
        eventData?.event?.food_introduction || {},
        language,
      ) || t("interface.messages.food_interest_help"));
    renderFoodInterest();
    let prompt = $("foodSelectionPrompt");
    if (!prompt) {
      prompt = R.dom("p", {
        id: "foodSelectionPrompt",
        class: "food-selection-prompt",
      });
      $("foodList").before(prompt);
    }
    prompt.textContent = t("foodHelp");
    prompt.classList.toggle("hidden", !showSelection);
    $("foodList").classList.toggle("hidden", !showSelection);
    if (!showSelection) {
      $("foodList").replaceChildren();
      $("confirmFood").classList.add("hidden");
      $("foodHint").textContent = "";
      return;
    }
    const expanded = new Set(
      Array.from($("foodList").querySelectorAll("details[open]")).map(
        (n) => n.dataset.itemId,
      ),
    );
    $("foodList").replaceChildren();
    const claimed = foodState.claims || [];
    const confirmed = !!foodState.confirmed;
    const categories = new Map(),
      groups = new Map((foodState.groups || []).map((g) => [g.id, g]));
    const categorySections = new Map(),
      categoryNodes = R.foodCategoryTree(foodState.categories || []),
      categoryById = new Map(categoryNodes.map((c) => [c.id, c]));
    const categoryHost = (category) => {
      const name = category || "";
      if (categories.has(name)) return categories.get(name);
      const c = categoryNodes.find((c) => c.name === name),
        section = R.dom("section", { class: "guest-food-category" });
      if (c?.id) section.dataset.categoryId = c.id;
      section.append(
        R.dom(
          "h3",
          {},
          translated(
            "food-category:" + (c?.id || name) + ":name",
            { en: name },
            t("interface.messages.uncategorized"),
          ),
        ),
      );
      const list = R.dom("div", { class: "food-list" });
      section.append(list);
      categories.set(name, list);
      categorySections.set(name, section);
      const parent = categoryById.get(c?.parent_id);
      if (parent) {
        categoryHost(parent.name);
        categorySections.get(parent.name).append(section);
      } else $("foodList").append(section);
      return list;
    };
    for (const c of categoryNodes) categoryHost(c.name);
    const groupHosts = new Map();
    for (const group of groups.values()) {
      const members = (group.item_ids || []).map((id) =>
        (foodState.items || []).find((item) => item.id === id),
      );
      const own = (group.item_ids || []).some((id) =>
        claimed.some((c) => c.food_item_id === id),
      );
      const available =
        members.length >= 2 &&
        members.every(
          (item) =>
            item &&
            ((item.quantity_needed || 0) - (item.claimed_total || 0) > 0 ||
              claimed.some((c) => c.food_item_id === item.id)),
        );
      if (!own && !available) continue;
      const wrap = R.dom("section", {
          class: "food-item guest-food-choice guest-food-group",
        }),
        summary = R.dom("button", {
          type: "button",
          class: "food-interest-choice guest-response",
        }),
        name =
          window.RSVP_I18N.resolve(
            { en: group.name, ...group.translations },
            language,
          ) || group.name;
      wrap.dataset.groupId = group.id;
      const information = R.dom("details", { class: "guest-food-information" });
      information.dataset.itemId = "group:" + group.id;
      information.open = expanded.has("group:" + group.id);
      information.append(
        R.dom("summary", {}, t("interface.messages.group_items")),
      );
      summary.textContent = name;
      summary.setAttribute("aria-label", name);
      summary.setAttribute("aria-pressed", String(own));
      summary.dataset.groupId = group.id;
      const detail = R.dom("div", { class: "guest-food-details" }),
        list = R.dom("div", { class: "food-list" });
      detail.append(
        R.dom(
          "p",
          { class: "small" },
          t("interface.messages.group_commitment"),
        ),
        list,
      );
      const partial =
        own &&
        members.some(
          (item) => !item || !claimed.some((c) => c.food_item_id === item.id),
        );
      const corrected = (group.item_ids || []).some((id) =>
        claimed.some((c) => c.food_item_id === id && c.quantity !== 1),
      );
      if (partial)
        detail.append(
          R.dom(
            "p",
            { class: "small" },
            t("interface.messages.food_group_partial"),
          ),
        );
      const unavailable = corrected || members.some((item) => !item);
      summary.disabled =
        confirmed ||
        foodInterestSaving ||
        foodSavePending ||
        unavailable ||
        (!!group.archived_at && !own);
      if (unavailable)
        detail.append(
          R.dom(
            "p",
            { class: "small" },
            t("interface.messages.food_group_unavailable"),
          ),
        );
      summary.addEventListener("click", () =>
        saveFoodGroup(group, own ? 0 : 1, summary),
      );
      information.append(detail);
      wrap.append(summary, information);
      categoryHost(group.category).append(wrap);
      groupHosts.set(group.id, list);
    }
    for (const item of foodState.items || []) {
      if (item.food_group_id && !groupHosts.has(item.food_group_id)) continue;
      const mine =
        claimed.find((c) => c.food_item_id === item.id)?.quantity || 0;
      const available = Math.max(
        0,
        (item.quantity_needed || 0) - (item.claimed_total || 0),
      );
      if (!mine && available === 0) continue;
      const wrap = R.dom("details", {
          class: "food-item guest-food-disclosure",
        }),
        heading = R.dom("summary");
      const label = translated(
        "food:" + item.id + ":name",
        { en: item.name_en },
        window.RSVP_I18N.t("food.messages.food_item"),
      );
      wrap.dataset.itemId = item.id;
      wrap.open = expanded.has(item.id);
      heading.classList.add("guest-food-heading");
      heading.append(R.dom("strong", {}, label));
      if (mine)
        heading.append(
          R.dom(
            "span",
            { class: "tag" },
            window.RSVP_I18N.t("interface.messages.selected"),
          ),
        );
      const detail = R.dom("div", { class: "guest-food-details" });
      if (item.food_group_id)
        detail.append(
          R.dom(
            "p",
            { class: "micro food-availability" },
            t("Needed: {needed} · Still available: {available} · {unit}", {
              needed: item.quantity_needed,
              available,
              unit: t(
                window.RSVP_I18N.unitSource(item.quantity_type || "Piece(s)"),
              ),
            }),
          ),
        );
      const description = translated("food:" + item.id + ":description", {
        en: item.description_en,
      });
      if (description)
        detail.append(
          R.dom(
            "p",
            { class: "small guest-food-note" },
            window.RSVP_I18N.t("interface.messages.guest_note") +
              ": " +
              description,
          ),
        );
      if (item.recipe_text) {
        const recipe = R.dom(
          "button",
          { type: "button", class: "text-button quiet-link" },
          t("food.messages.recipe"),
        );

        recipe.addEventListener("click", () =>
          R.openRecipeDialog(label, item.recipe_text, recipe, () =>
            status(
              t("food.messages.allow_pop_ups_to_save_the_recipe_as_pdf"),
              "warning",
            ),
          ),
        );
        detail.append(recipe);
      }
      if (!item.food_group_id) {
        const card = R.dom("section", { class: "food-item guest-food-choice" }),
          choice = R.dom(
            "button",
            { type: "button", class: "food-interest-choice guest-response" },
            label,
          );
        card.dataset.itemId = item.id;
        choice.dataset.itemId = item.id;
        choice.setAttribute("aria-label", label);
        choice.setAttribute("aria-pressed", String(!!mine));
        choice.disabled =
          confirmed ||
          foodInterestSaving ||
          foodSavePending ||
          (!!item.archived_at && !mine);
        const quantityLabel = R.dom(
            "label",
            { class: "guest-food-quantity" },
            t("Quantity"),
          ),
          quantity = R.dom("input", {
            type: "number",
            min: "1",
            max: String(
              Math.min(
                1000,
                item.archived_at ? mine : Math.max(mine, available + mine),
              ),
            ),
            step: "1",
            value: String(mine || foodQuantityDrafts.get(item.id) || 1),
          });
        quantity.dataset.itemId = item.id;
        quantity.addEventListener("input", () => {
          if (!mine) foodQuantityDrafts.set(item.id, quantity.value);
        });
        quantity.setAttribute(
          "aria-label",
          t("Quantity for {item}", { item: label }),
        );
        quantity.disabled = choice.disabled;
        quantityLabel.append(quantity);
        const feedback = R.dom("p", {
          class: "micro food-quantity-feedback",
          role: "alert",
        });
        feedback.hidden = true;
        const valid = () => {
          const n = Number(quantity.value),
            max = Number(quantity.max);
          const ok =
            quantity.value !== "" && Number.isInteger(n) && n >= 1 && n <= max;
          feedback.hidden = ok;
          feedback.textContent = ok
            ? ""
            : t("Select between 1 and {max}.", { max });
          return ok;
        };
        quantity.addEventListener("change", () => {
          if (valid() && mine && Number(quantity.value) !== mine)
            saveFood(item.id, Number(quantity.value), quantity);
        });
        choice.addEventListener("click", () => {
          if (mine) saveFood(item.id, 0, choice);
          else if (valid()) saveFood(item.id, Number(quantity.value), choice);
          else quantity.focus();
        });
        card.append(
          choice,
          quantityLabel,
          R.dom(
            "p",
            { class: "micro food-availability" },
            t("Needed: {needed} · Still available: {available} · {unit}", {
              needed: item.quantity_needed,
              available,
              unit: t(
                window.RSVP_I18N.unitSource(item.quantity_type || "Piece(s)"),
              ),
            }),
          ),
          feedback,
        );
        if (description) {
          const note = detail.querySelector(".guest-food-note");
          if (note) card.append(note);
        }

        if (detail.childElementCount) {
          wrap.className = "guest-food-information";
          heading.replaceChildren(
            document.createTextNode(
              [
                description ? t("interface.messages.guest_note") : null,
                item.recipe_text ? t("food.messages.recipe") : null,
              ]
                .filter(Boolean)
                .join(" · "),
            ),
          );
          wrap.append(heading, detail);
          card.append(wrap);
        }
        categoryHost(item.category).append(card);
      } else {
        wrap.append(heading, detail);
        groupHosts.get(item.food_group_id).append(wrap);
      }
    }
    for (const section of [...categorySections.values()].reverse())
      if (!section.querySelector(".guest-food-choice")) section.remove();
    $("confirmFood").classList.toggle("hidden", confirmed || !claimed.length);
    $("confirmFood").disabled = foodInterestSaving || foodSavePending;
    $("foodHint").textContent = "";
  }
  async function saveFoodGroup(group, quantity, button) {
    if (foodSavePending || foodConfirmSaving || foodInterestSaving) return;
    foodSavePending = true;
    button.disabled = true;
    try {
      if (previewTarget) {
        for (const id of group.item_ids || []) {
          const old =
              foodState.claims.find((c) => c.food_item_id === id)?.quantity ||
              0,
            item = foodState.items.find((i) => i.id === id);
          if (item) item.claimed_total += (quantity ? 1 : 0) - old;
          foodState.claims = foodState.claims.filter(
            (c) => c.food_item_id !== id,
          );
          if (quantity)
            foodState.claims.push({ food_item_id: id, quantity: 1 });
        }
      } else {
        const { error } = await R.guestRpc("set_household_food_group", {
          p_code: code,
          p_group_id: group.id,
          p_quantity: quantity,
        });
        await loadFood();
        status(
          error ? t("interface.messages.food_group_error") : t("foodSaved"),
          error ? "error" : "success",
        );
      }
    } catch (error) {
      status(R.safeError(error), "error");
    } finally {
      foodSavePending = false;
      button.disabled = false;
      renderFood();
    }
  }
  async function saveFood(itemId, quantity, button) {
    if (
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > 1000 ||
      foodSavePending ||
      foodConfirmSaving
    )
      return;
    const notes =
      foodState.claims.find((claim) => claim.food_item_id === itemId)?.notes ??
      null;
    const restoreFocus =
      document.activeElement === button && button.tagName === "INPUT";
    foodSavePending = true;
    button.disabled = true;
    try {
      if (previewTarget) {
        const item = foodState.items.find((item) => item.id === itemId),
          old =
            foodState.claims.find((claim) => claim.food_item_id === itemId)
              ?.quantity || 0;
        if (
          !item ||
          quantity >
            Math.max(
              old,
              (item.quantity_needed || 0) - (item.claimed_total || 0) + old,
            )
        )
          return;
        item.claimed_total += quantity - old;
        foodState.claims = foodState.claims.filter(
          (claim) => claim.food_item_id !== itemId,
        );
        if (quantity)
          foodState.claims.push({ food_item_id: itemId, quantity, notes });
        status(t("foodSaved"), "success");
      } else {
        const { error } = await R.guestRpc("set_household_food_claim", {
          p_code: code,
          p_food_item_id: itemId,
          p_quantity: quantity,
          p_notes: notes,
        });
        status(
          error ? R.safeError(error) : t("foodSaved"),
          error ? "error" : "success",
        );
        await loadFood();
      }
    } catch (error) {
      status(R.safeError(error), "error");
    } finally {
      foodSavePending = false;
      button.disabled = false;
      renderFood();
      if (restoreFocus) {
        const current = Array.from(
          $("foodList").querySelectorAll("input[data-item-id]"),
        ).find((n) => n.dataset.itemId === itemId);
        if (current && !current.disabled)
          current.focus({ preventScroll: true });
      }
    }
  }
  function foodSelectionSignature() {
    return JSON.stringify(
      (foodState?.claims || [])
        .map((c) => [c.food_item_id, c.quantity])
        .sort((a, b) => a[0].localeCompare(b[0])),
    );
  }
  function reviewFood() {
    if (
      !foodState?.claims?.length ||
      foodInterestSaving ||
      foodConfirmSaving ||
      foodSavePending
    )
      return;
    foodReviewSignature = foodSelectionSignature();
    renderFood();
    $("foodReviewTitle").focus();
  }
  function renderFoodReview() {
    let review = $("foodReview");
    if (!review) {
      review = R.dom("section", { id: "foodReview", class: "hidden" });
      review.setAttribute("aria-labelledby", "foodReviewTitle");
      $("foodList").after(review);
    }
    if (
      foodReviewSignature &&
      foodReviewSignature !== foodSelectionSignature()
    ) {
      foodReviewSignature = null;
      status(t("interface.messages.food_review_changed"), "warning");
    }
    const confirmed = !!foodState?.confirmed,
      show = confirmed || !!foodReviewSignature;
    let followup = $("foodFollowup");
    if (!followup) {
      followup = R.dom("p", {
        id: "foodFollowup",
        class: "small food-followup",
      });
      $("foodCard").append(followup);
    }
    followup.textContent = t("interface.messages.food_followup");
    followup.classList.toggle("hidden", !foodState?.claims?.length);
    review.classList.toggle("hidden", !show);
    $("foodCard").classList.toggle("food-reviewing", show);
    $("foodInterestHost").classList.toggle("hidden", show);
    $("foodList").classList.toggle(
      "hidden",
      show || foodState?.stage === "interest" || foodState?.interest !== true,
    );
    $("foodSelectionPrompt")?.classList.toggle(
      "hidden",
      show || foodState?.stage === "interest" || foodState?.interest !== true,
    );
    $("confirmFood").textContent = t("interface.messages.food_review");
    $("confirmFood").classList.toggle(
      "hidden",
      show ||
        !foodState?.claims?.length ||
        foodState?.interest !== true ||
        foodState?.stage === "interest",
    );
    if (!show) {
      review.replaceChildren();
      review.foodRenderKey = null;
      return;
    }
    const renderKey = JSON.stringify([
      foodSelectionSignature(),
      language,
      confirmed,
      foodConfirmSaving,
      (foodState.items || []).map((i) => [i.id, i.name_en, i.recipe_text]),
    ]);
    if (review.foodRenderKey === renderKey) return;
    review.foodRenderKey = renderKey;
    R.closePopups();
    review.replaceChildren();
    const title = R.dom(
      "h3",
      { id: "foodReviewTitle" },
      t("interface.messages.food_review"),
    );
    title.tabIndex = -1;
    const summary = R.dom("section", {
      class: "guest-response rsvp-review-session food-review-summary",
    });
    summary.append(title);
    if (confirmed) {
      const message = R.dom(
        "p",
        { class: "small", role: "status" },
        t("foodDone"),
      );
      message.setAttribute("role", "status");
      review.append(message);
    }
    review.append(summary);
    const list = R.dom("ul", { class: "food-review-list" });
    for (const claim of foodState.claims || []) {
      const item = foodState.items.find((i) => i.id === claim.food_item_id),
        name = item
          ? translated(
              "food:" + item.id + ":name",
              { en: item.name_en },
              item.name_en,
            )
          : t("food.messages.food_item"),
        row = R.dom("li");
      row.append(R.dom("span", {}, claim.quantity + " × " + name));
      if (item?.recipe_text) {
        const button = R.dom(
          "button",
          { type: "button", class: "text-button quiet-link" },
          t("food.messages.recipe"),
        );
        button.setAttribute(
          "aria-label",
          t("food.messages.recipe") + " · " + name,
        );

        button.addEventListener("click", () =>
          R.openRecipeDialog(name, item.recipe_text, button, () =>
            status(
              t("food.messages.allow_pop_ups_to_save_the_recipe_as_pdf"),
              "warning",
            ),
          ),
        );
        row.append(button);
      }
      list.append(row);
    }
    summary.append(list);
    if (!confirmed) {
      const actions = R.dom("div", { class: "form-actions" }),
        confirm = R.dom(
          "button",
          { id: "foodReviewConfirm", type: "button", class: "btn" },
          t("confirmFood"),
        ),
        back = R.dom(
          "button",
          { type: "button", class: "btn secondary" },
          t("Back to edit"),
        );
      confirm.disabled = back.disabled = foodConfirmSaving;
      confirm.addEventListener("click", confirmFood);
      back.addEventListener("click", () => {
        foodReviewSignature = null;
        R.closePopups();
        renderFood();
        $("confirmFood").focus();
      });
      actions.append(confirm, back);
      review.append(actions);
    }
  }
  async function confirmFood() {
    if (
      (!code && !previewTarget) ||
      !foodReviewSignature ||
      foodConfirmSaving ||
      foodSavePending
    )
      return;
    if (foodReviewSignature !== foodSelectionSignature()) {
      foodReviewSignature = null;
      renderFood();
      status(t("interface.messages.food_review_changed"), "warning");
      return;
    }
    foodConfirmSaving = true;
    renderFoodReview();
    try {
      if (previewTarget) {
        foodState.confirmed = true;
        foodReviewSignature = null;
        renderFood();
        status(t("foodDone"), "success");
        return;
      }
      const { error } = await R.guestRpc("confirm_household_food", {
        p_code: code,
        p_expected_claims: JSON.parse(foodReviewSignature).map(
          ([food_item_id, quantity]) => ({ food_item_id, quantity }),
        ),
      });
      if (error) {
        await loadFood();
        status(R.safeError(error), "error");
        return;
      }
      foodReviewSignature = null;
      await loadFood();
      status(t("foodDone"), "success");
    } finally {
      foodConfirmSaving = false;
      renderFoodReview();
    }
  }
  async function openPreview() {
    const signIn = $("guestPreviewSignIn");
    signIn.href = R.guestPreviewURL(previewTarget, true);
    const { data, error } = await R.adminRpc("admin_guest_preview", {
      p_household_id: ["sample", "landing"].includes(previewTarget)
        ? null
        : previewTarget,
      p_sample: previewTarget === "sample",
    });
    if (error || !data?.eventData) {
      const needsSignIn = ["PT401", "AUTH_SESSION_MISSING"].includes(
        error?.code,
      );
      signIn.classList.toggle("hidden", !needsSignIn);
      status(
        needsSignIn
          ? t("Sign in with an administrator account to open this preview.")
          : t(R.safeError(error)),
        "warning",
      );
      return;
    }
    eventData = data.eventData;
    invitation = data.invitation;
    rsvpCommentDraft = invitation?.household?.rsvp_comment || "";
    foodState = data.food;
    indexEventTranslations();
    $("languageSwitcher").classList.remove("hidden");
    $("codeCard").classList.toggle("hidden", !!invitation);
    for (const input of $("codeForm").elements) input.disabled = true;
    $("foodCard").classList.toggle("hidden", !foodState);
    await setLanguage(
      invitation?.household?.language ||
        eventData.event.default_language ||
        language,
    );
  }
  function indexEventTranslations() {
    contentTranslations.clear();
    for (const entry of eventData.translations || []) {
      if (!contentTranslations.has(entry.content_key))
        contentTranslations.set(entry.content_key, {});
      contentTranslations.get(entry.content_key)[entry.language_code] =
        entry.content_value;
    }
  }
  async function init() {
    const rawCode = previewTarget ? null : R.getInviteCode();
    // Clean the query before any network calls, even when the event is unpublished.
    $("languageSwitcher").classList.toggle("hidden", !rawCode);
    $("adminLink").classList.toggle("hidden", !!rawCode);
    if (window.location.search)
      history.replaceState(
        history.state,
        "",
        window.location.pathname + window.location.hash,
      );
    await window.RSVP_I18N.load();
    language = window.RSVP_I18N.language;
    $("languageSwitcher").addEventListener("click", (e) => {
      const button = e.target.closest("[data-language]");
      if (button) setLanguage(button.dataset.language, !previewTarget);
    });
    if (!previewTarget)
      $("codeForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const candidate = $("inviteCode").value.toUpperCase().trim();
        if (!R.codePattern.test(candidate)) {
          status(
            window.RSVP_I18N.t("interface.messages.invalid_invitation_code"),
            "warning",
          );
          return;
        }
        window.location.assign(R.invitationURL(candidate));
      });
    $("rsvpForm").addEventListener("submit", reviewRsvp);
    $("confirmRsvp").addEventListener("click", confirmRsvp);
    $("editRsvp").addEventListener("click", editRsvp);
    $("confirmFood").addEventListener("click", reviewFood);
    if (previewTarget) {
      $("adminLink").classList.add("hidden");
      await openPreview();
      return;
    }
    const refreshFood = () => {
      if (foodState && !foodInterestSaving && !document.hidden) loadFood();
    };
    const foodRefresh = setInterval(refreshFood, 30000);
    window.addEventListener("focus", refreshFood);
    document.addEventListener("visibilitychange", refreshFood);
    document.addEventListener("visibilitychange", acknowledgeVisibleVisit);
    document.addEventListener("prerenderingchange", acknowledgeVisibleVisit);
    window.addEventListener("pagehide", () => clearInterval(foodRefresh), {
      once: true,
    });
    window.addEventListener("pagehide", () => clearTimeout(visitRetryTimer), { once: true });
    await setLanguage(language);
    const db = R.getClient();
    if (!db) {
      $("connectNotice").classList.remove("hidden");
      return;
    }
    $("codeCard").classList.remove("hidden");
    if (rawCode) {
      $("inviteCode").value = rawCode;
      await loadInvitation(rawCode);
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => status(R.safeError(e), "error"));
  });
})();
