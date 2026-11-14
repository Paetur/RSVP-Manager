-- Extend the interface wording registry without touching event records or permissions.
BEGIN;
DO $migration$
DECLARE definition text; additions jsonb := '{"Adults: {adults} · Children: {children}": "interface.messages.guest_age_summary", "Quantity: {claimed}/{needed} {type}": "interface.messages.quantity_claimed_needed_type"}'::jsonb;
BEGIN
 definition:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $migration$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
