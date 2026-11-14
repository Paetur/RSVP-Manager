-- Add account-preference wording; preserve existing keys, overrides and aliases.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || jsonb_build_object(
  'Personal preferences for your account, across devices.', 'interface.messages.personal_account_preferences',
  'Your preference could not be saved. Please try again.', 'interface.messages.personal_preference_failed');
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;
COMMIT;
