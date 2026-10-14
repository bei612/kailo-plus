-- Recorded effect deadlines and effect-step timeouts are immutable run history:
-- stop the rollback (and the release) instead of discarding them.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM catalog.agent_invocation
   WHERE automation_effect_starts<>'{}'::jsonb OR automation_timed_out_step IS NOT NULL)
  OR EXISTS(SELECT 1 FROM catalog.automation_version v
   WHERE jsonb_typeof(v.action->'steps')='array'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.action->'steps') s
     WHERE s->>'action' IN ('send_message','add_reaction','set_channel_topic') AND s ? 'timeout_secs')) THEN
  RAISE EXCEPTION 'Effect-step timeout versions or runs exist; stop rollback';
 END IF;
END $$;
DROP TRIGGER automation_effect_deadline_guard ON catalog.agent_invocation;
DROP FUNCTION catalog.guard_automation_effect_deadline();
ALTER TABLE catalog.agent_invocation DROP CONSTRAINT agent_invocation_effect_starts;
ALTER TABLE catalog.agent_invocation DROP COLUMN automation_timed_out_step, DROP COLUMN automation_effect_starts;
