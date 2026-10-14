-- Frozen step decisions or a no-effect completion are immutable run history:
-- stop the rollback (and the release) instead of rewriting them.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.agent_invocation WHERE automation_effect_skipped)
  OR EXISTS(SELECT 1 FROM admission.action_execution
   WHERE parameters ? 'automationSkippedSteps' OR parameters ? 'automationStepConditionError')
  OR EXISTS(SELECT 1 FROM catalog.automation_version v
   WHERE jsonb_typeof(v.action->'steps')='array'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.action->'steps') s WHERE s ? 'if')) THEN
  RAISE EXCEPTION 'Step-condition versions or runs exist; stop rollback';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION catalog.guard_automation_step_events() RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP TRIGGER automation_effect_skipped_guard ON catalog.agent_invocation;
DROP FUNCTION catalog.guard_automation_effect_skipped();
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_check;
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT agent_invocation_check CHECK(
 status<>'COMPLETED' OR (reply_event_id IS NOT NULL AND (
   native_status IS NOT DISTINCT FROM 'completed'
   OR (post_message_intent IS NOT NULL AND runtime_turn_id IS NULL AND native_status IS NULL))));
DROP FUNCTION catalog.automation_skipped_steps(uuid);
ALTER TABLE catalog.agent_invocation DROP COLUMN automation_effect_skipped;
