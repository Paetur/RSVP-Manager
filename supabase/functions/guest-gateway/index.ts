import {siteOrigin, corsHeaders} from '../_shared/site-origin.mjs';
import {readLimitedBody} from '../_shared/request-body.mjs';
// RSVP guest gateway — prevents direct PostgREST bypass and enforces atomic rate limits.
// Keep the hosted default; local/self-hosted installations set their exact frontend origin.
const allowedOrigin = siteOrigin(Deno.env.get("RSVP_SITE_ORIGIN"));
const allowed = new Set([
  "set_household_food_interest", "add_household_guest", "set_household_food_group", "get_invitation_v2", "get_household_food", "set_household_food_claim",
  "confirm_household_food", "submit_household_rsvp", "acknowledge_household_visit"
]);
const codePattern = /^[A-HJ-NP-Z2-9]{8}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = corsHeaders(allowedOrigin);
function reply(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, "0")).join("");
}
function requestValid(action: string, args: Record<string, unknown>) {
  const keys = Object.keys(args).sort().join(",");
  if (action === "set_household_food_interest") return keys === "p_code,p_expected_interest,p_interest" && typeof args.p_interest === "boolean" && (args.p_expected_interest === null || typeof args.p_expected_interest === "boolean");
  if (action === "add_household_guest") return keys === "p_code,p_first_name,p_guest_id,p_is_child,p_last_name"
    && typeof args.p_guest_id === "string" && uuidPattern.test(args.p_guest_id)
    && typeof args.p_first_name === "string" && args.p_first_name.trim().length > 0 && args.p_first_name.length <= 120
    && typeof args.p_last_name === "string" && args.p_last_name.length <= 120 && typeof args.p_is_child === "boolean";
  if (action === "set_household_food_group") return keys === "p_code,p_group_id,p_quantity"
    && typeof args.p_group_id === "string" && uuidPattern.test(args.p_group_id) && (args.p_quantity === 0 || args.p_quantity === 1);
  if (action === "get_invitation_v2") return keys === "p_code" || (keys === "p_code,p_visit_session_id" && typeof args.p_visit_session_id === "string" && uuidPattern.test(args.p_visit_session_id));
  if (action === "get_household_food") return keys === "p_code";
  if (action === "acknowledge_household_visit") return keys === "p_code,p_receipt_id,p_session_id"
    && typeof args.p_receipt_id === "string" && uuidPattern.test(args.p_receipt_id)
    && typeof args.p_session_id === "string" && uuidPattern.test(args.p_session_id);
  if (action === "confirm_household_food") return keys === "p_code" || (keys === "p_code,p_expected_claims" && Array.isArray(args.p_expected_claims) && args.p_expected_claims.length > 0 && args.p_expected_claims.length <= 100 && args.p_expected_claims.every((c: unknown) => {if(!c || typeof c !== "object" || Array.isArray(c))return false;const row=c as Record<string,unknown>;return Object.keys(row).sort().join(",")==="food_item_id,quantity" && typeof row.food_item_id==="string" && uuidPattern.test(row.food_item_id) && Number.isInteger(row.quantity) && (row.quantity as number)>0 && (row.quantity as number)<=1000;}));
  if (action === "set_household_food_claim") {
    return (keys === "p_code,p_food_item_id,p_notes,p_quantity" || keys === "p_code,p_food_item_id,p_quantity")
      && typeof args.p_food_item_id === "string" && uuidPattern.test(args.p_food_item_id)
      && Number.isInteger(args.p_quantity) && (args.p_quantity as number) >= 0 && (args.p_quantity as number) <= 1000
      && (args.p_notes == null || (typeof args.p_notes === "string" && args.p_notes.length <= 500));
  }
  if (action === "submit_household_rsvp") {
    return (keys === "p_code,p_request_id,p_responses" || keys === "p_code,p_comment,p_request_id,p_responses")
      && (args.p_comment == null || (typeof args.p_comment === "string" && args.p_comment.length <= 2000))
      && typeof args.p_request_id === "string" && uuidPattern.test(args.p_request_id)
      && Array.isArray(args.p_responses) && args.p_responses.length <= 100
      && args.p_responses.every((x: unknown) => {
        if (!x || typeof x !== "object" || Array.isArray(x)) return false;
        const r = x as Record<string, unknown>;
        return Object.keys(r).sort().join(",") === "guest_id,session_id,status"
          && typeof r.guest_id === "string" && uuidPattern.test(r.guest_id)
          && typeof r.session_id === "string" && uuidPattern.test(r.session_id)
          && (r.status === "attending" || r.status === "declined");
      });
  }
  return false;
}
function speculativeRequest(req: Request) {
  const purpose = ["purpose", "sec-purpose", "x-purpose"].map(name => req.headers.get(name) || "").join(" ");
  return /prefetch|prerender|preview/i.test(purpose) || /bot\b|crawler|spider|facebookexternalhit|meta-externalagent|slackbot|discordbot|telegrambot|whatsapp|skypeuripreview|linkedinbot|twitterbot/i.test(req.headers.get("user-agent") || "");
}
function anonymousApiToken(token: string) {
  if (!token || token.startsWith("sb_publishable_")) return true;
  // Compare legacy public API keys exactly. User JWT claims are never trusted
  // without Auth verification, including for the optional analytics exclusion.
  return token === Deno.env.get("SUPABASE_ANON_KEY");
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) return reply(403, { error: "Origin not allowed" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  const len = Number(req.headers.get("content-length") || "0");
  if (len > 20000) return reply(413, { error: "Request too large" });
  try {
    const textBody = await readLimitedBody(req, 20000);

    let input;
    try {
      input = JSON.parse(textBody);
    } catch {
      return reply(400, { error: "Invalid request" });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, { error: "Invalid request" });
    const { action, args } = input as { action?: string; args?: unknown };
    if (typeof action !== "string" || !allowed.has(action) || !args || typeof args !== "object" || Array.isArray(args)) return reply(400, { error: "Invalid action" });
    const params = args as Record<string, unknown>;
    if (typeof params.p_code !== "string" || !codePattern.test(params.p_code) || !requestValid(action, params)) return reply(400, { error: "Invalid request parameters" });
    if (action === "acknowledge_household_visit" && textBody.length > 512) return reply(413, { error: "Request too large" });
    // The gateway controls this header on the hosted edge. Use the final forwarded value,
    // which corresponds to the closest proxy; per-code and global limits backstop IP changes.
    const forwarded = req.headers.get("x-forwarded-for")?.split(",").map(x => x.trim()).filter(Boolean);
    const source = req.headers.get("x-real-ip") || forwarded?.[forwarded.length - 1] || req.headers.get("cf-connecting-ip") || "unknown";
    const ipHash = await sha256(source);
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"))[0];
    if (!url || typeof serviceKey !== "string" || !serviceKey) return reply(503, { error: "Gateway not configured" });
    const headers = { "apikey": serviceKey, "Authorization": "Bearer " + serviceKey, "Content-Type": "application/json" };
    async function invoke(name: string, arguments_: Record<string, unknown>) {
      return fetch(url + "/rest/v1/rpc/" + name, {
        method: "POST", headers, body: JSON.stringify(arguments_), signal: AbortSignal.timeout(10000)
      });
    }
    const limited = await invoke("guest_gateway_allow_request", { p_ip_hash: ipHash, p_code: params.p_code, p_action: action });
    if (!limited.ok) return reply(503, { error: "Request validation unavailable" });
    if (await limited.json() !== true) return reply(429, { error: "Too many requests. Try again in a minute." });
    async function visitsAllowed() {
      if (speculativeRequest(req)) return false;
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (anonymousApiToken(token)) return true;
      // Optional administrator identity suppresses analytics only. A stale or
      // unverifiable session must never prevent the public invitation loading.
      try {
        const userHeaders = { ...headers, "Authorization": "Bearer " + token };
        const user = await fetch(url + "/auth/v1/user", { headers: userHeaders, signal: AbortSignal.timeout(5000) });
        if (!user.ok || typeof (await user.json())?.id !== "string") return false;
        const admin = await fetch(url + "/rest/v1/rpc/is_admin", { method: "POST", headers: userHeaders, body: "{}", signal: AbortSignal.timeout(5000) });
        return admin.ok && await admin.json() === false;
      } catch { return false; }
    }
    if (action === "acknowledge_household_visit" && !await visitsAllowed()) return reply(200, false);
    const result = await invoke(action === "get_invitation_v2" ? "get_invitation_logged" : action, action === "get_invitation_v2" ? { p_code: params.p_code } : params);
    if (!result.ok) {
      // Do not expose internal PostgreSQL errors to unauthenticated clients.
      const status = result.status === 401 || result.status === 403 ? 403 : result.status === 404 ? 404 : 400;
      return reply(status, { error: status === 403 ? "Access denied or event not published" : "Request could not be completed" });
    }
    const raw = await result.text();
    let value: unknown = null;
    if (raw) { try { value = JSON.parse(raw); } catch { return reply(502, { error: "Invalid response" }); } }
    if (action === "get_invitation_v2" && params.p_visit_session_id && value && typeof value === "object" && !Array.isArray(value) && "eventData" in value && await visitsAllowed()) {
      try {
        const issued = await invoke("issue_household_visit_receipt", { p_code: params.p_code, p_session_id: params.p_visit_session_id });
        if (issued.ok) {
          const receipt = await issued.json();
          if (receipt && uuidPattern.test(receipt.id) && receipt.sessionId === params.p_visit_session_id)
            value = { ...value, visitReceipt: receipt };
        }
      } catch { /* Visit transport is optional; the invitation remains usable. */ }
    }
    return reply(200, value);
  } catch (error) {
    if (error instanceof RangeError) return reply(413, { error: "Request too large" });
    return reply(503, { error: "Request temporarily unavailable" });
  }
});

