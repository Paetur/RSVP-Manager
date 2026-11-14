-- Current membership and live-session checks, never user-editable JWT metadata.
BEGIN;
CREATE FUNCTION app_private.permission_preset(p text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('preset',p,'sections',jsonb_build_object('venues',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'households',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'food',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'other',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'invites',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'languages',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'settings',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'administrators',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END),'sendInvites',p='full','exportBackup',p='full','restoreBackup',p='full','revokeSessions',p='full')
$$;
CREATE FUNCTION app_private.valid_permissions(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;v jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>6 OR coalesce(p->>'preset','') NOT IN ('full','view','custom') OR jsonb_typeof(p->'sections') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p->'sections'))<>8 THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['venues','households','food','other','invites','languages','settings','administrators'] LOOP IF coalesce(p->'sections'->>k,'') NOT IN ('none','view','edit') THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['sendInvites','exportBackup','restoreBackup','revokeSessions'] LOOP IF jsonb_typeof(p->k) IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;END LOOP;
 IF p->>'preset' IN ('full','view') AND p<>app_private.permission_preset(p->>'preset') THEN RETURN false;END IF;
 IF p->'sections'->>'invites'='none' AND (p->>'sendInvites')::boolean THEN RETURN false;END IF;
 IF p->'sections'->>'administrators'='none' AND (p->>'revokeSessions')::boolean THEN RETURN false;END IF;
 RETURN true;
END $$;
ALTER TABLE public.admins ADD COLUMN access_state text NOT NULL DEFAULT 'active' CHECK(access_state IN ('active','suspended','restored'));
ALTER TABLE public.admins ADD COLUMN access_permissions jsonb NOT NULL DEFAULT app_private.permission_preset('full') CHECK(app_private.valid_permissions(access_permissions));
CREATE TABLE app_private.admin_session_revocations(session_id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),revoked_by uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE app_private.pending_admin_permissions(invitation_id uuid PRIMARY KEY REFERENCES public.admin_invitations(id),permissions jsonb NOT NULL CHECK(app_private.valid_permissions(permissions)));
CREATE TABLE app_private.admin_access_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL REFERENCES auth.users(id),subject_id uuid NOT NULL REFERENCES auth.users(id),action text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX admin_session_revocations_user ON app_private.admin_session_revocations(user_id);
CREATE INDEX admin_session_revocations_actor ON app_private.admin_session_revocations(revoked_by);
CREATE INDEX admin_access_audit_actor ON app_private.admin_access_audit(actor_id,created_at DESC);
CREATE INDEX admin_access_audit_subject ON app_private.admin_access_audit(subject_id,created_at DESC);
ALTER TABLE app_private.admin_session_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.pending_admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.admin_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.admin_session_revocations,app_private.pending_admin_permissions,app_private.admin_access_audit FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_admin_access BEFORE UPDATE OR DELETE ON app_private.admin_access_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
-- Preserve the intended Full access of invitations sent before this migration.
INSERT INTO app_private.pending_admin_permissions SELECT id,app_private.permission_preset('full') FROM public.admin_invitations WHERE status='pending';
CREATE FUNCTION app_private.session_is_live() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 RETURN auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=sid AND s.user_id=auth.uid() AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>statement_timestamp())) AND NOT EXISTS(SELECT 1 FROM app_private.admin_session_revocations r WHERE r.session_id=sid);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.session_is_live() AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid() AND access_state='active')
$$;
CREATE OR REPLACE FUNCTION app_private.require_live_session() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT app_private.session_is_live() THEN RAISE EXCEPTION 'Administrator session revoked or expired. Sign in again.' USING ERRCODE='PT401';END IF;RETURN auth.uid();
END $$;
CREATE FUNCTION public.admin_has_permission(p_section text,p_level text DEFAULT 'view') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_admin() AND coalesce((SELECT CASE WHEN p_section='full' THEN access_permissions->>'preset'='full' WHEN p_section IN ('sendInvites','exportBackup','restoreBackup','revokeSessions') THEN coalesce((access_permissions->>p_section)::boolean,false) WHEN p_level='edit' THEN access_permissions->'sections'->>p_section='edit' WHEN p_level='view' THEN access_permissions->'sections'->>p_section IN ('view','edit') ELSE false END FROM public.admins WHERE user_id=auth.uid()),false)
$$;
CREATE FUNCTION app_private.require_permission(p_section text,p_level text DEFAULT 'view') RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 IF NOT public.admin_has_permission(p_section,p_level) THEN RAISE EXCEPTION 'This action is not allowed by your administrator permissions.' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION app_private.require_admin_operation(op text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE section text;level text:='edit';
BEGIN
 IF op IN ('admin_record_delivery_sent','admin_confirm_invitation_sent') AND public.admin_has_permission('sendInvites') THEN PERFORM app_private.require_permission('sendInvites');RETURN;END IF;
 section:=CASE
 WHEN op IN ('admin_list_members','admin_list_invitations') THEN 'administrators'
 WHEN op IN ('admin_prepare_invitation','admin_cancel_invitation','admin_rename_member','admin_add_existing_user','admin_remove_member') THEN 'administrators'
 WHEN op IN ('admin_save_household','admin_save_household_with_food','admin_create_guest','admin_update_guest','admin_move_guest','admin_move_household','admin_set_household_parent','admin_save_contact','admin_set_archived','admin_set_food_access') THEN 'households'
 WHEN op IN ('admin_authorize_late_rsvp','admin_correct_rsvp','admin_reopen_household_rsvp','admin_save_session_assignments','admin_edit_session_households','admin_save_delivery','admin_record_delivery_sent','admin_confirm_invitation_sent') THEN 'invites'
 WHEN op='admin_session_invitation_locks' THEN 'invites'
 WHEN op IN ('admin_save_venue','admin_save_venue_with_translations','admin_save_session','admin_move_session','admin_move_venue') THEN 'venues'
 WHEN op IN ('admin_add_venue_food','admin_edit_venue_food','admin_move_food_category','admin_move_food_item','admin_rename_food_category','admin_set_food_category','admin_set_food_selection') THEN 'food'
 WHEN op IN ('admin_save_food_translations','admin_save_language','admin_set_language_preferences','admin_move_language','admin_save_translation','admin_save_translations') THEN 'languages'
 WHEN op IN ('admin_save_other','admin_save_other_category','admin_move_other_category','admin_delete_other_category') THEN 'other'
 WHEN op='admin_export_backup' THEN 'exportBackup'
 WHEN op IN ('admin_preview_backup','admin_restore_backup') THEN 'restoreBackup'
 ELSE 'full' END;
 IF op IN ('admin_list_members','admin_list_invitations','admin_session_invitation_locks') THEN level:='view';END IF;
 PERFORM app_private.require_permission(section,level);
END $$;
-- Inject a guard into each existing administrator RPC without changing its signature,
-- dependencies, historical validation or grants. The invoker-only atomic household
-- wrapper delegates to two separately guarded RPCs. Invitation acceptance is a separate,
-- non-member operation; provider completion is service-role-only.
DO $$ DECLARE f record;definition text; BEGIN
 FOR f IN SELECT p.oid,p.proname,p.prosecdef FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'admin_%' AND p.proname NOT IN ('admin_has_permission','admin_my_invitation','admin_accept_invitation','admin_finish_invitation','admin_record_session') LOOP
  IF NOT f.prosecdef THEN IF f.proname='admin_save_household_with_food' THEN CONTINUE;ELSE RAISE EXCEPTION 'Unreviewed invoker administrator RPC: %',f.proname;END IF;END IF;
  definition:=pg_get_functiondef(f.oid);
  IF definition NOT LIKE '%LANGUAGE plpgsql%' THEN RAISE EXCEPTION 'Unreviewed administrator RPC language: %',f.proname;END IF;
  definition:=regexp_replace(definition,'\mBEGIN\M',format('BEGIN PERFORM app_private.require_admin_operation(%L);',f.proname),'i');EXECUTE definition;
 END LOOP;
END $$;
-- Direct table reads and writes obey the same section permissions. Restrictive
-- policies are ANDed with existing membership policies, including future ones.
CREATE FUNCTION app_private.table_section(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN t IN ('households','guests','household_contacts','relation_groups','management_audit') THEN 'households' WHEN t IN ('event_locations','event_sessions','event_configuration_audit') THEN 'venues' WHEN t IN ('food_categories','food_items','food_claims','food_item_types') THEN 'food' WHEN t IN ('other_items','other_categories') THEN 'other' WHEN t IN ('event_languages','event_content','event_translations','translation_overrides','food_item_translations','food_category_translations','venue_translations','session_translations','food_type_translations') THEN 'languages' WHEN t IN ('event_settings') THEN 'settings' WHEN t IN ('rsvp_submissions','guest_session_responses','household_session_defaults','guest_session_overrides','invitation_send_queue','invitation_deliveries','invitation_delivery_audit','rsvp_household_audit','rsvp_response_audit','message_templates','invitation_access_audit') THEN 'invites' WHEN t IN ('admins','admin_membership_audit','admin_invitations','admin_invitation_audit','admin_session_audit') THEN 'administrators' ELSE 'full' END
$$;
DO $$ DECLARE t record;s text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity LOOP
  s:=app_private.table_section(t.tablename);
  EXECUTE format('CREATE POLICY section_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.admin_has_permission(%L)))',t.tablename,s);
  EXECUTE format('CREATE POLICY section_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.admin_has_permission(%L,''edit'')))',t.tablename,s);
  EXECUTE format('CREATE POLICY section_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.admin_has_permission(%L,''edit''))) WITH CHECK ((SELECT public.admin_has_permission(%L,''edit'')))',t.tablename,s,s);
  EXECUTE format('CREATE POLICY section_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.admin_has_permission(%L,''edit'')))',t.tablename,s);
 END LOOP;
END $$;
CREATE FUNCTION public.admin_get_access() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 RETURN (SELECT jsonb_build_object('user_id',a.user_id,'state',a.access_state,'permissions',a.access_permissions,'session_id',nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id') FROM public.admins a WHERE user_id=auth.uid());
END $$;
CREATE OR REPLACE FUNCTION public.admin_list_members() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('administrators');RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',a.name,'email',u.email,'created_at',a.created_at,'access_state',a.access_state,'access_permissions',a.access_permissions) ORDER BY a.created_at) FROM public.admins a JOIN auth.users u ON u.id=a.user_id),'[]');
END $$;
CREATE FUNCTION public.admin_save_access(p_user_id uuid,p_permissions jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old jsonb;
BEGIN
 PERFORM app_private.require_permission('full');IF NOT app_private.valid_permissions(p_permissions) THEN RAISE EXCEPTION 'Invalid access permissions';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);SELECT access_permissions INTO old FROM public.admins WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;IF old IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Access changed. Refresh before saving.' USING ERRCODE='40001';END IF;
 IF old->>'preset'='full' AND p_permissions->>'preset'<>'full' AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_user_id AND access_state='active') AND (SELECT count(*) FROM public.admins WHERE access_state='active' AND access_permissions->>'preset'='full')<=1 THEN RAISE EXCEPTION 'Keep at least one active Full administrator';END IF;
 UPDATE public.admins SET access_permissions=p_permissions WHERE user_id=p_user_id;
 INSERT INTO app_private.admin_access_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),p_user_id,'permissions_changed',jsonb_build_object('before',old,'after',p_permissions));
END $$;
CREATE FUNCTION public.admin_set_member_state(p_user_id uuid,p_state text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.admins%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');IF p_state NOT IN ('active','suspended') OR p_state IS NULL THEN RAISE EXCEPTION 'Invalid administrator state';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);SELECT * INTO a FROM public.admins WHERE user_id=p_user_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;
 IF a.access_permissions->>'preset'='full' AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can change a Full administrator' USING ERRCODE='42501';END IF;
 IF p_state='suspended' AND a.access_state='active' AND a.access_permissions->>'preset'='full' AND (SELECT count(*) FROM public.admins WHERE access_state='active' AND access_permissions->>'preset'='full')<=1 THEN RAISE EXCEPTION 'Keep at least one active Full administrator';END IF;
 IF p_state='active' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'A verified Auth account is required';END IF;
 UPDATE public.admins SET access_state=p_state WHERE user_id=p_user_id;
 IF p_state='suspended' THEN INSERT INTO app_private.admin_session_revocations(session_id,user_id,revoked_by) SELECT id,user_id,auth.uid() FROM auth.sessions WHERE user_id=p_user_id ON CONFLICT DO NOTHING;END IF;
 INSERT INTO app_private.admin_access_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),p_user_id,p_state,jsonb_build_object('before',a.access_state));
