BEGIN;
-- Null preserves existing, shared relational groups without moving households.
ALTER TABLE public.relation_groups ADD COLUMN planning_group_id text CHECK(planning_group_id ~ '^[a-z][a-z0-9_]{0,63}$');
REVOKE INSERT,UPDATE,DELETE ON public.relation_groups FROM anon,authenticated;
CREATE FUNCTION app_private.guard_relation_group_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
REVOKE ALL ON FUNCTION app_private.guard_relation_group_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_relation_group_scope BEFORE INSERT OR UPDATE OR DELETE ON public.relation_groups FOR EACH ROW EXECUTE FUNCTION app_private.guard_relation_group_scope();
CREATE TRIGGER guard_household_relation_scope BEFORE INSERT OR UPDATE OF planning_group_id,relation_group_id ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_relation_group_scope();
CREATE OR REPLACE FUNCTION app_private.guard_planning_group_removal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.households h WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.planning_config->'groups') g WHERE g->>'id'=h.planning_group_id)) THEN RAISE EXCEPTION 'Move households out of a group before removing it.';END IF;
 IF EXISTS(SELECT 1 FROM public.relation_groups r WHERE r.planning_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.planning_config->'groups') g WHERE g->>'id'=r.planning_group_id)) THEN RAISE EXCEPTION 'Delete empty relational groups before removing the top-level group.';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.admin_manage_relation_group(p_action text,p_id uuid DEFAULT NULL,p_name text DEFAULT NULL,p_planning_group_id text DEFAULT NULL,p_direction integer DEFAULT NULL,p_expected jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
REVOKE ALL ON FUNCTION public.admin_manage_relation_group(text,uuid,text,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_relation_group(text,uuid,text,text,integer,jsonb) TO authenticated;
DO $backup$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'20261112112759')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;
 EXECUTE replace(d,'20261112112759','20261112115213');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'20261112112759')=0 THEN RAISE EXCEPTION 'Unexpected backup validation contract';END IF;
 d:=replace(d,'20261112112759','20261112115213');
 -- Reject invalid scope in imported backups before any data can be restored.
 d:=replace(d,'RETURN jsonb_build_object(''rows'',n,',$scope$
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.relation_groups') r WHERE r->>'planning_group_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.event_settings'->0->'planning_config'->'groups') g WHERE g->>'id'=r->>'planning_group_id'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h JOIN jsonb_array_elements(payload->'tables'->'public.relation_groups') r ON r->>'id'=h->>'relation_group_id' WHERE r->>'planning_group_id' IS NOT NULL AND r->>'planning_group_id'<>h->>'planning_group_id') THEN RAISE EXCEPTION 'Invalid relational group scope in backup';END IF;
 RETURN jsonb_build_object('rows',n,$scope$);
 EXECUTE d;
END $backup$;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Shared group": "interface.messages.shared_group", "Top-level groups": "interface.messages.top_level_groups", "Relational groups": "interface.messages.relation_groups", "Add relational group": "interface.messages.add_relation_group", "Move households and remove empty relational groups before deleting this group. Keep at least one top-level group.": "interface.messages.group_not_empty", "Edit group": "interface.messages.edit_group", "Delete group": "interface.messages.delete_group"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;
