-- Collect household willingness before exposing the prepared menu.
BEGIN;
ALTER TABLE public.event_settings ADD COLUMN food_stage text NOT NULL DEFAULT 'interest' CHECK(food_stage IN ('interest','selection'));
ALTER TABLE public.households ADD COLUMN food_interest boolean;
CREATE FUNCTION public.admin_set_food_stage(p_stage text,p_expected_stage text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('food','edit');
 IF p_stage IS NULL OR p_stage NOT IN ('interest','selection') THEN RAISE EXCEPTION 'Choose a valid food stage';END IF;
 UPDATE public.event_settings SET food_stage=p_stage WHERE id=1 AND food_stage=p_expected_stage;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food stage changed; refresh before saving';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_food_stage(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_food_stage(text,text) TO authenticated;
CREATE FUNCTION app_private.require_food_selection_stage() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.event_settings WHERE id=1 AND food_stage='selection' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The detailed food list is not open yet';END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.require_food_selection_stage() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.set_household_food_interest(p_code text,p_interest boolean,p_expected_interest boolean DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_interest IS NULL THEN RAISE EXCEPTION 'Invalid food interest response';END IF;
 PERFORM 1 FROM public.event_settings WHERE id=1 AND is_published FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Invalid invitation';END IF;
 IF h.food_interest IS NOT DISTINCT FROM p_interest THEN RETURN app_private.guest_food(h.id,false);END IF;
 IF h.food_interest IS DISTINCT FROM p_expected_interest THEN RAISE EXCEPTION 'Food answer changed; refresh before saving';END IF;
 IF NOT p_interest AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=h.id)) THEN RAISE EXCEPTION 'Contact the organizer to change existing food commitments';END IF;
 UPDATE public.households SET food_interest=p_interest WHERE id=h.id;
 RETURN app_private.guest_food(h.id,false);
