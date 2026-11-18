-- RSVP Manager v0.9.0-alpha.7 to v0.9.0-alpha.8 update for existing installations.
-- Source baseline SHA-256: 3bb0081ebb1512c814c5d0f5aca2f9d1d4c898b83fd28b0f7067ff8742603129
-- Target baseline SHA-256: faa05ba5ec0482758a27ddc88d5cabf214b19a81bb440e917adea17536edae24
-- Save a current Full backup and confirm it can be restored before running this transaction.
-- The release notes cover the separate frontend and Edge Function updates.
BEGIN ISOLATION LEVEL REPEATABLE READ;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = '';
SET LOCAL check_function_bodies = false;
SELECT pg_catalog.pg_advisory_xact_lock(19421, 7744);

DO $source$
DECLARE
 item record;
BEGIN
 IF pg_catalog.to_regclass('public.event_settings') IS NULL
    OR pg_catalog.to_regclass('app_private.installation_state') IS NULL
    OR pg_catalog.to_regclass('public.invitation_shortcut_batches') IS NOT NULL
    OR pg_catalog.to_regclass('app_private.guest_visit_scope') IS NOT NULL
    OR (SELECT cardinality(app_private.backup_tables())) IS DISTINCT FROM 40 THEN
  RAISE EXCEPTION 'Expected the installed alpha.7 schema';
 END IF;
 FOR item IN SELECT * FROM (VALUES
 ('app_private.backup_as_template(jsonb,text[])', '1e7d7375601ecd9854f8b46ae0fbeefd23ff138445dc328d827b00a00c675e45'),
 ('app_private.backup_selected_tables(jsonb)', 'ad980503d7d37b4d47375204a5a8b08c451981e90328855cd728f62a873c4c79'),
 ('app_private.backup_tables()', '8ffd9dd03716b5294a3bf3662c588947107910834bc329cb1cf3fd0d3b6a5942'),
 ('app_private.guest_event()', 'd5b88584e40c35cf873c3767161747ee87b939a4fda6818df46843a0fd43483a'),
 ('app_private.translation_keys()', '87549c698baf257ceae811c0957227a102a4572a9808735df6b3412c6f1bae12'),
 ('app_private.validate_backup(jsonb)', '12508eb747e665343ed2d849afe3026deaa88db277686af95a506313f87fde67'),
 ('public.admin_load_data()', '3dc3375976359c71ed97880505c09e912b15f592c884d9c248547b047d6dd894'),
 ('public.admin_save_delivery(uuid,uuid,jsonb,integer)', 'b93d32692b912670a800ea6585f24a6ceeeac924969b85e84e6a1756ff5137f2'),
 ('public.get_setup_status()', '8a3f88bd78e9cb427f4f4d2c7d9c08c9f52454a6beee6129ddc3127f64c666a8'),
 ('public.admin_replace_event_data(jsonb,text,uuid)', 'd5324974c70c7a88a5dc7d31b33946bd7e4c749e73aeb82c60100c69c7710bf6'),
 ('public.guest_gateway_allow_request(text,text,text)', '9718f352c1cf0a369158ec26a8303dc56cb1615cc2c6fcb95ad623d6f590f197'),
 ('app_private.restore_backup_data(jsonb,boolean)', '7bcb14d02f5e4aa7286636fd72ae93959d8f03cee251ed709039b21cce1474d6'),
 ('public.admin_save_invitation_template(text,text,text,text,jsonb,uuid,uuid)', '55a165848295de72f12a311ecaaefc3a65deba838753cf42373fc59e5cfb86e2')
 ) AS expected(name, hash)
 LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
   WHERE p.oid = pg_catalog.to_regprocedure(item.name)
   AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = item.hash) THEN
   RAISE EXCEPTION 'Upgrade source function does not match: %', item.name;
  END IF;
 END LOOP;
END $source$;

CREATE TEMP TABLE rsvp_alpha8_rows (
 relation_id oid PRIMARY KEY,
 schema_name text NOT NULL,
 table_name text NOT NULL,
 owner_id oid NOT NULL,
 acl pg_catalog.aclitem[],
 rls boolean NOT NULL,
 force_rls boolean NOT NULL,
 row_hash bytea
) ON COMMIT DROP;

CREATE TEMP TABLE rsvp_alpha8_functions ON COMMIT DROP AS
SELECT p.oid, p.proowner, p.proacl, p.prosecdef
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'app_private')
  AND p.oid NOT IN (SELECT pg_catalog.to_regprocedure(name) FROM
      pg_catalog.unnest(ARRAY['app_private.restore_backup_data(jsonb,boolean)', 'public.admin_save_invitation_template(text,text,text,text,jsonb,uuid,uuid)']) AS excluded(name));

CREATE TEMP TABLE rsvp_alpha8_policies ON COMMIT DROP AS
SELECT s.polrelid, s.polname, s.polcmd, s.polpermissive, s.polroles,
       s.polqual::text AS polqual, s.polwithcheck::text AS polwithcheck
FROM pg_catalog.pg_policy AS s
JOIN pg_catalog.pg_class AS c ON c.oid = s.polrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'app_private')
  AND (s.polrelid <> 'public.message_templates'::pg_catalog.regclass
       OR s.polname NOT IN ('invitation_template_delete', 'invitation_template_insert', 'invitation_template_update'));

INSERT INTO pg_temp.rsvp_alpha8_rows (relation_id, schema_name, table_name, owner_id, acl, rls, force_rls)
SELECT c.oid, n.nspname, c.relname, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE (n.nspname IN ('public', 'app_private', 'auth') OR
       (n.nspname = 'storage' AND c.relname IN ('buckets', 'objects')))
 AND c.relkind IN ('r', 'p') AND pg_catalog.has_table_privilege(c.oid, 'SELECT');

DO $lock_tables$
DECLARE item record;
BEGIN
 FOR item IN SELECT * FROM pg_temp.rsvp_alpha8_rows
  WHERE schema_name IN ('public','app_private') ORDER BY schema_name, table_name
 LOOP
  EXECUTE pg_catalog.format('LOCK TABLE %I.%I IN SHARE MODE', item.schema_name, item.table_name);
 END LOOP;
END $lock_tables$;

CREATE TEMP TABLE rsvp_alpha8_template_groups (
 channel text PRIMARY KEY,
 template_key text UNIQUE NOT NULL,
 template_name text NOT NULL
) ON COMMIT DROP;
INSERT INTO pg_temp.rsvp_alpha8_template_groups (channel, template_key, template_name)
SELECT channel, 'invitation:' || pg_catalog.gen_random_uuid()::text,
 CASE channel
  WHEN 'email' THEN 'Email invitation'
  WHEN 'sms' THEN 'SMS invitation'
  WHEN 'whatsapp' THEN 'WhatsApp invitation'
  ELSE 'Manual / Messenger invitation'
 END
FROM (SELECT DISTINCT channel FROM public.message_templates WHERE template_key = 'invitation') AS legacy_channels;

DO $before_rows$
DECLARE
 item record;
 digest bytea;
 source_rows text;
BEGIN
 FOR item IN SELECT * FROM pg_temp.rsvp_alpha8_rows ORDER BY schema_name, table_name
 LOOP
  source_rows := CASE
   WHEN item.relation_id = 'public.message_templates'::pg_catalog.regclass THEN
    'SELECT CASE WHEN t.template_key = ''invitation''
          THEN pg_catalog.to_jsonb(t) || pg_catalog.jsonb_build_object(
            ''channel'', ''manual'', ''template_key'', g.template_key,
            ''template_name'', g.template_name, ''delivery_channels'', ARRAY[t.channel])
          ELSE pg_catalog.to_jsonb(t) || ''{"template_name":null,"delivery_channels":null}''::pg_catalog.jsonb
         END AS payload
     FROM public.message_templates AS t
     LEFT JOIN pg_temp.rsvp_alpha8_template_groups AS g ON g.channel = t.channel'
   ELSE pg_catalog.format('SELECT pg_catalog.to_jsonb(t) AS payload FROM %I.%I AS t', item.schema_name, item.table_name)
  END;
  EXECUTE 'SELECT pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(row_hash, '''' ORDER BY row_hash), ''''), ''UTF8'')) FROM
     (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(payload::text, ''UTF8'')), ''hex'') AS row_hash FROM ('
     || source_rows || ') AS rows) AS hashes'
   INTO digest;
  UPDATE pg_temp.rsvp_alpha8_rows SET row_hash = digest WHERE relation_id = item.relation_id;
 END LOOP;
END $before_rows$;

ALTER TABLE public.event_settings ADD COLUMN guest_interface_modes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.message_templates
 ADD COLUMN template_name text,
 ADD COLUMN delivery_channels text[],
 ADD COLUMN content_options text[],
 ADD COLUMN short_body text;
ALTER TABLE app_private.restore_safety_receipts
 ADD COLUMN operation text NOT NULL DEFAULT 'replace' CHECK (operation IN ('replace', 'wipe', 'clear'));

UPDATE public.message_templates AS t
SET template_key = g.template_key, template_name = g.template_name, delivery_channels = ARRAY[t.channel], channel = 'manual'
FROM pg_temp.rsvp_alpha8_template_groups AS g
WHERE t.template_key = 'invitation' AND g.channel = t.channel;

DROP POLICY invitation_template_delete ON public.message_templates;
DROP POLICY invitation_template_insert ON public.message_templates;
DROP POLICY invitation_template_update ON public.message_templates;

DROP FUNCTION app_private.restore_backup_data(jsonb, boolean);
DROP FUNCTION public.admin_save_invitation_template(text, text, text, text, jsonb, uuid, uuid);


CREATE OR REPLACE FUNCTION app_private.backup_as_template(b jsonb, sections text[]) RETURNS jsonb
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
    'late_submission_until',NULL,'visited',false,'visited_at',NULL,'first_visited_at',NULL,'last_visited_at',NULL,'visit_count','0',
    'food_confirmed',false,'food_confirmed_at',NULL,'food_interest',NULL
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

CREATE OR REPLACE FUNCTION app_private.backup_selected_tables(selection jsonb) RETURNS text[]
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
  IF live THEN selected:=selected||ARRAY['public.rsvp_submissions','public.guest_session_responses','public.invitation_send_queue','public.invitation_deliveries','public.invitation_shortcut_batches','public.invitation_shortcut_items','public.invitation_shortcut_attempts','app_private.invitation_code_registry'];END IF;
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

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_item_types','public.food_groups','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_shortcut_batches','public.invitation_shortcut_items','public.invitation_shortcut_attempts',
 'public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'public.food_item_translations','public.food_category_translations','public.food_type_translations','public.venue_translations','public.session_translations','public.event_translations','public.translation_overrides','app_private.invitation_code_registry']::text[]
$$;

CREATE OR REPLACE FUNCTION app_private.guest_event() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 SELECT jsonb_build_object('event',(to_jsonb(e)-'notification_preferences'-'invitation_picture_album'-'guest_interface_modes')||jsonb_build_object('guest_interface_modes',app_private.public_guest_interface_modes(e.guest_interface_modes),'notification_preferences',jsonb_build_object('guest',e.notification_preferences->'guest'),'food_interest_reply',coalesce((SELECT jsonb_object_agg(language_code,body) FROM public.message_templates WHERE template_key='food-interest-reply' AND channel='manual' AND is_active),'{}'),'food_interest_reply_fallback',coalesce((SELECT jsonb_object_agg(language_code,body) FROM public.message_templates WHERE template_key='food-interest-reply-no-deadline' AND channel='manual' AND is_active),'{}'))-'planning_config',
 'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order),'[]') FROM public.event_sessions s WHERE s.is_active),
 'locations',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order),'[]') FROM public.event_locations l WHERE l.archived_at IS NULL),
 'content',(SELECT coalesce(jsonb_object_agg(c.language_code,c.content_value),'{}') FROM public.event_content c WHERE c.content_key='welcome'),
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.event_content c WHERE c.content_key NOT LIKE 'ui:%' AND (e.food_enabled AND e.food_stage='selection' OR (c.content_key NOT LIKE 'food:%' AND c.content_key NOT LIKE 'food-category:%'))))
 FROM public.event_settings e WHERE e.id=1
$$;

CREATE FUNCTION app_private.restore_backup_data(b jsonb, replace_event boolean, wipe boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE t text;row jsonb;rows jsonb;payload jsonb:=b->'payload';report jsonb;has_rows boolean;cols text;fk record;source_id text;target_id uuid;identity jsonb;mapping jsonb:='{}';rec record;seq text;next_id bigint;changed integer:=0;selected_tables text[]:=app_private.backup_tables();destination_url text;provenance jsonb:='[]';
BEGIN
 report:=app_private.validate_backup(b);
 IF wipe THEN PERFORM app_private.require_wipe(b);PERFORM pg_advisory_xact_lock(42319,11);SELECT website_url INTO destination_url FROM public.event_settings WHERE id=1;LOCK TABLE public.admins IN SHARE ROW EXCLUSIVE MODE;ELSIF replace_event THEN PERFORM app_private.require_event_replacement(b);selected_tables:=app_private.event_replacement_tables();END IF;
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
 IF NOT replace_event THEN
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF t IN ('public.event_languages','public.event_settings') THEN CONTINUE;END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',t) INTO has_rows;
  IF has_rows THEN RAISE EXCEPTION 'Restore requires an empty application destination; % contains records',t;END IF;
 END LOOP;
 END IF;
 -- Map actors without restoring current administrator security state.
 FOREACH t IN ARRAY selected_tables LOOP
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
    source_id:=row->>fk.attname;IF source_id IS NULL OR mapping ? source_id THEN CONTINUE;END IF;
    SELECT u INTO identity FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=source_id;
    IF identity IS NULL THEN RAISE EXCEPTION 'Missing actor identity metadata';END IF;
    IF replace_event AND NOT wipe THEN SELECT id INTO target_id FROM auth.users WHERE id=source_id::uuid;ELSE SELECT id INTO target_id FROM auth.users WHERE lower(email)=lower(identity->>'email') AND email_confirmed_at IS NOT NULL;END IF;
    IF target_id IS NULL AND wipe THEN target_id:=auth.uid();END IF;
    IF target_id IS NULL THEN RAISE EXCEPTION 'Recreate and verify the historical actor account % before restoring',identity->>'email';END IF;
    mapping:=mapping||jsonb_build_object(source_id,target_id);
   END LOOP;
  END LOOP;
 END LOOP;
 -- Disable only application triggers, transactionally, so imports do not regenerate
 -- invitation codes, create synthetic history, or reject valid out-of-order parents.
 -- Foreign keys, types, unique constraints and CHECK constraints stay enforced.
 FOREACH t IN ARRAY selected_tables LOOP EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER',t);END LOOP;
 -- Include operational FK dependants explicitly; TRUNCATE must name even an
 -- empty referencing table. Never use CASCADE across the restore boundary.
 IF replace_event THEN EXECUTE 'TRUNCATE TABLE '||array_to_string(selected_tables,',')||',app_private.invitation_shortcut_capabilities,app_private.invitation_shortcut_leases,app_private.guest_visit_receipts'||CASE WHEN wipe THEN ',app_private.pending_admin_permissions' ELSE '' END;END IF;
 DELETE FROM public.event_settings WHERE id=1;
 DELETE FROM public.event_languages WHERE language_code IN (SELECT language_code FROM public.event_languages);
 FOREACH t IN ARRAY selected_tables LOOP
  rows:='[]';
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
    source_id:=row->>fk.attname;IF source_id IS NOT NULL THEN
    IF wipe AND mapping->>source_id IS DISTINCT FROM source_id THEN provenance:=provenance||jsonb_build_array(jsonb_build_object('table',t,'record_id',row->>'id','field',fk.attname,'source_actor',source_id,'destination_actor',mapping->source_id));END IF;
    row:=jsonb_set(row,ARRAY[fk.attname],mapping->source_id);END IF;
   END LOOP;
   IF t='public.admin_membership_audit' THEN FOREACH source_id IN ARRAY ARRAY['actor_id','subject_id'] LOOP IF mapping ? (row->>source_id) THEN row:=jsonb_set(row,ARRAY[source_id],mapping->(row->>source_id));END IF;END LOOP;END IF;
   IF t='public.households' THEN row:=row||'{"parent_id":null,"latest_rsvp_submission_id":null,"primary_guest_id":null}'::jsonb;END IF;

  IF t='public.event_settings' THEN row:=row||jsonb_build_object('is_published',false);IF wipe THEN row:=row||jsonb_build_object('website_url',destination_url);END IF;END IF;

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
 FOREACH t IN ARRAY selected_tables LOOP EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER',t);END LOOP;
 -- Re-run hierarchy and language guards without changing profile values or history.
 UPDATE public.households SET parent_id=parent_id WHERE id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(payload->'tables'->'public.households'));
 UPDATE public.event_settings SET default_language=default_language,fallback_language=fallback_language WHERE id=1;
 IF EXISTS(SELECT 1 FROM public.households h WHERE (h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)) AND h.invite_code IS NOT NULL) THEN RAISE EXCEPTION 'Backup contains an invalid invitation code assignment';END IF;
 IF EXISTS(SELECT 1 FROM public.households h WHERE h.invite_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_private.invitation_code_registry r WHERE r.code=h.invite_code AND r.household_id=h.id)) THEN RAISE EXCEPTION 'Invitation code registry mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE (SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=f.id)>f.quantity_needed) THEN RAISE EXCEPTION 'Food claims exceed available quantities';END IF;
 -- Restart identity sequences with transactional ALTER, not nontransactional setval.
 FOREACH t IN ARRAY selected_tables LOOP
  FOR rec IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND attidentity<>'' LOOP
   seq:=pg_get_serial_sequence(t,rec.attname);EXECUTE format('SELECT coalesce(max(%I),0)+1 FROM %s',rec.attname,t) INTO next_id;
   EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
  END LOOP;
 END LOOP;
 -- Operational bearers are installation-local, never backup data. Rotate both
 -- scopes even for an empty/Partial restore so a pre-restore bearer cannot act
 -- against a restored draft or invitation code. Rehearsals roll this back too.
 PERFORM app_private.revoke_shortcut_capabilities();
 PERFORM app_private.revoke_guest_visit_receipts();
 DELETE FROM app_private.restore_safety_receipts WHERE id IS NOT NULL;
 IF wipe THEN FOR target_id IN SELECT user_id FROM public.admins WHERE user_id<>auth.uid() ORDER BY user_id LOOP PERFORM public.admin_set_member_state(target_id,'suspended');END LOOP;END IF;
 INSERT INTO public.backup_restore_audit(actor_user_id,checksum,source_created_at,restored_counts) VALUES(auth.uid(),b->>'checksum',(payload->>'created_at')::timestamptz,(payload->'counts')||CASE WHEN wipe THEN jsonb_build_object('_source_identities',payload->'identities','_identity_mapping',mapping,'_actor_provenance',provenance) ELSE '{}'::jsonb END);
 IF NOT replace_event THEN
 FOR identity IN SELECT value FROM jsonb_array_elements(coalesce(payload->'administrator_reference','[]'::jsonb)) LOOP
 SELECT u.id INTO target_id FROM auth.users u JOIN jsonb_array_elements(payload->'identities') i ON lower(i->>'email')=lower(u.email) WHERE i->>'id'=identity->>'user_id' AND u.email_confirmed_at IS NOT NULL;
 IF target_id IS NOT NULL THEN INSERT INTO public.admins(user_id,name,access_state,access_permissions) VALUES(target_id,left(coalesce(nullif(identity->>'name',''),'Restored administrator'),120),'restored',app_private.permission_preset('view')) ON CONFLICT(user_id) DO NOTHING;END IF;
 END LOOP;
 END IF;
 RETURN report||jsonb_build_object('restored',true,'is_published',false,'identity_mapping',mapping,'administrator_access_restored',false);
END $_$;

CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$SELECT '{"Top-level group":"interface.messages.top_level_group","Event planning":"interface.messages.event_planning","Event preset":"interface.messages.event_preset","Wedding":"interface.messages.event_preset_wedding","Reunion":"interface.messages.event_preset_reunion","Conference":"interface.messages.event_preset_conference","Use preset suggestions":"interface.messages.event_apply_preset","Preset suggestions add missing groups and fill blank labels. Review them before saving.":"interface.messages.event_preset_help","Shared labels":"interface.messages.event_shared_labels","Move group up":"interface.messages.event_move_group_up","Move group down":"interface.messages.event_move_group_down","Remove group":"interface.messages.event_remove_group","Add group":"interface.messages.event_add_group","Save planning settings":"interface.messages.event_save_planning","Family":"interface.messages.event_group_family","Friends":"interface.messages.event_group_friends","Attendees":"interface.messages.event_group_attendees","Speakers":"interface.messages.event_group_speakers","Bookings":"interface.messages.event_label_bookings","Participants":"interface.messages.event_label_participants","Review RSVP":"interface.messages.rsvp_review","Check the answers for each guest and session. Confirming locks the RSVP.":"interface.messages.rsvp_review_help","Confirm RSVP":"interface.messages.rsvp_confirm","Back to edit":"interface.messages.rsvp_back_to_edit","Apply to everyone invited":"interface.messages.rsvp_apply_to_everyone","Fills unanswered choices only.":"interface.messages.rsvp_fill_unanswered_only","Enable access":"interface.messages.access_enable_access","Suspend access":"interface.messages.access_suspend_access","Revoke session":"interface.messages.access_revoke_session","Session refreshed":"interface.messages.access_session_refreshed","{browser} on {device}":"interface.messages.access_session_browser_device","Apple device":"interface.messages.access_session_apple_device","Session refreshed shows when the sign-in session last renewed. Revocation ends access to this application. Everyone can revoke their own sessions.":"interface.messages.access_session_refresh_help","Permanently delete {name}?":"interface.messages.confirm_delete_named_record","Remove assignment for {household}":"interface.messages.remove_named_assignment","Remove {household}’s assignment for {item}?":"interface.messages.confirm_remove_food_assignment","Show to guests":"interface.messages.show_to_guests","Hide from guests":"interface.messages.hide_from_guests","Hidden from guests":"interface.messages.hidden_from_guests","(preview)":"interface.messages.preview_marker","Unpublished · Guest preview only":"interface.messages.unpublished_preview_only","Invitation delivery opens when the event is published.":"interface.messages.delivery_requires_publication","Delete household":"interface.messages.delete_household","Delete guest":"interface.messages.delete_guest","Permanently delete this record?":"interface.messages.confirm_delete_record","Record deleted.":"interface.messages.record_deleted","Choose a record that can be deleted.":"interface.messages.choose_deletable_record","Move or delete guests and child households first.":"interface.messages.delete_move_dependents","Remove this guest’s household contact assignments first.":"interface.messages.delete_remove_contact_assignments","Restore mode":"interface.messages.restore_mode","Full backup":"interface.messages.restore_full_backup","Planning template":"interface.messages.restore_planning_template","Include in template":"interface.messages.restore_template_include","Event settings and languages are always included. Invitation codes, replies, food commitments, delivery history and administrator records are cleared.":"interface.messages.restore_template_info","Wording & invitation templates":"interface.messages.restore_template_wording","Guest preview":"interface.messages.guest_preview","Test changes stay in this tab and are discarded when you close or reload it.":"interface.messages.guest_preview_discard","Preview as":"interface.messages.guest_preview_as","Copy preview link":"interface.messages.guest_preview_copy","Sign in to preview":"interface.messages.guest_preview_sign_in","Preview link":"interface.messages.guest_preview_link","Preview link copied.":"interface.messages.guest_preview_copied","Sign in with an administrator account to open this preview.":"interface.messages.guest_preview_login_required","Guest preview requires access to Households, Invites, Venues and Food.":"interface.messages.guest_preview_access","Guest landing page":"interface.messages.guest_preview_landing","Sample household":"interface.messages.guest_preview_sample","Preview response confirmed.":"interface.messages.guest_preview_response","Preview food selection updated.":"interface.messages.guest_preview_food_updated","Preview food selection confirmed.":"interface.messages.guest_preview_food_confirmed","Templates":"interface.messages.templates","Invitation templates":"interface.messages.invitation_templates","Set the starting wording for new invitation drafts by language and delivery channel.":"interface.messages.invitation_templates_description","No custom template. New drafts use fallback wording.":"interface.messages.invitation_template_fallback","Include the invitation link placeholder. Clear the fields to use fallback wording.":"interface.messages.invitation_template_help","Save template":"interface.messages.save_invitation_template","Include the invitation link placeholder in the message.":"interface.messages.invitation_template_link_required","The invitation template contains an unknown placeholder.":"interface.messages.invitation_template_unknown_placeholder","Back to households":"interface.messages.back_to_households","Administration":"interface.messages.administration","Admin":"interface.messages.admin","Event Invitation":"interface.messages.event_invitation","Event dashboard":"interface.messages.event_dashboard","Appearance":"interface.messages.appearance","Appearance preference":"interface.messages.appearance_preference","System default":"interface.messages.system_default","Light":"interface.messages.light","Dark":"interface.messages.dark","Language":"interface.messages.language","Faroese":"interface.messages.faroese","English":"interface.messages.english","German":"interface.messages.german","Settings":"interface.messages.settings","Settings sections":"interface.messages.settings_sections","Main settings":"interface.messages.main_settings","Event settings":"interface.messages.event_settings","Administrators":"interface.messages.administrators","Administrator":"interface.messages.administrator","Administrator actions":"interface.messages.administrator_actions","Admin sections":"interface.messages.admin_sections","Overview":"interface.messages.overview","Households":"interface.messages.households","Guests":"interface.messages.guests","Manage Invites":"interface.messages.manage_invites","Venues":"interface.messages.venues","Sessions":"interface.messages.sessions","Sessions & scheduling":"interface.messages.sessions_scheduling","Logs":"interface.messages.logs","Back":"interface.messages.back","Back to dashboard":"interface.messages.back_to_dashboard","View website in a new tab":"interface.messages.view_website_in_a_new_tab","Refresh data":"interface.messages.refresh_data","Sign out":"interface.messages.sign_out","Sign in":"interface.messages.sign_in","Email":"interface.messages.email","Password":"interface.messages.password","PRIVATE ADMINISTRATION":"interface.messages.private_administration","Welcome back.":"interface.messages.welcome_back","Only approved event administrators can sign in.":"interface.messages.only_approved_event_administrators_can_sign_in","Setup wizard":"interface.messages.setup_wizard","New password":"interface.messages.new_password","Confirm password":"interface.messages.confirm_password","You’re invited.":"interface.messages.you_re_invited","Accept administrator invitation":"interface.messages.accept_administrator_invitation","Accepting invitation…":"interface.messages.accepting_invitation","Accepting gives you access to this event’s households, guests, invitations and settings.":"interface.messages.accepting_gives_you_access_to_this_event_s_households_guests_invi","Set a password of at least 12 characters for future sign-ins.":"interface.messages.set_a_password_of_at_least_12_characters_for_future_sign_ins","Event name":"interface.messages.event_name","Type":"interface.messages.type","Date":"interface.messages.date","Default language":"interface.messages.default_language","Timezone":"interface.messages.timezone","Website URL":"interface.messages.website_url","RSVP deadline (local browser time)":"interface.messages.rsvp_deadline_local_browser_time","Save settings":"interface.messages.save_settings","Publish event":"interface.messages.publish_event","Unpublish event":"interface.messages.unpublish_event","Event is published: invited guests can access RSVP. You can unpublish it below.":"interface.messages.event_is_published_invited_guests_can_access_rsvp_you_can_unpubli","Use View mode to inspect configuration and Edit mode to make changes. Publication controls are below.":"interface.messages.use_view_mode_to_inspect_configuration_and_edit_mode_to_make_chan","Publishing makes the guest RSVP experience available. The website can be online while the event is unpublished. Complete access-control and invite-code release tests before publishing.":"interface.messages.publishing_makes_the_guest_rsvp_experience_available_the_website_","I understand the release checks are my responsibility and this will open the event to invited guests.":"interface.messages.i_understand_the_release_checks_are_my_responsibility_and_this_wi","Manage locations, addresses and local timezones. Guests can attend sessions at more than one venue.":"interface.messages.manage_locations_addresses_and_local_timezones_guests_can_attend_","Set each session’s venue and local times. Use Manage Invites for household invitations and individual exceptions.":"interface.messages.set_each_session_s_venue_and_local_times_use_manage_invites_for_h","Invite trusted people to help manage this event. Access starts after they verify their email and accept.":"interface.messages.invite_trusted_people_to_help_manage_this_event_access_starts_aft","Invite administrator":"interface.messages.invite_administrator","Open Supabase Auth":"interface.messages.open_supabase_auth","Display name":"interface.messages.display_name","Send invitation":"interface.messages.send_invitation","Pending invitations":"interface.messages.pending_invitations","An email will be sent to this address. The recipient must accept within 7 days; email sign-in links may expire sooner.":"interface.messages.an_email_will_be_sent_to_this_address_the_recipient_must_accept_w","Resend":"interface.messages.resend","Cancel":"interface.messages.cancel","Awaiting acceptance":"interface.messages.awaiting_acceptance","No pending invitations.":"interface.messages.no_pending_invitations","Sending invitation…":"interface.messages.sending_invitation","Administrator invitation email sent.":"interface.messages.administrator_invitation_email_sent","Administrator invitation cancelled.":"interface.messages.administrator_invitation_cancelled","Administrator invitation accepted.":"interface.messages.administrator_invitation_accepted","Revoke administrator access":"interface.messages.revoke_administrator_access","Administrator access revoked.":"interface.messages.administrator_access_revoked","You cannot remove the last administrator.":"interface.messages.you_cannot_remove_the_last_administrator","Search":"interface.messages.search","Category":"interface.messages.category","Action":"interface.messages.action","From":"interface.messages.from","Through":"interface.messages.through","All categories":"interface.messages.all_categories","All actions":"interface.messages.all_actions","Search logs":"interface.messages.search_logs","Reset":"interface.messages.reset","Load older entries":"interface.messages.load_older_entries","Search recorded changes, RSVP activity, invitation delivery and administrator sessions.":"interface.messages.search_recorded_changes_rsvp_activity_invitation_delivery_and_adm","Household, guest, administrator or change":"interface.messages.household_guest_administrator_or_change","Contacts":"interface.messages.contacts","Invitations":"interface.messages.invitations","Login":"interface.messages.login","Loading logs…":"interface.messages.loading_logs","No log entries match these filters.":"interface.messages.no_log_entries_match_these_filters","Field":"interface.messages.field","Before":"interface.messages.before","After":"interface.messages.after","Reference: ":"interface.messages.reference","Showing ":"interface.messages.showing","Date filters use the event timezone. Entries show your local time. Expand an entry for its UTC time and details. Household and guest archive, restore and deletion are logged.":"interface.messages.date_filters_use_the_event_timezone_entries_show_your_local_time_","Existing history is included. New sign-in and invitation-opening records start with this update. Repeated opens within 15 minutes are grouped.":"interface.messages.existing_history_is_included_new_sign_in_and_invitation_opening_r","Launch checklist":"interface.messages.launch_checklist","Admin account connected":"interface.messages.admin_account_connected","Event name and date entered":"interface.messages.event_name_and_date_entered","At least one session created":"interface.messages.at_least_one_session_created","Invitations assigned":"interface.messages.invitations_assigned","Website connection in deployed config.js":"interface.messages.website_connection_in_deployed_config_js","Website address saved in event settings":"interface.messages.website_address_saved_in_event_settings","Event published":"interface.messages.event_published","New RSVP submissions":"interface.messages.new_rsvp_submissions","Add household":"interface.messages.add_household","Add guest":"interface.messages.add_guest","Add Contact":"interface.messages.add_contact","OR":"interface.messages.contact_alternative_or","From your household":"interface.messages.primary_contact_from_household","From guest list":"interface.messages.primary_contact_from_guest_list","New contact":"interface.messages.primary_contact_new","Matching contact details required":"interface.messages.matching_contact_details_required","No household contacts to choose from.":"interface.messages.no_household_contact_choices","Use Email with an email address, or SMS or WhatsApp with a phone number.":"interface.messages.primary_contact_delivery_help","Edit primary contact":"interface.messages.edit_primary_contact","Remove primary contact":"interface.messages.remove_primary_contact","Choose a saved contact":"interface.messages.choose_saved_contact","Use contact":"interface.messages.use_contact","Add venue":"interface.messages.add_venue","Add session":"interface.messages.add_session","Add category":"interface.messages.add_category","Household or guest":"interface.messages.household_or_guest","Show archived records":"interface.messages.show_archived_records","⌄ Expand all":"interface.messages.expand_all","› Collapse all":"interface.messages.collapse_all","Click a household to expand its individual guests. Select the top-right pencil to enable editing; each guest then has a pencil for their details. Parent–child household nesting is preserved.":"interface.messages.click_a_household_to_expand_its_individual_guests_select_the_top_","Empty households have no invitation code. Add a guest, then use Manage Invites. Assign sessions in Settings.":"interface.messages.empty_households_have_no_invitation_code_add_a_guest_then_use_man","Household name":"interface.messages.household_name","Household language":"interface.messages.household_language","Household email":"interface.messages.household_email","Household phone":"interface.messages.household_phone","Landline":"interface.messages.household_landline","Household notes":"interface.messages.household_notes","Household details":"interface.messages.household_details","Household contact details":"interface.messages.household_contact_details","Household default":"interface.messages.household_default","Parent household":"interface.messages.parent_household","Child households":"interface.messages.child_households","Grouping household":"interface.messages.grouping_household","None (top level)":"interface.messages.none_top_level","Relation group":"interface.messages.relation_group","Relation":"interface.messages.relation","Notes":"interface.messages.notes","Phone":"interface.messages.phone","Postal address":"interface.messages.postal_address","Preferred contact":"interface.messages.preferred_contact","Preferred contact method":"interface.messages.preferred_contact_method","Preferred delivery method":"interface.messages.preferred_delivery_method","First name":"interface.messages.first_name","Last name":"interface.messages.last_name","Title":"interface.messages.title","None":"interface.messages.none","Son":"interface.messages.son","Daughter":"interface.messages.daughter","Child":"interface.messages.child","Child guest":"interface.messages.child_guest","Dietary requirements":"interface.messages.dietary_requirements","Individual guests":"interface.messages.individual_guests","Unnamed guest":"interface.messages.unnamed_guest","Unnamed household":"interface.messages.unnamed_household","Ungrouped":"interface.messages.ungrouped","No matching households.":"interface.messages.no_matching_households","No guests assigned to this household.":"interface.messages.no_guests_assigned_to_this_household","No active guests match this search.":"interface.messages.no_active_guests_match_this_search","Search guests":"interface.messages.search_guests","Guest name or household":"interface.messages.guest_name_or_household","Guest":"interface.messages.guest","Save household":"interface.messages.save_household","Create household":"interface.messages.create_household","Save guest":"interface.messages.save_guest","Move guest":"interface.messages.move_guest","Destination household":"interface.messages.destination_household","Choose household":"interface.messages.choose_household","Move household up":"interface.messages.move_household_up","Move household down":"interface.messages.move_household_down","New guests inherit this household’s session invitations.":"interface.messages.new_guests_inherit_this_household_s_session_invitations","RSVP status and household assignment are not changed by editing guest details.":"interface.messages.rsvp_status_and_household_assignment_are_not_changed_by_editing_g","Current session invitations are preserved as individual overrides. Moves involving RSVP history are blocked.":"interface.messages.current_session_invitations_are_preserved_as_individual_overrides","Move this guest and preserve their current session invitations?":"interface.messages.move_this_guest_and_preserve_their_current_session_invitations","Grouping changes with child households require moving the children first.":"interface.messages.grouping_changes_with_child_households_require_moving_the_childre","First name is required.":"interface.messages.first_name_is_required","Guest details saved.":"interface.messages.guest_details_saved","Changes saved.":"interface.messages.changes_saved","Household order saved.":"interface.messages.household_order_saved","Edit":"interface.messages.edit","Delete":"interface.messages.delete","Delete archived household":"interface.messages.delete_archived_household","Delete archived guest":"interface.messages.delete_archived_guest","Permanently delete this archived record?":"interface.messages.confirm_delete_archived_record","Archived record deleted.":"interface.messages.archived_record_deleted","This record is linked to other records or history and must stay archived":"interface.messages.archived_record_linked","Rename":"interface.messages.rename","Archive ":"interface.messages.archive","Restore ":"interface.messages.restore","Edit guest: ":"interface.messages.edit_guest","Edit household: ":"interface.messages.edit_household","Select guest: ":"interface.messages.select_guest","Edit contact: ":"interface.messages.edit_contact","Archive this household and disable its invitation link? Records and history are preserved.":"interface.messages.archive_this_household_and_disable_its_invitation_link_records_an","Archive this record? It can be restored later.":"interface.messages.archive_this_record_it_can_be_restored_later","Restore this record?":"interface.messages.restore_this_record","Record archived.":"interface.messages.record_archived","Record restored.":"interface.messages.record_restored","Contact":"interface.messages.contact","Contact name":"interface.messages.contact_name","Contact type":"interface.messages.contact_type","Contact details":"interface.messages.contact_details","Contact language":"interface.messages.contact_language","Linked guest":"interface.messages.linked_guest","Remove guest link":"interface.messages.remove_guest_link","Primary":"interface.messages.primary","Primary contact for this type":"interface.messages.primary_contact_for_this_type","Save contact":"interface.messages.save_contact","Create contact":"interface.messages.create_contact","No contacts added yet.":"interface.messages.no_contacts_added_yet","Choose someone from the guest list":"interface.messages.choose_someone_from_the_guest_list","Choose a guest or enter a new contact below. Guest selection fills the name, language and household’s preferred delivery method and contact details. Review them before saving.":"interface.messages.choose_a_guest_or_enter_a_new_contact_below_guest_selection_fills","Private codes and links for households with guests. Sending remains manual.":"interface.messages.private_codes_and_links_for_households_with_guests_sending_remain","Search invitations":"interface.messages.search_invitations","Invitation code":"interface.messages.invitation_code","Copy invitation link":"interface.messages.copy_invitation_link","Link":"interface.messages.invite_copy_link_short","Copy invite code":"interface.messages.copy_invite_code","Copy link":"interface.messages.copy_link","Copy message":"interface.messages.copy_message","Invitation code copied.":"interface.messages.invitation_code_copied","Invitation link copied.":"interface.messages.invitation_link_copied","Message copied.":"interface.messages.message_copied","No matching invitations. Empty and archived households have no active invitation.":"interface.messages.no_matching_invitations_empty_and_archived_households_have_no_act","Delivery log":"interface.messages.delivery_log","Invitation delivery":"interface.messages.invitation_delivery","Filter delivery status":"interface.messages.filter_delivery_status","All statuses":"interface.messages.all_statuses","Draft":"interface.messages.draft","Ready":"interface.messages.ready","Ready to send":"interface.messages.ready_to_send","Failed":"interface.messages.failed","Cancelled":"interface.messages.cancelled","Recorded sent":"interface.messages.recorded_sent","No deliveries match this status.":"interface.messages.no_deliveries_match_this_status","No delivery recorded yet.":"interface.messages.no_delivery_recorded_yet","Prepare delivery":"interface.messages.prepare_delivery","Delivery channel":"interface.messages.delivery_channel","Delivery recipient":"interface.messages.delivery_recipient","Delivery status":"interface.messages.delivery_status","Message subject":"interface.messages.message_subject","Message text":"interface.messages.message_text","Delivery change note":"interface.messages.delivery_change_note","Create delivery draft":"interface.messages.create_delivery_draft","Save delivery changes":"interface.messages.save_delivery_changes","Edit delivery":"interface.messages.edit_delivery","Record as sent":"interface.messages.record_as_sent","Sent note":"interface.messages.sent_note","I sent this message to the displayed recipient":"interface.messages.i_sent_this_message_to_the_displayed_recipient","Manual":"interface.messages.manual","Manual / in person":"interface.messages.manual_in_person","Postal":"interface.messages.postal","Other":"interface.messages.other","Recipient: ":"interface.messages.recipient","To: ":"interface.messages.to","Manually recorded as sent · ":"interface.messages.manually_recorded_as_sent","Missing — add contact details before marking ready.":"interface.messages.missing_add_contact_details_before_marking_ready","Saving a draft or marking it ready does not send a message. Review the recipient and text, send it yourself, then record it as sent.":"interface.messages.saving_a_draft_or_marking_it_ready_does_not_send_a_message_review","RSVP management":"interface.messages.rsvp_management","Remove assignment":"interface.messages.remove_assignment","Unsaved":"interface.messages.unsaved","RSVP":"interface.messages.rsvp_action","Locked":"interface.messages.rsvp_locked","Current response":"interface.messages.current_response","Choose response":"interface.messages.choose_response","Corrected response":"interface.messages.corrected_response","Correct response: ":"interface.messages.correct_response","Attending":"interface.messages.attending","Not attending":"interface.messages.not_attending","Pending":"interface.messages.pending","RSVP required":"interface.messages.rsvp_required","Information only":"interface.messages.information_only","Locked after submission":"interface.messages.locked_after_submission","Open for responses":"interface.messages.open_for_responses","Reason for RSVP correction":"interface.messages.reason_for_rsvp_correction","Save correction":"interface.messages.save_correction","This updates the current response and records the reason. The original submission and household lock are preserved.":"interface.messages.this_updates_the_current_response_and_records_the_reason_the_orig","Reopen RSVP":"interface.messages.reopen_rsvp","Reason for reopening":"interface.messages.reason_for_reopening","Reopen this household’s RSVP while preserving its submission history?":"interface.messages.reopen_this_household_s_rsvp_while_preserving_its_submission_hist","Reopening lets the household submit again. Previous submissions remain in history. If the event deadline has passed, grant a late-response window after reopening.":"interface.messages.reopening_lets_the_household_submit_again_previous_submissions_re","Allow a late response":"interface.messages.allow_a_late_response","Allow late response":"interface.messages.allow_late_response","Allow responses until (":"interface.messages.allow_responses_until","Reason for late response":"interface.messages.reason_for_late_response","No active RSVP sessions are assigned to this household.":"interface.messages.no_active_rsvp_sessions_are_assigned_to_this_household","Invitations are protected because this household has RSVP history.":"interface.messages.invitations_are_protected_because_this_household_has_rsvp_history","Grouped by category. Switch to Edit to sort, rename, or update items. Existing claims are preserved.":"interface.messages.grouped_by_category_switch_to_edit_to_sort_rename_or_update_items","Category name":"interface.messages.category_name","New category name":"interface.messages.new_category_name","Register category":"interface.messages.register_category","Register existing category":"interface.messages.register_existing_category","Move category up":"interface.messages.move_category_up","Move category down":"interface.messages.move_category_down","Category for ":"interface.messages.category_for","Faroese name":"interface.messages.faroese_name","English name":"interface.messages.english_name","German name":"interface.messages.german_name","Faroese description":"interface.messages.faroese_description","English description":"interface.messages.english_description","German description":"interface.messages.german_description","Quantity needed":"interface.messages.quantity_needed","Display order":"interface.messages.display_order","Available for guests":"interface.messages.available_for_guests","Uncategorized":"interface.messages.uncategorized","Unnamed item":"interface.messages.unnamed_item","Not registered":"interface.messages.not_registered","Faroese name is required.":"interface.messages.faroese_name_is_required","Enter a non-negative quantity.":"interface.messages.enter_a_non_negative_quantity","Category order saved.":"interface.messages.category_order_saved","Category registered.":"interface.messages.category_registered","Session":"interface.messages.session","Session name":"interface.messages.session_name","Session key":"interface.messages.session_key","Session venue":"interface.messages.session_venue","Active session":"interface.messages.active_session","Starts (venue local time)":"interface.messages.starts_venue_local_time","Ends (venue local time)":"interface.messages.ends_venue_local_time","Save session":"interface.messages.save_session","Create session":"interface.messages.create_session","Venue name":"interface.messages.venue_name","Venue address":"interface.messages.venue_address","Venue timezone":"interface.messages.venue_timezone","Country code":"interface.messages.country_code","Map link (HTTPS)":"interface.messages.map_link_https","Guest venue notes":"interface.messages.guest_venue_notes","Welcome message — ":"interface.messages.welcome_message","Welcome messages for this venue":"interface.messages.welcome_messages_for_this_venue","Archived venue":"interface.messages.archived_venue","Save venue":"interface.messages.save_venue","Create venue":"interface.messages.create_venue","No venue":"interface.messages.no_venue","Unscheduled":"interface.messages.unscheduled","Times are entered in ":"interface.messages.times_are_entered_in","Session invitations":"interface.messages.session_invitations","Save session invitations":"interface.messages.save_session_invitations","Create sessions in Settings first.":"interface.messages.create_sessions_in_settings_first","Household defaults apply to each guest unless an individual exception is selected. Language does not determine invitations.":"interface.messages.household_defaults_apply_to_each_guest_unless_an_individual_excep","Follow household":"interface.messages.follow_household","Invited":"interface.messages.invited","Not invited":"interface.messages.not_invited","Household invited":"interface.messages.household_invited","Household not invited":"interface.messages.household_not_invited","Switch to Edit mode":"interface.messages.switch_to_edit_mode","Switch to View mode":"interface.messages.switch_to_view_mode","Edit mode · Changes are saved to the event database":"interface.messages.edit_mode_changes_are_saved_to_the_event_database","Loading event data…":"interface.messages.loading_event_data","Event data refreshed.":"interface.messages.event_data_refreshed","Event settings saved.":"interface.messages.event_settings_saved","Switch to Edit mode first.":"interface.messages.switch_to_edit_mode_first","Invalid RSVP deadline.":"interface.messages.invalid_rsvp_deadline","Confirm the release acknowledgement before publishing.":"interface.messages.confirm_the_release_acknowledgement_before_publishing","Complete the event name, date, website URL, active session and invitations before publishing.":"interface.messages.complete_the_event_name_date_website_url_active_session_and_invit","Unpublish this event? Guest access to published event details will stop.":"interface.messages.unpublish_this_event_guest_access_to_published_event_details_will","Event published.":"interface.messages.event_published_2","Event unpublished.":"interface.messages.event_unpublished","Enter matching passwords of at least 12 characters.":"interface.messages.enter_matching_passwords_of_at_least_12_characters","Sign in again before sending an invitation.":"interface.messages.sign_in_again_before_sending_an_invitation","Invitation could not be sent.":"interface.messages.invitation_could_not_be_sent","Email delivery status is uncertain. Check before resending.":"interface.messages.email_delivery_status_is_uncertain_check_before_resending","Email status is uncertain. Refresh pending invitations before retrying.":"interface.messages.email_status_is_uncertain_refresh_pending_invitations_before_retr","Email sending is restricted. Check the email configuration.":"interface.messages.email_sending_is_restricted_check_the_email_configuration","The email could not be sent. Check the email configuration before resending.":"interface.messages.the_email_could_not_be_sent_check_the_email_configuration_before_","The email service request limit was reached. Wait before resending.":"interface.messages.the_email_service_request_limit_was_reached_wait_before_resending","The email service sending limit was reached. Wait before resending.":"interface.messages.the_email_service_sending_limit_was_reached_wait_before_resending","Administrator invitations are unavailable. The invitation service must be installed before sending.":"interface.messages.administrator_invitations_are_unavailable_the_invitation_service_","Administrator list unavailable. Apply migration 006 if needed.":"interface.messages.administrator_list_unavailable_apply_migration_006_if_needed","Admin management API unavailable: ":"interface.messages.admin_management_api_unavailable","No active administrator invitation was found for this account. Ask an administrator to send or resend it.":"interface.messages.no_active_administrator_invitation_was_found_for_this_account_ask","Your account does not have administrator access, or invitation acceptance is unavailable. Ask an administrator to check your invitation.":"interface.messages.your_account_does_not_have_administrator_access_or_invitation_acc","Session logging is unavailable.":"interface.messages.session_logging_is_unavailable","Signed in, but session logging is unavailable.":"interface.messages.signed_in_but_session_logging_is_unavailable","Send another administrator invitation email to ":"interface.messages.send_another_administrator_invitation_email_to","Cancel administrator invitation for ":"interface.messages.cancel_administrator_invitation_for","Revoke administrator access for ":"interface.messages.revoke_administrator_access_for","Added":"interface.messages.added","Updated":"interface.messages.updated","Deleted":"interface.messages.deleted","Archived":"interface.messages.archived","Restored":"interface.messages.restored","Moved":"interface.messages.moved","Renamed":"interface.messages.renamed","Assigned":"interface.messages.assigned","Enabled":"interface.messages.enabled","Disabled":"interface.messages.disabled","Unspecified":"interface.messages.unspecified","Expired":"interface.messages.expired","Draft saved":"interface.messages.draft_saved","Delivery created":"interface.messages.delivery_created","Failed delivery":"interface.messages.failed_delivery","Failed attempt":"interface.messages.failed_attempt","Household submitted":"interface.messages.household_submitted","Guest response submitted":"interface.messages.guest_response_submitted","Guest response corrected":"interface.messages.guest_response_corrected","RSVP reopened":"interface.messages.rsvp_reopened","Late response allowed":"interface.messages.late_response_allowed","Invitation opened":"interface.messages.invitation_opened","Invitation assignments changed":"interface.messages.invitation_assignments_changed","Sign-in session":"interface.messages.sign_in_session","Signed out":"interface.messages.signed_out","Sign-out requested":"interface.messages.sign_out_requested","Token refreshed":"interface.messages.token_refreshed","Administrator invitation accepted":"interface.messages.administrator_invitation_accepted_2","Administrator invitation cancelled":"interface.messages.administrator_invitation_cancelled_2","Administrator email requested":"interface.messages.administrator_email_requested","Administrator email accepted by service":"interface.messages.administrator_email_accepted_by_service","Administrator email failed":"interface.messages.administrator_email_failed","Email failed":"interface.messages.email_failed","Sending / status pending":"interface.messages.sending_status_pending","Access removed":"interface.messages.access_removed","FIRST-TIME SETUP":"interface.messages.first_time_setup","Make this event yours.":"interface.messages.make_this_event_yours","Connect your own Supabase project in four steps. No terminal or Python required.":"interface.messages.connect_your_own_supabase_project_in_four_steps_no_terminal_or_py","Administration · Own your data":"interface.messages.administration_own_your_data","Database choice":"interface.messages.database_choice","Connection":"interface.messages.connection","Verify admin":"interface.messages.verify_admin","Publish config":"interface.messages.publish_config","STEP 1 OF 4":"interface.messages.step_1_of_4","STEP 2 OF 4":"interface.messages.step_2_of_4","STEP 3 OF 4":"interface.messages.step_3_of_4","STEP 4 OF 4":"interface.messages.step_4_of_4","How would you like to begin?":"interface.messages.how_would_you_like_to_begin","Use existing database":"interface.messages.use_existing_database","Connect to an already-migrated Supabase project. Preserve its invitations, guests and admin accounts.":"interface.messages.connect_to_an_already_migrated_supabase_project_preserve_its_invi","Set up a new database":"interface.messages.set_up_a_new_database","Create an empty Supabase project, run the included SQL, then create the first administrator.":"interface.messages.create_an_empty_supabase_project_run_the_included_sql_then_create","Continue":"interface.messages.continue","Connect Supabase":"interface.messages.connect_supabase","Project URL":"interface.messages.project_url","Publishable or legacy anon key":"interface.messages.publishable_or_legacy_anon_key","Test connection":"interface.messages.test_connection","Never paste a Supabase secret key, service_role key, database password or access token here. Only public client keys belong in a static website.":"interface.messages.never_paste_a_supabase_secret_key_service_role_key_database_passw","New database instructions":"interface.messages.new_database_instructions","Create a project at":"interface.messages.create_a_project_at","Open SQL Editor and run the included migrations 001–006 in order, or use the bundled install file. These are starter migrations and require functional/security testing before public launch.":"interface.messages.open_sql_editor_and_run_the_included_migrations_001_006_in_order_","Create an Auth user under Authentication → Users.":"interface.messages.create_an_auth_user_under_authentication_users","Download complete SQL installer":"interface.messages.download_complete_sql_installer","First admin email (for new installations)":"interface.messages.first_admin_email_for_new_installations","Generate first-admin SQL":"interface.messages.generate_first_admin_sql","Copy SQL":"interface.messages.copy_sql","The SQL appears here. Run it in your private Supabase SQL Editor, never on the website.":"interface.messages.the_sql_appears_here_run_it_in_your_private_supabase_sql_editor_n","Secure administrator access":"interface.messages.secure_administrator_access","For new projects, invite your first user via":"interface.messages.for_new_projects_invite_your_first_user_via",", then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.":"interface.messages.then_run_the_sql_below_in_supabase_sql_editor_to_grant_admin_acce","Check administrator login":"interface.messages.check_administrator_login","Put your configuration online":"interface.messages.put_your_configuration_online","Administrator verified. Your website configuration is ready.":"interface.messages.administrator_verified_your_website_configuration_is_ready","Download config.js":"interface.messages.download_config_js","Copy config contents":"interface.messages.copy_config_contents","Go to admin":"interface.messages.go_to_admin","The file contains only your Supabase URL and publishable / anon key. It must not contain a secret or service_role key.":"interface.messages.the_file_contains_only_your_supabase_url_and_publishable_anon_key","After committing":"interface.messages.after_committing",", enable GitHub Pages for the new repository. Then open the website, verify admin sign-in and invitation behavior. Keep the event unpublished until final security checks pass.":"interface.messages.enable_github_pages_for_the_new_repository_then_open_the_website_","Enter":"interface.messages.enter",", and add it to":"interface.messages.and_add_it_to","in your NEW GitHub repository. This step is essential: browser-only setup does not configure the public website for other visitors.":"interface.messages.in_your_new_github_repository_this_step_is_essential_browser_only","For a new project, create your first Auth user in Supabase and use the setup wizard to establish admin access.":"interface.messages.for_a_new_project_create_your_first_auth_user_in_supabase_and_use","Test your Supabase connection before continuing.":"interface.messages.test_your_supabase_connection_before_continuing","Administrator verification required.":"interface.messages.administrator_verification_required","Sign in as an administrator first.":"interface.messages.sign_in_as_an_administrator_first","Database connection or schema validation failed: ":"interface.messages.database_connection_or_schema_validation_failed","Guest Edge Function is unavailable. Deploy the guest-gateway function first: ":"interface.messages.guest_edge_function_is_unavailable_deploy_the_guest_gateway_funct","Enter a valid administrator email.":"interface.messages.enter_a_valid_administrator_email","First-admin SQL generated. This must be executed in the private Supabase SQL Editor, not in the browser.":"interface.messages.first_admin_sql_generated_this_must_be_executed_in_the_private_su","This account does not have administrator access. Run the first-admin SQL or ask an existing admin to grant access.":"interface.messages.this_account_does_not_have_administrator_access_run_the_first_adm","Generate SQL first.":"interface.messages.generate_sql_first","SQL copied.":"interface.messages.sql_copied","Unable to copy SQL. Select it manually.":"interface.messages.unable_to_copy_sql_select_it_manually","Configuration copied.":"interface.messages.configuration_copied","Clipboard access denied. Download the file instead.":"interface.messages.clipboard_access_denied_download_the_file_instead","Connected to {host}. The protected guest gateway responded.":"interface.messages.connected_to_host_the_protected_guest_gateway_responded","Database not configured":"interface.messages.database_not_configured","Database not connected. Complete the setup wizard first.":"interface.messages.database_not_connected_complete_the_setup_wizard_first","Invalid administrator action":"interface.messages.invalid_administrator_action","Administrator request failed.":"interface.messages.administrator_request_failed","Your sign-in has expired. Sign in again before saving. Your edits have not been submitted.":"interface.messages.your_sign_in_has_expired_sign_in_again_before_saving_your_edits_h","The server returned an unreadable response.":"interface.messages.the_server_returned_an_unreadable_response","Supabase JavaScript library did not load. Check the network connection.":"interface.messages.supabase_javascript_library_did_not_load_check_the_network_connec","Supabase URL must use HTTPS (except localhost).":"interface.messages.supabase_url_must_use_https_except_localhost","Use only the Supabase project URL, with no credentials or query string.":"interface.messages.use_only_the_supabase_project_url_with_no_credentials_or_query_st","Use only a publishable or anon key, never a secret key.":"interface.messages.use_only_a_publishable_or_anon_key_never_a_secret_key","This JWT is not an anon key.":"interface.messages.this_jwt_is_not_an_anon_key","The supplied JWT key is malformed.":"interface.messages.the_supplied_jwt_key_is_malformed","Expected a publishable key or legacy anon JWT.":"interface.messages.expected_a_publishable_key_or_legacy_anon_jwt","Something went wrong.":"interface.messages.something_went_wrong","Enter a complete date and time.":"interface.messages.enter_a_complete_date_and_time","Invalid date and time.":"interface.messages.invalid_date_and_time","This local time is ambiguous or does not exist because clocks change. Choose a time outside the clock change.":"interface.messages.this_local_time_is_ambiguous_or_does_not_exist_because_clocks_cha","A simple way to celebrate together.":"interface.messages.a_simple_way_to_celebrate_together","Your event,":"interface.messages.your_event","beautifully arranged.":"interface.messages.beautifully_arranged","Private invitations · Please do not share your invitation link.":"interface.messages.private_invitations_please_do_not_share_your_invitation_link","SETUP REQUIRED":"interface.messages.setup_required","Connect your event":"interface.messages.connect_your_event","This website has not been connected to Supabase yet.":"interface.messages.this_website_has_not_been_connected_to_supabase_yet","Open first-time setup":"interface.messages.open_first_time_setup","YOUR INVITATION":"interface.messages.your_invitation","Open your invitation":"interface.messages.open_your_invitation","Enter the eight-character invitation code or open the private link you received.":"interface.messages.enter_the_eight_character_invitation_code_or_open_the_private_lin","Open":"interface.messages.open","PERSONAL INVITATION":"interface.messages.personal_invitation","Welcome":"interface.messages.welcome","Please let us know who will attend.":"interface.messages.please_let_us_know_who_will_attend","Submit RSVP":"interface.messages.submit_rsvp","What can you bring?":"interface.messages.what_can_you_bring","Choose items only if you want to contribute. Quantities cannot exceed what is needed.":"interface.messages.choose_items_only_if_you_want_to_contribute_quantities_cannot_exc","Confirm my selections":"interface.messages.confirm_my_selections","Invalid quantity":"interface.messages.invalid_quantity","Invalid invitation code":"interface.messages.invalid_invitation_code","Your event":"interface.messages.your_event_2","Invitation":"interface.messages.invitation","Quantity for {item}":"interface.messages.quantity_for_item","Interface language":"interface.messages.interface_language","Interface wording":"interface.messages.interface_wording","Welcome messages":"interface.messages.welcome_messages","Save welcome messages":"interface.messages.save_welcome_messages","Welcome messages saved.":"interface.messages.welcome_messages_saved","Leave a welcome message blank to use the built-in translation.":"interface.messages.leave_a_welcome_message_blank_to_use_the_built_in_translation","Customize interface wording":"interface.messages.customize_interface_wording","Choose a phrase and language, edit the wording, then download the file and replace js/interface-overrides.js in the repository. This does not publish the event.":"interface.messages.choose_a_phrase_and_language_edit_the_wording_then_download_the_f","Phrase":"interface.messages.phrase","Custom wording":"interface.messages.custom_wording","Use {placeholders} exactly as shown. Blank text restores the built-in wording.":"interface.messages.use_placeholders_exactly_as_shown_blank_text_restores_the_built_i","Apply wording":"interface.messages.apply_wording","Download wording file":"interface.messages.download_wording_file","Wording applied to this preview. Download and commit the file to share it.":"interface.messages.wording_applied_to_this_preview_download_and_commit_the_file_to_s","Keep the same placeholders as the original phrase.":"interface.messages.keep_the_same_placeholders_as_the_original_phrase","EVENT INVITATION":"interface.messages.event_invitation_2","Enter the eight-character code from your invitation.":"interface.messages.enter_the_eight_character_code_from_your_invitation","Dear guests":"interface.messages.dear_guests","Your response has been received and locked.":"interface.messages.your_response_has_been_received_and_locked","Thank you! Your response is recorded.":"interface.messages.thank_you_your_response_is_recorded","No invitation was found for that code.":"interface.messages.no_invitation_was_found_for_that_code","Choose a response for every invited guest and session.":"interface.messages.choose_a_response_for_every_invited_guest_and_session","Could not reach the database.":"interface.messages.could_not_reach_the_database","This event has not been published yet.":"interface.messages.this_event_has_not_been_published_yet","Choose only what you would like to contribute. Quantities are limited.":"interface.messages.choose_only_what_you_would_like_to_contribute_quantities_are_limi","Save":"interface.messages.save","Available":"interface.messages.available","All invited guests are listed.":"interface.messages.all_invited_guests_are_listed","Changing language reloads this page. Unsaved changes will be lost. Continue?":"interface.messages.changing_language_reloads_this_page_unsaved_changes_will_be_lost_","Showing {count} of {total} matching guests.":"interface.messages.showing_count_of_total_matching_guests","{count} entries shown · Newest first":"interface.messages.count_entries_shown_newest_first"," · Confirmed":"interface.messages.confirmed"," · Last submission {time}":"interface.messages.last_submission_time","Event deadline: {deadline} · Late-response permission: {late} · {zone}":"interface.messages.event_deadline_deadline_late_response_permission_late_zone","{ready} ready · {sent} recorded sent · {failed} failed":"interface.messages.ready_ready_sent_recorded_sent_failed_failed","{count} guests":"interface.messages.count_guests","{count} sub-households · {guests} guests in sub-households":"interface.messages.count_sub_households_guests_guests_in_sub_households","Quantity cannot fall below {count} claimed; claimed items cannot be hidden.":"interface.messages.quantity_cannot_fall_below_count_claimed_claimed_items_cannot_be_","Needed {needed} · Claimed {claimed} · Available {available}{inactive}":"interface.messages.needed_needed_claimed_claimed_available_available_inactive"," · Inactive":"interface.messages.inactive","Archive {item}? Existing claims are preserved; you can reactivate it using Edit.":"interface.messages.archive_item_existing_claims_are_preserved_you_can_reactivate_it_","Revoke administrator access for {email}?":"interface.messages.revoke_administrator_access_for_email","Times are entered in {zone}. Changing venue keeps the typed local time; review before saving.":"interface.messages.times_are_entered_in_zone_changing_venue_keeps_the_typed_local_ti","For new projects, invite your first user via Supabase → Authentication → Users, then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.":"interface.messages.for_new_projects_invite_your_first_user_via_supabase_authenticati","{attending} attending · {declined} declined":"interface.messages.attending_attending_declined_declined","{sent} recorded sent · {pending} pending":"interface.messages.sent_recorded_sent_pending_pending","{count} households":"interface.messages.count_households","{count} items":"interface.messages.count_items"," · Child":"interface.messages.child_2"," · Archived":"interface.messages.archived_2"," (unregistered)":"interface.messages.unregistered"," (inactive)":"interface.messages.inactive_2"," — household":"interface.messages.household"," · Expires {time}":"interface.messages.expires_time","Household":"interface.messages.household_2","Wording preview":"interface.messages.wording_preview","Download":"interface.messages.download","{count} guest":"interface.messages.count_guest","{count} sub-household":"interface.messages.count_sub_household","{count} sub-households":"interface.messages.count_sub_households","{count} guest in sub-households":"interface.messages.count_guest_in_sub_households","{count} guests in sub-households":"interface.messages.count_guests_in_sub_households","Archive household":"interface.messages.archive_household","Restore household":"interface.messages.restore_household","Archive guest":"interface.messages.archive_guest","Restore guest":"interface.messages.restore_guest","Archive contact":"interface.messages.archive_contact","Restore contact":"interface.messages.restore_contact","Languages":"interface.messages.languages","Backups":"interface.messages.backups","Fallback language":"interface.messages.fallback_language","Choose enabled languages and the fallback used for missing translations. English is the final built-in fallback.":"interface.messages.choose_enabled_languages_and_the_fallback_used_for_missing_transl","Save language preferences":"interface.messages.save_language_preferences","Add language":"interface.messages.add_language","Language code":"interface.messages.language_code","Save language":"interface.messages.save_language","Language saved.":"interface.messages.language_saved","Language preferences saved.":"interface.messages.language_preferences_saved","Translations":"interface.messages.translations","Text to translate":"interface.messages.text_to_translate","Translation":"interface.messages.translation","Save translation":"interface.messages.save_translation","Translation saved.":"interface.messages.translation_saved","Fallback preview":"interface.messages.fallback_preview","Venue":"interface.messages.venue","Description":"interface.messages.description","Blank text uses the configured fallback language, then English.":"interface.messages.blank_text_uses_the_configured_fallback_language_then_english","Choose a phrase and language, then save the translation. Downloading a wording file is optional. This does not publish the event.":"interface.messages.choose_a_phrase_and_language_then_save_the_translation_downloadin","Download an application backup containing guest information, private invitation codes, settings, translations, contributions and historical records. Store it privately.":"interface.messages.download_an_application_backup_containing_guest_information_priva","Auth passwords, sessions, administrator access, deployment secrets, rate-limit counters and sign-in logs are not restored. Keep a separate copy of the repository and deployment configuration.":"interface.messages.auth_passwords_sessions_administrator_access_deployment_secrets_r","Download application backup":"interface.messages.download_application_backup","Validate and restore":"interface.messages.validate_and_restore","Choose a backup to inspect it. Full validation rehearses the restore and rolls it back. Import requires an empty, unpublished destination with matching migrations and verified historical actor accounts. Existing application records cannot be overwritten.":"interface.messages.choose_a_backup_to_inspect_it_full_validation_rehearses_the_resto","Backup file":"interface.messages.backup_file","Validate backup":"interface.messages.validate_backup","Restore confirmation":"interface.messages.restore_confirmation","I understand this restores application data into an empty destination and keeps the event unpublished.":"interface.messages.i_understand_this_restores_application_data_into_an_empty_destina","Restore application backup":"interface.messages.restore_application_backup","Preparing backup…":"interface.messages.preparing_backup","Backup export is unavailable. Install the matching migration first.":"interface.messages.backup_export_is_unavailable_install_the_matching_migration_first","Backup downloaded. Store it privately and rehearse restoration.":"interface.messages.backup_downloaded_store_it_privately_and_rehearse_restoration","Backup exceeds 20 MB.":"interface.messages.backup_exceeds_20_mb","Unsupported backup format or version.":"interface.messages.unsupported_backup_format_or_version","Validating backup…":"interface.messages.validating_backup","Backup validation is unavailable.":"interface.messages.backup_validation_is_unavailable","Restore rehearsal passed. No data was changed.":"interface.messages.restore_rehearsal_passed_no_data_was_changed","This destination cannot be restored: ":"interface.messages.this_destination_cannot_be_restored","Application restored. The event is unpublished. Review administrator access separately.":"interface.messages.application_restored_the_event_is_unpublished_review_administrato","RESTORE followed by the source event name":"interface.messages.restore_followed_by_the_source_event_name","Open email":"interface.messages.open_email","Open Messages":"interface.messages.open_messages","Open WhatsApp":"interface.messages.open_whatsapp","Copy the message, open Messages, then paste and send.":"interface.messages.copy_the_message_open_messages_then_paste_and_send","Review the message in your device app and tap Send.":"interface.messages.review_the_message_in_your_device_app_and_tap_send","Opening an app does not mark this message as sent. Return here to confirm sending. Delivery and read receipts remain in your messaging app.":"interface.messages.opening_an_app_does_not_mark_this_message_as_sent_return_here_to_","Enter one valid email address.":"interface.messages.enter_one_valid_email_address","Use an international phone number, including country code.":"interface.messages.use_an_international_phone_number_including_country_code","Refresh and save this delivery again before sending.":"interface.messages.refresh_and_save_this_delivery_again_before_sending","Prepare reminder":"interface.messages.prepare_reminder","Creates a separate draft using current contact details. Review the recipient and text before sending.":"interface.messages.creates_a_separate_draft_using_current_contact_details_review_the","A friendly reminder to reply to our invitation:":"interface.messages.a_friendly_reminder_to_reply_to_our_invitation","Invites":"interface.messages.invites","Things to do":"interface.messages.things_to_do","Task":"interface.messages.task","Assigned to":"interface.messages.assigned_to","Status":"interface.messages.status","Add rows":"interface.messages.add_rows","In progress":"interface.messages.in_progress","Done":"interface.messages.done","Tasks saved.":"interface.messages.tasks_saved","Edit cells, add rows, then save. Blank new rows are ignored.":"interface.messages.edit_cells_add_rows_then_save_blank_new_rows_are_ignored","Select Edit to update the task list.":"interface.messages.select_edit_to_update_the_task_list","Name":"interface.messages.name","Amount: {claimed}/{needed}, Shown: {shown}":"interface.messages.amount_claimed_needed_shown_shown","Pick item":"interface.messages.pick_item","Remove selection":"interface.messages.remove_selection","Selected":"interface.messages.selected","Find text":"interface.messages.find_text","Choose enabled languages":"interface.messages.choose_enabled_languages","Name is required.":"interface.messages.name_is_required","Comment":"interface.messages.comment","Print / Save as PDF":"interface.messages.print_save_as_pdf","Default unit ({type})":"interface.messages.default_type_type","Expand all items":"interface.messages.expand_all_items","Collapse all items":"interface.messages.collapse_all_items","Quantity: {claimed}/{needed} {type} · {shown}":"interface.messages.amount_claimed_needed_type_shown_shown","Event welcome":"interface.messages.event_welcome","Venue welcome":"interface.messages.venue_welcome","Appears at the top of the guest invitation.":"interface.messages.appears_at_the_top_of_the_guest_invitation","Appears under the session at this venue on the guest invitation.":"interface.messages.appears_under_the_session_at_this_venue_on_the_guest_invitation","Map link":"interface.messages.map_link","Manage households":"interface.messages.manage_households","Checked households are invited to this session. Individual guest exceptions stay in place.":"interface.messages.checked_households_are_invited_to_this_session_individual_guest_e","No households to manage.":"interface.messages.no_households_to_manage","Guest exceptions":"interface.messages.guest_exceptions","Protected by RSVP history":"interface.messages.protected_by_rsvp_history","Checked items are available at this venue. Changes apply here only. Existing household claims are kept.":"interface.messages.checked_items_are_available_at_this_venue_changes_apply_here_only","Select all":"interface.messages.select_all","Nothing available to add.":"interface.messages.nothing_available_to_add","Edit administrator name":"interface.messages.edit_administrator_name","Move session up":"interface.messages.move_session_up","Move session down":"interface.messages.move_session_down","Session order saved.":"interface.messages.session_order_saved","Move language up":"interface.messages.move_language_up","Move language down":"interface.messages.move_language_down","Save translations":"interface.messages.save_translations","1 item":"interface.messages.1_item","{items} · Quantity: {claimed}/{capacity}":"interface.messages.items_claimed_capacity_amounts","Add":"interface.messages.add","Edit quantity for {household}":"interface.messages.edit_quantity_for_household","Remove selection for {household}":"interface.messages.remove_selection_for_household","Remove new item":"interface.messages.remove_new_item","Move to category":"interface.messages.move_to_category","Unsaved changes. Select Save to update the database.":"interface.messages.unsaved_changes_select_save_to_update_the_database","Use main Edit mode to change tasks. Save sends your changes to the database.":"interface.messages.use_main_edit_mode_to_change_tasks_save_sends_your_changes_to_the","Tasks were saved. Refresh the page before editing again.":"interface.messages.tasks_were_saved_refresh_the_page_before_editing_again","Item":"interface.messages.item","New item":"interface.messages.new_item","Edit item":"interface.messages.edit_item","Save item":"interface.messages.save_item","Item saved.":"interface.messages.item_saved","No items in this category.":"interface.messages.no_items_in_this_category","Use main Edit, then the pencil to edit and save a line.":"interface.messages.use_main_edit_then_the_pencil_to_edit_and_save_a_line","Add a category first.":"interface.messages.add_a_category_first","Tasks and things to bring, grouped by category. Use main Edit, then the pencil to edit a line.":"interface.messages.tasks_and_things_to_bring_grouped_by_category_use_main_edit_then_","No matching entries.":"interface.messages.no_matching_entries","Welcome Message":"interface.messages.welcome_message_title","Categories":"interface.messages.categories","Units":"interface.messages.types","Rows per page":"interface.messages.rows_per_page","Previous":"interface.messages.previous","Next":"interface.messages.next","Page {page} of {pages}":"interface.messages.page_page_of_pages","Edit translation":"interface.messages.edit_translation","Export CSV":"interface.messages.export_csv","Use the pencil to open an item, then save your changes.":"interface.messages.use_the_pencil_to_open_an_item_then_save_your_changes","Translate welcome messages, venues, sessions and food. Interface wording is in Settings → Languages.":"interface.messages.main_language_help","Guest note":"interface.messages.guest_note","Translate the item name and the note shown to guests. Units are translated in Languages → Food → Units.":"interface.messages.food_translation_help","English source":"interface.messages.english_source","Unavailable":"interface.messages.unavailable","Edit category":"interface.messages.edit_category","Delete category":"interface.messages.delete_category","Move items to another category before deleting this category.":"interface.messages.move_items_before_deleting_category","Delete empty category?":"interface.messages.delete_empty_category","Category deleted":"interface.messages.category_deleted","Category saved":"interface.messages.category_saved","Manage units":"interface.messages.manage_types","Units are shared by all food items. Translate each unit once for every enabled language.":"interface.messages.shared_food_types_help","Built-in":"interface.messages.built_in","Custom":"interface.messages.custom","Translate":"interface.messages.translate","Add unit":"interface.messages.add_type","This unit already exists.":"interface.messages.type_already_exists","Unit added":"interface.messages.type_added","Move venue up":"interface.messages.move_venue_up","Move venue down":"interface.messages.move_venue_down","Venue order saved":"interface.messages.venue_order_saved","Admin note":"interface.messages.admin_note","Unit":"interface.messages.unit","Batch":"interface.messages.batch_singular","Piece":"interface.messages.piece_singular","Tray":"interface.messages.tray_singular","Packet":"interface.messages.packet_singular","Gram":"interface.messages.gram_singular","Saving…":"interface.messages.saving_progress","Show more":"interface.messages.show_more","Show less":"interface.messages.show_less","Translate in Languages":"interface.messages.translate_in_languages","Swipe for more tabs":"interface.messages.more_tabs_hint","All wording":"interface.messages.all_wording","General":"interface.messages.general","Households & guests":"interface.messages.households_and_guests","Invites & RSVP":"interface.messages.invites_and_rsvp","Food & units":"interface.messages.food_and_units","Venues & sessions":"interface.messages.venues_and_sessions","Administrators & access":"interface.messages.administrators_and_access","Wording categories":"interface.messages.wording_categories","Main":"interface.messages.main","Interface":"interface.messages.interface","Administration areas":"interface.messages.administration_areas","Personal preferences for this device.":"interface.messages.personal_device_preferences","Translate event content for guests.":"interface.messages.translate_event_content","Manage invitations, food and event details.":"interface.messages.main_section_description","View mode":"interface.messages.view_mode","Edit mode":"interface.messages.edit_mode","Switch to light mode":"interface.messages.switch_to_light_mode","Switch to dark mode":"interface.messages.switch_to_dark_mode","Saved":"interface.messages.saved_status","Error":"interface.messages.error_status","Fully assigned":"interface.messages.fully_assigned","Hidden":"interface.messages.hidden_status","Access":"interface.messages.access_access","Access preset":"interface.messages.access_access_preset","Active":"interface.messages.access_active","Administrator management":"interface.messages.access_administrator_management","Administrator permissions are unavailable.":"interface.messages.access_administrator_permissions_are_unavailable","Browser session":"interface.messages.access_browser_session","Custom access · {edit} editable, {view} view only":"interface.messages.access_custom_access_edit_editable_view_view_only","Edit access":"interface.messages.access_edit_access","Enable":"interface.messages.access_enable","Export application backup":"interface.messages.access_export_application_backup","Full administrator":"interface.messages.access_full_administrator","Invites & delivery":"interface.messages.access_invites_delivery","Languages & settings":"interface.messages.access_languages_settings","Last activity":"interface.messages.access_last_activity","Manage members":"interface.messages.access_manage","No access":"interface.messages.access_no_access","View":"interface.messages.access_view","View only":"interface.messages.access_view_only","No access hides a section. View shows summaries. Edit allows changes.":"interface.messages.access_no_access_hides_a_section_view_shows_summaries_edit_allows_changes","No active sessions.":"interface.messages.access_no_active_sessions","No administrators to display.":"interface.messages.access_no_administrators_to_display","No eligible verified Auth account found. Send an invitation instead.":"interface.messages.access_no_eligible_verified_auth_account_found_send_an_invitation_instead","Only Full administrators can change access.":"interface.messages.access_only_full_administrators_can_change_access","Only Full administrators can change access. Settings excludes administrator and backup powers.":"interface.messages.access_only_full_administrators_can_change_access_settings_excludes_administrator_and_backup_powers","Remove administrator":"interface.messages.access_remove_administrator","Remove administrator {name}? Their Auth account and historical records remain.":"interface.messages.access_remove_administrator_name_their_auth_account_and_historical_records_remain","Restored · Disabled":"interface.messages.access_restored_disabled","Revoke":"interface.messages.access_revoke","Revoke other administrators’ sessions":"interface.messages.access_revoke_other_administrators_sessions","Revoke this application session?":"interface.messages.access_revoke_this_application_session","Revoke this session? You will return to login.":"interface.messages.access_revoke_this_session_you_will_return_to_login","Revoke your other application sessions?":"interface.messages.access_revoke_your_other_application_sessions","Save access changes for {name}?":"interface.messages.access_save_access_changes_for_name","Section":"interface.messages.access_section","Send invitations & reminders":"interface.messages.access_send_invitations_reminders","Sending is separate from editing invitations. Backup exports include data from the whole event.":"interface.messages.access_sending_is_separate_from_editing_invitations_backup_exports_include_data_from_the_whole_event","Signed in":"interface.messages.access_signed_in","Suspend":"interface.messages.access_suspend","Suspended":"interface.messages.access_suspended","This session":"interface.messages.access_this_session","Suspend administrator {name}? Their current sessions will lose application access.":"interface.messages.access_suspend_administrator_name_their_current_sessions_will_lose_application_access","Enable administrator {name} with their saved access?":"interface.messages.access_enable_administrator_name_with_their_saved_access","Add {email} with View only access? No invitation email will be sent.":"interface.messages.access_add_email_with_view_only_access_no_invitation_email_will_be_sent","Active sessions":"interface.messages.access_active_sessions","Revoke my other sessions":"interface.messages.access_revoke_my_other_sessions","Revocation ends access to this application. Everyone can revoke their own sessions.":"interface.messages.access_revocation_ends_access_to_this_application_everyone_can_revoke_their_own_sessions","Add administrator":"interface.messages.access_add_administrator","Add manually":"interface.messages.access_add_manually","Your administrator access or session has ended. Sign in again.":"interface.messages.access_your_administrator_access_or_session_has_ended_sign_in_again","New administrators start with View only access. Full administrators can customize it.":"interface.messages.access_new_administrators_start_with_view_only_access_full_administrators_can_customize_it","This action is not allowed by your administrator permissions.":"interface.messages.access_this_action_is_not_allowed_by_your_administrator_permissions","Use the available tabs to open the sections you can access.":"interface.messages.access_use_the_available_tabs_to_open_the_sections_you_can_access","Close":"interface.messages.popup_close","Preview":"interface.messages.pdf_print_preview","Adults: {adults} · Children: {children}":"interface.messages.guest_age_summary","Quantity: {claimed}/{needed} {type}":"interface.messages.quantity_claimed_needed_type","Mobile":"interface.messages.guest_mobile","Preferred guest contact method":"interface.messages.guest_contact_method","Copy household contact details":"interface.messages.copy_household_contacts","Review the copied details before saving. Existing guest values and household information are preserved.":"interface.messages.copy_contacts_review","Previous household contact details":"interface.messages.previous_household_contacts","No previous contact details.":"interface.messages.no_previous_contact_details","Missing contact":"interface.messages.missing_contact","Keep these details until you have reviewed and copied them to a guest.":"interface.messages.keep_previous_contacts","Primary household contact":"interface.messages.primary_household_contact","Choose a non-child guest from this household. Their saved contact details are used for new invitation drafts.":"interface.messages.primary_guest_help","Move guest up":"interface.messages.guest_move_up","Move guest down":"interface.messages.guest_move_down","Guest order saved":"interface.messages.guest_order_saved","Map & directions":"interface.messages.map_directions","Add person":"interface.messages.add_companion","Add to our household":"interface.messages.add_to_household","Add someone from your household before confirming your RSVP. They inherit your household’s session invitations.":"interface.messages.companion_help","Person added. Please review their attendance choices.":"interface.messages.guest_added","Preview only: added guests disappear when you reload. Nothing is saved.":"interface.messages.preview_add_guest","Please contact the organizer to add more people.":"interface.messages.companion_limit","Could not add this person. Check your invitation or contact the organizer.":"interface.messages.guest_add_error","Could not reserve the complete group. Availability has been refreshed.":"interface.messages.food_group_error","Partly assigned by the organizer":"interface.messages.food_group_partial","Contact the organizer to change this group.":"interface.messages.food_group_unavailable","Food Group saved.":"interface.messages.food_group_saved","Time format":"interface.messages.time_format","Language default":"interface.messages.time_locale","12-hour (AM/PM)":"interface.messages.time_12","24-hour":"interface.messages.time_24","Food Groups":"interface.messages.food_groups","Add Food Group":"interface.messages.add_food_group","Selecting this group commits your household to one unit of every listed item.":"interface.messages.group_commitment","Included items":"interface.messages.group_items","Choose at least two items. Resolve existing commitments before grouping.":"interface.messages.group_choose","Select group":"interface.messages.group_pick","Remove group selection":"interface.messages.group_remove","Ungroup items":"interface.messages.group_delete","Ungroup these items? No food item will be deleted.":"interface.messages.group_delete_confirm","Pick an item you would like to bring. Selected items are reserved for your household.":"interface.messages.food_selection_help","Food coordination":"interface.messages.food_coordination","Guest food step":"interface.messages.food_stage","Collect interest":"interface.messages.food_stage_interest","Choose food":"interface.messages.food_stage_selection","Keep the detailed list hidden while planning. Opening it does not publish the event. Hiding it again preserves all commitments.":"interface.messages.food_stage_help","Open the detailed food list for eligible households? This does not publish the event.":"interface.messages.food_stage_confirm","Guest food step saved.":"interface.messages.food_stage_saved","Can you bring food?":"interface.messages.food_interest_question","Let us know whether your household can bring food. We will send the invitation link again when the detailed list is ready.":"interface.messages.food_interest_help","I can bring food":"interface.messages.food_interest_yes","I can’t bring food":"interface.messages.food_interest_no","Your food answer has been saved.":"interface.messages.food_interest_saved","Could not save your food answer. Your choice is still here; refresh or contact the organizer if you already have commitments.":"interface.messages.food_interest_failed","Not answered":"interface.messages.food_interest_pending","Household food answers":"interface.messages.food_interest_answers","Can bring food: {yes} · Cannot: {no} · Not answered: {pending}":"interface.messages.food_interest_totals","Features":"interface.messages.event_features","Disabled features are hidden. Existing data is kept.":"interface.messages.features_preserve_data","Food explanation":"interface.messages.food_explanation","Review food selections":"interface.messages.food_review","Check what your household will bring before confirming.":"interface.messages.food_review_help","Your food selections changed. Please review them again.":"interface.messages.food_review_changed","Time: {start} to {end}":"interface.messages.venue_time_range","Time: {time}":"interface.messages.venue_time","Guest appearance":"interface.messages.guest_appearance","Show light/dark toggle on the guest page":"interface.messages.guest_theme_toggle","Guest default appearance":"interface.messages.guest_theme_default","Guests can change the default when the toggle is shown. Hiding it enforces the default. Your administrator appearance stays personal.":"interface.messages.guest_theme_help","We’ll share more information about the food once we’ve received everyone’s replies.":"interface.messages.food_followup","Print":"interface.messages.print","Top-level groups":"interface.messages.top_level_groups","Relational groups":"interface.messages.relation_groups","Add relational group":"interface.messages.add_relation_group","Move households and remove empty relational groups before deleting this group. Keep at least one top-level group.":"interface.messages.group_not_empty","Edit group":"interface.messages.edit_group","Delete group":"interface.messages.delete_group","Shared group":"interface.messages.shared_group","Guest invitation":"interface.messages.invitation_custom_guest_invitation","Customize the invitation without publishing the event.":"interface.messages.invitation_custom_customize_the_invitation_without_publishing_the_event","Background photo":"interface.messages.invitation_custom_background_photo","Choose JPEG":"interface.messages.invitation_custom_choose_jpeg","Replace JPEG":"interface.messages.invitation_custom_replace_jpeg","Remove photo":"interface.messages.invitation_custom_remove_photo","Restore photo":"interface.messages.invitation_custom_restore_photo","Stored privately with the event. No public image link.":"interface.messages.invitation_custom_stored_privately_with_the_event_no_public_image_link","JPEG up to 1.4 MB. Images are resized to 2400 px and metadata is removed before saving.":"interface.messages.invitation_custom_jpeg_up_to_1_4_mb_images_are_resized_to_2400_px_and_metadata_is_removed_before_saving","Crop photo":"interface.messages.invitation_custom_crop_photo","Left":"interface.messages.invitation_custom_left","Top":"interface.messages.invitation_custom_top","Bottom":"interface.messages.invitation_custom_bottom","Center":"interface.messages.invitation_custom_center","Width":"interface.messages.invitation_custom_width","Height":"interface.messages.invitation_custom_height","Photo position":"interface.messages.invitation_custom_photo_position","Darken photo":"interface.messages.invitation_custom_darken_photo","Colors & boxes":"interface.messages.invitation_custom_colors_boxes","Boxes / page":"interface.messages.invitation_custom_boxes_page","Text":"interface.messages.invitation_custom_text","Buttons":"interface.messages.invitation_custom_buttons","Box opacity":"interface.messages.invitation_custom_box_opacity","Live preview":"interface.messages.invitation_custom_live_preview","Wide":"interface.messages.invitation_custom_wide","Reset appearance":"interface.messages.invitation_custom_reset_appearance","Current private photo":"interface.messages.invitation_custom_current_private_photo","Visible crop":"interface.messages.invitation_custom_visible_crop","No background photo":"interface.messages.invitation_custom_no_background_photo","bytes":"interface.messages.invitation_custom_bytes","Preparing photo…":"interface.messages.invitation_custom_preparing_photo","Photo prepared. Save to keep it privately.":"interface.messages.invitation_custom_photo_prepared_save_to_keep_it_privately","Guest appearance saved.":"interface.messages.invitation_custom_guest_appearance_saved","Choose a JPEG under 1.4 MB.":"interface.messages.invitation_custom_choose_a_jpeg_under_1_4_mb","Invalid JPEG image.":"interface.messages.invitation_custom_invalid_jpeg_image","JPEG dimensions are too large or invalid.":"interface.messages.invitation_custom_jpeg_dimensions_are_too_large_or_invalid","Invalid photo crop.":"interface.messages.invitation_custom_invalid_photo_crop","Could not prepare this photo.":"interface.messages.invitation_custom_could_not_prepare_this_photo","All groups":"interface.messages.invitation_custom_all_groups","All languages":"interface.messages.invitation_custom_all_languages","All channels":"interface.messages.invitation_custom_all_channels","Not sent":"interface.messages.invitation_custom_not_sent","Marked sent":"interface.messages.invitation_custom_marked_sent","Awaiting reply":"interface.messages.invitation_custom_awaiting_reply","Replied":"interface.messages.invitation_custom_replied","Partly answered":"interface.messages.invitation_custom_partly_answered","No reply":"interface.messages.invitation_custom_no_reply","Never sent":"interface.messages.invitation_custom_never_sent","Last sent":"interface.messages.invitation_custom_last_sent","Recipient / channel":"interface.messages.invitation_custom_recipient_channel","Actions":"interface.messages.invitation_custom_actions","Prepare":"interface.messages.invitation_custom_prepare","Review":"interface.messages.invitation_custom_review","Follow up":"interface.messages.invitation_custom_follow_up","{answered} / {total} responses":"interface.messages.invitation_custom_answered_total_responses","No households match these filters.":"interface.messages.invitation_custom_no_households_match_these_filters","Send · Preview · Follow up":"interface.messages.invitation_custom_send_preview_follow_up","Search households or contacts":"interface.messages.invitation_custom_search_households_or_contacts","Household name or recipient":"interface.messages.invitation_custom_household_name_or_recipient","Channel":"interface.messages.invitation_custom_channel","Group by top-level / relational group":"interface.messages.invitation_custom_group_by_top_level_relational_group","Prepare drafts now. Marking ready and sending become available after publication.":"interface.messages.invitation_custom_prepare_drafts_now_marking_ready_and_sending_become_available_after_publication","Replace the invitation link placeholder before marking ready.":"interface.messages.invitation_custom_replace_the_invitation_link_placeholder_before_marking_ready","Use the guest customization editor.":"interface.messages.invitation_custom_use_the_guest_customization_editor","We look forward to celebrating our day with you.":"interface.messages.invitation_custom_we_look_forward_to_celebrating_our_day_with_you","Status messages":"interface.messages.status_messages_title","Choose which temporary messages appear. Saved logs, form errors and confirmation lists are unchanged.":"interface.messages.status_messages_help","All messages":"interface.messages.status_messages_all","Errors only":"interface.messages.status_messages_errors_only","Information":"interface.messages.status_messages_information","Success":"interface.messages.status_messages_success","Warnings":"interface.messages.status_messages_warnings","Errors":"interface.messages.status_messages_errors","Status message preferences saved.":"interface.messages.status_messages_saved","Hide messages after 5 seconds":"interface.messages.status_messages_auto_dismiss","Food":"food.messages.food","Event is unpublished: guest-facing event details and food remain hidden until you publish.":"food.messages.event_is_unpublished_guest_facing_event_details_and_food_remain_h","Food access":"food.messages.food_access","Food items":"food.messages.food_items","Add food item":"food.messages.add_food_item","Allow this household to contribute food":"food.messages.allow_this_household_to_contribute_food","Reason for food-access change":"food.messages.reason_for_food_access_change","Save food access":"food.messages.save_food_access","Disabling access is blocked while food commitments or a confirmed selection exist. Existing selections are never removed by this control.":"food.messages.disabling_access_is_blocked_while_food_commitments_or_a_confirmed","Food categories & items":"food.messages.food_categories_items","Food or category":"food.messages.food_or_category","Add food category":"food.messages.add_food_category","Rename food category":"food.messages.rename_food_category","Move food item up":"food.messages.move_food_item_up","Move food item down":"food.messages.move_food_item_down","Edit food item":"food.messages.edit_food_item","Save food item":"food.messages.save_food_item","Archive food item (preserve existing claims)":"food.messages.archive_food_item_preserve_existing_claims","No matching food items.":"food.messages.no_matching_food_items","Food category added.":"food.messages.food_category_added","Food category updated.":"food.messages.food_category_updated","Food item added.":"food.messages.food_item_added","Food item updated.":"food.messages.food_item_updated","Food item archived.":"food.messages.food_item_archived","Food order saved.":"food.messages.food_order_saved","Category renamed and linked food items updated.":"food.messages.category_renamed_and_linked_food_items_updated","View mode · Manage invitations, food and event details":"food.messages.view_mode_manage_invitations_food_and_event_details","Publish this event now? Invite-code holders may access guest RSVP and food details. Proceed only after security and guest-flow testing.":"food.messages.publish_this_event_now_invite_code_holders_may_access_guest_rsvp_","FOOD COORDINATION":"food.messages.food_coordination","Confirm food selections? This will lock further edits.":"food.messages.confirm_food_selections_this_will_lock_further_edits","Food item":"food.messages.food_item","Thank you! Your food selection is confirmed.":"food.messages.thank_you_your_food_selection_is_confirmed","Food selection saved.":"food.messages.food_selection_saved","{state} · {count} food commitments{confirmed}":"food.messages.state_count_food_commitments_confirmed","Add translations for interface phrases, event introductions, venue welcome messages, sessions and food. Missing text uses the fallback language.":"food.messages.add_translations_for_interface_phrases_event_introductions_venue_","Recipe":"food.messages.recipe","Previous recipe group":"food.messages.previous_recipe_group","Allow pop-ups to save the recipe as PDF.":"food.messages.allow_pop_ups_to_save_the_recipe_as_pdf","Add food item type":"food.messages.add_food_item_type","New food unit":"food.messages.new_food_item_type","Food unit must be at most 60 characters.":"food.messages.food_item_type_must_be_at_most_60_characters","Type translations are shared by food items with the same type.":"food.messages.type_translations_are_shared_by_food_items_with_the_same_type","No matching food units.":"food.messages.no_matching_food_types","Manage food":"food.messages.manage_food","Venue food":"food.messages.venue_food","No food items to manage.":"food.messages.no_food_items_to_manage","Add food":"food.messages.add_food","Adding unrestricted food here makes it available at this venue only. Items already assigned to other venues keep those assignments.":"food.messages.adding_unrestricted_food_here_makes_it_available_at_this_venue_on","Food Units":"food.messages.food_types","Food categories":"food.messages.food_categories","Allow food":"food.messages.allow_food","Remove the food selection for {household}?":"food.messages.remove_the_food_selection_for_household","Add recipe":"food.messages.add_recipe","Recipe name":"food.messages.recipe_name","Existing food items":"food.messages.existing_food_items","Create food item in recipe":"food.messages.create_food_item_in_recipe","Save recipe":"food.messages.save_recipe","Edit recipe":"food.messages.edit_recipe","Existing items keep their selections. Recipe items use the recipe category.":"food.messages.existing_items_keep_their_selections_recipe_items_use_the_recipe_","Move recipe to category":"food.messages.move_recipe_to_category","No recipe has been added yet.":"food.messages.no_recipe_yet","Batches":"types.units.batch_s","Pieces":"types.units.piece_s","Trays":"types.units.tray_s","Packets":"types.units.packet_s","kg":"types.units.kg","Grams":"types.units.grams","Selecting a group commits the household to one unit of every included item.":"interface.messages.admin_group_commitment","Share invitation":"interface.messages.share_invitation","Choose the displayed recipient in your app. Sharing does not mark this invitation as sent. Return here to record it and note the app you used.":"interface.messages.share_invitation_help","System sharing is unavailable here. Use Copy message or open a device app.":"interface.messages.share_unavailable","Share handoff completed":"interface.messages.share_handoff_completed","Share handoff completed, but logging failed. Retry logging without sharing again. Sent still requires manual confirmation.":"interface.messages.share_logging_failed","Retry logging":"interface.messages.retry_share_logging","Personal preferences for your account, across devices.":"interface.messages.personal_account_preferences","Your preference could not be saved. Please try again.":"interface.messages.personal_preference_failed","Publication":"interface.messages.publication","RSVP comment (optional)":"interface.messages.rsvp_comment_label","Dietary requirements or anything else we should know.":"interface.messages.rsvp_comment_help","Needed: {needed} · Still available: {available} · {unit}":"interface.messages.food_availability","Select between 1 and {max}.":"interface.messages.food_quantity_range","Parent category":"interface.messages.food_parent_category","Add sub-category":"interface.messages.food_add_subcategory","Move sub-categories before deleting this category.":"interface.messages.food_move_subcategories","RSVP comment must be at most 2000 characters":"interface.messages.rsvp_comment_limit","Food category hierarchy must have valid parents, no cycles and at most 8 levels":"interface.messages.food_category_tree_invalid","Category changed; reload before saving":"interface.messages.food_category_changed","Show timestamps":"interface.messages.status_messages_show_timestamp","Export mode":"interface.messages.backup_export_mode","Include sections":"interface.messages.backup_include_sections","Include activity logs":"interface.messages.backup_include_logs","Event settings and languages are always included. In Backup mode, households and food include each other and venues to preserve replies and commitments.":"interface.messages.backup_sections_help","Activity logs can contain personal details. Replies, food commitments and Sent records are kept in Backup mode even when logs are excluded. Planning templates omit logs and reset invitation codes, replies and commitments.":"interface.messages.backup_logs_help","Choose valid backup mode, sections and activity log options.":"interface.messages.backup_invalid_options","Invalid backup selection manifest":"interface.messages.backup_invalid_manifest","Invalid backup selection dependencies":"interface.messages.backup_invalid_dependencies","A planning template cannot restore cleared replies or commitments.":"interface.messages.backup_template_no_replies","Selected sections are not available in this file.":"interface.messages.backup_sections_unavailable","Activity logs are not available in this file.":"interface.messages.backup_logs_unavailable","Backup contains excluded administrator history":"interface.messages.backup_excluded_admin_history","Backup":"interface.messages.backup_preserve_mode","{count} sub-category":"interface.messages.food_count_subcategory","{count} sub-categories":"interface.messages.food_count_subcategories","Add item or sub-category":"interface.messages.food_add_choices","Planned backup":"interface.messages.backup_planned_export","Full restore":"interface.messages.backup_full_restore","Planned restore":"interface.messages.backup_planned_restore","Partial backup":"interface.messages.backup_partial_export","Partial restore":"interface.messages.backup_partial_restore","Event settings and languages are always included. Partial mode resets invitation codes, replies and commitments. Included logs remain read-only history.":"interface.messages.backup_partial_help","Activity logs can be included in Full or Partial mode. They may contain personal details; Partial restores retain them as read-only history.":"interface.messages.backup_independent_logs_help","Event settings and languages are always included. Partial mode resets invitation codes, replies and commitments, and excludes activity logs.":"interface.messages.backup_partial_excludes_logs","Activity logs are optional for Full backup and Full restore only. Full restore requires a Full backup file.":"interface.messages.backup_full_logs_only","Partial backups and restores cannot include activity logs.":"interface.messages.backup_partial_logs_forbidden","Full restore requires a Full backup file.":"interface.messages.backup_full_file_required","Checklist":"interface.messages.checklist","Quantity: {claimed}/{capacity}":"interface.messages.food_quantity_totals","Compress backup (.json.gz)":"interface.messages.backup_compress","JSON or gzip (.json.gz) backups. Compression does not encrypt the file.":"interface.messages.backup_compression_help","Compression is not supported in this browser. Use a JSON backup.":"interface.messages.backup_compression_unavailable","Decompression is not supported in this browser. Open a JSON backup.":"interface.messages.backup_decompression_unavailable","The compressed backup is damaged or incomplete.":"interface.messages.backup_gzip_damaged","Backup exceeds 20 MB when opened.":"interface.messages.backup_opened_too_large","Set RSVP_SITE_ORIGIN to {origin} and RSVP_SITE_URL to {siteUrl} in Supabase Edge Function secrets.":"interface.messages.setup_site_secrets","In Supabase Authentication, set Site URL to {siteUrl} and allow the administrator invitation redirect {redirectUrl}.":"interface.messages.setup_auth_urls","Connect to an existing Supabase installation. Preserve its invitations, guests and admin accounts.":"interface.messages.setup_existing_installation","Choose Local or Cloud, install the current schema, then create the first administrator.":"interface.messages.setup_new_target_intro","Where will the database run?":"interface.messages.setup_target_question","Local":"interface.messages.setup_target_local","Cloud":"interface.messages.setup_target_cloud","Supabase running on your computer or VM.":"interface.messages.setup_local_description","A project hosted by Supabase.":"interface.messages.setup_cloud_description","Choose Local or Cloud before continuing.":"interface.messages.setup_choose_target","Create a cloud Supabase project":"interface.messages.setup_create_cloud","Open its SQL Editor and run the complete downloaded installer once on the empty application schema.":"interface.messages.setup_cloud_install","Start your local Supabase stack. If the CLI already installed the current baseline, skip the SQL installation.":"interface.messages.setup_start_local","Open local Supabase Studio":"interface.messages.setup_open_local_studio","If the application schema is empty, open SQL Editor and run the complete downloaded installer once.":"interface.messages.setup_empty_schema_install","Use the API URL and public browser key printed by supabase status.":"interface.messages.setup_local_credentials","Never run the fresh installer over an installed event. This wizard does not execute SQL or reset a database.":"interface.messages.setup_fresh_install_guard","Local Supabase setup guide":"interface.messages.setup_local_guide","For GitHub Actions, set the repository variables RSVP_SUPABASE_URL and RSVP_PUBLISHABLE_KEY, then rerun the website deployment. For direct static hosting, download config.js and install it as js/config.js. Browser-only setup applies only to this browser.":"interface.messages.setup_configuration_delivery","Before testing the website, complete the server configuration below. Local installations use the local setup guide; cloud installations use the Studio guide.":"interface.messages.setup_server_configuration","Deploy guest-gateway and admin-invitations from the same release, with platform Verify JWT OFF.":"interface.messages.setup_cloud_functions","Run both Edge Functions in your local stack with the site environment settings. Keep application validation enabled.":"interface.messages.setup_local_functions","Enable Data API: ON":"interface.messages.setup_cloud_api_on","Required for the website and Edge Function database calls.":"interface.messages.setup_cloud_api_reason","Automatically expose new tables: OFF":"interface.messages.setup_cloud_exposure_off","The installer grants only the access this application needs.":"interface.messages.setup_cloud_exposure_reason","Enable automatic RLS: ON":"interface.messages.setup_cloud_rls_on","Keep this protection enabled. The installer also enables RLS and supplies the application policies.":"interface.messages.setup_cloud_rls_reason","Keep public in the Data API exposed schemas. Do not expose app_private.":"interface.messages.setup_cloud_schemas","In the cloud project’s Security options, choose:":"interface.messages.setup_cloud_options_intro","Before Test connection":"interface.messages.setup_before_connection","Complete these server steps first. The connection test checks the database and guest-gateway; it does not install or configure them.":"interface.messages.setup_prerequisites_help","GitHub Pages: the wizard configures this browser for testing. In step 4, save the public connection values as Actions variables and redeploy to configure the site for everyone.":"interface.messages.setup_hosting_order","GitHub Pages — selected-release workflow":"interface.messages.setup_pages_workflow","In the website repository, open Settings → Secrets and variables → Actions → Variables. Add repository variables, not secrets.":"interface.messages.setup_pages_variables","Set RSVP_SUPABASE_URL to the Project URL used in step 2 and RSVP_PUBLISHABLE_KEY to its public browser key. Enter values without JavaScript quotes.":"interface.messages.setup_pages_values","Open Actions → Deploy RSVP → Run workflow, select the installed release and run it. Wait for the deployment to succeed.":"interface.messages.setup_pages_redeploy","Open the website in a private browser window to verify sign-in and Guest preview with the deployed configuration.":"interface.messages.setup_pages_verify","The workflow generates js/config.js. Uploading a downloaded config.js to the repository does not configure the Pages artifact. No configuration file upload is needed for this workflow.":"interface.messages.setup_pages_generated_config","Direct static hosting":"interface.messages.setup_direct_hosting","Download config.js and upload it as js/config.js in the website installation directory. Browser-only setup configures this browser, not other visitors.":"interface.messages.setup_direct_config","In the private local function environment file, set RSVP_SITE_ORIGIN to {origin} and RSVP_SITE_URL to {siteUrl}.":"interface.messages.setup_local_site_settings","Food Interest Reply":"interface.messages.food_interest_reply_title","Food interest":"interface.messages.food_interest_reporting","Unanswered":"interface.messages.food_interest_unanswered","Reply when no deadline is set":"interface.messages.food_interest_no_deadline_reply","Shown after a saved Yes in Collect interest. Use {rsvp_deadline:+5} for the RSVP deadline plus five calendar days in the event timezone. Blank text uses the fallback language, then English.":"interface.messages.food_interest_reply_help","Thank you! We’ll share more information about the food later.":"interface.messages.food_interest_reply_default","Invalid food interest reply":"interface.messages.food_interest_reply_invalid","Invalid food interest reply placeholder":"interface.messages.food_interest_reply_placeholder_invalid","Food interest reply changed; refresh before saving":"interface.messages.food_interest_reply_changed","Food explanation changed; refresh before saving":"interface.messages.food_explanation_changed","Invalid food explanation":"interface.messages.food_explanation_invalid","Available placeholders":"interface.messages.available_placeholders","Insert":"interface.messages.insert_placeholder","Insert a placeholder at the cursor.":"interface.messages.placeholder_cursor_hint","RSVP deadline date":"interface.messages.rsvp_deadline_date","Five days after the RSVP deadline":"interface.messages.deadline_plus_five","Two days before the RSVP deadline":"interface.messages.deadline_minus_two","Change the offset from −366 to +366 calendar days. Without a deadline, the no-deadline reply is used.":"interface.messages.deadline_offset_help","Discard unsaved translation changes?":"interface.messages.discard_translation_changes","Adults":"interface.messages.adults_count_label","Children":"interface.messages.children_count_label","Contributing households":"interface.messages.contributing_households","Attendance totals across sessions":"interface.messages.attendance_session_totals","Encrypt backup":"interface.messages.backup_encrypt","Backup password":"interface.messages.backup_password","Confirm backup password":"interface.messages.backup_password_confirm","Keep this password safe. An encrypted backup cannot be recovered without it.":"interface.messages.backup_password_recovery_warning","Encryption requires HTTPS, Web Crypto and Web Workers. Unencrypted backups remain available.":"interface.messages.backup_crypto_unavailable","Enter a backup password.":"interface.messages.backup_password_required","Backup passwords do not match.":"interface.messages.backup_password_mismatch","Backup password exceeds 1024 UTF-8 bytes.":"interface.messages.backup_password_limit","Another backup encryption operation is running.":"interface.messages.backup_crypto_busy","Backup key derivation could not complete. Try again on a device with more available memory.":"interface.messages.backup_kdf_failed","Unsupported or damaged encrypted backup.":"interface.messages.backup_encrypted_invalid","Unsupported backup encryption parameters.":"interface.messages.backup_kdf_parameters_invalid","Incorrect password or damaged backup.":"interface.messages.backup_auth_failed","Open encrypted backup":"interface.messages.backup_encrypted_open","Encrypted backup":"interface.messages.backup_encrypted_title","Enter this file’s backup password. It is not your administrator password.":"interface.messages.backup_file_password_hint","Opening encrypted backup cancelled.":"interface.messages.backup_encrypted_cancelled","Automatic setup":"interface.messages.setup_auto_automatic_setup_eef40","Connect your cloud Supabase project. The temporary local companion handles privileged setup and forgets its credentials when finished.":"interface.messages.setup_auto_connect_your_cloud_supabase_project_the_temporary_local_companion_6ec9c","Start the trusted setup companion":"interface.messages.setup_auto_start_the_trusted_setup_companion_d20c9","Run this command from your downloaded release on your own computer, then open the local address it prints.":"interface.messages.setup_auto_run_this_command_from_your_downloaded_release_on_your_own_compute_8f2c4","For Local Supabase or manual installation, use the existing setup guide.":"interface.messages.setup_auto_for_local_supabase_or_manual_installation_use_the_existing_setup__238bd","Manual setup":"interface.messages.setup_auto_manual_setup_28315","Database":"interface.messages.setup_auto_database_fa7fe","Secrets":"interface.messages.setup_auto_secrets_d8707","Edge Functions":"interface.messages.setup_auto_edge_functions_127c1","Configuration":"interface.messages.setup_auto_configuration_b332c","Verification":"interface.messages.setup_auto_verification_7140f","Credentials are sent only to this local companion and Supabase. They are not saved in browser storage or project files.":"interface.messages.setup_auto_credentials_are_sent_only_to_this_local_companion_and_supabase_th_32033","Secret or service_role key":"interface.messages.setup_auto_secret_or_service_role_key_54cd5","Project reference ID":"interface.messages.setup_auto_project_reference_id_3d139","Supabase Management API access token":"interface.messages.setup_auto_supabase_management_api_access_token_fe951","Website base URL":"interface.messages.setup_auto_website_base_url_32c44","Use a dedicated project and a token with project, database, Auth configuration, Edge Function and secret read/write permissions.":"interface.messages.setup_auto_use_a_dedicated_project_and_a_token_with_project_database_auth_co_c4899","Validate connection":"interface.messages.setup_auto_validate_connection_8ee4a","Initialize database":"interface.messages.setup_auto_initialize_database_a879f","Install the current schema, or add missing objects in a compatible partial installation. Existing rows are kept. Incompatible schemas and initialized applications are not overwritten.":"interface.messages.setup_auto_install_the_current_schema_or_add_missing_objects_in_a_compatible_750e2","Create first administrator":"interface.messages.setup_auto_create_first_administrator_dbf56","The account is created in Supabase Authentication and confirmed directly. An existing account requires its current password.":"interface.messages.setup_auto_the_account_is_created_in_supabase_authentication_and_confirmed_d_a768b","Create and verify administrator":"interface.messages.setup_auto_create_and_verify_administrator_91c60","Configure Edge Function secrets":"interface.messages.setup_auto_configure_edge_function_secrets_39cf1","Configure RSVP_SITE_ORIGIN and RSVP_SITE_URL for the website address. Supabase provides its platform credentials automatically. No third-party secret is required by the current application.":"interface.messages.setup_auto_configure_rsvp_site_origin_and_rsvp_site_url_for_the_website_addr_472ac","Add optional secret":"interface.messages.setup_auto_add_optional_secret_bc76c","Configure secrets":"interface.messages.setup_auto_configure_secrets_cb4f0","Deploy Edge Functions":"interface.messages.setup_auto_deploy_edge_functions_d5f86","Deploy and verify guest-gateway and admin-invitations from this release. Other functions are left alone. Existing conflicting JWT settings require review instead of being silently changed.":"interface.messages.setup_auto_deploy_and_verify_guest_gateway_and_admin_invitations_from_this_r_c2cd9","Application configuration":"interface.messages.setup_auto_application_configuration_923dc","Configure the website URL, administrator invitation redirect and Data API schemas. Keep the event unpublished and retain existing settings.":"interface.messages.setup_auto_configure_the_website_url_administrator_invitation_redirect_and_d_c958a","Configure application":"interface.messages.setup_auto_configure_application_c1a62","Verify installation":"interface.messages.setup_auto_verify_installation_a598e","Check schema, administrator permissions, secrets, function configuration and protected runtime responses before marking setup complete.":"interface.messages.setup_auto_check_schema_administrator_permissions_secrets_function_configura_92d32","Verify and finish setup":"interface.messages.setup_auto_verify_and_finish_setup_699c3","Setup complete":"interface.messages.setup_auto_setup_complete_aadaf","The application is initialized. The event remains unpublished.":"interface.messages.setup_auto_the_application_is_initialized_the_event_remains_unpublished_2382c","Download the public browser configuration for your hosting installation. Only the project URL and public key are included. For GitHub Pages, set the existing Actions connection variables and redeploy.":"interface.messages.setup_auto_download_the_public_browser_configuration_for_your_hosting_instal_31b8e","Download public configuration":"interface.messages.setup_auto_download_public_configuration_6d95f","Continue to administrator login":"interface.messages.setup_auto_continue_to_administrator_login_c12e3","Continuing configures this browser for sign-in. Publish the public configuration to configure the website for other devices.":"interface.messages.setup_auto_continuing_configures_this_browser_for_sign_in_publish_the_public_70560","Disconnect and forget credentials":"interface.messages.setup_auto_disconnect_and_forget_credentials_9a363","Setup could not complete this step. Retry after checking the project connection and permissions.":"interface.messages.setup_auto_setup_could_not_complete_this_step_retry_after_checking_the_proje_d1b01","Step completed.":"interface.messages.setup_auto_step_completed_8c6f7","Secret name":"interface.messages.setup_auto_secret_name_5cdf5","Secret value":"interface.messages.setup_auto_secret_value_6ef47","Automatic cloud setup with the trusted local companion":"interface.messages.setup_auto_automatic_cloud_setup_with_the_trusted_local_companion_c569e","Invalid public connection configuration.":"interface.messages.setup_auto_invalid_public_connection_configuration_460d6","Existing installation detected. No project settings were changed.":"interface.messages.setup_auto_existing_installation_detected_no_project_settings_were_changed_2c011","Setup steps":"interface.messages.setup_auto_setup_steps_1eba9","Working…":"interface.messages.setup_auto_working_5474e","Remove":"interface.messages.setup_auto_remove_c3812","Invitation picture":"interface.messages.invitation_picture","Remove picture":"interface.messages.remove_invitation_picture","Optional JPEG under 1.4 MB. Stored privately and copied into new delivery drafts. Existing drafts keep their picture.":"interface.messages.invitation_picture_help","Some apps accept only the picture or the text. If either is missing, use Share picture and Copy message, then paste the message in the app. Choose the recipient and check the invitation link before sending.":"interface.messages.invitation_picture_share_help","Share picture and text":"interface.messages.share_picture_and_text","Share picture":"interface.messages.share_picture","Invalid invitation picture.":"interface.messages.invalid_invitation_picture","Manual / Messenger":"interface.messages.manual_messenger_template","Test sharing":"interface.messages.test_invitation_sharing","Uses example names and a non-working example invitation link. No household code or delivery record is created. Choose yourself as the recipient.":"interface.messages.test_invitation_sharing_help","Test share completed. Check the picture, text and example link in your app.":"interface.messages.test_invitation_sharing_complete","Example event":"interface.messages.sample_invitation_event","Uses example names and the landing-page preview link. No household code or delivery record is created. Choose yourself as the recipient.":"interface.messages.test_invitation_preview_help","Test share completed. Check the picture, text and preview link in your app.":"interface.messages.test_invitation_preview_complete","Placeholders":"interface.messages.album_placeholders","Search placeholders":"interface.messages.album_search_placeholders","Use the {…} button beside an editor to insert a supported placeholder.":"interface.messages.album_use_the_button_beside_an_editor_to_insert_a_supported_placeholder","Invitation templates and delivery drafts":"interface.messages.album_invitation_templates_and_delivery_drafts","Invitation templates and Food Interest Reply":"interface.messages.album_invitation_templates_and_food_interest_reply","Set an RSVP deadline before sharing an invitation with deadline placeholders.":"interface.messages.album_set_an_rsvp_deadline_before_sharing_an_invitation_with_deadline_placeholders","Other wording fields keep the placeholders of their original phrase.":"interface.messages.album_other_wording_fields_keep_the_placeholders_of_their_original_phrase","Picture album":"interface.messages.album_picture_album","Choose from album":"interface.messages.album_choose_from_album","Add pictures to the album first.":"interface.messages.album_add_pictures_to_the_album_first","No picture":"interface.messages.album_no_picture","Shared across template languages and channels.":"interface.messages.album_shared_across_template_languages_and_channels","Remove this album picture? Saved templates and messages keep their pictures.":"interface.messages.album_remove_this_album_picture_saved_templates_and_messages_keep_their_pictures","Picture name":"interface.messages.album_picture_name","Add picture":"interface.messages.album_add_picture","Guest titles":"interface.messages.album_guest_titles","Show titles":"interface.messages.album_show_titles","Hide titles":"interface.messages.album_hide_titles","Choose whether titles appear before guest names in each language. Titles are always hidden on small screens.":"interface.messages.album_choose_whether_titles_appear_before_guest_names_in_each_language_titles_are_always_hidden_on_small_s","Use the invitation preferences editor.":"interface.messages.album_use_the_invitation_preferences_editor","Invalid guest title visibility":"interface.messages.album_invalid_guest_title_visibility","The picture album can contain up to 12 pictures.":"interface.messages.album_the_picture_album_can_contain_up_to_12_pictures","Invalid album picture":"interface.messages.album_invalid_album_picture","Guest titles changed; refresh before saving":"interface.messages.album_guest_titles_changed_refresh_before_saving","Picture album changed; refresh before saving":"interface.messages.album_picture_album_changed_refresh_before_saving","Album picture not found":"interface.messages.album_album_picture_not_found","Individual guest exceptions":"interface.messages.individual_guest_exceptions","Session invitations changed; refresh before saving":"interface.messages.session_invitations_changed_refresh","Create from template":"interface.messages.create_from_template","Customize this delivery":"interface.messages.customize_this_delivery","Review delivery":"interface.messages.review_delivery","Changes apply to this delivery only; the saved template stays unchanged.":"interface.messages.delivery_customization_help","Save draft":"interface.messages.save_draft","Mark ready":"interface.messages.mark_ready","Created":"interface.messages.record_created","Not recorded":"interface.messages.record_not_recorded","Venue context":"interface.messages.inline_venue_context_2cbc1","No specific venue":"interface.messages.inline_no_specific_venue_3d5ad","Session context":"interface.messages.inline_session_context_93a2a","No specific session":"interface.messages.inline_no_specific_session_5d4c1","Fill the missing placeholder values or choose a venue/session before sharing.":"interface.messages.inline_fill_the_missing_placeholder_values_or_choose_a_venue_session_before_sharing_d98fb","Placeholder context":"interface.messages.inline_placeholder_context_881c2","Safety backup downloaded. Store it privately before replacing event data.":"interface.messages.inline_safety_backup_downloaded_store_it_privately_before_replacing_event_data_df5dc","Save and continue":"interface.messages.inline_save_and_continue_6880d","Discard and continue":"interface.messages.inline_discard_and_continue_43c9d","Stay here":"interface.messages.inline_stay_here_ef8d6","Confirm":"interface.messages.inline_confirm_eebdd","Restore destination":"interface.messages.inline_restore_destination_ba8cb","Clean database":"interface.messages.inline_clean_database_f4582","Replace event data":"interface.messages.inline_replace_event_data_bbf47","Restore backup":"interface.messages.inline_restore_backup_6da1c","Download safety backup":"interface.messages.inline_download_safety_backup_61374","Event time":"interface.messages.inline_event_time_1d7fc","Organizer name":"interface.messages.inline_organizer_name_86fa1","Organizer email":"interface.messages.inline_organizer_email_8efe9","Organizer phone":"interface.messages.inline_organizer_phone_b7616","Food deadline":"interface.messages.inline_food_deadline_044bd","Replaces event records from a Full backup on this installation. Current accounts, access and configuration stay unchanged. The event remains unpublished.":"interface.messages.inline_replaces_event_records_from_a_full_backup_on_this_installation_current_accounts_access_and_39266","Event data replaced. Current access and configuration are preserved; the event is unpublished.":"interface.messages.inline_event_data_replaced_current_access_and_configuration_are_preserved_the_event_is_unpublishe_e0068","Replacement requires a backup from this installation":"interface.messages.inline_replacement_requires_a_backup_from_this_installation_231f3","Replacement requires a complete Full backup":"interface.messages.inline_replacement_requires_a_complete_full_backup_2b57e","Replacement destination must be unpublished":"interface.messages.inline_replacement_destination_must_be_unpublished_94933","Destination changed; validate the backup again":"interface.messages.inline_destination_changed_validate_the_backup_again_2e850","Download a fresh safety backup before replacement":"interface.messages.inline_download_a_fresh_safety_backup_before_replacement_9d224","Type REPLACE followed by the source event name":"interface.messages.inline_type_replace_followed_by_the_source_event_name_7db6f","Replace unresolved placeholders before marking ready":"interface.messages.inline_replace_unresolved_placeholders_before_marking_ready_0080b","Replace unresolved placeholders before sharing.":"interface.messages.inline_replace_unresolved_placeholders_before_sharing_859ba","The text contains an unsupported placeholder.":"interface.messages.inline_the_text_contains_an_unsupported_placeholder_64b39","Invalid placeholder text":"interface.messages.inline_invalid_placeholder_text_96c9e","Choose a session at the selected venue":"interface.messages.inline_choose_a_session_at_the_selected_venue_5776c","Partly replied":"interface.messages.inline_partly_replied_fdff9","All":"interface.messages.inline_all_a52ac","Copy":"interface.messages.inline_copy_e21f9","Copied":"interface.messages.inline_copied_8d525","Category order saved":"interface.messages.inline_category_order_saved_8ea88","Add item":"interface.messages.inline_add_item_d1a0b","Quantity":"interface.messages.inline_quantity_822ba","Choose…":"interface.messages.inline_choose_7ca41","Options":"interface.messages.inline_options_d0db8","I understand current event data will be replaced.":"interface.messages.inline_i_understand_current_event_data_will_be_replaced_909cc","Preserved":"interface.messages.inline_preserved_9d31b","Details will follow.":"interface.messages.inline_details_will_follow_ab9b6","View in Invites":"interface.messages.view_in_invites","Create":"interface.messages.create","Guests Interface":"interface.messages.guest_names_guests_interface","Household last name":"interface.messages.guest_names_household_last_name","Show repeated surname beside each guest":"interface.messages.guest_names_show_repeated_surname_beside_each_guest","Hide only when every active guest has the same non-empty surname as the household. Mixed surnames stay visible.":"interface.messages.guest_names_hide_only_when_every_active_guest_has_the_same_non_empty_surname_as_the_household_mixed_surnames_stay_visible","Guest name preferences changed; refresh before saving":"interface.messages.guest_names_guest_name_preferences_changed_refresh_before_saving","Invalid guest name preferences":"interface.messages.guest_names_invalid_guest_name_preferences","Household last name is too long":"interface.messages.guest_names_household_last_name_is_too_long","Button hover appearance":"interface.messages.queued_button_hover_appearance","Toolbar":"interface.messages.queued_toolbar","Pencil":"interface.messages.queued_pencil","Create button":"interface.messages.queued_create_button","Services":"interface.messages.queued_services","Choose at least one service":"interface.messages.queued_choose_at_least_one_service","Delete template?":"interface.messages.queued_delete_template","Add template":"interface.messages.queued_add_template","Choose template":"interface.messages.queued_choose_template","Shown fields":"interface.messages.queued_shown_fields","Display mode":"interface.messages.queued_display_mode","Landing page":"interface.messages.queued_landing_page","Invitation appearance":"interface.messages.queued_invitation_appearance","Choose whether titles appear before guest names in each language.":"interface.messages.queued_choose_whether_titles_appear_before_guest_names_in_each_language","Guest name placement":"interface.messages.queued_guest_name_placement","Above and centred":"interface.messages.queued_above_and_centred","Left inline":"interface.messages.queued_left_inline","Backup mode":"interface.messages.queued_backup_mode","File options":"interface.messages.queued_file_options","Compression":"interface.messages.queued_compression","Encryption":"interface.messages.queued_encryption","Full":"interface.messages.queued_full","Partial":"interface.messages.queued_partial","Wipe":"interface.messages.queued_wipe","Wipe and restore":"interface.messages.queued_wipe_and_restore","I understand application data will be replaced and other administrators disabled.":"interface.messages.queued_i_understand_application_data_will_be_replaced_and_other_administrators_disabled","Validate before restoring. Full and Partial restore require a clean destination. Wipe replaces application data from a Full backup, keeps your current administrator and destination configuration, and disables other administrators. The event remains unpublished.":"interface.messages.queued_validate_before_restoring_full_and_partial_restore_require_a_clean_destination_wipe_r","Wipe accepts Full backups from other installations. Your administrator and destination configuration are kept; other administrators are disabled. Historical actors without a verified matching account are mapped to you, with original identities retained in the restore audit.":"interface.messages.queued_wipe_accepts_full_backups_from_other_installations_your_administrator_and_destination","Replace event data requires a Full backup from this installation. Download a safety backup before replacing current event data.":"interface.messages.queued_replace_event_data_requires_a_full_backup_from_this_installation_download_a_safety_ba","Messenger":"interface.messages.layout_messenger","Subject":"interface.messages.layout_subject","Message":"interface.messages.layout_message","Picture":"interface.messages.layout_picture","Short Message":"interface.messages.layout_short_message","Choose at least one option":"interface.messages.layout_choose_at_least_one_option","Delete draft?":"interface.messages.layout_delete_draft","Choice 1":"interface.messages.layout_choice_1","Choice 2":"interface.messages.layout_choice_2","Choice 3":"interface.messages.layout_choice_3","Default":"interface.messages.layout_default","Shared across invitation templates and services.":"interface.messages.layout_shared_across_invitation_templates_and_services","Named templates can share services and include optional subject, message, short message and picture.":"interface.messages.layout_named_templates_can_share_services_and_include_optional_subject_message_short_message","Choose valid content options":"interface.messages.layout_choose_valid_content_options","Include a valid invitation link in the short message":"interface.messages.layout_include_a_valid_invitation_link_in_the_short_message","Only unsent drafts can be deleted":"interface.messages.layout_only_unsent_drafts_can_be_deleted","Application":"interface.messages.navigation_application","Events":"interface.messages.navigation_events","Check all release requirements before using Settings → Application → Publish event.":"interface.messages.check_all_release_requirements_before_using_settings_event_settin","Manage application settings and administrator access.":"interface.messages.manage_event_details_and_administrator_access","Photo":"interface.messages.compact_photo","Colours":"interface.messages.compact_colours","Titles":"interface.messages.compact_titles","Names":"interface.messages.compact_names","Private JPEG":"interface.messages.compact_private_jpeg","Surname once":"interface.messages.compact_surname_once","Surname repeated":"interface.messages.compact_surname_repeated","Toggle hidden":"interface.messages.compact_toggle_hidden","Toggle shown":"interface.messages.compact_toggle_shown","Details":"interface.messages.compact_details","Invites appearance":"interface.messages.review_invites_appearance","Unsupported placeholder in {field}: {placeholder}.":"interface.messages.review_unsupported_placeholder_in_field_placeholder","Replace {placeholder} with {replacement}":"interface.messages.review_replace_placeholder_with_replacement","Replacement changes this draft only. Save to keep it.":"interface.messages.review_replacement_changes_this_draft_only_save_to_keep_it","Placeholder categories":"interface.messages.review_placeholder_categories","No matching placeholders":"interface.messages.review_no_matching_placeholders","Event":"interface.messages.review_event","Guest access":"interface.messages.review_guest_access","Invited guests":"interface.messages.review_invited_guests","Private preview only":"interface.messages.review_private_preview_only","Website":"interface.messages.review_website","Online":"interface.messages.review_online","Available after publication":"interface.messages.review_available_after_publication","Published":"interface.messages.review_published","Unpublished":"interface.messages.review_unpublished","Publishing opens RSVP to invited guests.":"interface.messages.review_publishing_opens_rsvp_to_invited_guests","I have completed the release checks.":"interface.messages.review_i_have_completed_the_release_checks","Release guidance":"interface.messages.review_release_guidance","{count} completed check":"interface.messages.review_count_completed_check","{count} completed checks":"interface.messages.review_count_completed_checks","All checks completed":"interface.messages.review_all_checks_completed","Forgot password?":"interface.messages.admin_setup_forgot_password","Reset your password":"interface.messages.admin_setup_reset_your_password","Enter your administrator email to request a reset link.":"interface.messages.admin_setup_enter_your_administrator_email_to_request_a_reset_link","Send reset link":"interface.messages.admin_setup_send_reset_link","Back to sign-in":"interface.messages.admin_setup_back_to_sign_in","Set a new password":"interface.messages.admin_setup_set_a_new_password","Choose a new password for your administrator account.":"interface.messages.admin_setup_choose_a_new_password_for_your_administrator_account","Save new password":"interface.messages.admin_setup_save_new_password","Request a new reset link":"interface.messages.admin_setup_request_a_new_reset_link","This password reset link is invalid, expired or already used. Request a new link.":"interface.messages.admin_setup_this_password_reset_link_is_invalid_expired_or_already_used_request_a_new_link","Checking your password reset link…":"interface.messages.admin_setup_checking_your_password_reset_link","If an account matches this email, you will receive a password reset link.":"interface.messages.admin_setup_if_an_account_matches_this_email_you_will_receive_a_password_reset_link","Could not request a reset link. Check the connection and try again.":"interface.messages.admin_setup_could_not_request_a_reset_link_check_the_connection_and_try_again","Saving new password…":"interface.messages.admin_setup_saving_new_password","Could not save the new password. Check the connection and password requirements, then try again.":"interface.messages.admin_setup_could_not_save_the_new_password_check_the_connection_and_password_requirements_then_try_again","Password updated. Sign in with your new password.":"interface.messages.admin_setup_password_updated_sign_in_with_your_new_password","Could not end the recovery session. Try returning to sign-in again.":"interface.messages.admin_setup_could_not_end_the_recovery_session_try_returning_to_sign_in_again","For a new project, use the setup wizard to create your first administrator.":"interface.messages.admin_setup_for_a_new_project_use_the_setup_wizard_to_create_your_first_administrator","Installation":"interface.messages.admin_setup_installation","Supabase Cloud":"interface.messages.admin_setup_supabase_cloud","Local Supabase":"interface.messages.admin_setup_local_supabase","Local mode creates the first administrator on an installed empty schema. Complete the local database, Auth and Edge Function installation first.":"interface.messages.admin_setup_local_mode_creates_the_first_administrator_on_an_installed_empty_schema_complete_the_local_database_","Local PostgreSQL connection":"interface.messages.admin_setup_local_postgresql_connection","Create your administrator":"interface.messages.admin_setup_create_your_administrator","Show password":"interface.messages.admin_setup_show_password","Manage your event, invitations and administrator access.":"interface.messages.admin_setup_manage_your_event_invitations_and_administrator_access","Create administrator":"interface.messages.admin_setup_create_administrator","The passwords do not match.":"interface.messages.admin_setup_the_passwords_do_not_match","First-time setup is closed":"interface.messages.admin_setup_first_time_setup_is_closed","Sign in to manage this installation.":"interface.messages.admin_setup_sign_in_to_manage_this_installation","Open sign-in":"interface.messages.admin_setup_open_sign_in","Setup could not be verified":"interface.messages.admin_setup_setup_could_not_be_verified","Check the configured connection before continuing.":"interface.messages.admin_setup_check_the_configured_connection_before_continuing","Create the first Supabase Auth account and administrator access with the trusted setup companion.":"interface.messages.admin_setup_create_the_first_supabase_auth_account_and_administrator_access_with_the_trusted_setup_companion","Provide the local connection, privileged credentials and website address.":"interface.messages.admin_setup_provide_the_local_connection_privileged_credentials_and_website_address","Use valid local API, PostgreSQL and website addresses.":"interface.messages.admin_setup_use_valid_local_api_postgresql_and_website_addresses","Local setup connects only to loopback Supabase and PostgreSQL addresses.":"interface.messages.admin_setup_local_setup_connects_only_to_loopback_supabase_and_postgresql_addresses","The local database check could not be completed. Check its connection and schema, then retry.":"interface.messages.admin_setup_the_local_database_check_could_not_be_completed_check_its_connection_and_schema_then_retry","Install the current local database schema before creating its first administrator.":"interface.messages.admin_setup_install_the_current_local_database_schema_before_creating_its_first_administrator","Resume the matching setup mode, release and website address. Existing installation progress will not be replaced.":"interface.messages.admin_setup_resume_the_matching_setup_mode_release_and_website_address_existing_installation_progress_will_not_b","Required local schema objects or permissions are missing. Complete the local installation first.":"interface.messages.admin_setup_required_local_schema_objects_or_permissions_are_missing_complete_the_local_installation_first","The local API setup checkpoint could not be verified. Complete the local installation first.":"interface.messages.admin_setup_the_local_api_setup_checkpoint_could_not_be_verified_complete_the_local_installation_first","The local API and database setup checkpoints differ. Verify both connections before continuing.":"interface.messages.admin_setup_the_local_api_and_database_setup_checkpoints_differ_verify_both_connections_before_continuing","Use the supported local setup steps.":"interface.messages.admin_setup_use_the_supported_local_setup_steps","Confirm the existing Auth account before using it for first administrator setup.":"interface.messages.admin_setup_confirm_the_existing_auth_account_before_using_it_for_first_administrator_setup","The local Auth account does not match the database connection. Verify both connections before continuing.":"interface.messages.admin_setup_the_local_auth_account_does_not_match_the_database_connection_verify_both_connections_before_continu","An Edge Function could not be reached. Complete local deployment and retry verification.":"interface.messages.admin_setup_an_edge_function_could_not_be_reached_complete_local_deployment_and_retry_verification","Verify database":"interface.messages.admin_setup_verify_database","The local event already contains data. First-time setup will not change it.":"interface.messages.admin_setup_the_local_event_already_contains_data_first_time_setup_will_not_change_it","Connect Supabase and create your administrator.":"interface.messages.admin_setup_connect_supabase_and_create_your_administrator","Choose Cloud or Local after starting the companion.":"interface.messages.admin_setup_choose_cloud_or_local_after_starting_the_companion","iPhone Shortcuts":"interface.messages.shortcut_title","Prepare reviewed WhatsApp invitations in batches of up to 10. Device processing, organizer-confirmed Sent and RSVP remain separate.":"interface.messages.shortcut_help","Publish the event before preparing live invitation batches.":"interface.messages.shortcut_unpublished","A trusted HTTPS website and callback API are required before using iPhone Shortcuts.":"interface.messages.shortcut_https","Sending permission is required to prepare or resume batches.":"interface.messages.shortcut_permission","Use a compatible installed Shortcut. WhatsApp photo handling still needs testing on your iPhone.":"interface.messages.shortcut_device_help","Ready WhatsApp drafts":"interface.messages.shortcut_ready","Batch size":"interface.messages.shortcut_batch_size","Maximum 10":"interface.messages.shortcut_limit","Ready invitations":"interface.messages.shortcut_new","Review interrupted or failed attempts":"interface.messages.shortcut_retry_title","Earlier actions may have completed. Review the previous outcome and stop the old device run before choosing an explicit retry.":"interface.messages.shortcut_retry_help","No eligible Ready WhatsApp drafts.":"interface.messages.shortcut_no_ready","Include in batch":"interface.messages.shortcut_select","Review message and JPEG":"interface.messages.shortcut_review","I reviewed the selected recipients, messages, invitation links and pictures.":"interface.messages.shortcut_reviewed","I stopped previous device runs and reviewed uncertain outcomes.":"interface.messages.shortcut_retry_ack","Send with iPhone Shortcuts":"interface.messages.shortcut_prepare","Prepare explicit retry":"interface.messages.shortcut_retry","Create a new attempt for these selected deliveries? Do this only after stopping the earlier device run and reviewing what was completed.":"interface.messages.shortcut_confirm_retry","The selected drafts changed. Review them again before preparing a batch.":"interface.messages.shortcut_selection_changed","The request could not be confirmed. Refresh batch history before trying again; do not repeat a send.":"interface.messages.shortcut_error","Batch prepared. Copy launch input, then open the installed Shortcut. Preparation does not confirm sending.":"interface.messages.shortcut_prepared","Batch history":"interface.messages.shortcut_history","No Shortcuts batches yet.":"interface.messages.shortcut_no_history","Refresh progress":"interface.messages.shortcut_refresh","Prepared":"interface.messages.shortcut_created","Authorization expires":"interface.messages.shortcut_expires","Processing":"interface.messages.shortcut_state","Processed by Shortcuts":"interface.messages.shortcut_processed","Partially processed":"interface.messages.shortcut_partial","Outcome unknown":"interface.messages.shortcut_unknown","Skipped":"interface.messages.shortcut_skipped","Revoked":"interface.messages.shortcut_revoked","Resume this batch":"interface.messages.shortcut_resume","Renews authorization for this same batch. Existing results and uncertain attempts are preserved.":"interface.messages.shortcut_resume_help","Revoke batch":"interface.messages.shortcut_revoke","Revoke this batch? Any in-progress actions may already have occurred and will remain uncertain.":"interface.messages.shortcut_confirm_revoke","Batch authorization revoked. Review any uncertain actions before an explicit retry.":"interface.messages.shortcut_revoked_notice","Copy launch input":"interface.messages.shortcut_copy","Launch input copied. Open the installed Shortcut, then replace the clipboard with harmless text.":"interface.messages.shortcut_copied","Open RSVP Batch Runner":"interface.messages.shortcut_runner","Open RSVP Upload Results":"interface.messages.shortcut_uploader","Clear device authorization":"interface.messages.shortcut_clear","Resume a batch to obtain fresh device authorization.":"interface.messages.shortcut_no_cap","Intended recipient":"interface.messages.shortcut_recipient","Handed to Shortcuts":"interface.messages.shortcut_handed","Verified sent":"interface.messages.shortcut_verified","Organizer-confirmed Sent":"interface.messages.shortcut_confirmed","First invitation visit":"interface.messages.shortcut_first_visit","Most recent invitation visit":"interface.messages.shortcut_last_visit","Visit count":"interface.messages.shortcut_visits","RSVP status":"interface.messages.shortcut_rsvp","Visits do not imply an RSVP response. Administrator previews are excluded.":"interface.messages.shortcut_visit_help","No reliable delivery evidence":"interface.messages.shortcut_unverified","Not yet":"interface.messages.shortcut_not_yet","Text processed":"interface.messages.shortcut_text","Picture processed":"interface.messages.shortcut_photo","Not required":"interface.messages.shortcut_not_required","Completed":"interface.messages.shortcut_complete","Incomplete":"interface.messages.shortcut_incomplete","Reply received":"interface.messages.shortcut_replied","Confirmed RSVP":"interface.messages.shortcut_confirmed_rsvp","Shortcut installation and recovery":"interface.messages.shortcut_native_instructions","Live invitations":"interface.messages.shortcut_mode_live","Synthetic dry run":"interface.messages.shortcut_mode_dry_run","Synthetic live test":"interface.messages.shortcut_mode_live_test","Pending processing":"interface.messages.shortcut_pending","When":"interface.messages.compact_when","RSVP by":"interface.messages.compact_rsvp_by","Contact & website":"interface.messages.compact_contact_website","Event type":"interface.messages.compact_event_type","Groups":"interface.messages.compact_groups","Labels":"interface.messages.compact_labels","Grouping":"interface.messages.compact_grouping","Flat list":"interface.messages.compact_flat_list","Other tasks":"interface.messages.compact_other_tasks","Organizer":"interface.messages.compact_organizer","Apple Shortcuts (experimental)":"interface.messages.experimental_shortcuts","Enable Apple Shortcuts (experimental)":"interface.messages.experimental_shortcuts_enable","Disabled by default. Enabling this feature does not publish the event or grant sending access.":"interface.messages.experimental_shortcuts_help","Your experimental setting could not be saved. Refresh and try again.":"interface.messages.experimental_shortcuts_save_error","Apple Shortcuts is disabled. Enable the experimental feature in Interface settings.":"interface.messages.experimental_shortcuts_disabled","Wipe all":"interface.messages.database_wipe_all","Permanently clears application data, private pictures, invitation links, replies, food commitments, delivery history and application administrator access.":"interface.messages.database_wipe_help","Supabase Auth accounts and passwords, database schema and connection settings are retained.":"interface.messages.database_wipe_scope","Retain current administrator":"interface.messages.database_wipe_keep","Keeps only your current administrator access to this application.":"interface.messages.database_wipe_keep_help","Unpublish the event before preparing a wipe.":"interface.messages.database_wipe_unpublish","Review wipe":"interface.messages.database_wipe_review","Current event":"interface.messages.database_wipe_current_event","Review the current data and download the safety backup before continuing.":"interface.messages.database_wipe_review_help","Safety backup downloaded. Store it privately before wiping application data.":"interface.messages.database_wipe_prepared","Type WIPE to confirm":"interface.messages.database_wipe_confirmation","Wipe preparation expires: {time}":"interface.messages.database_wipe_expires","Are you really sure. This can NOT be undone":"interface.messages.database_wipe_confirm_question","Yes":"interface.messages.confirmation_yes","No":"interface.messages.confirmation_no","Application data cleared. The event is unpublished.":"interface.messages.database_wipe_done","Application data cleared. Refresh the page before continuing.":"interface.messages.database_wipe_done_refresh","Application data cleared. Sign out to finish.":"interface.messages.database_wipe_done_logout","The wipe review could not be prepared. Refresh and try again.":"interface.messages.database_wipe_review_error","The safety backup could not be downloaded. Review the current data and prepare again.":"interface.messages.database_wipe_prepare_error","The wipe could not be confirmed. Review the current data and prepare again before retrying.":"interface.messages.database_wipe_error","Wipe preparation expired. Review the current data and prepare again.":"interface.messages.database_wipe_expired","Delivery drafts and records":"interface.messages.database_wipe_delivery_count","RSVP submissions":"interface.messages.database_wipe_rsvp_count","Food commitments":"interface.messages.database_wipe_food_count","Grouped":"interface.messages.compact_grouped","If unchecked, application administrator access is removed and you will be signed out. First-administrator setup will be required.":"interface.messages.database_wipe_remove_help","Make/Send bulk invites":"interface.messages.bulk_invites","Create all household templates":"interface.messages.bulk_invites_create","Messages":"interface.messages.bulk_invites_messages","Shown Services":"interface.messages.bulk_invites_shown_groups","Send via Apple Shortcuts":"interface.messages.bulk_invites_shortcuts","Apple Share":"interface.messages.bulk_invites_share","Copy & Paste":"interface.messages.bulk_invites_copy","Review selected drafts":"interface.messages.bulk_invites_review_drafts","{count} of 10 selected":"interface.messages.bulk_invites_selected","Publish the event to activate sending.":"interface.messages.bulk_invites_unpublished","Review incomplete drafts in Invites and mark them ready.":"interface.messages.bulk_invites_incomplete","Bulk invites could not be refreshed.":"interface.messages.bulk_invites_refresh_error","{count} invitations prepared.":"interface.messages.bulk_invites_prepared","Bulk preparation stopped. Review the list before trying again.":"interface.messages.bulk_invites_prepare_error","Copy the selected message.":"interface.messages.bulk_invites_copy_selection","Review selected invitations":"interface.messages.bulk_invites_review_selected","Select invitation for {household}":"interface.messages.bulk_invites_select_household","No Draft":"interface.messages.bulk_invites_no_draft","Shown Invites":"interface.messages.bulk_invites_shown_invites","Sent":"interface.messages.bulk_invites_filter_sent"}'::jsonb$$;

