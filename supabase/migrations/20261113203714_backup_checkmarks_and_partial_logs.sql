BEGIN;
-- Historical snapshots have no links to live guests, submissions, deliveries or Auth.
-- Partial restore can retain history without recreating the records it resets.
CREATE TABLE app_private.restored_activity_logs (
 id uuid PRIMARY KEY,
 source_table text NOT NULL,
 source_id text NOT NULL,
 occurred_at timestamptz NOT NULL,
 category text NOT NULL CHECK(category IN ('households','guests','contacts','rsvp','invitations','login','venues','sessions','food','administrators')),
 action text NOT NULL,
 subject text NOT NULL,
 actor_name text NOT NULL,
 household_name text,
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object')
);
CREATE INDEX restored_activity_logs_time ON app_private.restored_activity_logs(occurred_at DESC,id DESC);
ALTER TABLE app_private.restored_activity_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.restored_activity_logs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_restored_activity_logs BEFORE UPDATE OR DELETE ON app_private.restored_activity_logs
 FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

CREATE FUNCTION app_private.backup_log_tables() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_delivery_audit',
 'public.management_audit','public.event_configuration_audit','public.invitation_access_audit',
 'public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit']::text[]
$$;

CREATE FUNCTION app_private.backup_log_snapshots(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE tables jsonb:=payload->'tables'; result jsonb:=coalesce(tables->'app_private.restored_activity_logs','[]');
 t text;row jsonb;actor_id text;household_id text;household_name text;actor_name text;
 category text;action text;subject text;guest jsonb;queue jsonb;source_id text;at text;id uuid;
BEGIN
 FOREACH t IN ARRAY app_private.backup_log_tables()||ARRAY['sign_in_log_reference'] LOOP
  FOR row IN SELECT value FROM jsonb_array_elements(CASE WHEN t='sign_in_log_reference' THEN coalesce(payload->t,'[]') ELSE coalesce(tables->t,'[]') END) LOOP
   queue:=NULL;guest:=NULL;
   IF t='public.invitation_delivery_audit' THEN
    SELECT q INTO queue FROM jsonb_array_elements(tables->'public.invitation_send_queue') q WHERE q->>'id'=row->>'queue_id';
   END IF;
   household_id:=coalesce(row->>'household_id',queue->>'household_id');
   SELECT h->>'household_name' INTO household_name FROM jsonb_array_elements(tables->'public.households') h WHERE h->>'id'=household_id;
   SELECT g INTO guest FROM jsonb_array_elements(tables->'public.guests') g WHERE g->>'id'=row->>'guest_id';
   actor_id:=coalesce(row->>'actor_user_id',row->>'actor_id',row->>'invited_by');
   SELECT a->>'name' INTO actor_name FROM jsonb_array_elements(coalesce(payload->'administrator_reference','[]')) a WHERE a->>'user_id'=actor_id;
   actor_name:=coalesce(nullif(actor_name,''),(SELECT u->>'email' FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=actor_id),'Guest / system');
   category:=CASE t
    WHEN 'public.management_audit' THEN CASE row->>'entity_type' WHEN 'guests' THEN 'guests' WHEN 'household_contacts' THEN 'contacts' WHEN 'food_access' THEN 'food' WHEN 'session_invitations' THEN 'rsvp' ELSE 'households' END
    WHEN 'public.rsvp_household_audit' THEN 'rsvp' WHEN 'public.rsvp_response_audit' THEN 'rsvp'
    WHEN 'public.invitation_delivery_audit' THEN 'invitations' WHEN 'public.invitation_access_audit' THEN 'invitations'
    WHEN 'public.event_configuration_audit' THEN CASE row->>'entity_type' WHEN 'event_locations' THEN 'venues' ELSE 'sessions' END
    WHEN 'sign_in_log_reference' THEN 'login' ELSE 'administrators' END;
   action:=CASE
    WHEN t='public.invitation_access_audit' THEN 'opened'
    WHEN t='public.backup_restore_audit' THEN 'restored'
    WHEN t='public.admin_invitations' THEN 'invitation_reference'
    WHEN t='public.rsvp_response_audit' THEN CASE row->>'action' WHEN 'submission' THEN 'response_submitted' ELSE 'response_corrected' END
    WHEN t='public.invitation_delivery_audit' AND row->>'action'='confirmed_sent' THEN 'sent'
    ELSE coalesce(row->>'action','update') END;
   subject:=coalesce(nullif(concat_ws(' ',guest->>'first_name',guest->>'last_name'),''),nullif(household_name,''),row->>'email',row->'after_value'->>'name',row->>'entity_type',CASE WHEN t='sign_in_log_reference' THEN 'Administrator session' ELSE 'Restored activity' END);
   source_id:=row->>'id';at:=coalesce(row->>'created_at',row->>'restored_at',row->>'confirmed_at',payload->>'created_at');
   id:=md5(t||':'||source_id||':'||row::text)::uuid;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) x WHERE x->>'id'=id::text) THEN
    result:=result||jsonb_build_array(jsonb_build_object('id',id,'source_table',t,'source_id',source_id,'occurred_at',at,'category',category,'action',action,'subject',subject,'actor_name',actor_name,'household_name',household_name,'details',jsonb_build_object('record',row,'historical',true)));
   END IF;
  END LOOP;
 END LOOP;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION app_private.backup_selected_tables(selection jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE sections text[]:=ARRAY(SELECT jsonb_array_elements_text(selection->'sections'));
 selected text[]:=ARRAY['public.event_languages','public.event_settings'];
 live boolean:=selection->>'mode'='backup';
 complete boolean:=ARRAY['venues','households','food','other','wording'] <@ sections;
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
  selected:=selected||ARRAY['app_private.restored_activity_logs'];
  IF live AND complete THEN selected:=selected||app_private.backup_log_tables();END IF;
 END IF;
 RETURN selected;
END $$;

DO $functions$
DECLARE d text;view_sql text;
BEGIN
 d:=pg_get_functiondef('app_private.backup_tables()'::regprocedure);
 IF strpos(d,'''app_private.invitation_code_registry''')=0 THEN RAISE EXCEPTION 'Unexpected backup table list';END IF;
 EXECUTE replace(d,'''app_private.invitation_code_registry''','''app_private.invitation_code_registry'',''app_private.restored_activity_logs''');
 d:=pg_get_functiondef('app_private.backup_selection(text,text[],boolean)'::regprocedure);
 IF strpos(d,'''include_logs'',mode=''backup'' AND include_logs')=0 THEN RAISE EXCEPTION 'Unexpected log selection definition';END IF;
 EXECUTE replace(d,'''include_logs'',mode=''backup'' AND include_logs','''include_logs'',include_logs');
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'''20261113193108''')=0 THEN RAISE EXCEPTION 'Unexpected backup schema';END IF;
 EXECUTE replace(d,'''20261113193108''','''20261113203714''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'''20261113193108''')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;
 EXECUTE replace(d,'''20261113193108''','''20261113203714''');
 d:=pg_get_functiondef('app_private.project_backup(jsonb,text,text[],boolean)'::regprocedure);
 IF strpos(d,'IF mode=''template'' THEN payload:=')=0 OR strpos(d,'tables:=payload->''tables'';')=0 THEN RAISE EXCEPTION 'Unexpected backup projection';END IF;
 d:=replace(d,'tables:=payload->''tables'';',
 'tables:=payload->''tables'';
 IF (selection->>''include_logs'')::boolean AND (mode=''template'' OR NOT ARRAY[''venues'',''households'',''food'',''other'',''wording''] <@ ARRAY(SELECT jsonb_array_elements_text(selection->''sections''))) THEN
  tables:=jsonb_set(tables,ARRAY[''app_private.restored_activity_logs''],app_private.backup_log_snapshots(b->''payload''));
  payload:=payload||''{"sign_in_log_reference":[],"administrator_reference":[]}''::jsonb;
 END IF;');
 EXECUTE d;
 -- Retain the existing view shape and every native history source and permission gate.
 view_sql:=pg_get_viewdef('app_private.administration_log_entries'::regclass,true);
 EXECUTE 'CREATE OR REPLACE VIEW app_private.administration_log_entries AS '||rtrim(view_sql,E';\n ')||'
 UNION ALL SELECT ''restored:''||r.id::text,r.occurred_at,r.category,r.action,NULL::uuid,NULL::uuid,r.subject,
 r.details||jsonb_build_object(''_historical_actor'',r.actor_name,''_historical_household'',r.household_name,''_restored_activity'',true)
 FROM app_private.restored_activity_logs r';
 d:=pg_get_functiondef('public.admin_query_logs(text,text,text,timestamptz,timestamptz,timestamptz,text,integer)'::regprocedure);
 IF strpos(d,'SELECT e.*,h.household_name,coalesce(a.name,u.email,')=0 THEN RAISE EXCEPTION 'Unexpected administration log query';END IF;
 EXECUTE replace(d,'SELECT e.*,h.household_name,coalesce(a.name,u.email,',
 'SELECT e.*,coalesce(CASE WHEN e.event_key LIKE ''restored:%'' THEN e.details->>''_historical_household'' END,h.household_name) household_name,coalesce(CASE WHEN e.event_key LIKE ''restored:%'' THEN e.details->>''_historical_actor'' END,a.name,u.email,');
END $functions$;
REVOKE ALL ON FUNCTION app_private.backup_log_tables(),app_private.backup_log_snapshots(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON app_private.administration_log_entries FROM PUBLIC,anon,authenticated;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Partial backup": "interface.messages.backup_partial_export", "Partial restore": "interface.messages.backup_partial_restore", "Event settings and languages are always included. Partial mode resets invitation codes, replies and commitments. Included logs remain read-only history.": "interface.messages.backup_partial_help", "Activity logs can be included in Full or Partial mode. They may contain personal details; Partial restores retain them as read-only history.": "interface.messages.backup_independent_logs_help"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
