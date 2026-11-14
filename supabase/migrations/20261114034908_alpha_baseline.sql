-- RSVP Manager alpha baseline: current schema and safe empty-event defaults.
-- Fresh Supabase projects only. No pre-alpha migration chain is required.

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(19421, 9201);
DO $fresh_install$
BEGIN
 IF to_regclass('auth.users') IS NULL OR to_regclass('auth.sessions') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
  RAISE EXCEPTION 'Supabase Auth must exist before running the fresh installer.';
 END IF;
 IF to_regnamespace('app_private') IS NOT NULL OR EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
 ) THEN
  RAISE EXCEPTION 'Alpha baseline requires an empty application schema. Do not run it over an installed event.';
 END IF;
END $fresh_install$;
--
-- PostgreSQL database dump
--



SET LOCAL statement_timeout = 0;
SET LOCAL lock_timeout = 0;
SET LOCAL idle_in_transaction_session_timeout = 0;
SET LOCAL transaction_timeout = 0;
SET LOCAL client_encoding = 'UTF8';
SET LOCAL standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', true);
SET LOCAL check_function_bodies = false;
SET LOCAL xmloption = content;
SET LOCAL client_min_messages = warning;
SET LOCAL row_security = off;

--
-- Name: app_private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app_private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: append_guest_order(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.append_guest_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.sort_order IS NULL) OR
    (TG_OP='UPDATE' AND (NEW.is_child IS DISTINCT FROM OLD.is_child OR NEW.household_id IS DISTINCT FROM OLD.household_id)) THEN
  PERFORM pg_advisory_xact_lock(19421,7744);
  -- Give existing unsorted people positions before appending the new member.
  WITH pending AS (
   SELECT g.id,row_number() OVER (ORDER BY lower(g.first_name),lower(coalesce(g.last_name,'')),g.id) AS n
   FROM public.guests g WHERE g.household_id=NEW.household_id AND g.id<>NEW.id AND g.archived_at IS NULL AND g.sort_order IS NULL
  ), base AS (
   SELECT coalesce(max(sort_order),0) AS n FROM public.guests WHERE household_id=NEW.household_id AND archived_at IS NULL
  )
  UPDATE public.guests g SET sort_order=(base.n+pending.n)::integer FROM pending,base WHERE g.id=pending.id;
  SELECT coalesce(max(g.sort_order),0)+1 INTO NEW.sort_order
  FROM public.guests g WHERE g.household_id=NEW.household_id AND g.id<>NEW.id AND g.archived_at IS NULL;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: audit_event_configuration(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.audit_event_configuration() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE b jsonb;BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN b:=to_jsonb(OLD);END IF;
 IF b IS DISTINCT FROM to_jsonb(NEW) THEN INSERT INTO public.event_configuration_audit(entity_type,entity_id,actor_user_id,before_value,after_value) VALUES(TG_TABLE_NAME,NEW.id,auth.uid(),b,to_jsonb(NEW));END IF;
 RETURN NEW;
END $$;


--
-- Name: audit_management(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.audit_management() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE b jsonb; a jsonb; h uuid;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN b:=to_jsonb(OLD)-'invite_code'-'updated_at'; END IF;
 a:=to_jsonb(NEW)-'invite_code'-'updated_at';
 IF a IS NOT DISTINCT FROM b THEN RETURN NEW; END IF;
 h:=CASE WHEN TG_TABLE_NAME='households' THEN NEW.id ELSE (a->>'household_id')::uuid END;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value)
 VALUES(h,TG_TABLE_NAME,NEW.id,auth.uid(),lower(TG_OP),b,a);
 -- A move is also visible in the source household's history.
 IF TG_TABLE_NAME='guests' AND TG_OP='UPDATE' AND b->>'household_id' IS DISTINCT FROM a->>'household_id' THEN
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value)
 VALUES((b->>'household_id')::uuid,TG_TABLE_NAME,NEW.id,auth.uid(),'move',b,a);
 END IF;
 RETURN NEW;
END $$;


--
-- Name: backup_as_template(jsonb, text[]); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.backup_as_template(b jsonb, sections text[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
 payload jsonb:=b->'payload';
 tables jsonb:=payload->'tables';
 counts jsonb:='{}';
 selected text[]:=ARRAY['public.event_languages','public.event_settings'];
 t text;
BEGIN
 -- Input is checked by select_backup; trusted exports are checked after projection.
 IF sections IS NULL OR EXISTS(
  SELECT 1 FROM unnest(sections) AS s WHERE s IS NULL OR s NOT IN ('venues','households','food','other','wording')
 ) THEN RAISE EXCEPTION 'Choose valid backup template sections.'; END IF;

 IF 'venues'=ANY(sections) THEN selected:=selected||ARRAY[
  'public.event_locations','public.event_sessions','public.venue_translations','public.session_translations'
 ];END IF;
 IF 'households'=ANY(sections) THEN selected:=selected||ARRAY[
  'public.relation_groups','public.households','public.guests','public.household_contacts'
 ];END IF;
 IF ARRAY['venues','households'] <@ sections THEN selected:=selected||ARRAY[
  'public.household_session_defaults','public.guest_session_overrides'
 ];END IF;
 IF 'food'=ANY(sections) THEN selected:=selected||ARRAY[
  'public.food_categories','public.food_item_types','public.food_groups','public.food_items','public.food_item_translations',
  'public.food_category_translations','public.food_type_translations'
 ];END IF;
 IF 'other'=ANY(sections) THEN selected:=selected||ARRAY['public.other_categories','public.other_items'];END IF;
 IF 'wording'=ANY(sections) THEN selected:=selected||ARRAY[
  'public.event_translations','public.translation_overrides','public.message_templates'
 ];END IF;

 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF NOT t=ANY(selected) THEN
   tables:=jsonb_set(tables,ARRAY[t],'[]');
  ELSIF t='public.households' THEN
   tables:=jsonb_set(tables,ARRAY[t],coalesce((SELECT jsonb_agg(value||jsonb_build_object(
    'invite_code',NULL,'rsvp_state','open','rsvp_submitted_at',NULL,'latest_rsvp_submission_id',NULL,
    'late_submission_until',NULL,'visited',false,'visited_at',NULL,'food_confirmed',false,'food_confirmed_at',NULL,'food_interest',NULL
   )) FROM jsonb_array_elements(tables->t)),'[]'));
  ELSIF t='public.guests' THEN
   tables:=jsonb_set(tables,ARRAY[t],coalesce((SELECT jsonb_agg(value||'{"rsvp_status":"pending"}')
    FROM jsonb_array_elements(tables->t)),'[]'));
  ELSIF t=ANY(ARRAY['public.event_translations','public.translation_overrides','public.venue_translations',
     'public.session_translations','public.food_item_translations','public.food_category_translations','public.food_type_translations']) THEN
   tables:=jsonb_set(tables,ARRAY[t],coalesce((SELECT jsonb_agg(value||'{"updated_by":null}')
    FROM jsonb_array_elements(tables->t)),'[]'));
  ELSIF t='public.food_items' AND NOT 'venues'=ANY(sections) THEN
   -- Keep venue-specific items unavailable until they are assigned to new venues.
   tables:=jsonb_set(tables,ARRAY[t],coalesce((SELECT jsonb_agg(
    CASE WHEN value->'venue_ids'='null' THEN value ELSE value||'{"venue_ids":[]}' END
   ) FROM jsonb_array_elements(tables->t)),'[]'));
  END IF;
  counts:=counts||jsonb_build_object(t,jsonb_array_length(tables->t));
 END LOOP;
 tables:=jsonb_set(tables,ARRAY['public.event_settings'],(SELECT jsonb_agg(value||'{"food_stage":"interest"}'::jsonb) FROM jsonb_array_elements(tables->'public.event_settings'))); payload:=(payload-'administrator_reference')||jsonb_build_object('tables',tables,'counts',counts,'identities','[]'::jsonb);
 RETURN b||jsonb_build_object('payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
END $$;


--
-- Name: backup_columns(text); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.backup_columns(t text) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'required',attnotnull,'identity',attidentity) ORDER BY attnum)
 FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped
$$;


--
-- Name: backup_payload(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.backup_payload() RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE tables jsonb:='{}';columns jsonb:='{}';counts jsonb:='{}';t text;rows jsonb;identities jsonb;ids text[]:=ARRAY[]::text[];fk record;one jsonb;
BEGIN
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  -- Convert bigint values to strings so JavaScript cannot round audit/identity IDs.
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM %s r',t) INTO rows;
  DECLARE a record;i integer;BEGIN
   FOR a IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND atttypid='bigint'::regtype AND attnum>0 AND NOT attisdropped LOOP
    FOR i IN 0..jsonb_array_length(rows)-1 LOOP
     IF rows->i->a.attname IS NOT NULL AND rows->i->a.attname<>'null'::jsonb THEN rows:=jsonb_set(rows,ARRAY[i::text,a.attname],to_jsonb(rows->i->>a.attname));END IF;
    END LOOP;
   END LOOP;
  END;
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR one IN SELECT value FROM jsonb_array_elements(rows) LOOP IF one->>fk.attname IS NOT NULL THEN ids:=array_append(ids,one->>fk.attname);END IF;END LOOP;
  END LOOP;
  tables:=tables||jsonb_build_object(t,rows);columns:=columns||jsonb_build_object(t,app_private.backup_columns(t));counts:=counts||jsonb_build_object(t,jsonb_array_length(rows));
 END LOOP;
 -- Only identity metadata, never passwords, tokens, Auth identities or sessions.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email)),'[]') INTO identities FROM auth.users WHERE id::text=ANY(ids) OR id IN(SELECT user_id FROM public.admins);
 RETURN jsonb_build_object('selection',app_private.backup_selection('backup',ARRAY['venues','households','food','other','wording'],true),'schema_version','20261114034908','created_at',clock_timestamp(),'tables',tables,'columns',columns,'counts',counts,'identities',identities,
 'sign_in_log_reference',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('id',a.id::text)),'[]') FROM public.admin_session_audit a),
 'administrator_reference',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.admins a));
END $$;


--
-- Name: backup_selected_tables(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.backup_selected_tables(selection jsonb) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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
END $$;


--
-- Name: backup_selection(text, text[], boolean); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.backup_selection(mode text, sections text[], include_logs boolean) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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


--
-- Name: backup_tables(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.backup_tables() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_item_types','public.food_groups','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'public.food_item_translations','public.food_category_translations','public.food_type_translations','public.venue_translations','public.session_translations','public.event_translations','public.translation_overrides','app_private.invitation_code_registry']::text[]
$$;


--
-- Name: check_primary_guest(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.check_primary_guest() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF NEW.primary_guest_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.guests g JOIN public.households source ON source.id=g.household_id
  WHERE g.id=NEW.primary_guest_id AND NOT g.is_child AND g.archived_at IS NULL AND source.archived_at IS NULL
 ) THEN RAISE EXCEPTION 'Choose an active non-child guest from an active household';END IF;
 RETURN NEW;
END $$;


--
-- Name: clear_archived_household_primary_contact(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.clear_archived_household_primary_contact() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF NEW.archived_at IS NOT NULL THEN NEW.is_household_primary:=NULL;END IF;
 RETURN NEW;
END $$;


--
-- Name: clear_archived_household_primary_guests(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.clear_archived_household_primary_guests() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 UPDATE public.households target SET primary_guest_id=NULL
 FROM public.guests guest WHERE guest.household_id=NEW.id AND target.primary_guest_id=guest.id;
 RETURN NEW;
END $$;


--
-- Name: clear_ineligible_primary_guest(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.clear_ineligible_primary_guest() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF NEW.is_child OR NEW.archived_at IS NOT NULL OR EXISTS(
  SELECT 1 FROM public.households WHERE id=NEW.household_id AND archived_at IS NOT NULL
 ) THEN
  UPDATE public.households SET primary_guest_id=NULL WHERE primary_guest_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: food_venue_eligible(uuid, uuid[]); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.food_venue_eligible(p_household uuid, p_venues uuid[]) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 SELECT p_venues IS NULL OR EXISTS (
  SELECT 1 FROM public.effective_session_invitations i
  JOIN public.event_sessions s ON s.id=i.session_id
  JOIN public.event_locations v ON v.id=s.location_id AND v.archived_at IS NULL
  WHERE i.household_id=p_household AND s.location_id=ANY(p_venues)
 )
$$;


--
-- Name: guard_empty_invitation_code(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_empty_invitation_code() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.invite_code:=NULL;
 ELSIF NEW.invite_code IS NOT NULL AND (NEW.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=NEW.id AND archived_at IS NULL)) THEN NEW.invite_code:=NULL;
 END IF;RETURN NEW;
END $$;


--
-- Name: guard_food_capacity(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_food_capacity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF NEW.quantity_needed<(SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=NEW.id) THEN RAISE EXCEPTION 'Amount cannot be less than existing claims';END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_food_category_tree(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_food_category_tree() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN PERFORM app_private.validate_food_category_tree(coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM public.food_categories c),'[]'));RETURN NEW;END $$;


--
-- Name: guard_food_group_change(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_food_group_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF OLD.food_group_id IS DISTINCT FROM NEW.food_group_id AND EXISTS(
  SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id
  WHERE f.id=NEW.id OR f.food_group_id=OLD.food_group_id OR f.food_group_id=NEW.food_group_id
 ) THEN RAISE EXCEPTION 'Resolve existing commitments before changing a Food Group';END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_guest_customization(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_guest_customization() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND (OLD.guest_background IS DISTINCT FROM NEW.guest_background OR OLD.guest_design IS DISTINCT FROM NEW.guest_design) THEN RAISE EXCEPTION 'Use the guest customization editor.' USING ERRCODE='42501';END IF;RETURN NEW;
END $$;


--
-- Name: guard_household_planning_group(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_household_planning_group() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.event_settings e
  CROSS JOIN LATERAL jsonb_array_elements(e.planning_config->'groups') g
  WHERE e.id=1 AND g->>'id'=NEW.planning_group_id) THEN
  RAISE EXCEPTION 'Choose an existing household group.';
 END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_item_archive_column(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_item_archive_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN RAISE EXCEPTION 'Use the item archive or restore action' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_language_preferences(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_language_preferences() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM 1 FROM public.event_languages WHERE language_code IN(NEW.default_language,NEW.fallback_language) ORDER BY language_code FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=NEW.default_language AND enabled)
 OR NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=NEW.fallback_language AND enabled) THEN
 RAISE EXCEPTION 'Default and fallback languages must be enabled';END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_language_removal(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_language_removal() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Disable languages instead of deleting their translations';END IF;
 IF NEW.language_code IS DISTINCT FROM OLD.language_code THEN RAISE EXCEPTION 'Language codes cannot be renamed';END IF;
 IF NOT NEW.enabled AND EXISTS(SELECT 1 FROM public.event_settings WHERE default_language=OLD.language_code OR fallback_language=OLD.language_code) THEN RAISE EXCEPTION 'Choose another default and fallback before disabling this language';END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_management_parent(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_management_parent() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL AND NEW.archived_at IS NULL AND NOT EXISTS(
 SELECT 1 FROM public.households p WHERE p.id=NEW.parent_id AND p.archived_at IS NULL
 AND p.planning_group_id=NEW.planning_group_id AND p.relation_group_id IS NOT DISTINCT FROM NEW.relation_group_id
 ) THEN RAISE EXCEPTION 'Parent must be active and in the same top-level group and relation group'; END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_notification_preferences(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_notification_preferences() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND OLD.notification_preferences IS DISTINCT FROM NEW.notification_preferences THEN RAISE EXCEPTION 'Use the status message settings editor.' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_planning_group_removal(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_planning_group_removal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.households h WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.planning_config->'groups') g WHERE g->>'id'=h.planning_group_id)) THEN RAISE EXCEPTION 'Move households out of a group before removing it.';END IF;
 IF EXISTS(SELECT 1 FROM public.relation_groups r WHERE r.planning_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.planning_config->'groups') g WHERE g->>'id'=r.planning_group_id)) THEN RAISE EXCEPTION 'Delete empty relational groups before removing the top-level group.';END IF;
 RETURN NEW;
END $$;


--
-- Name: guard_profile_language(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_profile_language() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE code text;old_code text;
BEGIN
 code:=to_jsonb(NEW)->>TG_ARGV[0];IF TG_OP='UPDATE' THEN old_code:=to_jsonb(OLD)->>TG_ARGV[0];END IF;
 IF code IS NOT NULL AND code IS DISTINCT FROM old_code THEN PERFORM 1 FROM public.event_languages WHERE language_code=code FOR SHARE;END IF;
 IF code IS NOT NULL AND code IS DISTINCT FROM old_code AND NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=code AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language';END IF;RETURN NEW;
END $$;


--
-- Name: guard_relation_group_scope(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guard_relation_group_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF TG_TABLE_NAME='relation_groups' THEN
  IF TG_OP='DELETE' THEN
   IF EXISTS(SELECT 1 FROM public.households WHERE relation_group_id=OLD.id) THEN RAISE EXCEPTION 'Move households out of this relational group before deleting it.';END IF;
   RETURN OLD;
  END IF;
  IF NEW.planning_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_settings e CROSS JOIN LATERAL jsonb_array_elements(e.planning_config->'groups') g WHERE e.id=1 AND g->>'id'=NEW.planning_group_id) THEN RAISE EXCEPTION 'Choose an existing top-level group.';END IF;
  IF EXISTS(SELECT 1 FROM public.households h WHERE h.relation_group_id=NEW.id AND NEW.planning_group_id IS NOT NULL AND h.planning_group_id<>NEW.planning_group_id) THEN RAISE EXCEPTION 'Move households before changing the group scope.';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.relation_groups r WHERE r.id=NEW.relation_group_id AND r.planning_group_id IS NOT NULL AND r.planning_group_id<>NEW.planning_group_id) THEN RAISE EXCEPTION 'Choose a relational group within this top-level group.';END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: guest_customization_revision(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guest_customization_revision() RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('background',guest_background,'design',guest_design,'theme',guest_theme_default,'toggle',guest_theme_toggle)::text,'UTF8')),'hex') FROM public.event_settings WHERE id=1
$$;


--
-- Name: guest_event(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guest_event() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 SELECT jsonb_build_object('event',(to_jsonb(e)-'notification_preferences')||jsonb_build_object('notification_preferences',jsonb_build_object('guest',e.notification_preferences->'guest'),'food_interest_reply',coalesce((SELECT jsonb_object_agg(language_code,body) FROM public.message_templates WHERE template_key='food-interest-reply' AND channel='manual' AND is_active),'{}'),'food_interest_reply_fallback',coalesce((SELECT jsonb_object_agg(language_code,body) FROM public.message_templates WHERE template_key='food-interest-reply-no-deadline' AND channel='manual' AND is_active),'{}'))-'planning_config',
 'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order),'[]') FROM public.event_sessions s WHERE s.is_active),
 'locations',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order),'[]') FROM public.event_locations l WHERE l.archived_at IS NULL),
 'content',(SELECT coalesce(jsonb_object_agg(c.language_code,c.content_value),'{}') FROM public.event_content c WHERE c.content_key='welcome'),
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.event_content c WHERE c.content_key NOT LIKE 'ui:%' AND (e.food_enabled AND e.food_stage='selection' OR (c.content_key NOT LIKE 'food:%' AND c.content_key NOT LIKE 'food-category:%'))))
 FROM public.event_settings e WHERE e.id=1
$$;


--
-- Name: guest_event_for_household(uuid); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guest_event_for_household(p_household uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 WITH allowed_sessions AS (
 SELECT DISTINCT s.* FROM public.event_sessions s JOIN public.effective_session_invitations i ON i.session_id=s.id WHERE i.household_id=p_household AND s.is_active
 ), allowed_locations AS (SELECT l.* FROM public.event_locations l WHERE l.archived_at IS NULL AND l.id IN(SELECT location_id FROM allowed_sessions)), original AS (SELECT app_private.guest_event() j)
 SELECT j||jsonb_build_object(
 'sessions',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order,s.id) FROM allowed_sessions s),'[]'::jsonb),
 'locations',coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM allowed_locations l),'[]'::jsonb),
 'translations',coalesce((SELECT jsonb_agg(c) FROM jsonb_array_elements(j->'translations') c WHERE
 (c->>'content_key' NOT LIKE 'session:%' OR split_part(c->>'content_key',':',2) IN(SELECT id::text FROM allowed_sessions)) AND
 (c->>'content_key' NOT LIKE 'venue:%' OR split_part(c->>'content_key',':',2) IN(SELECT id::text FROM allowed_locations)) AND
 ((c->>'content_key' NOT LIKE 'food:%' AND c->>'content_key' NOT LIKE 'food-category:%') OR coalesce((SELECT food FROM public.households WHERE id=p_household),false))),'[]'::jsonb)) FROM original
$$;


--
-- Name: guest_food(uuid, boolean); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guest_food(v_household uuid, p_sample boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE result jsonb;
BEGIN
 result:=app_private.guest_food_base(v_household,p_sample);IF result IS NULL THEN RETURN NULL;END IF;
 result:=jsonb_set(result,'{items}',coalesce((SELECT jsonb_agg(j.value||jsonb_build_object('archived_at',f.archived_at) ORDER BY j.ordinality)
  FROM jsonb_array_elements(result->'items') WITH ORDINALITY j(value,ordinality) JOIN public.food_items f ON f.id=(j.value->>'id')::uuid
  WHERE f.archived_at IS NULL OR EXISTS(SELECT 1 FROM public.food_claims c WHERE c.food_item_id=f.id AND c.household_id=v_household)),'[]'::jsonb));
 result:=jsonb_set(result,'{groups}',coalesce((SELECT jsonb_agg(j.value||jsonb_build_object('archived_at',(SELECT max(f.archived_at) FROM public.food_items f WHERE f.food_group_id=(j.value->>'id')::uuid)) ORDER BY j.ordinality)
  FROM jsonb_array_elements(coalesce(result->'groups','[]'::jsonb)) WITH ORDINALITY j(value,ordinality)
  WHERE NOT EXISTS(SELECT 1 FROM public.food_items f WHERE f.food_group_id=(j.value->>'id')::uuid AND f.archived_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE f.food_group_id=(j.value->>'id')::uuid AND c.household_id=v_household)),'[]'::jsonb));
 result:=jsonb_set(result,'{categories}',coalesce((SELECT jsonb_agg(j.value||jsonb_build_object('parent_id',c.parent_id,'sort_order',c.sort_order) ORDER BY j.ordinality) FROM jsonb_array_elements(coalesce(result->'categories','[]')) WITH ORDINALITY j(value,ordinality) JOIN public.food_categories c ON c.id=(j.value->>'id')::uuid),'[]')); RETURN result;
END $$;


--
-- Name: guest_food_base(uuid, boolean); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guest_food_base(v_household uuid, p_sample boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE v_result jsonb;
BEGIN IF NOT coalesce((SELECT food_enabled FROM public.event_settings WHERE id=1),false) THEN RETURN NULL;END IF;
 IF (SELECT food_stage FROM public.event_settings WHERE id=1)='interest' THEN RETURN jsonb_build_object('stage','interest','interest',(SELECT food_interest FROM public.households WHERE id=v_household),'items','[]'::jsonb,'claims','[]'::jsonb,'groups','[]'::jsonb,'categories','[]'::jsonb,'confirmed',false);END IF;
 IF NOT p_sample AND NOT coalesce((SELECT food FROM public.households WHERE id=v_household),false) THEN RETURN jsonb_build_object('stage','selection','interest',(SELECT food_interest FROM public.households WHERE id=v_household),'items','[]'::jsonb,'claims','[]'::jsonb,'groups','[]'::jsonb,'categories','[]'::jsonb,'confirmed',false);END IF;
 SELECT jsonb_build_object(
 'categories',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY sort_order,name) FROM public.food_categories),'[]'::jsonb),'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'translations',g.translations,'category',g.category,'item_ids',(SELECT jsonb_agg(id ORDER BY id) FROM public.food_items WHERE food_group_id=g.id))) FROM public.food_groups g WHERE EXISTS(SELECT 1 FROM public.food_items WHERE food_group_id=g.id) AND (NOT EXISTS(SELECT 1 FROM public.food_items f WHERE f.food_group_id=g.id AND (NOT f.active OR NOT app_private.food_venue_eligible(v_household,f.venue_ids))) OR EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE f.food_group_id=g.id AND c.household_id=v_household))),'[]'::jsonb),'confirmed',coalesce((SELECT food_confirmed FROM public.households WHERE id=v_household),false),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'food_group_id',f.food_group_id,'recipe_text',f.recipe_text,'quantity_type',f.quantity_type,
   'name_fo',translation_fo.name,'name_en',f.name_en,'name_de',translation_de.name,
   'description_fo',translation_fo.user_comment,'description_en',f.description_en,'description_de',translation_de.user_comment,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_en),f.id)
   FROM public.food_items f
   LEFT JOIN public.food_item_translations translation_fo ON translation_fo.food_item_id=f.id AND translation_fo.language_code='fo'
   LEFT JOIN public.food_item_translations translation_de ON translation_de.food_item_id=f.id AND translation_de.language_code='de'
   LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND (app_private.food_venue_eligible(v_household,f.venue_ids) OR (p_sample AND EXISTS (
     SELECT 1 FROM public.event_sessions s JOIN public.event_locations v ON v.id=s.location_id
     WHERE s.is_active AND v.archived_at IS NULL AND v.id=ANY(f.venue_ids)
   ))) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result || jsonb_build_object('stage','selection','interest',(SELECT food_interest FROM public.households WHERE id=v_household));
END $$;


SET LOCAL default_tablespace = '';

SET LOCAL default_table_access_method = heap;

--
-- Name: households; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.households (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_name text NOT NULL,
    planning_group_id text NOT NULL,
    language text DEFAULT 'fo'::text NOT NULL,
    phone text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    invite_code text,
    relation_group_id uuid,
    parent_id uuid,
    sort_order integer DEFAULT 0 NOT NULL,
    food boolean DEFAULT false NOT NULL,
    visited boolean DEFAULT false NOT NULL,
    visited_at timestamp with time zone,
    last_name text,
    food_confirmed boolean DEFAULT false NOT NULL,
    food_confirmed_at timestamp with time zone,
    rsvp_state text DEFAULT 'open'::text NOT NULL,
    rsvp_submitted_at timestamp with time zone,
    latest_rsvp_submission_id uuid,
    late_submission_until timestamp with time zone,
    archived_at timestamp with time zone,
    postal_address text,
    primary_guest_id uuid,
    food_interest boolean,
    CONSTRAINT household_no_self_parent CHECK ((parent_id IS DISTINCT FROM id)),
    CONSTRAINT households_invite_code_check CHECK ((invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'::text)),
    CONSTRAINT households_planning_group_id_check CHECK ((planning_group_id ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT households_rsvp_state_check CHECK ((rsvp_state = ANY (ARRAY['open'::text, 'locked'::text])))
);


--
-- Name: guest_invitation(public.households); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.guest_invitation(h public.households) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 SELECT jsonb_build_object('household',jsonb_build_object('id',h.id,'name',h.household_name,'language',h.language,'rsvp_state',h.rsvp_state,'rsvp_comment',(SELECT comment FROM public.rsvp_submissions WHERE id=h.latest_rsvp_submission_id AND household_id=h.id),'food_confirmed',h.food_confirmed,'can_add_guests',h.rsvp_state='open' AND NOT EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=h.id) AND (SELECT rsvp_deadline IS NULL OR clock_timestamp()<=rsvp_deadline OR clock_timestamp()<=h.late_submission_until FROM public.event_settings WHERE id=1)),'guests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'first_name',g.first_name,'last_name',g.last_name,'language',g.language,'is_child',g.is_child,'sort_order',g.sort_order,'courtesy_title',g.courtesy_title) ORDER BY g.is_child,g.sort_order NULLS LAST,lower(g.first_name),lower(coalesce(g.last_name,'')),g.id) FROM public.guests g WHERE g.archived_at IS NULL AND g.household_id=h.id),'[]'::jsonb),'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('guest_id',v.guest_id,'session_id',v.session_id,'requires_rsvp',v.requires_rsvp,'response',r.rsvp_status)) FROM public.effective_session_invitations v LEFT JOIN public.guest_session_responses r ON r.guest_id=v.guest_id AND r.session_id=v.session_id WHERE v.household_id=h.id),'[]'::jsonb))
$$;


--
-- Name: issue_codes_on_publication(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.issue_codes_on_publication() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE household_id uuid;
BEGIN
 FOR household_id IN SELECT h.id FROM public.households h
  WHERE h.archived_at IS NULL AND h.invite_code IS NULL AND EXISTS(
   SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL
  ) ORDER BY h.id
 LOOP
  PERFORM app_private.sync_invitation_code(household_id);
 END LOOP;
 RETURN NEW;
END $$;


--
-- Name: item_dependencies(text, uuid); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.item_dependencies(p_entity text, p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE target regclass; refs jsonb:='[]'; r record; found_link boolean;
BEGIN
 IF p_entity NOT IN ('food_items','other_items') OR p_entity IS NULL THEN RAISE EXCEPTION 'Invalid item type';END IF;
 target:=format('public.%I',p_entity)::regclass;
 IF p_entity='food_items' THEN
  IF EXISTS(SELECT 1 FROM public.food_items WHERE id=p_id AND food_group_id IS NOT NULL) THEN refs:=refs||'"group"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.management_audit WHERE entity_type='food_claims' AND (before_value->>'food_item_id'=p_id::text OR after_value->>'food_item_id'=p_id::text)) THEN refs:=refs||'"history"'::jsonb;END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.other_items WHERE id=p_id AND nullif(btrim(assigned_to),'') IS NOT NULL) THEN refs:=refs||'"assignment"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.other_items WHERE id=p_id AND status<>'open') THEN refs:=refs||'"progress"'::jsonb;END IF;
 END IF;
 -- Owned translations can be removed with their unused item. All other incoming
 -- references protect the item, even if a future FK happens to use CASCADE.
 FOR r IN SELECT c.conrelid::regclass AS source,a.attname AS column_name
  FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey,c.confkey) k(source_key,target_key)
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.source_key
  JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.target_key
  WHERE c.contype='f' AND c.confrelid=target AND b.attname='id'
    AND c.conrelid<>'public.food_item_translations'::regclass
 LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',r.source,r.column_name) INTO found_link USING p_id;
  IF found_link THEN refs:=refs||'"links"'::jsonb;EXIT;END IF;
 END LOOP;
 RETURN refs;
END $_$;


--
-- Name: lock_food_category_tree(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.lock_food_category_tree() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN PERFORM pg_advisory_xact_lock(19421,7745);RETURN NEW;END $$;


--
-- Name: lock_publication(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.lock_publication() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 RETURN NULL;
END $$;


--
-- Name: permission_preset(text); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.permission_preset(p text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 SELECT jsonb_build_object('preset',p,'sections',jsonb_build_object('venues',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'households',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'food',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'other',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'invites',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'languages',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'settings',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'administrators',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END),'sendInvites',p='full','exportBackup',p='full','restoreBackup',p='full','revokeSessions',p='full')
$$;


--
-- Name: project_backup(jsonb, text, text[], boolean); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.project_backup(b jsonb, mode text DEFAULT NULL::text, sections text[] DEFAULT NULL::text[], include_logs boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
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
END $$;


--
-- Name: require_admin_operation(text); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.require_admin_operation(op text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: require_food_selection_stage(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.require_food_selection_stage() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM 1 FROM public.event_settings WHERE id=1 AND food_stage='selection' AND food_enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The detailed food list is not open yet';END IF;
END $$;


--
-- Name: require_live_session(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.require_live_session() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF NOT app_private.session_is_live() THEN RAISE EXCEPTION 'Administrator session revoked or expired. Sign in again.' USING ERRCODE='PT401';END IF;RETURN auth.uid();
END $$;


--
-- Name: require_permission(text, text); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.require_permission(p_section text, p_level text DEFAULT 'view'::text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 IF NOT public.admin_has_permission(p_section,p_level) THEN RAISE EXCEPTION 'This action is not allowed by your administrator permissions.' USING ERRCODE='42501';END IF;
END $$;


--
-- Name: reset_invitation_access(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.reset_invitation_access() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 IF TG_OP='INSERT' OR (NEW.status='pending' AND OLD.status<>'pending') THEN INSERT INTO app_private.pending_admin_permissions(invitation_id,permissions) VALUES(NEW.id,app_private.permission_preset('view')) ON CONFLICT(invitation_id) DO UPDATE SET permissions=excluded.permissions;END IF;RETURN NEW;
END $$;


--
-- Name: restore_backup(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.restore_backup(b jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE t text;row jsonb;rows jsonb;payload jsonb:=b->'payload';report jsonb;has_rows boolean;cols text;fk record;source_id text;target_id uuid;identity jsonb;mapping jsonb:='{}';rec record;seq text;next_id bigint;changed integer:=0;
BEGIN
 report:=app_private.validate_backup(b);
 -- Validate reachability before loading rows with application triggers suspended.
 -- UNION deduplicates IDs: malformed cycles (including a branch pointing into a
 -- cycle) cannot make the older recursive parent trigger loop indefinitely.
 WITH RECURSIVE h AS (SELECT id,parent_id FROM jsonb_populate_recordset(NULL::public.households,payload->'tables'->'public.households')),
 reachable(id) AS (SELECT id FROM h WHERE parent_id IS NULL UNION SELECT h.id FROM h JOIN reachable p ON h.parent_id=p.id)
 SELECT (SELECT count(*) FROM h)<>(SELECT count(*) FROM reachable) INTO has_rows;
 IF has_rows THEN RAISE EXCEPTION 'Household hierarchy cycle, duplicate ID or missing parent';END IF;

 -- Consistent lock order, shared with existing management operations. Keep the event closed.
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',t);END LOOP;
 IF EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) THEN RAISE EXCEPTION 'Restore destination must be unpublished';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF t IN ('public.event_languages','public.event_settings') THEN CONTINUE;END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',t) INTO has_rows;
  IF has_rows THEN RAISE EXCEPTION 'Restore requires an empty application destination; % contains records',t;END IF;
 END LOOP;
 -- Map foreign-key actors by the original verified email, never by user-supplied privileges.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
    source_id:=row->>fk.attname;IF source_id IS NULL OR mapping ? source_id THEN CONTINUE;END IF;
    SELECT u INTO identity FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=source_id;
    IF identity IS NULL THEN RAISE EXCEPTION 'Missing actor identity metadata';END IF;
    SELECT id INTO target_id FROM auth.users WHERE lower(email)=lower(identity->>'email') AND email_confirmed_at IS NOT NULL;
    IF target_id IS NULL THEN RAISE EXCEPTION 'Recreate and verify the historical actor account % before restoring',identity->>'email';END IF;
    mapping:=mapping||jsonb_build_object(source_id,target_id);
   END LOOP;
  END LOOP;
 END LOOP;
 -- Disable only application triggers, transactionally, so imports do not regenerate
 -- invitation codes, create synthetic history, or reject valid out-of-order parents.
 -- Foreign keys, types, unique constraints and CHECK constraints stay enforced.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER',t);END LOOP;
 DELETE FROM public.event_settings WHERE id=1;
 DELETE FROM public.event_languages WHERE language_code IN (SELECT language_code FROM public.event_languages);
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  rows:='[]';
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
    source_id:=row->>fk.attname;IF source_id IS NOT NULL THEN row:=jsonb_set(row,ARRAY[fk.attname],mapping->source_id);END IF;
   END LOOP;
   IF t='public.admin_membership_audit' THEN FOREACH source_id IN ARRAY ARRAY['actor_id','subject_id'] LOOP IF mapping ? (row->>source_id) THEN row:=jsonb_set(row,ARRAY[source_id],mapping->(row->>source_id));END IF;END LOOP;END IF;
   IF t='public.households' THEN row:=row||'{"parent_id":null,"latest_rsvp_submission_id":null,"primary_guest_id":null}'::jsonb;END IF;

  IF t='public.event_settings' THEN row:=row||jsonb_build_object('is_published',false);END IF;

   IF t='public.admin_invitations' AND row->>'status'='pending' THEN row:=row||jsonb_build_object('status','cancelled','expires_at',clock_timestamp(),'attempt_id',gen_random_uuid());END IF;
   rows:=rows||jsonb_build_array(row);
  END LOOP;
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::%s,$1)',t,cols,cols,t) USING rows;
 END LOOP;
 -- Resolve circular household/submission references once every row exists.
 FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->'public.households') LOOP
  UPDATE public.households SET primary_guest_id=(row->>'primary_guest_id')::uuid,parent_id=(row->>'parent_id')::uuid,latest_rsvp_submission_id=(row->>'latest_rsvp_submission_id')::uuid WHERE id=(row->>'id')::uuid;
 END LOOP;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER',t);END LOOP;
 -- Re-run hierarchy and language guards without changing profile values or history.
 UPDATE public.households SET parent_id=parent_id WHERE id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(payload->'tables'->'public.households'));
 UPDATE public.event_settings SET default_language=default_language,fallback_language=fallback_language WHERE id=1;
 IF EXISTS(SELECT 1 FROM public.households h WHERE (h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)) AND h.invite_code IS NOT NULL) THEN RAISE EXCEPTION 'Backup contains an invalid invitation code assignment';END IF;
 IF EXISTS(SELECT 1 FROM public.households h WHERE h.invite_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_private.invitation_code_registry r WHERE r.code=h.invite_code AND r.household_id=h.id)) THEN RAISE EXCEPTION 'Invitation code registry mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE (SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=f.id)>f.quantity_needed) THEN RAISE EXCEPTION 'Food claims exceed available quantities';END IF;
 -- Restart identity sequences with transactional ALTER, not nontransactional setval.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR rec IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND attidentity<>'' LOOP
   seq:=pg_get_serial_sequence(t,rec.attname);EXECUTE format('SELECT coalesce(max(%I),0)+1 FROM %s',rec.attname,t) INTO next_id;
   EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
  END LOOP;
 END LOOP;
 INSERT INTO public.backup_restore_audit(actor_user_id,checksum,source_created_at,restored_counts) VALUES(auth.uid(),b->>'checksum',(payload->>'created_at')::timestamptz,payload->'counts');
 FOR identity IN SELECT value FROM jsonb_array_elements(coalesce(payload->'administrator_reference','[]'::jsonb)) LOOP
 SELECT u.id INTO target_id FROM auth.users u JOIN jsonb_array_elements(payload->'identities') i ON lower(i->>'email')=lower(u.email) WHERE i->>'id'=identity->>'user_id' AND u.email_confirmed_at IS NOT NULL;
 IF target_id IS NOT NULL THEN INSERT INTO public.admins(user_id,name,access_state,access_permissions) VALUES(target_id,left(coalesce(nullif(identity->>'name',''),'Restored administrator'),120),'restored',app_private.permission_preset('view')) ON CONFLICT(user_id) DO NOTHING;END IF;
 END LOOP;
 RETURN report||jsonb_build_object('restored',true,'is_published',false,'identity_mapping',mapping,'administrator_access_restored',false);
END $_$;


--
-- Name: save_food_selection(uuid, uuid, integer, text, integer); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.save_food_selection(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_notes text, p_expected_quantity integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE archived timestamptz; old_quantity integer;
BEGIN
 SELECT archived_at INTO archived FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 SELECT coalesce(max(quantity),0) INTO old_quantity FROM public.food_claims WHERE food_item_id=p_food_item_id AND household_id=p_household_id;
 IF archived IS NOT NULL AND p_quantity>old_quantity THEN RAISE EXCEPTION 'Food item unavailable';END IF;
 PERFORM app_private.save_food_selection_base(p_household_id,p_food_item_id,p_quantity,p_notes,p_expected_quantity);
END $$;


--
-- Name: save_food_selection_base(uuid, uuid, integer, text, integer); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.save_food_selection_base(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_notes text, p_expected_quantity integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE item public.food_items%ROWTYPE; old_quantity integer; claimed_total bigint;
BEGIN
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO item FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT item.active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0),coalesce(max(quantity) FILTER (WHERE household_id=p_household_id),0)
 INTO claimed_total,old_quantity FROM public.food_claims WHERE food_item_id=p_food_item_id;
 IF p_expected_quantity IS NOT NULL AND old_quantity<>p_expected_quantity THEN
   RAISE EXCEPTION 'Food selection changed; refresh and try again';
 END IF;
 IF p_quantity>old_quantity AND NOT app_private.food_venue_eligible(p_household_id,item.venue_ids) THEN
   RAISE EXCEPTION 'Food item unavailable at this household’s venues' USING ERRCODE='42501';
 END IF;
 IF claimed_total-old_quantity+p_quantity>item.quantity_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN
  DELETE FROM public.food_claims WHERE household_id=p_household_id AND food_item_id=p_food_item_id;
 ELSE
  INSERT INTO public.food_claims AS existing(food_item_id,household_id,quantity,notes)
   VALUES(p_food_item_id,p_household_id,p_quantity,p_notes)
   ON CONFLICT (food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,
    notes=CASE WHEN p_expected_quantity IS NULL THEN excluded.notes ELSE existing.notes END;
 END IF;
END $$;


--
-- Name: seal_backup(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.seal_backup(payload jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 SELECT jsonb_build_object('format','rsvp-application-backup','version',2,'payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'))
$$;


--
-- Name: select_backup(jsonb, text, text[], boolean); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.select_backup(b jsonb, mode text DEFAULT NULL::text, sections text[] DEFAULT NULL::text[], include_logs boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.validate_backup(b);
 RETURN app_private.project_backup(b,mode,sections,include_logs);
END $$;


--
-- Name: session_is_live(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.session_is_live() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE sid uuid;
BEGIN
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 RETURN auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=sid AND s.user_id=auth.uid() AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>statement_timestamp())) AND NOT EXISTS(SELECT 1 FROM app_private.admin_session_revocations r WHERE r.session_id=sid);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;


--
-- Name: store_translation(text, text, text); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.store_translation(p_key text, p_language text, p_value text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE parts text[]:=string_to_array(p_key,':'); target uuid; path text; field_name text; source_tokens text[]; value_tokens text[];
BEGIN
 IF p_key IS NULL OR length(p_key)>800 OR p_value IS NULL OR length(p_value)>12000 THEN RAISE EXCEPTION 'Invalid translation key or text'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language) THEN RAISE EXCEPTION 'Unknown language'; END IF;
 IF parts[1]='ui' AND length(substr(p_key,4))>0 THEN
  IF p_key LIKE 'ui:Food type: %' THEN
   field_name:=substr(p_key,15);
   IF NOT EXISTS(SELECT 1 FROM public.food_item_types WHERE name=field_name) THEN RAISE EXCEPTION 'Translation target not found'; END IF;
   IF p_language='en' THEN
    -- An English label override does not rename the unit identity referenced by food items.
    path:='types.custom.'||field_name;
   ELSE
    INSERT INTO public.food_type_translations(food_type_name,language_code,name,updated_by)
    VALUES(field_name,p_language,nullif(btrim(p_value),''),auth.uid())
    ON CONFLICT(food_type_name,language_code) DO UPDATE SET name=excluded.name,updated_at=now(),updated_by=excluded.updated_by;
    RETURN;
   END IF;
  ELSE path:=app_private.translation_keys()->>substr(p_key,4);
   IF path IS NULL THEN path:='interface.custom.'||md5(substr(p_key,4)); END IF;
  END IF;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO source_tokens FROM regexp_matches(substr(p_key,4),'\{([A-Za-z][A-Za-z0-9_]*)\}','g') m;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO value_tokens FROM regexp_matches(p_value,'\{([A-Za-z][A-Za-z0-9_]*)\}','g') m;
  IF btrim(p_value)<>'' AND source_tokens IS DISTINCT FROM value_tokens THEN RAISE EXCEPTION 'Keep the same placeholders as the original phrase'; END IF;
  IF btrim(p_value)='' THEN DELETE FROM public.translation_overrides WHERE translation_key=path AND language_code=p_language;
  ELSE INSERT INTO public.translation_overrides(translation_key,category,source_text,language_code,value,updated_by)
   VALUES(path,split_part(path,'.',1),substr(p_key,4),p_language,p_value,auth.uid())
   ON CONFLICT(translation_key,language_code) DO UPDATE SET value=excluded.value,updated_at=now(),updated_by=excluded.updated_by;
  END IF;
 ELSIF p_key IN ('welcome','invite') THEN
  field_name:=CASE p_key WHEN 'welcome' THEN 'introduction' ELSE 'invitation_message' END;
  IF p_language='en' THEN
   EXECUTE format('UPDATE public.event_settings SET %I=$1 WHERE id=1',field_name) USING p_value;
  ELSE
   EXECUTE format('INSERT INTO public.event_translations(event_id,language_code,%I,updated_by) VALUES(1,$1,$2,auth.uid()) ON CONFLICT(event_id,language_code) DO UPDATE SET %I=excluded.%I,updated_at=now(),updated_by=excluded.updated_by',field_name,field_name,field_name)
    USING p_language,nullif(btrim(p_value),'');
  END IF;
 ELSIF cardinality(parts)=3 AND parts[1] IN ('food','venue','session','food-category') AND parts[2] ~ '^[0-9a-f-]{36}$' THEN
  target:=parts[2]::uuid;
  IF parts[1]='food' AND parts[3] IN ('name','description') THEN
   IF p_language='en' THEN
    IF parts[3]='name' AND btrim(p_value)='' THEN RAISE EXCEPTION 'Name is required'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.food_items WHERE id=target) THEN RAISE EXCEPTION 'Translation target not found'; END IF;
    EXECUTE format('UPDATE public.food_items SET %I=$1 WHERE id=$2',parts[3]||'_en') USING p_value,target;
   ELSE
    field_name:=CASE parts[3] WHEN 'name' THEN 'name' ELSE 'user_comment' END;
    EXECUTE format('INSERT INTO public.food_item_translations(food_item_id,language_code,%I,updated_by) VALUES($1,$2,$3,auth.uid()) ON CONFLICT(food_item_id,language_code) DO UPDATE SET %I=excluded.%I,updated_at=now(),updated_by=excluded.updated_by',field_name,field_name,field_name) USING target,p_language,nullif(btrim(p_value),'');
   END IF;
  ELSIF parts[1]='venue' AND parts[3] IN ('welcome','name','notes') THEN
   field_name:=CASE parts[3] WHEN 'welcome' THEN 'welcome_message' WHEN 'notes' THEN 'guest_notes' ELSE 'name' END;
   IF p_language='en' THEN
    IF NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=target) THEN RAISE EXCEPTION 'Translation target not found'; END IF;
    EXECUTE format('UPDATE public.event_locations SET %I=$1 WHERE id=$2',CASE parts[3] WHEN 'welcome' THEN 'welcome_en' ELSE parts[3] END) USING nullif(btrim(p_value),''),target;
   ELSE
    EXECUTE format('INSERT INTO public.venue_translations(venue_id,language_code,%I,updated_by) VALUES($1,$2,$3,auth.uid()) ON CONFLICT(venue_id,language_code) DO UPDATE SET %I=excluded.%I,updated_at=now(),updated_by=excluded.updated_by',field_name,field_name,field_name) USING target,p_language,nullif(btrim(p_value),'');
   END IF;
  ELSIF parts[1]='session' AND parts[3] IN ('name','description') THEN
   IF p_language='en' THEN
    IF NOT EXISTS(SELECT 1 FROM public.event_sessions WHERE id=target) THEN RAISE EXCEPTION 'Translation target not found'; END IF;
    EXECUTE format('UPDATE public.event_sessions SET %I=$1 WHERE id=$2',parts[3]) USING p_value,target;
   ELSE
    EXECUTE format('INSERT INTO public.session_translations(session_id,language_code,%I,updated_by) VALUES($1,$2,$3,auth.uid()) ON CONFLICT(session_id,language_code) DO UPDATE SET %I=excluded.%I,updated_at=now(),updated_by=excluded.updated_by',parts[3],parts[3],parts[3]) USING target,p_language,nullif(btrim(p_value),'');
   END IF;
  ELSIF parts[1]='food-category' AND parts[3]='name' THEN
   IF p_language='en' THEN
    PERFORM public.admin_rename_food_category(target,p_value);
   ELSE
   INSERT INTO public.food_category_translations(food_category_id,language_code,name,updated_by) VALUES(target,p_language,nullif(btrim(p_value),''),auth.uid())
   ON CONFLICT(food_category_id,language_code) DO UPDATE SET name=excluded.name,updated_at=now(),updated_by=excluded.updated_by;
   END IF;
  ELSE RAISE EXCEPTION 'Invalid translation key'; END IF;
 ELSE RAISE EXCEPTION 'Invalid translation key'; END IF;
END $_$;


--
-- Name: sync_archived_invitation_code(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.sync_archived_invitation_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN PERFORM app_private.sync_invitation_code(NEW.id);RETURN NEW;END $$;


--
-- Name: sync_guest_invitation_codes(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.sync_guest_invitation_codes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 -- Lifecycle RPCs already lock households in UUID order. Cover trusted direct writes too.
 IF TG_OP='UPDATE' THEN
   PERFORM 1 FROM public.households WHERE id IN(OLD.household_id,NEW.household_id) ORDER BY id FOR UPDATE;
   IF OLD.household_id<>NEW.household_id THEN PERFORM app_private.sync_invitation_code(OLD.household_id); END IF;
 END IF;
 IF TG_OP='DELETE' THEN PERFORM app_private.sync_invitation_code(OLD.household_id);RETURN OLD; END IF;
 PERFORM app_private.sync_invitation_code(NEW.household_id);RETURN NEW;
END $$;


--
-- Name: sync_invitation_code(uuid); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.sync_invitation_code(p_household_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE; code text; bytes bytea; i integer;
BEGIN
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN
   UPDATE public.households SET invite_code=NULL WHERE id=h.id AND invite_code IS NOT NULL;
 ELSIF h.invite_code IS NULL AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN
   LOOP
     bytes:=decode(md5(gen_random_uuid()::text),'hex');code:='';
     FOR i IN 0..7 LOOP code:=code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+get_byte(bytes,i)%32,1); END LOOP;
     INSERT INTO app_private.invitation_code_registry VALUES(code,h.id,now()) ON CONFLICT DO NOTHING;
     EXIT WHEN FOUND;
   END LOOP;
   UPDATE public.households SET invite_code=code WHERE id=h.id;
 END IF;
END $$;


--
-- Name: table_section(text); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.table_section(t text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 SELECT CASE WHEN t IN ('households','guests','household_contacts','relation_groups','management_audit') THEN 'households' WHEN t IN ('event_locations','event_sessions','event_configuration_audit') THEN 'venues' WHEN t IN ('food_categories','food_items','food_claims','food_item_types') THEN 'food' WHEN t IN ('other_items','other_categories') THEN 'other' WHEN t IN ('event_languages','event_content','event_translations','translation_overrides','food_item_translations','food_category_translations','venue_translations','session_translations','food_type_translations') THEN 'languages' WHEN t IN ('event_settings') THEN 'settings' WHEN t IN ('rsvp_submissions','guest_session_responses','household_session_defaults','guest_session_overrides','invitation_send_queue','invitation_deliveries','invitation_delivery_audit','rsvp_household_audit','rsvp_response_audit','message_templates','invitation_access_audit') THEN 'invites' WHEN t IN ('admins','admin_membership_audit','admin_invitations','admin_invitation_audit','admin_session_audit') THEN 'administrators' ELSE 'full' END
$$;


--
-- Name: translation_keys(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.translation_keys() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$SELECT '{"Top-level group": "interface.messages.top_level_group", "Event planning": "interface.messages.event_planning", "Event preset": "interface.messages.event_preset", "Wedding": "interface.messages.event_preset_wedding", "Reunion": "interface.messages.event_preset_reunion", "Conference": "interface.messages.event_preset_conference", "Use preset suggestions": "interface.messages.event_apply_preset", "Preset suggestions add missing groups and fill blank labels. Review them before saving.": "interface.messages.event_preset_help", "Shared labels": "interface.messages.event_shared_labels", "Move group up": "interface.messages.event_move_group_up", "Move group down": "interface.messages.event_move_group_down", "Remove group": "interface.messages.event_remove_group", "Add group": "interface.messages.event_add_group", "Save planning settings": "interface.messages.event_save_planning", "Family": "interface.messages.event_group_family", "Friends": "interface.messages.event_group_friends", "Attendees": "interface.messages.event_group_attendees", "Speakers": "interface.messages.event_group_speakers", "Bookings": "interface.messages.event_label_bookings", "Participants": "interface.messages.event_label_participants", "Review RSVP": "interface.messages.rsvp_review", "Check the answers for each guest and session. Confirming locks the RSVP.": "interface.messages.rsvp_review_help", "Confirm RSVP": "interface.messages.rsvp_confirm", "Back to edit": "interface.messages.rsvp_back_to_edit", "Apply to everyone invited": "interface.messages.rsvp_apply_to_everyone", "Fills unanswered choices only.": "interface.messages.rsvp_fill_unanswered_only", "Enable access": "interface.messages.access_enable_access", "Suspend access": "interface.messages.access_suspend_access", "Revoke session": "interface.messages.access_revoke_session", "Session refreshed": "interface.messages.access_session_refreshed", "{browser} on {device}": "interface.messages.access_session_browser_device", "Apple device": "interface.messages.access_session_apple_device", "Session refreshed shows when the sign-in session last renewed. Revocation ends access to this application. Everyone can revoke their own sessions.": "interface.messages.access_session_refresh_help", "Permanently delete {name}?": "interface.messages.confirm_delete_named_record", "Remove assignment for {household}": "interface.messages.remove_named_assignment", "Remove {household}’s assignment for {item}?": "interface.messages.confirm_remove_food_assignment", "Show to guests": "interface.messages.show_to_guests", "Hide from guests": "interface.messages.hide_from_guests", "Hidden from guests": "interface.messages.hidden_from_guests", "(preview)": "interface.messages.preview_marker", "Unpublished · Guest preview only": "interface.messages.unpublished_preview_only", "Invitation delivery opens when the event is published.": "interface.messages.delivery_requires_publication", "Delete household": "interface.messages.delete_household", "Delete guest": "interface.messages.delete_guest", "Permanently delete this record?": "interface.messages.confirm_delete_record", "Record deleted.": "interface.messages.record_deleted", "Choose a record that can be deleted.": "interface.messages.choose_deletable_record", "Move or delete guests and child households first.": "interface.messages.delete_move_dependents", "Remove this guest’s household contact assignments first.": "interface.messages.delete_remove_contact_assignments", "Restore mode": "interface.messages.restore_mode", "Full backup": "interface.messages.restore_full_backup", "Planning template": "interface.messages.restore_planning_template", "Include in template": "interface.messages.restore_template_include", "Event settings and languages are always included. Invitation codes, replies, food commitments, delivery history and administrator records are cleared.": "interface.messages.restore_template_info", "Wording & invitation templates": "interface.messages.restore_template_wording", "Guest preview": "interface.messages.guest_preview", "Test changes stay in this tab and are discarded when you close or reload it.": "interface.messages.guest_preview_discard", "Preview as": "interface.messages.guest_preview_as", "Copy preview link": "interface.messages.guest_preview_copy", "Sign in to preview": "interface.messages.guest_preview_sign_in", "Preview link": "interface.messages.guest_preview_link", "Preview link copied.": "interface.messages.guest_preview_copied", "Sign in with an administrator account to open this preview.": "interface.messages.guest_preview_login_required", "Guest preview requires access to Households, Invites, Venues and Food.": "interface.messages.guest_preview_access", "Guest landing page": "interface.messages.guest_preview_landing", "Sample household": "interface.messages.guest_preview_sample", "Preview response confirmed.": "interface.messages.guest_preview_response", "Preview food selection updated.": "interface.messages.guest_preview_food_updated", "Preview food selection confirmed.": "interface.messages.guest_preview_food_confirmed", "Templates": "interface.messages.templates", "Invitation templates": "interface.messages.invitation_templates", "Set the starting wording for new invitation drafts by language and delivery channel.": "interface.messages.invitation_templates_description", "No custom template. New drafts use fallback wording.": "interface.messages.invitation_template_fallback", "Include the invitation link placeholder. Clear the fields to use fallback wording.": "interface.messages.invitation_template_help", "Save template": "interface.messages.save_invitation_template", "Include the invitation link placeholder in the message.": "interface.messages.invitation_template_link_required", "The invitation template contains an unknown placeholder.": "interface.messages.invitation_template_unknown_placeholder", "Back to households": "interface.messages.back_to_households", "Administration": "interface.messages.administration", "Admin": "interface.messages.admin", "Event Invitation": "interface.messages.event_invitation", "Event dashboard": "interface.messages.event_dashboard", "Appearance": "interface.messages.appearance", "Appearance preference": "interface.messages.appearance_preference", "System default": "interface.messages.system_default", "Light": "interface.messages.light", "Dark": "interface.messages.dark", "Language": "interface.messages.language", "Faroese": "interface.messages.faroese", "English": "interface.messages.english", "German": "interface.messages.german", "Settings": "interface.messages.settings", "Settings sections": "interface.messages.settings_sections", "Main settings": "interface.messages.main_settings", "Event settings": "interface.messages.event_settings", "Administrators": "interface.messages.administrators", "Administrator": "interface.messages.administrator", "Administrator actions": "interface.messages.administrator_actions", "Admin sections": "interface.messages.admin_sections", "Overview": "interface.messages.overview", "Households": "interface.messages.households", "Guests": "interface.messages.guests", "Manage Invites": "interface.messages.manage_invites", "Venues": "interface.messages.venues", "Sessions": "interface.messages.sessions", "Sessions & scheduling": "interface.messages.sessions_scheduling", "Logs": "interface.messages.logs", "Back": "interface.messages.back", "Back to dashboard": "interface.messages.back_to_dashboard", "View website in a new tab": "interface.messages.view_website_in_a_new_tab", "Refresh data": "interface.messages.refresh_data", "Sign out": "interface.messages.sign_out", "Sign in": "interface.messages.sign_in", "Email": "interface.messages.email", "Password": "interface.messages.password", "PRIVATE ADMINISTRATION": "interface.messages.private_administration", "Welcome back.": "interface.messages.welcome_back", "Only approved event administrators can sign in.": "interface.messages.only_approved_event_administrators_can_sign_in", "Setup wizard": "interface.messages.setup_wizard", "New password": "interface.messages.new_password", "Confirm password": "interface.messages.confirm_password", "You’re invited.": "interface.messages.you_re_invited", "Accept administrator invitation": "interface.messages.accept_administrator_invitation", "Accepting invitation…": "interface.messages.accepting_invitation", "Accepting gives you access to this event’s households, guests, invitations and settings.": "interface.messages.accepting_gives_you_access_to_this_event_s_households_guests_invi", "Set a password of at least 12 characters for future sign-ins.": "interface.messages.set_a_password_of_at_least_12_characters_for_future_sign_ins", "Event name": "interface.messages.event_name", "Type": "interface.messages.type", "Date": "interface.messages.date", "Default language": "interface.messages.default_language", "Timezone": "interface.messages.timezone", "Website URL": "interface.messages.website_url", "RSVP deadline (local browser time)": "interface.messages.rsvp_deadline_local_browser_time", "Save settings": "interface.messages.save_settings", "Publish event": "interface.messages.publish_event", "Unpublish event": "interface.messages.unpublish_event", "Event is published: invited guests can access RSVP. You can unpublish it below.": "interface.messages.event_is_published_invited_guests_can_access_rsvp_you_can_unpubli", "Use View mode to inspect configuration and Edit mode to make changes. Publication controls are below.": "interface.messages.use_view_mode_to_inspect_configuration_and_edit_mode_to_make_chan", "Publishing makes the guest RSVP experience available. The website can be online while the event is unpublished. Complete access-control and invite-code release tests before publishing.": "interface.messages.publishing_makes_the_guest_rsvp_experience_available_the_website_", "I understand the release checks are my responsibility and this will open the event to invited guests.": "interface.messages.i_understand_the_release_checks_are_my_responsibility_and_this_wi", "Manage event details and administrator access.": "interface.messages.manage_event_details_and_administrator_access", "Manage locations, addresses and local timezones. Guests can attend sessions at more than one venue.": "interface.messages.manage_locations_addresses_and_local_timezones_guests_can_attend_", "Set each session’s venue and local times. Use Manage Invites for household invitations and individual exceptions.": "interface.messages.set_each_session_s_venue_and_local_times_use_manage_invites_for_h", "Invite trusted people to help manage this event. Access starts after they verify their email and accept.": "interface.messages.invite_trusted_people_to_help_manage_this_event_access_starts_aft", "Invite administrator": "interface.messages.invite_administrator", "Open Supabase Auth": "interface.messages.open_supabase_auth", "Display name": "interface.messages.display_name", "Send invitation": "interface.messages.send_invitation", "Pending invitations": "interface.messages.pending_invitations", "An email will be sent to this address. The recipient must accept within 7 days; email sign-in links may expire sooner.": "interface.messages.an_email_will_be_sent_to_this_address_the_recipient_must_accept_w", "Resend": "interface.messages.resend", "Cancel": "interface.messages.cancel", "Awaiting acceptance": "interface.messages.awaiting_acceptance", "No pending invitations.": "interface.messages.no_pending_invitations", "Sending invitation…": "interface.messages.sending_invitation", "Administrator invitation email sent.": "interface.messages.administrator_invitation_email_sent", "Administrator invitation cancelled.": "interface.messages.administrator_invitation_cancelled", "Administrator invitation accepted.": "interface.messages.administrator_invitation_accepted", "Revoke administrator access": "interface.messages.revoke_administrator_access", "Administrator access revoked.": "interface.messages.administrator_access_revoked", "You cannot remove the last administrator.": "interface.messages.you_cannot_remove_the_last_administrator", "Search": "interface.messages.search", "Category": "interface.messages.category", "Action": "interface.messages.action", "From": "interface.messages.from", "Through": "interface.messages.through", "All categories": "interface.messages.all_categories", "All actions": "interface.messages.all_actions", "Search logs": "interface.messages.search_logs", "Reset": "interface.messages.reset", "Load older entries": "interface.messages.load_older_entries", "Search recorded changes, RSVP activity, invitation delivery and administrator sessions.": "interface.messages.search_recorded_changes_rsvp_activity_invitation_delivery_and_adm", "Household, guest, administrator or change": "interface.messages.household_guest_administrator_or_change", "Contacts": "interface.messages.contacts", "Invitations": "interface.messages.invitations", "Login": "interface.messages.login", "Loading logs…": "interface.messages.loading_logs", "No log entries match these filters.": "interface.messages.no_log_entries_match_these_filters", "Field": "interface.messages.field", "Before": "interface.messages.before", "After": "interface.messages.after", "Reference: ": "interface.messages.reference", "Showing ": "interface.messages.showing", "Date filters use the event timezone. Entries show your local time. Expand an entry for its UTC time and details. Household and guest archive, restore and deletion are logged.": "interface.messages.date_filters_use_the_event_timezone_entries_show_your_local_time_", "Existing history is included. New sign-in and invitation-opening records start with this update. Repeated opens within 15 minutes are grouped.": "interface.messages.existing_history_is_included_new_sign_in_and_invitation_opening_r", "Launch checklist": "interface.messages.launch_checklist", "Check all release requirements before using Settings → Event settings → Publish event.": "interface.messages.check_all_release_requirements_before_using_settings_event_settin", "Admin account connected": "interface.messages.admin_account_connected", "Event name and date entered": "interface.messages.event_name_and_date_entered", "At least one session created": "interface.messages.at_least_one_session_created", "Invitations assigned": "interface.messages.invitations_assigned", "Website connection in deployed config.js": "interface.messages.website_connection_in_deployed_config_js", "Website address saved in event settings": "interface.messages.website_address_saved_in_event_settings", "Event published": "interface.messages.event_published", "New RSVP submissions": "interface.messages.new_rsvp_submissions", "Add household": "interface.messages.add_household", "Add guest": "interface.messages.add_guest", "Add Contact": "interface.messages.add_contact", "OR": "interface.messages.contact_alternative_or", "From your household": "interface.messages.primary_contact_from_household", "From guest list": "interface.messages.primary_contact_from_guest_list", "New contact": "interface.messages.primary_contact_new", "Matching contact details required": "interface.messages.matching_contact_details_required", "No household contacts to choose from.": "interface.messages.no_household_contact_choices", "Use Email with an email address, or SMS or WhatsApp with a phone number.": "interface.messages.primary_contact_delivery_help", "Edit primary contact": "interface.messages.edit_primary_contact", "Remove primary contact": "interface.messages.remove_primary_contact", "Choose a saved contact": "interface.messages.choose_saved_contact", "Use contact": "interface.messages.use_contact", "Add venue": "interface.messages.add_venue", "Add session": "interface.messages.add_session", "Add category": "interface.messages.add_category", "Household or guest": "interface.messages.household_or_guest", "Show archived records": "interface.messages.show_archived_records", "⌄ Expand all": "interface.messages.expand_all", "› Collapse all": "interface.messages.collapse_all", "Click a household to expand its individual guests. Select the top-right pencil to enable editing; each guest then has a pencil for their details. Parent–child household nesting is preserved.": "interface.messages.click_a_household_to_expand_its_individual_guests_select_the_top_", "Empty households have no invitation code. Add a guest, then use Manage Invites. Assign sessions in Settings.": "interface.messages.empty_households_have_no_invitation_code_add_a_guest_then_use_man", "Household name": "interface.messages.household_name", "Household language": "interface.messages.household_language", "Household email": "interface.messages.household_email", "Household phone": "interface.messages.household_phone", "Landline": "interface.messages.household_landline", "Household notes": "interface.messages.household_notes", "Household details": "interface.messages.household_details", "Household contact details": "interface.messages.household_contact_details", "Household default": "interface.messages.household_default", "Parent household": "interface.messages.parent_household", "Child households": "interface.messages.child_households", "Grouping household": "interface.messages.grouping_household", "None (top level)": "interface.messages.none_top_level", "Relation group": "interface.messages.relation_group", "Relation": "interface.messages.relation", "Notes": "interface.messages.notes", "Phone": "interface.messages.phone", "Postal address": "interface.messages.postal_address", "Preferred contact": "interface.messages.preferred_contact", "Preferred contact method": "interface.messages.preferred_contact_method", "Preferred delivery method": "interface.messages.preferred_delivery_method", "First name": "interface.messages.first_name", "Last name": "interface.messages.last_name", "Title": "interface.messages.title", "None": "interface.messages.none", "Son": "interface.messages.son", "Daughter": "interface.messages.daughter", "Child": "interface.messages.child", "Child guest": "interface.messages.child_guest", "Dietary requirements": "interface.messages.dietary_requirements", "Individual guests": "interface.messages.individual_guests", "Unnamed guest": "interface.messages.unnamed_guest", "Unnamed household": "interface.messages.unnamed_household", "Ungrouped": "interface.messages.ungrouped", "No matching households.": "interface.messages.no_matching_households", "No guests assigned to this household.": "interface.messages.no_guests_assigned_to_this_household", "No active guests match this search.": "interface.messages.no_active_guests_match_this_search", "Search guests": "interface.messages.search_guests", "Guest name or household": "interface.messages.guest_name_or_household", "Guest": "interface.messages.guest", "Save household": "interface.messages.save_household", "Create household": "interface.messages.create_household", "Save guest": "interface.messages.save_guest", "Move guest": "interface.messages.move_guest", "Destination household": "interface.messages.destination_household", "Choose household": "interface.messages.choose_household", "Move household up": "interface.messages.move_household_up", "Move household down": "interface.messages.move_household_down", "New guests inherit this household’s session invitations.": "interface.messages.new_guests_inherit_this_household_s_session_invitations", "RSVP status and household assignment are not changed by editing guest details.": "interface.messages.rsvp_status_and_household_assignment_are_not_changed_by_editing_g", "Current session invitations are preserved as individual overrides. Moves involving RSVP history are blocked.": "interface.messages.current_session_invitations_are_preserved_as_individual_overrides", "Move this guest and preserve their current session invitations?": "interface.messages.move_this_guest_and_preserve_their_current_session_invitations", "Grouping changes with child households require moving the children first.": "interface.messages.grouping_changes_with_child_households_require_moving_the_childre", "First name is required.": "interface.messages.first_name_is_required", "Guest details saved.": "interface.messages.guest_details_saved", "Changes saved.": "interface.messages.changes_saved", "Household order saved.": "interface.messages.household_order_saved", "Edit": "interface.messages.edit", "Delete": "interface.messages.delete", "Delete archived household": "interface.messages.delete_archived_household", "Delete archived guest": "interface.messages.delete_archived_guest", "Permanently delete this archived record?": "interface.messages.confirm_delete_archived_record", "Archived record deleted.": "interface.messages.archived_record_deleted", "This record is linked to other records or history and must stay archived": "interface.messages.archived_record_linked", "Rename": "interface.messages.rename", "Archive ": "interface.messages.archive", "Restore ": "interface.messages.restore", "Edit guest: ": "interface.messages.edit_guest", "Edit household: ": "interface.messages.edit_household", "Select guest: ": "interface.messages.select_guest", "Edit contact: ": "interface.messages.edit_contact", "Archive this household and disable its invitation link? Records and history are preserved.": "interface.messages.archive_this_household_and_disable_its_invitation_link_records_an", "Archive this record? It can be restored later.": "interface.messages.archive_this_record_it_can_be_restored_later", "Restore this record?": "interface.messages.restore_this_record", "Record archived.": "interface.messages.record_archived", "Record restored.": "interface.messages.record_restored", "Contact": "interface.messages.contact", "Contact name": "interface.messages.contact_name", "Contact type": "interface.messages.contact_type", "Contact details": "interface.messages.contact_details", "Contact language": "interface.messages.contact_language", "Linked guest": "interface.messages.linked_guest", "Remove guest link": "interface.messages.remove_guest_link", "Primary": "interface.messages.primary", "Primary contact for this type": "interface.messages.primary_contact_for_this_type", "Save contact": "interface.messages.save_contact", "Create contact": "interface.messages.create_contact", "No contacts added yet.": "interface.messages.no_contacts_added_yet", "Choose someone from the guest list": "interface.messages.choose_someone_from_the_guest_list", "Choose a guest or enter a new contact below. Guest selection fills the name, language and household’s preferred delivery method and contact details. Review them before saving.": "interface.messages.choose_a_guest_or_enter_a_new_contact_below_guest_selection_fills", "Private codes and links for households with guests. Sending remains manual.": "interface.messages.private_codes_and_links_for_households_with_guests_sending_remain", "Search invitations": "interface.messages.search_invitations", "Invitation code": "interface.messages.invitation_code", "Copy invitation link": "interface.messages.copy_invitation_link", "Link": "interface.messages.invite_copy_link_short", "Copy invite code": "interface.messages.copy_invite_code", "Copy link": "interface.messages.copy_link", "Copy message": "interface.messages.copy_message", "Invitation code copied.": "interface.messages.invitation_code_copied", "Invitation link copied.": "interface.messages.invitation_link_copied", "Message copied.": "interface.messages.message_copied", "No matching invitations. Empty and archived households have no active invitation.": "interface.messages.no_matching_invitations_empty_and_archived_households_have_no_act", "Delivery log": "interface.messages.delivery_log", "Invitation delivery": "interface.messages.invitation_delivery", "Filter delivery status": "interface.messages.filter_delivery_status", "All statuses": "interface.messages.all_statuses", "Draft": "interface.messages.draft", "Ready": "interface.messages.ready", "Ready to send": "interface.messages.ready_to_send", "Failed": "interface.messages.failed", "Cancelled": "interface.messages.cancelled", "Recorded sent": "interface.messages.recorded_sent", "No deliveries match this status.": "interface.messages.no_deliveries_match_this_status", "No delivery recorded yet.": "interface.messages.no_delivery_recorded_yet", "Prepare delivery": "interface.messages.prepare_delivery", "Delivery channel": "interface.messages.delivery_channel", "Delivery recipient": "interface.messages.delivery_recipient", "Delivery status": "interface.messages.delivery_status", "Message subject": "interface.messages.message_subject", "Message text": "interface.messages.message_text", "Delivery change note": "interface.messages.delivery_change_note", "Create delivery draft": "interface.messages.create_delivery_draft", "Save delivery changes": "interface.messages.save_delivery_changes", "Edit delivery": "interface.messages.edit_delivery", "Record as sent": "interface.messages.record_as_sent", "Sent note": "interface.messages.sent_note", "I sent this message to the displayed recipient": "interface.messages.i_sent_this_message_to_the_displayed_recipient", "Manual": "interface.messages.manual", "Manual / in person": "interface.messages.manual_in_person", "Postal": "interface.messages.postal", "Other": "interface.messages.other", "Recipient: ": "interface.messages.recipient", "To: ": "interface.messages.to", "Manually recorded as sent · ": "interface.messages.manually_recorded_as_sent", "Missing — add contact details before marking ready.": "interface.messages.missing_add_contact_details_before_marking_ready", "Saving a draft or marking it ready does not send a message. Review the recipient and text, send it yourself, then record it as sent.": "interface.messages.saving_a_draft_or_marking_it_ready_does_not_send_a_message_review", "RSVP management": "interface.messages.rsvp_management", "Remove assignment": "interface.messages.remove_assignment", "Unsaved": "interface.messages.unsaved", "RSVP": "interface.messages.rsvp_action", "Locked": "interface.messages.rsvp_locked", "Current response": "interface.messages.current_response", "Choose response": "interface.messages.choose_response", "Corrected response": "interface.messages.corrected_response", "Correct response: ": "interface.messages.correct_response", "Attending": "interface.messages.attending", "Not attending": "interface.messages.not_attending", "Pending": "interface.messages.pending", "RSVP required": "interface.messages.rsvp_required", "Information only": "interface.messages.information_only", "Locked after submission": "interface.messages.locked_after_submission", "Open for responses": "interface.messages.open_for_responses", "Reason for RSVP correction": "interface.messages.reason_for_rsvp_correction", "Save correction": "interface.messages.save_correction", "This updates the current response and records the reason. The original submission and household lock are preserved.": "interface.messages.this_updates_the_current_response_and_records_the_reason_the_orig", "Reopen RSVP": "interface.messages.reopen_rsvp", "Reason for reopening": "interface.messages.reason_for_reopening", "Reopen this household’s RSVP while preserving its submission history?": "interface.messages.reopen_this_household_s_rsvp_while_preserving_its_submission_hist", "Reopening lets the household submit again. Previous submissions remain in history. If the event deadline has passed, grant a late-response window after reopening.": "interface.messages.reopening_lets_the_household_submit_again_previous_submissions_re", "Allow a late response": "interface.messages.allow_a_late_response", "Allow late response": "interface.messages.allow_late_response", "Allow responses until (": "interface.messages.allow_responses_until", "Reason for late response": "interface.messages.reason_for_late_response", "No active RSVP sessions are assigned to this household.": "interface.messages.no_active_rsvp_sessions_are_assigned_to_this_household", "Invitations are protected because this household has RSVP history.": "interface.messages.invitations_are_protected_because_this_household_has_rsvp_history", "Grouped by category. Switch to Edit to sort, rename, or update items. Existing claims are preserved.": "interface.messages.grouped_by_category_switch_to_edit_to_sort_rename_or_update_items", "Category name": "interface.messages.category_name", "New category name": "interface.messages.new_category_name", "Register category": "interface.messages.register_category", "Register existing category": "interface.messages.register_existing_category", "Move category up": "interface.messages.move_category_up", "Move category down": "interface.messages.move_category_down", "Category for ": "interface.messages.category_for", "Faroese name": "interface.messages.faroese_name", "English name": "interface.messages.english_name", "German name": "interface.messages.german_name", "Faroese description": "interface.messages.faroese_description", "English description": "interface.messages.english_description", "German description": "interface.messages.german_description", "Quantity needed": "interface.messages.quantity_needed", "Display order": "interface.messages.display_order", "Available for guests": "interface.messages.available_for_guests", "Uncategorized": "interface.messages.uncategorized", "Unnamed item": "interface.messages.unnamed_item", "Not registered": "interface.messages.not_registered", "Faroese name is required.": "interface.messages.faroese_name_is_required", "Enter a non-negative quantity.": "interface.messages.enter_a_non_negative_quantity", "Category order saved.": "interface.messages.category_order_saved", "Category registered.": "interface.messages.category_registered", "Session": "interface.messages.session", "Session name": "interface.messages.session_name", "Session key": "interface.messages.session_key", "Session venue": "interface.messages.session_venue", "Active session": "interface.messages.active_session", "Starts (venue local time)": "interface.messages.starts_venue_local_time", "Ends (venue local time)": "interface.messages.ends_venue_local_time", "Save session": "interface.messages.save_session", "Create session": "interface.messages.create_session", "Venue name": "interface.messages.venue_name", "Venue address": "interface.messages.venue_address", "Venue timezone": "interface.messages.venue_timezone", "Country code": "interface.messages.country_code", "Map link (HTTPS)": "interface.messages.map_link_https", "Guest venue notes": "interface.messages.guest_venue_notes", "Welcome message — ": "interface.messages.welcome_message", "Welcome messages for this venue": "interface.messages.welcome_messages_for_this_venue", "Archived venue": "interface.messages.archived_venue", "Save venue": "interface.messages.save_venue", "Create venue": "interface.messages.create_venue", "No venue": "interface.messages.no_venue", "Unscheduled": "interface.messages.unscheduled", "Times are entered in ": "interface.messages.times_are_entered_in", "Session invitations": "interface.messages.session_invitations", "Save session invitations": "interface.messages.save_session_invitations", "Create sessions in Settings first.": "interface.messages.create_sessions_in_settings_first", "Household defaults apply to each guest unless an individual exception is selected. Language does not determine invitations.": "interface.messages.household_defaults_apply_to_each_guest_unless_an_individual_excep", "Follow household": "interface.messages.follow_household", "Invited": "interface.messages.invited", "Not invited": "interface.messages.not_invited", "Household invited": "interface.messages.household_invited", "Household not invited": "interface.messages.household_not_invited", "Switch to Edit mode": "interface.messages.switch_to_edit_mode", "Switch to View mode": "interface.messages.switch_to_view_mode", "Edit mode · Changes are saved to the event database": "interface.messages.edit_mode_changes_are_saved_to_the_event_database", "Loading event data…": "interface.messages.loading_event_data", "Event data refreshed.": "interface.messages.event_data_refreshed", "Event settings saved.": "interface.messages.event_settings_saved", "Switch to Edit mode first.": "interface.messages.switch_to_edit_mode_first", "Invalid RSVP deadline.": "interface.messages.invalid_rsvp_deadline", "Confirm the release acknowledgement before publishing.": "interface.messages.confirm_the_release_acknowledgement_before_publishing", "Complete the event name, date, website URL, active session and invitations before publishing.": "interface.messages.complete_the_event_name_date_website_url_active_session_and_invit", "Unpublish this event? Guest access to published event details will stop.": "interface.messages.unpublish_this_event_guest_access_to_published_event_details_will", "Event published.": "interface.messages.event_published_2", "Event unpublished.": "interface.messages.event_unpublished", "Enter matching passwords of at least 12 characters.": "interface.messages.enter_matching_passwords_of_at_least_12_characters", "Sign in again before sending an invitation.": "interface.messages.sign_in_again_before_sending_an_invitation", "Invitation could not be sent.": "interface.messages.invitation_could_not_be_sent", "Email delivery status is uncertain. Check before resending.": "interface.messages.email_delivery_status_is_uncertain_check_before_resending", "Email status is uncertain. Refresh pending invitations before retrying.": "interface.messages.email_status_is_uncertain_refresh_pending_invitations_before_retr", "Email sending is restricted. Check the email configuration.": "interface.messages.email_sending_is_restricted_check_the_email_configuration", "The email could not be sent. Check the email configuration before resending.": "interface.messages.the_email_could_not_be_sent_check_the_email_configuration_before_", "The email service request limit was reached. Wait before resending.": "interface.messages.the_email_service_request_limit_was_reached_wait_before_resending", "The email service sending limit was reached. Wait before resending.": "interface.messages.the_email_service_sending_limit_was_reached_wait_before_resending", "Administrator invitations are unavailable. The invitation service must be installed before sending.": "interface.messages.administrator_invitations_are_unavailable_the_invitation_service_", "Administrator list unavailable. Apply migration 006 if needed.": "interface.messages.administrator_list_unavailable_apply_migration_006_if_needed", "Admin management API unavailable: ": "interface.messages.admin_management_api_unavailable", "No active administrator invitation was found for this account. Ask an administrator to send or resend it.": "interface.messages.no_active_administrator_invitation_was_found_for_this_account_ask", "Your account does not have administrator access, or invitation acceptance is unavailable. Ask an administrator to check your invitation.": "interface.messages.your_account_does_not_have_administrator_access_or_invitation_acc", "Session logging is unavailable.": "interface.messages.session_logging_is_unavailable", "Signed in, but session logging is unavailable.": "interface.messages.signed_in_but_session_logging_is_unavailable", "Send another administrator invitation email to ": "interface.messages.send_another_administrator_invitation_email_to", "Cancel administrator invitation for ": "interface.messages.cancel_administrator_invitation_for", "Revoke administrator access for ": "interface.messages.revoke_administrator_access_for", "Added": "interface.messages.added", "Updated": "interface.messages.updated", "Deleted": "interface.messages.deleted", "Archived": "interface.messages.archived", "Restored": "interface.messages.restored", "Moved": "interface.messages.moved", "Renamed": "interface.messages.renamed", "Assigned": "interface.messages.assigned", "Enabled": "interface.messages.enabled", "Disabled": "interface.messages.disabled", "Unspecified": "interface.messages.unspecified", "Expired": "interface.messages.expired", "Draft saved": "interface.messages.draft_saved", "Delivery created": "interface.messages.delivery_created", "Failed delivery": "interface.messages.failed_delivery", "Failed attempt": "interface.messages.failed_attempt", "Household submitted": "interface.messages.household_submitted", "Guest response submitted": "interface.messages.guest_response_submitted", "Guest response corrected": "interface.messages.guest_response_corrected", "RSVP reopened": "interface.messages.rsvp_reopened", "Late response allowed": "interface.messages.late_response_allowed", "Invitation opened": "interface.messages.invitation_opened", "Invitation assignments changed": "interface.messages.invitation_assignments_changed", "Sign-in session": "interface.messages.sign_in_session", "Signed out": "interface.messages.signed_out", "Sign-out requested": "interface.messages.sign_out_requested", "Token refreshed": "interface.messages.token_refreshed", "Administrator invitation accepted": "interface.messages.administrator_invitation_accepted_2", "Administrator invitation cancelled": "interface.messages.administrator_invitation_cancelled_2", "Administrator email requested": "interface.messages.administrator_email_requested", "Administrator email accepted by service": "interface.messages.administrator_email_accepted_by_service", "Administrator email failed": "interface.messages.administrator_email_failed", "Email failed": "interface.messages.email_failed", "Sending / status pending": "interface.messages.sending_status_pending", "Access removed": "interface.messages.access_removed", "FIRST-TIME SETUP": "interface.messages.first_time_setup", "Make this event yours.": "interface.messages.make_this_event_yours", "Connect your own Supabase project in four steps. No terminal or Python required.": "interface.messages.connect_your_own_supabase_project_in_four_steps_no_terminal_or_py", "Administration · Own your data": "interface.messages.administration_own_your_data", "Database choice": "interface.messages.database_choice", "Connection": "interface.messages.connection", "Verify admin": "interface.messages.verify_admin", "Publish config": "interface.messages.publish_config", "STEP 1 OF 4": "interface.messages.step_1_of_4", "STEP 2 OF 4": "interface.messages.step_2_of_4", "STEP 3 OF 4": "interface.messages.step_3_of_4", "STEP 4 OF 4": "interface.messages.step_4_of_4", "How would you like to begin?": "interface.messages.how_would_you_like_to_begin", "Use existing database": "interface.messages.use_existing_database", "Connect to an already-migrated Supabase project. Preserve its invitations, guests and admin accounts.": "interface.messages.connect_to_an_already_migrated_supabase_project_preserve_its_invi", "Set up a new database": "interface.messages.set_up_a_new_database", "Create an empty Supabase project, run the included SQL, then create the first administrator.": "interface.messages.create_an_empty_supabase_project_run_the_included_sql_then_create", "Continue": "interface.messages.continue", "Connect Supabase": "interface.messages.connect_supabase", "Project URL": "interface.messages.project_url", "Publishable or legacy anon key": "interface.messages.publishable_or_legacy_anon_key", "Test connection": "interface.messages.test_connection", "Never paste a Supabase secret key, service_role key, database password or access token here. Only public client keys belong in a static website.": "interface.messages.never_paste_a_supabase_secret_key_service_role_key_database_passw", "New database instructions": "interface.messages.new_database_instructions", "Create a project at": "interface.messages.create_a_project_at", "Open SQL Editor and run the included migrations 001–006 in order, or use the bundled install file. These are starter migrations and require functional/security testing before public launch.": "interface.messages.open_sql_editor_and_run_the_included_migrations_001_006_in_order_", "Create an Auth user under Authentication → Users.": "interface.messages.create_an_auth_user_under_authentication_users", "Download complete SQL installer": "interface.messages.download_complete_sql_installer", "First admin email (for new installations)": "interface.messages.first_admin_email_for_new_installations", "Generate first-admin SQL": "interface.messages.generate_first_admin_sql", "Copy SQL": "interface.messages.copy_sql", "The SQL appears here. Run it in your private Supabase SQL Editor, never on the website.": "interface.messages.the_sql_appears_here_run_it_in_your_private_supabase_sql_editor_n", "Secure administrator access": "interface.messages.secure_administrator_access", "For new projects, invite your first user via": "interface.messages.for_new_projects_invite_your_first_user_via", ", then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.": "interface.messages.then_run_the_sql_below_in_supabase_sql_editor_to_grant_admin_acce", "Check administrator login": "interface.messages.check_administrator_login", "Put your configuration online": "interface.messages.put_your_configuration_online", "Administrator verified. Your website configuration is ready.": "interface.messages.administrator_verified_your_website_configuration_is_ready", "Download config.js": "interface.messages.download_config_js", "Copy config contents": "interface.messages.copy_config_contents", "Go to admin": "interface.messages.go_to_admin", "The file contains only your Supabase URL and publishable / anon key. It must not contain a secret or service_role key.": "interface.messages.the_file_contains_only_your_supabase_url_and_publishable_anon_key", "After committing": "interface.messages.after_committing", ", enable GitHub Pages for the new repository. Then open the website, verify admin sign-in and invitation behavior. Keep the event unpublished until final security checks pass.": "interface.messages.enable_github_pages_for_the_new_repository_then_open_the_website_", "Enter": "interface.messages.enter", ", and add it to": "interface.messages.and_add_it_to", "in your NEW GitHub repository. This step is essential: browser-only setup does not configure the public website for other visitors.": "interface.messages.in_your_new_github_repository_this_step_is_essential_browser_only", "For a new project, create your first Auth user in Supabase and use the setup wizard to establish admin access.": "interface.messages.for_a_new_project_create_your_first_auth_user_in_supabase_and_use", "Test your Supabase connection before continuing.": "interface.messages.test_your_supabase_connection_before_continuing", "Administrator verification required.": "interface.messages.administrator_verification_required", "Sign in as an administrator first.": "interface.messages.sign_in_as_an_administrator_first", "Database connection or schema validation failed: ": "interface.messages.database_connection_or_schema_validation_failed", "Guest Edge Function is unavailable. Deploy the guest-gateway function first: ": "interface.messages.guest_edge_function_is_unavailable_deploy_the_guest_gateway_funct", "Enter a valid administrator email.": "interface.messages.enter_a_valid_administrator_email", "First-admin SQL generated. This must be executed in the private Supabase SQL Editor, not in the browser.": "interface.messages.first_admin_sql_generated_this_must_be_executed_in_the_private_su", "This account does not have administrator access. Run the first-admin SQL or ask an existing admin to grant access.": "interface.messages.this_account_does_not_have_administrator_access_run_the_first_adm", "Generate SQL first.": "interface.messages.generate_sql_first", "SQL copied.": "interface.messages.sql_copied", "Unable to copy SQL. Select it manually.": "interface.messages.unable_to_copy_sql_select_it_manually", "Configuration copied.": "interface.messages.configuration_copied", "Clipboard access denied. Download the file instead.": "interface.messages.clipboard_access_denied_download_the_file_instead", "Connected to {host}. The protected guest gateway responded.": "interface.messages.connected_to_host_the_protected_guest_gateway_responded", "Database not configured": "interface.messages.database_not_configured", "Database not connected. Complete the setup wizard first.": "interface.messages.database_not_connected_complete_the_setup_wizard_first", "Invalid administrator action": "interface.messages.invalid_administrator_action", "Administrator request failed.": "interface.messages.administrator_request_failed", "Your sign-in has expired. Sign in again before saving. Your edits have not been submitted.": "interface.messages.your_sign_in_has_expired_sign_in_again_before_saving_your_edits_h", "The server returned an unreadable response.": "interface.messages.the_server_returned_an_unreadable_response", "Supabase JavaScript library did not load. Check the network connection.": "interface.messages.supabase_javascript_library_did_not_load_check_the_network_connec", "Supabase URL must use HTTPS (except localhost).": "interface.messages.supabase_url_must_use_https_except_localhost", "Use only the Supabase project URL, with no credentials or query string.": "interface.messages.use_only_the_supabase_project_url_with_no_credentials_or_query_st", "Use only a publishable or anon key, never a secret key.": "interface.messages.use_only_a_publishable_or_anon_key_never_a_secret_key", "This JWT is not an anon key.": "interface.messages.this_jwt_is_not_an_anon_key", "The supplied JWT key is malformed.": "interface.messages.the_supplied_jwt_key_is_malformed", "Expected a publishable key or legacy anon JWT.": "interface.messages.expected_a_publishable_key_or_legacy_anon_jwt", "Something went wrong.": "interface.messages.something_went_wrong", "Enter a complete date and time.": "interface.messages.enter_a_complete_date_and_time", "Invalid date and time.": "interface.messages.invalid_date_and_time", "This local time is ambiguous or does not exist because clocks change. Choose a time outside the clock change.": "interface.messages.this_local_time_is_ambiguous_or_does_not_exist_because_clocks_cha", "A simple way to celebrate together.": "interface.messages.a_simple_way_to_celebrate_together", "Your event,": "interface.messages.your_event", "beautifully arranged.": "interface.messages.beautifully_arranged", "Private invitations · Please do not share your invitation link.": "interface.messages.private_invitations_please_do_not_share_your_invitation_link", "SETUP REQUIRED": "interface.messages.setup_required", "Connect your event": "interface.messages.connect_your_event", "This website has not been connected to Supabase yet.": "interface.messages.this_website_has_not_been_connected_to_supabase_yet", "Open first-time setup": "interface.messages.open_first_time_setup", "YOUR INVITATION": "interface.messages.your_invitation", "Open your invitation": "interface.messages.open_your_invitation", "Enter the eight-character invitation code or open the private link you received.": "interface.messages.enter_the_eight_character_invitation_code_or_open_the_private_lin", "Open": "interface.messages.open", "PERSONAL INVITATION": "interface.messages.personal_invitation", "Welcome": "interface.messages.welcome", "Please let us know who will attend.": "interface.messages.please_let_us_know_who_will_attend", "Submit RSVP": "interface.messages.submit_rsvp", "What can you bring?": "interface.messages.what_can_you_bring", "Choose items only if you want to contribute. Quantities cannot exceed what is needed.": "interface.messages.choose_items_only_if_you_want_to_contribute_quantities_cannot_exc", "Confirm my selections": "interface.messages.confirm_my_selections", "Invalid quantity": "interface.messages.invalid_quantity", "Invalid invitation code": "interface.messages.invalid_invitation_code", "Your event": "interface.messages.your_event_2", "Invitation": "interface.messages.invitation", "Quantity for {item}": "interface.messages.quantity_for_item", "Interface language": "interface.messages.interface_language", "Interface wording": "interface.messages.interface_wording", "Welcome messages": "interface.messages.welcome_messages", "Save welcome messages": "interface.messages.save_welcome_messages", "Welcome messages saved.": "interface.messages.welcome_messages_saved", "Leave a welcome message blank to use the built-in translation.": "interface.messages.leave_a_welcome_message_blank_to_use_the_built_in_translation", "Customize interface wording": "interface.messages.customize_interface_wording", "Choose a phrase and language, edit the wording, then download the file and replace js/interface-overrides.js in the repository. This does not publish the event.": "interface.messages.choose_a_phrase_and_language_edit_the_wording_then_download_the_f", "Phrase": "interface.messages.phrase", "Custom wording": "interface.messages.custom_wording", "Use {placeholders} exactly as shown. Blank text restores the built-in wording.": "interface.messages.use_placeholders_exactly_as_shown_blank_text_restores_the_built_i", "Apply wording": "interface.messages.apply_wording", "Download wording file": "interface.messages.download_wording_file", "Wording applied to this preview. Download and commit the file to share it.": "interface.messages.wording_applied_to_this_preview_download_and_commit_the_file_to_s", "Keep the same placeholders as the original phrase.": "interface.messages.keep_the_same_placeholders_as_the_original_phrase", "EVENT INVITATION": "interface.messages.event_invitation_2", "Enter the eight-character code from your invitation.": "interface.messages.enter_the_eight_character_code_from_your_invitation", "Dear guests": "interface.messages.dear_guests", "Your response has been received and locked.": "interface.messages.your_response_has_been_received_and_locked", "Thank you! Your response is recorded.": "interface.messages.thank_you_your_response_is_recorded", "No invitation was found for that code.": "interface.messages.no_invitation_was_found_for_that_code", "Choose a response for every invited guest and session.": "interface.messages.choose_a_response_for_every_invited_guest_and_session", "Could not reach the database.": "interface.messages.could_not_reach_the_database", "This event has not been published yet.": "interface.messages.this_event_has_not_been_published_yet", "Choose only what you would like to contribute. Quantities are limited.": "interface.messages.choose_only_what_you_would_like_to_contribute_quantities_are_limi", "Save": "interface.messages.save", "Available": "interface.messages.available", "All invited guests are listed.": "interface.messages.all_invited_guests_are_listed", "Changing language reloads this page. Unsaved changes will be lost. Continue?": "interface.messages.changing_language_reloads_this_page_unsaved_changes_will_be_lost_", "Showing {count} of {total} matching guests.": "interface.messages.showing_count_of_total_matching_guests", "{count} entries shown · Newest first": "interface.messages.count_entries_shown_newest_first", " · Confirmed": "interface.messages.confirmed", " · Last submission {time}": "interface.messages.last_submission_time", "Event deadline: {deadline} · Late-response permission: {late} · {zone}": "interface.messages.event_deadline_deadline_late_response_permission_late_zone", "{ready} ready · {sent} recorded sent · {failed} failed": "interface.messages.ready_ready_sent_recorded_sent_failed_failed", "{count} guests": "interface.messages.count_guests", "{count} sub-households · {guests} guests in sub-households": "interface.messages.count_sub_households_guests_guests_in_sub_households", "Quantity cannot fall below {count} claimed; claimed items cannot be hidden.": "interface.messages.quantity_cannot_fall_below_count_claimed_claimed_items_cannot_be_", "Needed {needed} · Claimed {claimed} · Available {available}{inactive}": "interface.messages.needed_needed_claimed_claimed_available_available_inactive", " · Inactive": "interface.messages.inactive", "Archive {item}? Existing claims are preserved; you can reactivate it using Edit.": "interface.messages.archive_item_existing_claims_are_preserved_you_can_reactivate_it_", "Revoke administrator access for {email}?": "interface.messages.revoke_administrator_access_for_email", "Times are entered in {zone}. Changing venue keeps the typed local time; review before saving.": "interface.messages.times_are_entered_in_zone_changing_venue_keeps_the_typed_local_ti", "For new projects, invite your first user via Supabase → Authentication → Users, then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.": "interface.messages.for_new_projects_invite_your_first_user_via_supabase_authenticati", "{attending} attending · {declined} declined": "interface.messages.attending_attending_declined_declined", "{sent} recorded sent · {pending} pending": "interface.messages.sent_recorded_sent_pending_pending", "{count} households": "interface.messages.count_households", "{count} items": "interface.messages.count_items", " · Child": "interface.messages.child_2", " · Archived": "interface.messages.archived_2", " (unregistered)": "interface.messages.unregistered", " (inactive)": "interface.messages.inactive_2", " — household": "interface.messages.household", " · Expires {time}": "interface.messages.expires_time", "Household": "interface.messages.household_2", "Wording preview": "interface.messages.wording_preview", "Download": "interface.messages.download", "{count} guest": "interface.messages.count_guest", "{count} sub-household": "interface.messages.count_sub_household", "{count} sub-households": "interface.messages.count_sub_households", "{count} guest in sub-households": "interface.messages.count_guest_in_sub_households", "{count} guests in sub-households": "interface.messages.count_guests_in_sub_households", "Archive household": "interface.messages.archive_household", "Restore household": "interface.messages.restore_household", "Archive guest": "interface.messages.archive_guest", "Restore guest": "interface.messages.restore_guest", "Archive contact": "interface.messages.archive_contact", "Restore contact": "interface.messages.restore_contact", "Languages": "interface.messages.languages", "Backups": "interface.messages.backups", "Fallback language": "interface.messages.fallback_language", "Choose enabled languages and the fallback used for missing translations. English is the final built-in fallback.": "interface.messages.choose_enabled_languages_and_the_fallback_used_for_missing_transl", "Save language preferences": "interface.messages.save_language_preferences", "Add language": "interface.messages.add_language", "Language code": "interface.messages.language_code", "Save language": "interface.messages.save_language", "Language saved.": "interface.messages.language_saved", "Language preferences saved.": "interface.messages.language_preferences_saved", "Translations": "interface.messages.translations", "Text to translate": "interface.messages.text_to_translate", "Translation": "interface.messages.translation", "Save translation": "interface.messages.save_translation", "Translation saved.": "interface.messages.translation_saved", "Fallback preview": "interface.messages.fallback_preview", "Venue": "interface.messages.venue", "Description": "interface.messages.description", "Blank text uses the configured fallback language, then English.": "interface.messages.blank_text_uses_the_configured_fallback_language_then_english", "Choose a phrase and language, then save the translation. Downloading a wording file is optional. This does not publish the event.": "interface.messages.choose_a_phrase_and_language_then_save_the_translation_downloadin", "Download an application backup containing guest information, private invitation codes, settings, translations, contributions and historical records. Store it privately.": "interface.messages.download_an_application_backup_containing_guest_information_priva", "Auth passwords, sessions, administrator access, deployment secrets, rate-limit counters and sign-in logs are not restored. Keep a separate copy of the repository and deployment configuration.": "interface.messages.auth_passwords_sessions_administrator_access_deployment_secrets_r", "Download application backup": "interface.messages.download_application_backup", "Validate and restore": "interface.messages.validate_and_restore", "Choose a backup to inspect it. Full validation rehearses the restore and rolls it back. Import requires an empty, unpublished destination with matching migrations and verified historical actor accounts. Existing application records cannot be overwritten.": "interface.messages.choose_a_backup_to_inspect_it_full_validation_rehearses_the_resto", "Backup file": "interface.messages.backup_file", "Validate backup": "interface.messages.validate_backup", "Restore confirmation": "interface.messages.restore_confirmation", "I understand this restores application data into an empty destination and keeps the event unpublished.": "interface.messages.i_understand_this_restores_application_data_into_an_empty_destina", "Restore application backup": "interface.messages.restore_application_backup", "Preparing backup…": "interface.messages.preparing_backup", "Backup export is unavailable. Install the matching migration first.": "interface.messages.backup_export_is_unavailable_install_the_matching_migration_first", "Backup downloaded. Store it privately and rehearse restoration.": "interface.messages.backup_downloaded_store_it_privately_and_rehearse_restoration", "Backup exceeds 20 MB.": "interface.messages.backup_exceeds_20_mb", "Unsupported backup format or version.": "interface.messages.unsupported_backup_format_or_version", "Validating backup…": "interface.messages.validating_backup", "Backup validation is unavailable.": "interface.messages.backup_validation_is_unavailable", "Restore rehearsal passed. No data was changed.": "interface.messages.restore_rehearsal_passed_no_data_was_changed", "This destination cannot be restored: ": "interface.messages.this_destination_cannot_be_restored", "Application restored. The event is unpublished. Review administrator access separately.": "interface.messages.application_restored_the_event_is_unpublished_review_administrato", "RESTORE followed by the source event name": "interface.messages.restore_followed_by_the_source_event_name", "Open email": "interface.messages.open_email", "Open Messages": "interface.messages.open_messages", "Open WhatsApp": "interface.messages.open_whatsapp", "Copy the message, open Messages, then paste and send.": "interface.messages.copy_the_message_open_messages_then_paste_and_send", "Review the message in your device app and tap Send.": "interface.messages.review_the_message_in_your_device_app_and_tap_send", "Opening an app does not mark this message as sent. Return here to confirm sending. Delivery and read receipts remain in your messaging app.": "interface.messages.opening_an_app_does_not_mark_this_message_as_sent_return_here_to_", "Enter one valid email address.": "interface.messages.enter_one_valid_email_address", "Use an international phone number, including country code.": "interface.messages.use_an_international_phone_number_including_country_code", "Refresh and save this delivery again before sending.": "interface.messages.refresh_and_save_this_delivery_again_before_sending", "Prepare reminder": "interface.messages.prepare_reminder", "Creates a separate draft using current contact details. Review the recipient and text before sending.": "interface.messages.creates_a_separate_draft_using_current_contact_details_review_the", "A friendly reminder to reply to our invitation:": "interface.messages.a_friendly_reminder_to_reply_to_our_invitation", "Invites": "interface.messages.invites", "Things to do": "interface.messages.things_to_do", "Task": "interface.messages.task", "Assigned to": "interface.messages.assigned_to", "Status": "interface.messages.status", "Add rows": "interface.messages.add_rows", "In progress": "interface.messages.in_progress", "Done": "interface.messages.done", "Tasks saved.": "interface.messages.tasks_saved", "Edit cells, add rows, then save. Blank new rows are ignored.": "interface.messages.edit_cells_add_rows_then_save_blank_new_rows_are_ignored", "Select Edit to update the task list.": "interface.messages.select_edit_to_update_the_task_list", "Name": "interface.messages.name", "Amount: {claimed}/{needed}, Shown: {shown}": "interface.messages.amount_claimed_needed_shown_shown", "Pick item": "interface.messages.pick_item", "Remove selection": "interface.messages.remove_selection", "Selected": "interface.messages.selected", "Find text": "interface.messages.find_text", "Choose enabled languages": "interface.messages.choose_enabled_languages", "Name is required.": "interface.messages.name_is_required", "Comment": "interface.messages.comment", "Print / Save as PDF": "interface.messages.print_save_as_pdf", "Default unit ({type})": "interface.messages.default_type_type", "Expand all items": "interface.messages.expand_all_items", "Collapse all items": "interface.messages.collapse_all_items", "Quantity: {claimed}/{needed} {type} · {shown}": "interface.messages.amount_claimed_needed_type_shown_shown", "Event welcome": "interface.messages.event_welcome", "Venue welcome": "interface.messages.venue_welcome", "Appears at the top of the guest invitation.": "interface.messages.appears_at_the_top_of_the_guest_invitation", "Appears under the session at this venue on the guest invitation.": "interface.messages.appears_under_the_session_at_this_venue_on_the_guest_invitation", "Map link": "interface.messages.map_link", "Manage households": "interface.messages.manage_households", "Checked households are invited to this session. Individual guest exceptions stay in place.": "interface.messages.checked_households_are_invited_to_this_session_individual_guest_e", "No households to manage.": "interface.messages.no_households_to_manage", "Guest exceptions": "interface.messages.guest_exceptions", "Protected by RSVP history": "interface.messages.protected_by_rsvp_history", "Checked items are available at this venue. Changes apply here only. Existing household claims are kept.": "interface.messages.checked_items_are_available_at_this_venue_changes_apply_here_only", "Select all": "interface.messages.select_all", "Nothing available to add.": "interface.messages.nothing_available_to_add", "Edit administrator name": "interface.messages.edit_administrator_name", "Move session up": "interface.messages.move_session_up", "Move session down": "interface.messages.move_session_down", "Session order saved.": "interface.messages.session_order_saved", "Move language up": "interface.messages.move_language_up", "Move language down": "interface.messages.move_language_down", "Save translations": "interface.messages.save_translations", "1 item": "interface.messages.1_item", "{items} · Quantity: {claimed}/{capacity}": "interface.messages.items_claimed_capacity_amounts", "Add": "interface.messages.add", "Edit quantity for {household}": "interface.messages.edit_quantity_for_household", "Remove selection for {household}": "interface.messages.remove_selection_for_household", "Remove new item": "interface.messages.remove_new_item", "Move to category": "interface.messages.move_to_category", "Unsaved changes. Select Save to update the database.": "interface.messages.unsaved_changes_select_save_to_update_the_database", "Use main Edit mode to change tasks. Save sends your changes to the database.": "interface.messages.use_main_edit_mode_to_change_tasks_save_sends_your_changes_to_the", "Tasks were saved. Refresh the page before editing again.": "interface.messages.tasks_were_saved_refresh_the_page_before_editing_again", "Item": "interface.messages.item", "New item": "interface.messages.new_item", "Edit item": "interface.messages.edit_item", "Save item": "interface.messages.save_item", "Item saved.": "interface.messages.item_saved", "No items in this category.": "interface.messages.no_items_in_this_category", "Use main Edit, then the pencil to edit and save a line.": "interface.messages.use_main_edit_then_the_pencil_to_edit_and_save_a_line", "Add a category first.": "interface.messages.add_a_category_first", "Tasks and things to bring, grouped by category. Use main Edit, then the pencil to edit a line.": "interface.messages.tasks_and_things_to_bring_grouped_by_category_use_main_edit_then_", "No matching entries.": "interface.messages.no_matching_entries", "Welcome Message": "interface.messages.welcome_message_title", "Categories": "interface.messages.categories", "Units": "interface.messages.types", "Rows per page": "interface.messages.rows_per_page", "Previous": "interface.messages.previous", "Next": "interface.messages.next", "Page {page} of {pages}": "interface.messages.page_page_of_pages", "Edit translation": "interface.messages.edit_translation", "Export CSV": "interface.messages.export_csv", "Use the pencil to open an item, then save your changes.": "interface.messages.use_the_pencil_to_open_an_item_then_save_your_changes", "Translate welcome messages, venues, sessions and food. Interface wording is in Settings → Languages.": "interface.messages.main_language_help", "Guest note": "interface.messages.guest_note", "Translate the item name and the note shown to guests. Units are translated in Languages → Food → Units.": "interface.messages.food_translation_help", "English source": "interface.messages.english_source", "Unavailable": "interface.messages.unavailable", "Edit category": "interface.messages.edit_category", "Delete category": "interface.messages.delete_category", "Move items to another category before deleting this category.": "interface.messages.move_items_before_deleting_category", "Delete empty category?": "interface.messages.delete_empty_category", "Category deleted": "interface.messages.category_deleted", "Category saved": "interface.messages.category_saved", "Manage units": "interface.messages.manage_types", "Units are shared by all food items. Translate each unit once for every enabled language.": "interface.messages.shared_food_types_help", "Built-in": "interface.messages.built_in", "Custom": "interface.messages.custom", "Translate": "interface.messages.translate", "Add unit": "interface.messages.add_type", "This unit already exists.": "interface.messages.type_already_exists", "Unit added": "interface.messages.type_added", "Move venue up": "interface.messages.move_venue_up", "Move venue down": "interface.messages.move_venue_down", "Venue order saved": "interface.messages.venue_order_saved", "Admin note": "interface.messages.admin_note", "Unit": "interface.messages.unit", "Batch": "interface.messages.batch_singular", "Piece": "interface.messages.piece_singular", "Tray": "interface.messages.tray_singular", "Packet": "interface.messages.packet_singular", "Gram": "interface.messages.gram_singular", "Saving…": "interface.messages.saving_progress", "Show more": "interface.messages.show_more", "Show less": "interface.messages.show_less", "Translate in Languages": "interface.messages.translate_in_languages", "Swipe for more tabs": "interface.messages.more_tabs_hint", "All wording": "interface.messages.all_wording", "General": "interface.messages.general", "Households & guests": "interface.messages.households_and_guests", "Invites & RSVP": "interface.messages.invites_and_rsvp", "Food & units": "interface.messages.food_and_units", "Venues & sessions": "interface.messages.venues_and_sessions", "Administrators & access": "interface.messages.administrators_and_access", "Wording categories": "interface.messages.wording_categories", "Main": "interface.messages.main", "Interface": "interface.messages.interface", "Administration areas": "interface.messages.administration_areas", "Personal preferences for this device.": "interface.messages.personal_device_preferences", "Translate event content for guests.": "interface.messages.translate_event_content", "Manage invitations, food and event details.": "interface.messages.main_section_description", "View mode": "interface.messages.view_mode", "Edit mode": "interface.messages.edit_mode", "Switch to light mode": "interface.messages.switch_to_light_mode", "Switch to dark mode": "interface.messages.switch_to_dark_mode", "Saved": "interface.messages.saved_status", "Error": "interface.messages.error_status", "Fully assigned": "interface.messages.fully_assigned", "Hidden": "interface.messages.hidden_status", "Access": "interface.messages.access_access", "Access preset": "interface.messages.access_access_preset", "Active": "interface.messages.access_active", "Administrator management": "interface.messages.access_administrator_management", "Administrator permissions are unavailable.": "interface.messages.access_administrator_permissions_are_unavailable", "Browser session": "interface.messages.access_browser_session", "Custom access · {edit} editable, {view} view only": "interface.messages.access_custom_access_edit_editable_view_view_only", "Edit access": "interface.messages.access_edit_access", "Enable": "interface.messages.access_enable", "Export application backup": "interface.messages.access_export_application_backup", "Full administrator": "interface.messages.access_full_administrator", "Invites & delivery": "interface.messages.access_invites_delivery", "Languages & settings": "interface.messages.access_languages_settings", "Last activity": "interface.messages.access_last_activity", "Manage members": "interface.messages.access_manage", "No access": "interface.messages.access_no_access", "View": "interface.messages.access_view", "View only": "interface.messages.access_view_only", "No access hides a section. View shows summaries. Edit allows changes.": "interface.messages.access_no_access_hides_a_section_view_shows_summaries_edit_allows_changes", "No active sessions.": "interface.messages.access_no_active_sessions", "No administrators to display.": "interface.messages.access_no_administrators_to_display", "No eligible verified Auth account found. Send an invitation instead.": "interface.messages.access_no_eligible_verified_auth_account_found_send_an_invitation_instead", "Only Full administrators can change access.": "interface.messages.access_only_full_administrators_can_change_access", "Only Full administrators can change access. Settings excludes administrator and backup powers.": "interface.messages.access_only_full_administrators_can_change_access_settings_excludes_administrator_and_backup_powers", "Remove administrator": "interface.messages.access_remove_administrator", "Remove administrator {name}? Their Auth account and historical records remain.": "interface.messages.access_remove_administrator_name_their_auth_account_and_historical_records_remain", "Restored · Disabled": "interface.messages.access_restored_disabled", "Revoke": "interface.messages.access_revoke", "Revoke other administrators’ sessions": "interface.messages.access_revoke_other_administrators_sessions", "Revoke this application session?": "interface.messages.access_revoke_this_application_session", "Revoke this session? You will return to login.": "interface.messages.access_revoke_this_session_you_will_return_to_login", "Revoke your other application sessions?": "interface.messages.access_revoke_your_other_application_sessions", "Save access changes for {name}?": "interface.messages.access_save_access_changes_for_name", "Section": "interface.messages.access_section", "Send invitations & reminders": "interface.messages.access_send_invitations_reminders", "Sending is separate from editing invitations. Backup exports include data from the whole event.": "interface.messages.access_sending_is_separate_from_editing_invitations_backup_exports_include_data_from_the_whole_event", "Signed in": "interface.messages.access_signed_in", "Suspend": "interface.messages.access_suspend", "Suspended": "interface.messages.access_suspended", "This session": "interface.messages.access_this_session", "Suspend administrator {name}? Their current sessions will lose application access.": "interface.messages.access_suspend_administrator_name_their_current_sessions_will_lose_application_access", "Enable administrator {name} with their saved access?": "interface.messages.access_enable_administrator_name_with_their_saved_access", "Add {email} with View only access? No invitation email will be sent.": "interface.messages.access_add_email_with_view_only_access_no_invitation_email_will_be_sent", "Active sessions": "interface.messages.access_active_sessions", "Revoke my other sessions": "interface.messages.access_revoke_my_other_sessions", "Revocation ends access to this application. Everyone can revoke their own sessions.": "interface.messages.access_revocation_ends_access_to_this_application_everyone_can_revoke_their_own_sessions", "Add administrator": "interface.messages.access_add_administrator", "Add manually": "interface.messages.access_add_manually", "Your administrator access or session has ended. Sign in again.": "interface.messages.access_your_administrator_access_or_session_has_ended_sign_in_again", "New administrators start with View only access. Full administrators can customize it.": "interface.messages.access_new_administrators_start_with_view_only_access_full_administrators_can_customize_it", "This action is not allowed by your administrator permissions.": "interface.messages.access_this_action_is_not_allowed_by_your_administrator_permissions", "Use the available tabs to open the sections you can access.": "interface.messages.access_use_the_available_tabs_to_open_the_sections_you_can_access", "Close": "interface.messages.popup_close", "Preview": "interface.messages.pdf_print_preview", "Adults: {adults} · Children: {children}": "interface.messages.guest_age_summary", "Quantity: {claimed}/{needed} {type}": "interface.messages.quantity_claimed_needed_type", "Mobile": "interface.messages.guest_mobile", "Preferred guest contact method": "interface.messages.guest_contact_method", "Copy household contact details": "interface.messages.copy_household_contacts", "Review the copied details before saving. Existing guest values and household information are preserved.": "interface.messages.copy_contacts_review", "Previous household contact details": "interface.messages.previous_household_contacts", "No previous contact details.": "interface.messages.no_previous_contact_details", "Missing contact": "interface.messages.missing_contact", "Keep these details until you have reviewed and copied them to a guest.": "interface.messages.keep_previous_contacts", "Primary household contact": "interface.messages.primary_household_contact", "Choose a non-child guest from this household. Their saved contact details are used for new invitation drafts.": "interface.messages.primary_guest_help", "Move guest up": "interface.messages.guest_move_up", "Move guest down": "interface.messages.guest_move_down", "Guest order saved": "interface.messages.guest_order_saved", "Map & directions": "interface.messages.map_directions", "Add person": "interface.messages.add_companion", "Add to our household": "interface.messages.add_to_household", "Add someone from your household before confirming your RSVP. They inherit your household’s session invitations.": "interface.messages.companion_help", "Person added. Please review their attendance choices.": "interface.messages.guest_added", "Preview only: added guests disappear when you reload. Nothing is saved.": "interface.messages.preview_add_guest", "Please contact the organizer to add more people.": "interface.messages.companion_limit", "Could not add this person. Check your invitation or contact the organizer.": "interface.messages.guest_add_error", "Could not reserve the complete group. Availability has been refreshed.": "interface.messages.food_group_error", "Partly assigned by the organizer": "interface.messages.food_group_partial", "Contact the organizer to change this group.": "interface.messages.food_group_unavailable", "Food Group saved.": "interface.messages.food_group_saved", "Time format": "interface.messages.time_format", "Language default": "interface.messages.time_locale", "12-hour (AM/PM)": "interface.messages.time_12", "24-hour": "interface.messages.time_24", "Food Groups": "interface.messages.food_groups", "Add Food Group": "interface.messages.add_food_group", "Selecting this group commits your household to one unit of every listed item.": "interface.messages.group_commitment", "Included items": "interface.messages.group_items", "Choose at least two items. Resolve existing commitments before grouping.": "interface.messages.group_choose", "Select group": "interface.messages.group_pick", "Remove group selection": "interface.messages.group_remove", "Ungroup items": "interface.messages.group_delete", "Ungroup these items? No food item will be deleted.": "interface.messages.group_delete_confirm", "Pick an item you would like to bring. Selected items are reserved for your household.": "interface.messages.food_selection_help", "Food coordination": "interface.messages.food_coordination", "Guest food step": "interface.messages.food_stage", "Collect interest": "interface.messages.food_stage_interest", "Choose food": "interface.messages.food_stage_selection", "Keep the detailed list hidden while planning. Opening it does not publish the event. Hiding it again preserves all commitments.": "interface.messages.food_stage_help", "Open the detailed food list for eligible households? This does not publish the event.": "interface.messages.food_stage_confirm", "Guest food step saved.": "interface.messages.food_stage_saved", "Can you bring food?": "interface.messages.food_interest_question", "Let us know whether your household can bring food. We will send the invitation link again when the detailed list is ready.": "interface.messages.food_interest_help", "I can bring food": "interface.messages.food_interest_yes", "I can’t bring food": "interface.messages.food_interest_no", "Your food answer has been saved.": "interface.messages.food_interest_saved", "Could not save your food answer. Your choice is still here; refresh or contact the organizer if you already have commitments.": "interface.messages.food_interest_failed", "Not answered": "interface.messages.food_interest_pending", "Household food answers": "interface.messages.food_interest_answers", "Can bring food: {yes} · Cannot: {no} · Not answered: {pending}": "interface.messages.food_interest_totals", "Features": "interface.messages.event_features", "Disabled features are hidden. Existing data is kept.": "interface.messages.features_preserve_data", "Food explanation": "interface.messages.food_explanation", "Review food selections": "interface.messages.food_review", "Check what your household will bring before confirming.": "interface.messages.food_review_help", "Your food selections changed. Please review them again.": "interface.messages.food_review_changed", "Time: {start} to {end}": "interface.messages.venue_time_range", "Time: {time}": "interface.messages.venue_time", "Guest appearance": "interface.messages.guest_appearance", "Show light/dark toggle on the guest page": "interface.messages.guest_theme_toggle", "Guest default appearance": "interface.messages.guest_theme_default", "Guests can change the default when the toggle is shown. Hiding it enforces the default. Your administrator appearance stays personal.": "interface.messages.guest_theme_help", "We’ll share more information about the food once we’ve received everyone’s replies.": "interface.messages.food_followup", "Print": "interface.messages.print", "Top-level groups": "interface.messages.top_level_groups", "Relational groups": "interface.messages.relation_groups", "Add relational group": "interface.messages.add_relation_group", "Move households and remove empty relational groups before deleting this group. Keep at least one top-level group.": "interface.messages.group_not_empty", "Edit group": "interface.messages.edit_group", "Delete group": "interface.messages.delete_group", "Shared group": "interface.messages.shared_group", "Guest invitation": "interface.messages.invitation_custom_guest_invitation", "Customize the invitation without publishing the event.": "interface.messages.invitation_custom_customize_the_invitation_without_publishing_the_event", "Background photo": "interface.messages.invitation_custom_background_photo", "Choose JPEG": "interface.messages.invitation_custom_choose_jpeg", "Replace JPEG": "interface.messages.invitation_custom_replace_jpeg", "Remove photo": "interface.messages.invitation_custom_remove_photo", "Restore photo": "interface.messages.invitation_custom_restore_photo", "Stored privately with the event. No public image link.": "interface.messages.invitation_custom_stored_privately_with_the_event_no_public_image_link", "JPEG up to 1.4 MB. Images are resized to 2400 px and metadata is removed before saving.": "interface.messages.invitation_custom_jpeg_up_to_1_4_mb_images_are_resized_to_2400_px_and_metadata_is_removed_before_saving", "Crop photo": "interface.messages.invitation_custom_crop_photo", "Left": "interface.messages.invitation_custom_left", "Top": "interface.messages.invitation_custom_top", "Bottom": "interface.messages.invitation_custom_bottom", "Center": "interface.messages.invitation_custom_center", "Width": "interface.messages.invitation_custom_width", "Height": "interface.messages.invitation_custom_height", "Photo position": "interface.messages.invitation_custom_photo_position", "Darken photo": "interface.messages.invitation_custom_darken_photo", "Colors & boxes": "interface.messages.invitation_custom_colors_boxes", "Boxes / page": "interface.messages.invitation_custom_boxes_page", "Text": "interface.messages.invitation_custom_text", "Buttons": "interface.messages.invitation_custom_buttons", "Box opacity": "interface.messages.invitation_custom_box_opacity", "Live preview": "interface.messages.invitation_custom_live_preview", "Wide": "interface.messages.invitation_custom_wide", "Reset appearance": "interface.messages.invitation_custom_reset_appearance", "Current private photo": "interface.messages.invitation_custom_current_private_photo", "Visible crop": "interface.messages.invitation_custom_visible_crop", "No background photo": "interface.messages.invitation_custom_no_background_photo", "bytes": "interface.messages.invitation_custom_bytes", "Preparing photo…": "interface.messages.invitation_custom_preparing_photo", "Photo prepared. Save to keep it privately.": "interface.messages.invitation_custom_photo_prepared_save_to_keep_it_privately", "Guest appearance saved.": "interface.messages.invitation_custom_guest_appearance_saved", "Choose a JPEG under 1.4 MB.": "interface.messages.invitation_custom_choose_a_jpeg_under_1_4_mb", "Invalid JPEG image.": "interface.messages.invitation_custom_invalid_jpeg_image", "JPEG dimensions are too large or invalid.": "interface.messages.invitation_custom_jpeg_dimensions_are_too_large_or_invalid", "Invalid photo crop.": "interface.messages.invitation_custom_invalid_photo_crop", "Could not prepare this photo.": "interface.messages.invitation_custom_could_not_prepare_this_photo", "All groups": "interface.messages.invitation_custom_all_groups", "All languages": "interface.messages.invitation_custom_all_languages", "All channels": "interface.messages.invitation_custom_all_channels", "Not sent": "interface.messages.invitation_custom_not_sent", "Marked sent": "interface.messages.invitation_custom_marked_sent", "Awaiting reply": "interface.messages.invitation_custom_awaiting_reply", "Replied": "interface.messages.invitation_custom_replied", "Partly answered": "interface.messages.invitation_custom_partly_answered", "No reply": "interface.messages.invitation_custom_no_reply", "Never sent": "interface.messages.invitation_custom_never_sent", "Last sent": "interface.messages.invitation_custom_last_sent", "Recipient / channel": "interface.messages.invitation_custom_recipient_channel", "Actions": "interface.messages.invitation_custom_actions", "Prepare": "interface.messages.invitation_custom_prepare", "Review": "interface.messages.invitation_custom_review", "Follow up": "interface.messages.invitation_custom_follow_up", "{answered} / {total} responses": "interface.messages.invitation_custom_answered_total_responses", "No households match these filters.": "interface.messages.invitation_custom_no_households_match_these_filters", "Send · Preview · Follow up": "interface.messages.invitation_custom_send_preview_follow_up", "Search households or contacts": "interface.messages.invitation_custom_search_households_or_contacts", "Household name or recipient": "interface.messages.invitation_custom_household_name_or_recipient", "Channel": "interface.messages.invitation_custom_channel", "Group by top-level / relational group": "interface.messages.invitation_custom_group_by_top_level_relational_group", "Prepare drafts now. Marking ready and sending become available after publication.": "interface.messages.invitation_custom_prepare_drafts_now_marking_ready_and_sending_become_available_after_publication", "Replace the invitation link placeholder before marking ready.": "interface.messages.invitation_custom_replace_the_invitation_link_placeholder_before_marking_ready", "Use the guest customization editor.": "interface.messages.invitation_custom_use_the_guest_customization_editor", "We look forward to celebrating our day with you.": "interface.messages.invitation_custom_we_look_forward_to_celebrating_our_day_with_you", "Status messages": "interface.messages.status_messages_title", "Choose which temporary messages appear. Saved logs, form errors and confirmation lists are unchanged.": "interface.messages.status_messages_help", "All messages": "interface.messages.status_messages_all", "Errors only": "interface.messages.status_messages_errors_only", "Information": "interface.messages.status_messages_information", "Success": "interface.messages.status_messages_success", "Warnings": "interface.messages.status_messages_warnings", "Errors": "interface.messages.status_messages_errors", "Status message preferences saved.": "interface.messages.status_messages_saved", "Hide messages after 5 seconds": "interface.messages.status_messages_auto_dismiss", "Food": "food.messages.food", "Event is unpublished: guest-facing event details and food remain hidden until you publish.": "food.messages.event_is_unpublished_guest_facing_event_details_and_food_remain_h", "Food access": "food.messages.food_access", "Food items": "food.messages.food_items", "Add food item": "food.messages.add_food_item", "Allow this household to contribute food": "food.messages.allow_this_household_to_contribute_food", "Reason for food-access change": "food.messages.reason_for_food_access_change", "Save food access": "food.messages.save_food_access", "Disabling access is blocked while food commitments or a confirmed selection exist. Existing selections are never removed by this control.": "food.messages.disabling_access_is_blocked_while_food_commitments_or_a_confirmed", "Food categories & items": "food.messages.food_categories_items", "Food or category": "food.messages.food_or_category", "Add food category": "food.messages.add_food_category", "Rename food category": "food.messages.rename_food_category", "Move food item up": "food.messages.move_food_item_up", "Move food item down": "food.messages.move_food_item_down", "Edit food item": "food.messages.edit_food_item", "Save food item": "food.messages.save_food_item", "Archive food item (preserve existing claims)": "food.messages.archive_food_item_preserve_existing_claims", "No matching food items.": "food.messages.no_matching_food_items", "Food category added.": "food.messages.food_category_added", "Food category updated.": "food.messages.food_category_updated", "Food item added.": "food.messages.food_item_added", "Food item updated.": "food.messages.food_item_updated", "Food item archived.": "food.messages.food_item_archived", "Food order saved.": "food.messages.food_order_saved", "Category renamed and linked food items updated.": "food.messages.category_renamed_and_linked_food_items_updated", "View mode · Manage invitations, food and event details": "food.messages.view_mode_manage_invitations_food_and_event_details", "Publish this event now? Invite-code holders may access guest RSVP and food details. Proceed only after security and guest-flow testing.": "food.messages.publish_this_event_now_invite_code_holders_may_access_guest_rsvp_", "FOOD COORDINATION": "food.messages.food_coordination", "Confirm food selections? This will lock further edits.": "food.messages.confirm_food_selections_this_will_lock_further_edits", "Food item": "food.messages.food_item", "Thank you! Your food selection is confirmed.": "food.messages.thank_you_your_food_selection_is_confirmed", "Food selection saved.": "food.messages.food_selection_saved", "{state} · {count} food commitments{confirmed}": "food.messages.state_count_food_commitments_confirmed", "Add translations for interface phrases, event introductions, venue welcome messages, sessions and food. Missing text uses the fallback language.": "food.messages.add_translations_for_interface_phrases_event_introductions_venue_", "Recipe": "food.messages.recipe", "Previous recipe group": "food.messages.previous_recipe_group", "Allow pop-ups to save the recipe as PDF.": "food.messages.allow_pop_ups_to_save_the_recipe_as_pdf", "Add food item type": "food.messages.add_food_item_type", "New food unit": "food.messages.new_food_item_type", "Food unit must be at most 60 characters.": "food.messages.food_item_type_must_be_at_most_60_characters", "Type translations are shared by food items with the same type.": "food.messages.type_translations_are_shared_by_food_items_with_the_same_type", "No matching food units.": "food.messages.no_matching_food_types", "Manage food": "food.messages.manage_food", "Venue food": "food.messages.venue_food", "No food items to manage.": "food.messages.no_food_items_to_manage", "Add food": "food.messages.add_food", "Adding unrestricted food here makes it available at this venue only. Items already assigned to other venues keep those assignments.": "food.messages.adding_unrestricted_food_here_makes_it_available_at_this_venue_on", "Food Units": "food.messages.food_types", "Food categories": "food.messages.food_categories", "Allow food": "food.messages.allow_food", "Remove the food selection for {household}?": "food.messages.remove_the_food_selection_for_household", "Add recipe": "food.messages.add_recipe", "Recipe name": "food.messages.recipe_name", "Existing food items": "food.messages.existing_food_items", "Create food item in recipe": "food.messages.create_food_item_in_recipe", "Save recipe": "food.messages.save_recipe", "Edit recipe": "food.messages.edit_recipe", "Existing items keep their selections. Recipe items use the recipe category.": "food.messages.existing_items_keep_their_selections_recipe_items_use_the_recipe_", "Move recipe to category": "food.messages.move_recipe_to_category", "No recipe has been added yet.": "food.messages.no_recipe_yet", "Batches": "types.units.batch_s", "Pieces": "types.units.piece_s", "Trays": "types.units.tray_s", "Packets": "types.units.packet_s", "kg": "types.units.kg", "Grams": "types.units.grams", "Selecting a group commits the household to one unit of every included item.": "interface.messages.admin_group_commitment", "Share invitation": "interface.messages.share_invitation", "Choose the displayed recipient in your app. Sharing does not mark this invitation as sent. Return here to record it and note the app you used.": "interface.messages.share_invitation_help", "System sharing is unavailable here. Use Copy message or open a device app.": "interface.messages.share_unavailable", "Share handoff completed": "interface.messages.share_handoff_completed", "Share handoff completed, but logging failed. Retry logging without sharing again. Sent still requires manual confirmation.": "interface.messages.share_logging_failed", "Retry logging": "interface.messages.retry_share_logging", "Personal preferences for your account, across devices.": "interface.messages.personal_account_preferences", "Your preference could not be saved. Please try again.": "interface.messages.personal_preference_failed", "Publication": "interface.messages.publication", "RSVP comment (optional)": "interface.messages.rsvp_comment_label", "Dietary requirements or anything else we should know.": "interface.messages.rsvp_comment_help", "Needed: {needed} · Still available: {available} · {unit}": "interface.messages.food_availability", "Select between 1 and {max}.": "interface.messages.food_quantity_range", "Parent category": "interface.messages.food_parent_category", "Add sub-category": "interface.messages.food_add_subcategory", "Move sub-categories before deleting this category.": "interface.messages.food_move_subcategories", "RSVP comment must be at most 2000 characters": "interface.messages.rsvp_comment_limit", "Food category hierarchy must have valid parents, no cycles and at most 8 levels": "interface.messages.food_category_tree_invalid", "Category changed; reload before saving": "interface.messages.food_category_changed", "Show timestamps": "interface.messages.status_messages_show_timestamp", "Export mode": "interface.messages.backup_export_mode", "Include sections": "interface.messages.backup_include_sections", "Include activity logs": "interface.messages.backup_include_logs", "Event settings and languages are always included. In Backup mode, households and food include each other and venues to preserve replies and commitments.": "interface.messages.backup_sections_help", "Activity logs can contain personal details. Replies, food commitments and Sent records are kept in Backup mode even when logs are excluded. Planning templates omit logs and reset invitation codes, replies and commitments.": "interface.messages.backup_logs_help", "Choose valid backup mode, sections and activity log options.": "interface.messages.backup_invalid_options", "Invalid backup selection manifest": "interface.messages.backup_invalid_manifest", "Invalid backup selection dependencies": "interface.messages.backup_invalid_dependencies", "A planning template cannot restore cleared replies or commitments.": "interface.messages.backup_template_no_replies", "Selected sections are not available in this file.": "interface.messages.backup_sections_unavailable", "Activity logs are not available in this file.": "interface.messages.backup_logs_unavailable", "Backup contains excluded administrator history": "interface.messages.backup_excluded_admin_history", "Backup": "interface.messages.backup_preserve_mode", "{count} sub-category": "interface.messages.food_count_subcategory", "{count} sub-categories": "interface.messages.food_count_subcategories", "Add item or sub-category": "interface.messages.food_add_choices", "Planned backup": "interface.messages.backup_planned_export", "Full restore": "interface.messages.backup_full_restore", "Planned restore": "interface.messages.backup_planned_restore", "Partial backup": "interface.messages.backup_partial_export", "Partial restore": "interface.messages.backup_partial_restore", "Event settings and languages are always included. Partial mode resets invitation codes, replies and commitments. Included logs remain read-only history.": "interface.messages.backup_partial_help", "Activity logs can be included in Full or Partial mode. They may contain personal details; Partial restores retain them as read-only history.": "interface.messages.backup_independent_logs_help", "Event settings and languages are always included. Partial mode resets invitation codes, replies and commitments, and excludes activity logs.": "interface.messages.backup_partial_excludes_logs", "Activity logs are optional for Full backup and Full restore only. Full restore requires a Full backup file.": "interface.messages.backup_full_logs_only", "Partial backups and restores cannot include activity logs.": "interface.messages.backup_partial_logs_forbidden", "Full restore requires a Full backup file.": "interface.messages.backup_full_file_required", "Checklist": "interface.messages.checklist", "Quantity: {claimed}/{capacity}": "interface.messages.food_quantity_totals", "Compress backup (.json.gz)": "interface.messages.backup_compress", "JSON or gzip (.json.gz) backups. Compression does not encrypt the file.": "interface.messages.backup_compression_help", "Compression is not supported in this browser. Use a JSON backup.": "interface.messages.backup_compression_unavailable", "Decompression is not supported in this browser. Open a JSON backup.": "interface.messages.backup_decompression_unavailable", "The compressed backup is damaged or incomplete.": "interface.messages.backup_gzip_damaged", "Backup exceeds 20 MB when opened.": "interface.messages.backup_opened_too_large", "Set RSVP_SITE_ORIGIN to {origin} and RSVP_SITE_URL to {siteUrl} in Supabase Edge Function secrets.": "interface.messages.setup_site_secrets", "In Supabase Authentication, set Site URL to {siteUrl} and allow the administrator invitation redirect {redirectUrl}.": "interface.messages.setup_auth_urls", "Connect to an existing Supabase installation. Preserve its invitations, guests and admin accounts.": "interface.messages.setup_existing_installation", "Choose Local or Cloud, install the current schema, then create the first administrator.": "interface.messages.setup_new_target_intro", "Where will the database run?": "interface.messages.setup_target_question", "Local": "interface.messages.setup_target_local", "Cloud": "interface.messages.setup_target_cloud", "Supabase running on your computer or VM.": "interface.messages.setup_local_description", "A project hosted by Supabase.": "interface.messages.setup_cloud_description", "Choose Local or Cloud before continuing.": "interface.messages.setup_choose_target", "Create a cloud Supabase project": "interface.messages.setup_create_cloud", "Open its SQL Editor and run the complete downloaded installer once on the empty application schema.": "interface.messages.setup_cloud_install", "Start your local Supabase stack. If the CLI already installed the current baseline, skip the SQL installation.": "interface.messages.setup_start_local", "Open local Supabase Studio": "interface.messages.setup_open_local_studio", "If the application schema is empty, open SQL Editor and run the complete downloaded installer once.": "interface.messages.setup_empty_schema_install", "Use the API URL and public browser key printed by supabase status.": "interface.messages.setup_local_credentials", "Never run the fresh installer over an installed event. This wizard does not execute SQL or reset a database.": "interface.messages.setup_fresh_install_guard", "Local Supabase setup guide": "interface.messages.setup_local_guide", "For GitHub Actions, set the repository variables RSVP_SUPABASE_URL and RSVP_PUBLISHABLE_KEY, then rerun the website deployment. For direct static hosting, download config.js and install it as js/config.js. Browser-only setup applies only to this browser.": "interface.messages.setup_configuration_delivery", "Before testing the website, complete the server configuration below. Local installations use the local setup guide; cloud installations use the Studio guide.": "interface.messages.setup_server_configuration", "Deploy guest-gateway and admin-invitations from the same release, with platform Verify JWT OFF.": "interface.messages.setup_cloud_functions", "Run both Edge Functions in your local stack with the site environment settings. Keep application validation enabled.": "interface.messages.setup_local_functions", "Enable Data API: ON": "interface.messages.setup_cloud_api_on", "Required for the website and Edge Function database calls.": "interface.messages.setup_cloud_api_reason", "Automatically expose new tables: OFF": "interface.messages.setup_cloud_exposure_off", "The installer grants only the access this application needs.": "interface.messages.setup_cloud_exposure_reason", "Enable automatic RLS: ON": "interface.messages.setup_cloud_rls_on", "Keep this protection enabled. The installer also enables RLS and supplies the application policies.": "interface.messages.setup_cloud_rls_reason", "Keep public in the Data API exposed schemas. Do not expose app_private.": "interface.messages.setup_cloud_schemas", "In the cloud project’s Security options, choose:": "interface.messages.setup_cloud_options_intro", "Before Test connection": "interface.messages.setup_before_connection", "Complete these server steps first. The connection test checks the database and guest-gateway; it does not install or configure them.": "interface.messages.setup_prerequisites_help", "GitHub Pages: the wizard configures this browser for testing. In step 4, save the public connection values as Actions variables and redeploy to configure the site for everyone.": "interface.messages.setup_hosting_order", "GitHub Pages — selected-release workflow": "interface.messages.setup_pages_workflow", "In the website repository, open Settings → Secrets and variables → Actions → Variables. Add repository variables, not secrets.": "interface.messages.setup_pages_variables", "Set RSVP_SUPABASE_URL to the Project URL used in step 2 and RSVP_PUBLISHABLE_KEY to its public browser key. Enter values without JavaScript quotes.": "interface.messages.setup_pages_values", "Open Actions → Deploy RSVP → Run workflow, select the installed release and run it. Wait for the deployment to succeed.": "interface.messages.setup_pages_redeploy", "Open the website in a private browser window to verify sign-in and Guest preview with the deployed configuration.": "interface.messages.setup_pages_verify", "The workflow generates js/config.js. Uploading a downloaded config.js to the repository does not configure the Pages artifact. No configuration file upload is needed for this workflow.": "interface.messages.setup_pages_generated_config", "Direct static hosting": "interface.messages.setup_direct_hosting", "Download config.js and upload it as js/config.js in the website installation directory. Browser-only setup configures this browser, not other visitors.": "interface.messages.setup_direct_config", "In the private local function environment file, set RSVP_SITE_ORIGIN to {origin} and RSVP_SITE_URL to {siteUrl}.": "interface.messages.setup_local_site_settings", "Food Interest Reply": "interface.messages.food_interest_reply_title", "Food interest": "interface.messages.food_interest_reporting", "Unanswered": "interface.messages.food_interest_unanswered", "Reply when no deadline is set": "interface.messages.food_interest_no_deadline_reply", "Shown after a saved Yes in Collect interest. Use {invite-deadline:+5} for the RSVP deadline plus five calendar days in the event timezone. Blank text uses the fallback language, then English.": "interface.messages.food_interest_reply_help", "Thank you! We’ll share more information about the food later.": "interface.messages.food_interest_reply_default", "Invalid food interest reply": "interface.messages.food_interest_reply_invalid", "Invalid food interest reply placeholder": "interface.messages.food_interest_reply_placeholder_invalid", "Food interest reply changed; refresh before saving": "interface.messages.food_interest_reply_changed", "Food explanation changed; refresh before saving": "interface.messages.food_explanation_changed", "Invalid food explanation": "interface.messages.food_explanation_invalid", "Available placeholders": "interface.messages.available_placeholders", "Insert": "interface.messages.insert_placeholder", "Insert a placeholder at the cursor.": "interface.messages.placeholder_cursor_hint", "RSVP deadline date": "interface.messages.rsvp_deadline_date", "Five days after the RSVP deadline": "interface.messages.deadline_plus_five", "Two days before the RSVP deadline": "interface.messages.deadline_minus_two", "Change the offset from −366 to +366 calendar days. Without a deadline, the no-deadline reply is used.": "interface.messages.deadline_offset_help", "Discard unsaved translation changes?": "interface.messages.discard_translation_changes", "Adults": "interface.messages.adults_count_label", "Children": "interface.messages.children_count_label", "Contributing households": "interface.messages.contributing_households", "Attendance totals across sessions": "interface.messages.attendance_session_totals", "Encrypt backup": "interface.messages.backup_encrypt", "Backup password": "interface.messages.backup_password", "Confirm backup password": "interface.messages.backup_password_confirm", "Keep this password safe. An encrypted backup cannot be recovered without it.": "interface.messages.backup_password_recovery_warning", "Encryption requires HTTPS, Web Crypto and Web Workers. Unencrypted backups remain available.": "interface.messages.backup_crypto_unavailable", "Enter a backup password.": "interface.messages.backup_password_required", "Backup passwords do not match.": "interface.messages.backup_password_mismatch", "Backup password exceeds 1024 UTF-8 bytes.": "interface.messages.backup_password_limit", "Another backup encryption operation is running.": "interface.messages.backup_crypto_busy", "Backup key derivation could not complete. Try again on a device with more available memory.": "interface.messages.backup_kdf_failed", "Unsupported or damaged encrypted backup.": "interface.messages.backup_encrypted_invalid", "Unsupported backup encryption parameters.": "interface.messages.backup_kdf_parameters_invalid", "Incorrect password or damaged backup.": "interface.messages.backup_auth_failed", "Open encrypted backup": "interface.messages.backup_encrypted_open", "Encrypted backup": "interface.messages.backup_encrypted_title", "Enter this file’s backup password. It is not your administrator password.": "interface.messages.backup_file_password_hint", "Opening encrypted backup cancelled.": "interface.messages.backup_encrypted_cancelled", "Automatic setup": "interface.messages.setup_auto_automatic_setup_eef40", "Connect your cloud Supabase project. The temporary local companion handles privileged setup and forgets its credentials when finished.": "interface.messages.setup_auto_connect_your_cloud_supabase_project_the_temporary_local_companion_6ec9c", "Start the trusted setup companion": "interface.messages.setup_auto_start_the_trusted_setup_companion_d20c9", "Run this command from your downloaded release on your own computer, then open the local address it prints.": "interface.messages.setup_auto_run_this_command_from_your_downloaded_release_on_your_own_compute_8f2c4", "For Local Supabase or manual installation, use the existing setup guide.": "interface.messages.setup_auto_for_local_supabase_or_manual_installation_use_the_existing_setup__238bd", "Manual setup": "interface.messages.setup_auto_manual_setup_28315", "Database": "interface.messages.setup_auto_database_fa7fe", "Secrets": "interface.messages.setup_auto_secrets_d8707", "Edge Functions": "interface.messages.setup_auto_edge_functions_127c1", "Configuration": "interface.messages.setup_auto_configuration_b332c", "Verification": "interface.messages.setup_auto_verification_7140f", "Credentials are sent only to this local companion and Supabase. They are not saved in browser storage or project files.": "interface.messages.setup_auto_credentials_are_sent_only_to_this_local_companion_and_supabase_th_32033", "Secret or service_role key": "interface.messages.setup_auto_secret_or_service_role_key_54cd5", "Project reference ID": "interface.messages.setup_auto_project_reference_id_3d139", "Supabase Management API access token": "interface.messages.setup_auto_supabase_management_api_access_token_fe951", "Website base URL": "interface.messages.setup_auto_website_base_url_32c44", "Use a dedicated project and a token with project, database, Auth configuration, Edge Function and secret read/write permissions.": "interface.messages.setup_auto_use_a_dedicated_project_and_a_token_with_project_database_auth_co_c4899", "Validate connection": "interface.messages.setup_auto_validate_connection_8ee4a", "Initialize database": "interface.messages.setup_auto_initialize_database_a879f", "Install the current schema, or add missing objects in a compatible partial installation. Existing rows are kept. Incompatible schemas and initialized applications are not overwritten.": "interface.messages.setup_auto_install_the_current_schema_or_add_missing_objects_in_a_compatible_750e2", "Create first administrator": "interface.messages.setup_auto_create_first_administrator_dbf56", "The account is created in Supabase Authentication and confirmed directly. An existing account requires its current password.": "interface.messages.setup_auto_the_account_is_created_in_supabase_authentication_and_confirmed_d_a768b", "Create and verify administrator": "interface.messages.setup_auto_create_and_verify_administrator_91c60", "Configure Edge Function secrets": "interface.messages.setup_auto_configure_edge_function_secrets_39cf1", "Configure RSVP_SITE_ORIGIN and RSVP_SITE_URL for the website address. Supabase provides its platform credentials automatically. No third-party secret is required by the current application.": "interface.messages.setup_auto_configure_rsvp_site_origin_and_rsvp_site_url_for_the_website_addr_472ac", "Add optional secret": "interface.messages.setup_auto_add_optional_secret_bc76c", "Configure secrets": "interface.messages.setup_auto_configure_secrets_cb4f0", "Deploy Edge Functions": "interface.messages.setup_auto_deploy_edge_functions_d5f86", "Deploy and verify guest-gateway and admin-invitations from this release. Other functions are left alone. Existing conflicting JWT settings require review instead of being silently changed.": "interface.messages.setup_auto_deploy_and_verify_guest_gateway_and_admin_invitations_from_this_r_c2cd9", "Application configuration": "interface.messages.setup_auto_application_configuration_923dc", "Configure the website URL, administrator invitation redirect and Data API schemas. Keep the event unpublished and retain existing settings.": "interface.messages.setup_auto_configure_the_website_url_administrator_invitation_redirect_and_d_c958a", "Configure application": "interface.messages.setup_auto_configure_application_c1a62", "Verify installation": "interface.messages.setup_auto_verify_installation_a598e", "Check schema, administrator permissions, secrets, function configuration and protected runtime responses before marking setup complete.": "interface.messages.setup_auto_check_schema_administrator_permissions_secrets_function_configura_92d32", "Verify and finish setup": "interface.messages.setup_auto_verify_and_finish_setup_699c3", "Setup complete": "interface.messages.setup_auto_setup_complete_aadaf", "The application is initialized. The event remains unpublished.": "interface.messages.setup_auto_the_application_is_initialized_the_event_remains_unpublished_2382c", "Download the public browser configuration for your hosting installation. Only the project URL and public key are included. For GitHub Pages, set the existing Actions connection variables and redeploy.": "interface.messages.setup_auto_download_the_public_browser_configuration_for_your_hosting_instal_31b8e", "Download public configuration": "interface.messages.setup_auto_download_public_configuration_6d95f", "Continue to administrator login": "interface.messages.setup_auto_continue_to_administrator_login_c12e3", "Continuing configures this browser for sign-in. Publish the public configuration to configure the website for other devices.": "interface.messages.setup_auto_continuing_configures_this_browser_for_sign_in_publish_the_public_70560", "Disconnect and forget credentials": "interface.messages.setup_auto_disconnect_and_forget_credentials_9a363", "Setup could not complete this step. Retry after checking the project connection and permissions.": "interface.messages.setup_auto_setup_could_not_complete_this_step_retry_after_checking_the_proje_d1b01", "Step completed.": "interface.messages.setup_auto_step_completed_8c6f7", "Secret name": "interface.messages.setup_auto_secret_name_5cdf5", "Secret value": "interface.messages.setup_auto_secret_value_6ef47", "Automatic cloud setup with the trusted local companion": "interface.messages.setup_auto_automatic_cloud_setup_with_the_trusted_local_companion_c569e", "Invalid public connection configuration.": "interface.messages.setup_auto_invalid_public_connection_configuration_460d6", "Existing installation detected. No project settings were changed.": "interface.messages.setup_auto_existing_installation_detected_no_project_settings_were_changed_2c011", "Setup steps": "interface.messages.setup_auto_setup_steps_1eba9", "Working…": "interface.messages.setup_auto_working_5474e", "Remove": "interface.messages.setup_auto_remove_c3812"}'::jsonb$$;


--
-- Name: valid_guest_design(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.valid_guest_design(design jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
DECLARE mode text;k text;
BEGIN
 IF design IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(design)<>'object' OR octet_length(design::text)>2048 OR (SELECT count(*) FROM jsonb_object_keys(design))<>5
 OR NOT(design ?& ARRAY['dark','light','opacity','darken','position']) OR jsonb_typeof(design->'position') IS DISTINCT FROM 'string' OR design->>'position' NOT IN ('top','center','bottom') THEN RETURN false;END IF;
 IF jsonb_typeof(design->'opacity')<>'number' OR (design->>'opacity')::numeric NOT BETWEEN 35 AND 100 OR (design->>'opacity')::numeric<>trunc((design->>'opacity')::numeric)
 OR jsonb_typeof(design->'darken')<>'number' OR (design->>'darken')::numeric NOT BETWEEN 0 AND 70 OR (design->>'darken')::numeric<>trunc((design->>'darken')::numeric) THEN RETURN false;END IF;
 FOREACH mode IN ARRAY ARRAY['dark','light'] LOOP
  IF jsonb_typeof(design->mode)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(design->mode))<>3 OR NOT(design->mode ?& ARRAY['box','text','button']) THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['box','text','button'] LOOP IF jsonb_typeof(design->mode->k)<>'string' OR design->mode->>k !~ '^#[a-fA-F0-9]{6}$' THEN RETURN false;END IF;END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $_$;


--
-- Name: valid_notification_preferences(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.valid_notification_preferences(p jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE scope text;policy jsonb;
BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR NOT(p?'admin' AND p?'guest') THEN RETURN false;END IF;
 FOREACH scope IN ARRAY ARRAY['admin','guest'] LOOP
  policy:=p->scope;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(policy))<>(2 + CASE WHEN policy?'autoDismiss' THEN 1 ELSE 0 END + CASE WHEN policy?'showTimestamp' THEN 1 ELSE 0 END) OR jsonb_typeof(policy->'preset') IS DISTINCT FROM 'string' OR policy->>'preset' NOT IN ('all','errors','custom') OR jsonb_typeof(policy->'types') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF policy?'autoDismiss' AND jsonb_typeof(policy->'autoDismiss') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF policy?'showTimestamp' AND jsonb_typeof(policy->'showTimestamp') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'types') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'string' OR t#>>'{}' NOT IN ('info','success','warning','error')) OR (SELECT count(*) FROM jsonb_array_elements(policy->'types'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(policy->'types')) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;


--
-- Name: valid_permissions(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.valid_permissions(p jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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


--
-- Name: valid_planning_configuration(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.valid_planning_configuration(config jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE item jsonb; group_id text; ids text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(config) IS DISTINCT FROM 'object' OR octet_length(config::text)>65536
  OR jsonb_typeof(config->'groups') IS DISTINCT FROM 'array'
  OR jsonb_typeof(config->'labels') IS DISTINCT FROM 'object'
  OR NOT app_private.valid_planning_names(config->'labels'->'households')
  OR NOT app_private.valid_planning_names(config->'labels'->'guests') THEN RETURN false;END IF;
 IF jsonb_array_length(config->'groups') NOT BETWEEN 1 AND 40 THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(config->'groups') LOOP
  group_id:=item->>'id';
  IF group_id IS NULL OR group_id !~ '^[a-z][a-z0-9_]{0,63}$' OR group_id=ANY(ids)
   OR NOT app_private.valid_planning_names(item->'names') OR item->'names'->>'en' IS NULL THEN RETURN false;END IF;
  ids:=array_append(ids,group_id);
 END LOOP;
 RETURN true;
END $_$;


--
-- Name: valid_planning_names(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.valid_planning_names(names jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$
 SELECT CASE WHEN jsonb_typeof(names)='object' THEN NOT EXISTS(
  SELECT 1 FROM jsonb_each(names) AS name(code,value)
  WHERE code !~ '^[A-Za-z0-9-]{2,16}$' OR jsonb_typeof(value)<>'string'
   OR length(btrim(value#>>'{}')) NOT BETWEEN 1 AND 140
 ) ELSE false END
$_$;


--
-- Name: valid_primary_contact_delivery(text, text, text); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.valid_primary_contact_delivery(p_type text, p_method text, p_value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$
 SELECT coalesce(
  (p_type='email' AND p_method='email' AND btrim(p_value) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
  OR (p_type='phone' AND p_method IN ('sms','whatsapp') AND btrim(p_value) ~ '^[+]?[0-9 .()/-]+$'
   AND length(regexp_replace(p_value,'[^0-9]','','g'))>=5),false);
$_$;


--
-- Name: validate_backup(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.validate_backup(b jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE t text;row jsonb;k text;cols text[];payload jsonb:=b->'payload';n bigint:=0;
BEGIN
 IF b->>'format' IS DISTINCT FROM 'rsvp-application-backup' OR b->>'version' IS DISTINCT FROM '2' OR jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Unsupported backup format or version';END IF;
 IF payload->>'schema_version' IS DISTINCT FROM '20261114034908' THEN RAISE EXCEPTION 'Backup schema version does not match. Export a new application backup from the current version.';END IF;
 IF octet_length(b::text)>20971520 THEN RAISE EXCEPTION 'Backup exceeds 20 MB';END IF;
 IF b->>'checksum' IS DISTINCT FROM encode(sha256(convert_to(payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Backup checksum mismatch';END IF;
 IF jsonb_typeof(payload->'tables') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'columns') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'counts') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'identities') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete backup manifest';END IF;
 IF (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(payload->'tables') x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(app_private.backup_tables()) x) THEN RAISE EXCEPTION 'Backup table set does not match this application';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF payload->'columns'->t IS DISTINCT FROM app_private.backup_columns(t) THEN RAISE EXCEPTION 'Schema mismatch for %. Install matching application migrations first',t;END IF;
  IF jsonb_typeof(payload->'tables'->t) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid table data: %',t;END IF;
  IF payload->'counts'->>t IS DISTINCT FROM jsonb_array_length(payload->'tables'->t)::text THEN RAISE EXCEPTION 'Row count mismatch: %',t;END IF;
  SELECT array_agg(col->>'name') INTO cols FROM jsonb_array_elements(payload->'columns'->t) col;
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(row))<>cardinality(cols) THEN RAISE EXCEPTION 'Missing fields in %',t;END IF;
   FOR k IN SELECT jsonb_object_keys(row) LOOP IF NOT k=ANY(cols) THEN RAISE EXCEPTION 'Unknown field in %',t;END IF;END LOOP;
  END LOOP;
  n:=n+jsonb_array_length(payload->'tables'->t);
 END LOOP;
 IF jsonb_array_length(payload->'tables'->'public.event_settings')<>1 THEN RAISE EXCEPTION 'Exactly one event settings record is required';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'identities') u WHERE nullif(u->>'id','') IS NULL OR nullif(u->>'email','') IS NULL)
 OR (SELECT count(*) FROM jsonb_array_elements(payload->'identities'))<>(SELECT count(DISTINCT u->>'id') FROM jsonb_array_elements(payload->'identities') u) THEN RAISE EXCEPTION 'Invalid identity manifest';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h WHERE nullif(h->>'primary_guest_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.guests') g WHERE g->>'id'=h->>'primary_guest_id' AND g->>'is_child'='false' AND (g->>'archived_at') IS NULL)) THEN RAISE EXCEPTION 'Invalid primary guest in backup';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h
  JOIN jsonb_array_elements(payload->'tables'->'public.household_contacts') c ON c->>'household_id'=h->>'id'
  WHERE c->>'is_household_primary'='true' AND h->>'primary_guest_id' IS NOT NULL
 ) THEN RAISE EXCEPTION 'Multiple primary contacts in backup';END IF;

  IF NOT app_private.valid_planning_configuration((payload->'tables'->'public.event_settings'->0->'planning_config'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h WHERE NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements((payload->'tables'->'public.event_settings'->0->'planning_config')->'groups') g
     WHERE g->>'id'=h->>'planning_group_id'
    )) THEN RAISE EXCEPTION 'Invalid household groups in backup';END IF;

 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.relation_groups') r WHERE r->>'planning_group_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.event_settings'->0->'planning_config'->'groups') g WHERE g->>'id'=r->>'planning_group_id'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h JOIN jsonb_array_elements(payload->'tables'->'public.relation_groups') r ON r->>'id'=h->>'relation_group_id' WHERE r->>'planning_group_id' IS NOT NULL AND r->>'planning_group_id'<>h->>'planning_group_id') THEN RAISE EXCEPTION 'Invalid relational group scope in backup';END IF;
 PERFORM app_private.validate_food_category_tree(payload->'tables'->'public.food_categories'); PERFORM app_private.validate_backup_selection(payload); RETURN jsonb_build_object('selection',payload->'selection','rows',n,'counts',payload->'counts','event_name',payload->'tables'->'public.event_settings'->0->>'event_name','created_at',payload->>'created_at');
END $$;


--
-- Name: validate_backup_selection(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.validate_backup_selection(payload jsonb) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
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


--
-- Name: validate_food_category_tree(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.validate_food_category_tree(p_categories jsonb) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE invalid boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.food_categories,p_categories) c GROUP BY id HAVING id IS NULL OR count(*)>1) THEN RAISE EXCEPTION 'Food category hierarchy contains duplicate or missing IDs';END IF;
 WITH RECURSIVE categories AS (SELECT id,parent_id FROM jsonb_populate_recordset(NULL::public.food_categories,p_categories)),
 reachable(id,depth) AS (SELECT id,1 FROM categories WHERE parent_id IS NULL UNION ALL SELECT c.id,p.depth+1 FROM categories c JOIN reachable p ON c.parent_id=p.id WHERE p.depth<9)
 SELECT (SELECT count(*) FROM categories)<>(SELECT count(DISTINCT id) FROM reachable) OR EXISTS(SELECT 1 FROM reachable WHERE depth>8) OR (SELECT count(*) FROM categories)<>(SELECT count(DISTINCT id) FROM categories) INTO invalid;
 IF invalid THEN RAISE EXCEPTION 'Food category hierarchy must have valid parents, no cycles and at most 8 levels';END IF;
END $$;


--
-- Name: validate_food_item_settings(); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.validate_food_item_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
 IF NEW.quantity_type NOT IN ('Batch(s)','Piece(s)','Tray(s)','Packet(s)','Kg','Grams')
 AND NOT EXISTS(SELECT 1 FROM public.food_item_types WHERE name=NEW.quantity_type) THEN
  RAISE EXCEPTION 'Unknown food item type';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.venue_ids) AS selected(id)
   WHERE NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=selected.id)) THEN
  RAISE EXCEPTION 'Unknown food venue';
 END IF;
 RETURN NEW;
END $$;


--
-- Name: validate_private_jpeg(jsonb); Type: FUNCTION; Schema: app_private; Owner: -
--

CREATE FUNCTION app_private.validate_private_jpeg(background jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
DECLARE data bytea;n integer;pos integer:=2;marker integer;len integer;w integer;h integer;c jsonb;key text;value numeric;
BEGIN
 IF jsonb_typeof(background) IS DISTINCT FROM 'object' OR octet_length(background::text)>2000000 OR background->>'image' IS NULL OR length(background->>'image')>1900000 OR background->>'image' !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' OR length(coalesce(background->>'name',''))>180 THEN RAISE EXCEPTION 'Choose a JPEG under 1.4 MB.';END IF;
 BEGIN data:=decode(split_part(background->>'image',',',2),'base64');EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid JPEG image.';END;
 n:=octet_length(data);IF n<12 OR n>1400000 OR get_byte(data,0)<>255 OR get_byte(data,1)<>216 OR get_byte(data,n-2)<>255 OR get_byte(data,n-1)<>217 THEN RAISE EXCEPTION 'Invalid JPEG image.';END IF;
 WHILE pos<n-3 LOOP
  IF get_byte(data,pos)<>255 THEN RAISE EXCEPTION 'Invalid JPEG image.';END IF;
  WHILE pos<n AND get_byte(data,pos)=255 LOOP pos:=pos+1;END LOOP;IF pos>=n THEN EXIT;END IF;
  marker:=get_byte(data,pos);pos:=pos+1;
  IF marker IN (217,218) THEN EXIT;END IF;
  IF marker=1 OR marker BETWEEN 208 AND 215 THEN CONTINUE;END IF;
  IF pos+1>=n THEN EXIT;END IF;len:=get_byte(data,pos)*256+get_byte(data,pos+1);
  IF len<2 OR pos+len>n THEN RAISE EXCEPTION 'Invalid JPEG image.';END IF;
  IF marker IN(192,193,194,195,197,198,199,201,202,203,205,206,207) THEN
   IF len<8 THEN RAISE EXCEPTION 'Invalid JPEG image.';END IF;
   h:=get_byte(data,pos+3)*256+get_byte(data,pos+4);w:=get_byte(data,pos+5)*256+get_byte(data,pos+6);EXIT;
  END IF;
  pos:=pos+len;
 END LOOP;
 IF w IS NULL OR h IS NULL OR w NOT BETWEEN 1 AND 12000 OR h NOT BETWEEN 1 AND 12000 OR w::bigint*h>40000000 THEN RAISE EXCEPTION 'JPEG dimensions are too large or invalid.';END IF;
 c:=background->'crop';IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid photo crop.';END IF;
 FOREACH key IN ARRAY ARRAY['x','y','width','height','sourceWidth','sourceHeight'] LOOP
  IF jsonb_typeof(c->key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid photo crop.';END IF;
  value:=(c->>key)::numeric;IF value<0 OR value<>trunc(value) OR value>12000 THEN RAISE EXCEPTION 'Invalid photo crop.';END IF;
 END LOOP;
 IF (c->>'sourceWidth')::integer<>w OR (c->>'sourceHeight')::integer<>h OR (c->>'width')::integer<1 OR (c->>'height')::integer<1 OR (c->>'x')::integer+(c->>'width')::integer>w OR (c->>'y')::integer+(c->>'height')::integer>h THEN RAISE EXCEPTION 'Invalid photo crop.';END IF;
END $_$;


--
-- Name: add_household_guest(text, uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_household_guest(p_code text, p_guest_id uuid, p_first_name text, p_last_name text, p_is_child boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE h public.households; existing public.guests; deadline timestamptz;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_guest_id IS NULL OR p_is_child IS NULL OR nullif(btrim(p_first_name),'') IS NULL OR length(p_first_name)>120 OR p_last_name IS NULL OR length(p_last_name)>120 THEN RAISE EXCEPTION 'Invalid guest details';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation';END IF;
 SELECT * INTO existing FROM public.guests WHERE id=p_guest_id;
 IF FOUND THEN
  IF existing.household_id<>h.id OR existing.archived_at IS NOT NULL OR existing.first_name<>btrim(p_first_name) OR coalesce(existing.last_name,'')<>btrim(p_last_name) OR existing.is_child<>p_is_child THEN RAISE EXCEPTION 'Guest request changed';END IF;
  RETURN app_private.guest_invitation(h);
 END IF;
 IF h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=h.id) THEN RAISE EXCEPTION 'Guests cannot be added after an RSVP submission';END IF;
 SELECT rsvp_deadline INTO deadline FROM public.event_settings WHERE id=1;
 IF deadline IS NOT NULL AND clock_timestamp()>deadline AND (h.late_submission_until IS NULL OR clock_timestamp()>h.late_submission_until) THEN RAISE EXCEPTION 'RSVP deadline passed';END IF;
 IF (SELECT count(*) FROM public.guests WHERE household_id=h.id AND archived_at IS NULL)>=20 THEN RAISE EXCEPTION 'Contact the organizer to add more guests';END IF;
 INSERT INTO public.guests(id,household_id,first_name,last_name,is_child,language) VALUES(p_guest_id,h.id,btrim(p_first_name),nullif(btrim(p_last_name),''),p_is_child,h.language);
 RETURN app_private.guest_invitation(h);
END $_$;


--
-- Name: admin_accept_invitation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_accept_invitation(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE actor uuid; e text; i public.admin_invitations%ROWTYPE;
BEGIN
 actor:=app_private.require_live_session();
 -- Serialize membership additions with the existing last-admin/revocation guard.
 PERFORM pg_advisory_xact_lock(42319,11);
 SELECT lower(email) INTO e FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL;
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e IS NULL OR i.email<>e OR i.status<>'pending' OR i.delivery_state<>'sent' OR i.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by AND access_state='active' AND access_permissions->'sections'->>'administrators'='edit') THEN RAISE EXCEPTION 'No active invitation for this verified account' USING ERRCODE='42501';END IF;
 INSERT INTO public.admins(user_id,name,access_permissions) VALUES(actor,i.name,coalesce((SELECT permissions FROM app_private.pending_admin_permissions WHERE invitation_id=i.id),app_private.permission_preset('view'))) ON CONFLICT(user_id) DO NOTHING;
 IF FOUND THEN INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(i.invited_by,actor,'add',jsonb_build_object('name',i.name,'source','accepted_invitation'));END IF;
 UPDATE public.admin_invitations SET status='accepted',accepted_by=actor,accepted_at=clock_timestamp() WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email) VALUES(i.id,actor,'invitation_accepted',e);
END $$;


--
-- Name: admin_add_existing_user(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_add_existing_user(p_email text, p_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE target uuid;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a display name';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);SELECT id INTO target FROM auth.users WHERE lower(email)=lower(btrim(p_email)) AND email_confirmed_at IS NOT NULL;
 IF target IS NULL THEN RAISE EXCEPTION 'No eligible verified Auth account found';END IF;
 INSERT INTO public.admins(user_id,name,access_permissions) VALUES(target,btrim(p_name),app_private.permission_preset('view'));
 INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),target,'add',jsonb_build_object('name',btrim(p_name),'source','verified_manual','access','view'));
 RETURN jsonb_build_object('user_id',target);
END $$;


--
-- Name: admin_add_venue_food(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_add_venue_food(p_venue_id uuid, p_food_item_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE item_id uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_add_venue_food');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_food_item_ids),0) NOT BETWEEN 1 AND 2000 OR array_position(p_food_item_ids,NULL) IS NOT NULL
 THEN RAISE EXCEPTION 'Select food items'; END IF;
 PERFORM 1 FROM public.event_locations WHERE id=p_venue_id AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active venue required'; END IF;
 FOR item_id IN SELECT DISTINCT id FROM unnest(p_food_item_ids) AS selected(id) ORDER BY id LOOP
  UPDATE public.food_items
  SET venue_ids=CASE WHEN p_venue_id=ANY(venue_ids) THEN venue_ids ELSE array_append(coalesce(venue_ids,ARRAY[]::uuid[]),p_venue_id) END
  WHERE id=item_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active food item required'; END IF;
 END LOOP;
END $$;


--
-- Name: admin_authorize_device_send(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_authorize_device_send(p_queue_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('sendInvites');
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN
  RAISE EXCEPTION 'Invitation delivery opens when the event is published.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.invitation_send_queue q JOIN public.households h ON h.id=q.household_id WHERE q.id=p_queue_id AND q.status='ready' AND h.archived_at IS NULL AND q.invitation_code_snapshot=h.invite_code) THEN RAISE EXCEPTION 'Refresh and save this delivery again before sending';END IF;
 RETURN true;
END $$;


--
-- Name: admin_authorize_late_rsvp(uuid, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_authorize_late_rsvp(p_household_id uuid, p_until timestamp with time zone, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_authorize_late_rsvp');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 OR p_until IS NULL OR NOT isfinite(p_until) OR p_until<=clock_timestamp() THEN RAISE EXCEPTION 'Valid future expiry and reason required';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'open' THEN RAISE EXCEPTION 'Active open household required';END IF;
 UPDATE public.households SET late_submission_until=p_until WHERE id=h.id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason) VALUES(h.id,auth.uid(),'late_submission_authorized',h.latest_rsvp_submission_id,btrim(p_reason));
END $$;


--
-- Name: admin_cancel_invitation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_cancel_invitation(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE actor uuid; i public.admin_invitations%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_cancel_invitation');
 actor:=app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'pending' THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 UPDATE public.admin_invitations SET status='cancelled' WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email) VALUES(i.id,actor,'invitation_cancelled',i.email);
END $$;


--
-- Name: admin_confirm_invitation_sent(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_confirm_invitation_sent(p_queue_id uuid, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;h public.households%ROWTYPE;hid uuid;v_id uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_confirm_invitation_sent');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Delivery note is too long';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN
  RAISE EXCEPTION 'Invitation delivery opens when the event is published.';
 END IF;
 SELECT household_id INTO hid FROM public.invitation_send_queue WHERE id=p_queue_id;
 SELECT * INTO h FROM public.households WHERE id=hid FOR UPDATE;
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF q.status='sent' THEN SELECT id INTO v_id FROM public.invitation_deliveries WHERE queue_id=q.id;RETURN v_id;END IF;
 IF q.status<>'ready' THEN RAISE EXCEPTION 'Queue item must be ready';END IF;
 IF h.archived_at IS NOT NULL OR h.invite_code IS NULL OR q.invitation_code_snapshot IS DISTINCT FROM h.invite_code THEN RAISE EXCEPTION 'Invitation has changed; prepare the delivery again';END IF;
 IF nullif(btrim(q.recipient_snapshot->>'contact_value'),'') IS NULL THEN RAISE EXCEPTION 'Recipient details required; prepare the delivery again';END IF;
 INSERT INTO public.invitation_deliveries(queue_id,confirmed_by,recipient_snapshot,message_snapshot,delivery_note) VALUES(q.id,auth.uid(),q.recipient_snapshot,jsonb_build_object('channel',q.channel,'subject',q.message_subject,'body',q.message_body),nullif(btrim(p_note),'')) RETURNING id INTO v_id;
 UPDATE public.invitation_send_queue SET status='sent',revision=revision+1,updated_at=clock_timestamp() WHERE id=q.id;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value,reason) VALUES(q.id,auth.uid(),'confirmed_sent',jsonb_build_object('status','ready'),jsonb_build_object('status','sent','delivery_id',v_id),nullif(btrim(p_note),''));
 RETURN v_id;
END $$;


--
-- Name: admin_correct_rsvp(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_correct_rsvp(p_guest_id uuid, p_session_id uuid, p_status text, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE hid uuid;v_old text;
BEGIN PERFORM app_private.require_admin_operation('admin_correct_rsvp');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_status IS NULL OR p_status NOT IN ('attending','declined') OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Valid response and reason required';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT household_id INTO hid FROM public.guests WHERE id=p_guest_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active guest required';END IF;
 PERFORM 1 FROM public.households WHERE id=hid AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.effective_session_invitations WHERE guest_id=p_guest_id AND session_id=p_session_id AND requires_rsvp) THEN RAISE EXCEPTION 'Guest is not invited to this RSVP session';END IF;
 SELECT rsvp_status INTO v_old FROM public.guest_session_responses WHERE guest_id=p_guest_id AND session_id=p_session_id;
 IF v_old=p_status THEN RETURN;END IF;
 INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status) VALUES(p_guest_id,p_session_id,p_status) ON CONFLICT(guest_id,session_id) DO UPDATE SET rsvp_status=excluded.rsvp_status,updated_at=clock_timestamp();
 INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,actor_user_id,action,previous_status,new_status,reason) VALUES(hid,p_guest_id,p_session_id,auth.uid(),'admin_correction',v_old,p_status,btrim(p_reason));
END $$;


--
-- Name: admin_create_guest(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_guest(p_household_id uuid, p_values jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE; v_id uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_create_guest');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=p_household_id) THEN RAISE EXCEPTION 'Guests can only be added to active households without submitted RSVPs'; END IF;
 INSERT INTO public.guests(household_id,first_name) VALUES(p_household_id,'New guest') RETURNING id INTO v_id;
 PERFORM public.admin_update_guest(v_id,p_values->>'first_name',p_values->>'last_name',p_values->>'courtesy_title',p_values->>'relation',p_values->>'language',coalesce((p_values->>'is_child')::boolean,false),p_values->>'dietary_requirements',p_values->>'notes');
 RETURN v_id;
END $$;


--
-- Name: admin_delete_archived_record(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_archived_record(p_entity text, p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE before_value jsonb;household_id uuid; unpublished boolean;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT NOT is_published INTO unpublished FROM public.event_settings WHERE id=1;
 IF p_entity='households' THEN
  IF NOT EXISTS(SELECT 1 FROM public.households h WHERE h.id=p_id AND (h.archived_at IS NOT NULL OR unpublished)) THEN
   RAISE EXCEPTION 'Choose a record that can be deleted.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=p_id) OR EXISTS(SELECT 1 FROM public.households h WHERE h.parent_id=p_id) THEN
   RAISE EXCEPTION 'Move or delete guests and child households first.';
  END IF;
  DELETE FROM public.household_session_defaults d WHERE d.household_id=p_id;
  DELETE FROM public.household_contacts c WHERE c.household_id=p_id;
  DELETE FROM public.households h WHERE h.id=p_id
  RETURNING to_jsonb(h)-'invite_code',h.id INTO before_value,household_id;
 ELSIF p_entity='guests' THEN
  IF NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.id=p_id AND (g.archived_at IS NOT NULL OR unpublished)) THEN
   RAISE EXCEPTION 'Choose a record that can be deleted.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.households h WHERE h.primary_guest_id=p_id)
    OR EXISTS(SELECT 1 FROM public.household_contacts c WHERE c.guest_id=p_id) THEN
   RAISE EXCEPTION 'Remove this guest’s household contact assignments first.';
  END IF;
  DELETE FROM public.guest_session_overrides o WHERE o.guest_id=p_id;
  DELETE FROM public.guests g WHERE g.id=p_id
  RETURNING to_jsonb(g),g.household_id INTO before_value,household_id;
 ELSE
  RAISE EXCEPTION 'Invalid archived record type';
 END IF;
 IF before_value IS NULL THEN RAISE EXCEPTION 'Choose a record that can be deleted.'; END IF;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value)
 VALUES(household_id,p_entity,p_id,auth.uid(),'delete',before_value);
EXCEPTION WHEN foreign_key_violation THEN
 RAISE EXCEPTION 'This record is linked to other records or history and must stay archived';
END $$;


--
-- Name: admin_delete_food_category(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_food_category(p_category_id uuid, p_expected_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE category public.food_categories;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO category FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF category.name IS DISTINCT FROM p_expected_name THEN RAISE EXCEPTION 'Category changed; reload before deleting';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE f.category=category.name) OR EXISTS(SELECT 1 FROM public.food_groups g WHERE g.category=category.name) THEN RAISE EXCEPTION 'Move items to another category before deleting this category.';END IF;
 IF EXISTS(SELECT 1 FROM public.food_categories WHERE parent_id=p_category_id) THEN RAISE EXCEPTION 'Move sub-categories before deleting this category.';END IF; DELETE FROM public.food_categories WHERE id=p_category_id;
END $$;


--
-- Name: admin_delete_food_group(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_food_group(p_id uuid, p_expected_updated timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7745);
 PERFORM 1 FROM public.food_groups WHERE id=p_id AND updated_at=p_expected_updated FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food Group changed; refresh before removing';END IF;
 PERFORM 1 FROM public.food_items WHERE food_group_id=p_id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE f.food_group_id=p_id) THEN RAISE EXCEPTION 'Resolve existing commitments before changing a Food Group';END IF;
 UPDATE public.food_items SET food_group_id=NULL WHERE food_group_id=p_id;
 DELETE FROM public.food_groups WHERE id=p_id;
END $$;


--
-- Name: admin_delete_other_category(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_other_category(p_category_id uuid, p_expected_updated_at timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE category public.other_categories%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_delete_other_category');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO category FROM public.other_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF category.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Category changed; reload before deleting';END IF;
 IF EXISTS(SELECT 1 FROM public.other_items WHERE category_id=p_category_id) THEN RAISE EXCEPTION 'Move items to another category before deleting this category.';END IF;
 DELETE FROM public.other_categories WHERE id=p_category_id;
END $$;


--
-- Name: admin_edit_session_households(uuid, uuid[], uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_edit_session_households(p_session_id uuid, p_add uuid[], p_remove uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_household_id uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_edit_session_households');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_add IS NULL OR p_remove IS NULL OR cardinality(p_add)+cardinality(p_remove)>2000
    OR array_position(p_add,NULL) IS NOT NULL OR array_position(p_remove,NULL) IS NOT NULL
    OR p_add && p_remove THEN RAISE EXCEPTION 'Invalid household selections'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.event_sessions WHERE id=p_session_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
 FOR v_household_id IN SELECT DISTINCT id FROM unnest(p_add||p_remove) AS selected(id) ORDER BY id LOOP
  IF NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=v_household_id AND g.archived_at IS NULL)
  THEN RAISE EXCEPTION 'Household must have an active guest'; END IF;
  PERFORM public.admin_save_session_assignments(v_household_id,jsonb_build_array(jsonb_build_object(
   'session_id',p_session_id,'is_invited',v_household_id=ANY(p_add))));
 END LOOP;
END $$;


--
-- Name: admin_edit_venue_food(uuid, uuid[], uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_edit_venue_food(p_venue_id uuid, p_add uuid[], p_remove uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE item_id uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_edit_venue_food');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_add IS NULL OR p_remove IS NULL OR cardinality(p_add)+cardinality(p_remove)>2000
    OR array_position(p_add,NULL) IS NOT NULL OR array_position(p_remove,NULL) IS NOT NULL
    OR p_add && p_remove THEN RAISE EXCEPTION 'Invalid venue food selections'; END IF;
 PERFORM 1 FROM public.event_locations WHERE id=p_venue_id AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active venue required'; END IF;
 FOR item_id IN SELECT DISTINCT id FROM unnest(p_add||p_remove) AS selected(id) ORDER BY id LOOP
  IF item_id=ANY(p_add) THEN
   UPDATE public.food_items
   SET venue_ids=CASE WHEN p_venue_id=ANY(venue_ids) THEN venue_ids ELSE array_append(coalesce(venue_ids,ARRAY[]::uuid[]),p_venue_id) END
   WHERE id=item_id AND active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active food item required'; END IF;
  ELSE
   UPDATE public.food_items SET venue_ids=array_remove(
     coalesce(venue_ids,ARRAY(SELECT id FROM public.event_locations WHERE archived_at IS NULL ORDER BY id)),p_venue_id)
   WHERE id=item_id AND (p_venue_id=ANY(venue_ids) OR (venue_ids IS NULL AND active));
  END IF;
 END LOOP;
END $$;


--
-- Name: admin_export_backup(text, text[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_export_backup(p_mode text DEFAULT 'backup'::text, p_sections text[] DEFAULT ARRAY['venues'::text, 'households'::text, 'food'::text, 'other'::text, 'wording'::text], p_include_logs boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.require_admin_operation('admin_export_backup');
 result:=app_private.project_backup(app_private.seal_backup(app_private.backup_payload()),p_mode,p_sections,coalesce(p_include_logs,p_mode='backup'));
 PERFORM app_private.validate_backup(result);
 RETURN result;
END $$;


--
-- Name: admin_finish_invitation(uuid, uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_finish_invitation(p_id uuid, p_attempt_id uuid, p_sent boolean, p_error_code text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE i public.admin_invitations%ROWTYPE;
BEGIN
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR i.attempt_id<>p_attempt_id OR i.status<>'pending' OR i.delivery_state<>'sending' THEN RETURN false;END IF;
 UPDATE public.admin_invitations SET delivery_state=CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,sent_at=CASE WHEN p_sent THEN clock_timestamp() ELSE NULL END,last_error_code=CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error_code,'email_failed'),80) END WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) VALUES(i.id,i.invited_by,CASE WHEN p_sent THEN 'email_sent' ELSE 'email_failed' END,i.email,jsonb_build_object('error_code',CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error_code,'email_failed'),80) END));
 RETURN true;
END $$;


--
-- Name: admin_get_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_access() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 RETURN (SELECT jsonb_build_object('user_id',a.user_id,'state',a.access_state,'permissions',a.access_permissions,'session_id',nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id') FROM public.admins a WHERE user_id=auth.uid());
END $$;


--
-- Name: admin_guest_preview(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_guest_preview(p_household_id uuid DEFAULT NULL::uuid, p_sample boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households; invitation jsonb; food jsonb;
BEGIN
 PERFORM app_private.require_permission('households');
 PERFORM app_private.require_permission('invites');
 PERFORM app_private.require_permission('venues');
 IF (SELECT food_enabled FROM public.event_settings WHERE id=1) THEN PERFORM app_private.require_permission('food');END IF;
 IF p_sample THEN
  invitation:=jsonb_build_object(
   'household',jsonb_build_object('rsvp_state','open'),
   'guests',jsonb_build_array(jsonb_build_object('id','sample','first_name','Alex')),
   'invitations',(SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id','sample','session_id',s.id,'requires_rsvp',s.requires_rsvp) ORDER BY s.sort_order,s.id),'[]')
    FROM public.event_sessions s WHERE s.is_active)
  );
  food:=app_private.guest_food(NULL,true);
 ELSIF p_household_id IS NOT NULL THEN
  SELECT * INTO h FROM public.households WHERE id=p_household_id AND archived_at IS NULL AND EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=p_household_id AND g.archived_at IS NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'This household has no active invitation.'; END IF;
  invitation:=app_private.guest_invitation(h);
  IF h.food OR (SELECT food_stage FROM public.event_settings WHERE id=1)='interest' THEN food:=app_private.guest_food(h.id,false); END IF;
 END IF;
 RETURN jsonb_build_object('eventData',app_private.guest_event(),'invitation',invitation,'food',food);
END $$;


--
-- Name: admin_has_permission(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_has_permission(p_section text, p_level text DEFAULT 'view'::text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 SELECT (CASE WHEN p_section='food' THEN coalesce((SELECT food_enabled FROM public.event_settings WHERE id=1),false) WHEN p_section='other' THEN coalesce((SELECT other_enabled FROM public.event_settings WHERE id=1),false) ELSE true END) AND public.is_admin() AND coalesce((SELECT CASE WHEN p_section='full' THEN access_permissions->>'preset'='full' WHEN p_section IN ('sendInvites','exportBackup','restoreBackup','revokeSessions') THEN coalesce((access_permissions->>p_section)::boolean,false) WHEN p_level='edit' THEN access_permissions->'sections'->>p_section='edit' WHEN p_level='view' THEN access_permissions->'sections'->>p_section IN ('view','edit') ELSE false END FROM public.admins WHERE user_id=auth.uid()),false)
$$;


--
-- Name: admin_item_lifecycle(text, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_item_lifecycle(p_entity text, p_id uuid, p_action text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE item jsonb; refs jsonb; stamp timestamptz;
BEGIN
 PERFORM app_private.require_permission(CASE p_entity WHEN 'food_items' THEN 'food' WHEN 'other_items' THEN 'other' ELSE 'full' END,'edit');
 IF p_entity IS NULL OR p_entity NOT IN ('food_items','other_items') OR p_id IS NULL OR p_action IS NULL OR p_action NOT IN ('inspect','delete','archive','restore') THEN RAISE EXCEPTION 'Invalid item action';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',p_entity) INTO item USING p_id;
 IF item IS NULL THEN
  IF p_action='delete' THEN RETURN jsonb_build_object('deleted',true);END IF;
  RAISE EXCEPTION 'Item not found';
 END IF;
 refs:=app_private.item_dependencies(p_entity,p_id);
 IF p_action='inspect' THEN RETURN jsonb_build_object('dependencies',refs,'bound',jsonb_array_length(refs)>0,'archived',item->>'archived_at' IS NOT NULL,'updated_at',item->>'updated_at');END IF;
 IF p_expected_updated_at IS NULL OR (item->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Item changed; reload before saving';END IF;
 IF p_action='delete' THEN
  IF jsonb_array_length(refs)>0 THEN RAISE EXCEPTION 'This record is linked to other records or history and must stay archived' USING ERRCODE='23503';END IF;
  EXECUTE format('DELETE FROM public.%I WHERE id=$1',p_entity) USING p_id;
  RETURN jsonb_build_object('deleted',true);
 END IF;
 stamp:=CASE WHEN p_action='archive' THEN clock_timestamp() ELSE NULL END;
 EXECUTE format('UPDATE public.%I SET archived_at=$1,updated_at=clock_timestamp() WHERE id=$2 RETURNING to_jsonb(%I.*)',p_entity,p_entity) INTO item USING stamp,p_id;
 RETURN item;
END $_$;


--
-- Name: admin_list_invitations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_invitations() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN PERFORM app_private.require_admin_operation('admin_list_invitations');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'name',name,'status',status,'delivery_state',delivery_state,'attempts',attempts,'sent_at',sent_at,'expires_at',expires_at,'last_error_code',last_error_code,'created_at',created_at,'access_permissions',coalesce((SELECT permissions FROM app_private.pending_admin_permissions WHERE invitation_id=public.admin_invitations.id),app_private.permission_preset('view'))) ORDER BY created_at DESC),'[]'::jsonb) FROM public.admin_invitations WHERE status='pending');
END $$;


--
-- Name: admin_list_members(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_members() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('administrators');RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',a.name,'email',u.email,'created_at',a.created_at,'access_state',a.access_state,'access_permissions',a.access_permissions) ORDER BY a.created_at) FROM public.admins a JOIN auth.users u ON u.id=a.user_id),'[]');
END $$;


--
-- Name: admin_list_sessions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_sessions() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'name',a.name,'created_at',s.created_at,'refreshed_at',to_jsonb(s)->>'refreshed_at','last_activity',coalesce(to_jsonb(s)->>'refreshed_at',to_jsonb(s)->>'updated_at',s.created_at::text),'user_agent',left(coalesce(to_jsonb(s)->>'user_agent',''),300),'current',s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) ORDER BY s.created_at DESC) FROM auth.sessions s JOIN public.admins a ON a.user_id=s.user_id WHERE a.access_state='active' AND (s.user_id=auth.uid() OR public.admin_has_permission('revokeSessions')) AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>statement_timestamp()) AND NOT EXISTS(SELECT 1 FROM app_private.admin_session_revocations r WHERE r.session_id=s.id)),'[]');
END $$;


--
-- Name: admin_load_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_load_data() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h boolean:=public.admin_has_permission('households');i boolean:=public.admin_has_permission('invites');f boolean:=public.admin_has_permission('food');v boolean:=public.admin_has_permission('venues');l boolean:=public.admin_has_permission('languages');o boolean:=public.admin_has_permission('other');s boolean:=public.admin_has_permission('settings');result jsonb;t text;k text;rows jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 result:=jsonb_build_object(
 'settings',coalesce((SELECT CASE WHEN s THEN to_jsonb(e)||jsonb_build_object('guest_customization_revision',app_private.guest_customization_revision()) ELSE jsonb_build_object('id',e.id,'event_name',e.event_name,'event_date',e.event_date,'timezone',e.timezone,'default_language',e.default_language,'fallback_language',e.fallback_language,'is_published',e.is_published,'food_introduction',CASE WHEN l THEN e.food_introduction ELSE '{}'::jsonb END,'rsvp_deadline',CASE WHEN l THEN e.rsvp_deadline ELSE NULL END,'food_stage',e.food_stage,'food_enabled',e.food_enabled,'other_enabled',e.other_enabled,'planning_config',e.planning_config,'notification_preferences',jsonb_build_object('admin',e.notification_preferences->'admin')) END FROM public.event_settings e WHERE id=1),'null'),

 'guestFoodReplies',CASE WHEN l THEN coalesce((SELECT jsonb_agg(jsonb_build_object('template_key',template_key,'language_code',language_code,'body',body) ORDER BY template_key,language_code) FROM public.message_templates WHERE template_key IN ('food-interest-reply','food-interest-reply-no-deadline') AND channel='manual' AND is_active),'[]') ELSE '[]'::jsonb END,
 'invitationTemplates',CASE WHEN s OR i THEN coalesce((
  SELECT jsonb_agg(jsonb_build_object('language_code',language_code,'channel',channel,'subject',subject,'body',body))
  FROM public.message_templates
  WHERE template_key='invitation' AND is_active AND channel IN ('email','sms','whatsapp')
 ),'[]') ELSE '[]'::jsonb END,
 'languages',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_languages a),'[]'),
 'households',CASE WHEN h THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.households a),'[]') WHEN i THEN coalesce((SELECT jsonb_agg((to_jsonb(a)-'notes'-'postal_address'-'food'-'food_confirmed'-'food_interest') || CASE WHEN f THEN jsonb_build_object('food_interest',a.food_interest) ELSE '{}'::jsonb END) FROM public.households a),'[]') WHEN f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'household_name',a.household_name,'food',a.food,'food_confirmed',a.food_confirmed,'food_interest',a.food_interest,'parent_id',a.parent_id,'sort_order',a.sort_order,'archived_at',a.archived_at,'language',a.language,'planning_group_id',a.planning_group_id,'relation_group_id',a.relation_group_id)) FROM public.households a),'[]') ELSE '[]'::jsonb END,
 'guests',CASE WHEN h THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.guests a),'[]') WHEN i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'household_id',a.household_id,'first_name',a.first_name,'last_name',a.last_name,'language',a.language,'archived_at',a.archived_at,'is_child',a.is_child) || CASE WHEN i AND
 a.archived_at IS NULL AND NOT a.is_child
 AND EXISTS(SELECT 1 FROM public.households source WHERE source.id=a.household_id AND source.archived_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.households target WHERE target.primary_guest_id=a.id AND target.archived_at IS NULL) THEN jsonb_build_object('phone',a.phone,'mobile',a.mobile,'email',a.email,'preferred_contact_method',a.preferred_contact_method) ELSE '{}'::jsonb END) FROM public.guests a),'[]') ELSE '[]'::jsonb END,
 'sessions',CASE WHEN v OR l THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_sessions a),'[]') WHEN h OR i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'location_id',a.location_id,'is_active',a.is_active,'requires_rsvp',a.requires_rsvp,'sort_order',a.sort_order)) FROM public.event_sessions a),'[]') ELSE '[]'::jsonb END,
 'locations',CASE WHEN v OR l THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_locations a),'[]') WHEN h OR i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'timezone',a.timezone,'archived_at',a.archived_at,'sort_order',a.sort_order)) FROM public.event_locations a),'[]') ELSE '[]'::jsonb END,
 'content',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_content a WHERE l OR a.content_key LIKE 'ui:%' OR (f AND (a.content_key LIKE 'food:%' OR a.content_key LIKE 'food-category:%')) OR (v AND (a.content_key LIKE 'venue:%' OR a.content_key LIKE 'session:%'))),'[]'));
 FOR t,k IN SELECT * FROM (VALUES ('food_items','food'),('food_claims','claims'),('food_categories','foodCategories'),('food_item_types','foodTypes'),('rsvp_submissions','submissions'),('household_session_defaults','defaults'),('guest_session_overrides','overrides'),('guest_session_responses','responses'),('relation_groups','relationGroups'),('household_contacts','contacts'),('invitation_send_queue','queue'),('invitation_deliveries','deliveries'),('other_items','tasks'),('other_categories','otherCategories')) x(t,k) LOOP
  rows:='[]';
  IF (t IN ('food_items','food_categories','food_item_types') AND (f OR l)) OR (t='food_claims' AND f) OR (t IN ('household_session_defaults','guest_session_overrides') AND (i OR f)) OR (t IN ('rsvp_submissions','guest_session_responses','invitation_send_queue','invitation_deliveries') AND i) OR (t='relation_groups' AND (h OR i OR f)) OR (t='household_contacts' AND (h OR i)) OR (t IN ('other_items','other_categories') AND o) THEN EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(a)),''[]''::jsonb) FROM public.%I a',t) INTO rows;END IF;
  IF t='food_items' AND l AND NOT f THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'category',a.category,'name_en',a.name_en,'description_en',a.description_en,'quantity_type',a.quantity_type,'sort_order',a.sort_order,'active',a.active)),'[]'::jsonb) INTO rows FROM public.food_items a;END IF;
  result:=result||jsonb_build_object(k,rows);
 END LOOP;
 RETURN result || jsonb_build_object('foodGroups',CASE WHEN f THEN coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM public.food_groups g),'[]'::jsonb) ELSE '[]'::jsonb END);
END $$;


--
-- Name: admin_lookup_verified_user(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_lookup_verified_user(p_email text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('administrators','edit');RETURN (SELECT jsonb_build_object('email',u.email,'verified',true) FROM auth.users u WHERE lower(u.email)=lower(btrim(p_email)) AND u.email_confirmed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=u.id));
END $$;


--
-- Name: admin_manage_relation_group(text, uuid, text, text, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_manage_relation_group(p_action text, p_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_planning_group_id text DEFAULT NULL::text, p_direction integer DEFAULT NULL::integer, p_expected jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE item public.relation_groups; neighbor public.relation_groups; result public.relation_groups;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_action IS NULL OR p_action NOT IN ('save','move','delete') THEN RAISE EXCEPTION 'Invalid group action';END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO item FROM public.relation_groups WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR to_jsonb(item) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Group changed. Refresh and try again.';END IF;
 END IF;
 IF p_action='save' THEN
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 140 THEN RAISE EXCEPTION 'Enter a group name.';END IF;
  IF p_id IS NULL THEN
   IF p_planning_group_id IS NULL THEN RAISE EXCEPTION 'Choose an existing top-level group.';END IF;
   INSERT INTO public.relation_groups(name,planning_group_id,sort_order) VALUES(btrim(p_name),p_planning_group_id,coalesce((SELECT max(sort_order)+1 FROM public.relation_groups),0)) RETURNING * INTO result;
  ELSE
   UPDATE public.relation_groups SET name=btrim(p_name) WHERE id=p_id RETURNING * INTO result;
  END IF;
 ELSIF p_action='delete' THEN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Choose a group.';END IF;
  DELETE FROM public.relation_groups WHERE id=p_id;RETURN jsonb_build_object('deleted',true);
 ELSE
  IF p_id IS NULL OR p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Choose a group and direction.';END IF;
  -- Normalize ties before swapping adjacent groups. Shared groups retain one global order.
  WITH ranked AS (SELECT id,row_number() OVER(ORDER BY sort_order,name,id)::integer AS n FROM public.relation_groups)
   UPDATE public.relation_groups r SET sort_order=ranked.n FROM ranked WHERE r.id=ranked.id;
  SELECT * INTO item FROM public.relation_groups WHERE id=p_id;
  SELECT * INTO neighbor FROM public.relation_groups WHERE (planning_group_id IS NULL OR planning_group_id=p_planning_group_id) AND (sort_order-item.sort_order)*p_direction>0 ORDER BY abs(sort_order-item.sort_order) LIMIT 1;
  IF FOUND THEN UPDATE public.relation_groups SET sort_order=CASE WHEN id=item.id THEN neighbor.sort_order ELSE item.sort_order END WHERE id IN(item.id,neighbor.id);END IF;
  SELECT * INTO result FROM public.relation_groups WHERE id=p_id;
 END IF;
 RETURN to_jsonb(result);
END $$;


--
-- Name: admin_move_food_category(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_food_category(p_category_id uuid, p_direction integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE parent uuid;ids uuid[];position integer;target integer;swap uuid;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7745);
 IF p_direction IS NULL OR p_direction NOT IN(-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1';END IF;
 SELECT parent_id INTO parent FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category not found';END IF;
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO ids FROM public.food_categories WHERE parent_id IS NOT DISTINCT FROM parent;
 position:=array_position(ids,p_category_id);target:=position+p_direction;
 IF target<1 OR target>cardinality(ids) THEN RETURN;END IF;
 swap:=ids[position];ids[position]:=ids[target];ids[target]:=swap;
 UPDATE public.food_categories c SET sort_order=ordered.ordinality::integer FROM unnest(ids) WITH ORDINALITY ordered(id,ordinality) WHERE c.id=ordered.id;
END $$;


--
-- Name: admin_move_food_item(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_food_item(p_food_item_id uuid, p_direction integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_category text;v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_move_food_item');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
 SELECT category INTO v_category FROM public.food_items WHERE id=p_food_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
 SELECT array_agg(id ORDER BY sort_order,lower(name_en),id) INTO v_order FROM public.food_items
 WHERE category IS NOT DISTINCT FROM v_category;
 v_position:=array_position(v_order,p_food_item_id);v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
 v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
 UPDATE public.food_items f SET sort_order=ordered.ordinality::integer,updated_at=now()
 FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE f.id=ordered.id;
END $$;


--
-- Name: admin_move_guest(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_guest(p_guest_id uuid, p_household_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE g public.guests%ROWTYPE; target public.households%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_move_guest');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO g FROM public.guests WHERE id=p_guest_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Guest not found'; END IF;
 PERFORM 1 FROM public.households WHERE id IN(g.household_id,p_household_id) ORDER BY id FOR UPDATE;
 SELECT * INTO target FROM public.households WHERE id=p_household_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination household not found'; END IF;
 IF g.household_id=p_household_id THEN RETURN; END IF;
 IF g.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.households WHERE id IN(g.household_id,p_household_id) AND (archived_at IS NOT NULL OR rsvp_state<>'open')) OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id IN(g.household_id,p_household_id)) OR EXISTS(SELECT 1 FROM public.guest_session_responses WHERE guest_id=p_guest_id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE guest_id=p_guest_id) THEN RAISE EXCEPTION 'Move requires active households and guest without RSVP history'; END IF;
 -- Freeze the old effective assignment for EVERY session, including inactive sessions.
 INSERT INTO public.guest_session_overrides(guest_id,session_id,is_invited)
 SELECT g.id,s.id,coalesce(o.is_invited,d.is_invited,false) FROM public.event_sessions s
 LEFT JOIN public.household_session_defaults d ON d.household_id=g.household_id AND d.session_id=s.id
 LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=s.id
 ON CONFLICT(guest_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;
 UPDATE public.guests SET household_id=p_household_id,updated_at=now() WHERE id=p_guest_id;
END $$;


--
-- Name: admin_move_household(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_household(p_household_id uuid, p_direction integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_planning_group text;v_group uuid;v_parent uuid;v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_move_household');
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
  SELECT planning_group_id,relation_group_id,parent_id INTO v_planning_group,v_group,v_parent FROM public.households WHERE id=p_household_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
  SELECT array_agg(id ORDER BY sort_order,lower(household_name),id) INTO v_order
  FROM public.households WHERE archived_at IS NULL AND planning_group_id=v_planning_group AND relation_group_id IS NOT DISTINCT FROM v_group AND parent_id IS NOT DISTINCT FROM v_parent;
  v_position:=array_position(v_order,p_household_id);v_target:=v_position+p_direction;
  IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
  v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
  UPDATE public.households h SET sort_order=ordered.ordinality::integer,updated_at=now()
    FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE h.id=ordered.id;
END $$;


--
-- Name: admin_move_language(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_language(p_code text, p_direction integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_order text[]; v_position integer; v_target integer;
BEGIN PERFORM app_private.require_admin_operation('admin_move_language');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(language_code ORDER BY sort_order,language_code) INTO v_order FROM public.event_languages;
 v_position:=array_position(v_order,p_code);
 IF v_position IS NULL THEN RAISE EXCEPTION 'Language not found'; END IF;
 v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>cardinality(v_order) THEN RETURN; END IF;
 v_order[v_position]:=v_order[v_target];
 v_order[v_target]:=p_code;
 UPDATE public.event_languages AS language SET sort_order=ordered.ordinality::integer
 FROM unnest(v_order) WITH ORDINALITY AS ordered(code,ordinality)
 WHERE language.language_code=ordered.code AND language.sort_order IS DISTINCT FROM ordered.ordinality::integer;
END $$;


--
-- Name: admin_move_other_category(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_other_category(p_category_id uuid, p_direction integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE ids uuid[];position integer;target integer;
BEGIN PERFORM app_private.require_admin_operation('admin_move_other_category');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO ids FROM public.other_categories;
 position:=array_position(ids,p_category_id);
 IF position IS NULL THEN RAISE EXCEPTION 'Category not found';END IF;
 target:=position+p_direction;
 IF target BETWEEN 1 AND cardinality(ids) THEN
  ids[position]:=ids[target];ids[target]:=p_category_id;
  UPDATE public.other_categories category SET sort_order=ordering.ordinality::integer,updated_at=clock_timestamp()
  FROM unnest(ids) WITH ORDINALITY AS ordering(id,ordinality)
  WHERE category.id=ordering.id AND (category.sort_order IS DISTINCT FROM ordering.ordinality::integer OR category.id IN (p_category_id,ids[position]));
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(category) ORDER BY sort_order,lower(name),id),'[]'::jsonb) FROM public.other_categories category);
END $$;


--
-- Name: admin_move_session(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_session(p_session_id uuid, p_direction integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_order uuid[]; v_position integer; v_target integer;
BEGIN PERFORM app_private.require_admin_operation('admin_move_session');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO v_order FROM public.event_sessions;
 v_position:=array_position(v_order,p_session_id);
 IF v_position IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
 v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>cardinality(v_order) THEN RETURN; END IF;
 v_order[v_position]:=v_order[v_target];
 v_order[v_target]:=p_session_id;
 UPDATE public.event_sessions AS session SET sort_order=ordered.ordinality::integer
 FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality)
 WHERE session.id=ordered.id AND session.sort_order IS DISTINCT FROM ordered.ordinality::integer;
END $$;


--
-- Name: admin_move_venue(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_venue(p_venue_id uuid, p_direction integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE ids uuid[];position integer;target integer;
BEGIN PERFORM app_private.require_admin_operation('admin_move_venue');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO ids FROM public.event_locations;
 position:=array_position(ids,p_venue_id);
 IF position IS NULL THEN RAISE EXCEPTION 'Venue not found';END IF;
 target:=position+p_direction;
 IF target<1 OR target>cardinality(ids) THEN RETURN;END IF;
 ids[position]:=ids[target];ids[target]:=p_venue_id;
 UPDATE public.event_locations venue SET sort_order=ordering.ordinality::integer
 FROM unnest(ids) WITH ORDINALITY AS ordering(id,ordinality)
 WHERE venue.id=ordering.id AND venue.sort_order IS DISTINCT FROM ordering.ordinality::integer;
END $$;


--
-- Name: admin_my_invitation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_my_invitation() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE e text;
BEGIN
 PERFORM app_private.require_live_session();
 SELECT lower(email) INTO e FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 RETURN (SELECT jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'expires_at',i.expires_at,'needs_password',(SELECT coalesce(encrypted_password,'')='' FROM auth.users WHERE id=auth.uid())) FROM public.admin_invitations i WHERE i.email=e AND i.status='pending' AND i.delivery_state='sent' AND i.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by));
END $$;


--
-- Name: admin_order_guest(uuid, integer, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_order_guest(p_guest_id uuid, p_direction integer, p_expected_order uuid[] DEFAULT NULL::uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h uuid;ids uuid[];position integer;target integer;swap uuid;
BEGIN
 PERFORM app_private.require_permission('households','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Invalid guest order direction';END IF;
 SELECT household_id INTO h FROM public.guests g WHERE id=p_guest_id AND archived_at IS NULL AND EXISTS(SELECT 1 FROM public.households WHERE id=g.household_id AND archived_at IS NULL);
 IF NOT FOUND THEN RAISE EXCEPTION 'Active guest not found';END IF;
 SELECT array_agg(id ORDER BY is_child,sort_order NULLS LAST,lower(first_name),lower(coalesce(last_name,'')),id) INTO ids FROM public.guests WHERE household_id=h AND archived_at IS NULL;
 IF p_expected_order IS NOT NULL THEN
  IF cardinality(p_expected_order)<>cardinality(ids) OR (SELECT count(DISTINCT id) FROM unnest(p_expected_order) id)<>cardinality(ids) OR EXISTS(SELECT 1 FROM unnest(p_expected_order) id WHERE id IS NULL OR NOT(id=ANY(ids))) THEN RAISE EXCEPTION 'Guest list changed; refresh and try again';END IF;
  -- Equal/null manual positions may use the client's locale-aware name tie-break.
  IF EXISTS(SELECT 1 FROM unnest(p_expected_order) WITH ORDINALITY e(id,pos)
    JOIN public.guests g ON g.id=e.id
    JOIN unnest(p_expected_order) WITH ORDINALITY e2(id,pos) ON e2.pos>e.pos
    JOIN public.guests g2 ON g2.id=e2.id
    WHERE g.is_child=g2.is_child AND g.sort_order IS NOT NULL AND g2.sort_order IS NOT NULL AND g.sort_order>g2.sort_order)
  THEN RAISE EXCEPTION 'Guest order changed; refresh and try again';END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_expected_order) WITH ORDINALITY e(id,pos) JOIN public.guests g ON g.id=e.id WHERE g.is_child AND EXISTS(SELECT 1 FROM unnest(p_expected_order) WITH ORDINALITY e2(id,pos) JOIN public.guests g2 ON g2.id=e2.id WHERE NOT g2.is_child AND e2.pos>e.pos)) THEN RAISE EXCEPTION 'Guest order changed; refresh and try again';END IF;
  ids:=p_expected_order;
 END IF;
 position:=array_position(ids,p_guest_id);target:=position+p_direction;
 IF target<1 OR target>cardinality(ids) THEN RETURN;END IF;
 IF (SELECT is_child FROM public.guests WHERE id=ids[position]) IS DISTINCT FROM (SELECT is_child FROM public.guests WHERE id=ids[target]) THEN RETURN;END IF;
 swap:=ids[position];ids[position]:=ids[target];ids[target]:=swap;
 UPDATE public.guests g SET sort_order=ordered.ordinality::integer,updated_at=now() FROM unnest(ids) WITH ORDINALITY ordered(id,ordinality) WHERE g.id=ordered.id;
END $$;


--
-- Name: admin_prepare_invitation(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_prepare_invitation(p_email text, p_name text, p_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE actor uuid; e text:=lower(btrim(coalesce(p_email,''))); n text:=btrim(coalesce(p_name,'')); i public.admin_invitations%ROWTYPE; existing_confirmed boolean;
BEGIN PERFORM app_private.require_admin_operation('admin_prepare_invitation');
 actor:=app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(e)>254 OR length(n) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a valid email and display name';END IF;
 -- Serialize reservations globally: enforce limits even for different emails.
 PERFORM pg_advisory_xact_lock(192837465);
 IF EXISTS(SELECT 1 FROM public.admins a JOIN auth.users u ON u.id=a.user_id WHERE lower(u.email)=e) THEN RAISE EXCEPTION 'This person is already an administrator';END IF;
 SELECT * INTO i FROM public.admin_invitations WHERE email=e FOR UPDATE;
 IF p_id IS NOT NULL AND (i.id IS NULL OR i.id<>p_id OR i.status<>'pending') THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 IF i.id IS NOT NULL AND i.status='pending' AND p_id IS NULL THEN RAISE EXCEPTION 'A pending invitation already exists. Use Resend or Cancel';END IF;
 IF i.id IS NOT NULL AND i.last_attempt_at>clock_timestamp()-interval '60 seconds' THEN RAISE EXCEPTION 'Wait one minute before sending again';END IF;
 IF i.status='pending' AND i.delivery_state='sending' AND i.last_attempt_at>clock_timestamp()-interval '2 minutes' THEN RAISE EXCEPTION 'An invitation email is already being sent';END IF;
 IF (SELECT count(*) FROM public.admin_invitation_audit WHERE action='email_requested' AND created_at>clock_timestamp()-interval '1 hour' AND actor_user_id=actor)>=10 OR (SELECT count(*) FROM public.admin_invitation_audit WHERE action='email_requested' AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'Invitation sending limit reached. Try again later';END IF;
 INSERT INTO public.admin_invitations(email,name,invited_by) VALUES(e,n,actor)
 ON CONFLICT(email) DO UPDATE SET name=n,invited_by=actor,status='pending',delivery_state='sending',attempt_id=gen_random_uuid(),attempts=public.admin_invitations.attempts+1,last_attempt_at=clock_timestamp(),expires_at=clock_timestamp()+interval '7 days',accepted_by=NULL,accepted_at=NULL,last_error_code=NULL,sent_at=NULL RETURNING * INTO i;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) VALUES(i.id,actor,'email_requested',e,jsonb_build_object('name',n,'attempt',i.attempts));
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=e AND email_confirmed_at IS NOT NULL) INTO existing_confirmed;
 RETURN jsonb_build_object('id',i.id,'email',e,'attempt_id',i.attempt_id,'existing_confirmed',existing_confirmed);
END $_$;


--
-- Name: admin_preview_backup(jsonb, text, text[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_preview_backup(p_backup jsonb, p_mode text DEFAULT NULL::text, p_sections text[] DEFAULT NULL::text[], p_include_logs boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: admin_query_logs(text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_query_logs(p_search text DEFAULT ''::text, p_category text DEFAULT ''::text, p_action text DEFAULT ''::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_key text DEFAULT NULL::text, p_limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
END $$;


--
-- Name: admin_record_delivery_sent(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_record_delivery_sent(p_queue_id uuid, p_expected_revision integer, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_record_delivery_sent');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF q.status<>'sent' AND q.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 RETURN public.admin_confirm_invitation_sent(p_queue_id,p_note);
END $$;


--
-- Name: admin_record_session(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_record_session(p_action text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE sid uuid;started timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN ('login','logout_requested') THEN RAISE EXCEPTION 'Invalid session action';END IF;
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 SELECT created_at INTO started FROM auth.sessions WHERE id=sid AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified sign-in session required';END IF;
 INSERT INTO public.admin_session_audit(actor_user_id,session_id,action,created_at) VALUES(auth.uid(),sid,p_action,CASE WHEN p_action='login' THEN started ELSE clock_timestamp() END) ON CONFLICT(session_id,action) DO NOTHING;
END $$;


--
-- Name: admin_record_share_handoff(uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_record_share_handoff(p_queue_id uuid, p_expected_revision integer, p_handoff_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE q public.invitation_send_queue;
BEGIN
 PERFORM app_private.require_permission('sendInvites');
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM public.admin_authorize_device_send(p_queue_id);
 IF p_handoff_id IS NULL THEN RAISE EXCEPTION 'Invalid share handoff';END IF;
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id FOR UPDATE;
 IF p_expected_revision IS DISTINCT FROM q.revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value)
 VALUES(q.id,auth.uid(),'share_handoff_completed',jsonb_build_object('status',q.status),jsonb_build_object('status',q.status,'handoff_id',p_handoff_id,'delivery_confirmed',false)) ON CONFLICT DO NOTHING;
END $$;


--
-- Name: admin_remove_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_remove_member(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE a public.admins%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');PERFORM pg_advisory_xact_lock(42319,11);SELECT * INTO a FROM public.admins WHERE user_id=p_user_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;
 IF a.access_state='active' THEN RAISE EXCEPTION 'Suspend this administrator before removal';END IF;
 IF a.access_permissions->>'preset'='full' AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can remove a Full administrator' USING ERRCODE='42501';END IF;
 DELETE FROM public.admins WHERE user_id=p_user_id;
 INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),p_user_id,'remove',jsonb_build_object('name',a.name));
END $$;


--
-- Name: admin_rename_food_category(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_rename_food_category(p_category_id uuid, p_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_old text;v_new text;
BEGIN PERFORM app_private.require_admin_operation('admin_rename_food_category');
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  v_new:=btrim(coalesce(p_name,''));
  IF length(v_new)=0 OR length(v_new)>120 THEN RAISE EXCEPTION 'Enter a valid category name'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT name INTO v_old FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;
  IF v_old=v_new THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.food_categories WHERE name=v_new) THEN RAISE EXCEPTION 'Category already exists'; END IF;
  UPDATE public.food_categories SET name=v_new WHERE id=p_category_id;
  UPDATE public.food_items SET category=v_new,updated_at=now() WHERE category=v_old;
END $$;


--
-- Name: admin_rename_member(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_rename_member(p_user_id uuid, p_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE new_name text;
BEGIN IF EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_user_id AND access_permissions->>'preset'='full') AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can change a Full administrator' USING ERRCODE='42501';END IF; PERFORM app_private.require_admin_operation('admin_rename_member');
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  new_name := btrim(coalesce(p_name,''));
  IF length(new_name) < 1 OR length(new_name) > 120 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  UPDATE public.admins SET name=new_name WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found'; END IF;
  INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details)
  VALUES(auth.uid(),p_user_id,'rename',jsonb_build_object('name',new_name));
END; $$;


--
-- Name: admin_reopen_household_rsvp(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reopen_household_rsvp(p_household_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_reopen_household_rsvp');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Reason required (maximum 2000 characters)';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'locked' THEN RAISE EXCEPTION 'Active locked household required';END IF;
 UPDATE public.households SET rsvp_state='open',late_submission_until=NULL WHERE id=h.id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason) VALUES(h.id,auth.uid(),'reopened',h.latest_rsvp_submission_id,btrim(p_reason));
END $$;


--
-- Name: admin_restore_backup(jsonb, text, text, text[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_restore_backup(p_backup jsonb, p_confirmation text, p_mode text DEFAULT NULL::text, p_sections text[] DEFAULT NULL::text[], p_include_logs boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_admin_operation('admin_restore_backup');
 IF p_confirmation IS DISTINCT FROM 'RESTORE '||coalesce(p_backup->'payload'->'tables'->'public.event_settings'->0->>'event_name','') THEN RAISE EXCEPTION 'Type RESTORE followed by the source event name';END IF;
 RETURN app_private.restore_backup(app_private.select_backup(p_backup,p_mode,p_sections,p_include_logs));
END $$;


--
-- Name: admin_revoke_other_sessions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revoke_other_sessions() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE s record;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 FOR s IN SELECT id FROM auth.sessions WHERE user_id=auth.uid() AND id<>(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid LOOP PERFORM public.admin_revoke_session(s.id);END LOOP;
END $$;


--
-- Name: admin_revoke_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revoke_session(p_session_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE target uuid;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 SELECT user_id INTO target FROM auth.sessions WHERE id=p_session_id AND user_id IN(SELECT user_id FROM public.admins);IF NOT FOUND THEN RAISE EXCEPTION 'Session not found';END IF;
 IF target<>auth.uid() THEN PERFORM app_private.require_permission('revokeSessions');END IF;
 INSERT INTO app_private.admin_session_revocations(session_id,user_id,revoked_by) VALUES(p_session_id,target,auth.uid()) ON CONFLICT DO NOTHING;
 INSERT INTO app_private.admin_access_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),target,'session_revoked',jsonb_build_object('session_id',p_session_id));
END $$;


--
-- Name: admin_save_access(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_access(p_user_id uuid, p_permissions jsonb, p_expected jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE old jsonb;
BEGIN
 PERFORM app_private.require_permission('full');IF NOT app_private.valid_permissions(p_permissions) THEN RAISE EXCEPTION 'Invalid access permissions';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);SELECT access_permissions INTO old FROM public.admins WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;IF old IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Access changed. Refresh before saving.' USING ERRCODE='40001';END IF;
 IF old->>'preset'='full' AND p_permissions->>'preset'<>'full' AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_user_id AND access_state='active') AND (SELECT count(*) FROM public.admins WHERE access_state='active' AND access_permissions->>'preset'='full')<=1 THEN RAISE EXCEPTION 'Keep at least one active Full administrator';END IF;
 UPDATE public.admins SET access_permissions=p_permissions WHERE user_id=p_user_id;
 INSERT INTO app_private.admin_access_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),p_user_id,'permissions_changed',jsonb_build_object('before',old,'after',p_permissions));
END $$;


--
-- Name: admin_save_contact(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_contact(p_id uuid, p_household_id uuid, p_values jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_id uuid:=p_id;linked_guest uuid;existing_guest uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_save_contact');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household required'; END IF;
 IF nullif(btrim(p_values->>'contact_value'),'') IS NULL OR length(p_values->>'contact_value')>1000 OR length(coalesce(p_values->>'contact_name',''))>140 THEN RAISE EXCEPTION 'Enter valid contact details'; END IF;
 IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.household_contacts WHERE id=p_id AND household_id=p_household_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active contact not found'; END IF;
 IF p_id IS NOT NULL THEN SELECT guest_id INTO existing_guest FROM public.household_contacts WHERE id=p_id;END IF;
 linked_guest:=CASE WHEN p_values ? 'guest_id' THEN nullif(p_values->>'guest_id','')::uuid ELSE existing_guest END;
 IF linked_guest IS NOT NULL AND (p_id IS NULL OR linked_guest IS DISTINCT FROM existing_guest) AND NOT EXISTS(SELECT 1 FROM public.guests g JOIN public.households h ON h.id=g.household_id WHERE g.id=linked_guest AND g.archived_at IS NULL AND h.archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active guest from an active household';END IF;
 IF coalesce((p_values->>'is_primary')::boolean,false) THEN UPDATE public.household_contacts SET is_primary=false,updated_at=now() WHERE household_id=p_household_id AND contact_type=p_values->>'contact_type' AND is_primary; END IF;
 IF v_id IS NULL THEN
 INSERT INTO public.household_contacts(household_id,contact_type,contact_value) VALUES(p_household_id,p_values->>'contact_type',btrim(p_values->>'contact_value')) RETURNING id INTO v_id;
 END IF;
 UPDATE public.household_contacts SET guest_id=linked_guest,contact_name=nullif(btrim(p_values->>'contact_name'),''),contact_type=p_values->>'contact_type',contact_value=btrim(p_values->>'contact_value'),language_code=nullif(p_values->>'language_code',''),preferred_method=nullif(p_values->>'preferred_method',''),is_primary=coalesce((p_values->>'is_primary')::boolean,false),updated_at=now() WHERE id=v_id;
 RETURN v_id;
END $$;


--
-- Name: admin_save_delivery(uuid, uuid, jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_delivery(p_id uuid, p_household_id uuid, p_values jsonb, p_expected_revision integer DEFAULT NULL::integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;q public.invitation_send_queue%ROWTYPE;c public.household_contacts%ROWTYPE;cid uuid:=nullif(p_values->>'contact_id','')::uuid;v_id uuid:=p_id;v_status text:=p_values->>'status';recipient jsonb;destination text;guest public.guests;
BEGIN PERFORM app_private.require_admin_operation('admin_save_delivery');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF v_status IS NULL OR v_status NOT IN ('draft','ready','cancelled','failed') OR p_values->>'channel' IS NULL OR p_values->>'channel' NOT IN ('email','whatsapp','sms','postal','manual') OR nullif(btrim(p_values->>'message_body'),'') IS NULL OR length(p_values->>'message_body')>10000 OR length(coalesce(p_values->>'message_subject',''))>300 OR length(coalesce(p_values->>'reason',''))>2000 THEN RAISE EXCEPTION 'Enter valid delivery details';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) AND v_status NOT IN ('draft','cancelled') THEN
  RAISE EXCEPTION 'Invitation delivery opens when the event is published.';
 END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Household not found';END IF;
 IF p_id IS NOT NULL THEN SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_id AND household_id=h.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF p_expected_revision IS DISTINCT FROM q.revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 IF q.status IN ('sent','cancelled') THEN RAISE EXCEPTION 'Sent and cancelled deliveries are read-only; create a new delivery';END IF;
 END IF;
 IF v_status IN ('cancelled','failed') THEN
 IF p_id IS NULL OR nullif(btrim(p_values->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Existing delivery and reason required';END IF;
 -- Preserve the prepared recipient/message when recording a failed or cancelled attempt.
 UPDATE public.invitation_send_queue SET status=v_status,revision=revision+1,updated_at=clock_timestamp() WHERE id=p_id;
 ELSE
 IF h.archived_at IS NOT NULL OR (h.invite_code IS NULL AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)) OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active household with guests required';END IF;

 IF cid IS NULL THEN
  SELECT id INTO cid FROM public.household_contacts
  WHERE household_id=h.id AND is_household_primary IS TRUE AND archived_at IS NULL
   AND contact_type=CASE p_values->>'channel' WHEN 'sms' THEN 'phone' WHEN 'whatsapp' THEN 'phone' WHEN 'manual' THEN 'other' ELSE p_values->>'channel' END;
 END IF;
 IF cid IS NOT NULL THEN
 SELECT * INTO c FROM public.household_contacts WHERE id=cid AND household_id=h.id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active contact from this household';END IF;
 IF (p_values->>'channel'='email' AND c.contact_type<>'email') OR (p_values->>'channel' IN ('sms','whatsapp') AND c.contact_type<>'phone') OR (p_values->>'channel'='postal' AND c.contact_type<>'postal') THEN RAISE EXCEPTION 'Contact type does not match delivery channel';END IF;
 destination:=c.contact_value;
 recipient:=jsonb_build_object('contact_name',c.contact_name,'contact_type',c.contact_type,'contact_value',destination);
 ELSE

 SELECT g.* INTO guest FROM public.guests g JOIN public.households source ON source.id=g.household_id
 WHERE g.id=h.primary_guest_id AND NOT g.is_child AND g.archived_at IS NULL AND source.archived_at IS NULL;
  destination:=CASE p_values->>'channel' WHEN 'email' THEN guest.email WHEN 'sms' THEN guest.mobile WHEN 'whatsapp' THEN guest.mobile WHEN 'postal' THEN h.postal_address ELSE h.household_name END;
 recipient:=jsonb_build_object('contact_name',coalesce(nullif(concat_ws(' ',guest.first_name,guest.last_name),''),h.household_name),'contact_type',p_values->>'channel','contact_value',destination);
 END IF;
 IF v_status='ready' AND nullif(btrim(destination),'') IS NULL THEN RAISE EXCEPTION 'Recipient details required before marking ready';END IF;
 IF p_id IS NULL THEN INSERT INTO public.invitation_send_queue(household_id,channel,message_body,created_by) VALUES(h.id,p_values->>'channel',p_values->>'message_body',auth.uid()) RETURNING id INTO v_id;END IF;

 IF v_status='ready' AND position('{invitation_link}' IN p_values->>'message_body')>0 THEN RAISE EXCEPTION 'Replace the invitation link placeholder before marking ready.';END IF;
 UPDATE public.invitation_send_queue SET contact_id=cid,channel=p_values->>'channel',message_subject=nullif(btrim(p_values->>'message_subject'),''),message_body=p_values->>'message_body',status=v_status,recipient_snapshot=recipient,invitation_code_snapshot=h.invite_code,revision=CASE WHEN p_id IS NULL THEN 1 ELSE revision+1 END,updated_at=clock_timestamp() WHERE id=v_id;
 END IF;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value,reason) SELECT v_id,auth.uid(),CASE WHEN p_id IS NULL THEN 'created' ELSE v_status END,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(q)-'invitation_code_snapshot' END,to_jsonb(n)-'invitation_code_snapshot',nullif(btrim(p_values->>'reason'),'') FROM public.invitation_send_queue n WHERE n.id=v_id;
 RETURN v_id;
END $$;


--
-- Name: admin_save_features(boolean, boolean, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_features(p_food boolean, p_other boolean, p_stage text, p_introduction jsonb, p_expected jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_food IS NULL OR p_other IS NULL OR p_stage IS NULL OR p_stage NOT IN ('interest','selection') OR p_introduction IS NULL OR jsonb_typeof(p_introduction)<>'object' THEN RAISE EXCEPTION 'Invalid feature settings';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_introduction) x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>6000 OR NOT EXISTS(SELECT 1 FROM public.event_languages l WHERE l.language_code=x.key)) THEN RAISE EXCEPTION 'Invalid food explanation';END IF;
 UPDATE public.event_settings e SET food_enabled=p_food,other_enabled=p_other,food_stage=p_stage,food_introduction=p_introduction
 WHERE id=1 AND jsonb_build_object('food_enabled',e.food_enabled,'other_enabled',e.other_enabled,'food_stage',e.food_stage,'food_introduction',e.food_introduction)=p_expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'Feature settings changed; refresh before saving';END IF;
END $$;


-- Food-interest replies are plain guest message templates, not delivery records.
CREATE FUNCTION public.admin_save_food_interest_reply(p_values jsonb,p_fallback_values jsonb,p_expected jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE entry record;token text[];current_value jsonb;kind text;values_to_save jsonb;
BEGIN
 PERFORM app_private.require_permission('languages','edit');
 IF p_values IS NULL OR p_fallback_values IS NULL OR jsonb_typeof(p_values)<>'object' OR jsonb_typeof(p_fallback_values)<>'object' OR p_expected IS NULL THEN RAISE EXCEPTION 'Invalid food interest reply';END IF;
 PERFORM pg_advisory_xact_lock(19421,7752);
 SELECT coalesce(jsonb_agg(jsonb_build_object('template_key',template_key,'language_code',language_code,'body',body) ORDER BY template_key,language_code),'[]') INTO current_value FROM public.message_templates WHERE template_key IN ('food-interest-reply','food-interest-reply-no-deadline') AND channel='manual' AND is_active;
 IF current_value IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Food interest reply changed; refresh before saving';END IF;
 FOR kind IN SELECT unnest(ARRAY['food-interest-reply','food-interest-reply-no-deadline']) LOOP
  values_to_save:=CASE kind WHEN 'food-interest-reply' THEN p_values ELSE p_fallback_values END;
  FOR entry IN SELECT * FROM jsonb_each(values_to_save) LOOP
   IF jsonb_typeof(entry.value)<>'string' OR length(entry.value#>>'{}')>6000 OR NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=entry.key) THEN RAISE EXCEPTION 'Invalid food interest reply';END IF;
   IF regexp_replace(entry.value#>>'{}','\{invite-deadline(:[+-][0-9]{1,3})?\}','','g') ~ '[{}]' OR (kind='food-interest-reply-no-deadline' AND entry.value#>>'{}' ~ '[{}]') THEN RAISE EXCEPTION 'Invalid food interest reply placeholder';END IF;
   FOR token IN SELECT regexp_matches(entry.value#>>'{}','\{invite-deadline:([+-][0-9]{1,3})\}','g') LOOP
    IF abs(token[1]::integer)>366 THEN RAISE EXCEPTION 'Invalid food interest reply placeholder';END IF;
   END LOOP;
   IF btrim(entry.value#>>'{}')='' THEN DELETE FROM public.message_templates WHERE template_key=kind AND language_code=entry.key AND channel='manual';
   ELSE INSERT INTO public.message_templates(template_key,language_code,channel,body) VALUES(kind,entry.key,'manual',entry.value#>>'{}') ON CONFLICT(template_key,language_code,channel) DO UPDATE SET body=excluded.body,is_active=true;END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_food_interest_reply(jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_food_interest_reply(jsonb,jsonb,jsonb) TO authenticated;

-- Guest food wording belongs to Languages; feature switches retain Settings permissions.
CREATE FUNCTION public.admin_save_food_explanation(p_introduction jsonb, p_expected jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('languages','edit');
 IF p_introduction IS NULL OR jsonb_typeof(p_introduction)<>'object' OR p_expected IS NULL THEN RAISE EXCEPTION 'Invalid food explanation';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_introduction) x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>6000 OR NOT EXISTS(SELECT 1 FROM public.event_languages l WHERE l.language_code=x.key)) THEN RAISE EXCEPTION 'Invalid food explanation';END IF;
 UPDATE public.event_settings SET food_introduction=p_introduction WHERE id=1 AND food_introduction=p_expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food explanation changed; refresh before saving';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_food_explanation(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_food_explanation(jsonb,jsonb) TO authenticated;

--
-- Name: admin_save_food_category(uuid, text, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_food_category(p_category_id uuid, p_name text, p_parent_id uuid, p_expected_name text DEFAULT NULL::text, p_expected_parent uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE current public.food_categories;v_name text:=btrim(coalesce(p_name,''));v_id uuid;v_order integer;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7745);
 IF length(v_name)=0 OR length(v_name)>120 THEN RAISE EXCEPTION 'Enter a valid category name';END IF;
 IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.food_categories WHERE id=p_parent_id) THEN RAISE EXCEPTION 'Parent category not found';END IF;
 SELECT coalesce(max(sort_order),0)+1 INTO v_order FROM public.food_categories WHERE parent_id IS NOT DISTINCT FROM p_parent_id;
 IF p_category_id IS NULL THEN INSERT INTO public.food_categories(name,parent_id,sort_order) VALUES(v_name,p_parent_id,v_order) RETURNING id INTO v_id;RETURN v_id;END IF;
 SELECT * INTO current FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category not found';END IF;
 IF current.name IS DISTINCT FROM p_expected_name OR current.parent_id IS DISTINCT FROM p_expected_parent THEN RAISE EXCEPTION 'Category changed; reload before saving';END IF;
 PERFORM public.admin_rename_food_category(p_category_id,v_name);
 UPDATE public.food_categories SET parent_id=p_parent_id,sort_order=CASE WHEN current.parent_id IS DISTINCT FROM p_parent_id THEN v_order ELSE sort_order END WHERE id=p_category_id;
 RETURN p_category_id;
END $$;


--
-- Name: admin_save_food_group(uuid, text, jsonb, text, uuid[], timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_food_group(p_id uuid, p_name text, p_translations jsonb, p_category text, p_item_ids uuid[], p_expected_updated timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE target uuid:=coalesce(p_id,gen_random_uuid()); existing public.food_groups;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7745);
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR p_translations IS NULL OR jsonb_typeof(p_translations)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(p_translations) e WHERE jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}')>120 OR NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=e.key)) THEN RAISE EXCEPTION 'Invalid Food Group';END IF;
 IF p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.food_categories WHERE name=p_category) THEN RAISE EXCEPTION 'Choose an existing category';END IF;
 IF p_item_ids IS NULL OR cardinality(p_item_ids)<2 OR cardinality(p_item_ids)>100 OR array_position(p_item_ids,NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(p_item_ids) x)<>cardinality(p_item_ids) THEN RAISE EXCEPTION 'Choose at least two different food items';END IF;
 SELECT * INTO existing FROM public.food_groups WHERE id=target FOR UPDATE;
 IF p_id IS NOT NULL AND (NOT FOUND OR existing.updated_at IS DISTINCT FROM p_expected_updated) THEN RAISE EXCEPTION 'Food Group changed; refresh before saving';END IF;
 PERFORM 1 FROM public.food_items WHERE id=ANY(p_item_ids) OR food_group_id=target ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.food_items WHERE id=ANY(p_item_ids))<>cardinality(p_item_ids) OR EXISTS(SELECT 1 FROM public.food_items WHERE id=ANY(p_item_ids) AND food_group_id IS NOT NULL AND food_group_id<>target) THEN RAISE EXCEPTION 'An item is unavailable or already belongs to a Food Group';END IF;
 IF EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE f.id=ANY(p_item_ids) OR f.food_group_id=target) THEN RAISE EXCEPTION 'Resolve existing commitments before changing a Food Group';END IF;
 INSERT INTO public.food_groups(id,name,translations,category) VALUES(target,btrim(p_name),p_translations,p_category) ON CONFLICT(id) DO UPDATE SET name=excluded.name,translations=excluded.translations,category=excluded.category,updated_at=clock_timestamp();
 UPDATE public.food_items SET food_group_id=NULL WHERE food_group_id=target AND NOT(id=ANY(p_item_ids));
 UPDATE public.food_items SET food_group_id=target WHERE id=ANY(p_item_ids);
 RETURN target;
END $$;


--
-- Name: admin_save_food_translations(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_food_translations(p_food_item_id uuid, p_changes jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_type text; v_type_key text; change jsonb; v_key text;
BEGIN PERFORM app_private.require_admin_operation('admin_save_food_translations');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid food translations'; END IF;
 IF jsonb_array_length(p_changes)>300 THEN RAISE EXCEPTION 'Too many translations in one save'; END IF;
 SELECT quantity_type INTO v_type FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
 v_type_key:=CASE WHEN v_type IN ('Batch(s)','Piece(s)','Tray(s)','Packet(s)','Kg','Grams')
  THEN 'ui:'||v_type ELSE 'ui:Food type: '||v_type END;
 FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  v_key:=change->>'key';
  IF v_key IS NULL OR v_key NOT IN (v_type_key,'food:'||p_food_item_id||':name','food:'||p_food_item_id||':description')
    THEN RAISE EXCEPTION 'Invalid food translation key'; END IF;
  PERFORM public.admin_save_translation(v_key,change->>'language',change->>'value');
  IF v_key='food:'||p_food_item_id||':description' AND change->>'language'='en' AND btrim(change->>'value')='' THEN
   UPDATE public.food_items SET description_en='' WHERE id=p_food_item_id;
  END IF;
 END LOOP;
END $$;


--
-- Name: admin_save_guest_appearance(boolean, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_guest_appearance(p_show_toggle boolean, p_default_theme text, p_expected jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_show_toggle IS NULL OR p_default_theme IS NULL OR p_default_theme NOT IN ('system','light','dark') THEN RAISE EXCEPTION 'Invalid guest appearance';END IF;
 UPDATE public.event_settings e SET guest_theme_toggle=p_show_toggle,guest_theme_default=p_default_theme WHERE id=1 AND jsonb_build_object('guest_theme_toggle',e.guest_theme_toggle,'guest_theme_default',e.guest_theme_default)=p_expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'Guest appearance changed; refresh before saving';END IF;
END $$;


--
-- Name: admin_save_guest_customization(jsonb, text, jsonb, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_guest_customization(p_design jsonb, p_background_mode text, p_background jsonb, p_show_toggle boolean, p_default_theme text, p_expected_revision text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.event_settings WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR p_expected_revision IS DISTINCT FROM app_private.guest_customization_revision() THEN RAISE EXCEPTION 'Guest appearance changed; refresh before saving';END IF;
 IF NOT app_private.valid_guest_design(p_design) OR p_background_mode IS NULL OR p_background_mode NOT IN ('keep','replace','remove') OR p_show_toggle IS NULL OR p_default_theme IS NULL OR p_default_theme NOT IN ('dark','light','system') OR (p_background_mode<>'replace' AND p_background IS NOT NULL) THEN RAISE EXCEPTION 'Invalid guest appearance';END IF;
 IF p_background_mode='replace' THEN PERFORM app_private.validate_private_jpeg(p_background);END IF;
 UPDATE public.event_settings SET guest_design=p_design,guest_background=CASE p_background_mode WHEN 'replace' THEN p_background WHEN 'remove' THEN NULL ELSE guest_background END,guest_theme_toggle=p_show_toggle,guest_theme_default=p_default_theme WHERE id=1;
END $$;


--
-- Name: admin_save_guest_details(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_guest_details(p_guest_id uuid, p_household_id uuid, p_values jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE target uuid:=p_guest_id; household uuid; phone_value text;mobile_value text;email_value text;method_value text;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid guest details';END IF;
 phone_value:=nullif(btrim(p_values->>'phone'),'');mobile_value:=nullif(btrim(p_values->>'mobile'),'');email_value:=nullif(btrim(p_values->>'email'),'');method_value:=nullif(p_values->>'preferred_contact_method','');
 IF char_length(coalesce(phone_value,''))>80 OR char_length(coalesce(mobile_value,''))>80 OR char_length(coalesce(email_value,''))>254 THEN RAISE EXCEPTION 'Guest contact field exceeds maximum length';END IF;
 IF email_value IS NOT NULL AND email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid guest email';END IF;
 IF method_value IS NOT NULL AND method_value NOT IN ('sms','whatsapp','email') THEN RAISE EXCEPTION 'Invalid guest contact method';END IF;
 IF method_value IN ('sms','whatsapp') AND mobile_value IS NULL THEN RAISE EXCEPTION 'Enter a mobile number for SMS or WhatsApp';END IF;
 IF method_value='email' AND email_value IS NULL THEN RAISE EXCEPTION 'Enter an email address for email contact';END IF;
 IF target IS NULL THEN
  target:=public.admin_create_guest(p_household_id,p_values);
 ELSE
  SELECT g.household_id INTO household FROM public.guests g JOIN public.households h ON h.id=g.household_id WHERE g.id=target AND g.archived_at IS NULL AND h.archived_at IS NULL FOR UPDATE OF g,h;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active guest not found';END IF;
  IF p_household_id IS NOT NULL AND p_household_id<>household THEN RAISE EXCEPTION 'Guest household mismatch';END IF;
  PERFORM public.admin_update_guest(target,p_values->>'first_name',p_values->>'last_name',p_values->>'courtesy_title',p_values->>'relation',p_values->>'language',coalesce((p_values->>'is_child')::boolean,false),p_values->>'dietary_requirements',p_values->>'notes');
 END IF;
 UPDATE public.guests SET phone=phone_value,mobile=mobile_value,email=email_value,preferred_contact_method=method_value,updated_at=now() WHERE id=target;
 RETURN target;
END $_$;


--
-- Name: admin_save_household(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_household(p_id uuid, p_values jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE; v_id uuid:=p_id; parent uuid:=nullif(p_values->>'parent_id','')::uuid;
BEGIN
 PERFORM app_private.require_admin_operation('admin_save_household');
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'household_name'),'') IS NULL OR length(p_values->>'household_name')>140 THEN RAISE EXCEPTION 'Household name is required (maximum 140 characters)';END IF;
 IF length(coalesce(p_values->>'phone',''))>80 OR length(coalesce(p_values->>'notes',''))>2000 THEN RAISE EXCEPTION 'Household field too long';END IF;
 IF length(coalesce(p_values->>'postal_address',''))>1000 THEN RAISE EXCEPTION 'Contact field too long';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_id IS NOT NULL THEN
  SELECT * INTO h FROM public.households WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household not found';END IF;
  IF h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore household before editing';END IF;
  IF (h.planning_group_id IS DISTINCT FROM p_values->>'planning_group_id' OR h.relation_group_id IS DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid)
   AND EXISTS(SELECT 1 FROM public.households WHERE parent_id=p_id) THEN RAISE EXCEPTION 'Move child households before changing this household grouping';END IF;
 END IF;
 IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.households WHERE id=parent AND archived_at IS NULL AND planning_group_id=p_values->>'planning_group_id' AND relation_group_id IS NOT DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid) THEN RAISE EXCEPTION 'Parent must be active and in the same top-level group and relation group';END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.households(household_name,planning_group_id,language,relation_group_id,parent_id,phone,postal_address,notes)
  VALUES(btrim(p_values->>'household_name'),p_values->>'planning_group_id',p_values->>'language',nullif(p_values->>'relation_group_id','')::uuid,parent,nullif(btrim(p_values->>'phone'),''),nullif(btrim(p_values->>'postal_address'),''),nullif(btrim(p_values->>'notes'),''))
  RETURNING id INTO v_id;
 ELSE
  UPDATE public.households SET household_name=btrim(p_values->>'household_name'),planning_group_id=p_values->>'planning_group_id',language=p_values->>'language',
   relation_group_id=nullif(p_values->>'relation_group_id','')::uuid,parent_id=parent,phone=nullif(btrim(p_values->>'phone'),''),
   postal_address=nullif(btrim(p_values->>'postal_address'),''),notes=nullif(btrim(p_values->>'notes'),''),updated_at=now() WHERE id=v_id;
 END IF;
 RETURN v_id;
END $$;


--
-- Name: admin_save_household_with_food(uuid, jsonb, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_household_with_food(p_id uuid, p_values jsonb, p_food boolean, p_expected_food boolean) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE household_id uuid;contact_id uuid;
BEGIN
 household_id:=public.admin_save_household(p_id,p_values);
 IF p_values ? 'primary_contact' THEN
  contact_id:=public.admin_save_contact((p_values->'primary_contact'->>'id')::uuid,household_id,p_values->'primary_contact');
  PERFORM public.admin_set_household_primary_contact(household_id,contact_id);
 ELSIF p_values ? 'primary_contact_id' THEN
  PERFORM public.admin_set_household_primary_contact(household_id,(p_values->>'primary_contact_id')::uuid);
 ELSIF p_values ? 'primary_guest_id' THEN
  PERFORM public.admin_set_household_primary_guest(household_id,(p_values->>'primary_guest_id')::uuid);
 END IF;
 IF p_food IS NOT NULL THEN
  PERFORM public.admin_set_food_access(household_id,p_food,p_expected_food,'Updated from Household details');
 END IF;
 RETURN household_id;
END $$;


--
-- Name: admin_save_invitation_template(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_invitation_template(p_language text, p_channel text, p_subject text, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
 subject_text text:=btrim(coalesce(p_subject,''), E' \t\r\n');
 body_text text:=btrim(coalesce(p_body,''), E' \t\r\n');
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_channel IS NULL OR p_channel NOT IN ('email','sms','whatsapp') OR NOT EXISTS(
  SELECT 1 FROM public.event_languages WHERE language_code=p_language AND enabled
 ) THEN
  RAISE EXCEPTION 'Choose an enabled language and a supported delivery channel.';
 END IF;
 IF char_length(subject_text)>300 OR char_length(body_text)>4000
   OR (p_channel<>'email' AND subject_text<>'') OR subject_text ~ E'[\r\n]' THEN
  RAISE EXCEPTION 'The invitation template has an invalid subject or message length.';
 END IF;
 IF body_text='' AND subject_text='' THEN
  DELETE FROM public.message_templates WHERE template_key='invitation'
   AND language_code=p_language AND channel=p_channel;
  RETURN;
 END IF;
 IF strpos(body_text,'{invitation_link}')=0 THEN
  RAISE EXCEPTION 'Include the invitation link placeholder in the message.';
 END IF;
 IF EXISTS(
  SELECT 1 FROM regexp_matches(subject_text||E'\n'||body_text,'\{([[:alnum:]_]+)\}','g') AS token
  WHERE token[1] NOT IN ('invitation_link','event_name','household_name')
 ) THEN
  RAISE EXCEPTION 'The invitation template contains an unknown placeholder.';
 END IF;

 INSERT INTO public.message_templates(template_key,language_code,channel,subject,body)
 VALUES('invitation',p_language,p_channel,nullif(subject_text,''),body_text)
 ON CONFLICT (template_key,language_code,channel) DO UPDATE
 SET subject=excluded.subject,body=excluded.body,is_active=true;
END $$;


--
-- Name: admin_save_language(text, text, boolean, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_language(p_code text, p_name text, p_enabled boolean, p_order integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
BEGIN PERFORM app_private.require_admin_operation('admin_save_language');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_code IS NULL OR p_code !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' OR length(p_code)>16 OR nullif(btrim(p_name),'') IS NULL OR length(p_name)>80 OR p_enabled IS NULL OR p_order IS NULL THEN RAISE EXCEPTION 'Enter a language code, name, enabled state and order';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 INSERT INTO public.event_languages(language_code,display_name,enabled,sort_order) VALUES(p_code,btrim(p_name),p_enabled,p_order)
 ON CONFLICT(language_code) DO UPDATE SET display_name=excluded.display_name,enabled=excluded.enabled,sort_order=excluded.sort_order;
END $_$;


--
-- Name: admin_save_notification_preferences(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_notification_preferences(p_preferences jsonb, p_expected jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE current_preferences jsonb;
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF NOT app_private.valid_notification_preferences(p_preferences) THEN RAISE EXCEPTION 'Invalid status message preferences';END IF;
 SELECT notification_preferences INTO current_preferences FROM public.event_settings WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR current_preferences IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Status message preferences changed; refresh before saving';END IF;
 UPDATE public.event_settings SET notification_preferences=p_preferences WHERE id=1;
END $$;


--
-- Name: admin_save_other(uuid, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_other(p_id uuid, p_values jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE old public.other_items%ROWTYPE;result public.other_items%ROWTYPE;category uuid:=(p_values->>'category_id')::uuid;
BEGIN PERFORM app_private.require_admin_operation('admin_save_other');
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'item'),'') IS NULL OR length(p_values->>'item')>1000 OR length(coalesce(p_values->>'notes',''))>4000 OR length(coalesce(p_values->>'assigned_to',''))>300 OR p_values->>'status' IS NULL OR p_values->>'status' NOT IN ('open','assigned','in_progress','done') OR (p_values->>'sort_order') IS NULL OR (p_values->>'sort_order')::integer<0 THEN RAISE EXCEPTION 'Enter valid item details';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.other_categories WHERE id=category) THEN RAISE EXCEPTION 'Choose a category';END IF;
 SELECT * INTO old FROM public.other_items WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  -- Stable client UUIDs make new-row retries safe after an uncertain response.
  IF p_expected_updated_at IS NULL THEN
   IF old.item=btrim(p_values->>'item') AND coalesce(old.notes,'')=btrim(coalesce(p_values->>'notes','')) AND coalesce(old.assigned_to,'')=btrim(coalesce(p_values->>'assigned_to','')) AND old.status=p_values->>'status' AND old.category_id=category THEN RETURN to_jsonb(old);END IF;
   RAISE EXCEPTION 'Item changed; reload before saving';
  END IF;
  IF old.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Item changed; reload before saving';END IF;
  UPDATE public.other_items SET item=btrim(p_values->>'item'),notes=nullif(btrim(p_values->>'notes'),''),assigned_to=nullif(btrim(p_values->>'assigned_to'),''),status=p_values->>'status',category_id=category,sort_order=(p_values->>'sort_order')::integer,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO result;
 ELSE
  IF p_expected_updated_at IS NOT NULL THEN RAISE EXCEPTION 'Item not found';END IF;
  INSERT INTO public.other_items(id,item,notes,assigned_to,status,category_id,sort_order) VALUES(p_id,btrim(p_values->>'item'),nullif(btrim(p_values->>'notes'),''),nullif(btrim(p_values->>'assigned_to'),''),p_values->>'status',category,(p_values->>'sort_order')::integer) RETURNING * INTO result;
 END IF;
 RETURN to_jsonb(result);
END $$;


--
-- Name: admin_save_other_category(uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_other_category(p_id uuid, p_name text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE result public.other_categories%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_save_other_category');
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>120 THEN RAISE EXCEPTION 'Enter a category name';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_id IS NULL THEN
  SELECT * INTO result FROM public.other_categories WHERE name=btrim(p_name);IF FOUND THEN RETURN to_jsonb(result);END IF;
  INSERT INTO public.other_categories(name,sort_order) VALUES(btrim(p_name),(SELECT coalesce(max(sort_order),0)+1 FROM public.other_categories)) RETURNING * INTO result;
 ELSE
  SELECT * INTO result FROM public.other_categories WHERE id=p_id FOR UPDATE;IF NOT FOUND OR result.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Category changed; reload before saving';END IF;
  UPDATE public.other_categories SET name=btrim(p_name),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO result;
 END IF;
 RETURN to_jsonb(result);
END $$;


--
-- Name: admin_save_planning_configuration(jsonb, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_planning_configuration(p_config jsonb, p_expected_config jsonb, p_preset text, p_expected_preset text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF NOT app_private.valid_planning_configuration(p_config) OR p_preset IS NULL OR (p_preset IS DISTINCT FROM p_expected_preset AND p_preset NOT IN ('wedding','reunion','conference','custom')) THEN
  RAISE EXCEPTION 'Enter valid event planning settings.';
 END IF;
 UPDATE public.event_settings SET planning_config=p_config,event_type=p_preset,updated_at=now()
 WHERE id=1 AND planning_config=p_expected_config AND event_type=p_expected_preset;
 IF NOT FOUND THEN RAISE EXCEPTION 'Planning settings changed. Refresh and try again.';END IF;
END $$;


--
-- Name: admin_save_session(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_session(p_id uuid, p_values jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE v_id uuid:=p_id;s public.event_sessions%ROWTYPE;v_location uuid:=nullif(p_values->>'location_id','')::uuid;v_start timestamptz:=nullif(p_values->>'starts_at','')::timestamptz;v_end timestamptz:=nullif(p_values->>'ends_at','')::timestamptz;v_rsvp boolean:=coalesce((p_values->>'requires_rsvp')::boolean,true);v_active boolean:=coalesce((p_values->>'is_active')::boolean,true);
BEGIN PERFORM app_private.require_admin_operation('admin_save_session');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR p_values->>'session_key' IS NULL OR p_values->>'session_key' !~ '^[a-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'Enter a session name and valid key';END IF;
 IF v_end IS NOT NULL AND (v_start IS NULL OR v_end<=v_start) THEN RAISE EXCEPTION 'End must follow start';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 -- Same household locks as submission and membership changes; eligibility cannot race RSVP.
 PERFORM 1 FROM public.households ORDER BY id FOR UPDATE;
 IF v_location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=v_location AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active venue';END IF;
 IF v_id IS NOT NULL THEN
 SELECT * INTO s FROM public.event_sessions WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Session not found';END IF;
 IF (s.requires_rsvp<>v_rsvp OR s.is_active<>v_active) AND (EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE session_id=v_id) OR EXISTS(SELECT 1 FROM public.guest_session_responses WHERE session_id=v_id) OR EXISTS(SELECT 1 FROM public.rsvp_submissions r JOIN public.guests g ON g.household_id=r.household_id LEFT JOIN public.household_session_defaults d ON d.household_id=r.household_id AND d.session_id=v_id LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=v_id WHERE coalesce(o.is_invited,d.is_invited,false))) THEN RAISE EXCEPTION 'Session eligibility is protected by RSVP history; scheduling details can still be edited';END IF;
 ELSE
 INSERT INTO public.event_sessions(session_key,name,sort_order)
 SELECT p_values->>'session_key',btrim(p_values->>'name'),coalesce(max(sort_order),0)+1 FROM public.event_sessions
 RETURNING id INTO v_id;
 END IF;
 UPDATE public.event_sessions SET session_key=p_values->>'session_key',name=btrim(p_values->>'name'),location_id=v_location,starts_at=v_start,ends_at=v_end,requires_rsvp=v_rsvp,is_active=v_active,sort_order=coalesce((p_values->>'sort_order')::integer,sort_order) WHERE id=v_id;
 RETURN v_id;
END $_$;


--
-- Name: admin_save_session_assignments(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_session_assignments(p_household_id uuid, p_assignments jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;x jsonb;sid uuid;gid uuid;v boolean;b boolean;
BEGIN PERFORM app_private.require_admin_operation('admin_save_session_assignments');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_assignments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_assignments)>2000 THEN RAISE EXCEPTION 'Invalid session assignments';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Active household required';END IF;
 IF h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=h.id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE household_id=h.id) THEN RAISE EXCEPTION 'Invitation changes are blocked by RSVP history';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_assignments) e GROUP BY e->>'session_id',coalesce(e->>'guest_id','') HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate session assignment';END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
 sid:=(x->>'session_id')::uuid;gid:=nullif(x->>'guest_id','')::uuid;
 IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT x ? 'is_invited' OR (jsonb_typeof(x->'is_invited') NOT IN ('boolean','null')) THEN RAISE EXCEPTION 'Invalid invitation value';END IF;
 v:=(x->>'is_invited')::boolean;
 IF NOT EXISTS(SELECT 1 FROM public.event_sessions WHERE id=sid) THEN RAISE EXCEPTION 'Session not found';END IF;
 IF gid IS NULL THEN
 IF v IS NULL THEN RAISE EXCEPTION 'Household invitation must be yes or no';END IF;
 SELECT is_invited INTO b FROM public.household_session_defaults WHERE household_id=h.id AND session_id=sid;
 INSERT INTO public.household_session_defaults VALUES(h.id,sid,v) ON CONFLICT(household_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM public.guests WHERE id=gid AND household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Guest must belong to this household';END IF;
 SELECT is_invited INTO b FROM public.guest_session_overrides WHERE guest_id=gid AND session_id=sid;
 IF v IS NULL THEN DELETE FROM public.guest_session_overrides WHERE guest_id=gid AND session_id=sid;
 ELSE INSERT INTO public.guest_session_overrides VALUES(gid,sid,v) ON CONFLICT(guest_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;END IF;
 END IF;
 IF b IS DISTINCT FROM v THEN INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value) VALUES(h.id,'session_invitations',coalesce(gid,h.id),auth.uid(),'assign',jsonb_build_object('session_id',sid,'guest_id',gid,'is_invited',b),jsonb_build_object('session_id',sid,'guest_id',gid,'is_invited',v));END IF;
 END LOOP;
END $$;


--
-- Name: admin_save_translation(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_translation(p_key text, p_language text, p_value text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN PERFORM app_private.require_admin_operation('admin_save_translation');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language'; END IF;
 PERFORM app_private.store_translation(p_key,p_language,p_value);
END $$;


--
-- Name: admin_save_translations(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_translations(p_changes jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE change jsonb;
BEGIN PERFORM app_private.require_admin_operation('admin_save_translations');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes)>300 THEN RAISE EXCEPTION 'Invalid translations'; END IF;
 FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  PERFORM public.admin_save_translation(change->>'key',change->>'language',change->>'value');
 END LOOP;
END $$;


--
-- Name: admin_save_venue(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_venue(p_id uuid, p_values jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_id uuid:=p_id;v_archived boolean:=coalesce((p_values->>'archived')::boolean,false);
BEGIN PERFORM app_private.require_admin_operation('admin_save_venue');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR length(coalesce(p_values->>'address',''))>1000 OR length(coalesce(p_values->>'notes',''))>2000 OR length(coalesce(p_values->>'map_url',''))>2000 THEN RAISE EXCEPTION 'Enter valid venue details';END IF;
 IF length(coalesce(p_values->>'welcome_fo',''))>4000 OR length(coalesce(p_values->>'welcome_en',''))>4000 OR length(coalesce(p_values->>'welcome_de',''))>4000 THEN RAISE EXCEPTION 'Welcome message too long (maximum 4000 characters per language)';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_values->>'timezone') THEN RAISE EXCEPTION 'Invalid venue timezone';END IF;
 IF nullif(p_values->>'map_url','') IS NOT NULL AND p_values->>'map_url' !~ '^https://[^ /]+' THEN RAISE EXCEPTION 'Map link must use HTTPS';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF v_id IS NOT NULL THEN
 PERFORM 1 FROM public.event_locations WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Venue not found';END IF;
 IF v_archived AND EXISTS(SELECT 1 FROM public.event_sessions WHERE location_id=v_id AND is_active) THEN RAISE EXCEPTION 'Move or deactivate linked sessions before archiving this venue';END IF;
 ELSE INSERT INTO public.event_locations(name) VALUES(btrim(p_values->>'name')) RETURNING id INTO v_id;END IF;
 UPDATE public.event_locations SET name=btrim(p_values->>'name'),address=nullif(btrim(p_values->>'address'),''),map_url=nullif(btrim(p_values->>'map_url'),''),notes=nullif(btrim(p_values->>'notes'),''),timezone=p_values->>'timezone',welcome_en=CASE WHEN p_values ? 'welcome_en' THEN nullif(btrim(p_values->>'welcome_en'),'') ELSE welcome_en END,country_code=nullif(upper(btrim(p_values->>'country_code')),''),archived_at=CASE WHEN v_archived THEN coalesce(archived_at,now()) ELSE NULL END WHERE id=v_id;
 IF p_values ? 'welcome_fo' THEN
  PERFORM app_private.store_translation('venue:'||v_id||':welcome','fo',coalesce(p_values->>'welcome_fo',''));
 END IF;
 IF p_values ? 'welcome_de' THEN
  PERFORM app_private.store_translation('venue:'||v_id||':welcome','de',coalesce(p_values->>'welcome_de',''));
 END IF;
 RETURN v_id;
END $$;


--
-- Name: admin_save_venue_with_translations(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_venue_with_translations(p_id uuid, p_values jsonb, p_translations jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE venue_id uuid; translation record;
BEGIN PERFORM app_private.require_admin_operation('admin_save_venue_with_translations');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_translations) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid venue translations'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_translations))>300 THEN RAISE EXCEPTION 'Too many translations in one save'; END IF;
 venue_id:=public.admin_save_venue(p_id,p_values);
 FOR translation IN SELECT key,value FROM jsonb_each(p_translations) LOOP
  IF jsonb_typeof(translation.value) IS DISTINCT FROM 'string' OR length(translation.value #>> '{}')>4000 THEN
   RAISE EXCEPTION 'Welcome message too long (maximum 4000 characters per language)';
  END IF;
  PERFORM public.admin_save_translation('venue:'||venue_id||':welcome',translation.key,translation.value #>> '{}');
 END LOOP;
 RETURN venue_id;
END $$;


--
-- Name: admin_session_invitation_locks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_session_invitation_locks() RETURNS uuid[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN PERFORM app_private.require_admin_operation('admin_session_invitation_locks');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 RETURN ARRAY(
  SELECT h.id FROM public.households h
  WHERE h.archived_at IS NULL AND (
   h.rsvp_state<>'open'
   OR EXISTS(SELECT 1 FROM public.rsvp_submissions r WHERE r.household_id=h.id)
   OR EXISTS(SELECT 1 FROM public.rsvp_response_audit r WHERE r.household_id=h.id)
  )
 );
END $$;


--
-- Name: admin_set_archived(text, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_archived(p_entity text, p_id uuid, p_archived boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE h public.households%ROWTYPE; hid uuid; existing timestamptz;
BEGIN PERFORM app_private.require_admin_operation('admin_set_archived');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_entity NOT IN ('households','guests','household_contacts') OR p_entity IS NULL OR p_archived IS NULL THEN RAISE EXCEPTION 'Invalid archive request'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_entity='households' THEN hid:=p_id;
 ELSIF p_entity='guests' THEN SELECT household_id INTO hid FROM public.guests WHERE id=p_id;
 ELSE SELECT household_id INTO hid FROM public.household_contacts WHERE id=p_id; END IF;
 SELECT * INTO h FROM public.households WHERE id=hid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record not found'; END IF;
 IF p_entity<>'households' AND h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the household first'; END IF;
 IF p_entity IN ('households','guests') AND (h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=hid)) THEN RAISE EXCEPTION 'Records with submitted RSVPs cannot be archived or restored'; END IF;
 IF p_entity='guests' AND (EXISTS(SELECT 1 FROM public.guest_session_responses WHERE guest_id=p_id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE guest_id=p_id)) THEN RAISE EXCEPTION 'Guest has RSVP history'; END IF;
 IF p_entity='households' THEN
 IF p_archived AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=hid) OR EXISTS(SELECT 1 FROM public.households WHERE parent_id=hid AND archived_at IS NULL) OR EXISTS(SELECT 1 FROM public.invitation_send_queue WHERE household_id=hid AND status IN ('draft','ready')) OR EXISTS(SELECT 1 FROM public.guests g JOIN public.guest_session_responses r ON r.guest_id=g.id WHERE g.household_id=hid) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE household_id=hid)) THEN RAISE EXCEPTION 'Resolve food commitments, active child households, invitation queues or RSVP history before archiving'; END IF;
 IF NOT p_archived AND EXISTS(SELECT 1 FROM public.households WHERE id=h.parent_id AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore the parent household first'; END IF;
 END IF;
 IF p_entity='household_contacts' AND p_archived THEN UPDATE public.household_contacts SET is_primary=false WHERE id=p_id; END IF;
 EXECUTE format('UPDATE public.%I SET archived_at=$1,updated_at=now() WHERE id=$2',p_entity) USING CASE WHEN p_archived THEN now() ELSE NULL END,p_id;
END $_$;


--
-- Name: admin_set_food_access(uuid, boolean, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_food_access(p_household_id uuid, p_enabled boolean, p_expected boolean, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_set_food_access');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Food access and reason required';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Active household required';END IF;
 IF h.food IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Food access changed; refresh and try again';END IF;
 IF h.food=p_enabled THEN RETURN;END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Add a guest before enabling food access';END IF;
 IF NOT p_enabled AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=h.id)) THEN RAISE EXCEPTION 'Food commitments exist; access cannot be disabled';END IF;
 UPDATE public.households SET food=p_enabled WHERE id=h.id;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value) VALUES(h.id,'food_access',h.id,auth.uid(),'permission_change',jsonb_build_object('enabled',h.food),jsonb_build_object('enabled',p_enabled,'reason',btrim(p_reason)));
END $$;


--
-- Name: admin_set_food_category(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_food_category(p_food_item_id uuid, p_category text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_old_category text;v_new_category text;v_next integer;
BEGIN PERFORM app_private.require_admin_operation('admin_set_food_category');
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  v_new_category:=btrim(coalesce(p_category,''));
  IF length(v_new_category)>120 THEN RAISE EXCEPTION 'Category is too long'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT category INTO v_old_category FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
  IF v_new_category<>'' AND NOT EXISTS(SELECT 1 FROM public.food_categories WHERE name=v_new_category) THEN
    RAISE EXCEPTION 'Create the food category before assigning it';
  END IF;
  IF v_old_category IS NOT DISTINCT FROM nullif(v_new_category,'') THEN RETURN; END IF;
  SELECT coalesce(max(sort_order),0)+1 INTO v_next FROM public.food_items WHERE category IS NOT DISTINCT FROM nullif(v_new_category,'');
  UPDATE public.food_items SET category=nullif(v_new_category,''),sort_order=v_next,updated_at=now() WHERE id=p_food_item_id;
END $$;


--
-- Name: admin_set_food_selection(uuid, uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_food_selection(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_expected_quantity integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;
BEGIN PERFORM app_private.require_admin_operation('admin_set_food_selection');
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_expected_quantity IS NULL OR p_expected_quantity<0 THEN RAISE EXCEPTION 'Expected quantity required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR (h.food_confirmed AND p_expected_quantity=0) THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 PERFORM app_private.save_food_selection(h.id,p_food_item_id,p_quantity,NULL,p_expected_quantity);
END $$;


--
-- Name: admin_set_food_stage(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_food_stage(p_stage text, p_expected_stage text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('food','edit');
 IF p_stage IS NULL OR p_stage NOT IN ('interest','selection') THEN RAISE EXCEPTION 'Choose a valid food stage';END IF;
 UPDATE public.event_settings SET food_stage=p_stage WHERE id=1 AND food_stage=p_expected_stage;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food stage changed; refresh before saving';END IF;
END $$;


--
-- Name: admin_set_household_parent(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_household_parent(p_household_id uuid, p_parent_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_planning_group text; v_group uuid; v_old_parent uuid; v_parent_planning_group text; v_parent_group uuid; v_next integer;
BEGIN PERFORM app_private.require_admin_operation('admin_set_household_parent');
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
  SELECT planning_group_id,relation_group_id,parent_id INTO v_planning_group,v_group,v_old_parent
    FROM public.households WHERE id=p_household_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
  IF p_parent_id IS NOT NULL THEN
    IF p_parent_id=p_household_id THEN RAISE EXCEPTION 'A household cannot be its own parent'; END IF;
    SELECT planning_group_id,relation_group_id INTO v_parent_planning_group,v_parent_group
      FROM public.households WHERE id=p_parent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent household not found'; END IF;
    IF v_planning_group<>v_parent_planning_group OR v_group IS DISTINCT FROM v_parent_group THEN
      RAISE EXCEPTION 'Parent must belong to the same top-level group and relation group';
    END IF;
  END IF;
  IF v_old_parent IS NOT DISTINCT FROM p_parent_id THEN RETURN; END IF;
  SELECT coalesce(max(sort_order),0)+1 INTO v_next FROM public.households
    WHERE planning_group_id=v_planning_group AND relation_group_id IS NOT DISTINCT FROM v_group AND parent_id IS NOT DISTINCT FROM p_parent_id;
  -- The existing guard_household_parent trigger prevents any ancestor cycle.
  UPDATE public.households SET parent_id=p_parent_id,sort_order=v_next,updated_at=now() WHERE id=p_household_id;
END $$;


--
-- Name: admin_set_household_primary_contact(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_household_primary_contact(p_household_id uuid, p_contact_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE contact public.household_contacts;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO contact FROM public.household_contacts WHERE id=p_contact_id AND household_id=p_household_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active contact from this household';END IF;
 IF NOT app_private.valid_primary_contact_delivery(contact.contact_type,contact.preferred_method,contact.contact_value) THEN
  RAISE EXCEPTION 'Matching contact details required';
 END IF;
 PERFORM public.admin_set_household_primary_guest(p_household_id,NULL);
 UPDATE public.household_contacts SET is_household_primary=true,updated_at=now() WHERE id=p_contact_id;
END $$;


--
-- Name: admin_set_household_primary_guest(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_household_primary_guest(p_household_id uuid, p_guest_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE guest public.guests;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_guest_id IS NOT NULL THEN
  SELECT * INTO guest FROM public.guests
 WHERE id=p_guest_id AND NOT is_child AND archived_at IS NULL
 AND EXISTS(SELECT 1 FROM public.households source WHERE source.id=guests.household_id AND source.archived_at IS NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active non-child guest from an active household';END IF;
  IF NOT app_private.valid_primary_contact_delivery(
   CASE WHEN guest.preferred_contact_method='email' THEN 'email' ELSE 'phone' END,
   guest.preferred_contact_method,
   CASE WHEN guest.preferred_contact_method='email' THEN guest.email ELSE guest.mobile END
  ) THEN RAISE EXCEPTION 'Matching contact details required';END IF;
 END IF;
 UPDATE public.households SET primary_guest_id=p_guest_id,updated_at=now()
 WHERE id=p_household_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household not found';END IF;
 UPDATE public.household_contacts SET is_household_primary=NULL,updated_at=now()
 WHERE household_id=p_household_id AND is_household_primary IS TRUE;
END $$;


--
-- Name: admin_set_invitation_access(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_invitation_access(p_id uuid, p_permissions jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
 PERFORM app_private.require_permission('full');IF NOT app_private.valid_permissions(p_permissions) THEN RAISE EXCEPTION 'Invalid access permissions';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);PERFORM 1 FROM public.admin_invitations WHERE id=p_id AND status='pending' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 INSERT INTO app_private.pending_admin_permissions VALUES(p_id,p_permissions) ON CONFLICT(invitation_id) DO UPDATE SET permissions=excluded.permissions;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) SELECT id,auth.uid(),'permissions_changed',email,jsonb_build_object('permissions',p_permissions) FROM public.admin_invitations WHERE id=p_id;
END $$;


--
-- Name: admin_set_language_preferences(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_language_preferences(p_default text, p_fallback text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN PERFORM app_private.require_admin_operation('admin_set_language_preferences');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 UPDATE public.event_settings SET default_language=p_default,fallback_language=p_fallback,updated_at=now() WHERE id=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event settings not found';END IF;
END $$;


--
-- Name: admin_set_member_state(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_member_state(p_user_id uuid, p_state text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: admin_update_guest(uuid, text, text, text, text, text, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_guest(p_guest_id uuid, p_first_name text, p_last_name text, p_courtesy_title text, p_relation text, p_language text, p_is_child boolean, p_dietary_requirements text, p_notes text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_first text := NULLIF(pg_catalog.btrim(p_first_name), '');
  v_last text := NULLIF(pg_catalog.btrim(p_last_name), '');
  v_title text := NULLIF(pg_catalog.btrim(p_courtesy_title), '');
  v_relation text := NULLIF(pg_catalog.btrim(p_relation), '');
  v_dietary text := NULLIF(pg_catalog.btrim(p_dietary_requirements), '');
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
BEGIN PERFORM app_private.require_admin_operation('admin_update_guest');
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_guest_id IS NULL OR v_first IS NULL OR pg_catalog.char_length(v_first)>120 THEN
    RAISE EXCEPTION 'A first name of at most 120 characters is required';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_last,''))>120 OR
     pg_catalog.char_length(COALESCE(v_relation,''))>160 OR
     pg_catalog.char_length(COALESCE(v_dietary,''))>1000 OR
     pg_catalog.char_length(COALESCE(v_notes,''))>2000 THEN
    RAISE EXCEPTION 'Guest field exceeds maximum length';
  END IF;
  IF v_title IS NOT NULL AND v_title NOT IN ('Mr.','Ms.','Son','Daughter') THEN
    RAISE EXCEPTION 'Invalid courtesy title';
  END IF;
  IF p_language IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language) THEN
    RAISE EXCEPTION 'Invalid guest language';
  END IF;
  IF p_is_child IS NULL THEN
    RAISE EXCEPTION 'Guest child flag is required';
  END IF;

  UPDATE public.guests
  SET first_name=v_first, last_name=v_last,
      courtesy_title=v_title, relation=v_relation,
      language=p_language, is_child=p_is_child,
      dietary_requirements=v_dietary, notes=v_notes,
      updated_at=pg_catalog.now()
  WHERE id=p_guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest not found';
  END IF;
END
$$;


--
-- Name: admin_update_member(uuid, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_member(p_user_id uuid, p_name text, p_permissions jsonb, p_expected jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE a public.admins%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');PERFORM pg_advisory_xact_lock(42319,11);
 SELECT * INTO a FROM public.admins WHERE user_id=p_user_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;
 IF a.access_permissions IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Access changed. Refresh before saving.' USING ERRCODE='40001';END IF;
 IF a.access_permissions->>'preset'='full' AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can change a Full administrator' USING ERRCODE='42501';END IF;
 IF p_permissions IS NOT NULL AND p_permissions IS DISTINCT FROM a.access_permissions THEN PERFORM public.admin_save_access(p_user_id,p_permissions,p_expected);END IF;
 IF p_name IS DISTINCT FROM a.name THEN PERFORM public.admin_rename_member(p_user_id,p_name);END IF;
END $$;


--
-- Name: confirm_household_food(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_household_food(p_code text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_id uuid;
BEGIN PERFORM app_private.require_food_selection_stage(); IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF;
 SELECT id INTO v_id FROM public.households WHERE archived_at IS NULL AND invite_code=p_code AND food=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid food invitation'; END IF;
 UPDATE public.households SET food_confirmed=true,food_confirmed_at=coalesce(food_confirmed_at,now()) WHERE id=v_id AND NOT food_confirmed;
END $$;


--
-- Name: confirm_household_food(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_household_food(p_code text, p_expected_claims jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
END $_$;


--
-- Name: get_household_food(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_household_food(p_code text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 SELECT app_private.guest_food(h.id,false) FROM public.households h CROSS JOIN public.event_settings e
 WHERE e.id=1 AND e.is_published AND e.food_enabled AND h.invite_code=p_code AND h.archived_at IS NULL AND (h.food OR e.food_stage='interest')
$$;


--
-- Name: get_invitation_logged(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_invitation_logged(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE invitation jsonb;
BEGIN
 invitation:=public.get_invitation_v2(p_code);
 IF invitation IS NOT NULL THEN PERFORM public.record_invitation_open(p_code);END IF;
 RETURN invitation;
END $$;


--
-- Name: get_invitation_v2(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_invitation_v2(p_code text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
 SELECT app_private.guest_invitation(h)||jsonb_build_object('eventData',app_private.guest_event_for_household(h.id)) FROM public.households h
 WHERE p_code ~ '^[A-HJ-NP-Z2-9]{8}$' AND h.invite_code=p_code AND h.archived_at IS NULL
 AND EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)
$_$;


--
-- Name: get_language_configuration(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_language_configuration() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 SELECT jsonb_build_object('languages',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY sort_order,language_code),'[]') FROM public.event_languages l WHERE enabled),
 'default_language',e.default_language,'fallback_language',e.fallback_language,
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.event_content c JOIN public.event_languages l USING(language_code) WHERE l.enabled AND c.content_key LIKE 'ui:%'))
 FROM public.event_settings e WHERE e.id=1
$$;


--
-- Name: get_public_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_event() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ SELECT NULL::jsonb $$;


--
-- Name: get_public_event_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_event_v2() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ SELECT NULL::jsonb $$;


--
-- Name: guard_household_parent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_household_parent() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE found_cycle boolean;
BEGIN
 IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 WITH RECURSIVE ancestry(id,parent_id,path) AS (
  SELECT h.id,h.parent_id,ARRAY[h.id] FROM public.households h WHERE h.id=NEW.parent_id
  UNION ALL
  SELECT p.id,p.parent_id,a.path||p.id FROM public.households p JOIN ancestry a ON p.id=a.parent_id
  WHERE NOT p.id=ANY(a.path)
 ) SELECT EXISTS(SELECT 1 FROM ancestry WHERE id=NEW.id OR parent_id=NEW.id) INTO found_cycle;
 IF NEW.parent_id=NEW.id OR found_cycle THEN RAISE EXCEPTION 'Household hierarchy cycle'; END IF;
 RETURN NEW;
END $$;


--
-- Name: guest_gateway_allow_request(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guest_gateway_allow_request(p_ip_hash text, p_code text, p_action text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE v_period timestamptz;v_limit integer;v_key text;v_ok boolean;v_code text:=upper(coalesce(p_code,''));v_n integer;
BEGIN
 IF p_ip_hash !~ '^[a-f0-9]{64}$'
 OR p_action NOT IN ('add_household_guest','set_household_food_group','set_household_food_interest','get_invitation_v2','get_household_food','set_household_food_claim','confirm_household_food','submit_household_rsvp')
 OR v_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN false; END IF;
 v_period:=date_trunc('minute',clock_timestamp());
 FOR v_n IN 1..3 LOOP
  IF v_n=1 THEN v_key:='ip:'||p_ip_hash;v_limit:=40;
  ELSIF v_n=2 THEN v_key:='code:'||md5(v_code);v_limit:=20;
  ELSE v_key:='global';v_limit:=2500;END IF;
  INSERT INTO public.guest_gateway_rate_limits(key_hash,period_start,request_count)
   VALUES(v_key,v_period,1)
   ON CONFLICT (key_hash,period_start) DO UPDATE
     SET request_count=public.guest_gateway_rate_limits.request_count+1
     WHERE public.guest_gateway_rate_limits.request_count<v_limit
   RETURNING true INTO v_ok;
  IF coalesce(v_ok,false)=false THEN RETURN false; END IF;
  v_ok:=false;
 END LOOP;
 RETURN true;
END $_$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 SELECT app_private.session_is_live() AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid() AND access_state='active')
$$;


--
-- Name: prevent_history_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN RAISE EXCEPTION 'Historical records are immutable'; END $$;


--
-- Name: record_invitation_open(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_invitation_open(p_code text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RETURN;END IF;
 -- Coalesce repeated loads from the same household into one opening every 15 minutes.
 IF NOT EXISTS(SELECT 1 FROM public.invitation_access_audit WHERE household_id=h.id AND created_at>clock_timestamp()-interval '15 minutes') THEN INSERT INTO public.invitation_access_audit(household_id) VALUES(h.id);END IF;
END $$;


--
-- Name: set_household_food_claim(text, uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_household_food_claim(p_code text, p_food_item_id uuid, p_quantity integer, p_notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;
BEGIN PERFORM app_private.require_food_selection_stage();
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR h.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 PERFORM 1 FROM public.food_items WHERE id=p_food_item_id FOR UPDATE; IF EXISTS(SELECT 1 FROM public.food_items WHERE id=p_food_item_id AND food_group_id IS NOT NULL) THEN RAISE EXCEPTION 'Choose the complete Food Group';END IF; PERFORM app_private.save_food_selection(h.id,p_food_item_id,p_quantity,p_notes,NULL);
IF p_quantity>0 THEN UPDATE public.households SET food_interest=true WHERE id=h.id AND food_interest IS DISTINCT FROM true;END IF; END $$;


--
-- Name: set_household_food_group(text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_household_food_group(p_code text, p_group_id uuid, p_quantity integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE h public.households; item uuid; total integer;
BEGIN PERFORM app_private.require_food_selection_stage();
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_quantity IS NULL OR p_quantity NOT IN (0,1) THEN RAISE EXCEPTION 'Invalid group selection';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR h.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable';END IF;
 PERFORM pg_advisory_xact_lock(19421,7745);
 PERFORM 1 FROM public.food_items WHERE food_group_id=p_group_id ORDER BY id FOR UPDATE;
 SELECT count(*) INTO total FROM public.food_items WHERE food_group_id=p_group_id;
 IF total<2 THEN RAISE EXCEPTION 'Food Group unavailable';END IF;
 IF EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE c.household_id=h.id AND f.food_group_id=p_group_id AND c.quantity<>1) THEN RAISE EXCEPTION 'Contact the organizer to change this commitment';END IF;
 FOR item IN SELECT id FROM public.food_items WHERE food_group_id=p_group_id ORDER BY id LOOP
  PERFORM app_private.save_food_selection(h.id,item,p_quantity,NULL,NULL);
 END LOOP;
IF p_quantity>0 THEN UPDATE public.households SET food_interest=true WHERE id=h.id AND food_interest IS DISTINCT FROM true;END IF; END $_$;


--
-- Name: set_household_food_interest(text, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_household_food_interest(p_code text, p_interest boolean, p_expected_interest boolean DEFAULT NULL::boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE h public.households;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_interest IS NULL THEN RAISE EXCEPTION 'Invalid food interest response';END IF;
 PERFORM 1 FROM public.event_settings WHERE id=1 AND is_published AND food_enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Invalid invitation';END IF;
 IF h.food_interest IS NOT DISTINCT FROM p_interest THEN RETURN app_private.guest_food(h.id,false);END IF;
 IF h.food_interest IS DISTINCT FROM p_expected_interest THEN RAISE EXCEPTION 'Food answer changed; refresh before saving';END IF;
 IF NOT p_interest AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=h.id)) THEN RAISE EXCEPTION 'Contact the organizer to change existing food commitments';END IF;
 UPDATE public.households SET food_interest=p_interest WHERE id=h.id;
 RETURN app_private.guest_food(h.id,false);
END $_$;


--
-- Name: submit_household_rsvp(text, uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_household_rsvp(p_code text, p_request_id uuid, p_responses jsonb, p_comment text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE h public.households%ROWTYPE;d public.event_settings%ROWTYPE;v_expected integer;v_actual integer;v_id uuid;v_number integer;v_snapshot jsonb;v_comment text:=nullif(btrim(p_comment),'');v_prior public.rsvp_submissions%ROWTYPE;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF;
IF p_comment IS NOT NULL AND length(p_comment)>2000 THEN RAISE EXCEPTION 'RSVP comment must be at most 2000 characters';END IF;
IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_request_id IS NULL OR jsonb_typeof(p_responses) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid submission'; END IF;
SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
SELECT * INTO v_prior FROM public.rsvp_submissions WHERE household_id=h.id AND request_id=p_request_id;
IF FOUND THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id',(x->>'guest_id')::uuid,'session_id',(x->>'session_id')::uuid,'status',x->>'status') ORDER BY x->>'guest_id',x->>'session_id'),'[]'::jsonb) INTO v_snapshot FROM jsonb_array_elements(p_responses) x;
 IF v_prior.comment IS DISTINCT FROM v_comment OR v_prior.submission_snapshot IS DISTINCT FROM v_snapshot THEN RAISE EXCEPTION 'Submission already processed with different answers';END IF;
 RETURN jsonb_build_object('submission_id',v_prior.id,'already_processed',true);
END IF;
IF h.rsvp_state<>'open' THEN RAISE EXCEPTION 'RSVP is locked'; END IF;
SELECT * INTO d FROM public.event_settings WHERE id=1;
IF NOT FOUND THEN RAISE EXCEPTION 'Event not configured'; END IF;
IF d.rsvp_deadline IS NOT NULL AND clock_timestamp()>d.rsvp_deadline AND (h.late_submission_until IS NULL OR clock_timestamp()>h.late_submission_until) THEN RAISE EXCEPTION 'RSVP deadline passed'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_responses) x WHERE jsonb_typeof(x)<>'object' OR (x->>'guest_id') IS NULL OR (x->>'session_id') IS NULL OR (x->>'status') IS NULL OR x->>'status' NOT IN ('attending','declined')) THEN RAISE EXCEPTION 'Invalid response entry'; END IF;
IF EXISTS(SELECT 1 FROM (SELECT (x->>'guest_id')::uuid guest_id,(x->>'session_id')::uuid session_id,count(*) n FROM jsonb_array_elements(p_responses) x GROUP BY 1,2 HAVING count(*)<>1) z) THEN RAISE EXCEPTION 'Duplicate response'; END IF;
SELECT count(*) INTO v_expected FROM public.effective_session_invitations v WHERE v.household_id=h.id AND v.requires_rsvp;
SELECT count(*) INTO v_actual FROM jsonb_array_elements(p_responses) x JOIN public.effective_session_invitations v ON v.guest_id=(x->>'guest_id')::uuid AND v.session_id=(x->>'session_id')::uuid WHERE v.household_id=h.id AND v.requires_rsvp;
IF v_expected<>v_actual OR jsonb_array_length(p_responses)<>v_expected THEN RAISE EXCEPTION 'Incomplete or unauthorized responses'; END IF;
SELECT coalesce(max(submission_number),0)+1 INTO v_number FROM public.rsvp_submissions WHERE household_id=h.id;
SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id',(x->>'guest_id')::uuid,'session_id',(x->>'session_id')::uuid,'status',x->>'status') ORDER BY x->>'guest_id',x->>'session_id'),'[]'::jsonb) INTO v_snapshot FROM jsonb_array_elements(p_responses) x;
INSERT INTO public.rsvp_submissions(household_id,submission_number,request_id,submission_snapshot,comment) VALUES(h.id,v_number,p_request_id,v_snapshot,v_comment) RETURNING id INTO v_id;
DELETE FROM public.guest_session_responses r USING public.guests g WHERE r.guest_id=g.id AND g.household_id=h.id;
INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status,last_submission_id) SELECT (x->>'guest_id')::uuid,(x->>'session_id')::uuid,x->>'status',v_id FROM jsonb_array_elements(p_responses) x;
INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,action,new_status) SELECT h.id,(x->>'guest_id')::uuid,(x->>'session_id')::uuid,'submission',x->>'status' FROM jsonb_array_elements(p_responses) x;
UPDATE public.households SET rsvp_state='locked',rsvp_submitted_at=now(),latest_rsvp_submission_id=v_id,late_submission_until=NULL WHERE id=h.id;
INSERT INTO public.rsvp_household_audit(household_id,action,submission_id) VALUES(h.id,'submitted',v_id);
RETURN jsonb_build_object('submission_id',v_id,'submission_number',v_number,'already_processed',false);
END $_$;


--
-- Name: admin_access_audit; Type: TABLE; Schema: app_private; Owner: -
--

CREATE TABLE app_private.admin_access_audit (
    id bigint NOT NULL,
    actor_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: admin_access_audit_id_seq; Type: SEQUENCE; Schema: app_private; Owner: -
--

ALTER TABLE app_private.admin_access_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME app_private.admin_access_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: admin_session_revocations; Type: TABLE; Schema: app_private; Owner: -
--

CREATE TABLE app_private.admin_session_revocations (
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    revoked_by uuid NOT NULL,
    revoked_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: admin_invitation_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_invitation_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invitation_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    email text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: admin_membership_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_membership_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_membership_audit_action_check CHECK ((action = ANY (ARRAY['add'::text, 'remove'::text, 'rename'::text])))
);


--
-- Name: admin_session_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_session_audit (
    id bigint NOT NULL,
    actor_user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT admin_session_audit_action_check CHECK ((action = ANY (ARRAY['login'::text, 'logout_requested'::text])))
);


--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    user_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    access_state text DEFAULT 'active'::text NOT NULL,
    access_permissions jsonb DEFAULT app_private.permission_preset('full'::text) NOT NULL,
    CONSTRAINT admins_access_permissions_check CHECK (app_private.valid_permissions(access_permissions)),
    CONSTRAINT admins_access_state_check CHECK ((access_state = ANY (ARRAY['active'::text, 'suspended'::text, 'restored'::text])))
);


--
-- Name: event_configuration_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_configuration_audit (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    before_value jsonb,
    after_value jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: event_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_key text NOT NULL,
    name text NOT NULL,
    location_id uuid,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    requires_rsvp boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    CONSTRAINT event_sessions_check CHECK (((starts_at IS NULL) OR (ends_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT event_sessions_description_check CHECK ((length(description) <= 12000))
);


--
-- Name: guests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text,
    relation text,
    language text,
    is_child boolean DEFAULT false NOT NULL,
    rsvp_status text DEFAULT 'pending'::text NOT NULL,
    dietary_requirements text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    courtesy_title text,
    archived_at timestamp with time zone,
    sort_order integer,
    phone text,
    mobile text,
    email text,
    preferred_contact_method text,
    CONSTRAINT guests_courtesy_title_check CHECK (((courtesy_title IS NULL) OR (courtesy_title = ANY (ARRAY['Mr.'::text, 'Ms.'::text, 'Son'::text, 'Daughter'::text])))),
    CONSTRAINT guests_email_check CHECK (((email IS NULL) OR (char_length(email) <= 254))),
    CONSTRAINT guests_mobile_check CHECK (((mobile IS NULL) OR (char_length(mobile) <= 80))),
    CONSTRAINT guests_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 80))),
    CONSTRAINT guests_preferred_contact_method_check CHECK (((preferred_contact_method IS NULL) OR (preferred_contact_method = ANY (ARRAY['sms'::text, 'whatsapp'::text, 'email'::text])))),
    CONSTRAINT guests_rsvp_status_check CHECK ((rsvp_status = ANY (ARRAY['pending'::text, 'attending'::text, 'declined'::text]))),
    CONSTRAINT guests_sort_order_check CHECK (((sort_order IS NULL) OR (sort_order >= 0)))
);


--
-- Name: invitation_access_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_access_audit (
    id bigint NOT NULL,
    household_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: invitation_delivery_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_delivery_audit (
    id bigint NOT NULL,
    queue_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    previous_value jsonb,
    new_value jsonb,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invitation_send_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_send_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    contact_id uuid,
    channel text NOT NULL,
    message_subject text,
    message_body text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    recipient_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    invitation_code_snapshot text,
    CONSTRAINT invitation_send_queue_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'postal'::text, 'manual'::text]))),
    CONSTRAINT invitation_send_queue_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'ready'::text, 'sent'::text, 'cancelled'::text, 'failed'::text])))
);


--
-- Name: management_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.management_audit (
    id bigint NOT NULL,
    household_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    before_value jsonb,
    after_value jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rsvp_household_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rsvp_household_audit (
    id bigint NOT NULL,
    household_id uuid NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    submission_id uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rsvp_household_audit_action_check CHECK ((action = ANY (ARRAY['submitted'::text, 'reopened'::text, 'late_submission_authorized'::text, 'admin_locked'::text]))),
    CONSTRAINT rsvp_household_audit_check CHECK (((action <> ALL (ARRAY['reopened'::text, 'late_submission_authorized'::text, 'admin_locked'::text])) OR ((actor_user_id IS NOT NULL) AND (length(btrim(reason)) > 0))))
);


--
-- Name: rsvp_response_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rsvp_response_audit (
    id bigint NOT NULL,
    household_id uuid NOT NULL,
    guest_id uuid NOT NULL,
    session_id uuid NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    previous_status text,
    new_status text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rsvp_response_audit_action_check CHECK ((action = ANY (ARRAY['submission'::text, 'admin_correction'::text]))),
    CONSTRAINT rsvp_response_audit_check CHECK (((action <> 'admin_correction'::text) OR ((actor_user_id IS NOT NULL) AND (length(btrim(reason)) > 0)))),
    CONSTRAINT rsvp_response_audit_new_status_check CHECK ((new_status = ANY (ARRAY['attending'::text, 'declined'::text])))
);


--
-- Name: administration_log_entries; Type: VIEW; Schema: app_private; Owner: -
--

CREATE VIEW app_private.administration_log_entries AS
 SELECT ('management:'::text || (m.id)::text) AS event_key,
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
            WHEN (m.entity_type = 'session_invitations'::text) THEN 'invitations_changed'::text
            WHEN (m.action = 'insert'::text) THEN 'add'::text
            WHEN (m.action = 'delete'::text) THEN 'delete'::text
            WHEN ((m.action = 'update'::text) AND ((m.before_value ->> 'archived_at'::text) IS DISTINCT FROM (m.after_value ->> 'archived_at'::text))) THEN
            CASE
                WHEN ((m.after_value ->> 'archived_at'::text) IS NULL) THEN 'restore'::text
                ELSE 'archive'::text
            END
            WHEN (m.action = ANY (ARRAY['update'::text, 'permission_change'::text])) THEN 'update'::text
            ELSE m.action
        END AS action,
    m.household_id,
    m.actor_user_id,
    COALESCE(NULLIF(concat_ws(' '::text, (m.after_value ->> 'first_name'::text), (m.after_value ->> 'last_name'::text)), ''::text), (m.after_value ->> 'contact_name'::text), (m.after_value ->> 'household_name'::text), m.entity_type) AS subject,
    jsonb_build_object('entity', m.entity_type, 'before', m.before_value, 'after', m.after_value) AS details
   FROM public.management_audit m
UNION ALL
 SELECT ('rsvp-household:'::text || r.id) AS event_key,
    r.created_at AS occurred_at,
    'rsvp'::text AS category,
    r.action,
    r.household_id,
    r.actor_user_id,
    'Household RSVP'::text AS subject,
    jsonb_build_object('reason', r.reason, 'submission_id', r.submission_id) AS details
   FROM public.rsvp_household_audit r
UNION ALL
 SELECT ('rsvp-response:'::text || r.id) AS event_key,
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
   FROM ((public.rsvp_response_audit r
     LEFT JOIN public.guests g ON ((g.id = r.guest_id)))
     LEFT JOIN public.event_sessions s ON ((s.id = r.session_id)))
UNION ALL
 SELECT ('delivery:'::text || a.id) AS event_key,
    a.created_at AS occurred_at,
    'invitations'::text AS category,
        CASE a.action
            WHEN 'confirmed_sent'::text THEN 'sent'::text
            ELSE a.action
        END AS action,
    q.household_id,
    a.actor_user_id,
    'Invitation delivery'::text AS subject,
    jsonb_build_object('channel', q.channel, 'reason', a.reason, 'before_status', (a.previous_value ->> 'status'::text), 'after_status', (a.new_value ->> 'status'::text)) AS details
   FROM (public.invitation_delivery_audit a
     JOIN public.invitation_send_queue q ON ((q.id = a.queue_id)))
UNION ALL
 SELECT ('opened:'::text || a.id) AS event_key,
    a.created_at AS occurred_at,
    'invitations'::text AS category,
    'opened'::text AS action,
    a.household_id,
    NULL::uuid AS actor_user_id,
    'Invitation opened'::text AS subject,
    jsonb_build_object('recording', 'Successful invitation load; repeated loads within 15 minutes are grouped') AS details
   FROM public.invitation_access_audit a
UNION ALL
 SELECT ('configuration:'::text || a.id) AS event_key,
    a.created_at AS occurred_at,
        CASE a.entity_type
            WHEN 'event_locations'::text THEN 'venues'::text
            ELSE 'sessions'::text
        END AS category,
        CASE
            WHEN (a.before_value IS NULL) THEN 'add'::text
            WHEN ((a.before_value ->> 'archived_at'::text) IS DISTINCT FROM (a.after_value ->> 'archived_at'::text)) THEN
            CASE
                WHEN ((a.after_value ->> 'archived_at'::text) IS NULL) THEN 'restore'::text
                ELSE 'archive'::text
            END
            ELSE 'update'::text
        END AS action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    COALESCE((a.after_value ->> 'name'::text), a.entity_type) AS subject,
    jsonb_build_object('before', a.before_value, 'after', a.after_value) AS details
   FROM public.event_configuration_audit a
UNION ALL
 SELECT ('membership:'::text || a.id) AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_id AS actor_user_id,
    COALESCE((a.details ->> 'name'::text), 'Administrator access'::text) AS subject,
    jsonb_build_object('subject_id', a.subject_id, 'details', a.details) AS details
   FROM public.admin_membership_audit a
UNION ALL
 SELECT ('app-session:'::text || a.id) AS event_key,
    a.created_at AS occurred_at,
    'login'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    'Administrator session'::text AS subject,
    jsonb_build_object('source', 'Verified app session') AS details
   FROM public.admin_session_audit a
UNION ALL
 SELECT ('auth:'::text || a.id) AS event_key,
    a.created_at AS occurred_at,
    'login'::text AS category,
    COALESCE((a.payload ->> 'action'::text), 'auth_event'::text) AS action,
    NULL::uuid AS household_id,
    u.id AS actor_user_id,
    'Authentication'::text AS subject,
    jsonb_build_object('source', 'Auth service', 'provider', (a.payload ->> 'provider'::text)) AS details
   FROM (auth.audit_log_entries a
     LEFT JOIN auth.users u ON (((u.id)::text = (a.payload ->> 'actor_id'::text))))
  WHERE (a.created_at IS NOT NULL)
UNION ALL
 SELECT ('admin-invitation:'::text || a.id) AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    a.email AS subject,
    a.details
   FROM public.admin_invitation_audit a
UNION ALL
 SELECT ('access:'::text || (a.id)::text) AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_id AS actor_user_id,
    COALESCE(( SELECT admins.name
           FROM public.admins
          WHERE (admins.user_id = a.subject_id)), 'Former administrator'::text) AS subject,
    a.details
   FROM app_private.admin_access_audit a;


--
-- Name: invitation_code_registry; Type: TABLE; Schema: app_private; Owner: -
--

CREATE TABLE app_private.invitation_code_registry (
    code text NOT NULL,
    household_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pending_admin_permissions; Type: TABLE; Schema: app_private; Owner: -
--

CREATE TABLE app_private.pending_admin_permissions (
    invitation_id uuid NOT NULL,
    permissions jsonb NOT NULL,
    CONSTRAINT pending_admin_permissions_permissions_check CHECK (app_private.valid_permissions(permissions))
);


--
-- Name: admin_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    invited_by uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    delivery_state text DEFAULT 'sending'::text NOT NULL,
    attempt_id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    last_attempt_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    sent_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (clock_timestamp() + '7 days'::interval) NOT NULL,
    accepted_by uuid,
    accepted_at timestamp with time zone,
    last_error_code text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT admin_invitations_delivery_state_check CHECK ((delivery_state = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT admin_invitations_email_check CHECK (((email = lower(btrim(email))) AND ((length(email) >= 3) AND (length(email) <= 254)))),
    CONSTRAINT admin_invitations_name_check CHECK (((length(name) >= 1) AND (length(name) <= 120))),
    CONSTRAINT admin_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'cancelled'::text])))
);


--
-- Name: admin_session_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.admin_session_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.admin_session_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: backup_restore_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_restore_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid NOT NULL,
    checksum text NOT NULL,
    source_created_at timestamp with time zone,
    restored_counts jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: guest_session_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_session_overrides (
    guest_id uuid NOT NULL,
    session_id uuid NOT NULL,
    is_invited boolean NOT NULL
);


--
-- Name: household_session_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.household_session_defaults (
    household_id uuid NOT NULL,
    session_id uuid NOT NULL,
    is_invited boolean DEFAULT true NOT NULL
);


--
-- Name: effective_session_invitations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.effective_session_invitations WITH (security_invoker='true') AS
 SELECT g.id AS guest_id,
    g.household_id,
    s.id AS session_id,
    s.requires_rsvp
   FROM ((((public.guests g
     JOIN public.households h ON ((h.id = g.household_id)))
     CROSS JOIN public.event_sessions s)
     LEFT JOIN public.household_session_defaults d ON (((d.household_id = g.household_id) AND (d.session_id = s.id))))
     LEFT JOIN public.guest_session_overrides o ON (((o.guest_id = g.id) AND (o.session_id = s.id))))
  WHERE ((g.archived_at IS NULL) AND (h.archived_at IS NULL) AND s.is_active AND COALESCE(o.is_invited, d.is_invited, false));


--
-- Name: event_configuration_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.event_configuration_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.event_configuration_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: event_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text,
    map_url text,
    notes text,
    sort_order integer DEFAULT 0 NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    country_code text,
    archived_at timestamp with time zone,
    welcome_en text,
    CONSTRAINT event_locations_country_code_check CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT event_locations_welcome_en_check CHECK ((length(welcome_en) <= 4000))
);


--
-- Name: event_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_settings (
    id integer DEFAULT 1 NOT NULL,
    event_name text NOT NULL,
    event_type text DEFAULT 'other'::text NOT NULL,
    default_language text NOT NULL,
    timezone text DEFAULT 'Atlantic/Faroe'::text NOT NULL,
    website_url text,
    rsvp_deadline timestamp with time zone,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    event_date date,
    fallback_language text DEFAULT 'en'::text NOT NULL,
    introduction text DEFAULT ''::text NOT NULL,
    invitation_message text DEFAULT ''::text NOT NULL,
    planning_config jsonb DEFAULT '{"groups": [{"id": "general", "names": {"de": "Allgemein", "en": "General", "fo": "Alment"}}], "labels": {"guests": {}, "households": {}}}'::jsonb NOT NULL,
    food_stage text DEFAULT 'interest'::text NOT NULL,
    food_enabled boolean DEFAULT true NOT NULL,
    other_enabled boolean DEFAULT true NOT NULL,
    food_introduction jsonb DEFAULT '{}'::jsonb NOT NULL,
    guest_background jsonb,
    guest_theme_toggle boolean DEFAULT true NOT NULL,
    guest_theme_default text DEFAULT 'dark'::text NOT NULL,
    guest_design jsonb,
    notification_preferences jsonb,
    CONSTRAINT event_planning_configuration_check CHECK (app_private.valid_planning_configuration(planning_config)),
    CONSTRAINT event_settings_food_introduction_check CHECK ((jsonb_typeof(food_introduction) = 'object'::text)),
    CONSTRAINT event_settings_food_stage_check CHECK ((food_stage = ANY (ARRAY['interest'::text, 'selection'::text]))),
    CONSTRAINT event_settings_guest_background_check CHECK (((guest_background IS NULL) OR ((jsonb_typeof(guest_background) = 'object'::text) AND (jsonb_typeof((guest_background -> 'image'::text)) = 'string'::text) AND (length((guest_background ->> 'image'::text)) <= 2000000) AND ((guest_background ->> 'image'::text) ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'::text)))),
    CONSTRAINT event_settings_guest_design_check CHECK (app_private.valid_guest_design(guest_design)),
    CONSTRAINT event_settings_guest_theme_default_check CHECK ((guest_theme_default = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text]))),
    CONSTRAINT event_settings_id_check CHECK ((id = 1)),
    CONSTRAINT event_settings_notification_preferences_check CHECK (app_private.valid_notification_preferences(notification_preferences))
);


--
-- Name: event_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_translations (
    event_id integer NOT NULL,
    language_code text NOT NULL,
    introduction text,
    invitation_message text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT event_translations_introduction_check CHECK ((length(introduction) <= 12000)),
    CONSTRAINT event_translations_invitation_message_check CHECK ((length(invitation_message) <= 12000)),
    CONSTRAINT event_translations_language_code_check CHECK ((language_code <> 'en'::text))
);


--
-- Name: food_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_id uuid,
    CONSTRAINT food_category_no_self_parent CHECK ((parent_id IS DISTINCT FROM id))
);


--
-- Name: food_category_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_category_translations (
    food_category_id uuid NOT NULL,
    language_code text NOT NULL,
    name text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT food_category_translations_language_code_check CHECK ((language_code <> 'en'::text)),
    CONSTRAINT food_category_translations_name_check CHECK ((length(name) <= 12000))
);


--
-- Name: food_item_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_item_translations (
    food_item_id uuid NOT NULL,
    language_code text NOT NULL,
    name text,
    user_comment text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT food_item_translations_language_code_check CHECK ((language_code <> 'en'::text)),
    CONSTRAINT food_item_translations_name_check CHECK ((length(name) <= 12000)),
    CONSTRAINT food_item_translations_user_comment_check CHECK ((length(user_comment) <= 12000))
);


--
-- Name: food_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text,
    name_en text NOT NULL,
    description_en text,
    quantity_needed integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_comment text,
    recipe_text text,
    quantity_type text DEFAULT 'Piece(s)'::text NOT NULL,
    venue_ids uuid[],
    food_group_id uuid,
    archived_at timestamp with time zone,
    CONSTRAINT food_items_admin_comment_check CHECK ((length(admin_comment) <= 4000)),
    CONSTRAINT food_items_quantity_needed_check CHECK ((quantity_needed >= 0)),
    CONSTRAINT food_items_quantity_type_check CHECK (((quantity_type = btrim(quantity_type)) AND ((length(quantity_type) >= 1) AND (length(quantity_type) <= 60)))),
    CONSTRAINT food_items_recipe_text_check CHECK ((length(recipe_text) <= 12000)),
    CONSTRAINT food_items_source_name_nonempty CHECK ((btrim(name_en) <> ''::text))
);


--
-- Name: food_type_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_type_translations (
    food_type_name text NOT NULL,
    language_code text NOT NULL,
    name text,
    plural_name text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT food_type_translations_language_code_check CHECK ((language_code <> 'en'::text)),
    CONSTRAINT food_type_translations_name_check CHECK ((length(name) <= 12000)),
    CONSTRAINT food_type_translations_plural_name_check CHECK ((length(plural_name) <= 12000))
);


--
-- Name: session_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_translations (
    session_id uuid NOT NULL,
    language_code text NOT NULL,
    name text,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT session_translations_description_check CHECK ((length(description) <= 12000)),
    CONSTRAINT session_translations_language_code_check CHECK ((language_code <> 'en'::text)),
    CONSTRAINT session_translations_name_check CHECK ((length(name) <= 12000))
);


--
-- Name: translation_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.translation_overrides (
    translation_key text NOT NULL,
    category text NOT NULL,
    source_text text NOT NULL,
    language_code text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT translation_overrides_category_check CHECK ((category = ANY (ARRAY['interface'::text, 'food'::text, 'types'::text]))),
    CONSTRAINT translation_overrides_source_text_check CHECK ((length(source_text) <= 800)),
    CONSTRAINT translation_overrides_translation_key_check CHECK ((length(translation_key) <= 800)),
    CONSTRAINT translation_overrides_value_check CHECK ((length(value) <= 12000))
);


--
-- Name: venue_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_translations (
    venue_id uuid NOT NULL,
    language_code text NOT NULL,
    name text,
    welcome_message text,
    guest_notes text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT venue_translations_guest_notes_check CHECK ((length(guest_notes) <= 12000)),
    CONSTRAINT venue_translations_language_code_check CHECK ((language_code <> 'en'::text)),
    CONSTRAINT venue_translations_name_check CHECK ((length(name) <= 12000)),
    CONSTRAINT venue_translations_welcome_message_check CHECK ((length(welcome_message) <= 12000))
);


--
-- Name: event_content; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.event_content WITH (security_invoker='true') AS
 SELECT ('ui:'::text || translation_overrides.source_text) AS content_key,
    translation_overrides.language_code,
    translation_overrides.value AS content_value
   FROM public.translation_overrides
UNION ALL
 SELECT ('ui:Food type: '::text || food_type_translations.food_type_name) AS content_key,
    food_type_translations.language_code,
    food_type_translations.name AS content_value
   FROM public.food_type_translations
  WHERE (food_type_translations.name IS NOT NULL)
UNION ALL
 SELECT 'welcome'::text AS content_key,
    event_translations.language_code,
    event_translations.introduction AS content_value
   FROM public.event_translations
  WHERE (event_translations.introduction IS NOT NULL)
UNION ALL
 SELECT 'welcome'::text AS content_key,
    'en'::text AS language_code,
    event_settings.introduction AS content_value
   FROM public.event_settings
  WHERE (event_settings.introduction <> ''::text)
UNION ALL
 SELECT 'invite'::text AS content_key,
    event_translations.language_code,
    event_translations.invitation_message AS content_value
   FROM public.event_translations
  WHERE (event_translations.invitation_message IS NOT NULL)
UNION ALL
 SELECT 'invite'::text AS content_key,
    'en'::text AS language_code,
    event_settings.invitation_message AS content_value
   FROM public.event_settings
  WHERE (event_settings.invitation_message <> ''::text)
UNION ALL
 SELECT (('food:'::text || food_item_translations.food_item_id) || ':name'::text) AS content_key,
    food_item_translations.language_code,
    food_item_translations.name AS content_value
   FROM public.food_item_translations
  WHERE (food_item_translations.name IS NOT NULL)
UNION ALL
 SELECT (('food:'::text || food_item_translations.food_item_id) || ':description'::text) AS content_key,
    food_item_translations.language_code,
    food_item_translations.user_comment AS content_value
   FROM public.food_item_translations
  WHERE (food_item_translations.user_comment IS NOT NULL)
UNION ALL
 SELECT (('food-category:'::text || food_category_translations.food_category_id) || ':name'::text) AS content_key,
    food_category_translations.language_code,
    food_category_translations.name AS content_value
   FROM public.food_category_translations
  WHERE (food_category_translations.name IS NOT NULL)
UNION ALL
 SELECT (('venue:'::text || venue_translations.venue_id) || ':name'::text) AS content_key,
    venue_translations.language_code,
    venue_translations.name AS content_value
   FROM public.venue_translations
  WHERE (venue_translations.name IS NOT NULL)
UNION ALL
 SELECT (('venue:'::text || venue_translations.venue_id) || ':welcome'::text) AS content_key,
    venue_translations.language_code,
    venue_translations.welcome_message AS content_value
   FROM public.venue_translations
  WHERE (venue_translations.welcome_message IS NOT NULL)
UNION ALL
 SELECT (('venue:'::text || venue_translations.venue_id) || ':notes'::text) AS content_key,
    venue_translations.language_code,
    venue_translations.guest_notes AS content_value
   FROM public.venue_translations
  WHERE (venue_translations.guest_notes IS NOT NULL)
UNION ALL
 SELECT (('session:'::text || session_translations.session_id) || ':name'::text) AS content_key,
    session_translations.language_code,
    session_translations.name AS content_value
   FROM public.session_translations
  WHERE (session_translations.name IS NOT NULL)
UNION ALL
 SELECT (('session:'::text || session_translations.session_id) || ':description'::text) AS content_key,
    session_translations.language_code,
    session_translations.description AS content_value
   FROM public.session_translations
  WHERE (session_translations.description IS NOT NULL)
UNION ALL
 SELECT (('food:'::text || food_items.id) || ':name'::text) AS content_key,
    'en'::text AS language_code,
    food_items.name_en AS content_value
   FROM public.food_items
  WHERE (food_items.name_en IS NOT NULL)
UNION ALL
 SELECT (('food:'::text || food_items.id) || ':description'::text) AS content_key,
    'en'::text AS language_code,
    food_items.description_en AS content_value
   FROM public.food_items
  WHERE (food_items.description_en IS NOT NULL)
UNION ALL
 SELECT (('food-category:'::text || food_categories.id) || ':name'::text) AS content_key,
    'en'::text AS language_code,
    food_categories.name AS content_value
   FROM public.food_categories
UNION ALL
 SELECT (('venue:'::text || event_locations.id) || ':name'::text) AS content_key,
    'en'::text AS language_code,
    event_locations.name AS content_value
   FROM public.event_locations
UNION ALL
 SELECT (('venue:'::text || event_locations.id) || ':welcome'::text) AS content_key,
    'en'::text AS language_code,
    event_locations.welcome_en AS content_value
   FROM public.event_locations
  WHERE (event_locations.welcome_en IS NOT NULL)
UNION ALL
 SELECT (('venue:'::text || event_locations.id) || ':notes'::text) AS content_key,
    'en'::text AS language_code,
    event_locations.notes AS content_value
   FROM public.event_locations
  WHERE (event_locations.notes IS NOT NULL)
UNION ALL
 SELECT (('session:'::text || event_sessions.id) || ':name'::text) AS content_key,
    'en'::text AS language_code,
    event_sessions.name AS content_value
   FROM public.event_sessions
UNION ALL
 SELECT (('session:'::text || event_sessions.id) || ':description'::text) AS content_key,
    'en'::text AS language_code,
    event_sessions.description AS content_value
   FROM public.event_sessions;


--
-- Name: event_languages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_languages (
    language_code text NOT NULL,
    display_name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT event_language_code_format CHECK ((language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'::text)),
    CONSTRAINT event_languages_language_code_check CHECK (((length(language_code) >= 2) AND (length(language_code) <= 16)))
);


--
-- Name: food_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    food_item_id uuid NOT NULL,
    household_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT food_claims_quantity_check CHECK ((quantity > 0))
);


--
-- Name: food_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    translations jsonb DEFAULT '{}'::jsonb NOT NULL,
    category text,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT food_groups_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120))),
    CONSTRAINT food_groups_translations_check CHECK ((jsonb_typeof(translations) = 'object'::text))
);


--
-- Name: food_item_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_item_types (
    name text NOT NULL,
    CONSTRAINT food_item_types_name_check CHECK (((name = btrim(name)) AND ((length(name) >= 1) AND (length(name) <= 60))))
);


--
-- Name: guest_gateway_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_gateway_rate_limits (
    key_hash text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    request_count integer DEFAULT 1 NOT NULL,
    CONSTRAINT guest_gateway_rate_limits_request_count_check CHECK ((request_count >= 0))
);


--
-- Name: guest_session_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_session_responses (
    guest_id uuid NOT NULL,
    session_id uuid NOT NULL,
    rsvp_status text NOT NULL,
    last_submission_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guest_session_responses_rsvp_status_check CHECK ((rsvp_status = ANY (ARRAY['attending'::text, 'declined'::text])))
);


--
-- Name: household_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.household_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    contact_name text,
    contact_type text NOT NULL,
    contact_value text NOT NULL,
    language_code text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    preferred_method text,
    guest_id uuid,
    is_household_primary boolean,
    CONSTRAINT active_household_primary_contact CHECK (((is_household_primary IS NOT TRUE) OR (archived_at IS NULL))),
    CONSTRAINT household_contacts_contact_type_check CHECK ((contact_type = ANY (ARRAY['email'::text, 'phone'::text, 'postal'::text, 'other'::text]))),
    CONSTRAINT household_contacts_contact_value_check CHECK ((length(btrim(contact_value)) > 0)),
    CONSTRAINT household_contacts_preferred_method_check CHECK ((preferred_method = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'postal'::text, 'manual'::text])))
);


--
-- Name: invitation_access_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.invitation_access_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.invitation_access_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: invitation_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    queue_id uuid NOT NULL,
    confirmed_by uuid NOT NULL,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    recipient_snapshot jsonb NOT NULL,
    message_snapshot jsonb NOT NULL,
    delivery_note text
);


--
-- Name: invitation_delivery_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.invitation_delivery_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.invitation_delivery_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: management_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.management_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.management_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_key text NOT NULL,
    language_code text NOT NULL,
    channel text NOT NULL,
    subject text,
    body text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT message_templates_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'postal'::text, 'manual'::text])))
);


--
-- Name: other_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.other_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT other_categories_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)))
);


--
-- Name: other_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.other_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item text NOT NULL,
    assigned_to text,
    status text DEFAULT 'open'::text NOT NULL,
    notes text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category_id uuid NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT other_status CHECK ((status = ANY (ARRAY['open'::text, 'assigned'::text, 'in_progress'::text, 'done'::text])))
);


--
-- Name: relation_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relation_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    planning_group_id text,
    CONSTRAINT relation_groups_planning_group_id_check CHECK ((planning_group_id ~ '^[a-z][a-z0-9_]{0,63}$'::text))
);


--
-- Name: rsvp_household_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.rsvp_household_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rsvp_household_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rsvp_response_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.rsvp_response_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rsvp_response_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rsvp_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rsvp_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    household_id uuid NOT NULL,
    submission_number integer NOT NULL,
    request_id uuid NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    submission_snapshot jsonb NOT NULL,
    source text DEFAULT 'guest'::text NOT NULL,
    comment text,
    CONSTRAINT rsvp_submissions_comment_check CHECK (((comment IS NULL) OR (length(comment) <= 2000))),
    CONSTRAINT rsvp_submissions_source_check CHECK ((source = ANY (ARRAY['guest'::text, 'admin'::text]))),
    CONSTRAINT rsvp_submissions_submission_number_check CHECK ((submission_number > 0))
);


--
-- Name: FUNCTION append_guest_order(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.append_guest_order() FROM PUBLIC;


--
-- Name: FUNCTION audit_event_configuration(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.audit_event_configuration() FROM PUBLIC;


--
-- Name: FUNCTION audit_management(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.audit_management() FROM PUBLIC;


--
-- Name: FUNCTION backup_as_template(b jsonb, sections text[]); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.backup_as_template(b jsonb, sections text[]) FROM PUBLIC;


--
-- Name: FUNCTION backup_columns(t text); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.backup_columns(t text) FROM PUBLIC;


--
-- Name: FUNCTION backup_payload(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.backup_payload() FROM PUBLIC;


--
-- Name: FUNCTION backup_selected_tables(selection jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.backup_selected_tables(selection jsonb) FROM PUBLIC;


--
-- Name: FUNCTION backup_selection(mode text, sections text[], include_logs boolean); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.backup_selection(mode text, sections text[], include_logs boolean) FROM PUBLIC;


--
-- Name: FUNCTION backup_tables(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC;


--
-- Name: FUNCTION check_primary_guest(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.check_primary_guest() FROM PUBLIC;


--
-- Name: FUNCTION clear_archived_household_primary_contact(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.clear_archived_household_primary_contact() FROM PUBLIC;


--
-- Name: FUNCTION clear_archived_household_primary_guests(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.clear_archived_household_primary_guests() FROM PUBLIC;


--
-- Name: FUNCTION clear_ineligible_primary_guest(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.clear_ineligible_primary_guest() FROM PUBLIC;


--
-- Name: FUNCTION food_venue_eligible(p_household uuid, p_venues uuid[]); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.food_venue_eligible(p_household uuid, p_venues uuid[]) FROM PUBLIC;


--
-- Name: FUNCTION guard_empty_invitation_code(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_empty_invitation_code() FROM PUBLIC;


--
-- Name: FUNCTION guard_food_capacity(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_food_capacity() FROM PUBLIC;


--
-- Name: FUNCTION guard_food_category_tree(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_food_category_tree() FROM PUBLIC;


--
-- Name: FUNCTION guard_food_group_change(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_food_group_change() FROM PUBLIC;


--
-- Name: FUNCTION guard_guest_customization(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_guest_customization() FROM PUBLIC;


--
-- Name: FUNCTION guard_household_planning_group(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_household_planning_group() FROM PUBLIC;


--
-- Name: FUNCTION guard_item_archive_column(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_item_archive_column() FROM PUBLIC;


--
-- Name: FUNCTION guard_language_preferences(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_language_preferences() FROM PUBLIC;


--
-- Name: FUNCTION guard_language_removal(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_language_removal() FROM PUBLIC;


--
-- Name: FUNCTION guard_management_parent(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_management_parent() FROM PUBLIC;


--
-- Name: FUNCTION guard_notification_preferences(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_notification_preferences() FROM PUBLIC;


--
-- Name: FUNCTION guard_planning_group_removal(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_planning_group_removal() FROM PUBLIC;


--
-- Name: FUNCTION guard_profile_language(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_profile_language() FROM PUBLIC;


--
-- Name: FUNCTION guard_relation_group_scope(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guard_relation_group_scope() FROM PUBLIC;


--
-- Name: FUNCTION guest_customization_revision(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guest_customization_revision() FROM PUBLIC;


--
-- Name: FUNCTION guest_event(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guest_event() FROM PUBLIC;


--
-- Name: FUNCTION guest_event_for_household(p_household uuid); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guest_event_for_household(p_household uuid) FROM PUBLIC;


--
-- Name: FUNCTION guest_food(v_household uuid, p_sample boolean); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guest_food(v_household uuid, p_sample boolean) FROM PUBLIC;


--
-- Name: FUNCTION guest_food_base(v_household uuid, p_sample boolean); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guest_food_base(v_household uuid, p_sample boolean) FROM PUBLIC;


--
-- Name: TABLE households; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.households TO authenticated;


--
-- Name: FUNCTION guest_invitation(h public.households); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.guest_invitation(h public.households) FROM PUBLIC;


--
-- Name: FUNCTION issue_codes_on_publication(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.issue_codes_on_publication() FROM PUBLIC;


--
-- Name: FUNCTION item_dependencies(p_entity text, p_id uuid); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.item_dependencies(p_entity text, p_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION lock_food_category_tree(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.lock_food_category_tree() FROM PUBLIC;


--
-- Name: FUNCTION lock_publication(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.lock_publication() FROM PUBLIC;


--
-- Name: FUNCTION permission_preset(p text); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.permission_preset(p text) FROM PUBLIC;


--
-- Name: FUNCTION project_backup(b jsonb, mode text, sections text[], include_logs boolean); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.project_backup(b jsonb, mode text, sections text[], include_logs boolean) FROM PUBLIC;


--
-- Name: FUNCTION require_admin_operation(op text); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.require_admin_operation(op text) FROM PUBLIC;


--
-- Name: FUNCTION require_food_selection_stage(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.require_food_selection_stage() FROM PUBLIC;


--
-- Name: FUNCTION require_live_session(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.require_live_session() FROM PUBLIC;


--
-- Name: FUNCTION require_permission(p_section text, p_level text); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.require_permission(p_section text, p_level text) FROM PUBLIC;


--
-- Name: FUNCTION reset_invitation_access(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.reset_invitation_access() FROM PUBLIC;


--
-- Name: FUNCTION restore_backup(b jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.restore_backup(b jsonb) FROM PUBLIC;


--
-- Name: FUNCTION save_food_selection(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_notes text, p_expected_quantity integer); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.save_food_selection(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_notes text, p_expected_quantity integer) FROM PUBLIC;


--
-- Name: FUNCTION save_food_selection_base(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_notes text, p_expected_quantity integer); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.save_food_selection_base(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_notes text, p_expected_quantity integer) FROM PUBLIC;


--
-- Name: FUNCTION seal_backup(payload jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.seal_backup(payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION select_backup(b jsonb, mode text, sections text[], include_logs boolean); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.select_backup(b jsonb, mode text, sections text[], include_logs boolean) FROM PUBLIC;


--
-- Name: FUNCTION session_is_live(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.session_is_live() FROM PUBLIC;


--
-- Name: FUNCTION store_translation(p_key text, p_language text, p_value text); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.store_translation(p_key text, p_language text, p_value text) FROM PUBLIC;


--
-- Name: FUNCTION sync_archived_invitation_code(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.sync_archived_invitation_code() FROM PUBLIC;


--
-- Name: FUNCTION sync_guest_invitation_codes(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.sync_guest_invitation_codes() FROM PUBLIC;


--
-- Name: FUNCTION sync_invitation_code(p_household_id uuid); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.sync_invitation_code(p_household_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION table_section(t text); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.table_section(t text) FROM PUBLIC;


--
-- Name: FUNCTION translation_keys(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC;


--
-- Name: FUNCTION valid_guest_design(design jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.valid_guest_design(design jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.valid_guest_design(design jsonb) TO authenticated;


--
-- Name: FUNCTION valid_notification_preferences(p jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.valid_notification_preferences(p jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.valid_notification_preferences(p jsonb) TO authenticated;


--
-- Name: FUNCTION valid_permissions(p jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.valid_permissions(p jsonb) FROM PUBLIC;


--
-- Name: FUNCTION valid_primary_contact_delivery(p_type text, p_method text, p_value text); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.valid_primary_contact_delivery(p_type text, p_method text, p_value text) FROM PUBLIC;


--
-- Name: FUNCTION validate_backup(b jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.validate_backup(b jsonb) FROM PUBLIC;


--
-- Name: FUNCTION validate_backup_selection(payload jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.validate_backup_selection(payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION validate_food_category_tree(p_categories jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.validate_food_category_tree(p_categories jsonb) FROM PUBLIC;


--
-- Name: FUNCTION validate_food_item_settings(); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.validate_food_item_settings() FROM PUBLIC;


--
-- Name: FUNCTION validate_private_jpeg(background jsonb); Type: ACL; Schema: app_private; Owner: -
--

REVOKE ALL ON FUNCTION app_private.validate_private_jpeg(background jsonb) FROM PUBLIC;


--
-- Name: FUNCTION add_household_guest(p_code text, p_guest_id uuid, p_first_name text, p_last_name text, p_is_child boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_household_guest(p_code text, p_guest_id uuid, p_first_name text, p_last_name text, p_is_child boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_household_guest(p_code text, p_guest_id uuid, p_first_name text, p_last_name text, p_is_child boolean) TO service_role;


--
-- Name: FUNCTION admin_accept_invitation(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_accept_invitation(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_accept_invitation(p_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_add_existing_user(p_email text, p_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_add_existing_user(p_email text, p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_add_existing_user(p_email text, p_name text) TO authenticated;


--
-- Name: FUNCTION admin_add_venue_food(p_venue_id uuid, p_food_item_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_add_venue_food(p_venue_id uuid, p_food_item_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_add_venue_food(p_venue_id uuid, p_food_item_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION admin_authorize_device_send(p_queue_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_authorize_device_send(p_queue_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_authorize_device_send(p_queue_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_authorize_late_rsvp(p_household_id uuid, p_until timestamp with time zone, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_authorize_late_rsvp(p_household_id uuid, p_until timestamp with time zone, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_authorize_late_rsvp(p_household_id uuid, p_until timestamp with time zone, p_reason text) TO authenticated;


--
-- Name: FUNCTION admin_cancel_invitation(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_cancel_invitation(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_cancel_invitation(p_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_confirm_invitation_sent(p_queue_id uuid, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_confirm_invitation_sent(p_queue_id uuid, p_note text) FROM PUBLIC;


--
-- Name: FUNCTION admin_correct_rsvp(p_guest_id uuid, p_session_id uuid, p_status text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_correct_rsvp(p_guest_id uuid, p_session_id uuid, p_status text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_correct_rsvp(p_guest_id uuid, p_session_id uuid, p_status text, p_reason text) TO authenticated;


--
-- Name: FUNCTION admin_create_guest(p_household_id uuid, p_values jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_create_guest(p_household_id uuid, p_values jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_create_guest(p_household_id uuid, p_values jsonb) TO authenticated;


--
-- Name: FUNCTION admin_delete_archived_record(p_entity text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_delete_archived_record(p_entity text, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_archived_record(p_entity text, p_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_delete_food_category(p_category_id uuid, p_expected_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_delete_food_category(p_category_id uuid, p_expected_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_food_category(p_category_id uuid, p_expected_name text) TO authenticated;


--
-- Name: FUNCTION admin_delete_food_group(p_id uuid, p_expected_updated timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_delete_food_group(p_id uuid, p_expected_updated timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_food_group(p_id uuid, p_expected_updated timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION admin_delete_other_category(p_category_id uuid, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_delete_other_category(p_category_id uuid, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_other_category(p_category_id uuid, p_expected_updated_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION admin_edit_session_households(p_session_id uuid, p_add uuid[], p_remove uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_edit_session_households(p_session_id uuid, p_add uuid[], p_remove uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_edit_session_households(p_session_id uuid, p_add uuid[], p_remove uuid[]) TO authenticated;


--
-- Name: FUNCTION admin_edit_venue_food(p_venue_id uuid, p_add uuid[], p_remove uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_edit_venue_food(p_venue_id uuid, p_add uuid[], p_remove uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_edit_venue_food(p_venue_id uuid, p_add uuid[], p_remove uuid[]) TO authenticated;


--
-- Name: FUNCTION admin_export_backup(p_mode text, p_sections text[], p_include_logs boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_export_backup(p_mode text, p_sections text[], p_include_logs boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_export_backup(p_mode text, p_sections text[], p_include_logs boolean) TO authenticated;


--
-- Name: FUNCTION admin_finish_invitation(p_id uuid, p_attempt_id uuid, p_sent boolean, p_error_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_finish_invitation(p_id uuid, p_attempt_id uuid, p_sent boolean, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_finish_invitation(p_id uuid, p_attempt_id uuid, p_sent boolean, p_error_code text) TO service_role;


--
-- Name: FUNCTION admin_get_access(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_access() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_access() TO authenticated;


--
-- Name: FUNCTION admin_guest_preview(p_household_id uuid, p_sample boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_guest_preview(p_household_id uuid, p_sample boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_guest_preview(p_household_id uuid, p_sample boolean) TO authenticated;


--
-- Name: FUNCTION admin_has_permission(p_section text, p_level text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_has_permission(p_section text, p_level text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_has_permission(p_section text, p_level text) TO authenticated;


--
-- Name: FUNCTION admin_item_lifecycle(p_entity text, p_id uuid, p_action text, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_item_lifecycle(p_entity text, p_id uuid, p_action text, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_item_lifecycle(p_entity text, p_id uuid, p_action text, p_expected_updated_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION admin_list_invitations(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_invitations() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_invitations() TO authenticated;


--
-- Name: FUNCTION admin_list_members(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_members() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_members() TO authenticated;


--
-- Name: FUNCTION admin_list_sessions(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_sessions() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_sessions() TO authenticated;


--
-- Name: FUNCTION admin_load_data(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_load_data() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_load_data() TO authenticated;


--
-- Name: FUNCTION admin_lookup_verified_user(p_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_lookup_verified_user(p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_lookup_verified_user(p_email text) TO authenticated;


--
-- Name: FUNCTION admin_manage_relation_group(p_action text, p_id uuid, p_name text, p_planning_group_id text, p_direction integer, p_expected jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_manage_relation_group(p_action text, p_id uuid, p_name text, p_planning_group_id text, p_direction integer, p_expected jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_manage_relation_group(p_action text, p_id uuid, p_name text, p_planning_group_id text, p_direction integer, p_expected jsonb) TO authenticated;


--
-- Name: FUNCTION admin_move_food_category(p_category_id uuid, p_direction integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_food_category(p_category_id uuid, p_direction integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_food_category(p_category_id uuid, p_direction integer) TO authenticated;


--
-- Name: FUNCTION admin_move_food_item(p_food_item_id uuid, p_direction integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_food_item(p_food_item_id uuid, p_direction integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_food_item(p_food_item_id uuid, p_direction integer) TO authenticated;


--
-- Name: FUNCTION admin_move_guest(p_guest_id uuid, p_household_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_guest(p_guest_id uuid, p_household_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_guest(p_guest_id uuid, p_household_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_move_household(p_household_id uuid, p_direction integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_household(p_household_id uuid, p_direction integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_household(p_household_id uuid, p_direction integer) TO authenticated;


--
-- Name: FUNCTION admin_move_language(p_code text, p_direction integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_language(p_code text, p_direction integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_language(p_code text, p_direction integer) TO authenticated;


--
-- Name: FUNCTION admin_move_other_category(p_category_id uuid, p_direction integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_other_category(p_category_id uuid, p_direction integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_other_category(p_category_id uuid, p_direction integer) TO authenticated;


--
-- Name: FUNCTION admin_move_session(p_session_id uuid, p_direction integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_session(p_session_id uuid, p_direction integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_session(p_session_id uuid, p_direction integer) TO authenticated;


--
-- Name: FUNCTION admin_move_venue(p_venue_id uuid, p_direction integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_venue(p_venue_id uuid, p_direction integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_venue(p_venue_id uuid, p_direction integer) TO authenticated;


--
-- Name: FUNCTION admin_my_invitation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_my_invitation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_my_invitation() TO authenticated;


--
-- Name: FUNCTION admin_order_guest(p_guest_id uuid, p_direction integer, p_expected_order uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_order_guest(p_guest_id uuid, p_direction integer, p_expected_order uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_order_guest(p_guest_id uuid, p_direction integer, p_expected_order uuid[]) TO authenticated;


--
-- Name: FUNCTION admin_prepare_invitation(p_email text, p_name text, p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_prepare_invitation(p_email text, p_name text, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_prepare_invitation(p_email text, p_name text, p_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_preview_backup(p_backup jsonb, p_mode text, p_sections text[], p_include_logs boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_preview_backup(p_backup jsonb, p_mode text, p_sections text[], p_include_logs boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_preview_backup(p_backup jsonb, p_mode text, p_sections text[], p_include_logs boolean) TO authenticated;


--
-- Name: FUNCTION admin_query_logs(p_search text, p_category text, p_action text, p_from timestamp with time zone, p_to timestamp with time zone, p_before_at timestamp with time zone, p_before_key text, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_query_logs(p_search text, p_category text, p_action text, p_from timestamp with time zone, p_to timestamp with time zone, p_before_at timestamp with time zone, p_before_key text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_query_logs(p_search text, p_category text, p_action text, p_from timestamp with time zone, p_to timestamp with time zone, p_before_at timestamp with time zone, p_before_key text, p_limit integer) TO authenticated;


--
-- Name: FUNCTION admin_record_delivery_sent(p_queue_id uuid, p_expected_revision integer, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_record_delivery_sent(p_queue_id uuid, p_expected_revision integer, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_record_delivery_sent(p_queue_id uuid, p_expected_revision integer, p_note text) TO authenticated;


--
-- Name: FUNCTION admin_record_session(p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_record_session(p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_record_session(p_action text) TO authenticated;


--
-- Name: FUNCTION admin_record_share_handoff(p_queue_id uuid, p_expected_revision integer, p_handoff_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_record_share_handoff(p_queue_id uuid, p_expected_revision integer, p_handoff_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_record_share_handoff(p_queue_id uuid, p_expected_revision integer, p_handoff_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_remove_member(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_remove_member(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_remove_member(p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_rename_food_category(p_category_id uuid, p_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_rename_food_category(p_category_id uuid, p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_rename_food_category(p_category_id uuid, p_name text) TO authenticated;


--
-- Name: FUNCTION admin_rename_member(p_user_id uuid, p_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_rename_member(p_user_id uuid, p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_rename_member(p_user_id uuid, p_name text) TO authenticated;


--
-- Name: FUNCTION admin_reopen_household_rsvp(p_household_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reopen_household_rsvp(p_household_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reopen_household_rsvp(p_household_id uuid, p_reason text) TO authenticated;


--
-- Name: FUNCTION admin_restore_backup(p_backup jsonb, p_confirmation text, p_mode text, p_sections text[], p_include_logs boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_restore_backup(p_backup jsonb, p_confirmation text, p_mode text, p_sections text[], p_include_logs boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_restore_backup(p_backup jsonb, p_confirmation text, p_mode text, p_sections text[], p_include_logs boolean) TO authenticated;


--
-- Name: FUNCTION admin_revoke_other_sessions(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_revoke_other_sessions() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_revoke_other_sessions() TO authenticated;


--
-- Name: FUNCTION admin_revoke_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_revoke_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_revoke_session(p_session_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_save_access(p_user_id uuid, p_permissions jsonb, p_expected jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_access(p_user_id uuid, p_permissions jsonb, p_expected jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_access(p_user_id uuid, p_permissions jsonb, p_expected jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_contact(p_id uuid, p_household_id uuid, p_values jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_contact(p_id uuid, p_household_id uuid, p_values jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_contact(p_id uuid, p_household_id uuid, p_values jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_delivery(p_id uuid, p_household_id uuid, p_values jsonb, p_expected_revision integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_delivery(p_id uuid, p_household_id uuid, p_values jsonb, p_expected_revision integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_delivery(p_id uuid, p_household_id uuid, p_values jsonb, p_expected_revision integer) TO authenticated;


--
-- Name: FUNCTION admin_save_features(p_food boolean, p_other boolean, p_stage text, p_introduction jsonb, p_expected jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_features(p_food boolean, p_other boolean, p_stage text, p_introduction jsonb, p_expected jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_features(p_food boolean, p_other boolean, p_stage text, p_introduction jsonb, p_expected jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_food_category(p_category_id uuid, p_name text, p_parent_id uuid, p_expected_name text, p_expected_parent uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_food_category(p_category_id uuid, p_name text, p_parent_id uuid, p_expected_name text, p_expected_parent uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_food_category(p_category_id uuid, p_name text, p_parent_id uuid, p_expected_name text, p_expected_parent uuid) TO authenticated;


--
-- Name: FUNCTION admin_save_food_group(p_id uuid, p_name text, p_translations jsonb, p_category text, p_item_ids uuid[], p_expected_updated timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_food_group(p_id uuid, p_name text, p_translations jsonb, p_category text, p_item_ids uuid[], p_expected_updated timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_food_group(p_id uuid, p_name text, p_translations jsonb, p_category text, p_item_ids uuid[], p_expected_updated timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION admin_save_food_translations(p_food_item_id uuid, p_changes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_food_translations(p_food_item_id uuid, p_changes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_food_translations(p_food_item_id uuid, p_changes jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_guest_appearance(p_show_toggle boolean, p_default_theme text, p_expected jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_guest_appearance(p_show_toggle boolean, p_default_theme text, p_expected jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_guest_appearance(p_show_toggle boolean, p_default_theme text, p_expected jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_guest_customization(p_design jsonb, p_background_mode text, p_background jsonb, p_show_toggle boolean, p_default_theme text, p_expected_revision text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_guest_customization(p_design jsonb, p_background_mode text, p_background jsonb, p_show_toggle boolean, p_default_theme text, p_expected_revision text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_guest_customization(p_design jsonb, p_background_mode text, p_background jsonb, p_show_toggle boolean, p_default_theme text, p_expected_revision text) TO authenticated;


--
-- Name: FUNCTION admin_save_guest_details(p_guest_id uuid, p_household_id uuid, p_values jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_guest_details(p_guest_id uuid, p_household_id uuid, p_values jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_guest_details(p_guest_id uuid, p_household_id uuid, p_values jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_household(p_id uuid, p_values jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_household(p_id uuid, p_values jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_household(p_id uuid, p_values jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_household_with_food(p_id uuid, p_values jsonb, p_food boolean, p_expected_food boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_household_with_food(p_id uuid, p_values jsonb, p_food boolean, p_expected_food boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_household_with_food(p_id uuid, p_values jsonb, p_food boolean, p_expected_food boolean) TO authenticated;


--
-- Name: FUNCTION admin_save_invitation_template(p_language text, p_channel text, p_subject text, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_invitation_template(p_language text, p_channel text, p_subject text, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_invitation_template(p_language text, p_channel text, p_subject text, p_body text) TO authenticated;


--
-- Name: FUNCTION admin_save_language(p_code text, p_name text, p_enabled boolean, p_order integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_language(p_code text, p_name text, p_enabled boolean, p_order integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_language(p_code text, p_name text, p_enabled boolean, p_order integer) TO authenticated;


--
-- Name: FUNCTION admin_save_notification_preferences(p_preferences jsonb, p_expected jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_notification_preferences(p_preferences jsonb, p_expected jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_notification_preferences(p_preferences jsonb, p_expected jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_other(p_id uuid, p_values jsonb, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_other(p_id uuid, p_values jsonb, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_other(p_id uuid, p_values jsonb, p_expected_updated_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION admin_save_other_category(p_id uuid, p_name text, p_expected_updated_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_other_category(p_id uuid, p_name text, p_expected_updated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_other_category(p_id uuid, p_name text, p_expected_updated_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION admin_save_planning_configuration(p_config jsonb, p_expected_config jsonb, p_preset text, p_expected_preset text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_planning_configuration(p_config jsonb, p_expected_config jsonb, p_preset text, p_expected_preset text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_planning_configuration(p_config jsonb, p_expected_config jsonb, p_preset text, p_expected_preset text) TO authenticated;


--
-- Name: FUNCTION admin_save_session(p_id uuid, p_values jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_session(p_id uuid, p_values jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_session(p_id uuid, p_values jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_session_assignments(p_household_id uuid, p_assignments jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_session_assignments(p_household_id uuid, p_assignments jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_session_assignments(p_household_id uuid, p_assignments jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_translation(p_key text, p_language text, p_value text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_translation(p_key text, p_language text, p_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_translation(p_key text, p_language text, p_value text) TO authenticated;


--
-- Name: FUNCTION admin_save_translations(p_changes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_translations(p_changes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_translations(p_changes jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_venue(p_id uuid, p_values jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_venue(p_id uuid, p_values jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_venue(p_id uuid, p_values jsonb) TO authenticated;


--
-- Name: FUNCTION admin_save_venue_with_translations(p_id uuid, p_values jsonb, p_translations jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_venue_with_translations(p_id uuid, p_values jsonb, p_translations jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_venue_with_translations(p_id uuid, p_values jsonb, p_translations jsonb) TO authenticated;


--
-- Name: FUNCTION admin_session_invitation_locks(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_session_invitation_locks() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_session_invitation_locks() TO authenticated;


--
-- Name: FUNCTION admin_set_archived(p_entity text, p_id uuid, p_archived boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_archived(p_entity text, p_id uuid, p_archived boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_archived(p_entity text, p_id uuid, p_archived boolean) TO authenticated;


--
-- Name: FUNCTION admin_set_food_access(p_household_id uuid, p_enabled boolean, p_expected boolean, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_food_access(p_household_id uuid, p_enabled boolean, p_expected boolean, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_food_access(p_household_id uuid, p_enabled boolean, p_expected boolean, p_reason text) TO authenticated;


--
-- Name: FUNCTION admin_set_food_category(p_food_item_id uuid, p_category text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_food_category(p_food_item_id uuid, p_category text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_food_category(p_food_item_id uuid, p_category text) TO authenticated;


--
-- Name: FUNCTION admin_set_food_selection(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_expected_quantity integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_food_selection(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_expected_quantity integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_food_selection(p_household_id uuid, p_food_item_id uuid, p_quantity integer, p_expected_quantity integer) TO authenticated;


--
-- Name: FUNCTION admin_set_food_stage(p_stage text, p_expected_stage text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_food_stage(p_stage text, p_expected_stage text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_food_stage(p_stage text, p_expected_stage text) TO authenticated;


--
-- Name: FUNCTION admin_set_household_parent(p_household_id uuid, p_parent_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_household_parent(p_household_id uuid, p_parent_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_household_parent(p_household_id uuid, p_parent_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_set_household_primary_contact(p_household_id uuid, p_contact_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_household_primary_contact(p_household_id uuid, p_contact_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_household_primary_contact(p_household_id uuid, p_contact_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_set_household_primary_guest(p_household_id uuid, p_guest_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_household_primary_guest(p_household_id uuid, p_guest_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_household_primary_guest(p_household_id uuid, p_guest_id uuid) TO authenticated;


--
-- Name: FUNCTION admin_set_invitation_access(p_id uuid, p_permissions jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_invitation_access(p_id uuid, p_permissions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_invitation_access(p_id uuid, p_permissions jsonb) TO authenticated;


--
-- Name: FUNCTION admin_set_language_preferences(p_default text, p_fallback text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_language_preferences(p_default text, p_fallback text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_language_preferences(p_default text, p_fallback text) TO authenticated;


--
-- Name: FUNCTION admin_set_member_state(p_user_id uuid, p_state text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_member_state(p_user_id uuid, p_state text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_member_state(p_user_id uuid, p_state text) TO authenticated;


--
-- Name: FUNCTION admin_update_guest(p_guest_id uuid, p_first_name text, p_last_name text, p_courtesy_title text, p_relation text, p_language text, p_is_child boolean, p_dietary_requirements text, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_guest(p_guest_id uuid, p_first_name text, p_last_name text, p_courtesy_title text, p_relation text, p_language text, p_is_child boolean, p_dietary_requirements text, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_guest(p_guest_id uuid, p_first_name text, p_last_name text, p_courtesy_title text, p_relation text, p_language text, p_is_child boolean, p_dietary_requirements text, p_notes text) TO authenticated;


--
-- Name: FUNCTION admin_update_member(p_user_id uuid, p_name text, p_permissions jsonb, p_expected jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_member(p_user_id uuid, p_name text, p_permissions jsonb, p_expected jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_member(p_user_id uuid, p_name text, p_permissions jsonb, p_expected jsonb) TO authenticated;


--
-- Name: FUNCTION confirm_household_food(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_household_food(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_household_food(p_code text) TO service_role;


--
-- Name: FUNCTION confirm_household_food(p_code text, p_expected_claims jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_household_food(p_code text, p_expected_claims jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_household_food(p_code text, p_expected_claims jsonb) TO service_role;


--
-- Name: FUNCTION get_household_food(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_household_food(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_household_food(p_code text) TO service_role;


--
-- Name: FUNCTION get_invitation_logged(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_invitation_logged(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_invitation_logged(p_code text) TO service_role;


--
-- Name: FUNCTION get_invitation_v2(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_invitation_v2(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_invitation_v2(p_code text) TO service_role;


--
-- Name: FUNCTION get_language_configuration(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_language_configuration() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_language_configuration() TO anon;
GRANT ALL ON FUNCTION public.get_language_configuration() TO authenticated;


--
-- Name: FUNCTION get_public_event(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_event() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_event() TO anon;
GRANT ALL ON FUNCTION public.get_public_event() TO authenticated;


--
-- Name: FUNCTION get_public_event_v2(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_event_v2() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_event_v2() TO anon;
GRANT ALL ON FUNCTION public.get_public_event_v2() TO authenticated;


--
-- Name: FUNCTION guard_household_parent(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_household_parent() FROM PUBLIC;


--
-- Name: FUNCTION guest_gateway_allow_request(p_ip_hash text, p_code text, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guest_gateway_allow_request(p_ip_hash text, p_code text, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guest_gateway_allow_request(p_ip_hash text, p_code text, p_action text) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;


--
-- Name: FUNCTION prevent_history_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prevent_history_mutation() FROM PUBLIC;


--
-- Name: FUNCTION record_invitation_open(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_invitation_open(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_invitation_open(p_code text) TO service_role;


--
-- Name: FUNCTION set_household_food_claim(p_code text, p_food_item_id uuid, p_quantity integer, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_household_food_claim(p_code text, p_food_item_id uuid, p_quantity integer, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_household_food_claim(p_code text, p_food_item_id uuid, p_quantity integer, p_notes text) TO service_role;


--
-- Name: FUNCTION set_household_food_group(p_code text, p_group_id uuid, p_quantity integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_household_food_group(p_code text, p_group_id uuid, p_quantity integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_household_food_group(p_code text, p_group_id uuid, p_quantity integer) TO service_role;


--
-- Name: FUNCTION set_household_food_interest(p_code text, p_interest boolean, p_expected_interest boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_household_food_interest(p_code text, p_interest boolean, p_expected_interest boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_household_food_interest(p_code text, p_interest boolean, p_expected_interest boolean) TO service_role;


--
-- Name: FUNCTION submit_household_rsvp(p_code text, p_request_id uuid, p_responses jsonb, p_comment text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_household_rsvp(p_code text, p_request_id uuid, p_responses jsonb, p_comment text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_household_rsvp(p_code text, p_request_id uuid, p_responses jsonb, p_comment text) TO service_role;


--
-- Name: TABLE admin_membership_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.admin_membership_audit TO authenticated;


--
-- Name: TABLE event_configuration_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.event_configuration_audit TO authenticated;


--
-- Name: TABLE event_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.event_sessions TO authenticated;


--
-- Name: TABLE guests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.guests TO authenticated;


--
-- Name: TABLE invitation_delivery_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.invitation_delivery_audit TO authenticated;


--
-- Name: TABLE invitation_send_queue; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.invitation_send_queue TO authenticated;


--
-- Name: TABLE management_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.management_audit TO authenticated;


--
-- Name: TABLE rsvp_household_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.rsvp_household_audit TO authenticated;


--
-- Name: TABLE rsvp_response_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.rsvp_response_audit TO authenticated;


--
-- Name: TABLE backup_restore_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.backup_restore_audit TO authenticated;


--
-- Name: TABLE guest_session_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.guest_session_overrides TO authenticated;


--
-- Name: TABLE household_session_defaults; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.household_session_defaults TO authenticated;


--
-- Name: TABLE event_locations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.event_locations TO authenticated;


--
-- Name: TABLE event_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.event_settings TO authenticated;


--
-- Name: TABLE event_translations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.event_translations TO authenticated;


--
-- Name: TABLE food_categories; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.food_categories TO authenticated;


--
-- Name: TABLE food_category_translations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.food_category_translations TO authenticated;


--
-- Name: TABLE food_item_translations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.food_item_translations TO authenticated;


--
-- Name: TABLE food_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.food_items TO authenticated;


--
-- Name: TABLE food_type_translations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.food_type_translations TO authenticated;


--
-- Name: TABLE session_translations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.session_translations TO authenticated;


--
-- Name: TABLE translation_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.translation_overrides TO authenticated;


--
-- Name: TABLE venue_translations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.venue_translations TO authenticated;


--
-- Name: TABLE event_content; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.event_content TO authenticated;


--
-- Name: TABLE event_languages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.event_languages TO authenticated;


--
-- Name: TABLE food_claims; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.food_claims TO authenticated;


--
-- Name: TABLE food_groups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.food_groups TO authenticated;


--
-- Name: TABLE food_item_types; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.food_item_types TO authenticated;


--
-- Name: TABLE guest_session_responses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.guest_session_responses TO authenticated;


--
-- Name: TABLE household_contacts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.household_contacts TO authenticated;


--
-- Name: TABLE invitation_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.invitation_deliveries TO authenticated;


--
-- Name: TABLE message_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.message_templates TO authenticated;


--
-- Name: TABLE other_categories; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.other_categories TO authenticated;


--
-- Name: TABLE other_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.other_items TO authenticated;


--
-- Name: TABLE relation_groups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.relation_groups TO authenticated;


--
-- Name: TABLE rsvp_submissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.rsvp_submissions TO authenticated;


--
-- PostgreSQL database dump complete
--




-- Safe initial defaults, before audit triggers are installed.
INSERT INTO public.event_languages ("display_name", "enabled", "language_code", "sort_order") VALUES ('English', true, 'en', 1);
INSERT INTO public.event_languages ("display_name", "enabled", "language_code", "sort_order") VALUES ('Føroyskt', true, 'fo', 2);
INSERT INTO public.event_languages ("display_name", "enabled", "language_code", "sort_order") VALUES ('Deutsch', true, 'de', 3);
INSERT INTO public.event_settings ("default_language", "event_date", "event_name", "event_type", "fallback_language", "food_enabled", "food_introduction", "food_stage", "guest_background", "guest_design", "guest_theme_default", "guest_theme_toggle", "id", "introduction", "invitation_message", "is_published", "notification_preferences", "other_enabled", "planning_config", "rsvp_deadline", "timezone", "website_url") VALUES ('en', NULL, 'My event', 'other', 'en', true, '{}', 'interest', NULL, NULL, 'dark', true, 1, '', '', false, NULL, true, '{"groups":[{"id":"general","names":{"de":"Allgemein","en":"General","fo":"Alment"}}],"labels":{"guests":{},"households":{}}}', NULL, 'UTC', NULL);

--
-- PostgreSQL database dump
--



SET LOCAL statement_timeout = 0;
SET LOCAL lock_timeout = 0;
SET LOCAL idle_in_transaction_session_timeout = 0;
SET LOCAL transaction_timeout = 0;
SET LOCAL client_encoding = 'UTF8';
SET LOCAL standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', true);
SET LOCAL check_function_bodies = false;
SET LOCAL xmloption = content;
SET LOCAL client_min_messages = warning;
SET LOCAL row_security = off;

SET LOCAL default_tablespace = '';

--
-- Name: admin_access_audit admin_access_audit_pkey; Type: CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.admin_access_audit
    ADD CONSTRAINT admin_access_audit_pkey PRIMARY KEY (id);


--
-- Name: admin_session_revocations admin_session_revocations_pkey; Type: CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.admin_session_revocations
    ADD CONSTRAINT admin_session_revocations_pkey PRIMARY KEY (session_id);


--
-- Name: invitation_code_registry invitation_code_registry_pkey; Type: CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.invitation_code_registry
    ADD CONSTRAINT invitation_code_registry_pkey PRIMARY KEY (code);


--
-- Name: pending_admin_permissions pending_admin_permissions_pkey; Type: CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.pending_admin_permissions
    ADD CONSTRAINT pending_admin_permissions_pkey PRIMARY KEY (invitation_id);


--
-- Name: admin_invitation_audit admin_invitation_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invitation_audit
    ADD CONSTRAINT admin_invitation_audit_pkey PRIMARY KEY (id);


--
-- Name: admin_invitations admin_invitations_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invitations
    ADD CONSTRAINT admin_invitations_email_key UNIQUE (email);


--
-- Name: admin_invitations admin_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invitations
    ADD CONSTRAINT admin_invitations_pkey PRIMARY KEY (id);


--
-- Name: admin_membership_audit admin_membership_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_membership_audit
    ADD CONSTRAINT admin_membership_audit_pkey PRIMARY KEY (id);


--
-- Name: admin_session_audit admin_session_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_session_audit
    ADD CONSTRAINT admin_session_audit_pkey PRIMARY KEY (id);


--
-- Name: admin_session_audit admin_session_audit_session_id_action_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_session_audit
    ADD CONSTRAINT admin_session_audit_session_id_action_key UNIQUE (session_id, action);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (user_id);


--
-- Name: backup_restore_audit backup_restore_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_restore_audit
    ADD CONSTRAINT backup_restore_audit_pkey PRIMARY KEY (id);


--
-- Name: event_configuration_audit event_configuration_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_configuration_audit
    ADD CONSTRAINT event_configuration_audit_pkey PRIMARY KEY (id);


--
-- Name: event_languages event_languages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_languages
    ADD CONSTRAINT event_languages_pkey PRIMARY KEY (language_code);


--
-- Name: event_locations event_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_locations
    ADD CONSTRAINT event_locations_pkey PRIMARY KEY (id);


--
-- Name: event_sessions event_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_sessions
    ADD CONSTRAINT event_sessions_pkey PRIMARY KEY (id);


--
-- Name: event_sessions event_sessions_session_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_sessions
    ADD CONSTRAINT event_sessions_session_key_key UNIQUE (session_key);


--
-- Name: event_settings event_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_settings
    ADD CONSTRAINT event_settings_pkey PRIMARY KEY (id);


--
-- Name: event_translations event_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_translations
    ADD CONSTRAINT event_translations_pkey PRIMARY KEY (event_id, language_code);


--
-- Name: food_categories food_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_categories
    ADD CONSTRAINT food_categories_name_key UNIQUE (name);


--
-- Name: food_categories food_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_categories
    ADD CONSTRAINT food_categories_pkey PRIMARY KEY (id);


--
-- Name: food_category_translations food_category_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_category_translations
    ADD CONSTRAINT food_category_translations_pkey PRIMARY KEY (food_category_id, language_code);


--
-- Name: food_claims food_claims_food_item_id_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_claims
    ADD CONSTRAINT food_claims_food_item_id_household_id_key UNIQUE (food_item_id, household_id);


--
-- Name: food_claims food_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_claims
    ADD CONSTRAINT food_claims_pkey PRIMARY KEY (id);


--
-- Name: food_groups food_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_groups
    ADD CONSTRAINT food_groups_pkey PRIMARY KEY (id);


--
-- Name: food_item_translations food_item_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_item_translations
    ADD CONSTRAINT food_item_translations_pkey PRIMARY KEY (food_item_id, language_code);


--
-- Name: food_item_types food_item_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_item_types
    ADD CONSTRAINT food_item_types_pkey PRIMARY KEY (name);


--
-- Name: food_items food_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_items
    ADD CONSTRAINT food_items_pkey PRIMARY KEY (id);


--
-- Name: food_type_translations food_type_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_type_translations
    ADD CONSTRAINT food_type_translations_pkey PRIMARY KEY (food_type_name, language_code);


--
-- Name: guest_gateway_rate_limits guest_gateway_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_gateway_rate_limits
    ADD CONSTRAINT guest_gateway_rate_limits_pkey PRIMARY KEY (key_hash, period_start);


--
-- Name: guest_session_overrides guest_session_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_session_overrides
    ADD CONSTRAINT guest_session_overrides_pkey PRIMARY KEY (guest_id, session_id);


--
-- Name: guest_session_responses guest_session_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_session_responses
    ADD CONSTRAINT guest_session_responses_pkey PRIMARY KEY (guest_id, session_id);


--
-- Name: guests guests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_pkey PRIMARY KEY (id);


--
-- Name: household_contacts household_contacts_id_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_contacts
    ADD CONSTRAINT household_contacts_id_household_id_key UNIQUE (id, household_id);


--
-- Name: household_contacts household_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_contacts
    ADD CONSTRAINT household_contacts_pkey PRIMARY KEY (id);


--
-- Name: household_session_defaults household_session_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_session_defaults
    ADD CONSTRAINT household_session_defaults_pkey PRIMARY KEY (household_id, session_id);


--
-- Name: households households_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_invite_code_key UNIQUE (invite_code);


--
-- Name: households households_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_pkey PRIMARY KEY (id);


--
-- Name: invitation_access_audit invitation_access_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_access_audit
    ADD CONSTRAINT invitation_access_audit_pkey PRIMARY KEY (id);


--
-- Name: invitation_deliveries invitation_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_deliveries
    ADD CONSTRAINT invitation_deliveries_pkey PRIMARY KEY (id);


--
-- Name: invitation_deliveries invitation_deliveries_queue_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_deliveries
    ADD CONSTRAINT invitation_deliveries_queue_id_key UNIQUE (queue_id);


--
-- Name: invitation_delivery_audit invitation_delivery_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_delivery_audit
    ADD CONSTRAINT invitation_delivery_audit_pkey PRIMARY KEY (id);


--
-- Name: invitation_send_queue invitation_send_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_send_queue
    ADD CONSTRAINT invitation_send_queue_pkey PRIMARY KEY (id);


--
-- Name: management_audit management_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.management_audit
    ADD CONSTRAINT management_audit_pkey PRIMARY KEY (id);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- Name: message_templates message_templates_template_key_language_code_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_template_key_language_code_channel_key UNIQUE (template_key, language_code, channel);




--
-- Name: other_categories other_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.other_categories
    ADD CONSTRAINT other_categories_name_key UNIQUE (name);


--
-- Name: other_categories other_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.other_categories
    ADD CONSTRAINT other_categories_pkey PRIMARY KEY (id);


--
-- Name: relation_groups relation_groups_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relation_groups
    ADD CONSTRAINT relation_groups_name_key UNIQUE (name);


--
-- Name: relation_groups relation_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relation_groups
    ADD CONSTRAINT relation_groups_pkey PRIMARY KEY (id);


--
-- Name: rsvp_household_audit rsvp_household_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_household_audit
    ADD CONSTRAINT rsvp_household_audit_pkey PRIMARY KEY (id);


--
-- Name: rsvp_response_audit rsvp_response_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_response_audit
    ADD CONSTRAINT rsvp_response_audit_pkey PRIMARY KEY (id);


--
-- Name: rsvp_submissions rsvp_submissions_household_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_submissions
    ADD CONSTRAINT rsvp_submissions_household_id_request_id_key UNIQUE (household_id, request_id);


--
-- Name: rsvp_submissions rsvp_submissions_household_id_submission_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_submissions
    ADD CONSTRAINT rsvp_submissions_household_id_submission_number_key UNIQUE (household_id, submission_number);


--
-- Name: rsvp_submissions rsvp_submissions_id_household_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_submissions
    ADD CONSTRAINT rsvp_submissions_id_household_id_key UNIQUE (id, household_id);


--
-- Name: rsvp_submissions rsvp_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_submissions
    ADD CONSTRAINT rsvp_submissions_pkey PRIMARY KEY (id);


--
-- Name: session_translations session_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_translations
    ADD CONSTRAINT session_translations_pkey PRIMARY KEY (session_id, language_code);


--
-- Name: other_items other_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.other_items
    ADD CONSTRAINT other_items_pkey PRIMARY KEY (id);


--
-- Name: translation_overrides translation_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.translation_overrides
    ADD CONSTRAINT translation_overrides_pkey PRIMARY KEY (translation_key, language_code);


--
-- Name: translation_overrides translation_overrides_source_text_language_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.translation_overrides
    ADD CONSTRAINT translation_overrides_source_text_language_code_key UNIQUE (source_text, language_code);


--
-- Name: venue_translations venue_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_translations
    ADD CONSTRAINT venue_translations_pkey PRIMARY KEY (venue_id, language_code);


--
-- Name: admin_access_audit_actor; Type: INDEX; Schema: app_private; Owner: -
--

CREATE INDEX admin_access_audit_actor ON app_private.admin_access_audit USING btree (actor_id, created_at DESC);


--
-- Name: admin_access_audit_subject; Type: INDEX; Schema: app_private; Owner: -
--

CREATE INDEX admin_access_audit_subject ON app_private.admin_access_audit USING btree (subject_id, created_at DESC);


--
-- Name: admin_session_revocations_actor; Type: INDEX; Schema: app_private; Owner: -
--

CREATE INDEX admin_session_revocations_actor ON app_private.admin_session_revocations USING btree (revoked_by);


--
-- Name: admin_session_revocations_user; Type: INDEX; Schema: app_private; Owner: -
--

CREATE INDEX admin_session_revocations_user ON app_private.admin_session_revocations USING btree (user_id);


--
-- Name: admin_invitation_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_invitation_audit_actor ON public.admin_invitation_audit USING btree (actor_user_id);


--
-- Name: admin_invitation_audit_invitation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_invitation_audit_invitation ON public.admin_invitation_audit USING btree (invitation_id);


--
-- Name: admin_invitation_audit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_invitation_audit_time ON public.admin_invitation_audit USING btree (created_at DESC, id DESC);


--
-- Name: admin_invitations_acceptor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_invitations_acceptor ON public.admin_invitations USING btree (accepted_by);


--
-- Name: admin_invitations_inviter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_invitations_inviter ON public.admin_invitations USING btree (invited_by);


--
-- Name: admin_membership_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_membership_log_time ON public.admin_membership_audit USING btree (created_at DESC, id DESC);


--
-- Name: admin_session_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_session_log_time ON public.admin_session_audit USING btree (created_at DESC, id DESC);


--
-- Name: backup_restore_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX backup_restore_actor ON public.backup_restore_audit USING btree (actor_user_id);


--
-- Name: event_configuration_audit_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_configuration_audit_log_time ON public.event_configuration_audit USING btree (created_at DESC, id DESC);


--
-- Name: event_translations_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_translations_actor ON public.event_translations USING btree (updated_by);


--
-- Name: food_categories_parent_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX food_categories_parent_order_idx ON public.food_categories USING btree (parent_id, sort_order, id);


--
-- Name: food_category_translations_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX food_category_translations_actor ON public.food_category_translations USING btree (updated_by);


--
-- Name: food_claims_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX food_claims_household_idx ON public.food_claims USING btree (household_id);


--
-- Name: food_claims_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX food_claims_item_idx ON public.food_claims USING btree (food_item_id);


--
-- Name: food_item_translations_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX food_item_translations_actor ON public.food_item_translations USING btree (updated_by);


--
-- Name: food_items_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX food_items_group_idx ON public.food_items USING btree (food_group_id) WHERE (food_group_id IS NOT NULL);


--
-- Name: food_type_translations_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX food_type_translations_actor ON public.food_type_translations USING btree (updated_by);


--
-- Name: guests_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guests_household_idx ON public.guests USING btree (household_id);


--
-- Name: guests_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guests_language ON public.guests USING btree (language);


--
-- Name: household_contact_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX household_contact_guest ON public.household_contacts USING btree (guest_id) WHERE (guest_id IS NOT NULL);


--
-- Name: household_contacts_household_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX household_contacts_household_idx ON public.household_contacts USING btree (household_id);


--
-- Name: household_one_primary_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX household_one_primary_contact ON public.household_contacts USING btree (household_id) WHERE (is_household_primary IS TRUE);


--
-- Name: household_primary_contact_per_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX household_primary_contact_per_type ON public.household_contacts USING btree (household_id, contact_type) WHERE is_primary;


--
-- Name: households_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX households_language ON public.households USING btree (language);


--
-- Name: households_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX households_parent_idx ON public.households USING btree (parent_id);


--
-- Name: households_primary_guest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX households_primary_guest_idx ON public.households USING btree (primary_guest_id) WHERE (primary_guest_id IS NOT NULL);


--
-- Name: households_relation_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX households_relation_group_idx ON public.households USING btree (relation_group_id);


--
-- Name: invitation_access_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_access_log_time ON public.invitation_access_audit USING btree (created_at DESC, id DESC);


--
-- Name: invitation_access_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_access_time ON public.invitation_access_audit USING btree (household_id, created_at DESC);


--
-- Name: invitation_delivery_audit_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_delivery_audit_queue_idx ON public.invitation_delivery_audit USING btree (queue_id, created_at DESC);


--
-- Name: invitation_delivery_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_delivery_log_time ON public.invitation_delivery_audit USING btree (created_at DESC, id DESC);


--
-- Name: invitation_queue_household_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitation_queue_household_status_idx ON public.invitation_send_queue USING btree (household_id, status);


--
-- Name: invitation_share_handoff_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invitation_share_handoff_id_idx ON public.invitation_delivery_audit USING btree (queue_id, ((new_value ->> 'handoff_id'::text))) WHERE (action = 'share_handoff_completed'::text);


--
-- Name: management_audit_household_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX management_audit_household_time ON public.management_audit USING btree (household_id, created_at DESC);


--
-- Name: management_audit_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX management_audit_log_time ON public.management_audit USING btree (created_at DESC, id DESC);


--
-- Name: other_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX other_items_category ON public.other_items USING btree (category_id);




--
-- Name: rsvp_household_audit_household_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsvp_household_audit_household_time_idx ON public.rsvp_household_audit USING btree (household_id, created_at DESC);


--
-- Name: rsvp_household_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsvp_household_log_time ON public.rsvp_household_audit USING btree (created_at DESC, id DESC);


--
-- Name: rsvp_response_audit_household_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsvp_response_audit_household_time_idx ON public.rsvp_response_audit USING btree (household_id, created_at DESC);


--
-- Name: rsvp_response_log_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsvp_response_log_time ON public.rsvp_response_audit USING btree (created_at DESC, id DESC);


--
-- Name: rsvp_submissions_household_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsvp_submissions_household_time_idx ON public.rsvp_submissions USING btree (household_id, submitted_at DESC);


--
-- Name: session_translations_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_translations_actor ON public.session_translations USING btree (updated_by);


--
-- Name: translation_overrides_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX translation_overrides_actor ON public.translation_overrides USING btree (updated_by);


--
-- Name: venue_translations_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX venue_translations_actor ON public.venue_translations USING btree (updated_by);


--
-- Name: admin_access_audit immutable_admin_access; Type: TRIGGER; Schema: app_private; Owner: -
--

CREATE TRIGGER immutable_admin_access BEFORE DELETE OR UPDATE ON app_private.admin_access_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: guests append_guest_order; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER append_guest_order BEFORE INSERT OR UPDATE OF is_child, household_id ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.append_guest_order();


--
-- Name: event_sessions audit_session; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_session AFTER INSERT OR UPDATE ON public.event_sessions FOR EACH ROW EXECUTE FUNCTION app_private.audit_event_configuration();


--
-- Name: event_locations audit_venue; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_venue AFTER INSERT OR UPDATE ON public.event_locations FOR EACH ROW EXECUTE FUNCTION app_private.audit_event_configuration();


--
-- Name: household_contacts clear_archived_household_primary_contact; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clear_archived_household_primary_contact BEFORE UPDATE OF archived_at ON public.household_contacts FOR EACH ROW EXECUTE FUNCTION app_private.clear_archived_household_primary_contact();


--
-- Name: households clear_archived_household_primary_guests; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clear_archived_household_primary_guests AFTER UPDATE OF archived_at ON public.households FOR EACH ROW WHEN (((old.archived_at IS NULL) AND (new.archived_at IS NOT NULL))) EXECUTE FUNCTION app_private.clear_archived_household_primary_guests();


--
-- Name: guests clear_primary_guest; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clear_primary_guest AFTER UPDATE OF is_child, archived_at, household_id ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.clear_ineligible_primary_guest();


--
-- Name: household_contacts contact_language_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contact_language_guard BEFORE INSERT OR UPDATE OF language_code ON public.household_contacts FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language_code');


--
-- Name: household_contacts contact_management_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contact_management_audit AFTER INSERT OR UPDATE ON public.household_contacts FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();


--
-- Name: food_items food_capacity_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER food_capacity_guard BEFORE UPDATE OF quantity_needed ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_food_capacity();


--
-- Name: food_items guard_food_archive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_food_archive BEFORE UPDATE OF archived_at ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_item_archive_column();


--
-- Name: food_categories guard_food_category_tree; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_food_category_tree AFTER INSERT OR UPDATE OF parent_id ON public.food_categories FOR EACH ROW EXECUTE FUNCTION app_private.guard_food_category_tree();


--
-- Name: food_items guard_food_group_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_food_group_change BEFORE UPDATE OF food_group_id ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_food_group_change();


--
-- Name: event_settings guard_guest_customization; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_guest_customization BEFORE UPDATE OF guest_background, guest_design ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_guest_customization();


--
-- Name: households guard_household_planning_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_household_planning_group BEFORE INSERT OR UPDATE OF planning_group_id ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_household_planning_group();


--
-- Name: households guard_household_relation_scope; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_household_relation_scope BEFORE INSERT OR UPDATE OF planning_group_id, relation_group_id ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_relation_group_scope();


--
-- Name: event_settings guard_notification_preferences; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_notification_preferences BEFORE UPDATE OF notification_preferences ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_notification_preferences();


--
-- Name: other_items guard_other_archive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_other_archive BEFORE UPDATE OF archived_at ON public.other_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_item_archive_column();


--
-- Name: event_settings guard_planning_group_removal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_planning_group_removal BEFORE UPDATE OF planning_config ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_planning_group_removal();


--
-- Name: relation_groups guard_relation_group_scope; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_relation_group_scope BEFORE INSERT OR DELETE OR UPDATE ON public.relation_groups FOR EACH ROW EXECUTE FUNCTION app_private.guard_relation_group_scope();


--
-- Name: guests guest_language_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guest_language_guard BEFORE INSERT OR UPDATE OF language ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language');


--
-- Name: guests guest_management_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guest_management_audit AFTER INSERT OR UPDATE ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();


--
-- Name: households household_language_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER household_language_guard BEFORE INSERT OR UPDATE OF language ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language');


--
-- Name: households household_management_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER household_management_audit AFTER INSERT OR UPDATE ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();


--
-- Name: households household_parent_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER household_parent_guard BEFORE INSERT OR UPDATE OF parent_id ON public.households FOR EACH ROW EXECUTE FUNCTION public.guard_household_parent();


--
-- Name: households household_primary_guest; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER household_primary_guest BEFORE INSERT OR UPDATE OF primary_guest_id ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.check_primary_guest();


--
-- Name: admin_invitation_audit immutable_admin_invitation_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_admin_invitation_audit BEFORE DELETE OR UPDATE ON public.admin_invitation_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: admin_membership_audit immutable_admin_membership_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_admin_membership_audit BEFORE DELETE OR UPDATE ON public.admin_membership_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: admin_session_audit immutable_admin_session; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_admin_session BEFORE DELETE OR UPDATE ON public.admin_session_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: backup_restore_audit immutable_backup_restore_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_backup_restore_audit BEFORE DELETE OR UPDATE ON public.backup_restore_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: event_configuration_audit immutable_event_configuration_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_event_configuration_audit BEFORE DELETE OR UPDATE ON public.event_configuration_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: invitation_access_audit immutable_invitation_access; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_invitation_access BEFORE DELETE OR UPDATE ON public.invitation_access_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: invitation_deliveries immutable_invitation_deliveries; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_invitation_deliveries BEFORE DELETE OR UPDATE ON public.invitation_deliveries FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: invitation_delivery_audit immutable_invitation_delivery_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_invitation_delivery_audit BEFORE DELETE OR UPDATE ON public.invitation_delivery_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: management_audit immutable_management_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_management_audit BEFORE DELETE OR UPDATE ON public.management_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: rsvp_household_audit immutable_rsvp_household_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_rsvp_household_audit BEFORE DELETE OR UPDATE ON public.rsvp_household_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: rsvp_response_audit immutable_rsvp_response_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_rsvp_response_audit BEFORE DELETE OR UPDATE ON public.rsvp_response_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: rsvp_submissions immutable_rsvp_submissions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER immutable_rsvp_submissions BEFORE DELETE OR UPDATE ON public.rsvp_submissions FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();


--
-- Name: admin_invitations invitation_access_default; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitation_access_default AFTER INSERT OR UPDATE OF status ON public.admin_invitations FOR EACH ROW EXECUTE FUNCTION app_private.reset_invitation_access();


--
-- Name: households invitation_code_archive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitation_code_archive AFTER UPDATE OF archived_at ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.sync_archived_invitation_code();


--
-- Name: households invitation_code_empty_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitation_code_empty_guard BEFORE INSERT OR UPDATE OF invite_code ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_empty_invitation_code();


--
-- Name: guests invitation_code_membership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitation_code_membership AFTER INSERT OR DELETE OR UPDATE OF household_id, archived_at ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.sync_guest_invitation_codes();


--
-- Name: event_settings issue_codes_on_publication; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER issue_codes_on_publication AFTER UPDATE OF is_published ON public.event_settings FOR EACH ROW WHEN ((new.is_published AND (NOT old.is_published))) EXECUTE FUNCTION app_private.issue_codes_on_publication();


--
-- Name: event_settings language_preferences_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER language_preferences_guard BEFORE INSERT OR UPDATE OF default_language, fallback_language ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_language_preferences();


--
-- Name: event_languages language_removal_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER language_removal_guard BEFORE DELETE OR UPDATE ON public.event_languages FOR EACH ROW EXECUTE FUNCTION app_private.guard_language_removal();


--
-- Name: food_categories lock_food_category_tree; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lock_food_category_tree BEFORE INSERT OR UPDATE OF parent_id ON public.food_categories FOR EACH ROW EXECUTE FUNCTION app_private.lock_food_category_tree();


--
-- Name: event_settings lock_planning_configuration; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lock_planning_configuration BEFORE UPDATE OF planning_config ON public.event_settings FOR EACH STATEMENT EXECUTE FUNCTION app_private.lock_publication();


--
-- Name: event_settings lock_publication; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lock_publication BEFORE UPDATE OF is_published ON public.event_settings FOR EACH STATEMENT EXECUTE FUNCTION app_private.lock_publication();


--
-- Name: households management_parent_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER management_parent_guard BEFORE INSERT OR UPDATE OF parent_id, planning_group_id, relation_group_id, archived_at ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_management_parent();


--
-- Name: food_items validate_food_item_settings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_food_item_settings BEFORE INSERT OR UPDATE OF quantity_type, venue_ids ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.validate_food_item_settings();


--
-- Name: admin_access_audit admin_access_audit_actor_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.admin_access_audit
    ADD CONSTRAINT admin_access_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);


--
-- Name: admin_access_audit admin_access_audit_subject_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.admin_access_audit
    ADD CONSTRAINT admin_access_audit_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES auth.users(id);


--
-- Name: admin_session_revocations admin_session_revocations_revoked_by_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.admin_session_revocations
    ADD CONSTRAINT admin_session_revocations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES auth.users(id);


--
-- Name: admin_session_revocations admin_session_revocations_user_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.admin_session_revocations
    ADD CONSTRAINT admin_session_revocations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: pending_admin_permissions pending_admin_permissions_invitation_id_fkey; Type: FK CONSTRAINT; Schema: app_private; Owner: -
--

ALTER TABLE ONLY app_private.pending_admin_permissions
    ADD CONSTRAINT pending_admin_permissions_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.admin_invitations(id);


--
-- Name: admin_invitation_audit admin_invitation_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invitation_audit
    ADD CONSTRAINT admin_invitation_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);


--
-- Name: admin_invitation_audit admin_invitation_audit_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invitation_audit
    ADD CONSTRAINT admin_invitation_audit_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.admin_invitations(id);


--
-- Name: admin_invitations admin_invitations_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invitations
    ADD CONSTRAINT admin_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id);


--
-- Name: admin_invitations admin_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invitations
    ADD CONSTRAINT admin_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);


--
-- Name: admin_session_audit admin_session_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_session_audit
    ADD CONSTRAINT admin_session_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);


--
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: backup_restore_audit backup_restore_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_restore_audit
    ADD CONSTRAINT backup_restore_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);


--
-- Name: event_configuration_audit event_configuration_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_configuration_audit
    ADD CONSTRAINT event_configuration_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);


--
-- Name: event_sessions event_sessions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_sessions
    ADD CONSTRAINT event_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.event_locations(id) ON DELETE RESTRICT;


--
-- Name: event_settings event_settings_default_language_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_settings
    ADD CONSTRAINT event_settings_default_language_fkey FOREIGN KEY (default_language) REFERENCES public.event_languages(language_code);


--
-- Name: event_settings event_settings_fallback_language_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_settings
    ADD CONSTRAINT event_settings_fallback_language_fkey FOREIGN KEY (fallback_language) REFERENCES public.event_languages(language_code);


--
-- Name: event_translations event_translations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_translations
    ADD CONSTRAINT event_translations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event_settings(id) ON DELETE CASCADE;


--
-- Name: event_translations event_translations_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_translations
    ADD CONSTRAINT event_translations_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: event_translations event_translations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_translations
    ADD CONSTRAINT event_translations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: food_categories food_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_categories
    ADD CONSTRAINT food_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.food_categories(id) ON DELETE RESTRICT;


--
-- Name: food_category_translations food_category_translations_food_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_category_translations
    ADD CONSTRAINT food_category_translations_food_category_id_fkey FOREIGN KEY (food_category_id) REFERENCES public.food_categories(id) ON DELETE CASCADE;


--
-- Name: food_category_translations food_category_translations_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_category_translations
    ADD CONSTRAINT food_category_translations_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: food_category_translations food_category_translations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_category_translations
    ADD CONSTRAINT food_category_translations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: food_claims food_claims_food_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_claims
    ADD CONSTRAINT food_claims_food_item_id_fkey FOREIGN KEY (food_item_id) REFERENCES public.food_items(id) ON DELETE RESTRICT;


--
-- Name: food_claims food_claims_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_claims
    ADD CONSTRAINT food_claims_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: food_groups food_groups_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_groups
    ADD CONSTRAINT food_groups_category_fkey FOREIGN KEY (category) REFERENCES public.food_categories(name) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: food_item_translations food_item_translations_food_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_item_translations
    ADD CONSTRAINT food_item_translations_food_item_id_fkey FOREIGN KEY (food_item_id) REFERENCES public.food_items(id) ON DELETE CASCADE;


--
-- Name: food_item_translations food_item_translations_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_item_translations
    ADD CONSTRAINT food_item_translations_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: food_item_translations food_item_translations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_item_translations
    ADD CONSTRAINT food_item_translations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: food_items food_items_food_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_items
    ADD CONSTRAINT food_items_food_group_id_fkey FOREIGN KEY (food_group_id) REFERENCES public.food_groups(id);


--
-- Name: food_type_translations food_type_translations_food_type_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_type_translations
    ADD CONSTRAINT food_type_translations_food_type_name_fkey FOREIGN KEY (food_type_name) REFERENCES public.food_item_types(name) ON DELETE CASCADE;


--
-- Name: food_type_translations food_type_translations_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_type_translations
    ADD CONSTRAINT food_type_translations_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: food_type_translations food_type_translations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_type_translations
    ADD CONSTRAINT food_type_translations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: guest_session_overrides guest_session_overrides_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_session_overrides
    ADD CONSTRAINT guest_session_overrides_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE RESTRICT;


--
-- Name: guest_session_overrides guest_session_overrides_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_session_overrides
    ADD CONSTRAINT guest_session_overrides_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.event_sessions(id) ON DELETE RESTRICT;


--
-- Name: guest_session_responses guest_session_responses_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_session_responses
    ADD CONSTRAINT guest_session_responses_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE RESTRICT;


--
-- Name: guest_session_responses guest_session_responses_last_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_session_responses
    ADD CONSTRAINT guest_session_responses_last_submission_id_fkey FOREIGN KEY (last_submission_id) REFERENCES public.rsvp_submissions(id) ON DELETE RESTRICT;


--
-- Name: guest_session_responses guest_session_responses_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_session_responses
    ADD CONSTRAINT guest_session_responses_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.event_sessions(id) ON DELETE RESTRICT;


--
-- Name: guests guests_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: guests guests_language_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_language_fk FOREIGN KEY (language) REFERENCES public.event_languages(language_code);


--
-- Name: household_contacts household_contacts_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_contacts
    ADD CONSTRAINT household_contacts_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE RESTRICT;


--
-- Name: household_contacts household_contacts_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_contacts
    ADD CONSTRAINT household_contacts_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: household_contacts household_contacts_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_contacts
    ADD CONSTRAINT household_contacts_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: households household_latest_submission_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT household_latest_submission_fk FOREIGN KEY (latest_rsvp_submission_id, id) REFERENCES public.rsvp_submissions(id, household_id) ON DELETE RESTRICT;


--
-- Name: household_session_defaults household_session_defaults_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_session_defaults
    ADD CONSTRAINT household_session_defaults_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: household_session_defaults household_session_defaults_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_session_defaults
    ADD CONSTRAINT household_session_defaults_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.event_sessions(id) ON DELETE RESTRICT;


--
-- Name: households households_language_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_language_fk FOREIGN KEY (language) REFERENCES public.event_languages(language_code);


--
-- Name: households households_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: households households_primary_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_primary_guest_id_fkey FOREIGN KEY (primary_guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: households households_relation_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_relation_group_id_fkey FOREIGN KEY (relation_group_id) REFERENCES public.relation_groups(id) ON DELETE SET NULL;


--
-- Name: invitation_access_audit invitation_access_audit_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_access_audit
    ADD CONSTRAINT invitation_access_audit_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id);


--
-- Name: invitation_deliveries invitation_deliveries_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_deliveries
    ADD CONSTRAINT invitation_deliveries_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: invitation_deliveries invitation_deliveries_queue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_deliveries
    ADD CONSTRAINT invitation_deliveries_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT;


--
-- Name: invitation_delivery_audit invitation_delivery_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_delivery_audit
    ADD CONSTRAINT invitation_delivery_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: invitation_delivery_audit invitation_delivery_audit_queue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_delivery_audit
    ADD CONSTRAINT invitation_delivery_audit_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT;


--
-- Name: invitation_send_queue invitation_send_queue_contact_id_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_send_queue
    ADD CONSTRAINT invitation_send_queue_contact_id_household_id_fkey FOREIGN KEY (contact_id, household_id) REFERENCES public.household_contacts(id, household_id) ON DELETE RESTRICT;


--
-- Name: invitation_send_queue invitation_send_queue_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_send_queue
    ADD CONSTRAINT invitation_send_queue_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: invitation_send_queue invitation_send_queue_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_send_queue
    ADD CONSTRAINT invitation_send_queue_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: management_audit management_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.management_audit
    ADD CONSTRAINT management_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);


--
-- Name: message_templates message_templates_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: other_items other_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.other_items
    ADD CONSTRAINT other_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.other_categories(id);


--
-- Name: rsvp_household_audit rsvp_household_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_household_audit
    ADD CONSTRAINT rsvp_household_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: rsvp_household_audit rsvp_household_audit_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_household_audit
    ADD CONSTRAINT rsvp_household_audit_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: rsvp_household_audit rsvp_household_audit_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_household_audit
    ADD CONSTRAINT rsvp_household_audit_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.rsvp_submissions(id) ON DELETE RESTRICT;


--
-- Name: rsvp_response_audit rsvp_response_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_response_audit
    ADD CONSTRAINT rsvp_response_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: rsvp_response_audit rsvp_response_audit_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_response_audit
    ADD CONSTRAINT rsvp_response_audit_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE RESTRICT;


--
-- Name: rsvp_response_audit rsvp_response_audit_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_response_audit
    ADD CONSTRAINT rsvp_response_audit_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: rsvp_response_audit rsvp_response_audit_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_response_audit
    ADD CONSTRAINT rsvp_response_audit_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.event_sessions(id) ON DELETE RESTRICT;


--
-- Name: rsvp_submissions rsvp_submissions_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rsvp_submissions
    ADD CONSTRAINT rsvp_submissions_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE RESTRICT;


--
-- Name: session_translations session_translations_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_translations
    ADD CONSTRAINT session_translations_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: session_translations session_translations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_translations
    ADD CONSTRAINT session_translations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.event_sessions(id) ON DELETE CASCADE;


--
-- Name: session_translations session_translations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_translations
    ADD CONSTRAINT session_translations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: translation_overrides translation_overrides_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.translation_overrides
    ADD CONSTRAINT translation_overrides_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: translation_overrides translation_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.translation_overrides
    ADD CONSTRAINT translation_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: venue_translations venue_translations_language_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_translations
    ADD CONSTRAINT venue_translations_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.event_languages(language_code);


--
-- Name: venue_translations venue_translations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_translations
    ADD CONSTRAINT venue_translations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: venue_translations venue_translations_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_translations
    ADD CONSTRAINT venue_translations_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.event_locations(id) ON DELETE CASCADE;


--
-- Name: admin_access_audit; Type: ROW SECURITY; Schema: app_private; Owner: -
--

ALTER TABLE app_private.admin_access_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_session_revocations; Type: ROW SECURITY; Schema: app_private; Owner: -
--

ALTER TABLE app_private.admin_session_revocations ENABLE ROW LEVEL SECURITY;

--
-- Name: invitation_code_registry; Type: ROW SECURITY; Schema: app_private; Owner: -
--

ALTER TABLE app_private.invitation_code_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_admin_permissions; Type: ROW SECURITY; Schema: app_private; Owner: -
--

ALTER TABLE app_private.pending_admin_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: food_item_types admin_add; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_add ON public.food_item_types FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_languages admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.event_languages FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_locations admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.event_locations FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_sessions admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.event_sessions FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_settings admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.event_settings FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_categories admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.food_categories FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_items admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.food_items FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: guest_session_overrides admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.guest_session_overrides FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: household_contacts admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.household_contacts FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: household_session_defaults admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.household_session_defaults FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: invitation_send_queue admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.invitation_send_queue FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: message_templates admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.message_templates FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: other_items admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.other_items FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: relation_groups admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.relation_groups FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: admin_invitation_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_invitation_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_membership_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_membership_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_membership_audit admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.admin_membership_audit FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: backup_restore_audit admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.backup_restore_audit FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_configuration_audit admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.event_configuration_audit FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_languages admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.event_languages FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_locations admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.event_locations FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_sessions admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.event_sessions FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_settings admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.event_settings FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_translations admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.event_translations FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_categories admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.food_categories FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_category_translations admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.food_category_translations FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_claims admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.food_claims FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_item_translations admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.food_item_translations FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_item_types admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.food_item_types FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_items admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.food_items FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_type_translations admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.food_type_translations FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: guest_session_overrides admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.guest_session_overrides FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: guest_session_responses admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.guest_session_responses FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: guests admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.guests FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: household_contacts admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.household_contacts FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: household_session_defaults admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.household_session_defaults FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: households admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.households FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: invitation_deliveries admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.invitation_deliveries FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: invitation_delivery_audit admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.invitation_delivery_audit FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: invitation_send_queue admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.invitation_send_queue FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: management_audit admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.management_audit FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: message_templates admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.message_templates FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: other_categories admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.other_categories FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: other_items admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.other_items FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: relation_groups admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.relation_groups FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: rsvp_household_audit admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.rsvp_household_audit FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: rsvp_response_audit admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.rsvp_response_audit FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: rsvp_submissions admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.rsvp_submissions FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: session_translations admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.session_translations FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: translation_overrides admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.translation_overrides FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: venue_translations admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read ON public.venue_translations FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: admin_session_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_session_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: event_languages admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.event_languages FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_locations admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.event_locations FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_sessions admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.event_sessions FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: event_settings admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.event_settings FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_categories admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.food_categories FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: food_items admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.food_items FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: guest_session_overrides admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.guest_session_overrides FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: household_contacts admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.household_contacts FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: household_session_defaults admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.household_session_defaults FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: invitation_send_queue admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.invitation_send_queue FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: message_templates admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.message_templates FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: other_items admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.other_items FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: relation_groups admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.relation_groups FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

--
-- Name: backup_restore_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backup_restore_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: event_configuration_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_configuration_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: event_languages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_languages ENABLE ROW LEVEL SECURITY;

--
-- Name: event_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: event_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: event_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: event_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: food_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.food_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: food_category_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.food_category_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: food_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.food_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: food_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.food_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: food_groups food_groups_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY food_groups_read ON public.food_groups FOR SELECT TO authenticated USING (public.admin_has_permission('food'::text));


--
-- Name: food_item_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.food_item_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: food_item_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.food_item_types ENABLE ROW LEVEL SECURITY;

--
-- Name: food_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.food_items ENABLE ROW LEVEL SECURITY;

--
-- Name: food_type_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.food_type_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: guest_gateway_rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guest_gateway_rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: guest_session_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guest_session_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: guest_session_responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guest_session_responses ENABLE ROW LEVEL SECURITY;

--
-- Name: guests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

--
-- Name: household_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.household_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: household_session_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.household_session_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: households; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

--
-- Name: invitation_access_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitation_access_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: invitation_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitation_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: invitation_delivery_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitation_delivery_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: invitation_send_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitation_send_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: message_templates invitation_template_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invitation_template_delete ON public.message_templates AS RESTRICTIVE FOR DELETE TO authenticated USING ((template_key <> 'invitation'::text));


--
-- Name: message_templates invitation_template_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invitation_template_insert ON public.message_templates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((template_key <> 'invitation'::text));


--
-- Name: message_templates invitation_template_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invitation_template_update ON public.message_templates AS RESTRICTIVE FOR UPDATE TO authenticated USING ((template_key <> 'invitation'::text)) WITH CHECK ((template_key <> 'invitation'::text));


--
-- Name: management_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.management_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: message_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: other_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.other_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: other_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.other_items ENABLE ROW LEVEL SECURITY;

--
-- Name: relation_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.relation_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: rsvp_household_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rsvp_household_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: rsvp_response_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rsvp_response_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: rsvp_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rsvp_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_invitation_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.admin_invitation_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_invitations section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.admin_invitations AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_membership_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.admin_membership_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_session_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.admin_session_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admins section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.admins AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: backup_restore_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.backup_restore_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('full'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_configuration_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.event_configuration_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_languages section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.event_languages AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_locations section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.event_locations AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_sessions section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.event_sessions AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_settings section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.event_settings AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('settings'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_translations section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.event_translations AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_categories section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.food_categories AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_category_translations section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.food_category_translations AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_claims section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.food_claims AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_item_translations section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.food_item_translations AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_item_types section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.food_item_types AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_items section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.food_items AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_type_translations section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.food_type_translations AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_gateway_rate_limits section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.guest_gateway_rate_limits AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('full'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_session_overrides section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.guest_session_overrides AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_session_responses section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.guest_session_responses AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guests section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.guests AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: household_contacts section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.household_contacts AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: household_session_defaults section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.household_session_defaults AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: households section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.households AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_access_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.invitation_access_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_deliveries section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.invitation_deliveries AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_delivery_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.invitation_delivery_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_send_queue section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.invitation_send_queue AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: management_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.management_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: message_templates section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.message_templates AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: other_categories section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.other_categories AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('other'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: other_items section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.other_items AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('other'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: relation_groups section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.relation_groups AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_household_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.rsvp_household_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_response_audit section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.rsvp_response_audit AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_submissions section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.rsvp_submissions AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: session_translations section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.session_translations AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: translation_overrides section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.translation_overrides AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: venue_translations section_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_delete ON public.venue_translations AS RESTRICTIVE FOR DELETE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_invitation_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.admin_invitation_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_invitations section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.admin_invitations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_membership_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.admin_membership_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_session_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.admin_session_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admins section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.admins AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: backup_restore_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.backup_restore_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('full'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_configuration_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.event_configuration_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_languages section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.event_languages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_locations section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.event_locations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_sessions section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.event_sessions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_settings section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.event_settings AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('settings'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_translations section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.event_translations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_categories section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.food_categories AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_category_translations section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.food_category_translations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_claims section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.food_claims AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_item_translations section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.food_item_translations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_item_types section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.food_item_types AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_items section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.food_items AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_type_translations section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.food_type_translations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_gateway_rate_limits section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.guest_gateway_rate_limits AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('full'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_session_overrides section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.guest_session_overrides AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_session_responses section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.guest_session_responses AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guests section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.guests AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: household_contacts section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.household_contacts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: household_session_defaults section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.household_session_defaults AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: households section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.households AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_access_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.invitation_access_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_deliveries section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.invitation_deliveries AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_delivery_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.invitation_delivery_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_send_queue section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.invitation_send_queue AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: management_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.management_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: message_templates section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.message_templates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: other_categories section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.other_categories AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('other'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: other_items section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.other_items AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('other'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: relation_groups section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.relation_groups AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_household_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.rsvp_household_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_response_audit section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.rsvp_response_audit AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_submissions section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.rsvp_submissions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: session_translations section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.session_translations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: translation_overrides section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.translation_overrides AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: venue_translations section_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_insert ON public.venue_translations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_invitation_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.admin_invitation_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text) AS admin_has_permission));


--
-- Name: admin_invitations section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.admin_invitations AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text) AS admin_has_permission));


--
-- Name: admin_membership_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.admin_membership_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text) AS admin_has_permission));


--
-- Name: admin_session_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.admin_session_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text) AS admin_has_permission));


--
-- Name: admins section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.admins AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text) AS admin_has_permission));


--
-- Name: backup_restore_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.backup_restore_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('full'::text) AS admin_has_permission));


--
-- Name: event_configuration_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.event_configuration_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('venues'::text) AS admin_has_permission));


--
-- Name: event_languages section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.event_languages AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('languages'::text) AS admin_has_permission));


--
-- Name: event_locations section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.event_locations AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('venues'::text) AS admin_has_permission));


--
-- Name: event_sessions section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.event_sessions AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('venues'::text) AS admin_has_permission));


--
-- Name: event_settings section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.event_settings AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('settings'::text) AS admin_has_permission));


--
-- Name: event_translations section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.event_translations AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('languages'::text) AS admin_has_permission));


--
-- Name: food_categories section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.food_categories AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('food'::text) AS admin_has_permission));


--
-- Name: food_category_translations section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.food_category_translations AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('languages'::text) AS admin_has_permission));


--
-- Name: food_claims section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.food_claims AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('food'::text) AS admin_has_permission));


--
-- Name: food_item_translations section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.food_item_translations AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('languages'::text) AS admin_has_permission));


--
-- Name: food_item_types section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.food_item_types AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('food'::text) AS admin_has_permission));


--
-- Name: food_items section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.food_items AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('food'::text) AS admin_has_permission));


--
-- Name: food_type_translations section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.food_type_translations AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('languages'::text) AS admin_has_permission));


--
-- Name: guest_gateway_rate_limits section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.guest_gateway_rate_limits AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('full'::text) AS admin_has_permission));


--
-- Name: guest_session_overrides section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.guest_session_overrides AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: guest_session_responses section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.guest_session_responses AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: guests section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.guests AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('households'::text) AS admin_has_permission));


--
-- Name: household_contacts section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.household_contacts AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('households'::text) AS admin_has_permission));


--
-- Name: household_session_defaults section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.household_session_defaults AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: households section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.households AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('households'::text) AS admin_has_permission));


--
-- Name: invitation_access_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.invitation_access_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: invitation_deliveries section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.invitation_deliveries AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: invitation_delivery_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.invitation_delivery_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: invitation_send_queue section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.invitation_send_queue AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: management_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.management_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('households'::text) AS admin_has_permission));


--
-- Name: message_templates section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.message_templates AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: other_categories section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.other_categories AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('other'::text) AS admin_has_permission));


--
-- Name: other_items section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.other_items AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('other'::text) AS admin_has_permission));


--
-- Name: relation_groups section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.relation_groups AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('households'::text) AS admin_has_permission));


--
-- Name: rsvp_household_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.rsvp_household_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: rsvp_response_audit section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.rsvp_response_audit AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: rsvp_submissions section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.rsvp_submissions AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('invites'::text) AS admin_has_permission));


--
-- Name: session_translations section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.session_translations AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('languages'::text) AS admin_has_permission));


--
-- Name: translation_overrides section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.translation_overrides AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('languages'::text) AS admin_has_permission));


--
-- Name: venue_translations section_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_read ON public.venue_translations AS RESTRICTIVE FOR SELECT TO authenticated USING (( SELECT public.admin_has_permission('languages'::text) AS admin_has_permission));


--
-- Name: admin_invitation_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.admin_invitation_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_invitations section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.admin_invitations AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_membership_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.admin_membership_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admin_session_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.admin_session_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: admins section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.admins AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('administrators'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: backup_restore_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.backup_restore_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('full'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('full'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_configuration_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.event_configuration_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_languages section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.event_languages AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_locations section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.event_locations AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_sessions section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.event_sessions AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('venues'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_settings section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.event_settings AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('settings'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('settings'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: event_translations section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.event_translations AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_categories section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.food_categories AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_category_translations section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.food_category_translations AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_claims section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.food_claims AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_item_translations section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.food_item_translations AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_item_types section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.food_item_types AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_items section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.food_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('food'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: food_type_translations section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.food_type_translations AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_gateway_rate_limits section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.guest_gateway_rate_limits AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('full'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('full'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_session_overrides section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.guest_session_overrides AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guest_session_responses section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.guest_session_responses AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: guests section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.guests AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: household_contacts section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.household_contacts AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: household_session_defaults section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.household_session_defaults AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: households section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.households AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_access_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.invitation_access_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_deliveries section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.invitation_deliveries AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_delivery_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.invitation_delivery_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: invitation_send_queue section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.invitation_send_queue AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: management_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.management_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: message_templates section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.message_templates AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: other_categories section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.other_categories AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('other'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('other'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: other_items section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.other_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('other'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('other'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: relation_groups section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.relation_groups AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('households'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_household_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.rsvp_household_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_response_audit section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.rsvp_response_audit AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: rsvp_submissions section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.rsvp_submissions AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('invites'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: session_translations section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.session_translations AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: translation_overrides section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.translation_overrides AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: venue_translations section_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY section_update ON public.venue_translations AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission)) WITH CHECK (( SELECT public.admin_has_permission('languages'::text, 'edit'::text) AS admin_has_permission));


--
-- Name: session_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: translation_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.translation_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_translations ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




NOTIFY pgrst, 'reload schema';
-- Operational first-install state; contains no credentials and is not application backup data.
CREATE TABLE app_private.installation_state (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    installation_id uuid NOT NULL,
    schema_version text NOT NULL,
    release_version text NOT NULL,
    installer_hash text NOT NULL CHECK (installer_hash ~ '^[a-f0-9]{64}$'),
    site_url text NOT NULL,
    first_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    admin_email text,
    progress jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(progress) = 'object'),
    initialized_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.installation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.installation_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE app_private.installation_state TO service_role;

-- Only a completion boolean/version are public; never expose setup state or admin identity.
CREATE FUNCTION public.get_setup_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT jsonb_build_object(
  'initialized', EXISTS (SELECT 1 FROM public.admins WHERE access_state='active')
    AND COALESCE((SELECT initialized_at IS NOT NULL FROM app_private.installation_state WHERE id),true),
  'schema_version','20261114034908')
$$;
REVOKE ALL ON FUNCTION public.get_setup_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_setup_status() TO anon,authenticated,service_role;

COMMIT;
