import { shortcutHandler } from "./handler.mjs";

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
