BEGIN;
-- Optional independent timestamp flags. Missing Admin values stay on; Guest stays off.
-- Existing JSON, event settings and backup contract are not rewritten.
CREATE OR REPLACE FUNCTION app_private.valid_notification_preferences(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE scope text;policy jsonb;
BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR NOT(p?'admin' AND p?'guest') THEN RETURN false;END IF;
 FOREACH scope IN ARRAY ARRAY['admin','guest'] LOOP
  policy:=p->scope;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(policy))<>(2 + CASE WHEN policy?'autoDismiss' THEN 1 ELSE 0 END + CASE WHEN policy?'showTimestamp' THEN 1 ELSE 0 END) OR jsonb_typeof(policy->'preset') IS DISTINCT FROM 'string' OR policy->>'preset' NOT IN ('all','errors','custom') OR jsonb_typeof(policy->'types') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF policy?'autoDismiss' AND jsonb_typeof(policy->'autoDismiss') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF policy?'showTimestamp' AND jsonb_typeof(policy->'showTimestamp') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'types') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'string' OR t#>>'{}' NOT IN ('info','success','warning','error')) OR (SELECT count(*) FROM jsonb_array_elements(policy->'types'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(policy->'types')) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog||jsonb_build_object('Show timestamps','interface.messages.status_messages_show_timestamp');
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
