-- Extend the interface wording registry without touching event records or permissions.
BEGIN;
DO $migration$
DECLARE definition text; additions jsonb := '{"Close": "interface.messages.popup_close", "Preview": "interface.messages.pdf_print_preview", "No recipe has been added yet.": "food.messages.no_recipe_yet"}'::jsonb;
BEGIN
 definition:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $migration$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
