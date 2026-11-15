// Shared, plain-text placeholder contract. Missing context remains visible.
(function () {
  "use strict";
  const groups = {
    event: ["event_name", "event_date", "event_time", "event_timezone", "organizer_name", "organizer_email", "organizer_phone", "rsvp_deadline", "food_deadline", "food_stage"],
    household: ["household_name", "guest_names", "guest_count", "invited_sessions", "invited_venues", "invitation_link", "rsvp_status", "unanswered_guest_count"],
    venue: ["venue_name", "venue_address", "venue_map_link"],
    session: ["session_name", "session_date", "session_start", "session_end", "session_timezone"],
  };
  const dates = new Set(["rsvp_deadline", "food_deadline", "event_date", "session_date"]);
  const pattern = /\{([a-z][a-z0-9_]*)(?::([+-]\d{1,3}))?\}/g;
  const names = Object.values(groups).flat();
  const tokens = (scope = "invitation") => {
    const allowed = scope === "event" ? groups.event : scope === "venue" ? [...groups.event, ...groups.household, ...groups.venue] : names;
    return [...allowed.map(n => "{" + n + "}"), "{rsvp_deadline:+5}", "{rsvp_deadline:-2}"];
  };
  function validate(text, scope = "invitation") {
    if (typeof text !== "string" || text.length > 12000) throw Error("Invalid placeholder text");
    const allowed = new Set(tokens(scope).map(t => t.slice(1,-1)));
    const rest = text.replace(pattern, (whole, name, offset) => {
      if (!allowed.has(name) || (offset && (!dates.has(name) || Math.abs(Number(offset)) > 366))) throw Error("The text contains an unsupported placeholder.");
      return "";
    });
    if (/[{}]/.test(rest)) throw Error("The text contains an unsupported placeholder.");
    return text;
  }
  const locale = (language) => language === "fo" ? "fo-FO" : language === "en" ? "en-GB" : language || "en-GB";
  function date(value, offset, { timezone = "UTC", language = "en" } = {}) {
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    const parts = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-") : (() => {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {year:"numeric",month:"2-digit",day:"2-digit",timeZone:timezone}).formatToParts(new Date(value)).map(p => [p.type,p.value]));
      return [p.year,p.month,p.day];
    })();
    const day = new Date(Date.UTC(Number(parts[0]), Number(parts[1])-1, Number(parts[2])+Number(offset || 0)));
    return new Intl.DateTimeFormat(locale(language), {dateStyle:"long",timeZone:"UTC"}).format(day);
  }
  function fill(text, values = {}, options = {}) {
    validate(text, options.scope);
    return text.replace(pattern, (whole, name, offset) => {
      const raw = values[name];
      const value = dates.has(name) ? date(raw, offset, {...options,timezone:name==="session_date" ? values.session_timezone || options.timezone : options.timezone}) : raw;
      return value === undefined || value === null || value === "" ? whole : String(value);
    });
  }
  function context(store, { household = null, language = "en", venueId = "", sessionId = "", sample = false } = {}) {
    const e = store.settings || store.event || {}, T = text => window.RSVP_I18N?.t(text, {}, language) || text;
    const rows = store.content || store.translations || [];
    const translated = (key, fallback) => [language,e.fallback_language,"en"].map(code => Array.isArray(rows) ? rows.find(r => r.content_key===key && r.language_code===code)?.content_value : null).find(Boolean) || fallback || "";
    const guests = (store.guests || []).filter(g => !g.archived_at && (!household || !g.household_id || g.household_id===household.id));
    const invited = (g,s) => {
      if (store.invitations) return store.invitations.some(i => i.guest_id===g.id && i.session_id===s.id);
      const override = (store.overrides || []).find(x => x.guest_id===g.id && x.session_id===s.id);
      return override ? override.is_invited : (store.defaults || []).find(x => x.household_id===household?.id && x.session_id===s.id)?.is_invited;
    };
    const sessions = (store.sessions || []).filter(s => s.is_active!==false && (!household || sample || guests.some(g=>invited(g,s))));
    const venues = (store.locations || []).filter(v => !v.archived_at && (!household || sample || sessions.some(s=>s.location_id===v.id)));
    let session = sessionId ? sessions.find(s=>s.id===sessionId) : sessions.length===1 ? sessions[0] : null;
    if (session && venueId && session.location_id !== venueId) session = null;
    const venue = venueId ? venues.find(v=>v.id===venueId) : session ? venues.find(v=>v.id===session.location_id) : venues.length===1 ? venues[0] : null;
    const list = values => values.length ? new Intl.ListFormat(locale(language), {style:"long",type:"conjunction"}).format(values) : null;
    const actualGuests = guests.filter(g => sessions.some(s=>invited(g,s)));
    const responses = store.responses || [];
    const unanswered = actualGuests.filter(g => sessions.some(s => s.requires_rsvp!==false && invited(g,s) && !responses.some(r=>r.guest_id===g.id && r.session_id===s.id && ["attending","declined"].includes(r.rsvp_status)))).length;
    const time = (value, zone) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale(language), {hour:"2-digit",minute:"2-digit",...(window.RSVP?.timeOptions?.() || {}),timeZone:zone}).format(new Date(value)) : null;
    const values = {
      event_name:e.event_name,event_date:e.event_date,event_time:e.event_time ? time("2000-01-01T"+e.event_time+"Z","UTC") : null,event_timezone:e.timezone,
      organizer_name:e.organizer_name,organizer_email:e.organizer_email,organizer_phone:e.organizer_phone,rsvp_deadline:e.rsvp_deadline,food_deadline:e.food_deadline,food_stage:T(e.food_stage==="selection"?"Choose food":"Collect interest"),
      household_name:window.RSVP_HOUSEHOLD_NAME(household) || null,guest_names:list(actualGuests.map(g=>[g.first_name,g.last_name].filter(Boolean).join(" "))),guest_count:household ? new Intl.NumberFormat(locale(language)).format(actualGuests.length) : null,
      invited_sessions:list(sessions.map(s=>translated("session:"+s.id+":name",s.name))),invited_venues:list(venues.map(v=>translated("venue:"+v.id+":name",v.name))),
      invitation_link:e.is_published && household?.invite_code ? window.RSVP.invitationURL(household.invite_code) : null,
      rsvp_status:household ? T(household.rsvp_state==="locked" ? "Confirmed" : actualGuests.length && !unanswered ? "Replied" : unanswered && unanswered<actualGuests.length ? "Partly replied" : "No reply") : null,unanswered_guest_count:household ? new Intl.NumberFormat(locale(language)).format(unanswered) : null,
      venue_name:venue ? translated("venue:"+venue.id+":name",venue.name) : null,venue_address:venue?.address,venue_map_link:venue?.map_url,
      session_name:session ? translated("session:"+session.id+":name",session.name) : null,session_date:session?.starts_at,session_start:time(session?.starts_at,venue?.timezone || e.timezone || "UTC"),session_end:time(session?.ends_at,venue?.timezone || e.timezone || "UTC"),session_timezone:session ? venue?.timezone || e.timezone : null,
    };
    if (sample) Object.assign(values,{household_name:T("Sample household"),guest_names:T("Sample household"),guest_count:"2",invitation_link:window.RSVP.guestPreviewURL("landing"),rsvp_status:T("No reply"),unanswered_guest_count:"2"});
    return { values, options:{language,timezone:e.timezone || "UTC"} };
  }
  const unresolved = text => /[{}]/.test(text);
  window.RSVP_PLACEHOLDERS = { groups, names, dates, tokens, validate, fill, context, unresolved };
})();