CREATE OR REPLACE FUNCTION app_private.validate_backup(b jsonb) RETURNS jsonb
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
 PERFORM app_private.validate_guest_interface_modes(payload->'tables'->'public.event_settings'->0->'guest_interface_modes',ARRAY(SELECT value->>'language_code' FROM jsonb_array_elements(payload->'tables'->'public.event_languages')));
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.message_templates') x WHERE x->>'template_key' LIKE 'invitation:%' GROUP BY x->>'template_key' HAVING count(DISTINCT x->>'template_name')<>1 OR count(DISTINCT (x->'delivery_channels')::text)<>1) THEN RAISE EXCEPTION 'Inconsistent named invitation template';END IF;
 PERFORM app_private.validate_food_category_tree(payload->'tables'->'public.food_categories'); PERFORM app_private.validate_backup_selection(payload); RETURN jsonb_build_object('selection',payload->'selection','rows',n,'counts',payload->'counts','event_name',payload->'tables'->'public.event_settings'->0->>'event_name','created_at',payload->>'created_at');
END $$;

CREATE OR REPLACE FUNCTION public.admin_load_data() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h boolean:=public.admin_has_permission('households');i boolean:=public.admin_has_permission('invites');f boolean:=public.admin_has_permission('food');v boolean:=public.admin_has_permission('venues');l boolean:=public.admin_has_permission('languages');o boolean:=public.admin_has_permission('other');s boolean:=public.admin_has_permission('settings');result jsonb;t text;k text;rows jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 result:=jsonb_build_object(
 'settings',coalesce((SELECT CASE WHEN s THEN to_jsonb(e)||jsonb_build_object('guest_customization_revision',app_private.guest_customization_revision(),'invitation_album_revision',md5(e.invitation_picture_album::text)) ELSE jsonb_build_object('id',e.id,'event_name',e.event_name,'event_date',e.event_date,'timezone',e.timezone,'default_language',e.default_language,'fallback_language',e.fallback_language,'is_published',e.is_published,'food_introduction',CASE WHEN l THEN e.food_introduction ELSE '{}'::jsonb END,'guest_title_visibility',CASE WHEN l THEN e.guest_title_visibility ELSE '{}'::jsonb END,'rsvp_deadline',CASE WHEN l OR i THEN e.rsvp_deadline ELSE NULL END,'food_stage',e.food_stage,'food_enabled',e.food_enabled,'other_enabled',e.other_enabled,'planning_config',e.planning_config,'notification_preferences',jsonb_build_object('admin',e.notification_preferences->'admin')) END FROM public.event_settings e WHERE id=1),'null'),

 'sessionInvitationLocks',CASE WHEN i THEN coalesce((SELECT jsonb_agg(h.id) FROM public.households h WHERE h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions x WHERE x.household_id=h.id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit x WHERE x.household_id=h.id)),'[]'::jsonb) ELSE '[]'::jsonb END,
 'guestFoodReplies',CASE WHEN l THEN coalesce((SELECT jsonb_agg(jsonb_build_object('template_key',template_key,'language_code',language_code,'body',body) ORDER BY template_key,language_code) FROM public.message_templates WHERE template_key IN ('food-interest-reply','food-interest-reply-no-deadline') AND channel='manual' AND is_active),'[]') ELSE '[]'::jsonb END,
 'invitationTemplates',CASE WHEN s OR i THEN app_private.invitation_templates() ELSE '[]'::jsonb END,
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
  IF t='invitation_send_queue' THEN SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO rows FROM jsonb_array_elements(rows) WHERE NOT EXISTS(SELECT 1 FROM public.invitation_delivery_audit a WHERE a.queue_id=(value->>'id')::uuid AND a.action='draft_deleted');END IF;
  result:=result||jsonb_build_object(k,rows);
 END LOOP;
 -- History uses the existing Invites read permission and never exposes operational credentials.
 result:=result||jsonb_build_object(
 'shortcutBatches',CASE WHEN i THEN coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC,a.id) FROM public.invitation_shortcut_batches a),'[]'::jsonb) ELSE '[]'::jsonb END,
 'shortcutItems',CASE WHEN i THEN coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.batch_id,a.ordinal) FROM public.invitation_shortcut_items a),'[]'::jsonb) ELSE '[]'::jsonb END,
 'shortcutAttempts',CASE WHEN i THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',a.id,'batch_id',a.batch_id,'queue_id',a.queue_id,'attempt_number',a.attempt_number,
  'state',a.state,'started_at',a.started_at,'completed_at',a.completed_at,
  'text_processed',a.text_processed,'photo_processed',a.photo_processed,
  'error_stage',a.error_stage,'error_message',a.error_message,
  'claim_active',a.state='claimed' AND EXISTS(SELECT 1 FROM app_private.invitation_shortcut_leases l WHERE l.attempt_id=a.id AND l.expires_at>clock_timestamp())
 ) ORDER BY a.batch_id,a.queue_id,a.attempt_number) FROM public.invitation_shortcut_attempts a),'[]'::jsonb) ELSE '[]'::jsonb END);
 result:=jsonb_set(result,'{settings}',CASE WHEN jsonb_typeof(result->'settings')='object' THEN (result->'settings')||jsonb_build_object('apple_shortcuts_enabled',CASE WHEN s OR i THEN coalesce((SELECT enabled FROM app_private.shortcut_runtime WHERE singleton),false) ELSE false END) ELSE result->'settings' END);
 RETURN result || jsonb_build_object('foodGroups',CASE WHEN f THEN coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM public.food_groups g),'[]'::jsonb) ELSE '[]'::jsonb END);
