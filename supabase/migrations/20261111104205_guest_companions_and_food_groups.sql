-- Household-scoped guest additions and atomic Food Group reservations.
BEGIN;
CREATE FUNCTION public.add_household_guest(p_code text,p_guest_id uuid,p_first_name text,p_last_name text,p_is_child boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households; existing public.guests; deadline timestamptz;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_guest_id IS NULL OR p_is_child IS NULL OR nullif(btrim(p_first_name),'') IS NULL OR length(p_first_name)>120 OR p_last_name IS NULL OR length(p_last_name)>120 THEN RAISE EXCEPTION 'Invalid guest details';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation';END IF;
 SELECT * INTO existing FROM public.guests WHERE id=p_guest_id;
 IF FOUND THEN
  IF existing.household_id<>h.id OR existing.archived_at IS NOT NULL OR existing.first_name<>btrim(p_first_name) OR coalesce(existing.last_name,'')<>btrim(p_last_name) OR existing.is_child<>p_is_child THEN RAISE EXCEPTION 'Guest request changed';END IF;
  RETURN app_private.guest_invitation(h);
 END IF;
 IF h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=h.id) THEN RAISE EXCEPTION 'Guests cannot be added after an RSVP submission';END IF;
 SELECT rsvp_deadline INTO deadline FROM public.event_settings WHERE id=1;
 IF deadline IS NOT NULL AND clock_timestamp()>deadline AND (h.late_submission_until IS NULL OR clock_timestamp()>h.late_submission_until) THEN RAISE EXCEPTION 'RSVP deadline passed';END IF;
 IF (SELECT count(*) FROM public.guests WHERE household_id=h.id AND archived_at IS NULL)>=20 THEN RAISE EXCEPTION 'Contact the organizer to add more guests';END IF;
 INSERT INTO public.guests(id,household_id,first_name,last_name,is_child,language) VALUES(p_guest_id,h.id,btrim(p_first_name),nullif(btrim(p_last_name),''),p_is_child,h.language);
 RETURN app_private.guest_invitation(h);
END $$;
REVOKE ALL ON FUNCTION public.add_household_guest(text,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_household_guest(text,uuid,text,text,boolean) TO service_role;
CREATE TABLE public.food_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 translations jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(translations)='object'),
 category text REFERENCES public.food_categories(name) ON UPDATE CASCADE ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.food_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_groups FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.food_groups TO authenticated;
CREATE POLICY food_groups_read ON public.food_groups FOR SELECT TO authenticated USING (public.admin_has_permission('food'));
ALTER TABLE public.food_items ADD COLUMN food_group_id uuid REFERENCES public.food_groups(id);
CREATE INDEX food_items_group_idx ON public.food_items(food_group_id) WHERE food_group_id IS NOT NULL;
CREATE FUNCTION public.admin_save_food_group(p_id uuid,p_name text,p_translations jsonb,p_category text,p_item_ids uuid[],p_expected_updated timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid:=coalesce(p_id,gen_random_uuid()); existing public.food_groups;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7745);
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR p_translations IS NULL OR jsonb_typeof(p_translations)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(p_translations) e WHERE jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}')>120 OR NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=e.key)) THEN RAISE EXCEPTION 'Invalid Food Group';END IF;
 IF p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.food_categories WHERE name=p_category) THEN RAISE EXCEPTION 'Choose an existing category';END IF;
 IF p_item_ids IS NULL OR cardinality(p_item_ids)<2 OR cardinality(p_item_ids)>100 OR array_position(p_item_ids,NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(p_item_ids) x)<>cardinality(p_item_ids) THEN RAISE EXCEPTION 'Choose at least two different food items';END IF;
 SELECT * INTO existing FROM public.food_groups WHERE id=target FOR UPDATE;
 IF p_id IS NOT NULL AND (NOT FOUND OR existing.updated_at IS DISTINCT FROM p_expected_updated) THEN RAISE EXCEPTION 'Food Group changed; refresh before saving';END IF;
 PERFORM 1 FROM public.food_items WHERE id=ANY(p_item_ids) OR food_group_id=target ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.food_items WHERE id=ANY(p_item_ids))<>cardinality(p_item_ids) OR EXISTS(SELECT 1 FROM public.food_items WHERE id=ANY(p_item_ids) AND food_group_id IS NOT NULL AND food_group_id<>target) THEN RAISE EXCEPTION 'An item is unavailable or already belongs to a Food Group';END IF;
 IF EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE f.id=ANY(p_item_ids) OR f.food_group_id=target) THEN RAISE EXCEPTION 'Resolve existing commitments before changing a Food Group';END IF;
 INSERT INTO public.food_groups(id,name,translations,category) VALUES(target,btrim(p_name),p_translations,p_category) ON CONFLICT(id) DO UPDATE SET name=excluded.name,translations=excluded.translations,category=excluded.category,updated_at=clock_timestamp();
 UPDATE public.food_items SET food_group_id=NULL WHERE food_group_id=target AND NOT(id=ANY(p_item_ids));
 UPDATE public.food_items SET food_group_id=target WHERE id=ANY(p_item_ids);
 RETURN target;
