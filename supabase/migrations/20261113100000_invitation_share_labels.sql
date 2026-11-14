-- Share-sheet labels only; no new delivery channels or permission grants.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || $entries${"Share invitation": "interface.messages.share_invitation", "Choose the displayed recipient in your app. Sharing does not mark this invitation as sent. Return here to record it and note the app you used.": "interface.messages.share_invitation_help", "System sharing is unavailable here. Use Copy message or open a device app.": "interface.messages.share_unavailable"}$entries$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;
COMMIT;
