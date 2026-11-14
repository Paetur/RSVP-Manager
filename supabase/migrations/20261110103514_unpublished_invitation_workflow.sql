BEGIN;

CREATE OR REPLACE FUNCTION app_private.sync_invitation_code(p_household_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; code text; bytes bytea; i integer;
BEGIN
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN
   UPDATE public.households SET invite_code=NULL WHERE id=h.id AND invite_code IS NOT NULL;
 ELSIF h.invite_code IS NULL AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN
   LOOP
     bytes:=decode(md5(gen_random_uuid()::text),'hex');code:='';
     FOR i IN 0..7 LOOP code:=code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+get_byte(bytes,i)%32,1); END LOOP;
     INSERT INTO app_private.invitation_code_registry VALUES(code,h.id,now()) ON CONFLICT DO NOTHING;
     EXIT WHEN FOUND;
   END LOOP;
   UPDATE public.households SET invite_code=code WHERE id=h.id;
 END IF;
END $$;

-- Take the same planning lock before the settings row is changed. Issue all
-- codes in that transaction, so publication and its links become visible together.
CREATE FUNCTION app_private.lock_publication() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 RETURN NULL;
END $$;
CREATE TRIGGER lock_publication BEFORE UPDATE OF is_published ON public.event_settings
 FOR EACH STATEMENT EXECUTE FUNCTION app_private.lock_publication();

CREATE FUNCTION app_private.issue_codes_on_publication() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE household_id uuid;
BEGIN
 FOR household_id IN SELECT h.id FROM public.households h
  WHERE h.archived_at IS NULL AND h.invite_code IS NULL AND EXISTS(
   SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL
  ) ORDER BY h.id
 LOOP
  PERFORM app_private.sync_invitation_code(household_id);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER issue_codes_on_publication AFTER UPDATE OF is_published ON public.event_settings
 FOR EACH ROW WHEN (NEW.is_published AND NOT OLD.is_published)
 EXECUTE FUNCTION app_private.issue_codes_on_publication();

-- Keep every retired code reserved, even after its draft household is removed.
ALTER TABLE app_private.invitation_code_registry DROP CONSTRAINT invitation_code_registry_household_id_fkey;

CREATE OR REPLACE FUNCTION public.admin_delete_archived_record(p_entity text,p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_value jsonb;household_id uuid; unpublished boolean;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT NOT is_published INTO unpublished FROM public.event_settings WHERE id=1;
 IF p_entity='households' THEN
  IF NOT EXISTS(SELECT 1 FROM public.households h WHERE h.id=p_id AND (h.archived_at IS NOT NULL OR unpublished)) THEN
   RAISE EXCEPTION 'Choose a record that can be deleted.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=p_id) OR EXISTS(SELECT 1 FROM public.households h WHERE h.parent_id=p_id) THEN
   RAISE EXCEPTION 'Move or delete guests and child households first.';
  END IF;
  DELETE FROM public.household_session_defaults d WHERE d.household_id=p_id;
  DELETE FROM public.household_contacts c WHERE c.household_id=p_id;
  DELETE FROM public.households h WHERE h.id=p_id
  RETURNING to_jsonb(h)-'invite_code',h.id INTO before_value,household_id;
 ELSIF p_entity='guests' THEN
  IF NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.id=p_id AND (g.archived_at IS NOT NULL OR unpublished)) THEN
   RAISE EXCEPTION 'Choose a record that can be deleted.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.households h WHERE h.primary_guest_id=p_id)
    OR EXISTS(SELECT 1 FROM public.household_contacts c WHERE c.guest_id=p_id) THEN
   RAISE EXCEPTION 'Remove this guest’s household contact assignments first.';
  END IF;
  DELETE FROM public.guest_session_overrides o WHERE o.guest_id=p_id;
  DELETE FROM public.guests g WHERE g.id=p_id
  RETURNING to_jsonb(g),g.household_id INTO before_value,household_id;
 ELSE
  RAISE EXCEPTION 'Invalid archived record type';
 END IF;
 IF before_value IS NULL THEN RAISE EXCEPTION 'Choose a record that can be deleted.'; END IF;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value)
 VALUES(household_id,p_entity,p_id,auth.uid(),'delete',before_value);
EXCEPTION WHEN foreign_key_violation THEN
 RAISE EXCEPTION 'This record is linked to other records or history and must stay archived';
END $$;
CREATE OR REPLACE FUNCTION public.admin_guest_preview(p_household_id uuid DEFAULT NULL, p_sample boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households; invitation jsonb; food jsonb;
BEGIN
 PERFORM app_private.require_permission('households');
 PERFORM app_private.require_permission('invites');
 PERFORM app_private.require_permission('venues');
 PERFORM app_private.require_permission('food');
 IF p_sample THEN
  invitation:=jsonb_build_object(
   'household',jsonb_build_object('rsvp_state','open'),
   'guests',jsonb_build_array(jsonb_build_object('id','sample','first_name','Alex')),
   'invitations',(SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id','sample','session_id',s.id,'requires_rsvp',s.requires_rsvp) ORDER BY s.sort_order,s.id),'[]')
    FROM public.event_sessions s WHERE s.is_active)
  );
  food:=app_private.guest_food(NULL,true);
 ELSIF p_household_id IS NOT NULL THEN
  SELECT * INTO h FROM public.households WHERE id=p_household_id AND archived_at IS NULL AND EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=p_household_id AND g.archived_at IS NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'This household has no active invitation.'; END IF;
  invitation:=app_private.guest_invitation(h);
  IF h.food THEN food:=app_private.guest_food(h.id,false); END IF;
 END IF;
 RETURN jsonb_build_object('eventData',app_private.guest_event(),'invitation',invitation,'food',food);
END $$;

CREATE OR REPLACE FUNCTION public.admin_authorize_device_send(p_queue_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('sendInvites');
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN
  RAISE EXCEPTION 'Invitation delivery opens when the event is published.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.invitation_send_queue q JOIN public.households h ON h.id=q.household_id WHERE q.id=p_queue_id AND q.status='ready' AND h.archived_at IS NULL AND q.invitation_code_snapshot=h.invite_code) THEN RAISE EXCEPTION 'Refresh and save this delivery again before sending';END IF;
 RETURN true;
END $$;

-- Keep delivery writes serialized with unpublishing as well as the UI handoff.
DO $delivery$
DECLARE
 operation regprocedure;
 definition text;
 lock_statement text:='PERFORM pg_advisory_xact_lock(19421,7744);';
BEGIN
 FOREACH operation IN ARRAY ARRAY[
  'public.admin_save_delivery(uuid,uuid,jsonb,integer)'::regprocedure,
  'public.admin_confirm_invitation_sent(uuid,text)'::regprocedure
 ] LOOP
  definition:=pg_get_functiondef(operation);
  IF position(lock_statement IN definition)=0 THEN RAISE EXCEPTION 'Unexpected delivery operation';END IF;
  EXECUTE replace(definition,lock_statement,lock_statement||$guard$
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN
  RAISE EXCEPTION 'Invitation delivery opens when the event is published.';
 END IF;$guard$);
 END LOOP;
END $delivery$;

REVOKE ALL ON FUNCTION app_private.lock_publication(),app_private.issue_codes_on_publication() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
