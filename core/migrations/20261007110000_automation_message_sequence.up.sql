-- REQ-24: same Invocation/ActionExecution, append-only native event references.
-- No message content, second workflow, or replacement execution authority.
ALTER TABLE catalog.agent_invocation ADD COLUMN automation_step_event_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE catalog.automation_version DROP CONSTRAINT automation_version_action_check;
ALTER TABLE catalog.automation_version ADD CONSTRAINT automation_version_action_check CHECK ((
 jsonb_typeof(action)='object' AND (
  (action->>'kind' IN ('AGENT_TURN','POST_MESSAGE','POST_MESSAGE_STEPS')
   AND jsonb_typeof(action->'template')='string' AND length(action->>'template')>0)
  OR (action->>'kind'='ADD_REACTION_STEPS' AND jsonb_typeof(action->'emoji')='string'
   AND length(action->>'emoji')>0 AND trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION'))
  OR (action->>'kind'='SET_CHANNEL_TOPIC_STEPS' AND jsonb_typeof(action->'topic')='string'))
 AND (action->>'kind' NOT IN ('POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS') OR (
  (action->'stepsVersion'='2'::jsonb OR (action->>'kind'='POST_MESSAGE_STEPS' AND action->'stepsVersion'='3'::jsonb))
  AND jsonb_typeof(action->'steps')='array' AND jsonb_array_length(action->'steps')>0))) IS TRUE);

CREATE FUNCTION catalog.automation_step_accepted(invocation uuid, event text) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM catalog.agent_invocation i
 JOIN admission.action_execution a ON a.id=i.action_execution_id
 JOIN audit.audit_event e ON e.operation_id=a.operation_id
  AND e.tenant_id=i.tenant_id AND e.workspace_id=i.workspace_id
  AND e.actor_principal_id=a.actor_principal_id AND e.initiator_principal_id=a.initiator_principal_id
  AND e.action_key=a.action_key AND e.action_version=a.action_version AND e.parameter_hash=a.parameter_hash
  AND e.event_type='RECONCILIATION' AND e.result_code='ACCEPTED' AND e.decision='ALLOW'
 WHERE i.id=invocation AND e.evidence_refs @> jsonb_build_array(
  jsonb_build_object('kind','ACTION_EXECUTION_ID','value',a.id::text),
  jsonb_build_object('kind','BUZZ_EVENT_ID','value',event)))
$$;

