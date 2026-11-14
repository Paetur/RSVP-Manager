BEGIN;
-- Labels only: no application data, backup checks, grants or RLS policies change.
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Checklist": "interface.messages.checklist", "Quantity: {claimed}/{capacity}": "interface.messages.food_quantity_totals"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
