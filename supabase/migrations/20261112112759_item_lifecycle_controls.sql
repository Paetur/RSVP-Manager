BEGIN;
ALTER TABLE public.food_items ADD COLUMN archived_at timestamptz;
ALTER TABLE public.other_items ADD COLUMN archived_at timestamptz;
REVOKE DELETE ON public.food_items,public.other_items,public.food_categories FROM authenticated,anon;

CREATE FUNCTION app_private.item_dependencies(p_entity text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION app_private.item_dependencies(text,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_item_lifecycle(p_entity text,p_id uuid,p_action text,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.admin_item_lifecycle(text,uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_item_lifecycle(text,uuid,text,timestamptz) TO authenticated;

CREATE FUNCTION public.admin_delete_food_category(p_category_id uuid,p_expected_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE category public.food_categories;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO category FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF category.name IS DISTINCT FROM p_expected_name THEN RAISE EXCEPTION 'Category changed; reload before deleting';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE f.category=category.name) OR EXISTS(SELECT 1 FROM public.food_groups g WHERE g.category=category.name) THEN RAISE EXCEPTION 'Move items to another category before deleting this category.';END IF;
 DELETE FROM public.food_categories WHERE id=p_category_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_delete_food_category(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_food_category(uuid,text) TO authenticated;

CREATE FUNCTION app_private.guard_item_archive_column() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN RAISE EXCEPTION 'Use the item archive or restore action' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_item_archive_column() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_food_archive BEFORE UPDATE OF archived_at ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_item_archive_column();
CREATE TRIGGER guard_other_archive BEFORE UPDATE OF archived_at ON public.other_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_item_archive_column();

-- Keep the established reservation validation and locking. Archiving never
-- removes a claim; existing claimants can retain or reduce their quantities.
ALTER FUNCTION app_private.save_food_selection(uuid,uuid,integer,text,integer) RENAME TO save_food_selection_base;
CREATE FUNCTION app_private.save_food_selection(p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_notes text,p_expected_quantity integer) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE archived timestamptz; old_quantity integer;
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT archived_at INTO archived FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 SELECT coalesce(max(quantity),0) INTO old_quantity FROM public.food_claims WHERE food_item_id=p_food_item_id AND household_id=p_household_id;
 IF archived IS NOT NULL AND p_quantity>old_quantity THEN RAISE EXCEPTION 'Food item unavailable';END IF;
 PERFORM app_private.save_food_selection_base(p_household_id,p_food_item_id,p_quantity,p_notes,p_expected_quantity);
END $$;
REVOKE ALL ON FUNCTION app_private.save_food_selection(uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION app_private.guest_food(uuid,boolean) RENAME TO guest_food_base;
CREATE FUNCTION app_private.guest_food(v_household uuid,p_sample boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
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
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_private.guest_food(uuid,boolean) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f regprocedure;d text;BEGIN
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);IF strpos(d,'''20261112005150''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;
  EXECUTE replace(d,'''20261112005150''','''20261112112759''');
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
