BEGIN;
-- The photo belongs to private event data, never to the anonymous static webroot.
ALTER TABLE public.event_settings ADD COLUMN guest_background jsonb CHECK(guest_background IS NULL OR (jsonb_typeof(guest_background)='object' AND jsonb_typeof(guest_background->'image')='string' AND length(guest_background->>'image')<=2000000 AND guest_background->>'image' ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'));
DO $$ DECLARE f regprocedure;d text;BEGIN
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
 d:=pg_get_functiondef(f);IF strpos(d,'''20261111210551''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,'''20261111210551''','''20261111235847''');
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
