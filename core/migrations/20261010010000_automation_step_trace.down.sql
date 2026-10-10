-- Trace evidence is not disposable during rollback. Refuse contraction after
-- this writer has been used; retain the compatible optional projection instead.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM projection.task_projection WHERE execution_trace IS NOT NULL) THEN
  RAISE EXCEPTION 'Automation step evidence must be retained' USING ERRCODE='check_violation';
 END IF;
END $$;
ALTER TABLE projection.task_projection DROP CONSTRAINT task_projection_execution_trace_check;
ALTER TABLE projection.task_projection DROP COLUMN execution_trace;
DROP FUNCTION projection.valid_automation_step_trace(jsonb);
