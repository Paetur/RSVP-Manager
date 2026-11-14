BEGIN;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Print":"interface.messages.print"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;
