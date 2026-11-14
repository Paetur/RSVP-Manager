BEGIN;
-- Anonymous compatibility endpoints deliberately return no event data, even when published.
CREATE OR REPLACE FUNCTION public.get_public_event() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT NULL::jsonb $$;
CREATE OR REPLACE FUNCTION public.get_public_event_v2() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION app_private.guest_event_for_household(p_household uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH allowed_sessions AS (
 SELECT DISTINCT s.* FROM public.event_sessions s JOIN public.effective_session_invitations i ON i.session_id=s.id WHERE i.household_id=p_household AND s.is_active
 ), allowed_locations AS (SELECT l.* FROM public.event_locations l WHERE l.archived_at IS NULL AND l.id IN(SELECT location_id FROM allowed_sessions)), original AS (SELECT app_private.guest_event() j)
 SELECT j||jsonb_build_object(
 'sessions',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order,s.id) FROM allowed_sessions s),'[]'::jsonb),
 'locations',coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM allowed_locations l),'[]'::jsonb),
 'translations',coalesce((SELECT jsonb_agg(c) FROM jsonb_array_elements(j->'translations') c WHERE
 (c->>'content_key' NOT LIKE 'session:%' OR split_part(c->>'content_key',':',2) IN(SELECT id::text FROM allowed_sessions)) AND
 (c->>'content_key' NOT LIKE 'venue:%' OR split_part(c->>'content_key',':',2) IN(SELECT id::text FROM allowed_locations)) AND
 ((c->>'content_key' NOT LIKE 'food:%' AND c->>'content_key' NOT LIKE 'food-category:%') OR coalesce((SELECT food FROM public.households WHERE id=p_household),false))),'[]'::jsonb)) FROM original
$$;
REVOKE ALL ON FUNCTION app_private.guest_event_for_household(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_invitation_v2(p_code text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.guest_invitation(h)||jsonb_build_object('eventData',app_private.guest_event_for_household(h.id)) FROM public.households h
 WHERE p_code ~ '^[A-HJ-NP-Z2-9]{8}$' AND h.invite_code=p_code AND h.archived_at IS NULL
 AND EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)
$$;
REVOKE ALL ON FUNCTION public.get_invitation_v2(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_v2(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
