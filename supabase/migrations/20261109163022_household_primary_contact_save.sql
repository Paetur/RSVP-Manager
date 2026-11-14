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
