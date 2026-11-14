BEGIN;
-- Correct the allowed combinations without reverting the guest/Food/timestamp work.
-- A populated history table must be reviewed rather than dropped automatically.
DO $empty_history$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 LOCK TABLE app_private.restored_activity_logs IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM app_private.restored_activity_logs) THEN
  RAISE EXCEPTION 'Restored history is not empty; archive and review it before removing snapshot support.';
 END IF;
END $empty_history$;

CREATE OR REPLACE FUNCTION app_private.backup_selection(mode text,sections text[],include_logs boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE canonical text[];
BEGIN
 IF mode IS NULL OR mode NOT IN ('backup','template') OR sections IS NULL OR include_logs IS NULL
 OR EXISTS(SELECT 1 FROM unnest(sections) s WHERE s IS NULL OR s NOT IN ('venues','households','food','other','wording'))
 THEN RAISE EXCEPTION 'Choose valid backup mode, sections and activity log options.';END IF;
 IF mode='template' AND include_logs THEN RAISE EXCEPTION 'Partial backups and restores cannot include activity logs.';END IF;
 IF mode='backup' AND sections && ARRAY['households','food'] THEN sections:=sections||ARRAY['venues','households','food'];END IF;
 SELECT coalesce(array_agg(s ORDER BY ord),'{}') INTO canonical
 FROM unnest(ARRAY['venues','households','food','other','wording']) WITH ORDINALITY x(s,ord) WHERE s=ANY(sections);
 RETURN jsonb_build_object('mode',mode,'sections',canonical,'include_logs',include_logs);
END $$;

CREATE OR REPLACE FUNCTION app_private.backup_tables()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_item_types','public.food_groups','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'public.food_item_translations','public.food_category_translations','public.food_type_translations','public.venue_translations','public.session_translations','public.event_translations','public.translation_overrides','app_private.invitation_code_registry']::text[]
$function$;

