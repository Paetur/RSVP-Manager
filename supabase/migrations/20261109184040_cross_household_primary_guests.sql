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
