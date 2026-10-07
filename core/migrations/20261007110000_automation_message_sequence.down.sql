-- Published format 3 or any dispatched reference prevents destructive rollback.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.automation_version WHERE action->'stepsVersion'='3'::jsonb)
  OR EXISTS(SELECT 1 FROM catalog.agent_invocation WHERE cardinality(automation_step_event_ids)>0) THEN
  RAISE EXCEPTION 'Cannot remove immutable sequence history; stop rollback';
 END IF;
END $$;
DROP TRIGGER automation_step_events_guard ON catalog.agent_invocation;
DROP FUNCTION catalog.guard_automation_step_events();
CREATE OR REPLACE FUNCTION catalog.guard_agent_cancel_before_dispatch() RETURNS trigger AS $$
BEGIN
 IF NEW.status='CANCELED' AND NEW.native_status IS NULL THEN
  IF TG_OP<>'UPDATE' THEN
   RAISE EXCEPTION 'No-turn cancellation requires an existing CREATED intent' USING ERRCODE='check_violation';
  END IF;
  IF OLD.status NOT IN ('CREATED','CANCELED') OR OLD.runtime_turn_id IS NOT NULL OR OLD.native_status IS NOT NULL
   OR OLD.reply_event_id IS NOT NULL OR EXISTS(SELECT 1 FROM projection.agent_model_trace WHERE invocation_id=NEW.id)
   OR EXISTS(SELECT 1 FROM outbox.usage_event WHERE invocation_id=NEW.id) THEN
   RAISE EXCEPTION 'Dispatched or unknown model work cannot become no-turn cancellation' USING ERRCODE='check_violation';
  END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP FUNCTION catalog.automation_step_accepted(uuid,text);
ALTER TABLE catalog.agent_invocation DROP COLUMN automation_step_event_ids;
ALTER TABLE catalog.automation_version DROP CONSTRAINT automation_version_action_check;
ALTER TABLE catalog.automation_version ADD CONSTRAINT automation_version_action_check CHECK ((
 jsonb_typeof(action)='object' AND (
  (action->>'kind' IN ('AGENT_TURN','POST_MESSAGE','POST_MESSAGE_STEPS')
   AND jsonb_typeof(action->'template')='string' AND length(action->>'template')>0)
  OR (action->>'kind'='ADD_REACTION_STEPS' AND jsonb_typeof(action->'emoji')='string'
   AND length(action->>'emoji')>0 AND trigger->>'kind' IN ('CHANNEL_MESSAGE','MENTION'))
  OR (action->>'kind'='SET_CHANNEL_TOPIC_STEPS' AND jsonb_typeof(action->'topic')='string'))
 AND (action->>'kind' NOT IN ('POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS') OR (
  action->'stepsVersion'='2'::jsonb AND jsonb_typeof(action->'steps')='array' AND jsonb_array_length(action->'steps')>0))) IS TRUE);
