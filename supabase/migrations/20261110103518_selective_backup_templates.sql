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