CREATE OR REPLACE FUNCTION app_private.backup_selected_tables(selection jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
  selected:=selected||ARRAY['public.event_configuration_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit'];
  IF 'households'=ANY(sections) THEN selected:=selected||ARRAY['public.management_audit','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_access_audit','public.invitation_delivery_audit'];END IF;
 END IF;
 RETURN selected;
END $function$;

CREATE OR REPLACE FUNCTION app_private.project_backup(b jsonb, mode text DEFAULT NULL::text, sections text[] DEFAULT NULL::text[], include_logs boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE payload jsonb:=b->'payload';available jsonb:=payload->'selection';selection jsonb;
 tables jsonb;counts jsonb:='{}';t text;fk record;actor_ids text[]:='{}';one jsonb;
BEGIN
 mode:=coalesce(mode,available->>'mode');
 sections:=coalesce(sections,ARRAY(SELECT jsonb_array_elements_text(available->'sections')));
 selection:=app_private.backup_selection(mode,sections,coalesce(include_logs,CASE WHEN mode='template' THEN false ELSE (available->>'include_logs')::boolean END));
 IF available->>'mode'='template' AND mode='backup' THEN RAISE EXCEPTION 'Full restore requires a Full backup file.';END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.admin_export_backup(p_mode text DEFAULT 'backup'::text, p_sections text[] DEFAULT ARRAY['venues'::text, 'households'::text, 'food'::text, 'other'::text, 'wording'::text], p_include_logs boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.require_admin_operation('admin_export_backup');
 result:=app_private.project_backup(app_private.seal_backup(app_private.backup_payload()),p_mode,p_sections,coalesce(p_include_logs,p_mode='backup'));
 PERFORM app_private.validate_backup(result);
 RETURN result;
END $function$;

CREATE OR REPLACE VIEW app_private.administration_log_entries AS
 SELECT 'management:'::text || m.id::text AS event_key,
    m.created_at AS occurred_at,
        CASE m.entity_type
            WHEN 'households'::text THEN 'households'::text
            WHEN 'guests'::text THEN 'guests'::text
            WHEN 'household_contacts'::text THEN 'contacts'::text
            WHEN 'food_access'::text THEN 'food'::text
            WHEN 'session_invitations'::text THEN 'rsvp'::text
            ELSE 'households'::text
        END AS category,
        CASE
            WHEN m.entity_type = 'session_invitations'::text THEN 'invitations_changed'::text
            WHEN m.action = 'insert'::text THEN 'add'::text
            WHEN m.action = 'delete'::text THEN 'delete'::text
            WHEN m.action = 'update'::text AND (m.before_value ->> 'archived_at'::text) IS DISTINCT FROM (m.after_value ->> 'archived_at'::text) THEN
            CASE
                WHEN (m.after_value ->> 'archived_at'::text) IS NULL THEN 'restore'::text
                ELSE 'archive'::text
            END
            WHEN m.action = ANY (ARRAY['update'::text, 'permission_change'::text]) THEN 'update'::text
            ELSE m.action
        END AS action,
    m.household_id,
    m.actor_user_id,
    COALESCE(NULLIF(concat_ws(' '::text, m.after_value ->> 'first_name'::text, m.after_value ->> 'last_name'::text), ''::text), m.after_value ->> 'contact_name'::text, m.after_value ->> 'household_name'::text, m.entity_type) AS subject,
    jsonb_build_object('entity', m.entity_type, 'before', m.before_value, 'after', m.after_value) AS details
   FROM management_audit m
UNION ALL
 SELECT 'rsvp-household:'::text || r.id AS event_key,
    r.created_at AS occurred_at,
    'rsvp'::text AS category,
    r.action,
    r.household_id,
    r.actor_user_id,
    'Household RSVP'::text AS subject,
    jsonb_build_object('reason', r.reason, 'submission_id', r.submission_id) AS details
   FROM rsvp_household_audit r
UNION ALL
 SELECT 'rsvp-response:'::text || r.id AS event_key,
    r.created_at AS occurred_at,
    'rsvp'::text AS category,
        CASE r.action
            WHEN 'submission'::text THEN 'response_submitted'::text
            ELSE 'response_corrected'::text
        END AS action,
    r.household_id,
    r.actor_user_id,
    concat_ws(' '::text, g.first_name, g.last_name) AS subject,
    jsonb_build_object('session', s.name, 'before', r.previous_status, 'after', r.new_status, 'reason', r.reason) AS details
   FROM rsvp_response_audit r
     LEFT JOIN guests g ON g.id = r.guest_id
     LEFT JOIN event_sessions s ON s.id = r.session_id
UNION ALL
 SELECT 'delivery:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'invitations'::text AS category,
        CASE a.action
            WHEN 'confirmed_sent'::text THEN 'sent'::text
            ELSE a.action
        END AS action,
    q.household_id,
    a.actor_user_id,
    'Invitation delivery'::text AS subject,
    jsonb_build_object('channel', q.channel, 'reason', a.reason, 'before_status', a.previous_value ->> 'status'::text, 'after_status', a.new_value ->> 'status'::text) AS details
   FROM invitation_delivery_audit a
     JOIN invitation_send_queue q ON q.id = a.queue_id
UNION ALL
 SELECT 'opened:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'invitations'::text AS category,
    'opened'::text AS action,
    a.household_id,
    NULL::uuid AS actor_user_id,
    'Invitation opened'::text AS subject,
    jsonb_build_object('recording', 'Successful invitation load; repeated loads within 15 minutes are grouped') AS details
   FROM invitation_access_audit a
UNION ALL
 SELECT 'configuration:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
        CASE a.entity_type
            WHEN 'event_locations'::text THEN 'venues'::text
            ELSE 'sessions'::text
        END AS category,
        CASE
            WHEN a.before_value IS NULL THEN 'add'::text
            WHEN (a.before_value ->> 'archived_at'::text) IS DISTINCT FROM (a.after_value ->> 'archived_at'::text) THEN
            CASE
                WHEN (a.after_value ->> 'archived_at'::text) IS NULL THEN 'restore'::text
                ELSE 'archive'::text
            END
            ELSE 'update'::text
        END AS action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    COALESCE(a.after_value ->> 'name'::text, a.entity_type) AS subject,
    jsonb_build_object('before', a.before_value, 'after', a.after_value) AS details
   FROM event_configuration_audit a
UNION ALL
 SELECT 'membership:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_id AS actor_user_id,
    COALESCE(a.details ->> 'name'::text, 'Administrator access'::text) AS subject,
    jsonb_build_object('subject_id', a.subject_id, 'details', a.details) AS details
   FROM admin_membership_audit a
UNION ALL
 SELECT 'app-session:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'login'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    'Administrator session'::text AS subject,
    jsonb_build_object('source', 'Verified app session') AS details
   FROM admin_session_audit a
UNION ALL
 SELECT 'auth:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'login'::text AS category,
    COALESCE(a.payload ->> 'action'::text, 'auth_event'::text) AS action,
    NULL::uuid AS household_id,
    u.id AS actor_user_id,
    'Authentication'::text AS subject,
    jsonb_build_object('source', 'Auth service', 'provider', a.payload ->> 'provider'::text) AS details
   FROM auth.audit_log_entries a
     LEFT JOIN auth.users u ON u.id::text = (a.payload ->> 'actor_id'::text)
  WHERE a.created_at IS NOT NULL
UNION ALL
 SELECT 'admin-invitation:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    a.email AS subject,
    a.details
   FROM admin_invitation_audit a
UNION ALL
 SELECT 'access:'::text || a.id::text AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_id AS actor_user_id,
    COALESCE(( SELECT admins.name
           FROM admins
          WHERE admins.user_id = a.subject_id), 'Former administrator'::text) AS subject,
    a.details
   FROM app_private.admin_access_audit a;

CREATE OR REPLACE FUNCTION public.admin_query_logs(p_search text DEFAULT ''::text, p_category text DEFAULT ''::text, p_action text DEFAULT ''::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_key text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN PERFORM app_private.require_admin_operation('admin_query_logs');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR length(coalesce(p_search,''))>200 OR length(coalesce(p_action,''))>80 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to) OR ((p_before_at IS NULL)<>(p_before_key IS NULL)) THEN RAISE EXCEPTION 'Invalid log filters';END IF;
 IF coalesce(p_category,'') NOT IN ('','households','guests','contacts','rsvp','invitations','login','venues','sessions','food','administrators') THEN RAISE EXCEPTION 'Invalid log category';END IF;
 WITH filtered AS (
 SELECT e.*,h.household_name,coalesce(a.name,u.email,CASE WHEN e.category='invitations' AND e.action='opened' THEN 'Guest' WHEN e.actor_user_id IS NULL THEN 'Guest / system' ELSE 'Administrator' END) actor
 FROM app_private.administration_log_entries e LEFT JOIN public.households h ON h.id=e.household_id LEFT JOIN public.admins a ON a.user_id=e.actor_user_id LEFT JOIN auth.users u ON u.id=e.actor_user_id
 WHERE (coalesce(p_category,'')='' OR e.category=p_category) AND (coalesce(p_action,'')='' OR e.action=p_action) AND (p_from IS NULL OR e.occurred_at>=p_from) AND (p_to IS NULL OR e.occurred_at<p_to)
 AND (p_before_at IS NULL OR (e.occurred_at,e.event_key)<(p_before_at,p_before_key))
 AND (coalesce(btrim(p_search),'')='' OR position(lower(btrim(p_search)) in lower(concat_ws(' ',e.subject,h.household_name,a.name,u.email,e.category,e.action,e.details::text)))>0)
 ORDER BY e.occurred_at DESC,e.event_key DESC LIMIT p_limit+1
 ), numbered AS (SELECT *,row_number() over(ORDER BY occurred_at DESC,event_key DESC) n FROM filtered)
 SELECT jsonb_build_object('entries',coalesce(jsonb_agg(to_jsonb(numbered)-'n' ORDER BY occurred_at DESC,event_key DESC) FILTER(WHERE n<=p_limit),'[]'::jsonb),'has_more',count(*)>p_limit) INTO result FROM numbered;
 result:=result||jsonb_build_object('actions',(SELECT coalesce(jsonb_agg(action ORDER BY action),'[]'::jsonb) FROM (SELECT DISTINCT action FROM app_private.administration_log_entries WHERE coalesce(p_category,'')='' OR category=p_category) a));
 RETURN result;
END $function$;

-- No CASCADE: unexpected dependencies stop the correction.
DROP FUNCTION app_private.backup_log_snapshots(jsonb);
DROP FUNCTION app_private.backup_log_tables();
DROP TABLE app_private.restored_activity_logs;

DO $contract$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'''20261113203714''')=0 THEN RAISE EXCEPTION 'Unexpected backup schema';END IF;
 EXECUTE replace(d,'''20261113203714''','''20261113213849''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'''20261113203714''')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;
 EXECUTE replace(d,'''20261113203714''','''20261113213849''');
END $contract$;

DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Event settings and languages are always included. Partial mode resets invitation codes, replies and commitments, and excludes activity logs.": "interface.messages.backup_partial_excludes_logs", "Activity logs are optional for Full backup and Full restore only. Full restore requires a Full backup file.": "interface.messages.backup_full_logs_only", "Partial backups and restores cannot include activity logs.": "interface.messages.backup_partial_logs_forbidden", "Full restore requires a Full backup file.": "interface.messages.backup_full_file_required"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
