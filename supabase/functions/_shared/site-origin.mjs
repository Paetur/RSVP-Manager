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
