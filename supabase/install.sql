-- Fresh projects only. Generated from migrations in filename order. Never run on an existing event.

-- Migration: 001_legacy_schema.sql
-- RSVP Manager 001: fresh destination only. Do not apply to source project.
BEGIN;
CREATE TABLE public.relation_groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.food_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.households (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_name text NOT NULL,
 side text NOT NULL CHECK (side IN ('paetur_hentze','maria_haass')),
 language text NOT NULL DEFAULT 'fo' CHECK (language IN ('fo','en','de')),
 email text, phone text, notes text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 invite_code text NOT NULL UNIQUE CHECK (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
 family_name text,relation_group_id uuid REFERENCES public.relation_groups(id) ON DELETE SET NULL,
 parent_id uuid REFERENCES public.households(id) ON DELETE RESTRICT,
 sort_order integer NOT NULL DEFAULT 0,food boolean NOT NULL DEFAULT false,
 stuff boolean NOT NULL DEFAULT false,things boolean NOT NULL DEFAULT false,
 visited boolean NOT NULL DEFAULT false,visited_at timestamptz,last_name text,
 food_confirmed boolean NOT NULL DEFAULT false,food_confirmed_at timestamptz,
 CONSTRAINT household_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);
CREATE TABLE public.guests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 first_name text NOT NULL,last_name text,relation text,
 language text CHECK (language IS NULL OR language IN ('fo','en','de')),
 is_child boolean NOT NULL DEFAULT false,rsvp_status text NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending','attending','declined')),
 dietary_requirements text,notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 courtesy_title text CHECK (courtesy_title IS NULL OR courtesy_title IN ('Mr.','Ms.','Son','Daughter'))
);
CREATE TABLE public.food_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category text,name_fo text NOT NULL,name_en text,name_de text,
 description_fo text,description_en text,description_de text,quantity_needed integer NOT NULL DEFAULT 1 CHECK (quantity_needed>=0),
 active boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.food_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),food_item_id uuid NOT NULL REFERENCES public.food_items(id) ON DELETE RESTRICT,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0),
 notes text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(food_item_id,household_id)
);
CREATE TABLE public.stuff_to_bring (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item text NOT NULL,quantity integer DEFAULT 1,assigned_to text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','done')),
 notes text,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.things_to_do (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task text NOT NULL,assigned_to text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done')),
 due_date date,notes text,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admins (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX households_parent_idx ON public.households(parent_id);
CREATE INDEX households_relation_group_idx ON public.households(relation_group_id);
CREATE INDEX guests_household_idx ON public.guests(household_id);
CREATE INDEX food_claims_household_idx ON public.food_claims(household_id);
CREATE INDEX food_claims_item_idx ON public.food_claims(food_item_id);
-- Avoid recreating old generate_invite_code default until audited replacement exists.
-- Import explicit original invite_code values; new-household creation uses a trusted RPC later.
COMMIT;

-- Migration: 002_rsvp_schema.sql
-- RSVP Manager 002: new reusable single-event schema.
BEGIN;
CREATE TABLE public.event_languages (language_code text PRIMARY KEY CHECK(length(language_code) BETWEEN 2 AND 16),display_name text NOT NULL,enabled boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE public.event_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),event_name text NOT NULL,event_type text NOT NULL DEFAULT 'other',
 default_language text NOT NULL REFERENCES public.event_languages(language_code),timezone text NOT NULL DEFAULT 'Atlantic/Faroe',
 website_url text,rsvp_deadline timestamptz,is_published boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.event_content (content_key text NOT NULL,language_code text NOT NULL REFERENCES public.event_languages(language_code),content_value text NOT NULL,PRIMARY KEY(content_key,language_code));
CREATE TABLE public.event_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,address text,map_url text,notes text,sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE public.event_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_key text NOT NULL UNIQUE,name text NOT NULL,
 location_id uuid REFERENCES public.event_locations(id) ON DELETE RESTRICT,
 starts_at timestamptz,ends_at timestamptz,requires_rsvp boolean NOT NULL DEFAULT true,is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0,CHECK(starts_at IS NULL OR ends_at IS NULL OR ends_at>starts_at)
);
CREATE TABLE public.household_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 contact_name text,contact_type text NOT NULL CHECK(contact_type IN ('email','phone','postal','other')),
 contact_value text NOT NULL CHECK(length(btrim(contact_value))>0),language_code text REFERENCES public.event_languages(language_code),
 is_primary boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,household_id)
);
CREATE UNIQUE INDEX household_primary_contact_per_type ON public.household_contacts(household_id,contact_type) WHERE is_primary;
CREATE TABLE public.household_session_defaults (
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 is_invited boolean NOT NULL DEFAULT true,PRIMARY KEY(household_id,session_id)
);
CREATE TABLE public.guest_session_overrides (
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 is_invited boolean NOT NULL,PRIMARY KEY(guest_id,session_id)
);
CREATE VIEW public.effective_session_invitations WITH (security_invoker=true) AS
 SELECT g.id AS guest_id,g.household_id,s.id AS session_id,s.requires_rsvp
 FROM public.guests g CROSS JOIN public.event_sessions s
 LEFT JOIN public.household_session_defaults d ON d.household_id=g.household_id AND d.session_id=s.id
 LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=s.id
 WHERE s.is_active AND coalesce(o.is_invited,d.is_invited,false);
ALTER TABLE public.households ADD COLUMN rsvp_state text NOT NULL DEFAULT 'open' CHECK(rsvp_state IN ('open','locked'));
ALTER TABLE public.households ADD COLUMN rsvp_submitted_at timestamptz;
ALTER TABLE public.households ADD COLUMN latest_rsvp_submission_id uuid;
ALTER TABLE public.households ADD COLUMN late_submission_until timestamptz;
CREATE TABLE public.rsvp_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 submission_number integer NOT NULL CHECK(submission_number>0),request_id uuid NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(),submission_snapshot jsonb NOT NULL,
 source text NOT NULL DEFAULT 'guest' CHECK(source IN ('guest','admin')),
 UNIQUE(household_id,submission_number),UNIQUE(household_id,request_id),UNIQUE(id,household_id)
);
ALTER TABLE public.households ADD CONSTRAINT household_latest_submission_fk FOREIGN KEY(latest_rsvp_submission_id,id) REFERENCES public.rsvp_submissions(id,household_id) ON DELETE RESTRICT;
CREATE TABLE public.guest_session_responses (
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 rsvp_status text NOT NULL CHECK(rsvp_status IN ('attending','declined')),
 last_submission_id uuid REFERENCES public.rsvp_submissions(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(guest_id,session_id)
);
CREATE TABLE public.rsvp_household_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('submitted','reopened','late_submission_authorized','admin_locked')),
 submission_id uuid REFERENCES public.rsvp_submissions(id) ON DELETE RESTRICT,
 reason text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action NOT IN ('reopened','late_submission_authorized','admin_locked') OR (actor_user_id IS NOT NULL AND length(btrim(reason))>0))
);
CREATE TABLE public.rsvp_response_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE RESTRICT,session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE RESTRICT,
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('submission','admin_correction')),
 previous_status text,new_status text NOT NULL CHECK(new_status IN ('attending','declined')),
 reason text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action <> 'admin_correction' OR (actor_user_id IS NOT NULL AND length(btrim(reason))>0))
);
CREATE TABLE public.message_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_key text NOT NULL,language_code text NOT NULL REFERENCES public.event_languages(language_code),
 channel text NOT NULL CHECK(channel IN ('whatsapp','sms','email','postal','manual')),
 subject text,body text NOT NULL,is_active boolean NOT NULL DEFAULT true,UNIQUE(template_key,language_code,channel)
);
CREATE TABLE public.invitation_send_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE RESTRICT,
 contact_id uuid,channel text NOT NULL CHECK(channel IN ('whatsapp','sms','email','postal','manual')),
 message_subject text,message_body text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','sent','cancelled','failed')),
 created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(contact_id,household_id) REFERENCES public.household_contacts(id,household_id) ON DELETE RESTRICT
);
CREATE TABLE public.invitation_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),queue_id uuid NOT NULL UNIQUE REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT,
 confirmed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 confirmed_at timestamptz NOT NULL DEFAULT now(),recipient_snapshot jsonb NOT NULL,message_snapshot jsonb NOT NULL,delivery_note text
);
CREATE TABLE public.invitation_delivery_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,queue_id uuid NOT NULL REFERENCES public.invitation_send_queue(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,action text NOT NULL,previous_value jsonb,new_value jsonb,
 reason text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX household_contacts_household_idx ON public.household_contacts(household_id);
CREATE INDEX rsvp_submissions_household_time_idx ON public.rsvp_submissions(household_id,submitted_at DESC);
CREATE INDEX rsvp_response_audit_household_time_idx ON public.rsvp_response_audit(household_id,created_at DESC);
CREATE INDEX rsvp_household_audit_household_time_idx ON public.rsvp_household_audit(household_id,created_at DESC);
CREATE INDEX invitation_queue_household_status_idx ON public.invitation_send_queue(household_id,status);
CREATE INDEX invitation_delivery_audit_queue_idx ON public.invitation_delivery_audit(queue_id,created_at DESC);
COMMIT;

-- Migration: 003_security_and_rpcs.sql
-- RSVP Manager 003: SECURITY AND CORE RPCs. Fresh destination only.
-- Review all function bodies and run 004 tests before exposing a public website.
BEGIN;
-- Explicit permissions: no direct anon table access; admins receive only selected tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY[
 'admins','households','guests','relation_groups','food_categories','food_items','food_claims','stuff_to_bring','things_to_do',
 'event_languages','event_settings','event_content','event_locations','event_sessions','household_contacts',
 'household_session_defaults','guest_session_overrides','rsvp_submissions','guest_session_responses',
 'rsvp_household_audit','rsvp_response_audit','message_templates','invitation_send_queue','invitation_deliveries','invitation_delivery_audit'
 ] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
-- Read access for administrators. Write permissions only for configuration tables;
-- all RSVP state/history and delivery history must be written via trusted RPCs.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY[
 'households','guests','relation_groups','food_categories','food_items','food_claims','stuff_to_bring','things_to_do',
 'event_languages','event_settings','event_content','event_locations','event_sessions','household_contacts',
 'household_session_defaults','guest_session_overrides','rsvp_submissions','guest_session_responses',
 'rsvp_household_audit','rsvp_response_audit','message_templates','invitation_send_queue','invitation_deliveries','invitation_delivery_audit'
 ] LOOP
  EXECUTE format('CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin()))',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
END $$;
-- The admins table has deliberately no RLS policy; is_admin() is a tightly scoped definer.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['relation_groups','food_categories','food_items','stuff_to_bring','things_to_do',
 'event_languages','event_settings','event_content','event_locations','event_sessions','household_contacts',
 'household_session_defaults','guest_session_overrides','message_templates','invitation_send_queue'] LOOP
  EXECUTE format('CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()))',t);
  EXECUTE format('CREATE POLICY admin_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))',t);
  EXECUTE format('GRANT INSERT,UPDATE ON public.%I TO authenticated',t);
 END LOOP;
END $$;
-- Household and guest edits, food claims, all RSVP history, delivery confirmation:
-- no direct API UPDATE/INSERT/DELETE; use reviewed RPCs (or trusted migration role).
-- Identity/serial audit sequences are not granted to authenticated clients.

-- Prevent household hierarchy cycles, serializing parent changes across concurrent transactions.
CREATE FUNCTION public.guard_household_parent() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE found_cycle boolean;
BEGIN
 IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 WITH RECURSIVE ancestry(id,parent_id,path) AS (
  SELECT h.id,h.parent_id,ARRAY[h.id] FROM public.households h WHERE h.id=NEW.parent_id
  UNION ALL
  SELECT p.id,p.parent_id,a.path||p.id FROM public.households p JOIN ancestry a ON p.id=a.parent_id
  WHERE NOT p.id=ANY(a.path)
 ) SELECT EXISTS(SELECT 1 FROM ancestry WHERE id=NEW.id OR parent_id=NEW.id) INTO found_cycle;
 IF NEW.parent_id=NEW.id OR found_cycle THEN RAISE EXCEPTION 'Household hierarchy cycle'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER household_parent_guard BEFORE INSERT OR UPDATE OF parent_id ON public.households
 FOR EACH ROW EXECUTE FUNCTION public.guard_household_parent();

-- Append-only history: even privileged application RPCs cannot rewrite/delete audit rows.
CREATE FUNCTION public.prevent_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Historical records are immutable'; END $$;
CREATE TRIGGER immutable_rsvp_submissions BEFORE UPDATE OR DELETE ON public.rsvp_submissions FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_rsvp_household_audit BEFORE UPDATE OR DELETE ON public.rsvp_household_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_rsvp_response_audit BEFORE UPDATE OR DELETE ON public.rsvp_response_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_invitation_deliveries BEFORE UPDATE OR DELETE ON public.invitation_deliveries FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_invitation_delivery_audit BEFORE UPDATE OR DELETE ON public.invitation_delivery_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

CREATE FUNCTION public.get_public_event() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object('event',to_jsonb(e),'sessions',(
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order), '[]'::jsonb)
  FROM public.event_sessions s WHERE s.is_active
 )) INTO result FROM public.event_settings e WHERE e.id=1 AND e.is_published;
 RETURN result;
END $$;

-- Invitation data: do not expose email/phone, dietary data, or invitation codes for other households.
CREATE FUNCTION public.get_invitation_v2(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.households%ROWTYPE; result jsonb;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN NULL; END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
  'household',jsonb_build_object('id',h.id,'name',h.household_name,'language',h.language,'rsvp_state',h.rsvp_state,'food_confirmed',h.food_confirmed),
  'guests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'first_name',g.first_name,'last_name',g.last_name,'language',g.language,'is_child',g.is_child,'courtesy_title',g.courtesy_title) ORDER BY g.created_at)
     FROM public.guests g WHERE g.household_id=h.id),'[]'::jsonb),
  'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('guest_id',v.guest_id,'session_id',v.session_id,'requires_rsvp',v.requires_rsvp,'response',r.rsvp_status))
     FROM public.effective_session_invitations v LEFT JOIN public.guest_session_responses r ON r.guest_id=v.guest_id AND r.session_id=v.session_id
     WHERE v.household_id=h.id),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END $$;

-- p_responses: [{"guest_id":"uuid","session_id":"uuid","status":"attending|declined"}, ...]
CREATE FUNCTION public.submit_household_rsvp(p_code text,p_request_id uuid,p_responses jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.households%ROWTYPE; d public.event_settings%ROWTYPE;
 v_expected integer;v_actual integer;v_submission_id uuid;v_number integer;v_snapshot jsonb;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_request_id IS NULL
    OR jsonb_typeof(p_responses) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid submission'; END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 SELECT id INTO v_submission_id FROM public.rsvp_submissions WHERE household_id=h.id AND request_id=p_request_id;
 IF FOUND THEN RETURN jsonb_build_object('submission_id',v_submission_id,'already_processed',true); END IF;
 IF h.rsvp_state <> 'open' THEN RAISE EXCEPTION 'RSVP is locked'; END IF;
 SELECT * INTO d FROM public.event_settings WHERE id=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event not configured'; END IF;
 IF d.rsvp_deadline IS NOT NULL AND clock_timestamp()>d.rsvp_deadline
    AND (h.late_submission_until IS NULL OR clock_timestamp()>h.late_submission_until)
 THEN RAISE EXCEPTION 'RSVP deadline passed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_responses) x
   WHERE jsonb_typeof(x) <> 'object' OR (x->>'guest_id') IS NULL OR (x->>'session_id') IS NULL
      OR x->>'status' NOT IN ('attending','declined')) THEN RAISE EXCEPTION 'Invalid response entry'; END IF;
 -- Casts also reject malformed UUIDs; duplicate pairs are rejected below.
 IF EXISTS (SELECT 1 FROM (
  SELECT (x->>'guest_id')::uuid guest_id,(x->>'session_id')::uuid session_id,count(*) n
  FROM jsonb_array_elements(p_responses) x GROUP BY 1,2 HAVING count(*)<>1
 ) dup) THEN RAISE EXCEPTION 'Duplicate guest/session response'; END IF;
 SELECT count(*) INTO v_expected FROM public.effective_session_invitations v WHERE v.household_id=h.id AND v.requires_rsvp;
 SELECT count(*) INTO v_actual FROM jsonb_array_elements(p_responses) x
 JOIN public.effective_session_invitations v ON v.guest_id=(x->>'guest_id')::uuid AND v.session_id=(x->>'session_id')::uuid
 WHERE v.household_id=h.id AND v.requires_rsvp;
 IF v_expected<>v_actual OR jsonb_array_length(p_responses)<>v_expected THEN RAISE EXCEPTION 'Incomplete or unauthorized responses'; END IF;
 SELECT coalesce(max(submission_number),0)+1 INTO v_number FROM public.rsvp_submissions WHERE household_id=h.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id',(x->>'guest_id')::uuid,'session_id',(x->>'session_id')::uuid,'status',x->>'status') ORDER BY x->>'guest_id',x->>'session_id'),'[]'::jsonb)
 INTO v_snapshot FROM jsonb_array_elements(p_responses) x;
 INSERT INTO public.rsvp_submissions(household_id,submission_number,request_id,submission_snapshot)
 VALUES(h.id,v_number,p_request_id,v_snapshot) RETURNING id INTO v_submission_id;
 -- Remove obsolete current responses for this household (e.g. changed invitations after reopening).
 DELETE FROM public.guest_session_responses r USING public.guests g WHERE r.guest_id=g.id AND g.household_id=h.id;
 INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status,last_submission_id)
 SELECT (x->>'guest_id')::uuid,(x->>'session_id')::uuid,x->>'status',v_submission_id
 FROM jsonb_array_elements(p_responses) x;
 INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,action,new_status)
 SELECT h.id,(x->>'guest_id')::uuid,(x->>'session_id')::uuid,'submission',x->>'status' FROM jsonb_array_elements(p_responses) x;
 UPDATE public.households SET rsvp_state='locked',rsvp_submitted_at=now(),latest_rsvp_submission_id=v_submission_id,late_submission_until=NULL WHERE id=h.id;
 INSERT INTO public.rsvp_household_audit(household_id,action,submission_id) VALUES(h.id,'submitted',v_submission_id);
 RETURN jsonb_build_object('submission_id',v_submission_id,'submission_number',v_number,'already_processed',false);
END $$;

CREATE FUNCTION public.admin_reopen_household_rsvp(p_household_id uuid,p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.rsvp_state<>'locked' THEN RAISE EXCEPTION 'Household not locked'; END IF;
 UPDATE public.households SET rsvp_state='open',late_submission_until=NULL WHERE id=p_household_id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason)
 VALUES(p_household_id,auth.uid(),'reopened',h.latest_rsvp_submission_id,p_reason);
END $$;

CREATE FUNCTION public.admin_authorize_late_rsvp(p_household_id uuid,p_until timestamptz,p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR p_until IS NULL OR p_until<=clock_timestamp() THEN RAISE EXCEPTION 'Valid expiry and reason required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.rsvp_state<>'open' THEN RAISE EXCEPTION 'Household must be open'; END IF;
 UPDATE public.households SET late_submission_until=p_until WHERE id=p_household_id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason)
 VALUES(p_household_id,auth.uid(),'late_submission_authorized',h.latest_rsvp_submission_id,p_reason);
END $$;

CREATE FUNCTION public.admin_correct_rsvp(p_guest_id uuid,p_session_id uuid,p_status text,p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household_id uuid;v_old text;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF p_status NOT IN ('attending','declined') OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Invalid correction'; END IF;
 SELECT household_id INTO v_household_id FROM public.guests WHERE id=p_guest_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown guest'; END IF;
 PERFORM 1 FROM public.households WHERE id=v_household_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.effective_session_invitations WHERE guest_id=p_guest_id AND session_id=p_session_id AND requires_rsvp) THEN RAISE EXCEPTION 'Not invited'; END IF;
 SELECT rsvp_status INTO v_old FROM public.guest_session_responses WHERE guest_id=p_guest_id AND session_id=p_session_id;
 INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status) VALUES(p_guest_id,p_session_id,p_status)
 ON CONFLICT(guest_id,session_id) DO UPDATE SET rsvp_status=excluded.rsvp_status,updated_at=now();
 INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,actor_user_id,action,previous_status,new_status,reason)
 VALUES(v_household_id,p_guest_id,p_session_id,auth.uid(),'admin_correction',v_old,p_status,p_reason);
END $$;

CREATE FUNCTION public.admin_confirm_invitation_sent(p_queue_id uuid,p_note text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;v_id uuid;v_recipient jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'ready' THEN RAISE EXCEPTION 'Queue item must be ready'; END IF;
 SELECT coalesce(jsonb_build_object('contact_name',c.contact_name,'contact_type',c.contact_type,'contact_value',c.contact_value),jsonb_build_object('household_id',q.household_id))
 INTO v_recipient FROM (SELECT 1) z LEFT JOIN public.household_contacts c ON c.id=q.contact_id;
 INSERT INTO public.invitation_deliveries(queue_id,confirmed_by,recipient_snapshot,message_snapshot,delivery_note)
 VALUES(q.id,auth.uid(),v_recipient,jsonb_build_object('channel',q.channel,'subject',q.message_subject,'body',q.message_body),p_note)
 RETURNING id INTO v_id;
 UPDATE public.invitation_send_queue SET status='sent',updated_at=now() WHERE id=q.id;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,new_value)
 VALUES(q.id,auth.uid(),'confirmed_sent',jsonb_build_object('delivery_id',v_id));
 RETURN v_id;
END $$;

-- Lock down every function explicitly. Public functions are the only anon entry points.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_event() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_v2(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reopen_household_rsvp(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_authorize_late_rsvp(uuid,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_correct_rsvp(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_invitation_sent(uuid,text) TO authenticated;
COMMIT;

-- Migration: 004_food_rpcs.sql
-- RSVP Manager 004: protected food RPCs and validation queries.
BEGIN;
CREATE FUNCTION public.get_household_food(p_code text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid;v_result jsonb;
BEGIN
 SELECT id INTO v_household FROM public.households WHERE invite_code=p_code;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
 'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,'quantity_needed',f.quantity_needed,
 'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0)) ORDER BY f.sort_order)
 FROM public.food_items f WHERE f.active),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes)) FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;
CREATE FUNCTION public.set_household_food_claim(p_code text,p_food_item_id uuid,p_quantity integer,p_notes text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household public.households%ROWTYPE;v_needed integer;v_active boolean;v_total integer;v_old integer;
BEGIN
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO v_household FROM public.households WHERE invite_code=p_code FOR UPDATE;
 IF NOT FOUND OR NOT v_household.food OR v_household.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 SELECT quantity_needed,active INTO v_needed,v_active FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT v_active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0) INTO v_total FROM public.food_claims WHERE food_item_id=p_food_item_id;
 SELECT coalesce(quantity,0) INTO v_old FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 IF v_total-coalesce(v_old,0)+p_quantity>v_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN DELETE FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 ELSE INSERT INTO public.food_claims(household_id,food_item_id,quantity,notes) VALUES(v_household.id,p_food_item_id,p_quantity,p_notes)
 ON CONFLICT(food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,notes=excluded.notes;
 END IF;
END $$;
CREATE FUNCTION public.confirm_household_food(p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
 SELECT id INTO v_id FROM public.households WHERE invite_code=p_code AND food=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid food invitation'; END IF;
 UPDATE public.households SET food_confirmed=true,food_confirmed_at=coalesce(food_confirmed_at,now()) WHERE id=v_id AND NOT food_confirmed;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_household_food(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_household_food(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_household_food(text) TO anon,authenticated;
COMMIT;

-- Migration: 005_event_date_support.sql
-- Fresh-project installation: migration already installed on the existing RSVP database.
ALTER TABLE public.event_settings ADD COLUMN IF NOT EXISTS event_date date;
COMMENT ON COLUMN public.event_settings.event_date IS
'Primary calendar date of the event, without an assumed time of day; session times are separate.';

-- Migration: 006_admin_management.sql
-- RSVP Manager: administrator membership via existing verified Supabase Auth accounts.
-- Never call Supabase Auth admin endpoints from the browser or expose service_role.
-- Apply AFTER 001-005. Uses explicit grants and no table write access for clients.
BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_membership_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    action text NOT NULL CHECK (action IN ('add','remove','rename')),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_membership_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_membership_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_membership_audit TO authenticated;
DROP POLICY IF EXISTS admin_read ON public.admin_membership_audit;
CREATE POLICY admin_read ON public.admin_membership_audit FOR SELECT TO authenticated
USING ((SELECT public.is_admin()));
DROP TRIGGER IF EXISTS immutable_admin_membership_audit ON public.admin_membership_audit;
CREATE TRIGGER immutable_admin_membership_audit BEFORE UPDATE OR DELETE
ON public.admin_membership_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

CREATE OR REPLACE FUNCTION public.admin_list_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',a.name,
                  'email',u.email,'created_at',a.created_at) ORDER BY a.created_at)
      FROM public.admins a JOIN auth.users u ON u.id=a.user_id
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_add_existing_user(p_email text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_id uuid; display_name text; normalized_email text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  normalized_email := lower(btrim(coalesce(p_email,'')));
  display_name := btrim(coalesce(p_name,''));
  IF length(normalized_email) < 3 OR length(normalized_email) > 254 OR
     length(display_name) < 1 OR length(display_name) > 120 THEN
    RAISE EXCEPTION 'Valid email and name required';
  END IF;
  SELECT id INTO target_id FROM auth.users
   WHERE lower(email)=normalized_email AND email_confirmed_at IS NOT NULL;
  IF target_id IS NULL THEN
    RAISE EXCEPTION 'A verified Auth user with this email does not exist. Invite them through Supabase Authentication first.';
  END IF;
  INSERT INTO public.admins(user_id,name) VALUES(target_id,display_name)
  ON CONFLICT (user_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'User is already an administrator'; END IF;
  INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details)
  VALUES(auth.uid(),target_id,'add',jsonb_build_object('name',display_name));
  RETURN jsonb_build_object('user_id',target_id,'name',display_name);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_remove_member(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(42319, 11);
  IF (SELECT count(*) FROM public.admins) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last administrator';
  END IF;
  DELETE FROM public.admins WHERE user_id=p_user_id RETURNING name INTO old_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found'; END IF;
  INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details)
  VALUES(auth.uid(),p_user_id,'remove',jsonb_build_object('name',old_name));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_rename_member(p_user_id uuid,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  new_name := btrim(coalesce(p_name,''));
  IF length(new_name) < 1 OR length(new_name) > 120 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  UPDATE public.admins SET name=new_name WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found'; END IF;
  INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details)
  VALUES(auth.uid(),p_user_id,'rename',jsonb_build_object('name',new_name));
END; $$;

REVOKE ALL ON FUNCTION public.admin_list_members() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_add_existing_user(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_remove_member(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_rename_member(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_existing_user(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rename_member(uuid,text) TO authenticated;
COMMIT;

-- Migration: 007_public_read_api.sql
-- Additional public event read API for the standalone RSVP Manager.
-- Public content is shown only when the event is published.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_public_event_v2()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object(
  'event', to_jsonb(e),
  'sessions', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order), '[]'::jsonb)
               FROM public.event_sessions s WHERE s.is_active),
  'locations', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order), '[]'::jsonb)
               FROM public.event_locations l),
  'content', (SELECT coalesce(jsonb_object_agg(c.language_code,c.content_value), '{}'::jsonb)
              FROM public.event_content c WHERE c.content_key='welcome')
 ) FROM public.event_settings e WHERE e.id=1 AND e.is_published;
$$;
REVOKE ALL ON FUNCTION public.get_public_event_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_event_v2() TO anon,authenticated;

-- Prevent food list discovery through a valid invitation code that lacks food access.
-- Food editing is still controlled separately by set_household_food_claim.
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid;v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
  'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
  'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,'quantity_needed',f.quantity_needed,
  'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0)) ORDER BY f.sort_order)
  FROM public.food_items f WHERE f.active),'[]'::jsonb),
  'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes)) FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;
-- Reassert exact public grants after replace.
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO anon,authenticated;
COMMIT;

-- Migration: 008_seed_new_event_defaults.sql
-- Safe first-time defaults. Existing event settings and language choices are never overwritten.
-- New project owners may change these values after first admin login.
BEGIN;
INSERT INTO public.event_languages(language_code,display_name,enabled,sort_order)
VALUES ('en','English',true,1),('fo','Føroyskt',true,2),('de','Deutsch',true,3)
ON CONFLICT(language_code) DO NOTHING;
INSERT INTO public.event_settings(id,event_name,event_type,default_language,timezone,is_published)
VALUES(1,'My event','other','en','UTC',false)
ON CONFLICT(id) DO NOTHING;
COMMIT;

-- Migration: 009_household_food_ordering.sql
-- RSVP Manager 009: authenticated-admin hierarchy and ordering controls.
-- Idempotent, non-destructive. Leaves existing parent links and sort_order values unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_household_parent(p_household_id uuid, p_parent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_side text; v_group uuid; v_old_parent uuid; v_parent_side text; v_parent_group uuid; v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
  SELECT side,relation_group_id,parent_id INTO v_side,v_group,v_old_parent
    FROM public.households WHERE id=p_household_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
  IF p_parent_id IS NOT NULL THEN
    IF p_parent_id=p_household_id THEN RAISE EXCEPTION 'A household cannot be its own parent'; END IF;
    SELECT side,relation_group_id INTO v_parent_side,v_parent_group
      FROM public.households WHERE id=p_parent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent household not found'; END IF;
    IF v_side<>v_parent_side OR v_group IS DISTINCT FROM v_parent_group THEN
      RAISE EXCEPTION 'Parent must belong to the same side and relation group';
    END IF;
  END IF;
  IF v_old_parent IS NOT DISTINCT FROM p_parent_id THEN RETURN; END IF;
  SELECT coalesce(max(sort_order),0)+1 INTO v_next FROM public.households
    WHERE side=v_side AND relation_group_id IS NOT DISTINCT FROM v_group AND parent_id IS NOT DISTINCT FROM p_parent_id;
  -- The existing guard_household_parent trigger prevents any ancestor cycle.
  UPDATE public.households SET parent_id=p_parent_id,sort_order=v_next,updated_at=now() WHERE id=p_household_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_move_household(p_household_id uuid,p_direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_side text;v_group uuid;v_parent uuid;v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
  SELECT side,relation_group_id,parent_id INTO v_side,v_group,v_parent FROM public.households WHERE id=p_household_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
  SELECT array_agg(id ORDER BY sort_order,lower(household_name),id) INTO v_order
  FROM public.households WHERE side=v_side AND relation_group_id IS NOT DISTINCT FROM v_group AND parent_id IS NOT DISTINCT FROM v_parent;
  v_position:=array_position(v_order,p_household_id);v_target:=v_position+p_direction;
  IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
  v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
  UPDATE public.households h SET sort_order=ordered.ordinality::integer,updated_at=now()
    FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE h.id=ordered.id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_move_food_category(p_category_id uuid,p_direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO v_order FROM public.food_categories;
  v_position:=array_position(v_order,p_category_id);
  IF v_position IS NULL THEN RAISE EXCEPTION 'Category not found'; END IF;
  v_target:=v_position+p_direction;
  IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
  v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
  UPDATE public.food_categories c SET sort_order=ordered.ordinality::integer
    FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE c.id=ordered.id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_move_food_item(p_food_item_id uuid,p_direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_category text;v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT category INTO v_category FROM public.food_items WHERE id=p_food_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
  SELECT array_agg(id ORDER BY sort_order,lower(name_fo),id) INTO v_order
    FROM public.food_items WHERE category IS NOT DISTINCT FROM v_category;
  v_position:=array_position(v_order,p_food_item_id);v_target:=v_position+p_direction;
  IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
  v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
  UPDATE public.food_items f SET sort_order=ordered.ordinality::integer,updated_at=now()
    FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE f.id=ordered.id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_food_category(p_food_item_id uuid,p_category text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old_category text;v_new_category text;v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  v_new_category:=btrim(coalesce(p_category,''));
  IF length(v_new_category)>120 THEN RAISE EXCEPTION 'Category is too long'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT category INTO v_old_category FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
  IF v_new_category<>'' AND NOT EXISTS(SELECT 1 FROM public.food_categories WHERE name=v_new_category) THEN
    RAISE EXCEPTION 'Create the food category before assigning it';
  END IF;
  IF v_old_category IS NOT DISTINCT FROM nullif(v_new_category,'') THEN RETURN; END IF;
  SELECT coalesce(max(sort_order),0)+1 INTO v_next FROM public.food_items WHERE category IS NOT DISTINCT FROM nullif(v_new_category,'');
  UPDATE public.food_items SET category=nullif(v_new_category,''),sort_order=v_next,updated_at=now() WHERE id=p_food_item_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_rename_food_category(p_category_id uuid,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old text;v_new text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  v_new:=btrim(coalesce(p_name,''));
  IF length(v_new)=0 OR length(v_new)>120 THEN RAISE EXCEPTION 'Enter a valid category name'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
  SELECT name INTO v_old FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found'; END IF;
  IF v_old=v_new THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.food_categories WHERE name=v_new) THEN RAISE EXCEPTION 'Category already exists'; END IF;
  UPDATE public.food_categories SET name=v_new WHERE id=p_category_id;
  UPDATE public.food_items SET category=v_new,updated_at=now() WHERE category=v_old;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_household_parent(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_move_household(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_move_food_category(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_move_food_item(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_set_food_category(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_rename_food_category(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_household_parent(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_household(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_food_category(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_food_item(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_food_category(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rename_food_category(uuid,text) TO authenticated;
COMMIT;

-- Migration: 010_guest_food_category_order.sql
-- RSVP Manager 010: order guest food by admin category and item sort order.
-- Safe on populated projects: no guest, food, or claim data is rewritten.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE f.active),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO anon,authenticated;
COMMIT;

-- Migration: 011_enforce_publication_on_guest_rpcs.sql
-- Migration 011: public invitation, RSVP and food functions require event publication.
-- Deployed in the existing wedding project and tested with anonymous role.
-- Keep per-code rate limiting as a separate edge/API requirement.
BEGIN;
CREATE OR REPLACE FUNCTION public.confirm_household_food(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF; 
 SELECT id INTO v_id FROM public.households WHERE invite_code=p_code AND food=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid food invitation'; END IF;
 UPDATE public.households SET food_confirmed=true,food_confirmed_at=coalesce(food_confirmed_at,now()) WHERE id=v_id AND NOT food_confirmed;
END $function$;
CREATE OR REPLACE FUNCTION public.get_invitation_v2(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE h public.households%ROWTYPE; BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RETURN NULL; END IF;  IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN NULL; END IF; SELECT * INTO h FROM public.households WHERE invite_code=p_code; IF NOT FOUND THEN RETURN NULL; END IF; RETURN jsonb_build_object('household',jsonb_build_object('id',h.id,'name',h.household_name,'language',h.language,'rsvp_state',h.rsvp_state,'food_confirmed',h.food_confirmed),'guests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'first_name',g.first_name,'last_name',g.last_name,'language',g.language,'is_child',g.is_child,'courtesy_title',g.courtesy_title) ORDER BY g.created_at) FROM public.guests g WHERE g.household_id=h.id),'[]'::jsonb),'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('guest_id',v.guest_id,'session_id',v.session_id,'requires_rsvp',v.requires_rsvp,'response',r.rsvp_status)) FROM public.effective_session_invitations v LEFT JOIN public.guest_session_responses r ON r.guest_id=v.guest_id AND r.session_id=v.session_id WHERE v.household_id=h.id),'[]'::jsonb)); END $function$;
CREATE OR REPLACE FUNCTION public.set_household_food_claim(p_code text, p_food_item_id uuid, p_quantity integer, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_household public.households%ROWTYPE;v_needed integer;v_active boolean;v_total integer;v_old integer;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF; 
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO v_household FROM public.households WHERE invite_code=p_code FOR UPDATE;
 IF NOT FOUND OR NOT v_household.food OR v_household.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 SELECT quantity_needed,active INTO v_needed,v_active FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT v_active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0) INTO v_total FROM public.food_claims WHERE food_item_id=p_food_item_id;
 SELECT coalesce(quantity,0) INTO v_old FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 IF v_total-coalesce(v_old,0)+p_quantity>v_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN DELETE FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 ELSE INSERT INTO public.food_claims(household_id,food_item_id,quantity,notes) VALUES(v_household.id,p_food_item_id,p_quantity,p_notes)
 ON CONFLICT(food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,notes=excluded.notes;
 END IF;
END $function$;
CREATE OR REPLACE FUNCTION public.submit_household_rsvp(p_code text, p_request_id uuid, p_responses jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE h public.households%ROWTYPE;d public.event_settings%ROWTYPE;v_expected integer;v_actual integer;v_id uuid;v_number integer;v_snapshot jsonb;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF; 
IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_request_id IS NULL OR jsonb_typeof(p_responses) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid submission'; END IF;
SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
SELECT id INTO v_id FROM public.rsvp_submissions WHERE household_id=h.id AND request_id=p_request_id;
IF FOUND THEN RETURN jsonb_build_object('submission_id',v_id,'already_processed',true); END IF;
IF h.rsvp_state<>'open' THEN RAISE EXCEPTION 'RSVP is locked'; END IF;
SELECT * INTO d FROM public.event_settings WHERE id=1;
IF NOT FOUND THEN RAISE EXCEPTION 'Event not configured'; END IF;
IF d.rsvp_deadline IS NOT NULL AND clock_timestamp()>d.rsvp_deadline AND (h.late_submission_until IS NULL OR clock_timestamp()>h.late_submission_until) THEN RAISE EXCEPTION 'RSVP deadline passed'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_responses) x WHERE jsonb_typeof(x)<>'object' OR (x->>'guest_id') IS NULL OR (x->>'session_id') IS NULL OR (x->>'status') IS NULL OR x->>'status' NOT IN ('attending','declined')) THEN RAISE EXCEPTION 'Invalid response entry'; END IF;
IF EXISTS(SELECT 1 FROM (SELECT (x->>'guest_id')::uuid guest_id,(x->>'session_id')::uuid session_id,count(*) n FROM jsonb_array_elements(p_responses) x GROUP BY 1,2 HAVING count(*)<>1) z) THEN RAISE EXCEPTION 'Duplicate response'; END IF;
SELECT count(*) INTO v_expected FROM public.effective_session_invitations v WHERE v.household_id=h.id AND v.requires_rsvp;
SELECT count(*) INTO v_actual FROM jsonb_array_elements(p_responses) x JOIN public.effective_session_invitations v ON v.guest_id=(x->>'guest_id')::uuid AND v.session_id=(x->>'session_id')::uuid WHERE v.household_id=h.id AND v.requires_rsvp;
IF v_expected<>v_actual OR jsonb_array_length(p_responses)<>v_expected THEN RAISE EXCEPTION 'Incomplete or unauthorized responses'; END IF;
SELECT coalesce(max(submission_number),0)+1 INTO v_number FROM public.rsvp_submissions WHERE household_id=h.id;
SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id',(x->>'guest_id')::uuid,'session_id',(x->>'session_id')::uuid,'status',x->>'status') ORDER BY x->>'guest_id',x->>'session_id'),'[]'::jsonb) INTO v_snapshot FROM jsonb_array_elements(p_responses) x;
INSERT INTO public.rsvp_submissions(household_id,submission_number,request_id,submission_snapshot) VALUES(h.id,v_number,p_request_id,v_snapshot) RETURNING id INTO v_id;
DELETE FROM public.guest_session_responses r USING public.guests g WHERE r.guest_id=g.id AND g.household_id=h.id;
INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status,last_submission_id) SELECT (x->>'guest_id')::uuid,(x->>'session_id')::uuid,x->>'status',v_id FROM jsonb_array_elements(p_responses) x;
INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,action,new_status) SELECT h.id,(x->>'guest_id')::uuid,(x->>'session_id')::uuid,'submission',x->>'status' FROM jsonb_array_elements(p_responses) x;
UPDATE public.households SET rsvp_state='locked',rsvp_submitted_at=now(),latest_rsvp_submission_id=v_id,late_submission_until=NULL WHERE id=h.id;
INSERT INTO public.rsvp_household_audit(household_id,action,submission_id) VALUES(h.id,'submitted',v_id);
RETURN jsonb_build_object('submission_id',v_id,'submission_number',v_number,'already_processed',false);
END $function$;
COMMIT;

-- Migration: 012_guest_gateway_rate_limits.sql
-- Migration 012/013: restrict guest calls to the throttled Edge Function and create atomic counters.
-- The Edge Function uses a server-only service-role key; public browser code never receives it.
BEGIN;
CREATE TABLE IF NOT EXISTS public.guest_gateway_rate_limits (
  key_hash text NOT NULL,
  period_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  PRIMARY KEY(key_hash, period_start)
);
ALTER TABLE public.guest_gateway_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_gateway_rate_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.guest_gateway_allow_request(p_ip_hash text, p_code text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_period timestamptz;v_limit integer;v_key text;v_ok boolean;v_code text:=upper(coalesce(p_code,''));v_n integer;
BEGIN
 IF p_ip_hash !~ '^[a-f0-9]{64}$'
 OR p_action NOT IN ('get_invitation_v2','get_household_food','set_household_food_claim','confirm_household_food','submit_household_rsvp')
 OR v_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN false; END IF;
 v_period:=date_trunc('minute',clock_timestamp());
 FOR v_n IN 1..3 LOOP
  IF v_n=1 THEN v_key:='ip:'||p_ip_hash;v_limit:=40;
  ELSIF v_n=2 THEN v_key:='code:'||md5(v_code);v_limit:=20;
  ELSE v_key:='global';v_limit:=2500;END IF;
  INSERT INTO public.guest_gateway_rate_limits(key_hash,period_start,request_count)
   VALUES(v_key,v_period,1)
   ON CONFLICT (key_hash,period_start) DO UPDATE
     SET request_count=public.guest_gateway_rate_limits.request_count+1
     WHERE public.guest_gateway_rate_limits.request_count<v_limit
   RETURNING true INTO v_ok;
  IF coalesce(v_ok,false)=false THEN RETURN false; END IF;
  v_ok:=false;
 END LOOP;
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.guest_gateway_allow_request(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_gateway_allow_request(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_invitation_v2(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_v2(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_household_food_claim(text,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_household_food(text) TO service_role;
COMMIT;

-- Migration: 014_admin_guest_edit.sql
-- 014: Restore administrator guest editing inside the expandable household tree.
-- Only profile fields are editable; RSVP status, household ownership, and submission locks are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_guest(
  p_guest_id uuid,
  p_first_name text,
  p_last_name text,
  p_courtesy_title text,
  p_relation text,
  p_language text,
  p_is_child boolean,
  p_dietary_requirements text,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_first text := NULLIF(pg_catalog.btrim(p_first_name), '');
  v_last text := NULLIF(pg_catalog.btrim(p_last_name), '');
  v_title text := NULLIF(pg_catalog.btrim(p_courtesy_title), '');
  v_relation text := NULLIF(pg_catalog.btrim(p_relation), '');
  v_dietary text := NULLIF(pg_catalog.btrim(p_dietary_requirements), '');
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_guest_id IS NULL OR v_first IS NULL OR pg_catalog.char_length(v_first)>120 THEN
    RAISE EXCEPTION 'A first name of at most 120 characters is required';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_last,''))>120 OR
     pg_catalog.char_length(COALESCE(v_relation,''))>160 OR
     pg_catalog.char_length(COALESCE(v_dietary,''))>1000 OR
     pg_catalog.char_length(COALESCE(v_notes,''))>2000 THEN
    RAISE EXCEPTION 'Guest field exceeds maximum length';
  END IF;
  IF v_title IS NOT NULL AND v_title NOT IN ('Mr.','Ms.','Son','Daughter') THEN
    RAISE EXCEPTION 'Invalid courtesy title';
  END IF;
  IF p_language IS NOT NULL AND p_language NOT IN ('fo','en','de') THEN
    RAISE EXCEPTION 'Invalid guest language';
  END IF;
  IF p_is_child IS NULL THEN
    RAISE EXCEPTION 'Guest child flag is required';
  END IF;

  UPDATE public.guests
  SET first_name=v_first, last_name=v_last,
      courtesy_title=v_title, relation=v_relation,
      language=p_language, is_child=p_is_child,
      dietary_requirements=v_dietary, notes=v_notes,
      updated_at=pg_catalog.now()
  WHERE id=p_guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest not found';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_update_guest(uuid,text,text,text,text,text,boolean,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_guest(uuid,text,text,text,text,text,boolean,text,text)
  TO authenticated;
COMMIT;

-- Migration: 20261030235507_household_guest_management.sql
-- Household/guest lifecycle. No imported identities, codes or responses are changed.
BEGIN;
ALTER TABLE public.households ADD COLUMN archived_at timestamptz;
ALTER TABLE public.guests ADD COLUMN archived_at timestamptz;
ALTER TABLE public.household_contacts ADD COLUMN archived_at timestamptz;
ALTER TABLE public.household_contacts ADD COLUMN preferred_method text CHECK(preferred_method IN ('whatsapp','sms','email','postal','manual'));
CREATE TABLE public.management_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 household_id uuid NOT NULL REFERENCES public.households(id),
 entity_type text NOT NULL, entity_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL, before_value jsonb, after_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX management_audit_household_time ON public.management_audit(household_id,created_at DESC);
ALTER TABLE public.management_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.management_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.management_audit TO authenticated;
CREATE POLICY admin_read ON public.management_audit FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE TRIGGER immutable_management_audit BEFORE UPDATE OR DELETE ON public.management_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.audit_management() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb; a jsonb; h uuid;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN b:=to_jsonb(OLD)-'invite_code'-'updated_at'; END IF;
 a:=to_jsonb(NEW)-'invite_code'-'updated_at';
 IF a IS NOT DISTINCT FROM b THEN RETURN NEW; END IF;
 h:=CASE WHEN TG_TABLE_NAME='households' THEN NEW.id ELSE (a->>'household_id')::uuid END;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value)
 VALUES(h,TG_TABLE_NAME,NEW.id,auth.uid(),lower(TG_OP),b,a);
 -- A move is also visible in the source household's history.
 IF TG_TABLE_NAME='guests' AND TG_OP='UPDATE' AND b->>'household_id' IS DISTINCT FROM a->>'household_id' THEN
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value)
 VALUES((b->>'household_id')::uuid,TG_TABLE_NAME,NEW.id,auth.uid(),'move',b,a);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.audit_management() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER household_management_audit AFTER INSERT OR UPDATE ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();
CREATE TRIGGER guest_management_audit AFTER INSERT OR UPDATE ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();
CREATE TRIGGER contact_management_audit AFTER INSERT OR UPDATE ON public.household_contacts FOR EACH ROW EXECUTE FUNCTION app_private.audit_management();

CREATE FUNCTION public.admin_save_household(p_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; v_id uuid:=p_id; v_code text; bytes bytea; i integer; parent uuid:=nullif(p_values->>'parent_id','')::uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'household_name'),'') IS NULL OR length(p_values->>'household_name')>140 THEN RAISE EXCEPTION 'Household name is required (maximum 140 characters)'; END IF;
 IF length(coalesce(p_values->>'email',''))>320 OR length(coalesce(p_values->>'phone',''))>80 OR length(coalesce(p_values->>'notes',''))>2000 THEN RAISE EXCEPTION 'Household field too long'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_id IS NOT NULL THEN
 SELECT * INTO h FROM public.households WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
 IF h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore household before editing'; END IF;
 -- Keep children in the same grouping; never silently move a whole subtree.
 IF (h.side IS DISTINCT FROM p_values->>'side' OR h.relation_group_id IS DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid)
 AND EXISTS(SELECT 1 FROM public.households WHERE parent_id=p_id) THEN RAISE EXCEPTION 'Move child households before changing this household grouping'; END IF;
 END IF;
 IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.households WHERE id=parent AND archived_at IS NULL AND side=p_values->>'side' AND relation_group_id IS NOT DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid) THEN RAISE EXCEPTION 'Parent must be active and in the same side and relation group'; END IF;
 IF v_id IS NULL THEN
 -- 40 random bits, the existing unambiguous 32-character alphabet, collision retry.
 LOOP
 bytes:=decode(md5(gen_random_uuid()::text),'hex');v_code:='';
 FOR i IN 0..7 LOOP v_code:=v_code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+get_byte(bytes,i)%32,1); END LOOP;
 EXIT WHEN NOT EXISTS(SELECT 1 FROM public.households WHERE invite_code=v_code);
 END LOOP;
 INSERT INTO public.households(household_name,side,language,relation_group_id,parent_id,email,phone,notes,invite_code)
 VALUES(btrim(p_values->>'household_name'),p_values->>'side',p_values->>'language',nullif(p_values->>'relation_group_id','')::uuid,parent,nullif(btrim(p_values->>'email'),''),nullif(btrim(p_values->>'phone'),''),nullif(btrim(p_values->>'notes'),''),v_code) RETURNING id INTO v_id;
 ELSE
 UPDATE public.households SET household_name=btrim(p_values->>'household_name'),side=p_values->>'side',language=p_values->>'language',relation_group_id=nullif(p_values->>'relation_group_id','')::uuid,parent_id=parent,email=nullif(btrim(p_values->>'email'),''),phone=nullif(btrim(p_values->>'phone'),''),notes=nullif(btrim(p_values->>'notes'),''),updated_at=now() WHERE id=v_id;
 END IF;
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_create_guest(p_household_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=p_household_id) THEN RAISE EXCEPTION 'Guests can only be added to active households without submitted RSVPs'; END IF;
 INSERT INTO public.guests(household_id,first_name) VALUES(p_household_id,'New guest') RETURNING id INTO v_id;
 PERFORM public.admin_update_guest(v_id,p_values->>'first_name',p_values->>'last_name',p_values->>'courtesy_title',p_values->>'relation',p_values->>'language',coalesce((p_values->>'is_child')::boolean,false),p_values->>'dietary_requirements',p_values->>'notes');
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_move_guest(p_guest_id uuid,p_household_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.guests%ROWTYPE; target public.households%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO g FROM public.guests WHERE id=p_guest_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Guest not found'; END IF;
 PERFORM 1 FROM public.households WHERE id IN(g.household_id,p_household_id) ORDER BY id FOR UPDATE;
 SELECT * INTO target FROM public.households WHERE id=p_household_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination household not found'; END IF;
 IF g.household_id=p_household_id THEN RETURN; END IF;
 IF g.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.households WHERE id IN(g.household_id,p_household_id) AND (archived_at IS NOT NULL OR rsvp_state<>'open')) OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id IN(g.household_id,p_household_id)) OR EXISTS(SELECT 1 FROM public.guest_session_responses WHERE guest_id=p_guest_id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE guest_id=p_guest_id) THEN RAISE EXCEPTION 'Move requires active households and guest without RSVP history'; END IF;
 -- Freeze the old effective assignment for EVERY session, including inactive sessions.
 INSERT INTO public.guest_session_overrides(guest_id,session_id,is_invited)
 SELECT g.id,s.id,coalesce(o.is_invited,d.is_invited,false) FROM public.event_sessions s
 LEFT JOIN public.household_session_defaults d ON d.household_id=g.household_id AND d.session_id=s.id
 LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=s.id
 ON CONFLICT(guest_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;
 UPDATE public.guests SET household_id=p_household_id,updated_at=now() WHERE id=p_guest_id;
END $$;

CREATE FUNCTION public.admin_set_archived(p_entity text,p_id uuid,p_archived boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; hid uuid; existing timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_entity NOT IN ('households','guests','household_contacts') OR p_entity IS NULL OR p_archived IS NULL THEN RAISE EXCEPTION 'Invalid archive request'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_entity='households' THEN hid:=p_id;
 ELSIF p_entity='guests' THEN SELECT household_id INTO hid FROM public.guests WHERE id=p_id;
 ELSE SELECT household_id INTO hid FROM public.household_contacts WHERE id=p_id; END IF;
 SELECT * INTO h FROM public.households WHERE id=hid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record not found'; END IF;
 IF p_entity<>'households' AND h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the household first'; END IF;
 IF p_entity IN ('households','guests') AND (h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=hid)) THEN RAISE EXCEPTION 'Records with submitted RSVPs cannot be archived or restored'; END IF;
 IF p_entity='guests' AND (EXISTS(SELECT 1 FROM public.guest_session_responses WHERE guest_id=p_id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE guest_id=p_id)) THEN RAISE EXCEPTION 'Guest has RSVP history'; END IF;
 IF p_entity='households' THEN
 IF p_archived AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=hid) OR EXISTS(SELECT 1 FROM public.households WHERE parent_id=hid AND archived_at IS NULL) OR EXISTS(SELECT 1 FROM public.invitation_send_queue WHERE household_id=hid AND status IN ('draft','ready')) OR EXISTS(SELECT 1 FROM public.guests g JOIN public.guest_session_responses r ON r.guest_id=g.id WHERE g.household_id=hid) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE household_id=hid)) THEN RAISE EXCEPTION 'Resolve food commitments, active child households, invitation queues or RSVP history before archiving'; END IF;
 IF NOT p_archived AND EXISTS(SELECT 1 FROM public.households WHERE id=h.parent_id AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Restore the parent household first'; END IF;
 END IF;
 IF p_entity='household_contacts' AND p_archived THEN UPDATE public.household_contacts SET is_primary=false WHERE id=p_id; END IF;
 EXECUTE format('UPDATE public.%I SET archived_at=$1,updated_at=now() WHERE id=$2',p_entity) USING CASE WHEN p_archived THEN now() ELSE NULL END,p_id;
END $$;

CREATE FUNCTION public.admin_save_contact(p_id uuid,p_household_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household required'; END IF;
 IF nullif(btrim(p_values->>'contact_value'),'') IS NULL OR length(p_values->>'contact_value')>1000 OR length(coalesce(p_values->>'contact_name',''))>140 THEN RAISE EXCEPTION 'Enter valid contact details'; END IF;
 IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.household_contacts WHERE id=p_id AND household_id=p_household_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active contact not found'; END IF;
 IF coalesce((p_values->>'is_primary')::boolean,false) THEN UPDATE public.household_contacts SET is_primary=false,updated_at=now() WHERE household_id=p_household_id AND contact_type=p_values->>'contact_type' AND is_primary; END IF;
 IF v_id IS NULL THEN
 INSERT INTO public.household_contacts(household_id,contact_type,contact_value) VALUES(p_household_id,p_values->>'contact_type',btrim(p_values->>'contact_value')) RETURNING id INTO v_id;
 END IF;
 UPDATE public.household_contacts SET contact_name=nullif(btrim(p_values->>'contact_name'),''),contact_type=p_values->>'contact_type',contact_value=btrim(p_values->>'contact_value'),language_code=nullif(p_values->>'language_code',''),preferred_method=nullif(p_values->>'preferred_method',''),is_primary=coalesce((p_values->>'is_primary')::boolean,false),updated_at=now() WHERE id=v_id;
 RETURN v_id;
END $$;
-- Contact writes now use the audited API only.
REVOKE INSERT,UPDATE ON public.household_contacts FROM authenticated;
DO $$ DECLARE f regprocedure; BEGIN
 FOREACH f IN ARRAY ARRAY['public.admin_save_household(uuid,jsonb)'::regprocedure,'public.admin_create_guest(uuid,jsonb)'::regprocedure,'public.admin_move_guest(uuid,uuid)'::regprocedure,'public.admin_set_archived(text,uuid,boolean)'::regprocedure,'public.admin_save_contact(uuid,uuid,jsonb)'::regprocedure] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);
 END LOOP;
END $$;

CREATE OR REPLACE VIEW public.effective_session_invitations WITH (security_invoker=true) AS
 SELECT g.id AS guest_id,g.household_id,s.id AS session_id,s.requires_rsvp
 FROM public.guests g JOIN public.households h ON h.id=g.household_id CROSS JOIN public.event_sessions s
 LEFT JOIN public.household_session_defaults d ON d.household_id=g.household_id AND d.session_id=s.id
 LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=s.id
 WHERE g.archived_at IS NULL AND h.archived_at IS NULL AND s.is_active AND coalesce(o.is_invited,d.is_invited,false);
-- Apply archive filtering to the existing reviewed gateway RPCs without changing their grants.
DO $$ DECLARE f regprocedure; body text; BEGIN
 FOREACH f IN ARRAY ARRAY['public.get_invitation_v2(text)'::regprocedure,'public.submit_household_rsvp(text,uuid,jsonb)'::regprocedure,'public.set_household_food_claim(text,uuid,integer,text)'::regprocedure,'public.confirm_household_food(text)'::regprocedure,'public.get_household_food(text)'::regprocedure] LOOP
 body:=pg_get_functiondef(f);
 body:=replace(body,'WHERE invite_code=p_code','WHERE archived_at IS NULL AND invite_code=p_code');
 body:=replace(body,'WHERE h.invite_code=p_code','WHERE h.archived_at IS NULL AND h.invite_code=p_code');
 IF f='public.get_invitation_v2(text)'::regprocedure THEN body:=replace(body,'WHERE g.household_id=h.id','WHERE g.archived_at IS NULL AND g.household_id=h.id'); END IF;
 EXECUTE body;
 END LOOP;
END $$;

-- Enforce grouping/archive consistency even through the older hierarchy RPC.
CREATE FUNCTION app_private.guard_management_parent() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL AND NEW.archived_at IS NULL AND NOT EXISTS(
 SELECT 1 FROM public.households p WHERE p.id=NEW.parent_id AND p.archived_at IS NULL
 AND p.side=NEW.side AND p.relation_group_id IS NOT DISTINCT FROM NEW.relation_group_id
 ) THEN RAISE EXCEPTION 'Parent must be active and in the same side and relation group'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_management_parent() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER management_parent_guard BEFORE INSERT OR UPDATE OF parent_id,side,relation_group_id,archived_at ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_management_parent();

COMMIT;

-- Migration: 20261031002431_invitation_management_and_household_contacts.sql
-- Empty/group-only households have no invitation. Retired codes are never reassigned.
BEGIN;
ALTER TABLE public.households ALTER COLUMN invite_code DROP NOT NULL;
ALTER TABLE public.households ADD COLUMN whatsapp text;
ALTER TABLE public.households ADD COLUMN postal_address text;
ALTER TABLE public.households ADD COLUMN preferred_contact_method text CHECK(preferred_contact_method IN ('whatsapp','sms','email','postal','manual'));
CREATE TABLE app_private.invitation_code_registry(code text PRIMARY KEY,household_id uuid NOT NULL REFERENCES public.households(id),created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON app_private.invitation_code_registry FROM PUBLIC,anon,authenticated;
ALTER TABLE app_private.invitation_code_registry ENABLE ROW LEVEL SECURITY;
INSERT INTO app_private.invitation_code_registry(code,household_id) SELECT invite_code,id FROM public.households WHERE invite_code IS NOT NULL;
CREATE FUNCTION app_private.sync_invitation_code(p_household_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; code text; bytes bytea; i integer;
BEGIN
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN
   UPDATE public.households SET invite_code=NULL WHERE id=h.id AND invite_code IS NOT NULL;
 ELSIF h.invite_code IS NULL THEN
   LOOP
     bytes:=decode(md5(gen_random_uuid()::text),'hex');code:='';
     FOR i IN 0..7 LOOP code:=code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+get_byte(bytes,i)%32,1); END LOOP;
     INSERT INTO app_private.invitation_code_registry VALUES(code,h.id,now()) ON CONFLICT DO NOTHING;
     EXIT WHEN FOUND;
   END LOOP;
   UPDATE public.households SET invite_code=code WHERE id=h.id;
 END IF;
END $$;
CREATE FUNCTION app_private.sync_guest_invitation_codes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Lifecycle RPCs already lock households in UUID order. Cover trusted direct writes too.
 IF TG_OP='UPDATE' THEN
   PERFORM 1 FROM public.households WHERE id IN(OLD.household_id,NEW.household_id) ORDER BY id FOR UPDATE;
   IF OLD.household_id<>NEW.household_id THEN PERFORM app_private.sync_invitation_code(OLD.household_id); END IF;
 END IF;
 IF TG_OP='DELETE' THEN PERFORM app_private.sync_invitation_code(OLD.household_id);RETURN OLD; END IF;
 PERFORM app_private.sync_invitation_code(NEW.household_id);RETURN NEW;
END $$;
CREATE FUNCTION app_private.sync_archived_invitation_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM app_private.sync_invitation_code(NEW.id);RETURN NEW;END $$;
CREATE FUNCTION app_private.guard_empty_invitation_code() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.invite_code:=NULL;
 ELSIF NEW.invite_code IS NOT NULL AND (NEW.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=NEW.id AND archived_at IS NULL)) THEN NEW.invite_code:=NULL;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.sync_invitation_code(uuid),app_private.sync_guest_invitation_codes(),app_private.sync_archived_invitation_code(),app_private.guard_empty_invitation_code() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER invitation_code_membership AFTER INSERT OR DELETE OR UPDATE OF household_id,archived_at ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.sync_guest_invitation_codes();
CREATE TRIGGER invitation_code_archive AFTER UPDATE OF archived_at ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.sync_archived_invitation_code();
CREATE TRIGGER invitation_code_empty_guard BEFORE INSERT OR UPDATE OF invite_code ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_empty_invitation_code();
UPDATE public.households h SET invite_code=NULL WHERE archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL);
CREATE OR REPLACE FUNCTION public.admin_save_household(p_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE; v_id uuid:=p_id; v_code text; bytes bytea; i integer; parent uuid:=nullif(p_values->>'parent_id','')::uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'household_name'),'') IS NULL OR length(p_values->>'household_name')>140 THEN RAISE EXCEPTION 'Household name is required (maximum 140 characters)'; END IF;
 IF length(coalesce(p_values->>'email',''))>320 OR length(coalesce(p_values->>'phone',''))>80 OR length(coalesce(p_values->>'notes',''))>2000 THEN RAISE EXCEPTION 'Household field too long'; END IF;
 IF length(coalesce(p_values->>'whatsapp',''))>80 OR length(coalesce(p_values->>'postal_address',''))>1000 THEN RAISE EXCEPTION 'Contact field too long'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_id IS NOT NULL THEN
 SELECT * INTO h FROM public.households WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Household not found'; END IF;
 IF h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore household before editing'; END IF;
 -- Keep children in the same grouping; never silently move a whole subtree.
 IF (h.side IS DISTINCT FROM p_values->>'side' OR h.relation_group_id IS DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid)
 AND EXISTS(SELECT 1 FROM public.households WHERE parent_id=p_id) THEN RAISE EXCEPTION 'Move child households before changing this household grouping'; END IF;
 END IF;
 IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.households WHERE id=parent AND archived_at IS NULL AND side=p_values->>'side' AND relation_group_id IS NOT DISTINCT FROM nullif(p_values->>'relation_group_id','')::uuid) THEN RAISE EXCEPTION 'Parent must be active and in the same side and relation group'; END IF;
 IF v_id IS NULL THEN
 v_code:=NULL;
 INSERT INTO public.households(household_name,side,language,relation_group_id,parent_id,email,phone,notes,invite_code)
 VALUES(btrim(p_values->>'household_name'),p_values->>'side',p_values->>'language',nullif(p_values->>'relation_group_id','')::uuid,parent,nullif(btrim(p_values->>'email'),''),nullif(btrim(p_values->>'phone'),''),nullif(btrim(p_values->>'notes'),''),v_code) RETURNING id INTO v_id;
 ELSE
 UPDATE public.households SET household_name=btrim(p_values->>'household_name'),side=p_values->>'side',language=p_values->>'language',relation_group_id=nullif(p_values->>'relation_group_id','')::uuid,parent_id=parent,email=nullif(btrim(p_values->>'email'),''),phone=nullif(btrim(p_values->>'phone'),''),notes=nullif(btrim(p_values->>'notes'),''),updated_at=now() WHERE id=v_id;
 END IF;
 UPDATE public.households SET whatsapp=nullif(btrim(p_values->>'whatsapp'),''),postal_address=nullif(btrim(p_values->>'postal_address'),''),preferred_contact_method=nullif(p_values->>'preferred_contact_method','') WHERE id=v_id;
 RETURN v_id;
END $$;

COMMIT;

-- Migration: 20261031003119_venues_and_session_invitations.sql
-- Independent venues, timezone-aware sessions and audited invitation exceptions.
BEGIN;
ALTER TABLE public.event_locations ADD COLUMN timezone text;
UPDATE public.event_locations SET timezone=coalesce((SELECT timezone FROM public.event_settings WHERE id=1),'UTC');
ALTER TABLE public.event_locations ALTER COLUMN timezone SET NOT NULL;
ALTER TABLE public.event_locations ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE public.event_locations ADD COLUMN country_code text CHECK(country_code ~ '^[A-Z]{2}$');
ALTER TABLE public.event_locations ADD COLUMN archived_at timestamptz;
CREATE TABLE public.event_configuration_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entity_type text NOT NULL,entity_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),before_value jsonb,after_value jsonb,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.event_configuration_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_configuration_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_configuration_audit TO authenticated;
CREATE POLICY admin_read ON public.event_configuration_audit FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE TRIGGER immutable_event_configuration_audit BEFORE UPDATE OR DELETE ON public.event_configuration_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE FUNCTION app_private.audit_event_configuration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb;BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN b:=to_jsonb(OLD);END IF;
 IF b IS DISTINCT FROM to_jsonb(NEW) THEN INSERT INTO public.event_configuration_audit(entity_type,entity_id,actor_user_id,before_value,after_value) VALUES(TG_TABLE_NAME,NEW.id,auth.uid(),b,to_jsonb(NEW));END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.audit_event_configuration() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_venue AFTER INSERT OR UPDATE ON public.event_locations FOR EACH ROW EXECUTE FUNCTION app_private.audit_event_configuration();
CREATE TRIGGER audit_session AFTER INSERT OR UPDATE ON public.event_sessions FOR EACH ROW EXECUTE FUNCTION app_private.audit_event_configuration();

CREATE FUNCTION public.admin_save_venue(p_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;v_archived boolean:=coalesce((p_values->>'archived')::boolean,false);
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR length(coalesce(p_values->>'address',''))>1000 OR length(coalesce(p_values->>'notes',''))>2000 OR length(coalesce(p_values->>'map_url',''))>2000 THEN RAISE EXCEPTION 'Enter valid venue details';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_values->>'timezone') THEN RAISE EXCEPTION 'Invalid venue timezone';END IF;
 IF nullif(p_values->>'map_url','') IS NOT NULL AND p_values->>'map_url' !~ '^https://[^ /]+' THEN RAISE EXCEPTION 'Map link must use HTTPS';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF v_id IS NOT NULL THEN
 PERFORM 1 FROM public.event_locations WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Venue not found';END IF;
 IF v_archived AND EXISTS(SELECT 1 FROM public.event_sessions WHERE location_id=v_id AND is_active) THEN RAISE EXCEPTION 'Move or deactivate linked sessions before archiving this venue';END IF;
 ELSE INSERT INTO public.event_locations(name) VALUES(btrim(p_values->>'name')) RETURNING id INTO v_id;END IF;
 UPDATE public.event_locations SET name=btrim(p_values->>'name'),address=nullif(btrim(p_values->>'address'),''),map_url=nullif(btrim(p_values->>'map_url'),''),notes=nullif(btrim(p_values->>'notes'),''),timezone=p_values->>'timezone',country_code=nullif(upper(btrim(p_values->>'country_code')),''),archived_at=CASE WHEN v_archived THEN coalesce(archived_at,now()) ELSE NULL END WHERE id=v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_save_session(p_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;s public.event_sessions%ROWTYPE;v_location uuid:=nullif(p_values->>'location_id','')::uuid;v_start timestamptz:=nullif(p_values->>'starts_at','')::timestamptz;v_end timestamptz:=nullif(p_values->>'ends_at','')::timestamptz;v_rsvp boolean:=coalesce((p_values->>'requires_rsvp')::boolean,true);v_active boolean:=coalesce((p_values->>'is_active')::boolean,true);
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR p_values->>'session_key' IS NULL OR p_values->>'session_key' !~ '^[a-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'Enter a session name and valid key';END IF;
 IF v_end IS NOT NULL AND (v_start IS NULL OR v_end<=v_start) THEN RAISE EXCEPTION 'End must follow start';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 -- Same household locks as submission and membership changes; eligibility cannot race RSVP.
 PERFORM 1 FROM public.households ORDER BY id FOR UPDATE;
 IF v_location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=v_location AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active venue';END IF;
 IF v_id IS NOT NULL THEN
 SELECT * INTO s FROM public.event_sessions WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Session not found';END IF;
 IF (s.requires_rsvp<>v_rsvp OR s.is_active<>v_active) AND (EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE session_id=v_id) OR EXISTS(SELECT 1 FROM public.guest_session_responses WHERE session_id=v_id) OR EXISTS(SELECT 1 FROM public.rsvp_submissions r JOIN public.guests g ON g.household_id=r.household_id LEFT JOIN public.household_session_defaults d ON d.household_id=r.household_id AND d.session_id=v_id LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=v_id WHERE coalesce(o.is_invited,d.is_invited,false))) THEN RAISE EXCEPTION 'Session eligibility is protected by RSVP history; scheduling details can still be edited';END IF;
 ELSE INSERT INTO public.event_sessions(session_key,name) VALUES(p_values->>'session_key',btrim(p_values->>'name')) RETURNING id INTO v_id;END IF;
 UPDATE public.event_sessions SET session_key=p_values->>'session_key',name=btrim(p_values->>'name'),location_id=v_location,starts_at=v_start,ends_at=v_end,requires_rsvp=v_rsvp,is_active=v_active,sort_order=coalesce((p_values->>'sort_order')::integer,sort_order) WHERE id=v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.admin_save_session_assignments(p_household_id uuid,p_assignments jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;x jsonb;sid uuid;gid uuid;v boolean;b boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_assignments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_assignments)>2000 THEN RAISE EXCEPTION 'Invalid session assignments';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Active household required';END IF;
 IF h.rsvp_state<>'open' OR EXISTS(SELECT 1 FROM public.rsvp_submissions WHERE household_id=h.id) OR EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE household_id=h.id) THEN RAISE EXCEPTION 'Invitation changes are blocked by RSVP history';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_assignments) e GROUP BY e->>'session_id',coalesce(e->>'guest_id','') HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate session assignment';END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
 sid:=(x->>'session_id')::uuid;gid:=nullif(x->>'guest_id','')::uuid;
 IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT x ? 'is_invited' OR (jsonb_typeof(x->'is_invited') NOT IN ('boolean','null')) THEN RAISE EXCEPTION 'Invalid invitation value';END IF;
 v:=(x->>'is_invited')::boolean;
 IF NOT EXISTS(SELECT 1 FROM public.event_sessions WHERE id=sid) THEN RAISE EXCEPTION 'Session not found';END IF;
 IF gid IS NULL THEN
 IF v IS NULL THEN RAISE EXCEPTION 'Household invitation must be yes or no';END IF;
 SELECT is_invited INTO b FROM public.household_session_defaults WHERE household_id=h.id AND session_id=sid;
 INSERT INTO public.household_session_defaults VALUES(h.id,sid,v) ON CONFLICT(household_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM public.guests WHERE id=gid AND household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Guest must belong to this household';END IF;
 SELECT is_invited INTO b FROM public.guest_session_overrides WHERE guest_id=gid AND session_id=sid;
 IF v IS NULL THEN DELETE FROM public.guest_session_overrides WHERE guest_id=gid AND session_id=sid;
 ELSE INSERT INTO public.guest_session_overrides VALUES(gid,sid,v) ON CONFLICT(guest_id,session_id) DO UPDATE SET is_invited=excluded.is_invited;END IF;
 END IF;
 IF b IS DISTINCT FROM v THEN INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value) VALUES(h.id,'session_invitations',coalesce(gid,h.id),auth.uid(),'assign',jsonb_build_object('session_id',sid,'guest_id',gid,'is_invited',b),jsonb_build_object('session_id',sid,'guest_id',gid,'is_invited',v));END IF;
 END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE ON public.event_locations,public.event_sessions,public.household_session_defaults,public.guest_session_overrides FROM authenticated;
REVOKE ALL ON FUNCTION public.admin_save_venue(uuid,jsonb),public.admin_save_session(uuid,jsonb),public.admin_save_session_assignments(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_venue(uuid,jsonb),public.admin_save_session(uuid,jsonb),public.admin_save_session_assignments(uuid,jsonb) TO authenticated;
COMMIT;

-- Migration: 20261031101548_admin_delivery_rsvp_food_controls.sql
-- Audited manual delivery tracking, RSVP administration and food permissions.
BEGIN;
ALTER TABLE public.invitation_send_queue ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE public.invitation_send_queue ADD COLUMN recipient_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.invitation_send_queue ADD COLUMN invitation_code_snapshot text;
UPDATE public.invitation_send_queue q SET invitation_code_snapshot=h.invite_code FROM public.households h WHERE h.id=q.household_id;
REVOKE INSERT,UPDATE,DELETE ON public.invitation_send_queue FROM authenticated;

CREATE FUNCTION public.admin_save_delivery(p_id uuid,p_household_id uuid,p_values jsonb,p_expected_revision integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;q public.invitation_send_queue%ROWTYPE;c public.household_contacts%ROWTYPE;cid uuid:=nullif(p_values->>'contact_id','')::uuid;v_id uuid:=p_id;v_status text:=p_values->>'status';recipient jsonb;destination text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF v_status IS NULL OR v_status NOT IN ('draft','ready','cancelled','failed') OR p_values->>'channel' IS NULL OR p_values->>'channel' NOT IN ('email','whatsapp','sms','postal','manual') OR nullif(btrim(p_values->>'message_body'),'') IS NULL OR length(p_values->>'message_body')>10000 OR length(coalesce(p_values->>'message_subject',''))>300 OR length(coalesce(p_values->>'reason',''))>2000 THEN RAISE EXCEPTION 'Enter valid delivery details';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Household not found';END IF;
 IF p_id IS NOT NULL THEN SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_id AND household_id=h.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF p_expected_revision IS DISTINCT FROM q.revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 IF q.status IN ('sent','cancelled') THEN RAISE EXCEPTION 'Sent and cancelled deliveries are read-only; create a new delivery';END IF;
 END IF;
 IF v_status IN ('cancelled','failed') THEN
 IF p_id IS NULL OR nullif(btrim(p_values->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Existing delivery and reason required';END IF;
 -- Preserve the prepared recipient/message when recording a failed or cancelled attempt.
 UPDATE public.invitation_send_queue SET status=v_status,revision=revision+1,updated_at=clock_timestamp() WHERE id=p_id;
 ELSE
 IF h.archived_at IS NOT NULL OR h.invite_code IS NULL OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active household with guests required';END IF;
 IF cid IS NOT NULL THEN
 SELECT * INTO c FROM public.household_contacts WHERE id=cid AND household_id=h.id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active contact from this household';END IF;
 IF (p_values->>'channel'='email' AND c.contact_type<>'email') OR (p_values->>'channel' IN ('sms','whatsapp') AND c.contact_type<>'phone') OR (p_values->>'channel'='postal' AND c.contact_type<>'postal') THEN RAISE EXCEPTION 'Contact type does not match delivery channel';END IF;
 destination:=c.contact_value;
 recipient:=jsonb_build_object('contact_name',c.contact_name,'contact_type',c.contact_type,'contact_value',destination);
 ELSE
 destination:=CASE p_values->>'channel' WHEN 'email' THEN h.email WHEN 'sms' THEN h.phone WHEN 'whatsapp' THEN h.whatsapp WHEN 'postal' THEN h.postal_address ELSE h.household_name END;
 recipient:=jsonb_build_object('contact_name',h.household_name,'contact_type',p_values->>'channel','contact_value',destination);
 END IF;
 IF v_status='ready' AND nullif(btrim(destination),'') IS NULL THEN RAISE EXCEPTION 'Recipient details required before marking ready';END IF;
 IF p_id IS NULL THEN INSERT INTO public.invitation_send_queue(household_id,channel,message_body,created_by) VALUES(h.id,p_values->>'channel',p_values->>'message_body',auth.uid()) RETURNING id INTO v_id;END IF;
 UPDATE public.invitation_send_queue SET contact_id=cid,channel=p_values->>'channel',message_subject=nullif(btrim(p_values->>'message_subject'),''),message_body=p_values->>'message_body',status=v_status,recipient_snapshot=recipient,invitation_code_snapshot=h.invite_code,revision=CASE WHEN p_id IS NULL THEN 1 ELSE revision+1 END,updated_at=clock_timestamp() WHERE id=v_id;
 END IF;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value,reason) SELECT v_id,auth.uid(),CASE WHEN p_id IS NULL THEN 'created' ELSE v_status END,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(q)-'invitation_code_snapshot' END,to_jsonb(n)-'invitation_code_snapshot',nullif(btrim(p_values->>'reason'),'') FROM public.invitation_send_queue n WHERE n.id=v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_confirm_invitation_sent(p_queue_id uuid,p_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;h public.households%ROWTYPE;hid uuid;v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Delivery note is too long';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT household_id INTO hid FROM public.invitation_send_queue WHERE id=p_queue_id;
 SELECT * INTO h FROM public.households WHERE id=hid FOR UPDATE;
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF q.status='sent' THEN SELECT id INTO v_id FROM public.invitation_deliveries WHERE queue_id=q.id;RETURN v_id;END IF;
 IF q.status<>'ready' THEN RAISE EXCEPTION 'Queue item must be ready';END IF;
 IF h.archived_at IS NOT NULL OR h.invite_code IS NULL OR q.invitation_code_snapshot IS DISTINCT FROM h.invite_code THEN RAISE EXCEPTION 'Invitation has changed; prepare the delivery again';END IF;
 IF nullif(btrim(q.recipient_snapshot->>'contact_value'),'') IS NULL THEN RAISE EXCEPTION 'Recipient details required; prepare the delivery again';END IF;
 INSERT INTO public.invitation_deliveries(queue_id,confirmed_by,recipient_snapshot,message_snapshot,delivery_note) VALUES(q.id,auth.uid(),q.recipient_snapshot,jsonb_build_object('channel',q.channel,'subject',q.message_subject,'body',q.message_body),nullif(btrim(p_note),'')) RETURNING id INTO v_id;
 UPDATE public.invitation_send_queue SET status='sent',revision=revision+1,updated_at=clock_timestamp() WHERE id=q.id;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value,reason) VALUES(q.id,auth.uid(),'confirmed_sent',jsonb_build_object('status','ready'),jsonb_build_object('status','sent','delivery_id',v_id),nullif(btrim(p_note),''));
 RETURN v_id;
END $$;
CREATE FUNCTION public.admin_record_delivery_sent(p_queue_id uuid,p_expected_revision integer,p_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.invitation_send_queue%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found';END IF;
 IF q.status<>'sent' AND q.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 RETURN public.admin_confirm_invitation_sent(p_queue_id,p_note);
END $$;
REVOKE ALL ON FUNCTION public.admin_confirm_invitation_sent(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_set_food_access(p_household_id uuid,p_enabled boolean,p_expected boolean,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_enabled IS NULL OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Food access and reason required';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Active household required';END IF;
 IF h.food IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Food access changed; refresh and try again';END IF;
 IF h.food=p_enabled THEN RETURN;END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Add a guest before enabling food access';END IF;
 IF NOT p_enabled AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=h.id)) THEN RAISE EXCEPTION 'Food commitments exist; access cannot be disabled';END IF;
 UPDATE public.households SET food=p_enabled WHERE id=h.id;
 INSERT INTO public.management_audit(household_id,entity_type,entity_id,actor_user_id,action,before_value,after_value) VALUES(h.id,'food_access',h.id,auth.uid(),'permission_change',jsonb_build_object('enabled',h.food),jsonb_build_object('enabled',p_enabled,'reason',btrim(p_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.admin_reopen_household_rsvp(p_household_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Reason required (maximum 2000 characters)';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'locked' THEN RAISE EXCEPTION 'Active locked household required';END IF;
 UPDATE public.households SET rsvp_state='open',late_submission_until=NULL WHERE id=h.id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason) VALUES(h.id,auth.uid(),'reopened',h.latest_rsvp_submission_id,btrim(p_reason));
END $$;
CREATE OR REPLACE FUNCTION public.admin_authorize_late_rsvp(p_household_id uuid,p_until timestamptz,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 OR p_until IS NULL OR NOT isfinite(p_until) OR p_until<=clock_timestamp() THEN RAISE EXCEPTION 'Valid future expiry and reason required';END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR h.rsvp_state<>'open' THEN RAISE EXCEPTION 'Active open household required';END IF;
 UPDATE public.households SET late_submission_until=p_until WHERE id=h.id;
 INSERT INTO public.rsvp_household_audit(household_id,actor_user_id,action,submission_id,reason) VALUES(h.id,auth.uid(),'late_submission_authorized',h.latest_rsvp_submission_id,btrim(p_reason));
END $$;
CREATE OR REPLACE FUNCTION public.admin_correct_rsvp(p_guest_id uuid,p_session_id uuid,p_status text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE hid uuid;v_old text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_status IS NULL OR p_status NOT IN ('attending','declined') OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Valid response and reason required';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT household_id INTO hid FROM public.guests WHERE id=p_guest_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active guest required';END IF;
 PERFORM 1 FROM public.households WHERE id=hid AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.effective_session_invitations WHERE guest_id=p_guest_id AND session_id=p_session_id AND requires_rsvp) THEN RAISE EXCEPTION 'Guest is not invited to this RSVP session';END IF;
 SELECT rsvp_status INTO v_old FROM public.guest_session_responses WHERE guest_id=p_guest_id AND session_id=p_session_id;
 IF v_old=p_status THEN RETURN;END IF;
 INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status) VALUES(p_guest_id,p_session_id,p_status) ON CONFLICT(guest_id,session_id) DO UPDATE SET rsvp_status=excluded.rsvp_status,updated_at=clock_timestamp();
 INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,actor_user_id,action,previous_status,new_status,reason) VALUES(hid,p_guest_id,p_session_id,auth.uid(),'admin_correction',v_old,p_status,btrim(p_reason));
END $$;
REVOKE ALL ON FUNCTION public.admin_save_delivery(uuid,uuid,jsonb,integer),public.admin_record_delivery_sent(uuid,integer,text),public.admin_set_food_access(uuid,boolean,boolean,text),public.admin_reopen_household_rsvp(uuid,text),public.admin_authorize_late_rsvp(uuid,timestamptz,text),public.admin_correct_rsvp(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_delivery(uuid,uuid,jsonb,integer),public.admin_record_delivery_sent(uuid,integer,text),public.admin_set_food_access(uuid,boolean,boolean,text),public.admin_reopen_household_rsvp(uuid,text),public.admin_authorize_late_rsvp(uuid,timestamptz,text),public.admin_correct_rsvp(uuid,uuid,text,text) TO authenticated;
COMMIT;

-- Migration: 20261031135203_venue_welcome_messages.sql
BEGIN;
ALTER TABLE public.event_locations ADD COLUMN welcome_fo text CHECK(length(welcome_fo)<=4000);
ALTER TABLE public.event_locations ADD COLUMN welcome_en text CHECK(length(welcome_en)<=4000);
ALTER TABLE public.event_locations ADD COLUMN welcome_de text CHECK(length(welcome_de)<=4000);
-- Preserve existing messages while making them independently editable per venue.
UPDATE public.event_locations SET welcome_fo=(SELECT content_value FROM public.event_content WHERE content_key='welcome' AND language_code='fo'),welcome_en=(SELECT content_value FROM public.event_content WHERE content_key='welcome' AND language_code='en'),welcome_de=(SELECT content_value FROM public.event_content WHERE content_key='welcome' AND language_code='de');
CREATE OR REPLACE FUNCTION public.admin_save_venue(p_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;v_archived boolean:=coalesce((p_values->>'archived')::boolean,false);
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR length(coalesce(p_values->>'address',''))>1000 OR length(coalesce(p_values->>'notes',''))>2000 OR length(coalesce(p_values->>'map_url',''))>2000 THEN RAISE EXCEPTION 'Enter valid venue details';END IF;
 IF length(coalesce(p_values->>'welcome_fo',''))>4000 OR length(coalesce(p_values->>'welcome_en',''))>4000 OR length(coalesce(p_values->>'welcome_de',''))>4000 THEN RAISE EXCEPTION 'Welcome message too long (maximum 4000 characters per language)';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_values->>'timezone') THEN RAISE EXCEPTION 'Invalid venue timezone';END IF;
 IF nullif(p_values->>'map_url','') IS NOT NULL AND p_values->>'map_url' !~ '^https://[^ /]+' THEN RAISE EXCEPTION 'Map link must use HTTPS';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF v_id IS NOT NULL THEN
 PERFORM 1 FROM public.event_locations WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Venue not found';END IF;
 IF v_archived AND EXISTS(SELECT 1 FROM public.event_sessions WHERE location_id=v_id AND is_active) THEN RAISE EXCEPTION 'Move or deactivate linked sessions before archiving this venue';END IF;
 ELSE INSERT INTO public.event_locations(name) VALUES(btrim(p_values->>'name')) RETURNING id INTO v_id;END IF;
 UPDATE public.event_locations SET name=btrim(p_values->>'name'),address=nullif(btrim(p_values->>'address'),''),map_url=nullif(btrim(p_values->>'map_url'),''),notes=nullif(btrim(p_values->>'notes'),''),timezone=p_values->>'timezone',welcome_fo=CASE WHEN p_values ? 'welcome_fo' THEN nullif(btrim(p_values->>'welcome_fo'),'') ELSE welcome_fo END,welcome_en=CASE WHEN p_values ? 'welcome_en' THEN nullif(btrim(p_values->>'welcome_en'),'') ELSE welcome_en END,welcome_de=CASE WHEN p_values ? 'welcome_de' THEN nullif(btrim(p_values->>'welcome_de'),'') ELSE welcome_de END,country_code=nullif(upper(btrim(p_values->>'country_code')),''),archived_at=CASE WHEN v_archived THEN coalesce(archived_at,now()) ELSE NULL END WHERE id=v_id;
 RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_save_venue(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_venue(uuid,jsonb),public.admin_save_household(uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Migration: 20261031212201_unified_administration_logs.sql
BEGIN;
CREATE TABLE public.invitation_access_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,household_id uuid NOT NULL REFERENCES public.households(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX invitation_access_time ON public.invitation_access_audit(household_id,created_at DESC);
CREATE TABLE public.admin_session_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_user_id uuid NOT NULL REFERENCES auth.users(id),session_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('login','logout_requested')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(session_id,action));
ALTER TABLE public.invitation_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_session_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invitation_access_audit,public.admin_session_audit FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_invitation_access BEFORE UPDATE OR DELETE ON public.invitation_access_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE TRIGGER immutable_admin_session BEFORE UPDATE OR DELETE ON public.admin_session_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
CREATE FUNCTION public.record_invitation_open(p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
 IF NOT FOUND OR h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RETURN;END IF;
 -- Coalesce repeated loads from the same household into one opening every 15 minutes.
 IF NOT EXISTS(SELECT 1 FROM public.invitation_access_audit WHERE household_id=h.id AND created_at>clock_timestamp()-interval '15 minutes') THEN INSERT INTO public.invitation_access_audit(household_id) VALUES(h.id);END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_invitation_open(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_invitation_open(text) TO service_role;
CREATE FUNCTION public.admin_record_session(p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;started timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN ('login','logout_requested') THEN RAISE EXCEPTION 'Invalid session action';END IF;
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 SELECT created_at INTO started FROM auth.sessions WHERE id=sid AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified sign-in session required';END IF;
 INSERT INTO public.admin_session_audit(actor_user_id,session_id,action,created_at) VALUES(auth.uid(),sid,p_action,CASE WHEN p_action='login' THEN started ELSE clock_timestamp() END) ON CONFLICT(session_id,action) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.admin_record_session(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_session(text) TO authenticated;

CREATE VIEW app_private.administration_log_entries AS
SELECT 'management:'||m.id::text event_key,m.created_at occurred_at,
 CASE m.entity_type WHEN 'households' THEN 'households' WHEN 'guests' THEN 'guests' WHEN 'household_contacts' THEN 'contacts' WHEN 'food_access' THEN 'food' WHEN 'session_invitations' THEN 'rsvp' ELSE 'households' END category,
 CASE WHEN m.entity_type='session_invitations' THEN 'invitations_changed' WHEN m.action='insert' THEN 'add' WHEN m.action='delete' THEN 'delete' WHEN m.action='update' AND m.before_value->>'archived_at' IS DISTINCT FROM m.after_value->>'archived_at' THEN CASE WHEN m.after_value->>'archived_at' IS NULL THEN 'restore' ELSE 'archive' END WHEN m.action IN ('update','permission_change') THEN 'update' ELSE m.action END action,
 m.household_id,m.actor_user_id,
 coalesce(nullif(concat_ws(' ',m.after_value->>'first_name',m.after_value->>'last_name'),''),m.after_value->>'contact_name',m.after_value->>'household_name',m.entity_type) subject,
 jsonb_build_object('entity',m.entity_type,'before',m.before_value,'after',m.after_value) details
FROM public.management_audit m
UNION ALL SELECT 'rsvp-household:'||r.id,r.created_at,'rsvp',r.action,r.household_id,r.actor_user_id,'Household RSVP',jsonb_build_object('reason',r.reason,'submission_id',r.submission_id) FROM public.rsvp_household_audit r
UNION ALL SELECT 'rsvp-response:'||r.id,r.created_at,'rsvp',CASE r.action WHEN 'submission' THEN 'response_submitted' ELSE 'response_corrected' END,r.household_id,r.actor_user_id,concat_ws(' ',g.first_name,g.last_name),jsonb_build_object('session',s.name,'before',r.previous_status,'after',r.new_status,'reason',r.reason) FROM public.rsvp_response_audit r LEFT JOIN public.guests g ON g.id=r.guest_id LEFT JOIN public.event_sessions s ON s.id=r.session_id
UNION ALL SELECT 'delivery:'||a.id,a.created_at,'invitations',CASE a.action WHEN 'confirmed_sent' THEN 'sent' ELSE a.action END,q.household_id,a.actor_user_id,'Invitation delivery',jsonb_build_object('channel',q.channel,'reason',a.reason,'before_status',a.previous_value->>'status','after_status',a.new_value->>'status') FROM public.invitation_delivery_audit a JOIN public.invitation_send_queue q ON q.id=a.queue_id
UNION ALL SELECT 'opened:'||a.id,a.created_at,'invitations','opened',a.household_id,NULL::uuid,'Invitation opened',jsonb_build_object('recording','Successful invitation load; repeated loads within 15 minutes are grouped') FROM public.invitation_access_audit a
UNION ALL SELECT 'configuration:'||a.id,a.created_at,CASE a.entity_type WHEN 'event_locations' THEN 'venues' ELSE 'sessions' END,CASE WHEN a.before_value IS NULL THEN 'add' WHEN a.before_value->>'archived_at' IS DISTINCT FROM a.after_value->>'archived_at' THEN CASE WHEN a.after_value->>'archived_at' IS NULL THEN 'restore' ELSE 'archive' END ELSE 'update' END,NULL::uuid,a.actor_user_id,coalesce(a.after_value->>'name',a.entity_type),jsonb_build_object('before',a.before_value,'after',a.after_value) FROM public.event_configuration_audit a
UNION ALL SELECT 'membership:'||a.id,a.created_at,'administrators',a.action,NULL::uuid,a.actor_id,coalesce(a.details->>'name','Administrator access'),jsonb_build_object('subject_id',a.subject_id,'details',a.details) FROM public.admin_membership_audit a
UNION ALL SELECT 'app-session:'||a.id,a.created_at,'login',a.action,NULL::uuid,a.actor_user_id,'Administrator session',jsonb_build_object('source','Verified app session') FROM public.admin_session_audit a
UNION ALL SELECT 'auth:'||a.id,a.created_at,'login',coalesce(a.payload->>'action','auth_event'),NULL::uuid,u.id,'Authentication',jsonb_build_object('source','Auth service','provider',a.payload->>'provider') FROM auth.audit_log_entries a LEFT JOIN auth.users u ON u.id::text=a.payload->>'actor_id' WHERE a.created_at IS NOT NULL;
REVOKE ALL ON app_private.administration_log_entries FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_query_logs(p_search text DEFAULT '',p_category text DEFAULT '',p_action text DEFAULT '',p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_before_at timestamptz DEFAULT NULL,p_before_key text DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR length(coalesce(p_search,''))>200 OR length(coalesce(p_action,''))>80 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to) OR ((p_before_at IS NULL)<>(p_before_key IS NULL)) THEN RAISE EXCEPTION 'Invalid log filters';END IF;
 IF coalesce(p_category,'') NOT IN ('','households','guests','contacts','rsvp','invitations','login','venues','sessions','food','administrators') THEN RAISE EXCEPTION 'Invalid log category';END IF;
 WITH filtered AS (
 SELECT e.*,h.household_name,coalesce(a.name,u.email,CASE WHEN e.category='invitations' AND e.action='opened' THEN 'Guest' WHEN e.actor_user_id IS NULL THEN 'Guest / system' ELSE 'Administrator' END) actor
 FROM app_private.administration_log_entries e LEFT JOIN public.households h ON h.id=e.household_id LEFT JOIN public.admins a ON a.user_id=e.actor_user_id LEFT JOIN auth.users u ON u.id=e.actor_user_id
 WHERE (coalesce(p_category,'')='' OR e.category=p_category) AND (coalesce(p_action,'')='' OR e.action=p_action) AND (p_from IS NULL OR e.occurred_at>=p_from) AND (p_to IS NULL OR e.occurred_at<p_to)
 AND (p_before_at IS NULL OR (e.occurred_at,e.event_key)<(p_before_at,p_before_key))
 AND (coalesce(btrim(p_search),'')='' OR position(lower(btrim(p_search)) in lower(concat_ws(' ',e.subject,h.household_name,a.name,u.email,e.category,e.action,e.details::text)))>0)
 ORDER BY e.occurred_at DESC,e.event_key DESC LIMIT p_limit+1
 ), numbered AS (SELECT *,row_number() over(ORDER BY occurred_at DESC,event_key DESC) n FROM filtered)
 SELECT jsonb_build_object('entries',coalesce(jsonb_agg(to_jsonb(numbered)-'n' ORDER BY occurred_at DESC,event_key DESC) FILTER(WHERE n<=p_limit),'[]'::jsonb),'has_more',count(*)>p_limit) INTO result FROM numbered;
 result:=result||jsonb_build_object('actions',(SELECT coalesce(jsonb_agg(action ORDER BY action),'[]'::jsonb) FROM (SELECT DISTINCT action FROM app_private.administration_log_entries WHERE coalesce(p_category,'')='' OR category=p_category) a));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_query_logs(text,text,text,timestamptz,timestamptz,timestamptz,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_query_logs(text,text,text,timestamptz,timestamptz,timestamptz,text,integer) TO authenticated;
CREATE INDEX rsvp_household_log_time ON public.rsvp_household_audit(created_at DESC,id DESC);
CREATE INDEX rsvp_response_log_time ON public.rsvp_response_audit(created_at DESC,id DESC);
CREATE INDEX invitation_delivery_log_time ON public.invitation_delivery_audit(created_at DESC,id DESC);
CREATE INDEX admin_membership_log_time ON public.admin_membership_audit(created_at DESC,id DESC);
CREATE INDEX management_audit_log_time ON public.management_audit(created_at DESC,id DESC);
CREATE INDEX event_configuration_audit_log_time ON public.event_configuration_audit(created_at DESC,id DESC);
CREATE INDEX admin_session_log_time ON public.admin_session_audit(created_at DESC,id DESC);
CREATE INDEX invitation_access_log_time ON public.invitation_access_audit(created_at DESC,id DESC);
CREATE FUNCTION public.get_invitation_logged(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invitation jsonb;
BEGIN
 invitation:=public.get_invitation_v2(p_code);
 IF invitation IS NOT NULL THEN PERFORM public.record_invitation_open(p_code);END IF;
 RETURN invitation;
END $$;
REVOKE ALL ON FUNCTION public.get_invitation_logged(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_logged(text) TO service_role;

COMMIT;

-- Migration: 20261031215758_guest_linked_household_contacts.sql
BEGIN;
ALTER TABLE public.household_contacts ADD COLUMN guest_id uuid REFERENCES public.guests(id) ON DELETE RESTRICT;
CREATE INDEX household_contact_guest ON public.household_contacts(guest_id) WHERE guest_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.admin_save_contact(p_id uuid,p_household_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;linked_guest uuid;existing_guest uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active household required'; END IF;
 IF nullif(btrim(p_values->>'contact_value'),'') IS NULL OR length(p_values->>'contact_value')>1000 OR length(coalesce(p_values->>'contact_name',''))>140 THEN RAISE EXCEPTION 'Enter valid contact details'; END IF;
 IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.household_contacts WHERE id=p_id AND household_id=p_household_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Active contact not found'; END IF;
 IF p_id IS NOT NULL THEN SELECT guest_id INTO existing_guest FROM public.household_contacts WHERE id=p_id;END IF;
 linked_guest:=CASE WHEN p_values ? 'guest_id' THEN nullif(p_values->>'guest_id','')::uuid ELSE existing_guest END;
 IF linked_guest IS NOT NULL AND (p_id IS NULL OR linked_guest IS DISTINCT FROM existing_guest) AND NOT EXISTS(SELECT 1 FROM public.guests g JOIN public.households h ON h.id=g.household_id WHERE g.id=linked_guest AND g.archived_at IS NULL AND h.archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active guest from an active household';END IF;
 IF coalesce((p_values->>'is_primary')::boolean,false) THEN UPDATE public.household_contacts SET is_primary=false,updated_at=now() WHERE household_id=p_household_id AND contact_type=p_values->>'contact_type' AND is_primary; END IF;
 IF v_id IS NULL THEN
 INSERT INTO public.household_contacts(household_id,contact_type,contact_value) VALUES(p_household_id,p_values->>'contact_type',btrim(p_values->>'contact_value')) RETURNING id INTO v_id;
 END IF;
 UPDATE public.household_contacts SET guest_id=linked_guest,contact_name=nullif(btrim(p_values->>'contact_name'),''),contact_type=p_values->>'contact_type',contact_value=btrim(p_values->>'contact_value'),language_code=nullif(p_values->>'language_code',''),preferred_method=nullif(p_values->>'preferred_method',''),is_primary=coalesce((p_values->>'is_primary')::boolean,false),updated_at=now() WHERE id=v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_contact(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_contact(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Migration: 20261031230121_administrator_invitations.sql
BEGIN;
CREATE TABLE public.admin_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 invited_by uuid NOT NULL REFERENCES auth.users(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled')),
 delivery_state text NOT NULL DEFAULT 'sending' CHECK(delivery_state IN ('sending','sent','failed')),
 attempt_id uuid NOT NULL DEFAULT gen_random_uuid(), attempts integer NOT NULL DEFAULT 1,
 last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), sent_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
 accepted_by uuid REFERENCES auth.users(id), accepted_at timestamptz,
 last_error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254)
);
CREATE TABLE public.admin_invitation_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invitation_id uuid NOT NULL REFERENCES public.admin_invitations(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id), action text NOT NULL,
 email text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_invitation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_invitations,public.admin_invitation_audit FROM PUBLIC,anon,authenticated;
CREATE INDEX admin_invitation_audit_time ON public.admin_invitation_audit(created_at DESC,id DESC);
CREATE INDEX admin_invitation_audit_invitation ON public.admin_invitation_audit(invitation_id);
CREATE INDEX admin_invitation_audit_actor ON public.admin_invitation_audit(actor_user_id);
CREATE INDEX admin_invitations_inviter ON public.admin_invitations(invited_by);
CREATE INDEX admin_invitations_acceptor ON public.admin_invitations(accepted_by);
CREATE TRIGGER immutable_admin_invitation_audit BEFORE UPDATE OR DELETE ON public.admin_invitation_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

CREATE FUNCTION app_private.require_live_session() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=sid AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Sign in again to manage administrator invitations' USING ERRCODE='42501';END IF;
 RETURN auth.uid();
END $$;
REVOKE ALL ON FUNCTION app_private.require_live_session() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_list_invitations() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'name',name,'status',status,'delivery_state',delivery_state,'attempts',attempts,'sent_at',sent_at,'expires_at',expires_at,'last_error_code',last_error_code,'created_at',created_at) ORDER BY created_at DESC),'[]'::jsonb) FROM public.admin_invitations WHERE status='pending');
END $$;

CREATE FUNCTION public.admin_prepare_invitation(p_email text,p_name text,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; e text:=lower(btrim(coalesce(p_email,''))); n text:=btrim(coalesce(p_name,'')); i public.admin_invitations%ROWTYPE; existing_confirmed boolean;
BEGIN
 actor:=app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(e)>254 OR length(n) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a valid email and display name';END IF;
 -- Serialize reservations globally: enforce limits even for different emails.
 PERFORM pg_advisory_xact_lock(192837465);
 IF EXISTS(SELECT 1 FROM public.admins a JOIN auth.users u ON u.id=a.user_id WHERE lower(u.email)=e) THEN RAISE EXCEPTION 'This person is already an administrator';END IF;
 SELECT * INTO i FROM public.admin_invitations WHERE email=e FOR UPDATE;
 IF p_id IS NOT NULL AND (i.id IS NULL OR i.id<>p_id OR i.status<>'pending') THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 IF i.id IS NOT NULL AND i.status='pending' AND p_id IS NULL THEN RAISE EXCEPTION 'A pending invitation already exists. Use Resend or Cancel';END IF;
 IF i.id IS NOT NULL AND i.last_attempt_at>clock_timestamp()-interval '60 seconds' THEN RAISE EXCEPTION 'Wait one minute before sending again';END IF;
 IF i.status='pending' AND i.delivery_state='sending' AND i.last_attempt_at>clock_timestamp()-interval '2 minutes' THEN RAISE EXCEPTION 'An invitation email is already being sent';END IF;
 IF (SELECT count(*) FROM public.admin_invitation_audit WHERE action='email_requested' AND created_at>clock_timestamp()-interval '1 hour' AND actor_user_id=actor)>=10 OR (SELECT count(*) FROM public.admin_invitation_audit WHERE action='email_requested' AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'Invitation sending limit reached. Try again later';END IF;
 INSERT INTO public.admin_invitations(email,name,invited_by) VALUES(e,n,actor)
 ON CONFLICT(email) DO UPDATE SET name=n,invited_by=actor,status='pending',delivery_state='sending',attempt_id=gen_random_uuid(),attempts=public.admin_invitations.attempts+1,last_attempt_at=clock_timestamp(),expires_at=clock_timestamp()+interval '7 days',accepted_by=NULL,accepted_at=NULL,last_error_code=NULL,sent_at=NULL RETURNING * INTO i;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) VALUES(i.id,actor,'email_requested',e,jsonb_build_object('name',n,'attempt',i.attempts));
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=e AND email_confirmed_at IS NOT NULL) INTO existing_confirmed;
 RETURN jsonb_build_object('id',i.id,'email',e,'attempt_id',i.attempt_id,'existing_confirmed',existing_confirmed);
END $$;

-- Only the Edge Function may report the email service result. The attempt ID
-- prevents late callbacks from overwriting a newer send, cancellation or acceptance.
CREATE FUNCTION public.admin_finish_invitation(p_id uuid,p_attempt_id uuid,p_sent boolean,p_error_code text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.admin_invitations%ROWTYPE;
BEGIN
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR i.attempt_id<>p_attempt_id OR i.status<>'pending' OR i.delivery_state<>'sending' THEN RETURN false;END IF;
 UPDATE public.admin_invitations SET delivery_state=CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,sent_at=CASE WHEN p_sent THEN clock_timestamp() ELSE NULL END,last_error_code=CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error_code,'email_failed'),80) END WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) VALUES(i.id,i.invited_by,CASE WHEN p_sent THEN 'email_sent' ELSE 'email_failed' END,i.email,jsonb_build_object('error_code',CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error_code,'email_failed'),80) END));
 RETURN true;
END $$;

CREATE FUNCTION public.admin_cancel_invitation(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; i public.admin_invitations%ROWTYPE;
BEGIN
 actor:=app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'pending' THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 UPDATE public.admin_invitations SET status='cancelled' WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email) VALUES(i.id,actor,'invitation_cancelled',i.email);
END $$;

CREATE FUNCTION public.admin_my_invitation() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e text;
BEGIN
 PERFORM app_private.require_live_session();
 SELECT lower(email) INTO e FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 RETURN (SELECT jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'expires_at',i.expires_at,'needs_password',(SELECT coalesce(encrypted_password,'')='' FROM auth.users WHERE id=auth.uid())) FROM public.admin_invitations i WHERE i.email=e AND i.status='pending' AND i.delivery_state='sent' AND i.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by));
END $$;

CREATE FUNCTION public.admin_accept_invitation(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; e text; i public.admin_invitations%ROWTYPE;
BEGIN
 actor:=app_private.require_live_session();
 -- Serialize membership additions with the existing last-admin/revocation guard.
 PERFORM pg_advisory_xact_lock(42319,11);
 SELECT lower(email) INTO e FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL;
 SELECT * INTO i FROM public.admin_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e IS NULL OR i.email<>e OR i.status<>'pending' OR i.delivery_state<>'sent' OR i.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by) THEN RAISE EXCEPTION 'No active invitation for this verified account' USING ERRCODE='42501';END IF;
 INSERT INTO public.admins(user_id,name) VALUES(actor,i.name) ON CONFLICT(user_id) DO NOTHING;
 IF FOUND THEN INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(i.invited_by,actor,'add',jsonb_build_object('name',i.name,'source','accepted_invitation'));END IF;
 UPDATE public.admin_invitations SET status='accepted',accepted_by=actor,accepted_at=clock_timestamp() WHERE id=i.id;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email) VALUES(i.id,actor,'invitation_accepted',e);
END $$;

REVOKE ALL ON FUNCTION public.admin_list_invitations(),public.admin_prepare_invitation(text,text,uuid),public.admin_finish_invitation(uuid,uuid,boolean,text),public.admin_cancel_invitation(uuid),public.admin_my_invitation(),public.admin_accept_invitation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_invitations(),public.admin_prepare_invitation(text,text,uuid),public.admin_cancel_invitation(uuid),public.admin_my_invitation(),public.admin_accept_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finish_invitation(uuid,uuid,boolean,text) TO service_role;
CREATE OR REPLACE VIEW app_private.administration_log_entries AS
SELECT 'management:'||m.id::text event_key,m.created_at occurred_at,
 CASE m.entity_type WHEN 'households' THEN 'households' WHEN 'guests' THEN 'guests' WHEN 'household_contacts' THEN 'contacts' WHEN 'food_access' THEN 'food' WHEN 'session_invitations' THEN 'rsvp' ELSE 'households' END category,
 CASE WHEN m.entity_type='session_invitations' THEN 'invitations_changed' WHEN m.action='insert' THEN 'add' WHEN m.action='delete' THEN 'delete' WHEN m.action='update' AND m.before_value->>'archived_at' IS DISTINCT FROM m.after_value->>'archived_at' THEN CASE WHEN m.after_value->>'archived_at' IS NULL THEN 'restore' ELSE 'archive' END WHEN m.action IN ('update','permission_change') THEN 'update' ELSE m.action END action,
 m.household_id,m.actor_user_id,
 coalesce(nullif(concat_ws(' ',m.after_value->>'first_name',m.after_value->>'last_name'),''),m.after_value->>'contact_name',m.after_value->>'household_name',m.entity_type) subject,
 jsonb_build_object('entity',m.entity_type,'before',m.before_value,'after',m.after_value) details
FROM public.management_audit m
UNION ALL SELECT 'rsvp-household:'||r.id,r.created_at,'rsvp',r.action,r.household_id,r.actor_user_id,'Household RSVP',jsonb_build_object('reason',r.reason,'submission_id',r.submission_id) FROM public.rsvp_household_audit r
UNION ALL SELECT 'rsvp-response:'||r.id,r.created_at,'rsvp',CASE r.action WHEN 'submission' THEN 'response_submitted' ELSE 'response_corrected' END,r.household_id,r.actor_user_id,concat_ws(' ',g.first_name,g.last_name),jsonb_build_object('session',s.name,'before',r.previous_status,'after',r.new_status,'reason',r.reason) FROM public.rsvp_response_audit r LEFT JOIN public.guests g ON g.id=r.guest_id LEFT JOIN public.event_sessions s ON s.id=r.session_id
UNION ALL SELECT 'delivery:'||a.id,a.created_at,'invitations',CASE a.action WHEN 'confirmed_sent' THEN 'sent' ELSE a.action END,q.household_id,a.actor_user_id,'Invitation delivery',jsonb_build_object('channel',q.channel,'reason',a.reason,'before_status',a.previous_value->>'status','after_status',a.new_value->>'status') FROM public.invitation_delivery_audit a JOIN public.invitation_send_queue q ON q.id=a.queue_id
UNION ALL SELECT 'opened:'||a.id,a.created_at,'invitations','opened',a.household_id,NULL::uuid,'Invitation opened',jsonb_build_object('recording','Successful invitation load; repeated loads within 15 minutes are grouped') FROM public.invitation_access_audit a
UNION ALL SELECT 'configuration:'||a.id,a.created_at,CASE a.entity_type WHEN 'event_locations' THEN 'venues' ELSE 'sessions' END,CASE WHEN a.before_value IS NULL THEN 'add' WHEN a.before_value->>'archived_at' IS DISTINCT FROM a.after_value->>'archived_at' THEN CASE WHEN a.after_value->>'archived_at' IS NULL THEN 'restore' ELSE 'archive' END ELSE 'update' END,NULL::uuid,a.actor_user_id,coalesce(a.after_value->>'name',a.entity_type),jsonb_build_object('before',a.before_value,'after',a.after_value) FROM public.event_configuration_audit a
UNION ALL SELECT 'membership:'||a.id,a.created_at,'administrators',a.action,NULL::uuid,a.actor_id,coalesce(a.details->>'name','Administrator access'),jsonb_build_object('subject_id',a.subject_id,'details',a.details) FROM public.admin_membership_audit a
UNION ALL SELECT 'app-session:'||a.id,a.created_at,'login',a.action,NULL::uuid,a.actor_user_id,'Administrator session',jsonb_build_object('source','Verified app session') FROM public.admin_session_audit a
UNION ALL SELECT 'auth:'||a.id,a.created_at,'login',coalesce(a.payload->>'action','auth_event'),NULL::uuid,u.id,'Authentication',jsonb_build_object('source','Auth service','provider',a.payload->>'provider') FROM auth.audit_log_entries a LEFT JOIN auth.users u ON u.id::text=a.payload->>'actor_id' WHERE a.created_at IS NOT NULL
UNION ALL SELECT 'admin-invitation:'||a.id,a.created_at,'administrators',a.action,NULL::uuid,a.actor_user_id,a.email,a.details FROM public.admin_invitation_audit a;

COMMIT;

-- Migration: 20261101105008_language_management.sql
BEGIN;
ALTER TABLE public.event_languages ADD CONSTRAINT event_language_code_format CHECK(language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
ALTER TABLE public.event_settings ADD COLUMN fallback_language text NOT NULL DEFAULT 'en' REFERENCES public.event_languages(language_code);
ALTER TABLE public.households DROP CONSTRAINT IF EXISTS households_language_check;
ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_language_check;
ALTER TABLE public.households ADD CONSTRAINT households_language_fk FOREIGN KEY(language) REFERENCES public.event_languages(language_code);
ALTER TABLE public.guests ADD CONSTRAINT guests_language_fk FOREIGN KEY(language) REFERENCES public.event_languages(language_code);
CREATE INDEX households_language ON public.households(language);
CREATE INDEX guests_language ON public.guests(language);

CREATE FUNCTION app_private.guard_language_preferences() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.event_languages WHERE language_code IN(NEW.default_language,NEW.fallback_language) ORDER BY language_code FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=NEW.default_language AND enabled)
 OR NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=NEW.fallback_language AND enabled) THEN
 RAISE EXCEPTION 'Default and fallback languages must be enabled';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_language_preferences() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER language_preferences_guard BEFORE INSERT OR UPDATE OF default_language,fallback_language ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_language_preferences();
CREATE FUNCTION app_private.guard_language_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Disable languages instead of deleting their translations';END IF;
 IF NEW.language_code IS DISTINCT FROM OLD.language_code THEN RAISE EXCEPTION 'Language codes cannot be renamed';END IF;
 IF NOT NEW.enabled AND EXISTS(SELECT 1 FROM public.event_settings WHERE default_language=OLD.language_code OR fallback_language=OLD.language_code) THEN RAISE EXCEPTION 'Choose another default and fallback before disabling this language';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_language_removal() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER language_removal_guard BEFORE UPDATE OR DELETE ON public.event_languages FOR EACH ROW EXECUTE FUNCTION app_private.guard_language_removal();
CREATE FUNCTION app_private.guard_profile_language() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE code text;old_code text;
BEGIN
 code:=to_jsonb(NEW)->>TG_ARGV[0];IF TG_OP='UPDATE' THEN old_code:=to_jsonb(OLD)->>TG_ARGV[0];END IF;
 IF code IS NOT NULL AND code IS DISTINCT FROM old_code THEN PERFORM 1 FROM public.event_languages WHERE language_code=code FOR SHARE;END IF;
 IF code IS NOT NULL AND code IS DISTINCT FROM old_code AND NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=code AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_profile_language() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER household_language_guard BEFORE INSERT OR UPDATE OF language ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language');
CREATE TRIGGER guest_language_guard BEFORE INSERT OR UPDATE OF language ON public.guests FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language');
CREATE TRIGGER contact_language_guard BEFORE INSERT OR UPDATE OF language_code ON public.household_contacts FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_language('language_code');

CREATE FUNCTION public.admin_save_language(p_code text,p_name text,p_enabled boolean,p_order integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_code IS NULL OR p_code !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' OR length(p_code)>16 OR nullif(btrim(p_name),'') IS NULL OR length(p_name)>80 OR p_enabled IS NULL OR p_order IS NULL THEN RAISE EXCEPTION 'Enter a language code, name, enabled state and order';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 INSERT INTO public.event_languages(language_code,display_name,enabled,sort_order) VALUES(p_code,btrim(p_name),p_enabled,p_order)
 ON CONFLICT(language_code) DO UPDATE SET display_name=excluded.display_name,enabled=excluded.enabled,sort_order=excluded.sort_order;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_language(text,text,boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_language(text,text,boolean,integer) TO authenticated;

CREATE FUNCTION public.get_language_configuration() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('languages',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY sort_order,language_code),'[]') FROM public.event_languages l WHERE enabled),
 'default_language',e.default_language,'fallback_language',e.fallback_language,
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.event_content c JOIN public.event_languages l USING(language_code) WHERE l.enabled AND c.content_key LIKE 'ui:%'))
 FROM public.event_settings e WHERE e.id=1
$$;
REVOKE ALL ON FUNCTION public.get_language_configuration() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_language_configuration() TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_public_event_v2() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('event',to_jsonb(e),
 'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order),'[]') FROM public.event_sessions s WHERE s.is_active),
 'locations',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order),'[]') FROM public.event_locations l WHERE l.archived_at IS NULL),
 'content',(SELECT coalesce(jsonb_object_agg(c.language_code,c.content_value),'{}') FROM public.event_content c WHERE c.content_key='welcome'),
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM public.event_content c WHERE c.content_key NOT LIKE 'ui:%'))
 FROM public.event_settings e WHERE e.id=1 AND e.is_published
$$;
REVOKE ALL ON FUNCTION public.get_public_event_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_event_v2() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_guest(
  p_guest_id uuid,
  p_first_name text,
  p_last_name text,
  p_courtesy_title text,
  p_relation text,
  p_language text,
  p_is_child boolean,
  p_dietary_requirements text,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_first text := NULLIF(pg_catalog.btrim(p_first_name), '');
  v_last text := NULLIF(pg_catalog.btrim(p_last_name), '');
  v_title text := NULLIF(pg_catalog.btrim(p_courtesy_title), '');
  v_relation text := NULLIF(pg_catalog.btrim(p_relation), '');
  v_dietary text := NULLIF(pg_catalog.btrim(p_dietary_requirements), '');
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_guest_id IS NULL OR v_first IS NULL OR pg_catalog.char_length(v_first)>120 THEN
    RAISE EXCEPTION 'A first name of at most 120 characters is required';
  END IF;
  IF pg_catalog.char_length(COALESCE(v_last,''))>120 OR
     pg_catalog.char_length(COALESCE(v_relation,''))>160 OR
     pg_catalog.char_length(COALESCE(v_dietary,''))>1000 OR
     pg_catalog.char_length(COALESCE(v_notes,''))>2000 THEN
    RAISE EXCEPTION 'Guest field exceeds maximum length';
  END IF;
  IF v_title IS NOT NULL AND v_title NOT IN ('Mr.','Ms.','Son','Daughter') THEN
    RAISE EXCEPTION 'Invalid courtesy title';
  END IF;
  IF p_language IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language) THEN
    RAISE EXCEPTION 'Invalid guest language';
  END IF;
  IF p_is_child IS NULL THEN
    RAISE EXCEPTION 'Guest child flag is required';
  END IF;

  UPDATE public.guests
  SET first_name=v_first, last_name=v_last,
      courtesy_title=v_title, relation=v_relation,
      language=p_language, is_child=p_is_child,
      dietary_requirements=v_dietary, notes=v_notes,
      updated_at=pg_catalog.now()
  WHERE id=p_guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest not found';
  END IF;
END
$function$;

CREATE FUNCTION public.admin_set_language_preferences(p_default text,p_fallback text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 UPDATE public.event_settings SET default_language=p_default,fallback_language=p_fallback,updated_at=now() WHERE id=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event settings not found';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_language_preferences(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_language_preferences(text,text) TO authenticated;
CREATE FUNCTION public.admin_save_translation(p_key text,p_language text,p_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source_tokens text[];value_tokens text[];parts text[];target uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_key IS NULL OR length(p_key)>800 OR p_key !~ '^(welcome|ui:.+|venue:[0-9a-f-]{36}:welcome|food:[0-9a-f-]{36}:(name|description)|session:[0-9a-f-]{36}:name)$' OR p_value IS NULL OR length(p_value)>12000 THEN RAISE EXCEPTION 'Invalid translation key or text';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language';END IF;
 IF p_key LIKE 'ui:%' THEN
  SELECT array_agg(m[1] ORDER BY m[1]) INTO source_tokens FROM regexp_matches(substr(p_key,4),'\{([A-Za-z][A-Za-z0-9_]*)\}','g') m;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO value_tokens FROM regexp_matches(p_value,'\{([A-Za-z][A-Za-z0-9_]*)\}','g') m;
  IF btrim(p_value)<>'' AND source_tokens IS DISTINCT FROM value_tokens THEN RAISE EXCEPTION 'Keep the same placeholders as the original phrase';END IF;
 END IF;
 parts:=string_to_array(p_key,':');
 IF parts[1] IN ('venue','food','session') THEN
  target:=parts[2]::uuid;
  IF parts[1]='venue' AND NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=target) OR parts[1]='food' AND NOT EXISTS(SELECT 1 FROM public.food_items WHERE id=target) OR parts[1]='session' AND NOT EXISTS(SELECT 1 FROM public.event_sessions WHERE id=target) THEN RAISE EXCEPTION 'Translation target not found';END IF;
 END IF;
 IF parts[1] IN ('venue','food') AND p_language IN ('fo','en','de') THEN
  target:=parts[2]::uuid;
  IF parts[1]='venue' THEN
   EXECUTE format('UPDATE public.event_locations SET %I=$1 WHERE id=$2','welcome_'||p_language) USING nullif(btrim(p_value),''),target;
  ELSE
   IF parts[3]='name' AND p_language='fo' AND btrim(p_value)='' THEN RAISE EXCEPTION 'Faroese name is required';END IF;
   EXECUTE format('UPDATE public.food_items SET %I=$1 WHERE id=$2',parts[3]||'_'||p_language) USING nullif(btrim(p_value),''),target;
  END IF;
  DELETE FROM public.event_content WHERE content_key=p_key AND language_code=p_language;RETURN;
 END IF;
 IF btrim(p_value)='' THEN DELETE FROM public.event_content WHERE content_key=p_key AND language_code=p_language;
 ELSE INSERT INTO public.event_content(content_key,language_code,content_value) VALUES(p_key,p_language,p_value) ON CONFLICT(content_key,language_code) DO UPDATE SET content_value=excluded.content_value;END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_translation(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_translation(text,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Migration: 20261101105111_application_backup_restore.sql
BEGIN;
CREATE TABLE public.backup_restore_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid NOT NULL REFERENCES auth.users(id),checksum text NOT NULL,source_created_at timestamptz,restored_counts jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.backup_restore_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_restore_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.backup_restore_audit TO authenticated;
CREATE INDEX backup_restore_actor ON public.backup_restore_audit(actor_user_id);
CREATE POLICY admin_read ON public.backup_restore_audit FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE TRIGGER immutable_backup_restore_audit BEFORE UPDATE OR DELETE ON public.backup_restore_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
-- Fixed allowlist: no schema, table or SQL identifiers are accepted from backup files.
CREATE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_items',
 'public.food_claims','public.stuff_to_bring','public.things_to_do','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.backup_columns(t text) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'required',attnotnull,'identity',attidentity) ORDER BY attnum)
 FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped
$$;
REVOKE ALL ON FUNCTION app_private.backup_columns(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.backup_payload() RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE tables jsonb:='{}';columns jsonb:='{}';counts jsonb:='{}';t text;rows jsonb;identities jsonb;ids text[]:=ARRAY[]::text[];fk record;one jsonb;
BEGIN
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  -- Convert bigint values to strings so JavaScript cannot round audit/identity IDs.
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM %s r',t) INTO rows;
  DECLARE a record;i integer;BEGIN
   FOR a IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND atttypid='bigint'::regtype AND attnum>0 AND NOT attisdropped LOOP
    FOR i IN 0..jsonb_array_length(rows)-1 LOOP
     IF rows->i->a.attname IS NOT NULL AND rows->i->a.attname<>'null'::jsonb THEN rows:=jsonb_set(rows,ARRAY[i::text,a.attname],to_jsonb(rows->i->>a.attname));END IF;
    END LOOP;
   END LOOP;
  END;
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR one IN SELECT value FROM jsonb_array_elements(rows) LOOP IF one->>fk.attname IS NOT NULL THEN ids:=array_append(ids,one->>fk.attname);END IF;END LOOP;
  END LOOP;
  tables:=tables||jsonb_build_object(t,rows);columns:=columns||jsonb_build_object(t,app_private.backup_columns(t));counts:=counts||jsonb_build_object(t,jsonb_array_length(rows));
 END LOOP;
 -- Only identity metadata, never passwords, tokens, Auth identities or sessions.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email)),'[]') INTO identities FROM auth.users WHERE id::text=ANY(ids) OR id IN(SELECT user_id FROM public.admins);
 RETURN jsonb_build_object('schema_version','20261101105111','created_at',clock_timestamp(),'tables',tables,'columns',columns,'counts',counts,'identities',identities,
 'sign_in_log_reference',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('id',a.id::text)),'[]') FROM public.admin_session_audit a),
 'administrator_reference',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.admins a));
END $$;
REVOKE ALL ON FUNCTION app_private.backup_payload() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.admin_export_backup() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 payload:=app_private.backup_payload();
 IF octet_length(payload::text)>20000000 THEN RAISE EXCEPTION 'Application backup exceeds the 20 MB import limit; use managed database backup tools';END IF;
 RETURN jsonb_build_object('format','rsvp-application-backup','version',1,'payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.admin_export_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_export_backup() TO authenticated;

CREATE FUNCTION app_private.validate_backup(b jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE t text;row jsonb;k text;cols text[];payload jsonb:=b->'payload';n bigint:=0;
BEGIN
 IF b->>'format' IS DISTINCT FROM 'rsvp-application-backup' OR b->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Unsupported backup format or version';END IF;
 IF payload->>'schema_version' IS DISTINCT FROM '20261101105111' THEN RAISE EXCEPTION 'Unsupported backup schema version';END IF;
 IF octet_length(b::text)>20971520 THEN RAISE EXCEPTION 'Backup exceeds 20 MB';END IF;
 IF b->>'checksum' IS DISTINCT FROM encode(sha256(convert_to(payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Backup checksum mismatch';END IF;
 IF jsonb_typeof(payload->'tables') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'columns') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'counts') IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'identities') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete backup manifest';END IF;
 IF (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(payload->'tables') x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(app_private.backup_tables()) x) THEN RAISE EXCEPTION 'Backup table set does not match this application';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF payload->'columns'->t IS DISTINCT FROM app_private.backup_columns(t) THEN RAISE EXCEPTION 'Schema mismatch for %. Install matching application migrations first',t;END IF;
  IF jsonb_typeof(payload->'tables'->t) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid table data: %',t;END IF;
  IF payload->'counts'->>t IS DISTINCT FROM jsonb_array_length(payload->'tables'->t)::text THEN RAISE EXCEPTION 'Row count mismatch: %',t;END IF;
  SELECT array_agg(attname::text) INTO cols FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(row))<>cardinality(cols) THEN RAISE EXCEPTION 'Missing fields in %',t;END IF;
   FOR k IN SELECT jsonb_object_keys(row) LOOP IF NOT k=ANY(cols) THEN RAISE EXCEPTION 'Unknown field in %',t;END IF;END LOOP;
  END LOOP;
  n:=n+jsonb_array_length(payload->'tables'->t);
 END LOOP;
 IF jsonb_array_length(payload->'tables'->'public.event_settings')<>1 THEN RAISE EXCEPTION 'Exactly one event settings record is required';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'identities') u WHERE nullif(u->>'id','') IS NULL OR nullif(u->>'email','') IS NULL)
 OR (SELECT count(*) FROM jsonb_array_elements(payload->'identities'))<>(SELECT count(DISTINCT u->>'id') FROM jsonb_array_elements(payload->'identities') u) THEN RAISE EXCEPTION 'Invalid identity manifest';END IF;
 RETURN jsonb_build_object('rows',n,'counts',payload->'counts','event_name',payload->'tables'->'public.event_settings'->0->>'event_name','created_at',payload->>'created_at');
END $$;
REVOKE ALL ON FUNCTION app_private.validate_backup(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.restore_backup(b jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t text;row jsonb;rows jsonb;payload jsonb:=b->'payload';report jsonb;has_rows boolean;cols text;fk record;source_id text;target_id uuid;identity jsonb;mapping jsonb:='{}';rec record;seq text;next_id bigint;changed integer:=0;
BEGIN
 report:=app_private.validate_backup(b);
 -- Consistent lock order, shared with existing management operations. Keep the event closed.
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',t);END LOOP;
 IF EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) THEN RAISE EXCEPTION 'Restore destination must be unpublished';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF t IN ('public.event_languages','public.event_settings') THEN CONTINUE;END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',t) INTO has_rows;
  IF has_rows THEN RAISE EXCEPTION 'Restore requires an empty application destination; % contains records',t;END IF;
 END LOOP;
 -- Map foreign-key actors by the original verified email, never by user-supplied privileges.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
    source_id:=row->>fk.attname;IF source_id IS NULL OR mapping ? source_id THEN CONTINUE;END IF;
    SELECT u INTO identity FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=source_id;
    IF identity IS NULL THEN RAISE EXCEPTION 'Missing actor identity metadata';END IF;
    SELECT id INTO target_id FROM auth.users WHERE lower(email)=lower(identity->>'email') AND email_confirmed_at IS NOT NULL;
    IF target_id IS NULL THEN RAISE EXCEPTION 'Recreate and verify the historical actor account % before restoring',identity->>'email';END IF;
    mapping:=mapping||jsonb_build_object(source_id,target_id);
   END LOOP;
  END LOOP;
 END LOOP;
 -- Disable only application triggers, transactionally, so imports do not regenerate
 -- invitation codes, create synthetic history, or reject valid out-of-order parents.
 -- Foreign keys, types, unique constraints and CHECK constraints stay enforced.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER',t);END LOOP;
 DELETE FROM public.event_settings;DELETE FROM public.event_languages;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  rows:='[]';
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
    source_id:=row->>fk.attname;IF source_id IS NOT NULL THEN row:=jsonb_set(row,ARRAY[fk.attname],mapping->source_id);END IF;
   END LOOP;
   IF t='public.admin_membership_audit' THEN FOREACH source_id IN ARRAY ARRAY['actor_id','subject_id'] LOOP IF mapping ? (row->>source_id) THEN row:=jsonb_set(row,ARRAY[source_id],mapping->(row->>source_id));END IF;END LOOP;END IF;
   IF t='public.households' THEN row:=row||'{"parent_id":null,"latest_rsvp_submission_id":null}'::jsonb;END IF;
   IF t='public.event_settings' THEN row:=row||'{"is_published":false}'::jsonb;END IF;
   IF t='public.admin_invitations' AND row->>'status'='pending' THEN row:=row||jsonb_build_object('status','cancelled','expires_at',clock_timestamp(),'attempt_id',gen_random_uuid());END IF;
   rows:=rows||jsonb_build_array(row);
  END LOOP;
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::%s,$1)',t,cols,cols,t) USING rows;
 END LOOP;
 -- Resolve circular household/submission references once every row exists.
 FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->'public.households') LOOP
  UPDATE public.households SET parent_id=(row->>'parent_id')::uuid,latest_rsvp_submission_id=(row->>'latest_rsvp_submission_id')::uuid WHERE id=(row->>'id')::uuid;
 END LOOP;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER',t);END LOOP;
 -- Re-run hierarchy and language guards without changing profile values or history.
 UPDATE public.households SET parent_id=parent_id;
 UPDATE public.event_settings SET default_language=default_language,fallback_language=fallback_language;
 IF EXISTS(SELECT 1 FROM public.households h WHERE (h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)) AND h.invite_code IS NOT NULL) THEN RAISE EXCEPTION 'Backup contains an invalid invitation code assignment';END IF;
 IF EXISTS(SELECT 1 FROM public.households h WHERE h.invite_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_private.invitation_code_registry r WHERE r.code=h.invite_code AND r.household_id=h.id)) THEN RAISE EXCEPTION 'Invitation code registry mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE (SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=f.id)>f.quantity_needed) THEN RAISE EXCEPTION 'Food claims exceed available quantities';END IF;
 -- Restart identity sequences with transactional ALTER, not nontransactional setval.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR rec IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND attidentity<>'' LOOP
   seq:=pg_get_serial_sequence(t,rec.attname);EXECUTE format('SELECT coalesce(max(%I),0)+1 FROM %s',rec.attname,t) INTO next_id;
   EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
  END LOOP;
 END LOOP;
 INSERT INTO public.backup_restore_audit(actor_user_id,checksum,source_created_at,restored_counts) VALUES(auth.uid(),b->>'checksum',(payload->>'created_at')::timestamptz,payload->'counts');
 RETURN report||jsonb_build_object('restored',true,'is_published',false,'identity_mapping',mapping,'administrator_access_restored',false);
END $$;
REVOKE ALL ON FUNCTION app_private.restore_backup(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.admin_preview_backup(p_backup jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE report jsonb;result jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 report:=app_private.validate_backup(p_backup);
 -- Exercise the actual restore inside a rolled-back subtransaction, including all
 -- constraints and identity checks. No imported data, trigger changes or sequence
 -- restarts survive preview, regardless of success or failure.
 BEGIN
  result:=app_private.restore_backup(p_backup);
  RAISE EXCEPTION USING ERRCODE='P0199',MESSAGE='restore_preview_rollback';
 EXCEPTION WHEN SQLSTATE 'P0199' THEN RETURN report||jsonb_build_object('can_restore',true);
 WHEN OTHERS THEN RETURN report||jsonb_build_object('can_restore',false,'reason',SQLERRM);
 END;
END $$;
REVOKE ALL ON FUNCTION public.admin_preview_backup(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_backup(jsonb) TO authenticated;
CREATE FUNCTION public.admin_restore_backup(p_backup jsonb,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_confirmation IS DISTINCT FROM 'RESTORE '||coalesce(p_backup->'payload'->'tables'->'public.event_settings'->0->>'event_name','') THEN RAISE EXCEPTION 'Type RESTORE followed by the source event name';END IF;
 result:=app_private.restore_backup(p_backup);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_restore_backup(jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_backup(jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261101113552_backup_language_prerequisite.sql
BEGIN;
-- Keep exports usable if backend migrations are approved in separate steps.
CREATE OR REPLACE FUNCTION public.admin_export_backup() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='event_settings' AND column_name='fallback_language') THEN RAISE EXCEPTION 'Apply the language management migration before exporting a version 1 backup';END IF;
 payload:=app_private.backup_payload();
 IF octet_length(payload::text)>20000000 THEN RAISE EXCEPTION 'Application backup exceeds the 20 MB import limit; use managed database backup tools';END IF;
 RETURN jsonb_build_object('format','rsvp-application-backup','version',1,'payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.admin_export_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_export_backup() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261101114104_restore_hierarchy_validation.sql
BEGIN;
CREATE OR REPLACE FUNCTION app_private.restore_backup(b jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t text;row jsonb;rows jsonb;payload jsonb:=b->'payload';report jsonb;has_rows boolean;cols text;fk record;source_id text;target_id uuid;identity jsonb;mapping jsonb:='{}';rec record;seq text;next_id bigint;changed integer:=0;
BEGIN
 report:=app_private.validate_backup(b);
 -- Validate reachability before loading rows with application triggers suspended.
 -- UNION deduplicates IDs: malformed cycles (including a branch pointing into a
 -- cycle) cannot make the older recursive parent trigger loop indefinitely.
 WITH RECURSIVE h AS (SELECT id,parent_id FROM jsonb_populate_recordset(NULL::public.households,payload->'tables'->'public.households')),
 reachable(id) AS (SELECT id FROM h WHERE parent_id IS NULL UNION SELECT h.id FROM h JOIN reachable p ON h.parent_id=p.id)
 SELECT (SELECT count(*) FROM h)<>(SELECT count(*) FROM reachable) INTO has_rows;
 IF has_rows THEN RAISE EXCEPTION 'Household hierarchy cycle, duplicate ID or missing parent';END IF;

 -- Consistent lock order, shared with existing management operations. Keep the event closed.
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',t);END LOOP;
 IF EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) THEN RAISE EXCEPTION 'Restore destination must be unpublished';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF t IN ('public.event_languages','public.event_settings') THEN CONTINUE;END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',t) INTO has_rows;
  IF has_rows THEN RAISE EXCEPTION 'Restore requires an empty application destination; % contains records',t;END IF;
 END LOOP;
 -- Map foreign-key actors by the original verified email, never by user-supplied privileges.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
    source_id:=row->>fk.attname;IF source_id IS NULL OR mapping ? source_id THEN CONTINUE;END IF;
    SELECT u INTO identity FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=source_id;
    IF identity IS NULL THEN RAISE EXCEPTION 'Missing actor identity metadata';END IF;
    SELECT id INTO target_id FROM auth.users WHERE lower(email)=lower(identity->>'email') AND email_confirmed_at IS NOT NULL;
    IF target_id IS NULL THEN RAISE EXCEPTION 'Recreate and verify the historical actor account % before restoring',identity->>'email';END IF;
    mapping:=mapping||jsonb_build_object(source_id,target_id);
   END LOOP;
  END LOOP;
 END LOOP;
 -- Disable only application triggers, transactionally, so imports do not regenerate
 -- invitation codes, create synthetic history, or reject valid out-of-order parents.
 -- Foreign keys, types, unique constraints and CHECK constraints stay enforced.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER',t);END LOOP;
 DELETE FROM public.event_settings;DELETE FROM public.event_languages;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  rows:='[]';
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
    source_id:=row->>fk.attname;IF source_id IS NOT NULL THEN row:=jsonb_set(row,ARRAY[fk.attname],mapping->source_id);END IF;
   END LOOP;
   IF t='public.admin_membership_audit' THEN FOREACH source_id IN ARRAY ARRAY['actor_id','subject_id'] LOOP IF mapping ? (row->>source_id) THEN row:=jsonb_set(row,ARRAY[source_id],mapping->(row->>source_id));END IF;END LOOP;END IF;
   IF t='public.households' THEN row:=row||'{"parent_id":null,"latest_rsvp_submission_id":null}'::jsonb;END IF;
   IF t='public.event_settings' THEN row:=row||'{"is_published":false}'::jsonb;END IF;
   IF t='public.admin_invitations' AND row->>'status'='pending' THEN row:=row||jsonb_build_object('status','cancelled','expires_at',clock_timestamp(),'attempt_id',gen_random_uuid());END IF;
   rows:=rows||jsonb_build_array(row);
  END LOOP;
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::%s,$1)',t,cols,cols,t) USING rows;
 END LOOP;
 -- Resolve circular household/submission references once every row exists.
 FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->'public.households') LOOP
  UPDATE public.households SET parent_id=(row->>'parent_id')::uuid,latest_rsvp_submission_id=(row->>'latest_rsvp_submission_id')::uuid WHERE id=(row->>'id')::uuid;
 END LOOP;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER',t);END LOOP;
 -- Re-run hierarchy and language guards without changing profile values or history.
 UPDATE public.households SET parent_id=parent_id;
 UPDATE public.event_settings SET default_language=default_language,fallback_language=fallback_language;
 IF EXISTS(SELECT 1 FROM public.households h WHERE (h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)) AND h.invite_code IS NOT NULL) THEN RAISE EXCEPTION 'Backup contains an invalid invitation code assignment';END IF;
 IF EXISTS(SELECT 1 FROM public.households h WHERE h.invite_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_private.invitation_code_registry r WHERE r.code=h.invite_code AND r.household_id=h.id)) THEN RAISE EXCEPTION 'Invitation code registry mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE (SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=f.id)>f.quantity_needed) THEN RAISE EXCEPTION 'Food claims exceed available quantities';END IF;
 -- Restart identity sequences with transactional ALTER, not nontransactional setval.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR rec IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND attidentity<>'' LOOP
   seq:=pg_get_serial_sequence(t,rec.attname);EXECUTE format('SELECT coalesce(max(%I),0)+1 FROM %s',rec.attname,t) INTO next_id;
   EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
  END LOOP;
 END LOOP;
 INSERT INTO public.backup_restore_audit(actor_user_id,checksum,source_created_at,restored_counts) VALUES(auth.uid(),b->>'checksum',(payload->>'created_at')::timestamptz,payload->'counts');
 RETURN report||jsonb_build_object('restored',true,'is_published',false,'identity_mapping',mapping,'administrator_access_restored',false);
END $$;
REVOKE ALL ON FUNCTION app_private.restore_backup(jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261102101500_compact_food_comments.sql
-- Add private administrator comments and omit fully claimed options from other households.
BEGIN;
ALTER TABLE public.food_items ADD COLUMN admin_comment text CHECK (length(admin_comment)<=4000);
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;
CREATE FUNCTION app_private.guard_food_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.quantity_needed<(SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=NEW.id) THEN RAISE EXCEPTION 'Amount cannot be less than existing claims';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_food_capacity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER food_capacity_guard BEFORE UPDATE OF quantity_needed ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_food_capacity();
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261102103000_administrator_task_sheet.sql
-- Atomic spreadsheet-style task edits. Existing due dates and notes are retained.
BEGIN;
CREATE FUNCTION public.admin_save_tasks(p_rows jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;old public.things_to_do%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'Enter at most 1000 task rows';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL)<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL) THEN RAISE EXCEPTION 'Duplicate task rows';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'id' LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR nullif(btrim(r->>'task'),'') IS NULL OR length(r->>'task')>1000 OR length(coalesce(r->>'assigned_to',''))>300 OR r->>'status' IS NULL OR r->>'status' NOT IN ('open','in_progress','done') OR (r->>'sort_order')::integer<0 THEN RAISE EXCEPTION 'Enter valid task, assignee and status';END IF;
  IF nullif(r->>'id','') IS NULL THEN
   INSERT INTO public.things_to_do(task,assigned_to,status,sort_order) VALUES(btrim(r->>'task'),nullif(btrim(r->>'assigned_to'),''),r->>'status',(r->>'sort_order')::integer);
  ELSE
   SELECT * INTO old FROM public.things_to_do WHERE id=(r->>'id')::uuid FOR UPDATE;
   IF NOT FOUND OR old.updated_at IS DISTINCT FROM (r->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'Task changed; reload before saving';END IF;
   UPDATE public.things_to_do SET task=btrim(r->>'task'),assigned_to=nullif(btrim(r->>'assigned_to'),''),status=r->>'status',sort_order=(r->>'sort_order')::integer,updated_at=clock_timestamp() WHERE id=old.id;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_tasks(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_tasks(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261102190000_task_comments.sql
-- Atomic spreadsheet-style task edits. Existing due dates and notes are retained.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_save_tasks(p_rows jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;old public.things_to_do%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'Enter at most 1000 task rows';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL)<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL) THEN RAISE EXCEPTION 'Duplicate task rows';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'id' LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR nullif(btrim(r->>'task'),'') IS NULL OR length(r->>'task')>1000 OR length(coalesce(r->>'assigned_to',''))>300 OR length(coalesce(r->>'notes',''))>4000 OR r->>'status' IS NULL OR r->>'status' NOT IN ('open','in_progress','done') OR (r->>'sort_order')::integer<0 THEN RAISE EXCEPTION 'Enter valid task, assignee and status';END IF;
  IF nullif(r->>'id','') IS NULL THEN
   INSERT INTO public.things_to_do(task,notes,assigned_to,status,sort_order) VALUES(btrim(r->>'task'),nullif(btrim(r->>'notes'),''),nullif(btrim(r->>'assigned_to'),''),r->>'status',(r->>'sort_order')::integer);
  ELSE
   SELECT * INTO old FROM public.things_to_do WHERE id=(r->>'id')::uuid FOR UPDATE;
   IF NOT FOUND OR old.updated_at IS DISTINCT FROM (r->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'Task changed; reload before saving';END IF;
   UPDATE public.things_to_do SET task=btrim(r->>'task'),notes=CASE WHEN r?'notes' THEN nullif(btrim(r->>'notes'),'') ELSE notes END,assigned_to=nullif(btrim(r->>'assigned_to'),''),status=r->>'status',sort_order=(r->>'sort_order')::integer,updated_at=clock_timestamp() WHERE id=old.id;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_tasks(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_tasks(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261102191000_food_recipes.sql
-- Recipes group existing or newly created food items; claims stay on the original item IDs.
BEGIN;
CREATE TABLE public.food_recipes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 300),
 category text NOT NULL REFERENCES public.food_categories(name) ON UPDATE CASCADE,
 sort_order integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(id,category)
);
CREATE INDEX food_recipes_category ON public.food_recipes(category);
ALTER TABLE public.food_recipes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_recipes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.food_recipes TO authenticated;
CREATE POLICY admin_read ON public.food_recipes FOR SELECT TO authenticated USING((SELECT public.is_admin()));
ALTER TABLE public.food_items ADD COLUMN recipe_id uuid;
ALTER TABLE public.food_items ADD CONSTRAINT food_recipe_category FOREIGN KEY(recipe_id,category) REFERENCES public.food_recipes(id,category) ON UPDATE CASCADE;
ALTER TABLE public.food_items ADD CONSTRAINT recipe_requires_category CHECK(recipe_id IS NULL OR category IS NOT NULL);
CREATE INDEX food_items_recipe ON public.food_items(recipe_id,category);
CREATE FUNCTION public.admin_save_recipe(p_id uuid,p_name text,p_category text,p_items uuid[],p_new_items jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;old public.food_recipes%ROWTYPE;r jsonb;n integer;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>300 OR p_items IS NULL OR cardinality(p_items)>500 OR jsonb_typeof(p_new_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_new_items)>100 OR cardinality(p_items)+jsonb_array_length(p_new_items)=0 THEN RAISE EXCEPTION 'Enter a recipe name and at least one food item';END IF;
 IF (SELECT count(*) FROM unnest(p_items) id)<>(SELECT count(DISTINCT id) FROM unnest(p_items) id) THEN RAISE EXCEPTION 'Duplicate food items';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.food_categories WHERE name=p_category) THEN RAISE EXCEPTION 'Choose a food category';END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO old FROM public.food_recipes WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR old.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Recipe changed; reload before saving';END IF;
 END IF;
 PERFORM 1 FROM public.food_items WHERE recipe_id=p_id OR id=ANY(p_items) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.food_items WHERE id=ANY(p_items))<>cardinality(p_items) THEN RAISE EXCEPTION 'Food item not found';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items WHERE id=ANY(p_items) AND recipe_id IS NOT NULL AND recipe_id IS DISTINCT FROM p_id) THEN RAISE EXCEPTION 'Food item already belongs to another recipe';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_new_items) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR nullif(btrim(r->>'name'),'') IS NULL OR length(r->>'name')>300 OR (r->>'quantity') IS NULL OR (r->>'quantity')::integer<0 OR length(coalesce(r->>'user_comment',''))>4000 OR length(coalesce(r->>'admin_comment',''))>4000 THEN RAISE EXCEPTION 'Enter a valid new food item';END IF;
 END LOOP;
 IF p_id IS NULL THEN INSERT INTO public.food_recipes(name,category,sort_order) VALUES(btrim(p_name),p_category,(SELECT coalesce(max(sort_order),0)+1 FROM public.food_recipes WHERE category=p_category)) RETURNING id INTO v_id;
 ELSE UPDATE public.food_recipes SET name=btrim(p_name),category=p_category,updated_at=clock_timestamp() WHERE id=p_id;END IF;
 UPDATE public.food_items SET recipe_id=NULL WHERE recipe_id=v_id AND NOT(id=ANY(p_items));
 UPDATE public.food_items SET recipe_id=v_id,category=p_category WHERE id=ANY(p_items);
 SELECT coalesce(max(sort_order),0) INTO n FROM public.food_items WHERE category=p_category;
 FOR r IN SELECT value FROM jsonb_array_elements(p_new_items) LOOP
  n:=n+1;
  INSERT INTO public.food_items(category,recipe_id,name_fo,name_en,quantity_needed,description_en,admin_comment,sort_order) VALUES(p_category,v_id,btrim(r->>'name'),btrim(r->>'name'),(r->>'quantity')::integer,nullif(btrim(r->>'user_comment'),''),nullif(btrim(r->>'admin_comment'),''),n);
 END LOOP;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_recipe(uuid,text,text,uuid[],jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_recipe(uuid,text,text,uuid[],jsonb,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_recipes','public.food_items',
 'public.food_claims','public.stuff_to_bring','public.things_to_do','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_id',f.recipe_id,'recipe_name',fr.name,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_recipes fr ON fr.id=f.recipe_id LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261102203000_unified_other.sql
-- Canonical Other list. Preserve old read APIs during frontend rollout.
BEGIN;
LOCK TABLE public.things_to_do,public.stuff_to_bring IN ACCESS EXCLUSIVE MODE;
CREATE TABLE public.other_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE CHECK(length(btrim(name)) BETWEEN 1 AND 120),legacy_key text UNIQUE CHECK(legacy_key IN ('tasks','stuff')),sort_order integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO public.other_categories(name,legacy_key,sort_order) SELECT 'Things to do','tasks',0 WHERE EXISTS(SELECT 1 FROM public.things_to_do);
INSERT INTO public.other_categories(name,legacy_key,sort_order) SELECT 'Stuff to bring','stuff',1 WHERE EXISTS(SELECT 1 FROM public.stuff_to_bring);
ALTER TABLE public.things_to_do RENAME TO other_items;
ALTER TABLE public.other_items RENAME COLUMN task TO item;
ALTER TABLE public.other_items ADD COLUMN category_id uuid REFERENCES public.other_categories(id);
ALTER TABLE public.other_items ADD COLUMN quantity integer;
ALTER TABLE public.other_items ADD COLUMN source_kind text NOT NULL DEFAULT 'other' CHECK(source_kind IN ('task','stuff','other'));
ALTER TABLE public.other_items ADD COLUMN source_id uuid;
ALTER TABLE public.other_items DROP CONSTRAINT things_to_do_status_check;
ALTER TABLE public.other_items ADD CONSTRAINT other_status CHECK(status IN ('open','assigned','in_progress','done'));
UPDATE public.other_items SET category_id=(SELECT id FROM public.other_categories WHERE legacy_key='tasks'),source_kind='task',source_id=id;
INSERT INTO public.other_items(id,item,assigned_to,status,due_date,notes,sort_order,created_at,updated_at,quantity,category_id,source_kind,source_id)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.other_items o WHERE o.id=s.id) THEN gen_random_uuid() ELSE s.id END,s.item,s.assigned_to,s.status,NULL,s.notes,s.sort_order,s.created_at,s.updated_at,s.quantity,(SELECT id FROM public.other_categories WHERE legacy_key='stuff'),'stuff',s.id FROM public.stuff_to_bring s;
ALTER TABLE public.other_items ALTER COLUMN category_id SET NOT NULL;
CREATE INDEX other_items_category ON public.other_items(category_id);
CREATE UNIQUE INDEX other_source_identity ON public.other_items(source_kind,source_id) WHERE source_id IS NOT NULL;
ALTER TABLE public.stuff_to_bring RENAME TO legacy_stuff_to_bring;
REVOKE ALL ON public.legacy_stuff_to_bring FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_legacy_stuff BEFORE INSERT OR UPDATE OR DELETE ON public.legacy_stuff_to_bring FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
ALTER TABLE public.other_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.other_categories,public.other_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.other_categories,public.other_items TO authenticated;
CREATE POLICY admin_read ON public.other_categories FOR SELECT TO authenticated USING((SELECT public.is_admin()));
-- other_items retains the administrator-only RLS policy from the original task table.
CREATE VIEW public.things_to_do WITH(security_invoker=true) AS SELECT id,item AS task,assigned_to,status,due_date,notes,sort_order,created_at,updated_at FROM public.other_items WHERE source_kind='task';
CREATE VIEW public.stuff_to_bring WITH(security_invoker=true) AS SELECT source_id AS id,item,quantity,assigned_to,status,notes,sort_order,created_at,updated_at FROM public.other_items WHERE source_kind='stuff';
REVOKE ALL ON public.things_to_do,public.stuff_to_bring FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.things_to_do,public.stuff_to_bring TO authenticated;
CREATE FUNCTION public.admin_save_other(p_id uuid,p_values jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.other_items%ROWTYPE;result public.other_items%ROWTYPE;category uuid:=(p_values->>'category_id')::uuid;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR nullif(btrim(p_values->>'item'),'') IS NULL OR length(p_values->>'item')>1000 OR length(coalesce(p_values->>'notes',''))>4000 OR length(coalesce(p_values->>'assigned_to',''))>300 OR p_values->>'status' IS NULL OR p_values->>'status' NOT IN ('open','assigned','in_progress','done') OR (p_values->>'sort_order') IS NULL OR (p_values->>'sort_order')::integer<0 THEN RAISE EXCEPTION 'Enter valid item details';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.other_categories WHERE id=category) THEN RAISE EXCEPTION 'Choose a category';END IF;
 SELECT * INTO old FROM public.other_items WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  -- Stable client UUIDs make new-row retries safe after an uncertain response.
  IF p_expected_updated_at IS NULL THEN
   IF old.item=btrim(p_values->>'item') AND coalesce(old.notes,'')=btrim(coalesce(p_values->>'notes','')) AND coalesce(old.assigned_to,'')=btrim(coalesce(p_values->>'assigned_to','')) AND old.status=p_values->>'status' AND old.category_id=category THEN RETURN to_jsonb(old);END IF;
   RAISE EXCEPTION 'Item changed; reload before saving';
  END IF;
  IF old.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Item changed; reload before saving';END IF;
  UPDATE public.other_items SET item=btrim(p_values->>'item'),notes=nullif(btrim(p_values->>'notes'),''),assigned_to=nullif(btrim(p_values->>'assigned_to'),''),status=p_values->>'status',category_id=category,sort_order=(p_values->>'sort_order')::integer,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO result;
 ELSE
  IF p_expected_updated_at IS NOT NULL THEN RAISE EXCEPTION 'Item not found';END IF;
  INSERT INTO public.other_items(id,item,notes,assigned_to,status,category_id,sort_order) VALUES(p_id,btrim(p_values->>'item'),nullif(btrim(p_values->>'notes'),''),nullif(btrim(p_values->>'assigned_to'),''),p_values->>'status',category,(p_values->>'sort_order')::integer) RETURNING * INTO result;
 END IF;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.admin_save_other(uuid,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_other(uuid,jsonb,timestamptz) TO authenticated;
CREATE FUNCTION public.admin_save_other_category(p_id uuid,p_name text,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.other_categories%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>120 THEN RAISE EXCEPTION 'Enter a category name';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_id IS NULL THEN
  SELECT * INTO result FROM public.other_categories WHERE name=btrim(p_name);IF FOUND THEN RETURN to_jsonb(result);END IF;
  INSERT INTO public.other_categories(name,sort_order) VALUES(btrim(p_name),(SELECT coalesce(max(sort_order),0)+1 FROM public.other_categories)) RETURNING * INTO result;
 ELSE
  SELECT * INTO result FROM public.other_categories WHERE id=p_id FOR UPDATE;IF NOT FOUND OR result.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Category changed; reload before saving';END IF;
  UPDATE public.other_categories SET name=btrim(p_name),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO result;
 END IF;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.admin_save_other_category(uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_other_category(uuid,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_tasks(p_rows jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;old public.other_items%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'Enter at most 1000 task rows';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL)<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_rows) x WHERE nullif(x->>'id','') IS NOT NULL) THEN RAISE EXCEPTION 'Duplicate task rows';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 INSERT INTO public.other_categories(name,legacy_key,sort_order) SELECT 'Things to do','tasks',0 WHERE NOT EXISTS(SELECT 1 FROM public.other_categories WHERE legacy_key='tasks') ON CONFLICT(name) DO NOTHING;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'id' LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR nullif(btrim(r->>'task'),'') IS NULL OR length(r->>'task')>1000 OR length(coalesce(r->>'assigned_to',''))>300 OR length(coalesce(r->>'notes',''))>4000 OR r->>'status' IS NULL OR r->>'status' NOT IN ('open','in_progress','done') OR (r->>'sort_order')::integer<0 THEN RAISE EXCEPTION 'Enter valid task, assignee and status';END IF;
  IF nullif(r->>'id','') IS NULL THEN
   INSERT INTO public.other_items(item,notes,assigned_to,status,sort_order,category_id,source_kind) VALUES(btrim(r->>'task'),nullif(btrim(r->>'notes'),''),nullif(btrim(r->>'assigned_to'),''),r->>'status',(r->>'sort_order')::integer,(SELECT id FROM public.other_categories ORDER BY (legacy_key='tasks') DESC NULLS LAST,sort_order,id LIMIT 1),'task');
  ELSE
   SELECT * INTO old FROM public.other_items WHERE id=(r->>'id')::uuid AND source_kind='task' FOR UPDATE;
   IF NOT FOUND OR old.updated_at IS DISTINCT FROM (r->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'Task changed; reload before saving';END IF;
   UPDATE public.other_items SET item=btrim(r->>'task'),notes=CASE WHEN r?'notes' THEN nullif(btrim(r->>'notes'),'') ELSE notes END,assigned_to=nullif(btrim(r->>'assigned_to'),''),status=r->>'status',sort_order=(r->>'sort_order')::integer,updated_at=clock_timestamp() WHERE id=old.id;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_tasks(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_tasks(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_recipes','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;


NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261105130034_item_recipes.sql
BEGIN;

-- Preserve legacy recipe links while letting food items move independently.
ALTER TABLE public.food_items
  ADD COLUMN recipe_text text CHECK (length(recipe_text) <= 12000),
  ADD COLUMN reserved_household_id uuid REFERENCES public.households(id) ON DELETE SET NULL,
  DROP CONSTRAINT food_recipe_category,
  DROP CONSTRAINT recipe_requires_category,
  ADD CONSTRAINT food_recipe_link FOREIGN KEY (recipe_id) REFERENCES public.food_recipes(id);

CREATE INDEX food_items_reserved_household ON public.food_items(reserved_household_id) WHERE reserved_household_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_id',f.recipe_id,'recipe_name',fr.name,'recipe_text',f.recipe_text,
   'reserved_for_you',coalesce(f.reserved_household_id=v_household,false),
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_recipes fr ON fr.id=f.recipe_id LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND (f.reserved_household_id IS NULL OR f.reserved_household_id=v_household) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_household_food_claim(p_code text, p_food_item_id uuid, p_quantity integer, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_household public.households%ROWTYPE;v_needed integer;v_active boolean;v_total integer;v_old integer;v_reserved_household uuid;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF;
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO v_household FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT v_household.food OR v_household.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 SELECT quantity_needed,active,reserved_household_id INTO v_needed,v_active,v_reserved_household FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT v_active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0) INTO v_total FROM public.food_claims WHERE food_item_id=p_food_item_id;
 SELECT coalesce(quantity,0) INTO v_old FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 IF v_reserved_household IS NOT NULL AND v_reserved_household<>v_household.id AND p_quantity>coalesce(v_old,0) THEN
   RAISE EXCEPTION 'Food item unavailable' USING ERRCODE='42501';
 END IF;
 IF v_total-coalesce(v_old,0)+p_quantity>v_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN DELETE FROM public.food_claims WHERE household_id=v_household.id AND food_item_id=p_food_item_id;
 ELSE INSERT INTO public.food_claims(household_id,food_item_id,quantity,notes) VALUES(v_household.id,p_food_item_id,p_quantity,p_notes)
 ON CONFLICT(food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,notes=excluded.notes;
 END IF;
END $function$;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261105163030_retire_legacy_food_tables.sql
BEGIN;

LOCK TABLE public.food_recipes, public.food_items IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.food_recipes) THEN
  RAISE EXCEPTION 'Legacy recipe groups still contain data';
 END IF;
 IF to_regclass('public.legacy_stuff_to_bring') IS NOT NULL THEN
 LOCK TABLE public.legacy_stuff_to_bring, public.other_items IN ACCESS EXCLUSIVE MODE;
 IF EXISTS (
  SELECT 1 FROM public.legacy_stuff_to_bring a
  LEFT JOIN public.stuff_to_bring b USING (id)
  WHERE b.id IS NULL
     OR ROW(a.item,a.quantity,a.assigned_to,a.status,a.sort_order,a.created_at)
        IS DISTINCT FROM ROW(b.item,b.quantity,b.assigned_to,b.status,b.sort_order,b.created_at)
     OR (a.notes IS DISTINCT FROM b.notes AND a.notes IS DISTINCT FROM 'Imported from Food.csv')
 ) THEN
  RAISE EXCEPTION 'Legacy bring-list archive contains records or notes missing from Other';
 END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_text',f.recipe_text,
   'reserved_for_you',coalesce(f.reserved_household_id=v_household,false),
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND (f.reserved_household_id IS NULL OR f.reserved_household_id=v_household) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;

DROP FUNCTION public.admin_save_recipe(uuid,text,text,uuid[],jsonb,timestamptz);
ALTER TABLE public.food_items DROP COLUMN recipe_id;
DROP TABLE public.food_recipes;
DROP TABLE IF EXISTS public.legacy_stuff_to_bring;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261105163419_admin_food_selections.sql
BEGIN;

LOCK TABLE public.households, public.food_items, public.food_claims IN SHARE ROW EXCLUSIVE MODE;

-- A reservation has no stored quantity. Convert it to one unit unless a claim already exists.
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM public.food_items f JOIN public.households h ON h.id=f.reserved_household_id
   WHERE NOT EXISTS (SELECT 1 FROM public.food_claims c WHERE c.food_item_id=f.id AND c.household_id=h.id)
     AND (NOT f.active OR NOT h.food OR h.archived_at IS NOT NULL OR h.food_confirmed
       OR f.quantity_needed<=coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
 ) THEN RAISE EXCEPTION 'Resolve legacy reservations without an eligible household or remaining capacity'; END IF;
END $$;

INSERT INTO public.food_claims(food_item_id,household_id,quantity)
 SELECT id,reserved_household_id,1 FROM public.food_items WHERE reserved_household_id IS NOT NULL
 ON CONFLICT (food_item_id,household_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_text',f.recipe_text,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

CREATE FUNCTION app_private.save_food_selection(
 p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_notes text,p_expected_quantity integer
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item public.food_items%ROWTYPE; old_quantity integer; claimed_total bigint;
BEGIN
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO item FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT item.active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0),coalesce(max(quantity) FILTER (WHERE household_id=p_household_id),0)
 INTO claimed_total,old_quantity FROM public.food_claims WHERE food_item_id=p_food_item_id;
 IF p_expected_quantity IS NOT NULL AND old_quantity<>p_expected_quantity THEN
   RAISE EXCEPTION 'Food selection changed; refresh and try again';
 END IF;
 IF claimed_total-old_quantity+p_quantity>item.quantity_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN
  DELETE FROM public.food_claims WHERE household_id=p_household_id AND food_item_id=p_food_item_id;
 ELSE
  INSERT INTO public.food_claims AS existing(food_item_id,household_id,quantity,notes)
   VALUES(p_food_item_id,p_household_id,p_quantity,p_notes)
   ON CONFLICT (food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,
    notes=CASE WHEN p_expected_quantity IS NULL THEN excluded.notes ELSE existing.notes END;
 END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.save_food_selection(uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.set_household_food_claim(p_code text,p_food_item_id uuid,p_quantity integer,p_notes text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR h.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 PERFORM app_private.save_food_selection(h.id,p_food_item_id,p_quantity,p_notes,NULL);
END $$;

CREATE FUNCTION public.admin_set_food_selection(p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_expected_quantity integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_expected_quantity IS NULL OR p_expected_quantity<0 THEN RAISE EXCEPTION 'Expected quantity required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR h.food_confirmed THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 PERFORM app_private.save_food_selection(h.id,p_food_item_id,p_quantity,NULL,p_expected_quantity);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_food_selection(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_food_selection(uuid,uuid,integer,integer) TO authenticated;

-- Keep the profile and food permission change in one transaction.
CREATE FUNCTION public.admin_save_household_with_food(p_id uuid,p_values jsonb,p_food boolean,p_expected_food boolean)
 RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.admin_save_household(p_id,p_values);
 PERFORM public.admin_set_food_access(p_id,p_food,p_expected_food,'Updated from Household details');
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_household_with_food(uuid,jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_household_with_food(uuid,jsonb,boolean,boolean) TO authenticated;

ALTER TABLE public.food_items DROP COLUMN reserved_household_id;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261105163918_remove_import_markers.sql
BEGIN;

-- Strip source labels while retaining any text after the separator.
UPDATE public.guests
SET notes=nullif(regexp_replace(notes,'^[[:blank:]]*Imported from (Paetur|Maria|Food)[.]csv([[:blank:]]*[;|][[:blank:]]*|[[:blank:]]*$)','','i'),'')
WHERE notes ~* '^[[:blank:]]*Imported from (Paetur|Maria|Food)[.]csv([[:blank:]]*[;|]|[[:blank:]]*$)';

UPDATE public.households
SET notes=nullif(regexp_replace(notes,'^[[:blank:]]*Imported from (Paetur|Maria|Food)[.]csv([[:blank:]]*[;|][[:blank:]]*|[[:blank:]]*$)','','i'),'')
WHERE notes ~* '^[[:blank:]]*Imported from (Paetur|Maria|Food)[.]csv([[:blank:]]*[;|]|[[:blank:]]*$)';

DO $$
BEGIN
 IF to_regclass('public.legacy_stuff_to_bring') IS NULL THEN RETURN; END IF;
 LOCK TABLE public.legacy_stuff_to_bring, public.other_items IN ACCESS EXCLUSIVE MODE;
 IF EXISTS (
  SELECT 1 FROM public.legacy_stuff_to_bring a
  LEFT JOIN public.stuff_to_bring b USING (id)
  WHERE b.id IS NULL
     OR ROW(a.item,a.quantity,a.assigned_to,a.status,a.sort_order,a.created_at)
        IS DISTINCT FROM ROW(b.item,b.quantity,b.assigned_to,b.status,b.sort_order,b.created_at)
     OR (a.notes IS DISTINCT FROM b.notes AND a.notes IS DISTINCT FROM 'Imported from Food.csv')
 ) THEN
  RAISE EXCEPTION 'Legacy bring-list archive contains records or notes missing from Other';
 END IF;
 DROP TABLE public.legacy_stuff_to_bring;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261105232739_admin_edit_confirmed_food_claims.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_food_selection(p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_expected_quantity integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_expected_quantity IS NULL OR p_expected_quantity<0 THEN RAISE EXCEPTION 'Expected quantity required'; END IF;
 SELECT * INTO h FROM public.households WHERE id=p_household_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT h.food OR (h.food_confirmed AND p_expected_quantity=0) THEN RAISE EXCEPTION 'Food claims unavailable'; END IF;
 PERFORM app_private.save_food_selection(h.id,p_food_item_id,p_quantity,NULL,p_expected_quantity);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261106104158_food_types_and_venues.sql
BEGIN;

CREATE TABLE public.food_item_types (
 name text PRIMARY KEY CHECK (name=btrim(name) AND length(name) BETWEEN 1 AND 60)
);
ALTER TABLE public.food_item_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_item_types FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.food_item_types TO authenticated;
CREATE POLICY admin_read ON public.food_item_types FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY admin_add ON public.food_item_types FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

ALTER TABLE public.food_items ADD COLUMN quantity_type text NOT NULL DEFAULT 'Piece(s)'
 CHECK (quantity_type=btrim(quantity_type) AND length(quantity_type) BETWEEN 1 AND 60),
 ADD COLUMN venue_ids uuid[];

CREATE FUNCTION app_private.food_venue_eligible(p_household uuid,p_venues uuid[])
 RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_venues IS NULL OR EXISTS (
  SELECT 1 FROM public.effective_session_invitations i
  JOIN public.event_sessions s ON s.id=i.session_id
  JOIN public.event_locations v ON v.id=s.location_id AND v.archived_at IS NULL
  WHERE i.household_id=p_household AND s.location_id=ANY(p_venues)
 )
$$;
REVOKE ALL ON FUNCTION app_private.food_venue_eligible(uuid,uuid[]) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.validate_food_item_settings() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.quantity_type NOT IN ('Batch(s)','Piece(s)','Tray(s)','Packet(s)','Kg','Grams')
 AND NOT EXISTS(SELECT 1 FROM public.food_item_types WHERE name=NEW.quantity_type) THEN
  RAISE EXCEPTION 'Unknown food item type';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.venue_ids) AS selected(id)
   WHERE NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=selected.id)) THEN
  RAISE EXCEPTION 'Unknown food venue';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.validate_food_item_settings() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_food_item_settings BEFORE INSERT OR UPDATE OF quantity_type,venue_ids ON public.food_items
 FOR EACH ROW EXECUTE FUNCTION app_private.validate_food_item_settings();

CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_text',f.recipe_text,'quantity_type',f.quantity_type,
   'name_fo',f.name_fo,'name_en',f.name_en,'name_de',f.name_de,
   'description_fo',f.description_fo,'description_en',f.description_en,'description_de',f.description_de,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_fo),f.id)
   FROM public.food_items f LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND app_private.food_venue_eligible(v_household,f.venue_ids) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;

CREATE OR REPLACE FUNCTION app_private.save_food_selection(
 p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_notes text,p_expected_quantity integer
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item public.food_items%ROWTYPE; old_quantity integer; claimed_total bigint;
BEGIN
 IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 SELECT * INTO item FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND OR NOT item.active THEN RAISE EXCEPTION 'Food item unavailable'; END IF;
 SELECT coalesce(sum(quantity),0),coalesce(max(quantity) FILTER (WHERE household_id=p_household_id),0)
 INTO claimed_total,old_quantity FROM public.food_claims WHERE food_item_id=p_food_item_id;
 IF p_expected_quantity IS NOT NULL AND old_quantity<>p_expected_quantity THEN
   RAISE EXCEPTION 'Food selection changed; refresh and try again';
 END IF;
 IF p_quantity>old_quantity AND NOT app_private.food_venue_eligible(p_household_id,item.venue_ids) THEN
   RAISE EXCEPTION 'Food item unavailable at this household’s venues' USING ERRCODE='42501';
 END IF;
 IF claimed_total-old_quantity+p_quantity>item.quantity_needed THEN RAISE EXCEPTION 'Insufficient remaining quantity'; END IF;
 IF p_quantity=0 THEN
  DELETE FROM public.food_claims WHERE household_id=p_household_id AND food_item_id=p_food_item_id;
 ELSE
  INSERT INTO public.food_claims AS existing(food_item_id,household_id,quantity,notes)
   VALUES(p_food_item_id,p_household_id,p_quantity,p_notes)
   ON CONFLICT (food_item_id,household_id) DO UPDATE SET quantity=excluded.quantity,
    notes=CASE WHEN p_expected_quantity IS NULL THEN excluded.notes ELSE existing.notes END;
 END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.save_food_selection(uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_content','public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_item_types','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'app_private.invitation_code_registry']::text[]
$$;
REVOKE ALL ON FUNCTION app_private.backup_tables() FROM PUBLIC,anon,authenticated;


CREATE FUNCTION public.admin_save_food_translations(p_food_item_id uuid,p_changes jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_type text; v_type_key text; change jsonb; v_key text;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid food translations'; END IF;
 IF jsonb_array_length(p_changes)>300 THEN RAISE EXCEPTION 'Too many translations in one save'; END IF;
 SELECT quantity_type INTO v_type FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
 v_type_key:=CASE WHEN v_type IN ('Batch(s)','Piece(s)','Tray(s)','Packet(s)','Kg','Grams')
  THEN 'ui:'||v_type ELSE 'ui:Food type: '||v_type END;
 FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  v_key:=change->>'key';
  IF v_key IS NULL OR v_key NOT IN (v_type_key,'food:'||p_food_item_id||':name','food:'||p_food_item_id||':description')
    THEN RAISE EXCEPTION 'Invalid food translation key'; END IF;
  PERFORM public.admin_save_translation(v_key,change->>'language',change->>'value');
  IF v_key='food:'||p_food_item_id||':description' AND change->>'language'='en' AND btrim(change->>'value')='' THEN
   UPDATE public.food_items SET description_en='' WHERE id=p_food_item_id;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_food_translations(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_food_translations(uuid,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261106123041_venue_bulk_food.sql
BEGIN;

CREATE FUNCTION public.admin_add_venue_food(p_venue_id uuid,p_food_item_ids uuid[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item_id uuid;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_food_item_ids),0) NOT BETWEEN 1 AND 2000 OR array_position(p_food_item_ids,NULL) IS NOT NULL
 THEN RAISE EXCEPTION 'Select food items'; END IF;
 PERFORM 1 FROM public.event_locations WHERE id=p_venue_id AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active venue required'; END IF;
 FOR item_id IN SELECT DISTINCT id FROM unnest(p_food_item_ids) AS selected(id) ORDER BY id LOOP
  UPDATE public.food_items
  SET venue_ids=CASE WHEN p_venue_id=ANY(venue_ids) THEN venue_ids ELSE array_append(coalesce(venue_ids,ARRAY[]::uuid[]),p_venue_id) END
  WHERE id=item_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active food item required'; END IF;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_add_venue_food(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_venue_food(uuid,uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261106125850_move_event_language.sql
BEGIN;

CREATE FUNCTION public.admin_move_language(p_code text,p_direction integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order text[]; v_position integer; v_target integer;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(language_code ORDER BY sort_order,language_code) INTO v_order FROM public.event_languages;
 v_position:=array_position(v_order,p_code);
 IF v_position IS NULL THEN RAISE EXCEPTION 'Language not found'; END IF;
 v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>cardinality(v_order) THEN RETURN; END IF;
 v_order[v_position]:=v_order[v_target];
 v_order[v_target]:=p_code;
 UPDATE public.event_languages AS language SET sort_order=ordered.ordinality::integer
 FROM unnest(v_order) WITH ORDINALITY AS ordered(code,ordinality)
 WHERE language.language_code=ordered.code AND language.sort_order IS DISTINCT FROM ordered.ordinality::integer;
END $$;
REVOKE ALL ON FUNCTION public.admin_move_language(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_language(text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261106133148_edit_venue_food_assignments.sql
BEGIN;

CREATE FUNCTION public.admin_edit_venue_food(p_venue_id uuid,p_add uuid[],p_remove uuid[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item_id uuid;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_add IS NULL OR p_remove IS NULL OR cardinality(p_add)+cardinality(p_remove)>2000
    OR array_position(p_add,NULL) IS NOT NULL OR array_position(p_remove,NULL) IS NOT NULL
    OR p_add && p_remove THEN RAISE EXCEPTION 'Invalid venue food selections'; END IF;
 PERFORM 1 FROM public.event_locations WHERE id=p_venue_id AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active venue required'; END IF;
 FOR item_id IN SELECT DISTINCT id FROM unnest(p_add||p_remove) AS selected(id) ORDER BY id LOOP
  IF item_id=ANY(p_add) THEN
   UPDATE public.food_items
   SET venue_ids=CASE WHEN p_venue_id=ANY(venue_ids) THEN venue_ids ELSE array_append(coalesce(venue_ids,ARRAY[]::uuid[]),p_venue_id) END
   WHERE id=item_id AND active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active food item required'; END IF;
  ELSE
   UPDATE public.food_items SET venue_ids=array_remove(venue_ids,p_venue_id)
   WHERE id=item_id AND p_venue_id=ANY(venue_ids);
  END IF;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_edit_venue_food(uuid,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_venue_food(uuid,uuid[],uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261106133445_move_event_session.sql
BEGIN;

CREATE FUNCTION public.admin_move_session(p_session_id uuid,p_direction integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order uuid[]; v_position integer; v_target integer;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO v_order FROM public.event_sessions;
 v_position:=array_position(v_order,p_session_id);
 IF v_position IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
 v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>cardinality(v_order) THEN RETURN; END IF;
 v_order[v_position]:=v_order[v_target];
 v_order[v_target]:=p_session_id;
 UPDATE public.event_sessions AS session SET sort_order=ordered.ordinality::integer
 FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality)
 WHERE session.id=ordered.id AND session.sort_order IS DISTINCT FROM ordered.ordinality::integer;
END $$;
REVOKE ALL ON FUNCTION public.admin_move_session(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_session(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_session(p_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid:=p_id;s public.event_sessions%ROWTYPE;v_location uuid:=nullif(p_values->>'location_id','')::uuid;v_start timestamptz:=nullif(p_values->>'starts_at','')::timestamptz;v_end timestamptz:=nullif(p_values->>'ends_at','')::timestamptz;v_rsvp boolean:=coalesce((p_values->>'requires_rsvp')::boolean,true);v_active boolean:=coalesce((p_values->>'is_active')::boolean,true);
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR p_values->>'session_key' IS NULL OR p_values->>'session_key' !~ '^[a-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'Enter a session name and valid key';END IF;
 IF v_end IS NOT NULL AND (v_start IS NULL OR v_end<=v_start) THEN RAISE EXCEPTION 'End must follow start';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 -- Same household locks as submission and membership changes; eligibility cannot race RSVP.
 PERFORM 1 FROM public.households ORDER BY id FOR UPDATE;
 IF v_location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=v_location AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active venue';END IF;
 IF v_id IS NOT NULL THEN
 SELECT * INTO s FROM public.event_sessions WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Session not found';END IF;
 IF (s.requires_rsvp<>v_rsvp OR s.is_active<>v_active) AND (EXISTS(SELECT 1 FROM public.rsvp_response_audit WHERE session_id=v_id) OR EXISTS(SELECT 1 FROM public.guest_session_responses WHERE session_id=v_id) OR EXISTS(SELECT 1 FROM public.rsvp_submissions r JOIN public.guests g ON g.household_id=r.household_id LEFT JOIN public.household_session_defaults d ON d.household_id=r.household_id AND d.session_id=v_id LEFT JOIN public.guest_session_overrides o ON o.guest_id=g.id AND o.session_id=v_id WHERE coalesce(o.is_invited,d.is_invited,false))) THEN RAISE EXCEPTION 'Session eligibility is protected by RSVP history; scheduling details can still be edited';END IF;
 ELSE
 INSERT INTO public.event_sessions(session_key,name,sort_order)
 SELECT p_values->>'session_key',btrim(p_values->>'name'),coalesce(max(sort_order),0)+1 FROM public.event_sessions
 RETURNING id INTO v_id;
 END IF;
 UPDATE public.event_sessions SET session_key=p_values->>'session_key',name=btrim(p_values->>'name'),location_id=v_location,starts_at=v_start,ends_at=v_end,requires_rsvp=v_rsvp,is_active=v_active,sort_order=coalesce((p_values->>'sort_order')::integer,sort_order) WHERE id=v_id;
 RETURN v_id;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261106160311_venue_food_availability.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_edit_venue_food(p_venue_id uuid,p_add uuid[],p_remove uuid[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item_id uuid;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_add IS NULL OR p_remove IS NULL OR cardinality(p_add)+cardinality(p_remove)>2000
    OR array_position(p_add,NULL) IS NOT NULL OR array_position(p_remove,NULL) IS NOT NULL
    OR p_add && p_remove THEN RAISE EXCEPTION 'Invalid venue food selections'; END IF;
 PERFORM 1 FROM public.event_locations WHERE id=p_venue_id AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active venue required'; END IF;
 FOR item_id IN SELECT DISTINCT id FROM unnest(p_add||p_remove) AS selected(id) ORDER BY id LOOP
  IF item_id=ANY(p_add) THEN
   UPDATE public.food_items
   SET venue_ids=CASE WHEN p_venue_id=ANY(venue_ids) THEN venue_ids ELSE array_append(coalesce(venue_ids,ARRAY[]::uuid[]),p_venue_id) END
   WHERE id=item_id AND active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active food item required'; END IF;
  ELSE
   UPDATE public.food_items SET venue_ids=array_remove(
     coalesce(venue_ids,ARRAY(SELECT id FROM public.event_locations WHERE archived_at IS NULL ORDER BY id)),p_venue_id)
   WHERE id=item_id AND (p_venue_id=ANY(venue_ids) OR (venue_ids IS NULL AND active));
  END IF;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_edit_venue_food(uuid,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_venue_food(uuid,uuid[],uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261106175610_session_bulk_households.sql
BEGIN;

CREATE FUNCTION public.admin_session_invitation_locks()
 RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 RETURN ARRAY(
  SELECT h.id FROM public.households h
  WHERE h.archived_at IS NULL AND (
   h.rsvp_state<>'open'
   OR EXISTS(SELECT 1 FROM public.rsvp_submissions r WHERE r.household_id=h.id)
   OR EXISTS(SELECT 1 FROM public.rsvp_response_audit r WHERE r.household_id=h.id)
  )
 );
END $$;

CREATE FUNCTION public.admin_edit_session_households(p_session_id uuid,p_add uuid[],p_remove uuid[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_household_id uuid;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_add IS NULL OR p_remove IS NULL OR cardinality(p_add)+cardinality(p_remove)>2000
    OR array_position(p_add,NULL) IS NOT NULL OR array_position(p_remove,NULL) IS NOT NULL
    OR p_add && p_remove THEN RAISE EXCEPTION 'Invalid household selections'; END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.event_sessions WHERE id=p_session_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
 FOR v_household_id IN SELECT DISTINCT id FROM unnest(p_add||p_remove) AS selected(id) ORDER BY id LOOP
  IF NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=v_household_id AND g.archived_at IS NULL)
  THEN RAISE EXCEPTION 'Household must have an active guest'; END IF;
  PERFORM public.admin_save_session_assignments(v_household_id,jsonb_build_array(jsonb_build_object(
   'session_id',p_session_id,'is_invited',v_household_id=ANY(p_add))));
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_session_invitation_locks(),public.admin_edit_session_households(uuid,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_session_invitation_locks(),public.admin_edit_session_households(uuid,uuid[],uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261106175940_retire_legacy_other_views.sql
BEGIN;

DROP VIEW public.things_to_do,public.stuff_to_bring;
DROP FUNCTION public.admin_save_tasks(jsonb);

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261107102351_normalized_translations.sql
BEGIN;
ALTER TABLE public.event_settings ADD COLUMN introduction text NOT NULL DEFAULT '',
 ADD COLUMN invitation_message text NOT NULL DEFAULT '';
ALTER TABLE public.event_sessions ADD COLUMN description text NOT NULL DEFAULT '' CHECK(length(description)<=12000);

CREATE TABLE public.food_item_translations (
 food_item_id uuid NOT NULL REFERENCES public.food_items(id) ON DELETE CASCADE,
 language_code text NOT NULL REFERENCES public.event_languages(language_code) CHECK(language_code<>'en'),
 name text CHECK(length(name)<=12000),
 user_comment text CHECK(length(user_comment)<=12000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(food_item_id,language_code)
);

CREATE TABLE public.food_category_translations (
 food_category_id uuid NOT NULL REFERENCES public.food_categories(id) ON DELETE CASCADE,
 language_code text NOT NULL REFERENCES public.event_languages(language_code) CHECK(language_code<>'en'),
 name text CHECK(length(name)<=12000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(food_category_id,language_code)
);

CREATE TABLE public.food_type_translations (
 food_type_name text NOT NULL REFERENCES public.food_item_types(name) ON DELETE CASCADE,
 language_code text NOT NULL REFERENCES public.event_languages(language_code) CHECK(language_code<>'en'),
 name text CHECK(length(name)<=12000),
 plural_name text CHECK(length(plural_name)<=12000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(food_type_name,language_code)
);

CREATE TABLE public.venue_translations (
 venue_id uuid NOT NULL REFERENCES public.event_locations(id) ON DELETE CASCADE,
 language_code text NOT NULL REFERENCES public.event_languages(language_code) CHECK(language_code<>'en'),
 name text CHECK(length(name)<=12000),
 welcome_message text CHECK(length(welcome_message)<=12000),
 guest_notes text CHECK(length(guest_notes)<=12000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(venue_id,language_code)
);

CREATE TABLE public.session_translations (
 session_id uuid NOT NULL REFERENCES public.event_sessions(id) ON DELETE CASCADE,
 language_code text NOT NULL REFERENCES public.event_languages(language_code) CHECK(language_code<>'en'),
 name text CHECK(length(name)<=12000),
 description text CHECK(length(description)<=12000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(session_id,language_code)
);

CREATE TABLE public.event_translations (
 event_id integer NOT NULL REFERENCES public.event_settings(id) ON DELETE CASCADE,
 language_code text NOT NULL REFERENCES public.event_languages(language_code) CHECK(language_code<>'en'),
 introduction text CHECK(length(introduction)<=12000),
 invitation_message text CHECK(length(invitation_message)<=12000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(event_id,language_code)
);

CREATE TABLE public.translation_overrides (
 translation_key text NOT NULL CHECK(length(translation_key)<=800),
 category text NOT NULL CHECK(category IN ('interface','food','types')),
 source_text text NOT NULL CHECK(length(source_text)<=800),
 language_code text NOT NULL REFERENCES public.event_languages(language_code),
 value text NOT NULL CHECK(length(value)<=12000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(translation_key,language_code),
 UNIQUE(source_text,language_code)
);

ALTER TABLE public.food_item_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_item_translations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.food_item_translations TO authenticated;
CREATE POLICY admin_read ON public.food_item_translations FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE INDEX food_item_translations_actor ON public.food_item_translations(updated_by);

ALTER TABLE public.food_category_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_category_translations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.food_category_translations TO authenticated;
CREATE POLICY admin_read ON public.food_category_translations FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE INDEX food_category_translations_actor ON public.food_category_translations(updated_by);

ALTER TABLE public.food_type_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_type_translations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.food_type_translations TO authenticated;
CREATE POLICY admin_read ON public.food_type_translations FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE INDEX food_type_translations_actor ON public.food_type_translations(updated_by);

ALTER TABLE public.venue_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_translations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.venue_translations TO authenticated;
CREATE POLICY admin_read ON public.venue_translations FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE INDEX venue_translations_actor ON public.venue_translations(updated_by);

ALTER TABLE public.session_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_translations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.session_translations TO authenticated;
CREATE POLICY admin_read ON public.session_translations FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE INDEX session_translations_actor ON public.session_translations(updated_by);

ALTER TABLE public.event_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_translations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_translations TO authenticated;
CREATE POLICY admin_read ON public.event_translations FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE INDEX event_translations_actor ON public.event_translations(updated_by);

ALTER TABLE public.translation_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.translation_overrides FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.translation_overrides TO authenticated;
CREATE POLICY admin_read ON public.translation_overrides FOR SELECT TO authenticated USING((SELECT public.is_admin()));
CREATE INDEX translation_overrides_actor ON public.translation_overrides(updated_by);

CREATE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $catalog$ SELECT $json${
  "Back to households": "interface.messages.back_to_households",
  "Administration": "interface.messages.administration",
  "Admin": "interface.messages.admin",
  "Event Invitation": "interface.messages.event_invitation",
  "Event dashboard": "interface.messages.event_dashboard",
  "Appearance": "interface.messages.appearance",
  "Appearance preference": "interface.messages.appearance_preference",
  "System default": "interface.messages.system_default",
  "Light": "interface.messages.light",
  "Dark": "interface.messages.dark",
  "Language": "interface.messages.language",
  "Faroese": "interface.messages.faroese",
  "English": "interface.messages.english",
  "German": "interface.messages.german",
  "Settings": "interface.messages.settings",
  "Settings sections": "interface.messages.settings_sections",
  "Main settings": "interface.messages.main_settings",
  "Event settings": "interface.messages.event_settings",
  "Administrators": "interface.messages.administrators",
  "Administrator": "interface.messages.administrator",
  "Administrator actions": "interface.messages.administrator_actions",
  "Admin sections": "interface.messages.admin_sections",
  "Overview": "interface.messages.overview",
  "Households": "interface.messages.households",
  "Guests": "interface.messages.guests",
  "Food": "food.messages.food",
  "Manage Invites": "interface.messages.manage_invites",
  "Venues": "interface.messages.venues",
  "Sessions": "interface.messages.sessions",
  "Sessions & scheduling": "interface.messages.sessions_scheduling",
  "Logs": "interface.messages.logs",
  "Back": "interface.messages.back",
  "Back to dashboard": "interface.messages.back_to_dashboard",
  "View website in a new tab": "interface.messages.view_website_in_a_new_tab",
  "Refresh data": "interface.messages.refresh_data",
  "Sign out": "interface.messages.sign_out",
  "Sign in": "interface.messages.sign_in",
  "Email": "interface.messages.email",
  "Password": "interface.messages.password",
  "PRIVATE ADMINISTRATION": "interface.messages.private_administration",
  "Welcome back.": "interface.messages.welcome_back",
  "Only approved event administrators can sign in.": "interface.messages.only_approved_event_administrators_can_sign_in",
  "Setup wizard": "interface.messages.setup_wizard",
  "New password": "interface.messages.new_password",
  "Confirm password": "interface.messages.confirm_password",
  "You’re invited.": "interface.messages.you_re_invited",
  "Accept administrator invitation": "interface.messages.accept_administrator_invitation",
  "Accepting invitation…": "interface.messages.accepting_invitation",
  "Accepting gives you access to this event’s households, guests, invitations and settings.": "interface.messages.accepting_gives_you_access_to_this_event_s_households_guests_invi",
  "Set a password of at least 12 characters for future sign-ins.": "interface.messages.set_a_password_of_at_least_12_characters_for_future_sign_ins",
  "Event name": "interface.messages.event_name",
  "Type": "interface.messages.type",
  "Date": "interface.messages.date",
  "Default language": "interface.messages.default_language",
  "Timezone": "interface.messages.timezone",
  "Website URL": "interface.messages.website_url",
  "RSVP deadline (local browser time)": "interface.messages.rsvp_deadline_local_browser_time",
  "Save settings": "interface.messages.save_settings",
  "Publish event": "interface.messages.publish_event",
  "Unpublish event": "interface.messages.unpublish_event",
  "Event is published: invited guests can access RSVP. You can unpublish it below.": "interface.messages.event_is_published_invited_guests_can_access_rsvp_you_can_unpubli",
  "Event is unpublished: guest-facing event details and food remain hidden until you publish.": "food.messages.event_is_unpublished_guest_facing_event_details_and_food_remain_h",
  "Use View mode to inspect configuration and Edit mode to make changes. Publication controls are below.": "interface.messages.use_view_mode_to_inspect_configuration_and_edit_mode_to_make_chan",
  "Publishing makes the guest RSVP experience available. The website can be online while the event is unpublished. Complete access-control and invite-code release tests before publishing.": "interface.messages.publishing_makes_the_guest_rsvp_experience_available_the_website_",
  "I understand the release checks are my responsibility and this will open the event to invited guests.": "interface.messages.i_understand_the_release_checks_are_my_responsibility_and_this_wi",
  "Manage event details and administrator access.": "interface.messages.manage_event_details_and_administrator_access",
  "Manage locations, addresses and local timezones. Guests can attend sessions at more than one venue.": "interface.messages.manage_locations_addresses_and_local_timezones_guests_can_attend_",
  "Set each session’s venue and local times. Use Manage Invites for household invitations and individual exceptions.": "interface.messages.set_each_session_s_venue_and_local_times_use_manage_invites_for_h",
  "Invite trusted people to help manage this event. Access starts after they verify their email and accept.": "interface.messages.invite_trusted_people_to_help_manage_this_event_access_starts_aft",
  "Invite administrator": "interface.messages.invite_administrator",
  "Open Supabase Auth": "interface.messages.open_supabase_auth",
  "Display name": "interface.messages.display_name",
  "Send invitation": "interface.messages.send_invitation",
  "Pending invitations": "interface.messages.pending_invitations",
  "An email will be sent to this address. The recipient must accept within 7 days; email sign-in links may expire sooner.": "interface.messages.an_email_will_be_sent_to_this_address_the_recipient_must_accept_w",
  "Resend": "interface.messages.resend",
  "Cancel": "interface.messages.cancel",
  "Awaiting acceptance": "interface.messages.awaiting_acceptance",
  "No pending invitations.": "interface.messages.no_pending_invitations",
  "Sending invitation…": "interface.messages.sending_invitation",
  "Administrator invitation email sent.": "interface.messages.administrator_invitation_email_sent",
  "Administrator invitation cancelled.": "interface.messages.administrator_invitation_cancelled",
  "Administrator invitation accepted.": "interface.messages.administrator_invitation_accepted",
  "Revoke administrator access": "interface.messages.revoke_administrator_access",
  "Administrator access revoked.": "interface.messages.administrator_access_revoked",
  "You cannot remove the last administrator.": "interface.messages.you_cannot_remove_the_last_administrator",
  "Search": "interface.messages.search",
  "Category": "interface.messages.category",
  "Action": "interface.messages.action",
  "From": "interface.messages.from",
  "Through": "interface.messages.through",
  "All categories": "interface.messages.all_categories",
  "All actions": "interface.messages.all_actions",
  "Search logs": "interface.messages.search_logs",
  "Reset": "interface.messages.reset",
  "Load older entries": "interface.messages.load_older_entries",
  "Search recorded changes, RSVP activity, invitation delivery and administrator sessions.": "interface.messages.search_recorded_changes_rsvp_activity_invitation_delivery_and_adm",
  "Household, guest, administrator or change": "interface.messages.household_guest_administrator_or_change",
  "Contacts": "interface.messages.contacts",
  "Invitations": "interface.messages.invitations",
  "Login": "interface.messages.login",
  "Food access": "food.messages.food_access",
  "Loading logs…": "interface.messages.loading_logs",
  "No log entries match these filters.": "interface.messages.no_log_entries_match_these_filters",
  "Field": "interface.messages.field",
  "Before": "interface.messages.before",
  "After": "interface.messages.after",
  "Reference: ": "interface.messages.reference",
  "Showing ": "interface.messages.showing",
  "Date filters use the event timezone. Entries show your local time; expand one for its UTC time and details. Archive/restore actions are recorded; permanent deletion is disabled.": "interface.messages.date_filters_use_the_event_timezone_entries_show_your_local_time_",
  "Existing history is included. New sign-in and invitation-opening records start with this update. Repeated opens within 15 minutes are grouped.": "interface.messages.existing_history_is_included_new_sign_in_and_invitation_opening_r",
  "Launch checklist": "interface.messages.launch_checklist",
  "Check all release requirements before using Settings → Event settings → Publish event.": "interface.messages.check_all_release_requirements_before_using_settings_event_settin",
  "Admin account connected": "interface.messages.admin_account_connected",
  "Event name and date entered": "interface.messages.event_name_and_date_entered",
  "At least one session created": "interface.messages.at_least_one_session_created",
  "Invitations assigned": "interface.messages.invitations_assigned",
  "Website connection in deployed config.js": "interface.messages.website_connection_in_deployed_config_js",
  "Website address saved in event settings": "interface.messages.website_address_saved_in_event_settings",
  "Event published": "interface.messages.event_published",
  "New RSVP submissions": "interface.messages.new_rsvp_submissions",
  "Food items": "food.messages.food_items",
  "Add household": "interface.messages.add_household",
  "Add guest": "interface.messages.add_guest",
  "Add contact": "interface.messages.add_contact",
  "Add venue": "interface.messages.add_venue",
  "Add session": "interface.messages.add_session",
  "Add category": "interface.messages.add_category",
  "Add food item": "food.messages.add_food_item",
  "Household or guest": "interface.messages.household_or_guest",
  "Show archived records": "interface.messages.show_archived_records",
  "⌄ Expand all": "interface.messages.expand_all",
  "› Collapse all": "interface.messages.collapse_all",
  "Click a household to expand its individual guests. Select the top-right pencil to enable editing; each guest then has a pencil for their details. Parent–child household nesting is preserved.": "interface.messages.click_a_household_to_expand_its_individual_guests_select_the_top_",
  "Empty households have no invitation code. Add a guest, then use Manage Invites. Assign sessions in Settings.": "interface.messages.empty_households_have_no_invitation_code_add_a_guest_then_use_man",
  "Household name": "interface.messages.household_name",
  "Household language": "interface.messages.household_language",
  "Household email": "interface.messages.household_email",
  "Household phone": "interface.messages.household_phone",
  "Household notes": "interface.messages.household_notes",
  "Household details": "interface.messages.household_details",
  "Household contact details": "interface.messages.household_contact_details",
  "Household default": "interface.messages.household_default",
  "Parent household": "interface.messages.parent_household",
  "Child households": "interface.messages.child_households",
  "Grouping household": "interface.messages.grouping_household",
  "None (top level)": "interface.messages.none_top_level",
  "Side": "interface.messages.side",
  "Relation group": "interface.messages.relation_group",
  "Relation": "interface.messages.relation",
  "Notes": "interface.messages.notes",
  "Phone": "interface.messages.phone",
  "Postal address": "interface.messages.postal_address",
  "Preferred contact": "interface.messages.preferred_contact",
  "Preferred contact method": "interface.messages.preferred_contact_method",
  "Preferred delivery method": "interface.messages.preferred_delivery_method",
  "First name": "interface.messages.first_name",
  "Last name": "interface.messages.last_name",
  "Title": "interface.messages.title",
  "None": "interface.messages.none",
  "Son": "interface.messages.son",
  "Daughter": "interface.messages.daughter",
  "Child": "interface.messages.child",
  "Child guest": "interface.messages.child_guest",
  "Dietary requirements": "interface.messages.dietary_requirements",
  "Individual guests": "interface.messages.individual_guests",
  "Unnamed guest": "interface.messages.unnamed_guest",
  "Unnamed household": "interface.messages.unnamed_household",
  "Ungrouped": "interface.messages.ungrouped",
  "No matching households.": "interface.messages.no_matching_households",
  "No guests assigned to this household.": "interface.messages.no_guests_assigned_to_this_household",
  "No active guests match this search.": "interface.messages.no_active_guests_match_this_search",
  "Search guests": "interface.messages.search_guests",
  "Guest name or household": "interface.messages.guest_name_or_household",
  "Guest": "interface.messages.guest",
  "Save household": "interface.messages.save_household",
  "Create household": "interface.messages.create_household",
  "Save guest": "interface.messages.save_guest",
  "Move guest": "interface.messages.move_guest",
  "Destination household": "interface.messages.destination_household",
  "Choose household": "interface.messages.choose_household",
  "Move household up": "interface.messages.move_household_up",
  "Move household down": "interface.messages.move_household_down",
  "New guests inherit this household’s session invitations.": "interface.messages.new_guests_inherit_this_household_s_session_invitations",
  "RSVP status and household assignment are not changed by editing guest details.": "interface.messages.rsvp_status_and_household_assignment_are_not_changed_by_editing_g",
  "Current session invitations are preserved as individual overrides. Moves involving RSVP history are blocked.": "interface.messages.current_session_invitations_are_preserved_as_individual_overrides",
  "Move this guest and preserve their current session invitations?": "interface.messages.move_this_guest_and_preserve_their_current_session_invitations",
  "Grouping changes with child households require moving the children first.": "interface.messages.grouping_changes_with_child_households_require_moving_the_childre",
  "First name is required.": "interface.messages.first_name_is_required",
  "Guest details saved.": "interface.messages.guest_details_saved",
  "Changes saved.": "interface.messages.changes_saved",
  "Household order saved.": "interface.messages.household_order_saved",
  "Edit": "interface.messages.edit",
  "Rename": "interface.messages.rename",
  "Archive ": "interface.messages.archive",
  "Restore ": "interface.messages.restore",
  "Edit guest: ": "interface.messages.edit_guest",
  "Edit household: ": "interface.messages.edit_household",
  "Select guest: ": "interface.messages.select_guest",
  "Edit contact: ": "interface.messages.edit_contact",
  "Archive this household and disable its invitation link? Records and history are preserved.": "interface.messages.archive_this_household_and_disable_its_invitation_link_records_an",
  "Archive this record? It can be restored later.": "interface.messages.archive_this_record_it_can_be_restored_later",
  "Restore this record?": "interface.messages.restore_this_record",
  "Record archived.": "interface.messages.record_archived",
  "Record restored.": "interface.messages.record_restored",
  "Contact": "interface.messages.contact",
  "Contact name": "interface.messages.contact_name",
  "Contact type": "interface.messages.contact_type",
  "Contact details": "interface.messages.contact_details",
  "Contact language": "interface.messages.contact_language",
  "Linked guest": "interface.messages.linked_guest",
  "Remove guest link": "interface.messages.remove_guest_link",
  "Primary": "interface.messages.primary",
  "Primary contact for this type": "interface.messages.primary_contact_for_this_type",
  "Save contact": "interface.messages.save_contact",
  "Create contact": "interface.messages.create_contact",
  "No contacts added yet.": "interface.messages.no_contacts_added_yet",
  "Choose someone from the guest list": "interface.messages.choose_someone_from_the_guest_list",
  "Choose a guest or enter a new contact below. Guest selection fills the name and language; enter this person’s contact details separately.": "interface.messages.choose_a_guest_or_enter_a_new_contact_below_guest_selection_fills",
  "Private codes and links for households with guests. Sending remains manual.": "interface.messages.private_codes_and_links_for_households_with_guests_sending_remain",
  "Search invitations": "interface.messages.search_invitations",
  "Invitation code": "interface.messages.invitation_code",
  "Copy invitation link": "interface.messages.copy_invitation_link",
  "Copy invite code": "interface.messages.copy_invite_code",
  "Copy link": "interface.messages.copy_link",
  "Copy message": "interface.messages.copy_message",
  "Invitation code copied.": "interface.messages.invitation_code_copied",
  "Invitation link copied.": "interface.messages.invitation_link_copied",
  "Message copied.": "interface.messages.message_copied",
  "No matching invitations. Empty and archived households have no active invitation.": "interface.messages.no_matching_invitations_empty_and_archived_households_have_no_act",
  "Delivery log": "interface.messages.delivery_log",
  "Invitation delivery": "interface.messages.invitation_delivery",
  "Filter delivery status": "interface.messages.filter_delivery_status",
  "All statuses": "interface.messages.all_statuses",
  "Draft": "interface.messages.draft",
  "Ready": "interface.messages.ready",
  "Ready to send": "interface.messages.ready_to_send",
  "Failed": "interface.messages.failed",
  "Cancelled": "interface.messages.cancelled",
  "Recorded sent": "interface.messages.recorded_sent",
  "No deliveries match this status.": "interface.messages.no_deliveries_match_this_status",
  "No delivery recorded yet.": "interface.messages.no_delivery_recorded_yet",
  "Prepare delivery": "interface.messages.prepare_delivery",
  "Delivery channel": "interface.messages.delivery_channel",
  "Delivery recipient": "interface.messages.delivery_recipient",
  "Delivery status": "interface.messages.delivery_status",
  "Message subject": "interface.messages.message_subject",
  "Message text": "interface.messages.message_text",
  "Delivery change note": "interface.messages.delivery_change_note",
  "Create delivery draft": "interface.messages.create_delivery_draft",
  "Save delivery changes": "interface.messages.save_delivery_changes",
  "Edit delivery": "interface.messages.edit_delivery",
  "Record as sent": "interface.messages.record_as_sent",
  "Sent note": "interface.messages.sent_note",
  "I sent this message to the displayed recipient": "interface.messages.i_sent_this_message_to_the_displayed_recipient",
  "Manual": "interface.messages.manual",
  "Manual / in person": "interface.messages.manual_in_person",
  "Postal": "interface.messages.postal",
  "Other": "interface.messages.other",
  "Recipient: ": "interface.messages.recipient",
  "To: ": "interface.messages.to",
  "Manually recorded as sent · ": "interface.messages.manually_recorded_as_sent",
  "Missing — add contact details before marking ready.": "interface.messages.missing_add_contact_details_before_marking_ready",
  "Saving a draft or marking it ready does not send a message. Review the recipient and text, send it yourself, then record it as sent.": "interface.messages.saving_a_draft_or_marking_it_ready_does_not_send_a_message_review",
  "RSVP management": "interface.messages.rsvp_management",
  "Current response": "interface.messages.current_response",
  "Choose response": "interface.messages.choose_response",
  "Corrected response": "interface.messages.corrected_response",
  "Correct response: ": "interface.messages.correct_response",
  "Attending": "interface.messages.attending",
  "Not attending": "interface.messages.not_attending",
  "Pending": "interface.messages.pending",
  "RSVP required": "interface.messages.rsvp_required",
  "Information only": "interface.messages.information_only",
  "Locked after submission": "interface.messages.locked_after_submission",
  "Open for responses": "interface.messages.open_for_responses",
  "Reason for RSVP correction": "interface.messages.reason_for_rsvp_correction",
  "Save correction": "interface.messages.save_correction",
  "This updates the current response and records the reason. The original submission and household lock are preserved.": "interface.messages.this_updates_the_current_response_and_records_the_reason_the_orig",
  "Reopen RSVP": "interface.messages.reopen_rsvp",
  "Reason for reopening": "interface.messages.reason_for_reopening",
  "Reopen this household’s RSVP while preserving its submission history?": "interface.messages.reopen_this_household_s_rsvp_while_preserving_its_submission_hist",
  "Reopening lets the household submit again. Previous submissions remain in history. If the event deadline has passed, grant a late-response window after reopening.": "interface.messages.reopening_lets_the_household_submit_again_previous_submissions_re",
  "Allow a late response": "interface.messages.allow_a_late_response",
  "Allow late response": "interface.messages.allow_late_response",
  "Allow responses until (": "interface.messages.allow_responses_until",
  "Reason for late response": "interface.messages.reason_for_late_response",
  "No active RSVP sessions are assigned to this household.": "interface.messages.no_active_rsvp_sessions_are_assigned_to_this_household",
  "Invitations are protected because this household has RSVP history.": "interface.messages.invitations_are_protected_because_this_household_has_rsvp_history",
  "Allow this household to contribute food": "food.messages.allow_this_household_to_contribute_food",
  "Reason for food-access change": "food.messages.reason_for_food_access_change",
  "Save food access": "food.messages.save_food_access",
  "Disabling access is blocked while food commitments or a confirmed selection exist. Existing selections are never removed by this control.": "food.messages.disabling_access_is_blocked_while_food_commitments_or_a_confirmed",
  "Food categories & items": "food.messages.food_categories_items",
  "Food or category": "food.messages.food_or_category",
  "Grouped by category. Switch to Edit to sort, rename, or update items. Existing claims are preserved.": "interface.messages.grouped_by_category_switch_to_edit_to_sort_rename_or_update_items",
  "＋ Add food category": "food.messages.add_food_category",
  "＋ Add food item": "food.messages.add_food_item_2",
  "Category name": "interface.messages.category_name",
  "New category name": "interface.messages.new_category_name",
  "Register category": "interface.messages.register_category",
  "Register existing category": "interface.messages.register_existing_category",
  "Rename food category": "food.messages.rename_food_category",
  "Move category up": "interface.messages.move_category_up",
  "Move category down": "interface.messages.move_category_down",
  "Move food item up": "food.messages.move_food_item_up",
  "Move food item down": "food.messages.move_food_item_down",
  "Category for ": "interface.messages.category_for",
  "Edit food item": "food.messages.edit_food_item",
  "Save food item": "food.messages.save_food_item",
  "Faroese name": "interface.messages.faroese_name",
  "English name": "interface.messages.english_name",
  "German name": "interface.messages.german_name",
  "Faroese description": "interface.messages.faroese_description",
  "English description": "interface.messages.english_description",
  "German description": "interface.messages.german_description",
  "Quantity needed": "interface.messages.quantity_needed",
  "Display order": "interface.messages.display_order",
  "Available for guests": "interface.messages.available_for_guests",
  "Archive food item (preserve existing claims)": "food.messages.archive_food_item_preserve_existing_claims",
  "No matching food items.": "food.messages.no_matching_food_items",
  "Uncategorized": "interface.messages.uncategorized",
  "Unnamed item": "interface.messages.unnamed_item",
  "Not registered": "interface.messages.not_registered",
  "Faroese name is required.": "interface.messages.faroese_name_is_required",
  "Enter a non-negative quantity.": "interface.messages.enter_a_non_negative_quantity",
  "Food category added.": "food.messages.food_category_added",
  "Food category updated.": "food.messages.food_category_updated",
  "Food item added.": "food.messages.food_item_added",
  "Food item updated.": "food.messages.food_item_updated",
  "Food item archived.": "food.messages.food_item_archived",
  "Food order saved.": "food.messages.food_order_saved",
  "Category order saved.": "interface.messages.category_order_saved",
  "Category registered.": "interface.messages.category_registered",
  "Category renamed and linked food items updated.": "food.messages.category_renamed_and_linked_food_items_updated",
  "Session": "interface.messages.session",
  "Session name": "interface.messages.session_name",
  "Session key": "interface.messages.session_key",
  "Session venue": "interface.messages.session_venue",
  "Active session": "interface.messages.active_session",
  "Starts (venue local time)": "interface.messages.starts_venue_local_time",
  "Ends (venue local time)": "interface.messages.ends_venue_local_time",
  "Save session": "interface.messages.save_session",
  "Create session": "interface.messages.create_session",
  "Venue name": "interface.messages.venue_name",
  "Venue address": "interface.messages.venue_address",
  "Venue timezone": "interface.messages.venue_timezone",
  "Country code": "interface.messages.country_code",
  "Map link (HTTPS)": "interface.messages.map_link_https",
  "Guest venue notes": "interface.messages.guest_venue_notes",
  "Welcome message — ": "interface.messages.welcome_message",
  "Welcome messages for this venue": "interface.messages.welcome_messages_for_this_venue",
  "Archived venue": "interface.messages.archived_venue",
  "Save venue": "interface.messages.save_venue",
  "Create venue": "interface.messages.create_venue",
  "No venue": "interface.messages.no_venue",
  "Unscheduled": "interface.messages.unscheduled",
  "Times are entered in ": "interface.messages.times_are_entered_in",
  "Session invitations": "interface.messages.session_invitations",
  "Save session invitations": "interface.messages.save_session_invitations",
  "Create sessions in Settings first.": "interface.messages.create_sessions_in_settings_first",
  "Household defaults apply to each guest unless an individual exception is selected. Language does not determine invitations.": "interface.messages.household_defaults_apply_to_each_guest_unless_an_individual_excep",
  "Follow household": "interface.messages.follow_household",
  "Invited": "interface.messages.invited",
  "Not invited": "interface.messages.not_invited",
  "Household invited": "interface.messages.household_invited",
  "Household not invited": "interface.messages.household_not_invited",
  "Switch to Edit mode": "interface.messages.switch_to_edit_mode",
  "Switch to View mode": "interface.messages.switch_to_view_mode",
  "View mode · Manage invitations, food and event details": "food.messages.view_mode_manage_invitations_food_and_event_details",
  "Edit mode · Changes are saved to the event database": "interface.messages.edit_mode_changes_are_saved_to_the_event_database",
  "Loading event data…": "interface.messages.loading_event_data",
  "Event data refreshed.": "interface.messages.event_data_refreshed",
  "Event settings saved.": "interface.messages.event_settings_saved",
  "Switch to Edit mode first.": "interface.messages.switch_to_edit_mode_first",
  "Invalid RSVP deadline.": "interface.messages.invalid_rsvp_deadline",
  "Confirm the release acknowledgement before publishing.": "interface.messages.confirm_the_release_acknowledgement_before_publishing",
  "Complete the event name, date, website URL, active session and invitations before publishing.": "interface.messages.complete_the_event_name_date_website_url_active_session_and_invit",
  "Publish this event now? Invite-code holders may access guest RSVP and food details. Proceed only after security and guest-flow testing.": "food.messages.publish_this_event_now_invite_code_holders_may_access_guest_rsvp_",
  "Unpublish this event? Guest access to published event details will stop.": "interface.messages.unpublish_this_event_guest_access_to_published_event_details_will",
  "Event published.": "interface.messages.event_published_2",
  "Event unpublished.": "interface.messages.event_unpublished",
  "Enter matching passwords of at least 12 characters.": "interface.messages.enter_matching_passwords_of_at_least_12_characters",
  "Sign in again before sending an invitation.": "interface.messages.sign_in_again_before_sending_an_invitation",
  "Invitation could not be sent.": "interface.messages.invitation_could_not_be_sent",
  "Email delivery status is uncertain. Check before resending.": "interface.messages.email_delivery_status_is_uncertain_check_before_resending",
  "Email status is uncertain. Refresh pending invitations before retrying.": "interface.messages.email_status_is_uncertain_refresh_pending_invitations_before_retr",
  "Email sending is restricted. Check the email configuration.": "interface.messages.email_sending_is_restricted_check_the_email_configuration",
  "The email could not be sent. Check the email configuration before resending.": "interface.messages.the_email_could_not_be_sent_check_the_email_configuration_before_",
  "The email service request limit was reached. Wait before resending.": "interface.messages.the_email_service_request_limit_was_reached_wait_before_resending",
  "The email service sending limit was reached. Wait before resending.": "interface.messages.the_email_service_sending_limit_was_reached_wait_before_resending",
  "Administrator invitations are unavailable. The invitation service must be installed before sending.": "interface.messages.administrator_invitations_are_unavailable_the_invitation_service_",
  "Administrator list unavailable. Apply migration 006 if needed.": "interface.messages.administrator_list_unavailable_apply_migration_006_if_needed",
  "Admin management API unavailable: ": "interface.messages.admin_management_api_unavailable",
  "No active administrator invitation was found for this account. Ask an administrator to send or resend it.": "interface.messages.no_active_administrator_invitation_was_found_for_this_account_ask",
  "Your account does not have administrator access, or invitation acceptance is unavailable. Ask an administrator to check your invitation.": "interface.messages.your_account_does_not_have_administrator_access_or_invitation_acc",
  "Session logging is unavailable.": "interface.messages.session_logging_is_unavailable",
  "Signed in, but session logging is unavailable.": "interface.messages.signed_in_but_session_logging_is_unavailable",
  "Send another administrator invitation email to ": "interface.messages.send_another_administrator_invitation_email_to",
  "Cancel administrator invitation for ": "interface.messages.cancel_administrator_invitation_for",
  "Revoke administrator access for ": "interface.messages.revoke_administrator_access_for",
  "Added": "interface.messages.added",
  "Updated": "interface.messages.updated",
  "Deleted": "interface.messages.deleted",
  "Archived": "interface.messages.archived",
  "Restored": "interface.messages.restored",
  "Moved": "interface.messages.moved",
  "Renamed": "interface.messages.renamed",
  "Assigned": "interface.messages.assigned",
  "Enabled": "interface.messages.enabled",
  "Disabled": "interface.messages.disabled",
  "Unspecified": "interface.messages.unspecified",
  "Expired": "interface.messages.expired",
  "Draft saved": "interface.messages.draft_saved",
  "Delivery created": "interface.messages.delivery_created",
  "Failed delivery": "interface.messages.failed_delivery",
  "Failed attempt": "interface.messages.failed_attempt",
  "Household submitted": "interface.messages.household_submitted",
  "Guest response submitted": "interface.messages.guest_response_submitted",
  "Guest response corrected": "interface.messages.guest_response_corrected",
  "RSVP reopened": "interface.messages.rsvp_reopened",
  "Late response allowed": "interface.messages.late_response_allowed",
  "Invitation opened": "interface.messages.invitation_opened",
  "Invitation assignments changed": "interface.messages.invitation_assignments_changed",
  "Sign-in session": "interface.messages.sign_in_session",
  "Signed out": "interface.messages.signed_out",
  "Sign-out requested": "interface.messages.sign_out_requested",
  "Token refreshed": "interface.messages.token_refreshed",
  "Administrator invitation accepted": "interface.messages.administrator_invitation_accepted_2",
  "Administrator invitation cancelled": "interface.messages.administrator_invitation_cancelled_2",
  "Administrator email requested": "interface.messages.administrator_email_requested",
  "Administrator email accepted by service": "interface.messages.administrator_email_accepted_by_service",
  "Administrator email failed": "interface.messages.administrator_email_failed",
  "Email failed": "interface.messages.email_failed",
  "Sending / status pending": "interface.messages.sending_status_pending",
  "Access removed": "interface.messages.access_removed",
  "FIRST-TIME SETUP": "interface.messages.first_time_setup",
  "Make this event yours.": "interface.messages.make_this_event_yours",
  "Connect your own Supabase project in four steps. No terminal or Python required.": "interface.messages.connect_your_own_supabase_project_in_four_steps_no_terminal_or_py",
  "Administration · Own your data": "interface.messages.administration_own_your_data",
  "Database choice": "interface.messages.database_choice",
  "Connection": "interface.messages.connection",
  "Verify admin": "interface.messages.verify_admin",
  "Publish config": "interface.messages.publish_config",
  "STEP 1 OF 4": "interface.messages.step_1_of_4",
  "STEP 2 OF 4": "interface.messages.step_2_of_4",
  "STEP 3 OF 4": "interface.messages.step_3_of_4",
  "STEP 4 OF 4": "interface.messages.step_4_of_4",
  "How would you like to begin?": "interface.messages.how_would_you_like_to_begin",
  "Use existing database": "interface.messages.use_existing_database",
  "Connect to an already-migrated Supabase project. Preserve its invitations, guests and admin accounts.": "interface.messages.connect_to_an_already_migrated_supabase_project_preserve_its_invi",
  "Set up a new database": "interface.messages.set_up_a_new_database",
  "Create an empty Supabase project, run the included SQL, then create the first administrator.": "interface.messages.create_an_empty_supabase_project_run_the_included_sql_then_create",
  "Continue": "interface.messages.continue",
  "Connect Supabase": "interface.messages.connect_supabase",
  "Project URL": "interface.messages.project_url",
  "Publishable or legacy anon key": "interface.messages.publishable_or_legacy_anon_key",
  "Test connection": "interface.messages.test_connection",
  "Never paste a Supabase secret key, service_role key, database password or access token here. Only public client keys belong in a static website.": "interface.messages.never_paste_a_supabase_secret_key_service_role_key_database_passw",
  "New database instructions": "interface.messages.new_database_instructions",
  "Create a project at": "interface.messages.create_a_project_at",
  "Open SQL Editor and run the included migrations 001–006 in order, or use the bundled install file. These are starter migrations and require functional/security testing before public launch.": "interface.messages.open_sql_editor_and_run_the_included_migrations_001_006_in_order_",
  "Create an Auth user under Authentication → Users.": "interface.messages.create_an_auth_user_under_authentication_users",
  "Download complete SQL installer": "interface.messages.download_complete_sql_installer",
  "First admin email (for new installations)": "interface.messages.first_admin_email_for_new_installations",
  "Generate first-admin SQL": "interface.messages.generate_first_admin_sql",
  "Copy SQL": "interface.messages.copy_sql",
  "The SQL appears here. Run it in your private Supabase SQL Editor, never on the website.": "interface.messages.the_sql_appears_here_run_it_in_your_private_supabase_sql_editor_n",
  "Secure administrator access": "interface.messages.secure_administrator_access",
  "For new projects, invite your first user via": "interface.messages.for_new_projects_invite_your_first_user_via",
  ", then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.": "interface.messages.then_run_the_sql_below_in_supabase_sql_editor_to_grant_admin_acce",
  "Check administrator login": "interface.messages.check_administrator_login",
  "Put your configuration online": "interface.messages.put_your_configuration_online",
  "Administrator verified. Your website configuration is ready.": "interface.messages.administrator_verified_your_website_configuration_is_ready",
  "Download config.js": "interface.messages.download_config_js",
  "Copy config contents": "interface.messages.copy_config_contents",
  "Go to admin": "interface.messages.go_to_admin",
  "The file contains only your Supabase URL and publishable / anon key. It must not contain a secret or service_role key.": "interface.messages.the_file_contains_only_your_supabase_url_and_publishable_anon_key",
  "After committing": "interface.messages.after_committing",
  ", enable GitHub Pages for the new repository. Then open the website, verify admin sign-in and invitation behavior. Keep the event unpublished until final security checks pass.": "interface.messages.enable_github_pages_for_the_new_repository_then_open_the_website_",
  "Enter": "interface.messages.enter",
  ", and add it to": "interface.messages.and_add_it_to",
  "in your NEW GitHub repository. This step is essential: browser-only setup does not configure the public website for other visitors.": "interface.messages.in_your_new_github_repository_this_step_is_essential_browser_only",
  "For a new project, create your first Auth user in Supabase and use the setup wizard to establish admin access.": "interface.messages.for_a_new_project_create_your_first_auth_user_in_supabase_and_use",
  "Test your Supabase connection before continuing.": "interface.messages.test_your_supabase_connection_before_continuing",
  "Administrator verification required.": "interface.messages.administrator_verification_required",
  "Sign in as an administrator first.": "interface.messages.sign_in_as_an_administrator_first",
  "Database connection or schema validation failed: ": "interface.messages.database_connection_or_schema_validation_failed",
  "Guest Edge Function is unavailable. Deploy the guest-gateway function first: ": "interface.messages.guest_edge_function_is_unavailable_deploy_the_guest_gateway_funct",
  "Enter a valid administrator email.": "interface.messages.enter_a_valid_administrator_email",
  "First-admin SQL generated. This must be executed in the private Supabase SQL Editor, not in the browser.": "interface.messages.first_admin_sql_generated_this_must_be_executed_in_the_private_su",
  "This account does not have administrator access. Run the first-admin SQL or ask an existing admin to grant access.": "interface.messages.this_account_does_not_have_administrator_access_run_the_first_adm",
  "Generate SQL first.": "interface.messages.generate_sql_first",
  "SQL copied.": "interface.messages.sql_copied",
  "Unable to copy SQL. Select it manually.": "interface.messages.unable_to_copy_sql_select_it_manually",
  "Configuration copied.": "interface.messages.configuration_copied",
  "Clipboard access denied. Download the file instead.": "interface.messages.clipboard_access_denied_download_the_file_instead",
  "Connected to {host}. The protected guest gateway responded.": "interface.messages.connected_to_host_the_protected_guest_gateway_responded",
  "Database not configured": "interface.messages.database_not_configured",
  "Database not connected. Complete the setup wizard first.": "interface.messages.database_not_connected_complete_the_setup_wizard_first",
  "Invalid administrator action": "interface.messages.invalid_administrator_action",
  "Administrator request failed.": "interface.messages.administrator_request_failed",
  "Your sign-in has expired. Sign in again before saving. Your edits have not been submitted.": "interface.messages.your_sign_in_has_expired_sign_in_again_before_saving_your_edits_h",
  "The server returned an unreadable response.": "interface.messages.the_server_returned_an_unreadable_response",
  "Supabase JavaScript library did not load. Check the network connection.": "interface.messages.supabase_javascript_library_did_not_load_check_the_network_connec",
  "Supabase URL must use HTTPS (except localhost).": "interface.messages.supabase_url_must_use_https_except_localhost",
  "Use only the Supabase project URL, with no credentials or query string.": "interface.messages.use_only_the_supabase_project_url_with_no_credentials_or_query_st",
  "Use only a publishable or anon key, never a secret key.": "interface.messages.use_only_a_publishable_or_anon_key_never_a_secret_key",
  "This JWT is not an anon key.": "interface.messages.this_jwt_is_not_an_anon_key",
  "The supplied JWT key is malformed.": "interface.messages.the_supplied_jwt_key_is_malformed",
  "Expected a publishable key or legacy anon JWT.": "interface.messages.expected_a_publishable_key_or_legacy_anon_jwt",
  "Something went wrong.": "interface.messages.something_went_wrong",
  "Enter a complete date and time.": "interface.messages.enter_a_complete_date_and_time",
  "Invalid date and time.": "interface.messages.invalid_date_and_time",
  "This local time is ambiguous or does not exist because clocks change. Choose a time outside the clock change.": "interface.messages.this_local_time_is_ambiguous_or_does_not_exist_because_clocks_cha",
  "A simple way to celebrate together.": "interface.messages.a_simple_way_to_celebrate_together",
  "Your event,": "interface.messages.your_event",
  "beautifully arranged.": "interface.messages.beautifully_arranged",
  "Private invitations · Please do not share your invitation link.": "interface.messages.private_invitations_please_do_not_share_your_invitation_link",
  "SETUP REQUIRED": "interface.messages.setup_required",
  "Connect your event": "interface.messages.connect_your_event",
  "This website has not been connected to Supabase yet.": "interface.messages.this_website_has_not_been_connected_to_supabase_yet",
  "Open first-time setup": "interface.messages.open_first_time_setup",
  "YOUR INVITATION": "interface.messages.your_invitation",
  "Open your invitation": "interface.messages.open_your_invitation",
  "Enter the eight-character invitation code or open the private link you received.": "interface.messages.enter_the_eight_character_invitation_code_or_open_the_private_lin",
  "Open": "interface.messages.open",
  "PERSONAL INVITATION": "interface.messages.personal_invitation",
  "Welcome": "interface.messages.welcome",
  "Please let us know who will attend.": "interface.messages.please_let_us_know_who_will_attend",
  "Submit RSVP": "interface.messages.submit_rsvp",
  "FOOD COORDINATION": "food.messages.food_coordination",
  "What can you bring?": "interface.messages.what_can_you_bring",
  "Choose items only if you want to contribute. Quantities cannot exceed what is needed.": "interface.messages.choose_items_only_if_you_want_to_contribute_quantities_cannot_exc",
  "Confirm my selections": "interface.messages.confirm_my_selections",
  "Invalid quantity": "interface.messages.invalid_quantity",
  "Invalid invitation code": "interface.messages.invalid_invitation_code",
  "Confirm food selections? This will lock further edits.": "food.messages.confirm_food_selections_this_will_lock_further_edits",
  "Food item": "food.messages.food_item",
  "Your event": "interface.messages.your_event_2",
  "Invitation": "interface.messages.invitation",
  "Quantity for {item}": "interface.messages.quantity_for_item",
  "Interface language": "interface.messages.interface_language",
  "Interface wording": "interface.messages.interface_wording",
  "Welcome messages": "interface.messages.welcome_messages",
  "Save welcome messages": "interface.messages.save_welcome_messages",
  "Welcome messages saved.": "interface.messages.welcome_messages_saved",
  "Leave a welcome message blank to use the built-in translation.": "interface.messages.leave_a_welcome_message_blank_to_use_the_built_in_translation",
  "Customize interface wording": "interface.messages.customize_interface_wording",
  "Choose a phrase and language, edit the wording, then download the file and replace js/interface-overrides.js in the repository. This does not publish the event.": "interface.messages.choose_a_phrase_and_language_edit_the_wording_then_download_the_f",
  "Phrase": "interface.messages.phrase",
  "Custom wording": "interface.messages.custom_wording",
  "Use {placeholders} exactly as shown. Blank text restores the built-in wording.": "interface.messages.use_placeholders_exactly_as_shown_blank_text_restores_the_built_i",
  "Apply wording": "interface.messages.apply_wording",
  "Download wording file": "interface.messages.download_wording_file",
  "Wording applied to this preview. Download and commit the file to share it.": "interface.messages.wording_applied_to_this_preview_download_and_commit_the_file_to_s",
  "Keep the same placeholders as the original phrase.": "interface.messages.keep_the_same_placeholders_as_the_original_phrase",
  "EVENT INVITATION": "interface.messages.event_invitation_2",
  "We look forward to celebrating with you.": "interface.messages.we_look_forward_to_celebrating_with_you",
  "Enter the eight-character code from your invitation.": "interface.messages.enter_the_eight_character_code_from_your_invitation",
  "Dear guests": "interface.messages.dear_guests",
  "Your response has been received and locked.": "interface.messages.your_response_has_been_received_and_locked",
  "Thank you! Your response is recorded.": "interface.messages.thank_you_your_response_is_recorded",
  "No invitation was found for that code.": "interface.messages.no_invitation_was_found_for_that_code",
  "Choose a response for every invited guest and session.": "interface.messages.choose_a_response_for_every_invited_guest_and_session",
  "Could not reach the database.": "interface.messages.could_not_reach_the_database",
  "This event has not been published yet.": "interface.messages.this_event_has_not_been_published_yet",
  "Choose only what you would like to contribute. Quantities are limited.": "interface.messages.choose_only_what_you_would_like_to_contribute_quantities_are_limi",
  "Thank you! Your food selection is confirmed.": "food.messages.thank_you_your_food_selection_is_confirmed",
  "Save": "interface.messages.save",
  "Food selection saved.": "food.messages.food_selection_saved",
  "Available": "interface.messages.available",
  "All invited guests are listed.": "interface.messages.all_invited_guests_are_listed",
  "Changing language reloads this page. Unsaved changes will be lost. Continue?": "interface.messages.changing_language_reloads_this_page_unsaved_changes_will_be_lost_",
  "Showing {count} of {total} matching guests.": "interface.messages.showing_count_of_total_matching_guests",
  "{count} entries shown · Newest first": "interface.messages.count_entries_shown_newest_first",
  "{state} · {count} food commitments{confirmed}": "food.messages.state_count_food_commitments_confirmed",
  " · Confirmed": "interface.messages.confirmed",
  " · Last submission {time}": "interface.messages.last_submission_time",
  "Event deadline: {deadline} · Late-response permission: {late} · {zone}": "interface.messages.event_deadline_deadline_late_response_permission_late_zone",
  "{ready} ready · {sent} recorded sent · {failed} failed": "interface.messages.ready_ready_sent_recorded_sent_failed_failed",
  "{count} guests": "interface.messages.count_guests",
  "{count} sub-households · {guests} guests in sub-households": "interface.messages.count_sub_households_guests_guests_in_sub_households",
  "Quantity cannot fall below {count} claimed; claimed items cannot be hidden.": "interface.messages.quantity_cannot_fall_below_count_claimed_claimed_items_cannot_be_",
  "Needed {needed} · Claimed {claimed} · Available {available}{inactive}": "interface.messages.needed_needed_claimed_claimed_available_available_inactive",
  " · Inactive": "interface.messages.inactive",
  "Archive {item}? Existing claims are preserved; you can reactivate it using Edit.": "interface.messages.archive_item_existing_claims_are_preserved_you_can_reactivate_it_",
  "Revoke administrator access for {email}?": "interface.messages.revoke_administrator_access_for_email",
  "Times are entered in {zone}. Changing venue keeps the typed local time; review before saving.": "interface.messages.times_are_entered_in_zone_changing_venue_keeps_the_typed_local_ti",
  "For new projects, invite your first user via Supabase → Authentication → Users, then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.": "interface.messages.for_new_projects_invite_your_first_user_via_supabase_authenticati",
  "{attending} attending · {declined} declined": "interface.messages.attending_attending_declined_declined",
  "{sent} recorded sent · {pending} pending": "interface.messages.sent_recorded_sent_pending_pending",
  "{count} households": "interface.messages.count_households",
  "{count} items": "interface.messages.count_items",
  " · Child": "interface.messages.child_2",
  " · Archived": "interface.messages.archived_2",
  " (unregistered)": "interface.messages.unregistered",
  " (inactive)": "interface.messages.inactive_2",
  " — household": "interface.messages.household",
  " · Expires {time}": "interface.messages.expires_time",
  "Household": "interface.messages.household_2",
  "Wording preview": "interface.messages.wording_preview",
  "Download": "interface.messages.download",
  "{count} guest": "interface.messages.count_guest",
  "{count} sub-household": "interface.messages.count_sub_household",
  "{count} sub-households": "interface.messages.count_sub_households",
  "{count} guest in sub-households": "interface.messages.count_guest_in_sub_households",
  "{count} guests in sub-households": "interface.messages.count_guests_in_sub_households",
  "Archive household": "interface.messages.archive_household",
  "Restore household": "interface.messages.restore_household",
  "Archive guest": "interface.messages.archive_guest",
  "Restore guest": "interface.messages.restore_guest",
  "Archive contact": "interface.messages.archive_contact",
  "Restore contact": "interface.messages.restore_contact",
  "Languages": "interface.messages.languages",
  "Backups": "interface.messages.backups",
  "Fallback language": "interface.messages.fallback_language",
  "Choose enabled languages and the fallback used for missing translations. English is the final built-in fallback.": "interface.messages.choose_enabled_languages_and_the_fallback_used_for_missing_transl",
  "Save language preferences": "interface.messages.save_language_preferences",
  "Add language": "interface.messages.add_language",
  "Language code": "interface.messages.language_code",
  "Save language": "interface.messages.save_language",
  "Language saved.": "interface.messages.language_saved",
  "Language preferences saved.": "interface.messages.language_preferences_saved",
  "Translations": "interface.messages.translations",
  "Add translations for interface phrases, event introductions, venue welcome messages, sessions and food. Missing text uses the fallback language.": "food.messages.add_translations_for_interface_phrases_event_introductions_venue_",
  "Text to translate": "interface.messages.text_to_translate",
  "Translation": "interface.messages.translation",
  "Save translation": "interface.messages.save_translation",
  "Translation saved.": "interface.messages.translation_saved",
  "Fallback preview": "interface.messages.fallback_preview",
  "Venue": "interface.messages.venue",
  "Description": "interface.messages.description",
  "Blank text uses the configured fallback language, then English.": "interface.messages.blank_text_uses_the_configured_fallback_language_then_english",
  "Choose a phrase and language, then save the translation. Downloading a wording file is optional. This does not publish the event.": "interface.messages.choose_a_phrase_and_language_then_save_the_translation_downloadin",
  "Download an application backup containing guest information, private invitation codes, settings, translations, contributions and historical records. Store it privately.": "interface.messages.download_an_application_backup_containing_guest_information_priva",
  "Auth passwords, sessions, administrator access, deployment secrets, rate-limit counters and sign-in logs are not restored. Keep a separate copy of the repository and deployment configuration.": "interface.messages.auth_passwords_sessions_administrator_access_deployment_secrets_r",
  "Download application backup": "interface.messages.download_application_backup",
  "Validate and restore": "interface.messages.validate_and_restore",
  "Choose a backup to inspect it. Full validation rehearses the restore and rolls it back. Import requires an empty, unpublished destination with matching migrations and verified historical actor accounts. Existing application records cannot be overwritten.": "interface.messages.choose_a_backup_to_inspect_it_full_validation_rehearses_the_resto",
  "Backup file": "interface.messages.backup_file",
  "Validate backup": "interface.messages.validate_backup",
  "Restore confirmation": "interface.messages.restore_confirmation",
  "I understand this restores application data into an empty destination and keeps the event unpublished.": "interface.messages.i_understand_this_restores_application_data_into_an_empty_destina",
  "Restore application backup": "interface.messages.restore_application_backup",
  "Preparing backup…": "interface.messages.preparing_backup",
  "Backup export is unavailable. Install the matching migration first.": "interface.messages.backup_export_is_unavailable_install_the_matching_migration_first",
  "Backup downloaded. Store it privately and rehearse restoration.": "interface.messages.backup_downloaded_store_it_privately_and_rehearse_restoration",
  "Backup exceeds 20 MB.": "interface.messages.backup_exceeds_20_mb",
  "Unsupported backup format or version.": "interface.messages.unsupported_backup_format_or_version",
  "Validating backup…": "interface.messages.validating_backup",
  "Backup validation is unavailable.": "interface.messages.backup_validation_is_unavailable",
  "Restore rehearsal passed. No data was changed.": "interface.messages.restore_rehearsal_passed_no_data_was_changed",
  "This destination cannot be restored: ": "interface.messages.this_destination_cannot_be_restored",
  "Application restored. The event is unpublished. Review administrator access separately.": "interface.messages.application_restored_the_event_is_unpublished_review_administrato",
  "RESTORE followed by the source event name": "interface.messages.restore_followed_by_the_source_event_name",
  "Open email": "interface.messages.open_email",
  "Open Messages": "interface.messages.open_messages",
  "Open WhatsApp": "interface.messages.open_whatsapp",
  "Copy the message, open Messages, then paste and send.": "interface.messages.copy_the_message_open_messages_then_paste_and_send",
  "Review the message in your device app and tap Send.": "interface.messages.review_the_message_in_your_device_app_and_tap_send",
  "Opening an app does not mark this message as sent. Return here to confirm sending. Delivery and read receipts remain in your messaging app.": "interface.messages.opening_an_app_does_not_mark_this_message_as_sent_return_here_to_",
  "Enter one valid email address.": "interface.messages.enter_one_valid_email_address",
  "Use an international phone number, including country code.": "interface.messages.use_an_international_phone_number_including_country_code",
  "Refresh and save this delivery again before sending.": "interface.messages.refresh_and_save_this_delivery_again_before_sending",
  "Prepare reminder": "interface.messages.prepare_reminder",
  "Creates a separate draft using current contact details. Review the recipient and text before sending.": "interface.messages.creates_a_separate_draft_using_current_contact_details_review_the",
  "A friendly reminder to reply to our invitation:": "interface.messages.a_friendly_reminder_to_reply_to_our_invitation",
  "Invites": "interface.messages.invites",
  "Things to do": "interface.messages.things_to_do",
  "Task": "interface.messages.task",
  "Assigned to": "interface.messages.assigned_to",
  "Status": "interface.messages.status",
  "Add rows": "interface.messages.add_rows",
  "In progress": "interface.messages.in_progress",
  "Done": "interface.messages.done",
  "Tasks saved.": "interface.messages.tasks_saved",
  "Edit cells, add rows, then save. Blank new rows are ignored.": "interface.messages.edit_cells_add_rows_then_save_blank_new_rows_are_ignored",
  "Select Edit to update the task list.": "interface.messages.select_edit_to_update_the_task_list",
  "Name": "interface.messages.name",
  "User Comment": "interface.messages.user_comment",
  "Admin Comment": "interface.messages.admin_comment",
  "Amount: {claimed}/{needed}, Shown: {shown}": "interface.messages.amount_claimed_needed_shown_shown",
  "Pick item": "interface.messages.pick_item",
  "Remove selection": "interface.messages.remove_selection",
  "Selected": "interface.messages.selected",
  "Find text": "interface.messages.find_text",
  "Choose enabled languages": "interface.messages.choose_enabled_languages",
  "Name is required.": "interface.messages.name_is_required",
  "Comment": "interface.messages.comment",
  "Recipe": "food.messages.recipe",
  "Previous recipe group": "food.messages.previous_recipe_group",
  "Print / Save as PDF": "interface.messages.print_save_as_pdf",
  "Allow pop-ups to save the recipe as PDF.": "food.messages.allow_pop_ups_to_save_the_recipe_as_pdf",
  "Batch(s)": "types.units.batch_s",
  "Piece(s)": "types.units.piece_s",
  "Tray(s)": "types.units.tray_s",
  "Packet(s)": "types.units.packet_s",
  "Kg": "types.units.kg",
  "Grams": "types.units.grams",
  "Default type ({type})": "interface.messages.default_type_type",
  "+ Add food item type": "food.messages.add_food_item_type",
  "New food item type": "food.messages.new_food_item_type",
  "Food item type must be at most 60 characters.": "food.messages.food_item_type_must_be_at_most_60_characters",
  "Expand all items": "interface.messages.expand_all_items",
  "Collapse all items": "interface.messages.collapse_all_items",
  "+ Add household": "interface.messages.add_household_2",
  "Amount: {claimed}/{needed} {type}, Shown: {shown}": "interface.messages.amount_claimed_needed_type_shown_shown",
  "Type translations are shared by food items with the same type.": "food.messages.type_translations_are_shared_by_food_items_with_the_same_type",
  "No matching food types.": "food.messages.no_matching_food_types",
  "Event welcome": "interface.messages.event_welcome",
  "Venue welcome": "interface.messages.venue_welcome",
  "Appears at the top of the guest invitation.": "interface.messages.appears_at_the_top_of_the_guest_invitation",
  "Appears under the session at this venue on the guest invitation.": "interface.messages.appears_under_the_session_at_this_venue_on_the_guest_invitation",
  "Map link": "interface.messages.map_link",
  "Manage households": "interface.messages.manage_households",
  "Checked households are invited to this session. Individual guest exceptions stay in place.": "interface.messages.checked_households_are_invited_to_this_session_individual_guest_e",
  "No households to manage.": "interface.messages.no_households_to_manage",
  "Guest exceptions": "interface.messages.guest_exceptions",
  "Protected by RSVP history": "interface.messages.protected_by_rsvp_history",
  "Manage food": "food.messages.manage_food",
  "Venue food": "food.messages.venue_food",
  "Checked items are available at this venue. Changes apply here only. Existing household claims are kept.": "interface.messages.checked_items_are_available_at_this_venue_changes_apply_here_only",
  "No food items to manage.": "food.messages.no_food_items_to_manage",
  "Add food": "food.messages.add_food",
  "Select all": "interface.messages.select_all",
  "Adding unrestricted food here makes it available at this venue only. Items already assigned to other venues keep those assignments.": "food.messages.adding_unrestricted_food_here_makes_it_available_at_this_venue_on",
  "Nothing available to add.": "interface.messages.nothing_available_to_add",
  "Edit administrator name": "interface.messages.edit_administrator_name",
  "Move session up": "interface.messages.move_session_up",
  "Move session down": "interface.messages.move_session_down",
  "Session order saved.": "interface.messages.session_order_saved",
  "Move language up": "interface.messages.move_language_up",
  "Move language down": "interface.messages.move_language_down",
  "Food Types": "food.messages.food_types",
  "Food categories": "food.messages.food_categories",
  "Save translations": "interface.messages.save_translations",
  "Allow food": "food.messages.allow_food",
  "1 item": "interface.messages.1_item",
  "{items}, {claimed}/{capacity} amounts": "interface.messages.items_claimed_capacity_amounts",
  "+ Add": "interface.messages.add",
  "Edit quantity for {household}": "interface.messages.edit_quantity_for_household",
  "Remove selection for {household}": "interface.messages.remove_selection_for_household",
  "Remove the food selection for {household}?": "food.messages.remove_the_food_selection_for_household",
  "+ Add recipe": "food.messages.add_recipe",
  "Add recipe": "food.messages.add_recipe_2",
  "Recipe name": "food.messages.recipe_name",
  "Existing food items": "food.messages.existing_food_items",
  "Create food item in recipe": "food.messages.create_food_item_in_recipe",
  "Remove new item": "interface.messages.remove_new_item",
  "Save recipe": "food.messages.save_recipe",
  "Edit recipe": "food.messages.edit_recipe",
  "Existing items keep their selections. Recipe items use the recipe category.": "food.messages.existing_items_keep_their_selections_recipe_items_use_the_recipe_",
  "Move to category": "interface.messages.move_to_category",
  "Move recipe to category": "food.messages.move_recipe_to_category",
  "Unsaved changes. Select Save to update the database.": "interface.messages.unsaved_changes_select_save_to_update_the_database",
  "Use main Edit mode to change tasks. Save sends your changes to the database.": "interface.messages.use_main_edit_mode_to_change_tasks_save_sends_your_changes_to_the",
  "Tasks were saved. Refresh the page before editing again.": "interface.messages.tasks_were_saved_refresh_the_page_before_editing_again",
  "Item": "interface.messages.item",
  "New item": "interface.messages.new_item",
  "Edit item": "interface.messages.edit_item",
  "Save item": "interface.messages.save_item",
  "Item saved.": "interface.messages.item_saved",
  "No items in this category.": "interface.messages.no_items_in_this_category",
  "Use main Edit, then the pencil to edit and save a line.": "interface.messages.use_main_edit_then_the_pencil_to_edit_and_save_a_line",
  "Add a category first.": "interface.messages.add_a_category_first",
  "Tasks and things to bring, grouped by category. Use main Edit, then the pencil to edit a line.": "interface.messages.tasks_and_things_to_bring_grouped_by_category_use_main_edit_then_"
}$json$::jsonb $catalog$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.store_translation(p_key text,p_language text,p_value text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE parts text[]:=string_to_array(p_key,':'); target uuid; path text; field_name text; source_tokens text[]; value_tokens text[];
BEGIN
 IF p_key IS NULL OR length(p_key)>800 OR p_value IS NULL OR length(p_value)>12000 THEN RAISE EXCEPTION 'Invalid translation key or text'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language) THEN RAISE EXCEPTION 'Unknown language'; END IF;
 IF parts[1]='ui' AND length(substr(p_key,4))>0 THEN
  IF p_key LIKE 'ui:Food type: %' THEN
   field_name:=substr(p_key,15);
   IF NOT EXISTS(SELECT 1 FROM public.food_item_types WHERE name=field_name) THEN RAISE EXCEPTION 'Translation target not found'; END IF;
   IF p_language='en' THEN
    -- An English label override does not rename the unit identity referenced by food items.
    path:='types.custom.'||field_name;
   ELSE
    INSERT INTO public.food_type_translations(food_type_name,language_code,name,updated_by)
    VALUES(field_name,p_language,nullif(btrim(p_value),''),auth.uid())
    ON CONFLICT(food_type_name,language_code) DO UPDATE SET name=excluded.name,updated_at=now(),updated_by=excluded.updated_by;
    RETURN;
   END IF;
  ELSE path:=app_private.translation_keys()->>substr(p_key,4);
   IF path IS NULL THEN path:='interface.custom.'||md5(substr(p_key,4)); END IF;
  END IF;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO source_tokens FROM regexp_matches(substr(p_key,4),'\{([A-Za-z][A-Za-z0-9_]*)\}','g') m;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO value_tokens FROM regexp_matches(p_value,'\{([A-Za-z][A-Za-z0-9_]*)\}','g') m;
  IF btrim(p_value)<>'' AND source_tokens IS DISTINCT FROM value_tokens THEN RAISE EXCEPTION 'Keep the same placeholders as the original phrase'; END IF;
  IF btrim(p_value)='' THEN DELETE FROM public.translation_overrides WHERE translation_key=path AND language_code=p_language;
  ELSE INSERT INTO public.translation_overrides(translation_key,category,source_text,language_code,value,updated_by)
   VALUES(path,split_part(path,'.',1),substr(p_key,4),p_language,p_value,auth.uid())
   ON CONFLICT(translation_key,language_code) DO UPDATE SET value=excluded.value,updated_at=now(),updated_by=excluded.updated_by;
  END IF;
 ELSIF p_key IN ('welcome','invite') THEN
  field_name:=CASE p_key WHEN 'welcome' THEN 'introduction' ELSE 'invitation_message' END;
  IF p_language='en' THEN
   EXECUTE format('UPDATE public.event_settings SET %I=$1 WHERE id=1',field_name) USING p_value;
  ELSE
   EXECUTE format('INSERT INTO public.event_translations(event_id,language_code,%I,updated_by) VALUES(1,$1,$2,auth.uid()) ON CONFLICT(event_id,language_code) DO UPDATE SET %I=excluded.%I,updated_at=now(),updated_by=excluded.updated_by',field_name,field_name,field_name)
    USING p_language,nullif(btrim(p_value),'');
  END IF;
 ELSIF cardinality(parts)=3 AND parts[1] IN ('food','venue','session','food-category') AND parts[2] ~ '^[0-9a-f-]{36}$' THEN
  target:=parts[2]::uuid;
  IF parts[1]='food' AND parts[3] IN ('name','description') THEN
   IF p_language='en' THEN
    IF parts[3]='name' AND btrim(p_value)='' THEN RAISE EXCEPTION 'Name is required'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.food_items WHERE id=target) THEN RAISE EXCEPTION 'Translation target not found'; END IF;
    EXECUTE format('UPDATE public.food_items SET %I=$1 WHERE id=$2',parts[3]||'_en') USING p_value,target;
   ELSE
    field_name:=CASE parts[3] WHEN 'name' THEN 'name' ELSE 'user_comment' END;
    EXECUTE format('INSERT INTO public.food_item_translations(food_item_id,language_code,%I,updated_by) VALUES($1,$2,$3,auth.uid()) ON CONFLICT(food_item_id,language_code) DO UPDATE SET %I=excluded.%I,updated_at=now(),updated_by=excluded.updated_by',field_name,field_name,field_name) USING target,p_language,nullif(btrim(p_value),'');
   END IF;
  ELSIF parts[1]='venue' AND parts[3] IN ('welcome','name','notes') THEN
   field_name:=CASE parts[3] WHEN 'welcome' THEN 'welcome_message' WHEN 'notes' THEN 'guest_notes' ELSE 'name' END;
   IF p_language='en' THEN
    IF NOT EXISTS(SELECT 1 FROM public.event_locations WHERE id=target) THEN RAISE EXCEPTION 'Translation target not found'; END IF;
    EXECUTE format('UPDATE public.event_locations SET %I=$1 WHERE id=$2',CASE parts[3] WHEN 'welcome' THEN 'welcome_en' ELSE parts[3] END) USING nullif(btrim(p_value),''),target;
   ELSE
    EXECUTE format('INSERT INTO public.venue_translations(venue_id,language_code,%I,updated_by) VALUES($1,$2,$3,auth.uid()) ON CONFLICT(venue_id,language_code) DO UPDATE SET %I=excluded.%I,updated_at=now(),updated_by=excluded.updated_by',field_name,field_name,field_name) USING target,p_language,nullif(btrim(p_value),'');
   END IF;
  ELSIF parts[1]='session' AND parts[3] IN ('name','description') THEN
   IF p_language='en' THEN
    IF NOT EXISTS(SELECT 1 FROM public.event_sessions WHERE id=target) THEN RAISE EXCEPTION 'Translation target not found'; END IF;
    EXECUTE format('UPDATE public.event_sessions SET %I=$1 WHERE id=$2',parts[3]) USING p_value,target;
   ELSE
    EXECUTE format('INSERT INTO public.session_translations(session_id,language_code,%I,updated_by) VALUES($1,$2,$3,auth.uid()) ON CONFLICT(session_id,language_code) DO UPDATE SET %I=excluded.%I,updated_at=now(),updated_by=excluded.updated_by',parts[3],parts[3],parts[3]) USING target,p_language,nullif(btrim(p_value),'');
   END IF;
  ELSIF parts[1]='food-category' AND parts[3]='name' THEN
   IF p_language='en' THEN
    PERFORM public.admin_rename_food_category(target,p_value);
   ELSE
   INSERT INTO public.food_category_translations(food_category_id,language_code,name,updated_by) VALUES(target,p_language,nullif(btrim(p_value),''),auth.uid())
   ON CONFLICT(food_category_id,language_code) DO UPDATE SET name=excluded.name,updated_at=now(),updated_by=excluded.updated_by;
   END IF;
  ELSE RAISE EXCEPTION 'Invalid translation key'; END IF;
 ELSE RAISE EXCEPTION 'Invalid translation key'; END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.store_translation(text,text,text) FROM PUBLIC,anon,authenticated;

-- Backfill existing non-English columns before moving the generic content rows.
INSERT INTO public.food_item_translations(food_item_id,language_code,name,user_comment)
 SELECT id,language,name,comment FROM public.food_items
 CROSS JOIN LATERAL (VALUES('fo',name_fo,description_fo),('de',name_de,description_de)) AS translation(language,name,comment)
 WHERE nullif(btrim(name),'') IS NOT NULL OR nullif(btrim(comment),'') IS NOT NULL;
INSERT INTO public.venue_translations(venue_id,language_code,welcome_message)
 SELECT id,language,message FROM public.event_locations
 CROSS JOIN LATERAL (VALUES('fo',welcome_fo),('de',welcome_de)) AS translation(language,message)
 WHERE nullif(btrim(message),'') IS NOT NULL;
DO $$ DECLARE entry record; BEGIN
 FOR entry IN SELECT * FROM public.event_content ORDER BY content_key,language_code LOOP
  PERFORM app_private.store_translation(entry.content_key,entry.language_code,entry.content_value);
 END LOOP;
END $$;

-- Older deployed clients still read this shape. The view has no separate stored rows.
DROP TABLE public.event_content;
CREATE VIEW public.event_content WITH(security_invoker=true) AS
 SELECT 'ui:'||source_text AS content_key,language_code,value AS content_value FROM public.translation_overrides
 UNION ALL SELECT 'ui:Food type: '||food_type_name,language_code,name FROM public.food_type_translations WHERE name IS NOT NULL
 UNION ALL SELECT 'welcome',language_code,introduction FROM public.event_translations WHERE introduction IS NOT NULL
 UNION ALL SELECT 'welcome','en',introduction FROM public.event_settings WHERE introduction<>''
 UNION ALL SELECT 'invite',language_code,invitation_message FROM public.event_translations WHERE invitation_message IS NOT NULL
 UNION ALL SELECT 'invite','en',invitation_message FROM public.event_settings WHERE invitation_message<>''
 UNION ALL SELECT 'food:'||food_item_id||':name',language_code,name FROM public.food_item_translations WHERE name IS NOT NULL
 UNION ALL SELECT 'food:'||food_item_id||':description',language_code,user_comment FROM public.food_item_translations WHERE user_comment IS NOT NULL
 UNION ALL SELECT 'food-category:'||food_category_id||':name',language_code,name FROM public.food_category_translations WHERE name IS NOT NULL
 UNION ALL SELECT 'venue:'||venue_id||':name',language_code,name FROM public.venue_translations WHERE name IS NOT NULL
 UNION ALL SELECT 'venue:'||venue_id||':welcome',language_code,welcome_message FROM public.venue_translations WHERE welcome_message IS NOT NULL
 UNION ALL SELECT 'venue:'||venue_id||':notes',language_code,guest_notes FROM public.venue_translations WHERE guest_notes IS NOT NULL
 UNION ALL SELECT 'session:'||session_id||':name',language_code,name FROM public.session_translations WHERE name IS NOT NULL
 UNION ALL SELECT 'session:'||session_id||':description',language_code,description FROM public.session_translations WHERE description IS NOT NULL
 UNION ALL SELECT 'food:'||id||':name','en',name_en FROM public.food_items WHERE name_en IS NOT NULL
 UNION ALL SELECT 'food:'||id||':description','en',description_en FROM public.food_items WHERE description_en IS NOT NULL
 UNION ALL SELECT 'food-category:'||id||':name','en',name FROM public.food_categories
 UNION ALL SELECT 'venue:'||id||':name','en',name FROM public.event_locations
 UNION ALL SELECT 'venue:'||id||':welcome','en',welcome_en FROM public.event_locations WHERE welcome_en IS NOT NULL
 UNION ALL SELECT 'venue:'||id||':notes','en',notes FROM public.event_locations WHERE notes IS NOT NULL
 UNION ALL SELECT 'session:'||id||':name','en',name FROM public.event_sessions
 UNION ALL SELECT 'session:'||id||':description','en',description FROM public.event_sessions;
REVOKE ALL ON public.event_content FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_content TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_translation(p_key text,p_language text,p_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language'; END IF;
 PERFORM app_private.store_translation(p_key,p_language,p_value);
 -- Keep old deployed editors and food payloads consistent during the client transition.
 IF p_language IN ('fo','de') AND p_key ~ '^food:[0-9a-f-]{36}:(name|description)$' THEN
  EXECUTE format('UPDATE public.food_items SET %I=$1 WHERE id=$2',split_part(p_key,':',3)||'_'||p_language)
   USING btrim(p_value),split_part(p_key,':',2)::uuid;
 ELSIF p_language IN ('fo','de') AND p_key ~ '^venue:[0-9a-f-]{36}:welcome$' THEN
  EXECUTE format('UPDATE public.event_locations SET %I=$1 WHERE id=$2','welcome_'||p_language)
   USING nullif(btrim(p_value),''),split_part(p_key,':',2)::uuid;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_translation(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_translation(text,text,text) TO authenticated;
CREATE FUNCTION public.admin_save_translations(p_changes jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE change jsonb;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes)>300 THEN RAISE EXCEPTION 'Invalid translations'; END IF;
 FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  PERFORM public.admin_save_translation(change->>'key',change->>'language',change->>'value');
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_translations(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_translations(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.backup_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_item_types','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'public.food_item_translations','public.food_category_translations','public.food_type_translations','public.venue_translations','public.session_translations','public.event_translations','public.translation_overrides','app_private.invitation_code_registry']::text[]
$$;

CREATE FUNCTION app_private.sync_legacy_translation_columns() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE code text; record jsonb:=to_jsonb(NEW); old_record jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN old_record:=to_jsonb(OLD); END IF;
 FOREACH code IN ARRAY ARRAY['fo','de'] LOOP
  IF TG_TABLE_NAME='food_items' THEN
   IF TG_OP='INSERT' OR record->('name_'||code) IS DISTINCT FROM old_record->('name_'||code) THEN
    PERFORM app_private.store_translation('food:'||NEW.id||':name',code,coalesce(record->>('name_'||code),''));
   END IF;
   IF TG_OP='INSERT' OR record->('description_'||code) IS DISTINCT FROM old_record->('description_'||code) THEN
    PERFORM app_private.store_translation('food:'||NEW.id||':description',code,coalesce(record->>('description_'||code),''));
   END IF;
  ELSIF TG_OP='INSERT' OR record->('welcome_'||code) IS DISTINCT FROM old_record->('welcome_'||code) THEN
   PERFORM app_private.store_translation('venue:'||NEW.id||':welcome',code,coalesce(record->>('welcome_'||code),''));
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.sync_legacy_translation_columns() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_food_translations AFTER INSERT OR UPDATE OF name_fo,name_de,description_fo,description_de ON public.food_items
 FOR EACH ROW EXECUTE FUNCTION app_private.sync_legacy_translation_columns();
CREATE TRIGGER sync_venue_translations AFTER INSERT OR UPDATE OF welcome_fo,welcome_de ON public.event_locations
 FOR EACH ROW EXECUTE FUNCTION app_private.sync_legacy_translation_columns();
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261107120915_translated_venue_editor.sql
BEGIN;
-- Install before the new frontend so venue details and translations save atomically.
CREATE FUNCTION public.admin_save_venue_with_translations(p_id uuid,p_values jsonb,p_translations jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE venue_id uuid; translation record;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_translations) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid venue translations'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_translations))>300 THEN RAISE EXCEPTION 'Too many translations in one save'; END IF;
 venue_id:=public.admin_save_venue(p_id,p_values);
 FOR translation IN SELECT key,value FROM jsonb_each(p_translations) LOOP
  IF jsonb_typeof(translation.value) IS DISTINCT FROM 'string' OR length(translation.value #>> '{}')>4000 THEN
   RAISE EXCEPTION 'Welcome message too long (maximum 4000 characters per language)';
  END IF;
  PERFORM public.admin_save_translation('venue:'||venue_id||':welcome',translation.key,translation.value #>> '{}');
 END LOOP;
 RETURN venue_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_venue_with_translations(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_venue_with_translations(uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261107120916_retire_legacy_language_columns.sql
BEGIN;
-- Apply after the canonical-field frontend has deployed. Fail rather than discard divergent text.
LOCK TABLE public.food_items,public.event_locations,public.food_item_translations,public.venue_translations IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM public.food_items f
  CROSS JOIN LATERAL(VALUES('fo',f.name_fo,f.description_fo),('de',f.name_de,f.description_de)) old(language,name,comment)
  LEFT JOIN public.food_item_translations t ON t.food_item_id=f.id AND t.language_code=old.language
  WHERE nullif(btrim(old.name),'') IS DISTINCT FROM t.name OR nullif(btrim(old.comment),'') IS DISTINCT FROM t.user_comment
 ) OR EXISTS (
  SELECT 1 FROM public.event_locations v
  CROSS JOIN LATERAL(VALUES('fo',v.welcome_fo),('de',v.welcome_de)) old(language,message)
  LEFT JOIN public.venue_translations t ON t.venue_id=v.id AND t.language_code=old.language
  WHERE nullif(btrim(old.message),'') IS DISTINCT FROM t.welcome_message
 ) THEN RAISE EXCEPTION 'Legacy translations differ from normalized storage; reconcile before dropping columns'; END IF;
END $$;
-- Preserve the existing label for historical records whose English source was missing.
UPDATE public.food_items SET name_en=coalesce(nullif(btrim(name_fo),''),nullif(btrim(name_de),'')) WHERE nullif(btrim(name_en),'') IS NULL;
ALTER TABLE public.food_items ALTER COLUMN name_en SET NOT NULL;
ALTER TABLE public.food_items ADD CONSTRAINT food_items_source_name_nonempty CHECK(btrim(name_en)<>'');

CREATE OR REPLACE FUNCTION public.admin_save_venue(p_id uuid, p_values jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid:=p_id;v_archived boolean:=coalesce((p_values->>'archived')::boolean,false);
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF nullif(btrim(p_values->>'name'),'') IS NULL OR length(p_values->>'name')>140 OR length(coalesce(p_values->>'address',''))>1000 OR length(coalesce(p_values->>'notes',''))>2000 OR length(coalesce(p_values->>'map_url',''))>2000 THEN RAISE EXCEPTION 'Enter valid venue details';END IF;
 IF length(coalesce(p_values->>'welcome_fo',''))>4000 OR length(coalesce(p_values->>'welcome_en',''))>4000 OR length(coalesce(p_values->>'welcome_de',''))>4000 THEN RAISE EXCEPTION 'Welcome message too long (maximum 4000 characters per language)';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_values->>'timezone') THEN RAISE EXCEPTION 'Invalid venue timezone';END IF;
 IF nullif(p_values->>'map_url','') IS NOT NULL AND p_values->>'map_url' !~ '^https://[^ /]+' THEN RAISE EXCEPTION 'Map link must use HTTPS';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF v_id IS NOT NULL THEN
 PERFORM 1 FROM public.event_locations WHERE id=v_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Venue not found';END IF;
 IF v_archived AND EXISTS(SELECT 1 FROM public.event_sessions WHERE location_id=v_id AND is_active) THEN RAISE EXCEPTION 'Move or deactivate linked sessions before archiving this venue';END IF;
 ELSE INSERT INTO public.event_locations(name) VALUES(btrim(p_values->>'name')) RETURNING id INTO v_id;END IF;
 UPDATE public.event_locations SET name=btrim(p_values->>'name'),address=nullif(btrim(p_values->>'address'),''),map_url=nullif(btrim(p_values->>'map_url'),''),notes=nullif(btrim(p_values->>'notes'),''),timezone=p_values->>'timezone',welcome_en=CASE WHEN p_values ? 'welcome_en' THEN nullif(btrim(p_values->>'welcome_en'),'') ELSE welcome_en END,country_code=nullif(upper(btrim(p_values->>'country_code')),''),archived_at=CASE WHEN v_archived THEN coalesce(archived_at,now()) ELSE NULL END WHERE id=v_id;
 IF p_values ? 'welcome_fo' THEN
  PERFORM app_private.store_translation('venue:'||v_id||':welcome','fo',coalesce(p_values->>'welcome_fo',''));
 END IF;
 IF p_values ? 'welcome_de' THEN
  PERFORM app_private.store_translation('venue:'||v_id||':welcome','de',coalesce(p_values->>'welcome_de',''));
 END IF;
 RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_move_food_item(p_food_item_id uuid, p_direction integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_category text;v_order uuid[];v_position integer;v_target integer;v_tmp uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(19421,7745);
 SELECT category INTO v_category FROM public.food_items WHERE id=p_food_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
 SELECT array_agg(id ORDER BY sort_order,lower(name_en),id) INTO v_order FROM public.food_items
 WHERE category IS NOT DISTINCT FROM v_category;
 v_position:=array_position(v_order,p_food_item_id);v_target:=v_position+p_direction;
 IF v_target<1 OR v_target>array_length(v_order,1) THEN RETURN; END IF;
 v_tmp:=v_order[v_position];v_order[v_position]:=v_order[v_target];v_order[v_target]:=v_tmp;
 UPDATE public.food_items f SET sort_order=ordered.ordinality::integer,updated_at=now()
 FROM unnest(v_order) WITH ORDINALITY AS ordered(id,ordinality) WHERE f.id=ordered.id;
END $function$;

-- Compatibility JSON fields come from normalized rows; no duplicate columns remain.
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_household uuid; v_result jsonb;
BEGIN
 SELECT h.id INTO v_household FROM public.households h
 WHERE h.archived_at IS NULL AND h.invite_code=p_code AND h.food=true
   AND EXISTS(SELECT 1 FROM public.event_settings e WHERE e.id=1 AND e.is_published);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
 'confirmed',(SELECT food_confirmed FROM public.households WHERE id=v_household),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'category',f.category,'recipe_text',f.recipe_text,'quantity_type',f.quantity_type,
   'name_fo',translation_fo.name,'name_en',f.name_en,'name_de',translation_de.name,
   'description_fo',translation_fo.user_comment,'description_en',f.description_en,'description_de',translation_de.user_comment,
   'quantity_needed',f.quantity_needed,
   'claimed_total',coalesce((SELECT sum(c.quantity) FROM public.food_claims c WHERE c.food_item_id=f.id),0))
   ORDER BY coalesce(fc.sort_order,2147483647),lower(coalesce(f.category,'')),f.sort_order,lower(f.name_en),f.id)
   FROM public.food_items f
   LEFT JOIN public.food_item_translations translation_fo ON translation_fo.food_item_id=f.id AND translation_fo.language_code='fo'
   LEFT JOIN public.food_item_translations translation_de ON translation_de.food_item_id=f.id AND translation_de.language_code='de'
   LEFT JOIN public.food_categories fc ON fc.name=f.category WHERE (f.active AND app_private.food_venue_eligible(v_household,f.venue_ids) AND f.quantity_needed>coalesce((SELECT sum(q.quantity) FROM public.food_claims q WHERE q.food_item_id=f.id),0)) OR EXISTS(SELECT 1 FROM public.food_claims own WHERE own.food_item_id=f.id AND own.household_id=v_household)),'[]'::jsonb),
 'claims',coalesce((SELECT jsonb_agg(jsonb_build_object('food_item_id',c.food_item_id,'quantity',c.quantity,'notes',c.notes))
   FROM public.food_claims c WHERE c.household_id=v_household),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_save_translation(p_key text, p_language text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_languages WHERE language_code=p_language AND enabled) THEN RAISE EXCEPTION 'Choose an enabled language'; END IF;
 PERFORM app_private.store_translation(p_key,p_language,p_value);
END $function$;

DROP TRIGGER sync_food_translations ON public.food_items;
DROP TRIGGER sync_venue_translations ON public.event_locations;
DROP FUNCTION app_private.sync_legacy_translation_columns();
ALTER TABLE public.food_items DROP COLUMN name_fo,DROP COLUMN name_de,DROP COLUMN description_fo,DROP COLUMN description_de;
ALTER TABLE public.event_locations DROP COLUMN welcome_fo,DROP COLUMN welcome_de;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261107170943_other_category_controls.sql
BEGIN;

-- Category changes use the same live-admin guard and ordering lock as Other saves.
CREATE FUNCTION public.admin_move_other_category(p_category_id uuid,p_direction integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];position integer;target integer;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO ids FROM public.other_categories;
 position:=array_position(ids,p_category_id);
 IF position IS NULL THEN RAISE EXCEPTION 'Category not found';END IF;
 target:=position+p_direction;
 IF target BETWEEN 1 AND cardinality(ids) THEN
  ids[position]:=ids[target];ids[target]:=p_category_id;
  UPDATE public.other_categories category SET sort_order=ordering.ordinality::integer,updated_at=clock_timestamp()
  FROM unnest(ids) WITH ORDINALITY AS ordering(id,ordinality)
  WHERE category.id=ordering.id AND (category.sort_order IS DISTINCT FROM ordering.ordinality::integer OR category.id IN (p_category_id,ids[position]));
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(category) ORDER BY sort_order,lower(name),id),'[]'::jsonb) FROM public.other_categories category);
END $$;

CREATE FUNCTION public.admin_delete_other_category(p_category_id uuid,p_expected_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE category public.other_categories%ROWTYPE;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO category FROM public.other_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF category.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Category changed; reload before deleting';END IF;
 IF EXISTS(SELECT 1 FROM public.other_items WHERE category_id=p_category_id) THEN RAISE EXCEPTION 'Move items to another category before deleting this category.';END IF;
 DELETE FROM public.other_categories WHERE id=p_category_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_move_other_category(uuid,integer),public.admin_delete_other_category(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_other_category(uuid,integer),public.admin_delete_other_category(uuid,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261107171842_venue_ordering.sql
BEGIN;

CREATE FUNCTION public.admin_move_venue(p_venue_id uuid,p_direction integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];position integer;target integer;
BEGIN
 PERFORM app_private.require_live_session();
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO ids FROM public.event_locations;
 position:=array_position(ids,p_venue_id);
 IF position IS NULL THEN RAISE EXCEPTION 'Venue not found';END IF;
 target:=position+p_direction;
 IF target<1 OR target>cardinality(ids) THEN RETURN;END IF;
 ids[position]:=ids[target];ids[target]:=p_venue_id;
 UPDATE public.event_locations venue SET sort_order=ordering.ordinality::integer
 FROM unnest(ids) WITH ORDINALITY AS ordering(id,ordinality)
 WHERE venue.id=ordering.id AND venue.sort_order IS DISTINCT FROM ordering.ordinality::integer;
END $$;
REVOKE ALL ON FUNCTION public.admin_move_venue(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_venue(uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261107230702_restore_safe_updates.sql
-- Retain safeupdate protection while explicitly scoping seed replacement and restored-row validation.
BEGIN;
CREATE OR REPLACE FUNCTION app_private.restore_backup(b jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE t text;row jsonb;rows jsonb;payload jsonb:=b->'payload';report jsonb;has_rows boolean;cols text;fk record;source_id text;target_id uuid;identity jsonb;mapping jsonb:='{}';rec record;seq text;next_id bigint;changed integer:=0;
BEGIN
 report:=app_private.validate_backup(b);
 -- Validate reachability before loading rows with application triggers suspended.
 -- UNION deduplicates IDs: malformed cycles (including a branch pointing into a
 -- cycle) cannot make the older recursive parent trigger loop indefinitely.
 WITH RECURSIVE h AS (SELECT id,parent_id FROM jsonb_populate_recordset(NULL::public.households,payload->'tables'->'public.households')),
 reachable(id) AS (SELECT id FROM h WHERE parent_id IS NULL UNION SELECT h.id FROM h JOIN reachable p ON h.parent_id=p.id)
 SELECT (SELECT count(*) FROM h)<>(SELECT count(*) FROM reachable) INTO has_rows;
 IF has_rows THEN RAISE EXCEPTION 'Household hierarchy cycle, duplicate ID or missing parent';END IF;

 -- Consistent lock order, shared with existing management operations. Keep the event closed.
 PERFORM pg_advisory_xact_lock(19421,7744);
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',t);END LOOP;
 IF EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) THEN RAISE EXCEPTION 'Restore destination must be unpublished';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF t IN ('public.event_languages','public.event_settings') THEN CONTINUE;END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',t) INTO has_rows;
  IF has_rows THEN RAISE EXCEPTION 'Restore requires an empty application destination; % contains records',t;END IF;
 END LOOP;
 -- Map foreign-key actors by the original verified email, never by user-supplied privileges.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
    source_id:=row->>fk.attname;IF source_id IS NULL OR mapping ? source_id THEN CONTINUE;END IF;
    SELECT u INTO identity FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=source_id;
    IF identity IS NULL THEN RAISE EXCEPTION 'Missing actor identity metadata';END IF;
    SELECT id INTO target_id FROM auth.users WHERE lower(email)=lower(identity->>'email') AND email_confirmed_at IS NOT NULL;
    IF target_id IS NULL THEN RAISE EXCEPTION 'Recreate and verify the historical actor account % before restoring',identity->>'email';END IF;
    mapping:=mapping||jsonb_build_object(source_id,target_id);
   END LOOP;
  END LOOP;
 END LOOP;
 -- Disable only application triggers, transactionally, so imports do not regenerate
 -- invitation codes, create synthetic history, or reject valid out-of-order parents.
 -- Foreign keys, types, unique constraints and CHECK constraints stay enforced.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER',t);END LOOP;
 DELETE FROM public.event_settings WHERE id=1;
 DELETE FROM public.event_languages WHERE language_code IN (SELECT language_code FROM public.event_languages);
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  rows:='[]';
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->t) LOOP
   FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
    source_id:=row->>fk.attname;IF source_id IS NOT NULL THEN row:=jsonb_set(row,ARRAY[fk.attname],mapping->source_id);END IF;
   END LOOP;
   IF t='public.admin_membership_audit' THEN FOREACH source_id IN ARRAY ARRAY['actor_id','subject_id'] LOOP IF mapping ? (row->>source_id) THEN row:=jsonb_set(row,ARRAY[source_id],mapping->(row->>source_id));END IF;END LOOP;END IF;
   IF t='public.households' THEN row:=row||'{"parent_id":null,"latest_rsvp_submission_id":null}'::jsonb;END IF;
   IF t='public.event_settings' THEN row:=row||'{"is_published":false}'::jsonb;END IF;
   IF t='public.admin_invitations' AND row->>'status'='pending' THEN row:=row||jsonb_build_object('status','cancelled','expires_at',clock_timestamp(),'attempt_id',gen_random_uuid());END IF;
   rows:=rows||jsonb_build_array(row);
  END LOOP;
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::%s,$1)',t,cols,cols,t) USING rows;
 END LOOP;
 -- Resolve circular household/submission references once every row exists.
 FOR row IN SELECT value FROM jsonb_array_elements(payload->'tables'->'public.households') LOOP
  UPDATE public.households SET parent_id=(row->>'parent_id')::uuid,latest_rsvp_submission_id=(row->>'latest_rsvp_submission_id')::uuid WHERE id=(row->>'id')::uuid;
 END LOOP;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER',t);END LOOP;
 -- Re-run hierarchy and language guards without changing profile values or history.
 UPDATE public.households SET parent_id=parent_id WHERE id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(payload->'tables'->'public.households'));
 UPDATE public.event_settings SET default_language=default_language,fallback_language=fallback_language WHERE id=1;
 IF EXISTS(SELECT 1 FROM public.households h WHERE (h.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.guests g WHERE g.household_id=h.id AND g.archived_at IS NULL)) AND h.invite_code IS NOT NULL) THEN RAISE EXCEPTION 'Backup contains an invalid invitation code assignment';END IF;
 IF EXISTS(SELECT 1 FROM public.households h WHERE h.invite_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_private.invitation_code_registry r WHERE r.code=h.invite_code AND r.household_id=h.id)) THEN RAISE EXCEPTION 'Invitation code registry mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE (SELECT coalesce(sum(quantity),0) FROM public.food_claims WHERE food_item_id=f.id)>f.quantity_needed) THEN RAISE EXCEPTION 'Food claims exceed available quantities';END IF;
 -- Restart identity sequences with transactional ALTER, not nontransactional setval.
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  FOR rec IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND attidentity<>'' LOOP
   seq:=pg_get_serial_sequence(t,rec.attname);EXECUTE format('SELECT coalesce(max(%I),0)+1 FROM %s',rec.attname,t) INTO next_id;
   EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
  END LOOP;
 END LOOP;
 INSERT INTO public.backup_restore_audit(actor_user_id,checksum,source_created_at,restored_counts) VALUES(auth.uid(),b->>'checksum',(payload->>'created_at')::timestamptz,payload->'counts');
 RETURN report||jsonb_build_object('restored',true,'is_published',false,'identity_mapping',mapping,'administrator_access_restored',false);
END $$;
REVOKE ALL ON FUNCTION app_private.restore_backup(jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261108141259_administrator_permissions.sql
-- Current membership and live-session checks, never user-editable JWT metadata.
BEGIN;
CREATE FUNCTION app_private.permission_preset(p text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('preset',p,'sections',jsonb_build_object('venues',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'households',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'food',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'other',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'invites',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'languages',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'settings',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END,'administrators',CASE p WHEN 'full' THEN 'edit' WHEN 'view' THEN 'view' ELSE 'none' END),'sendInvites',p='full','exportBackup',p='full','restoreBackup',p='full','revokeSessions',p='full')
$$;
CREATE FUNCTION app_private.valid_permissions(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;v jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>6 OR coalesce(p->>'preset','') NOT IN ('full','view','custom') OR jsonb_typeof(p->'sections') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p->'sections'))<>8 THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['venues','households','food','other','invites','languages','settings','administrators'] LOOP IF coalesce(p->'sections'->>k,'') NOT IN ('none','view','edit') THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['sendInvites','exportBackup','restoreBackup','revokeSessions'] LOOP IF jsonb_typeof(p->k) IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;END LOOP;
 IF p->>'preset' IN ('full','view') AND p<>app_private.permission_preset(p->>'preset') THEN RETURN false;END IF;
 IF p->'sections'->>'invites'='none' AND (p->>'sendInvites')::boolean THEN RETURN false;END IF;
 IF p->'sections'->>'administrators'='none' AND (p->>'revokeSessions')::boolean THEN RETURN false;END IF;
 RETURN true;
END $$;
ALTER TABLE public.admins ADD COLUMN access_state text NOT NULL DEFAULT 'active' CHECK(access_state IN ('active','suspended','restored'));
ALTER TABLE public.admins ADD COLUMN access_permissions jsonb NOT NULL DEFAULT app_private.permission_preset('full') CHECK(app_private.valid_permissions(access_permissions));
CREATE TABLE app_private.admin_session_revocations(session_id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),revoked_by uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE app_private.pending_admin_permissions(invitation_id uuid PRIMARY KEY REFERENCES public.admin_invitations(id),permissions jsonb NOT NULL CHECK(app_private.valid_permissions(permissions)));
CREATE TABLE app_private.admin_access_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL REFERENCES auth.users(id),subject_id uuid NOT NULL REFERENCES auth.users(id),action text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX admin_session_revocations_user ON app_private.admin_session_revocations(user_id);
CREATE INDEX admin_session_revocations_actor ON app_private.admin_session_revocations(revoked_by);
CREATE INDEX admin_access_audit_actor ON app_private.admin_access_audit(actor_id,created_at DESC);
CREATE INDEX admin_access_audit_subject ON app_private.admin_access_audit(subject_id,created_at DESC);
ALTER TABLE app_private.admin_session_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.pending_admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.admin_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.admin_session_revocations,app_private.pending_admin_permissions,app_private.admin_access_audit FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_admin_access BEFORE UPDATE OR DELETE ON app_private.admin_access_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();
-- Preserve the intended Full access of invitations sent before this migration.
INSERT INTO app_private.pending_admin_permissions SELECT id,app_private.permission_preset('full') FROM public.admin_invitations WHERE status='pending';
CREATE FUNCTION app_private.session_is_live() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 sid:=nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid;
 RETURN auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=sid AND s.user_id=auth.uid() AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>statement_timestamp())) AND NOT EXISTS(SELECT 1 FROM app_private.admin_session_revocations r WHERE r.session_id=sid);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.session_is_live() AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid() AND access_state='active')
$$;
CREATE OR REPLACE FUNCTION app_private.require_live_session() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT app_private.session_is_live() THEN RAISE EXCEPTION 'Administrator session revoked or expired. Sign in again.' USING ERRCODE='PT401';END IF;RETURN auth.uid();
END $$;
CREATE FUNCTION public.admin_has_permission(p_section text,p_level text DEFAULT 'view') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_admin() AND coalesce((SELECT CASE WHEN p_section='full' THEN access_permissions->>'preset'='full' WHEN p_section IN ('sendInvites','exportBackup','restoreBackup','revokeSessions') THEN coalesce((access_permissions->>p_section)::boolean,false) WHEN p_level='edit' THEN access_permissions->'sections'->>p_section='edit' WHEN p_level='view' THEN access_permissions->'sections'->>p_section IN ('view','edit') ELSE false END FROM public.admins WHERE user_id=auth.uid()),false)
$$;
CREATE FUNCTION app_private.require_permission(p_section text,p_level text DEFAULT 'view') RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 IF NOT public.admin_has_permission(p_section,p_level) THEN RAISE EXCEPTION 'This action is not allowed by your administrator permissions.' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION app_private.require_admin_operation(op text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE section text;level text:='edit';
BEGIN
 IF op IN ('admin_record_delivery_sent','admin_confirm_invitation_sent') AND public.admin_has_permission('sendInvites') THEN PERFORM app_private.require_permission('sendInvites');RETURN;END IF;
 section:=CASE
 WHEN op IN ('admin_list_members','admin_list_invitations') THEN 'administrators'
 WHEN op IN ('admin_prepare_invitation','admin_cancel_invitation','admin_rename_member','admin_add_existing_user','admin_remove_member') THEN 'administrators'
 WHEN op IN ('admin_save_household','admin_save_household_with_food','admin_create_guest','admin_update_guest','admin_move_guest','admin_move_household','admin_set_household_parent','admin_save_contact','admin_set_archived','admin_set_food_access') THEN 'households'
 WHEN op IN ('admin_authorize_late_rsvp','admin_correct_rsvp','admin_reopen_household_rsvp','admin_save_session_assignments','admin_edit_session_households','admin_save_delivery','admin_record_delivery_sent','admin_confirm_invitation_sent') THEN 'invites'
 WHEN op='admin_session_invitation_locks' THEN 'invites'
 WHEN op IN ('admin_save_venue','admin_save_venue_with_translations','admin_save_session','admin_move_session','admin_move_venue') THEN 'venues'
 WHEN op IN ('admin_add_venue_food','admin_edit_venue_food','admin_move_food_category','admin_move_food_item','admin_rename_food_category','admin_set_food_category','admin_set_food_selection') THEN 'food'
 WHEN op IN ('admin_save_food_translations','admin_save_language','admin_set_language_preferences','admin_move_language','admin_save_translation','admin_save_translations') THEN 'languages'
 WHEN op IN ('admin_save_other','admin_save_other_category','admin_move_other_category','admin_delete_other_category') THEN 'other'
 WHEN op='admin_export_backup' THEN 'exportBackup'
 WHEN op IN ('admin_preview_backup','admin_restore_backup') THEN 'restoreBackup'
 ELSE 'full' END;
 IF op IN ('admin_list_members','admin_list_invitations','admin_session_invitation_locks') THEN level:='view';END IF;
 PERFORM app_private.require_permission(section,level);
END $$;
-- Inject a guard into each existing administrator RPC without changing its signature,
-- dependencies, historical validation or grants. The invoker-only atomic household
-- wrapper delegates to two separately guarded RPCs. Invitation acceptance is a separate,
-- non-member operation; provider completion is service-role-only.
DO $$ DECLARE f record;definition text; BEGIN
 FOR f IN SELECT p.oid,p.proname,p.prosecdef FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'admin_%' AND p.proname NOT IN ('admin_has_permission','admin_my_invitation','admin_accept_invitation','admin_finish_invitation','admin_record_session') LOOP
  IF NOT f.prosecdef THEN IF f.proname='admin_save_household_with_food' THEN CONTINUE;ELSE RAISE EXCEPTION 'Unreviewed invoker administrator RPC: %',f.proname;END IF;END IF;
  definition:=pg_get_functiondef(f.oid);
  IF definition NOT LIKE '%LANGUAGE plpgsql%' THEN RAISE EXCEPTION 'Unreviewed administrator RPC language: %',f.proname;END IF;
  definition:=regexp_replace(definition,'\mBEGIN\M',format('BEGIN PERFORM app_private.require_admin_operation(%L);',f.proname),'i');EXECUTE definition;
 END LOOP;
END $$;
-- Direct table reads and writes obey the same section permissions. Restrictive
-- policies are ANDed with existing membership policies, including future ones.
CREATE FUNCTION app_private.table_section(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN t IN ('households','guests','household_contacts','relation_groups','management_audit') THEN 'households' WHEN t IN ('event_locations','event_sessions','event_configuration_audit') THEN 'venues' WHEN t IN ('food_categories','food_items','food_claims','food_item_types') THEN 'food' WHEN t IN ('other_items','other_categories') THEN 'other' WHEN t IN ('event_languages','event_content','event_translations','translation_overrides','food_item_translations','food_category_translations','venue_translations','session_translations','food_type_translations') THEN 'languages' WHEN t IN ('event_settings') THEN 'settings' WHEN t IN ('rsvp_submissions','guest_session_responses','household_session_defaults','guest_session_overrides','invitation_send_queue','invitation_deliveries','invitation_delivery_audit','rsvp_household_audit','rsvp_response_audit','message_templates','invitation_access_audit') THEN 'invites' WHEN t IN ('admins','admin_membership_audit','admin_invitations','admin_invitation_audit','admin_session_audit') THEN 'administrators' ELSE 'full' END
$$;
DO $$ DECLARE t record;s text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity LOOP
  s:=app_private.table_section(t.tablename);
  EXECUTE format('CREATE POLICY section_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.admin_has_permission(%L)))',t.tablename,s);
  EXECUTE format('CREATE POLICY section_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.admin_has_permission(%L,''edit'')))',t.tablename,s);
  EXECUTE format('CREATE POLICY section_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.admin_has_permission(%L,''edit''))) WITH CHECK ((SELECT public.admin_has_permission(%L,''edit'')))',t.tablename,s,s);
  EXECUTE format('CREATE POLICY section_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.admin_has_permission(%L,''edit'')))',t.tablename,s);
 END LOOP;
END $$;
CREATE FUNCTION public.admin_get_access() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 RETURN (SELECT jsonb_build_object('user_id',a.user_id,'state',a.access_state,'permissions',a.access_permissions,'session_id',nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id') FROM public.admins a WHERE user_id=auth.uid());
END $$;
CREATE OR REPLACE FUNCTION public.admin_list_members() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('administrators');RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',a.name,'email',u.email,'created_at',a.created_at,'access_state',a.access_state,'access_permissions',a.access_permissions) ORDER BY a.created_at) FROM public.admins a JOIN auth.users u ON u.id=a.user_id),'[]');
END $$;
CREATE FUNCTION public.admin_save_access(p_user_id uuid,p_permissions jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old jsonb;
BEGIN
 PERFORM app_private.require_permission('full');IF NOT app_private.valid_permissions(p_permissions) THEN RAISE EXCEPTION 'Invalid access permissions';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);SELECT access_permissions INTO old FROM public.admins WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;IF old IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Access changed. Refresh before saving.' USING ERRCODE='40001';END IF;
 IF old->>'preset'='full' AND p_permissions->>'preset'<>'full' AND EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_user_id AND access_state='active') AND (SELECT count(*) FROM public.admins WHERE access_state='active' AND access_permissions->>'preset'='full')<=1 THEN RAISE EXCEPTION 'Keep at least one active Full administrator';END IF;
 UPDATE public.admins SET access_permissions=p_permissions WHERE user_id=p_user_id;
 INSERT INTO app_private.admin_access_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),p_user_id,'permissions_changed',jsonb_build_object('before',old,'after',p_permissions));
END $$;
CREATE FUNCTION public.admin_set_member_state(p_user_id uuid,p_state text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.admins%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');IF p_state NOT IN ('active','suspended') OR p_state IS NULL THEN RAISE EXCEPTION 'Invalid administrator state';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);SELECT * INTO a FROM public.admins WHERE user_id=p_user_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;
 IF a.access_permissions->>'preset'='full' AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can change a Full administrator' USING ERRCODE='42501';END IF;
 IF p_state='suspended' AND a.access_state='active' AND a.access_permissions->>'preset'='full' AND (SELECT count(*) FROM public.admins WHERE access_state='active' AND access_permissions->>'preset'='full')<=1 THEN RAISE EXCEPTION 'Keep at least one active Full administrator';END IF;
 IF p_state='active' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'A verified Auth account is required';END IF;
 UPDATE public.admins SET access_state=p_state WHERE user_id=p_user_id;
 IF p_state='suspended' THEN INSERT INTO app_private.admin_session_revocations(session_id,user_id,revoked_by) SELECT id,user_id,auth.uid() FROM auth.sessions WHERE user_id=p_user_id ON CONFLICT DO NOTHING;END IF;
 INSERT INTO app_private.admin_access_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),p_user_id,p_state,jsonb_build_object('before',a.access_state));
END $$;
CREATE OR REPLACE FUNCTION public.admin_remove_member(p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.admins%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');PERFORM pg_advisory_xact_lock(42319,11);SELECT * INTO a FROM public.admins WHERE user_id=p_user_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;
 IF a.access_state='active' THEN RAISE EXCEPTION 'Suspend this administrator before removal';END IF;
 IF a.access_permissions->>'preset'='full' AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can remove a Full administrator' USING ERRCODE='42501';END IF;
 DELETE FROM public.admins WHERE user_id=p_user_id;
 INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),p_user_id,'remove',jsonb_build_object('name',a.name));
END $$;
CREATE FUNCTION public.admin_lookup_verified_user(p_email text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('administrators','edit');RETURN (SELECT jsonb_build_object('email',u.email,'verified',true) FROM auth.users u WHERE lower(u.email)=lower(btrim(p_email)) AND u.email_confirmed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=u.id));
END $$;
CREATE OR REPLACE FUNCTION public.admin_add_existing_user(p_email text,p_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Enter a display name';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);SELECT id INTO target FROM auth.users WHERE lower(email)=lower(btrim(p_email)) AND email_confirmed_at IS NOT NULL;
 IF target IS NULL THEN RAISE EXCEPTION 'No eligible verified Auth account found';END IF;
 INSERT INTO public.admins(user_id,name,access_permissions) VALUES(target,btrim(p_name),app_private.permission_preset('view'));
 INSERT INTO public.admin_membership_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),target,'add',jsonb_build_object('name',btrim(p_name),'source','verified_manual','access','view'));
 RETURN jsonb_build_object('user_id',target);
END $$;
CREATE FUNCTION public.admin_list_sessions() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'name',a.name,'created_at',s.created_at,'last_activity',coalesce(to_jsonb(s)->>'refreshed_at',to_jsonb(s)->>'updated_at',s.created_at::text),'user_agent',left(coalesce(to_jsonb(s)->>'user_agent',''),300),'current',s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) ORDER BY s.created_at DESC) FROM auth.sessions s JOIN public.admins a ON a.user_id=s.user_id WHERE a.access_state='active' AND (s.user_id=auth.uid() OR public.admin_has_permission('revokeSessions')) AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>statement_timestamp()) AND NOT EXISTS(SELECT 1 FROM app_private.admin_session_revocations r WHERE r.session_id=s.id)),'[]');
END $$;
CREATE FUNCTION public.admin_revoke_session(p_session_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 SELECT user_id INTO target FROM auth.sessions WHERE id=p_session_id AND user_id IN(SELECT user_id FROM public.admins);IF NOT FOUND THEN RAISE EXCEPTION 'Session not found';END IF;
 IF target<>auth.uid() THEN PERFORM app_private.require_permission('revokeSessions');END IF;
 INSERT INTO app_private.admin_session_revocations(session_id,user_id,revoked_by) VALUES(p_session_id,target,auth.uid()) ON CONFLICT DO NOTHING;
 INSERT INTO app_private.admin_access_audit(actor_id,subject_id,action,details) VALUES(auth.uid(),target,'session_revoked',jsonb_build_object('session_id',p_session_id));
END $$;
CREATE FUNCTION public.admin_revoke_other_sessions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 FOR s IN SELECT id FROM auth.sessions WHERE user_id=auth.uid() AND id<>(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid LOOP PERFORM public.admin_revoke_session(s.id);END LOOP;
END $$;
-- Accepted invitations inherit explicitly assigned access, defaulting to View only.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.admin_accept_invitation(uuid)'::regprocedure);
 d:=replace(d,'INSERT INTO public.admins(user_id,name) VALUES(actor,i.name)','INSERT INTO public.admins(user_id,name,access_permissions) VALUES(actor,i.name,coalesce((SELECT permissions FROM app_private.pending_admin_permissions WHERE invitation_id=i.id),app_private.permission_preset(''view'')))');
 d:=replace(d,'EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by)','EXISTS(SELECT 1 FROM public.admins WHERE user_id=i.invited_by AND access_state=''active'' AND access_permissions->''sections''->>''administrators''=''edit'')');EXECUTE d;
END $$;
CREATE FUNCTION app_private.reset_invitation_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR (NEW.status='pending' AND OLD.status<>'pending') THEN INSERT INTO app_private.pending_admin_permissions(invitation_id,permissions) VALUES(NEW.id,app_private.permission_preset('view')) ON CONFLICT(invitation_id) DO UPDATE SET permissions=excluded.permissions;END IF;RETURN NEW;
END $$;
CREATE TRIGGER invitation_access_default AFTER INSERT OR UPDATE OF status ON public.admin_invitations FOR EACH ROW EXECUTE FUNCTION app_private.reset_invitation_access();
CREATE FUNCTION public.admin_set_invitation_access(p_id uuid,p_permissions jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('full');IF NOT app_private.valid_permissions(p_permissions) THEN RAISE EXCEPTION 'Invalid access permissions';END IF;
 PERFORM pg_advisory_xact_lock(42319,11);PERFORM 1 FROM public.admin_invitations WHERE id=p_id AND status='pending' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Pending invitation not found';END IF;
 INSERT INTO app_private.pending_admin_permissions VALUES(p_id,p_permissions) ON CONFLICT(invitation_id) DO UPDATE SET permissions=excluded.permissions;
 INSERT INTO public.admin_invitation_audit(invitation_id,actor_user_id,action,email,details) SELECT id,auth.uid(),'permissions_changed',email,jsonb_build_object('permissions',p_permissions) FROM public.admin_invitations WHERE id=p_id;
END $$;
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.admin_list_invitations()'::regprocedure);d:=replace(d,'''created_at'',created_at)', '''created_at'',created_at,''access_permissions'',coalesce((SELECT permissions FROM app_private.pending_admin_permissions WHERE invitation_id=public.admin_invitations.id),app_private.permission_preset(''view'')))');EXECUTE d;
END $$;
-- Restored membership references are never privileged by imported JSON. Existing
-- destination membership is preserved; other verified accounts appear Disabled.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('app_private.restore_backup(jsonb)'::regprocedure);
 d:=replace(d,'RETURN report||jsonb_build_object',E'FOR identity IN SELECT value FROM jsonb_array_elements(coalesce(payload->''administrator_reference'',''[]''::jsonb)) LOOP\n SELECT u.id INTO target_id FROM auth.users u JOIN jsonb_array_elements(payload->''identities'') i ON lower(i->>''email'')=lower(u.email) WHERE i->>''id''=identity->>''user_id'' AND u.email_confirmed_at IS NOT NULL;\n IF target_id IS NOT NULL THEN INSERT INTO public.admins(user_id,name,access_state,access_permissions) VALUES(target_id,left(coalesce(nullif(identity->>''name'',''''),''Restored administrator''),120),''restored'',app_private.permission_preset(''view'')) ON CONFLICT(user_id) DO NOTHING;END IF;\n END LOOP;\n RETURN report||jsonb_build_object');EXECUTE d;
END $$;
-- Restrict helper privileges. Only the small boolean permission function is exposed
-- for RLS; all mutation and inspection RPCs validate live sessions internally.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('admin_has_permission','admin_get_access','admin_save_access','admin_set_member_state','admin_lookup_verified_user','admin_list_sessions','admin_revoke_session','admin_revoke_other_sessions','admin_set_invitation_access') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);END LOOP;
END $$;
CREATE FUNCTION public.admin_load_data() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h boolean:=public.admin_has_permission('households');i boolean:=public.admin_has_permission('invites');f boolean:=public.admin_has_permission('food');v boolean:=public.admin_has_permission('venues');l boolean:=public.admin_has_permission('languages');o boolean:=public.admin_has_permission('other');s boolean:=public.admin_has_permission('settings');result jsonb;t text;k text;rows jsonb;
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 result:=jsonb_build_object(
 'settings',coalesce((SELECT CASE WHEN s THEN to_jsonb(e) ELSE jsonb_build_object('id',e.id,'event_name',e.event_name,'event_date',e.event_date,'timezone',e.timezone,'default_language',e.default_language,'fallback_language',e.fallback_language,'is_published',e.is_published) END FROM public.event_settings e WHERE id=1),'null'),
 'languages',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_languages a),'[]'),
 'households',CASE WHEN h THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.households a),'[]') WHEN i THEN coalesce((SELECT jsonb_agg(to_jsonb(a)-'notes'-'postal_address'-'food'-'food_confirmed'-'stuff'-'things') FROM public.households a),'[]') WHEN f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'household_name',a.household_name,'food',a.food,'food_confirmed',a.food_confirmed,'parent_id',a.parent_id,'sort_order',a.sort_order,'archived_at',a.archived_at,'language',a.language,'side',a.side,'relation_group_id',a.relation_group_id)) FROM public.households a),'[]') ELSE '[]'::jsonb END,
 'guests',CASE WHEN h THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.guests a),'[]') WHEN i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'household_id',a.household_id,'first_name',a.first_name,'last_name',a.last_name,'language',a.language,'archived_at',a.archived_at)) FROM public.guests a),'[]') ELSE '[]'::jsonb END,
 'sessions',CASE WHEN v OR l THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_sessions a),'[]') WHEN h OR i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'location_id',a.location_id,'is_active',a.is_active,'requires_rsvp',a.requires_rsvp,'sort_order',a.sort_order)) FROM public.event_sessions a),'[]') ELSE '[]'::jsonb END,
 'locations',CASE WHEN v OR l THEN coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_locations a),'[]') WHEN h OR i OR f THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'timezone',a.timezone,'archived_at',a.archived_at,'sort_order',a.sort_order)) FROM public.event_locations a),'[]') ELSE '[]'::jsonb END,
 'content',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.event_content a WHERE l OR a.content_key LIKE 'ui:%' OR (f AND (a.content_key LIKE 'food:%' OR a.content_key LIKE 'food-category:%')) OR (v AND (a.content_key LIKE 'venue:%' OR a.content_key LIKE 'session:%'))),'[]'));
 FOR t,k IN SELECT * FROM (VALUES ('food_items','food'),('food_claims','claims'),('food_categories','foodCategories'),('food_item_types','foodTypes'),('rsvp_submissions','submissions'),('household_session_defaults','defaults'),('guest_session_overrides','overrides'),('guest_session_responses','responses'),('relation_groups','relationGroups'),('household_contacts','contacts'),('invitation_send_queue','queue'),('invitation_deliveries','deliveries'),('other_items','tasks'),('other_categories','otherCategories')) x(t,k) LOOP
  rows:='[]';
  IF (t IN ('food_items','food_categories','food_item_types') AND (f OR l)) OR (t='food_claims' AND f) OR (t IN ('household_session_defaults','guest_session_overrides') AND (i OR f)) OR (t IN ('rsvp_submissions','guest_session_responses','invitation_send_queue','invitation_deliveries') AND i) OR (t='relation_groups' AND (h OR i OR f)) OR (t='household_contacts' AND (h OR i)) OR (t IN ('other_items','other_categories') AND o) THEN EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(a)),''[]''::jsonb) FROM public.%I a',t) INTO rows;END IF;
  IF t='food_items' AND l AND NOT f THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'category',a.category,'name_en',a.name_en,'description_en',a.description_en,'quantity_type',a.quantity_type,'sort_order',a.sort_order,'active',a.active)),'[]'::jsonb) INTO rows FROM public.food_items a;END IF;
  result:=result||jsonb_build_object(k,rows);
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_load_data() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_load_data() TO authenticated;

CREATE FUNCTION public.admin_update_member(p_user_id uuid,p_name text,p_permissions jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.admins%ROWTYPE;
BEGIN
 PERFORM app_private.require_permission('administrators','edit');PERFORM pg_advisory_xact_lock(42319,11);
 SELECT * INTO a FROM public.admins WHERE user_id=p_user_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found';END IF;
 IF a.access_permissions IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Access changed. Refresh before saving.' USING ERRCODE='40001';END IF;
 IF a.access_permissions->>'preset'='full' AND NOT public.admin_has_permission('full') THEN RAISE EXCEPTION 'Only Full administrators can change a Full administrator' USING ERRCODE='42501';END IF;
 IF p_permissions IS NOT NULL AND p_permissions IS DISTINCT FROM a.access_permissions THEN PERFORM public.admin_save_access(p_user_id,p_permissions,p_expected);END IF;
 IF p_name IS DISTINCT FROM a.name THEN PERFORM public.admin_rename_member(p_user_id,p_name);END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_update_member(uuid,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_update_member(uuid,text,jsonb,jsonb) TO authenticated;
DO $$ DECLARE d text; BEGIN
 d:=pg_get_viewdef('app_private.administration_log_entries'::regclass,true);
 EXECUTE 'CREATE OR REPLACE VIEW app_private.administration_log_entries AS '||rtrim(d,E';\n ')||' UNION ALL SELECT ''access:''||a.id::text,a.created_at,''administrators'',a.action,NULL::uuid,a.actor_id,coalesce((SELECT name FROM public.admins WHERE user_id=a.subject_id),''Former administrator''),a.details FROM app_private.admin_access_audit a';
END $$;

CREATE FUNCTION public.admin_authorize_device_send(p_queue_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('sendInvites');
 IF NOT EXISTS(SELECT 1 FROM public.invitation_send_queue q JOIN public.households h ON h.id=q.household_id WHERE q.id=p_queue_id AND q.status='ready' AND h.archived_at IS NULL AND q.invitation_code_snapshot=h.invite_code) THEN RAISE EXCEPTION 'Refresh and save this delivery again before sending';END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_authorize_device_send(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_authorize_device_send(uuid) TO authenticated;
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.admin_rename_member(uuid,text)'::regprocedure);
 d:=regexp_replace(d,'\mBEGIN\M','BEGIN IF EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_user_id AND access_permissions->>''preset''=''full'') AND NOT public.admin_has_permission(''full'') THEN RAISE EXCEPTION ''Only Full administrators can change a Full administrator'' USING ERRCODE=''42501'';END IF;','i');EXECUTE d;
END $$;

-- Synchronize the server-side catalog with the versioned UI keys.
CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $catalog$ SELECT $json${
  "Back to households": "interface.messages.back_to_households",
  "Administration": "interface.messages.administration",
  "Admin": "interface.messages.admin",
  "Event Invitation": "interface.messages.event_invitation",
  "Event dashboard": "interface.messages.event_dashboard",
  "Appearance": "interface.messages.appearance",
  "Appearance preference": "interface.messages.appearance_preference",
  "System default": "interface.messages.system_default",
  "Light": "interface.messages.light",
  "Dark": "interface.messages.dark",
  "Language": "interface.messages.language",
  "Faroese": "interface.messages.faroese",
  "English": "interface.messages.english",
  "German": "interface.messages.german",
  "Settings": "interface.messages.settings",
  "Settings sections": "interface.messages.settings_sections",
  "Main settings": "interface.messages.main_settings",
  "Event settings": "interface.messages.event_settings",
  "Administrators": "interface.messages.administrators",
  "Administrator": "interface.messages.administrator",
  "Administrator actions": "interface.messages.administrator_actions",
  "Admin sections": "interface.messages.admin_sections",
  "Overview": "interface.messages.overview",
  "Households": "interface.messages.households",
  "Guests": "interface.messages.guests",
  "Food": "food.messages.food",
  "Manage Invites": "interface.messages.manage_invites",
  "Venues": "interface.messages.venues",
  "Sessions": "interface.messages.sessions",
  "Sessions & scheduling": "interface.messages.sessions_scheduling",
  "Logs": "interface.messages.logs",
  "Back": "interface.messages.back",
  "Back to dashboard": "interface.messages.back_to_dashboard",
  "View website in a new tab": "interface.messages.view_website_in_a_new_tab",
  "Refresh data": "interface.messages.refresh_data",
  "Sign out": "interface.messages.sign_out",
  "Sign in": "interface.messages.sign_in",
  "Email": "interface.messages.email",
  "Password": "interface.messages.password",
  "PRIVATE ADMINISTRATION": "interface.messages.private_administration",
  "Welcome back.": "interface.messages.welcome_back",
  "Only approved event administrators can sign in.": "interface.messages.only_approved_event_administrators_can_sign_in",
  "Setup wizard": "interface.messages.setup_wizard",
  "New password": "interface.messages.new_password",
  "Confirm password": "interface.messages.confirm_password",
  "You’re invited.": "interface.messages.you_re_invited",
  "Accept administrator invitation": "interface.messages.accept_administrator_invitation",
  "Accepting invitation…": "interface.messages.accepting_invitation",
  "Accepting gives you access to this event’s households, guests, invitations and settings.": "interface.messages.accepting_gives_you_access_to_this_event_s_households_guests_invi",
  "Set a password of at least 12 characters for future sign-ins.": "interface.messages.set_a_password_of_at_least_12_characters_for_future_sign_ins",
  "Event name": "interface.messages.event_name",
  "Type": "interface.messages.type",
  "Date": "interface.messages.date",
  "Default language": "interface.messages.default_language",
  "Timezone": "interface.messages.timezone",
  "Website URL": "interface.messages.website_url",
  "RSVP deadline (local browser time)": "interface.messages.rsvp_deadline_local_browser_time",
  "Save settings": "interface.messages.save_settings",
  "Publish event": "interface.messages.publish_event",
  "Unpublish event": "interface.messages.unpublish_event",
  "Event is published: invited guests can access RSVP. You can unpublish it below.": "interface.messages.event_is_published_invited_guests_can_access_rsvp_you_can_unpubli",
  "Event is unpublished: guest-facing event details and food remain hidden until you publish.": "food.messages.event_is_unpublished_guest_facing_event_details_and_food_remain_h",
  "Use View mode to inspect configuration and Edit mode to make changes. Publication controls are below.": "interface.messages.use_view_mode_to_inspect_configuration_and_edit_mode_to_make_chan",
  "Publishing makes the guest RSVP experience available. The website can be online while the event is unpublished. Complete access-control and invite-code release tests before publishing.": "interface.messages.publishing_makes_the_guest_rsvp_experience_available_the_website_",
  "I understand the release checks are my responsibility and this will open the event to invited guests.": "interface.messages.i_understand_the_release_checks_are_my_responsibility_and_this_wi",
  "Manage event details and administrator access.": "interface.messages.manage_event_details_and_administrator_access",
  "Manage locations, addresses and local timezones. Guests can attend sessions at more than one venue.": "interface.messages.manage_locations_addresses_and_local_timezones_guests_can_attend_",
  "Set each session’s venue and local times. Use Manage Invites for household invitations and individual exceptions.": "interface.messages.set_each_session_s_venue_and_local_times_use_manage_invites_for_h",
  "Invite trusted people to help manage this event. Access starts after they verify their email and accept.": "interface.messages.invite_trusted_people_to_help_manage_this_event_access_starts_aft",
  "Invite administrator": "interface.messages.invite_administrator",
  "Open Supabase Auth": "interface.messages.open_supabase_auth",
  "Display name": "interface.messages.display_name",
  "Send invitation": "interface.messages.send_invitation",
  "Pending invitations": "interface.messages.pending_invitations",
  "An email will be sent to this address. The recipient must accept within 7 days; email sign-in links may expire sooner.": "interface.messages.an_email_will_be_sent_to_this_address_the_recipient_must_accept_w",
  "Resend": "interface.messages.resend",
  "Cancel": "interface.messages.cancel",
  "Awaiting acceptance": "interface.messages.awaiting_acceptance",
  "No pending invitations.": "interface.messages.no_pending_invitations",
  "Sending invitation…": "interface.messages.sending_invitation",
  "Administrator invitation email sent.": "interface.messages.administrator_invitation_email_sent",
  "Administrator invitation cancelled.": "interface.messages.administrator_invitation_cancelled",
  "Administrator invitation accepted.": "interface.messages.administrator_invitation_accepted",
  "Revoke administrator access": "interface.messages.revoke_administrator_access",
  "Administrator access revoked.": "interface.messages.administrator_access_revoked",
  "You cannot remove the last administrator.": "interface.messages.you_cannot_remove_the_last_administrator",
  "Search": "interface.messages.search",
  "Category": "interface.messages.category",
  "Action": "interface.messages.action",
  "From": "interface.messages.from",
  "Through": "interface.messages.through",
  "All categories": "interface.messages.all_categories",
  "All actions": "interface.messages.all_actions",
  "Search logs": "interface.messages.search_logs",
  "Reset": "interface.messages.reset",
  "Load older entries": "interface.messages.load_older_entries",
  "Search recorded changes, RSVP activity, invitation delivery and administrator sessions.": "interface.messages.search_recorded_changes_rsvp_activity_invitation_delivery_and_adm",
  "Household, guest, administrator or change": "interface.messages.household_guest_administrator_or_change",
  "Contacts": "interface.messages.contacts",
  "Invitations": "interface.messages.invitations",
  "Login": "interface.messages.login",
  "Food access": "food.messages.food_access",
  "Loading logs…": "interface.messages.loading_logs",
  "No log entries match these filters.": "interface.messages.no_log_entries_match_these_filters",
  "Field": "interface.messages.field",
  "Before": "interface.messages.before",
  "After": "interface.messages.after",
  "Reference: ": "interface.messages.reference",
  "Showing ": "interface.messages.showing",
  "Date filters use the event timezone. Entries show your local time; expand one for its UTC time and details. Archive/restore actions are recorded; permanent deletion is disabled.": "interface.messages.date_filters_use_the_event_timezone_entries_show_your_local_time_",
  "Existing history is included. New sign-in and invitation-opening records start with this update. Repeated opens within 15 minutes are grouped.": "interface.messages.existing_history_is_included_new_sign_in_and_invitation_opening_r",
  "Launch checklist": "interface.messages.launch_checklist",
  "Check all release requirements before using Settings → Event settings → Publish event.": "interface.messages.check_all_release_requirements_before_using_settings_event_settin",
  "Admin account connected": "interface.messages.admin_account_connected",
  "Event name and date entered": "interface.messages.event_name_and_date_entered",
  "At least one session created": "interface.messages.at_least_one_session_created",
  "Invitations assigned": "interface.messages.invitations_assigned",
  "Website connection in deployed config.js": "interface.messages.website_connection_in_deployed_config_js",
  "Website address saved in event settings": "interface.messages.website_address_saved_in_event_settings",
  "Event published": "interface.messages.event_published",
  "New RSVP submissions": "interface.messages.new_rsvp_submissions",
  "Food items": "food.messages.food_items",
  "Add household": "interface.messages.add_household",
  "Add guest": "interface.messages.add_guest",
  "Add contact": "interface.messages.add_contact",
  "Add venue": "interface.messages.add_venue",
  "Add session": "interface.messages.add_session",
  "Add category": "interface.messages.add_category",
  "Add food item": "food.messages.add_food_item",
  "Household or guest": "interface.messages.household_or_guest",
  "Show archived records": "interface.messages.show_archived_records",
  "⌄ Expand all": "interface.messages.expand_all",
  "› Collapse all": "interface.messages.collapse_all",
  "Click a household to expand its individual guests. Select the top-right pencil to enable editing; each guest then has a pencil for their details. Parent–child household nesting is preserved.": "interface.messages.click_a_household_to_expand_its_individual_guests_select_the_top_",
  "Empty households have no invitation code. Add a guest, then use Manage Invites. Assign sessions in Settings.": "interface.messages.empty_households_have_no_invitation_code_add_a_guest_then_use_man",
  "Household name": "interface.messages.household_name",
  "Household language": "interface.messages.household_language",
  "Household email": "interface.messages.household_email",
  "Household phone": "interface.messages.household_phone",
  "Household notes": "interface.messages.household_notes",
  "Household details": "interface.messages.household_details",
  "Household contact details": "interface.messages.household_contact_details",
  "Household default": "interface.messages.household_default",
  "Parent household": "interface.messages.parent_household",
  "Child households": "interface.messages.child_households",
  "Grouping household": "interface.messages.grouping_household",
  "None (top level)": "interface.messages.none_top_level",
  "Side": "interface.messages.side",
  "Relation group": "interface.messages.relation_group",
  "Relation": "interface.messages.relation",
  "Notes": "interface.messages.notes",
  "Phone": "interface.messages.phone",
  "Postal address": "interface.messages.postal_address",
  "Preferred contact": "interface.messages.preferred_contact",
  "Preferred contact method": "interface.messages.preferred_contact_method",
  "Preferred delivery method": "interface.messages.preferred_delivery_method",
  "First name": "interface.messages.first_name",
  "Last name": "interface.messages.last_name",
  "Title": "interface.messages.title",
  "None": "interface.messages.none",
  "Son": "interface.messages.son",
  "Daughter": "interface.messages.daughter",
  "Child": "interface.messages.child",
  "Child guest": "interface.messages.child_guest",
  "Dietary requirements": "interface.messages.dietary_requirements",
  "Individual guests": "interface.messages.individual_guests",
  "Unnamed guest": "interface.messages.unnamed_guest",
  "Unnamed household": "interface.messages.unnamed_household",
  "Ungrouped": "interface.messages.ungrouped",
  "No matching households.": "interface.messages.no_matching_households",
  "No guests assigned to this household.": "interface.messages.no_guests_assigned_to_this_household",
  "No active guests match this search.": "interface.messages.no_active_guests_match_this_search",
  "Search guests": "interface.messages.search_guests",
  "Guest name or household": "interface.messages.guest_name_or_household",
  "Guest": "interface.messages.guest",
  "Save household": "interface.messages.save_household",
  "Create household": "interface.messages.create_household",
  "Save guest": "interface.messages.save_guest",
  "Move guest": "interface.messages.move_guest",
  "Destination household": "interface.messages.destination_household",
  "Choose household": "interface.messages.choose_household",
  "Move household up": "interface.messages.move_household_up",
  "Move household down": "interface.messages.move_household_down",
  "New guests inherit this household’s session invitations.": "interface.messages.new_guests_inherit_this_household_s_session_invitations",
  "RSVP status and household assignment are not changed by editing guest details.": "interface.messages.rsvp_status_and_household_assignment_are_not_changed_by_editing_g",
  "Current session invitations are preserved as individual overrides. Moves involving RSVP history are blocked.": "interface.messages.current_session_invitations_are_preserved_as_individual_overrides",
  "Move this guest and preserve their current session invitations?": "interface.messages.move_this_guest_and_preserve_their_current_session_invitations",
  "Grouping changes with child households require moving the children first.": "interface.messages.grouping_changes_with_child_households_require_moving_the_childre",
  "First name is required.": "interface.messages.first_name_is_required",
  "Guest details saved.": "interface.messages.guest_details_saved",
  "Changes saved.": "interface.messages.changes_saved",
  "Household order saved.": "interface.messages.household_order_saved",
  "Edit": "interface.messages.edit",
  "Rename": "interface.messages.rename",
  "Archive ": "interface.messages.archive",
  "Restore ": "interface.messages.restore",
  "Edit guest: ": "interface.messages.edit_guest",
  "Edit household: ": "interface.messages.edit_household",
  "Select guest: ": "interface.messages.select_guest",
  "Edit contact: ": "interface.messages.edit_contact",
  "Archive this household and disable its invitation link? Records and history are preserved.": "interface.messages.archive_this_household_and_disable_its_invitation_link_records_an",
  "Archive this record? It can be restored later.": "interface.messages.archive_this_record_it_can_be_restored_later",
  "Restore this record?": "interface.messages.restore_this_record",
  "Record archived.": "interface.messages.record_archived",
  "Record restored.": "interface.messages.record_restored",
  "Contact": "interface.messages.contact",
  "Contact name": "interface.messages.contact_name",
  "Contact type": "interface.messages.contact_type",
  "Contact details": "interface.messages.contact_details",
  "Contact language": "interface.messages.contact_language",
  "Linked guest": "interface.messages.linked_guest",
  "Remove guest link": "interface.messages.remove_guest_link",
  "Primary": "interface.messages.primary",
  "Primary contact for this type": "interface.messages.primary_contact_for_this_type",
  "Save contact": "interface.messages.save_contact",
  "Create contact": "interface.messages.create_contact",
  "No contacts added yet.": "interface.messages.no_contacts_added_yet",
  "Choose someone from the guest list": "interface.messages.choose_someone_from_the_guest_list",
  "Choose a guest or enter a new contact below. Guest selection fills the name and language; enter this person’s contact details separately.": "interface.messages.choose_a_guest_or_enter_a_new_contact_below_guest_selection_fills",
  "Private codes and links for households with guests. Sending remains manual.": "interface.messages.private_codes_and_links_for_households_with_guests_sending_remain",
  "Search invitations": "interface.messages.search_invitations",
  "Invitation code": "interface.messages.invitation_code",
  "Copy invitation link": "interface.messages.copy_invitation_link",
  "Copy invite code": "interface.messages.copy_invite_code",
  "Copy link": "interface.messages.copy_link",
  "Copy message": "interface.messages.copy_message",
  "Invitation code copied.": "interface.messages.invitation_code_copied",
  "Invitation link copied.": "interface.messages.invitation_link_copied",
  "Message copied.": "interface.messages.message_copied",
  "No matching invitations. Empty and archived households have no active invitation.": "interface.messages.no_matching_invitations_empty_and_archived_households_have_no_act",
  "Delivery log": "interface.messages.delivery_log",
  "Invitation delivery": "interface.messages.invitation_delivery",
  "Filter delivery status": "interface.messages.filter_delivery_status",
  "All statuses": "interface.messages.all_statuses",
  "Draft": "interface.messages.draft",
  "Ready": "interface.messages.ready",
  "Ready to send": "interface.messages.ready_to_send",
  "Failed": "interface.messages.failed",
  "Cancelled": "interface.messages.cancelled",
  "Recorded sent": "interface.messages.recorded_sent",
  "No deliveries match this status.": "interface.messages.no_deliveries_match_this_status",
  "No delivery recorded yet.": "interface.messages.no_delivery_recorded_yet",
  "Prepare delivery": "interface.messages.prepare_delivery",
  "Delivery channel": "interface.messages.delivery_channel",
  "Delivery recipient": "interface.messages.delivery_recipient",
  "Delivery status": "interface.messages.delivery_status",
  "Message subject": "interface.messages.message_subject",
  "Message text": "interface.messages.message_text",
  "Delivery change note": "interface.messages.delivery_change_note",
  "Create delivery draft": "interface.messages.create_delivery_draft",
  "Save delivery changes": "interface.messages.save_delivery_changes",
  "Edit delivery": "interface.messages.edit_delivery",
  "Record as sent": "interface.messages.record_as_sent",
  "Sent note": "interface.messages.sent_note",
  "I sent this message to the displayed recipient": "interface.messages.i_sent_this_message_to_the_displayed_recipient",
  "Manual": "interface.messages.manual",
  "Manual / in person": "interface.messages.manual_in_person",
  "Postal": "interface.messages.postal",
  "Other": "interface.messages.other",
  "Recipient: ": "interface.messages.recipient",
  "To: ": "interface.messages.to",
  "Manually recorded as sent · ": "interface.messages.manually_recorded_as_sent",
  "Missing — add contact details before marking ready.": "interface.messages.missing_add_contact_details_before_marking_ready",
  "Saving a draft or marking it ready does not send a message. Review the recipient and text, send it yourself, then record it as sent.": "interface.messages.saving_a_draft_or_marking_it_ready_does_not_send_a_message_review",
  "RSVP management": "interface.messages.rsvp_management",
  "Current response": "interface.messages.current_response",
  "Choose response": "interface.messages.choose_response",
  "Corrected response": "interface.messages.corrected_response",
  "Correct response: ": "interface.messages.correct_response",
  "Attending": "interface.messages.attending",
  "Not attending": "interface.messages.not_attending",
  "Pending": "interface.messages.pending",
  "RSVP required": "interface.messages.rsvp_required",
  "Information only": "interface.messages.information_only",
  "Locked after submission": "interface.messages.locked_after_submission",
  "Open for responses": "interface.messages.open_for_responses",
  "Reason for RSVP correction": "interface.messages.reason_for_rsvp_correction",
  "Save correction": "interface.messages.save_correction",
  "This updates the current response and records the reason. The original submission and household lock are preserved.": "interface.messages.this_updates_the_current_response_and_records_the_reason_the_orig",
  "Reopen RSVP": "interface.messages.reopen_rsvp",
  "Reason for reopening": "interface.messages.reason_for_reopening",
  "Reopen this household’s RSVP while preserving its submission history?": "interface.messages.reopen_this_household_s_rsvp_while_preserving_its_submission_hist",
  "Reopening lets the household submit again. Previous submissions remain in history. If the event deadline has passed, grant a late-response window after reopening.": "interface.messages.reopening_lets_the_household_submit_again_previous_submissions_re",
  "Allow a late response": "interface.messages.allow_a_late_response",
  "Allow late response": "interface.messages.allow_late_response",
  "Allow responses until (": "interface.messages.allow_responses_until",
  "Reason for late response": "interface.messages.reason_for_late_response",
  "No active RSVP sessions are assigned to this household.": "interface.messages.no_active_rsvp_sessions_are_assigned_to_this_household",
  "Invitations are protected because this household has RSVP history.": "interface.messages.invitations_are_protected_because_this_household_has_rsvp_history",
  "Allow this household to contribute food": "food.messages.allow_this_household_to_contribute_food",
  "Reason for food-access change": "food.messages.reason_for_food_access_change",
  "Save food access": "food.messages.save_food_access",
  "Disabling access is blocked while food commitments or a confirmed selection exist. Existing selections are never removed by this control.": "food.messages.disabling_access_is_blocked_while_food_commitments_or_a_confirmed",
  "Food categories & items": "food.messages.food_categories_items",
  "Food or category": "food.messages.food_or_category",
  "Grouped by category. Switch to Edit to sort, rename, or update items. Existing claims are preserved.": "interface.messages.grouped_by_category_switch_to_edit_to_sort_rename_or_update_items",
  "＋ Add food category": "food.messages.add_food_category",
  "＋ Add food item": "food.messages.add_food_item_2",
  "Category name": "interface.messages.category_name",
  "New category name": "interface.messages.new_category_name",
  "Register category": "interface.messages.register_category",
  "Register existing category": "interface.messages.register_existing_category",
  "Rename food category": "food.messages.rename_food_category",
  "Move category up": "interface.messages.move_category_up",
  "Move category down": "interface.messages.move_category_down",
  "Move food item up": "food.messages.move_food_item_up",
  "Move food item down": "food.messages.move_food_item_down",
  "Category for ": "interface.messages.category_for",
  "Edit food item": "food.messages.edit_food_item",
  "Save food item": "food.messages.save_food_item",
  "Faroese name": "interface.messages.faroese_name",
  "English name": "interface.messages.english_name",
  "German name": "interface.messages.german_name",
  "Faroese description": "interface.messages.faroese_description",
  "English description": "interface.messages.english_description",
  "German description": "interface.messages.german_description",
  "Quantity needed": "interface.messages.quantity_needed",
  "Display order": "interface.messages.display_order",
  "Available for guests": "interface.messages.available_for_guests",
  "Archive food item (preserve existing claims)": "food.messages.archive_food_item_preserve_existing_claims",
  "No matching food items.": "food.messages.no_matching_food_items",
  "Uncategorized": "interface.messages.uncategorized",
  "Unnamed item": "interface.messages.unnamed_item",
  "Not registered": "interface.messages.not_registered",
  "Faroese name is required.": "interface.messages.faroese_name_is_required",
  "Enter a non-negative quantity.": "interface.messages.enter_a_non_negative_quantity",
  "Food category added.": "food.messages.food_category_added",
  "Food category updated.": "food.messages.food_category_updated",
  "Food item added.": "food.messages.food_item_added",
  "Food item updated.": "food.messages.food_item_updated",
  "Food item archived.": "food.messages.food_item_archived",
  "Food order saved.": "food.messages.food_order_saved",
  "Category order saved.": "interface.messages.category_order_saved",
  "Category registered.": "interface.messages.category_registered",
  "Category renamed and linked food items updated.": "food.messages.category_renamed_and_linked_food_items_updated",
  "Session": "interface.messages.session",
  "Session name": "interface.messages.session_name",
  "Session key": "interface.messages.session_key",
  "Session venue": "interface.messages.session_venue",
  "Active session": "interface.messages.active_session",
  "Starts (venue local time)": "interface.messages.starts_venue_local_time",
  "Ends (venue local time)": "interface.messages.ends_venue_local_time",
  "Save session": "interface.messages.save_session",
  "Create session": "interface.messages.create_session",
  "Venue name": "interface.messages.venue_name",
  "Venue address": "interface.messages.venue_address",
  "Venue timezone": "interface.messages.venue_timezone",
  "Country code": "interface.messages.country_code",
  "Map link (HTTPS)": "interface.messages.map_link_https",
  "Guest venue notes": "interface.messages.guest_venue_notes",
  "Welcome message — ": "interface.messages.welcome_message",
  "Welcome messages for this venue": "interface.messages.welcome_messages_for_this_venue",
  "Archived venue": "interface.messages.archived_venue",
  "Save venue": "interface.messages.save_venue",
  "Create venue": "interface.messages.create_venue",
  "No venue": "interface.messages.no_venue",
  "Unscheduled": "interface.messages.unscheduled",
  "Times are entered in ": "interface.messages.times_are_entered_in",
  "Session invitations": "interface.messages.session_invitations",
  "Save session invitations": "interface.messages.save_session_invitations",
  "Create sessions in Settings first.": "interface.messages.create_sessions_in_settings_first",
  "Household defaults apply to each guest unless an individual exception is selected. Language does not determine invitations.": "interface.messages.household_defaults_apply_to_each_guest_unless_an_individual_excep",
  "Follow household": "interface.messages.follow_household",
  "Invited": "interface.messages.invited",
  "Not invited": "interface.messages.not_invited",
  "Household invited": "interface.messages.household_invited",
  "Household not invited": "interface.messages.household_not_invited",
  "Switch to Edit mode": "interface.messages.switch_to_edit_mode",
  "Switch to View mode": "interface.messages.switch_to_view_mode",
  "View mode · Manage invitations, food and event details": "food.messages.view_mode_manage_invitations_food_and_event_details",
  "Edit mode · Changes are saved to the event database": "interface.messages.edit_mode_changes_are_saved_to_the_event_database",
  "Loading event data…": "interface.messages.loading_event_data",
  "Event data refreshed.": "interface.messages.event_data_refreshed",
  "Event settings saved.": "interface.messages.event_settings_saved",
  "Switch to Edit mode first.": "interface.messages.switch_to_edit_mode_first",
  "Invalid RSVP deadline.": "interface.messages.invalid_rsvp_deadline",
  "Confirm the release acknowledgement before publishing.": "interface.messages.confirm_the_release_acknowledgement_before_publishing",
  "Complete the event name, date, website URL, active session and invitations before publishing.": "interface.messages.complete_the_event_name_date_website_url_active_session_and_invit",
  "Publish this event now? Invite-code holders may access guest RSVP and food details. Proceed only after security and guest-flow testing.": "food.messages.publish_this_event_now_invite_code_holders_may_access_guest_rsvp_",
  "Unpublish this event? Guest access to published event details will stop.": "interface.messages.unpublish_this_event_guest_access_to_published_event_details_will",
  "Event published.": "interface.messages.event_published_2",
  "Event unpublished.": "interface.messages.event_unpublished",
  "Enter matching passwords of at least 12 characters.": "interface.messages.enter_matching_passwords_of_at_least_12_characters",
  "Sign in again before sending an invitation.": "interface.messages.sign_in_again_before_sending_an_invitation",
  "Invitation could not be sent.": "interface.messages.invitation_could_not_be_sent",
  "Email delivery status is uncertain. Check before resending.": "interface.messages.email_delivery_status_is_uncertain_check_before_resending",
  "Email status is uncertain. Refresh pending invitations before retrying.": "interface.messages.email_status_is_uncertain_refresh_pending_invitations_before_retr",
  "Email sending is restricted. Check the email configuration.": "interface.messages.email_sending_is_restricted_check_the_email_configuration",
  "The email could not be sent. Check the email configuration before resending.": "interface.messages.the_email_could_not_be_sent_check_the_email_configuration_before_",
  "The email service request limit was reached. Wait before resending.": "interface.messages.the_email_service_request_limit_was_reached_wait_before_resending",
  "The email service sending limit was reached. Wait before resending.": "interface.messages.the_email_service_sending_limit_was_reached_wait_before_resending",
  "Administrator invitations are unavailable. The invitation service must be installed before sending.": "interface.messages.administrator_invitations_are_unavailable_the_invitation_service_",
  "Administrator list unavailable. Apply migration 006 if needed.": "interface.messages.administrator_list_unavailable_apply_migration_006_if_needed",
  "Admin management API unavailable: ": "interface.messages.admin_management_api_unavailable",
  "No active administrator invitation was found for this account. Ask an administrator to send or resend it.": "interface.messages.no_active_administrator_invitation_was_found_for_this_account_ask",
  "Your account does not have administrator access, or invitation acceptance is unavailable. Ask an administrator to check your invitation.": "interface.messages.your_account_does_not_have_administrator_access_or_invitation_acc",
  "Session logging is unavailable.": "interface.messages.session_logging_is_unavailable",
  "Signed in, but session logging is unavailable.": "interface.messages.signed_in_but_session_logging_is_unavailable",
  "Send another administrator invitation email to ": "interface.messages.send_another_administrator_invitation_email_to",
  "Cancel administrator invitation for ": "interface.messages.cancel_administrator_invitation_for",
  "Revoke administrator access for ": "interface.messages.revoke_administrator_access_for",
  "Added": "interface.messages.added",
  "Updated": "interface.messages.updated",
  "Deleted": "interface.messages.deleted",
  "Archived": "interface.messages.archived",
  "Restored": "interface.messages.restored",
  "Moved": "interface.messages.moved",
  "Renamed": "interface.messages.renamed",
  "Assigned": "interface.messages.assigned",
  "Enabled": "interface.messages.enabled",
  "Disabled": "interface.messages.disabled",
  "Unspecified": "interface.messages.unspecified",
  "Expired": "interface.messages.expired",
  "Draft saved": "interface.messages.draft_saved",
  "Delivery created": "interface.messages.delivery_created",
  "Failed delivery": "interface.messages.failed_delivery",
  "Failed attempt": "interface.messages.failed_attempt",
  "Household submitted": "interface.messages.household_submitted",
  "Guest response submitted": "interface.messages.guest_response_submitted",
  "Guest response corrected": "interface.messages.guest_response_corrected",
  "RSVP reopened": "interface.messages.rsvp_reopened",
  "Late response allowed": "interface.messages.late_response_allowed",
  "Invitation opened": "interface.messages.invitation_opened",
  "Invitation assignments changed": "interface.messages.invitation_assignments_changed",
  "Sign-in session": "interface.messages.sign_in_session",
  "Signed out": "interface.messages.signed_out",
  "Sign-out requested": "interface.messages.sign_out_requested",
  "Token refreshed": "interface.messages.token_refreshed",
  "Administrator invitation accepted": "interface.messages.administrator_invitation_accepted_2",
  "Administrator invitation cancelled": "interface.messages.administrator_invitation_cancelled_2",
  "Administrator email requested": "interface.messages.administrator_email_requested",
  "Administrator email accepted by service": "interface.messages.administrator_email_accepted_by_service",
  "Administrator email failed": "interface.messages.administrator_email_failed",
  "Email failed": "interface.messages.email_failed",
  "Sending / status pending": "interface.messages.sending_status_pending",
  "Access removed": "interface.messages.access_removed",
  "FIRST-TIME SETUP": "interface.messages.first_time_setup",
  "Make this event yours.": "interface.messages.make_this_event_yours",
  "Connect your own Supabase project in four steps. No terminal or Python required.": "interface.messages.connect_your_own_supabase_project_in_four_steps_no_terminal_or_py",
  "Administration · Own your data": "interface.messages.administration_own_your_data",
  "Database choice": "interface.messages.database_choice",
  "Connection": "interface.messages.connection",
  "Verify admin": "interface.messages.verify_admin",
  "Publish config": "interface.messages.publish_config",
  "STEP 1 OF 4": "interface.messages.step_1_of_4",
  "STEP 2 OF 4": "interface.messages.step_2_of_4",
  "STEP 3 OF 4": "interface.messages.step_3_of_4",
  "STEP 4 OF 4": "interface.messages.step_4_of_4",
  "How would you like to begin?": "interface.messages.how_would_you_like_to_begin",
  "Use existing database": "interface.messages.use_existing_database",
  "Connect to an already-migrated Supabase project. Preserve its invitations, guests and admin accounts.": "interface.messages.connect_to_an_already_migrated_supabase_project_preserve_its_invi",
  "Set up a new database": "interface.messages.set_up_a_new_database",
  "Create an empty Supabase project, run the included SQL, then create the first administrator.": "interface.messages.create_an_empty_supabase_project_run_the_included_sql_then_create",
  "Continue": "interface.messages.continue",
  "Connect Supabase": "interface.messages.connect_supabase",
  "Project URL": "interface.messages.project_url",
  "Publishable or legacy anon key": "interface.messages.publishable_or_legacy_anon_key",
  "Test connection": "interface.messages.test_connection",
  "Never paste a Supabase secret key, service_role key, database password or access token here. Only public client keys belong in a static website.": "interface.messages.never_paste_a_supabase_secret_key_service_role_key_database_passw",
  "New database instructions": "interface.messages.new_database_instructions",
  "Create a project at": "interface.messages.create_a_project_at",
  "Open SQL Editor and run the included migrations 001–006 in order, or use the bundled install file. These are starter migrations and require functional/security testing before public launch.": "interface.messages.open_sql_editor_and_run_the_included_migrations_001_006_in_order_",
  "Create an Auth user under Authentication → Users.": "interface.messages.create_an_auth_user_under_authentication_users",
  "Download complete SQL installer": "interface.messages.download_complete_sql_installer",
  "First admin email (for new installations)": "interface.messages.first_admin_email_for_new_installations",
  "Generate first-admin SQL": "interface.messages.generate_first_admin_sql",
  "Copy SQL": "interface.messages.copy_sql",
  "The SQL appears here. Run it in your private Supabase SQL Editor, never on the website.": "interface.messages.the_sql_appears_here_run_it_in_your_private_supabase_sql_editor_n",
  "Secure administrator access": "interface.messages.secure_administrator_access",
  "For new projects, invite your first user via": "interface.messages.for_new_projects_invite_your_first_user_via",
  ", then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.": "interface.messages.then_run_the_sql_below_in_supabase_sql_editor_to_grant_admin_acce",
  "Check administrator login": "interface.messages.check_administrator_login",
  "Put your configuration online": "interface.messages.put_your_configuration_online",
  "Administrator verified. Your website configuration is ready.": "interface.messages.administrator_verified_your_website_configuration_is_ready",
  "Download config.js": "interface.messages.download_config_js",
  "Copy config contents": "interface.messages.copy_config_contents",
  "Go to admin": "interface.messages.go_to_admin",
  "The file contains only your Supabase URL and publishable / anon key. It must not contain a secret or service_role key.": "interface.messages.the_file_contains_only_your_supabase_url_and_publishable_anon_key",
  "After committing": "interface.messages.after_committing",
  ", enable GitHub Pages for the new repository. Then open the website, verify admin sign-in and invitation behavior. Keep the event unpublished until final security checks pass.": "interface.messages.enable_github_pages_for_the_new_repository_then_open_the_website_",
  "Enter": "interface.messages.enter",
  ", and add it to": "interface.messages.and_add_it_to",
  "in your NEW GitHub repository. This step is essential: browser-only setup does not configure the public website for other visitors.": "interface.messages.in_your_new_github_repository_this_step_is_essential_browser_only",
  "For a new project, create your first Auth user in Supabase and use the setup wizard to establish admin access.": "interface.messages.for_a_new_project_create_your_first_auth_user_in_supabase_and_use",
  "Test your Supabase connection before continuing.": "interface.messages.test_your_supabase_connection_before_continuing",
  "Administrator verification required.": "interface.messages.administrator_verification_required",
  "Sign in as an administrator first.": "interface.messages.sign_in_as_an_administrator_first",
  "Database connection or schema validation failed: ": "interface.messages.database_connection_or_schema_validation_failed",
  "Guest Edge Function is unavailable. Deploy the guest-gateway function first: ": "interface.messages.guest_edge_function_is_unavailable_deploy_the_guest_gateway_funct",
  "Enter a valid administrator email.": "interface.messages.enter_a_valid_administrator_email",
  "First-admin SQL generated. This must be executed in the private Supabase SQL Editor, not in the browser.": "interface.messages.first_admin_sql_generated_this_must_be_executed_in_the_private_su",
  "This account does not have administrator access. Run the first-admin SQL or ask an existing admin to grant access.": "interface.messages.this_account_does_not_have_administrator_access_run_the_first_adm",
  "Generate SQL first.": "interface.messages.generate_sql_first",
  "SQL copied.": "interface.messages.sql_copied",
  "Unable to copy SQL. Select it manually.": "interface.messages.unable_to_copy_sql_select_it_manually",
  "Configuration copied.": "interface.messages.configuration_copied",
  "Clipboard access denied. Download the file instead.": "interface.messages.clipboard_access_denied_download_the_file_instead",
  "Connected to {host}. The protected guest gateway responded.": "interface.messages.connected_to_host_the_protected_guest_gateway_responded",
  "Database not configured": "interface.messages.database_not_configured",
  "Database not connected. Complete the setup wizard first.": "interface.messages.database_not_connected_complete_the_setup_wizard_first",
  "Invalid administrator action": "interface.messages.invalid_administrator_action",
  "Administrator request failed.": "interface.messages.administrator_request_failed",
  "Your sign-in has expired. Sign in again before saving. Your edits have not been submitted.": "interface.messages.your_sign_in_has_expired_sign_in_again_before_saving_your_edits_h",
  "The server returned an unreadable response.": "interface.messages.the_server_returned_an_unreadable_response",
  "Supabase JavaScript library did not load. Check the network connection.": "interface.messages.supabase_javascript_library_did_not_load_check_the_network_connec",
  "Supabase URL must use HTTPS (except localhost).": "interface.messages.supabase_url_must_use_https_except_localhost",
  "Use only the Supabase project URL, with no credentials or query string.": "interface.messages.use_only_the_supabase_project_url_with_no_credentials_or_query_st",
  "Use only a publishable or anon key, never a secret key.": "interface.messages.use_only_a_publishable_or_anon_key_never_a_secret_key",
  "This JWT is not an anon key.": "interface.messages.this_jwt_is_not_an_anon_key",
  "The supplied JWT key is malformed.": "interface.messages.the_supplied_jwt_key_is_malformed",
  "Expected a publishable key or legacy anon JWT.": "interface.messages.expected_a_publishable_key_or_legacy_anon_jwt",
  "Something went wrong.": "interface.messages.something_went_wrong",
  "Enter a complete date and time.": "interface.messages.enter_a_complete_date_and_time",
  "Invalid date and time.": "interface.messages.invalid_date_and_time",
  "This local time is ambiguous or does not exist because clocks change. Choose a time outside the clock change.": "interface.messages.this_local_time_is_ambiguous_or_does_not_exist_because_clocks_cha",
  "A simple way to celebrate together.": "interface.messages.a_simple_way_to_celebrate_together",
  "Your event,": "interface.messages.your_event",
  "beautifully arranged.": "interface.messages.beautifully_arranged",
  "Private invitations · Please do not share your invitation link.": "interface.messages.private_invitations_please_do_not_share_your_invitation_link",
  "SETUP REQUIRED": "interface.messages.setup_required",
  "Connect your event": "interface.messages.connect_your_event",
  "This website has not been connected to Supabase yet.": "interface.messages.this_website_has_not_been_connected_to_supabase_yet",
  "Open first-time setup": "interface.messages.open_first_time_setup",
  "YOUR INVITATION": "interface.messages.your_invitation",
  "Open your invitation": "interface.messages.open_your_invitation",
  "Enter the eight-character invitation code or open the private link you received.": "interface.messages.enter_the_eight_character_invitation_code_or_open_the_private_lin",
  "Open": "interface.messages.open",
  "PERSONAL INVITATION": "interface.messages.personal_invitation",
  "Welcome": "interface.messages.welcome",
  "Please let us know who will attend.": "interface.messages.please_let_us_know_who_will_attend",
  "Submit RSVP": "interface.messages.submit_rsvp",
  "FOOD COORDINATION": "food.messages.food_coordination",
  "What can you bring?": "interface.messages.what_can_you_bring",
  "Choose items only if you want to contribute. Quantities cannot exceed what is needed.": "interface.messages.choose_items_only_if_you_want_to_contribute_quantities_cannot_exc",
  "Confirm my selections": "interface.messages.confirm_my_selections",
  "Invalid quantity": "interface.messages.invalid_quantity",
  "Invalid invitation code": "interface.messages.invalid_invitation_code",
  "Confirm food selections? This will lock further edits.": "food.messages.confirm_food_selections_this_will_lock_further_edits",
  "Food item": "food.messages.food_item",
  "Your event": "interface.messages.your_event_2",
  "Invitation": "interface.messages.invitation",
  "Quantity for {item}": "interface.messages.quantity_for_item",
  "Interface language": "interface.messages.interface_language",
  "Interface wording": "interface.messages.interface_wording",
  "Welcome messages": "interface.messages.welcome_messages",
  "Save welcome messages": "interface.messages.save_welcome_messages",
  "Welcome messages saved.": "interface.messages.welcome_messages_saved",
  "Leave a welcome message blank to use the built-in translation.": "interface.messages.leave_a_welcome_message_blank_to_use_the_built_in_translation",
  "Customize interface wording": "interface.messages.customize_interface_wording",
  "Choose a phrase and language, edit the wording, then download the file and replace js/interface-overrides.js in the repository. This does not publish the event.": "interface.messages.choose_a_phrase_and_language_edit_the_wording_then_download_the_f",
  "Phrase": "interface.messages.phrase",
  "Custom wording": "interface.messages.custom_wording",
  "Use {placeholders} exactly as shown. Blank text restores the built-in wording.": "interface.messages.use_placeholders_exactly_as_shown_blank_text_restores_the_built_i",
  "Apply wording": "interface.messages.apply_wording",
  "Download wording file": "interface.messages.download_wording_file",
  "Wording applied to this preview. Download and commit the file to share it.": "interface.messages.wording_applied_to_this_preview_download_and_commit_the_file_to_s",
  "Keep the same placeholders as the original phrase.": "interface.messages.keep_the_same_placeholders_as_the_original_phrase",
  "EVENT INVITATION": "interface.messages.event_invitation_2",
  "We look forward to celebrating with you.": "interface.messages.we_look_forward_to_celebrating_with_you",
  "Enter the eight-character code from your invitation.": "interface.messages.enter_the_eight_character_code_from_your_invitation",
  "Dear guests": "interface.messages.dear_guests",
  "Your response has been received and locked.": "interface.messages.your_response_has_been_received_and_locked",
  "Thank you! Your response is recorded.": "interface.messages.thank_you_your_response_is_recorded",
  "No invitation was found for that code.": "interface.messages.no_invitation_was_found_for_that_code",
  "Choose a response for every invited guest and session.": "interface.messages.choose_a_response_for_every_invited_guest_and_session",
  "Could not reach the database.": "interface.messages.could_not_reach_the_database",
  "This event has not been published yet.": "interface.messages.this_event_has_not_been_published_yet",
  "Choose only what you would like to contribute. Quantities are limited.": "interface.messages.choose_only_what_you_would_like_to_contribute_quantities_are_limi",
  "Thank you! Your food selection is confirmed.": "food.messages.thank_you_your_food_selection_is_confirmed",
  "Save": "interface.messages.save",
  "Food selection saved.": "food.messages.food_selection_saved",
  "Available": "interface.messages.available",
  "All invited guests are listed.": "interface.messages.all_invited_guests_are_listed",
  "Changing language reloads this page. Unsaved changes will be lost. Continue?": "interface.messages.changing_language_reloads_this_page_unsaved_changes_will_be_lost_",
  "Showing {count} of {total} matching guests.": "interface.messages.showing_count_of_total_matching_guests",
  "{count} entries shown · Newest first": "interface.messages.count_entries_shown_newest_first",
  "{state} · {count} food commitments{confirmed}": "food.messages.state_count_food_commitments_confirmed",
  " · Confirmed": "interface.messages.confirmed",
  " · Last submission {time}": "interface.messages.last_submission_time",
  "Event deadline: {deadline} · Late-response permission: {late} · {zone}": "interface.messages.event_deadline_deadline_late_response_permission_late_zone",
  "{ready} ready · {sent} recorded sent · {failed} failed": "interface.messages.ready_ready_sent_recorded_sent_failed_failed",
  "{count} guests": "interface.messages.count_guests",
  "{count} sub-households · {guests} guests in sub-households": "interface.messages.count_sub_households_guests_guests_in_sub_households",
  "Quantity cannot fall below {count} claimed; claimed items cannot be hidden.": "interface.messages.quantity_cannot_fall_below_count_claimed_claimed_items_cannot_be_",
  "Needed {needed} · Claimed {claimed} · Available {available}{inactive}": "interface.messages.needed_needed_claimed_claimed_available_available_inactive",
  " · Inactive": "interface.messages.inactive",
  "Archive {item}? Existing claims are preserved; you can reactivate it using Edit.": "interface.messages.archive_item_existing_claims_are_preserved_you_can_reactivate_it_",
  "Revoke administrator access for {email}?": "interface.messages.revoke_administrator_access_for_email",
  "Times are entered in {zone}. Changing venue keeps the typed local time; review before saving.": "interface.messages.times_are_entered_in_zone_changing_venue_keeps_the_typed_local_ti",
  "For new projects, invite your first user via Supabase → Authentication → Users, then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.": "interface.messages.for_new_projects_invite_your_first_user_via_supabase_authenticati",
  "{attending} attending · {declined} declined": "interface.messages.attending_attending_declined_declined",
  "{sent} recorded sent · {pending} pending": "interface.messages.sent_recorded_sent_pending_pending",
  "{count} households": "interface.messages.count_households",
  "{count} items": "interface.messages.count_items",
  " · Child": "interface.messages.child_2",
  " · Archived": "interface.messages.archived_2",
  " (unregistered)": "interface.messages.unregistered",
  " (inactive)": "interface.messages.inactive_2",
  " — household": "interface.messages.household",
  " · Expires {time}": "interface.messages.expires_time",
  "Household": "interface.messages.household_2",
  "Wording preview": "interface.messages.wording_preview",
  "Download": "interface.messages.download",
  "{count} guest": "interface.messages.count_guest",
  "{count} sub-household": "interface.messages.count_sub_household",
  "{count} sub-households": "interface.messages.count_sub_households",
  "{count} guest in sub-households": "interface.messages.count_guest_in_sub_households",
  "{count} guests in sub-households": "interface.messages.count_guests_in_sub_households",
  "Archive household": "interface.messages.archive_household",
  "Restore household": "interface.messages.restore_household",
  "Archive guest": "interface.messages.archive_guest",
  "Restore guest": "interface.messages.restore_guest",
  "Archive contact": "interface.messages.archive_contact",
  "Restore contact": "interface.messages.restore_contact",
  "Languages": "interface.messages.languages",
  "Backups": "interface.messages.backups",
  "Fallback language": "interface.messages.fallback_language",
  "Choose enabled languages and the fallback used for missing translations. English is the final built-in fallback.": "interface.messages.choose_enabled_languages_and_the_fallback_used_for_missing_transl",
  "Save language preferences": "interface.messages.save_language_preferences",
  "Add language": "interface.messages.add_language",
  "Language code": "interface.messages.language_code",
  "Save language": "interface.messages.save_language",
  "Language saved.": "interface.messages.language_saved",
  "Language preferences saved.": "interface.messages.language_preferences_saved",
  "Translations": "interface.messages.translations",
  "Add translations for interface phrases, event introductions, venue welcome messages, sessions and food. Missing text uses the fallback language.": "food.messages.add_translations_for_interface_phrases_event_introductions_venue_",
  "Text to translate": "interface.messages.text_to_translate",
  "Translation": "interface.messages.translation",
  "Save translation": "interface.messages.save_translation",
  "Translation saved.": "interface.messages.translation_saved",
  "Fallback preview": "interface.messages.fallback_preview",
  "Venue": "interface.messages.venue",
  "Description": "interface.messages.description",
  "Blank text uses the configured fallback language, then English.": "interface.messages.blank_text_uses_the_configured_fallback_language_then_english",
  "Choose a phrase and language, then save the translation. Downloading a wording file is optional. This does not publish the event.": "interface.messages.choose_a_phrase_and_language_then_save_the_translation_downloadin",
  "Download an application backup containing guest information, private invitation codes, settings, translations, contributions and historical records. Store it privately.": "interface.messages.download_an_application_backup_containing_guest_information_priva",
  "Auth passwords, sessions, administrator access, deployment secrets, rate-limit counters and sign-in logs are not restored. Keep a separate copy of the repository and deployment configuration.": "interface.messages.auth_passwords_sessions_administrator_access_deployment_secrets_r",
  "Download application backup": "interface.messages.download_application_backup",
  "Validate and restore": "interface.messages.validate_and_restore",
  "Choose a backup to inspect it. Full validation rehearses the restore and rolls it back. Import requires an empty, unpublished destination with matching migrations and verified historical actor accounts. Existing application records cannot be overwritten.": "interface.messages.choose_a_backup_to_inspect_it_full_validation_rehearses_the_resto",
  "Backup file": "interface.messages.backup_file",
  "Validate backup": "interface.messages.validate_backup",
  "Restore confirmation": "interface.messages.restore_confirmation",
  "I understand this restores application data into an empty destination and keeps the event unpublished.": "interface.messages.i_understand_this_restores_application_data_into_an_empty_destina",
  "Restore application backup": "interface.messages.restore_application_backup",
  "Preparing backup…": "interface.messages.preparing_backup",
  "Backup export is unavailable. Install the matching migration first.": "interface.messages.backup_export_is_unavailable_install_the_matching_migration_first",
  "Backup downloaded. Store it privately and rehearse restoration.": "interface.messages.backup_downloaded_store_it_privately_and_rehearse_restoration",
  "Backup exceeds 20 MB.": "interface.messages.backup_exceeds_20_mb",
  "Unsupported backup format or version.": "interface.messages.unsupported_backup_format_or_version",
  "Validating backup…": "interface.messages.validating_backup",
  "Backup validation is unavailable.": "interface.messages.backup_validation_is_unavailable",
  "Restore rehearsal passed. No data was changed.": "interface.messages.restore_rehearsal_passed_no_data_was_changed",
  "This destination cannot be restored: ": "interface.messages.this_destination_cannot_be_restored",
  "Application restored. The event is unpublished. Review administrator access separately.": "interface.messages.application_restored_the_event_is_unpublished_review_administrato",
  "RESTORE followed by the source event name": "interface.messages.restore_followed_by_the_source_event_name",
  "Open email": "interface.messages.open_email",
  "Open Messages": "interface.messages.open_messages",
  "Open WhatsApp": "interface.messages.open_whatsapp",
  "Copy the message, open Messages, then paste and send.": "interface.messages.copy_the_message_open_messages_then_paste_and_send",
  "Review the message in your device app and tap Send.": "interface.messages.review_the_message_in_your_device_app_and_tap_send",
  "Opening an app does not mark this message as sent. Return here to confirm sending. Delivery and read receipts remain in your messaging app.": "interface.messages.opening_an_app_does_not_mark_this_message_as_sent_return_here_to_",
  "Enter one valid email address.": "interface.messages.enter_one_valid_email_address",
  "Use an international phone number, including country code.": "interface.messages.use_an_international_phone_number_including_country_code",
  "Refresh and save this delivery again before sending.": "interface.messages.refresh_and_save_this_delivery_again_before_sending",
  "Prepare reminder": "interface.messages.prepare_reminder",
  "Creates a separate draft using current contact details. Review the recipient and text before sending.": "interface.messages.creates_a_separate_draft_using_current_contact_details_review_the",
  "A friendly reminder to reply to our invitation:": "interface.messages.a_friendly_reminder_to_reply_to_our_invitation",
  "Invites": "interface.messages.invites",
  "Things to do": "interface.messages.things_to_do",
  "Task": "interface.messages.task",
  "Assigned to": "interface.messages.assigned_to",
  "Status": "interface.messages.status",
  "Add rows": "interface.messages.add_rows",
  "In progress": "interface.messages.in_progress",
  "Done": "interface.messages.done",
  "Tasks saved.": "interface.messages.tasks_saved",
  "Edit cells, add rows, then save. Blank new rows are ignored.": "interface.messages.edit_cells_add_rows_then_save_blank_new_rows_are_ignored",
  "Select Edit to update the task list.": "interface.messages.select_edit_to_update_the_task_list",
  "Name": "interface.messages.name",
  "User Comment": "interface.messages.user_comment",
  "Admin Comment": "interface.messages.admin_comment",
  "Amount: {claimed}/{needed}, Shown: {shown}": "interface.messages.amount_claimed_needed_shown_shown",
  "Pick item": "interface.messages.pick_item",
  "Remove selection": "interface.messages.remove_selection",
  "Selected": "interface.messages.selected",
  "Find text": "interface.messages.find_text",
  "Choose enabled languages": "interface.messages.choose_enabled_languages",
  "Name is required.": "interface.messages.name_is_required",
  "Comment": "interface.messages.comment",
  "Recipe": "food.messages.recipe",
  "Previous recipe group": "food.messages.previous_recipe_group",
  "Print / Save as PDF": "interface.messages.print_save_as_pdf",
  "Allow pop-ups to save the recipe as PDF.": "food.messages.allow_pop_ups_to_save_the_recipe_as_pdf",
  "Batch(s)": "types.units.batch_s",
  "Piece(s)": "types.units.piece_s",
  "Tray(s)": "types.units.tray_s",
  "Packet(s)": "types.units.packet_s",
  "Kg": "types.units.kg",
  "Grams": "types.units.grams",
  "Default type ({type})": "interface.messages.default_type_type",
  "+ Add food item type": "food.messages.add_food_item_type",
  "New food item type": "food.messages.new_food_item_type",
  "Food item type must be at most 60 characters.": "food.messages.food_item_type_must_be_at_most_60_characters",
  "Expand all items": "interface.messages.expand_all_items",
  "Collapse all items": "interface.messages.collapse_all_items",
  "+ Add household": "interface.messages.add_household_2",
  "Amount: {claimed}/{needed} {type}, Shown: {shown}": "interface.messages.amount_claimed_needed_type_shown_shown",
  "Type translations are shared by food items with the same type.": "food.messages.type_translations_are_shared_by_food_items_with_the_same_type",
  "No matching food types.": "food.messages.no_matching_food_types",
  "Event welcome": "interface.messages.event_welcome",
  "Venue welcome": "interface.messages.venue_welcome",
  "Appears at the top of the guest invitation.": "interface.messages.appears_at_the_top_of_the_guest_invitation",
  "Appears under the session at this venue on the guest invitation.": "interface.messages.appears_under_the_session_at_this_venue_on_the_guest_invitation",
  "Map link": "interface.messages.map_link",
  "Manage households": "interface.messages.manage_households",
  "Checked households are invited to this session. Individual guest exceptions stay in place.": "interface.messages.checked_households_are_invited_to_this_session_individual_guest_e",
  "No households to manage.": "interface.messages.no_households_to_manage",
  "Guest exceptions": "interface.messages.guest_exceptions",
  "Protected by RSVP history": "interface.messages.protected_by_rsvp_history",
  "Manage food": "food.messages.manage_food",
  "Venue food": "food.messages.venue_food",
  "Checked items are available at this venue. Changes apply here only. Existing household claims are kept.": "interface.messages.checked_items_are_available_at_this_venue_changes_apply_here_only",
  "No food items to manage.": "food.messages.no_food_items_to_manage",
  "Add food": "food.messages.add_food",
  "Select all": "interface.messages.select_all",
  "Adding unrestricted food here makes it available at this venue only. Items already assigned to other venues keep those assignments.": "food.messages.adding_unrestricted_food_here_makes_it_available_at_this_venue_on",
  "Nothing available to add.": "interface.messages.nothing_available_to_add",
  "Edit administrator name": "interface.messages.edit_administrator_name",
  "Move session up": "interface.messages.move_session_up",
  "Move session down": "interface.messages.move_session_down",
  "Session order saved.": "interface.messages.session_order_saved",
  "Move language up": "interface.messages.move_language_up",
  "Move language down": "interface.messages.move_language_down",
  "Food Types": "food.messages.food_types",
  "Food categories": "food.messages.food_categories",
  "Save translations": "interface.messages.save_translations",
  "Allow food": "food.messages.allow_food",
  "1 item": "interface.messages.1_item",
  "{items}, {claimed}/{capacity} amounts": "interface.messages.items_claimed_capacity_amounts",
  "+ Add": "interface.messages.add",
  "Edit quantity for {household}": "interface.messages.edit_quantity_for_household",
  "Remove selection for {household}": "interface.messages.remove_selection_for_household",
  "Remove the food selection for {household}?": "food.messages.remove_the_food_selection_for_household",
  "+ Add recipe": "food.messages.add_recipe",
  "Add recipe": "food.messages.add_recipe_2",
  "Recipe name": "food.messages.recipe_name",
  "Existing food items": "food.messages.existing_food_items",
  "Create food item in recipe": "food.messages.create_food_item_in_recipe",
  "Remove new item": "interface.messages.remove_new_item",
  "Save recipe": "food.messages.save_recipe",
  "Edit recipe": "food.messages.edit_recipe",
  "Existing items keep their selections. Recipe items use the recipe category.": "food.messages.existing_items_keep_their_selections_recipe_items_use_the_recipe_",
  "Move to category": "interface.messages.move_to_category",
  "Move recipe to category": "food.messages.move_recipe_to_category",
  "Unsaved changes. Select Save to update the database.": "interface.messages.unsaved_changes_select_save_to_update_the_database",
  "Use main Edit mode to change tasks. Save sends your changes to the database.": "interface.messages.use_main_edit_mode_to_change_tasks_save_sends_your_changes_to_the",
  "Tasks were saved. Refresh the page before editing again.": "interface.messages.tasks_were_saved_refresh_the_page_before_editing_again",
  "Item": "interface.messages.item",
  "New item": "interface.messages.new_item",
  "Edit item": "interface.messages.edit_item",
  "Save item": "interface.messages.save_item",
  "Item saved.": "interface.messages.item_saved",
  "No items in this category.": "interface.messages.no_items_in_this_category",
  "Use main Edit, then the pencil to edit and save a line.": "interface.messages.use_main_edit_then_the_pencil_to_edit_and_save_a_line",
  "Add a category first.": "interface.messages.add_a_category_first",
  "Tasks and things to bring, grouped by category. Use main Edit, then the pencil to edit a line.": "interface.messages.tasks_and_things_to_bring_grouped_by_category_use_main_edit_then_",
  "No matching entries.": "interface.messages.no_matching_entries",
  "Welcome Message": "interface.messages.welcome_message_title",
  "Categories": "interface.messages.categories",
  "Types": "interface.messages.types",
  "Rows per page": "interface.messages.rows_per_page",
  "Previous": "interface.messages.previous",
  "Next": "interface.messages.next",
  "Page {page} of {pages}": "interface.messages.page_page_of_pages",
  "Edit translation": "interface.messages.edit_translation",
  "Export CSV": "interface.messages.export_csv",
  "Use the pencil to open an item, then save your changes.": "interface.messages.use_the_pencil_to_open_an_item_then_save_your_changes",
  "Translate welcome messages, venues, sessions and food. Interface wording is in Settings → Languages.": "interface.messages.main_language_help",
  "Guest note": "interface.messages.guest_note",
  "Translate the item name and the note shown to guests. Types are translated in Languages → Food → Types.": "interface.messages.food_translation_help",
  "English source": "interface.messages.english_source",
  "Unavailable": "interface.messages.unavailable",
  "＋ Add category": "interface.messages.plus_add_category",
  "Edit category": "interface.messages.edit_category",
  "Delete category": "interface.messages.delete_category",
  "Move items to another category before deleting this category.": "interface.messages.move_items_before_deleting_category",
  "Delete empty category?": "interface.messages.delete_empty_category",
  "Category deleted": "interface.messages.category_deleted",
  "Category saved": "interface.messages.category_saved",
  "Manage types": "interface.messages.manage_types",
  "Types are shared by all food items. Translate each type once for every enabled language.": "interface.messages.shared_food_types_help",
  "Built-in": "interface.messages.built_in",
  "Custom": "interface.messages.custom",
  "Translate": "interface.messages.translate",
  "+ Add type": "interface.messages.add_type",
  "This type already exists.": "interface.messages.type_already_exists",
  "Type added": "interface.messages.type_added",
  "＋ Add venue": "interface.messages.plus_add_venue",
  "＋ Add session": "interface.messages.plus_add_session",
  "Move venue up": "interface.messages.move_venue_up",
  "Move venue down": "interface.messages.move_venue_down",
  "Venue order saved": "interface.messages.venue_order_saved",
  "Admin note": "interface.messages.admin_note",
  "Unit": "interface.messages.unit",
  "Batch": "interface.messages.batch_singular",
  "Piece": "interface.messages.piece_singular",
  "Tray": "interface.messages.tray_singular",
  "Packet": "interface.messages.packet_singular",
  "Gram": "interface.messages.gram_singular",
  "Saving…": "interface.messages.saving_progress",
  "Show more": "interface.messages.show_more",
  "Show less": "interface.messages.show_less",
  "Translate in Languages": "interface.messages.translate_in_languages",
  "Swipe for more tabs": "interface.messages.more_tabs_hint",
  "All wording": "interface.messages.all_wording",
  "General": "interface.messages.general",
  "Households & guests": "interface.messages.households_and_guests",
  "Invites & RSVP": "interface.messages.invites_and_rsvp",
  "Food & units": "interface.messages.food_and_units",
  "Venues & sessions": "interface.messages.venues_and_sessions",
  "Administrators & access": "interface.messages.administrators_and_access",
  "Wording categories": "interface.messages.wording_categories",
  "Main": "interface.messages.main",
  "Interface": "interface.messages.interface",
  "Administration areas": "interface.messages.administration_areas",
  "Personal preferences for this device.": "interface.messages.personal_device_preferences",
  "Translate event content for guests.": "interface.messages.translate_event_content",
  "Manage invitations, food and event details.": "interface.messages.main_section_description",
  "View mode": "interface.messages.view_mode",
  "Edit mode": "interface.messages.edit_mode",
  "Switch to light mode": "interface.messages.switch_to_light_mode",
  "Switch to dark mode": "interface.messages.switch_to_dark_mode",
  "Saved": "interface.messages.saved_status",
  "Error": "interface.messages.error_status",
  "Fully assigned": "interface.messages.fully_assigned",
  "Hidden": "interface.messages.hidden_status",
  "Access": "interface.messages.access_access",
  "Access preset": "interface.messages.access_access_preset",
  "Active": "interface.messages.access_active",
  "Administrator management": "interface.messages.access_administrator_management",
  "Administrator permissions are unavailable.": "interface.messages.access_administrator_permissions_are_unavailable",
  "Browser session": "interface.messages.access_browser_session",
  "Custom access · {edit} editable, {view} view only": "interface.messages.access_custom_access_edit_editable_view_view_only",
  "Edit access": "interface.messages.access_edit_access",
  "Enable": "interface.messages.access_enable",
  "Export application backup": "interface.messages.access_export_application_backup",
  "Full administrator": "interface.messages.access_full_administrator",
  "Invites & delivery": "interface.messages.access_invites_delivery",
  "Languages & settings": "interface.messages.access_languages_settings",
  "Last activity": "interface.messages.access_last_activity",
  "Manage": "interface.messages.access_manage",
  "No access": "interface.messages.access_no_access",
  "View": "interface.messages.access_view",
  "View only": "interface.messages.access_view_only",
  "No access hides a section. View shows summaries. Edit allows changes.": "interface.messages.access_no_access_hides_a_section_view_shows_summaries_edit_allows_changes",
  "No active sessions.": "interface.messages.access_no_active_sessions",
  "No administrators to display.": "interface.messages.access_no_administrators_to_display",
  "No eligible verified Auth account found. Send an invitation instead.": "interface.messages.access_no_eligible_verified_auth_account_found_send_an_invitation_instead",
  "Only Full administrators can change access.": "interface.messages.access_only_full_administrators_can_change_access",
  "Only Full administrators can change access. Settings excludes administrator and backup powers.": "interface.messages.access_only_full_administrators_can_change_access_settings_excludes_administrator_and_backup_powers",
  "Remove administrator": "interface.messages.access_remove_administrator",
  "Remove administrator {name}? Their Auth account and historical records remain.": "interface.messages.access_remove_administrator_name_their_auth_account_and_historical_records_remain",
  "Restored · Disabled": "interface.messages.access_restored_disabled",
  "Revoke": "interface.messages.access_revoke",
  "Revoke other administrators’ sessions": "interface.messages.access_revoke_other_administrators_sessions",
  "Revoke this application session?": "interface.messages.access_revoke_this_application_session",
  "Revoke this session? You will return to login.": "interface.messages.access_revoke_this_session_you_will_return_to_login",
  "Revoke your other application sessions?": "interface.messages.access_revoke_your_other_application_sessions",
  "Save access changes for {name}?": "interface.messages.access_save_access_changes_for_name",
  "Section": "interface.messages.access_section",
  "Send invitations & reminders": "interface.messages.access_send_invitations_reminders",
  "Sending is separate from editing invitations. Backup exports include data from the whole event.": "interface.messages.access_sending_is_separate_from_editing_invitations_backup_exports_include_data_from_the_whole_event",
  "Signed in": "interface.messages.access_signed_in",
  "Suspend": "interface.messages.access_suspend",
  "Suspended": "interface.messages.access_suspended",
  "This session": "interface.messages.access_this_session",
  "Suspend administrator {name}? Their current sessions will lose application access.": "interface.messages.access_suspend_administrator_name_their_current_sessions_will_lose_application_access",
  "Enable administrator {name} with their saved access?": "interface.messages.access_enable_administrator_name_with_their_saved_access",
  "Add {email} with View only access? No invitation email will be sent.": "interface.messages.access_add_email_with_view_only_access_no_invitation_email_will_be_sent",
  "Active sessions": "interface.messages.access_active_sessions",
  "Revoke my other sessions": "interface.messages.access_revoke_my_other_sessions",
  "Revocation ends access to this application. Everyone can revoke their own sessions.": "interface.messages.access_revocation_ends_access_to_this_application_everyone_can_revoke_their_own_sessions",
  "Add administrator": "interface.messages.access_add_administrator",
  "Add manually": "interface.messages.access_add_manually",
  "Your administrator access or session has ended. Sign in again.": "interface.messages.access_your_administrator_access_or_session_has_ended_sign_in_again",
  "New administrators start with View only access. Full administrators can customize it.": "interface.messages.access_new_administrators_start_with_view_only_access_full_administrators_can_customize_it",
  "This action is not allowed by your administrator permissions.": "interface.messages.access_this_action_is_not_allowed_by_your_administrator_permissions",
  "Use the available tabs to open the sections you can access.": "interface.messages.access_use_the_available_tabs_to_open_the_sections_you_can_access"
}$json$::jsonb $catalog$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261108171032_food_dialog_wording.sql
-- Extend the interface wording registry without touching event records or permissions.
BEGIN;
DO $migration$
DECLARE definition text; additions jsonb := '{"Close": "interface.messages.popup_close", "Preview": "interface.messages.pdf_print_preview", "No recipe has been added yet.": "food.messages.no_recipe_yet"}'::jsonb;
BEGIN
 definition:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $migration$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Extend the interface wording registry without touching event records or permissions.
BEGIN;
DO $migration$
DECLARE definition text; additions jsonb := '{"Adults: {adults} · Children: {children}": "interface.messages.guest_age_summary", "Quantity: {claimed}/{needed} {type}": "interface.messages.quantity_claimed_needed_type"}'::jsonb;
BEGIN
 definition:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $migration$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

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

BEGIN;

-- Keep the profile, primary guest, and food permission in one transaction.
CREATE OR REPLACE FUNCTION public.admin_save_household_with_food(p_id uuid,p_values jsonb,p_food boolean,p_expected_food boolean)
 RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE household_id uuid;
BEGIN
 household_id:=public.admin_save_household(p_id,p_values);
 IF p_values ? 'primary_guest_id' THEN
  PERFORM public.admin_set_household_primary_guest(household_id,(p_values->>'primary_guest_id')::uuid);
 END IF;
 IF p_food IS NOT NULL THEN
  PERFORM public.admin_set_food_access(household_id,p_food,p_expected_food,'Updated from Household details');
 END IF;
 RETURN household_id;
END $$;

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:='{"Landline":"interface.messages.household_landline","Missing contact":"interface.messages.missing_contact","No previous contact details.":"interface.messages.no_previous_contact_details","OR":"interface.messages.contact_alternative_or"}';
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;

NOTIFY pgrst,'reload schema';
COMMIT;

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

BEGIN;

CREATE OR REPLACE FUNCTION app_private.check_primary_guest() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.primary_guest_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.guests g JOIN public.households source ON source.id=g.household_id
  WHERE g.id=NEW.primary_guest_id AND NOT g.is_child AND g.archived_at IS NULL AND source.archived_at IS NULL
 ) THEN RAISE EXCEPTION 'Choose an active non-child guest from an active household';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app_private.clear_ineligible_primary_guest() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.is_child OR NEW.archived_at IS NOT NULL OR EXISTS(
  SELECT 1 FROM public.households WHERE id=NEW.household_id AND archived_at IS NOT NULL
 ) THEN
  UPDATE public.households SET primary_guest_id=NULL WHERE primary_guest_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION app_private.clear_archived_household_primary_guests() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.households target SET primary_guest_id=NULL
 FROM public.guests guest WHERE guest.household_id=NEW.id AND target.primary_guest_id=guest.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.clear_archived_household_primary_guests() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clear_archived_household_primary_guests AFTER UPDATE OF archived_at ON public.households
 FOR EACH ROW WHEN (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
 EXECUTE FUNCTION app_private.clear_archived_household_primary_guests();

DO $assignment$
DECLARE definition text:=pg_get_functiondef('public.admin_set_household_primary_guest(uuid,uuid)'::regprocedure);
 needle text:='WHERE id=p_guest_id AND household_id=p_household_id AND NOT is_child AND archived_at IS NULL';
BEGIN
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected primary guest lookup';END IF;
 EXECUTE replace(replace(definition,needle,$lookup$
 WHERE id=p_guest_id AND NOT is_child AND archived_at IS NULL
 AND EXISTS(SELECT 1 FROM public.households source WHERE source.id=guests.household_id AND source.archived_at IS NULL)$lookup$),
 'Choose an active non-child guest from this household','Choose an active non-child guest from an active household');
END $assignment$;

CREATE OR REPLACE FUNCTION app_private.delivery_household(h public.households) RETURNS public.households
 LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE guest public.guests;
BEGIN
 IF h.primary_guest_id IS NOT NULL THEN
  SELECT g.* INTO guest FROM public.guests g JOIN public.households source ON source.id=g.household_id
  WHERE g.id=h.primary_guest_id AND NOT g.is_child AND g.archived_at IS NULL AND source.archived_at IS NULL;
  h.email:=CASE WHEN FOUND THEN guest.email ELSE NULL END;
  h.phone:=CASE WHEN FOUND THEN guest.mobile ELSE NULL END;
  h.whatsapp:=h.phone;
  h.preferred_contact_method:=CASE WHEN FOUND THEN coalesce(guest.preferred_contact_method,h.preferred_contact_method) ELSE NULL END;
 END IF;
 RETURN h;
END $$;

-- Keep the existing Invites projection restricted to active guests selected
-- by an active household. No delivery queue rows or recipient snapshots change.
DO $projection$
DECLARE definition text:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 needle text:='EXISTS(SELECT 1 FROM public.households WHERE id=a.household_id AND primary_guest_id=a.id)';
BEGIN
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected primary guest projection';END IF;
 EXECUTE replace(definition,needle,$scope$
 a.archived_at IS NULL AND NOT a.is_child
 AND EXISTS(SELECT 1 FROM public.households source WHERE source.id=a.household_id AND source.archived_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.households target WHERE target.primary_guest_id=a.id AND target.archived_at IS NULL)$scope$);
END $projection$;

DO $backup$
DECLARE definition text:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 needle text:=' AND g->>''household_id''=h->>''id'' AND g->>''is_child''=''false''';
BEGIN
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup primary guest check';END IF;
 EXECUTE replace(definition,needle,' AND g->>''is_child''=''false''');
END $backup$;

NOTIFY pgrst,'reload schema';
COMMIT;

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

BEGIN;

LOCK TABLE public.households IN ACCESS EXCLUSIVE MODE;

DO $cleanup$
DECLARE definition text:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 needle text:='-''stuff''-''things''';
BEGIN
 IF EXISTS(SELECT 1 FROM public.households WHERE stuff OR things) THEN
  RAISE EXCEPTION 'Review populated household flags before removing them';
 END IF;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected household projection';END IF;
 EXECUTE replace(definition,needle,'');
END $cleanup$;

ALTER TABLE public.households DROP COLUMN stuff, DROP COLUMN things;

NOTIFY pgrst,'reload schema';
COMMIT;
BEGIN;

-- The existing message_templates table already participates in application backups.
-- Reserve this key for the validated Settings editor.
CREATE POLICY invitation_template_insert ON public.message_templates AS RESTRICTIVE
 FOR INSERT TO authenticated WITH CHECK (template_key <> 'invitation');
CREATE POLICY invitation_template_update ON public.message_templates AS RESTRICTIVE
 FOR UPDATE TO authenticated USING (template_key <> 'invitation')
 WITH CHECK (template_key <> 'invitation');
CREATE POLICY invitation_template_delete ON public.message_templates AS RESTRICTIVE
 FOR DELETE TO authenticated USING (template_key <> 'invitation');

CREATE FUNCTION public.admin_save_invitation_template(
 p_language text, p_channel text, p_subject text, p_body text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 subject_text text:=btrim(coalesce(p_subject,''), E' \t\r\n');
 body_text text:=btrim(coalesce(p_body,''), E' \t\r\n');
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_channel IS NULL OR p_channel NOT IN ('email','sms','whatsapp') OR NOT EXISTS(
  SELECT 1 FROM public.event_languages WHERE language_code=p_language AND enabled
 ) THEN
  RAISE EXCEPTION 'Choose an enabled language and a supported delivery channel.';
 END IF;
 IF char_length(subject_text)>300 OR char_length(body_text)>4000
   OR (p_channel<>'email' AND subject_text<>'') OR subject_text ~ E'[\r\n]' THEN
  RAISE EXCEPTION 'The invitation template has an invalid subject or message length.';
 END IF;
 IF body_text='' AND subject_text='' THEN
  DELETE FROM public.message_templates WHERE template_key='invitation'
   AND language_code=p_language AND channel=p_channel;
  RETURN;
 END IF;
 IF strpos(body_text,'{invitation_link}')=0 THEN
  RAISE EXCEPTION 'Include the invitation link placeholder in the message.';
 END IF;
 IF EXISTS(
  SELECT 1 FROM regexp_matches(subject_text||E'\n'||body_text,'\{([[:alnum:]_]+)\}','g') AS token
  WHERE token[1] NOT IN ('invitation_link','event_name','household_name')
 ) THEN
  RAISE EXCEPTION 'The invitation template contains an unknown placeholder.';
 END IF;

 INSERT INTO public.message_templates(template_key,language_code,channel,subject,body)
 VALUES('invitation',p_language,p_channel,nullif(subject_text,''),body_text)
 ON CONFLICT (template_key,language_code,channel) DO UPDATE
 SET subject=excluded.subject,body=excluded.body,is_active=true;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_invitation_template(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_invitation_template(text,text,text,text) TO authenticated;

DO $load$
DECLARE
 definition text:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 marker text:=' ''languages'',coalesce';
BEGIN
 IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Unexpected administrator language projection';END IF;
 EXECUTE replace(definition,marker,$projection$
 'invitationTemplates',CASE WHEN s OR i THEN coalesce((
  SELECT jsonb_agg(jsonb_build_object('language_code',language_code,'channel',channel,'subject',subject,'body',body))
  FROM public.message_templates
  WHERE template_key='invitation' AND is_active AND channel IN ('email','sms','whatsapp')
 ),'[]') ELSE '[]'::jsonb END,
 'languages',coalesce$projection$);
END $load$;

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:=$labels${
 "Templates": "interface.messages.templates",
 "Invitation templates": "interface.messages.invitation_templates",
 "Set the starting wording for new invitation drafts by language and delivery channel.": "interface.messages.invitation_templates_description",
 "No custom template. New drafts use fallback wording.": "interface.messages.invitation_template_fallback",
 "Include the invitation link placeholder. Clear the fields to use fallback wording.": "interface.messages.invitation_template_help",
 "Save template": "interface.messages.save_invitation_template",
 "Include the invitation link placeholder in the message.": "interface.messages.invitation_template_link_required",
 "The invitation template contains an unknown placeholder.": "interface.messages.invitation_template_unknown_placeholder"
}$labels$::jsonb;
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

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

BEGIN;

CREATE FUNCTION app_private.backup_as_template(b jsonb, sections text[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 payload jsonb:=b->'payload';
 tables jsonb:=payload->'tables';
 counts jsonb:='{}';
 selected text[]:=ARRAY['public.event_languages','public.event_settings'];
 t text;
BEGIN
 PERFORM app_private.validate_backup(b);
 IF sections IS NULL OR EXISTS(
  SELECT 1 FROM unnest(sections) AS s WHERE s IS NULL OR s NOT IN ('venues','households','food','other','wording')
 ) THEN RAISE EXCEPTION 'Choose valid backup template sections.'; END IF;

 IF 'venues'=ANY(sections) THEN selected:=selected||ARRAY[
  'public.event_locations','public.event_sessions','public.venue_translations','public.session_translations'
 ];END IF;
 IF 'households'=ANY(sections) THEN selected:=selected||ARRAY[
  'public.relation_groups','public.households','public.guests','public.household_contacts'
 ];END IF;
 IF ARRAY['venues','households'] <@ sections THEN selected:=selected||ARRAY[
  'public.household_session_defaults','public.guest_session_overrides'
 ];END IF;
 IF 'food'=ANY(sections) THEN selected:=selected||ARRAY[
  'public.food_categories','public.food_item_types','public.food_items','public.food_item_translations',
  'public.food_category_translations','public.food_type_translations'
 ];END IF;
 IF 'other'=ANY(sections) THEN selected:=selected||ARRAY['public.other_categories','public.other_items'];END IF;
 IF 'wording'=ANY(sections) THEN selected:=selected||ARRAY[
  'public.event_translations','public.translation_overrides','public.message_templates'
 ];END IF;

 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF NOT t=ANY(selected) THEN
   tables:=jsonb_set(tables,ARRAY[t],'[]');
  ELSIF t='public.households' THEN
   tables:=jsonb_set(tables,ARRAY[t],coalesce((SELECT jsonb_agg(value||jsonb_build_object(
    'invite_code',NULL,'rsvp_state','open','rsvp_submitted_at',NULL,'latest_rsvp_submission_id',NULL,
    'late_submission_until',NULL,'visited',false,'visited_at',NULL,'food_confirmed',false,'food_confirmed_at',NULL
   )) FROM jsonb_array_elements(tables->t)),'[]'));
  ELSIF t='public.guests' THEN
   tables:=jsonb_set(tables,ARRAY[t],coalesce((SELECT jsonb_agg(value||'{"rsvp_status":"pending"}')
    FROM jsonb_array_elements(tables->t)),'[]'));
  ELSIF t=ANY(ARRAY['public.event_translations','public.translation_overrides','public.venue_translations',
     'public.session_translations','public.food_item_translations','public.food_category_translations','public.food_type_translations']) THEN
   tables:=jsonb_set(tables,ARRAY[t],coalesce((SELECT jsonb_agg(value||'{"updated_by":null}')
    FROM jsonb_array_elements(tables->t)),'[]'));
  ELSIF t='public.food_items' AND NOT 'venues'=ANY(sections) THEN
   -- Keep venue-specific items unavailable until they are assigned to new venues.
   tables:=jsonb_set(tables,ARRAY[t],coalesce((SELECT jsonb_agg(
    CASE WHEN value->'venue_ids'='null' THEN value ELSE value||'{"venue_ids":[]}' END
   ) FROM jsonb_array_elements(tables->t)),'[]'));
  END IF;
  counts:=counts||jsonb_build_object(t,jsonb_array_length(tables->t));
 END LOOP;
 payload:=(payload-'administrator_reference')||jsonb_build_object('tables',tables,'counts',counts,'identities','[]'::jsonb);
 RETURN b||jsonb_build_object('payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION public.admin_preview_backup_template(p_backup jsonb,p_sections text[]) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('restoreBackup');
 RETURN public.admin_preview_backup(app_private.backup_as_template(p_backup,p_sections));
END $$;

CREATE FUNCTION public.admin_restore_backup_template(p_backup jsonb,p_sections text[],p_confirmation text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('restoreBackup');
 RETURN public.admin_restore_backup(app_private.backup_as_template(p_backup,p_sections),p_confirmation);
END $$;

REVOKE ALL ON FUNCTION app_private.backup_as_template(jsonb,text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_preview_backup_template(jsonb,text[]),public.admin_restore_backup_template(jsonb,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_preview_backup_template(jsonb,text[]),public.admin_restore_backup_template(jsonb,text[],text) TO authenticated;
DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:=$labels${
 "(preview)": "interface.messages.preview_marker",
 "Unpublished · Guest preview only": "interface.messages.unpublished_preview_only",
 "Invitation delivery opens when the event is published.": "interface.messages.delivery_requires_publication",
 "Delete household": "interface.messages.delete_household",
 "Delete guest": "interface.messages.delete_guest",
 "Permanently delete this record?": "interface.messages.confirm_delete_record",
 "Record deleted.": "interface.messages.record_deleted",
 "Choose a record that can be deleted.": "interface.messages.choose_deletable_record",
 "Move or delete guests and child households first.": "interface.messages.delete_move_dependents",
 "Remove this guest’s household contact assignments first.": "interface.messages.delete_remove_contact_assignments",
 "Restore mode": "interface.messages.restore_mode",
 "Full backup": "interface.messages.restore_full_backup",
 "Planning template": "interface.messages.restore_planning_template",
 "Include in template": "interface.messages.restore_template_include",
 "Event settings and languages are always included. Invitation codes, replies, food commitments, delivery history and administrator records are cleared.": "interface.messages.restore_template_info",
 "Wording & invitation templates": "interface.messages.restore_template_wording"
}$labels$::jsonb;
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_sessions() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_live_session();IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required. Sign in again.' USING ERRCODE='PT401';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'user_id',s.user_id,'name',a.name,'created_at',s.created_at,'refreshed_at',to_jsonb(s)->>'refreshed_at','last_activity',coalesce(to_jsonb(s)->>'refreshed_at',to_jsonb(s)->>'updated_at',s.created_at::text),'user_agent',left(coalesce(to_jsonb(s)->>'user_agent',''),300),'current',s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) ORDER BY s.created_at DESC) FROM auth.sessions s JOIN public.admins a ON a.user_id=s.user_id WHERE a.access_state='active' AND (s.user_id=auth.uid() OR public.admin_has_permission('revokeSessions')) AND (to_jsonb(s)->>'not_after' IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>statement_timestamp()) AND NOT EXISTS(SELECT 1 FROM app_private.admin_session_revocations r WHERE r.session_id=s.id)),'[]');
END $$;
-- Preserve legacy session output for older clients. The new interface uses
-- refreshed_at only, so an updated or created timestamp cannot look like a renewal.
DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:=$labels${
 "Enable access": "interface.messages.access_enable_access",
 "Suspend access": "interface.messages.access_suspend_access",
 "Revoke session": "interface.messages.access_revoke_session",
 "Session refreshed": "interface.messages.access_session_refreshed",
 "{browser} on {device}": "interface.messages.access_session_browser_device",
 "Apple device": "interface.messages.access_session_apple_device",
 "Session refreshed shows when the sign-in session last renewed. Revocation ends access to this application. Everyone can revoke their own sessions.": "interface.messages.access_session_refresh_help",
 "Permanently delete {name}?": "interface.messages.confirm_delete_named_record",
 "Remove assignment for {household}": "interface.messages.remove_named_assignment",
 "Remove {household}’s assignment for {item}?": "interface.messages.confirm_remove_food_assignment",
 "Show to guests": "interface.messages.show_to_guests",
 "Hide from guests": "interface.messages.hide_from_guests",
 "Hidden from guests": "interface.messages.hidden_from_guests"
}$labels$::jsonb;
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:=$labels${
 "Review RSVP": "interface.messages.rsvp_review",
 "Check the answers for each guest and session. Confirming locks the RSVP.": "interface.messages.rsvp_review_help",
 "Confirm RSVP": "interface.messages.rsvp_confirm",
 "Back to edit": "interface.messages.rsvp_back_to_edit",
 "Apply to everyone invited": "interface.messages.rsvp_apply_to_everyone",
 "Fills unanswered choices only.": "interface.messages.rsvp_fill_unanswered_only"
}$labels$::jsonb;
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;
REVOKE ALL ON FUNCTION app_private.translation_keys() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;

CREATE FUNCTION app_private.legacy_planning_configuration() RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"groups":[{"id":"maria_haass","names":{"en":"Maria Haass"}},{"id":"paetur_hentze","names":{"en":"Pætur Hentze"}}],"labels":{"households":{},"guests":{}}}'::jsonb
$$;

CREATE FUNCTION app_private.valid_planning_names(names jsonb) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN jsonb_typeof(names)='object' THEN NOT EXISTS(
  SELECT 1 FROM jsonb_each(names) AS name(code,value)
  WHERE code !~ '^[A-Za-z0-9-]{2,16}$' OR jsonb_typeof(value)<>'string'
   OR length(btrim(value#>>'{}')) NOT BETWEEN 1 AND 140
 ) ELSE false END
$$;

CREATE FUNCTION app_private.valid_planning_configuration(config jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; group_id text; ids text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(config) IS DISTINCT FROM 'object' OR octet_length(config::text)>65536
  OR jsonb_typeof(config->'groups') IS DISTINCT FROM 'array'
  OR jsonb_typeof(config->'labels') IS DISTINCT FROM 'object'
  OR NOT app_private.valid_planning_names(config->'labels'->'households')
  OR NOT app_private.valid_planning_names(config->'labels'->'guests') THEN RETURN false;END IF;
 IF jsonb_array_length(config->'groups') NOT BETWEEN 1 AND 40 THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(config->'groups') LOOP
  group_id:=item->>'id';
  IF group_id IS NULL OR group_id !~ '^[a-z][a-z0-9_]{0,63}$' OR group_id=ANY(ids)
   OR NOT app_private.valid_planning_names(item->'names') OR item->'names'->>'en' IS NULL THEN RETURN false;END IF;
  ids:=array_append(ids,group_id);
 END LOOP;
 RETURN true;
END $$;

ALTER TABLE public.event_settings
 ADD COLUMN planning_config jsonb NOT NULL DEFAULT app_private.legacy_planning_configuration(),
 ADD CONSTRAINT event_planning_configuration_check CHECK(app_private.valid_planning_configuration(planning_config));
ALTER TABLE public.event_settings ALTER COLUMN planning_config SET DEFAULT
 '{"groups":[{"id":"general","names":{"en":"General","de":"Allgemein","fo":"Alment"}}],"labels":{"households":{},"guests":{}}}'::jsonb;
UPDATE public.event_settings SET planning_config=DEFAULT
 WHERE id=1 AND NOT EXISTS(SELECT 1 FROM public.households);
ALTER TABLE public.households DROP CONSTRAINT households_side_check;
ALTER TABLE public.households ADD CONSTRAINT households_side_key_check CHECK(side ~ '^[a-z][a-z0-9_]{0,63}$');

CREATE FUNCTION app_private.guard_household_planning_group() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF NOT EXISTS(SELECT 1 FROM public.event_settings e
  CROSS JOIN LATERAL jsonb_array_elements(e.planning_config->'groups') g
  WHERE e.id=1 AND g->>'id'=NEW.side) THEN
  RAISE EXCEPTION 'Choose an existing household group.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_household_planning_group BEFORE INSERT OR UPDATE OF side ON public.households
 FOR EACH ROW EXECUTE FUNCTION app_private.guard_household_planning_group();

CREATE FUNCTION app_private.guard_planning_group_removal() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.households h WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(NEW.planning_config->'groups') g WHERE g->>'id'=h.side
 )) THEN RAISE EXCEPTION 'Move households out of a group before removing it.';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lock_planning_configuration BEFORE UPDATE OF planning_config ON public.event_settings
 FOR EACH STATEMENT EXECUTE FUNCTION app_private.lock_publication();
CREATE TRIGGER guard_planning_group_removal BEFORE UPDATE OF planning_config ON public.event_settings
 FOR EACH ROW EXECUTE FUNCTION app_private.guard_planning_group_removal();

CREATE FUNCTION public.admin_save_planning_configuration(
 p_config jsonb,p_expected_config jsonb,p_preset text,p_expected_preset text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF NOT app_private.valid_planning_configuration(p_config) OR p_preset IS NULL OR (p_preset IS DISTINCT FROM p_expected_preset AND p_preset NOT IN ('wedding','reunion','conference','custom')) THEN
  RAISE EXCEPTION 'Enter valid event planning settings.';
 END IF;
 UPDATE public.event_settings SET planning_config=p_config,event_type=p_preset,updated_at=now()
 WHERE id=1 AND planning_config=p_expected_config AND event_type=p_expected_preset;
 IF NOT FOUND THEN RAISE EXCEPTION 'Planning settings changed. Refresh and try again.';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_planning_configuration(jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_planning_configuration(jsonb,jsonb,text,text) TO authenticated;

DO $projections$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 needle:='''fallback_language'',e.fallback_language,''is_published'',e.is_published';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected administrator settings projection';END IF;
 EXECUTE replace(definition,needle,needle||',''planning_config'',e.planning_config');
 definition:=pg_get_functiondef('app_private.guest_event()'::regprocedure);
 IF position('to_jsonb(e)' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected public event projection';END IF;
 EXECUTE replace(definition,'to_jsonb(e)','to_jsonb(e)-''planning_config''');
 definition:=pg_get_functiondef('public.get_public_event()'::regprocedure);
 IF position('to_jsonb(e)' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected legacy public event projection';END IF;
 EXECUTE replace(definition,'to_jsonb(e)','to_jsonb(e)-''planning_config''');
END $projections$;

-- Accept backups from before the settings column was introduced. The original
-- checksum and every other column check still apply.
DO $backup$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 needle:='IF payload->''columns''->t IS DISTINCT FROM app_private.backup_columns(t)';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup manifest validation';END IF;
 definition:=replace(definition,needle,needle||$legacy$
  AND NOT (t='public.event_settings' AND payload->'columns'->t=(
   SELECT jsonb_agg(col ORDER BY position)
   FROM jsonb_array_elements(app_private.backup_columns(t)) WITH ORDINALITY AS fields(col,position)
   WHERE col->>'name'<>'planning_config'
  ))$legacy$);
 needle:='RETURN jsonb_build_object(''rows'',n,';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup validation result';END IF;
 EXECUTE replace(definition,needle,$groups$
  IF NOT app_private.valid_planning_configuration(coalesce(payload->'tables'->'public.event_settings'->0->'planning_config',app_private.legacy_planning_configuration()))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h WHERE NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(coalesce(payload->'tables'->'public.event_settings'->0->'planning_config',app_private.legacy_planning_configuration())->'groups') g
     WHERE g->>'id'=h->>'side'
    )) THEN RAISE EXCEPTION 'Invalid household groups in backup';END IF;
  $groups$||needle);
 definition:=pg_get_functiondef('app_private.restore_backup(jsonb)'::regprocedure);
 needle:='IF t=''public.event_settings'' THEN row:=row||''{"is_published":false}''::jsonb;END IF;';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected backup event settings restore';END IF;
 EXECUTE replace(definition,needle,$restore$
  IF t='public.event_settings' THEN row:=row||jsonb_build_object('is_published',false,
   'planning_config',coalesce(row->'planning_config',app_private.legacy_planning_configuration()));END IF;
  $restore$);
END $backup$;

REVOKE ALL ON FUNCTION app_private.guard_household_planning_group(),app_private.guard_planning_group_removal() FROM PUBLIC,anon,authenticated;

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 additions jsonb:=$labels${
 "Top-level group": "interface.messages.top_level_group",
 "Event planning": "interface.messages.event_planning",
 "Event preset": "interface.messages.event_preset",
 "Wedding": "interface.messages.event_preset_wedding",
 "Reunion": "interface.messages.event_preset_reunion",
 "Conference": "interface.messages.event_preset_conference",
 "Use preset suggestions": "interface.messages.event_apply_preset",
 "Preset suggestions add missing groups and fill blank labels. Review them before saving.": "interface.messages.event_preset_help",
 "Shared labels": "interface.messages.event_shared_labels",
 "Move group up": "interface.messages.event_move_group_up",
 "Move group down": "interface.messages.event_move_group_down",
 "Remove group": "interface.messages.event_remove_group",
 "Add group": "interface.messages.event_add_group",
 "Save planning settings": "interface.messages.event_save_planning",
 "Family": "interface.messages.event_group_family",
 "Friends": "interface.messages.event_group_friends",
 "Attendees": "interface.messages.event_group_attendees",
 "Speakers": "interface.messages.event_group_speakers",
 "Bookings": "interface.messages.event_label_bookings",
 "Participants": "interface.messages.event_label_participants"
}$labels$::jsonb;
BEGIN
 IF position('$json$::jsonb' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected translation registry definition';END IF;
 EXECUTE replace(definition,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $wording$;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261110194427_clean_household_grouping.sql
BEGIN;

-- Rename the assignment in place so configured group IDs and all household
-- relationships retain their values. PostgreSQL updates column dependencies.
ALTER TABLE public.households RENAME COLUMN side TO planning_group_id;
ALTER TABLE public.households RENAME CONSTRAINT households_side_key_check TO households_planning_group_id_check;

-- These functions use PL/pgSQL bodies or explicit JSON keys. Their existing
-- permissions, signatures and other application rules stay in place.
DO $grouping$
DECLARE
 target regprocedure;
 definition text;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'app_private.guard_household_planning_group()'::regprocedure,
  'app_private.guard_management_parent()'::regprocedure,
  'app_private.guard_planning_group_removal()'::regprocedure,
  'public.admin_load_data()'::regprocedure,
  'public.admin_move_household(uuid,integer)'::regprocedure,
  'public.admin_save_household(uuid,jsonb)'::regprocedure,
  'public.admin_set_household_parent(uuid,uuid)'::regprocedure
 ] LOOP
  definition:=pg_get_functiondef(target);
  IF definition !~ '\mside\M' THEN RAISE EXCEPTION 'Unexpected household grouping definition for %',target;END IF;
  definition:=replace(definition,'same side and relation group','same top-level group and relation group');
  definition:=replace(replace(definition,'v_parent_side','v_parent_planning_group'),'v_side','v_planning_group');
  EXECUTE regexp_replace(definition,'\mside\M','planning_group_id','g');
 END LOOP;
END $grouping$;

-- Exports from this schema use the exact current table manifests. Retain
-- historical audit JSON as recorded, including keys used at the time.
DO $backups$
DECLARE
 definition text;
 start_marker constant text:='IF payload->''columns''->t IS DISTINCT FROM app_private.backup_columns(t)';
 end_marker constant text:=' THEN RAISE EXCEPTION ''Schema mismatch for %';
 configuration constant text:=$config$payload->'tables'->'public.event_settings'->0->'planning_config'$config$;
 fallback constant text:='app_private.legacy_planning_configuration()';
 start_at integer;
 end_at integer;
BEGIN
 definition:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(definition,'''20261101105111''')=0 THEN RAISE EXCEPTION 'Unexpected backup export schema version';END IF;
 EXECUTE replace(definition,'''20261101105111''','''20261110194427''');

 definition:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 start_at:=strpos(definition,start_marker);
 end_at:=strpos(definition,end_marker);
 IF start_at=0 OR end_at<=start_at OR strpos(definition,fallback)=0
  OR strpos(definition,'''20261101105111''')=0 THEN RAISE EXCEPTION 'Unexpected backup validation definition';END IF;
 definition:=overlay(definition PLACING start_marker FROM start_at FOR end_at-start_at);
 definition:=replace(definition,'''20261101105111''','''20261110194427''');
 definition:=replace(definition,'Unsupported backup schema version','Backup schema version does not match. Export a new application backup from the current version.');
 definition:=replace(definition,'coalesce('||configuration||','||fallback||')','('||configuration||')');
 definition:=replace(definition,'''side''','''planning_group_id''');
 IF strpos(definition,fallback)>0 THEN RAISE EXCEPTION 'Unexpected backup validation fallback';END IF;
 EXECUTE definition;

 definition:=pg_get_functiondef('app_private.restore_backup(jsonb)'::regprocedure);
 IF strpos(definition,fallback)=0 THEN RAISE EXCEPTION 'Expected backup restore fallback';END IF;
 definition:=regexp_replace(definition,
  $pattern$jsonb_build_object\('is_published',false,\s*'planning_config',coalesce\(row->'planning_config',app_private\.legacy_planning_configuration\(\)\)\)$pattern$,
  'jsonb_build_object(''is_published'',false)');
 IF strpos(definition,fallback)>0 THEN RAISE EXCEPTION 'Unexpected backup restore fallback';END IF;
 EXECUTE definition;
END $backups$;

DROP FUNCTION app_private.legacy_planning_configuration();

DO $wording$
DECLARE
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 old_entry constant text:='"Side": "interface.messages.side",';
BEGIN
 IF strpos(definition,old_entry)=0 THEN RAISE EXCEPTION 'Expected old household grouping wording';END IF;
 EXECUTE replace(definition,old_entry,'');
END $wording$;

DELETE FROM public.translation_overrides WHERE translation_key='interface.messages.side';

NOTIFY pgrst,'reload schema';
COMMIT;

-- Match fresh installations to the current backup schema.
-- This obsolete column is unused by the application. Preserve unexpected data.
BEGIN;
DO $cleanup$
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='households' AND column_name='family_name') THEN
  IF EXISTS (SELECT 1 FROM public.households WHERE family_name IS NOT NULL) THEN
   RAISE EXCEPTION 'Move remaining households.family_name values before removing the obsolete column';
  END IF;
  ALTER TABLE public.households DROP COLUMN family_name;
 END IF;
END $cleanup$;
NOTIFY pgrst,'reload schema';
COMMIT;

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

-- Collect household willingness before exposing the prepared menu.
BEGIN;
ALTER TABLE public.event_settings ADD COLUMN food_stage text NOT NULL DEFAULT 'interest' CHECK(food_stage IN ('interest','selection'));
ALTER TABLE public.households ADD COLUMN food_interest boolean;
CREATE FUNCTION public.admin_set_food_stage(p_stage text,p_expected_stage text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('food','edit');
 IF p_stage IS NULL OR p_stage NOT IN ('interest','selection') THEN RAISE EXCEPTION 'Choose a valid food stage';END IF;
 UPDATE public.event_settings SET food_stage=p_stage WHERE id=1 AND food_stage=p_expected_stage;
 IF NOT FOUND THEN RAISE EXCEPTION 'Food stage changed; refresh before saving';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_food_stage(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_food_stage(text,text) TO authenticated;
CREATE FUNCTION app_private.require_food_selection_stage() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.event_settings WHERE id=1 AND food_stage='selection' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The detailed food list is not open yet';END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.require_food_selection_stage() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.set_household_food_interest(p_code text,p_interest boolean,p_expected_interest boolean DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_interest IS NULL THEN RAISE EXCEPTION 'Invalid food interest response';END IF;
 PERFORM 1 FROM public.event_settings WHERE id=1 AND is_published FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.guests WHERE household_id=h.id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Invalid invitation';END IF;
 IF h.food_interest IS NOT DISTINCT FROM p_interest THEN RETURN app_private.guest_food(h.id,false);END IF;
 IF h.food_interest IS DISTINCT FROM p_expected_interest THEN RAISE EXCEPTION 'Food answer changed; refresh before saving';END IF;
 IF NOT p_interest AND (h.food_confirmed OR EXISTS(SELECT 1 FROM public.food_claims WHERE household_id=h.id)) THEN RAISE EXCEPTION 'Contact the organizer to change existing food commitments';END IF;
 UPDATE public.households SET food_interest=p_interest WHERE id=h.id;
 RETURN app_private.guest_food(h.id,false);
END $$;
REVOKE ALL ON FUNCTION public.set_household_food_interest(text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_household_food_interest(text,boolean,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.get_household_food(p_code text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.guest_food(h.id,false) FROM public.households h CROSS JOIN public.event_settings e
 WHERE e.id=1 AND e.is_published AND h.invite_code=p_code AND h.archived_at IS NULL AND (h.food OR e.food_stage='interest')
$$;
REVOKE ALL ON FUNCTION public.get_household_food(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_household_food(text) TO service_role;
DO $stage$
DECLARE d text;f regprocedure;needle text;inserted text;
BEGIN
 d:=pg_get_functiondef('app_private.guest_food(uuid,boolean)'::regprocedure);
 needle:='BEGIN'||chr(10)||' SELECT jsonb_build_object(';
 inserted:='BEGIN'||chr(10)||' IF (SELECT food_stage FROM public.event_settings WHERE id=1)=''interest'' THEN RETURN jsonb_build_object(''stage'',''interest'',''interest'',(SELECT food_interest FROM public.households WHERE id=v_household),''items'',''[]''::jsonb,''claims'',''[]''::jsonb,''groups'',''[]''::jsonb,''categories'',''[]''::jsonb,''confirmed'',false);END IF;'||chr(10)||' SELECT jsonb_build_object(';
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected guest food projection';END IF;
 d:=replace(d,needle,inserted);
 d:=replace(d,chr(10)||' SELECT jsonb_build_object(',chr(10)||' IF NOT p_sample AND NOT coalesce((SELECT food FROM public.households WHERE id=v_household),false) THEN RETURN jsonb_build_object(''stage'',''selection'',''interest'',(SELECT food_interest FROM public.households WHERE id=v_household),''items'',''[]''::jsonb,''claims'',''[]''::jsonb,''groups'',''[]''::jsonb,''categories'',''[]''::jsonb,''confirmed'',false);END IF;'||chr(10)||' SELECT jsonb_build_object(');
 d:=replace(d,'RETURN v_result;','RETURN v_result || jsonb_build_object(''stage'',''selection'',''interest'',(SELECT food_interest FROM public.households WHERE id=v_household));');EXECUTE d;
 d:=pg_get_functiondef('app_private.guest_event()'::regprocedure);
 needle:='c.content_key NOT LIKE ''ui:%''';
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected event content projection';END IF;
 d:=replace(d,needle,needle||' AND (e.food_stage=''selection'' OR (c.content_key NOT LIKE ''food:%'' AND c.content_key NOT LIKE ''food-category:%''))');EXECUTE d;
 d:=pg_get_functiondef('public.admin_guest_preview(uuid,boolean)'::regprocedure);
 d:=replace(d,'IF h.food THEN food:=','IF h.food OR (SELECT food_stage FROM public.event_settings WHERE id=1)=''interest'' THEN food:=');EXECUTE d;
 FOREACH f IN ARRAY ARRAY['public.set_household_food_claim(text,uuid,integer,text)'::regprocedure,'public.set_household_food_group(text,uuid,integer)'::regprocedure,'public.confirm_household_food(text)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);d:=regexp_replace(d,'\mBEGIN\M','BEGIN PERFORM app_private.require_food_selection_stage();','i');
  IF f='public.set_household_food_claim(text,uuid,integer,text)'::regprocedure OR f='public.set_household_food_group(text,uuid,integer)'::regprocedure THEN
   d:=regexp_replace(d,'END[[:space:]]*\$function\$', 'IF p_quantity>0 THEN UPDATE public.households SET food_interest=true WHERE id=h.id AND food_interest IS DISTINCT FROM true;END IF; END $function$');
  END IF;
  EXECUTE d;
 END LOOP;
 d:=pg_get_functiondef('public.guest_gateway_allow_request(text,text,text)'::regprocedure);d:=replace(d,'''get_invitation_v2''','''set_household_food_interest'',''get_invitation_v2''');EXECUTE d;
 d:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 d:=replace(d,'''is_published'',e.is_published','''is_published'',e.is_published,''food_stage'',e.food_stage');
 d:=replace(d,'''food_confirmed'',a.food_confirmed','''food_confirmed'',a.food_confirmed,''food_interest'',a.food_interest');
 d:=replace(d,'to_jsonb(a)-''notes''-''postal_address''-''food''-''food_confirmed''', 'to_jsonb(a)-''notes''-''postal_address''-''food''-''food_confirmed''-''food_interest''');
 EXECUTE d;
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);IF strpos(d,'''20261111104205''')=0 THEN RAISE EXCEPTION 'Unexpected backup version';END IF;EXECUTE replace(d,'''20261111104205''','''20261111125023''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);IF strpos(d,'''20261111104205''')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;EXECUTE replace(d,'''20261111104205''','''20261111125023''');
 d:=pg_get_functiondef('app_private.backup_as_template(jsonb,text[])'::regprocedure);
 d:=replace(d,'''food_confirmed_at'',NULL','''food_confirmed_at'',NULL,''food_interest'',NULL');
 needle:='payload:=(payload-';IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected template builder';END IF;
 d:=replace(d,needle,'tables:=jsonb_set(tables,ARRAY[''public.event_settings''],(SELECT jsonb_agg(value||''{"food_stage":"interest"}''::jsonb) FROM jsonb_array_elements(tables->''public.event_settings''))); '||needle);EXECUTE d;
END $stage$;
REVOKE ALL ON FUNCTION app_private.guest_food(uuid,boolean),app_private.guest_event(),app_private.backup_as_template(jsonb,text[]) FROM PUBLIC,anon,authenticated;

DO $labels$
DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure); additions jsonb:=$newlabels${"Food coordination": "interface.messages.food_coordination", "Guest food step": "interface.messages.food_stage", "Ask whether guests can bring food": "interface.messages.food_stage_interest", "Open the detailed food list": "interface.messages.food_stage_selection", "Keep the detailed list hidden while planning. Opening it does not publish the event. Hiding it again preserves all commitments.": "interface.messages.food_stage_help", "Open the detailed food list for eligible households? This does not publish the event.": "interface.messages.food_stage_confirm", "Guest food step saved.": "interface.messages.food_stage_saved", "Can you bring food?": "interface.messages.food_interest_question", "Let us know whether your household can bring food. We will send the invitation link again when the detailed list is ready.": "interface.messages.food_interest_help", "I can bring food": "interface.messages.food_interest_yes", "I can’t bring food": "interface.messages.food_interest_no", "Your food answer has been saved.": "interface.messages.food_interest_saved", "Could not save your food answer. Your choice is still here; refresh or contact the organizer if you already have commitments.": "interface.messages.food_interest_failed", "Not answered": "interface.messages.food_interest_pending", "Household food answers": "interface.messages.food_interest_answers", "Can bring food: {yes} · Cannot: {no} · Not answered: {pending}": "interface.messages.food_interest_totals"}$newlabels$::jsonb;
BEGIN
 IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;
 EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal(additions::text)||'::jsonb');
END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
ALTER TABLE public.event_settings ADD COLUMN food_enabled boolean NOT NULL DEFAULT true, ADD COLUMN other_enabled boolean NOT NULL DEFAULT true, ADD COLUMN food_introduction jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(food_introduction)='object');
CREATE FUNCTION public.admin_save_features(p_food boolean,p_other boolean,p_stage text,p_introduction jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_food IS NULL OR p_other IS NULL OR p_stage IS NULL OR p_stage NOT IN ('interest','selection') OR p_introduction IS NULL OR jsonb_typeof(p_introduction)<>'object' THEN RAISE EXCEPTION 'Invalid feature settings';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_introduction) x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>6000 OR NOT EXISTS(SELECT 1 FROM public.event_languages l WHERE l.language_code=x.key)) THEN RAISE EXCEPTION 'Invalid food explanation';END IF;
 UPDATE public.event_settings e SET food_enabled=p_food,other_enabled=p_other,food_stage=p_stage,food_introduction=p_introduction
 WHERE id=1 AND jsonb_build_object('food_enabled',e.food_enabled,'other_enabled',e.other_enabled,'food_stage',e.food_stage,'food_introduction',e.food_introduction)=p_expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'Feature settings changed; refresh before saving';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_features(boolean,boolean,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_features(boolean,boolean,text,jsonb,jsonb) TO authenticated;
DO $features$
DECLARE d text;f regprocedure;
BEGIN
 d:=pg_get_functiondef('public.admin_has_permission(text,text)'::regprocedure);
 IF strpos(d,'SELECT public.is_admin() AND')=0 THEN RAISE EXCEPTION 'Unexpected permission definition';END IF;
 d:=replace(d,'SELECT public.is_admin() AND','SELECT (CASE WHEN p_section=''food'' THEN coalesce((SELECT food_enabled FROM public.event_settings WHERE id=1),false) WHEN p_section=''other'' THEN coalesce((SELECT other_enabled FROM public.event_settings WHERE id=1),false) ELSE true END) AND public.is_admin() AND');EXECUTE d;
 d:=pg_get_functiondef('public.admin_load_data()'::regprocedure);
 d:=replace(d,'''food_stage'',e.food_stage','''food_stage'',e.food_stage,''food_enabled'',e.food_enabled,''other_enabled'',e.other_enabled');EXECUTE d;
 d:=pg_get_functiondef('app_private.guest_food(uuid,boolean)'::regprocedure);
 d:=regexp_replace(d,'\mBEGIN\M','BEGIN IF NOT coalesce((SELECT food_enabled FROM public.event_settings WHERE id=1),false) THEN RETURN NULL;END IF;','i');EXECUTE d;
 d:=pg_get_functiondef('public.get_household_food(text)'::regprocedure);d:=replace(d,'e.is_published','e.is_published AND e.food_enabled');EXECUTE d;
 d:=pg_get_functiondef('public.set_household_food_interest(text,boolean,boolean)'::regprocedure);d:=replace(d,'AND is_published FOR SHARE','AND is_published AND food_enabled FOR SHARE');EXECUTE d;
 d:=pg_get_functiondef('app_private.require_food_selection_stage()'::regprocedure);d:=replace(d,'food_stage=''selection''' , 'food_stage=''selection'' AND food_enabled');EXECUTE d;
 d:=pg_get_functiondef('app_private.guest_event()'::regprocedure);d:=replace(d,'e.food_stage=''selection''' , 'e.food_enabled AND e.food_stage=''selection''');EXECUTE d;
 -- Preview remains available for authorized organizers when Food is disabled.
 d:=pg_get_functiondef('public.admin_guest_preview(uuid,boolean)'::regprocedure);d:=replace(d,'PERFORM app_private.require_permission(''food'');','IF (SELECT food_enabled FROM public.event_settings WHERE id=1) THEN PERFORM app_private.require_permission(''food'');END IF;');EXECUTE d;
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);IF strpos(d,'''20261111125023''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,'''20261111125023''','''20261111210551''');
 END LOOP;
END $features$;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Features": "interface.messages.event_features", "Disabled features are hidden. Existing data is kept.": "interface.messages.features_preserve_data", "Food explanation": "interface.messages.food_explanation"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;

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

BEGIN;
-- The photo belongs to private event data, never to the anonymous static webroot.
ALTER TABLE public.event_settings ADD COLUMN guest_background jsonb CHECK(guest_background IS NULL OR (jsonb_typeof(guest_background)='object' AND jsonb_typeof(guest_background->'image')='string' AND length(guest_background->>'image')<=2000000 AND guest_background->>'image' ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'));
DO $$ DECLARE f regprocedure;d text;BEGIN
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
 d:=pg_get_functiondef(f);IF strpos(d,'''20261111210551''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,'''20261111210551''','''20261111235847''');
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Review food selections": "interface.messages.food_review", "Check what your household will bring before confirming.": "interface.messages.food_review_help", "Your food selections changed. Please review them again.": "interface.messages.food_review_changed"}')||'::jsonb');END $labels$;
CREATE FUNCTION public.confirm_household_food(p_code text,p_expected_claims jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.households;expected jsonb;actual jsonb;
BEGIN
 PERFORM app_private.require_food_selection_stage();
 IF p_expected_claims IS NULL OR jsonb_typeof(p_expected_claims)<>'array' THEN RAISE EXCEPTION 'Invalid food review';END IF;
 IF jsonb_array_length(p_expected_claims) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid food review';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_expected_claims) c WHERE jsonb_typeof(c)<>'object' OR NOT(c ?& ARRAY['food_item_id','quantity']) OR (SELECT count(*) FROM jsonb_object_keys(c))<>2 OR coalesce(c->>'food_item_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR jsonb_typeof(c->'quantity')<>'number' OR c->>'quantity' !~ '^[1-9][0-9]{0,3}$' OR (c->>'quantity')::integer>1000) THEN RAISE EXCEPTION 'Invalid food review';END IF;
 IF (SELECT count(DISTINCT (c->>'food_item_id')::uuid) FROM jsonb_array_elements(p_expected_claims) c)<>jsonb_array_length(p_expected_claims) THEN RAISE EXCEPTION 'Invalid food review';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501';END IF;
 SELECT * INTO h FROM public.households WHERE invite_code=p_code AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RAISE EXCEPTION 'Invalid invitation';END IF;
 SELECT jsonb_agg(jsonb_build_array((c->>'food_item_id')::uuid,(c->>'quantity')::integer) ORDER BY (c->>'food_item_id')::uuid) INTO expected FROM jsonb_array_elements(p_expected_claims) c;
 SELECT jsonb_agg(jsonb_build_array(food_item_id,quantity) ORDER BY food_item_id) INTO actual FROM public.food_claims WHERE household_id=h.id;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Food selections changed; review them again';END IF;
 IF h.food_confirmed THEN RETURN;END IF;
 PERFORM public.confirm_household_food(p_code);
END $$;
REVOKE ALL ON FUNCTION public.confirm_household_food(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_household_food(text,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Time: {start} to {end}": "interface.messages.venue_time_range", "Time: {time}": "interface.messages.venue_time"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
ALTER TABLE public.event_settings ADD COLUMN guest_theme_toggle boolean NOT NULL DEFAULT true,ADD COLUMN guest_theme_default text NOT NULL DEFAULT 'dark' CHECK(guest_theme_default IN ('system','light','dark'));
CREATE FUNCTION public.admin_save_guest_appearance(p_show_toggle boolean,p_default_theme text,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF p_show_toggle IS NULL OR p_default_theme IS NULL OR p_default_theme NOT IN ('system','light','dark') THEN RAISE EXCEPTION 'Invalid guest appearance';END IF;
 UPDATE public.event_settings e SET guest_theme_toggle=p_show_toggle,guest_theme_default=p_default_theme WHERE id=1 AND jsonb_build_object('guest_theme_toggle',e.guest_theme_toggle,'guest_theme_default',e.guest_theme_default)=p_expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'Guest appearance changed; refresh before saving';END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_guest_appearance(boolean,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_guest_appearance(boolean,text,jsonb) TO authenticated;
DO $$ DECLARE f regprocedure;d text;BEGIN FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP d:=pg_get_functiondef(f);IF strpos(d,'''20261111235847''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,'''20261111235847''','''20261112005150''');END LOOP;END $$;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Guest appearance": "interface.messages.guest_appearance", "Show light/dark toggle on the guest page": "interface.messages.guest_theme_toggle", "Guest default appearance": "interface.messages.guest_theme_default", "Guests can change the default when the toggle is shown. Hiding it enforces the default. Your administrator appearance stays personal.": "interface.messages.guest_theme_help", "We’ll share more information about the food once we’ve received everyone’s replies.": "interface.messages.food_followup"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Print":"interface.messages.print"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
DO $order$ DECLARE d text:=pg_get_functiondef('app_private.guest_invitation(public.households)'::regprocedure);BEGIN
 IF strpos(d,'''is_child'',g.is_child')=0 OR strpos(d,'ORDER BY g.created_at')=0 THEN RAISE EXCEPTION 'Unexpected invitation guest projection';END IF;
 d:=replace(d,'''is_child'',g.is_child','''is_child'',g.is_child,''sort_order'',g.sort_order');
 d:=replace(d,'ORDER BY g.created_at','ORDER BY g.is_child,g.sort_order NULLS LAST,lower(g.first_name),lower(coalesce(g.last_name,'''')),g.id');EXECUTE d;
END $order$;
REVOKE ALL ON FUNCTION app_private.guest_invitation(public.households) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261112112759_item_lifecycle_controls.sql
BEGIN;
ALTER TABLE public.food_items ADD COLUMN archived_at timestamptz;
ALTER TABLE public.other_items ADD COLUMN archived_at timestamptz;
REVOKE DELETE ON public.food_items,public.other_items,public.food_categories FROM authenticated,anon;

CREATE FUNCTION app_private.item_dependencies(p_entity text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target regclass; refs jsonb:='[]'; r record; found_link boolean;
BEGIN
 IF p_entity NOT IN ('food_items','other_items') OR p_entity IS NULL THEN RAISE EXCEPTION 'Invalid item type';END IF;
 target:=format('public.%I',p_entity)::regclass;
 IF p_entity='food_items' THEN
  IF EXISTS(SELECT 1 FROM public.food_items WHERE id=p_id AND food_group_id IS NOT NULL) THEN refs:=refs||'"group"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.management_audit WHERE entity_type='food_claims' AND (before_value->>'food_item_id'=p_id::text OR after_value->>'food_item_id'=p_id::text)) THEN refs:=refs||'"history"'::jsonb;END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.other_items WHERE id=p_id AND nullif(btrim(assigned_to),'') IS NOT NULL) THEN refs:=refs||'"assignment"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.other_items WHERE id=p_id AND status<>'open') THEN refs:=refs||'"progress"'::jsonb;END IF;
 END IF;
 -- Owned translations can be removed with their unused item. All other incoming
 -- references protect the item, even if a future FK happens to use CASCADE.
 FOR r IN SELECT c.conrelid::regclass AS source,a.attname AS column_name
  FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey,c.confkey) k(source_key,target_key)
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.source_key
  JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.target_key
  WHERE c.contype='f' AND c.confrelid=target AND b.attname='id'
    AND c.conrelid<>'public.food_item_translations'::regclass
 LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',r.source,r.column_name) INTO found_link USING p_id;
  IF found_link THEN refs:=refs||'"links"'::jsonb;EXIT;END IF;
 END LOOP;
 RETURN refs;
END $$;
REVOKE ALL ON FUNCTION app_private.item_dependencies(text,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_item_lifecycle(p_entity text,p_id uuid,p_action text,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; refs jsonb; stamp timestamptz;
BEGIN
 PERFORM app_private.require_permission(CASE p_entity WHEN 'food_items' THEN 'food' WHEN 'other_items' THEN 'other' ELSE 'full' END,'edit');
 IF p_entity IS NULL OR p_entity NOT IN ('food_items','other_items') OR p_id IS NULL OR p_action IS NULL OR p_action NOT IN ('inspect','delete','archive','restore') THEN RAISE EXCEPTION 'Invalid item action';END IF;
 PERFORM pg_advisory_xact_lock(19421,7744);
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',p_entity) INTO item USING p_id;
 IF item IS NULL THEN
  IF p_action='delete' THEN RETURN jsonb_build_object('deleted',true);END IF;
  RAISE EXCEPTION 'Item not found';
 END IF;
 refs:=app_private.item_dependencies(p_entity,p_id);
 IF p_action='inspect' THEN RETURN jsonb_build_object('dependencies',refs,'bound',jsonb_array_length(refs)>0,'archived',item->>'archived_at' IS NOT NULL,'updated_at',item->>'updated_at');END IF;
 IF p_expected_updated_at IS NULL OR (item->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Item changed; reload before saving';END IF;
 IF p_action='delete' THEN
  IF jsonb_array_length(refs)>0 THEN RAISE EXCEPTION 'This record is linked to other records or history and must stay archived' USING ERRCODE='23503';END IF;
  EXECUTE format('DELETE FROM public.%I WHERE id=$1',p_entity) USING p_id;
  RETURN jsonb_build_object('deleted',true);
 END IF;
 stamp:=CASE WHEN p_action='archive' THEN clock_timestamp() ELSE NULL END;
 EXECUTE format('UPDATE public.%I SET archived_at=$1,updated_at=clock_timestamp() WHERE id=$2 RETURNING to_jsonb(%I.*)',p_entity,p_entity) INTO item USING stamp,p_id;
 RETURN item;
END $$;
REVOKE ALL ON FUNCTION public.admin_item_lifecycle(text,uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_item_lifecycle(text,uuid,text,timestamptz) TO authenticated;

CREATE FUNCTION public.admin_delete_food_category(p_category_id uuid,p_expected_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE category public.food_categories;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT * INTO category FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF category.name IS DISTINCT FROM p_expected_name THEN RAISE EXCEPTION 'Category changed; reload before deleting';END IF;
 IF EXISTS(SELECT 1 FROM public.food_items f WHERE f.category=category.name) OR EXISTS(SELECT 1 FROM public.food_groups g WHERE g.category=category.name) THEN RAISE EXCEPTION 'Move items to another category before deleting this category.';END IF;
 DELETE FROM public.food_categories WHERE id=p_category_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_delete_food_category(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_food_category(uuid,text) TO authenticated;

CREATE FUNCTION app_private.guard_item_archive_column() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN RAISE EXCEPTION 'Use the item archive or restore action' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_item_archive_column() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_food_archive BEFORE UPDATE OF archived_at ON public.food_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_item_archive_column();
CREATE TRIGGER guard_other_archive BEFORE UPDATE OF archived_at ON public.other_items FOR EACH ROW EXECUTE FUNCTION app_private.guard_item_archive_column();

-- Keep the established reservation validation and locking. Archiving never
-- removes a claim; existing claimants can retain or reduce their quantities.
ALTER FUNCTION app_private.save_food_selection(uuid,uuid,integer,text,integer) RENAME TO save_food_selection_base;
CREATE FUNCTION app_private.save_food_selection(p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_notes text,p_expected_quantity integer) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE archived timestamptz; old_quantity integer;
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 SELECT archived_at INTO archived FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 SELECT coalesce(max(quantity),0) INTO old_quantity FROM public.food_claims WHERE food_item_id=p_food_item_id AND household_id=p_household_id;
 IF archived IS NOT NULL AND p_quantity>old_quantity THEN RAISE EXCEPTION 'Food item unavailable';END IF;
 PERFORM app_private.save_food_selection_base(p_household_id,p_food_item_id,p_quantity,p_notes,p_expected_quantity);
END $$;
REVOKE ALL ON FUNCTION app_private.save_food_selection(uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION app_private.guest_food(uuid,boolean) RENAME TO guest_food_base;
CREATE FUNCTION app_private.guest_food(v_household uuid,p_sample boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=app_private.guest_food_base(v_household,p_sample);IF result IS NULL THEN RETURN NULL;END IF;
 result:=jsonb_set(result,'{items}',coalesce((SELECT jsonb_agg(j.value||jsonb_build_object('archived_at',f.archived_at) ORDER BY j.ordinality)
  FROM jsonb_array_elements(result->'items') WITH ORDINALITY j(value,ordinality) JOIN public.food_items f ON f.id=(j.value->>'id')::uuid
  WHERE f.archived_at IS NULL OR EXISTS(SELECT 1 FROM public.food_claims c WHERE c.food_item_id=f.id AND c.household_id=v_household)),'[]'::jsonb));
 result:=jsonb_set(result,'{groups}',coalesce((SELECT jsonb_agg(j.value||jsonb_build_object('archived_at',(SELECT max(f.archived_at) FROM public.food_items f WHERE f.food_group_id=(j.value->>'id')::uuid)) ORDER BY j.ordinality)
  FROM jsonb_array_elements(coalesce(result->'groups','[]'::jsonb)) WITH ORDINALITY j(value,ordinality)
  WHERE NOT EXISTS(SELECT 1 FROM public.food_items f WHERE f.food_group_id=(j.value->>'id')::uuid AND f.archived_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.food_claims c JOIN public.food_items f ON f.id=c.food_item_id WHERE f.food_group_id=(j.value->>'id')::uuid AND c.household_id=v_household)),'[]'::jsonb));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_private.guest_food(uuid,boolean) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f regprocedure;d text;BEGIN
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);IF strpos(d,'''20261112005150''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;
  EXECUTE replace(d,'''20261112005150''','''20261112112759''');
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
BEGIN;
-- Null preserves existing, shared relational groups without moving households.
ALTER TABLE public.relation_groups ADD COLUMN planning_group_id text CHECK(planning_group_id ~ '^[a-z][a-z0-9_]{0,63}$');
REVOKE INSERT,UPDATE,DELETE ON public.relation_groups FROM anon,authenticated;
CREATE FUNCTION app_private.guard_relation_group_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF TG_TABLE_NAME='relation_groups' THEN
  IF TG_OP='DELETE' THEN
   IF EXISTS(SELECT 1 FROM public.households WHERE relation_group_id=OLD.id) THEN RAISE EXCEPTION 'Move households out of this relational group before deleting it.';END IF;
   RETURN OLD;
  END IF;
  IF NEW.planning_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_settings e CROSS JOIN LATERAL jsonb_array_elements(e.planning_config->'groups') g WHERE e.id=1 AND g->>'id'=NEW.planning_group_id) THEN RAISE EXCEPTION 'Choose an existing top-level group.';END IF;
  IF EXISTS(SELECT 1 FROM public.households h WHERE h.relation_group_id=NEW.id AND NEW.planning_group_id IS NOT NULL AND h.planning_group_id<>NEW.planning_group_id) THEN RAISE EXCEPTION 'Move households before changing the group scope.';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.relation_groups r WHERE r.id=NEW.relation_group_id AND r.planning_group_id IS NOT NULL AND r.planning_group_id<>NEW.planning_group_id) THEN RAISE EXCEPTION 'Choose a relational group within this top-level group.';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_relation_group_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_relation_group_scope BEFORE INSERT OR UPDATE OR DELETE ON public.relation_groups FOR EACH ROW EXECUTE FUNCTION app_private.guard_relation_group_scope();
CREATE TRIGGER guard_household_relation_scope BEFORE INSERT OR UPDATE OF planning_group_id,relation_group_id ON public.households FOR EACH ROW EXECUTE FUNCTION app_private.guard_relation_group_scope();
CREATE OR REPLACE FUNCTION app_private.guard_planning_group_removal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.households h WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.planning_config->'groups') g WHERE g->>'id'=h.planning_group_id)) THEN RAISE EXCEPTION 'Move households out of a group before removing it.';END IF;
 IF EXISTS(SELECT 1 FROM public.relation_groups r WHERE r.planning_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.planning_config->'groups') g WHERE g->>'id'=r.planning_group_id)) THEN RAISE EXCEPTION 'Delete empty relational groups before removing the top-level group.';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.admin_manage_relation_group(p_action text,p_id uuid DEFAULT NULL,p_name text DEFAULT NULL,p_planning_group_id text DEFAULT NULL,p_direction integer DEFAULT NULL,p_expected jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.relation_groups; neighbor public.relation_groups; result public.relation_groups;
BEGIN
 PERFORM app_private.require_permission('households','edit');
 PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_action IS NULL OR p_action NOT IN ('save','move','delete') THEN RAISE EXCEPTION 'Invalid group action';END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO item FROM public.relation_groups WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR to_jsonb(item) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Group changed. Refresh and try again.';END IF;
 END IF;
 IF p_action='save' THEN
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 140 THEN RAISE EXCEPTION 'Enter a group name.';END IF;
  IF p_id IS NULL THEN
   IF p_planning_group_id IS NULL THEN RAISE EXCEPTION 'Choose an existing top-level group.';END IF;
   INSERT INTO public.relation_groups(name,planning_group_id,sort_order) VALUES(btrim(p_name),p_planning_group_id,coalesce((SELECT max(sort_order)+1 FROM public.relation_groups),0)) RETURNING * INTO result;
  ELSE
   UPDATE public.relation_groups SET name=btrim(p_name) WHERE id=p_id RETURNING * INTO result;
  END IF;
 ELSIF p_action='delete' THEN
  IF p_id IS NULL THEN RAISE EXCEPTION 'Choose a group.';END IF;
  DELETE FROM public.relation_groups WHERE id=p_id;RETURN jsonb_build_object('deleted',true);
 ELSE
  IF p_id IS NULL OR p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Choose a group and direction.';END IF;
  -- Normalize ties before swapping adjacent groups. Shared groups retain one global order.
  WITH ranked AS (SELECT id,row_number() OVER(ORDER BY sort_order,name,id)::integer AS n FROM public.relation_groups)
   UPDATE public.relation_groups r SET sort_order=ranked.n FROM ranked WHERE r.id=ranked.id;
  SELECT * INTO item FROM public.relation_groups WHERE id=p_id;
  SELECT * INTO neighbor FROM public.relation_groups WHERE (planning_group_id IS NULL OR planning_group_id=p_planning_group_id) AND (sort_order-item.sort_order)*p_direction>0 ORDER BY abs(sort_order-item.sort_order) LIMIT 1;
  IF FOUND THEN UPDATE public.relation_groups SET sort_order=CASE WHEN id=item.id THEN neighbor.sort_order ELSE item.sort_order END WHERE id IN(item.id,neighbor.id);END IF;
  SELECT * INTO result FROM public.relation_groups WHERE id=p_id;
 END IF;
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.admin_manage_relation_group(text,uuid,text,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_relation_group(text,uuid,text,text,integer,jsonb) TO authenticated;
DO $backup$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'20261112112759')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;
 EXECUTE replace(d,'20261112112759','20261112115213');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'20261112112759')=0 THEN RAISE EXCEPTION 'Unexpected backup validation contract';END IF;
 d:=replace(d,'20261112112759','20261112115213');
 -- Reject invalid scope in imported backups before any data can be restored.
 d:=replace(d,'RETURN jsonb_build_object(''rows'',n,',$scope$
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.relation_groups') r WHERE r->>'planning_group_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.event_settings'->0->'planning_config'->'groups') g WHERE g->>'id'=r->>'planning_group_id'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'tables'->'public.households') h JOIN jsonb_array_elements(payload->'tables'->'public.relation_groups') r ON r->>'id'=h->>'relation_group_id' WHERE r->>'planning_group_id' IS NOT NULL AND r->>'planning_group_id'<>h->>'planning_group_id') THEN RAISE EXCEPTION 'Invalid relational group scope in backup';END IF;
 RETURN jsonb_build_object('rows',n,$scope$);
 EXECUTE d;
END $backup$;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Shared group": "interface.messages.shared_group", "Top-level groups": "interface.messages.top_level_groups", "Relational groups": "interface.messages.relation_groups", "Add relational group": "interface.messages.add_relation_group", "Move households and remove empty relational groups before deleting this group. Keep at least one top-level group.": "interface.messages.group_not_empty", "Edit group": "interface.messages.edit_group", "Delete group": "interface.messages.delete_group"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;
BEGIN;
-- Null preserves the current approved guest appearance without changing any row.
CREATE FUNCTION app_private.valid_guest_design(design jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE mode text;k text;
BEGIN
 IF design IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(design)<>'object' OR octet_length(design::text)>2048 OR (SELECT count(*) FROM jsonb_object_keys(design))<>5
 OR NOT(design ?& ARRAY['dark','light','opacity','darken','position']) OR jsonb_typeof(design->'position') IS DISTINCT FROM 'string' OR design->>'position' NOT IN ('top','center','bottom') THEN RETURN false;END IF;
 IF jsonb_typeof(design->'opacity')<>'number' OR (design->>'opacity')::numeric NOT BETWEEN 35 AND 100 OR (design->>'opacity')::numeric<>trunc((design->>'opacity')::numeric)
 OR jsonb_typeof(design->'darken')<>'number' OR (design->>'darken')::numeric NOT BETWEEN 0 AND 70 OR (design->>'darken')::numeric<>trunc((design->>'darken')::numeric) THEN RETURN false;END IF;
 FOREACH mode IN ARRAY ARRAY['dark','light'] LOOP
  IF jsonb_typeof(design->mode)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(design->mode))<>3 OR NOT(design->mode ?& ARRAY['box','text','button']) THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['box','text','button'] LOOP IF jsonb_typeof(design->mode->k)<>'string' OR design->mode->>k !~ '^#[a-fA-F0-9]{6}$' THEN RETURN false;END IF;END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION app_private.valid_guest_design(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.valid_guest_design(jsonb) TO authenticated;
ALTER TABLE public.event_settings ADD COLUMN guest_design jsonb CHECK(app_private.valid_guest_design(guest_design));

CREATE FUNCTION app_private.validate_private_jpeg(background jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE data bytea;n integer;pos integer:=2;marker integer;len integer;w integer;h integer;c jsonb;key text;value numeric;
BEGIN
 IF jsonb_typeof(background) IS DISTINCT FROM 'object' OR octet_length(background::text)>2000000 OR background->>'image' IS NULL OR length(background->>'image')>1900000 OR background->>'image' !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' OR length(coalesce(background->>'name',''))>180 THEN RAISE EXCEPTION 'Choose a JPEG under 1.4 MB.';END IF;
 BEGIN data:=decode(split_part(background->>'image',',',2),'base64');EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid JPEG image.';END;
 n:=octet_length(data);IF n<12 OR n>1400000 OR get_byte(data,0)<>255 OR get_byte(data,1)<>216 OR get_byte(data,n-2)<>255 OR get_byte(data,n-1)<>217 THEN RAISE EXCEPTION 'Invalid JPEG image.';END IF;
 WHILE pos<n-3 LOOP
  IF get_byte(data,pos)<>255 THEN RAISE EXCEPTION 'Invalid JPEG image.';END IF;
  WHILE pos<n AND get_byte(data,pos)=255 LOOP pos:=pos+1;END LOOP;IF pos>=n THEN EXIT;END IF;
  marker:=get_byte(data,pos);pos:=pos+1;
  IF marker IN (217,218) THEN EXIT;END IF;
  IF marker=1 OR marker BETWEEN 208 AND 215 THEN CONTINUE;END IF;
  IF pos+1>=n THEN EXIT;END IF;len:=get_byte(data,pos)*256+get_byte(data,pos+1);
  IF len<2 OR pos+len>n THEN RAISE EXCEPTION 'Invalid JPEG image.';END IF;
  IF marker IN(192,193,194,195,197,198,199,201,202,203,205,206,207) THEN
   IF len<8 THEN RAISE EXCEPTION 'Invalid JPEG image.';END IF;
   h:=get_byte(data,pos+3)*256+get_byte(data,pos+4);w:=get_byte(data,pos+5)*256+get_byte(data,pos+6);EXIT;
  END IF;
  pos:=pos+len;
 END LOOP;
 IF w IS NULL OR h IS NULL OR w NOT BETWEEN 1 AND 12000 OR h NOT BETWEEN 1 AND 12000 OR w::bigint*h>40000000 THEN RAISE EXCEPTION 'JPEG dimensions are too large or invalid.';END IF;
 c:=background->'crop';IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid photo crop.';END IF;
 FOREACH key IN ARRAY ARRAY['x','y','width','height','sourceWidth','sourceHeight'] LOOP
  IF jsonb_typeof(c->key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid photo crop.';END IF;
  value:=(c->>key)::numeric;IF value<0 OR value<>trunc(value) OR value>12000 THEN RAISE EXCEPTION 'Invalid photo crop.';END IF;
 END LOOP;
 IF (c->>'sourceWidth')::integer<>w OR (c->>'sourceHeight')::integer<>h OR (c->>'width')::integer<1 OR (c->>'height')::integer<1 OR (c->>'x')::integer+(c->>'width')::integer>w OR (c->>'y')::integer+(c->>'height')::integer>h THEN RAISE EXCEPTION 'Invalid photo crop.';END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.validate_private_jpeg(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.guest_customization_revision() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('background',guest_background,'design',guest_design,'theme',guest_theme_default,'toggle',guest_theme_toggle)::text,'UTF8')),'hex') FROM public.event_settings WHERE id=1
$$;
REVOKE ALL ON FUNCTION app_private.guest_customization_revision() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.admin_save_guest_customization(p_design jsonb,p_background_mode text,p_background jsonb,p_show_toggle boolean,p_default_theme text,p_expected_revision text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_permission('settings','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM 1 FROM public.event_settings WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR p_expected_revision IS DISTINCT FROM app_private.guest_customization_revision() THEN RAISE EXCEPTION 'Guest appearance changed; refresh before saving';END IF;
 IF NOT app_private.valid_guest_design(p_design) OR p_background_mode IS NULL OR p_background_mode NOT IN ('keep','replace','remove') OR p_show_toggle IS NULL OR p_default_theme IS NULL OR p_default_theme NOT IN ('dark','light','system') OR (p_background_mode<>'replace' AND p_background IS NOT NULL) THEN RAISE EXCEPTION 'Invalid guest appearance';END IF;
 IF p_background_mode='replace' THEN PERFORM app_private.validate_private_jpeg(p_background);END IF;
 UPDATE public.event_settings SET guest_design=p_design,guest_background=CASE p_background_mode WHEN 'replace' THEN p_background WHEN 'remove' THEN NULL ELSE guest_background END,guest_theme_toggle=p_show_toggle,guest_theme_default=p_default_theme WHERE id=1;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_guest_customization(jsonb,text,jsonb,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_guest_customization(jsonb,text,jsonb,boolean,text,text) TO authenticated;
CREATE FUNCTION app_private.guard_guest_customization() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND (OLD.guest_background IS DISTINCT FROM NEW.guest_background OR OLD.guest_design IS DISTINCT FROM NEW.guest_design) THEN RAISE EXCEPTION 'Use the guest customization editor.' USING ERRCODE='42501';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_guest_customization() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_guest_customization BEFORE UPDATE OF guest_background,guest_design ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_guest_customization();
DO $projection$ DECLARE d text;needle text:='CASE WHEN s THEN to_jsonb(e) ELSE';BEGIN
 d:=pg_get_functiondef('public.admin_load_data()'::regprocedure);IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected private settings projection';END IF;
 EXECUTE replace(d,needle,'CASE WHEN s THEN to_jsonb(e)||jsonb_build_object(''guest_customization_revision'',app_private.guest_customization_revision()) ELSE');
END $projection$;
-- Unpublished drafts may use a link placeholder; sending still requires publication,
-- a current code snapshot and explicit acknowledgement through the unchanged RPCs.
DO $drafts$
DECLARE d text;needle text;
BEGIN
 d:=pg_get_functiondef('public.admin_save_delivery(uuid,uuid,jsonb,integer)'::regprocedure);
 needle:='IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) THEN';
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected delivery publication guard';END IF;
 d:=replace(d,needle,'IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published) AND v_status NOT IN (''draft'',''cancelled'') THEN');
 needle:='h.archived_at IS NOT NULL OR h.invite_code IS NULL OR NOT EXISTS';
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected active-household delivery guard';END IF;
 d:=replace(d,needle,'h.archived_at IS NOT NULL OR (h.invite_code IS NULL AND EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published)) OR NOT EXISTS');
 needle:='UPDATE public.invitation_send_queue SET contact_id=cid';
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected delivery snapshot update';END IF;
 d:=replace(d,needle,$link$
 IF v_status='ready' AND position('{invitation_link}' IN p_values->>'message_body')>0 THEN RAISE EXCEPTION 'Replace the invitation link placeholder before marking ready.';END IF;
 UPDATE public.invitation_send_queue SET contact_id=cid$link$);
 EXECUTE d;
END $drafts$;
DO $backup$ DECLARE f regprocedure;d text;BEGIN
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);IF strpos(d,'''20261112115213''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,'''20261112115213''','''20261112124152''');
 END LOOP;
END $backup$;
DO $labels$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal('{"Guest invitation": "interface.messages.invitation_custom_guest_invitation", "Customize the invitation without publishing the event.": "interface.messages.invitation_custom_customize_the_invitation_without_publishing_the_event", "Background photo": "interface.messages.invitation_custom_background_photo", "Choose JPEG": "interface.messages.invitation_custom_choose_jpeg", "Replace JPEG": "interface.messages.invitation_custom_replace_jpeg", "Remove photo": "interface.messages.invitation_custom_remove_photo", "Restore photo": "interface.messages.invitation_custom_restore_photo", "Stored privately with the event. No public image link.": "interface.messages.invitation_custom_stored_privately_with_the_event_no_public_image_link", "JPEG up to 1.4 MB. Images are resized to 2400 px and metadata is removed before saving.": "interface.messages.invitation_custom_jpeg_up_to_1_4_mb_images_are_resized_to_2400_px_and_metadata_is_removed_before_saving", "Crop photo": "interface.messages.invitation_custom_crop_photo", "Left": "interface.messages.invitation_custom_left", "Top": "interface.messages.invitation_custom_top", "Bottom": "interface.messages.invitation_custom_bottom", "Center": "interface.messages.invitation_custom_center", "Width": "interface.messages.invitation_custom_width", "Height": "interface.messages.invitation_custom_height", "Photo position": "interface.messages.invitation_custom_photo_position", "Darken photo": "interface.messages.invitation_custom_darken_photo", "Colors & boxes": "interface.messages.invitation_custom_colors_boxes", "Boxes / page": "interface.messages.invitation_custom_boxes_page", "Text": "interface.messages.invitation_custom_text", "Buttons": "interface.messages.invitation_custom_buttons", "Box opacity": "interface.messages.invitation_custom_box_opacity", "Live preview": "interface.messages.invitation_custom_live_preview", "Wide": "interface.messages.invitation_custom_wide", "Reset appearance": "interface.messages.invitation_custom_reset_appearance", "Current private photo": "interface.messages.invitation_custom_current_private_photo", "Visible crop": "interface.messages.invitation_custom_visible_crop", "No background photo": "interface.messages.invitation_custom_no_background_photo", "bytes": "interface.messages.invitation_custom_bytes", "Preparing photo…": "interface.messages.invitation_custom_preparing_photo", "Photo prepared. Save to keep it privately.": "interface.messages.invitation_custom_photo_prepared_save_to_keep_it_privately", "Guest appearance saved.": "interface.messages.invitation_custom_guest_appearance_saved", "Choose a JPEG under 1.4 MB.": "interface.messages.invitation_custom_choose_a_jpeg_under_1_4_mb", "Invalid JPEG image.": "interface.messages.invitation_custom_invalid_jpeg_image", "JPEG dimensions are too large or invalid.": "interface.messages.invitation_custom_jpeg_dimensions_are_too_large_or_invalid", "Invalid photo crop.": "interface.messages.invitation_custom_invalid_photo_crop", "Could not prepare this photo.": "interface.messages.invitation_custom_could_not_prepare_this_photo", "All groups": "interface.messages.invitation_custom_all_groups", "All languages": "interface.messages.invitation_custom_all_languages", "All channels": "interface.messages.invitation_custom_all_channels", "Not sent": "interface.messages.invitation_custom_not_sent", "Marked sent": "interface.messages.invitation_custom_marked_sent", "Awaiting reply": "interface.messages.invitation_custom_awaiting_reply", "Replied": "interface.messages.invitation_custom_replied", "Partly answered": "interface.messages.invitation_custom_partly_answered", "No reply": "interface.messages.invitation_custom_no_reply", "Never sent": "interface.messages.invitation_custom_never_sent", "Last sent": "interface.messages.invitation_custom_last_sent", "Recipient / channel": "interface.messages.invitation_custom_recipient_channel", "Actions": "interface.messages.invitation_custom_actions", "Prepare": "interface.messages.invitation_custom_prepare", "Review": "interface.messages.invitation_custom_review", "Follow up": "interface.messages.invitation_custom_follow_up", "{answered} / {total} responses": "interface.messages.invitation_custom_answered_total_responses", "No households match these filters.": "interface.messages.invitation_custom_no_households_match_these_filters", "Send · Preview · Follow up": "interface.messages.invitation_custom_send_preview_follow_up", "Search households or contacts": "interface.messages.invitation_custom_search_households_or_contacts", "Household name or recipient": "interface.messages.invitation_custom_household_name_or_recipient", "Channel": "interface.messages.invitation_custom_channel", "Group by top-level / relational group": "interface.messages.invitation_custom_group_by_top_level_relational_group", "Prepare drafts now. Marking ready and sending become available after publication.": "interface.messages.invitation_custom_prepare_drafts_now_marking_ready_and_sending_become_available_after_publication", "Replace the invitation link placeholder before marking ready.": "interface.messages.invitation_custom_replace_the_invitation_link_placeholder_before_marking_ready", "Use the guest customization editor.": "interface.messages.invitation_custom_use_the_guest_customization_editor", "We look forward to celebrating our day with you.": "interface.messages.invitation_custom_we_look_forward_to_celebrating_our_day_with_you"}')||'::jsonb');END $labels$;
NOTIFY pgrst,'reload schema';
COMMIT;
BEGIN;
-- Reservations already lock their food rows. Do not acquire the global
-- management lock after those rows: archive operations acquire global then row.
CREATE OR REPLACE FUNCTION app_private.save_food_selection(p_household_id uuid,p_food_item_id uuid,p_quantity integer,p_notes text,p_expected_quantity integer) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE archived timestamptz; old_quantity integer;
BEGIN
 SELECT archived_at INTO archived FROM public.food_items WHERE id=p_food_item_id FOR UPDATE;
 SELECT coalesce(max(quantity),0) INTO old_quantity FROM public.food_claims WHERE food_item_id=p_food_item_id AND household_id=p_household_id;
 IF archived IS NOT NULL AND p_quantity>old_quantity THEN RAISE EXCEPTION 'Food item unavailable';END IF;
 PERFORM app_private.save_food_selection_base(p_household_id,p_food_item_id,p_quantity,p_notes,p_expected_quantity);
END $$;
REVOKE ALL ON FUNCTION app_private.save_food_selection(uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261112163128_status_message_preferences.sql
BEGIN;
-- Nullable preferences preserve the original All messages behavior.
CREATE FUNCTION app_private.valid_notification_preferences(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE scope text;policy jsonb;
BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR NOT(p?'admin' AND p?'guest') THEN RETURN false;END IF;
 FOREACH scope IN ARRAY ARRAY['admin','guest'] LOOP
  policy:=p->scope;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(policy))<>(CASE WHEN scope='guest' AND policy?'autoDismiss' THEN 3 ELSE 2 END) OR jsonb_typeof(policy->'preset') IS DISTINCT FROM 'string' OR policy->>'preset' NOT IN ('all','errors','custom') OR jsonb_typeof(policy->'types') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF policy?'autoDismiss' AND (scope<>'guest' OR jsonb_typeof(policy->'autoDismiss') IS DISTINCT FROM 'boolean') THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'types') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'string' OR t#>>'{}' NOT IN ('info','success','warning','error')) OR (SELECT count(*) FROM jsonb_array_elements(policy->'types'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(policy->'types')) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app_private.valid_notification_preferences(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.valid_notification_preferences(jsonb) TO authenticated;
ALTER TABLE public.event_settings ADD COLUMN notification_preferences jsonb CHECK(app_private.valid_notification_preferences(notification_preferences));
CREATE FUNCTION public.admin_save_notification_preferences(p_preferences jsonb,p_expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_preferences jsonb;
BEGIN
 PERFORM app_private.require_permission('settings','edit');
 IF NOT app_private.valid_notification_preferences(p_preferences) THEN RAISE EXCEPTION 'Invalid status message preferences';END IF;
 SELECT notification_preferences INTO current_preferences FROM public.event_settings WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR current_preferences IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Status message preferences changed; refresh before saving';END IF;
 UPDATE public.event_settings SET notification_preferences=p_preferences WHERE id=1;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_notification_preferences(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_notification_preferences(jsonb,jsonb) TO authenticated;
CREATE FUNCTION app_private.guard_notification_preferences() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND OLD.notification_preferences IS DISTINCT FROM NEW.notification_preferences THEN RAISE EXCEPTION 'Use the status message settings editor.' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.guard_notification_preferences() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_notification_preferences BEFORE UPDATE OF notification_preferences ON public.event_settings FOR EACH ROW EXECUTE FUNCTION app_private.guard_notification_preferences();
-- Guests receive only their policy, through the unchanged private invitation/preview boundaries.
DO $projection$ DECLARE d text;needle text;BEGIN
 d:=pg_get_functiondef('app_private.guest_event()'::regprocedure);needle:=$n$'event',to_jsonb(e)$n$;
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected guest projection';END IF;
 EXECUTE replace(d,needle,$r$'event',(to_jsonb(e)-'notification_preferences')||jsonb_build_object('notification_preferences',jsonb_build_object('guest',e.notification_preferences->'guest'))$r$);
 d:=pg_get_functiondef('public.admin_load_data()'::regprocedure);needle:=$n$'planning_config',e.planning_config) END$n$;
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Unexpected administrator projection';END IF;
 EXECUTE replace(d,needle,$r$'planning_config',e.planning_config,'notification_preferences',jsonb_build_object('admin',e.notification_preferences->'admin')) END$r$);
END $projection$;
DO $backup$ DECLARE f regprocedure;d text;BEGIN
 FOREACH f IN ARRAY ARRAY['app_private.backup_payload()'::regprocedure,'app_private.validate_backup(jsonb)'::regprocedure] LOOP
  d:=pg_get_functiondef(f);IF strpos(d,$n$'20261112124152'$n$)=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;EXECUTE replace(d,$n$'20261112124152'$n$,$n$'20261112163128'$n$);
 END LOOP;
END $backup$;
DO $wording$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN IF strpos(d,'$json$::jsonb')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;EXECUTE replace(d,'$json$::jsonb','$json$::jsonb || '||quote_literal($labels${"Status messages": "interface.messages.status_messages_title", "Choose which temporary messages appear. Saved logs, form errors and confirmation lists are unchanged.": "interface.messages.status_messages_help", "All messages": "interface.messages.status_messages_all", "Errors only": "interface.messages.status_messages_errors_only", "Information": "interface.messages.status_messages_information", "Success": "interface.messages.status_messages_success", "Warnings": "interface.messages.status_messages_warnings", "Errors": "interface.messages.status_messages_errors", "Status message preferences saved.": "interface.messages.status_messages_saved", "Hide guest messages after 5 seconds": "interface.messages.status_messages_auto_dismiss"}$labels$)||'::jsonb');END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261112174905_admin_message_auto_dismiss.sql
BEGIN;
-- Optional per-scope expiry; missing Admin values retain the original five-second default.
CREATE OR REPLACE FUNCTION app_private.valid_notification_preferences(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE scope text;policy jsonb;
BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR NOT(p?'admin' AND p?'guest') THEN RETURN false;END IF;
 FOREACH scope IN ARRAY ARRAY['admin','guest'] LOOP
  policy:=p->scope;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(policy))<>(CASE WHEN policy?'autoDismiss' THEN 3 ELSE 2 END) OR jsonb_typeof(policy->'preset') IS DISTINCT FROM 'string' OR policy->>'preset' NOT IN ('all','errors','custom') OR jsonb_typeof(policy->'types') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF policy?'autoDismiss' AND jsonb_typeof(policy->'autoDismiss') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'types') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'string' OR t#>>'{}' NOT IN ('info','success','warning','error')) OR (SELECT count(*) FROM jsonb_array_elements(policy->'types'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(policy->'types')) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;

-- Rename the shared label without rewriting existing event preferences or translations.
DO $wording$ DECLARE d text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);BEGIN
 IF strpos(d,'Hide guest messages after 5 seconds')=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;
 EXECUTE replace(d,'Hide guest messages after 5 seconds','Hide messages after 5 seconds');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113011754_align_log_help_and_link_registry.sql
BEGIN;
-- Add sources without retiring any historical source or changing canonical keys.
DO $registry$
DECLARE
 original jsonb:=app_private.translation_keys();
 additions jsonb:=$labels${"Date filters use the event timezone. Entries show your local time. Expand an entry for its UTC time and details. Household and guest archive, restore and deletion are logged.": "interface.messages.date_filters_use_the_event_timezone_entries_show_your_local_time_", "Link": "interface.messages.invite_copy_link_short"}$labels$::jsonb;
 definition text:=pg_get_functiondef('app_private.translation_keys()'::regprocedure);
 needle text:='$json$::jsonb';
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_each_text(additions) a WHERE original?a.key AND original->>a.key IS DISTINCT FROM a.value) THEN
  RAISE EXCEPTION 'Registry source already maps to a different key';
 END IF;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected wording registry';END IF;
 EXECUTE replace(definition,needle,needle||' || '||quote_literal(additions::text)||'::jsonb');
 IF app_private.translation_keys() IS DISTINCT FROM original||additions THEN
  RAISE EXCEPTION 'Registry alignment changed an existing mapping';
 END IF;
END $registry$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113013341_canonical_locale_registry.sql
BEGIN;
-- Clean-start catalog v2. There is no legacy CSV/key adapter.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.translation_overrides) THEN
 RAISE EXCEPTION 'Review saved interface overrides before canonical catalog replacement';END IF;END $$;
-- Keep active database-generated wording consistent with canonical display sources.
DO $wording$ DECLARE f record;d text;entry record;BEGIN
 FOR f IN SELECT p.oid,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','app_private') AND p.prokind='f' AND p.oid<>'app_private.translation_keys()'::regprocedure LOOP
  d:=f.definition;
  FOR entry IN SELECT * FROM jsonb_each_text($changes${"Add contact":"Add Contact","Choose a guest or enter a new contact below. Guest selection fills the name and language; enter this person’s contact details separately.":"Choose a guest or enter a new contact below. Guest selection fills the name, language and household’s preferred delivery method and contact details. Review them before saving.","＋ Add food category":"Add food category","＋ Add food item":"Add food item","We look forward to celebrating with you.":"We look forward to celebrating our day with you.","User Comment":"Guest note","Admin Comment":"Admin note","Default type ({type})":"Default unit ({type})","+ Add food item type":"Add food item type","New food item type":"New food unit","Food item type must be at most 60 characters.":"Food unit must be at most 60 characters.","+ Add household":"Add household","Amount: {claimed}/{needed} {type}, Shown: {shown}":"Quantity: {claimed}/{needed} {type} · {shown}","No matching food types.":"No matching food units.","Food Types":"Food Units","{items}, {claimed}/{capacity} amounts":"{items} · Quantity: {claimed}/{capacity}","+ Add":"Add","+ Add recipe":"Add recipe","Types":"Units","Translate the item name and the note shown to guests. Types are translated in Languages → Food → Types.":"Translate the item name and the note shown to guests. Units are translated in Languages → Food → Units.","＋ Add category":"Add category","Manage types":"Manage units","Types are shared by all food items. Translate each type once for every enabled language.":"Units are shared by all food items. Translate each unit once for every enabled language.","+ Add type":"Add unit","This type already exists.":"This unit already exists.","Type added":"Unit added","＋ Add venue":"Add venue","＋ Add session":"Add session","Manage":"Manage members","I am coming with another person":"Add person","Guest additions are saved only on a published invitation.":"Preview only: added guests disappear when you reload. Nothing is saved.","Ask whether guests can bring food":"Collect interest","Open the detailed food list":"Choose food"}$changes$::jsonb) LOOP
   d:=replace(d,quote_literal(entry.key),quote_literal(entry.value));
  END LOOP;
  IF d IS DISTINCT FROM f.definition THEN EXECUTE d;END IF;
 END LOOP;
END $wording$;
CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $catalog$ SELECT $json${"Top-level group":"interface.messages.top_level_group","Event planning":"interface.messages.event_planning","Event preset":"interface.messages.event_preset","Wedding":"interface.messages.event_preset_wedding","Reunion":"interface.messages.event_preset_reunion","Conference":"interface.messages.event_preset_conference","Use preset suggestions":"interface.messages.event_apply_preset","Preset suggestions add missing groups and fill blank labels. Review them before saving.":"interface.messages.event_preset_help","Shared labels":"interface.messages.event_shared_labels","Move group up":"interface.messages.event_move_group_up","Move group down":"interface.messages.event_move_group_down","Remove group":"interface.messages.event_remove_group","Add group":"interface.messages.event_add_group","Save planning settings":"interface.messages.event_save_planning","Family":"interface.messages.event_group_family","Friends":"interface.messages.event_group_friends","Attendees":"interface.messages.event_group_attendees","Speakers":"interface.messages.event_group_speakers","Bookings":"interface.messages.event_label_bookings","Participants":"interface.messages.event_label_participants","Review RSVP":"interface.messages.rsvp_review","Check the answers for each guest and session. Confirming locks the RSVP.":"interface.messages.rsvp_review_help","Confirm RSVP":"interface.messages.rsvp_confirm","Back to edit":"interface.messages.rsvp_back_to_edit","Apply to everyone invited":"interface.messages.rsvp_apply_to_everyone","Fills unanswered choices only.":"interface.messages.rsvp_fill_unanswered_only","Enable access":"interface.messages.access_enable_access","Suspend access":"interface.messages.access_suspend_access","Revoke session":"interface.messages.access_revoke_session","Session refreshed":"interface.messages.access_session_refreshed","{browser} on {device}":"interface.messages.access_session_browser_device","Apple device":"interface.messages.access_session_apple_device","Session refreshed shows when the sign-in session last renewed. Revocation ends access to this application. Everyone can revoke their own sessions.":"interface.messages.access_session_refresh_help","Permanently delete {name}?":"interface.messages.confirm_delete_named_record","Remove assignment for {household}":"interface.messages.remove_named_assignment","Remove {household}’s assignment for {item}?":"interface.messages.confirm_remove_food_assignment","Show to guests":"interface.messages.show_to_guests","Hide from guests":"interface.messages.hide_from_guests","Hidden from guests":"interface.messages.hidden_from_guests","(preview)":"interface.messages.preview_marker","Unpublished · Guest preview only":"interface.messages.unpublished_preview_only","Invitation delivery opens when the event is published.":"interface.messages.delivery_requires_publication","Delete household":"interface.messages.delete_household","Delete guest":"interface.messages.delete_guest","Permanently delete this record?":"interface.messages.confirm_delete_record","Record deleted.":"interface.messages.record_deleted","Choose a record that can be deleted.":"interface.messages.choose_deletable_record","Move or delete guests and child households first.":"interface.messages.delete_move_dependents","Remove this guest’s household contact assignments first.":"interface.messages.delete_remove_contact_assignments","Restore mode":"interface.messages.restore_mode","Full backup":"interface.messages.restore_full_backup","Planning template":"interface.messages.restore_planning_template","Include in template":"interface.messages.restore_template_include","Event settings and languages are always included. Invitation codes, replies, food commitments, delivery history and administrator records are cleared.":"interface.messages.restore_template_info","Wording & invitation templates":"interface.messages.restore_template_wording","Guest preview":"interface.messages.guest_preview","Test changes stay in this tab and are discarded when you close or reload it.":"interface.messages.guest_preview_discard","Preview as":"interface.messages.guest_preview_as","Copy preview link":"interface.messages.guest_preview_copy","Sign in to preview":"interface.messages.guest_preview_sign_in","Preview link":"interface.messages.guest_preview_link","Preview link copied.":"interface.messages.guest_preview_copied","Sign in with an administrator account to open this preview.":"interface.messages.guest_preview_login_required","Guest preview requires access to Households, Invites, Venues and Food.":"interface.messages.guest_preview_access","Guest landing page":"interface.messages.guest_preview_landing","Sample household":"interface.messages.guest_preview_sample","Preview response confirmed.":"interface.messages.guest_preview_response","Preview food selection updated.":"interface.messages.guest_preview_food_updated","Preview food selection confirmed.":"interface.messages.guest_preview_food_confirmed","Templates":"interface.messages.templates","Invitation templates":"interface.messages.invitation_templates","Set the starting wording for new invitation drafts by language and delivery channel.":"interface.messages.invitation_templates_description","No custom template. New drafts use fallback wording.":"interface.messages.invitation_template_fallback","Include the invitation link placeholder. Clear the fields to use fallback wording.":"interface.messages.invitation_template_help","Save template":"interface.messages.save_invitation_template","Include the invitation link placeholder in the message.":"interface.messages.invitation_template_link_required","The invitation template contains an unknown placeholder.":"interface.messages.invitation_template_unknown_placeholder","Back to households":"interface.messages.back_to_households","Administration":"interface.messages.administration","Admin":"interface.messages.admin","Event Invitation":"interface.messages.event_invitation","Event dashboard":"interface.messages.event_dashboard","Appearance":"interface.messages.appearance","Appearance preference":"interface.messages.appearance_preference","System default":"interface.messages.system_default","Light":"interface.messages.light","Dark":"interface.messages.dark","Language":"interface.messages.language","Faroese":"interface.messages.faroese","English":"interface.messages.english","German":"interface.messages.german","Settings":"interface.messages.settings","Settings sections":"interface.messages.settings_sections","Main settings":"interface.messages.main_settings","Event settings":"interface.messages.event_settings","Administrators":"interface.messages.administrators","Administrator":"interface.messages.administrator","Administrator actions":"interface.messages.administrator_actions","Admin sections":"interface.messages.admin_sections","Overview":"interface.messages.overview","Households":"interface.messages.households","Guests":"interface.messages.guests","Manage Invites":"interface.messages.manage_invites","Venues":"interface.messages.venues","Sessions":"interface.messages.sessions","Sessions & scheduling":"interface.messages.sessions_scheduling","Logs":"interface.messages.logs","Back":"interface.messages.back","Back to dashboard":"interface.messages.back_to_dashboard","View website in a new tab":"interface.messages.view_website_in_a_new_tab","Refresh data":"interface.messages.refresh_data","Sign out":"interface.messages.sign_out","Sign in":"interface.messages.sign_in","Email":"interface.messages.email","Password":"interface.messages.password","PRIVATE ADMINISTRATION":"interface.messages.private_administration","Welcome back.":"interface.messages.welcome_back","Only approved event administrators can sign in.":"interface.messages.only_approved_event_administrators_can_sign_in","Setup wizard":"interface.messages.setup_wizard","New password":"interface.messages.new_password","Confirm password":"interface.messages.confirm_password","You’re invited.":"interface.messages.you_re_invited","Accept administrator invitation":"interface.messages.accept_administrator_invitation","Accepting invitation…":"interface.messages.accepting_invitation","Accepting gives you access to this event’s households, guests, invitations and settings.":"interface.messages.accepting_gives_you_access_to_this_event_s_households_guests_invi","Set a password of at least 12 characters for future sign-ins.":"interface.messages.set_a_password_of_at_least_12_characters_for_future_sign_ins","Event name":"interface.messages.event_name","Type":"interface.messages.type","Date":"interface.messages.date","Default language":"interface.messages.default_language","Timezone":"interface.messages.timezone","Website URL":"interface.messages.website_url","RSVP deadline (local browser time)":"interface.messages.rsvp_deadline_local_browser_time","Save settings":"interface.messages.save_settings","Publish event":"interface.messages.publish_event","Unpublish event":"interface.messages.unpublish_event","Event is published: invited guests can access RSVP. You can unpublish it below.":"interface.messages.event_is_published_invited_guests_can_access_rsvp_you_can_unpubli","Use View mode to inspect configuration and Edit mode to make changes. Publication controls are below.":"interface.messages.use_view_mode_to_inspect_configuration_and_edit_mode_to_make_chan","Publishing makes the guest RSVP experience available. The website can be online while the event is unpublished. Complete access-control and invite-code release tests before publishing.":"interface.messages.publishing_makes_the_guest_rsvp_experience_available_the_website_","I understand the release checks are my responsibility and this will open the event to invited guests.":"interface.messages.i_understand_the_release_checks_are_my_responsibility_and_this_wi","Manage event details and administrator access.":"interface.messages.manage_event_details_and_administrator_access","Manage locations, addresses and local timezones. Guests can attend sessions at more than one venue.":"interface.messages.manage_locations_addresses_and_local_timezones_guests_can_attend_","Set each session’s venue and local times. Use Manage Invites for household invitations and individual exceptions.":"interface.messages.set_each_session_s_venue_and_local_times_use_manage_invites_for_h","Invite trusted people to help manage this event. Access starts after they verify their email and accept.":"interface.messages.invite_trusted_people_to_help_manage_this_event_access_starts_aft","Invite administrator":"interface.messages.invite_administrator","Open Supabase Auth":"interface.messages.open_supabase_auth","Display name":"interface.messages.display_name","Send invitation":"interface.messages.send_invitation","Pending invitations":"interface.messages.pending_invitations","An email will be sent to this address. The recipient must accept within 7 days; email sign-in links may expire sooner.":"interface.messages.an_email_will_be_sent_to_this_address_the_recipient_must_accept_w","Resend":"interface.messages.resend","Cancel":"interface.messages.cancel","Awaiting acceptance":"interface.messages.awaiting_acceptance","No pending invitations.":"interface.messages.no_pending_invitations","Sending invitation…":"interface.messages.sending_invitation","Administrator invitation email sent.":"interface.messages.administrator_invitation_email_sent","Administrator invitation cancelled.":"interface.messages.administrator_invitation_cancelled","Administrator invitation accepted.":"interface.messages.administrator_invitation_accepted","Revoke administrator access":"interface.messages.revoke_administrator_access","Administrator access revoked.":"interface.messages.administrator_access_revoked","You cannot remove the last administrator.":"interface.messages.you_cannot_remove_the_last_administrator","Search":"interface.messages.search","Category":"interface.messages.category","Action":"interface.messages.action","From":"interface.messages.from","Through":"interface.messages.through","All categories":"interface.messages.all_categories","All actions":"interface.messages.all_actions","Search logs":"interface.messages.search_logs","Reset":"interface.messages.reset","Load older entries":"interface.messages.load_older_entries","Search recorded changes, RSVP activity, invitation delivery and administrator sessions.":"interface.messages.search_recorded_changes_rsvp_activity_invitation_delivery_and_adm","Household, guest, administrator or change":"interface.messages.household_guest_administrator_or_change","Contacts":"interface.messages.contacts","Invitations":"interface.messages.invitations","Login":"interface.messages.login","Loading logs…":"interface.messages.loading_logs","No log entries match these filters.":"interface.messages.no_log_entries_match_these_filters","Field":"interface.messages.field","Before":"interface.messages.before","After":"interface.messages.after","Reference: ":"interface.messages.reference","Showing ":"interface.messages.showing","Date filters use the event timezone. Entries show your local time. Expand an entry for its UTC time and details. Household and guest archive, restore and deletion are logged.":"interface.messages.date_filters_use_the_event_timezone_entries_show_your_local_time_","Existing history is included. New sign-in and invitation-opening records start with this update. Repeated opens within 15 minutes are grouped.":"interface.messages.existing_history_is_included_new_sign_in_and_invitation_opening_r","Launch checklist":"interface.messages.launch_checklist","Check all release requirements before using Settings → Event settings → Publish event.":"interface.messages.check_all_release_requirements_before_using_settings_event_settin","Admin account connected":"interface.messages.admin_account_connected","Event name and date entered":"interface.messages.event_name_and_date_entered","At least one session created":"interface.messages.at_least_one_session_created","Invitations assigned":"interface.messages.invitations_assigned","Website connection in deployed config.js":"interface.messages.website_connection_in_deployed_config_js","Website address saved in event settings":"interface.messages.website_address_saved_in_event_settings","Event published":"interface.messages.event_published","New RSVP submissions":"interface.messages.new_rsvp_submissions","Add household":"interface.messages.add_household","Add guest":"interface.messages.add_guest","Add Contact":"interface.messages.add_contact","OR":"interface.messages.contact_alternative_or","From your household":"interface.messages.primary_contact_from_household","From guest list":"interface.messages.primary_contact_from_guest_list","New contact":"interface.messages.primary_contact_new","Matching contact details required":"interface.messages.matching_contact_details_required","No household contacts to choose from.":"interface.messages.no_household_contact_choices","Use Email with an email address, or SMS or WhatsApp with a phone number.":"interface.messages.primary_contact_delivery_help","Edit primary contact":"interface.messages.edit_primary_contact","Remove primary contact":"interface.messages.remove_primary_contact","Choose a saved contact":"interface.messages.choose_saved_contact","Use contact":"interface.messages.use_contact","Add venue":"interface.messages.add_venue","Add session":"interface.messages.add_session","Add category":"interface.messages.add_category","Household or guest":"interface.messages.household_or_guest","Show archived records":"interface.messages.show_archived_records","⌄ Expand all":"interface.messages.expand_all","› Collapse all":"interface.messages.collapse_all","Click a household to expand its individual guests. Select the top-right pencil to enable editing; each guest then has a pencil for their details. Parent–child household nesting is preserved.":"interface.messages.click_a_household_to_expand_its_individual_guests_select_the_top_","Empty households have no invitation code. Add a guest, then use Manage Invites. Assign sessions in Settings.":"interface.messages.empty_households_have_no_invitation_code_add_a_guest_then_use_man","Household name":"interface.messages.household_name","Household language":"interface.messages.household_language","Household email":"interface.messages.household_email","Household phone":"interface.messages.household_phone","Landline":"interface.messages.household_landline","Household notes":"interface.messages.household_notes","Household details":"interface.messages.household_details","Household contact details":"interface.messages.household_contact_details","Household default":"interface.messages.household_default","Parent household":"interface.messages.parent_household","Child households":"interface.messages.child_households","Grouping household":"interface.messages.grouping_household","None (top level)":"interface.messages.none_top_level","Relation group":"interface.messages.relation_group","Relation":"interface.messages.relation","Notes":"interface.messages.notes","Phone":"interface.messages.phone","Postal address":"interface.messages.postal_address","Preferred contact":"interface.messages.preferred_contact","Preferred contact method":"interface.messages.preferred_contact_method","Preferred delivery method":"interface.messages.preferred_delivery_method","First name":"interface.messages.first_name","Last name":"interface.messages.last_name","Title":"interface.messages.title","None":"interface.messages.none","Son":"interface.messages.son","Daughter":"interface.messages.daughter","Child":"interface.messages.child","Child guest":"interface.messages.child_guest","Dietary requirements":"interface.messages.dietary_requirements","Individual guests":"interface.messages.individual_guests","Unnamed guest":"interface.messages.unnamed_guest","Unnamed household":"interface.messages.unnamed_household","Ungrouped":"interface.messages.ungrouped","No matching households.":"interface.messages.no_matching_households","No guests assigned to this household.":"interface.messages.no_guests_assigned_to_this_household","No active guests match this search.":"interface.messages.no_active_guests_match_this_search","Search guests":"interface.messages.search_guests","Guest name or household":"interface.messages.guest_name_or_household","Guest":"interface.messages.guest","Save household":"interface.messages.save_household","Create household":"interface.messages.create_household","Save guest":"interface.messages.save_guest","Move guest":"interface.messages.move_guest","Destination household":"interface.messages.destination_household","Choose household":"interface.messages.choose_household","Move household up":"interface.messages.move_household_up","Move household down":"interface.messages.move_household_down","New guests inherit this household’s session invitations.":"interface.messages.new_guests_inherit_this_household_s_session_invitations","RSVP status and household assignment are not changed by editing guest details.":"interface.messages.rsvp_status_and_household_assignment_are_not_changed_by_editing_g","Current session invitations are preserved as individual overrides. Moves involving RSVP history are blocked.":"interface.messages.current_session_invitations_are_preserved_as_individual_overrides","Move this guest and preserve their current session invitations?":"interface.messages.move_this_guest_and_preserve_their_current_session_invitations","Grouping changes with child households require moving the children first.":"interface.messages.grouping_changes_with_child_households_require_moving_the_childre","First name is required.":"interface.messages.first_name_is_required","Guest details saved.":"interface.messages.guest_details_saved","Changes saved.":"interface.messages.changes_saved","Household order saved.":"interface.messages.household_order_saved","Edit":"interface.messages.edit","Delete":"interface.messages.delete","Delete archived household":"interface.messages.delete_archived_household","Delete archived guest":"interface.messages.delete_archived_guest","Permanently delete this archived record?":"interface.messages.confirm_delete_archived_record","Archived record deleted.":"interface.messages.archived_record_deleted","This record is linked to other records or history and must stay archived":"interface.messages.archived_record_linked","Rename":"interface.messages.rename","Archive ":"interface.messages.archive","Restore ":"interface.messages.restore","Edit guest: ":"interface.messages.edit_guest","Edit household: ":"interface.messages.edit_household","Select guest: ":"interface.messages.select_guest","Edit contact: ":"interface.messages.edit_contact","Archive this household and disable its invitation link? Records and history are preserved.":"interface.messages.archive_this_household_and_disable_its_invitation_link_records_an","Archive this record? It can be restored later.":"interface.messages.archive_this_record_it_can_be_restored_later","Restore this record?":"interface.messages.restore_this_record","Record archived.":"interface.messages.record_archived","Record restored.":"interface.messages.record_restored","Contact":"interface.messages.contact","Contact name":"interface.messages.contact_name","Contact type":"interface.messages.contact_type","Contact details":"interface.messages.contact_details","Contact language":"interface.messages.contact_language","Linked guest":"interface.messages.linked_guest","Remove guest link":"interface.messages.remove_guest_link","Primary":"interface.messages.primary","Primary contact for this type":"interface.messages.primary_contact_for_this_type","Save contact":"interface.messages.save_contact","Create contact":"interface.messages.create_contact","No contacts added yet.":"interface.messages.no_contacts_added_yet","Choose someone from the guest list":"interface.messages.choose_someone_from_the_guest_list","Choose a guest or enter a new contact below. Guest selection fills the name, language and household’s preferred delivery method and contact details. Review them before saving.":"interface.messages.choose_a_guest_or_enter_a_new_contact_below_guest_selection_fills","Private codes and links for households with guests. Sending remains manual.":"interface.messages.private_codes_and_links_for_households_with_guests_sending_remain","Search invitations":"interface.messages.search_invitations","Invitation code":"interface.messages.invitation_code","Copy invitation link":"interface.messages.copy_invitation_link","Link":"interface.messages.invite_copy_link_short","Copy invite code":"interface.messages.copy_invite_code","Copy link":"interface.messages.copy_link","Copy message":"interface.messages.copy_message","Invitation code copied.":"interface.messages.invitation_code_copied","Invitation link copied.":"interface.messages.invitation_link_copied","Message copied.":"interface.messages.message_copied","No matching invitations. Empty and archived households have no active invitation.":"interface.messages.no_matching_invitations_empty_and_archived_households_have_no_act","Delivery log":"interface.messages.delivery_log","Invitation delivery":"interface.messages.invitation_delivery","Filter delivery status":"interface.messages.filter_delivery_status","All statuses":"interface.messages.all_statuses","Draft":"interface.messages.draft","Ready":"interface.messages.ready","Ready to send":"interface.messages.ready_to_send","Failed":"interface.messages.failed","Cancelled":"interface.messages.cancelled","Recorded sent":"interface.messages.recorded_sent","No deliveries match this status.":"interface.messages.no_deliveries_match_this_status","No delivery recorded yet.":"interface.messages.no_delivery_recorded_yet","Prepare delivery":"interface.messages.prepare_delivery","Delivery channel":"interface.messages.delivery_channel","Delivery recipient":"interface.messages.delivery_recipient","Delivery status":"interface.messages.delivery_status","Message subject":"interface.messages.message_subject","Message text":"interface.messages.message_text","Delivery change note":"interface.messages.delivery_change_note","Create delivery draft":"interface.messages.create_delivery_draft","Save delivery changes":"interface.messages.save_delivery_changes","Edit delivery":"interface.messages.edit_delivery","Record as sent":"interface.messages.record_as_sent","Sent note":"interface.messages.sent_note","I sent this message to the displayed recipient":"interface.messages.i_sent_this_message_to_the_displayed_recipient","Manual":"interface.messages.manual","Manual / in person":"interface.messages.manual_in_person","Postal":"interface.messages.postal","Other":"interface.messages.other","Recipient: ":"interface.messages.recipient","To: ":"interface.messages.to","Manually recorded as sent · ":"interface.messages.manually_recorded_as_sent","Missing — add contact details before marking ready.":"interface.messages.missing_add_contact_details_before_marking_ready","Saving a draft or marking it ready does not send a message. Review the recipient and text, send it yourself, then record it as sent.":"interface.messages.saving_a_draft_or_marking_it_ready_does_not_send_a_message_review","RSVP management":"interface.messages.rsvp_management","Remove assignment":"interface.messages.remove_assignment","Unsaved":"interface.messages.unsaved","RSVP":"interface.messages.rsvp_action","Locked":"interface.messages.rsvp_locked","Current response":"interface.messages.current_response","Choose response":"interface.messages.choose_response","Corrected response":"interface.messages.corrected_response","Correct response: ":"interface.messages.correct_response","Attending":"interface.messages.attending","Not attending":"interface.messages.not_attending","Pending":"interface.messages.pending","RSVP required":"interface.messages.rsvp_required","Information only":"interface.messages.information_only","Locked after submission":"interface.messages.locked_after_submission","Open for responses":"interface.messages.open_for_responses","Reason for RSVP correction":"interface.messages.reason_for_rsvp_correction","Save correction":"interface.messages.save_correction","This updates the current response and records the reason. The original submission and household lock are preserved.":"interface.messages.this_updates_the_current_response_and_records_the_reason_the_orig","Reopen RSVP":"interface.messages.reopen_rsvp","Reason for reopening":"interface.messages.reason_for_reopening","Reopen this household’s RSVP while preserving its submission history?":"interface.messages.reopen_this_household_s_rsvp_while_preserving_its_submission_hist","Reopening lets the household submit again. Previous submissions remain in history. If the event deadline has passed, grant a late-response window after reopening.":"interface.messages.reopening_lets_the_household_submit_again_previous_submissions_re","Allow a late response":"interface.messages.allow_a_late_response","Allow late response":"interface.messages.allow_late_response","Allow responses until (":"interface.messages.allow_responses_until","Reason for late response":"interface.messages.reason_for_late_response","No active RSVP sessions are assigned to this household.":"interface.messages.no_active_rsvp_sessions_are_assigned_to_this_household","Invitations are protected because this household has RSVP history.":"interface.messages.invitations_are_protected_because_this_household_has_rsvp_history","Grouped by category. Switch to Edit to sort, rename, or update items. Existing claims are preserved.":"interface.messages.grouped_by_category_switch_to_edit_to_sort_rename_or_update_items","Category name":"interface.messages.category_name","New category name":"interface.messages.new_category_name","Register category":"interface.messages.register_category","Register existing category":"interface.messages.register_existing_category","Move category up":"interface.messages.move_category_up","Move category down":"interface.messages.move_category_down","Category for ":"interface.messages.category_for","Faroese name":"interface.messages.faroese_name","English name":"interface.messages.english_name","German name":"interface.messages.german_name","Faroese description":"interface.messages.faroese_description","English description":"interface.messages.english_description","German description":"interface.messages.german_description","Quantity needed":"interface.messages.quantity_needed","Display order":"interface.messages.display_order","Available for guests":"interface.messages.available_for_guests","Uncategorized":"interface.messages.uncategorized","Unnamed item":"interface.messages.unnamed_item","Not registered":"interface.messages.not_registered","Faroese name is required.":"interface.messages.faroese_name_is_required","Enter a non-negative quantity.":"interface.messages.enter_a_non_negative_quantity","Category order saved.":"interface.messages.category_order_saved","Category registered.":"interface.messages.category_registered","Session":"interface.messages.session","Session name":"interface.messages.session_name","Session key":"interface.messages.session_key","Session venue":"interface.messages.session_venue","Active session":"interface.messages.active_session","Starts (venue local time)":"interface.messages.starts_venue_local_time","Ends (venue local time)":"interface.messages.ends_venue_local_time","Save session":"interface.messages.save_session","Create session":"interface.messages.create_session","Venue name":"interface.messages.venue_name","Venue address":"interface.messages.venue_address","Venue timezone":"interface.messages.venue_timezone","Country code":"interface.messages.country_code","Map link (HTTPS)":"interface.messages.map_link_https","Guest venue notes":"interface.messages.guest_venue_notes","Welcome message — ":"interface.messages.welcome_message","Welcome messages for this venue":"interface.messages.welcome_messages_for_this_venue","Archived venue":"interface.messages.archived_venue","Save venue":"interface.messages.save_venue","Create venue":"interface.messages.create_venue","No venue":"interface.messages.no_venue","Unscheduled":"interface.messages.unscheduled","Times are entered in ":"interface.messages.times_are_entered_in","Session invitations":"interface.messages.session_invitations","Save session invitations":"interface.messages.save_session_invitations","Create sessions in Settings first.":"interface.messages.create_sessions_in_settings_first","Household defaults apply to each guest unless an individual exception is selected. Language does not determine invitations.":"interface.messages.household_defaults_apply_to_each_guest_unless_an_individual_excep","Follow household":"interface.messages.follow_household","Invited":"interface.messages.invited","Not invited":"interface.messages.not_invited","Household invited":"interface.messages.household_invited","Household not invited":"interface.messages.household_not_invited","Switch to Edit mode":"interface.messages.switch_to_edit_mode","Switch to View mode":"interface.messages.switch_to_view_mode","Edit mode · Changes are saved to the event database":"interface.messages.edit_mode_changes_are_saved_to_the_event_database","Loading event data…":"interface.messages.loading_event_data","Event data refreshed.":"interface.messages.event_data_refreshed","Event settings saved.":"interface.messages.event_settings_saved","Switch to Edit mode first.":"interface.messages.switch_to_edit_mode_first","Invalid RSVP deadline.":"interface.messages.invalid_rsvp_deadline","Confirm the release acknowledgement before publishing.":"interface.messages.confirm_the_release_acknowledgement_before_publishing","Complete the event name, date, website URL, active session and invitations before publishing.":"interface.messages.complete_the_event_name_date_website_url_active_session_and_invit","Unpublish this event? Guest access to published event details will stop.":"interface.messages.unpublish_this_event_guest_access_to_published_event_details_will","Event published.":"interface.messages.event_published_2","Event unpublished.":"interface.messages.event_unpublished","Enter matching passwords of at least 12 characters.":"interface.messages.enter_matching_passwords_of_at_least_12_characters","Sign in again before sending an invitation.":"interface.messages.sign_in_again_before_sending_an_invitation","Invitation could not be sent.":"interface.messages.invitation_could_not_be_sent","Email delivery status is uncertain. Check before resending.":"interface.messages.email_delivery_status_is_uncertain_check_before_resending","Email status is uncertain. Refresh pending invitations before retrying.":"interface.messages.email_status_is_uncertain_refresh_pending_invitations_before_retr","Email sending is restricted. Check the email configuration.":"interface.messages.email_sending_is_restricted_check_the_email_configuration","The email could not be sent. Check the email configuration before resending.":"interface.messages.the_email_could_not_be_sent_check_the_email_configuration_before_","The email service request limit was reached. Wait before resending.":"interface.messages.the_email_service_request_limit_was_reached_wait_before_resending","The email service sending limit was reached. Wait before resending.":"interface.messages.the_email_service_sending_limit_was_reached_wait_before_resending","Administrator invitations are unavailable. The invitation service must be installed before sending.":"interface.messages.administrator_invitations_are_unavailable_the_invitation_service_","Administrator list unavailable. Apply migration 006 if needed.":"interface.messages.administrator_list_unavailable_apply_migration_006_if_needed","Admin management API unavailable: ":"interface.messages.admin_management_api_unavailable","No active administrator invitation was found for this account. Ask an administrator to send or resend it.":"interface.messages.no_active_administrator_invitation_was_found_for_this_account_ask","Your account does not have administrator access, or invitation acceptance is unavailable. Ask an administrator to check your invitation.":"interface.messages.your_account_does_not_have_administrator_access_or_invitation_acc","Session logging is unavailable.":"interface.messages.session_logging_is_unavailable","Signed in, but session logging is unavailable.":"interface.messages.signed_in_but_session_logging_is_unavailable","Send another administrator invitation email to ":"interface.messages.send_another_administrator_invitation_email_to","Cancel administrator invitation for ":"interface.messages.cancel_administrator_invitation_for","Revoke administrator access for ":"interface.messages.revoke_administrator_access_for","Added":"interface.messages.added","Updated":"interface.messages.updated","Deleted":"interface.messages.deleted","Archived":"interface.messages.archived","Restored":"interface.messages.restored","Moved":"interface.messages.moved","Renamed":"interface.messages.renamed","Assigned":"interface.messages.assigned","Enabled":"interface.messages.enabled","Disabled":"interface.messages.disabled","Unspecified":"interface.messages.unspecified","Expired":"interface.messages.expired","Draft saved":"interface.messages.draft_saved","Delivery created":"interface.messages.delivery_created","Failed delivery":"interface.messages.failed_delivery","Failed attempt":"interface.messages.failed_attempt","Household submitted":"interface.messages.household_submitted","Guest response submitted":"interface.messages.guest_response_submitted","Guest response corrected":"interface.messages.guest_response_corrected","RSVP reopened":"interface.messages.rsvp_reopened","Late response allowed":"interface.messages.late_response_allowed","Invitation opened":"interface.messages.invitation_opened","Invitation assignments changed":"interface.messages.invitation_assignments_changed","Sign-in session":"interface.messages.sign_in_session","Signed out":"interface.messages.signed_out","Sign-out requested":"interface.messages.sign_out_requested","Token refreshed":"interface.messages.token_refreshed","Administrator invitation accepted":"interface.messages.administrator_invitation_accepted_2","Administrator invitation cancelled":"interface.messages.administrator_invitation_cancelled_2","Administrator email requested":"interface.messages.administrator_email_requested","Administrator email accepted by service":"interface.messages.administrator_email_accepted_by_service","Administrator email failed":"interface.messages.administrator_email_failed","Email failed":"interface.messages.email_failed","Sending / status pending":"interface.messages.sending_status_pending","Access removed":"interface.messages.access_removed","FIRST-TIME SETUP":"interface.messages.first_time_setup","Make this event yours.":"interface.messages.make_this_event_yours","Connect your own Supabase project in four steps. No terminal or Python required.":"interface.messages.connect_your_own_supabase_project_in_four_steps_no_terminal_or_py","Administration · Own your data":"interface.messages.administration_own_your_data","Database choice":"interface.messages.database_choice","Connection":"interface.messages.connection","Verify admin":"interface.messages.verify_admin","Publish config":"interface.messages.publish_config","STEP 1 OF 4":"interface.messages.step_1_of_4","STEP 2 OF 4":"interface.messages.step_2_of_4","STEP 3 OF 4":"interface.messages.step_3_of_4","STEP 4 OF 4":"interface.messages.step_4_of_4","How would you like to begin?":"interface.messages.how_would_you_like_to_begin","Use existing database":"interface.messages.use_existing_database","Connect to an already-migrated Supabase project. Preserve its invitations, guests and admin accounts.":"interface.messages.connect_to_an_already_migrated_supabase_project_preserve_its_invi","Set up a new database":"interface.messages.set_up_a_new_database","Create an empty Supabase project, run the included SQL, then create the first administrator.":"interface.messages.create_an_empty_supabase_project_run_the_included_sql_then_create","Continue":"interface.messages.continue","Connect Supabase":"interface.messages.connect_supabase","Project URL":"interface.messages.project_url","Publishable or legacy anon key":"interface.messages.publishable_or_legacy_anon_key","Test connection":"interface.messages.test_connection","Never paste a Supabase secret key, service_role key, database password or access token here. Only public client keys belong in a static website.":"interface.messages.never_paste_a_supabase_secret_key_service_role_key_database_passw","New database instructions":"interface.messages.new_database_instructions","Create a project at":"interface.messages.create_a_project_at","Open SQL Editor and run the included migrations 001–006 in order, or use the bundled install file. These are starter migrations and require functional/security testing before public launch.":"interface.messages.open_sql_editor_and_run_the_included_migrations_001_006_in_order_","Create an Auth user under Authentication → Users.":"interface.messages.create_an_auth_user_under_authentication_users","Download complete SQL installer":"interface.messages.download_complete_sql_installer","First admin email (for new installations)":"interface.messages.first_admin_email_for_new_installations","Generate first-admin SQL":"interface.messages.generate_first_admin_sql","Copy SQL":"interface.messages.copy_sql","The SQL appears here. Run it in your private Supabase SQL Editor, never on the website.":"interface.messages.the_sql_appears_here_run_it_in_your_private_supabase_sql_editor_n","Secure administrator access":"interface.messages.secure_administrator_access","For new projects, invite your first user via":"interface.messages.for_new_projects_invite_your_first_user_via",", then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.":"interface.messages.then_run_the_sql_below_in_supabase_sql_editor_to_grant_admin_acce","Check administrator login":"interface.messages.check_administrator_login","Put your configuration online":"interface.messages.put_your_configuration_online","Administrator verified. Your website configuration is ready.":"interface.messages.administrator_verified_your_website_configuration_is_ready","Download config.js":"interface.messages.download_config_js","Copy config contents":"interface.messages.copy_config_contents","Go to admin":"interface.messages.go_to_admin","The file contains only your Supabase URL and publishable / anon key. It must not contain a secret or service_role key.":"interface.messages.the_file_contains_only_your_supabase_url_and_publishable_anon_key","After committing":"interface.messages.after_committing",", enable GitHub Pages for the new repository. Then open the website, verify admin sign-in and invitation behavior. Keep the event unpublished until final security checks pass.":"interface.messages.enable_github_pages_for_the_new_repository_then_open_the_website_","Enter":"interface.messages.enter",", and add it to":"interface.messages.and_add_it_to","in your NEW GitHub repository. This step is essential: browser-only setup does not configure the public website for other visitors.":"interface.messages.in_your_new_github_repository_this_step_is_essential_browser_only","For a new project, create your first Auth user in Supabase and use the setup wizard to establish admin access.":"interface.messages.for_a_new_project_create_your_first_auth_user_in_supabase_and_use","Test your Supabase connection before continuing.":"interface.messages.test_your_supabase_connection_before_continuing","Administrator verification required.":"interface.messages.administrator_verification_required","Sign in as an administrator first.":"interface.messages.sign_in_as_an_administrator_first","Database connection or schema validation failed: ":"interface.messages.database_connection_or_schema_validation_failed","Guest Edge Function is unavailable. Deploy the guest-gateway function first: ":"interface.messages.guest_edge_function_is_unavailable_deploy_the_guest_gateway_funct","Enter a valid administrator email.":"interface.messages.enter_a_valid_administrator_email","First-admin SQL generated. This must be executed in the private Supabase SQL Editor, not in the browser.":"interface.messages.first_admin_sql_generated_this_must_be_executed_in_the_private_su","This account does not have administrator access. Run the first-admin SQL or ask an existing admin to grant access.":"interface.messages.this_account_does_not_have_administrator_access_run_the_first_adm","Generate SQL first.":"interface.messages.generate_sql_first","SQL copied.":"interface.messages.sql_copied","Unable to copy SQL. Select it manually.":"interface.messages.unable_to_copy_sql_select_it_manually","Configuration copied.":"interface.messages.configuration_copied","Clipboard access denied. Download the file instead.":"interface.messages.clipboard_access_denied_download_the_file_instead","Connected to {host}. The protected guest gateway responded.":"interface.messages.connected_to_host_the_protected_guest_gateway_responded","Database not configured":"interface.messages.database_not_configured","Database not connected. Complete the setup wizard first.":"interface.messages.database_not_connected_complete_the_setup_wizard_first","Invalid administrator action":"interface.messages.invalid_administrator_action","Administrator request failed.":"interface.messages.administrator_request_failed","Your sign-in has expired. Sign in again before saving. Your edits have not been submitted.":"interface.messages.your_sign_in_has_expired_sign_in_again_before_saving_your_edits_h","The server returned an unreadable response.":"interface.messages.the_server_returned_an_unreadable_response","Supabase JavaScript library did not load. Check the network connection.":"interface.messages.supabase_javascript_library_did_not_load_check_the_network_connec","Supabase URL must use HTTPS (except localhost).":"interface.messages.supabase_url_must_use_https_except_localhost","Use only the Supabase project URL, with no credentials or query string.":"interface.messages.use_only_the_supabase_project_url_with_no_credentials_or_query_st","Use only a publishable or anon key, never a secret key.":"interface.messages.use_only_a_publishable_or_anon_key_never_a_secret_key","This JWT is not an anon key.":"interface.messages.this_jwt_is_not_an_anon_key","The supplied JWT key is malformed.":"interface.messages.the_supplied_jwt_key_is_malformed","Expected a publishable key or legacy anon JWT.":"interface.messages.expected_a_publishable_key_or_legacy_anon_jwt","Something went wrong.":"interface.messages.something_went_wrong","Enter a complete date and time.":"interface.messages.enter_a_complete_date_and_time","Invalid date and time.":"interface.messages.invalid_date_and_time","This local time is ambiguous or does not exist because clocks change. Choose a time outside the clock change.":"interface.messages.this_local_time_is_ambiguous_or_does_not_exist_because_clocks_cha","A simple way to celebrate together.":"interface.messages.a_simple_way_to_celebrate_together","Your event,":"interface.messages.your_event","beautifully arranged.":"interface.messages.beautifully_arranged","Private invitations · Please do not share your invitation link.":"interface.messages.private_invitations_please_do_not_share_your_invitation_link","SETUP REQUIRED":"interface.messages.setup_required","Connect your event":"interface.messages.connect_your_event","This website has not been connected to Supabase yet.":"interface.messages.this_website_has_not_been_connected_to_supabase_yet","Open first-time setup":"interface.messages.open_first_time_setup","YOUR INVITATION":"interface.messages.your_invitation","Open your invitation":"interface.messages.open_your_invitation","Enter the eight-character invitation code or open the private link you received.":"interface.messages.enter_the_eight_character_invitation_code_or_open_the_private_lin","Open":"interface.messages.open","PERSONAL INVITATION":"interface.messages.personal_invitation","Welcome":"interface.messages.welcome","Please let us know who will attend.":"interface.messages.please_let_us_know_who_will_attend","Submit RSVP":"interface.messages.submit_rsvp","What can you bring?":"interface.messages.what_can_you_bring","Choose items only if you want to contribute. Quantities cannot exceed what is needed.":"interface.messages.choose_items_only_if_you_want_to_contribute_quantities_cannot_exc","Confirm my selections":"interface.messages.confirm_my_selections","Invalid quantity":"interface.messages.invalid_quantity","Invalid invitation code":"interface.messages.invalid_invitation_code","Your event":"interface.messages.your_event_2","Invitation":"interface.messages.invitation","Quantity for {item}":"interface.messages.quantity_for_item","Interface language":"interface.messages.interface_language","Interface wording":"interface.messages.interface_wording","Welcome messages":"interface.messages.welcome_messages","Save welcome messages":"interface.messages.save_welcome_messages","Welcome messages saved.":"interface.messages.welcome_messages_saved","Leave a welcome message blank to use the built-in translation.":"interface.messages.leave_a_welcome_message_blank_to_use_the_built_in_translation","Customize interface wording":"interface.messages.customize_interface_wording","Choose a phrase and language, edit the wording, then download the file and replace js/interface-overrides.js in the repository. This does not publish the event.":"interface.messages.choose_a_phrase_and_language_edit_the_wording_then_download_the_f","Phrase":"interface.messages.phrase","Custom wording":"interface.messages.custom_wording","Use {placeholders} exactly as shown. Blank text restores the built-in wording.":"interface.messages.use_placeholders_exactly_as_shown_blank_text_restores_the_built_i","Apply wording":"interface.messages.apply_wording","Download wording file":"interface.messages.download_wording_file","Wording applied to this preview. Download and commit the file to share it.":"interface.messages.wording_applied_to_this_preview_download_and_commit_the_file_to_s","Keep the same placeholders as the original phrase.":"interface.messages.keep_the_same_placeholders_as_the_original_phrase","EVENT INVITATION":"interface.messages.event_invitation_2","Enter the eight-character code from your invitation.":"interface.messages.enter_the_eight_character_code_from_your_invitation","Dear guests":"interface.messages.dear_guests","Your response has been received and locked.":"interface.messages.your_response_has_been_received_and_locked","Thank you! Your response is recorded.":"interface.messages.thank_you_your_response_is_recorded","No invitation was found for that code.":"interface.messages.no_invitation_was_found_for_that_code","Choose a response for every invited guest and session.":"interface.messages.choose_a_response_for_every_invited_guest_and_session","Could not reach the database.":"interface.messages.could_not_reach_the_database","This event has not been published yet.":"interface.messages.this_event_has_not_been_published_yet","Choose only what you would like to contribute. Quantities are limited.":"interface.messages.choose_only_what_you_would_like_to_contribute_quantities_are_limi","Save":"interface.messages.save","Available":"interface.messages.available","All invited guests are listed.":"interface.messages.all_invited_guests_are_listed","Changing language reloads this page. Unsaved changes will be lost. Continue?":"interface.messages.changing_language_reloads_this_page_unsaved_changes_will_be_lost_","Showing {count} of {total} matching guests.":"interface.messages.showing_count_of_total_matching_guests","{count} entries shown · Newest first":"interface.messages.count_entries_shown_newest_first"," · Confirmed":"interface.messages.confirmed"," · Last submission {time}":"interface.messages.last_submission_time","Event deadline: {deadline} · Late-response permission: {late} · {zone}":"interface.messages.event_deadline_deadline_late_response_permission_late_zone","{ready} ready · {sent} recorded sent · {failed} failed":"interface.messages.ready_ready_sent_recorded_sent_failed_failed","{count} guests":"interface.messages.count_guests","{count} sub-households · {guests} guests in sub-households":"interface.messages.count_sub_households_guests_guests_in_sub_households","Quantity cannot fall below {count} claimed; claimed items cannot be hidden.":"interface.messages.quantity_cannot_fall_below_count_claimed_claimed_items_cannot_be_","Needed {needed} · Claimed {claimed} · Available {available}{inactive}":"interface.messages.needed_needed_claimed_claimed_available_available_inactive"," · Inactive":"interface.messages.inactive","Archive {item}? Existing claims are preserved; you can reactivate it using Edit.":"interface.messages.archive_item_existing_claims_are_preserved_you_can_reactivate_it_","Revoke administrator access for {email}?":"interface.messages.revoke_administrator_access_for_email","Times are entered in {zone}. Changing venue keeps the typed local time; review before saving.":"interface.messages.times_are_entered_in_zone_changing_venue_keeps_the_typed_local_ti","For new projects, invite your first user via Supabase → Authentication → Users, then run the SQL below in Supabase SQL Editor to grant admin access. Existing projects may already have administrators.":"interface.messages.for_new_projects_invite_your_first_user_via_supabase_authenticati","{attending} attending · {declined} declined":"interface.messages.attending_attending_declined_declined","{sent} recorded sent · {pending} pending":"interface.messages.sent_recorded_sent_pending_pending","{count} households":"interface.messages.count_households","{count} items":"interface.messages.count_items"," · Child":"interface.messages.child_2"," · Archived":"interface.messages.archived_2"," (unregistered)":"interface.messages.unregistered"," (inactive)":"interface.messages.inactive_2"," — household":"interface.messages.household"," · Expires {time}":"interface.messages.expires_time","Household":"interface.messages.household_2","Wording preview":"interface.messages.wording_preview","Download":"interface.messages.download","{count} guest":"interface.messages.count_guest","{count} sub-household":"interface.messages.count_sub_household","{count} sub-households":"interface.messages.count_sub_households","{count} guest in sub-households":"interface.messages.count_guest_in_sub_households","{count} guests in sub-households":"interface.messages.count_guests_in_sub_households","Archive household":"interface.messages.archive_household","Restore household":"interface.messages.restore_household","Archive guest":"interface.messages.archive_guest","Restore guest":"interface.messages.restore_guest","Archive contact":"interface.messages.archive_contact","Restore contact":"interface.messages.restore_contact","Languages":"interface.messages.languages","Backups":"interface.messages.backups","Fallback language":"interface.messages.fallback_language","Choose enabled languages and the fallback used for missing translations. English is the final built-in fallback.":"interface.messages.choose_enabled_languages_and_the_fallback_used_for_missing_transl","Save language preferences":"interface.messages.save_language_preferences","Add language":"interface.messages.add_language","Language code":"interface.messages.language_code","Save language":"interface.messages.save_language","Language saved.":"interface.messages.language_saved","Language preferences saved.":"interface.messages.language_preferences_saved","Translations":"interface.messages.translations","Text to translate":"interface.messages.text_to_translate","Translation":"interface.messages.translation","Save translation":"interface.messages.save_translation","Translation saved.":"interface.messages.translation_saved","Fallback preview":"interface.messages.fallback_preview","Venue":"interface.messages.venue","Description":"interface.messages.description","Blank text uses the configured fallback language, then English.":"interface.messages.blank_text_uses_the_configured_fallback_language_then_english","Choose a phrase and language, then save the translation. Downloading a wording file is optional. This does not publish the event.":"interface.messages.choose_a_phrase_and_language_then_save_the_translation_downloadin","Download an application backup containing guest information, private invitation codes, settings, translations, contributions and historical records. Store it privately.":"interface.messages.download_an_application_backup_containing_guest_information_priva","Auth passwords, sessions, administrator access, deployment secrets, rate-limit counters and sign-in logs are not restored. Keep a separate copy of the repository and deployment configuration.":"interface.messages.auth_passwords_sessions_administrator_access_deployment_secrets_r","Download application backup":"interface.messages.download_application_backup","Validate and restore":"interface.messages.validate_and_restore","Choose a backup to inspect it. Full validation rehearses the restore and rolls it back. Import requires an empty, unpublished destination with matching migrations and verified historical actor accounts. Existing application records cannot be overwritten.":"interface.messages.choose_a_backup_to_inspect_it_full_validation_rehearses_the_resto","Backup file":"interface.messages.backup_file","Validate backup":"interface.messages.validate_backup","Restore confirmation":"interface.messages.restore_confirmation","I understand this restores application data into an empty destination and keeps the event unpublished.":"interface.messages.i_understand_this_restores_application_data_into_an_empty_destina","Restore application backup":"interface.messages.restore_application_backup","Preparing backup…":"interface.messages.preparing_backup","Backup export is unavailable. Install the matching migration first.":"interface.messages.backup_export_is_unavailable_install_the_matching_migration_first","Backup downloaded. Store it privately and rehearse restoration.":"interface.messages.backup_downloaded_store_it_privately_and_rehearse_restoration","Backup exceeds 20 MB.":"interface.messages.backup_exceeds_20_mb","Unsupported backup format or version.":"interface.messages.unsupported_backup_format_or_version","Validating backup…":"interface.messages.validating_backup","Backup validation is unavailable.":"interface.messages.backup_validation_is_unavailable","Restore rehearsal passed. No data was changed.":"interface.messages.restore_rehearsal_passed_no_data_was_changed","This destination cannot be restored: ":"interface.messages.this_destination_cannot_be_restored","Application restored. The event is unpublished. Review administrator access separately.":"interface.messages.application_restored_the_event_is_unpublished_review_administrato","RESTORE followed by the source event name":"interface.messages.restore_followed_by_the_source_event_name","Open email":"interface.messages.open_email","Open Messages":"interface.messages.open_messages","Open WhatsApp":"interface.messages.open_whatsapp","Copy the message, open Messages, then paste and send.":"interface.messages.copy_the_message_open_messages_then_paste_and_send","Review the message in your device app and tap Send.":"interface.messages.review_the_message_in_your_device_app_and_tap_send","Opening an app does not mark this message as sent. Return here to confirm sending. Delivery and read receipts remain in your messaging app.":"interface.messages.opening_an_app_does_not_mark_this_message_as_sent_return_here_to_","Enter one valid email address.":"interface.messages.enter_one_valid_email_address","Use an international phone number, including country code.":"interface.messages.use_an_international_phone_number_including_country_code","Refresh and save this delivery again before sending.":"interface.messages.refresh_and_save_this_delivery_again_before_sending","Prepare reminder":"interface.messages.prepare_reminder","Creates a separate draft using current contact details. Review the recipient and text before sending.":"interface.messages.creates_a_separate_draft_using_current_contact_details_review_the","A friendly reminder to reply to our invitation:":"interface.messages.a_friendly_reminder_to_reply_to_our_invitation","Invites":"interface.messages.invites","Things to do":"interface.messages.things_to_do","Task":"interface.messages.task","Assigned to":"interface.messages.assigned_to","Status":"interface.messages.status","Add rows":"interface.messages.add_rows","In progress":"interface.messages.in_progress","Done":"interface.messages.done","Tasks saved.":"interface.messages.tasks_saved","Edit cells, add rows, then save. Blank new rows are ignored.":"interface.messages.edit_cells_add_rows_then_save_blank_new_rows_are_ignored","Select Edit to update the task list.":"interface.messages.select_edit_to_update_the_task_list","Name":"interface.messages.name","Amount: {claimed}/{needed}, Shown: {shown}":"interface.messages.amount_claimed_needed_shown_shown","Pick item":"interface.messages.pick_item","Remove selection":"interface.messages.remove_selection","Selected":"interface.messages.selected","Find text":"interface.messages.find_text","Choose enabled languages":"interface.messages.choose_enabled_languages","Name is required.":"interface.messages.name_is_required","Comment":"interface.messages.comment","Print / Save as PDF":"interface.messages.print_save_as_pdf","Default unit ({type})":"interface.messages.default_type_type","Expand all items":"interface.messages.expand_all_items","Collapse all items":"interface.messages.collapse_all_items","Quantity: {claimed}/{needed} {type} · {shown}":"interface.messages.amount_claimed_needed_type_shown_shown","Event welcome":"interface.messages.event_welcome","Venue welcome":"interface.messages.venue_welcome","Appears at the top of the guest invitation.":"interface.messages.appears_at_the_top_of_the_guest_invitation","Appears under the session at this venue on the guest invitation.":"interface.messages.appears_under_the_session_at_this_venue_on_the_guest_invitation","Map link":"interface.messages.map_link","Manage households":"interface.messages.manage_households","Checked households are invited to this session. Individual guest exceptions stay in place.":"interface.messages.checked_households_are_invited_to_this_session_individual_guest_e","No households to manage.":"interface.messages.no_households_to_manage","Guest exceptions":"interface.messages.guest_exceptions","Protected by RSVP history":"interface.messages.protected_by_rsvp_history","Checked items are available at this venue. Changes apply here only. Existing household claims are kept.":"interface.messages.checked_items_are_available_at_this_venue_changes_apply_here_only","Select all":"interface.messages.select_all","Nothing available to add.":"interface.messages.nothing_available_to_add","Edit administrator name":"interface.messages.edit_administrator_name","Move session up":"interface.messages.move_session_up","Move session down":"interface.messages.move_session_down","Session order saved.":"interface.messages.session_order_saved","Move language up":"interface.messages.move_language_up","Move language down":"interface.messages.move_language_down","Save translations":"interface.messages.save_translations","1 item":"interface.messages.1_item","{items} · Quantity: {claimed}/{capacity}":"interface.messages.items_claimed_capacity_amounts","Add":"interface.messages.add","Edit quantity for {household}":"interface.messages.edit_quantity_for_household","Remove selection for {household}":"interface.messages.remove_selection_for_household","Remove new item":"interface.messages.remove_new_item","Move to category":"interface.messages.move_to_category","Unsaved changes. Select Save to update the database.":"interface.messages.unsaved_changes_select_save_to_update_the_database","Use main Edit mode to change tasks. Save sends your changes to the database.":"interface.messages.use_main_edit_mode_to_change_tasks_save_sends_your_changes_to_the","Tasks were saved. Refresh the page before editing again.":"interface.messages.tasks_were_saved_refresh_the_page_before_editing_again","Item":"interface.messages.item","New item":"interface.messages.new_item","Edit item":"interface.messages.edit_item","Save item":"interface.messages.save_item","Item saved.":"interface.messages.item_saved","No items in this category.":"interface.messages.no_items_in_this_category","Use main Edit, then the pencil to edit and save a line.":"interface.messages.use_main_edit_then_the_pencil_to_edit_and_save_a_line","Add a category first.":"interface.messages.add_a_category_first","Tasks and things to bring, grouped by category. Use main Edit, then the pencil to edit a line.":"interface.messages.tasks_and_things_to_bring_grouped_by_category_use_main_edit_then_","No matching entries.":"interface.messages.no_matching_entries","Welcome Message":"interface.messages.welcome_message_title","Categories":"interface.messages.categories","Units":"interface.messages.types","Rows per page":"interface.messages.rows_per_page","Previous":"interface.messages.previous","Next":"interface.messages.next","Page {page} of {pages}":"interface.messages.page_page_of_pages","Edit translation":"interface.messages.edit_translation","Export CSV":"interface.messages.export_csv","Use the pencil to open an item, then save your changes.":"interface.messages.use_the_pencil_to_open_an_item_then_save_your_changes","Translate welcome messages, venues, sessions and food. Interface wording is in Settings → Languages.":"interface.messages.main_language_help","Guest note":"interface.messages.guest_note","Translate the item name and the note shown to guests. Units are translated in Languages → Food → Units.":"interface.messages.food_translation_help","English source":"interface.messages.english_source","Unavailable":"interface.messages.unavailable","Edit category":"interface.messages.edit_category","Delete category":"interface.messages.delete_category","Move items to another category before deleting this category.":"interface.messages.move_items_before_deleting_category","Delete empty category?":"interface.messages.delete_empty_category","Category deleted":"interface.messages.category_deleted","Category saved":"interface.messages.category_saved","Manage units":"interface.messages.manage_types","Units are shared by all food items. Translate each unit once for every enabled language.":"interface.messages.shared_food_types_help","Built-in":"interface.messages.built_in","Custom":"interface.messages.custom","Translate":"interface.messages.translate","Add unit":"interface.messages.add_type","This unit already exists.":"interface.messages.type_already_exists","Unit added":"interface.messages.type_added","Move venue up":"interface.messages.move_venue_up","Move venue down":"interface.messages.move_venue_down","Venue order saved":"interface.messages.venue_order_saved","Admin note":"interface.messages.admin_note","Unit":"interface.messages.unit","Batch":"interface.messages.batch_singular","Piece":"interface.messages.piece_singular","Tray":"interface.messages.tray_singular","Packet":"interface.messages.packet_singular","Gram":"interface.messages.gram_singular","Saving…":"interface.messages.saving_progress","Show more":"interface.messages.show_more","Show less":"interface.messages.show_less","Translate in Languages":"interface.messages.translate_in_languages","Swipe for more tabs":"interface.messages.more_tabs_hint","All wording":"interface.messages.all_wording","General":"interface.messages.general","Households & guests":"interface.messages.households_and_guests","Invites & RSVP":"interface.messages.invites_and_rsvp","Food & units":"interface.messages.food_and_units","Venues & sessions":"interface.messages.venues_and_sessions","Administrators & access":"interface.messages.administrators_and_access","Wording categories":"interface.messages.wording_categories","Main":"interface.messages.main","Interface":"interface.messages.interface","Administration areas":"interface.messages.administration_areas","Personal preferences for this device.":"interface.messages.personal_device_preferences","Translate event content for guests.":"interface.messages.translate_event_content","Manage invitations, food and event details.":"interface.messages.main_section_description","View mode":"interface.messages.view_mode","Edit mode":"interface.messages.edit_mode","Switch to light mode":"interface.messages.switch_to_light_mode","Switch to dark mode":"interface.messages.switch_to_dark_mode","Saved":"interface.messages.saved_status","Error":"interface.messages.error_status","Fully assigned":"interface.messages.fully_assigned","Hidden":"interface.messages.hidden_status","Access":"interface.messages.access_access","Access preset":"interface.messages.access_access_preset","Active":"interface.messages.access_active","Administrator management":"interface.messages.access_administrator_management","Administrator permissions are unavailable.":"interface.messages.access_administrator_permissions_are_unavailable","Browser session":"interface.messages.access_browser_session","Custom access · {edit} editable, {view} view only":"interface.messages.access_custom_access_edit_editable_view_view_only","Edit access":"interface.messages.access_edit_access","Enable":"interface.messages.access_enable","Export application backup":"interface.messages.access_export_application_backup","Full administrator":"interface.messages.access_full_administrator","Invites & delivery":"interface.messages.access_invites_delivery","Languages & settings":"interface.messages.access_languages_settings","Last activity":"interface.messages.access_last_activity","Manage members":"interface.messages.access_manage","No access":"interface.messages.access_no_access","View":"interface.messages.access_view","View only":"interface.messages.access_view_only","No access hides a section. View shows summaries. Edit allows changes.":"interface.messages.access_no_access_hides_a_section_view_shows_summaries_edit_allows_changes","No active sessions.":"interface.messages.access_no_active_sessions","No administrators to display.":"interface.messages.access_no_administrators_to_display","No eligible verified Auth account found. Send an invitation instead.":"interface.messages.access_no_eligible_verified_auth_account_found_send_an_invitation_instead","Only Full administrators can change access.":"interface.messages.access_only_full_administrators_can_change_access","Only Full administrators can change access. Settings excludes administrator and backup powers.":"interface.messages.access_only_full_administrators_can_change_access_settings_excludes_administrator_and_backup_powers","Remove administrator":"interface.messages.access_remove_administrator","Remove administrator {name}? Their Auth account and historical records remain.":"interface.messages.access_remove_administrator_name_their_auth_account_and_historical_records_remain","Restored · Disabled":"interface.messages.access_restored_disabled","Revoke":"interface.messages.access_revoke","Revoke other administrators’ sessions":"interface.messages.access_revoke_other_administrators_sessions","Revoke this application session?":"interface.messages.access_revoke_this_application_session","Revoke this session? You will return to login.":"interface.messages.access_revoke_this_session_you_will_return_to_login","Revoke your other application sessions?":"interface.messages.access_revoke_your_other_application_sessions","Save access changes for {name}?":"interface.messages.access_save_access_changes_for_name","Section":"interface.messages.access_section","Send invitations & reminders":"interface.messages.access_send_invitations_reminders","Sending is separate from editing invitations. Backup exports include data from the whole event.":"interface.messages.access_sending_is_separate_from_editing_invitations_backup_exports_include_data_from_the_whole_event","Signed in":"interface.messages.access_signed_in","Suspend":"interface.messages.access_suspend","Suspended":"interface.messages.access_suspended","This session":"interface.messages.access_this_session","Suspend administrator {name}? Their current sessions will lose application access.":"interface.messages.access_suspend_administrator_name_their_current_sessions_will_lose_application_access","Enable administrator {name} with their saved access?":"interface.messages.access_enable_administrator_name_with_their_saved_access","Add {email} with View only access? No invitation email will be sent.":"interface.messages.access_add_email_with_view_only_access_no_invitation_email_will_be_sent","Active sessions":"interface.messages.access_active_sessions","Revoke my other sessions":"interface.messages.access_revoke_my_other_sessions","Revocation ends access to this application. Everyone can revoke their own sessions.":"interface.messages.access_revocation_ends_access_to_this_application_everyone_can_revoke_their_own_sessions","Add administrator":"interface.messages.access_add_administrator","Add manually":"interface.messages.access_add_manually","Your administrator access or session has ended. Sign in again.":"interface.messages.access_your_administrator_access_or_session_has_ended_sign_in_again","New administrators start with View only access. Full administrators can customize it.":"interface.messages.access_new_administrators_start_with_view_only_access_full_administrators_can_customize_it","This action is not allowed by your administrator permissions.":"interface.messages.access_this_action_is_not_allowed_by_your_administrator_permissions","Use the available tabs to open the sections you can access.":"interface.messages.access_use_the_available_tabs_to_open_the_sections_you_can_access","Close":"interface.messages.popup_close","Preview":"interface.messages.pdf_print_preview","Adults: {adults} · Children: {children}":"interface.messages.guest_age_summary","Quantity: {claimed}/{needed} {type}":"interface.messages.quantity_claimed_needed_type","Mobile":"interface.messages.guest_mobile","Preferred guest contact method":"interface.messages.guest_contact_method","Copy household contact details":"interface.messages.copy_household_contacts","Review the copied details before saving. Existing guest values and household information are preserved.":"interface.messages.copy_contacts_review","Previous household contact details":"interface.messages.previous_household_contacts","No previous contact details.":"interface.messages.no_previous_contact_details","Missing contact":"interface.messages.missing_contact","Keep these details until you have reviewed and copied them to a guest.":"interface.messages.keep_previous_contacts","Primary household contact":"interface.messages.primary_household_contact","Choose a non-child guest from this household. Their saved contact details are used for new invitation drafts.":"interface.messages.primary_guest_help","Move guest up":"interface.messages.guest_move_up","Move guest down":"interface.messages.guest_move_down","Guest order saved":"interface.messages.guest_order_saved","Map & directions":"interface.messages.map_directions","Add person":"interface.messages.add_companion","Add to our household":"interface.messages.add_to_household","Add someone from your household before confirming your RSVP. They inherit your household’s session invitations.":"interface.messages.companion_help","Person added. Please review their attendance choices.":"interface.messages.guest_added","Preview only: added guests disappear when you reload. Nothing is saved.":"interface.messages.preview_add_guest","Please contact the organizer to add more people.":"interface.messages.companion_limit","Could not add this person. Check your invitation or contact the organizer.":"interface.messages.guest_add_error","Could not reserve the complete group. Availability has been refreshed.":"interface.messages.food_group_error","Partly assigned by the organizer":"interface.messages.food_group_partial","Contact the organizer to change this group.":"interface.messages.food_group_unavailable","Food Group saved.":"interface.messages.food_group_saved","Time format":"interface.messages.time_format","Language default":"interface.messages.time_locale","12-hour (AM/PM)":"interface.messages.time_12","24-hour":"interface.messages.time_24","Food Groups":"interface.messages.food_groups","Add Food Group":"interface.messages.add_food_group","Selecting this group commits your household to one unit of every listed item.":"interface.messages.group_commitment","Included items":"interface.messages.group_items","Choose at least two items. Resolve existing commitments before grouping.":"interface.messages.group_choose","Select group":"interface.messages.group_pick","Remove group selection":"interface.messages.group_remove","Ungroup items":"interface.messages.group_delete","Ungroup these items? No food item will be deleted.":"interface.messages.group_delete_confirm","Pick an item you would like to bring. Selected items are reserved for your household.":"interface.messages.food_selection_help","Food coordination":"interface.messages.food_coordination","Guest food step":"interface.messages.food_stage","Collect interest":"interface.messages.food_stage_interest","Choose food":"interface.messages.food_stage_selection","Keep the detailed list hidden while planning. Opening it does not publish the event. Hiding it again preserves all commitments.":"interface.messages.food_stage_help","Open the detailed food list for eligible households? This does not publish the event.":"interface.messages.food_stage_confirm","Guest food step saved.":"interface.messages.food_stage_saved","Can you bring food?":"interface.messages.food_interest_question","Let us know whether your household can bring food. We will send the invitation link again when the detailed list is ready.":"interface.messages.food_interest_help","I can bring food":"interface.messages.food_interest_yes","I can’t bring food":"interface.messages.food_interest_no","Your food answer has been saved.":"interface.messages.food_interest_saved","Could not save your food answer. Your choice is still here; refresh or contact the organizer if you already have commitments.":"interface.messages.food_interest_failed","Not answered":"interface.messages.food_interest_pending","Household food answers":"interface.messages.food_interest_answers","Can bring food: {yes} · Cannot: {no} · Not answered: {pending}":"interface.messages.food_interest_totals","Features":"interface.messages.event_features","Disabled features are hidden. Existing data is kept.":"interface.messages.features_preserve_data","Food explanation":"interface.messages.food_explanation","Review food selections":"interface.messages.food_review","Check what your household will bring before confirming.":"interface.messages.food_review_help","Your food selections changed. Please review them again.":"interface.messages.food_review_changed","Time: {start} to {end}":"interface.messages.venue_time_range","Time: {time}":"interface.messages.venue_time","Guest appearance":"interface.messages.guest_appearance","Show light/dark toggle on the guest page":"interface.messages.guest_theme_toggle","Guest default appearance":"interface.messages.guest_theme_default","Guests can change the default when the toggle is shown. Hiding it enforces the default. Your administrator appearance stays personal.":"interface.messages.guest_theme_help","We’ll share more information about the food once we’ve received everyone’s replies.":"interface.messages.food_followup","Print":"interface.messages.print","Top-level groups":"interface.messages.top_level_groups","Relational groups":"interface.messages.relation_groups","Add relational group":"interface.messages.add_relation_group","Move households and remove empty relational groups before deleting this group. Keep at least one top-level group.":"interface.messages.group_not_empty","Edit group":"interface.messages.edit_group","Delete group":"interface.messages.delete_group","Shared group":"interface.messages.shared_group","Guest invitation":"interface.messages.invitation_custom_guest_invitation","Customize the invitation without publishing the event.":"interface.messages.invitation_custom_customize_the_invitation_without_publishing_the_event","Background photo":"interface.messages.invitation_custom_background_photo","Choose JPEG":"interface.messages.invitation_custom_choose_jpeg","Replace JPEG":"interface.messages.invitation_custom_replace_jpeg","Remove photo":"interface.messages.invitation_custom_remove_photo","Restore photo":"interface.messages.invitation_custom_restore_photo","Stored privately with the event. No public image link.":"interface.messages.invitation_custom_stored_privately_with_the_event_no_public_image_link","JPEG up to 1.4 MB. Images are resized to 2400 px and metadata is removed before saving.":"interface.messages.invitation_custom_jpeg_up_to_1_4_mb_images_are_resized_to_2400_px_and_metadata_is_removed_before_saving","Crop photo":"interface.messages.invitation_custom_crop_photo","Left":"interface.messages.invitation_custom_left","Top":"interface.messages.invitation_custom_top","Bottom":"interface.messages.invitation_custom_bottom","Center":"interface.messages.invitation_custom_center","Width":"interface.messages.invitation_custom_width","Height":"interface.messages.invitation_custom_height","Photo position":"interface.messages.invitation_custom_photo_position","Darken photo":"interface.messages.invitation_custom_darken_photo","Colors & boxes":"interface.messages.invitation_custom_colors_boxes","Boxes / page":"interface.messages.invitation_custom_boxes_page","Text":"interface.messages.invitation_custom_text","Buttons":"interface.messages.invitation_custom_buttons","Box opacity":"interface.messages.invitation_custom_box_opacity","Live preview":"interface.messages.invitation_custom_live_preview","Wide":"interface.messages.invitation_custom_wide","Reset appearance":"interface.messages.invitation_custom_reset_appearance","Current private photo":"interface.messages.invitation_custom_current_private_photo","Visible crop":"interface.messages.invitation_custom_visible_crop","No background photo":"interface.messages.invitation_custom_no_background_photo","bytes":"interface.messages.invitation_custom_bytes","Preparing photo…":"interface.messages.invitation_custom_preparing_photo","Photo prepared. Save to keep it privately.":"interface.messages.invitation_custom_photo_prepared_save_to_keep_it_privately","Guest appearance saved.":"interface.messages.invitation_custom_guest_appearance_saved","Choose a JPEG under 1.4 MB.":"interface.messages.invitation_custom_choose_a_jpeg_under_1_4_mb","Invalid JPEG image.":"interface.messages.invitation_custom_invalid_jpeg_image","JPEG dimensions are too large or invalid.":"interface.messages.invitation_custom_jpeg_dimensions_are_too_large_or_invalid","Invalid photo crop.":"interface.messages.invitation_custom_invalid_photo_crop","Could not prepare this photo.":"interface.messages.invitation_custom_could_not_prepare_this_photo","All groups":"interface.messages.invitation_custom_all_groups","All languages":"interface.messages.invitation_custom_all_languages","All channels":"interface.messages.invitation_custom_all_channels","Not sent":"interface.messages.invitation_custom_not_sent","Marked sent":"interface.messages.invitation_custom_marked_sent","Awaiting reply":"interface.messages.invitation_custom_awaiting_reply","Replied":"interface.messages.invitation_custom_replied","Partly answered":"interface.messages.invitation_custom_partly_answered","No reply":"interface.messages.invitation_custom_no_reply","Never sent":"interface.messages.invitation_custom_never_sent","Last sent":"interface.messages.invitation_custom_last_sent","Recipient / channel":"interface.messages.invitation_custom_recipient_channel","Actions":"interface.messages.invitation_custom_actions","Prepare":"interface.messages.invitation_custom_prepare","Review":"interface.messages.invitation_custom_review","Follow up":"interface.messages.invitation_custom_follow_up","{answered} / {total} responses":"interface.messages.invitation_custom_answered_total_responses","No households match these filters.":"interface.messages.invitation_custom_no_households_match_these_filters","Send · Preview · Follow up":"interface.messages.invitation_custom_send_preview_follow_up","Search households or contacts":"interface.messages.invitation_custom_search_households_or_contacts","Household name or recipient":"interface.messages.invitation_custom_household_name_or_recipient","Channel":"interface.messages.invitation_custom_channel","Group by top-level / relational group":"interface.messages.invitation_custom_group_by_top_level_relational_group","Prepare drafts now. Marking ready and sending become available after publication.":"interface.messages.invitation_custom_prepare_drafts_now_marking_ready_and_sending_become_available_after_publication","Replace the invitation link placeholder before marking ready.":"interface.messages.invitation_custom_replace_the_invitation_link_placeholder_before_marking_ready","Use the guest customization editor.":"interface.messages.invitation_custom_use_the_guest_customization_editor","We look forward to celebrating our day with you.":"interface.messages.invitation_custom_we_look_forward_to_celebrating_our_day_with_you","Status messages":"interface.messages.status_messages_title","Choose which temporary messages appear. Saved logs, form errors and confirmation lists are unchanged.":"interface.messages.status_messages_help","All messages":"interface.messages.status_messages_all","Errors only":"interface.messages.status_messages_errors_only","Information":"interface.messages.status_messages_information","Success":"interface.messages.status_messages_success","Warnings":"interface.messages.status_messages_warnings","Errors":"interface.messages.status_messages_errors","Status message preferences saved.":"interface.messages.status_messages_saved","Hide messages after 5 seconds":"interface.messages.status_messages_auto_dismiss","Food":"food.messages.food","Event is unpublished: guest-facing event details and food remain hidden until you publish.":"food.messages.event_is_unpublished_guest_facing_event_details_and_food_remain_h","Food access":"food.messages.food_access","Food items":"food.messages.food_items","Add food item":"food.messages.add_food_item","Allow this household to contribute food":"food.messages.allow_this_household_to_contribute_food","Reason for food-access change":"food.messages.reason_for_food_access_change","Save food access":"food.messages.save_food_access","Disabling access is blocked while food commitments or a confirmed selection exist. Existing selections are never removed by this control.":"food.messages.disabling_access_is_blocked_while_food_commitments_or_a_confirmed","Food categories & items":"food.messages.food_categories_items","Food or category":"food.messages.food_or_category","Add food category":"food.messages.add_food_category","Rename food category":"food.messages.rename_food_category","Move food item up":"food.messages.move_food_item_up","Move food item down":"food.messages.move_food_item_down","Edit food item":"food.messages.edit_food_item","Save food item":"food.messages.save_food_item","Archive food item (preserve existing claims)":"food.messages.archive_food_item_preserve_existing_claims","No matching food items.":"food.messages.no_matching_food_items","Food category added.":"food.messages.food_category_added","Food category updated.":"food.messages.food_category_updated","Food item added.":"food.messages.food_item_added","Food item updated.":"food.messages.food_item_updated","Food item archived.":"food.messages.food_item_archived","Food order saved.":"food.messages.food_order_saved","Category renamed and linked food items updated.":"food.messages.category_renamed_and_linked_food_items_updated","View mode · Manage invitations, food and event details":"food.messages.view_mode_manage_invitations_food_and_event_details","Publish this event now? Invite-code holders may access guest RSVP and food details. Proceed only after security and guest-flow testing.":"food.messages.publish_this_event_now_invite_code_holders_may_access_guest_rsvp_","FOOD COORDINATION":"food.messages.food_coordination","Confirm food selections? This will lock further edits.":"food.messages.confirm_food_selections_this_will_lock_further_edits","Food item":"food.messages.food_item","Thank you! Your food selection is confirmed.":"food.messages.thank_you_your_food_selection_is_confirmed","Food selection saved.":"food.messages.food_selection_saved","{state} · {count} food commitments{confirmed}":"food.messages.state_count_food_commitments_confirmed","Add translations for interface phrases, event introductions, venue welcome messages, sessions and food. Missing text uses the fallback language.":"food.messages.add_translations_for_interface_phrases_event_introductions_venue_","Recipe":"food.messages.recipe","Previous recipe group":"food.messages.previous_recipe_group","Allow pop-ups to save the recipe as PDF.":"food.messages.allow_pop_ups_to_save_the_recipe_as_pdf","Add food item type":"food.messages.add_food_item_type","New food unit":"food.messages.new_food_item_type","Food unit must be at most 60 characters.":"food.messages.food_item_type_must_be_at_most_60_characters","Type translations are shared by food items with the same type.":"food.messages.type_translations_are_shared_by_food_items_with_the_same_type","No matching food units.":"food.messages.no_matching_food_types","Manage food":"food.messages.manage_food","Venue food":"food.messages.venue_food","No food items to manage.":"food.messages.no_food_items_to_manage","Add food":"food.messages.add_food","Adding unrestricted food here makes it available at this venue only. Items already assigned to other venues keep those assignments.":"food.messages.adding_unrestricted_food_here_makes_it_available_at_this_venue_on","Food Units":"food.messages.food_types","Food categories":"food.messages.food_categories","Allow food":"food.messages.allow_food","Remove the food selection for {household}?":"food.messages.remove_the_food_selection_for_household","Add recipe":"food.messages.add_recipe","Recipe name":"food.messages.recipe_name","Existing food items":"food.messages.existing_food_items","Create food item in recipe":"food.messages.create_food_item_in_recipe","Save recipe":"food.messages.save_recipe","Edit recipe":"food.messages.edit_recipe","Existing items keep their selections. Recipe items use the recipe category.":"food.messages.existing_items_keep_their_selections_recipe_items_use_the_recipe_","Move recipe to category":"food.messages.move_recipe_to_category","No recipe has been added yet.":"food.messages.no_recipe_yet","Batches":"types.units.batch_s","Pieces":"types.units.piece_s","Trays":"types.units.tray_s","Packets":"types.units.packet_s","kg":"types.units.kg","Grams":"types.units.grams"}$json$::jsonb $catalog$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113092500_consistent_guest_order.sql
-- Adults first; manual movement stays inside the adult/child partition.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_order_guest(p_guest_id uuid,p_direction integer,p_expected_order uuid[] DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h uuid;ids uuid[];position integer;target integer;swap uuid;
BEGIN
 PERFORM app_private.require_permission('households','edit');PERFORM pg_advisory_xact_lock(19421,7744);
 IF p_direction IS NULL OR p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'Invalid guest order direction';END IF;
 SELECT household_id INTO h FROM public.guests g WHERE id=p_guest_id AND archived_at IS NULL AND EXISTS(SELECT 1 FROM public.households WHERE id=g.household_id AND archived_at IS NULL);
 IF NOT FOUND THEN RAISE EXCEPTION 'Active guest not found';END IF;
 SELECT array_agg(id ORDER BY is_child,sort_order NULLS LAST,lower(first_name),lower(coalesce(last_name,'')),id) INTO ids FROM public.guests WHERE household_id=h AND archived_at IS NULL;
 IF p_expected_order IS NOT NULL THEN
  IF cardinality(p_expected_order)<>cardinality(ids) OR (SELECT count(DISTINCT id) FROM unnest(p_expected_order) id)<>cardinality(ids) OR EXISTS(SELECT 1 FROM unnest(p_expected_order) id WHERE id IS NULL OR NOT(id=ANY(ids))) THEN RAISE EXCEPTION 'Guest list changed; refresh and try again';END IF;
  -- Equal/null manual positions may use the client's locale-aware name tie-break.
  IF EXISTS(SELECT 1 FROM unnest(p_expected_order) WITH ORDINALITY e(id,pos)
    JOIN public.guests g ON g.id=e.id
    JOIN unnest(p_expected_order) WITH ORDINALITY e2(id,pos) ON e2.pos>e.pos
    JOIN public.guests g2 ON g2.id=e2.id
    WHERE g.is_child=g2.is_child AND g.sort_order IS NOT NULL AND g2.sort_order IS NOT NULL AND g.sort_order>g2.sort_order)
  THEN RAISE EXCEPTION 'Guest order changed; refresh and try again';END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_expected_order) WITH ORDINALITY e(id,pos) JOIN public.guests g ON g.id=e.id WHERE g.is_child AND EXISTS(SELECT 1 FROM unnest(p_expected_order) WITH ORDINALITY e2(id,pos) JOIN public.guests g2 ON g2.id=e2.id WHERE NOT g2.is_child AND e2.pos>e.pos)) THEN RAISE EXCEPTION 'Guest order changed; refresh and try again';END IF;
  ids:=p_expected_order;
 END IF;
 position:=array_position(ids,p_guest_id);target:=position+p_direction;
 IF target<1 OR target>cardinality(ids) THEN RETURN;END IF;
 IF (SELECT is_child FROM public.guests WHERE id=ids[position]) IS DISTINCT FROM (SELECT is_child FROM public.guests WHERE id=ids[target]) THEN RETURN;END IF;
 swap:=ids[position];ids[position]:=ids[target];ids[target]:=swap;
 UPDATE public.guests g SET sort_order=ordered.ordinality::integer,updated_at=now() FROM unnest(ids) WITH ORDINALITY ordered(id,ordinality) WHERE g.id=ordered.id;
END $$;
REVOKE ALL ON FUNCTION public.admin_order_guest(uuid,integer,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_order_guest(uuid,integer,uuid[]) TO authenticated;

-- Shared insert/status-change semantics for admin and invitation additions.
-- Explicit backup sort values are retained on insert; migration rewrites no rows.
CREATE FUNCTION app_private.append_guest_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.sort_order IS NULL) OR
    (TG_OP='UPDATE' AND (NEW.is_child IS DISTINCT FROM OLD.is_child OR NEW.household_id IS DISTINCT FROM OLD.household_id)) THEN
  PERFORM pg_advisory_xact_lock(19421,7744);
  -- Give existing unsorted people positions before appending the new member.
  WITH pending AS (
   SELECT g.id,row_number() OVER (ORDER BY lower(g.first_name),lower(coalesce(g.last_name,'')),g.id) AS n
   FROM public.guests g WHERE g.household_id=NEW.household_id AND g.id<>NEW.id AND g.archived_at IS NULL AND g.sort_order IS NULL
  ), base AS (
   SELECT coalesce(max(sort_order),0) AS n FROM public.guests WHERE household_id=NEW.household_id AND archived_at IS NULL
  )
  UPDATE public.guests g SET sort_order=(base.n+pending.n)::integer FROM pending,base WHERE g.id=pending.id;
  SELECT coalesce(max(g.sort_order),0)+1 INTO NEW.sort_order
  FROM public.guests g WHERE g.household_id=NEW.household_id AND g.id<>NEW.id AND g.archived_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.append_guest_order() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER append_guest_order BEFORE INSERT OR UPDATE OF is_child,household_id ON public.guests
FOR EACH ROW EXECUTE FUNCTION app_private.append_guest_order();
COMMIT;

-- Migration: 20261113094500_admin_food_group_wording.sql
-- Add organizer wording without changing guest wording, saved overrides or data.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || jsonb_build_object(
  'Selecting a group commits the household to one unit of every included item.',
  'interface.messages.admin_group_commitment');
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;
COMMIT;

-- Migration: 20261113100000_invitation_share_labels.sql
-- Share-sheet labels only; no new delivery channels or permission grants.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || $entries${"Share invitation": "interface.messages.share_invitation", "Choose the displayed recipient in your app. Sharing does not mark this invitation as sent. Return here to record it and note the app you used.": "interface.messages.share_invitation_help", "System sharing is unavailable here. Use Copy message or open a device app.": "interface.messages.share_unavailable"}$entries$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;
COMMIT;

-- Migration: 20261113110000_share_handoff_audit.sql
-- Share-sheet labels only; no new delivery channels or permission grants.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || $entries${"Share handoff completed": "interface.messages.share_handoff_completed", "Share handoff completed, but logging failed. Retry logging without sharing again. Sent still requires manual confirmation.": "interface.messages.share_logging_failed", "Retry logging": "interface.messages.retry_share_logging"}$entries$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;

-- Idempotent audit only. Never update queue status/revision or sent records.
CREATE UNIQUE INDEX invitation_share_handoff_id_idx ON public.invitation_delivery_audit(queue_id,(new_value->>'handoff_id')) WHERE action='share_handoff_completed';
CREATE FUNCTION public.admin_record_share_handoff(p_queue_id uuid,p_expected_revision integer,p_handoff_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE q public.invitation_send_queue;
BEGIN
 PERFORM app_private.require_permission('sendInvites');
 PERFORM pg_advisory_xact_lock(19421,7744);
 PERFORM public.admin_authorize_device_send(p_queue_id);
 IF p_handoff_id IS NULL THEN RAISE EXCEPTION 'Invalid share handoff';END IF;
 SELECT * INTO q FROM public.invitation_send_queue WHERE id=p_queue_id FOR UPDATE;
 IF p_expected_revision IS DISTINCT FROM q.revision THEN RAISE EXCEPTION 'Delivery changed; refresh and try again';END IF;
 INSERT INTO public.invitation_delivery_audit(queue_id,actor_user_id,action,previous_value,new_value)
 VALUES(q.id,auth.uid(),'share_handoff_completed',jsonb_build_object('status',q.status),jsonb_build_object('status',q.status,'handoff_id',p_handoff_id,'delivery_confirmed',false)) ON CONFLICT DO NOTHING;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_record_share_handoff(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_record_share_handoff(uuid,integer,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113133452_account_interface_wording.sql
-- Add account-preference wording; preserve existing keys, overrides and aliases.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || jsonb_build_object(
  'Personal preferences for your account, across devices.', 'interface.messages.personal_account_preferences',
  'Your preference could not be saved. Please try again.', 'interface.messages.personal_preference_failed');
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;
COMMIT;

-- Migration: 20261113161134_settings_publication_heading.sql
-- Add the approved settings-card heading without removing saved wording or aliases.
BEGIN;
DO $registry$
DECLARE catalog jsonb := app_private.translation_keys();
BEGIN
 catalog := catalog || jsonb_build_object('Publication','interface.messages.publication');
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L',
  'SELECT ' || quote_literal(catalog::text) || '::jsonb');
END $registry$;
COMMIT;

-- 20261113180203_guest_rsvp_comments_and_food_hierarchy.sql
-- Optional immutable RSVP comment and nested food categories; no existing values are rewritten.
BEGIN;
ALTER TABLE public.rsvp_submissions ADD COLUMN comment text CHECK(comment IS NULL OR length(comment)<=2000);
ALTER TABLE public.food_categories ADD COLUMN parent_id uuid REFERENCES public.food_categories(id) ON DELETE RESTRICT;
ALTER TABLE public.food_categories ADD CONSTRAINT food_category_no_self_parent CHECK(parent_id IS DISTINCT FROM id);
CREATE INDEX food_categories_parent_order_idx ON public.food_categories(parent_id,sort_order,id);

-- Used for live hierarchy writes and backup/template validation.
CREATE FUNCTION app_private.validate_food_category_tree(p_categories jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE invalid boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.food_categories,p_categories) c GROUP BY id HAVING id IS NULL OR count(*)>1) THEN RAISE EXCEPTION 'Food category hierarchy contains duplicate or missing IDs';END IF;
 WITH RECURSIVE categories AS (SELECT id,parent_id FROM jsonb_populate_recordset(NULL::public.food_categories,p_categories)),
 reachable(id,depth) AS (SELECT id,1 FROM categories WHERE parent_id IS NULL UNION ALL SELECT c.id,p.depth+1 FROM categories c JOIN reachable p ON c.parent_id=p.id WHERE p.depth<9)
 SELECT (SELECT count(*) FROM categories)<>(SELECT count(DISTINCT id) FROM reachable) OR EXISTS(SELECT 1 FROM reachable WHERE depth>8) OR (SELECT count(*) FROM categories)<>(SELECT count(DISTINCT id) FROM categories) INTO invalid;
 IF invalid THEN RAISE EXCEPTION 'Food category hierarchy must have valid parents, no cycles and at most 8 levels';END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.validate_food_category_tree(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.lock_food_category_tree() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN PERFORM pg_advisory_xact_lock(19421,7745);RETURN NEW;END $$;
CREATE FUNCTION app_private.guard_food_category_tree() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM app_private.validate_food_category_tree(coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM public.food_categories c),'[]'));RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app_private.lock_food_category_tree(),app_private.guard_food_category_tree() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lock_food_category_tree BEFORE INSERT OR UPDATE OF parent_id ON public.food_categories FOR EACH ROW EXECUTE FUNCTION app_private.lock_food_category_tree();
CREATE TRIGGER guard_food_category_tree AFTER INSERT OR UPDATE OF parent_id ON public.food_categories FOR EACH ROW EXECUTE FUNCTION app_private.guard_food_category_tree();

-- Existing three-argument callers still resolve through the optional fourth argument.
DROP FUNCTION public.submit_household_rsvp(text,uuid,jsonb);
CREATE OR REPLACE FUNCTION public.submit_household_rsvp(p_code text, p_request_id uuid, p_responses jsonb, p_comment text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE h public.households%ROWTYPE;d public.event_settings%ROWTYPE;v_expected integer;v_actual integer;v_id uuid;v_number integer;v_snapshot jsonb;v_comment text:=nullif(btrim(p_comment),'');v_prior public.rsvp_submissions%ROWTYPE;
BEGIN IF NOT EXISTS(SELECT 1 FROM public.event_settings WHERE id=1 AND is_published=true) THEN RAISE EXCEPTION 'Event is not published' USING ERRCODE='42501'; END IF;
IF p_comment IS NOT NULL AND length(p_comment)>2000 THEN RAISE EXCEPTION 'RSVP comment must be at most 2000 characters';END IF;
IF p_code IS NULL OR p_code !~ '^[A-HJ-NP-Z2-9]{8}$' OR p_request_id IS NULL OR jsonb_typeof(p_responses) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid submission'; END IF;
SELECT * INTO h FROM public.households WHERE invite_code=p_code FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
SELECT * INTO v_prior FROM public.rsvp_submissions WHERE household_id=h.id AND request_id=p_request_id;
IF FOUND THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id',(x->>'guest_id')::uuid,'session_id',(x->>'session_id')::uuid,'status',x->>'status') ORDER BY x->>'guest_id',x->>'session_id'),'[]'::jsonb) INTO v_snapshot FROM jsonb_array_elements(p_responses) x;
 IF v_prior.comment IS DISTINCT FROM v_comment OR v_prior.submission_snapshot IS DISTINCT FROM v_snapshot THEN RAISE EXCEPTION 'Submission already processed with different answers';END IF;
 RETURN jsonb_build_object('submission_id',v_prior.id,'already_processed',true);
END IF;
IF h.rsvp_state<>'open' THEN RAISE EXCEPTION 'RSVP is locked'; END IF;
SELECT * INTO d FROM public.event_settings WHERE id=1;
IF NOT FOUND THEN RAISE EXCEPTION 'Event not configured'; END IF;
IF d.rsvp_deadline IS NOT NULL AND clock_timestamp()>d.rsvp_deadline AND (h.late_submission_until IS NULL OR clock_timestamp()>h.late_submission_until) THEN RAISE EXCEPTION 'RSVP deadline passed'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_responses) x WHERE jsonb_typeof(x)<>'object' OR (x->>'guest_id') IS NULL OR (x->>'session_id') IS NULL OR (x->>'status') IS NULL OR x->>'status' NOT IN ('attending','declined')) THEN RAISE EXCEPTION 'Invalid response entry'; END IF;
IF EXISTS(SELECT 1 FROM (SELECT (x->>'guest_id')::uuid guest_id,(x->>'session_id')::uuid session_id,count(*) n FROM jsonb_array_elements(p_responses) x GROUP BY 1,2 HAVING count(*)<>1) z) THEN RAISE EXCEPTION 'Duplicate response'; END IF;
SELECT count(*) INTO v_expected FROM public.effective_session_invitations v WHERE v.household_id=h.id AND v.requires_rsvp;
SELECT count(*) INTO v_actual FROM jsonb_array_elements(p_responses) x JOIN public.effective_session_invitations v ON v.guest_id=(x->>'guest_id')::uuid AND v.session_id=(x->>'session_id')::uuid WHERE v.household_id=h.id AND v.requires_rsvp;
IF v_expected<>v_actual OR jsonb_array_length(p_responses)<>v_expected THEN RAISE EXCEPTION 'Incomplete or unauthorized responses'; END IF;
SELECT coalesce(max(submission_number),0)+1 INTO v_number FROM public.rsvp_submissions WHERE household_id=h.id;
SELECT coalesce(jsonb_agg(jsonb_build_object('guest_id',(x->>'guest_id')::uuid,'session_id',(x->>'session_id')::uuid,'status',x->>'status') ORDER BY x->>'guest_id',x->>'session_id'),'[]'::jsonb) INTO v_snapshot FROM jsonb_array_elements(p_responses) x;
INSERT INTO public.rsvp_submissions(household_id,submission_number,request_id,submission_snapshot,comment) VALUES(h.id,v_number,p_request_id,v_snapshot,v_comment) RETURNING id INTO v_id;
DELETE FROM public.guest_session_responses r USING public.guests g WHERE r.guest_id=g.id AND g.household_id=h.id;
INSERT INTO public.guest_session_responses(guest_id,session_id,rsvp_status,last_submission_id) SELECT (x->>'guest_id')::uuid,(x->>'session_id')::uuid,x->>'status',v_id FROM jsonb_array_elements(p_responses) x;
INSERT INTO public.rsvp_response_audit(household_id,guest_id,session_id,action,new_status) SELECT h.id,(x->>'guest_id')::uuid,(x->>'session_id')::uuid,'submission',x->>'status' FROM jsonb_array_elements(p_responses) x;
UPDATE public.households SET rsvp_state='locked',rsvp_submitted_at=now(),latest_rsvp_submission_id=v_id,late_submission_until=NULL WHERE id=h.id;
INSERT INTO public.rsvp_household_audit(household_id,action,submission_id) VALUES(h.id,'submitted',v_id);
RETURN jsonb_build_object('submission_id',v_id,'submission_number',v_number,'already_processed',false);
END $function$;

REVOKE ALL ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_household_rsvp(text,uuid,jsonb,text) TO service_role;

CREATE FUNCTION public.admin_save_food_category(p_category_id uuid,p_name text,p_parent_id uuid,p_expected_name text DEFAULT NULL,p_expected_parent uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current public.food_categories;v_name text:=btrim(coalesce(p_name,''));v_id uuid;v_order integer;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7745);
 IF length(v_name)=0 OR length(v_name)>120 THEN RAISE EXCEPTION 'Enter a valid category name';END IF;
 IF p_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.food_categories WHERE id=p_parent_id) THEN RAISE EXCEPTION 'Parent category not found';END IF;
 SELECT coalesce(max(sort_order),0)+1 INTO v_order FROM public.food_categories WHERE parent_id IS NOT DISTINCT FROM p_parent_id;
 IF p_category_id IS NULL THEN INSERT INTO public.food_categories(name,parent_id,sort_order) VALUES(v_name,p_parent_id,v_order) RETURNING id INTO v_id;RETURN v_id;END IF;
 SELECT * INTO current FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category not found';END IF;
 IF current.name IS DISTINCT FROM p_expected_name OR current.parent_id IS DISTINCT FROM p_expected_parent THEN RAISE EXCEPTION 'Category changed; reload before saving';END IF;
 PERFORM public.admin_rename_food_category(p_category_id,v_name);
 UPDATE public.food_categories SET parent_id=p_parent_id,sort_order=CASE WHEN current.parent_id IS DISTINCT FROM p_parent_id THEN v_order ELSE sort_order END WHERE id=p_category_id;
 RETURN p_category_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_food_category(uuid,text,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_food_category(uuid,text,uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_move_food_category(p_category_id uuid,p_direction integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent uuid;ids uuid[];position integer;target integer;swap uuid;
BEGIN
 PERFORM app_private.require_permission('food','edit');PERFORM pg_advisory_xact_lock(19421,7745);
 IF p_direction IS NULL OR p_direction NOT IN(-1,1) THEN RAISE EXCEPTION 'Direction must be -1 or 1';END IF;
 SELECT parent_id INTO parent FROM public.food_categories WHERE id=p_category_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category not found';END IF;
 SELECT array_agg(id ORDER BY sort_order,lower(name),id) INTO ids FROM public.food_categories WHERE parent_id IS NOT DISTINCT FROM parent;
 position:=array_position(ids,p_category_id);target:=position+p_direction;
 IF target<1 OR target>cardinality(ids) THEN RETURN;END IF;
 swap:=ids[position];ids[position]:=ids[target];ids[target]:=swap;
 UPDATE public.food_categories c SET sort_order=ordered.ordinality::integer FROM unnest(ids) WITH ORDINALITY ordered(id,ordinality) WHERE c.id=ordered.id;
END $$;
REVOKE ALL ON FUNCTION public.admin_move_food_category(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_move_food_category(uuid,integer) TO authenticated;

-- Patch the existing scoped payloads without replacing their preview/access/order behavior.
DO $payloads$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.guest_invitation(public.households)'::regprocedure);
 IF strpos(d,'''food_confirmed'',h.food_confirmed')=0 THEN RAISE EXCEPTION 'Unexpected guest invitation definition';END IF;
 EXECUTE replace(d,'''food_confirmed'',h.food_confirmed','''rsvp_comment'',(SELECT comment FROM public.rsvp_submissions WHERE id=h.latest_rsvp_submission_id AND household_id=h.id),''food_confirmed'',h.food_confirmed');
 d:=pg_get_functiondef('app_private.guest_food(uuid,boolean)'::regprocedure);
 IF strpos(d,'RETURN result;')=0 THEN RAISE EXCEPTION 'Unexpected guest food definition';END IF;
 EXECUTE replace(d,'RETURN result;', 'result:=jsonb_set(result,''{categories}'',coalesce((SELECT jsonb_agg(j.value||jsonb_build_object(''parent_id'',c.parent_id,''sort_order'',c.sort_order) ORDER BY j.ordinality) FROM jsonb_array_elements(coalesce(result->''categories'',''[]'')) WITH ORDINALITY j(value,ordinality) JOIN public.food_categories c ON c.id=(j.value->>''id'')::uuid),''[]'')); RETURN result;');
 d:=pg_get_functiondef('public.admin_delete_food_category(uuid,text)'::regprocedure);
 IF strpos(d,'DELETE FROM public.food_categories')=0 THEN RAISE EXCEPTION 'Unexpected category deletion definition';END IF;
 EXECUTE replace(d,'DELETE FROM public.food_categories', 'IF EXISTS(SELECT 1 FROM public.food_categories WHERE parent_id=p_category_id) THEN RAISE EXCEPTION ''Move sub-categories before deleting this category.'';END IF; DELETE FROM public.food_categories');
 -- A changed column manifest requires a fresh current-version backup; no legacy adapter.
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'''20261112163128''')=0 THEN RAISE EXCEPTION 'Unexpected backup contract';END IF;
 EXECUTE replace(d,'''20261112163128''','''20261113180203''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'''20261112163128''')=0 OR strpos(d,'RETURN jsonb_build_object(''rows'',n')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;
 d:=replace(d,'''20261112163128''','''20261113180203''');
 EXECUTE replace(d,'RETURN jsonb_build_object(''rows'',n','PERFORM app_private.validate_food_category_tree(payload->''tables''->''public.food_categories''); RETURN jsonb_build_object(''rows'',n');
END $payloads$;

DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"RSVP comment (optional)":"interface.messages.rsvp_comment_label","Dietary requirements or anything else we should know.":"interface.messages.rsvp_comment_help","Needed: {needed} · Still available: {available} · {unit}":"interface.messages.food_availability","Select between 1 and {max}.":"interface.messages.food_quantity_range","Parent category":"interface.messages.food_parent_category","Add sub-category":"interface.messages.food_add_subcategory","Move sub-categories before deleting this category.":"interface.messages.food_move_subcategories","RSVP comment must be at most 2000 characters":"interface.messages.rsvp_comment_limit","Food category hierarchy must have valid parents, no cycles and at most 8 levels":"interface.messages.food_category_tree_invalid","Category changed; reload before saving":"interface.messages.food_category_changed"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- 20261113185947_status_message_timestamps.sql
BEGIN;
-- Optional independent timestamp flags. Missing Admin values stay on; Guest stays off.
-- Existing JSON, event settings and backup contract are not rewritten.
CREATE OR REPLACE FUNCTION app_private.valid_notification_preferences(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE scope text;policy jsonb;
BEGIN
 IF p IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR NOT(p?'admin' AND p?'guest') THEN RETURN false;END IF;
 FOREACH scope IN ARRAY ARRAY['admin','guest'] LOOP
  policy:=p->scope;
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(policy))<>(2 + CASE WHEN policy?'autoDismiss' THEN 1 ELSE 0 END + CASE WHEN policy?'showTimestamp' THEN 1 ELSE 0 END) OR jsonb_typeof(policy->'preset') IS DISTINCT FROM 'string' OR policy->>'preset' NOT IN ('all','errors','custom') OR jsonb_typeof(policy->'types') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF policy?'autoDismiss' AND jsonb_typeof(policy->'autoDismiss') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF policy?'showTimestamp' AND jsonb_typeof(policy->'showTimestamp') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'types') t WHERE jsonb_typeof(t) IS DISTINCT FROM 'string' OR t#>>'{}' NOT IN ('info','success','warning','error')) OR (SELECT count(*) FROM jsonb_array_elements(policy->'types'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(policy->'types')) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog||jsonb_build_object('Show timestamps','interface.messages.status_messages_show_timestamp');
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113193108_selected_backups_and_optional_logs.sql
BEGIN;
-- Alpha contract: current exports only; no legacy format adapter or data rewrite.
CREATE FUNCTION app_private.backup_selection(mode text, sections text[], include_logs boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE canonical text[];
BEGIN
 IF mode IS NULL OR mode NOT IN ('backup','template') OR sections IS NULL OR include_logs IS NULL
 OR EXISTS(SELECT 1 FROM unnest(sections) s WHERE s IS NULL OR s NOT IN ('venues','households','food','other','wording'))
 THEN RAISE EXCEPTION 'Choose valid backup mode, sections and activity log options.';END IF;
 -- Household replies and food commitments are one connected set of business records.
 IF mode='backup' AND sections && ARRAY['households','food'] THEN
  sections:=sections||ARRAY['venues','households','food'];
 END IF;
 SELECT coalesce(array_agg(s ORDER BY ord),'{}') INTO canonical
 FROM unnest(ARRAY['venues','households','food','other','wording']) WITH ORDINALITY x(s,ord) WHERE s=ANY(sections);
 RETURN jsonb_build_object('mode',mode,'sections',canonical,'include_logs',mode='backup' AND include_logs);
END $$;

CREATE FUNCTION app_private.backup_selected_tables(selection jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE sections text[]:=ARRAY(SELECT jsonb_array_elements_text(selection->'sections'));
 selected text[]:=ARRAY['public.event_languages','public.event_settings'];
 live boolean:=selection->>'mode'='backup';
BEGIN
 IF 'venues'=ANY(sections) THEN selected:=selected||ARRAY['public.event_locations','public.event_sessions','public.venue_translations','public.session_translations'];END IF;
 IF 'households'=ANY(sections) THEN
  selected:=selected||ARRAY['public.relation_groups','public.households','public.guests','public.household_contacts'];
  IF live THEN selected:=selected||ARRAY['public.rsvp_submissions','public.guest_session_responses','public.invitation_send_queue','public.invitation_deliveries','app_private.invitation_code_registry'];END IF;
 END IF;
 IF ARRAY['venues','households'] <@ sections THEN selected:=selected||ARRAY['public.household_session_defaults','public.guest_session_overrides'];END IF;
 IF 'food'=ANY(sections) THEN
  selected:=selected||ARRAY['public.food_categories','public.food_item_types','public.food_groups','public.food_items','public.food_item_translations','public.food_category_translations','public.food_type_translations'];
  IF live THEN selected:=selected||ARRAY['public.food_claims'];END IF;
 END IF;
 IF 'other'=ANY(sections) THEN selected:=selected||ARRAY['public.other_categories','public.other_items'];END IF;
 IF 'wording'=ANY(sections) THEN selected:=selected||ARRAY['public.event_translations','public.translation_overrides','public.message_templates'];END IF;
 IF (selection->>'include_logs')::boolean THEN
  selected:=selected||ARRAY['public.management_audit','public.event_configuration_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit'];
  IF 'households'=ANY(sections) THEN selected:=selected||ARRAY['public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_access_audit','public.invitation_delivery_audit'];END IF;
 END IF;
 RETURN selected;
END $$;

CREATE FUNCTION app_private.seal_backup(payload jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('format','rsvp-application-backup','version',2,'payload',payload,'checksum',encode(sha256(convert_to(payload::text,'UTF8')),'hex'))
$$;

DO $contract$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'''20261113180203''')=0 THEN RAISE EXCEPTION 'Unexpected backup schema';END IF;
 d:=replace(d,'''20261113180203''','''20261113193108''');
 EXECUTE replace(d,'''schema_version'',''20261113193108''','''selection'',app_private.backup_selection(''backup'',ARRAY[''venues'',''households'',''food'',''other'',''wording''],true),''schema_version'',''20261113193108''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'''20261113180203''')=0 OR strpos(d,'RETURN jsonb_build_object(''rows'',n')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;
 d:=replace(replace(d,'''20261113180203''','''20261113193108'''),'''version'' IS DISTINCT FROM ''1''','''version'' IS DISTINCT FROM ''2''');
 d:=replace(d,'RETURN jsonb_build_object(''rows'',n','PERFORM app_private.validate_backup_selection(payload); RETURN jsonb_build_object(''selection'',payload->''selection'',''rows'',n');
 EXECUTE d;
END $contract$;

CREATE FUNCTION app_private.validate_backup_selection(payload jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE selection jsonb:=payload->'selection'; canonical jsonb;t text;
BEGIN
 IF jsonb_typeof(selection) IS DISTINCT FROM 'object' OR jsonb_typeof(selection->'sections') IS DISTINCT FROM 'array'
 OR jsonb_typeof(selection->'include_logs') IS DISTINCT FROM 'boolean' OR (SELECT count(*) FROM jsonb_object_keys(selection))<>3
 THEN RAISE EXCEPTION 'Invalid backup selection manifest';END IF;
 canonical:=app_private.backup_selection(selection->>'mode',ARRAY(SELECT jsonb_array_elements_text(selection->'sections')),(selection->>'include_logs')::boolean);
 IF selection IS DISTINCT FROM canonical THEN RAISE EXCEPTION 'Invalid backup selection dependencies';END IF;
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF NOT t=ANY(app_private.backup_selected_tables(selection)) AND jsonb_array_length(payload->'tables'->t)<>0
  THEN RAISE EXCEPTION 'Backup contains an excluded section or activity log: %',t;END IF;
 END LOOP;
 IF NOT (selection->>'include_logs')::boolean AND
 (coalesce(payload->'sign_in_log_reference','[]')<>'[]'::jsonb OR coalesce(payload->'administrator_reference','[]')<>'[]'::jsonb)
 THEN RAISE EXCEPTION 'Backup contains excluded administrator history';END IF;
END $$;

CREATE FUNCTION app_private.project_backup(b jsonb, mode text DEFAULT NULL, sections text[] DEFAULT NULL, include_logs boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE payload jsonb:=b->'payload';available jsonb:=payload->'selection';selection jsonb;
 tables jsonb;counts jsonb:='{}';t text;fk record;actor_ids text[]:='{}';one jsonb;
BEGIN
 mode:=coalesce(mode,available->>'mode');
 sections:=coalesce(sections,ARRAY(SELECT jsonb_array_elements_text(available->'sections')));
 selection:=app_private.backup_selection(mode,sections,coalesce(include_logs,(available->>'include_logs')::boolean));
 IF available->>'mode'='template' AND mode='backup' THEN RAISE EXCEPTION 'A planning template cannot restore cleared replies or commitments.';END IF;
 IF NOT (selection->'sections') <@ (available->'sections') THEN RAISE EXCEPTION 'Selected sections are not available in this file.';END IF;
 IF (selection->>'include_logs')::boolean AND NOT (available->>'include_logs')::boolean THEN RAISE EXCEPTION 'Activity logs are not available in this file.';END IF;
 IF mode='template' THEN payload:=app_private.backup_as_template(b,sections)->'payload';END IF;
 tables:=payload->'tables';
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF NOT t=ANY(app_private.backup_selected_tables(selection)) THEN tables:=jsonb_set(tables,ARRAY[t],'[]');END IF;
  counts:=counts||jsonb_build_object(t,jsonb_array_length(tables->t));
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR one IN SELECT value FROM jsonb_array_elements(tables->t) LOOP
    IF one->>fk.attname IS NOT NULL THEN actor_ids:=array_append(actor_ids,one->>fk.attname);END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF NOT (selection->>'include_logs')::boolean THEN
  payload:=payload||'{"sign_in_log_reference":[],"administrator_reference":[]}'::jsonb;
 ELSE
  FOR one IN SELECT value FROM jsonb_array_elements(coalesce(payload->'administrator_reference','[]')) LOOP actor_ids:=array_append(actor_ids,one->>'user_id');END LOOP;
 END IF;
 payload:=payload||jsonb_build_object('selection',selection,'tables',tables,'counts',counts,'identities',
  coalesce((SELECT jsonb_agg(u) FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=ANY(actor_ids)),'[]'));
 RETURN app_private.seal_backup(payload);
END $$;

-- Validate uploaded files before projection; internally generated exports are validated
-- after pruning, so an omitted large section cannot block a small selected backup.
CREATE FUNCTION app_private.select_backup(b jsonb, mode text DEFAULT NULL, sections text[] DEFAULT NULL, include_logs boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 PERFORM app_private.validate_backup(b);
 RETURN app_private.project_backup(b,mode,sections,include_logs);
END $$;
DO $template$
DECLARE d text:=pg_get_functiondef('app_private.backup_as_template(jsonb,text[])'::regprocedure);
BEGIN
 IF strpos(d,'PERFORM app_private.validate_backup(b);')=0 THEN RAISE EXCEPTION 'Unexpected planning template builder';END IF;
 EXECUTE replace(d,'PERFORM app_private.validate_backup(b);','-- Input is checked by select_backup; trusted exports are checked after projection.');
END $template$;

-- One current API for both export modes and both restore modes; retire template-only RPCs.
DROP FUNCTION public.admin_preview_backup_template(jsonb,text[]);
DROP FUNCTION public.admin_restore_backup_template(jsonb,text[],text);
DROP FUNCTION public.admin_export_backup();
DROP FUNCTION public.admin_preview_backup(jsonb);
DROP FUNCTION public.admin_restore_backup(jsonb,text);
CREATE FUNCTION public.admin_export_backup(p_mode text DEFAULT 'backup',p_sections text[] DEFAULT ARRAY['venues','households','food','other','wording'],p_include_logs boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.require_admin_operation('admin_export_backup');
 result:=app_private.project_backup(app_private.seal_backup(app_private.backup_payload()),p_mode,p_sections,p_include_logs);
 PERFORM app_private.validate_backup(result);
 RETURN result;
END $$;
CREATE FUNCTION public.admin_preview_backup(p_backup jsonb,p_mode text DEFAULT NULL,p_sections text[] DEFAULT NULL,p_include_logs boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate jsonb;report jsonb;result jsonb;
BEGIN
 PERFORM app_private.require_admin_operation('admin_preview_backup');
 candidate:=app_private.select_backup(p_backup,p_mode,p_sections,p_include_logs);
 report:=app_private.validate_backup(candidate);
 BEGIN
  result:=app_private.restore_backup(candidate);
  RAISE EXCEPTION USING ERRCODE='P0199',MESSAGE='restore_preview_rollback';
 EXCEPTION WHEN SQLSTATE 'P0199' THEN RETURN report||jsonb_build_object('can_restore',true);
 WHEN OTHERS THEN RETURN report||jsonb_build_object('can_restore',false,'reason',SQLERRM);
 END;
END $$;
CREATE FUNCTION public.admin_restore_backup(p_backup jsonb,p_confirmation text,p_mode text DEFAULT NULL,p_sections text[] DEFAULT NULL,p_include_logs boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_admin_operation('admin_restore_backup');
 IF p_confirmation IS DISTINCT FROM 'RESTORE '||coalesce(p_backup->'payload'->'tables'->'public.event_settings'->0->>'event_name','') THEN RAISE EXCEPTION 'Type RESTORE followed by the source event name';END IF;
 RETURN app_private.restore_backup(app_private.select_backup(p_backup,p_mode,p_sections,p_include_logs));
END $$;
REVOKE ALL ON FUNCTION app_private.backup_selection(text,text[],boolean),app_private.backup_selected_tables(jsonb),app_private.seal_backup(jsonb),app_private.project_backup(jsonb,text,text[],boolean),app_private.validate_backup_selection(jsonb),app_private.select_backup(jsonb,text,text[],boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_export_backup(text,text[],boolean),public.admin_preview_backup(jsonb,text,text[],boolean),public.admin_restore_backup(jsonb,text,text,text[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_export_backup(text,text[],boolean),public.admin_preview_backup(jsonb,text,text[],boolean),public.admin_restore_backup(jsonb,text,text,text[],boolean) TO authenticated;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Export mode": "interface.messages.backup_export_mode", "Backup": "interface.messages.backup_preserve_mode", "Include sections": "interface.messages.backup_include_sections", "Include activity logs": "interface.messages.backup_include_logs", "Event settings and languages are always included. In Backup mode, households and food include each other and venues to preserve replies and commitments.": "interface.messages.backup_sections_help", "Activity logs can contain personal details. Replies, food commitments and Sent records are kept in Backup mode even when logs are excluded. Planning templates omit logs and reset invitation codes, replies and commitments.": "interface.messages.backup_logs_help", "Choose valid backup mode, sections and activity log options.": "interface.messages.backup_invalid_options", "Invalid backup selection manifest": "interface.messages.backup_invalid_manifest", "Invalid backup selection dependencies": "interface.messages.backup_invalid_dependencies", "A planning template cannot restore cleared replies or commitments.": "interface.messages.backup_template_no_replies", "Selected sections are not available in this file.": "interface.messages.backup_sections_unavailable", "Activity logs are not available in this file.": "interface.messages.backup_logs_unavailable", "Backup contains excluded administrator history": "interface.messages.backup_excluded_admin_history"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113200440_food_category_and_backup_mode_wording.sql
BEGIN;
-- Additive wording only; application data and backup v2 contract are unchanged.
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"{count} sub-category": "interface.messages.food_count_subcategory", "{count} sub-categories": "interface.messages.food_count_subcategories", "Add item or sub-category": "interface.messages.food_add_choices", "Planned backup": "interface.messages.backup_planned_export", "Full restore": "interface.messages.backup_full_restore", "Planned restore": "interface.messages.backup_planned_restore"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113203714_backup_checkmarks_and_partial_logs.sql
BEGIN;
-- Historical snapshots have no links to live guests, submissions, deliveries or Auth.
-- Partial restore can retain history without recreating the records it resets.
CREATE TABLE app_private.restored_activity_logs (
 id uuid PRIMARY KEY,
 source_table text NOT NULL,
 source_id text NOT NULL,
 occurred_at timestamptz NOT NULL,
 category text NOT NULL CHECK(category IN ('households','guests','contacts','rsvp','invitations','login','venues','sessions','food','administrators')),
 action text NOT NULL,
 subject text NOT NULL,
 actor_name text NOT NULL,
 household_name text,
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object')
);
CREATE INDEX restored_activity_logs_time ON app_private.restored_activity_logs(occurred_at DESC,id DESC);
ALTER TABLE app_private.restored_activity_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.restored_activity_logs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_restored_activity_logs BEFORE UPDATE OR DELETE ON app_private.restored_activity_logs
 FOR EACH ROW EXECUTE FUNCTION public.prevent_history_mutation();

CREATE FUNCTION app_private.backup_log_tables() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_delivery_audit',
 'public.management_audit','public.event_configuration_audit','public.invitation_access_audit',
 'public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit']::text[]
$$;

CREATE FUNCTION app_private.backup_log_snapshots(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE tables jsonb:=payload->'tables'; result jsonb:=coalesce(tables->'app_private.restored_activity_logs','[]');
 t text;row jsonb;actor_id text;household_id text;household_name text;actor_name text;
 category text;action text;subject text;guest jsonb;queue jsonb;source_id text;at text;id uuid;
BEGIN
 FOREACH t IN ARRAY app_private.backup_log_tables()||ARRAY['sign_in_log_reference'] LOOP
  FOR row IN SELECT value FROM jsonb_array_elements(CASE WHEN t='sign_in_log_reference' THEN coalesce(payload->t,'[]') ELSE coalesce(tables->t,'[]') END) LOOP
   queue:=NULL;guest:=NULL;
   IF t='public.invitation_delivery_audit' THEN
    SELECT q INTO queue FROM jsonb_array_elements(tables->'public.invitation_send_queue') q WHERE q->>'id'=row->>'queue_id';
   END IF;
   household_id:=coalesce(row->>'household_id',queue->>'household_id');
   SELECT h->>'household_name' INTO household_name FROM jsonb_array_elements(tables->'public.households') h WHERE h->>'id'=household_id;
   SELECT g INTO guest FROM jsonb_array_elements(tables->'public.guests') g WHERE g->>'id'=row->>'guest_id';
   actor_id:=coalesce(row->>'actor_user_id',row->>'actor_id',row->>'invited_by');
   SELECT a->>'name' INTO actor_name FROM jsonb_array_elements(coalesce(payload->'administrator_reference','[]')) a WHERE a->>'user_id'=actor_id;
   actor_name:=coalesce(nullif(actor_name,''),(SELECT u->>'email' FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=actor_id),'Guest / system');
   category:=CASE t
    WHEN 'public.management_audit' THEN CASE row->>'entity_type' WHEN 'guests' THEN 'guests' WHEN 'household_contacts' THEN 'contacts' WHEN 'food_access' THEN 'food' WHEN 'session_invitations' THEN 'rsvp' ELSE 'households' END
    WHEN 'public.rsvp_household_audit' THEN 'rsvp' WHEN 'public.rsvp_response_audit' THEN 'rsvp'
    WHEN 'public.invitation_delivery_audit' THEN 'invitations' WHEN 'public.invitation_access_audit' THEN 'invitations'
    WHEN 'public.event_configuration_audit' THEN CASE row->>'entity_type' WHEN 'event_locations' THEN 'venues' ELSE 'sessions' END
    WHEN 'sign_in_log_reference' THEN 'login' ELSE 'administrators' END;
   action:=CASE
    WHEN t='public.invitation_access_audit' THEN 'opened'
    WHEN t='public.backup_restore_audit' THEN 'restored'
    WHEN t='public.admin_invitations' THEN 'invitation_reference'
    WHEN t='public.rsvp_response_audit' THEN CASE row->>'action' WHEN 'submission' THEN 'response_submitted' ELSE 'response_corrected' END
    WHEN t='public.invitation_delivery_audit' AND row->>'action'='confirmed_sent' THEN 'sent'
    ELSE coalesce(row->>'action','update') END;
   subject:=coalesce(nullif(concat_ws(' ',guest->>'first_name',guest->>'last_name'),''),nullif(household_name,''),row->>'email',row->'after_value'->>'name',row->>'entity_type',CASE WHEN t='sign_in_log_reference' THEN 'Administrator session' ELSE 'Restored activity' END);
   source_id:=row->>'id';at:=coalesce(row->>'created_at',row->>'restored_at',row->>'confirmed_at',payload->>'created_at');
   id:=md5(t||':'||source_id||':'||row::text)::uuid;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) x WHERE x->>'id'=id::text) THEN
    result:=result||jsonb_build_array(jsonb_build_object('id',id,'source_table',t,'source_id',source_id,'occurred_at',at,'category',category,'action',action,'subject',subject,'actor_name',actor_name,'household_name',household_name,'details',jsonb_build_object('record',row,'historical',true)));
   END IF;
  END LOOP;
 END LOOP;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION app_private.backup_selected_tables(selection jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE sections text[]:=ARRAY(SELECT jsonb_array_elements_text(selection->'sections'));
 selected text[]:=ARRAY['public.event_languages','public.event_settings'];
 live boolean:=selection->>'mode'='backup';
 complete boolean:=ARRAY['venues','households','food','other','wording'] <@ sections;
BEGIN
 IF 'venues'=ANY(sections) THEN selected:=selected||ARRAY['public.event_locations','public.event_sessions','public.venue_translations','public.session_translations'];END IF;
 IF 'households'=ANY(sections) THEN
  selected:=selected||ARRAY['public.relation_groups','public.households','public.guests','public.household_contacts'];
  IF live THEN selected:=selected||ARRAY['public.rsvp_submissions','public.guest_session_responses','public.invitation_send_queue','public.invitation_deliveries','app_private.invitation_code_registry'];END IF;
 END IF;
 IF ARRAY['venues','households'] <@ sections THEN selected:=selected||ARRAY['public.household_session_defaults','public.guest_session_overrides'];END IF;
 IF 'food'=ANY(sections) THEN
  selected:=selected||ARRAY['public.food_categories','public.food_item_types','public.food_groups','public.food_items','public.food_item_translations','public.food_category_translations','public.food_type_translations'];
  IF live THEN selected:=selected||ARRAY['public.food_claims'];END IF;
 END IF;
 IF 'other'=ANY(sections) THEN selected:=selected||ARRAY['public.other_categories','public.other_items'];END IF;
 IF 'wording'=ANY(sections) THEN selected:=selected||ARRAY['public.event_translations','public.translation_overrides','public.message_templates'];END IF;
 IF (selection->>'include_logs')::boolean THEN
  selected:=selected||ARRAY['app_private.restored_activity_logs'];
  IF live AND complete THEN selected:=selected||app_private.backup_log_tables();END IF;
 END IF;
 RETURN selected;
END $$;

DO $functions$
DECLARE d text;view_sql text;
BEGIN
 d:=pg_get_functiondef('app_private.backup_tables()'::regprocedure);
 IF strpos(d,'''app_private.invitation_code_registry''')=0 THEN RAISE EXCEPTION 'Unexpected backup table list';END IF;
 EXECUTE replace(d,'''app_private.invitation_code_registry''','''app_private.invitation_code_registry'',''app_private.restored_activity_logs''');
 d:=pg_get_functiondef('app_private.backup_selection(text,text[],boolean)'::regprocedure);
 IF strpos(d,'''include_logs'',mode=''backup'' AND include_logs')=0 THEN RAISE EXCEPTION 'Unexpected log selection definition';END IF;
 EXECUTE replace(d,'''include_logs'',mode=''backup'' AND include_logs','''include_logs'',include_logs');
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'''20261113193108''')=0 THEN RAISE EXCEPTION 'Unexpected backup schema';END IF;
 EXECUTE replace(d,'''20261113193108''','''20261113203714''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'''20261113193108''')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;
 EXECUTE replace(d,'''20261113193108''','''20261113203714''');
 d:=pg_get_functiondef('app_private.project_backup(jsonb,text,text[],boolean)'::regprocedure);
 IF strpos(d,'IF mode=''template'' THEN payload:=')=0 OR strpos(d,'tables:=payload->''tables'';')=0 THEN RAISE EXCEPTION 'Unexpected backup projection';END IF;
 d:=replace(d,'tables:=payload->''tables'';',
 'tables:=payload->''tables'';
 IF (selection->>''include_logs'')::boolean AND (mode=''template'' OR NOT ARRAY[''venues'',''households'',''food'',''other'',''wording''] <@ ARRAY(SELECT jsonb_array_elements_text(selection->''sections''))) THEN
  tables:=jsonb_set(tables,ARRAY[''app_private.restored_activity_logs''],app_private.backup_log_snapshots(b->''payload''));
  payload:=payload||''{"sign_in_log_reference":[],"administrator_reference":[]}''::jsonb;
 END IF;');
 EXECUTE d;
 -- Retain the existing view shape and every native history source and permission gate.
 view_sql:=pg_get_viewdef('app_private.administration_log_entries'::regclass,true);
 EXECUTE 'CREATE OR REPLACE VIEW app_private.administration_log_entries AS '||rtrim(view_sql,E';\n ')||'
 UNION ALL SELECT ''restored:''||r.id::text,r.occurred_at,r.category,r.action,NULL::uuid,NULL::uuid,r.subject,
 r.details||jsonb_build_object(''_historical_actor'',r.actor_name,''_historical_household'',r.household_name,''_restored_activity'',true)
 FROM app_private.restored_activity_logs r';
 d:=pg_get_functiondef('public.admin_query_logs(text,text,text,timestamptz,timestamptz,timestamptz,text,integer)'::regprocedure);
 IF strpos(d,'SELECT e.*,h.household_name,coalesce(a.name,u.email,')=0 THEN RAISE EXCEPTION 'Unexpected administration log query';END IF;
 EXECUTE replace(d,'SELECT e.*,h.household_name,coalesce(a.name,u.email,',
 'SELECT e.*,coalesce(CASE WHEN e.event_key LIKE ''restored:%'' THEN e.details->>''_historical_household'' END,h.household_name) household_name,coalesce(CASE WHEN e.event_key LIKE ''restored:%'' THEN e.details->>''_historical_actor'' END,a.name,u.email,');
END $functions$;
REVOKE ALL ON FUNCTION app_private.backup_log_tables(),app_private.backup_log_snapshots(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON app_private.administration_log_entries FROM PUBLIC,anon,authenticated;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Partial backup": "interface.messages.backup_partial_export", "Partial restore": "interface.messages.backup_partial_restore", "Event settings and languages are always included. Partial mode resets invitation codes, replies and commitments. Included logs remain read-only history.": "interface.messages.backup_partial_help", "Activity logs can be included in Full or Partial mode. They may contain personal details; Partial restores retain them as read-only history.": "interface.messages.backup_independent_logs_help"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113213849_restrict_partial_logs_and_remove_snapshots.sql
BEGIN;
-- Correct the allowed combinations without reverting the guest/Food/timestamp work.
-- A populated history table must be reviewed rather than dropped automatically.
DO $empty_history$
BEGIN
 PERFORM pg_advisory_xact_lock(19421,7744);
 LOCK TABLE app_private.restored_activity_logs IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM app_private.restored_activity_logs) THEN
  RAISE EXCEPTION 'Restored history is not empty; archive and review it before removing snapshot support.';
 END IF;
END $empty_history$;

CREATE OR REPLACE FUNCTION app_private.backup_selection(mode text,sections text[],include_logs boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE canonical text[];
BEGIN
 IF mode IS NULL OR mode NOT IN ('backup','template') OR sections IS NULL OR include_logs IS NULL
 OR EXISTS(SELECT 1 FROM unnest(sections) s WHERE s IS NULL OR s NOT IN ('venues','households','food','other','wording'))
 THEN RAISE EXCEPTION 'Choose valid backup mode, sections and activity log options.';END IF;
 IF mode='template' AND include_logs THEN RAISE EXCEPTION 'Partial backups and restores cannot include activity logs.';END IF;
 IF mode='backup' AND sections && ARRAY['households','food'] THEN sections:=sections||ARRAY['venues','households','food'];END IF;
 SELECT coalesce(array_agg(s ORDER BY ord),'{}') INTO canonical
 FROM unnest(ARRAY['venues','households','food','other','wording']) WITH ORDINALITY x(s,ord) WHERE s=ANY(sections);
 RETURN jsonb_build_object('mode',mode,'sections',canonical,'include_logs',include_logs);
END $$;

CREATE OR REPLACE FUNCTION app_private.backup_tables()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT ARRAY['public.event_languages','public.event_settings','public.relation_groups','public.food_categories',
 'public.event_locations','public.event_sessions','public.households','public.guests',
 'public.household_contacts','public.household_session_defaults','public.guest_session_overrides','public.food_item_types','public.food_groups','public.food_items',
 'public.food_claims','public.other_categories','public.other_items','public.message_templates','public.rsvp_submissions',
 'public.guest_session_responses','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_send_queue',
 'public.invitation_deliveries','public.invitation_delivery_audit','public.management_audit','public.event_configuration_audit',
 'public.invitation_access_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit',
 'public.food_item_translations','public.food_category_translations','public.food_type_translations','public.venue_translations','public.session_translations','public.event_translations','public.translation_overrides','app_private.invitation_code_registry']::text[]
$function$;

CREATE OR REPLACE FUNCTION app_private.backup_selected_tables(selection jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE sections text[]:=ARRAY(SELECT jsonb_array_elements_text(selection->'sections'));
 selected text[]:=ARRAY['public.event_languages','public.event_settings'];
 live boolean:=selection->>'mode'='backup';
BEGIN
 IF 'venues'=ANY(sections) THEN selected:=selected||ARRAY['public.event_locations','public.event_sessions','public.venue_translations','public.session_translations'];END IF;
 IF 'households'=ANY(sections) THEN
  selected:=selected||ARRAY['public.relation_groups','public.households','public.guests','public.household_contacts'];
  IF live THEN selected:=selected||ARRAY['public.rsvp_submissions','public.guest_session_responses','public.invitation_send_queue','public.invitation_deliveries','app_private.invitation_code_registry'];END IF;
 END IF;
 IF ARRAY['venues','households'] <@ sections THEN selected:=selected||ARRAY['public.household_session_defaults','public.guest_session_overrides'];END IF;
 IF 'food'=ANY(sections) THEN
  selected:=selected||ARRAY['public.food_categories','public.food_item_types','public.food_groups','public.food_items','public.food_item_translations','public.food_category_translations','public.food_type_translations'];
  IF live THEN selected:=selected||ARRAY['public.food_claims'];END IF;
 END IF;
 IF 'other'=ANY(sections) THEN selected:=selected||ARRAY['public.other_categories','public.other_items'];END IF;
 IF 'wording'=ANY(sections) THEN selected:=selected||ARRAY['public.event_translations','public.translation_overrides','public.message_templates'];END IF;
 IF (selection->>'include_logs')::boolean THEN
  selected:=selected||ARRAY['public.event_configuration_audit','public.admin_membership_audit','public.admin_invitations','public.admin_invitation_audit','public.backup_restore_audit'];
  IF 'households'=ANY(sections) THEN selected:=selected||ARRAY['public.management_audit','public.rsvp_household_audit','public.rsvp_response_audit','public.invitation_access_audit','public.invitation_delivery_audit'];END IF;
 END IF;
 RETURN selected;
END $function$;

CREATE OR REPLACE FUNCTION app_private.project_backup(b jsonb, mode text DEFAULT NULL::text, sections text[] DEFAULT NULL::text[], include_logs boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE payload jsonb:=b->'payload';available jsonb:=payload->'selection';selection jsonb;
 tables jsonb;counts jsonb:='{}';t text;fk record;actor_ids text[]:='{}';one jsonb;
BEGIN
 mode:=coalesce(mode,available->>'mode');
 sections:=coalesce(sections,ARRAY(SELECT jsonb_array_elements_text(available->'sections')));
 selection:=app_private.backup_selection(mode,sections,coalesce(include_logs,CASE WHEN mode='template' THEN false ELSE (available->>'include_logs')::boolean END));
 IF available->>'mode'='template' AND mode='backup' THEN RAISE EXCEPTION 'Full restore requires a Full backup file.';END IF;
 IF NOT (selection->'sections') <@ (available->'sections') THEN RAISE EXCEPTION 'Selected sections are not available in this file.';END IF;
 IF (selection->>'include_logs')::boolean AND NOT (available->>'include_logs')::boolean THEN RAISE EXCEPTION 'Activity logs are not available in this file.';END IF;
 IF mode='template' THEN payload:=app_private.backup_as_template(b,sections)->'payload';END IF;
 tables:=payload->'tables';
 FOREACH t IN ARRAY app_private.backup_tables() LOOP
  IF NOT t=ANY(app_private.backup_selected_tables(selection)) THEN tables:=jsonb_set(tables,ARRAY[t],'[]');END IF;
  counts:=counts||jsonb_build_object(t,jsonb_array_length(tables->t));
  FOR fk IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=t::regclass AND c.confrelid='auth.users'::regclass AND c.contype='f' LOOP
   FOR one IN SELECT value FROM jsonb_array_elements(tables->t) LOOP
    IF one->>fk.attname IS NOT NULL THEN actor_ids:=array_append(actor_ids,one->>fk.attname);END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF NOT (selection->>'include_logs')::boolean THEN
  payload:=payload||'{"sign_in_log_reference":[],"administrator_reference":[]}'::jsonb;
 ELSE
  FOR one IN SELECT value FROM jsonb_array_elements(coalesce(payload->'administrator_reference','[]')) LOOP actor_ids:=array_append(actor_ids,one->>'user_id');END LOOP;
 END IF;
 payload:=payload||jsonb_build_object('selection',selection,'tables',tables,'counts',counts,'identities',
  coalesce((SELECT jsonb_agg(u) FROM jsonb_array_elements(payload->'identities') u WHERE u->>'id'=ANY(actor_ids)),'[]'));
 RETURN app_private.seal_backup(payload);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_export_backup(p_mode text DEFAULT 'backup'::text, p_sections text[] DEFAULT ARRAY['venues'::text, 'households'::text, 'food'::text, 'other'::text, 'wording'::text], p_include_logs boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 PERFORM app_private.require_admin_operation('admin_export_backup');
 result:=app_private.project_backup(app_private.seal_backup(app_private.backup_payload()),p_mode,p_sections,coalesce(p_include_logs,p_mode='backup'));
 PERFORM app_private.validate_backup(result);
 RETURN result;
END $function$;

CREATE OR REPLACE VIEW app_private.administration_log_entries AS
 SELECT 'management:'::text || m.id::text AS event_key,
    m.created_at AS occurred_at,
        CASE m.entity_type
            WHEN 'households'::text THEN 'households'::text
            WHEN 'guests'::text THEN 'guests'::text
            WHEN 'household_contacts'::text THEN 'contacts'::text
            WHEN 'food_access'::text THEN 'food'::text
            WHEN 'session_invitations'::text THEN 'rsvp'::text
            ELSE 'households'::text
        END AS category,
        CASE
            WHEN m.entity_type = 'session_invitations'::text THEN 'invitations_changed'::text
            WHEN m.action = 'insert'::text THEN 'add'::text
            WHEN m.action = 'delete'::text THEN 'delete'::text
            WHEN m.action = 'update'::text AND (m.before_value ->> 'archived_at'::text) IS DISTINCT FROM (m.after_value ->> 'archived_at'::text) THEN
            CASE
                WHEN (m.after_value ->> 'archived_at'::text) IS NULL THEN 'restore'::text
                ELSE 'archive'::text
            END
            WHEN m.action = ANY (ARRAY['update'::text, 'permission_change'::text]) THEN 'update'::text
            ELSE m.action
        END AS action,
    m.household_id,
    m.actor_user_id,
    COALESCE(NULLIF(concat_ws(' '::text, m.after_value ->> 'first_name'::text, m.after_value ->> 'last_name'::text), ''::text), m.after_value ->> 'contact_name'::text, m.after_value ->> 'household_name'::text, m.entity_type) AS subject,
    jsonb_build_object('entity', m.entity_type, 'before', m.before_value, 'after', m.after_value) AS details
   FROM management_audit m
UNION ALL
 SELECT 'rsvp-household:'::text || r.id AS event_key,
    r.created_at AS occurred_at,
    'rsvp'::text AS category,
    r.action,
    r.household_id,
    r.actor_user_id,
    'Household RSVP'::text AS subject,
    jsonb_build_object('reason', r.reason, 'submission_id', r.submission_id) AS details
   FROM rsvp_household_audit r
UNION ALL
 SELECT 'rsvp-response:'::text || r.id AS event_key,
    r.created_at AS occurred_at,
    'rsvp'::text AS category,
        CASE r.action
            WHEN 'submission'::text THEN 'response_submitted'::text
            ELSE 'response_corrected'::text
        END AS action,
    r.household_id,
    r.actor_user_id,
    concat_ws(' '::text, g.first_name, g.last_name) AS subject,
    jsonb_build_object('session', s.name, 'before', r.previous_status, 'after', r.new_status, 'reason', r.reason) AS details
   FROM rsvp_response_audit r
     LEFT JOIN guests g ON g.id = r.guest_id
     LEFT JOIN event_sessions s ON s.id = r.session_id
UNION ALL
 SELECT 'delivery:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'invitations'::text AS category,
        CASE a.action
            WHEN 'confirmed_sent'::text THEN 'sent'::text
            ELSE a.action
        END AS action,
    q.household_id,
    a.actor_user_id,
    'Invitation delivery'::text AS subject,
    jsonb_build_object('channel', q.channel, 'reason', a.reason, 'before_status', a.previous_value ->> 'status'::text, 'after_status', a.new_value ->> 'status'::text) AS details
   FROM invitation_delivery_audit a
     JOIN invitation_send_queue q ON q.id = a.queue_id
UNION ALL
 SELECT 'opened:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'invitations'::text AS category,
    'opened'::text AS action,
    a.household_id,
    NULL::uuid AS actor_user_id,
    'Invitation opened'::text AS subject,
    jsonb_build_object('recording', 'Successful invitation load; repeated loads within 15 minutes are grouped') AS details
   FROM invitation_access_audit a
UNION ALL
 SELECT 'configuration:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
        CASE a.entity_type
            WHEN 'event_locations'::text THEN 'venues'::text
            ELSE 'sessions'::text
        END AS category,
        CASE
            WHEN a.before_value IS NULL THEN 'add'::text
            WHEN (a.before_value ->> 'archived_at'::text) IS DISTINCT FROM (a.after_value ->> 'archived_at'::text) THEN
            CASE
                WHEN (a.after_value ->> 'archived_at'::text) IS NULL THEN 'restore'::text
                ELSE 'archive'::text
            END
            ELSE 'update'::text
        END AS action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    COALESCE(a.after_value ->> 'name'::text, a.entity_type) AS subject,
    jsonb_build_object('before', a.before_value, 'after', a.after_value) AS details
   FROM event_configuration_audit a
UNION ALL
 SELECT 'membership:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_id AS actor_user_id,
    COALESCE(a.details ->> 'name'::text, 'Administrator access'::text) AS subject,
    jsonb_build_object('subject_id', a.subject_id, 'details', a.details) AS details
   FROM admin_membership_audit a
UNION ALL
 SELECT 'app-session:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'login'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    'Administrator session'::text AS subject,
    jsonb_build_object('source', 'Verified app session') AS details
   FROM admin_session_audit a
UNION ALL
 SELECT 'auth:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'login'::text AS category,
    COALESCE(a.payload ->> 'action'::text, 'auth_event'::text) AS action,
    NULL::uuid AS household_id,
    u.id AS actor_user_id,
    'Authentication'::text AS subject,
    jsonb_build_object('source', 'Auth service', 'provider', a.payload ->> 'provider'::text) AS details
   FROM auth.audit_log_entries a
     LEFT JOIN auth.users u ON u.id::text = (a.payload ->> 'actor_id'::text)
  WHERE a.created_at IS NOT NULL
UNION ALL
 SELECT 'admin-invitation:'::text || a.id AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_user_id,
    a.email AS subject,
    a.details
   FROM admin_invitation_audit a
UNION ALL
 SELECT 'access:'::text || a.id::text AS event_key,
    a.created_at AS occurred_at,
    'administrators'::text AS category,
    a.action,
    NULL::uuid AS household_id,
    a.actor_id AS actor_user_id,
    COALESCE(( SELECT admins.name
           FROM admins
          WHERE admins.user_id = a.subject_id), 'Former administrator'::text) AS subject,
    a.details
   FROM app_private.admin_access_audit a;

CREATE OR REPLACE FUNCTION public.admin_query_logs(p_search text DEFAULT ''::text, p_category text DEFAULT ''::text, p_action text DEFAULT ''::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_key text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN PERFORM app_private.require_admin_operation('admin_query_logs');
 IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR length(coalesce(p_search,''))>200 OR length(coalesce(p_action,''))>80 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to) OR ((p_before_at IS NULL)<>(p_before_key IS NULL)) THEN RAISE EXCEPTION 'Invalid log filters';END IF;
 IF coalesce(p_category,'') NOT IN ('','households','guests','contacts','rsvp','invitations','login','venues','sessions','food','administrators') THEN RAISE EXCEPTION 'Invalid log category';END IF;
 WITH filtered AS (
 SELECT e.*,h.household_name,coalesce(a.name,u.email,CASE WHEN e.category='invitations' AND e.action='opened' THEN 'Guest' WHEN e.actor_user_id IS NULL THEN 'Guest / system' ELSE 'Administrator' END) actor
 FROM app_private.administration_log_entries e LEFT JOIN public.households h ON h.id=e.household_id LEFT JOIN public.admins a ON a.user_id=e.actor_user_id LEFT JOIN auth.users u ON u.id=e.actor_user_id
 WHERE (coalesce(p_category,'')='' OR e.category=p_category) AND (coalesce(p_action,'')='' OR e.action=p_action) AND (p_from IS NULL OR e.occurred_at>=p_from) AND (p_to IS NULL OR e.occurred_at<p_to)
 AND (p_before_at IS NULL OR (e.occurred_at,e.event_key)<(p_before_at,p_before_key))
 AND (coalesce(btrim(p_search),'')='' OR position(lower(btrim(p_search)) in lower(concat_ws(' ',e.subject,h.household_name,a.name,u.email,e.category,e.action,e.details::text)))>0)
 ORDER BY e.occurred_at DESC,e.event_key DESC LIMIT p_limit+1
 ), numbered AS (SELECT *,row_number() over(ORDER BY occurred_at DESC,event_key DESC) n FROM filtered)
 SELECT jsonb_build_object('entries',coalesce(jsonb_agg(to_jsonb(numbered)-'n' ORDER BY occurred_at DESC,event_key DESC) FILTER(WHERE n<=p_limit),'[]'::jsonb),'has_more',count(*)>p_limit) INTO result FROM numbered;
 result:=result||jsonb_build_object('actions',(SELECT coalesce(jsonb_agg(action ORDER BY action),'[]'::jsonb) FROM (SELECT DISTINCT action FROM app_private.administration_log_entries WHERE coalesce(p_category,'')='' OR category=p_category) a));
 RETURN result;
END $function$;

-- No CASCADE: unexpected dependencies stop the correction.
DROP FUNCTION app_private.backup_log_snapshots(jsonb);
DROP FUNCTION app_private.backup_log_tables();
DROP TABLE app_private.restored_activity_logs;

DO $contract$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('app_private.backup_payload()'::regprocedure);
 IF strpos(d,'''20261113203714''')=0 THEN RAISE EXCEPTION 'Unexpected backup schema';END IF;
 EXECUTE replace(d,'''20261113203714''','''20261113213849''');
 d:=pg_get_functiondef('app_private.validate_backup(jsonb)'::regprocedure);
 IF strpos(d,'''20261113203714''')=0 THEN RAISE EXCEPTION 'Unexpected backup validator';END IF;
 EXECUTE replace(d,'''20261113203714''','''20261113213849''');
END $contract$;

DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Event settings and languages are always included. Partial mode resets invitation codes, replies and commitments, and excludes activity logs.": "interface.messages.backup_partial_excludes_logs", "Activity logs are optional for Full backup and Full restore only. Full restore requires a Full backup file.": "interface.messages.backup_full_logs_only", "Partial backups and restores cannot include activity logs.": "interface.messages.backup_partial_logs_forbidden", "Full restore requires a Full backup file.": "interface.messages.backup_full_file_required"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Migration: 20261113220801_admin_invites_layout_wording.sql
BEGIN;
-- Labels only: no application data, backup checks, grants or RLS policies change.
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Checklist": "interface.messages.checklist", "Quantity: {claimed}/{capacity}": "interface.messages.food_quantity_totals"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Wording only. Backup envelopes, restore checks, permissions and application data are unchanged.
BEGIN;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Compress backup (.json.gz)": "interface.messages.backup_compress", "JSON or gzip (.json.gz) backups. Compression does not encrypt the file.": "interface.messages.backup_compression_help", "Compression is not supported in this browser. Use a JSON backup.": "interface.messages.backup_compression_unavailable", "Decompression is not supported in this browser. Open a JSON backup.": "interface.messages.backup_decompression_unavailable", "The compressed backup is damaged or incomplete.": "interface.messages.backup_gzip_damaged", "Backup exceeds 20 MB when opened.": "interface.messages.backup_opened_too_large"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Additive wording only. No stored event data or security policy changes.
BEGIN;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Set RSVP_SITE_ORIGIN to {origin} and RSVP_SITE_URL to {siteUrl} in Supabase Edge Function secrets.": "interface.messages.setup_site_secrets", "In Supabase Authentication, set Site URL to {siteUrl} and allow the administrator invitation redirect {redirectUrl}.": "interface.messages.setup_auth_urls"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
