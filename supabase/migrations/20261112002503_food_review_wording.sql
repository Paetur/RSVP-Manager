BEGIN;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Review food selections": "interface.messages.food_review", "Check what your household will bring before confirming.": "interface.messages.food_review_help", "Your food selections changed. Please review them again.": "interface.messages.food_review_changed"}')||'::jsonb');END $labels$;
CREATE FUNCTION public.confirm_household_food(p_code text,p_expected_claims jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households;expected jsonb;actual jsonb;
BEGIN
 PERFORM app_private.require_food_selection_stage();
 IF p_expected_claims IS NULL OR jsonb_typeof(p_expected_claims)<>'array' THEN RAISE EXCEPTION 'Invalid food review';END IF;
 IF jsonb_array_length(p_expected_claims) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid food review';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_expected_claims) c WHERE jsonb_typeof(c)<>'object' OR NOT(c ?& ARRAY['food_item_id','quantity']) OR (SELECT count(*) FROM jsonb_object_keys(c))<>2 OR coalesce(c->>'food_item_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR jsonb_typeof(c->'quantity')<>'number' OR c->>'quantity' !~ '^[1-9][0-9]{0,3}$' OR (c->>'quantity')::integer>1000) THEN RAISE EXCEPTION 'Invalid food review';END IF;
 IF (SELECT count(DISTINCT (c->>'food_item_id')::uuid) FROM jsonb_array_elements(p_expected_claims) c)<>jsonb_array_length(p_expected_claims) THEN RAISE EXCEPTION 'Invalid food review';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RAISE EXCEPTION 'Invalid invitation';END IF;
 SELECT jsonb_agg(jsonb_build_array((c->>'food_item_id')::uuid,(c->>'quantity')::integer) ORDER BY (c->>'food_item_id')::uuid) INTO expected FROM jsonb_array_elements(p_expected_claims) c;
 SELECT jsonb_agg(jsonb_build_array(food_item_id,quantity) ORDER BY food_item_id) INTO actual FROM public.food_claims WHERE household_id=h.id;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Food selections changed; review them again';END IF;
 IF h.food_confirmed THEN RETURN;END IF;
 PERFORM public.confirm_household_food(p_code);
END $$;
REVOKE ALL ON FUNCTION public.confirm_household_food(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_household_food(text,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
