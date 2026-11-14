BEGIN;
ALTER TABLE public.event_settings ADD COLUMN food_enabled boolean NOT NULL DEFAULT true, ADD COLUMN other_enabled boolean NOT NULL DEFAULT true, ADD COLUMN food_introduction jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(food_introduction)='object');
CREATE FUNCTION public.admin_save_features(p_food boolean,p_other boolean,p_stage text,p_introduction jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_food IS NULL OR p_other IS NULL OR p_stage IS NULL OR p_stage NOT IN ('interest','selection') OR p_introduction IS NULL OR jsonb_typeof(p_introduction)<>'object' THEN RAISE EXCEPTION 'Invalid feature settings';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_introduction) x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>6000 OR NOT EXISTS(SELECT 1 FROM public.event_languages l WHERE l.language_code=x.key)) THEN RAISE EXCEPTION 'Invalid food explanation';END IF;
 UPDATE public.event_settings e SET food_enabled=p_food,other_enabled=p_other,food_stage=p_stage,food_introduction=p_introduction
 WHERE id=1 AND jsonb_build_object('food_enabled',e.food_enabled,'other_enabled',e.other_enabled,'food_stage',e.food_stage,'food_introduction',e.food_introduction)=p_expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'Feature settings changed; refresh before saving';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_features(boolean,boolean,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_features(boolean,boolean,text,jsonb,jsonb) TO authenticated;
DO $features$
DECLARE d text;f regprocedure;
BEGIN
 d:=pg_get_functiondef('public.admin_has_permission(text,text)'::regprocedure);
 IF strpos(d,'SELECT public.is_admin() AND')=0 THEN RAISE EXCEPTION 'Unexpected permission definition';END IF;
 d:=replace(d,'SELECT public.is_admin() AND','SELECT (CASE WHEN p_section=''food'' THEN coalesce((SELECT food_enabled FROM public.event_settings WHERE id=1),false) WHEN p_section=''other'' THEN coalesce((SELECT other_enabled FROM public.event_settings WHERE id=1),false) ELSE true END) AND public.is_admin() AND');EXECUTE d;
 d:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 d:=replace(d,'''food_stage'',e.food_stage','''food_stage'',e.food_stage,''food_enabled'',e.food_enabled,''other_enabled'',e.other_enabled');EXECUTE d;
 d:=pg_get_functiondef('app_private.guest_food(uuid,boolean)'::regprocedure);
 d:=regexp_replace(d,'\mBEGIN\M','BEGIN IF NOT coalesce((SELECT food_enabled FROM public.event_settings WHERE id=1),false) THEN RETURN NULL;END IF;','i');EXECUTE d;
 d:=pg_get_functiondef('public.get_household_food(text)'::regprocedure);d:=replace(d,'e.is_published','e.is_published AND e.food_enabled');EXECUTE d;
 d:=pg_get_functiondef('public.set_household_food_interest(text,boolean,boolean)'::regprocedure);d:=replace(d,'AND is_published FOR SHARE','AND is_published AND food_enabled FOR SHARE');EXECUTE d;
 d:=pg_get_functiondef('app_private.require_food_selection_stage()'::regprocedure);d:=replace(d,'food_stage=''selection''' , 'food_stage=''selection'' AND food_enabled');EXECUTE d;
 d:=pg_get_functiondef('app_private.guest_event()'::regprocedure);d:=replace(d,'e.food_stage=''selection''' , 'e.food_enabled AND e.food_stage=''selection''');EXECUTE d;
 -- Preview remains available for authorized organizers when Food is disabled.
 d:=pg_get_functiondef('public.admin_guest_preview(uuid,boolean)'::regprocedure);d:=replace(d,'PERFORM app_private.require_permission(''food'');','IF (SELECT food_enabled FROM public.event_settings WHERE id=1) THEN PERFORM app_private.require_permission(''food'');END IF;');EXECUTE d;
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);IF strpos(d,'''20261111125023''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,'''20261111125023''','''20261111210551''');
 END LOOP;
END $features$;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Features": "interface.messages.event_features", "Disabled features are hidden. Existing data is kept.": "interface.messages.features_preserve_data", "Food explanation": "interface.messages.food_explanation"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;
