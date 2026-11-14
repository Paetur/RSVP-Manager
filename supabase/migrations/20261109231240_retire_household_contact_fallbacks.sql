BEGIN;

SELECT pg_advisory_xact_lock(19421,7744);
LOCK TABLE public.households IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.guests IN SHARE ROW EXCLUSIVE MODE;

-- Retire only details already represented on a guest. Keep the original
-- landline, postal address, guest links, contact records and delivery snapshots.
DO $preflight$
BEGIN
 IF EXISTS(
  SELECT 1 FROM public.households h
  WHERE
   (nullif(btrim(h.email),'') IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.guests g WHERE (g.household_id=h.id OR g.id=h.primary_guest_id)
     AND NOT g.is_child AND g.archived_at IS NULL AND lower(btrim(g.email))=lower(btrim(h.email))))
   OR (nullif(btrim(h.whatsapp),'') IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.guests g WHERE (g.household_id=h.id OR g.id=h.primary_guest_id)
     AND NOT g.is_child AND g.archived_at IS NULL
     AND nullif(regexp_replace(g.mobile,'[^0-9]','','g'),'')=nullif(regexp_replace(h.whatsapp,'[^0-9]','','g'),'')))
   OR (h.preferred_contact_method IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.guests g WHERE g.id=h.primary_guest_id AND NOT g.is_child
     AND g.archived_at IS NULL AND g.preferred_contact_method=h.preferred_contact_method))
 ) THEN RAISE EXCEPTION 'Move the remaining household contact details to guests before retiring these fields';END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.admin_save_household(p_id uuid,p_values jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; v_id uuid:=p_id; parent uuid:=nullif(p_values->>'parent_id','')::uuid;
BEGIN
 PERFORM app_private.require_admin_operation('admin_save_household');
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'household_name'),'') IS NULL OR length(p_values->>'household_name')>140 THEN RAISE EXCEPTION 'Household name is required (maximum 140 characters)';END IF;
 IF length(coalesce(p_values->>'phone',''))>80 OR length(coalesce(p_values->>'notes',''))>2000 THEN RAISE EXCEPTION 'Household field too long';END IF;
 IF length(coalesce(p_values->>'postal_address',''))>1000 THEN RAISE EXCEPTION 'Contact field too long';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_id IS NOT NULL THEN
  SELECT * INTO h FROM public.households WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household not found';END IF;
  IF h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore household before editing';END IF;
  IF (h.side IS DISTINCT FROM p_values->>'side' OR h.relation_group_id IS DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid)
   AND EXISTS(SELECT 1 FROM public.households WHERE parent_id=p_id) THEN RAISE EXCEPTION 'Move child households before changing this household grouping';END IF;
 END IF;
 IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.households WHERE id=parent AND archived_at IS NULL AND side=p_values->>'side' AND relation_group_id IS NOT DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid) THEN RAISE EXCEPTION 'Parent must be active and in the same side and relation group';END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.households(household_name,side,language,relation_group_id,parent_id,phone,postal_address,notes)
  VALUES(btrim(p_values->>'household_name'),p_values->>'side',p_values->>'language',nullif(p_values->>'relation_group_id','')::uuid,parent,nullif(btrim(p_values->>'phone'),''),nullif(btrim(p_values->>'postal_address'),''),nullif(btrim(p_values->>'notes'),''))
  RETURNING id INTO v_id;
 ELSE
  UPDATE public.households SET household_name=btrim(p_values->>'household_name'),side=p_values->>'side',language=p_values->>'language',
   relation_group_id=nullif(p_values->>'relation_group_id','')::uuid,parent_id=parent,phone=nullif(btrim(p_values->>'phone'),''),
   postal_address=nullif(btrim(p_values->>'postal_address'),''),notes=nullif(btrim(p_values->>'notes'),''),updated_at=now() WHERE id=v_id;
 END IF;
 RETURN v_id;
END $$;

DO $delivery$
DECLARE definition text:=pg_get_functiondef('public.admin_save_delivery(uuid,uuid,jsonb,integer)'::regprocedure);
 lookup text:='h:=app_private.delivery_household(h);';
 destination text:='WHEN ''email'' THEN h.email WHEN ''sms'' THEN h.phone WHEN ''whatsapp'' THEN h.whatsapp';
 name_lookup text:='coalesce((SELECT concat_ws('' '',first_name,last_name) FROM public.guests WHERE id=h.primary_guest_id),h.household_name)';
BEGIN
 IF position(lookup IN definition)=0 OR position(destination IN definition)=0 OR position(name_lookup IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected invitation delivery definition';
 END IF;
 definition:=replace(definition,'recipient jsonb;destination text;','recipient jsonb;destination text;guest public.guests;');
 definition:=replace(definition,lookup,$lookup$
 SELECT g.* INTO guest FROM public.guests g JOIN public.households source ON source.id=g.household_id
 WHERE g.id=h.primary_guest_id AND NOT g.is_child AND g.archived_at IS NULL AND source.archived_at IS NULL;
 $lookup$);
 definition:=replace(definition,destination,'WHEN ''email'' THEN guest.email WHEN ''sms'' THEN guest.mobile WHEN ''whatsapp'' THEN guest.mobile');
 definition:=replace(definition,name_lookup,'coalesce(nullif(concat_ws('' '',guest.first_name,guest.last_name),''''),h.household_name)');
 EXECUTE definition;
END $delivery$;

DROP FUNCTION app_private.delivery_household(public.households);
ALTER TABLE public.households DROP COLUMN email, DROP COLUMN whatsapp, DROP COLUMN preferred_contact_method;

NOTIFY pgrst,'reload schema';
COMMIT;
