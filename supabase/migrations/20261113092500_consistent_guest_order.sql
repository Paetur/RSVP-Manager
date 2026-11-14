-- Adults first; manual movement stays inside the adult/child partition.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_order_guest(p_guest_id uuid,p_direction integer,p_expected_order uuid[] DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
REVOKE ALL ON FUNCTION public.admin_order_guest(uuid,integer,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_order_guest(uuid,integer,uuid[]) TO authenticated;

-- Shared insert/status-change semantics for admin and invitation additions.
-- Explicit backup sort values are retained on insert; migration rewrites no rows.
CREATE FUNCTION app_private.append_guest_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
REVOKE ALL ON FUNCTION app_private.append_guest_order() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER append_guest_order BEFORE INSERT OR UPDATE OF is_child,household_id ON public.guests
FOR EACH ROW EXECUTE FUNCTION app_private.append_guest_order();
COMMIT;
