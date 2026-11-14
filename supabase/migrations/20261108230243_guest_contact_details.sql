-- Administrator-only guest contact details; invitation payloads keep explicit allowlists.
BEGIN;
ALTER TABLE public.guests
 ADD COLUMN sort_order integer CHECK(sort_order IS NULL OR sort_order>=0),
 ADD COLUMN phone text CHECK(phone IS NULL OR char_length(phone)<=80),
 ADD COLUMN mobile text CHECK(mobile IS NULL OR char_length(mobile)<=80),
 ADD COLUMN email text CHECK(email IS NULL OR char_length(email)<=254),
 ADD COLUMN preferred_contact_method text CHECK(preferred_contact_method IS NULL OR preferred_contact_method IN ('sms','whatsapp','email'));

CREATE FUNCTION public.admin_save_guest_details(p_guest_id uuid,p_household_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid:=p_guest_id; household uuid; phone_value text;mobile_value text;email_value text;method_value text;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid guest details';END IF;
 phone_value:=nullif(btrim(p_values->>'phone'),'');mobile_value:=nullif(btrim(p_values->>'mobile'),'');email_value:=nullif(btrim(p_values->>'email'),'');method_value:=nullif(p_values->>'preferred_contact_method','');
 IF char_length(coalesce(phone_value,''))>80 OR char_length(coalesce(mobile_value,''))>80 OR char_length(coalesce(email_value,''))>254 THEN RAISE EXCEPTION 'Guest contact field exceeds maximum length';END IF;
 IF email_value IS NOT NULL AND email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid guest email';END IF;
 IF method_value IS NOT NULL AND method_value NOT IN ('sms','whatsapp','email') THEN RAISE EXCEPTION 'Invalid guest contact method';END IF;
 IF method_value IN ('sms','whatsapp') AND mobile_value IS NULL THEN RAISE EXCEPTION 'Enter a mobile number for SMS or WhatsApp';END IF;
 IF method_value='email' AND email_value IS NULL THEN RAISE EXCEPTION 'Enter an email address for email contact';END IF;
 IF target IS NULL THEN
  target:=public.admin_create_guest(p_household_id,p_values);
 ELSE
  SELECT g.household_id INTO household FROM public.guests g JOIN public.households h ON h.id=g.household_id WHERE g.id=target AND g.archived_at IS NULL AND h.archived_at IS NULL FOR UPDATE OF g,h;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active guest not found';END IF;
  IF p_household_id IS NOT NULL AND p_household_id<>household THEN RAISE EXCEPTION 'Guest household mismatch';END IF;
  PERFORM public.admin_update_guest(target,p_values->>'first_name',p_values->>'last_name',p_values->>'courtesy_title',p_values->>'relation',p_values->>'language',coalesce((p_values->>'is_child')::boolean,false),p_values->>'dietary_requirements',p_values->>'notes');
 END IF;
 UPDATE public.guests SET phone=phone_value,mobile=mobile_value,email=email_value,preferred_contact_method=method_value,updated_at=now() WHERE id=target;
 RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_guest_details(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_guest_details(uuid,uuid,jsonb) TO authenticated;

ALTER TABLE public.households ADD COLUMN primary_guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL;
CREATE FUNCTION app_private.check_primary_guest() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.primary_guest_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.guests WHERE id=NEW.primary_guest_id AND household_id=NEW.id AND NOT is_child AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active non-child guest from this household';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.check_primary_guest() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER household_primary_guest BEFORE INSERT OR UPDATE OF primary_guest_id ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.check_primary_guest();
CREATE FUNCTION app_private.clear_ineligible_primary_guest() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.households SET primary_guest_id=NULL WHERE primary_guest_id=NEW.id AND (NEW.is_child OR NEW.archived_at IS NOT NULL OR id<>NEW.household_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.clear_ineligible_primary_guest() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clear_primary_guest AFTER UPDATE OF is_child,archived_at,household_id ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.clear_ineligible_primary_guest();
CREATE FUNCTION public.admin_set_household_primary_guest(p_household_id uuid,p_guest_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('households','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.households WHERE id=p_household_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active household not found';END IF;
 UPDATE public.households SET primary_guest_id=p_guest_id,updated_at=now() WHERE id=p_household_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_household_primary_guest(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_household_primary_guest(uuid,uuid) TO authenticated;
CREATE FUNCTION app_private.delivery_household(h public.households) RETURNS public.households LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE guest public.guests;
BEGIN
 IF h.primary_guest_id IS NOT NULL THEN
  SELECT * INTO guest FROM public.guests WHERE id=h.primary_guest_id AND household_id=h.id AND NOT is_child AND archived_at IS NULL;
  h.email:=CASE WHEN FOUND THEN guest.email ELSE NULL END;h.phone:=CASE WHEN FOUND THEN guest.mobile ELSE NULL END;h.whatsapp:=CASE WHEN FOUND THEN guest.mobile ELSE NULL END;h.preferred_contact_method:=CASE WHEN FOUND THEN coalesce(guest.preferred_contact_method,h.preferred_contact_method) ELSE NULL END;
 END IF;RETURN h;
END $$;
REVOKE ALL ON FUNCTION app_private.delivery_household(public.households) FROM PUBLIC,anon,authenticated;
DO $delivery$
DECLARE definition text;needle text;
BEGIN
 definition:=pg_get_functiondef('public.admin_save_delivery(uuid,uuid,jsonb,integer)'::regprocedure);needle:='destination:=CASE p_values->>''channel''';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected delivery function';END IF;
 definition:=replace(definition,needle,'h:=app_private.delivery_household(h); '||needle);
 definition:=replace(definition,'''contact_name'',h.household_name','''contact_name'',coalesce((SELECT concat_ws('' '',first_name,last_name) FROM public.guests WHERE id=h.primary_guest_id),h.household_name)');
 EXECUTE definition;
 -- Invites can access only the selected primary guest's contact fields, not every
 -- guest's private details. Food-only access still receives no contact fields.
 definition:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 needle:='''archived_at'',a.archived_at)) FROM public.guests a)';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected admin guest projection';END IF;
 definition:=replace(definition,needle,'''archived_at'',a.archived_at,''is_child'',a.is_child) || CASE WHEN i AND EXISTS(SELECT 1 FROM public.households WHERE id=a.household_id AND primary_guest_id=a.id) THEN jsonb_build_object(''phone'',a.phone,''mobile'',a.mobile,''email'',a.email,''preferred_contact_method'',a.preferred_contact_method) ELSE ''{}''::jsonb END) FROM public.guests a)');EXECUTE definition;
END $delivery$;

CREATE FUNCTION public.admin_order_guest(p_guest_id uuid,p_direction integer,p_expected_order uuid[] DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h uuid;ids uuid[];position integer;target integer;swap uuid;manual_ids uuid[];expected_manual uuid[];
BEGIN
 PERFORM app_private.require_permission('households','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Invalid guest order direction';END IF;
 SELECT household_id INTO h FROM public.guests g WHERE id=p_guest_id AND archived_at IS NULL AND EXISTS(SELECT 1 FROM public.households WHERE id=g.household_id AND archived_at IS NULL);
 IF NOT FOUND THEN RAISE EXCEPTION 'Active guest not found';END IF;
 SELECT array_agg(id ORDER BY sort_order NULLS LAST,is_child,lower(first_name),lower(coalesce(last_name,'')),id) INTO ids FROM public.guests WHERE household_id=h AND archived_at IS NULL;
 IF p_expected_order IS NOT NULL THEN
  IF cardinality(p_expected_order)<>cardinality(ids) OR (SELECT count(DISTINCT id) FROM unnest(p_expected_order) id)<>cardinality(ids) OR EXISTS(SELECT 1 FROM unnest(p_expected_order) id WHERE id IS NULL OR NOT(id=ANY(ids))) THEN RAISE EXCEPTION 'Guest list changed; refresh and try again';END IF;
  SELECT array_agg(id ORDER BY sort_order) INTO manual_ids FROM public.guests WHERE household_id=h AND archived_at IS NULL AND sort_order IS NOT NULL;
  SELECT array_agg(expected.id ORDER BY expected.position) INTO expected_manual FROM unnest(p_expected_order) WITH ORDINALITY expected(id,position) JOIN public.guests g ON g.id=expected.id WHERE g.sort_order IS NOT NULL;
  IF manual_ids IS DISTINCT FROM expected_manual THEN RAISE EXCEPTION 'Guest order changed; refresh and try again';END IF;
  ids:=p_expected_order;
 END IF;
 position:=array_position(ids,p_guest_id);target:=position+p_direction;
 IF target<1 OR target>cardinality(ids) THEN RETURN;END IF;
 swap:=ids[position];ids[position]:=ids[target];ids[target]:=swap;
 UPDATE public.guests g SET sort_order=ordered.ordinality::integer,updated_at=now() FROM unnest(ids) WITH ORDINALITY ordered(id,ordinality) WHERE g.id=ordered.id;
END $$;
REVOKE ALL ON FUNCTION public.admin_order_guest(uuid,integer,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_order_guest(uuid,integer,uuid[]) TO authenticated;
CREATE INDEX households_primary_guest_idx ON public.households(primary_guest_id) WHERE primary_guest_id IS NOT NULL;
DO $restore$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('app_private.restore_backup(jsonb)'::regprocedure);
 IF position('"parent_id":null,"latest_rsvp_submission_id":null' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected restore household circular references';END IF;
 definition:=replace(definition,'"parent_id":null,"latest_rsvp_submission_id":null','"parent_id":null,"latest_rsvp_submission_id":null,"primary_guest_id":null');
 definition:=replace(definition,'SET parent_id=(row->>''parent_id'')::uuid,latest_rsvp_submission_id=', 'SET primary_guest_id=(row->>''primary_guest_id'')::uuid,parent_id=(row->>''parent_id'')::uuid,latest_rsvp_submission_id=');EXECUTE definition;
 definition:=pg_get_functiondef('public.admin_move_household(uuid,integer)'::regprocedure);
 definition:=replace(definition,'WHERE id=p_household_id;', 'WHERE id=p_household_id AND archived_at IS NULL;');
 definition:=replace(definition,'WHERE side=v_side AND relation_group_id', 'WHERE archived_at IS NULL AND side=v_side AND relation_group_id');EXECUTE definition;
END $restore$;

-- Older backups may omit these nullable guest fields and the primary guest link. Their original
-- checksum and all other schema/row checks remain required; restore fills NULLs.
DO $upgrade$
DECLARE definition text;old_check text;new_check text;old_cols text;new_cols text;
BEGIN
 definition:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 old_check:='IF payload->''columns''->t IS DISTINCT FROM app_private.backup_columns(t) THEN';
 new_check:='IF payload->''columns''->t IS DISTINCT FROM app_private.backup_columns(t) AND NOT (t IN (''public.guests'',''public.households'') AND payload->''columns''->t = (SELECT jsonb_agg(col ORDER BY position) FROM jsonb_array_elements(app_private.backup_columns(t)) WITH ORDINALITY AS fields(col,position) WHERE NOT (t=''public.guests'' AND col->>''name'' IN (''sort_order'',''phone'',''mobile'',''email'',''preferred_contact_method'')) AND NOT (t=''public.households'' AND col->>''name''=''primary_guest_id''))) THEN';
 old_cols:='SELECT array_agg(attname::text) INTO cols FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;';
 new_cols:='SELECT array_agg(col->>''name'') INTO cols FROM jsonb_array_elements(payload->''columns''->t) col;';
 IF position(old_check IN definition)=0 OR position(old_cols IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup validator definition';END IF;
 definition:=replace(replace(definition,old_check,new_check),old_cols,new_cols);
 definition:=replace(definition,'RETURN jsonb_build_object(''rows'',n,','IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->''tables''->''public.households'') h WHERE nullif(h->>''primary_guest_id'','''') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->''tables''->''public.guests'') g WHERE g->>''id''=h->>''primary_guest_id'' AND g->>''household_id''=h->>''id'' AND g->>''is_child''=''false'' AND (g->>''archived_at'') IS NULL)) THEN RAISE EXCEPTION ''Invalid primary guest in backup'';END IF; RETURN jsonb_build_object(''rows'',n,');
 EXECUTE definition;
END $upgrade$;
REVOKE ALL ON FUNCTION app_private.validate_backup(jsonb) FROM PUBLIC,anon,authenticated;

DO $wording$
DECLARE definition text; additions jsonb := '{"Mobile": "interface.messages.guest_mobile", "Preferred guest contact method": "interface.messages.guest_contact_method", "Copy household contact details": "interface.messages.copy_household_contacts", "Review the copied details before saving. Existing guest values and household information are preserved.": "interface.messages.copy_contacts_review", "Previous household contact details": "interface.messages.previous_household_contacts", "Keep these details until you have reviewed and copied them to a guest.": "interface.messages.keep_previous_contacts", "Primary household contact": "interface.messages.primary_household_contact", "Choose a non-child guest from this household. Their saved contact details are used for new invitation drafts.": "interface.messages.primary_guest_help", "Move guest up": "interface.messages.guest_move_up", "Move guest down": "interface.messages.guest_move_down", "Guest order saved": "interface.messages.guest_order_saved"}'::jsonb;
BEGIN
 definition:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
