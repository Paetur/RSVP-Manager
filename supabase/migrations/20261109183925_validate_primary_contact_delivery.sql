BEGIN;

CREATE FUNCTION app_private.valid_primary_contact_delivery(p_type text,p_method text,p_value text) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(
  (p_type='email' AND p_method='email' AND btrim(p_value) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
  OR (p_type='phone' AND p_method IN ('sms','whatsapp') AND btrim(p_value) ~ '^[+]?[0-9 .()/-]+$'
   AND length(regexp_replace(p_value,'[^0-9]','','g'))>=5),false);
$$;
REVOKE ALL ON FUNCTION app_private.valid_primary_contact_delivery(text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_household_primary_guest(p_household_id uuid,p_guest_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE guest public.guests;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_guest_id IS NOT NULL THEN
  SELECT * INTO guest FROM public.guests WHERE id=p_guest_id AND household_id=p_household_id AND NOT is_child AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active non-child guest from this household';END IF;
  IF NOT app_private.valid_primary_contact_delivery(
   CASE WHEN guest.preferred_contact_method='email' THEN 'email' ELSE 'phone' END,
   guest.preferred_contact_method,
   CASE WHEN guest.preferred_contact_method='email' THEN guest.email ELSE guest.mobile END
  ) THEN RAISE EXCEPTION 'Matching contact details required';END IF;
 END IF;
 UPDATE public.households SET primary_guest_id=p_guest_id,updated_at=now()
 WHERE id=p_household_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household not found';END IF;
 UPDATE public.household_contacts SET is_household_primary=NULL,updated_at=now()
 WHERE household_id=p_household_id AND is_household_primary IS TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_household_primary_contact(p_household_id uuid,p_contact_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE contact public.household_contacts;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO contact FROM public.household_contacts WHERE id=p_contact_id AND household_id=p_household_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active contact from this household';END IF;
 IF NOT app_private.valid_primary_contact_delivery(contact.contact_type,contact.preferred_method,contact.contact_value) THEN
  RAISE EXCEPTION 'Matching contact details required';
 END IF;
 PERFORM public.admin_set_household_primary_guest(p_household_id,NULL);
 UPDATE public.household_contacts SET is_household_primary=true,updated_at=now() WHERE id=p_contact_id;
END $$;

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:='{"From your household": "interface.messages.primary_contact_from_household", "From guest list": "interface.messages.primary_contact_from_guest_list", "New contact": "interface.messages.primary_contact_new", "Matching contact details required": "interface.messages.matching_contact_details_required", "No household contacts to choose from.": "interface.messages.no_household_contact_choices", "Use Email with an email address, or SMS or WhatsApp with a phone number.": "interface.messages.primary_contact_delivery_help", "Delete": "interface.messages.delete"}';
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;

NOTIFY pgrst,'reload schema';
COMMIT;
