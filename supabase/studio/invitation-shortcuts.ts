// Generated Studio entrypoint for RSVP Manager 0.9.0-beta.3.
// Paste the COMPLETE file into index.ts for invitation-shortcuts.
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

// Source: supabase/functions/invitation-shortcuts/handler.mjs
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const capability = /^[A-Za-z0-9_-]{32,256}$/;
const modes = new Set(["live", "dry_run", "live_test"]);
const results = new Set(["processed", "partial", "failed", "skipped", "unknown"]);
const errorCodes = new Set(["action_failed", "image_fetch_failed", "cancelled", "unknown"]);
const object = value => value && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed, required = allowed) => object(value) &&
  Object.keys(value).every(key => allowed.includes(key)) &&
  required.every(key => Object.hasOwn(value, key));

async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// No device credential is an organizer session, provider receipt, or invitation code.
// rpc is injected so the actual HTTP boundary can run against disposable databases.
export function shortcutHandler({ origin: configuredOrigin, siteUrl, apiUrl, rpc }) {
  const origin = siteOrigin(configuredOrigin);
  const website = siteURL(siteUrl, origin);
  if (new URL(website).protocol !== "https:")
    throw Error("Shortcuts requires a configured HTTPS invitation website");
  const base = new URL(apiUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw Error("Shortcuts requires a configured HTTPS API URL");
  base.pathname = base.pathname.replace(/\/$/, "");
  const cors = {
    ...corsHeaders(origin),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const reply = (status, data) => new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
  const failure = (error, delegated) => {
    const message = String(error?.message || "");
    if (error?.code === "42501" || /permission|access required|session|revoked/i.test(message))
      return reply(403, { error: "Authorization is no longer valid", code: "forbidden" });
    if (/expired|credential|token/i.test(message))
      return reply(401, { error: "Batch authorization expired or is invalid", code: "unauthorized" });
    if (/rate|too many|request limit exceeded/i.test(message))
      return reply(429, { error: "Too many requests; retry later", code: "rate_limited" });
    if (/changed|revision|published|processed|claimed|conflict|uncertain|ready|retry|frozen/i.test(message))
      return reply(409, { error: "Delivery state changed; review the batch before continuing", code: "conflict" });
    if (error?.code)
      return reply(400, { error: delegated ? "Invalid batch operation" : "Batch could not be prepared", code: "invalid_request" });
    return reply(503, { error: "Batch service temporarily unavailable", code: "unavailable" });
  };
  async function invoke(name, args, authorization = null) {
    const result = await rpc(name, args, authorization);
    if (result.error) throw result.error;
    return result.data;
  }
  function manifest(data, batchId) {
    if (!object(data) || !Array.isArray(data.invitations)) throw Error("Invalid batch response");
    const statuses = Array.isArray(data.statuses) ? data.statuses : [];
    const progress = Object.fromEntries(["pending", "claimed", "processed", "partial", "failed", "unknown", "skipped"]
      .map(state => [state, statuses.filter(item => item.state === state).length]));
    return {
      schema_version: 1,
      batch_id: batchId,
      mode: data.mode,
      expires_at: data.expires_at,
      progress: { total: statuses.length, ...progress },
      statuses,
      invitations: data.invitations.map(item => ({
        attempt_id: item.attempt_id,
        delivery_id: item.delivery_id || item.queue_id,
        household_name: item.household_name,
        phone: item.phone,
        message: item.message,
        invitation_code: item.invitation_code,
        invitation_link: snapshotLink(item),
        image_url: item.has_image || item.image || item.message_image
          ? base.href + "/batches/" + batchId + "/attempts/" + item.attempt_id + "/image"
          : null,
        required_actions: item.required_actions,
      })),
    };
  }
  function snapshotLink(item) {
    // Preserve the reviewed link byte-for-byte; do not regenerate invitation URLs
    // while resuming a frozen snapshot or change their installation path.
    for (const match of String(item.message || "").matchAll(/https:\/\/[^\s<>"']+/g)) {
      const candidate = match[0].replace(/[).,!?;]+$/, "");
      try {
        const link = new URL(candidate);
        const code = link.searchParams.get("") || link.searchParams.get("invite") || link.searchParams.get("code");
        if (link.protocol === "https:" && !link.username && !link.password && code === item.invitation_code)
          return candidate;
      } catch { /* Check the next URL already present in the reviewed message. */ }
    }
    throw { code: "P0001", message: "Invitation link changed; review the delivery" };
  }
  return async request => {
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && requestOrigin !== origin)
      return reply(403, { error: "Origin not allowed", code: "forbidden" });
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.search || url.hash)
      return reply(400, { error: "Use HTTPS without query parameters", code: "invalid_request" });
    if (!url.pathname.startsWith(base.pathname + "/"))
      return reply(404, { error: "Endpoint not found", code: "not_found" });
    const path = url.pathname.slice(base.pathname.length);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const match = /^\/batches(?:\/([0-9a-f-]{36})(?:\/(claims|results|authorization|attempts\/([0-9a-f-]{36})\/image))?)?$/i.exec(path);
    if (!match || (match[1] && !uuid.test(match[1])) || (match[3] && !uuid.test(match[3])))
      return reply(404, { error: "Endpoint not found", code: "not_found" });
    const [ , batchId, operation, imageAttempt ] = match;
    const creation = !batchId;
    const organizer = creation || operation === "authorization";
    const expectedMethod = organizer || operation === "claims" || operation === "results" ? "POST" : "GET";
    if (request.method !== expectedMethod)
      return reply(405, { error: "Method not allowed", code: "method_not_allowed" });
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (header.length > 4096 || !(organizer ? jwt : capability).test(token))
      return reply(401, { error: "Authorization required", code: "unauthorized" });
    try {
      const forwarded = request.headers.get("x-forwarded-for")?.split(",").map(value => value.trim()).filter(Boolean);
      const source = request.headers.get("x-real-ip") || forwarded?.at(-1) || "unknown";
      const tokenHash = await hash(token);
      if (await invoke("shortcut_gateway_allow_request", {
        p_source_hash: await hash(source), p_token_hash: tokenHash,
      }) !== true) return reply(429, { error: "Too many requests; retry later", code: "rate_limited" });
      let input;
      if (expectedMethod === "POST") {
        try { input = JSON.parse(await readLimitedBody(request, 12000)); }
        catch (error) {
          if (error instanceof RangeError) throw error;
          return reply(400, { error: "Invalid JSON request", code: "invalid_request" });
        }
      }
      if (creation) {
        if (!keys(input, ["items", "mode", "retry"], ["items"]) ||
            !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 10 ||
            new Set(input.items.map(item => item?.queue_id)).size !== input.items.length ||
            !input.items.every(item => keys(item, ["queue_id", "expected_revision"]) &&
              uuid.test(item.queue_id) && Number.isSafeInteger(item.expected_revision) && item.expected_revision > 0 && item.expected_revision <= 999999999) ||
            (input.mode !== undefined && !modes.has(input.mode)) ||
            (input.retry !== undefined && typeof input.retry !== "boolean"))
          return reply(400, { error: "Choose 1 to 10 distinct reviewed WhatsApp drafts", code: "invalid_request" });
        const data = await invoke("admin_create_shortcut_batch", {
          p_items: input.items, p_mode: input.mode || "live", p_retry: input.retry || false,
        }, header);
        return reply(201, {
          schema_version: 1, batch_id: data.batch_id, capability: data.capability,
          expires_at: data.expires_at, mode: data.mode, count: data.count,
        });
      }
      if (operation === "authorization") {
        if (!keys(input, ["action"]) || !["renew", "revoke"].includes(input.action))
          return reply(400, { error: "Choose renew or revoke", code: "invalid_request" });
        const data = await invoke("admin_manage_shortcut_batch", {
          p_batch_id: batchId, p_action: input.action,
        }, header);
        return reply(200, {
          schema_version: 1, batch_id: batchId, revoked: data.revoked,
          capability: data.capability, expires_at: data.expires_at,
        });
      }
      let action = "manifest", payload = {};
      if (operation === "claims") {
        if (!keys(input, ["attempt_id", "claim_id"]) || !uuid.test(input.attempt_id) || !uuid.test(input.claim_id))
          return reply(400, { error: "Invalid attempt claim", code: "invalid_request" });
        action = "claim"; payload = input;
      } else if (operation === "results") {
        if (!keys(input, ["event_id", "attempt_id", "claim_id", "result", "channel", "details"]) ||
            !uuid.test(input.event_id) || !uuid.test(input.attempt_id) || !uuid.test(input.claim_id) ||
            !results.has(input.result) || input.channel !== "whatsapp" ||
            !keys(input.details, ["text_action_completed", "photo_action_completed", "error_stage", "error_code"],
              ["text_action_completed", "photo_action_completed"]) ||
            typeof input.details.text_action_completed !== "boolean" || typeof input.details.photo_action_completed !== "boolean" ||
            (input.details.error_stage !== undefined && !["text", "photo", "unknown"].includes(input.details.error_stage)) ||
            (input.details.error_code !== undefined && !errorCodes.has(input.details.error_code)) ||
            (input.result === "processed" && (input.details.error_code !== undefined || input.details.error_stage !== undefined)))
          return reply(400, { error: "Invalid processing result", code: "invalid_request" });
        action = "results"; payload = input;
      } else if (imageAttempt) {
        action = "image"; payload = { attempt_id: imageAttempt };
      }
      const data = await invoke("dispatch_shortcut_batch", {
        p_batch_id: batchId, p_token_hash: tokenHash, p_action: action, p_payload: payload,
      });
      if (action === "manifest") return reply(200, manifest(data, batchId));
      if (action === "image") {
        const image = typeof data === "string" ? data : data?.image;
        if (typeof image !== "string" || image.length > 1900000 ||
            !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))
          return reply(404, { error: "JPEG not available", code: "not_found" });
        const bytes = Uint8Array.from(atob(image.slice("data:image/jpeg;base64,".length)), char => char.charCodeAt(0));
        if (bytes.length > 1400000 || bytes[0] !== 255 || bytes[1] !== 216)
          return reply(404, { error: "JPEG not available", code: "not_found" });
        return new Response(bytes, { status: 200, headers: {
          ...cors, "Content-Type": "image/jpeg", "Content-Disposition": 'attachment; filename="invitation.jpg"',
        }});
      }
      return reply(200, { schema_version: 1, batch_id: batchId, ...data });
    } catch (error) {
      if (error instanceof RangeError) return reply(413, { error: "Request too large", code: "too_large" });
      return failure(error, !creation);
    }
  };
}

