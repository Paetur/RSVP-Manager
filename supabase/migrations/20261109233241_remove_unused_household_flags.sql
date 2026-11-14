BEGIN;

LOCK TABLE public.households IN ACCESS EXCLUSIVE MODE;

DO $cleanup$
DECLARE definition text:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 needle text:='-''stuff''-''things''';
BEGIN
 IF EXISTS(SELECT 1 FROM public.households WHERE stuff OR things) THEN
  RAISE EXCEPTION 'Review populated household flags before removing them';
 END IF;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected household projection';END IF;
 EXECUTE replace(definition,needle,'');
END $cleanup$;

ALTER TABLE public.households DROP COLUMN stuff, DROP COLUMN things;

NOTIFY pgrst,'reload schema';
COMMIT;
