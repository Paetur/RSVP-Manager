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
