-- Webhook step evidence is not disposable: refuse to narrow the check while
-- any projection carries it, otherwise restore the original function.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM projection.task_projection p, jsonb_array_elements(p.execution_trace) entry
   WHERE p.execution_trace IS NOT NULL AND jsonb_typeof(p.execution_trace)='array'
     AND (entry->'output' ? 'requestId' OR entry->'output' ? 'httpStatus')) THEN
  RAISE EXCEPTION 'call_webhook step evidence must be retained' USING ERRCODE='check_violation';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION projection.valid_automation_step_trace(trace jsonb) RETURNS boolean
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
