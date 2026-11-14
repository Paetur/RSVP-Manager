-- Add organizer wording without changing guest wording, saved overrides or data.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || jsonb_build_object(
  'Selecting a group commits the household to one unit of every included item.',
  'interface.messages.admin_group_commitment');
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;
COMMIT;
