-- Optional read projection on the existing Workflow/Task authority. Legacy
-- writers omit this field; they must not clear previously recorded evidence.
CREATE FUNCTION projection.valid_automation_step_trace(trace jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN trace IS NULL THEN true WHEN jsonb_typeof(trace)<>'array' THEN false ELSE
 NOT EXISTS(SELECT 1 FROM jsonb_array_elements(trace) entry WHERE
  jsonb_typeof(entry)<>'object' OR NOT entry ?& ARRAY['stepId','status','output']
  OR entry - ARRAY['stepId','status','output','startedAt','completedAt','error'] <> '{}'::jsonb
  OR jsonb_typeof(entry->'stepId')<>'string' OR length(entry->>'stepId')=0
  OR jsonb_typeof(entry->'status')<>'string'
  OR entry->>'status' NOT IN ('pending','running','waiting_approval','completed','failed','cancelled','skipped','unknown')
  OR jsonb_typeof(entry->'output')<>'object'
  OR (entry->'output') - ARRAY['eventId','workflowId','runId','historyEventId','actionExecutionId','approvalWorkflowId'] <> '{}'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_each(entry->'output') pair WHERE
    (pair.key='historyEventId' AND (jsonb_typeof(pair.value)<>'number' OR pair.value::text !~ '^[1-9][0-9]*$'))
    OR (pair.key<>'historyEventId' AND (jsonb_typeof(pair.value)<>'string' OR length(pair.value #>> '{}')=0)))
  OR (entry ? 'startedAt' AND jsonb_typeof(entry->'startedAt')<>'string')
  OR (entry ? 'completedAt' AND jsonb_typeof(entry->'completedAt')<>'string')
  OR (entry ? 'error' AND jsonb_typeof(entry->'error')<>'string'))
 AND (SELECT count(*)=count(DISTINCT entry->>'stepId') FROM jsonb_array_elements(trace) entry)
 END
$$;
ALTER TABLE projection.task_projection ADD COLUMN execution_trace jsonb;
ALTER TABLE projection.task_projection ADD CONSTRAINT task_projection_execution_trace_check
 CHECK (projection.valid_automation_step_trace(execution_trace) IS TRUE);