END $$;
CREATE FUNCTION public.admin_delete_food_group(p_id uuid,p_expected_updated timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7745);
 PERFORM 1 FROM public.food_groups WHERE id=p_id AND updated_at=p_expected_updated FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food Group changed; refresh before removing';END IF;
 PERFORM 1 FROM public.food_items WHERE food_group_id=p_id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE f.food_group_id=p_id) THEN RAISE EXCEPTION 'Resolve existing commitments before changing a Food Group';END IF;
 UPDATE public.food_items SET food_group_id=NULL WHERE food_group_id=p_id;
 DELETE FROM public.food_groups WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_food_group(uuid,text,jsonb,text,uuid[],timestamptz),public.admin_delete_food_group(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_food_group(uuid,text,jsonb,text,uuid[],timestamptz),public.admin_delete_food_group(uuid,timestamptz) TO authenticated;
CREATE FUNCTION public.set_household_food_group(p_code text,p_group_id uuid,p_quantity integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households; item uuid; total integer;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_quantity IS NULL OR p_quantity NOT IN (0,1) THEN RAISE EXCEPTION 'Invalid group selection';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR h.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable';END IF;
 PERFORM pg_advisory_xact_lock(19421,7745);
 PERFORM 1 FROM public.food_items WHERE food_group_id=p_group_id ORDER BY id FOR UPDATE;
 SELECT count(*) INTO total FROM public.food_items WHERE food_group_id=p_group_id;
 IF total<2 THEN RAISE EXCEPTION 'Food Group unavailable';END IF;
 IF EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE c.household_id=h.id AND f.food_group_id=p_group_id AND c.quantity<>1) THEN RAISE EXCEPTION 'Contact the organizer to change this commitment';END IF;
 FOR item IN SELECT id FROM public.food_items WHERE food_group_id=p_group_id ORDER BY id LOOP
  PERFORM app_private.save_food_selection(h.id,item,p_quantity,NULL,NULL);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.set_household_food_group(text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_household_food_group(text,uuid,integer) TO service_role;
DO $extend$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.guest_invitation(public.households)'::regprocedure);
 d:=replace(d,'''food_confirmed'',h.food_confirmed','''food_confirmed'',h.food_confirmed,''can_add_guests'',h.rsvp_state=''open'' AND NOT EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=h.id) AND (SELECT rsvp_deadline IS NULL OR clock_timestamp()<=rsvp_deadline OR clock_timestamp()<=h.late_submission_until FROM public.event_settings WHERE id=1)');EXECUTE d;
 d:=pg_get_functiondef('app_private.guest_food(uuid,boolean)'::regprocedure);
 d:=replace(d,'''category'',f.category','''category'',f.category,''food_group_id'',f.food_group_id');
 d:=replace(d,'''confirmed'',coalesce','''groups'',coalesce((SELECT jsonb_agg(jsonb_build_object(''id'',g.id,''name'',g.name,''translations'',g.translations,''category'',g.category,''item_ids'',(SELECT jsonb_agg(id ORDER BY id) FROM public.food_items WHERE food_group_id=g.id))) FROM public.food_groups g WHERE EXISTS(SELECT 1 FROM public.food_items WHERE food_group_id=g.id) AND (NOT EXISTS(SELECT 1 FROM public.food_items f WHERE f.food_group_id=g.id AND (NOT f.active OR NOT app_private.food_venue_eligible(v_household,f.venue_ids))) OR EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE f.food_group_id=g.id AND c.household_id=v_household))),''[]''::jsonb),''confirmed'',coalesce');EXECUTE d;
 d:=pg_get_functiondef('public.admin_load_data()'::regprocedure);d:=replace(d,'RETURN result;','RETURN result || jsonb_build_object(''foodGroups'',CASE WHEN f THEN coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM public.food_groups g),''[]''::jsonb) ELSE ''[]''::jsonb END);');EXECUTE d;
 d:=pg_get_functiondef('app_private.backup_tables()'::regprocedure);d:=replace(d,'''public.food_items''','''public.food_groups'',''public.food_items''');EXECUTE d;
 d:=pg_get_functiondef('app_private.backup_as_template(jsonb,text[])'::regprocedure);d:=replace(d,'''public.food_item_types'',''public.food_items''','''public.food_item_types'',''public.food_groups'',''public.food_items''');EXECUTE d;
 d:=pg_get_functiondef('public.guest_gateway_allow_request(text,text,text)'::regprocedure);d:=replace(d,'''get_invitation_v2''','''add_household_guest'',''set_household_food_group'',''get_invitation_v2''');EXECUTE d;
 d:=pg_get_functiondef('public.set_household_food_claim(text,uuid,integer,text)'::regprocedure);d:=replace(d,'PERFORM app_private.save_food_selection','PERFORM 1 FROM public.food_items WHERE id=p_food_item_id FOR UPDATE; IF EXISTS(SELECT 1 FROM public.food_items WHERE id=p_food_item_id AND food_group_id IS NOT NULL) THEN RAISE EXCEPTION ''Choose the complete Food Group'';END IF; PERFORM app_private.save_food_selection');EXECUTE d;
END $extend$;
REVOKE ALL ON FUNCTION app_private.guest_invitation(public.households),app_private.guest_food(uuid,boolean),app_private.backup_tables(),app_private.backup_as_template(jsonb,text[]) FROM PUBLIC,anon,authenticated;

-- Membership changes cannot silently reinterpret existing commitments, including direct admin table writes.
CREATE FUNCTION app_private.guard_food_group_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.food_group_id IS DISTINCT FROM NEW.food_group_id AND EXISTS(
  SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id
  WHERE f.id=NEW.id OR f.food_group_id=OLD.food_group_id OR f.food_group_id=NEW.food_group_id
 ) THEN RAISE EXCEPTION 'Resolve existing commitments before changing a Food Group';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_food_group_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_food_group_change BEFORE UPDATE OF food_group_id ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_food_group_change();
DO $contracts$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.guest_food(uuid,boolean)'::regprocedure);
 d:=replace(d,'''groups'',coalesce','''categories'',coalesce((SELECT jsonb_agg(jsonb_build_object(''id'',id,''name'',name) ORDER BY sort_order,name) FROM public.food_categories),''[]''::jsonb),''groups'',coalesce');EXECUTE d;
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'''20261110194427''')=0 THEN RAISE EXCEPTION 'Unexpected backup version';END IF;
 EXECUTE replace(d,'''20261110194427''','''20261111104205''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'''20261110194427''')=0 THEN RAISE EXCEPTION 'Unexpected backup validator version';END IF;
 EXECUTE replace(d,'''20261110194427''','''20261111104205''');
END $contracts$;

DO $labels$
DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure); additions jsonb:=$newlabels${"Map & directions": "interface.messages.map_directions", "I am coming with another person": "interface.messages.add_companion", "Add to our household": "interface.messages.add_to_household", "Add someone from your household before confirming your RSVP. They inherit your household’s session invitations.": "interface.messages.companion_help", "Person added. Please review their attendance choices.": "interface.messages.guest_added", "Guest additions are saved only on a published invitation.": "interface.messages.preview_add_guest", "Please contact the organizer to add more people.": "interface.messages.companion_limit", "Could not add this person. Check your invitation or contact the organizer.": "interface.messages.guest_add_error", "Could not reserve the complete group. Availability has been refreshed.": "interface.messages.food_group_error", "Partly assigned by the organizer": "interface.messages.food_group_partial", "Contact the organizer to change this group.": "interface.messages.food_group_unavailable", "Food Group saved.": "interface.messages.food_group_saved", "Time format": "interface.messages.time_format", "Language default": "interface.messages.time_locale", "12-hour (AM/PM)": "interface.messages.time_12", "24-hour": "interface.messages.time_24", "Food Groups": "interface.messages.food_groups", "Add Food Group": "interface.messages.add_food_group", "Selecting this group commits your household to one unit of every listed item.": "interface.messages.group_commitment", "Included items": "interface.messages.group_items", "Choose at least two items. Resolve existing commitments before grouping.": "interface.messages.group_choose", "Select group": "interface.messages.group_pick", "Remove group selection": "interface.messages.group_remove", "Ungroup items": "interface.messages.group_delete", "Ungroup these items? No food item will be deleted.": "interface.messages.group_delete_confirm", "Pick an item you would like to bring. Selected items are reserved for your household.": "interface.messages.food_selection_help"}$newlabels$::jsonb;
BEGIN
 IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;
 EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $labels$;

NOTIFY pgrst,'reload schema';
COMMIT;
