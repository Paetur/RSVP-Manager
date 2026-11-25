\set ON_ERROR_STOP on
-- Disposable local installation only. All synthetic changes roll back.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.households) OR EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'Run only on an empty disposable installation'; END IF; END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin\_%' ESCAPE '\' AND has_function_privilege('anon',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'Anonymous administrator RPC execution exposed';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_invitation_v2','get_household_food','set_household_food_claim','confirm_household_food','submit_household_rsvp') AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'Guest gateway execution boundary mismatch';END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ DECLARE tab text; amount bigint; BEGIN
 FOREACH tab IN ARRAY ARRAY['households','guests','household_contacts','food_claims','admins'] LOOP
  BEGIN EXECUTE format('SELECT count(*) FROM public.%I',tab) INTO amount; IF amount<>0 THEN RAISE EXCEPTION 'Anonymous private data exposed';END IF;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END LOOP;
END $$;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at,aud,role) VALUES
 ('11111111-1111-4111-8111-111111111111','fresh-admin@example.invalid',now(),'authenticated','authenticated'),
 ('22222222-2222-4222-8222-222222222222','fresh-user@example.invalid',now(),'authenticated','authenticated');
INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',now(),now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',now(),now());
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true),set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.is_admin() THEN RAISE EXCEPTION 'Nonadmin recognized as administrator';END IF;
 BEGIN PERFORM public.admin_save_language('zz','Synthetic test',true,99);RAISE EXCEPTION 'Nonadmin mutation allowed';EXCEPTION WHEN SQLSTATE 'PT401' THEN NULL;END;
 BEGIN INSERT INTO public.admins(user_id,name) VALUES(auth.uid(),'Self grant');RAISE EXCEPTION 'Self grant allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF (SELECT count(*) FROM public.households)<>0 THEN RAISE EXCEPTION 'Nonadmin private data exposed';END IF;
END $$;
RESET ROLE;
INSERT INTO public.admins(user_id,name) VALUES('11111111-1111-4111-8111-111111111111','Synthetic test administrator');
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true),set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access failed';END IF;
 PERFORM public.admin_save_language('zz','Synthetic test',true,99);
 PERFORM public.admin_prepare_invitation('fresh-user@example.invalid','Synthetic recipient',NULL);
END $$;
RESET ROLE;
DELETE FROM auth.sessions WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.admin_prepare_invitation('fresh-user@example.invalid','Synthetic recipient',NULL);RAISE EXCEPTION 'Revoked invitation session allowed';EXCEPTION WHEN SQLSTATE 'PT401' THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: anonymous/nonadmin restrictions, no self-grant, administrator mutation, revoked invitation session and guest gateway execution boundary';
SELECT 'remaining_auth_users='||count(*) FROM auth.users;
SELECT 'remaining_households='||count(*) FROM public.households;
SELECT 'published='||is_published FROM public.event_settings;
