-- REQ-23/24, DD-107: fixed Buzz Step.timeout_secs on effect steps. Core records,
-- once, when this run first reached each timed effect step and, if the deadline
-- passed before the effect was dispatched, which step timed out. No timer or
-- second execution authority: dispatched effects keep the existing reconciliation.
ALTER TABLE catalog.agent_invocation
 ADD COLUMN automation_effect_starts jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN automation_timed_out_step text;
ALTER TABLE catalog.agent_invocation ADD CONSTRAINT agent_invocation_effect_starts CHECK (
 jsonb_typeof(automation_effect_starts)='object'
 AND (automation_timed_out_step IS NULL OR automation_effect_starts ? automation_timed_out_step));

CREATE FUNCTION catalog.guard_automation_effect_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.automation_effect_starts<>'{}'::jsonb OR NEW.automation_timed_out_step IS NOT NULL THEN
   RAISE EXCEPTION 'Effect deadlines start empty' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
 END IF;
 FOR key IN SELECT jsonb_object_keys(OLD.automation_effect_starts) LOOP
  IF NEW.automation_effect_starts->key IS DISTINCT FROM OLD.automation_effect_starts->key THEN
   RAISE EXCEPTION 'Effect step start is immutable' USING ERRCODE='check_violation';
  END IF;
 END LOOP;
 IF NEW.automation_effect_starts<>OLD.automation_effect_starts AND (
  NEW.status NOT IN ('CREATED','DISPATCHING') OR NEW.reply_event_id IS NOT NULL OR NEW.post_message_intent IS NOT NULL
  OR EXISTS(SELECT 1 FROM jsonb_each(NEW.automation_effect_starts) e
   WHERE NOT OLD.automation_effect_starts ? e.key AND (jsonb_typeof(e.value)<>'string'
    OR (e.value#>>'{}')::timestamptz>clock_timestamp()))) THEN
  RAISE EXCEPTION 'Effect step start is recorded once before dispatch' USING ERRCODE='check_violation';
 END IF;
 IF NEW.automation_timed_out_step IS DISTINCT FROM OLD.automation_timed_out_step AND (
  OLD.automation_timed_out_step IS NOT NULL OR OLD.status NOT IN ('CREATED','DISPATCHING')
  OR NEW.reply_event_id IS NOT NULL OR NEW.post_message_intent IS NOT NULL) THEN
  RAISE EXCEPTION 'A step timeout is recorded once before dispatch' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_effect_deadline_guard BEFORE INSERT OR UPDATE ON catalog.agent_invocation
 FOR EACH ROW EXECUTE FUNCTION catalog.guard_automation_effect_deadline();
