BEGIN;
-- Add sources without retiring any historical source or changing canonical keys.
DO $registry$
DECLARE
 original jsonb:=app_private.translation_keys();
 additions jsonb:=$labels${"Date filters use the event timezone. Entries show your local time. Expand an entry for its UTC time and details. Household and guest archive, restore and deletion are logged.": "interface.messages.date_filters_use_the_event_timezone_entries_show_your_local_time_", "Link": "interface.messages.invite_copy_link_short"}$labels$::jsonb;
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 needle text:='$json$::jsonb';
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_each_text(additions) a WHERE original?a.key AND original->>a.key IS DISTINCT FROM a.value) THEN
  RAISE EXCEPTION 'Registry source already maps to a different key';
 END IF;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;
 EXECUTE replace(definition,needle,needle||' || '||quote_literal(additions::text)||'::jsonb');
 IF app_private.translation_keys() IS DISTINCT FROM original||additions THEN
  RAISE EXCEPTION 'Registry alignment changed an existing mapping';
 END IF;
END $registry$;
NOTIFY pgrst,'reload schema';
COMMIT;
