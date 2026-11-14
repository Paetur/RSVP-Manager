BEGIN;

-- Guest and preview routes share the same read projections. Only the guest
-- wrappers accept an invitation code and they still require publication.
CREATE FUNCTION app_private.guest_event() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('event',to_jsonb(e),
 'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order),'[]') FROM public.event_sessions s WHERE s.is_active),
 'locations',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order),'[]') FROM public.event_locations l WHERE l.archived_at IS NULL),
 'content',(SELECT coalesce(jsonb_object_agg(c.language_code,c.content_value),'{}') FROM public.event_content c WHERE c.content_key='welcome'),
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.event_content c WHERE c.content_key NOT LIKE 'ui:%'))
 FROM public.event_settings e WHERE e.id=1
$$;

CREATE FUNCTION app_private.guest_invitation(h public.households) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('household',jsonb_build_object('id',h.id,'name',h.household_name,'language',h.language,'rsvp_state',h.rsvp_state,'food_confirmed',h.food_confirmed),'guests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'first_name',g.first_name,'last_name',g.last_name,'language',g.language,'is_child',g.is_child,'courtesy_title',g.courtesy_title) ORDER BY g.created_at) FROM public.guests g WHERE g.archived_at IS NULL AND g.household_id=h.id),'[]'::jsonb),'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('guest_id',v.guest_id,'session_id',v.session_id,'requires_rsvp',v.requires_rsvp,'response',r.rsvp_status)) FROM public.effective_session_invitations v LEFT JOIN public.guest_session_responses r ON r.guest_id=v.guest_id AND r.session_id=v.session_id WHERE v.household_id=h.id),'[]'::jsonb))
$$;

CREATE FUNCTION app_private.guest_food(v_household uuid, p_sample boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
 SELECT jsonb_build_object(
 'confirmed',coalesce((SELECT food_confirmed FROM public.households WHERE id=v_household),false),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_text',f.recipe_text,'quantity_type',f.quantity_type,
   'name_fo',translation_fo.name,'name_en',f.name_en,'name_de',translation_de.name,
   'description_fo',translation_fo.user_comment,'description_en',f.description_en,'description_de',translation_de.user_comment,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_en),f.id)
   FROM public.food_items f
   LEFT JOIN public.food_item_translations translation_fo ON translation_fo.food_item_id=f.id AND translation_fo.language_code='fo'
   LEFT JOIN public.food_item_translations translation_de ON translation_de.food_item_id=f.id AND translation_de.language_code='de'
   LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND (app_private.food_venue_eligible(v_household,f.venue_ids) OR (p_sample AND EXISTS (
     SELECT 1 FROM public.event_sessions s JOIN public.event_locations v ON v.id=s.location_id
     WHERE s.is_active AND v.archived_at IS NULL AND v.id=ANY(f.venue_ids)
   ))) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $function$;


CREATE OR REPLACE FUNCTION public.get_public_event_v2() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.guest_event()
 WHERE EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)
$$;

CREATE OR REPLACE FUNCTION public.get_invitation_v2(p_code text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.guest_invitation(h) FROM public.households h
 WHERE p_code ~ '^[A-HJ-NP-Z2-9]{8}$' AND h.invite_code=p_code AND h.archived_at IS NULL
   AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)
$$;

CREATE OR REPLACE FUNCTION public.get_household_food(p_code text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.guest_food(h.id,false) FROM public.households h
 WHERE h.invite_code=p_code AND h.archived_at IS NULL AND h.food
   AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)
$$;

CREATE FUNCTION public.admin_guest_preview(p_household_id uuid DEFAULT NULL, p_sample boolean DEFAULT false)
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
  SELECT * INTO h FROM public.households WHERE id=p_household_id AND archived_at IS NULL AND invite_code IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This household has no active invitation.'; END IF;
  invitation:=app_private.guest_invitation(h);
  IF h.food THEN food:=app_private.guest_food(h.id,false); END IF;
 END IF;
 RETURN jsonb_build_object('eventData',app_private.guest_event(),'invitation',invitation,'food',food,'households',
  (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',household_name) ORDER BY lower(household_name),id),'[]')
   FROM public.households WHERE archived_at IS NULL AND invite_code IS NOT NULL));
END $$;

REVOKE ALL ON FUNCTION app_private.guest_event(),app_private.guest_invitation(public.households),app_private.guest_food(uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_guest_preview(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_guest_preview(uuid,boolean) TO authenticated;

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:=$labels${
 "Guest preview": "interface.messages.guest_preview",
 "Test changes stay in this tab and are discarded when you close or reload it.": "interface.messages.guest_preview_discard",
 "Preview as": "interface.messages.guest_preview_as",
 "Copy preview link": "interface.messages.guest_preview_copy",
 "Sign in to preview": "interface.messages.guest_preview_sign_in",
 "Preview link": "interface.messages.guest_preview_link",
 "Preview link copied.": "interface.messages.guest_preview_copied",
 "Sign in with an administrator account to open this preview.": "interface.messages.guest_preview_login_required",
 "Guest preview requires access to Households, Invites, Venues and Food.": "interface.messages.guest_preview_access",
 "Guest landing page": "interface.messages.guest_preview_landing",
 "Sample household": "interface.messages.guest_preview_sample",
 "Preview response confirmed.": "interface.messages.guest_preview_response",
 "Preview food selection updated.": "interface.messages.guest_preview_food_updated",
 "Preview food selection confirmed.": "interface.messages.guest_preview_food_confirmed"
}$labels$::jsonb;
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