END $$;
CREATE OR REPLACE FUNCTION public.admin_remove_member(p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.admins%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');PERFORM pg_advisory_xact_lock(42319,11);SELECT * INTO a FROM public.admins WHERE user_id=p_user_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;
 IF a.access_state='active' THEN RAISE EXCEPTION 'Suspend this administrator before removal';END IF;
 IF a.access_permissions->>'preset'='full' AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can remove a Full administrator' USING ERRCODE='42501';END IF;
 DELETE FROM public.admins WHERE user_id=p_user_id;
 INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),p_user_id,'remove',jsonb_build_object('name',a.name));
END $$;
CREATE FUNCTION public.admin_lookup_verified_user(p_email text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('administrators','edit');RETURN (SELECT jsonb_build_object('email',u.email,'verified',true) FROM auth.users u WHERE lower(u.email)=lower(btrim(p_email)) AND u.email_confirmed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=u.id));
END $$;
CREATE OR REPLACE FUNCTION public.admin_add_existing_user(p_email text,p_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a display name';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);SELECT id INTO target FROM auth.users WHERE lower(email)=lower(btrim(p_email)) AND email_confirmed_at IS NOT NULL;
 IF target IS NULL THEN RAISE EXCEPTION 'No eligible verified Auth account found';END IF;
 INSERT INTO public.admins(user_id,name,access_permissions) VALUES(target,btrim(p_name),app_private.permission_preset('view'));
 INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),target,'add',jsonb_build_object('name',btrim(p_name),'source','verified_manual','access','view'));
 RETURN jsonb_build_object('user_id',target);
END $$;
CREATE FUNCTION public.admin_list_sessions() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'name',a.name,'created_at',s.created_at,'last_activity',coalesce(to_jsonb(s)->>'refreshed_at',to_jsonb(s)->>'updated_at',s.created_at::text),'user_agent',left(coalesce(to_jsonb(s)->>'user_agent',''),300),'current',s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) ORDER BY s.created_at DESC) FROM auth.sessions s JOIN public.admins a ON a.user_id=s.user_id WHERE a.access_state='active' AND (s.user_id=auth.uid() OR public.admin_has_permission('revokeSessions')) AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>statement_timestamp()) AND NOT EXISTS(SELECT 1 FROM app_private.admin_session_revocations r WHERE r.session_id=s.id)),'[]');
END $$;
CREATE FUNCTION public.admin_revoke_session(p_session_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 SELECT user_id INTO target FROM auth.sessions WHERE id=p_session_id AND user_id IN(SELECT user_id FROM public.admins);IF NOT FOUND THEN RAISE EXCEPTION 'Session not found';END IF;
 IF target<>auth.uid() THEN PERFORM app_private.require_permission('revokeSessions');END IF;
 INSERT INTO app_private.admin_session_revocations(session_id,user_id,revoked_by) VALUES(p_session_id,target,auth.uid()) ON CONFLICT DO NOTHING;
 INSERT INTO app_private.admin_access_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),target,'session_revoked',jsonb_build_object('session_id',p_session_id));
