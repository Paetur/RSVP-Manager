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
