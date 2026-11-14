BEGIN;

CREATE FUNCTION app_private.legacy_planning_configuration() RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"groups":[{"id":"maria_haass","names":{"en":"Maria Haass"}},{"id":"paetur_hentze","names":{"en":"Pætur Hentze"}}],"labels":{"households":{},"guests":{}}}'::jsonb
$$;

CREATE FUNCTION app_private.valid_planning_names(names jsonb) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN jsonb_typeof(names)='object' THEN NOT EXISTS(
  SELECT 1 FROM jsonb_each(names) AS name(code,value)
  WHERE code !~ '^[A-Za-z0-9-]{2,16}$' OR jsonb_typeof(value)<>'string'
   OR length(btrim(value#>>'{}')) NOT BETWEEN 1 AND 140
 ) ELSE false END
$$;

CREATE FUNCTION app_private.valid_planning_configuration(config jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
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
END $$;

ALTER TABLE public.event_settings
 ADD COLUMN planning_config jsonb NOT NULL DEFAULT app_private.legacy_planning_configuration(),
 ADD CONSTRAINT event_planning_configuration_check CHECK(app_private.valid_planning_configuration(planning_config));
ALTER TABLE public.event_settings ALTER COLUMN planning_config SET DEFAULT
 '{"groups":[{"id":"general","names":{"en":"General","de":"Allgemein","fo":"Alment"}}],"labels":{"households":{},"guests":{}}}'::jsonb;
UPDATE public.event_settings SET planning_config=DEFAULT
 WHERE id=1 AND NOT EXISTS(SELECT 1 FROM public.households);
ALTER TABLE public.households DROP CONSTRAINT households_side_check;
ALTER TABLE public.households ADD CONSTRAINT households_side_key_check CHECK(side ~ '^[a-z][a-z0-9_]{0,63}$');

CREATE FUNCTION app_private.guard_household_planning_group() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.event_settings e
  CROSS JOIN LATERAL jsonb_array_elements(e.planning_config->'groups') g
  WHERE e.id=1 AND g->>'id'=NEW.side) THEN
  RAISE EXCEPTION 'Choose an existing household group.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_household_planning_group BEFORE INSERT OR UPDATE OF side ON public.households
 FOR EACH ROW EXECUTE FUNCTION app_private.guard_household_planning_group();

CREATE FUNCTION app_private.guard_planning_group_removal() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.households h WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(NEW.planning_config->'groups') g WHERE g->>'id'=h.side
 )) THEN RAISE EXCEPTION 'Move households out of a group before removing it.';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lock_planning_configuration BEFORE UPDATE OF planning_config ON public.event_settings
 FOR EACH STATEMENT EXECUTE FUNCTION app_private.lock_publication();
CREATE TRIGGER guard_planning_group_removal BEFORE UPDATE OF planning_config ON public.event_settings
 FOR EACH ROW EXECUTE FUNCTION app_private.guard_planning_group_removal();

