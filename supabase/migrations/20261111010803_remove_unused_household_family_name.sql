-- Match fresh installations to the current backup schema.
-- This obsolete column is unused by the application. Preserve unexpected data.
BEGIN;
DO $cleanup$
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='households' AND column_name='family_name') THEN
  IF EXISTS (SELECT 1 FROM public.households WHERE family_name IS NOT NULL) THEN
   RAISE EXCEPTION 'Move remaining households.family_name values before removing the obsolete column';
  END IF;
  ALTER TABLE public.households DROP COLUMN family_name;
 END IF;
END $cleanup$;
NOTIFY pgrst,'reload schema';
COMMIT;
