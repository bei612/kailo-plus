-- DD-100: extend immutable releases only through the original approval action.
ALTER TABLE admission.action_execution ADD COLUMN component_compatibility_observation jsonb,
  ADD CONSTRAINT component_compatibility_scope CHECK (component_compatibility_observation IS NULL
    OR (action_key='component_release.approve' AND workspace_id IS NULL AND jsonb_typeof(component_compatibility_observation)='object'));
ALTER TABLE catalog.component_release ADD COLUMN approved_by_action_execution_id uuid UNIQUE REFERENCES admission.action_execution(id);
CREATE OR REPLACE FUNCTION admission.guard_component_conformance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.component_compatibility_observation IS NOT NULL
      AND NEW.component_compatibility_observation IS DISTINCT FROM OLD.component_compatibility_observation)
    OR (OLD.component_conformance_plan IS NOT NULL
      AND NEW.component_conformance_plan IS DISTINCT FROM OLD.component_conformance_plan)
    OR (OLD.component_conformance_observation IS NOT NULL
      AND NEW.component_conformance_observation IS DISTINCT FROM OLD.component_conformance_observation) THEN
    RAISE EXCEPTION 'component conformance evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION catalog.guard_component_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['status','approved_by_action_execution_id']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','approved_by_action_execution_id'])
       OR OLD.status<>'REGISTERED' OR OLD.approved_by_action_execution_id IS NOT NULL
       OR NEW.status<>'APPROVED' OR NEW.approved_by_action_execution_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM admission.action_execution ae
         JOIN projection.approval_projection approval ON approval.action_execution_id=ae.id
         JOIN projection.workflow_ref wf ON wf.action_execution_id=ae.id
         JOIN projection.task_projection task ON task.workflow_id=wf.workflow_id
         WHERE ae.id=NEW.approved_by_action_execution_id AND ae.action_key='component_release.approve'
           AND ae.target_id=NEW.id AND ae.tenant_id=NEW.catalog_tenant_id AND ae.workspace_id IS NULL
           AND ae.gate_state='ALLOWED' AND ae.dispatch_state='DISPATCHED'
           AND ae.actor_principal_id=ae.initiator_principal_id
           AND approval.workflow_id=ae.approval_workflow_id AND approval.tenant_id=ae.tenant_id
           AND approval.status IN ('APPROVED','CONSUMED')
           AND wf.workflow_type='ComponentTaskWorkflow' AND wf.kind='COMPONENT_RELEASE'
           AND wf.workflow_id=ae.temporal_workflow_id AND wf.tenant_id=ae.tenant_id
           AND wf.operation_id=ae.operation_id AND task.status='RUNNING'
           AND ae.component_compatibility_observation->>'actionExecutionId'=ae.id::text
           AND ae.component_compatibility_observation->>'componentReleaseId'=NEW.id::text
           AND ae.component_compatibility_observation->>'workflowId'=wf.workflow_id
           AND ae.component_compatibility_observation->>'runId'=task.run_id
           AND ae.component_compatibility_observation->>'approvalWorkflowId'=approval.workflow_id
           AND ae.component_compatibility_observation->>'registrationPlanDigest'=(
             SELECT component_conformance_plan->>'planDigest' FROM admission.action_execution
              WHERE id=NEW.registered_by_action_execution_id)
           AND jsonb_typeof(ae.component_compatibility_observation->'builds')='array'
           AND jsonb_array_length(ae.component_compatibility_observation->'builds')=3
       ) THEN
      RAISE EXCEPTION 'release approval requires original action, approval and deployment evidence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status<>'REGISTERED' OR NEW.approved_by_action_execution_id IS NOT NULL OR NOT EXISTS (
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

-- Inherit the existing Catalog approval duration from its policy authority;
-- no new hard-coded timeout or silent default.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM catalog.approval_policy WHERE action_key='capability_contract.approve' AND version=1 AND status='ACTIVE') THEN
    RAISE EXCEPTION 'Catalog approval duration policy missing' USING ERRCODE='23514';
  END IF;
END $$;
INSERT INTO catalog.approval_policy
  (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
SELECT gen_random_uuid(),1,'component_release.approve','COMPONENT_RELEASE',
  '[{"selector":"TENANT_ADMIN","minDistinct":1}]'::jsonb,'NONE','DENY',expires_in_seconds,'ACTIVE'
FROM catalog.approval_policy WHERE action_key='capability_contract.approve' AND version=1 AND status='ACTIVE';
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT 'component_release.approve',1,'core','COMPONENT_RELEASE','SESSION_TENANT','TENANT_ONLY',
 'manage','tenant','TEMPORAL','APPROVAL',id,version,'ComponentTaskWorkflow','COMPONENT_RELEASE',
 'NONE',NULL,'NONE','{}'::text[],'NONE','FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM catalog.approval_policy WHERE action_key='component_release.approve' AND version=1 AND status='ACTIVE';
