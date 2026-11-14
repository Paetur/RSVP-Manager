BEGIN;
DO $order$ DECLARE d text:=pg_get_functiondef('app_private.guest_invitation(public.households)'::regprocedure);BEGIN
 IF strpos(d,'''is_child'',g.is_child')=0 OR strpos(d,'ORDER BY g.created_at')=0 THEN RAISE EXCEPTION 'Unexpected invitation guest projection';END IF;
 d:=replace(d,'''is_child'',g.is_child','''is_child'',g.is_child,''sort_order'',g.sort_order');
 d:=replace(d,'ORDER BY g.created_at','ORDER BY g.is_child,g.sort_order NULLS LAST,lower(g.first_name),lower(coalesce(g.last_name,'''')),g.id');EXECUTE d;
END $order$;
REVOKE ALL ON FUNCTION app_private.guest_invitation(public.households) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
