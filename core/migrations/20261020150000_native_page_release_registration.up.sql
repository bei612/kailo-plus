-- DD-127（07 §2.5、§6.2）：原生页面入口 release 冻结空套件计划（零步骤、零契约摘要），
-- 其注册证据是该计划下的空观测列表。20261004018000 的注册守卫要求观测非空，
-- 使这一形态的注册永远无法落库。这里只为同时满足 implements=[]、NATIVE_PAGE、
-- ExecutionConnector NONE 且计划契约摘要为空的 release 放行空观测；其余 release
-- 仍要求至少一条观测，其它证据条件逐字不变。
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
      AND (jsonb_array_length(ae.component_conformance_observation->'observations')>0
        -- DD-127: a native-page-only release freezes an empty suite plan, so its
        -- registration evidence is the empty observation list of that plan.
        OR (NEW.manifest->'executionConnector'->>'mode'='NONE'
          AND NEW.manifest->'implements'='[]'::jsonb
          AND NEW.manifest->'frontendDelivery'->>'mode'='NATIVE_PAGE'
          AND ae.component_conformance_plan->'contractDigests'='[]'::jsonb
          AND jsonb_array_length(ae.component_conformance_observation->'observations')=0))
      AND EXISTS (SELECT 1 FROM identity.relay_operator_identity o WHERE o.catalog_tenant_id=ae.tenant_id)
  ) THEN
    RAISE EXCEPTION 'release requires original Catalog action and actual workflow evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
