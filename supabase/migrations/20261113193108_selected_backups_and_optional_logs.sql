BEGIN;
-- Alpha contract: current exports only; no legacy format adapter or data rewrite.
CREATE FUNCTION app_private.backup_selection(mode text, sections text[], include_logs boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE canonical text[];
BEGIN
 IF mode IS NULL OR mode NOT IN ('backup','template') OR sections IS NULL OR include_logs IS NULL
 OR EXISTS(SELECT 1 FROM unnest(sections) s WHERE s IS NULL OR s NOT IN ('venues','households','food','other','wording'))
 THEN RAISE EXCEPTION 'Choose valid backup mode, sections and activity log options.';END IF;
 -- Household replies and food commitments are one connected set of business records.
 IF mode='backup' AND sections && ARRAY['households','food'] THEN
  sections:=sections||ARRAY['venues','households','food'];
 END IF;
 SELECT coalesce(array_agg(s ORDER BY ord),'{}') INTO canonical
 FROM unnest(ARRAY['venues','households','food','other','wording']) WITH ORDINALITY x(s,ord) WHERE s=ANY(sections);
 RETURN jsonb_build_object('mode',mode,'sections',canonical,'include_logs',mode='backup' AND include_logs);
END $$;

CREATE FUNCTION app_private.backup_selected_tables(selection jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE sections text[]:=ARRAY(SELECT jsonb_array_elements_text(selection->'sections'));
 selected text[]:=ARRAY['public.event_languages','public.event_settings'];
 live boolean:=selection->>'mode'='backup';
BEGIN
 IF 'venues'=ANY(sections) THEN selected:=selected||ARRAY['public.event_locations','public.event_sessions','public.venue_translations','public.session_translations'];END IF;
 IF 'households'=ANY(sections) THEN
  selected:=selected||ARRAY['public.relation_groups','public.households','public.guests','public.household_contacts'];
  IF live THEN selected:=selected||ARRAY['public.rsvp_submissions','public.guest_session_responses','public.invitation_send_queue','public.invitation_deliveries','app_private.invitation_code_registry'];END IF;
 END IF;
 IF ARRAY['venues','households'] <@ sections THEN selected:=selected||ARRAY['public.household_session_defaults','public.guest_session_overrides'];END IF;
 IF 'food'=ANY(sections) THEN
  selected:=selected||ARRAY['public.food_categories','public.food_item_types','public.food_groups','public.food_items','public.food_item_translations','public.food_category_translations','public.food_type_translations'];
  IF live THEN selected:=selected||ARRAY['public.food_claims'];END IF;
 END IF;
 IF 'other'=ANY(sections) THEN selected:=selected||ARRAY['public.other_categories','public.other_items'];END IF;
 IF 'wording'=ANY(sections) THEN selected:=selected||ARRAY['public.event_translations','public.translation_overrides','public.message_templates'];END IF;
 IF (selection->>'include_logs')::boolean THEN
  selected:=selected||ARRAY['public.management_audit','public.event_configuration_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit'];
  IF 'households'=ANY(sections) THEN selected:=selected||ARRAY['public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_access_audit','public.invitation_delivery_audit'];END IF;
 END IF;
 RETURN selected;
END $$;

CREATE FUNCTION app_private.seal_backup(payload jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('format','rsvp-application-backup','version',2,'payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'))
$$;

DO $contract$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'''20261113180203''')=0 THEN RAISE EXCEPTION 'Unexpected backup schema';END IF;
 d:=replace(d,'''20261113180203''','''20261113193108''');
 EXECUTE replace(d,'''schema_version'',''20261113193108''','''selection'',app_private.backup_selection(''backup'',ARRAY[''venues'',''households'',''food'',''other'',''wording''],true),''schema_version'',''20261113193108''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'''20261113180203''')=0 OR strpos(d,'RETURN jsonb_build_object(''rows'',n')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;
 d:=replace(replace(d,'''20261113180203''','''20261113193108'''),'''version'' IS DISTINCT FROM ''1''','''version'' IS DISTINCT FROM ''2''');
 d:=replace(d,'RETURN jsonb_build_object(''rows'',n','PERFORM app_private.validate_backup_selection(payload); RETURN jsonb_build_object(''selection'',payload->''selection'',''rows'',n');
 EXECUTE d;
END $contract$;

CREATE FUNCTION app_private.validate_backup_selection(payload jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE selection jsonb:=payload->'selection'; canonical jsonb;t text;
BEGIN
 IF jsonb_typeof(selection) IS DISTINCT FROM 'object' OR jsonb_typeof(selection->'sections') IS DISTINCT FROM 'array'
 OR jsonb_typeof(selection->'include_logs') IS DISTINCT FROM 'boolean' OR (SELECT count(*) FROM jsonb_object_keys(selection))<>3
 THEN RAISE EXCEPTION 'Invalid backup selection manifest';END IF;
 canonical:=app_private.backup_selection(selection->>'mode',ARRAY(SELECT jsonb_array_elements_text(selection->'sections')),(selection->>'include_logs')::boolean);
 IF selection IS DISTINCT FROM canonical THEN RAISE EXCEPTION 'Invalid backup selection dependencies';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF NOT t=ANY(app_private.backup_selected_tables(selection)) AND jsonb_array_length(payload->'tables'->t)<>0
  THEN RAISE EXCEPTION 'Backup contains an excluded section or activity log: %',t;END IF;
 END LOOP;
 IF NOT (selection->>'include_logs')::boolean AND
 (coalesce(payload->'sign_in_log_reference','[]')<>'[]'::jsonb OR coalesce(payload->'administrator_reference','[]')<>'[]'::jsonb)
 THEN RAISE EXCEPTION 'Backup contains excluded administrator history';END IF;
END $$;

CREATE FUNCTION app_private.project_backup(b jsonb, mode text DEFAULT NULL, sections text[] DEFAULT NULL, include_logs boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE payload jsonb:=b->'payload';available jsonb:=payload->'selection';selection jsonb;
 tables jsonb;counts jsonb:='{}';t text;fk record;actor_ids text[]:='{}';one jsonb;
BEGIN
 mode:=coalesce(mode,available->>'mode');
 sections:=coalesce(sections,ARRAY(SELECT jsonb_array_elements_text(available->'sections')));
 selection:=app_private.backup_selection(mode,sections,coalesce(include_logs,(available->>'include_logs')::boolean));
 IF available->>'mode'='template' AND mode='backup' THEN RAISE EXCEPTION 'A planning template cannot restore cleared replies or commitments.';END IF;
 IF NOT (selection->'sections') <@ (available->'sections') THEN RAISE EXCEPTION 'Selected sections are not available in this file.';END IF;
 IF (selection->>'include_logs')::boolean AND NOT (available->>'include_logs')::boolean THEN RAISE EXCEPTION 'Activity logs are not available in this file.';END IF;
 IF mode='template' THEN payload:=app_private.backup_as_template(b,sections)->'payload';END IF;
 tables:=payload->'tables';
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF NOT t=ANY(app_private.backup_selected_tables(selection)) THEN tables:=jsonb_set(tables,ARRAY[t],'[]');END IF;
  counts:=counts||jsonb_build_object(t,jsonb_array_length(tables->t));
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR one IN SELECT value FROM jsonb_array_elements(tables->t) LOOP
    IF one->>fk.attname IS NOT NULL THEN actor_ids:=array_append(actor_ids,one->>fk.attname);END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF NOT (selection->>'include_logs')::boolean THEN
  payload:=payload||'{"sign_in_log_reference":[],"administrator_reference":[]}'::jsonb;
 ELSE
  FOR one IN SELECT value FROM jsonb_array_elements(coalesce(payload->'administrator_reference','[]')) LOOP actor_ids:=array_append(actor_ids,one->>'user_id');END LOOP;
 END IF;
 payload:=payload||jsonb_build_object('selection',selection,'tables',tables,'counts',counts,'identities',
  coalesce((SELECT jsonb_agg(u) FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=ANY(actor_ids)),'[]'));
 RETURN app_private.seal_backup(payload);
END $$;

-- Validate uploaded files before projection; internally generated exports are validated
-- after pruning, so an omitted large section cannot block a small selected backup.
CREATE FUNCTION app_private.select_backup(b jsonb, mode text DEFAULT NULL, sections text[] DEFAULT NULL, include_logs boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 PERFORM app_private.validate_backup(b);
 RETURN app_private.project_backup(b,mode,sections,include_logs);
END $$;
DO $template$
DECLARE d text:=pg_get_functiondef('app_private.backup_as_template(jsonb,text[])'::regprocedure);
BEGIN
 IF strpos(d,'PERFORM app_private.validate_backup(b);')=0 THEN RAISE EXCEPTION 'Unexpected planning template builder';END IF;
 EXECUTE replace(d,'PERFORM app_private.validate_backup(b);','-- Input is checked by select_backup; trusted exports are checked after projection.');
END $template$;

-- One current API for both export modes and both restore modes; retire template-only RPCs.
DROP FUNCTION public.admin_preview_backup_template(jsonb,text[]);
DROP FUNCTION public.admin_restore_backup_template(jsonb,text[],text);
DROP FUNCTION public.admin_export_backup();
DROP FUNCTION public.admin_preview_backup(jsonb);
DROP FUNCTION public.admin_restore_backup(jsonb,text);
CREATE FUNCTION public.admin_export_backup(p_mode text DEFAULT 'backup',p_sections text[] DEFAULT ARRAY['venues','households','food','other','wording'],p_include_logs boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.require_admin_operation('admin_export_backup');
 result:=app_private.project_backup(app_private.seal_backup(app_private.backup_payload()),p_mode,p_sections,p_include_logs);
 PERFORM app_private.validate_backup(result);
 RETURN result;
END $$;
CREATE FUNCTION public.admin_preview_backup(p_backup jsonb,p_mode text DEFAULT NULL,p_sections text[] DEFAULT NULL,p_include_logs boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate jsonb;report jsonb;result jsonb;
BEGIN
 PERFORM app_private.require_admin_operation('admin_preview_backup');
 candidate:=app_private.select_backup(p_backup,p_mode,p_sections,p_include_logs);
 report:=app_private.validate_backup(candidate);
 BEGIN
  result:=app_private.restore_backup(candidate);
  RAISE EXCEPTION USING ERRCODE='P0199',MESSAGE='restore_preview_rollback';
 EXCEPTION WHEN SQLSTATE 'P0199' THEN RETURN report||jsonb_build_object('can_restore',true);
 WHEN OTHERS THEN RETURN report||jsonb_build_object('can_restore',false,'reason',SQLERRM);
 END;
END $$;
CREATE FUNCTION public.admin_restore_backup(p_backup jsonb,p_confirmation text,p_mode text DEFAULT NULL,p_sections text[] DEFAULT NULL,p_include_logs boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_admin_operation('admin_restore_backup');
 IF p_confirmation IS DISTINCT FROM 'RESTORE '||coalesce(p_backup->'payload'->'tables'->'public.event_settings'->0->>'event_name','') THEN RAISE EXCEPTION 'Type RESTORE followed by the source event name';END IF;
 RETURN app_private.restore_backup(app_private.select_backup(p_backup,p_mode,p_sections,p_include_logs));
END $$;
REVOKE ALL ON FUNCTION app_private.backup_selection(text,text[],boolean),app_private.backup_selected_tables(jsonb),app_private.seal_backup(jsonb),app_private.project_backup(jsonb,text,text[],boolean),app_private.validate_backup_selection(jsonb),app_private.select_backup(jsonb,text,text[],boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_export_backup(text,text[],boolean),public.admin_preview_backup(jsonb,text,text[],boolean),public.admin_restore_backup(jsonb,text,text,text[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_export_backup(text,text[],boolean),public.admin_preview_backup(jsonb,text,text[],boolean),public.admin_restore_backup(jsonb,text,text,text[],boolean) TO authenticated;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Export mode": "interface.messages.backup_export_mode", "Backup": "interface.messages.backup_preserve_mode", "Include sections": "interface.messages.backup_include_sections", "Include activity logs": "interface.messages.backup_include_logs", "Event settings and languages are always included. In Backup mode, households and food include each other and venues to preserve replies and commitments.": "interface.messages.backup_sections_help", "Activity logs can contain personal details. Replies, food commitments and Sent records are kept in Backup mode even when logs are excluded. Planning templates omit logs and reset invitation codes, replies and commitments.": "interface.messages.backup_logs_help", "Choose valid backup mode, sections and activity log options.": "interface.messages.backup_invalid_options", "Invalid backup selection manifest": "interface.messages.backup_invalid_manifest", "Invalid backup selection dependencies": "interface.messages.backup_invalid_dependencies", "A planning template cannot restore cleared replies or commitments.": "interface.messages.backup_template_no_replies", "Selected sections are not available in this file.": "interface.messages.backup_sections_unavailable", "Activity logs are not available in this file.": "interface.messages.backup_logs_unavailable", "Backup contains excluded administrator history": "interface.messages.backup_excluded_admin_history"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
