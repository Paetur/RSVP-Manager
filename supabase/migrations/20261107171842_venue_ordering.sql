BEGIN;

CREATE FUNCTION public.admin_move_venue(p_venue_id uuid,p_direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];position integer;target integer;
BEGIN
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
REVOKE ALL ON FUNCTION public.admin_move_venue(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_venue(uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
