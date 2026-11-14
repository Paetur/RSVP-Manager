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
