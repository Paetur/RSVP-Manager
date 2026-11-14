-- Add the approved settings-card heading without removing saved wording or aliases.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || jsonb_build_object('Publication','interface.messages.publication');
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;
COMMIT;
