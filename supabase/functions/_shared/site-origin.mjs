// Server configuration only: exact origins, no wildcard or request-derived redirects.
export function siteOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('RSVP_SITE_ORIGIN must be configured for this installation');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin === 'null') throw new Error('RSVP_SITE_ORIGIN must be an exact HTTP(S) origin without a path');
  return url.origin;
}
export function corsHeaders(origin) {
  return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
}
