-- Additive wording only. No stored event data or security policy changes.
BEGIN;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Set RSVP_SITE_ORIGIN to {origin} and RSVP_SITE_URL to {siteUrl} in Supabase Edge Function secrets.": "interface.messages.setup_site_secrets", "In Supabase Authentication, set Site URL to {siteUrl} and allow the administrator invitation redirect {redirectUrl}.": "interface.messages.setup_auth_urls"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