END $$;
CREATE FUNCTION public.admin_revoke_other_sessions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 FOR s IN SELECT id FROM auth.sessions WHERE user_id=auth.uid() AND id<>(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid LOOP PERFORM public.admin_revoke_session(s.id);END LOOP;
END $$;
-- Accepted invitations inherit explicitly assigned access, defaulting to View only.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.admin_accept_invitation(uuid)'::regprocedure);
 d:=replace(d,'INSERT INTO public.admins(user_id,name) VALUES(actor,i.name)','INSERT INTO public.admins(user_id,name,access_permissions) VALUES(actor,i.name,coalesce((SELECT permissions FROM app_private.pending_admin_permissions WHERE invitation_id=i.id),app_private.permission_preset(''view'')))');
 d:=replace(d,'EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by)','EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by AND access_state=''active'' AND access_permissions->''sections''->>''administrators''=''edit'')');EXECUTE d;
END $$;
CREATE FUNCTION app_private.reset_invitation_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR (NEW.status='pending' AND OLD.status<>'pending') THEN INSERT INTO app_private.pending_admin_permissions(invitation_id,permissions) VALUES(NEW.id,app_private.permission_preset('view')) ON CONFLICT(invitation_id) DO UPDATE SET permissions=excluded.permissions;END IF;RETURN NEW;
END $$;
CREATE TRIGGER invitation_access_default AFTER INSERT OR UPDATE OF status ON public.admin_invitations FOR EACH ROW EXECUTE FUNCTION app_private.reset_invitation_access();
CREATE FUNCTION public.admin_set_invitation_access(p_id uuid,p_permissions jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('full');IF NOT app_private.valid_permissions(p_permissions) THEN RAISE EXCEPTION 'Invalid access permissions';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);PERFORM 1 FROM public.admin_invitations WHERE id=p_id AND status='pending' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 INSERT INTO app_private.pending_admin_permissions VALUES(p_id,p_permissions) ON CONFLICT(invitation_id) DO UPDATE SET permissions=excluded.permissions;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) SELECT id,auth.uid(),'permissions_changed',email,jsonb_build_object('permissions',p_permissions) FROM public.admin_invitations WHERE id=p_id;
END $$;
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.admin_list_invitations()'::regprocedure);d:=replace(d,'''created_at'',created_at)', '''created_at'',created_at,''access_permissions'',coalesce((SELECT permissions FROM app_private.pending_admin_permissions WHERE invitation_id=public.admin_invitations.id),app_private.permission_preset(''view'')))');EXECUTE d;
END $$;
-- Restored membership references are never privileged by imported JSON. Existing
-- destination membership is preserved; other verified accounts appear Disabled.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('app_private.restore_backup(jsonb)'::regprocedure);
 d:=replace(d,'RETURN report||jsonb_build_object',E'FOR identity IN SELECT value FROM jsonb_array_elements(coalesce(payload->''administrator_reference'',''[]''::jsonb)) LOOP\n SELECT u.id INTO target_id FROM auth.users u JOIN jsonb_array_elements(payload->''identities'') i ON lower(i->>''email'')=lower(u.email) WHERE i->>''id''=identity->>''user_id'' AND u.email_confirmed_at IS NOT NULL;\n IF target_id IS NOT NULL THEN INSERT INTO public.admins(user_id,name,access_state,access_permissions) VALUES(target_id,left(coalesce(nullif(identity->>''name'',''''),''Restored administrator''),120),''restored'',app_private.permission_preset(''view'')) ON CONFLICT(user_id) DO NOTHING;END IF;\n END LOOP;\n RETURN report||jsonb_build_object');EXECUTE d;
END $$;
-- Restrict helper privileges. Only the small boolean permission function is exposed
-- for RLS; all mutation and inspection RPCs validate live sessions internally.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('admin_has_permission','admin_get_access','admin_save_access','admin_set_member_state','admin_lookup_verified_user','admin_list_sessions','admin_revoke_session','admin_revoke_other_sessions','admin_set_invitation_access') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);END LOOP;
END $$;
CREATE FUNCTION public.admin_load_data() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h boolean:=public.admin_has_permission('households');i boolean:=public.admin_has_permission('invites');f boolean:=public.admin_has_permission('food');v boolean:=public.admin_has_permission('venues');l boolean:=public.admin_has_permission('languages');o boolean:=public.admin_has_permission('other');s boolean:=public.admin_has_permission('settings');result jsonb;t text;k text;rows jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 result:=jsonb_build_object(
 'settings',coalesce((SELECT CASE WHEN s THEN to_jsonb(e) ELSE jsonb_build_object('id',e.id,'event_name',e.event_name,'event_date',e.event_date,'timezone',e.timezone,'default_language',e.default_language,'fallback_language',e.fallback_language,'is_published',e.is_published) END FROM public.event_settings e WHERE id=1),'null'),
 'languages',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_languages a),'[]'),
 'households',CASE WHEN h THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.households a),'[]') WHEN i THEN coalesce((SELECT jsonb_agg(to_jsonb(a)-'notes'-'postal_address'-'food'-'food_confirmed'-'stuff'-'things') FROM public.households a),'[]') WHEN f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'household_name',a.household_name,'food',a.food,'food_confirmed',a.food_confirmed,'parent_id',a.parent_id,'sort_order',a.sort_order,'archived_at',a.archived_at,'language',a.language,'side',a.side,'relation_group_id',a.relation_group_id)) FROM public.households a),'[]') ELSE '[]'::jsonb END,
 'guests',CASE WHEN h THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.guests a),'[]') WHEN i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'household_id',a.household_id,'first_name',a.first_name,'last_name',a.last_name,'language',a.language,'archived_at',a.archived_at)) FROM public.guests a),'[]') ELSE '[]'::jsonb END,
 'sessions',CASE WHEN v OR l THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_sessions a),'[]') WHEN h OR i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'location_id',a.location_id,'is_active',a.is_active,'requires_rsvp',a.requires_rsvp,'sort_order',a.sort_order)) FROM public.event_sessions a),'[]') ELSE '[]'::jsonb END,
 'locations',CASE WHEN v OR l THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_locations a),'[]') WHEN h OR i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'timezone',a.timezone,'archived_at',a.archived_at,'sort_order',a.sort_order)) FROM public.event_locations a),'[]') ELSE '[]'::jsonb END,
 'content',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_content a WHERE l OR a.content_key LIKE 'ui:%' OR (f AND (a.content_key LIKE 'food:%' OR a.content_key LIKE 'food-category:%')) OR (v AND (a.content_key LIKE 'venue:%' OR a.content_key LIKE 'session:%'))),'[]'));
 FOR t,k IN SELECT * FROM (VALUES ('food_items','food'),('food_claims','claims'),('food_categories','foodCategories'),('food_item_types','foodTypes'),('rsvp_submissions','submissions'),('household_session_defaults','defaults'),('guest_session_overrides','overrides'),('guest_session_responses','responses'),('relation_groups','relationGroups'),('household_contacts','contacts'),('invitation_send_queue','queue'),('invitation_deliveries','deliveries'),('other_items','tasks'),('other_categories','otherCategories')) x(t,k) LOOP
  rows:='[]';
  IF (t IN ('food_items','food_categories','food_item_types') AND (f OR l)) OR (t='food_claims' AND f) OR (t IN ('household_session_defaults','guest_session_overrides') AND (i OR f)) OR (t IN ('rsvp_submissions','guest_session_responses','invitation_send_queue','invitation_deliveries') AND i) OR (t='relation_groups' AND (h OR i OR f)) OR (t='household_contacts' AND (h OR i)) OR (t IN ('other_items','other_categories') AND o) THEN EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(a)),''[]''::jsonb) FROM public.%I a',t) INTO rows;END IF;
  IF t='food_items' AND l AND NOT f THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'category',a.category,'name_en',a.name_en,'description_en',a.description_en,'quantity_type',a.quantity_type,'sort_order',a.sort_order,'active',a.active)),'[]'::jsonb) INTO rows FROM public.food_items a;END IF;
  result:=result||jsonb_build_object(k,rows);
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_load_data() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_load_data() TO authenticated;

CREATE FUNCTION public.admin_update_member(p_user_id uuid,p_name text,p_permissions jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.admins%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');PERFORM pg_advisory_xact_lock(42319,11);
 SELECT * INTO a FROM public.admins WHERE user_id=p_user_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;
 IF a.access_permissions IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Access changed. Refresh before saving.' USING ERRCODE='40001';END IF;
 IF a.access_permissions->>'preset'='full' AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can change a Full administrator' USING ERRCODE='42501';END IF;
 IF p_permissions IS NOT NULL AND p_permissions IS DISTINCT FROM a.access_permissions THEN PERFORM public.admin_save_access(p_user_id,p_permissions,p_expected);END IF;
 IF p_name IS DISTINCT FROM a.name THEN PERFORM public.admin_rename_member(p_user_id,p_name);END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_update_member(uuid,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_update_member(uuid,text,jsonb,jsonb) TO authenticated;
DO $$ DECLARE d text; BEGIN
 d:=pg_get_viewdef('app_private.administration_log_entries'::regclass,true);
 EXECUTE 'CREATE OR REPLACE VIEW app_private.administration_log_entries AS '||rtrim(d,E';\n ')||' UNION ALL SELECT ''access:''||a.id::text,a.created_at,''administrators'',a.action,NULL::uuid,a.actor_id,coalesce((SELECT name FROM public.admins WHERE user_id=a.subject_id),''Former administrator''),a.details FROM app_private.admin_access_audit a';
END $$;

CREATE FUNCTION public.admin_authorize_device_send(p_queue_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('sendInvites');
 IF NOT EXISTS(SELECT 1 FROM public.invitation_send_queue q JOIN public.households h ON h.id=q.household_id WHERE q.id=p_queue_id AND q.status='ready' AND h.archived_at IS NULL AND q.invitation_code_snapshot=h.invite_code) THEN RAISE EXCEPTION 'Refresh and save this delivery again before sending';END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_authorize_device_send(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_authorize_device_send(uuid) TO authenticated;
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.admin_rename_member(uuid,text)'::regprocedure);
 d:=regexp_replace(d,'\mBEGIN\M','BEGIN IF EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_user_id AND access_permissions->>''preset''=''full'') AND NOT public.admin_has_permission(''full'') THEN RAISE EXCEPTION ''Only Full administrators can change a Full administrator'' USING ERRCODE=''42501'';END IF;','i');EXECUTE d;
END $$;

-- Synchronize the server-side catalog with the versioned UI keys.
CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $catalog$ SELECT $json${
  "Back to households": "interface.messages.back_to_households",
  "Administration": "interface.messages.administration",
  "Admin": "interface.messages.admin",
  "Event Invitation": "interface.messages.event_invitation",
  "Event dashboard": "interface.messages.event_dashboard",
  "Appearance": "interface.messages.appearance",
  "Appearance preference": "interface.messages.appearance_preference",
  "System default": "interface.messages.system_default",
  "Light": "interface.messages.light",
  "Dark": "interface.messages.dark",
  "Language": "interface.messages.language",
  "Faroese": "interface.messages.faroese",
  "English": "interface.messages.english",
  "German": "interface.messages.german",
  "Settings": "interface.messages.settings",
  "Settings sections": "interface.messages.settings_sections",
  "Main settings": "interface.messages.main_settings",
  "Event settings": "interface.messages.event_settings",
  "Administrators": "interface.messages.administrators",
  "Administrator": "interface.messages.administrator",
  "Administrator actions": "interface.messages.administrator_actions",
  "Admin sections": "interface.messages.admin_sections",
  "Overview": "interface.messages.overview",
  "Households": "interface.messages.households",
  "Guests": "interface.messages.guests",
  "Food": "food.messages.food",
  "Manage Invites": "interface.messages.manage_invites",
  "Venues": "interface.messages.venues",
  "Sessions": "interface.messages.sessions",
  "Sessions & scheduling": "interface.messages.sessions_scheduling",
  "Logs": "interface.messages.logs",
  "Back": "interface.messages.back",
  "Back to dashboard": "interface.messages.back_to_dashboard",
  "View website in a new tab": "interface.messages.view_website_in_a_new_tab",
  "Refresh data": "interface.messages.refresh_data",
  "Sign out": "interface.messages.sign_out",
  "Sign in": "interface.messages.sign_in",
  "Email": "interface.messages.email",
  "Password": "interface.messages.password",
  "PRIVATE ADMINISTRATION": "interface.messages.private_administration",
  "Welcome back.": "interface.messages.welcome_back",
  "Only approved event administrators can sign in.": "interface.messages.only_approved_event_administrators_can_sign_in",
  "Setup wizard": "interface.messages.setup_wizard",
  "New password": "interface.messages.new_password",
  "Confirm password": "interface.messages.confirm_password",
  "You’re invited.": "interface.messages.you_re_invited",
  "Accept administrator invitation": "interface.messages.accept_administrator_invitation",
  "Accepting invitation…": "interface.messages.accepting_invitation",
  "Accepting gives you access to this event’s households, guests, invitations and settings.": "interface.messages.accepting_gives_you_access_to_this_event_s_households_guests_invi",
  "Set a password of at least 12 characters for future sign-ins.": "interface.messages.set_a_password_of_at_least_12_characters_for_future_sign_ins",
  "Event name": "interface.messages.event_name",
  "Type": "interface.messages.type",
  "Date": "interface.messages.date",
  "Default language": "interface.messages.default_language",
  "Timezone": "interface.messages.timezone",
  "Website URL": "interface.messages.website_url",
  "RSVP deadline (local browser time)": "interface.messages.rsvp_deadline_local_browser_time",
  "Save settings": "interface.messages.save_settings",
  "Publish event": "interface.messages.publish_event",
  "Unpublish event": "interface.messages.unpublish_event",
  "Event is published: invited guests can access RSVP. You can unpublish it below.": "interface.messages.event_is_published_invited_guests_can_access_rsvp_you_can_unpubli",
  "Event is unpublished: guest-facing event details and food remain hidden until you publish.": "food.messages.event_is_unpublished_guest_facing_event_details_and_food_remain_h",
  "Use View mode to inspect configuration and Edit mode to make changes. Publication controls are below.": "interface.messages.use_view_mode_to_inspect_configuration_and_edit_mode_to_make_chan",
  "Publishing makes the guest RSVP experience available. The website can be online while the event is unpublished. Complete access-control and invite-code release tests before publishing.": "interface.messages.publishing_makes_the_guest_rsvp_experience_available_the_website_",
  "I understand the release checks are my responsibility and this will open the event to invited guests.": "interface.messages.i_understand_the_release_checks_are_my_responsibility_and_this_wi",
  "Manage event details and administrator access.": "interface.messages.manage_event_details_and_administrator_access",
  "Manage locations, addresses and local timezones. Guests can attend sessions at more than one venue.": "interface.messages.manage_locations_addresses_and_local_timezones_guests_can_attend_",
  "Set each session’s venue and local times. Use Manage Invites for household invitations and individual exceptions.": "interface.messages.set_each_session_s_venue_and_local_times_use_manage_invites_for_h",
  "Invite trusted people to help manage this event. Access starts after they verify their email and accept.": "interface.messages.invite_trusted_people_to_help_manage_this_event_access_starts_aft",
  "Invite administrator": "interface.messages.invite_administrator",
  "Open Supabase Auth": "interface.messages.open_supabase_auth",
  "Display name": "interface.messages.display_name",
  "Send invitation": "interface.messages.send_invitation",
  "Pending invitations": "interface.messages.pending_invitations",
  "An email will be sent to this address. The recipient must accept within 7 days; email sign-in links may expire sooner.": "interface.messages.an_email_will_be_sent_to_this_address_the_recipient_must_accept_w",
  "Resend": "interface.messages.resend",
  "Cancel": "interface.messages.cancel",
  "Awaiting acceptance": "interface.messages.awaiting_acceptance",
  "No pending invitations.": "interface.messages.no_pending_invitations",
  "Sending invitation…": "interface.messages.sending_invitation",
  "Administrator invitation email sent.": "interface.messages.administrator_invitation_email_sent",
  "Administrator invitation cancelled.": "interface.messages.administrator_invitation_cancelled",
  "Administrator invitation accepted.": "interface.messages.administrator_invitation_accepted",
  "Revoke administrator access": "interface.messages.revoke_administrator_access",
  "Administrator access revoked.": "interface.messages.administrator_access_revoked",
  "You cannot remove the last administrator.": "interface.messages.you_cannot_remove_the_last_administrator",
  "Search": "interface.messages.search",
  "Category": "interface.messages.category",
  "Action": "interface.messages.action",
  "From": "interface.messages.from",
  "Through": "interface.messages.through",
  "All categories": "interface.messages.all_categories",
  "All actions": "interface.messages.all_actions",
  "Search logs": "interface.messages.search_logs",
  "Reset": "interface.messages.reset",
  "Load older entries": "interface.messages.load_older_entries",
  "Search recorded changes, RSVP activity, invitation delivery and administrator sessions.": "interface.messages.search_recorded_changes_rsvp_activity_invitation_delivery_and_adm",
  "Household, guest, administrator or change": "interface.messages.household_guest_administrator_or_change",
  "Contacts": "interface.messages.contacts",
  "Invitations": "interface.messages.invitations",
  "Login": "interface.messages.login",
  "Food access": "food.messages.food_access",
  "Loading logs…": "interface.messages.loading_logs",
  "No log entries match these filters.": "interface.messages.no_log_entries_match_these_filters",
  "Field": "interface.messages.field",
  "Before": "interface.messages.before",
  "After": "interface.messages.after",
  "Reference: ": "interface.messages.reference",
  "Showing ": "interface.messages.showing",
  "Date filters use the event timezone. Entries show your local time; expand one for its UTC time and details. Archive/restore actions are recorded; permanent deletion is disabled.": "interface.messages.date_filters_use_the_event_timezone_entries_show_your_local_time_",
  "Existing history is included. New sign-in and invitation-opening records start with this update. Repeated opens within 15 minutes are grouped.": "interface.messages.existing_history_is_included_new_sign_in_and_invitation_opening_r",
  "Launch checklist": "interface.messages.launch_checklist",
  "Check all release requirements before using Settings → Event settings → Publish event.": "interface.messages.check_all_release_requirements_before_using_settings_event_settin",
  "Admin account connected": "interface.messages.admin_account_connected",
  "Event name and date entered": "interface.messages.event_name_and_date_entered",
  "At least one session created": "interface.messages.at_least_one_session_created",
  "Invitations assigned": "interface.messages.invitations_assigned",
  "Website connection in deployed config.js": "interface.messages.website_connection_in_deployed_config_js",
  "Website address saved in event settings": "interface.messages.website_address_saved_in_event_settings",
  "Event published": "interface.messages.event_published",
  "New RSVP submissions": "interface.messages.new_rsvp_submissions",
  "Food items": "food.messages.food_items",
  "Add household": "interface.messages.add_household",
  "Add guest": "interface.messages.add_guest",
  "Add contact": "interface.messages.add_contact",
  "Add venue": "interface.messages.add_venue",
  "Add session": "interface.messages.add_session",
  "Add category": "interface.messages.add_category",
  "Add food item": "food.messages.add_food_item",
  "Household or guest": "interface.messages.household_or_guest",
  "Show archived records": "interface.messages.show_archived_records",
  "⌄ Expand all": "interface.messages.expand_all",
  "› Collapse all": "interface.messages.collapse_all",
  "Click a household to expand its individual guests. Select the top-right pencil to enable editing; each guest then has a pencil for their details. Parent–child household nesting is preserved.": "interface.messages.click_a_household_to_expand_its_individual_guests_select_the_top_",
  "Empty households have no invitation code. Add a guest, then use Manage Invites. Assign sessions in Settings.": "interface.messages.empty_households_have_no_invitation_code_add_a_guest_then_use_man",
  "Household name": "interface.messages.household_name",
  "Household language": "interface.messages.household_language",
  "Household email": "interface.messages.household_email",
  "Household phone": "interface.messages.household_phone",
  "Household notes": "interface.messages.household_notes",
  "Household details": "interface.messages.household_details",
  "Household contact details": "interface.messages.household_contact_details",
  "Household default": "interface.messages.household_default",
  "Parent household": "interface.messages.parent_household",
  "Child households": "interface.messages.child_households",
  "Grouping household": "interface.messages.grouping_household",
  "None (top level)": "interface.messages.none_top_level",
  "Side": "interface.messages.side",
  "Relation group": "interface.messages.relation_group",
  "Relation": "interface.messages.relation",
  "Notes": "interface.messages.notes",
  "Phone": "interface.messages.phone",
  "Postal address": "interface.messages.postal_address",
  "Preferred contact": "interface.messages.preferred_contact",
  "Preferred contact method": "interface.messages.preferred_contact_method",
  "Preferred delivery method": "interface.messages.preferred_delivery_method",
  "First name": "interface.messages.first_name",
  "Last name": "interface.messages.last_name",
  "Title": "interface.messages.title",
  "None": "interface.messages.none",
  "Son": "interface.messages.son",
  "Daughter": "interface.messages.daughter",
  "Child": "interface.messages.child",
  "Child guest": "interface.messages.child_guest",
  "Dietary requirements": "interface.messages.dietary_requirements",
  "Individual guests": "interface.messages.individual_guests",
  "Unnamed guest": "interface.messages.unnamed_guest",
  "Unnamed household": "interface.messages.unnamed_household",
  "Ungrouped": "interface.messages.ungrouped",
  "No matching households.": "interface.messages.no_matching_households",
  "No guests assigned to this household.": "interface.messages.no_guests_assigned_to_this_household",
  "No active guests match this search.": "interface.messages.no_active_guests_match_this_search",
  "Search guests": "interface.messages.search_guests",
  "Guest name or household": "interface.messages.guest_name_or_household",
  "Guest": "interface.messages.guest",
  "Save household": "interface.messages.save_household",
  "Create household": "interface.messages.create_household",
  "Save guest": "interface.messages.save_guest",
  "Move guest": "interface.messages.move_guest",
  "Destination household": "interface.messages.destination_household",
  "Choose household": "interface.messages.choose_household",
  "Move household up": "interface.messages.move_household_up",
  "Move household down": "interface.messages.move_household_down",
  "New guests inherit this household’s session invitations.": "interface.messages.new_guests_inherit_this_household_s_session_invitations",
  "RSVP status and household assignment are not changed by editing guest details.": "interface.messages.rsvp_status_and_household_assignment_are_not_changed_by_editing_g",
  "Current session invitations are preserved as individual overrides. Moves involving RSVP history are blocked.": "interface.messages.current_session_invitations_are_preserved_as_individual_overrides",
  "Move this guest and preserve their current session invitations?": "interface.messages.move_this_guest_and_preserve_their_current_session_invitations",
  "Grouping changes with child households require moving the children first.": "interface.messages.grouping_changes_with_child_households_require_moving_the_childre",
  "First name is required.": "interface.messages.first_name_is_required",
  "Guest details saved.": "interface.messages.guest_details_saved",
  "Changes saved.": "interface.messages.changes_saved",
  "Household order saved.": "interface.messages.household_order_saved",
  "Edit": "interface.messages.edit",
  "Rename": "interface.messages.rename",
  "Archive ": "interface.messages.archive",
  "Restore ": "interface.messages.restore",
  "Edit guest: ": "interface.messages.edit_guest",
  "Edit household: ": "interface.messages.edit_household",
  "Select guest: ": "interface.messages.select_guest",
  "Edit contact: ": "interface.messages.edit_contact",
  "Archive this household and disable its invitation link? Records and history are preserved.": "interface.messages.archive_this_household_and_disable_its_invitation_link_records_an",
  "Archive this record? It can be restored later.": "interface.messages.archive_this_record_it_can_be_restored_later",
  "Restore this record?": "interface.messages.restore_this_record",
  "Record archived.": "interface.messages.record_archived",
  "Record restored.": "interface.messages.record_restored",
  "Contact": "interface.messages.contact",
  "Contact name": "interface.messages.contact_name",
  "Contact type": "interface.messages.contact_type",
  "Contact details": "interface.messages.contact_details",
  "Contact language": "interface.messages.contact_language",
  "Linked guest": "interface.messages.linked_guest",
  "Remove guest link": "interface.messages.remove_guest_link",
  "Primary": "interface.messages.primary",
  "Primary contact for this type": "interface.messages.primary_contact_for_this_type",
  "Save contact": "interface.messages.save_contact",
  "Create contact": "interface.messages.create_contact",
  "No contacts added yet.": "interface.messages.no_contacts_added_yet",
  "Choose someone from the guest list": "interface.messages.choose_someone_from_the_guest_list",
  "Choose a guest or enter a new contact below. Guest selection fills the name and language; enter this person’s contact details separately.": "interface.messages.choose_a_guest_or_enter_a_new_contact_below_guest_selection_fills",
  "Private codes and links for households with guests. Sending remains manual.": "interface.messages.private_codes_and_links_for_households_with_guests_sending_remain",
  "Search invitations": "interface.messages.search_invitations",
  "Invitation code": "interface.messages.invitation_code",
  "Copy invitation link": "interface.messages.copy_invitation_link",
  "Copy invite code": "interface.messages.copy_invite_code",
  "Copy link": "interface.messages.copy_link",
  "Copy message": "interface.messages.copy_message",
  "Invitation code copied.": "interface.messages.invitation_code_copied",
  "Invitation link copied.": "interface.messages.invitation_link_copied",
  "Message copied.": "interface.messages.message_copied",
  "No matching invitations. Empty and archived households have no active invitation.": "interface.messages.no_matching_invitations_empty_and_archived_households_have_no_act",
  "Delivery log": "interface.messages.delivery_log",
  "Invitation delivery": "interface.messages.invitation_delivery",
  "Filter delivery status": "interface.messages.filter_delivery_status",
  "All statuses": "interface.messages.all_statuses",
  "Draft": "interface.messages.draft",
  "Ready": "interface.messages.ready",
  "Ready to send": "interface.messages.ready_to_send",
  "Failed": "interface.messages.failed",
  "Cancelled": "interface.messages.cancelled",
  "Recorded sent": "interface.messages.recorded_sent",
  "No deliveries match this status.": "interface.messages.no_deliveries_match_this_status",
  "No delivery recorded yet.": "interface.messages.no_delivery_recorded_yet",
  "Prepare delivery": "interface.messages.prepare_delivery",
  "Delivery channel": "interface.messages.delivery_channel",
  "Delivery recipient": "interface.messages.delivery_recipient",
  "Delivery status": "interface.messages.delivery_status",
  "Message subject": "interface.messages.message_subject",
  "Message text": "interface.messages.message_text",
  "Delivery change note": "interface.messages.delivery_change_note",
  "Create delivery draft": "interface.messages.create_delivery_draft",
  "Save delivery changes": "interface.messages.save_delivery_changes",
  "Edit delivery": "interface.messages.edit_delivery",
  "Record as sent": "interface.messages.record_as_sent",
  "Sent note": "interface.messages.sent_note",
  "I sent this message to the displayed recipient": "interface.messages.i_sent_this_message_to_the_displayed_recipient",
  "Manual": "interface.messages.manual",
  "Manual / in person": "interface.messages.manual_in_person",
  "Postal": "interface.messages.postal",
  "Other": "interface.messages.other",
  "Recipient: ": "interface.messages.recipient",
  "To: ": "interface.messages.to",
  "Manually recorded as sent · ": "interface.messages.manually_recorded_as_sent",
  "Missing — add contact details before marking ready.": "interface.messages.missing_add_contact_details_before_marking_ready",
  "Saving a draft or marking it ready does not send a message. Review the recipient and text, send it yourself, then record it as sent.": "interface.messages.saving_a_draft_or_marking_it_ready_does_not_send_a_message_review",
  "RSVP management": "interface.messages.rsvp_management",
  "Current response": "interface.messages.current_response",
  "Choose response": "interface.messages.choose_response",
  "Corrected response": "interface.messages.corrected_response",
  "Correct response: ": "interface.messages.correct_response",
  "Attending": "interface.messages.attending",
  "Not attending": "interface.messages.not_attending",
  "Pending": "interface.messages.pending",
  "RSVP required": "interface.messages.rsvp_required",
  "Information only": "interface.messages.information_only",
  "Locked after submission": "interface.messages.locked_after_submission",
  "Open for responses": "interface.messages.open_for_responses",
  "Reason for RSVP correction": "interface.messages.reason_for_rsvp_correction",
  "Save correction": "interface.messages.save_correction",
  "This updates the current response and records the reason. The original submission and household lock are preserved.": "interface.messages.this_updates_the_current_response_and_records_the_reason_the_orig",
  "Reopen RSVP": "interface.messages.reopen_rsvp",
  "Reason for reopening": "interface.messages.reason_for_reopening",
  "Reopen this household’s RSVP while preserving its submission history?": "interface.messages.reopen_this_household_s_rsvp_while_preserving_its_submission_hist",
  "Reopening lets the household submit again. Previous submissions remain in history. If the event deadline has passed, grant a late-response window after reopening.": "interface.messages.reopening_lets_the_household_submit_again_previous_submissions_re",
  "Allow a late response": "interface.messages.allow_a_late_response",
  "Allow late response": "interface.messages.allow_late_response",
  "Allow responses until (": "interface.messages.allow_responses_until",
  "Reason for late response": "interface.messages.reason_for_late_response",
  "No active RSVP sessions are assigned to this household.": "interface.messages.no_active_rsvp_sessions_are_assigned_to_this_household",
  "Invitations are protected because this household has RSVP history.": "interface.messages.invitations_are_protected_because_this_household_has_rsvp_history",
  "Allow this household to contribute food": "food.messages.allow_this_household_to_contribute_food",
  "Reason for food-access change": "food.messages.reason_for_food_access_change",
  "Save food access": "food.messages.save_food_access",
  "Disabling access is blocked while food commitments or a confirmed selection exist. Existing selections are never removed by this control.": "food.messages.disabling_access_is_blocked_while_food_commitments_or_a_confirmed",
  "Food categories & items": "food.messages.food_categories_items",
  "Food or category": "food.messages.food_or_category",
  "Grouped by category. Switch to Edit to sort, rename, or update items. Existing claims are preserved.": "interface.messages.grouped_by_category_switch_to_edit_to_sort_rename_or_update_items",
  "＋ Add food category": "food.messages.add_food_category",
  "＋ Add food item": "food.messages.add_food_item_2",
  "Category name": "interface.messages.category_name",
  "New category name": "interface.messages.new_category_name",
  "Register category": "interface.messages.register_category",
  "Register existing category": "interface.messages.register_existing_category",
  "Rename food category": "food.messages.rename_food_category",
  "Move category up": "interface.messages.move_category_up",
  "Move category down": "interface.messages.move_category_down",
  "Move food item up": "food.messages.move_food_item_up",
  "Move food item down": "food.messages.move_food_item_down",
  "Category for ": "interface.messages.category_for",
  "Edit food item": "food.messages.edit_food_item",
  "Save food item": "food.messages.save_food_item",
  "Faroese name": "interface.messages.faroese_name",
  "English name": "interface.messages.english_name",
  "German name": "interface.messages.german_name",
  "Faroese description": "interface.messages.faroese_description",
  "English description": "interface.messages.english_description",
  "German description": "interface.messages.german_description",
  "Quantity needed": "interface.messages.quantity_needed",
  "Display order": "interface.messages.display_order",
  "Available for guests": "interface.messages.available_for_guests",
  "Archive food item (preserve existing claims)": "food.messages.archive_food_item_preserve_existing_claims",
  "No matching food items.": "food.messages.no_matching_food_items",
  "Uncategorized": "interface.messages.uncategorized",
  "Unnamed item": "interface.messages.unnamed_item",
  "Not registered": "interface.messages.not_registered",
  "Faroese name is required.": "interface.messages.faroese_name_is_required",
  "Enter a non-negative quantity.": "interface.messages.enter_a_non_negative_quantity",
  "Food category added.": "food.messages.food_category_added",
  "Food category updated.": "food.messages.food_category_updated",
  "Food item added.": "food.messages.food_item_added",
  "Food item updated.": "food.messages.food_item_updated",
  "Food item archived.": "food.messages.food_item_archived",
  "Food order saved.": "food.messages.food_order_saved",
  "Category order saved.": "interface.messages.category_order_saved",
  "Category registered.": "interface.messages.category_registered",
  "Category renamed and linked food items updated.": "food.messages.category_renamed_and_linked_food_items_updated",
  "Session": "interface.messages.session",
  "Session name": "interface.messages.session_name",
  "Session key": "interface.messages.session_key",
  "Session venue": "interface.messages.session_venue",
  "Active session": "interface.messages.active_session",
  "Starts (venue local time)": "interface.messages.starts_venue_local_time",
  "Ends (venue local time)": "interface.messages.ends_venue_local_time",
  "Save session": "interface.messages.save_session",
  "Create session": "interface.messages.create_session",
  "Venue name": "interface.messages.venue_name",
  "Venue address": "interface.messages.venue_address",
  "Venue timezone": "interface.messages.venue_timezone",
  "Country code": "interface.messages.country_code",
  "Map link (HTTPS)": "interface.messages.map_link_https",
  "Guest venue notes": "interface.messages.guest_venue_notes",
  "Welcome message — ": "interface.messages.welcome_message",
  "Welcome messages for this venue": "interface.messages.welcome_messages_for_this_venue",
  "Archived venue": "interface.messages.archived_venue",
  "Save venue": "interface.messages.save_venue",
  "Create venue": "interface.messages.create_venue",
  "No venue": "interface.messages.no_venue",
  "Unscheduled": "interface.messages.unscheduled",
  "Times are entered in ": "interface.messages.times_are_entered_in",
  "Session invitations": "interface.messages.session_invitations",
  "Save session invitations": "interface.messages.save_session_invitations",
  "Create sessions in Settings first.": "interface.messages.create_sessions_in_settings_first",
  "Household defaults apply to each guest unless an individual exception is selected. Language does not determine invitations.": "interface.messages.household_defaults_apply_to_each_guest_unless_an_individual_excep",
  "Follow household": "interface.messages.follow_household",
  "Invited": "interface.messages.invited",
  "Not invited": "interface.messages.not_invited",
  "Household invited": "interface.messages.household_invited",
  "Household not invited": "interface.messages.household_not_invited",
  "Switch to Edit mode": "interface.messages.switch_to_edit_mode",
  "Switch to View mode": "interface.messages.switch_to_view_mode",
  "View mode · Manage invitations, food and event details": "food.messages.view_mode_manage_invitations_food_and_event_details",
  "Edit mode · Changes are saved to the event database": "interface.messages.edit_mode_changes_are_saved_to_the_event_database",
  "Loading event data…": "interface.messages.loading_event_data",
  "Event data refreshed.": "interface.messages.event_data_refreshed",
  "Event settings saved.": "interface.messages.event_settings_saved",
  "Switch to Edit mode first.": "interface.messages.switch_to_edit_mode_first",
  "Invalid RSVP deadline.": "interface.messages.invalid_rsvp_deadline",
  "Confirm the release acknowledgement before publishing.": "interface.messages.confirm_the_release_acknowledgement_before_publishing",
  "Complete the event name, date, website URL, active session and invitations before publishing.": "interface.messages.complete_the_event_name_date_website_url_active_session_and_invit",
  "Publish this event now? Invite-code holders may access guest RSVP and food details. Proceed only after security and guest-flow testing.": "food.messages.publish_this_event_now_invite_code_holders_may_access_guest_rsvp_",
  "Unpublish this event? Guest access to published event details will stop.": "interface.messages.unpublish_this_event_guest_access_to_published_event_details_will",
  "Event published.": "interface.messages.event_published_2",
  "Event unpublished.": "interface.messages.event_unpublished",
  "Enter matching passwords of at least 12 characters.": "interface.messages.enter_matching_passwords_of_at_least_12_characters",
  "Sign in again before sending an invitation.": "interface.messages.sign_in_again_before_sending_an_invitation",
  "Invitation could not be sent.": "interface.messages.invitation_could_not_be_sent",
  "Email delivery status is uncertain. Check before resending.": "interface.messages.email_delivery_status_is_uncertain_check_before_resending",
  "Email status is uncertain. Refresh pending invitations before retrying.": "interface.messages.email_status_is_uncertain_refresh_pending_invitations_before_retr",
  "Email sending is restricted. Check the email configuration.": "interface.messages.email_sending_is_restricted_check_the_email_configuration",
  "The email could not be sent. Check the email configuration before resending.": "interface.messages.the_email_could_not_be_sent_check_the_email_configuration_before_",
  "The email service request limit was reached. Wait before resending.": "interface.messages.the_email_service_request_limit_was_reached_wait_before_resending",
  "The email service sending limit was reached. Wait before resending.": "interface.messages.the_email_service_sending_limit_was_reached_wait_before_resending",
  "Administrator invitations are unavailable. The invitation service must be installed before sending.": "interface.messages.administrator_invitations_are_unavailable_the_invitation_service_",
  "Administrator list unavailable. Apply migration 006 if needed.": "interface.messages.administrator_list_unavailable_apply_migration_006_if_needed",
  "Admin management API unavailable: ": "interface.messages.admin_management_api_unavailable",
  "No active administrator invitation was found for this account. Ask an administrator to send or resend it.": "interface.messages.no_active_administrator_invitation_was_found_for_this_account_ask",
  "Your account does not have administrator access, or invitation acceptance is unavailable. Ask an administrator to check your invitation.": "interface.messages.your_account_does_not_have_administrator_access_or_invitation_acc",
  "Session logging is unavailable.": "interface.messages.session_logging_is_unavailable",
  "Signed in, but session logging is unavailable.": "interface.messages.signed_in_but_session_logging_is_unavailable",
  "Send another administrator invitation email to ": "interface.messages.send_another_administrator_invitation_email_to",
  "Cancel administrator invitation for ": "interface.messages.cancel_administrator_invitation_for",
  "Revoke administrator access for ": "interface.messages.revoke_administrator_access_for",
  "Added": "interface.messages.added",
  "Updated": "interface.messages.updated",
  "Deleted": "interface.messages.deleted",
  "Archived": "interface.messages.archived",
  "Restored": "interface.messages.restored",
  "Moved": "interface.messages.moved",
  "Renamed": "interface.messages.renamed",
  "Assigned": "interface.messages.assigned",
  "Enabled": "interface.messages.enabled",
  "Disabled": "interface.messages.disabled",
  "Unspecified": "interface.messages.unspecified",
  "Expired": "interface.messages.expired",
  "Draft saved": "interface.messages.draft_saved",
  "Delivery created": "interface.messages.delivery_created",
  "Failed delivery": "interface.messages.failed_delivery",
  "Failed attempt": "interface.messages.failed_attempt",
  "Household submitted": "interface.messages.household_submitted",
  "Guest response submitted": "interface.messages.guest_response_submitted",
  "Guest response corrected": "interface.messages.guest_response_corrected",
  "RSVP reopened": "interface.messages.rsvp_reopened",
  "Late response allowed": "interface.messages.late_response_allowed",
  "Invitation opened": "interface.messages.invitation_opened",
  "Invitation assignments changed": "interface.messages.invitation_assignments_changed",
  "Sign-in session": "interface.messages.sign_in_session",
  "Signed out": "interface.messages.signed_out",
  "Sign-out requested": "interface.messages.sign_out_requested",
  "Token refreshed": "interface.messages.token_refreshed",
  "Administrator invitation accepted": "interface.messages.administrator_invitation_accepted_2",
  "Administrator invitation cancelled": "interface.messages.administrator_invitation_cancelled_2",
  "Administrator email requested": "interface.messages.administrator_email_requested",
  "Administrator email accepted by service": "interface.messages.administrator_email_accepted_by_service",
  "Administrator email failed": "interface.messages.administrator_email_failed",
  "Email failed": "interface.messages.email_failed",
  "Sending / status pending": "interface.messages.sending_status_pending",
  "Access removed": "interface.messages.access_removed",
  "FIRST-TIME SETUP": "interface.messages.first_time_setup",
  "Make this event yours.": "interface.messages.make_this_event_yours",
  "Connect your own Supabase project in four steps. No terminal or Python required.": "interface.messages.connect_your_own_supabase_project_in_four_steps_no_terminal_or_py",
  "Administration · Own your data": "interface.messages.administration_own_your_data",
  "Database choice": "interface.messages.database_choice",
  "Connection": "interface.messages.connection",
  "Verify admin": "interface.messages.verify_admin",
  "Publish config": "interface.messages.publish_config",
  "STEP 1 OF 4": "interface.messages.step_1_of_4",
  "STEP 2 OF 4": "interface.messages.step_2_of_4",
  "STEP 3 OF 4": "interface.messages.step_3_of_4",
  "STEP 4 OF 4": "interface.messages.step_4_of_4",
  "How would you like to begin?": "interface.messages.how_would_you_like_to_begin",
  "Use existing database": "interface.messages.use_existing_database",
  "Connect to an already-migrated Supabase project. Preserve its invitations, guests and admin accounts.": "interface.messages.connect_to_an_already_migrated_supabase_project_preserve_its_invi",
  "Set up a new database": "interface.messages.set_up_a_new_database",
  "Create an empty Supabase project, run the included SQL, then create the first administrator.": "interface.messages.create_an_empty_supabase_project_run_the_included_sql_then_create",
  "Continue": "interface.messages.continue",
  "Connect Supabase": "interface.messages.connect_supabase",
  "Project URL": "interface.messages.project_url",
  "Publishable or legacy anon key": "interface.messages.publishable_or_legacy_anon_key",
  "Test connection": "interface.messages.test_connection",
  "Never paste a Supabase secret key, service_role key, database password or access token here. Only public client keys belong in a static website.": "interface.messages.never_paste_a_supabase_secret_key_service_role_key_database_passw",
  "New database instructions": "interface.messages.new_database_instructions",
  "Create a project at": "interface.messages.create_a_project_at",
  "Open SQL Editor and run the included migrations 001–006 in order, or use the bundled install file. These are starter migrations and require functional/security testing before public launch.": "interface.messages.open_sql_editor_and_run_the_included_migrations_001_006_in_order_",
  "Create an Auth user under Authentication → Users.": "interface.messages.create_an_auth_user_under_authentication_users",
  "Download complete SQL installer": "interface.messages.download_complete_sql_installer",
  "First admin email (for new installations)": "interface.messages.first_admin_email_for_new_installations",
  "Generate first-admin SQL": "interface.messages.generate_first_admin_sql",
  "Copy SQL": "interface.messages.copy_sql",
  "The SQL appears here. Run it in your private Supabase SQL Editor, never on the website.": "interface.messages.the_sql_appears_here_run_it_in_your_private_supabase_sql_editor_n",
  "Secure administrator access": "interface.messages.secure_administrator_access",
  "For new projects, invite your first user via": "interface.messages.for_new_projects_invite_your_first_user_via",
  ", then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.": "interface.messages.then_run_the_sql_below_in_supabase_sql_editor_to_grant_admin_acce",
  "Check administrator login": "interface.messages.check_administrator_login",
  "Put your configuration online": "interface.messages.put_your_configuration_online",
  "Administrator verified. Your website configuration is ready.": "interface.messages.administrator_verified_your_website_configuration_is_ready",
  "Download config.js": "interface.messages.download_config_js",
  "Copy config contents": "interface.messages.copy_config_contents",
  "Go to admin": "interface.messages.go_to_admin",
  "The file contains only your Supabase URL and publishable / anon key. It must not contain a secret or service_role key.": "interface.messages.the_file_contains_only_your_supabase_url_and_publishable_anon_key",
  "After committing": "interface.messages.after_committing",
  ", enable GitHub Pages for the new repository. Then open the website, verify admin sign-in and invitation behavior. Keep the event unpublished until final security checks pass.": "interface.messages.enable_github_pages_for_the_new_repository_then_open_the_website_",
  "Enter": "interface.messages.enter",
  ", and add it to": "interface.messages.and_add_it_to",
  "in your NEW GitHub repository. This step is essential: browser-only setup does not configure the public website for other visitors.": "interface.messages.in_your_new_github_repository_this_step_is_essential_browser_only",
  "For a new project, create your first Auth user in Supabase and use the setup wizard to establish admin access.": "interface.messages.for_a_new_project_create_your_first_auth_user_in_supabase_and_use",
  "Test your Supabase connection before continuing.": "interface.messages.test_your_supabase_connection_before_continuing",
  "Administrator verification required.": "interface.messages.administrator_verification_required",
  "Sign in as an administrator first.": "interface.messages.sign_in_as_an_administrator_first",
  "Database connection or schema validation failed: ": "interface.messages.database_connection_or_schema_validation_failed",
  "Guest Edge Function is unavailable. Deploy the guest-gateway function first: ": "interface.messages.guest_edge_function_is_unavailable_deploy_the_guest_gateway_funct",
  "Enter a valid administrator email.": "interface.messages.enter_a_valid_administrator_email",
  "First-admin SQL generated. This must be executed in the private Supabase SQL Editor, not in the browser.": "interface.messages.first_admin_sql_generated_this_must_be_executed_in_the_private_su",
  "This account does not have administrator access. Run the first-admin SQL or ask an existing admin to grant access.": "interface.messages.this_account_does_not_have_administrator_access_run_the_first_adm",
  "Generate SQL first.": "interface.messages.generate_sql_first",
  "SQL copied.": "interface.messages.sql_copied",
  "Unable to copy SQL. Select it manually.": "interface.messages.unable_to_copy_sql_select_it_manually",
  "Configuration copied.": "interface.messages.configuration_copied",
  "Clipboard access denied. Download the file instead.": "interface.messages.clipboard_access_denied_download_the_file_instead",
  "Connected to {host}. The protected guest gateway responded.": "interface.messages.connected_to_host_the_protected_guest_gateway_responded",
  "Database not configured": "interface.messages.database_not_configured",
  "Database not connected. Complete the setup wizard first.": "interface.messages.database_not_connected_complete_the_setup_wizard_first",
  "Invalid administrator action": "interface.messages.invalid_administrator_action",
  "Administrator request failed.": "interface.messages.administrator_request_failed",
  "Your sign-in has expired. Sign in again before saving. Your edits have not been submitted.": "interface.messages.your_sign_in_has_expired_sign_in_again_before_saving_your_edits_h",
  "The server returned an unreadable response.": "interface.messages.the_server_returned_an_unreadable_response",
  "Supabase JavaScript library did not load. Check the network connection.": "interface.messages.supabase_javascript_library_did_not_load_check_the_network_connec",
  "Supabase URL must use HTTPS (except localhost).": "interface.messages.supabase_url_must_use_https_except_localhost",
  "Use only the Supabase project URL, with no credentials or query string.": "interface.messages.use_only_the_supabase_project_url_with_no_credentials_or_query_st",
  "Use only a publishable or anon key, never a secret key.": "interface.messages.use_only_a_publishable_or_anon_key_never_a_secret_key",
  "This JWT is not an anon key.": "interface.messages.this_jwt_is_not_an_anon_key",
  "The supplied JWT key is malformed.": "interface.messages.the_supplied_jwt_key_is_malformed",
  "Expected a publishable key or legacy anon JWT.": "interface.messages.expected_a_publishable_key_or_legacy_anon_jwt",
  "Something went wrong.": "interface.messages.something_went_wrong",
  "Enter a complete date and time.": "interface.messages.enter_a_complete_date_and_time",
  "Invalid date and time.": "interface.messages.invalid_date_and_time",
  "This local time is ambiguous or does not exist because clocks change. Choose a time outside the clock change.": "interface.messages.this_local_time_is_ambiguous_or_does_not_exist_because_clocks_cha",
  "A simple way to celebrate together.": "interface.messages.a_simple_way_to_celebrate_together",
  "Your event,": "interface.messages.your_event",
  "beautifully arranged.": "interface.messages.beautifully_arranged",
  "Private invitations · Please do not share your invitation link.": "interface.messages.private_invitations_please_do_not_share_your_invitation_link",
  "SETUP REQUIRED": "interface.messages.setup_required",
  "Connect your event": "interface.messages.connect_your_event",
  "This website has not been connected to Supabase yet.": "interface.messages.this_website_has_not_been_connected_to_supabase_yet",
  "Open first-time setup": "interface.messages.open_first_time_setup",
  "YOUR INVITATION": "interface.messages.your_invitation",
  "Open your invitation": "interface.messages.open_your_invitation",
  "Enter the eight-character invitation code or open the private link you received.": "interface.messages.enter_the_eight_character_invitation_code_or_open_the_private_lin",
  "Open": "interface.messages.open",
  "PERSONAL INVITATION": "interface.messages.personal_invitation",
  "Welcome": "interface.messages.welcome",
  "Please let us know who will attend.": "interface.messages.please_let_us_know_who_will_attend",
  "Submit RSVP": "interface.messages.submit_rsvp",
  "FOOD COORDINATION": "food.messages.food_coordination",
  "What can you bring?": "interface.messages.what_can_you_bring",
  "Choose items only if you want to contribute. Quantities cannot exceed what is needed.": "interface.messages.choose_items_only_if_you_want_to_contribute_quantities_cannot_exc",
  "Confirm my selections": "interface.messages.confirm_my_selections",
  "Invalid quantity": "interface.messages.invalid_quantity",
  "Invalid invitation code": "interface.messages.invalid_invitation_code",
  "Confirm food selections? This will lock further edits.": "food.messages.confirm_food_selections_this_will_lock_further_edits",
  "Food item": "food.messages.food_item",
  "Your event": "interface.messages.your_event_2",
  "Invitation": "interface.messages.invitation",
  "Quantity for {item}": "interface.messages.quantity_for_item",
  "Interface language": "interface.messages.interface_language",
  "Interface wording": "interface.messages.interface_wording",
  "Welcome messages": "interface.messages.welcome_messages",
  "Save welcome messages": "interface.messages.save_welcome_messages",
  "Welcome messages saved.": "interface.messages.welcome_messages_saved",
  "Leave a welcome message blank to use the built-in translation.": "interface.messages.leave_a_welcome_message_blank_to_use_the_built_in_translation",
  "Customize interface wording": "interface.messages.customize_interface_wording",
  "Choose a phrase and language, edit the wording, then download the file and replace js/interface-overrides.js in the repository. This does not publish the event.": "interface.messages.choose_a_phrase_and_language_edit_the_wording_then_download_the_f",
  "Phrase": "interface.messages.phrase",
  "Custom wording": "interface.messages.custom_wording",
  "Use {placeholders} exactly as shown. Blank text restores the built-in wording.": "interface.messages.use_placeholders_exactly_as_shown_blank_text_restores_the_built_i",
  "Apply wording": "interface.messages.apply_wording",
  "Download wording file": "interface.messages.download_wording_file",
  "Wording applied to this preview. Download and commit the file to share it.": "interface.messages.wording_applied_to_this_preview_download_and_commit_the_file_to_s",
  "Keep the same placeholders as the original phrase.": "interface.messages.keep_the_same_placeholders_as_the_original_phrase",
  "EVENT INVITATION": "interface.messages.event_invitation_2",
  "We look forward to celebrating with you.": "interface.messages.we_look_forward_to_celebrating_with_you",
  "Enter the eight-character code from your invitation.": "interface.messages.enter_the_eight_character_code_from_your_invitation",
  "Dear guests": "interface.messages.dear_guests",
  "Your response has been received and locked.": "interface.messages.your_response_has_been_received_and_locked",
  "Thank you! Your response is recorded.": "interface.messages.thank_you_your_response_is_recorded",
  "No invitation was found for that code.": "interface.messages.no_invitation_was_found_for_that_code",
  "Choose a response for every invited guest and session.": "interface.messages.choose_a_response_for_every_invited_guest_and_session",
  "Could not reach the database.": "interface.messages.could_not_reach_the_database",
  "This event has not been published yet.": "interface.messages.this_event_has_not_been_published_yet",
  "Choose only what you would like to contribute. Quantities are limited.": "interface.messages.choose_only_what_you_would_like_to_contribute_quantities_are_limi",
  "Thank you! Your food selection is confirmed.": "food.messages.thank_you_your_food_selection_is_confirmed",
  "Save": "interface.messages.save",
  "Food selection saved.": "food.messages.food_selection_saved",
  "Available": "interface.messages.available",
  "All invited guests are listed.": "interface.messages.all_invited_guests_are_listed",
  "Changing language reloads this page. Unsaved changes will be lost. Continue?": "interface.messages.changing_language_reloads_this_page_unsaved_changes_will_be_lost_",
  "Showing {count} of {total} matching guests.": "interface.messages.showing_count_of_total_matching_guests",
  "{count} entries shown · Newest first": "interface.messages.count_entries_shown_newest_first",
  "{state} · {count} food commitments{confirmed}": "food.messages.state_count_food_commitments_confirmed",
  " · Confirmed": "interface.messages.confirmed",
  " · Last submission {time}": "interface.messages.last_submission_time",
  "Event deadline: {deadline} · Late-response permission: {late} · {zone}": "interface.messages.event_deadline_deadline_late_response_permission_late_zone",
  "{ready} ready · {sent} recorded sent · {failed} failed": "interface.messages.ready_ready_sent_recorded_sent_failed_failed",
  "{count} guests": "interface.messages.count_guests",
  "{count} sub-households · {guests} guests in sub-households": "interface.messages.count_sub_households_guests_guests_in_sub_households",
  "Quantity cannot fall below {count} claimed; claimed items cannot be hidden.": "interface.messages.quantity_cannot_fall_below_count_claimed_claimed_items_cannot_be_",
  "Needed {needed} · Claimed {claimed} · Available {available}{inactive}": "interface.messages.needed_needed_claimed_claimed_available_available_inactive",
  " · Inactive": "interface.messages.inactive",
  "Archive {item}? Existing claims are preserved; you can reactivate it using Edit.": "interface.messages.archive_item_existing_claims_are_preserved_you_can_reactivate_it_",
  "Revoke administrator access for {email}?": "interface.messages.revoke_administrator_access_for_email",
  "Times are entered in {zone}. Changing venue keeps the typed local time; review before saving.": "interface.messages.times_are_entered_in_zone_changing_venue_keeps_the_typed_local_ti",
  "For new projects, invite your first user via Supabase → Authentication → Users, then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.": "interface.messages.for_new_projects_invite_your_first_user_via_supabase_authenticati",
  "{attending} attending · {declined} declined": "interface.messages.attending_attending_declined_declined",
  "{sent} recorded sent · {pending} pending": "interface.messages.sent_recorded_sent_pending_pending",
  "{count} households": "interface.messages.count_households",
  "{count} items": "interface.messages.count_items",
  " · Child": "interface.messages.child_2",
  " · Archived": "interface.messages.archived_2",
  " (unregistered)": "interface.messages.unregistered",
  " (inactive)": "interface.messages.inactive_2",
  " — household": "interface.messages.household",
  " · Expires {time}": "interface.messages.expires_time",
  "Household": "interface.messages.household_2",
  "Wording preview": "interface.messages.wording_preview",
  "Download": "interface.messages.download",
  "{count} guest": "interface.messages.count_guest",
  "{count} sub-household": "interface.messages.count_sub_household",
  "{count} sub-households": "interface.messages.count_sub_households",
  "{count} guest in sub-households": "interface.messages.count_guest_in_sub_households",
  "{count} guests in sub-households": "interface.messages.count_guests_in_sub_households",
  "Archive household": "interface.messages.archive_household",
  "Restore household": "interface.messages.restore_household",
  "Archive guest": "interface.messages.archive_guest",
  "Restore guest": "interface.messages.restore_guest",
  "Archive contact": "interface.messages.archive_contact",
  "Restore contact": "interface.messages.restore_contact",
  "Languages": "interface.messages.languages",
  "Backups": "interface.messages.backups",
  "Fallback language": "interface.messages.fallback_language",
  "Choose enabled languages and the fallback used for missing translations. English is the final built-in fallback.": "interface.messages.choose_enabled_languages_and_the_fallback_used_for_missing_transl",
  "Save language preferences": "interface.messages.save_language_preferences",
  "Add language": "interface.messages.add_language",
  "Language code": "interface.messages.language_code",
  "Save language": "interface.messages.save_language",
  "Language saved.": "interface.messages.language_saved",
  "Language preferences saved.": "interface.messages.language_preferences_saved",
  "Translations": "interface.messages.translations",
  "Add translations for interface phrases, event introductions, venue welcome messages, sessions and food. Missing text uses the fallback language.": "food.messages.add_translations_for_interface_phrases_event_introductions_venue_",
  "Text to translate": "interface.messages.text_to_translate",
  "Translation": "interface.messages.translation",
  "Save translation": "interface.messages.save_translation",
  "Translation saved.": "interface.messages.translation_saved",
  "Fallback preview": "interface.messages.fallback_preview",
  "Venue": "interface.messages.venue",
  "Description": "interface.messages.description",
  "Blank text uses the configured fallback language, then English.": "interface.messages.blank_text_uses_the_configured_fallback_language_then_english",
  "Choose a phrase and language, then save the translation. Downloading a wording file is optional. This does not publish the event.": "interface.messages.choose_a_phrase_and_language_then_save_the_translation_downloadin",
  "Download an application backup containing guest information, private invitation codes, settings, translations, contributions and historical records. Store it privately.": "interface.messages.download_an_application_backup_containing_guest_information_priva",
  "Auth passwords, sessions, administrator access, deployment secrets, rate-limit counters and sign-in logs are not restored. Keep a separate copy of the repository and deployment configuration.": "interface.messages.auth_passwords_sessions_administrator_access_deployment_secrets_r",
  "Download application backup": "interface.messages.download_application_backup",
  "Validate and restore": "interface.messages.validate_and_restore",
  "Choose a backup to inspect it. Full validation rehearses the restore and rolls it back. Import requires an empty, unpublished destination with matching migrations and verified historical actor accounts. Existing application records cannot be overwritten.": "interface.messages.choose_a_backup_to_inspect_it_full_validation_rehearses_the_resto",
  "Backup file": "interface.messages.backup_file",
  "Validate backup": "interface.messages.validate_backup",
  "Restore confirmation": "interface.messages.restore_confirmation",
  "I understand this restores application data into an empty destination and keeps the event unpublished.": "interface.messages.i_understand_this_restores_application_data_into_an_empty_destina",
  "Restore application backup": "interface.messages.restore_application_backup",
  "Preparing backup…": "interface.messages.preparing_backup",
  "Backup export is unavailable. Install the matching migration first.": "interface.messages.backup_export_is_unavailable_install_the_matching_migration_first",
  "Backup downloaded. Store it privately and rehearse restoration.": "interface.messages.backup_downloaded_store_it_privately_and_rehearse_restoration",
  "Backup exceeds 20 MB.": "interface.messages.backup_exceeds_20_mb",
  "Unsupported backup format or version.": "interface.messages.unsupported_backup_format_or_version",
  "Validating backup…": "interface.messages.validating_backup",
  "Backup validation is unavailable.": "interface.messages.backup_validation_is_unavailable",
  "Restore rehearsal passed. No data was changed.": "interface.messages.restore_rehearsal_passed_no_data_was_changed",
  "This destination cannot be restored: ": "interface.messages.this_destination_cannot_be_restored",
  "Application restored. The event is unpublished. Review administrator access separately.": "interface.messages.application_restored_the_event_is_unpublished_review_administrato",
  "RESTORE followed by the source event name": "interface.messages.restore_followed_by_the_source_event_name",
  "Open email": "interface.messages.open_email",
  "Open Messages": "interface.messages.open_messages",
  "Open WhatsApp": "interface.messages.open_whatsapp",
  "Copy the message, open Messages, then paste and send.": "interface.messages.copy_the_message_open_messages_then_paste_and_send",
  "Review the message in your device app and tap Send.": "interface.messages.review_the_message_in_your_device_app_and_tap_send",
  "Opening an app does not mark this message as sent. Return here to confirm sending. Delivery and read receipts remain in your messaging app.": "interface.messages.opening_an_app_does_not_mark_this_message_as_sent_return_here_to_",
  "Enter one valid email address.": "interface.messages.enter_one_valid_email_address",
  "Use an international phone number, including country code.": "interface.messages.use_an_international_phone_number_including_country_code",
  "Refresh and save this delivery again before sending.": "interface.messages.refresh_and_save_this_delivery_again_before_sending",
  "Prepare reminder": "interface.messages.prepare_reminder",
  "Creates a separate draft using current contact details. Review the recipient and text before sending.": "interface.messages.creates_a_separate_draft_using_current_contact_details_review_the",
  "A friendly reminder to reply to our invitation:": "interface.messages.a_friendly_reminder_to_reply_to_our_invitation",
  "Invites": "interface.messages.invites",
  "Things to do": "interface.messages.things_to_do",
  "Task": "interface.messages.task",
  "Assigned to": "interface.messages.assigned_to",
  "Status": "interface.messages.status",
  "Add rows": "interface.messages.add_rows",
  "In progress": "interface.messages.in_progress",
  "Done": "interface.messages.done",
  "Tasks saved.": "interface.messages.tasks_saved",
  "Edit cells, add rows, then save. Blank new rows are ignored.": "interface.messages.edit_cells_add_rows_then_save_blank_new_rows_are_ignored",
  "Select Edit to update the task list.": "interface.messages.select_edit_to_update_the_task_list",
  "Name": "interface.messages.name",
  "User Comment": "interface.messages.user_comment",
  "Admin Comment": "interface.messages.admin_comment",
  "Amount: {claimed}/{needed}, Shown: {shown}": "interface.messages.amount_claimed_needed_shown_shown",
  "Pick item": "interface.messages.pick_item",
  "Remove selection": "interface.messages.remove_selection",
  "Selected": "interface.messages.selected",
  "Find text": "interface.messages.find_text",
  "Choose enabled languages": "interface.messages.choose_enabled_languages",
  "Name is required.": "interface.messages.name_is_required",
  "Comment": "interface.messages.comment",
  "Recipe": "food.messages.recipe",
  "Previous recipe group": "food.messages.previous_recipe_group",
  "Print / Save as PDF": "interface.messages.print_save_as_pdf",
  "Allow pop-ups to save the recipe as PDF.": "food.messages.allow_pop_ups_to_save_the_recipe_as_pdf",
  "Batch(s)": "types.units.batch_s",
  "Piece(s)": "types.units.piece_s",
  "Tray(s)": "types.units.tray_s",
  "Packet(s)": "types.units.packet_s",
  "Kg": "types.units.kg",
  "Grams": "types.units.grams",
  "Default type ({type})": "interface.messages.default_type_type",
  "+ Add food item type": "food.messages.add_food_item_type",
  "New food item type": "food.messages.new_food_item_type",
  "Food item type must be at most 60 characters.": "food.messages.food_item_type_must_be_at_most_60_characters",
  "Expand all items": "interface.messages.expand_all_items",
  "Collapse all items": "interface.messages.collapse_all_items",
  "+ Add household": "interface.messages.add_household_2",
  "Amount: {claimed}/{needed} {type}, Shown: {shown}": "interface.messages.amount_claimed_needed_type_shown_shown",
  "Type translations are shared by food items with the same type.": "food.messages.type_translations_are_shared_by_food_items_with_the_same_type",
  "No matching food types.": "food.messages.no_matching_food_types",
  "Event welcome": "interface.messages.event_welcome",
  "Venue welcome": "interface.messages.venue_welcome",
  "Appears at the top of the guest invitation.": "interface.messages.appears_at_the_top_of_the_guest_invitation",
  "Appears under the session at this venue on the guest invitation.": "interface.messages.appears_under_the_session_at_this_venue_on_the_guest_invitation",
  "Map link": "interface.messages.map_link",
  "Manage households": "interface.messages.manage_households",
  "Checked households are invited to this session. Individual guest exceptions stay in place.": "interface.messages.checked_households_are_invited_to_this_session_individual_guest_e",
  "No households to manage.": "interface.messages.no_households_to_manage",
  "Guest exceptions": "interface.messages.guest_exceptions",
  "Protected by RSVP history": "interface.messages.protected_by_rsvp_history",
  "Manage food": "food.messages.manage_food",
  "Venue food": "food.messages.venue_food",
  "Checked items are available at this venue. Changes apply here only. Existing household claims are kept.": "interface.messages.checked_items_are_available_at_this_venue_changes_apply_here_only",
  "No food items to manage.": "food.messages.no_food_items_to_manage",
  "Add food": "food.messages.add_food",
  "Select all": "interface.messages.select_all",
  "Adding unrestricted food here makes it available at this venue only. Items already assigned to other venues keep those assignments.": "food.messages.adding_unrestricted_food_here_makes_it_available_at_this_venue_on",
  "Nothing available to add.": "interface.messages.nothing_available_to_add",
  "Edit administrator name": "interface.messages.edit_administrator_name",
  "Move session up": "interface.messages.move_session_up",
  "Move session down": "interface.messages.move_session_down",
  "Session order saved.": "interface.messages.session_order_saved",
  "Move language up": "interface.messages.move_language_up",
  "Move language down": "interface.messages.move_language_down",
  "Food Types": "food.messages.food_types",
  "Food categories": "food.messages.food_categories",
  "Save translations": "interface.messages.save_translations",
  "Allow food": "food.messages.allow_food",
  "1 item": "interface.messages.1_item",
  "{items}, {claimed}/{capacity} amounts": "interface.messages.items_claimed_capacity_amounts",
  "+ Add": "interface.messages.add",
  "Edit quantity for {household}": "interface.messages.edit_quantity_for_household",
  "Remove selection for {household}": "interface.messages.remove_selection_for_household",
  "Remove the food selection for {household}?": "food.messages.remove_the_food_selection_for_household",
  "+ Add recipe": "food.messages.add_recipe",
  "Add recipe": "food.messages.add_recipe_2",
  "Recipe name": "food.messages.recipe_name",
  "Existing food items": "food.messages.existing_food_items",
  "Create food item in recipe": "food.messages.create_food_item_in_recipe",
  "Remove new item": "interface.messages.remove_new_item",
  "Save recipe": "food.messages.save_recipe",
  "Edit recipe": "food.messages.edit_recipe",
  "Existing items keep their selections. Recipe items use the recipe category.": "food.messages.existing_items_keep_their_selections_recipe_items_use_the_recipe_",
  "Move to category": "interface.messages.move_to_category",
  "Move recipe to category": "food.messages.move_recipe_to_category",
  "Unsaved changes. Select Save to update the database.": "interface.messages.unsaved_changes_select_save_to_update_the_database",
  "Use main Edit mode to change tasks. Save sends your changes to the database.": "interface.messages.use_main_edit_mode_to_change_tasks_save_sends_your_changes_to_the",
  "Tasks were saved. Refresh the page before editing again.": "interface.messages.tasks_were_saved_refresh_the_page_before_editing_again",
  "Item": "interface.messages.item",
  "New item": "interface.messages.new_item",
  "Edit item": "interface.messages.edit_item",
  "Save item": "interface.messages.save_item",
  "Item saved.": "interface.messages.item_saved",
  "No items in this category.": "interface.messages.no_items_in_this_category",
  "Use main Edit, then the pencil to edit and save a line.": "interface.messages.use_main_edit_then_the_pencil_to_edit_and_save_a_line",
  "Add a category first.": "interface.messages.add_a_category_first",
  "Tasks and things to bring, grouped by category. Use main Edit, then the pencil to edit a line.": "interface.messages.tasks_and_things_to_bring_grouped_by_category_use_main_edit_then_",
  "No matching entries.": "interface.messages.no_matching_entries",
  "Welcome Message": "interface.messages.welcome_message_title",
  "Categories": "interface.messages.categories",
  "Types": "interface.messages.types",
  "Rows per page": "interface.messages.rows_per_page",
  "Previous": "interface.messages.previous",
  "Next": "interface.messages.next",
  "Page {page} of {pages}": "interface.messages.page_page_of_pages",
  "Edit translation": "interface.messages.edit_translation",
  "Export CSV": "interface.messages.export_csv",
  "Use the pencil to open an item, then save your changes.": "interface.messages.use_the_pencil_to_open_an_item_then_save_your_changes",
  "Translate welcome messages, venues, sessions and food. Interface wording is in Settings → Languages.": "interface.messages.main_language_help",
  "Guest note": "interface.messages.guest_note",
  "Translate the item name and the note shown to guests. Types are translated in Languages → Food → Types.": "interface.messages.food_translation_help",
  "English source": "interface.messages.english_source",
  "Unavailable": "interface.messages.unavailable",
  "＋ Add category": "interface.messages.plus_add_category",
  "Edit category": "interface.messages.edit_category",
  "Delete category": "interface.messages.delete_category",
  "Move items to another category before deleting this category.": "interface.messages.move_items_before_deleting_category",
  "Delete empty category?": "interface.messages.delete_empty_category",
  "Category deleted": "interface.messages.category_deleted",
  "Category saved": "interface.messages.category_saved",
  "Manage types": "interface.messages.manage_types",
  "Types are shared by all food items. Translate each type once for every enabled language.": "interface.messages.shared_food_types_help",
  "Built-in": "interface.messages.built_in",
  "Custom": "interface.messages.custom",
  "Translate": "interface.messages.translate",
  "+ Add type": "interface.messages.add_type",
  "This type already exists.": "interface.messages.type_already_exists",
  "Type added": "interface.messages.type_added",
  "＋ Add venue": "interface.messages.plus_add_venue",
  "＋ Add session": "interface.messages.plus_add_session",
  "Move venue up": "interface.messages.move_venue_up",
  "Move venue down": "interface.messages.move_venue_down",
  "Venue order saved": "interface.messages.venue_order_saved",
  "Admin note": "interface.messages.admin_note",
  "Unit": "interface.messages.unit",
  "Batch": "interface.messages.batch_singular",
  "Piece": "interface.messages.piece_singular",
  "Tray": "interface.messages.tray_singular",
  "Packet": "interface.messages.packet_singular",
  "Gram": "interface.messages.gram_singular",
  "Saving…": "interface.messages.saving_progress",
  "Show more": "interface.messages.show_more",
  "Show less": "interface.messages.show_less",
  "Translate in Languages": "interface.messages.translate_in_languages",
  "Swipe for more tabs": "interface.messages.more_tabs_hint",
  "All wording": "interface.messages.all_wording",
  "General": "interface.messages.general",
  "Households & guests": "interface.messages.households_and_guests",
  "Invites & RSVP": "interface.messages.invites_and_rsvp",
  "Food & units": "interface.messages.food_and_units",
  "Venues & sessions": "interface.messages.venues_and_sessions",
  "Administrators & access": "interface.messages.administrators_and_access",
  "Wording categories": "interface.messages.wording_categories",
  "Main": "interface.messages.main",
  "Interface": "interface.messages.interface",
  "Administration areas": "interface.messages.administration_areas",
  "Personal preferences for this device.": "interface.messages.personal_device_preferences",
  "Translate event content for guests.": "interface.messages.translate_event_content",
  "Manage invitations, food and event details.": "interface.messages.main_section_description",
  "View mode": "interface.messages.view_mode",
  "Edit mode": "interface.messages.edit_mode",
  "Switch to light mode": "interface.messages.switch_to_light_mode",
  "Switch to dark mode": "interface.messages.switch_to_dark_mode",
  "Saved": "interface.messages.saved_status",
  "Error": "interface.messages.error_status",
  "Fully assigned": "interface.messages.fully_assigned",
  "Hidden": "interface.messages.hidden_status",
  "Access": "interface.messages.access_access",
  "Access preset": "interface.messages.access_access_preset",
  "Active": "interface.messages.access_active",
  "Administrator management": "interface.messages.access_administrator_management",
  "Administrator permissions are unavailable.": "interface.messages.access_administrator_permissions_are_unavailable",
  "Browser session": "interface.messages.access_browser_session",
  "Custom access · {edit} editable, {view} view only": "interface.messages.access_custom_access_edit_editable_view_view_only",
  "Edit access": "interface.messages.access_edit_access",
  "Enable": "interface.messages.access_enable",
  "Export application backup": "interface.messages.access_export_application_backup",
  "Full administrator": "interface.messages.access_full_administrator",
  "Invites & delivery": "interface.messages.access_invites_delivery",
  "Languages & settings": "interface.messages.access_languages_settings",
  "Last activity": "interface.messages.access_last_activity",
  "Manage": "interface.messages.access_manage",
  "No access": "interface.messages.access_no_access",
  "View": "interface.messages.access_view",
  "View only": "interface.messages.access_view_only",
  "No access hides a section. View shows summaries. Edit allows changes.": "interface.messages.access_no_access_hides_a_section_view_shows_summaries_edit_allows_changes",
  "No active sessions.": "interface.messages.access_no_active_sessions",
  "No administrators to display.": "interface.messages.access_no_administrators_to_display",
  "No eligible verified Auth account found. Send an invitation instead.": "interface.messages.access_no_eligible_verified_auth_account_found_send_an_invitation_instead",
  "Only Full administrators can change access.": "interface.messages.access_only_full_administrators_can_change_access",
  "Only Full administrators can change access. Settings excludes administrator and backup powers.": "interface.messages.access_only_full_administrators_can_change_access_settings_excludes_administrator_and_backup_powers",
  "Remove administrator": "interface.messages.access_remove_administrator",
  "Remove administrator {name}? Their Auth account and historical records remain.": "interface.messages.access_remove_administrator_name_their_auth_account_and_historical_records_remain",
  "Restored · Disabled": "interface.messages.access_restored_disabled",
  "Revoke": "interface.messages.access_revoke",
  "Revoke other administrators’ sessions": "interface.messages.access_revoke_other_administrators_sessions",
  "Revoke this application session?": "interface.messages.access_revoke_this_application_session",
  "Revoke this session? You will return to login.": "interface.messages.access_revoke_this_session_you_will_return_to_login",
  "Revoke your other application sessions?": "interface.messages.access_revoke_your_other_application_sessions",
  "Save access changes for {name}?": "interface.messages.access_save_access_changes_for_name",
  "Section": "interface.messages.access_section",
  "Send invitations & reminders": "interface.messages.access_send_invitations_reminders",
  "Sending is separate from editing invitations. Backup exports include data from the whole event.": "interface.messages.access_sending_is_separate_from_editing_invitations_backup_exports_include_data_from_the_whole_event",
  "Signed in": "interface.messages.access_signed_in",
  "Suspend": "interface.messages.access_suspend",
  "Suspended": "interface.messages.access_suspended",
  "This session": "interface.messages.access_this_session",
  "Suspend administrator {name}? Their current sessions will lose application access.": "interface.messages.access_suspend_administrator_name_their_current_sessions_will_lose_application_access",
  "Enable administrator {name} with their saved access?": "interface.messages.access_enable_administrator_name_with_their_saved_access",
  "Add {email} with View only access? No invitation email will be sent.": "interface.messages.access_add_email_with_view_only_access_no_invitation_email_will_be_sent",
  "Active sessions": "interface.messages.access_active_sessions",
  "Revoke my other sessions": "interface.messages.access_revoke_my_other_sessions",
  "Revocation ends access to this application. Everyone can revoke their own sessions.": "interface.messages.access_revocation_ends_access_to_this_application_everyone_can_revoke_their_own_sessions",
  "Add administrator": "interface.messages.access_add_administrator",
  "Add manually": "interface.messages.access_add_manually",
  "Your administrator access or session has ended. Sign in again.": "interface.messages.access_your_administrator_access_or_session_has_ended_sign_in_again",
  "New administrators start with View only access. Full administrators can customize it.": "interface.messages.access_new_administrators_start_with_view_only_access_full_administrators_can_customize_it",
  "This action is not allowed by your administrator permissions.": "interface.messages.access_this_action_is_not_allowed_by_your_administrator_permissions",
  "Use the available tabs to open the sections you can access.": "interface.messages.access_use_the_available_tabs_to_open_the_sections_you_can_access"
}$json$::jsonb $catalog$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
