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
