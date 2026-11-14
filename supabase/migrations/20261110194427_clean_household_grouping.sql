BEGIN;

-- Rename the assignment in place so configured group IDs and all household
-- relationships retain their values. PostgreSQL updates column dependencies.
ALTER TABLE public.households RENAME COLUMN side TO planning_group_id;
ALTER TABLE public.households RENAME CONSTRAINT households_side_key_check TO households_planning_group_id_check;

-- These functions use PL/pgSQL bodies or explicit JSON keys. Their existing
-- permissions, signatures and other application rules stay in place.
DO $grouping$
DECLARE
 target regprocedure;
 definition text;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'app_private.guard_household_planning_group()'::regprocedure,
  'app_private.guard_management_parent()'::regprocedure,
  'app_private.guard_planning_group_removal()'::regprocedure,
  'public.admin_load_data()'::regprocedure,
  'public.admin_move_household(uuid,integer)'::regprocedure,
  'public.admin_save_household(uuid,jsonb)'::regprocedure,
  'public.admin_set_household_parent(uuid,uuid)'::regprocedure
 ] LOOP
  definition:=pg_get_functiondef(target);
  IF definition !~ '\mside\M' THEN RAISE EXCEPTION 'Unexpected household grouping definition for %',target;END IF;
  definition:=replace(definition,'same side and relation group','same top-level group and relation group');
  definition:=replace(replace(definition,'v_parent_side','v_parent_planning_group'),'v_side','v_planning_group');
  EXECUTE regexp_replace(definition,'\mside\M','planning_group_id','g');
 END LOOP;
END $grouping$;

-- Exports from this schema use the exact current table manifests. Retain
-- historical audit JSON as recorded, including keys used at the time.
DO $backups$
DECLARE
 definition text;
 start_marker constant text:='IF payload->''columns''->t IS DISTINCT FROM app_private.backup_columns(t)';
 end_marker constant text:=' THEN RAISE EXCEPTION ''Schema mismatch for %';
 configuration constant text:=$config$payload->'tables'->'public.event_settings'->0->'planning_config'$config$;
 fallback constant text:='app_private.legacy_planning_configuration()';
 start_at integer;
 end_at integer;
BEGIN
 definition:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(definition,'''20261101105111''')=0 THEN RAISE EXCEPTION 'Unexpected backup export schema version';END IF;
 EXECUTE replace(definition,'''20261101105111''','''20261110194427''');

 definition:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 start_at:=strpos(definition,start_marker);
 end_at:=strpos(definition,end_marker);
 IF start_at=0 OR end_at<=start_at OR strpos(definition,fallback)=0
  OR strpos(definition,'''20261101105111''')=0 THEN RAISE EXCEPTION 'Unexpected backup validation definition';END IF;
 definition:=overlay(definition PLACING start_marker FROM start_at FOR end_at-start_at);
 definition:=replace(definition,'''20261101105111''','''20261110194427''');
 definition:=replace(definition,'Unsupported backup schema version','Backup schema version does not match. Export a new application backup from the current version.');
 definition:=replace(definition,'coalesce('||configuration||','||fallback||')','('||configuration||')');
 definition:=replace(definition,'''side''','''planning_group_id''');
 IF strpos(definition,fallback)>0 THEN RAISE EXCEPTION 'Unexpected backup validation fallback';END IF;
 EXECUTE definition;

 definition:=pg_get_functiondef('app_private.restore_backup(jsonb)'::regprocedure);
 IF strpos(definition,fallback)=0 THEN RAISE EXCEPTION 'Expected backup restore fallback';END IF;
 definition:=regexp_replace(definition,
  $pattern$jsonb_build_object\('is_published',false,\s*'planning_config',coalesce\(row->'planning_config',app_private\.legacy_planning_configuration\(\)\)\)$pattern$,
  'jsonb_build_object(''is_published'',false)');
 IF strpos(definition,fallback)>0 THEN RAISE EXCEPTION 'Unexpected backup restore fallback';END IF;
 EXECUTE definition;
END $backups$;

DROP FUNCTION app_private.legacy_planning_configuration();

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 old_entry constant text:='"Side": "interface.messages.side",';
BEGIN
 IF strpos(definition,old_entry)=0 THEN RAISE EXCEPTION 'Expected old household grouping wording';END IF;
 EXECUTE replace(definition,old_entry,'');
END $wording$;

DELETE FROM public.translation_overrides WHERE translation_key='interface.messages.side';

NOTIFY pgrst,'reload schema';
COMMIT;