// Source: supabase/functions/invitation-shortcuts/index.ts
const backend = Deno.env.get("SUPABASE_URL");
let secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!secret) {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    secret = keys.default || Object.values(keys).find(value => typeof value === "string");
  } catch { /* An invalid server configuration keeps this optional endpoint closed. */ }
}
const serviceKey = typeof secret === "string" ? secret : "";
const publicApi = Deno.env.get("RSVP_SHORTCUTS_API_URL") ||
  (backend ? backend.replace(/\/$/, "") + "/functions/v1/invitation-shortcuts" : "");

// Shortcuts gets a short-lived batch capability, never this server-only key.
const handler = backend && serviceKey && publicApi.startsWith("https://")
  ? shortcutHandler({
      origin: Deno.env.get("RSVP_SITE_ORIGIN"),
      siteUrl: Deno.env.get("RSVP_SITE_URL"),
      apiUrl: publicApi,
      rpc: async (name, args, authorization) => {
        const headers: Record<string, string> = { apikey: serviceKey, "Content-Type": "application/json" };
        if (authorization) headers.Authorization = authorization;
        else if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(serviceKey))
          headers.Authorization = "Bearer " + serviceKey;
        // Modern secret keys belong only in apikey; they cannot be parsed as JWTs.
        const response = await fetch(backend + "/rest/v1/rpc/" + name, {
          method: "POST",
          headers,
          body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
        });
        const value = await response.json();
        return response.ok ? { data: value } : { error: value };
      },
    })
  : () => new Response(JSON.stringify({ error: "HTTPS batch service is not configured" }), {
      status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
// TLS terminates before the isolate. Hosted requests use Supabase's deployment
// marker; a self-hosted proxy must overwrite this private header with its own
// server-only token. The token establishes the transport boundary only: the
// handler still checks the origin, path and organizer/device authorization.
const hostedDeployment = Boolean(Deno.env.get("DENO_DEPLOYMENT_ID"));
const proxyToken = Deno.env.get("RSVP_SHORTCUTS_PROXY_TOKEN") || "";
const proxyConfigured = /^[0-9a-f]{64}$/i.test(proxyToken);
function trustedProxy(request: Request) {
  const supplied = request.headers.get("x-rsvp-shortcuts-proxy") || "";
  if (!proxyConfigured || supplied.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < 64; index++)
    difference |= supplied.charCodeAt(index) ^ proxyToken.charCodeAt(index);
  return difference === 0;
}
Deno.serve((request: Request) => {
  if (!publicApi.startsWith("https://")) return handler(request);
  const incoming = new URL(request.url);
  const external = new URL(publicApi);
  const basePath = external.pathname.replace(/\/$/, "");
  const isolatePrefix = "/" + basePath.split("/").filter(Boolean).at(-1);
  const forwardedHTTPS = request.headers.get("x-forwarded-proto") === "https";
  if (hostedDeployment) {
    if (incoming.protocol !== "https:" && !forwardedHTTPS) return handler(request);
  } else {
    const localPath = incoming.pathname === "/invitation-shortcuts" ||
      incoming.pathname.startsWith("/invitation-shortcuts/") ||
      (basePath !== "" && (incoming.pathname === basePath || incoming.pathname.startsWith(basePath + "/")));
    if (incoming.protocol !== "http:" || !forwardedHTTPS || !localPath || !trustedProxy(request))
      return handler(request);
  }
  if (incoming.pathname.startsWith(isolatePrefix + "/"))
    incoming.pathname = basePath + incoming.pathname.slice(isolatePrefix.length);
  external.pathname = incoming.pathname;
  external.search = incoming.search;
  const normalized = new Request(external, request);
  normalized.headers.delete("x-rsvp-shortcuts-proxy");
  return handler(normalized);
});
