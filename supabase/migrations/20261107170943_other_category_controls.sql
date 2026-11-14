BEGIN;

-- Category changes use the same live-admin guard and ordering lock as Other saves.
CREATE FUNCTION public.admin_move_other_category(p_category_id uuid,p_direction integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];position integer;target integer;
BEGIN
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

CREATE FUNCTION public.admin_delete_other_category(p_category_id uuid,p_expected_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE category public.other_categories%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO category FROM public.other_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF category.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Category changed; reload before deleting';END IF;
 IF EXISTS(SELECT 1 FROM public.other_items WHERE category_id=p_category_id) THEN RAISE EXCEPTION 'Move items to another category before deleting this category.';END IF;
 DELETE FROM public.other_categories WHERE id=p_category_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_move_other_category(uuid,integer),public.admin_delete_other_category(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_other_category(uuid,integer),public.admin_delete_other_category(uuid,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
