BEGIN;
-- Optional per-scope expiry; missing Admin values retain the original five-second default.
CREATE OR REPLACE FUNCTION app_private.valid_notification_preferences(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE scope text;policy jsonb;
BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR NOT(p?'admin' AND p?'guest') THEN RETURN false;END IF;
 FOREACH scope IN ARRAY ARRAY['admin','guest'] LOOP
  policy:=p->scope;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(policy))<>(CASE WHEN policy?'autoDismiss' THEN 3 ELSE 2 END) OR jsonb_typeof(policy->'preset') IS DISTINCT FROM 'string' OR policy->>'preset' NOT IN ('all','errors','custom') OR jsonb_typeof(policy->'types') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF policy?'autoDismiss' AND jsonb_typeof(policy->'autoDismiss') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'types') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'string' OR t#>>'{}' NOT IN ('info','success','warning','error')) OR (SELECT count(*) FROM jsonb_array_elements(policy->'types'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(policy->'types')) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;

-- Rename the shared label without rewriting existing event preferences or translations.
DO $wording$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN
 IF strpos(d,'Hide guest messages after 5 seconds')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;
 EXECUTE replace(d,'Hide guest messages after 5 seconds','Hide messages after 5 seconds');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