CREATE FUNCTION catalog.guard_automation_step_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action jsonb; total integer; old_count integer; new_count integer;
BEGIN
 SELECT v.action INTO action FROM catalog.automation_version v
  WHERE v.asset_id=NEW.automation_version_asset_id AND v.automation_resource_id=NEW.automation_resource_id;
 new_count:=cardinality(NEW.automation_step_event_ids);
 old_count:=CASE WHEN TG_OP='INSERT' THEN 0 ELSE cardinality(OLD.automation_step_event_ids) END;
 IF TG_OP='INSERT' AND new_count<>0 THEN
  RAISE EXCEPTION 'Sequence starts without a publication' USING ERRCODE='check_violation';
 END IF;
 IF new_count=0 AND old_count=0 THEN RETURN NEW; END IF;
 IF action->'stepsVersion' IS DISTINCT FROM '3'::jsonb OR action->>'kind'<>'POST_MESSAGE_STEPS'
  OR NEW.runtime_turn_id IS NOT NULL OR NEW.native_status IS NOT NULL
  OR array_ndims(NEW.automation_step_event_ids)<>1 OR array_lower(NEW.automation_step_event_ids,1)<>1
  OR EXISTS(SELECT 1 FROM unnest(NEW.automation_step_event_ids) e WHERE e IS NULL OR e !~ '^[0-9a-f]{64}$')
  OR (SELECT count(DISTINCT e) FROM unnest(NEW.automation_step_event_ids) e)<>new_count THEN
  RAISE EXCEPTION 'Sequence references require exact native message version' USING ERRCODE='check_violation';
 END IF;
 SELECT count(*) INTO total FROM jsonb_array_elements(action->'steps') s WHERE s->>'action'='send_message';
 IF new_count>total OR new_count<old_count OR new_count>old_count+1
  OR (old_count>0 AND NEW.automation_step_event_ids[1:old_count] IS DISTINCT FROM OLD.automation_step_event_ids) THEN
  RAISE EXCEPTION 'Sequence references are append-only' USING ERRCODE='check_violation';
 END IF;
 IF new_count>old_count THEN
  IF NEW.cancel_pending OR NEW.status<>'DISPATCHING' OR OLD.status NOT IN ('CREATED','DISPATCHING','UNKNOWN')
   OR OLD.reply_event_id IS NOT NULL OR OLD.post_message_intent IS NOT NULL
   OR EXISTS(SELECT 1 FROM unnest(OLD.automation_step_event_ids) e WHERE NOT catalog.automation_step_accepted(NEW.id,e))
   OR NOT EXISTS(SELECT 1 FROM admission.action_execution a WHERE a.id=NEW.action_execution_id
    AND a.action_key='automation.run' AND a.gate_state='ALLOWED' AND a.dispatch_state='DISPATCHED'
    AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id AND a.target_id=NEW.automation_resource_id) THEN
   RAISE EXCEPTION 'Previous effect must be verified before new dispatch' USING ERRCODE='check_violation';
  END IF;
 END IF;
 IF (new_count=total AND (NEW.reply_event_id IS DISTINCT FROM NEW.automation_step_event_ids[new_count]
   OR NEW.post_message_intent IS NULL)) OR (new_count<total AND (NEW.reply_event_id IS NOT NULL OR NEW.post_message_intent IS NOT NULL)) THEN
  RAISE EXCEPTION 'Only last sequence event is the immutable run result' USING ERRCODE='check_violation';
 END IF;
 IF NEW.status IN ('COMPLETED','CANCELED') AND EXISTS(
  SELECT 1 FROM unnest(NEW.automation_step_event_ids) e WHERE NOT catalog.automation_step_accepted(NEW.id,e)) THEN
  RAISE EXCEPTION 'Unconfirmed sequence cannot complete or cancel' USING ERRCODE='check_violation';
 END IF;
 IF NEW.status='COMPLETED' AND new_count<>total THEN
  RAISE EXCEPTION 'Sequence cannot complete before its last message' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_step_events_guard BEFORE INSERT OR UPDATE ON catalog.agent_invocation
 FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_step_events();

CREATE OR REPLACE FUNCTION catalog.guard_agent_cancel_before_dispatch() RETURNS trigger AS $$
BEGIN
 IF NEW.status='CANCELED' AND NEW.native_status IS NULL THEN
  IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Cancellation requires existing intent' USING ERRCODE='check_violation'; END IF;
  -- Partial completion is not no-dispatch proof: every earlier message needs
  -- positive original Relay reconciliation, and no final publication may exist.
  IF cardinality(OLD.automation_step_event_ids)>0 AND OLD.reply_event_id IS NULL
   AND OLD.status IN ('DISPATCHING','UNKNOWN','CANCELED') AND NEW.cancel_pending
   AND NOT EXISTS(SELECT 1 FROM unnest(OLD.automation_step_event_ids) e WHERE NOT catalog.automation_step_accepted(NEW.id,e))
   AND EXISTS(SELECT 1 FROM catalog.automation_version v WHERE v.asset_id=NEW.automation_version_asset_id AND v.action->'stepsVersion'='3'::jsonb)
   AND OLD.runtime_turn_id IS NULL AND OLD.native_status IS NULL THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('CREATED','CANCELED') OR OLD.runtime_turn_id IS NOT NULL OR OLD.native_status IS NOT NULL
   OR OLD.reply_event_id IS NOT NULL OR EXISTS(SELECT 1 FROM projection.agent_model_trace WHERE invocation_id=NEW.id)
   OR EXISTS(SELECT 1 FROM outbox.usage_event WHERE invocation_id=NEW.id) THEN
   RAISE EXCEPTION 'Dispatched or unknown work cannot become no-turn cancellation' USING ERRCODE='check_violation';
  END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
