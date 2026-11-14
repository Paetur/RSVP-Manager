BEGIN;
ALTER TABLE public.event_settings ADD COLUMN guest_theme_toggle boolean NOT NULL DEFAULT true,ADD COLUMN guest_theme_default text NOT NULL DEFAULT 'dark' CHECK(guest_theme_default IN ('system','light','dark'));
CREATE FUNCTION public.admin_save_guest_appearance(p_show_toggle boolean,p_default_theme text,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_show_toggle IS NULL OR p_default_theme IS NULL OR p_default_theme NOT IN ('system','light','dark') THEN RAISE EXCEPTION 'Invalid guest appearance';END IF;
 UPDATE public.event_settings e SET guest_theme_toggle=p_show_toggle,guest_theme_default=p_default_theme WHERE id=1 AND jsonb_build_object('guest_theme_toggle',e.guest_theme_toggle,'guest_theme_default',e.guest_theme_default)=p_expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'Guest appearance changed; refresh before saving';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_guest_appearance(boolean,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_guest_appearance(boolean,text,jsonb) TO authenticated;
DO $$ DECLARE f regprocedure;d text;BEGIN FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP d:=pg_get_functiondef(f);IF strpos(d,'''20261111235847''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,'''20261111235847''','''20261112005150''');END LOOP;END $$;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Guest appearance": "interface.messages.guest_appearance", "Show light/dark toggle on the guest page": "interface.messages.guest_theme_toggle", "Guest default appearance": "interface.messages.guest_theme_default", "Guests can change the default when the toggle is shown. Hiding it enforces the default. Your administrator appearance stays personal.": "interface.messages.guest_theme_help", "We’ll share more information about the food once we’ve received everyone’s replies.": "interface.messages.food_followup"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;