CREATE FUNCTION public.admin_save_planning_configuration(
 p_config jsonb,p_expected_config jsonb,p_preset text,p_expected_preset text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF NOT app_private.valid_planning_configuration(p_config) OR p_preset IS NULL OR (p_preset IS DISTINCT FROM p_expected_preset AND p_preset NOT IN ('wedding','reunion','conference','custom')) THEN
  RAISE EXCEPTION 'Enter valid event planning settings.';
 END IF;
 UPDATE public.event_settings SET planning_config=p_config,event_type=p_preset,updated_at=now()
 WHERE id=1 AND planning_config=p_expected_config AND event_type=p_expected_preset;
 IF NOT FOUND THEN RAISE EXCEPTION 'Planning settings changed. Refresh and try again.';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_planning_configuration(jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_planning_configuration(jsonb,jsonb,text,text) TO authenticated;

DO $projections$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 needle:='''fallback_language'',e.fallback_language,''is_published'',e.is_published';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected administrator settings projection';END IF;
 EXECUTE replace(definition,needle,needle||',''planning_config'',e.planning_config');
 definition:=pg_get_functiondef('app_private.guest_event()'::regprocedure);
 IF position('to_jsonb(e)' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected public event projection';END IF;
 EXECUTE replace(definition,'to_jsonb(e)','to_jsonb(e)-''planning_config''');
 definition:=pg_get_functiondef('public.get_public_event()'::regprocedure);
 IF position('to_jsonb(e)' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected legacy public event projection';END IF;
 EXECUTE replace(definition,'to_jsonb(e)','to_jsonb(e)-''planning_config''');
END $projections$;

-- Accept backups from before the settings column was introduced. The original
-- checksum and every other column check still apply.
DO $backup$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 needle:='IF payload->''columns''->t IS DISTINCT FROM app_private.backup_columns(t)';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup manifest validation';END IF;
 definition:=replace(definition,needle,needle||$legacy$
  AND NOT (t='public.event_settings' AND payload->'columns'->t=(
   SELECT jsonb_agg(col ORDER BY position)
   FROM jsonb_array_elements(app_private.backup_columns(t)) WITH ORDINALITY AS fields(col,position)
   WHERE col->>'name'<>'planning_config'
  ))$legacy$);
 needle:='RETURN jsonb_build_object(''rows'',n,';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup validation result';END IF;
 EXECUTE replace(definition,needle,$groups$
  IF NOT app_private.valid_planning_configuration(coalesce(payload->'tables'->'public.event_settings'->0->'planning_config',app_private.legacy_planning_configuration()))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h WHERE NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(coalesce(payload->'tables'->'public.event_settings'->0->'planning_config',app_private.legacy_planning_configuration())->'groups') g
     WHERE g->>'id'=h->>'side'
    )) THEN RAISE EXCEPTION 'Invalid household groups in backup';END IF;
  $groups$||needle);
 definition:=pg_get_functiondef('app_private.restore_backup(jsonb)'::regprocedure);
 needle:='IF t=''public.event_settings'' THEN row:=row||''{"is_published":false}''::jsonb;END IF;';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup event settings restore';END IF;
 EXECUTE replace(definition,needle,$restore$
  IF t='public.event_settings' THEN row:=row||jsonb_build_object('is_published',false,
   'planning_config',coalesce(row->'planning_config',app_private.legacy_planning_configuration()));END IF;
  $restore$);
END $backup$;

REVOKE ALL ON FUNCTION app_private.guard_household_planning_group(),app_private.guard_planning_group_removal() FROM PUBLIC,anon,authenticated;

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:=$labels${
 "Top-level group": "interface.messages.top_level_group",
 "Event planning": "interface.messages.event_planning",
 "Event preset": "interface.messages.event_preset",
 "Wedding": "interface.messages.event_preset_wedding",
 "Reunion": "interface.messages.event_preset_reunion",
 "Conference": "interface.messages.event_preset_conference",
 "Use preset suggestions": "interface.messages.event_apply_preset",
 "Preset suggestions add missing groups and fill blank labels. Review them before saving.": "interface.messages.event_preset_help",
 "Shared labels": "interface.messages.event_shared_labels",
 "Move group up": "interface.messages.event_move_group_up",
 "Move group down": "interface.messages.event_move_group_down",
 "Remove group": "interface.messages.event_remove_group",
 "Add group": "interface.messages.event_add_group",
 "Save planning settings": "interface.messages.event_save_planning",
 "Family": "interface.messages.event_group_family",
 "Friends": "interface.messages.event_group_friends",
 "Attendees": "interface.messages.event_group_attendees",
 "Speakers": "interface.messages.event_group_speakers",
 "Bookings": "interface.messages.event_label_bookings",
 "Participants": "interface.messages.event_label_participants"
}$labels$::jsonb;
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;

NOTIFY pgrst,'reload schema';
COMMIT;
