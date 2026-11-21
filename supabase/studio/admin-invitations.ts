// Generated Studio entrypoint for RSVP Manager 0.9.0-alpha.9.
// Paste the COMPLETE file into index.ts for admin-invitations.
// Set the function JWT verification toggle to OFF; this handler validates requests itself.
// Source hashes and version are recorded in manifest.json. Do not edit generated files.

// Source: supabase/functions/_shared/site-origin.mjs
// Server configuration only: exact origins, no wildcard or request-derived redirects.
export function siteOrigin(value) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(
      "RSVP_SITE_ORIGIN must be configured for this installation",
    );
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin === "null"
  )
    throw new Error(
      "RSVP_SITE_ORIGIN must be an exact HTTP(S) origin without a path",
    );
  return url.origin;
}
// The allowed origin remains exact; the configured base URL scopes trusted email redirects.
export function siteURL(value, origin) {
  const raw = value === undefined ? origin + "/" : value;
  if (
    typeof raw !== "string" ||
    !raw.trim() ||
    raw.includes("\\") ||
    /%2f|%5c|%2e/i.test(raw) ||
    /\/\.{1,2}(?:\/|$)/.test(raw)
  )
    throw new Error("RSVP_SITE_URL must be an absolute installation base URL");
  const url = new URL(raw);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%2f|%5c|%2e/i.test(url.pathname) ||
    url.pathname.includes("//")
  )
    throw new Error(
      "RSVP_SITE_URL must be a website base URL on RSVP_SITE_ORIGIN, without credentials, query or fragment",
    );
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

// Source: supabase/functions/_shared/request-body.mjs
// Enforce byte limits while reading, even without Content-Length.
export async function readLimitedBody(request, maxBytes) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new RangeError('Request too large');
  if (!request.body) return '';

  const reader=request.body.getReader(), decoder = new TextDecoder();

  let size=0, text='';
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done)
        break;

      size+=value.byteLength;
      if (size>maxBytes) {
        await reader.cancel();
        throw new RangeError('Request too large');
      }
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  } finally { reader.releaseLock(); }
}

// Source: supabase/functions/admin-invitations/handler.mjs
// Factory keeps privileged email behavior testable without sending real messages.
export function invitationHandler({
  createClient,
  url,
  serviceKey,
  origin: configuredOrigin,
  siteUrl,
}) {
  const origin = siteOrigin(configuredOrigin);
  const redirectTo = new URL(
    "admin/?admin-invitation=1",
    siteURL(siteUrl, origin),
  ).href;
  const cors = corsHeaders(origin);
  const reply = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  return async (req) => {
    if (req.headers.get("origin") && req.headers.get("origin") !== origin)
      return reply(403, { error: "Origin not allowed" });
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST")
      return reply(405, { error: "Method not allowed" });
    const authorization = req.headers.get("authorization") || "";
    if (
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        authorization,
      )
    )
      return reply(401, {
        error: "Sign in again before sending an invitation",
      });
    if (!url || !serviceKey)
      return reply(503, {
        error: "Invitation email service is not configured",
      });
    let reservation = null,
      service;
    try {
      if (Number(req.headers.get("content-length") || 0) > 2048)
        return reply(413, { error: "Request too large" });
      const raw = await readLimitedBody(req, 2048);
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        return reply(400, { error: "Invalid request" });
      }
      if (
        !input ||
        Array.isArray(input) ||
        typeof input !== "object" ||
        Object.keys(input).some((k) => !["email", "name", "id"].includes(k)) ||
        typeof input.email !== "string" ||
        typeof input.name !== "string" ||
        input.email.length > 254 ||
        input.name.length > 120 ||
        (input.id != null &&
          (typeof input.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              input.id,
            )))
      )
        return reply(400, { error: "Enter a valid email and display name" });
      service = createClient(url, serviceKey, options);
      const { data: verified, error: authError } = await service.auth.getUser(
        authorization.slice(7),
      );
      if (authError || !verified?.user)
        return reply(401, {
          error: "Sign in again before sending an invitation",
        });
      // All reservation checks run under the caller's JWT, including membership,
      // live Auth session, recipient validation, duplicate/cooldown and hourly caps.
      const caller = createClient(url, serviceKey, {
        ...options,
        global: { headers: { Authorization: authorization } },
      });
      const { data, error } = await caller.rpc("admin_prepare_invitation", {
        p_email: input.email,
        p_name: input.name,
        p_id: input.id || null,
      });
      if (error)
        return reply(error.code === "42501" ? 403 : 400, {
          error: error.message || "Invitation could not be prepared",
        });
      reservation = data;
      const sent = reservation.existing_confirmed
        ? await service.auth.signInWithOtp({
            email: reservation.email,
            options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
          })
        : await service.auth.admin.inviteUserByEmail(reservation.email, {
            redirectTo,
          });
      // Store codes only, never provider payloads, sign-in links or access tokens.
      const code = sent.error ? safeCode(sent.error.code) : null;
      const result = await service.rpc("admin_finish_invitation", {
        p_id: reservation.id,
        p_attempt_id: reservation.attempt_id,
        p_sent: !sent.error,
        p_error_code: code,
      });
      if (result.error)
        return reply(503, {
          error:
            "Email status could not be recorded. Refresh pending invitations before retrying.",
        });
      if (result.data !== true)
        return reply(409, {
          error:
            "This invitation changed while sending. Refresh the invitation list.",
        });
      if (sent.error) return reply(400, { error: emailError(code) });
      return reply(200, {
        id: reservation.id,
        message:
          "Invitation email accepted by the email service. Access remains pending until acceptance.",
      });
    } catch (error) {
      if (error instanceof RangeError && !reservation)
        return reply(413, { error: "Request too large" });
      if (reservation && service) {
        try {
          await service.rpc("admin_finish_invitation", {
            p_id: reservation.id,
            p_attempt_id: reservation.attempt_id,
            p_sent: false,
            p_error_code: "email_status_unknown",
          });
        } catch {
          /* Keep sending state; bounded cooldown permits an explicit retry. */
        }
      }
      return reply(503, {
        error:
          "Email status is uncertain. Refresh pending invitations before retrying.",
      });
    }
  };
}
function safeCode(code) {
  return [
    "email_address_not_authorized",
    "over_email_send_rate_limit",
    "over_request_rate_limit",
    "email_exists",
    "user_already_exists",
    "email_address_invalid",
    "unexpected_failure",
  ].includes(code)
    ? code
    : "email_failed";
}
function emailError(code) {
  if (code === "email_address_not_authorized")
    return "Email sending is restricted. Configure custom SMTP in Supabase Authentication before inviting this address.";
  if (["over_email_send_rate_limit", "over_request_rate_limit"].includes(code))
    return "The email service sending limit was reached. Wait before resending.";
  if (["email_exists", "user_already_exists"].includes(code))
    return "This account changed during sending. Wait one minute, then resend to send its sign-in email.";
  return "The email service could not send this invitation. Check the Supabase email configuration, then resend.";
}

// Source: supabase/functions/admin-invitations/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.50.0";
Deno.serve(
  invitationHandler({
    createClient,
    origin: Deno.env.get("RSVP_SITE_ORIGIN"),
    siteUrl: Deno.env.get("RSVP_SITE_URL"),
    url: Deno.env.get("SUPABASE_URL"),
    serviceKey:
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Object.values(
        JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"),
      )[0],
  }),
);
