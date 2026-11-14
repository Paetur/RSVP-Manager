BEGIN;
-- Nullable preferences preserve the original All messages behavior.
CREATE FUNCTION app_private.valid_notification_preferences(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE scope text;policy jsonb;
BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR NOT(p?'admin' AND p?'guest') THEN RETURN false;END IF;
 FOREACH scope IN ARRAY ARRAY['admin','guest'] LOOP
  policy:=p->scope;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(policy))<>(CASE WHEN scope='guest' AND policy?'autoDismiss' THEN 3 ELSE 2 END) OR jsonb_typeof(policy->'preset') IS DISTINCT FROM 'string' OR policy->>'preset' NOT IN ('all','errors','custom') OR jsonb_typeof(policy->'types') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF policy?'autoDismiss' AND (scope<>'guest' OR jsonb_typeof(policy->'autoDismiss') IS DISTINCT FROM 'boolean') THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'types') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'string' OR t#>>'{}' NOT IN ('info','success','warning','error')) OR (SELECT count(*) FROM jsonb_array_elements(policy->'types'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(policy->'types')) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app_private.valid_notification_preferences(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.valid_notification_preferences(jsonb) TO authenticated;
ALTER TABLE public.event_settings ADD COLUMN notification_preferences jsonb CHECK(app_private.valid_notification_preferences(notification_preferences));
CREATE FUNCTION public.admin_save_notification_preferences(p_preferences jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_preferences jsonb;
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF NOT app_private.valid_notification_preferences(p_preferences) THEN RAISE EXCEPTION 'Invalid status message preferences';END IF;
 SELECT notification_preferences INTO current_preferences FROM public.event_settings WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR current_preferences IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Status message preferences changed; refresh before saving';END IF;
 UPDATE public.event_settings SET notification_preferences=p_preferences WHERE id=1;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_notification_preferences(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_notification_preferences(jsonb,jsonb) TO authenticated;
CREATE FUNCTION app_private.guard_notification_preferences() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND OLD.notification_preferences IS DISTINCT FROM NEW.notification_preferences THEN RAISE EXCEPTION 'Use the status message settings editor.' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_notification_preferences() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_notification_preferences BEFORE UPDATE OF notification_preferences ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_notification_preferences();
-- Guests receive only their policy, through the unchanged private invitation/preview boundaries.
DO $projection$ DECLARE d text;needle text;BEGIN
 d:=pg_get_functiondef('app_private.guest_event()'::regprocedure);needle:=$n$'event',to_jsonb(e)$n$;
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected guest projection';END IF;
 EXECUTE replace(d,needle,$r$'event',(to_jsonb(e)-'notification_preferences')||jsonb_build_object('notification_preferences',jsonb_build_object('guest',e.notification_preferences->'guest'))$r$);
 d:=pg_get_functiondef('public.admin_load_data()'::regprocedure);needle:=$n$'planning_config',e.planning_config) END$n$;
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected administrator projection';END IF;
 EXECUTE replace(d,needle,$r$'planning_config',e.planning_config,'notification_preferences',jsonb_build_object('admin',e.notification_preferences->'admin')) END$r$);
END $projection$;
DO $backup$ DECLARE f regprocedure;d text;BEGIN
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);IF strpos(d,$n$'20261112124152'$n$)=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,$n$'20261112124152'$n$,$n$'20261112163128'$n$);
 END LOOP;
END $backup$;
DO $wording$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal($labels${"Status messages": "interface.messages.status_messages_title", "Choose which temporary messages appear. Saved logs, form errors and confirmation lists are unchanged.": "interface.messages.status_messages_help", "All messages": "interface.messages.status_messages_all", "Errors only": "interface.messages.status_messages_errors_only", "Information": "interface.messages.status_messages_information", "Success": "interface.messages.status_messages_success", "Warnings": "interface.messages.status_messages_warnings", "Errors": "interface.messages.status_messages_errors", "Status message preferences saved.": "interface.messages.status_messages_saved", "Hide guest messages after 5 seconds": "interface.messages.status_messages_auto_dismiss"}$labels$)||'::jsonb');END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
