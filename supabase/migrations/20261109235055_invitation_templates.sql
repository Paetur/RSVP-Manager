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
