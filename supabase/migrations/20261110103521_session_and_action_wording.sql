BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_sessions() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'name',a.name,'created_at',s.created_at,'refreshed_at',to_jsonb(s)->>'refreshed_at','last_activity',coalesce(to_jsonb(s)->>'refreshed_at',to_jsonb(s)->>'updated_at',s.created_at::text),'user_agent',left(coalesce(to_jsonb(s)->>'user_agent',''),300),'current',s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) ORDER BY s.created_at DESC) FROM auth.sessions s JOIN public.admins a ON a.user_id=s.user_id WHERE a.access_state='active' AND (s.user_id=auth.uid() OR public.admin_has_permission('revokeSessions')) AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>statement_timestamp()) AND NOT EXISTS(SELECT 1 FROM app_private.admin_session_revocations r WHERE r.session_id=s.id)),'[]');
END $$;
-- Preserve legacy session output for older clients. The new interface uses
-- refreshed_at only, so an updated or created timestamp cannot look like a renewal.
DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:=$labels${
 "Enable access": "interface.messages.access_enable_access",
 "Suspend access": "interface.messages.access_suspend_access",
 "Revoke session": "interface.messages.access_revoke_session",
 "Session refreshed": "interface.messages.access_session_refreshed",
 "{browser} on {device}": "interface.messages.access_session_browser_device",
 "Apple device": "interface.messages.access_session_apple_device",
 "Session refreshed shows when the sign-in session last renewed. Revocation ends access to this application. Everyone can revoke their own sessions.": "interface.messages.access_session_refresh_help",
 "Permanently delete {name}?": "interface.messages.confirm_delete_named_record",
 "Remove assignment for {household}": "interface.messages.remove_named_assignment",
 "Remove {household}’s assignment for {item}?": "interface.messages.confirm_remove_food_assignment",
 "Show to guests": "interface.messages.show_to_guests",
 "Hide from guests": "interface.messages.hide_from_guests",
 "Hidden from guests": "interface.messages.hidden_from_guests"
}$labels$::jsonb;
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