END $$;

CREATE OR REPLACE FUNCTION public.admin_save_delivery(p_id uuid, p_household_id uuid, p_values jsonb, p_expected_revision integer DEFAULT NULL::integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE h public.households%ROWTYPE;q public.invitation_send_queue%ROWTYPE;c public.household_contacts%ROWTYPE;cid uuid:=nullif(p_values->>'contact_id','')::uuid;v_id uuid:=p_id;v_status text:=p_values->>'status';recipient jsonb;destination text;guest public.guests;
BEGIN PERFORM app_private.require_admin_operation('admin_save_delivery');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF v_status IS NULL OR v_status NOT IN ('draft','ready','cancelled','failed') OR p_values->>'channel' IS NULL OR p_values->>'channel' NOT IN ('email','whatsapp','sms','postal','manual') OR nullif(btrim(p_values->>'message_body'),'') IS NULL OR length(p_values->>'message_body')>10000 OR length(coalesce(p_values->>'message_subject',''))>300 OR length(coalesce(p_values->>'reason',''))>2000 THEN RAISE EXCEPTION 'Enter valid delivery details';END IF;
 IF p_values ? 'only_if_missing' AND (jsonb_typeof(p_values->'only_if_missing') IS DISTINCT FROM 'boolean' OR p_id IS NOT NULL OR v_status<>'draft') THEN
  RAISE EXCEPTION 'Only-if-missing requires a Boolean for a new delivery draft';
 END IF;
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

 -- Bulk preparation checks under the same lock as ordinary draft creation.
 IF p_values->'only_if_missing' = 'true'::jsonb AND EXISTS (
  SELECT 1 FROM public.invitation_send_queue WHERE household_id=h.id AND status<>'cancelled'
 ) THEN RETURN NULL;END IF;

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
  destination:=CASE p_values->>'channel' WHEN 'email' THEN guest.email WHEN 'sms' THEN guest.mobile WHEN 'whatsapp' THEN guest.mobile WHEN 'postal' THEN h.postal_address ELSE btrim(concat_ws(' ',nullif(btrim(h.household_name),''),nullif(btrim(h.last_name),''))) END;
 recipient:=jsonb_build_object('contact_name',coalesce(nullif(concat_ws(' ',guest.first_name,guest.last_name),''),btrim(concat_ws(' ',nullif(btrim(h.household_name),''),nullif(btrim(h.last_name),'')))),'contact_type',p_values->>'channel','contact_value',destination);
 END IF;
 IF v_status='ready' AND nullif(btrim(destination),'') IS NULL THEN RAISE EXCEPTION 'Recipient details required before marking ready';END IF;
 IF p_id IS NULL THEN INSERT INTO public.invitation_send_queue(household_id,channel,message_body,created_by) VALUES(h.id,p_values->>'channel',p_values->>'message_body',auth.uid()) RETURNING id INTO v_id;END IF;

 IF v_status='ready' AND (coalesce(p_values->>'message_body','') ~ '[{}]' OR coalesce(p_values->>'message_subject','') ~ '[{}]') THEN RAISE EXCEPTION 'Replace unresolved placeholders before marking ready';END IF;
 UPDATE public.invitation_send_queue SET contact_id=cid,channel=p_values->>'channel',message_subject=nullif(btrim(p_values->>'message_subject'),''),message_body=p_values->>'message_body',message_image=nullif(p_values->'message_image','null'::jsonb),status=v_status,recipient_snapshot=recipient,invitation_code_snapshot=h.invite_code,revision=CASE WHEN p_id IS NULL THEN 1 ELSE revision+1 END,updated_at=clock_timestamp() WHERE id=v_id;
 END IF;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value,reason) SELECT v_id,auth.uid(),CASE WHEN p_id IS NULL THEN 'created' ELSE v_status END,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(q)-'invitation_code_snapshot' END,to_jsonb(n)-'invitation_code_snapshot',nullif(btrim(p_values->>'reason'),'') FROM public.invitation_send_queue n WHERE n.id=v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_save_invitation_template(p_id uuid,p_values jsonb,p_expected jsonb DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE target uuid:=coalesce(p_id,gen_random_uuid());key text:='invitation:'||target::text;existing jsonb;v record;channels text[];label text;subject_text text;body_text text;image jsonb;venue uuid;session uuid;saved integer:=0;enabled text[];short_text text;
BEGIN
 PERFORM app_private.require_permission('settings','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 existing:=app_private.invitation_template(target);
 IF p_id IS NOT NULL AND (existing IS NULL OR existing IS DISTINCT FROM p_expected) THEN RAISE EXCEPTION 'Template changed; reload before saving';END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR jsonb_typeof(p_values->'channels') IS DISTINCT FROM 'array' OR jsonb_typeof(p_values->'versions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid invitation template';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_values->'channels') x WHERE jsonb_typeof(x)<>'string') THEN RAISE EXCEPTION 'Choose at least one service';END IF;
 channels:=ARRAY(SELECT jsonb_array_elements_text(p_values->'channels'));label:=btrim(coalesce(p_values->>'name',''));
 IF NOT app_private.valid_template_channels(channels) OR length(label) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a template name and choose at least one service';END IF;
 IF EXISTS(SELECT 1 FROM public.message_templates WHERE template_key LIKE 'invitation:%' AND template_key<>key AND lower(template_name)=lower(label)) THEN RAISE EXCEPTION 'Choose a different template name';END IF;
 DELETE FROM public.message_templates WHERE template_key=key;
 FOR v IN SELECT * FROM jsonb_each(p_values->'versions') LOOP
  IF jsonb_typeof(v.value) IS DISTINCT FROM 'object' OR NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=v.key) THEN RAISE EXCEPTION 'Choose an event language';END IF;
  IF v.value ? 'options' AND jsonb_typeof(v.value->'options') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Choose valid content options';END IF;
  enabled:=ARRAY(SELECT jsonb_array_elements_text(coalesce(v.value->'options','["subject","message","picture"]'::jsonb)));
  IF cardinality(enabled) NOT BETWEEN 1 AND 4 OR NOT enabled<@ARRAY['subject','message','shortMessage','picture']::text[] OR array_position(enabled,NULL) IS NOT NULL OR cardinality(enabled)<>(SELECT count(DISTINCT x) FROM unnest(enabled) x) THEN RAISE EXCEPTION 'Choose valid content options';END IF;
  subject_text:=btrim(coalesce(v.value->>'subject',''),E' \t\r\n');body_text:=btrim(coalesce(v.value->>'body',''),E' \t\r\n');image:=nullif(v.value->'message_image','null'::jsonb);short_text:=btrim(coalesce(v.value->>'short_body',''));
  IF length(short_text)>4000 OR short_text ~ E'[\r\n]' OR NOT app_private.valid_placeholder_text(short_text) OR ('shortMessage'=ANY(enabled) AND strpos(short_text,'{invitation_link}')=0) THEN RAISE EXCEPTION 'Include a valid invitation link in the short message';END IF;
  IF body_text='' THEN body_text:='{invitation_link}';END IF;
  IF length(subject_text)>300 OR subject_text ~ E'[\r\n]' OR length(body_text)>4000 OR strpos(body_text,'{invitation_link}')=0 OR NOT app_private.valid_placeholder_text(subject_text) OR NOT app_private.valid_placeholder_text(body_text) THEN RAISE EXCEPTION 'Include a valid invitation link placeholder and message';END IF;
  IF image IS NOT NULL THEN PERFORM app_private.validate_private_jpeg(image);END IF;
  venue:=nullif(v.value->>'context_venue_id','')::uuid;session:=nullif(v.value->>'context_session_id','')::uuid;
  IF venue IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=venue AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active venue';END IF;
  IF session IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_sessions WHERE id=session AND is_active AND (venue IS NULL OR location_id=venue)) THEN RAISE EXCEPTION 'Choose a session at the selected venue';END IF;
  INSERT INTO public.message_templates(template_key,template_name,delivery_channels,language_code,channel,subject,body,message_image,context_venue_id,context_session_id,content_options,short_body)
   VALUES(key,label,channels,v.key,'manual',nullif(subject_text,''),body_text,image,venue,session,enabled,short_text);
  saved:=saved+1;
 END LOOP;
 IF saved=0 THEN RAISE EXCEPTION 'Add a message in at least one language';END IF;
 RETURN target;
