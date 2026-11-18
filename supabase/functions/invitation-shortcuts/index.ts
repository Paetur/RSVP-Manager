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
// Supabase's hosted TLS gateway forwards HTTP to the isolate and removes
// /functions/v1. Trust that mapping only inside a hosted deployment, and only
// when the gateway reports HTTPS. Standalone HTTP stays rejected by the handler.
const hostedDeployment = Boolean(Deno.env.get("DENO_DEPLOYMENT_ID"));
Deno.serve((request: Request) => {
  if (!hostedDeployment || !publicApi.startsWith("https://")) return handler(request);
  const incoming = new URL(request.url);
  if (incoming.protocol !== "https:" && request.headers.get("x-forwarded-proto") !== "https")
    return handler(request);
  const external = new URL(publicApi);
  const basePath = external.pathname.replace(/\/$/, "");
  const isolatePrefix = "/" + basePath.split("/").filter(Boolean).at(-1);
  if (incoming.pathname.startsWith(isolatePrefix + "/"))
    incoming.pathname = basePath + incoming.pathname.slice(isolatePrefix.length);
  external.pathname = incoming.pathname;
  external.search = incoming.search;
  return handler(new Request(external, request));
});
