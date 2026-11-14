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
