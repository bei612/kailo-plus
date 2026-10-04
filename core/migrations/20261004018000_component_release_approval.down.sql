DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key='component_release.approve' OR component_compatibility_observation IS NOT NULL)
     OR EXISTS (SELECT 1 FROM catalog.component_release WHERE approved_by_action_execution_id IS NOT NULL OR status<>'REGISTERED') THEN
    RAISE EXCEPTION 'component approval downgrade would discard immutable evidence' USING ERRCODE='23514';
  END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key='component_release.approve' AND version=1;
DELETE FROM catalog.approval_policy WHERE action_key='component_release.approve' AND version=1;
CREATE OR REPLACE FUNCTION catalog.guard_component_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'component release registration is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status<>'REGISTERED' OR NOT EXISTS (
    SELECT 1 FROM admission.action_execution ae
    JOIN identity.principal p ON p.id=ae.initiator_principal_id
    JOIN projection.workflow_ref wf ON wf.action_execution_id=ae.id
    JOIN projection.task_projection task ON task.workflow_id=wf.workflow_id
    WHERE ae.id=NEW.registered_by_action_execution_id AND ae.action_key='component_release.register'
      AND ae.tenant_id=NEW.catalog_tenant_id AND ae.workspace_id IS NULL AND ae.target_id=NEW.id
      AND ae.gate_state='ALLOWED' AND ae.dispatch_state='DISPATCHED'
      AND p.tenant_id=ae.tenant_id AND p.kind='HUMAN'
      AND wf.workflow_type='ComponentTaskWorkflow' AND wf.kind='COMPONENT_RELEASE'
      AND wf.operation_id=ae.operation_id AND wf.tenant_id=ae.tenant_id AND wf.run_id IS NOT NULL
      AND ae.component_conformance_observation->>'actionExecutionId'=ae.id::text
      AND ae.component_conformance_observation->>'operationId'=ae.operation_id::text
      AND ae.component_conformance_observation->>'workflowId'=wf.workflow_id
      -- WorkflowRef retains the first run for the original execution chain;
      -- TaskProjection records the current run after ContinueAsNew.
      AND task.status='RUNNING'
      AND ae.component_conformance_observation->>'runId'=task.run_id
      AND ae.component_conformance_observation->>'componentReleaseId'=NEW.id::text
      AND ae.component_conformance_observation->>'artifactDigest'=NEW.adapter_build_ref
      AND ae.component_conformance_observation->>'planDigest'=ae.component_conformance_plan->>'planDigest'
      AND ae.component_conformance_observation->>'suiteDigest'=ae.component_conformance_plan->>'suiteDigest'
      AND ae.component_conformance_observation->'contractDigests'=ae.component_conformance_plan->'contractDigests'
      AND jsonb_typeof(ae.component_conformance_observation->'observations')='array'
      AND jsonb_array_length(ae.component_conformance_observation->'observations')>0
      AND EXISTS (SELECT 1 FROM identity.relay_operator_identity o WHERE o.catalog_tenant_id=ae.tenant_id)
  ) THEN
    RAISE EXCEPTION 'release requires original Catalog action and actual workflow evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION admission.guard_component_conformance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.component_conformance_plan IS NOT NULL
      AND NEW.component_conformance_plan IS DISTINCT FROM OLD.component_conformance_plan)
    OR (OLD.component_conformance_observation IS NOT NULL
      AND NEW.component_conformance_observation IS DISTINCT FROM OLD.component_conformance_observation) THEN
    RAISE EXCEPTION 'component conformance evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE catalog.component_release DROP COLUMN approved_by_action_execution_id;
ALTER TABLE admission.action_execution DROP CONSTRAINT component_compatibility_scope, DROP COLUMN component_compatibility_observation;
