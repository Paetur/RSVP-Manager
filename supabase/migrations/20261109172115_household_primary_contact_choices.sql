BEGIN;

ALTER TABLE public.household_contacts ADD COLUMN is_household_primary boolean;
ALTER TABLE public.household_contacts ADD CONSTRAINT active_household_primary_contact
 CHECK (is_household_primary IS NOT TRUE OR archived_at IS NULL);
CREATE UNIQUE INDEX household_one_primary_contact ON public.household_contacts(household_id)
 WHERE is_household_primary IS TRUE;

CREATE FUNCTION app_private.clear_archived_household_primary_contact() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.archived_at IS NOT NULL THEN NEW.is_household_primary:=NULL;END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.clear_archived_household_primary_contact() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clear_archived_household_primary_contact BEFORE UPDATE OF archived_at ON public.household_contacts
 FOR EACH ROW EXECUTE FUNCTION app_private.clear_archived_household_primary_contact();

CREATE OR REPLACE FUNCTION public.admin_set_household_primary_guest(p_household_id uuid,p_guest_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 UPDATE public.households SET primary_guest_id=p_guest_id,updated_at=now()
 WHERE id=p_household_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household not found';END IF;
 UPDATE public.household_contacts SET is_household_primary=NULL,updated_at=now()
 WHERE household_id=p_household_id AND is_household_primary IS TRUE;
END $$;

CREATE FUNCTION public.admin_set_household_primary_contact(p_household_id uuid,p_contact_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_contact_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.household_contacts WHERE id=p_contact_id AND household_id=p_household_id AND archived_at IS NULL
 ) THEN RAISE EXCEPTION 'Choose an active contact from this household';END IF;
 PERFORM public.admin_set_household_primary_guest(p_household_id,NULL);
 UPDATE public.household_contacts SET is_household_primary=true,updated_at=now() WHERE id=p_contact_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_household_primary_contact(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_household_primary_contact(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_household_with_food(p_id uuid,p_values jsonb,p_food boolean,p_expected_food boolean)
 RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE household_id uuid;contact_id uuid;
BEGIN
 household_id:=public.admin_save_household(p_id,p_values);
 IF p_values ? 'primary_contact' THEN
  contact_id:=public.admin_save_contact((p_values->'primary_contact'->>'id')::uuid,household_id,p_values->'primary_contact');
  PERFORM public.admin_set_household_primary_contact(household_id,contact_id);
 ELSIF p_values ? 'primary_contact_id' THEN
  PERFORM public.admin_set_household_primary_contact(household_id,(p_values->>'primary_contact_id')::uuid);
 ELSIF p_values ? 'primary_guest_id' THEN
  PERFORM public.admin_set_household_primary_guest(household_id,(p_values->>'primary_guest_id')::uuid);
 END IF;
 IF p_food IS NOT NULL THEN
  PERFORM public.admin_set_food_access(household_id,p_food,p_expected_food,'Updated from Household details');
 END IF;
 RETURN household_id;
END $$;

-- Use the household primary contact for compatible channels when the operator
-- has not explicitly chosen a delivery recipient.
DO $delivery$
DECLARE definition text:=pg_get_functiondef('public.admin_save_delivery(uuid,uuid,jsonb,integer)'::regprocedure);
 needle text:='IF cid IS NOT NULL THEN';
BEGIN
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected delivery recipient selection';END IF;
 EXECUTE replace(definition,needle,$selection$
 IF cid IS NULL THEN
  SELECT id INTO cid FROM public.household_contacts
  WHERE household_id=h.id AND is_household_primary IS TRUE AND archived_at IS NULL
   AND contact_type=CASE p_values->>'channel' WHEN 'sms' THEN 'phone' WHEN 'whatsapp' THEN 'phone' WHEN 'manual' THEN 'other' ELSE p_values->>'channel' END;
 END IF;
 IF cid IS NOT NULL THEN$selection$);
END $delivery$;

-- Pre-existing backups omit this nullable column. Validate the original schema
-- and checksum, and reject a backup that assigns both kinds of primary contact.
DO $backup$
DECLARE definition text:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 marker text:='IF payload->''columns''->t IS DISTINCT FROM app_private.backup_columns(t) AND NOT';
BEGIN
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup column validation';END IF;
 definition:=replace(definition,marker,$columns$IF payload->'columns'->t IS DISTINCT FROM app_private.backup_columns(t)
 AND NOT (t='public.household_contacts' AND payload->'columns'->t = (
  SELECT jsonb_agg(col ORDER BY position) FROM jsonb_array_elements(app_private.backup_columns(t))
  WITH ORDINALITY AS fields(col,position) WHERE col->>'name'<>'is_household_primary'
 )) AND NOT$columns$);
 EXECUTE replace(definition,'RETURN jsonb_build_object(''rows'',n,',$check$
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h
  JOIN jsonb_array_elements(payload->'tables'->'public.household_contacts') c ON c->>'household_id'=h->>'id'
  WHERE c->>'is_household_primary'='true' AND h->>'primary_guest_id' IS NOT NULL
 ) THEN RAISE EXCEPTION 'Multiple primary contacts in backup';END IF;
 RETURN jsonb_build_object('rows',n,$check$);
END $backup$;

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:='{"Edit primary contact": "interface.messages.edit_primary_contact", "Remove primary contact": "interface.messages.remove_primary_contact", "Choose a saved contact": "interface.messages.choose_saved_contact", "Use contact": "interface.messages.use_contact"}';
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;

NOTIFY pgrst,'reload schema';
COMMIT;
