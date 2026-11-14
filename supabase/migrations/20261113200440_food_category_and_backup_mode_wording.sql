BEGIN;
-- Additive wording only; application data and backup v2 contract are unchanged.
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"{count} sub-category": "interface.messages.food_count_subcategory", "{count} sub-categories": "interface.messages.food_count_subcategories", "Add item or sub-category": "interface.messages.food_add_choices", "Planned backup": "interface.messages.backup_planned_export", "Full restore": "interface.messages.backup_full_restore", "Planned restore": "interface.messages.backup_planned_restore"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