END $$;
REVOKE ALL ON FUNCTION public.set_household_food_interest(text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_household_food_interest(text,boolean,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.guest_food(h.id,false) FROM public.households h CROSS JOIN public.event_settings e
 WHERE e.id=1 AND e.is_published AND h.invite_code=p_code AND h.archived_at IS NULL AND (h.food OR e.food_stage='interest')
$$;
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;
DO $stage$
DECLARE d text;f regprocedure;needle text;inserted text;
BEGIN
 d:=pg_get_functiondef('app_private.guest_food(uuid,boolean)'::regprocedure);
 needle:='BEGIN'||chr(10)||' SELECT jsonb_build_object(';
 inserted:='BEGIN'||chr(10)||' IF (SELECT food_stage FROM public.event_settings WHERE id=1)=''interest'' THEN RETURN jsonb_build_object(''stage'',''interest'',''interest'',(SELECT food_interest FROM public.households WHERE id=v_household),''items'',''[]''::jsonb,''claims'',''[]''::jsonb,''groups'',''[]''::jsonb,''categories'',''[]''::jsonb,''confirmed'',false);END IF;'||chr(10)||' SELECT jsonb_build_object(';
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected guest food projection';END IF;
 d:=replace(d,needle,inserted);
 d:=replace(d,chr(10)||' SELECT jsonb_build_object(',chr(10)||' IF NOT p_sample AND NOT coalesce((SELECT food FROM public.households WHERE id=v_household),false) THEN RETURN jsonb_build_object(''stage'',''selection'',''interest'',(SELECT food_interest FROM public.households WHERE id=v_household),''items'',''[]''::jsonb,''claims'',''[]''::jsonb,''groups'',''[]''::jsonb,''categories'',''[]''::jsonb,''confirmed'',false);END IF;'||chr(10)||' SELECT jsonb_build_object(');
 d:=replace(d,'RETURN v_result;','RETURN v_result || jsonb_build_object(''stage'',''selection'',''interest'',(SELECT food_interest FROM public.households WHERE id=v_household));');EXECUTE d;
 d:=pg_get_functiondef('app_private.guest_event()'::regprocedure);
 needle:='c.content_key NOT LIKE ''ui:%''';
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected event content projection';END IF;
 d:=replace(d,needle,needle||' AND (e.food_stage=''selection'' OR (c.content_key NOT LIKE ''food:%'' AND c.content_key NOT LIKE ''food-category:%''))');EXECUTE d;
 d:=pg_get_functiondef('public.admin_guest_preview(uuid,boolean)'::regprocedure);
 d:=replace(d,'IF h.food THEN food:=','IF h.food OR (SELECT food_stage FROM public.event_settings WHERE id=1)=''interest'' THEN food:=');EXECUTE d;
 FOREACH f IN ARRAY ARRAY['public.set_household_food_claim(text,uuid,integer,text)'::regprocedure,'public.set_household_food_group(text,uuid,integer)'::regprocedure,'public.confirm_household_food(text)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);d:=regexp_replace(d,'\mBEGIN\M','BEGIN PERFORM app_private.require_food_selection_stage();','i');
  IF f='public.set_household_food_claim(text,uuid,integer,text)'::regprocedure OR f='public.set_household_food_group(text,uuid,integer)'::regprocedure THEN
   d:=regexp_replace(d,'END[[:space:]]*\$function\$', 'IF p_quantity>0 THEN UPDATE public.households SET food_interest=true WHERE id=h.id AND food_interest IS DISTINCT FROM true;END IF; END $function$');
  END IF;
  EXECUTE d;
 END LOOP;
 d:=pg_get_functiondef('public.guest_gateway_allow_request(text,text,text)'::regprocedure);d:=replace(d,'''get_invitation_v2''','''set_household_food_interest'',''get_invitation_v2''');EXECUTE d;
 d:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 d:=replace(d,'''is_published'',e.is_published','''is_published'',e.is_published,''food_stage'',e.food_stage');
 d:=replace(d,'''food_confirmed'',a.food_confirmed','''food_confirmed'',a.food_confirmed,''food_interest'',a.food_interest');
 d:=replace(d,'to_jsonb(a)-''notes''-''postal_address''-''food''-''food_confirmed''', 'to_jsonb(a)-''notes''-''postal_address''-''food''-''food_confirmed''-''food_interest''');
 EXECUTE d;
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);IF strpos(d,'''20261111104205''')=0 THEN RAISE EXCEPTION 'Unexpected backup version';END IF;EXECUTE replace(d,'''20261111104205''','''20261111125023''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);IF strpos(d,'''20261111104205''')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;EXECUTE replace(d,'''20261111104205''','''20261111125023''');
 d:=pg_get_functiondef('app_private.backup_as_template(jsonb,text[])'::regprocedure);
 d:=replace(d,'''food_confirmed_at'',NULL','''food_confirmed_at'',NULL,''food_interest'',NULL');
 needle:='payload:=(payload-';IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected template builder';END IF;
 d:=replace(d,needle,'tables:=jsonb_set(tables,ARRAY[''public.event_settings''],(SELECT jsonb_agg(value||''{"food_stage":"interest"}''::jsonb) FROM jsonb_array_elements(tables->''public.event_settings''))); '||needle);EXECUTE d;
END $stage$;
REVOKE ALL ON FUNCTION app_private.guest_food(uuid,boolean),app_private.guest_event(),app_private.backup_as_template(jsonb,text[]) FROM PUBLIC,anon,authenticated;

DO $labels$
DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure); additions jsonb:=$newlabels${"Food coordination": "interface.messages.food_coordination", "Guest food step": "interface.messages.food_stage", "Ask whether guests can bring food": "interface.messages.food_stage_interest", "Open the detailed food list": "interface.messages.food_stage_selection", "Keep the detailed list hidden while planning. Opening it does not publish the event. Hiding it again preserves all commitments.": "interface.messages.food_stage_help", "Open the detailed food list for eligible households? This does not publish the event.": "interface.messages.food_stage_confirm", "Guest food step saved.": "interface.messages.food_stage_saved", "Can you bring food?": "interface.messages.food_interest_question", "Let us know whether your household can bring food. We will send the invitation link again when the detailed list is ready.": "interface.messages.food_interest_help", "I can bring food": "interface.messages.food_interest_yes", "I can’t bring food": "interface.messages.food_interest_no", "Your food answer has been saved.": "interface.messages.food_interest_saved", "Could not save your food answer. Your choice is still here; refresh or contact the organizer if you already have commitments.": "interface.messages.food_interest_failed", "Not answered": "interface.messages.food_interest_pending", "Household food answers": "interface.messages.food_interest_answers", "Can bring food: {yes} · Cannot: {no} · Not answered: {pending}": "interface.messages.food_interest_totals"}$newlabels$::jsonb;
BEGIN
 IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;
 EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;
