BEGIN;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Time: {start} to {end}": "interface.messages.venue_time_range", "Time: {time}": "interface.messages.venue_time"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;
