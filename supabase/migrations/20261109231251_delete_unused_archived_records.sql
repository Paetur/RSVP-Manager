BEGIN;

-- Audit rows describe historical identities and keep their original IDs after
-- deletion. All operational foreign keys, including retired invite codes, remain.
ALTER TABLE public.management_audit DROP CONSTRAINT management_audit_household_id_fkey;

CREATE FUNCTION public.admin_delete_archived_record(p_entity text,p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_value jsonb;household_id uuid;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_entity='households' THEN
  DELETE FROM public.households h WHERE h.id=p_id AND h.archived_at IS NOT NULL
  RETURNING to_jsonb(h)-'invite_code',h.id INTO before_value,household_id;
 ELSIF p_entity='guests' THEN
  DELETE FROM public.guests g WHERE g.id=p_id AND g.archived_at IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.households h WHERE h.primary_guest_id=g.id)
  RETURNING to_jsonb(g),g.household_id INTO before_value,household_id;
 ELSE
  RAISE EXCEPTION 'Invalid archived record type';
 END IF;
 IF before_value IS NULL THEN RAISE EXCEPTION 'Choose an archived record that is no longer in use';END IF;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value)
 VALUES(household_id,p_entity,p_id,auth.uid(),'delete',before_value);
EXCEPTION WHEN foreign_key_violation THEN
 RAISE EXCEPTION 'This record is linked to other records or history and must stay archived';
END $$;
REVOKE ALL ON FUNCTION public.admin_delete_archived_record(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_archived_record(text,uuid) TO authenticated;

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:='{"Remove assignment": "interface.messages.remove_assignment", "Unsaved": "interface.messages.unsaved", "RSVP": "interface.messages.rsvp_action", "Locked": "interface.messages.rsvp_locked", "Delete archived household": "interface.messages.delete_archived_household", "Delete archived guest": "interface.messages.delete_archived_guest", "Permanently delete this archived record?": "interface.messages.confirm_delete_archived_record", "Archived record deleted.": "interface.messages.archived_record_deleted", "This record is linked to other records or history and must stay archived": "interface.messages.archived_record_linked"}';
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;

NOTIFY pgrst,'reload schema';
COMMIT;