END $$;

CREATE POLICY invitation_template_delete ON public.message_templates AS RESTRICTIVE FOR DELETE TO authenticated USING ((template_key NOT LIKE 'invitation:%'));

CREATE POLICY invitation_template_insert ON public.message_templates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((template_key NOT LIKE 'invitation:%'));

CREATE POLICY invitation_template_update ON public.message_templates AS RESTRICTIVE FOR UPDATE TO authenticated USING ((template_key NOT LIKE 'invitation:%')) WITH CHECK ((template_key NOT LIKE 'invitation:%'));

CREATE OR REPLACE FUNCTION public.get_setup_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT jsonb_build_object(
  'initialized', EXISTS (SELECT 1 FROM public.admins WHERE access_state='active')
    AND COALESCE((SELECT initialized_at IS NOT NULL FROM app_private.installation_state WHERE id),true),
  'setup_locked', EXISTS (SELECT 1 FROM public.admins)
    OR EXISTS (SELECT 1 FROM app_private.installation_state WHERE id AND initialized_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.event_settings WHERE is_published),
  'schema_version','20261114034908')
$$;

CREATE OR REPLACE FUNCTION public.admin_replace_event_data(p_backup jsonb,p_confirmation text,p_safety_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE receipt app_private.restore_safety_receipts%ROWTYPE;result jsonb;t text;
BEGIN
 PERFORM app_private.require_event_replacement(p_backup);
 IF p_confirmation IS DISTINCT FROM 'REPLACE '||coalesce(p_backup->'payload'->'tables'->'public.event_settings'->0->>'event_name','') THEN RAISE EXCEPTION 'Type REPLACE followed by the source event name';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',t::regclass);END LOOP;
 SELECT * INTO receipt FROM app_private.restore_safety_receipts WHERE id=p_safety_token AND operation='replace' AND actor=auth.uid() AND session_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid FOR UPDATE;
 IF NOT FOUND OR receipt.created_at<clock_timestamp()-interval '30 minutes' OR receipt.source_checksum IS DISTINCT FROM p_backup->>'checksum' THEN RAISE EXCEPTION 'Download a fresh safety backup before replacement';END IF;
 IF receipt.destination_state IS DISTINCT FROM app_private.replacement_state() THEN RAISE EXCEPTION 'Destination changed; validate the backup again';END IF;
 result:=app_private.restore_backup_data(p_backup,true);
 DELETE FROM app_private.restore_safety_receipts WHERE id=p_safety_token;
 RETURN result||jsonb_build_object('event_data_replaced',true,'current_access_preserved',true);
END $$;

REVOKE ALL ON FUNCTION app_private.restore_backup_data(jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.invitation_templates() RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT coalesce(jsonb_agg(document ORDER BY document->>'name',document->>'id'),'[]'::jsonb) FROM (
  SELECT jsonb_build_object('id',substring(template_key FROM 12),'name',min(template_name),'channels',min(to_jsonb(delivery_channels)::text)::jsonb,
   'versions',jsonb_object_agg(language_code,jsonb_build_object('subject',coalesce(subject,''),'body',body,'message_image',message_image,'context_venue_id',context_venue_id,'context_session_id',context_session_id,'options',coalesce(content_options,ARRAY['subject','message','picture']::text[]),'short_body',coalesce(short_body,'')))) document
  FROM public.message_templates WHERE template_key LIKE 'invitation:%' AND is_active GROUP BY template_key
 ) named
$$;

CREATE FUNCTION app_private.invitation_template(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT value FROM jsonb_array_elements(app_private.invitation_templates()) WHERE value->>'id'=p_id::text
$$;

CREATE FUNCTION app_private.valid_template_channels(value text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT coalesce(cardinality(value) BETWEEN 1 AND 4 AND array_ndims(value)=1 AND array_position(value,NULL) IS NULL
  AND value<@ARRAY['email','sms','whatsapp','manual']::text[] AND cardinality(value)=(SELECT count(DISTINCT item) FROM unnest(value) item),false)
$$;

CREATE FUNCTION public.admin_delete_invitation_template(p_id uuid,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 IF app_private.invitation_template(p_id) IS NULL OR app_private.invitation_template(p_id) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Template changed; reload before deleting';END IF;
 DELETE FROM public.message_templates WHERE template_key='invitation:'||p_id::text;
END $$;

ALTER TABLE public.message_templates ADD CONSTRAINT template_content_options_check CHECK (content_options IS NULL OR (cardinality(content_options) BETWEEN 1 AND 4 AND array_ndims(content_options)=1 AND array_position(content_options,NULL) IS NULL AND content_options<@ARRAY['subject','message','shortMessage','picture']::text[]));

ALTER TABLE public.message_templates ADD CONSTRAINT template_short_body_check CHECK (short_body IS NULL OR (length(short_body)<=4000 AND short_body !~ E'[\r\n]' AND app_private.valid_placeholder_text(short_body) AND (NOT coalesce('shortMessage'=ANY(content_options),false) OR strpos(short_body,'{invitation_link}')>0)));

ALTER TABLE public.message_templates ADD CONSTRAINT named_invitation_template_check CHECK (
 (template_key NOT LIKE 'invitation:%' AND template_key<>'invitation' AND template_name IS NULL AND delivery_channels IS NULL)
 OR (template_key ~ '^invitation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND channel='manual'
  AND template_name IS NOT NULL AND length(btrim(template_name)) BETWEEN 1 AND 120 AND app_private.valid_template_channels(delivery_channels))
);

REVOKE ALL ON FUNCTION app_private.invitation_templates(),app_private.invitation_template(uuid),app_private.valid_template_channels(text[]) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_save_invitation_template(uuid,jsonb,jsonb),public.admin_delete_invitation_template(uuid,jsonb) FROM PUBLIC,anon,service_role;

GRANT EXECUTE ON FUNCTION public.admin_save_invitation_template(uuid,jsonb,jsonb),public.admin_delete_invitation_template(uuid,jsonb) TO authenticated;

CREATE FUNCTION app_private.guest_interface_defaults(e public.event_settings,p_mode text) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT jsonb_build_object('guest_title_visibility',CASE WHEN p_mode='phone' THEN (SELECT coalesce(jsonb_object_agg(language_code,false),'{}') FROM public.event_languages) ELSE e.guest_title_visibility END,'show_repeated_surname',e.show_repeated_surname,'guest_name_layout',CASE WHEN p_mode='phone' THEN 'above' ELSE 'inline' END,'guest_design',e.guest_design,'guest_background',e.guest_background,'guest_theme_toggle',e.guest_theme_toggle,'guest_theme_default',e.guest_theme_default,'notification_preferences',e.notification_preferences)||coalesce(e.guest_interface_modes->p_mode,'{}')||jsonb_build_object('guest_title_visibility',(CASE WHEN p_mode='phone' THEN (SELECT coalesce(jsonb_object_agg(language_code,false),'{}') FROM public.event_languages) ELSE e.guest_title_visibility END)||coalesce(e.guest_interface_modes->p_mode->'guest_title_visibility','{}'))
$$;

CREATE FUNCTION app_private.validate_guest_interface_modes(value jsonb,p_languages text[] DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE m record;k record;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value-ARRAY['phone','wide']<>'{}' THEN RAISE EXCEPTION 'Invalid guest interface modes';END IF;
 FOR m IN SELECT * FROM jsonb_each(value) LOOP
 IF jsonb_typeof(m.value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid guest interface mode';END IF;
 FOR k IN SELECT * FROM jsonb_each(m.value) LOOP
 CASE k.key
 WHEN 'guest_title_visibility' THEN IF jsonb_typeof(k.value) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(k.value) x WHERE jsonb_typeof(x.value)<>'boolean' OR NOT x.key=ANY(coalesce(p_languages,ARRAY(SELECT language_code FROM public.event_languages)))) THEN RAISE EXCEPTION 'Invalid title languages';END IF;
 WHEN 'show_repeated_surname','guest_theme_toggle' THEN IF jsonb_typeof(k.value) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid guest interface choice';END IF;
 WHEN 'guest_name_layout' THEN IF k.value NOT IN ('"above"','"inline"') THEN RAISE EXCEPTION 'Invalid guest name layout';END IF;
 WHEN 'guest_theme_default' THEN IF k.value NOT IN ('"system"','"light"','"dark"') THEN RAISE EXCEPTION 'Invalid guest appearance';END IF;
 WHEN 'guest_design' THEN IF NOT app_private.valid_guest_design(nullif(k.value,'null'::jsonb)) THEN RAISE EXCEPTION 'Invalid guest design';END IF;
 WHEN 'guest_background' THEN IF k.value<>'null' THEN PERFORM app_private.validate_private_jpeg(k.value);END IF;
 WHEN 'notification_preferences' THEN IF NOT app_private.valid_notification_preferences(nullif(k.value,'null'::jsonb)) THEN RAISE EXCEPTION 'Invalid status message preferences';END IF;
 ELSE RAISE EXCEPTION 'Unknown guest interface option';END CASE;
 END LOOP;END LOOP;
END $$;

CREATE FUNCTION app_private.guard_guest_interface_modes() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' AND current_user IN ('anon','authenticated') AND NEW.guest_interface_modes IS DISTINCT FROM OLD.guest_interface_modes THEN RAISE EXCEPTION 'Use the guest interface editor' USING ERRCODE='42501';END IF;
 PERFORM app_private.validate_guest_interface_modes(NEW.guest_interface_modes);RETURN NEW;
END $$;

CREATE TRIGGER guard_guest_interface_modes BEFORE INSERT OR UPDATE OF guest_interface_modes ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_guest_interface_modes();

CREATE FUNCTION public.admin_save_guest_interface(p_mode text,p_values jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE e public.event_settings%ROWTYPE;effective jsonb;k text;
BEGIN
 PERFORM app_private.require_permission('settings','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_mode IS NULL OR p_mode NOT IN ('phone','wide') OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object' OR p_values='{}' THEN RAISE EXCEPTION 'Invalid guest interface update';END IF;
 PERFORM app_private.validate_guest_interface_modes(jsonb_build_object(p_mode,p_values));
 SELECT * INTO STRICT e FROM public.event_settings WHERE id=1 FOR UPDATE;effective:=app_private.guest_interface_defaults(e,p_mode);
 FOR k IN SELECT jsonb_object_keys(p_values) LOOP
 IF NOT p_expected ? k OR (effective->k) IS DISTINCT FROM (p_expected->k) THEN RAISE EXCEPTION 'Guest interface changed; reload before saving';END IF;
 IF k='guest_title_visibility' AND p_values->k IS DISTINCT FROM effective->k THEN PERFORM app_private.require_permission('languages','edit');END IF;
 END LOOP;
 UPDATE public.event_settings SET guest_interface_modes=jsonb_set(guest_interface_modes,ARRAY[p_mode],coalesce(guest_interface_modes->p_mode,'{}')||p_values) WHERE id=1;
END $$;

CREATE FUNCTION app_private.public_guest_interface_modes(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT coalesce(jsonb_object_agg(key,CASE WHEN v ? 'notification_preferences' THEN v||jsonb_build_object('notification_preferences',jsonb_build_object('guest',v->'notification_preferences'->'guest')) ELSE v END),'{}') FROM jsonb_each(value) x(key,v)
$$;

REVOKE ALL ON FUNCTION app_private.guest_interface_defaults(public.event_settings,text),app_private.validate_guest_interface_modes(jsonb,text[]),app_private.guard_guest_interface_modes(),app_private.public_guest_interface_modes(jsonb) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_save_guest_interface(text,jsonb,jsonb) FROM PUBLIC,anon,service_role;

GRANT EXECUTE ON FUNCTION public.admin_save_guest_interface(text,jsonb,jsonb) TO authenticated;

CREATE FUNCTION app_private.require_wipe(b jsonb) RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 PERFORM app_private.require_permission('full');PERFORM app_private.validate_backup(b);
 IF b->'payload'->'selection'->>'mode'<>'backup' OR NOT (b->'payload'->'selection'->'sections' @> '["venues","households","food","other","wording"]'::jsonb) THEN RAISE EXCEPTION 'Wipe requires a complete Full backup';END IF;
 IF (SELECT is_published FROM public.event_settings WHERE id=1) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Wipe destination must be unpublished';END IF;
END $$;

CREATE FUNCTION app_private.wipe_state() RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT encode(sha256(convert_to(app_private.replacement_state()||coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY user_id)::text FROM public.admins a),'[]')||(SELECT installation_id::text FROM app_private.backup_origin WHERE singleton),'UTF8')),'hex')
$$;

CREATE FUNCTION public.admin_preview_wipe(p_backup jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE report jsonb;state text;result jsonb;counts jsonb;
BEGIN
 PERFORM app_private.require_wipe(p_backup);PERFORM pg_advisory_xact_lock(42319,11);PERFORM pg_advisory_xact_lock(19421,7744);LOCK TABLE public.admins IN SHARE ROW EXCLUSIVE MODE;
 report:=app_private.validate_backup(p_backup);state:=app_private.wipe_state();counts:=app_private.backup_payload()->'counts';
 BEGIN
 result:=app_private.restore_backup_data(p_backup,true,true);
 RAISE EXCEPTION USING ERRCODE='P0199',MESSAGE='wipe_preview_rollback';
 EXCEPTION WHEN SQLSTATE 'P0199' THEN RETURN report||jsonb_build_object('can_restore',true,'destination_state',state,'current_counts',counts,'preserves_current_admin',true,'disables_other_admins',true);
 WHEN OTHERS THEN RETURN report||jsonb_build_object('can_restore',false,'reason',SQLERRM);
 END;
END $$;

CREATE FUNCTION public.admin_prepare_wipe(p_backup jsonb,p_expected_state text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE token uuid;state text;candidate jsonb;t text;
BEGIN
 PERFORM app_private.require_wipe(p_backup);PERFORM pg_advisory_xact_lock(42319,11);PERFORM pg_advisory_xact_lock(19421,7744);LOCK TABLE public.admins IN SHARE ROW EXCLUSIVE MODE;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('LOCK TABLE %s IN SHARE MODE',t::regclass);END LOOP;
 state:=app_private.wipe_state();IF state IS DISTINCT FROM p_expected_state THEN RAISE EXCEPTION 'Destination changed; validate the backup again';END IF;
 candidate:=app_private.seal_backup(app_private.backup_payload());
 DELETE FROM app_private.restore_safety_receipts WHERE created_at<clock_timestamp()-interval '30 minutes';
 INSERT INTO app_private.restore_safety_receipts(actor,session_id,source_checksum,destination_state,operation) VALUES(auth.uid(),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid,p_backup->>'checksum',state,'wipe') RETURNING id INTO token;
 RETURN jsonb_build_object('token',token,'safety_backup',candidate,'destination_state',state);
END $$;

CREATE FUNCTION public.admin_wipe_restore(p_backup jsonb,p_confirmation text,p_safety_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE receipt app_private.restore_safety_receipts%ROWTYPE;result jsonb;t text;
BEGIN
 PERFORM app_private.require_wipe(p_backup);
 IF p_confirmation IS DISTINCT FROM 'WIPE '||coalesce(p_backup->'payload'->'tables'->'public.event_settings'->0->>'event_name','') THEN RAISE EXCEPTION 'Type WIPE followed by the source event name';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);PERFORM pg_advisory_xact_lock(19421,7744);LOCK TABLE public.admins IN SHARE ROW EXCLUSIVE MODE;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',t::regclass);END LOOP;
 SELECT * INTO receipt FROM app_private.restore_safety_receipts WHERE id=p_safety_token AND actor=auth.uid() AND session_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid AND operation='wipe' FOR UPDATE;
 IF NOT FOUND OR receipt.created_at<clock_timestamp()-interval '30 minutes' OR receipt.source_checksum IS DISTINCT FROM p_backup->>'checksum' THEN RAISE EXCEPTION 'Download a fresh safety backup before replacement';END IF;
 IF receipt.destination_state IS DISTINCT FROM app_private.wipe_state() THEN RAISE EXCEPTION 'Destination changed; validate the backup again';END IF;
 result:=app_private.restore_backup_data(p_backup,true,true);DELETE FROM app_private.restore_safety_receipts WHERE id=p_safety_token;
 RETURN result||jsonb_build_object('application_data_replaced',true,'current_access_preserved',true,'other_administrators_disabled',true);
END $$;

REVOKE ALL ON FUNCTION app_private.require_wipe(jsonb),app_private.wipe_state() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_preview_wipe(jsonb),public.admin_prepare_wipe(jsonb,text),public.admin_wipe_restore(jsonb,text,uuid) FROM PUBLIC,anon,service_role;

GRANT EXECUTE ON FUNCTION public.admin_preview_wipe(jsonb),public.admin_prepare_wipe(jsonb,text),public.admin_wipe_restore(jsonb,text,uuid) TO authenticated;

CREATE FUNCTION public.admin_delete_delivery_draft(p_id uuid,p_expected_revision integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('invites','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR q.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 IF q.status<>'draft' OR EXISTS(SELECT 1 FROM public.invitation_deliveries WHERE queue_id=q.id) OR EXISTS(SELECT 1 FROM public.invitation_delivery_audit WHERE queue_id=q.id AND action IN ('share_handoff_completed','confirmed_sent','sent','draft_deleted')) THEN RAISE EXCEPTION 'Only unsent drafts can be deleted';END IF;
 UPDATE public.invitation_send_queue SET status='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE id=q.id;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value) SELECT q.id,auth.uid(),'draft_deleted',to_jsonb(q)-'invitation_code_snapshot',to_jsonb(n)-'invitation_code_snapshot' FROM public.invitation_send_queue n WHERE n.id=q.id;
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_delivery_draft(uuid,integer) FROM PUBLIC,anon,service_role;

GRANT EXECUTE ON FUNCTION public.admin_delete_delivery_draft(uuid,integer) TO authenticated;

ALTER TABLE public.invitation_send_queue
 ADD COLUMN handed_to_shortcuts_at timestamptz,
 ADD COLUMN shortcuts_processed_at timestamptz,
 ADD COLUMN verified_sent_at timestamptz,
 ADD COLUMN shortcuts_error text,
 ADD COLUMN shortcuts_attempt_id uuid,
 ADD COLUMN shortcuts_batch_id uuid;

CREATE TABLE public.invitation_shortcut_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 mode text NOT NULL CHECK(mode IN ('live','dry_run','live_test')),
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);

CREATE TABLE public.invitation_shortcut_items (
 batch_id uuid NOT NULL REFERENCES public.invitation_shortcut_batches(id) ON DELETE RESTRICT,
 queue_id uuid NOT NULL REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 10),
 expected_revision integer NOT NULL CHECK(expected_revision>0),
 PRIMARY KEY(batch_id,queue_id), UNIQUE(batch_id,ordinal)
);

CREATE TABLE public.invitation_shortcut_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL,
 queue_id uuid NOT NULL,
 attempt_number integer NOT NULL CHECK(attempt_number>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','processed','partial','failed','unknown','skipped')),
 claim_id uuid UNIQUE,
 started_at timestamptz,
 completed_at timestamptz,
 text_processed boolean NOT NULL DEFAULT false,
 photo_processed boolean NOT NULL DEFAULT false,
 error_stage text CHECK(error_stage IN ('claim','text','photo','device','callback','unknown')),
 error_message text CHECK(length(error_message)<=240),
 result_event_id uuid UNIQUE,
 result_hash text CHECK(result_hash ~ '^[0-9a-f]{64}$'),
 FOREIGN KEY(batch_id,queue_id) REFERENCES public.invitation_shortcut_items(batch_id,queue_id) ON DELETE RESTRICT,
 UNIQUE(batch_id,queue_id), UNIQUE(queue_id,attempt_number),
 CHECK((result_event_id IS NULL)=(result_hash IS NULL))
);

CREATE INDEX invitation_shortcut_items_queue_idx ON public.invitation_shortcut_items(queue_id);

CREATE INDEX invitation_shortcut_attempts_queue_idx ON public.invitation_shortcut_attempts(queue_id,attempt_number DESC);

ALTER TABLE public.invitation_shortcut_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invitation_shortcut_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invitation_shortcut_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.invitation_shortcut_batches,public.invitation_shortcut_items,public.invitation_shortcut_attempts FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT ON public.invitation_shortcut_batches,public.invitation_shortcut_items,public.invitation_shortcut_attempts TO authenticated;

CREATE POLICY shortcut_batches_read ON public.invitation_shortcut_batches FOR SELECT TO authenticated USING(public.admin_has_permission('invites'));

CREATE POLICY shortcut_items_read ON public.invitation_shortcut_items FOR SELECT TO authenticated USING(public.admin_has_permission('invites'));

CREATE POLICY shortcut_attempts_read ON public.invitation_shortcut_attempts FOR SELECT TO authenticated USING(public.admin_has_permission('invites'));

CREATE TABLE app_private.shortcut_runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 generation uuid NOT NULL DEFAULT gen_random_uuid(),
 enabled boolean NOT NULL DEFAULT false,
 test_enabled boolean NOT NULL DEFAULT false,
 test_household_ids uuid[] NOT NULL DEFAULT '{}',
 test_phones text[] NOT NULL DEFAULT '{}'
);

INSERT INTO app_private.shortcut_runtime(singleton) VALUES(true);

CREATE TABLE app_private.invitation_shortcut_capabilities (
 batch_id uuid PRIMARY KEY REFERENCES public.invitation_shortcut_batches(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 installation_id uuid NOT NULL,
 generation uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 scopes text[] NOT NULL DEFAULT ARRAY['manifest','image','claim','results']
);

CREATE TABLE app_private.invitation_shortcut_leases (
 attempt_id uuid PRIMARY KEY REFERENCES public.invitation_shortcut_attempts(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);

CREATE TABLE app_private.shortcut_rate_limits (
 subject_id uuid NOT NULL,
 bucket text NOT NULL CHECK(bucket IN ('create','manifest','image','claim','results')),
 period_start timestamptz NOT NULL,
 request_count integer NOT NULL CHECK(request_count>0),
 PRIMARY KEY(subject_id,bucket,period_start)
);

ALTER TABLE app_private.shortcut_runtime ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_private.invitation_shortcut_capabilities ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_private.invitation_shortcut_leases ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_private.shortcut_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON app_private.shortcut_runtime,app_private.invitation_shortcut_capabilities,app_private.invitation_shortcut_leases,app_private.shortcut_rate_limits FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.revoke_shortcut_capabilities() RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 -- Use non-null keys to clear every row with safeupdate enabled.
 DELETE FROM app_private.invitation_shortcut_capabilities WHERE batch_id IS NOT NULL;
 DELETE FROM app_private.invitation_shortcut_leases WHERE attempt_id IS NOT NULL;
 DELETE FROM app_private.shortcut_rate_limits WHERE subject_id IS NOT NULL;
 DELETE FROM app_private.shortcut_gateway_rate_limits WHERE key_hash IS NOT NULL;
 UPDATE app_private.shortcut_runtime SET generation=gen_random_uuid(),enabled=false,test_enabled=false,test_household_ids='{}',test_phones='{}' WHERE singleton;
END $$;

REVOKE ALL ON FUNCTION app_private.revoke_shortcut_capabilities() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.shortcut_limit(p_subject uuid,p_bucket text) RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE n integer; ceiling integer:=CASE p_bucket WHEN 'create' THEN 20 WHEN 'manifest' THEN 60 WHEN 'image' THEN 120 WHEN 'claim' THEN 60 WHEN 'results' THEN 120 ELSE 0 END;
BEGIN
 INSERT INTO app_private.shortcut_rate_limits(subject_id,bucket,period_start,request_count)
 VALUES(p_subject,p_bucket,date_trunc('minute',clock_timestamp()),1)
 ON CONFLICT(subject_id,bucket,period_start) DO UPDATE SET request_count=app_private.shortcut_rate_limits.request_count+1
 WHERE app_private.shortcut_rate_limits.request_count<ceiling RETURNING request_count INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'Shortcuts request limit exceeded' USING ERRCODE='P0001';END IF;
END $$;

REVOKE ALL ON FUNCTION app_private.shortcut_limit(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE app_private.shortcut_gateway_rate_limits (
 key_hash text NOT NULL CHECK(key_hash ~ '^[0-9a-f]{64}$'),
 bucket text NOT NULL CHECK(bucket IN ('source','token','global')),
 period_start timestamptz NOT NULL,
 request_count integer NOT NULL,
 PRIMARY KEY(key_hash,bucket,period_start)
);

ALTER TABLE app_private.shortcut_gateway_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON app_private.shortcut_gateway_rate_limits FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.shortcut_gateway_allow_request(p_source_hash text,p_token_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE entry record; n integer;
BEGIN
 IF p_source_hash IS NULL OR p_source_hash !~ '^[0-9a-f]{64}$' OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN false;END IF;
 DELETE FROM app_private.shortcut_gateway_rate_limits WHERE period_start<clock_timestamp()-interval '10 minutes';
 -- Admit globally before allocating per-source/token rows, even for random guesses.
 INSERT INTO app_private.shortcut_gateway_rate_limits(key_hash,bucket,period_start,request_count)
 VALUES(repeat('0',64),'global',date_trunc('minute',clock_timestamp()),1)
 ON CONFLICT(key_hash,bucket,period_start) DO UPDATE SET request_count=app_private.shortcut_gateway_rate_limits.request_count+1
 WHERE app_private.shortcut_gateway_rate_limits.request_count<1000 RETURNING request_count INTO n;
 IF n IS NULL THEN RETURN false;END IF;
 FOR entry IN SELECT * FROM (VALUES(p_source_hash,'source',120),(p_token_hash,'token',180)) limits(hash,bucket,ceiling) LOOP
  INSERT INTO app_private.shortcut_gateway_rate_limits(key_hash,bucket,period_start,request_count)
  VALUES(entry.hash,entry.bucket,date_trunc('minute',clock_timestamp()),1)
  ON CONFLICT(key_hash,bucket,period_start) DO UPDATE SET request_count=app_private.shortcut_gateway_rate_limits.request_count+1
  WHERE app_private.shortcut_gateway_rate_limits.request_count<entry.ceiling RETURNING request_count INTO n;
  IF n IS NULL THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.shortcut_gateway_allow_request(text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.shortcut_gateway_allow_request(text,text) TO service_role;

CREATE FUNCTION app_private.shortcut_phone(p_value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT regexp_replace(regexp_replace(coalesce(p_value,''),'[ .()/\-]','','g'),'^00','+')
$$;

REVOKE ALL ON FUNCTION app_private.shortcut_phone(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.freeze_shortcut_queue_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.invitation_shortcut_items WHERE queue_id=OLD.id)
 AND (NEW.household_id,NEW.contact_id,NEW.channel,NEW.message_subject,NEW.message_body,NEW.message_image,NEW.recipient_snapshot,NEW.invitation_code_snapshot)
 IS DISTINCT FROM (OLD.household_id,OLD.contact_id,OLD.channel,OLD.message_subject,OLD.message_body,OLD.message_image,OLD.recipient_snapshot,OLD.invitation_code_snapshot)
 THEN RAISE EXCEPTION 'Delivery snapshot belongs to a Shortcuts batch; create a new delivery';END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION app_private.freeze_shortcut_queue_snapshot() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER freeze_shortcut_queue_snapshot BEFORE UPDATE ON public.invitation_send_queue FOR EACH ROW EXECUTE FUNCTION app_private.freeze_shortcut_queue_snapshot();

CREATE FUNCTION public.admin_create_shortcut_batch(p_items jsonb,p_mode text DEFAULT 'live',p_retry boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE b uuid:=gen_random_uuid(); token text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 expiry timestamptz:=clock_timestamp()+interval '30 minutes'; sid uuid; one record; q public.invitation_send_queue; h public.households;
 prior public.invitation_shortcut_attempts; rt app_private.shortcut_runtime; phone text; n integer; raw jsonb;
BEGIN
 PERFORM app_private.require_permission('sendInvites');
 PERFORM app_private.require_live_session();
 IF p_mode IS NULL OR p_mode NOT IN ('live','dry_run','live_test') OR p_retry IS NULL THEN RAISE EXCEPTION 'Choose a valid Shortcuts mode';END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Choose between 1 and 10 ready WhatsApp deliveries';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR x-ARRAY['queue_id','expected_revision']<>'{}' OR nullif(x->>'queue_id','') IS NULL OR coalesce(x->>'expected_revision','') !~ '^[1-9][0-9]{0,8}$')
 OR (SELECT count(DISTINCT x->>'queue_id') FROM jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Choose distinct deliveries and their current revisions';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published';END IF;
 SELECT * INTO rt FROM app_private.shortcut_runtime WHERE singleton;
 IF NOT coalesce(rt.enabled,false) THEN RAISE EXCEPTION 'Apple Shortcuts is disabled. Enable the experimental feature in Interface settings.' USING ERRCODE='55000';END IF;
 IF p_mode<>'live' AND (NOT rt.test_enabled OR cardinality(rt.test_household_ids)<>6 OR (SELECT count(DISTINCT x) FROM unnest(rt.test_household_ids) x)<>6 OR cardinality(rt.test_phones)<>2 OR (SELECT count(DISTINCT x) FROM unnest(rt.test_phones) x)<>2 OR EXISTS(SELECT 1 FROM unnest(rt.test_phones) x WHERE x !~ '^[+][1-9][0-9]{6,14}$')) THEN RAISE EXCEPTION 'Synthetic Shortcuts test runtime is not configured';END IF;
 PERFORM app_private.shortcut_limit(auth.uid(),'create');
 sid:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id';
 INSERT INTO public.invitation_shortcut_batches(id,mode,created_by,expires_at) VALUES(b,p_mode,auth.uid(),expiry);
 FOR one IN SELECT value,ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY LOOP
  raw:=one.value;
  SELECT * INTO q FROM public.invitation_send_queue WHERE id=(raw->>'queue_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
  SELECT * INTO h FROM public.households WHERE id=q.household_id;
  phone:=app_private.shortcut_phone(q.recipient_snapshot->>'contact_value');
  IF q.status<>'ready' OR q.channel<>'whatsapp' OR q.revision<>(raw->>'expected_revision')::integer OR h.archived_at IS NOT NULL OR h.invite_code IS NULL OR q.invitation_code_snapshot IS DISTINCT FROM h.invite_code OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) OR phone !~ '^[+][1-9][0-9]{6,14}$' OR nullif(btrim(q.message_body),'') IS NULL OR q.message_body ~ '[{}]' OR coalesce(q.message_subject,'') ~ '[{}]' OR q.message_body !~ ('https://[^[:space:]<>]+[?]='||h.invite_code||'([&#[:space:]]|$)') THEN RAISE EXCEPTION 'Refresh and save this ready WhatsApp delivery before batching';END IF;
  IF p_mode<>'live' AND (NOT h.id=ANY(rt.test_household_ids) OR NOT phone=ANY(rt.test_phones)) THEN RAISE EXCEPTION 'Delivery is outside the synthetic test allowlist';END IF;
  IF q.message_image IS NOT NULL THEN PERFORM app_private.validate_private_jpeg(q.message_image);END IF;
  SELECT * INTO prior FROM public.invitation_shortcut_attempts WHERE queue_id=q.id ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE;
  n:=1;
  IF FOUND THEN
   n:=prior.attempt_number+1;
   IF prior.state='processed' OR EXISTS(SELECT 1 FROM public.invitation_shortcut_attempts WHERE queue_id=q.id AND state='processed') THEN RAISE EXCEPTION 'Processed deliveries cannot be repeated; create a new delivery';END IF;
   IF NOT p_retry THEN RAISE EXCEPTION 'Explicit retry acknowledgment is required for this delivery';END IF;
   IF prior.state='pending' AND EXISTS(SELECT 1 FROM public.invitation_shortcut_batches WHERE id=prior.batch_id AND expires_at>clock_timestamp() AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Delivery already belongs to an active batch';END IF;
   IF prior.state='claimed' AND EXISTS(SELECT 1 FROM app_private.invitation_shortcut_leases WHERE attempt_id=prior.id AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Delivery already has an active Shortcuts claim';END IF;
   IF prior.state IN ('pending','claimed') THEN UPDATE public.invitation_shortcut_attempts SET state='unknown',error_stage='claim',error_message='Previous attempt expired; its device outcome is unknown' WHERE id=prior.id;END IF;
  END IF;
  INSERT INTO public.invitation_shortcut_items(batch_id,queue_id,ordinal,expected_revision) VALUES(b,q.id,one.ordinality,q.revision);
  INSERT INTO public.invitation_shortcut_attempts(batch_id,queue_id,attempt_number,text_processed,photo_processed) VALUES(b,q.id,n,coalesce(prior.text_processed,false),coalesce(prior.photo_processed,false));
 END LOOP;
 INSERT INTO app_private.invitation_shortcut_capabilities(batch_id,token_hash,creator_id,session_id,installation_id,generation,expires_at)
 SELECT b,encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid(),sid,o.installation_id,rt.generation,expiry FROM app_private.backup_origin o WHERE singleton;
 RETURN jsonb_build_object('batch_id',b,'capability',token,'expires_at',expiry,'mode',p_mode,'count',jsonb_array_length(p_items));
END $$;

REVOKE ALL ON FUNCTION public.admin_create_shortcut_batch(jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.admin_create_shortcut_batch(jsonb,text,boolean) TO authenticated;

CREATE FUNCTION public.admin_manage_shortcut_batch(p_batch_id uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE b public.invitation_shortcut_batches; token text; expiry timestamptz:=clock_timestamp()+interval '30 minutes'; sid uuid;
BEGIN
 PERFORM app_private.require_permission('sendInvites');
 IF p_action IS NULL OR p_action NOT IN ('renew','revoke') THEN RAISE EXCEPTION 'Choose renew or revoke';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO b FROM public.invitation_shortcut_batches WHERE id=p_batch_id FOR UPDATE;
 IF NOT FOUND OR (b.created_by<>auth.uid() AND NOT public.admin_has_permission('full')) THEN RAISE EXCEPTION 'Batch owner or full administrator access required' USING ERRCODE='42501';END IF;
 IF p_action='revoke' THEN
  UPDATE public.invitation_shortcut_batches SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=b.id;
  DELETE FROM app_private.invitation_shortcut_capabilities WHERE batch_id=b.id;
  DELETE FROM app_private.invitation_shortcut_leases WHERE attempt_id IN(SELECT id FROM public.invitation_shortcut_attempts WHERE batch_id=b.id);
  UPDATE public.invitation_shortcut_attempts SET state=CASE WHEN state='claimed' THEN 'unknown' ELSE 'skipped' END,error_stage='claim',error_message='cancelled' WHERE batch_id=b.id AND state IN ('pending','claimed');
  UPDATE public.invitation_send_queue z SET shortcuts_error='unknown' FROM public.invitation_shortcut_attempts x WHERE x.batch_id=b.id AND x.state='unknown' AND z.id=x.queue_id AND z.shortcuts_attempt_id=x.id;
  RETURN jsonb_build_object('batch_id',b.id,'revoked',true);
 END IF;
 IF b.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Revoked batches cannot be renewed';END IF;
 IF NOT coalesce((SELECT enabled FROM app_private.shortcut_runtime WHERE singleton),false) THEN RAISE EXCEPTION 'Apple Shortcuts is disabled. Enable the experimental feature in Interface settings.' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published';END IF;
 PERFORM app_private.shortcut_limit(auth.uid(),'create');
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 sid:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id';
 INSERT INTO app_private.invitation_shortcut_capabilities(batch_id,token_hash,creator_id,session_id,installation_id,generation,expires_at)
 SELECT b.id,encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid(),sid,o.installation_id,r.generation,expiry FROM app_private.backup_origin o CROSS JOIN app_private.shortcut_runtime r WHERE o.singleton AND r.singleton
 ON CONFLICT(batch_id) DO UPDATE SET token_hash=excluded.token_hash,creator_id=excluded.creator_id,session_id=excluded.session_id,installation_id=excluded.installation_id,generation=excluded.generation,expires_at=excluded.expires_at;
 UPDATE public.invitation_shortcut_batches SET expires_at=expiry WHERE id=b.id;
 RETURN jsonb_build_object('batch_id',b.id,'capability',token,'expires_at',expiry,'mode',b.mode,'count',(SELECT count(*) FROM public.invitation_shortcut_items WHERE batch_id=b.id));
END $$;

REVOKE ALL ON FUNCTION public.admin_manage_shortcut_batch(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.admin_manage_shortcut_batch(uuid,text) TO authenticated;

CREATE FUNCTION public.dispatch_shortcut_batch(p_batch_id uuid,p_token_hash text,p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE cap app_private.invitation_shortcut_capabilities; b public.invitation_shortcut_batches; a public.invitation_shortcut_attempts;
 q public.invitation_send_queue; claim uuid; eid uuid; result text; details jsonb; normalized jsonb; fingerprint text; stage text; errmsg text; text_ok boolean; photo_ok boolean; invitations jsonb; states jsonb; feature_enabled boolean;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('manifest','image','claim','results') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>4096 THEN RAISE EXCEPTION 'Invalid Shortcuts request';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO cap FROM app_private.invitation_shortcut_capabilities WHERE batch_id=p_batch_id AND token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR cap.expires_at<=clock_timestamp() OR NOT p_action=ANY(cap.scopes)
 OR cap.installation_id IS DISTINCT FROM (SELECT installation_id FROM app_private.backup_origin WHERE singleton)
 OR cap.generation IS DISTINCT FROM (SELECT generation FROM app_private.shortcut_runtime WHERE singleton)
 OR NOT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id WHERE s.id=cap.session_id AND s.user_id=cap.creator_id AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>clock_timestamp()))
 OR EXISTS(SELECT 1 FROM app_private.admin_session_revocations WHERE session_id=cap.session_id)
 OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=cap.creator_id AND access_state='active' AND coalesce((access_permissions->>'sendInvites')::boolean,false) AND access_permissions->'sections'->>'invites' IN ('view','edit'))
 OR NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)
 THEN RAISE EXCEPTION 'Shortcuts capability expired or revoked' USING ERRCODE='42501';END IF;
 SELECT enabled INTO feature_enabled FROM app_private.shortcut_runtime WHERE singleton;
 IF p_action IN ('claim','image') AND NOT coalesce(feature_enabled,false) THEN RAISE EXCEPTION 'Apple Shortcuts is disabled. Enable the experimental feature in Interface settings.' USING ERRCODE='55000';END IF;
 PERFORM app_private.shortcut_limit(p_batch_id,p_action);
 SELECT * INTO b FROM public.invitation_shortcut_batches WHERE id=p_batch_id;
 IF b.revoked_at IS NOT NULL OR (b.mode<>'live' AND NOT EXISTS(
  SELECT 1 FROM app_private.shortcut_runtime r WHERE r.singleton AND r.test_enabled AND cardinality(r.test_household_ids)=6 AND cardinality(r.test_phones)=2
  AND NOT EXISTS(SELECT 1 FROM public.invitation_shortcut_items i JOIN public.invitation_send_queue queued ON queued.id=i.queue_id WHERE i.batch_id=b.id AND (NOT queued.household_id=ANY(r.test_household_ids) OR NOT app_private.shortcut_phone(queued.recipient_snapshot->>'contact_value')=ANY(r.test_phones)))
 )) THEN RAISE EXCEPTION 'Shortcuts capability expired or revoked' USING ERRCODE='42501';END IF;
 -- Expired claims have an unknown outcome. They never re-enter the manifest.
 UPDATE public.invitation_shortcut_attempts x SET state='unknown',error_stage='claim',error_message='Device outcome unknown after claim timeout'
 WHERE x.batch_id=b.id AND x.state='claimed' AND NOT EXISTS(SELECT 1 FROM app_private.invitation_shortcut_leases l WHERE l.attempt_id=x.id AND l.expires_at>clock_timestamp());
 UPDATE public.invitation_send_queue z SET shortcuts_error='unknown' FROM public.invitation_shortcut_attempts x WHERE x.batch_id=b.id AND x.state='unknown' AND z.id=x.queue_id AND z.shortcuts_attempt_id=x.id AND x.result_event_id IS NULL;
 IF p_action='manifest' THEN
  IF p_payload<>'{}' THEN RAISE EXCEPTION 'Invalid manifest request';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('attempt_id',x.id,'delivery_id',queued.id,'household_name',concat_ws(' ',nullif(h.household_name,''),nullif(h.last_name,'')),'phone',app_private.shortcut_phone(queued.recipient_snapshot->>'contact_value'),'message',queued.message_body,'image',queued.message_image IS NOT NULL,'invitation_code',queued.invitation_code_snapshot) ORDER BY i.ordinal),'[]') INTO invitations
  FROM public.invitation_shortcut_attempts x JOIN public.invitation_shortcut_items i ON i.batch_id=x.batch_id AND i.queue_id=x.queue_id JOIN public.invitation_send_queue queued ON queued.id=x.queue_id JOIN public.households h ON h.id=queued.household_id
  WHERE x.batch_id=b.id AND x.state='pending' AND queued.status='ready' AND queued.revision=i.expected_revision AND queued.invitation_code_snapshot=h.invite_code AND h.archived_at IS NULL AND EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM public.invitation_shortcut_attempts done WHERE done.queue_id=x.queue_id AND done.state='processed');
  SELECT coalesce(jsonb_agg(jsonb_build_object('attempt_id',id,'delivery_id',queue_id,'state',state) ORDER BY attempt_number),'[]') INTO states FROM public.invitation_shortcut_attempts WHERE batch_id=b.id;
  IF NOT coalesce(feature_enabled,false) THEN invitations:='[]'::jsonb;END IF;
  RETURN jsonb_build_object('schema_version',1,'batch_id',b.id,'mode',b.mode,'invitations',invitations,'statuses',states,'expires_at',cap.expires_at);
 END IF;
 IF coalesce(p_payload->>'attempt_id','') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'Invalid attempt';END IF;
 SELECT * INTO a FROM public.invitation_shortcut_attempts WHERE id=(p_payload->>'attempt_id')::uuid AND batch_id=b.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Attempt does not belong to this batch' USING ERRCODE='42501';END IF;
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=a.queue_id FOR UPDATE;
 IF p_action='results' THEN
  IF p_payload-ARRAY['attempt_id','event_id','claim_id','channel','result','details']<>'{}' OR p_payload->>'channel' IS DISTINCT FROM 'whatsapp' OR coalesce(p_payload->>'event_id','') !~ '^[0-9a-fA-F-]{36}$' OR coalesce(p_payload->>'claim_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid callback';END IF;
  details:=p_payload->'details'; result:=p_payload->>'result'; eid:=(p_payload->>'event_id')::uuid;
  IF result IS NULL OR result NOT IN ('processed','partial','failed','unknown','skipped') OR details-ARRAY['text_action_completed','photo_action_completed','error_stage','error_code']<>'{}' OR jsonb_typeof(details->'text_action_completed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(details->'photo_action_completed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid callback result';END IF;
  text_ok:=(details->>'text_action_completed')::boolean; photo_ok:=(details->>'photo_action_completed')::boolean;
  stage:=nullif(details->>'error_stage',''); errmsg:=nullif(details->>'error_code','');
  IF stage IS NOT NULL AND stage NOT IN ('text','photo','unknown') THEN RAISE EXCEPTION 'Invalid callback error stage';END IF;
  IF errmsg IS NOT NULL AND errmsg NOT IN ('action_failed','image_fetch_failed','cancelled','unknown') THEN RAISE EXCEPTION 'Invalid callback error code';END IF;
  IF result='processed' AND (stage IS NOT NULL OR errmsg IS NOT NULL) THEN RAISE EXCEPTION 'Processed results cannot contain an error stage or code';END IF;
  IF (p_payload->>'claim_id')::uuid IS DISTINCT FROM a.claim_id THEN RAISE EXCEPTION 'Callback claim does not match the attempt';END IF;
  IF (a.text_processed AND NOT text_ok) OR (a.photo_processed AND NOT photo_ok) THEN RAISE EXCEPTION 'Callback cannot discard completed actions';END IF;
  IF result='processed' AND (NOT text_ok OR (q.message_image IS NOT NULL AND NOT photo_ok)) THEN RAISE EXCEPTION 'Processed requires all text and photo actions';END IF;
  IF result='partial' AND NOT (text_ok OR photo_ok) THEN RAISE EXCEPTION 'Partial requires a completed action';END IF;
  normalized:=jsonb_build_object('attempt_id',a.id,'event_id',eid,'claim_id',a.claim_id,'channel','whatsapp','result',result,'details',jsonb_build_object('text_action_completed',text_ok,'photo_action_completed',photo_ok,'error_stage',stage,'error_code',errmsg));
  fingerprint:=encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
  IF a.result_event_id IS NOT NULL THEN
   IF a.result_event_id=eid AND a.result_hash=fingerprint THEN RETURN jsonb_build_object('accepted',true,'idempotent',true,'state',a.state);END IF;
   RAISE EXCEPTION 'Callback conflicts with the recorded result';
  END IF;
  IF EXISTS(SELECT 1 FROM public.invitation_shortcut_attempts WHERE result_event_id=eid) THEN RAISE EXCEPTION 'Callback event belongs to another attempt';END IF;
  IF a.claim_id IS NULL OR a.state NOT IN ('claimed','unknown') THEN RAISE EXCEPTION 'Claim the attempt before recording its result';END IF;
  UPDATE public.invitation_shortcut_attempts SET state=result,completed_at=clock_timestamp(),text_processed=text_ok,photo_processed=photo_ok,error_stage=stage,error_message=errmsg,result_event_id=eid,result_hash=fingerprint WHERE id=a.id;
  DELETE FROM app_private.invitation_shortcut_leases WHERE attempt_id=a.id;
  UPDATE public.invitation_send_queue SET shortcuts_processed_at=CASE WHEN result='processed' THEN clock_timestamp() ELSE shortcuts_processed_at END,shortcuts_error=CASE WHEN result='processed' THEN NULL ELSE coalesce(errmsg,result||coalesce(': '||stage,'')) END,shortcuts_attempt_id=a.id,shortcuts_batch_id=b.id WHERE id=q.id AND (shortcuts_attempt_id IS NULL OR shortcuts_attempt_id=a.id);
  RETURN jsonb_build_object('accepted',true,'idempotent',false,'state',result);
 END IF;
 IF q.status<>'ready' OR q.revision IS DISTINCT FROM (SELECT expected_revision FROM public.invitation_shortcut_items WHERE batch_id=b.id AND queue_id=q.id) OR NOT EXISTS(SELECT 1 FROM public.households h WHERE h.id=q.household_id AND h.archived_at IS NULL AND h.invite_code=q.invitation_code_snapshot AND EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)) THEN RAISE EXCEPTION 'Delivery is no longer ready';END IF;
 IF a.state='pending' AND EXISTS(SELECT 1 FROM public.invitation_shortcut_attempts WHERE queue_id=q.id AND state='processed') THEN RAISE EXCEPTION 'Delivery already has a processed attempt';END IF;
 IF p_action='image' THEN
  IF p_payload-ARRAY['attempt_id']<>'{}' OR a.state NOT IN ('pending','claimed') THEN RAISE EXCEPTION 'Image unavailable for this attempt';END IF;
  IF q.message_image IS NULL THEN RAISE EXCEPTION 'Invitation has no image';END IF;
  RETURN jsonb_build_object('image',q.message_image->>'image','name',q.message_image->>'name');
 END IF;
 IF p_payload-ARRAY['attempt_id','claim_id']<>'{}' OR coalesce(p_payload->>'claim_id','') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'Invalid claim';END IF;
 claim:=(p_payload->>'claim_id')::uuid;
 IF a.state<>'pending' THEN RETURN jsonb_build_object('claimed',false,'state',a.state,'attempt_id',a.id);END IF;
 UPDATE public.invitation_shortcut_attempts SET state='claimed',claim_id=claim,started_at=clock_timestamp() WHERE id=a.id;
 INSERT INTO app_private.invitation_shortcut_leases(attempt_id,expires_at) VALUES(a.id,clock_timestamp()+interval '5 minutes');
 UPDATE public.invitation_send_queue SET handed_to_shortcuts_at=coalesce(handed_to_shortcuts_at,clock_timestamp()),shortcuts_error=NULL,shortcuts_attempt_id=a.id,shortcuts_batch_id=b.id WHERE id=q.id;
 RETURN jsonb_build_object('claimed',true,'state','claimed','attempt_id',a.id,'mode',b.mode,'required_actions',jsonb_build_object('text',NOT a.text_processed,'photo',q.message_image IS NOT NULL AND NOT a.photo_processed),'completed_actions',jsonb_build_object('text',a.text_processed,'photo',a.photo_processed));
END $$;

REVOKE ALL ON FUNCTION public.dispatch_shortcut_batch(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.dispatch_shortcut_batch(uuid,text,text,jsonb) TO service_role;

ALTER TABLE public.households ADD COLUMN first_visited_at timestamptz,
 ADD COLUMN last_visited_at timestamptz,
 ADD COLUMN visit_count bigint NOT NULL DEFAULT 0 CHECK(visit_count>=0),
 ADD CONSTRAINT households_visit_order CHECK(first_visited_at IS NULL OR last_visited_at>=first_visited_at);

CREATE TABLE app_private.guest_visit_scope (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 generation uuid NOT NULL DEFAULT gen_random_uuid()
);

INSERT INTO app_private.guest_visit_scope(singleton) VALUES(true);

CREATE TABLE app_private.guest_visit_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 installation_id uuid NOT NULL,
 generation uuid NOT NULL,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
 session_id uuid NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 acknowledged_at timestamptz,
 UNIQUE(installation_id,generation,household_id,session_id)
);

CREATE INDEX guest_visit_receipts_expiry ON app_private.guest_visit_receipts(expires_at);

ALTER TABLE app_private.guest_visit_scope ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_private.guest_visit_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON app_private.guest_visit_scope,app_private.guest_visit_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.revoke_guest_visit_receipts() RETURNS void
 LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 UPDATE app_private.guest_visit_scope SET generation=gen_random_uuid() WHERE singleton;
 DELETE FROM app_private.guest_visit_receipts WHERE id IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION app_private.revoke_guest_visit_receipts() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.issue_household_visit_receipt(p_code text,p_session_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_generation uuid;v_installation uuid;v_household uuid;v_receipt app_private.guest_visit_receipts;
BEGIN
 IF p_session_id IS NULL OR p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN NULL;END IF;
 SELECT generation INTO v_generation FROM app_private.guest_visit_scope WHERE singleton FOR SHARE;
 SELECT installation_id INTO v_installation FROM app_private.backup_origin WHERE singleton;
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.invite_code=p_code AND h.archived_at IS NULL
 AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)
 AND EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL);
 IF v_household IS NULL THEN RETURN NULL;END IF;
 DELETE FROM app_private.guest_visit_receipts WHERE expires_at<clock_timestamp()-interval '1 day';
 INSERT INTO app_private.guest_visit_receipts(installation_id,generation,household_id,session_id)
 VALUES(v_installation,v_generation,v_household,p_session_id)
 ON CONFLICT(installation_id,generation,household_id,session_id) DO NOTHING;
 SELECT * INTO v_receipt FROM app_private.guest_visit_receipts
 WHERE installation_id=v_installation AND generation=v_generation AND household_id=v_household AND session_id=p_session_id;
 IF v_receipt.expires_at<=clock_timestamp() OR v_receipt.acknowledged_at IS NOT NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',v_receipt.id,'sessionId',p_session_id);
END $$;

CREATE FUNCTION public.acknowledge_household_visit(p_code text,p_receipt_id uuid,p_session_id uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_generation uuid;v_installation uuid;v_receipt app_private.guest_visit_receipts;h public.households;v_now timestamptz;
BEGIN
 IF p_session_id IS NULL OR p_receipt_id IS NULL OR p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN false;END IF;
 SELECT generation INTO v_generation FROM app_private.guest_visit_scope WHERE singleton FOR SHARE;
 SELECT installation_id INTO v_installation FROM app_private.backup_origin WHERE singleton;
 SELECT * INTO v_receipt FROM app_private.guest_visit_receipts
 WHERE id=p_receipt_id AND session_id=p_session_id AND installation_id=v_installation AND generation=v_generation FOR UPDATE;
 IF NOT FOUND OR v_receipt.expires_at<=clock_timestamp() THEN RETURN false;END IF;
 SELECT * INTO h FROM public.households WHERE id=v_receipt.household_id AND invite_code=p_code FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)
 OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RETURN false;END IF;
 v_now:=clock_timestamp();
 IF v_receipt.expires_at<=v_now THEN RETURN false;END IF;
 IF v_receipt.acknowledged_at IS NOT NULL THEN RETURN true;END IF;
 UPDATE app_private.guest_visit_receipts SET acknowledged_at=v_now WHERE id=v_receipt.id;
 -- The household lock makes simultaneous receipts/reloads count at most once in
 -- 15 minutes. Acknowledged receipts remain consumed even when coalesced here.
 IF h.last_visited_at IS NULL OR h.last_visited_at<=v_now-interval '15 minutes' THEN
  UPDATE public.households SET first_visited_at=coalesce(first_visited_at,v_now),last_visited_at=v_now,visit_count=visit_count+1 WHERE id=h.id;
 END IF;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.issue_household_visit_receipt(text,uuid),public.acknowledge_household_visit(text,uuid,uuid) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.issue_household_visit_receipt(text,uuid),public.acknowledge_household_visit(text,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guest_gateway_allow_request(p_ip_hash text,p_code text,p_action text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $_$
DECLARE v_period timestamptz;v_limit integer;v_key text;v_ok boolean;v_code text:=upper(coalesce(p_code,''));v_n integer;
BEGIN
 IF p_ip_hash !~ '^[a-f0-9]{64}$'
 OR p_action NOT IN ('add_household_guest','set_household_food_group','set_household_food_interest','get_invitation_v2','get_household_food','set_household_food_claim','confirm_household_food','submit_household_rsvp','acknowledge_household_visit')
 OR v_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN false;END IF;
 v_period:=date_trunc('minute',clock_timestamp());
 FOR v_n IN 1..4 LOOP
  IF v_n=1 THEN v_key:='ip:'||p_ip_hash;v_limit:=40;
  ELSIF v_n=2 THEN v_key:='code:'||md5(v_code);v_limit:=20;
  ELSIF v_n=3 THEN v_key:='global';v_limit:=2500;
  ELSE
   IF p_action<>'acknowledge_household_visit' THEN EXIT;END IF;
   v_key:='visit:'||md5(v_code);v_limit:=10;
  END IF;
  INSERT INTO public.guest_gateway_rate_limits(key_hash,period_start,request_count) VALUES(v_key,v_period,1)
  ON CONFLICT(key_hash,period_start) DO UPDATE SET request_count=public.guest_gateway_rate_limits.request_count+1
   WHERE public.guest_gateway_rate_limits.request_count<v_limit RETURNING true INTO v_ok;
  IF coalesce(v_ok,false)=false THEN RETURN false;END IF;v_ok:=false;
 END LOOP;
 RETURN true;
END $_$;

CREATE FUNCTION public.admin_set_shortcuts_enabled(p_enabled boolean,p_expected boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE current_enabled boolean;
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_enabled IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'Choose whether to enable Apple Shortcuts';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT enabled INTO current_enabled FROM app_private.shortcut_runtime WHERE singleton FOR UPDATE;
 IF NOT FOUND OR current_enabled IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Experimental feature setting changed. Refresh and try again.';END IF;
 UPDATE app_private.shortcut_runtime SET enabled=p_enabled WHERE singleton;
 RETURN jsonb_build_object('enabled',p_enabled);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_shortcuts_enabled(boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.admin_set_shortcuts_enabled(boolean,boolean) TO authenticated;

CREATE FUNCTION app_private.wipe_all_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT ARRAY[
  'public.admin_invitation_audit','public.admin_invitations','public.admin_membership_audit','public.admin_session_audit','public.admins',
  'public.backup_restore_audit','public.event_configuration_audit','public.event_languages','public.event_locations','public.event_sessions','public.event_settings','public.event_translations',
  'public.food_categories','public.food_category_translations','public.food_claims','public.food_groups','public.food_item_translations','public.food_item_types','public.food_items','public.food_type_translations',
  'public.guest_gateway_rate_limits','public.guest_session_overrides','public.guest_session_responses','public.guests','public.household_contacts','public.household_session_defaults','public.households',
  'public.invitation_access_audit','public.invitation_deliveries','public.invitation_delivery_audit','public.invitation_send_queue','public.invitation_shortcut_attempts','public.invitation_shortcut_batches','public.invitation_shortcut_items',
  'public.management_audit','public.message_templates','public.other_categories','public.other_items','public.relation_groups','public.rsvp_household_audit','public.rsvp_response_audit','public.rsvp_submissions',
  'public.session_translations','public.translation_overrides','public.venue_translations',
  'app_private.admin_access_audit','app_private.pending_admin_permissions','app_private.invitation_shortcut_capabilities','app_private.invitation_shortcut_leases',
  'app_private.shortcut_rate_limits','app_private.shortcut_gateway_rate_limits','app_private.guest_visit_receipts','app_private.restore_safety_receipts'
 ]::text[]
$$;

CREATE FUNCTION app_private.wipe_all_state() RETURNS text LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE result jsonb:='{}';t text;rows jsonb;
BEGIN
 FOREACH t IN ARRAY app_private.wipe_all_tables() LOOP
  IF t='app_private.restore_safety_receipts' THEN CONTINUE;END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]''::jsonb) FROM %s x',t::regclass) INTO rows;
  result:=result||jsonb_build_object(t,rows);
 END LOOP;
 result:=result||jsonb_build_object('installation',(SELECT to_jsonb(x) FROM app_private.backup_origin x WHERE singleton),'setup',(SELECT to_jsonb(x) FROM app_private.installation_state x WHERE id),'shortcuts',(SELECT to_jsonb(x) FROM app_private.shortcut_runtime x WHERE singleton));
 RETURN encode(sha256(convert_to(result::text,'UTF8')),'hex');
END $$;

CREATE FUNCTION app_private.wipe_all_counts() RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE result jsonb:='{}';t text;n bigint;
BEGIN
 FOREACH t IN ARRAY app_private.wipe_all_tables() LOOP
  IF t NOT LIKE 'public.%' THEN CONTINUE;END IF;
  EXECUTE format('SELECT count(*) FROM %s',t::regclass) INTO n;
  result:=result||jsonb_build_object(t,n);
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION app_private.require_wipe_all(p_keep_current_admin boolean) RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 PERFORM app_private.require_permission('full');
 IF p_keep_current_admin IS NULL THEN RAISE EXCEPTION 'Choose whether to retain the current administrator';END IF;
 IF (SELECT is_published FROM public.event_settings WHERE id=1) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Unpublish the event before wiping application data';END IF;
END $$;

CREATE FUNCTION public.admin_preview_wipe_all(p_keep_current_admin boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE t text;
BEGIN
 PERFORM app_private.require_wipe_all(p_keep_current_admin);
 PERFORM pg_advisory_xact_lock(42319,11);PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.wipe_all_tables() LOOP EXECUTE format('LOCK TABLE %s IN SHARE MODE',t::regclass);END LOOP;
 PERFORM app_private.require_wipe_all(p_keep_current_admin);
 RETURN jsonb_build_object('can_wipe',true,'keep_current_admin',p_keep_current_admin,'event_name',(SELECT event_name FROM public.event_settings WHERE id=1),'destination_state',app_private.wipe_all_state(),'current_counts',app_private.wipe_all_counts(),'auth_accounts_preserved',true,'connection_configuration_preserved',true);
END $$;

CREATE FUNCTION public.admin_prepare_wipe_all(p_keep_current_admin boolean,p_expected_state text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE state text;token uuid;candidate jsonb;t text;created timestamptz;
BEGIN
 PERFORM app_private.require_wipe_all(p_keep_current_admin);
 IF p_expected_state IS NULL OR p_expected_state !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Review the current application data before wiping';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.wipe_all_tables() LOOP EXECUTE format('LOCK TABLE %s IN SHARE MODE',t::regclass);END LOOP;
 PERFORM app_private.require_wipe_all(p_keep_current_admin);
 state:=app_private.wipe_all_state();
 IF state IS DISTINCT FROM p_expected_state THEN RAISE EXCEPTION 'Destination changed; review the wipe again';END IF;
 candidate:=app_private.seal_backup(app_private.backup_payload());
 DELETE FROM app_private.restore_safety_receipts WHERE created_at<clock_timestamp()-interval '30 minutes';
 INSERT INTO app_private.restore_safety_receipts(actor,session_id,source_checksum,destination_state,operation)
 VALUES(auth.uid(),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid,'wipe-all:'||p_keep_current_admin::text,state,'clear') RETURNING id,created_at INTO token,created;
 RETURN jsonb_build_object('token',token,'safety_backup',candidate,'current_counts',app_private.wipe_all_counts(),'destination_state',state,'keep_current_admin',p_keep_current_admin,'expires_at',created+interval '5 minutes');
END $$;

CREATE FUNCTION public.admin_wipe_all(p_keep_current_admin boolean,p_confirmation text,p_safety_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE receipt app_private.restore_safety_receipts%ROWTYPE;v_actor uuid;sid uuid;t text;current_admin public.admins%ROWTYPE;
 destination_url text;setup app_private.installation_state%ROWTYPE;
BEGIN
 PERFORM app_private.require_wipe_all(p_keep_current_admin);
 IF p_confirmation IS DISTINCT FROM 'WIPE' THEN RAISE EXCEPTION 'Type WIPE to clear all application data';END IF;
 v_actor:=auth.uid();sid:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid;
 PERFORM pg_advisory_xact_lock(42319,11);PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.wipe_all_tables() LOOP EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',t::regclass);END LOOP;
 PERFORM app_private.require_wipe_all(p_keep_current_admin);
 SELECT * INTO receipt FROM app_private.restore_safety_receipts WHERE id=p_safety_token AND operation='clear' AND actor=auth.uid() AND session_id=sid FOR UPDATE;
 IF NOT FOUND OR receipt.created_at<clock_timestamp()-interval '5 minutes' OR receipt.source_checksum IS DISTINCT FROM 'wipe-all:'||p_keep_current_admin::text THEN RAISE EXCEPTION 'Prepare and download a fresh safety backup before wiping';END IF;
 IF receipt.destination_state IS DISTINCT FROM app_private.wipe_all_state() THEN RAISE EXCEPTION 'Destination changed; review the wipe again';END IF;
 SELECT * INTO current_admin FROM public.admins WHERE user_id=v_actor;
 SELECT website_url INTO destination_url FROM public.event_settings WHERE id=1;
 SELECT * INTO setup FROM app_private.installation_state WHERE id;
 -- Auth credentials/accounts remain managed by Supabase. Revoke only application
 -- access, including still-valid JWTs, for all earlier sessions except the retained one.
 INSERT INTO app_private.admin_session_revocations(session_id,user_id,revoked_by)
 SELECT s.id,s.user_id,v_actor FROM auth.sessions s
 WHERE NOT(p_keep_current_admin AND s.id=sid AND s.user_id=v_actor)
 ON CONFLICT(session_id) DO NOTHING;
 EXECUTE 'TRUNCATE TABLE '||array_to_string(app_private.wipe_all_tables(),',')||' RESTART IDENTITY RESTRICT';
 DELETE FROM app_private.installation_state WHERE id;
 IF p_keep_current_admin THEN
  INSERT INTO public.admins SELECT (current_admin).*;
  IF setup.id IS NOT NULL THEN INSERT INTO app_private.installation_state SELECT (setup).*;END IF;
 END IF;
 INSERT INTO public.event_languages(display_name,enabled,language_code,sort_order) VALUES ('English',true,'en',1),('Føroyskt',true,'fo',2),('Deutsch',true,'de',3);
 INSERT INTO public.event_settings(id,event_name,default_language,timezone,website_url) VALUES(1,'My event','en','UTC',destination_url);
 PERFORM app_private.revoke_shortcut_capabilities();
 PERFORM app_private.revoke_guest_visit_receipts();
 RETURN jsonb_build_object('application_data_cleared',true,'current_admin_retained',p_keep_current_admin,'sign_out_required',NOT p_keep_current_admin,'schema_ready',true,'setup_required',NOT p_keep_current_admin,'auth_accounts_preserved',true,'connection_configuration_preserved',true,'unpublished',true);
END $$;

REVOKE ALL ON FUNCTION app_private.wipe_all_tables(),app_private.wipe_all_state(),app_private.wipe_all_counts(),app_private.require_wipe_all(boolean) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_preview_wipe_all(boolean),public.admin_prepare_wipe_all(boolean,text),public.admin_wipe_all(boolean,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.admin_preview_wipe_all(boolean),public.admin_prepare_wipe_all(boolean,text),public.admin_wipe_all(boolean,text,uuid) TO authenticated;

DO $verify$
DECLARE
 item record;
 digest bytea;
 ignored_columns text[];
BEGIN
 FOR item IN SELECT * FROM pg_temp.rsvp_alpha8_rows ORDER BY schema_name, table_name
 LOOP
  ignored_columns := CASE item.relation_id
   WHEN 'public.event_settings'::pg_catalog.regclass THEN ARRAY['guest_interface_modes']
   WHEN 'public.message_templates'::pg_catalog.regclass THEN ARRAY['content_options', 'short_body']
   WHEN 'app_private.restore_safety_receipts'::pg_catalog.regclass THEN ARRAY['operation']
   WHEN 'public.invitation_send_queue'::pg_catalog.regclass THEN ARRAY['handed_to_shortcuts_at', 'shortcuts_processed_at', 'verified_sent_at', 'shortcuts_error', 'shortcuts_attempt_id', 'shortcuts_batch_id']
   WHEN 'public.households'::pg_catalog.regclass THEN ARRAY['first_visited_at', 'last_visited_at', 'visit_count']
   ELSE ARRAY[]::text[]
  END;
  EXECUTE pg_catalog.format(
   'SELECT pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(row_hash, '''' ORDER BY row_hash), ''''), ''UTF8''))
    FROM (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.to_jsonb(t) - $1)::text, ''UTF8'')), ''hex'') AS row_hash
      FROM %I.%I AS t) AS hashes', item.schema_name, item.table_name)
  INTO digest USING ignored_columns;
  IF digest IS DISTINCT FROM item.row_hash THEN
   RAISE EXCEPTION 'Upgrade preservation check failed for %.%', item.schema_name, item.table_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = item.relation_id AND relation.relowner = item.owner_id
      AND relation.relacl IS NOT DISTINCT FROM item.acl AND relation.relrowsecurity = item.rls
      AND relation.relforcerowsecurity = item.force_rls) THEN
   RAISE EXCEPTION 'Upgrade permission check failed for %.%', item.schema_name, item.table_name;
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_temp.rsvp_alpha8_functions AS old
  LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = old.oid
  WHERE p.oid IS NULL OR (p.proowner, p.proacl, p.prosecdef)
   IS DISTINCT FROM (old.proowner, old.proacl, old.prosecdef)) THEN
  RAISE EXCEPTION 'Upgrade changed existing function permissions';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_temp.rsvp_alpha8_policies AS old
  LEFT JOIN pg_catalog.pg_policy AS p ON p.polrelid = old.polrelid AND p.polname = old.polname
  WHERE p.polrelid IS NULL OR (p.polcmd, p.polpermissive, p.polroles, p.polqual::text, p.polwithcheck::text)
   IS DISTINCT FROM (old.polcmd, old.polpermissive, old.polroles, old.polqual, old.polwithcheck)) THEN
  RAISE EXCEPTION 'Upgrade changed an existing row-level access policy';
 END IF;
 IF cardinality(app_private.backup_tables()) IS DISTINCT FROM 43
    OR (SELECT enabled OR test_enabled FROM app_private.shortcut_runtime WHERE singleton) IS DISTINCT FROM false
    OR EXISTS (SELECT 1 FROM public.message_templates WHERE template_key = 'invitation') THEN
  RAISE EXCEPTION 'Upgrade target checks failed';
 END IF;
END $verify$;

SELECT pg_catalog.pg_notify('pgrst', 'reload schema');

COMMIT;
